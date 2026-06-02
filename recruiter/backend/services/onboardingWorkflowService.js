const Candidate = require('../models/Candidate');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingApproval = require('../models/OnboardingApproval');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingFormTemplate = require('../models/OnboardingFormTemplate');
const OnboardingHandoff = require('../models/OnboardingHandoff');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const { logOnboardingEvent } = require('./onboardingAuditService');
const {
  encryptValue,
  isSensitiveField,
  serializeSubmission,
  valuePreview
} = require('./onboardingSecurityService');

function candidateDisplayName(candidate = {}) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email || 'Candidate';
}

function valueAtPath(source, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function defaultFormFields() {
  return [
    { id: 'legal-name', key: 'legalName', label: 'Legal name', type: 'text', required: true, defaultValuePath: 'candidate.name', order: 10 },
    { id: 'preferred-name', key: 'preferredName', label: 'Preferred name', type: 'text', defaultValuePath: 'candidate.firstName', order: 20 },
    { id: 'email', key: 'email', label: 'Email', type: 'email', required: true, defaultValuePath: 'candidate.email', order: 30 },
    { id: 'phone', key: 'phone', label: 'Phone', type: 'phone', defaultValuePath: 'candidate.phone', order: 40 },
    { id: 'address', key: 'address', label: 'Home address', type: 'address', required: true, order: 50 },
    { id: 'emergency-contact-name', key: 'emergencyContactName', label: 'Emergency contact name', type: 'text', required: true, order: 60 },
    { id: 'emergency-contact-phone', key: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'phone', required: true, order: 70 },
    { id: 'bank-account-name', key: 'bankAccountName', label: 'Bank account name', type: 'text', required: true, sensitive: true, order: 80 },
    { id: 'bank-routing-number', key: 'bankRoutingNumber', label: 'Bank routing number', type: 'routing_number', required: true, sensitive: true, order: 90 },
    { id: 'bank-account-number', key: 'bankAccountNumber', label: 'Bank account number', type: 'bank_account', required: true, sensitive: true, order: 100 },
    { id: 'tax-id', key: 'taxId', label: 'Tax or national insurance ID', type: 'tax_id', sensitive: true, order: 110 },
    { id: 'supporting-document', key: 'supportingDocument', label: 'Supporting document', type: 'file', order: 120 }
  ];
}

function candidatePrefill(candidate = {}) {
  return {
    candidate: {
      name: candidateDisplayName(candidate),
      firstName: candidate.firstName || '',
      lastName: candidate.lastName || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      position: candidate.position || ''
    }
  };
}

async function ensureDefaultFormTemplate({ organization, userId }) {
  let template = await OnboardingFormTemplate.findOne({
    organization,
    isSystem: true,
    category: 'candidate-data',
    status: 'active'
  });

  if (!template) {
    template = await OnboardingFormTemplate.create({
      organization,
      name: 'Candidate data and payroll details',
      description: 'Reusable candidate form for legal, emergency contact, bank, tax, and identity fields.',
      category: 'candidate-data',
      isSystem: true,
      fields: defaultFormFields(),
      createdBy: userId
    });
  }

  return template;
}

function buildSubmissionValues(template, candidate) {
  const prefill = candidatePrefill(candidate);
  return (template.fields || []).map((field) => {
    const sensitive = isSensitiveField(field);
    const defaultValue = valueAtPath(prefill, field.defaultValuePath);
    return {
      fieldId: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      sensitive,
      value: sensitive ? undefined : defaultValue || '',
      encryptedValue: sensitive && defaultValue ? encryptValue(defaultValue) : undefined,
      valuePreview: valuePreview(defaultValue || '', field),
      files: [],
      updatedAt: new Date()
    };
  });
}

function snapshotFormTemplate(template) {
  return {
    _id: template._id,
    name: template.name,
    description: template.description,
    category: template.category,
    version: template.version,
    fields: template.fields || []
  };
}

async function updateProgress(onboardingId) {
  const items = await OnboardingWorkflowItem.find({ onboarding: onboardingId });
  const actionable = items.filter((item) => item.status !== 'skipped');
  const completed = actionable.filter((item) => item.status === 'completed').length;
  const percent = actionable.length ? Math.round((completed / actionable.length) * 100) : 0;
  await CandidateOnboarding.findByIdAndUpdate(onboardingId, {
    progress: {
      totalItems: actionable.length,
      completedItems: completed,
      percent
    }
  });
  return { totalItems: actionable.length, completedItems: completed, percent };
}

async function initializeDefaultWorkflow({ onboarding, candidate, userId, req }) {
  const formTemplate = await ensureDefaultFormTemplate({
    organization: onboarding.organization,
    userId
  });

  const submission = await OnboardingFormSubmission.create({
    organization: onboarding.organization,
    onboarding: onboarding._id,
    candidate: candidate._id,
    candidateAccount: onboarding.candidateAccount,
    formTemplate: formTemplate._id,
    templateSnapshot: snapshotFormTemplate(formTemplate),
    title: formTemplate.name,
    status: 'draft',
    hasSensitiveValues: formTemplate.fields.some((field) => isSensitiveField(field)),
    values: buildSubmissionValues(formTemplate, candidate)
  });

  const now = Date.now();
  const dueAt = new Date(now + 3 * 24 * 60 * 60 * 1000);
  const items = await OnboardingWorkflowItem.insertMany([
    {
      organization: onboarding.organization,
      onboarding: onboarding._id,
      type: 'form',
      title: 'Complete onboarding details',
      description: 'Candidate completes legal, contact, bank, tax, and custom onboarding fields.',
      status: 'pending',
      ownerType: 'candidate',
      sourceType: 'form_submission',
      sourceId: submission._id,
      order: 10,
      dueAt
    },
    {
      organization: onboarding.organization,
      onboarding: onboarding._id,
      type: 'document',
      title: 'Review and sign onboarding documents',
      description: 'Candidate and any internal signers complete the prepared document packet.',
      status: 'pending',
      ownerType: 'candidate',
      sourceType: 'envelope',
      order: 20,
      dueAt
    },
    {
      organization: onboarding.organization,
      onboarding: onboarding._id,
      type: 'approval',
      title: 'HR review sensitive information',
      description: 'HR reviews encrypted sensitive onboarding data before completion.',
      status: 'blocked',
      ownerType: 'user',
      sourceType: 'form_submission',
      sourceId: submission._id,
      order: 30
    },
    {
      organization: onboarding.organization,
      onboarding: onboarding._id,
      type: 'handoff',
      title: 'Create employee handoff',
      description: 'Mark the candidate as hired and prepare internal employee handoff data.',
      status: 'blocked',
      ownerType: 'system',
      sourceType: 'handoff',
      order: 40
    }
  ]);

  await CandidateOnboarding.findByIdAndUpdate(onboarding._id, {
    $addToSet: {
      forms: submission._id,
      workflowItems: { $each: items.map((item) => item._id) }
    },
    templateSnapshot: {
      name: onboarding.templateSnapshot?.name || 'Default onboarding packet',
      packetTemplate: onboarding.templateSnapshot?._id ? onboarding.templateSnapshot : undefined,
      formTemplates: [snapshotFormTemplate(formTemplate)],
      workflowItems: items.map((item) => ({
        type: item.type,
        title: item.title,
        ownerType: item.ownerType,
        order: item.order
      })),
      capturedAt: new Date()
    }
  });

  await updateProgress(onboarding._id);
  await logOnboardingEvent({
    req,
    organization: onboarding.organization,
    onboarding: onboarding._id,
    candidate: candidate._id,
    actorType: 'system',
    action: 'workflow_initialized',
    metadata: {
      workflowItems: items.length,
      formSubmission: submission._id
    }
  });

  return { formTemplate, submission, items };
}

async function attachEnvelopeToWorkflow({ onboardingId, envelopeId }) {
  const item = await OnboardingWorkflowItem.findOne({
    onboarding: onboardingId,
    type: 'document'
  }).sort({ order: 1 });
  if (!item) return null;
  item.sourceType = 'envelope';
  item.sourceId = envelopeId;
  if (item.status === 'not_started') item.status = 'pending';
  await item.save();
  await updateProgress(onboardingId);
  return item;
}

async function markDocumentWorkflowInProgress(onboardingId, envelopeId) {
  const item = await attachEnvelopeToWorkflow({ onboardingId, envelopeId });
  if (!item) return null;
  if (['pending', 'not_started'].includes(item.status)) {
    item.status = 'in_progress';
    await item.save();
    await updateProgress(onboardingId);
  }
  return item;
}

async function markDocumentWorkflowComplete(onboardingId, envelopeId) {
  const item = await attachEnvelopeToWorkflow({ onboardingId, envelopeId });
  if (!item) return null;
  item.status = 'completed';
  item.completedAt = new Date();
  await item.save();
  await updateProgress(onboardingId);
  return item;
}

function validateSubmissionFields(templateSnapshot, values = {}) {
  const errors = [];
  const byKey = values || {};
  (templateSnapshot.fields || []).forEach((field) => {
    const value = byKey[field.key] ?? byKey[field.id];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      errors.push(`${field.label} is required`);
    }
    if (!empty && field.validation?.maxLength && String(value).length > field.validation.maxLength) {
      errors.push(`${field.label} is too long`);
    }
  });
  return errors;
}

