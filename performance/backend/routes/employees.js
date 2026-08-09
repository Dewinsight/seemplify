const express = require('express');
const OKR = require('../models/OKR');
const Feedback = require('../models/Feedback');
const Appraisal = require('../models/Appraisal');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const PerformanceCheckIn = require('../models/PerformanceCheckIn');
const GoalCheckIn = require('../models/GoalCheckIn');
const OneOnOne = require('../models/OneOnOne');
const { internalServiceAuth } = require('../middleware/internalServiceAuth');
const { requireAuth } = require('../middleware/rbac');
const {
  canAccessEmployee,
  getActorId,
  requireOrganization
} = require('../services/tenantPolicy');

const router = express.Router();

function timelineDate(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function timelineEntry(type, occurredAt, data) {
  return { type, occurredAt, ...data };
}

router.get('/:userId/timeline', requireAuth, requireOrganization, async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId || !canAccessEmployee(req, userId)) {
      return res.status(403).json({ success: false, error: 'You cannot view this employee timeline' });
    }

    const actorId = getActorId(req);
    const isSelf = actorId === userId;
    const isHr = req.userRole === 'hr_admin';
    const from = timelineDate(req.query.from, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    const to = timelineDate(req.query.to, new Date());
    if (to < from) return res.status(400).json({ success: false, error: 'Timeline date range is invalid' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
    const dateRange = { $gte: from, $lte: to };

    const [goals, goalCheckIns, feedback, appraisals, plans, checkIns, meetings] = await Promise.all([
      OKR.find({
        organizationId: req.organizationId,
        ownerId: userId,
        updatedAt: dateRange
      }).select('title period lifecycle status health progress scoring updatedAt creationSource assignment.assignedBy').lean(),
      GoalCheckIn.find({
        organizationId: req.organizationId,
        ownerId: userId,
        createdAt: dateRange
      }).select('goalId summary health confidence blockers scoreSnapshot.progress createdAt').lean(),
      Feedback.find({
        organizationId: req.organizationId,
        receiverId: userId,
        deletedAt: null,
        createdAt: dateRange,
        ...(isSelf ? { visibility: { $ne: 'manager-only' } } : { visibility: { $in: ['public', 'manager-only'] } })
      }).select('senderId senderInfo type visibility contextType contextLabel anonymity content acknowledgedAt createdAt').lean(),
      Appraisal.find({
        organizationId: req.organizationId,
        'employee.userId': userId,
        createdAt: { $lte: to }
      }).select('cycleId status goalEvidenceSummary finalRating createdAt updatedAt').populate('cycleId', 'name periodStart periodEnd').lean(),
      DevelopmentPlan.find({
        organizationId: req.organizationId,
        userId,
        updatedAt: dateRange
      }).select('title status overallProgress milestones reviewDates linkedAppraisalId updatedAt').lean(),
      PerformanceCheckIn.find({
        organizationId: req.organizationId,
        employeeId: userId,
        status: 'submitted',
        submittedAt: dateRange,
        ...(!isSelf && !isHr ? { visibility: 'employee_manager' } : {})
      }).select('cadence periodStart periodEnd wins priorities blockers supportNeeded pulse linkedGoalIds submittedAt managerResponse visibility').lean(),
      OneOnOne.find({
        organizationId: req.organizationId,
        employeeId: userId,
        scheduledDate: dateRange,
        ...(isHr ? {} : { $or: [{ employeeId: actorId }, { managerId: actorId }] })
      }).select('title managerId employeeId scheduledDate status meetingType sharedNotes actionItems').lean()
    ]);

    const entries = [];
    for (const goal of goals) {
      entries.push(timelineEntry('goal', goal.updatedAt, {
        id: goal._id,
        title: goal.title || 'Goal',
        period: goal.period,
        status: goal.lifecycle?.state || goal.status,
        health: goal.health,
        progress: goal.scoring?.progress ?? goal.progress,
        origin: goal.creationSource,
        assignedBy: goal.assignment?.assignedBy?.name || null
      }));
    }
    for (const checkIn of goalCheckIns) {
      entries.push(timelineEntry('goal_check_in', checkIn.createdAt, {
        id: checkIn._id,
        goalId: checkIn.goalId,
        summary: checkIn.summary,
        health: checkIn.health,
        confidence: checkIn.confidence,
        progress: checkIn.scoreSnapshot?.progress,
        openBlockerCount: (checkIn.blockers || []).filter((blocker) => blocker.status !== 'resolved').length
      }));
    }
    for (const item of feedback) {
      const anonymous = item.anonymity === 'anonymous';
      entries.push(timelineEntry('feedback', item.createdAt, {
        id: item._id,
        feedbackType: item.type,
        contextType: item.contextType,
        contextLabel: item.contextLabel,
        content: item.content,
        sender: anonymous ? { name: 'Anonymous' } : { name: item.senderInfo?.name || 'Colleague' },
        acknowledgedAt: item.acknowledgedAt
      }));
    }
    for (const appraisal of appraisals) {
      const acknowledged = appraisal.status === 'employee_acknowledged';
      entries.push(timelineEntry('appraisal', appraisal.finalRating?.finalizedAt || appraisal.updatedAt || appraisal.createdAt, {
        id: appraisal._id,
        cycle: appraisal.cycleId,
        status: appraisal.status,
        goalEvidence: appraisal.goalEvidenceSummary,
        finalRating: (acknowledged || !isSelf) ? appraisal.finalRating : null,
        finalRatingWithheldUntilAcknowledgement: Boolean(isSelf && appraisal.finalRating && !acknowledged)
      }));
    }
    for (const plan of plans) {
      entries.push(timelineEntry('development_plan', plan.updatedAt, {
        id: plan._id,
        title: plan.title,
        status: plan.status,
        progress: plan.overallProgress,
        linkedAppraisalId: plan.linkedAppraisalId,
        nextReviewDate: (plan.reviewDates || []).filter((date) => new Date(date) >= new Date()).sort()[0] || null,
        openMilestones: (plan.milestones || []).filter((milestone) => !['completed', 'cancelled'].includes(milestone.status)).length
      }));
    }
    for (const checkIn of checkIns) {
      entries.push(timelineEntry('performance_check_in', checkIn.submittedAt, {
        id: checkIn._id,
        cadence: checkIn.cadence,
        periodStart: checkIn.periodStart,
        periodEnd: checkIn.periodEnd,
        wins: checkIn.wins,
        priorities: checkIn.priorities,
        blockers: checkIn.blockers,
        supportNeeded: checkIn.supportNeeded,
        pulse: checkIn.pulse,
        linkedGoalIds: checkIn.linkedGoalIds,
        managerRespondedAt: checkIn.managerResponse?.respondedAt || null
      }));
    }
    for (const meeting of meetings) {
      entries.push(timelineEntry('one_on_one', meeting.scheduledDate, {
        id: meeting._id,
        title: meeting.title,
        status: meeting.status,
        meetingType: meeting.meetingType,
        sharedNotes: meeting.sharedNotes,
        actionItems: (meeting.actionItems || []).map((item) => ({
          id: item.id,
          description: item.description,
          assignedTo: item.assignedTo,
          dueDate: item.dueDate,
          status: item.status
        }))
      }));
    }

    const boundedEntries = entries.filter((entry) => {
      const occurredAt = new Date(entry.occurredAt);
      return !Number.isNaN(occurredAt.getTime()) && occurredAt >= from && occurredAt <= to;
    });
    boundedEntries.sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt));
    return res.json({
      success: true,
      data: boundedEntries.slice(0, limit),
      meta: {
        employeeId: userId,
        from,
        to,
        limit,
        generatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Employee performance timeline error:', error);
    return res.status(500).json({ success: false, error: 'Failed to build employee timeline' });
  }
});

router.get('/:userId/performance-summary', internalServiceAuth, async (req, res) => {
  try {
    const organizationId = String(req.get('x-organization-id') || '').trim();
    const userId = String(req.params.userId || '').trim();
    if (!organizationId || !userId) {
      return res.status(400).json({ success: false, error: 'Organization and employee identifiers are required' });
    }

    const now = new Date();
    const [goals, appraisal, feedbackCount, developmentPlan, latestCheckIn] = await Promise.all([
      OKR.find({
        organizationId,
        ownerId: userId,
        $or: [
          { 'lifecycle.state': { $in: ['active', 'closed'] } },
          { status: { $in: ['active', 'closed'] } }
        ]
      }).sort({ updatedAt: -1 }).limit(20).lean(),
      Appraisal.findOne({ organizationId, 'employee.userId': userId })
        .sort({ createdAt: -1 })
        .select('cycleId status finalRating goalEvidenceSummary deadlines')
        .populate('cycleId', 'name periodStart periodEnd')
        .lean(),
      Feedback.countDocuments({ organizationId, receiverId: userId, deletedAt: null }),
      DevelopmentPlan.findOne({ organizationId, userId, status: { $in: ['draft', 'active'] } })
        .sort({ updatedAt: -1 })
        .select('title status targetDate overallProgress reviewDates')
        .lean(),
      PerformanceCheckIn.findOne({ organizationId, employeeId: userId, status: 'submitted' })
        .sort({ submittedAt: -1 })
        .select('periodStart periodEnd submittedAt nextDueAt')
        .lean()
    ]);

    const acknowledged = appraisal?.status === 'employee_acknowledged';
    res.json({
      success: true,
      schemaVersion: '1.0',
      generatedAt: now,
      organizationId,
      employeeId: userId,
      data: {
        goals: goals.map((goal) => ({
          id: goal._id,
          title: goal.title || goal.objectives?.[0]?.title || 'Untitled goal',
          period: goal.periodSnapshot?.label || goal.period,
          status: goal.lifecycle?.state || goal.status,
          progress: goal.progress,
          health: goal.health || goal.latestHealth || 'not_set',
          dueDate: goal.periodSnapshot?.endDate || null
        })),
        appraisal: appraisal ? {
          id: appraisal._id,
          cycle: appraisal.cycleId,
          status: appraisal.status,
          goalEvidence: appraisal.goalEvidenceSummary,
          finalRating: acknowledged ? appraisal.finalRating : null,
          finalRatingWithheldUntilAcknowledgement: Boolean(appraisal.finalRating && !acknowledged),
          deadlines: appraisal.deadlines
        } : null,
        feedback: { receivedCount: feedbackCount },
        developmentPlan,
        latestCheckIn
      }
    });
  } catch (error) {
    console.error('Internal performance summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to build performance summary' });
  }
});

module.exports = router;
