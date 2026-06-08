const Candidate = require('../models/Candidate');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingApproval = require('../models/OnboardingApproval');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingFormTemplate = require('../models/OnboardingFormTemplate');
const OnboardingHandoff = require('../models/OnboardingHandoff');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
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

const PROCESS_TYPES = ['onboarding', 'exit', 'retirement'];

const PROCESS_COPY = {
  onboarding: {
    label: 'Onboarding',
    defaultTitle: 'Candidate data and payroll details',
    defaultDescription: 'Reusable candidate form for legal, emergency contact, bank, tax, and identity fields.',
    category: 'candidate-data',
    formTitle: 'Complete onboarding details',
    formDescription: 'Candidate completes legal, contact, bank, tax, and custom onboarding fields.',
    documentTitle: 'Review and sign onboarding documents',
    documentDescription: 'Candidate and any internal signers complete the prepared document packet.',
    approvalTitle: 'HR review sensitive information',
    approvalDescription: 'HR reviews encrypted sensitive onboarding data before completion.',
    handoffTitle: 'Create employee handoff',
    handoffDescription: 'Mark the candidate as hired and prepare internal employee handoff data.',
    handoffTarget: 'internal_employee_profile',
    candidateStatus: 'Hired',
    dateField: 'hireDate',
    handoffAction: 'onboarding_handoff_completed'
  },
  exit: {
    label: 'Exit',
    defaultTitle: 'Exit details and asset return',
    defaultDescription: 'Reusable exit form for final work details, property return, and closing notes.',
    category: 'exit-data',
    formTitle: 'Complete exit details',
    formDescription: 'Candidate confirms final employment details, forwarding contact, and company property return.',
    documentTitle: 'Review and sign exit documents',
    documentDescription: 'Candidate and any internal signers complete the prepared exit document packet.',
    approvalTitle: 'HR review exit information',
    approvalDescription: 'HR reviews sensitive exit information before closeout.',
    handoffTitle: 'Complete exit closeout',
    handoffDescription: 'Mark the candidate as exited and prepare final internal closeout data.',
    handoffTarget: 'exit_closeout',
    candidateStatus: 'Exited',
    dateField: 'exitDate',
    handoffAction: 'exit_handoff_completed'
  },
  retirement: {
    label: 'Retirement',
    defaultTitle: 'Retirement details and benefits',
    defaultDescription: 'Reusable retirement form for retirement dates, benefits contact, and final notes.',
    category: 'retirement-data',
    formTitle: 'Complete retirement details',
    formDescription: 'Candidate confirms retirement details, benefits contact, and final documentation needs.',
    documentTitle: 'Review and sign retirement documents',
    documentDescription: 'Candidate and any internal signers complete the prepared retirement document packet.',
    approvalTitle: 'HR review retirement information',
    approvalDescription: 'HR reviews sensitive retirement information before closeout.',
    handoffTitle: 'Complete retirement closeout',
    handoffDescription: 'Mark the candidate as retired and prepare final internal closeout data.',
    handoffTarget: 'retirement_closeout',
    candidateStatus: 'Retired',
    dateField: 'retirementDate',
    handoffAction: 'retirement_handoff_completed'
  }
};

function normalizeProcessType(processType) {
  return PROCESS_TYPES.includes(processType) ? processType : 'onboarding';
}

function processCopy(processType) {
  return PROCESS_COPY[normalizeProcessType(processType)];
}

