const { Timesheet } = require('../models');

const TERMINAL_ACTIONS = new Set(['clock_out', 'break_end']);
const EDITABLE_ADJUSTMENT_STATUSES = ['draft', 'rejected', 'revision_requested', 'adjusted'];

function getLockedPeriodDisposition(action, lockedTimesheet) {
    if (!lockedTimesheet) return { allowed: true, requiresAdjustment: false };
    if (TERMINAL_ACTIONS.has(action)) {
        return {
            allowed: true,
            requiresAdjustment: true,
            reason: `Active ${action === 'clock_out' ? 'attendance session' : 'break'} ended after timesheet version ${lockedTimesheet.version || 1} was protected`,
        };
    }
    return { allowed: false, requiresAdjustment: false };
}

function buildAdjustmentTimesheetPayload(sourceTimesheet, reason) {
    const source = typeof sourceTimesheet.toObject === 'function'
        ? sourceTimesheet.toObject()
        : { ...sourceTimesheet };
    for (const key of ['_id', 'createdAt', 'updatedAt', '__v']) delete source[key];

    return {
        ...source,
        status: 'adjusted',
        version: Number(sourceTimesheet.version || 1) + 1,
        supersedesTimesheetId: sourceTimesheet._id,
        adjustmentReason: reason,
        lockedAt: null,
        lockedBy: null,
        submittedAt: null,
        submittedNote: null,
        approvedBy: null,
        rejectedBy: null,
        revisionRequestedBy: null,
        payrollIntegration: {
            exported: false,
            state: sourceTimesheet.payrollIntegration?.exported || sourceTimesheet.status === 'payroll_exported'
                ? 'adjustment_pending'
                : 'not_ready',
            attempts: 0,
        },
        auditLog: [],
    };
}

async function ensureVersionedAdjustment({ sourceTimesheet, entry, actor, action, reason }) {
    let adjustment = await Timesheet.findOne({
        supersedesTimesheetId: sourceTimesheet._id,
        status: { $in: EDITABLE_ADJUSTMENT_STATUSES },
    }).sort({ version: -1, updatedAt: -1 });
    let created = false;

    if (!adjustment) {
        adjustment = new Timesheet(buildAdjustmentTimesheetPayload(sourceTimesheet, reason));
        adjustment.addAuditLog(
            'adjustment_created',
            actor.userId,
            actor.userName,
            reason,
            `Created automatically so ${action} event ${entry._id} can be included without changing protected version ${sourceTimesheet.version || 1}`
        );
        await adjustment.save();
        created = true;
    } else {
        adjustment.addAuditLog(
            'attendance_event_appended',
            actor.userId,
            actor.userName,
            reason,
            `${action} event ${entry._id} added to correction version ${adjustment.version}`
        );
    }

    sourceTimesheet.addAuditLog(
        'attendance_event_appended',
        actor.userId,
        actor.userName,
        reason,
        `${action} event ${entry._id} was recorded in correction version ${adjustment.version}; this protected version was not recalculated`
    );
    await sourceTimesheet.save();

    // Loaded lazily to avoid a route-initialization cycle. The adjustment is
    // editable, so it can safely be recalculated from the newly appended event.
    const { refreshTimesheetEntries } = require('../routes/timesheets');
    await refreshTimesheetEntries(adjustment);

    return { adjustment, created };
}

module.exports = {
    getLockedPeriodDisposition,
    buildAdjustmentTimesheetPayload,
    ensureVersionedAdjustment,
};
