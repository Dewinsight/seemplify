const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

/**
 * Payroll Email Service using Brevo API
 * Uses same BREVO_API_KEY as IdP
 */
class PayrollEmailService {
    constructor() {
        this.apiKey = process.env.BREVO_API_KEY;
        this.apiBaseUrl = 'https://api.brevo.com/v3/smtp/email';
        this.senderEmail = process.env.SENDER_EMAIL || 'michael.egbo@aiinnigeria.com';
        this.senderName = process.env.SENDER_NAME || 'Seemplify Payroll';
        this.payrollUrl = process.env.PAYROLL_URL || 'http://localhost:3000';

        // Log configuration status on startup
        console.log('📧 Payroll Email Service Configuration:');
        console.log('  - API Key:', this.apiKey ? '✅ Set' : '❌ MISSING');
        console.log('  - Sender Email:', this.senderEmail);
        console.log('  - Sender Name:', this.senderName);

        if (!this.apiKey) {
            console.error('❌ BREVO_API_KEY environment variable is not set! Emails will fail to send.');
        }
    }

    /**
     * Generic email sending method
     */
    async sendEmail({ to, subject, html, text }) {
        if (!this.apiKey) {
            console.warn('⚠️ BREVO_API_KEY not configured! Skipping email.');
            return { skipped: true, reason: 'Email service not configured' };
        }

        try {
            const emailData = {
                sender: {
                    name: this.senderName,
                    email: this.senderEmail,
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html
            };

            if (text) {
                emailData.textContent = text;
            }

            console.log('📨 Sending email to:', to, 'Subject:', subject);

            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(emailData)
            });

            const responseBody = await response.json();

            if (!response.ok) {
                console.error('❌ Brevo API Error:', responseBody);
                throw new Error(`Failed to send email: ${responseBody.message || response.statusText}`);
            }

            console.log('✅ Email sent successfully via Brevo');
            return responseBody;
        } catch (error) {
            console.error('❌ Error sending email:', error);
            throw error;
        }
    }

    /**
     * Send payslip notification to employee
     */
    async sendPayslipNotification(to, employeeName, period, netPay, currency = 'USD') {
        const displayName = employeeName || to.split('@')[0];
        const periodLabel = `${new Date(0, period.month - 1).toLocaleString('default', { month: 'long' })} ${period.year}`;

        const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              💰
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Payslip Available</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hi ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Your payslip for <strong>${periodLabel}</strong> is now available.
            </p>
            
            <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600;">Net Pay</p>
              <p style="margin: 0; font-size: 36px; font-weight: bold; color: #16a34a;">${currency} ${netPay.toLocaleString()}</p>
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${this.payrollUrl}/payslips" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Payslip
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} Seemplify Payroll. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

        return this.sendEmail({
            to,
            subject: `Your Payslip for ${periodLabel} is Ready 💰`,
            html: htmlContent,
            text: `Hi ${displayName}, your payslip for ${periodLabel} is now available. Net Pay: ${currency} ${netPay.toLocaleString()}. View at: ${this.payrollUrl}/payslips`
        });
    }

    /**
     * Send approval notification (request approved/rejected)
     */
    async sendApprovalNotification(to, employeeName, requestType, amount, currency, status, notes = '') {
        const displayName = employeeName || to.split('@')[0];
        const isApproved = status === 'approved' || status === 'processed';
        const statusColor = isApproved ? '#22c55e' : '#ef4444';
        const statusLabel = isApproved ? 'Approved ✅' : 'Rejected ❌';
        const statusBg = isApproved ? '#f0fdf4' : '#fef2f2';

        const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ${isApproved ? '✅' : '❌'}
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Request ${isApproved ? 'Approved' : 'Rejected'}</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hi ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Your <strong>${requestType.replace(/_/g, ' ')}</strong> request has been ${isApproved ? 'approved' : 'rejected'}.
            </p>
            
            <div style="background: ${statusBg}; border: 2px solid ${statusColor}; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: #666;">Status:</span>
                <span style="font-weight: bold; color: ${statusColor};">${statusLabel}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: #666;">Type:</span>
                <span style="font-weight: 600;">${requestType.replace(/_/g, ' ')}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">Amount:</span>
                <span style="font-weight: bold; font-size: 18px; color: #333;">${currency} ${amount.toLocaleString()}</span>
              </div>
              ${notes ? `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;"><span style="color: #666;">Notes:</span><p style="margin: 8px 0 0; color: #333;">${notes}</p></div>` : ''}
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${this.payrollUrl}/requests" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Requests
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} Seemplify Payroll. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

        return this.sendEmail({
            to,
            subject: `Your ${requestType.replace(/_/g, ' ')} Request - ${statusLabel}`,
            html: htmlContent,
            text: `Hi ${displayName}, your ${requestType.replace(/_/g, ' ')} request for ${currency} ${amount.toLocaleString()} has been ${status}. ${notes ? 'Notes: ' + notes : ''}`
        });
    }

    /**
     * Send payroll run complete notification to HR
     */
    async sendPayrollCompleteNotification(to, adminName, period, totalEmployees, totalPayroll, currency = 'USD') {
        const displayName = adminName || 'HR Admin';
        const periodLabel = `${new Date(0, period.month - 1).toLocaleString('default', { month: 'long' })} ${period.year}`;

        const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ✅
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Payroll Run Complete</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hi ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              The payroll run for <strong>${periodLabel}</strong> has been completed successfully.
            </p>
            
            <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: #666;">Employees Processed:</span>
                <span style="font-weight: bold; color: #333;">${totalEmployees}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">Total Payroll:</span>
                <span style="font-weight: bold; font-size: 20px; color: #16a34a;">${currency} ${totalPayroll.toLocaleString()}</span>
              </div>
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${this.payrollUrl}/admin/runs" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Payroll History
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} Seemplify Payroll. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

        return this.sendEmail({
            to,
            subject: `Payroll Run Complete - ${periodLabel} ✅`,
            html: htmlContent,
            text: `Hi ${displayName}, the payroll run for ${periodLabel} has been completed. ${totalEmployees} employees processed. Total: ${currency} ${totalPayroll.toLocaleString()}`
        });
    }

    /**
     * Send pending approval notification to HR
     */
    async sendPendingApprovalNotification(to, adminName, requestCount) {
        const displayName = adminName || 'HR Admin';

        const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ⏳
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Pending Approvals</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hi ${displayName},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              You have <strong>${requestCount}</strong> pending compensation request(s) awaiting your review.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${this.payrollUrl}/admin/approvals" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Review Approvals
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} Seemplify Payroll. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

        return this.sendEmail({
            to,
            subject: `${requestCount} Pending Approval(s) Awaiting Review ⏳`,
            html: htmlContent,
            text: `Hi ${displayName}, you have ${requestCount} pending compensation request(s) awaiting your review. View at: ${this.payrollUrl}/admin/approvals`
        });
    }
}

// Singleton instance
const emailService = new PayrollEmailService();

module.exports = { emailService, PayrollEmailService };
