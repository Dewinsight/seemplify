function parseTime(value, fallback) {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return parseTime(fallback, '09:00');
    return Number(match[1]) * 60 + Number(match[2]);
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

function buildPolicySummary(policy) {
    const settings = policy?.clockSettings || {};
    const breaks = policy?.breakRules || {};
    const schedule = policy?.workSchedule || {};
    const shift = schedule.defaultShift || {};
    const notifications = policy?.notifications || {};
    return {
        explicitClockInRequired: true,
        autoClockOnLogin: false,
        locationRequired: !!(policy?.geofencing?.enabled && policy?.geofencing?.enforced),
        enforceClockInWindow: !!settings.enforceClockInWindow,
        earliestClockInMinutes: Number(settings.earliestClockInMinutes || 0),
        latestClockInMinutes: Number(settings.latestClockInMinutes || 0),
        nonWorkingDayClockIn: settings.nonWorkingDayClockIn || 'warn',
        requireNote: !!settings.requireNote,
        breakRequiredAfterMinutes: Number(breaks.requiredAfterMinutes || 360),
        minimumBreakMinutes: Number(breaks.minimumBreakMinutes || 20),
        workDays: Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5],
        shiftStart: shift.startTime || '09:00',
        shiftEnd: shift.endTime || '17:00',
        clockInReminder: notifications.clockInReminder !== false,
        clockOutReminder: notifications.clockOutReminder !== false,
        clockInReminderMinutesAfter: Number(notifications.clockInReminderMinutesAfter ?? 15),
        clockOutReminderMinutesAfter: Number(notifications.clockOutReminderMinutesAfter ?? 0),
        timezone: policy?.timezone || 'UTC',
    };
}

module.exports = { evaluateClockIn, buildPolicySummary, parseTime };
const { utcToZonedTime } = require('date-fns-tz');
