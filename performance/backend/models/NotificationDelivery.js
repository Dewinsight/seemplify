const mongoose = require('mongoose');

const deliveryAttemptSchema = new mongoose.Schema({
  attempt: { type: Number, required: true, min: 1 },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, required: true },
  outcome: {
    type: String,
    enum: ['delivered', 'failed', 'deferred', 'skipped'],
    required: true
  },
  providerMessageId: { type: String, trim: true, maxlength: 300 },
  error: {
    code: { type: String, maxlength: 120 },
    message: { type: String, maxlength: 500 },
    retryable: Boolean
  }
}, { _id: false });

const notificationDeliverySchema = new mongoose.Schema({
  organizationId: { type: String, required: true, trim: true, index: true },
  userId: { type: String, required: true, trim: true, index: true },
  eventId: { type: String, required: true, trim: true, maxlength: 240 },
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
    required: true
  },
  channel: {
    type: String,
    enum: ['in_app', 'email', 'chat'],
    required: true
  },
  // Stable business key: event:user:channel. The mail transport receives this
  // exact key for immediate sends, preventing duplicates across worker retries.
  idempotencyKey: { type: String, required: true, unique: true, trim: true, maxlength: 700 },
  destination: { type: String, trim: true, maxlength: 320 },
  deliveryMode: {
    type: String,
    enum: ['immediate', 'digest'],
    default: 'immediate'
  },
  digest: {
    frequency: { type: String, enum: ['daily', 'weekly'] },
    bucketKey: { type: String, trim: true, maxlength: 160 }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'deferred', 'delivered', 'skipped', 'failed', 'dead_letter', 'cancelled'],
    default: 'pending',
    index: true
  },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  attemptCount: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 8, min: 1, max: 30 },
  lease: {
    owner: { type: String, trim: true, maxlength: 240 },
    claimedAt: Date,
    expiresAt: Date
  },
  providerMessageId: { type: String, trim: true, maxlength: 300 },
  deliveredAt: Date,
  skippedAt: Date,
  cancelledAt: Date,
  lastError: {
    code: { type: String, maxlength: 120 },
    message: { type: String, maxlength: 500 },
    retryable: Boolean,
    at: Date
  },
  attempts: { type: [deliveryAttemptSchema], default: [] }
}, { timestamps: true });

notificationDeliverySchema.index({ status: 1, deliveryMode: 1, nextAttemptAt: 1, 'lease.expiresAt': 1 });
notificationDeliverySchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
notificationDeliverySchema.index({ organizationId: 1, userId: 1, 'digest.bucketKey': 1, status: 1 });

module.exports = mongoose.models.NotificationDelivery
  || mongoose.model('NotificationDelivery', notificationDeliverySchema);
