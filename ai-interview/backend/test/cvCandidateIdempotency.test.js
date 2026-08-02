const assert = require('node:assert/strict');
const test = require('node:test');

const {
  attachProcessingIdentity,
  deterministicCvCandidateId,
  hasProcessingIdentity
} = require('../src/cvCandidateIdempotency');

test('CV candidate identity is deterministic across worker processes and retries', () => {
  const first = deterministicCvCandidateId('aicv_retry_fixture');
  const second = deterministicCvCandidateId('aicv_retry_fixture');
  assert.equal(first, second);
  assert.match(first, /^cand_cv_[a-f0-9]{24}$/);
  assert.notEqual(first, deterministicCvCandidateId('aicv_other_fixture'));
});

test('candidate records retain every processing identity without duplicates', () => {
  const candidate = {};
  attachProcessingIdentity(candidate, 'aicv_first');
  attachProcessingIdentity(candidate, 'aicv_first');
  attachProcessingIdentity(candidate, 'aicv_second');
  assert.equal(candidate.cvProcessingJobId, 'aicv_first');
  assert.deepEqual(candidate.cvProcessingJobIds, ['aicv_first', 'aicv_second']);
  assert.equal(hasProcessingIdentity(candidate, 'aicv_first'), true);
  assert.equal(hasProcessingIdentity(candidate, 'aicv_second'), true);
  assert.equal(hasProcessingIdentity(candidate, 'aicv_missing'), false);
});

test('processing identities are not evicted by later CV jobs', () => {
  const candidate = {};
  for (let index = 0; index < 150; index += 1) {
    attachProcessingIdentity(candidate, `aicv_${index}`);
  }
  assert.equal(candidate.cvProcessingJobIds.length, 150);
  assert.equal(hasProcessingIdentity(candidate, 'aicv_0'), true);
  assert.equal(hasProcessingIdentity(candidate, 'aicv_149'), true);
});
