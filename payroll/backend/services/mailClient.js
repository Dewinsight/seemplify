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
  const fromEmail = String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || 'no-reply@seemplifyai.com').trim();
  const fromName = String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || 'Seemplify Payroll').trim();
  return { baseUrl, token, fromEmail, fromName };
}

function isConfigured(environment = process.env) {
  const config = readEnvironment(environment);
  return Boolean(config.baseUrl && config.token && config.fromEmail);
}

async function sendMail({ to, subject, html, text }, environment = process.env) {
  const config = readEnvironment(environment);
  if (!config.baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' });
  if (!config.token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' });
  if (!config.fromEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' });

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`
    },
    body: JSON.stringify({
      from: { email: config.fromEmail, name: config.fromName },
      to: [{ email: to }],
      subject,
      html,
      text: text || undefined
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
