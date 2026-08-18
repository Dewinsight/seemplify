const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { LeaveRequest, LeaveBalance, LeavePolicy } = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  canApproveLeaveForUser,
  requireApprovalPermission,
  createLeaveRequestLimiter,
  approvalLimiter,
  asyncHandler,
  AppError,
} = require('../middleware');
const {
  calculateLeaveDays,
  validateLeaveDates,
  findApprover,
} = require('../services/leaveCalculations');
const {
  logLeaveRequestCreated,
  logLeaveRequestApproved,
  logLeaveRequestRejected,
  logLeaveRequestCancelled,
} = require('../services/auditService');
const emailService = require('../services/emailService');
const { queueLeaveEvent } = require('../services/attendanceIntegrationService');
const { queueLeaveSubmittedEvent } = require('../services/automationEventService');
const { normalizeLeaveTypeKey } = require('../services/leaveEntitlementService');
const { fetchOrganizationRoster } = require('../services/rosterService');
const { buildCalendarAnalytics, daysInRange } = require('../services/calendarAnalyticsService');
const {
  persistLeaveRequestAndBalance,
  runWithTransactionFallback,
} = require('../services/leaveRequestPersistence');

// Apply auth and org middleware to all routes
router.use(requireAuth);
router.use(requireOrganization);

function collectLineManagerRecipients(userinfo, organizationId, teamId, requesterId) {
  const teams = (userinfo?.teams || []).filter(team => {
    const orgMatch = team.organizationId === organizationId;
    const teamMatch = teamId ? team.id === teamId : true;
    return orgMatch && teamMatch;
  });

  const recipientsByEmail = new Map();

  for (const team of teams) {
    const email = String(team.managerEmail || '').trim();
    if (!email) continue;

    const managerId = team.managerId ? String(team.managerId) : null;
    if (managerId && managerId === String(requesterId)) continue;

    const key = email.toLowerCase();
    if (recipientsByEmail.has(key)) continue;

    recipientsByEmail.set(key, {
      userId: managerId,
      userName: team.managerName || 'Line Manager',
      userEmail: email,
      teamId: team.id || null,
      teamName: team.name || null,
      assignmentType: 'line_manager',
    });
  }

  return Array.from(recipientsByEmail.values());
}

