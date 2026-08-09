const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PublicHolidaySnapshotSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    externalHolidayId: { type: String, required: true },
    name: String,
    date: { type: Date, required: true, index: true },
    isRecurring: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    sourceUpdatedAt: Date,
    lastSyncedAt: Date,
}, { timestamps: true });
PublicHolidaySnapshotSchema.index({ organizationId: 1, externalHolidayId: 1 }, { unique: true });

module.exports = mongoose.model('PublicHolidaySnapshot', PublicHolidaySnapshotSchema);
