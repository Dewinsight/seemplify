const assert = require('node:assert/strict');
const test = require('node:test');

const Job = require('../models/Job');
const aiMatchCacheService = require('../services/aiMatchCacheService');
const aiController = require('../controllers/aiController');
const jobController = require('../controllers/jobController');
const AiJobService = require('../services/aiJobService');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('matching report endpoint looks up the job inside the active organization', async () => {
  const originalFindOne = Job.findOne;
  let capturedQuery;
  try {
    Job.findOne = async (query) => {
      capturedQuery = query;
      return null;
    };
    const res = responseRecorder();
    await aiController.getMatchingReport({
      params: { jobId: 'job-other' },
      query: {},
      user: { currentOrganization: 'org-a' }
    }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(capturedQuery, { _id: 'job-other', organization: 'org-a' });
  } finally {
    Job.findOne = originalFindOne;
  }
});

test('cache invalidation and statistics endpoints reject jobs outside the active organization', async () => {
  const originalFindOne = Job.findOne;
  const originalInvalidate = aiMatchCacheService.invalidateJobCache;
  const originalStats = aiMatchCacheService.getCacheStats;
  const lookups = [];
  let cacheCalled = false;
  try {
    Job.findOne = (query) => {
      lookups.push(query);
      return { select: async () => null };
    };
    aiMatchCacheService.invalidateJobCache = async () => {
      cacheCalled = true;
      return { deletedCount: 1 };
    };
    aiMatchCacheService.getCacheStats = async () => {
      cacheCalled = true;
      return {};
    };

    const req = { params: { jobId: 'job-other' }, user: { currentOrganization: 'org-a' } };
    const invalidateResponse = responseRecorder();
    await jobController.invalidateAICache(req, invalidateResponse);
    const statsResponse = responseRecorder();
    await jobController.getAICacheStats(req, statsResponse);

    assert.equal(invalidateResponse.statusCode, 404);
    assert.equal(statsResponse.statusCode, 404);
    assert.equal(cacheCalled, false);
    assert.deepEqual(lookups, [
      { _id: 'job-other', organization: 'org-a' },
      { _id: 'job-other', organization: 'org-a' }
    ]);
  } finally {
    Job.findOne = originalFindOne;
    aiMatchCacheService.invalidateJobCache = originalInvalidate;
    aiMatchCacheService.getCacheStats = originalStats;
  }
});

test('assistant matching service cannot load a job without tenant scope', async () => {
  const originalFindOne = Job.findOne;
  let capturedQuery;
  try {
    Job.findOne = async (query) => {
      capturedQuery = query;
      return null;
    };
    const service = new AiJobService();
    await assert.rejects(
      () => service.getMatchingCandidatesForJob('job-other', 10, 'org-a'),
      /Job not found/
    );
    assert.deepEqual(capturedQuery, { _id: 'job-other', organization: 'org-a' });
    await assert.rejects(
      () => service.getMatchingCandidatesForJob('job-other', 10),
      /Organization context is required/
    );
  } finally {
    Job.findOne = originalFindOne;
  }
});
