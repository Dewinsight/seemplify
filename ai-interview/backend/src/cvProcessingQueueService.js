const crypto = require('crypto');
const { DelayedError, Queue, Worker } = require('bullmq');
const cvParsingService = require('./cvParsingService');
const durableCvFileStore = require('./durableCvFileStore');
const cvProcessingJobs = require('./cvProcessingJobRepository');
const defaultCleanupTasks = require('./cvStorageCleanupTaskRepository');
const { buildSignature } = require('./llmClient');
const { id, iso } = require('./store');
const {
  createGlobalDispatchConnection,
  createGlobalDispatchCoordinator,
  createGlobalDispatchInferenceRunner,
  resolveGlobalDispatchConfig
} = require('./cvGlobalDispatch');

const QUEUE_NAME = 'ai-interview-cv-analysis-local';
const QUEUE_EVENT_PATH = '/api/internal/ai/v1/cv-queue/events';
const redisHost = process.env.AI_INTERVIEW_REDIS_HOST
  || process.env.REDIS_HOST
  || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const redisPort = Number(process.env.AI_INTERVIEW_REDIS_PORT || process.env.REDIS_PORT || 6379);
const redisEnabled = process.env.AI_INTERVIEW_CV_QUEUE_ENABLED
  ? process.env.AI_INTERVIEW_CV_QUEUE_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.AI_INTERVIEW_REDIS_HOST || process.env.REDIS_HOST);
const requestedConcurrency = Math.max(1, Number(process.env.AI_INTERVIEW_CV_QUEUE_CONCURRENCY || 1));
const approvedConcurrency = Math.max(1, Number(
  process.env.AI_INTERVIEW_CV_QUEUE_APPROVED_CONCURRENCY
  || process.env.CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY
  || 1
));
const globalApprovedConcurrency = Math.max(
  1,
  Number(process.env.CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY || 1)
);
const defaultConcurrency = Math.min(requestedConcurrency, approvedConcurrency);
const globalDispatchConfig = resolveGlobalDispatchConfig({
  enabled: redisEnabled,
  serviceId: 'ai-interview',
  defaultApprovedLimit: globalApprovedConcurrency,
  legacyRedis: {
    host: process.env.REDIS_HOST || redisHost,
    port: process.env.REDIS_PORT || redisPort
  }
});
const connection = redisEnabled
  ? createGlobalDispatchConnection(globalDispatchConfig, {
    connectionName: 'cv-analysis-queue:ai-interview',
    enableReadyCheck: false
  })
  : null;
const globalDispatchConnection = redisEnabled
  ? createGlobalDispatchConnection(globalDispatchConfig)
  : null;
const GLOBAL_DISPATCH_KEY_PREFIX = globalDispatchConfig.contract.keyPrefix;
const GLOBAL_DISPATCH_POLL_MS = globalDispatchConfig.pollMs;
const CLEANUP_RETRY_BASE_MS = Math.max(
  1_000,
  Number(process.env.AI_INTERVIEW_CV_CLEANUP_RETRY_BASE_MS || 30_000)
);
const CLEANUP_RETRY_MAX_MS = Math.max(
  CLEANUP_RETRY_BASE_MS,
  Number(process.env.AI_INTERVIEW_CV_CLEANUP_RETRY_MAX_MS || 60 * 60 * 1000)
);
const QUEUE_EVENT_BATCH_SIZE = Math.max(
  1,
  Math.min(100, Number(process.env.AI_INTERVIEW_CV_EVENT_BATCH_SIZE || 100))
);
const QUEUE_EVENT_JOB_LIMIT = Math.max(
  1,
  Math.min(50, Number(process.env.AI_INTERVIEW_CV_EVENT_JOB_LIMIT || 25))
);
const QUEUE_EVENT_RETRY_BASE_MS = Math.max(
  250,
  Number(process.env.AI_INTERVIEW_CV_EVENT_RETRY_BASE_MS || 1_000)
);
const QUEUE_EVENT_RETRY_MAX_MS = Math.max(
  QUEUE_EVENT_RETRY_BASE_MS,
  Number(process.env.AI_INTERVIEW_CV_EVENT_RETRY_MAX_MS || 5 * 60_000)
);

