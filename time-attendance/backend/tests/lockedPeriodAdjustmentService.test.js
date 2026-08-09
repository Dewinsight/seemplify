const mongoose = require('mongoose');
const Timesheet = require('../models/Timesheet');
const {
    getLockedPeriodDisposition,
    buildAdjustmentTimesheetPayload,
    ensureVersionedAdjustment,
} = require('../services/lockedPeriodAdjustmentService');

jest.mock('../routes/timesheets', () => ({
    refreshTimesheetEntries: jest.fn(async timesheet => timesheet),
}));

function protectedTimesheet(overrides = {}) {
    return new Timesheet({
        _id: new mongoose.Types.ObjectId(),
        userId: 'employee-1',
        userEmail: 'employee@example.test',
        organizationId: 'org-1',
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-09T23:59:59.999Z'),
        status: 'payroll_exported',
        version: 2,
        lockedAt: new Date('2026-08-09T18:00:00.000Z'),
        payrollIntegration: { exported: true, state: 'accepted' },
        ...overrides,
    });
}

test.each(['clock_out', 'break_end'])('%s remains allowed in a protected attendance period', action => {
    const disposition = getLockedPeriodDisposition(action, protectedTimesheet());
    expect(disposition.allowed).toBe(true);
    expect(disposition.requiresAdjustment).toBe(true);
    expect(disposition.reason).toMatch(/ended after timesheet version 2 was protected/);
});

test.each(['clock_in', 'break_start'])('%s remains blocked in a protected attendance period', action => {
    const disposition = getLockedPeriodDisposition(action, protectedTimesheet());
    expect(disposition).toEqual({ allowed: false, requiresAdjustment: false });
});

test('a protected payroll timesheet produces an editable versioned adjustment payload', () => {
    const source = protectedTimesheet();
    const payload = buildAdjustmentTimesheetPayload(source, 'Safely closed an active session');

    expect(payload.status).toBe('adjusted');
    expect(payload.version).toBe(3);
    expect(payload.supersedesTimesheetId).toEqual(source._id);
    expect(payload.lockedAt).toBeNull();
    expect(payload.payrollIntegration).toMatchObject({ exported: false, state: 'adjustment_pending' });
    expect(payload.auditLog).toEqual([]);
    expect(payload._id).toBeUndefined();
});

test('a terminal event creates and recalculates a correction version without changing protected totals', async () => {
    const source = protectedTimesheet();
    const originalSummary = { totalHours: 40, regularHours: 40 };
    source.summary = originalSummary;
    const findOne = jest.spyOn(Timesheet, 'findOne').mockReturnValue({
        sort: jest.fn().mockResolvedValue(null),
    });
    const save = jest.spyOn(Timesheet.prototype, 'save').mockResolvedValue(undefined);
    const { refreshTimesheetEntries } = require('../routes/timesheets');

    const result = await ensureVersionedAdjustment({
        sourceTimesheet: source,
        entry: { _id: new mongoose.Types.ObjectId() },
        actor: { userId: 'employee-1', userName: 'Employee' },
        action: 'clock_out',
        reason: 'Safely closed an active session',
    });

    expect(result.created).toBe(true);
    expect(result.adjustment.status).toBe('adjusted');
    expect(result.adjustment.version).toBe(3);
    expect(refreshTimesheetEntries).toHaveBeenCalledWith(result.adjustment);
    expect(source.status).toBe('payroll_exported');
    expect(source.summary.toObject()).toMatchObject(originalSummary);
    expect(source.auditLog.at(-1).action).toBe('attendance_event_appended');

    findOne.mockRestore();
    save.mockRestore();
});
