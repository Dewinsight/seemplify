const crypto = require('crypto');
const { format } = require('date-fns');
const { isMailConfigured, sendMail } = require('./mailClient');

let emailEnabled = false;

function getSender() {
  return {
    email: process.env.MAIL_FROM_EMAIL || process.env.SENDER_EMAIL || 'noreply@seemplifyai.com',
    name: process.env.MAIL_FROM_NAME || process.env.SENDER_NAME || 'Seemplify Leave Management',
  };
}

function initializeEmailService() {
  emailEnabled = isMailConfigured();
  if (emailEnabled) {
    console.log('Email service initialized (Seemplify mail service)');
  } else {
    console.warn('Email service disabled (MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL are missing)');
  }
  return emailEnabled;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} htmlContent
 * @param {{ idempotencyKey?: string, tag?: string }} [options]
 *   Pass idempotencyKey when the caller owns a business identifier (a leave
 *   request id, for example) so a replay cannot deliver twice.
 */
async function sendEmail(to, subject, htmlContent, options = {}) {
  if (!emailEnabled) {
    return { success: false, reason: 'Email service disabled' };
  }

  if (!to) {
    return { success: false, reason: 'Recipient email missing' };
  }

  try {
    const sender = getSender();
    const result = await sendMail({
      from: sender.email,
      fromName: sender.name,
      to: [to],
      subject,
      html: htmlContent,
      tag: options.tag || 'leave_notification',
      idempotencyKey: String(options.idempotencyKey || '').trim() || crypto.randomUUID(),
    });
    return { success: true, messageId: result.messageId || null };
  } catch (error) {
    // Only the classified message is logged: never the token or the body.
    console.error(`Leave email send failed: ${subject}`, error.message);
    return { success: false, error: error.message, retryable: Boolean(error.retryable) };
  }
}

/**
 * One leave request produces at most one message per lifecycle event per
 * recipient, so keying on those three values makes an accidental replay a
 * no-op at the mail service instead of a duplicate inbox entry.
 */
function notificationKey(event, request, recipientEmail) {
  const requestId = String(request?._id || request?.id || '').trim();
  if (!requestId) return '';
  return `${event}:${requestId}:${crypto.createHash('sha256').update(String(recipientEmail || '').toLowerCase()).digest('hex').slice(0, 16)}`;
}

function leaveRange(request) {
  return `${format(new Date(request.startDate), 'MMM dd, yyyy')} - ${format(new Date(request.endDate), 'MMM dd, yyyy')}`;
}

async function sendLeaveRequestSubmittedToApprover(request) {
  const approver = request.assignedApprover;
  return sendLeaveRequestSubmittedToRecipient(request, approver);
}

async function sendLeaveRequestSubmittedToRecipient(request, recipient) {
  if (!recipient?.userEmail) {
    return { success: false, reason: 'Approver email unavailable' };
  }

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>New Leave Request Awaiting Approval</h2>
        <p>Hello ${recipient.userName || 'Approver'},</p>
        <p><strong>${request.userName || 'An employee'}</strong> submitted a leave request for <strong>${request.leaveType}</strong>.</p>
        <p>Leave period: <strong>${leaveRange(request)}</strong></p>
        <p>Total days: <strong>${request.numberOfDays}</strong></p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5003'}/approvals">Review request</a></p>
      </body>
    </html>
  `;

  return sendEmail(
    recipient.userEmail,
    `Leave request submitted by ${request.userName || 'employee'}`,
    html,
    { tag: 'leave_request_submitted', idempotencyKey: notificationKey('leave_request_submitted', request, recipient.userEmail) }
  );
}

async function sendLeaveRequestCreatedConfirmation(request) {
  if (!request.userEmail) {
    return { success: false, reason: 'Requester email unavailable' };
  }

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Leave Request Received</h2>
        <p>Hello ${request.userName || 'there'},</p>
        <p>Your leave request for <strong>${request.leaveType}</strong> was submitted.</p>
        <p>Leave period: <strong>${leaveRange(request)}</strong></p>
        <p>Status: <strong>${request.status}</strong></p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5003'}/leave-requests">View request</a></p>
      </body>
    </html>
  `;

  return sendEmail(
    request.userEmail,
    `Leave request submitted (${request.leaveType})`,
    html,
    { tag: 'leave_request_created', idempotencyKey: notificationKey('leave_request_created', request, request.userEmail) }
  );
}

async function sendLeaveRequestApproved(request) {
  if (!request.userEmail) {
    return { success: false, reason: 'Requester email unavailable' };
  }

  const approverName = request.approvedBy?.userName || 'Approver';
  const comment = request.approvedBy?.comment || 'No comment provided';

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Leave Request Approved</h2>
        <p>Hello ${request.userName || 'there'},</p>
        <p>Your leave request for <strong>${request.leaveType}</strong> has been approved by <strong>${approverName}</strong>.</p>
        <p>Leave period: <strong>${leaveRange(request)}</strong></p>
        <p>Comment: ${comment}</p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5003'}/leave-requests/${request._id}">View request details</a></p>
      </body>
    </html>
  `;

  return sendEmail(
    request.userEmail,
    `Leave request approved (${request.leaveType})`,
    html,
    { tag: 'leave_request_approved', idempotencyKey: notificationKey('leave_request_approved', request, request.userEmail) }
  );
}

async function sendLeaveRequestRejected(request) {
  if (!request.userEmail) {
    return { success: false, reason: 'Requester email unavailable' };
  }

  const rejectorName = request.rejectedBy?.userName || 'Approver';
  const reason = request.rejectedBy?.rejectionReason || 'No reason provided';

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Leave Request Rejected</h2>
        <p>Hello ${request.userName || 'there'},</p>
        <p>Your leave request for <strong>${request.leaveType}</strong> was rejected by <strong>${rejectorName}</strong>.</p>
        <p>Leave period: <strong>${leaveRange(request)}</strong></p>
        <p>Reason: ${reason}</p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5003'}/leave-requests/${request._id}">View request details</a></p>
      </body>
    </html>
  `;

  return sendEmail(
    request.userEmail,
    `Leave request rejected (${request.leaveType})`,
    html,
    { tag: 'leave_request_rejected', idempotencyKey: notificationKey('leave_request_rejected', request, request.userEmail) }
  );
}

async function sendLeaveRequestCancelled(request) {
  const approverEmail = request.assignedApprover?.userEmail;
  if (!approverEmail) {
    return { success: false, reason: 'Approver email unavailable' };
  }

  const reason = request.cancelledBy?.cancellationReason || 'No reason provided';

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Leave Request Cancelled</h2>
        <p>Hello ${request.assignedApprover?.userName || 'Approver'},</p>
        <p><strong>${request.userName || 'An employee'}</strong> cancelled a leave request for <strong>${request.leaveType}</strong>.</p>
        <p>Leave period: <strong>${leaveRange(request)}</strong></p>
        <p>Cancellation reason: ${reason}</p>
      </body>
    </html>
  `;

  return sendEmail(
    approverEmail,
    `Leave request cancelled by ${request.userName || 'employee'}`,
    html,
    { tag: 'leave_request_cancelled', idempotencyKey: notificationKey('leave_request_cancelled', request, approverEmail) }
  );
}

module.exports = {
  initializeEmailService,
  sendLeaveRequestSubmittedToApprover,
  sendLeaveRequestSubmittedToRecipient,
  sendLeaveRequestCreatedConfirmation,
  sendLeaveRequestApproved,
  sendLeaveRequestRejected,
  sendLeaveRequestCancelled,
};