function buildSubmissionEntries(templateSnapshot, existingValues = [], incomingValues = {}, uploadedFilesByKey = {}) {
  const existingByKey = new Map((existingValues || []).map((entry) => [entry.key, entry]));
  return (templateSnapshot.fields || []).map((field) => {
    const existing = existingByKey.get(field.key) || {};
    const provided = Object.prototype.hasOwnProperty.call(incomingValues, field.key) ||
      Object.prototype.hasOwnProperty.call(incomingValues, field.id);
    const rawValue = provided ? (incomingValues[field.key] ?? incomingValues[field.id]) : existing.value;
    const files = uploadedFilesByKey[field.key] || existing.files || [];
    const sensitive = isSensitiveField(field);
    return {
      fieldId: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      sensitive,
      value: sensitive ? undefined : rawValue,
      encryptedValue: sensitive && rawValue !== undefined && rawValue !== null && rawValue !== ''
        ? encryptValue(rawValue)
        : existing.encryptedValue,
      valuePreview: files.length
        ? `${files.length} file(s)`
        : provided
          ? valuePreview(rawValue, field)
          : existing.valuePreview || valuePreview(rawValue, field),
      files,
      updatedAt: new Date()
    };
  });
}

async function saveCandidateFormSubmission({ submission, values, filesByKey = {}, submit = false, req }) {
  const errors = submit ? validateSubmissionFields(submission.templateSnapshot, values) : [];
  if (errors.length) {
    const error = new Error(errors.join('; '));
    error.statusCode = 400;
    throw error;
  }

  submission.values = buildSubmissionEntries(submission.templateSnapshot, submission.values, values, filesByKey);
  submission.hasSensitiveValues = submission.values.some((entry) => entry.sensitive);
  if (submit) {
    submission.status = submission.hasSensitiveValues ? 'under_review' : 'approved';
    submission.submittedAt = new Date();
  }
  await submission.save();

  const formItem = await OnboardingWorkflowItem.findOne({
    onboarding: submission.onboarding,
    sourceType: 'form_submission',
    sourceId: submission._id,
    type: 'form'
  });
  if (formItem && submit) {
    formItem.status = 'completed';
    formItem.completedAt = new Date();
    await formItem.save();
  }

  const approvalItem = await OnboardingWorkflowItem.findOne({
    onboarding: submission.onboarding,
    type: 'approval',
    sourceId: submission._id
  });
  if (approvalItem && submit) {
    if (submission.hasSensitiveValues) {
      approvalItem.status = 'pending';
      let approval = await OnboardingApproval.findOne({
        onboarding: submission.onboarding,
        formSubmission: submission._id,
        type: 'sensitive_data',
        status: 'pending'
      });
      if (!approval) {
        approval = await OnboardingApproval.create({
          organization: submission.organization,
          onboarding: submission.onboarding,
          candidate: submission.candidate,
          formSubmission: submission._id,
          workflowItem: approvalItem._id,
          type: 'sensitive_data',
          status: 'pending',
          requestedBy: 'candidate'
        });
      }
      const onboarding = await CandidateOnboarding.findById(submission.onboarding);
      if (onboarding) {
        onboarding.approvals = Array.from(new Set([...(onboarding.approvals || []), approval._id]));
        await onboarding.save();
      }
    } else {
      approvalItem.status = 'skipped';
      approvalItem.completedAt = new Date();
    }
    await approvalItem.save();
  }

  await updateProgress(submission.onboarding);
  await logOnboardingEvent({
    req,
    organization: submission.organization,
    onboarding: submission.onboarding,
    candidate: submission.candidate,
    actorType: req?.candidateAccount ? 'candidate' : 'system',
    actorCandidateAccount: req?.candidateAccount?._id,
    actorEmail: req?.candidateAccount?.email,
    action: submit ? 'form_submitted' : 'form_saved',
    metadata: {
      formSubmission: submission._id,
      hasSensitiveValues: submission.hasSensitiveValues
    }
  });

  await tryCompleteOnboarding(submission.onboarding, { req });
  return submission;
}

