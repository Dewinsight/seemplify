const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const Candidate = require('../models/Candidate');
const Organization = require('../models/Organization');
const User = require('../models/User');
const CandidateAccount = require('../models/CandidateAccount');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingApproval = require('../models/OnboardingApproval');
const OnboardingDocumentTemplate = require('../models/OnboardingDocumentTemplate');
const OnboardingDocument = require('../models/OnboardingDocument');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingFormTemplate = require('../models/OnboardingFormTemplate');
const OnboardingHandoff = require('../models/OnboardingHandoff');
const OnboardingTemplate = require('../models/OnboardingTemplate');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const CloudinaryUploadService = require('../services/cloudinaryUploadService');
const onboardingStorageService = require('../services/onboardingStorageService');
const onboardingPdfService = require('../services/onboardingPdfService');
const onboardingEmailService = require('../services/onboardingEmailService');
const documentConversionService = require('../services/documentConversionService');
const { logOnboardingEvent } = require('../services/onboardingAuditService');
const {
  attachEnvelopeToWorkflow,
  createPeopleTransitionNotifications,
  defaultFormFields,
  defaultWorkflowItemDefinitions,
  ensureDefaultFormTemplate,
  initializeDefaultWorkflow,
  markDocumentWorkflowComplete,
  markDocumentWorkflowInProgress,
  normalizeProcessType,
  processCopy,
  refreshBlockedWorkflowItems,
  reviewFormSubmission,
  serializeWorkflowItem,
  serializeOnboardingPlatform,
  tryCompleteOnboarding,
  updateProgress
} = require('../services/onboardingWorkflowService');
const { serializeSubmission } = require('../services/onboardingSecurityService');

const cloudinaryUploadService = new CloudinaryUploadService();
const ACTIVE_SIGNING_ENVELOPE_STATUSES = ['sent', 'viewed', 'partially_signed'];
const VIEWABLE_SIGNING_ENVELOPE_STATUSES = [...ACTIVE_SIGNING_ENVELOPE_STATUSES, 'completed'];
const SIGNABLE_DOCUMENT_STATUSES = ['pending', 'signed'];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

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
  return req.activeOrganization || req.user.currentOrganization;
}

