export type CandidateEmailTemplateType =
  | 'rejection'
  | 'shortlistRejection'
  | 'shortlist'
  | 'advancement'
  | 'applicationConfirmation';

export interface CandidateEmailTemplatePreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface CandidateEmailTemplateVariable {
  token: string;
  label: string;
  example: string;
}

const COMMON_VARIABLES: CandidateEmailTemplateVariable[] = [
  { token: '{{candidateName}}', label: 'Candidate full name', example: 'Alex Candidate' },
  { token: '{{candidateFirstName}}', label: 'Candidate first name', example: 'Alex' },
  { token: '{{candidateLastName}}', label: 'Candidate last name', example: 'Candidate' },
  { token: '{{candidateEmail}}', label: 'Candidate email', example: 'alex@example.com' },
  { token: '{{jobTitle}}', label: 'Job title', example: 'Product Manager' },
  { token: '{{organizationName}}', label: 'Organization name', example: 'Your organization' },
  { token: '{{applicationDate}}', label: 'Application date', example: '21 July 2026' },
];

const ADVANCEMENT_VARIABLES: CandidateEmailTemplateVariable[] = [
  ...COMMON_VARIABLES,
  { token: '{{previousStageName}}', label: 'Previous stage', example: 'Phone screen' },
  { token: '{{nextStageName}}', label: 'Next stage', example: 'Technical interview' },
  { token: '{{stageDescription}}', label: 'Next stage details', example: 'A 45-minute video interview' },
  { token: '{{notes}}', label: 'Move notes', example: 'Scheduling details will follow shortly.' },
];

const REJECTION_VARIABLES: CandidateEmailTemplateVariable[] = [
  ...COMMON_VARIABLES,
  { token: '{{stage}}', label: 'Current stage', example: 'Technical interview' },
  { token: '{{feedback}}', label: 'Rejection message', example: 'Thank you for the time you invested in the process.' },
];

const APPLICATION_VARIABLES: CandidateEmailTemplateVariable[] = [
  ...COMMON_VARIABLES,
  { token: '{{jobLocation}}', label: 'Job location', example: 'London or remote' },
  { token: '{{contactEmail}}', label: 'Contact email', example: 'hiring@example.com' },
];

export const CANDIDATE_EMAIL_TEMPLATE_VARIABLES_BY_TYPE: Record<
  CandidateEmailTemplateType,
  CandidateEmailTemplateVariable[]
> = {
  rejection: REJECTION_VARIABLES,
  shortlistRejection: REJECTION_VARIABLES,
  shortlist: COMMON_VARIABLES,
  advancement: ADVANCEMENT_VARIABLES,
  applicationConfirmation: APPLICATION_VARIABLES,
};

export const CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE: Record<
  CandidateEmailTemplateType,
  CandidateEmailTemplatePreset[]
> = {
  rejection: [
    {
      id: 'rejection_plain',
      name: 'Plain email',
      description: 'A considerate, direct rejection message.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for the time you invested in applying for the {{jobTitle}} role at {{organizationName}}.</p>
  <p>After careful consideration, we have decided not to move forward with your application.</p>
  {{#if feedback}}
  <p>{{feedback}}</p>
  {{/if}}
  <p>We appreciate your interest in {{organizationName}} and wish you well in your search.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    {
      id: 'rejection_concise',
      name: 'Concise',
      description: 'A shorter application outcome message.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for applying for the {{jobTitle}} role at {{organizationName}}. We will not be progressing your application further on this occasion.</p>
  {{#if feedback}}<p>{{feedback}}</p>{{/if}}
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
  ],
  shortlistRejection: [
    {
      id: 'shortlist_rejection_plain',
      name: 'Plain email',
      description: 'A clear outcome for shortlisted candidates.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for your interest in the {{jobTitle}} role at {{organizationName}}.</p>
  <p>After reviewing the shortlisted applications, we have decided not to progress your application further.</p>
  {{#if feedback}}
  <p>{{feedback}}</p>
  {{/if}}
  <p>We appreciate the time you invested and wish you all the best.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    {
      id: 'shortlist_rejection_concise',
      name: 'Concise',
      description: 'A brief shortlist outcome message.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for applying for {{jobTitle}} at {{organizationName}}. We have chosen not to progress your shortlisted application on this occasion.</p>
  {{#if feedback}}<p>{{feedback}}</p>{{/if}}
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
  ],
  shortlist: [
    {
      id: 'shortlist_plain',
      name: 'Plain email',
      description: 'A straightforward shortlist update.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for applying for the {{jobTitle}} role at {{organizationName}}.</p>
  <p>We are pleased to let you know that your application has been shortlisted. Our hiring team will contact you with the next steps.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    {
      id: 'shortlist_concise',
      name: 'Concise',
      description: 'A brief shortlist confirmation.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Your application for {{jobTitle}} at {{organizationName}} has been shortlisted. We will be in touch with the next steps.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
  ],
  advancement: [
    {
      id: 'advancement_plain',
      name: 'Plain email',
      description: 'A personal update when a candidate changes stage.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>We are pleased to let you know that your application for {{jobTitle}} at {{organizationName}} is moving to the {{nextStageName}} stage.</p>
  {{#if stageDescription}}
  <p>{{stageDescription}}</p>
  {{/if}}
  {{#if notes}}
  <p>{{notes}}</p>
  {{/if}}
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    {
      id: 'advancement_concise',
      name: 'Concise',
      description: 'A short stage progression update.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Your application for {{jobTitle}} has progressed to {{nextStageName}}.</p>
  {{#if notes}}<p>{{notes}}</p>{{/if}}
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
  ],
  applicationConfirmation: [
    {
      id: 'application_confirmation_plain',
      name: 'Plain email',
      description: 'A simple acknowledgement after an application.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for applying for the {{jobTitle}} role at {{organizationName}}. We have received your application.</p>
  <p>Our hiring team will review it and contact you if your experience matches the role.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    {
      id: 'application_confirmation_concise',
      name: 'Concise',
      description: 'A brief receipt confirmation.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>We have received your application for {{jobTitle}} at {{organizationName}}. Thank you for your interest.</p>
  <p>Kind regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
  ],
};

export const DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE: Record<
  CandidateEmailTemplateType,
  string
> = {
  rejection: 'rejection_plain',
  shortlistRejection: 'shortlist_rejection_plain',
  shortlist: 'shortlist_plain',
  advancement: 'advancement_plain',
  applicationConfirmation: 'application_confirmation_plain',
};

export const getCandidateEmailTemplateVariables = (templateType: CandidateEmailTemplateType) =>
  CANDIDATE_EMAIL_TEMPLATE_VARIABLES_BY_TYPE[templateType];

export const getCandidateEmailTemplatePresets = (templateType: CandidateEmailTemplateType) =>
  CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE[templateType];
