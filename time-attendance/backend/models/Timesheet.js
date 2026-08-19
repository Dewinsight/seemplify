const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Timesheet Model
 * 
 * Aggregated view of time entries for a period (weekly/bi-weekly/monthly).
 * Used for approval workflow and reporting.
 */

// Location schema for clock-in/out geolocation
const LocationSchema = new Schema({
    latitude: Number,
    longitude: Number,
    address: String,         // Short address (e.g., "123 Main St, Downtown")
    area: String,            // Suburb/neighbourhood
    city: String,            // City/town
    state: String,           // State/region
    country: String,         // Country
    displayName: String,     // Full address from geocoding
    accuracy: Number,        // GPS accuracy in meters
    verified: {
        type: Boolean,
        default: false
    },
}, { _id: false });

// Daily entry within a timesheet
const DailyEntrySchema = new Schema({
    date: {
        type: Date,
        required: true
    },
    dayOfWeek: {
        type: Number  // 0-6 (Sunday-Saturday)
    },
    clockIn: Date,
    clockOut: Date,
    // Geolocation data for clock-in/out
    clockInLocation: LocationSchema,
    clockOutLocation: LocationSchema,
    breakDuration: {
        type: Number,
        default: 0  // in minutes
    },
    totalMinutes: {
        type: Number,
        default: 0
    },
    totalHours: {
        type: Number,
        default: 0
    },
    regularHours: {
        type: Number,
        default: 0
    },
    overtimeHours: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['present', 'absent', 'leave', 'holiday', 'weekend', 'partial'],
        default: 'absent',
    },
    exceptions: [{
        type: {
            type: String,
            enum: [
                'late_arrival', 'early_departure', 'long_break', 'no_clock_out', 'manual_entry',
                'missed_break', 'missed_break_end', 'orphan_break_end', 'orphan_event',
                'duplicate_session', 'overtime', 'insufficient_rest', 'geofence_failure',
                'absence', 'leave_conflict',
            ],
        },
        description: String,
        minutes: Number,  // Duration of exception (e.g., 15 mins late)
    }],
    notes: String,
    timeEntryIds: [{
        type: Schema.Types.ObjectId,
        ref: 'TimeEntry'
    }],
    sessions: [{
        clockIn: Date,
        clockOut: Date,
        breakMinutes: { type: Number, default: 0 },
        totalMinutes: { type: Number, default: 0 },
    }],
}, { _id: false });

// Summary of the timesheet period
const TimesheetSummarySchema = new Schema({
    totalHours: { type: Number, default: 0 },
    regularHours: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    breakTime: { type: Number, default: 0 },  // in minutes
    daysWorked: { type: Number, default: 0 },
    daysAbsent: { type: Number, default: 0 },
    daysOnLeave: { type: Number, default: 0 },
    lateDays: { type: Number, default: 0 },
    earlyDepartures: { type: Number, default: 0 },
    incompleteEntries: { type: Number, default: 0 },
}, { _id: false });

// Audit log entry
const AuditLogSchema = new Schema({
    action: {
        type: String,
        enum: [
            'created', 'submitted', 'approved', 'rejected', 'revision_requested', 'updated', 'recalled',
            'reminder_sent', 'locked', 'payroll_queued', 'payroll_exported', 'payroll_failed',
            'adjustment_created', 'adjustment_approved', 'auto_submitted', 'auto_approved',
            'integration_retried', 'attendance_event_appended', 'cancelled',
            'payroll_skipped',
        ],
        required: true,
    },
    performedBy: String,  // userId
    performedByName: String,
    performedAt: { type: Date, default: Date.now },
    details: String,
    comment: String,
}, { _id: false });

