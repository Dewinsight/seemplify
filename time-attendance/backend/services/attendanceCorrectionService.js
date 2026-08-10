const { AttendancePolicy, TimeEntry, Timesheet } = require('../models');
const { buildAdjustmentTimesheetPayload } = require('./lockedPeriodAdjustmentService');

const PROTECTED_STATUSES = new Set(['approved', 'locked', 'payroll_pending', 'payroll_exported']);

function validTimestamp(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
}

function normalizeRequestedChanges(input = {}, timesheet) {
    const workDate = String(input.workDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: 'Choose the work date being corrected' };
    const clockIn = validTimestamp(input.clockIn);
    const clockOut = validTimestamp(input.clockOut);
    if (!clockIn || !clockOut) return { error: 'Corrected clock-in and clock-out times are required' };
    if (clockOut <= clockIn) return { error: 'Clock-out must be after clock-in' };
    if ((clockOut - clockIn) > 24 * 60 * 60 * 1000) return { error: 'A corrected work session cannot exceed 24 hours' };
    if (clockIn < new Date(timesheet.startDate) || clockOut > new Date(timesheet.endDate)) {
        return { error: 'Corrected times must stay inside this timesheet period' };
    }
    const breakStart = input.breakStart ? validTimestamp(input.breakStart) : null;
    const breakEnd = input.breakEnd ? validTimestamp(input.breakEnd) : null;
    if (Boolean(breakStart) !== Boolean(breakEnd)) return { error: 'Enter both break start and break end, or leave both blank' };
    if (breakStart && (breakStart <= clockIn || breakEnd >= clockOut || breakEnd <= breakStart)) {
        return { error: 'Break times must be in order and inside the corrected work session' };
    }
    return {
        value: {
            workDate,
            timezone: String(input.timezone || timesheet.policySnapshot?.timezone || 'UTC').slice(0, 100),
            clockIn,
            clockOut,
            breakStart,
            breakEnd,
        },
    };
}

async function correctionTargetTimesheet(timesheet, actor, reason) {
    if (!PROTECTED_STATUSES.has(timesheet.status)) return { target: timesheet, createdAdjustment: false };
    let target = await Timesheet.findOne({
        supersedesTimesheetId: timesheet._id,
        adjustmentReason: { $regex: `Correction request` },
        status: { $in: ['draft', 'rejected', 'revision_requested', 'adjusted'] },
    }).sort({ version: -1 });
    if (target) return { target, createdAdjustment: false };
    target = new Timesheet(buildAdjustmentTimesheetPayload(timesheet, reason));
    target.addAuditLog('adjustment_created', actor.userId, actor.userName, reason, `Created from protected timesheet version ${timesheet.version || 1}`);
    await target.save();
    timesheet.addAuditLog('adjustment_created', actor.userId, actor.userName, reason, `Correction version ${target.version} created; this protected version was not changed`);
    await timesheet.save();
    return { target, createdAdjustment: true };
}

async function applyApprovedCorrection({ exception, timesheet, actor, note }) {
    const normalized = normalizeRequestedChanges(exception.correctionRequest?.requestedChanges || {}, timesheet);
    if (normalized.error) return { status: 400, error: normalized.error };
    const change = normalized.value;
    const reason = `Correction request ${exception._id}: ${note}`.slice(0, 500);
    const { target, createdAdjustment } = await correctionTargetTimesheet(timesheet, actor, reason);

    const dayStart = new Date(`${change.workDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${change.workDate}T23:59:59.999Z`);
    const existing = await TimeEntry.find({
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        timestamp: { $gte: dayStart, $lte: dayEnd },
    }).setOptions({ includeSuperseded: true });

    const desired = [
        ['clock_in', change.clockIn],
        ...(change.breakStart ? [['break_start', change.breakStart], ['break_end', change.breakEnd]] : []),
        ['clock_out', change.clockOut],
    ];
    const existingReplacement = await TimeEntry.find({
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        'correction.exceptionId': exception._id,
        'correction.state': 'active',
    }).setOptions({ includeSuperseded: true });

    let replacements = existingReplacement;
    if (!replacements.length) {
        const byType = existing.reduce((map, entry) => {
            if (!map.has(entry.entryType)) map.set(entry.entryType, []);
            map.get(entry.entryType).push(entry._id);
            return map;
        }, new Map());
        replacements = await TimeEntry.insertMany(desired.map(([entryType, timestamp]) => ({
            userId: timesheet.userId,
            userEmail: timesheet.userEmail,
            userName: timesheet.userName,
            organizationId: timesheet.organizationId,
            organizationName: timesheet.organizationName,
            teamId: timesheet.teamId,
            teamName: timesheet.teamName,
            entryType,
            timestamp,
            timezone: change.timezone,
            source: 'manual',
            note: reason,
            isManualEntry: true,
            timesheetId: target._id,
            modifiedBy: { userId: actor.userId, userName: actor.userName, modifiedAt: new Date(), reason },
            correction: {
                state: 'active',
                exceptionId: exception._id,
                replacesEntryIds: byType.get(entryType) || [],
                reason,
                appliedAt: new Date(),
            },
        })));
    }

    const replacementIds = new Set(replacements.map(entry => String(entry._id)));
    const supersededIds = existing.filter(entry => !replacementIds.has(String(entry._id))).map(entry => entry._id);
    if (supersededIds.length) {
        await TimeEntry.updateMany(
            { _id: { $in: supersededIds }, 'correction.state': { $ne: 'superseded' } },
            { $set: {
                'correction.state': 'superseded',
                'correction.exceptionId': exception._id,
                'correction.supersededAt': new Date(),
                'correction.supersededBy': actor.userId,
                'correction.supersededByName': actor.userName,
                'correction.reason': reason,
            } }
        );
    }

    const policy = await AttendancePolicy.findOne({ organizationId: timesheet.organizationId });
    const { refreshTimesheetEntries } = require('../routes/timesheets');
    await refreshTimesheetEntries(target, policy, { allowLocked: true });
    target.addAuditLog('correction_applied', actor.userId, actor.userName, note, `${change.workDate}: ${change.clockIn.toISOString()} to ${change.clockOut.toISOString()}`);
    await target.save();

    return {
        target,
        createdAdjustment,
        supersededEntryIds: supersededIds.map(String),
        replacementEntryIds: replacements.map(entry => String(entry._id)),
        requestedChanges: change,
    };
}

module.exports = {
    PROTECTED_STATUSES,
    normalizeRequestedChanges,
    applyApprovedCorrection,
};
