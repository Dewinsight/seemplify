const crypto = require('crypto');
const path = require('path');
const {
  connectMongo,
  iso,
  mutateStore,
  readStore,
  shouldUseMongo
} = require('./store');

const COLLECTION_NAME = 'cvStorageCleanupTasks';
const COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GRIDFS_BUCKET_NAME = 'ai_interview_cv_ingestion_files';

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function resourceFor(reference = {}) {
  if (reference.provider === 'gridfs' && reference.fileId) {
    const bucket = String(reference.bucket || GRIDFS_BUCKET_NAME);
    if (bucket !== GRIDFS_BUCKET_NAME) {
      const error = new Error('The durable CV cleanup bucket is invalid');
      error.code = 'CV_DURABLE_FILE_INVALID';
      throw error;
    }
    return {
      provider: 'gridfs',
      bucket,
      fileId: String(reference.fileId).slice(0, 100)
    };
  }
  if (reference.provider === 'filesystem' && reference.storageKey) {
    const storageKey = String(reference.storageKey);
    if (storageKey !== path.basename(storageKey)) {
      const error = new Error('The durable CV cleanup reference is invalid');
      error.code = 'CV_DURABLE_FILE_INVALID';
      throw error;
    }
    return {
      provider: 'filesystem',
      storageKey: storageKey.slice(0, 500)
    };
  }
  const error = new Error('The durable CV cleanup reference is invalid');
  error.code = 'CV_DURABLE_FILE_INVALID';
  throw error;
}

function taskKey(resource) {
  const identity = resource.provider === 'gridfs'
    ? `${resource.bucket}:${resource.fileId}`
    : resource.storageKey;
  return crypto.createHash('sha256')
    .update(`ai-interview:${resource.provider}:${identity}`)
    .digest('hex');
}

function unwrap(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  return result || null;
}

