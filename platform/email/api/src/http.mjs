/** Small HTTP helpers shared by the router. No framework, no dependencies. */

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
});

export function sendJson(response, statusCode, body, extraHeaders = {}) {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body ?? {});
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  response.end(payload);
}

export function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  if (response.writableEnded) return;
  const payload = String(body);
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    ...SECURITY_HEADERS,
  });
  response.end(payload);
}

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Reads a request body with a hard byte ceiling. The connection is destroyed
 * rather than drained when the limit is exceeded, so an oversized upload cannot
 * hold a worker open.
 */
export async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'payload_too_large', 'Request body exceeds the configured limit.');
  }
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      request.destroy();
      throw new HttpError(413, 'payload_too_large', 'Request body exceeds the configured limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export function parseJsonBody(buffer) {
  if (!buffer.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.');
  }
  return parsed;
}

export function queryInt(searchParams, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export { SECURITY_HEADERS };
