const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * AttendancePolicy Model
 * 
 * Organization-level configuration for time and attendance rules.
 */

// Default shift configuration
const ShiftSchema = new Schema({
    name: {
        type: String,
        default: 'Standard Shift'
    },
    startTime: {
        type: String,
        default: '09:00'  // 24-hour format
    },
    endTime: {
        type: String,
        default: '17:00'
    },
    breakDuration: {
        type: Number,
        default: 60  // minutes
    },
}, { _id: false });

// Overtime configuration
const OvertimeSchema = new Schema({
    enabled: {
        type: Boolean,
        default: true
    },
    dailyThreshold: {
        type: Number,
        default: 8  // hours
    },
    weeklyThreshold: {
        type: Number,
        default: 40  // hours
    },
    multiplier: {
        type: Number,
        default: 1.5  // 1.5x pay
    },
    requiresApproval: {
        type: Boolean,
        default: true
    },
    minimumIncrementMinutes: {
        type: Number,
        default: 0,
        min: 0,
        max: 240,
    },
    dailyLimitHours: {
        type: Number,
        default: null,
        min: 0,
        max: 24,
    },
}, { _id: false });

// Grace period configuration
const GracePeriodSchema = new Schema({
    lateArrival: {
        type: Number,
        default: 15  // minutes
    },
    earlyDeparture: {
        type: Number,
        default: 15  // minutes
    },
}, { _id: false });

// Geofencing configuration (for future GPS feature)
const GeofenceLocationSchema = new Schema({
    name: String,
    address: String,
    latitude: Number,
    longitude: Number,
    radius: {
        type: Number,
        default: 100  // meters
    },
    isActive: {
        type: Boolean,
        default: true
    },
}, { _id: false });

const ApprovalLevelSchema = new Schema({
    name: { type: String, required: true },
    approverType: {
        type: String,
        enum: ['line_manager', 'department_head', 'hr', 'explicit'],
        default: 'line_manager',
    },
    approverId: String,
    approverName: String,
    approverEmail: String,
}, { _id: false });

const ApprovalDelegationSchema = new Schema({
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
}, { _id: false });

