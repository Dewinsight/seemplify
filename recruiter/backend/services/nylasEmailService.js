const Nylas = require('nylas').default;
const Handlebars = require('handlebars');
const configLoader = require('../config/configLoader');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

class NylasEmailService {
  constructor() {
    this.apiKey = process.env.NYLAS_API_KEY;
    this.templateCache = new Map();
    this.clientId = process.env.NYLAS_CLIENT_ID;
    this.clientSecret = process.env.NYLAS_CLIENT_SECRET;
    this.redirectUri = configLoader.getCallbackUrl();
    this.apiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';

    if (!this.apiKey) {
      console.warn('⚠️ Nylas API key not found - email functionality will be limited');
    }

    this.nylas = new Nylas({
      apiKey: this.apiKey,
      apiUri: this.apiUri
    });

    console.log('🔧 Nylas Email Service initialized');
    console.log('   API URI:', this.apiUri);
    console.log('   API Key present:', !!this.apiKey);
  }

  /**
   * Send interview invitation email using Nylas connected email
   * @param {string} grantId - Nylas grant ID for the sender's email
   * @param {string} to - Recipient email address
   * @param {object} templateData - Template data for email
   * @param {string} customTemplate - Custom email template (optional)
   * @param {string} customSubject - Custom subject line (optional)
   * @param {Array} bccEmails - Array of BCC email addresses
   * @param {Array} ccEmails - Array of CC email addresses
   * @param {Object} accountCredentials - Optional account credentials for multi-account support
   */
  async sendInterviewInviteEmail(grantId, to, templateData, customTemplate = null, customSubject = null, bccEmails = [], ccEmails = [], accountCredentials = null) {
    try {
      console.log('📧 Sending interview invitation via Nylas to:', to);
      console.log('📧 customTemplate param:', customTemplate ? `${customTemplate.substring(0, 200)}...` : 'NULL');
      console.log('📧 customTemplate type:', typeof customTemplate);
      console.log('📧 customTemplate is empty string:', customTemplate === '');
      console.log('📊 Raw template data:', JSON.stringify(templateData, null, 2));
      
      // Additional debugging for template syntax
      if (customTemplate) {
        console.log('🔍 Template analysis:');
        console.log('   Contains {{#if:', customTemplate.includes('{{#if'));
        console.log('   Contains {{/if:', customTemplate.includes('{{/if'));
        const ifMatches = customTemplate.match(/\{\{#if\s+(\w+)\}\}/g);
        console.log('   If conditions found:', ifMatches);
        
        // Check for potential encoding issues
        const charCodes = customTemplate.substring(0, 20).split('').map(c => c.charCodeAt(0));
        console.log('   First 20 char codes:', charCodes);
      }
      
      // Normalize template data - convert empty strings to null for proper conditional evaluation
      const normalizedData = { ...templateData };
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
      
      console.log('📝 Template BEFORE processing (first 500 chars):', customTemplate.substring(0, 500));
      
      // Process the template with the provided data
      const textContent = this.processTemplate(customTemplate, normalizedData);
      
      // ✅ CRITICAL: Log the processed result for debugging
      console.log('📝 Template AFTER processing (first 500 chars):', textContent.substring(0, 500));
      console.log('🔍 Checking for raw template syntax:', {
        hasRawIfSyntax: textContent.includes('{{#if'),
        hasRawEndIfSyntax: textContent.includes('{{/if'),
        hasMeetingLinkPlaceholder: textContent.includes('{{meetingLink}}'),
        hasNotesPlaceholder: textContent.includes('{{notes}}')
      });
      
      // Create HTML version with basic formatting
      const htmlContent = this.createHtmlFromText(textContent);
      
      console.log('📧 [sendInterviewInviteEmail] HTML content (first 800 chars):', htmlContent.substring(0, 800));
      console.log('🔍 [sendInterviewInviteEmail] HTML contains {{#if:', htmlContent.includes('{{#if'));
      
      // Prepare recipients
      const recipients = [{ email: to }];
      
      // Add CC recipients if provided
      if (ccEmails && ccEmails.length > 0) {
        ccEmails.forEach(email => {
          recipients.push({ email: email, type: 'cc' });
        });
      }
      
      // Add BCC recipients if provided  
      if (bccEmails && bccEmails.length > 0) {
        bccEmails.forEach(email => {
          recipients.push({ email: email, type: 'bcc' });
        });
      }

      // Prepare the message data for Nylas v3
      const messageData = {
        subject: decodeHtmlEntities(customSubject || `Interview Invitation: ${templateData.jobTitle} - ${templateData.interviewDate}`),
        body: htmlContent,
        to: recipients.filter(r => !r.type || r.type === 'to').map(r => ({ email: r.email })),
        cc: recipients.filter(r => r.type === 'cc').map(r => ({ email: r.email })),
        bcc: recipients.filter(r => r.type === 'bcc').map(r => ({ email: r.email })),
        reply_to: [{ email: templateData.interviewerEmail || templateData.organizationEmail }]
        // Note: tracking_options removed - not available on trial accounts
      };

      console.log('📧 [sendInterviewInviteEmail] About to send to Nylas API...');
      console.log('📧 [sendInterviewInviteEmail] Body being sent (first 800 chars):', messageData.body.substring(0, 800));
      console.log('📧 [sendInterviewInviteEmail] Body contains {{#if:', messageData.body.includes('{{#if'));
      
      // Create appropriate Nylas instance or use direct API
      let message;
      if (accountCredentials) {
        // Use direct API call for custom accounts
        console.log(`📧 Using custom Nylas account for email sending`);
        const https = require('https');
        const apiKey = accountCredentials.apiKey;
        const region = accountCredentials.region || 'us';
        const hostname = `api.${region}.nylas.com`;
        
        message = await new Promise((resolve, reject) => {
          const postData = JSON.stringify({
            subject: messageData.subject,
            body: messageData.body,
            to: messageData.to,
            cc: messageData.cc || [],
            bcc: messageData.bcc || [],
            reply_to: messageData.reply_to || []
          });
          
          const options = {
            hostname: hostname,
            path: `/v3/grants/${grantId}/messages/send`,
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          
          const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
              data += chunk;
            });
            
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 201) {
                const response = JSON.parse(data);
                resolve(response.data || response);
              } else {
                console.error(`Failed to send email: ${res.statusCode} - ${data}`);
                reject(new Error(`Failed to send email: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      } else {
        // Use default SDK instance
        message = await this.nylas.messages.send({
          identifier: grantId,
          requestBody: {
            subject: messageData.subject,
            body: messageData.body,
            to: messageData.to,
            cc: messageData.cc || [],
            bcc: messageData.bcc || [],
            reply_to: messageData.reply_to || []
            // tracking_options removed - not available on trial accounts
          }
        });
      }

      console.log('✅ Interview email sent via Nylas successfully:', message.id);
      
      return {
        success: true,
        messageId: message.id,
        message: 'Interview invitation sent successfully via Nylas'
      };

    } catch (error) {
      console.error('❌ Error sending interview invitation via Nylas:', error.message);
      console.error('Full error details:', error);
      
      // Determine if this is a permission/scope error that should fallback to Brevo
      const shouldFallbackToBrevo = error.status === 403 || 
                                  error.message.includes('scope') || 
                                  error.message.includes('permission') ||
                                  error.message.includes('insufficient_scope');
      
      return {
        success: false,
        error: error.message,
        fallbackToBrevo: shouldFallbackToBrevo,
        needsReauth: error.status === 401 || error.message.includes('invalid_grant'),
        details: 'User needs to disconnect and reconnect calendar to grant email permissions'
      };
    }
  }

  /**
   * Create HTML from plain text with basic formatting
   */
  createHtmlFromText(textContent) {
    return textContent
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  /**
   * Process a simple template with handlebars-like syntax
   */
  processTemplate(template, data) {
    console.log('🔍 [processTemplate] Starting Handlebars template processing...');
    console.log('📊 [processTemplate] Data keys:', Object.keys(data));
    console.log('📝 [processTemplate] Input template (first 800 chars):', template.substring(0, 800));
    console.log('📝 [processTemplate] Template contains {{#if:', template.includes('{{#if'));
    console.log('📊 [processTemplate] Data sample:', {
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
    
    console.log('🔍 [processTemplate] After HTML decoding, contains {{/if:', decodedTemplate.includes('{{/if'));
    console.log('🔍 [processTemplate] After HTML decoding (first 200 chars):', decodedTemplate.substring(0, 200));
    
    try {
      // Check if Handlebars is available
      if (!Handlebars) {
        console.error('❌ Handlebars is not available! Falling back to regex...');
        return this.fallbackProcessTemplate(decodedTemplate, data);
      }
      
      console.log('✅ [processTemplate] Handlebars is available, proceeding with compilation...');
      
      // Try to get compiled template from cache (use original template as key)
      let compiledTemplate = this.templateCache.get(template);
      
      if (!compiledTemplate) {
        console.log('📝 [processTemplate] Compiling new template with Handlebars...');
        // Compile and cache the template (use DECODED template for compilation)
        compiledTemplate = Handlebars.compile(decodedTemplate, {
          noEscape: true, // Don't escape HTML entities
          strict: false   // Don't throw on missing properties
        });
        
        // Only cache if template is reasonably sized (avoid memory issues)
        if (template.length < 10000) {
          this.templateCache.set(template, compiledTemplate);
        }
      } else {
        console.log('📝 [processTemplate] Using cached compiled template');
      }
      
      // Render the template with data
      const result = compiledTemplate(data);
      
      console.log('✅ [processTemplate] Handlebars processing complete');
      console.log('📝 [processTemplate] Final result (first 800 chars):', result.substring(0, 800));
      console.log('📝 [processTemplate] Final contains {{#if:', result.includes('{{#if'));
      console.log('📝 [processTemplate] Final contains {{:', result.includes('{{'));
      
      return result;
      
    } catch (error) {
      console.error('❌ [processTemplate] Handlebars compilation error:', error);
      console.error('❌ [processTemplate] Error stack:', error.stack);
      console.log('⚠️ [processTemplate] Falling back to regex-based processing...');
      
      // Fallback to regex-based processing
      return this.fallbackProcessTemplate(template, data);
    }
  }
  
  // Fallback regex-based template processing
  fallbackProcessTemplate(template, data) {
    let result = template;
    
    console.log('🔍 [fallbackProcessTemplate] Using regex-based processing...');
    console.log('📝 [fallbackProcessTemplate] Template length:', template.length);
    console.log('📝 [fallbackProcessTemplate] Contains {{#if before:', template.includes('{{#if'));
    
    // ✅ CRITICAL: Decode HTML entities FIRST (template may arrive HTML-encoded)
    result = result
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    console.log('📝 [fallbackProcessTemplate] After HTML decoding, contains {{/if:', result.includes('{{/if'));
    
    // Normalize line endings
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // ✅ CRITICAL FIX: Process conditionals FIRST, then replace variables
    // This ensures the conditional regex can find the patterns before variables are replaced
    
    // Handle conditional blocks with improved regex
    const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi;
    
    let matchCount = 0;
    result = result.replace(conditionalRegex, (fullMatch, condition, content) => {
      matchCount++;
      const conditionValue = data[condition];
      const isTruthy = conditionValue !== null && 
                      conditionValue !== undefined && 
                      conditionValue !== '' &&
                      conditionValue !== false &&
                      conditionValue !== '0' &&
                      conditionValue !== 0;
      
      console.log(`🔍 [fallbackProcessTemplate] Match ${matchCount} - Conditional "${condition}":`);
      console.log(`   Value: ${JSON.stringify(conditionValue)}`);
      console.log(`   Is truthy: ${isTruthy}`);
      console.log(`   Full match: "${fullMatch}"`);
      console.log(`   Content length: ${content.length}`);
      
      return isTruthy ? content : '';
    });
    
    console.log(`🔍 [fallbackProcessTemplate] Processed ${matchCount} conditionals`);
    console.log('📝 [fallbackProcessTemplate] After conditionals, contains {{#if:', result.includes('{{#if'));
    
    // Then replace simple variables
    for (const [key, value] of Object.entries(data)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
      const replacedValue = value !== null && value !== undefined ? String(value) : '';
      result = result.replace(regex, replacedValue);
    }
    
    console.log('📝 [fallbackProcessTemplate] Final contains {{#if:', result.includes('{{#if'));
    console.log('📝 [fallbackProcessTemplate] Final contains {{:', result.includes('{{'));
    
    return result;
  }

  /**
   * Check if a grant has email sending permissions
   * @param {string} grantId - Nylas grant ID
   * @returns {Object} Permission status
   */
  async checkEmailPermissions(grantId) {
    try {
      // Try to get grant details using Nylas API v3
      const https = require('https');
      const grant = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.us.nylas.com',
          path: `/v3/grants/${grantId}`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`Failed to fetch grant: ${res.statusCode}`));
              return;
            }
            try {
              const response = JSON.parse(data);
              resolve(response.data || response);
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error.message}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });
      
      // Check for email scopes based on provider
      const emailScopes = {
        google: ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'],
        microsoft: ['Mail.Send', 'Mail.ReadWrite'],
        outlook: ['Mail.Send', 'Mail.ReadWrite']
      };

      const provider = grant.provider || 'unknown';
      const grantScopes = grant.scope || [];
      
      // Check if any email scope is present
      const hasEmailScope = emailScopes[provider]?.some(scope => 
        grantScopes.some(grantScope => 
          grantScope.includes(scope) || scope.includes(grantScope)
        )
      ) || false;

      return {
        canSendEmail: hasEmailScope,
        provider: provider,
        scopes: grantScopes,
        grantId: grantId,
        grantStatus: grant.grant_status || 'unknown',
        email: grant.email
      };

    } catch (error) {
      console.error('Error checking email permissions:', error);
      return {
        canSendEmail: false,
        error: error.message,
        grantId: grantId
      };
    }
  }
}

module.exports = new NylasEmailService();
