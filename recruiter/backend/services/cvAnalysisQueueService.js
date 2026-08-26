const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const { DelayedError, Queue, Worker } = require('bullmq');
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingJob = require('../models/CVProcessingJob');
const CVStorageCleanupTask = require('../models/CVStorageCleanupTask');
const CVProcessingBatch = require('../models/CVProcessingBatch');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const User = require('../models/User');
const CVParsingService = require('./cvParsingService');
const CloudinaryUploadService = require('./cloudinaryUploadService');
const { resolveStoragePlatformConfiguration } = require('./platformConfigurationClient');
const durableCvFileStore = require('./durableCvFileStore');
const staleCvUploadSweeper = require('./staleCvUploadSweeper');
const embeddingService = require('./embeddingService');
const websocketService = require('./websocketService');
const creditsService = require('./creditsService');
const publicApplicationCapacityService = require('./publicApplicationCapacityService');
const publicApplicationCapability = require('./publicApplicationCapabilityService');
const organizationCvWriteFence = require('./organizationCvWriteFenceService');
const { recruiterOrganizationAuthorized } = require('./sharedAIUserSecurity');
const { runWithAIRequestContext } = require('./aiRuntime/requestContext');
const {
  createGlobalDispatchConnection,
  createGlobalDispatchCoordinator,
  createGlobalDispatchInferenceRunner,
  resolveGlobalDispatchConfig
} = require('./cvGlobalDispatch');

const unlinkAsync = promisify(fs.unlink);
const statAsync = promisify(fs.stat);
const queueName = 'cv-analysis-chatgpt';
const redisHost = process.env.REDIS_HOST || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisEnabled = process.env.REDIS_ENABLED
  ? process.env.REDIS_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.REDIS_HOST);
const requestedConcurrency = Math.max(1, Number(process.env.CV_ANALYSIS_QUEUE_CONCURRENCY || 1));
const approvedConcurrency = Math.max(1, Number(process.env.CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY || 1));
const concurrency = Math.min(requestedConcurrency, approvedConcurrency);
const globalDispatchConfig = resolveGlobalDispatchConfig({
  enabled: redisEnabled,
  serviceId: 'recruiter',
  defaultApprovedLimit: approvedConcurrency,
  legacyRedis: {
    host: redisHost,
    port: redisPort
  }
});
const connection = redisEnabled
  ? createGlobalDispatchConnection(globalDispatchConfig, {
    connectionName: 'cv-analysis-queue:recruiter',
    enableReadyCheck: false
  })
  : null;
const globalDispatchConnection = redisEnabled
  ? createGlobalDispatchConnection(globalDispatchConfig)
  : null;
const GLOBAL_DISPATCH_KEY_PREFIX = globalDispatchConfig.contract.keyPrefix;
const GLOBAL_DISPATCH_RETRY_MS = Math.max(
  1_000,
  Number(process.env.CV_GLOBAL_DISPATCH_RETRY_MS || 30_000)
);
const defaultCvParser = new CVParsingService();
const defaultCloudinary = new CloudinaryUploadService();
let cvParser = defaultCvParser;
let cloudinary = defaultCloudinary;
let storageConfigurationResolver = resolveStoragePlatformConfiguration;
let durableFileStore = durableCvFileStore;
let enqueueJob = (...args) => addQueueJob(...args);
const defaultCompletionEffectHandlers = {
  async candidateNotification(processingJob, candidate) {
    return Notification.createCandidateUploadedNotification(
      processingJob.actor || null,
      candidate,
      {
        organizationId: processingJob.organization,
        eventKey: `cv-completed:${processingJob.publicId}`
      }
    );
  },
  async gptCacheInvalidation(processingJob, candidate) {
    const gptAnalysisService = require('./gptAnalysisService');
    gptAnalysisService.cache.onCandidateAdded(candidate._id);
  },
  async websocketBroadcast(processingJob, candidate) {
    websocketService.broadcastToOrganization({
      type: 'candidate-added',
      eventId: `cv-completed:${processingJob.publicId}`,
      candidateId: String(candidate._id),
      candidateName: `${candidate.firstName} ${candidate.lastName}`.trim(),
      message: 'New candidate available for matching',
      timestamp: new Date().toISOString()
    }, String(processingJob.organization));
  },
  async embedding(_processingJob, candidate) {
    await embeddingService.createCandidateEmbedding(candidate);
    await Candidate.updateOne(
      { _id: candidate._id },
      { $set: { isEmbedded: true, embeddingCreatedAt: new Date() } }
    );
  },
  async limitReachedNotification(processingJob) {
    const job = await Job.findById(processingJob.jobAppliedFor);
    if (!job) return;
    await job.populate(['organization', 'hiringManager']);
    const candidateEmailNotificationService = require('./candidateEmailNotificationService');
    await candidateEmailNotificationService.sendJobApplicationLimitReachedEmail({ job });
  }
};
let completionEffectHandlers = { ...defaultCompletionEffectHandlers };
let batchLifecycleHooks = {};
let intakeLifecycleHooks = {};
let batchFileHasher = (...args) => sha256Path(...args);
let queue;
let queueOverrideForTests;
let worker;
let maintenanceTimer;
let cleanupTimer;
let telemetryTimer;
let dispatchControlTimer;
let telemetryDebounceTimer;
let initRetryTimer;
let historyBackfillPromise;
let lastHistoryBackfillAt = 0;
let historyBackfillCursor = null;
let cvIndexesReady = false;

function normalizedDispatchLimit(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

const HISTORY_REPAIR_INTERVAL_MS = 60_000;
const HISTORY_TRANSITION_LIMIT = 100;
const HISTORY_REPAIR_BATCH_SIZE = 500;
const TELEMETRY_ACTIVE_STATES = Object.freeze([
  'queued',
  'waiting_for_chatgpt',
  'processing'
]);
const TELEMETRY_RECENT_LIMIT = 24;
const ADMIN_TELEMETRY_LIMIT = 25;
const MAX_BOUNDED_FAILURE_ATTEMPTS = 5;
const DEFERRED_RETRY_BASE_MS = Math.max(
  60_000,
  Number(process.env.CV_DEFERRED_RETRY_BASE_MS || 30 * 60 * 1000)
);
const DEFERRED_RETRY_MAX_MS = Math.max(
  DEFERRED_RETRY_BASE_MS,
  Number(process.env.CV_DEFERRED_RETRY_MAX_MS || 6 * 60 * 60 * 1000)
);
const MAX_BILLING_FAILURE_ATTEMPTS = Math.max(
  1,
  Number(process.env.CV_BILLING_MAX_ATTEMPTS || 5)
);
const CLOUD_UPLOAD_UNCERTAINTY_MS = Math.max(
  60_000,
  Number(process.env.CV_CLOUD_UPLOAD_UNCERTAINTY_MS || 15 * 60 * 1000)
);
const CLOUD_UPLOAD_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.CV_CLOUD_UPLOAD_TIMEOUT_MS || 5 * 60 * 1000)
);
const CLOUD_UPLOAD_RECONCILIATION_MS = Math.max(
  CLOUD_UPLOAD_TIMEOUT_MS + CLOUD_UPLOAD_UNCERTAINTY_MS,
  Number(process.env.CV_CLOUD_UPLOAD_RECONCILIATION_MS || 24 * 60 * 60 * 1000)
);
const INTAKE_LEASE_MS = Math.max(
  60_000,
  Number(process.env.CV_INGESTION_INTAKE_LEASE_MS || 5 * 60 * 1000)
);
const BILLING_RETRY_BASE_MS = Math.max(
  1_000,
  Number(process.env.CV_BILLING_RETRY_BASE_MS || 30_000)
);
const BILLING_RETRY_MAX_MS = Math.max(
  BILLING_RETRY_BASE_MS,
  Number(process.env.CV_BILLING_RETRY_MAX_MS || 30 * 60 * 1000)
);
const CLEANUP_RETRY_BASE_MS = Math.max(
  1_000,
  Number(process.env.CV_STORAGE_CLEANUP_RETRY_BASE_MS || 30_000)
);
const CLEANUP_RETRY_MAX_MS = Math.max(
  CLEANUP_RETRY_BASE_MS,
  Number(process.env.CV_STORAGE_CLEANUP_RETRY_MAX_MS || 60 * 60 * 1000)
);
const configuredTerminalRetentionDays = Number(process.env.CV_PROCESSING_JOB_RETENTION_DAYS || 30);
const TERMINAL_JOB_RETENTION_MS = (
  Number.isFinite(configuredTerminalRetentionDays) && configuredTerminalRetentionDays > 0
    ? Math.max(1, configuredTerminalRetentionDays)
    : 30
) * 24 * 60 * 60 * 1000;
const configuredFailedRetryRetentionDays = Number(
  process.env.CV_FAILED_RETRY_RETENTION_DAYS || configuredTerminalRetentionDays || 30
);
const FAILED_RETRY_RETENTION_MS = (
  Number.isFinite(configuredFailedRetryRetentionDays) && configuredFailedRetryRetentionDays > 0
    ? Math.max(1, configuredFailedRetryRetentionDays)
    : 30
) * 24 * 60 * 60 * 1000;
const configuredAuditRetentionDays = Number(process.env.CV_PROCESSING_AUDIT_RETENTION_DAYS || 180);
const AUDIT_RETENTION_DAYS = Number.isFinite(configuredAuditRetentionDays) && configuredAuditRetentionDays > 0
  ? Math.max(1, configuredAuditRetentionDays)
  : 180;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function terminalJobExpiry(now = Date.now()) {
  return new Date(now + TERMINAL_JOB_RETENTION_MS);
}

function failedRetryExpiry(now = Date.now()) {
  return new Date(now + FAILED_RETRY_RETENTION_MS);
}

function cleanupRetryDelay(attempts) {
  const exponent = Math.max(0, Math.min(10, Number(attempts || 1) - 1));
  return Math.min(CLEANUP_RETRY_MAX_MS, CLEANUP_RETRY_BASE_MS * (2 ** exponent));
}

function billingRetryDelay(attempts) {
  const exponent = Math.max(0, Math.min(10, Number(attempts || 1) - 1));
  return Math.min(BILLING_RETRY_MAX_MS, BILLING_RETRY_BASE_MS * (2 ** exponent));
}

const globalDispatch = createGlobalDispatchCoordinator({
  redis: globalDispatchConnection,
  serviceId: 'recruiter',
  config: globalDispatchConfig
});
const bypassDispatchInferenceRunner = async (_bullJob, _workerToken, operation) => operation({
  signal: undefined,
  permit: null
});
const defaultDispatchInferenceRunner = globalDispatchConnection
  ? createGlobalDispatchInferenceRunner({
    coordinator: globalDispatch,
    retryDelayMs: GLOBAL_DISPATCH_RETRY_MS,
    DelayedErrorType: DelayedError
  })
  : bypassDispatchInferenceRunner;
let runInferenceWithGlobalPermit = defaultDispatchInferenceRunner;

async function runWithGlobalInferencePermit(jobId, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('CV global inference operation must be a function');
  }
  if (!globalDispatchConnection) {
    return operation({ signal: undefined, permit: null });
  }
  if (!globalDispatch.health().initialized) {
    await globalDispatch.initialize();
  }
  return globalDispatch.withPermit(jobId, operation);
}

function workerConcurrency() {
  return Math.max(1, Number(worker?.concurrency || concurrency));
}