function valueAtPath(source, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function defaultFormFields(processType = 'onboarding') {
  const normalized = normalizeProcessType(processType);
  if (normalized === 'exit') {
    return [
      { id: 'final-working-day', key: 'finalWorkingDay', label: 'Final working day', type: 'date', required: true, order: 10 },
      { id: 'forwarding-email', key: 'forwardingEmail', label: 'Forwarding email', type: 'email', required: true, defaultValuePath: 'candidate.email', order: 20 },
      { id: 'forwarding-phone', key: 'forwardingPhone', label: 'Forwarding phone', type: 'phone', defaultValuePath: 'candidate.phone', order: 30 },
      { id: 'forwarding-address', key: 'forwardingAddress', label: 'Forwarding address', type: 'address', order: 40 },
      { id: 'property-returned', key: 'propertyReturned', label: 'Company property returned', type: 'checkbox', required: true, order: 50 },
      { id: 'asset-notes', key: 'assetNotes', label: 'Asset return notes', type: 'textarea', order: 60 },
      { id: 'final-pay-notes', key: 'finalPayNotes', label: 'Final pay notes', type: 'textarea', sensitive: true, order: 70 },
      { id: 'supporting-document', key: 'supportingDocument', label: 'Supporting document', type: 'file', order: 80 }
    ];
  }

  if (normalized === 'retirement') {
    return [
      { id: 'retirement-date', key: 'retirementDate', label: 'Retirement date', type: 'date', required: true, order: 10 },
      { id: 'benefits-email', key: 'benefitsEmail', label: 'Benefits contact email', type: 'email', required: true, defaultValuePath: 'candidate.email', order: 20 },
      { id: 'benefits-phone', key: 'benefitsPhone', label: 'Benefits contact phone', type: 'phone', defaultValuePath: 'candidate.phone', order: 30 },
      { id: 'mailing-address', key: 'mailingAddress', label: 'Mailing address', type: 'address', required: true, order: 40 },
      { id: 'pension-reference', key: 'pensionReference', label: 'Pension or benefits reference', type: 'text', sensitive: true, order: 50 },
      { id: 'retirement-notes', key: 'retirementNotes', label: 'Retirement notes', type: 'textarea', order: 60 },
      { id: 'supporting-document', key: 'supportingDocument', label: 'Supporting document', type: 'file', order: 70 }
    ];
  }

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

async function ensureDefaultFormTemplate({ organization, userId, processType = 'onboarding' }) {
  const normalizedProcessType = normalizeProcessType(processType);
  const copy = processCopy(normalizedProcessType);
  let template = await OnboardingFormTemplate.findOne({
    organization,
    isSystem: true,
    category: copy.category,
    status: 'active'
  });

  if (!template) {
    template = await OnboardingFormTemplate.create({
      organization,
      name: copy.defaultTitle,
      description: copy.defaultDescription,
      category: copy.category,
      isSystem: true,
      fields: defaultFormFields(normalizedProcessType),
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
  const normalizedProcessType = normalizeProcessType(onboarding.processType);
  const copy = processCopy(normalizedProcessType);
  const formTemplate = await ensureDefaultFormTemplate({
    organization: onboarding.organization,
    userId,
    processType: normalizedProcessType
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
      title: copy.formTitle,
      description: copy.formDescription,
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
      title: copy.documentTitle,
      description: copy.documentDescription,
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
      title: copy.approvalTitle,
      description: copy.approvalDescription,
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
      title: copy.handoffTitle,
      description: copy.handoffDescription,
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
      name: onboarding.templateSnapshot?.name || `Default ${copy.label.toLowerCase()} packet`,
      processType: normalizedProcessType,
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
      const onboarding = await CandidateOnboarding.findById(submission.onboarding).populate('candidate');
      if (onboarding) {
        onboarding.approvals = Array.from(new Set([...(onboarding.approvals || []), approval._id]));
        await onboarding.save();
        const copy = processCopy(onboarding.processType);
        await createPeopleTransitionNotifications({
          organization: submission.organization,
          onboarding,
          candidate: onboarding.candidate,
          notificationType: 'people_transition_action',
          title: `${copy.label} needs HR review`,
          message: `${candidateDisplayName(onboarding.candidate)} submitted sensitive ${copy.label.toLowerCase()} details for review.`,
          priority: 'high'
        });
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
  const normalizedProcessType = normalizeProcessType(onboarding.processType);
  const copy = processCopy(normalizedProcessType);

  const items = await OnboardingWorkflowItem.find({ onboarding: onboardingId });
  if (!items.length) {
    onboarding.status = 'completed';
    onboarding.completedAt = onboarding.completedAt || new Date();
    await onboarding.save();
    await Candidate.findByIdAndUpdate(onboarding.candidate._id, candidateCompletionUpdate(onboarding.candidate, copy));
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
    target: copy.handoffTarget
  });
  if (!handoff) {
    handoff = await OnboardingHandoff.create({
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: onboarding.candidate._id,
      workflowItem: handoffItem?._id,
      target: copy.handoffTarget,
      status: 'pending',
      payload: {
        processType: normalizedProcessType,
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

    await Candidate.findByIdAndUpdate(onboarding.candidate._id, candidateCompletionUpdate(onboarding.candidate, copy));

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
      action: copy.handoffAction,
      metadata: {
        handoff: handoff._id,
        processType: normalizedProcessType,
        candidateStatus: copy.candidateStatus
      }
    });

    await createPeopleTransitionNotifications({
      organization: onboarding.organization,
      onboarding,
      candidate: onboarding.candidate,
      notificationType: 'people_transition_completed',
      title: `${copy.label} completed`,
      message: `${candidateDisplayName(onboarding.candidate)} has completed the ${copy.label.toLowerCase()} process.`,
      priority: 'medium'
    });
  } catch (error) {
    handoff.status = 'failed';
    handoff.lastError = error.message;
    await handoff.save();
    if (handoffItem) {
      handoffItem.status = 'failed';
      await handoffItem.save();
    }
    await createPeopleTransitionNotifications({
      organization: onboarding.organization,
      onboarding,
      candidate: onboarding.candidate,
      notificationType: 'people_transition_action',
      title: `${copy.label} closeout failed`,
      message: `${candidateDisplayName(onboarding.candidate)} could not be closed out automatically: ${error.message}`,
      priority: 'high'
    });
  }

  return handoff;
}

function candidateCompletionUpdate(candidate, copy) {
  const completedAt = new Date();
  const update = { status: copy.candidateStatus };
  if (!candidate?.[copy.dateField]) {
    update[copy.dateField] = completedAt;
  }
  return update;
}

async function createPeopleTransitionNotifications({
  organization,
  onboarding,
  candidate,
  notificationType = 'people_transition_action',
  title,
  message,
  priority = 'medium',
  actorUserId
}) {
  try {
    const organizationId = organization?._id || organization;
    if (!organizationId || !onboarding?._id) return [];

    const orgDoc = await Organization.findById(organizationId).select('name members').lean();
    if (!orgDoc) return [];

    const userIds = (orgDoc.members || [])
      .filter((member) => member.status === 'active' && member.user)
      .map((member) => member.user);

    const uniqueUserIds = Array.from(new Set([
      ...(actorUserId ? [String(actorUserId)] : []),
      ...userIds.map((id) => String(id))
    ]));
    if (!uniqueUserIds.length) return [];

    const processType = normalizeProcessType(onboarding.processType);
    const copy = processCopy(processType);
    const candidateId = candidate?._id || onboarding.candidate;
    const candidateLabel = candidateDisplayName(candidate || {});
    const transitionTitle = title || `${copy.label} update: ${candidateLabel}`;
    const transitionMessage = message || `${candidateLabel} has a ${copy.label.toLowerCase()} update.`;

    return Notification.insertMany(uniqueUserIds.map((userId) => ({
      user: userId,
      type: notificationType,
      title: transitionTitle,
      message: transitionMessage,
      data: {
        organizationId,
        organizationName: orgDoc.name,
        onboardingId: onboarding._id,
        transitionId: onboarding._id,
        processType,
        candidateId,
        candidateName: candidateLabel
      },
      actionUrl: `/people-transitions/${onboarding._id}`,
      actionText: 'Open transition',
      priority
    })), { ordered: false });
  } catch (error) {
    console.error('Failed to create people transition notification:', error);
    return [];
  }
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
    processType: normalizeProcessType(raw.processType),
    workflowItems,
    forms: formSubmissions.map((submission) => serializeSubmission(submission)),
    approvals,
    handoffs
  };
}

module.exports = {
  PROCESS_COPY,
  PROCESS_TYPES,
  attachEnvelopeToWorkflow,
  createPeopleTransitionNotifications,
  ensureDefaultFormTemplate,
  initializeDefaultWorkflow,
  markDocumentWorkflowComplete,
  markDocumentWorkflowInProgress,
  normalizeProcessType,
  processCopy,
  reviewFormSubmission,
  saveCandidateFormSubmission,
  serializeOnboardingPlatform,
  tryCompleteOnboarding,
  updateProgress
};
