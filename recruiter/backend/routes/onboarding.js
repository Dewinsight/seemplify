const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');

const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const Candidate = require('../models/Candidate');
const Organization = require('../models/Organization');
const User = require('../models/User');
const CandidateAccount = require('../models/CandidateAccount');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingDocumentTemplate = require('../models/OnboardingDocumentTemplate');
const OnboardingDocument = require('../models/OnboardingDocument');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');
const CloudinaryUploadService = require('../services/cloudinaryUploadService');
const onboardingStorageService = require('../services/onboardingStorageService');
const onboardingPdfService = require('../services/onboardingPdfService');
const onboardingEmailService = require('../services/onboardingEmailService');
const { logOnboardingEvent } = require('../services/onboardingAuditService');

const cloudinaryUploadService = new CloudinaryUploadService();

const uploadsDir = path.join(__dirname, '..', 'uploads', 'onboarding');
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `onboarding-${suffix}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PDF and DOCX files can be used for onboarding documents'));
    }
    cb(null, true);
  }
});

router.use(authMiddleware, requireOrganization);

function organizationId(req) {
  return req.user.currentOrganization;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  };
}

function candidateDisplayName(candidate) {
  return `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || candidate?.email || 'Candidate';
}

function systemVariables({ candidate, organization, user } = {}) {
  const recruiterName = user
    ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email
    : '';

  return {
    candidate: {
      name: candidateDisplayName(candidate),
      firstName: candidate?.firstName || '',
      lastName: candidate?.lastName || '',
      email: candidate?.email || '',
      phone: candidate?.phone || '',
      position: candidate?.position || ''
    },
    organization: {
      name: organization?.name || '',
      logo: organization?.logo || ''
    },
    recruiter: {
      name: recruiterName,
      email: user?.email || ''
    },
    today: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  };
}

function defaultSignatureFields(role = 'candidate') {
  return [
    {
      id: `sig-${role}-${Date.now()}`,
      role,
      type: 'signature',
      label: role === 'candidate' ? 'Candidate signature' : 'Internal signature',
      page: 1,
      x: 0.12,
      y: 0.78,
      width: 0.32,
      height: 0.08,
      required: true
    },
    {
      id: `date-${role}-${Date.now()}`,
      role,
      type: 'date',
      label: 'Date signed',
      page: 1,
      x: 0.52,
      y: 0.78,
      width: 0.22,
      height: 0.05,
      required: true
    }
  ];
}