function sharedDispatchWorkerState(dispatchState = {}, {
  running = Boolean(worker),
  ownActive = 0,
  fallbackConcurrency = workerConcurrency()
} = {}) {
  const parsedLimit = Number(dispatchState.limit);
  const concurrencyLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.floor(parsedLimit))
    : Math.max(1, Number(fallbackConcurrency) || 1);
  const active = Math.max(0, Number(dispatchState.active || 0));
  return {
    running,
    concurrency: concurrencyLimit,
    active,
    recruiterActive: Math.max(0, Number(ownActive || 0)),
    availableSlots: Math.max(0, concurrencyLimit - active),
    utilizationPercent: Math.min(100, Math.round((active / concurrencyLimit) * 100)),
    scope: GLOBAL_DISPATCH_KEY_PREFIX,
    dispatch: {
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

function publishTelemetrySoon(delayMs = 150) {
  if (telemetryDebounceTimer) return;
  telemetryDebounceTimer = setTimeout(() => {
    telemetryDebounceTimer = null;
    void publishTelemetry().catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
  telemetryDebounceTimer.unref?.();
}

function elapsedMs(start, end = Date.now()) {
  const startedAt = start ? new Date(start).getTime() : NaN;
  const endedAt = end instanceof Date ? end.getTime() : new Date(end).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function processingAttemptCount(job = {}) {
  return Math.max(
    0,
    Number(job.processingAttempts || 0),
    Number(job.attempts || 0)
  );
}

function retryActor(value) {
  if (!value) return null;
  return {
    type: value.type || 'system',
    id: value.id ? String(value.id) : '',
    name: String(value.name || '').slice(0, 200),
    email: String(value.email || '').slice(0, 320)
  };
}

function attemptTrail(job = {}, { includeActor = false } = {}) {
  return (job.attemptHistory || []).map((attempt) => ({
    attemptId: attempt.attemptId,
    number: Number(attempt.number || 0),
    trigger: attempt.trigger || 'automatic',
    requestedStage: attempt.requestedStage || 'failed',
    status: attempt.status || 'processing',
    stage: attempt.stage || null,
    startedAt: attempt.startedAt || null,
    finishedAt: attempt.finishedAt || null,
    errorCode: attempt.errorCode || null,
    errorMessage: attempt.errorMessage
      ? String(attempt.errorMessage).slice(0, 1000)
      : null,
    ...(includeActor && attempt.requestedBy ? { requestedBy: retryActor(attempt.requestedBy) } : {})
  }));
}

function retrySummary(job = {}, { includeActor = false, includeCapabilities = false } = {}) {
  const trail = attemptTrail(job);
  const availableUntil = job.retry?.availableUntil || null;
  const available = job.state === 'failed'
    && availableUntil != null
    && new Date(availableUntil).getTime() > Date.now();
  const durableAvailable = Boolean(
    job.durableFile?.fileId
    && !job.durableFile?.releasedAt
    && job.durableFile?.cleanupState !== 'deleted'
  );
  const cloudinaryAvailable = Boolean(
    job.cloudinary?.publicId
    && !job.cloudinary?.releasedAt
    && job.cloudinary?.cleanupState !== 'deleted'
  );
  const extractedTextAvailable = Boolean(job.resumeText);
  return {
    available: available && (durableAvailable || extractedTextAvailable) && (cloudinaryAvailable || durableAvailable),
    canRunNow: job.state === 'waiting_for_chatgpt'
      && extractedTextAvailable
      && cloudinaryAvailable,
    availableUntil,
    nextAttemptAt: job.retry?.nextAttemptAt || null,
    deferredCycles: Number(job.retry?.deferredCycles || 0),
    lastDeferredAt: job.retry?.lastDeferredAt || null,
    requestedStage: job.retry?.requestedStage || 'failed',
    manualRequests: Number(job.retry?.manualRequests || 0),
    automaticRetries: trail.filter((attempt) => attempt.trigger === 'automatic').length,
    manualRetries: trail.filter((attempt) => attempt.trigger === 'manual').length,
    lastRequestedAt: job.retry?.lastRequestedAt || null,
    replacementAvailable: job.state === 'failed'
      && Boolean(job.linkedCandidate)
      && ['public', 'replacement'].includes(job.source)
      && !job.supersededBy,
    ...(includeActor && job.retry?.lastRequestedBy
      ? { lastRequestedBy: retryActor(job.retry.lastRequestedBy) }
      : {}),
    ...(includeCapabilities ? {
      canRetryParsing: available && durableAvailable && (cloudinaryAvailable || durableAvailable),
      canRetryAnalysis: available && extractedTextAvailable && (cloudinaryAvailable || durableAvailable),
      storage: {
        cloudinary: cloudinaryAvailable,
        durable: durableAvailable,
        extractedText: extractedTextAvailable
      }
    } : {})
  };
}

function cvUsageExecutionId(job = {}) {
  const publicId = String(job.publicId || '').trim();
  const manualRevision = Math.max(0, Math.floor(Number(job.retry?.manualRequests || 0)));
  return `cv-queue:${publicId}${manualRevision > 0 ? `:manual-retry:${manualRevision}` : ''}`;
}

function lifecyclePhase(job) {
  if (['completed', 'failed', 'cancelled'].includes(job.state)) return job.state;
  if (processingAttemptCount(job) > 1) return 'retrying';
  return job.state;
}

function operationalJob(job, sampledAt) {
  const terminalAt = job.completedAt || job.failedAt || job.cancelledAt || sampledAt;
  return {
    jobId: job.publicId,
    source: job.source,
    state: job.state,
    phase: lifecyclePhase(job),
    stage: job.stage || null,
    progress: Number(job.progress || 0),
    attempts: processingAttemptCount(job),
    aiAttempts: Number(job.attempts || 0),
    processingAttempts: Number(job.processingAttempts || 0),
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    cancelledAt: job.cancelledAt || null,
    updatedAt: job.updatedAt,
    waitMs: elapsedMs(job.createdAt, job.startedAt || terminalAt),
    processingMs: job.startedAt ? elapsedMs(job.startedAt, terminalAt) : null,
    errorCode: job.lastError?.code || null,
    error: processingError(job),
    stageStartedAt: job.stageStartedAt || null,
    stageHistory: stageTrail(job),
    artifacts: artifactSummary(job)
  };
}

function auditTransition(job) {
  const at = new Date(job.updatedAt || Date.now());
  const state = String(job.state || 'queued');
  const progress = Number(job.progress || 0);
  const attempts = processingAttemptCount(job);
  const latestAttempt = (job.attemptHistory || []).at?.(-1);
  const stage = job.stage || undefined;
  const sequence = job.sequence != null
    && Number.isSafeInteger(Number(job.sequence))
    && Number(job.sequence) >= 0
    ? Number(job.sequence)
    : null;
  return {
    eventKey: sequence == null
      ? `${state}:${stage || ''}:${progress}:${attempts}:${at.toISOString()}`
      : `sequence:${sequence}`,
    phase: lifecyclePhase({ state, attempts }),
    stage,
    state,
    progress,
    attempts,
    processingAttempts: Number(job.processingAttempts || 0),
    trigger: job.retry?.pendingTrigger || latestAttempt?.trigger,
    requestedStage: job.retry?.requestedStage || latestAttempt?.requestedStage,
    sequence: sequence == null ? undefined : sequence,
    at,
    errorCode: job.lastError?.code || undefined
  };
}

function auditDocument(job) {
  const sampledAt = new Date(job.updatedAt || Date.now());
  const operational = operationalJob(job, sampledAt);
  return {
    producer: 'recruiter',
    publicId: job.publicId,
    source: job.source,
    state: job.state,
    stage: job.stage || undefined,
    stageStartedAt: job.stageStartedAt || undefined,
    stageHistory: stageTrail(job),
    artifacts: job.artifacts || undefined,
    progress: operational.progress,
    attempts: operational.attempts,
    processingAttempts: operational.processingAttempts,
    retry: {
      manualRequests: Number(job.retry?.manualRequests || 0),
      deferredCycles: Number(job.retry?.deferredCycles || 0),
      nextAttemptAt: job.retry?.nextAttemptAt,
      lastDeferredAt: job.retry?.lastDeferredAt,
      availableUntil: job.retry?.availableUntil,
      requestedStage: job.retry?.requestedStage,
      lastRequestedAt: job.retry?.lastRequestedAt,
      lastRequestedBy: retryActor(job.retry?.lastRequestedBy)
    },
    attemptHistory: attemptTrail(job, { includeActor: true }),
    organization: job.organization,
    organizationKey: String(job.organization || ''),
    actor: job.actor || undefined,
    actorKey: job.actor ? String(job.actor) : undefined,
    jobAppliedFor: job.jobAppliedFor || undefined,
    jobKey: job.jobAppliedFor ? String(job.jobAppliedFor) : undefined,
    candidate: job.candidate || undefined,
    linkedCandidate: job.linkedCandidate || undefined,
    batch: job.batch || undefined,
    batchPublicId: job.batchPublicId || undefined,
    supersededBy: job.supersededBy || undefined,
    supersedes: job.supersedes || undefined,
    revision: Number(job.revision || 1),
    originalName: job.originalName || '',
    fileType: job.fileType || '',
    fileSize: Number(job.fileSize || 0),
    jobCreatedAt: job.createdAt,
    startedAt: job.startedAt || undefined,
    completedAt: job.completedAt || undefined,
    failedAt: job.failedAt || undefined,
    cancelledAt: job.cancelledAt || undefined,
    lastUpdatedAt: job.updatedAt || sampledAt,
    waitMs: operational.waitMs,
    processingMs: operational.processingMs,
    errorCode: operational.errorCode || undefined,
    error: processingError(job) || undefined,
    expiresAt: new Date(new Date(job.createdAt || Date.now()).getTime() + AUDIT_RETENTION_MS)
  };
}

function operationalTransitions(transitions = []) {
  return transitions.map((transition) => ({
    phase: transition.phase || lifecyclePhase(transition),
    stage: transition.stage || null,
    state: transition.state,
    progress: Number(transition.progress || 0),
    attempts: Number(transition.attempts || 0),
    processingAttempts: Number(transition.processingAttempts || 0),
    trigger: transition.trigger || null,
    requestedStage: transition.requestedStage || null,
    sequence: transition.sequence != null && Number.isSafeInteger(Number(transition.sequence))
      ? Number(transition.sequence)
      : null,
    at: transition.at,
    errorCode: transition.errorCode || null
  })).sort((left, right) => {
    if (left.sequence != null && right.sequence != null && left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    return new Date(left.at || 0) - new Date(right.at || 0);
  });
}

function auditOperationalJob(job) {
  const operational = operationalJob({
    publicId: job.publicId,
    source: job.source,
    state: job.state,
    stage: job.stage,
    stageStartedAt: job.stageStartedAt,
    stageHistory: job.stageHistory,
    artifacts: job.artifacts,
    progress: job.progress,
    attempts: job.attempts,
    processingAttempts: job.processingAttempts,
    createdAt: job.jobCreatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    updatedAt: job.lastUpdatedAt,
    lastError: job.error || (job.errorCode ? { code: job.errorCode } : null)
  }, new Date(job.lastUpdatedAt || Date.now()));
  return {
    ...operational,
    producer: job.producer || 'recruiter',
    queue: job.producer === 'ai-interview' ? 'ai-interview-cv-analysis-chatgpt' : queueName,
    transitions: operationalTransitions(job.transitions),
    retry: {
      available: false,
      replacementAvailable: job.state === 'failed'
        && Boolean(job.linkedCandidate)
        && ['public', 'replacement'].includes(job.source)
        && !job.supersededBy,
      availableUntil: job.retry?.availableUntil || null,
      nextAttemptAt: job.retry?.nextAttemptAt || null,
      deferredCycles: Number(job.retry?.deferredCycles || 0),
      lastDeferredAt: job.retry?.lastDeferredAt || null,
      requestedStage: job.retry?.requestedStage || 'failed',
      manualRequests: Number(job.retry?.manualRequests || 0),
      automaticRetries: (job.attemptHistory || []).filter((attempt) => attempt.trigger === 'automatic').length,
      manualRetries: (job.attemptHistory || []).filter((attempt) => attempt.trigger === 'manual').length,
      lastRequestedAt: job.retry?.lastRequestedAt || null,
      ...(job.retry?.lastRequestedBy ? { lastRequestedBy: retryActor(job.retry.lastRequestedBy) } : {})
    },
    attemptHistory: attemptTrail(job, { includeActor: true }),
    error: job.error || operational.error || null,
    batch: job.batchPublicId ? { id: String(job.batchPublicId) } : null
  };
}

function externalQueueText(value, maximumLength = 200) {
  return String(value || '').trim().slice(0, maximumLength);
}

function externalQueueDate(value, fallback = null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
}

async function resolveAuditOrganizationId(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  if (mongoose.isValidObjectId(key)) {
    const organization = await Organization.findById(key).select('_id').lean();
    return organization?._id || null;
  }
  const organization = await Organization.findOne({ idpOrganizationId: key }).select('_id').lean();
  return organization?._id || null;
}

async function withAuditWriteFence(organizationKey, writer) {
  // The standalone AI Interview service historically emits the literal
  // namespace `settings`. It is not a Recruiter tenant key, so avoid an
  // unnecessary database lookup (and keep isolated producer tests fast).
  if (String(organizationKey || '').trim() === 'settings') return writer();
  const organizationId = await resolveAuditOrganizationId(organizationKey);
  // Integrated producers must name a current Recruiter ObjectId or mapped IdP
  // organization. Unknown keys fail closed so a delayed outbox event cannot
  // recreate history after either identifier was erased with the tenant. The
  // literal standalone AI Interview store namespace is the one documented
  // legacy producer that is not a Recruiter tenant identifier.
  if (!organizationId) return false;
  let lease;
  try {
    lease = await organizationCvWriteFence.acquire(organizationId, 'cv-audit-write');
  } catch (error) {
    if (error?.code === 'ORGANIZATION_ERASURE_IN_PROGRESS') return false;
    throw error;
  }
  const stopHeartbeat = organizationCvWriteFence.startHeartbeat(lease);
  try {
    await organizationCvWriteFence.renew(lease);
    return await writer();
  } finally {
    stopHeartbeat();
    await organizationCvWriteFence.release(lease).catch(() => {});
  }
}

function runAuditWriteFence(organizationKey, writer) {
  return withAuditWriteFence(organizationKey, writer);
}

async function ingestExternalQueueEvent(serviceId, input = {}) {
  if (String(serviceId || '') !== 'ai-interview') {
    const error = new Error('Only the AI Interview service can publish external CV queue events');
    error.code = 'CV_QUEUE_PRODUCER_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
  if (Array.isArray(input?.jobs)) {
    if (!input.jobs.length || input.jobs.length > 100) {
      const error = new Error('External CV queue event batches must contain between 1 and 100 jobs');
      error.code = 'CV_QUEUE_EVENT_INVALID';
      error.statusCode = 400;
      throw error;
    }
    const groupedJobs = new Map();
    for (const job of input.jobs) {
      const publicId = String(job?.publicId || job?.jobId || '');
      const group = groupedJobs.get(publicId) || [];
      group.push(job);
      groupedJobs.set(publicId, group);
    }
    const acceptedGroups = await mapWithConcurrency(
      [...groupedJobs.values()],
      8,
      async (jobs) => {
        const accepted = [];
        for (const job of [...jobs].sort((left, right) => (
          Number(left?.sequence || 0) - Number(right?.sequence || 0)
        ))) {
          accepted.push(await ingestExternalQueueEvent(serviceId, { job }));
        }
        return accepted;
      }
    );
    const accepted = acceptedGroups.flat();
    return {
      accepted: true,
      acceptedCount: accepted.length,
      jobIds: accepted.map((result) => result.jobId)
    };
  }
  const job = input?.job && typeof input.job === 'object' ? input.job : input;
  const publicId = externalQueueText(job.publicId || job.jobId, 120);
  if (!/^aicv_[A-Za-z0-9_-]{8,110}$/.test(publicId)) {
    const error = new Error('External CV queue event has an invalid job identifier');
    error.code = 'CV_QUEUE_EVENT_INVALID';
    error.statusCode = 400;
    throw error;
  }
  const state = String(job.state || '');
  if (!['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed', 'cancelled'].includes(state)) {
    const error = new Error('External CV queue event has an invalid state');
    error.code = 'CV_QUEUE_EVENT_INVALID';
    error.statusCode = 400;
    throw error;
  }
  const now = new Date();
  const createdAt = externalQueueDate(job.createdAt, now);
  const updatedAt = externalQueueDate(job.updatedAt, now);
  const startedAt = externalQueueDate(job.startedAt);
  const completedAt = externalQueueDate(job.completedAt);
  const failedAt = externalQueueDate(job.failedAt);
  const cancelledAt = externalQueueDate(job.cancelledAt);
  const allowedStages = new Set([
    'received', 'ingesting', 'uploading', 'stored', 'extracting', 'analyzing',
    'profile_creation', 'finalizing', 'retry_scheduled', 'completed', 'failed', 'cancelled'
  ]);
  const stage = allowedStages.has(String(job.stage || '')) ? String(job.stage) : undefined;
  const producerSequence = job.sequence != null
    && Number.isSafeInteger(Number(job.sequence))
    && Number(job.sequence) >= 0
    ? Number(job.sequence)
    : null;
  const normalized = {
    publicId,
    producer: 'ai-interview',
    source: 'ai-interview',
    state,
    stage,
    progress: Math.min(100, Math.max(0, Number(job.progress || 0))),
    attempts: Math.max(0, Number(job.attempts || 0)),
    processingAttempts: Math.max(0, Number(job.processingAttempts || job.attempts || 0)),
    retry: {
      nextAttemptAt: externalQueueDate(job.nextAttemptAt) || undefined,
      deferredCycles: Math.max(0, Number(job.deferredCycles || 0))
    },
    organizationKey: externalQueueText(job.organizationId, 200),
    actorKey: externalQueueText(job.actorId, 200) || undefined,
    jobKey: externalQueueText(job.jobId, 200) || undefined,
    jobCreatedAt: createdAt,
    startedAt: startedAt || undefined,
    completedAt: completedAt || undefined,
    failedAt: failedAt || undefined,
    cancelledAt: cancelledAt || undefined,
    lastUpdatedAt: updatedAt,
    ...(producerSequence == null ? {} : { producerSequence }),
    waitMs: elapsedMs(createdAt, startedAt || completedAt || failedAt || cancelledAt || updatedAt),
    processingMs: startedAt
      ? elapsedMs(startedAt, completedAt || failedAt || cancelledAt || updatedAt)
      : null,
    errorCode: externalQueueText(job.lastError?.code || job.errorCode, 100) || undefined,
    expiresAt: new Date(createdAt.getTime() + AUDIT_RETENTION_MS)
  };
  const transition = auditTransition({
    publicId,
    state,
    stage,
    progress: normalized.progress,
    attempts: normalized.attempts,
    processingAttempts: normalized.processingAttempts,
    sequence: producerSequence,
    updatedAt,
    lastError: normalized.errorCode ? { code: normalized.errorCode } : null
  });
  const written = await runAuditWriteFence(normalized.organizationKey, async () => {
    await CVProcessingAudit.updateOne(
      { publicId },
      { $setOnInsert: normalized },
      { upsert: true }
    );
    const monotonicFilter = producerSequence == null
      ? { publicId, producerSequence: { $exists: false }, lastUpdatedAt: { $lt: updatedAt } }
      : {
          publicId,
          $or: [
            { producerSequence: { $lt: producerSequence } },
            { producerSequence: { $exists: false }, lastUpdatedAt: { $lte: updatedAt } }
          ]
        };
    await CVProcessingAudit.updateOne(monotonicFilter, { $set: normalized });
    await CVProcessingAudit.updateOne(
      { publicId, 'transitions.eventKey': { $ne: transition.eventKey } },
      {
        $push: {
          transitions: {
            $each: [transition],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      }
    );
    return true;
  });
  publishTelemetrySoon(0);
  return { accepted: true, jobId: publicId, dropped: written === false };
}

async function syncHistory(processingJobId) {
  const job = processingJobId && typeof processingJobId === 'object' && processingJobId.publicId
    ? processingJobId
    : await CVProcessingJob.findById(processingJobId)
      .select('publicId source state stage stageStartedAt stageHistory artifacts progress attempts processingAttempts retry attemptHistory organization actor jobAppliedFor candidate linkedCandidate batch batchPublicId supersededBy supersedes revision originalName fileType fileSize durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt cancelledAt updatedAt lastError')
      .lean();
  if (!job) return false;
  return runAuditWriteFence(job.organization, async () => {
    const transition = auditTransition(job);
    const document = auditDocument(job);
    await CVProcessingAudit.updateOne(
      { publicId: job.publicId },
      { $setOnInsert: document },
      { upsert: true }
    );
    await CVProcessingAudit.updateOne(
      { publicId: job.publicId, lastUpdatedAt: { $lt: document.lastUpdatedAt } },
      { $set: document }
    );
    await CVProcessingAudit.updateOne(
      { publicId: job.publicId, 'transitions.eventKey': { $ne: transition.eventKey } },
      {
        $push: {
          transitions: {
            $each: [transition],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      }
    );
    return true;
  });
}

async function syncHistorySafely(processingJobId) {
  try {
    return await syncHistory(processingJobId);
  } catch (error) {
    console.error('CV processing history sync failed:', error.message);
    return false;
  }
}

async function candidateErasureContext(organizationId, candidateId) {
  const candidate = await Candidate.findOne({
    _id: candidateId,
    organization: organizationId
  }).select(
    'cloudinaryPublicId cloudinaryResourceType cloudinaryDeliveryType '
    + 'processingMetadata.cvProcessingJobId +deletionState +deletionPreparationToken '
    + '+deletionToken +deletionRequestedAt'
  ).lean();
  if (!candidate) return null;
  const candidateJobPublicId = candidate.processingMetadata?.cvProcessingJobId;
  const jobs = await CVProcessingJob.find({
    organization: organizationId,
    $or: [
      { candidate: candidate._id },
      { linkedCandidate: candidate._id },
      ...(candidateJobPublicId ? [{ publicId: candidateJobPublicId }] : [])
    ]
  }).select('+resumeText');
  return { candidate, jobs };
}

async function registerCandidateErasure(organizationId, candidateId, activationKey) {
  const context = await candidateErasureContext(organizationId, candidateId);
  if (!context) return null;
  const tasks = [];
  tasks.push(await registerRequiredErasureTask(
    'embedding',
    { candidateId },
    { reason: 'candidate-erasure', held: true, activationKey }
  ));
  if (context.candidate.cloudinaryPublicId) {
    tasks.push(await registerRequiredErasureTask(
      'cloudinary',
      {
        publicId: context.candidate.cloudinaryPublicId,
        resourceType: context.candidate.cloudinaryResourceType || 'raw',
        deliveryType: context.candidate.cloudinaryDeliveryType || 'authenticated'
      },
      { reason: 'candidate-erasure-after-job-retention', held: true, activationKey }
    ));
  }
  for (const job of context.jobs) {
    if (job.durableFile?.fileId && !job.durableFile?.releasedAt) {
      tasks.push(await registerRequiredErasureTask('gridfs', job.durableFile, {
        reason: 'candidate-erasure-durable-file',
        jobPublicId: job.publicId,
        held: true,
        activationKey
      }));
    }
    if (job.cloudinary?.publicId && !job.cloudinary?.releasedAt) {
      tasks.push(await registerRequiredErasureTask('cloudinary', job.cloudinary, {
        reason: 'candidate-erasure-cloudinary-asset',
        jobPublicId: job.publicId,
        held: true,
        activationKey
      }));
    }
    if (job.cloudinaryUploadIntent?.publicId && !job.cloudinary?.publicId) {
      tasks.push(await registerRequiredErasureTask('cloudinary', job.cloudinaryUploadIntent, {
        reason: 'candidate-erasure-cloudinary-upload-intent',
        jobPublicId: job.publicId,
        held: true,
        activationKey,
        notBefore: new Date(Date.now() + CLOUD_UPLOAD_TIMEOUT_MS + CLOUD_UPLOAD_UNCERTAINTY_MS),
        reconcileUntil: new Date(Date.now() + CLOUD_UPLOAD_RECONCILIATION_MS)
      }));
    }
  }

  // Adopt an earlier uncommitted held registration for the same resource.
  // Completed tasks stay completed; every other task remains non-executable
  // until the Candidate tombstone commits below.
  const taskIds = tasks.filter(Boolean).map((task) => task._id);
  const matchingHeldResources = tasks.filter(Boolean).map((task) => {
    if (task.provider === 'embedding') {
      return { provider: 'embedding', 'resource.candidateId': task.resource?.candidateId };
    }
    if (task.provider === 'gridfs') {
      return {
        provider: 'gridfs',
        'resource.bucket': task.resource?.bucket,
        'resource.fileId': task.resource?.fileId
      };
    }
    return {
      provider: 'cloudinary',
      'resource.publicId': task.resource?.publicId,
      'resource.resourceType': task.resource?.resourceType,
      'resource.deliveryType': task.resource?.deliveryType
    };
  });
  // Adopt a receipt left by a pre-tombstone partial registration. This also
  // repairs rows written by the earlier random-per-retry implementation.
  if (matchingHeldResources.length) {
    await CVStorageCleanupTask.updateMany(
      { state: 'held', $or: matchingHeldResources },
      {
        $set: { activationKey },
        $unset: { expiresAt: 1 }
      }
    );
  }
  if (taskIds.length) {
    await CVStorageCleanupTask.updateMany(
      { _id: { $in: taskIds }, state: { $ne: 'completed' } },
      {
        $set: {
          state: 'held',
          activationKey,
        },
        $unset: { nextAttemptAt: 1, lastError: 1, expiresAt: 1 }
      }
    );
  }
  return { ...context, activationKey, taskIds };
}

async function activateCandidateErasure(activationKey) {
  if (!activationKey) return 0;
  const tasks = await CVStorageCleanupTask.find({ activationKey, state: 'held' });
  const now = new Date();
  let activated = 0;
  for (const task of tasks) {
    const dueAt = task.notBefore && task.notBefore > now ? task.notBefore : now;
    const result = await CVStorageCleanupTask.updateOne(
      { _id: task._id, state: 'held' },
      {
        $set: { state: 'pending', nextAttemptAt: dueAt },
        $unset: { expiresAt: 1 }
      }
    );
    activated += Number(result.modifiedCount || result.nModified || 0);
  }
  return activated;
}

async function executeCandidateErasureTasks(activationKey) {
  if (!activationKey) return { examined: 0, completed: 0 };
  const tasks = await CVStorageCleanupTask.find({
    activationKey,
    state: { $in: ['pending', 'failed'] },
    $or: [
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: null },
      { nextAttemptAt: { $lte: new Date() } }
    ]
  });
  let completed = 0;
  for (const task of tasks) {
    try {
      if (await executeCleanupTask(task)) completed += 1;
    } catch (error) {
      console.error('Candidate provider erasure deferred:', error.message);
    }
  }
  return { examined: tasks.length, completed };
}

async function eraseCandidateProcessingData(organizationId, candidateIds = []) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw manualRetryError('CV_REDACTION_ORGANIZATION_INVALID', 'CV redaction organization is invalid', 400);
  }
  const ids = [...new Set(candidateIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const results = [];
  for (const value of ids) {
    const candidateId = new mongoose.Types.ObjectId(value);
    let current = await Candidate.findOne({
      _id: candidateId,
      organization: organizationId
    }).select('+deletionState +deletionPreparationToken +deletionToken +deletionRequestedAt');
    if (!current) {
      results.push({ candidateId: value, missing: true, hardDeleted: true });
      continue;
    }

    let activationKey = current.deletionState === 'tombstoned' && current.deletionToken
      ? current.deletionToken
      : current.deletionPreparationToken;
    if (current.deletionState !== 'tombstoned') {
      if (!activationKey) {
        const proposedToken = crypto.randomUUID();
        await Candidate.updateOne(
          {
            _id: candidateId,
            organization: organizationId,
            deletionState: { $ne: 'tombstoned' },
            $or: [
              { deletionPreparationToken: { $exists: false } },
              { deletionPreparationToken: null },
              { deletionPreparationToken: '' }
            ]
          },
          { $set: { deletionPreparationToken: proposedToken } }
        );
        current = await Candidate.findOne({ _id: candidateId, organization: organizationId })
          .select('+deletionState +deletionPreparationToken +deletionToken');
        activationKey = current?.deletionState === 'tombstoned'
          ? current.deletionToken
          : current?.deletionPreparationToken;
        if (!activationKey) {
          throw manualRetryError(
            'CV_ERASURE_PREPARATION_FAILED',
            'Candidate erasure could not be prepared safely. Please retry.',
            503
          );
        }
      }
      const receipt = await registerCandidateErasure(organizationId, candidateId, activationKey);
      if (!receipt) {
        results.push({ candidateId: value, missing: true, hardDeleted: true });
        continue;
      }
      const tombstoned = await Candidate.updateOne(
        {
          _id: candidateId,
          organization: organizationId,
          deletionState: { $ne: 'tombstoned' },
          deletionPreparationToken: activationKey
        },
        {
          $set: {
            deletionState: 'tombstoned',
            deletionToken: activationKey,
            deletionRequestedAt: new Date(),
            firstName: '[deleted]',
            lastName: '[deleted]',
            email: `deleted-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}@redacted.invalid`,
            phone: '[deleted]',
            position: '[deleted]',
            experience: '[deleted]',
            education: '[deleted]'
          },
          $unset: {
            publicApplicationCapabilityHash: 1,
            publicApplicationCapabilityExpiresAt: 1,
            publicApplicationKey: 1,
            publicApplicationRequestKey: 1,
            publicApplicationRequestFingerprint: 1,
            deletionPreparationToken: 1,
            location: 1,
            skills: 1,
            coverLetter: 1,
            resumeUrl: 1,
            resumeText: 1,
            cloudinaryPublicId: 1,
            cloudinaryResourceType: 1,
            cloudinaryDeliveryType: 1,
            parsedData: 1,
            fullCVData: 1,
            aiAnalysis: 1,
            workExperience: 1,
            educationHistory: 1,
            certifications: 1,
            languages: 1,
            awards: 1,
            projects: 1,
            publications: 1,
            volunteerWork: 1,
            professionalMemberships: 1,
            portfolioLinks: 1,
            additionalSections: 1,
            notes: 1,
            processingMetadata: 1
          }
        }
      );
      if (!Number(tombstoned.matchedCount || tombstoned.n || 0)) {
        current = await Candidate.findOne({ _id: candidateId, organization: organizationId })
          .select('+deletionState +deletionToken');
        if (!current || current.deletionState !== 'tombstoned' || !current.deletionToken) {
          throw manualRetryError(
            'CV_ERASURE_TOMBSTONE_FAILED',
            'Candidate erasure could not be committed safely. Please retry.',
            503
          );
        }
        activationKey = current.deletionToken;
      }
    }

    await activateCandidateErasure(activationKey);
    await executeCandidateErasureTasks(activationKey);
    await redactCandidateProcessingData(organizationId, [candidateId]);
    let hardDeleted = false;
    try {
      const removed = await Candidate.deleteOne({
        _id: candidateId,
        organization: organizationId,
        deletionState: 'tombstoned',
        deletionToken: activationKey
      });
      hardDeleted = Number(removed.deletedCount || removed.n || 0) === 1;
    } catch (error) {
      // The logical deletion is already committed and cleanup is durable.
      // Maintenance will retry the final hard delete; never revive this row.
      console.error('Candidate tombstone hard-delete deferred:', error.message);
    }
    results.push({ candidateId: value, tombstoned: true, hardDeleted });
  }
  return { candidates: results };
}

async function recoverTombstonedCandidateErasures({ limit = 100 } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const snapshotTail = await Candidate.findOne({ deletionState: 'tombstoned' })
    .sort({ _id: -1 })
    .select('_id')
    .lean();
  if (!snapshotTail) return { examined: 0, recovered: 0 };
  let examined = 0;
  let recovered = 0;
  let cursor = null;
  while (true) {
    const candidates = await Candidate.find({
      deletionState: 'tombstoned',
      _id: {
        ...(cursor ? { $gt: cursor } : {}),
        $lte: snapshotTail._id
      }
    })
      .select('_id organization +deletionState +deletionToken')
      .sort({ _id: 1 })
      .limit(pageSize)
      .lean();
    if (!candidates.length) break;
    examined += candidates.length;
    for (const candidate of candidates) {
      try {
        const result = await eraseCandidateProcessingData(candidate.organization, [candidate._id]);
        if (result.candidates[0]?.hardDeleted) recovered += 1;
      } catch (error) {
        console.error('Candidate tombstone recovery deferred:', error.message);
      }
    }
    cursor = candidates.at(-1)._id;
    if (String(cursor) === String(snapshotTail._id)) break;
  }
  return { examined, recovered };
}

async function redactCandidateProcessingData(organizationId, candidateIds = []) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw manualRetryError('CV_REDACTION_ORGANIZATION_INVALID', 'CV redaction organization is invalid', 400);
  }
  const ids = [...new Set(candidateIds.map(String))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return { jobs: 0, audits: 0, candidateAssets: 0, embeddings: 0 };

  // Candidate documents retain the canonical Cloudinary reference after the
  // operational job TTL expires. Register cleanup from that reference first,
  // so deleting an old candidate cannot orphan their CV asset.
  const candidates = await Candidate.find({
    _id: { $in: ids },
    organization: organizationId
  }).select(
    'cloudinaryPublicId cloudinaryResourceType cloudinaryDeliveryType '
    + 'processingMetadata.cvProcessingJobId'
  ).lean();
  const candidateJobPublicIds = candidates
    .map((candidate) => candidate.processingMetadata?.cvProcessingJobId)
    .filter(Boolean);
  const jobs = await CVProcessingJob.find({
    organization: organizationId,
    $or: [
      { candidate: { $in: ids } },
      { linkedCandidate: { $in: ids } },
      ...(candidateJobPublicIds.length ? [{ publicId: { $in: candidateJobPublicIds } }] : [])
    ]
  }).select('+resumeText');

  // A candidate record is the final durable pointer to its embedding and may
  // also be the final pointer to a Cloudinary asset after processing-job TTL.
  // Register every cleanup task before deleting that pointer. Registration is
  // the commit boundary: database failure aborts candidate deletion, while a
  // provider failure is safe because the persisted task will be retried.
  const erasureTasks = [];
  for (const candidateId of ids) {
    erasureTasks.push({
      label: 'Candidate embedding erasure',
      task: await registerRequiredErasureTask(
        'embedding',
        { candidateId },
        { reason: 'candidate-erasure' }
      )
    });
  }
  let candidateAssets = 0;
  for (const candidate of candidates) {
    if (!candidate.cloudinaryPublicId) continue;
    erasureTasks.push({
      label: 'Candidate retained CV asset erasure',
      task: await registerRequiredErasureTask(
        'cloudinary',
        {
          publicId: candidate.cloudinaryPublicId,
          resourceType: candidate.cloudinaryResourceType || 'raw',
          deliveryType: candidate.cloudinaryDeliveryType || 'authenticated'
        },
        { reason: 'candidate-erasure-after-job-retention' }
      )
    });
    candidateAssets += 1;
  }
  for (const job of jobs) {
    if (job.durableFile?.fileId && !job.durableFile?.releasedAt) {
      await registerRequiredErasureTask('gridfs', job.durableFile, {
        reason: 'candidate-erasure-durable-file',
        jobPublicId: job.publicId
      });
    }
    if (job.cloudinary?.publicId && !job.cloudinary?.releasedAt) {
      await registerRequiredErasureTask('cloudinary', job.cloudinary, {
        reason: 'candidate-erasure-cloudinary-asset',
        jobPublicId: job.publicId
      });
    }
    if (job.cloudinaryUploadIntent?.publicId && !job.cloudinary?.publicId) {
      await registerRequiredErasureTask('cloudinary', job.cloudinaryUploadIntent, {
        reason: 'candidate-erasure-cloudinary-upload-intent',
        jobPublicId: job.publicId,
        generationKey: job.cloudinaryUploadIntent.generation,
        notBefore: new Date(Date.now() + CLOUD_UPLOAD_TIMEOUT_MS + CLOUD_UPLOAD_UNCERTAINTY_MS),
        reconcileUntil: new Date(Date.now() + CLOUD_UPLOAD_RECONCILIATION_MS)
      });
    }
  }

  for (const { label, task } of erasureTasks) {
    try {
      await executeCleanupTask(task);
    } catch (error) {
      console.error(`${label} deferred:`, error.message);
    }
  }
  const embeddings = ids.length;

  for (const job of jobs) {
    const cancelledAt = new Date();
    const cancellationEvent = processingStageEvent(
      'cancelled', 'cancelled', Number(job.progress || 0), job, null, cancelledAt
    );
    const cancelled = await CVProcessingJob.findOneAndUpdate(
      { _id: job._id, state: { $ne: 'cancelled' } },
      {
        $set: {
          state: 'cancelled',
          stage: 'cancelled',
          stageStartedAt: cancelledAt,
          cancelledAt,
          cancellationReason: 'candidate-deleted'
        },
        $unset: {
          'retry.pendingTrigger': 1,
          'retry.nextAttemptAt': 1,
          processingLeaseId: 1,
          lastError: 1,
          expiresAt: 1
        },
        $push: {
          stageHistory: {
            $each: [cancellationEvent],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      },
      { new: true }
    ).select('+resumeText');
    const terminalJob = cancelled || await CVProcessingJob.findById(job._id).select('+resumeText');
    if (!terminalJob) continue;

    // Waiting BullMQ records can be removed immediately. An active record is
    // stopped by the database cancellation checks in processJob.
    if (queue) {
      try {
        const queued = await queue.getJob(terminalJob.publicId);
        if (queued && (await queued.getState()) !== 'active') await queued.remove();
      } catch {}
    }

    await releaseDurableFile(terminalJob).catch((error) => {
      console.error('Candidate durable CV erasure deferred:', error.message);
    });
    await releaseCloudinaryAsset(terminalJob).catch((error) => {
      console.error('Candidate Cloudinary CV erasure deferred:', error.message);
    });

    const redactedAttempts = (terminalJob.attemptHistory || []).map((attempt) => ({
      ...attempt.toObject?.() || attempt,
      requestedBy: undefined,
      errorMessage: undefined
    }));
    const redactedStages = (terminalJob.stageHistory || []).map((stage) => ({
      ...stage.toObject?.() || stage,
      errorMessage: undefined
    }));
    await CVProcessingJob.updateOne(
      { _id: terminalJob._id },
      {
        $set: {
          originalName: '[redacted]',
          formData: {},
          resumeText: '',
          attemptHistory: redactedAttempts,
          stageHistory: redactedStages,
          cancellationReason: 'candidate-deleted'
        },
        $unset: {
          actor: 1,
          candidate: 1,
          linkedCandidate: 1,
          'retry.lastRequestedBy': 1,
          'cloudinary.resumeUrl': 1,
          'cloudinary.publicId': 1,
          'cloudinary.assetId': 1,
          cloudinaryUploadIntent: 1,
          lastError: 1
        }
      }
    );
    await syncHistorySafely(terminalJob._id);
  }

  const publicIds = jobs.map((job) => job.publicId);
  const audits = await CVProcessingAudit.find({
    organizationKey: String(organizationId),
    $or: [
      { candidate: { $in: ids } },
      { linkedCandidate: { $in: ids } },
      ...(publicIds.length ? [{ publicId: { $in: publicIds } }] : [])
    ]
  });
  for (const audit of audits) {
    audit.actor = undefined;
    audit.actorKey = undefined;
    audit.candidate = undefined;
    audit.linkedCandidate = undefined;
    audit.originalName = '[redacted]';
    if (audit.error) audit.error.message = undefined;
    if (audit.retry) audit.retry.lastRequestedBy = undefined;
    for (const attempt of audit.attemptHistory || []) {
      attempt.requestedBy = undefined;
      attempt.errorMessage = undefined;
    }
    for (const stage of audit.stageHistory || []) stage.errorMessage = undefined;
    await audit.save();
  }
  const notifications = await Notification.deleteMany({
    type: 'candidate_uploaded',
    $or: [
      { 'data.candidateId': { $in: ids } },
      { 'data.candidateId': { $in: ids.map(String) } }
    ]
  });
  return {
    jobs: jobs.length,
    audits: audits.length,
    candidateAssets,
    embeddings,
    notifications: Number(notifications.deletedCount || notifications.n || 0)
  };
}

async function forEachSnapshotPage(Model, filter, {
  select,
  pageSize = 100,
  handler
} = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const tail = await Model.findOne(filter).sort({ _id: -1 }).select('_id').lean();
  if (!tail) return 0;
  let cursor;
  let examined = 0;
  while (true) {
    let query = Model.find({
      $and: [
        filter,
        {
          _id: {
            ...(cursor ? { $gt: cursor } : {}),
            $lte: tail._id
          }
        }
      ]
    }).sort({ _id: 1 }).limit(size);
    if (select) query = query.select(select);
    const rows = await query;
    if (!rows.length) break;
    for (const row of rows) await handler(row);
    examined += rows.length;
    cursor = rows.at(-1)._id;
    if (String(cursor) === String(tail._id)) break;
  }
  return examined;
}

async function redactOrganizationProcessingData(organizationId, { pageSize = 100 } = {}) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw manualRetryError('CV_REDACTION_ORGANIZATION_INVALID', 'CV redaction organization is invalid', 400);
  }
  let failureCount = 0;
  const failedJobIds = [];
  const jobs = await forEachSnapshotPage(
    CVProcessingJob,
    { organization: organizationId },
    {
      pageSize,
      select: '+resumeText',
      handler: async (job) => {
        try {
          // Register every external pointer before removing it from the job.
          // A failed registration leaves this one row intact, while cursor
          // paging still lets every later tenant row make progress.
          if (job.durableFile?.fileId && !job.durableFile?.releasedAt) {
            await registerRequiredErasureTask('gridfs', job.durableFile, {
              reason: 'organization-erasure-durable-file',
              jobPublicId: job.publicId
            });
          }
          if (job.cloudinary?.publicId && !job.cloudinary?.releasedAt) {
            await registerRequiredErasureTask('cloudinary', job.cloudinary, {
              reason: 'organization-erasure-cloudinary-asset',
              jobPublicId: job.publicId
            });
          }
          if (job.cloudinaryUploadIntent?.publicId && !job.cloudinary?.publicId) {
            await registerRequiredErasureTask('cloudinary', job.cloudinaryUploadIntent, {
              reason: 'organization-erasure-cloudinary-upload-intent',
              jobPublicId: job.publicId,
              generationKey: job.cloudinaryUploadIntent.generation,
              notBefore: new Date(Date.now() + CLOUD_UPLOAD_TIMEOUT_MS + CLOUD_UPLOAD_UNCERTAINTY_MS),
              reconcileUntil: new Date(Date.now() + CLOUD_UPLOAD_RECONCILIATION_MS)
            });
          }
        } catch (error) {
          failureCount += 1;
          if (failedJobIds.length < 100) failedJobIds.push(job.publicId);
          return;
        }

        const cancelledAt = new Date();
        const cancellationEvent = processingStageEvent(
          'cancelled', 'cancelled', Number(job.progress || 0), job, null, cancelledAt
        );
        const cancelled = await CVProcessingJob.findOneAndUpdate(
          { _id: job._id, state: { $ne: 'cancelled' } },
          {
            $set: {
              state: 'cancelled',
              stage: 'cancelled',
              stageStartedAt: cancelledAt,
              cancelledAt,
              cancellationReason: 'organization-deleted'
            },
            $unset: {
              processingLeaseId: 1,
              lastError: 1,
              expiresAt: 1,
              'retry.pendingTrigger': 1,
              'retry.nextAttemptAt': 1
            },
            $push: {
              stageHistory: {
                $each: [cancellationEvent],
                $slice: -HISTORY_TRANSITION_LIMIT
              }
            }
          },
          { new: true }
        ).select('+resumeText');
        const terminalJob = cancelled || await CVProcessingJob.findById(job._id).select('+resumeText');
        if (!terminalJob) return;
        if (queue) {
          try {
            const queued = await queue.getJob(terminalJob.publicId);
            if (queued && (await queued.getState()) !== 'active') await queued.remove();
          } catch {}
        }
        await releaseDurableFile(terminalJob).catch((error) => {
          console.error('Organization durable CV erasure deferred:', error.message);
        });
        await releaseCloudinaryAsset(terminalJob).catch((error) => {
          console.error('Organization Cloudinary CV erasure deferred:', error.message);
        });
        const redactedAttempts = (terminalJob.attemptHistory || []).map((attempt) => ({
          ...attempt.toObject?.() || attempt,
          requestedBy: undefined,
          errorMessage: undefined
        }));
        const redactedStages = (terminalJob.stageHistory || []).map((stage) => ({
          ...stage.toObject?.() || stage,
          errorMessage: undefined
        }));
        await CVProcessingJob.updateOne(
          { _id: terminalJob._id },
          {
            $set: {
              originalName: '[redacted]',
              formData: {},
              resumeText: '',
              attemptHistory: redactedAttempts,
              stageHistory: redactedStages,
              cancellationReason: 'organization-deleted'
            },
            $unset: {
              actor: 1,
              candidate: 1,
              linkedCandidate: 1,
              jobAppliedFor: 1,
              batch: 1,
              batchPublicId: 1,
              'retry.lastRequestedBy': 1,
              'cloudinary.resumeUrl': 1,
              'cloudinary.publicId': 1,
              'cloudinary.assetId': 1,
              cloudinaryUploadIntent: 1,
              lastError: 1
            }
          }
        );
        await syncHistorySafely(terminalJob._id);
      }
    }
  );

  const auditFilter = {
    $or: [
      { organization: organizationId },
      { organizationKey: String(organizationId) }
    ]
  };
  const audits = await forEachSnapshotPage(CVProcessingAudit, auditFilter, {
    pageSize,
    handler: async (audit) => {
      audit.actor = undefined;
      audit.actorKey = undefined;
      audit.candidate = undefined;
      audit.linkedCandidate = undefined;
      audit.jobAppliedFor = undefined;
      audit.jobKey = undefined;
      audit.batch = undefined;
      audit.batchPublicId = undefined;
      audit.originalName = '[redacted]';
      if (audit.error) audit.error.message = undefined;
      if (audit.retry) audit.retry.lastRequestedBy = undefined;
      for (const attempt of audit.attemptHistory || []) {
        attempt.requestedBy = undefined;
        attempt.errorMessage = undefined;
      }
      for (const stage of audit.stageHistory || []) stage.errorMessage = undefined;
      await audit.save();
    }
  });

  const batches = await forEachSnapshotPage(
    CVProcessingBatch,
    { organization: organizationId },
    {
      pageSize,
      handler: async (batch) => {
        await CVProcessingBatch.updateOne(
          { _id: batch._id },
          {
            $set: {
              rejected: (batch.rejected || []).map(() => ({ fileName: '[redacted]' }))
            },
            $unset: { actor: 1, idempotencyKey: 1, requestFingerprint: 1 }
          }
        );
      }
    }
  );
  if (failureCount) {
    const error = manualRetryError(
      'ORGANIZATION_CV_ERASURE_PENDING',
      `Organization deletion is waiting for ${failureCount} CV cleanup registration(s)`,
      503
    );
    error.failedJobIds = failedJobIds;
    error.failureCount = failureCount;
    throw error;
  }
  return { jobs, audits, batches };
}

async function backfillHistory({ force = false } = {}) {
  if (historyBackfillPromise) return historyBackfillPromise;
  if (!force && Date.now() - lastHistoryBackfillAt < HISTORY_REPAIR_INTERVAL_MS) return 0;
  if (force) historyBackfillCursor = null;
  historyBackfillPromise = (async () => {
    const cursorFilter = historyBackfillCursor
      ? {
          $or: [
            { updatedAt: { $gt: historyBackfillCursor.updatedAt } },
            { updatedAt: historyBackfillCursor.updatedAt, _id: { $gt: historyBackfillCursor.id } }
          ]
        }
      : {};
    const rows = await CVProcessingJob.find(cursorFilter)
      .select('publicId source state stage stageStartedAt stageHistory artifacts progress attempts processingAttempts retry attemptHistory organization actor jobAppliedFor candidate linkedCandidate batch batchPublicId supersededBy supersedes revision originalName fileType fileSize durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt cancelledAt updatedAt lastError')
      .sort({ updatedAt: 1, _id: 1 })
      .limit(HISTORY_REPAIR_BATCH_SIZE)
      .lean();
    if (rows.length) {
      const byOrganization = new Map();
      for (const job of rows) {
        const key = String(job.organization || '');
        const group = byOrganization.get(key) || [];
        group.push(job);
        byOrganization.set(key, group);
      }
      for (const [organizationId, organizationRows] of byOrganization) {
        await runAuditWriteFence(organizationId, async () => {
          await CVProcessingAudit.bulkWrite(organizationRows.flatMap((job) => {
            const document = auditDocument(job);
            return [{
              updateOne: {
                filter: { publicId: job.publicId },
                update: { $setOnInsert: document },
                upsert: true
              }
            }, {
              updateOne: {
                filter: { publicId: job.publicId, lastUpdatedAt: { $lt: document.lastUpdatedAt } },
                update: { $set: document }
              }
            }];
          }), { ordered: false });
          await CVProcessingAudit.bulkWrite(organizationRows.map((job) => {
            const transition = auditTransition(job);
            return {
              updateOne: {
                filter: { publicId: job.publicId, 'transitions.eventKey': { $ne: transition.eventKey } },
                update: {
                  $push: {
                    transitions: {
                      $each: [transition],
                      $slice: -HISTORY_TRANSITION_LIMIT
                    }
                  }
                }
              }
            };
          }), { ordered: false });
          return true;
        });
      }
    }
    const last = rows.at(-1);
    historyBackfillCursor = rows.length === HISTORY_REPAIR_BATCH_SIZE && last
      ? { updatedAt: last.updatedAt, id: last._id }
      : null;
    lastHistoryBackfillAt = Date.now();
    return rows.length;
  })().catch((error) => {
    lastHistoryBackfillAt = 0;
    throw error;
  }).finally(() => {
    historyBackfillPromise = null;
  });
  return historyBackfillPromise;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function historyQuery(input = {}, { mandatoryFilter = {}, searchClauses = [] } = {}) {
  const page = Math.max(1, Math.min(100_000, Number(input.page) || 1));
  const limit = Math.max(10, Math.min(100, Number(input.limit) || 25));
  const filter = { ...mandatoryFilter };
  const allowedStates = new Set(['queued', 'waiting_for_chatgpt', 'processing', 'retrying', 'completed', 'failed', 'cancelled']);
  const allowedSources = new Set(['private', 'public', 'bulk', 'replacement', 'ai-interview']);
  const requestedState = String(input.state || '');
  if (requestedState === 'active') {
    filter.state = { $in: TELEMETRY_ACTIVE_STATES };
  } else if (requestedState === 'retrying') {
    filter.state = { $in: ['queued', 'waiting_for_chatgpt', 'processing'] };
    filter.attempts = { $gt: 1 };
  } else if (allowedStates.has(requestedState)) {
    filter.state = requestedState;
  }
  if (allowedSources.has(String(input.source || ''))) filter.source = String(input.source);
  if (searchClauses.length) filter.$or = searchClauses;
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  if ((from && Number.isFinite(from.getTime())) || (to && Number.isFinite(to.getTime()))) {
    filter.jobCreatedAt = {};
    if (from && Number.isFinite(from.getTime())) filter.jobCreatedAt.$gte = from;
    if (to && Number.isFinite(to.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.to))) {
        filter.jobCreatedAt.$lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
      } else {
        filter.jobCreatedAt.$lte = to;
      }
    }
  }
  return { page, limit, filter };
}

function isReanalysisJob(job = {}) {
  return processingAttemptCount(job) > 1
    || Number(job.retry?.manualRequests || 0) > 0;
}

async function organizationProcessingSummary(organizationId) {
  const activeJobs = await CVProcessingJob.find({
    organization: organizationId,
    state: { $in: TELEMETRY_ACTIVE_STATES }
  })
    .select('publicId state createdAt startedAt attempts processingAttempts retry.manualRequests')
    .sort({ createdAt: 1, publicId: 1 })
    .lean();
  const concurrencyLimit = workerConcurrency();
  const runningJobs = activeJobs.filter((job) => job.state === 'processing');
  const queuedJobs = activeJobs.filter((job) => job.state === 'queued');
  const waitingJobs = activeJobs.filter((job) => job.state === 'waiting_for_chatgpt');
  return {
    mode: concurrencyLimit === 1 ? 'sequential' : 'parallel',
    concurrency: concurrencyLimit,
    active: runningJobs.length,
    queued: queuedJobs.length,
    waitingForRuntime: waitingJobs.length,
    reanalysis: activeJobs.filter(isReanalysisJob).length,
    currentJobId: runningJobs[0]?.publicId || null,
    nextJobId: queuedJobs[0]?.publicId || null
  };
}

async function listOrganizationHistory(organizationId, input = {}) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw manualRetryError(
      'CV_HISTORY_ORGANIZATION_REQUIRED',
      'An organization is required to list CV processing jobs',
      403
    );
  }
  await backfillHistory();
  const organizationKey = String(organizationId);
  const searchClauses = await historySearchClauses(input.search, { organizationId });
  const { page, limit, filter } = historyQuery(input, {
    mandatoryFilter: { organizationKey },
    searchClauses
  });
  const [total, rows, earliest, processingSummary] = await Promise.all([
    CVProcessingAudit.countDocuments(filter),
    CVProcessingAudit.find(filter)
      .sort({ jobCreatedAt: -1, publicId: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CVProcessingAudit.findOne({ organizationKey })
      .sort({ jobCreatedAt: 1 })
      .select('jobCreatedAt')
      .lean(),
    organizationProcessingSummary(organizationId)
  ]);
  const live = rows.length
    ? await adminJobQuery({
      organization: organizationId,
      publicId: { $in: rows.map((row) => row.publicId) }
    })
    : [];
  const liveById = new Map(
    live.map((job) => [job.publicId, adminOperationalJob(job, new Date())])
  );
  const retained = await adminJobsFromAudits(
    rows.filter((row) => !liveById.has(row.publicId))
  );
  const retainedById = new Map(retained.map((job) => [job.jobId, job]));
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    jobs: rows.map((row) => (
      liveById.get(row.publicId)
      || retainedById.get(row.publicId)
      || auditOperationalJob(row)
    )),
    retainedIndefinitely: false,
    retentionDays: AUDIT_RETENTION_DAYS,
    coverageStartedAt: earliest?.jobCreatedAt || null,
    processingSummary,
    measuredAt: new Date().toISOString()
  };
}

async function listAdminHistory(input = {}) {
  await backfillHistory();
  const requestedOrganizationId = String(input.organizationId || '').trim();
  if (requestedOrganizationId && !mongoose.isValidObjectId(requestedOrganizationId)) {
    throw manualRetryError(
      'CV_HISTORY_ORGANIZATION_INVALID',
      'The organization filter is invalid',
      400
    );
  }
  const searchClauses = await historySearchClauses(input.search, { administrator: true });
  const { page, limit, filter } = historyQuery(input, {
    mandatoryFilter: requestedOrganizationId
      ? { organizationKey: requestedOrganizationId }
      : {},
    searchClauses
  });
  const [total, rows, earliest] = await Promise.all([
    CVProcessingAudit.countDocuments(filter),
    CVProcessingAudit.find(filter)
      .sort({ jobCreatedAt: -1, publicId: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CVProcessingAudit.findOne({})
      .sort({ jobCreatedAt: 1 })
      .select('jobCreatedAt')
      .lean()
  ]);
  const live = rows.length
    ? await adminJobQuery({ publicId: { $in: rows.map((row) => row.publicId) } })
    : [];
  const liveById = new Map(
    live.map((job) => [job.publicId, adminOperationalJob(job, new Date())])
  );
  const retained = await adminJobsFromAudits(
    rows.filter((row) => !liveById.has(row.publicId))
  );
  const retainedById = new Map(retained.map((job) => [job.jobId, job]));
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    jobs: rows.map((row) => (
      liveById.get(row.publicId)
      || retainedById.get(row.publicId)
      || auditOperationalJob(row)
    )),
    retainedIndefinitely: false,
    retentionDays: AUDIT_RETENTION_DAYS,
    coverageStartedAt: earliest?.jobCreatedAt || null,
    measuredAt: new Date().toISOString()
  };
}

function personName(person) {
  if (!person) return '';
  return person.profile?.displayName
    || [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ')
    || person.email
    || '';
}

function adminOperationalJob(job, sampledAt) {
  const operational = operationalJob(job, sampledAt);
  const actor = job.actor && typeof job.actor === 'object' ? job.actor : null;
  const organization = job.organization && typeof job.organization === 'object' ? job.organization : null;
  const appliedJob = job.jobAppliedFor && typeof job.jobAppliedFor === 'object' ? job.jobAppliedFor : null;
  const linkedCandidate = job.linkedCandidate && typeof job.linkedCandidate === 'object'
    ? job.linkedCandidate
    : null;
  // Public applications create the candidate before CV enrichment. Treat that
  // committed application candidate as visible while analysis is still
  // pending; `job.candidate` is only populated after AI completes.
  const candidate = job.candidate && typeof job.candidate === 'object'
    ? job.candidate
    : linkedCandidate;
  const applicantName = [job.formData?.firstName, job.formData?.lastName].filter(Boolean).join(' ');
  return {
    ...operational,
    producer: 'recruiter',
    queue: queueName,
    retry: retrySummary(job, { includeActor: true, includeCapabilities: true }),
    attemptHistory: attemptTrail(job, { includeActor: true }),
    revision: Number(job.revision || 1),
    supersedesJobId: job.supersedes ? String(job.supersedes) : null,
    supersededByJobId: job.supersededBy ? String(job.supersededBy) : null,
    organization: {
      id: String(organization?._id || job.organization || ''),
      name: organization?.name || 'Unknown organization'
    },
    uploader: actor ? {
      id: String(actor._id),
      name: personName(actor),
      email: actor.email || '',
      type: 'member'
    } : {
      id: '',
      name: applicantName || 'Public applicant',
      email: job.formData?.email || '',
      type: 'public'
    },
    application: appliedJob ? {
      id: String(appliedJob._id),
      title: appliedJob.title || 'Untitled job',
      candidateId: linkedCandidate?._id ? String(linkedCandidate._id) : null
    } : null,
    candidate: candidate ? {
      id: String(candidate._id),
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Candidate',
      email: candidate.email || ''
    } : null,
    file: {
      name: job.originalName || '',
      type: job.fileType || '',
      size: Number(job.fileSize || 0),
      receivedAt: job.createdAt || null,
      storedAt: job.durableFile?.persistedAt || null,
      cloudStored: Boolean(job.cloudinary?.publicId)
    },
    batch: job.batchPublicId ? { id: String(job.batchPublicId) } : null
  };
}

async function listAdminOrganizations(input = {}) {
  await backfillHistory();
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 100));
  const keys = await CVProcessingAudit.distinct('organizationKey', {
    organizationKey: { $regex: /^[a-f\d]{24}$/i }
  });
  if (!keys.length) return { organizations: [] };
  const search = String(input.search || '').trim().slice(0, 100);
  const query = {
    _id: { $in: keys.slice(0, 5_000) },
    ...(search ? { name: new RegExp(escapeRegex(search), 'i') } : {})
  };
  const organizations = await Organization.find(query)
    .select('name')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  return {
    organizations: organizations.map((organization) => ({
      id: String(organization._id),
      name: organization.name || 'Unknown organization'
    }))
  };
}

function objectIdLike(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ''));
}

async function adminJobsFromAudits(audits) {
  if (!audits.length) return [];
  const organizationIds = [...new Set(audits.map((audit) => audit.organizationKey).filter(objectIdLike))];
  const actorIds = [...new Set(audits.map((audit) => audit.actorKey).filter(objectIdLike))];
  const jobIds = [...new Set(audits.map((audit) => audit.jobKey).filter(objectIdLike))];
  const candidateIds = [...new Set(audits.flatMap((audit) => [
    audit.candidate,
    audit.linkedCandidate
  ]).filter(objectIdLike))];
  const [organizations, actors, jobs, candidates] = await Promise.all([
    organizationIds.length ? Organization.find({ _id: { $in: organizationIds } }).select('name').lean() : [],
    actorIds.length ? User.find({ _id: { $in: actorIds } }).select('email profile.firstName profile.lastName profile.displayName').lean() : [],
    jobIds.length ? Job.find({ _id: { $in: jobIds } }).select('title').lean() : [],
    candidateIds.length ? Candidate.find({ _id: { $in: candidateIds } }).select('firstName lastName email').lean() : []
  ]);
  const organizationById = new Map(organizations.map((item) => [String(item._id), item]));
  const actorById = new Map(actors.map((item) => [String(item._id), item]));
  const jobById = new Map(jobs.map((item) => [String(item._id), item]));
  const candidateById = new Map(candidates.map((item) => [String(item._id), item]));
  return audits.map((audit) => {
    const operational = auditOperationalJob(audit);
    const organization = organizationById.get(String(audit.organizationKey || ''));
    const actor = actorById.get(String(audit.actorKey || ''));
    const appliedJob = jobById.get(String(audit.jobKey || ''));
    const candidate = candidateById.get(String(audit.candidate || audit.linkedCandidate || ''));
    const isExternal = audit.producer === 'ai-interview';
    return {
      ...operational,
      organization: {
        id: String(audit.organizationKey || ''),
        name: organization?.name || (isExternal ? 'AI Interview organization' : 'Unknown organization')
      },
      uploader: actor ? {
        id: String(actor._id),
        name: personName(actor),
        email: actor.email || '',
        type: 'member'
      } : {
        id: String(audit.actorKey || ''),
        name: isExternal ? 'AI Interview applicant' : 'Public applicant',
        email: '',
        type: 'public'
      },
      application: audit.jobKey ? {
        id: String(audit.jobKey),
        title: appliedJob?.title || (isExternal ? 'AI Interview role' : 'Untitled job'),
        candidateId: audit.linkedCandidate ? String(audit.linkedCandidate) : null
      } : null,
      candidate: candidate ? {
        id: String(candidate._id),
        name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Candidate',
        email: candidate.email || ''
      } : null,
      file: {
        name: audit.originalName || '',
        type: audit.fileType || '',
        size: Number(audit.fileSize || 0),
        receivedAt: audit.jobCreatedAt || null,
        storedAt: null,
        cloudStored: false
      },
      batch: audit.batchPublicId ? { id: String(audit.batchPublicId) } : null
    };
  });
}

function isBusyError(error) {
  return ['CHATGPT_CAPACITY_BUSY', 'GATEWAY_QUEUE_FULL'].includes(String(error?.code || ''))
    || /\b(?:runtime|inference|gateway|queue)?\s*(?:is\s+)?busy\b|capacity (?:is )?occupied|queue (?:is )?full/i
      .test(String(error?.message || ''));
}

function isOfflineError(error) {
  return [
    'CHATGPT_GATEWAY_UNAVAILABLE',
    'CHATGPT_GATEWAY_NOT_CONFIGURED',
    'CHATGPT_GATEWAY_DISABLED',
    'CHATGPT_GATEWAY_PAUSED',
    'CODEX_NOT_INSTALLED'
  ].includes(String(error?.code || ''))
    || /chatgpt gateway|codex app server|fetch failed|could not be reached/i
      .test(String(error?.message || ''));
}

/**
 * The ChatGPT runtime family of failures: nobody's fault and nothing a retry
 * can fix until an administrator flips a switch, a recruiter connects or
 * re-consents their account, or a personal plan's usage window resets. A CV
 * must never be lost to any of these — it waits in the pipeline instead.
 */
function isRuntimeGateError(error) {
  return [
    'AI_RUNTIME_ACCOUNT_REQUIRED',
    'ORG_AUTOMATION_RUNTIME_REQUIRED',
    'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED',
    'AI_RUNTIME_CHATGPT_DISABLED',
    'CHATGPT_NOT_CONNECTED',
    'CHATGPT_SUBJECT_UNRESOLVED'
  ].includes(String(error?.code || ''))
    || (String(error?.code || '') === 'CODEX_TURN_FAILED'
      && /usage limit|rate limit|too many requests/i.test(String(error?.message || '')));
}

function isUnboundedRuntimeDeferral(error) {
  return isOfflineError(error) || isBusyError(error) || isRuntimeGateError(error);
}

/**
 * A public applicant has no account, but the workspace may still have a
 * personal ChatGPT runtime: the recruiter who connected a routable account.
 * Attributing actorless work to that recruiter lets it run on whichever
 * runtime the administrator selected — exactly as if the recruiter had
 * uploaded the CV themselves, so queued work uses the correct connected account.
 */
async function resolveOrganizationRuntimeActor(organizationId, jobAppliedForId = null) {
  const key = String(organizationId || '').trim();
  if (!mongoose.isValidObjectId(key)) return null;
  try {
    const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
    // A connected Recruiter account with Recruiter data-sharing consent is the
    // workspace runtime for actorless public CV work. Prefer an account that
    // was connected while this workspace was active, then fall back to another
    // currently authorized member (for legitimate multi-workspace users).
    const members = await User.find({
      sharedAIOnly: { $ne: true },
      idpSubject: { $exists: true, $ne: '' },
      organizationMemberships: {
        $elemMatch: { organization: organizationId, isActive: { $ne: false } }
      }
    }).select(
      'email idpSubject sharedAIOnly organizationMemberships '
      + 'recruiterAuthorizedOrganizations recruiterAppAccessSyncedAt '
      + 'currentOrganization profile.firstName profile.lastName profile.displayName'
    ).lean();
    const eligibleMembers = members.filter((member) => (
      recruiterOrganizationAuthorized(member, key)
    ));
    if (!eligibleMembers.length) return null;
    const memberById = new Map(eligibleMembers.map((member) => [String(member._id), member]));
    const accounts = await AIUserRuntimeAccount.find({
      user: { $in: eligibleMembers.map((member) => member._id) },
      status: 'connected',
      dataSharingAcknowledgedAt: { $ne: null }
    })
      .sort({ connectedAt: -1 })
      .select('user organization connectedAt')
      .lean();
    // A public application belongs to a job, so its runtime ownership follows
    // that job's human ownership rather than whichever organization member
    // happened to connect ChatGPT last. The poster is primary; an explicitly
    // assigned hiring manager or recruiter is the deterministic fallback for
    // legacy/imported jobs or a poster without a routable connection.
    let assignedUserIds = [];
    if (mongoose.isValidObjectId(String(jobAppliedForId || ''))) {
      const appliedJob = await Job.findOne({
        _id: jobAppliedForId,
        organization: organizationId
      }).select('createdBy hiringManager recruiters').lean();
      assignedUserIds = [
        appliedJob?.createdBy,
        appliedJob?.hiringManager,
        ...(appliedJob?.recruiters || [])
      ]
        .filter(Boolean)
        .map((value) => String(value))
        .filter((value, index, values) => values.indexOf(value) === index);
    }
    const assignedAccount = assignedUserIds
      .map((userId) => accounts.find((account) => String(account.user) === userId))
      .find(Boolean);
    const selected = assignedAccount
      || accounts.find((account) => String(account.organization || '') === key)
      || accounts[0];
    const owner = selected ? memberById.get(String(selected.user)) : null;
    if (!owner) return null;
    return { id: String(owner._id), user: owner };
  } catch (error) {
    console.warn('Organization runtime actor lookup failed:', error.message);
    return null;
  }
}

async function historySearchClauses(searchValue, { organizationId, administrator = false } = {}) {
  const search = String(searchValue || '').trim().slice(0, 100);
  if (!search) return [];
  const regex = new RegExp(escapeRegex(search), 'i');
  const candidateFilter = {
    ...(organizationId ? { organization: organizationId } : {}),
    $or: [{ firstName: regex }, { lastName: regex }, { email: regex }]
  };
  const [candidates, actors, jobs, organizations] = await Promise.all([
    Candidate.find(candidateFilter).select('_id').limit(250).lean(),
    User.find({
      $or: [
        { email: regex },
        { 'profile.firstName': regex },
        { 'profile.lastName': regex },
        { 'profile.displayName': regex }
      ]
    }).select('_id').limit(250).lean(),
    Job.find({
      ...(organizationId ? { organization: organizationId } : {}),
      title: regex
    }).select('_id').limit(250).lean(),
    administrator
      ? Organization.find({ name: regex }).select('_id').limit(100).lean()
      : []
  ]);
  const clauses = [
    { publicId: regex },
    { originalName: regex },
    ...candidates.map((candidate) => ({ candidate: candidate._id })),
    ...actors.map((actor) => ({ actorKey: String(actor._id) })),
    ...jobs.map((job) => ({ jobKey: String(job._id) })),
    ...organizations.map((organization) => ({ organizationKey: String(organization._id) }))
  ];
  return clauses.slice(0, 1_000);
}

function isRetryableProcessingError(error) {
  if (!error || error.permanent === true) return false;
  if (isUnboundedRuntimeDeferral(error) || error.retryable === true) return true;
  const status = Number(error.statusCode || error.status || 0);
  return status === 408 || status === 429 || status >= 500;
}

function deferredRetryDelay(cycles = 1) {
  const exponent = Math.max(0, Math.min(10, Number(cycles || 1) - 1));
  return Math.min(DEFERRED_RETRY_MAX_MS, DEFERRED_RETRY_BASE_MS * (2 ** exponent));
}

function cvBackoffDelay(attemptsMade, error) {
  if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) > 0) {
    return Math.min(DEFERRED_RETRY_MAX_MS, Number(error.retryAfterMs));
  }
  const exponent = Math.max(0, Math.min(10, Number(attemptsMade || 1) - 1));
  const exponential = 30_000 * (2 ** exponent);
  return Math.min(exponential, isUnboundedRuntimeDeferral(error) ? 5 * 60_000 : 10 * 60_000);
}

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

function idempotentStatusToken(organizationId, idempotencyKey) {
  const secret = String(process.env.CV_STATUS_TOKEN_SECRET || process.env.JWT_SECRET || 'development-only-cv-status-secret');
  return crypto.createHmac('sha256', secret).update(`${organizationId}:${idempotencyKey}`).digest('base64url');
}

function publicState(job) {
  const billingFailure = job.billing?.required === true && job.billing?.state === 'failed';
  const retry = retrySummary(job);
  const error = billingFailure
    ? {
      code: job.billing.lastError?.code || 'CV_BILLING_FAILED',
      message: job.billing.lastError?.message || 'CV upload billing failed',
      stage: 'received',
      at: job.billing.lastAttemptAt || null
    }
    : processingError(job);
  return {
    jobId: job.publicId,
    source: job.source,
    state: billingFailure ? 'failed' : job.state,
    stage: billingFailure ? 'failed' : (job.stage || null),
    stageStartedAt: job.stageStartedAt || null,
    stageHistory: stageTrail(job),
    progress: job.progress,
    position: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: billingFailure ? job.billing.lastAttemptAt : job.failedAt,
    candidateId: job.candidate ? String(job.candidate) : null,
    application: {
      jobId: job.jobAppliedFor ? String(job.jobAppliedFor?._id || job.jobAppliedFor) : null,
      candidateId: job.linkedCandidate ? String(job.linkedCandidate?._id || job.linkedCandidate) : null
    },
    batch: job.batchPublicId ? { id: String(job.batchPublicId) } : null,
    file: {
      name: job.originalName || '',
      type: job.fileType || '',
      size: Number(job.fileSize || 0),
      receivedAt: job.createdAt || null,
      storedAt: job.durableFile?.persistedAt || null,
      cloudStoredAt: job.cloudinary?.publicId
        ? (stageTrail(job).find((entry) => entry.stage === 'extracting')?.at || null)
        : null
    },
    attempts: processingAttemptCount(job),
    aiAttempts: Number(job.attempts || 0),
    retry,
    attemptHistory: attemptTrail(job).map((attempt) => ({
      number: attempt.number,
      trigger: attempt.trigger,
      requestedStage: attempt.requestedStage,
      status: attempt.status,
      stage: attempt.stage,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage
    })),
    error: error || undefined
  };
}

// Compatibility alias kept fail-closed: tenant context is never optional.
async function listHistory(input = {}) {
  return listOrganizationHistory(input.organizationId, input);
}

function candidateIngestionState(job, explicitState) {
  if (explicitState) return explicitState;
  if (job.state === 'waiting_for_chatgpt') return 'waiting';
  if (job.state === 'processing') return 'processing';
  if (job.state === 'failed') return 'failed';
  if (job.state === 'completed') return 'completed';
  return 'queued';
}

async function syncLinkedCandidateProcessing(job, {
  state,
  stage,
  progress,
  error,
  retryEligible
} = {}) {
  if (!job?.linkedCandidate) return false;
  const currentError = error === undefined ? processingError(job) : error;
  const set = {
    'processingMetadata.cvProcessingJobId': job.publicId,
    'processingMetadata.cvIngestionState': candidateIngestionState(job, state),
    'processingMetadata.cvProcessingStage': stage || job.stage || 'received',
    'processingMetadata.cvProcessingProgress': Math.max(
      0,
      Math.min(100, Number(progress ?? job.progress ?? 0))
    ),
    'processingMetadata.cvProcessingUpdatedAt': new Date(),
    'processingMetadata.cvRetryEligible': retryEligible === undefined
      ? retrySummary(job).available
      : retryEligible === true
  };
  if (currentError) set['processingMetadata.cvProcessingError'] = currentError;
  const update = { $set: set };
  if (!currentError) update.$unset = { 'processingMetadata.cvProcessingError': 1 };
  const result = await Candidate.updateOne(
    {
      _id: job.linkedCandidate,
      organization: job.organization,
      jobAppliedFor: job.jobAppliedFor,
      deletionState: { $ne: 'tombstoned' },
      $or: [
        { 'processingMetadata.cvProcessingJobId': job.publicId },
        { 'processingMetadata.cvProcessingJobId': { $exists: false } },
        { 'processingMetadata.cvProcessingJobId': null }
      ]
    },
    update
  );
  return Number(result.matchedCount || result.n || 0) === 1;
}

/**
 * Publish the independently durable CV artifact onto an already-created
 * candidate without waiting for AI enrichment. Public applications commit the
 * candidate first, then upload the CV; managed storage is therefore a useful
 * checkpoint in its own right. Keeping this projection separate prevents a
 * missing organization automation runtime from making a safely stored
 * Azure/Cloudinary CV invisible in Recruiter.
 */
async function projectStoredCvOntoLinkedCandidate(job) {
  if (!job?.linkedCandidate || !job.cloudinary?.publicId) return false;
  const storage = job.cloudinary;
  const set = {
    resumeUrl: storage.resumeUrl,
    cloudinaryPublicId: storage.publicId,
    cloudinaryResourceType: storage.resourceType,
    cloudinaryDeliveryType: storage.deliveryType,
    resumeStorageProvider: storage.storageProvider || 'cloudinary',
    resumeStorageKey: storage.storageKey || storage.publicId,
    resumeStorageContainer: storage.storageContainer || undefined,
    resumeStorageResourceType: storage.resourceType,
    'processingMetadata.uploadSuccess': true,
    'processingMetadata.fileSize': Number(job.fileSize || 0),
    'processingMetadata.originalName': job.originalName || '',
    'processingMetadata.cvProcessingJobId': job.publicId,
    'processingMetadata.cvProcessingUpdatedAt': new Date()
  };
  if (job.resumeText) {
    set.resumeText = job.resumeText;
    set['processingMetadata.parseSuccess'] = true;
  }
  // Omit absent optional provider coordinates instead of clearing a valid
  // value; Mongoose's handling of undefined in $set varies by version.
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) delete set[key];
  }
  const result = await Candidate.updateOne(
    {
      _id: job.linkedCandidate,
      organization: job.organization,
      ...(job.jobAppliedFor ? { jobAppliedFor: job.jobAppliedFor } : {}),
      deletionState: { $ne: 'tombstoned' },
      $or: [
        { 'processingMetadata.cvProcessingJobId': job.publicId },
        { 'processingMetadata.cvProcessingJobId': { $exists: false } },
        { 'processingMetadata.cvProcessingJobId': null }
      ]
    },
    { $set: set }
  );
  return Number(result.matchedCount || result.n || 0) === 1;
}

async function ensureConnection() {
  if (!connection) {
    const error = new Error('CV analysis Redis queue is disabled');
    error.code = 'CV_QUEUE_DISABLED';
    throw error;
  }
  if (connection.status === 'wait') await connection.connect();
}

async function getQueue() {
  if (queueOverrideForTests) return queueOverrideForTests;
  await ensureConnection();
  if (!queue) queue = new Queue(queueName, { connection });
  return queue;
}

async function applyGlobalDispatchState(state) {
  const q = await getQueue();
  const currentlyPaused = await q.isPaused();
  if (state.paused && !currentlyPaused) await q.pause();
  if (!state.paused && currentlyPaused) await q.resume();
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

async function initializeGlobalDispatchForTests() {
  await getQueue();
  return applyGlobalDispatchState(await globalDispatch.initialize());
}

function submissionError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function organizationAcceptsCvWrites(organizationId) {
  if (!mongoose.isValidObjectId(organizationId)) return false;
  return Boolean(await Organization.exists({
    _id: organizationId,
    isActive: { $ne: false },
    erasureState: { $ne: 'tombstoned' }
  }));
}

async function requireOrganizationAcceptsCvWrites(organizationId) {
  if (await organizationAcceptsCvWrites(organizationId)) return true;
  throw submissionError(
    'ORGANIZATION_ERASURE_IN_PROGRESS',
    'This organization is being deleted and cannot accept new CV processing work.',
    409
  );
}

function intakeInProgressError(code, message, leaseAt) {
  const elapsed = Date.now() - new Date(leaseAt || Date.now()).getTime();
  const error = submissionError(code, message, 425);
  error.retryAfterSeconds = Math.max(1, Math.ceil((INTAKE_LEASE_MS - elapsed) / 1000));
  return error;
}

async function resolveSubmissionContext(req, source) {
  const selectedOrganization = req.user?.currentOrganization
    || req.body?.organizationId
    || req.body?.organization;

  if (source === 'public') {
    const jobId = String(req.body?.jobId || '').trim();
    if (!mongoose.isValidObjectId(jobId)) {
      throw submissionError(
        'PUBLIC_JOB_REQUIRED',
        'A valid public jobId is required',
        400
      );
    }
    const job = await Job.findById(jobId)
      .select('_id organization isPublic status candidateApplyLimit publicApplicationCount')
      .lean();
    if (!job) {
      throw submissionError('PUBLIC_JOB_NOT_FOUND', 'The public job was not found', 404);
    }
    if (!job.isPublic) {
      throw submissionError(
        'PUBLIC_JOB_NOT_PUBLIC',
        'This job is not accepting public applications',
        403
      );
    }
    if (
      selectedOrganization
      && String(selectedOrganization) !== String(job.organization)
    ) {
      throw submissionError(
        'PUBLIC_JOB_ORGANIZATION_MISMATCH',
        'The public job does not belong to the supplied organization',
        403
      );
    }
    if (job.status !== 'active') {
      throw submissionError(
        'PUBLIC_JOB_NOT_ACTIVE',
        'This job is not accepting public applications',
        403
      );
    }
    return {
      organizationId: String(job.organization),
      job
    };
  }

  if (source === 'ai-interview' && !req.user?.currentOrganization) {
    throw submissionError(
      'CV_AUTHENTICATED_ORGANIZATION_REQUIRED',
      'AI Interview CV parsing requires an authenticated organization',
      401
    );
  }

  if (req.user?.currentOrganization) {
    return { organizationId: String(req.user.currentOrganization), job: null };
  }
  if (req.body?.jobId && mongoose.isValidObjectId(req.body.jobId)) {
    const job = await Job.findById(req.body.jobId).select('_id organization').lean();
    if (job?.organization) {
      return { organizationId: String(job.organization), job };
    }
  }
  return { organizationId: null, job: null };
}

function safeFormData(body = {}) {
  const allowed = ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'skills', 'coverLetter', 'jobId'];
  return Object.fromEntries(allowed.filter((key) => body[key] != null).map((key) => [key, String(body[key]).slice(0, 20_000)]));
}

async function submitUploadUnfenced(req, source = 'private', options = {}) {
  if (!req.file) {
    const error = new Error('No CV file was uploaded');
    error.statusCode = 400;
    throw error;
  }
  let context;
  try {
    context = await resolveSubmissionContext(req, source);
  } catch (error) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }
  const { organizationId } = context;
  if (!organizationId) {
    const error = new Error('Organization required. Public applications must include a valid jobId.');
    error.statusCode = 400;
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }
  try {
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }

  const suppliedIdempotencyKey = String(req.get?.('Idempotency-Key') || '').trim() || undefined;
  if (source === 'private' && !suppliedIdempotencyKey) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw submissionError(
      'CV_IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key is required for authenticated CV uploads',
      400
    );
  }

  const requestedLinkedCandidateId = options.linkedCandidateId || req.body?.candidateId;
  let linkedCandidate;
  let previousPublicJobId;
  let publicApplicationGeneration;
  if (source === 'public') {
    if (!mongoose.isValidObjectId(requestedLinkedCandidateId)) {
      try { await unlinkAsync(req.file.path); } catch {}
      throw submissionError(
        'PUBLIC_APPLICATION_CANDIDATE_REQUIRED',
        'Upload this CV from a submitted public application',
        403
      );
    }
    let committedCandidate;
    try {
      committedCandidate = await publicApplicationCapability.verify({
        candidateId: requestedLinkedCandidateId,
        jobId: context.job?._id,
        organizationId,
        token: req.get?.('X-Public-Application-Token') || req.body?.applicationToken
      });
    } catch (error) {
      try { await unlinkAsync(req.file.path); } catch {}
      throw error;
    }
    const committedApplication = committedCandidate
      ? await Job.exists({
        _id: context.job?._id,
        organization: organizationId,
        'shortlist.candidate': committedCandidate._id
      })
      : null;
    if (!committedCandidate || !committedApplication) {
      try { await unlinkAsync(req.file.path); } catch {}
      throw submissionError(
        'PUBLIC_APPLICATION_NOT_COMMITTED',
        'The public application must be submitted before its CV can be analyzed',
        403
      );
    }
    linkedCandidate = committedCandidate._id;
    previousPublicJobId = committedCandidate.processingMetadata?.cvProcessingJobId;
    publicApplicationGeneration = committedCandidate.publicApplicationRequestKey;
  } else if (requestedLinkedCandidateId && mongoose.isValidObjectId(requestedLinkedCandidateId)) {
    const candidateDoc = await Candidate.findOne({
      _id: requestedLinkedCandidateId,
      organization: organizationId
    }).select('_id').lean();
    if (candidateDoc) linkedCandidate = candidateDoc._id;
  }

  const idempotencyKey = source === 'public'
    ? `public:${String(context.job?._id)}:${String(linkedCandidate)}:${String(publicApplicationGeneration || '')}`
    : suppliedIdempotencyKey;
  let requestFingerprint;
  try {
    requestFingerprint = await uploadRequestFingerprint(
      req,
      source,
      organizationId,
      context.job?._id || req.body?.jobId,
      linkedCandidate
    );
  } catch (error) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }
  if (typeof intakeLifecycleHooks.beforeReceipt === 'function') {
    try {
      await intakeLifecycleHooks.beforeReceipt({ organizationId, source, requestFingerprint });
    } catch (error) {
      try { await unlinkAsync(req.file.path); } catch {}
      throw error;
    }
  }
  try {
    // Authorization may have completed before an organization tombstone was
    // committed. Recheck at the durable receipt boundary, not merely in route
    // middleware.
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }
  if (previousPublicJobId) {
    const previousJob = await CVProcessingJob.findOne({
      publicId: previousPublicJobId,
      organization: organizationId,
      jobAppliedFor: context.job?._id,
      linkedCandidate,
      source: 'public'
    }).select('+requestFingerprint');
    if (previousJob) {
      if (previousJob.requestFingerprint !== requestFingerprint) {
        try { await unlinkAsync(req.file.path); } catch {}
        throw idempotencyReuseError();
      }
      if (previousJob.stage !== 'received' || previousJob.durableFile?.fileId) {
        try { await unlinkAsync(req.file.path); } catch {}
        return {
          job: previousJob,
          statusToken: idempotentStatusToken(organizationId, idempotencyKey),
          duplicate: true
        };
      }
      // A committed public application may have survived a process exit after
      // its received receipt but before GridFS. Fall through to the normal
      // lease reclaim path so the resent bytes repair that same job.
    } else {
      try { await unlinkAsync(req.file.path); } catch {}
      throw submissionError(
        'PUBLIC_CV_REPLACEMENT_REQUIRED',
        'This application already has a CV processing record. A recruiter must explicitly replace or retry it.',
        409
      );
    }
  }
  const statusToken = idempotencyKey
    ? idempotentStatusToken(organizationId, idempotencyKey)
    : crypto.randomBytes(32).toString('base64url');
  let publicId = `cv_${crypto.randomUUID()}`;
  const intakeLeaseId = crypto.randomUUID();
  const intakeLeaseAt = new Date();
  const receivedAt = new Date();
  let durableFile;
  let job;
  let duplicate = false;

  const matchingSubmission = (existing) => (
    existing.requestFingerprint === requestFingerprint
    && existing.source === source
    && (source !== 'public' || (
      String(existing.jobAppliedFor || '') === String(context.job?._id || '')
      && String(existing.linkedCandidate || '') === String(linkedCandidate || '')
    ))
  );
  const loadExisting = () => CVProcessingJob.findOne({ organization: organizationId, idempotencyKey })
    .select('+requestFingerprint +intakeLeaseId');
  const claimStaleIntake = (existing) => CVProcessingJob.findOneAndUpdate(
    {
      _id: existing._id,
      state: 'queued',
      stage: 'received',
      'durableFile.fileId': { $exists: false },
      $or: [
        { intakeLeaseAt: { $exists: false } },
        { intakeLeaseAt: null },
        { intakeLeaseAt: { $lte: new Date(Date.now() - INTAKE_LEASE_MS) } }
      ]
    },
    { $set: { intakeLeaseId, intakeLeaseAt } },
    { new: true }
  ).select('+requestFingerprint +intakeLeaseId');

  try {
    let existing = idempotencyKey ? await loadExisting() : null;
    if (existing) {
      if (!matchingSubmission(existing)) throw idempotencyReuseError();
      if (existing.stage !== 'received' || existing.durableFile?.fileId) {
        try { await unlinkAsync(req.file.path); } catch {}
        return { job: existing, statusToken, duplicate: true };
      }
      job = await claimStaleIntake(existing);
      if (!job) {
        try { await unlinkAsync(req.file.path); } catch {}
        throw intakeInProgressError(
          'CV_INTAKE_IN_PROGRESS',
          'This exact CV intake is still being stored. Retry after the indicated delay.',
          existing.intakeLeaseAt
        );
      }
      publicId = job.publicId;
      duplicate = true;
    } else {
      try {
        job = await CVProcessingJob.create({
          publicId,
          statusTokenHash: tokenHash(statusToken),
          idempotencyKey,
          requestFingerprint,
          intakeLeaseId,
          intakeLeaseAt,
          state: 'queued',
          stage: 'received',
          stageStartedAt: receivedAt,
          stageHistory: [processingStageEvent('received', 'queued', 0, {}, null, receivedAt)],
          artifacts: { receivedAt, extractedTextLength: 0 },
          progress: 0,
          organization: organizationId,
          actor: req.user?.id || undefined,
          jobAppliedFor: context.job?._id || req.body?.jobId || undefined,
          source,
          billing: source === 'private' && req.creditsAction
            ? {
              required: true,
              action: req.creditsAction.action || 'uploadCandidate',
              cost: Number(req.creditsAction.cost || 0),
              state: 'pending',
              idempotencyKey: `cv-upload:${publicId}`
            }
            : { required: false, state: 'not_required' },
          originalName: req.file.originalname,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          linkedCandidate,
          supersedes: options.supersedes || undefined,
          revision: Math.max(1, Number(options.revision || 1)),
          formData: safeFormData(req.body)
        });
      } catch (error) {
        if (error?.code !== 11000 || !idempotencyKey) throw error;
        existing = await loadExisting();
        if (!existing || !matchingSubmission(existing)) throw idempotencyReuseError();
        if (existing.stage !== 'received' || existing.durableFile?.fileId) {
          try { await unlinkAsync(req.file.path); } catch {}
          return { job: existing, statusToken, duplicate: true };
        }
        job = await claimStaleIntake(existing);
        if (!job) {
          try { await unlinkAsync(req.file.path); } catch {}
          throw intakeInProgressError(
            'CV_INTAKE_IN_PROGRESS',
            'This exact CV intake is still being stored. Retry after the indicated delay.',
            existing.intakeLeaseAt
          );
        }
        publicId = job.publicId;
        duplicate = true;
      }
      if (!options.skipCandidateProjection) try {
        await syncLinkedCandidateProcessing(job, {
          state: 'accepted',
          stage: 'received',
          progress: 0,
          retryEligible: false,
          error: null
        });
      } catch (projectionError) {
        console.error('CV received candidate projection will be repaired:', projectionError.message);
      }
      await syncHistorySafely(job);
    }

    if (typeof intakeLifecycleHooks.afterReceipt === 'function') {
      await intakeLifecycleHooks.afterReceipt({ job, organizationId, source });
    }
    try {
      await requireOrganizationAcceptsCvWrites(organizationId);
      if (options.organizationWriteLease) {
        await organizationCvWriteFence.renew(options.organizationWriteLease);
      }
    } catch (error) {
      // No provider bytes exist yet. Remove the received receipt (and any
      // repair projection) so an intake authorized just before a tenant
      // tombstone cannot outlive that tenant.
      await Promise.all([
        CVProcessingJob.deleteOne({
          _id: job._id,
          state: 'queued',
          stage: 'received',
          'durableFile.fileId': { $exists: false },
          intakeLeaseId
        }),
        CVProcessingAudit.deleteOne({ publicId: job.publicId })
      ]).catch(() => {});
      throw error;
    }

    durableFile = await durableFileStore.persistPath(req.file.path, {
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      organizationId,
      source,
      intakeId: publicId,
      intakeKeyHash: crypto.createHash('sha256')
        .update(`${organizationId}:${idempotencyKey || publicId}`)
        .digest('hex'),
      requestFingerprint
    });
    if (options.organizationWriteLease) {
      // The GridFS side effect is now durable, but the job binding is not. A
      // lost fence aborts into the cleanup-outbox path below instead of
      // attaching bytes after an organization tombstone.
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
    const storedAt = durableFile.persistedAt || new Date();
    const storedEvent = processingStageEvent('stored', 'queued', 10, job, null, storedAt);
    const attached = await CVProcessingJob.findOneAndUpdate(
      {
        _id: job._id,
        state: 'queued',
        stage: 'received',
        intakeLeaseId
      },
      {
        $set: {
          durableFile,
          stage: 'stored',
          stageStartedAt: storedAt,
          progress: 10,
          'artifacts.durableStoredAt': storedAt
        },
        $unset: { intakeLeaseId: 1, intakeLeaseAt: 1, lastError: 1 },
        $push: {
          stageHistory: {
            $each: [storedEvent],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      },
      { new: true }
    ).select('+requestFingerprint +intakeLeaseId');
    if (attached) {
      job = attached;
    } else {
      const current = await CVProcessingJob.findById(job._id)
        .select('+requestFingerprint +intakeLeaseId');
      const sameDurableFile = current?.durableFile?.fileId
        && String(current.durableFile.fileId) === String(durableFile.fileId);
      if (!sameDurableFile) {
        await cleanupWithOutbox('gridfs', durableFile, {
          reason: 'intake-lease-lost'
        });
      }
      if (!current?.durableFile?.fileId) {
        throw submissionError(
          'CV_INTAKE_COMMIT_LOST',
          'The CV intake changed while its durable file was being committed. Retry with the same Idempotency-Key.',
          409
        );
      }
      job = current;
      duplicate = true;
    }
    if (!options.skipCandidateProjection) try {
      await syncLinkedCandidateProcessing(job, {
        state: 'accepted',
        stage: 'stored',
        progress: 10,
        retryEligible: false,
        error: null
      });
    } catch (projectionError) {
      // The GridFS object and processing job are already committed. Candidate
      // list projection is repairable and must never make us delete the only
      // durable copy or turn a successful acceptance into an HTTP failure.
      console.error('CV candidate processing projection will be repaired:', projectionError.message);
    }
    await syncHistorySafely(job);
  } catch (error) {
    const cleanupReference = durableFile || error.cleanupReference;
    const attachedFileId = job?._id
      ? (await CVProcessingJob.findById(job._id).select('durableFile.fileId').lean())?.durableFile?.fileId
      : null;
    if (cleanupReference && String(attachedFileId || '') !== String(cleanupReference.fileId || '')) {
      await cleanupWithOutbox('gridfs', cleanupReference, {
        reason: 'intake-storage-failed'
      }).catch((cleanupError) => {
        error.cleanupError = error.cleanupError || cleanupError;
      });
    }
    if (job?._id) {
      await CVProcessingJob.updateOne(
        { _id: job._id, stage: 'received', intakeLeaseId },
        {
          $set: {
            lastError: {
              code: String(error.code || 'CV_DURABLE_STORAGE_WRITE_FAILED').slice(0, 120),
              message: String(error.message || error).slice(0, 1000),
              stage: 'received',
              at: new Date()
            }
          },
          $unset: { intakeLeaseId: 1, intakeLeaseAt: 1 }
        }
      ).catch(() => {});
      await syncHistorySafely(job._id);
    }
    throw error;
  } finally {
    try { await unlinkAsync(req.file.path); } catch {}
  }

  let enqueueDeferred = options.deferEnqueue === true;
  if (!enqueueDeferred) {
    try {
      await enqueueJob(job);
    } catch (error) {
      enqueueDeferred = true;
      const nextAttemptAt = new Date(Date.now() + 60_000);
      const queueError = {
        code: error.code || 'CV_QUEUE_UNAVAILABLE',
        message: String(error.message).slice(0, 1000),
        stage: 'stored',
        at: new Date()
      };
      await CVProcessingJob.updateOne({ _id: job._id }, {
        $set: {
          stage: 'retry_scheduled',
          stageStartedAt: queueError.at,
          'retry.nextAttemptAt': nextAttemptAt,
          lastError: queueError
        },
        $push: {
          stageHistory: {
            $each: [processingStageEvent('retry_scheduled', 'queued', 10, job, queueError, queueError.at)],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      });
      job.stage = 'retry_scheduled';
      job.stageStartedAt = queueError.at;
      job.retry = { ...(job.retry?.toObject?.() || job.retry || {}), nextAttemptAt };
      job.lastError = queueError;
      await syncHistorySafely(job._id);
    }
  }
  if (!options.skipCandidateProjection) {
    try {
      await syncLinkedCandidateProcessing(job, {
        state: enqueueDeferred ? 'waiting' : 'queued',
        error: processingError(job),
        retryEligible: false
      });
    } catch (projectionError) {
      console.error('CV queued candidate projection will be repaired:', projectionError.message);
    }
  }
  publishTelemetrySoon();
  return { job, statusToken, duplicate, enqueueDeferred };
}

async function submitUpload(req, source = 'private', options = {}) {
  if (!req?.file) return submitUploadUnfenced(req, source, options);
  let context;
  try {
    context = await resolveSubmissionContext(req, source);
  } catch {
    return submitUploadUnfenced(req, source, options);
  }
  if (!context?.organizationId) return submitUploadUnfenced(req, source, options);
  let lease;
  try {
    lease = await organizationCvWriteFence.acquire(context.organizationId, `cv-intake:${source}`);
  } catch (error) {
    try { await unlinkAsync(req.file.path); } catch {}
    throw error;
  }
  const stopHeartbeat = organizationCvWriteFence.startHeartbeat(lease);
  try {
    return await submitUploadUnfenced(req, source, {
      ...options,
      organizationWriteLease: lease
    });
  } finally {
    stopHeartbeat();
    await organizationCvWriteFence.release(lease).catch(() => {});
  }
}

async function cancelReplacementRevision(replacement, reason = 'replacement-version-conflict') {
  const cancelledAt = new Date();
  const cancelled = await CVProcessingJob.findOneAndUpdate(
    {
      _id: replacement._id,
      state: { $in: ['queued', 'waiting_for_chatgpt', 'processing', 'failed'] }
    },
    {
      $set: {
        state: 'cancelled',
        stage: 'cancelled',
        stageStartedAt: cancelledAt,
        cancelledAt,
        cancellationReason: reason
      },
      $unset: {
        processingLeaseId: 1,
        'retry.availableUntil': 1,
        'retry.nextAttemptAt': 1,
        'retry.pendingTrigger': 1
      },
      $push: {
        stageHistory: {
          $each: [processingStageEvent(
            'cancelled', 'cancelled', replacement.progress, replacement, null, cancelledAt
          )],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    },
    { new: true }
  ).select('+resumeText');
  if (!cancelled) return false;
  await releaseDurableFile(cancelled).catch(() => {});
  await releaseCloudinaryAsset(cancelled).catch(() => {});
  await syncHistorySafely(cancelled._id);
  return true;
}

// A replacement is activated as a recoverable two-document state machine:
// first make the old revision permanently non-retryable, then switch the
// candidate's canonical pointer. Recovery can safely repeat either CAS.
async function activateReplacementRevision(replacementInput, priorInput) {
  const replacement = replacementInput?.publicId
    ? replacementInput
    : await CVProcessingJob.findById(replacementInput).select('+resumeText');
  if (!replacement?.supersedes || !replacement.linkedCandidate) return true;
  const prior = priorInput?.publicId
    ? priorInput
    : await CVProcessingJob.findById(replacement.supersedes).select('+resumeText');
  if (!prior || String(prior.organization) !== String(replacement.organization)) {
    await cancelReplacementRevision(replacement, 'replacement-prior-missing');
    return false;
  }

  const superseded = await CVProcessingJob.updateOne(
    {
      _id: prior._id,
      $or: [
        { supersededBy: { $exists: false } },
        { supersededBy: null },
        { supersededBy: replacement._id }
      ]
    },
    {
      $set: { supersededBy: replacement._id },
      $unset: {
        'retry.availableUntil': 1,
        'retry.nextAttemptAt': 1,
        'retry.pendingTrigger': 1
      }
    }
  );
  if (!Number(superseded.matchedCount || superseded.n || 0)) {
    const winningPrior = await CVProcessingJob.findById(prior._id).select('supersededBy');
    if (String(winningPrior?.supersededBy || '') !== String(replacement._id)) {
      await cancelReplacementRevision(replacement, 'replacement-supersession-conflict');
      return false;
    }
  }

  const switched = await Candidate.updateOne(
    {
      _id: replacement.linkedCandidate,
      organization: replacement.organization,
      jobAppliedFor: replacement.jobAppliedFor,
      deletionState: { $ne: 'tombstoned' },
      $or: [
        { 'processingMetadata.cvProcessingJobId': prior.publicId },
        { 'processingMetadata.cvProcessingJobId': replacement.publicId }
      ]
    },
    {
      $set: {
        'processingMetadata.cvProcessingJobId': replacement.publicId,
        'processingMetadata.cvIngestionState': candidateIngestionState(replacement),
        'processingMetadata.cvProcessingStage': replacement.stage,
        'processingMetadata.cvProcessingProgress': replacement.progress,
        'processingMetadata.cvProcessingUpdatedAt': new Date(),
        'processingMetadata.cvRetryEligible': false
      },
      $unset: { 'processingMetadata.cvProcessingError': 1 }
    }
  );
  if (!Number(switched.matchedCount || switched.n || 0)) {
    const alreadyCurrent = await Candidate.exists({
      _id: replacement.linkedCandidate,
      organization: replacement.organization,
      deletionState: { $ne: 'tombstoned' },
      'processingMetadata.cvProcessingJobId': replacement.publicId
    });
    if (!alreadyCurrent) {
      await cancelReplacementRevision(replacement, 'replacement-version-conflict');
      return false;
    }
  }
  return true;
}

async function repairReplacementActivations({ limit = 500 } = {}) {
  const replacements = await CVProcessingJob.find({
    supersedes: { $exists: true },
    state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] }
  }).sort({ createdAt: 1 }).limit(Math.min(Math.max(Number(limit) || 500, 1), 2000));
  let repaired = 0;
  let cancelled = 0;
  for (const replacement of replacements) {
    const activated = await activateReplacementRevision(replacement);
    if (activated) repaired += 1;
    else cancelled += 1;
  }
  return { examined: replacements.length, repaired, cancelled };
}

async function replaceFailedJob(req, priorPublicId) {
  const organizationId = req.user?.currentOrganization;
  const discardIncoming = async () => {
    if (req.file?.path) {
      try { await unlinkAsync(req.file.path); } catch {}
    }
  };
  if (!organizationId || !mongoose.isValidObjectId(organizationId)) {
    await discardIncoming();
    throw manualRetryError('CV_REPLACEMENT_ORGANIZATION_REQUIRED', 'Organization is required', 400);
  }
  if (!req.file) {
    throw manualRetryError('CV_REPLACEMENT_FILE_REQUIRED', 'A corrected CV file is required', 400);
  }
  const expectedPriorJobId = String(req.body?.expectedPriorJobId || '').trim();
  if (!expectedPriorJobId || expectedPriorJobId !== String(priorPublicId || '')) {
    await discardIncoming();
    throw manualRetryError(
      'CV_REPLACEMENT_VERSION_MISMATCH',
      'The expected prior CV job does not match this replacement request',
      409
    );
  }
  if (!String(req.get?.('Idempotency-Key') || '').trim()) {
    await discardIncoming();
    throw manualRetryError(
      'CV_IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key is required for corrected CV uploads',
      400
    );
  }
  const prior = await CVProcessingJob.findOne({
    publicId: String(priorPublicId || ''),
    organization: organizationId,
    state: 'failed',
    source: { $in: ['public', 'replacement'] },
    linkedCandidate: { $ne: null }
  });
  if (!prior) {
    await discardIncoming();
    throw manualRetryError(
      'CV_REPLACEMENT_NOT_ELIGIBLE',
      'This CV job is not eligible for corrected-file replacement',
      409
    );
  }
  if (!prior.supersededBy) {
    const persistedSuccessor = await CVProcessingJob.findOne({
      supersedes: prior._id,
      organization: organizationId,
      state: { $ne: 'cancelled' }
    }).sort({ revision: -1, createdAt: 1 }).select('+requestFingerprint +resumeText');
    if (persistedSuccessor) {
      await activateReplacementRevision(persistedSuccessor, prior);
      const refreshedPrior = await CVProcessingJob.findById(prior._id).select('supersededBy');
      prior.supersededBy = refreshedPrior?.supersededBy;
    }
  }
  if (prior.supersededBy) {
    const current = await CVProcessingJob.findOne({
      _id: prior.supersededBy,
      organization: organizationId,
      supersedes: prior._id
    }).select('+requestFingerprint');
    const suppliedKey = String(req.get?.('Idempotency-Key') || '').trim();
    req.body = {
      ...(req.body || {}),
      jobId: String(prior.jobAppliedFor || ''),
      candidateId: String(prior.linkedCandidate || '')
    };
    const incomingFingerprint = await uploadRequestFingerprint(
      req,
      'replacement',
      organizationId,
      prior.jobAppliedFor,
      prior.linkedCandidate
    );
    await discardIncoming();
    if (
      !current
      || current.idempotencyKey !== suppliedKey
      || current.requestFingerprint !== incomingFingerprint
    ) {
      throw idempotencyReuseError();
    }
    return {
      job: current,
      statusToken: idempotentStatusToken(organizationId, suppliedKey),
      duplicate: true,
      enqueueDeferred: false,
      queueAvailable: true,
      priorJobId: prior.publicId,
      replacement: true
    };
  }
  const candidate = await Candidate.findOne({
    _id: prior.linkedCandidate,
    organization: organizationId,
    'processingMetadata.cvProcessingJobId': prior.publicId
  }).select('_id processingMetadata');
  if (!candidate) {
    await discardIncoming();
    throw manualRetryError(
      'CV_REPLACEMENT_VERSION_MISMATCH',
      'A newer CV revision already owns this candidate',
      409
    );
  }

  req.body = {
    ...(req.body || {}),
    jobId: String(prior.jobAppliedFor || ''),
    candidateId: String(candidate._id)
  };
  const submitted = await submitUpload(req, 'replacement', {
    linkedCandidateId: candidate._id,
    deferEnqueue: true,
    skipCandidateProjection: true,
    supersedes: prior._id,
    revision: Number(prior.revision || 1) + 1
  });
  const replacement = submitted.job;
  if (!(await activateReplacementRevision(replacement, prior))) {
    throw manualRetryError(
      'CV_REPLACEMENT_VERSION_MISMATCH',
      'A newer CV revision already owns this candidate',
      409
    );
  }
  let queueAvailable = true;
  try {
    await enqueueJob(replacement);
  } catch (error) {
    queueAvailable = false;
    const at = new Date();
    await CVProcessingJob.updateOne(
      { _id: replacement._id, state: 'queued' },
      {
        $set: {
          stage: 'retry_scheduled',
          stageStartedAt: at,
          'retry.nextAttemptAt': new Date(Date.now() + 60_000),
          lastError: {
            code: error.code || 'CV_QUEUE_UNAVAILABLE',
            message: String(error.message || error).slice(0, 1000),
            stage: 'stored',
            at
          }
        },
        $push: {
          stageHistory: {
            $each: [processingStageEvent('retry_scheduled', 'queued', replacement.progress, replacement, error, at)],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      }
    );
    replacement.stage = 'retry_scheduled';
  }
  await syncLinkedCandidateProcessing(replacement, {
    state: queueAvailable ? 'queued' : 'waiting',
    stage: replacement.stage,
    error: queueAvailable ? null : processingError(replacement),
    retryEligible: false
  });
  await Promise.all([syncHistorySafely(prior._id), syncHistorySafely(replacement._id)]);
  publishTelemetrySoon();
  return {
    ...submitted,
    job: replacement,
    queueAvailable,
    priorJobId: prior.publicId,
    replacement: true
  };
}

const PERMANENT_BILLING_FAILURE_CODES = new Set([
  'INSUFFICIENT_CREDITS',
  'INVALID_CREDIT_CONTEXT',
  'CREDIT_IDEMPOTENCY_KEY_REQUIRED',
  'CREDIT_ORGANIZATION_NOT_FOUND',
  'CREDIT_PLAN_NOT_CONFIGURED',
  'CREDIT_BALANCE_ERROR',
  'INVALID_CREDIT_COST'
]);

function permanentBillingFailure(error, attempts) {
  return error?.permanent === true
    || PERMANENT_BILLING_FAILURE_CODES.has(String(error?.code || ''))
    || Number(attempts || 0) >= MAX_BILLING_FAILURE_ATTEMPTS;
}

async function cleanupTerminalBillingFailure(processingJobId) {
  const terminalJob = await CVProcessingJob.findById(processingJobId);
  if (!terminalJob || terminalJob.state !== 'failed') return;
  await releaseCloudinaryAsset(terminalJob).catch((error) => {
    console.error('CV billing failure cloud asset cleanup failed:', error.message);
  });
  await releaseDurableFile(terminalJob).catch((error) => {
    console.error('CV billing failure durable file cleanup failed:', error.message);
  });
  await finalizeTerminalExpiry(terminalJob).catch((error) => {
    console.error('CV billing failure retention finalization failed:', error.message);
  });
}

async function finalizePrivateUploadSubmission(processingJob, req) {
  const freshJob = await CVProcessingJob.findById(processingJob._id);
  if (!freshJob) {
    throw submissionError('CV_JOB_NOT_FOUND', 'CV processing job was not found after ingestion', 500);
  }

  if (freshJob.stage === 'received' && !freshJob.durableFile?.fileId) {
    return {
      billing: {
        status: freshJob.billing?.state || 'pending',
        charged: false,
        retryable: true
      },
      enqueueDeferred: true
    };
  }

  if (!freshJob.billing?.required) {
    // Direct service callers and historical jobs do not use route billing.
    let enqueueDeferred = false;
    try {
      await enqueueJob(freshJob);
    } catch (error) {
      enqueueDeferred = true;
      await CVProcessingJob.updateOne(
        { _id: freshJob._id },
        {
          $set: {
            lastError: {
              code: error.code || 'CV_QUEUE_UNAVAILABLE',
              message: String(error.message).slice(0, 1000),
              at: new Date()
            }
          }
        }
      );
    }
    return {
      billing: { status: 'not_required', charged: false },
      enqueueDeferred
    };
  }

  if (
    freshJob.billing.state === 'failed'
    && freshJob.billing.failureDisposition === 'permanent'
  ) {
    return {
      billing: {
        status: 'failed',
        charged: false,
        retryable: false,
        terminal: true,
        error: freshJob.billing.lastError
      },
      enqueueDeferred: true
    };
  }

  if (freshJob.billing.state === 'charged') {
    let enqueueDeferred = false;
    try {
      await enqueueJob(freshJob);
    } catch (error) {
      enqueueDeferred = true;
    }
    return {
      billing: {
        status: 'charged',
        charged: true,
        replay: true,
        cost: Number(freshJob.billing.cost || 0)
      },
      enqueueDeferred
    };
  }

  const actorId = freshJob.actor || req.user?.id;
  const action = freshJob.billing.action || req.creditsAction?.action || 'uploadCandidate';
  const cost = Number(freshJob.billing.cost ?? req.creditsAction?.cost ?? 0);
  const idempotencyKey = freshJob.billing.idempotencyKey || `cv-upload:${freshJob.publicId}`;
  const attemptedAt = new Date();

  try {
    const charged = await creditsService.consumeCreditsIdempotently(
      freshJob.organization,
      action,
      freshJob._id,
      'candidate',
      actorId,
      {
        idempotencyKey,
        creditCostOverride: cost,
        cvProcessingJobId: String(freshJob._id),
        cvProcessingJobPublicId: freshJob.publicId
      }
    );
    if (!charged.success) {
      const error = new Error(charged.message || 'CV upload credits could not be charged');
      error.code = charged.error || 'CV_CREDIT_CHARGE_FAILED';
      error.retryable = charged.retryable === true;
      error.permanent = charged.permanent === true;
      throw error;
    }

    await CVProcessingJob.updateOne(
      { _id: freshJob._id },
      {
        $set: {
          'billing.state': 'charged',
          'billing.idempotencyKey': idempotencyKey,
          'billing.chargedAt': new Date(),
          'billing.lastAttemptAt': attemptedAt
        },
        $unset: {
          'billing.lastError': 1,
          'billing.failureDisposition': 1,
          'billing.nextAttemptAt': 1,
          'billing.terminalAt': 1
        }
      }
    );
    freshJob.billing.state = 'charged';
    freshJob.billing.chargedAt = new Date();

    let enqueueDeferred = false;
    try {
      await enqueueJob(freshJob);
    } catch (error) {
      enqueueDeferred = true;
      await CVProcessingJob.updateOne(
        { _id: freshJob._id },
        {
          $set: {
            lastError: {
              code: error.code || 'CV_QUEUE_UNAVAILABLE',
              message: String(error.message).slice(0, 1000),
              at: new Date()
            }
          }
        }
      );
    }
    return {
      billing: {
        status: 'charged',
        charged: true,
        replay: charged.alreadyConsumed === true,
        cost: Number(charged.credits || 0)
      },
      enqueueDeferred
    };
  } catch (error) {
    const attempts = Number(freshJob.billing.attempts || 0) + 1;
    const terminal = permanentBillingFailure(error, attempts);
    const nextAttemptAt = terminal
      ? undefined
      : new Date(attemptedAt.getTime() + billingRetryDelay(attempts));
    const code = error.code || 'CV_CREDIT_CHARGE_FAILED';
    const message = String(error.message).slice(0, 1000);
    await CVProcessingJob.updateOne(
      { _id: freshJob._id },
      {
        $set: {
          'billing.state': 'failed',
          'billing.idempotencyKey': idempotencyKey,
          'billing.attempts': attempts,
          'billing.failureDisposition': terminal ? 'permanent' : 'retryable',
          'billing.lastAttemptAt': attemptedAt,
          'billing.lastError': { code, message },
          ...(terminal
            ? {
              'billing.terminalAt': attemptedAt,
              state: 'failed',
              stage: 'failed',
              failedAt: attemptedAt,
              lastError: { code, message, at: attemptedAt }
            }
            : {
              'billing.nextAttemptAt': nextAttemptAt,
              state: 'queued'
            })
        },
        $unset: terminal
          ? {
            'billing.nextAttemptAt': 1,
            expiresAt: 1
          }
          : {
            'billing.terminalAt': 1,
            expiresAt: 1
          }
      }
    );
    await syncHistorySafely(freshJob._id);
    if (terminal) await cleanupTerminalBillingFailure(freshJob._id);
    publishTelemetrySoon();
    return {
      billing: {
        status: 'failed',
        charged: false,
        retryable: !terminal,
        terminal,
        nextAttemptAt,
        error: { code, message }
      },
      enqueueDeferred: true
    };
  }
}

async function recoverPendingPrivateBilling() {
  const now = new Date();
  const pending = await CVProcessingJob.find({
    source: 'private',
    state: { $ne: 'failed' },
    'billing.required': true,
    $or: [
      {
        'billing.state': 'pending',
        updatedAt: { $lt: new Date(now.getTime() - 60_000) }
      },
      {
        'billing.state': 'failed',
        'billing.failureDisposition': 'retryable',
        'billing.nextAttemptAt': { $lte: now }
      }
    ]
  })
    .sort({ createdAt: 1 })
    .limit(100);
  let recovered = 0;
  for (const job of pending) {
    const result = await finalizePrivateUploadSubmission(job, {
      user: { id: job.actor },
      creditsAction: {
        action: job.billing.action,
        cost: job.billing.cost,
        entityType: 'candidate'
      }
    });
    if (result.billing.status === 'charged') recovered += 1;
  }
  return recovered;
}

function candidatePayload(job, result) {
  const fields = result.extractedFields || {};
  const form = job.formData || {};
  return {
    firstName: fields.firstName || form.firstName || 'REVIEW',
    lastName: fields.lastName || form.lastName || 'REQUIRED',
    email: fields.email || form.email || `cv-${job.publicId}@placeholder.invalid`,
    phone: fields.phone || form.phone || 'Not provided',
    position: form.position || fields.position || 'Position TBD',
    experience: fields.experience || form.experience || 'See CV',
    education: fields.education || form.education || 'See CV',
    skills: Array.isArray(fields.skills) ? fields.skills.join(', ') : (fields.skills || form.skills || ''),
    location: fields.location || form.location || '',
    resumeUrl: job.cloudinary.resumeUrl,
    resumeText: job.resumeText,
    coverLetter: form.coverLetter || '',
    status: 'New',
    source: job.source === 'bulk' ? 'Bulk Upload' : 'Uploaded CV',
    organization: job.organization,
    createdBy: job.actor,
    jobAppliedFor: job.jobAppliedFor,
    cloudinaryPublicId: job.cloudinary.publicId,
    cloudinaryResourceType: job.cloudinary.resourceType,
    cloudinaryDeliveryType: job.cloudinary.deliveryType,
    resumeStorageProvider: job.cloudinary.storageProvider || 'cloudinary',
    resumeStorageKey: job.cloudinary.storageKey || job.cloudinary.publicId,
    resumeStorageContainer: job.cloudinary.storageContainer,
    resumeStorageResourceType: job.cloudinary.resourceType,
    parsedData: fields,
    aiAnalysis: result.aiAnalysis || {},
    workExperience: result.workExperience || fields.workExperience,
    educationHistory: fields.educationHistory || [],
    certifications: fields.certifications || [],
    languages: fields.languages || [],
    awards: fields.awards || [],
    projects: fields.projects || [],
    publications: fields.publications || [],
    volunteerWork: fields.volunteerWork || [],
    professionalMemberships: fields.professionalMemberships || [],
    portfolioLinks: fields.portfolioLinks || {},
    additionalSections: fields.additionalSections || {},
    fullCVData: fields.fullCVData || fields,
    processingMetadata: {
      uploadSuccess: true,
      parseSuccess: true,
      aiSuccess: true,
      fileSize: job.fileSize,
      originalName: job.originalName,
      processedAt: new Date(),
      cvProcessingJobId: job.publicId,
      cvIngestionState: 'completed',
      cvProcessingStage: 'completed',
      cvProcessingProgress: 100,
      cvProcessingUpdatedAt: new Date(),
      cvRetryEligible: false
    }
  };
}

async function updateProcessingStage(processingJob, bullJob, stage, progress, extra = {}) {
  const stageStartedAt = new Date();
  const stageEvent = processingStageEvent(stage, 'processing', progress, processingJob, null, stageStartedAt);
  const updated = await CVProcessingJob.updateOne(
    {
      _id: processingJob._id,
      state: 'processing',
      processingLeaseId: processingJob.processingLeaseId
    },
    {
      $set: { state: 'processing', stage, stageStartedAt, progress, ...extra },
      $push: {
        stageHistory: {
          $each: [stageEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    }
  );
  if (!updated.matchedCount) {
    const error = new Error('CV processing was cancelled or superseded');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }
  processingJob.state = 'processing';
  processingJob.stage = stage;
  processingJob.stageStartedAt = stageStartedAt;
  processingJob.stageHistory = [...(processingJob.stageHistory || []), stageEvent]
    .slice(-HISTORY_TRANSITION_LIMIT);
  processingJob.progress = progress;
  Object.assign(processingJob, extra);
  await syncLinkedCandidateProcessing(processingJob, { error: null, retryEligible: false });
  await syncHistorySafely(processingJob._id);
  await bullJob.updateProgress(progress);
  publishTelemetrySoon();
}

function cleanupTaskResource(provider, input = {}) {
  if (provider === 'gridfs') {
    if (!input.fileId) throw new Error('GridFS cleanup requires a file ID');
    const configuredBucket = String(
      process.env.CV_INGESTION_GRIDFS_BUCKET || 'cv_ingestion_files'
    ).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120) || 'cv_ingestion_files';
    const referencedBucket = String(input.bucket || configuredBucket);
    if (!new Set([configuredBucket, 'cv_ingestion_files']).has(referencedBucket)) {
      const error = new Error('GridFS cleanup bucket is invalid');
      error.code = 'CV_DURABLE_FILE_INVALID';
      throw error;
    }
    return {
      bucket: referencedBucket,
      fileId: String(input.fileId).slice(0, 100)
    };
  }
  if (provider === 'cloudinary') {
    if (!input.publicId && !input.storageKey) throw new Error('Managed file cleanup requires a storage key');
    return {
      publicId: String(input.publicId || input.storageKey).slice(0, 500),
      storageProvider: input.storageProvider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
      storageKey: String(input.storageKey || input.publicId).slice(0, 500),
      storageContainer: input.storageContainer ? String(input.storageContainer).slice(0, 100) : undefined,
      assetId: String(input.assetId || '').slice(0, 200),
      resourceType: String(input.resourceType || 'raw').slice(0, 40),
      deliveryType: String(input.deliveryType || 'authenticated').slice(0, 40)
    };
  }
  if (provider === 'embedding') {
    if (!mongoose.isValidObjectId(input.candidateId)) {
      throw new Error('Embedding cleanup requires a candidate ID');
    }
    return { candidateId: String(input.candidateId) };
  }
  throw new Error(`Unsupported CV cleanup provider: ${provider}`);
}

function cleanupTaskKey(provider, resource, generation) {
  const identity = provider === 'gridfs'
    ? `${resource.bucket}:${resource.fileId}`
    : provider === 'embedding'
      ? resource.candidateId
      : `${resource.storageProvider || 'cloudinary'}:${resource.assetId || resource.storageKey || resource.publicId}:${resource.resourceType}:${resource.deliveryType}`;
  return crypto.createHash('sha256')
    .update(`recruiter:${provider}:${identity}:${generation || 'resource'}`)
    .digest('hex');
}

async function registerCleanupTask(provider, input, {
  reason,
  jobPublicId,
  held = false,
  activationKey,
  generationKey,
  notBefore,
  reconcileUntil
} = {}) {
  const resource = cleanupTaskResource(provider, input);
  // Candidate erasure is versioned by its tombstone activation token. A
  // deterministic public Candidate ID can be created again later with a new
  // embedding or CV, so a completed task from an earlier deletion must never
  // suppress cleanup for the new resource generation.
  const key = cleanupTaskKey(
    provider,
    resource,
    held ? activationKey : generationKey
  );
  return CVStorageCleanupTask.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        provider,
        state: held ? 'held' : 'pending',
        resource,
        reason: String(reason || 'cv-storage-release').slice(0, 120),
        jobPublicId: jobPublicId ? String(jobPublicId).slice(0, 100) : undefined,
        activationKey: held ? String(activationKey || '') : undefined,
        attempts: 0,
        notBefore: notBefore ? new Date(notBefore) : undefined,
        reconcileUntil: reconcileUntil ? new Date(reconcileUntil) : undefined,
        nextAttemptAt: held ? undefined : (notBefore ? new Date(notBefore) : new Date())
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function registerRequiredErasureTask(provider, resource, context) {
  try {
    return await registerCleanupTask(provider, resource, context);
  } catch (cause) {
    const error = manualRetryError(
      'CV_ERASURE_REGISTRATION_FAILED',
      'Candidate erasure could not be scheduled safely. Please retry.',
      503
    );
    error.cause = cause;
    throw error;
  }
}

async function executeCleanupTask(task, {
  cloudinaryOutcomeConfirmed = false,
  now = new Date()
} = {}) {
  if (!task || task.state === 'completed') return true;
  const attemptedAt = new Date(now);
  const attempts = Number(task.attempts || 0) + 1;
  await CVStorageCleanupTask.updateOne(
    { _id: task._id, state: { $ne: 'completed' } },
    {
      $set: {
        state: 'pending',
        attempts,
        lastAttemptAt: attemptedAt
      },
      $unset: {
        nextAttemptAt: 1,
        lastError: 1,
        expiresAt: 1
      }
    }
  );
  try {
    if (task.provider === 'gridfs') {
      await durableFileStore.remove({
        provider: 'gridfs',
        bucket: task.resource?.bucket,
        fileId: task.resource?.fileId
      });
    } else if (task.provider === 'cloudinary') {
      if (task.resource?.assetId && typeof cloudinary.getFileInfo === 'function') {
        const current = await cloudinary.getFileInfo(
          task.resource.publicId,
          task.resource.resourceType || 'raw'
        );
        if (current?.success && current.info?.asset_id && current.info.asset_id !== task.resource.assetId) {
          await CVStorageCleanupTask.updateOne(
            { _id: task._id },
            {
              $set: {
                state: 'completed',
                completedAt: attemptedAt,
                expiresAt: terminalJobExpiry(attemptedAt.getTime())
              },
              $unset: { nextAttemptAt: 1, lastError: 1 }
            }
          );
          return true;
        }
      }
      const result = await cloudinary.deleteFile(
        task.resource?.publicId,
        task.resource?.resourceType || 'raw',
        task.resource?.deliveryType || 'authenticated',
        {
          storageProvider: task.resource?.storageProvider,
          storageKey: task.resource?.storageKey || task.resource?.publicId,
          storageContainer: task.resource?.storageContainer
        }
      );
      if (!result?.success) {
        const error = new Error(result?.error || 'Cloudinary cleanup failed');
        error.code = 'CV_CLOUD_CLEANUP_FAILED';
        throw error;
      }
      if (
        !cloudinaryOutcomeConfirmed
        && String(task.reason || '').includes('upload-intent')
        && task.reconcileUntil
        && task.reconcileUntil > attemptedAt
      ) {
        const nextAttemptAt = new Date(Math.min(
          task.reconcileUntil.getTime(),
          attemptedAt.getTime() + CLOUD_UPLOAD_UNCERTAINTY_MS
        ));
        await CVStorageCleanupTask.updateOne(
          { _id: task._id, state: { $ne: 'completed' } },
          {
            $set: {
              state: 'pending',
              attempts,
              lastAttemptAt: attemptedAt,
              nextAttemptAt
            },
            $unset: { lastError: 1, expiresAt: 1 }
          }
        );
        return false;
      }
    } else if (task.provider === 'embedding') {
      const currentCandidate = await Candidate.findById(task.resource?.candidateId)
        .select('+deletionState +deletionToken')
        .lean();
      const sameTombstoneGeneration = currentCandidate?.deletionState === 'tombstoned'
        && task.activationKey
        && currentCandidate.deletionToken === task.activationKey;
      // Deterministic public Candidate IDs can be recreated. An old failed
      // erasure must never delete the replacement candidate's new vector.
      if (!currentCandidate || sameTombstoneGeneration) {
        await embeddingService.deleteEmbedding(task.resource?.candidateId);
      }
    } else {
      throw new Error(`Unsupported CV cleanup provider: ${task.provider}`);
    }
    await CVStorageCleanupTask.updateOne(
      { _id: task._id },
      {
        $set: {
          state: 'completed',
          completedAt: attemptedAt,
          expiresAt: terminalJobExpiry(attemptedAt.getTime())
        },
        $unset: { nextAttemptAt: 1, lastError: 1 }
      }
    );
    return true;
  } catch (error) {
    await CVStorageCleanupTask.updateOne(
      { _id: task._id },
      {
        $set: {
          state: 'failed',
          attempts,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: new Date(attemptedAt.getTime() + cleanupRetryDelay(attempts)),
          lastError: String(error.message || error).slice(0, 1000)
        },
        $unset: { expiresAt: 1 }
      }
    );
    throw error;
  }
}

async function cleanupWithOutbox(provider, resource, context) {
  const task = await registerCleanupTask(provider, resource, context);
  await executeCleanupTask(task);
  return true;
}

function hasOutstandingTerminalCleanup(job) {
  const durableOutstanding = Boolean(
    job?.durableFile?.fileId
    && !job.durableFile.releasedAt
    && job.durableFile.cleanupState !== 'deleted'
  );
  const cloudinaryOutstanding = Boolean(
    job?.state === 'failed'
    && job?.cloudinary?.publicId
    && !job.cloudinary.releasedAt
    && job.cloudinary.cleanupState !== 'deleted'
  );
  const completionEffectsOutstanding = Boolean(
    job?.state === 'completed'
    && !job.completionEffectsCompletedAt
  );
  return durableOutstanding || cloudinaryOutstanding || completionEffectsOutstanding;
}

async function finalizeTerminalExpiry(processingJob) {
  const current = await CVProcessingJob.findById(processingJob._id)
    .select('state durableFile cloudinary completionEffectsCompletedAt expiresAt')
    .lean();
  if (!current || !['completed', 'failed', 'cancelled'].includes(current.state)) return false;
  if (hasOutstandingTerminalCleanup(current)) {
    if (current.expiresAt) {
      await CVProcessingJob.updateOne({ _id: current._id }, { $unset: { expiresAt: 1 } });
    }
    return false;
  }
  if (!current.expiresAt) {
    await CVProcessingJob.updateOne(
      { _id: current._id, state: { $in: ['completed', 'failed', 'cancelled'] }, expiresAt: { $exists: false } },
      { $set: { expiresAt: terminalJobExpiry() } }
    );
  }
  return true;
}

async function releaseDurableFile(processingJob) {
  if (!processingJob.durableFile?.fileId || processingJob.durableFile?.releasedAt) {
    await finalizeTerminalExpiry(processingJob);
    return false;
  }
  const attemptedAt = new Date();
  const attempts = Number(processingJob.durableFile.cleanupAttempts || 0) + 1;
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    {
      $set: {
        'durableFile.cleanupState': 'pending',
        'durableFile.cleanupAttempts': attempts,
        'durableFile.cleanupAttemptedAt': attemptedAt
      },
      $unset: {
        'durableFile.cleanupNextAttemptAt': 1,
        'durableFile.cleanupError': 1,
        expiresAt: 1
      }
    }
  );
  try {
    await cleanupWithOutbox('gridfs', processingJob.durableFile, {
      reason: 'terminal-job-durable-file',
      jobPublicId: processingJob.publicId
    });
  } catch (error) {
    const nextAttemptAt = new Date(attemptedAt.getTime() + cleanupRetryDelay(attempts));
    await CVProcessingJob.updateOne(
      { _id: processingJob._id },
      {
        $set: {
          'durableFile.cleanupState': 'failed',
          'durableFile.cleanupAttempts': attempts,
          'durableFile.cleanupAttemptedAt': attemptedAt,
          'durableFile.cleanupNextAttemptAt': nextAttemptAt,
          'durableFile.cleanupError': String(error.message || error).slice(0, 1000)
        },
        $unset: { expiresAt: 1 }
      }
    );
    Object.assign(processingJob.durableFile, {
      cleanupState: 'failed',
      cleanupAttempts: attempts,
      cleanupAttemptedAt: attemptedAt,
      cleanupNextAttemptAt: nextAttemptAt,
      cleanupError: String(error.message || error).slice(0, 1000)
    });
    throw error;
  }
  const releasedAt = new Date();
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    {
      $set: {
        'durableFile.cleanupState': 'deleted',
        'durableFile.cleanupAttempts': attempts,
        'durableFile.cleanupAttemptedAt': attemptedAt,
        'durableFile.releasedAt': releasedAt
      },
      $unset: {
        'durableFile.cleanupNextAttemptAt': 1,
        'durableFile.cleanupError': 1
      }
    }
  );
  Object.assign(processingJob.durableFile, {
    cleanupState: 'deleted',
    cleanupAttempts: attempts,
    cleanupAttemptedAt: attemptedAt,
    releasedAt
  });
  await finalizeTerminalExpiry(processingJob);
  return true;
}

async function releaseCloudinaryAsset(processingJob) {
  if (
    processingJob.state === 'completed'
    || !processingJob.cloudinary?.publicId
    || processingJob.cloudinary?.releasedAt
  ) {
    await finalizeTerminalExpiry(processingJob);
    return false;
  }
  const attemptedAt = new Date();
  const attempts = Number(processingJob.cloudinary.cleanupAttempts || 0) + 1;
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    {
      $set: {
        'cloudinary.cleanupState': 'pending',
        'cloudinary.cleanupAttempts': attempts,
        'cloudinary.cleanupAttemptedAt': attemptedAt
      },
      $unset: {
        'cloudinary.cleanupNextAttemptAt': 1,
        'cloudinary.cleanupError': 1,
        expiresAt: 1
      }
    }
  );
  try {
    await cleanupWithOutbox('cloudinary', processingJob.cloudinary, {
      reason: 'terminal-job-cloudinary-asset',
      jobPublicId: processingJob.publicId
    });
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    const nextAttemptAt = new Date(attemptedAt.getTime() + cleanupRetryDelay(attempts));
    await CVProcessingJob.updateOne(
      { _id: processingJob._id },
      {
        $set: {
          'cloudinary.cleanupState': 'failed',
          'cloudinary.cleanupAttempts': attempts,
          'cloudinary.cleanupAttemptedAt': attemptedAt,
          'cloudinary.cleanupNextAttemptAt': nextAttemptAt,
          'cloudinary.cleanupError': message
        },
        $unset: { expiresAt: 1 }
      }
    );
    Object.assign(processingJob.cloudinary, {
      cleanupState: 'failed',
      cleanupAttempts: attempts,
      cleanupAttemptedAt: attemptedAt,
      cleanupNextAttemptAt: nextAttemptAt,
      cleanupError: message
    });
    throw error;
  }
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    {
      $set: {
        'cloudinary.cleanupState': 'deleted',
        'cloudinary.cleanupAttempts': attempts,
        'cloudinary.cleanupAttemptedAt': attemptedAt,
        'cloudinary.releasedAt': attemptedAt
      },
      $unset: {
        'cloudinary.resumeUrl': 1,
        'cloudinary.cleanupNextAttemptAt': 1,
        'cloudinary.cleanupError': 1
      }
    }
  );
  processingJob.cloudinary.cleanupState = 'deleted';
  processingJob.cloudinary.cleanupAttempts = attempts;
  processingJob.cloudinary.cleanupAttemptedAt = attemptedAt;
  processingJob.cloudinary.releasedAt = attemptedAt;
  processingJob.cloudinary.resumeUrl = undefined;
  await finalizeTerminalExpiry(processingJob);
  return true;
}

async function createCandidateWithinOrganizationFence(processingJob, analysis) {
  const active = await CVProcessingJob.exists({
    _id: processingJob._id,
    state: 'processing',
    processingLeaseId: processingJob.processingLeaseId
  });
  if (!active) {
    const error = new Error('CV processing was cancelled or superseded');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }
  if (!await organizationAcceptsCvWrites(processingJob.organization)) {
    const cancelledAt = new Date();
    await CVProcessingJob.updateOne(
      {
        _id: processingJob._id,
        state: 'processing',
        processingLeaseId: processingJob.processingLeaseId
      },
      {
        $set: {
          state: 'cancelled',
          stage: 'cancelled',
          cancelledAt,
          stageStartedAt: cancelledAt,
          cancellationReason: 'organization-deleted'
        },
        $unset: { processingLeaseId: 1, expiresAt: 1 }
      }
    );
    const error = new Error('CV processing was cancelled because its organization is being deleted');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }
  if (processingJob.linkedCandidate) {
    const candidate = await mergeAnalysisOntoCandidate(processingJob, analysis);
    if (await organizationAcceptsCvWrites(processingJob.organization)) return candidate;
    await eraseCandidateProcessingData(processingJob.organization, [candidate._id]).catch(() => {});
    const error = new Error('Candidate enrichment was cancelled during organization deletion');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }

  const filter = { 'processingMetadata.cvProcessingJobId': processingJob.publicId };
  const existing = await Candidate.findOne(filter);
  if (existing) {
    if (await organizationAcceptsCvWrites(processingJob.organization)) return existing;
    await eraseCandidateProcessingData(processingJob.organization, [existing._id]).catch(() => {});
    const error = new Error('Candidate recovery was cancelled during organization deletion');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }
  const deterministicId = new mongoose.Types.ObjectId(
    crypto.createHash('sha256').update(`cv-candidate:${processingJob.publicId}`).digest('hex').slice(0, 24)
  );
  try {
    const candidate = await Candidate.findOneAndUpdate(
      { _id: deterministicId },
      { $setOnInsert: candidatePayload(processingJob, analysis) },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    if (await organizationAcceptsCvWrites(processingJob.organization)) return candidate;
    await eraseCandidateProcessingData(processingJob.organization, [candidate._id]).catch(() => {});
    const error = new Error('Candidate creation was cancelled during organization deletion');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  } catch (error) {
    if (error?.code === 'CV_PROCESSING_CANCELLED') throw error;
    if (error?.code !== 11000) throw error;
    const duplicate = await Candidate.findOne(filter);
    if (duplicate) {
      if (await organizationAcceptsCvWrites(processingJob.organization)) return duplicate;
      await eraseCandidateProcessingData(processingJob.organization, [duplicate._id]).catch(() => {});
      const cancelled = new Error('Candidate recovery was cancelled during organization deletion');
      cancelled.code = 'CV_PROCESSING_CANCELLED';
      cancelled.permanent = true;
      throw cancelled;
    }
    throw error;
  }
}

async function createCandidateOnce(processingJob, analysis) {
  let lease;
  try {
    lease = await organizationCvWriteFence.acquire(
      processingJob.organization,
      'cv-worker:candidate-commit'
    );
  } catch (acquireError) {
    if (acquireError?.code !== 'ORGANIZATION_ERASURE_IN_PROGRESS') throw acquireError;
    const cancelledAt = new Date();
    await CVProcessingJob.updateOne(
      {
        _id: processingJob._id,
        state: 'processing',
        processingLeaseId: processingJob.processingLeaseId
      },
      {
        $set: {
          state: 'cancelled',
          stage: 'cancelled',
          stageStartedAt: cancelledAt,
          cancelledAt,
          cancellationReason: 'organization-deleted'
        },
        $unset: { processingLeaseId: 1, expiresAt: 1 }
      }
    );
    const error = new Error('CV processing was cancelled because its organization is being deleted');
    error.code = 'CV_PROCESSING_CANCELLED';
    error.permanent = true;
    throw error;
  }
  const stopHeartbeat = organizationCvWriteFence.startHeartbeat(lease);
  try {
    await organizationCvWriteFence.renew(lease);
    return await createCandidateWithinOrganizationFence(processingJob, analysis);
  } finally {
    stopHeartbeat();
    await organizationCvWriteFence.release(lease).catch(() => {});
  }
}

// Attaches CV-extracted fields to a candidate that was already created (e.g.
// from a public application form) rather than creating a fresh one. The
// applicant's own submitted identity fields are left untouched — only the
// CV-derived enrichment fields are merged in.
async function mergeAnalysisOntoCandidate(processingJob, analysis) {
  const currentRevisionFilter = {
    _id: processingJob.linkedCandidate,
    organization: processingJob.organization,
    jobAppliedFor: processingJob.jobAppliedFor,
    deletionState: { $ne: 'tombstoned' },
    'processingMetadata.cvProcessingJobId': processingJob.publicId
  };
  const existing = await Candidate.findOne(currentRevisionFilter);
  if (!existing) {
    const error = new Error('The linked candidate was deleted or a newer CV revision became current');
    error.code = 'CV_LINKED_CANDIDATE_NOT_CURRENT';
    error.permanent = true;
    throw error;
  }

  const payload = candidatePayload(processingJob, analysis);
  const {
    firstName, lastName, email, phone, coverLetter,
    organization, createdBy, jobAppliedFor, status, source,
    ...enrichmentFields
  } = payload;
  // The candidate already has a real position (the job applied for) - only
  // let extraction override it if the CV actually named one.
  if (!(analysis.extractedFields || {}).position) {
    delete enrichmentFields.position;
  }

  const enriched = await Candidate.findOneAndUpdate(
    currentRevisionFilter,
    { $set: enrichmentFields },
    { new: true, runValidators: true }
  );
  if (!enriched) {
    const error = new Error('The linked candidate was deleted or a newer CV revision became current');
    error.code = 'CV_LINKED_CANDIDATE_NOT_CURRENT';
    error.permanent = true;
    throw error;
  }
  return enriched;
}

async function sha256Path(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function digestRequest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function uploadRequestFingerprint(req, source, organizationId, jobId, linkedCandidate) {
  const [sha256, stat] = await Promise.all([
    sha256Path(req.file.path),
    statAsync(req.file.path)
  ]);
  return digestRequest({
    version: 1,
    mode: 'single',
    source,
    organizationId: String(organizationId || ''),
    jobId: String(jobId || ''),
    candidateId: String(linkedCandidate || ''),
    file: {
      name: String(req.file.originalname || ''),
      size: Number(req.file.size || stat.size || 0),
      sha256
    }
  });
}

function idempotencyReuseError() {
  return submissionError(
    'CV_IDEMPOTENCY_KEY_REUSED',
    'This idempotency key was already used for a different CV file or upload context',
    409
  );
}

const COMPLETION_EFFECT_NAMES = [
  'candidateNotification',
  'gptCacheInvalidation',
  'websocketBroadcast',
  'embedding',
  'limitReachedNotification'
];

async function skipCompletionEffect(processingJobId, effectName) {
  const statusPath = `completionEffects.${effectName}.status`;
  await CVProcessingJob.updateOne(
    {
      _id: processingJobId,
      [statusPath]: { $nin: ['completed', 'skipped'] }
    },
    {
      $set: {
        [statusPath]: 'skipped',
        [`completionEffects.${effectName}.completedAt`]: new Date()
      }
    }
  );
}

async function runCompletionEffectWithinFence(processingJobId, effectName, handler, deliveryStartedAt) {
  const prefix = `completionEffects.${effectName}`;
  const statusPath = `${prefix}.status`;
  const claimToken = crypto.randomUUID();
  const staleClaim = new Date(Date.now() - 5 * 60_000);
  const claimed = await CVProcessingJob.findOneAndUpdate(
    {
      _id: processingJobId,
      state: 'completed',
      $or: [
        { [statusPath]: { $exists: false } },
        {
          [statusPath]: 'pending',
          $or: [
            { [`${prefix}.lastError.at`]: { $exists: false } },
            { [`${prefix}.lastError.at`]: { $lt: deliveryStartedAt } }
          ]
        },
        {
          [statusPath]: 'processing',
          [`${prefix}.claimedAt`]: { $lt: staleClaim }
        }
      ]
    },
    {
      $set: {
        [statusPath]: 'processing',
        [`${prefix}.claimToken`]: claimToken,
        [`${prefix}.claimedAt`]: new Date()
      },
      $inc: {
        [`${prefix}.attempts`]: 1
      },
      $unset: {
        [`${prefix}.lastError`]: 1
      }
    },
    { new: true }
  );
  if (!claimed) return { effectName, claimed: false };

  try {
    await handler(claimed);
    const currentCandidate = claimed.candidate
      ? await Candidate.findOne({
          _id: claimed.candidate,
          deletionState: { $ne: 'tombstoned' },
          ...(claimed.linkedCandidate
            ? { 'processingMetadata.cvProcessingJobId': claimed.publicId }
            : {})
        })
      : null;
    const stillCurrent = Boolean(currentCandidate && await CVProcessingJob.exists({
      _id: processingJobId,
      state: 'completed',
      candidate: claimed.candidate,
      [`${prefix}.claimToken`]: claimToken
    }));
    if (!stillCurrent) {
      if (effectName === 'candidateNotification') {
        await Notification.deleteMany({ eventKey: `cv-completed:${claimed.publicId}` });
      } else if (effectName === 'embedding' && claimed.candidate) {
        const replacement = await Candidate.findOne({
          _id: claimed.candidate,
          deletionState: { $ne: 'tombstoned' }
        });
        if (replacement) {
          // A deterministic Candidate ID may have been recreated while the old
          // effect was running. Restore the current generation rather than
          // deleting its vector with the stale generation's compensation.
          await embeddingService.createCandidateEmbedding(replacement);
        } else {
          await embeddingService.deleteEmbedding(claimed.candidate);
        }
      }
      return { effectName, claimed: true, completed: false, cancelled: true };
    }
    const completed = await CVProcessingJob.updateOne(
      {
        _id: processingJobId,
        state: 'completed',
        [`${prefix}.claimToken`]: claimToken
      },
      {
        $set: {
          [statusPath]: 'completed',
          [`${prefix}.completedAt`]: new Date()
        },
        $unset: {
          [`${prefix}.claimToken`]: 1,
          [`${prefix}.claimedAt`]: 1,
          [`${prefix}.lastError`]: 1
        }
      }
    );
    return {
      effectName,
      claimed: true,
      completed: Number(completed.matchedCount || completed.n || 0) === 1
    };
  } catch (error) {
    await CVProcessingJob.updateOne(
      {
        _id: processingJobId,
        state: 'completed',
        [`${prefix}.claimToken`]: claimToken
      },
      {
        $set: {
          [statusPath]: 'pending',
          [`${prefix}.lastError`]: {
            message: String(error.message).slice(0, 1000),
            at: new Date()
          }
        },
        $unset: {
          [`${prefix}.claimToken`]: 1,
          [`${prefix}.claimedAt`]: 1
        }
      }
    );
    console.error(`CV completion effect ${effectName} failed:`, error.message);
    return { effectName, claimed: true, completed: false, error };
  }
}

async function runCompletionEffect(processingJobId, effectName, handler, deliveryStartedAt) {
  const job = await CVProcessingJob.findById(processingJobId).select('organization').lean();
  if (!job?.organization) return { effectName, claimed: false };
  let lease;
  try {
    lease = await organizationCvWriteFence.acquire(
      job.organization,
      `cv-completion:${effectName}`
    );
  } catch (error) {
    if (error?.code === 'ORGANIZATION_ERASURE_IN_PROGRESS') {
      return { effectName, claimed: false, cancelled: true };
    }
    throw error;
  }
  const stopHeartbeat = organizationCvWriteFence.startHeartbeat(lease);
  try {
    await organizationCvWriteFence.renew(lease);
    return await runCompletionEffectWithinFence(processingJobId, effectName, handler, deliveryStartedAt);
  } finally {
    stopHeartbeat();
    await organizationCvWriteFence.release(lease).catch(() => {});
  }
}

async function deliverCompletionEffects(processingJobId) {
  const deliveryStartedAt = new Date();
  const processingJob = await CVProcessingJob.findById(processingJobId);
  if (!processingJob?.candidate || processingJob.state !== 'completed') return [];
  const candidate = await Candidate.findById(processingJob.candidate);
  if (!candidate) return [];

  const recruiterCandidate = processingJob.source !== 'ai-interview';
  const effectPlan = {
    candidateNotification: recruiterCandidate,
    gptCacheInvalidation: recruiterCandidate,
    websocketBroadcast: recruiterCandidate,
    embedding: true,
    limitReachedNotification:
      processingJob.source === 'public'
      && processingJob.publicApplicationReservation?.limitReached === true
  };
  const results = [];
  for (const effectName of COMPLETION_EFFECT_NAMES) {
    if (!effectPlan[effectName]) {
      await skipCompletionEffect(processingJob._id, effectName);
      results.push({ effectName, skipped: true });
      continue;
    }
    results.push(await runCompletionEffect(
      processingJob._id,
      effectName,
      (claimedJob) => completionEffectHandlers[effectName](claimedJob, candidate),
      deliveryStartedAt
    ));
  }

  const latest = await CVProcessingJob.findById(processingJob._id)
    .select('completionEffects')
    .lean();
  const drained = COMPLETION_EFFECT_NAMES.every((effectName) => (
    ['completed', 'skipped'].includes(latest?.completionEffects?.[effectName]?.status)
  ));
  if (drained) {
    await CVProcessingJob.updateOne(
      { _id: processingJob._id },
      { $set: { completionEffectsCompletedAt: new Date() } }
    );
  }
  await finalizeTerminalExpiry(processingJob);
  return results;
}

async function recoverCompletionEffects() {
  const jobs = await CVProcessingJob.find({
    state: 'completed',
    candidate: { $ne: null },
    completionEffectsCompletedAt: { $exists: false }
  })
    .sort({ completedAt: 1 })
    .limit(100)
    .select('_id')
    .lean();
  for (const job of jobs) {
    await deliverCompletionEffects(job._id);
  }
  return jobs.length;
}

function normalizedRetryStage(value) {
  const stage = String(value || 'failed').trim().toLowerCase();
  if (!['failed', 'parsing', 'analysis'].includes(stage)) {
    const error = new Error('Retry stage must be failed, parsing, or analysis');
    error.code = 'CV_RETRY_STAGE_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return stage;
}

async function beginProcessingAttempt(processingJob) {
  const now = new Date();
  const existingCount = Number(processingJob.processingAttempts || 0);
  const trigger = ['initial', 'automatic', 'manual'].includes(processingJob.retry?.pendingTrigger)
    ? processingJob.retry.pendingTrigger
    : existingCount > 0 ? 'automatic' : 'initial';
  const requestedStage = normalizedRetryStage(processingJob.retry?.requestedStage || 'failed');
  const attemptId = `cva_${crypto.randomUUID()}`;
  const updated = await CVProcessingJob.findOneAndUpdate(
    {
      _id: processingJob._id,
      // This state transition is the durable worker lease. BullMQ normally
      // delivers a job once, but a stalled-job recovery or a deployment can
      // briefly present the same delivery to two workers. Only one of them may
      // cross from a runnable state into processing.
      state: { $in: ['queued', 'waiting_for_chatgpt'] }
    },
    {
      $inc: { processingAttempts: 1 },
      $set: {
        state: 'processing',
        processingLeaseId: attemptId,
        'retry.requestedStage': requestedStage
      },
      $unset: { 'retry.pendingTrigger': 1, 'retry.nextAttemptAt': 1 }
    },
    { new: true }
  ).select('processingAttempts retry.lastRequestedBy');
  if (!updated) return null;
  const attempt = {
    attemptId,
    number: Number(updated.processingAttempts || existingCount + 1),
    trigger,
    requestedStage,
    status: 'processing',
    stage: processingJob.cloudinary?.publicId ? (processingJob.resumeText ? 'analyzing' : 'extracting') : 'uploading',
    startedAt: now,
    ...(trigger === 'manual' && updated.retry?.lastRequestedBy
      ? { requestedBy: retryActor(updated.retry.lastRequestedBy) }
      : {})
  };
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    { $push: { attemptHistory: { $each: [attempt], $slice: -HISTORY_TRANSITION_LIMIT } } }
  );
  processingJob.processingAttempts = attempt.number;
  processingJob.processingLeaseId = attemptId;
  processingJob.attemptHistory = [...(processingJob.attemptHistory || []), attempt].slice(-HISTORY_TRANSITION_LIMIT);
  return attempt;
}

async function finishProcessingAttempt(processingJob, attempt, {
  status,
  stage,
  error
} = {}) {
  if (!attempt?.attemptId) return false;
  const finishedAt = new Date();
  const update = {
    'attemptHistory.$.status': status,
    'attemptHistory.$.stage': stage || processingJob.stage || null,
    'attemptHistory.$.finishedAt': finishedAt
  };
  if (error) {
    update['attemptHistory.$.errorCode'] = String(error.code || 'CV_ANALYSIS_ERROR').slice(0, 120);
    update['attemptHistory.$.errorMessage'] = String(error.message || error).slice(0, 1000);
  }
  await CVProcessingJob.updateOne(
    { _id: processingJob._id, 'attemptHistory.attemptId': attempt.attemptId },
    { $set: update }
  );
  const localAttempt = (processingJob.attemptHistory || []).find((item) => item.attemptId === attempt.attemptId);
  if (localAttempt) Object.assign(localAttempt, {
    status,
    stage: stage || processingJob.stage || null,
    finishedAt,
    ...(error ? {
      errorCode: String(error.code || 'CV_ANALYSIS_ERROR').slice(0, 120),
      errorMessage: String(error.message || error).slice(0, 1000)
    } : {})
  });
  return true;
}

async function retainFailedAssetsForRetry(processingJob, failedAt = new Date()) {
  const availableUntil = failedRetryExpiry(failedAt.getTime());
  const set = {
    'retry.availableUntil': availableUntil
  };
  if (processingJob.durableFile?.fileId && !processingJob.durableFile?.releasedAt) {
    set['durableFile.cleanupState'] = 'retained';
    set['durableFile.cleanupNextAttemptAt'] = availableUntil;
  }
  if (processingJob.cloudinary?.publicId && !processingJob.cloudinary?.releasedAt) {
    set['cloudinary.cleanupState'] = 'retained';
    set['cloudinary.cleanupNextAttemptAt'] = availableUntil;
  }
  await CVProcessingJob.updateOne(
    { _id: processingJob._id },
    {
      $set: set,
      $unset: {
        expiresAt: 1,
        'retry.pendingTrigger': 1,
        'retry.nextAttemptAt': 1,
        'durableFile.cleanupError': 1,
        'cloudinary.cleanupError': 1
      }
    }
  );
  processingJob.retry = { ...(processingJob.retry?.toObject?.() || processingJob.retry || {}), availableUntil };
  if (processingJob.durableFile?.fileId && !processingJob.durableFile?.releasedAt) {
    processingJob.durableFile.cleanupState = 'retained';
    processingJob.durableFile.cleanupNextAttemptAt = availableUntil;
  }
  if (processingJob.cloudinary?.publicId && !processingJob.cloudinary?.releasedAt) {
    processingJob.cloudinary.cleanupState = 'retained';
    processingJob.cloudinary.cleanupNextAttemptAt = availableUntil;
  }
  await finalizeTerminalExpiry(processingJob);
  return availableUntil;
}

async function recoverCommittedCandidate(processingJob) {
  if (processingJob.state === 'cancelled') return null;
  const candidate = processingJob.candidate
    ? await Candidate.findOne({
        _id: processingJob.candidate,
        deletionState: { $ne: 'tombstoned' },
        ...(processingJob.linkedCandidate
          ? { 'processingMetadata.cvProcessingJobId': processingJob.publicId }
          : {})
      })
    : !processingJob.linkedCandidate
      ? await Candidate.findOne({
          'processingMetadata.cvProcessingJobId': processingJob.publicId,
          deletionState: { $ne: 'tombstoned' }
        })
      : null;
  if (!candidate) return null;

  const completedAt = processingJob.completedAt || new Date();
  const completedEvent = processingStageEvent(
    'completed', 'completed', 100, processingJob, null, completedAt
  );

  const recovered = await CVProcessingJob.updateOne(
    {
      _id: processingJob._id,
      state: processingJob.state,
      ...(processingJob.state === 'processing'
        ? { processingLeaseId: processingJob.processingLeaseId }
        : {})
    },
    {
      $set: {
        state: 'completed',
        stage: 'completed',
        stageStartedAt: completedAt,
        progress: 100,
        candidate: candidate._id,
        completedAt,
        'artifacts.profileCommittedAt': completedAt
      },
      $unset: {
        lastError: 1,
        failedAt: 1,
        expiresAt: 1,
        'retry.pendingTrigger': 1,
        'retry.nextAttemptAt': 1
      },
      $push: {
        stageHistory: {
          $each: [completedEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    }
  );
  if (!recovered.matchedCount) return null;
  processingJob.state = 'completed';
  processingJob.stage = 'completed';
  processingJob.stageStartedAt = completedAt;
  processingJob.progress = 100;
  processingJob.candidate = candidate._id;
  processingJob.completedAt = completedAt;
  processingJob.lastError = undefined;
  processingJob.stageHistory = [...(processingJob.stageHistory || []), completedEvent]
    .slice(-HISTORY_TRANSITION_LIMIT);
  await syncLinkedCandidateProcessing(processingJob, {
    state: 'completed', stage: 'completed', progress: 100, error: null, retryEligible: false
  });
  await syncHistorySafely(processingJob._id);
  await deliverCompletionEffects(processingJob._id).catch((error) => {
    console.error('CV completion effect recovery failed:', error.message);
  });
  return candidate;
}

function deterministicCloudinaryUploadIntent(processingJob, generation, storagePolicy) {
  const requestedId = String(processingJob.publicId || '')
    .replace(/[^A-Za-z0-9_-]/g, '_');
  const uploadGeneration = String(generation || crypto.randomUUID())
    .replace(/[^A-Za-z0-9_-]/g, '_');
  // Every processing attempt gets its own provider identity. Cleanup for an
  // uncertain earlier upload can therefore finish after a manual retry
  // without deleting the retry's newly committed asset.
  const providerRequestId = `${requestedId}_${uploadGeneration}`.slice(0, 220);
  const image = ['image/jpeg', 'image/png', 'image/tiff'].includes(processingJob.fileType);
  const document = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ].includes(processingJob.fileType);
  const publicId = `${image ? 'resumes/images' : document ? 'resumes/documents' : 'resumes/other'}/${providerRequestId}`;
  const storageProvider = storagePolicy?.defaultProvider || 'cloudinary';
  return {
    publicId,
    storageProvider,
    storageKey: publicId,
    storageContainer: storageProvider === 'azure-blob' ? storagePolicy?.providers?.azureBlob?.containerName : undefined,
    resourceType: image ? 'image' : document ? 'raw' : 'auto',
    deliveryType: 'authenticated',
    generation: uploadGeneration,
    preparedAt: new Date()
  };
}

async function releaseCloudinaryUploadIntent(
  processingJob,
  resource,
  reason,
  { outcomeConfirmed = false } = {}
) {
  const intent = resource?.publicId ? resource : processingJob.cloudinaryUploadIntent;
  if (!intent?.publicId) return false;
  let task;
  try {
    task = await registerCleanupTask('cloudinary', intent, {
      reason: reason || 'cloudinary-upload-intent-release',
      jobPublicId: processingJob.publicId,
      generationKey: processingJob.cloudinaryUploadIntent?.generation || intent.generation,
      notBefore: new Date(Date.now() + CLOUD_UPLOAD_TIMEOUT_MS + CLOUD_UPLOAD_UNCERTAINTY_MS),
      reconcileUntil: new Date(Date.now() + CLOUD_UPLOAD_RECONCILIATION_MS)
    });
  } catch (cause) {
    const error = new Error('Cloudinary upload cleanup could not be recorded durably');
    error.code = 'CV_CLOUD_CLEANUP_REGISTRATION_FAILED';
    error.cause = cause;
    throw error;
  }
  await executeCleanupTask(task, { cloudinaryOutcomeConfirmed: outcomeConfirmed }).catch((error) => {
    console.error('Cloudinary upload-intent cleanup deferred:', error.message);
  });
  await CVProcessingJob.updateOne(
    {
      _id: processingJob._id,
      'cloudinaryUploadIntent.generation': processingJob.cloudinaryUploadIntent?.generation
    },
    { $unset: { cloudinaryUploadIntent: 1 } }
  ).catch(() => {});
  return true;
}

async function processJob(bullJob, workerToken) {
  const processingJob = await CVProcessingJob.findById(bullJob.data.processingJobId)
    .select('+resumeText +statusTokenHash +processingLeaseId');
  if (!processingJob) return { skipped: true };
  if (processingJob.state === 'cancelled') return { skipped: true, cancelled: true };
  // Candidate creation and job completion are separate durable writes. Repair
  // either a crash between them or an older duplicate delivery that regressed
  // the state after the candidate had already been committed.
  const committedCandidate = await recoverCommittedCandidate(processingJob);
  if (committedCandidate) {
    return { candidateId: String(committedCandidate._id), duplicate: true };
  }
  if (processingJob.billing?.required && processingJob.billing.state !== 'charged') {
    const error = new Error('CV upload is waiting for its credit charge to complete');
    error.code = 'CV_CREDIT_CHARGE_PENDING';
    throw error;
  }
  const processingAttempt = await beginProcessingAttempt(processingJob);
  if (!processingAttempt) return { skipped: true };
  const initialStage = !processingJob.cloudinary?.publicId
    ? 'uploading'
    : processingJob.resumeText ? 'analyzing' : 'extracting';
  processingJob.startedAt = processingJob.startedAt || new Date();
  await updateProcessingStage(processingJob, bullJob, initialStage, 15, {
    startedAt: processingJob.startedAt
  });
  try {
    if (!processingJob.resumeText || !processingJob.cloudinary?.publicId) {
      const materialized = await durableFileStore.materialize(processingJob.durableFile, {
        originalName: processingJob.originalName,
        fileType: processingJob.fileType
      });
      try {
        if (!processingJob.cloudinary?.publicId) {
          await updateProcessingStage(processingJob, bullJob, 'uploading', 20);
          const storagePolicy = await storageConfigurationResolver({ force: true });
          if (!storagePolicy?.configured) throw new Error('Managed CV storage is unavailable');
          const uploadIntent = deterministicCloudinaryUploadIntent(
            processingJob,
            processingAttempt.attemptId,
            storagePolicy
          );
          const prepared = await CVProcessingJob.updateOne(
            {
              _id: processingJob._id,
              state: 'processing',
              processingLeaseId: processingJob.processingLeaseId
            },
            { $set: { cloudinaryUploadIntent: uploadIntent } }
          );
          if (!prepared.matchedCount) {
            const error = new Error('CV processing was cancelled before document storage');
            error.code = 'CV_PROCESSING_CANCELLED';
            error.permanent = true;
            throw error;
          }
          processingJob.cloudinaryUploadIntent = uploadIntent;
          const upload = await cloudinary.uploadFile(materialized.filePath, processingJob.fileType, {
            privateAsset: true,
            // CloudinaryUploadService adds the type-specific resumes/* folder.
            // Keep this leaf exactly aligned with the durable full publicId in
            // cloudinaryUploadIntent.
            publicId: uploadIntent.publicId.split('/').at(-1)
          });
          if (!upload?.success) {
            const error = new Error(upload?.error || 'CV document upload failed');
            error.code = 'CV_CLOUD_UPLOAD_FAILED';
            throw error;
          }
          const cloudinaryMetadata = {
            resumeUrl: upload.resumeUrl,
            publicId: upload.publicId,
            storageProvider: upload.storageProvider || uploadIntent.storageProvider,
            storageKey: upload.storageKey || upload.publicId,
            storageContainer: upload.storageContainer || null,
            assetId: upload.uploadResult?.asset_id,
            resourceType: upload.resourceType,
            deliveryType: upload.deliveryType || 'authenticated',
            cleanupState: 'retained'
          };
          let cloudReferencePersisted = false;
          try {
            const persisted = await CVProcessingJob.updateOne(
              {
                _id: processingJob._id,
                state: 'processing',
                processingLeaseId: processingJob.processingLeaseId
              },
              {
                $set: {
                  cloudinary: cloudinaryMetadata,
                  'artifacts.cloudinaryStoredAt': new Date()
                },
                $unset: { cloudinaryUploadIntent: 1 }
              }
            );
            cloudReferencePersisted = persisted.matchedCount > 0;
          } catch (error) {
            await releaseCloudinaryUploadIntent(
              processingJob,
              cloudinaryMetadata,
              'cloudinary-reference-persistence-failed',
              { outcomeConfirmed: true }
            );
            throw error;
          }
          if (!cloudReferencePersisted) {
            await releaseCloudinaryUploadIntent(
              processingJob,
              cloudinaryMetadata,
              'cancelled-during-cloudinary-upload',
              { outcomeConfirmed: true }
            );
            const error = new Error('CV processing was cancelled during document storage');
            error.code = 'CV_PROCESSING_CANCELLED';
            error.permanent = true;
            throw error;
          }
          processingJob.cloudinary = cloudinaryMetadata;
          processingJob.cloudinaryUploadIntent = undefined;
          processingJob.artifacts = {
            ...(processingJob.artifacts?.toObject?.() || processingJob.artifacts || {}),
            cloudinaryStoredAt: new Date()
          };
          await projectStoredCvOntoLinkedCandidate(processingJob).catch((error) => {
            // The processing record and provider object are already durable.
            // Maintenance/retry can repair this denormalized candidate view.
            console.error('CV managed-file candidate projection will be repaired:', error.message);
          });
          await updateProcessingStage(processingJob, bullJob, 'stored', 30);
        }

        if (!processingJob.resumeText) {
          await updateProcessingStage(processingJob, bullJob, 'extracting', 35);
          const resumeText = await cvParser.parseCV(materialized.filePath, processingJob.fileType);
          if (!resumeText || resumeText.trim().length < 50) {
            const error = new Error('Could not extract readable text from this CV. Use a text-based PDF or DOCX.');
            error.code = 'CV_TEXT_EXTRACTION_FAILED';
            throw error;
          }
          const extracted = await CVProcessingJob.updateOne(
            {
              _id: processingJob._id,
              state: 'processing',
              processingLeaseId: processingJob.processingLeaseId
            },
            {
              $set: {
                resumeText,
                'artifacts.textExtractedAt': new Date(),
                'artifacts.extractedTextLength': resumeText.length
              }
            }
          );
          if (!extracted.matchedCount) {
            const error = new Error('CV processing was cancelled during text extraction');
            error.code = 'CV_PROCESSING_CANCELLED';
            error.permanent = true;
            throw error;
          }
          processingJob.resumeText = resumeText;
          processingJob.artifacts = {
            ...(processingJob.artifacts?.toObject?.() || processingJob.artifacts || {}),
            textExtractedAt: new Date(),
            extractedTextLength: resumeText.length
          };
          await projectStoredCvOntoLinkedCandidate(processingJob).catch((error) => {
            console.error('CV extracted-text candidate projection will be repaired:', error.message);
          });
        }
      } finally {
        await materialized.cleanup().catch(() => {});
      }
    }

    await updateProcessingStage(processingJob, bullJob, 'analyzing', 50);
    const [organization, actor] = await Promise.all([
      Organization.findById(processingJob.organization).select('name idpOrganizationId').lean(),
      processingJob.actor
        ? User.findById(processingJob.actor).select('email idpSubject profile.firstName profile.lastName profile.displayName').lean()
        : Promise.resolve(null)
    ]);
    const runtimeActor = processingJob.actor
      ? null
      : await resolveOrganizationRuntimeActor(
        processingJob.organization,
        processingJob.jobAppliedFor
      );
    const effectiveActorId = processingJob.actor ? String(processingJob.actor) : runtimeActor?.id;
    const effectiveActor = actor || runtimeActor?.user || null;
    const canonicalActorId = effectiveActor?.idpSubject || undefined;
    const localOrganizationId = String(processingJob.organization);
    const canonicalOrganizationId = organization?.idpOrganizationId || localOrganizationId;
    const analysis = await runInferenceWithGlobalPermit(
      bullJob,
      workerToken,
      async ({ signal }) => {
        const activeAttempt = await CVProcessingJob.updateOne(
          {
            _id: processingJob._id,
            state: 'processing',
            processingLeaseId: processingJob.processingLeaseId
          },
          { $inc: { attempts: 1 } }
        );
        if (!activeAttempt.matchedCount) {
          const error = new Error('CV processing was cancelled before AI analysis');
          error.code = 'CV_PROCESSING_CANCELLED';
          error.permanent = true;
          throw error;
        }
        processingJob.attempts = Number(processingJob.attempts || 0) + 1;
        return runWithAIRequestContext({
          sourceApp: 'recruiter-cv-worker',
          organizationId: canonicalOrganizationId,
          localOrganizationId,
          organizationName: organization?.name,
          actorId: canonicalActorId,
          runtimeActorId: effectiveActorId || undefined,
          actorName: personName(effectiveActor)
            || [processingJob.formData?.firstName, processingJob.formData?.lastName].filter(Boolean).join(' ')
            || (processingJob.source === 'public' ? 'Public applicant' : undefined),
          actorEmail: effectiveActor?.email || processingJob.formData?.email,
          jobId: processingJob.publicId,
          requestId: `cv-queue:${processingJob.publicId}`,
          // Transport retries within one processing generation replay the same
          // durable gateway receipt. A human-requested retry advances the
          // generation so an old receipt whose request fingerprint predates a
          // runtime/configuration change cannot strand this CV forever.
          usageExecutionId: cvUsageExecutionId(processingJob),
          promptVersion: 'candidate-cv-local-v1'
        }, () => cvParser.analyzeText(
          processingJob.resumeText,
          processingJob.source === 'ai-interview' ? 'ai_interview.cv_parse' : 'candidate.cv_parse',
          { signal }
        ));
      },
      async ({ reason, error }) => {
        const dispatchReason = String(reason || 'unknown');
        const waitingMessages = {
          full: 'CV analysis is queued while another shared CV analysis finishes',
          fairness: 'CV analysis is queued for its turn in shared processing',
          paused: 'CV analysis is waiting because shared CV processing is paused',
          stopping: 'CV analysis is waiting while shared CV processing restarts',
          unhealthy: 'Shared CV processing is temporarily unavailable'
        };
        const waitError = {
          code: error?.code || `CV_GLOBAL_DISPATCH_${dispatchReason.toUpperCase().replace(/-/g, '_')}`,
          message: error?.message || waitingMessages[dispatchReason] || 'CV analysis is waiting for shared processing',
          at: new Date()
        };
        const parked = await CVProcessingJob.updateOne({
          _id: processingJob._id,
          state: 'processing',
          processingLeaseId: processingJob.processingLeaseId
        }, {
          $set: {
            state: 'waiting_for_chatgpt',
            stage: 'analyzing',
            progress: Math.max(50, Number(processingJob.progress || 50)),
            lastError: waitError
          },
          $unset: { expiresAt: 1 }
        });
        if (!parked.matchedCount) return;
        processingJob.state = 'waiting_for_chatgpt';
        processingJob.stage = 'analyzing';
        processingJob.progress = Math.max(50, Number(processingJob.progress || 50));
        processingJob.lastError = waitError;
        await syncHistorySafely(processingJob._id);
        publishTelemetrySoon();
      }
    );
    if (!analysis.success) {
      const error = new Error(analysis.error || 'Local CV analysis failed');
      error.code = analysis.code
        || (isBusyError(error)
          ? 'CHATGPT_CAPACITY_BUSY'
          : isOfflineError(error) ? 'CHATGPT_GATEWAY_UNAVAILABLE' : 'CV_ANALYSIS_FAILED');
      error.retryable = analysis.retryable === true;
      throw error;
    }
    const analysisCompletedAt = new Date();
    const analysisRecorded = await CVProcessingJob.updateOne(
      {
        _id: processingJob._id,
        state: 'processing',
        processingLeaseId: processingJob.processingLeaseId
      },
      { $set: { 'artifacts.analysisCompletedAt': analysisCompletedAt } }
    );
    if (!analysisRecorded.matchedCount) {
      const error = new Error('CV processing was cancelled during AI analysis');
      error.code = 'CV_PROCESSING_CANCELLED';
      error.permanent = true;
      throw error;
    }
    processingJob.artifacts = {
      ...(processingJob.artifacts?.toObject?.() || processingJob.artifacts || {}),
      analysisCompletedAt
    };
    await updateProcessingStage(processingJob, bullJob, 'profile_creation', 80);
    const candidate = await createCandidateOnce(processingJob, analysis);
    const completedAt = new Date();
    const completedEvent = processingStageEvent(
      'completed',
      'completed',
      100,
      processingJob,
      null,
      completedAt
    );
    const completed = await CVProcessingJob.updateOne({
      _id: processingJob._id,
      state: 'processing',
      processingLeaseId: processingJob.processingLeaseId
    }, {
      $set: {
        state: 'completed',
        stage: 'completed',
        stageStartedAt: completedAt,
        progress: 100,
        candidate: candidate._id,
        completedAt,
        'artifacts.profileCommittedAt': completedAt
      },
      $unset: { lastError: 1, expiresAt: 1, processingLeaseId: 1 },
      $push: {
        stageHistory: {
          $each: [completedEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    });
    if (!completed.matchedCount) {
      const error = new Error('CV processing was cancelled before profile commit');
      error.code = 'CV_PROCESSING_CANCELLED';
      error.permanent = true;
      throw error;
    }
    processingJob.state = 'completed';
    processingJob.stage = 'completed';
    processingJob.stageStartedAt = completedAt;
    processingJob.progress = 100;
    processingJob.candidate = candidate._id;
    processingJob.completedAt = completedAt;
    processingJob.lastError = undefined;
    processingJob.stageHistory = [...(processingJob.stageHistory || []), completedEvent]
      .slice(-HISTORY_TRANSITION_LIMIT);
    await syncLinkedCandidateProcessing(processingJob, {
      state: 'completed',
      stage: 'completed',
      progress: 100,
      error: null,
      retryEligible: false
    });
    await finishProcessingAttempt(processingJob, processingAttempt, {
      status: 'completed',
      stage: 'completed'
    });
    await syncHistorySafely(processingJob._id);
    await bullJob.updateProgress(100);
    await releaseDurableFile(processingJob).catch((error) => {
      console.error('CV durable file cleanup failed:', error.message);
    });
    publishTelemetrySoon();
    await deliverCompletionEffects(processingJob._id).catch((error) => {
      console.error('CV completion effects will be retried by maintenance:', error.message);
    });
    return { candidateId: String(candidate._id), jobId: processingJob.publicId };
  } catch (error) {
    if (!processingJob.actor && error?.code === 'AI_RUNTIME_ACCOUNT_REQUIRED') {
      error.code = 'ORG_AUTOMATION_RUNTIME_REQUIRED';
      error.message = 'The recruiter who posted this job, or an assigned hiring-team member, must have a connected ChatGPT account and sign in to Recruiter before public CV analysis can continue';
    }
    const cancelledJob = await CVProcessingJob.findOne({
      _id: processingJob._id,
      state: 'cancelled'
    }).select('_id').lean();
    if (cancelledJob || error?.code === 'CV_PROCESSING_CANCELLED') {
      await finishProcessingAttempt(processingJob, processingAttempt, {
        status: 'cancelled',
        stage: 'cancelled',
        error
      });
      await syncHistorySafely(processingJob._id);
      bullJob.discard?.();
      return { skipped: true, cancelled: true, jobId: processingJob.publicId };
    }
    // A duplicate delivery may have started before the atomic lease above was
    // deployed, or while an older process was draining during a rollout. Once
    // any delivery has committed a candidate, a later failure must never
    // regress the durable job back to queued/failed and strand the UI.
    const completedElsewhere = await CVProcessingJob.findOne({
      _id: processingJob._id,
      state: 'completed',
      candidate: { $ne: null }
    }).select('candidate').lean();
    if (completedElsewhere?.candidate) {
      await finishProcessingAttempt(processingJob, processingAttempt, {
        status: 'completed',
        stage: 'completed'
      });
      return {
        candidateId: String(completedElsewhere.candidate),
        jobId: processingJob.publicId,
        duplicate: true
      };
    }
    if (error instanceof DelayedError || String(error?.code || '').startsWith('CV_GLOBAL_DISPATCH_')) {
      const nextAttemptAt = new Date(Date.now() + cvBackoffDelay(Number(bullJob.attemptsMade || 0) + 1, error));
      const retryScheduledAt = new Date();
      const retryEvent = processingStageEvent(
        'retry_scheduled',
        'waiting_for_chatgpt',
        Math.max(50, Number(processingJob.progress || 50)),
        processingJob,
        error,
        retryScheduledAt
      );
      const retryScheduled = await CVProcessingJob.updateOne(
        {
          _id: processingJob._id,
          state: { $in: ['processing', 'waiting_for_chatgpt'] },
          processingLeaseId: processingJob.processingLeaseId
        },
        {
          $set: {
            state: 'waiting_for_chatgpt',
            stage: 'retry_scheduled',
            stageStartedAt: retryScheduledAt,
            'retry.pendingTrigger': 'automatic',
            'retry.requestedStage': 'failed',
            'retry.nextAttemptAt': nextAttemptAt
          },
          $unset: { processingLeaseId: 1 },
          $push: {
            stageHistory: {
              $each: [retryEvent],
              $slice: -HISTORY_TRANSITION_LIMIT
            }
          }
        }
      );
      if (!retryScheduled.matchedCount) {
        await finishProcessingAttempt(processingJob, processingAttempt, {
          status: 'cancelled', stage: 'cancelled', error
        });
        await syncHistorySafely(processingJob._id);
        bullJob.discard?.();
        return { skipped: true, cancelled: true, jobId: processingJob.publicId };
      }
      processingJob.state = 'waiting_for_chatgpt';
      processingJob.stage = 'retry_scheduled';
      processingJob.stageStartedAt = retryScheduledAt;
      processingJob.stageHistory = [...(processingJob.stageHistory || []), retryEvent]
        .slice(-HISTORY_TRANSITION_LIMIT);
      processingJob.retry = {
        ...(processingJob.retry?.toObject?.() || processingJob.retry || {}),
        pendingTrigger: 'automatic',
        requestedStage: 'failed',
        nextAttemptAt
      };
      await finishProcessingAttempt(processingJob, processingAttempt, {
        status: 'waiting_for_runtime',
        stage: 'retry_scheduled',
        error
      });
      await syncLinkedCandidateProcessing(processingJob, {
        state: 'waiting',
        stage: 'retry_scheduled',
        error: processingError(processingJob),
        retryEligible: false
      });
      await syncHistorySafely(processingJob._id);
      throw error;
    }
    console.error('CV queue processing attempt failed:', {
      jobId: processingJob.publicId,
      code: error.code || 'CV_ANALYSIS_ERROR',
      message: String(error.message).slice(0, 1000)
    });
    const failedStage = processingJob.stage || 'ingesting';
    const unboundedDeferral = isUnboundedRuntimeDeferral(error);
    const retryableServiceFailure = !unboundedDeferral && isRetryableProcessingError(error);
    const boundedFailureAttempts = Number(processingJob.boundedFailureAttempts || 0)
      + (unboundedDeferral ? 0 : 1);
    const deferred = retryableServiceFailure
      && boundedFailureAttempts >= MAX_BOUNDED_FAILURE_ATTEMPTS;
    const deferredCycles = deferred
      ? Number(processingJob.retry?.deferredCycles || 0) + 1
      : Number(processingJob.retry?.deferredCycles || 0);
    const terminal = error.permanent === true
      || (!unboundedDeferral && !retryableServiceFailure
        && boundedFailureAttempts >= MAX_BOUNDED_FAILURE_ATTEMPTS);
    const failedAt = terminal ? new Date() : null;
    const retryDelay = deferred
      ? deferredRetryDelay(deferredCycles)
      : cvBackoffDelay(Number(bullJob.attemptsMade || 0) + 1, error);
    if (deferred) error.retryAfterMs = retryDelay;
    const nextAttemptAt = terminal
      ? null
      : new Date(Date.now() + retryDelay);
    const resultingState = terminal
      ? 'failed'
      : (unboundedDeferral || deferred) ? 'waiting_for_chatgpt' : 'queued';
    const resultingStage = terminal ? 'failed' : 'retry_scheduled';
    const failureRecordedAt = new Date();
    const failureEvent = processingStageEvent(
      resultingStage,
      resultingState,
      terminal ? processingJob.progress : Math.max(5, Number(processingJob.progress || 5)),
      processingJob,
      error,
      failureRecordedAt
    );
    const failureUpdate = {
      $set: {
        state: resultingState,
        stage: resultingStage,
        stageStartedAt: failureRecordedAt,
        progress: terminal ? processingJob.progress : Math.max(5, Number(processingJob.progress || 5)),
        ...(deferred ? {
          boundedFailureAttempts: 0,
          'retry.deferredCycles': deferredCycles,
          'retry.lastDeferredAt': new Date()
        } : {}),
        ...(terminal ? { failedAt } : {}),
        ...(!terminal ? {
          'retry.pendingTrigger': 'automatic',
          'retry.requestedStage': 'failed',
          'retry.nextAttemptAt': nextAttemptAt
        } : {}),
        lastError: {
          code: error.code || 'CV_ANALYSIS_ERROR',
          message: String(error.message).slice(0, 1000),
          stage: failedStage,
          at: failureRecordedAt
        }
      },
      $push: {
        stageHistory: {
          $each: [failureEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    };
    failureUpdate.$unset = { expiresAt: 1, processingLeaseId: 1 };
    if (!unboundedDeferral && !deferred) failureUpdate.$inc = { boundedFailureAttempts: 1 };
    const failureRecorded = await CVProcessingJob.updateOne({
      _id: processingJob._id,
          state: { $in: ['processing', 'waiting_for_chatgpt'] },
      processingLeaseId: processingJob.processingLeaseId
    }, failureUpdate);
    if (!failureRecorded.matchedCount) {
      await finishProcessingAttempt(processingJob, processingAttempt, {
        status: 'cancelled',
        stage: 'cancelled',
        error
      });
      await syncHistorySafely(processingJob._id);
      bullJob.discard?.();
      return { skipped: true, cancelled: true, jobId: processingJob.publicId };
    }
    processingJob.boundedFailureAttempts = deferred ? 0 : boundedFailureAttempts;
    processingJob.state = resultingState;
    processingJob.stage = resultingStage;
    processingJob.stageStartedAt = failureRecordedAt;
    processingJob.stageHistory = [...(processingJob.stageHistory || []), failureEvent]
      .slice(-HISTORY_TRANSITION_LIMIT);
    processingJob.failedAt = failedAt || processingJob.failedAt;
    processingJob.lastError = {
      code: error.code || 'CV_ANALYSIS_ERROR',
      message: String(error.message).slice(0, 1000),
      stage: failedStage,
      at: failureRecordedAt
    };
    if (!terminal) {
      processingJob.retry = {
        ...(processingJob.retry?.toObject?.() || processingJob.retry || {}),
        pendingTrigger: 'automatic',
        requestedStage: 'failed',
        nextAttemptAt,
        deferredCycles,
        ...(deferred ? { lastDeferredAt: new Date() } : {})
      };
    }
    await finishProcessingAttempt(processingJob, processingAttempt, {
      status: (unboundedDeferral || deferred) ? 'waiting_for_runtime' : 'failed',
      stage: failedStage,
      error
    });
    if (terminal) {
      await retainFailedAssetsForRetry(processingJob, failedAt).catch((retentionError) => {
        console.error('CV failed asset retention could not be scheduled:', retentionError.message);
      });
    }
    await syncLinkedCandidateProcessing(processingJob, {
      state: terminal ? 'failed' : 'waiting',
      stage: resultingStage,
      error: processingError(processingJob),
      retryEligible: terminal ? retrySummary(processingJob).available : false
    });
    await syncHistorySafely(processingJob._id);
    publishTelemetrySoon();
    if (terminal) bullJob.discard?.();
    throw error;
  }
}

async function addQueueJob(job, { replaceTerminal = false } = {}) {
  if (job.billing?.required && job.billing.state !== 'charged') {
    const error = new Error('CV processing job is waiting for its credit charge');
    error.code = 'CV_CREDIT_CHARGE_PENDING';
    throw error;
  }
  const q = await getQueue();
  if (replaceTerminal) {
    const existing = await q.getJob(job.publicId);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'prioritized', 'delayed', 'waiting-children'].includes(state)) {
        const error = new Error('This CV processing job is already queued or running');
        error.code = 'CV_RETRY_ALREADY_RUNNING';
        error.statusCode = 409;
        throw error;
      }
      await existing.remove();
    }
  }
  const jobsAheadForOrganization = await CVProcessingJob.countDocuments({
    organization: job.organization,
    state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] },
    createdAt: { $lt: job.createdAt }
  });
  const queued = await q.add('analyze-cv', { processingJobId: String(job._id) }, {
    jobId: job.publicId,
    attempts: 2_147_483_647,
    backoff: { type: 'cv-runtime', delay: 30_000 },
    priority: Math.min(2_097_152, jobsAheadForOrganization + 1),
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 }
  });
  publishTelemetrySoon();
  return queued;
}

async function enqueueExistingJob(processingJobId) {
  const job = await CVProcessingJob.findById(processingJobId);
  if (!job) throw new Error('CV processing job not found');
  return addQueueJob(job);
}

function manualRetryError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function retryFailedJob(publicId, {
  organizationId,
  administrator = false,
  requestedBy,
  stage = 'failed'
} = {}) {
  const requestedStage = normalizedRetryStage(stage);
  if (!administrator && !organizationId) {
    throw manualRetryError('CV_RETRY_ORGANIZATION_REQUIRED', 'An organization is required to retry CV processing', 403);
  }
  const filter = {
    publicId: String(publicId || ''),
    ...(administrator ? {} : { organization: organizationId })
  };
  const job = await CVProcessingJob.findOne(filter).select('+resumeText');
  if (!job) throw manualRetryError('CV_JOB_NOT_FOUND', 'CV processing job was not found', 404);
  if (job.source === 'ai-interview') {
    throw manualRetryError('CV_RETRY_EXTERNAL_JOB', 'AI Interview CV jobs must be retried by the AI Interview service');
  }
  if (!job.supersededBy) {
    const successor = await CVProcessingJob.findOne({
      supersedes: job._id,
      organization: job.organization,
      state: { $ne: 'cancelled' }
    }).select('_id');
    if (successor) {
      await CVProcessingJob.updateOne(
        {
          _id: job._id,
          $or: [{ supersededBy: { $exists: false } }, { supersededBy: null }]
        },
        {
          $set: { supersededBy: successor._id },
          $unset: {
            'retry.availableUntil': 1,
            'retry.nextAttemptAt': 1,
            'retry.pendingTrigger': 1
          }
        }
      );
      job.supersededBy = successor._id;
    }
  }
  if (job.supersededBy) {
    throw manualRetryError(
      'CV_RETRY_SUPERSEDED',
      'A corrected CV revision has already replaced this processing job',
      409
    );
  }
  if (job.state !== 'failed') {
    throw manualRetryError(
      'CV_RETRY_NOT_FAILED',
      ['queued', 'waiting_for_chatgpt', 'processing'].includes(job.state)
        ? 'This CV processing job is already queued or running'
        : 'Only failed CV processing jobs can be retried'
    );
  }

  const summary = retrySummary(job, { includeCapabilities: true });
  if (!summary.available) {
    throw manualRetryError(
      'CV_RETRY_ASSET_UNAVAILABLE',
      'The retained CV is no longer available. Upload the CV again to create a new processing job.',
      410
    );
  }
  if (requestedStage === 'parsing' && !summary.canRetryParsing) {
    throw manualRetryError('CV_RETRY_PARSE_UNAVAILABLE', 'The original CV bytes are no longer available for parsing');
  }
  if (requestedStage === 'analysis' && !summary.canRetryAnalysis) {
    throw manualRetryError('CV_RETRY_ANALYSIS_UNAVAILABLE', 'CV text must be extracted successfully before analysis can be retried');
  }

  const failedStage = String(job.lastError?.stage || '');
  const effectiveStage = requestedStage === 'failed'
    ? (failedStage === 'analyzing' && job.resumeText ? 'analysis' : job.resumeText ? 'analysis' : 'parsing')
    : requestedStage;
  const queueStage = effectiveStage === 'analysis'
    ? 'analyzing'
    : job.cloudinary?.publicId ? 'extracting' : 'uploading';
  const progress = effectiveStage === 'analysis' ? 50 : queueStage === 'extracting' ? 30 : 10;
  const actor = retryActor(requestedBy || { type: administrator ? 'admin' : 'user' });
  const requestedAt = new Date();
  const retryEvent = processingStageEvent(
    'retry_scheduled',
    'queued',
    progress,
    job,
    null,
    requestedAt
  );
  const set = {
    state: 'queued',
    stage: 'retry_scheduled',
    stageStartedAt: requestedAt,
    progress,
    boundedFailureAttempts: 0,
    'retry.pendingTrigger': 'manual',
    'retry.requestedStage': requestedStage,
    'retry.lastRequestedAt': requestedAt,
    'retry.lastRequestedBy': actor,
    ...(actor.type === 'user' && mongoose.isValidObjectId(actor.id)
      ? { actor: actor.id }
      : {}),
    ...(job.durableFile?.fileId && !job.durableFile?.releasedAt
      ? { 'durableFile.cleanupState': 'retained' }
      : {}),
    ...(job.cloudinary?.publicId && !job.cloudinary?.releasedAt
      ? { 'cloudinary.cleanupState': 'retained' }
      : {})
  };
  const unset = {
    failedAt: 1,
    completedAt: 1,
    expiresAt: 1,
    lastError: 1,
    'retry.nextAttemptAt': 1,
    'durableFile.cleanupNextAttemptAt': 1,
    'durableFile.cleanupError': 1,
    'cloudinary.cleanupNextAttemptAt': 1,
    'cloudinary.cleanupError': 1,
    ...(effectiveStage === 'parsing' ? { resumeText: 1 } : {})
  };
  const claimed = await CVProcessingJob.findOneAndUpdate(
    { _id: job._id, state: 'failed', updatedAt: job.updatedAt },
    {
      $set: set,
      $unset: unset,
      $inc: { 'retry.manualRequests': 1 },
      $max: { processingAttempts: Number(job.attempts || 0) },
      $push: {
        stageHistory: {
          $each: [retryEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    },
    { new: true }
  ).select('+resumeText');
  if (!claimed) {
    throw manualRetryError('CV_RETRY_ALREADY_RUNNING', 'This CV processing job was retried by another request');
  }

  await CVStorageCleanupTask.updateMany(
    { jobPublicId: job.publicId, state: { $in: ['pending', 'failed'] } },
    {
      $set: {
        state: 'completed',
        completedAt: requestedAt,
        expiresAt: terminalJobExpiry(requestedAt.getTime()),
        reason: 'cancelled-for-manual-retry'
      },
      $unset: { nextAttemptAt: 1, lastError: 1 }
    }
  );

  let queueAvailable = true;
  try {
    await enqueueJob(claimed, { replaceTerminal: true });
  } catch (error) {
    if (error.code !== 'CV_RETRY_ALREADY_RUNNING') {
      queueAvailable = false;
      await CVProcessingJob.updateOne(
        { _id: claimed._id, state: 'queued' },
        {
          $set: {
            'retry.nextAttemptAt': new Date(Date.now() + 60_000),
            lastError: {
              code: error.code || 'CV_QUEUE_UNAVAILABLE',
              message: String(error.message || error).slice(0, 1000),
              stage: queueStage,
              at: new Date()
            }
          }
        }
      );
    }
  }
  const refreshed = await CVProcessingJob.findById(claimed._id).select('+resumeText');
  await syncLinkedCandidateProcessing(refreshed || claimed, {
    state: queueAvailable ? 'queued' : 'waiting',
    stage: 'retry_scheduled',
    error: queueAvailable ? null : processingError(refreshed || claimed),
    retryEligible: false
  });
  await syncHistorySafely(claimed._id);
  publishTelemetrySoon(0);
  return {
    job: refreshed || claimed,
    queueAvailable,
    requestedStage,
    effectiveStage,
    requestedAt
  };
}

async function retryJobNow(publicId, {
  organizationId,
  administrator = false,
  requestedBy,
  stage = 'failed'
} = {}) {
  if (!administrator && !organizationId) {
    throw manualRetryError('CV_RETRY_ORGANIZATION_REQUIRED', 'An organization is required to retry CV processing', 403);
  }
  const job = await CVProcessingJob.findOne({
    publicId: String(publicId || ''),
    ...(administrator ? {} : { organization: organizationId })
  }).select('+resumeText');
  if (!job) throw manualRetryError('CV_JOB_NOT_FOUND', 'CV processing job was not found', 404);
  if (job.source === 'ai-interview') {
    throw manualRetryError('CV_RETRY_EXTERNAL_JOB', 'AI Interview CV jobs retry automatically in the AI Interview service');
  }
  if (job.state === 'failed') {
    return retryFailedJob(job.publicId, {
      administrator,
      organizationId,
      requestedBy: requestedBy || { type: 'system', name: 'Seemplify ChatGPT Gateway' },
      stage
    });
  }
  if (job.state !== 'waiting_for_chatgpt') {
    throw manualRetryError(
      'CV_RETRY_NOT_WAITING',
      job.state === 'processing' ? 'This CV is already processing' : 'This CV job is not waiting for a retry'
    );
  }

  const q = await getQueue();
  const queued = await q.getJob(job.publicId);
  if (!queued) {
    await enqueueJob(job);
  } else if (await queued.getState() === 'delayed') {
    await queued.promote();
  }
  const requestedAt = new Date();
  const retryEvent = processingStageEvent(
    'retry_scheduled',
    'queued',
    Math.max(10, Number(job.progress || 10)),
    job,
    null,
    requestedAt
  );
  await CVProcessingJob.updateOne(
    { _id: job._id, state: 'waiting_for_chatgpt' },
    {
      $set: {
        state: 'queued',
        stage: 'retry_scheduled',
        stageStartedAt: requestedAt,
        'retry.pendingTrigger': 'manual',
        'retry.lastRequestedAt': requestedAt,
        'retry.lastRequestedBy': retryActor(requestedBy || { type: 'system', name: 'Seemplify ChatGPT Gateway' })
      },
      $unset: { 'retry.nextAttemptAt': 1 },
      $inc: { 'retry.manualRequests': 1 },
      $push: {
        stageHistory: {
          $each: [retryEvent],
          $slice: -HISTORY_TRANSITION_LIMIT
        }
      }
    }
  );
  const refreshed = await CVProcessingJob.findById(job._id).select('+resumeText');
  await syncLinkedCandidateProcessing(refreshed || job, {
    state: 'queued',
    stage: 'retry_scheduled',
    error: null,
    retryEligible: false
  });
  await syncHistorySafely(job._id);
  publishTelemetrySoon(0);
  return { job: refreshed || job, queueAvailable: true, requestedAt };
}

/**
 * Wakes an organization's parked CV analyses without waiting out their
 * backoff — called when a recruiter logs in, because their arrival is often
 * exactly what unblocks the work (a freshly routable ChatGPT account, or a
 * human about to fix the runtime). Returns what a login notification needs.
 */
async function promoteWaitingJobsForOrganization(organizationId, { limit = 25 } = {}) {
  const waiting = await CVProcessingJob.find({
    organization: organizationId,
    state: 'waiting_for_chatgpt',
    source: { $ne: 'ai-interview' }
  }).sort({ createdAt: 1 }).limit(Math.max(1, limit)).select('publicId').lean();
  let promoted = 0;
  for (const job of waiting) {
    try {
      await retryJobNow(job.publicId, {
        organizationId,
        requestedBy: { type: 'system', name: 'Login runtime check' }
      });
      promoted += 1;
    } catch (error) {
      if (error?.code !== 'CV_RETRY_NOT_WAITING') {
        console.warn(`CV login promotion skipped ${job.publicId}:`, error.message);
      }
    }
  }
  return { waiting: waiting.length, promoted };
}

function cleanupIsDue(resource, now) {
  return !resource?.cleanupNextAttemptAt
    || new Date(resource.cleanupNextAttemptAt).getTime() <= now.getTime();
}

async function sweepOrphanedDurableIntakes({ now = new Date(), pageSize = 100 } = {}) {
  if (typeof durableFileStore.sweepOrphanedIntakes !== 'function') {
    return { examined: 0, removed: 0, retained: 0, errors: 0 };
  }
  return durableFileStore.sweepOrphanedIntakes({
    now,
    pageSize,
    isReferenced: async (reference) => {
      if (!reference.intakeId) {
        return Boolean(await CVProcessingJob.exists({
          'durableFile.fileId': reference.fileId
        }));
      }
      const job = await CVProcessingJob.findOne({
        publicId: reference.intakeId,
        organization: reference.organizationId
      }).select('+requestFingerprint +intakeLeaseId');
      if (!job) return false;
      if (String(job.durableFile?.fileId || '') === String(reference.fileId)) return true;
      if (job.durableFile?.fileId || job.state !== 'queued' || job.stage !== 'received') {
        return false;
      }
      if (
        reference.requestFingerprint
        && job.requestFingerprint !== reference.requestFingerprint
      ) {
        return false;
      }
      const storedAt = reference.persistedAt || new Date();
      const durableFile = {
        provider: 'gridfs',
        bucket: reference.bucket,
        fileId: reference.fileId,
        sha256: reference.sha256,
        length: reference.length,
        persistedAt: storedAt,
        cleanupState: 'retained'
      };
      const storedEvent = processingStageEvent('stored', 'queued', 10, job, null, storedAt);
      const attached = await CVProcessingJob.findOneAndUpdate(
        {
          _id: job._id,
          state: 'queued',
          stage: 'received',
          'durableFile.fileId': { $exists: false }
        },
        {
          $set: {
            durableFile,
            stage: 'stored',
            stageStartedAt: storedAt,
            progress: 10,
            'artifacts.durableStoredAt': storedAt
          },
          $unset: { intakeLeaseId: 1, intakeLeaseAt: 1, lastError: 1 },
          $push: {
            stageHistory: {
              $each: [storedEvent],
              $slice: -HISTORY_TRANSITION_LIMIT
            }
          }
        },
        { new: true }
      );
      const current = attached || await CVProcessingJob.findById(job._id);
      if (String(current?.durableFile?.fileId || '') !== String(reference.fileId)) return false;
      await syncHistorySafely(current._id);
      await syncLinkedCandidateProcessing(current, {
        state: 'queued',
        stage: 'stored',
        progress: 10,
        retryEligible: false,
        error: null
      }).catch(() => {});
      return true;
    }
  });
}

async function reconcileBatchRetention({ now = new Date(), pageSize = 100 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const tail = await CVProcessingBatch.findOne({}).sort({ _id: -1 }).select('_id').lean();
  if (!tail) return { examined: 0, protected: 0, finalized: 0 };
  let cursor;
  let examined = 0;
  let protectedCount = 0;
  let finalized = 0;
  while (true) {
    const batches = await CVProcessingBatch.find({
      _id: { ...(cursor ? { $gt: cursor } : {}), $lte: tail._id }
    }).sort({ _id: 1 }).limit(size).populate({ path: 'jobs', select: 'state' });
    if (!batches.length) break;
    for (const batch of batches) {
      examined += 1;
      const terminalChildren = (batch.jobs || []).filter((job) => (
        ['completed', 'failed', 'cancelled'].includes(job.state)
      )).length + (batch.rejected || []).length;
      const terminal = batch.intakeState !== 'accepting'
        && terminalChildren >= Number(batch.totalFiles || 0);
      if (terminal) {
        if (!batch.expiresAt) {
          await CVProcessingBatch.updateOne(
            { _id: batch._id, expiresAt: { $exists: false } },
            { $set: { expiresAt: terminalJobExpiry(new Date(now).getTime()) } }
          );
          finalized += 1;
        }
      } else if (batch.expiresAt) {
        await CVProcessingBatch.updateOne(
          { _id: batch._id },
          { $unset: { expiresAt: 1 } }
        );
        protectedCount += 1;
      }
    }
    cursor = batches.at(-1)._id;
    if (String(cursor) === String(tail._id)) break;
  }
  return { examined, protected: protectedCount, finalized };
}

async function expireInterruptedIntakeLeases({ now = new Date(), limit = 100 } = {}) {
  const staleBefore = new Date(new Date(now).getTime() - INTAKE_LEASE_MS);
  const receipts = await CVProcessingJob.find({
    state: 'queued',
    stage: 'received',
    'durableFile.fileId': { $exists: false },
    intakeLeaseAt: { $lte: staleBefore }
  }).sort({ intakeLeaseAt: 1 }).limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
  let jobs = 0;
  for (const receipt of receipts) {
    const at = new Date(now);
    const updated = await CVProcessingJob.updateOne(
      {
        _id: receipt._id,
        state: 'queued',
        stage: 'received',
        'durableFile.fileId': { $exists: false },
        intakeLeaseAt: { $lte: staleBefore }
      },
      {
        $set: {
          lastError: {
            code: 'CV_INTAKE_REUPLOAD_REQUIRED',
            message: 'The original upload was interrupted before durable storage. Replay the same file and Idempotency-Key.',
            stage: 'received',
            at
          }
        },
        $unset: { intakeLeaseId: 1, intakeLeaseAt: 1 }
      }
    );
    if (!Number(updated.modifiedCount || updated.nModified || 0)) continue;
    jobs += 1;
    const current = await CVProcessingJob.findById(receipt._id);
    if (current) {
      await syncLinkedCandidateProcessing(current, {
        state: 'failed',
        stage: 'received',
        progress: 0,
        retryEligible: false,
        error: processingError(current)
      }).catch(() => {});
      await syncHistorySafely(current._id);
    }
  }
  const batches = await CVProcessingBatch.updateMany(
    { intakeState: 'accepting', intakeLeaseAt: { $lte: staleBefore } },
    { $unset: { intakeLeaseId: 1, intakeLeaseAt: 1 } }
  );
  return {
    jobs,
    batches: Number(batches.modifiedCount || batches.nModified || 0)
  };
}

async function retryStorageCleanup({
  now = new Date(),
  limit = 100
} = {}) {
  const interruptedIntakes = await expireInterruptedIntakeLeases({ now, limit });
  const orphanedDurableFiles = await sweepOrphanedDurableIntakes({ now, pageSize: limit })
    .catch((error) => ({ examined: 0, removed: 0, retained: 0, errors: 1, error: error.message }));
  const staleRequestUploads = await staleCvUploadSweeper.sweepStaleUploads({ now, limit })
    .catch((error) => ({ examined: 0, removed: 0, retained: 0, errors: 1, error: error.message }));
  const batchRetention = await reconcileBatchRetention({ now, pageSize: limit });
  const publicApplicationCommits = await publicApplicationCapacityService
    .reconcileCandidateCommitStates({ limit, now });
  const candidateErasures = await recoverTombstonedCandidateErasures({ limit });
  const organizationErasures = await require('./organizationErasureService')
    .recoverOrganizationErasures({ limit: Math.min(limit, 20) });
  const dueTasks = await CVStorageCleanupTask.find({
    state: { $in: ['pending', 'failed'] },
    $or: [
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: null },
      { nextAttemptAt: { $lte: now } }
    ]
  }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(limit);
  let tasksCompleted = 0;
  for (const task of dueTasks) {
    try {
      if (await executeCleanupTask(task, { now })) tasksCompleted += 1;
    } catch {}
  }

  const terminalJobs = await CVProcessingJob.find({
    state: { $in: ['completed', 'failed', 'cancelled'] },
    $or: [
      {
        'durableFile.fileId': { $exists: true },
        'durableFile.releasedAt': null,
        'durableFile.cleanupState': { $ne: 'deleted' }
      },
      {
        state: { $in: ['failed', 'cancelled'] },
        'cloudinary.publicId': { $exists: true },
        'cloudinary.releasedAt': null,
        'cloudinary.cleanupState': { $ne: 'deleted' }
      },
      {
        state: { $in: ['failed', 'cancelled'] },
        'cloudinaryUploadIntent.publicId': { $exists: true }
      }
    ]
  }).sort({ updatedAt: 1 }).limit(limit);
  let jobsFinalized = 0;
  for (const job of terminalJobs) {
    if (
      job.durableFile?.fileId
      && !job.durableFile.releasedAt
      && job.durableFile.cleanupState !== 'deleted'
      && cleanupIsDue(job.durableFile, now)
    ) {
      await releaseDurableFile(job).catch(() => {});
    }
    if (
      job.state === 'failed'
      && job.cloudinary?.publicId
      && !job.cloudinary.releasedAt
      && job.cloudinary.cleanupState !== 'deleted'
      && cleanupIsDue(job.cloudinary, now)
    ) {
      await releaseCloudinaryAsset(job).catch(() => {});
    }
    if (
      ['failed', 'cancelled'].includes(job.state)
      && job.cloudinaryUploadIntent?.publicId
    ) {
      await releaseCloudinaryUploadIntent(
        job,
        job.cloudinaryUploadIntent,
        'terminal-cloudinary-upload-intent'
      ).catch(() => {});
    }
    if (await finalizeTerminalExpiry(job)) jobsFinalized += 1;
  }
  return {
    tasksCompleted,
    jobsFinalized,
    orphanedDurableFiles,
    staleRequestUploads,
    batchRetention,
    interruptedIntakes,
    publicApplicationCommits,
    candidateErasures,
    organizationErasures
  };
}

async function startStorageCleanupMaintenance() {
  await retryStorageCleanup().catch((error) => {
    console.error('CV storage cleanup recovery failed:', error.message);
  });
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      void retryStorageCleanup().catch((error) => {
        console.error('CV storage cleanup retry failed:', error.message);
      });
    }, 30_000);
    cleanupTimer.unref?.();
  }
}

async function recoverStaleJobs() {
  const q = await getQueue();
  await repairReplacementActivations();
  const staleBefore = new Date(Date.now() - 60_000);
  const baseFilter = {
    state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] },
    $and: [
      {
        $or: [
          { updatedAt: { $lt: staleBefore } },
          { supersedes: { $exists: true } }
        ]
      },
      {
        $nor: [{
          stage: 'received',
          'durableFile.fileId': { $exists: false }
        }]
      }
    ],
    $or: [
      { 'billing.required': { $ne: true } },
      { 'billing.state': 'charged' }
    ]
  };
  let recovered = 0;
  let cursor = null;
  do {
    const cursorFilter = cursor
      ? {
          $or: [
            { createdAt: { $gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $gt: cursor.id } }
          ]
        }
      : null;
    const stale = await CVProcessingJob.find({
      ...baseFilter,
      ...(cursorFilter ? { $and: [...baseFilter.$and, cursorFilter] } : {})
    }).sort({ createdAt: 1, _id: 1 }).limit(500);
    for (const job of stale) {
      if (job.supersedes && !(await activateReplacementRevision(job))) continue;
      await projectStoredCvOntoLinkedCandidate(job).catch((error) => {
        console.error('CV managed-file candidate projection repair failed:', error.message);
      });
      await syncLinkedCandidateProcessing(job).catch((error) => {
        console.error('CV candidate processing projection repair failed:', error.message);
      });
      const existing = await q.getJob(job.publicId);
      if (!existing) {
        if (job.state === 'processing') {
          const reset = await CVProcessingJob.findOneAndUpdate(
            { _id: job._id, state: 'processing', updatedAt: job.updatedAt },
            {
              $set: {
                state: 'queued',
                'retry.pendingTrigger': 'automatic',
                'retry.requestedStage': 'failed'
              }
            },
            { new: true }
          );
          if (!reset) continue;
          await addQueueJob(reset);
        } else {
          await addQueueJob(job);
        }
        recovered += 1;
        continue;
      }
      const queueState = await existing.getState();
      if (['completed', 'failed'].includes(queueState)) {
        let runnableJob = job;
        if (job.state === 'processing') {
          runnableJob = await CVProcessingJob.findOneAndUpdate(
            { _id: job._id, state: 'processing', updatedAt: job.updatedAt },
            {
              $set: {
                state: 'queued',
                'retry.pendingTrigger': 'automatic',
                'retry.requestedStage': 'failed'
              }
            },
            { new: true }
          );
          if (!runnableJob) continue;
        }
        await addQueueJob(runnableJob, { replaceTerminal: true });
        recovered += 1;
      }
    }
    const last = stale.at(-1);
    cursor = stale.length === 500 && last
      ? { createdAt: last.createdAt, id: last._id }
      : null;
  } while (cursor);
  if (recovered) publishTelemetrySoon();
  return recovered;
}

async function publishTelemetry() {
  return true;
}

function evaluateWorkerReadiness({
  environment = process.env.NODE_ENV,
  queueEnabled = redisEnabled,
  mongoReady = mongoose.connection.readyState === 1,
  indexesReady = cvIndexesReady,
  workerInitialized = Boolean(worker),
  dispatchHealth = globalDispatch.health()
} = {}) {
  const dispatcherRequired = environment === 'production' || queueEnabled === true;
  const dispatcherReady = !dispatcherRequired || (
    queueEnabled === true
    && workerInitialized === true
    && dispatchHealth?.initialized === true
    && dispatchHealth?.healthy === true
    && dispatchHealth?.stopping !== true
  );
  const durableStorageReady = mongoReady === true;
  const indexSetReady = indexesReady === true;
  return {
    healthy: durableStorageReady && indexSetReady && dispatcherReady,
    durableStorage: {
      ready: durableStorageReady,
      provider: 'mongodb-gridfs'
    },
    indexes: {
      ready: indexSetReady
    },
    dispatcher: {
      required: dispatcherRequired,
      enabled: queueEnabled === true,
      ready: dispatcherReady,
      workerInitialized: workerInitialized === true,
      global: {
        initialized: dispatchHealth?.initialized === true,
        healthy: dispatchHealth?.healthy === true,
        stopping: dispatchHealth?.stopping === true,
        errorCode: dispatchHealth?.errorCode || null
      }
    }
  };
}

function readiness() {
  return evaluateWorkerReadiness();
}

async function initWorker() {
  if (worker) return worker;
  await startStorageCleanupMaintenance();
  globalDispatch.open();
  let startupDispatchState;
  try {
    await CVProcessingJob.updateMany(
      {
        state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] },
        expiresAt: { $exists: true }
      },
      { $unset: { expiresAt: 1 } }
    );
    await Promise.all([
      CVProcessingJob.init(),
      CVProcessingAudit.init(),
      CVStorageCleanupTask.init(),
      CVProcessingBatch.init()
    ]);
    cvIndexesReady = true;
    await getQueue();
    startupDispatchState = await globalDispatch.initialize();
    await applyGlobalDispatchState(startupDispatchState);
  } catch (error) {
    if (!initRetryTimer) {
      initRetryTimer = setInterval(() => {
        void initWorker().catch(() => {});
      }, 30_000);
      initRetryTimer.unref?.();
    }
    throw error;
  }
  if (initRetryTimer) clearInterval(initRetryTimer);
  initRetryTimer = null;
  worker = new Worker(queueName, processJob, {
    connection,
    concurrency: Math.max(1, Math.min(concurrency, startupDispatchState.limit)),
    settings: {
      backoffStrategy: (attemptsMade, type, error) => {
        if (type !== 'cv-runtime') throw new Error(`Unsupported CV queue backoff type: ${type}`);
        return cvBackoffDelay(attemptsMade, error);
      }
    }
  });
  worker.on('error', (error) => console.error('CV analysis worker error:', error.message));
  for (const eventName of ['active', 'progress', 'completed', 'stalled']) {
    worker.on(eventName, () => publishTelemetrySoon());
  }
  worker.on('failed', async (job, error) => {
    publishTelemetrySoon();
    if (!job || Number(job.attemptsMade || 0) < Number(job.opts.attempts || 0)) return;
    await CVProcessingJob.updateOne({
      publicId: job.id,
      state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] }
    }, {
      $set: {
        state: 'failed',
        failedAt: new Date(),
        lastError: { code: error.code || 'CV_ANALYSIS_FAILED', message: String(error.message).slice(0, 1000), at: new Date() }
      }
    });
    const processingJob = await CVProcessingJob.findOne({ publicId: job.id }).select('_id').lean();
    if (processingJob) await syncHistorySafely(processingJob._id);
    publishTelemetrySoon();
  });
  await backfillHistory().catch((error) => {
    console.error('CV processing history backfill failed:', error.message);
  });
  await recoverStaleJobs();
  await recoverPendingPrivateBilling().catch((error) => {
    console.error('CV pending billing recovery failed:', error.message);
  });
  await recoverCompletionEffects().catch((error) => {
    console.error('CV completion effect recovery failed:', error.message);
  });
  if (!maintenanceTimer) {
    maintenanceTimer = setInterval(() => {
      void recoverPendingPrivateBilling().catch((error) => {
        console.error('CV pending billing recovery failed:', error.message);
      });
      void recoverStaleJobs().catch(() => {});
      void recoverCompletionEffects().catch((error) => {
        console.error('CV completion effect recovery failed:', error.message);
      });
      void backfillHistory().catch((error) => {
        console.error('CV processing history repair failed:', error.message);
      });
    }, 30_000);
    maintenanceTimer.unref?.();
  }
  if (!telemetryTimer) {
    telemetryTimer = setInterval(() => {
      void publishTelemetry().catch(() => {});
    }, 5_000);
    telemetryTimer.unref?.();
  }
  if (!dispatchControlTimer) {
    dispatchControlTimer = setInterval(() => {
      void synchronizeGlobalDispatchControl().catch(() => {});
    }, 1_000);
    dispatchControlTimer.unref?.();
  }
  void publishTelemetry().catch(() => {});
  return worker;
}

async function getStatus(publicId, statusToken) {
  const job = await CVProcessingJob.findOne({ publicId }).select('+statusTokenHash').populate('candidate');
  if (!job || !statusToken || !hashesMatch(tokenHash(statusToken), job.statusTokenHash)) return null;
  const result = publicState(job);
  if (job.state === 'completed' && job.candidate && typeof job.candidate === 'object') {
    result.candidate = job.candidate.toObject ? job.candidate.toObject() : job.candidate;
  }
  if (['queued', 'waiting_for_chatgpt'].includes(job.state)) {
    try {
      const q = await getQueue();
      const waiting = await q.getJobs(['prioritized', 'waiting', 'delayed'], 0, 5000, true);
      const index = waiting.findIndex((item) => item.id === publicId);
      result.position = index >= 0 ? index + 1 : null;
    } catch {
      result.queueAvailable = false;
    }
  }
  return result;
}

function recentAuditQuery(filter, limit) {
  return CVProcessingAudit.find(filter)
    .sort({ lastUpdatedAt: -1, publicId: -1 })
    .limit(limit)
    .lean();
}

async function loadRecentProducerAudits(producer, limit = TELEMETRY_RECENT_LIMIT) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || TELEMETRY_RECENT_LIMIT));
  const [active, latest] = await Promise.all([
    recentAuditQuery({
      producer,
      state: { $in: TELEMETRY_ACTIVE_STATES }
    }, safeLimit),
    recentAuditQuery({ producer }, safeLimit)
  ]);
  const activeIds = new Set(active.map((audit) => audit.publicId));
  return [
    ...active,
    ...latest.filter((audit) => !activeIds.has(audit.publicId))
  ].slice(0, safeLimit);
}

async function loadRecentExternalAudits(limit = TELEMETRY_RECENT_LIMIT) {
  return loadRecentProducerAudits('ai-interview', limit);
}

async function loadExternalTelemetrySnapshot({ oneHourAgo, fiveMinutesAgo }) {
  const states = ['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed'];
  const [
    stateCounts,
    recent,
    completed,
    oldest,
    completedLast5Minutes,
    completedLastHour,
    failedLastHour,
    retrying
  ] = await Promise.all([
    Promise.all(states.map(async (state) => ({
      _id: state,
      count: await CVProcessingAudit.countDocuments({ producer: 'ai-interview', state })
    }))),
    loadRecentExternalAudits(TELEMETRY_RECENT_LIMIT),
    CVProcessingAudit.find({
      producer: 'ai-interview',
      state: 'completed',
      completedAt: { $gte: oneHourAgo },
      startedAt: { $ne: null }
    })
      .sort({ completedAt: -1 })
      .limit(500)
      .select('startedAt completedAt')
      .lean(),
    CVProcessingAudit.findOne({
      producer: 'ai-interview',
      state: { $in: ['queued', 'waiting_for_chatgpt'] }
    })
      .sort({ jobCreatedAt: 1 })
      .select('jobCreatedAt')
      .lean(),
    CVProcessingAudit.countDocuments({
      producer: 'ai-interview',
      state: 'completed',
      completedAt: { $gte: fiveMinutesAgo }
    }),
    CVProcessingAudit.countDocuments({
      producer: 'ai-interview',
      state: 'completed',
      completedAt: { $gte: oneHourAgo }
    }),
    CVProcessingAudit.countDocuments({
      producer: 'ai-interview',
      state: 'failed',
      failedAt: { $gte: oneHourAgo }
    }),
    CVProcessingAudit.countDocuments({
      producer: 'ai-interview',
      state: { $in: TELEMETRY_ACTIVE_STATES },
      attempts: { $gt: 1 }
    })
  ]);
  return {
    states: stateCounts.filter((row) => Number(row.count || 0) > 0),
    recent,
    completed,
    oldest: oldest ? [oldest] : [],
    counters: [{
      completedLast5Minutes,
      completedLastHour,
      failedLastHour,
      retrying
    }]
  };
}

async function loadAdminAudits(recruiterPublicIds, limit = ADMIN_TELEMETRY_LIMIT) {
  const safeIds = [...new Set((recruiterPublicIds || []).filter(Boolean))].slice(0, limit * 2);
  const [matchingRecruiterAudits, recentRecruiterAudits, externalAudits] = await Promise.all([
    safeIds.length
      ? CVProcessingAudit.find({ publicId: { $in: safeIds } })
        .select('publicId transitions')
        .lean()
      : [],
    loadRecentProducerAudits('recruiter', limit),
    loadRecentExternalAudits(limit)
  ]);
  const recruiterAudits = [...new Map([
    ...matchingRecruiterAudits,
    ...recentRecruiterAudits
  ].map((audit) => [audit.publicId, audit])).values()];
  return { recruiterAudits, externalAudits };
}

async function telemetry() {
  const sampledAt = new Date();
  const oneHourAgo = new Date(sampledAt.getTime() - 60 * 60_000);
  const fiveMinutesAgo = new Date(sampledAt.getTime() - 5 * 60_000);
  const [
    oldest,
    stateRows,
    activeRows,
    recentRows,
    recentCompletedRows,
    completedLast5Minutes,
    completedLastHour,
    failedLastHour,
    retrying,
    historyStateRows
  ] = await Promise.all([
    CVProcessingJob.findOne({ state: { $in: ['queued', 'waiting_for_chatgpt'] } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean(),
    CVProcessingJob.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]),
    CVProcessingJob.find({ state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] } })
      .sort({ updatedAt: -1 })
      .limit(12)
      .select('publicId source state stage progress attempts createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .lean(),
    CVProcessingJob.find({})
      .sort({ updatedAt: -1 })
      .limit(24)
      .select('publicId source state stage progress attempts createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .lean(),
    CVProcessingJob.find({ state: 'completed', completedAt: { $gte: oneHourAgo }, startedAt: { $ne: null } })
      .sort({ completedAt: -1 })
      .limit(500)
      .select('startedAt completedAt')
      .lean(),
    CVProcessingJob.countDocuments({ state: 'completed', completedAt: { $gte: fiveMinutesAgo } }),
    CVProcessingJob.countDocuments({ state: 'completed', completedAt: { $gte: oneHourAgo } }),
    CVProcessingJob.countDocuments({ state: 'failed', failedAt: { $gte: oneHourAgo } }),
    CVProcessingJob.countDocuments({
      state: { $in: ['queued', 'waiting_for_chatgpt', 'processing'] },
      attempts: { $gt: 1 }
    }),
    CVProcessingAudit.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ])
  ]);
  const externalSnapshot = await loadExternalTelemetrySnapshot({ oneHourAgo, fiveMinutesAgo });
  const durable = Object.fromEntries(stateRows.map((row) => [String(row._id), Number(row.count || 0)]));
  const externalDurable = Object.fromEntries((externalSnapshot.states || [])
    .map((row) => [String(row._id), Number(row.count || 0)]));
  const historyStates = Object.fromEntries((historyStateRows || [])
    .map((row) => [String(row._id), Number(row.count || 0)]));
  const activeIds = new Set(activeRows.map((job) => job.publicId));
  const orderedRecentRows = [
    ...activeRows,
    ...recentRows.filter((job) => !activeIds.has(job.publicId))
  ].slice(0, 12);
  const recentAudits = await CVProcessingAudit.find({
    publicId: { $in: orderedRecentRows.map((job) => job.publicId) }
  })
    .select('publicId transitions')
    .lean();
  const durations = recentCompletedRows
    .map((job) => elapsedMs(job.startedAt, job.completedAt))
    .concat((externalSnapshot.completed || []).map((job) => elapsedMs(job.startedAt, job.completedAt)))
    .filter((value) => Number.isFinite(value));
  const transitionsByJob = new Map(recentAudits.map((audit) => [
    audit.publicId,
    operationalTransitions(audit.transitions)
  ]));
  const ownRecentJobs = orderedRecentRows.map((job) => ({
    ...operationalJob(job, sampledAt),
    producer: 'recruiter',
    queue: queueName,
    transitions: transitionsByJob.get(job.publicId) || []
  }));
  const externalRecentJobs = (externalSnapshot.recent || []).map(auditOperationalJob);
  const recentJobs = [...ownRecentJobs, ...externalRecentJobs]
    .sort((left, right) => {
      const leftActive = ['queued', 'waiting_for_chatgpt', 'processing'].includes(left.state) ? 0 : 1;
      const rightActive = ['queued', 'waiting_for_chatgpt', 'processing'].includes(right.state) ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
    })
    .slice(0, 12);
  const counters = externalSnapshot.counters?.[0] || {};
  const ownOldestAt = oldest?.createdAt ? new Date(oldest.createdAt) : null;
  const externalOldestAt = externalSnapshot.oldest?.[0]?.jobCreatedAt
    ? new Date(externalSnapshot.oldest[0].jobCreatedAt)
    : null;
  const oldestQueuedAt = [ownOldestAt, externalOldestAt]
    .filter((value) => value && Number.isFinite(value.getTime()))
    .sort((left, right) => left - right)[0] || null;
  const operational = {
    sampledAt: sampledAt.toISOString(),
    durable: {
      queued: Number(durable.queued || 0) + Number(externalDurable.queued || 0),
      waitingForRuntime: Number(durable.waiting_for_chatgpt || 0) + Number(externalDurable.waiting_for_chatgpt || 0),
      processing: Number(durable.processing || 0) + Number(externalDurable.processing || 0),
      completed: Number(durable.completed || 0) + Number(externalDurable.completed || 0),
      failed: Number(durable.failed || 0) + Number(externalDurable.failed || 0),
      retrying: Number(retrying || 0) + Number(counters.retrying || 0)
    },
    rates: {
      completedLast5Minutes: Number(completedLast5Minutes || 0) + Number(counters.completedLast5Minutes || 0),
      completedLastHour: Number(completedLastHour || 0) + Number(counters.completedLastHour || 0),
      failedLastHour: Number(failedLastHour || 0) + Number(counters.failedLastHour || 0),
      averageProcessingMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : 0,
      p95ProcessingMs: percentile(durations, 0.95)
    },
    history: {
      retainedIndefinitely: false,
      retentionDays: AUDIT_RETENTION_DAYS,
      total: Object.values(historyStates).reduce((sum, value) => sum + Number(value || 0), 0),
      completed: Number(historyStates.completed || 0),
      failed: Number(historyStates.failed || 0),
      active: Number(historyStates.queued || 0)
        + Number(historyStates.waiting_for_chatgpt || 0)
        + Number(historyStates.processing || 0)
    },
    retention: {
      recruiterStateWindowDays: Math.round(TERMINAL_JOB_RETENTION_MS / (24 * 60 * 60 * 1000)),
      aiInterviewStateSource: 'bounded-audit',
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      permanentHistory: false
    },
    oldestQueuedAt,
    oldestWaitMs: oldestQueuedAt ? elapsedMs(oldestQueuedAt, sampledAt) : 0,
    recentJobs,
    queues: [
      {
        name: queueName,
        producer: 'recruiter',
        durable: Object.fromEntries(Object.entries(durable).map(([key, value]) => [key, Number(value || 0)]))
      },
      {
        name: 'ai-interview-cv-analysis-chatgpt',
        producer: 'ai-interview',
        durable: externalDurable
      }
    ]
  };
  let dispatchState;
  try {
    const q = await getQueue();
    const [counts, queuePaused, sampledDispatchState] = await Promise.all([
      q.getJobCounts('prioritized', 'waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
      q.isPaused(),
      globalDispatch.state()
    ]);
    dispatchState = sampledDispatchState;
    const ownActive = Number(counts.active || 0);
    counts.waiting = Number(counts.waiting || 0) + Number(externalDurable.queued || 0);
    counts.waitingTotal = Number(counts.waiting || 0) + Number(counts.prioritized || 0);
    counts.active = Number(counts.active || 0) + Number(externalDurable.processing || 0);
    counts.delayed = Number(counts.delayed || 0) + Number(externalDurable.waiting_for_chatgpt || 0);
    counts.completed = Number(counts.completed || 0) + Number(externalDurable.completed || 0);
    counts.failed = Number(counts.failed || 0) + Number(externalDurable.failed || 0);
    const sharedWorker = sharedDispatchWorkerState(dispatchState, { ownActive });
    return {
      queue: queueName,
      concurrency: sharedWorker.concurrency,
      available: true,
      counts,
      paused: queuePaused || dispatchState.paused === true,
      worker: sharedWorker,
      ...operational
    };
  } catch (error) {
    const waiting = operational.durable.queued + operational.durable.waitingForRuntime;
    const durableActive = operational.durable.processing;
    dispatchState = dispatchState || await globalDispatch.state().catch(() => null);
    const sharedWorker = sharedDispatchWorkerState(
      dispatchState || { limit: workerConcurrency(), active: durableActive },
      { ownActive: Number(durable.processing || 0) }
    );
    return {
      queue: queueName,
      concurrency: sharedWorker.concurrency,
      available: false,
      counts: {
        prioritized: 0,
        waiting,
        waitingTotal: waiting,
        active: durableActive,
        delayed: operational.durable.waitingForRuntime,
        completed: operational.durable.completed,
        failed: operational.durable.failed,
        paused: 0
      },
      paused: dispatchState?.paused === true,
      worker: sharedWorker,
      error: error.message,
      ...operational
    };
  }
}

