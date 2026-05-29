const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const candidateAuthMiddleware = require('../middleware/candidateAuthMiddleware');
const CandidateAccount = require('../models/CandidateAccount');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');
const onboardingPdfService = require('../services/onboardingPdfService');
const onboardingStorageService = require('../services/onboardingStorageService');
const onboardingEmailService = require('../services/onboardingEmailService');
const { logOnboardingEvent } = require('../services/onboardingAuditService');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function candidateName(candidate) {
  return `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || candidate?.email || 'Candidate';
}

function createTokens(account) {
  const payload = {
    type: 'candidate',
    email: account.email,
    tokenVersion: account.refreshTokenVersion
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    subject: account._id.toString(),
    audience: 'candidate-portal',
    expiresIn: process.env.CANDIDATE_JWT_TTL || '20m'
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_SECRET, {
    subject: account._id.toString(),
    audience: 'candidate-portal',
    expiresIn: process.env.CANDIDATE_REFRESH_TTL || '30d'
  });

  return { token, refreshToken, expiresIn: process.env.CANDIDATE_JWT_TTL || '20m' };
}

async function findOnboardingsForAccount(account) {
  return CandidateOnboarding.find({
    candidateAccount: account._id,
    status: { $ne: 'cancelled' }
  })
    .populate('candidate', 'firstName lastName email phone position status')
    .populate('envelopes')
    .sort({ createdAt: -1 });
}

function canSignerAct(envelope, signer) {
  return !envelope.signers.some((item) => item.order < signer.order && item.status !== 'signed');
}

async function completeEnvelopeIfReady(envelope) {
  const allDocumentsComplete = envelope.documents.every((doc) => ['signed', 'completed'].includes(doc.status));
  const allSignersSigned = envelope.signers.every((signer) => signer.status === 'signed');

  if (allDocumentsComplete && allSignersSigned) {
    envelope.status = 'completed';
    envelope.completedAt = new Date();
    envelope.documents.forEach((doc) => {
      if (doc.status === 'signed') doc.status = 'completed';
    });
    await CandidateOnboarding.findByIdAndUpdate(envelope.onboarding, {
      status: 'completed',
      completedAt: new Date()
    });
    return true;
  }

  envelope.status = allSignersSigned || envelope.signers.some((signer) => signer.status === 'signed')
    ? 'partially_signed'
    : envelope.status;
  return false;
}

router.post('/auth/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ msg: 'A valid invitation token and password of at least 8 characters are required' });
    }

    const onboarding = await CandidateOnboarding.findOne({
      inviteTokenHash: sha256(token),
      inviteTokenExpiresAt: { $gt: new Date() }
    }).select('+inviteTokenHash')
      .populate('candidate')
      .populate('organization');

    if (!onboarding) {
      return res.status(400).json({ msg: 'Invitation token is invalid or expired' });
    }

    let account = await CandidateAccount.findOne({ email: onboarding.candidate.email }).select('+passwordHash');
    if (!account) {
      account = new CandidateAccount({
        email: onboarding.candidate.email,
        profile: {
          firstName: onboarding.candidate.firstName,
          lastName: onboarding.candidate.lastName,
          phone: onboarding.candidate.phone
        }
      });
    }

    account.passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    account.status = 'active';
    account.lastPasswordChangeAt = new Date();
    account.lastLoginAt = new Date();
    account.linkCandidate(onboarding.candidate._id, onboarding.organization._id);
    await account.save();

    onboarding.candidateAccount = account._id;
    onboarding.status = onboarding.status === 'pending' ? 'in_progress' : onboarding.status;
    onboarding.inviteTokenHash = undefined;
    onboarding.inviteTokenExpiresAt = undefined;
    await onboarding.save();

    await logOnboardingEvent({
      req,
      organization: onboarding.organization._id,
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      actorType: 'candidate',
      actorCandidateAccount: account._id,
      actorEmail: account.email,
      action: 'candidate_invite_accepted'
    });

    res.json({ ...createTokens(account), account });
  } catch (error) {
    console.error('Accept candidate invite failed:', error);
    res.status(500).json({ msg: 'Failed to accept invitation', error: error.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const account = await CandidateAccount.findOne({ email: String(email || '').toLowerCase().trim() }).select('+passwordHash');
    if (!account || !account.passwordHash) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const matches = await bcrypt.compare(password, account.passwordHash);
    if (!matches) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    account.status = 'active';
    account.lastLoginAt = new Date();
    await account.save();

    res.json({ ...createTokens(account), account });
  } catch (error) {
    res.status(500).json({ msg: 'Candidate login failed', error: error.message });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ msg: 'Refresh token is required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET, {
      audience: 'candidate-portal'
    });
    if (decoded.type !== 'candidate') {
      return res.status(401).json({ msg: 'Invalid refresh token' });
    }

    const account = await CandidateAccount.findById(decoded.sub);
    if (!account || account.status === 'disabled' || decoded.tokenVersion !== account.refreshTokenVersion) {
      return res.status(401).json({ msg: 'Invalid refresh token' });
    }

    res.json(createTokens(account));
  } catch (error) {
    res.status(401).json({ msg: 'Refresh token expired or invalid' });
  }
});

router.post('/auth/logout', candidateAuthMiddleware, async (req, res) => {
  req.candidateAccount.refreshTokenVersion += 1;
  await req.candidateAccount.save();
  res.json({ msg: 'Logged out' });
});

router.get('/me', candidateAuthMiddleware, async (req, res) => {
  res.json({ account: req.candidateAccount });
});

router.get('/onboarding', candidateAuthMiddleware, async (req, res) => {
  try {
    const onboardings = await findOnboardingsForAccount(req.candidateAccount);
    res.json({ data: onboardings });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding records', error: error.message });
  }
});

router.get('/onboarding/:id', candidateAuthMiddleware, async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.params.id,
      candidateAccount: req.candidateAccount._id
    })
      .populate('candidate', 'firstName lastName email phone position status')
      .populate('organization', 'name logo')
      .populate('envelopes');

    if (!onboarding) return res.status(404).json({ msg: 'Onboarding not found' });

    await OnboardingEnvelope.updateMany(
      {
        _id: { $in: onboarding.envelopes || [] },
        'signers.candidateAccount': req.candidateAccount._id,
        status: 'sent'
      },
      {
        $set: {
          status: 'viewed',
          'signers.$[signer].status': 'viewed',
          'signers.$[signer].viewedAt': new Date()
        }
      },
      {
        arrayFilters: [{ 'signer.candidateAccount': req.candidateAccount._id, 'signer.status': 'pending' }]
      }
    );

    await logOnboardingEvent({
      req,
      organization: onboarding.organization._id,
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'onboarding_viewed'
    });

    const refreshed = await CandidateOnboarding.findById(onboarding._id)
      .populate('candidate', 'firstName lastName email phone position status')
      .populate('organization', 'name logo')
      .populate('envelopes');
    res.json({ data: refreshed });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding', error: error.message });
  }
});

router.get('/documents/:id', candidateAuthMiddleware, async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      'documents.document': req.params.id,
      'signers.candidateAccount': req.candidateAccount._id
    })
      .populate('candidate', 'firstName lastName email phone position status')
      .populate('organization', 'name logo')
      .populate('onboarding', 'title status');

    if (!envelope) return res.status(404).json({ msg: 'Document not found' });

    const envelopeDocument = envelope.documents.find((doc) => doc.document.toString() === req.params.id);
    const signer = envelope.signers.find((item) =>
      item.role === 'candidate' &&
      item.candidateAccount?.toString() === req.candidateAccount._id.toString()
    );
    const activeStatuses = ['sent', 'viewed', 'partially_signed'];
    const canSign = Boolean(
      signer &&
      signer.status !== 'signed' &&
      activeStatuses.includes(envelope.status) &&
      canSignerAct(envelope, signer)
    );
    const downloadUrl = envelopeDocument?.signedPdf?.downloadUrl ||
      envelopeDocument?.signedPdf?.url ||
      envelopeDocument?.pdfSnapshot?.downloadUrl ||
      envelopeDocument?.pdfSnapshot?.url;

    if (signer && signer.status === 'pending' && activeStatuses.includes(envelope.status)) {
      signer.status = 'viewed';
      signer.viewedAt = new Date();
      if (envelope.status === 'sent') envelope.status = 'viewed';
      await envelope.save();
    }

    await logOnboardingEvent({
      req,
      organization: envelope.organization._id || envelope.organization,
      onboarding: envelope.onboarding._id || envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument?.document,
      candidate: envelope.candidate._id || envelope.candidate,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'document_opened'
    });

    res.json({
      data: {
        envelope,
        document: envelopeDocument,
        signer,
        canSign,
        downloadUrl
      }
    });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load document', error: error.message });
  }
});

router.post('/documents/:id/sign', candidateAuthMiddleware, async (req, res) => {
  try {
    if (!req.body.signatureDataUrl) {
      return res.status(400).json({ msg: 'Signature image is required' });
    }

    const envelope = await OnboardingEnvelope.findOne({
      'documents.document': req.params.id,
      'signers.candidateAccount': req.candidateAccount._id,
      status: { $in: ['sent', 'viewed', 'partially_signed'] }
    }).populate('candidate').populate('organization');

    if (!envelope) return res.status(404).json({ msg: 'Document not found or not available for signing' });

    const signer = envelope.signers.find((item) =>
      item.role === 'candidate' &&
      item.candidateAccount?.toString() === req.candidateAccount._id.toString()
    );
    if (!signer) return res.status(403).json({ msg: 'You are not a signer on this document' });
    if (signer.status === 'signed') return res.status(400).json({ msg: 'You have already signed this envelope' });
    if (!canSignerAct(envelope, signer)) {
      return res.status(400).json({ msg: 'Earlier signers must complete first' });
    }

    const envelopeDocument = envelope.documents.find((doc) => doc.document.toString() === req.params.id);
    if (!envelopeDocument) return res.status(404).json({ msg: 'Document not found' });

    const sourceUrl = envelopeDocument.signedPdf?.url || envelopeDocument.pdfSnapshot?.url;
    const signedAt = new Date();
    const stamped = await onboardingPdfService.stampSignedPdf({
      pdfUrl: sourceUrl,
      signatureFields: envelopeDocument.signatureFields,
      signer: {
        name: candidateName(envelope.candidate),
        email: req.candidateAccount.email
      },
      signerRole: 'candidate',
      signatureDataUrl: req.body.signatureDataUrl,
      signedAt,
      auditText: `Signed by ${req.candidateAccount.email} via Seemplify Candidate Portal`
    });

    envelopeDocument.signedPdf = await onboardingStorageService.uploadBuffer(stamped, {
      folder: 'onboarding/signed',
      fileName: `${envelopeDocument.title}-candidate-signed-${Date.now()}.pdf`
    });
    envelopeDocument.status = envelope.signers.some((item) => item.role === 'internal') ? 'signed' : 'completed';
    envelopeDocument.signedAt = signedAt;
    signer.status = 'signed';
    signer.signedAt = signedAt;

    const completed = await completeEnvelopeIfReady(envelope);
    await envelope.save();

    await logOnboardingEvent({
      req,
      organization: envelope.organization._id,
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument.document,
      candidate: envelope.candidate._id,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'candidate_signed',
      metadata: { completed }
    });

    if (completed) {
      const recipients = Array.from(new Set(envelope.signers.map((item) => item.email).filter(Boolean)));
      await Promise.all(recipients.map((recipientEmail) =>
        onboardingEmailService.sendEnvelopeCompleted({
          recipientEmail,
          organization: envelope.organization,
          envelope
        }).catch((error) => console.error('Failed to send completion email:', error))
      ));
    }

    res.json({ data: envelope });
  } catch (error) {
    console.error('Candidate document signing failed:', error);
    res.status(500).json({ msg: 'Failed to sign document', error: error.message });
  }
});

router.get('/documents/:id/download', candidateAuthMiddleware, async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      'documents.document': req.params.id,
      'signers.candidateAccount': req.candidateAccount._id
    });
    if (!envelope) return res.status(404).json({ msg: 'Document not found' });

    const envelopeDocument = envelope.documents.find((doc) => doc.document.toString() === req.params.id);
    const url = envelopeDocument?.signedPdf?.downloadUrl ||
      envelopeDocument?.signedPdf?.url ||
      envelopeDocument?.pdfSnapshot?.downloadUrl ||
      envelopeDocument?.pdfSnapshot?.url;
    if (!url) return res.status(404).json({ msg: 'No downloadable file found' });

    await logOnboardingEvent({
      req,
      organization: envelope.organization,
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument.document,
      candidate: envelope.candidate,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'document_downloaded'
    });

    res.redirect(url);
  } catch (error) {
    res.status(500).json({ msg: 'Failed to download document', error: error.message });
  }
});

module.exports = router;
