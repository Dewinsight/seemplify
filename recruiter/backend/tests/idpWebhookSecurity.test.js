'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  resolveIdpWebhookSecret,
  resolveIdpWebhookSecrets,
  verifyIdpWebhook
} = require('../services/idpWebhookSecurity');

const SECRET = 'rotated-idp-webhook-secret-32-characters';

function signed(payload, deliveryTimestamp, secret = SECRET) {
  return crypto.createHmac('sha256', secret)
    .update(`${deliveryTimestamp}\n${JSON.stringify(payload)}`)
    .digest('hex');
}

test('IDP webhook verification is timing-safe, signed, and freshness-bound', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  const payload = {
    eventId: '19fdc60c-6b17-44c3-9e69-048255cd6e4c',
    event: 'organization.member.app_access_changed',
    occurredAt: new Date(now).toISOString(),
    timestamp: new Date(now).toISOString(),
    data: { userId: 'stable-subject', organizationId: 'org-a' }
  };
  const deliveryTimestamp = new Date(now).toISOString();
  assert.equal(verifyIdpWebhook({ payload, deliveryTimestamp, signature: signed(payload, deliveryTimestamp), secret: SECRET, now }).ok, true);
  assert.equal(verifyIdpWebhook({ payload, deliveryTimestamp, signature: signed(payload, deliveryTimestamp, 'wrong-secret-32-characters-long!!'), secret: SECRET, now }).ok, false);
  assert.equal(verifyIdpWebhook({ payload, deliveryTimestamp, signature: signed(payload, deliveryTimestamp), secret: SECRET, now: now + 6 * 60_000 }).code, 'IDP_WEBHOOK_STALE_OR_MALFORMED');
});

test('a delayed durable event is accepted when the retry attempt is freshly signed', () => {
  const occurredAt = '2026-08-09T10:00:00.000Z';
  const deliveryTimestamp = '2026-08-09T12:00:00.000Z';
  const payload = {
    eventId: '29fdc60c-6b17-44c3-9e69-048255cd6e4c',
    event: 'organization.member.removed',
    occurredAt,
    timestamp: occurredAt,
    data: { userId: 'stable-subject', organizationId: 'org-a' }
  };
  assert.equal(verifyIdpWebhook({
    payload,
    deliveryTimestamp,
    signature: signed(payload, deliveryTimestamp),
    secret: SECRET,
    now: Date.parse(deliveryTimestamp)
  }).ok, true);
});

test('production refuses missing, known-default, and weak webhook secrets', () => {
  assert.throws(() => resolveIdpWebhookSecret({ NODE_ENV: 'production' }));
  assert.throws(() => resolveIdpWebhookSecret({ NODE_ENV: 'production', IDP_WEBHOOK_SECRET: 'your-webhook-secret-key' }));
  assert.throws(() => resolveIdpWebhookSecret({ NODE_ENV: 'production', IDP_WEBHOOK_SECRET: 'too-short' }));
  assert.equal(resolveIdpWebhookSecret({ NODE_ENV: 'production', IDP_WEBHOOK_SECRET: SECRET }), SECRET);
});

test('a bounded rotation window accepts the current and previous target keys', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  const previous = 'previous-idp-webhook-secret-32-characters';
  const payload = {
    eventId: '39fdc60c-6b17-44c3-9e69-048255cd6e4c',
    event: 'organization.member.role_changed',
    data: { subject: 'stable-subject' }
  };
  const deliveryTimestamp = new Date(now).toISOString();
  const secrets = resolveIdpWebhookSecrets({
    NODE_ENV: 'production',
    IDP_WEBHOOK_SECRET: SECRET,
    IDP_WEBHOOK_SECRET_PREVIOUS: previous
  });
  assert.equal(verifyIdpWebhook({
    payload,
    deliveryTimestamp,
    signature: signed(payload, deliveryTimestamp, previous),
    secret: secrets,
    now
  }).ok, true);
  assert.notEqual(secrets[0], secrets[1]);
});

test('Recruiter rejects a webhook signed with another product target key', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  const payload = {
    eventId: '49fdc60c-6b17-44c3-9e69-048255cd6e4c',
    event: 'organization.member.removed',
    data: { subject: 'stable-subject' }
  };
  const deliveryTimestamp = new Date(now).toISOString();
  const performanceTargetSecret = 'performance-target-secret-32-characters';
  assert.equal(verifyIdpWebhook({
    payload,
    deliveryTimestamp,
    signature: signed(payload, deliveryTimestamp, performanceTargetSecret),
    secret: [SECRET],
    now
  }).ok, false);
});