function adminJobQuery(filter, limit) {
  let query = CVProcessingJob.find(filter)
    .sort({ updatedAt: -1 });
  if (limit) query = query.limit(limit);
  return query
    .select('publicId source state stage stageStartedAt stageHistory artifacts progress attempts processingAttempts boundedFailureAttempts retry attemptHistory durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt cancelledAt updatedAt lastError originalName fileType fileSize organization actor jobAppliedFor candidate linkedCandidate batch batchPublicId supersededBy supersedes revision formData.firstName formData.lastName formData.email formData.position formData.location')
    .populate('organization', 'name')
    .populate('actor', 'email profile.firstName profile.lastName profile.displayName')
    .populate('jobAppliedFor', 'title')
    .populate('candidate', 'firstName lastName email')
    .populate('linkedCandidate', 'firstName lastName email createdAt')
    .lean();
}

async function adminTelemetry() {
  const [snapshot, activeJobs, latestJobs] = await Promise.all([
    telemetry(),
    adminJobQuery({ state: { $in: TELEMETRY_ACTIVE_STATES } }, ADMIN_TELEMETRY_LIMIT),
    adminJobQuery({}, ADMIN_TELEMETRY_LIMIT)
  ]);
  const jobs = [...new Map([...activeJobs, ...latestJobs].map((job) => [job.publicId, job])).values()];
  const { recruiterAudits, externalAudits } = await loadAdminAudits(
    jobs.map((job) => job.publicId),
    ADMIN_TELEMETRY_LIMIT
  );
  const sampledAt = new Date(snapshot.sampledAt || Date.now());
  const auditById = new Map(recruiterAudits.map((audit) => [audit.publicId, audit]));
  const recruiterJobs = jobs.map((job) => ({
    ...adminOperationalJob(job, sampledAt),
    transitions: operationalTransitions(auditById.get(job.publicId)?.transitions || [])
  }));
  const liveRecruiterIds = new Set(recruiterJobs.map((job) => job.jobId));
  const [retainedRecruiterJobs, externalJobs] = await Promise.all([
    adminJobsFromAudits(recruiterAudits.filter((audit) => !liveRecruiterIds.has(audit.publicId))),
    adminJobsFromAudits(externalAudits)
  ]);
  const activityRank = (job) => ['queued', 'waiting_for_chatgpt', 'processing'].includes(job.state) ? 0 : 1;
  const mergedJobs = [...new Map([
    ...retainedRecruiterJobs,
    ...externalJobs,
    ...recruiterJobs
  ].map((job) => [job.jobId, job])).values()];
  return {
    ...snapshot,
    recentJobs: mergedJobs
      .sort((left, right) => activityRank(left) - activityRank(right)
        || new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0))
      .slice(0, 25)
  };
}

