export class MailError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'MailError'
    this.code = options.code || 'mail_error'
    this.status = options.status || null
    this.permanent = options.permanent === true
    this.retryable = options.retryable === true
    if (options.cause) this.cause = options.cause
  }
}

export function readEnvironment(environment = process.env) {
  const baseUrl = String(environment.MAIL_API_BASE_URL || '').trim().replace(/\/+$/, '')
  const token = String(environment.MAIL_API_TOKEN || '').trim()
  const fromEmail = String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || 'no-reply@seemplifyai.com').trim()
  const fromName = String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || 'Seemplify Identity').trim()
  const parsedTimeout = Number.parseInt(environment.MAIL_TIMEOUT_MS || '5000', 10)
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000
  return { baseUrl, token, fromEmail, fromName, timeoutMs }
}

export function isConfigured(environment = process.env) {
  const config = readEnvironment(environment)
  return Boolean(config.baseUrl && config.token && config.fromEmail)
}

function isPlainMailbox(value) {
  return /^[^\s@<>,"']+@[^\s@<>,"']+\.[^\s@<>,"']+$/.test(String(value || '').trim())
}

export async function sendMail({ to, subject, html, text, tag, idempotencyKey }, environment = process.env) {
  const config = readEnvironment(environment)
  if (!config.baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' })
  if (!config.token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' })
  if (!config.fromEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' })
  if (!isPlainMailbox(to) || !String(subject || '').trim() || (!html && !text)) {
    throw new MailError('Mail messages require a plain recipient mailbox, subject, and content.', {
      code: 'invalid_message',
      permanent: true
    })
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.token}`
  }
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs)
  let response

  try {
    response = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        // The first-party mail API accepts bare mailbox strings. Display names
        // are carried separately so callers cannot smuggle extra recipients in
        // a formatted address.
        from: config.fromEmail,
        fromName: config.fromName || undefined,
        to: [String(to).trim()],
        subject: String(subject).trim(),
        html: html || undefined,
        text: text || undefined,
        tag: tag || undefined
      })
    })

    const bodyText = await response.text()
    let body
    try { body = bodyText ? JSON.parse(bodyText) : {} } catch { body = { raw: bodyText } }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      throw new MailError(body.message || `Mail service request failed (${response.status}).`, {
        code: body.code || 'mail_request_failed',
        status: response.status,
        retryable,
        permanent: !retryable
      })
    }
    return {
      messageId: body.messageId || body.id || null,
      mode: 'seemplify-mail',
      raw: body
    }
  } catch (error) {
    if (error instanceof MailError) throw error
    throw new MailError(
      error?.name === 'AbortError' ? 'Mail service request timed out.' : 'Mail service request failed.',
      { code: 'mail_unavailable', retryable: true, cause: error }
    )
  } finally {
    clearTimeout(timeoutId)
  }
}
