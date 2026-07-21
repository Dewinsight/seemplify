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

type DesignedPresetStyle =
  | 'update_card'
  | 'branded_status'
  | 'executive_brief'
  | 'spotlight_notice';

interface DesignedTemplateMeta {
  prefix: string;
  title: string;
  accent: string;
  tint: string;
  body: string;
}

const DESIGNED_TEMPLATE_META: Record<CandidateEmailTemplateType, DesignedTemplateMeta> = {
  rejection: {
    prefix: 'rejection',
    title: 'Application outcome',
    accent: '#374151',
    tint: '#f3f4f6',
    body: `<p>Hi {{candidateFirstName}},</p>
    <p>Thank you for the time you invested in applying for the <strong>{{jobTitle}}</strong> role at {{organizationName}}.</p>
    <p>After careful consideration, we have decided not to move forward with your application.</p>
    {{#if feedback}}<p>{{feedback}}</p>{{/if}}
    <p>We appreciate your interest and wish you every success in your search.</p>
    <p>Kind regards,<br>{{organizationName}} Hiring Team</p>`,
  },
  shortlistRejection: {
    prefix: 'shortlist_rejection',
    title: 'Shortlist outcome',
    accent: '#9a3412',
    tint: '#fff7ed',
    body: `<p>Hi {{candidateFirstName}},</p>
    <p>Thank you for the time you invested in the shortlist process for the <strong>{{jobTitle}}</strong> role at {{organizationName}}.</p>
    <p>After reviewing the shortlisted applications, we have decided not to progress your application further.</p>
    {{#if feedback}}<p>{{feedback}}</p>{{/if}}
    <p>We appreciated the opportunity to learn more about you and wish you all the best.</p>
    <p>Kind regards,<br>{{organizationName}} Hiring Team</p>`,
  },
  shortlist: {
    prefix: 'shortlist',
    title: 'You have been shortlisted',
    accent: '#166534',
    tint: '#f0fdf4',
    body: `<p>Hi {{candidateFirstName}},</p>
    <p>Thank you for applying for the <strong>{{jobTitle}}</strong> role at {{organizationName}}.</p>
    <p>We are pleased to let you know that your application has been shortlisted. Our hiring team will contact you with the next steps.</p>
    <p>Kind regards,<br>{{organizationName}} Hiring Team</p>`,
  },
  advancement: {
    prefix: 'advancement',
    title: 'Next stage update',
    accent: '#1d4ed8',
    tint: '#eff6ff',
    body: `<p>Hi {{candidateFirstName}},</p>
    <p>We are pleased to let you know that your application for <strong>{{jobTitle}}</strong> at {{organizationName}} is moving to the <strong>{{nextStageName}}</strong> stage.</p>
    {{#if stageDescription}}<p>{{stageDescription}}</p>{{/if}}
    {{#if notes}}<p>{{notes}}</p>{{/if}}
    <p>Kind regards,<br>{{organizationName}} Hiring Team</p>`,
  },
  applicationConfirmation: {
    prefix: 'application_confirmation',
    title: 'Application received',
    accent: '#0f766e',
    tint: '#f0fdfa',
    body: `<p>Hi {{candidateFirstName}},</p>
    <p>Thank you for applying for the <strong>{{jobTitle}}</strong> role at {{organizationName}}. We have received your application.</p>
    <p>Our hiring team will review it and contact you if your experience matches the role.</p>
    {{#if contactEmail}}<p>Questions? Contact us at <a href="mailto:{{contactEmail}}">{{contactEmail}}</a>.</p>{{/if}}
    <p>Kind regards,<br>{{organizationName}} Hiring Team</p>`,
  },
};

const createUpdateCard = ({ title, accent, tint, body }: DesignedTemplateMeta) =>
  `<div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; overflow: hidden; border: 1px solid #d1d5db; border-radius: 8px; background: #ffffff; color: #111827;">
  <div style="padding: 20px 24px; border-bottom: 1px solid #d1d5db; background: ${tint};">
    <h2 style="margin: 0; color: ${accent}; font-size: 22px;">${title}</h2>
    <p style="margin: 6px 0 0; color: #4b5563;">{{jobTitle}} at {{organizationName}}</p>
  </div>
  <div style="padding: 24px; line-height: 1.55;">${body}</div>
</div>`;

const createBrandedStatus = ({ title, accent, body }: DesignedTemplateMeta) =>
  `<div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; overflow: hidden; border: 1px solid #d1d5db; border-radius: 8px; background: #ffffff; color: #111827;">
  <div style="padding: 22px 24px; background: ${accent}; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px;">${title}</h2>
    <p style="margin: 7px 0 0; opacity: 0.9;">{{organizationName}}</p>
  </div>
  <div style="padding: 24px; line-height: 1.55;">${body}</div>
</div>`;

const createExecutiveBrief = ({ title, accent, body }: DesignedTemplateMeta) =>
  `<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 0 auto; border-top: 3px solid ${accent}; border-bottom: 1px solid #d1d5db; background: #ffffff; color: #111827;">
  <div style="padding: 24px 4px 16px; border-bottom: 1px solid #e5e7eb;">
    <h2 style="margin: 0; font-size: 22px;">${title}</h2>
    <p style="margin: 7px 0 0; color: #4b5563;">{{jobTitle}} | {{organizationName}}</p>
  </div>
  <div style="padding: 20px 4px 24px; line-height: 1.65;">${body}</div>
</div>`;

const createSpotlightNotice = ({ title, accent, tint, body }: DesignedTemplateMeta) =>
  `<div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border-left: 5px solid ${accent}; background: ${tint}; color: #111827; padding: 24px; line-height: 1.55;">
  <h2 style="margin: 0 0 6px; color: ${accent}; font-size: 21px;">${title}</h2>
  <p style="margin: 0 0 20px; color: #4b5563;">{{organizationName}}</p>
  ${body}
</div>`;

