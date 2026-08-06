const crypto = require('crypto');
const Handlebars = require('handlebars');
const { isMailConfigured, mailTransportStatus, sendMail } = require('./mailClient');
const { decodeHtmlEntities, decodeObjectHtmlEntities } = require('../utils/htmlDecode');
const {
  resolveOrganizationBrand,
  requireOrganizationBrand
} = require('../utils/organizationBrand');
const {
  isHtmlLike,
  escapeHtml,
  sanitizeEmailHtml,
  plainTextToEmailHtml,
  htmlToText
} = require('../utils/emailHtmlSanitizer');

/** Flattens a provider-shaped recipient list into bare mailboxes. */
function toMailboxList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => (typeof item === 'string' ? item : item?.email))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

/** Provider attachments carry base64 in `content`; the contract names it `data`. */
function normalizeProviderAttachments(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items = value
    .filter((item) => item && (item.content || item.data) && (item.name || item.filename))
    .map((item) => ({
      name: item.name || item.filename,
      contentType: item.contentType || 'application/octet-stream',
      data: String(item.data || item.content)
    }));
  return items.length > 0 ? items : undefined;
}

/**
 * Last-resort idempotency key for send sites that have no business identifier
 * of their own. Identical content to identical recipients is treated as one
 * event; any change in recipient, subject or body produces a new key.
 */
function messageDigestKey(tag, recipients, subject, html, text) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([tag, recipients.map((item) => item.toLowerCase()).sort(), subject || '', html || '', text || '']))
    .digest('hex');
  return `${tag}:${digest.slice(0, 32)}`;
}

/** Minimal fetch-Response stand-in for the provider-shaped call sites. */
function providerResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

class EmailService {
  constructor() {
    this.templateCache = new Map();
    this.apiBaseUrl = mailTransportStatus().baseUrl;

    // Log configuration status on startup. The credential itself is never printed.
    console.log('📧 Email Service Configuration:');
    console.log('  - Mail service:', isMailConfigured() ? 'Configured' : '❌ MISSING');
    console.log('  - Mail service URL:', this.apiBaseUrl || '(not set)');

    if (!isMailConfigured()) {
      console.error('❌ MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL are not set! Emails will fail to send.');
    }

    // Every send site in this service builds one provider-shaped payload and
    // then inspects a fetch Response. Adapting at that seam keeps all of those
    // call sites, their error handling and their business semantics unchanged
    // while the transport underneath becomes the Seemplify mail service.
    this.fetch = (_url, init) => this.deliverProviderPayload(init);
  }

  /**
   * Translates one provider-shaped payload into the mail-service contract and
   * answers a minimal fetch-Response so existing callers keep working.
   */
  async deliverProviderPayload(init) {
    let payload = {};
    try {
      payload = JSON.parse(String(init?.body || '{}'));
    } catch (error) {
      return providerResponse(400, { message: 'The email payload was not valid JSON.' });
    }

    const recipients = toMailboxList(payload.to);
    const idempotencyKey = String(payload.idempotencyKey || '').trim()
      // Without a caller-supplied business identifier, derive one from the
      // message itself so an accidental double submit collapses to one send.
      || messageDigestKey(payload.tag || 'recruiter_email', recipients, payload.subject, payload.htmlContent, payload.textContent);

    try {
      const result = await sendMail({
        from: payload.sender?.email || undefined,
        fromName: payload.sender?.name || undefined,
        to: recipients,
        cc: toMailboxList(payload.cc),
        bcc: toMailboxList(payload.bcc),
        replyTo: payload.replyTo?.email || payload.replyTo || undefined,
        subject: payload.subject,
        html: payload.htmlContent,
        text: payload.textContent,
        tag: payload.tag || undefined,
        attachments: normalizeProviderAttachments(payload.attachment || payload.attachments),
        idempotencyKey
      });
      return providerResponse(202, { status: result.status, messageId: result.messageId });
    } catch (error) {
      // Surface the classification without leaking the token or the body.
      return providerResponse(error.status || 500, {
        message: error.message,
        code: error.code,
        retryable: Boolean(error.retryable)
      });
    }
  }

  // Diagnostic method to check email service health
  checkConfiguration() {
    const status = mailTransportStatus();
    return {
      hasApiKey: status.configured,
      apiBaseUrl: status.baseUrl,
      isConfigured: status.configured
    };
  }

  getOrganizationBrand(organizationName = null) {
    return resolveOrganizationBrand(organizationName);
  }

  requireOrganizationBrand(organizationName) {
    return requireOrganizationBrand(organizationName);
  }

  ensureOrganizationSubject(subject, organizationName = null) {
    const brand = this.getOrganizationBrand(organizationName);
    const decodedSubject = decodeHtmlEntities(subject || '');
    const normalizedSubject = decodedSubject.toLowerCase().trim();
    const normalizedBrand = brand.toLowerCase().trim();

    if (
      normalizedSubject.startsWith(`${normalizedBrand} -`) ||
      normalizedSubject.startsWith(`${normalizedBrand}:`)
    ) {
      return decodedSubject;
    }

    return `${brand} - ${decodedSubject}`.trim();
  }

  applyOrganizationBrand(content, organizationName = null) {
    if (!content) {
      return content;
    }
    const brand = this.getOrganizationBrand(organizationName);
    // Replace standalone product labels and the retired Mega placeholder.
    // Do not replace labels inside URLs, domains, or email addresses.
    return String(content).replace(
      /(^|[^A-Za-z0-9_./@-])(smarthr|mega)(?=$|[^A-Za-z0-9_./@-])/gi,
      (_match, prefix) => `${prefix}${brand}`
    );
  }

