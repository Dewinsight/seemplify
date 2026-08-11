const express = require('express');
const OKR = require('../models/OKR');
const GoalCheckIn = require('../models/GoalCheckIn');
const Appraisal = require('../models/Appraisal');
const Feedback = require('../models/Feedback');
const AppraisalCycle = require('../models/AppraisalCycle');
const { requireAuth, requireManager } = require('../middleware/rbac');
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

function round(value, decimals = 1) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function percentage(part, total) {
  return total > 0 ? round((part / total) * 100, 1) : 0;
}

function performanceScopeQuery(req) {
  const query = { organizationId: req.organizationId };
  const employeeIds = allowedEmployeeIds(req);
  if (employeeIds) query['employee.userId'] = { $in: employeeIds };
  return query;
}

// Canonical performance intelligence for HR and managers. Every metric comes
// from Appraisal/AppraisalCycle snapshots; no legacy review records are read.
router.get('/performance', requireManager, async (req, res) => {
  try {
    const scopeQuery = performanceScopeQuery(req);
    const query = { ...scopeQuery };
    const cycleId = String(req.query.cycleId || '').trim();
    const teamId = String(req.query.teamId || '').trim();
    const department = String(req.query.department || '').trim();

    if (cycleId) {
      if (!/^[a-f\d]{24}$/i.test(cycleId)) return res.status(400).json({ success: false, error: 'Cycle ID is invalid' });
      query.cycleId = cycleId;
    }
    if (teamId) {
      if (!canViewTeam(req, teamId)) {
        return res.status(403).json({ success: false, error: 'You cannot view analytics for this team' });
      }
      query['employee.teamId'] = teamId;
    }
    if (department) query['employee.department'] = department;

    const [appraisals, scopeAppraisals] = await Promise.all([
      Appraisal.find(query)
        .select('cycleId status employee selfAssessment.submittedAt selfAssessment.overallSelfRating managerReview.submittedAt managerReview.overallManagerRating finalRating goalEvidenceSummary customResponses cycleConfigurationSnapshot flags createdAt updatedAt')
        .lean(),
      Appraisal.find(scopeQuery).select('cycleId employee').lean()
    ]);
    const cycleIds = Array.from(new Set(scopeAppraisals.map((item) => String(item.cycleId)).filter(Boolean)));
    const cycles = cycleIds.length > 0
      ? await AppraisalCycle.find({ organizationId: req.organizationId, _id: { $in: cycleIds } })
        .select('_id name periodStart periodEnd status currentPhase').sort({ periodEnd: -1 }).lean()
      : [];
    const cycleMap = new Map(cycles.map((cycle) => [String(cycle._id), cycle]));

    const completedStatuses = new Set(['completed', 'employee_acknowledged']);
    const finalized = appraisals.filter((item) => (
      completedStatuses.has(item.status) && Number.isFinite(Number(item.finalRating?.overall))
    ));
    const completed = appraisals.filter((item) => completedStatuses.has(item.status));
    const selfSubmitted = appraisals.filter((item) => item.selfAssessment?.submittedAt).length;
    const managerSubmitted = appraisals.filter((item) => item.managerReview?.submittedAt).length;
    const overrides = finalized.filter((item) => item.finalRating?.override?.applied === true).length;
    const highRatingGaps = appraisals.filter((item) => {
      const self = Number(item.selfAssessment?.overallSelfRating);
      const manager = Number(item.managerReview?.overallManagerRating);
      return Number.isFinite(self) && Number.isFinite(manager) && Math.abs(self - manager) >= 2;
    }).length;

    const distribution = [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 0 }));
    for (const appraisal of finalized) {
      const bucket = Math.max(1, Math.min(5, Math.round(Number(appraisal.finalRating.overall))));
      distribution[bucket - 1].count += 1;
    }

    const topPerformers = finalized
      .sort((left, right) => (
        Number(right.finalRating.overall) - Number(left.finalRating.overall) ||
        Number(right.goalEvidenceSummary?.score ?? -1) - Number(left.goalEvidenceSummary?.score ?? -1) ||
        String(left.employee?.name || '').localeCompare(String(right.employee?.name || ''))
      ))
      .slice(0, 25)
      .map((item, index) => ({
        rank: index + 1,
        appraisalId: String(item._id),
        employeeId: item.employee?.userId,
        employeeName: item.employee?.name,
        jobTitle: item.employee?.jobTitle,
        department: item.employee?.department || 'Unassigned',
        teamId: item.employee?.teamId || '',
        teamName: item.employee?.teamName || 'Unassigned',
        cycleId: String(item.cycleId),
        cycleName: cycleMap.get(String(item.cycleId))?.name || 'Performance review',
        finalRating: round(item.finalRating?.overall, 2),
        ratingLabel: item.finalRating?.ratingLabel || '',
        goalAchievement: round(item.goalEvidenceSummary?.score, 1)
      }));

    const groupRows = (keySelector, labelSelector, records = appraisals) => {
      const groups = new Map();
      for (const appraisal of records) {
        const key = keySelector(appraisal) || 'unassigned';
        const current = groups.get(key) || { id: key, name: labelSelector(appraisal) || 'Unassigned', total: 0, completed: 0, ratings: [], goalScores: [] };
        current.total += 1;
        if (completedStatuses.has(appraisal.status)) current.completed += 1;
        const rating = Number(appraisal.finalRating?.overall);
        if (Number.isFinite(rating)) current.ratings.push(rating);
        const goalScore = Number(appraisal.goalEvidenceSummary?.score);
        if (appraisal.goalEvidenceSummary?.rated && Number.isFinite(goalScore)) current.goalScores.push(goalScore);
        groups.set(key, current);
      }
      return Array.from(groups.values()).map((group) => ({
        id: group.id,
        name: group.name,
        participants: group.total,
        completed: group.completed,
        completionRate: percentage(group.completed, group.total),
        rated: group.ratings.length,
        averageRating: group.ratings.length ? round(group.ratings.reduce((sum, value) => sum + value, 0) / group.ratings.length, 2) : null,
        averageGoalAchievement: group.goalScores.length ? round(group.goalScores.reduce((sum, value) => sum + value, 0) / group.goalScores.length, 1) : null
      })).sort((left, right) => right.participants - left.participants || left.name.localeCompare(right.name));
    };

    const teams = groupRows((item) => item.employee?.teamId, (item) => item.employee?.teamName);
    const departments = groupRows((item) => item.employee?.department, (item) => item.employee?.department);

    const sectionMap = new Map();
    for (const appraisal of appraisals) {
      const definitions = appraisal.cycleConfigurationSnapshot?.workflowDefinition?.sections || [];
      for (const section of definitions) {
        if (['goals', 'competencies'].includes(section.type)) continue;
        const key = section.id;
        const bucket = sectionMap.get(key) || {
          sectionId: key,
          title: section.title,
          type: section.type,
          eligible: 0,
          responded: 0,
          scores: []
        };
        bucket.eligible += 1;
        const responses = (appraisal.customResponses || []).filter((response) => response.sectionId === key);
        if (responses.some((response) => response.value !== null && response.value !== undefined && String(response.value).trim() !== '')) {
          bucket.responded += 1;
        }
        responses.filter((response) => response.respondentRole === 'manager' && Number.isFinite(Number(response.score)))
          .forEach((response) => bucket.scores.push(Number(response.score)));
        sectionMap.set(key, bucket);
      }
    }
    const sectionInsights = Array.from(sectionMap.values()).map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      type: section.type,
      responseRate: percentage(section.responded, section.eligible),
      averageManagerScore: section.scores.length
        ? round(section.scores.reduce((sum, value) => sum + value, 0) / section.scores.length, 2)
        : null
    }));

    const trends = cycles.slice().reverse().map((cycle) => {
      const records = appraisals.filter((item) => String(item.cycleId) === String(cycle._id));
      const ratings = records.map((item) => Number(item.finalRating?.overall)).filter(Number.isFinite);
      const done = records.filter((item) => completedStatuses.has(item.status)).length;
      return {
        cycleId: String(cycle._id),
        cycleName: cycle.name,
        periodEnd: cycle.periodEnd,
        participants: records.length,
        completionRate: percentage(done, records.length),
        averageRating: ratings.length ? round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length, 2) : null
      };
    });

    const finalRatings = finalized.map((item) => Number(item.finalRating.overall));
    return res.json({
      success: true,
      data: {
        scope: { organization: isHr(req), teamId: teamId || null, department: department || null },
        filters: {
          cycles: cycles.map((cycle) => ({ id: String(cycle._id), name: cycle.name, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, status: cycle.status })),
          teams: groupRows((item) => item.employee?.teamId, (item) => item.employee?.teamName, scopeAppraisals).map(({ id, name }) => ({ id, name })),
          departments: Array.from(new Set(scopeAppraisals.map((item) => item.employee?.department).filter(Boolean))).sort()
        },
        summary: {
          participants: appraisals.length,
          completed: completed.length,
          completionRate: percentage(completed.length, appraisals.length),
          selfAssessmentRate: percentage(selfSubmitted, appraisals.length),
          managerReviewRate: percentage(managerSubmitted, appraisals.length),
          rated: finalized.length,
          averageRating: finalRatings.length ? round(finalRatings.reduce((sum, value) => sum + value, 0) / finalRatings.length, 2) : null,
          overrideRate: percentage(overrides, finalized.length),
          highRatingGaps
        },
        distribution,
        topPerformers,
        teams,
        departments,
        sectionInsights,
        trends,
        definitions: {
          topPerformers: 'Completed canonical appraisals ranked by final rating, then goal achievement. Ties remain visible and no AI score is used.',
          completionRate: 'Completed or employee-acknowledged appraisals divided by all appraisals in the selected scope.',
          averageRating: 'Mean finalized rating. Draft manager and self-ratings are excluded.',
          responseRate: 'Appraisals with at least one response in the configured section divided by eligible appraisals.'
        },
        refreshedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Performance analytics error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load performance analytics' });
  }
});

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