function createCvStorageCleanupTaskRepository({
  useMongo = shouldUseMongo(),
  getDb = connectMongo,
  read = readStore,
  mutate = mutateStore,
  now = () => new Date(),
  completedRetentionMs = COMPLETED_RETENTION_MS
} = {}) {
  const safeRetentionMs = Math.max(60_000, Number(completedRetentionMs) || COMPLETED_RETENTION_MS);
  let indexesPromise;

  function operationTime() {
    return new Date(now());
  }

  async function mongoCollection() {
    const db = await getDb();
    const collection = db.collection(COLLECTION_NAME);
    if (!indexesPromise) {
      indexesPromise = collection.createIndexes([
        { key: { key: 1 }, name: 'cv_cleanup_key_unique', unique: true },
        { key: { state: 1, nextAttemptAt: 1, createdAt: 1 }, name: 'cv_cleanup_due' },
        { key: { ownerPublicId: 1 }, name: 'cv_cleanup_owner' },
        { key: { expiresAt: 1 }, name: 'cv_cleanup_completed_ttl', expireAfterSeconds: 0 }
      ]).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    await indexesPromise;
    return collection;
  }

  async function schedule(reference, {
    reason = 'cv-storage-release',
    ownerPublicId = null
  } = {}) {
    const resource = resourceFor(reference);
    const key = taskKey(resource);
    const at = operationTime();
    const task = {
      key,
      provider: resource.provider,
      resource,
      ownerPublicId: ownerPublicId ? String(ownerPublicId).slice(0, 100) : null,
      reason: String(reason).slice(0, 120),
      state: 'pending',
      attempts: 0,
      nextAttemptAt: useMongo ? at : iso(at),
      createdAt: useMongo ? at : iso(at),
      updatedAt: useMongo ? at : iso(at)
    };
    if (useMongo) {
      const collection = await mongoCollection();
      await collection.updateOne({ key }, { $setOnInsert: task }, { upsert: true });
      return collection.findOne({ key });
    }
    return mutate((store) => {
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks || [];
      const existing = store.cvStorageCleanupTasks.find((item) => item.key === key);
      if (existing) return copy(existing);
      store.cvStorageCleanupTasks.push(task);
      return copy(task);
    });
  }

  async function beginAttempt(key) {
    const at = operationTime();
    if (useMongo) {
      return unwrap(await (await mongoCollection()).findOneAndUpdate(
        { key, state: { $ne: 'completed' } },
        {
          $set: { state: 'pending', lastAttemptAt: at, updatedAt: at },
          $inc: { attempts: 1 },
          $unset: { nextAttemptAt: 1, lastError: 1, expiresAt: 1 }
        },
        { returnDocument: 'after' }
      ));
    }
    return mutate((store) => {
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks || [];
      const task = store.cvStorageCleanupTasks.find((item) => item.key === key);
      if (!task || task.state === 'completed') return task ? copy(task) : null;
      task.state = 'pending';
      task.attempts = Number(task.attempts || 0) + 1;
      task.lastAttemptAt = iso(at);
      task.updatedAt = iso(at);
      delete task.nextAttemptAt;
      delete task.lastError;
      delete task.expiresAt;
      return copy(task);
    });
  }

  async function complete(key) {
    const at = operationTime();
    const expiresAt = new Date(at.getTime() + safeRetentionMs);
    if (useMongo) {
      return unwrap(await (await mongoCollection()).findOneAndUpdate(
        { key },
        {
          $set: { state: 'completed', completedAt: at, expiresAt, updatedAt: at },
          $unset: { nextAttemptAt: 1, lastError: 1 }
        },
        { returnDocument: 'after' }
      ));
    }
    return mutate((store) => {
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks || [];
      const task = store.cvStorageCleanupTasks.find((item) => item.key === key);
      if (!task) return null;
      task.state = 'completed';
      task.completedAt = iso(at);
      task.expiresAt = iso(expiresAt);
      task.updatedAt = iso(at);
      delete task.nextAttemptAt;
      delete task.lastError;
      return copy(task);
    });
  }

  async function fail(key, error, nextAttemptAt) {
    const at = operationTime();
    const lastError = {
      code: error?.code || 'CV_STORAGE_CLEANUP_FAILED',
      message: String(error?.message || error).slice(0, 1000)
    };
    if (useMongo) {
      return unwrap(await (await mongoCollection()).findOneAndUpdate(
        { key },
        {
          $set: {
            state: 'failed',
            lastError,
            nextAttemptAt: new Date(nextAttemptAt),
            updatedAt: at
          },
          $unset: { expiresAt: 1 }
        },
        { returnDocument: 'after' }
      ));
    }
    return mutate((store) => {
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks || [];
      const task = store.cvStorageCleanupTasks.find((item) => item.key === key);
      if (!task) return null;
      task.state = 'failed';
      task.lastError = lastError;
      task.nextAttemptAt = iso(nextAttemptAt);
      task.updatedAt = iso(at);
      delete task.expiresAt;
      return copy(task);
    });
  }

  async function findDue(at = operationTime(), limit = 100) {
    if (useMongo) {
      return (await mongoCollection()).find({
        state: { $in: ['pending', 'failed'] },
        $or: [
          { nextAttemptAt: { $exists: false } },
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: at } }
        ]
      }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(limit).toArray();
    }
    const store = await read();
    const threshold = new Date(at).getTime();
    return copy((store.cvStorageCleanupTasks || [])
      .filter((task) => (
        ['pending', 'failed'].includes(task.state)
        && (!task.nextAttemptAt || new Date(task.nextAttemptAt).getTime() <= threshold)
      ))
      .sort((left, right) => new Date(left.nextAttemptAt || left.createdAt)
        - new Date(right.nextAttemptAt || right.createdAt))
      .slice(0, limit));
  }

  async function pruneCompleted(at = operationTime()) {
    if (useMongo) return 0;
    let pruned = 0;
    const threshold = new Date(at).getTime();
    await mutate((store) => {
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks || [];
      store.cvStorageCleanupTasks = store.cvStorageCleanupTasks.filter((task) => {
        const expired = task.state === 'completed'
          && task.expiresAt
          && new Date(task.expiresAt).getTime() <= threshold;
        if (expired) pruned += 1;
        return !expired;
      });
    });
    return pruned;
  }

  return {
    beginAttempt,
    complete,
    fail,
    findDue,
    pruneCompleted,
    schedule
  };
}

const repository = createCvStorageCleanupTaskRepository();

module.exports = {
  ...repository,
  COLLECTION_NAME,
  COMPLETED_RETENTION_MS,
  createCvStorageCleanupTaskRepository,
  resourceFor,
  taskKey
};