  normalizeInterviewTemplate(template) {
    if (!template) {
      return template;
    }

    // Convert known preview/demo literals back to runtime variables.
    // This protects real sends if a preview-rendered template is accidentally saved.
    const replacements = [
      [/jane\s+doe|jane\s+deo/gi, '{{candidateName}}'],
      [/senior\s+product\s+designer/gi, '{{jobTitle}}'],
      [/tuesday,\s+february\s+24,\s+2026/gi, '{{interviewDate}}'],
      [/10:00\s+am\s+est/gi, '{{interviewTime}}'],
      [/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/example/gi, '{{meetingLink}}'],
      [/please have your portfolio ready for screen sharing\./gi, '{{notes}}'],
      [/michael\s+adams/gi, '{{interviewerName}}'],
      [/smarthr/gi, '{{organizationName}}'],
      [/\bmega\b/gi, '{{organizationName}}']
    ];

    let normalized = String(template);
    for (const [pattern, variable] of replacements) {
      normalized = normalized.replace(pattern, variable);
    }

    return normalized;
  }
  
  /**
   * Process a template string by replacing placeholders with actual values
   * @param {string} template - Template string with {{placeholder}} syntax
   * @param {Object} data - Object containing values to replace placeholders
   * @returns {string} - Processed template
   */
  processTemplate(template, data) {
    if (!template) return '';
    
    console.log('🔍 [EmailService.processTemplate] Starting Handlebars template processing...');
    console.log('📊 [EmailService.processTemplate] Data keys:', Object.keys(data));
    console.log('📝 [EmailService.processTemplate] Template preview:', template.substring(0, 200));
    console.log('📊 [EmailService.processTemplate] Data sample:', {
      meetingLink: data.meetingLink,
      notes: data.notes,
      candidateName: data.candidateName
    });
    
    // ✅ CRITICAL FIX: Decode HTML entities BEFORE processing
    // The template arrives HTML-encoded from frontend (e.g., &#x2F; instead of /)
    let decodedTemplate = template
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    decodedTemplate = this.normalizeInterviewTemplate(decodedTemplate);
    
    console.log('🔍 [EmailService.processTemplate] After HTML decoding, contains {{/if:', decodedTemplate.includes('{{/if'));
    
    try {
      // Check if Handlebars is available
      if (!Handlebars) {
        console.error('❌ Handlebars is not available! Falling back to regex...');
        return this.fallbackProcessTemplate(decodedTemplate, data);
      }
      
      console.log('✅ [EmailService.processTemplate] Handlebars is available, proceeding...');
      
      // Try to get compiled template from cache (use original template as key)
      let compiledTemplate = this.templateCache.get(template);
      
      if (!compiledTemplate) {
        console.log('📝 [EmailService.processTemplate] Compiling new template with Handlebars...');
        // Compile and cache the template (use DECODED template for compilation)
        compiledTemplate = Handlebars.compile(decodedTemplate, {
          noEscape: true, // Don't escape HTML entities
          strict: false   // Don't throw on missing properties
        });
        
        // Only cache if template is reasonably sized
        if (template.length < 10000) {
          this.templateCache.set(template, compiledTemplate);
        }
      } else {
        console.log('📝 [EmailService.processTemplate] Using cached compiled template');
      }
      
      // Render the template with data
      const result = compiledTemplate(data);
      
      console.log('✅ [EmailService.processTemplate] Handlebars processing complete');
      console.log('📝 [EmailService.processTemplate] Result preview:', result.substring(0, 200));
      console.log('📝 [EmailService.processTemplate] Final contains {{#if:', result.includes('{{#if'));
      console.log('📝 [EmailService.processTemplate] Final contains {{:', result.includes('{{'));
      
      return result;
      
    } catch (error) {
      console.error('❌ [EmailService.processTemplate] Handlebars error:', error);
      console.error('❌ [EmailService.processTemplate] Error stack:', error.stack);
      console.log('⚠️ [EmailService.processTemplate] Falling back to regex-based processing...');
      
      // Fallback to regex-based processing
      return this.fallbackProcessTemplate(decodedTemplate, data);
    }
  }
  
  // Fallback regex-based template processing
  fallbackProcessTemplate(template, data) {
    let processed = template;
    
    console.log('🔍 [EmailService.fallbackProcessTemplate] Using regex-based processing...');
    console.log('📝 [EmailService.fallbackProcessTemplate] Template length:', template.length);
    console.log('📝 [EmailService.fallbackProcessTemplate] Contains {{#if before:', template.includes('{{#if'));
    
    // ✅ CRITICAL: Decode HTML entities FIRST (template may arrive HTML-encoded)
    processed = processed
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    console.log('📝 [EmailService.fallbackProcessTemplate] After HTML decoding, contains {{/if:', processed.includes('{{/if'));
    
    // Normalize line endings
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // ✅ CRITICAL FIX: Process conditionals FIRST, then replace variables
    // This ensures the conditional regex can find the patterns before variables are replaced
    
    // Handle conditional blocks
    const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi;
    
    let matchCount = 0;
    processed = processed.replace(conditionalRegex, (fullMatch, condition, content) => {
      matchCount++;
      const conditionValue = data[condition];
      const isTruthy = conditionValue !== null && 
                      conditionValue !== undefined && 
                      conditionValue !== '' &&
                      conditionValue !== false &&
                      conditionValue !== '0' &&
                      conditionValue !== 0;
      
      console.log(`🔍 [EmailService.fallbackProcessTemplate] Match ${matchCount} - Conditional "${condition}":`);
      console.log(`   Value: ${JSON.stringify(conditionValue)}`);
      console.log(`   Is truthy: ${isTruthy}`);
      console.log(`   Full match: "${fullMatch}"`);
      
      return isTruthy ? content : '';
    });
    
    console.log(`🔍 [EmailService.fallbackProcessTemplate] Processed ${matchCount} conditionals`);
    console.log('📝 [EmailService.fallbackProcessTemplate] After conditionals, contains {{#if:', processed.includes('{{#if'));
    
    // Then replace simple variables
    Object.entries(data).forEach(([key, value]) => {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
      const replacedValue = value !== null && value !== undefined ? String(value) : '';
      processed = processed.replace(regex, replacedValue);
    });
    
    console.log('📝 [EmailService.fallbackProcessTemplate] Final contains {{#if:', processed.includes('{{#if'));
    console.log('📝 [EmailService.fallbackProcessTemplate] Final contains {{:', processed.includes('{{'));
    
    return processed;
  }

