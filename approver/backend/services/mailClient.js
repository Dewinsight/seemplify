/**
 * First-party transactional mail client for the self-hosted Seemplify mail
 * service.
 *
 *   POST {MAIL_API_BASE_URL}/v1/messages
 *   Authorization: Bearer <keyId>.<secret>
 *   Idempotency-Key: <stable business identifier>
 *
 * A successful send answers HTTP 202 with `{ status: 'accepted', messageId }`.
 * Configuration is read per call so a rotated credential takes effect without a
 * restart. The bearer token and message body are never logged.
 */

const fs = require('fs');
const path = require('path');

const MAIL_SEND_PATH = '/v1/messages';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const UNSAFE_MAILBOX_CHARACTERS = /[\s<>,;"\\]/u;
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:5020';

class MailError extends Error {
    constructor(message, { status = null, code = 'mail_error', retryable = false } = {}) {
        super(message);
        this.name = 'MailError';
        this.status = status;
        this.code = code;
        this.retryable = Boolean(retryable);
        this.permanent = !this.retryable;
    }
}

function isRetryableMailError(error) {
    return error instanceof MailError && error.retryable;
}

function assertHeaderSafe(value, label) {
    if (CONTROL_CHARACTERS.test(value)) {
        throw new MailError(`${label} cannot contain control characters.`, { code: 'invalid_message' });
    }
    return value;
}

/**
 * Validates and returns a bare mailbox. The mail service composes the header
 * itself from `from`/`fromName`, so an address must never carry a display part
 * or any separator that could smuggle a second recipient.
 */
function formatMailAddress(email) {
    const mailbox = String(email == null ? '' : email).trim();
    if (!mailbox) throw new MailError('An email address is required.', { code: 'invalid_message' });
    if (UNSAFE_MAILBOX_CHARACTERS.test(mailbox) || CONTROL_CHARACTERS.test(mailbox)) {
        throw new MailError('Email address contains characters that are not allowed in a mailbox.', { code: 'invalid_message' });
    }
    return mailbox;
}

/** Every recipient list entry is validated as a bare mailbox. */
function addressList(value) {
    const items = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    return items
        .map((item) => String(item == null ? '' : item).trim())
        .filter(Boolean)
        .map((item) => formatMailAddress(assertHeaderSafe(item, 'Email address')));
}

function boundedTimeout(value) {
    const parsed = Number(value);
    return Math.max(2000, Math.min(60000, Number.isFinite(parsed) && parsed > 0 ? parsed : 15000));
}

/**
 * Resolves transport configuration from the environment and fails closed when
 * the base URL, credential or sender is absent. The 127.0.0.1 fallback exists
 * for local development only; NODE_ENV=production requires an explicit address.
 */
function resolveMailTransport(environment = process.env) {
    const configuredBaseUrl = String(environment.MAIL_API_BASE_URL || '').trim();
    const isProduction = String(environment.NODE_ENV || '').trim().toLowerCase() === 'production';
    const baseUrl = (configuredBaseUrl || (isProduction ? '' : DEFAULT_LOCAL_BASE_URL)).replace(/\/+$/, '');
    // A mounted secret file is preferred in deployments; an explicit
    // MAIL_API_TOKEN still wins so a local override stays simple.
    const tokenFile = String(environment.MAIL_API_TOKEN_FILE || '').trim();
    let fileToken = '';
    if (tokenFile) {
        try {
            fileToken = fs.readFileSync(path.resolve(tokenFile), 'utf8').trim();
        } catch (error) {
            fileToken = '';
        }
    }
    const token = String(environment.MAIL_API_TOKEN || fileToken).trim();
    const fromEmail = String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || '').trim();
    if (!baseUrl) throw new MailError('MAIL_API_BASE_URL is not configured.', { code: 'mail_not_configured' });
    if (!token) throw new MailError('MAIL_API_TOKEN is not configured.', { code: 'mail_not_configured' });
    if (!fromEmail) throw new MailError('MAIL_FROM_EMAIL is not configured.', { code: 'mail_not_configured' });
    return {
        baseUrl,
        token,
        fromEmail,
        fromName: String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || '').trim(),
        timeoutMs: boundedTimeout(environment.MAIL_TIMEOUT_MS)
    };
}

/** True when a send would be attempted rather than rejected as unconfigured. */
function isMailConfigured(environment = process.env) {
    try {
        resolveMailTransport(environment);
        return true;
    } catch (error) {
        return false;
    }
}

function mailTransportStatus(environment = process.env) {
    try {
        const transport = resolveMailTransport(environment);
        return { configured: true, baseUrl: transport.baseUrl, sender: transport.fromEmail, senderName: transport.fromName, reason: null };
    } catch (error) {
        return {
            configured: false,
            baseUrl: String(environment.MAIL_API_BASE_URL || ''),
            sender: String(environment.MAIL_FROM_EMAIL || environment.SENDER_EMAIL || ''),
            senderName: String(environment.MAIL_FROM_NAME || environment.SENDER_NAME || ''),
            reason: error instanceof MailError ? error.message : 'Mail transport is not configured.'
        };
    }
}

