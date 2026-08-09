const OKR = require('../models/OKR');

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateKeyResultAchievement(keyResult = {}) {
  const metricType = keyResult.metricType || keyResult.type || 'percentage';
  const current = keyResult.currentValue ?? keyResult.value ?? null;

  if (current === null || current === undefined || current === '') {
    return { rated: false, score: null, reason: 'Progress has not been reported' };
  }

  if (metricType === 'boolean') {
    const achieved = current === true || current === 1 || current === 'true';
    return { rated: true, score: achieved ? 100 : 0, reason: null };
  }

  if (metricType === 'milestone') {
    const milestoneScore = numeric(keyResult.completionPercentage ?? current);
    return milestoneScore === null
      ? { rated: false, score: null, reason: 'Milestone progress has not been reported' }
      : { rated: true, score: clamp(milestoneScore), reason: null };
  }

  const start = numeric(keyResult.startValue) ?? 0;
  const target = numeric(keyResult.targetValue);
  const currentNumber = numeric(current);
  if (target === null || currentNumber === null || target === start) {
    return { rated: false, score: null, reason: 'A valid start and target are required' };
  }

  const score = target > start
    ? ((currentNumber - start) / (target - start)) * 100
    : ((start - currentNumber) / (start - target)) * 100;

  return { rated: true, score: clamp(score), reason: null };
}

function weightedAverage(items, scoreSelector) {
  const rated = items.filter((item) => scoreSelector(item)?.rated);
  if (rated.length === 0) return { rated: false, score: null };

  const explicitWeights = rated.map((item) => numeric(item.weight)).filter((weight) => weight !== null && weight > 0);
  const useExplicitWeights = explicitWeights.length === rated.length && explicitWeights.reduce((sum, weight) => sum + weight, 0) > 0;
  const denominator = useExplicitWeights
    ? explicitWeights.reduce((sum, weight) => sum + weight, 0)
    : rated.length;
  const total = rated.reduce((sum, item) => {
    const weight = useExplicitWeights ? Number(item.weight) : 1;
    return sum + (scoreSelector(item).score * weight);
  }, 0);

  return { rated: true, score: clamp(total / denominator) };
}

function calculateGoalAchievement(goal = {}, checkIn = null) {
  const goalObject = typeof goal.toObject === 'function' ? goal.toObject() : goal;
  const checkInObjectives = checkIn?.objectives || checkIn?.progress?.objectives;
  const checkInUpdates = Array.isArray(checkIn?.keyResultUpdates) ? checkIn.keyResultUpdates : [];
  const objectives = (goalObject.objectives || []).map((objective, objectiveIndex) => {
    const checkInObjective = checkInObjectives?.[objectiveIndex];
    const keyResults = (objective.keyResults || []).map((keyResult, keyResultIndex) => {
      const indexedUpdate = checkInUpdates.find((update) =>
        Number(update.objectiveIndex) === objectiveIndex && Number(update.keyResultIndex) === keyResultIndex
      );
      const progressValue = indexedUpdate?.currentValue ?? checkInObjective?.keyResults?.[keyResultIndex]?.currentValue;
      const merged = progressValue === undefined ? keyResult : { ...keyResult, currentValue: progressValue };
      return { ...merged, achievement: calculateKeyResultAchievement(merged) };
    });
    const achievement = weightedAverage(keyResults, (item) => item.achievement);
    return { ...objective, keyResults, achievement };
  });

  const achievement = weightedAverage(objectives, (item) => item.achievement);
  return {
    rated: achievement.rated,
    score: achievement.rated ? Math.round(achievement.score * 100) / 100 : null,
    reason: achievement.rated ? null : 'No reportable goal progress was available at the cutoff'
  };
}

function parseLegacyPeriod(period) {
  const value = String(period || '').trim();
  const quarterMatch = /^Q([1-4])\s+(\d{4})$/i.exec(value);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const year = Number(quarterMatch[2]);
    return {
      label: value,
      startDate: new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
      endDate: new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999))
    };
  }

  const annualMatch = /^(?:FY\s*)?(\d{4})$/i.exec(value);
  if (annualMatch) {
    const year = Number(annualMatch[1]);
    return {
      label: value,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
    };
  }

  return null;
}

function resolveGoalPeriod(goal, periodsById = new Map()) {
  const snapshot = goal.periodSnapshot || goal.goalPeriod || {};
  const linkedPeriod = goal.periodId ? periodsById.get(String(goal.periodId)) : null;
  const source = linkedPeriod || snapshot;
  const startDate = source?.startDate ? new Date(source.startDate) : null;
  const endDate = source?.endDate ? new Date(source.endDate) : null;
  if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
    return {
      id: goal.periodId ? String(goal.periodId) : source?._id ? String(source._id) : null,
      label: source.label || source.name || goal.period || 'Custom period',
      startDate,
      endDate
    };
  }
  return parseLegacyPeriod(goal.period);
}

function overlaps(period, startDate, endDate) {
  return Boolean(period?.startDate && period?.endDate && period.startDate <= endDate && period.endDate >= startDate);
}

