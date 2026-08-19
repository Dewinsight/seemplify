const crypto = require('crypto');
const { Timesheet, AttendancePolicy, Shift, EmployeeRoster } = require('../models');
const { createNotification } = require('./notificationService');

function payrollUrl() {
    return String(process.env.PAYROLL_API_URL || 'http://localhost:5006').replace(/\/$/, '');
}

function payrollSecret() {
    return process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_PAYROLL_SECRET || '';
}

function round(value) {
    return Math.round(Number(value || 0) * 10000) / 10000;
}

async function buildTransferPayload(timesheet, policy) {
    const payCodes = policy?.payroll?.payCodes || {};
    const calculatedRegularHours = round(timesheet.summary?.regularHours);
    const overtimeHours = round(timesheet.summary?.overtimeHours);
    const unpaidBreakHours = round(Number(timesheet.summary?.breakTime || 0) / 60);
    const holidayHours = round((timesheet.dailyEntries || []).filter(entry => entry.status === 'holiday').reduce((sum, entry) => sum + Number(entry.totalHours || 0), 0));
    const regularHours = round(Math.max(0, calculatedRegularHours - holidayHours));
    const previous = timesheet.supersedesTimesheetId
        ? await Timesheet.findById(timesheet.supersedesTimesheetId).lean()
        : null;
    if (timesheet.supersedesTimesheetId && !previous) throw new Error('The superseded timesheet version could not be loaded for payroll adjustment');
    const previousValues = {
        regularHours: round(Math.max(0, Number(previous?.summary?.regularHours || 0) - (previous?.dailyEntries || []).filter(entry => entry.status === 'holiday').reduce((sum, entry) => sum + Number(entry.totalHours || 0), 0))),
        overtimeHours: round(previous?.summary?.overtimeHours),
        unpaidBreakHours: round(Number(previous?.summary?.breakTime || 0) / 60),
        holidayHours: round((previous?.dailyEntries || []).filter(entry => entry.status === 'holiday').reduce((sum, entry) => sum + Number(entry.totalHours || 0), 0)),
    };
    const adjustment = Boolean(previous);
    const payCodeLines = [
        { payCode: payCodes.regular || 'REGULAR', category: 'regular', unit: 'hours', quantity: regularHours, rateMultiplier: 1 },
        { payCode: payCodes.overtime || 'OVERTIME', category: 'overtime', unit: 'hours', quantity: overtimeHours, rateMultiplier: policy?.overtime?.multiplier || 1.5 },
        { payCode: payCodes.unpaidBreak || 'UNPAID_BREAK', category: 'unpaid_break', unit: 'hours', quantity: unpaidBreakHours },
        { payCode: payCodes.holiday || 'HOLIDAY', category: 'holiday', unit: 'hours', quantity: holidayHours, rateMultiplier: policy?.payroll?.holidayRateMultiplier || 1 },
    ].map(line => adjustment ? {
        ...line,
        category: 'adjustment',
        quantity: round(line.quantity - previousValues[({ regular: 'regularHours', overtime: 'overtimeHours', unpaid_break: 'unpaidBreakHours', holiday: 'holidayHours' })[line.category]]),
        metadata: { adjustmentCategory: line.category, supersedesTimesheetId: previous._id },
    } : line).filter(line => Math.abs(line.quantity) > 0.0001);
    const shifts = await Shift.find({
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        startAt: { $lte: timesheet.endDate },
        endAt: { $gte: timesheet.startDate },
        $or: [{ activityCode: { $exists: true, $ne: '' } }, { costCentreCode: { $exists: true, $ne: '' } }],
    }).lean();
    for (const shift of adjustment ? [] : shifts) {
        payCodeLines.push({
            payCode: shift.costCentreCode || shift.activityCode || 'COST_ALLOCATION',
            category: 'cost_allocation',
            unit: 'hours',
            quantity: Math.max(0, round((new Date(shift.endAt) - new Date(shift.startAt) - Number(shift.breakMinutes || 0) * 60000) / 3600000)),
            activityCode: shift.activityCode,
            costCentreCode: shift.costCentreCode,
            date: shift.startAt,
            metadata: { shiftId: shift._id },
        });
    }
    const roster = await EmployeeRoster.findOne({ organizationId: timesheet.organizationId, userId: timesheet.userId }).lean();
    return {
        schemaVersion: '1.0',
        eventId: `timesheet:${timesheet._id}:v${timesheet.version || 1}:${timesheet.supersedesTimesheetId ? 'adjustment' : 'approved'}`,
        organizationId: timesheet.organizationId,
        subjectId: timesheet.userId,
        occurredAt: timesheet.approvedBy?.approvedAt || new Date(),
        userId: timesheet.userId,
        employeeId: roster?.employeeId,
        userEmail: timesheet.userEmail,
        sourceTimesheetId: timesheet._id.toString(),
        sourceVersion: timesheet.version || 1,
        eventType: timesheet.supersedesTimesheetId ? 'adjustment' : 'approved_timesheet',
        supersedesTimesheetId: timesheet.supersedesTimesheetId?.toString(),
        period: { startAt: timesheet.startDate, endAt: timesheet.endDate, type: timesheet.periodType },
        rulePack: { id: timesheet.policySnapshot?.rulePackId, version: timesheet.policySnapshot?.rulePackVersion },
        payCodeLines,
        totals: { regularHours, overtimeHours, unpaidBreakHours, holidayHours, totalHours: round(timesheet.summary?.totalHours) },
        correlationId: `timesheet:${timesheet._id}:v${timesheet.version || 1}`,
        idempotencyKey: timesheet.payrollIntegration?.idempotencyKey || `timesheet:${timesheet._id}:v${timesheet.version || 1}`,
    };
}

