const express = require('express');
const mongoose = require('mongoose');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const { createVerifier } = require('../services/automationHubSecurity');
const { queueLeaveEvent } = require('../services/attendanceIntegrationService');
const { requestRevision } = require('../services/automationEventService');

const router = express.Router();
router.use(createVerifier());

router.post('/leave.record_decision', async (req, res) => {
  const organizationId = String(req.body?.organizationId || '');
  const actorId = String(req.body?.actorId || '');
  const subjectId = String(req.body?.subjectId || '');
  const input = req.body?.input || {};
  const decision = String(input.decision || '');
  const rationale = String(input.rationale || '').trim();
  const idempotencyKey = String(req.get('idempotency-key') || '');
  if (!organizationId || !actorId || subjectId !== String(input.requestId || '') || !input.approvalId || !['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'The protected Leave decision is incomplete.', code: 'AUTOMATION_INPUT_INVALID' });
  }
  if (decision === 'rejected' && rationale.length < 3) {
    return res.status(400).json({ error: 'A rejection reason is required.', code: 'LEAVE_REJECTION_REASON_REQUIRED' });
  }
  const role = String(req.body?.authorizationContext?.role || '');
  if (!['manager', 'admin', 'owner'].includes(role)) {
    return res.status(403).json({ error: 'The reviewer is not allowed to decide Leave requests.', code: 'LEAVE_ROLE_DENIED' });
  }

  const existing = idempotencyKey ? await LeaveRequest.findOne({ organizationId, approvalIdempotencyKey: idempotencyKey }) : null;
  if (existing) return res.json({ outcomeId: `leave:${existing._id}:${existing.status}`, state: existing.status, idempotent: true });

  const session = await mongoose.startSession();
  let request;
  try {
    await session.withTransaction(async () => {
      request = await LeaveRequest.findOne({ _id: input.requestId, organizationId }).session(session);
      if (!request) throw Object.assign(new Error('Leave request not found.'), { statusCode: 404, code: 'LEAVE_REQUEST_NOT_FOUND' });
      if (request.status !== 'pending') throw Object.assign(new Error(`Cannot decide a ${request.status} Leave request.`), { statusCode: 409, code: 'LEAVE_REQUEST_NOT_PENDING' });
      if (requestRevision(request) !== String(input.requestRevision)) throw Object.assign(new Error('The Leave request changed after approval was requested.'), { statusCode: 409, code: 'LEAVE_APPROVAL_STALE' });
      if (String(request.userId) === actorId) throw Object.assign(new Error('A requester cannot decide their own Leave request.'), { statusCode: 403, code: 'LEAVE_MAKER_CHECKER_REQUIRED' });
      if (role === 'manager' && String(request.assignedApprover?.userId || '') !== actorId) {
        throw Object.assign(new Error('This Leave request is assigned to another manager.'), { statusCode: 403, code: 'LEAVE_APPROVER_MISMATCH' });
      }
      const balance = await LeaveBalance.findOne({
        userId: request.userId,
        organizationId,
        year: new Date(request.startDate).getFullYear(),
      }).session(session);
      if (!balance) throw Object.assign(new Error('Leave balance not found.'), { statusCode: 404, code: 'LEAVE_BALANCE_NOT_FOUND' });
      if (decision === 'approved') {
        balance.useBalance(request.leaveType, request.numberOfDays);
        request.status = 'approved';
        request.approvedBy = {
          userId: actorId,
          userName: 'Automation reviewer',
          approvedAt: new Date(),
          comment: rationale || `Approved by exact Automation Hub approval ${String(input.approvalId)}`,
          approvalType: role === 'manager' ? 'line_manager' : 'organization_role',
        };
        request.addAuditLog('approved', actorId, 'Automation reviewer', `Exact Automation Hub approval ${String(input.approvalId)}`);
      } else {
        balance.releaseReservation(request.leaveType, request.numberOfDays);
        request.status = 'rejected';
        request.rejectedBy = { userId: actorId, userName: 'Automation reviewer', rejectedAt: new Date(), rejectionReason: rationale };
        request.addAuditLog('rejected', actorId, 'Automation reviewer', `Exact Automation Hub rejection ${String(input.approvalId)}: ${rationale}`);
      }
      request.approvalIdempotencyKey = idempotencyKey;
      await request.save({ session });
      await balance.save({ session });
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const duplicate = await LeaveRequest.findOne({ organizationId, approvalIdempotencyKey: idempotencyKey });
      if (duplicate) return res.json({ outcomeId: `leave:${duplicate._id}:${duplicate.status}`, state: duplicate.status, idempotent: true });
    }
    return res.status(error.statusCode || 500).json({ error: error.message || 'Leave automation failed.', code: error.code || 'LEAVE_AUTOMATION_FAILED', retryable: error.retryable === true });
  } finally {
    await session.endSession();
  }

  try { await queueLeaveEvent(request, 'leave.updated'); }
  catch (error) { console.error('Leave decision was recorded but attendance event delivery failed:', error.message); }
  return res.json({ outcomeId: `leave:${request._id}:${request.status}`, state: request.status, requestRevision: requestRevision(request) });
});

module.exports = router;