  async sendPasswordResetEmail(to, token, frontendUrl = null) {
    // Use passed URL or fallback to environment variable or default
    const baseUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password/${token}`;
    const organizationName = this.getOrganizationBrand();
    
    const emailData = {
      sender: {
        name: organizationName,
        email: 'no-reply@aiinnigeria.com',
      },
      to: [
        {
          email: to,
        },
      ],
      subject: this.ensureOrganizationSubject('Password Reset Request', organizationName),
      textContent: `
SMARTHR - PASSWORD RESET REQUEST
===============================

Hello,

You have requested to reset your password for your ${organizationName} account.

RESET YOUR PASSWORD:
Click the link below or copy and paste it into your browser:
${resetUrl}

IMPORTANT SECURITY INFORMATION:
- This link will expire in 1 hour for security purposes
- If you did not request this password reset, please ignore this email
- Your password will remain unchanged if you do not click the link

NEED HELP?
If you have any questions, contact our support team:
- Email: support@smarthr.app
- Reply to this email for assistance

Best regards,
The ${organizationName} Team

---
${organizationName} - Smart Hiring, Smarter Results
This email was sent to ${to} because a password reset was requested for your account.
      `,
      htmlContent: `
        <p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
        <p>Please click on the following link, or paste this into your browser to complete the process:</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
      `,
    };

    emailData.textContent = this.applyOrganizationBrand(emailData.textContent, organizationName);
    emailData.htmlContent = this.applyOrganizationBrand(emailData.htmlContent, organizationName);

    try {
      console.log('Sending password reset email to:', to);
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

      const responseBody = await response.json();

      if (!response.ok) {
        console.error('Brevo API Error:', responseBody);
        throw new Error(`Failed to send email: ${responseBody.message}`);
      }

      console.log('Password reset email sent successfully.');
      return responseBody;
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }

  async sendOrganizationInviteEmail(to, inviterName, organizationName, appUrl) {
    const brandName = this.requireOrganizationBrand(organizationName);
    const emailData = {
      sender: {
        name: brandName,
        email: 'no-reply@aiinnigeria.com',
      },
      to: [
        {
          email: to,
        },
      ],
      subject: this.ensureOrganizationSubject(`Invitation to join ${brandName}`, brandName),
      textContent: `
Hello,

${inviterName} has invited you to join ${brandName}.

To get started, simply visit: ${appUrl}

Sign in to your existing account or create a new one to collaborate with your team on ${brandName}.

Best regards,
The ${brandName} Team

---
This email was sent to ${to} because ${inviterName} invited you to join ${brandName}.
      `,
      htmlContent: `
        <p>Hello,</p>
        <p><strong>${inviterName}</strong> has invited you to join <strong>${brandName}</strong>.</p>
        <p>To get started, simply visit: <a href="${appUrl}">${appUrl}</a></p>
        <p>Sign in to your existing account or create a new one to collaborate with your team on ${brandName}.</p>
        <p>Best regards,<br>The ${brandName} Team</p>
        <hr>
        <p><small>This email was sent to ${to} because ${inviterName} invited you to join ${brandName}.</small></p>
      `
    };

    emailData.textContent = this.applyOrganizationBrand(emailData.textContent, brandName);
    emailData.htmlContent = this.applyOrganizationBrand(emailData.htmlContent, brandName);

    try {
      // Recipients and subject only: message bodies are never logged.
      console.log('Sending organization invite email to:', toMailboxList(emailData.to).join(', '), '|', emailData.subject);
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

      const responseBody = await response.json();

      if (!response.ok) {
        console.error('Brevo API Error:', responseBody);
        throw new Error(`Failed to send email: ${responseBody.message}`);
      }

      console.log('Organization invite email sent successfully.');
      console.log('Brevo API response:', responseBody);
      return responseBody;
    } catch (error) {
      console.error('Error sending organization invite email:', error);
      throw error;
    }
  }

  async sendInterviewInviteEmail(to, templateData, customTemplate = null, bccEmails = [], ccEmails = [], options = {}) {
    try {
      console.log('Sending interview invitation email to:', to);
      console.log('📊 Raw template data:', JSON.stringify(templateData, null, 2));
      
      // Decode HTML entities in template data
      const decodedData = decodeObjectHtmlEntities(templateData);
      
      // Normalize template data - convert empty strings to null for proper conditional evaluation
      const normalizedData = { ...decodedData };
      Object.keys(normalizedData).forEach(key => {
        if (normalizedData[key] === '' || normalizedData[key] === undefined) {
          normalizedData[key] = null;
        }
      });
      
      console.log('📊 Normalized template data:', JSON.stringify(normalizedData, null, 2));
      
      // ✅ CRITICAL: Template MUST be provided by frontend - no backend fallback
      if (!customTemplate || customTemplate.trim() === '') {
        throw new Error('Email template is required. Frontend must provide the template.');
      }
      
      console.log('📝 [EmailService] Template BEFORE processing (first 500 chars):', customTemplate.substring(0, 500));
      
      // Process and sanitize template output.
      const renderedTemplate = this.processTemplate(customTemplate, normalizedData);
      const hasHtmlMarkup = isHtmlLike(customTemplate) || isHtmlLike(renderedTemplate);
      const textContent = hasHtmlMarkup ? htmlToText(renderedTemplate) : renderedTemplate;
      const htmlContent = hasHtmlMarkup
        ? sanitizeEmailHtml(renderedTemplate)
        : sanitizeEmailHtml(plainTextToEmailHtml(renderedTemplate));

      if (!htmlContent) {
        throw new Error('Email template produced empty content after sanitization.');
      }
      
      // ✅ CRITICAL: Log the processed result for debugging
      console.log('📝 [EmailService] Template AFTER processing (first 500 chars):', textContent.substring(0, 500));
      console.log('🔍 [EmailService] Checking for raw template syntax:', {
        hasRawIfSyntax: textContent.includes('{{#if'),
        hasRawEndIfSyntax: textContent.includes('{{/if'),
        hasMeetingLinkPlaceholder: textContent.includes('{{meetingLink}}'),
        hasNotesPlaceholder: textContent.includes('{{notes}}')
      });
      
      const organizationName = this.requireOrganizationBrand(normalizedData.organizationName);
      const emailData = {
        sender: {
          name: organizationName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [
          {
            email: to,
          },
        ],
        subject: this.ensureOrganizationSubject(`Interview Invitation: ${normalizedData.jobTitle} - ${normalizedData.interviewDate}`, organizationName),
        textContent: this.applyOrganizationBrand(textContent, organizationName),
        htmlContent: this.applyOrganizationBrand(htmlContent, organizationName),
      };

      // Add attachments if provided (e.g., job description PDF).
      if (Array.isArray(options.attachments) && options.attachments.length > 0) {
        const normalizedAttachments = options.attachments
          .filter(item => item && item.content && (item.name || item.filename))
          .map(item => ({
            name: item.name || item.filename,
            content: item.content,
            contentType: item.contentType || 'application/pdf'
          }));

        if (normalizedAttachments.length > 0) {
          // Brevo SMTP API expects `attachment` (singular) as an array.
          // Keep `attachments` for backward compatibility with existing integrations.
          emailData.attachment = normalizedAttachments;
          emailData.attachments = normalizedAttachments;
        }
      }

      // Add CC recipients if provided
      if (ccEmails && ccEmails.length > 0) {
        emailData.cc = ccEmails.map(email => ({ email: email }));
      }

      // Add BCC recipients if provided
      if (bccEmails && bccEmails.length > 0) {
        emailData.bcc = bccEmails.map(email => ({ email: email }));
      }
      
      // Recipients and subject only: message bodies are never logged.
      console.log('Sending interview email to:', toMailboxList(emailData.to).join(', '), '|', emailData.subject);
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });
      
      const responseBody = await response.json();
      
      if (!response.ok) {
        console.error('Brevo API Error:', responseBody);
        throw new Error(`Failed to send email: ${responseBody.message}`);
      }
      
      console.log('Interview invitation email sent successfully.');
      return responseBody;
    } catch (error) {
      console.error('Error sending interview invitation email:', error);
      throw error;
    }
  }

  /**
   * Send an admin invite email including the initial password set by the inviter
   */
  async sendAdminInviteWithPassword(to, name, loginEmail, initialPassword) {
    try {
      const organizationName = this.getOrganizationBrand();
      // Hardcoded production URL - do not use environment variables
      const portalUrl = 'https://smarthr.aiinnigeria.com/admin/login';

      const subject = this.ensureOrganizationSubject('Your Admin Account Details', organizationName);
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="background: linear-gradient(90deg, #2563eb, #7c3aed); padding: 20px; border-radius: 8px 8px 0 0; color: #fff;">
            <h2 style="margin: 0;">${organizationName} Admin Invitation</h2>
          </div>
          <div style="padding: 24px; color: #111827;">
            <p>Hello ${name || 'there'},</p>
            <p>You have been granted access to the <strong>${organizationName} Admin Portal</strong>.</p>
            <div style="background:#f3f4f6; padding:16px; border-radius:8px; border:1px solid #e5e7eb;">
              <p style="margin:0 0 8px 0; font-weight:600;">Your login details:</p>
              <p style="margin:4px 0;"><strong>Email:</strong> ${loginEmail}</p>
              <p style="margin:4px 0;"><strong>Temporary Password:</strong> ${initialPassword}</p>
            </div>
            <p style="margin-top:16px;">For security, please log in and change your password immediately.</p>
            <div style="text-align:center; margin-top:20px;">
              <a href="${portalUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 20px; border-radius:6px; text-decoration:none; font-weight:600;">Open Admin Portal</a>
            </div>
          </div>
          <div style="padding: 16px; color:#6b7280; font-size:12px; text-align:center; border-top:1px solid #e5e7eb;">
            <p style="margin:0;">If you did not expect this email, please contact your system administrator.</p>
          </div>
        </div>
      `;

      const emailData = {
        sender: {
          name: organizationName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [{ email: to }],
        subject,
        htmlContent: this.applyOrganizationBrand(htmlContent, organizationName)
      };

      console.log('📨 Sending admin invite (Brevo) to:', to, 'portalUrl:', portalUrl);
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

      const responseBody = await response.json().catch(() => ({}));
      console.log('📭 Brevo response status:', response.status, 'body:', responseBody);

      if (!response.ok) {
        console.error('❌ Brevo admin invite error:', responseBody);
        throw new Error(`Failed to send admin invite: ${responseBody.message || response.statusText}`);
      }

      console.log('✅ Admin invite email sent via Brevo');
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending admin invite email:', error);
      throw error;
    }
  }

