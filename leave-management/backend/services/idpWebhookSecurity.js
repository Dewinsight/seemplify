'use strict';

const crypto = require('node:crypto');

const DELIVERY_MAX_AGE_MS = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSECURE_SECRET = 'your-webhook-secret-key';

function strongSecret(secret) {
  const value = String(secret || '').trim();
  return Buffer.byteLength(value, 'utf8') >= 32 && value !== INSECURE_SECRET;
}

function configuredSecrets(source = process.env) {
  return [...new Set([
    String(source.IDP_WEBHOOK_SECRET || '').trim(),
    String(source.IDP_WEBHOOK_SECRET_PREVIOUS || '').trim(),
  ].filter(Boolean))];
}

function verifyIdpWebhook({
  payload,
  rawBody,
  eventHeader,
  deliveryTimestamp,
  signature,
  secret = configuredSecrets(),
  now = Date.now(),
} = {}) {
  const secrets = (Array.isArray(secret) ? secret : [secret])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!secrets.length || secrets.some((value) => !strongSecret(value))) {
    return { ok: false, status: 503, code: 'IDP_WEBHOOK_VERIFICATION_UNAVAILABLE', error: 'Webhook verification is unavailable' };
  }

  const event = String(payload?.event || '');
  const eventId = String(payload?.eventId || '').trim();
  const deliveredAt = Date.parse(String(deliveryTimestamp || ''));
  if (!UUID_PATTERN.test(eventId)
      || !Number.isFinite(deliveredAt)
      || Math.abs(Number(now) - deliveredAt) > DELIVERY_MAX_AGE_MS
      || !event
      || String(eventHeader || '') !== event) {
    return { ok: false, status: 401, code: 'IDP_WEBHOOK_STALE_OR_MALFORMED', error: 'Webhook delivery is stale or malformed' };
  }

  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, status: 401, code: 'IDP_WEBHOOK_INVALID_SIGNATURE', error: 'Invalid signature' };
  }
  const canonicalBody = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : (typeof rawBody === 'string' ? rawBody : JSON.stringify(payload));
  const supplied = Buffer.from(signature, 'hex');
  const valid = secrets.some((candidate) => {
    const expected = crypto.createHmac('sha256', candidate)
      .update(`${deliveryTimestamp}\n${canonicalBody}`)
      .digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
  return valid
    ? { ok: true }
    : { ok: false, status: 401, code: 'IDP_WEBHOOK_INVALID_SIGNATURE', error: 'Invalid signature' };
}

module.exports = { DELIVERY_MAX_AGE_MS, configuredSecrets, strongSecret, verifyIdpWebhook };
