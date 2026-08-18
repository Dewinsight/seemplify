const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');

const candidateAuthMiddleware = require('../middleware/candidateAuthMiddleware');
const CandidateAccount = require('../models/CandidateAccount');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingDocument = require('../models/OnboardingDocument');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');
const onboardingPdfService = require('../services/onboardingPdfService');
const onboardingStorageService = require('../services/onboardingStorageService');
const onboardingEmailService = require('../services/onboardingEmailService');
const { logOnboardingEvent } = require('../services/onboardingAuditService');
const {
  markDocumentWorkflowComplete,
  saveCandidateFormSubmission,
  serializeOnboardingPlatform,
  tryCompleteOnboarding
} = require('../services/onboardingWorkflowService');
const { serializeSubmission } = require('../services/onboardingSecurityService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const CANDIDATE_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const CANDIDATE_PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const CANDIDATE_PASSWORD_RESET_RESPONSE = 'If a candidate account with that email exists, a password reset link has been sent.';

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
    .populate('organization', 'name logo')
    .populate('envelopes')
    .sort({ createdAt: -1 });
}

function canSignerAct(envelope, signer) {
  return !envelope.signers.some((item) => item.order < signer.order && item.status !== 'signed');
}

function safePdfFileName(title = 'onboarding-document') {
  return `${title || 'onboarding-document'}`
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'onboarding-document';
}

function documentPdfUrls(envelopeDocument) {
  return [
    envelopeDocument?.signedPdf?.url,
    envelopeDocument?.signedPdf?.downloadUrl,
    envelopeDocument?.pdfSnapshot?.url,
    envelopeDocument?.pdfSnapshot?.downloadUrl
  ].filter(Boolean);
}

function findEnvelopeDocumentByRouteId(envelope, routeId) {
  const normalizedRouteId = String(routeId);
  return envelope.documents.find((doc) => String(doc._id) === normalizedRouteId);
}

function candidateSignerForEnvelope(envelope, accountId) {
  return envelope.signers.find((item) =>
    item.role === 'candidate' &&
    item.candidateAccount?.toString() === accountId.toString()
  );
}

const ACTIVE_ENVELOPE_STATUSES = ['sent', 'viewed', 'partially_signed'];
const OPEN_DOCUMENT_STATUSES = ['pending'];

function fieldBelongsToCandidateSigner(field, signer) {
  if (!field) return false;
  if (signer?.key && field.signerKey) return field.signerKey === signer.key;
  return (field.role || 'candidate') === 'candidate';
}

function candidateFieldsForSigner(envelopeDocument, signer) {
  return (Array.isArray(envelopeDocument?.signatureFields) ? envelopeDocument.signatureFields : [])
    .filter((field) => fieldBelongsToCandidateSigner(field, signer));
}

function candidateDocumentActionType(envelopeDocument, signer) {
  const fields = candidateFieldsForSigner(envelopeDocument, signer);
  const signatureFields = fields.filter((field) => field.type === 'signature');
  if (signatureFields.length) return 'document_sign';
  if (fields.some((field) => ['text', 'image'].includes(field.type))) return 'document_fill';
  return null;
}

function isPendingCandidateDocument(envelopeDocument, signer) {
  return OPEN_DOCUMENT_STATUSES.includes(envelopeDocument?.status) &&
    Boolean(candidateDocumentActionType(envelopeDocument, signer));
}

function candidateTextValue(field, fieldValues = {}) {
  if (fieldValues[field.id] !== undefined) return fieldValues[field.id];
  if (field.key && fieldValues[field.key] !== undefined) return fieldValues[field.key];
  if (field.label && fieldValues[field.label] !== undefined) return fieldValues[field.label];
  return '';
}

function candidateTextFieldValues(envelopeDocument, signer, fieldValues = {}) {
  const textFields = candidateFieldsForSigner(envelopeDocument, signer)
    .filter((field) => field.type === 'text');
  const values = {};

  for (const field of textFields) {
    const value = String(candidateTextValue(field, fieldValues) ?? '');
    if (field.required !== false && !value.trim()) {
      return {
        error: `${field.label || 'Text field'} is required`,
        values: null
      };
    }

    const stampValue = value || ' ';
    values[field.id] = stampValue;
    if (field.key) values[field.key] = stampValue;
    if (field.label) values[field.label] = stampValue;
  }

  return { values, error: null };
}

