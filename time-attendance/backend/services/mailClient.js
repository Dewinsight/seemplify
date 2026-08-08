const crypto = require('crypto');
const fs = require('fs');

class MailError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MailError';
    this.code = options.code || 'mail_error';
  }
}

function readEnvironment(environment = process.env) {
  const configuredBaseUrl = String(environment.MAIL_API_BASE_URL || '').trim();
  const baseUrl = (configuredBaseUrl || (environment.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:5020')).replace(/\/+$/, '');
  const tokenFile = String(environment.MAIL_API_TOKEN_FILE || '').trim();
  let fileToken = '';
  if (tokenFile) try { fileToken = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { fileToken = ''; }
  const token = String(environment.MAIL_API_TOKEN || fileToken).trim();
  const senderEmail = String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || '').trim();
  const senderName = String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || 'Time & Attendance').trim();
  return { baseUrl, token, senderEmail, senderName };
}

function isConfigured(environment = process.env) {
  const config = readEnvironment(environment);
  return Boolean(config.baseUrl && config.token && config.senderEmail);
}

async function sendMail({ to, subject, html, text, attachments = [], idempotencyKey, tag }, environment = process.env) {
  const config = readEnvironment(environment);
  if (!config.baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' });
  if (!config.token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' });
  if (!config.senderEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' });
  const requestId = String(idempotencyKey || crypto.randomUUID());

  const normalizedAttachments = attachments
    .filter((attachment) => attachment && attachment.filename && attachment.content)
    .map((attachment) => ({
      name: attachment.filename,
      contentType: attachment.contentType || 'application/octet-stream',
      data: Buffer.isBuffer(attachment.content) ? attachment.content.toString('base64') : Buffer.from(attachment.content).toString('base64')
    }));

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      'Idempotency-Key': requestId
    },
    body: JSON.stringify({
      from: config.senderEmail,
      fromName: config.senderName,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || undefined,
      tag: tag || 'time_attendance_notification',
      attachments: normalizedAttachments.length ? normalizedAttachments : undefined
    }),
    signal: AbortSignal.timeout(Math.max(2000, Math.min(60000, Number(environment.MAIL_TIMEOUT_MS) || 15000)))
  });

  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }
  if (response.status === 409) {
    return { status: 'accepted', messageId: body.messageId || `idempotent:${requestId}`, idempotentReplay: true };
  }
  if (!response.ok) {
    throw new MailError(`Mail service request failed (${response.status}).`, { code: 'mail_request_failed' });
  }
  return {
    messageId: body.messageId || body.id || null,
    status: 'accepted',
    mode: 'seemplify-mail',
    idempotentReplay: false,
    raw: body
  };
}

module.exports = { MailError, readEnvironment, isConfigured, sendMail };
