const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CorrectionRunSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    type: { type: String, enum: ['rule_change', 'leave_change', 'manual'], required: true },
    reason: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    rulePackId: String,
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', index: true },
    initiatedBy: { userId: String, userName: String },
    counts: { scanned: { type: Number, default: 0 }, created: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    failures: [{ timesheetId: String, error: String }],
    startedAt: Date,
    completedAt: Date,
}, { timestamps: true });

CorrectionRunSchema.index({ organizationId: 1, createdAt: -1 });
module.exports = mongoose.model('CorrectionRun', CorrectionRunSchema);
