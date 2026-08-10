'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { configuredSecrets, verifyIdpWebhook } = require('../services/idpWebhookSecurity');

const SECRET = 'performance-idp-webhook-test-secret-32-bytes';

function signature(rawBody, deliveryTimestamp, secret = SECRET) {
  return crypto.createHmac('sha256', secret)
    .update(`${deliveryTimestamp}\n${rawBody}`)
    .digest('hex');
}

function verify(payload, deliveryTimestamp, { legacyOnly = false } = {}) {
  const rawBody = JSON.stringify(payload);
  return verifyIdpWebhook({
    payload,
    rawBody,
    eventHeader: payload.event,
    deliveryTimestamp,
    signature: legacyOnly ? undefined : signature(rawBody, deliveryTimestamp),
    secret: SECRET
  });
}

test('a durable retry older than five minutes is accepted when its V2 delivery signature is fresh', () => {
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'organization.member.app_access_changed',
    occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    data: { subject: 'stable-idp-subject', action: 'app_access_changed' }
  };
  assert.equal(verify(payload, new Date().toISOString()).ok, true);
});

test('a stale delivery timestamp and a legacy-only signature are rejected', () => {
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'organization.member.removed',
    occurredAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    data: { subject: 'stable-idp-subject', action: 'removed' }
  };
  const stale = verify(payload, new Date(Date.now() - (5 * 60 * 1000) - 1000).toISOString());
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 401);

  const legacy = verify(payload, new Date().toISOString(), { legacyOnly: true });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.status, 401);
});

test('webhook verification fails closed when the shared secret is missing or weak', () => {
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'organization.member.removed',
    data: { subject: 'stable-idp-subject' }
  };
  const deliveryTimestamp = new Date().toISOString();
  const rawBody = JSON.stringify(payload);
  const result = verifyIdpWebhook({
    payload,
    rawBody,
    eventHeader: payload.event,
    deliveryTimestamp,
    signature: signature(rawBody, deliveryTimestamp),
    secret: 'weak'
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('the receiver accepts a strong previous target key only during rotation', () => {
  const previous = 'performance-previous-webhook-secret-32-bytes';
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'organization.member.role_changed',
    data: { subject: 'stable-idp-subject' }
  };
  const deliveryTimestamp = new Date().toISOString();
  const rawBody = JSON.stringify(payload);
  const secrets = configuredSecrets({
    IDP_WEBHOOK_SECRET: SECRET,
    IDP_WEBHOOK_SECRET_PREVIOUS: previous
  });
  const result = verifyIdpWebhook({
    payload,
    rawBody,
    eventHeader: payload.event,
    deliveryTimestamp,
    signature: signature(rawBody, deliveryTimestamp, previous),
    secret: secrets
  });
  assert.equal(result.ok, true);
  assert.equal(secrets.length, 2);
});

test('Performance rejects a webhook signed with Recruiter target credentials', () => {
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'organization.member.removed',
    data: { subject: 'stable-idp-subject' }
  };
  const deliveryTimestamp = new Date().toISOString();
  const rawBody = JSON.stringify(payload);
  const result = verifyIdpWebhook({
    payload,
    rawBody,
    eventHeader: payload.event,
    deliveryTimestamp,
    signature: signature(rawBody, deliveryTimestamp, 'recruiter-target-secret-32-characters'),
    secret: [SECRET]
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