function candidateImageFieldValues(envelopeDocument, signer, imageFieldValues = {}) {
  const imageFields = candidateFieldsForSigner(envelopeDocument, signer)
    .filter((field) => field.type === 'image');
  const values = {};

  for (const field of imageFields) {
    const value = imageFieldValues[field.id] ??
      (field.key ? imageFieldValues[field.key] : undefined) ??
      (field.label ? imageFieldValues[field.label] : undefined) ??
      '';
    if (field.required !== false && !String(value || '').trim()) {
      return {
        error: `${field.label || 'Image field'} is required`,
        values: null
      };
    }
    if (value && !String(value).match(/^data:image\/(png|jpeg|jpg);base64,/)) {
      return {
        error: `${field.label || 'Image field'} must be a PNG or JPG image`,
        values: null
      };
    }
    if (!value) continue;
    values[field.id] = value;
    if (field.key) values[field.key] = value;
    if (field.label) values[field.label] = value;
  }

  return { values, error: null };
}

function candidateDocumentPriority(envelope, signer) {
  const active = ACTIVE_ENVELOPE_STATUSES.includes(envelope.status);
  const canSign = Boolean(
    signer &&
    signer.status !== 'signed' &&
    active &&
    canSignerAct(envelope, signer)
  );

  if (canSign) return 3;
  if (active && signer && signer.status !== 'signed') return 2;
  if (active) return 1;
  return 0;
}

function findNextPendingCandidateDocumentId(envelope, currentEnvelopeDocument, signer) {
  const documents = Array.isArray(envelope?.documents) ? envelope.documents : [];
  const currentId = String(currentEnvelopeDocument?._id || '');
  const currentIndex = documents.findIndex((document) => String(document._id) === currentId);
  const orderedDocuments = currentIndex >= 0
    ? [...documents.slice(currentIndex + 1), ...documents.slice(0, currentIndex)]
    : documents;
  const nextDocument = orderedDocuments.find((document) => isPendingCandidateDocument(document, signer));
  return nextDocument?._id?.toString() || null;
}

async function ensureEnvelopeDocumentSnapshot(envelope, envelopeDocument) {
  if (documentPdfUrls(envelopeDocument).length > 0) {
    return;
  }

  const sourceDocument = await OnboardingDocument.findById(envelopeDocument.document);
  if (!sourceDocument) {
    throw new Error('Source onboarding document could not be found');
  }

  if (sourceDocument.pdfSnapshot?.url || sourceDocument.pdfSnapshot?.downloadUrl) {
    envelopeDocument.pdfSnapshot = sourceDocument.pdfSnapshot;
    await envelope.save();
    return;
  }

  if (sourceDocument.sourceType === 'uploaded_pdf' && (sourceDocument.originalFile?.url || sourceDocument.originalFile?.downloadUrl)) {
    envelopeDocument.pdfSnapshot = sourceDocument.originalFile;
    await envelope.save();
    return;
  }

  if (sourceDocument.sourceType === 'uploaded_docx') {
    throw new Error('Uploaded DOCX document is missing its preserved PDF snapshot. Re-upload as PDF or configure DOCX conversion.');
  }

  const buffer = await onboardingPdfService.renderBuilderDocumentToBuffer({
    title: sourceDocument.title || envelopeDocument.title,
    builderBlocks: sourceDocument.builderBlocks,
    variables: sourceDocument.variables || {}
  });
  envelopeDocument.pdfSnapshot = await onboardingStorageService.uploadBuffer(buffer, {
    folder: 'onboarding/envelopes',
    fileName: `${sourceDocument.title || envelopeDocument.title || 'onboarding-document'}-${Date.now()}.pdf`,
    mimeType: 'application/pdf',
    resourceType: 'raw'
  });
  await envelope.save();
}

async function loadEnvelopeDocumentPdfBuffer(envelope, envelopeDocument) {
  await ensureEnvelopeDocumentSnapshot(envelope, envelopeDocument);

  let lastDownloadError = null;
  for (const snapshot of [envelopeDocument?.signedPdf, envelopeDocument?.pdfSnapshot].filter(Boolean)) {
    try {
      return await onboardingStorageService.downloadBuffer(snapshot, {
        download: onboardingPdfService.downloadPdfBuffer
      });
    } catch (error) {
      lastDownloadError = error;
    }
  }

  throw lastDownloadError || new Error('No PDF snapshot is available for this document');
}