async function notifyPayrollFailure(timesheet, error) {
    const recipients = await EmployeeRoster.find({ organizationId: timesheet.organizationId, status: 'active', role: { $in: ['owner', 'admin', 'hr_manager'] } }).lean();
    await Promise.all(recipients.map(recipient => createNotification({
        organizationId: timesheet.organizationId,
        userId: recipient.userId,
        userEmail: recipient.email,
        type: 'payroll_failure',
        title: 'Payroll transfer needs attention',
        message: `The approved timesheet for ${timesheet.userName || timesheet.userEmail} could not be transferred: ${error.message}`,
        actionUrl: `/timesheets/${timesheet._id}`,
        priority: 'high',
        eventKey: `payroll-failed:${timesheet._id}:v${timesheet.version || 1}:attempt${timesheet.payrollIntegration.attempts}`,
    })));
}

async function transferOne(timesheet) {
    const policy = await AttendancePolicy.findOne({ organizationId: timesheet.organizationId });
    if (policy?.payroll?.enabled === false) return { skipped: true, reason: 'disabled' };
    const payload = await buildTransferPayload(timesheet, policy);
    if (!payload.payCodeLines.length) {
        timesheet.payrollIntegration.state = 'no_data';
        timesheet.payrollIntegration.exported = false;
        timesheet.payrollIntegration.lastError = '';
        timesheet.payrollIntegration.nextAttemptAt = null;
        if (timesheet.status === 'payroll_pending') timesheet.status = 'approved';
        timesheet.addAuditLog(
            'payroll_skipped',
            'system',
            'Payroll integration',
            null,
            'No payable or allocatable attendance data; payroll remains independent and will run without a timesheet import'
        );
        await timesheet.save();
        return { skipped: true, reason: 'no_payable_data' };
    }
    const serialized = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const secret = payrollSecret();
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('Payroll service authentication is not configured');
    const signature = secret ? crypto.createHmac('sha256', secret).update(`${timestamp}.${serialized}`).digest('hex') : '';
    timesheet.payrollIntegration.attempts += 1;
    timesheet.payrollIntegration.lastAttemptAt = new Date();
    await timesheet.save();
    const response = await fetch(`${payrollUrl()}/api/integrations/v1/time-attendance/timesheets`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-service-id': 'time-attendance',
            'x-service-timestamp': timestamp,
            'x-service-signature': signature ? `sha256=${signature}` : '',
            'idempotency-key': payload.idempotencyKey,
        },
        body: serialized,
        signal: AbortSignal.timeout(Number(process.env.PAYROLL_TRANSFER_TIMEOUT_MS || 30000)),
    });
    if (!response.ok) {
        let detail;
        try { detail = (await response.json()).error; } catch (_error) { detail = `HTTP ${response.status}`; }
        throw new Error(detail || `Payroll returned HTTP ${response.status}`);
    }
    const result = await response.json();
    timesheet.payrollIntegration.state = 'accepted';
    timesheet.payrollIntegration.exported = true;
    timesheet.payrollIntegration.exportedAt = new Date();
    timesheet.payrollIntegration.acceptedAt = new Date();
    timesheet.payrollIntegration.payrollRunId = result.transferId;
    timesheet.payrollIntegration.lastError = '';
    timesheet.status = 'payroll_exported';
    timesheet.addAuditLog('payroll_exported', 'system', 'Payroll integration', null, `Accepted as ${result.transferId}`);
    await timesheet.save();
    return result;
}

async function transferPendingTimesheets() {
    const pending = await Timesheet.find({
        'payrollIntegration.state': { $in: ['pending', 'adjustment_pending', 'failed'] },
        'payrollIntegration.attempts': { $lt: 10 },
        $or: [
            { 'payrollIntegration.nextAttemptAt': { $exists: false } },
            { 'payrollIntegration.nextAttemptAt': null },
            { 'payrollIntegration.nextAttemptAt': { $lte: new Date() } },
        ],
        lockedAt: { $ne: null },
    }).sort({ 'payrollIntegration.lastAttemptAt': 1 }).limit(50);
    let accepted = 0;
    let failed = 0;
    let skipped = 0;
    for (const timesheet of pending) {
        try {
            const result = await transferOne(timesheet);
            if (result?.skipped) skipped += 1;
            else accepted += 1;
        } catch (error) {
            timesheet.payrollIntegration.state = timesheet.payrollIntegration.attempts >= 10 ? 'dead' : (timesheet.supersedesTimesheetId ? 'adjustment_pending' : 'failed');
            timesheet.payrollIntegration.lastError = String(error.message || error).slice(0, 2000);
            timesheet.payrollIntegration.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 15000 * (2 ** Math.max(0, timesheet.payrollIntegration.attempts - 1))));
            timesheet.addAuditLog('payroll_failed', 'system', 'Payroll integration', null, timesheet.payrollIntegration.lastError);
            await timesheet.save();
            await notifyPayrollFailure(timesheet, error);
            failed += 1;
        }
    }
    return { processed: pending.length, accepted, skipped, failed };
}

module.exports = { buildTransferPayload, transferOne, transferPendingTimesheets };