let queue;
let worker;
let completionHandler;
let analyzeResume = (resumeText, context, options) => cvParsingService.analyzeResumeText(
  resumeText,
  context,
  options
);
let cleanupTasks = defaultCleanupTasks;
let maintenanceTimer;
let dispatchControlTimer;

function cleanupRetryDelay(attempts) {
  const exponent = Math.max(0, Math.min(10, Number(attempts || 1) - 1));
  return Math.min(CLEANUP_RETRY_MAX_MS, CLEANUP_RETRY_BASE_MS * (2 ** exponent));
}
let retryTimer;
let eventDebounceTimer;
let eventHeartbeatTimer;
let eventFlushPromise;

function normalizedDispatchLimit(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

const globalDispatch = createGlobalDispatchCoordinator({
  redis: globalDispatchConnection,
  serviceId: 'ai-interview',
  config: globalDispatchConfig
});
const bypassDispatchInferenceRunner = async (_bullJob, _workerToken, operation) => operation({
  signal: undefined,
  permit: null
});
const defaultDispatchInferenceRunner = globalDispatchConnection
  ? createGlobalDispatchInferenceRunner({
    coordinator: globalDispatch,
    retryDelayMs: GLOBAL_DISPATCH_POLL_MS,
    DelayedErrorType: DelayedError
  })
  : bypassDispatchInferenceRunner;
let runInferenceWithGlobalPermit = defaultDispatchInferenceRunner;

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function deterministicStatusToken(organizationId, idempotencyKey) {
  const secret = String(
    process.env.AI_INTERVIEW_CV_STATUS_TOKEN_SECRET
    || process.env.JWT_SECRET
    || 'development-only-ai-interview-cv-status-secret'
  );
  return crypto.createHmac('sha256', secret)
    .update(`${organizationId}:${idempotencyKey}`)
    .digest('base64url');
}

function isOfflineError(error) {
  const code = String(error?.code || '');
  return code === 'AI_LOCAL_UNAVAILABLE'
    || code === 'AI_LOCAL_NOT_CONFIGURED'
    || code === 'LLM_NOT_CONFIGURED'
    || code === 'LLM_REQUEST_FAILED'
    || code.startsWith('LOCAL_LLM_')
    || /local cv runtime|local[- ]llm|ollama|vllm|codex|gateway could not be reached|fetch failed|request deadline/i
      .test(String(error?.message || ''));
}

function backoffDelay(attemptsMade, error) {
  const exponent = Math.max(0, Math.min(10, Number(attemptsMade || 1) - 1));
  const delay = 30_000 * (2 ** exponent);
  return Math.min(delay, isOfflineError(error) ? 5 * 60_000 : 10 * 60_000);
}

function publicState(job) {
  return {
    jobId: job.publicId,
    state: job.state,
    stage: job.stage || null,
    progress: Number(job.progress || 0),
    position: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    attempts: Math.max(0, Number(job.attempts || 0)),
    failureCount: Math.max(0, Number(job.failureCount || 0)),
    candidateId: job.result?.candidate?._id || job.candidateId || null,
    error: job.state === 'failed' ? job.lastError : undefined,
    ...(job.state === 'completed' && job.result ? job.result : {})
  };
}

function queueEventUrl() {
  const configured = String(
    process.env.SEEMPLIFY_AI_GATEWAY_URL
      || process.env.SEEMPLIFY_PLATFORM_API_URL
      || 'https://api.seemplifyai.com'
  ).trim().replace(/\/+$/, '');
  const completionPath = '/api/internal/ai/v1/complete';
  const baseUrl = configured.endsWith(completionPath)
    ? configured.slice(0, -completionPath.length)
    : configured;
  return `${baseUrl}${QUEUE_EVENT_PATH}`;
}

function operationalQueueEvent(job, transition = null, sequence = null) {
  const state = transition?.state || job.state;
  const updatedAt = transition?.at || job.updatedAt || job.createdAt;
  return {
    publicId: String(job.publicId || ''),
    state: String(state || 'queued'),
    stage: String(transition?.stage || job.stage || '').slice(0, 40) || null,
    progress: Math.min(100, Math.max(0, Number(transition?.progress ?? job.progress ?? 0))),
    attempts: Math.max(0, Number(transition?.attempts ?? job.attempts ?? 0)),
    failureCount: Math.max(0, Number(transition?.failureCount ?? job.failureCount ?? 0)),
    organizationId: String(job.organizationId || '').slice(0, 200),
    actorId: String(job.actorId || '').slice(0, 200),
    jobId: String(job.jobId || '').slice(0, 200),
    createdAt: job.createdAt,
    startedAt: state === 'queued' ? null : job.startedAt || null,
    completedAt: state === 'completed' ? job.completedAt || updatedAt : null,
    failedAt: state === 'failed' ? job.failedAt || updatedAt : null,
    updatedAt,
    sequence: Math.max(0, Number(transition?.sequence ?? sequence ?? 0)),
    errorCode: transition ? transition.errorCode || null : job.lastError?.code || null
  };
}

function scheduleQueueEventFlush(delayMs = 25) {
  if (eventDebounceTimer) return;
  eventDebounceTimer = setTimeout(() => {
    eventDebounceTimer = null;
    void flushQueueEvents().catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
  eventDebounceTimer.unref?.();
}

function retainQueueEvent(job) {
  if (!job?.publicId) return;
  scheduleQueueEventFlush();
}

async function retainStoredQueueEvent(publicId) {
  if (publicId) scheduleQueueEventFlush();
}

function queueEventRetryDelay(failureCount) {
  const exponent = Math.max(0, Math.min(12, Number(failureCount || 0)));
  return Math.min(QUEUE_EVENT_RETRY_MAX_MS, QUEUE_EVENT_RETRY_BASE_MS * (2 ** exponent));
}

function queuedOperationalEvents(jobs, limit = QUEUE_EVENT_BATCH_SIZE) {
  const events = [];
  for (const job of jobs) {
    const transitions = [...(job.queueEventOutbox || [])]
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    for (const transition of transitions) {
      if (events.length >= limit) return events;
      events.push(operationalQueueEvent(job, transition));
    }
  }
  return events;
}

async function deliverQueueEventBatch({
  repository = cvProcessingJobs,
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  secret = String(process.env.AI_GATEWAY_HMAC_SECRET || ''),
  url = queueEventUrl(),
  serviceId = String(process.env.AI_GATEWAY_SERVICE_ID || 'ai-interview'),
  now = () => Date.now(),
  schedule = scheduleQueueEventFlush,
  batchSize = QUEUE_EVENT_BATCH_SIZE,
  jobLimit = QUEUE_EVENT_JOB_LIMIT
} = {}) {
  if (!secret || typeof fetchImpl !== 'function') return false;
  const sampledAt = new Date(now());
  const sampledAtMs = sampledAt.getTime();
  await repository.repairQueueEventOutbox(500);
  const pendingJobs = await repository.listPendingQueueEventJobs({
    at: sampledAt,
    jobLimit,
    eventLimit: batchSize
  });
  const events = queuedOperationalEvents(pendingJobs, batchSize);
  if (!events.length) return true;
  const body = JSON.stringify(events.length === 1 ? { job: events[0] } : { jobs: events });
  const timestamp = String(sampledAtMs);
  const signature = buildSignature({
    timestamp,
    serviceId,
    path: new URL(url).pathname,
    body,
    secret
  });
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-service': serviceId,
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-signature': signature
      },
      body,
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined
    });
  } catch (error) {
    const failureCount = Math.max(
      0,
      ...pendingJobs.map((job) => Number(job.queueEventFailureCount || 0))
    );
    const delay = queueEventRetryDelay(failureCount);
    await repository.deferQueueEventJobs(
      pendingJobs.map((job) => job.publicId),
      error,
      new Date(sampledAtMs + delay)
    );
    schedule(delay);
    return false;
  }
  if (!response.ok) {
    const error = new Error(`CV queue event endpoint returned HTTP ${response.status}`);
    const failureCount = Math.max(
      0,
      ...pendingJobs.map((job) => Number(job.queueEventFailureCount || 0))
    );
    const delay = queueEventRetryDelay(failureCount);
    await repository.deferQueueEventJobs(
      pendingJobs.map((job) => job.publicId),
      error,
      new Date(sampledAtMs + delay)
    );
    schedule(delay);
    return false;
  }
  const acknowledgedByJob = new Map();
  for (const event of events) {
    acknowledgedByJob.set(
      event.publicId,
      Math.max(Number(acknowledgedByJob.get(event.publicId) ?? -1), Number(event.sequence || 0))
    );
  }
  await Promise.all([...acknowledgedByJob].map(([publicId, sequence]) => (
    repository.acknowledgeQueueEvents(publicId, sequence)
  )));
  if (events.length >= batchSize) schedule(0);
  return true;
}

