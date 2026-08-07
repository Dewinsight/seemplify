/**
 * Delivery Status Notification and feedback-report parsing.
 *
 * Scope is deliberately narrow: extract the machine-readable fields defined by
 * RFC 3464 (`message/delivery-status`) and RFC 5965 (`message/feedback-report`)
 * and nothing else. The human-readable part and any returned message body are
 * never read, never stored and never logged - only the original Message-ID
 * header is pulled out of the attached original message so the bounce can be
 * correlated with a send.
 */

const MAX_SCAN_BYTES = 512 * 1024;
const MAX_HEADER_LINES = 400;

/** Unfolds RFC 5322 folded headers into `name: value` pairs, order preserved. */
export function parseHeaderBlock(block) {
  const headers = [];
  let current = null;
  let lines = 0;
  for (const rawLine of String(block).split(/\r?\n/)) {
    if (lines++ > MAX_HEADER_LINES) break;
    if (/^[ \t]/.test(rawLine)) {
      if (current) current.value += ` ${rawLine.trim()}`;
      continue;
    }
    const match = rawLine.match(/^([!-9;-~]+):[ \t]*(.*)$/);
    if (!match) continue;
    if (current) headers.push(current);
    current = { name: match[1].toLowerCase(), value: match[2].trim() };
  }
  if (current) headers.push(current);
  return headers;
}

export function headerValue(headers, name) {
  const found = headers.find((header) => header.name === name.toLowerCase());
  return found ? found.value : '';
}

/** Splits a raw message into its header block and the remaining body. */
export function splitMessage(raw) {
  const text = String(raw).slice(0, MAX_SCAN_BYTES);
  const separator = text.search(/\r?\n\r?\n/);
  if (separator === -1) return { headers: parseHeaderBlock(text), body: '' };
  const headerText = text.slice(0, separator);
  const body = text.slice(separator).replace(/^\r?\n\r?\n/, '');
  return { headers: parseHeaderBlock(headerText), body };
}

function boundaryOf(contentType) {
  const match = String(contentType).match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  return match ? (match[1] || match[2]) : '';
}

/** Splits a multipart body into its parts without decoding any of them. */
export function multipartParts(body, boundary) {
  if (!boundary) return [];
  const marker = `--${boundary}`;
  return String(body)
    .split(marker)
    .slice(1)
    .filter((part) => !/^--/.test(part.trim().slice(0, 2)))
    .map((part) => part.replace(/^\r?\n/, ''))
    .filter(Boolean);
}

function extractAddress(value) {
  const text = String(value || '');
  // `rfc822; user@example.com` or `<user@example.com>` or bare address.
  const typed = text.match(/^[a-z0-9-]+\s*;\s*(.+)$/i);
  const candidate = typed ? typed[1] : text;
  const angled = candidate.match(/<([^>]+)>/);
  return String(angled ? angled[1] : candidate).trim().replace(/^"|"$/g, '');
}

function classifyStatus(status, action) {
  const normalized = String(status || '').trim();
  const match = normalized.match(/^([245])\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    if (match[1] === '5') return 'hard';
    if (match[1] === '4') return 'soft';
    return 'unknown';
  }
  const normalizedAction = String(action || '').toLowerCase();
  if (normalizedAction === 'failed') return 'hard';
  if (normalizedAction === 'delayed') return 'soft';
  return 'unknown';
}

function firstSmtpCode(diagnostic) {
  const match = String(diagnostic || '').match(/\b([45]\d{2})\b/);
  return match ? match[1] : null;
}

/**
 * Parses a `message/delivery-status` part into per-recipient reports.
 * The per-message fields come first, then one group per recipient.
 */
export function parseDeliveryStatus(part) {
  const blocks = String(part).split(/\r?\n\r?\n/).filter((block) => block.trim());
  if (!blocks.length) return { reportingMta: '', recipients: [] };
  const perMessage = parseHeaderBlock(blocks[0]);
  const recipients = [];
  for (const block of blocks.slice(1)) {
    const fields = parseHeaderBlock(block);
    const finalRecipient = headerValue(fields, 'final-recipient') || headerValue(fields, 'original-recipient');
    if (!finalRecipient) continue;
    const status = headerValue(fields, 'status');
    const action = headerValue(fields, 'action');
    const diagnostic = headerValue(fields, 'diagnostic-code');
    recipients.push({
      recipient: extractAddress(finalRecipient),
      action: action.toLowerCase(),
      status,
      bounceType: classifyStatus(status, action),
      diagnosticCode: diagnostic.slice(0, 240),
      smtpCode: firstSmtpCode(diagnostic) || (status ? status.split('.')[0].padEnd(3, '0') : null),
      remoteMta: extractAddress(headerValue(fields, 'remote-mta')).slice(0, 253),
    });
  }
  return {
    reportingMta: extractAddress(headerValue(perMessage, 'reporting-mta')).slice(0, 253),
    recipients,
  };
}