function candidateDisplayName(candidate) {
  return `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || candidate?.email || 'Candidate';
}

function processTypeFromRequest(req) {
  return normalizeProcessType(req.body?.processType || req.query?.processType);
}

function processTypeFilter(processType, field = 'processType') {
  const normalized = processType === 'all' ? 'all' : normalizeProcessType(processType);
  if (normalized === 'all') return {};
  if (normalized === 'onboarding') {
    return {
      $or: [
        { [field]: 'onboarding' },
        { [field]: { $exists: false } },
        { [field]: null }
      ]
    };
  }
  return { [field]: normalized };
}

function processTypeQueryFromRequest(req) {
  const value = req.query?.processType || 'all';
  return value === 'all' ? 'all' : normalizeProcessType(value);
}

function normalizeComplianceDocuments(documents = []) {
  return (Array.isArray(documents) ? documents : [])
    .map((document, index) => {
      const name = String(document?.name || document?.title || '').trim().slice(0, 160);
      const expiresAtValue = document?.expiresAt || document?.expiryDate || document?.dueAt;
      const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
      if (!name || !expiresAt || Number.isNaN(expiresAt.getTime())) return null;
      return {
        name,
        expiresAt,
        notes: String(document?.notes || '').trim().slice(0, 1000),
        order: Number.isFinite(Number(document?.order)) ? Number(document.order) : (index + 1) * 10
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

async function createComplianceWorkflowItems({ req, onboarding, documents }) {
  if (!documents.length) return [];
  const insertedItems = await OnboardingWorkflowItem.insertMany(documents.map((document, index) => ({
    organization: onboarding.organization,
    onboarding: onboarding._id,
    type: 'task',
    title: document.name,
    description: document.notes || `Renew ${document.name} before it expires.`,
    status: 'pending',
    ownerType: 'candidate',
    required: true,
    sourceType: 'manual',
    order: document.order || (index + 1) * 10,
    dueAt: document.expiresAt,
    metadata: {
      complianceDocument: true,
      documentName: document.name,
      expiresAt: document.expiresAt,
      renewalAlert: true
    }
  })));

  await CandidateOnboarding.findByIdAndUpdate(onboarding._id, {
    $addToSet: {
      workflowItems: { $each: insertedItems.map((item) => item._id) }
    },
    complianceDocuments: insertedItems.map((item, index) => ({
      name: documents[index].name,
      expiresAt: documents[index].expiresAt,
      notes: documents[index].notes,
      workflowItem: item._id
    })),
    templateSnapshot: {
      name: 'Compliance document renewals',
      processType: 'compliance_documents',
      workflowItems: insertedItems.map((item) => ({
        id: item._id,
        type: item.type,
        title: item.title,
        ownerType: item.ownerType,
        dueAt: item.dueAt,
        required: item.required,
        order: item.order,
        metadata: item.metadata
      })),
      capturedAt: new Date()
    }
  });

  await updateProgress(onboarding._id);
  await logOnboardingEvent({
    req,
    organization: onboarding.organization,
    onboarding: onboarding._id,
    candidate: onboarding.candidate,
    actorType: 'system',
    action: 'compliance_documents_initialized',
    metadata: {
      workflowItems: insertedItems.length,
      documentNames: documents.map((document) => document.name)
    }
  });

  return insertedItems;
}

async function ensureSystemPacketTemplates({ organization, userId }) {
  const processTypes = ['onboarding', 'exit', 'retirement'];
  for (const processType of processTypes) {
    const copy = processCopy(processType);
    const formTemplate = await ensureDefaultFormTemplate({ organization, userId, processType });
    const existing = await OnboardingTemplate.findOne({
      organization,
      isSystem: true,
      ...processTypeFilter(processType),
      status: 'active'
    });
    if (existing) {
      existing.name = existing.name || `Default ${copy.label.toLowerCase()} packet`;
      existing.description = `${copy.label} workflow with process-specific forms, documents, reviews, and closeout tasks.`;
      existing.category = processType;
      existing.processType = processType;
      existing.formTemplates = existing.formTemplates?.length ? existing.formTemplates : [formTemplate._id];
      existing.workflowItems = defaultWorkflowItemDefinitions(processType);
      existing.updatedBy = userId;
      await existing.save();
      continue;
    }

    await OnboardingTemplate.create({
      organization,
      name: `Default ${copy.label.toLowerCase()} packet`,
      description: `${copy.label} workflow with process-specific forms, documents, reviews, and closeout tasks.`,
      category: processType,
      processType,
      isSystem: true,
      formTemplates: [formTemplate._id],
      workflowItems: defaultWorkflowItemDefinitions(processType),
      createdBy: userId
    });
  }
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
  const labelPrefix = role === 'candidate'
    ? 'Candidate'
    : role === 'external'
      ? 'External signer'
      : 'Internal signer';
  return [
    {
      id: `sig-${role}-${Date.now()}`,
      role,
      type: 'signature',
      label: `${labelPrefix} signature`,
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
  const validRoles = new Set(['candidate', 'internal', 'external']);

  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && field.id)
    .map((field) => {
      const type = ['signature', 'date', 'name', 'email', 'text', 'image'].includes(field.type) ? field.type : 'signature';
      const signer = field.signerKey ? signerByKey.get(field.signerKey) : null;
      const requestedRole = validRoles.has(field.role) ? field.role : 'candidate';
      const role = signer?.role || requestedRole;
      const roleSigners = signers.filter((item) => item.role === role);
      const resolvedSigner = signer || (roleSigners.length === 1 ? roleSigners[0] : null);
      return {
        id: String(field.id),
        role,
        signerKey: resolvedSigner?.key || undefined,
        type,
        label: field.label || '',
        placeholder: ['text', 'image'].includes(type) ? String(field.placeholder || '') : '',
        multiline: field.type === 'text' ? Boolean(field.multiline) : false,
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

function buildTeamSigningSigners(req) {
  const requestedSigners = Array.isArray(req.body.signers) ? req.body.signers : [];
  const allowedRoles = new Set(['internal', 'external']);
  const signers = requestedSigners
    .filter((signer) => signer && allowedRoles.has(signer.role) && signer.email)
    .map((signer, index) => ({
      key: safeSignerKey(signer.key, `${signer.role}-${index + 1}`),
      role: signer.role,
      name: String(signer.name || signer.email || '').trim(),
      email: String(signer.email || '').trim().toLowerCase(),
      order: Math.max(1, Number(signer.order || index + 1)),
      status: 'pending'
    }));

  const seenKeys = new Set();
  const seenEmailsByRole = new Set();
  const normalized = signers
    .filter((signer) => {
      const emailKey = `${signer.role}:${signer.email}`;
      if (seenEmailsByRole.has(emailKey) || seenKeys.has(signer.key)) return false;
      seenEmailsByRole.add(emailKey);
      seenKeys.add(signer.key);
      return Boolean(signer.email);
    })
    .sort((a, b) => a.order - b.order)
    .map((signer, index) => ({
      ...signer,
      order: Math.max(1, Number(signer.order || index + 1))
    }));

  if (!normalized.length) {
    const error = new Error('At least one internal or external signer is required');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
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
    if (envelope.contextType !== 'team_signing' && envelope.onboarding) {
      await markDocumentWorkflowComplete(envelope.onboarding, envelope._id);
      await tryCompleteOnboarding(envelope.onboarding, { req });
    }
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

function signerMatchesUser(signer, user, requestUser, roles = ['internal']) {
  const userEmail = String(user?.email || requestUser?.email || '').trim().toLowerCase();
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return allowedRoles.includes(signer?.role) &&
    userEmail &&
    String(signer.email || '').trim().toLowerCase() === userEmail;
}

function signerIsPending(signer) {
  return ['pending', 'viewed'].includes(signer?.status);
}

function signerIsSigned(signer) {
  return signer?.status === 'signed';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signerQueryForCurrentUser(user, requestUser) {
  const userEmail = String(user?.email || requestUser?.email || '').trim().toLowerCase();
  const signerMatchers = [];

  if (userEmail) signerMatchers.push({ email: new RegExp(`^${escapeRegExp(userEmail)}$`, 'i') });

  return signerMatchers;
}

function signerAssignmentStatus(envelope, signer) {
  if (signerIsSigned(signer)) return 'signed';
  if (signer?.role === 'internal' && signerIsPending(signer) && canSignerAct(envelope, signer)) return 'pending';
  return null;
}

function signingItemSortDate(item) {
  return new Date(item.signedAt || item.sentAt || item.createdAt || 0).getTime();
}

function signingEnvelopeStatusFilter(includeSigned = false) {
  return includeSigned
    ? ['sent', 'viewed', 'partially_signed', 'completed']
    : ['sent', 'viewed', 'partially_signed'];
}

function signingSignerStatusFilter(includeSigned = false) {
  return includeSigned ? ['pending', 'viewed', 'signed'] : ['pending', 'viewed'];
}

function findMatchingSigningItems({ envelopes, user, requestUser, includeSigned = false, roles = ['internal'] }) {
  return envelopes
    .flatMap((envelope) => (envelope.signers || [])
      .filter((signer) => signerMatchesUser(signer, user, requestUser, roles))
      .map((signer) => ({ envelope, signer, assignmentStatus: signerAssignmentStatus(envelope, signer) }))
      .filter(({ assignmentStatus }) => assignmentStatus === 'pending' || (includeSigned && assignmentStatus === 'signed'))
      .map(({ envelope, signer, assignmentStatus }) => serializeInternalSigningQueueItem(envelope, signer, assignmentStatus)))
    .sort((a, b) => signingItemSortDate(b) - signingItemSortDate(a));
}

function signerElemMatch(signerMatchers, includeSigned = false, roles = ['internal']) {
  return {
    role: { $in: roles },
    status: { $in: signingSignerStatusFilter(includeSigned) },
    $or: signerMatchers
  };
}

function signingEnvelopeQuery(req, signerMatchers, includeSigned = false, roles = ['internal']) {
  return {
    organization: organizationId(req),
    status: { $in: signingEnvelopeStatusFilter(includeSigned) },
    signers: {
      $elemMatch: signerElemMatch(signerMatchers, includeSigned, roles)
    }
  };
}

function splitSigningItems(items) {
  return {
    pending: items.filter((item) => item.assignmentStatus === 'pending'),
    signed: items.filter((item) => item.assignmentStatus === 'signed')
  };
}

function internalSigningQueueLimit(req, fallback = 25) {
  return Math.max(1, Math.min(100, Number(req.query.limit || fallback)));
}

function pendingSigningItemsForUser({ envelopes, user, requestUser }) {
  return findMatchingSigningItems({ envelopes, user, requestUser, includeSigned: false, roles: ['internal'] });
}

function allSigningItemsForUser({ envelopes, user, requestUser }) {
  return findMatchingSigningItems({ envelopes, user, requestUser, includeSigned: true, roles: ['internal', 'candidate'] });
}

function emptySigningDocumentsResponse() {
  return { pending: [], signed: [] };
}

function signedDocumentCountForSigner(envelope, signer) {
  if (!signerIsSigned(signer)) return 0;
  return (envelope.documents || []).filter((document) =>
    ['signed', 'completed'].includes(document.status) &&
    (document.signedPdf?.url || document.signedPdf?.downloadUrl)
  ).length;
}

function pendingDocumentCountForSigner(envelope, signer) {
  if (!signerIsPending(signer)) return 0;
  return (envelope.documents || []).filter((document) =>
    !['signed', 'completed', 'voided'].includes(document.status) &&
    (
      (document.signatureFields || []).some((field) => fieldBelongsToAssignedSigner(field, signer)) ||
      !(document.signatureFields || []).length
    )
  ).length;
}

function fieldBelongsToAssignedSigner(field, signer) {
  if (!field) return false;
  if (signer?.key && field.signerKey) return field.signerKey === signer.key;
  return !field.signerKey && (field.role || 'candidate') === signer?.role;
}

function assignedFieldsForSigner(envelopeDocument, signer) {
  return (Array.isArray(envelopeDocument?.signatureFields) ? envelopeDocument.signatureFields : [])
    .filter((field) => fieldBelongsToAssignedSigner(field, signer));
}

function internalDocumentActionType(envelopeDocument, signer) {
  const fields = assignedFieldsForSigner(envelopeDocument, signer);
  if (fields.some((field) => field.type === 'signature')) return 'document_sign';
  if (fields.some((field) => field.type === 'text' || field.type === 'image')) return 'document_fill';
  return fields.length ? 'document_review' : null;
}

function signerCanSignInternalDocument(envelope, envelopeDocument, signer) {
  return signer?.role === 'internal' &&
    ACTIVE_SIGNING_ENVELOPE_STATUSES.includes(envelope.status) &&
    SIGNABLE_DOCUMENT_STATUSES.includes(envelopeDocument.status) &&
    signerIsPending(signer) &&
    canSignerAct(envelope, signer) &&
    Boolean(internalDocumentActionType(envelopeDocument, signer));
}

function signerCanViewMyDocument(envelope, envelopeDocument, signer) {
  return VIEWABLE_SIGNING_ENVELOPE_STATUSES.includes(envelope.status) &&
    ['internal', 'candidate'].includes(signer?.role) &&
    Boolean(envelopeDocument) &&
    assignedFieldsForSigner(envelopeDocument, signer).length > 0;
}

function textValue(field, fieldValues = {}) {
  if (fieldValues[field.id] !== undefined) return fieldValues[field.id];
  if (field.key && fieldValues[field.key] !== undefined) return fieldValues[field.key];
  if (field.label && fieldValues[field.label] !== undefined) return fieldValues[field.label];
  return '';
}

function internalTextFieldValues(envelopeDocument, signer, fieldValues = {}) {
  const fields = assignedFieldsForSigner(envelopeDocument, signer).filter((field) => field.type === 'text');
  const values = {};

  for (const field of fields) {
    const value = String(textValue(field, fieldValues) ?? '');
    if (field.required !== false && !value.trim()) {
      return { error: `${field.label || 'Text field'} is required`, values: null };
    }
    const stampValue = value || ' ';
    values[field.id] = stampValue;
    if (field.key) values[field.key] = stampValue;
    if (field.label) values[field.label] = stampValue;
  }

  return { error: null, values };
}

function internalImageFieldValues(envelopeDocument, signer, imageValues = {}) {
  const fields = assignedFieldsForSigner(envelopeDocument, signer).filter((field) => field.type === 'image');
  const values = {};

  for (const field of fields) {
    const value = imageValues[field.id] ??
      (field.key ? imageValues[field.key] : undefined) ??
      (field.label ? imageValues[field.label] : undefined) ??
      '';
    if (field.required !== false && !String(value || '').trim()) {
      return { error: `${field.label || 'Image field'} is required`, values: null };
    }
    if (value && !String(value).match(/^data:image\/(png|jpeg|jpg);base64,/)) {
      return { error: `${field.label || 'Image field'} must be a PNG or JPG image`, values: null };
    }
    if (!value) continue;
    values[field.id] = value;
    if (field.key) values[field.key] = value;
    if (field.label) values[field.label] = value;
  }

  return { error: null, values };
}

function findNextInternalSigningDocumentId(envelope, currentEnvelopeDocument, signer) {
  const documents = Array.isArray(envelope?.documents) ? envelope.documents : [];
  const currentId = String(currentEnvelopeDocument?._id || '');
  const currentIndex = documents.findIndex((document) => String(document._id) === currentId);
  const orderedDocuments = currentIndex >= 0
    ? [...documents.slice(currentIndex + 1), ...documents.slice(0, currentIndex)]
    : documents;
  const nextDocument = orderedDocuments.find((document) =>
    String(document._id) !== currentId &&
    signerCanSignInternalDocument(envelope, document, signer)
  );
  return nextDocument?._id?.toString() || null;
}

function findEnvelopeDocumentByRouteId(envelope, routeId) {
  return envelope.documents.id(routeId) ||
    envelope.documents.find((doc) => String(doc.document?._id || doc.document || '') === String(routeId));
}

function sanitizeMySigningEnvelope(envelope, signer, organization) {
  const signerCanAct = signer.role === 'internal' &&
    ACTIVE_SIGNING_ENVELOPE_STATUSES.includes(envelope.status) &&
    signerIsPending(signer) &&
    canSignerAct(envelope, signer) &&
    (envelope.documents || []).some((document) => signerCanSignInternalDocument(envelope, document, signer));
  const documents = (envelope.documents || [])
    .map((document) => ({
      _id: document._id,
      document: document.document,
      title: document.title,
      status: document.status,
      signedAt: document.signedAt,
      signatureFields: assignedFieldsForSigner(document, signer),
      actionType: internalDocumentActionType(document, signer)
    }))
    .filter((document) => document.signatureFields.length);

  return {
    _id: envelope._id,
    title: envelope.title,
    message: envelope.message,
    status: envelope.status,
    sentAt: envelope.sentAt,
    completedAt: envelope.completedAt,
    organization: organization
      ? { _id: organization._id, name: organization.name, logo: organization.logo, website: organization.website }
      : undefined,
    signer: {
      _id: signer._id,
      key: signer.key,
      role: signer.role,
      name: signer.name,
      email: signer.email,
      order: signer.order,
      status: signer.status,
      viewedAt: signer.viewedAt,
      signedAt: signer.signedAt
    },
    signers: (envelope.signers || []).map((item) => ({
      key: item.key,
      role: item.role,
      name: item.name,
      order: item.order,
      status: item.status
    })),
    documents,
    canSign: signerCanAct
  };
}

async function loadMySigningEnvelope(req, envelopeId, signerKey = '') {
  const user = await getCurrentUser(req);
  const signerMatchers = signerQueryForCurrentUser(user, req.user);
  if (!signerMatchers.length) return { envelope: null, signer: null, organization: null, user };

  const envelope = await OnboardingEnvelope.findOne({
    _id: envelopeId,
    organization: organizationId(req),
    status: { $in: VIEWABLE_SIGNING_ENVELOPE_STATUSES }
  }).populate('documents.document');

  if (!envelope) return { envelope: null, signer: null, organization: null, user };

  const signer = (envelope.signers || []).find((item) =>
    signerMatchesUser(item, user, req.user, ['internal', 'candidate']) &&
    (!signerKey || item.key === signerKey)
  );
  if (!signer) return { envelope: null, signer: null, organization: null, user };

  const organization = await getOrganization(req);
  return { envelope, signer, organization, user };
}

function serializeInternalSigningQueueItem(envelope, signer, assignmentStatus = 'pending') {
  const documents = (envelope.documents || []).map((document) => ({
    _id: document._id,
    title: document.title,
    status: document.status,
    assignedFieldCount: assignedFieldsForSigner(document, signer).length
  }));

  return {
    _id: envelope._id,
    title: envelope.title,
    message: envelope.message,
    contextType: envelope.contextType,
    processType: envelope.processType,
    status: envelope.status,
    sentAt: envelope.sentAt,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    assignmentStatus,
    signedAt: signer.signedAt,
    signer: {
      _id: signer._id,
      key: signer.key,
      role: signer.role,
      name: signer.name,
      email: signer.email,
      order: signer.order,
      status: signer.status
    },
    documentCount: documents.length,
    assignedFieldCount: documents.reduce((total, document) => total + document.assignedFieldCount, 0),
    pendingDocumentCount: pendingDocumentCountForSigner(envelope, signer),
    signedDocumentCount: signedDocumentCountForSigner(envelope, signer),
    documents
  };
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
      content: { label: 'Signature' }
    }
  ];
}

async function getOrganization(req) {
  return Organization.findById(organizationId(req));
}

async function getCurrentUser(req) {
  return User.findById(req.user.id);
}

async function findDocumentForOrg(req, id, { includeArchived = false } = {}) {
  const query = { _id: id, organization: organizationId(req) };
  if (!includeArchived) query.status = { $ne: 'archived' };
  return OnboardingDocument.findOne(query);
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

  if (document.sourceType === 'uploaded_docx') {
    if (document.pdfSnapshot?.url || document.pdfSnapshot?.downloadUrl) {
      return document.pdfSnapshot;
    }
    throw new Error('Uploaded DOCX document is missing its preserved PDF snapshot. Re-upload as PDF or configure DOCX conversion.');
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
  let created = false;
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
    created = true;
  }

  account.linkCandidate(candidate._id, organization._id);
  await account.save();
  return { account, created };
}

async function serializeOnboarding(onboarding) {
  const populated = await onboarding.populate([
    { path: 'candidate', select: 'firstName lastName email phone position status resumeUrl' },
    { path: 'candidateAccount', select: 'email profile status lastLoginAt' },
    { path: 'documents' },
    { path: 'envelopes' }
  ]);
  return serializeOnboardingPlatform(populated);
}

router.get('/dashboard', async (req, res) => {
  try {
    const organization = organizationId(req);
    const now = new Date();
    const selectedProcessType = processTypeQueryFromRequest(req);
    const onboardingQuery = {
      organization,
      ...processTypeFilter(selectedProcessType)
    };
    const workflowQuery = { organization };
    const relatedOnboardingIds = selectedProcessType === 'all'
      ? null
      : await CandidateOnboarding.find(onboardingQuery).distinct('_id');
    if (relatedOnboardingIds) workflowQuery.onboarding = { $in: relatedOnboardingIds };
    const [
      statusCounts,
      overdueItems,
      pendingApprovals,
      handoffFailures,
      formReviews
    ] = await Promise.all([
      CandidateOnboarding.aggregate([
        { $match: onboardingQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      OnboardingWorkflowItem.countDocuments({
        ...workflowQuery,
        status: { $in: ['pending', 'in_progress', 'blocked', 'failed'] },
        dueAt: { $lt: now }
      }),
      OnboardingApproval.countDocuments({ ...workflowQuery, status: 'pending' }),
      OnboardingHandoff.countDocuments({ ...workflowQuery, status: 'failed' }),
      OnboardingFormSubmission.countDocuments({ ...workflowQuery, status: 'under_review' })
    ]);

    res.json({
      data: {
        statusCounts: statusCounts.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
        overdueItems,
        pendingApprovals,
        handoffFailures,
        formReviews
      }
    });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding dashboard', error: error.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const organization = organizationId(req);
    const now = new Date();
    const processType = processTypeQueryFromRequest(req);
    const onboardingQuery = {
      organization,
      ...processTypeFilter(processType)
    };
    const onboardingIds = await CandidateOnboarding.find(onboardingQuery).distinct('_id');
    const taskQuery = {
      organization,
      onboarding: { $in: onboardingIds }
    };

    if (req.query.status && req.query.status !== 'all') {
      taskQuery.status = req.query.status;
    }

    if (req.query.owner === 'me') {
      taskQuery.ownerUser = req.user.id;
    } else if (req.query.owner === 'candidate') {
      taskQuery.ownerType = 'candidate';
    } else if (req.query.owner === 'system') {
      taskQuery.ownerType = 'system';
    } else if (req.query.owner === 'unassigned') {
      taskQuery.ownerType = 'user';
      taskQuery.ownerUser = { $exists: false };
    } else if (req.query.owner && req.query.owner !== 'all') {
      taskQuery.ownerUser = req.query.owner;
    }

    if (req.query.due === 'overdue') {
      taskQuery.status = taskQuery.status || { $in: ['pending', 'in_progress', 'blocked', 'failed'] };
      taskQuery.dueAt = { $lt: now };
    } else if (req.query.due === 'due_soon') {
      taskQuery.status = taskQuery.status || { $in: ['pending', 'in_progress', 'blocked', 'failed'] };
      taskQuery.dueAt = { $gte: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    } else if (req.query.due === 'upcoming') {
      taskQuery.dueAt = { $gt: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    } else if (req.query.due === 'none') {
      taskQuery.dueAt = { $exists: false };
    }

    const items = await OnboardingWorkflowItem.find(taskQuery)
      .populate('ownerUser', 'email profile')
      .populate('dependencies', 'title status type')
      .populate({
        path: 'onboarding',
        select: 'title processType status dueAt candidate',
        populate: { path: 'candidate', select: 'firstName lastName email status position' }
      })
      .sort({ dueAt: 1, order: 1, createdAt: -1 })
      .limit(250);

    const data = items.map((item) => {
      const serialized = serializeWorkflowItem(item, now);
      const transition = item.onboarding;
      return {
        ...serialized,
        transition: transition ? {
          _id: transition._id,
          title: transition.title,
          processType: normalizeProcessType(transition.processType),
          status: transition.status,
          dueAt: transition.dueAt,
          candidate: transition.candidate
        } : null
      };
    });

    res.json({ data });
  } catch (error) {
    console.error('Load people transition tasks failed:', error);
    res.status(500).json({ msg: 'Failed to load people transition tasks', error: error.message });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const organization = organizationId(req);
    const processType = processTypeQueryFromRequest(req);
    const query = {
      organization,
      ...processTypeFilter(processType)
    };
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
    }

    const records = await CandidateOnboarding.find(query)
      .select('_id processType status createdAt completedAt')
      .lean();
    const recordIds = records.map((record) => record._id);
    const now = new Date();
    const [workflowItems, failedHandoffs] = await Promise.all([
      OnboardingWorkflowItem.find({
        organization,
        onboarding: { $in: recordIds }
      })
        .populate('ownerUser', 'email profile')
        .lean(),
      OnboardingHandoff.countDocuments({
        organization,
        onboarding: { $in: recordIds },
        status: 'failed'
      })
    ]);

    const completedRecords = records.filter((record) => record.status === 'completed' && record.completedAt);
    const averageCompletionHours = completedRecords.length
      ? Math.round(completedRecords.reduce((sum, record) => (
          sum + (new Date(record.completedAt).getTime() - new Date(record.createdAt).getTime()) / (60 * 60 * 1000)
        ), 0) / completedRecords.length)
      : 0;
    const activeWorkflowItems = workflowItems.filter((item) => ['pending', 'in_progress', 'blocked', 'failed'].includes(item.status));
    const overdueCount = activeWorkflowItems.filter((item) => item.dueAt && new Date(item.dueAt) < now).length;

    const pendingOwnerBuckets = new Map();
    activeWorkflowItems.forEach((item) => {
      const owner = item.ownerUser && typeof item.ownerUser === 'object'
        ? `${item.ownerUser.profile?.firstName || ''} ${item.ownerUser.profile?.lastName || ''}`.trim() || item.ownerUser.email
        : item.ownerType === 'candidate'
          ? 'Candidate'
          : item.ownerType === 'system'
            ? 'System'
            : 'Unassigned internal owner';
      pendingOwnerBuckets.set(owner, (pendingOwnerBuckets.get(owner) || 0) + 1);
    });

    const bottlenecksByType = new Map();
    activeWorkflowItems.forEach((item) => {
      const bucket = bottlenecksByType.get(item.type) || { type: item.type, total: 0, overdue: 0, blocked: 0, failed: 0 };
      bucket.total += 1;
      if (item.dueAt && new Date(item.dueAt) < now) bucket.overdue += 1;
      if (item.status === 'blocked') bucket.blocked += 1;
      if (item.status === 'failed') bucket.failed += 1;
      bottlenecksByType.set(item.type, bucket);
    });

    const byProcess = records.reduce((acc, record) => {
      const key = normalizeProcessType(record.processType);
      acc[key] = acc[key] || { total: 0, completed: 0 };
      acc[key].total += 1;
      if (record.status === 'completed') acc[key].completed += 1;
      return acc;
    }, {});

    res.json({
      data: {
        total: records.length,
        completed: completedRecords.length,
        active: records.filter((record) => !['completed', 'cancelled'].includes(record.status)).length,
        completionRate: records.length ? Math.round((completedRecords.length / records.length) * 100) : 0,
        averageCompletionHours,
        overdueCount,
        failedHandoffs,
        byProcess,
        pendingOwnerBuckets: Array.from(pendingOwnerBuckets, ([owner, count]) => ({ owner, count })),
        bottlenecksByType: Array.from(bottlenecksByType.values()).sort((a, b) => b.total - a.total)
      }
    });
  } catch (error) {
    console.error('Load people transition analytics failed:', error);
    res.status(500).json({ msg: 'Failed to load people transition analytics', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, search, candidateId } = req.query;
    const selectedProcessType = processTypeQueryFromRequest(req);
    const query = {
      organization: organizationId(req),
      ...processTypeFilter(selectedProcessType)
    };
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

    const recentEventQuery = { organization: organizationId(req) };
    if (selectedProcessType !== 'all') {
      recentEventQuery.$or = [
        { 'metadata.processType': selectedProcessType },
        ...(selectedProcessType === 'onboarding' ? [{ 'metadata.processType': { $exists: false } }] : [])
      ];
    }
    const recentEvents = await OnboardingAuditEvent.find(recentEventQuery)
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
    const processType = processTypeFromRequest(req);
    const copy = processCopy(processType);
    const candidate = await Candidate.findOne({
      _id: req.params.candidateId,
      organization: organizationId(req)
    });
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    const complianceDocuments = processType === 'compliance_documents'
      ? normalizeComplianceDocuments(req.body.complianceDocuments)
      : [];
    if (processType === 'compliance_documents' && !complianceDocuments.length) {
      return res.status(400).json({ msg: 'Add at least one compliance document with a valid expiry date' });
    }

    const organization = await getOrganization(req);
    const { account, created: createdCandidateAccount } = await ensureCandidateAccount(candidate, organization);
    const title = req.body.title || `${candidateDisplayName(candidate)} ${copy.label.toLowerCase()}`;
    const packetTemplate = req.body.templateId
      ? await OnboardingTemplate.findOne({
          _id: req.body.templateId,
          organization: organizationId(req),
          ...processTypeFilter(processType),
          status: 'active'
        })
      : null;

    const onboarding = await CandidateOnboarding.create({
      organization: organizationId(req),
      candidate: candidate._id,
      candidateAccount: account._id,
      job: candidate.jobAppliedFor,
      processType,
      template: packetTemplate?._id,
      templateSnapshot: packetTemplate ? {
        _id: packetTemplate._id,
        name: packetTemplate.name,
        processType: packetTemplate.processType || processType,
        version: packetTemplate.version,
        documents: packetTemplate.documents,
        formTemplates: packetTemplate.formTemplates,
        workflowItems: packetTemplate.workflowItems,
        reminderRules: packetTemplate.reminderRules,
        completionActions: packetTemplate.completionActions,
        capturedAt: new Date()
      } : undefined,
      title,
      notes: req.body.notes || '',
      startedBy: req.user.id
    });

    account.linkCandidate(candidate._id, organization._id);
    await account.save();

    const transitionPath = `/public/candidate/transitions/${onboarding._id}`;
    const loginPath = `/login?email=${encodeURIComponent(candidate.email || '')}&next=${encodeURIComponent(transitionPath)}`;
    let portalPath = loginPath;
    if (createdCandidateAccount) {
      const inviteToken = crypto.randomBytes(32).toString('base64url');
      onboarding.inviteTokenHash = sha256(inviteToken);
      onboarding.inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      portalPath = `/signup?token=${encodeURIComponent(inviteToken)}`;
    }

    // Every new transition sends a notification. Existing candidate accounts
    // receive a login link; newly-created accounts receive the one-time signup
    // token. Previously the existing-account branch silently sent no email.
    const portalInviteUrl = await onboardingEmailService.sendCandidateInvite({
      candidate,
      organization,
      onboarding,
      portalPath,
      request: req
    }).catch((error) => {
      console.error('Failed to send onboarding invite email:', error);
      return onboardingEmailService.candidatePortalUrl(portalPath, { organization, request: req });
    });

    onboarding.portalInviteUrl = portalInviteUrl;
    await onboarding.save();

    if (processType === 'compliance_documents') {
      await createComplianceWorkflowItems({
        req,
        onboarding,
        documents: complianceDocuments
      });
    } else {
      await initializeDefaultWorkflow({
        onboarding,
        candidate,
        userId: req.user.id,
        req,
        packetTemplate,
        candidateForm: req.body.candidateForm
      });
    }

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: onboarding._id,
      candidate: candidate._id,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: req.user.email,
      action: `${processType}_started`,
      metadata: { inviteEmail: candidate.email, processType, reusedCandidateAccount: !createdCandidateAccount }
    });

    await createPeopleTransitionNotifications({
      organization: organizationId(req),
      onboarding,
      candidate,
      notificationType: 'people_transition_started',
      title: `${copy.label} started`,
      message: `${candidateDisplayName(candidate)} has a new ${copy.label.toLowerCase()} process.`,
      priority: 'medium',
      actorUserId: req.user.id
    });

    res.status(201).json({ data: await serializeOnboarding(onboarding), inviteUrl: portalInviteUrl });
  } catch (error) {
    console.error('Start onboarding failed:', error);
    res.status(500).json({ msg: 'Failed to start onboarding', error: error.message });
  }
});

router.get('/templates', async (req, res) => {
  try {
    await ensureSystemPacketTemplates({ organization: organizationId(req), userId: req.user.id });
    const selectedProcessType = processTypeQueryFromRequest(req);
    const templates = await OnboardingTemplate.find({
      organization: organizationId(req),
      ...processTypeFilter(selectedProcessType),
      status: { $ne: 'archived' }
    })
      .populate('documents', 'title status sourceType')
      .populate('formTemplates', 'name category fields')
      .sort({ isSystem: -1, name: 1 });
    res.json({ data: templates });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding packet templates', error: error.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const processType = processTypeFromRequest(req);
    const template = await OnboardingTemplate.create({
      organization: organizationId(req),
      name: req.body.name,
      description: req.body.description || '',
      category: req.body.category || 'default',
      processType,
      documents: Array.isArray(req.body.documents) ? req.body.documents : [],
      formTemplates: Array.isArray(req.body.formTemplates) ? req.body.formTemplates : [],
      workflowItems: Array.isArray(req.body.workflowItems) ? req.body.workflowItems : [],
      reminderRules: Array.isArray(req.body.reminderRules) ? req.body.reminderRules : [],
      completionActions: Array.isArray(req.body.completionActions) ? req.body.completionActions : [],
      createdBy: req.user.id
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: req.user.email,
      action: 'packet_template_created',
      metadata: { templateId: template._id, name: template.name, processType }
    });

    res.status(201).json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to create onboarding packet template', error: error.message });
  }
});

router.patch('/templates/:id', async (req, res) => {
  try {
    const processType = req.body.processType ? normalizeProcessType(req.body.processType) : undefined;
    const set = {
      name: req.body.name,
      description: req.body.description || '',
      category: req.body.category || 'default',
      status: req.body.status || 'active',
      documents: Array.isArray(req.body.documents) ? req.body.documents : [],
      formTemplates: Array.isArray(req.body.formTemplates) ? req.body.formTemplates : [],
      workflowItems: Array.isArray(req.body.workflowItems) ? req.body.workflowItems : [],
      reminderRules: Array.isArray(req.body.reminderRules) ? req.body.reminderRules : [],
      completionActions: Array.isArray(req.body.completionActions) ? req.body.completionActions : [],
      updatedBy: req.user.id
    };
    if (processType) set.processType = processType;
    const template = await OnboardingTemplate.findOneAndUpdate(
      { _id: req.params.id, organization: organizationId(req), isSystem: { $ne: true } },
      {
        $set: set,
        $inc: { version: 1 }
      },
      { new: true }
    );
    if (!template) return res.status(404).json({ msg: 'Onboarding packet template not found' });
    res.json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to update onboarding packet template', error: error.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const template = await OnboardingTemplate.findOneAndUpdate(
      { _id: req.params.id, organization: organizationId(req), isSystem: { $ne: true } },
      { $set: { status: 'archived', updatedBy: req.user.id } },
      { new: true }
    );
    if (!template) return res.status(404).json({ msg: 'Onboarding packet template not found' });
    res.json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to archive onboarding packet template', error: error.message });
  }
});

router.get('/form-templates', async (req, res) => {
  try {
    await ensureSystemPacketTemplates({ organization: organizationId(req), userId: req.user.id });
    const templates = await OnboardingFormTemplate.find({
      organization: organizationId(req),
      status: { $ne: 'archived' }
    }).sort({ isSystem: -1, name: 1 });
    res.json({ data: templates });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load onboarding form templates', error: error.message });
  }
});

router.post('/form-templates', async (req, res) => {
  try {
    const template = await OnboardingFormTemplate.create({
      organization: organizationId(req),
      name: req.body.name,
      description: req.body.description || '',
      category: req.body.category || 'custom',
      fields: Array.isArray(req.body.fields) ? req.body.fields : [],
      createdBy: req.user.id
    });
    res.status(201).json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to create onboarding form template', error: error.message });
  }
});

router.patch('/form-templates/:id', async (req, res) => {
  try {
    const template = await OnboardingFormTemplate.findOneAndUpdate(
      { _id: req.params.id, organization: organizationId(req), isSystem: { $ne: true } },
      {
        $set: {
          name: req.body.name,
          description: req.body.description || '',
          category: req.body.category || 'custom',
          status: req.body.status || 'active',
          fields: Array.isArray(req.body.fields) ? req.body.fields : [],
          updatedBy: req.user.id
        },
        $inc: { version: 1 }
      },
      { new: true }
    );
    if (!template) return res.status(404).json({ msg: 'Onboarding form template not found' });
    res.json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to update onboarding form template', error: error.message });
  }
});

router.delete('/form-templates/:id', async (req, res) => {
  try {
    const template = await OnboardingFormTemplate.findOneAndUpdate(
      { _id: req.params.id, organization: organizationId(req), isSystem: { $ne: true } },
      { $set: { status: 'archived', updatedBy: req.user.id } },
      { new: true }
    );
    if (!template) return res.status(404).json({ msg: 'Onboarding form template not found' });
    res.json({ data: template });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to archive onboarding form template', error: error.message });
  }
});

router.post('/form-submissions/:id/reveal', async (req, res) => {
  try {
    const submission = await OnboardingFormSubmission.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!submission) return res.status(404).json({ msg: 'Onboarding form submission not found' });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: submission.onboarding,
      candidate: submission.candidate,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: req.user.email,
      action: 'sensitive_form_values_revealed',
      metadata: {
        formSubmission: submission._id,
        fields: submission.values.filter((value) => value.sensitive).map((value) => value.key)
      }
    });

    res.json({ data: serializeSubmission(submission, { reveal: true }) });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to reveal form submission', error: error.message });
  }
});

router.patch('/form-submissions/:id/review', async (req, res) => {
  try {
    const decision = req.body.decision === 'rejected' ? 'rejected' : 'approved';
    const submission = await OnboardingFormSubmission.findOne({
      _id: req.params.id,
      organization: organizationId(req)
    });
    if (!submission) return res.status(404).json({ msg: 'Onboarding form submission not found' });

    const reviewed = await reviewFormSubmission({
      submission,
      decision,
      reviewerId: req.user.id,
      reviewerEmail: req.user.email,
      notes: req.body.notes || '',
      req
    });

    res.json({ data: serializeSubmission(reviewed) });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to review form submission', error: error.message });
  }
});

router.post('/reminders/run', async (req, res) => {
  try {
    const organization = organizationId(req);
    const now = new Date();
    const reminderWindow = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dueSoonWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const selectedProcessType = processTypeQueryFromRequest(req);
    const reminderQuery = {
      organization,
      status: { $in: ['pending', 'in_progress', 'blocked', 'failed'] },
      dueAt: { $lte: dueSoonWindow },
      $or: [
        { lastReminderAt: { $exists: false } },
        { lastReminderAt: { $lte: reminderWindow } }
      ]
    };
    if (selectedProcessType !== 'all') {
      const onboardingIds = await CandidateOnboarding.find({
        organization,
        ...processTypeFilter(selectedProcessType)
      }).distinct('_id');
      reminderQuery.onboarding = { $in: onboardingIds };
    }
    const items = await OnboardingWorkflowItem.find(reminderQuery)
      .sort({ dueAt: 1 })
      .limit(100);

    const organizationDoc = await getOrganization(req);
    let sent = 0;
    for (const item of items) {
      const onboarding = await CandidateOnboarding.findById(item.onboarding).populate('candidate');
      if (!onboarding?.candidate) continue;
      const overdue = item.dueAt && item.dueAt < now;
      const notificationType = overdue ? 'people_transition_overdue' : 'people_transition_due_soon';
      const copy = processCopy(onboarding.processType);
      item.lastReminderAt = now;
      if (overdue) item.lastOverdueAlertAt = now;
      else item.lastDueSoonAlertAt = now;
      await item.save();
      sent += 1;
      if (item.ownerType === 'candidate') {
        await onboardingEmailService.sendWorkflowReminder({
          candidate: onboarding.candidate,
          organization: organizationDoc,
          onboarding,
          item,
          request: req
        }).catch((error) => console.error('Failed to send onboarding workflow reminder:', error));

        if (item.metadata?.complianceDocument === true) {
          await createPeopleTransitionNotifications({
            organization,
            onboarding,
            candidate: onboarding.candidate,
            notificationType,
            title: overdue ? 'Compliance document overdue' : 'Compliance document due soon',
            message: `${item.title} for ${candidateDisplayName(onboarding.candidate)} is ${overdue ? 'overdue' : 'due soon'}.`,
            priority: overdue ? 'high' : 'medium'
          });
        }
      } else if (item.ownerType === 'user' && item.ownerUser) {
        await createPeopleTransitionNotifications({
          organization,
          onboarding,
          candidate: onboarding.candidate,
          notificationType,
          title: overdue ? `${copy.label} task overdue` : `${copy.label} task due soon`,
          message: `${item.title} for ${candidateDisplayName(onboarding.candidate)} is ${overdue ? 'overdue' : 'due soon'}.`,
          priority: overdue ? 'high' : 'medium',
          userIds: [item.ownerUser]
        });
      } else {
        await createPeopleTransitionNotifications({
          organization,
          onboarding,
          candidate: onboarding.candidate,
          notificationType,
          title: overdue ? `${copy.label} task overdue` : `${copy.label} task due soon`,
          message: `${item.title} for ${candidateDisplayName(onboarding.candidate)} is ${overdue ? 'overdue' : 'due soon'}.`,
          priority: overdue ? 'high' : 'medium'
        });
      }
      await logOnboardingEvent({
        req,
        organization,
        onboarding: onboarding._id,
        candidate: onboarding.candidate._id,
        actorType: 'system',
        action: overdue ? 'workflow_overdue_alert_sent' : 'workflow_due_soon_alert_sent',
        metadata: { workflowItem: item._id, itemType: item.type, processType: normalizeProcessType(onboarding.processType) }
      });
    }

    res.json({ data: { scanned: items.length, sent } });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to run onboarding reminders', error: error.message });
  }
});

router.post('/:onboardingId/handoff/retry', async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.params.onboardingId,
      organization: organizationId(req)
    });
    if (!onboarding) return res.status(404).json({ msg: 'Onboarding not found' });
    const handoff = await tryCompleteOnboarding(onboarding._id, { req });
    res.json({ data: handoff });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to retry onboarding handoff', error: error.message });
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
    const query = { organization: organizationId(req) };
    if (req.query.includeArchived !== 'true') query.status = { $ne: 'archived' };

    const documents = await OnboardingDocument.find(query)
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
      const buffer = await documentConversionService.convertUploadedDocxToPdfBuffer(req.file.path, { title });
      const originalBuffer = await fs.readFile(req.file.path);
      originalFile = await onboardingStorageService.uploadBuffer(originalBuffer, {
        folder: 'onboarding/originals',
        fileName: `${title}-${Date.now()}${path.extname(req.file.originalname) || '.docx'}`,
        mimeType: req.file.mimetype,
        resourceType: 'raw'
      });
      originalFile.originalName = req.file.originalname;
      pdfSnapshot = await onboardingStorageService.uploadBuffer(buffer, {
        folder: 'onboarding/documents',
        fileName: `${title}-${Date.now()}.pdf`,
        mimeType: 'application/pdf',
        resourceType: 'raw'
      });
      pdfSnapshot.originalName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.pdf`;
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
    res.status(error.statusCode || 500).json({ msg: error.message || 'Failed to upload onboarding document', error: error.message });
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

    const builderEditFields = ['title', 'description', 'builderBlocks', 'variables'];
    if (document.sourceType !== 'builder' && builderEditFields.some((field) => req.body[field] !== undefined)) {
      return res.status(400).json({ msg: 'Uploaded documents cannot be edited. Use Prepare to place signing fields.' });
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

router.delete('/documents/:id', async (req, res) => {
  try {
    const document = await findDocumentForOrg(req, req.params.id, { includeArchived: true });
    if (!document) return res.status(404).json({ msg: 'Document not found' });

    const previousStatus = document.status;
    if (document.status !== 'archived') {
      document.status = 'archived';
      document.updatedBy = req.user.id;
      await document.save();

      await logOnboardingEvent({
        req,
        organization: organizationId(req),
        document: document._id,
        actorType: 'user',
        actorUser: req.user.id,
        action: 'document_archived',
        metadata: {
          title: document.title,
          previousStatus,
          preservesCandidateInstances: true
        }
      });
    }

    res.json({ data: document, msg: 'Document removed from library' });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to remove document', error: error.message });
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

router.post('/team-signing/envelopes', async (req, res) => {
  try {
    const documentIds = Array.isArray(req.body.documentIds)
      ? [...new Set(req.body.documentIds.map((id) => String(id || '')).filter(Boolean))]
      : [];
    if (documentIds.length === 0) {
      return res.status(400).json({ msg: 'At least one document is required' });
    }

    const signers = buildTeamSigningSigners(req);
    const [organization, user] = await Promise.all([getOrganization(req), getCurrentUser(req)]);
    const documents = await OnboardingDocument.find({
      _id: { $in: documentIds },
      organization: organizationId(req),
      status: { $ne: 'archived' }
    });
    if (documents.length !== documentIds.length) {
      return res.status(400).json({ msg: 'One or more documents could not be found or has been removed from the library' });
    }

    const documentsById = new Map(documents.map((document) => [document._id.toString(), document]));
    const orderedDocuments = documentIds.map((id) => documentsById.get(id)).filter(Boolean);
    const documentFields = req.body.documentFields && typeof req.body.documentFields === 'object'
      ? req.body.documentFields
      : {};

    const envelopeDocuments = [];
    for (const document of orderedDocuments) {
      const snapshot = await renderDocumentSnapshot(document, {
        candidate: null,
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
            : defaultSignatureFields(signers[0]?.role || 'internal'),
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
      contextType: 'team_signing',
      processType: 'team_signing',
      title: req.body.title || 'Team signing packet',
      message: req.body.message || '',
      documents: envelopeDocuments,
      signers,
      createdBy: req.user.id
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      envelope: envelope._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: 'team_signing_envelope_created',
      metadata: {
        documentCount: envelopeDocuments.length,
        signerCount: signers.length,
        externalSignerCount: signers.filter((signer) => signer.role === 'external').length
      }
    });

    res.status(201).json({ data: await envelope.populate('documents.document') });
  } catch (error) {
    console.error('Create team signing envelope failed:', error);
    res.status(error.statusCode || 500).json({ msg: error.statusCode ? error.message : 'Failed to create team signing envelope', error: error.message });
  }
});

router.get('/team-signing/envelopes', async (req, res) => {
  try {
    const envelopes = await OnboardingEnvelope.find({
      organization: organizationId(req),
      contextType: 'team_signing'
    })
      .populate('documents.document')
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(200, Number(req.query.limit || 100))));

    res.json({ data: envelopes });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load team signing envelopes', error: error.message });
  }
});

router.get('/envelopes/my-signing-queue', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const signerMatchers = signerQueryForCurrentUser(user, req.user);

    if (!signerMatchers.length) {
      return res.json({ data: [] });
    }

    const envelopes = await OnboardingEnvelope.find(signingEnvelopeQuery(req, signerMatchers, false, ['internal']))
      .populate('documents.document')
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(internalSigningQueueLimit(req));

    const data = pendingSigningItemsForUser({ envelopes, user, requestUser: req.user });

    res.json({ data });
  } catch (error) {
    console.error('Failed to load internal signing queue:', error);
    res.status(500).json({ msg: 'Failed to load signing queue', error: error.message });
  }
});

router.get('/envelopes/my-documents', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const signerMatchers = signerQueryForCurrentUser(user, req.user);

    if (!signerMatchers.length) {
      return res.json({ data: emptySigningDocumentsResponse() });
    }

    const limit = internalSigningQueueLimit(req, 50);
    const envelopes = await OnboardingEnvelope.find(signingEnvelopeQuery(req, signerMatchers, true, ['internal', 'candidate']))
      .populate('documents.document')
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(limit);

    const items = allSigningItemsForUser({ envelopes, user, requestUser: req.user });
    const data = splitSigningItems(items);

    res.json({
      data: {
        pending: data.pending.slice(0, limit),
        signed: data.signed.slice(0, limit)
      }
    });
  } catch (error) {
    console.error('Failed to load my signing documents:', error);
    res.status(500).json({ msg: 'Failed to load my documents', error: error.message });
  }
});

