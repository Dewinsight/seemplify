const mongoose = require('mongoose');

const retentionDays = Math.max(
  30,
  Number.parseInt(process.env.USER_ACTIVITY_RETENTION_DAYS || '365', 10) || 365
);

const UserActivityEventSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    enum: ['authentication', 'navigation', 'action'],
    required: true,
    index: true
  },
  module: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  method: {
    type: String,
    trim: true
  },
  path: {
    type: String,
    trim: true
  },
  statusCode: Number,
  durationMs: Number,
  ip: {
    type: String,
    trim: true
  },
  userAgent: {
    type: String,
    trim: true
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
  }
}, {
  versionKey: false
});

UserActivityEventSchema.index({ organization: 1, occurredAt: -1 });
UserActivityEventSchema.index({ user: 1, occurredAt: -1 });
UserActivityEventSchema.index({ module: 1, occurredAt: -1 });
UserActivityEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('UserActivityEvent', UserActivityEventSchema);
