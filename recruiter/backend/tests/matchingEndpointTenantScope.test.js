const assert = require('node:assert/strict');
const test = require('node:test');

const Job = require('../models/Job');
const aiMatchCacheService = require('../services/aiMatchCacheService');
const aiController = require('../controllers/aiController');
const jobController = require('../controllers/jobController');
const AiJobService = require('../services/aiJobService');
const embeddingService = require('../services/embeddingService');

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

test('matching endpoint dispatches explicit quick and deep modes without crossing tenants', async () => {
  const originalFindOne = Job.findOne;
  const originalQuick = embeddingService.findMatchingCandidatesForJob;
  const originalDeep = embeddingService.findMatchingCandidatesWithExplanation;
  const calls = [];
  try {
    Job.findOne = async (query) => {
      assert.deepEqual(query, { _id: 'job-a', organization: 'org-a' });
      return { _id: 'job-a', title: 'Platform Engineer', organization: 'org-a', isEmbedded: true };
    };
    embeddingService.findMatchingCandidatesForJob = async (_job, topK) => {
      calls.push(['quick', topK]);
      return {
        matches: [{ candidateId: 'candidate-a', similarity: 0.8, relevanceScore: 0.87 }],
        fromCache: false
      };
    };
    embeddingService.findMatchingCandidatesWithExplanation = async (_job, topK) => {
      calls.push(['deep', topK]);
      return {
        matches: [{ candidateId: 'candidate-b', similarity: 0.78, relevanceScore: 0.92, explanation: 'Evidence-backed fit.' }],
        fromCache: true
      };
    };

    const quickResponse = responseRecorder();
    await jobController.getMatchingCandidates({
      params: { id: 'job-a' },
      query: { topK: '25', analysisMode: 'quick' },
      user: { currentOrganization: 'org-a' }
    }, quickResponse);
    assert.equal(quickResponse.statusCode, 200);
    assert.equal(quickResponse.body.mode, 'quick-ranking');
    assert.equal(quickResponse.body.explanationsIncluded, false);
    assert.equal(quickResponse.body.matches[0].similarityPercentage, 87);

    const deepResponse = responseRecorder();
    await jobController.getMatchingCandidates({
      params: { id: 'job-a' },
      query: { topK: '10', analysisMode: 'deep' },
      user: { currentOrganization: 'org-a' }
    }, deepResponse);
    assert.equal(deepResponse.statusCode, 200);
    assert.equal(deepResponse.body.mode, 'deep-analysis');
    assert.equal(deepResponse.body.explanationsIncluded, true);
    assert.deepEqual(calls, [['quick', 25], ['deep', 10]]);
  } finally {
    Job.findOne = originalFindOne;
    embeddingService.findMatchingCandidatesForJob = originalQuick;
    embeddingService.findMatchingCandidatesWithExplanation = originalDeep;
  }
});

test('matching endpoint validates analysis mode and bounds deep analysis', async () => {
  const invalidModeResponse = responseRecorder();
  await jobController.getMatchingCandidates({
    params: { id: 'job-a' },
    query: { analysisMode: 'turbo' },
    user: { currentOrganization: 'org-a' }
  }, invalidModeResponse);
  assert.equal(invalidModeResponse.statusCode, 400);
  assert.equal(invalidModeResponse.body.code, 'INVALID_MATCHING_MODE');

  const oversizedDeepResponse = responseRecorder();
  await jobController.getMatchingCandidates({
    params: { id: 'job-a' },
    query: { analysisMode: 'deep', topK: '101' },
    user: { currentOrganization: 'org-a' }
  }, oversizedDeepResponse);
  assert.equal(oversizedDeepResponse.statusCode, 400);
  assert.equal(oversizedDeepResponse.body.code, 'DEEP_MATCHING_LIMIT');
});