async function findCandidateEnvelopeDocument(req, routeId) {
  if (!mongoose.Types.ObjectId.isValid(routeId)) {
    return { envelope: null, envelopeDocument: null };
  }

  const documentMatch = {
    'documents._id': routeId
  };

  const envelopes = await OnboardingEnvelope.find({
    ...documentMatch,
    'signers.candidateAccount': req.candidateAccount._id
  })
    .populate('candidate', 'firstName lastName email phone position status')
    .populate('organization', 'name logo website idpOrganizationId')
    .sort({ createdAt: -1 });

  if (!envelopes.length) {
    return { envelope: null, envelopeDocument: null };
  }

  const ranked = envelopes
    .map((envelope) => ({
      envelope,
      envelopeDocument: findEnvelopeDocumentByRouteId(envelope, routeId),
      signer: candidateSignerForEnvelope(envelope, req.candidateAccount._id)
    }))
    .filter((item) => item.envelopeDocument)
    .sort((a, b) => {
      const priorityDelta = candidateDocumentPriority(b.envelope, b.signer) - candidateDocumentPriority(a.envelope, a.signer);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(b.envelope.createdAt || 0).getTime() - new Date(a.envelope.createdAt || 0).getTime();
    });

  if (!ranked.length) {
    return { envelope: null, envelopeDocument: null };
  }

  const { envelope, envelopeDocument } = ranked[0];
  return { envelope, envelopeDocument };
}

function sendPdf(res, buffer, { title, disposition = 'inline' } = {}) {
  const filename = safePdfFileName(title);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.send(buffer);
}

async function completeEnvelopeIfReady(envelope, req) {
  const allDocumentsComplete = envelope.documents.every((doc) => ['signed', 'completed'].includes(doc.status));
  const allSignersSigned = envelope.signers.every((signer) => signer.status === 'signed');

  if (allDocumentsComplete && allSignersSigned) {
    envelope.status = 'completed';
    envelope.completedAt = new Date();
    envelope.documents.forEach((doc) => {
      if (doc.status === 'signed') doc.status = 'completed';
    });
    await envelope.save();
    await markDocumentWorkflowComplete(envelope.onboarding, envelope._id);
    await tryCompleteOnboarding(envelope.onboarding, { req });
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

router.post('/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    return res.status(400).json({ msg: 'A valid email address is required' });
  }

  try {
    const account = await CandidateAccount.findOne({ email })
      .select('+passwordHash +resetPasswordRequestedAt');

    if (!account || !account.passwordHash || account.status === 'disabled') {
      return res.json({ msg: CANDIDATE_PASSWORD_RESET_RESPONSE });
    }

    const lastRequestedAt = account.resetPasswordRequestedAt?.getTime() || 0;
    if (Date.now() - lastRequestedAt < CANDIDATE_PASSWORD_RESET_COOLDOWN_MS) {
      return res.json({ msg: CANDIDATE_PASSWORD_RESET_RESPONSE });
    }

    const token = crypto.randomBytes(32).toString('hex');
    account.resetPasswordTokenHash = sha256(token);
    account.resetPasswordExpiresAt = new Date(Date.now() + CANDIDATE_PASSWORD_RESET_TTL_MS);
    account.resetPasswordRequestedAt = new Date();
    await account.save();

    try {
      await onboardingEmailService.sendCandidatePasswordReset({
        account,
        token,
        request: req
      });
    } catch (emailError) {
      console.error('Candidate password reset email failed:', emailError);
    }

    return res.json({ msg: CANDIDATE_PASSWORD_RESET_RESPONSE });
  } catch (error) {
    console.error('Candidate forgot password failed:', error);
    return res.status(500).json({ msg: 'Could not process the password reset request' });
  }
});

