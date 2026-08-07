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
const durableCvFileStore = require('./durableCvFileStore');
const embeddingService = require('./embeddingService');
const websocketService = require('./websocketService');
const creditsService = require('./creditsService');
const publicApplicationCapacityService = require('./publicApplicationCapacityService');
const { runWithAIRequestContext } = require('./aiRuntime/requestContext');
const { signLocalRequest } = require('./aiRuntime/aiRuntimeService');
const {
  createGlobalDispatchConnection,
  createGlobalDispatchCoordinator,
  createGlobalDispatchInferenceRunner,
  resolveGlobalDispatchConfig
} = require('./cvGlobalDispatch');

const unlinkAsync = promisify(fs.unlink);
const queueName = 'cv-analysis-local';
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
const GLOBAL_DISPATCH_POLL_MS = globalDispatchConfig.pollMs;
const defaultCvParser = new CVParsingService();
const defaultCloudinary = new CloudinaryUploadService();
let cvParser = defaultCvParser;
let cloudinary = defaultCloudinary;
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
let queue;
let worker;
let maintenanceTimer;
let cleanupTimer;
let telemetryTimer;
let dispatchControlTimer;
let telemetryDebounceTimer;
let telemetryPublishPromise;
let initRetryTimer;
let historyBackfillPromise;
let lastHistoryBackfillAt = 0;
let historyBackfillCursor = null;

async function defaultTelemetryTransport({ url, headers, body, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => ({}))
  };
}

let telemetryTransport = defaultTelemetryTransport;

