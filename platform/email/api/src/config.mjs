import { parseApiKeys } from './security.mjs';

const DEFAULTS = Object.freeze({
  port: 8080,
  host: '0.0.0.0',
  dataDir: '/var/lib/mail-api',
  maxBodyBytes: 256 * 1024,
  maxWebhookBytes: 1024 * 1024,
  maxRecipients: 50,
  replayToleranceMs: 5 * 60 * 1000,
  postalTimeoutMs: 15_000,
  recentEventLimit: 500,
  eventFileMaxBytes: 8 * 1024 * 1024,
  eventFileKeep: 3,
  idempotencyTtlMs: 24 * 60 * 60 * 1000,
});

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function text(value, fallback = '') {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

/**
 * Non-negative decimal with a fallback. Unlike `Number(value || fallback)` this
 * accepts an explicit "0", which is how an operator pins a rate-limit class to
 * burst-only with no refill.
 */
function rate(value, fallback) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeDomain(value, field) {
  const domain = text(value).toLowerCase().replace(/\.$/, '');
  if (!domain) throw new Error(`${field} is required.`);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new Error(`${field} is not a valid domain name.`);
  }
  return domain;
}

function normalizeDomains(value, primaryDomain) {
  const domains = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => normalizeDomain(entry, `MAIL_API_ALLOWED_DOMAINS[${index}]`));

  const unique = [...new Set([primaryDomain, ...domains])];
  if (unique.length > 20) throw new Error('MAIL_API_ALLOWED_DOMAINS may contain at most 20 domains.');
  return Object.freeze(unique);
}

function normalizeBaseUrl(value, fallback) {
  const raw = text(value, fallback);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Only http and https URLs are supported: ${raw}`);
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

/**
 * Builds the runtime configuration. Throws on values that would make the
 * service behave insecurely; degrades to a clearly-reported "not configured"
 * state for values that are simply absent during bootstrap.
 */
export function loadConfig(env = process.env) {
  const sendEnabled = bool(env.MAIL_API_SEND_ENABLED, false);
  const webhookSecret = text(env.MAIL_API_WEBHOOK_HMAC_SECRET);
  const postalWebhookToken = text(env.MAIL_API_POSTAL_WEBHOOK_TOKEN);
  const addressHashSalt = text(env.MAIL_API_ADDRESS_HASH_SALT);
  const postalApiKey = text(env.MAIL_API_POSTAL_API_KEY);

  if (webhookSecret && webhookSecret.length < 32) {
    throw new Error('MAIL_API_WEBHOOK_HMAC_SECRET must be at least 32 characters.');
  }
  if (postalWebhookToken && postalWebhookToken.length < 32) {
    throw new Error('MAIL_API_POSTAL_WEBHOOK_TOKEN must be at least 32 characters.');
  }
  if (addressHashSalt && addressHashSalt.length < 16) {
    throw new Error('MAIL_API_ADDRESS_HASH_SALT must be at least 16 characters.');
  }
  if (sendEnabled && !postalApiKey) {
    throw new Error('MAIL_API_SEND_ENABLED is true but MAIL_API_POSTAL_API_KEY is empty. Refusing to start in a state where sends would fail open.');
  }

  const apiKeys = parseApiKeys(env.MAIL_API_KEYS);
  const domain = normalizeDomain(env.MAIL_API_DOMAIN, 'MAIL_API_DOMAIN');

  return Object.freeze({
    release: text(env.MAIL_API_RELEASE, 'local'),
    port: int(env.MAIL_API_PORT, DEFAULTS.port, { min: 1, max: 65_535 }),
    host: text(env.MAIL_API_HOST, DEFAULTS.host),
    dataDir: text(env.MAIL_API_DATA_DIR, DEFAULTS.dataDir),
    domain,
    allowedDomains: normalizeDomains(env.MAIL_API_ALLOWED_DOMAINS, domain),
    bounceDomain: normalizeDomain(env.MAIL_API_BOUNCE_DOMAIN, 'MAIL_API_BOUNCE_DOMAIN'),
    sendEnabled,
    apiKeys,
    apiKeysConfigured: apiKeys.size > 0,
    webhookSecret,
    postalWebhookToken,
    addressHashSalt,
    trustedProxyHops: int(env.MAIL_API_TRUSTED_PROXY_HOPS, 0, { min: 0, max: 5 }),
    postal: Object.freeze({
      baseUrl: normalizeBaseUrl(env.MAIL_API_POSTAL_BASE_URL, ''),
      apiKey: postalApiKey,
      hostHeader: text(env.MAIL_API_POSTAL_HOST_HEADER),
      timeoutMs: int(env.MAIL_API_POSTAL_TIMEOUT_MS, DEFAULTS.postalTimeoutMs, { min: 1_000, max: 120_000 }),
    }),
    limits: Object.freeze({
      maxBodyBytes: int(env.MAIL_API_MAX_BODY_BYTES, DEFAULTS.maxBodyBytes, { min: 1024, max: 4 * 1024 * 1024 }),
      maxWebhookBytes: int(env.MAIL_API_MAX_WEBHOOK_BYTES, DEFAULTS.maxWebhookBytes, { min: 1024, max: 8 * 1024 * 1024 }),
      maxRecipients: int(env.MAIL_API_MAX_RECIPIENTS, DEFAULTS.maxRecipients, { min: 1, max: 500 }),
      replayToleranceMs: int(env.MAIL_API_REPLAY_TOLERANCE_MS, DEFAULTS.replayToleranceMs, { min: 30_000, max: 15 * 60 * 1000 }),
      recentEventLimit: int(env.MAIL_API_RECENT_EVENT_LIMIT, DEFAULTS.recentEventLimit, { min: 50, max: 5_000 }),
      eventFileMaxBytes: int(env.MAIL_API_EVENT_FILE_MAX_BYTES, DEFAULTS.eventFileMaxBytes, { min: 64 * 1024 }),
      eventFileKeep: int(env.MAIL_API_EVENT_FILE_KEEP, DEFAULTS.eventFileKeep, { min: 1, max: 20 }),
      idempotencyTtlMs: int(env.MAIL_API_IDEMPOTENCY_TTL_MS, DEFAULTS.idempotencyTtlMs, { min: 60_000 }),
    }),
    rateLimits: Object.freeze({
      // capacity = burst, refillPerSecond = sustained rate
      send: Object.freeze({ capacity: int(env.MAIL_API_RATE_SEND_BURST, 60, { min: 1 }), refillPerSecond: rate(env.MAIL_API_RATE_SEND_PER_SECOND, 2) }),
      read: Object.freeze({ capacity: int(env.MAIL_API_RATE_READ_BURST, 120, { min: 1 }), refillPerSecond: rate(env.MAIL_API_RATE_READ_PER_SECOND, 10) }),
      webhook: Object.freeze({ capacity: int(env.MAIL_API_RATE_WEBHOOK_BURST, 240, { min: 1 }), refillPerSecond: rate(env.MAIL_API_RATE_WEBHOOK_PER_SECOND, 20) }),
      unauthenticated: Object.freeze({ capacity: int(env.MAIL_API_RATE_ANON_BURST, 30, { min: 1 }), refillPerSecond: rate(env.MAIL_API_RATE_ANON_PER_SECOND, 1) }),
    }),
  });
}

export { DEFAULTS };