const createDesignedCandidatePresets = (
  templateType: CandidateEmailTemplateType
): CandidateEmailTemplatePreset[] => {
  const meta = DESIGNED_TEMPLATE_META[templateType];
  const presets: Array<{
    style: DesignedPresetStyle;
    name: string;
    description: string;
    content: string;
  }> = [
    {
      style: 'update_card',
      name: 'Update card',
      description: 'A structured card with a quiet status header.',
      content: createUpdateCard(meta),
    },
    {
      style: 'branded_status',
      name: 'Branded status',
      description: 'A polished email with a strong branded header.',
      content: createBrandedStatus(meta),
    },
    {
      style: 'executive_brief',
      name: 'Executive brief',
      description: 'A refined letter layout for formal communication.',
      content: createExecutiveBrief(meta),
    },
    {
      style: 'spotlight_notice',
      name: 'Spotlight notice',
      description: 'A focused status message with a clear accent.',
      content: createSpotlightNotice(meta),
    },
  ];

  return presets.map((preset) => ({
    id: `${meta.prefix}_${preset.style}`,
    name: preset.name,
    description: preset.description,
    content: preset.content,
  }));
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
    {
      id: 'rejection_warm',
      name: 'Warm email',
      description: 'A considerate rejection with a more personal tone.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for the time and care you put into applying for the {{jobTitle}} role at {{organizationName}}.</p>
  <p>After careful consideration, we have decided not to move forward with your application.</p>
  {{#if feedback}}
  <p>{{feedback}}</p>
  {{/if}}
  <p>We truly appreciate your interest in joining us and wish you every success in your search.</p>
  <p>Warm regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    ...createDesignedCandidatePresets('rejection'),
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
    {
      id: 'shortlist_rejection_warm',
      name: 'Warm email',
      description: 'A thoughtful outcome for someone who reached the shortlist.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for the time you invested in the shortlist process for the {{jobTitle}} role at {{organizationName}}.</p>
  <p>After reviewing the shortlisted applications, we have decided not to progress your application further.</p>
  {{#if feedback}}
  <p>{{feedback}}</p>
  {{/if}}
  <p>We appreciated the opportunity to learn more about you and wish you all the best in your search.</p>
  <p>Warm regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    ...createDesignedCandidatePresets('shortlistRejection'),
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
    {
      id: 'shortlist_warm',
      name: 'Warm email',
      description: 'A friendly message celebrating a shortlist decision.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for applying for the {{jobTitle}} role at {{organizationName}}.</p>
  <p>We are delighted to let you know that your application has been shortlisted. We enjoyed learning about your experience and will contact you soon with the next steps.</p>
  <p>Warm regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    ...createDesignedCandidatePresets('shortlist'),
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
    {
      id: 'advancement_warm',
      name: 'Warm email',
      description: 'An encouraging update for the candidate\'s next stage.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Good news about your application for the {{jobTitle}} role at {{organizationName}}. We would like to move you forward to the {{nextStageName}} stage.</p>
  {{#if stageDescription}}
  <p>{{stageDescription}}</p>
  {{/if}}
  {{#if notes}}
  <p>{{notes}}</p>
  {{/if}}
  <p>We look forward to continuing the conversation.</p>
  <p>Warm regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    ...createDesignedCandidatePresets('advancement'),
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
    {
      id: 'application_confirmation_warm',
      name: 'Warm email',
      description: 'A welcoming acknowledgement of a new application.',
      content: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; max-width: 640px;">
  <p>Hi {{candidateFirstName}},</p>
  <p>Thank you for your interest in the {{jobTitle}} role at {{organizationName}}. We are pleased to confirm that your application has been received.</p>
  <p>Our hiring team will review your application carefully and will contact you if your experience matches what we are looking for.</p>
  {{#if contactEmail}}
  <p>If you need to update anything, you can reach us at <a href="mailto:{{contactEmail}}">{{contactEmail}}</a>.</p>
  {{/if}}
  <p>Warm regards,<br>{{organizationName}} Hiring Team</p>
</div>`,
    },
    ...createDesignedCandidatePresets('applicationConfirmation'),
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

export const getDefaultCandidateEmailTemplatePreset = (templateType: CandidateEmailTemplateType) => {
  const defaultId = DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE[templateType];
  return CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE[templateType].find(
    (preset) => preset.id === defaultId
  );
};

export const LEGACY_CANDIDATE_EMAIL_TEMPLATE_FINGERPRINTS: Record<
  string,
  DesignedPresetStyle | 'warm'
> = {
  '1508:c40c83cc': 'update_card',
  '1051:cba32f2c': 'branded_status',
  '385:e5eb71c1': 'executive_brief',
  '323:a6e25fe8': 'warm',
  '1184:b9bd9765': 'spotlight_notice',
};

const getTemplateFingerprint = (content: string) => {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(hash ^ normalized.charCodeAt(index), 16777619);
  }
  return `${normalized.length}:${(hash >>> 0).toString(16)}`;
};

export const getLegacyCandidateEmailTemplateReplacement = (
  templateType: CandidateEmailTemplateType,
  content?: string
) => {
  if (!content?.trim()) {
    return undefined;
  }

  const replacementStyle = LEGACY_CANDIDATE_EMAIL_TEMPLATE_FINGERPRINTS[
    getTemplateFingerprint(content)
  ];
  if (!replacementStyle) {
    return undefined;
  }

  const prefix = DESIGNED_TEMPLATE_META[templateType].prefix;
  const replacementId = `${prefix}_${replacementStyle}`;
  return CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE[templateType].find(
    (preset) => preset.id === replacementId
  );
};