function normalizedDispatchLimit(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

const HISTORY_REPAIR_INTERVAL_MS = 60_000;
const HISTORY_TRANSITION_LIMIT = 100;
const HISTORY_REPAIR_BATCH_SIZE = 500;
const TELEMETRY_ACTIVE_STATES = Object.freeze([
  'queued',
  'waiting_for_local_runtime',
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
    retryDelayMs: GLOBAL_DISPATCH_POLL_MS,
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
    availableUntil,
    nextAttemptAt: job.retry?.nextAttemptAt || null,
    deferredCycles: Number(job.retry?.deferredCycles || 0),
    lastDeferredAt: job.retry?.lastDeferredAt || null,
    requestedStage: job.retry?.requestedStage || 'failed',
    manualRequests: Number(job.retry?.manualRequests || 0),
    automaticRetries: trail.filter((attempt) => attempt.trigger === 'automatic').length,
    manualRetries: trail.filter((attempt) => attempt.trigger === 'manual').length,
    lastRequestedAt: job.retry?.lastRequestedAt || null,
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

function lifecyclePhase(job) {
  if (['completed', 'failed'].includes(job.state)) return job.state;
  if (processingAttemptCount(job) > 1) return 'retrying';
  return job.state;
}

function operationalJob(job, sampledAt) {
  const terminalAt = job.completedAt || job.failedAt || sampledAt;
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
    updatedAt: job.updatedAt,
    waitMs: elapsedMs(job.createdAt, job.startedAt || terminalAt),
    processingMs: job.startedAt ? elapsedMs(job.startedAt, terminalAt) : null,
    errorCode: job.lastError?.code || null
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
    originalName: job.originalName || '',
    fileType: job.fileType || '',
    fileSize: Number(job.fileSize || 0),
    jobCreatedAt: job.createdAt,
    startedAt: job.startedAt || undefined,
    completedAt: job.completedAt || undefined,
    failedAt: job.failedAt || undefined,
    lastUpdatedAt: job.updatedAt || sampledAt,
    waitMs: operational.waitMs,
    processingMs: operational.processingMs,
    errorCode: operational.errorCode || undefined
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
    progress: job.progress,
    attempts: job.attempts,
    processingAttempts: job.processingAttempts,
    createdAt: job.jobCreatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    updatedAt: job.lastUpdatedAt,
    lastError: job.errorCode ? { code: job.errorCode } : null
  }, new Date(job.lastUpdatedAt || Date.now()));
  return {
    ...operational,
    producer: job.producer || 'recruiter',
    queue: job.producer === 'ai-interview' ? 'ai-interview-cv-analysis-local' : queueName,
    transitions: operationalTransitions(job.transitions),
    retry: {
      available: false,
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
    attemptHistory: attemptTrail(job, { includeActor: true })
  };
}

function externalQueueText(value, maximumLength = 200) {
  return String(value || '').trim().slice(0, maximumLength);
}

function externalQueueDate(value, fallback = null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
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
  if (!['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'].includes(state)) {
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
  const allowedStages = new Set(['ingesting', 'uploading', 'extracting', 'analyzing', 'finalizing', 'completed', 'failed']);
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
    lastUpdatedAt: updatedAt,
    ...(producerSequence == null ? {} : { producerSequence }),
    waitMs: elapsedMs(createdAt, startedAt || completedAt || failedAt || updatedAt),
    processingMs: startedAt ? elapsedMs(startedAt, completedAt || failedAt || updatedAt) : null,
    errorCode: externalQueueText(job.lastError?.code || job.errorCode, 100) || undefined
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
  publishTelemetrySoon(0);
  return { accepted: true, jobId: publicId };
}

async function syncHistory(processingJobId) {
  const job = processingJobId && typeof processingJobId === 'object' && processingJobId.publicId
    ? processingJobId
    : await CVProcessingJob.findById(processingJobId)
      .select('publicId source state stage progress attempts processingAttempts retry attemptHistory organization actor jobAppliedFor candidate originalName fileType fileSize durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .lean();
  if (!job) return false;
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
}

async function syncHistorySafely(processingJobId) {
  try {
    return await syncHistory(processingJobId);
  } catch (error) {
    console.error('CV processing history sync failed:', error.message);
    return false;
  }
}

async function backfillHistory({ force = false } = {}) {
  if (historyBackfillPromise) return historyBackfillPromise;
  if (!force && Date.now() - lastHistoryBackfillAt < HISTORY_REPAIR_INTERVAL_MS) return 0;
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
      .select('publicId source state stage progress attempts processingAttempts retry attemptHistory organization actor jobAppliedFor candidate originalName fileType fileSize durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .sort({ updatedAt: 1, _id: 1 })
      .limit(HISTORY_REPAIR_BATCH_SIZE)
      .lean();
    if (rows.length) {
      await CVProcessingAudit.bulkWrite(rows.flatMap((job) => {
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
      await CVProcessingAudit.bulkWrite(rows.map((job) => {
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

function historyQuery(input = {}) {
  const page = Math.max(1, Math.min(100_000, Number(input.page) || 1));
  const limit = Math.max(10, Math.min(100, Number(input.limit) || 25));
  const filter = {};
  const allowedStates = new Set(['queued', 'waiting_for_local_runtime', 'processing', 'retrying', 'completed', 'failed']);
  const allowedSources = new Set(['private', 'public', 'bulk', 'ai-interview']);
  const requestedState = String(input.state || '');
  if (requestedState === 'retrying') {
    filter.state = { $in: ['queued', 'waiting_for_local_runtime', 'processing'] };
    filter.attempts = { $gt: 1 };
  } else if (allowedStates.has(requestedState)) {
    filter.state = requestedState;
  }
  if (allowedSources.has(String(input.source || ''))) filter.source = String(input.source);
  const search = String(input.search || '').trim().slice(0, 100);
  if (search) filter.publicId = { $regex: escapeRegex(search), $options: 'i' };
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  if ((from && Number.isFinite(from.getTime())) || (to && Number.isFinite(to.getTime()))) {
    filter.jobCreatedAt = {};
    if (from && Number.isFinite(from.getTime())) filter.jobCreatedAt.$gte = from;
    if (to && Number.isFinite(to.getTime())) filter.jobCreatedAt.$lte = to;
  }
  return { page, limit, filter };
}

async function listHistory(input = {}) {
  await backfillHistory();
  const { page, limit, filter } = historyQuery(input);
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
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    jobs: rows.map(auditOperationalJob),
    retainedIndefinitely: true,
    coverageStartedAt: earliest?.jobCreatedAt || null,
    measuredAt: new Date().toISOString()
  };
}

async function listAdminHistory(input = {}) {
  await backfillHistory();
  const { page, limit, filter } = historyQuery(input);
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
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    jobs: await adminJobsFromAudits(rows),
    retainedIndefinitely: true,
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
  const candidate = job.candidate && typeof job.candidate === 'object' ? job.candidate : null;
  const applicantName = [job.formData?.firstName, job.formData?.lastName].filter(Boolean).join(' ');
  return {
    ...operational,
    producer: 'recruiter',
    queue: queueName,
    retry: retrySummary(job, { includeActor: true, includeCapabilities: true }),
    attemptHistory: attemptTrail(job, { includeActor: true }),
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
    application: appliedJob ? { id: String(appliedJob._id), title: appliedJob.title || 'Untitled job' } : null,
    candidate: candidate ? {
      id: String(candidate._id),
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Candidate',
      email: candidate.email || ''
    } : null,
    file: {
      name: job.originalName || '',
      type: job.fileType || '',
      size: Number(job.fileSize || 0)
    }
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
  const candidateIds = [...new Set(audits.map((audit) => audit.candidate).filter(objectIdLike))];
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
    const candidate = candidateById.get(String(audit.candidate || ''));
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
        title: appliedJob?.title || (isExternal ? 'AI Interview role' : 'Untitled job')
      } : null,
      candidate: candidate ? {
        id: String(candidate._id),
        name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Candidate',
        email: candidate.email || ''
      } : null,
      file: {
        name: audit.originalName || '',
        type: audit.fileType || '',
        size: Number(audit.fileSize || 0)
      }
    };
  });
}

function isBusyError(error) {
  return ['LOCAL_LLM_BUSY', 'AI_LOCAL_BUSY', 'GATEWAY_QUEUE_FULL'].includes(String(error?.code || ''))
    || /\b(?:runtime|inference|gateway|queue)?\s*(?:is\s+)?busy\b|capacity (?:is )?occupied|queue (?:is )?full/i
      .test(String(error?.message || ''));
}

function isOfflineError(error) {
  return [
    'AI_LOCAL_UNAVAILABLE',
    'AI_LOCAL_NOT_CONFIGURED',
    'LOCAL_LLM_DISABLED',
    'LOCAL_LLM_PAUSED',
    'LOCAL_LLM_UNAVAILABLE',
    'LOCAL_ENGINE_REQUIRED',
    'CODEX_NOT_INSTALLED'
  ].includes(String(error?.code || ''))
    || /local cv runtime|local[- ]llm|ollama|vllm|fetch failed|could not be reached/i
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
    'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED',
    'AI_RUNTIME_LOCAL_DISABLED',
    'AI_RUNTIME_CHATGPT_DISABLED',
    'AI_RUNTIMES_DISABLED',
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
 * uploaded the CV themselves — instead of failing when the local model is off.
 */
const organizationRuntimeActorCache = new Map();
const ORGANIZATION_RUNTIME_ACTOR_TTL_MS = 60_000;

async function resolveOrganizationRuntimeActor(organizationId) {
  const key = String(organizationId || '');
  if (!key) return null;
  const cached = organizationRuntimeActorCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = null;
  try {
    const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
    let account = await AIUserRuntimeAccount.findOne({
      organization: organizationId,
      status: 'connected',
      dataSharingAcknowledgedAt: { $ne: null }
    }).sort({ connectedAt: -1 }).select('user').lean();
    if (!account) {
      // Accounts connected before their organization was recorded heal
      // lazily elsewhere; here they are matched through their user so parked
      // public work does not have to wait for that.
      const orphans = await AIUserRuntimeAccount.find({
        organization: null,
        status: 'connected',
        dataSharingAcknowledgedAt: { $ne: null }
      }).sort({ connectedAt: -1 }).limit(20).select('user').lean();
      for (const candidate of orphans) {
        const member = await User.findById(candidate.user).select('currentOrganization').lean();
        if (member && String(member.currentOrganization || '') === key) {
          account = candidate;
          await AIUserRuntimeAccount.updateOne(
            { user: candidate.user, organization: null },
            { $set: { organization: organizationId } }
          );
          break;
        }
      }
    }
    if (account?.user) {
      const owner = await User.findById(account.user)
        .select('email profile.firstName profile.lastName profile.displayName').lean();
      if (owner) value = { id: String(account.user), user: owner };
    }
  } catch (error) {
    console.warn('Organization runtime actor lookup failed:', error.message);
  }
  organizationRuntimeActorCache.set(key, { value, expiresAt: Date.now() + ORGANIZATION_RUNTIME_ACTOR_TTL_MS });
  return value;
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
  return {
    jobId: job.publicId,
    state: billingFailure ? 'failed' : job.state,
    stage: billingFailure ? 'failed' : (job.stage || null),
    progress: job.progress,
    position: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: billingFailure ? job.billing.lastAttemptAt : job.failedAt,
    candidateId: job.candidate ? String(job.candidate) : null,
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
      errorCode: attempt.errorCode
    })),
    error: billingFailure
      ? job.billing.lastError
      : job.state === 'failed' ? job.lastError : undefined
  };
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
    const reconciliation = await publicApplicationCapacityService.reconcileInflatedCount({
      jobId: job._id,
      organizationId: job.organization
    });
    if (reconciliation?.repaired) {
      job.publicApplicationCount = reconciliation.applicationCount;
    }
    if (job.status !== 'active') {
      throw submissionError(
        'PUBLIC_JOB_NOT_ACTIVE',
        'This job is not accepting public applications',
        403
      );
    }
    if (
      Number(job.candidateApplyLimit || 0) > 0
      && Number(job.publicApplicationCount || 0) >= Number(job.candidateApplyLimit)
    ) {
      throw submissionError(
        'PUBLIC_APPLICATION_LIMIT_REACHED',
        'This job has reached its maximum number of public applications',
        409
      );
    }
    return {
      organizationId: String(job.organization),
      job
    };
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

async function submitUpload(req, source = 'private', options = {}) {
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

  const idempotencyKey = String(req.get?.('Idempotency-Key') || '').trim() || undefined;
  if (idempotencyKey) {
    const existing = await CVProcessingJob.findOne({ organization: organizationId, idempotencyKey });
    if (existing) {
      try { await unlinkAsync(req.file.path); } catch {}
      if (
        existing.source !== source
        || (
          source === 'public'
          && String(existing.jobAppliedFor || '') !== String(context.job?._id || '')
        )
      ) {
        throw submissionError(
          'CV_IDEMPOTENCY_CONTEXT_MISMATCH',
          'This idempotency key was already used for a different CV upload context',
          409
        );
      }
      return { job: existing, statusToken: idempotentStatusToken(organizationId, idempotencyKey), duplicate: true };
    }
  }

  const statusToken = idempotencyKey
    ? idempotentStatusToken(organizationId, idempotencyKey)
    : crypto.randomBytes(32).toString('base64url');
  const publicId = `cv_${crypto.randomUUID()}`;

  let linkedCandidate;
  if (options.linkedCandidateId && mongoose.isValidObjectId(options.linkedCandidateId)) {
    const candidateDoc = await Candidate.findOne({
      _id: options.linkedCandidateId,
      organization: organizationId
    }).select('_id').lean();
    if (candidateDoc) linkedCandidate = candidateDoc._id;
  }

  let durableFile;
  let job;
  try {
    durableFile = await durableFileStore.persistPath(req.file.path, {
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      organizationId,
      source
    });
    job = await CVProcessingJob.create({
      publicId,
      statusTokenHash: tokenHash(statusToken),
      idempotencyKey,
      state: 'queued',
      stage: 'ingesting',
      progress: 5,
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
        : {
          required: false,
          state: 'not_required'
        },
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      durableFile,
      linkedCandidate,
      formData: safeFormData(req.body)
    });
    await syncHistorySafely(job);
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const cleanupReference = durableFile || error.cleanupReference;
      if (cleanupReference) {
        await cleanupWithOutbox('gridfs', cleanupReference, {
          reason: 'idempotency-race-loser'
        }).catch((cleanupError) => {
          error.cleanupError = error.cleanupError || cleanupError;
        });
      }
      const existing = await CVProcessingJob.findOne({ organization: organizationId, idempotencyKey });
      if (existing) {
        return {
          job: existing,
          statusToken: idempotentStatusToken(organizationId, idempotencyKey),
          duplicate: true
        };
      }
    }
    const cleanupReference = durableFile || error.cleanupReference;
    if (cleanupReference) {
      await cleanupWithOutbox('gridfs', cleanupReference, {
        reason: 'job-persistence-failed'
      }).catch((cleanupError) => {
        error.cleanupError = error.cleanupError || cleanupError;
      });
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
      await CVProcessingJob.updateOne({ _id: job._id }, {
        $set: {
          lastError: {
            code: error.code || 'CV_QUEUE_UNAVAILABLE',
            message: String(error.message).slice(0, 1000),
            at: new Date()
          }
        }
      });
      await syncHistorySafely(job._id);
    }
  }
  publishTelemetrySoon();
  return { job, statusToken, duplicate: false, enqueueDeferred };
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
      cvProcessingJobId: job.publicId
    }
  };
}

async function updateProcessingStage(processingJob, bullJob, stage, progress, extra = {}) {
  await CVProcessingJob.updateOne(
    { _id: processingJob._id, state: { $ne: 'completed' } },
    { $set: { state: 'processing', stage, progress, ...extra } }
  );
  processingJob.state = 'processing';
  processingJob.stage = stage;
  processingJob.progress = progress;
  Object.assign(processingJob, extra);
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
    if (!input.publicId) throw new Error('Cloudinary cleanup requires a public ID');
    return {
      publicId: String(input.publicId).slice(0, 500),
      assetId: String(input.assetId || '').slice(0, 200),
      resourceType: String(input.resourceType || 'raw').slice(0, 40),
      deliveryType: String(input.deliveryType || 'authenticated').slice(0, 40)
    };
  }
  throw new Error(`Unsupported CV cleanup provider: ${provider}`);
}

function cleanupTaskKey(provider, resource) {
  const identity = provider === 'gridfs'
    ? `${resource.bucket}:${resource.fileId}`
    : `${resource.assetId || resource.publicId}:${resource.resourceType}:${resource.deliveryType}`;
  return crypto.createHash('sha256').update(`recruiter:${provider}:${identity}`).digest('hex');
}

async function registerCleanupTask(provider, input, {
  reason,
  jobPublicId
} = {}) {
  const resource = cleanupTaskResource(provider, input);
  const key = cleanupTaskKey(provider, resource);
  return CVStorageCleanupTask.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        provider,
        state: 'pending',
        resource,
        reason: String(reason || 'cv-storage-release').slice(0, 120),
        jobPublicId: jobPublicId ? String(jobPublicId).slice(0, 100) : undefined,
        attempts: 0,
        nextAttemptAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function executeCleanupTask(task) {
  if (!task || task.state === 'completed') return true;
  const attemptedAt = new Date();
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
        task.resource?.deliveryType || 'authenticated'
      );
      if (!result?.success) {
        const error = new Error(result?.error || 'Cloudinary cleanup failed');
        error.code = 'CV_CLOUD_CLEANUP_FAILED';
        throw error;
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
  if (!current || !['completed', 'failed'].includes(current.state)) return false;
  if (hasOutstandingTerminalCleanup(current)) {
    if (current.expiresAt) {
      await CVProcessingJob.updateOne({ _id: current._id }, { $unset: { expiresAt: 1 } });
    }
    return false;
  }
  if (!current.expiresAt) {
    await CVProcessingJob.updateOne(
      { _id: current._id, state: { $in: ['completed', 'failed'] }, expiresAt: { $exists: false } },
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

async function createCandidateOnce(processingJob, analysis) {
  if (processingJob.linkedCandidate) {
    return mergeAnalysisOntoCandidate(processingJob, analysis);
  }

  const filter = { 'processingMetadata.cvProcessingJobId': processingJob.publicId };
  const existing = await Candidate.findOne(filter);
  if (existing) return existing;
  const deterministicId = new mongoose.Types.ObjectId(
    crypto.createHash('sha256').update(`cv-candidate:${processingJob.publicId}`).digest('hex').slice(0, 24)
  );
  try {
    return await Candidate.findOneAndUpdate(
      { _id: deterministicId },
      { $setOnInsert: candidatePayload(processingJob, analysis) },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const duplicate = await Candidate.findOne(filter);
    if (duplicate) return duplicate;
    throw error;
  }
}

// Attaches CV-extracted fields to a candidate that was already created (e.g.
// from a public application form) rather than creating a fresh one. The
// applicant's own submitted identity fields are left untouched — only the
// CV-derived enrichment fields are merged in.
async function mergeAnalysisOntoCandidate(processingJob, analysis) {
  const existing = await Candidate.findById(processingJob.linkedCandidate);
  if (!existing) {
    // Linked candidate is gone (deleted) - fall back to normal creation so
    // the extracted data isn't lost.
    processingJob.linkedCandidate = undefined;
    return createCandidateOnce(processingJob, analysis);
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

  return Candidate.findByIdAndUpdate(
    existing._id,
    { $set: enrichmentFields },
    { new: true, runValidators: true }
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

async function runCompletionEffect(processingJobId, effectName, handler) {
  const prefix = `completionEffects.${effectName}`;
  const statusPath = `${prefix}.status`;
  const claimToken = crypto.randomUUID();
  const staleClaim = new Date(Date.now() - 5 * 60_000);
  const claimed = await CVProcessingJob.findOneAndUpdate(
    {
      _id: processingJobId,
      $or: [
        { [statusPath]: { $exists: false } },
        { [statusPath]: 'pending' },
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
    await CVProcessingJob.updateOne(
      {
        _id: processingJobId,
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
    return { effectName, claimed: true, completed: true };
  } catch (error) {
    await CVProcessingJob.updateOne(
      {
        _id: processingJobId,
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

async function deliverCompletionEffects(processingJobId) {
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
      (claimedJob) => completionEffectHandlers[effectName](claimedJob, candidate)
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
      state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] }
    },
    {
      $inc: { processingAttempts: 1 },
      $set: { 'retry.requestedStage': requestedStage },
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

async function processJob(bullJob, workerToken) {
  const processingJob = await CVProcessingJob.findById(bullJob.data.processingJobId).select('+resumeText +statusTokenHash');
  if (!processingJob) return { skipped: true };
  if (processingJob.state === 'completed' && processingJob.candidate) {
    await deliverCompletionEffects(processingJob._id).catch((error) => {
      console.error('CV completion effect recovery failed:', error.message);
    });
    return { candidateId: String(processingJob.candidate), duplicate: true };
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
  await CVProcessingJob.updateOne({ _id: processingJob._id }, {
    $set: {
      state: 'processing',
      stage: initialStage,
      progress: 15,
      startedAt: processingJob.startedAt || new Date()
    }
  });
  processingJob.state = 'processing';
  processingJob.stage = initialStage;
  processingJob.progress = 15;
  processingJob.startedAt = processingJob.startedAt || new Date();
  await syncHistorySafely(processingJob._id);
  await bullJob.updateProgress(15);
  publishTelemetrySoon();
  try {
    if (!processingJob.resumeText || !processingJob.cloudinary?.publicId) {
      const materialized = await durableFileStore.materialize(processingJob.durableFile, {
        originalName: processingJob.originalName,
        fileType: processingJob.fileType
      });
      try {
        if (!processingJob.cloudinary?.publicId) {
          await updateProcessingStage(processingJob, bullJob, 'uploading', 20);
          const upload = await cloudinary.uploadFile(materialized.filePath, processingJob.fileType, {
            privateAsset: true,
            publicId: processingJob.publicId
          });
          if (!upload?.success) {
            const error = new Error(upload?.error || 'CV document upload failed');
            error.code = 'CV_CLOUD_UPLOAD_FAILED';
            throw error;
          }
          const cloudinaryMetadata = {
            resumeUrl: upload.resumeUrl,
            publicId: upload.publicId,
            assetId: upload.uploadResult?.asset_id,
            resourceType: upload.resourceType,
            deliveryType: upload.deliveryType || 'authenticated',
            cleanupState: 'retained'
          };
          await CVProcessingJob.updateOne(
            { _id: processingJob._id },
            { $set: { cloudinary: cloudinaryMetadata } }
          );
          processingJob.cloudinary = cloudinaryMetadata;
        }

        if (!processingJob.resumeText) {
          await updateProcessingStage(processingJob, bullJob, 'extracting', 35);
          const resumeText = await cvParser.parseCV(materialized.filePath, processingJob.fileType);
          if (!resumeText || resumeText.trim().length < 50) {
            const error = new Error('Could not extract readable text from this CV. Use a text-based PDF or DOCX.');
            error.code = 'CV_TEXT_EXTRACTION_FAILED';
            throw error;
          }
          await CVProcessingJob.updateOne(
            { _id: processingJob._id },
            { $set: { resumeText } }
          );
          processingJob.resumeText = resumeText;
        }
      } finally {
        await materialized.cleanup().catch(() => {});
      }
    }

    await updateProcessingStage(processingJob, bullJob, 'analyzing', 50);
    const [organization, actor] = await Promise.all([
      Organization.findById(processingJob.organization).select('name').lean(),
      processingJob.actor
        ? User.findById(processingJob.actor).select('email profile.firstName profile.lastName profile.displayName').lean()
        : Promise.resolve(null)
    ]);
    const runtimeActor = processingJob.actor
      ? null
      : await resolveOrganizationRuntimeActor(processingJob.organization);
    const effectiveActorId = processingJob.actor ? String(processingJob.actor) : runtimeActor?.id;
    const effectiveActor = actor || runtimeActor?.user || null;
    const analysis = await runInferenceWithGlobalPermit(
      bullJob,
      workerToken,
      async ({ signal }) => {
        await CVProcessingJob.updateOne(
          { _id: processingJob._id },
          { $inc: { attempts: 1 } }
        );
        processingJob.attempts = Number(processingJob.attempts || 0) + 1;
        return runWithAIRequestContext({
          sourceApp: 'recruiter-cv-worker',
          organizationId: String(processingJob.organization),
          organizationName: organization?.name,
          actorId: effectiveActorId || undefined,
          actorName: personName(effectiveActor)
            || [processingJob.formData?.firstName, processingJob.formData?.lastName].filter(Boolean).join(' ')
            || (processingJob.source === 'public' ? 'Public applicant' : undefined),
          actorEmail: effectiveActor?.email || processingJob.formData?.email,
          jobId: processingJob.publicId,
          requestId: `cv-queue:${processingJob.publicId}`,
          usageExecutionId: `cv-queue:${processingJob.publicId}`,
          promptVersion: 'candidate-cv-local-v1'
        }, () => cvParser.analyzeText(
          processingJob.resumeText,
          processingJob.source === 'ai-interview' ? 'ai_interview.cv_parse' : 'candidate.cv_parse',
          { signal }
        ));
      },
      async ({ reason, error }) => {
        const waitError = {
          code: error?.code || `CV_GLOBAL_DISPATCH_${String(reason || 'WAITING').toUpperCase().replace(/-/g, '_')}`,
          message: error?.message || `CV inference is waiting for shared dispatch capacity (${reason || 'waiting'})`,
          at: new Date()
        };
        await CVProcessingJob.updateOne({ _id: processingJob._id }, {
          $set: {
            state: 'waiting_for_local_runtime',
            stage: 'analyzing',
            progress: Math.max(50, Number(processingJob.progress || 50)),
            lastError: waitError
          },
          $unset: { expiresAt: 1 }
        });
        processingJob.state = 'waiting_for_local_runtime';
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
          ? 'LOCAL_LLM_BUSY'
          : isOfflineError(error) ? 'AI_LOCAL_UNAVAILABLE' : 'CV_ANALYSIS_FAILED');
      error.retryable = analysis.retryable === true;
      throw error;
    }
    await updateProcessingStage(processingJob, bullJob, 'finalizing', 80);
    const candidate = await createCandidateOnce(processingJob, analysis);
    await CVProcessingJob.updateOne({ _id: processingJob._id }, {
      $set: {
        state: 'completed',
        stage: 'completed',
        progress: 100,
        candidate: candidate._id,
        completedAt: new Date()
      },
      $unset: { lastError: 1, expiresAt: 1 }
    });
    processingJob.state = 'completed';
    processingJob.stage = 'completed';
    processingJob.progress = 100;
    processingJob.candidate = candidate._id;
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
    if (error instanceof DelayedError || String(error?.code || '').startsWith('CV_GLOBAL_DISPATCH_')) {
      const nextAttemptAt = new Date(Date.now() + cvBackoffDelay(Number(bullJob.attemptsMade || 0) + 1, error));
      await CVProcessingJob.updateOne(
        { _id: processingJob._id },
        {
          $set: {
            'retry.pendingTrigger': 'automatic',
            'retry.requestedStage': 'failed',
            'retry.nextAttemptAt': nextAttemptAt
          }
        }
      );
      processingJob.retry = {
        ...(processingJob.retry?.toObject?.() || processingJob.retry || {}),
        pendingTrigger: 'automatic',
        requestedStage: 'failed',
        nextAttemptAt
      };
      await finishProcessingAttempt(processingJob, processingAttempt, {
        status: 'waiting_for_runtime',
        stage: processingJob.stage,
        error
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
    const failureUpdate = {
      $set: {
        state: terminal ? 'failed' : (unboundedDeferral || deferred) ? 'waiting_for_local_runtime' : 'queued',
        stage: terminal ? 'failed' : (processingJob.stage || 'ingesting'),
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
          at: new Date()
        }
      }
    };
    failureUpdate.$unset = { expiresAt: 1 };
    if (!unboundedDeferral && !deferred) failureUpdate.$inc = { boundedFailureAttempts: 1 };
    await CVProcessingJob.updateOne({ _id: processingJob._id }, failureUpdate);
    processingJob.boundedFailureAttempts = deferred ? 0 : boundedFailureAttempts;
    processingJob.state = terminal ? 'failed' : (unboundedDeferral || deferred) ? 'waiting_for_local_runtime' : 'queued';
    processingJob.stage = terminal ? 'failed' : failedStage;
    processingJob.failedAt = failedAt || processingJob.failedAt;
    processingJob.lastError = {
      code: error.code || 'CV_ANALYSIS_ERROR',
      message: String(error.message).slice(0, 1000),
      stage: failedStage,
      at: new Date()
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
    state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
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
  if (job.state !== 'failed') {
    throw manualRetryError(
      'CV_RETRY_NOT_FAILED',
      ['queued', 'waiting_for_local_runtime', 'processing'].includes(job.state)
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
  const set = {
    state: 'queued',
    stage: queueStage,
    progress,
    boundedFailureAttempts: 0,
    'retry.pendingTrigger': 'manual',
    'retry.requestedStage': requestedStage,
    'retry.lastRequestedAt': requestedAt,
    'retry.lastRequestedBy': actor,
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
      $max: { processingAttempts: Number(job.attempts || 0) }
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
  await syncHistorySafely(claimed._id);
  publishTelemetrySoon(0);
  const refreshed = await CVProcessingJob.findById(claimed._id).select('+resumeText');
  return {
    job: refreshed || claimed,
    queueAvailable,
    requestedStage,
    effectiveStage,
    requestedAt
  };
}

async function retryJobNow(publicId, { requestedBy, stage = 'failed' } = {}) {
  const job = await CVProcessingJob.findOne({ publicId: String(publicId || '') }).select('+resumeText');
  if (!job) throw manualRetryError('CV_JOB_NOT_FOUND', 'CV processing job was not found', 404);
  if (job.source === 'ai-interview') {
    throw manualRetryError('CV_RETRY_EXTERNAL_JOB', 'AI Interview CV jobs retry automatically in the AI Interview service');
  }
  if (job.state === 'failed') {
    return retryFailedJob(job.publicId, {
      administrator: true,
      requestedBy: requestedBy || { type: 'system', name: 'Local Control Center' },
      stage
    });
  }
  if (job.state !== 'waiting_for_local_runtime') {
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
  await CVProcessingJob.updateOne(
    { _id: job._id, state: 'waiting_for_local_runtime' },
    {
      $set: {
        state: 'queued',
        'retry.pendingTrigger': 'manual',
        'retry.lastRequestedAt': new Date(),
        'retry.lastRequestedBy': retryActor(requestedBy || { type: 'system', name: 'Local Control Center' })
      },
      $unset: { 'retry.nextAttemptAt': 1 },
      $inc: { 'retry.manualRequests': 1 }
    }
  );
  await syncHistorySafely(job._id);
  publishTelemetrySoon(0);
  return { job: await CVProcessingJob.findById(job._id), queueAvailable: true, requestedAt: new Date() };
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
    state: 'waiting_for_local_runtime',
    source: { $ne: 'ai-interview' }
  }).sort({ createdAt: 1 }).limit(Math.max(1, limit)).select('publicId').lean();
  let promoted = 0;
  for (const job of waiting) {
    try {
      await retryJobNow(job.publicId, {
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

async function retryStorageCleanup({
  now = new Date(),
  limit = 100
} = {}) {
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
      await executeCleanupTask(task);
      tasksCompleted += 1;
    } catch {}
  }

  const terminalJobs = await CVProcessingJob.find({
    state: { $in: ['completed', 'failed'] },
    $or: [
      {
        'durableFile.fileId': { $exists: true },
        'durableFile.releasedAt': null,
        'durableFile.cleanupState': { $ne: 'deleted' }
      },
      {
        state: 'failed',
        'cloudinary.publicId': { $exists: true },
        'cloudinary.releasedAt': null,
        'cloudinary.cleanupState': { $ne: 'deleted' }
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
    if (await finalizeTerminalExpiry(job)) jobsFinalized += 1;
  }
  return { tasksCompleted, jobsFinalized };
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
  const stale = await CVProcessingJob.find({
    state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
    updatedAt: { $lt: new Date(Date.now() - 60_000) },
    $or: [
      { 'billing.required': { $ne: true } },
      { 'billing.state': 'charged' }
    ]
  }).sort({ createdAt: 1 }).limit(500);
  let recovered = 0;
  for (const job of stale) {
    const existing = await q.getJob(job.publicId);
    if (!existing) {
      await addQueueJob(job);
      recovered += 1;
    }
  }
  if (recovered) publishTelemetrySoon();
  return recovered;
}

async function publishTelemetry() {
  if (telemetryPublishPromise) {
    await telemetryPublishPromise;
    return publishTelemetry();
  }
  telemetryPublishPromise = (async () => {
  const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  const baseUrl = String(process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, '');
  if (!secret || !baseUrl) return false;
  const snapshot = await telemetry();
  const body = JSON.stringify({
    schemaVersion: 2,
    waiting: Number(snapshot.counts.waiting || 0) + Number(snapshot.counts.prioritized || 0),
    active: snapshot.counts.active,
    delayed: snapshot.counts.delayed,
    completed: snapshot.counts.completed,
    failed: snapshot.counts.failed,
    oldestWaitMs: snapshot.oldestQueuedAt ? Date.now() - new Date(snapshot.oldestQueuedAt).getTime() : 0,
    paused: snapshot.paused,
    workerConcurrency: workerConcurrency(),
    available: snapshot.available,
    queue: snapshot.queue,
    sampledAt: snapshot.sampledAt,
    counts: snapshot.counts,
    durable: snapshot.durable,
    rates: snapshot.rates,
    history: snapshot.history,
    retention: snapshot.retention,
    worker: snapshot.worker,
    queues: snapshot.queues,
    oldestQueuedAt: snapshot.oldestQueuedAt,
    recentJobs: snapshot.recentJobs
  });
  const signed = signLocalRequest(secret, body, {
    method: 'POST',
    path: '/v1/queue-telemetry'
  });
  const response = await telemetryTransport({
    url: `${baseUrl}/v1/queue-telemetry`,
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined
  });
  if (!response.ok) return false;
  const control = response.payload || {};
  const desiredConcurrency = Math.max(1, Math.min(128, Number(control.desiredConcurrency || concurrency)));
  await synchronizeGlobalDispatchControl({
    limit: Number.isFinite(desiredConcurrency) ? desiredConcurrency : concurrency,
    ...(typeof control.desiredPaused === 'boolean' ? { paused: control.desiredPaused } : {})
  });
  return true;
  })();
  try {
    return await telemetryPublishPromise;
  } finally {
    telemetryPublishPromise = null;
  }
}

async function initWorker() {
  if (worker) return worker;
  await startStorageCleanupMaintenance();
  globalDispatch.open();
  let startupDispatchState;
  try {
    await CVProcessingJob.updateMany(
      {
        state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
        expiresAt: { $exists: true }
      },
      { $unset: { expiresAt: 1 } }
    );
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
    await CVProcessingJob.updateOne({ publicId: job.id }, {
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
  if (['queued', 'waiting_for_local_runtime'].includes(job.state)) {
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
  const states = ['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'];
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
      state: { $in: ['queued', 'waiting_for_local_runtime'] }
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
    CVProcessingJob.findOne({ state: { $in: ['queued', 'waiting_for_local_runtime'] } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean(),
    CVProcessingJob.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]),
    CVProcessingJob.find({ state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] } })
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
      state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
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
      const leftActive = ['queued', 'waiting_for_local_runtime', 'processing'].includes(left.state) ? 0 : 1;
      const rightActive = ['queued', 'waiting_for_local_runtime', 'processing'].includes(right.state) ? 0 : 1;
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
      waitingForRuntime: Number(durable.waiting_for_local_runtime || 0) + Number(externalDurable.waiting_for_local_runtime || 0),
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
      retainedIndefinitely: true,
      total: Object.values(historyStates).reduce((sum, value) => sum + Number(value || 0), 0),
      completed: Number(historyStates.completed || 0),
      failed: Number(historyStates.failed || 0),
      active: Number(historyStates.queued || 0)
        + Number(historyStates.waiting_for_local_runtime || 0)
        + Number(historyStates.processing || 0)
    },
    retention: {
      recruiterStateWindowDays: Math.round(TERMINAL_JOB_RETENTION_MS / (24 * 60 * 60 * 1000)),
      aiInterviewStateSource: 'permanent-audit',
      permanentHistory: true
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
        name: 'ai-interview-cv-analysis-local',
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
    counts.delayed = Number(counts.delayed || 0) + Number(externalDurable.waiting_for_local_runtime || 0);
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
    .select('publicId source state stage progress attempts processingAttempts boundedFailureAttempts retry attemptHistory durableFile cloudinary +resumeText createdAt startedAt completedAt failedAt updatedAt lastError originalName fileType fileSize organization actor jobAppliedFor candidate formData.firstName formData.lastName formData.email formData.position formData.location')
    .populate('organization', 'name')
    .populate('actor', 'email profile.firstName profile.lastName profile.displayName')
    .populate('jobAppliedFor', 'title')
    .populate('candidate', 'firstName lastName email')
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
  const activityRank = (job) => ['queued', 'waiting_for_local_runtime', 'processing'].includes(job.state) ? 0 : 1;
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
  if (overrides.durableFileStore) durableFileStore = overrides.durableFileStore;
  if (overrides.enqueueJob) enqueueJob = overrides.enqueueJob;
  if (overrides.telemetryTransport) telemetryTransport = overrides.telemetryTransport;
  if (overrides.dispatchInferenceRunner) {
    runInferenceWithGlobalPermit = overrides.dispatchInferenceRunner;
  }
  if (overrides.completionEffectHandlers) {
    completionEffectHandlers = {
      ...completionEffectHandlers,
      ...overrides.completionEffectHandlers
    };
  }
}

function resetDependenciesForTests() {
  cvParser = defaultCvParser;
  cloudinary = defaultCloudinary;
  durableFileStore = durableCvFileStore;
  enqueueJob = (...args) => addQueueJob(...args);
  telemetryTransport = defaultTelemetryTransport;
  runInferenceWithGlobalPermit = defaultDispatchInferenceRunner;
  completionEffectHandlers = { ...defaultCompletionEffectHandlers };
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
  telemetryPublishPromise = null;
  if (initRetryTimer) clearInterval(initRetryTimer);
  initRetryTimer = null;
  historyBackfillPromise = null;
  lastHistoryBackfillAt = 0;
  historyBackfillCursor = null;
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

async function submitBatch(req) {
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
  const baseIdempotency = String(req.get?.('Idempotency-Key') || crypto.randomUUID());
  const ingestConcurrency = Math.max(1, Math.min(16, Number(process.env.CV_BULK_INGEST_CONCURRENCY || 4)));
  const submittedFiles = await mapWithConcurrency(files, ingestConcurrency, async (file, index) => {
    try {
      const childRequest = {
        ...req,
        file,
        files: undefined,
        body: req.body || {},
        get: (name) => name.toLowerCase() === 'idempotency-key' ? `${baseIdempotency}:${index}` : req.get?.(name)
      };
      const submitted = await submitUpload(childRequest, 'bulk');
      return { jobId: submitted.job._id };
    } catch (error) {
      try { await unlinkAsync(file.path); } catch {}
      return { rejected: { fileName: file.originalname, error: error.message } };
    }
  });
  const jobs = submittedFiles.flatMap((item) => item.jobId ? [item.jobId] : []);
  const rejected = submittedFiles.flatMap((item) => item.rejected ? [item.rejected] : []);
  const batch = await CVProcessingBatch.create({
    publicId: `batch_${crypto.randomUUID()}`,
    organization: organizationId,
    actor: req.user?.id,
    jobs,
    rejected,
    totalFiles: files.length
  });
  return getBatchStatus(batch.publicId, organizationId);
}

async function getBatchStatus(publicId, organizationId) {
  const batch = await CVProcessingBatch.findOne({ publicId, organization: organizationId }).populate('jobs');
  if (!batch) return null;
  const jobs = batch.jobs || [];
  const completedJobs = jobs.filter((job) => job.state === 'completed');
  const failedJobs = jobs.filter((job) => job.state === 'failed');
  const waitingJobs = jobs.filter((job) => ['queued', 'waiting_for_local_runtime'].includes(job.state));
  const activeJobs = jobs.filter((job) => job.state === 'processing');
  const completed = completedJobs.length + failedJobs.length + batch.rejected.length;
  // A parked job looks identical to a slow one from the outside. Carrying the
  // reason it is waiting is the difference between "still processing" and
  // "your ChatGPT plan is out of quota until the 13th".
  const parked = waitingJobs.find((job) => job.state === 'waiting_for_local_runtime' && job.lastError?.message);
  return {
    batchId: batch.publicId,
    waitingReason: parked?.lastError?.message || null,
    waitingCode: parked?.lastError?.code || null,
    totalFiles: batch.totalFiles,
    completed,
    successful: completedJobs.length,
    failed: failedJobs.length + batch.rejected.length,
    processing: activeJobs.length,
    queued: waitingJobs.length,
    state: completed >= batch.totalFiles
      ? 'completed'
      : waitingJobs.some((job) => job.state === 'waiting_for_local_runtime') ? 'waiting_for_local_runtime' : 'processing',
    results: completedJobs.map((job) => ({ fileName: job.originalName, candidateId: String(job.candidate), success: true })),
    errors: [
      ...batch.rejected.map((item) => ({ fileName: item.fileName, error: item.error, success: false })),
      ...failedJobs.map((job) => ({ fileName: job.originalName, error: job.lastError?.message, success: false }))
    ],
    startedAt: batch.createdAt,
    completedAt: completed >= batch.totalFiles ? new Date().toISOString() : null
  };
}

module.exports = {
  _deliverCompletionEffectsForTests: deliverCompletionEffects,
  _processJobForTests: processJob,
  _recoverCompletionEffectsForTests: recoverCompletionEffects,
  _retryStorageCleanupForTests: retryStorageCleanup,
  _resetDependenciesForTests: resetDependenciesForTests,
  _setDependenciesForTests: setDependenciesForTests,
  _createGlobalDispatchCoordinator: createGlobalDispatchCoordinator,
  _createGlobalDispatchInferenceRunner: createGlobalDispatchInferenceRunner,
  _globalDispatchConfig: globalDispatchConfig,
  _initializeGlobalDispatchForTests: initializeGlobalDispatchForTests,
  _loadAdminAuditsForTests: loadAdminAudits,
  _loadRecentExternalAuditsForTests: loadRecentExternalAudits,
  _sharedDispatchWorkerState: sharedDispatchWorkerState,
  adminTelemetry,
  closeForTests,
  enqueueExistingJob,
  getBatchStatus,
  getAdminJobDetail,
  getAdminJobSummaries,
  getStatus,
  finalizePrivateUploadSubmission,
  ingestExternalQueueEvent,
  initWorker,
  listAdminHistory,
  listHistory,
  publishTelemetry,
  retryFailedJob,
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
  telemetry,
  tokenHash
};
