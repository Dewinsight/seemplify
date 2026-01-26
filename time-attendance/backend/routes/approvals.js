const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireManager, isHRAdmin } = require('../middleware/auth');
const { Timesheet } = require('../models');

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
