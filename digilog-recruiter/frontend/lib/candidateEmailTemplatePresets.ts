export interface CandidateEmailTemplatePreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_ID = 'candidate_update_card';

export const CANDIDATE_EMAIL_TEMPLATE_VARIABLES: string[] = [
  '{{candidateName}}',
  '{{jobTitle}}',
  '{{organizationName}}',
  '{{nextStageName}}',
  '{{stageDescription}}',
  '{{feedback}}',
  '{{notes}}',
  '{{applicationDate}}',
  '{{companyLogo}}'
];

export const CANDIDATE_EMAIL_TEMPLATE_PRESETS: CandidateEmailTemplatePreset[] = [
  {
    id: 'candidate_update_card',
    name: 'Update Card',
    description: 'Balanced card layout for status updates.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
  <div style="background: #111827; color: #ffffff; padding: 22px;">
    {{#if companyLogo}}
    <img src="{{companyLogo}}" alt="{{organizationName}}" style="max-height: 40px; margin-bottom: 10px;" />
    {{/if}}
    <h2 style="margin: 0; font-size: 24px;">Application Update</h2>
    <p style="margin: 8px 0 0 0; color: #d1d5db;">{{organizationName}}</p>
  </div>
  <div style="padding: 24px; color: #111827;">
    <p style="margin-top: 0;">Hello {{candidateName}},</p>
    <p>Thank you for your interest in the <strong>{{jobTitle}}</strong> role.</p>
    {{#if nextStageName}}
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; margin: 16px 0;">
      <p style="margin: 0 0 6px 0;"><strong>Next Stage:</strong> {{nextStageName}}</p>
      {{#if stageDescription}}
      <p style="margin: 0;"><strong>What to expect:</strong> {{stageDescription}}</p>
      {{/if}}
    </div>
    {{/if}}
    {{#if feedback}}
    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin: 16px 0;">
      <p style="margin: 0;"><strong>Feedback:</strong> {{feedback}}</p>
    </div>
    {{/if}}
    {{#if notes}}
    <p><strong>Additional Notes:</strong><br>{{notes}}</p>
    {{/if}}
    <p style="margin: 20px 0 0 0;">Best regards,<br>{{organizationName}} Hiring Team</p>
  </div>
</div>`
  },
  {
    id: 'modern_gradient_status',
    name: 'Gradient Status',
    description: 'Modern visual style with highlighted stage progress.',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #dbeafe; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #2563eb, #06b6d4); color: #ffffff; padding: 24px;">
    <h2 style="margin: 0;">Your Application Status</h2>
    <p style="margin: 8px 0 0 0; opacity: 0.95;">{{organizationName}}</p>
  </div>
  <div style="padding: 24px;">
    <p style="margin-top: 0;">Hi {{candidateName}},</p>
    <p>Here is an update for your <strong>{{jobTitle}}</strong> application.</p>
    {{#if nextStageName}}
    <p><strong>Current Outcome:</strong> You are moving to <strong>{{nextStageName}}</strong>.</p>
    {{/if}}
    {{#if stageDescription}}
    <p><strong>Details:</strong> {{stageDescription}}</p>
    {{/if}}
    {{#if feedback}}
    <p><strong>Feedback:</strong> {{feedback}}</p>
    {{/if}}
    {{#if notes}}
    <p><strong>Notes:</strong> {{notes}}</p>
    {{/if}}
    <p style="margin: 20px 0 0 0;">Thank you,<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'executive_brief',
    name: 'Executive Brief',
    description: 'Minimal and professional for formal communication.',
    content: `Dear {{candidateName}},

Thank you for your continued interest in the {{jobTitle}} role at {{organizationName}}.

{{#if nextStageName}}
Next stage: {{nextStageName}}
{{/if}}
{{#if stageDescription}}
Stage details: {{stageDescription}}
{{/if}}
{{#if feedback}}
Feedback: {{feedback}}
{{/if}}
{{#if notes}}
Additional notes:
{{notes}}
{{/if}}

Sincerely,
{{organizationName}} Hiring Team`
  },
  {
    id: 'warm_plain',
    name: 'Warm Plain',
    description: 'Friendly plain-text style for personal tone.',
    content: `Hello {{candidateName}},

We wanted to share an update about your application for {{jobTitle}}.

{{#if nextStageName}}
Good news: you are progressing to {{nextStageName}}.
{{/if}}

{{#if feedback}}
Team feedback:
{{feedback}}
{{/if}}

{{#if notes}}
Notes:
{{notes}}
{{/if}}

Thanks again for your time,
{{organizationName}}`
  },
  {
    id: 'spotlight_notice',
    name: 'Spotlight Notice',
    description: 'Strong highlighted sections for important updates.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
  <div style="background: #0f172a; color: #f8fafc; padding: 20px;">
    <h2 style="margin: 0;">Candidate Update</h2>
    <p style="margin: 8px 0 0 0;">{{organizationName}}</p>
  </div>
  <div style="padding: 22px;">
    <p style="margin-top: 0;">Dear {{candidateName}},</p>
    <p>Regarding your application for <strong>{{jobTitle}}</strong>:</p>
    {{#if nextStageName}}
    <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 12px; margin: 14px 0;">
      <strong>Next Stage:</strong> {{nextStageName}}
    </div>
    {{/if}}
    {{#if feedback}}
    <div style="background: #fff7ed; border-left: 4px solid #f97316; padding: 12px; margin: 14px 0;">
      <strong>Feedback:</strong> {{feedback}}
    </div>
    {{/if}}
    {{#if notes}}
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 14px 0;">
      <strong>Notes:</strong><br>{{notes}}
    </div>
    {{/if}}
    <p style="margin-bottom: 0;">Best,<br>{{organizationName}} Hiring Team</p>
  </div>
</div>`
  }
];