async function getAdminJobDetail(publicId) {
  const normalizedId = String(publicId || '');
  const [jobs, audit] = await Promise.all([
    adminJobQuery({ publicId: normalizedId }, 1),
    CVProcessingAudit.findOne({ publicId: normalizedId }).lean()
  ]);
  if (jobs[0]) {
    return {
      ...adminOperationalJob(jobs[0], new Date()),
      transitions: operationalTransitions(audit?.transitions || [])
    };
  }
  if (!audit) return null;
  return (await adminJobsFromAudits([audit]))[0] || null;
}

async function getOrganizationJobDetail(organizationId, publicId) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw manualRetryError(
      'CV_HISTORY_ORGANIZATION_REQUIRED',
      'An organization is required to view CV processing jobs',
      403
    );
  }
  const normalizedId = String(publicId || '').slice(0, 120);
  const organizationKey = String(organizationId);
  const [jobs, audit] = await Promise.all([
    adminJobQuery({
      publicId: normalizedId,
      organization: organizationId
    }, 1),
    CVProcessingAudit.findOne({
      publicId: normalizedId,
      organizationKey
    }).lean()
  ]);
  if (jobs[0]) {
    return {
      ...adminOperationalJob(jobs[0], new Date()),
      transitions: operationalTransitions(audit?.transitions || [])
    };
  }
  if (!audit) return null;
  return (await adminJobsFromAudits([audit]))[0] || null;
}

