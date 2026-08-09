const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LeaveSnapshotSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    externalLeaveId: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    type: String,
    status: { type: String, enum: ['approved', 'cancelled'], required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: true },
    sourceUpdatedAt: Date,
    lastSyncedAt: { type: Date, default: Date.now },
}, { timestamps: true });
LeaveSnapshotSchema.index({ organizationId: 1, externalLeaveId: 1 }, { unique: true });
LeaveSnapshotSchema.index({ organizationId: 1, userId: 1, startAt: 1, endAt: 1 });

module.exports = mongoose.model('LeaveSnapshot', LeaveSnapshotSchema);