async function flushQueueEvents() {
  if (eventFlushPromise) return eventFlushPromise;
  eventFlushPromise = deliverQueueEventBatch();
  try {
    return await eventFlushPromise;
  } finally {
    eventFlushPromise = null;
  }
}

async function startQueueEventPublisher({
  repository = cvProcessingJobs,
  schedule = scheduleQueueEventFlush,
  flush = flushQueueEvents,
  setIntervalImpl = setInterval
} = {}) {
  await repository.repairQueueEventOutbox(500);
  schedule(0);
  if (!eventHeartbeatTimer) {
    eventHeartbeatTimer = setIntervalImpl(() => {
      void flush().catch(() => {});
    }, 5_000);
    eventHeartbeatTimer.unref?.();
  }
}

async function ensureConnection() {
  if (!connection) {
    const error = new Error('AI Interview CV queue is disabled');
    error.code = 'CV_QUEUE_DISABLED';
    throw error;
  }
  if (connection.status === 'wait') await connection.connect();
}

async function getQueue() {
  await ensureConnection();
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

async function applyGlobalDispatchState(state) {
  const queueInstance = await getQueue();
  const currentlyPaused = await queueInstance.isPaused();
  if (state.paused && !currentlyPaused) await queueInstance.pause();
  if (!state.paused && currentlyPaused) await queueInstance.resume();
  if (worker) {
    worker.concurrency = Math.max(1, Math.min(
      normalizedDispatchLimit(state.limit),
      approvedConcurrency
    ));
  }
  return state;
}

async function synchronizeGlobalDispatchControl({ limit, paused } = {}) {
  if (limit !== undefined) await globalDispatch.setLimit(limit);
  if (paused !== undefined) await globalDispatch.setPaused(paused === true);
  return applyGlobalDispatchState(await globalDispatch.state());
}

async function addQueueJob(job) {
  const queueInstance = await getQueue();
  const jobsAhead = await cvProcessingJobs.countAhead(job.organizationId, job.createdAt);
  return queueInstance.add('analyze-ai-interview-cv', { processingJobId: job.publicId }, {
    jobId: job.publicId,
    attempts: 2_147_483_647,
    backoff: { type: 'cv-runtime', delay: 30_000 },
    priority: Math.min(2_097_152, jobsAhead + 1),
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 }
  });
}

