const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const FeedbackRequest = require('../models/FeedbackRequest');
const OKR = require('../models/OKR');
const Appraisal = require('../models/Appraisal');
const User = require('../models/User');
const { requireAuth } = require('../middleware/rbac');
const {
  requireOrganization,
  tenantFilter,
  getActorId,
  canAccessEmployee,
  assertResourceTenant
} = require('../services/tenantPolicy');

const router = express.Router();
router.use(requireAuth, requireOrganization);

function cleanText(value, maxLength = 5000) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 20);
}

function normalizeType(value) {
  const map = { Positive: 'praise', Constructive: 'coaching', General: 'general' };
  const normalized = map[value] || String(value || '').toLowerCase();
  return ['praise', 'coaching', 'general'].includes(normalized) ? normalized : 'general';
}

function formatType(type) {
  return ({ praise: 'Positive', coaching: 'Constructive', general: 'General' })[type] || 'General';
}

function normalizeVisibility(value) {
  return ['public', 'private', 'manager-only'].includes(value) ? value : 'private';
}

function normalizeAnonymity(value) {
  return ['named', 'confidential', 'anonymous'].includes(value) ? value : 'named';
}

function normalizeContextType(value, fallback = 'general') {
  return ['general', 'goal', 'project', 'peer', 'upward', '360'].includes(value)
    ? value
    : fallback;
}

async function filterReportableAnonymous(items, organizationId) {
  const cohortIds = [...new Set(items
    .filter((item) => item.anonymity === 'anonymous' && item.cohortId)
    .map((item) => String(item.cohortId)))];
  if (cohortIds.length === 0) return items.filter((item) => item.anonymity !== 'anonymous');
  const counts = await Feedback.aggregate([
    {
      $match: {
        organizationId: String(organizationId),
        anonymity: 'anonymous',
        cohortId: { $in: cohortIds },
        deletedAt: null
      }
    },
    { $group: { _id: '$cohortId', count: { $sum: 1 } } }
  ]);
  const countByCohort = new Map(counts.map((row) => [String(row._id), row.count]));
  return items.filter((item) => (
    item.anonymity !== 'anonymous'
      || (item.cohortId && (countByCohort.get(String(item.cohortId)) || 0) >= Number(item.minimumCohortSize || 5))
  ));
}

async function anonymousFeedbackIsReportable(item) {
  if (item.anonymity !== 'anonymous') return true;
  if (!item.cohortId) return false;
  const count = await Feedback.countDocuments({
    organizationId: item.organizationId,
    anonymity: 'anonymous',
    cohortId: item.cohortId,
    deletedAt: null
  });
  return count >= Number(item.minimumCohortSize || 5);
}