// Get all leave requests for current user
router.get('/', asyncHandler(async (req, res) => {
  const { status, leaveType, startDate, endDate, page = 1, limit = 20 } = req.query;

  const query = {
    userId: req.user.id,
    organizationId: req.organizationId,
  };

  if (status) query.status = status;
  if (leaveType) query.leaveType = leaveType;
  if (startDate) query.startDate = { $gte: new Date(startDate) };
  if (endDate) query.endDate = { $lte: new Date(endDate) };

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [requests, total] = await Promise.all([
    LeaveRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    LeaveRequest.countDocuments(query),
  ]);

  res.json({
    requests,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
}));

// Get pending approvals for current user (as approver)
router.get('/approvals',
  requireLeavePermission('approve_leaves'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;

    // Build query based on user's approval capabilities
    const userinfo = req.user?.userinfo || req.user;
    const query = {
      organizationId: req.organizationId,
      status: 'pending',
    };

    // If user has full org permissions, show all pending
    if (req.hasFullAccess || req.organizationRole === 'admin' || req.organizationRole === 'hr_manager') {
      // Show all pending requests for org
    } else if (req.hasDepartmentHeadAccess) {
      query.userId = { $in: req.scopedEmployeeIds || [] };
    } else if (req.hasTeamPermission) {
      // Show only requests from team members (direct reports + sub-team members)
      const userTeams = (userinfo.teams || []).filter(
        t => t.organizationId === req.organizationId && 
             (t.role === 'line_manager' || t.role === 'team_lead')
      );
      
      // Collect all direct reports from teams where user is manager
      const directReports = new Set();
      
      for (const team of userTeams) {
        // Add direct reports from this team
        if (team.directReports && Array.isArray(team.directReports)) {
          team.directReports.forEach(id => directReports.add(id));
        }
        
        // Also check if user is manager of this team (even if directReports not populated)
        if (team.isManager && team.managerId === req.user.id) {
          // Get all members of this team and sub-teams
          // We'll need to query the IdP API or use team claims
          // For now, use directReports if available
        }
      }

      if (directReports.size > 0) {
        query.userId = { $in: Array.from(directReports) };
      } else {
        // Also check by assigned approver (for cases where directReports might not be in claims)
        // If user is assigned as approver, show those requests
        query['assignedApprover.userId'] = req.user.id;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      LeaveRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LeaveRequest.countDocuments(query),
    ]);

    res.json({
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// Get team leave requests (for managers/admins)
router.get('/team',
  requireLeavePermission('view_team_leaves'),
  asyncHandler(async (req, res) => {
    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    const userinfo = req.user?.userinfo || req.user;
    const query = {
      organizationId: req.organizationId,
    };

    // If not full access, filter to team members
    if (!req.hasFullAccess && req.organizationRole !== 'admin' && req.organizationRole !== 'hr_manager') {
      if (req.hasDepartmentHeadAccess) {
        query.userId = { $in: req.scopedEmployeeIds || [] };
      } else {
      const userTeams = (userinfo.teams || []).filter(
        t => t.organizationId === req.organizationId && 
             (t.role === 'line_manager' || t.role === 'team_lead' || t.isManager)
      );
      
      const directReports = new Set();
      for (const team of userTeams) {
        if (team.directReports && Array.isArray(team.directReports)) {
          team.directReports.forEach(id => directReports.add(id));
        }
      }

      if (directReports.size > 0) {
        query.userId = { $in: Array.from(directReports) };
      } else {
        // Fallback: check by assigned approver
        query['assignedApprover.userId'] = req.user.id;
      }
      }
    }

    if (status) query.status = status;
    if (startDate) query.startDate = { $gte: new Date(startDate) };
    if (endDate) query.endDate = { $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      LeaveRequest.find(query)
        .sort({ startDate: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LeaveRequest.countDocuments(query),
    ]);

    res.json({
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// Get all leave requests for admin/HR manager (with team filtering)
router.get('/all',
  requireLeavePermission('view_all_leaves'),
  asyncHandler(async (req, res) => {
    const { status, leaveType, startDate, endDate, teamId, userId, page = 1, limit = 50 } = req.query;

    const query = {
      organizationId: req.organizationId,
    };

    // Only admins and HR managers can use this endpoint
    if (req.organizationRole !== 'admin' && req.organizationRole !== 'hr_manager' && !req.hasFullAccess) {
      return res.status(403).json({
        error: 'Admin or HR Manager role required',
        code: 'PERMISSION_DENIED',
      });
    }

    if (status) query.status = status;
    if (leaveType) query.leaveType = leaveType;
    if (teamId) query.teamId = teamId;
    if (userId) query.userId = userId;
    if (startDate) query.startDate = { $gte: new Date(startDate) };
    if (endDate) query.endDate = { $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      LeaveRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LeaveRequest.countDocuments(query),
    ]);

    res.json({
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// Management calendar: organization requests plus workforce coverage analytics.
router.get('/calendar/organization', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    throw new AppError('startDate and endDate are required', 400, 'INVALID_PARAMS');
  }
  try {
    daysInRange(startDate, endDate);
  } catch (error) {
    throw new AppError(error.message, 400, 'INVALID_DATE_RANGE');
  }

  const [rawRequests, roster] = await Promise.all([
    LeaveRequest.find({
      organizationId: req.organizationId,
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: new Date(endDate) },
      endDate: { $gte: new Date(startDate) },
    }).select('userId userName userEmail leaveType leaveTypeName startDate endDate numberOfDays status teamId teamName reason assignedApprover approvedBy createdAt timezone').sort({ startDate: 1 }).lean(),
    fetchOrganizationRoster(req.organizationId),
  ]);
  const rosterByUserId = new Map(roster.map((member) => [String(member.userId), member]));
  const requests = rawRequests.map((request) => {
    const member = rosterByUserId.get(String(request.userId));
    const teamIds = new Set(member?.teamIds || []);
    for (const assignment of member?.teamAssignments || []) {
      if (assignment?.teamId) teamIds.add(String(assignment.teamId));
    }
    if (request.teamId) teamIds.add(String(request.teamId));
    return { ...request, teamIds: Array.from(teamIds) };
  });

  res.json({
    requests,
    ...buildCalendarAnalytics({ startDate, endDate, roster, requests }),
  });
}));

// Personal calendar: only the signed-in employee's active leave requests.
router.get('/calendar', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    throw new AppError('startDate and endDate are required', 400, 'INVALID_PARAMS');
  }

  const query = {
    organizationId: req.organizationId,
    userId: req.user.id,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: new Date(endDate) },
    endDate: { $gte: new Date(startDate) },
  };

  const requests = await LeaveRequest.find(query)
    .select('userId userName userEmail leaveType leaveTypeName startDate endDate numberOfDays status teamName reason assignedApprover approvedBy createdAt timezone')
    .sort({ startDate: 1 });

  res.json({ requests });
}));

// Get single leave request
router.get('/:id', asyncHandler(async (req, res) => {
  const request = await LeaveRequest.findById(req.params.id);

  if (!request) {
    throw new AppError('Leave request not found', 404, 'NOT_FOUND');
  }

  // Verify organization match
  if (request.organizationId !== req.organizationId) {
    throw new AppError('Access denied', 403, 'ACCESS_DENIED');
  }

  // Verify access (own request or has view permission)
  if (request.userId !== req.user.id) {
    // Check if user has permission to view others' requests
    const hasPermission = req.hasFullAccess ||
      req.organizationRole === 'admin' ||
      req.organizationRole === 'hr_manager' ||
      req.hasDepartmentHeadAccess ||
      req.teamPermissions?.includes('view_team_leaves');

    if (!hasPermission) {
      throw new AppError('Access denied', 403, 'ACCESS_DENIED');
    }
  }

  const userinfo = req.user?.userinfo || req.user;
  const approvalCheck = request.status === 'pending'
    ? await canApproveLeaveForUser(req.user.id, request.userId, request.organizationId, userinfo)
    : { canApprove: false };

  res.json({
    request,
    permissions: {
      canApprove: Boolean(approvalCheck.canApprove),
      canReject: Boolean(approvalCheck.canApprove),
    },
  });
}));

// Create leave request
router.post('/',
  createLeaveRequestLimiter,
  asyncHandler(async (req, res) => {
    const { startDate, endDate, reason, teamId } = req.body;
    const leaveType = normalizeLeaveTypeKey(req.body.leaveType);

    // Validate required fields
    if (!leaveType || !startDate || !endDate) {
      throw new AppError('leaveType, startDate, and endDate are required', 400, 'VALIDATION_ERROR');
    }

    // Get policy for validation
    const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
    const leaveTypeDefinition = policy.getLeaveType(leaveType);
    if (!leaveTypeDefinition) {
      throw new AppError('This leave type is not available for requests', 400, 'LEAVE_TYPE_NOT_AVAILABLE');
    }

    // Validate dates
    const validation = validateLeaveDates(startDate, endDate, policy, {
      maxConsecutiveDays: leaveTypeDefinition.effectiveMaxConsecutiveDays,
      leaveTypeName: leaveTypeDefinition.name,
    });
    if (!validation.isValid) {
      throw new AppError(validation.errors.join(', '), 400, 'VALIDATION_ERROR');
    }

    const numberOfDays = validation.numberOfDays;

    // Get or create balance
    const balance = await LeaveBalance.findOrCreate(
      req.user.id,
      req.user.email,
      req.user.name,
      req.organizationId,
      new Date(startDate).getFullYear()
    );

    // Check balance
    const balanceCheck = balance.hasBalance(leaveType, numberOfDays);
    if (!balanceCheck.hasBalance) {
      throw new AppError(balanceCheck.reason, 400, 'INSUFFICIENT_BALANCE');
    }

    // Check for overlapping requests
    const overlaps = await LeaveRequest.findOverlapping(
      req.user.id,
      req.organizationId,
      new Date(startDate),
      new Date(endDate)
    );

    if (overlaps.length > 0) {
      throw new AppError(
        'Leave request overlaps with existing request(s)',
        400,
        'OVERLAP_ERROR'
      );
    }

    // Find approver based on team hierarchy
    const userinfo = req.user?.userinfo || req.user;
    const approverAssignment = await findApprover(
      req.user.id,
      req.organizationId,
      userinfo,
      teamId
    );

    // Get user's team info
    const userTeam = (userinfo.teams || []).find(
      t => t.organizationId === req.organizationId &&
           (teamId ? t.id === teamId : true)
    );

    // Create leave request
    const leaveRequest = new LeaveRequest({
      userId: req.user.id,
      userEmail: req.user.email,
      userName: req.user.name,
      organizationId: req.organizationId,
      organizationName: req.organizationName,
      teamId: userTeam?.id,
      teamName: userTeam?.name,
      teamHierarchyPath: userTeam?.hierarchyPath || [],
      leaveType,
      leaveTypeName: leaveTypeDefinition.name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      numberOfDays,
      reason,
      timezone: policy.timezone,
      status: policy.requiresApprovalForType(leaveType) ? 'pending' : 'approved',
      assignedApprover: approverAssignment.approverId ? {
        userId: approverAssignment.approverId,
        userName: approverAssignment.approverName,
        userEmail: approverAssignment.approverEmail,
        teamId: approverAssignment.teamId,
        assignedAt: new Date(),
        assignmentType: approverAssignment.assignmentType,
      } : null,
    });

    // Add audit log
    leaveRequest.addAuditLog(
      'created',
      req.user.id,
      req.user.name,
      `Leave request created, assigned to ${approverAssignment.approverName || 'organization approver'}`
    );

    // Reserve balance for pending request
    balance.reserveBalance(leaveType, numberOfDays);
    if (leaveRequest.status === 'approved') balance.useBalance(leaveType, numberOfDays);

    // Use a transaction on replica sets and a compensating write on the
    // standalone MongoDB topology used by the production core stack.
    await persistLeaveRequestAndBalance(leaveRequest, balance);

    // Log audit
    await logLeaveRequestCreated(leaveRequest, req.user, req);
    if (leaveRequest.status === 'pending') {
      try { await queueLeaveSubmittedEvent(leaveRequest); }
      catch (error) { console.error('Leave request saved; Automation Hub outbox reconciliation will retry:', error.message); }
    }
    if (leaveRequest.status === 'approved') await queueLeaveEvent(leaveRequest, 'leave.approved');

    // Email notifications
    if (policy.notifyApproversOnRequest && leaveRequest.status === 'pending') {
      const lineManagerRecipients = collectLineManagerRecipients(
        userinfo,
        req.organizationId,
        teamId,
        req.user.id
      );

      const recipientsByEmail = new Map(
        lineManagerRecipients.map(recipient => [
          String(recipient.userEmail).toLowerCase(),
          recipient,
        ])
      );

      // Keep assigned approver coverage as fallback/additional recipient.
      if (leaveRequest.assignedApprover?.userEmail) {
        const approverEmailKey = String(leaveRequest.assignedApprover.userEmail).toLowerCase();
        if (!recipientsByEmail.has(approverEmailKey)) {
          recipientsByEmail.set(approverEmailKey, {
            userId: leaveRequest.assignedApprover.userId,
            userName: leaveRequest.assignedApprover.userName,
            userEmail: leaveRequest.assignedApprover.userEmail,
            teamId: leaveRequest.assignedApprover.teamId,
            assignmentType: leaveRequest.assignedApprover.assignmentType,
          });
        }
      }

      const recipients = Array.from(recipientsByEmail.values());
      if (recipients.length > 0) {
        await Promise.allSettled(
          recipients.map(recipient =>
            emailService.sendLeaveRequestSubmittedToRecipient(leaveRequest, recipient)
          )
        );
      }
    }
    await emailService.sendLeaveRequestCreatedConfirmation(leaveRequest);

    res.status(201).json({
      success: true,
      request: leaveRequest,
    });
  })
);

// Approve leave request
router.post('/:id/approve',
  approvalLimiter,
  requireApprovalPermission,
  asyncHandler(async (req, res) => {
    const { comment, idempotencyKey } = req.body;
    const leaveRequest = req.leaveRequest; // Set by requireApprovalPermission middleware
    const approvalContext = req.approvalContext;

    if (leaveRequest.status !== 'pending') {
      throw new AppError(
        `Cannot approve request with status: ${leaveRequest.status}`,
        400,
        'INVALID_STATUS'
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await LeaveRequest.findOne({ approvalIdempotencyKey: idempotencyKey });
      if (existing) {
        return res.json({
          success: true,
          message: 'Already approved',
          request: existing,
        });
      }
    }

    const { result: approvedRequest } = await runWithTransactionFallback(async (session) => {
      // A failed transaction can leave the in-memory document dirty. Reload it
      // before the standalone retry so the operation starts from persisted state.
      const requestToApprove = session
        ? leaveRequest
        : await LeaveRequest.findById(leaveRequest._id);

      if (!requestToApprove) {
        throw new AppError('Leave request not found', 404, 'REQUEST_NOT_FOUND');
      }
      if (requestToApprove.status !== 'pending') {
        throw new AppError(
          `Cannot approve request with status: ${requestToApprove.status}`,
          400,
          'INVALID_STATUS'
        );
      }

      // Get balance
      let balanceQuery = LeaveBalance.findOne({
        userId: leaveRequest.userId,
        organizationId: leaveRequest.organizationId,
        year: new Date(leaveRequest.startDate).getFullYear(),
      });
      if (session) balanceQuery = balanceQuery.session(session);
      const balance = await balanceQuery;

      if (!balance) {
        throw new AppError('Leave balance not found', 404, 'BALANCE_NOT_FOUND');
      }

      // Move from pending to used
      balance.useBalance(leaveRequest.leaveType, leaveRequest.numberOfDays);

      // Update request
      requestToApprove.status = 'approved';
      requestToApprove.approvedBy = {
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        approvedAt: new Date(),
        comment,
        approvalType: approvalContext.reason === 'direct_report' || 
                      approvalContext.reason === 'team_manager' || 
                      approvalContext.reason === 'parent_team_manager' 
                      ? (approvalContext.roleType === 'team_lead' ? 'team_lead' : 'line_manager') 
                      : 'organization_role',
      };

      if (idempotencyKey) {
        requestToApprove.approvalIdempotencyKey = idempotencyKey;
      }

      requestToApprove.addAuditLog(
        'approved',
        req.user.id,
        req.user.name,
        `Approved by ${req.user.name} (${approvalContext.reason})`
      );

      if (session) {
        await requestToApprove.save({ session });
        await balance.save({ session });
      } else {
        const originalRequest = await LeaveRequest.findById(requestToApprove._id).lean();
        await requestToApprove.save();
        try {
          await balance.save();
        } catch (error) {
          // Compensate if the second standalone write fails.
          if (originalRequest) {
            try {
              await LeaveRequest.replaceOne({ _id: requestToApprove._id }, originalRequest);
            } catch (rollbackError) {
              error.rollbackError = rollbackError;
            }
          }
          throw error;
        }
      }

      return requestToApprove;
    });

    // Log audit
    await logLeaveRequestApproved(approvedRequest, req.user, req, comment);
    await queueLeaveEvent(approvedRequest, 'leave.updated');

    // Email notifications
    const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
    if (policy.notifyRequesterOnDecision) {
      await emailService.sendLeaveRequestApproved(approvedRequest);
    }

    res.json({
      success: true,
      request: approvedRequest,
    });
  })
);

// Reject leave request
router.post('/:id/reject',
  approvalLimiter,
  requireApprovalPermission,
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const leaveRequest = req.leaveRequest;

    if (!reason) {
      throw new AppError('Rejection reason is required', 400, 'REASON_REQUIRED');
    }

    if (leaveRequest.status !== 'pending') {
      throw new AppError(
        `Cannot reject request with status: ${leaveRequest.status}`,
        400,
        'INVALID_STATUS'
      );
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get balance and release reservation
      const balance = await LeaveBalance.findOne({
        userId: leaveRequest.userId,
        organizationId: leaveRequest.organizationId,
        year: new Date(leaveRequest.startDate).getFullYear(),
      }).session(session);

      if (balance) {
        balance.releaseReservation(leaveRequest.leaveType, leaveRequest.numberOfDays);
        await balance.save({ session });
      }

      // Update request
      leaveRequest.status = 'rejected';
      leaveRequest.rejectedBy = {
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        rejectedAt: new Date(),
        rejectionReason: reason,
      };

      leaveRequest.addAuditLog(
        'rejected',
        req.user.id,
        req.user.name,
        `Rejected: ${reason}`
      );

      await leaveRequest.save({ session });
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // Log audit
    await logLeaveRequestRejected(leaveRequest, req.user, req, reason);

    // Email notifications
    const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
    if (policy.notifyRequesterOnDecision) {
      await emailService.sendLeaveRequestRejected(leaveRequest);
    }

    res.json({
      success: true,
      request: leaveRequest,
    });
  })
);

// Cancel leave request
router.delete('/:id', asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const leaveRequest = await LeaveRequest.findById(req.params.id);

  if (!leaveRequest) {
    throw new AppError('Leave request not found', 404, 'NOT_FOUND');
  }

  if (leaveRequest.organizationId !== req.organizationId) {
    throw new AppError('Access denied', 403, 'ACCESS_DENIED');
  }

  // Check if user can cancel
  const canCancel = leaveRequest.canBeCancelled(req.user.id);
  if (!canCancel.allowed) {
    throw new AppError(canCancel.reason, 403, 'CANCEL_NOT_ALLOWED');
  }

  const previousStatus = leaveRequest.status;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Get balance
    const balance = await LeaveBalance.findOne({
      userId: leaveRequest.userId,
      organizationId: leaveRequest.organizationId,
      year: new Date(leaveRequest.startDate).getFullYear(),
    }).session(session);

    if (balance) {
      if (previousStatus === 'pending') {
        // Release reservation
        balance.releaseReservation(leaveRequest.leaveType, leaveRequest.numberOfDays);
      } else if (previousStatus === 'approved') {
        // Restore used balance
        balance.restoreBalance(leaveRequest.leaveType, leaveRequest.numberOfDays);
      }
      await balance.save({ session });
    }

    // Update request
    leaveRequest.status = 'cancelled';
    leaveRequest.cancelledBy = {
      userId: req.user.id,
      userName: req.user.name,
      cancelledAt: new Date(),
      cancellationReason: reason,
    };

    leaveRequest.addAuditLog(
      'cancelled',
      req.user.id,
      req.user.name,
      reason || 'Cancelled by requester'
    );

    await leaveRequest.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // Log audit
  await logLeaveRequestCancelled(leaveRequest, req.user, req, reason);
  await queueLeaveEvent(leaveRequest, 'leave.cancelled');

  // Email notifications
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  if (policy.notifyApproversOnRequest && leaveRequest.assignedApprover?.userEmail) {
    await emailService.sendLeaveRequestCancelled(leaveRequest);
  }

  res.json({
    success: true,
    request: leaveRequest,
  });
}));

module.exports = router;
