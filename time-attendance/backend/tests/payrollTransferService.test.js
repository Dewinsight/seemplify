const { Timesheet, AttendancePolicy, Shift, EmployeeRoster } = require('../models');
const { buildCostAllocationRows, buildTransferPayload, transferOne } = require('../services/payrollTransferService');

function queryResult(value) {
    return { lean: async () => value };
}

afterEach(() => jest.restoreAllMocks());

test('allocates actual approved hours across scheduled cost-coded shifts', () => {
    const rows = buildCostAllocationRows({
        summary: { totalHours: 6 },
        dailyEntries: [{ totalHours: 6, scheduledShiftIds: ['shift-a', 'shift-b'] }],
    }, [
        { _id: 'shift-a', startAt: new Date('2026-08-03T08:00:00Z'), endAt: new Date('2026-08-03T12:00:00Z'), costCentreCode: 'OPS' },
        { _id: 'shift-b', startAt: new Date('2026-08-03T12:00:00Z'), endAt: new Date('2026-08-03T20:00:00Z'), costCentreCode: 'SALES' },
    ]);
    expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ payCode: 'OPS', quantity: 2 }),
        expect.objectContaining({ payCode: 'SALES', quantity: 4 }),
    ]));
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
});

test('does not inflate a coded allocation when part of the worked schedule is uncoded', () => {
    const rows = buildCostAllocationRows({
        dailyEntries: [{ totalHours: 8, scheduledShiftIds: ['shift-coded', 'shift-uncoded'] }],
    }, [
        { _id: 'shift-coded', startAt: new Date('2026-08-03T08:00:00Z'), endAt: new Date('2026-08-03T12:00:00Z'), costCentreCode: 'OPS' },
        { _id: 'shift-uncoded', startAt: new Date('2026-08-03T12:00:00Z'), endAt: new Date('2026-08-03T16:00:00Z') },
    ]);
    expect(rows).toEqual([expect.objectContaining({ payCode: 'OPS', quantity: 4 })]);
});

test('cost allocations use worked hours rather than copying planned shift duration', async () => {
    jest.spyOn(Shift, 'find').mockReturnValue(queryResult([{
        _id: 'shift-1',
        startAt: new Date('2026-08-03T08:00:00Z'),
        endAt: new Date('2026-08-03T20:00:00Z'),
        breakMinutes: 0,
        costCentreCode: 'OPS',
    }]));
    jest.spyOn(EmployeeRoster, 'findOne').mockReturnValue(queryResult({ employeeId: 'EMP-001' }));
    const payload = await buildTransferPayload({
        _id: 'timesheet-cost', version: 1, organizationId: 'org-1', userId: 'employee-1', userEmail: 'employee@example.test',
        startDate: new Date('2026-08-03'), endDate: new Date('2026-08-09'), periodType: 'weekly',
        summary: { regularHours: 6, overtimeHours: 0, breakTime: 0, totalHours: 6 },
        dailyEntries: [{ totalHours: 6, scheduledShiftIds: ['shift-1'] }],
        payrollIntegration: { idempotencyKey: 'timesheet:timesheet-cost:v1' },
    }, { payroll: { payCodes: {} }, overtime: { multiplier: 1.5 } });
    expect(payload.payCodeLines).toContainEqual(expect.objectContaining({ category: 'cost_allocation', quantity: 6 }));
});

