const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope } = require('../middleware/auth');
const { Timesheet, AttendancePolicy, AttendanceException } = require('../models');
const { createNotification } = require('../services/notificationService');
const { refreshTimesheetEntries } = require('./timesheets');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);
router.use(async (req, res, next) => {
    try {
        if (isHRAdmin(req) || isLineManager(req) || isDepartmentHead(req)) return next();
        const policy = await AttendancePolicy.findOne({ organizationId: req.organizationId }).lean();
        const delegated = (policy?.timesheetSettings?.approvalDelegations || []).some(delegation => (
            String(delegation.toUserId) === String(req.user.id)
            && new Date(delegation.startsAt) <= new Date()
            && new Date(delegation.endsAt) >= new Date()
        ));
        if (delegated) return next();
        return res.status(403).json({ error: 'Manager or active approval-delegate access required' });
    } catch (error) {
        return next(error);
    }
});

function activeApprovalLevel(timesheet) {
    const levels = timesheet.approvalWorkflow?.levels || [];
    return levels[Number(timesheet.approvalWorkflow?.currentLevel || 0)] || null;
}

function hasActiveDelegation(policy, fromUserId, toUserId, now = new Date()) {
    if (!fromUserId || !toUserId) return false;
    return (policy?.timesheetSettings?.approvalDelegations || []).some(delegation => (
        String(delegation.fromUserId) === String(fromUserId)
        && String(delegation.toUserId) === String(toUserId)
        && new Date(delegation.startsAt) <= now
        && new Date(delegation.endsAt) >= now
    ));
}

function approvalScopeQuery(req, policy) {
    const userId = String(req.user.id);
    const delegatedFrom = (policy?.timesheetSettings?.approvalDelegations || [])
        .filter(delegation => hasActiveDelegation(policy, delegation.fromUserId, userId))
        .map(delegation => String(delegation.fromUserId));
    const scope = [
        { 'assignedApprover.userId': userId },
        ...(delegatedFrom.length ? [{ 'assignedApprover.userId': { $in: delegatedFrom } }] : []),
    ];
    if (isDepartmentHead(req)) scope.push({ userId: { $in: getDepartmentHeadScope(req).directReports } });
    return { $or: scope };
}

function canApproveTimesheet(req, timesheet, policy) {
    if (isHRAdmin(req)) return true;
    const userId = String(req.user.id);
    const level = activeApprovalLevel(timesheet);
    if (level?.approverType === 'department_head') {
        return isDepartmentHead(req) && getDepartmentHeadScope(req).directReports.includes(String(timesheet.userId));
    }
    const expectedApprover = level?.approverId || timesheet.assignedApprover?.userId;
    return String(expectedApprover || '') === userId || hasActiveDelegation(policy, expectedApprover, userId);
}

function advanceApproval(timesheet, actor, comment) {
    if (!timesheet.approvalWorkflow) timesheet.approvalWorkflow = { currentLevel: 0, levels: [] };
    const levels = timesheet.approvalWorkflow?.levels || [];
    const currentIndex = Number(timesheet.approvalWorkflow?.currentLevel || 0);
    const level = levels[currentIndex];
    if (level) {
        level.status = 'approved';
        level.decidedBy = actor.userId;
        level.decidedByName = actor.userName;
        level.decidedAt = new Date();
        level.comment = comment;
        timesheet.addAuditLog('approved', actor.userId, actor.userName, comment, `Approval level ${currentIndex + 1}: ${level.name}`);
    }
    const nextIndex = levels.findIndex((candidate, index) => index > currentIndex && candidate.status === 'pending');
    if (nextIndex >= 0) {
        const next = levels[nextIndex];
        timesheet.approvalWorkflow.currentLevel = nextIndex;
        timesheet.assignedApprover = {
            userId: next.approverId,
            userName: next.approverName || next.name,
            userEmail: next.approverEmail,
            assignedAt: new Date(),
        };
        return { completed: false, next };
    }

    timesheet.status = 'payroll_pending';
    timesheet.approvalWorkflow.completedAt = new Date();
    timesheet.approvedBy = {
        userId: actor.userId,
        userName: actor.userName,
        userEmail: actor.userEmail,
        approvedAt: new Date(),
        comment,
    };
    if (!level) timesheet.addAuditLog('approved', actor.userId, actor.userName, comment);
    timesheet.lockedAt = new Date();
    timesheet.lockedBy = actor.userId;
    timesheet.payrollIntegration.state = 'pending';
    timesheet.payrollIntegration.idempotencyKey = `timesheet:${timesheet._id}:v${timesheet.version || 1}`;
    timesheet.addAuditLog('payroll_queued', actor.userId, actor.userName, null, 'Queued for automatic Payroll transfer');
    return { completed: true, next: null };
}

