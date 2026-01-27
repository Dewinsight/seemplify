const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

/**
 * Email Service
 * 
 * Handles all email notifications for time-attendance system:
 * - Timesheet submissions to managers
 * - Approvals/rejections to employees
 * - Deadline reminders
 */

// Initialize email transporter
let transporter = null;

function initializeEmailService() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT || 465;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn('⚠️  Email service not configured (SMTP credentials missing)');
        console.warn('   Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable email notifications');
        return false;
    }

    transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: parseInt(smtpPort) === 465, // true for 465, false for other ports
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    console.log('✅ Email service initialized');
    return true;
}

// Load email template
function loadTemplate(templateName) {
    const templatePath = path.join(__dirname, '..', 'templates', 'emails', `${templateName}.html`);
    
    try {
        return fs.readFileSync(templatePath, 'utf8');
    } catch (error) {
        console.error(`Failed to load email template: ${templateName}`, error);
        // Return basic fallback template
        return '<html><body>{{content}}</body></html>';
    }
}

// Replace template variables
function fillTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
    }
    return result;
}

/**
 * Send email (internal function)
 */
async function sendEmail(to, subject, html) {
    if (!transporter) {
        console.log('📧 Email not sent (service not configured):', subject);
        return { success: false, reason: 'Email service not configured' };
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"Time & Attendance" <noreply@seemplifyai.com>',
            to,
            subject,
            html,
        });

        console.log('✅ Email sent:', subject, 'to', to);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Failed to send email:', subject, error);
        return { success: false, error: error.message };
    }
}

/**
 * Send timesheet submitted notification to manager
 */
async function sendTimesheetSubmitted(timesheet, managerEmail, managerName) {
    const template = loadTemplate('timesheet-submitted');
    
    const html = fillTemplate(template, {
        managerName: managerName || 'Manager',
        employeeName: timesheet.userName,
        weekStart: format(new Date(timesheet.startDate), 'MMM dd, yyyy'),
        weekEnd: format(new Date(timesheet.endDate), 'MMM dd, yyyy'),
        totalHours: timesheet.summary?.totalHours?.toFixed(1) || '0',
        regularHours: timesheet.summary?.regularHours?.toFixed(1) || '0',
        overtimeHours: timesheet.summary?.overtimeHours?.toFixed(1) || '0',
        daysWorked: timesheet.summary?.daysWorked || '0',
        timesheetUrl: `${process.env.FRONTEND_URL || 'http://localhost:5011'}/approvals`,
    });

    return sendEmail(
        managerEmail,
        `Timesheet Submitted - ${timesheet.userName}`,
        html
    );
}

/**
 * Send timesheet approved notification to employee
 */
async function sendTimesheetApproved(timesheet, employeeEmail) {
    const template = loadTemplate('timesheet-approved');
    
    const html = fillTemplate(template, {
        employeeName: timesheet.userName,
        approverName: timesheet.approvedBy?.userName || 'Manager',
        weekStart: format(new Date(timesheet.startDate), 'MMM dd, yyyy'),
        weekEnd: format(new Date(timesheet.endDate), 'MMM dd, yyyy'),
        totalHours: timesheet.summary?.totalHours?.toFixed(1) || '0',
        comment: timesheet.approvedBy?.comment || 'No additional comments',
        timesheetUrl: `${process.env.FRONTEND_URL || 'http://localhost:5011'}/timesheets/${timesheet._id}`,
    });

    return sendEmail(
        employeeEmail,
        `Timesheet Approved - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`,
        html
    );
}

/**
 * Send timesheet rejected notification to employee
 */
async function sendTimesheetRejected(timesheet, employeeEmail) {
    const template = loadTemplate('timesheet-rejected');
    
    const html = fillTemplate(template, {
        employeeName: timesheet.userName,
        approverName: timesheet.rejectedBy?.userName || 'Manager',
        weekStart: format(new Date(timesheet.startDate), 'MMM dd, yyyy'),
        weekEnd: format(new Date(timesheet.endDate), 'MMM dd, yyyy'),
        reason: timesheet.rejectedBy?.reason || 'No reason provided',
        timesheetUrl: `${process.env.FRONTEND_URL || 'http://localhost:5011'}/timesheets/${timesheet._id}`,
    });

    return sendEmail(
        employeeEmail,
        `Timesheet Rejected - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`,
        html
    );
}

/**
 * Send timesheet submission reminder to employee
 */
async function sendTimesheetReminder(timesheet, employeeEmail, hoursUntilDeadline) {
    const template = loadTemplate('timesheet-reminder');
    
    const html = fillTemplate(template, {
        employeeName: timesheet.userName,
        weekStart: format(new Date(timesheet.startDate), 'MMM dd, yyyy'),
        weekEnd: format(new Date(timesheet.endDate), 'MMM dd, yyyy'),
        hoursRemaining: Math.round(hoursUntilDeadline),
        timesheetUrl: `${process.env.FRONTEND_URL || 'http://localhost:5011'}/timesheets/${timesheet._id}`,
    });

    return sendEmail(
        employeeEmail,
        `Reminder: Submit Your Timesheet - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`,
        html
    );
}

module.exports = {
    initializeEmailService,
    sendTimesheetSubmitted,
    sendTimesheetApproved,
    sendTimesheetRejected,
    sendTimesheetReminder,
};
