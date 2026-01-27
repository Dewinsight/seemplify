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
    address: String,
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
            enum: ['late_arrival', 'early_departure', 'long_break', 'no_clock_out', 'manual_entry'],
        },
        description: String,
        minutes: Number,  // Duration of exception (e.g., 15 mins late)
    }],
    notes: String,
    timeEntryIds: [{
        type: Schema.Types.ObjectId,
        ref: 'TimeEntry'
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
        enum: ['created', 'submitted', 'approved', 'rejected', 'revision_requested', 'updated', 'recalled'],
        required: true,
    },
    performedBy: String,  // userId
    performedByName: String,
    performedAt: { type: Date, default: Date.now },
    details: String,
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
        enum: ['weekly', 'bi-weekly', 'monthly'],
        default: 'weekly'
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
        enum: ['draft', 'submitted', 'approved', 'rejected', 'revision_requested'],
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

    // Linked to payroll (future integration)
    payrollIntegration: {
        exported: { type: Boolean, default: false },
        exportedAt: Date,
        payrollRunId: String,
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
TimesheetSchema.statics.findOrCreateCurrentWeek = async function (userId, organizationId, userInfo) {
    const { startOfWeek, endOfWeek, getISOWeek, getYear } = require('date-fns');

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const weekNumber = getISOWeek(now);
    const year = getYear(now);

    let timesheet = await this.findOne({
        userId,
        organizationId,
        year,
        weekNumber,
    });

    if (!timesheet) {
        // Create new timesheet with empty daily entries
        const dailyEntries = [];
        const currentDate = new Date(weekStart);

        while (currentDate <= weekEnd) {
            dailyEntries.push({
                date: new Date(currentDate),
                dayOfWeek: currentDate.getDay(),
                status: currentDate.getDay() === 0 || currentDate.getDay() === 6 ? 'weekend' : 'absent',
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        timesheet = new this({
            userId,
            userEmail: userInfo.email,
            userName: userInfo.name,
            organizationId,
            organizationName: userInfo.organizationName,
            teamId: userInfo.teamId,
            teamName: userInfo.teamName,
            periodType: 'weekly',
            startDate: weekStart,
            endDate: weekEnd,
            weekNumber,
            year,
            dailyEntries,
            summary: {},
        });

        timesheet.addAuditLog('created', userId, userInfo.name, null, 'Auto-created for current week');
        await timesheet.save();
    }

    return timesheet;
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
