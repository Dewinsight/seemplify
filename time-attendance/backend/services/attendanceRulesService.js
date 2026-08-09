const { endOfDay, startOfDay } = require('date-fns');
const { utcToZonedTime, zonedTimeToUtc } = require('date-fns-tz');

function parseTime(value, fallback) {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return parseTime(fallback, '09:00');
    return Number(match[1]) * 60 + Number(match[2]);
}

function getPolicyDayBounds(now = new Date(), timezone = 'UTC') {
    const reference = now instanceof Date ? now : new Date(now);
    const safeReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
    let safeTimezone = timezone || 'UTC';
    let localNow;

    try {
        localNow = utcToZonedTime(safeReference, safeTimezone);
        // Force validation because date-fns-tz can return an invalid date for an invalid zone.
        if (Number.isNaN(localNow.getTime())) throw new RangeError('Invalid timezone');
    } catch {
        safeTimezone = 'UTC';
        localNow = utcToZonedTime(safeReference, safeTimezone);
    }

    return {
        start: zonedTimeToUtc(startOfDay(localNow), safeTimezone),
        end: zonedTimeToUtc(endOfDay(localNow), safeTimezone),
        timezone: safeTimezone,
    };
}

function inferDayStartState(entries, {
    dayStart,
    isClockedIn = false,
    lastClockEntry = null,
    isOnBreak = false,
    lastBreakEntry = null,
} = {}) {
    const boundary = dayStart instanceof Date ? dayStart : new Date(dayStart);
    if (Number.isNaN(boundary.getTime())) {
        return { clockedInAtDayStart: false, onBreakAtDayStart: false };
    }

    const sortedEntries = [...(entries || [])].sort((left, right) => {
        return new Date(left?.timestamp).getTime() - new Date(right?.timestamp).getTime();
    });
    const firstClockEntry = sortedEntries.find(entry => ['clock_in', 'clock_out'].includes(entry?.entryType));
    const firstBreakEntry = sortedEntries.find(entry => ['break_start', 'break_end'].includes(entry?.entryType));
    const lastClockTimestamp = lastClockEntry?.timestamp ? new Date(lastClockEntry.timestamp) : null;
    const lastBreakTimestamp = lastBreakEntry?.timestamp ? new Date(lastBreakEntry.timestamp) : null;

    return {
        clockedInAtDayStart: firstClockEntry
            ? firstClockEntry.entryType === 'clock_out'
            : Boolean(isClockedIn && lastClockTimestamp && !Number.isNaN(lastClockTimestamp.getTime()) && lastClockTimestamp < boundary),
        onBreakAtDayStart: firstBreakEntry
            ? firstBreakEntry.entryType === 'break_end'
            : Boolean(isOnBreak && lastBreakTimestamp && !Number.isNaN(lastBreakTimestamp.getTime()) && lastBreakTimestamp < boundary),
    };
}

function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function evaluateClockIn(policy, { now = new Date(), hasLocation = false } = {}) {
    const rules = policy?.clockSettings || {};
    const schedule = policy?.workSchedule || {};
    const shift = schedule.defaultShift || {};
    const result = { allowed: true, warnings: [], code: null };
    const localNow = utcToZonedTime(now, policy?.timezone || 'UTC');

    const workDays = Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5];
    if (!workDays.includes(localNow.getDay())) {
        const mode = rules.nonWorkingDayClockIn || 'warn';
        if (mode === 'block') return { allowed: false, warnings: [], code: 'NON_WORKING_DAY' };
        if (mode === 'warn') result.warnings.push('Today is not a configured working day.');
    }

    if (rules.enforceClockInWindow) {
        const start = parseTime(shift.startTime, '09:00');
        const earliest = start - Number(rules.earliestClockInMinutes || 0);
        const latest = start + Number(rules.latestClockInMinutes || 0);
        const current = minutesOfDay(localNow);
        if (current < earliest) return { allowed: false, warnings: [], code: 'CLOCK_IN_TOO_EARLY' };
        if (current > latest) return { allowed: false, warnings: [], code: 'CLOCK_IN_WINDOW_CLOSED' };
    }

    if (policy?.geofencing?.enabled && policy?.geofencing?.enforced && !hasLocation) {
        return { allowed: false, warnings: [], code: 'LOCATION_REQUIRED' };
    }

    return result;
}

