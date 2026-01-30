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

    // Timesheet Settings
    timesheetSettings: {
        periodType: {
            type: String,
            enum: ['weekly', 'bi-weekly', 'monthly'],
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
        autoClockOut: {
            enabled: { type: Boolean, default: false },
            afterHours: { type: Number, default: 12 },  // Auto clock out after 12 hours
        },
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