function compactAdminJob(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    producer: job.producer,
    state: job.state,
    phase: job.phase,
    stage: job.stage,
    progress: job.progress,
    attempts: job.attempts,
    aiAttempts: job.aiAttempts,
    processingAttempts: job.processingAttempts,
    updatedAt: job.updatedAt,
    errorCode: job.errorCode,
    retry: job.retry
  };
}

async function getAdminJobSummaries(publicIds = []) {
  const ids = [...new Set(publicIds.map((value) => String(value || '')).filter(Boolean))].slice(0, 100);
  if (!ids.length) return {};
  const [jobs, audits] = await Promise.all([
    adminJobQuery({ publicId: { $in: ids } }),
    CVProcessingAudit.find({ publicId: { $in: ids } }).lean()
  ]);
  const auditById = new Map(audits.map((audit) => [audit.publicId, audit]));
  const current = jobs.map((job) => ({
    ...adminOperationalJob(job, new Date()),
    transitions: operationalTransitions(auditById.get(job.publicId)?.transitions || [])
  }));
  const currentIds = new Set(current.map((job) => job.jobId));
  const retained = await adminJobsFromAudits(audits.filter((audit) => !currentIds.has(audit.publicId)));
  return Object.fromEntries(
    [...current, ...retained].map((job) => [job.jobId, compactAdminJob(job)])
  );
}

