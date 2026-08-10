const crypto = require('crypto');
const { DelayedError, Queue, Worker } = require('bullmq');
const cvParsingService = require('./cvParsingService');
const durableCvFileStore = require('./durableCvFileStore');
const cvProcessingJobs = require('./cvProcessingJobRepository');
const cvProcessingIntakes = require('./cvProcessingIntakeRepository');
const defaultCleanupTasks = require('./cvStorageCleanupTaskRepository');
const { deterministicCvCandidateId } = require('./cvCandidateIdempotency');
const { buildSignature } = require('./llmClient');
const { id, iso } = require('./store');
const {
  createGlobalDispatchConnection,
  createGlobalDispatchCoordinator,
  createGlobalDispatchInferenceRunner,
  resolveGlobalDispatchConfig
} = require('./cvGlobalDispatch');

const QUEUE_NAME = 'ai-interview-cv-analysis-chatgpt';
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
const MAX_FAST_FAILURE_ATTEMPTS = 5;
const DEFERRED_RETRY_BASE_MS = Math.max(
  60_000,
  Number(process.env.AI_INTERVIEW_CV_DEFERRED_RETRY_BASE_MS || process.env.CV_DEFERRED_RETRY_BASE_MS || 30 * 60 * 1000)
);
const DEFERRED_RETRY_MAX_MS = Math.max(
  DEFERRED_RETRY_BASE_MS,
  Number(process.env.AI_INTERVIEW_CV_DEFERRED_RETRY_MAX_MS || process.env.CV_DEFERRED_RETRY_MAX_MS || 6 * 60 * 60 * 1000)
);
const ORPHAN_GRACE_MS = Math.max(
  60_000,
  Number(process.env.AI_INTERVIEW_CV_ORPHAN_GRACE_MS) || 15 * 60 * 1000
);
const ORPHAN_SWEEP_BATCH_SIZE = Math.max(
  1,
  Math.min(5_000, Number(process.env.AI_INTERVIEW_CV_ORPHAN_SWEEP_BATCH_SIZE) || 500)
);
const INTAKE_CONTENTION_WAIT_MS = Math.max(
  1_000,
  Number(process.env.AI_INTERVIEW_CV_INTAKE_CONTENTION_WAIT_MS) || 30_000
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
let afterDurablePersistForTests = null;
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

function deterministicStatusToken(organizationId, actorId, idempotencyKey) {
  // The two-argument form preserves status recovery for jobs created before
  // actor-scoped idempotency was introduced.
  const scoped = idempotencyKey !== undefined;
  const key = scoped ? idempotencyKey : actorId;
  const actor = scoped ? actorId : null;
  const secret = String(
    process.env.AI_INTERVIEW_CV_STATUS_TOKEN_SECRET
    || process.env.JWT_SECRET
    || 'development-only-ai-interview-cv-status-secret'
  );
  return crypto.createHmac('sha256', secret)
    .update(scoped ? `${organizationId}:${actor}:${key}` : `${organizationId}:${key}`)
    .digest('base64url');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function requestFingerprint({ mode, jobId, candidateId = null, fileSha256 }) {
  const canonical = JSON.stringify({
    mode: String(mode || ''),
    jobId: String(jobId || ''),
    candidateId: candidateId ? String(candidateId) : null,
    fileSha256: String(fileSha256 || '').toLowerCase()
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function storedRequestFingerprint(job) {
  if (job?.requestFingerprint) return String(job.requestFingerprint);
  const fileSha256 = job?.durableFile?.sha256 || job?.fileSha256;
  if (!fileSha256) return null;
  return requestFingerprint({
    mode: job.mode,
    jobId: job.jobId,
    candidateId: job.candidateId || null,
    fileSha256
  });
}

function idempotencyConflict() {
  const error = new Error('This idempotency key was already used for a different CV request.');
  error.code = 'CV_IDEMPOTENCY_CONFLICT';
  error.statusCode = 409;
  return error;
}

function idempotencyRequired() {
  const error = new Error('A nonblank Idempotency-Key header is required for CV uploads.');
  error.code = 'CV_IDEMPOTENCY_KEY_REQUIRED';
  error.statusCode = 400;
  return error;
}

function assertMatchingRequest(job, fingerprint) {
  const stored = storedRequestFingerprint(job);
  if (!stored || !hashesMatch(stored, fingerprint)) throw idempotencyConflict();
}

function statusTokenForJob(job) {
  if (!job?.idempotencyKey) return null;
  const scoped = deterministicStatusToken(job.organizationId, job.actorId, job.idempotencyKey);
  if (hashesMatch(tokenHash(scoped), job.statusTokenHash)) return scoped;
  const legacy = deterministicStatusToken(job.organizationId, job.idempotencyKey);
  if (hashesMatch(tokenHash(legacy), job.statusTokenHash)) return legacy;
  return null;
}

function isOfflineError(error) {
  const code = String(error?.code || '');
  return code === 'CHATGPT_GATEWAY_UNAVAILABLE'
    || code === 'CHATGPT_GATEWAY_NOT_CONFIGURED'
    || code === 'LLM_NOT_CONFIGURED'
    || code === 'LLM_REQUEST_FAILED'
    || code.startsWith('CHATGPT_GATEWAY_')
    || /chatgpt gateway|codex app server|gateway could not be reached|fetch failed|request deadline/i
      .test(String(error?.message || ''));
}

function isRetryableProcessingError(error) {
  if (!error || error.permanent === true) return false;
  const status = Number(error.statusCode || error.status || 0);
  return isOfflineError(error)
    || error.retryable === true
    || status === 408
    || status === 429
    || status >= 500;
}

function deferredRetryDelay(cycles = 0) {
  const exponent = Math.max(0, Math.min(10, Number(cycles || 0)));
  return Math.min(DEFERRED_RETRY_MAX_MS, DEFERRED_RETRY_BASE_MS * (2 ** exponent));
}

function backoffDelay(attemptsMade, error) {
  const attempt = Math.max(1, Number(attemptsMade || 1));
  if (!isOfflineError(error) && isRetryableProcessingError(error) && attempt % MAX_FAST_FAILURE_ATTEMPTS === 0) {
    return deferredRetryDelay(Math.floor((attempt - 1) / MAX_FAST_FAILURE_ATTEMPTS));
  }
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  const delay = 30_000 * (2 ** exponent);
  return Math.min(delay, isOfflineError(error) ? 5 * 60_000 : 10 * 60_000);
}

function publicState(job) {
  const retryUntil = job.retryUntil || null;
  const retryable = job.state === 'failed'
    && job.retryable === true
    && Boolean(job.durableFile?.fileId || job.durableFile?.storageKey)
    && !job.durableFile?.releasedAt
    && (!retryUntil || new Date(retryUntil).getTime() > Date.now());
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
    cancelledAt: job.cancelledAt || null,
    attempts: Math.max(0, Number(job.attempts || 0)),
    failureCount: Math.max(0, Number(job.failureCount || 0)),
    deferredCycles: Math.max(0, Number(job.deferredCycles || 0)),
    nextAttemptAt: job.nextAttemptAt || null,
    retryable,
    retryUntil,
    mode: job.mode || null,
    targetJobId: job.jobId || null,
    requestFingerprint: job.requestFingerprint || null,
    ...(job.originalName ? { fileName: job.originalName } : {}),
    candidateId: job.result?.candidate?._id || job.candidateId || null,
    error: job.state === 'failed' ? job.lastError : undefined,
    ...(job.state === 'completed' && job.result ? job.result : {})
  };
}

function actorDescriptor(job) {
  return {
    ...publicState(job),
    statusToken: statusTokenForJob(job) || undefined,
    statusUrl: `/api/cv-processing/jobs/${job.publicId}`
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
    deferredCycles: Math.max(0, Number(job.deferredCycles || 0)),
    nextAttemptAt: job.nextAttemptAt || null,
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

function queueDeliveryId(job) {
  const manualRetryCount = Math.max(0, Math.floor(Number(job?.manualRetryCount || 0)));
  return manualRetryCount > 0
    ? `${job.publicId}--manual-retry-${manualRetryCount}`
    : job.publicId;
}

async function addQueueJob(job) {
  const queueInstance = await getQueue();
  const jobsAhead = await cvProcessingJobs.countAhead(job.organizationId, job.createdAt);
  return queueInstance.add('analyze-ai-interview-cv', { processingJobId: job.publicId }, {
    jobId: queueDeliveryId(job),
    attempts: 2_147_483_647,
    backoff: { type: 'cv-runtime', delay: 30_000 },
    priority: Math.min(2_097_152, jobsAhead + 1),
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 }
  });
}

function processingJobFromIntake(intake) {
  const now = iso(new Date());
  return {
    _id: id('cvjob'),
    publicId: intake.publicId,
    statusTokenHash: intake.statusTokenHash,
    idempotencyKey: intake.idempotencyKey,
    requestFingerprint: intake.requestFingerprint,
    state: 'queued',
    stage: 'ingesting',
    progress: 5,
    attempts: 0,
    failureCount: 0,
    organizationId: intake.organizationId,
    actorId: intake.actorId,
    jobId: intake.jobId,
    candidateId: intake.candidateId || null,
    mode: intake.mode,
    originalName: String(intake.originalName || 'cv').slice(0, 255),
    mimeType: String(intake.mimeType || 'application/octet-stream').slice(0, 127),
    fileSize: Number(intake.fileSize || intake.durableFile?.length || 0),
    durableFile: {
      ...intake.durableFile,
      cleanupState: 'retained',
      cleanupAttempts: 0
    },
    createdAt: intake.createdAt || now,
    updatedAt: now
  };
}

async function finalizeBindingIntake(binding, {
  verifyStored = false,
  repository = cvProcessingJobs,
  intakeRepository = cvProcessingIntakes,
  fileStore = durableCvFileStore,
  enqueue = addQueueJob
} = {}) {
  if (!binding || binding.state !== 'binding' || !binding.bindingToken) {
    const error = new Error('The CV intake is not reserved for job binding.');
    error.code = 'CV_INTAKE_BINDING_LOST';
    error.statusCode = 409;
    throw error;
  }
  try {
    if (verifyStored) await fileStore.readBuffer(binding.durableFile);
    const creation = await repository.createOrGet(processingJobFromIntake(binding));
    const processingJob = creation.job;
    assertMatchingRequest(processingJob, binding.requestFingerprint);
    await intakeRepository.markBound(
      binding.intakeId,
      processingJob.publicId,
      processingJob.durableFile,
      binding.bindingToken
    );
    if (creation.created) {
      try {
        await enqueue(processingJob);
      } catch (error) {
        await repository.recordDispatchError(processingJob.publicId, error);
      }
    }
    await retainStoredQueueEvent(processingJob.publicId);
    return { job: processingJob, created: creation.created };
  } catch (error) {
    const committed = await repository.findByPublicId(binding.publicId).catch(() => null);
    if (!committed) {
      await intakeRepository.releaseBinding(
        binding.intakeId,
        binding.bindingToken,
        error
      ).catch(() => {});
    }
    throw error;
  }
}

async function waitForStorageOwner({ organizationId, actorId, idempotencyKey }) {
  const deadline = Date.now() + INTAKE_CONTENTION_WAIT_MS;
  let current = null;
  do {
    current = await cvProcessingIntakes.findByScope(
      organizationId,
      actorId,
      idempotencyKey
    );
    if (!current || current.state !== 'storing') return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  return current;
}

async function submit({ file, organizationId, actorId, jobId, candidateId, mode, idempotencyKey }) {
  const normalizedKey = String(idempotencyKey || '').trim();
  if (!normalizedKey) throw idempotencyRequired();
  if (!file?.buffer?.length) {
    const error = new Error('Upload a CV file.');
    error.statusCode = 400;
    throw error;
  }
  const fileSha256 = sha256Buffer(file.buffer);
  const fingerprint = requestFingerprint({ mode, jobId, candidateId, fileSha256 });
  const statusToken = deterministicStatusToken(organizationId, actorId, normalizedKey);
  const existing = await cvProcessingJobs.findByIdempotencyKey(
    organizationId,
    actorId,
    normalizedKey
  );
  if (existing) {
    assertMatchingRequest(existing, fingerprint);
    const bound = existing.requestFingerprint
      ? existing
      : await cvProcessingJobs.bindRequestFingerprint(existing.publicId, fingerprint);
    return {
      job: bound || existing,
      statusToken: statusTokenForJob(bound || existing) || statusToken,
      duplicate: true
    };
  }

  const proposedPublicId = `aicv_${crypto.randomUUID()}`;
  const plannedFile = durableCvFileStore.planReference(file.buffer);
  const proposedCandidateId = candidateId || (mode === 'import'
    ? deterministicCvCandidateId(proposedPublicId)
    : null);
  const reservation = await cvProcessingIntakes.reserve({
    organizationId,
    actorId,
    idempotencyKey: normalizedKey,
    requestFingerprint: fingerprint,
    publicId: proposedPublicId,
    statusTokenHash: tokenHash(statusToken),
    jobId,
    candidateId: proposedCandidateId,
    mode,
    originalName: file.originalname,
    mimeType: file.mimetype,
    fileSize: Number(file.size || file.buffer.length),
    durableFile: plannedFile
  });
  const intake = reservation.intake;
  if (!intake || !hashesMatch(intake.requestFingerprint, fingerprint)) {
    throw idempotencyConflict();
  }

  // A competing request may have committed the job between the first lookup
  // and the intake reservation. Return that same logical job without touching
  // storage again.
  const committed = await cvProcessingJobs.findByPublicId(intake.jobPublicId || intake.publicId);
  if (committed) {
    assertMatchingRequest(committed, fingerprint);
    await cvProcessingIntakes.markBound(
      intake.intakeId,
      committed.publicId,
      committed.durableFile,
      intake.bindingToken
    )
      .catch(() => {});
    return {
      job: committed,
      statusToken: statusTokenForJob(committed) || statusToken,
      duplicate: true
    };
  }

  let currentIntake = intake;
  let storageClaim = null;
  for (let attempt = 0; attempt < 2 && !storageClaim; attempt += 1) {
    storageClaim = await cvProcessingIntakes.claimStorage(
      currentIntake.intakeId,
      currentIntake.durableFile
    );
    if (storageClaim) break;
    currentIntake = await waitForStorageOwner({
      organizationId,
      actorId,
      idempotencyKey: normalizedKey
    });
    if (currentIntake?.state !== 'reserved') break;
  }

  let durableFile = currentIntake?.durableFile || intake.durableFile;
  let persistedIntake = currentIntake?.state === 'persisted' ? currentIntake : null;
  let binding = null;
  if (storageClaim) {
    try {
      durableFile = await durableCvFileStore.persistBuffer(file.buffer, {
        originalName: file.originalname,
        mimeType: file.mimetype,
        organizationId,
        actorId,
        intakeId: intake.intakeId
      }, { reference: storageClaim.durableFile });
    } catch (error) {
      if (
        error.cleanupReference
        && durableCvFileStore.referenceKey(error.cleanupReference)
          !== durableCvFileStore.referenceKey(storageClaim.durableFile)
      ) {
        await cleanupWithOutbox(error.cleanupReference, {
          reason: 'durable-persistence-temporary-file-failed'
        }).catch((cleanupError) => {
          error.cleanupError = error.cleanupError || cleanupError;
        });
      }
      let bindingCleaned = false;
      try {
        await cleanupWithOutbox(storageClaim.durableFile, {
          reason: 'durable-persistence-owner-failed',
          ownerPublicId: storageClaim.publicId
        });
        bindingCleaned = true;
      } catch (cleanupError) {
        error.cleanupError = error.cleanupError || cleanupError;
      }
      if (bindingCleaned) {
        await cvProcessingIntakes.markStorageCleaned(
          storageClaim.intakeId,
          storageClaim.storageToken
        ).catch(() => {});
      }
      throw error;
    }
    persistedIntake = await cvProcessingIntakes.markPersisted(
      intake.intakeId,
      durableFile,
      storageClaim.storageToken,
      durableFile.persistedAt
    );
    if (!persistedIntake) {
      await cleanupWithOutbox(durableFile, {
        reason: 'lost-cv-storage-claim',
        ownerPublicId: intake.publicId
      }).catch(() => {});
    }
  } else if (currentIntake?.state === 'binding') {
    binding = currentIntake;
  } else if (currentIntake?.state === 'bound') {
    const boundJob = await cvProcessingJobs.findByPublicId(currentIntake.jobPublicId);
    if (boundJob) {
      assertMatchingRequest(boundJob, fingerprint);
      return {
        job: boundJob,
        statusToken: statusTokenForJob(boundJob) || statusToken,
        duplicate: true
      };
    }
  }

  if (!persistedIntake && !binding) {
    const racedJob = await cvProcessingJobs.findByPublicId(intake.publicId);
    if (racedJob) {
      assertMatchingRequest(racedJob, fingerprint);
      return {
        job: racedJob,
        statusToken: statusTokenForJob(racedJob) || statusToken,
        duplicate: true
      };
    }
    currentIntake = await cvProcessingIntakes.findByScope(
      organizationId,
      actorId,
      normalizedKey
    );
    if (
      currentIntake?.state === 'binding'
      && hashesMatch(currentIntake.requestFingerprint, fingerprint)
    ) {
      binding = currentIntake;
    } else if (
      currentIntake?.state === 'bound'
      && hashesMatch(currentIntake.requestFingerprint, fingerprint)
    ) {
      const boundJob = await cvProcessingJobs.findByPublicId(currentIntake.jobPublicId);
      if (boundJob) {
        return {
          job: boundJob,
          statusToken: statusTokenForJob(boundJob) || statusToken,
          duplicate: true
        };
      }
    } else {
      const error = new Error('The CV intake reservation changed before storage could be committed.');
      error.code = 'CV_INTAKE_RESERVATION_LOST';
      error.statusCode = 409;
      throw error;
    }
  }
  if (!binding && persistedIntake && afterDurablePersistForTests) {
    await afterDurablePersistForTests({ intake: persistedIntake, durableFile });
  }
  if (!binding) binding = await cvProcessingIntakes.claimBinding(intake.intakeId, durableFile);
  if (!binding) {
    const racedJob = await cvProcessingJobs.findByPublicId(intake.publicId);
    if (racedJob) {
      assertMatchingRequest(racedJob, fingerprint);
      return {
        job: racedJob,
        statusToken: statusTokenForJob(racedJob) || statusToken,
        duplicate: true
      };
    }
    const currentIntake = await cvProcessingIntakes.findByScope(
      organizationId,
      actorId,
      normalizedKey
    );
    if (
      currentIntake?.state === 'binding'
      && hashesMatch(currentIntake.requestFingerprint, fingerprint)
    ) {
      binding = currentIntake;
    }
  }
  if (!binding) {
    const error = new Error('The CV intake was reclaimed before job binding began. Retry the same upload.');
    error.code = 'CV_INTAKE_BINDING_LOST';
    error.statusCode = 409;
    throw error;
  }
  const finalized = await finalizeBindingIntake(binding);
  const processingJob = finalized.job;
  const duplicate = !finalized.created;

  return {
    job: processingJob,
    statusToken: duplicate ? (statusTokenForJob(processingJob) || statusToken) : statusToken,
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
  if (!processingJob.durableFile) {
    await cvProcessingJobs.finalizeTerminalExpiry(processingJob.publicId);
    return false;
  }
  if (processingJob.durableFile.releasedAt) {
    await cvProcessingJobs.markDurableFileReleased(
      processingJob.publicId,
      processingJob.durableFile.releasedAt
    );
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
      if (!await updateStoredStage(processingJob, bullJob, 'extracting', 25)) {
        return { skipped: true };
      }
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
    if (!await updateStoredStage(processingJob, bullJob, 'analyzing', 50)) {
      return { skipped: true };
    }
    const parsed = await runInferenceWithGlobalPermit(
      bullJob,
      workerToken,
      async ({ signal }) => {
        const attempted = await cvProcessingJobs.recordInferenceAttempt(processingJob.publicId);
        if (!attempted) {
          const error = new Error('CV processing was cancelled before inference started');
          error.code = 'CV_JOB_CANCELLED';
          error.permanent = true;
          throw error;
        }
        Object.assign(processingJob, attempted);
        return analyzeResume(processingJob.resumeText, {
          organizationId: processingJob.organizationId,
          actorId: processingJob.actorId,
          jobId: processingJob.jobId,
          candidateId: processingJob.candidateId,
          requestId: `ai-interview-cv-queue:${processingJob.publicId}`,
          usageExecutionId: `ai-interview-cv-queue:${processingJob.publicId}`
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
          retryState: 'waiting_for_chatgpt'
        });
        if (waiting.job) Object.assign(processingJob, waiting.job);
        await retainStoredQueueEvent(processingJob.publicId);
      }
    );
    if (!await updateStoredStage(processingJob, bullJob, 'finalizing', 80)) {
      return { skipped: true };
    }
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
    const retryable = isRetryableProcessingError(error);
    const nextAttemptNumber = Math.max(1, Number(processingJob.attempts || 0));
    const deferred = !runtimeWait && retryable && nextAttemptNumber % MAX_FAST_FAILURE_ATTEMPTS === 0;
    const nextAttemptAt = new Date(Date.now() + (deferred
      ? deferredRetryDelay(Number(processingJob.deferredCycles || 0))
      : backoffDelay(nextAttemptNumber, error)));
    const failure = await cvProcessingJobs.recordFailure(processingJob.publicId, error, {
      unmetered: runtimeWait || retryable,
      retryState: (runtimeWait || deferred) ? 'waiting_for_chatgpt' : 'queued',
      deferred,
      nextAttemptAt
    });
    if (failure.job) Object.assign(processingJob, failure.job);
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

async function recoverOrphanedStorage({
  now = new Date(),
  graceMs = ORPHAN_GRACE_MS,
  batchSize = ORPHAN_SWEEP_BATCH_SIZE,
  repository = cvProcessingJobs,
  intakeRepository = cvProcessingIntakes,
  fileStore = durableCvFileStore,
  cleanup = cleanupWithOutbox
} = {}) {
  const sampledAt = new Date(now);
  const safeGraceMs = Math.max(0, Number(graceMs) || 0);
  const staleBefore = new Date(sampledAt.getTime() - safeGraceMs);
  const safeBatchSize = Math.max(1, Math.min(5_000, Math.floor(Number(batchSize) || 500)));
  const result = {
    abandonedIntakes: 0,
    bindingRecovered: 0,
    linkedIntakes: 0,
    legacyOrphans: 0,
    cleanupFailed: 0
  };

  let afterBinding = null;
  while (true) {
    const bindings = await intakeRepository.findBindingIntakes(
      safeBatchSize,
      { after: afterBinding }
    );
    if (!bindings.length) break;
    for (const binding of bindings) {
      try {
        await finalizeBindingIntake(binding, {
          verifyStored: true,
          repository,
          intakeRepository,
          fileStore,
          enqueue: addQueueJob
        });
        result.bindingRecovered += 1;
      } catch {
        result.cleanupFailed += 1;
      }
    }
    const nextAfter = bindings[bindings.length - 1].intakeId;
    if (afterBinding && String(nextAfter) === String(afterBinding)) break;
    afterBinding = nextAfter;
    if (bindings.length < safeBatchSize) break;
  }

  let afterIntake = null;
  while (true) {
    const stale = await intakeRepository.findStaleUnbound(
      staleBefore,
      safeBatchSize,
      { after: afterIntake }
    );
    if (!stale.length) break;
    for (const candidate of stale) {
      const claimed = await intakeRepository.claimCleanup(candidate.intakeId, staleBefore);
      if (!claimed) continue;
      const linked = await repository.findByPublicId(claimed.jobPublicId || claimed.publicId);
      if (
        linked
        && durableCvFileStore.referenceKey(linked.durableFile)
          === durableCvFileStore.referenceKey(claimed.durableFile)
      ) {
        await intakeRepository.repairBound(
          claimed.intakeId,
          linked.publicId,
          claimed.durableFile,
          claimed.cleanupToken
        );
        result.linkedIntakes += 1;
        continue;
      }
      // A reference on any queued or retryable job is authoritative, even if a
      // damaged legacy intake receipt no longer points to that job identity.
      if (await repository.hasDurableReference(claimed.durableFile)) continue;
      try {
        await cleanup(claimed.durableFile, {
          reason: 'abandoned-cv-intake',
          ownerPublicId: claimed.publicId
        });
        await intakeRepository.markCleaned(claimed.intakeId, claimed.cleanupToken);
        result.abandonedIntakes += 1;
      } catch (error) {
        await intakeRepository.markCleanupFailed(
          claimed.intakeId,
          claimed.cleanupToken,
          error,
          new Date(sampledAt.getTime() + cleanupRetryDelay(1))
        );
        result.cleanupFailed += 1;
      }
    }
    const nextAfter = stale[stale.length - 1].intakeId;
    if (afterIntake && String(nextAfter) === String(afterIntake)) break;
    afterIntake = nextAfter;
    if (stale.length < safeBatchSize) break;
  }

  // This second pass reclaims legacy files written before intake receipts were
  // introduced. The grace window plus reference rechecks make it safe during a
  // rolling deploy: new code always commits its intake before touching storage.
  let afterFile = null;
  while (true) {
    const page = await fileStore.listManagedReferences({
      before: staleBefore,
      limit: safeBatchSize,
      after: afterFile
    });
    for (const reference of page.references) {
      if (await repository.hasDurableReference(reference)) continue;
      if (await intakeRepository.hasLiveReference(reference)) continue;
      try {
        await cleanup(reference, { reason: 'unreferenced-cv-storage' });
        result.legacyOrphans += 1;
      } catch {
        result.cleanupFailed += 1;
      }
    }
    if (!page.nextCursor || page.nextCursor === afterFile) break;
    afterFile = page.nextCursor;
  }
  return result;
}

async function recoverStaleJobs({
  queueInstance = null,
  repository = cvProcessingJobs,
  enqueue = addQueueJob,
  staleBefore = new Date(Date.now() - 60_000),
  batchSize = 500
} = {}) {
  const targetQueue = queueInstance || await getQueue();
  const safeBatchSize = Math.max(1, Math.min(5_000, Math.floor(Number(batchSize) || 500)));
  let recovered = 0;
  let after = null;
  while (true) {
    const pending = await repository.findRecoverable(
      staleBefore,
      safeBatchSize,
      { after }
    );
    if (!pending.length) break;
    for (const job of pending) {
      if (!await targetQueue.getJob(queueDeliveryId(job))) {
        await enqueue(job);
        recovered += 1;
      }
    }
    const last = pending[pending.length - 1];
    const nextAfter = { createdAt: last.createdAt, publicId: last.publicId };
    if (
      after
      && String(nextAfter.createdAt) === String(after.createdAt)
      && String(nextAfter.publicId) === String(after.publicId)
    ) break;
    after = nextAfter;
    if (pending.length < safeBatchSize) break;
  }
  return recovered;
}

async function getStatus(publicId, statusToken, actorId) {
  const job = await cvProcessingJobs.findByPublicId(publicId);
  if (!job || !statusToken || !hashesMatch(tokenHash(statusToken), job.statusTokenHash)) return null;
  if (actorId && job.actorId && actorId !== job.actorId) return null;
  const result = publicState(job);
  if (['queued', 'waiting_for_chatgpt'].includes(job.state)) {
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

async function getActorStatus(publicId, organizationId, actorId) {
  const job = await cvProcessingJobs.findForActor(publicId, organizationId, actorId);
  return job ? actorDescriptor(job) : null;
}

async function listActorJobs(organizationId, actorId, options = {}) {
  const jobs = await cvProcessingJobs.listForActor(organizationId, actorId, options);
  return jobs.map(actorDescriptor);
}

async function getActorHistory(publicId, organizationId, actorId) {
  const job = await cvProcessingJobs.findForActor(publicId, organizationId, actorId);
  if (!job) return null;
  return {
    job: actorDescriptor(job),
    transitions: (job.transitions || []).map((transition) => ({
      state: transition.state,
      stage: transition.stage || null,
      progress: Number(transition.progress || 0),
      attempts: Number(transition.attempts || 0),
      failureCount: Number(transition.failureCount || 0),
      at: transition.at,
      sequence: Number(transition.sequence || 0),
      errorCode: transition.errorCode || null
    }))
  };
}

function notRetryableError(job) {
  const error = new Error(job?.state === 'cancelled'
    ? 'Cancelled CV processing jobs cannot be retried.'
    : 'This CV processing job is no longer retryable. Upload the CV again.');
  error.code = 'CV_JOB_NOT_RETRYABLE';
  error.statusCode = 409;
  return error;
}

async function removeQueueDelivery(jobOrPublicId) {
  if (!connection) return false;
  const job = typeof jobOrPublicId === 'string'
    ? { publicId: jobOrPublicId, manualRetryCount: 0 }
    : jobOrPublicId;
  const manualRetryCount = Math.max(0, Math.floor(Number(job?.manualRetryCount || 0)));
  const deliveryIds = [...new Set([
    queueDeliveryId(job),
    ...(manualRetryCount > 0 ? [queueDeliveryId({
      ...job,
      manualRetryCount: manualRetryCount - 1
    })] : []),
    job.publicId
  ])];
  let removed = false;
  try {
    const queueInstance = await getQueue();
    for (const deliveryId of deliveryIds) {
      const existing = await queueInstance.getJob(deliveryId);
      if (!existing) continue;
      try {
        await existing.remove();
        removed = true;
      } catch {
        // Active deliveries cannot be removed; durable state CAS still prevents
        // them from committing after a cancellation or newer retry.
      }
    }
    return removed;
  } catch {
    return false;
  }
}

async function retry(publicId, organizationId, actorId) {
  const outcome = await cvProcessingJobs.retryFailed(publicId, organizationId, actorId);
  if (!outcome.job) return null;
  if (!outcome.retried) {
    if (outcome.job.state !== 'failed' && Number(outcome.job.manualRetryCount || 0) > 0) {
      return { ...actorDescriptor(outcome.job), duplicateRetry: true };
    }
    throw notRetryableError(outcome.job);
  }

  await removeQueueDelivery(outcome.job);
  try {
    await addQueueJob(outcome.job);
  } catch (error) {
    await cvProcessingJobs.recordDispatchError(publicId, error);
  }
  await retainStoredQueueEvent(publicId);
  const current = await cvProcessingJobs.findForActor(publicId, organizationId, actorId);
  return { ...actorDescriptor(current || outcome.job), duplicateRetry: false };
}

async function cancelForCandidate(organizationId, candidateId) {
  const jobs = await cvProcessingJobs.cancelAndRedactForCandidate(organizationId, candidateId);
  let cleanupDeferred = 0;
  for (const job of jobs) {
    await removeQueueDelivery(job);
    try {
      await releaseDurableFile(job);
    } catch {
      cleanupDeferred += 1;
    }
    await retainStoredQueueEvent(job.publicId);
  }
  return { jobs: jobs.length, cleanupDeferred };
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
          + Number(durable.stateCounts.waiting_for_chatgpt || 0),
        waitingTotal: Number(durable.stateCounts.queued || 0)
          + Number(durable.stateCounts.waiting_for_chatgpt || 0),
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
  await recoverOrphanedStorage().catch((error) => {
    console.error('AI Interview CV orphan recovery failed:', error.message);
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
      void recoverOrphanedStorage().catch((error) => {
        console.error('AI Interview CV orphan sweep failed:', error.message);
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

function setAfterDurablePersistForTests(hook) {
  afterDurablePersistForTests = typeof hook === 'function' ? hook : null;
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
  afterDurablePersistForTests = null;
}

module.exports = {
  _processJobForTests: processJob,
  _recoverOrphanedStorageForTests: recoverOrphanedStorage,
  _recoverStaleJobsForTests: recoverStaleJobs,
  _retryStorageCleanupForTests: retryStorageCleanup,
  _createGlobalDispatchCoordinator: createGlobalDispatchCoordinator,
  _createGlobalDispatchInferenceRunner: createGlobalDispatchInferenceRunner,
  _deliverQueueEventBatchForTests: deliverQueueEventBatch,
  _globalDispatchConfig: globalDispatchConfig,
  _setDispatchInferenceRunnerForTests: setDispatchInferenceRunnerForTests,
  _setAfterDurablePersistForTests: setAfterDurablePersistForTests,
  _startQueueEventPublisherForTests: startQueueEventPublisher,
  _queuedOperationalEventsForTests: queuedOperationalEvents,
  QUEUE_NAME,
  backoffDelay,
  cancelForCandidate,
  deferredRetryDelay,
  isRetryableProcessingError,
  closeForTests,
  deterministicStatusToken,
  appendTransition: cvProcessingJobs.appendTransition,
  flushQueueEvents,
  getStatus,
  getActorHistory,
  getActorStatus,
  init,
  isOfflineError,
  listActorJobs,
  publicState,
  queueEventRetryDelay,
  requestFingerprint,
  retry,
  setPaused,
  submit,
  telemetry,
  tokenHash,
  actorDescriptor
};
