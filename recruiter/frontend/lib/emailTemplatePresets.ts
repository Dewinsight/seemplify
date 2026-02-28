export interface EmailTemplatePreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const DEFAULT_EMAIL_TEMPLATE_PRESET_ID = 'professional_card';

export const EMAIL_TEMPLATE_VARIABLES: string[] = [
  '{{candidateName}}',
  '{{jobTitle}}',
  '{{jobLink}}',
  '{{jobDetailsPdfAttached}}',
  '{{interviewDate}}',
  '{{interviewTime}}',
  '{{duration}}',
  '{{interviewType}}',
  '{{meetingLink}}',
  '{{notes}}',
  '{{interviewerName}}',
  '{{organizationName}}'
];

export const EMAIL_TEMPLATE_PRESETS: EmailTemplatePreset[] = [
  {
    id: 'professional_card',
    name: 'Professional Card',
    description: 'Clean corporate layout with clear sections.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
  <div style="background: #111827; color: #ffffff; padding: 22px;">
    <h2 style="margin: 0; font-size: 24px;">Interview Invitation</h2>
    <p style="margin: 6px 0 0 0; color: #d1d5db;">{{organizationName}}</p>
  </div>
  <div style="padding: 24px; color: #111827;">
    <p>Hello {{candidateName}},</p>
    <p>We're pleased to invite you for an interview for the <strong>{{jobTitle}}</strong> role.</p>
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
      <p style="margin: 0 0 8px 0;"><strong>Date:</strong> {{interviewDate}}</p>
      <p style="margin: 0 0 8px 0;"><strong>Time:</strong> {{interviewTime}}</p>
      <p style="margin: 0 0 8px 0;"><strong>Duration:</strong> {{duration}} minutes</p>
      <p style="margin: 0;"><strong>Format:</strong> {{interviewType}}</p>
      {{#if meetingLink}}
      <p style="margin: 8px 0 0 0;"><strong>Meeting Link:</strong> <a href="{{meetingLink}}" style="color: #2563eb;">Join Interview</a></p>
      {{/if}}
      {{#if jobLink}}
      <p style="margin: 8px 0 0 0;"><strong>Job Details:</strong> <a href="{{jobLink}}" style="color: #2563eb;">View Job Description</a></p>
      {{/if}}
    </div>
    {{#if notes}}
    <p style="margin-top: 16px;"><strong>Additional Notes:</strong><br>{{notes}}</p>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p style="margin-top: 12px; color: #374151;">A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p style="margin-top: 20px;">Best regards,<br>{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'minimal_text',
    name: 'Minimal Text',
    description: 'Simple and direct plain format.',
    content: `Dear {{candidateName}},

You are invited to interview for the {{jobTitle}} position.

Date: {{interviewDate}}
Time: {{interviewTime}}
Duration: {{duration}} minutes
Format: {{interviewType}}
{{#if meetingLink}}
Meeting Link: {{meetingLink}}
{{/if}}
{{#if jobLink}}
Job Details: {{jobLink}}
{{/if}}
{{#if jobDetailsPdfAttached}}
Attached: Full job description PDF
{{/if}}

{{#if notes}}
Additional Notes:
{{notes}}
{{/if}}

Best regards,
{{interviewerName}}
{{organizationName}}`
  },
  {
    id: 'modern_gradient',
    name: 'Modern Gradient',
    description: 'Bold hero style with strong visual emphasis.',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #dbeafe;">
  <div style="background: linear-gradient(135deg, #2563eb, #06b6d4); color: #ffffff; padding: 28px;">
    <h1 style="margin: 0; font-size: 28px;">You're Invited</h1>
    <p style="margin: 10px 0 0 0;">Interview for {{jobTitle}}</p>
  </div>
  <div style="padding: 24px; background: #ffffff;">
    <p style="margin-top: 0;">Hi {{candidateName}},</p>
    <p>We're excited to meet you. Here are the details:</p>
    <ul style="padding-left: 20px; margin: 0 0 16px 0;">
      <li><strong>Date:</strong> {{interviewDate}}</li>
      <li><strong>Time:</strong> {{interviewTime}}</li>
      <li><strong>Duration:</strong> {{duration}} minutes</li>
      <li><strong>Type:</strong> {{interviewType}}</li>
    </ul>
    {{#if meetingLink}}
    <a href="{{meetingLink}}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">Open Meeting Link</a>
    {{/if}}
    {{#if jobLink}}
    <p style="margin-top: 12px;"><strong>Job Details:</strong> <a href="{{jobLink}}" style="color: #1d4ed8;">View Job Description</a></p>
    {{/if}}
    {{#if notes}}
    <div style="margin-top: 16px; padding: 14px; border-left: 4px solid #06b6d4; background: #f0f9ff;">
      <strong>Notes</strong><br>{{notes}}
    </div>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p style="margin-top: 12px;">A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p style="margin-top: 20px;">Regards,<br>{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'executive_clean',
    name: 'Executive Clean',
    description: 'Refined style for senior and leadership hiring.',
    content: `<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 700px; margin: 0 auto; background: #ffffff; color: #111827;">
  <div style="border-bottom: 2px solid #111827; padding: 24px 0;">
    <h2 style="margin: 0;">Interview Confirmation</h2>
  </div>
  <div style="padding: 24px 0;">
    <p>Dear {{candidateName}},</p>
    <p>We are pleased to confirm your interview for <strong>{{jobTitle}}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
      <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Date</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">{{interviewDate}}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Time</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">{{interviewTime}}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Duration</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">{{duration}} minutes</td></tr>
      <tr><td style="padding: 8px;"><strong>Format</strong></td><td style="padding: 8px;">{{interviewType}}</td></tr>
    </table>
    {{#if meetingLink}}
    <p style="margin-top: 12px;"><strong>Meeting Link:</strong> <a href="{{meetingLink}}" style="color: #1d4ed8;">{{meetingLink}}</a></p>
    {{/if}}
    {{#if jobLink}}
    <p><strong>Job Details:</strong> <a href="{{jobLink}}" style="color: #1d4ed8;">View Job Description</a></p>
    {{/if}}
    {{#if notes}}
    <p><strong>Notes:</strong><br>{{notes}}</p>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p>A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p style="margin-top: 18px;">Sincerely,<br>{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'friendly_brand',
    name: 'Friendly Brand',
    description: 'Warm, approachable style with clear callouts.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;">
  <div style="padding: 20px; border-bottom: 1px solid #fed7aa; background: #ffedd5;">
    <h2 style="margin: 0; color: #9a3412;">Interview Invitation</h2>
  </div>
  <div style="padding: 22px; color: #7c2d12;">
    <p style="margin-top: 0;">Hi {{candidateName}},</p>
    <p>Thanks for your interest in joining us as <strong>{{jobTitle}}</strong>. We would love to meet you.</p>
    <p><strong>When:</strong> {{interviewDate}} at {{interviewTime}}</p>
    <p><strong>Duration:</strong> {{duration}} minutes</p>
    <p><strong>Format:</strong> {{interviewType}}</p>
    {{#if meetingLink}}
    <p><strong>Meeting Link:</strong> <a href="{{meetingLink}}" style="color: #c2410c;">Join here</a></p>
    {{/if}}
    {{#if jobLink}}
    <p><strong>Job Details:</strong> <a href="{{jobLink}}" style="color: #c2410c;">View Job Description</a></p>
    {{/if}}
    {{#if notes}}
    <p><strong>Anything else to know:</strong><br>{{notes}}</p>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p>A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p>See you soon,<br>{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'detailed_agenda',
    name: 'Detailed Agenda',
    description: 'Comprehensive layout with structured interview overview.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px;">
  <div style="padding: 20px 24px; background: #f8fafc; border-bottom: 1px solid #e5e7eb;">
    <h2 style="margin: 0; color: #0f172a;">Interview Agenda</h2>
    <p style="margin: 8px 0 0 0; color: #475569;">Position: {{jobTitle}}</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello {{candidateName}},</p>
    <p>Your interview has been scheduled. Please review the details below:</p>
    <div style="padding: 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <p style="margin: 0 0 6px 0;"><strong>Date:</strong> {{interviewDate}}</p>
      <p style="margin: 0 0 6px 0;"><strong>Time:</strong> {{interviewTime}}</p>
      <p style="margin: 0 0 6px 0;"><strong>Duration:</strong> {{duration}} minutes</p>
      <p style="margin: 0;"><strong>Interview Type:</strong> {{interviewType}}</p>
    </div>
    {{#if meetingLink}}
    <div style="margin-top: 14px;">
      <a href="{{meetingLink}}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px;">Join Meeting</a>
    </div>
    {{/if}}
    {{#if jobLink}}
    <p style="margin-top: 12px;"><strong>Job Details:</strong> <a href="{{jobLink}}" style="color: #1d4ed8;">View Job Description</a></p>
    {{/if}}
    {{#if notes}}
    <div style="margin-top: 16px; padding: 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
      <strong>Additional Notes</strong><br>{{notes}}
    </div>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p style="margin-top: 12px;">A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p style="margin-top: 18px;">Best regards,<br>{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  },
  {
    id: 'high_contrast',
    name: 'High Contrast',
    description: 'Strong visual contrast for standout branding.',
    content: `<div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
  <div style="padding: 24px; background: #1e293b;">
    <h2 style="margin: 0; color: #f8fafc;">Interview Scheduled</h2>
  </div>
  <div style="padding: 24px;">
    <p style="margin-top: 0;">Hello {{candidateName}},</p>
    <p>You have been shortlisted for an interview for <strong>{{jobTitle}}</strong>.</p>
    <p><strong>Date:</strong> {{interviewDate}}</p>
    <p><strong>Time:</strong> {{interviewTime}}</p>
    <p><strong>Duration:</strong> {{duration}} minutes</p>
    <p><strong>Mode:</strong> {{interviewType}}</p>
    {{#if meetingLink}}
    <p><a href="{{meetingLink}}" style="color: #38bdf8;">Open Meeting Link</a></p>
    {{/if}}
    {{#if jobLink}}
    <p><a href="{{jobLink}}" style="color: #38bdf8;">View Job Description</a></p>
    {{/if}}
    {{#if notes}}
    <p><strong>Notes:</strong><br>{{notes}}</p>
    {{/if}}
    {{#if jobDetailsPdfAttached}}
    <p>A PDF with the full job details is attached for your reference.</p>
    {{/if}}
    <p style="margin-top: 20px;">{{interviewerName}}<br>{{organizationName}}</p>
  </div>
</div>`
  }
];

export const getDefaultEmailTemplate = (): string => {
  const preset = EMAIL_TEMPLATE_PRESETS.find(item => item.id === DEFAULT_EMAIL_TEMPLATE_PRESET_ID);
  return preset?.content || EMAIL_TEMPLATE_PRESETS[0].content;
};
