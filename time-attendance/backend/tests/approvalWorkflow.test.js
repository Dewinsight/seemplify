const Timesheet = require('../models/Timesheet');
const { advanceApproval, hasActiveDelegation } = require('../routes/approvals');

function submittedTimesheet() {
    return new Timesheet({
        userId: 'employee-1',
        userEmail: 'employee@example.test',
        organizationId: 'org-1',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-07T23:59:59.999Z'),
        status: 'submitted',
        approvalWorkflow: {
            currentLevel: 0,
            levels: [
                { order: 0, name: 'Manager', approverType: 'line_manager', approverId: 'manager-1' },
                { order: 1, name: 'HR', approverType: 'hr' },
            ],
        },
    });
}

test('multi-level approval advances without locking until the final level', () => {
    const timesheet = submittedTimesheet();
    const first = advanceApproval(timesheet, { userId: 'manager-1', userName: 'Manager' }, 'Reviewed');
    expect(first.completed).toBe(false);
    expect(timesheet.status).toBe('submitted');
    expect(timesheet.lockedAt).toBeUndefined();
    expect(timesheet.approvalWorkflow.currentLevel).toBe(1);
    expect(timesheet.approvalWorkflow.levels[0].status).toBe('approved');
});

test('final approval locks a unique version and queues payroll', () => {
    const timesheet = submittedTimesheet();
    advanceApproval(timesheet, { userId: 'manager-1', userName: 'Manager' }, 'Reviewed');
    const final = advanceApproval(timesheet, { userId: 'hr-1', userName: 'HR' }, 'Final approval');
    expect(final.completed).toBe(true);
    expect(timesheet.status).toBe('payroll_pending');
    expect(timesheet.lockedAt).toBeInstanceOf(Date);
    expect(timesheet.payrollIntegration.idempotencyKey).toContain(`timesheet:${timesheet._id}:v1`);
    expect(timesheet.approvalWorkflow.levels[1].status).toBe('approved');
});

test('delegation is active only inside its configured window', () => {
    const policy = { timesheetSettings: { approvalDelegations: [{ fromUserId: 'manager-1', toUserId: 'delegate-1', startsAt: '2026-08-01', endsAt: '2026-08-31' }] } };
    expect(hasActiveDelegation(policy, 'manager-1', 'delegate-1', new Date('2026-08-15'))).toBe(true);
    expect(hasActiveDelegation(policy, 'manager-1', 'delegate-1', new Date('2026-09-01'))).toBe(false);
});
