const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAnalyticsRange,
  getAnalyticsRangeStart,
  escapeRegex,
  normalizePagination,
  calculateRate,
  mergeTrendRows,
  formatSessionTotals
} = require('../services/adminAIInterviewAnalyticsService');

test('normalizes analytics ranges and calculates inclusive UTC starts', () => {
  const now = new Date('2026-07-21T17:00:00.000Z');

  assert.equal(normalizeAnalyticsRange('7d'), '7d');
  assert.equal(normalizeAnalyticsRange('all'), 'all');
  assert.equal(normalizeAnalyticsRange('unexpected'), '30d');
  assert.equal(getAnalyticsRangeStart('7d', now).toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(getAnalyticsRangeStart('all', now), null);
});

test('escapes search input and clamps pagination', () => {
  assert.equal(escapeRegex('Acme (UK).*'), 'Acme \\(UK\\)\\.\\*');
  assert.deepEqual(normalizePagination('-4', '500'), { page: 1, limit: 100 });
  assert.deepEqual(normalizePagination('3', '2'), { page: 3, limit: 10 });
});

test('merges interview and candidate activity into ordered trend points', () => {
  const result = mergeTrendRows(
    [{ _id: '2026-07-20', count: 2 }],
    [{ _id: '2026-07-19', count: 4 }, { _id: '2026-07-20', count: 3 }],
    [{ _id: '2026-07-20', count: 1 }]
  );

  assert.deepEqual(result, [
    { date: '2026-07-19', interviews: 0, candidates: 4, completed: 0 },
    { date: '2026-07-20', interviews: 2, candidates: 3, completed: 1 }
  ]);
});

test('formats session totals with rates, score, duration and credit values', () => {
  const result = formatSessionTotals({
    sessions: 8,
    completed: 5,
    active: 1,
    awaiting: 1,
    failed: 1,
    averageScore: 78.26,
    averageDurationMs: 1_530_000,
    creditsCharged: 39.75,
    creditsRefunded: 8,
    proctorFailures: 1,
    emailFailures: 0
  });

  assert.equal(calculateRate(5, 8), 62.5);
  assert.deepEqual(result, {
    sessions: 8,
    completed: 5,
    active: 1,
    awaiting: 1,
    failed: 1,
    completionRate: 62.5,
    averageScore: 78.3,
    averageDurationMinutes: 25.5,
    creditsCharged: 39.8,
    creditsRefunded: 8,
    proctorFailures: 1,
    emailFailures: 0
  });
});
