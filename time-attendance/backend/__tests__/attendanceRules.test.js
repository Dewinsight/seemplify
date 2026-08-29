const { evaluateClockIn, evaluateLocationPolicy, buildPolicySummary, calculateDailyDurations, getPolicyDayBounds, inferDayStartState } = require('../services/attendanceRulesService');

const policy = {
    timezone: 'Europe/London',
    workSchedule: { type: 'fixed', standardHoursPerDay: 7.5, workDays: [1, 2, 3, 4, 5], defaultShift: { startTime: '09:00', endTime: '17:00', breakDuration: 30 } },
    clockSettings: { enforceClockInWindow: true, earliestClockInMinutes: 30, latestClockInMinutes: 60, nonWorkingDayClockIn: 'block' },
    geofencing: { enabled: true, enforced: true },
    breakRules: { requiredAfterMinutes: 360, minimumBreakMinutes: 20 },
    notifications: { clockInReminder: true, clockInReminderMinutesAfter: 20, clockOutReminder: true, clockOutReminderMinutesAfter: 10 },
};

test('clock-in rules evaluate the organization timezone and location requirement', () => {
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T07:00:00Z'), hasLocation: true }).code).toBe('CLOCK_IN_TOO_EARLY');
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T08:45:00Z'), hasLocation: false }).code).toBe('LOCATION_REQUIRED');
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T08:45:00Z'), hasLocation: true }).allowed).toBe(true);
});

test('clock-in windows use the actual published shift instant for overnight work', () => {
    const overnightPolicy = {
        ...policy,
        workSchedule: {
            ...policy.workSchedule,
            workDays: [1, 2],
            defaultShift: {
                startTime: '22:00',
                endTime: '06:00',
                startAt: new Date('2026-08-10T21:00:00.000Z'),
                endAt: new Date('2026-08-11T05:00:00.000Z'),
            },
        },
        geofencing: { enabled: false, enforced: false },
    };
    expect(evaluateClockIn(overnightPolicy, { now: new Date('2026-08-10T20:00:00.000Z') }).code).toBe('CLOCK_IN_TOO_EARLY');
    expect(evaluateClockIn(overnightPolicy, { now: new Date('2026-08-10T21:30:00.000Z') }).allowed).toBe(true);
    expect(evaluateClockIn(overnightPolicy, { now: new Date('2026-08-10T22:30:00.000Z') }).code).toBe('CLOCK_IN_WINDOW_CLOSED');
});

test('policy summary makes explicit clock-in behavior clear', () => {
    expect(buildPolicySummary(policy)).toMatchObject({
        explicitClockInRequired: true,
        autoClockOnLogin: false,
        locationEnabled: true,
        locationRequired: true,
        maximumLocationAccuracyMeters: 250,
        timezone: 'Europe/London',
        workDays: [1, 2, 3, 4, 5],
        scheduleType: 'fixed',
        standardHoursPerDay: 7.5,
        shiftStart: '09:00',
        shiftEnd: '17:00',
        shiftBreakMinutes: 30,
        clockInReminderMinutesAfter: 20,
        clockOutReminderMinutesAfter: 10,
    });
});

test('location accuracy has no effect when geofencing is disabled', () => {
    expect(evaluateLocationPolicy({
        geofencing: { enabled: false, enforced: true },
        clockSettings: { maximumLocationAccuracyMeters: 50 },
    }, { hasLocation: true, accuracy: 5000 })).toMatchObject({
        allowed: true,
        enabled: false,
        enforced: false,
        shouldValidate: false,
        warnings: [],
    });
});

