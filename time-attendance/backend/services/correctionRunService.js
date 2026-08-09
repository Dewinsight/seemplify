const { CorrectionRun, Timesheet, AttendancePolicy } = require('../models');

async function processCorrectionRun({ correctionRunId }) {
    const run = await CorrectionRun.findById(correctionRunId);
    if (!run || run.status === 'completed') return { skipped: true };
    run.status = 'running'; run.startedAt = new Date(); await run.save();
    try {
        const candidates = await Timesheet.find({
            organizationId: run.organizationId,
            status: { $in: ['approved', 'locked', 'payroll_pending', 'payroll_exported'] },
            startDate: { $lte: run.periodEnd }, endDate: { $gte: run.periodStart },
        }).sort({ version: -1, updatedAt: -1 });
        const latest = new Map();
        for (const item of candidates) {
            const key = `${item.userId}:${item.periodKey || item.startDate.toISOString()}`;
            if (!latest.has(key)) latest.set(key, item);
        }
        run.counts.scanned = latest.size;
        const policy = await AttendancePolicy.findOne({ organizationId: run.organizationId });
        const { refreshTimesheetEntries } = require('../routes/timesheets');
        for (const source of latest.values()) {
            try {
                const existing = await Timesheet.findOne({ correctionRunId: run._id, supersedesTimesheetId: source._id });
                if (existing) { run.counts.skipped += 1; continue; }
                const raw = source.toObject();
                for (const key of ['_id', 'createdAt', 'updatedAt', '__v']) delete raw[key];
                const correction = new Timesheet({
                    ...raw,
                    status: 'adjusted', version: Number(source.version || 1) + 1,
                    supersedesTimesheetId: source._id, correctionRunId: run._id,
                    adjustmentReason: run.reason,
                    lockedAt: null, lockedBy: null, submittedAt: null, submittedNote: null,
                    approvedBy: null, rejectedBy: null, revisionRequestedBy: null,
                    payrollIntegration: { exported: false, state: 'not_ready', attempts: 0 }, auditLog: [],
                });
                correction.addAuditLog('adjustment_created', run.initiatedBy.userId, run.initiatedBy.userName, run.reason, `${run.type} correction run ${run._id}`);
                await correction.save();
                await refreshTimesheetEntries(correction, policy);
                source.addAuditLog('adjustment_created', run.initiatedBy.userId, run.initiatedBy.userName, run.reason, `Correction version ${correction.version} created by run ${run._id}`);
                await source.save();
                run.counts.created += 1;
            } catch (error) {
                run.counts.failed += 1;
                run.failures.push({ timesheetId: source._id.toString(), error: String(error.message || error).slice(0, 1000) });
            }
            await run.save();
        }
        run.status = run.counts.failed ? 'failed' : 'completed'; run.completedAt = new Date(); await run.save();
        return { status: run.status, counts: run.counts };
    } catch (error) {
        run.status = 'failed'; run.completedAt = new Date(); run.failures.push({ error: String(error.message || error).slice(0, 1000) }); await run.save();
        throw error;
    }
}

module.exports = { processCorrectionRun };
