'use strict';

const crypto = require('node:crypto');

const DEFAULT_LEASE_MS = 60_000;

function defaultReceiptModel() {
  return require('../models/IdpWebhookReceipt');
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function claimIdpWebhookEvent(payload, { receiptModel, now = new Date(), leaseMs = DEFAULT_LEASE_MS } = {}) {
  const model = receiptModel || defaultReceiptModel();
  const eventId = String(payload?.eventId || '').trim();
  if (!eventId) throw Object.assign(new Error('Webhook eventId is required'), { code: 'IDP_EVENT_ID_REQUIRED' });
  const hash = payloadHash(payload);
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  try {
    await model.create({ eventId, payloadHash: hash, status: 'processing', leaseExpiresAt });
    return { claimed: true, duplicate: false, eventId, payloadHash: hash };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const existing = await model.findOne({ eventId }).lean();
  if (!existing) throw new Error('Webhook receipt claim could not be resolved');
  if (existing.payloadHash !== hash) {
    throw Object.assign(new Error('Webhook eventId was reused with a different payload'), { code: 'IDP_EVENT_PAYLOAD_CONFLICT' });
  }
  if (existing.status === 'processed') {
    return { claimed: false, duplicate: true, eventId, payloadHash: hash };
  }
  const reclaimable = existing.status === 'failed'
    || new Date(existing.leaseExpiresAt).getTime() <= now.getTime();
  if (!reclaimable) return { claimed: false, duplicate: false, busy: true, eventId, payloadHash: hash };
  const reclaimed = await model.findOneAndUpdate({
    eventId,
    payloadHash: hash,
    $or: [
      { status: 'failed' },
      { status: 'processing', leaseExpiresAt: { $lte: now } },
    ],
  }, {
    $set: { status: 'processing', leaseExpiresAt, lastError: '' },
  }, { new: true });
  return reclaimed
    ? { claimed: true, duplicate: false, eventId, payloadHash: hash }
    : { claimed: false, duplicate: false, busy: true, eventId, payloadHash: hash };
}

function markIdpWebhookProcessed(claim, { receiptModel, now = new Date() } = {}) {
  const model = receiptModel || defaultReceiptModel();
  return model.updateOne({ eventId: claim.eventId, payloadHash: claim.payloadHash, status: 'processing' }, {
    $set: { status: 'processed', processedAt: now, leaseExpiresAt: now, lastError: '' },
  });
}

function markIdpWebhookFailed(claim, error, { receiptModel, now = new Date() } = {}) {
  const model = receiptModel || defaultReceiptModel();
  return model.updateOne({ eventId: claim.eventId, payloadHash: claim.payloadHash, status: 'processing' }, {
    $set: {
      status: 'failed',
      leaseExpiresAt: now,
      lastError: String(error?.message || error || 'Webhook processing failed').slice(0, 1000),
    },
  });
}

module.exports = {
  DEFAULT_LEASE_MS,
  payloadHash,
  claimIdpWebhookEvent,
  markIdpWebhookProcessed,
  markIdpWebhookFailed,
};
