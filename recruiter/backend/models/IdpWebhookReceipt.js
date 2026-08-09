'use strict';

const mongoose = require('mongoose');

const IdpWebhookReceiptSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true, maxlength: 100 },
  payloadHash: { type: String, required: true, maxlength: 64 },
  status: {
    type: String,
    enum: ['processing', 'processed', 'failed'],
    default: 'processing',
    index: true
  },
  leaseExpiresAt: { type: Date, required: true, index: true },
  processedAt: { type: Date, default: null },
  lastError: { type: String, default: '', maxlength: 1000 },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60_000),
    index: { expires: 0 }
  }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.IdpWebhookReceipt
  || mongoose.model('IdpWebhookReceipt', IdpWebhookReceiptSchema);
