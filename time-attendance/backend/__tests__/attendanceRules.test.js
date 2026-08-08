const { evaluateClockIn, buildPolicySummary } = require('../services/attendanceRulesService');

const policy = {
    timezone: 'Europe/London',
    workSchedule: { workDays: [1, 2, 3, 4, 5], defaultShift: { startTime: '09:00' } },
    clockSettings: { enforceClockInWindow: true, earliestClockInMinutes: 30, latestClockInMinutes: 60, nonWorkingDayClockIn: 'block' },
    geofencing: { enabled: true, enforced: true },
    breakRules: { requiredAfterMinutes: 360, minimumBreakMinutes: 20 },
};

test('clock-in rules evaluate the organization timezone and location requirement', () => {
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T07:00:00Z'), hasLocation: true }).code).toBe('CLOCK_IN_TOO_EARLY');
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T08:45:00Z'), hasLocation: false }).code).toBe('LOCATION_REQUIRED');
    expect(evaluateClockIn(policy, { now: new Date('2026-08-10T08:45:00Z'), hasLocation: true }).allowed).toBe(true);
});

test('policy summary makes explicit clock-in behavior clear', () => {
    expect(buildPolicySummary(policy)).toMatchObject({ explicitClockInRequired: true, autoClockOnLogin: false, locationRequired: true, timezone: 'Europe/London' });
});
