const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const BackgroundJobSchema = new Schema({
    type: {
        type: String,
        required: true,
        enum: [
            'auto_clock_out', 'timesheet_reminders', 'manager_reports', 'timesheet_automation',
            'payroll_transfer', 'notification_delivery', 'webhook_delivery', 'roster_reconciliation',
            'leave_reconciliation', 'presence_cleanup', 'scheduled_report', 'exit_effective_action',
        ],
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'dead'],
        default: 'pending',
        index: true,
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    runAt: { type: Date, default: Date.now, index: true },
    repeatEveryMs: { type: Number, min: 1000 },
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    leaseOwner: String,
    leaseUntil: Date,
    lastStartedAt: Date,
    lastCompletedAt: Date,
    lastError: String,
    result: Schema.Types.Mixed,
}, { timestamps: true });

BackgroundJobSchema.index({ status: 1, runAt: 1, leaseUntil: 1 });

module.exports = mongoose.model('BackgroundJob', BackgroundJobSchema);
