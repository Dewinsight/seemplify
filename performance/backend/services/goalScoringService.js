/**
 * Deterministic goal scoring.
 *
 * Missing current/target values are deliberately left unrated. Unrated key
 * results are excluded from weighted averages instead of being treated as
 * zero performance. The same formula supports increasing and decreasing
 * targets because the target-start range may be positive or negative.
 */

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function toNumber(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (!isPresent(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, precision = 1) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function effectiveWeight(value, fallback = 1) {
  if (!isPresent(value)) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function calculateKeyResultScore(keyResult = {}) {
  const currentValue = toNumber(keyResult.currentValue);
  const targetValue = toNumber(keyResult.targetValue);
  const startValue = toNumber(keyResult.startValue) ?? 0;

  if (currentValue === null) {
    return { status: 'unrated', progress: null, reason: 'missing_current_value' };
  }
  if (targetValue === null) {
    return { status: 'unrated', progress: null, reason: 'missing_target_value' };
  }

  if (keyResult.metricType === 'boolean') {
    return {
      status: 'rated',
      progress: currentValue === 1 ? 100 : 0,
      reason: null,
      direction: 'increase'
    };
  }

  const range = targetValue - startValue;
  if (range === 0) {
    if (currentValue === targetValue) {
      return { status: 'rated', progress: 100, reason: null };
    }
    return { status: 'unrated', progress: null, reason: 'zero_target_range' };
  }

  const progress = clamp(((currentValue - startValue) / range) * 100);
  return {
    status: 'rated',
    progress: round(progress),
    reason: null,
    direction: range < 0 ? 'decrease' : 'increase'
  };
}

function weightedAverage(entries) {
  const rated = entries.filter((entry) => entry && entry.status !== 'unrated' && Number.isFinite(entry.progress));
  if (rated.length === 0) return null;

  let weightedTotal = 0;
  let totalWeight = 0;
  for (const entry of rated) {
    const weight = effectiveWeight(entry.weight, 1);
    if (weight === 0) continue;
    weightedTotal += entry.progress * weight;
    totalWeight += weight;
  }

  // If every explicit weight is zero, fall back to an equal average rather
  // than silently reporting 0%.
  if (totalWeight === 0) {
    return rated.reduce((sum, entry) => sum + entry.progress, 0) / rated.length;
  }
  return weightedTotal / totalWeight;
}

function calculateObjectiveScore(objective = {}, objectiveIndex = 0) {
  const keyResults = Array.isArray(objective.keyResults) ? objective.keyResults : [];
  const results = keyResults.map((keyResult, keyResultIndex) => ({
    keyResultIndex,
    keyResultId: keyResult?._id ? String(keyResult._id) : null,
    weight: effectiveWeight(keyResult?.weight, 1),
    ...calculateKeyResultScore(keyResult)
  }));

  const progress = weightedAverage(results);
  const ratedKeyResults = results.filter((result) => result.status === 'rated').length;
  const totalKeyResults = results.length;

  return {
    objectiveIndex,
    objectiveId: objective?._id ? String(objective._id) : null,
    weight: effectiveWeight(objective?.weight, 1),
    status: progress === null
      ? 'unrated'
      : (ratedKeyResults === totalKeyResults ? 'rated' : 'partially_rated'),
    progress: round(progress),
    ratedKeyResults,
    totalKeyResults,
    keyResults: results
  };
}

function calculateGoalScore(goal = {}) {
  const objectives = Array.isArray(goal.objectives) ? goal.objectives : [];
  const objectiveScores = objectives.map(calculateObjectiveScore);
  const progress = weightedAverage(objectiveScores);
  const totalKeyResults = objectiveScores.reduce((sum, objective) => sum + objective.totalKeyResults, 0);
  const ratedKeyResults = objectiveScores.reduce((sum, objective) => sum + objective.ratedKeyResults, 0);

  return {
    status: progress === null
      ? 'unrated'
      : (ratedKeyResults === totalKeyResults ? 'rated' : 'partially_rated'),
    progress: round(progress),
    ratedKeyResults,
    unratedKeyResults: Math.max(0, totalKeyResults - ratedKeyResults),
    totalKeyResults,
    objectives: objectiveScores,
    calculatedAt: new Date()
  };
}

function applyGoalScore(goal) {
  const score = calculateGoalScore(goal);
  goal.progress = score.progress;
  goal.scoring = {
    status: score.status,
    progress: score.progress,
    ratedKeyResults: score.ratedKeyResults,
    unratedKeyResults: score.unratedKeyResults,
    totalKeyResults: score.totalKeyResults,
    calculatedAt: score.calculatedAt
  };
  return score;
}

module.exports = {
  applyGoalScore,
  calculateGoalScore,
  calculateKeyResultScore,
  calculateObjectiveScore,
  clamp,
  effectiveWeight,
  isPresent,
  round,
  toNumber,
  weightedAverage
};