router.get('/envelopes/my-documents/:id', async (req, res) => {
  try {
    const { envelope, signer, organization } = await loadMySigningEnvelope(req, req.params.id, String(req.query.signerKey || req.query.signer || ''));
    if (!envelope || !signer) return res.status(404).json({ msg: 'Document packet not found' });

    if (signer.role === 'internal' && signer.status === 'pending' && ACTIVE_SIGNING_ENVELOPE_STATUSES.includes(envelope.status)) {
      signer.status = 'viewed';
      signer.viewedAt = new Date();
      if (envelope.status === 'sent') envelope.status = 'viewed';
      await envelope.save();
    }

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: signer.email,
      action: 'my_documents_packet_opened',
      metadata: { signerKey: signer.key, signerRole: signer.role }
    });

    res.json({ data: sanitizeMySigningEnvelope(envelope, signer, organization) });
  } catch (error) {
    console.error('Failed to load my document packet:', error);
    res.status(500).json({ msg: 'Failed to load document packet', error: error.message });
  }
});

router.get('/envelopes/my-documents/:id/documents/:documentId/preview', async (req, res) => {
  try {
    const { envelope, signer } = await loadMySigningEnvelope(req, req.params.id, String(req.query.signerKey || req.query.signer || ''));
    if (!envelope || !signer) return res.status(404).json({ msg: 'Document packet not found' });

    const envelopeDocument = findEnvelopeDocumentByRouteId(envelope, req.params.documentId);
    if (!signerCanViewMyDocument(envelope, envelopeDocument, signer)) {
      return res.status(404).json({ msg: 'Document not found' });
    }

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
      actorEmail: signer.email,
      action: 'my_documents_document_previewed',
      metadata: { signerKey: signer.key, signerRole: signer.role }
    });

    sendPdf(res, buffer, { title: envelopeDocument.title, disposition: 'inline' });
  } catch (error) {
    console.error('Failed to preview my document:', error);
    res.status(500).json({ msg: 'Failed to preview document', error: error.message });
  }
});