async function resolvePerson(userId, fallback = {}) {
  const id = String(userId || '');
  if (!id) return { name: fallback.name, email: fallback.email };
  const filters = [{ idpSub: id }, { email: id.toLowerCase() }];
  if (mongoose.isValidObjectId(id)) filters.push({ _id: id });
  const user = await User.findOne({ $or: filters }).select('email profile').lean();
  return {
    name: user?.profile?.displayName || [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ') || fallback.name,
    email: user?.email || fallback.email
  };
}

function serializeFeedback(item, viewerId, role) {
  const subjectIsViewer = String(item.receiverId) === String(viewerId);
  const hideSender = item.anonymity === 'anonymous' || (item.anonymity === 'confidential' && subjectIsViewer && role !== 'hr_admin');
  return {
    _id: item._id,
    sender: hideSender ? 'Anonymous' : item.senderInfo?.name || item.senderInfo?.email || 'Unknown',
    senderId: hideSender ? null : item.senderId,
    receiver: item.receiverInfo?.name || item.receiverInfo?.email || 'Unknown',
    receiverId: item.receiverId,
    type: formatType(item.type),
    message: item.content,
    visibility: item.visibility,
    contextType: item.contextType,
    contextLabel: item.contextLabel,
    relatedOkrId: item.relatedOkrId,
    projectId: item.projectId,
    requestId: item.requestId,
    appraisalEvidence: item.appraisalEvidence,
    acknowledgedAt: item.acknowledgedAt,
    date: item.createdAt
  };
}

async function recordEvent(event) {
  try {
    const outbox = require('../services/outboxService');
    if (typeof outbox.recordEvent === 'function') await outbox.recordEvent(event);
  } catch (error) {
    console.warn('Feedback event was not recorded:', error.message);
  }
}

async function scheduleFeedbackRequestReminders(request) {
  try {
    const { scheduleReminderSequence } = require('../services/reminderScheduler');
    await scheduleReminderSequence({
      organizationId: request.organizationId,
      eventType: 'feedback.requested.reminder',
      target: { type: 'FeedbackRequest', id: String(request._id) },
      recipient: {
        userId: request.reviewerId,
        name: request.reviewerInfo?.name,
        email: request.reviewerInfo?.email,
        channels: request.reviewerInfo?.email ? ['in_app', 'email'] : ['in_app']
      },
      dueAt: request.dueDate,
      notification: {
        category: 'feedback',
        title: 'Feedback request due',
        message: 'A feedback request needs your response.',
        deepLink: `/feedback?request=${request._id}`,
        priority: 'high',
        action: { kind: 'review', label: 'Open request' }
      }
    });
  } catch (error) {
    console.warn('Feedback request reminders were not scheduled:', error.message);
  }
}

async function closeFeedbackAction(organizationId, targetType, targetId, userId, reason) {
  try {
    const { cancelRemindersForTarget } = require('../services/reminderScheduler');
    await cancelRemindersForTarget({ organizationId, targetType, targetId, userId, reason });
  } catch (error) {
    console.warn('Feedback action was not closed:', error.message);
  }
}

router.get('/', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const targetUserId = req.query.userId ? String(req.query.userId) : actorId;
    if (!canAccessEmployee(req, targetUserId)) return res.status(403).json({ success: false, error: 'Access denied' });
    const query = tenantFilter(req, {
      deletedAt: null,
      $or: [{ senderId: targetUserId }, { receiverId: targetUserId }]
    });
    if (req.query.type) query.type = normalizeType(req.query.type);
    const items = await Feedback.find(query).sort({ createdAt: -1 }).limit(100).lean();
    const visibleByRole = items.filter((item) => {
      if ([item.senderId, item.receiverId].map(String).includes(actorId) || req.userRole === 'hr_admin') return true;
      return item.visibility === 'public' || item.visibility === 'manager-only';
    });
    const visible = await filterReportableAnonymous(visibleByRole, req.organizationId);
    res.json({ success: true, data: visible.map((item) => serializeFeedback(item, actorId, req.userRole)), count: visible.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch feedback' });
  }
});

router.get('/received', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const items = await Feedback.find(tenantFilter(req, { receiverId: actorId, deletedAt: null })).sort({ createdAt: -1 }).limit(100).lean();
    const visible = await filterReportableAnonymous(items, req.organizationId);
    res.json({ success: true, data: visible.map((item) => serializeFeedback(item, actorId, req.userRole)), count: visible.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch received feedback' });
  }
});

router.get('/sent', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const items = await Feedback.find(tenantFilter(req, { senderId: actorId, deletedAt: null })).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: items.map((item) => serializeFeedback(item, actorId, req.userRole)), count: items.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch sent feedback' });
  }
});

router.get('/requests', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const view = req.query.view || 'reviewer';
    const relationship = view === 'requested' ? { requesterId: actorId } : view === 'subject' ? { subjectId: actorId } : { reviewerId: actorId };
    const query = tenantFilter(req, relationship);
    if (req.query.state) query.state = req.query.state;
    const data = await FeedbackRequest.find(query).sort({ dueDate: 1, createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch feedback requests' });
  }
});

