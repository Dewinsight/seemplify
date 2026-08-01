const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_NONCE = /^[A-Za-z0-9_-]{16,128}$/;

function signRequest(secret, rawBody, requestPath, {
  timestamp = String(Date.now()),
  nonce = crypto.randomBytes(24).toString('base64url'),
  method = 'POST',
} = {}) {
  const signature = crypto.createHmac('sha256', String(secret))
    .update(`${timestamp}\n${nonce}\n${method.toUpperCase()}\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createReplayGuard({ ttlMs = 10 * 60_000, maxEntries = 20_000, now = Date.now, filename = null } = {}) {
  const seen = new Map();
  if (filename) {
    try {
      const persisted = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (const item of Array.isArray(persisted) ? persisted : []) {
        if (Array.isArray(item) && SAFE_NONCE.test(String(item[0])) && Number(item[1]) > now()) seen.set(String(item[0]), Number(item[1]));
      }
    } catch {}
  }
  function prune(current) {
    for (const [nonce, expiresAt] of seen) {
      if (expiresAt > current && seen.size <= maxEntries) break;
      seen.delete(nonce);
    }
  }
  function persist() {
    if (!filename) return;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, JSON.stringify([...seen].slice(-maxEntries)), { encoding: 'utf8', mode: 0o600 });
  }
  return {
    claim(nonce) {
      const current = now();
      prune(current);
      if (seen.has(nonce)) return false;
      seen.set(nonce, current + ttlMs);
      persist();
      return true;
    },
    size() { return seen.size; },
  };
}

function verifyRequest({ headers, method = 'POST', requestPath, rawBody, secret, replayGuard, now = Date.now, clockSkewMs = 5 * 60_000 }) {
  const timestamp = String(headers['x-seemplify-timestamp'] || '');
  const nonce = String(headers['x-seemplify-nonce'] || '');
  const signature = String(headers['x-seemplify-signature'] || '');
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now() - parsedTimestamp) > clockSkewMs) {
    return { ok: false, code: 'STALE_SIGNATURE' };
  }
  if (!SAFE_NONCE.test(nonce)) return { ok: false, code: 'INVALID_NONCE' };
  const expected = signRequest(secret, rawBody, requestPath, { timestamp, nonce, method }).signature;
  if (!safeEqual(signature, expected)) return { ok: false, code: 'INVALID_SIGNATURE' };
  if (!replayGuard.claim(nonce)) return { ok: false, code: 'REPLAYED_REQUEST' };
  return { ok: true };
}

function assertId(value, name) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) throw Object.assign(new Error(`${name} is invalid.`), { status: 400, code: 'INVALID_ID' });
  return normalized;
}

function tenantDatabaseName(spaceId, prefix = 'exp_') {
  const normalized = assertId(spaceId, 'spaceId');
  return `${prefix}${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 40)}`;
}

function assertStagedSource(sourcePath, stagingRoot, { mustExist = true, maxBytes = 50 * 1024 * 1024 } = {}) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw Object.assign(new Error('document.sourcePath must be an absolute staged path.'), { status: 400, code: 'INVALID_SOURCE_PATH' });
  }
  const root = path.resolve(stagingRoot);
  const candidate = path.resolve(sourcePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('document.sourcePath is outside the knowledge staging directory.'), { status: 403, code: 'SOURCE_PATH_NOT_ALLOWED' });
  }
  if (mustExist) {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) throw Object.assign(new Error('The staged source is not a file.'), { status: 400, code: 'INVALID_SOURCE_FILE' });
    if (stat.size > maxBytes) throw Object.assign(new Error('The staged source exceeds the configured size limit.'), { status: 413, code: 'SOURCE_TOO_LARGE' });
  }
  return candidate;
}

module.exports = { assertId, assertStagedSource, createReplayGuard, signRequest, tenantDatabaseName, verifyRequest };