const AttendancePolicySchema = new Schema({
    // Organization (from IdP)
    organizationId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    organizationName: {
        type: String
    },
    timezone: { type: String, default: 'UTC' },

    // Work Schedule
    workSchedule: {
        type: {
            type: String,
            enum: ['fixed', 'flexible'],
            default: 'fixed'
        },
        standardHoursPerDay: {
            type: Number,
            default: 8
        },
        standardHoursPerWeek: {
            type: Number,
            default: 40
        },
        workDays: {
            type: [Number],
            default: [1, 2, 3, 4, 5]  // Monday to Friday (0=Sunday)
        },
        defaultShift: ShiftSchema,
    },

    // Overtime Rules
    overtime: OvertimeSchema,

    // Grace Periods
    gracePeriod: GracePeriodSchema,

    restRules: {
        minimumMinutesBetweenShifts: { type: Number, default: 660, min: 0, max: 1440 },
    },

    breakRules: {
        requiredAfterMinutes: { type: Number, default: 360, min: 0, max: 1440 },
        minimumBreakMinutes: { type: Number, default: 30, min: 0, max: 1440 },
        paid: { type: Boolean, default: false },
    },

    // Timesheet Settings
    timesheetSettings: {
        periodType: {
            type: String,
            enum: ['daily', 'weekly', 'fortnightly', 'bi-weekly', 'semi-monthly', 'monthly'],
            default: 'weekly'
        },
        autoSubmit: {
            type: Boolean,
            default: false
        },
        autoApprove: {
            type: Boolean,
            default: false
        },
        submissionDeadline: {
            type: Number,
            default: 2  // Days after period end
        },
        approvalDeadline: {
            type: Number,
            default: 3  // Days after submission
        },
        approvalLevels: {
            type: [ApprovalLevelSchema],
            default: () => [{ name: 'Line manager', approverType: 'line_manager' }],
            validate: {
                validator: levels => Array.isArray(levels) && levels.length > 0 && levels.length <= 10,
                message: 'Between one and ten approval levels are required',
            },
        },
        approvalDelegations: {
            type: [ApprovalDelegationSchema],
            default: () => [],
            validate: {
                validator: delegations => Array.isArray(delegations)
                    && delegations.length <= 100
                    && delegations.every(item => new Date(item.endsAt) >= new Date(item.startsAt)),
                message: 'Approval delegation dates are invalid',
            },
        },
    },

    // Clock Settings
    clockSettings: {
        allowRemoteClock: {
            type: Boolean,
            default: true
        },
        requireNote: {
            type: Boolean,
            default: false
        },
        allowManualEntry: {
            type: Boolean,
            default: true
        },
        enforceClockInWindow: { type: Boolean, default: false },
        earliestClockInMinutes: { type: Number, min: 0, max: 720, default: 60 },
        latestClockInMinutes: { type: Number, min: 0, max: 720, default: 240 },
        nonWorkingDayClockIn: {
            type: String,
            enum: ['allow', 'warn', 'block'],
            default: 'warn'
        },
        autoClockOut: {
            enabled: { type: Boolean, default: false },
            afterHours: { type: Number, default: 10 },  // Auto clock out after 10 hours
            warningMinutesBefore: { type: Number, default: 30 }, // Warning email before auto clock-out
        },
        rounding: {
            enabled: { type: Boolean, default: false },
            incrementMinutes: { type: Number, default: 5, min: 1, max: 60 },
            mode: {
                type: String,
                enum: ['nearest', 'up', 'down'],
                default: 'nearest',
            },
        },
        maximumLocationAccuracyMeters: {
            type: Number,
            default: 250,
            min: 1,
            max: 10000,
        },
    },

    breakRules: {
        requiredAfterMinutes: { type: Number, min: 0, max: 1440, default: 360 },
        minimumBreakMinutes: { type: Number, min: 0, max: 480, default: 20 },
        maximumContinuousWorkMinutes: { type: Number, min: 0, max: 1440, default: 360 },
    },

    // Geofencing (future feature)
    geofencing: {
        enabled: {
            type: Boolean,
            default: false
        },
        enforced: {
            type: Boolean,
            default: false  // If true, clock-in fails outside geofence
        },
        locations: [GeofenceLocationSchema],
    },

    // Notifications
    notifications: {
        emailOnSubmission: { type: Boolean, default: true },
        emailOnApproval: { type: Boolean, default: true },
        emailOnRejection: { type: Boolean, default: true },
        reminderBeforeDeadline: { type: Boolean, default: true },
        reminderHoursBefore: { type: Number, default: 24 },
        clockInReminder: { type: Boolean, default: true },
        clockInReminderMinutesAfter: { type: Number, min: 0, max: 240, default: 15 },
        clockOutReminder: { type: Boolean, default: true },
        clockOutReminderMinutesAfter: { type: Number, min: 0, max: 240, default: 0 },
        managerReports: {
            enabled: { type: Boolean, default: true },
            frequency: {
                type: String,
                enum: ['daily', 'weekly', 'monthly'],
                default: 'weekly',
            },
            sendHourUtc: { type: Number, default: 9 }, // 0-23
            includeExcel: { type: Boolean, default: true },
        },
    },

    payroll: {
        enabled: { type: Boolean, default: true },
        holidayRateMultiplier: { type: Number, default: 1, min: 0, max: 10 },
        payCodes: {
            regular: { type: String, default: 'REGULAR' },
            overtime: { type: String, default: 'OVERTIME' },
            unpaidBreak: { type: String, default: 'UNPAID_BREAK' },
            holiday: { type: String, default: 'HOLIDAY' },
            allowance: { type: String, default: 'ALLOWANCE' },
            differential: { type: String, default: 'DIFFERENTIAL' },
        },
    },

    presence: {
        enabled: { type: Boolean, default: true },
        rawEventRetentionDays: { type: Number, default: 90, min: 1, max: 90 },
        dailySummaryRetentionDays: { type: Number, default: 730, min: 30, max: 2555 },
    },

    // Organization defaults used by calculations and rule selection.
    timezone: {
        type: String,
        default: 'UTC',
        trim: true,
    },
    jurisdiction: {
        countryCode: { type: String, default: 'NG', uppercase: true, trim: true },
        subdivisionCode: { type: String, trim: true },
    },
    activeRulePack: {
        rulePackId: { type: Schema.Types.ObjectId, ref: 'AttendanceRulePack' },
        version: Number,
        appliedAt: Date,
    },

    // Created/Updated by
    createdBy: String,
    updatedBy: String,

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

// Pre-save middleware
AttendancePolicySchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Static method to get or create default policy for organization
AttendancePolicySchema.statics.getOrCreateDefault = async function (organizationId, organizationName, creatorId) {
    let policy = await this.findOne({ organizationId });

    if (!policy) {
        policy = new this({
            organizationId,
            organizationName,
            createdBy: creatorId,
            workSchedule: {
                type: 'fixed',
                standardHoursPerDay: 8,
                standardHoursPerWeek: 40,
                workDays: [1, 2, 3, 4, 5],
                defaultShift: {
                    name: 'Standard Shift',
                    startTime: '09:00',
                    endTime: '17:00',
                    breakDuration: 60,
                },
            },
            overtime: {
                enabled: true,
                dailyThreshold: 8,
                weeklyThreshold: 40,
                multiplier: 1.5,
                requiresApproval: true,
            },
            gracePeriod: {
                lateArrival: 15,
                earlyDeparture: 15,
            },
        });

        await policy.save();
    }

    return policy;
};

// Instance method to check if a time is within work hours
AttendancePolicySchema.methods.isWithinWorkHours = function (time) {
    const shift = this.workSchedule.defaultShift;
    const [startHour, startMin] = shift.startTime.split(':').map(Number);
    const [endHour, endMin] = shift.endTime.split(':').map(Number);

    const hour = time.getHours();
    const min = time.getMinutes();

    const timeInMinutes = hour * 60 + min;
    const startInMinutes = startHour * 60 + startMin;
    const endInMinutes = endHour * 60 + endMin;

    return timeInMinutes >= startInMinutes && timeInMinutes <= endInMinutes;
};

// Instance method to check if a day is a work day
AttendancePolicySchema.methods.isWorkDay = function (date) {
    const day = date.getDay();
    return this.workSchedule.workDays.includes(day);
};

// Instance method to calculate late minutes
AttendancePolicySchema.methods.calculateLateMinutes = function (clockInTime) {
    const shift = this.workSchedule.defaultShift;
    const [startHour, startMin] = shift.startTime.split(':').map(Number);

    const clockInHour = clockInTime.getHours();
    const clockInMin = clockInTime.getMinutes();

    const scheduledStart = startHour * 60 + startMin;
    const actualStart = clockInHour * 60 + clockInMin;

    const lateMinutes = actualStart - scheduledStart - this.gracePeriod.lateArrival;

    return Math.max(0, lateMinutes);
};

module.exports = mongoose.model('AttendancePolicy', AttendancePolicySchema);