async function setPaused(paused) {
  await synchronizeGlobalDispatchControl({ paused: paused === true });
  publishTelemetrySoon(0);
  return telemetry();
}

function setDependenciesForTests(overrides = {}) {
  if (overrides.cvParser) cvParser = overrides.cvParser;
  if (overrides.cloudinary) cloudinary = overrides.cloudinary;
  if (overrides.storageConfigurationResolver) {
    storageConfigurationResolver = overrides.storageConfigurationResolver;
  }
  if (overrides.durableFileStore) durableFileStore = overrides.durableFileStore;
  if (overrides.enqueueJob) enqueueJob = overrides.enqueueJob;
  if (overrides.queue) queueOverrideForTests = overrides.queue;
  if (overrides.dispatchInferenceRunner) {
    runInferenceWithGlobalPermit = overrides.dispatchInferenceRunner;
  }
  if (overrides.completionEffectHandlers) {
    completionEffectHandlers = {
      ...completionEffectHandlers,
      ...overrides.completionEffectHandlers
    };
  }
  if (overrides.batchLifecycleHooks) {
    batchLifecycleHooks = { ...overrides.batchLifecycleHooks };
  }
  if (overrides.intakeLifecycleHooks) {
    intakeLifecycleHooks = { ...overrides.intakeLifecycleHooks };
  }
  if (overrides.batchFileHasher) batchFileHasher = overrides.batchFileHasher;
}

