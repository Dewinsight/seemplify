const Candidate = require('../models/Candidate');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingApproval = require('../models/OnboardingApproval');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingFormTemplate = require('../models/OnboardingFormTemplate');
const OnboardingHandoff = require('../models/OnboardingHandoff');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const { logOnboardingEvent } = require('./onboardingAuditService');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');
const { normalizeOrganizationBrand } = require('../utils/organizationBrand');
const { performIdentityAction } = require('./idpMembershipLifecycleService');
const {
  encryptValue,
  isSensitiveField,
  serializeSubmission,
  valuePreview
} = require('./onboardingSecurityService');

function candidateDisplayName(candidate = {}) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email || 'Candidate';
}

const PROCESS_TYPES = ['onboarding', 'exit', 'retirement', 'agreement', 'policy', 'general', 'team_signing', 'compliance_documents'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ENVELOPE_STATUSES = ['sent', 'viewed', 'partially_signed'];
const ACTIVE_WORKFLOW_STATUSES = ['not_started', 'pending', 'in_progress', 'blocked', 'failed'];
const FORM_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'phone',
  'date',
  'number',
  'select',
  'checkbox',
  'bank_account',
  'routing_number',
  'tax_id',
  'address',
  'file',
  'image'
]);

const DEFAULT_DUE_OFFSETS = {
  onboarding: { form: 2, document: 3, approval: 5, handoff: 7, task: 7 },
  exit: { form: 1, document: 2, approval: 3, handoff: 3, task: 3 },
  retirement: { form: 2, document: 3, approval: 5, handoff: 7, task: 7 }
  ,agreement: { form: 3, document: 5, approval: 5, handoff: 7, task: 5 }
  ,policy: { form: 3, document: 5, approval: 5, handoff: 7, task: 5 }
  ,general: { form: 3, document: 5, approval: 5, handoff: 7, task: 5 }
  ,team_signing: { form: 3, document: 5, approval: 5, handoff: 7, task: 5 }
  ,compliance_documents: { form: 3, document: 5, approval: 5, handoff: 7, task: 5 }
};

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
  },
  agreement: {
    label: 'Agreement', defaultTitle: 'Agreement workflow', defaultDescription: 'Agreement review and signing workflow.', category: 'agreement',
    formTitle: 'Provide agreement details', formDescription: 'Provide the information required for this agreement.',
    documentTitle: 'Review and sign agreement', documentDescription: 'Review and complete the agreement documents.',
    approvalTitle: 'Approve agreement', approvalDescription: 'An authorized reviewer approves the completed agreement.',
    handoffTitle: 'Complete agreement', handoffDescription: 'Complete the agreement workflow.', handoffTarget: 'custom',
    candidateStatus: undefined, dateField: undefined, handoffAction: 'agreement_completed'
  },
  policy: {
    label: 'Policy', defaultTitle: 'Policy acknowledgement', defaultDescription: 'Policy distribution and acknowledgement workflow.', category: 'policy',
    formTitle: 'Confirm policy details', formDescription: 'Provide any information required by the policy.',
    documentTitle: 'Review and acknowledge policy', documentDescription: 'Review the policy and record acknowledgement.',
    approvalTitle: 'Review policy completion', approvalDescription: 'An authorized reviewer verifies completion.',
    handoffTitle: 'Complete policy workflow', handoffDescription: 'Complete the policy workflow.', handoffTarget: 'custom',
    candidateStatus: undefined, dateField: undefined, handoffAction: 'policy_completed'
  },
  general: {
    label: 'General workflow', defaultTitle: 'People workflow', defaultDescription: 'Configurable employee or candidate workflow.', category: 'general',
    formTitle: 'Complete requested information', formDescription: 'Provide the information requested for this workflow.',
    documentTitle: 'Review workflow documents', documentDescription: 'Review and complete the workflow documents.',
    approvalTitle: 'Review completion', approvalDescription: 'An authorized reviewer verifies completion.',
    handoffTitle: 'Complete workflow', handoffDescription: 'Complete the workflow.', handoffTarget: 'custom',
    candidateStatus: undefined, dateField: undefined, handoffAction: 'general_workflow_completed'
  },
  team_signing: {
    label: 'Team signing', defaultTitle: 'Team signing workflow', defaultDescription: 'Multi-signer document workflow.', category: 'team-signing',
    formTitle: 'Confirm signer information', formDescription: 'Confirm the information needed for signing.',
    documentTitle: 'Complete team signing', documentDescription: 'All required signers review and sign the documents.',
    approvalTitle: 'Review signatures', approvalDescription: 'An authorized reviewer verifies all signatures.',
    handoffTitle: 'Complete signing workflow', handoffDescription: 'Complete the team signing workflow.', handoffTarget: 'custom',
    candidateStatus: undefined, dateField: undefined, handoffAction: 'team_signing_completed'
  },
  compliance_documents: {
    label: 'Compliance documents', defaultTitle: 'Compliance document workflow', defaultDescription: 'Collect, validate and track compliance documents.', category: 'compliance',
    formTitle: 'Provide compliance details', formDescription: 'Provide the required compliance information.',
    documentTitle: 'Provide compliance documents', documentDescription: 'Upload or sign the required compliance documents.',
    approvalTitle: 'Review compliance documents', approvalDescription: 'An authorized reviewer validates the documents.',
    handoffTitle: 'Complete compliance workflow', handoffDescription: 'Complete the compliance document workflow.', handoffTarget: 'custom',
    candidateStatus: undefined, dateField: undefined, handoffAction: 'compliance_documents_completed'
  }
};

