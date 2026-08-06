const dotenv = require('dotenv');
const { isConfigured, readEnvironment, sendMail } = require('./mailClient');

dotenv.config();

class PayrollEmailService {
    constructor() {
        const config = readEnvironment(process.env);
        this.apiKey = config.token;
        this.apiBaseUrl = config.baseUrl;
        this.senderEmail = config.fromEmail;
        this.senderName = config.fromName;
        this.payrollUrl = process.env.PAYROLL_URL || 'http://localhost:3000';

        console.log('Payroll Email Service Configuration:');
        console.log('  - Mail API:', this.apiBaseUrl ? 'Set' : 'Missing');
        console.log('  - Token:', this.apiKey ? 'Set' : 'Missing');
        console.log('  - Sender Email:', this.senderEmail);
        console.log('  - Sender Name:', this.senderName);
    }

    async sendEmail({ to, subject, html, text }) {
        if (!isConfigured(process.env)) {
            console.warn('MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL not configured. Skipping email.');
            return { skipped: true, reason: 'Email service not configured' };
        }

        console.log('Sending payroll email to:', to, 'Subject:', subject);
        return sendMail({ to, subject, html, text }, process.env);
    }

    async sendPayslipNotification(to, employeeName, period, netPay, currency = 'USD') {
        const displayName = employeeName || to.split('@')[0];
        const periodLabel = `${new Date(0, period.month - 1).toLocaleString('default', { month: 'long' })} ${period.year}`;
        const htmlContent = `
      <html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Payslip Available</h2>
        <p>Hi ${displayName},</p>
        <p>Your payslip for <strong>${periodLabel}</strong> is now available.</p>
        <p><strong>Net Pay:</strong> ${currency} ${Number(netPay || 0).toLocaleString()}</p>
        <p><a href="${this.payrollUrl}/payslips">View Payslip</a></p>
      </body></html>`;
        const text = `Hi ${displayName}, your payslip for ${periodLabel} is now available. Net Pay: ${currency} ${Number(netPay || 0).toLocaleString()}. View at ${this.payrollUrl}/payslips`;
        return this.sendEmail({ to, subject: `Your Payslip for ${periodLabel} is Ready`, html: htmlContent, text });
    }

    async sendApprovalNotification(to, employeeName, requestType, amount, currency, status, notes = '') {
        const displayName = employeeName || to.split('@')[0];
        const isApproved = status === 'approved' || status === 'processed';
        const htmlContent = `
      <html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Request ${isApproved ? 'Approved' : 'Rejected'}</h2>
        <p>Hi ${displayName},</p>
        <p>Your <strong>${String(requestType).replace(/_/g, ' ')}</strong> request has been ${status}.</p>
        <p><strong>Amount:</strong> ${currency} ${Number(amount || 0).toLocaleString()}</p>
        ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
        <p><a href="${this.payrollUrl}/requests">View Requests</a></p>
      </body></html>`;
        const text = `Hi ${displayName}, your ${String(requestType).replace(/_/g, ' ')} request for ${currency} ${Number(amount || 0).toLocaleString()} has been ${status}. ${notes ? `Notes: ${notes}` : ''}`;
        return this.sendEmail({ to, subject: `Your ${String(requestType).replace(/_/g, ' ')} Request`, html: htmlContent, text });
    }

    async sendPayrollCompleteNotification(to, adminName, period, totalEmployees, totalPayroll, currency = 'USD') {
        const displayName = adminName || 'HR Admin';
        const periodLabel = `${new Date(0, period.month - 1).toLocaleString('default', { month: 'long' })} ${period.year}`;
        const totalPayrollLabel = currency === 'MIXED' ? 'Mixed currencies' : `${currency} ${Number(totalPayroll || 0).toLocaleString()}`;
        const htmlContent = `
      <html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Payroll Run Complete</h2>
        <p>Hi ${displayName},</p>
        <p>The payroll run for <strong>${periodLabel}</strong> has completed successfully.</p>
        <p><strong>Employees Processed:</strong> ${totalEmployees}</p>
        <p><strong>Total Payroll:</strong> ${totalPayrollLabel}</p>
        <p><a href="${this.payrollUrl}/admin/runs">View Payroll History</a></p>
      </body></html>`;
        const text = `Hi ${displayName}, the payroll run for ${periodLabel} has completed. ${totalEmployees} employees processed. Total: ${totalPayrollLabel}`;
        return this.sendEmail({ to, subject: `Payroll Run Complete - ${periodLabel}`, html: htmlContent, text });
    }

    async sendPendingApprovalNotification(to, adminName, requestCount) {
        const displayName = adminName || 'HR Admin';
        const htmlContent = `
      <html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Pending Approvals</h2>
        <p>Hi ${displayName},</p>
        <p>You have <strong>${requestCount}</strong> pending compensation request(s) awaiting review.</p>
        <p><a href="${this.payrollUrl}/admin/approvals">Review Approvals</a></p>
      </body></html>`;
        const text = `Hi ${displayName}, you have ${requestCount} pending compensation request(s) awaiting review. View at ${this.payrollUrl}/admin/approvals`;
        return this.sendEmail({ to, subject: `${requestCount} Pending Approval(s) Awaiting Review`, html: htmlContent, text });
    }
}

const emailService = new PayrollEmailService();

module.exports = { emailService, PayrollEmailService };
