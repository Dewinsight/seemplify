import { HttpError } from './http.mjs';
import { normalizeAddress, addressDomain } from './security.mjs';

/**
 * Message validation for the send proxy.
 *
 * Two properties matter most here:
 *  1. An application may only send as the configured sending domain, so a
 *     compromised application key cannot impersonate an unrelated domain.
 *  2. No caller-supplied value may inject headers. Anything containing CR, LF
 *     or NUL is rejected outright rather than sanitised, and the headers Postal
 *     or DKIM must own are not accepted from callers at all.
 */

const FORBIDDEN_HEADERS = new Set([
  'from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date',
  'message-id', 'return-path', 'received', 'dkim-signature',
  'domainkey-signature', 'authentication-results', 'content-type',
  'content-transfer-encoding', 'mime-version', 'bcc-recipients',
]);

// Built from a string literal so every character in this source file stays
// printable ASCII. A raw control character embedded in a regex literal is
// invisible in review and easy to corrupt in transit.
const INJECTION_PATTERN = new RegExp('[\\r\\n\\u0000]');

const MAX_SUBJECT_LENGTH = 900;
const MAX_HEADER_COUNT = 20;
const MAX_HEADER_VALUE = 400;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_FROM_NAME_LENGTH = 120;

function assertNoInjection(value, field) {
  // Ordinary spaces are legitimate in subjects and header values; CR, LF and
  // NUL are the characters that would let a caller forge extra headers.
  if (INJECTION_PATTERN.test(String(value))) {
    throw new HttpError(422, 'header_injection', `${field} may not contain line breaks or null bytes.`);
  }
}

function normalizeRecipientList(value, field, max) {
  const raw = value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]);
  if (raw.length > max) {
    throw new HttpError(422, 'too_many_recipients', `${field} exceeds the ${max} recipient limit.`);
  }
  const addresses = [];
  for (const entry of raw) {
    assertNoInjection(entry, field);
    const normalized = normalizeAddress(entry);
    if (!normalized) throw new HttpError(422, 'invalid_recipient', `${field} contains an address that is not valid.`);
    if (normalized.length > 254) throw new HttpError(422, 'invalid_recipient', `${field} contains an address that is too long.`);
    if (!addresses.includes(normalized)) addresses.push(normalized);
  }
  return addresses;
}

function isSendingDomain(domain, sendingDomains) {
  return sendingDomains.some((sendingDomain) => (
    domain === sendingDomain || domain.endsWith(`.${sendingDomain}`)
  ));
}

/**
 * @returns {{
 *   from: string, to: string[], cc: string[], bcc: string[], replyTo: string|null,
 *   subject: string, text: string|null, html: string|null, tag: string|null,
 *   headers: Record<string,string>, attachments: Array<object>, allRecipients: string[]
 * }}
 */
