const mongoose = require('mongoose');

const ClockReminderLogSchema = new mongoose.Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, required: true },
    localDate: { type: String, required: true, index: true },
    reminderType: { type: String, enum: ['clock_in', 'clock_out'], required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    messageId: String,
    lastError: String,
    sentAt: Date,
}, { timestamps: true });

ClockReminderLogSchema.index(
    { organizationId: 1, userId: 1, localDate: 1, reminderType: 1 },
    { unique: true }
);

module.exports = mongoose.model('ClockReminderLog', ClockReminderLogSchema);
