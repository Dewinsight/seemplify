const express = require('express');
const router = express.Router();

const CompensationRequest = require('../models/CompensationRequest');
const CompensationApprovalPolicy = require('../models/CompensationApprovalPolicy');
const { normalizeManualOvertimeCapture } = require('../services/overtimeCaptureService');
const { getOrCreateCompensationPolicy } = require('../services/compensationPolicyService');
const {
  findAttendanceImportConflict,
  findDuplicateManualOvertime,
} = require('../services/manualOvertimeConflictService');
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

const policySnapshot = policy => ({
  policyId: String(policy._id),
  approvalRequired: policy.approvalRequired,
  requireSeparationOfDuties: policy.requireSeparationOfDuties,
  defaultOvertimeMultiplier: policy.defaultOvertimeMultiplier,
  allowMultiplierOverride: policy.allowMultiplierOverride,
  requireEvidenceReference: policy.requireEvidenceReference,
  preventTimesheetOverlap: policy.preventTimesheetOverlap,
  maximumHoursPerRequest: policy.maximumHoursPerRequest,
  approverRoles: policy.approverRoles,
});

const manualInterval = request => request.overtimeContext?.captureMethod === 'manual_external_work'
  ? {
    startedAt: request.overtimeContext.startedAt,
    endedAt: request.overtimeContext.endedAt,
  }
  : null;

/**
 * GET /api/compensation/policy
 * Returns the persisted manual-overtime policy, creating safe defaults for a new tenant.
 */
router.get('/policy', requireAuth, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    if (!organizationId) return res.status(400).json({ error: 'No organization selected' });
    res.json(await getOrCreateCompensationPolicy(organizationId));
  } catch (err) {
    console.error('Get Compensation Policy Error:', err);
    res.status(500).json({ error: 'Failed to load the manual overtime policy' });
  }
});

/**
 * PUT /api/compensation/policy
 * HR admins can configure approval and duplicate-pay safeguards.
 */
