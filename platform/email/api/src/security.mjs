import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const VALID_SCOPES = new Set(['send', 'read', 'admin']);

/** SHA-256 hex digest. Used for credential comparison and address hashing. */
export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/**
 * Length-independent constant-time comparison. Both sides are hashed first so
 * that timingSafeEqual always receives equal-length buffers and the comparison
 * leaks nothing about the length of the secret.
 */
export function secureCompare(a, b) {
  const left = createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const right = createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * Parses MAIL_API_KEYS.
 * Format: `keyId:sha256hex:scope|scope,keyId2:sha256hex:scope`
 * Only the SHA-256 hash of the secret is ever stored or configured, so a leaked
 * .env file does not yield usable API credentials.
 */
export function parseApiKeys(raw) {
  const keys = new Map();
  for (const entry of String(raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(':');
    if (parts.length !== 3) throw new Error('MAIL_API_KEYS entries must be keyId:sha256hex:scopes.');
    const [keyId, hash, scopeList] = parts.map((part) => part.trim());
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(keyId)) throw new Error(`Invalid API key id: ${keyId}`);
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`API key ${keyId} must carry a 64-character SHA-256 hex hash.`);
    if (keys.has(keyId)) throw new Error(`Duplicate API key id: ${keyId}`);
    const scopes = new Set(scopeList.split('|').map((scope) => scope.trim().toLowerCase()).filter(Boolean));
    if (!scopes.size) throw new Error(`API key ${keyId} has no scopes.`);
    for (const scope of scopes) {
      if (!VALID_SCOPES.has(scope)) throw new Error(`API key ${keyId} has unknown scope: ${scope}`);
    }
    keys.set(keyId, { keyId, hash: hash.toLowerCase(), scopes });
  }
  return keys;
}

/**
 * Authenticates `Authorization: Bearer <keyId>.<secret>`.
 * Returns null for every failure mode so callers cannot distinguish "unknown
 * key id" from "wrong secret".
 */
export function authenticate(authorizationHeader, apiKeys) {
  const header = String(authorizationHeader ?? '');
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{3,64})\.([A-Za-z0-9_.~-]{16,256})$/);
  if (!match) return null;
  const [, keyId, secret] = match;
  const record = apiKeys.get(keyId);
  if (!record) {
    // Burn comparable time on an unknown id so the response time does not
    // reveal whether the key id exists.
    secureCompare(secret, 'unknown-key-placeholder');
    return null;
  }
  if (!secureCompare(sha256Hex(secret), record.hash)) return null;
  return { keyId: record.keyId, scopes: new Set(record.scopes) };
}

export function hasScope(principal, scope) {
  if (!principal) return false;
  return principal.scopes.has('admin') || principal.scopes.has(scope);
}

/** Normalizes an address for hashing and suppression lookups. */
export function normalizeAddress(address) {
  const value = String(address ?? '').trim().toLowerCase();
  const match = value.match(/^[^\s@]+@[^\s@]+$/);
  return match ? value : '';
}

/**
 * One-way, salted address identity. The store never persists a plaintext
 * recipient address; it persists this hash plus a masked display form.
 */
export function hashAddress(address, salt) {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  return createHmac('sha256', String(salt ?? '')).update(normalized, 'utf8').digest('hex');
}

/** `jane.doe@example.com` -> `ja***@example.com` */
export function maskAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  const [local, domain] = normalized.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(3)}@${domain}`;
}

export function addressDomain(address) {
  const normalized = normalizeAddress(address);
  return normalized ? normalized.split('@')[1] : '';
}

/**
 * Canonical string signed by both the Cloudflare Worker and this service.
 * Binding method, path, timestamp and nonce prevents a captured signature from
 * being replayed against a different route or outside its window.
 */
export function signingPayload({ method, path, timestamp, nonce, body }) {
  const digest = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${digest}`;
}

export function signRequest({ secret, method, path, timestamp, nonce, body }) {
  return createHmac('sha256', String(secret))
    .update(signingPayload({ method, path, timestamp, nonce, body }), 'utf8')
    .digest('hex');
}

/**
 * Verifies an HMAC-signed webhook with timestamp and replay protection.
 * Returns `{ ok: true }` or `{ ok: false, reason }`. The reason is for local
 * logs and metrics; the HTTP response never differentiates them.
 */
export function verifySignedRequest({
  secret,
  signature,
  timestamp,
  nonce,
  method,
  path,
  body,
  now = Date.now(),
  toleranceMs = 5 * 60 * 1000,
  replayGuard = null,
}) {
  if (!secret) return { ok: false, reason: 'secret_not_configured' };
  if (!/^[a-f0-9]{64}$/i.test(String(signature ?? ''))) return { ok: false, reason: 'malformed_signature' };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(nonce ?? ''))) return { ok: false, reason: 'malformed_nonce' };

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, reason: 'malformed_timestamp' };
  const skew = Math.abs(now - timestampMs);
  if (skew > toleranceMs) return { ok: false, reason: 'stale_timestamp' };

  const expected = signRequest({ secret, method, path, timestamp, nonce, body });
  if (!secureCompare(expected, signature)) return { ok: false, reason: 'signature_mismatch' };

  // The signature is only accepted once inside the tolerance window.
  if (replayGuard && !replayGuard.remember(nonce, now)) return { ok: false, reason: 'replayed_nonce' };
  return { ok: true };
}

/**
 * Bounded, self-expiring nonce cache. Entries live for the replay tolerance
 * window; the cache is capped so a flood of unique nonces cannot exhaust
 * memory.
 */
export class ReplayGuard {
  #seen = new Map();
  #ttlMs;
  #maxEntries;

  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 20_000 } = {}) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  /** Returns false when the nonce was already used inside the window. */
  remember(nonce, now = Date.now()) {
    this.#evict(now);
    if (this.#seen.has(nonce)) return false;
    if (this.#seen.size >= this.#maxEntries) {
      // Drop the oldest insertion rather than refusing new traffic outright.
      const oldest = this.#seen.keys().next();
      if (!oldest.done) this.#seen.delete(oldest.value);
    }
    this.#seen.set(nonce, now + this.#ttlMs);
    return true;
  }

  get size() {
    return this.#seen.size;
  }

  #evict(now) {
    if (this.#seen.size === 0) return;
    for (const [nonce, expiresAt] of this.#seen) {
      if (expiresAt > now) break; // insertion-ordered: the rest are newer
      this.#seen.delete(nonce);
    }
  }
}

export function newRequestId() {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}

export { VALID_SCOPES };
