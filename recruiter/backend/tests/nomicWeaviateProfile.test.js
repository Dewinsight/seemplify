const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../services/weaviateService');

test('Nomic candidate and job operations use independent classes and reject Azure dimensions', async () => {
  const old = process.env.RECRUITER_EMBEDDING_PROVIDER;
  process.env.RECRUITER_EMBEDDING_PROVIDER = 'nomic-node';
  try {
    assert.equal(store.candidateClass, 'RecruiterCandidateNomicV1'); assert.equal(store.jobClass, 'RecruiterJobNomicV1');
    await assert.rejects(store.storeCandidateEmbedding('a'.repeat(24), Array(3072).fill(0), {}), /active Nomic profile/);
    await assert.rejects(store.storeJobEmbedding('b'.repeat(24), Array(3072).fill(0), {}), /active Nomic profile/);
  } finally { if (old === undefined) delete process.env.RECRUITER_EMBEDDING_PROVIDER; else process.env.RECRUITER_EMBEDDING_PROVIDER = old; }
});

test('privacy deletion erases both old and active candidate and job vectors', async () => {
  const original = store.client; const deleted = [];
  store.client = { schema: { getter: () => ({ do: async () => ({ classes: ['Candidate','Job','RecruiterCandidateNomicV1','RecruiterJobNomicV1'].map(name => ({ class: name })) }) }) }, data: { deleter: () => { let name; const op = { withClassName: value => { name = value; return op; }, withId: () => op, do: async () => deleted.push(name) }; return op; } } };
  try { await store.deleteCandidate('a'.repeat(24)); await store.deleteJob('b'.repeat(24)); assert.deepEqual(deleted, ['Candidate','RecruiterCandidateNomicV1','Job','RecruiterJobNomicV1']); }
  finally { store.client = original; }
});