function safeSignerKey(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function normalizeFieldNumber(value, fallback, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeSignatureFields(fields, signers = []) {
  const signerByKey = new Map(signers.filter((signer) => signer.key).map((signer) => [signer.key, signer]));

  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && field.id)
    .map((field) => {
      const signer = field.signerKey ? signerByKey.get(field.signerKey) : null;
      const role = signer?.role || (field.role === 'internal' ? 'internal' : 'candidate');
      const roleSigners = signers.filter((item) => item.role === role);
      const resolvedSigner = signer || (roleSigners.length === 1 ? roleSigners[0] : null);
      return {
        id: String(field.id),
        role,
        signerKey: resolvedSigner?.key || undefined,
        type: ['signature', 'date', 'name', 'email', 'text'].includes(field.type) ? field.type : 'signature',
        label: field.label || '',
        page: Math.max(1, Number(field.page || 1)),
        x: normalizeFieldNumber(field.x, 0.1),
        y: normalizeFieldNumber(field.y, 0.1),
        width: normalizeFieldNumber(field.width, 0.25, 0.01, 1),
        height: normalizeFieldNumber(field.height, 0.08, 0.01, 1),
        required: field.required !== false
      };
    });
}

function buildEnvelopeSigners(req, onboarding) {
  const requestedSigners = Array.isArray(req.body.signers) ? req.body.signers : [];
  const requestedCandidate = requestedSigners.find((signer) => signer?.role === 'candidate');
  const candidateSigner = {
    key: safeSignerKey(requestedCandidate?.key, 'candidate-primary'),
    role: 'candidate',
    name: requestedCandidate?.name || candidateDisplayName(onboarding.candidate),
    email: requestedCandidate?.email || onboarding.candidate.email,
    order: Number(requestedCandidate?.order || 1),
    candidateAccount: onboarding.candidateAccount,
    status: 'pending'
  };

  const internalSigners = requestedSigners
    .filter((signer) => signer?.role === 'internal' && signer.email)
    .map((signer, index) => ({
      key: safeSignerKey(signer.key, `internal-${index + 1}`),
      role: 'internal',
      name: signer.name || signer.email,
      email: signer.email,
      order: Number(signer.order || index + 2),
      user: req.user.id,
      status: 'pending'
    }));

  if (!internalSigners.length && req.body.internalSigner?.email) {
    internalSigners.push({
      key: 'internal-1',
      role: 'internal',
      name: req.body.internalSigner.name || req.body.internalSigner.email,
      email: req.body.internalSigner.email,
      order: 2,
      user: req.user.id,
      status: 'pending'
    });
  }

  const seen = new Set();
  return [candidateSigner, ...internalSigners]
    .map((signer, index) => ({
      ...signer,
      key: safeSignerKey(signer.key, `${signer.role}-${index + 1}`),
      order: Math.max(1, Number(signer.order || index + 1))
    }))
    .filter((signer) => {
      if (seen.has(signer.key)) return false;
      seen.add(signer.key);
      return Boolean(signer.email);
    })
    .sort((a, b) => a.order - b.order);
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

  if (envelope.signers.some((signer) => signer.status === 'signed')) {
    envelope.status = 'partially_signed';
  }
  return false;
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

async function loadEnvelopeDocumentPdfBuffer(envelopeDocument) {
  let lastDownloadError = null;
  for (const sourceUrl of documentPdfUrls(envelopeDocument)) {
    try {
      return await onboardingPdfService.downloadPdfBuffer(sourceUrl);
    } catch (error) {
      lastDownloadError = error;
    }
  }

  throw lastDownloadError || new Error('No PDF snapshot is available for this document');
}

function sendPdf(res, buffer, { title, disposition = 'inline' } = {}) {
  const filename = safePdfFileName(title);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.send(buffer);
}

async function notifyReadySigners({ envelope, organization, req, excludeKeys = [] }) {
  const excluded = new Set(excludeKeys.filter(Boolean));
  const readySigners = envelope.signers.filter((signer) =>
    ['pending', 'viewed'].includes(signer.status) &&
    !excluded.has(signer.key) &&
    canSignerAct(envelope, signer)
  );

  await Promise.all(readySigners.map((signer) =>
    onboardingEmailService.sendEnvelopeSignerNotification({ signer, organization, envelope, request: req })
      .catch((error) => console.error('Failed to send signer notification:', error))
  ));
  return readySigners;
}

function defaultBuilderBlocks(title = 'Onboarding document') {
  return [
    {
      id: 'heading-1',
      type: 'heading',
      content: { text: title }
    },
    {
      id: 'intro-1',
      type: 'text',
      content: {
        text: 'Hello {{candidate.firstName}},\n\nPlease review this onboarding document from {{organization.name}}.'
      }
    },
    {
      id: 'section-1',
      type: 'section',
      content: {
        title: 'Agreement',
        text: 'This document forms part of your candidate onboarding package. Please read the contents carefully before signing.'
      }
    },
    {
      id: 'signature-1',
      type: 'signature',
      content: { label: 'Candidate signature' }
    }
  ];
}

async function getOrganization(req) {
  return Organization.findById(organizationId(req));
}

async function getCurrentUser(req) {
  return User.findById(req.user.id);
}

async function findDocumentForOrg(req, id) {
  return OnboardingDocument.findOne({ _id: id, organization: organizationId(req) });
}

async function renderDocumentSnapshot(document, { candidate, organization, user, folder = 'onboarding/documents' } = {}) {
  if (document.sourceType === 'uploaded_pdf') {
    if (document.pdfSnapshot?.url || document.pdfSnapshot?.downloadUrl) {
      return document.pdfSnapshot;
    }
    if (document.originalFile?.url || document.originalFile?.downloadUrl) {
      return document.originalFile;
    }
  }

  const variables = {
    ...(document.variables || {}),
    ...systemVariables({ candidate, organization, user })
  };
  const buffer = await onboardingPdfService.renderBuilderDocumentToBuffer({
    title: document.title,
    builderBlocks: document.builderBlocks,
    variables
  });
  const snapshot = await onboardingStorageService.uploadBuffer(buffer, {
    folder,
    fileName: `${document.title || 'onboarding-document'}-${Date.now()}.pdf`,
    mimeType: 'application/pdf',
    resourceType: 'raw'
  });

  return snapshot;
}

async function ensureCandidateAccount(candidate, organization) {
  let account = await CandidateAccount.findOne({ email: candidate.email });
  if (!account) {
    account = new CandidateAccount({
      email: candidate.email,
      profile: {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        phone: candidate.phone
      },
      status: 'invited'
    });
  }

  account.linkCandidate(candidate._id, organization._id);
  await account.save();
  return account;
}

async function serializeOnboarding(onboarding) {
  return onboarding.populate([
    { path: 'candidate', select: 'firstName lastName email phone position status resumeUrl' },
    { path: 'candidateAccount', select: 'email profile status lastLoginAt' },
    { path: 'documents' },
    { path: 'envelopes' }
  ]);
}

router.get('/', async (req, res) => {
  try {
    const { status, search, candidateId } = req.query;
    const query = { organization: organizationId(req) };
    if (status && status !== 'all') query.status = status;
    if (candidateId) query.candidate = candidateId;

    const candidateFilter = search
      ? {
          $or: [
            { firstName: new RegExp(search, 'i') },
            { lastName: new RegExp(search, 'i') },
            { email: new RegExp(search, 'i') }
          ]
        }
      : null;

    if (!candidateId && candidateFilter) {
      const candidates = await Candidate.find({
        organization: organizationId(req),
        ...candidateFilter
      }).select('_id');
      query.candidate = { $in: candidates.map((candidate) => candidate._id) };
    }

    const onboardings = await CandidateOnboarding.find(query)
      .populate('candidate', 'firstName lastName email phone position status')
      .populate('candidateAccount', 'email profile status lastLoginAt')
      .populate('envelopes', 'title status sentAt completedAt')
      .sort({ createdAt: -1 })
      .limit(100);

    const recentEvents = await OnboardingAuditEvent.find({ organization: organizationId(req) })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ data: onboardings, recentEvents });
  } catch (error) {
    console.error('Get onboarding list failed:', error);
    res.status(500).json({ msg: 'Failed to load onboarding records', error: error.message });
  }
});

