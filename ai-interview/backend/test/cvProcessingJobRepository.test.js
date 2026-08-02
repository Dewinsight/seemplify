const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-repository-'));
process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = 'false';
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
delete process.env.AI_INTERVIEW_MONGO_URI;
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;

const repository = require('../src/cvProcessingJobRepository');
const { createCvProcessingJobRepository } = repository;
const {
  STORE_COLLECTIONS,
  iso,
  mutateStore,
  readStore
} = require('../src/store');

function newJob(suffix, idempotencyKey = null) {
  const at = iso(new Date());
  return {
    _id: `cvjob_${suffix}`,
    publicId: `aicv_${suffix}`,
    statusTokenHash: `hash_${suffix}`,
    idempotencyKey,
    state: 'queued',
    stage: 'ingesting',
    progress: 5,
    attempts: 0,
    failureCount: 0,
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_product_owner',
    mode: 'import',
    originalName: `${suffix}.txt`,
    mimeType: 'text/plain',
    fileSize: 100,
    createdAt: at,
    updatedAt: at
  };
}

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('CV jobs survive concurrent JSON snapshot mutations and are excluded from Mongo snapshot collections', async () => {
  assert.equal(STORE_COLLECTIONS.includes('cvProcessingJobs'), false);
  const count = 30;
  const operations = [];
  for (let index = 0; index < count; index += 1) {
    operations.push(repository.createOrGet(newJob(`survival_${index}`)));
    operations.push(mutateStore(async (store) => {
      await new Promise((resolve) => setImmediate(resolve));
      store.emailLog.push({ _id: `email_${index}`, createdAt: iso(new Date()) });
    }));
  }
  await Promise.all(operations);

  const store = await readStore();
  const survivingIds = new Set(store.cvProcessingJobs.map((job) => job.publicId));
  for (let index = 0; index < count; index += 1) {
    assert.equal(survivingIds.has(`aicv_survival_${index}`), true);
  }
  assert.equal(store.emailLog.filter((entry) => entry._id.startsWith('email_')).length, count);
});

test('concurrent idempotent creation produces exactly one durable job identity', async () => {
  const results = await Promise.all(Array.from({ length: 40 }, (_value, index) => (
    repository.createOrGet(newJob(`idem_${index}`, 'same-upload'))
  )));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.job.publicId)).size, 1);

  const store = await readStore();
  assert.equal(store.cvProcessingJobs.filter((job) => (
    job.organizationId === 'settings' && job.idempotencyKey === 'same-upload'
  )).length, 1);
});