  async sendInterviewCancellationEmail(to, templateData, customTemplate = null) {
    try {
      console.log('Sending interview cancellation email to:', to);
      console.log('Template data:', templateData);
      
      // Decode HTML entities in template data
      const decodedData = decodeObjectHtmlEntities(templateData);
      
      // Process the template with the provided data
      const textContent = this.processTemplate(
        customTemplate || `Dear {{candidateName}},

We regret to inform you that your scheduled interview for the {{jobTitle}} position has been cancelled.

Interview Details:
Date: {{interviewDate}}
Time: {{interviewTime}}
Duration: {{duration}} minutes

{{#if cancellationReason}}
Reason for cancellation: {{cancellationReason}}
{{/if}}

We sincerely apologize for any inconvenience this may cause. If you have any questions or would like to reschedule, please contact us.

Thank you for your understanding.

Best regards,
{{interviewerName}}
{{organizationName}}`,
        decodedData
      );
      
      // Create HTML version with basic formatting
      const htmlContent = textContent.replace(/\n/g, '<br>');
      
      const organizationName = this.requireOrganizationBrand(decodedData.organizationName);
      const emailData = {
        sender: {
          name: organizationName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [
          {
            email: to,
          },
        ],
        subject: this.ensureOrganizationSubject(`Interview Cancelled: ${decodedData.jobTitle} - ${decodedData.interviewDate}`, organizationName),
        textContent: this.applyOrganizationBrand(textContent, organizationName),
        htmlContent: this.applyOrganizationBrand(htmlContent, organizationName),
      };
      
      // Recipients and subject only: message bodies are never logged.
      console.log('Sending interview cancellation email to:', toMailboxList(emailData.to).join(', '), '|', emailData.subject);
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });
      
      const responseBody = await response.json();
      
      if (!response.ok) {
        console.error('Failed to send interview cancellation email:', responseBody);
        throw new Error(`Failed to send cancellation email: ${responseBody.message}`);
      }
      
      console.log('Interview cancellation email sent successfully.');
      return responseBody;
    } catch (error) {
      console.error('Error sending interview cancellation email:', error);
      throw error;
    }
  }

  async sendAdminPasswordResetOTP(to, otp, adminName) {
    const organizationName = this.getOrganizationBrand();
    const emailData = {
      sender: {
        name: organizationName,
        email: 'no-reply@aiinnigeria.com',
      },
      to: [
        {
          email: to,
        },
      ],
      subject: this.ensureOrganizationSubject('Admin Password Reset - OTP Verification', organizationName),
      textContent: `
SMARTHR - ADMIN PASSWORD RESET OTP
==================================

Hello ${adminName || 'Admin'},

You have requested to reset your ${organizationName} admin account password.

YOUR OTP CODE:
${otp}

IMPORTANT INFORMATION:
- This OTP will expire in 10 minutes
- You have 3 attempts to enter the correct OTP
- This is for admin account access only

SECURITY NOTICE:
If you did not request this password reset, please contact the system administrator immediately at no-reply@aiinnigeria.com

For security reasons, please do not share this OTP with anyone.

Best regards,
${organizationName} Admin Team

This is an automated email. Please do not reply to this message.
      `,
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #1f2937; border-radius: 8px;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${organizationName}</h1>
            <p style="color: #9ca3af; margin: 5px 0 0 0; font-size: 14px;">Admin Portal</p>
          </div>
          
          <div style="padding: 20px; background-color: #f8fafc; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #1f2937; margin-top: 0;">Admin Password Reset</h2>
            <p style="color: #374151; line-height: 1.6;">Hello ${adminName || 'Admin'},</p>
            <p style="color: #374151; line-height: 1.6;">
              You have requested to reset your ${organizationName} admin account password. Please use the following OTP to verify your identity:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #1f2937; color: #ffffff; padding: 25px; border-radius: 8px; display: inline-block; border: 3px solid #3b82f6;">
                <p style="margin: 0; font-size: 14px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Your OTP Code</p>
                <h3 style="margin: 10px 0 0 0; font-size: 36px; letter-spacing: 8px; font-weight: bold; color: #ffffff;">${otp}</h3>
              </div>
            </div>
            
            <div style="background-color: #dbeafe; padding: 15px; border-radius: 6px; border-left: 4px solid #3b82f6; margin: 20px 0;">
              <p style="margin: 0; color: #1e40af; font-size: 14px;">
                <strong>⏰ Time Limit:</strong> This OTP will expire in 10 minutes<br>
                <strong>🔒 Attempts:</strong> You have 3 attempts to enter the correct OTP
              </p>
            </div>
          </div>
          
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin-bottom: 20px;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>🛡️ Security Notice:</strong> This is a sensitive admin account operation. If you didn't request this reset, please contact the system administrator immediately at <a href="mailto:no-reply@aiinnigeria.com" style="color: #92400e;">no-reply@aiinnigeria.com</a>
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; color: #6b7280; font-size: 12px;">
              This email was sent from ${organizationName} Admin Portal<br>
              Please do not reply to this email
            </p>
          </div>
        </div>
      `,
    };

    emailData.textContent = this.applyOrganizationBrand(emailData.textContent, organizationName);
    emailData.htmlContent = this.applyOrganizationBrand(emailData.htmlContent, organizationName);

    try {
      const fetch = await this.fetch;
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Email API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Admin OTP email sent successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to send admin OTP email:', error);
      throw error;
    }
  }
  
  /**
   * Send a notification email to admin users
   * @param {string} to - Admin email address
   * @param {string} subject - Email subject
   * @param {string} message - Email content
   * @returns {Object} - Status of the email sending operation
   */
  async sendAdminNotification(to, subject, message) {
    try {
      const organizationName = this.getOrganizationBrand();
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${organizationName} Admin Notification</h2>
          <p>${message}</p>
          <p>Please log into the admin dashboard to take action.</p>
          <div style="margin: 20px 0;">
            <a href="https://smarthr.aiinnigeria.com/admin/login" 
               style="background-color: #007bff; color: white; padding: 10px 20px; 
                      text-decoration: none; border-radius: 5px; font-weight: bold;">
              Open Admin Dashboard
            </a>
          </div>
          <p>Thank you,<br>The ${organizationName} System</p>
        </div>
      `;
      
      const payload = {
        sender: {
        name: organizationName,
        email: 'no-reply@aiinnigeria.com',
      },
        to: [{ email: to }],
        subject: this.ensureOrganizationSubject(subject, organizationName),
        htmlContent: this.applyOrganizationBrand(htmlContent, organizationName)
      };
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Error sending admin notification email:', error);
        throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
      }
      
      return {
        success: true,
        message: 'Admin notification email sent successfully'
      };
    } catch (error) {
      console.error('Error sending admin notification email:', error);
      return {
        success: false,
        message: `Failed to send admin notification email: ${error.message}`
      };
    }
  }
  
  /**
   * Send a notification email to users
   * @param {string} to - User email address
   * @param {string} subject - Email subject
   * @param {string} message - Email content
   * @param {Object} options - Additional options (attachments, etc.)
   * @returns {Object} - Status of the email sending operation
   */
  async sendUserNotification(to, subject, message, options = {}) {
    const hasOrganizationBrand =
      Object.prototype.hasOwnProperty.call(options, 'senderName') ||
      Object.prototype.hasOwnProperty.call(options, 'organizationName');
    const requestedBrand = options.senderName ?? options.organizationName;
    const senderDisplayName = hasOrganizationBrand
      ? this.requireOrganizationBrand(requestedBrand)
      : this.getOrganizationBrand();

    try {
      // Check if this is a custom HTML email (like interview feedback)
      const isCustomHtml = options.htmlContent || message.includes('<div') || message.includes('<html');
      
      let htmlContent;
      
      if (isCustomHtml) {
        // For custom HTML emails (like interview feedback), use the provided content as-is
        htmlContent = options.htmlContent || message;
      } else {
        // For regular notifications, use the template with generic button
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="text-align: center; padding: 20px 0; background-color: #ffffff; border-radius: 8px 8px 0 0; border-bottom: 2px solid #007bff;">
              <h1 style="color: #007bff; margin: 0; font-size: 28px;">${senderDisplayName}</h1>
              <p style="color: #555555; margin: 5px 0 0 0; font-size: 16px;">Smart Hiring, Smarter Results</p>
            </div>
            
            <div style="background-color: #ffffff; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
              <div style="color: #444444; line-height: 1.6; font-size: 16px;">
                ${message}
              </div>
              
              <div style="margin: 30px 0; text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'https://smarthr.aiinnigeria.com'}" 
                  style="background-color: #007bff; color: white; padding: 12px 25px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold;
                        display: inline-block; font-size: 16px;">
                  Go to ${senderDisplayName}
                </a>
              </div>
            </div>
            
            <div style="margin-top: 20px; text-align: center; color: #888888; font-size: 14px;">
              <p>Thank you for using ${senderDisplayName}.</p>
              <p>© ${new Date().getFullYear()} ${senderDisplayName}. All rights reserved.</p>
            </div>
          </div>
        `;
      }
      
      const payload = {
        sender: {
        name: senderDisplayName,
        email: 'no-reply@aiinnigeria.com',
      },
        to: [{ email: to }],
        subject: this.ensureOrganizationSubject(subject, senderDisplayName),
        htmlContent: this.applyOrganizationBrand(htmlContent, senderDisplayName)
      };
      
      // Add attachments if provided
      if (options.attachments && options.attachments.length > 0) {
        // Brevo SMTP API expects `attachment` (singular) as an array.
        // Keep `attachments` for backward compatibility with any existing callers.
        payload.attachment = options.attachments;
        payload.attachments = options.attachments;
      }
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Error sending user notification email:', error);
        throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
      }
      
      return {
        success: true,
        message: 'User notification email sent successfully'
      };
    } catch (error) {
      console.error('Error sending user notification email:', error);
      return {
        success: false,
        message: `Failed to send user notification email: ${error.message}`
      };
    }
  }

  /**
   * Send interview notification email to interviewers/observers
   * This is different from the interview invitation (which goes to candidates)
   */
  async sendInterviewNotificationEmail(to, templateData, customTemplate = null) {
    try {
      console.log('📧 Sending interview notification to interviewer/observer:', to);
      
      // Generate feedback link for this interviewer
      const frontendUrl = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://smarthr.aiinnigeria.com';
      const feedbackUrl = `${frontendUrl}/public/feedback/${templateData.interviewId}`;
      
      // Create resume link
      let resumeLink = '';
      if (templateData.candidateResumeUrl) {
        resumeLink = `<p style="margin: 15px 0;"><a href="${templateData.candidateResumeUrl}" style="background-color: #4f46e5; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 500;">View Resume</a></p>`;
      }
      
      
      // Create rich HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Interview Notification</title>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              color: #333;
              line-height: 1.6;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 650px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #4f46e5;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              background-color: #ffffff;
              padding: 30px;
              border-radius: 0 0 8px 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Interview Notification</h1>
              <p style="margin: 5px 0 0 0;">You have an interview to conduct</p>
            </div>
            
            <div class="content">
              <h2>Hello ${templateData.interviewerName || 'Team Member'},</h2>
              <p>You have an upcoming interview to conduct for the <strong>${templateData.jobTitle}</strong> position.</p>
              
              <div style="margin-bottom: 25px; padding: 20px; background-color: #e0f2fe; border-radius: 8px;">
                <h3 style="margin-top: 0; color: #0277bd;">Interview Details</h3>
                <p><strong>Date:</strong> ${templateData.interviewDate}</p>
                <p><strong>Time:</strong> ${templateData.interviewTime}</p>
                <p><strong>Duration:</strong> ${templateData.duration} minutes</p>
                <p><strong>Format:</strong> ${templateData.interviewType}</p>
                ${templateData.meetingLink ? `<p><strong>Meeting Link:</strong> <a href="${templateData.meetingLink}" style="color: #1976d2;">${templateData.meetingLink}</a></p>` : ''}
                ${templateData.notes ? `<p><strong>Notes:</strong> ${templateData.notes}</p>` : ''}
              </div>
              
              <div style="margin-bottom: 25px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
                <h3 style="margin-top: 0; color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; margin-bottom: 15px;">Candidate Profile</h3>
                <p><strong>Name:</strong> ${templateData.candidateName}</p>
                <p><strong>Position:</strong> ${templateData.jobTitle}</p>
                ${templateData.candidateCurrentRole ? `<p><strong>Current Role:</strong> ${templateData.candidateCurrentRole}</p>` : ''}
                ${templateData.candidateLocation ? `<p><strong>Location:</strong> ${templateData.candidateLocation}</p>` : ''}
                ${templateData.candidateExperience ? `<p><strong>Experience:</strong> ${templateData.candidateExperience} years</p>` : ''}
                ${resumeLink}
              </div>
              
              <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #f3f4f6; border-radius: 8px;">
                <h3 style="color: #4338ca; margin-bottom: 15px;">Interview Questions & Feedback</h3>
                <p style="margin-bottom: 20px; color: #6b7280;">Access the interview questions and provide feedback using the link below:</p>
                <a href="${feedbackUrl}" 
                   style="background-color: #4f46e5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 16px; margin: 10px 0;">
                  View Questions & Submit Feedback
                </a>
                <p style="font-size: 14px; color: #6b7280; margin-top: 15px;">
                  This link provides access to the selected interview questions and allows you to submit feedback after the interview.
                </p>
              </div>
              
              <div style="margin-top: 30px; padding: 15px; background-color: #fffbf3; border-left: 4px solid #f59e0b; border-radius: 4px;">
                <p style="margin: 0; color: #92400e;"><strong>📌 Important:</strong> Please review the candidate's profile before the interview. Use the feedback link above to access interview questions and submit your assessment after the interview concludes.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const organizationName = this.requireOrganizationBrand(templateData.organizationName);
      const emailData = {
        sender: {
          name: organizationName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [
          {
            email: to,
          },
        ],
        subject: this.ensureOrganizationSubject(`Interview Notification: ${templateData.candidateName} - ${templateData.jobTitle}`, organizationName),
        textContent: this.applyOrganizationBrand(textContent, organizationName),
        htmlContent: this.applyOrganizationBrand(htmlContent, organizationName),
      };
      
      // Recipients and subject only: message bodies are never logged.
      console.log('Sending interview notification email to:', toMailboxList(emailData.to).join(', '), '|', emailData.subject);
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });
      
      const responseBody = await response.json();
      
      if (!response.ok) {
        console.error('Brevo API Error:', responseBody);
        throw new Error(`Failed to send email: ${responseBody.message}`);
      }
      
      console.log('Interview notification email sent successfully.');
      return responseBody;
    } catch (error) {
      console.error('Error sending interview notification email:', error);
      throw error;
    }
  }

  /**
   * Send one consolidated participant digest for multi-candidate interview sessions (Brevo).
   * @param {string} to - Participant email
   * @param {Object} digestData - Consolidated digest details
   * @returns {Object} send status
   */
  async sendMultiCandidateParticipantDigestEmail(to, digestData = {}) {
    try {
      const {
        participantName,
        timezone = 'UTC',
        sessionStartTime,
        sessionEndTime,
        sharedMeetingLink = '',
        entries = []
      } = digestData;

      if (!to || !entries.length) {
        return { success: false, message: 'No recipient or digest entries provided' };
      }

      const sessionDateObj = sessionStartTime ? new Date(sessionStartTime) : new Date();
      const sessionDateLabel = sessionDateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });

      const sessionStartLabel = sessionStartTime
        ? new Date(sessionStartTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
            timeZoneName: 'short'
          })
        : '';

      const sessionEndLabel = sessionEndTime
        ? new Date(sessionEndTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
            timeZoneName: 'short'
          })
        : '';

      const subject = `Interview Schedule: ${entries.length} Candidates - ${sessionDateLabel}`;
      const organizationName = this.requireOrganizationBrand(digestData.organizationName);
      const safeParticipantName = escapeHtml(participantName || 'Team Member');
      const safeSessionDateLabel = escapeHtml(sessionDateLabel);
      const safeSessionStartLabel = escapeHtml(sessionStartLabel);
      const safeSessionEndLabel = escapeHtml(sessionEndLabel);
      const safeSharedMeetingLink = escapeHtml(sharedMeetingLink);

      const rowsHtml = entries
        .map(entry => `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(entry.candidateName || 'Candidate')}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(entry.jobTitle || 'Interview')}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(entry.formattedTime || new Date(entry.startTime).toLocaleString('en-US'))}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(String(entry.duration || 0))} min</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
              <a href="${escapeHtml(entry.feedbackUrl || '#')}" style="color: #2563eb; text-decoration: none;">Open Feedback</a>
            </td>
          </tr>
        `)
        .join('');

      const htmlContent = sanitizeEmailHtml(`
        <div style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="padding: 20px; background: #111827; color: #ffffff;">
            <h2 style="margin: 0;">Multi-Candidate Interview Digest</h2>
            <p style="margin: 8px 0 0 0; color: #d1d5db;">${safeSessionDateLabel}</p>
          </div>
          <div style="padding: 20px;">
            <p>Hello ${safeParticipantName},</p>
            <p>You have <strong>${entries.length}</strong> interview${entries.length > 1 ? 's' : ''} scheduled for this session.</p>
            ${sessionStartLabel && sessionEndLabel ? `<p><strong>Session Window:</strong> ${safeSessionStartLabel} - ${safeSessionEndLabel}</p>` : ''}
            ${sharedMeetingLink ? `<p><strong>Shared Meeting Link:</strong> <a href="${safeSharedMeetingLink}" style="color: #2563eb;">${safeSharedMeetingLink}</a></p>` : ''}
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
              <thead>
                <tr style="background: #f3f4f6; text-align: left;">
                  <th style="padding: 10px;">Candidate</th>
                  <th style="padding: 10px;">Role</th>
                  <th style="padding: 10px;">Interview Time</th>
                  <th style="padding: 10px;">Duration</th>
                  <th style="padding: 10px;">Feedback</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <p style="margin-top: 20px; color: #4b5563;">Calendar invites remain on each candidate slot as usual.</p>
          </div>
        </div>
      `);

      return await this.sendUserNotification(
        to,
        this.ensureOrganizationSubject(subject, organizationName),
        `You have ${entries.length} interviews scheduled on ${sessionDateLabel}.`,
        {
          senderName: organizationName,
          htmlContent
        }
      );
    } catch (error) {
      console.error('Error sending multi-candidate participant digest email:', error);
      return {
        success: false,
        message: `Failed to send participant digest email: ${error.message}`
      };
    }
  }

  async sendFeedbackOTP(to, otp, candidateName, jobTitle) {
    try {
      const organizationName = this.getOrganizationBrand();
      const emailData = {
        sender: {
          name: organizationName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [
          {
            email: to,
          },
        ],
        subject: this.ensureOrganizationSubject('Verify Your Email - Interview Feedback Submission', organizationName),
        textContent: `
