'use strict';

const crypto = require('node:crypto');

const INSECURE_DEFAULT = 'your-webhook-secret-key';
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

function resolveIdpWebhookSecret(source = process.env) {
  const value = String(source.IDP_WEBHOOK_SECRET || '').trim();
  const production = String(source.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (production && (value.length < 32 || value === INSECURE_DEFAULT)) {
    throw new Error('IDP_WEBHOOK_SECRET must be a rotated secret of at least 32 characters in production');
  }
  return value || INSECURE_DEFAULT;
}

function resolveIdpWebhookSecrets(source = process.env) {
  const current = resolveIdpWebhookSecret(source);
  const previous = String(source.IDP_WEBHOOK_SECRET_PREVIOUS || '').trim();
  const production = String(source.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (previous && production && (previous.length < 32 || previous === INSECURE_DEFAULT)) {
    throw new Error('IDP_WEBHOOK_SECRET_PREVIOUS must be a rotated secret of at least 32 characters in production');
  }
  return [...new Set([current, previous].filter(Boolean))];
}

function verifyIdpWebhook({
  payload,
  signature,
  deliveryTimestamp,
  secret = resolveIdpWebhookSecrets(),
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS
}) {
  const supplied = String(signature || '').trim();
  const timestamp = Date.parse(String(deliveryTimestamp || ''));
  const eventId = String(payload?.eventId || '').trim();
  if (!eventId || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxAgeMs) {
    return { ok: false, code: 'IDP_WEBHOOK_STALE_OR_MALFORMED' };
  }
  if (!/^[a-f0-9-]{20,80}$/i.test(eventId) || !/^[a-f0-9]{64}$/i.test(supplied)) {
    return { ok: false, code: 'IDP_WEBHOOK_SIGNATURE_INVALID' };
  }
  const actualBuffer = Buffer.from(supplied, 'hex');
  const candidates = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
  const valid = candidates.some((candidate) => {
    const expected = crypto.createHmac('sha256', candidate)
      .update(`${deliveryTimestamp}\n${JSON.stringify(payload)}`)
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return actualBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  });
  return valid
    ? { ok: true }
    : { ok: false, code: 'IDP_WEBHOOK_SIGNATURE_INVALID' };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  resolveIdpWebhookSecret,
  resolveIdpWebhookSecrets,
  verifyIdpWebhook
};