router.post('/requests', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const subjectId = String(req.body.subjectId || actorId);
    if (!canAccessEmployee(req, subjectId)) return res.status(403).json({ success: false, error: 'You cannot request feedback for this employee' });
    const reviewers = [...new Set([...(req.body.reviewerIds || []), req.body.reviewerId].filter(Boolean).map(String))]
      .filter((id) => id !== subjectId);
    if (reviewers.length === 0) return res.status(400).json({ success: false, error: 'At least one reviewer is required' });

    const dueDate = new Date(req.body.dueDate);
    if (Number.isNaN(dueDate.getTime()) || dueDate <= new Date()) {
      return res.status(400).json({ success: false, error: 'Due date must be in the future' });
    }
    const contextType = normalizeContextType(req.body.contextType);
    const anonymity = normalizeAnonymity(req.body.anonymity);
    if (anonymity === 'anonymous' && (contextType !== '360' || reviewers.length < 5)) {
      return res.status(400).json({ success: false, error: 'Anonymous 360 feedback requires at least five reviewers' });
    }

    const [requesterInfo, subjectInfo] = await Promise.all([
      resolvePerson(actorId, { name: req.session.user.name, email: req.session.user.email }),
      resolvePerson(subjectId, { name: req.body.subjectName, email: req.body.subjectEmail })
    ]);
    const cohortId = reviewers.length > 1 ? crypto.randomUUID() : undefined;
    const created = [];
    for (const reviewerId of reviewers) {
      const reviewerInfo = await resolvePerson(reviewerId);
      const request = await FeedbackRequest.create({
        organizationId: req.organizationId,
        requesterId: actorId,
        subjectId,
        reviewerId,
        requesterInfo,
        subjectInfo,
        reviewerInfo,
        contextType,
        contextLabel: cleanText(req.body.contextLabel, 300),
        questions: cleanQuestions(req.body.questions),
        dueDate,
        visibility: normalizeVisibility(req.body.visibility),
        anonymity,
        minimumCohortSize: 5,
        cohortId,
        createdBy: actorId
      });
      created.push(request);
      await recordEvent({
        organizationId: req.organizationId,
        type: 'feedback.requested',
        aggregateType: 'FeedbackRequest',
        aggregateId: String(request._id),
        actorId,
        recipients: [{ userId: reviewerId, name: reviewerInfo.name, email: reviewerInfo.email }],
        data: { subjectName: subjectInfo.name, dueDate, deepLink: `/feedback?request=${request._id}` }
      });
      await scheduleFeedbackRequestReminders(request);
    }
    res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to create feedback request' });
  }
});

router.post('/requests/:id/decision', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await FeedbackRequest.findById(req.params.id));
    const actorId = getActorId(req);
    if (item.reviewerId !== actorId) return res.status(403).json({ success: false, error: 'Only the requested reviewer can decide' });
    if (!['requested', 'accepted'].includes(item.state)) return res.status(409).json({ success: false, error: 'This request is no longer awaiting a decision' });
    const decision = req.body.decision;
    if (!['accept', 'decline'].includes(decision)) return res.status(400).json({ success: false, error: 'Decision must be accept or decline' });
    item.state = decision === 'accept' ? 'accepted' : 'declined';
    item.decisionComment = cleanText(req.body.comment, 1000);
    item.decidedAt = new Date();
    await item.save();
    if (decision === 'decline') {
      await closeFeedbackAction(
        item.organizationId,
        'FeedbackRequest',
        String(item._id),
        actorId,
        'feedback_request_declined'
      );
    }
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to decide feedback request' });
  }
});

