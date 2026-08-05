import { config } from './config.js';

/**
 * First-party transactional mail client.
 *
 * The self-hosted Seemplify mail service exposes a single send endpoint:
 *
 *   POST {baseUrl}/v1/messages
 *   Authorization: Bearer <keyId>.<secret>
 *   Idempotency-Key: <stable business identifier>
 *
 * A successful send answers HTTP 202 with `{ status: 'accepted', messageId }`.
 * The client never logs the bearer token or the message body: only the status
 * code, the classification and the service-supplied error code are surfaced.
 */

export const MAIL_SEND_PATH = '/v1/messages';

export interface MailAttachment {
  name: string;
  contentType: string;
  /** Base64-encoded payload. */
  data: string;
}

export interface MailMessage {
  /**
   * RFC 5322 address, with or without a display part. Defaults to the
   * configured verified sender. Build it with formatMailAddress().
   */
  from?: string;
  /** Optional display name, transported separately from the mailbox. */
  fromName?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  /** Coarse business-event label used for service-side reporting. */
  tag?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
  /** Stable per-business-event key so a replay cannot duplicate a send. */
  idempotencyKey: string;
  timeoutMs?: number;
}

export interface MailResult {
  status: 'accepted';
  messageId: string;
  mode: 'send' | 'log';
  /** True when the service recognised the idempotency key from an earlier send. */
  idempotentReplay: boolean;
}

/**
 * Every failure raised by this module carries an explicit classification so
 * callers never have to pattern-match on message text to decide whether a
 * delivery may be retried.
 */
export class MailError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;
  readonly permanent: boolean;

  constructor(message: string, options: { status?: number | null; code?: string; retryable?: boolean }) {
    super(message);
    this.name = 'MailError';
    this.status = options.status ?? null;
    this.code = options.code || 'mail_error';
    this.retryable = Boolean(options.retryable);
    this.permanent = !this.retryable;
  }
}

export function isRetryableMailError(error: unknown) {
  return error instanceof MailError && error.retryable;
}

