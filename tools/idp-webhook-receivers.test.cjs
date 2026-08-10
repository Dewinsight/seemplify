'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const TARGET_SECRET = 'target-specific-webhook-secret-at-least-32-bytes';
const OTHER_SECRET = 'another-product-webhook-secret-at-least-32-bytes';
const NOW = Date.parse('2026-08-09T12:00:00.000Z');

function payload() {
  return {
    eventId: '12dba6e0-46f5-4a34-9db3-6c93dc4fbb5e',
    event: 'organization.member.app_access_changed',
    data: { subject: 'oidc-subject-1' },
    occurredAt: '2026-08-09T11:59:58.000Z',
  };
}

function signature(rawBody, timestamp, secret = TARGET_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${rawBody}`).digest('hex');
}

for (const [name, security, receipts] of [
  [
    'Leave',
    require('../leave-management/backend/services/idpWebhookSecurity'),
    require('../leave-management/backend/services/idpWebhookReceiptService'),
  ],
  [
    'Payroll',
    require('../payroll/backend/services/idpWebhookSecurity'),
    require('../payroll/backend/services/idpWebhookReceiptService'),
  ],
]) {
  test(`${name} accepts only a fresh target-bound V2 webhook signature`, () => {
    const body = payload();
    const rawBody = JSON.stringify(body);
    const timestamp = new Date(NOW).toISOString();
    assert.equal(security.verifyIdpWebhook({
      payload: body,
      rawBody,
      eventHeader: body.event,
      deliveryTimestamp: timestamp,
      signature: signature(rawBody, timestamp),
      secret: TARGET_SECRET,
      now: NOW,
    }).ok, true);
    assert.equal(security.verifyIdpWebhook({
      payload: body,
      rawBody,
      eventHeader: body.event,
      deliveryTimestamp: timestamp,
      signature: signature(rawBody, timestamp, OTHER_SECRET),
      secret: TARGET_SECRET,
      now: NOW,
    }).ok, false);
    assert.equal(security.verifyIdpWebhook({
      payload: body,
      rawBody,
      eventHeader: body.event,
      deliveryTimestamp: new Date(NOW - 10 * 60_000).toISOString(),
      signature: '0'.repeat(64),
      secret: TARGET_SECRET,
      now: NOW,
    }).code, 'IDP_WEBHOOK_STALE_OR_MALFORMED');
    assert.equal(security.verifyIdpWebhook({
      payload: body,
      rawBody,
      eventHeader: body.event,
      deliveryTimestamp: timestamp,
      signature: undefined,
      secret: TARGET_SECRET,
      now: NOW,
    }).ok, false);
  });

  test(`${name} receipts make a delivered event idempotent and reject payload reuse`, async () => {
    const rows = new Map();
    const model = {
      async create(row) {
        if (rows.has(row.eventId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        rows.set(row.eventId, { ...row });
      },
      findOne(query) {
        return { lean: async () => rows.get(query.eventId) || null };
      },
      async findOneAndUpdate(query, update) {
        const row = rows.get(query.eventId);
        if (!row) return null;
        Object.assign(row, update.$set);
        return row;
      },
      async updateOne(query, update) {
        const row = rows.get(query.eventId);
        if (row && row.payloadHash === query.payloadHash && row.status === query.status) Object.assign(row, update.$set);
        return { acknowledged: true };
      },
    };
    const body = payload();
    const first = await receipts.claimIdpWebhookEvent(body, { receiptModel: model });
    assert.equal(first.claimed, true);
    await receipts.markIdpWebhookProcessed(first, { receiptModel: model });
    const replay = await receipts.claimIdpWebhookEvent(body, { receiptModel: model });
    assert.equal(replay.duplicate, true);
    await assert.rejects(
      receipts.claimIdpWebhookEvent({ ...body, data: { subject: 'different' } }, { receiptModel: model }),
      /different payload/,
    );
  });
}

for (const [name, sessions] of [
  ['Leave', require('../leave-management/backend/services/sessionStore')],
  ['Payroll', require('../payroll/backend/services/sessionStore')],
]) {
  test(`${name} invalidates serialized connect-mongo sessions by stable subject`, async () => {
    let receivedFilter;
    sessions.initSessionStore({
      collection: {
        async deleteMany(filter) {
          receivedFilter = filter;
          return { deletedCount: 2 };
        },
      },
    });
    assert.equal(await sessions.invalidateUserSessions('idp.subject+1'), 2);
    const serializedRule = receivedFilter.$or.find(rule => rule.session?.$regex)?.session.$regex;
    assert.ok(serializedRule.test('{"user":{"sub":"idp.subject+1"}}'));
    assert.equal(serializedRule.test('{"user":{"sub":"another-subject"}}'), false);
  });
}