router.post('/auth/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || password.length < 8 || password.length > 128) {
    return res.status(400).json({ msg: 'A valid reset token and password between 8 and 128 characters are required' });
  }

  try {
    const account = await CandidateAccount.findOne({
      resetPasswordTokenHash: sha256(token),
      resetPasswordExpiresAt: { $gt: new Date() },
      status: { $ne: 'disabled' }
    }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt +resetPasswordRequestedAt');

    if (!account) {
      return res.status(400).json({ msg: 'This password reset link is invalid or has expired' });
    }

    account.passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    account.resetPasswordTokenHash = undefined;
    account.resetPasswordExpiresAt = undefined;
    account.resetPasswordRequestedAt = undefined;
    account.lastPasswordChangeAt = new Date();
    account.refreshTokenVersion += 1;
    account.status = 'active';
    await account.save();

    return res.json({ msg: 'Your candidate portal password has been reset successfully' });
  } catch (error) {
    console.error('Candidate reset password failed:', error);
    return res.status(500).json({ msg: 'Could not reset the candidate portal password' });
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

router.get(['/onboarding', '/transitions'], candidateAuthMiddleware, async (req, res) => {
  try {
    const onboardings = await findOnboardingsForAccount(req.candidateAccount);
    const data = await Promise.all(onboardings.map((onboarding) => serializeOnboardingPlatform(onboarding)));
    res.json({ data });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding records', error: error.message });
  }
});

router.get(['/onboarding/:id', '/transitions/:id'], candidateAuthMiddleware, async (req, res) => {
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
    res.json({ data: await serializeOnboardingPlatform(refreshed) });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding', error: error.message });
  }
});

async function findCandidateFormSubmission(req, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return OnboardingFormSubmission.findOne({
    _id: id,
    candidateAccount: req.candidateAccount._id
  });
}

async function serializeCandidateTransitionForAccount(req, onboardingId) {
  if (!onboardingId || !mongoose.Types.ObjectId.isValid(String(onboardingId))) return null;
  const onboarding = await CandidateOnboarding.findOne({
    _id: onboardingId,
    candidateAccount: req.candidateAccount._id
  })
    .populate('candidate', 'firstName lastName email phone position status')
    .populate('organization', 'name logo')
    .populate('envelopes');

  return onboarding ? serializeOnboardingPlatform(onboarding) : null;
}

async function serializeSubmissionResponse(req, submission) {
  return {
    data: serializeSubmission(submission),
    transition: await serializeCandidateTransitionForAccount(req, submission.onboarding)
  };
}

async function serializeEnvelopeTransition(req, envelope) {
  return serializeCandidateTransitionForAccount(req, envelope?.onboarding?._id || envelope?.onboarding);
}

router.get('/forms/:id', candidateAuthMiddleware, async (req, res) => {
  try {
    const submission = await findCandidateFormSubmission(req, req.params.id);
    if (!submission) return res.status(404).json({ msg: 'Onboarding form not found' });
    res.json(await serializeSubmissionResponse(req, submission));
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding form', error: error.message });
  }
});

router.post('/forms/:id/save', candidateAuthMiddleware, async (req, res) => {
  try {
    const submission = await findCandidateFormSubmission(req, req.params.id);
    if (!submission) return res.status(404).json({ msg: 'Onboarding form not found' });
    if (['approved', 'under_review'].includes(submission.status)) {
      return res.status(400).json({ msg: 'This onboarding form is already submitted for review' });
    }
    const saved = await saveCandidateFormSubmission({
      submission,
      values: req.body.values || {},
      submit: false,
      req
    });
    res.json(await serializeSubmissionResponse(req, saved));
  } catch (error) {
    res.status(error.statusCode || 500).json({ msg: error.message || 'Failed to save onboarding form' });
  }
});

router.post('/forms/:id/submit', candidateAuthMiddleware, async (req, res) => {
  try {
    const submission = await findCandidateFormSubmission(req, req.params.id);
    if (!submission) return res.status(404).json({ msg: 'Onboarding form not found' });
    if (['approved', 'under_review'].includes(submission.status)) {
      return res.status(400).json({ msg: 'This onboarding form is already submitted for review' });
    }
    const saved = await saveCandidateFormSubmission({
      submission,
      values: req.body.values || {},
      submit: true,
      req
    });
    res.json(await serializeSubmissionResponse(req, saved));
  } catch (error) {
    res.status(error.statusCode || 500).json({ msg: error.message || 'Failed to submit onboarding form' });
  }
});

router.post('/forms/:id/files', candidateAuthMiddleware, upload.single('file'), async (req, res) => {
  try {
    const submission = await findCandidateFormSubmission(req, req.params.id);
    if (!submission) return res.status(404).json({ msg: 'Onboarding form not found' });
    if (!req.file) return res.status(400).json({ msg: 'A file is required' });

    const fieldKey = req.body.fieldKey || req.body.key;
    const field = (submission.templateSnapshot?.fields || []).find((item) => item.key === fieldKey || item.id === fieldKey);
    if (!field) return res.status(400).json({ msg: 'A valid form field key is required' });
    if (field.type === 'image' && !String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({ msg: 'This field requires an image upload' });
    }
    if (field.sensitive) {
      return res.status(400).json({ msg: 'Sensitive file uploads require private storage before they can be accepted' });
    }

    const file = await onboardingStorageService.uploadBuffer(req.file.buffer, {
      folder: 'onboarding/forms',
      fileName: `${field.key}-${Date.now()}-${req.file.originalname}`,
      mimeType: req.file.mimetype,
      resourceType: field.type === 'image' ? 'image' : 'raw'
    });

    const existing = submission.values.find((value) => value.key === field.key);
    if (existing) {
      existing.files = [...(existing.files || []), file];
      existing.valuePreview = field.type === 'image' ? `${existing.files.length} image(s)` : `${existing.files.length} file(s)`;
      existing.updatedAt = new Date();
    }
    await submission.save();

    await logOnboardingEvent({
      req,
      organization: submission.organization,
      onboarding: submission.onboarding,
      candidate: submission.candidate,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'form_file_uploaded',
      metadata: {
        formSubmission: submission._id,
        fieldKey: field.key,
        fileName: req.file.originalname
      }
    });

    res.status(201).json({
      data: file,
      form: serializeSubmission(submission),
      transition: await serializeCandidateTransitionForAccount(req, submission.onboarding)
    });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to upload onboarding form file', error: error.message });
  }
});

router.get('/documents/:id', candidateAuthMiddleware, async (req, res) => {
  try {
    const { envelope, envelopeDocument } = await findCandidateEnvelopeDocument(req, req.params.id);
    if (!envelope) return res.status(404).json({ msg: 'Document not found' });

    const signer = candidateSignerForEnvelope(envelope, req.candidateAccount._id);
    const actionType = candidateDocumentActionType(envelopeDocument, signer);
    const canSign = Boolean(
      signer &&
      signer.status !== 'signed' &&
      isPendingCandidateDocument(envelopeDocument, signer) &&
      ACTIVE_ENVELOPE_STATUSES.includes(envelope.status) &&
      canSignerAct(envelope, signer)
    );
    const downloadUrl = envelopeDocument?.signedPdf?.downloadUrl ||
      envelopeDocument?.signedPdf?.url ||
      envelopeDocument?.pdfSnapshot?.downloadUrl ||
      envelopeDocument?.pdfSnapshot?.url;

    if (signer && signer.status === 'pending' && ACTIVE_ENVELOPE_STATUSES.includes(envelope.status)) {
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
        actionType,
        canCompleteFillOnly: canSign && actionType === 'document_fill',
        nextDocumentId: findNextPendingCandidateDocumentId(envelope, envelopeDocument, signer),
        downloadUrl
      },
      transition: await serializeEnvelopeTransition(req, envelope)
    });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load document', error: error.message });
  }
});