router.post('/candidates/:candidateId/start', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({
      _id: req.params.candidateId,
      organization: organizationId(req)
    });
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    const organization = await getOrganization(req);
    const account = await ensureCandidateAccount(candidate, organization);
    const invite = createInviteToken();
    const title = req.body.title || `${candidateDisplayName(candidate)} onboarding`;

    const onboarding = await CandidateOnboarding.create({
      organization: organizationId(req),
      candidate: candidate._id,
      candidateAccount: account._id,
      job: candidate.jobAppliedFor,
      title,
      notes: req.body.notes || '',
      startedBy: req.user.id,
      inviteTokenHash: invite.tokenHash,
      inviteTokenExpiresAt: invite.expiresAt
    });

    account.linkCandidate(candidate._id, organization._id);
    await account.save();

    const portalInviteUrl = await onboardingEmailService.sendCandidateInvite({
      candidate,
      organization,
      inviteToken: invite.token,
      onboarding,
      request: req
    }).catch((error) => {
      console.error('Failed to send onboarding invite email:', error);
      return onboardingEmailService.candidatePortalUrl(
        `/signup?token=${encodeURIComponent(invite.token)}`,
        { organization, request: req }
      );
    });

    onboarding.portalInviteUrl = portalInviteUrl;
    await onboarding.save();

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: onboarding._id,
      candidate: candidate._id,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: req.user.email,
      action: 'onboarding_started',
      metadata: { inviteEmail: candidate.email }
    });

    res.status(201).json({ data: await serializeOnboarding(onboarding), inviteUrl: portalInviteUrl });
  } catch (error) {
    console.error('Start onboarding failed:', error);
    res.status(500).json({ msg: 'Failed to start onboarding', error: error.message });
  }
});

