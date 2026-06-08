const EmailService = require('./emailService');
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs').promises;
const { decodeHtmlEntities } = require('../utils/htmlDecode');

class CandidateEmailNotificationService {
  constructor() {
    this.emailService = EmailService;
    this.templateCache = new Map();
    this.templatesDir = path.join(__dirname, '../templates/candidate-emails');
    
    console.log('📧 Candidate Email Notification Service initialized');
    console.log('   Templates directory:', this.templatesDir);
    
    // Register Handlebars helpers
    this.registerHandlebarsHelpers();
  }

  /**
   * Register custom Handlebars helpers for email templates
   */
  registerHandlebarsHelpers() {
    // Format date helper
    Handlebars.registerHelper('formatDate', (date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Capitalize helper
    Handlebars.registerHelper('capitalize', (str) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // Conditional helper for stage-specific messages
    Handlebars.registerHelper('stageMessage', (stageName) => {
      const messages = {
        'screening': 'phone screening',
        'technical': 'technical interview',
        'hr': 'HR interview',
        'final': 'final interview',
        'interview': 'interview',
        'assessment': 'assessment',
      };
      const lowerStageName = stageName?.toLowerCase() || '';
      return messages[lowerStageName] || 'next stage';
    });
  }

  /**
   * Get job-level email configuration
   * @param {Object} job - Job object with email settings
   * @returns {Object} Email configuration
   */
  getJobEmailConfig(job) {
    // Default configuration
    const defaultConfig = {
      enableAdvancementEmails: true,
      enableRejectionEmails: true,
      enableShortlistEmails: true,
      senderName: job?.organization?.name || 'SmartHR',
      senderEmail: job?.organization?.email || 'michael.egbo@aiinnigeria.com',
      autoSendRejections: false, // Manual by default
      customTemplates: {}
    };

    // Merge with job-specific settings
    const jobConfig = job?.emailSettings || {};
    return { ...defaultConfig, ...jobConfig };
  }

  /**
   * Load and compile email template from file system
   * @param {string} templateName - Name of the template file
   * @returns {Promise<Function>} Compiled Handlebars template function
   */
  async loadTemplate(templateName) {
    try {
      // Check cache first
      if (this.templateCache.has(templateName)) {
        return this.templateCache.get(templateName);
      }

      const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      
      // Compile the template with Handlebars
      const compiledTemplate = Handlebars.compile(templateContent, {
        noEscape: true, // Don't escape HTML entities
        strict: false   // Don't throw on missing properties
      });
      
      // Cache the compiled template
      this.templateCache.set(templateName, compiledTemplate);
      
      return compiledTemplate;
    } catch (error) {
      console.error(`❌ Error loading template ${templateName}:`, error);
      
      // Return compiled default template based on type
      const defaultTemplate = this.getDefaultTemplate(templateName);
      return Handlebars.compile(defaultTemplate, {
        noEscape: true,
        strict: false
      });
    }
  }

  /**
   * Get default template when file-based template is not available
   * @param {string} templateName - Template name
   * @returns {string} Default template
   */
  getDefaultTemplate(templateName) {
    const defaultTemplates = {
      'advancement-congratulations': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Congratulations, {{candidateName}}!</h2>
          <p>We're excited to inform you that you've been selected to advance to the next stage of our hiring process for the <strong>{{jobTitle}}</strong> position.</p>
          <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #2563eb; margin: 20px 0;">
            <p><strong>Next Stage:</strong> {{nextStageName}}</p>
            {{#if stageDescription}}
            <p><strong>What to Expect:</strong> {{stageDescription}}</p>
            {{/if}}
          </div>
          <p>We'll be in touch soon with more details about the next steps.</p>
          <p>Best regards,<br>{{organizationName}} Hiring Team</p>
        </div>
      `,
      'shortlist-congratulations': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">Great News, {{candidateName}}!</h2>
          <p>We're pleased to inform you that you've been shortlisted for the <strong>{{jobTitle}}</strong> position at {{organizationName}}.</p>
          <div style="background-color: #f0fdf4; padding: 15px; border-left: 4px solid #16a34a; margin: 20px 0;">
            <p>Your application stood out among many qualified candidates, and we're excited to move forward with you in our selection process.</p>
          </div>
          <p>We'll be reviewing shortlisted candidates and will contact you soon with next steps.</p>
          <p>Thank you for your interest in joining our team!</p>
          <p>Best regards,<br>{{organizationName}} Hiring Team</p>
        </div>
      `,
      'rejection-notice': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #374151;">Thank you for your interest, {{candidateName}}</h2>
          <p>We appreciate the time you invested in applying for the <strong>{{jobTitle}}</strong> position at {{organizationName}}.</p>
          <div style="background-color: #f9fafb; padding: 15px; border-left: 4px solid #6b7280; margin: 20px 0;">
            <p>After careful consideration, we have decided to move forward with other candidates whose qualifications more closely match our current needs.</p>
            {{#if feedback}}
            <p><strong>Feedback:</strong> {{feedback}}</p>
            {{/if}}
          </div>
          <p>This decision doesn't reflect on your qualifications, and we encourage you to apply for other positions that match your skills and experience.</p>
          <p>We wish you all the best in your career journey.</p>
          <p>Sincerely,<br>{{organizationName}} Hiring Team</p>
        </div>
      `,
      'shortlist-rejection': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #374151;">Thank you for your application, {{candidateName}}</h2>
          <p>We appreciate your interest in the <strong>{{jobTitle}}</strong> position at {{organizationName}}.</p>
          <div style="background-color: #f9fafb; padding: 15px; border-left: 4px solid #6b7280; margin: 20px 0;">
            <p>After reviewing your application, we have decided not to move forward with your candidacy at this time.</p>
          </div>
          <p>We received many qualified applications, and while your background is impressive, we've selected candidates whose experience more closely aligns with our specific requirements.</p>
          <p>We encourage you to apply for future openings that match your skills and interests.</p>
          <p>Best wishes,<br>{{organizationName}} Hiring Team</p>
        </div>
      `
    };

    return defaultTemplates[templateName] || `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p>Hello {{candidateName}},</p>
        <p>This is an update regarding your application for {{jobTitle}} at {{organizationName}}.</p>
        <p>Best regards,<br>{{organizationName}} Team</p>
      </div>
    `;
  }

  /**
   * Send advancement congratulations email
   * @param {Object} options - Email options
   * @param {Object} options.candidate - Candidate object
   * @param {Object} options.job - Job object  
   * @param {Object} options.fromStage - Previous stage info
   * @param {Object} options.toStage - New stage info
   * @param {string} options.notes - Optional notes
   */
  async sendAdvancementEmail({ candidate, job, fromStage, toStage, notes }) {
    try {
      const emailConfig = this.getJobEmailConfig(job);
      
      if (!emailConfig.enableAdvancementEmails) {
        console.log('📧 Advancement emails disabled for job:', job.title);
        return { sent: false, reason: 'Advancement emails disabled for this job' };
      }

      // Prepare template data (decode HTML entities)
      const { decodeHtmlEntities } = require('../utils/htmlDecode');
      const templateData = {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: decodeHtmlEntities(job.title),
        organizationName: job.organization?.name || emailConfig.senderName,
        nextStageName: toStage?.name || 'Next Stage',
        previousStageName: fromStage?.name || 'Previous Stage',
        stageDescription: toStage?.description || '',
        notes: notes || '',
        applicationDate: new Date().toLocaleDateString(),
        companyLogo: job.organization?.logoUrl || ''
      };

      // Load and process template
      const customTemplateHTML = emailConfig.customTemplates?.advancement;
      
      let htmlContent;
      
      if (customTemplateHTML && customTemplateHTML.length > 50) {
        // Custom HTML template provided
        console.log('📧 Using custom HTML template for advancement from job settings');
        const Handlebars = require('handlebars');
        const template = Handlebars.compile(customTemplateHTML);
        htmlContent = template(templateData);
      } else {
        // Use default template file
        console.log('📧 Using default advancement template');
        const template = await this.loadTemplate('advancement-congratulations');
        htmlContent = template(templateData);
      }

      // Send email
      const emailResult = await this.emailService.sendEmail({
        to: candidate.email,
        subject: decodeHtmlEntities(`Congratulations! Next steps for ${job.title} position`),
        html: htmlContent
      });

      console.log('✅ Advancement email sent to:', candidate.email);
      return { sent: true, messageId: emailResult.messageId };

    } catch (error) {
      console.error('❌ Error sending advancement email:', error);
      throw error;
    }
  }

  /**
   * Send shortlist congratulations email
   * @param {Object} options - Email options
   * @param {Object} options.candidate - Candidate object
   * @param {Object} options.job - Job object
   */
  async sendShortlistEmail({ candidate, job }) {
    try {
      const emailConfig = this.getJobEmailConfig(job);
      
      if (!emailConfig.enableShortlistEmails) {
        console.log('📧 Shortlist emails disabled for job:', job.title);
        return { sent: false, reason: 'Shortlist emails disabled for this job' };
      }

      // Prepare template data (decode HTML entities)
      const { decodeHtmlEntities } = require('../utils/htmlDecode');
      const templateData = {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: decodeHtmlEntities(job.title),
        organizationName: job.organization?.name || emailConfig.senderName,
        applicationDate: new Date().toLocaleDateString(),
        companyLogo: job.organization?.logoUrl || ''
      };

      // Load and process template
      const customTemplateHTML = emailConfig.customTemplates?.shortlist;
      
      let htmlContent;
      
      if (customTemplateHTML && customTemplateHTML.length > 50) {
        // Custom HTML template provided
        console.log('📧 Using custom HTML template for shortlist from job settings');
        const Handlebars = require('handlebars');
        const template = Handlebars.compile(customTemplateHTML);
        htmlContent = template(templateData);
      } else {
        // Use default template file
        console.log('📧 Using default shortlist template');
        const template = await this.loadTemplate('shortlist-congratulations');
        htmlContent = template(templateData);
      }

      // Send email
      const emailResult = await this.emailService.sendEmail({
        to: candidate.email,
        subject: decodeHtmlEntities(`Great news about your application for ${job.title}`),
        html: htmlContent
      });

      console.log('✅ Shortlist email sent to:', candidate.email);
      return { sent: true, messageId: emailResult.messageId };

    } catch (error) {
      console.error('❌ Error sending shortlist email:', error);
      throw error;
    }
  }

  /**
   * Send rejection email
   * @param {Object} options - Email options
   * @param {Object} options.candidate - Candidate object
   * @param {Object} options.job - Job object
   * @param {string} options.reason - Rejection reason/feedback
   * @param {string} options.stage - Stage where rejection occurred
   * @param {boolean} options.isShortlistRejection - Whether this is shortlist rejection
   * @param {boolean} options.forceManual - Force manual sending even if auto is enabled
   */
  async sendRejectionEmail({ candidate, job, reason, stage, isShortlistRejection = false, forceManual = false }) {
    try {
      const emailConfig = this.getJobEmailConfig(job);
      
      if (!emailConfig.enableRejectionEmails) {
        console.log('📧 Rejection emails disabled for job:', job.title);
        return { sent: false, reason: 'Rejection emails disabled for this job' };
      }

      // Check if manual approval is required and not forced
      if (!emailConfig.autoSendRejections && !forceManual) {
        console.log('📧 Rejection email queued for manual approval:', candidate.email);
        return { sent: false, reason: 'Manual approval required', queued: true };
      }

      // Prepare template data (decode HTML entities)
      const { decodeHtmlEntities } = require('../utils/htmlDecode');
      
      console.log('🔍 REJECTION EMAIL DEBUG:', {
        candidateEmail: candidate.email,
        jobTitle: job.title,
        isShortlistRejection,
        reasonReceived: reason,
        reasonLength: reason?.length || 0,
        stage
      });
      
      const templateData = {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: decodeHtmlEntities(job.title),
        organizationName: job.organization?.name || emailConfig.senderName,
        feedback: reason || '',
        stage: stage || '',
        applicationDate: new Date().toLocaleDateString(),
        companyLogo: job.organization?.logoUrl || ''
      };
      
      console.log('📧 Template data prepared:', {
        candidateName: templateData.candidateName,
        feedback: templateData.feedback,
        feedbackExists: !!templateData.feedback,
        feedbackLength: templateData.feedback.length
      });

      // Load and process template
      const customTemplateHTML = isShortlistRejection 
        ? emailConfig.customTemplates?.shortlistRejection
        : emailConfig.customTemplates?.rejection;
      
      let htmlContent;
      
      if (customTemplateHTML && customTemplateHTML.length > 50) {
        // Custom HTML template provided - compile it with Handlebars
        console.log('📧 Using custom HTML template from job settings');
        const Handlebars = require('handlebars');
        const template = Handlebars.compile(customTemplateHTML);
        htmlContent = template(templateData);
      } else {
        // Use default template file
        const templateName = isShortlistRejection ? 'shortlist-rejection' : 'rejection-notice';
        console.log('📧 Using default template:', templateName);
        const template = await this.loadTemplate(templateName);
        htmlContent = template(templateData);
      }

      // Send email
      const subject = decodeHtmlEntities(isShortlistRejection 
        ? `Update on your application for ${job.title}`
        : `Thank you for your interest in ${job.title}`);

      const emailResult = await this.emailService.sendEmail({
        to: candidate.email,
        subject: subject,
        html: htmlContent
      });

      console.log('✅ Rejection email sent to:', candidate.email);
      return { sent: true, messageId: emailResult.messageId };

    } catch (error) {
      console.error('❌ Error sending rejection email:', error);
      throw error;
    }
  }

  /**
   * Send bulk rejection emails (for HR manual trigger)
   * @param {Array} candidates - Array of candidate objects with job info
   * @param {string} reason - Common rejection reason
   * @param {boolean} isShortlistRejection - Whether these are shortlist rejections
   */
  async sendBulkRejectionEmails(candidates, reason, isShortlistRejection = false) {
    const results = [];
    
    for (const candidateData of candidates) {
      try {
        const result = await this.sendRejectionEmail({
          candidate: candidateData.candidate,
          job: candidateData.job,
          reason: reason,
          stage: candidateData.stage,
          isShortlistRejection: isShortlistRejection,
          forceManual: true // Force manual sending
        });
        
        results.push({
          candidateId: candidateData.candidate._id,
          email: candidateData.candidate.email,
          success: true,
          result: result
        });
      } catch (error) {
        console.error(`❌ Failed to send rejection email to ${candidateData.candidate.email}:`, error);
        results.push({
          candidateId: candidateData.candidate._id,
          email: candidateData.candidate.email,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    console.log(`📧 Bulk rejection emails: ${successCount} sent, ${failCount} failed`);
    
    return {
      total: results.length,
      sent: successCount,
      failed: failCount,
      results: results
    };
  }

  /**
   * Get queued rejection emails for manual approval
   * @param {string} jobId - Job ID to get queued rejections for
   * @returns {Promise<Array>} Queued rejection emails
   */
  async getQueuedRejectionEmails(jobId) {
    // This would typically query a database table of queued emails
    // For now, return empty array - to be implemented with actual storage
    console.log('📧 Getting queued rejection emails for job:', jobId);
    return [];
  }

  /**
   * Create template directory if it doesn't exist
   */
  async ensureTemplatesDirectory() {
    try {
      await fs.mkdir(this.templatesDir, { recursive: true });
      console.log('📁 Templates directory ensured:', this.templatesDir);
    } catch (error) {
      console.error('❌ Error creating templates directory:', error);
    }
  }
  /**
   * Send application confirmation email when candidate applies via public job link
   * @param {Object} options - Email options
   * @param {Object} options.candidate - Candidate object
   * @param {Object} options.job - Job object
   */
  async sendApplicationConfirmationEmail({ candidate, job }) {
    try {
      console.log(`📧 Sending application confirmation email to ${candidate.email} for job ${job.title}`);
      
      // Application confirmation emails are always sent (not configurable per job)
      // This is a basic courtesy email to acknowledge receipt
      
      const templateName = 'application-confirmation';
      const template = await this.loadTemplate(templateName);
      
      // Decode HTML entities in job data
      const { decodeHtmlEntities } = require('../utils/htmlDecode');
      const templateData = {
        candidate: {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email
        },
        job: {
          title: decodeHtmlEntities(job.title),
          organization: job.organization,
          location: decodeHtmlEntities(job.location),
          contactEmail: job.contactEmail
        },
        now: new Date()
      };

      const htmlContent = template(templateData);
      
      const subject = decodeHtmlEntities(`Application Received - ${job.title} at ${job.organization.name}`);
      
      // Use basic email settings for application confirmations
      const basicEmailSettings = {
        senderName: job.organization.name || 'SmartHR',
        senderEmail: job.contactEmail || process.env.DEFAULT_FROM_EMAIL,
        ccEmails: [],
        bccEmails: [],
        emailSignature: ''
      };
      
      // Send email using the EmailService (Brevo)
      const emailResult = await this.emailService.sendEmail({
        to: candidate.email,
        subject,
        html: htmlContent
      });

      console.log('✅ Application confirmation email sent to:', candidate.email);
      return emailResult;
    } catch (error) {
      console.error('❌ Error sending application confirmation email:', error);
      throw error;
    }
  }

  /**
   * Send notification email when job reaches application limit
   * @param {Object} options - Email options
   * @param {Object} options.job - Job object with populated organization and hiringManager
   */
  async sendJobApplicationLimitReachedEmail({ job }) {
    try {
      // Determine recipient email
      const recipientEmail = job.hiringManager?.email || job.organization?.email;
      
      if (!recipientEmail) {
        console.warn('⚠️ No recipient email found for application limit notification');
        return null;
      }

      const subject = `Application Limit Reached: ${job.title}`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .content { background-color: #fff; padding: 20px; border: 1px solid #dee2e6; border-radius: 8px; }
            .stats { background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .stats ul { list-style: none; padding: 0; margin: 0; }
            .stats li { padding: 5px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px; margin-top: 20px; }
            .footer { text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0; color: #007bff;">🎯 Application Limit Reached</h2>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>The job posting <strong>"${decodeHtmlEntities(job.title)}"</strong> has reached its maximum application limit and is no longer accepting new applications.</p>
              
              <div class="stats">
                <h3 style="margin-top: 0;">Application Statistics:</h3>
                <ul>
                  <li>📊 <strong>Total Applications:</strong> ${job.publicApplicationCount || 0}</li>
                  <li>🎯 <strong>Maximum Allowed:</strong> ${job.candidateApplyLimit || 0}</li>
                  <li>💳 <strong>Reserved Credits:</strong> ${job.reservedCredits || 0}</li>
                </ul>
              </div>
              
              <p>No more applications will be accepted for this position through the public application link.</p>
              
              <p>You can now review all applicants and begin your selection process.</p>
              
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/jobs/${job._id}" class="button">
                View All Applicants
              </a>
            </div>
            <div class="footer">
              <p>This is an automated notification from SmartHR</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Send email
      const emailResult = await this.emailService.sendEmail({
        to: recipientEmail,
        subject: decodeHtmlEntities(subject),
        html: htmlContent
      });

      console.log('✅ Application limit reached email sent to:', recipientEmail);
      return emailResult;
    } catch (error) {
      console.error('❌ Error sending application limit reached email:', error);
      // Don't throw - we don't want to fail the application process if email fails
      return null;
    }
  }
}

module.exports = new CandidateEmailNotificationService();
