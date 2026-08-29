const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ShiftTemplateSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    scheduleType: { type: String, enum: ['fixed', 'flexible', 'rotating'], default: 'fixed' },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    breakMinutes: { type: Number, default: 60, min: 0, max: 720 },
    workMode: { type: String, enum: ['office', 'remote', 'client_site', 'other'], default: 'office' },
    locationId: String,
    activityCode: String,
    costCentreCode: String,
    rotation: {
        cycleDays: { type: Number, min: 1, max: 365 },
        activeDays: [{ type: Number, min: 0, max: 364 }],
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
    breakMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    workMode: { type: String, enum: ['office', 'remote', 'client_site', 'other'], default: 'office' },
    locationId: String,
    activityCode: String,
    costCentreCode: String,
    status: { type: String, enum: ['draft', 'published', 'cancelled', 'completed'], default: 'draft', index: true },
    publicationVersion: Number,
    openShift: { type: Boolean, default: false, index: true },
    generationKey: { type: String, unique: true, sparse: true },
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

const RequestApprovalLevelSchema = new Schema({
    order: { type: Number, required: true },
    name: { type: String, required: true },
    approverType: { type: String, enum: ['line_manager', 'department_head', 'hr', 'explicit'], required: true },
    approverId: String,
    approverName: String,
    approverEmail: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    decidedBy: String,
    decidedByName: String,
    decidedAt: Date,
    comment: String,
}, { _id: false });

const ShiftRequestSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    type: { type: String, enum: ['swap', 'cover', 'release'], required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    requestedBy: { type: String, required: true },
    subjectUserId: String,
    targetUserId: String,
    offeredShiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    reason: String,
    status: { type: String, enum: ['pending_target', 'pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    targetResponse: {
        status: { type: String, enum: ['not_required', 'pending', 'accepted', 'rejected'], default: 'not_required' },
        respondedAt: Date,
        note: String,
    },
    assignedApprover: {
        userId: String,
        userName: String,
        userEmail: String,
        teamId: String,
        assignedAt: Date,
    },
    approvalWorkflow: {
        mode: { type: String, enum: ['single', 'multi'], default: 'single' },
        currentLevel: { type: Number, default: 0 },
        levels: { type: [RequestApprovalLevelSchema], default: () => [] },
        completedAt: Date,
    },
    requestPolicySnapshot: {
        approvalRequired: Boolean,
        approvalMode: { type: String, enum: ['single', 'multi'] },
        approvalLevels: [{
            name: String,
            approverType: String,
            approverId: String,
            approverName: String,
            approverEmail: String,
        }],
    },
    reviewedBy: String,
    reviewedAt: Date,
    reviewNote: String,
    changeHistory: [{
        action: String,
        actorId: String,
        actorName: String,
        at: { type: Date, default: Date.now },
        details: String,
    }],
}, { timestamps: true, optimisticConcurrency: true });
ShiftRequestSchema.index({ organizationId: 1, subjectUserId: 1, status: 1, createdAt: -1 });
ShiftRequestSchema.index({ organizationId: 1, targetUserId: 1, status: 1, createdAt: -1 });

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