function normalizeProcessType(processType) {
  return PROCESS_TYPES.includes(processType) ? processType : 'onboarding';
}

function processCopy(processType) {
  return PROCESS_COPY[normalizeProcessType(processType)];
}

function objectIdString(value) {
  return String(value?._id || value || '');
}

function dueDateFromOffset(startDate, offsetDays) {
  const offset = Number(offsetDays);
  if (!Number.isFinite(offset)) return undefined;
  const base = startDate ? new Date(startDate).getTime() : Date.now();
  return new Date(base + offset * DAY_MS);
}

function workflowDueOffset(processType, type, item = {}) {
  const normalizedProcessType = normalizeProcessType(processType);
  const fallback = DEFAULT_DUE_OFFSETS[normalizedProcessType]?.[type] ?? 3;
  if (Number.isFinite(Number(item.dueOffsetDays))) return Number(item.dueOffsetDays);
  if (Number.isFinite(Number(item.dueInDays))) return Number(item.dueInDays);
  return fallback;
}

function workflowItemKey(item = {}, index = 0) {
  return item.id || item.key || item.metadata?.templateItemId || `${item.type || 'item'}-${index + 1}`;
}

function defaultWorkflowItemDefinitions(processType = 'onboarding') {
  const normalizedProcessType = normalizeProcessType(processType);
  const copy = processCopy(normalizedProcessType);

  if (['agreement', 'policy', 'general', 'team_signing', 'compliance_documents'].includes(normalizedProcessType)) {
    return [
      { id: `${normalizedProcessType}-form`, type: 'form', title: copy.formTitle, description: copy.formDescription, ownerType: 'candidate', dueOffsetDays: 3, order: 10 },
      { id: `${normalizedProcessType}-documents`, type: 'document', title: copy.documentTitle, description: copy.documentDescription, ownerType: 'candidate', dueOffsetDays: 5, order: 20 },
      { id: `${normalizedProcessType}-review`, type: 'approval', title: copy.approvalTitle, description: copy.approvalDescription, ownerType: 'user', defaultOwnerRole: 'hr', dueOffsetDays: 5, order: 30, dependencyKeys: [`${normalizedProcessType}-form`, `${normalizedProcessType}-documents`] }
    ];
  }

  if (normalizedProcessType === 'exit') {
    return [
      {
        id: 'exit-form',
        type: 'form',
        title: copy.formTitle,
        description: copy.formDescription,
        ownerType: 'candidate',
        dueOffsetDays: 1,
        order: 10
      },
      {
        id: 'exit-documents',
        type: 'document',
        title: copy.documentTitle,
        description: copy.documentDescription,
        ownerType: 'candidate',
        dueOffsetDays: 2,
        order: 20
      },
      {
        id: 'exit-hr-review',
        type: 'approval',
        title: copy.approvalTitle,
        description: copy.approvalDescription,
        ownerType: 'user',
        defaultOwnerRole: 'hr',
        dueOffsetDays: 3,
        order: 30,
        dependencyKeys: ['exit-form']
      },
      {
        id: 'exit-manager-handover',
        type: 'task',
        title: 'Manager handover',
        description: 'Confirm final responsibilities, knowledge transfer, and manager sign-off.',
        ownerType: 'user',
        defaultOwnerRole: 'manager',
        dueOffsetDays: 3,
        order: 40,
        dependencyKeys: ['exit-form', 'exit-documents', 'exit-hr-review'],
        metadata: { handoffTarget: 'manager_handover' }
      },
      {
        id: 'exit-asset-return',
        type: 'task',
        title: 'Asset and property return',
        description: 'Confirm laptop, badge, keys, equipment, and other company property are returned or accounted for.',
        ownerType: 'user',
        defaultOwnerRole: 'facilities',
        dueOffsetDays: 3,
        order: 50,
        dependencyKeys: ['exit-form', 'exit-documents', 'exit-hr-review'],
        metadata: { handoffTarget: 'asset_return' }
      },
      {
        id: 'exit-it-access-removal',
        type: 'task',
        title: 'IT access removal',
        description: 'Confirm application, device, and identity access removal is recorded.',
        ownerType: 'user',
        defaultOwnerRole: 'it',
        dueOffsetDays: 3,
        order: 60,
        dependencyKeys: ['exit-form', 'exit-documents', 'exit-hr-review'],
        metadata: { handoffTarget: 'it_access_removal' }
      },
      {
        id: 'exit-payroll-finalization',
        type: 'task',
        title: 'Payroll finalization',
        description: 'Confirm final pay, deductions, benefits, and statutory closeout are recorded.',
        ownerType: 'user',
        defaultOwnerRole: 'payroll',
        dueOffsetDays: 3,
        order: 70,
        dependencyKeys: ['exit-form', 'exit-documents', 'exit-hr-review'],
        metadata: { handoffTarget: 'payroll_finalization' }
      },
      {
        id: 'exit-closeout',
        type: 'handoff',
        title: copy.handoffTitle,
        description: copy.handoffDescription,
        ownerType: 'system',
        dueOffsetDays: 3,
        order: 80,
        dependencyKeys: [
          'exit-manager-handover',
          'exit-asset-return',
          'exit-it-access-removal',
          'exit-payroll-finalization'
        ],
        metadata: { handoffTarget: 'exit_closeout' }
      }
    ];
  }

  if (normalizedProcessType === 'retirement') {
    return [
      {
        id: 'retirement-form',
        type: 'form',
        title: copy.formTitle,
        description: copy.formDescription,
        ownerType: 'candidate',
        dueOffsetDays: 2,
        order: 10
      },
      {
        id: 'retirement-documents',
        type: 'document',
        title: copy.documentTitle,
        description: copy.documentDescription,
        ownerType: 'candidate',
        dueOffsetDays: 3,
        order: 20
      },
      {
        id: 'retirement-hr-review',
        type: 'approval',
        title: copy.approvalTitle,
        description: copy.approvalDescription,
        ownerType: 'user',
        defaultOwnerRole: 'hr',
        dueOffsetDays: 5,
        order: 30,
        dependencyKeys: ['retirement-form']
      },
      {
        id: 'retirement-benefits-review',
        type: 'task',
        title: 'Benefits and payroll review',
        description: 'Confirm retirement benefits, payroll closeout, and contact details are recorded.',
        ownerType: 'user',
        defaultOwnerRole: 'payroll',
        dueOffsetDays: 7,
        order: 40,
        dependencyKeys: ['retirement-form', 'retirement-documents', 'retirement-hr-review'],
        metadata: { handoffTarget: 'payroll_finalization' }
      },
      {
        id: 'retirement-closeout',
        type: 'handoff',
        title: copy.handoffTitle,
        description: copy.handoffDescription,
        ownerType: 'system',
        dueOffsetDays: 7,
        order: 50,
        dependencyKeys: ['retirement-benefits-review'],
        metadata: { handoffTarget: 'retirement_closeout' }
      }
    ];
  }

  return [
    {
      id: 'onboarding-form',
      type: 'form',
      title: copy.formTitle,
      description: copy.formDescription,
      ownerType: 'candidate',
      dueOffsetDays: 2,
      order: 10
    },
    {
      id: 'onboarding-documents',
      type: 'document',
      title: copy.documentTitle,
      description: copy.documentDescription,
      ownerType: 'candidate',
      dueOffsetDays: 3,
      order: 20
    },
    {
      id: 'onboarding-hr-review',
      type: 'approval',
      title: copy.approvalTitle,
      description: copy.approvalDescription,
      ownerType: 'user',
      defaultOwnerRole: 'hr',
      dueOffsetDays: 5,
      order: 30,
      dependencyKeys: ['onboarding-form']
    },
    {
      id: 'onboarding-handoff',
      type: 'handoff',
      title: copy.handoffTitle,
      description: copy.handoffDescription,
      ownerType: 'system',
      dueOffsetDays: 7,
      order: 40,
      dependencyKeys: ['onboarding-documents', 'onboarding-hr-review'],
      metadata: { handoffTarget: 'internal_employee_profile' }
    }
  ];
}