const ApprovalLevelSnapshotSchema = new Schema({
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

const TimesheetSchema = new Schema({
    // User Identification (from IdP)
    userId: {
        type: String,
        required: true,
        index: true
    },
    userEmail: {
        type: String,
        required: true
    },
    userName: {
        type: String
    },

    // Organization (from IdP)
    organizationId: {
        type: String,
        required: true,
        index: true
    },
    organizationName: {
        type: String
    },

    // Team (from IdP)
    teamId: {
        type: String
    },
    teamName: {
        type: String
    },

    // Period
    periodType: {
        type: String,
        enum: ['daily', 'weekly', 'fortnightly', 'bi-weekly', 'semi-monthly', 'monthly'],
        default: 'weekly'
    },
    periodKey: {
        type: String,
        index: true,
    },
    startDate: {
        type: Date,
        required: true,
        index: true,
    },
    endDate: {
        type: Date,
        required: true
    },

    // Week/Year identifiers for easy querying
    weekNumber: Number,  // ISO week number (1-53)
    year: Number,

    // Daily entries
    dailyEntries: [DailyEntrySchema],

    // Summary
    summary: TimesheetSummarySchema,

    // Status and Workflow
    status: {
        type: String,
        enum: [
            'draft', 'submitted', 'approved', 'rejected', 'revision_requested',
            'locked', 'payroll_pending', 'payroll_exported', 'adjusted', 'cancelled',
        ],
        default: 'draft',
        index: true,
    },

    // Submission
    submittedAt: Date,
    submittedNote: String,

    // Assigned approver (line manager from team hierarchy)
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
        levels: { type: [ApprovalLevelSnapshotSchema], default: () => [] },
        completedAt: Date,
    },

    // Approval
    approvedBy: {
        userId: String,
        userName: String,
        userEmail: String,
        approvedAt: Date,
        comment: String,
    },

    // Rejection
    rejectedBy: {
        userId: String,
        userName: String,
        userEmail: String,
        rejectedAt: Date,
        reason: String,
    },

    // Revision request
    revisionRequestedBy: {
        userId: String,
        userName: String,
        requestedAt: Date,
        reason: String,
    },

    // Audit trail
    auditLog: [AuditLogSchema],

    version: { type: Number, default: 1, min: 1 },
    supersedesTimesheetId: { type: Schema.Types.ObjectId, ref: 'Timesheet' },
    adjustmentReason: String,
    correctionRunId: { type: Schema.Types.ObjectId, ref: 'CorrectionRun', index: true },
    lockedAt: Date,
    lockedBy: String,
    employeeAttestation: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        statementVersion: String,
    },
    policySnapshot: {
        rulePackId: String,
        rulePackVersion: Number,
        appliedRulePacks: [{
            id: String,
            key: String,
            version: Number,
            precedence: Number,
        }],
        timezone: { type: String, default: 'UTC' },
        standardHoursPerDay: Number,
        standardHoursPerWeek: Number,
        dailyOvertimeThreshold: Number,
        weeklyOvertimeThreshold: Number,
        calculatedAt: Date,
    },

    // Linked to payroll (future integration)
    payrollIntegration: {
        exported: { type: Boolean, default: false },
        exportedAt: Date,
        payrollRunId: String,
        state: {
            type: String,
            enum: ['not_ready', 'pending', 'accepted', 'failed', 'dead', 'adjustment_pending', 'no_data'],
            default: 'not_ready',
        },
        idempotencyKey: String,
        attempts: { type: Number, default: 0 },
        lastAttemptAt: Date,
        nextAttemptAt: Date,
        lastError: String,
        acceptedAt: Date,
    },

    // Metadata
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
}, {
    timestamps: true,
});

// Compound indexes
TimesheetSchema.index({ userId: 1, organizationId: 1, startDate: -1 });
TimesheetSchema.index({ organizationId: 1, status: 1, submittedAt: -1 });
TimesheetSchema.index({ 'assignedApprover.userId': 1, status: 1 });
TimesheetSchema.index({ year: 1, weekNumber: 1, organizationId: 1 });
TimesheetSchema.index({ userId: 1, organizationId: 1, periodKey: 1, version: -1 });

// Pre-save middleware
TimesheetSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Instance method to add audit log
TimesheetSchema.methods.addAuditLog = function (action, performedBy, performedByName, comment = null, details = null) {
    this.auditLog.push({
        action,
        performedBy,
        performedByName,
        performedAt: new Date(),
        comment,
        details,
    });
};

