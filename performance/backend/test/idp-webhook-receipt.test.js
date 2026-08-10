'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  claimIdpWebhookEvent,
  markIdpWebhookProcessed,
  markIdpWebhookFailed
} = require('../services/idpWebhookReceiptService');

function memoryReceiptModel() {
  const records = new Map();
  const matches = (record, query) => {
    if (!record || record.eventId !== query.eventId) return false;
    if (query.payloadHash && record.payloadHash !== query.payloadHash) return false;
    if (query.status && record.status !== query.status) return false;
    if (query.$or) {
      return query.$or.some((condition) => (
        (condition.status === record.status && !condition.leaseExpiresAt)
        || (condition.status === record.status
          && condition.leaseExpiresAt?.$lte
          && record.leaseExpiresAt <= condition.leaseExpiresAt.$lte)
      ));
    }
    return true;
  };
  return {
    records,
    async create(value) {
      if (records.has(value.eventId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      records.set(value.eventId, { ...value });
      return value;
    },
    findOne(query) {
      return { async lean() { return records.get(query.eventId) || null; } };
    },
    async findOneAndUpdate(query, update) {
      const record = records.get(query.eventId);
      if (!matches(record, query)) return null;
      Object.assign(record, update.$set);
      return record;
    },
    async updateOne(query, update) {
      const record = records.get(query.eventId);
      if (!matches(record, query)) return { matchedCount: 0 };
      Object.assign(record, update.$set);
      return { matchedCount: 1 };
    }
  };
}

const payload = {
  eventId: '39fdc60c-6b17-44c3-9e69-048255cd6e4c',
  event: 'organization.member.app_access_changed',
  data: { subject: 'stable-subject', organizationId: 'org-a' }
};

test('a lost response retry is acknowledged without a second revocation claim', async () => {
  const receiptModel = memoryReceiptModel();
  const now = new Date('2026-08-09T12:00:00.000Z');
  const first = await claimIdpWebhookEvent(payload, { receiptModel, now });
  assert.equal(first.claimed, true);
  await markIdpWebhookProcessed(first, { receiptModel, now });

  const retry = await claimIdpWebhookEvent(payload, {
    receiptModel,
    now: new Date(now.getTime() + 1_000)
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.claimed, false);
});

test('an active lease blocks concurrent invalidation and a failed receipt is reclaimable', async () => {
  const receiptModel = memoryReceiptModel();
  const now = new Date('2026-08-09T12:00:00.000Z');
  const first = await claimIdpWebhookEvent(payload, { receiptModel, now });
  const concurrent = await claimIdpWebhookEvent(payload, {
    receiptModel,
    now: new Date(now.getTime() + 1_000)
  });
  assert.equal(concurrent.busy, true);

  await markIdpWebhookFailed(first, new Error('transient'), { receiptModel, now });
  const retry = await claimIdpWebhookEvent(payload, {
    receiptModel,
    now: new Date(now.getTime() + 2_000)
  });
  assert.equal(retry.claimed, true);
});

test('an event id cannot be reused with a different signed payload', async () => {
  const receiptModel = memoryReceiptModel();
  await claimIdpWebhookEvent(payload, { receiptModel });
  await assert.rejects(
    claimIdpWebhookEvent({ ...payload, data: { ...payload.data, organizationId: 'org-b' } }, { receiptModel }),
    (error) => error?.code === 'IDP_EVENT_PAYLOAD_CONFLICT'
  );
});
