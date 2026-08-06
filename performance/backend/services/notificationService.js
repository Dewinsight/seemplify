const crypto = require('crypto');
const { isMailConfigured, sendMail } = require('./mailClient');

/**
 * Notification Service
 * Handles email notifications through the self-hosted Seemplify mail service.
 */
class NotificationService {
  constructor() {
    this.fromEmail = process.env.MAIL_FROM_EMAIL || process.env.NOTIFICATION_FROM_EMAIL || 'noreply@smarthr.com';
    this.fromName = process.env.MAIL_FROM_NAME || process.env.NOTIFICATION_FROM_NAME || 'SmartHR Performance';
  }

  /** True when the mail service URL, credential and sender are all present. */
  isConfigured() {
    return isMailConfigured();
  }

  /**
   * Send one email through the Seemplify mail service.
   * @param {string} to
   * @param {string} subject
   * @param {string} htmlContent
   * @param {string|null} [textContent]
   * @param {{ idempotencyKey?: string, tag?: string }} [options]
   */
  async sendEmail(to, subject, htmlContent, textContent = null, options = {}) {
    if (!this.isConfigured()) {
      console.warn('The Seemplify mail service is not configured. Skipping email notification.');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const result = await sendMail({
        from: this.fromEmail,
        fromName: this.fromName,
        to: [to],
        subject,
        html: htmlContent,
        text: textContent || this.stripHtml(htmlContent),
        tag: options.tag || 'performance_notification',
        idempotencyKey: String(options.idempotencyKey || '').trim() || crypto.randomUUID()
      });

      console.log(`Email sent to ${to}: ${subject}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      // Only the classified message is logged: never the token or the body.
      console.error('Error sending email:', error.message);
      return { success: false, error: error.message, retryable: Boolean(error.retryable) };
    }
  }

  /**
   * Strip HTML tags for plain text version
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // ============== REVIEW NOTIFICATIONS ==============

  /**
   * Notify employee that review cycle has started
   */
  async notifyReviewCycleStarted(employee, cycle) {
    const subject = `Performance Review Cycle Started: ${cycle.title}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Performance Review Cycle Started</h2>
        <p>Hi ${employee.name},</p>
        <p>A new performance review cycle has started: <strong>${cycle.title}</strong></p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Review Period:</strong> ${new Date(cycle.startDate).toLocaleDateString()} - ${new Date(cycle.endDate).toLocaleDateString()}</p>
          <p><strong>Self-Review Deadline:</strong> ${cycle.phases?.selfReviewEnd ? new Date(cycle.phases.selfReviewEnd).toLocaleDateString() : 'TBD'}</p>
        </div>
        <p>Please log in to complete your self-evaluation.</p>
        <a href="${process.env.FRONTEND_URL}/reviews" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Start Self-Review</a>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">This is an automated message from SmartHR Performance Management.</p>
      </div>
    `;

    return this.sendEmail(employee.email, subject, htmlContent);
  }

  /**
   * Notify manager that self-review is complete
   */
  async notifySelfReviewCompleted(manager, employee, review) {
    const subject = `Self-Review Completed: ${employee.name}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Self-Review Completed</h2>
        <p>Hi ${manager.name},</p>
        <p><strong>${employee.name}</strong> has completed their self-evaluation and is awaiting your review.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Employee:</strong> ${employee.name}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/team/reviews" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Review Now</a>
      </div>
    `;

    return this.sendEmail(manager.email, subject, htmlContent);
  }

  /**
   * Notify employee that manager review is complete
   */
  async notifyManagerReviewCompleted(employee, manager) {
    const subject = `Your Performance Review is Complete`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Performance Review Complete</h2>
        <p>Hi ${employee.name},</p>
        <p>Your manager, <strong>${manager.name}</strong>, has completed your performance review.</p>
        <p>Log in to view your complete review and feedback.</p>
        <a href="${process.env.FRONTEND_URL}/reviews" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">View Review</a>
      </div>
    `;

    return this.sendEmail(employee.email, subject, htmlContent);
  }

  /**
   * Reminder for pending self-review
   */
  async notifySelfReviewReminder(employee, cycle, daysLeft) {
    const subject = `Reminder: Self-Review Due in ${daysLeft} Days`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">⏰ Self-Review Reminder</h2>
        <p>Hi ${employee.name},</p>
        <p>This is a friendly reminder that your self-evaluation for <strong>${cycle.title}</strong> is due in <strong>${daysLeft} days</strong>.</p>
        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <p><strong>Deadline:</strong> ${cycle.phases?.selfReviewEnd ? new Date(cycle.phases.selfReviewEnd).toLocaleDateString() : 'Soon'}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/reviews" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Complete Self-Review</a>
      </div>
    `;

    return this.sendEmail(employee.email, subject, htmlContent);
  }

  /**
   * Reminder for manager to complete reviews
   */
  async notifyManagerReviewReminder(manager, pendingCount, daysLeft) {
    const subject = `Reminder: ${pendingCount} Reviews Pending Your Action`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">⏰ Manager Review Reminder</h2>
        <p>Hi ${manager.name},</p>
        <p>You have <strong>${pendingCount} performance review${pendingCount > 1 ? 's' : ''}</strong> awaiting your feedback.</p>
        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <p><strong>Reviews Pending:</strong> ${pendingCount}</p>
          <p><strong>Days Remaining:</strong> ${daysLeft}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/team/reviews" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Complete Reviews</a>
      </div>
    `;

    return this.sendEmail(manager.email, subject, htmlContent);
  }

  // ============== FEEDBACK NOTIFICATIONS ==============

  /**
   * Notify user of new feedback received
   */
  async notifyFeedbackReceived(recipient, sender, feedbackType, isAnonymous = false) {
    const subject = `New ${feedbackType} Feedback Received`;
    const senderName = isAnonymous ? 'A colleague' : sender.name;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10b981;">💬 New Feedback Received</h2>
        <p>Hi ${recipient.name},</p>
        <p><strong>${senderName}</strong> has sent you ${feedbackType.toLowerCase()} feedback.</p>
        <a href="${process.env.FRONTEND_URL}/feedback" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">View Feedback</a>
      </div>
    `;

    return this.sendEmail(recipient.email, subject, htmlContent);
  }

  // ============== OKR NOTIFICATIONS ==============

  /**
   * Notify about OKR deadline approaching
   */
  async notifyOKRDeadline(user, okr, daysLeft) {
    const subject = `OKR Deadline in ${daysLeft} Days: ${okr.title || 'Your OKR'}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">🎯 OKR Deadline Approaching</h2>
        <p>Hi ${user.name},</p>
        <p>Your OKR <strong>"${okr.title || okr.objectives?.[0]?.title}"</strong> deadline is in <strong>${daysLeft} days</strong>.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Current Progress:</strong> ${okr.progress || 0}%</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/okrs" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Update Progress</a>
      </div>
    `;

    return this.sendEmail(user.email, subject, htmlContent);
  }

  // ============== 1:1 MEETING NOTIFICATIONS ==============

  /**
   * Notify about upcoming 1:1 meeting
   */
  async notifyOneOnOneReminder(participant, meeting, isManager) {
    const otherPerson = isManager ? 'your direct report' : 'your manager';
    const subject = `Reminder: 1:1 Meeting Tomorrow`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">📅 1:1 Meeting Tomorrow</h2>
        <p>Hi ${participant.name},</p>
        <p>You have a 1:1 meeting scheduled with ${otherPerson} tomorrow.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Date:</strong> ${new Date(meeting.scheduledDate).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${new Date(meeting.scheduledDate).toLocaleTimeString()}</p>
          <p><strong>Location:</strong> ${meeting.location || 'Virtual'}</p>
        </div>
        <p>Don't forget to prepare your agenda items!</p>
        <a href="${process.env.FRONTEND_URL}/one-on-ones" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">View Meeting</a>
      </div>
    `;

    return this.sendEmail(participant.email, subject, htmlContent);
  }

  // ============== DEVELOPMENT PLAN NOTIFICATIONS ==============

  /**
   * Notify about development plan creation
   */
  async notifyDevelopmentPlanCreated(employee, manager, plan) {
    const subject = `New Development Plan Created: ${plan.title}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">📈 Development Plan Created</h2>
        <p>Hi ${employee.name},</p>
        <p>Your manager, <strong>${manager.name}</strong>, has created a development plan for you.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Plan:</strong> ${plan.title}</p>
          <p><strong>Target Date:</strong> ${new Date(plan.targetDate).toLocaleDateString()}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/development" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">View Plan</a>
      </div>
    `;

    return this.sendEmail(employee.email, subject, htmlContent);
  }

  // ============== BATCH NOTIFICATIONS ==============

  /**
   * Send batch notification to multiple recipients
   */
  async sendBatchNotification(recipients, subject, htmlContent) {
    const results = [];
    for (const recipient of recipients) {
      const personalizedHtml = htmlContent.replace(/{{name}}/g, recipient.name);
      const result = await this.sendEmail(recipient.email, subject, personalizedHtml);
      results.push({ email: recipient.email, ...result });

      // Rate limiting - wait 100ms between emails
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
  }
  // ============== GOAL SETTING NOTIFICATIONS ==============

  /**
   * Notify manager that goals are submitted for approval
   */
  async notifyGoalsSubmitted(manager, employee) {
    const subject = `Action Desired: Approve Goals for ${employee.name}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Goals Submitted for Approval</h2>
        <p>Hi ${manager.name},</p>
        <p><strong>${employee.name}</strong> has submitted their performance goals for the upcoming cycle.</p>
        <p>Please review and approve them to allow the appraisal process to proceed.</p>
        <a href="${process.env.FRONTEND_URL}/appraisals" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Review Goals</a>
      </div>
    `;
    return this.sendEmail(manager.email, subject, htmlContent);
  }

  /**
   * Notify employee that goals were approved
   */
  async notifyGoalsApproved(employee, manager) {
    const subject = `Goals Approved: You can start Self-Assessment`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10b981;">Goals Approved</h2>
        <p>Hi ${employee.name},</p>
        <p>Your manager, <strong>${manager.name}</strong>, has approved your goals.</p>
        <p>You can now proceed to the Self-Assessment phase when the cycle timeline allows.</p>
        <a href="${process.env.FRONTEND_URL}/appraisals" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">View Appraisal</a>
      </div>
    `;
    return this.sendEmail(employee.email, subject, htmlContent);
  }

  /**
   * Notify employee that goals were rejected/returned
   */
  async notifyGoalsRejected(employee, manager, comments) {
    const subject = `Action Required: Please Revise Your Goals`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">Goal Revision Requested</h2>
        <p>Hi ${employee.name},</p>
        <p>Your manager has requested changes to your goals.</p>
        <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
          <p><strong>Manager Comments:</strong></p>
          <p>${comments || 'Please align your goals with team objectives.'}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/appraisals" style="display: inline-block; background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Revise Goals</a>
      </div>
    `;
    return this.sendEmail(employee.email, subject, htmlContent);
  }

  // ============== SELF-ASSESSMENT NOTIFICATIONS ==============

  /**
   * Notify manager that employee submitted their self-assessment (appraisals module).
   * Note: We link to the appraisals manager view filtered by employee ID.
   */
  async notifySelfAssessmentSubmitted(manager, employee) {
    const subject = `Self-Assessment Submitted: ${employee.name}`;
    const baseUrl = process.env.FRONTEND_URL || '';
    const employeeId = encodeURIComponent(employee.userId || '');
    const appraisalUrl = `${baseUrl}/appraisals${employeeId ? `?employeeId=${employeeId}` : ''}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Self-Assessment Submitted</h2>
        <p>Hi ${manager.name},</p>
        <p><strong>${employee.name}</strong> has submitted their self-assessment and is ready for your review.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Employee:</strong> ${employee.name}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        <a href="${appraisalUrl}" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Open Appraisal</a>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">This is an automated message from SmartHR Performance Management.</p>
      </div>
    `;

    return this.sendEmail(manager.email, subject, htmlContent);
  }
}

module.exports = new NotificationService();