SMARTHR - EMAIL VERIFICATION
=============================

You are submitting feedback for ${candidateName}'s interview for the ${jobTitle} position.

YOUR VERIFICATION CODE:
${otp}

This code will expire in 10 minutes.

If you did not request this verification, please ignore this email.

Best regards,
${organizationName} Team
        `,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 30px; padding: 20px; background: linear-gradient(135deg, #3b82f6, #9333ea); border-radius: 8px;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${organizationName}</h1>
              <p style="color: #e0e7ff; margin: 5px 0 0 0; font-size: 14px;">Interview Feedback System</p>
            </div>
            
            <div style="padding: 30px; background-color: #f8fafc; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #1f2937; margin-top: 0; text-align: center;">Email Verification Required</h2>
              
              <p style="color: #374151; line-height: 1.6; margin-bottom: 20px;">
                You are submitting feedback for <strong>${candidateName}</strong>'s interview for the <strong>${jobTitle}</strong> position.
              </p>
              
              <div style="background-color: #ffffff; border: 2px dashed #e5e7eb; padding: 25px; text-align: center; margin: 30px 0; border-radius: 8px;">
                <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 14px;">Your verification code is:</p>
                <div style="font-size: 32px; font-weight: bold; color: #3b82f6; letter-spacing: 8px; font-family: monospace;">
                  ${otp}
                </div>
              </div>
              
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
                <p style="color: #92400e; margin: 0; font-size: 14px;">
                  <strong>Important:</strong> This code will expire in 10 minutes. Please enter it on the feedback submission page to continue.
                </p>
              </div>
              
              <p style="color: #6b7280; font-size: 14px; text-align: center; margin-top: 30px;">
                If you did not request this verification, please ignore this email.
              </p>
            </div>
            
            <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
              <p style="margin: 0;">This is an automated email from ${organizationName}. Please do not reply.</p>
              <p style="margin: 5px 0 0 0;">© ${new Date().getFullYear()} ${organizationName}. All rights reserved.</p>
            </div>
          </div>
        `,
      };

      emailData.textContent = this.applyOrganizationBrand(emailData.textContent, organizationName);
      emailData.htmlContent = this.applyOrganizationBrand(emailData.htmlContent, organizationName);
      
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });
      
      const responseBody = await response.json();
      
      if (!response.ok) {
        console.error('Error sending feedback OTP email:', responseBody);
        throw new Error(`Failed to send email: ${JSON.stringify(responseBody)}`);
      }
      
      console.log('✅ Feedback OTP email sent successfully to:', to);
      
      return {
        success: true,
        message: 'OTP sent successfully',
        messageId: responseBody.messageId
      };
      
    } catch (error) {
      console.error('❌ Error sending feedback OTP email:', error);
      throw error;
    }
  }

  /**
   * Generic email sending method
   * @param {Object} options - Email options
   * @param {String} options.to - Recipient email
   * @param {String} options.subject - Email subject
   * @param {String} options.html - HTML content
   * @param {String} options.text - Plain text content (optional)
   * @returns {Promise} Send result
   */
  async sendEmail({ to, subject, html, text, organizationName = null }) {
    if (!isMailConfigured()) {
      console.error('❌ MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL are not set! Email will fail to send.');
      throw new Error('Email service not properly configured');
    }

    try {
      const brandName = organizationName == null
        ? this.getOrganizationBrand()
        : this.requireOrganizationBrand(organizationName);
      const emailData = {
        sender: {
          name: brandName,
          email: 'no-reply@aiinnigeria.com',
        },
        to: [{ email: to }],
        subject: this.ensureOrganizationSubject(subject, brandName),
        htmlContent: this.applyOrganizationBrand(html, brandName)
      };

      if (text) {
        emailData.textContent = this.applyOrganizationBrand(text, brandName);
      }

      console.log('Sending email to:', to);
      const response = await this.fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData)
      });

      const responseBody = await response.json();

      if (!response.ok) {
        console.error('Brevo API Error:', responseBody);
        throw new Error(`Failed to send email: ${responseBody.message}`);
      }

      console.log('Email sent successfully.');
      return responseBody;
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