function approvalReadiness(timesheet, exceptionRows = []) {
    const incompleteEntries = Number(timesheet.summary?.incompleteEntries || 0);
    const blockingExceptions = exceptionRows
        .filter(item => item.approvalBlocking && ['open', 'correction_requested'].includes(item.status))
        .map(item => ({
            id: String(item._id),
            type: item.type,
            status: item.status,
            occurrenceDate: item.occurrenceDate,
            description: item.description,
            employeeExplanation: item.correctionRequest?.explanation,
        }));
    return {
        canApprove: incompleteEntries === 0 && blockingExceptions.length === 0,
        incompleteEntries,
        blockingExceptions,
        openExceptionCount: exceptionRows.filter(item => ['open', 'correction_requested'].includes(item.status)).length,
    };
}

// Get pending approvals
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { status = 'submitted', limit = 20 } = req.query;

        const query = {
            organizationId,
            status,
        };

        const policy = await AttendancePolicy.findOne({ organizationId }).lean();
        // If not HR admin, include direct assignments, active delegations and
        // department-head scope, then enforce the current level in memory.
        if (!isHRAdmin(req)) {
            Object.assign(query, approvalScopeQuery(req, policy));
        }

        const candidates = await Timesheet.find(query)
            .sort({ submittedAt: -1 })
            .limit(Math.min(500, Math.max(parseInt(limit) * 5, 50)));
        const timesheets = (status === 'submitted' && !isHRAdmin(req)
            ? candidates.filter(timesheet => canApproveTimesheet(req, timesheet, policy))
            : candidates).slice(0, parseInt(limit));

        // Approval must use the current attendance calculation, not the
        // snapshot from submission. Refresh the visible queue before it is
        // rendered so incomplete/unpaired entries are shown as blockers and
        // managers do not discover them through a failed approval request.
        if (status === 'submitted') {
            for (const timesheet of timesheets) {
                await refreshTimesheetEntries(timesheet, policy, { allowLocked: true });
            }
        }

        const exceptionRows = timesheets.length
            ? await AttendanceException.find({
                organizationId,
                timesheetId: { $in: timesheets.map(item => item._id) },
                status: { $in: ['open', 'correction_requested'] },
            }).lean()
            : [];
        const exceptionsByTimesheet = exceptionRows.reduce((map, item) => {
            const key = String(item.timesheetId);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
            return map;
        }, new Map());
        const responseTimesheets = timesheets.map(item => ({
            ...item.toObject(),
            approvalReadiness: approvalReadiness(item, exceptionsByTimesheet.get(String(item._id)) || []),
        }));

        res.json({
            timesheets: responseTimesheets,
            count: responseTimesheets.length,
        });
    } catch (error) {
        console.error('Get approvals error:', error);
        res.status(500).json({ error: 'Failed to get approvals' });
    }
});

// Get approval history (approved/rejected timesheets)
router.get('/history', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { limit = 50 } = req.query;

        const query = {
            organizationId,
            status: { $in: ['approved', 'payroll_pending', 'payroll_exported', 'locked', 'rejected', 'revision_requested'] },
        };

        // If not HR admin, only show timesheets this manager processed
        if (!isHRAdmin(req)) {
            if (isDepartmentHead(req)) {
                query.userId = { $in: getDepartmentHeadScope(req).directReports };
            } else {
            query.$or = [
                { 'approvedBy.userId': userId },
                { 'rejectedBy.userId': userId },
                { 'revisionRequestedBy.userId': userId },
                { 'approvalWorkflow.levels.decidedBy': userId },
            ];
            }
        }

        const timesheets = await Timesheet.find(query)
            .sort({ updatedAt: -1 })
            .limit(parseInt(limit));

        res.json({
            timesheets,
            count: timesheets.length,
        });
    } catch (error) {
        console.error('Get approval history error:', error);
        res.status(500).json({ error: 'Failed to get approval history' });
    }
});

