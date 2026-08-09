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

    test('builds configured fortnightly and semi-monthly periods', () => {
        const fortnight = getPeriodBounds(new Date('2026-08-05T12:00:00Z'), 'fortnightly', 'UTC');
        expect(fortnight.start.toISOString()).toBe('2026-08-03T00:00:00.000Z');
        expect(fortnight.end.toISOString()).toBe('2026-08-16T23:59:59.999Z');

        const secondHalf = getPeriodBounds(new Date('2026-08-20T12:00:00Z'), 'semi-monthly', 'UTC');
        expect(secondHalf.start.toISOString()).toBe('2026-08-16T00:00:00.000Z');
        expect(secondHalf.end.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    });
});