async function submit({ file, organizationId, actorId, jobId, candidateId, mode, idempotencyKey }) {
  if (!file?.buffer?.length) {
    const error = new Error('Upload a CV file.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedKey = String(idempotencyKey || '').trim() || null;
  const statusToken = normalizedKey
    ? deterministicStatusToken(organizationId, normalizedKey)
    : crypto.randomBytes(32).toString('base64url');
  if (normalizedKey) {
    const existing = await cvProcessingJobs.findByIdempotencyKey(organizationId, normalizedKey);
    if (existing) return { job: existing, statusToken, duplicate: true };
  }

  let durableFile;
  try {
    durableFile = await durableCvFileStore.persistBuffer(file.buffer, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      organizationId
    });
  } catch (error) {
    if (error.cleanupReference) {
      await cleanupWithOutbox(error.cleanupReference, {
        reason: 'durable-persistence-failed'
      }).catch((cleanupError) => {
        error.cleanupError = error.cleanupError || cleanupError;
      });
    }
    throw error;
  }
  let creation;
  try {
    const now = iso(new Date());
    creation = await cvProcessingJobs.createOrGet({
        _id: id('cvjob'),
        publicId: `aicv_${crypto.randomUUID()}`,
        statusTokenHash: tokenHash(statusToken),
        idempotencyKey: normalizedKey,
        state: 'queued',
        stage: 'ingesting',
        progress: 5,
        attempts: 0,
        failureCount: 0,
        organizationId,
        actorId,
        jobId,
        candidateId: candidateId || null,
        mode,
        originalName: String(file.originalname || 'cv').slice(0, 255),
        mimeType: String(file.mimetype || 'application/octet-stream').slice(0, 127),
        fileSize: Number(file.size || file.buffer.length),
        durableFile: {
          ...durableFile,
          cleanupState: 'retained',
          cleanupAttempts: 0
        },
        createdAt: now,
        updatedAt: now
    });
  } catch (error) {
    await cleanupWithOutbox(durableFile, {
      reason: 'job-persistence-failed'
    }).catch((cleanupError) => {
      error.cleanupError = error.cleanupError || cleanupError;
    });
    throw error;
  }
  const processingJob = creation.job;
  const duplicate = !creation.created;
  if (duplicate) {
    await cleanupWithOutbox(durableFile, {
      reason: 'idempotency-race-loser'
    }).catch((error) => {
      console.error('AI Interview orphaned duplicate CV cleanup deferred:', error.message);
    });
  }

  if (!duplicate) {
    try {
      await addQueueJob(processingJob);
    } catch (error) {
      await cvProcessingJobs.recordDispatchError(processingJob.publicId, error);
    }
  }
  await retainStoredQueueEvent(processingJob.publicId);

  return {
    job: processingJob,
    statusToken,
    duplicate
  };
}

async function updateStoredStage(processingJob, bullJob, stage, progress) {
  const updated = await cvProcessingJobs.updateStage(processingJob.publicId, stage, progress);
  if (!updated) return false;
  Object.assign(processingJob, updated);
  await bullJob.updateProgress(progress);
  retainQueueEvent(updated);
  return true;
}

async function executeCleanupTask(task) {
  if (!task || task.state === 'completed') return true;
  const attempted = await cleanupTasks.beginAttempt(task.key);
  if (!attempted || attempted.state === 'completed') return true;
  const attempts = Number(attempted.attempts || 1);
  try {
    await durableCvFileStore.remove(attempted.resource);
    await cleanupTasks.complete(attempted.key);
    return true;
  } catch (error) {
    await cleanupTasks.fail(
      attempted.key,
      error,
      new Date(Date.now() + cleanupRetryDelay(attempts))
    );
    throw error;
  }
}

async function cleanupWithOutbox(reference, context = {}) {
  const task = await cleanupTasks.schedule(reference, context);
  await executeCleanupTask(task);
  return true;
}

async function releaseDurableFile(processingJob) {
  if (!processingJob.durableFile || processingJob.durableFile.releasedAt) {
    await cvProcessingJobs.finalizeTerminalExpiry(processingJob.publicId);
    return false;
  }
  const attemptedAt = iso(new Date());
  const attempted = await cvProcessingJobs.markDurableFileCleanupAttempt(
    processingJob.publicId,
    attemptedAt
  );
  if (attempted?.durableFile) processingJob.durableFile = attempted.durableFile;
  try {
    await cleanupWithOutbox(processingJob.durableFile, {
      reason: 'terminal-job-durable-file',
      ownerPublicId: processingJob.publicId
    });
  } catch (error) {
    const attempts = Number(processingJob.durableFile.cleanupAttempts || 1);
    const failed = await cvProcessingJobs.markDurableFileCleanupFailed(
      processingJob.publicId,
      error,
      new Date(Date.now() + cleanupRetryDelay(attempts))
    );
    if (failed?.durableFile) processingJob.durableFile = failed.durableFile;
    throw error;
  }
  const releasedAt = iso(new Date());
  const released = await cvProcessingJobs.markDurableFileReleased(
    processingJob.publicId,
    releasedAt
  );
  if (released?.durableFile) processingJob.durableFile = released.durableFile;
  else processingJob.durableFile.releasedAt = releasedAt;
  return true;
}

async function processJob(bullJob, workerToken) {
  const processingJob = await cvProcessingJobs.beginAttempt(
    bullJob.data.processingJobId,
    { countInference: false }
  );
  if (!processingJob) {
    return { skipped: true };
  }
  retainQueueEvent(processingJob);

  try {
    if (typeof completionHandler !== 'function') {
      const error = new Error('AI Interview CV queue completion handler is not configured');
      error.code = 'CV_QUEUE_NOT_CONFIGURED';
      throw error;
    }
    if (!processingJob.resumeText) {
      await updateStoredStage(processingJob, bullJob, 'extracting', 25);
      const buffer = await durableCvFileStore.readBuffer(processingJob.durableFile);
      const resumeText = await cvParsingService.extractText({
        buffer,
        originalname: processingJob.originalName,
        mimetype: processingJob.mimeType,
        size: processingJob.fileSize
      });
      if (!resumeText || resumeText.trim().length < 50) {
        const error = new Error('Could not extract enough text from this CV. Upload a text-based PDF/DOCX or enter the candidate manually.');
        error.code = 'CV_TEXT_EXTRACTION_FAILED';
        throw error;
      }
      const updated = await cvProcessingJobs.updateStage(
        processingJob.publicId,
        'analyzing',
        50,
        { resumeText }
      );
      if (!updated) return { skipped: true };
      Object.assign(processingJob, updated);
    }
    await updateStoredStage(processingJob, bullJob, 'analyzing', 50);
    const parsed = await runInferenceWithGlobalPermit(
      bullJob,
      workerToken,
      async ({ signal }) => {
        const attempted = await cvProcessingJobs.recordInferenceAttempt(processingJob.publicId);
        if (attempted) Object.assign(processingJob, attempted);
        return analyzeResume(processingJob.resumeText, {
          organizationId: processingJob.organizationId,
          actorId: processingJob.actorId,
          jobId: processingJob.jobId,
          candidateId: processingJob.candidateId,
          requestId: `ai-interview-cv-queue:${processingJob.publicId}`,
          usageExecutionId: `ai-interview-cv-queue:${processingJob.publicId}:attempt:${Math.max(1, Number(processingJob.attempts || 1))}`
        }, { signal });
      },
      async ({ reason, error }) => {
        const waitError = error || Object.assign(
          new Error(`CV inference is waiting for shared dispatch capacity (${reason || 'waiting'})`),
          {
            code: `CV_GLOBAL_DISPATCH_${String(reason || 'WAITING').toUpperCase().replace(/-/g, '_')}`
          }
        );
        const waiting = await cvProcessingJobs.recordFailure(processingJob.publicId, waitError, {
          unmetered: true,
          retryState: 'waiting_for_local_runtime'
        });
        if (waiting.job) Object.assign(processingJob, waiting.job);
        await retainStoredQueueEvent(processingJob.publicId);
      }
    );
    await updateStoredStage(processingJob, bullJob, 'finalizing', 80);
    const result = await completionHandler(processingJob, parsed);
    const completedJob = await cvProcessingJobs.complete(
      processingJob.publicId,
      result,
      result?.candidate?._id || processingJob.candidateId || null
    );
    if (!completedJob) {
      const error = new Error('AI Interview CV processing job could not be completed from its current state');
      error.code = 'CV_JOB_COMPLETION_CONFLICT';
      throw error;
    }
    Object.assign(processingJob, completedJob);
    await releaseDurableFile(processingJob).catch((error) => {
      console.error('AI Interview durable CV cleanup failed:', error.message);
    });
    await bullJob.updateProgress(100);
    await retainStoredQueueEvent(processingJob.publicId);
    return {
      jobId: processingJob.publicId,
      candidateId: result?.candidate?._id || processingJob.candidateId || null
    };
  } catch (error) {
    if (error instanceof DelayedError || String(error?.code || '').startsWith('CV_GLOBAL_DISPATCH_')) {
      throw error;
    }
    const runtimeWait = isOfflineError(error);
    const failure = await cvProcessingJobs.recordFailure(processingJob.publicId, error, {
      unmetered: runtimeWait,
      retryState: runtimeWait ? 'waiting_for_local_runtime' : 'queued'
    });
    if (failure.job) Object.assign(processingJob, failure.job);
    if (failure.terminal) {
      await releaseDurableFile(failure.job || processingJob).catch((cleanupError) => {
        console.error('AI Interview durable CV cleanup after terminal failure failed:', cleanupError.message);
      });
    }
    await retainStoredQueueEvent(processingJob.publicId);
    if (failure.terminal) bullJob.discard();
    throw error;
  }
}

async function retryStorageCleanup({
  now = new Date(),
  limit = 100
} = {}) {
  const dueTasks = await cleanupTasks.findDue(now, limit);
  let tasksCompleted = 0;
  for (const task of dueTasks) {
    try {
      await executeCleanupTask(task);
      tasksCompleted += 1;
    } catch {}
  }
  const pendingJobs = await cvProcessingJobs.findCleanupPending(now, limit);
  let jobsFinalized = 0;
  for (const job of pendingJobs) {
    try {
      await releaseDurableFile(job);
      jobsFinalized += 1;
    } catch {}
  }
  await cleanupTasks.pruneCompleted(now);
  return { tasksCompleted, jobsFinalized };
}

async function recoverStaleJobs() {
  const queueInstance = await getQueue();
  const pending = await cvProcessingJobs.findRecoverable(new Date(Date.now() - 60_000), 500);
  let recovered = 0;
  for (const job of pending) {
    if (!await queueInstance.getJob(job.publicId)) {
      await addQueueJob(job);
      recovered += 1;
    }
  }
  return recovered;
}

async function getStatus(publicId, statusToken, actorId) {
  const job = await cvProcessingJobs.findByPublicId(publicId);
  if (!job || !statusToken || !hashesMatch(tokenHash(statusToken), job.statusTokenHash)) return null;
  if (actorId && job.actorId && actorId !== job.actorId) return null;
  const result = publicState(job);
  if (['queued', 'waiting_for_local_runtime'].includes(job.state)) {
    try {
      const queueInstance = await getQueue();
      const waiting = await queueInstance.getJobs(['prioritized', 'waiting', 'delayed'], 0, 5000, true);
      const index = waiting.findIndex((item) => item.id === publicId);
      result.position = index >= 0 ? index + 1 : null;
      result.queueAvailable = true;
    } catch {
      result.queueAvailable = false;
    }
  }
  return result;
}

async function telemetry() {
  const durable = await cvProcessingJobs.telemetrySnapshot();
  try {
    const queueInstance = await getQueue();
    const [counts, paused, dispatchState] = await Promise.all([
      queueInstance.getJobCounts('prioritized', 'waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
      queueInstance.isPaused(),
      globalDispatch.state()
    ]);
    counts.waitingTotal = Number(counts.waiting || 0) + Number(counts.prioritized || 0);
    return {
      queue: QUEUE_NAME,
      available: true,
      concurrency: Number(worker?.concurrency || defaultConcurrency),
      counts,
      oldestQueuedAt: durable.oldestQueuedAt,
      dispatchAttempts: durable.dispatchAttempts,
      realFailures: durable.realFailures,
      paused: paused || dispatchState.paused === true,
      dispatch: {
        ...dispatchState,
        scope: GLOBAL_DISPATCH_KEY_PREFIX,
        protocol: globalDispatchConfig.contract.protocol,
        identity: globalDispatchConfig.contract.identity,
        approvedLimit: globalDispatchConfig.contract.approvedLimit,
        fingerprint: globalDispatchConfig.contract.fingerprint,
        redisEndpoint: globalDispatchConfig.redisEndpoint,
        redisSource: globalDispatchConfig.redisSource,
        ...globalDispatch.health()
      }
    };
  } catch (error) {
    return {
      queue: QUEUE_NAME,
      available: false,
      concurrency: Number(worker?.concurrency || defaultConcurrency),
      counts: {
        prioritized: 0,
        waiting: Number(durable.stateCounts.queued || 0)
          + Number(durable.stateCounts.waiting_for_local_runtime || 0),
        waitingTotal: Number(durable.stateCounts.queued || 0)
          + Number(durable.stateCounts.waiting_for_local_runtime || 0),
        active: Number(durable.stateCounts.processing || 0),
        completed: Number(durable.stateCounts.completed || 0),
        failed: Number(durable.stateCounts.failed || 0)
      },
      oldestQueuedAt: durable.oldestQueuedAt,
      dispatchAttempts: durable.dispatchAttempts,
      realFailures: durable.realFailures,
      paused: false,
      error: error.message,
      dispatch: {
        scope: GLOBAL_DISPATCH_KEY_PREFIX,
        protocol: globalDispatchConfig.contract.protocol,
        identity: globalDispatchConfig.contract.identity,
        approvedLimit: globalDispatchConfig.contract.approvedLimit,
        fingerprint: globalDispatchConfig.contract.fingerprint,
        redisEndpoint: globalDispatchConfig.redisEndpoint,
        redisSource: globalDispatchConfig.redisSource,
        ...globalDispatch.health()
      }
    };
  }
}

async function init({ onCompleted, analyze } = {}) {
  if (onCompleted) completionHandler = onCompleted;
  if (analyze) analyzeResume = analyze;
  if (worker) return worker;
  await cvProcessingJobs.clearActiveExpirations();
  await startQueueEventPublisher();
  await retryStorageCleanup().catch((error) => {
    console.error('AI Interview CV storage cleanup recovery failed:', error.message);
  });
  if (!maintenanceTimer) {
    maintenanceTimer = setInterval(() => {
      void retryStorageCleanup().catch((error) => {
        console.error('AI Interview CV storage cleanup retry failed:', error.message);
      });
      void cvProcessingJobs.repairQueueEventOutbox(500)
        .then((repaired) => {
          if (repaired > 0) scheduleQueueEventFlush(0);
        })
        .catch((error) => {
          console.error('AI Interview CV event outbox repair failed:', error.message);
        });
      if (connection) void recoverStaleJobs().catch(() => {});
    }, 30_000);
    maintenanceTimer.unref?.();
  }
  if (!connection) return worker;
  globalDispatch.open();
  let startupDispatchState;
  try {
    await getQueue();
    startupDispatchState = await globalDispatch.initialize();
    await applyGlobalDispatchState(startupDispatchState);
  } catch (error) {
    if (!retryTimer) {
      retryTimer = setInterval(() => void init().catch(() => {}), 30_000);
      retryTimer.unref?.();
    }
    throw error;
  }
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: Math.max(1, Math.min(defaultConcurrency, startupDispatchState.limit)),
    settings: {
      backoffStrategy: (attemptsMade, type, error) => {
        if (type !== 'cv-runtime') throw new Error(`Unsupported AI Interview CV backoff type: ${type}`);
        return backoffDelay(attemptsMade, error);
      }
    }
  });
  worker.on('error', (error) => console.error('AI Interview CV worker error:', error.message));
  await recoverStaleJobs();
  if (!dispatchControlTimer) {
    dispatchControlTimer = setInterval(() => {
      void synchronizeGlobalDispatchControl().catch(() => {});
    }, 1_000);
    dispatchControlTimer.unref?.();
  }
  return worker;
}

