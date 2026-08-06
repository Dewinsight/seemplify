class MailError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MailError';
    this.code = options.code || 'mail_error';
  }
}

function readEnvironment(environment = process.env) {
  const baseUrl = String(environment.MAIL_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = String(environment.MAIL_API_TOKEN || '').trim();
  const senderEmail = String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || 'no-reply@seemplifyai.com').trim();
  const senderName = String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || 'Time & Attendance').trim();
  return { baseUrl, token, senderEmail, senderName };
}

function isConfigured(environment = process.env) {
  const config = readEnvironment(environment);
  return Boolean(config.baseUrl && config.token && config.senderEmail);
}

async function sendMail({ to, subject, html, text, attachments = [] }, environment = process.env) {
  const config = readEnvironment(environment);
  if (!config.baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' });
  if (!config.token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' });
  if (!config.senderEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' });

  const normalizedAttachments = attachments
    .filter((attachment) => attachment && attachment.filename && attachment.content)
    .map((attachment) => ({
      name: attachment.filename,
      content: Buffer.isBuffer(attachment.content) ? attachment.content.toString('base64') : Buffer.from(attachment.content).toString('base64')
    }));

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`
    },
    body: JSON.stringify({
      from: { email: config.senderEmail, name: config.senderName },
      to: [{ email: to }],
      subject,
      html,
      text: text || undefined,
      attachments: normalizedAttachments.length ? normalizedAttachments : undefined
    })
  });

  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }
  if (!response.ok) {
    throw new MailError(`Mail service request failed (${response.status}).`, { code: 'mail_request_failed' });
  }
  return {
    messageId: body.messageId || body.id || null,
    mode: 'seemplify-mail',
    raw: body
  };
}

module.exports = { MailError, readEnvironment, isConfigured, sendMail };
