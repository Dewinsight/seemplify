const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeActivityRange,
  getActivityRangeStart,
  normalizePagination,
  escapeRegex,
  calculateRate,
  maxDate,
  mergeActivityTrendRows
} = require('../services/adminOrganizationActivityService');

test('normalizes activity ranges and calculates inclusive UTC starts', () => {
  const now = new Date('2026-07-21T17:00:00.000Z');
  assert.equal(normalizeActivityRange('7d'), '7d');
  assert.equal(normalizeActivityRange('all'), 'all');
  assert.equal(normalizeActivityRange('unexpected'), '30d');
  assert.equal(getActivityRangeStart('7d', now).toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(getActivityRangeStart('all', now), null);
});

test('clamps pagination and escapes search input', () => {
  assert.deepEqual(normalizePagination('-2', '500'), { page: 1, limit: 100 });
  assert.deepEqual(normalizePagination('3', '2'), { page: 3, limit: 10 });
  assert.equal(escapeRegex('Acme (UK).*'), 'Acme \\(UK\\)\\.\\*');
});

test('calculates rates and latest activity dates', () => {
  assert.equal(calculateRate(7, 16), 43.8);
  assert.equal(calculateRate(0, 0), 0);
  assert.equal(
    maxDate('2026-07-19T10:00:00.000Z', '2026-07-21T09:00:00.000Z').toISOString(),
    '2026-07-21T09:00:00.000Z'
  );
});

test('merges platform and business activity into ordered daily points', () => {
  const result = mergeActivityTrendRows({
    activity: [{
      _id: '2026-07-20',
      requests: 8,
      actions: 2,
      failures: 1,
      users: ['u1', 'u2'],
      organizations: ['o1']
    }],
    logins: [{ _id: '2026-07-20', count: 2, users: ['u1'], organizations: ['o1'] }],
    jobs: [{ _id: '2026-07-21', count: 3, users: ['u3'], organizations: ['o2'] }],
    candidates: [],
    interviews: [],
    aiInterviews: [],
    transitions: []
  }, '7d', new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-21T12:00:00.000Z'));

  assert.deepEqual(result, [
    {
      date: '2026-07-20', activeUsers: 2, activeOrganizations: 1,
      requests: 8, actions: 2, failures: 1, logins: 2,
      jobs: 0, candidates: 0, interviews: 0, aiInterviews: 0, transitions: 0
    },
    {
      date: '2026-07-21', activeUsers: 1, activeOrganizations: 1,
      requests: 0, actions: 3, failures: 0, logins: 0,
      jobs: 3, candidates: 0, interviews: 0, aiInterviews: 0, transitions: 0
    }
  ]);
});
