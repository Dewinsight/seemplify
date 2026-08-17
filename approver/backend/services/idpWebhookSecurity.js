'use strict';

const crypto = require('node:crypto');
const MAX_AGE_MS = 5 * 60 * 1000;

function configuredSecrets(source = process.env) {
    return [...new Set([
        String(source.IDP_WEBHOOK_SECRET || '').trim(),
        String(source.IDP_WEBHOOK_SECRET_PREVIOUS || '').trim()
    ].filter(Boolean))];
}

function verifyIdpWebhook({ payload, rawBody, eventHeader, deliveryTimestamp, signature, now = Date.now() } = {}) {
    const secrets = configuredSecrets();
    if (secrets.length === 0 || secrets.some((secret) => Buffer.byteLength(secret) < 32)) {
        return { ok: false, status: 503, error: 'Webhook verification unavailable' };
    }
    const deliveredAt = Date.parse(String(deliveryTimestamp || ''));
    const event = String(payload?.event || '');
    const eventId = String(payload?.eventId || '');
    if (!event || !eventId || event !== String(eventHeader || '') || !Number.isFinite(deliveredAt) || Math.abs(now - deliveredAt) > MAX_AGE_MS) {
        return { ok: false, status: 401, error: 'Stale or malformed webhook' };
    }
    if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) {
        return { ok: false, status: 401, error: 'Invalid signature' };
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(payload);
    const supplied = Buffer.from(signature, 'hex');
    const valid = secrets.some((secret) => {
        const expected = crypto.createHmac('sha256', secret).update(`${deliveryTimestamp}\n${body}`).digest();
        return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    });
    return valid ? { ok: true } : { ok: false, status: 401, error: 'Invalid signature' };
}

module.exports = { configuredSecrets, verifyIdpWebhook };