router.post('/envelopes/my-documents/:id/documents/:documentId/sign', async (req, res) => {
  try {
    const { envelope, signer, organization, user } = await loadMySigningEnvelope(req, req.params.id, String(req.query.signerKey || req.query.signer || ''));
    if (!envelope || !signer) return res.status(404).json({ msg: 'Document packet not found' });
    if (signer.role !== 'internal') return res.status(403).json({ msg: 'Only internal signers can sign in My Documents' });

    const envelopeDocument = findEnvelopeDocumentByRouteId(envelope, req.params.documentId);
    if (!envelopeDocument || !signerCanSignInternalDocument(envelope, envelopeDocument, signer)) {
      return res.status(404).json({ msg: 'Document not found or not available for signing' });
    }

    const signerFields = assignedFieldsForSigner(envelopeDocument, signer);
    const requiresSignature = signerFields.some((field) => field.type === 'signature');
    if (requiresSignature && !req.body.signatureDataUrl) {
      return res.status(400).json({ msg: 'Signature image is required' });
    }

    const { values: textValues, error: textError } = internalTextFieldValues(envelopeDocument, signer, req.body.fieldValues || {});
    if (textError) return res.status(400).json({ msg: textError });

    const { values: imageValues, error: imageError } = internalImageFieldValues(envelopeDocument, signer, req.body.imageFieldValues || {});
    if (imageError) return res.status(400).json({ msg: imageError });

    const sourceBuffer = await loadEnvelopeDocumentPdfBuffer(envelopeDocument);
    const signedAt = new Date();
    const signerInfo = {
      name: signer.name || `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim() || user?.email || signer.email,
      email: signer.email || user?.email
    };
    const stamped = await onboardingPdfService.stampSignedPdf({
      pdfBuffer: sourceBuffer,
      signatureFields: envelopeDocument.signatureFields,
      signer: signerInfo,
      signerRole: 'internal',
      signerKey: signer.key,
      signatureDataUrl: req.body.signatureDataUrl || null,
      fieldValues: textValues,
      imageFieldValues: imageValues,
      signedAt,
      auditText: `Signed by ${signerInfo.email} via SmartHR My Documents`
    });

    envelopeDocument.signedPdf = await onboardingStorageService.uploadBuffer(stamped, {
      folder: 'onboarding/signed',
      fileName: `${envelopeDocument.title}-internal-signed-${Date.now()}.pdf`
    });
    envelopeDocument.status = envelope.signers.every((item) => String(item._id) === String(signer._id) || item.status === 'signed')
      ? 'completed'
      : 'signed';
    envelopeDocument.signedAt = signedAt;

    const nextDocumentId = findNextInternalSigningDocumentId(envelope, envelopeDocument, signer);
    if (!nextDocumentId) {
      signer.status = 'signed';
      signer.signedAt = signedAt;
    }

    const completed = await completeEnvelopeIfReady(envelope, req);
    await envelope.save();

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
    } else if (!nextDocumentId) {
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
      document: envelopeDocument.document,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: signerInfo.email,
      action: 'my_documents_internal_signed',
      metadata: { signerKey: signer.key, completed, readySigners: notifiedSigners.map((item) => item.email) }
    });

    res.json({
      data: sanitizeMySigningEnvelope(envelope, signer, organization),
      nextDocumentId,
      completed
    });
  } catch (error) {
    console.error('Failed to sign my document:', error);
    res.status(500).json({ msg: 'Failed to sign document', error: error.message });
  }
});

router.post('/envelopes', async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.body.onboardingId,
      organization: organizationId(req)
    }).populate('candidate');
    if (!onboarding) return res.status(404).json({ msg: 'Onboarding not found' });

    const documentIds = Array.isArray(req.body.documentIds)
      ? [...new Set(req.body.documentIds.map((id) => String(id || '')).filter(Boolean))]
      : [];
    if (documentIds.length === 0) {
      return res.status(400).json({ msg: 'At least one document is required' });
    }

    const [organization, user] = await Promise.all([getOrganization(req), getCurrentUser(req)]);
    const documents = await OnboardingDocument.find({
      _id: { $in: documentIds },
      organization: organizationId(req),
      status: { $ne: 'archived' }
    });
    if (documents.length !== documentIds.length) {
      return res.status(400).json({ msg: 'One or more documents could not be found or has been removed from the library' });
    }
    const documentsById = new Map(documents.map((document) => [document._id.toString(), document]));
    const orderedDocuments = documentIds.map((id) => documentsById.get(id)).filter(Boolean);

    const signers = buildEnvelopeSigners(req, onboarding);
    const documentFields = req.body.documentFields && typeof req.body.documentFields === 'object'
      ? req.body.documentFields
      : {};

    const envelopeDocuments = [];
    for (const document of orderedDocuments) {
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
      contextType: 'candidate_transition',
      processType: normalizeProcessType(onboarding.processType),
      title: req.body.title || `${onboarding.title} documents`,
      message: req.body.message || '',
      documents: envelopeDocuments,
      signers,
      createdBy: req.user.id
    });

    onboarding.documents = Array.from(new Set([...(onboarding.documents || []), ...orderedDocuments.map((doc) => doc._id)]));
    onboarding.envelopes = Array.from(new Set([...(onboarding.envelopes || []), envelope._id]));
    await onboarding.save();
    await attachEnvelopeToWorkflow({ onboardingId: onboarding._id, envelopeId: envelope._id });

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

    const organization = await getOrganization(req);
    if (envelope.contextType !== 'team_signing') {
      await CandidateOnboarding.findByIdAndUpdate(envelope.onboarding, { status: 'in_progress' });
      await markDocumentWorkflowInProgress(envelope.onboarding, envelope._id);

      await onboardingEmailService.sendEnvelopeNotification({
        candidate: envelope.candidate,
        organization,
        envelope,
        request: req
      }).catch((error) => console.error('Failed to send envelope email:', error));
    }
    const readySigners = await notifyReadySigners({
      envelope,
      organization,
      req,
      excludeKeys: envelope.contextType === 'team_signing'
        ? []
        : envelope.signers.filter((signer) => signer.role === 'candidate').map((signer) => signer.key)
    });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: envelope.onboarding,
      envelope: envelope._id,
      candidate: envelope.candidate?._id,
      actorType: 'user',
      actorUser: req.user.id,
      action: envelope.contextType === 'team_signing' ? 'team_signing_envelope_sent' : 'envelope_sent',
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

router.get('/envelopes/:id/documents/:documentId/download', async (req, res) => {
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
      action: 'internal_document_downloaded'
    });

    sendPdf(res, buffer, { title: envelopeDocument.title, disposition: 'attachment' });
  } catch (error) {
    console.error('Envelope document download failed:', error);
    res.status(500).json({ msg: 'Failed to download envelope document', error: error.message });
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
        fieldValues: req.body.fieldValues || {},
        signedAt: new Date(),
        auditText: `Countersigned by ${signerInfo.email} via SmartHR`
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
    const completed = await completeEnvelopeIfReady(envelope, req);
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

router.get('/form-field-defaults', async (req, res) => {
  try {
    const processType = processTypeQueryFromRequest(req) === 'all' ? 'onboarding' : processTypeQueryFromRequest(req);
    const copy = processCopy(processType);
    res.json({
      data: {
        title: copy.defaultTitle,
        description: copy.defaultDescription,
        category: copy.category,
        processType,
        fields: defaultFormFields(processType)
      }
    });
  } catch (error) {
    res.status(500).json({ msg: 'Failed to load form field defaults', error: error.message });
  }
});

router.patch('/:onboardingId/workflow-items/:itemId', async (req, res) => {
  try {
    const onboarding = await CandidateOnboarding.findOne({
      _id: req.params.onboardingId,
      organization: organizationId(req)
    }).populate('candidate', 'firstName lastName email');
    if (!onboarding) return res.status(404).json({ msg: 'Transition record not found' });

    const item = await OnboardingWorkflowItem.findOne({
      _id: req.params.itemId,
      onboarding: onboarding._id,
      organization: organizationId(req)
    });
    if (!item) return res.status(404).json({ msg: 'Workflow item not found' });

    const previousOwnerUser = item.ownerUser ? String(item.ownerUser) : '';
    const previousStatus = item.status;
    const allowedStatuses = ['not_started', 'pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed'];
    const allowedOwnerTypes = ['candidate', 'user', 'system'];

    if (allowedOwnerTypes.includes(req.body.ownerType)) item.ownerType = req.body.ownerType;
    if (Object.prototype.hasOwnProperty.call(req.body, 'ownerUser')) {
      item.ownerUser = req.body.ownerUser || undefined;
      if (req.body.ownerUser) item.ownerType = 'user';
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dueAt')) {
      item.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) item.notes = req.body.notes || '';
    if (Object.prototype.hasOwnProperty.call(req.body, 'required')) item.required = req.body.required !== false;
    if (allowedStatuses.includes(req.body.status)) {
      item.status = req.body.status;
      if (req.body.status === 'completed') {
        item.completedAt = item.completedAt || new Date();
        item.completedBy = req.user.id;
      } else if (previousStatus === 'completed') {
        item.completedAt = undefined;
        item.completedBy = undefined;
      }
    }

    await item.save();

    if (item.ownerUser && String(item.ownerUser) !== previousOwnerUser) {
      const copy = processCopy(onboarding.processType);
      await createPeopleTransitionNotifications({
        organization: organizationId(req),
        onboarding,
        candidate: onboarding.candidate,
        notificationType: 'people_transition_task_assigned',
        title: `${copy.label} task assigned`,
        message: `${item.title} is assigned to you for ${candidateDisplayName(onboarding.candidate)}.`,
        priority: item.dueAt && item.dueAt < new Date() ? 'high' : 'medium',
        userIds: [item.ownerUser]
      });
    }

    if (item.status === 'completed' && item.metadata?.handoffTarget) {
      let handoff = await OnboardingHandoff.findOne({
        onboarding: onboarding._id,
        target: item.metadata.handoffTarget
      });
      if (!handoff) {
        handoff = await OnboardingHandoff.create({
          organization: onboarding.organization,
          onboarding: onboarding._id,
          candidate: onboarding.candidate._id,
          workflowItem: item._id,
          target: item.metadata.handoffTarget,
          status: 'completed',
          payload: {
            processType: normalizeProcessType(onboarding.processType),
            target: item.metadata.handoffTarget,
            candidateId: onboarding.candidate._id,
            candidateEmail: onboarding.candidate.email,
            candidateName: candidateDisplayName(onboarding.candidate),
            completedBy: req.user.id,
            completedAt: new Date()
          },
          attempts: 1,
          completedAt: new Date()
        });
        onboarding.handoffs = Array.from(new Set([
          ...(onboarding.handoffs || []).map((id) => String(id)),
          String(handoff._id)
        ]));
        await onboarding.save();
      }
    }

    await refreshBlockedWorkflowItems(onboarding._id);
    await updateProgress(onboarding._id);
    await tryCompleteOnboarding(onboarding._id, { req });

    await logOnboardingEvent({
      req,
      organization: organizationId(req),
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      actorType: 'user',
      actorUser: req.user.id,
      actorEmail: req.user.email,
      action: 'workflow_item_updated',
      metadata: {
        workflowItem: item._id,
        status: item.status,
        ownerUser: item.ownerUser,
        dueAt: item.dueAt
      }
    });

    const populatedItem = await OnboardingWorkflowItem.findById(item._id)
      .populate('ownerUser', 'email profile')
      .populate('dependencies', 'title status type');
    res.json({ data: serializeWorkflowItem(populatedItem) });
  } catch (error) {
    console.error('Update people transition workflow item failed:', error);
    res.status(500).json({ msg: 'Failed to update workflow item', error: error.message });
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