// Instance method to calculate summary from daily entries
TimesheetSchema.methods.calculateSummary = function () {
    let totalHours = 0;
    let regularHours = 0;
    let overtimeHours = 0;
    let breakTime = 0;
    let daysWorked = 0;
    let daysAbsent = 0;
    let daysOnLeave = 0;
    let lateDays = 0;
    let earlyDepartures = 0;
    let incompleteEntries = 0;

    for (const entry of this.dailyEntries) {
        totalHours += entry.totalHours || 0;
        regularHours += entry.regularHours || 0;
        overtimeHours += entry.overtimeHours || 0;
        breakTime += entry.breakDuration || 0;

        switch (entry.status) {
            case 'present':
                daysWorked++;
                break;
            case 'partial':
                daysWorked += 0.5;
                break;
            case 'absent':
                daysAbsent++;
                break;
            case 'leave':
                daysOnLeave++;
                break;
        }

        // Count exceptions
        for (const exception of (entry.exceptions || [])) {
            if (exception.type === 'late_arrival') lateDays++;
            if (exception.type === 'early_departure') earlyDepartures++;
            if (exception.type === 'no_clock_out') incompleteEntries++;
        }
    }

    this.summary = {
        totalHours,
        regularHours,
        overtimeHours,
        breakTime,
        daysWorked,
        daysAbsent,
        daysOnLeave,
        lateDays,
        earlyDepartures,
        incompleteEntries,
    };

    return this.summary;
};

// Static method to find or create current week timesheet
TimesheetSchema.statics.findOrCreateCurrentPeriod = async function (userId, organizationId, userInfo, policy = {}) {
    const { getPeriodBounds, enumerateLocalDates } = require('../services/timeCalculationService');
    const period = getPeriodBounds(
        new Date(),
        policy.timesheetSettings?.periodType || 'weekly',
        policy.timezone || userInfo.timezone || 'UTC'
    );

    let timesheet = await this.findOne({
        userId,
        organizationId,
        periodKey: period.key,
        status: { $ne: 'cancelled' },
    }).sort({ version: -1 });

    // Compatibility with records created before periodKey existed.
    if (!timesheet) {
        timesheet = await this.findOne({
            userId,
            organizationId,
            startDate: period.start,
            status: { $ne: 'cancelled' },
        }).sort({ version: -1 });
    }

    if (!timesheet) {
        const workDays = policy.workSchedule?.workDays || [1, 2, 3, 4, 5];
        const dailyEntries = enumerateLocalDates(period.start, period.end, policy.timezone || 'UTC').map(date => ({
            date,
            dayOfWeek: date.getUTCDay(),
            status: workDays.includes(date.getUTCDay()) ? 'absent' : 'weekend',
        }));

        timesheet = new this({
            userId,
            userEmail: userInfo.email,
            userName: userInfo.name,
            organizationId,
            organizationName: userInfo.organizationName,
            teamId: userInfo.teamId,
            teamName: userInfo.teamName,
            periodType: period.periodType,
            periodKey: period.key,
            startDate: period.start,
            endDate: period.end,
            weekNumber: period.weekNumber,
            year: period.year,
            dailyEntries,
            summary: {},
        });

        timesheet.addAuditLog('created', userId, userInfo.name, null, `Auto-created for current ${period.periodType} period`);
        await timesheet.save();
    }

    return timesheet;
};

TimesheetSchema.statics.findOrCreateCurrentWeek = function (userId, organizationId, userInfo, policy = {}) {
    return this.findOrCreateCurrentPeriod(userId, organizationId, userInfo, policy);
};

// Static method to get pending approvals for a manager
TimesheetSchema.statics.getPendingApprovals = async function (approverId, organizationId) {
    return this.find({
        organizationId,
        status: 'submitted',
        'assignedApprover.userId': approverId,
    }).sort({ submittedAt: -1 });
};

module.exports = mongoose.model('Timesheet', TimesheetSchema);