// Get approval counts by status
router.get('/counts', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const matchQuery = { organizationId };
        if (!isHRAdmin(req)) {
            const policy = await AttendancePolicy.findOne({ organizationId }).lean();
            Object.assign(matchQuery, approvalScopeQuery(req, policy));
        }

        const counts = await Timesheet.aggregate([
            { $match: matchQuery },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);

        const result = {
            submitted: 0,
            approved: 0,
            rejected: 0,
            revision_requested: 0,
        };

        for (const c of counts) {
            result[c._id] = c.count;
        }

        res.json(result);
    } catch (error) {
        console.error('Get approval counts error:', error);
        res.status(500).json({ error: 'Failed to get counts' });
    }
});

// Approve a timesheet
router.post('/:id/approve', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { comment } = req.body;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
            status: 'submitted',
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found or already processed' });
        }

        const policy = await AttendancePolicy.findOne({ organizationId });
        await refreshTimesheetEntries(timesheet, policy, { allowLocked: true });

        const activeExceptions = await AttendanceException.find({
            organizationId,
            timesheetId: timesheet._id,
            status: { $in: ['open', 'correction_requested'] },
        }).lean();
        const readiness = approvalReadiness(timesheet, activeExceptions);

        if (!readiness.canApprove) {
            return res.status(409).json({
                error: 'Attendance issues must be reviewed or corrected before approval',
                code: 'INCOMPLETE_ATTENDANCE',
                incompleteEntries: readiness.incompleteEntries,
                approvalReadiness: readiness,
            });
        }

        if (!canApproveTimesheet(req, timesheet, policy)) {
            return res.status(403).json({ error: 'Not authorized to approve this timesheet' });
        }

        const outcome = advanceApproval(timesheet, {
            userId,
            userName: req.user.name,
            userEmail: req.user.email,
        }, comment);

        await timesheet.save();

        if (outcome.completed) {
            await createNotification({
                organizationId, userId: timesheet.userId, userEmail: timesheet.userEmail,
                type: 'timesheet_status', title: 'Timesheet approved',
                message: `${req.user.name || 'Your manager'} completed approval of your timesheet.`,
                actionUrl: `/timesheets/${timesheet._id}`, priority: 'normal',
                eventKey: `timesheet-approved:${timesheet._id}:v${timesheet.version || 1}`,
                channels: { email: policy?.notifications?.emailOnApproval === true },
            });
        } else if (outcome.next?.approverId) {
            await createNotification({
                organizationId, userId: outcome.next.approverId, userEmail: outcome.next.approverEmail,
                type: 'timesheet_status', title: 'Timesheet awaiting your approval',
                message: `${timesheet.userName || timesheet.userEmail} reached ${outcome.next.name}.`,
                actionUrl: '/approvals', priority: 'normal',
                eventKey: `timesheet-approval-level:${timesheet._id}:v${timesheet.version || 1}:${timesheet.approvalWorkflow.currentLevel}`,
                channels: { email: policy?.notifications?.emailOnSubmission === true },
            });
        }

        res.json({
            success: true,
            timesheet,
            message: outcome.completed ? 'Timesheet approved' : `Approval recorded; ${outcome.next.name} is next`,
        });
    } catch (error) {
        console.error('Approve timesheet error:', error);
        res.status(500).json({ error: 'Failed to approve timesheet' });
    }
});

// Reject a timesheet
router.post('/:id/reject', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
            status: 'submitted',
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found or already processed' });
        }

        const policy = await AttendancePolicy.findOne({ organizationId });
        if (!canApproveTimesheet(req, timesheet, policy)) {
            return res.status(403).json({ error: 'Not authorized to reject this timesheet' });
        }

        timesheet.status = 'rejected';
        const level = activeApprovalLevel(timesheet);
        if (level) {
            level.status = 'rejected';
            level.decidedBy = userId;
            level.decidedByName = req.user.name;
            level.decidedAt = new Date();
            level.comment = reason;
        }
        timesheet.rejectedBy = {
            userId,
            userName: req.user.name,
            userEmail: req.user.email,
            rejectedAt: new Date(),
            reason,
        };
        timesheet.addAuditLog('rejected', userId, req.user.name, reason);

        await timesheet.save();

        // Send email notification to employee
        await createNotification({
            organizationId, userId: timesheet.userId, userEmail: timesheet.userEmail,
            type: 'timesheet_status', title: 'Timesheet rejected', message: reason,
            actionUrl: `/timesheets/${timesheet._id}`, priority: 'high',
            eventKey: `timesheet-rejected:${timesheet._id}:v${timesheet.version || 1}:${timesheet.updatedAt?.getTime?.() || Date.now()}`,
            channels: { email: policy?.notifications?.emailOnRejection === true },
        });

        res.json({
            success: true,
            timesheet,
            message: 'Timesheet rejected',
        });
    } catch (error) {
        console.error('Reject timesheet error:', error);
        res.status(500).json({ error: 'Failed to reject timesheet' });
    }
});

