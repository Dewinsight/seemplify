const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { isConfigured, sendMail } = require('./mailClient');

let emailEnabled = false;

function initializeEmailService() {
    emailEnabled = isConfigured(process.env);
    if (!emailEnabled) {
        console.warn('Email service not configured (missing MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL)');
        return false;
    }
    console.log('Email service initialized (Seemplify mail service)');
    return true;
}

function loadTemplate(templateName) {
    const templatePath = path.join(__dirname, '..', 'templates', 'emails', `${templateName}.html`);
    try {
        return fs.readFileSync(templatePath, 'utf8');
    } catch (error) {
        console.error(`Failed to load email template: ${templateName}`, error);
        return '<html><body>{{content}}</body></html>';
    }
}

function fillTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
    }
    return result;
}

function normalizeAttachments(attachments = []) {
    return attachments
        .filter((attachment) => attachment && attachment.filename && attachment.content)
        .map((attachment) => ({
            filename: attachment.filename,
            content: Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content),
            contentType: attachment.contentType || 'application/octet-stream',
        }));
}

async function sendEmail(to, subject, html, options = {}) {
    if (!emailEnabled) {
        console.log(`Email skipped (service not configured): ${subject}`);
        return { success: false, reason: 'Email service not configured' };
    }

    try {
        const attachments = normalizeAttachments(options.attachments || []);
        const result = await sendMail({
            to,
            subject,
            html,
            text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            attachments
        }, process.env);
        console.log(`Email sent (seemplify-mail): ${subject} -> ${to}`);
        return result;
    } catch (error) {
        console.error(`Failed to send email (seemplify-mail): ${subject}`, error.message);
        return { success: false, error: error.message };
    }
}

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
    return sendEmail(managerEmail, `Timesheet Submitted - ${timesheet.userName}`, html);
}

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
    return sendEmail(employeeEmail, `Timesheet Approved - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`, html);
}

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
    return sendEmail(employeeEmail, `Timesheet Rejected - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`, html);
}

async function sendTimesheetReminder(timesheet, employeeEmail, hoursUntilDeadline) {
    const template = loadTemplate('timesheet-reminder');
    const html = fillTemplate(template, {
        employeeName: timesheet.userName,
        weekStart: format(new Date(timesheet.startDate), 'MMM dd, yyyy'),
        weekEnd: format(new Date(timesheet.endDate), 'MMM dd, yyyy'),
        hoursRemaining: Math.round(hoursUntilDeadline),
        timesheetUrl: `${process.env.FRONTEND_URL || 'http://localhost:5011'}/timesheets/${timesheet._id}`,
    });
    return sendEmail(employeeEmail, `Reminder: Submit Your Timesheet - Week of ${format(new Date(timesheet.startDate), 'MMM dd')}`, html);
}

async function sendAutoClockOutWarning({ userName, deadlineAt, warningMinutes, thresholdHours }, userEmail) {
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:5011'}/dashboard`;
    const html = `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Clock-out reminder</h2>
        <p>Hello ${userName || 'there'},</p>
        <p>You have been clocked in for almost ${thresholdHours} hours.</p>
        <p>Your session will be auto clocked out in about ${warningMinutes} minute(s) if you do not clock out manually.</p>
        <p>Expected auto clock-out time: <strong>${format(new Date(deadlineAt), 'MMM dd, yyyy HH:mm')}</strong></p>
        <p><a href="${dashboardUrl}">Open Time & Attendance</a></p>
    </body></html>`;
    return sendEmail(userEmail, 'Action required: clock out soon', html);
}

async function sendAutoClockedOutNotification({ userName, autoClockOutTime, thresholdHours }, userEmail) {
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:5011'}/entries`;
    const html = `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>You were auto clocked out</h2>
        <p>Hello ${userName || 'there'},</p>
        <p>The system automatically clocked you out after ${thresholdHours} hours.</p>
        <p>Auto clock-out time: <strong>${format(new Date(autoClockOutTime), 'MMM dd, yyyy HH:mm')}</strong></p>
        <p>If this looks incorrect, please contact your manager or HR admin.</p>
        <p><a href="${dashboardUrl}">Review your time entries</a></p>
    </body></html>`;
    return sendEmail(userEmail, 'Auto clock-out completed', html);
}

async function sendManagerTeamReport({
    managerName,
    managerEmail,
    frequencyLabel,
    periodLabel,
    summaryRowsHtml,
    memberRowsHtml,
    reportUrl,
    teamUrl,
    generatedAt,
    excelFileName,
    attachmentDescription,
}, attachment) {
    const template = loadTemplate('manager-team-report');
    const html = fillTemplate(template, {
        managerName: managerName || 'Manager',
        frequencyLabel: frequencyLabel || 'Weekly',
        periodLabel: periodLabel || '--',
        summaryRowsHtml: summaryRowsHtml || '',
        memberRowsHtml: memberRowsHtml || '',
        reportUrl: reportUrl || `${process.env.FRONTEND_URL || 'http://localhost:5011'}/reports`,
        teamUrl: teamUrl || `${process.env.FRONTEND_URL || 'http://localhost:5011'}/team`,
        generatedAt: generatedAt || format(new Date(), 'MMM dd, yyyy HH:mm'),
        excelFileName: excelFileName || 'team-attendance-report.xlsx',
        attachmentDescription:
            attachmentDescription ||
            `Your team attendance report is ready. The detailed Excel workbook (<strong>${excelFileName || 'team-attendance-report.xlsx'}</strong>) is attached to this email.`,
    });

    return sendEmail(
        managerEmail,
        `Team Attendance ${frequencyLabel || 'Weekly'} Report - ${periodLabel || ''}`.trim(),
        html,
        { attachments: attachment ? [attachment] : [] }
    );
}

module.exports = {
    initializeEmailService,
    sendTimesheetSubmitted,
    sendTimesheetApproved,
    sendTimesheetRejected,
    sendTimesheetReminder,
    sendAutoClockOutWarning,
    sendAutoClockedOutNotification,
    sendManagerTeamReport,
};
