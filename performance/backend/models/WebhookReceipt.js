const mongoose = require('mongoose');

const webhookReceiptSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  event: { type: String, required: true },
  organizationId: { type: String, index: true },
  subjectId: String,
  payloadHash: { type: String, required: true },
  status: {
    type: String,
    enum: ['processing', 'processed', 'failed'],
    default: 'processing'
  },
  attempts: { type: Number, default: 1 },
  lastError: String,
  processedAt: Date
}, { timestamps: true });

webhookReceiptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.models.WebhookReceipt || mongoose.model('WebhookReceipt', webhookReceiptSchema);