/** Parses an RFC 5965 abuse feedback report. */
export function parseFeedbackReport(part) {
  const fields = parseHeaderBlock(part);
  const feedbackType = headerValue(fields, 'feedback-type').toLowerCase();
  return {
    feedbackType,
    isComplaint: feedbackType === 'abuse' || feedbackType === 'fraud',
    originalRecipient: extractAddress(headerValue(fields, 'original-rcpt-to')),
    originalMessageId: headerValue(fields, 'message-id').replace(/[<>]/g, '').slice(0, 200),
    reportedDomain: headerValue(fields, 'reported-domain').slice(0, 253),
  };
}

/**
 * Pulls only the Message-ID (and Postal's own message token header when
 * present) out of an attached original message. The rest of the returned
 * message is discarded without being inspected.
 */
function correlationFromOriginal(part) {
  const { headers } = splitMessage(part);
  return {
    originalMessageId: headerValue(headers, 'message-id').replace(/[<>]/g, '').slice(0, 200) || null,
    postalMessageId: headerValue(headers, 'x-postal-msgid').slice(0, 128) || null,
  };
}

/**
 * Parses a complete raw DSN or ARF message.
 *
 * @returns {{
 *   kind: 'dsn'|'arf'|'unrecognised',
 *   reportingMta: string,
 *   originalMessageId: string|null,
 *   postalMessageId: string|null,
 *   subjectPresent: boolean,
 *   recipients: Array<object>
 * }}
 */
export function parseBounce(raw) {
  const { headers, body } = splitMessage(raw);
  const contentType = headerValue(headers, 'content-type');
  const result = {
    kind: 'unrecognised',
    reportingMta: '',
    originalMessageId: null,
    postalMessageId: null,
    // Recorded as a boolean only. The subject of a bounce can quote the
    // original subject, so its value is never captured.
    subjectPresent: Boolean(headerValue(headers, 'subject')),
    envelopeFrom: extractAddress(headerValue(headers, 'return-path')),
    recipients: [],
  };

  const boundary = boundaryOf(contentType);
  const parts = multipartParts(body, boundary);

  for (const part of parts) {
    const { headers: partHeaders, body: partBody } = splitMessage(part);
    const partType = headerValue(partHeaders, 'content-type').toLowerCase();

    if (partType.startsWith('message/delivery-status')) {
      const status = parseDeliveryStatus(partBody);
      result.kind = 'dsn';
      result.reportingMta = status.reportingMta;
      result.recipients.push(...status.recipients);
    } else if (partType.startsWith('message/feedback-report')) {
      const report = parseFeedbackReport(partBody);
      result.kind = 'arf';
      if (report.originalMessageId) result.originalMessageId = report.originalMessageId;
      if (report.originalRecipient) {
        result.recipients.push({
          recipient: report.originalRecipient,
          action: 'complained',
          status: '',
          bounceType: 'complaint',
          diagnosticCode: `feedback-type=${report.feedbackType}`.slice(0, 240),
          smtpCode: null,
          remoteMta: report.reportedDomain,
        });
      }
    } else if (partType.startsWith('message/rfc822') || partType.startsWith('text/rfc822-headers')) {
      const correlation = correlationFromOriginal(partBody);
      result.originalMessageId = result.originalMessageId || correlation.originalMessageId;
      result.postalMessageId = result.postalMessageId || correlation.postalMessageId;
    }
  }

  // Some MTAs send a non-multipart failure notice. Treat it as a soft signal
  // rather than guessing a recipient we cannot confirm.
  if (result.kind === 'unrecognised' && /^(mail delivery|undelivered mail|delivery status)/i.test(headerValue(headers, 'subject'))) {
    result.kind = 'dsn';
  }

  return result;
}

/**
 * A DSN must look like an automated report, not like ordinary mail. This gate
 * runs on both sides: in the Cloudflare Worker before anything is forwarded,
 * and again here before anything is recorded.
 */
export function looksLikeReport(raw) {
  const { headers } = splitMessage(raw);
  const contentType = headerValue(headers, 'content-type').toLowerCase();
  const from = extractAddress(headerValue(headers, 'from')).toLowerCase();
  const returnPath = headerValue(headers, 'return-path').trim();
  const autoSubmitted = headerValue(headers, 'auto-submitted').toLowerCase();

  const reasons = [];
  const isReportType = contentType.includes('multipart/report');
  const isNullReturnPath = returnPath === '<>' || returnPath === '';
  const isDaemonSender = /^(mailer-daemon|postmaster|double-bounce)@/.test(from);
  const isAutoSubmitted = autoSubmitted.startsWith('auto-replied') || autoSubmitted.startsWith('auto-generated');

  if (!isReportType) reasons.push('not_multipart_report');
  if (!isNullReturnPath && !isDaemonSender && !isAutoSubmitted) reasons.push('not_automated_sender');

  return {
    // multipart/report is decisive; otherwise require automated-sender evidence.
    ok: isReportType || isNullReturnPath || isDaemonSender || isAutoSubmitted,
    strict: isReportType && (isNullReturnPath || isDaemonSender || isAutoSubmitted),
    reasons,
  };
}

export { extractAddress, classifyStatus };