router.get('/document-templates', async (req, res) => {
  try {
    const templates = await OnboardingDocumentTemplate.find({ organization: organizationId(req) })
      .sort({ isDefault: -1, name: 1 });
    res.json({ data: templates });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load document templates', error: error.message });
  }
});

router.post('/document-templates', async (req, res) => {
  try {
    const template = await OnboardingDocumentTemplate.create({
      organization: organizationId(req),
      name: req.body.name,
      description: req.body.description || '',
      category: req.body.category || 'custom',
      isDefault: !!req.body.isDefault,
      isSystem: false,
      builderBlocks: req.body.builderBlocks?.length ? req.body.builderBlocks : defaultBuilderBlocks(req.body.name),
      variables: req.body.variables || [],
      signatureFields: req.body.signatureFields?.length ? req.body.signatureFields : defaultSignatureFields('candidate'),
      createdBy: req.user.id
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      actorType: 'user',
      actorUser: req.user.id,
      action: 'template_created',
      metadata: { templateId: template._id, name: template.name }
    });

    res.status(201).json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to create document template', error: error.message });
  }
});

router.patch('/document-templates/:id', async (req, res) => {
  try {
    const template = await OnboardingDocumentTemplate.findOneAndUpdate(
      { _id: req.params.id, organization: organizationId(req) },
      {
        $set: {
          name: req.body.name,
          description: req.body.description || '',
          category: req.body.category || 'custom',
          isDefault: !!req.body.isDefault,
          builderBlocks: req.body.builderBlocks || [],
          variables: req.body.variables || [],
          signatureFields: req.body.signatureFields || [],
          updatedBy: req.user.id
        }
      },
      { new: true }
    );

    if (!template) return res.status(404).json({ msg: 'Document template not found' });
    res.json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to update document template', error: error.message });
  }
});

router.delete('/document-templates/:id', async (req, res) => {
  try {
    const template = await OnboardingDocumentTemplate.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!template) return res.status(404).json({ msg: 'Document template not found' });
    if (template.isSystem) return res.status(400).json({ msg: 'System templates cannot be deleted' });

    await template.deleteOne();
    res.json({ msg: 'Document template deleted' });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to delete document template', error: error.message });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const documents = await OnboardingDocument.find({ organization: organizationId(req) })
      .sort({ updatedAt: -1 })
      .limit(200);
    res.json({ data: documents });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load documents', error: error.message });
  }
});

router.post('/documents', async (req, res) => {
  try {
    let template = null;
    if (req.body.templateId) {
      template = await OnboardingDocumentTemplate.findOne({
        _id: req.body.templateId,
        organization: organizationId(req)
      });
      if (!template) return res.status(404).json({ msg: 'Template not found' });
    }

    const title = req.body.title || template?.name || 'Untitled onboarding document';
    const document = await OnboardingDocument.create({
      organization: organizationId(req),
      template: template?._id,
      title,
      description: req.body.description || template?.description || '',
      sourceType: 'builder',
      builderBlocks: req.body.builderBlocks?.length ? req.body.builderBlocks : template?.builderBlocks || defaultBuilderBlocks(title),
      variables: req.body.variables || {},
      signatureFields: req.body.signatureFields?.length ? req.body.signatureFields : template?.signatureFields || defaultSignatureFields('candidate'),
      createdBy: req.user.id
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      document: document._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'document_created',
      metadata: { title: document.title }
    });

    res.status(201).json({ data: document });
  } catch (error) {
    console.error('Create onboarding document failed:', error);
    res.status(500).json({ msg: 'Failed to create document', error: error.message });
  }
});