/**
 * 401/403 mean the deployment credential is wrong and every retry fails the
 * same way. 429 and 5xx (including `sending_disabled` while the production gate
 * is closed) are transient and safe to attempt again with the same key.
 */
function classifyFailure(status, code, message) {
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
 * Posts exactly one message. Retries are the caller's decision so an existing
 * delivery ledger or job queue stays the single source of truth for attempts.
 *
 * @param {Object} message
 * @param {string}   [message.from]      Bare mailbox; defaults to the configured sender
 * @param {string}   [message.fromName]  Display name; defaults to MAIL_FROM_NAME
 * @param {string|string[]} message.to   Bare mailboxes
 * @param {string|string[]} [message.cc]
 * @param {string|string[]} [message.bcc]
 * @param {string}   [message.replyTo]
 * @param {string}   message.subject
 * @param {string}   [message.text]
 * @param {string}   [message.html]
 * @param {string}   [message.tag]
 * @param {Object}   [message.headers]
 * @param {Array<{name: string, contentType: string, data: string}>} [message.attachments] base64 `data`
 * @param {string}   message.idempotencyKey
 * @returns {Promise<{status: 'accepted', messageId: string, idempotentReplay: boolean}>}
 */
async function sendMail(message, environment = process.env) {
    const idempotencyKey = assertHeaderSafe(String(message.idempotencyKey == null ? '' : message.idempotencyKey).trim(), 'Idempotency key');
    if (!idempotencyKey) throw new MailError('An idempotency key is required for every send.', { code: 'invalid_message' });
    const to = addressList(message.to);
    if (!to.length) throw new MailError('At least one recipient is required.', { code: 'invalid_message' });
    if (!message.text && !message.html) throw new MailError('A text or HTML body is required.', { code: 'invalid_message' });

    const transport = resolveMailTransport(environment);
    const headers = {};
    for (const [key, value] of Object.entries(message.headers || {})) {
        headers[assertHeaderSafe(key, 'Header name')] = assertHeaderSafe(String(value == null ? '' : value), 'Header value');
    }

    const payload = {
        from: formatMailAddress(message.from ? assertHeaderSafe(message.from, 'Sender address') : transport.fromEmail),
        to,
        subject: assertHeaderSafe(String(message.subject == null ? '' : message.subject), 'Subject')
    };
    const fromName = String(message.fromName == null ? transport.fromName : message.fromName).trim();
    if (fromName) payload.fromName = assertHeaderSafe(fromName, 'Sender name');
    const cc = addressList(message.cc); if (cc.length) payload.cc = cc;
    const bcc = addressList(message.bcc); if (bcc.length) payload.bcc = bcc;
    if (message.replyTo) payload.replyTo = assertHeaderSafe(String(message.replyTo).trim(), 'Reply-to address');
    if (message.text) payload.text = message.text;
    if (message.html) payload.html = message.html;
    if (message.tag) payload.tag = assertHeaderSafe(String(message.tag), 'Tag');
    if (Object.keys(headers).length) payload.headers = headers;
    if (Array.isArray(message.attachments) && message.attachments.length) {
        payload.attachments = message.attachments.map((attachment) => ({
            name: assertHeaderSafe(String(attachment.name == null ? '' : attachment.name), 'Attachment name'),
            contentType: assertHeaderSafe(String(attachment.contentType || 'application/octet-stream'), 'Attachment content type'),
            data: String(attachment.data == null ? '' : attachment.data)
        }));
    }

    let response;
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
            signal: AbortSignal.timeout(message.timeoutMs ? boundedTimeout(message.timeoutMs) : transport.timeoutMs)
        });
    } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new MailError(
            timedOut ? 'The mail service did not answer before the request timeout.' : 'The mail service could not be reached.',
            { code: timedOut ? 'timeout' : 'network_error', retryable: true }
        );
    }

    const body = await response.json().catch(() => ({}));
    const messageId = String(body.messageId || '').trim();
    // The service may answer either `{ code, message }` or `{ error: { code, message } }`.
    const serviceError = body && typeof body.error === 'object' ? body.error : null;

    // A 409 answers a replayed Idempotency-Key: the original message was already
    // accepted, so the business event is complete and must not be sent again.
    if (response.status === 409) {
        return { status: 'accepted', messageId: messageId || `idempotent:${idempotencyKey}`, idempotentReplay: true };
    }
    if (!response.ok) {
        throw classifyFailure(
            response.status,
            String((serviceError && serviceError.code) || body.code || (typeof body.error === 'string' ? body.error : '')),
            String((serviceError && serviceError.message) || body.message || '')
        );
    }
    if (body.status && body.status !== 'accepted') {
        throw new MailError(`Mail service returned an unexpected status "${body.status}".`, {
            status: response.status,
            code: 'unexpected_status',
            retryable: false
        });
    }
    return { status: 'accepted', messageId, idempotentReplay: false };
}

module.exports = {
    MAIL_SEND_PATH,
    MailError,
    addressList,
    formatMailAddress,
    isMailConfigured,
    isRetryableMailError,
    mailTransportStatus,
    resolveMailTransport,
    sendMail
};
