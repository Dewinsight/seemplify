const { Availability, EmployeeRoster, Shift } = require('../models');
const { zonedTimeToUtc } = require('date-fns-tz');
const { findShiftConflicts } = require('./schedulingService');
const { resolveCalculationPolicy } = require('./rulePackService');
const { normalizeSchedulingSettings } = require('./schedulingPolicyService');

function localDateKey(value, timezone = 'UTC') {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(value));
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function weekBounds(value, timezone = 'UTC') {
    const localDate = new Date(`${localDateKey(value, timezone)}T00:00:00.000Z`);
    const offset = (localDate.getUTCDay() + 6) % 7;
    localDate.setUTCDate(localDate.getUTCDate() - offset);
    const localEnd = new Date(localDate);
    localEnd.setUTCDate(localEnd.getUTCDate() + 7);
    const dateText = date => date.toISOString().slice(0, 10);
    return {
        start: zonedTimeToUtc(`${dateText(localDate)}T00:00:00`, timezone),
        end: zonedTimeToUtc(`${dateText(localEnd)}T00:00:00`, timezone),
    };
}

function localMinutes(value, timezone = 'UTC') {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = type => Number(parts.find(item => item.type === type)?.value || 0);
    return part('hour') * 60 + part('minute');
}

function timeTextMinutes(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function availabilityAllows(availability, shift) {
    if (!availability) return true;
    if (availability.available === false) return false;
    const availableFrom = timeTextMinutes(availability.startTime);
    const availableUntil = timeTextMinutes(availability.endTime);
    if (availableFrom === null && availableUntil === null) return true;
    const timezone = shift.timezone || 'UTC';
    const shiftStart = localMinutes(shift.startAt, timezone);
    const shiftEnd = localMinutes(shift.endAt, timezone);
    if (availableFrom !== null && shiftStart < availableFrom) return false;
    if (availableUntil !== null && shiftEnd > availableUntil) return false;
    return true;
}

function rosterMemberIsEligible(roster, at) {
    if (!roster || roster.status === 'inactive') return false;
    if (roster.appAccess?.mode === 'selected' && !(roster.appAccess.appIds || []).includes('time-attendance')) return false;
    return !roster.effectiveExitAt || new Date(at) < new Date(roster.effectiveExitAt);
}

async function validateShiftAssignment({
    organizationId,
    userId,
    shift,
    attendancePolicy,
    excludeShiftIds = [],
}) {
    const errors = [];
    const warnings = [];
    let weeklySchedule;
    let minimumRestMinutes = 0;
    if (!userId) return findShiftConflicts({
        organizationId,
        startAt: shift.startAt,
        endAt: shift.endAt,
    });

    const roster = await EmployeeRoster.findOne({ organizationId, userId }).lean();
    if (!roster) {
        errors.push({ code: 'ROSTER_MEMBER_NOT_FOUND', message: 'This person is not in the active organization roster.' });
        return { valid: false, errors, warnings };
    }
    if (!rosterMemberIsEligible(roster, shift.startAt)) {
        errors.push({ code: 'EMPLOYEE_NOT_ELIGIBLE', message: 'This employee is not attendance-eligible at the shift start time.' });
    }
    if (shift.teamId && !(roster.teamIds || []).map(String).includes(String(shift.teamId))) {
        errors.push({ code: 'TEAM_MEMBERSHIP_MISMATCH', message: 'This employee is not an active member of the shift team.' });
    }

    const resolved = await resolveCalculationPolicy({
        policy: attendancePolicy,
        organizationId,
        userId,
        teamId: shift.teamId,
        locationId: shift.locationId,
        at: shift.startAt,
    });
    const policy = resolved.policy;
    const settings = normalizeSchedulingSettings(policy.schedulingSettings);
    minimumRestMinutes = settings.enforceMinimumRest
        ? Number(policy.restRules?.minimumMinutesBetweenShifts || 0)
        : 0;
    const conflict = await findShiftConflicts({
        organizationId,
        userId,
        startAt: shift.startAt,
        endAt: shift.endAt,
        excludeShiftIds,
        minimumRestMinutes,
    });
    errors.push(...conflict.errors);
    if (settings.enforceMinimumRest) errors.push(...conflict.warnings);
    else warnings.push(...conflict.warnings);

    if (settings.enforceAvailability) {
        const key = localDateKey(shift.startAt, shift.timezone || policy.timezone || 'UTC');
        const dayStart = new Date(`${key}T00:00:00.000Z`);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const availability = await Availability.findOne({
            organizationId,
            userId,
            date: { $gte: dayStart, $lt: dayEnd },
        }).lean();
        if (!availability && settings.requireAvailabilityRecord) {
            errors.push({ code: 'AVAILABILITY_REQUIRED', message: 'This employee has not recorded availability for the shift date.' });
        } else if (availability && !availabilityAllows(availability, shift)) {
            errors.push({ code: 'OUTSIDE_AVAILABILITY', message: 'This shift falls outside the employee’s recorded availability.' });
        }
    }

    if (settings.enforceMaximumWeeklyHours) {
        const bounds = weekBounds(shift.startAt, shift.timezone || policy.timezone || 'UTC');
        const existing = await Shift.find({
            organizationId,
            userId,
            status: { $nin: ['cancelled'] },
            _id: { $nin: excludeShiftIds },
            startAt: { $lt: bounds.end },
            endAt: { $gt: bounds.start },
        }).select('startAt endAt breakMinutes').lean();
        const existingHours = existing.reduce((sum, item) => (
            sum + Math.max(0, (new Date(item.endAt) - new Date(item.startAt)) / 3600000 - Number(item.breakMinutes || 0) / 60)
        ), 0);
        const currentShiftHours = Math.max(0, (new Date(shift.endAt) - new Date(shift.startAt)) / 3600000 - Number(shift.breakMinutes || 0) / 60);
        const scheduledHours = existingHours + currentShiftHours;
        const maximumHours = Number(policy.workSchedule?.maximumHoursPerWeek || 48);
        weeklySchedule = { weekStart: bounds.start, existingHours, currentShiftHours, scheduledHours, maximumHours };
        if (scheduledHours > maximumHours + 0.001) {
            errors.push({
                code: 'MAXIMUM_WEEKLY_HOURS_EXCEEDED',
                message: `This assignment would schedule ${scheduledHours.toFixed(2)} hours against the ${maximumHours}-hour weekly policy.`,
                scheduledHours,
                maximumHours,
            });
        }
    }

    return { valid: errors.length === 0, errors, warnings, roster, appliedRulePacks: resolved.applied, weeklySchedule, minimumRestMinutes };
}

module.exports = {
    availabilityAllows,
    localDateKey,
    rosterMemberIsEligible,
    validateShiftAssignment,
    weekBounds,
};
