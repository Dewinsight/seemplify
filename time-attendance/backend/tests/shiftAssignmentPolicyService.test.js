const {
    availabilityAllows,
    localDateKey,
    weekBounds,
} = require('../services/shiftAssignmentPolicyService');

describe('shift assignment policy helpers', () => {
    test('uses a Monday-to-Monday weekly window', () => {
        const result = weekBounds('2026-08-29T12:00:00.000Z');
        expect(result.start.toISOString()).toBe('2026-08-24T00:00:00.000Z');
        expect(result.end.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    test('uses local Monday boundaries across a timezone offset', () => {
        const result = weekBounds('2026-08-30T23:30:00.000Z', 'Europe/London');
        expect(result.start.toISOString()).toBe('2026-08-30T23:00:00.000Z');
        expect(result.end.toISOString()).toBe('2026-09-06T23:00:00.000Z');
    });

    test('derives the date in the shift timezone', () => {
        expect(localDateKey('2026-08-29T23:30:00.000Z', 'Europe/London')).toBe('2026-08-30');
    });

    test('enforces unavailable days and configured time windows', () => {
        const shift = {
            startAt: '2026-08-29T08:00:00.000Z',
            endAt: '2026-08-29T16:00:00.000Z',
            timezone: 'UTC',
        };
        expect(availabilityAllows({ available: false }, shift)).toBe(false);
        expect(availabilityAllows({ available: true, startTime: '08:00', endTime: '16:00' }, shift)).toBe(true);
        expect(availabilityAllows({ available: true, startTime: '09:00', endTime: '16:00' }, shift)).toBe(false);
    });
});
