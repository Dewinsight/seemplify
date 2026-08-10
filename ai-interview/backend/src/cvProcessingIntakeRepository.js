const crypto = require('crypto');
const {
  connectMongo,
  iso,
  mutateStore,
  readStore,
  shouldUseMongo
} = require('./store');

const COLLECTION_NAME = 'cvProcessingIntakes';
const ACTIVE_STATES = Object.freeze(['reserved', 'storing', 'persisted']);
const REARMABLE_STATES = Object.freeze(['cleanup_pending', 'cleanup_failed', 'cleaned']);
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function unwrap(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  return result || null;
}

function referenceKey(reference = {}) {
  if (reference.provider === 'gridfs' && reference.fileId) {
    return `gridfs:${String(reference.bucket || '')}:${String(reference.fileId)}`;
  }
  if (reference.provider === 'filesystem' && reference.storageKey) {
    return `filesystem:${String(reference.storageKey)}`;
  }
  return null;
}

function createCvProcessingIntakeRepository({
  useMongo = shouldUseMongo(),
  getDb = connectMongo,
  read = readStore,
  mutate = mutateStore,
  now = () => new Date(),
  receiptRetentionMs = RECEIPT_RETENTION_MS
} = {}) {
  const safeReceiptRetentionMs = Math.max(
    60_000,
    Number(receiptRetentionMs) || RECEIPT_RETENTION_MS
  );
  let indexesPromise;

  function operationTime() {
    return new Date(now());
  }

  function scope(input) {
    return {
      organizationId: String(input.organizationId || ''),
      actorId: String(input.actorId || ''),
      idempotencyKey: String(input.idempotencyKey || '')
    };
  }

  async function mongoCollection() {
    const db = await getDb();
    const collection = db.collection(COLLECTION_NAME);
    if (!indexesPromise) {
      indexesPromise = collection.createIndexes([
        { key: { intakeId: 1 }, name: 'cv_intake_id_unique', unique: true },
        {
          key: { organizationId: 1, actorId: 1, idempotencyKey: 1 },
          name: 'cv_intake_actor_idempotency_unique',
          unique: true
        },
        { key: { state: 1, updatedAt: 1, intakeId: 1 }, name: 'cv_intake_recovery' },
        { key: { 'durableFile.fileId': 1 }, name: 'cv_intake_gridfs_reference' },
        { key: { 'durableFile.storageKey': 1 }, name: 'cv_intake_filesystem_reference' },
        { key: { expiresAt: 1 }, name: 'cv_intake_receipt_ttl', expireAfterSeconds: 0 }
      ]).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    await indexesPromise;
    return collection;
  }

  function prepare(input) {
    const at = operationTime();
    return {
      intakeId: String(input.intakeId || `cvintake_${crypto.randomUUID()}`),
      ...scope(input),
      publicId: String(input.publicId || ''),
      statusTokenHash: String(input.statusTokenHash || ''),
      requestFingerprint: String(input.requestFingerprint || '').toLowerCase(),
      jobId: String(input.jobId || ''),
      candidateId: input.candidateId ? String(input.candidateId) : null,
      mode: String(input.mode || ''),
      originalName: String(input.originalName || 'cv').slice(0, 255),
      mimeType: String(input.mimeType || 'application/octet-stream').slice(0, 127),
      fileSize: Math.max(0, Number(input.fileSize || input.durableFile?.length || 0)),
      durableFile: copy(input.durableFile),
      state: 'reserved',
      createdAt: iso(at),
      updatedAt: iso(at),
      revision: 0
    };
  }

  async function reserve(input) {
    const proposed = prepare(input);
    const filter = scope(proposed);
    if (!useMongo) {
      let created = false;
      let rearmed = false;
      const intake = await mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        let existing = store.cvProcessingIntakes.find((item) => (
          item.organizationId === filter.organizationId
          && item.actorId === filter.actorId
          && item.idempotencyKey === filter.idempotencyKey
        ));
        if (!existing) {
          created = true;
          store.cvProcessingIntakes.push(copy(proposed));
          return copy(proposed);
        }
        if (
          REARMABLE_STATES.includes(existing.state)
          && existing.requestFingerprint === proposed.requestFingerprint
        ) {
          rearmed = true;
          existing.state = 'reserved';
          existing.durableFile = copy(proposed.durableFile);
          existing.jobId = proposed.jobId;
          existing.candidateId = proposed.candidateId;
          existing.mode = proposed.mode;
          existing.originalName = proposed.originalName;
          existing.mimeType = proposed.mimeType;
          existing.fileSize = proposed.fileSize;
          existing.updatedAt = proposed.updatedAt;
          existing.revision = Number(existing.revision || 0) + 1;
          delete existing.cleanupToken;
          delete existing.cleanupStartedAt;
          delete existing.cleanupFailedAt;
          delete existing.cleanupError;
          delete existing.cleanedAt;
          delete existing.expiresAt;
        }
        return copy(existing);
      });
      return { intake, created, rearmed };
    }

    const collection = await mongoCollection();
    let created = false;
    try {
      const result = await collection.updateOne(
        filter,
        { $setOnInsert: proposed },
        { upsert: true }
      );
      created = Number(result.upsertedCount || 0) === 1;
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
    }
    let intake = await collection.findOne(filter);
    let rearmed = false;
    if (
      intake
      && REARMABLE_STATES.includes(intake.state)
      && intake.requestFingerprint === proposed.requestFingerprint
    ) {
      const result = await collection.findOneAndUpdate({
        ...filter,
        revision: intake.revision,
        state: { $in: REARMABLE_STATES }
      }, {
        $set: {
          state: 'reserved',
          durableFile: proposed.durableFile,
          jobId: proposed.jobId,
          candidateId: proposed.candidateId,
          mode: proposed.mode,
          originalName: proposed.originalName,
          mimeType: proposed.mimeType,
          fileSize: proposed.fileSize,
          updatedAt: proposed.updatedAt
        },
        $inc: { revision: 1 },
        $unset: {
          cleanupToken: 1,
          cleanupStartedAt: 1,
          cleanupFailedAt: 1,
          cleanupError: 1,
          cleanedAt: 1,
          expiresAt: 1
        }
      }, { returnDocument: 'after' });
      const updated = unwrap(result);
      if (updated) {
        intake = updated;
        rearmed = true;
      } else {
        intake = await collection.findOne(filter);
      }
    }
    return { intake, created, rearmed };
  }

  async function findByScope(organizationId, actorId, idempotencyKey) {
    const filter = scope({ organizationId, actorId, idempotencyKey });
    if (useMongo) return (await mongoCollection()).findOne(filter);
    const store = await read();
    return copy((store.cvProcessingIntakes || []).find((item) => (
      item.organizationId === filter.organizationId
      && item.actorId === filter.actorId
      && item.idempotencyKey === filter.idempotencyKey
    )) || null);
  }

  async function claimStorage(intakeId, reference) {
    const key = referenceKey(reference);
    if (!key) return null;
    const at = operationTime();
    const storageToken = crypto.randomUUID();
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => item.intakeId === intakeId);
        if (
          !intake
          || intake.state !== 'reserved'
          || referenceKey(intake.durableFile) !== key
        ) return null;
        intake.state = 'storing';
        intake.storageToken = storageToken;
        intake.storageStartedAt = iso(at);
        intake.updatedAt = iso(at);
        intake.revision = Number(intake.revision || 0) + 1;
        return copy(intake);
      });
    }
    const identityFilter = reference.provider === 'gridfs'
      ? { 'durableFile.fileId': String(reference.fileId) }
      : { 'durableFile.storageKey': String(reference.storageKey) };
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'reserved',
      ...identityFilter
    }, {
      $set: {
        state: 'storing',
        storageToken,
        storageStartedAt: iso(at),
        updatedAt: iso(at)
      },
      $inc: { revision: 1 },
      $unset: { expiresAt: 1 }
    }, { returnDocument: 'after' }));
  }

  async function markStorageCleaned(intakeId, storageToken) {
    const at = operationTime();
    const expiresAt = new Date(at.getTime() + safeReceiptRetentionMs);
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => (
          item.intakeId === intakeId
          && item.state === 'storing'
          && item.storageToken === storageToken
        ));
        if (!intake) return null;
        intake.state = 'cleaned';
        intake.cleanedAt = iso(at);
        intake.updatedAt = iso(at);
        intake.expiresAt = iso(expiresAt);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.originalName;
        delete intake.storageToken;
        delete intake.storageStartedAt;
        return copy(intake);
      });
    }
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'storing',
      storageToken
    }, {
      $set: {
        state: 'cleaned',
        cleanedAt: iso(at),
        updatedAt: iso(at),
        expiresAt
      },
      $inc: { revision: 1 },
      $unset: { originalName: 1, storageToken: 1, storageStartedAt: 1 }
    }, { returnDocument: 'after' }));
  }

  async function markPersisted(
    intakeId,
    reference,
    storageToken,
    persistedAt = iso(operationTime())
  ) {
    const key = referenceKey(reference);
    if (!key) return null;
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => item.intakeId === intakeId);
        if (
          !intake
          || intake.state !== 'storing'
          || !storageToken
          || intake.storageToken !== storageToken
        ) return null;
        if (referenceKey(intake.durableFile) !== key) return null;
        intake.state = 'persisted';
        intake.durableFile.persistedAt = persistedAt;
        intake.updatedAt = iso(operationTime());
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.storageToken;
        delete intake.storageStartedAt;
        delete intake.storageError;
        return copy(intake);
      });
    }
    const at = iso(operationTime());
    const identityFilter = reference.provider === 'gridfs'
      ? { 'durableFile.fileId': String(reference.fileId) }
      : { 'durableFile.storageKey': String(reference.storageKey) };
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'storing',
      storageToken,
      ...identityFilter
    }, {
      $set: {
        state: 'persisted',
        'durableFile.persistedAt': persistedAt,
        updatedAt: at
      },
      $inc: { revision: 1 },
      $unset: { storageToken: 1, storageStartedAt: 1, storageError: 1 }
    }, { returnDocument: 'after' }));
  }

  async function claimBinding(intakeId, reference) {
    const key = referenceKey(reference);
    if (!key) return null;
    const at = operationTime();
    const bindingToken = crypto.randomUUID();
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => item.intakeId === intakeId);
        if (
          !intake
          || intake.state !== 'persisted'
          || referenceKey(intake.durableFile) !== key
        ) return null;
        intake.state = 'binding';
        intake.bindingToken = bindingToken;
        intake.bindingStartedAt = iso(at);
        intake.updatedAt = iso(at);
        intake.revision = Number(intake.revision || 0) + 1;
        return copy(intake);
      });
    }
    const identityFilter = reference.provider === 'gridfs'
      ? { 'durableFile.fileId': String(reference.fileId) }
      : { 'durableFile.storageKey': String(reference.storageKey) };
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'persisted',
      ...identityFilter
    }, {
      $set: {
        state: 'binding',
        bindingToken,
        bindingStartedAt: iso(at),
        updatedAt: iso(at)
      },
      $inc: { revision: 1 },
      $unset: { expiresAt: 1 }
    }, { returnDocument: 'after' }));
  }

  async function releaseBinding(intakeId, bindingToken, error = null) {
    const at = operationTime();
    const bindingError = error ? {
      code: String(error?.code || 'CV_INTAKE_BINDING_FAILED').slice(0, 100),
      message: 'CV intake binding did not complete and will be recovered.'
    } : null;
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => (
          item.intakeId === intakeId
          && item.state === 'binding'
          && item.bindingToken === bindingToken
        ));
        if (!intake) return null;
        intake.state = 'persisted';
        intake.updatedAt = iso(at);
        intake.revision = Number(intake.revision || 0) + 1;
        if (bindingError) intake.bindingError = bindingError;
        delete intake.bindingToken;
        delete intake.bindingStartedAt;
        return copy(intake);
      });
    }
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'binding',
      bindingToken
    }, {
      $set: {
        state: 'persisted',
        updatedAt: iso(at),
        ...(bindingError ? { bindingError } : {})
      },
      $inc: { revision: 1 },
      $unset: { bindingToken: 1, bindingStartedAt: 1, expiresAt: 1 }
    }, { returnDocument: 'after' }));
  }

  async function markBound(intakeId, jobPublicId, reference, bindingToken = null) {
    const key = referenceKey(reference);
    if (!key) return null;
    const at = operationTime();
    const expiresAt = new Date(at.getTime() + safeReceiptRetentionMs);
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => item.intakeId === intakeId);
        if (!intake || referenceKey(intake.durableFile) !== key) return null;
        if (intake.state === 'bound' && intake.jobPublicId === String(jobPublicId)) {
          return copy(intake);
        }
        if (
          intake.state !== 'binding'
          || !bindingToken
          || intake.bindingToken !== bindingToken
        ) return null;
        intake.state = 'bound';
        intake.jobPublicId = String(jobPublicId);
        intake.boundAt = iso(at);
        intake.updatedAt = iso(at);
        intake.expiresAt = iso(expiresAt);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.bindingToken;
        delete intake.bindingError;
        return copy(intake);
      });
    }
    const identityFilter = reference.provider === 'gridfs'
      ? { 'durableFile.fileId': String(reference.fileId) }
      : { 'durableFile.storageKey': String(reference.storageKey) };
    const stateFilter = bindingToken
      ? {
        $or: [
          { state: 'binding', bindingToken },
          { state: 'bound', jobPublicId: String(jobPublicId) }
        ]
      }
      : { state: 'bound', jobPublicId: String(jobPublicId) };
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      ...identityFilter,
      ...stateFilter
    }, {
      $set: {
        state: 'bound',
        jobPublicId: String(jobPublicId),
        boundAt: iso(at),
        updatedAt: iso(at),
        expiresAt
      },
      $inc: { revision: 1 },
      $unset: { bindingToken: 1, bindingError: 1 }
    }, { returnDocument: 'after' }));
  }

  async function repairBound(intakeId, jobPublicId, reference, cleanupToken) {
    const key = referenceKey(reference);
    if (!key || !cleanupToken) return null;
    const at = operationTime();
    const expiresAt = new Date(at.getTime() + safeReceiptRetentionMs);
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => (
          item.intakeId === intakeId
          && item.state === 'cleanup_pending'
          && item.cleanupToken === cleanupToken
          && referenceKey(item.durableFile) === key
        ));
        if (!intake) return null;
        intake.state = 'bound';
        intake.jobPublicId = String(jobPublicId);
        intake.boundAt = iso(at);
        intake.updatedAt = iso(at);
        intake.expiresAt = iso(expiresAt);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.cleanupToken;
        return copy(intake);
      });
    }
    const identityFilter = reference.provider === 'gridfs'
      ? { 'durableFile.fileId': String(reference.fileId) }
      : { 'durableFile.storageKey': String(reference.storageKey) };
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: 'cleanup_pending',
      cleanupToken,
      ...identityFilter
    }, {
      $set: {
        state: 'bound',
        jobPublicId: String(jobPublicId),
        boundAt: iso(at),
        updatedAt: iso(at),
        expiresAt
      },
      $inc: { revision: 1 },
      $unset: { cleanupToken: 1 }
    }, { returnDocument: 'after' }));
  }

  async function findBindingIntakes(limit = 500, { after = null } = {}) {
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(Number(limit) || 500)));
    if (useMongo) {
      const filter = { state: 'binding' };
      if (after) filter.intakeId = { $gt: String(after) };
      return (await mongoCollection()).find(filter)
        .sort({ intakeId: 1 })
        .limit(safeLimit)
        .toArray();
    }
    const store = await read();
    return copy((store.cvProcessingIntakes || [])
      .filter((item) => item.state === 'binding' && (!after || item.intakeId > after))
      .sort((left, right) => String(left.intakeId).localeCompare(String(right.intakeId)))
      .slice(0, safeLimit));
  }

  async function findStaleUnbound(staleBefore, limit = 500, { after = null } = {}) {
    const cutoff = iso(staleBefore);
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(Number(limit) || 500)));
    const states = [...ACTIVE_STATES, 'cleanup_failed'];
    if (useMongo) {
      const filter = {
        state: { $in: states },
        updatedAt: { $lte: cutoff },
        $or: [
          { cleanupNextAttemptAt: { $exists: false } },
          { cleanupNextAttemptAt: null },
          { cleanupNextAttemptAt: { $lte: cutoff } }
        ]
      };
      if (after) filter.intakeId = { $gt: String(after) };
      return (await mongoCollection()).find(filter)
        .sort({ intakeId: 1 })
        .limit(safeLimit)
        .toArray();
    }
    const store = await read();
    const threshold = new Date(staleBefore).getTime();
    return copy((store.cvProcessingIntakes || [])
      .filter((item) => (
        states.includes(item.state)
        && new Date(item.updatedAt || item.createdAt).getTime() <= threshold
        && (!after || String(item.intakeId) > String(after))
        && (
          !item.cleanupNextAttemptAt
          || new Date(item.cleanupNextAttemptAt).getTime() <= threshold
        )
      ))
      .sort((left, right) => String(left.intakeId).localeCompare(String(right.intakeId)))
      .slice(0, safeLimit));
  }

  async function claimCleanup(intakeId, staleBefore) {
    const at = operationTime();
    const cleanupToken = crypto.randomUUID();
    const cutoff = iso(staleBefore);
    const states = [...ACTIVE_STATES, 'cleanup_failed'];
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => item.intakeId === intakeId);
        if (
          !intake
          || !states.includes(intake.state)
          || new Date(intake.updatedAt || intake.createdAt).getTime() > new Date(staleBefore).getTime()
        ) return null;
        intake.state = 'cleanup_pending';
        intake.cleanupToken = cleanupToken;
        intake.cleanupStartedAt = iso(at);
        intake.updatedAt = iso(at);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.storageToken;
        delete intake.storageStartedAt;
        return copy(intake);
      });
    }
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      state: { $in: states },
      updatedAt: { $lte: cutoff }
    }, {
      $set: {
        state: 'cleanup_pending',
        cleanupToken,
        cleanupStartedAt: iso(at),
        updatedAt: iso(at)
      },
      $inc: { revision: 1 },
      $unset: {
        cleanupNextAttemptAt: 1,
        cleanupError: 1,
        storageToken: 1,
        storageStartedAt: 1,
        expiresAt: 1
      }
    }, { returnDocument: 'after' }));
  }

  async function markCleaned(intakeId, cleanupToken) {
    const at = operationTime();
    const expiresAt = new Date(at.getTime() + safeReceiptRetentionMs);
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => (
          item.intakeId === intakeId && item.cleanupToken === cleanupToken
        ));
        if (!intake) return null;
        intake.state = 'cleaned';
        intake.cleanedAt = iso(at);
        intake.updatedAt = iso(at);
        intake.expiresAt = iso(expiresAt);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.cleanupToken;
        delete intake.cleanupNextAttemptAt;
        delete intake.cleanupError;
        delete intake.originalName;
        delete intake.storageToken;
        delete intake.storageStartedAt;
        return copy(intake);
      });
    }
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      cleanupToken
    }, {
      $set: {
        state: 'cleaned',
        cleanedAt: iso(at),
        updatedAt: iso(at),
        expiresAt
      },
      $inc: { revision: 1 },
      $unset: {
        cleanupToken: 1,
        cleanupNextAttemptAt: 1,
        cleanupError: 1,
        originalName: 1,
        storageToken: 1,
        storageStartedAt: 1
      }
    }, { returnDocument: 'after' }));
  }

  async function markCleanupFailed(intakeId, cleanupToken, error, nextAttemptAt) {
    const at = operationTime();
    const cleanupError = {
      code: String(error?.code || 'CV_INTAKE_CLEANUP_FAILED').slice(0, 100),
      message: 'Abandoned CV intake cleanup failed and will be retried.'
    };
    if (!useMongo) {
      return mutate((store) => {
        store.cvProcessingIntakes = store.cvProcessingIntakes || [];
        const intake = store.cvProcessingIntakes.find((item) => (
          item.intakeId === intakeId && item.cleanupToken === cleanupToken
        ));
        if (!intake) return null;
        intake.state = 'cleanup_failed';
        intake.cleanupError = cleanupError;
        intake.cleanupFailedAt = iso(at);
        intake.cleanupNextAttemptAt = iso(nextAttemptAt);
        intake.updatedAt = iso(at);
        intake.revision = Number(intake.revision || 0) + 1;
        delete intake.cleanupToken;
        return copy(intake);
      });
    }
    return unwrap(await (await mongoCollection()).findOneAndUpdate({
      intakeId,
      cleanupToken
    }, {
      $set: {
        state: 'cleanup_failed',
        cleanupError,
        cleanupFailedAt: iso(at),
        cleanupNextAttemptAt: iso(nextAttemptAt),
        updatedAt: iso(at)
      },
      $inc: { revision: 1 },
      $unset: { cleanupToken: 1, expiresAt: 1 }
    }, { returnDocument: 'after' }));
  }

  async function hasLiveReference(reference) {
    const key = referenceKey(reference);
    if (!key) return false;
    const states = [...ACTIVE_STATES, 'binding', 'cleanup_pending', 'cleanup_failed'];
    if (useMongo) {
      const identityFilter = reference.provider === 'gridfs'
        ? { 'durableFile.fileId': String(reference.fileId) }
        : { 'durableFile.storageKey': String(reference.storageKey) };
      return (await mongoCollection()).countDocuments({
        state: { $in: states },
        ...identityFilter
      }, { limit: 1 }) > 0;
    }
    const store = await read();
    return (store.cvProcessingIntakes || []).some((item) => (
      states.includes(item.state) && referenceKey(item.durableFile) === key
    ));
  }

  return {
    claimBinding,
    claimCleanup,
    claimStorage,
    findByScope,
    findBindingIntakes,
    findStaleUnbound,
    hasLiveReference,
    markBound,
    markCleaned,
    markCleanupFailed,
    markPersisted,
    markStorageCleaned,
    releaseBinding,
    repairBound,
    reserve
  };
}

const repository = createCvProcessingIntakeRepository();

module.exports = {
  ...repository,
  ACTIVE_STATES,
  COLLECTION_NAME,
  RECEIPT_RETENTION_MS,
  createCvProcessingIntakeRepository,
  referenceKey
};