router.put('/policy', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, requesterId } = getUserInfo(req);
    if (!organizationId) return res.status(400).json({ error: 'No organization selected' });
    const allowed = [
      'approvalRequired',
      'requireSeparationOfDuties',
      'defaultOvertimeMultiplier',
      'allowMultiplierOverride',
      'requireEvidenceReference',
      'preventTimesheetOverlap',
      'maximumHoursPerRequest',
      'approverRoles',
    ];
    const update = Object.fromEntries(allowed
      .filter(key => req.body?.[key] !== undefined)
      .map(key => [key, req.body[key]]));
    if (update.approverRoles) {
      update.approverRoles = [...new Set(update.approverRoles
        .map(value => String(value))
        .filter(value => ['hr_admin', 'line_manager'].includes(value)))];
      if (!update.approverRoles.length) {
        return res.status(400).json({ error: 'Choose at least one manual overtime approver role.' });
      }
    }
    update.updatedBy = requesterId;
    const policy = await CompensationApprovalPolicy.findOneAndUpdate(
      { organizationId },
      { $set: update, $setOnInsert: { organizationId, createdBy: requesterId } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json(policy);
  } catch (err) {
    console.error('Update Compensation Policy Error:', err);
    res.status(err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500).json({
      error: err.name === 'ValidationError' || err.name === 'CastError'
        ? 'The manual overtime policy contains invalid values.'
        : 'Failed to update the manual overtime policy',
    });
  }
});

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
      overtimeContext,
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

    const compensationPolicy = type === 'overtime'
      ? await getOrCreateCompensationPolicy(organizationId, requesterId)
      : null;

    const normalizedOvertime = type === 'overtime'
      ? normalizeManualOvertimeCapture({
        overtimeHours,
        overtimeMultiplier,
        amount,
        reason,
        effectiveDate,
        overtimeContext,
        maximumHours: compensationPolicy.maximumHoursPerRequest,
        forcedMultiplier: compensationPolicy.allowMultiplierOverride
          ? undefined
          : compensationPolicy.defaultOvertimeMultiplier,
      })
      : null;

    if (
      normalizedOvertime?.overtimeContext?.captureMethod === 'manual_external_work'
      && compensationPolicy.requireEvidenceReference
      && !normalizedOvertime.overtimeContext.evidenceReference
    ) {
      return res.status(400).json({
        error: 'Evidence is required by the manual overtime policy.',
        code: 'OVERTIME_EVIDENCE_REQUIRED',
      });
    }

    if (
      normalizedOvertime?.overtimeContext?.captureMethod === 'manual_external_work'
      && compensationPolicy.preventTimesheetOverlap
    ) {
      const conflictInput = {
        organizationId,
        userId,
        startedAt: normalizedOvertime.overtimeContext.startedAt,
        endedAt: normalizedOvertime.overtimeContext.endedAt,
      };
      const [duplicateRequest, attendanceImport] = await Promise.all([
        findDuplicateManualOvertime(conflictInput),
        findAttendanceImportConflict(conflictInput),
      ]);
      if (duplicateRequest) {
        return res.status(409).json({
          error: 'This period overlaps another active manual overtime request.',
          code: 'DUPLICATE_MANUAL_OVERTIME',
          compensationRequestId: duplicateRequest._id,
        });
      }
      if (attendanceImport) {
        return res.status(409).json({
          error: 'This period is already represented by transferred timesheet overtime. Request a timesheet correction instead.',
          code: 'TIMESHEET_OVERTIME_CONFLICT',
          attendanceImportId: attendanceImport._id,
        });
      }
    }

    const approvalRequired = type !== 'overtime' || compensationPolicy.approvalRequired;
    const approvals = approvalRequired ? [] : [{
      approverId: 'system:compensation-policy',
      approverName: 'Manual overtime policy',
      role: 'system',
      status: 'approved',
      comment: 'Approval was not required by the active tenant policy.',
      date: new Date(),
    }];

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
      overtimeHours: normalizedOvertime?.overtimeHours,
      overtimeMultiplier: normalizedOvertime?.overtimeMultiplier,
      overtimeContext: normalizedOvertime?.overtimeContext,
      reason: normalizedOvertime?.reason || reason || '',
      effectiveDate: normalizedOvertime?.effectiveDate || new Date(effectiveDate),
      okrReference: okrId ? { okrId, score: okrScore } : undefined,
      metadata,
      status: approvalRequired ? 'pending' : 'approved',
      approvals,
      approvalPolicySnapshot: compensationPolicy ? policySnapshot(compensationPolicy) : undefined,
    });

    await request.save();
    res.status(201).json(request);
  } catch (err) {
    console.error('Create Compensation Request Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Failed to create request',
      code: err.code,
    });
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
router.get('/approvals', requireAuth, async (req, res) => {
  try {
    const { organizationId, role } = getUserInfo(req);
    const compensationPolicy = await getOrCreateCompensationPolicy(organizationId);
    const canReviewOvertime = compensationPolicy.approverRoles.includes(role);
    if (role !== 'hr_admin' && !canReviewOvertime) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    const query = { organizationId };
    if (role !== 'hr_admin') {
      query.type = 'overtime';
      query.userId = { $in: req.directReports || [] };
    }

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
router.post('/:id/action', requireAuth, async (req, res) => {
  try {
    const { organizationId, requesterId, requesterName, role } = getUserInfo(req);
    const { action, comment } = req.body || {};

    const request = await CompensationRequest.findOne({ _id: req.params.id, organizationId });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: `This request has already been ${request.status}.`,
        code: 'COMPENSATION_REQUEST_ALREADY_DECIDED',
      });
    }

    const compensationPolicy = await getOrCreateCompensationPolicy(organizationId);
    const isManualOvertime = request.type === 'overtime'
      && request.overtimeContext?.captureMethod === 'manual_external_work';
    if (request.type === 'overtime') {
      if (!compensationPolicy.approverRoles.includes(role)) {
        return res.status(403).json({ error: 'Your role is not permitted to decide overtime requests.' });
      }
      if (role === 'line_manager' && !(req.directReports || []).map(String).includes(String(request.userId))) {
        return res.status(403).json({ error: 'This employee is outside your management scope.' });
      }
      if (
        action === 'approve'
        && (request.approvalPolicySnapshot?.requireSeparationOfDuties ?? compensationPolicy.requireSeparationOfDuties)
        && String(request.requesterId) === String(requesterId)
      ) {
        return res.status(409).json({
          error: 'You cannot approve an overtime request that you submitted.',
          code: 'SEPARATION_OF_DUTIES_REQUIRED',
        });
      }
    } else if (role !== 'hr_admin') {
      return res.status(403).json({ error: 'Only HR administrators can decide this request.' });
    }

    if (
      action === 'approve'
      && isManualOvertime
      && (request.approvalPolicySnapshot?.preventTimesheetOverlap ?? compensationPolicy.preventTimesheetOverlap)
    ) {
      const interval = manualInterval(request);
      const conflictInput = {
        organizationId,
        userId: request.userId,
        ...interval,
      };
      const [duplicateRequest, attendanceImport] = await Promise.all([
        findDuplicateManualOvertime({ ...conflictInput, excludeRequestId: request._id }),
        findAttendanceImportConflict(conflictInput),
      ]);
      if (duplicateRequest || attendanceImport) {
        return res.status(409).json({
          error: duplicateRequest
            ? 'Another active manual overtime request now overlaps this period.'
            : 'Transferred timesheet overtime now overlaps this request. Use the timesheet correction flow.',
          code: duplicateRequest ? 'DUPLICATE_MANUAL_OVERTIME' : 'TIMESHEET_OVERTIME_CONFLICT',
        });
      }
    }

    if (action === 'approve') {
      request.status = 'approved';
      request.approvals.push({
        approverId: requesterId,
        approverName: requesterName,
        role,
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
        role,
        status: 'rejected',
        comment: comment || '',
        date: new Date(),
      });
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
    res.status(err.name === 'VersionError' ? 409 : 500).json({
      error: err.name === 'VersionError'
        ? 'This request was decided by another reviewer. Refresh to see the latest status.'
        : 'Failed to process request',
      code: err.name === 'VersionError' ? 'COMPENSATION_REQUEST_ALREADY_DECIDED' : undefined,
    });
  }
});

module.exports = router;