router.get('/documents/:id/preview', candidateAuthMiddleware, async (req, res) => {
  try {
    const { envelope, envelopeDocument } = await findCandidateEnvelopeDocument(req, req.params.id);
    if (!envelope || !envelopeDocument) return res.status(404).json({ msg: 'Document not found' });

    const buffer = await loadEnvelopeDocumentPdfBuffer(envelope, envelopeDocument);

    await logOnboardingEvent({
      req,
      organization: envelope.organization._id || envelope.organization,
      onboarding: envelope.onboarding._id || envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument.document,
      candidate: envelope.candidate._id || envelope.candidate,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'document_previewed'
    });

    sendPdf(res, buffer, { title: envelopeDocument.title, disposition: 'inline' });
  } catch (error) {
    console.error('Candidate document preview failed:', error);
    res.status(500).json({ msg: 'Failed to preview document', error: error.message });
  }
});

router.post('/documents/:id/sign', candidateAuthMiddleware, async (req, res) => {
  try {
    if (!req.body.signatureDataUrl) {
      return res.status(400).json({ msg: 'Signature image is required' });
    }

    const { envelope, envelopeDocument } = await findCandidateEnvelopeDocument(req, req.params.id);

    if (!envelope || !envelopeDocument || envelopeDocument.status !== 'pending' || !ACTIVE_ENVELOPE_STATUSES.includes(envelope.status)) {
      return res.status(404).json({ msg: 'Document not found or not available for signing' });
    }

    const signer = candidateSignerForEnvelope(envelope, req.candidateAccount._id);
    if (!signer) return res.status(403).json({ msg: 'You are not a signer on this document' });
    if (signer.status === 'signed') return res.status(400).json({ msg: 'You have already signed this envelope' });
    if (!isPendingCandidateDocument(envelopeDocument, signer)) {
      return res.status(400).json({ msg: 'This document is not waiting for candidate input' });
    }
    if (!canSignerAct(envelope, signer)) {
      return res.status(400).json({ msg: 'Earlier signers must complete first' });
    }

    const { values: textFieldValues, error: textFieldError } = candidateTextFieldValues(
      envelopeDocument,
      signer,
      req.body.fieldValues || {}
    );
    if (textFieldError) {
      return res.status(400).json({ msg: textFieldError });
    }
    const { values: imageFieldValues, error: imageFieldError } = candidateImageFieldValues(
      envelopeDocument,
      signer,
      req.body.imageFieldValues || {}
    );
    if (imageFieldError) {
      return res.status(400).json({ msg: imageFieldError });
    }

    const sourceBuffer = await loadEnvelopeDocumentPdfBuffer(envelope, envelopeDocument);
    const signedAt = new Date();
    const stamped = await onboardingPdfService.stampSignedPdf({
      pdfBuffer: sourceBuffer,
      signatureFields: envelopeDocument.signatureFields,
      signer: {
        name: candidateName(envelope.candidate),
        email: req.candidateAccount.email
      },
      signerRole: 'candidate',
      signerKey: signer.key,
      signatureDataUrl: req.body.signatureDataUrl,
      fieldValues: textFieldValues,
      imageFieldValues,
      signedAt,
      auditText: `Signed by ${req.candidateAccount.email} via Seemplify Candidate Portal`
    });

    envelopeDocument.signedPdf = await onboardingStorageService.uploadBuffer(stamped, {
      folder: 'onboarding/signed',
      fileName: `${envelopeDocument.title}-candidate-signed-${Date.now()}.pdf`
    });
    envelopeDocument.status = envelope.signers.some((item) => item.role === 'internal') ? 'signed' : 'completed';
    envelopeDocument.signedAt = signedAt;

    const nextDocumentId = findNextPendingCandidateDocumentId(envelope, envelopeDocument, signer);
    if (!nextDocumentId) {
      signer.status = 'signed';
      signer.signedAt = signedAt;
    }

    const completed = await completeEnvelopeIfReady(envelope, req);
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
      metadata: { signerKey: signer.key, completed }
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
    } else if (!nextDocumentId) {
      const readySigners = envelope.signers.filter((item) =>
        ['pending', 'viewed'].includes(item.status) &&
        canSignerAct(envelope, item)
      );
      await Promise.all(readySigners.map((item) =>
        onboardingEmailService.sendEnvelopeSignerNotification({
          signer: item,
          organization: envelope.organization,
          envelope
        }).catch((error) => console.error('Failed to send signer notification:', error))
      ));
    }

    res.json({
      data: envelope,
      nextDocumentId,
      transition: await serializeEnvelopeTransition(req, envelope)
    });
  } catch (error) {
    console.error('Candidate document signing failed:', error);
    res.status(500).json({ msg: 'Failed to sign document', error: error.message });
  }
});