test('location accuracy warns in evidence mode and blocks only in enforcement mode', () => {
    const evidencePolicy = {
        geofencing: { enabled: true, enforced: false },
        clockSettings: { maximumLocationAccuracyMeters: 100 },
    };
    const evidenceResult = evaluateLocationPolicy(evidencePolicy, { hasLocation: true, accuracy: 600 });
    expect(evidenceResult.allowed).toBe(true);
    expect(evidenceResult.shouldValidate).toBe(false);
    expect(evidenceResult.warnings[0]).toContain('100m');

    expect(evaluateLocationPolicy({ ...evidencePolicy, geofencing: { enabled: true, enforced: true } }, { hasLocation: true, accuracy: 600 })).toMatchObject({
        allowed: false,
        code: 'LOCATION_ACCURACY_TOO_LOW',
        maximumAccuracyMeters: 100,
    });
});

test('daily durations exclude an active break from worked time', () => {
    const durations = calculateDailyDurations([
        { entryType: 'clock_in', timestamp: new Date('2026-08-10T09:00:00Z') },
        { entryType: 'break_start', timestamp: new Date('2026-08-10T12:30:00Z') },
    ], {
        now: new Date('2026-08-10T13:00:00Z'),
        isClockedIn: true,
        isOnBreak: true,
    });

    expect(durations.timeWorkedMinutes).toBe(210);
    expect(durations.breakMinutes).toBe(30);
});

test('policy day bounds use local midnight rather than UTC midnight', () => {
    const bounds = getPolicyDayBounds(new Date('2026-08-10T23:30:00Z'), 'Europe/London');

    expect(bounds.start.toISOString()).toBe('2026-08-10T23:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-08-11T22:59:59.999Z');
});

test('day-start state detects clock and break sessions carried from the prior local day', () => {
    const dayStart = new Date('2026-08-10T23:00:00Z');
    const state = inferDayStartState([], {
        dayStart,
        isClockedIn: true,
        lastClockEntry: { entryType: 'clock_in', timestamp: new Date('2026-08-10T21:00:00Z') },
        isOnBreak: true,
        lastBreakEntry: { entryType: 'break_start', timestamp: new Date('2026-08-10T22:30:00Z') },
    });

    expect(state).toEqual({ clockedInAtDayStart: true, onBreakAtDayStart: true });

    const endedToday = inferDayStartState([
        { entryType: 'break_end', timestamp: new Date('2026-08-10T23:20:00Z') },
        { entryType: 'clock_out', timestamp: new Date('2026-08-11T00:00:00Z') },
    ], { dayStart });

    expect(endedToday).toEqual({ clockedInAtDayStart: true, onBreakAtDayStart: true });
});

test('daily durations carry an active clock across local midnight and clamp it to the day boundary', () => {
    const dayStart = new Date('2026-08-10T23:00:00Z');
    const durations = calculateDailyDurations([], {
        now: new Date('2026-08-10T23:45:00Z'),
        dayStart,
        clockedInAtDayStart: true,
        isClockedIn: true,
    });

    expect(durations.timeWorkedMinutes).toBe(45);
    expect(durations.breakMinutes).toBe(0);
});

test('daily durations carry an active break across local midnight', () => {
    const dayStart = new Date('2026-08-10T23:00:00Z');
    const durations = calculateDailyDurations([], {
        now: new Date('2026-08-10T23:30:00Z'),
        dayStart,
        clockedInAtDayStart: true,
        onBreakAtDayStart: true,
        isClockedIn: true,
        isOnBreak: true,
    });

    expect(durations.timeWorkedMinutes).toBe(0);
    expect(durations.breakMinutes).toBe(30);
});

test('daily durations carry a pre-midnight break and preserve work after it ends today', () => {
    const dayStart = new Date('2026-08-10T23:00:00Z');
    const durations = calculateDailyDurations([
        { entryType: 'break_end', timestamp: new Date('2026-08-10T23:20:00Z') },
    ], {
        now: new Date('2026-08-11T00:00:00Z'),
        dayStart,
        clockedInAtDayStart: true,
        onBreakAtDayStart: true,
        isClockedIn: true,
        isOnBreak: false,
    });

    expect(durations.timeWorkedMinutes).toBe(40);
    expect(durations.breakMinutes).toBe(20);
});
