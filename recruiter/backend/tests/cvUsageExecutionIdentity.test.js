const assert = require('node:assert/strict');
const test = require('node:test');

const cvQueue = require('../services/cvAnalysisQueueService');

test('manual CV retries advance the gateway receipt without changing transport replay identity', () => {
  const job = { publicId: 'cv_identity_test', retry: { manualRequests: 0 } };
  assert.equal(cvQueue._cvUsageExecutionIdForTests(job), 'cv-queue:cv_identity_test');
  assert.equal(cvQueue._cvUsageExecutionIdForTests(job), 'cv-queue:cv_identity_test');

  job.retry.manualRequests = 1;
  assert.equal(
    cvQueue._cvUsageExecutionIdForTests(job),
    'cv-queue:cv_identity_test:manual-retry:1'
  );
  job.retry.manualRequests = 2;
  assert.equal(
    cvQueue._cvUsageExecutionIdForTests(job),
    'cv-queue:cv_identity_test:manual-retry:2'
  );
});