function valueAtPath(source, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function safeFormKey(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_match, char) => char.toUpperCase())
    .replace(/^[^a-z]+/i, '')
    .slice(0, 80) || fallback;
}

function safeFormFieldId(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || fallback;
}

function normalizeFormFields(fields = []) {
  const seenKeys = new Set();
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && (field.label || field.key || field.id))
    .map((field, index) => {
      const label = String(field.label || field.key || field.id || `Field ${index + 1}`).trim().slice(0, 120);
      const fallbackKey = safeFormKey(label, `field${index + 1}`);
      let key = safeFormKey(field.key, fallbackKey);
      if (seenKeys.has(key)) key = `${key}${index + 1}`;
      seenKeys.add(key);
      const type = FORM_FIELD_TYPES.has(field.type) ? field.type : 'text';
      return {
        id: safeFormFieldId(field.id, key),
        key,
        label,
        type,
        required: Boolean(field.required),
        sensitive: ['file', 'image'].includes(type) ? false : Boolean(field.sensitive),
        options: Array.isArray(field.options) ? field.options.map((option) => String(option).trim()).filter(Boolean) : [],
        placeholder: String(field.placeholder || '').trim(),
        helpText: String(field.helpText || '').trim(),
        defaultValuePath: String(field.defaultValuePath || '').trim(),
        validation: field.validation && typeof field.validation === 'object' ? field.validation : undefined,
        order: Number.isFinite(Number(field.order)) ? Number(field.order) : (index + 1) * 10
      };
    })
    .sort((a, b) => a.order - b.order);
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
    { id: 'phone', key: 'phone', label: 'Mobile phone', type: 'phone', required: true, defaultValuePath: 'candidate.phone', order: 40 },
    { id: 'date-of-birth', key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true, sensitive: true, order: 50 },
    { id: 'address', key: 'address', label: 'Home address', type: 'address', required: true, order: 60 },
    { id: 'emergency-contact-name', key: 'emergencyContactName', label: 'Emergency contact name', type: 'text', required: true, order: 70 },
    { id: 'emergency-contact-relationship', key: 'emergencyContactRelationship', label: 'Emergency contact relationship', type: 'text', required: true, order: 80 },
    { id: 'emergency-contact-phone', key: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'phone', required: true, order: 90 },
    { id: 'emergency-contact-email', key: 'emergencyContactEmail', label: 'Emergency contact email', type: 'email', order: 100 },
    { id: 'bank-country', key: 'bankCountry', label: 'Bank country', type: 'select', required: true, options: ['USA', 'UK', 'EU', 'Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Other'], order: 110 },
    { id: 'bank-name', key: 'bankName', label: 'Bank name', type: 'text', required: true, sensitive: true, order: 120 },
    { id: 'bank-account-name', key: 'bankAccountName', label: 'Account holder name', type: 'text', required: true, sensitive: true, order: 130 },
    { id: 'bank-identifier', key: 'bankIdentifier', label: 'Routing, sort, bank, BIC or SWIFT code', type: 'routing_number', required: true, sensitive: true, order: 140 },
    { id: 'bank-account-number', key: 'bankAccountNumber', label: 'Account number or IBAN', type: 'bank_account', required: true, sensitive: true, order: 150 },
    { id: 'tax-id', key: 'taxId', label: 'Tax or national insurance ID', type: 'tax_id', required: true, sensitive: true, order: 160 },
    { id: 'dependents-status', key: 'dependentsStatus', label: 'Dependents declaration', type: 'select', required: true, options: ['none', 'provided'], order: 170 },
    { id: 'dependents-count', key: 'dependentsCount', label: 'Number of dependents', type: 'number', required: true, helpText: 'Enter 0 when you have no dependents.', order: 180 },
    { id: 'profile-or-id-image', key: 'profileOrIdImage', label: 'Profile or ID image', type: 'image', helpText: 'Upload a clear image requested by HR, such as a profile photo or ID scan.', order: 190 },
    { id: 'supporting-document', key: 'supportingDocument', label: 'Supporting document', type: 'file', order: 200 }
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
  } else if (template.isSystem) {
    const expectedFields = defaultFormFields(normalizedProcessType);
    const currentSignature = (template.fields || []).map((field) => `${field.key}:${field.required}`).join('|');
    const expectedSignature = expectedFields.map((field) => `${field.key}:${field.required}`).join('|');
    if (currentSignature !== expectedSignature) {
      template.fields = expectedFields;
      template.description = copy.defaultDescription;
      template.updatedBy = userId;
      template.version = Number(template.version || 1) + 1;
      await template.save();
    }
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

function customCandidateFormTemplate({ candidateForm, processType }) {
  const fields = normalizeFormFields(candidateForm?.fields || []);
  if (!fields.length) return null;
  const copy = processCopy(processType);
  return {
    _id: undefined,
    name: String(candidateForm?.title || copy.defaultTitle).trim() || copy.defaultTitle,
    description: String(candidateForm?.description || copy.defaultDescription).trim(),
    category: copy.category,
    version: 1,
    fields,
    isSystem: false
  };
}

async function formTemplatesForWorkflow({ onboarding, userId, processType, packetTemplate, candidateForm }) {
  const customFormTemplate = customCandidateFormTemplate({ candidateForm, processType });
  if (customFormTemplate) return [customFormTemplate];

  const formTemplateIds = (packetTemplate?.formTemplates || [])
    .map((template) => template?._id || template)
    .filter(Boolean);

  if (formTemplateIds.length) {
    const templates = await OnboardingFormTemplate.find({
      _id: { $in: formTemplateIds },
      organization: onboarding.organization,
      status: { $ne: 'archived' }
    });
    if (templates.length) return templates;
  }

  return [await ensureDefaultFormTemplate({
    organization: onboarding.organization,
    userId,
    processType
  })];
}

function sourceForWorkflowItem(item, submissions, counters) {
  const source = { sourceType: 'manual', sourceId: undefined };
  if (item.type === 'form') {
    const submission = submissions[counters.form] || submissions[0];
    counters.form += 1;
    source.sourceType = 'form_submission';
    source.sourceId = submission?._id;
    return source;
  }
  if (item.type === 'approval') {
    const submission = submissions.find((entry) => entry.hasSensitiveValues) || submissions[0];
    source.sourceType = 'form_submission';
    source.sourceId = submission?._id;
    return source;
  }
  if (item.type === 'document') {
    source.sourceType = 'envelope';
    return source;
  }
  if (item.type === 'handoff') {
    source.sourceType = 'handoff';
    return source;
  }
  return source;
}

function initialWorkflowStatus(item) {
  if (['not_started', 'pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed'].includes(item.status)) {
    return item.status;
  }
  if ((item.dependencyKeys || []).length || ['approval', 'handoff'].includes(item.type)) return 'blocked';
  return 'pending';
}

async function refreshBlockedWorkflowItems(onboardingId) {
  const items = await OnboardingWorkflowItem.find({ onboarding: onboardingId });
  const byId = new Map(items.map((item) => [objectIdString(item._id), item]));
  const changed = [];

  for (const item of items) {
    if (item.status !== 'blocked' || !(item.dependencies || []).length) continue;
    const ready = item.dependencies.every((dependencyId) => {
      const dependency = byId.get(objectIdString(dependencyId));
      return dependency && ['completed', 'skipped'].includes(dependency.status);
    });
    if (ready) {
      item.status = 'pending';
      changed.push(item.save());
    }
  }

  if (changed.length) await Promise.all(changed);
  return changed.length;
}

async function initializeDefaultWorkflow({ onboarding, candidate, userId, req, packetTemplate, candidateForm }) {
  const normalizedProcessType = normalizeProcessType(onboarding.processType);
  const copy = processCopy(normalizedProcessType);
  const formTemplates = await formTemplatesForWorkflow({
    onboarding,
    userId,
    processType: normalizedProcessType,
    packetTemplate,
    candidateForm
  });

  const submissions = [];
  for (const formTemplate of formTemplates) {
    submissions.push(await OnboardingFormSubmission.create({
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: candidate._id,
      candidateAccount: onboarding.candidateAccount,
      formTemplate: formTemplate._id || undefined,
      templateSnapshot: snapshotFormTemplate(formTemplate),
      title: formTemplate.name,
      status: 'draft',
      hasSensitiveValues: formTemplate.fields.some((field) => isSensitiveField(field)),
      values: buildSubmissionValues(formTemplate, candidate)
    }));
  }

  const templateWorkflowItems = Array.isArray(packetTemplate?.workflowItems) && packetTemplate.workflowItems.length
    ? packetTemplate.workflowItems.map((item) => (typeof item.toObject === 'function' ? item.toObject() : item))
    : defaultWorkflowItemDefinitions(normalizedProcessType);
  const counters = { form: 0 };
  const itemKeys = templateWorkflowItems.map((item, index) => workflowItemKey(item, index));
  const insertedItems = await OnboardingWorkflowItem.insertMany(templateWorkflowItems.map((item, index) => {
    const source = sourceForWorkflowItem(item, submissions, counters);
    const dueOffset = workflowDueOffset(normalizedProcessType, item.type, item);
    return {
      organization: onboarding.organization,
      onboarding: onboarding._id,
      type: item.type,
      title: item.title || copy.formTitle,
      description: item.description || '',
      status: initialWorkflowStatus(item),
      ownerType: ['candidate', 'user', 'system'].includes(item.ownerType) ? item.ownerType : 'candidate',
      ownerUser: item.defaultOwnerUser || undefined,
      required: item.required !== false,
      notes: item.notes || '',
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : (index + 1) * 10,
      dueAt: dueDateFromOffset(Date.now(), dueOffset),
      metadata: {
        ...(item.metadata || {}),
        templateItemId: itemKeys[index],
        defaultOwnerRole: item.defaultOwnerRole || '',
        dueOffsetDays: dueOffset,
        dependencyKeys: item.dependencyKeys || []
      }
    };
  }));

  const insertedByKey = new Map(insertedItems.map((item, index) => [itemKeys[index], item]));
  await Promise.all(insertedItems.map((item, index) => {
    const dependencyKeys = templateWorkflowItems[index].dependencyKeys || [];
    const dependencies = dependencyKeys
      .map((key) => insertedByKey.get(key)?._id)
      .filter(Boolean);
    if (!dependencies.length) return null;
    item.dependencies = dependencies;
    return item.save();
  }).filter(Boolean));

  await CandidateOnboarding.findByIdAndUpdate(onboarding._id, {
    $addToSet: {
      forms: { $each: submissions.map((submission) => submission._id) },
      workflowItems: { $each: insertedItems.map((item) => item._id) }
    },
    templateSnapshot: {
      name: onboarding.templateSnapshot?.name || `Default ${copy.label.toLowerCase()} packet`,
      processType: normalizedProcessType,
      packetTemplate: onboarding.templateSnapshot?._id ? onboarding.templateSnapshot : undefined,
      formTemplates: formTemplates.map((formTemplate) => snapshotFormTemplate(formTemplate)),
      workflowItems: insertedItems.map((item) => ({
        id: item.metadata?.templateItemId,
        type: item.type,
        title: item.title,
        ownerType: item.ownerType,
        defaultOwnerRole: item.metadata?.defaultOwnerRole,
        dueOffsetDays: item.metadata?.dueOffsetDays,
        required: item.required,
        order: item.order,
        dependencyKeys: item.metadata?.dependencyKeys || []
      })),
      capturedAt: new Date()
    }
  });

  await updateProgress(onboarding._id);
  await refreshBlockedWorkflowItems(onboarding._id);
  await logOnboardingEvent({
    req,
    organization: onboarding.organization,
    onboarding: onboarding._id,
    candidate: candidate._id,
    actorType: 'system',
    action: 'workflow_initialized',
    metadata: {
      workflowItems: insertedItems.length,
      formSubmissions: submissions.map((submission) => submission._id)
    }
  });

  return { formTemplates, submissions, items: insertedItems };
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
  await refreshBlockedWorkflowItems(onboardingId);
  await updateProgress(onboardingId);
  return item;
}

function validateSubmissionFields(templateSnapshot, values = {}, existingValues = [], uploadedFilesByKey = {}) {
  const errors = [];
  const byKey = values || {};
  const existingByKey = new Map((existingValues || []).map((entry) => [entry.key, entry]));
  (templateSnapshot.fields || []).forEach((field) => {
    const existing = existingByKey.get(field.key) || {};
    const value = byKey[field.key] ?? byKey[field.id];
    const files = uploadedFilesByKey[field.key] || existing.files || [];
    const empty = (
      (field.type === 'file' || field.type === 'image')
        ? !files.length
        : value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    );
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
  const errors = submit ? validateSubmissionFields(submission.templateSnapshot, values, submission.values, filesByKey) : [];
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

  await refreshBlockedWorkflowItems(submission.onboarding);
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

  await refreshBlockedWorkflowItems(submission.onboarding);
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
  const requiredItems = items.filter((item) =>
    item.type !== 'handoff' &&
    item.required !== false &&
    item.status !== 'skipped'
  );
  const ready = requiredItems.every((item) => item.status === 'completed');

  if (!ready) {
    await updateProgress(onboardingId);
    return null;
  }

  const identityProcess = ['onboarding', 'exit', 'retirement'].includes(normalizedProcessType);
  const subjectName = onboarding.subject?.name || candidateDisplayName(onboarding.candidate || { email: onboarding.subject?.email });
  const handoffSource = items.find((item) => item.type === 'handoff');
  let handoff = identityProcess
    ? await OnboardingHandoff.findOne({ onboarding: onboarding._id, target: normalizedProcessType === 'onboarding' ? 'identity_provider' : copy.handoffTarget })
    : null;
  if (identityProcess && !handoff) {
    handoff = await OnboardingHandoff.create({
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: onboarding.candidate?._id,
      workflowItem: handoffSource?._id,
      target: normalizedProcessType === 'onboarding' ? 'identity_provider' : copy.handoffTarget,
      status: 'pending',
      payload: {
        processType: normalizedProcessType,
        candidateId: onboarding.candidate?._id,
        subject: onboarding.subject,
        onboardingId: onboarding._id,
        workflowReadyAt: new Date()
      }
    });
    onboarding.handoffs = Array.from(new Set([...(onboarding.handoffs || []).map(objectIdString), objectIdString(handoff._id)]));
  }

  try {
    if (normalizedProcessType === 'onboarding') {
      onboarding.status = 'ready_to_provision';
      onboarding.identityAction.action = onboarding.identityAction.action || 'provision';
      onboarding.identityAction.status = 'ready';
    } else if (['exit', 'retirement'].includes(normalizedProcessType)) {
      onboarding.identityAction.action = 'deactivate';
      if (onboarding.identityAction.mode === 'on_workflow_completion') {
        const organization = await Organization.findById(onboarding.organization);
        handoff.status = 'running';
        handoff.attempts += 1;
        await handoff.save();
        await performIdentityAction({ transition: onboarding, organization, action: 'deactivate', actorId: req?.user?.id, reason: `${normalizedProcessType}_workflow_completed` });
        handoff.status = 'completed';
        handoff.completedAt = new Date();
        handoff.lastError = '';
        await handoff.save();
        onboarding.status = 'completed';
        onboarding.completedAt = onboarding.completedAt || new Date();
      } else if (onboarding.identityAction.mode === 'scheduled_at' && onboarding.identityAction.status === 'pending') {
        onboarding.status = 'completed';
        onboarding.completedAt = onboarding.completedAt || new Date();
      } else {
        onboarding.status = 'ready_to_provision';
        onboarding.identityAction.status = 'ready';
      }
    } else {
      onboarding.status = 'completed';
      onboarding.completedAt = onboarding.completedAt || new Date();
    }
    await onboarding.save();
    if (onboarding.candidate && onboarding.status === 'completed' && copy.candidateStatus) {
      await Candidate.findByIdAndUpdate(onboarding.candidate._id, candidateCompletionUpdate(onboarding.candidate, copy));
    }
    await updateProgress(onboardingId);
    await logOnboardingEvent({
      req,
      organization: onboarding.organization,
      onboarding: onboarding._id,
      candidate: onboarding.candidate?._id,
      actorType: 'system',
      action: onboarding.status === 'ready_to_provision' ? 'identity_action_ready' : copy.handoffAction,
      metadata: { processType: normalizedProcessType, identityAction: onboarding.identityAction, handoff: handoff?._id }
    });
    await createPeopleTransitionNotifications({
      organization: onboarding.organization,
      onboarding,
      candidate: onboarding.candidate,
      notificationType: onboarding.status === 'ready_to_provision' ? 'people_transition_action' : 'people_transition_completed',
      title: onboarding.status === 'ready_to_provision' ? `${copy.label} ready for HR action` : `${copy.label} completed`,
      message: onboarding.status === 'ready_to_provision'
        ? `${subjectName} has completed the required work. HR must review and confirm the identity action.`
        : `${subjectName} has completed the ${copy.label.toLowerCase()} process.`,
      priority: onboarding.status === 'ready_to_provision' ? 'high' : 'medium'
    });
  } catch (error) {
    if (handoff) {
      handoff.status = 'failed';
      handoff.lastError = error.message;
      await handoff.save();
    }
    onboarding.identityAction.status = 'failed';
    onboarding.identityAction.lastError = error.message;
    await onboarding.save();
    throw error;
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
  actorUserId,
  userIds
}) {
  try {
    const organizationId = organization?._id || organization;
    if (!organizationId || !onboarding?._id) return [];

    const orgDoc = await Organization.findById(organizationId)
      .select('name members idpOrganizationId')
      .lean();
    if (!orgDoc) return [];

    const organizationUserIds = (orgDoc.members || [])
      .filter((member) => member.status === 'active' && member.user)
      .map((member) => member.user);

    const recipientIds = Array.isArray(userIds) && userIds.length ? userIds : organizationUserIds;
    const uniqueUserIds = Array.from(new Set([
      ...recipientIds.map((id) => String(id)),
      ...(actorUserId && !(Array.isArray(userIds) && userIds.length) ? [String(actorUserId)] : [])
    ]));
    if (!uniqueUserIds.length) return [];

    const resolvedOrganization = await resolveOrganizationForEmail({
      organization: orgDoc,
      userId: actorUserId || onboarding.startedBy?._id || onboarding.startedBy || organizationUserIds[0]
    });
    const organizationName = normalizeOrganizationBrand(resolvedOrganization.name);

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
        organizationName,
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

function ownerName(ownerUser) {
  if (!ownerUser || typeof ownerUser !== 'object') return '';
  const profileName = `${ownerUser.profile?.firstName || ''} ${ownerUser.profile?.lastName || ''}`.trim();
  return profileName || ownerUser.name || ownerUser.email || '';
}

function serializeWorkflowItem(item, now = new Date()) {
  if (!item) return item;
  const raw = typeof item.toObject === 'function' ? item.toObject() : item;
  const owner = raw.ownerUser && typeof raw.ownerUser === 'object' ? raw.ownerUser : null;
  const dueAt = raw.dueAt ? new Date(raw.dueAt) : null;
  const active = ACTIVE_WORKFLOW_STATUSES.includes(raw.status);
  const dependencies = (raw.dependencies || []).map((dependency) => {
    if (dependency && typeof dependency === 'object') {
      return {
        _id: dependency._id,
        title: dependency.title,
        status: dependency.status,
        type: dependency.type
      };
    }
    return { _id: dependency };
  });

  return {
    ...raw,
    ownerUser: owner?._id || raw.ownerUser,
    ownerName: ownerName(owner),
    ownerEmail: owner?.email || '',
    isOverdue: Boolean(active && dueAt && dueAt < now),
    isDueSoon: Boolean(active && dueAt && dueAt >= now && dueAt <= new Date(now.getTime() + DAY_MS)),
    dependencySummary: dependencies
  };
}

function signerCanAct(envelope, signer) {
  if (!signer) return false;
  const signerOrder = Number(signer.order || 1);
  return (envelope.signers || [])
    .filter((item) => Number(item.order || 1) < signerOrder)
    .every((item) => item.status === 'signed');
}

function candidateSignerForEnvelope(envelope, candidateAccountId) {
  const candidateAccount = objectIdString(candidateAccountId);
  return (envelope.signers || []).find((signer) =>
    signer.role === 'candidate' &&
    (!signer.candidateAccount || !candidateAccount || objectIdString(signer.candidateAccount) === candidateAccount)
  ) || (envelope.signers || []).find((signer) => signer.role === 'candidate');
}

function fieldBelongsToSigner(field, signer) {
  if ((field.role || 'candidate') !== 'candidate') return false;
  if (signer?.key && field.signerKey) return field.signerKey === signer.key;
  return true;
}

function documentActionType(envelopeDocument, signer) {
  const fields = (envelopeDocument?.signatureFields || []).filter((field) => fieldBelongsToSigner(field, signer));
  const signatureFields = fields.filter((field) => field.type === 'signature');
  if (signatureFields.length) return 'document_sign';
  if (fields.some((field) => ['text', 'image'].includes(field.type))) return 'document_fill';
  return null;
}

function documentHasCandidateInputFields(envelopeDocument, signer) {
  return (envelopeDocument?.signatureFields || [])
    .filter((field) => fieldBelongsToSigner(field, signer))
    .some((field) => ['text', 'image'].includes(field.type));
}

function documentWorkflowItemFor(envelope, workflowItems = []) {
  return workflowItems.find((item) =>
    item.type === 'document' &&
    (!item.sourceId || objectIdString(item.sourceId) === objectIdString(envelope._id))
  ) || workflowItems.find((item) => item.type === 'document');
}

function computeCandidateNextAction({ onboarding, workflowItems = [], formSubmissions = [], envelopes = [] }) {
  const processType = normalizeProcessType(onboarding.processType);
  const recordId = onboarding._id;
  const formById = new Map(formSubmissions.map((submission) => [objectIdString(submission._id), submission]));
  const formItems = workflowItems
    .filter((item) => item.type === 'form' && item.ownerType === 'candidate')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  for (const item of formItems) {
    const submission = formById.get(objectIdString(item.sourceId));
    if (submission && ['draft', 'rejected'].includes(submission.status)) {
      return {
        type: 'form',
        label: submission.status === 'rejected' ? `Update ${submission.title}` : `Complete ${submission.title}`,
        href: `/forms/${submission._id}`,
        dueAt: item.dueAt,
        status: submission.status,
        processType,
        recordId,
        sourceIds: {
          workflowItemId: item._id,
          formSubmissionId: submission._id
        }
      };
    }
  }

  const unassignedForm = formSubmissions
    .filter((submission) => ['draft', 'rejected'].includes(submission.status))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))[0];
  if (unassignedForm) {
    return {
      type: 'form',
      label: unassignedForm.status === 'rejected' ? `Update ${unassignedForm.title}` : `Complete ${unassignedForm.title}`,
      href: `/forms/${unassignedForm._id}`,
      dueAt: undefined,
      status: unassignedForm.status,
      processType,
      recordId,
      sourceIds: {
        formSubmissionId: unassignedForm._id
      }
    };
  }

  const documentActions = [];
  for (const [envelopeIndex, envelope] of envelopes.entries()) {
    if (!ACTIVE_ENVELOPE_STATUSES.includes(envelope.status)) continue;
    const signer = candidateSignerForEnvelope(envelope, onboarding.candidateAccount);
    if (!signer || signer.status === 'signed' || !signerCanAct(envelope, signer)) continue;
    const workflowItem = documentWorkflowItemFor(envelope, workflowItems);
    (envelope.documents || []).forEach((envelopeDocument, index) => {
      if (envelopeDocument.status !== 'pending') return;
      const type = documentActionType(envelopeDocument, signer);
      if (!type) return;
      const hasCandidateInputFields = type === 'document_fill' && documentHasCandidateInputFields(envelopeDocument, signer);
      documentActions.push({
        type,
        label: type === 'document_fill'
          ? `${hasCandidateInputFields ? 'Fill' : 'Complete'} ${envelopeDocument.title}`
          : `Sign ${envelopeDocument.title}`,
        href: `/documents/${envelopeDocument._id}/sign`,
        dueAt: workflowItem?.dueAt,
        status: envelopeDocument.status,
        processType,
        recordId,
        order: Number(workflowItem?.order || 0) * 100000 + envelopeIndex * 1000 + index,
        sourceIds: {
          workflowItemId: workflowItem?._id,
          envelopeId: envelope._id,
          envelopeDocumentId: envelopeDocument._id
        }
      });
    });
  }

  const nextDocumentAction = documentActions.sort((a, b) => a.order - b.order)[0];
  if (nextDocumentAction) return nextDocumentAction;

  if (onboarding.status === 'completed') {
    return {
      type: 'complete',
      label: 'Transition complete',
      href: `/transitions/${recordId}`,
      dueAt: undefined,
      status: onboarding.status,
      processType,
      recordId,
      sourceIds: {}
    };
  }

  const waitingItem = workflowItems
    .filter((item) => ACTIVE_WORKFLOW_STATUSES.includes(item.status))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))[0];

  return {
    type: 'waiting',
    label: waitingItem ? `Waiting on ${waitingItem.title}` : 'Waiting for recruiter action',
    href: `/transitions/${recordId}`,
    dueAt: waitingItem?.dueAt,
    status: waitingItem?.status || onboarding.status,
    processType,
    recordId,
    sourceIds: {
      workflowItemId: waitingItem?._id
    }
  };
}

async function serializeOnboardingPlatform(onboarding) {
  if (!onboarding) return onboarding;
  const [workflowItems, formSubmissions, approvals, handoffs, envelopes] = await Promise.all([
    OnboardingWorkflowItem.find({ onboarding: onboarding._id })
      .populate('ownerUser', 'email profile')
      .populate('dependencies', 'title status type')
      .sort({ order: 1, createdAt: 1 }),
    OnboardingFormSubmission.find({ onboarding: onboarding._id }).sort({ createdAt: 1 }),
    OnboardingApproval.find({ onboarding: onboarding._id }).sort({ createdAt: -1 }),
    OnboardingHandoff.find({ onboarding: onboarding._id }).sort({ createdAt: -1 }),
    OnboardingEnvelope.find({ onboarding: onboarding._id }).sort({ createdAt: 1 })
  ]);

  const raw = typeof onboarding.toObject === 'function' ? onboarding.toObject() : onboarding;
  const serializedWorkflowItems = workflowItems.map((item) => serializeWorkflowItem(item));
  return {
    ...raw,
    processType: normalizeProcessType(raw.processType),
    envelopes,
    workflowItems: serializedWorkflowItems,
    forms: formSubmissions.map((submission) => serializeSubmission(submission)),
    approvals,
    handoffs,
    nextAction: computeCandidateNextAction({
      onboarding: raw,
      workflowItems: serializedWorkflowItems,
      formSubmissions,
      envelopes
    })
  };
}

module.exports = {
  PROCESS_COPY,
  PROCESS_TYPES,
  attachEnvelopeToWorkflow,
  computeCandidateNextAction,
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
  saveCandidateFormSubmission,
  serializeOnboardingPlatform,
  serializeWorkflowItem,
  tryCompleteOnboarding,
  updateProgress
};