test('approved payroll payload carries the signed integration envelope and mapped pay codes', async () => {
    jest.spyOn(Shift, 'find').mockReturnValue(queryResult([]));
    jest.spyOn(EmployeeRoster, 'findOne').mockReturnValue(queryResult({ employeeId: 'EMP-001' }));
    const timesheet = {
        _id: 'timesheet-1', version: 3, organizationId: 'org-1', userId: 'employee-1', userEmail: 'employee@example.test',
        startDate: new Date('2026-08-01'), endDate: new Date('2026-08-07'), periodType: 'weekly',
        approvedBy: { approvedAt: new Date('2026-08-08T09:00:00Z') },
        summary: { regularHours: 8, overtimeHours: 2, breakTime: 60, totalHours: 10 },
        dailyEntries: [{ status: 'holiday', totalHours: 1 }],
        payrollIntegration: { idempotencyKey: 'timesheet:timesheet-1:v3' },
    };
    const payload = await buildTransferPayload(timesheet, { payroll: { payCodes: { regular: 'REG', overtime: 'OT' } }, overtime: { multiplier: 1.5 } });
    expect(payload).toMatchObject({
        schemaVersion: '1.0', eventId: 'timesheet:timesheet-1:v3:approved', organizationId: 'org-1',
        subjectId: 'employee-1', userId: 'employee-1', employeeId: 'EMP-001', correlationId: 'timesheet:timesheet-1:v3',
        idempotencyKey: 'timesheet:timesheet-1:v3', eventType: 'approved_timesheet',
    });
    expect(payload.payCodeLines).toEqual(expect.arrayContaining([
        expect.objectContaining({ payCode: 'REG', category: 'regular', quantity: 7 }),
        expect.objectContaining({ payCode: 'OT', category: 'overtime', quantity: 2 }),
        expect.objectContaining({ category: 'unpaid_break', quantity: 1 }),
        expect.objectContaining({ category: 'holiday', quantity: 1 }),
    ]));
});

test('a corrected approved version sends payroll deltas instead of replacing history', async () => {
    jest.spyOn(Shift, 'find').mockReturnValue(queryResult([]));
    jest.spyOn(EmployeeRoster, 'findOne').mockReturnValue(queryResult({ employeeId: 'EMP-001' }));
    jest.spyOn(Timesheet, 'findById').mockReturnValue(queryResult({
        summary: { regularHours: 8, overtimeHours: 1, breakTime: 30, totalHours: 9 },
        dailyEntries: [],
    }));
    const payload = await buildTransferPayload({
        _id: 'timesheet-2', version: 2, supersedesTimesheetId: 'timesheet-1', organizationId: 'org-1',
        userId: 'employee-1', userEmail: 'employee@example.test', startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-07'), periodType: 'weekly', summary: { regularHours: 9, overtimeHours: 2, breakTime: 60, totalHours: 11 },
        dailyEntries: [], payrollIntegration: { idempotencyKey: 'timesheet:timesheet-2:v2' },
    }, { payroll: { payCodes: {} }, overtime: { multiplier: 1.5 } });
    expect(payload.eventType).toBe('adjustment');
    expect(payload.payCodeLines).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: 'adjustment', quantity: 1, metadata: expect.objectContaining({ adjustmentCategory: 'regular' }) }),
        expect.objectContaining({ category: 'adjustment', quantity: 0.5, metadata: expect.objectContaining({ adjustmentCategory: 'unpaid_break' }) }),
    ]));
});

test('an approved timesheet with no payable data is settled without calling or blocking payroll', async () => {
    jest.spyOn(AttendancePolicy, 'findOne').mockResolvedValue({ payroll: { enabled: true, payCodes: {} } });
    jest.spyOn(Shift, 'find').mockReturnValue(queryResult([]));
    jest.spyOn(EmployeeRoster, 'findOne').mockReturnValue(queryResult({ employeeId: 'EMP-001' }));
    const fetchSpy = jest.spyOn(global, 'fetch');
    const timesheet = {
        _id: 'timesheet-empty', version: 1, organizationId: 'org-1', userId: 'employee-1', userEmail: 'employee@example.test',
        startDate: new Date('2026-08-17'), endDate: new Date('2026-08-24'), periodType: 'weekly', status: 'payroll_pending',
        summary: { regularHours: 0, overtimeHours: 0, breakTime: 0, totalHours: 0 }, dailyEntries: [],
        payrollIntegration: { state: 'failed', exported: false, lastError: 'old failure', nextAttemptAt: new Date() },
        addAuditLog: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
    };

    await expect(transferOne(timesheet)).resolves.toEqual({ skipped: true, reason: 'no_payable_data' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timesheet.status).toBe('approved');
    expect(timesheet.payrollIntegration).toMatchObject({ state: 'no_data', exported: false, lastError: '', nextAttemptAt: null });
    expect(timesheet.addAuditLog).toHaveBeenCalledWith(
        'payroll_skipped',
        'system',
        'Payroll integration',
        null,
        expect.stringMatching(/payroll remains independent/)
    );
    expect(timesheet.save).toHaveBeenCalledTimes(1);
});