// Request revision
router.post('/:id/request-revision', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Revision reason is required' });
        }

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
            status: 'submitted',
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found or already processed' });
        }

        const policy = await AttendancePolicy.findOne({ organizationId });
        if (!canApproveTimesheet(req, timesheet, policy)) return res.status(403).json({ error: 'Not authorized' });

        timesheet.status = 'revision_requested';
        timesheet.revisionRequestedBy = {
            userId,
            userName: req.user.name,
            requestedAt: new Date(),
            reason,
        };
        timesheet.addAuditLog('revision_requested', userId, req.user.name, reason);

        await timesheet.save();

        await createNotification({
            organizationId,
            userId: timesheet.userId,
            userEmail: timesheet.userEmail,
            type: 'timesheet_status',
            title: 'Timesheet changes requested',
            message: reason,
            actionUrl: `/timesheets/${timesheet._id}`,
            priority: 'high',
            eventKey: `timesheet-revision:${timesheet._id}:v${timesheet.version || 1}:${timesheet.revisionRequestedBy.requestedAt.toISOString()}`,
            channels: { email: policy?.notifications?.emailOnRejection === true },
        });

        res.json({
            success: true,
            timesheet,
            message: 'Revision requested',
        });
    } catch (error) {
        console.error('Request revision error:', error);
        res.status(500).json({ error: 'Failed to request revision' });
    }
});

// Revert an approved/rejected timesheet back to draft (undo approval)
router.post('/:id/revert', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { reason } = req.body;

        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ 
                error: 'Reason is required (minimum 5 characters)',
                code: 'REASON_REQUIRED'
            });
        }

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Only allow a correction workflow for processed records.
        if (!['approved', 'locked', 'payroll_pending', 'payroll_exported', 'rejected', 'revision_requested'].includes(timesheet.status)) {
            return res.status(400).json({
                error: 'Can only revert approved, rejected, or revision-requested timesheets',
                code: 'INVALID_STATUS',
                currentStatus: timesheet.status,
            });
        }

        // Only HR admin can revert timesheets
        if (!isHRAdmin(req)) {
            return res.status(403).json({ 
                error: 'Only HR administrators can revert timesheets',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        const previousStatus = timesheet.status;
        const protectedStatus = ['approved', 'locked', 'payroll_pending', 'payroll_exported'].includes(previousStatus)
            || Boolean(timesheet.lockedAt)
            || timesheet.payrollIntegration?.exported;
        let resultTimesheet = timesheet;

        if (protectedStatus) {
            const source = timesheet.toObject();
            delete source._id;
            delete source.createdAt;
            delete source.updatedAt;
            delete source.__v;
            resultTimesheet = new Timesheet({
                ...source,
                status: 'adjusted',
                version: (timesheet.version || 1) + 1,
                supersedesTimesheetId: timesheet._id,
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
                    state: timesheet.payrollIntegration?.exported ? 'adjustment_pending' : 'not_ready',
                },
                auditLog: [],
            });
            resultTimesheet.addAuditLog('adjustment_created', userId, req.user.name, reason, `Correction for immutable version ${timesheet.version || 1}`);
            timesheet.addAuditLog('adjustment_created', userId, req.user.name, reason, `Correction version ${resultTimesheet.version} created`);
            await timesheet.save();
            await resultTimesheet.save();
        } else {
            timesheet.status = 'draft';
            timesheet.submittedAt = null;
            timesheet.submittedNote = null;
            timesheet.approvedBy = null;
            timesheet.rejectedBy = null;
            timesheet.revisionRequestedBy = null;
            timesheet.addAuditLog('updated', userId, req.user.name, reason, `Returned from ${previousStatus} to draft`);
            await timesheet.save();
        }

        res.json({
            success: true,
            timesheet: resultTimesheet,
            message: protectedStatus ? 'A correction version was created; the approved record remains immutable' : `Timesheet returned from ${previousStatus} to draft`,
            previousStatus,
            correctionCreated: protectedStatus,
        });
    } catch (error) {
        console.error('Revert timesheet error:', error);
        res.status(500).json({ error: 'Failed to revert timesheet' });
    }
});

