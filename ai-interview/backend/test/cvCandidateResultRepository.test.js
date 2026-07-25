const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCvCandidateResultRepository
} = require('../src/cvCandidateResultRepository');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function matches(document, filter) {
  return Object.entries(filter || {}).every(([field, expected]) => {
    if (field === '$or') return expected.some((branch) => matches(document, branch));
    const actual = document[field];
    if (
      expected
      && typeof expected === 'object'
      && !Array.isArray(expected)
      && Object.prototype.hasOwnProperty.call(expected, '$exists')
    ) {
      return Object.prototype.hasOwnProperty.call(document, field) === expected.$exists;
    }
    if (Array.isArray(actual) && !Array.isArray(expected)) return actual.includes(expected);
    return actual === expected;
  });
}

class MemoryCandidateCollection {
  constructor(candidates = []) {
    this.candidates = clone(candidates);
  }

  async findOne(filter) {
    return clone(this.candidates.find((candidate) => matches(candidate, filter)) || null);
  }

  assertUnique(candidate, ignoredIndex = -1) {
    const identities = new Set(candidate.cvProcessingJobIds || []);
    const duplicate = this.candidates.find((existing, index) => (
      index !== ignoredIndex
      && (
        existing._id === candidate._id
        || (existing.cvProcessingJobIds || []).some((identity) => identities.has(identity))
      )
    ));
    if (duplicate) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
  }

  async insertOne(candidate) {
    this.assertUnique(candidate);
    this.candidates.push(clone(candidate));
    return { insertedId: candidate._id };
  }

  async replaceOne(filter, candidate) {
    const index = this.candidates.findIndex((current) => matches(current, filter));
    if (index < 0) return { matchedCount: 0 };
    this.assertUnique(candidate, index);
    this.candidates[index] = clone(candidate);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function processingJob(publicId, overrides = {}) {
  return {
    publicId,
    mode: 'import',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    originalName: 'candidate.pdf',
    mimeType: 'application/pdf',
    ...overrides
  };
}

function commitInput(job, email = 'ada@example.com') {
  return {
    processingJob: job,
    candidateEmail: email,
    createCandidate: (createdAt, candidateId) => ({
      _id: candidateId,
      email,
      jobId: job.jobId,
      createdBy: job.actorId,
      createdAt
    }),
    applyResult: (candidate, committedAt) => {
      candidate.email = email;
      candidate.name = 'Ada Lovelace';
      candidate.skills = [...new Set([...(candidate.skills || []), 'Algorithms'])];
      candidate.resumeUploads = candidate.resumeUploads || [];
      if (!candidate.resumeUploads.some((upload) => upload.processingJobId === job.publicId)) {
        candidate.resumeUploads.push({
          processingJobId: job.publicId,
          fileName: job.originalName,
          analyzedAt: committedAt
        });
      }
    }
  };
}

function mongoRepository(collection, now = new Date('2026-07-24T12:00:00.000Z')) {
  return createCvCandidateResultRepository({
    useMongo: true,
    getDb: async () => ({ collection: () => collection }),
    now: () => now
  });
}

test('two Mongo process instances commit one imported candidate and one resume upload', async () => {
  const collection = new MemoryCandidateCollection();
  const firstProcess = mongoRepository(collection);
  const secondProcess = mongoRepository(collection);
  const job = processingJob('aicv_two_process_insert');

  const results = await Promise.all([
    firstProcess.commit(commitInput(job)),
    secondProcess.commit(commitInput(job))
  ]);

  assert.equal(collection.candidates.length, 1);
  assert.equal(collection.candidates[0].resumeUploads.length, 1);
  assert.deepEqual(collection.candidates[0].cvProcessingJobIds, [job.publicId]);
  assert.equal(collection.candidates[0].cvProcessingRevision, 1);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(new Set(results.map((result) => result.candidate._id)).size, 1);
});

test('two Mongo process instances converge on an existing candidate through CAS', async () => {
  const collection = new MemoryCandidateCollection([{
    _id: 'cand_existing',
    email: 'ada@example.com',
    jobId: 'job_engineering',
    createdBy: 'user_recruiter',
    name: 'Ada',
    resumeUploads: [],
    updatedAt: '2026-07-24T11:00:00.000Z'
  }]);
  const job = processingJob('aicv_two_process_existing');
  const results = await Promise.all([
    mongoRepository(collection).commit(commitInput(job)),
    mongoRepository(collection).commit(commitInput(job))
  ]);

  assert.equal(collection.candidates.length, 1);
  assert.equal(collection.candidates[0]._id, 'cand_existing');
  assert.equal(collection.candidates[0].resumeUploads.length, 1);
  assert.equal(collection.candidates[0].cvProcessingRevision, 1);
  assert.equal(results.filter((result) => result.applied).length, 1);
});

test('a replay after the candidate commit is a read-only success', async () => {
  const collection = new MemoryCandidateCollection();
  const job = processingJob('aicv_crash_after_candidate_commit');
  const firstProcess = mongoRepository(collection);
  const committed = await firstProcess.commit(commitInput(job));
  const afterCommit = clone(collection.candidates);

  // Simulate a new worker process retrying before the queue job was marked
  // completed. The candidate commit is the durable receipt.
  const replayed = await mongoRepository(collection).commit(commitInput(job));

  assert.equal(committed.applied, true);
  assert.equal(replayed.applied, false);
  assert.deepEqual(collection.candidates, afterCommit);
  assert.equal(replayed.candidate.resumeUploads.length, 1);
});

test('the JSON development store preserves the same replay semantics', async () => {
  const state = { candidates: [] };
  let tail = Promise.resolve();
  const mutate = (operation) => {
    const result = tail.then(() => operation(state));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const job = processingJob('aicv_json_replay');
  const dependencies = {
    useMongo: false,
    mutate,
    now: () => new Date('2026-07-24T12:00:00.000Z')
  };
  const results = await Promise.all([
    createCvCandidateResultRepository(dependencies).commit(commitInput(job)),
    createCvCandidateResultRepository(dependencies).commit(commitInput(job))
  ]);

  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].resumeUploads.length, 1);
  assert.equal(results.filter((result) => result.applied).length, 1);
});
