const { utcToZonedTime } = require('date-fns-tz');
const { parseTime } = require('./attendanceRulesService');

function round(value) {
    return Math.round(Number(value || 0));
}

function dateKey(value, timezone) {
    const date = utcToZonedTime(new Date(value), timezone || 'UTC');
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function groupEntries(entries, timezone) {
    const groups = new Map();
    entries.forEach(entry => {
        const key = `${entry.userId}|${dateKey(entry.timestamp, timezone)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    });
    return groups;
}

function analyzeDay(entries, policy, timezone) {
    const sorted = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let openClock = null;
    let openBreak = null;
    let workMinutes = 0;
    let breakMinutes = 0;
    let firstClockIn = null;
    let lastClockOut = null;
    let incompleteEntries = 0;
    let continuousStart = null;
    let maximumContinuousMinutes = 0;

    sorted.forEach(entry => {
        const timestamp = new Date(entry.timestamp);
        if (entry.entryType === 'clock_in') {
            if (openClock) incompleteEntries += 1;
            openClock = timestamp;
            continuousStart = timestamp;
            firstClockIn = firstClockIn || timestamp;
        } else if (entry.entryType === 'clock_out') {
            if (openClock) workMinutes += Math.max(0, (timestamp - openClock) / 60000);
            else incompleteEntries += 1;
            if (continuousStart) maximumContinuousMinutes = Math.max(maximumContinuousMinutes, (timestamp - continuousStart) / 60000);
            openClock = null;
            openBreak = null;
            continuousStart = null;
            lastClockOut = timestamp;
        } else if (entry.entryType === 'break_start') {
            if (openBreak) incompleteEntries += 1;
            openBreak = timestamp;
            if (continuousStart) maximumContinuousMinutes = Math.max(maximumContinuousMinutes, (timestamp - continuousStart) / 60000);
            continuousStart = null;
        } else if (entry.entryType === 'break_end') {
            if (openBreak) breakMinutes += Math.max(0, (timestamp - openBreak) / 60000);
            else incompleteEntries += 1;
            openBreak = null;
            if (openClock) continuousStart = timestamp;
        }
    });

    const groupDate = dateKey(sorted[0]?.timestamp, timezone);
    const today = dateKey(new Date(), timezone);
    if (openClock && groupDate === today) {
        workMinutes += Math.max(0, (Date.now() - openClock.getTime()) / 60000);
        if (continuousStart) maximumContinuousMinutes = Math.max(maximumContinuousMinutes, (Date.now() - continuousStart.getTime()) / 60000);
    }
    workMinutes = Math.max(0, workMinutes - breakMinutes);

    const shift = policy?.workSchedule?.defaultShift || {};
    const grace = policy?.gracePeriod || {};
    const firstLocal = firstClockIn ? utcToZonedTime(firstClockIn, timezone) : null;
    const lastLocal = lastClockOut ? utcToZonedTime(lastClockOut, timezone) : null;
    const lateMinutes = firstLocal
        ? Math.max(0, firstLocal.getHours() * 60 + firstLocal.getMinutes() - parseTime(shift.startTime, '09:00') - Number(grace.lateArrival || 0))
        : 0;
    const earlyDepartureMinutes = lastLocal
        ? Math.max(0, parseTime(shift.endTime, '17:00') - (lastLocal.getHours() * 60 + lastLocal.getMinutes()) - Number(grace.earlyDeparture || 0))
        : 0;
    const breakRules = policy?.breakRules || {};
    const breakShortfall = workMinutes >= Number(breakRules.requiredAfterMinutes || 360)
        ? Math.max(0, Number(breakRules.minimumBreakMinutes || 20) - breakMinutes)
        : 0;
    const maximumMinutes = Number(policy?.clockSettings?.autoClockOut?.afterHours || 10) * 60;
    const longShiftMinutes = Math.max(0, workMinutes - maximumMinutes);
    const continuousWorkOverage = Math.max(0, maximumContinuousMinutes - Number(breakRules.maximumContinuousWorkMinutes || 360));
    const manualEntries = sorted.filter(entry => entry.isManualEntry || entry.source === 'manual').length;
    const unverifiedLocations = sorted.filter(entry => entry.location?.latitude != null && entry.location?.verified === false).length;
    const sources = Array.from(new Set(sorted.map(entry => entry.source || 'web')));

    const exceptions = [];
    if (openClock) exceptions.push({ type: 'open_session', minutes: 0, severity: 'high' });
    if (incompleteEntries) exceptions.push({ type: 'incomplete_entries', count: incompleteEntries, severity: 'high' });
    if (lateMinutes) exceptions.push({ type: 'late_arrival', minutes: round(lateMinutes), severity: 'medium' });
    if (earlyDepartureMinutes) exceptions.push({ type: 'early_departure', minutes: round(earlyDepartureMinutes), severity: 'medium' });
    if (breakShortfall) exceptions.push({ type: 'break_shortfall', minutes: round(breakShortfall), severity: 'medium' });
    if (longShiftMinutes) exceptions.push({ type: 'long_shift', minutes: round(longShiftMinutes), severity: 'high' });
    if (continuousWorkOverage) exceptions.push({ type: 'continuous_work_limit', minutes: round(continuousWorkOverage), severity: 'medium' });
    if (manualEntries) exceptions.push({ type: 'manual_entry', count: manualEntries, severity: 'review' });
    if (unverifiedLocations) exceptions.push({ type: 'unverified_location', count: unverifiedLocations, severity: 'review' });

    return {
        userId: sorted[0]?.userId,
        userName: sorted[0]?.userName || sorted[0]?.userEmail || 'Unknown',
        userEmail: sorted[0]?.userEmail,
        teamName: sorted[0]?.teamName || 'Unassigned',
        date: groupDate,
        firstClockIn,
        lastClockOut,
        workMinutes: round(workMinutes),
        breakMinutes: round(breakMinutes),
        sources,
        exceptions,
    };
}

function buildAttendanceExceptions(entries, policy) {
    const timezone = policy?.timezone || 'UTC';
    const rows = Array.from(groupEntries(entries, timezone).values())
        .map(group => analyzeDay(group, policy, timezone))
        .filter(row => row.exceptions.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date) || a.userName.localeCompare(b.userName));

    const counts = {};
    rows.forEach(row => row.exceptions.forEach(exception => {
        counts[exception.type] = (counts[exception.type] || 0) + 1;
    }));
    const sourceCounts = {};
    entries.forEach(entry => {
        const source = entry.source || 'web';
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });

    return {
        rows,
        summary: {
            affectedPeople: new Set(rows.map(row => row.userId)).size,
            affectedDays: rows.length,
            totalExceptions: Object.values(counts).reduce((sum, count) => sum + count, 0),
            counts,
            sourceCounts,
        },
    };
}

module.exports = { buildAttendanceExceptions, analyzeDay };
