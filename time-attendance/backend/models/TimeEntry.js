const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * TimeEntry Model
 * 
 * Represents a single clock event (clock in, clock out, break start, break end).
 * Multiple TimeEntry records form a complete work day.
 */
const TimeEntrySchema = new Schema({
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

    workMode: { type: String, enum: ['office', 'remote', 'client_site', 'other'], default: 'office' },
    locationId: String,
    jobCode: String,
    activityCode: String,
    costCentreCode: String,

    // Entry Type
    entryType: {
        type: String,
        enum: ['clock_in', 'clock_out', 'break_start', 'break_end'],
        required: true,
        index: true,
    },

    // Timestamp
    timestamp: {
        type: Date,
        required: true,
        default: Date.now,
        index: true,
    },

    // User's timezone at time of entry
    timezone: {
        type: String,
        default: 'UTC'
    },

    // Location Data (for GPS geofencing)
    location: {
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
    },

    // Source of the entry
    source: {
        type: String,
        enum: ['web', 'manual', 'import', 'auto'],
        default: 'web',
    },

    // Optional note from employee
    note: {
        type: String,
        maxlength: 500
    },

    // Manual entry or modification tracking
    isManualEntry: {
        type: Boolean,
        default: false
    },

    modifiedBy: {
        userId: String,
        userName: String,
        modifiedAt: Date,
        reason: String,
    },

    // Auto clock-out state (stored on the originating clock_in entry)
    autoClockOut: {
        warningSentAt: Date,
        warningEmailMessageId: String,
        manualReminderSentAt: Date,
        manualReminderEmailMessageId: String,
        manualReminderSentBy: String,
        autoClockedOutAt: Date,
        autoClockOutEntryId: {
            type: Schema.Types.ObjectId,
            ref: 'TimeEntry',
        },
    },

    // Link to timesheet if aggregated
    timesheetId: {
        type: Schema.Types.ObjectId,
        ref: 'Timesheet',
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

// Compound indexes for common queries
TimeEntrySchema.index({ userId: 1, organizationId: 1, timestamp: -1 });
TimeEntrySchema.index({ organizationId: 1, entryType: 1, timestamp: -1 });
TimeEntrySchema.index({ userId: 1, entryType: 1, timestamp: -1 });

// Pre-save middleware
TimeEntrySchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Instance method to get paired entry (clock_in -> clock_out, break_start -> break_end)
TimeEntrySchema.methods.getPairedEntryType = function () {
    const pairMap = {
        'clock_in': 'clock_out',
        'clock_out': 'clock_in',
        'break_start': 'break_end',
        'break_end': 'break_start',
    };
    return pairMap[this.entryType];
};

// Static method to get today's entries for a user
TimeEntrySchema.statics.getTodayEntries = async function (userId, organizationId, timezone = 'UTC') {
    const { localDayBounds } = require('../services/timeCalculationService');
    const { start: todayStart, end: todayEnd } = localDayBounds(new Date(), timezone);

    return this.find({
        userId,
        organizationId,
        timestamp: { $gte: todayStart, $lte: todayEnd },
    }).sort({ timestamp: 1 });
};

// Static method to get current status (clocked in or out)
TimeEntrySchema.statics.getCurrentStatus = async function (userId, organizationId) {
    const lastEntry = await this.findOne({
        userId,
        organizationId,
        entryType: { $in: ['clock_in', 'clock_out'] },
    }).sort({ timestamp: -1 });

    if (!lastEntry) {
        return { isClockedIn: false, lastEntry: null };
    }

    return {
        isClockedIn: lastEntry.entryType === 'clock_in',
        lastEntry,
    };
};

// Static method to check if user is on break
TimeEntrySchema.statics.isOnBreak = async function (userId, organizationId) {
    const lastBreakEntry = await this.findOne({
        userId,
        organizationId,
        entryType: { $in: ['break_start', 'break_end'] },
    }).sort({ timestamp: -1 });

    if (!lastBreakEntry) {
        return { onBreak: false, lastBreakEntry: null };
    }

    return {
        onBreak: lastBreakEntry.entryType === 'break_start',
        lastBreakEntry,
    };
};

module.exports = mongoose.model('TimeEntry', TimeEntrySchema);
