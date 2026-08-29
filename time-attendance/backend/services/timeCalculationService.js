const {
    addDays,
    endOfMonth,
    endOfWeek,
    getISOWeek,
    getYear,
    startOfMonth,
    startOfWeek,
} = require('date-fns');
const { formatInTimeZone, utcToZonedTime, zonedTimeToUtc } = require('date-fns-tz');

const EDITABLE_TIMESHEET_STATUSES = new Set(['draft', 'rejected', 'revision_requested', 'adjusted']);
const LOCKED_TIMESHEET_STATUSES = new Set(['approved', 'locked', 'payroll_pending', 'payroll_exported']);
const LOCATION_FIELDS = [
    'latitude', 'longitude', 'address', 'area', 'city', 'state', 'country',
    'displayName', 'accuracy', 'verified',
];

function normalizeLocationSnapshot(location) {
    let value = location;
    if (value && typeof value.toObject === 'function') {
        value = value.toObject({ depopulate: true });
    }
    if (!value || typeof value !== 'object') return null;

    const snapshot = {};
    for (const field of LOCATION_FIELDS) {
        if (value[field] !== undefined && value[field] !== null && value[field] !== '') {
            snapshot[field] = value[field];
        }
    }
    return Object.keys(snapshot).length ? snapshot : null;
}

function normalizePeriodType(periodType) {
    if (periodType === 'bi-weekly') return 'fortnightly';
    return ['daily', 'weekly', 'fortnightly', 'semi-monthly', 'monthly'].includes(periodType)
        ? periodType
        : 'weekly';
}

function normalizeTimeZone(timeZone) {
    const candidate = String(timeZone || 'UTC').trim() || 'UTC';
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: candidate }).format(new Date());
        return candidate;
    } catch {
        return 'UTC';
    }
}

function localDayBounds(date, timeZone) {
    const zone = normalizeTimeZone(timeZone);
    const local = utcToZonedTime(date, zone);
    const startLocal = new Date(local);
    startLocal.setHours(0, 0, 0, 0);
    const endLocal = new Date(startLocal);
    endLocal.setDate(endLocal.getDate() + 1);
    return {
        start: zonedTimeToUtc(startLocal, zone),
        end: new Date(zonedTimeToUtc(endLocal, zone).getTime() - 1),
    };
}

function getPeriodBounds(referenceDate = new Date(), periodType = 'weekly', timeZone = 'UTC') {
    const normalized = normalizePeriodType(periodType);
    const zone = normalizeTimeZone(timeZone);
    const local = utcToZonedTime(referenceDate, zone);
    let localStart;
    let localEnd;

    if (normalized === 'daily') {
        localStart = new Date(local);
        localStart.setHours(0, 0, 0, 0);
        localEnd = new Date(localStart);
        localEnd.setDate(localEnd.getDate() + 1);
        localEnd = new Date(localEnd.getTime() - 1);
    } else if (normalized === 'weekly' || normalized === 'fortnightly') {
        localStart = startOfWeek(local, { weekStartsOn: 1 });
        localEnd = normalized === 'fortnightly'
            ? new Date(addDays(localStart, 14).getTime() - 1)
            : endOfWeek(local, { weekStartsOn: 1 });
    } else if (normalized === 'semi-monthly') {
        localStart = new Date(local.getFullYear(), local.getMonth(), local.getDate() <= 15 ? 1 : 16);
        localEnd = local.getDate() <= 15
            ? new Date(local.getFullYear(), local.getMonth(), 16, 0, 0, 0, 0)
            : new Date(local.getFullYear(), local.getMonth() + 1, 1, 0, 0, 0, 0);
        localEnd = new Date(localEnd.getTime() - 1);
    } else {
        localStart = startOfMonth(local);
        localEnd = endOfMonth(local);
    }

    const start = zonedTimeToUtc(localStart, zone);
    const end = zonedTimeToUtc(localEnd, zone);
    const key = `${normalized}:${formatInTimeZone(start, zone, 'yyyy-MM-dd')}:${formatInTimeZone(end, zone, 'yyyy-MM-dd')}`;

    return {
        periodType: normalized,
        start,
        end,
        key,
        weekNumber: getISOWeek(localStart),
        year: getYear(localStart),
    };
}