function resetDependenciesForTests() {
  cvParser = defaultCvParser;
  cloudinary = defaultCloudinary;
  storageConfigurationResolver = resolveStoragePlatformConfiguration;
  durableFileStore = durableCvFileStore;
  enqueueJob = (...args) => addQueueJob(...args);
  queueOverrideForTests = undefined;
  runInferenceWithGlobalPermit = defaultDispatchInferenceRunner;
  completionEffectHandlers = { ...defaultCompletionEffectHandlers };
  batchLifecycleHooks = {};
  intakeLifecycleHooks = {};
  batchFileHasher = (...args) => sha256Path(...args);
}

async function closeForTests() {
  globalDispatch.beginShutdown();
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = null;
  if (dispatchControlTimer) clearInterval(dispatchControlTimer);
  dispatchControlTimer = null;
  if (telemetryDebounceTimer) clearTimeout(telemetryDebounceTimer);
  telemetryDebounceTimer = null;
  if (initRetryTimer) clearInterval(initRetryTimer);
  initRetryTimer = null;
  historyBackfillPromise = null;
  lastHistoryBackfillAt = 0;
  historyBackfillCursor = null;
  cvIndexesReady = false;
  if (worker) await worker.close();
  worker = null;
  await globalDispatch.releaseAll();
  if (queue) await queue.close();
  queue = null;
  if (connection && connection.status !== 'end') await connection.quit();
  if (globalDispatchConnection && globalDispatchConnection.status !== 'end') {
    await globalDispatchConnection.quit();
  }
  resetDependenciesForTests();
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, Number(limit) || 1)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function removeUploadFiles(files = []) {
  await Promise.all((files || []).map(async (file) => {
    if (!file?.path) return;
    try { await unlinkAsync(file.path); } catch {}
  }));
}

