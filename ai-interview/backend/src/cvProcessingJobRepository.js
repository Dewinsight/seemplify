const {
  connectMongo,
  iso,
  mutateStore,
  readStore,
  shouldUseMongo
} = require('./store');

const COLLECTION_NAME = 'cvProcessingJobs';
const ACTIVE_STATES = Object.freeze(['queued', 'waiting_for_chatgpt', 'processing']);
const TERMINAL_STATES = Object.freeze(['completed', 'failed']);
const DEFAULT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_QUEUE_EVENT_BATCH_SIZE = 100;
const DEFAULT_QUEUE_EVENT_JOB_LIMIT = 25;

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function durableCleanupOutstanding(job) {
  return Boolean(
    job?.durableFile
    && (job.durableFile.fileId || job.durableFile.storageKey)
    && !job.durableFile.releasedAt
    && job.durableFile.cleanupState !== 'deleted'
  );
}

function queueEventDeliveryOutstanding(job) {
  return job?.queueEventPending === true
    || (Array.isArray(job?.queueEventOutbox) && job.queueEventOutbox.length > 0);
}

function appendTransition(job) {
  if (!job) return null;
  job.transitions = Array.isArray(job.transitions) ? job.transitions : [];
  const sequence = Number.isFinite(Number(job.revision))
    ? Number(job.revision)
    : job.transitions.reduce((maximum, item, index) => (
      Math.max(maximum, Number.isFinite(Number(item?.sequence)) ? Number(item.sequence) : index)
    ), -1) + 1;
  const at = job.updatedAt || job.createdAt || iso(new Date());
  const transition = {
    eventKey: [
      job.publicId || '',
      sequence,
      job.state || 'queued',
      job.stage || '',
      Number(job.progress || 0),
      Number(job.attempts || 0),
      Number(job.failureCount || 0)
    ].join(':'),
    state: job.state || 'queued',
    stage: job.stage || null,
    progress: Number(job.progress || 0),
    attempts: Number(job.attempts || 0),
    failureCount: Number(job.failureCount || 0),
    at,
    sequence,
    errorCode: job.lastError?.code || null
  };
  if (!job.transitions.some((item) => item.eventKey === transition.eventKey)) {
    job.transitions.push(transition);
    if (job.transitions.length > 100) job.transitions.splice(0, job.transitions.length - 100);
  }
  return transition;
}

function enqueueQueueEvent(job, transition) {
  if (!job || !transition) return;
  job.queueEventOutbox = Array.isArray(job.queueEventOutbox) ? job.queueEventOutbox : [];
  if (!job.queueEventOutbox.some((item) => item.eventKey === transition.eventKey)) {
    job.queueEventOutbox.push(copy(transition));
  }
  job.queueEventPending = job.queueEventOutbox.length > 0;
  job.queueEventInitialized = true;
  job.queueEventNextAttemptAt = transition.at || job.updatedAt || job.createdAt || iso(new Date());
  delete job.queueEventLastError;
}

function unwrapFindOneAndUpdate(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  return result || null;
}

function literal(value) {
  return { $literal: value };
}

function currentTransitionExpression() {
  return {
    eventKey: {
      $concat: [
        { $ifNull: ['$publicId', ''] },
        ':',
        { $toString: { $ifNull: ['$revision', 0] } },
        ':',
        { $ifNull: ['$state', 'queued'] },
        ':',
        { $ifNull: ['$stage', ''] }
      ]
    },
    state: { $ifNull: ['$state', 'queued'] },
    stage: { $ifNull: ['$stage', null] },
    progress: { $ifNull: ['$progress', 0] },
    attempts: { $ifNull: ['$attempts', 0] },
    failureCount: { $ifNull: ['$failureCount', 0] },
    at: '$updatedAt',
    sequence: { $ifNull: ['$revision', 0] },
    errorCode: { $ifNull: ['$lastError.code', null] }
  };
}

function transitionExpression() {
  const transition = currentTransitionExpression();
  return {
    $slice: [
      {
        $concatArrays: [
          { $cond: [{ $isArray: '$transitions' }, '$transitions', []] },
          [transition]
        ]
      },
      -100
    ]
  };
}

function queueEventOutboxExpression() {
  return {
    $concatArrays: [
      { $cond: [{ $isArray: '$queueEventOutbox' }, '$queueEventOutbox', []] },
      [currentTransitionExpression()]
    ]
  };
}