async function reviewFormSubmission({ submission, decision, reviewerId, reviewerEmail, notes, req }) {
  const approved = decision === 'approved';
  submission.status = approved ? 'approved' : 'rejected';
  submission.reviewedAt = new Date();
  submission.reviewedBy = reviewerId;
  submission.reviewerNotes = notes || '';
  submission.rejectionReason = approved ? '' : notes || 'Rejected during HR review';
  await submission.save();

  const approval = await OnboardingApproval.findOne({
    formSubmission: submission._id,
    status: 'pending'
  });
  if (approval) {
    approval.status = approved ? 'approved' : 'rejected';
    approval.reviewedBy = reviewerId;
    approval.reviewedAt = new Date();
    approval.notes = notes || '';
    await approval.save();
  }

  const approvalItem = await OnboardingWorkflowItem.findOne({
    onboarding: submission.onboarding,
    type: 'approval',
    sourceId: submission._id
  });
  if (approvalItem) {
    approvalItem.status = approved ? 'completed' : 'blocked';
    approvalItem.completedAt = approved ? new Date() : undefined;
    approvalItem.completedBy = approved ? reviewerId : undefined;
    await approvalItem.save();
  }

  if (!approved) {
    const formItem = await OnboardingWorkflowItem.findOne({
      onboarding: submission.onboarding,
      type: 'form',
      sourceId: submission._id
    });
    if (formItem) {
      formItem.status = 'pending';
      formItem.completedAt = undefined;
      await formItem.save();
    }
  }

  await logOnboardingEvent({
    req,
    organization: submission.organization,
    onboarding: submission.onboarding,
    candidate: submission.candidate,
    actorType: 'user',
    actorUser: reviewerId,
    actorEmail: reviewerEmail,
    action: approved ? 'form_approved' : 'form_rejected',
    metadata: {
      formSubmission: submission._id,
      approval: approval?._id
    }
  });

  await updateProgress(submission.onboarding);
  await tryCompleteOnboarding(submission.onboarding, { req });
  return submission;
}