router.post('/documents/upload', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: 'No document uploaded' });
  }

  try {
    const title = req.body.title || path.basename(req.file.originalname, path.extname(req.file.originalname));
    let sourceType = 'uploaded_pdf';
    let originalFile = null;
    let pdfSnapshot = null;
    let builderBlocks = [];

    if (req.file.mimetype === 'application/pdf') {
      const uploadResult = await cloudinaryUploadService.uploadFile(req.file.path, req.file.mimetype);
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'PDF upload failed');
      }
      originalFile = {
        url: uploadResult.resumeUrl,
        downloadUrl: cloudinaryUploadService.getDownloadUrl(uploadResult.publicId),
        publicId: uploadResult.publicId,
        resourceType: uploadResult.resourceType,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        renderedAt: new Date()
      };
      pdfSnapshot = originalFile;
    } else {
      sourceType = 'uploaded_docx';
      const extracted = await mammoth.extractRawText({ path: req.file.path });
      builderBlocks = [
        { id: 'heading-upload', type: 'heading', content: { text: title } },
        { id: 'text-upload', type: 'text', content: { text: extracted.value || '' } },
        { id: 'signature-upload', type: 'signature', content: { label: 'Candidate signature' } }
      ];
      const buffer = await onboardingPdfService.renderBuilderDocumentToBuffer({
        title,
        builderBlocks,
        variables: {}
      });
      pdfSnapshot = await onboardingStorageService.uploadBuffer(buffer, {
        folder: 'onboarding/documents',
        fileName: `${title}-${Date.now()}.pdf`,
        mimeType: 'application/pdf'
      });
      originalFile = {
        url: '',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        bytes: req.file.size,
        renderedAt: new Date()
      };
    }

    const document = await OnboardingDocument.create({
      organization: organizationId(req),
      title,
      description: req.body.description || '',
      sourceType,
      status: pdfSnapshot?.url ? 'ready' : 'draft',
      builderBlocks,
      originalFile,
      pdfSnapshot,
      signatureFields: defaultSignatureFields('candidate'),
      createdBy: req.user.id
    });

    await fs.unlink(req.file.path).catch(() => {});
    res.status(201).json({ data: document });
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    console.error('Upload onboarding document failed:', error);
    res.status(500).json({ msg: 'Failed to upload onboarding document', error: error.message });
  }
});

router.get('/documents/:id', async (req, res) => {
  try {
    const document = await findDocumentForOrg(req, req.params.id);
    if (!document) return res.status(404).json({ msg: 'Document not found' });
    res.json({ data: document });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load document', error: error.message });
  }
});

router.patch('/documents/:id', async (req, res) => {
  try {
    const document = await findDocumentForOrg(req, req.params.id);
    if (!document) return res.status(404).json({ msg: 'Document not found' });
    if (document.lockedAt || document.status === 'sent') {
      return res.status(400).json({ msg: 'Sent documents are immutable. Duplicate the document to make changes.' });
    }

    [
      'title',
      'description',
      'builderBlocks',
      'variables',
      'signatureFields'
    ].forEach((field) => {
      if (req.body[field] !== undefined) document[field] = req.body[field];
    });
    document.updatedBy = req.user.id;
    document.status = document.pdfSnapshot?.url ? 'ready' : 'draft';
    await document.save();

    res.json({ data: document });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to update document', error: error.message });
  }
});

router.post('/documents/:id/render', async (req, res) => {
  try {
    const document = await findDocumentForOrg(req, req.params.id);
    if (!document) return res.status(404).json({ msg: 'Document not found' });
    if (document.lockedAt || document.status === 'sent') {
      return res.status(400).json({ msg: 'Sent documents are immutable' });
    }

    const snapshot = await renderDocumentSnapshot(document, {
      organization: await getOrganization(req),
      user: await getCurrentUser(req),
      folder: 'onboarding/documents'
    });

    document.pdfSnapshot = snapshot;
    document.status = 'ready';
    document.updatedBy = req.user.id;
    await document.save();

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      document: document._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'document_rendered'
    });

    res.json({ data: document });
  } catch (error) {
    console.error('Render document failed:', error);
    res.status(500).json({ msg: 'Failed to render document', error: error.message });
  }
});

