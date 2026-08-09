const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ShiftTemplateSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    scheduleType: { type: String, enum: ['fixed', 'flexible', 'rotating'], default: 'fixed' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakMinutes: { type: Number, default: 60, min: 0, max: 720 },
    workMode: { type: String, enum: ['office', 'remote', 'client_site', 'other'], default: 'office' },
    locationId: String,
    activityCode: String,
    costCentreCode: String,
    rotation: {
        cycleDays: Number,
        activeDays: [{ type: Number, min: 0, max: 6 }],
    },
    isActive: { type: Boolean, default: true },
    createdBy: String,
    updatedBy: String,
}, { timestamps: true });
ShiftTemplateSchema.index({ organizationId: 1, name: 1 });

const ShiftSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, index: true },
    teamId: { type: String, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'ShiftTemplate' },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    timezone: { type: String, default: 'UTC' },
    breakMinutes: { type: Number, default: 0 },
    workMode: { type: String, enum: ['office', 'remote', 'client_site', 'other'], default: 'office' },
    locationId: String,
    activityCode: String,
    costCentreCode: String,
    status: { type: String, enum: ['draft', 'published', 'cancelled', 'completed'], default: 'draft', index: true },
    publicationVersion: Number,
    openShift: { type: Boolean, default: false, index: true },
    acknowledgement: {
        status: { type: String, enum: ['pending', 'acknowledged', 'declined'], default: 'pending' },
        at: Date,
        note: String,
    },
    createdBy: String,
    updatedBy: String,
    changeHistory: [{
        action: String,
        actorId: String,
        actorName: String,
        at: { type: Date, default: Date.now },
        details: String,
    }],
}, { timestamps: true });
ShiftSchema.index({ organizationId: 1, userId: 1, startAt: 1, endAt: 1 });
ShiftSchema.index({ organizationId: 1, teamId: 1, startAt: 1 });

const AvailabilitySchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    date: { type: Date, required: true },
    available: { type: Boolean, default: true },
    startTime: String,
    endTime: String,
    note: String,
}, { timestamps: true });
AvailabilitySchema.index({ organizationId: 1, userId: 1, date: 1 }, { unique: true });

const ShiftRequestSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    type: { type: String, enum: ['swap', 'cover', 'release'], required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    requestedBy: { type: String, required: true },
    targetUserId: String,
    offeredShiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: String,
    reviewedAt: Date,
    reviewNote: String,
}, { timestamps: true });

const SchedulePublicationSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    version: { type: Number, required: true },
    shiftIds: [{ type: Schema.Types.ObjectId, ref: 'Shift' }],
    publishedBy: String,
    publishedAt: { type: Date, default: Date.now },
    note: String,
}, { timestamps: true });
SchedulePublicationSchema.index({ organizationId: 1, periodStart: 1, periodEnd: 1, version: 1 }, { unique: true });

module.exports = {
    ShiftTemplate: mongoose.model('ShiftTemplate', ShiftTemplateSchema),
    Shift: mongoose.model('Shift', ShiftSchema),
    Availability: mongoose.model('Availability', AvailabilitySchema),
    ShiftRequest: mongoose.model('ShiftRequest', ShiftRequestSchema),
    SchedulePublication: mongoose.model('SchedulePublication', SchedulePublicationSchema),
};
