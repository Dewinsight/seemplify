const { AuditLog } = require('../models');

/**
 * Log an audit event
 */
async function logAudit({
  action,
  resourceType,
  resourceId,
  organizationId,
  performedBy,
  performedByName,
  performedByEmail,
  details,
  metadata,
  req,
  previousState,
  newState,
}) {
  try {
    const log = await AuditLog.log({
      action,
      resourceType,
      resourceId,
      organizationId,
      performedBy,
      performedByName,
      performedByEmail,
      details,
      metadata,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get?.('user-agent'),
      previousState,
      newState,
    });

    return log;
  } catch (error) {
    // Log errors but don't throw - audit logging shouldn't break operations
    console.error('Audit log error:', error);
    return null;
  }
}

/**
 * Log leave request creation
 */
async function logLeaveRequestCreated(leaveRequest, user, req) {
  return logAudit({
    action: 'leave_request_created',
    resourceType: 'LeaveRequest',
    resourceId: leaveRequest._id.toString(),
    organizationId: leaveRequest.organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: `Created ${leaveRequest.leaveType} leave request for ${leaveRequest.numberOfDays} day(s)`,
    metadata: {
      leaveType: leaveRequest.leaveType,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      numberOfDays: leaveRequest.numberOfDays,
    },
    req,
    newState: leaveRequest.toObject(),
  });
}

/**
 * Log leave request approval
 */
async function logLeaveRequestApproved(leaveRequest, approver, req, comment) {
  return logAudit({
    action: 'leave_request_approved',
    resourceType: 'LeaveRequest',
    resourceId: leaveRequest._id.toString(),
    organizationId: leaveRequest.organizationId,
    performedBy: approver.id,
    performedByName: approver.name,
    performedByEmail: approver.email,
    details: `Approved ${leaveRequest.leaveType} leave request for ${leaveRequest.userName}`,
    metadata: {
      requesterId: leaveRequest.userId,
      requesterName: leaveRequest.userName,
      approvalType: leaveRequest.approvedBy?.approvalType,
      comment,
    },
    req,
    newState: leaveRequest.toObject(),
  });
}

/**
 * Log leave request rejection
 */
async function logLeaveRequestRejected(leaveRequest, rejector, req, reason) {
  return logAudit({
    action: 'leave_request_rejected',
    resourceType: 'LeaveRequest',
    resourceId: leaveRequest._id.toString(),
    organizationId: leaveRequest.organizationId,
    performedBy: rejector.id,
    performedByName: rejector.name,
    performedByEmail: rejector.email,
    details: `Rejected ${leaveRequest.leaveType} leave request for ${leaveRequest.userName}`,
    metadata: {
      requesterId: leaveRequest.userId,
      requesterName: leaveRequest.userName,
      rejectionReason: reason,
    },
    req,
    newState: leaveRequest.toObject(),
  });
}

/**
 * Log leave request cancellation
 */
async function logLeaveRequestCancelled(leaveRequest, user, req, reason) {
  return logAudit({
    action: 'leave_request_cancelled',
    resourceType: 'LeaveRequest',
    resourceId: leaveRequest._id.toString(),
    organizationId: leaveRequest.organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: `Cancelled ${leaveRequest.leaveType} leave request`,
    metadata: {
      cancellationReason: reason,
      previousStatus: 'pending', // or 'approved'
    },
    req,
    newState: leaveRequest.toObject(),
  });
}

/**
 * Log leave balance update
 */
async function logLeaveBalanceUpdated(balance, user, req, changes) {
  return logAudit({
    action: 'leave_balance_updated',
    resourceType: 'LeaveBalance',
    resourceId: balance._id.toString(),
    organizationId: balance.organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: `Updated leave balance for ${balance.userName}`,
    metadata: changes,
    req,
    newState: balance.toObject(),
  });
}

/**
 * Log leave policy update
 */
async function logLeavePolicyUpdated(policy, user, req, previousPolicy) {
  return logAudit({
    action: 'leave_policy_updated',
    resourceType: 'LeavePolicy',
    resourceId: policy._id.toString(),
    organizationId: policy.organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: `Updated leave policy for organization`,
    req,
    previousState: previousPolicy,
    newState: policy.toObject(),
  });
}

/**
 * Log user login
 */
async function logUserLogin(user, organizationId, req) {
  return logAudit({
    action: 'user_login',
    resourceType: 'User',
    resourceId: user.id,
    organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: 'User logged in',
    req,
  });
}

/**
 * Log hub launch
 */
async function logHubLaunch(user, organizationId, req) {
  return logAudit({
    action: 'hub_launch',
    resourceType: 'Session',
    resourceId: user.id,
    organizationId,
    performedBy: user.id,
    performedByName: user.name,
    performedByEmail: user.email,
    details: 'User launched app from Hub',
    req,
  });
}

module.exports = {
  logAudit,
  logLeaveRequestCreated,
  logLeaveRequestApproved,
  logLeaveRequestRejected,
  logLeaveRequestCancelled,
  logLeaveBalanceUpdated,
  logLeavePolicyUpdated,
  logUserLogin,
  logHubLaunch,
};
