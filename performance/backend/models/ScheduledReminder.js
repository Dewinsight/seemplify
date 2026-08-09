const mongoose = require('mongoose');

const scheduledReminderSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, trim: true, index: true },
  userId: { type: String, required: true, trim: true, index: true },
  recipient: {
    name: { type: String, trim: true, maxlength: 160 },
    email: { type: String, trim: true, maxlength: 320 },
    channels: [{ type: String, enum: ['in_app', 'email', 'chat'] }]
  },
  eventType: { type: String, required: true, trim: true, maxlength: 160 },
  target: {
    type: { type: String, required: true, trim: true, maxlength: 80 },
    id: { type: String, required: true, trim: true, maxlength: 240 }
  },
  stage: {
    type: String,
    enum: ['7d', '3d', '1d', 'overdue'],
    required: true
  },
  dueAt: { type: Date, required: true },
  scheduledFor: { type: Date, required: true, index: true },
  notification: {
    category: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    deepLink: { type: String, required: true, trim: true, maxlength: 1000 },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal'
    },
    action: {
      kind: {
        type: String,
        enum: ['open', 'acknowledge', 'review', 'approve', 'complete', 'view'],
        default: 'open'
      },
      label: { type: String, trim: true, maxlength: 80, default: 'Open' }
    }
  },
  status: {
    type: String,
    enum: ['scheduled', 'processing', 'emitted', 'failed', 'dead_letter', 'cancelled'],
    default: 'scheduled',
    index: true
  },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 8, min: 1, max: 30 },
  nextAttemptAt: { type: Date, index: true },
  lease: {
    owner: { type: String, trim: true, maxlength: 240 },
    claimedAt: Date,
    expiresAt: Date
  },
  emittedEventId: { type: String, trim: true, maxlength: 240 },
  emittedAt: Date,
  pause: {
    reason: { type: String, trim: true, maxlength: 160 },
    startAt: Date,
    endAt: Date,
    originalScheduledFor: Date,
    pausedAt: Date,
    resumedAt: Date
  },
  cancelledAt: Date,
  cancellationReason: { type: String, trim: true, maxlength: 160 },
  lastError: {
    code: { type: String, maxlength: 120 },
    message: { type: String, maxlength: 500 },
    at: Date
  }
}, { timestamps: true });

scheduledReminderSchema.index(
  { organizationId: 1, 'target.type': 1, 'target.id': 1, userId: 1, stage: 1, dueAt: 1 },
  { unique: true }
);
scheduledReminderSchema.index({ status: 1, scheduledFor: 1, nextAttemptAt: 1, 'lease.expiresAt': 1 });
scheduledReminderSchema.index({ organizationId: 1, 'target.type': 1, 'target.id': 1, status: 1 });

module.exports = mongoose.models.ScheduledReminder
  || mongoose.model('ScheduledReminder', scheduledReminderSchema);
