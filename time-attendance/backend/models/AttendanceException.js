const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AttendanceExceptionSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userEmail: String,
    userName: String,
    timesheetId: { type: Schema.Types.ObjectId, ref: 'Timesheet', required: true, index: true },
    timesheetVersion: { type: Number, required: true },
    occurrenceDate: { type: Date, required: true, index: true },
    type: { type: String, required: true, index: true },
    ruleKey: { type: String, required: true },
    description: String,
    minutes: Number,
    explanation: String,
    source: { type: String, enum: ['system', 'manager', 'employee'], default: 'system', index: true },
    approvalBlocking: { type: Boolean, default: false, index: true },
    raisedBy: {
        userId: String,
        userName: String,
        userEmail: String,
        raisedAt: Date,
    },
    calculation: Schema.Types.Mixed,
    rulePack: { id: String, version: Number },
    fingerprint: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['open', 'correction_requested', 'resolved', 'dismissed'], default: 'open', index: true },
    correctionRequest: {
        explanation: String,
        requestedAt: Date,
        evidence: [{ name: String, url: String, note: String }],
        requestedChanges: Schema.Types.Mixed,
        reviewedBy: String,
        reviewedAt: Date,
        decision: { type: String, enum: ['pending', 'accepted', 'rejected'] },
        reviewNote: String,
    },
    auditLog: [{ action: String, actorId: String, actorName: String, at: { type: Date, default: Date.now }, details: String }],
}, { timestamps: true });
AttendanceExceptionSchema.index({ organizationId: 1, status: 1, occurrenceDate: -1 });
AttendanceExceptionSchema.index({ organizationId: 1, userId: 1, occurrenceDate: -1 });

module.exports = mongoose.model('AttendanceException', AttendanceExceptionSchema);