function evaluateLocationPolicy(policy, { hasLocation = false, accuracy = null } = {}) {
    const enabled = policy?.geofencing?.enabled === true;
    const enforced = enabled && policy?.geofencing?.enforced === true;
    const maximumAccuracyMeters = Number(policy?.clockSettings?.maximumLocationAccuracyMeters || 250);
    const result = {
        allowed: true,
        enabled,
        enforced,
        locationRequired: enforced,
        shouldValidate: false,
        maximumAccuracyMeters,
        warnings: [],
        code: null,
    };

    if (!enabled) return result;

    if (!hasLocation) {
        if (enforced) return { ...result, allowed: false, code: 'LOCATION_REQUIRED' };
        result.warnings.push('Location was unavailable, so this attendance event was not checked against a geofence.');
        return result;
    }

    const numericAccuracy = accuracy == null ? null : Number(accuracy);
    if (Number.isFinite(numericAccuracy) && numericAccuracy > maximumAccuracyMeters) {
        if (enforced) return { ...result, allowed: false, code: 'LOCATION_ACCURACY_TOO_LOW' };
        result.warnings.push(`Location accuracy exceeded the configured ${maximumAccuracyMeters}m limit, so the event was recorded without geofence verification.`);
        return result;
    }

    result.shouldValidate = true;
    return result;
}

function buildPolicySummary(policy) {
    const settings = policy?.clockSettings || {};
    const breaks = policy?.breakRules || {};
    const schedule = policy?.workSchedule || {};
    const shift = schedule.defaultShift || {};
    const notifications = policy?.notifications || {};
    return {
        explicitClockInRequired: true,
        autoClockOnLogin: false,
        locationEnabled: !!policy?.geofencing?.enabled,
        locationRequired: !!(policy?.geofencing?.enabled && policy?.geofencing?.enforced),
        maximumLocationAccuracyMeters: Number(settings.maximumLocationAccuracyMeters || 250),
        enforceClockInWindow: !!settings.enforceClockInWindow,
        earliestClockInMinutes: Number(settings.earliestClockInMinutes || 0),
        latestClockInMinutes: Number(settings.latestClockInMinutes || 0),
        nonWorkingDayClockIn: settings.nonWorkingDayClockIn || 'warn',
        requireNote: !!settings.requireNote,
        breakRequiredAfterMinutes: Number(breaks.requiredAfterMinutes || 360),
        minimumBreakMinutes: Number(breaks.minimumBreakMinutes || 20),
        workDays: Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5],
        scheduleType: schedule.type || 'fixed',
        standardHoursPerDay: Number(schedule.standardHoursPerDay || 8),
        shiftStart: shift.startTime || '09:00',
        shiftEnd: shift.endTime || '17:00',
        shiftBreakMinutes: Number(shift.breakDuration || 0),
        clockInReminder: notifications.clockInReminder !== false,
        clockOutReminder: notifications.clockOutReminder !== false,
        clockInReminderMinutesAfter: Number(notifications.clockInReminderMinutesAfter ?? 15),
        clockOutReminderMinutesAfter: Number(notifications.clockOutReminderMinutesAfter ?? 0),
        timezone: policy?.timezone || 'UTC',
    };
}

function calculateDailyDurations(entries, {
    now = new Date(),
    dayStart = null,
    clockedInAtDayStart = false,
    onBreakAtDayStart = false,
    isClockedIn = false,
    isOnBreak = false,
} = {}) {
    const reference = now instanceof Date ? now : new Date(now);
    const safeNow = Number.isNaN(reference.getTime()) ? new Date() : reference;
    const boundaryCandidate = dayStart instanceof Date ? dayStart : new Date(dayStart);
    const boundary = dayStart && !Number.isNaN(boundaryCandidate.getTime()) ? boundaryCandidate : null;
    let workedMinutes = 0;
    let breakMinutes = 0;
    let clockInTime = clockedInAtDayStart && boundary ? boundary : null;
    let breakStartTime = onBreakAtDayStart && boundary ? boundary : null;

    const sortedEntries = [...(entries || [])].sort((left, right) => {
        return new Date(left?.timestamp).getTime() - new Date(right?.timestamp).getTime();
    });

    for (const entry of sortedEntries) {
        const timestamp = entry?.timestamp instanceof Date ? entry.timestamp : new Date(entry?.timestamp);
        if (Number.isNaN(timestamp.getTime())) continue;
        if (boundary && timestamp < boundary) continue;
        if (timestamp > safeNow) continue;

        if (entry.entryType === 'clock_in') {
            clockInTime = timestamp;
        } else if (entry.entryType === 'clock_out' && clockInTime) {
            workedMinutes += (timestamp - clockInTime) / (1000 * 60);
            clockInTime = null;
        } else if (entry.entryType === 'break_start') {
            breakStartTime = timestamp;
        } else if (entry.entryType === 'break_end' && breakStartTime) {
            breakMinutes += (timestamp - breakStartTime) / (1000 * 60);
            breakStartTime = null;
        }
    }

    if (isClockedIn && clockInTime) {
        workedMinutes += (safeNow - clockInTime) / (1000 * 60);
    }
    if (isOnBreak && breakStartTime) {
        breakMinutes += (safeNow - breakStartTime) / (1000 * 60);
    }

    return {
        timeWorkedMinutes: Math.max(0, workedMinutes - breakMinutes),
        breakMinutes: Math.max(0, breakMinutes),
    };
}

module.exports = { evaluateClockIn, evaluateLocationPolicy, buildPolicySummary, calculateDailyDurations, getPolicyDayBounds, inferDayStartState, parseTime };