router.get('/documents/:id/preview', async (req, res) => {
  try {
    const document = await findDocumentForOrg(req, req.params.id);
    if (!document) return res.status(404).json({ msg: 'Document not found' });

    if (!document.pdfSnapshot?.url && !document.pdfSnapshot?.downloadUrl) {
      if (document.lockedAt || document.status === 'sent') {
        return res.status(404).json({ msg: 'No PDF snapshot is available for this document' });
      }

      const snapshot = await renderDocumentSnapshot(document, {
        organization: await getOrganization(req),
        user: await getCurrentUser(req),
        folder: 'onboarding/documents'
      });

      document.pdfSnapshot = snapshot;
      document.status = 'ready';
      document.updatedBy = req.user.id;
      await document.save();
    }

    const sourceUrls = [document.pdfSnapshot.url, document.pdfSnapshot.downloadUrl].filter(Boolean);
    let buffer = null;
    let lastDownloadError = null;
    for (const sourceUrl of sourceUrls) {
      try {
        buffer = await onboardingPdfService.downloadPdfBuffer(sourceUrl);
        break;
      } catch (error) {
        lastDownloadError = error;
      }
    }
    if (!buffer) throw lastDownloadError || new Error('PDF snapshot URL is missing');
    const filename = `${document.title || 'onboarding-document'}`.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'onboarding-document';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  } catch (error) {
    console.error('Preview document failed:', error);
    res.status(500).json({ msg: 'Failed to preview document', error: error.message });
  }
});

router.post('/envelopes', async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.body.onboardingId,
      organization: organizationId(req)
    }).populate('candidate');
    if (!onboarding) return res.status(404).json({ msg: 'Onboarding not found' });

    const documentIds = Array.isArray(req.body.documentIds) ? req.body.documentIds : [];
    if (documentIds.length === 0) {
      return res.status(400).json({ msg: 'At least one document is required' });
    }

    const [organization, user] = await Promise.all([getOrganization(req), getCurrentUser(req)]);
    const documents = await OnboardingDocument.find({
      _id: { $in: documentIds },
      organization: organizationId(req)
    });
    if (documents.length !== documentIds.length) {
      return res.status(400).json({ msg: 'One or more documents could not be found' });
    }

    const signers = buildEnvelopeSigners(req, onboarding);
    const documentFields = req.body.documentFields && typeof req.body.documentFields === 'object'
      ? req.body.documentFields
      : {};

    const envelopeDocuments = [];
    for (const document of documents) {
      const snapshot = await renderDocumentSnapshot(document, {
        candidate: onboarding.candidate,
        organization,
        user,
        folder: 'onboarding/envelopes'
      });
      const fieldOverride = documentFields[document._id.toString()];
      const signatureFields = normalizeSignatureFields(
        Array.isArray(fieldOverride) && fieldOverride.length
          ? fieldOverride
          : document.signatureFields?.length
            ? document.signatureFields
            : defaultSignatureFields('candidate'),
        signers
      );
      envelopeDocuments.push({
        document: document._id,
        title: document.title,
        status: 'pending',
        pdfSnapshot: snapshot,
        signatureFields
      });
    }

    const envelope = await OnboardingEnvelope.create({
      organization: organizationId(req),
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      title: req.body.title || `${onboarding.title} documents`,
      message: req.body.message || '',
      documents: envelopeDocuments,
      signers,
      createdBy: req.user.id
    });

    onboarding.documents = Array.from(new Set([...(onboarding.documents || []), ...documents.map((doc) => doc._id)]));
    onboarding.envelopes = Array.from(new Set([...(onboarding.envelopes || []), envelope._id]));
    await onboarding.save();

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: onboarding._id,
      envelope: envelope._id,
      candidate: onboarding.candidate._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'envelope_created',
      metadata: { documentCount: envelopeDocuments.length }
    });

    res.status(201).json({ data: await envelope.populate('documents.document') });
  } catch (error) {
    console.error('Create envelope failed:', error);
    res.status(500).json({ msg: 'Failed to create envelope', error: error.message });
  }
});

