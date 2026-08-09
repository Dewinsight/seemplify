const { Timesheet, Shift, EmployeeRoster } = require('../models');
const { buildTransferPayload } = require('../services/payrollTransferService');

function queryResult(value) {
    return { lean: async () => value };
}

afterEach(() => jest.restoreAllMocks());

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
