const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeActivityPath,
  getActivityModule,
  getActivityAction,
  getActivityCategory,
  shouldRecordReadActivity
} = require('../services/userActivityTrackingService');

test('normalizes identifiers and removes query values from tracked paths', () => {
  assert.equal(
    normalizeActivityPath('/api/candidates/507f1f77bcf86cd799439011?include=cv&token=secret'),
    '/api/candidates/:id'
  );
  assert.equal(
    normalizeActivityPath('/api/interviews/550e8400-e29b-41d4-a716-446655440000/comments/42'),
    '/api/interviews/:id/comments/:id'
  );
});

test('classifies product modules and actions', () => {
  assert.equal(getActivityModule('/api/ai-interviews/507f1f77bcf86cd799439011'), 'ai-interviews');
  assert.equal(getActivityModule('/api/candidate-emails/templates'), 'candidates');
  assert.equal(getActivityModule('/api/people-transitions/123'), 'people-transitions');
  assert.equal(getActivityAction('POST', '/api/interviews/from-pipeline'), 'scheduled');
  assert.equal(getActivityAction('DELETE', '/api/jobs/123'), 'deleted');
  assert.equal(getActivityCategory('GET'), 'navigation');
  assert.equal(getActivityCategory('PATCH'), 'action');
});

test('rate limits repeated read activity without suppressing later reads', () => {
  const key = `test-user:test-route:${Date.now()}`;
  const now = Date.now();
  assert.equal(shouldRecordReadActivity(key, now), true);
  assert.equal(shouldRecordReadActivity(key, now + 1000), false);
  assert.equal(shouldRecordReadActivity(key, now + (5 * 60 * 1000)), true);
});
