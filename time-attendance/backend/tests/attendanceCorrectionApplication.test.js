jest.mock('../models', () => ({
    AttendancePolicy: { findOne: jest.fn() },
    TimeEntry: { find: jest.fn(), insertMany: jest.fn(), updateMany: jest.fn() },
    Timesheet: { findOne: jest.fn() },
}));
jest.mock('../routes/timesheets', () => ({ refreshTimesheetEntries: jest.fn() }));

const { AttendancePolicy, TimeEntry } = require('../models');
const { refreshTimesheetEntries } = require('../routes/timesheets');
const { applyApprovedCorrection } = require('../services/attendanceCorrectionService');

const queryResult = value => ({ setOptions: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
    jest.clearAllMocks();
});

test('approving a correction preserves old punches and applies the proposed work session', async () => {
    const timesheet = {
        _id: 'timesheet-1',
        organizationId: 'org-1',
        organizationName: 'Example Org',
        userId: 'employee-1',
        userEmail: 'employee@example.test',
        userName: 'Alex Morgan',
        teamId: 'team-1',
        teamName: 'Operations',
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-09T23:59:59.999Z'),
        status: 'submitted',
        version: 1,
        policySnapshot: { timezone: 'Europe/London' },
        addAuditLog: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
    };
    const exception = {
        _id: 'exception-1',
        correctionRequest: {
            requestedChanges: {
                workDate: '2026-08-04',
                timezone: 'Europe/London',
                clockIn: new Date('2026-08-04T08:00:00.000Z'),
                clockOut: new Date('2026-08-04T16:00:00.000Z'),
                breakStart: new Date('2026-08-04T12:00:00.000Z'),
                breakEnd: new Date('2026-08-04T12:30:00.000Z'),
            },
        },
    };
    const existing = [
        { _id: 'old-in', entryType: 'clock_in' },
        { _id: 'old-out', entryType: 'clock_out' },
    ];
    const replacements = [
        { _id: 'new-in', entryType: 'clock_in' },
        { _id: 'new-break-start', entryType: 'break_start' },
        { _id: 'new-break-end', entryType: 'break_end' },
        { _id: 'new-out', entryType: 'clock_out' },
    ];
    TimeEntry.find
        .mockReturnValueOnce(queryResult(existing))
        .mockReturnValueOnce(queryResult([]));
    TimeEntry.insertMany.mockResolvedValue(replacements);
    TimeEntry.updateMany.mockResolvedValue({ modifiedCount: 2 });
    AttendancePolicy.findOne.mockResolvedValue(null);
    refreshTimesheetEntries.mockResolvedValue(timesheet);

    const result = await applyApprovedCorrection({
        exception,
        timesheet,
        actor: { userId: 'manager-1', userName: 'Morgan Manager' },
        note: 'The proposed times match the supporting evidence.',
    });

    expect(TimeEntry.insertMany).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ entryType: 'clock_in', source: 'manual', isManualEntry: true, timesheetId: 'timesheet-1' }),
        expect.objectContaining({ entryType: 'break_start' }),
        expect.objectContaining({ entryType: 'break_end' }),
        expect.objectContaining({ entryType: 'clock_out' }),
    ]));
    expect(TimeEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: ['old-in', 'old-out'] } }),
        expect.objectContaining({ $set: expect.objectContaining({ 'correction.state': 'superseded', 'correction.supersededBy': 'manager-1' }) })
    );
    expect(refreshTimesheetEntries).toHaveBeenCalledWith(timesheet, null, { allowLocked: true });
    expect(timesheet.addAuditLog).toHaveBeenCalledWith('correction_applied', 'manager-1', 'Morgan Manager', expect.any(String), expect.stringContaining('2026-08-04'));
    expect(result.replacementEntryIds).toEqual(['new-in', 'new-break-start', 'new-break-end', 'new-out']);
    expect(result.supersededEntryIds).toEqual(['old-in', 'old-out']);
});
