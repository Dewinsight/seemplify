const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RulePackRulesSchema = new Schema({
    work: {
        standardHoursPerDay: { type: Number, min: 0, max: 24 },
        standardHoursPerWeek: { type: Number, min: 0, max: 168 },
        maximumHoursPerWeek: { type: Number, min: 0, max: 168 },
        workDays: [{ type: Number, min: 0, max: 6 }],
        defaultStartTime: String,
        defaultEndTime: String,
    },
    breaks: {
        requiredAfterMinutes: { type: Number, min: 0 },
        minimumBreakMinutes: { type: Number, min: 0 },
        paid: { type: Boolean, default: false },
    },
    rest: {
        minimumDailyRestMinutes: { type: Number, min: 0 },
        minimumWeeklyRestMinutes: { type: Number, min: 0 },
    },
    overtime: {
        enabled: { type: Boolean, default: true },
        dailyThresholdHours: { type: Number, min: 0, max: 24 },
        weeklyThresholdHours: { type: Number, min: 0, max: 168 },
        multiplier: { type: Number, min: 0 },
        requiresApproval: { type: Boolean, default: true },
    },
    nightWork: {
        startTime: String,
        endTime: String,
        maximumAverageHours: Number,
    },
    rounding: {
        enabled: { type: Boolean, default: false },
        incrementMinutes: { type: Number, min: 1, max: 60 },
        mode: { type: String, enum: ['nearest', 'up', 'down'] },
    },
    retention: {
        attendanceDays: { type: Number, min: 1 },
        presenceEventDays: { type: Number, min: 1, max: 90 },
    },
    exceptions: {
        lateGraceMinutes: { type: Number, min: 0 },
        earlyDepartureGraceMinutes: { type: Number, min: 0 },
        longBreakAfterMinutes: { type: Number, min: 0 },
    },
}, { _id: false });

const AttendanceRulePackSchema = new Schema({
    key: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    version: { type: Number, required: true, default: 1, min: 1 },
    status: {
        type: String,
        enum: ['draft', 'validated', 'published', 'retired', 'superseded'],
        default: 'draft',
        index: true,
    },
    jurisdiction: {
        kind: { type: String, enum: ['global', 'regional', 'country', 'subdivision'], required: true },
        regionCode: String,
        countryCode: { type: String, uppercase: true, trim: true },
        subdivisionCode: { type: String, uppercase: true, trim: true },
    },
    scope: {
        organizationId: { type: String, index: true },
        locationId: String,
        teamId: String,
        userId: String,
    },
    parent: {
        key: String,
        version: Number,
    },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    effectiveTo: Date,
    rules: { type: RulePackRulesSchema, default: {} },
    sources: [{
        title: { type: String, required: true },
        url: String,
        accessedAt: Date,
        note: String,
    }],
    reviewRequired: { type: Boolean, default: true },
    lastReviewedAt: Date,
    reviewedBy: String,
    approvedAt: Date,
    approvedBy: String,
    changeNotes: String,
    createdBy: String,
    updatedBy: String,
}, { timestamps: true });

AttendanceRulePackSchema.index({ key: 1, version: 1 }, { unique: true });
AttendanceRulePackSchema.index({ 'jurisdiction.countryCode': 1, status: 1, effectiveFrom: -1 });
AttendanceRulePackSchema.index({ 'scope.organizationId': 1, status: 1, effectiveFrom: -1 });

module.exports = mongoose.model('AttendanceRulePack', AttendanceRulePackSchema);
