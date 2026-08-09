const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DeliverySchema = new Schema({
    channel: { type: String, enum: ['in_app', 'email', 'browser_push'], required: true },
    status: { type: String, enum: ['pending', 'delivered', 'failed', 'skipped'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    deliveredAt: Date,
    lastError: String,
}, { _id: false });

const NotificationSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userEmail: String,
    type: {
        type: String,
        enum: [
            'shift_reminder', 'schedule_changed', 'missed_clocking', 'late_arrival', 'break_prompt',
            'overtime_warning', 'rest_warning', 'timesheet_deadline', 'timesheet_status', 'leave_conflict',
            'payroll_failure', 'presence_mismatch', 'manager_digest', 'general',
        ],
        required: true,
        index: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 1000 },
    actionUrl: String,
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    eventKey: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    deliveries: { type: [DeliverySchema], default: [] },
    readAt: Date,
    dismissedAt: Date,
    expiresAt: Date,
}, { timestamps: true });
NotificationSchema.index({ organizationId: 1, userId: 1, eventKey: 1 }, { unique: true });
NotificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const NotificationPreferenceSchema = new Schema({
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    timezone: { type: String, default: 'UTC' },
    channels: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        browserPush: { type: Boolean, default: false },
    },
    quietHours: {
        enabled: { type: Boolean, default: false },
        start: { type: String, default: '22:00' },
        end: { type: String, default: '07:00' },
        allowUrgent: { type: Boolean, default: true },
    },
    mutedTypes: [String],
}, { timestamps: true });
NotificationPreferenceSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

const BrowserPushSubscriptionSchema = new Schema({
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    endpoint: { type: String, required: true },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    userAgent: String,
    active: { type: Boolean, default: true },
    lastUsedAt: Date,
}, { timestamps: true });
BrowserPushSubscriptionSchema.index({ organizationId: 1, userId: 1, endpoint: 1 }, { unique: true });

module.exports = {
    Notification: mongoose.model('AttendanceNotification', NotificationSchema),
    NotificationPreference: mongoose.model('NotificationPreference', NotificationPreferenceSchema),
    BrowserPushSubscription: mongoose.model('BrowserPushSubscription', BrowserPushSubscriptionSchema),
};
