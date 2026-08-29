const { buildShiftGenerationKey, enumerateTemplateShifts } = require('../services/shiftTemplateGenerationService');

describe('shift template generation', () => {
    test('generates a two-week rotating cycle from configured offsets', () => {
        const shifts = enumerateTemplateShifts({
            template: {
                scheduleType: 'rotating',
                startTime: '22:00',
                endTime: '06:00',
                breakMinutes: 30,
                rotation: { cycleDays: 14, activeDays: [0, 1, 2, 7, 8, 9] },
            },
            startDate: '2026-08-03',
            endDate: '2026-08-16',
            timezone: 'Europe/London',
        });
        expect(shifts).toHaveLength(6);
        expect(shifts[0].startAt.toISOString()).toBe('2026-08-03T21:00:00.000Z');
        expect(shifts[0].endAt.toISOString()).toBe('2026-08-04T05:00:00.000Z');
        expect(shifts[3].startAt.toISOString()).toBe('2026-08-10T21:00:00.000Z');
    });

    test('uses weekdays for fixed template batches', () => {
        const shifts = enumerateTemplateShifts({
            template: { scheduleType: 'fixed', startTime: '09:00', endTime: '17:00' },
            startDate: '2026-08-03',
            endDate: '2026-08-09',
            timezone: 'UTC',
        });
        expect(shifts).toHaveLength(5);
    });

    test('builds a stable tenant, template, subject, and instant idempotency key', () => {
        const input = {
            organizationId: 'org-1',
            templateId: 'template-1',
            userId: 'employee-1',
            startAt: '2026-08-03T08:00:00.000Z',
        };
        expect(buildShiftGenerationKey(input)).toBe(buildShiftGenerationKey({ ...input }));
        expect(buildShiftGenerationKey(input)).not.toBe(buildShiftGenerationKey({ ...input, userId: 'employee-2' }));
    });
});