router.get('/direct-reports', async (req, res) => {
  try {
    const directReports = (req.directReports || []).map(String);
    if (!['line_manager', 'team_lead', 'hr_admin'].includes(req.userRole)) return res.status(403).json({ success: false, error: 'Manager access required' });
    const items = directReports.length
      ? await Feedback.find(tenantFilter(req, {
        receiverId: { $in: directReports },
        visibility: { $in: ['public', 'manager-only'] },
        deletedAt: null
      })).sort({ createdAt: -1 }).limit(100).lean()
      : [];
    const visible = await filterReportableAnonymous(items, req.organizationId);
    res.json({ success: true, data: visible.map((item) => serializeFeedback(item, getActorId(req), req.userRole)), count: visible.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch team feedback' });
  }
});

router.post('/', async (req, res) => {
  try {
    const senderId = getActorId(req);
    const receiverId = String(req.body.receiverId || '');
    const content = cleanText(req.body.content, 5000);
    if (!receiverId || content.length < 3) return res.status(400).json({ success: false, error: 'Receiver and feedback of at least three characters are required' });
    if (receiverId === senderId) return res.status(400).json({ success: false, error: 'Feedback must be sent to another person' });

    const visibility = normalizeVisibility(req.body.visibility);
    if (visibility === 'manager-only' && !['line_manager', 'team_lead', 'hr_admin'].includes(req.userRole)) {
      return res.status(403).json({ success: false, error: 'Manager-only feedback requires manager access' });
    }
    let request = null;
    if (req.body.requestId) {
      request = assertResourceTenant(req, await FeedbackRequest.findById(req.body.requestId));
      if (request.reviewerId !== senderId || request.subjectId !== receiverId || !['requested', 'accepted'].includes(request.state)) {
        return res.status(409).json({ success: false, error: 'This feedback request cannot be fulfilled by this submission' });
      }
    }
    if (req.body.relatedOkrId) {
      const goal = await OKR.findOne(tenantFilter(req, { _id: req.body.relatedOkrId }));
      if (!goal) return res.status(400).json({ success: false, error: 'Related goal was not found in this organization' });
    }
    const [senderInfo, receiverInfo] = await Promise.all([
      resolvePerson(senderId, { name: req.session.user.name, email: req.session.user.email }),
      resolvePerson(receiverId, { name: req.body.receiverName, email: req.body.receiverEmail })
    ]);
    const item = await Feedback.create({
      organizationId: req.organizationId,
      senderId,
      receiverId,
      senderInfo,
      receiverInfo,
      content,
      type: normalizeType(req.body.type),
      visibility: request?.visibility || visibility,
      contextType: request?.contextType || normalizeContextType(req.body.contextType, req.body.relatedOkrId ? 'goal' : 'general'),
      contextLabel: request?.contextLabel || cleanText(req.body.contextLabel, 300),
      requestId: request?._id,
      anonymity: request?.anonymity || 'named',
      cohortId: request?.cohortId,
      minimumCohortSize: request?.minimumCohortSize || 5,
      relatedOkrId: req.body.relatedOkrId,
      projectId: request?.projectId
    });
    if (request) {
      request.state = 'fulfilled';
      request.fulfilledByFeedbackId = item._id;
      request.fulfilledAt = new Date();
      await request.save();
      await closeFeedbackAction(
        request.organizationId,
        'FeedbackRequest',
        String(request._id),
        senderId,
        'feedback_request_fulfilled'
      );
    }
    await recordEvent({
      organizationId: req.organizationId,
      type: 'feedback.received',
      aggregateType: 'Feedback',
      aggregateId: String(item._id),
      actorId: senderId,
      recipients: [{ userId: receiverId, name: receiverInfo.name, email: receiverInfo.email }],
      data: { feedbackType: item.type, deepLink: `/feedback?feedback=${item._id}` }
    });
    res.status(201).json({ success: true, data: serializeFeedback(item.toObject(), senderId, req.userRole), message: 'Feedback sent successfully' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to send feedback' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await Feedback.findById(req.params.id).lean());
    const actorId = getActorId(req);
    const isParticipant = [item.senderId, item.receiverId].map(String).includes(actorId);
    const managerCanView = (req.directReports || []).map(String).includes(String(item.receiverId)) && ['public', 'manager-only'].includes(item.visibility);
    if (!isParticipant && !managerCanView && req.userRole !== 'hr_admin') return res.status(403).json({ success: false, error: 'Access denied' });
    if (!(await anonymousFeedbackIsReportable(item))) {
      return res.status(404).json({ success: false, error: 'Feedback is not available until the anonymous cohort threshold is met' });
    }
    res.json({ success: true, data: serializeFeedback(item, actorId, req.userRole) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch feedback' });
  }
});

router.post('/:id/acknowledge', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await Feedback.findById(req.params.id));
    if (item.receiverId !== getActorId(req)) return res.status(403).json({ success: false, error: 'Only the recipient can acknowledge feedback' });
    item.acknowledgedAt = item.acknowledgedAt || new Date();
    await item.save();
    await closeFeedbackAction(
      item.organizationId,
      'Feedback',
      String(item._id),
      item.receiverId,
      'feedback_acknowledged'
    );
    res.json({ success: true, data: serializeFeedback(item.toObject(), getActorId(req), req.userRole) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to acknowledge feedback' });
  }
});

router.post('/:id/appraisal-evidence', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await Feedback.findById(req.params.id));
    const actorId = getActorId(req);
    if (item.receiverId !== actorId) return res.status(403).json({ success: false, error: 'Only the feedback recipient can select appraisal evidence' });
    if (item.anonymity === 'anonymous') {
      return res.status(409).json({ success: false, error: 'Anonymous feedback cannot be attached to an individual appraisal' });
    }
    if (!mongoose.isValidObjectId(req.body.appraisalId)) {
      return res.status(400).json({ success: false, error: 'A valid appraisalId is required' });
    }
    const appraisal = await Appraisal.findOne(tenantFilter(req, {
      _id: req.body.appraisalId,
      'employee.userId': actorId
    })).populate('cycleId', 'settings');
    if (!appraisal) return res.status(400).json({ success: false, error: 'Appraisal was not found' });
    if (['final_review_pending', 'employee_acknowledged', 'completed', 'cancelled'].includes(appraisal.status)) {
      return res.status(409).json({ success: false, error: 'Feedback evidence is locked after the appraisal is finalized' });
    }
    const settings = appraisal.cycleId?.settings || {};
    if (item.contextType === 'peer' && settings.enablePeerFeedback === false) {
      return res.status(409).json({ success: false, error: 'Peer feedback evidence is disabled for this appraisal cycle' });
    }
    if (['upward', '360'].includes(item.contextType) && settings.enable360Feedback !== true) {
      return res.status(409).json({ success: false, error: '360 feedback evidence is disabled for this appraisal cycle' });
    }
    let appraisalId = null;
    if (req.body.included) {
      appraisalId = appraisal._id;
      const alreadyIncluded = (appraisal.feedbackEvidence || []).some((evidence) => String(evidence.feedbackId) === String(item._id));
      if (!alreadyIncluded) {
        appraisal.feedbackEvidence.push({
          feedbackId: item._id,
          type: item.type,
          content: item.content,
          contextType: item.contextType,
          contextLabel: item.contextLabel,
          senderDisplay: item.anonymity === 'named' ? (item.senderInfo?.name || item.senderInfo?.email || 'Feedback provider') : 'Anonymous',
          receivedAt: item.createdAt,
          selectedAt: new Date(),
          selectedBy: actorId
        });
        appraisal.addAuditLog('feedback_evidence_added', req.session.user, { feedbackId: item._id });
        await appraisal.save();
      }
    } else {
      appraisal.feedbackEvidence = (appraisal.feedbackEvidence || [])
        .filter((evidence) => String(evidence.feedbackId) !== String(item._id));
      appraisal.addAuditLog('feedback_evidence_removed', req.session.user, { feedbackId: item._id });
      await appraisal.save();
    }
    item.appraisalEvidence = {
      included: Boolean(req.body.included),
      selectedBy: actorId,
      appraisalId,
      selectedAt: new Date()
    };
    await item.save();
    res.json({ success: true, data: serializeFeedback(item.toObject(), actorId, req.userRole) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to update appraisal evidence' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await Feedback.findById(req.params.id));
    const actorId = getActorId(req);
    if (item.senderId !== actorId && req.userRole !== 'hr_admin') return res.status(403).json({ success: false, error: 'Only the sender or HR can remove feedback' });
    item.deletedAt = new Date();
    await item.save();
    res.json({ success: true, message: 'Feedback removed' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to remove feedback' });
  }
});

module.exports = router;
