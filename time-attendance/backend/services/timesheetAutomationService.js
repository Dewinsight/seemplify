const { AttendancePolicy, Timesheet, EmployeeRoster } = require('../models');
const { refreshTimesheetEntries } = require('../routes/timesheets');

function completeWorkflowAsSystem(timesheet, at) {
    for (const level of timesheet.approvalWorkflow?.levels || []) {
        level.status = 'approved';
        level.decidedBy = 'system';
        level.decidedByName = 'Attendance policy';
        level.decidedAt = at;
        level.comment = 'Automatically approved by organization policy';
    }
    if (timesheet.approvalWorkflow) timesheet.approvalWorkflow.completedAt = at;
}

async function snapshotApprovalWorkflow(timesheet, policy) {
    const roster = await EmployeeRoster.findOne({ organizationId: timesheet.organizationId, userId: timesheet.userId }).lean();
    const configured = policy.timesheetSettings?.approvalLevels?.length
        ? policy.timesheetSettings.approvalLevels
        : [{ name: 'Line manager', approverType: 'line_manager' }];
    const levels = configured.map((level, order) => ({
        order,
        name: level.name || `Approval level ${order + 1}`,
        approverType: level.approverType || 'line_manager',
        approverId: level.approverType === 'line_manager' ? roster?.managerId : level.approverId,
        approverName: level.approverName,
        approverEmail: level.approverEmail,
        status: 'pending',
    }));
    timesheet.approvalWorkflow = { currentLevel: 0, levels };
    const first = levels[0];
    timesheet.assignedApprover = {
        userId: first.approverId,
        userName: first.approverName || first.name,
        userEmail: first.approverEmail,
        assignedAt: new Date(),
    };
}

async function runTimesheetAutomation(now = new Date()) {
    const policies = await AttendancePolicy.find({
        $or: [
            { 'timesheetSettings.autoSubmit': true },
            { 'timesheetSettings.autoApprove': true },
        ],
    });
    let submitted = 0;
    let approved = 0;

    for (const policy of policies) {
        if (policy.timesheetSettings?.autoSubmit) {
            const drafts = await Timesheet.find({
                organizationId: policy.organizationId,
                status: { $in: ['draft', 'adjusted'] },
                endDate: { $lt: now },
                lockedAt: null,
            });
            for (const timesheet of drafts) {
                await refreshTimesheetEntries(timesheet, policy);
                if ((timesheet.summary?.incompleteEntries || 0) > 0) continue;
                await snapshotApprovalWorkflow(timesheet, policy);
                timesheet.status = 'submitted';
                timesheet.submittedAt = now;
                timesheet.submittedNote = 'Automatically submitted after the configured period ended';
                timesheet.addAuditLog('auto_submitted', 'system', 'Attendance policy');
                submitted += 1;
                if (policy.timesheetSettings?.autoApprove) {
                    completeWorkflowAsSystem(timesheet, now);
                    timesheet.status = 'payroll_pending';
                    timesheet.approvedBy = {
                        userId: 'system',
                        userName: 'Attendance policy',
                        approvedAt: now,
                        comment: 'Automatically approved by organization policy',
                    };
                    timesheet.lockedAt = now;
                    timesheet.lockedBy = 'system';
                    timesheet.payrollIntegration.state = 'pending';
                    timesheet.payrollIntegration.idempotencyKey = `timesheet:${timesheet._id}:v${timesheet.version || 1}`;
                    timesheet.addAuditLog('auto_approved', 'system', 'Attendance policy');
                    approved += 1;
                }
                await timesheet.save();
            }
        }

        if (policy.timesheetSettings?.autoApprove) {
            const submissions = await Timesheet.find({
                organizationId: policy.organizationId,
                status: 'submitted',
                'summary.incompleteEntries': { $lte: 0 },
            });
            for (const timesheet of submissions) {
                completeWorkflowAsSystem(timesheet, now);
                timesheet.status = 'payroll_pending';
                timesheet.approvedBy = {
                    userId: 'system',
                    userName: 'Attendance policy',
                    approvedAt: now,
                    comment: 'Automatically approved by organization policy',
                };
                timesheet.lockedAt = now;
                timesheet.lockedBy = 'system';
                timesheet.payrollIntegration.state = 'pending';
                timesheet.payrollIntegration.idempotencyKey = `timesheet:${timesheet._id}:v${timesheet.version || 1}`;
                timesheet.addAuditLog('auto_approved', 'system', 'Attendance policy');
                await timesheet.save();
                approved += 1;
            }
        }
    }
    return { submitted, approved };
}

module.exports = { runTimesheetAutomation };
