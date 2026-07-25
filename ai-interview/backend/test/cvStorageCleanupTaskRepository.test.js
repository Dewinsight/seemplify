const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-cleanup-repo-'));
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
delete process.env.AI_INTERVIEW_MONGO_URI;
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;

const {
  COLLECTION_NAME,
  createCvStorageCleanupTaskRepository
} = require('../src/cvStorageCleanupTaskRepository');
const { STORE_COLLECTIONS, readStore } = require('../src/store');

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('JSON cleanup tasks retry durably and only completed tasks expire', async () => {
  let clock = new Date('2026-07-24T12:00:00.000Z');
  const repository = createCvStorageCleanupTaskRepository({
    useMongo: false,
    now: () => clock,
    completedRetentionMs: 60_000
  });
  const reference = {
    provider: 'filesystem',
    storageKey: 'one-cv.txt'
  };
  const first = await repository.schedule(reference, {
    ownerPublicId: 'aicv_cleanup',
    reason: 'terminal-job-durable-file'
  });
  const duplicate = await repository.schedule(reference, {
    ownerPublicId: 'aicv_cleanup',
    reason: 'duplicate'
  });
  assert.equal(first.key, duplicate.key);
  assert.equal((await readStore()).cvStorageCleanupTasks.length, 1);

  const attempted = await repository.beginAttempt(first.key);
  assert.equal(attempted.attempts, 1);
  const retryAt = new Date(clock.getTime() + 30_000);
  const failed = await repository.fail(
    first.key,
    Object.assign(new Error('synthetic unlink failure'), { code: 'EIO' }),
    retryAt
  );
  assert.equal(failed.state, 'failed');
  assert.equal(failed.expiresAt, undefined);
  assert.equal((await repository.findDue(clock)).length, 0);

  clock = new Date(retryAt.getTime() + 1);
  assert.equal((await repository.findDue(clock)).length, 1);
  const completed = await repository.complete(first.key);
  assert.equal(completed.state, 'completed');
  assert.ok(new Date(completed.expiresAt) > clock);

  const pending = await repository.schedule({
    provider: 'filesystem',
    storageKey: 'never-expire-pending.txt'
  });
  clock = new Date(clock.getTime() + 120_000);
  assert.equal(await repository.pruneCompleted(clock), 1);
  const store = await readStore();
  assert.equal(store.cvStorageCleanupTasks.some((task) => task.key === first.key), false);
  assert.equal(store.cvStorageCleanupTasks.some((task) => task.key === pending.key), true);
  assert.equal(store.cvStorageCleanupTasks.find((task) => task.key === pending.key).expiresAt, undefined);
});

test('Mongo cleanup collection has unique identity, due-work, and completed-only TTL indexes', async () => {
  const calls = [];
  let persisted;
  const collection = {
    async createIndexes(indexes) {
      calls.push(indexes);
    },
    async updateOne(_filter, update) {
      persisted = persisted || structuredClone(update.$setOnInsert);
      return { upsertedCount: persisted ? 1 : 0 };
    },
    async findOne() {
      return structuredClone(persisted);
    }
  };
  const repository = createCvStorageCleanupTaskRepository({
    useMongo: true,
    getDb: async () => ({
      collection(name) {
        assert.equal(name, COLLECTION_NAME);
        return collection;
      }
    })
  });
  await repository.schedule({
    provider: 'gridfs',
    bucket: 'ai_interview_cv_ingestion_files',
    fileId: '507f1f77bcf86cd799439011'
  });
  const indexes = calls[0];
  assert.ok(indexes.some((index) => index.unique && index.key.key === 1));
  assert.ok(indexes.some((index) => index.key.state === 1 && index.key.nextAttemptAt === 1));
  assert.ok(indexes.some((index) => index.expireAfterSeconds === 0 && index.key.expiresAt === 1));
  assert.equal(STORE_COLLECTIONS.includes(COLLECTION_NAME), false);
  assert.equal(persisted.expiresAt, undefined);
});