async function submitBatchUnfenced(req, options = {}) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    const error = new Error('No CV files were uploaded');
    error.statusCode = 400;
    throw error;
  }
  const { organizationId } = await resolveSubmissionContext(req, 'bulk');
  if (!organizationId) {
    const error = new Error('Organization required');
    error.statusCode = 400;
    throw error;
  }
  try {
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    await removeUploadFiles(files);
    throw error;
  }
  const baseIdempotency = String(req.get?.('Idempotency-Key') || '').trim().slice(0, 200);
  if (!baseIdempotency) {
    for (const file of files) {
      try { await unlinkAsync(file.path); } catch {}
    }
    const error = new Error('An Idempotency-Key is required for bulk CV uploads');
    error.code = 'CV_BATCH_IDEMPOTENCY_KEY_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  const ingestConcurrency = Math.max(1, Math.min(16, Number(process.env.CV_BULK_INGEST_CONCURRENCY || 4)));
  let batchRequestFingerprint;
  let manifest;
  try {
    manifest = await mapWithConcurrency(files, ingestConcurrency, async (file) => ({
      name: String(file.originalname || ''),
      size: Number(file.size || 0),
      sha256: await batchFileHasher(file.path)
    }));
    batchRequestFingerprint = digestRequest({
      version: 1,
      mode: 'bulk',
      source: 'bulk',
      organizationId: String(organizationId),
      actorId: String(req.user?.id || ''),
      files: manifest
    });
  } catch (error) {
    for (const file of files) {
      try { await unlinkAsync(file.path); } catch {}
    }
    throw error;
  }
  try {
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    await removeUploadFiles(files);
    throw error;
  }
  let batch;
  let receiptCreated = false;
  const intakeLeaseId = crypto.randomUUID();
  const intakeLeaseAt = new Date();
  try {
    batch = await CVProcessingBatch.create({
      publicId: `batch_${crypto.randomUUID()}`,
      organization: organizationId,
      actor: req.user?.id,
      idempotencyKey: baseIdempotency,
      requestFingerprint: batchRequestFingerprint,
      intakeState: 'accepting',
      intakeLeaseId,
      intakeLeaseAt,
      jobs: [],
      rejected: [],
      totalFiles: files.length
    });
    receiptCreated = true;
  } catch (error) {
    if (error?.code !== 11000) {
      for (const file of files) {
        try { await unlinkAsync(file.path); } catch {}
      }
      throw error;
    }
    batch = await CVProcessingBatch.findOne({
      organization: organizationId,
      actor: req.user?.id,
      idempotencyKey: baseIdempotency
    }).select('+requestFingerprint +intakeLeaseId');
    if (!batch) throw error;
  }
  if (batch.requestFingerprint !== batchRequestFingerprint) {
    for (const file of files) {
      try { await unlinkAsync(file.path); } catch {}
    }
    throw idempotencyReuseError();
  }
  if (batch.intakeState === 'accepted') {
    for (const file of files) {
      try { await unlinkAsync(file.path); } catch {}
    }
    return {
      ...(await getBatchStatus(batch.publicId, organizationId)),
      duplicate: true
    };
  }
  if (!receiptCreated) {
    const claimed = await CVProcessingBatch.findOneAndUpdate(
      {
        _id: batch._id,
        intakeState: 'accepting',
        $or: [
          { intakeLeaseAt: { $exists: false } },
          { intakeLeaseAt: null },
          { intakeLeaseAt: { $lte: new Date(Date.now() - INTAKE_LEASE_MS) } }
        ]
      },
      { $set: { intakeLeaseId, intakeLeaseAt } },
      { new: true }
    ).select('+requestFingerprint +intakeLeaseId');
    if (!claimed) {
      for (const file of files) {
        try { await unlinkAsync(file.path); } catch {}
      }
      throw intakeInProgressError(
        'CV_BATCH_INTAKE_IN_PROGRESS',
        'This exact bulk intake is still being stored. Retry after the indicated delay.',
        batch.intakeLeaseAt
      );
    }
    batch = claimed;
  }

  try {
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    await Promise.all([
      removeUploadFiles(files),
      CVProcessingBatch.deleteOne({
        _id: batch._id,
        intakeState: 'accepting',
        jobs: { $size: 0 },
        intakeLeaseId
      })
    ]).catch(() => {});
    throw error;
  }

  // The fingerprint receipt is the intake commit boundary. A crash from this
  // point can be resumed only with the exact same ordered byte manifest; a
  // changed request can never claim the already-created child jobs.
  if (typeof batchLifecycleHooks.afterReceipt === 'function') {
    await batchLifecycleHooks.afterReceipt({ batch, manifest });
  }
  try {
    await requireOrganizationAcceptsCvWrites(organizationId);
    if (options.organizationWriteLease) {
      await organizationCvWriteFence.renew(options.organizationWriteLease);
    }
  } catch (error) {
    await Promise.all([
      removeUploadFiles(files),
      CVProcessingBatch.deleteOne({
        _id: batch._id,
        intakeState: 'accepting',
        jobs: { $size: 0 },
        intakeLeaseId
      })
    ]).catch(() => {});
    throw error;
  }
  const heartbeat = setInterval(() => {
    void CVProcessingBatch.updateOne(
      { _id: batch._id, intakeState: 'accepting', intakeLeaseId },
      { $set: { intakeLeaseAt: new Date() } }
    ).catch(() => {});
  }, Math.max(10_000, Math.floor(INTAKE_LEASE_MS / 3)));
  heartbeat.unref?.();
  let submittedFiles;
  try {
    submittedFiles = await mapWithConcurrency(files, ingestConcurrency, async (file, index) => {
      try {
      const childIdempotencyKey = `cv-batch-child:${crypto.createHash('sha256')
        .update(`${batch.publicId}:${index}`)
        .digest('hex')}`;
      const childRequest = {
        ...req,
        file,
        files: undefined,
        body: req.body || {},
        get: (name) => name.toLowerCase() === 'idempotency-key' ? childIdempotencyKey : req.get?.(name)
      };
      const submitted = await submitUpload(childRequest, 'bulk');
      const [receipt] = await Promise.all([
        CVProcessingBatch.updateOne(
          {
            _id: batch._id,
            requestFingerprint: batchRequestFingerprint,
            intakeState: 'accepting',
            intakeLeaseId
          },
          { $addToSet: { jobs: submitted.job._id } }
        ),
        CVProcessingJob.updateOne(
          { _id: submitted.job._id, organization: organizationId },
          { $set: { batch: batch._id, batchPublicId: batch.publicId } }
        )
      ]);
      if (!Number(receipt.matchedCount || receipt.n || 0)) {
        throw submissionError(
          'CV_BATCH_INTAKE_LEASE_LOST',
          'This batch intake is already being completed by another request.',
          409
        );
      }
      await syncHistorySafely(submitted.job._id);
      return { index, jobId: submitted.job._id };
      } catch (error) {
        try { await unlinkAsync(file.path); } catch {}
        if (['CV_IDEMPOTENCY_KEY_REUSED', 'CV_BATCH_INTAKE_LEASE_LOST'].includes(error?.code)) {
          throw error;
        }
        const rejected = { index, fileName: file.originalname, error: error.message };
        const recorded = await CVProcessingBatch.updateOne(
          {
            _id: batch._id,
            requestFingerprint: batchRequestFingerprint,
            intakeState: 'accepting',
            intakeLeaseId
          },
          { $addToSet: { rejected } }
        );
        if (!Number(recorded.matchedCount || recorded.n || 0)) {
          throw submissionError(
            'CV_BATCH_INTAKE_LEASE_LOST',
            'This batch intake is already being completed by another request.',
            409
          );
        }
        return { index, rejected };
      }
    });
  } finally {
    clearInterval(heartbeat);
  }
  const jobs = submittedFiles.flatMap((item) => item.jobId ? [item.jobId] : []);
  const rejected = submittedFiles.flatMap((item) => item.rejected ? [item.rejected] : []);
  const finalized = await CVProcessingBatch.updateOne(
    {
      _id: batch._id,
      requestFingerprint: batchRequestFingerprint,
      intakeState: 'accepting',
      intakeLeaseId
    },
    {
      $set: {
        jobs,
        rejected,
        intakeState: 'accepted',
        acceptedAt: new Date()
      },
      $unset: { intakeLeaseId: 1, intakeLeaseAt: 1 }
    }
  );
  if (!Number(finalized.matchedCount || finalized.n || 0)) {
    const current = await CVProcessingBatch.findById(batch._id).select('+requestFingerprint');
    if (!current || current.requestFingerprint !== batchRequestFingerprint) {
      throw idempotencyReuseError();
    }
  }
  return {
    ...(await getBatchStatus(batch.publicId, organizationId)),
    duplicate: !receiptCreated
  };
}

async function submitBatch(req) {
  const files = Array.isArray(req?.files) ? req.files : [];
  let context;
  try {
    context = await resolveSubmissionContext(req, 'bulk');
  } catch {
    return submitBatchUnfenced(req);
  }
  if (!context?.organizationId) return submitBatchUnfenced(req);
  let lease;
  try {
    lease = await organizationCvWriteFence.acquire(context.organizationId, 'cv-intake:bulk');
  } catch (error) {
    await removeUploadFiles(files);
    throw error;
  }
  const stopHeartbeat = organizationCvWriteFence.startHeartbeat(lease);
  try {
    return await submitBatchUnfenced(req, { organizationWriteLease: lease });
  } finally {
    stopHeartbeat();
    await organizationCvWriteFence.release(lease).catch(() => {});
  }
}

async function repairCommittedBatchJobs(jobs) {
  const repairable = jobs.filter((job) => job.state !== 'completed' && job.candidate);
  if (!repairable.length) return 0;

  const candidateIds = repairable.map((job) => job.candidate);
  const existingIds = new Set((await Candidate.find({ _id: { $in: candidateIds } })
    .select('_id')
    .lean()).map((candidate) => String(candidate._id)));
  const committed = repairable.filter((job) => existingIds.has(String(job.candidate)));
  if (!committed.length) return 0;

  const completedAt = new Date();
  for (const job of committed) {
    const event = processingStageEvent('completed', 'completed', 100, job, null, completedAt);
    await CVProcessingJob.updateOne(
      { _id: job._id, state: { $ne: 'completed' } },
      {
        $set: {
          state: 'completed',
          stage: 'completed',
          stageStartedAt: completedAt,
          progress: 100,
          completedAt,
          'artifacts.profileCommittedAt': completedAt
        },
        $unset: {
          lastError: 1,
          failedAt: 1,
          expiresAt: 1,
          'retry.pendingTrigger': 1,
          'retry.nextAttemptAt': 1
        },
        $push: {
          stageHistory: {
            $each: [event],
            $slice: -HISTORY_TRANSITION_LIMIT
          }
        }
      }
    );
    job.state = 'completed';
    job.stage = 'completed';
    job.stageStartedAt = completedAt;
    job.progress = 100;
    job.completedAt = completedAt;
    job.lastError = undefined;
    job.stageHistory = [...(job.stageHistory || []), event].slice(-HISTORY_TRANSITION_LIMIT);
    await syncLinkedCandidateProcessing(job, {
      state: 'completed',
      stage: 'completed',
      progress: 100,
      error: null,
      retryEligible: false
    });
  }
  await Promise.all(committed.map((job) => syncHistorySafely(job._id)));
  return committed.length;
}

async function getBatchStatus(publicId, organizationId) {
  const batch = await CVProcessingBatch.findOne({ publicId, organization: organizationId })
    .populate({ path: 'jobs', select: '+resumeText' });
  if (!batch) return null;
  const jobs = batch.jobs || [];
  // Status polling is also a safe reconciliation point: if a worker already
  // committed a candidate, never leave the user watching a regressed queue
  // state while a duplicate BullMQ delivery sits delayed.
  await repairCommittedBatchJobs(jobs);
  const completedJobs = jobs.filter((job) => job.state === 'completed');
  const failedJobs = jobs.filter((job) => ['failed', 'cancelled'].includes(job.state));
  const waitingJobs = jobs.filter((job) => ['queued', 'waiting_for_chatgpt'].includes(job.state));
  const activeJobs = jobs.filter((job) => job.state === 'processing');
  const completed = completedJobs.length + failedJobs.length + batch.rejected.length;
  if (batch.intakeState !== 'accepting' && completed >= batch.totalFiles) {
    if (!batch.expiresAt) {
      const expiresAt = terminalJobExpiry();
      await CVProcessingBatch.updateOne(
        { _id: batch._id, expiresAt: { $exists: false } },
        { $set: { expiresAt } }
      );
      batch.expiresAt = expiresAt;
    }
  } else if (batch.expiresAt) {
    await CVProcessingBatch.updateOne({ _id: batch._id }, { $unset: { expiresAt: 1 } });
    batch.expiresAt = undefined;
  }
  // A parked job looks identical to a slow one from the outside. Carrying the
  // reason it is waiting is the difference between "still processing" and
  // "your ChatGPT plan is out of quota until the 13th".
  // A queued job carrying an error may actually be inside BullMQ's delayed
  // retry state. Treat it as parked so the user can promote it immediately;
  // a plain, healthy queued job has no lastError and keeps the normal spinner.
  const parked = waitingJobs.find((job) => job.lastError?.message);
  const intakeLeaseActive = batch.intakeState === 'accepting'
    && batch.intakeLeaseAt
    && batch.intakeLeaseAt.getTime() > Date.now() - INTAKE_LEASE_MS;
  const intakeWaitingForReplay = batch.intakeState === 'accepting' && !intakeLeaseActive;
  const fileJobs = jobs.map((job) => ({
    ...publicState(job),
    fileName: job.originalName,
    artifacts: artifactSummary(job)
  }));
  const rejectedJobs = batch.rejected.map((item, index) => ({
    jobId: null,
    source: 'bulk',
    state: 'failed',
    stage: 'received',
    stageStartedAt: batch.createdAt,
    stageHistory: [{
      stage: 'received',
      state: 'failed',
      progress: 0,
      attempt: 0,
      at: batch.createdAt,
      errorCode: 'CV_BATCH_FILE_REJECTED',
      errorMessage: item.error
    }],
    progress: 0,
    fileName: item.fileName,
    file: { name: item.fileName, type: '', size: 0, receivedAt: batch.createdAt },
    attempts: 0,
    retry: { available: false },
    error: {
      code: 'CV_BATCH_FILE_REJECTED',
      message: item.error,
      stage: 'received',
      at: batch.createdAt
    },
    batch: { id: batch.publicId },
    rejectedIndex: index
  }));
  return {
    batchId: batch.publicId,
    intakeState: batch.intakeState || 'accepted',
    waitingReason: intakeWaitingForReplay
      ? 'The batch receipt is waiting for an exact file-set replay after an interrupted upload.'
      : (parked?.lastError?.message || null),
    waitingCode: intakeWaitingForReplay
      ? 'CV_BATCH_INTAKE_REPLAY_REQUIRED'
      : (parked?.lastError?.code || null),
    totalFiles: batch.totalFiles,
    completed,
    successful: completedJobs.length,
    failed: failedJobs.length + batch.rejected.length,
    processing: activeJobs.length,
    queued: waitingJobs.length,
    state: batch.intakeState === 'accepting'
      ? (intakeWaitingForReplay ? 'intake_waiting_for_reupload' : 'receiving')
      : completed >= batch.totalFiles
      ? 'completed'
      : waitingJobs.some((job) => job.state === 'waiting_for_chatgpt') ? 'waiting_for_chatgpt' : 'processing',
    jobs: [...fileJobs, ...rejectedJobs],
    results: completedJobs.map((job) => ({ fileName: job.originalName, candidateId: String(job.candidate), success: true })),
    errors: [
      ...batch.rejected.map((item) => ({ fileName: item.fileName, error: item.error, success: false })),
      ...failedJobs.map((job) => ({ fileName: job.originalName, error: job.lastError?.message, success: false }))
    ],
    startedAt: batch.createdAt,
    completedAt: completed >= batch.totalFiles ? new Date().toISOString() : null
  };
}

async function getRecentBatchStatus(organizationId, actorId) {
  const batch = await CVProcessingBatch.findOne({
    organization: organizationId,
    actor: actorId,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  }).sort({ createdAt: -1 }).select('publicId').lean();
  return batch ? getBatchStatus(batch.publicId, organizationId) : null;
}

async function retryBatchNow(publicId, organizationId, requestedBy) {
  const batch = await CVProcessingBatch.findOne({
    publicId: String(publicId || ''),
    organization: organizationId
  }).populate('jobs');
  if (!batch) return null;
  let promoted = 0;
  for (const job of batch.jobs || []) {
    if (job.state === 'queued') {
      const q = await getQueue();
      const queued = await q.getJob(job.publicId);
      if (!queued) {
        await addQueueJob(job);
        promoted += 1;
      } else {
        const queueState = await queued.getState();
        if (queueState === 'delayed') {
          await queued.promote();
          promoted += 1;
        } else if (['completed', 'failed'].includes(queueState)) {
          await addQueueJob(job, { replaceTerminal: true });
          promoted += 1;
        }
      }
      continue;
    }
    if (!['waiting_for_chatgpt', 'failed'].includes(job.state)) continue;
    try {
      await retryJobNow(job.publicId, { organizationId, requestedBy });
      promoted += 1;
    } catch (error) {
      if (!['CV_RETRY_NOT_WAITING', 'CV_RETRY_ALREADY_RUNNING'].includes(error?.code)) throw error;
    }
  }
  return {
    ...(await getBatchStatus(batch.publicId, organizationId)),
    promoted
  };
}

function processingStageEvent(stage, state, progress, job = {}, error = null, at = new Date()) {
  const event = {
    stage,
    state,
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    attempt: processingAttemptCount(job),
    at
  };
  if (error) {
    event.errorCode = String(error.code || 'CV_ANALYSIS_ERROR').slice(0, 120);
    event.errorMessage = String(error.message || error).slice(0, 1000);
  }
  return event;
}

function stageTrail(job = {}) {
  return (job.stageHistory || []).map((entry) => ({
    stage: entry.stage,
    state: entry.state,
    progress: Number(entry.progress || 0),
    attempt: Number(entry.attempt || 0),
    at: entry.at || null,
    errorCode: entry.errorCode || null,
    errorMessage: entry.errorMessage || null
  }));
}

function processingError(job = {}) {
  if (!job.lastError?.code && !job.lastError?.message) return null;
  return {
    code: job.lastError?.code || 'CV_PROCESSING_ERROR',
    message: job.lastError?.message || 'CV processing did not complete',
    stage: job.lastError?.stage || job.stage || null,
    at: job.lastError?.at || job.failedAt || job.updatedAt || null
  };
}

function artifactSummary(job = {}) {
  const textLength = Math.max(
    0,
    Number(job.artifacts?.extractedTextLength || job.resumeText?.length || 0)
  );
  return {
    received: { available: true, at: job.artifacts?.receivedAt || job.createdAt || null },
    durableFile: {
      available: Boolean(job.durableFile?.fileId && job.durableFile?.cleanupState !== 'deleted'),
      storedAt: job.artifacts?.durableStoredAt || job.durableFile?.persistedAt || null
    },
    cloudinaryFile: {
      available: Boolean(job.cloudinary?.publicId && job.cloudinary?.cleanupState !== 'deleted'),
      storedAt: job.artifacts?.cloudinaryStoredAt || null,
      provider: job.cloudinary?.storageProvider || job.cloudinaryUploadIntent?.storageProvider || null
    },
    managedFile: {
      available: Boolean(job.cloudinary?.publicId && job.cloudinary?.cleanupState !== 'deleted'),
      storedAt: job.artifacts?.cloudinaryStoredAt || null,
      provider: job.cloudinary?.storageProvider || job.cloudinaryUploadIntent?.storageProvider || null
    },
    extractedText: {
      available: textLength > 0,
      length: textLength,
      extractedAt: job.artifacts?.textExtractedAt || null
    },
    analysis: {
      available: Boolean(job.artifacts?.analysisCompletedAt),
      completedAt: job.artifacts?.analysisCompletedAt || null
    },
    profile: {
      available: Boolean(job.candidate || job.linkedCandidate || job.artifacts?.profileCommittedAt),
      committedAt: job.artifacts?.profileCommittedAt
        || job.linkedCandidate?.createdAt
        || (job.linkedCandidate ? job.createdAt : null)
        || job.completedAt
        || null
    }
  };
}

module.exports = {
  _backfillHistoryForTests: backfillHistory,
  _deliverCompletionEffectsForTests: deliverCompletionEffects,
  _processJobForTests: processJob,
  _recoverCompletionEffectsForTests: recoverCompletionEffects,
  _retryStorageCleanupForTests: retryStorageCleanup,
  _sweepOrphanedDurableIntakesForTests: sweepOrphanedDurableIntakes,
  _reconcileBatchRetentionForTests: reconcileBatchRetention,
  _expireInterruptedIntakeLeasesForTests: expireInterruptedIntakeLeases,
  _recoverTombstonedCandidateErasuresForTests: recoverTombstonedCandidateErasures,
  _resetDependenciesForTests: resetDependenciesForTests,
  _setDependenciesForTests: setDependenciesForTests,
  _createGlobalDispatchCoordinator: createGlobalDispatchCoordinator,
  _createGlobalDispatchInferenceRunner: createGlobalDispatchInferenceRunner,
  _globalDispatchConfig: globalDispatchConfig,
  _initializeGlobalDispatchForTests: initializeGlobalDispatchForTests,
  _loadAdminAuditsForTests: loadAdminAudits,
  _loadRecentExternalAuditsForTests: loadRecentExternalAudits,
  _activateReplacementRevisionForTests: activateReplacementRevision,
  _repairReplacementActivationsForTests: repairReplacementActivations,
  _mergeAnalysisOntoCandidateForTests: mergeAnalysisOntoCandidate,
  _projectStoredCvOntoLinkedCandidateForTests: projectStoredCvOntoLinkedCandidate,
  _sharedDispatchWorkerState: sharedDispatchWorkerState,
  _cvUsageExecutionIdForTests: cvUsageExecutionId,
  _evaluateWorkerReadinessForTests: evaluateWorkerReadiness,
  adminTelemetry,
  closeForTests,
  enqueueExistingJob,
  getBatchStatus,
  getRecentBatchStatus,
  retryBatchNow,
  getAdminJobDetail,
  getAdminJobSummaries,
  getStatus,
  finalizePrivateUploadSubmission,
  ingestExternalQueueEvent,
  initWorker,
  listAdminHistory,
  listAdminOrganizations,
  listOrganizationHistory,
  listHistory,
  getOrganizationJobDetail,
  publishTelemetry,
  readiness,
  retryFailedJob,
  replaceFailedJob,
  retryJobNow,
  promoteWaitingJobsForOrganization,
  resolveOrganizationRuntimeActor,
  cvBackoffDelay,
  isBusyError,
  isOfflineError,
  isRuntimeGateError,
  isUnboundedRuntimeDeferral,
  isRetryableProcessingError,
  deferredRetryDelay,
  publicState,
  recoverPendingPrivateBilling,
  recoverStaleJobs,
  runWithGlobalInferencePermit,
  setPaused,
  submitBatch,
  submitUpload,
  eraseCandidateProcessingData,
  redactCandidateProcessingData,
  redactOrganizationProcessingData,
  telemetry,
  tokenHash
};