router.post('/envelopes/:id/send', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    }).populate('candidate');
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });
    if (envelope.status !== 'draft') {
      return res.status(400).json({ msg: 'Only draft envelopes can be sent' });
    }

    envelope.status = 'sent';
    envelope.sentAt = new Date();
    await envelope.save();

    const documentIds = envelope.documents.map((doc) => doc.document);
    await OnboardingDocument.updateMany(
      { _id: { $in: documentIds }, organization: organizationId(req) },
      { $set: { status: 'sent', lockedAt: new Date() } }
    );
    await CandidateOnboarding.findByIdAndUpdate(envelope.onboarding, { status: 'in_progress' });

    const organization = await getOrganization(req);
    await onboardingEmailService.sendEnvelopeNotification({
      candidate: envelope.candidate,
      organization,
      envelope,
      request: req
    }).catch((error) => console.error('Failed to send envelope email:', error));
    const readySigners = await notifyReadySigners({
      envelope,
      organization,
      req,
      excludeKeys: envelope.signers.filter((signer) => signer.role === 'candidate').map((signer) => signer.key)
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      candidate: envelope.candidate._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'envelope_sent',
      metadata: { readySigners: readySigners.map((signer) => signer.email) }
    });

    res.json({ data: envelope });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to send envelope', error: error.message });
  }
});

router.post('/envelopes/:id/remind', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    const organization = await getOrganization(req);
    const pendingSigners = envelope.signers.filter((signer) => ['pending', 'viewed'].includes(signer.status));
    await Promise.all(pendingSigners.map(async (signer) => {
      signer.lastReminderAt = new Date();
      await onboardingEmailService.sendEnvelopeReminder({ signer, organization, envelope, request: req })
        .catch((error) => console.error('Failed to send reminder:', error));
    }));
    await envelope.save();

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'reminder_sent',
      metadata: { recipients: pendingSigners.map((signer) => signer.email) }
    });

    res.json({ data: envelope, reminded: pendingSigners.length });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to send reminder', error: error.message });
  }
});

router.post('/envelopes/:id/void', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    envelope.status = 'voided';
    envelope.voidedAt = new Date();
    envelope.voidReason = req.body.reason || '';
    envelope.documents.forEach((doc) => { doc.status = 'voided'; });
    await envelope.save();

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'envelope_voided',
      metadata: { reason: envelope.voidReason }
    });

    res.json({ data: envelope });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to void envelope', error: error.message });
  }
});

router.get('/envelopes/:id/documents/:documentId/preview', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    const envelopeDocument = envelope.documents.id(req.params.documentId) ||
      envelope.documents.find((doc) => doc.document.toString() === req.params.documentId);
    if (!envelopeDocument) return res.status(404).json({ msg: 'Envelope document not found' });

    const buffer = await loadEnvelopeDocumentPdfBuffer(envelopeDocument);

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      document: envelopeDocument.document,
      candidate: envelope.candidate,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'internal_document_previewed'
    });

    sendPdf(res, buffer, { title: envelopeDocument.title, disposition: 'inline' });
  } catch (error) {
    console.error('Envelope document preview failed:', error);
    res.status(500).json({ msg: 'Failed to preview envelope document', error: error.message });
  }
});

