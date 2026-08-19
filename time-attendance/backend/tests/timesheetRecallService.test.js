const { canRecallTimesheet, resetTimesheetForRecall } = require('../services/timesheetRecallService');

test.each(['submitted', 'pending'])('%s timesheets remain recallable', status => {
    expect(canRecallTimesheet({ status })).toBe(true);
});

test.each(['failed', 'no_data', 'not_ready'])('approved attendance with payroll state %s can be recalled', state => {
    expect(canRecallTimesheet({ status: 'approved', payrollIntegration: { state, exported: false } })).toBe(true);
    expect(canRecallTimesheet({ status: 'payroll_pending', payrollIntegration: { state, exported: false } })).toBe(true);
});

test.each([
    { state: 'accepted' },
    { state: 'no_data', exported: true },
    { state: 'no_data', acceptedAt: new Date() },
    { state: 'no_data', payrollRunId: 'run-1' },
])('payroll-protected attendance cannot be recalled: %p', payrollIntegration => {
    expect(canRecallTimesheet({ status: 'approved', payrollIntegration })).toBe(false);
});

test('recall returns approval and optional payroll state to a clean draft', () => {
    const timesheet = {
        status: 'payroll_pending',
        lockedAt: new Date(),
        lockedBy: 'manager-1',
        submittedAt: new Date(),
        submittedNote: 'Ready',
        approvedBy: { userId: 'manager-1' },
        assignedApprover: { userId: 'manager-1' },
        approvalWorkflow: { completedAt: new Date() },
        employeeAttestation: { accepted: true },
        payrollIntegration: { state: 'failed', attempts: 7, lastError: 'No data' },
    };

    resetTimesheetForRecall(timesheet);

    expect(timesheet).toMatchObject({
        status: 'draft',
        lockedAt: null,
        lockedBy: null,
        submittedAt: null,
        submittedNote: null,
        payrollIntegration: {
            state: 'not_ready',
            exported: false,
            attempts: 0,
            lastError: '',
        },
    });
    expect(timesheet.approvedBy).toBeUndefined();
    expect(timesheet.approvalWorkflow).toBeUndefined();
});
