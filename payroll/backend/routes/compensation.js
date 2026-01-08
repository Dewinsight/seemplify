const express = require('express');
const router = express.Router();
const CompensationRequest = require('../models/CompensationRequest');
const { getOidcClient } = require('../config/oidc');

// Import RBAC middleware
const { requireAuth, requireHRAdmin, requireManager, requirePermission } = require('../middleware/rbac');

// Create a Compensation Request (Bonus/Revision)
router.post('/request', requireAuth, async (req, res) => {
    try {
        const { userId, userName, type, amount, reason, effectiveDate, okrId, okrScore } = req.body;
        const requester = req.session.user;

        // Authorization Check: Is Requester the Manager?
        // We check the 'teams' claim from IdP.
        // Logic: Find a team where requester is 'line_manager' AND 'userId' is in 'directReports'

        let isAuthorized = false;
        let requesterRole = null;

        // Check direct report relationship from session teams
        if (requester.teams) {
            for (const team of requester.teams) {
                if (team.role === 'line_manager' && team.directReports && team.directReports.includes(userId)) {
                    isAuthorized = true;
                    requesterRole = 'line_manager';
                    break;
                }
                if (team.role === 'team_lead' && team.directReports && team.directReports.includes(userId)) {
                    isAuthorized = true;
                    requesterRole = 'team_lead';
                    break;
                }
            }
        }

        // Allow self-request for 'overtime' or 'reimbursement'
        if (requester.id === userId && (type === 'overtime' || type === 'reimbursement')) {
            isAuthorized = true;
            requesterRole = 'employee';
        }

        // Fallback: If user is Admin/HR, they can also request/override
        if (requester.roles && (requester.roles.includes('admin') || requester.roles.includes('hr_manager'))) {
            isAuthorized = true;
            requesterRole = 'admin';
        }

        if (!isAuthorized) {
            return res.status(403).json({ error: 'You are not authorized to request compensation for this user.' });
        }

        const request = new CompensationRequest({
            type,
            userId,
            userName,
            organizationId: req.session.currentOrganizationId,
            requesterId: requester.id,
            requesterName: requester.name,
            requesterRole,
            amount,
            reason,
            effectiveDate,
            okrReference: okrId ? { okrId, score: okrScore } : undefined,
            status: 'pending',
            approvals: []
        });

        await request.save();
        res.status(201).json(request);

    } catch (err) {
        console.error('Create Compensation Request Error:', err);
        res.status(500).json({ error: 'Failed to create request' });
    }
});

// Get Requests for My Team (Manager View) OR My Own Requests (Employee View)
router.get('/team', requireAuth, async (req, res) => {
    try {
        const requesterId = req.session.user.id;
        const viewMode = req.query.mode || 'team'; // 'team' or 'my'

        let query = { organizationId: req.session.currentOrganizationId };

        if (viewMode === 'my') {
            // View own requests
            query.userId = requesterId;
        } else {
            // View requests created by me (as manager)
            query.requesterId = requesterId;
        }

        const requests = await CompensationRequest.find(query).sort({ createdAt: -1 });

        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Get Pending Approvals (Admin/Dept Head View)
router.get('/approvals', requireAuth, async (req, res) => {
    try {
        // Only Admins or Dept Heads should see this
        // For MVP, let's assume 'admin' role sees all pending
        if (!req.session.user.roles || !req.session.user.roles.includes('admin')) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const requests = await CompensationRequest.find({
            status: { $in: ['pending', 'approved_l1'] },
            organizationId: req.session.currentOrganizationId
        }).sort({ createdAt: 1 });

        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch approvals' });
    }
});

// Approve/Reject Request
router.post('/:id/action', requireAuth, async (req, res) => {
    try {
        const { action, comment } = req.body; // action: 'approve' | 'reject'
        const requestId = req.params.id;
        const approver = req.session.user;

        // Verify Approver Role (Simple Admin check for MVP)
        if (!approver.roles || !approver.roles.includes('admin')) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const request = await CompensationRequest.findById(requestId);
        if (!request) return res.status(404).json({ error: 'Request not found' });

        if (action === 'approve') {
            request.status = 'processed'; // Or approved_l1 -> approved_l2 logic
            request.approvals.push({
                approverId: approver.id,
                role: 'admin',
                status: 'approved',
                comment,
                date: new Date()
            });
        } else if (action === 'reject') {
            request.status = 'rejected';
            request.approvals.push({
                approverId: approver.id,
                role: 'admin',
                status: 'rejected',
                comment,
                date: new Date()
            });
        }

        await request.save();

        // Send email notification to requester (async, non-blocking)
        (async () => {
            try {
                const { emailService } = require('../services/emailService');
                // Try to get user email from PayrollProfile
                const PayrollProfile = require('../models/PayrollProfile');
                const profile = await PayrollProfile.findOne({
                    userId: request.userId,
                    organizationId: request.organizationId
                });

                if (profile?.employeeInfo?.email) {
                    await emailService.sendApprovalNotification(
                        profile.employeeInfo.email,
                        request.userName || profile.employeeInfo.name,
                        request.type,
                        request.amount,
                        request.currency || 'USD',
                        request.status,
                        comment || ''
                    );
                }
            } catch (emailErr) {
                console.error('📧 Email notification error:', emailErr.message);
            }
        })();

        res.json(request);

    } catch (err) {
        res.status(500).json({ error: 'Failed to process request' });
    }
});

module.exports = router;