// Delete a timesheet entirely (HR admin only)
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { reason } = req.body;

        // Only HR admin can delete timesheets
        if (!isHRAdmin(req)) {
            return res.status(403).json({ 
                error: 'Only HR administrators can delete timesheets',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ 
                error: 'Reason is required (minimum 5 characters)',
                code: 'REASON_REQUIRED'
            });
        }

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        if (timesheet.lockedAt || ['approved', 'locked', 'payroll_pending', 'payroll_exported'].includes(timesheet.status) || timesheet.payrollIntegration?.exported) {
            return res.status(409).json({
                error: 'Approved or payroll-linked timesheets cannot be deleted. Create an adjustment instead.',
                code: 'TIMESHEET_IMMUTABLE',
            });
        }

        // Store info for response before deletion
        const deletedInfo = {
            id: timesheet._id,
            userId: timesheet.userId,
            userName: timesheet.userName,
            weekNumber: timesheet.weekNumber,
            year: timesheet.year,
            status: timesheet.status,
        };

        // Delete the timesheet
        await Timesheet.deleteOne({ _id: req.params.id, organizationId });

        console.log(`🗑️ Timesheet deleted by ${req.user.name}: Week ${deletedInfo.weekNumber}/${deletedInfo.year} for ${deletedInfo.userName}. Reason: ${reason}`);

        res.json({
            success: true,
            message: 'Timesheet deleted successfully',
            deleted: deletedInfo,
            deletedBy: {
                userId,
                userName: req.user.name,
                reason,
                deletedAt: new Date(),
            },
        });
    } catch (error) {
        console.error('Delete timesheet error:', error);
        res.status(500).json({ error: 'Failed to delete timesheet' });
    }
});

// Bulk approve timesheets
router.post('/bulk-approve', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { timesheetIds, comment } = req.body;

        if (!Array.isArray(timesheetIds) || timesheetIds.length === 0) {
            return res.status(400).json({ error: 'No timesheets specified' });
        }

        const query = {
            _id: { $in: timesheetIds },
            organizationId,
            status: 'submitted',
        };

        const policy = await AttendancePolicy.findOne({ organizationId });
        const timesheets = await Timesheet.find(query).limit(100);
        let completedCount = 0;
        let advancedCount = 0;
        let skippedCount = 0;
        for (const timesheet of timesheets) {
            await refreshTimesheetEntries(timesheet, policy, { allowLocked: true });
            if (Number(timesheet.summary?.incompleteEntries || 0) > 0) {
                skippedCount += 1;
                continue;
            }
            if (!canApproveTimesheet(req, timesheet, policy)) {
                skippedCount += 1;
                continue;
            }
            const outcome = advanceApproval(timesheet, {
                userId,
                userName: req.user.name,
                userEmail: req.user.email,
            }, comment || 'Bulk approved');
            await timesheet.save();
            if (outcome.completed) {
                completedCount += 1;
                await createNotification({
                    organizationId, userId: timesheet.userId, userEmail: timesheet.userEmail,
                    type: 'timesheet_status', title: 'Timesheet approved',
                    message: `${req.user.name || 'Your manager'} completed approval of your timesheet.`,
                    actionUrl: `/timesheets/${timesheet._id}`, priority: 'normal',
                    eventKey: `timesheet-approved:${timesheet._id}:v${timesheet.version || 1}`,
                    channels: { email: policy?.notifications?.emailOnApproval === true },
                });
            } else {
                advancedCount += 1;
            }
        }

        res.json({
            success: true,
            approvedCount: completedCount,
            advancedCount,
            skippedCount,
            message: `${completedCount} completed and ${advancedCount} advanced to the next approval level`,
        });
    } catch (error) {
        console.error('Bulk approve error:', error);
        res.status(500).json({ error: 'Failed to bulk approve' });
    }
});

module.exports = router;
module.exports.activeApprovalLevel = activeApprovalLevel;
module.exports.advanceApproval = advanceApproval;
module.exports.hasActiveDelegation = hasActiveDelegation;
module.exports.approvalReadiness = approvalReadiness;
