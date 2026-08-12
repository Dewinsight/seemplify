const crypto = require('crypto');
const express = require('express');
const WebhookReceipt = require('../models/WebhookReceipt');
const sessionStore = require('../services/sessionStore');
const { internalServiceAuth } = require('../middleware/internalServiceAuth');
const { configuredSecrets, verifyIdpWebhook } = require('../services/idpWebhookSecurity');
const {
  claimIdpWebhookEvent,
  markIdpWebhookProcessed,
  markIdpWebhookFailed
} = require('../services/idpWebhookReceiptService');
const { isLearningEvent, upsertLearningRecordFromEvent } = require('../services/learningRecordService');

const router = express.Router();

let websocketService = null;
try {
  websocketService = require('../services/websocketService');
} catch (error) {
  websocketService = null;
}

function verifyIdpSignature(req, res, next) {
  const result = verifyIdpWebhook({
    payload: req.body,
    rawBody: req.rawBody,
    eventHeader: req.get('x-idp-event'),
    deliveryTimestamp: req.get('x-idp-delivery-timestamp'),
    signature: req.get('x-idp-signature-v2'),
    secret: configuredSecrets()
  });
  if (!result.ok) {
    return res.status(result.status).json({ success: false, error: result.error, code: result.code });
  }
  next();
}

function stableSubject(data = {}) {
  return data.subject || data.userId || data.accountId || data.memberId || null;
}

async function beginReceipt(body, payloadHash) {
  const existing = await WebhookReceipt.findOne({ eventId: body.eventId });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      const error = new Error('Webhook event ID was reused with a different payload');
      error.statusCode = 409;
      throw error;
    }
    if (existing.status === 'processed') return { receipt: existing, replay: true };
    existing.status = 'processing';
    existing.attempts += 1;
    existing.lastError = '';
    await existing.save();
    return { receipt: existing, replay: false };
  }
  try {
    const receipt = await WebhookReceipt.create({
      eventId: body.eventId,
      event: body.event,
      organizationId: body.organizationId || body.data?.organizationId,
      subjectId: body.subjectId || body.data?.userId,
      payloadHash
    });
    return { receipt, replay: false };
  } catch (error) {
    if (error.code === 11000) return beginReceipt(body, payloadHash);
    throw error;
  }
}

async function createLifecycleGoalDraft(event, data) {
  if (!['organization.member.added', 'team.member.role_changed'].includes(event)) return null;
  if (!data?.userId || !data?.organizationId) return null;
  try {
    const OKR = require('../models/OKR');
    const GoalPeriod = require('../models/GoalPeriod');
    const period = await GoalPeriod.findOne({
      organizationId: String(data.organizationId),
      status: { $in: ['open', 'upcoming'] },
      endDate: { $gte: new Date() }
    }).sort({ startDate: 1 });
    if (!period) return null;
    const existing = await OKR.findOne({
      organizationId: String(data.organizationId),
      ownerId: String(data.userId),
      periodId: period._id,
      'assignment.idempotencyKey': `lifecycle:${data.eventId}`
    });
    if (existing) return existing;
    return OKR.create({
      organizationId: String(data.organizationId),
      ownerId: String(data.userId),
      periodId: period._id,
      period: period.name,
      type: 'individual',
      title: event === 'organization.member.added' ? '30/60/90-day success plan' : 'Role transition success plan',
      creationSource: 'import',
      status: 'draft',
      approvalStatus: 'draft',
      lifecycle: { state: 'draft' },
      createdBy: { userId: data.managerId || 'system', name: 'Lifecycle automation', role: 'system' },
      assignment: {
        assignedBy: data.managerId ? { userId: String(data.managerId), role: 'line_manager' } : undefined,
        assignedAt: new Date(),
        acknowledgementStatus: 'not_required',
        idempotencyKey: `lifecycle:${data.eventId}`
      },
      objectives: [],
    });
  } catch (error) {
    // A missing open period should not make identity lifecycle events fail.
    console.warn('Lifecycle goal draft was not created:', error.message);
    return null;
  }
}

