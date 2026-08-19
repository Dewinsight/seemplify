const { getTimesheetSubmissionError } = require('../services/timesheetSubmissionService');

describe('timesheet submission readiness', () => {
    test('allows a completed five-hour timesheet before the attendance period ends', () => {
        const result = getTimesheetSubmissionError({
            endDate: new Date('2026-08-23T23:59:59.999Z'),
            summary: { totalHours: 5, incompleteEntries: 0 },
        });

        expect(result).toBeNull();
    });

    test('blocks incomplete or unpaired attendance entries regardless of period end', () => {
        expect(getTimesheetSubmissionError({
            endDate: new Date('2026-08-23T23:59:59.999Z'),
            summary: { totalHours: 5, incompleteEntries: 2 },
        })).toEqual({
            error: 'This timesheet has incomplete or unpaired attendance entries. Correct them before submitting.',
            code: 'INCOMPLETE_ATTENDANCE_ENTRIES',
            incompleteEntries: 2,
        });
    });
});