function enumerateLocalDates(start, end, timeZone) {
    const zone = normalizeTimeZone(timeZone);
    const dates = [];
    let cursor = utcToZonedTime(start, zone);
    cursor.setHours(0, 0, 0, 0);
    const finalDateKey = formatInTimeZone(end, zone, 'yyyy-MM-dd');

    for (let guard = 0; guard < 370; guard += 1) {
        const utcDate = zonedTimeToUtc(cursor, zone);
        dates.push(utcDate);
        if (formatInTimeZone(utcDate, zone, 'yyyy-MM-dd') === finalDateKey) break;
        cursor = addDays(cursor, 1);
    }
    return dates;
}

function roundMinutes(minutes, rounding = {}) {
    if (!rounding?.enabled) return minutes;
    const increment = Math.max(1, Number(rounding.incrementMinutes || 5));
    const ratio = minutes / increment;
    if (rounding.mode === 'up') return Math.ceil(ratio) * increment;
    if (rounding.mode === 'down') return Math.floor(ratio) * increment;
    return Math.round(ratio) * increment;
}

function buildSessions(entries) {
    const ordered = [...(entries || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const sessions = [];
    const orphanEvents = [];
    let active = null;

    for (const entry of ordered) {
        const timestamp = new Date(entry.timestamp);
        if (Number.isNaN(timestamp.getTime())) continue;

        if (entry.entryType === 'clock_in') {
            if (active) {
                active.exceptions.push({ type: 'duplicate_session', description: 'A new clock-in occurred before the previous session ended' });
                sessions.push(active);
            }
            active = { clockIn: entry, clockOut: null, breaks: [], openBreak: null, entries: [entry], exceptions: [] };
            continue;
        }

        if (!active) {
            orphanEvents.push(entry);
            continue;
        }

        active.entries.push(entry);
        if (entry.entryType === 'break_start') {
            if (active.openBreak) {
                active.exceptions.push({ type: 'missed_break_end', description: 'A break was started before the previous break ended' });
            }
            active.openBreak = entry;
        } else if (entry.entryType === 'break_end') {
            if (!active.openBreak) {
                active.exceptions.push({ type: 'orphan_break_end', description: 'Break end has no matching break start' });
            } else {
                active.breaks.push({ start: active.openBreak, end: entry });
                active.openBreak = null;
            }
        } else if (entry.entryType === 'clock_out') {
            if (active.openBreak) {
                active.breaks.push({ start: active.openBreak, end: entry, autoClosed: true });
                active.openBreak = null;
            }
            active.clockOut = entry;
            sessions.push(active);
            active = null;
        }
    }

    if (active) {
        active.exceptions.push({ type: 'no_clock_out', description: 'Missing clock out' });
        sessions.push(active);
    }

    return { sessions, orphanEvents };
}

function calculatePeriod(entries, period, policy = {}, calendarContext = {}) {
    const timeZone = normalizeTimeZone(policy.timezone || 'UTC');
    const workDays = policy.workSchedule?.workDays || [1, 2, 3, 4, 5];
    const dailyThreshold = Number(policy.overtime?.dailyThreshold ?? policy.workSchedule?.standardHoursPerDay ?? 8);
    const weeklyThreshold = Number(policy.overtime?.weeklyThreshold ?? policy.workSchedule?.standardHoursPerWeek ?? 40);
    const minimumOvertimeMinutes = Number(policy.overtime?.minimumIncrementMinutes || 0);
    const { sessions, orphanEvents } = buildSessions(entries);
    const days = new Map();
    const holidayKeys = new Set((calendarContext.holidays || []).map(holiday => formatInTimeZone(new Date(holiday.date), timeZone, 'yyyy-MM-dd')));
    const recurringHolidayMonthDays = new Set((calendarContext.holidays || [])
        .filter(holiday => holiday.isRecurring)
        .map(holiday => formatInTimeZone(new Date(holiday.date), timeZone, 'MM-dd')));
    const leaves = (calendarContext.leaves || []).map(leave => ({
        ...leave,
        startKey: formatInTimeZone(new Date(leave.startAt || leave.startDate), timeZone, 'yyyy-MM-dd'),
        endKey: formatInTimeZone(new Date(leave.endAt || leave.endDate), timeZone, 'yyyy-MM-dd'),
    }));
    const usePublishedShifts = policy.schedulingSettings?.usePublishedShiftsAsAttendanceSchedule !== false;
    const scheduledShiftsByDay = new Map();
    if (usePublishedShifts) {
        for (const shift of calendarContext.shifts || []) {
            const key = formatInTimeZone(new Date(shift.startAt), timeZone, 'yyyy-MM-dd');
            if (!scheduledShiftsByDay.has(key)) scheduledShiftsByDay.set(key, []);
            scheduledShiftsByDay.get(key).push(shift);
        }
    }
    const scheduleCoverage = usePublishedShifts ? (calendarContext.schedulePublications || []).map(publication => ({
        startKey: formatInTimeZone(new Date(publication.periodStart), timeZone, 'yyyy-MM-dd'),
        endKey: formatInTimeZone(new Date(new Date(publication.periodEnd).getTime() - 1), timeZone, 'yyyy-MM-dd'),
    })) : [];

    for (const date of enumerateLocalDates(period.start, period.end, timeZone)) {
        const key = formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
        const local = utcToZonedTime(date, timeZone);
        const dayOfWeek = local.getDay();
        const onLeave = leaves.some(leave => key >= leave.startKey && key <= leave.endKey);
        const holiday = holidayKeys.has(key) || recurringHolidayMonthDays.has(key.slice(5));
        const scheduledShifts = scheduledShiftsByDay.get(key) || [];
        const publishedScheduleCoversDay = scheduleCoverage.some(range => key >= range.startKey && key <= range.endKey);
        const scheduledWorkDay = publishedScheduleCoversDay ? scheduledShifts.length > 0 : workDays.includes(dayOfWeek);
        days.set(key, {
            date,
            dayOfWeek,
            clockIn: null,
            clockOut: null,
            clockInLocation: null,
            clockOutLocation: null,
            breakDuration: 0,
            totalMinutes: 0,
            totalHours: 0,
            regularHours: 0,
            overtimeHours: 0,
            status: holiday ? 'holiday' : onLeave ? 'leave' : scheduledWorkDay ? 'absent' : 'weekend',
            scheduledShiftIds: scheduledShifts.map(shift => shift._id).filter(Boolean),
            scheduledStart: scheduledShifts.length
                ? new Date(Math.min(...scheduledShifts.map(shift => new Date(shift.startAt).getTime())))
                : null,
            scheduledEnd: scheduledShifts.length
                ? new Date(Math.max(...scheduledShifts.map(shift => new Date(shift.endAt).getTime())))
                : null,
            scheduledMinutes: scheduledShifts.reduce((sum, shift) => (
                sum + Math.max(0, Math.round((new Date(shift.endAt) - new Date(shift.startAt)) / 60000) - Number(shift.breakMinutes || 0))
            ), 0),
            publishedScheduleCoversDay,
            exceptions: [],
            timeEntryIds: [],
            sessions: [],
        });
    }

    for (const session of sessions) {
        const key = formatInTimeZone(session.clockIn.timestamp, timeZone, 'yyyy-MM-dd');
        const day = days.get(key);
        if (!day) continue;
        const breakMinutes = session.breaks.reduce((total, pause) => {
            return total + Math.max(0, (new Date(pause.end.timestamp) - new Date(pause.start.timestamp)) / 60000);
        }, 0);
        const grossMinutes = session.clockOut
            ? Math.max(0, (new Date(session.clockOut.timestamp) - new Date(session.clockIn.timestamp)) / 60000)
            : 0;
        const netMinutes = roundMinutes(Math.max(0, grossMinutes - breakMinutes), policy.clockSettings?.rounding);

        day.clockIn = !day.clockIn || new Date(session.clockIn.timestamp) < new Date(day.clockIn)
            ? session.clockIn.timestamp
            : day.clockIn;
        if (session.clockOut && (!day.clockOut || new Date(session.clockOut.timestamp) > new Date(day.clockOut))) {
            day.clockOut = session.clockOut.timestamp;
        }
        const clockInLocation = normalizeLocationSnapshot(session.clockIn.location);
        const clockOutLocation = normalizeLocationSnapshot(session.clockOut?.location);
        if (!day.clockInLocation && clockInLocation) day.clockInLocation = clockInLocation;
        if (clockOutLocation) day.clockOutLocation = clockOutLocation;
        day.breakDuration += Math.round(breakMinutes);
        day.totalMinutes += Math.round(netMinutes);
        day.timeEntryIds.push(...session.entries.map(entry => entry._id).filter(Boolean));
        day.sessions.push({
            clockIn: session.clockIn.timestamp,
            clockOut: session.clockOut?.timestamp || null,
            breakMinutes: Math.round(breakMinutes),
            totalMinutes: Math.round(netMinutes),
        });
        day.exceptions.push(...session.exceptions);
        if (session.entries.some(entry => entry.isManualEntry || entry.source === 'manual')) {
            day.exceptions.push({ type: 'manual_entry', description: 'Contains manually recorded time' });
        }
        if (day.status === 'leave') day.exceptions.push({ type: 'leave_conflict', description: 'Recorded attendance overlaps approved leave' });
        day.status = session.clockOut ? 'present' : 'partial';
    }

    for (const orphan of orphanEvents) {
        const key = formatInTimeZone(orphan.timestamp, timeZone, 'yyyy-MM-dd');
        const day = days.get(key);
        if (day) {
            day.exceptions.push({ type: 'orphan_event', description: `${orphan.entryType} has no open work session` });
            if (orphan._id) day.timeEntryIds.push(orphan._id);
        }
    }

    const dailyEntries = Array.from(days.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (policy.workSchedule?.type !== 'flexible') {
        for (const day of dailyEntries.filter(item => ['present', 'partial'].includes(item.status))) {
            if (day.publishedScheduleCoversDay && !day.scheduledStart) continue;
            const [defaultStartHour, defaultStartMinute] = String(policy.workSchedule?.defaultShift?.startTime || '09:00').split(':').map(Number);
            const [defaultEndHour, defaultEndMinute] = String(policy.workSchedule?.defaultShift?.endTime || '17:00').split(':').map(Number);
            const scheduledStart = day.scheduledStart
                ? Number(formatInTimeZone(day.scheduledStart, timeZone, 'HH')) * 60 + Number(formatInTimeZone(day.scheduledStart, timeZone, 'mm'))
                : defaultStartHour * 60 + defaultStartMinute;
            let scheduledEnd = day.scheduledEnd
                ? Number(formatInTimeZone(day.scheduledEnd, timeZone, 'HH')) * 60 + Number(formatInTimeZone(day.scheduledEnd, timeZone, 'mm'))
                : defaultEndHour * 60 + defaultEndMinute;
            if (scheduledEnd <= scheduledStart) scheduledEnd += 1440;
            if (day.clockIn) {
                const [hour, minute] = formatInTimeZone(new Date(day.clockIn), timeZone, 'HH:mm').split(':').map(Number);
                const late = hour * 60 + minute - scheduledStart - Number(policy.gracePeriod?.lateArrival || 0);
                if (late > 0) day.exceptions.push({ type: 'late_arrival', description: `Clock-in was ${late} minutes after the configured grace period`, minutes: late });
            }
            if (day.clockOut) {
                const [hour, minute] = formatInTimeZone(new Date(day.clockOut), timeZone, 'HH:mm').split(':').map(Number);
                let actualEnd = hour * 60 + minute;
                if (scheduledEnd >= 1440 && actualEnd < scheduledStart) actualEnd += 1440;
                const early = scheduledEnd - actualEnd - Number(policy.gracePeriod?.earlyDeparture || 0);
                if (early > 0) day.exceptions.push({ type: 'early_departure', description: `Clock-out was ${early} minutes before the configured grace period`, minutes: early });
            }
            const scheduledShiftBreaks = (scheduledShiftsByDay.get(formatInTimeZone(day.date, timeZone, 'yyyy-MM-dd')) || [])
                .reduce((sum, shift) => sum + Number(shift.breakMinutes || 0), 0);
            const expectedBreak = scheduledShiftBreaks || Number(policy.breakRules?.minimumBreakMinutes ?? policy.workSchedule?.defaultShift?.breakDuration ?? 0);
            const breakRequiredAfter = Number(policy.breakRules?.requiredAfterMinutes ?? (Number(policy.workSchedule?.standardHoursPerDay || 8) * 60 * 0.75));
            if (expectedBreak > 0 && day.totalMinutes >= breakRequiredAfter && day.breakDuration === 0) {
                day.exceptions.push({ type: 'missed_break', description: `No break was recorded; the configured break is ${expectedBreak} minutes`, minutes: expectedBreak });
            } else if (expectedBreak > 0 && day.breakDuration > expectedBreak) {
                day.exceptions.push({ type: 'long_break', description: `Recorded breaks exceeded the configured duration by ${day.breakDuration - expectedBreak} minutes`, minutes: day.breakDuration - expectedBreak });
            }
        }
    }
    for (const day of dailyEntries) {
        const sourceEntries = entries.filter(entry => day.timeEntryIds.some(id => String(id) === String(entry._id)));
        if (policy.geofencing?.enabled && sourceEntries.some(entry => entry.location && entry.location.verified === false)) {
            day.exceptions.push({ type: 'geofence_failure', description: 'One or more attendance events were outside an allowed location' });
        }
    }
    const completedSessions = sessions.filter(session => session.clockOut).sort((a, b) => new Date(a.clockIn.timestamp) - new Date(b.clockIn.timestamp));
    const minimumRest = Number(policy.restRules?.minimumMinutesBetweenShifts || 0);
    for (let index = 1; index < completedSessions.length && minimumRest > 0; index += 1) {
        const restMinutes = (new Date(completedSessions[index].clockIn.timestamp) - new Date(completedSessions[index - 1].clockOut.timestamp)) / 60000;
        if (restMinutes >= minimumRest) continue;
        const key = formatInTimeZone(completedSessions[index].clockIn.timestamp, timeZone, 'yyyy-MM-dd');
        days.get(key)?.exceptions.push({ type: 'insufficient_rest', description: `Rest between work sessions was ${Math.max(0, Math.round(restMinutes))} minutes; ${minimumRest} minutes is configured`, minutes: Math.max(0, Math.round(minimumRest - restMinutes)) });
    }
    for (const day of dailyEntries) {
        if (day.status === 'absent') day.exceptions.push({ type: 'absence', description: 'No attendance or approved leave was recorded for this scheduled work day' });
    }
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    const thresholdMinutes = Math.max(0, dailyThreshold * 60);

    for (const day of dailyEntries) {
        let dailyOvertime = policy.overtime?.enabled === false ? 0 : Math.max(0, day.totalMinutes - thresholdMinutes);
        if (dailyOvertime > 0 && dailyOvertime < minimumOvertimeMinutes) dailyOvertime = 0;
        const dailyRegular = Math.max(0, day.totalMinutes - dailyOvertime);
        day.regularHours = Number((dailyRegular / 60).toFixed(2));
        day.overtimeHours = Number((dailyOvertime / 60).toFixed(2));
        day.totalHours = Number((day.totalMinutes / 60).toFixed(2));
        regularMinutes += dailyRegular;
        overtimeMinutes += dailyOvertime;
        day.exceptions = Array.from(new Map(day.exceptions.map(item => [`${item.type}:${item.description}`, item])).values());
    }

    if (policy.overtime?.enabled !== false && weeklyThreshold > 0) {
        // Weekly thresholds reset every local Monday. Applying the threshold once
        // to a fortnightly or monthly timesheet incorrectly turns every hour
        // after the first week into overtime.
        const weeks = new Map();
        for (const day of dailyEntries) {
            const localDate = utcToZonedTime(day.date, timeZone);
            const offsetFromMonday = (localDate.getDay() + 6) % 7;
            const monday = new Date(localDate);
            monday.setHours(0, 0, 0, 0);
            monday.setDate(monday.getDate() - offsetFromMonday);
            const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
            if (!weeks.has(weekKey)) weeks.set(weekKey, []);
            weeks.get(weekKey).push(day);
        }

        for (const weekDays of weeks.values()) {
            let weeklyRegularMinutes = weekDays.reduce((sum, day) => sum + Math.round(day.regularHours * 60), 0);
            let weeklyExcess = Math.max(0, weeklyRegularMinutes - weeklyThreshold * 60);
            for (let index = weekDays.length - 1; index >= 0 && weeklyExcess > 0; index -= 1) {
                const day = weekDays[index];
                const available = Math.round(day.regularHours * 60);
                const moved = Math.min(available, weeklyExcess);
                day.regularHours = Number(((available - moved) / 60).toFixed(2));
                day.overtimeHours = Number((day.overtimeHours + moved / 60).toFixed(2));
                regularMinutes -= moved;
                overtimeMinutes += moved;
                weeklyRegularMinutes -= moved;
                weeklyExcess -= moved;
            }
        }
    }

    for (const day of dailyEntries) {
        if (day.overtimeHours > 0) {
            day.exceptions.push({
                type: 'overtime',
                description: `${day.overtimeHours.toFixed(2)} overtime hours were calculated from the configured daily and weekly thresholds`,
                minutes: Math.round(day.overtimeHours * 60),
            });
        }
        day.exceptions = Array.from(new Map(day.exceptions.map(item => [`${item.type}:${item.description}`, item])).values());
    }

    const summary = dailyEntries.reduce((total, day) => {
        total.totalHours += day.totalHours;
        total.regularHours += day.regularHours;
        total.overtimeHours += day.overtimeHours;
        total.breakTime += day.breakDuration;
        if (day.status === 'present') total.daysWorked += 1;
        if (day.status === 'partial') total.daysWorked += 0.5;
        if (day.status === 'absent') total.daysAbsent += 1;
        if (day.status === 'leave') total.daysOnLeave += 1;
        if (day.exceptions.some(item => item.type === 'late_arrival')) total.lateDays += 1;
        if (day.exceptions.some(item => item.type === 'early_departure')) total.earlyDepartures += 1;
        if (day.exceptions.some(item => ['no_clock_out', 'orphan_event', 'duplicate_session'].includes(item.type))) total.incompleteEntries += 1;
        return total;
    }, {
        totalHours: 0,
        regularHours: 0,
        overtimeHours: 0,
        breakTime: 0,
        daysWorked: 0,
        daysAbsent: 0,
        daysOnLeave: 0,
        lateDays: 0,
        earlyDepartures: 0,
        incompleteEntries: 0,
    });

    for (const key of ['totalHours', 'regularHours', 'overtimeHours']) {
        summary[key] = Number(summary[key].toFixed(2));
    }

    return { dailyEntries, summary, timeZone };
}

function canRecalculateTimesheet(timesheet) {
    return EDITABLE_TIMESHEET_STATUSES.has(timesheet?.status || 'draft') && !timesheet?.lockedAt;
}

module.exports = {
    EDITABLE_TIMESHEET_STATUSES,
    LOCKED_TIMESHEET_STATUSES,
    buildSessions,
    calculatePeriod,
    canRecalculateTimesheet,
    enumerateLocalDates,
    getPeriodBounds,
    localDayBounds,
    normalizeLocationSnapshot,
    normalizePeriodType,
    normalizeTimeZone,
    roundMinutes,
};
