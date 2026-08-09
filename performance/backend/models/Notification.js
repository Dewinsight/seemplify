const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, trim: true, index: true },
  userId: { type: String, required: true, trim: true, index: true },
  eventId: { type: String, required: true, trim: true, maxlength: 240 },
  eventType: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  deepLink: { type: String, required: true, trim: true, maxlength: 1000 },
  target: {
    type: { type: String, required: true, trim: true, maxlength: 80 },
    id: { type: String, required: true, trim: true, maxlength: 240 }
  },
  isAction: { type: Boolean, default: true, index: true },
  action: {
    kind: {
      type: String,
      enum: ['open', 'acknowledge', 'review', 'approve', 'complete', 'view'],
      default: 'open'
    },
    label: { type: String, trim: true, maxlength: 80, default: 'Open' }
  },
  actionStatus: {
    type: String,
    enum: ['open', 'snoozed', 'completed', 'dismissed'],
    default: 'open',
    index: true
  },
  snoozedUntil: Date,
  dueAt: Date,
  readAt: Date,
  completedAt: Date,
  dismissedAt: Date
}, { timestamps: true });

notificationSchema.index(
  { organizationId: 1, eventId: 1, userId: 1 },
  { unique: true }
);
notificationSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, userId: 1, isAction: 1, actionStatus: 1, dueAt: 1 });
notificationSchema.index({ organizationId: 1, userId: 1, snoozedUntil: 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
