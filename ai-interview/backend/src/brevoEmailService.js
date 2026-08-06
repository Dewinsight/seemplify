function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const crypto = require('crypto');
const { formatMailAddress, isMailConfigured, sendMail } = require('./mailClient');

/**
 * Kept under its original name and export shape so callers do not change; the
 * transport underneath is now the self-hosted Seemplify mail service.
 */
function getMailConfig() {
  return {
    fromEmail: process.env.MAIL_FROM_EMAIL || process.env.AI_INTERVIEW_FROM_EMAIL || 'no-reply@seemplifyai.com',
    fromName: process.env.MAIL_FROM_NAME || process.env.AI_INTERVIEW_FROM_NAME || 'Seemplify AI Interview',
    baseUrl: process.env.MAIL_API_BASE_URL || '',
    mode: (process.env.AI_INTERVIEW_EMAIL_MODE || 'send').toLowerCase()
  };
}

function isConfigured() {
  return isMailConfigured();
}

function buildInviteEmail({ candidateName, organizationName, jobTitle, interviewTitle, questionCount, expiresAt, interviewUrl }) {
  const safeCandidate = escapeHtml(candidateName || 'there');
  const safeOrg = escapeHtml(organizationName || 'Organization');
  const safeJob = escapeHtml(jobTitle || 'the role');
  const safeTitle = escapeHtml(interviewTitle || 'AI Interview');
  const safeUrl = escapeHtml(interviewUrl);
  const expiry = new Date(expiresAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h2 style="color: #111827;">AI Interview Invitation</h2>
      <p>Hello ${safeCandidate},</p>
      <p>${safeOrg} has invited you to complete an AI interview for <strong>${safeJob}</strong>.</p>
      <div style="background: #f3f4f6; border-radius: 10px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Interview:</strong> ${safeTitle}</p>
        <p style="margin: 6px 0 0;"><strong>Questions:</strong> ${Number(questionCount || 0)}</p>
        <p style="margin: 6px 0 0;"><strong>Deadline:</strong> ${escapeHtml(expiry)}</p>
      </div>
      <p>Use the secure button below to review the guidelines and start when you are ready.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse: separate; margin: 28px auto; width: auto;">
        <tr>
          <td align="center" bgcolor="#020617" style="border-radius: 10px;">
            <a href="${safeUrl}" target="_blank" style="background: #020617; border-radius: 10px; color: #ffffff; display: inline-block; font-size: 15px; font-weight: 700; line-height: 20px; min-width: 190px; padding: 14px 28px; text-align: center; text-decoration: none;">
              Start AI Interview
            </a>
          </td>
        </tr>
      </table>
      <p style="font-size: 13px; color: #64748b; word-break: break-word;">If the button does not open, copy and paste this link into your browser:<br><a href="${safeUrl}" style="color: #2563eb;">${safeUrl}</a></p>
      <p style="font-size: 13px; color: #64748b;">This link is unique to you. Please do not forward it.</p>
    </div>
  `;

  const text = `Hello ${candidateName || 'there'}, ${organizationName || 'Organization'} has invited you to complete an AI interview for ${jobTitle || 'the role'}. Start here: ${interviewUrl}`;
  return { html, text };
}

async function sendEmail({ to, subject, html, text, idempotencyKey, tag }) {
  const config = getMailConfig();
  if (config.mode === 'log') {
    return { messageId: `log_${Date.now()}`, mode: 'log' };
  }
  return sendMail({
    from: formatMailAddress(config.fromEmail),
    fromName: config.fromName,
    to,
    subject,
    html,
    text,
    tag,
    idempotencyKey: String(idempotencyKey || '').trim() || crypto.randomUUID()
  });
}

async function sendInvite(input) {
  const { html, text } = buildInviteEmail(input);
  return sendEmail({
    to: input.candidateEmail,
    subject: `${input.organizationName || 'AI Interview'} - AI Interview Invitation - ${input.jobTitle || 'Role'}`,
    html,
    text,
    tag: 'ai_interview_invite',
    // The interview URL embeds the single-use invite token, so it identifies
    // this invitation event exactly. A reissued invite gets a new token.
    idempotencyKey: input.invitationId
      ? `ai_interview_invite:${input.invitationId}`
      : `ai_interview_invite:${crypto.createHash('sha256').update(String(input.interviewUrl || '')).digest('hex').slice(0, 32)}`
  });
}

module.exports = {
  isConfigured,
  getMailConfig,
  sendInvite
};