const controlCharacters = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const unsafeMailboxCharacters = /[\s<>,;"\\]/u;

/**
 * Everything handed to the service ends up in a header, so a single injected
 * newline would let a caller forge one. Reject control characters at the edge
 * rather than trusting each call site to have sanitised its own input.
 */
function assertHeaderSafe(value: string, label: string) {
  if (controlCharacters.test(value)) throw new MailError(`${label} cannot contain control characters.`, { code: 'invalid_message' });
  return value;
}

/**
 * Validates and returns a bare mailbox. The mail service composes the header
 * itself from `from`/`fromName`, so an address must never carry a display part
 * or any separator that could smuggle a second recipient.
 */
export function formatMailAddress(email: string) {
  const mailbox = String(email ?? '').trim();
  if (!mailbox) throw new MailError('An email address is required.', { code: 'invalid_message' });
  if (unsafeMailboxCharacters.test(mailbox) || controlCharacters.test(mailbox)) {
    throw new MailError('Email address contains characters that are not allowed in a mailbox.', { code: 'invalid_message' });
  }
  return mailbox;
}

/** Every recipient list entry is validated as a bare mailbox. */
function addressList(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .map((item) => formatMailAddress(assertHeaderSafe(item, 'Email address')));
}

export interface MailTransportConfiguration {
  baseUrl: string;
  token: string;
  fromEmail: string;
  fromName: string;
  timeoutMs: number;
}

/**
 * Resolves the transport configuration at call time so an operator can rotate
 * the credential without a rebuild. Missing values fail closed.
 */
export function resolveMailTransport(): MailTransportConfiguration {
  const baseUrl = String(config.mailApiBaseUrl || '').trim().replace(/\/+$/, '');
  const token = String(config.mailApiToken || '').trim();
  const fromEmail = String(config.mailFromEmail || '').trim();
  if (!baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' });
  if (!token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' });
  if (!fromEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' });
  return { baseUrl, token, fromEmail, fromName: String(config.mailFromName || ''), timeoutMs: config.mailTimeoutMs };
}

export function mailTransportStatus() {
  try {
    const transport = resolveMailTransport();
    return { configured: true, baseUrl: transport.baseUrl, sender: transport.fromEmail, senderName: transport.fromName, reason: null as string | null };
  } catch (error) {
    return {
      configured: false,
      baseUrl: String(config.mailApiBaseUrl || ''),
      sender: String(config.mailFromEmail || ''),
      senderName: String(config.mailFromName || ''),
      reason: error instanceof MailError ? error.message : 'Mail transport is not configured.'
    };
  }
}

/**
 * 401/403 mean the deployment credential is wrong and every retry would fail
 * the same way. 429 and 5xx (including `sending_disabled` while the production
 * gate is closed) are transient and safe to attempt again with the same key.
 */
function classifyFailure(status: number, code: string, message: string) {
  if (status === 401 || status === 403) {
    return new MailError(`Mail service rejected the credential (HTTP ${status}).`, { status, code: code || 'unauthorized', retryable: false });
  }
  if (status === 429 || status >= 500) {
    return new MailError(message || `Mail service is unavailable (HTTP ${status}).`, {
      status,
      code: code || (status === 429 ? 'rate_limited' : 'service_unavailable'),
      retryable: true
    });
  }
  return new MailError(message || `Mail service rejected the message (HTTP ${status}).`, { status, code: code || 'rejected', retryable: false });
}

/**
 * Posts one message. Retries are deliberately left to the caller: campaign,
 * e-sign and account deliveries each own a durable attempt ledger, and a hidden
 * retry inside the client would corrupt their accounting.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const idempotencyKey = assertHeaderSafe(String(message.idempotencyKey ?? '').trim(), 'Idempotency key');
  if (!idempotencyKey) throw new MailError('An idempotency key is required for every send.', { code: 'invalid_message' });
  const to = addressList(message.to);
  if (!to.length) throw new MailError('At least one recipient is required.', { code: 'invalid_message' });
  if (!message.text && !message.html) throw new MailError('A text or HTML body is required.', { code: 'invalid_message' });

  if (config.emailMode === 'log') {
    return { status: 'accepted', messageId: `log_${Date.now()}`, mode: 'log', idempotentReplay: false };
  }

  const transport = resolveMailTransport();
  const headers = Object.fromEntries(Object.entries(message.headers || {})
    .map(([key, value]) => [assertHeaderSafe(key, 'Header name'), assertHeaderSafe(String(value ?? ''), 'Header value')]));

  const payload: Record<string, unknown> = {
    from: formatMailAddress(message.from ? assertHeaderSafe(message.from, 'Sender address') : transport.fromEmail),
    to,
    subject: assertHeaderSafe(String(message.subject ?? ''), 'Subject')
  };
  const fromName = String(message.fromName ?? transport.fromName ?? '').trim();
  if (fromName) payload.fromName = assertHeaderSafe(fromName, 'Sender name');
  const cc = addressList(message.cc); if (cc.length) payload.cc = cc;
  const bcc = addressList(message.bcc); if (bcc.length) payload.bcc = bcc;
  if (message.replyTo) payload.replyTo = assertHeaderSafe(String(message.replyTo).trim(), 'Reply-to address');
  if (message.text) payload.text = message.text;
  if (message.html) payload.html = message.html;
  if (message.tag) payload.tag = assertHeaderSafe(message.tag, 'Tag');
  if (Object.keys(headers).length) payload.headers = headers;
  if (message.attachments?.length) {
    payload.attachments = message.attachments.map((attachment) => ({
      name: assertHeaderSafe(String(attachment.name ?? ''), 'Attachment name'),
      contentType: assertHeaderSafe(String(attachment.contentType || 'application/octet-stream'), 'Attachment content type'),
      data: String(attachment.data ?? '')
    }));
  }

  let response: Response;
  try {
    response = await fetch(`${transport.baseUrl}${MAIL_SEND_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${transport.token}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(message.timeoutMs ?? transport.timeoutMs)
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new MailError(
      timedOut ? 'The mail service did not answer before the request timeout.' : 'The mail service could not be reached.',
      { code: timedOut ? 'timeout' : 'network_error', retryable: true }
    );
  }

  const body = await response.json().catch(() => ({})) as {
    status?: string;
    messageId?: string;
    message?: string;
    error?: string | { code?: string; message?: string };
    code?: string;
  };
  const serviceError = body.error && typeof body.error === 'object' ? body.error : null;
  const messageId = String(body.messageId || '').trim();

  // A 409 answers a replayed Idempotency-Key: the original message was already
  // accepted, so the business event is complete and must not be sent again.
  if (response.status === 409) {
    return { status: 'accepted', messageId: messageId || `idempotent:${idempotencyKey}`, mode: 'send', idempotentReplay: true };
  }
  if (!response.ok) {
    throw classifyFailure(
      response.status,
      String(serviceError?.code || body.code || (typeof body.error === 'string' ? body.error : '')),
      String(serviceError?.message || body.message || '')
    );
  }
  if (body.status && body.status !== 'accepted') {
    throw new MailError(`Mail service returned an unexpected status "${body.status}".`, {
      status: response.status,
      code: 'unexpected_status',
      retryable: false
    });
  }
  return { status: 'accepted', messageId, mode: 'send', idempotentReplay: false };
}
