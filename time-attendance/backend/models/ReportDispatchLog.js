const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Tracks manager team report dispatches to prevent duplicate sends for the same period.
 */
const ReportDispatchLogSchema = new Schema({
    organizationId: {
        type: String,
        required: true,
        index: true,
    },
    organizationName: String,
    frequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        required: true,
        index: true,
    },
    periodKey: {
        type: String,
        required: true,
        index: true,
    },
    periodStart: {
        type: Date,
        required: true,
    },
    periodEnd: {
        type: Date,
        required: true,
    },
    managerUserId: {
        type: String,
        index: true,
    },
    managerName: String,
    managerEmail: {
        type: String,
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['sent', 'failed', 'skipped'],
        default: 'sent',
        index: true,
    },
    details: String,
    sentAt: {
        type: Date,
        default: Date.now,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

ReportDispatchLogSchema.index(
    { organizationId: 1, frequency: 1, periodKey: 1, managerEmail: 1 },
    { unique: true }
);

ReportDispatchLogSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('ReportDispatchLog', ReportDispatchLogSchema);