function isEligibleGoal(goal) {
  const scope = goal.scope || goal.type || 'individual';
  if (scope !== 'individual') return false;

  const lifecycle = goal.lifecycle?.state || goal.lifecycle || goal.status || 'active';
  if (!['active', 'completed', 'closed'].includes(lifecycle)) return false;

  const approvalStatus = goal.approval?.status || goal.approvalStatus || 'approved';
  if (approvalStatus !== 'approved') return false;

  const acknowledgement = goal.acknowledgement || goal.acknowledgment;
  const assignmentAcknowledgement = goal.assignment?.acknowledgementStatus;
  if (acknowledgement?.required === true && !['acknowledged', 'accepted', 'resolved'].includes(acknowledgement.status)) return false;
  if (assignmentAcknowledgement && !['not_required', 'acknowledged'].includes(assignmentAcknowledgement)) return false;

  if (goal.scoringEligibility?.mode === 'evidence_only' || goal.scoringEligibility === 'evidence_only' || goal.evidenceOnly === true) return false;
  return true;
}

async function loadPeriods(goalObjects) {
  const periodIds = [...new Set(goalObjects.map((goal) => goal.periodId).filter(Boolean).map(String))];
  if (periodIds.length === 0) return new Map();

  try {
    const GoalPeriod = require('../models/GoalPeriod');
    const periods = await GoalPeriod.find({ _id: { $in: periodIds } }).lean();
    return new Map(periods.map((period) => [String(period._id), period]));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.warn('Unable to load goal periods for appraisal snapshots:', error.message);
    }
    return new Map();
  }
}

async function loadLatestCheckIns(goalIds, organizationId, cutoffAt) {
  if (goalIds.length === 0) return new Map();
  try {
    const GoalCheckIn = require('../models/GoalCheckIn');
    const checkIns = await GoalCheckIn.find({
      organizationId: String(organizationId),
      goalId: { $in: goalIds },
      createdAt: { $lte: cutoffAt }
    }).sort({ createdAt: -1 }).lean();
    const latest = new Map();
    checkIns.forEach((checkIn) => {
      const key = String(checkIn.goalId);
      if (!latest.has(key)) latest.set(key, checkIn);
    });
    return latest;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.warn('Unable to load goal check-ins for appraisal snapshots:', error.message);
    }
    return new Map();
  }
}

async function buildGoalSnapshots({ organizationId, employeeId, cycle }) {
  const periodStart = new Date(cycle.periodStart);
  const periodEnd = new Date(cycle.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error('The appraisal cycle requires a valid evaluation period before goals can be snapshotted');
  }

  const goals = await OKR.find({
    organizationId: String(organizationId),
    ownerId: String(employeeId)
  }).lean();
  const periodsById = await loadPeriods(goals);
  const eligible = goals
    .map((goal) => ({ goal, period: resolveGoalPeriod(goal, periodsById) }))
    .filter(({ goal, period }) => isEligibleGoal(goal) && overlaps(period, periodStart, periodEnd));
  const checkIns = await loadLatestCheckIns(eligible.map(({ goal }) => goal._id), organizationId, periodEnd);

  const snapshots = eligible.map(({ goal, period }) => {
    const checkIn = checkIns.get(String(goal._id)) || null;
    const achievement = calculateGoalAchievement(goal, checkIn);
    return {
      sourceGoalId: goal._id,
      sourceVersion: goal.version || 1,
      legacySnapshot: goal.creationSource === 'legacy' || !goal.periodId,
      period,
      scope: goal.scope || goal.type || 'individual',
      ownerId: String(goal.ownerId),
      source: goal.creationSource || goal.source || 'legacy',
      createdBy: goal.createdBy || null,
      assignedBy: goal.assignment?.assignedBy || goal.assignedBy || null,
      alignment: goal.alignment || null,
      definition: {
        title: goal.title || goal.objectives?.[0]?.title || 'Untitled goal',
        objectives: goal.objectives || []
      },
      finalCheckIn: checkIn,
      achievement,
      evidence: checkIn?.evidence || checkIn?.evidenceRefs || [],
      capturedAt: new Date(),
      cutoffAt: periodEnd
    };
  });

  const rated = snapshots.filter((snapshot) => snapshot.achievement?.rated);
  const score = rated.length
    ? Math.round((rated.reduce((sum, snapshot) => sum + snapshot.achievement.score, 0) / rated.length) * 100) / 100
    : null;

  return {
    goalIds: snapshots.map((snapshot) => snapshot.sourceGoalId),
    snapshots,
    evidenceSummary: {
      rated: rated.length > 0,
      score,
      ratedGoals: rated.length,
      totalGoals: snapshots.length,
      okrWeight: Number(cycle.okrWeight ?? 40),
      capturedAt: new Date(),
      cutoffAt: periodEnd,
      unavailableReason: rated.length ? null : 'No eligible goals had reportable progress at the evaluation cutoff'
    }
  };
}

module.exports = {
  buildGoalSnapshots,
  calculateGoalAchievement,
  calculateKeyResultAchievement,
  parseLegacyPeriod
};
