const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireManager, isHRAdmin } = require('../middleware/auth');
const { Timesheet, AttendancePolicy } = require('../models');
const emailService = require('../services/emailService');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);
router.use(requireManager);

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

        // If not HR admin, only show timesheets assigned to this manager
        if (!isHRAdmin(req)) {
            query['assignedApprover.userId'] = userId;
        }

        const timesheets = await Timesheet.find(query)
            .sort({ submittedAt: -1 })
            .limit(parseInt(limit));

        res.json({
            timesheets,
            count: timesheets.length,
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
            status: { $in: ['approved', 'rejected', 'revision_requested'] },
        };

        // If not HR admin, only show timesheets this manager processed
        if (!isHRAdmin(req)) {
            query.$or = [
                { 'approvedBy.userId': userId },
                { 'rejectedBy.userId': userId },
                { 'revisionRequestedBy.userId': userId },
            ];
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
            matchQuery['assignedApprover.userId'] = userId;
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

        // Verify approver access
        if (!isHRAdmin(req) && timesheet.assignedApprover?.userId !== userId) {
            return res.status(403).json({ error: 'Not authorized to approve this timesheet' });
        }

        timesheet.status = 'approved';
        timesheet.approvedBy = {
            userId,
            userName: req.user.name,
            userEmail: req.user.email,
            approvedAt: new Date(),
            comment,
        };
        timesheet.addAuditLog('approved', userId, req.user.name, comment);

        await timesheet.save();

        // Send email notification to employee
        const policy = await AttendancePolicy.findOne({ organizationId });
        if (policy?.notifications?.emailOnApproval && timesheet.userEmail) {
            await emailService.sendTimesheetApproved(timesheet, timesheet.userEmail);
        }

        res.json({
            success: true,
            timesheet,
            message: 'Timesheet approved',
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

        // Verify approver access
        if (!isHRAdmin(req) && timesheet.assignedApprover?.userId !== userId) {
            return res.status(403).json({ error: 'Not authorized to reject this timesheet' });
        }

        timesheet.status = 'rejected';
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
        const policy = await AttendancePolicy.findOne({ organizationId });
        if (policy?.notifications?.emailOnRejection && timesheet.userEmail) {
            await emailService.sendTimesheetRejected(timesheet, timesheet.userEmail);
        }

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

        // Verify approver access
        if (!isHRAdmin(req) && timesheet.assignedApprover?.userId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        timesheet.status = 'revision_requested';
        timesheet.revisionRequestedBy = {
            userId,
            userName: req.user.name,
            requestedAt: new Date(),
            reason,
        };
        timesheet.addAuditLog('revision_requested', userId, req.user.name, reason);

        await timesheet.save();

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

        // Only allow reverting approved, rejected, or revision_requested timesheets
        if (!['approved', 'rejected', 'revision_requested'].includes(timesheet.status)) {
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

        // Reset to draft status
        timesheet.status = 'draft';
        timesheet.submittedAt = null;
        timesheet.submittedNote = null;
        
        // Clear approval/rejection data but keep in audit log
        timesheet.approvedBy = null;
        timesheet.rejectedBy = null;
        timesheet.revisionRequestedBy = null;

        // Add audit log entry
        timesheet.addAuditLog(
            'updated', 
            userId, 
            req.user.name, 
            reason,
            `Reverted from ${previousStatus} to draft`
        );

        await timesheet.save();

        res.json({
            success: true,
            timesheet,
            message: `Timesheet reverted from ${previousStatus} to draft`,
            previousStatus,
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

        if (!isHRAdmin(req)) {
            query['assignedApprover.userId'] = userId;
        }

        const result = await Timesheet.updateMany(query, {
            $set: {
                status: 'approved',
                approvedBy: {
                    userId,
                    userName: req.user.name,
                    userEmail: req.user.email,
                    approvedAt: new Date(),
                    comment: comment || 'Bulk approved',
                },
            },
            $push: {
                auditLog: {
                    action: 'approved',
                    performedBy: userId,
                    performedByName: req.user.name,
                    performedAt: new Date(),
                    comment: comment || 'Bulk approved',
                },
            },
        });

        res.json({
            success: true,
            approvedCount: result.modifiedCount,
            message: `${result.modifiedCount} timesheet(s) approved`,
        });
    } catch (error) {
        console.error('Bulk approve error:', error);
        res.status(500).json({ error: 'Failed to bulk approve' });
    }
});

module.exports = router;
