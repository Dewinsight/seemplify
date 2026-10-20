const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const { filterReportableAnonymous, anonymousFeedbackIsReportable, serializeFeedback, feedbackHidesSender } = require('../services/feedbackPrivacyService');
const requestIdempotency = require('../services/feedbackRequestIdempotencyService');
const FeedbackRequest = require('../models/FeedbackRequest');
const OKR = require('../models/OKR');
const Appraisal = require('../models/Appraisal');
const User = require('../models/User');
const ScheduledReminder = require('../models/ScheduledReminder');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const { resolvePerformanceColleague } = require('../services/performanceColleagueDirectoryService');
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

function requestNeedsPrivacySummary(item, role) {
  return item.anonymity === 'anonymous' || (item.anonymity === 'confidential' && role !== 'hr_admin');
}

async function serializeFeedbackRequests(items, req, reviewerView = false) {
  // Only the reviewer's own inbox retains actionable per-person invitations.
  // Other anonymous reads use cohort progress, including creation responses.
  if (reviewerView) return items;
  const groups = new Map();
  const output = [];
  for (const source of items) {
    const item = source.toObject ? source.toObject() : source;
    if (!requestNeedsPrivacySummary(item, req.userRole)) { output.push(item); continue; }
    const key = JSON.stringify([item.anonymity, item.subjectId, item.requesterId, item.cohortId || String(item._id)]);
    if (!groups.has(key)) { groups.set(key, { item }); output.push(groups.get(key)); }
  }
  if (!groups.size) return output;
  const clauses = [...groups.values()].map(({ item }) => item.cohortId
    ? { cohortId: item.cohortId, subjectId: item.subjectId, requesterId: item.requesterId, anonymity: item.anonymity }
    : { _id: item._id });
  // Count the complete cohort even when the inbox's row limit cuts through it.
  const requests = await FeedbackRequest.find(tenantFilter(req, { $or: clauses }))
    .select('_id cohortId subjectId requesterId anonymity minimumCohortSize').lean();
  const cohortIds = [...new Set(requests.map(item => item.cohortId).filter(Boolean))];
  const counts = await Feedback.aggregate([
    { $match: tenantFilter(req, { deletedAt: null, $or: [
      { cohortId: { $in: cohortIds } }, { requestId: { $in: requests.map(item => item._id) } }
    ] }) },
    { $group: { _id: { cohortId: '$cohortId', receiverId: '$receiverId', anonymity: '$anonymity', requestId: '$requestId', senderId: '$senderId' }, count: { $sum: 1 } } }
  ]);
  for (const group of groups.values()) {
    const item = group.item;
    const members = requests.filter(row => item.cohortId
      ? row.cohortId === item.cohortId && row.subjectId === item.subjectId && row.requesterId === item.requesterId && row.anonymity === item.anonymity
      : String(row._id) === String(item._id));
    const ids = new Set(members.map(row => String(row._id)));
    const responses = counts.filter(row => row._id.receiverId === item.subjectId && row._id.anonymity === item.anonymity &&
      (item.cohortId ? row._id.cohortId === item.cohortId : ids.has(String(row._id.requestId))));
    const responseCount = item.anonymity === 'anonymous'
      ? new Set(responses.map(row => row._id.senderId).filter(id => typeof id === 'string' && id.trim())).size
      : responses.reduce((total, row) => total + row.count, 0);
    const anonymous = item.anonymity === 'anonymous';
    const minimumCohortSize = Math.max(5, ...members.map(row => Number(row.minimumCohortSize) || 5));
    const reportable = !anonymous || Boolean(item.cohortId && responseCount >= minimumCohortSize);
    Object.assign(group, {
      kind: anonymous ? 'cohort' : 'confidential_summary',
      ...(item.cohortId ? { cohortId: item.cohortId } : {}),
      subjectId: item.subjectId, subjectInfo: item.subjectInfo, contextType: item.contextType,
      contextLabel: item.contextLabel, questions: item.questions, dueDate: item.dueDate,
      visibility: item.visibility, anonymity: item.anonymity, minimumCohortSize,
      reviewerCount: members.length, reportable, responseCount: reportable ? responseCount : null,
      state: reportable ? 'reportable' : 'collecting'
    });
    delete group.item;
  }
  return output;
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
    if (req.query.state) {
      // State filters must not reveal individual anonymous responses through
      // the presence/absence of a cohort or a changing invitation count.
      if (!['requested', 'subject'].includes(view)) query.state = req.query.state;
      else query.$or = [{ anonymity: { $in: req.userRole === 'hr_admin' ? ['anonymous'] : ['anonymous', 'confidential'] } }, { state: req.query.state }];
    }
    const items = await FeedbackRequest.find(query).sort({ dueDate: 1, createdAt: -1 }).limit(100).lean();
    const data = await serializeFeedbackRequests(items, req, !['requested', 'subject'].includes(view));
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch feedback requests' });
  }
});

