const Timesheet = require('../models/Timesheet');
const AttendanceException = require('../models/AttendanceException');
const { approvalReadiness } = require('../routes/approvals');
const { exceptionView } = require('../routes/exceptions');
const { isApprovalBlockingType } = require('../services/exceptionService');

function reviewTimesheet() {
    return new Timesheet({
        _id: '6895fd26d4e1c42068317a01',
        organizationId: 'org-1',
        organizationName: 'Example Org',
        userId: 'employee-1',
        userName: 'Alex Morgan',
        userEmail: 'alex@example.com',
        teamName: 'Operations',
        periodType: 'weekly',
        weekNumber: 32,
        year: 2026,
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-09T23:59:59.999Z'),
        status: 'submitted',
        summary: { incompleteEntries: 0 },
    });
}

test('approval readiness names the exact blocking day and ignores resolved review flags', () => {
    const timesheet = reviewTimesheet();
    const open = {
        _id: 'exception-open',
        type: 'no_clock_out',
        status: 'open',
        approvalBlocking: true,
        occurrenceDate: new Date('2026-08-05T00:00:00.000Z'),
        description: 'Missing clock out',
    };
    const resolved = { ...open, _id: 'exception-resolved', status: 'resolved' };

    expect(approvalReadiness(timesheet, [open, resolved])).toEqual(expect.objectContaining({
        canApprove: false,
        incompleteEntries: 0,
        openExceptionCount: 1,
        blockingExceptions: [expect.objectContaining({
            id: 'exception-open',
            type: 'no_clock_out',
            occurrenceDate: open.occurrenceDate,
        })],
    }));
    expect(approvalReadiness(timesheet, [resolved]).canApprove).toBe(true);
});

test('incomplete paired attendance blocks approval even before a persisted exception is shown', () => {
    const timesheet = reviewTimesheet();
    timesheet.summary.incompleteEntries = 2;
    expect(approvalReadiness(timesheet, [])).toEqual(expect.objectContaining({
        canApprove: false,
        incompleteEntries: 2,
    }));
});

test('exception view includes employee, period, rule, correction decision and audit context', () => {
    const timesheet = reviewTimesheet();
    const exception = new AttendanceException({
        organizationId: 'org-1',
        userId: 'employee-1',
        userName: 'Alex Morgan',
        userEmail: 'alex@example.com',
        timesheetId: timesheet._id,
        timesheetVersion: 1,
        occurrenceDate: new Date('2026-08-05T00:00:00.000Z'),
        type: 'absence',
        ruleKey: 'attendance.absence',
        description: 'No attendance was recorded.',
        explanation: 'No attendance or approved leave was recorded.',
        source: 'manager',
        approvalBlocking: true,
        fingerprint: 'exception-fingerprint',
        status: 'resolved',
        correctionRequest: {
            explanation: 'Approved leave had not synced.',
            decision: 'accepted',
            reviewNote: 'Leave evidence was verified.',
        },
        auditLog: [{ action: 'correction_accepted', actorId: 'manager-1', actorName: 'Morgan Manager', details: 'Leave evidence was verified.' }],
    });

    const value = exceptionView(exception, timesheet);
    expect(value.employee).toEqual(expect.objectContaining({ name: 'Alex Morgan', email: 'alex@example.com', teamName: 'Operations' }));
    expect(value.period).toEqual(expect.objectContaining({ timesheetId: String(timesheet._id), weekNumber: 32, userId: 'employee-1' }));
    expect(value.explanation.message).toBe('No attendance or approved leave was recorded.');
    expect(value.rule.code).toBe('attendance.absence');
    expect(value.correctionRequest).toEqual(expect.objectContaining({ decision: 'accepted', reviewNote: 'Leave evidence was verified.' }));
});

test('only structurally incomplete attendance types block approval by default', () => {
    expect(isApprovalBlockingType('no_clock_out')).toBe(true);
    expect(isApprovalBlockingType('leave_conflict')).toBe(true);
    expect(isApprovalBlockingType('late_arrival')).toBe(false);
    expect(isApprovalBlockingType('absence')).toBe(false);
});
