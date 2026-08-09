const mongoose = require('mongoose');

const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const eventOverrideSchema = new mongoose.Schema({
  eventType: { type: String, required: true, trim: true, maxlength: 160 },
  inApp: { type: Boolean, default: true },
  email: { type: Boolean, default: false },
  chat: { type: Boolean, default: false }
}, { _id: false });

const notificationPreferenceSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, trim: true },
  userId: { type: String, required: true, trim: true },
  channels: {
    // Action Centre records remain enabled so mandatory work cannot disappear.
    inApp: { type: Boolean, default: true, immutable: true },
    email: { type: Boolean, default: false },
    // External chat is always explicit opt-in. The destination is captured
    // from the authenticated identity and is never accepted from request JSON.
    chat: { type: Boolean, default: false }
  },
  chat: {
    recipientEmail: {
      type: String,
      trim: true,
      maxlength: 320,
      select: false
    }
  },
  digest: {
    frequency: {
      type: String,
      enum: ['immediate', 'daily', 'weekly', 'off'],
      default: 'immediate'
    },
    time: {
      type: String,
      default: '09:00',
      validate: { validator: value => HH_MM_PATTERN.test(value), message: 'Digest time must be HH:mm.' }
    },
    dayOfWeek: { type: Number, min: 0, max: 6, default: 1 }
  },
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: {
      type: String,
      default: '22:00',
      validate: { validator: value => HH_MM_PATTERN.test(value), message: 'Quiet-hours start must be HH:mm.' }
    },
    end: {
      type: String,
      default: '07:00',
      validate: { validator: value => HH_MM_PATTERN.test(value), message: 'Quiet-hours end must be HH:mm.' }
    }
  },
  timezone: { type: String, default: 'UTC', trim: true, maxlength: 100 },
  eventOverrides: {
    type: [eventOverrideSchema],
    default: [],
    validate: {
      validator(value) {
        return value.length <= 100
          && new Set(value.map(item => item.eventType)).size === value.length;
      },
      message: 'Event overrides must be unique and limited to 100 entries.'
    }
  }
}, { timestamps: true });

notificationPreferenceSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.NotificationPreference
  || mongoose.model('NotificationPreference', notificationPreferenceSchema);