router.post('/requests', requirePermission('feedback:request'), async (req, res) => {
  try {
    const actorId = getActorId(req);
    const subjectId = String(req.body.subjectId || actorId);
    if (!canAccessEmployee(req, subjectId)) return res.status(403).json({ success: false, error: 'You cannot request feedback for this employee' });
    const reviewers = [...new Set([...(req.body.reviewerIds || []), req.body.reviewerId].filter(Boolean).map(String))]
      .filter((id) => id !== subjectId);
    if (reviewers.length === 0) return res.status(400).json({ success: false, error: 'At least one reviewer is required' });

    const dueDate = new Date(req.body.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Due date must be in the future' });
    }
    const contextType = normalizeContextType(req.body.contextType);
    const anonymity = normalizeAnonymity(req.body.anonymity);
    if (anonymity === 'anonymous' && (contextType !== '360' || reviewers.length < 5)) {
      return res.status(400).json({ success: false, error: 'Anonymous 360 feedback requires at least five reviewers' });
    }

    const batch = await requestIdempotency.beginBatch({ organizationId: req.organizationId, actorId,
      key: req.get('Idempotency-Key'), payload: {
        subjectId, reviewerIds: [...reviewers].sort(), dueDate: dueDate.toISOString(), contextType, anonymity,
        contextLabel: cleanText(req.body.contextLabel, 300), questions: cleanQuestions(req.body.questions), visibility: normalizeVisibility(req.body.visibility)
      } });
    const replay = await requestIdempotency.completedBatch(batch);
    if (replay) {
      const data = await serializeFeedbackRequests(replay, req);
      return res.status(201).json({ success: true, data, count: data.length });
    }
    if (dueDate <= new Date()) return res.status(400).json({ success: false, error: 'Due date must be in the future' });

    const [requesterInfo, subjectInfo] = await Promise.all([
      resolvePerson(actorId, { name: req.session.user.name, email: req.session.user.email }),
      resolvePerformanceColleague(req, subjectId, { action: 'feedback:request' })
    ]);
    const contacts = await Promise.all(reviewers.map(userId => resolvePerformanceColleague(req, userId, { action: 'feedback:request' })));
    const reviewerContacts = [...new Map(contacts.filter(person => person.userId !== subjectInfo.userId).map(person => [person.userId, person])).values()];
    if (!reviewerContacts.length || (anonymity === 'anonymous' && reviewerContacts.length < 5)) {
      return res.status(400).json({ success: false, error: anonymity === 'anonymous' ? 'Anonymous 360 feedback requires at least five distinct reviewers' : 'At least one reviewer is required' });
    }
    const cohortId = reviewerContacts.length > 1 ? batch?.result?.cohortId || crypto.randomUUID() : undefined;
    const created = [];
    for (const reviewerInfo of reviewerContacts) {
      const reviewerId = reviewerInfo.userId;
      const document = {
        organizationId: req.organizationId,
        requesterId: actorId,
        subjectId: subjectInfo.userId,
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
      };
      let request;
      if (batch) {
        const id = requestIdempotency.invitationId(batch, reviewerId);
        try {
          request = await FeedbackRequest.findOneAndUpdate({ _id: id }, { $setOnInsert: { _id: id, ...document } },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
        } catch (error) {
          if (error.code !== 11000) throw error;
          request = await FeedbackRequest.findById(id);
        }
        if (!request || request.organizationId !== req.organizationId || request.requesterId !== actorId || request.subjectId !== subjectInfo.userId || request.reviewerId !== reviewerId) {
          return res.status(409).json({ success: false, code: 'REQUEST_RECOVERY_REQUIRED', error: 'Check the existing invitations before starting another request.' });
        }
      } else request = await FeedbackRequest.create(document);
      created.push(request);
      await recordEvent({
        organizationId: req.organizationId,
        type: 'feedback.requested',
        aggregateType: 'FeedbackRequest',
        aggregateId: String(request._id),
        actorId,
        recipients: [{ userId: reviewerId, name: request.reviewerInfo?.name, email: request.reviewerInfo?.email }],
        data: { subjectName: request.subjectInfo?.name, dueDate: request.dueDate, deepLink: `/feedback?request=${request._id}` }
      });
      if (['requested', 'accepted'].includes(request.state) && (!batch || !await ScheduledReminder.exists({
        organizationId: req.organizationId, 'target.type': 'FeedbackRequest', 'target.id': String(request._id), userId: reviewerId
      }))) await scheduleFeedbackRequestReminders(request);
    }
    await requestIdempotency.finishBatch(batch, created);
    const data = await serializeFeedbackRequests(created, req);
    res.status(201).json({ success: true, data, count: data.length });
  } catch (error) {
    const status = error.status || error.statusCode || 500;
    res.status(status).json({ success: false, ...(error.code && typeof error.code === 'string' ? { code: error.code } : {}),
      error: status < 500 ? error.message : 'Could not finish this request. Retry it from the original form.' });
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
    const updated = await FeedbackRequest.findOneAndUpdate({ _id: item._id, organizationId: req.organizationId, reviewerId: actorId,
      state: { $in: ['requested', 'accepted'] }, $or: [{ fulfilledByFeedbackId: null }, { fulfilledByFeedbackId: { $exists: false } }] },
    { $set: { state: decision === 'accept' ? 'accepted' : 'declined', decisionComment: cleanText(req.body.comment, 1000), decidedAt: new Date() } }, { new: true });
    if (!updated) return res.status(409).json({ success: false, error: 'This request changed or a response is being saved. Reload its current status.' });
    if (decision === 'decline') {
      await closeFeedbackAction(
        item.organizationId,
        'FeedbackRequest',
        String(item._id),
        actorId,
        'feedback_request_declined'
      );
    }
    res.json({ success: true, data: updated });
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

router.post('/', requirePermission('feedback:send'), async (req, res) => {
  try {
    const senderId = getActorId(req);
    let receiverId = String(req.body.receiverId || '');
    const content = cleanText(req.body.content, 5000);
    if (!receiverId || content.length < 3) return res.status(400).json({ success: false, error: 'Receiver and feedback of at least three characters are required' });
    if (receiverId === senderId) return res.status(400).json({ success: false, error: 'Feedback must be sent to another person' });

    const visibility = normalizeVisibility(req.body.visibility);
    let request = null;
    if (req.body.requestId) {
      request = assertResourceTenant(req, await FeedbackRequest.findById(req.body.requestId));
      if (request.reviewerId !== senderId || request.subjectId !== receiverId || !['requested', 'accepted', 'fulfilled'].includes(request.state)) {
        return res.status(409).json({ success: false, error: 'This feedback request cannot be fulfilled by this submission' });
      }
    }
    if (!request && visibility === 'manager-only' && !['line_manager', 'team_lead', 'hr_admin'].includes(req.userRole)) {
      return res.status(403).json({ success: false, error: 'Manager-only feedback requires manager access' });
    }
    if (req.body.relatedOkrId) {
      const goal = await OKR.findOne(tenantFilter(req, { _id: req.body.relatedOkrId }));
      if (!goal) return res.status(400).json({ success: false, error: 'Related goal was not found in this organization' });
    }
    const [senderInfo, receiverInfo] = await Promise.all([
      resolvePerson(senderId, { name: req.session.user.name, email: req.session.user.email }),
      resolvePerformanceColleague(req, receiverId, { action: 'feedback:send' })
    ]);
    receiverId = receiverInfo.userId;
    if (receiverId === senderId) return res.status(400).json({ success: false, error: 'Feedback must be sent to another person' });
    const document = {
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
    };
    let item;
    if (request) {
      // One immutable response per invitation, including concurrent sends and
      // interrupted receipt saves. Existing fulfilled legacy references win.
      const id = request.state === 'fulfilled' ? request.fulfilledByFeedbackId : new mongoose.Types.ObjectId(
        crypto.createHash('sha256').update(JSON.stringify(['feedback.response', req.organizationId, String(request._id)])).digest('hex').slice(0, 24));
      if (!id) return res.status(409).json({ success: false, code: 'RESPONSE_RECOVERY_REQUIRED', error: 'Check the existing response before submitting again.' });
      if (request.state === 'fulfilled') item = await Feedback.findById(id);
      else {
        // Claim the existing invitation before capturing a response. A racing
        // decline either wins first or observes this claim; no orphan response
        // can be created after a successful decline. Retries reuse the claim.
        const claim = await FeedbackRequest.findOneAndUpdate({ _id: request._id, organizationId: req.organizationId,
          reviewerId: senderId, subjectId: receiverId, state: { $in: ['requested', 'accepted'] },
          $or: [{ fulfilledByFeedbackId: null }, { fulfilledByFeedbackId: { $exists: false } }, { fulfilledByFeedbackId: id }] },
        { $set: { fulfilledByFeedbackId: id } }, { new: true });
        if (!claim) {
          const current = await FeedbackRequest.findById(request._id);
          if (current?.state !== 'fulfilled' || String(current.fulfilledByFeedbackId) !== String(id)) {
            return res.status(409).json({ success: false, error: 'This feedback request changed. Reload its current status.' });
          }
        }
        try {
          item = await Feedback.findOneAndUpdate({ _id: id }, { $setOnInsert: { _id: id, ...document } },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
        } catch (error) {
          if (error.code !== 11000) throw error;
          item = await Feedback.findById(id);
        }
      }
      if (!item || item.deletedAt || item.organizationId !== req.organizationId || item.senderId !== senderId || item.receiverId !== receiverId ||
          String(item.requestId) !== String(request._id) || item.content !== content || item.type !== document.type || String(item.relatedOkrId || '') !== String(document.relatedOkrId || '')) {
        return res.status(409).json({ success: false, code: 'RESPONSE_ALREADY_CAPTURED', error: 'This invitation already has a different response. Its original feedback is preserved.' });
      }
      const receipt = await FeedbackRequest.findOneAndUpdate({ _id: request._id, organizationId: req.organizationId,
        reviewerId: senderId, subjectId: receiverId, state: { $in: ['requested', 'accepted'] } },
      { $set: { state: 'fulfilled', fulfilledByFeedbackId: item._id, fulfilledAt: new Date() } }, { new: true });
      if (!receipt) {
        const current = await FeedbackRequest.findById(request._id);
        if (current?.state !== 'fulfilled' || String(current.fulfilledByFeedbackId) !== String(item._id)) {
          return res.status(409).json({ success: false, error: 'This feedback request changed. Reload its current status.' });
        }
      }
      await closeFeedbackAction(
        request.organizationId,
        'FeedbackRequest',
        String(request._id),
        senderId,
        'feedback_request_fulfilled'
      );
    } else item = await Feedback.create(document);
    const anonymous = item.anonymity === 'anonymous';
    await recordEvent({
      organizationId: req.organizationId,
      type: 'feedback.received',
      aggregateType: 'Feedback',
      aggregateId: String(item._id),
      actorId: senderId,
      // Keep the per-response audit private. Even a generic subject action
      // with an individual target/timestamp can reveal anonymous progress.
      recipients: anonymous ? [] : [{ userId: receiverId, name: item.receiverInfo?.name, email: item.receiverInfo?.email }],
      data: { feedbackType: item.type, deepLink: `/feedback?feedback=${item._id}` }
    });
    if (anonymous && await anonymousFeedbackIsReportable(item)) {
      await recordEvent({
        eventId: `feedback.cohort_available:${crypto.createHash('sha256').update(JSON.stringify([req.organizationId, item.cohortId, receiverId])).digest('hex')}`,
        organizationId: req.organizationId,
        type: 'feedback.received',
        aggregateType: 'FeedbackCohort',
        aggregateId: item.cohortId,
        // Stable content keeps concurrent threshold crossings and subsequent
        // responses idempotent without capturing the last respondent.
        recipients: [{ userId: receiverId }],
        data: { deepLink: '/feedback' },
        notification: { action: { kind: 'view', label: 'View feedback' } }
      });
    }
    res.status(201).json({ success: true, data: serializeFeedback(item.toObject(), senderId, req.userRole), message: 'Feedback sent successfully' });
  } catch (error) {
    const status = error.status || error.statusCode || 500;
    res.status(status).json({ success: false, error: status < 500 ? error.message : 'Could not send this feedback. Retry the original response.' });
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
    if (!(await anonymousFeedbackIsReportable(item))) {
      return res.status(404).json({ success: false, error: 'Feedback is not available until the anonymous cohort threshold is met' });
    }
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
          receivedAt: feedbackHidesSender(item, actorId, req.userRole) ? undefined : item.createdAt,
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
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, code: 'INVALID_EVIDENCE_REFERENCE', error: 'Choose valid feedback and an appraisal.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, code: 'INVALID_APPRAISAL_EVIDENCE', error: 'Feedback evidence could not be saved. Reload the appraisal and retry.' });
    }
    if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, code: 'FEEDBACK_EVIDENCE_SAVE_FAILED', error: 'Failed to update appraisal evidence. Please retry.' });
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