async function setPaused(paused) {
  await synchronizeGlobalDispatchControl({ paused: paused === true });
  return telemetry();
}

function setDispatchInferenceRunnerForTests(runner) {
  runInferenceWithGlobalPermit = runner || defaultDispatchInferenceRunner;
}

async function closeForTests() {
  globalDispatch.beginShutdown();
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  if (dispatchControlTimer) clearInterval(dispatchControlTimer);
  dispatchControlTimer = null;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  if (eventDebounceTimer) clearTimeout(eventDebounceTimer);
  eventDebounceTimer = null;
  if (eventHeartbeatTimer) clearInterval(eventHeartbeatTimer);
  eventHeartbeatTimer = null;
  eventFlushPromise = null;
  if (worker) await worker.close();
  worker = null;
  await globalDispatch.releaseAll();
  if (queue) await queue.close();
  queue = null;
  if (connection && connection.status !== 'end') await connection.quit();
  if (globalDispatchConnection && globalDispatchConnection.status !== 'end') {
    await globalDispatchConnection.quit();
  }
  runInferenceWithGlobalPermit = defaultDispatchInferenceRunner;
}

module.exports = {
  _processJobForTests: processJob,
  _retryStorageCleanupForTests: retryStorageCleanup,
  _createGlobalDispatchCoordinator: createGlobalDispatchCoordinator,
  _createGlobalDispatchInferenceRunner: createGlobalDispatchInferenceRunner,
  _deliverQueueEventBatchForTests: deliverQueueEventBatch,
  _globalDispatchConfig: globalDispatchConfig,
  _setDispatchInferenceRunnerForTests: setDispatchInferenceRunnerForTests,
  _startQueueEventPublisherForTests: startQueueEventPublisher,
  _queuedOperationalEventsForTests: queuedOperationalEvents,
  QUEUE_NAME,
  backoffDelay,
  closeForTests,
  deterministicStatusToken,
  appendTransition: cvProcessingJobs.appendTransition,
  flushQueueEvents,
  getStatus,
  init,
  isOfflineError,
  publicState,
  queueEventRetryDelay,
  setPaused,
  submit,
  telemetry,
  tokenHash
};