function createCvProcessingJobRepository({
  useMongo = shouldUseMongo(),
  getDb = connectMongo,
  read = readStore,
  mutate = mutateStore,
  now = () => new Date(),
  terminalRetentionMs = Number(
    process.env.AI_INTERVIEW_CV_JOB_RETENTION_MS || DEFAULT_TERMINAL_RETENTION_MS
  ),
  maxFailures = Number(process.env.AI_INTERVIEW_CV_MAX_FAILURES || DEFAULT_MAX_FAILURES)
} = {}) {
  const safeRetentionMs = Math.max(60_000, Number(terminalRetentionMs) || DEFAULT_TERMINAL_RETENTION_MS);
  const safeMaxFailures = Math.max(1, Math.floor(Number(maxFailures) || DEFAULT_MAX_FAILURES));
  let indexesPromise;

  function operationTime() {
    const value = now();
    return value instanceof Date ? new Date(value) : new Date(value);
  }

  function expiryAt(date) {
    return new Date(date.getTime() + safeRetentionMs);
  }

  function jsonExpiryAt(date) {
    return iso(expiryAt(date));
  }

  async function mongoCollection() {
    const db = await getDb();
    const collection = db.collection(COLLECTION_NAME);
    if (!indexesPromise) {
      indexesPromise = collection.createIndexes([
        { key: { publicId: 1 }, name: 'cv_public_id_unique', unique: true },
        {
          key: { organizationId: 1, idempotencyKey: 1 },
          name: 'cv_organization_idempotency_unique',
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } }
        },
        { key: { state: 1, createdAt: 1 }, name: 'cv_state_created_at' },
        { key: { updatedAt: 1 }, name: 'cv_updated_at' },
        {
          key: { queueEventPending: 1, queueEventNextAttemptAt: 1, createdAt: 1 },
          name: 'cv_queue_event_pending',
          partialFilterExpression: { queueEventPending: true }
        },
        {
          key: { queueEventInitialized: 1, _id: 1 },
          name: 'cv_queue_event_repair'
        },
        { key: { expiresAt: 1 }, name: 'cv_terminal_ttl', expireAfterSeconds: 0 }
      ]).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    await indexesPromise;
    return collection;
  }

  function activeFilter(publicId, allowedStates = ACTIVE_STATES) {
    const filter = { publicId };
    if (allowedStates?.length) filter.state = { $in: allowedStates };
    return filter;
  }

  function buildPatchPipeline({
    set = {},
    expressions = {},
    inc = {},
    incCaps = {},
    unset = [],
    ttlMode = 'preserve',
    appendHistory = true,
    at = operationTime()
  } = {}) {
    const setStage = {};
    for (const [field, value] of Object.entries(set)) setStage[field] = literal(value);
    Object.assign(setStage, expressions);
    for (const [field, amount] of Object.entries(inc)) {
      const incremented = { $add: [{ $ifNull: [`$${field}`, 0] }, Number(amount)] };
      setStage[field] = Number.isFinite(Number(incCaps[field]))
        ? { $min: [Number(incCaps[field]), incremented] }
        : incremented;
    }
    for (const field of unset) setStage[field] = '$$REMOVE';
    setStage.updatedAt = literal(iso(at));
    setStage.revision = { $add: [{ $ifNull: ['$revision', -1] }, 1] };
    if (ttlMode === 'active') setStage.expiresAt = '$$REMOVE';
    if (ttlMode === 'terminal') setStage.expiresAt = literal(expiryAt(at));
    const pipeline = [{ $set: setStage }];
    if (appendHistory) {
      pipeline.push({
        $set: {
          transitions: transitionExpression(),
          queueEventOutbox: queueEventOutboxExpression(),
          queueEventPending: true,
          queueEventInitialized: true,
          queueEventNextAttemptAt: '$updatedAt',
          queueEventLastError: '$$REMOVE'
        }
      });
    }
    return pipeline;
  }

  function mongoDurableCleanupOutstanding() {
    return {
      $and: [
        {
          $or: [
            { $ne: [{ $ifNull: ['$durableFile.fileId', null] }, null] },
            { $ne: [{ $ifNull: ['$durableFile.storageKey', null] }, null] }
          ]
        },
        { $eq: [{ $ifNull: ['$durableFile.releasedAt', null] }, null] },
        { $ne: [{ $ifNull: ['$durableFile.cleanupState', 'retained'] }, 'deleted'] }
      ]
    };
  }

  function mongoQueueEventDeliveryOutstanding() {
    return {
      $or: [
        { $eq: [{ $ifNull: ['$queueEventPending', false] }, true] },
        {
          $gt: [
            {
              $size: {
                $cond: [
                  { $isArray: '$queueEventOutbox' },
                  '$queueEventOutbox',
                  []
                ]
              }
            },
            0
          ]
        }
      ]
    };
  }

  async function mongoPatch(publicId, change, allowedStates = ACTIVE_STATES) {
    const collection = await mongoCollection();
    const result = await collection.findOneAndUpdate(
      activeFilter(publicId, allowedStates),
      buildPatchPipeline(change),
      { returnDocument: 'after' }
    );
    return unwrapFindOneAndUpdate(result);
  }

  async function jsonMutateJob(publicId, mutator, {
    allowedStates = ACTIVE_STATES,
    appendHistory = true
  } = {}) {
    return mutate((store) => {
      store.cvProcessingJobs = store.cvProcessingJobs || [];
      const job = store.cvProcessingJobs.find((item) => item.publicId === publicId);
      if (!job || (allowedStates?.length && !allowedStates.includes(job.state))) return null;
      const at = operationTime();
      mutator(job, at);
      job.updatedAt = iso(at);
      job.revision = Number.isFinite(Number(job.revision)) ? Number(job.revision) + 1 : 0;
      if (appendHistory) enqueueQueueEvent(job, appendTransition(job));
      if (
        ACTIVE_STATES.includes(job.state)
        || durableCleanupOutstanding(job)
        || queueEventDeliveryOutstanding(job)
      ) {
        delete job.expiresAt;
      } else if (TERMINAL_STATES.includes(job.state) && !job.expiresAt) {
        job.expiresAt = jsonExpiryAt(at);
      }
      return copy(job);
    });
  }

  function prepareNewJob(input) {
    const at = operationTime();
    const job = {
      ...copy(input),
      state: ACTIVE_STATES.includes(input.state) ? input.state : 'queued',
      stage: input.stage || 'ingesting',
      progress: Number(input.progress || 0),
      attempts: Math.max(0, Number(input.attempts || 0)),
      failureCount: Math.max(0, Number(input.failureCount || 0)),
      createdAt: input.createdAt || iso(at),
      updatedAt: input.updatedAt || input.createdAt || iso(at),
      revision: Number.isFinite(Number(input.revision)) ? Number(input.revision) : 0
    };
    delete job.expiresAt;
    enqueueQueueEvent(job, appendTransition(job));
    return job;
  }

  async function createOrGet(input) {
    const job = prepareNewJob(input);
    const normalizedKey = String(job.idempotencyKey || '').trim() || null;
    job.idempotencyKey = normalizedKey;
    if (!useMongo) {
      let created = false;
      const stored = await mutate((store) => {
        store.cvProcessingJobs = store.cvProcessingJobs || [];
        if (normalizedKey) {
          const existing = store.cvProcessingJobs.find((item) => (
            item.organizationId === job.organizationId && item.idempotencyKey === normalizedKey
          ));
          if (existing) return copy(existing);
        }
        created = true;
        store.cvProcessingJobs.push(copy(job));
        return copy(job);
      });
      return { job: stored, created };
    }

    const collection = await mongoCollection();
    if (!normalizedKey) {
      await collection.insertOne(copy(job));
      return { job, created: true };
    }
    const filter = { organizationId: job.organizationId, idempotencyKey: normalizedKey };
    try {
      const result = await collection.updateOne(filter, { $setOnInsert: copy(job) }, { upsert: true });
      return {
        job: await collection.findOne(filter),
        created: Number(result.upsertedCount || 0) === 1
      };
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      const existing = await collection.findOne(filter);
      if (!existing) throw error;
      return { job: existing, created: false };
    }
  }

  async function findByPublicId(publicId) {
    if (useMongo) return (await mongoCollection()).findOne({ publicId });
    const store = await read();
    return copy((store.cvProcessingJobs || []).find((item) => item.publicId === publicId) || null);
  }

  async function findByIdempotencyKey(organizationId, idempotencyKey) {
    const normalizedKey = String(idempotencyKey || '').trim();
    if (!normalizedKey) return null;
    if (useMongo) {
      return (await mongoCollection()).findOne({ organizationId, idempotencyKey: normalizedKey });
    }
    const store = await read();
    return copy((store.cvProcessingJobs || []).find((item) => (
      item.organizationId === organizationId && item.idempotencyKey === normalizedKey
    )) || null);
  }

  async function beginAttempt(publicId, { countInference = true } = {}) {
    if (!useMongo) {
      return jsonMutateJob(publicId, (job, at) => {
        const hasResumeText = Boolean(String(job.resumeText || '').trim());
        job.state = 'processing';
        job.stage = hasResumeText ? 'analyzing' : 'extracting';
        job.progress = hasResumeText ? 50 : 20;
        job.startedAt = job.startedAt || iso(at);
        delete job.nextAttemptAt;
        if (countInference) job.attempts = Number(job.attempts || 0) + 1;
      });
    }
    const patch = {
      set: { state: 'processing' },
      unset: ['nextAttemptAt'],
      expressions: {
        stage: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ['$resumeText', ''] } }, 0] },
            'analyzing',
            'extracting'
          ]
        },
        progress: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ['$resumeText', ''] } }, 0] },
            50,
            20
          ]
        },
        startedAt: { $ifNull: ['$startedAt', literal(iso(operationTime()))] }
      },
      ttlMode: 'active'
    };
    if (countInference) patch.inc = { attempts: 1 };
    return mongoPatch(publicId, patch);
  }

  async function recordInferenceAttempt(publicId) {
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => {
        job.attempts = Number(job.attempts || 0) + 1;
      });
    }
    return mongoPatch(publicId, {
      inc: { attempts: 1 },
      ttlMode: 'active'
    });
  }

  async function updateStage(publicId, stage, progress, additional = {}) {
    const set = {
      state: 'processing',
      stage,
      progress: Math.min(100, Math.max(0, Number(progress || 0))),
      ...copy(additional)
    };
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => Object.assign(job, set));
    }
    return mongoPatch(publicId, { set, ttlMode: 'active' });
  }

  async function recordDispatchError(publicId, error) {
    const lastError = {
      code: error?.code || 'CV_QUEUE_ERROR',
      message: String(error?.message || error).slice(0, 1000),
      at: iso(operationTime())
    };
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => {
        job.state = 'queued';
        job.lastError = lastError;
      });
    }
    return mongoPatch(publicId, {
      set: { state: 'queued', lastError },
      ttlMode: 'active'
    });
  }

  async function complete(publicId, result, candidateId = null) {
    const at = operationTime();
    const set = {
      state: 'completed',
      stage: 'completed',
      progress: 100,
      candidateId: candidateId || result?.candidate?._id || null,
      result: copy(result),
      completedAt: iso(at)
    };
    let completed;
    if (!useMongo) {
      completed = await jsonMutateJob(publicId, (job) => {
        Object.assign(job, set);
        delete job.lastError;
      });
    } else {
      completed = await mongoPatch(publicId, {
        set,
        unset: ['lastError', 'failedAt', 'expiresAt'],
        at
      });
    }
    if (completed) return completed;
    const existing = await findByPublicId(publicId);
    return existing?.state === 'completed' ? existing : null;
  }

  async function recordFailure(publicId, error, {
    unmetered = false,
    retryState = unmetered ? 'waiting_for_chatgpt' : 'queued',
    deferred = false,
    nextAttemptAt = null
  } = {}) {
    const at = operationTime();
    const lastError = {
      code: error?.code || 'CV_ANALYSIS_ERROR',
      message: String(error?.message || error).slice(0, 1000),
      at: iso(at)
    };
    let job;
    if (!useMongo) {
      job = await jsonMutateJob(publicId, (current) => {
        if (!unmetered) {
          current.failureCount = Math.min(
            safeMaxFailures,
            Number(current.failureCount || 0) + 1
          );
        }
        const terminal = !unmetered && Number(current.failureCount || 0) >= safeMaxFailures;
        current.state = terminal ? 'failed' : retryState;
        current.stage = terminal ? 'failed' : (current.stage || 'ingesting');
        current.progress = terminal
          ? Number(current.progress || 20)
          : Math.max(5, Number(current.progress || 5));
        current.lastError = lastError;
        if (nextAttemptAt) current.nextAttemptAt = iso(nextAttemptAt);
        if (deferred) current.deferredCycles = Number(current.deferredCycles || 0) + 1;
        if (terminal) current.failedAt = iso(at);
        else delete current.failedAt;
      });
    } else {
      const currentFailures = { $ifNull: ['$failureCount', 0] };
      const nextFailures = unmetered
        ? currentFailures
        : { $min: [safeMaxFailures, { $add: [currentFailures, 1] }] };
      const terminalExpression = unmetered
        ? literal(false)
        : { $gte: [nextFailures, safeMaxFailures] };
      job = await mongoPatch(publicId, {
        set: {
          lastError,
          ...(nextAttemptAt ? { nextAttemptAt: iso(nextAttemptAt) } : {})
        },
        ...(deferred ? { inc: { deferredCycles: 1 } } : {}),
        expressions: {
          failureCount: nextFailures,
          state: { $cond: [terminalExpression, 'failed', retryState] },
          stage: {
            $cond: [terminalExpression, 'failed', { $ifNull: ['$stage', 'ingesting'] }]
          },
          progress: {
            $cond: [
              terminalExpression,
              { $ifNull: ['$progress', 20] },
              { $max: [5, { $ifNull: ['$progress', 5] }] }
            ]
          },
          failedAt: { $cond: [terminalExpression, literal(iso(at)), '$$REMOVE'] },
          expiresAt: '$$REMOVE'
        },
        at
      });
    }
    if (!job) job = await findByPublicId(publicId);
    return { job, terminal: job?.state === 'failed' };
  }

  async function markDurableFileCleanupAttempt(publicId, attemptedAt = iso(operationTime())) {
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => {
        if (!job.durableFile) return;
        job.durableFile.cleanupState = 'pending';
        job.durableFile.cleanupAttempts = Number(job.durableFile.cleanupAttempts || 0) + 1;
        job.durableFile.cleanupAttemptedAt = attemptedAt;
        delete job.durableFile.cleanupNextAttemptAt;
        delete job.durableFile.cleanupError;
      }, { allowedStates: null, appendHistory: false });
    }
    return mongoPatch(publicId, {
      set: {
        'durableFile.cleanupState': 'pending',
        'durableFile.cleanupAttemptedAt': attemptedAt
      },
      inc: { 'durableFile.cleanupAttempts': 1 },
      unset: ['durableFile.cleanupNextAttemptAt', 'durableFile.cleanupError'],
      ttlMode: 'active',
      appendHistory: false
    }, null);
  }

  async function markDurableFileCleanupFailed(publicId, error, nextAttemptAt) {
    const at = operationTime();
    const cleanupError = String(error?.message || error).slice(0, 1000);
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => {
        if (!job.durableFile) return;
        job.durableFile.cleanupState = 'failed';
        job.durableFile.cleanupAttemptedAt = iso(at);
        job.durableFile.cleanupNextAttemptAt = iso(nextAttemptAt);
        job.durableFile.cleanupError = cleanupError;
      }, { allowedStates: null, appendHistory: false });
    }
    return mongoPatch(publicId, {
      set: {
        'durableFile.cleanupState': 'failed',
        'durableFile.cleanupAttemptedAt': iso(at),
        'durableFile.cleanupNextAttemptAt': new Date(nextAttemptAt),
        'durableFile.cleanupError': cleanupError
      },
      ttlMode: 'active',
      appendHistory: false
    }, null);
  }

  async function markDurableFileReleased(publicId, releasedAt = iso(operationTime())) {
    const at = new Date(releasedAt);
    if (!useMongo) {
      return jsonMutateJob(publicId, (job) => {
        if (!job.durableFile) return;
        job.durableFile.cleanupState = 'deleted';
        job.durableFile.releasedAt = releasedAt;
        delete job.durableFile.cleanupNextAttemptAt;
        delete job.durableFile.cleanupError;
      }, { allowedStates: null, appendHistory: false });
    }
    return mongoPatch(publicId, {
      set: {
        'durableFile.cleanupState': 'deleted',
        'durableFile.releasedAt': releasedAt
      },
      expressions: {
        expiresAt: {
          $cond: [
            {
              $and: [
                { $in: ['$state', TERMINAL_STATES] },
                { $not: [mongoQueueEventDeliveryOutstanding()] }
              ]
            },
            literal(expiryAt(at)),
            '$$REMOVE'
          ]
        }
      },
      unset: ['durableFile.cleanupNextAttemptAt', 'durableFile.cleanupError'],
      appendHistory: false
    }, null);
  }

  async function findCleanupPending(at = operationTime(), limit = 100) {
    if (useMongo) {
      return (await mongoCollection()).find({
        state: { $in: TERMINAL_STATES },
        $and: [
          {
            $or: [
              { 'durableFile.fileId': { $exists: true } },
              { 'durableFile.storageKey': { $exists: true } }
            ]
          },
          {
            $or: [
              { 'durableFile.releasedAt': { $exists: false } },
              { 'durableFile.releasedAt': null }
            ]
          },
          {
            $or: [
              { 'durableFile.cleanupNextAttemptAt': { $exists: false } },
              { 'durableFile.cleanupNextAttemptAt': null },
              { 'durableFile.cleanupNextAttemptAt': { $lte: at } }
            ]
          }
        ],
        'durableFile.cleanupState': { $ne: 'deleted' }
      }).sort({ 'durableFile.cleanupNextAttemptAt': 1, updatedAt: 1 }).limit(limit).toArray();
    }
    const store = await read();
    const threshold = new Date(at).getTime();
    return copy((store.cvProcessingJobs || [])
      .filter((job) => (
        TERMINAL_STATES.includes(job.state)
        && durableCleanupOutstanding(job)
        && (
          !job.durableFile.cleanupNextAttemptAt
          || new Date(job.durableFile.cleanupNextAttemptAt).getTime() <= threshold
        )
      ))
      .sort((left, right) => new Date(
        left.durableFile.cleanupNextAttemptAt || left.updatedAt
      ) - new Date(right.durableFile.cleanupNextAttemptAt || right.updatedAt))
      .slice(0, limit));
  }

  async function finalizeTerminalExpiry(publicId) {
    if (!useMongo) {
      return jsonMutateJob(publicId, () => {}, {
        allowedStates: TERMINAL_STATES,
        appendHistory: false
      });
    }
    const at = operationTime();
    return mongoPatch(publicId, {
      expressions: {
        expiresAt: {
          $cond: [
            {
              $or: [
                mongoDurableCleanupOutstanding(),
                mongoQueueEventDeliveryOutstanding()
              ]
            },
            '$$REMOVE',
            literal(expiryAt(at))
          ]
        }
      },
      appendHistory: false,
      at
    }, TERMINAL_STATES);
  }

  async function countAhead(organizationId, createdAt) {
    const filter = {
      organizationId,
      state: { $in: ACTIVE_STATES },
      createdAt: { $lt: createdAt }
    };
    if (useMongo) return (await mongoCollection()).countDocuments(filter);
    const store = await read();
    const threshold = new Date(createdAt).getTime();
    return (store.cvProcessingJobs || []).filter((item) => (
      item.organizationId === organizationId
      && ACTIVE_STATES.includes(item.state)
      && new Date(item.createdAt).getTime() < threshold
    )).length;
  }

  async function clearActiveExpirations() {
    if (useMongo) {
      const result = await (await mongoCollection()).updateMany(
        { state: { $in: ACTIVE_STATES }, expiresAt: { $exists: true } },
        { $unset: { expiresAt: 1 } }
      );
      return Number(result.modifiedCount || 0);
    }
    let repaired = 0;
    await mutate((store) => {
      store.cvProcessingJobs = store.cvProcessingJobs || [];
      for (const job of store.cvProcessingJobs) {
        if (ACTIVE_STATES.includes(job.state) && job.expiresAt) {
          delete job.expiresAt;
          repaired += 1;
        }
      }
    });
    return repaired;
  }

  async function findRecoverable(staleBefore, limit = 500) {
    const staleText = iso(staleBefore);
    if (useMongo) {
      return (await mongoCollection()).find({
        state: { $in: ACTIVE_STATES },
        updatedAt: { $lt: staleText }
      }).sort({ createdAt: 1 }).limit(limit).toArray();
    }
    const store = await read();
    const threshold = new Date(staleBefore).getTime();
    return copy((store.cvProcessingJobs || [])
      .filter((item) => (
        ACTIVE_STATES.includes(item.state)
        && new Date(item.updatedAt || item.createdAt).getTime() < threshold
      ))
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .slice(0, limit));
  }

  async function repairQueueEventOutbox(limit = 500) {
    const safeLimit = Math.max(1, Math.min(5_000, Math.floor(Number(limit) || 500)));
    if (!useMongo) {
      let repaired = 0;
      await mutate((store) => {
        store.cvProcessingJobs = store.cvProcessingJobs || [];
        for (const job of store.cvProcessingJobs) {
          if (repaired >= safeLimit || job.queueEventInitialized === true) continue;
          const transitions = Array.isArray(job.transitions) && job.transitions.length
            ? job.transitions
            : [appendTransition(job)].filter(Boolean);
          job.queueEventOutbox = transitions.map(copy);
          job.queueEventPending = job.queueEventOutbox.length > 0;
          job.queueEventInitialized = true;
          job.queueEventNextAttemptAt = job.updatedAt || job.createdAt || iso(operationTime());
          if (job.queueEventPending) delete job.expiresAt;
          repaired += 1;
        }
      });
      return repaired;
    }
    const collection = await mongoCollection();
    const rows = await collection.find(
      { queueEventInitialized: { $ne: true } },
      {
        projection: {
          publicId: 1,
          state: 1,
          stage: 1,
          progress: 1,
          attempts: 1,
          failureCount: 1,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
          lastError: 1,
          transitions: 1
        }
      }
    ).sort({ _id: 1 }).limit(safeLimit).toArray();
    if (!rows.length) return 0;
    await collection.bulkWrite(rows.map((row) => {
      const transitions = Array.isArray(row.transitions) && row.transitions.length
        ? row.transitions
        : [appendTransition(row)].filter(Boolean);
      return {
        updateOne: {
          filter: { publicId: row.publicId, queueEventInitialized: { $ne: true } },
          update: {
            $set: {
              queueEventOutbox: transitions,
              queueEventPending: transitions.length > 0,
              queueEventInitialized: true,
              queueEventNextAttemptAt: row.updatedAt || row.createdAt || iso(operationTime())
            },
            $unset: { queueEventLastError: '', expiresAt: '' }
          }
        }
      };
    }), { ordered: false });
    return rows.length;
  }

  async function listPendingQueueEventJobs({
    at = operationTime(),
    jobLimit = DEFAULT_QUEUE_EVENT_JOB_LIMIT,
    eventLimit = DEFAULT_QUEUE_EVENT_BATCH_SIZE
  } = {}) {
    const safeJobLimit = Math.max(1, Math.min(100, Math.floor(Number(jobLimit)
      || DEFAULT_QUEUE_EVENT_JOB_LIMIT)));
    const safeEventLimit = Math.max(1, Math.min(500, Math.floor(Number(eventLimit)
      || DEFAULT_QUEUE_EVENT_BATCH_SIZE)));
    const dueAt = iso(at);
    if (useMongo) {
      return (await mongoCollection()).find(
        {
          queueEventPending: true,
          queueEventNextAttemptAt: { $lte: dueAt }
        },
        {
          projection: {
            publicId: 1,
            state: 1,
            stage: 1,
            progress: 1,
            attempts: 1,
            failureCount: 1,
            organizationId: 1,
            actorId: 1,
            jobId: 1,
            createdAt: 1,
            startedAt: 1,
            completedAt: 1,
            failedAt: 1,
            updatedAt: 1,
            lastError: 1,
            queueEventFailureCount: 1,
            queueEventOutbox: { $slice: safeEventLimit }
          }
        }
      )
        .sort({ queueEventNextAttemptAt: 1, createdAt: 1 })
        .limit(safeJobLimit)
        .toArray();
    }
    const threshold = new Date(at).getTime();
    const store = await read();
    return copy((store.cvProcessingJobs || [])
      .filter((job) => (
        job.queueEventPending === true
        && new Date(job.queueEventNextAttemptAt || job.createdAt).getTime() <= threshold
      ))
      .sort((left, right) => (
        new Date(left.queueEventNextAttemptAt || left.createdAt)
          - new Date(right.queueEventNextAttemptAt || right.createdAt)
      ))
      .slice(0, safeJobLimit)
      .map((job) => ({
        ...job,
        queueEventOutbox: (job.queueEventOutbox || []).slice(0, safeEventLimit)
      })));
  }

  async function acknowledgeQueueEvents(publicId, throughSequence) {
    const acknowledgedThrough = Math.max(0, Math.floor(Number(throughSequence) || 0));
    const at = operationTime();
    if (!useMongo) {
      let acknowledged = null;
      await mutate((store) => {
        store.cvProcessingJobs = store.cvProcessingJobs || [];
        const job = store.cvProcessingJobs.find((item) => item.publicId === publicId);
        if (!job) return;
        job.queueEventOutbox = (job.queueEventOutbox || []).filter(
          (event) => Number(event.sequence || 0) > acknowledgedThrough
        );
        job.queueEventLastAckSequence = Math.max(
          Number(job.queueEventLastAckSequence ?? -1),
          acknowledgedThrough
        );
        job.queueEventPending = job.queueEventOutbox.length > 0;
        job.queueEventFailureCount = 0;
        delete job.queueEventLastError;
        if (job.queueEventPending) job.queueEventNextAttemptAt = iso(at);
        else delete job.queueEventNextAttemptAt;
        if (
          TERMINAL_STATES.includes(job.state)
          && !durableCleanupOutstanding(job)
          && !queueEventDeliveryOutstanding(job)
        ) {
          job.expiresAt = job.expiresAt || jsonExpiryAt(at);
        }
        acknowledged = copy(job);
      });
      return acknowledged;
    }
    const remainingEvents = {
      $filter: {
        input: { $cond: [{ $isArray: '$queueEventOutbox' }, '$queueEventOutbox', []] },
        as: 'event',
        cond: { $gt: [{ $ifNull: ['$$event.sequence', 0] }, acknowledgedThrough] }
      }
    };
    const collection = await mongoCollection();
    const result = await collection.findOneAndUpdate(
      { publicId },
      [
        {
          $set: {
            queueEventOutbox: remainingEvents,
            queueEventLastAckSequence: {
              $max: [{ $ifNull: ['$queueEventLastAckSequence', -1] }, acknowledgedThrough]
            },
            queueEventFailureCount: 0,
            queueEventLastError: '$$REMOVE'
          }
        },
        {
          $set: {
            queueEventPending: { $gt: [{ $size: '$queueEventOutbox' }, 0] },
            queueEventNextAttemptAt: {
              $cond: [
                { $gt: [{ $size: '$queueEventOutbox' }, 0] },
                literal(iso(at)),
                '$$REMOVE'
              ]
            },
            expiresAt: {
              $cond: [
                {
                  $and: [
                    { $in: ['$state', TERMINAL_STATES] },
                    { $not: [mongoDurableCleanupOutstanding()] },
                    { $eq: [{ $size: '$queueEventOutbox' }, 0] }
                  ]
                },
                { $ifNull: ['$expiresAt', literal(expiryAt(at))] },
                '$$REMOVE'
              ]
            }
          }
        }
      ],
      { returnDocument: 'after' }
    );
    return unwrapFindOneAndUpdate(result);
  }

  async function deferQueueEventJobs(publicIds, error, nextAttemptAt) {
    const ids = [...new Set((publicIds || []).filter(Boolean))].slice(0, 100);
    if (!ids.length) return 0;
    const message = String(error?.message || error || 'Queue event delivery failed').slice(0, 500);
    const retryAt = iso(nextAttemptAt || operationTime());
    if (!useMongo) {
      let deferred = 0;
      await mutate((store) => {
        store.cvProcessingJobs = store.cvProcessingJobs || [];
        for (const job of store.cvProcessingJobs) {
          if (!ids.includes(job.publicId) || job.queueEventPending !== true) continue;
          job.queueEventFailureCount = Number(job.queueEventFailureCount || 0) + 1;
          job.queueEventLastError = message;
          job.queueEventNextAttemptAt = retryAt;
          deferred += 1;
        }
      });
      return deferred;
    }
    const result = await (await mongoCollection()).updateMany(
      { publicId: { $in: ids }, queueEventPending: true },
      {
        $inc: { queueEventFailureCount: 1 },
        $set: {
          queueEventLastError: message,
          queueEventNextAttemptAt: retryAt
        }
      }
    );
    return Number(result.modifiedCount || 0);
  }

  async function recent(limit = 500) {
    if (useMongo) {
      return (await mongoCollection()).find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
    }
    const store = await read();
    return copy((store.cvProcessingJobs || [])
      .sort((left, right) => new Date(right.updatedAt || right.createdAt)
        - new Date(left.updatedAt || left.createdAt))
      .slice(0, limit));
  }

  async function telemetrySnapshot() {
    if (!useMongo) {
      const store = await read();
      const jobs = store.cvProcessingJobs || [];
      const stateCounts = {};
      for (const job of jobs) stateCounts[job.state] = Number(stateCounts[job.state] || 0) + 1;
      const oldest = jobs
        .filter((job) => ['queued', 'waiting_for_chatgpt'].includes(job.state))
        .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))[0];
      return {
        stateCounts,
        oldestQueuedAt: oldest?.createdAt || null,
        dispatchAttempts: jobs.reduce((sum, job) => sum + Number(job.attempts || 0), 0),
        realFailures: jobs.reduce((sum, job) => sum + Number(job.failureCount || 0), 0)
      };
    }
    const [snapshot = {}] = await (await mongoCollection()).aggregate([
      {
        $facet: {
          states: [{ $group: { _id: '$state', count: { $sum: 1 } } }],
          totals: [{
            $group: {
              _id: null,
              dispatchAttempts: { $sum: { $ifNull: ['$attempts', 0] } },
              realFailures: { $sum: { $ifNull: ['$failureCount', 0] } }
            }
          }],
          oldest: [
            { $match: { state: { $in: ['queued', 'waiting_for_chatgpt'] } } },
            { $sort: { createdAt: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, createdAt: 1 } }
          ]
        }
      }
    ]).toArray();
    return {
      stateCounts: Object.fromEntries((snapshot.states || []).map((item) => [item._id, item.count])),
      oldestQueuedAt: snapshot.oldest?.[0]?.createdAt || null,
      dispatchAttempts: Number(snapshot.totals?.[0]?.dispatchAttempts || 0),
      realFailures: Number(snapshot.totals?.[0]?.realFailures || 0)
    };
  }

  return {
    ACTIVE_STATES,
    TERMINAL_STATES,
    acknowledgeQueueEvents,
    appendTransition,
    beginAttempt,
    clearActiveExpirations,
    complete,
    countAhead,
    createOrGet,
    deferQueueEventJobs,
    finalizeTerminalExpiry,
    findByIdempotencyKey,
    findByPublicId,
    findCleanupPending,
    findRecoverable,
    listPendingQueueEventJobs,
    markDurableFileCleanupAttempt,
    markDurableFileCleanupFailed,
    markDurableFileReleased,
    maxFailures: safeMaxFailures,
    recent,
    recordDispatchError,
    recordFailure,
    recordInferenceAttempt,
    repairQueueEventOutbox,
    telemetrySnapshot,
    updateStage
  };
}

const repository = createCvProcessingJobRepository();

module.exports = {
  ...repository,
  ACTIVE_STATES,
  COLLECTION_NAME,
  DEFAULT_MAX_FAILURES,
  DEFAULT_QUEUE_EVENT_BATCH_SIZE,
  DEFAULT_QUEUE_EVENT_JOB_LIMIT,
  DEFAULT_TERMINAL_RETENTION_MS,
  TERMINAL_STATES,
  appendTransition,
  createCvProcessingJobRepository
};
