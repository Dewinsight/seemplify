const express = require('express');
const router = express.Router();

const CompensationRequest = require('../models/CompensationRequest');
const PayrollProfile = require('../models/PayrollProfile');

// RBAC
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');

// Email notifications (best-effort)
const { emailService } = require('../services/emailService');

const getUserInfo = (req) => ({
  userId: req.session?.user?.sub || req.session?.user?.id,
  requesterId: req.session?.user?.id || req.session?.user?.sub,
  requesterName: req.session?.user?.name,
  organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
  role: req.userRole,
});

const canCreateForUser = (req, targetUserId, requestType) => {
  const { requesterId, role } = getUserInfo(req);
  if (!requesterId || !targetUserId) return false;

  // HR admin can create for anyone
  if (role === 'hr_admin') return true;

  // Employee can request for self (limited types)
  const selfAllowed = ['overtime', 'reimbursement'];
  if (requesterId === targetUserId && selfAllowed.includes(requestType)) return true;

  // Manager/team lead can request for direct reports
  if (['line_manager', 'team_lead'].includes(role)) {
    // Match intent from RBAC docs: team leads can initiate bonuses, line managers can request salary/overtime.
    const allowedByRole = {
      team_lead: ['bonus', 'commission', 'incentive', 'allowance'],
      line_manager: ['bonus', 'commission', 'incentive', 'allowance', 'salary_revision', 'overtime'],
    };

    const allowedTypes = allowedByRole[role] || [];
    if (!allowedTypes.includes(requestType)) return false;

    const directReports = req.directReports || [];
    return directReports.includes(targetUserId);
  }

  return false;
};

/**
 * GET /api/compensation/team-members
 * Get direct reports (manager/team-lead) as employee list for request creation.
 */