async function processEvent(event, data, envelope) {
  const payloadData = data || {};
  const userId = stableSubject(payloadData) || envelope.subjectId;
  if (isLearningEvent(event)) {
    await upsertLearningRecordFromEvent(event, payloadData, envelope);
    return;
  }
  switch (event) {
    case 'team.member.removed':
      await sessionStore.invalidateUserSessions(userId);
      websocketService?.notifyUserLogout(userId, 'Your team membership changed');
      break;
    case 'team.member.added':
      await sessionStore.updateUserTeamClaims(userId, data.team);
      websocketService?.notifyUser(userId, 'team_added', { teamName: data.team?.name, message: 'Your team membership changed' });
      break;
    case 'team.member.role_changed':
      await sessionStore.invalidateUserSessions(userId);
      websocketService?.notifyUserLogout(userId, 'Your team role changed. Sign in again to refresh access.');
      break;
    case 'team.manager.changed':
      if (data.oldManagerId) await sessionStore.refreshUserClaims(data.oldManagerId);
      if (data.newManagerId) await sessionStore.refreshUserClaims(data.newManagerId);
      break;
    case 'organization.member.removed':
    case 'organization.member.deactivated':
    case 'organization.member.app_access_changed':
      await sessionStore.invalidateUserSessions(userId);
      websocketService?.notifyUserLogout(userId, 'Your organization access changed');
      break;
    case 'organization.member.added':
    case 'organization.member.reactivated':
      await sessionStore.updateUserOrgClaims(userId, data.organization);
      break;
    case 'user.session.invalidate':
      await sessionStore.invalidateUserSessions(userId);
      websocketService?.notifyUserLogout(userId, data.reason || 'Session invalidated by an administrator');
      break;
    case 'leave.approved':
    case 'leave.updated': {
      const { pauseRemindersForUserLeave } = require('../services/reminderScheduler');
      await pauseRemindersForUserLeave({
        organizationId: data.organizationId || envelope.organizationId,
        userId,
        startAt: data.startAt || data.startDate,
        endAt: data.endAt || data.endDate,
        reason: event
      });
      break;
    }
    case 'leave.cancelled': {
      const { resumeRemindersForUserLeave } = require('../services/reminderScheduler');
      await resumeRemindersForUserLeave({
        organizationId: data.organizationId || envelope.organizationId,
        userId,
        reason: event
      });
      break;
    }
    default:
      break;
  }
  await createLifecycleGoalDraft(event, { ...data, eventId: envelope.eventId });
}

router.post('/idp', verifyIdpSignature, async (req, res) => {
  let claim;
  try {
    claim = await claimIdpWebhookEvent(req.body);
    if (claim.duplicate) return res.status(200).json({ received: true, event: req.body.event, idempotentReplay: true });
    if (!claim.claimed) return res.status(202).json({ received: true, event: req.body.event, processing: true });
    await processEvent(req.body.event, req.body.data || {}, req.body);
    await markIdpWebhookProcessed(claim);
    res.status(200).json({ received: true, event: req.body.event });
  } catch (error) {
    if (claim?.claimed) await markIdpWebhookFailed(claim, error).catch(() => {});
    console.error('Webhook processing error:', error);
    const status = error.code === 'IDP_EVENT_PAYLOAD_CONFLICT' ? 409 : (error.statusCode || 500);
    res.status(status).json({ success: false, error: error.message || 'Webhook processing failed' });
  }
});

// Signed internal suite events (for example approved/cancelled leave). Leave
// changes reminder timing only and is never attached to ratings or evidence.
router.post('/suite', internalServiceAuth, async (req, res) => {
  let receipt;
  try {
    const envelope = req.body || {};
    if (!envelope.eventId || !envelope.event || !envelope.organizationId) {
      return res.status(400).json({ success: false, error: 'Event ID, type, and organization are required' });
    }
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    const started = await beginReceipt(envelope, payloadHash);
    receipt = started.receipt;
    if (started.replay) {
      return res.status(200).json({ received: true, event: envelope.event, idempotentReplay: true });
    }
    await processEvent(envelope.event, envelope.data || {}, envelope);
    receipt.status = 'processed';
    receipt.processedAt = new Date();
    await receipt.save();
    return res.status(200).json({ received: true, event: envelope.event });
  } catch (error) {
    if (receipt) {
      receipt.status = 'failed';
      receipt.lastError = String(error.message || error).slice(0, 2000);
      await receipt.save().catch(() => {});
    }
    console.error('Suite webhook processing error:', error);
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Webhook processing failed' });
  }
});

module.exports = router;
