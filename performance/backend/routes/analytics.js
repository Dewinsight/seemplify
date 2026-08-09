const express = require('express');
const OKR = require('../models/OKR');
const GoalCheckIn = require('../models/GoalCheckIn');
const Appraisal = require('../models/Appraisal');
const Feedback = require('../models/Feedback');
const { requireAuth } = require('../middleware/rbac');
const {
  getActorId,
  requireOrganization
} = require('../services/tenantPolicy');
const {
  getDirectReportIds,
  getManagedTeamIds,
  getUserTeamIds
} = require('../services/goalPermissionService');

const router = express.Router();
const ANALYTICS_PRIVACY_THRESHOLD = 5;

router.use(requireAuth, requireOrganization);

function isHr(req) {
  return req.userRole === 'hr_admin';
}

function allowedEmployeeIds(req) {
  if (isHr(req)) return null;
  return Array.from(new Set([
    getActorId(req),
    ...getDirectReportIds(req)
  ].filter(Boolean).map(String)));
}

function canViewTeam(req, teamId) {
  if (isHr(req)) return true;
  const allowedTeams = new Set([
    ...getManagedTeamIds(req),
    ...getUserTeamIds(req)
  ].map(String));
  return allowedTeams.has(String(teamId));
}

function calculateGoalProgress(goal) {
  const stored = Number(goal?.scoring?.progress ?? goal?.progress);
  if (Number.isFinite(stored)) return Math.max(0, Math.min(100, stored));

  const values = [];
  for (const objective of goal?.objectives || []) {
    for (const keyResult of objective?.keyResults || []) {
      if (keyResult.currentValue === undefined || keyResult.currentValue === null) continue;
      const start = Number(keyResult.startValue || 0);
      const current = Number(keyResult.currentValue);
      const target = Number(keyResult.targetValue);
      if (![start, current, target].every(Number.isFinite)) continue;
      const decreasing = keyResult.direction === 'decrease' || target < start;
      const denominator = decreasing ? start - target : target - start;
      if (denominator === 0) {
        values.push(current === target ? 100 : 0);
      } else {
        const raw = decreasing ? ((start - current) / denominator) * 100 : ((current - start) / denominator) * 100;
        values.push(Math.max(0, Math.min(100, raw)));
      }
    }
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function monthKey(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [year, month] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

// Canonical team analytics. Ratings are suppressed below the minimum cohort.
router.get('/team/:teamId', async (req, res) => {
  try {
    const teamId = String(req.params.teamId || '').trim();
    if (!teamId || !canViewTeam(req, teamId)) {
      return res.status(403).json({ success: false, error: 'You cannot view analytics for this team' });
    }

    const employeeIds = allowedEmployeeIds(req);
    const appraisalQuery = {
      organizationId: req.organizationId,
      'employee.teamId': teamId,
      status: { $in: ['completed', 'employee_acknowledged'] },
      'finalRating.finalizedAt': { $ne: null }
    };
    if (employeeIds) appraisalQuery['employee.userId'] = { $in: employeeIds };

    const goalQuery = {
      organizationId: req.organizationId,
      $or: [
        { 'teamHierarchy.teamId': teamId },
        { type: 'team', 'teamHierarchy.teamPath': teamId }
      ]
    };
    if (employeeIds) {
      goalQuery.$and = [{
        $or: [
          { ownerId: { $in: employeeIds } },
          { type: 'team' }
        ]
      }];
    }

    const [appraisals, goals] = await Promise.all([
      Appraisal.find(appraisalQuery).select('finalRating.overall employee.userId').lean(),
      OKR.find(goalQuery).select('ownerId objectives progress scoring createdAt').lean()
    ]);

    const distribution = [
      { name: 'Exceeds', count: 0 },
      { name: 'Meets', count: 0 },
      { name: 'Needs Imp.', count: 0 }
    ];
    for (const appraisal of appraisals) {
      const rating = Number(appraisal.finalRating?.overall);
      if (!Number.isFinite(rating)) continue;
      if (rating >= 4) distribution[0].count += 1;
      else if (rating >= 3) distribution[1].count += 1;
      else distribution[2].count += 1;
    }

    const goalIds = goals.map((goal) => goal._id);
    const checkIns = goalIds.length > 0
      ? await GoalCheckIn.find({
        organizationId: req.organizationId,
        goalId: { $in: goalIds }
      }).select('createdAt scoreSnapshot.progress').sort({ createdAt: 1 }).lean()
      : [];

    const monthly = new Map();
    for (const checkIn of checkIns) {
      const key = monthKey(checkIn.createdAt);
      const progress = Number(checkIn.scoreSnapshot?.progress);
      if (!key || !Number.isFinite(progress)) continue;
      const bucket = monthly.get(key) || [];
      bucket.push(progress);
      monthly.set(key, bucket);
    }

    if (monthly.size === 0 && goals.length > 0) {
      const values = goals.map(calculateGoalProgress).filter(Number.isFinite);
      if (values.length > 0) monthly.set(monthKey(new Date()), values);
    }

    const okrCompletionHistory = Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-12)
      .map(([key, values]) => ({
        month: monthLabel(key),
        avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      }));

    const ratingsSuppressed = appraisals.length < ANALYTICS_PRIVACY_THRESHOLD;
    return res.json({
      success: true,
      data: {
        performanceDistribution: ratingsSuppressed ? [] : distribution,
        okrCompletionHistory,
        privacy: {
          threshold: ANALYTICS_PRIVACY_THRESHOLD,
          ratingsSuppressed
        },
        definitions: {
          performanceDistribution: 'Finalized canonical appraisal ratings grouped into three display bands.',
          okrCompletionHistory: 'Average measured goal achievement from append-only goal check-ins.'
        },
        refreshedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching team analytics:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch team analytics' });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const employeeIds = allowedEmployeeIds(req) || [];
    const goalQuery = { organizationId: req.organizationId };
    const appraisalQuery = {
      organizationId: req.organizationId,
      status: { $nin: ['completed', 'employee_acknowledged', 'cancelled'] }
    };
    const feedbackQuery = {
      organizationId: req.organizationId,
      deletedAt: null,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    };

    if (!isHr(req)) {
      goalQuery.ownerId = { $in: employeeIds };
      appraisalQuery.$or = [
        { 'employee.userId': { $in: employeeIds } },
        { 'manager.userId': actorId }
      ];
      feedbackQuery.receiverId = { $in: employeeIds };
    }

    const [goals, pendingReviews, recentFeedback] = await Promise.all([
      OKR.find(goalQuery).select('objectives progress scoring status').lean(),
      Appraisal.countDocuments(appraisalQuery),
      Feedback.countDocuments(feedbackQuery)
    ]);

    const measuredProgress = goals.map(calculateGoalProgress).filter(Number.isFinite);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = goals.filter((goal) =>
      (goal.objectives || []).some((objective) =>
        (objective.keyResults || []).some((keyResult) => {
          if (!keyResult.dueDate) return false;
          const dueDate = new Date(keyResult.dueDate);
          return dueDate >= now && dueDate <= sevenDaysFromNow;
        })
      )
    ).length;

    return res.json({
      success: true,
      data: {
        okrProgress: measuredProgress.length > 0
          ? Math.round(measuredProgress.reduce((sum, value) => sum + value, 0) / measuredProgress.length)
          : null,
        pendingReviews,
        recentFeedback,
        totalOkrs: goals.length,
        completedOkrs: goals.filter((goal) => goal.status === 'closed').length,
        upcomingDeadlines,
        refreshedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch dashboard analytics' });
  }
});

module.exports = router;
