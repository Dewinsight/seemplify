/**
 * Structured JSON logging with a hard rule: message bodies, subjects, headers,
 * plaintext recipient addresses and credentials never reach the log stream.
 *
 * Anything that could carry those values goes through `scrub` first, and the
 * logger only serialises an explicit allow-list of field names.
 */

const ALLOWED_FIELDS = new Set([
  'event', 'level', 'time', 'requestId', 'method', 'path', 'status', 'durationMs',
  'keyId', 'principal', 'scope', 'outcome', 'reason', 'source', 'type',
  'messageId', 'recipientHash', 'recipientDomain', 'recipientMasked',
  'bounceType', 'diagnosticCode', 'statusCode', 'count', 'queue', 'depth',
  'component', 'release', 'version', 'gate', 'state', 'detail', 'error',
  'bytes', 'limit', 'remaining', 'retryAfterMs', 'attempt', 'sizeBytes',
]);

const SECRET_PATTERN = /(bearer\s+[a-z0-9._~-]+|(?:api[_-]?key|secret|password|token|signature|authorization)\s*[=:]\s*[^\s,;"']+)/gi;

export function scrub(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(SECRET_PATTERN, '[redacted]').slice(0, 400);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return scrub(value.message, depth);
  if (depth >= 2) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      output[key] = scrub(item, depth + 1);
    }
    return output;
  }
  return '[unsupported]';
}

export function createLogger({ stream = process.stdout, release = 'local', now = () => new Date().toISOString() } = {}) {
  function emit(level, event, fields = {}) {
    const record = { time: now(), level, event, release };
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      const scrubbed = scrub(value, 1);
      if (scrubbed !== undefined) record[key] = scrubbed;
    }
    stream.write(`${JSON.stringify(record)}\n`);
  }

  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

export { ALLOWED_FIELDS };