test('Mongo repository uses unique upsert, guarded atomic updates, and a terminal TTL index', async () => {
  const calls = [];
  let persisted;
  const collection = {
    async createIndexes(indexes) {
      calls.push({ method: 'createIndexes', indexes });
    },
    async updateOne(filter, update, options) {
      calls.push({ method: 'updateOne', filter, update, options });
      if (!persisted) {
        persisted = structuredClone(update.$setOnInsert);
        return { upsertedCount: 1 };
      }
      return { upsertedCount: 0 };
    },
    async findOne(filter) {
      calls.push({ method: 'findOne', filter });
      return persisted ? structuredClone(persisted) : null;
    },
    async findOneAndUpdate(filter, pipeline, options) {
      calls.push({ method: 'findOneAndUpdate', filter, pipeline, options });
      return {
        ...structuredClone(persisted),
        state: 'completed',
        stage: 'completed',
        progress: 100,
        completedAt: iso(new Date()),
        expiresAt: new Date(Date.now() + 60_000)
      };
    }
  };
  const mongoRepository = createCvProcessingJobRepository({
    useMongo: true,
    getDb: async () => ({ collection: () => collection })
  });
  const input = newJob('mongo_atomic', 'mongo-idempotency');
  const first = await mongoRepository.createOrGet(input);
  const duplicate = await mongoRepository.createOrGet({
    ...input,
    _id: 'cvjob_mongo_loser',
    publicId: 'aicv_mongo_loser'
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.publicId, first.job.publicId);

  await mongoRepository.complete(first.job.publicId, {
    candidate: { _id: 'cand_mongo' },
    profile: { email: 'mongo@example.com' }
  });
  const indexes = calls.find((call) => call.method === 'createIndexes').indexes;
  assert.ok(indexes.some((index) => index.unique && index.key.publicId === 1));
  assert.ok(indexes.some((index) => (
    index.unique
    && index.key.organizationId === 1
    && index.key.idempotencyKey === 1
  )));
  assert.ok(indexes.some((index) => (
    index.expireAfterSeconds === 0 && index.key.expiresAt === 1
  )));
  const creationCall = calls.find((call) => call.method === 'updateOne');
  assert.equal(creationCall.options.upsert, true);
  assert.ok(creationCall.update.$setOnInsert);
  const completionCall = calls.find((call) => call.method === 'findOneAndUpdate');
  assert.deepEqual(completionCall.filter.state.$in, repository.ACTIVE_STATES);
  assert.equal(completionCall.options.returnDocument, 'after');
  assert.equal(completionCall.pipeline[0].$set.state.$literal, 'completed');
  assert.equal(completionCall.pipeline[0].$set.expiresAt, '$$REMOVE');
  assert.equal(completionCall.pipeline[1].$set.queueEventPending, true);
  assert.ok(completionCall.pipeline[1].$set.queueEventOutbox.$concatArrays);
  assert.equal('deleteMany' in collection, false);
});

test('active jobs never receive TTL and terminal state is guarded with a terminal-only TTL', async () => {
  const created = await repository.createOrGet(newJob('ttl'));
  assert.equal(created.job.expiresAt, undefined);

  const processing = await repository.beginAttempt(created.job.publicId);
  assert.equal(processing.state, 'processing');
  assert.equal(processing.expiresAt, undefined);

  const waiting = await repository.recordFailure(
    created.job.publicId,
    Object.assign(new Error('local runtime busy'), { code: 'LOCAL_LLM_BUSY' }),
    { unmetered: true }
  );
  assert.equal(waiting.job.state, 'waiting_for_local_runtime');
  assert.equal(waiting.job.expiresAt, undefined);

  const completed = await repository.complete(created.job.publicId, {
    candidate: { _id: 'cand_ttl' },
    profile: { email: 'ttl@example.com' }
  });
  assert.equal(completed.state, 'completed');
  assert.equal(completed.expiresAt, undefined);
  assert.equal(completed.queueEventPending, true);

  const acknowledged = await repository.acknowledgeQueueEvents(
    completed.publicId,
    completed.revision
  );
  assert.ok(new Date(acknowledged.expiresAt) > new Date(completed.completedAt));

  await Promise.all([
    repository.updateStage(created.job.publicId, 'analyzing', 50),
    repository.recordFailure(created.job.publicId, new Error('late worker failure'))
  ]);
  const guarded = await repository.findByPublicId(created.job.publicId);
  assert.equal(guarded.state, 'completed');
  assert.equal(guarded.candidateId, 'cand_ttl');
  assert.ok(guarded.expiresAt);
});

test('terminal TTL is withheld while durable cleanup is pending and restored after release', async () => {
  const created = await repository.createOrGet({
    ...newJob('cleanup_ttl'),
    durableFile: {
      provider: 'filesystem',
      storageKey: 'cleanup-ttl.txt',
      length: 10,
      sha256: 'a'.repeat(64),
      cleanupState: 'retained',
      cleanupAttempts: 0
    }
  });
  const completed = await repository.complete(created.job.publicId, {
    candidate: { _id: 'cand_cleanup_ttl' }
  });
  assert.equal(completed.state, 'completed');
  assert.equal(completed.expiresAt, undefined);

  const attempted = await repository.markDurableFileCleanupAttempt(created.job.publicId);
  assert.equal(attempted.durableFile.cleanupState, 'pending');
  assert.equal(attempted.durableFile.cleanupAttempts, 1);
  const failed = await repository.markDurableFileCleanupFailed(
    created.job.publicId,
    new Error('synthetic filesystem outage'),
    new Date(Date.now() + 30_000)
  );
  assert.equal(failed.durableFile.cleanupState, 'failed');
  assert.equal(failed.expiresAt, undefined);

  const released = await repository.markDurableFileReleased(created.job.publicId);
  assert.equal(released.durableFile.cleanupState, 'deleted');
  assert.ok(released.durableFile.releasedAt);
  assert.equal(released.expiresAt, undefined);
  const acknowledged = await repository.acknowledgeQueueEvents(
    released.publicId,
    released.revision
  );
  assert.ok(acknowledged.expiresAt);
});

test('offline and BUSY deliveries do not consume the bounded real-failure retry budget', async () => {
  const created = await repository.createOrGet(newJob('retry_budget'));
  for (let index = 0; index < 70; index += 1) {
    await repository.beginAttempt(created.job.publicId);
    const failure = await repository.recordFailure(
      created.job.publicId,
      Object.assign(new Error('local runtime remains busy'), { code: 'LOCAL_LLM_BUSY' }),
      { unmetered: true }
    );
    assert.equal(failure.terminal, false);
  }

  let current = await repository.findByPublicId(created.job.publicId);
  assert.equal(current.state, 'waiting_for_local_runtime');
  assert.equal(current.attempts, 70);
  assert.equal(current.failureCount, 0);
  assert.equal(current.expiresAt, undefined);

  for (let index = 1; index <= repository.maxFailures; index += 1) {
    await repository.beginAttempt(created.job.publicId);
    const failure = await repository.recordFailure(
      created.job.publicId,
      Object.assign(new Error(`extraction failure ${index}`), { code: 'CV_TEXT_EXTRACTION_FAILED' })
    );
    assert.equal(failure.terminal, index === repository.maxFailures);
  }

  current = await repository.findByPublicId(created.job.publicId);
  assert.equal(current.state, 'failed');
  assert.equal(current.attempts, 70 + repository.maxFailures);
  assert.equal(current.failureCount, repository.maxFailures);
  assert.equal(current.expiresAt, undefined);
  assert.ok(current.transitions.length <= 100);
  assert.equal(current.transitions.at(-1).attempts, current.attempts);
  assert.equal(current.transitions.at(-1).failureCount, current.failureCount);
  current = await repository.acknowledgeQueueEvents(current.publicId, current.revision);
  assert.ok(new Date(current.expiresAt) > new Date(current.failedAt));

  const telemetry = await repository.telemetrySnapshot();
  assert.ok(telemetry.dispatchAttempts >= current.attempts);
  assert.ok(telemetry.realFailures >= current.failureCount);
});