export function validateMessage(body, { sendingDomains, maxRecipients }) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body', 'A JSON object is required.');

  assertNoInjection(body.from ?? '', 'from');
  const from = normalizeAddress(body.from);
  if (!from) throw new HttpError(422, 'invalid_from', 'A valid `from` address is required.');
  const fromDomain = addressDomain(from);
  if (!isSendingDomain(fromDomain, sendingDomains)) {
    throw new HttpError(403, 'from_domain_not_allowed', `This platform only sends as an approved sender domain: ${sendingDomains.join(', ')}.`);
  }

  let fromName = null;
  if (body.fromName !== undefined && body.fromName !== null) {
    fromName = String(body.fromName).trim();
    assertNoInjection(fromName, 'fromName');
    if (fromName.length > MAX_FROM_NAME_LENGTH) {
      throw new HttpError(422, 'from_name_too_long', `\`fromName\` may not exceed ${MAX_FROM_NAME_LENGTH} characters.`);
    }
    if (!fromName) fromName = null;
  }

  const to = normalizeRecipientList(body.to, 'to', maxRecipients);
  const cc = normalizeRecipientList(body.cc, 'cc', maxRecipients);
  const bcc = normalizeRecipientList(body.bcc, 'bcc', maxRecipients);
  const allRecipients = [...new Set([...to, ...cc, ...bcc])];
  if (!allRecipients.length) throw new HttpError(422, 'no_recipients', 'At least one recipient is required.');
  if (allRecipients.length > maxRecipients) {
    throw new HttpError(422, 'too_many_recipients', `A single message may not exceed ${maxRecipients} recipients.`);
  }

  let replyTo = null;
  if (body.replyTo) {
    assertNoInjection(body.replyTo, 'replyTo');
    replyTo = normalizeAddress(body.replyTo);
    if (!replyTo) throw new HttpError(422, 'invalid_reply_to', '`replyTo` is not a valid address.');
  }

  const subject = String(body.subject ?? '').trim();
  if (!subject) throw new HttpError(422, 'missing_subject', 'A `subject` is required.');
  assertNoInjection(subject, 'subject');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new HttpError(422, 'subject_too_long', `\`subject\` may not exceed ${MAX_SUBJECT_LENGTH} characters.`);
  }

  const text = body.text ? String(body.text) : null;
  const html = body.html ? String(body.html) : null;
  if (!text && !html) throw new HttpError(422, 'missing_body', 'Provide `text`, `html`, or both.');

  let tag = null;
  if (body.tag) {
    tag = String(body.tag).trim().slice(0, 64);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) {
      throw new HttpError(422, 'invalid_tag', '`tag` may contain letters, digits, dot, underscore and hyphen only.');
    }
  }

  const headers = {};
  const suppliedHeaders = body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers) ? body.headers : {};
  const headerNames = Object.keys(suppliedHeaders);
  if (headerNames.length > MAX_HEADER_COUNT) {
    throw new HttpError(422, 'too_many_headers', `At most ${MAX_HEADER_COUNT} custom headers are allowed.`);
  }
  for (const name of headerNames) {
    const lower = name.toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(lower)) throw new HttpError(422, 'invalid_header_name', 'Custom header names may contain letters, digits and hyphens only.');
    if (FORBIDDEN_HEADERS.has(lower)) throw new HttpError(422, 'reserved_header', `The ${name} header is set by the platform and may not be overridden.`);
    if (lower.startsWith('x-postal')) throw new HttpError(422, 'reserved_header', 'x-postal-* headers are reserved.');
    const value = String(suppliedHeaders[name] ?? '');
    assertNoInjection(value, `headers.${name}`);
    if (value.length > MAX_HEADER_VALUE) throw new HttpError(422, 'header_too_long', `headers.${name} exceeds ${MAX_HEADER_VALUE} characters.`);
    headers[name] = value;
  }

  const attachments = [];
  const suppliedAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (suppliedAttachments.length > MAX_ATTACHMENTS) {
    throw new HttpError(422, 'too_many_attachments', `At most ${MAX_ATTACHMENTS} attachments are allowed.`);
  }
  let attachmentBytes = 0;
  for (const attachment of suppliedAttachments) {
    if (!attachment || typeof attachment !== 'object') throw new HttpError(422, 'invalid_attachment', 'Each attachment must be an object.');
    const name = String(attachment.name ?? '').trim();
    if (!name || !/^[\w .()-]{1,120}$/.test(name)) throw new HttpError(422, 'invalid_attachment', 'Attachment names may contain letters, digits, spaces, dots, hyphens, underscores and parentheses.');
    const contentType = String(attachment.contentType ?? 'application/octet-stream').trim();
    assertNoInjection(contentType, 'attachment.contentType');
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) throw new HttpError(422, 'invalid_attachment', 'Attachment contentType is not a valid MIME type.');
    const data = String(attachment.data ?? '');
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(422, 'invalid_attachment', 'Attachment data must be base64.');
    attachmentBytes += Math.floor((data.length * 3) / 4);
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'attachments_too_large', 'Total attachment size exceeds the limit.');
    attachments.push({ name, content_type: contentType, data });
  }

  return { from, fromName, to, cc, bcc, replyTo, subject, text, html, tag, headers, attachments, allRecipients };
}

function postalAddress(email, name) {
  if (!name) return email;
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

/** Maps the validated message onto Postal's send/message payload. */
export function toPostalPayload(message, { recipients }) {
  const payload = {
    to: recipients.filter((address) => message.to.includes(address)),
    cc: recipients.filter((address) => message.cc.includes(address)),
    bcc: recipients.filter((address) => message.bcc.includes(address)),
    from: postalAddress(message.from, message.fromName),
    subject: message.subject,
  };
  if (message.replyTo) payload.reply_to = message.replyTo;
  if (message.text) payload.plain_body = message.text;
  if (message.html) payload.html_body = message.html;
  if (message.tag) payload.tag = message.tag;
  if (Object.keys(message.headers).length) payload.headers = message.headers;
  if (message.attachments.length) payload.attachments = message.attachments;
  for (const field of ['cc', 'bcc']) {
    if (!payload[field].length) delete payload[field];
  }
  return payload;
}

export { FORBIDDEN_HEADERS, MAX_SUBJECT_LENGTH, MAX_ATTACHMENT_BYTES, MAX_FROM_NAME_LENGTH, INJECTION_PATTERN };