async function tryCompleteOnboarding(onboardingId, { req } = {}) {
  const onboarding = await CandidateOnboarding.findById(onboardingId).populate('candidate');
  if (!onboarding || onboarding.status === 'cancelled') return null;

  const items = await OnboardingWorkflowItem.find({ onboarding: onboardingId });
  if (!items.length) {
    onboarding.status = 'completed';
    onboarding.completedAt = onboarding.completedAt || new Date();
    await onboarding.save();
    await Candidate.findByIdAndUpdate(onboarding.candidate._id, {
      status: 'Hired',
      hireDate: onboarding.candidate.hireDate || new Date()
    });
    return null;
  }

  const handoffItem = items.find((item) => item.type === 'handoff');
  const requiredItems = items.filter((item) => item.type !== 'handoff' && item.status !== 'skipped');
  const ready = requiredItems.length > 0 && requiredItems.every((item) => item.status === 'completed');

  if (!ready) {
    await updateProgress(onboardingId);
    return null;
  }

  let handoff = await OnboardingHandoff.findOne({
    onboarding: onboarding._id,
    target: 'internal_employee_profile'
  });
  if (!handoff) {
    handoff = await OnboardingHandoff.create({
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      workflowItem: handoffItem?._id,
      target: 'internal_employee_profile',
      status: 'pending',
      payload: {
        candidateId: onboarding.candidate._id,
        candidateEmail: onboarding.candidate.email,
        candidateName: candidateDisplayName(onboarding.candidate),
        onboardingId: onboarding._id,
        completedAt: new Date()
      }
    });
    onboarding.handoffs = Array.from(new Set([...(onboarding.handoffs || []), handoff._id]));
  }

  try {
    handoff.status = 'running';
    handoff.attempts += 1;
    await handoff.save();

    await Candidate.findByIdAndUpdate(onboarding.candidate._id, {
      status: 'Hired',
      hireDate: onboarding.candidate.hireDate || new Date()
    });

    handoff.status = 'completed';
    handoff.completedAt = new Date();
    handoff.lastError = '';
    await handoff.save();

    if (handoffItem) {
      handoffItem.status = 'completed';
      handoffItem.completedAt = new Date();
      await handoffItem.save();
    }

    onboarding.status = 'completed';
    onboarding.completedAt = onboarding.completedAt || new Date();
    onboarding.handoffs = Array.from(new Set([...(onboarding.handoffs || []), handoff._id]));
    await onboarding.save();

    await updateProgress(onboardingId);
    await logOnboardingEvent({
      req,
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      actorType: 'system',
      action: 'onboarding_handoff_completed',
      metadata: {
        handoff: handoff._id,
        candidateStatus: 'Hired'
      }
    });
  } catch (error) {
    handoff.status = 'failed';
    handoff.lastError = error.message;
    await handoff.save();
    if (handoffItem) {
      handoffItem.status = 'failed';
      await handoffItem.save();
    }
  }

  return handoff;
}

async function serializeOnboardingPlatform(onboarding) {
  if (!onboarding) return onboarding;
  const [workflowItems, formSubmissions, approvals, handoffs] = await Promise.all([
    OnboardingWorkflowItem.find({ onboarding: onboarding._id }).sort({ order: 1, createdAt: 1 }),
    OnboardingFormSubmission.find({ onboarding: onboarding._id }).sort({ createdAt: 1 }),
    OnboardingApproval.find({ onboarding: onboarding._id }).sort({ createdAt: -1 }),
    OnboardingHandoff.find({ onboarding: onboarding._id }).sort({ createdAt: -1 })
  ]);

  const raw = typeof onboarding.toObject === 'function' ? onboarding.toObject() : onboarding;
  return {
    ...raw,
    workflowItems,
    forms: formSubmissions.map((submission) => serializeSubmission(submission)),
    approvals,
    handoffs
  };
}

module.exports = {
  attachEnvelopeToWorkflow,
  ensureDefaultFormTemplate,
  initializeDefaultWorkflow,
  markDocumentWorkflowComplete,
  markDocumentWorkflowInProgress,
  reviewFormSubmission,
  saveCandidateFormSubmission,
  serializeOnboardingPlatform,
  tryCompleteOnboarding,
  updateProgress
};
