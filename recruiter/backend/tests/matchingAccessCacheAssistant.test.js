const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AIMatchCacheService,
  CACHE_SENTINELS,
  cacheIdentityMatches,
  canServeTopK,
  normalizeTopK,
  sliceBulkPayload
} = require('../services/aiMatchCacheService');
const {
  GPTAnalysisCache
} = require('../services/gptAnalysisService');
const {
  MatchingEnrichmentInputService,
  selectAuthoritativeMatches,
  uniqueSubmittedCandidateIds
} = require('../services/matchingEnrichmentInputService');
const JobAgent = require('../agents/jobAgent');
const embeddingService = require('../services/embeddingService');
const gptAnalysisService = require('../services/gptAnalysisService');
const rankingService = require('../services/rankingService');

function queryResult(value) {
  return {
    sort() { return this; },
    select() { return this; },
    lean: async () => value
  };
}

test('bulk cache identity is topK-aware and slices larger cached sets', () => {
  const cache = {
    matchData: Array.from({ length: 10 }, (_, index) => ({ candidateId: `c-${index}` })),
    metadata: { requestedTopK: 10, exhausted: false }
  };
  assert.equal(normalizeTopK(-20), 1);
  assert.equal(normalizeTopK(99999), 5000);
  assert.equal(canServeTopK(cache, 5), true);
  assert.equal(canServeTopK(cache, 25), false);
  assert.equal(sliceBulkPayload(cache.matchData, 5).length, 5);
  assert.equal(cacheIdentityMatches(
    { cacheIdentity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' } },
    { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' }
  ), true);
  assert.equal(cacheIdentityMatches(
    { cacheIdentity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' } },
    { provider: 'chatgpt-connect', model: 'embedding-v3', promptVersion: 'v2' }
  ), false);
});

test('bulk and report writes use different sentinels on legacy unique indexes', async () => {
  const writes = [];
  const CacheModel = {
    getDefaultTTL: () => 60_000,
    findOneAndUpdate: async (query, update) => writes.push({ query, update }),
    deleteMany: async () => ({ deletedCount: 0 })
  };
  const service = new AIMatchCacheService({ CacheModel });
  await service.setCachedBulkMatch('job-a', [{ candidateId: 'candidate-a' }], {
    topK: 1,
    identity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' }
  });
  await service.setCachedReport('job-a', { topCandidates: [{ id: 'candidate-a' }] }, {
    topK: 1,
    identity: { provider: 'chatgpt-connect', model: 'gpt-5.6', promptVersion: 'report-v2' }
  });
  assert.equal(writes[0].query.candidateId, CACHE_SENTINELS.bulk);
  assert.equal(writes[1].query.candidateId, CACHE_SENTINELS.report);
  assert.notEqual(writes[0].query.candidateId, writes[1].query.candidateId);
});

test('persistent bulk cache misses when requested topK or runtime identity is incompatible', async () => {
  const doc = {
    matchData: Array.from({ length: 10 }, (_, index) => ({ candidateId: `c-${index}` })),
    metadata: {
      requestedTopK: 10,
      exhausted: false,
      cacheIdentity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' }
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const CacheModel = { findOne: () => queryResult(doc) };
  const service = new AIMatchCacheService({ CacheModel });
  assert.equal(await service.getCachedBulkMatch('job-a', {
    topK: 20,
    identity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' }
  }), null);
  assert.equal(await service.getCachedBulkMatch('job-a', {
    topK: 5,
    identity: { provider: 'chatgpt-connect', model: 'gpt-5.6', promptVersion: 'v2' }
  }), null);
  const hit = await service.getCachedBulkMatch('job-a', {
    topK: 5,
    identity: { provider: 'weaviate', model: 'embedding-v3', promptVersion: 'v2' }
  });
  assert.equal(hit.data.length, 5);
});

test('cache age is measured from the latest refresh rather than the original insert', () => {
  const service = new AIMatchCacheService({ CacheModel: {} });
  const createdAt = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const updatedAt = new Date(Date.now() - (2 * 60 * 1000));
  const response = service._response({ createdAt, updatedAt, metadata: {} }, []);

  assert.equal(response.cacheAge, updatedAt);
  assert.ok(response.cacheAgeMinutes >= 1 && response.cacheAgeMinutes <= 2);
});

test('candidate invalidation clears single matches plus organization bulk and report caches', async () => {
  let deleteQuery;
  const CacheModel = {
    deleteMany: async (query) => {
      deleteQuery = query;
      return { deletedCount: 3 };
    }
  };
  const JobModel = { distinct: async (_field, query) => {
    assert.deepEqual(query, { organization: 'org-a' });
    return ['job-a', 'job-b'];
  } };
  const service = new AIMatchCacheService({ CacheModel, JobModel });
  const result = await service.invalidateCandidateCache('candidate-a', 'org-a');
  assert.equal(result.deletedCount, 3);
  assert.deepEqual(deleteQuery.$or[0], { candidateId: 'candidate-a' });
  assert.deepEqual(deleteQuery.$or[1].jobId.$in, ['job-a', 'job-b']);
  assert.deepEqual(deleteQuery.$or[1].cacheType.$in, ['bulk', 'report']);
});

test('LLM batch cache changes when matching inputs change', () => {
  const cache = new GPTAnalysisCache('provider:model:route:prompt');
  const baseJob = { _id: 'job-a', title: 'Engineer', skills: ['Node.js'], requirements: 'APIs' };
  const candidates = [{ _id: 'candidate-a', name: 'Alex', skills: ['Node.js'], score: 0.8 }];
  const first = cache.getBatchKey(baseJob, candidates);
  const changedJob = cache.getBatchKey({ ...baseJob, requirements: 'APIs and Kubernetes' }, candidates);
  const changedCandidate = cache.getBatchKey(baseJob, [{ ...candidates[0], score: 0.5 }]);
  assert.notEqual(first, changedJob);
  assert.notEqual(first, changedCandidate);
});

test('shortlist AI ranking derives vector scores from a generated job query embedding', async () => {
  const originalEnabled = gptAnalysisService.isEnabled;
  const originalBatch = gptAnalysisService.batchAnalyzeCandidates;
  let analyzedCandidates;
  try {
    gptAnalysisService.isEnabled = true;
    gptAnalysisService.batchAnalyzeCandidates = async (_job, candidates) => {
      analyzedCandidates = candidates;
      return candidates.map((candidate) => ({
        candidate,
        relevanceScore: candidate.score,
        gptAnalysis: {
          skillMatchPercentage: 80,
          experienceFit: 8,
          culturalAlignment: 7,
          growthPotential: 8,
          interviewFocus: [],
          confidenceScore: 8,
          explanation: 'Grounded result',
          technicalStrengths: [],
          skillGaps: []
        }
      }));
    };

    const service = Object.create(Object.getPrototypeOf(embeddingService));
    service.weaviateService = {
      batchFetchCandidates: async () => [{
        id: 'candidate-a',
        values: [1, 0],
        metadata: { firstName: 'Alex', lastName: 'A', skills: ['Node.js'] }
      }]
    };
    service.createJobEmbeddingText = () => 'authoritative job text';
    service.generateEmbedding = async (text) => {
      assert.equal(text, 'authoritative job text');
      return [1, 0];
    };
    service.parseSkills = (skills) => skills;
    service.calculateCosineSimilarity = (jobVector, candidateVector) => {
      assert.deepEqual(jobVector, [1, 0]);
      assert.deepEqual(candidateVector, [1, 0]);
      return 0.91;
    };

    const ranked = await service.rankCandidatesByIds(
      { _id: 'job-a', title: 'Engineer' },
      ['candidate-a'],
      1
    );
    assert.equal(analyzedCandidates[0].score, 0.91);
    assert.equal(ranked[0].relevanceScore, 0.91);
  } finally {
    gptAnalysisService.isEnabled = originalEnabled;
    gptAnalysisService.batchAnalyzeCandidates = originalBatch;
  }
});

test('quick matching reuses the stored job vector instead of generating it again', async () => {
  const service = Object.create(Object.getPrototypeOf(embeddingService));
  let generated = false;
  service.weaviateService = {
    getJobVector: async (jobId) => {
      assert.equal(jobId, 'job-a');
      return [0.25, 0.75];
    },
    searchSimilarCandidates: async (queryVector, organizationId, topK) => {
      assert.deepEqual(queryVector, [0.25, 0.75]);
      assert.equal(organizationId, 'org-a');
      assert.equal(topK, 10);
      return [{
        candidateId: 'candidate-a',
        organizationId: 'org-a',
        firstName: 'Alex',
        lastName: 'A',
        skills: ['Node.js'],
        totalYearsExperience: 5,
        _additional: { distance: 0.12 }
      }];
    }
  };
  service.generateEmbedding = async () => {
    generated = true;
    return [1, 0];
  };

  const matches = await service.searchSimilarCandidates('job text', 10, 'org-a', { jobId: 'job-a' });
  assert.equal(generated, false);
  assert.equal(matches[0].score, 0.88);
  assert.equal(matches[0].metadata.totalYearsExp, 5);
});

test('quick reranking keeps semantic similarity dominant while improving explicit skill fit', () => {
  const ranked = rankingService.rerankQuickCandidates([
    {
      candidateId: 'semantic-only',
      similarity: 0.91,
      metadata: { skills: ['Ruby'], totalYearsExp: 5, location: 'London' }
    },
    {
      candidateId: 'grounded-fit',
      similarity: 0.84,
      metadata: { skills: ['Node.js', 'PostgreSQL'], totalYearsExp: 5, location: 'London' }
    }
  ], {
    skills: ['Node.js', 'PostgreSQL'],
    experience: '3-5 years',
    location: 'London'
  });

  assert.equal(ranked[0].candidateId, 'grounded-fit');
  assert.equal(ranked[0].vectorSimilarity, 0.84);
  assert.equal(ranked[0].quickSignals.skillCoverage, 1);
  assert.ok(ranked[0].relevanceScore > ranked[1].relevanceScore);
});

test('enrichment treats browser matches as IDs and rebuilds fields from scoped records', () => {
  const submitted = [{
    candidateId: '507f1f77bcf86cd799439011',
    similarity: 1,
    candidate: { email: 'attacker-controlled@example.com', name: 'Injected' }
  }];
  assert.deepEqual(uniqueSubmittedCandidateIds(submitted), ['507f1f77bcf86cd799439011']);
  const selected = selectAuthoritativeMatches([
    { candidateId: '507f1f77bcf86cd799439011', similarity: 0.73 },
    { candidateId: '507f1f77bcf86cd799439012', similarity: 0.99 }
  ], [{
    _id: '507f1f77bcf86cd799439011',
    firstName: 'Authoritative',
    lastName: 'Candidate',
    email: 'server@example.com',
    skills: ['Node.js']
  }], ['507f1f77bcf86cd799439011']);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].candidate.email, 'server@example.com');
  assert.equal(selected[0].candidate.name, 'Authoritative Candidate');
  assert.equal(selected[0].similarity, 0.73);
});

test('enrichment job lookup binds the request to the active organization', async () => {
  let capturedQuery;
  const service = new MatchingEnrichmentInputService({
    JobModel: {
      findOne(query) {
        capturedQuery = query;
        return Promise.resolve(null);
      }
    }
  });
  await assert.rejects(
    () => service.getScopedJob('job-other', 'org-a'),
    (error) => error.code === 'JOB_NOT_FOUND' && error.statusCode === 404
  );
  assert.deepEqual(capturedQuery, { _id: 'job-other', organization: 'org-a' });
});

test('JobAgent unwraps cache-aware matching responses and passes organization scope', async () => {
  const calls = [];
  const agent = Object.create(JobAgent.prototype);
  agent.aiJobService = {
    getJobById: async (jobId, organizationId) => {
      calls.push(['job', jobId, organizationId]);
      return { _id: jobId, title: 'Platform Engineer', organization: organizationId };
    },
    getMatchingCandidatesForJob: async (jobId, topK, organizationId) => {
      calls.push(['matches', jobId, topK, organizationId]);
      return {
        matches: [{
          candidateId: 'candidate-a',
          similarity: 0.82,
          candidate: { name: 'Alex A', email: 'alex@example.com', skills: ['Node.js'] },
          metadata: {}
        }],
        fromCache: true,
        cacheAgeMinutes: 4
      };
    }
  };

  const result = await agent.processGetMatchingCandidates(
    'job-a',
    { topK: 5 },
    { organizationId: 'org-a' }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.matchCount, 1);
  assert.equal(result.data.fromCache, true);
  assert.equal(result.data.cacheAgeMinutes, 4);
  assert.deepEqual(calls, [
    ['job', 'job-a', 'org-a'],
    ['matches', 'job-a', 5, 'org-a']
  ]);
});
