const {
    buildSessions,
    calculatePeriod,
    getPeriodBounds,
} = require('../services/timeCalculationService');

function entry(entryType, timestamp, extra = {}) {
    return { entryType, timestamp: new Date(timestamp), ...extra };
}

describe('timeCalculationService', () => {
    const policy = {
        timezone: 'UTC',
        workSchedule: { workDays: [1, 2, 3, 4, 5], standardHoursPerDay: 8, standardHoursPerWeek: 40 },
        overtime: { enabled: true, dailyThreshold: 8, weeklyThreshold: 40, minimumIncrementMinutes: 0 },
        clockSettings: { rounding: { enabled: false } },
    };

    test('pairs multiple work sessions and each break exactly once', () => {
        const entries = [
            entry('clock_in', '2026-08-03T08:00:00Z'),
            entry('break_start', '2026-08-03T10:00:00Z'),
            entry('break_end', '2026-08-03T10:15:00Z'),
            entry('clock_out', '2026-08-03T12:00:00Z'),
            entry('clock_in', '2026-08-03T13:00:00Z'),
            entry('break_start', '2026-08-03T15:00:00Z'),
            entry('break_end', '2026-08-03T15:30:00Z'),
            entry('clock_out', '2026-08-03T18:00:00Z'),
        ];
        const period = { start: new Date('2026-08-03T00:00:00Z'), end: new Date('2026-08-03T23:59:59Z') };
        const result = calculatePeriod(entries, period, policy);
        expect(result.dailyEntries[0].sessions).toHaveLength(2);
        expect(result.dailyEntries[0].breakDuration).toBe(45);
        expect(result.dailyEntries[0].totalMinutes).toBe(495);
        expect(result.dailyEntries[0].regularHours).toBe(8);
        expect(result.dailyEntries[0].overtimeHours).toBe(0.25);
    });

    test('keeps an overnight session on the local clock-in day', () => {
        const entries = [
            entry('clock_in', '2026-08-03T22:00:00Z'),
            entry('clock_out', '2026-08-04T06:00:00Z'),
        ];
        const result = calculatePeriod(entries, {
            start: new Date('2026-08-03T00:00:00Z'),
            end: new Date('2026-08-04T23:59:59Z'),
        }, policy);
        expect(result.dailyEntries[0].totalHours).toBe(8);
        expect(result.dailyEntries[1].totalHours).toBe(0);
    });

    test('moves regular time above the weekly threshold into overtime', () => {
        const entries = [];
        for (let day = 3; day <= 7; day += 1) {
            const date = `2026-08-0${day}`;
            entries.push(entry('clock_in', `${date}T08:00:00Z`));
            entries.push(entry('clock_out', `${date}T17:00:00Z`));
        }
        const result = calculatePeriod(entries, {
            start: new Date('2026-08-03T00:00:00Z'),
            end: new Date('2026-08-09T23:59:59Z'),
        }, { ...policy, overtime: { ...policy.overtime, dailyThreshold: 12 } });
        expect(result.summary.totalHours).toBe(45);
        expect(result.summary.regularHours).toBe(40);
        expect(result.summary.overtimeHours).toBe(5);
    });

    test('uses published shifts as the authoritative attendance schedule', () => {
        const result = calculatePeriod([], {
            start: new Date('2026-08-29T00:00:00Z'),
            end: new Date('2026-08-31T23:59:59Z'),
        }, {
            ...policy,
            schedulingSettings: { usePublishedShiftsAsAttendanceSchedule: true },
        }, {
            shifts: [{
                _id: 'shift-1',
                startAt: new Date('2026-08-29T08:00:00Z'),
                endAt: new Date('2026-08-29T16:00:00Z'),
                breakMinutes: 30,
            }],
            schedulePublications: [{ periodStart: '2026-08-29T00:00:00Z', periodEnd: '2026-08-31T23:59:59Z' }],
        });

        expect(result.dailyEntries[0]).toMatchObject({
            status: 'absent',
            scheduledShiftIds: ['shift-1'],
            scheduledMinutes: 450,
        });
        expect(result.dailyEntries[0].exceptions.map(item => item.type)).toContain('absence');
        expect(result.dailyEntries[2].status).toBe('weekend');
        expect(result.dailyEntries[2].exceptions.map(item => item.type)).not.toContain('absence');
    });

    test('treats publication end instants as exclusive schedule coverage', () => {
        const result = calculatePeriod([], {
            start: new Date('2026-08-31T00:00:00Z'),
            end: new Date('2026-08-31T23:59:59Z'),
        }, {
            ...policy,
            schedulingSettings: { usePublishedShiftsAsAttendanceSchedule: true },
        }, {
            schedulePublications: [{ periodStart: '2026-08-24T00:00:00Z', periodEnd: '2026-08-31T00:00:00Z' }],
        });
        expect(result.dailyEntries[0].status).toBe('absent');
        expect(result.dailyEntries[0].exceptions.map(item => item.type)).toContain('absence');
    });

    test('resets the weekly overtime threshold inside fortnightly periods', () => {
        const entries = [];
        for (let day = 3; day <= 14; day += 1) {
            const date = new Date(Date.UTC(2026, 7, day));
            if ([0, 6].includes(date.getUTCDay())) continue;
            const localDay = String(day).padStart(2, '0');
            entries.push(entry('clock_in', `2026-08-${localDay}T09:00:00Z`));
            entries.push(entry('clock_out', `2026-08-${localDay}T17:00:00Z`));
        }

        const result = calculatePeriod(entries, {
            start: new Date('2026-08-03T00:00:00Z'),
            end: new Date('2026-08-16T23:59:59Z'),
        }, { ...policy, overtime: { ...policy.overtime, dailyThreshold: 12 } });

        expect(result.summary).toMatchObject({ totalHours: 80, regularHours: 80, overtimeHours: 0 });
    });

    test('detects duplicate sessions without multiplying break pairs', () => {
        const result = buildSessions([
            entry('clock_in', '2026-08-03T08:00:00Z'),
            entry('clock_in', '2026-08-03T09:00:00Z'),
            entry('clock_out', '2026-08-03T17:00:00Z'),
        ]);
        expect(result.sessions).toHaveLength(2);
        expect(result.sessions[0].exceptions[0].type).toBe('duplicate_session');
    });

    test('normalizes empty Mongoose-style locations without corrupting timesheet entries', () => {
        const emptyLocation = { toObject: () => ({}) };
        const populatedLocation = {
            toObject: () => ({ latitude: 51.5074, longitude: -0.1278, verified: true }),
        };
        const result = calculatePeriod([
            entry('clock_in', '2026-08-03T08:00:00Z', { location: emptyLocation }),
            entry('clock_out', '2026-08-03T17:00:00Z', { location: populatedLocation }),
        ], {
            start: new Date('2026-08-03T00:00:00Z'),
            end: new Date('2026-08-03T23:59:59Z'),
        }, policy);

        expect(result.dailyEntries[0].clockInLocation).toBeNull();
        expect(result.dailyEntries[0].clockOutLocation).toEqual({
            latitude: 51.5074,
            longitude: -0.1278,
            verified: true,
        });
    });

    test('creates geofence exceptions only while geofencing is enabled', () => {
        const entries = [
            entry('clock_in', '2026-08-03T08:00:00Z', { _id: 'in-1', location: { latitude: 1, longitude: 1, verified: false } }),
            entry('clock_out', '2026-08-03T17:00:00Z', { _id: 'out-1', location: { latitude: 1, longitude: 1, verified: false } }),
        ];
        const period = { start: new Date('2026-08-03T00:00:00Z'), end: new Date('2026-08-03T23:59:59Z') };
        const disabled = calculatePeriod(entries, period, { ...policy, geofencing: { enabled: false } });
        const enabled = calculatePeriod(entries, period, { ...policy, geofencing: { enabled: true } });

        expect(disabled.dailyEntries[0].exceptions.map(item => item.type)).not.toContain('geofence_failure');
        expect(enabled.dailyEntries[0].exceptions.map(item => item.type)).toContain('geofence_failure');
    });

    test('treats approved leave as an explained attendance state rather than an absence', () => {
        const result = calculatePeriod([], {
            start: new Date('2026-08-10T00:00:00Z'),
            end: new Date('2026-08-10T23:59:59Z'),
        }, policy, {
            leaves: [{ startAt: '2026-08-10T00:00:00Z', endAt: '2026-08-10T23:59:59Z' }],
        });

        expect(result.dailyEntries[0].status).toBe('leave');
        expect(result.dailyEntries[0].exceptions.map(item => item.type)).not.toContain('absence');
        expect(result.summary).toMatchObject({ daysOnLeave: 1, daysAbsent: 0, daysWorked: 0 });
    });

    test('keeps real clocked time on a leave day and flags the overlap for review', () => {
        const result = calculatePeriod([
            entry('clock_in', '2026-08-10T09:00:00Z'),
            entry('clock_out', '2026-08-10T12:00:00Z'),
        ], {
            start: new Date('2026-08-10T00:00:00Z'),
            end: new Date('2026-08-10T23:59:59Z'),
        }, policy, {
            leaves: [{ startAt: '2026-08-10T00:00:00Z', endAt: '2026-08-10T23:59:59Z' }],
        });

        expect(result.dailyEntries[0].status).toBe('present');
        expect(result.dailyEntries[0].totalHours).toBe(3);
        expect(result.dailyEntries[0].exceptions.map(item => item.type)).toContain('leave_conflict');
        expect(result.summary).toMatchObject({ daysOnLeave: 0, daysAbsent: 0, daysWorked: 1 });
    });

    test('builds configured fortnightly and semi-monthly periods', () => {
        const fortnight = getPeriodBounds(new Date('2026-08-05T12:00:00Z'), 'fortnightly', 'UTC');
        expect(fortnight.start.toISOString()).toBe('2026-08-03T00:00:00.000Z');
        expect(fortnight.end.toISOString()).toBe('2026-08-16T23:59:59.999Z');

        const secondHalf = getPeriodBounds(new Date('2026-08-20T12:00:00Z'), 'semi-monthly', 'UTC');
        expect(secondHalf.start.toISOString()).toBe('2026-08-16T00:00:00.000Z');
        expect(secondHalf.end.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    });
});