router.post('/envelopes/:id/countersign', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    const requestedSignerKey = req.body.signerKey ? String(req.body.signerKey) : '';
    const signer = envelope.signers.find((item) =>
      item.role === 'internal' &&
      ['pending', 'viewed'].includes(item.status) &&
      (!requestedSignerKey || item.key === requestedSignerKey)
    );
    if (!signer) return res.status(400).json({ msg: 'No internal signer is pending' });

    if (!canSignerAct(envelope, signer)) {
      return res.status(400).json({ msg: 'Earlier signers must complete first' });
    }

    const user = await getCurrentUser(req);
    const signerInfo = {
      name: signer.name || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email,
      email: signer.email || user.email
    };

    for (const envelopeDocument of envelope.documents) {
      const sourceUrl = envelopeDocument.signedPdf?.url ||
        envelopeDocument.signedPdf?.downloadUrl ||
        envelopeDocument.pdfSnapshot?.url ||
        envelopeDocument.pdfSnapshot?.downloadUrl;
      const stamped = await onboardingPdfService.stampSignedPdf({
        pdfUrl: sourceUrl,
        signatureFields: envelopeDocument.signatureFields,
        signer: signerInfo,
        signerRole: 'internal',
        signerKey: signer.key,
        signatureDataUrl: req.body.signatureDataUrl,
        signedAt: new Date(),
        auditText: `Countersigned by ${signerInfo.email} via Seemplify Recruiter`
      });
      envelopeDocument.signedPdf = await onboardingStorageService.uploadBuffer(stamped, {
        folder: 'onboarding/signed',
        fileName: `${envelopeDocument.title}-countersigned-${Date.now()}.pdf`
      });
      envelopeDocument.status = envelope.signers.every((item) => String(item._id) === String(signer._id) || item.status === 'signed')
        ? 'completed'
        : 'signed';
      envelopeDocument.signedAt = new Date();
    }

    signer.status = 'signed';
    signer.signedAt = new Date();
    const completed = await completeEnvelopeIfReady(envelope);
    await envelope.save();
    const organization = await getOrganization(req);
    let notifiedSigners = [];
    if (completed) {
      const recipients = Array.from(new Set(envelope.signers.map((item) => item.email).filter(Boolean)));
      await Promise.all(recipients.map((recipientEmail) =>
        onboardingEmailService.sendEnvelopeCompleted({
          recipientEmail,
          organization,
          envelope,
          request: req
        }).catch((error) => console.error('Failed to send completion email:', error))
      ));
    } else {
      notifiedSigners = await notifyReadySigners({
        envelope,
        organization,
        req,
        excludeKeys: [signer.key]
      });
    }

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: signerInfo.email,
      action: 'internal_signed',
      metadata: { signerKey: signer.key, completed, readySigners: notifiedSigners.map((item) => item.email) }
    });

    res.json({ data: envelope });
  } catch (error) {
    console.error('Countersign failed:', error);
    res.status(500).json({ msg: 'Failed to countersign envelope', error: error.message });
  }
});

router.get('/envelopes/:id/audit', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    const events = await OnboardingAuditEvent.find({
      envelope: envelope._id,
      organization: organizationId(req)
    }).sort({ createdAt: 1 });
    res.json({ data: events });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load audit trail', error: error.message });
  }
});

router.get('/envelopes/:id/download', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });

    const files = envelope.documents.map((doc) => ({
      title: doc.title,
      status: doc.status,
      url: doc.signedPdf?.downloadUrl || doc.signedPdf?.url || doc.pdfSnapshot?.downloadUrl || doc.pdfSnapshot?.url
    })).filter((file) => file.url);

    if (files.length === 1) {
      return res.redirect(files[0].url);
    }

    res.json({ data: files });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to download envelope documents', error: error.message });
  }
});

router.get('/envelopes/:id', async (req, res) => {
  try {
    const envelope = await OnboardingEnvelope.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    }).populate('candidate', 'firstName lastName email phone position')
      .populate('documents.document');
    if (!envelope) return res.status(404).json({ msg: 'Envelope not found' });
    res.json({ data: envelope });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load envelope', error: error.message });
  }
});

router.get('/:onboardingId', async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.params.onboardingId,
      organization: organizationId(req)
    });
    if (!onboarding) return res.status(404).json({ msg: 'Onboarding not found' });

    const populated = await serializeOnboarding(onboarding);
    const events = await OnboardingAuditEvent.find({
      onboarding: onboarding._id,
      organization: organizationId(req)
    }).sort({ createdAt: -1 }).limit(100);

    res.json({ data: populated, events });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding', error: error.message });
  }
});

module.exports = router;