router.post('/documents/:id/complete', candidateAuthMiddleware, async (req, res) => {
  try {
    const { envelope, envelopeDocument } = await findCandidateEnvelopeDocument(req, req.params.id);

    if (!envelope || !envelopeDocument || envelopeDocument.status !== 'pending' || !ACTIVE_ENVELOPE_STATUSES.includes(envelope.status)) {
      return res.status(404).json({ msg: 'Document not found or not available for completion' });
    }

    const signer = candidateSignerForEnvelope(envelope, req.candidateAccount._id);
    if (!signer) return res.status(403).json({ msg: 'You are not assigned to this document' });
    if (signer.status === 'signed') return res.status(400).json({ msg: 'You have already completed this envelope' });
    if (!isPendingCandidateDocument(envelopeDocument, signer)) {
      return res.status(400).json({ msg: 'This document is not waiting for candidate input' });
    }
    if (!canSignerAct(envelope, signer)) {
      return res.status(400).json({ msg: 'Earlier signers must complete first' });
    }
    if (candidateDocumentActionType(envelopeDocument, signer) !== 'document_fill') {
      return res.status(400).json({ msg: 'This document requires a signature' });
    }

    const { values: textFieldValues, error: textFieldError } = candidateTextFieldValues(
      envelopeDocument,
      signer,
      req.body.fieldValues || {}
    );
    if (textFieldError) {
      return res.status(400).json({ msg: textFieldError });
    }
    const { values: imageFieldValues, error: imageFieldError } = candidateImageFieldValues(
      envelopeDocument,
      signer,
      req.body.imageFieldValues || {}
    );
    if (imageFieldError) {
      return res.status(400).json({ msg: imageFieldError });
    }

    const sourceBuffer = await loadEnvelopeDocumentPdfBuffer(envelope, envelopeDocument);
    const completedAt = new Date();
    const stamped = await onboardingPdfService.stampSignedPdf({
      pdfBuffer: sourceBuffer,
      signatureFields: envelopeDocument.signatureFields,
      signer: {
        name: candidateName(envelope.candidate),
        email: req.candidateAccount.email
      },
      signerRole: 'candidate',
      signerKey: signer.key,
      signatureDataUrl: null,
      fieldValues: textFieldValues,
      imageFieldValues,
      signedAt: completedAt,
      auditText: `Completed by ${req.candidateAccount.email} via Seemplify Candidate Portal`
    });

    envelopeDocument.signedPdf = await onboardingStorageService.uploadBuffer(stamped, {
      folder: 'onboarding/signed',
      fileName: `${envelopeDocument.title}-candidate-completed-${Date.now()}.pdf`
    });
    envelopeDocument.status = envelope.signers.some((item) => item.role === 'internal') ? 'signed' : 'completed';
    envelopeDocument.signedAt = completedAt;

    const nextDocumentId = findNextPendingCandidateDocumentId(envelope, envelopeDocument, signer);
    if (!nextDocumentId) {
      signer.status = 'signed';
      signer.signedAt = completedAt;
    }

    const completed = await completeEnvelopeIfReady(envelope, req);
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
      action: 'candidate_document_completed',
      metadata: { signerKey: signer.key, completed }
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
    } else if (!nextDocumentId) {
      const readySigners = envelope.signers.filter((item) =>
        ['pending', 'viewed'].includes(item.status) &&
        canSignerAct(envelope, item)
      );
      await Promise.all(readySigners.map((item) =>
        onboardingEmailService.sendEnvelopeSignerNotification({
          signer: item,
          organization: envelope.organization,
          envelope
        }).catch((error) => console.error('Failed to send signer notification:', error))
      ));
    }

    res.json({
      data: envelope,
      nextDocumentId,
      transition: await serializeEnvelopeTransition(req, envelope)
    });
  } catch (error) {
    console.error('Candidate document completion failed:', error);
    res.status(500).json({ msg: 'Failed to complete document', error: error.message });
  }
});

router.get('/documents/:id/download', candidateAuthMiddleware, async (req, res) => {
  try {
    const { envelope, envelopeDocument } = await findCandidateEnvelopeDocument(req, req.params.id);
    if (!envelope || !envelopeDocument) return res.status(404).json({ msg: 'Document not found' });

    const buffer = await loadEnvelopeDocumentPdfBuffer(envelope, envelopeDocument);

    await logOnboardingEvent({
      req,
      organization: envelope.organization._id || envelope.organization,
      onboarding: envelope.onboarding._id || envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument.document,
      candidate: envelope.candidate._id || envelope.candidate,
      actorType: 'candidate',
      actorCandidateAccount: req.candidateAccount._id,
      actorEmail: req.candidateAccount.email,
      action: 'document_downloaded'
    });

    sendPdf(res, buffer, { title: envelopeDocument.title, disposition: 'attachment' });
  } catch (error) {
    console.error('Candidate document download failed:', error);
    res.status(500).json({ msg: 'Failed to download document', error: error.message });
  }
});

module.exports = router;