router.get('/team-members', requireAuth, async (req, res) => {
  try {
    const { organizationId, role } = getUserInfo(req);

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!['line_manager', 'team_lead', 'hr_admin'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const directReports = role === 'hr_admin' ? null : (req.directReports || []);

    const query = { organizationId, isActive: true };
    if (directReports) {
      query.userId = { $in: directReports };
    }

    const profiles = await PayrollProfile.find(query)
      .select('userId employeeInfo status isActive')
      .sort({ 'employeeInfo.name': 1 })
      .lean();

    const members = profiles.map(p => ({
      userId: p.userId,
      name: p.employeeInfo?.name || '',
      email: p.employeeInfo?.email || '',
      department: p.employeeInfo?.department || '',
      designation: p.employeeInfo?.designation || '',
      teamId: p.employeeInfo?.teamId || '',
      teamName: p.employeeInfo?.teamName || '',
      status: p.status || 'active',
      isActive: p.isActive !== false,
    }));

    res.json({ members });
  } catch (err) {
    console.error('Get Team Members Error:', err);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

/**
 * POST /api/compensation/request
 * Create a compensation request
 */
router.post('/request', requireAuth, async (req, res) => {
  try {
    const {
      userId,
      userName,
      type,
      amount,
      currency,
      taxable,
      overtimeHours,
      overtimeMultiplier,
      reason,
      effectiveDate,
      okrId,
      okrScore,
      metadata,
    } = req.body || {};

    const { organizationId, requesterId, requesterName, role } = getUserInfo(req);

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!userId || !type || !effectiveDate) {
      return res.status(400).json({ error: 'userId, type and effectiveDate are required' });
    }

    if (!canCreateForUser(req, userId, type)) {
      return res.status(403).json({ error: 'You are not authorized to request compensation for this user.' });
    }

    // Best-effort: infer currency from payroll profile
    let finalCurrency = currency;
    if (!finalCurrency) {
      const profile = await PayrollProfile.findOne({ userId, organizationId }).lean();
      finalCurrency = profile?.currency || 'USD';
    }

    const defaultTaxable = type === 'reimbursement' ? false : true;

    const request = new CompensationRequest({
      type,
      userId,
      userName,
      organizationId,
      requesterId,
      requesterName,
      requesterRole: role,
      amount: amount !== undefined && amount !== null && amount !== '' ? Number(amount) : undefined,
      currency: finalCurrency,
      taxable: taxable !== undefined ? !!taxable : defaultTaxable,
      overtimeHours: overtimeHours !== undefined && overtimeHours !== null && overtimeHours !== '' ? Number(overtimeHours) : undefined,
      overtimeMultiplier: overtimeMultiplier !== undefined && overtimeMultiplier !== null && overtimeMultiplier !== '' ? Number(overtimeMultiplier) : undefined,
      reason: reason || '',
      effectiveDate: new Date(effectiveDate),
      okrReference: okrId ? { okrId, score: okrScore } : undefined,
      metadata,
      status: 'pending',
      approvals: [],
    });

    await request.save();
    res.status(201).json(request);
  } catch (err) {
    console.error('Create Compensation Request Error:', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

/**
 * GET /api/compensation/team?mode=my|team
 * - mode=my: requests targeting current user (employee view)
 * - mode=team: requests for direct reports + created by requester (manager view), or all (HR view)
 */
router.get('/team', requireAuth, async (req, res) => {
  try {
    const { organizationId, requesterId, role } = getUserInfo(req);
    const viewMode = req.query.mode || 'team';

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    const query = { organizationId };

    if (viewMode === 'my') {
      query.userId = requesterId;
    } else if (role === 'hr_admin') {
      // no extra filter
    } else {
      const directReports = req.directReports || [];
      query.$or = [
        { userId: { $in: directReports } },
        { requesterId },
      ];
    }

    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.type = req.query.type;

    const requests = await CompensationRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error('Get Team Requests Error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * GET /api/compensation/approvals
 * HR view of compensation approvals and approval history
 */
router.get('/approvals', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    const query = { organizationId };

    if (statusFilter === 'pending') {
      query.status = { $in: ['pending', 'approved_l1', 'approved_l2'] };
    } else if (statusFilter === 'approved') {
      query.status = { $in: ['approved', 'processed'] };
    } else if (statusFilter === 'rejected') {
      query.status = 'rejected';
    } else if (statusFilter && statusFilter !== 'all') {
      query.status = req.query.status;
    } else {
      query.status = { $ne: 'cancelled' };
    }

    const requests = await CompensationRequest.find(query).sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error('Get Approvals Error:', err);
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

/**
 * POST /api/compensation/:id/action
 * HR approve/reject a compensation request
 */
router.post('/:id/action', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, requesterId, requesterName } = getUserInfo(req);
    const { action, comment } = req.body || {};

    const request = await CompensationRequest.findOne({ _id: req.params.id, organizationId });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (action === 'approve') {
      request.status = 'approved';
      request.approvals.push({
        approverId: requesterId,
        approverName: requesterName,
        role: 'hr_admin',
        status: 'approved',
        comment: comment || '',
        date: new Date(),
      });

      // Salary revisions are configuration changes, not payroll line items.
      // Apply immediately to the employee's payroll profile.
      if (request.type === 'salary_revision') {
        const newSalary = Number(request.amount || 0);
        if (!(newSalary > 0)) {
          return res.status(400).json({ error: 'Salary revision requires a positive amount (new monthly basic salary).' });
        }

        const profile = await PayrollProfile.findOne({
          userId: request.userId,
          organizationId: request.organizationId,
        });

        if (!profile) {
          return res.status(400).json({ error: 'Payroll profile not found for this employee. Create the profile first.' });
        }

        const previousSalary = Number(profile.basicSalary || 0);
        const changePercentage = previousSalary > 0
          ? ((newSalary - previousSalary) / previousSalary * 100).toFixed(2)
          : '0';

        profile.salaryHistory = profile.salaryHistory || [];
        profile.salaryHistory.push({
          effectiveDate: request.effectiveDate || new Date(),
          previousSalary,
          newSalary,
          changeReason: 'other',
          changePercentage: parseFloat(changePercentage),
          approvedBy: requesterId,
          approvedByName: requesterName,
          notes: comment || 'Approved salary revision',
          linkedRequestId: request._id,
        });

        profile.basicSalary = newSalary;
        profile.lastModifiedBy = requesterId;
        await profile.save();

        request.status = 'processed';
        request.processedAt = new Date();
      }
    } else if (action === 'reject') {
      request.status = 'rejected';
      request.approvals.push({
        approverId: requesterId,
        approverName: requesterName,
        role: 'hr_admin',
        status: 'rejected',
        comment: comment || '',
        date: new Date(),
      });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await request.save();

    // Best-effort email notify employee
    (async () => {
      try {
        const profile = await PayrollProfile.findOne({
          userId: request.userId,
          organizationId: request.organizationId,
        });
        if (profile?.employeeInfo?.email) {
          await emailService.sendApprovalNotification(
            profile.employeeInfo.email,
            request.userName || profile.employeeInfo.name,
            request.type,
            request.amount || 0,
            request.currency || 'USD',
            request.status,
            comment || ''
          );
        }
      } catch (emailErr) {
        console.error('Email notification error (non-blocking):', emailErr.message);
      }
    })();

    res.json(request);
  } catch (err) {
    console.error('Compensation Action Error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

module.exports = router;
