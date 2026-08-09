const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateGoalScore,
  calculateKeyResultScore
} = require('../services/goalScoringService');

test('scores increasing targets from the configured start value', () => {
  assert.deepEqual(
    calculateKeyResultScore({ startValue: 20, targetValue: 100, currentValue: 60 }),
    { status: 'rated', progress: 50, reason: null, direction: 'increase' }
  );
});

test('scores decreasing targets without reversing achievement', () => {
  assert.deepEqual(
    calculateKeyResultScore({ startValue: 10, targetValue: 0, currentValue: 5 }),
    { status: 'rated', progress: 50, reason: null, direction: 'decrease' }
  );
});

test('keeps missing measurements unrated instead of treating them as zero', () => {
  assert.deepEqual(
    calculateKeyResultScore({ startValue: 0, targetValue: 100 }),
    { status: 'unrated', progress: null, reason: 'missing_current_value' }
  );
});

test('scores boolean measurements as complete or incomplete', () => {
  assert.equal(calculateKeyResultScore({ metricType: 'boolean', targetValue: 1, currentValue: true }).progress, 100);
  assert.equal(calculateKeyResultScore({ metricType: 'boolean', targetValue: 1, currentValue: false }).progress, 0);
});

test('uses key-result and objective weights', () => {
  const score = calculateGoalScore({
    objectives: [
      {
        weight: 3,
        keyResults: [
          { startValue: 0, targetValue: 100, currentValue: 100, weight: 3 },
          { startValue: 0, targetValue: 100, currentValue: 0, weight: 1 }
        ]
      },
      {
        weight: 1,
        keyResults: [{ startValue: 0, targetValue: 100, currentValue: 0 }]
      }
    ]
  });

  assert.equal(score.status, 'rated');
  assert.equal(score.progress, 56.3);
});

test('excludes missing measurements from the average and reports partial coverage', () => {
  const score = calculateGoalScore({
    objectives: [{
      keyResults: [
        { startValue: 0, targetValue: 100, currentValue: 100, weight: 1 },
        { startValue: 0, targetValue: 100, weight: 99 }
      ]
    }]
  });

  assert.equal(score.status, 'partially_rated');
  assert.equal(score.progress, 100);
  assert.equal(score.ratedKeyResults, 1);
  assert.equal(score.unratedKeyResults, 1);
});

test('treats an entirely unmeasured goal as unrated', () => {
  const score = calculateGoalScore({ objectives: [{ keyResults: [] }] });

  assert.equal(score.status, 'unrated');
  assert.equal(score.progress, null);
  assert.equal(score.totalKeyResults, 0);
});
