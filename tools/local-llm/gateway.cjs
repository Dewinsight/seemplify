const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  ENGINE_DEFAULTS,
  ENGINE_IDS,
  analyzeWithEngine,
  engineHealth,
  engineSettings
} = require('./engine-adapters.cjs');
const {
  activityConcurrencyDecision,
  assertConcurrencyApproved,
  concurrencyDecision,
  normalizeConcurrency
} = require('./approval-store.cjs');
const {
  ActivityQueueScheduler
} = require('./activity-queue.cjs');
const { BoundedFixedWindowRateLimiter } = require('./bounded-rate-limit.cjs');
const codexSessions = require('./codex-session-manager.cjs');
const {
  LocalExecutionReceiptStore,
  canonicalRequestFingerprint
} = require('./execution-receipt-store.cjs');
const { LocalUsageMeteringOutbox } = require('./usage-metering-outbox.cjs');
const { LocalTelemetryStore } = require('./local-telemetry-store.cjs');
const {
  executionPolicyTelemetry,
  resolveExecutionPolicy
} = require('./execution-policy.cjs');
const {
  ACTIVITY_DEFINITIONS,
  localProviderLabel
} = require('./activity-catalog.cjs');
const {
  RUNTIME_PROFILE_DEFINITIONS,
  RUNTIME_PROFILE_IDS,
  defaultApplicationDefaults,
  isRuntimeProfile,
  mergeApplicationDefaults,
  runtimeProfileForActivity,
  runtimeProfileFromStatusInput
} = require('./runtime-profiles.cjs');
const {
  SIGNATURE_VERSION: SERVICE_SIGNATURE_VERSION,
  authorizeServiceRequest,
  legacyV1Allowed,
  normalizeServiceId,
  verifyServiceSignature
} = require('./service-auth.cjs');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(workspaceRoot, '.local-runtime', 'llm');
const secretFile = process.env.LOCAL_LLM_SECRET_FILE || path.join(runtimeDir, 'service-secret');
const controlSecretFile = process.env.LOCAL_LLM_CONTROL_SECRET_FILE || path.join(runtimeDir, 'control-secret');
const stateFile = process.env.LOCAL_LLM_STATE_FILE || path.join(runtimeDir, 'state.json');
const logFile = process.env.LOCAL_LLM_LOG_FILE || path.join(runtimeDir, 'gateway.log');
const nonceDir = process.env.LOCAL_LLM_NONCE_DIR || path.join(path.dirname(stateFile), 'nonces');
const usageOutboxDir = process.env.LOCAL_LLM_USAGE_OUTBOX_DIR || path.join(runtimeDir, 'usage-outbox');
const executionReceiptDir = process.env.LOCAL_LLM_EXECUTION_RECEIPT_DIR || path.join(runtimeDir, 'execution-receipts');
const telemetryDir = process.env.LOCAL_LLM_TELEMETRY_DIR || path.join(runtimeDir, 'telemetry');
const logMaxBytes = Math.max(64 * 1024, Number(process.env.LOCAL_LLM_LOG_MAX_BYTES || 10 * 1024 * 1024));
const logRotations = Math.max(1, Math.min(20, Number(process.env.LOCAL_LLM_LOG_ROTATIONS || 5)));
const host = process.env.LOCAL_LLM_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.LOCAL_LLM_GATEWAY_PORT || 11435);
const maxBodyBytes = Number(process.env.LOCAL_LLM_MAX_BODY_BYTES || 2 * 1024 * 1024);
const signatureSkewMs = Number(process.env.LOCAL_LLM_SIGNATURE_SKEW_MS || 5 * 60 * 1000);
const nonceTtlMs = Number(process.env.LOCAL_LLM_NONCE_TTL_MS || 10 * 60 * 1000);
const rateLimitWindowMs = Number(process.env.LOCAL_LLM_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const rateLimitRequests = Number(process.env.LOCAL_LLM_RATE_LIMIT_REQUESTS || 120);
const rateLimitMaxKeys = Number(process.env.LOCAL_LLM_RATE_LIMIT_MAX_KEYS || 10_000);
const publicHealthRateLimitWindowMs = Number(process.env.LOCAL_LLM_HEALTH_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const publicHealthRateLimitRequests = Number(process.env.LOCAL_LLM_HEALTH_RATE_LIMIT_REQUESTS || 30);
const publicHealthRateLimitMaxKeys = Number(process.env.LOCAL_LLM_HEALTH_RATE_LIMIT_MAX_KEYS || 10_000);
const recruiterBackendUrl = String(process.env.RECRUITER_BACKEND_URL || 'https://api.seemplifyai.com').replace(/\/+$/, '');
const serviceConcurrencyCap = Math.max(1, Math.min(8, Number(process.env.LOCAL_LLM_MAX_CONCURRENCY || 8)));
const recruiterActivities = new Set(Object.keys(ACTIVITY_DEFINITIONS));

/**
 * Which activities this gateway will serve. Recruiter declares its own in its
 * catalogue; the other products that call the gateway directly are governed by
 * the runtime profiles here, so they no longer have to be listed inside
 * Recruiter's catalogue to be accepted.
 */
function isAllowedActivity(activity) {
  return recruiterActivities.has(activity) || Boolean(runtimeProfileForActivity(activity));
}
const cvActivities = new Set(['candidate.cv_parse', 'ai_interview.cv_parse']);
const meteringExcludedHarnessSources = new Set([
  'gateway-integration-test',
  'local-benchmark',
  'local-codex-benchmark',
  'local-cv-evaluation',
  'local-engine-benchmark',
  'local-engine-verification',
  'local-external-smoke',
  'local-soak',
  'provider-benchmark',
  'runtime-model-evaluation'
]);
const requiredCvFields = ['firstName', 'lastName', 'email', 'skills', 'summary'];

for (const file of [secretFile, controlSecretFile, stateFile, logFile]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}
fs.mkdirSync(nonceDir, { recursive: true });

function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function ensureSecret(file) {
  if (!fs.existsSync(file)) atomicWrite(file, `${crypto.randomBytes(48).toString('base64url')}\n`);
  return fs.readFileSync(file, 'utf8').trim();
}

function defaultState() {
  return {
    enabled: true,
    ingressEnabled: true,
    paused: false,
    concurrency: 1,
    autoStart: true,
    selectionMode: 'automatic',
    selectedEngine: 'codex',
    applicationDefaults: defaultApplicationDefaults(),
    engines: Object.fromEntries(Object.entries(ENGINE_DEFAULTS).map(([id, item]) => [
      id,
      { model: item.model, ...(item.baseUrl ? { baseUrl: item.baseUrl } : {}) }
    ]))
  };
}

function applyConcurrencyPolicy(state) {
  const requestedConcurrency = normalizeConcurrency(state.concurrency);
  return {
    ...state,
    concurrency: Math.min(requestedConcurrency, serviceConcurrencyCap),
    requestedConcurrency,
    approvedConcurrency: serviceConcurrencyCap,
    concurrencySustainedValidated: true
  };
}

function readStoredState() {
  const defaults = defaultState();
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      ...defaults,
      ...saved,
      applicationDefaults: mergeApplicationDefaults(saved.applicationDefaults),
      engines: Object.fromEntries(Object.keys(ENGINE_DEFAULTS).map((id) => [
        id,
        { ...defaults.engines[id], ...(saved.engines?.[id] || {}) }
      ]))
    };
  } catch {
    atomicWrite(stateFile, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function readState() {
  return applyConcurrencyPolicy(readStoredState());
}

function stateForRuntimeProfile(state, runtimeProfile) {
  const definition = RUNTIME_PROFILE_DEFINITIONS[runtimeProfile];
  if (!definition) return state;
  const profile = state.applicationDefaults?.[definition.stateKey] || {};
  const engine = ENGINE_IDS.includes(profile.engine) ? profile.engine : definition.defaultEngine;
  const model = String(
    profile.model
    || state.engines?.[engine]?.model
    || ENGINE_DEFAULTS[engine]?.model
    || definition.defaultModel
    || ''
  );
  return {
    ...state,
    selectedEngine: engine,
    engines: {
      ...state.engines,
      [engine]: { ...(state.engines?.[engine] || {}), model }
    }
  };
}

function writeState(update) {
  const {
    requestedConcurrency: _requestedConcurrency,
    approvedConcurrency: _approvedConcurrency,
    concurrencySustainedValidated: _concurrencySustainedValidated,
    ...stored
  } = readStoredState();
  const constrained = applyConcurrencyPolicy({ ...stored, ...update });
  const {
    requestedConcurrency,
    approvedConcurrency,
    concurrencySustainedValidated,
    ...persisted
  } = constrained;
  const next = { ...persisted, updatedAt: new Date().toISOString() };
  atomicWrite(stateFile, JSON.stringify(next, null, 2));
  return {
    ...next,
    requestedConcurrency,
    approvedConcurrency,
    concurrencySustainedValidated
  };
}

function controlAuditValue(key, value) {
  if (key !== 'engines') return value;
  return Object.fromEntries(ENGINE_IDS.map((id) => [
    id,
    {
      model: String(value?.[id]?.model || '')
    }
  ]));
}

function controlStateChanges(before, after, requested) {
  return Object.fromEntries(Object.keys(requested).map((key) => [
    key,
    {
      from: controlAuditValue(key, before?.[key]),
      to: controlAuditValue(key, after?.[key])
    }
  ]));
}

let logWriteChain = Promise.resolve();

async function rotateLogIfNeeded(additionalBytes) {
  let size = 0;
  try {
    size = Number((await fs.promises.stat(logFile)).size || 0);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (size + additionalBytes <= logMaxBytes) return;
  for (let index = logRotations - 1; index >= 1; index -= 1) {
    const source = `${logFile}.${index}`;
    const target = `${logFile}.${index + 1}`;
    await fs.promises.rm(target, { force: true }).catch(() => {});
    await fs.promises.rename(source, target).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  await fs.promises.rm(`${logFile}.1`, { force: true }).catch(() => {});
  await fs.promises.rename(logFile, `${logFile}.1`).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

function log(level, message, metadata = {}) {
  const record = JSON.stringify({ at: new Date().toISOString(), level, message, ...metadata });
  process.stdout.write(`${record}\n`);
  logWriteChain = logWriteChain
    .then(async () => {
      const line = `${record}\n`;
      await rotateLogIfNeeded(Buffer.byteLength(line));
      await fs.promises.appendFile(logFile, line, 'utf8');
    })
    .catch((error) => {
      process.stderr.write(`Gateway log write failed: ${String(error?.message || error)}\n`);
    });
  return logWriteChain;
}

const secret = ensureSecret(secretFile);
const controlSecret = ensureSecret(controlSecretFile);
const usageMeteringOutbox = new LocalUsageMeteringOutbox({
  directory: usageOutboxDir,
  endpointUrl: `${recruiterBackendUrl}/api/internal/ai/v1/local-usage/events`,
  secret,
  initialDelayMs: Number(process.env.LOCAL_LLM_USAGE_INITIAL_DELAY_MS || 15_000),
  retryBaseMs: Number(process.env.LOCAL_LLM_USAGE_RETRY_BASE_MS || 1_000),
  retryMaxMs: Number(process.env.LOCAL_LLM_USAGE_RETRY_MAX_MS || 5 * 60_000),
  deadMaxJobs: Number(process.env.LOCAL_LLM_USAGE_DEAD_MAX_JOBS || 1_000),
  deadRetentionMs: Number(process.env.LOCAL_LLM_USAGE_DEAD_RETENTION_MS || 30 * 24 * 60 * 60_000),
  log
});
const telemetryStore = new LocalTelemetryStore({
  directory: telemetryDir,
  maxEvents: Number(process.env.LOCAL_LLM_TELEMETRY_MAX_EVENTS || 50_000),
  maxQueueJobs: Number(process.env.LOCAL_LLM_QUEUE_HISTORY_MAX_JOBS || 10_000)
});
const executionReceiptStore = new LocalExecutionReceiptStore({
  directory: executionReceiptDir,
  encryptionSecret: secret,
  retentionMs: Number(process.env.LOCAL_LLM_EXECUTION_RECEIPT_RETENTION_MS || 30 * 24 * 60 * 60_000),
  maxReceipts: Number(process.env.LOCAL_LLM_EXECUTION_RECEIPT_MAX_COUNT || 10_000),
  maxTombstones: Number(process.env.LOCAL_LLM_EXECUTION_TOMBSTONE_MAX_COUNT || 50_000),
  maxBytes: Number(process.env.LOCAL_LLM_EXECUTION_RECEIPT_MAX_BYTES || 512 * 1024 * 1024),
  maxPreparedBytes: Number(process.env.LOCAL_LLM_EXECUTION_RECEIPT_MAX_RESULT_BYTES || 8 * 1024 * 1024),
  leaseMs: Number(process.env.LOCAL_LLM_EXECUTION_LEASE_MS || 120_000),
  pollMs: Number(process.env.LOCAL_LLM_EXECUTION_POLL_MS || 50),
  log
});
const seenNonces = new Map();
const requestLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: rateLimitWindowMs,
  requests: rateLimitRequests,
  maxKeys: rateLimitMaxKeys
});
const publicHealthLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: publicHealthRateLimitWindowMs,
  requests: publicHealthRateLimitRequests,
  maxKeys: publicHealthRateLimitMaxKeys
});
const activeControllers = new Set();
let completed = 0;
let failed = 0;
let totalLatencyMs = 0;
let lastRequestAt = null;
let shuttingDown = false;
let queueTelemetry = null;
let lastNoncePruneAt = 0;

function activitySchedulerLimits(activity) {
  const state = readState();
  const executionState = stateForRuntimeProfile(
    state,
    runtimeProfileForActivity(activity)
  );
  const available = !shuttingDown && state.enabled && !state.paused;
  const configured = Math.min(serviceConcurrencyCap, Math.max(1, Number(state.concurrency || 1)));
  return {
    globalLimit: available ? configured : 0,
    activityLimit: available ? configured : 0,
    approvedConcurrency: serviceConcurrencyCap,
    candidateConcurrency: serviceConcurrencyCap,
    sustainedValidated: true,
    globalApprovedConcurrency: serviceConcurrencyCap,
    globalSustainedValidated: true
  };
}

const inferenceScheduler = new ActivityQueueScheduler({
  getLimits: activitySchedulerLimits,
  maxQueuePerActivity: Number(process.env.LOCAL_LLM_MAX_QUEUE_PER_ACTIVITY || 1_000),
  maxWaitMs: Number(process.env.LOCAL_LLM_ACTIVITY_QUEUE_MAX_WAIT_MS || 0)
});

async function pruneNonces(now = Date.now()) {
  for (const [nonce, expiresAt] of seenNonces) if (expiresAt <= now) seenNonces.delete(nonce);
  if (now - lastNoncePruneAt < 60_000) return;
  lastNoncePruneAt = now;
  let entries = [];
  try {
    entries = await fs.promises.readdir(nonceDir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.nonce')) return;
    const file = path.join(nonceDir, entry.name);
    try {
      const expiresAt = Number(await fs.promises.readFile(file, 'utf8'));
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        await fs.promises.rm(file, { force: true });
      }
    } catch {}
  }));
}

async function claimNonce(nonce, expiresAt, now = Date.now()) {
  if (seenNonces.has(nonce)) return false;
  const file = path.join(nonceDir, `${nonce}.nonce`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fs.promises.open(file, 'wx', 0o600);
      await handle.writeFile(String(expiresAt), 'utf8');
      await handle.close();
      seenNonces.set(nonce, expiresAt);
      return true;
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch {}
      }
      if (error?.code !== 'EEXIST') return false;
      try {
        const storedExpiry = Number(await fs.promises.readFile(file, 'utf8'));
        if (Number.isFinite(storedExpiry) && storedExpiry > now) return false;
        await fs.promises.rm(file, { force: true });
      } catch {
        return false;
      }
    }
  }
  return false;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function queueCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function queueTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function queueText(value, maximumLength = 80) {
  return String(value || '').replace(/[^\w.:/-]/g, '').slice(0, maximumLength);
}

function providerMetric(value = {}) {
  const cost = Math.max(0, Number(value.estimatedCostUsd || 0));
  return {
    calls: queueCount(value.calls),
    failures: queueCount(value.failures),
    averageLatencyMs: queueCount(value.averageLatencyMs),
    totalTokens: queueCount(value.totalTokens),
    estimatedCostUsd: Number((Number.isFinite(cost) ? cost : 0).toFixed(8))
  };
}

function normalizeProviderTelemetry(input = {}) {
  return {
    sampledAt: queueTimestamp(input.sampledAt),
    window: {
      minutes: Math.max(1, Math.min(24 * 60, queueCount(input.window?.minutes) || 60))
    },
    totals: {
      fiveMinutes: providerMetric(input.totals?.fiveMinutes),
      hour: providerMetric(input.totals?.hour)
    },
    providers: (Array.isArray(input.providers) ? input.providers : [])
      .slice(0, 16)
      .map((provider) => ({
        id: queueText(provider?.id, 80) || 'unknown',
        ...providerMetric(provider),
        lastRequestAt: queueTimestamp(provider?.lastRequestAt)
      }))
  };
}

function normalizeQueueTelemetry(input = {}) {
  const recentJobs = Array.isArray(input.recentJobs)
    ? input.recentJobs.slice(0, 20).map((job) => ({
        jobId: queueText(job?.jobId, 100),
        source: queueText(job?.source, 40),
        producer: queueText(job?.producer, 40),
        queue: queueText(job?.queue, 80),
        state: queueText(job?.state, 40),
        phase: queueText(job?.phase || job?.state, 40),
        stage: queueText(job?.stage, 40) || null,
        progress: Math.min(100, queueCount(job?.progress)),
        attempts: queueCount(job?.attempts),
        nextAttemptAt: queueTimestamp(job?.nextAttemptAt || job?.retry?.nextAttemptAt),
        deferredCycles: queueCount(job?.deferredCycles ?? job?.retry?.deferredCycles),
        createdAt: queueTimestamp(job?.createdAt),
        startedAt: queueTimestamp(job?.startedAt),
        completedAt: queueTimestamp(job?.completedAt),
        failedAt: queueTimestamp(job?.failedAt),
        updatedAt: queueTimestamp(job?.updatedAt),
        waitMs: queueCount(job?.waitMs),
        processingMs: job?.processingMs == null ? null : queueCount(job.processingMs),
        errorCode: job?.errorCode ? queueText(job.errorCode, 80) : null,
        transitions: Array.isArray(job?.transitions)
          ? job.transitions.slice(-20).map((transition) => ({
              phase: queueText(transition?.phase || transition?.state, 40),
              stage: queueText(transition?.stage, 40) || null,
              state: queueText(transition?.state, 40),
              progress: Math.min(100, queueCount(transition?.progress)),
              attempts: queueCount(transition?.attempts),
              at: queueTimestamp(transition?.at),
              errorCode: transition?.errorCode ? queueText(transition.errorCode, 80) : null
            }))
          : []
      }))
    : [];
  return {
    schemaVersion: Number(input.schemaVersion) >= 2 ? 2 : 1,
    waiting: queueCount(input.waiting),
    active: queueCount(input.active),
    delayed: queueCount(input.delayed),
    completed: queueCount(input.completed),
    failed: queueCount(input.failed),
    oldestWaitMs: queueCount(input.oldestWaitMs),
    paused: Boolean(input.paused),
    workerConcurrency: Math.max(1, queueCount(input.workerConcurrency) || 1),
    available: input.available !== false,
    queue: queueText(input.queue, 80) || 'cv-analysis-local',
    sampledAt: queueTimestamp(input.sampledAt),
    oldestQueuedAt: queueTimestamp(input.oldestQueuedAt),
    counts: {
      prioritized: queueCount(input.counts?.prioritized),
      waiting: queueCount(input.counts?.waiting),
      waitingTotal: queueCount(input.counts?.waitingTotal ?? input.waiting),
      active: queueCount(input.counts?.active ?? input.active),
      delayed: queueCount(input.counts?.delayed ?? input.delayed),
      completed: queueCount(input.counts?.completed ?? input.completed),
      failed: queueCount(input.counts?.failed ?? input.failed),
      paused: queueCount(input.counts?.paused)
    },
    durable: {
      queued: queueCount(input.durable?.queued),
      waitingForRuntime: queueCount(input.durable?.waitingForRuntime),
      processing: queueCount(input.durable?.processing),
      completed: queueCount(input.durable?.completed),
      failed: queueCount(input.durable?.failed),
      retrying: queueCount(input.durable?.retrying)
    },
    rates: {
      completedLast5Minutes: queueCount(input.rates?.completedLast5Minutes),
      completedLastHour: queueCount(input.rates?.completedLastHour),
      failedLastHour: queueCount(input.rates?.failedLastHour),
      averageProcessingMs: queueCount(input.rates?.averageProcessingMs),
      p95ProcessingMs: queueCount(input.rates?.p95ProcessingMs)
    },
    history: {
      retainedIndefinitely: input.history?.retainedIndefinitely === true,
      total: queueCount(input.history?.total),
      completed: queueCount(input.history?.completed),
      failed: queueCount(input.history?.failed),
      active: queueCount(input.history?.active)
    },
    retention: {
      recruiterStateWindowDays: Math.max(1, queueCount(input.retention?.recruiterStateWindowDays) || 30),
      aiInterviewStateSource: queueText(input.retention?.aiInterviewStateSource, 40) || 'permanent-audit',
      permanentHistory: input.retention?.permanentHistory === true
    },
    worker: {
      running: Boolean(input.worker?.running),
      concurrency: Math.max(1, queueCount(input.worker?.concurrency ?? input.workerConcurrency) || 1),
      active: queueCount(input.worker?.active ?? input.active),
      availableSlots: queueCount(input.worker?.availableSlots),
      utilizationPercent: Math.min(100, queueCount(input.worker?.utilizationPercent)),
      scope: queueText(input.worker?.scope, 80)
    },
    queues: Array.isArray(input.queues)
      ? input.queues.slice(0, 10).map((queue) => ({
          name: queueText(queue?.name, 80),
          producer: queueText(queue?.producer, 40),
          durable: {
            queued: queueCount(queue?.durable?.queued),
            waitingForRuntime: queueCount(queue?.durable?.waiting_for_local_runtime ?? queue?.durable?.waitingForRuntime),
            processing: queueCount(queue?.durable?.processing),
            completed: queueCount(queue?.durable?.completed),
            failed: queueCount(queue?.durable?.failed)
          }
        }))
      : [],
    recentJobs,
    measuredAt: new Date().toISOString()
  };
}

async function verifySignature(headers, method, requestPath, rawBody, request) {
  const timestamp = String(headers['x-seemplify-timestamp'] || '');
  const nonce = String(headers['x-seemplify-nonce'] || '');
  const signature = String(headers['x-seemplify-signature'] || '');
  const signatureVersion = String(headers['x-seemplify-signature-version'] || '1');
  const serviceId = normalizeServiceId(headers['x-seemplify-service']);
  const numericTimestamp = Number(timestamp);
  const now = Date.now();
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > signatureSkewMs) {
    return { ok: false, code: 'SIGNATURE_EXPIRED' };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return { ok: false, code: 'NONCE_REJECTED' };
  }
  if (signatureVersion === SERVICE_SIGNATURE_VERSION) {
    const valid = verifyServiceSignature(secret, {
      timestamp, nonce, serviceId, method, requestPath, rawBody
    }, signature);
    if (!valid) return { ok: false, code: 'SERVICE_SIGNATURE_INVALID' };
  } else {
    const allowLegacy = legacyV1Allowed({
      nodeEnv: process.env.NODE_ENV,
      gatewayHost: host,
      remoteAddress: request?.socket?.remoteAddress,
      forwarded: request ? hasForwardingHeaders(request) : true
    });
    if (!allowLegacy) return { ok: false, code: 'SERVICE_SIGNATURE_V2_REQUIRED' };
    const expected = crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\n${String(method || '').toUpperCase()}\n${requestPath}\n${rawBody}`)
      .digest('base64url');
    if (!safeEqual(expected, signature)) return { ok: false, code: 'SIGNATURE_INVALID' };
  }
  await pruneNonces(now);
  if (!await claimNonce(nonce, now + nonceTtlMs, now)) return { ok: false, code: 'NONCE_REJECTED' };
  return {
    ok: true,
    signatureVersion,
    serviceId: signatureVersion === SERVICE_SIGNATURE_VERSION ? serviceId : 'legacy-loopback'
  };
}

function authorizeVerifiedService(verified, input = {}) {
  if (verified.signatureVersion !== SERVICE_SIGNATURE_VERSION) return { ok: true };
  return authorizeServiceRequest(verified.serviceId, input);
}

function queueHistoryPath(inputUrl) {
  const params = new URLSearchParams();
  const page = Math.max(1, Math.min(100_000, Number(inputUrl.searchParams.get('page')) || 1));
  const limit = Math.max(10, Math.min(100, Number(inputUrl.searchParams.get('limit')) || 25));
  params.set('page', String(page));
  params.set('limit', String(limit));
  const state = String(inputUrl.searchParams.get('state') || '');
  if (['queued', 'waiting_for_local_runtime', 'processing', 'retrying', 'completed', 'failed'].includes(state)) params.set('state', state);
  const source = String(inputUrl.searchParams.get('source') || '');
  if (['private', 'public', 'bulk', 'ai-interview'].includes(source)) params.set('source', source);
  const search = queueText(inputUrl.searchParams.get('search'), 100);
  if (search) params.set('search', search);
  for (const name of ['from', 'to']) {
    const value = inputUrl.searchParams.get(name);
    const parsed = value ? new Date(value) : null;
    if (parsed && Number.isFinite(parsed.getTime())) params.set(name, parsed.toISOString());
  }
  return `/api/internal/local-cv-queue/history?${params.toString()}`;
}

function signQueueHistoryPath(requestPath, method = 'GET') {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${String(method).toUpperCase()}\n${requestPath}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function fetchQueueHistory(inputUrl) {
  return {
    status: 200,
    payload: telemetryStore.queueHistory(Object.fromEntries(inputUrl.searchParams.entries()))
  };
}

async function fetchProviderTelemetry() {
  return { status: 200, payload: telemetryStore.providerTelemetry() };
}

function executionModeForEngine(engine) {
  return ['codex', 'claude'].includes(String(engine || '').toLowerCase())
    ? 'local-cloud'
    : 'local';
}

async function retryQueueJob(jobId, stage = 'failed') {
  if (!/^cv_[A-Za-z0-9_-]{8,100}$/.test(String(jobId || ''))) {
    return { status: 400, payload: { code: 'CV_JOB_ID_INVALID', message: 'CV job identifier is invalid' } };
  }
  const requestPath = `/api/internal/local-cv-queue/jobs/${encodeURIComponent(jobId)}/retry`;
  const signed = signQueueHistoryPath(requestPath, 'POST');
  const body = JSON.stringify({ stage: ['failed', 'parsing', 'analysis'].includes(stage) ? stage : 'failed' });
  const upstream = await fetch(`${recruiterBackendUrl}${requestPath}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined
  });
  const payload = await upstream.json().catch(() => ({
    code: 'CV_RETRY_INVALID_RESPONSE',
    message: 'The recruiter backend returned an invalid retry response'
  }));
  return { status: upstream.status, payload };
}

function activityAnalyticsPath(inputUrl) {
  const params = new URLSearchParams();
  const range = String(inputUrl.searchParams.get('range') || '24h');
  params.set('range', ['1h', '24h', '7d', '30d', '90d'].includes(range) ? range : '24h');
  return `/api/internal/local-cv-queue/activity-analytics?${params.toString()}`;
}

function activityHistoryPath(inputUrl) {
  const params = new URLSearchParams();
  const range = String(inputUrl.searchParams.get('range') || '24h');
  params.set('range', ['1h', '24h', '7d', '30d', '90d'].includes(range) ? range : '24h');
  params.set('page', String(Math.max(1, Math.min(100_000, Number(inputUrl.searchParams.get('page')) || 1))));
  params.set('limit', String(Math.max(10, Math.min(100, Number(inputUrl.searchParams.get('limit')) || 25))));
  const filters = {
    status: /^(success|failed)$/,
    provider: /^[A-Za-z0-9._-]{1,80}$/,
    activity: /^[A-Za-z0-9._:-]{1,120}$/,
    sourceApp: /^[A-Za-z0-9._:-]{1,80}$/,
    organizationId: /^[A-Za-z0-9._:-]{1,120}$/,
    actorId: /^[A-Za-z0-9._:@+-]{1,160}$/
  };
  for (const [name, pattern] of Object.entries(filters)) {
    const value = String(inputUrl.searchParams.get(name) || '').trim();
    if (value && pattern.test(value)) params.set(name, value);
  }
  const search = queueText(inputUrl.searchParams.get('search'), 100);
  if (search) params.set('search', search);
  return `/api/internal/local-cv-queue/activity-history?${params.toString()}`;
}

async function fetchSignedHosted(requestPath, timeoutMs = 8_000) {
  const signed = signQueueHistoryPath(requestPath);
  const upstream = await fetch(`${recruiterBackendUrl}${requestPath}`, {
    headers: {
      accept: 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  });
  const payload = await upstream.json().catch(() => ({
    code: 'AI_ACTIVITY_INVALID_RESPONSE',
    message: 'The hosted backend returned an invalid AI activity response'
  }));
  return { status: upstream.status, payload };
}

function rateLimitKey(request) {
  return String(request.headers['cf-connecting-ip'] || request.socket.remoteAddress || 'unknown');
}

function withinRateLimit(request) {
  return requestLimiter.consume(rateLimitKey(request));
}

function isLocalRequest(request) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
}

function hasForwardingHeaders(request) {
  return Boolean(
    request.headers['cf-connecting-ip']
    || request.headers['cf-ray']
    || request.headers['cf-visitor']
    || request.headers.forwarded
    || request.headers['x-real-ip']
    || request.headers['x-forwarded-for']
    || request.headers['x-forwarded-host']
    || request.headers['x-forwarded-proto']
  );
}

function isPublicRequest(request) {
  return !isLocalRequest(request) || hasForwardingHeaders(request);
}

function isLocalControlRequest(request) {
  if (!isLocalRequest(request)) return false;
  if (hasForwardingHeaders(request)) return false;
  return safeEqual(request.headers['x-seemplify-control-secret'], controlSecret);
}

function sendJson(response, status, payload, extraHeaders = {}) {
  if (response.writableEnded || response.destroyed) return false;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  response.end(body);
  return true;
}

function validateSchemaValue(value, schema, location = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return [`${location} has no schema`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${location} must be one of the allowed values`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${location} must be an object`];
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${location}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateSchemaValue(value[key], childSchema, `${location}.${key}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${location} must be an array`];
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) errors.push(`${location} must contain at least ${schema.minItems} items`);
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) errors.push(`${location} must contain at most ${schema.maxItems} items`);
    value.forEach((item, index) => errors.push(...validateSchemaValue(item, schema.items || {}, `${location}[${index}]`)));
  } else if (schema.type === 'string' && typeof value !== 'string') {
    errors.push(`${location} must be a string`);
  } else if (schema.type === 'number' && typeof value !== 'number') {
    errors.push(`${location} must be a number`);
  } else if (schema.type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${location} must be an integer`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${location} must be a boolean`);
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${location} must be at least ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${location} must be at most ${schema.maximum}`);
  }
  return errors;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error('Request body is too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function cvDesiredConcurrency(state = readState()) {
  return Math.max(1, Math.min(serviceConcurrencyCap, Number(state.concurrency || 1)));
}

function statusPayload() {
  const state = readState();
  const selected = engineSettings(state);
  const cvLocalEligible = ENGINE_IDS.includes(selected.id);
  const scheduler = inferenceScheduler.snapshot(recruiterActivities);
  return {
    service: 'seemplify-local-cv-llm',
    state,
    engine: selected.id,
    model: selected.model,
    provider: `local-${selected.id}`,
    providerLabel: localProviderLabel(`local-${selected.id}`, selected.model),
    executionMode: executionModeForEngine(selected.id),
    applicationDefaults: state.applicationDefaults,
    runtimeProfiles: RUNTIME_PROFILE_IDS.map((id) => {
      const profileState = stateForRuntimeProfile(state, id);
      const profileEngine = engineSettings(profileState);
      return {
        id,
        engine: profileEngine.id,
        model: profileEngine.model,
        provider: `local-${profileEngine.id}`,
        executionMode: executionModeForEngine(profileEngine.id)
      };
    }),
    cvLocalEligible,
    engines: Object.entries(state.engines || {}).map(([id, value]) => ({
      id,
      label: ENGINE_DEFAULTS[id]?.label || id,
      model: value.model,
      selected: id === selected.id
    })),
    active: scheduler.active,
    waiting: scheduler.waiting,
    activityQueues: scheduler.activityQueues,
    completed,
    failed,
    averageLatencyMs: completed ? Math.round(totalLatencyMs / completed) : 0,
    lastRequestAt,
    queue: queueTelemetry,
    usageMetering: {
      owner: 'local-runtime',
      ...telemetryStore.status(),
      mirror: process.env.LOCAL_LLM_MIRROR_USAGE_TO_RECRUITER === 'true'
        ? usageMeteringOutbox.status()
        : { enabled: false }
    },
    executionReceipts: executionReceiptStore.status(),
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime())
  };
}

function gatewayExecutionId(eventId) {
  return `localexec_${crypto.createHash('sha256').update(String(eventId)).digest('hex').slice(0, 48)}`;
}

function meteringContext(input = {}, requestSource = '') {
  const metering = input.metering;
  if (metering?.record === false) {
    if (
      metering.exclusion !== 'harness'
      || !meteringExcludedHarnessSources.has(requestSource)
    ) {
      throw Object.assign(new Error('The local metering exclusion is not recognized'), {
        code: 'INVALID_METERING_EXCLUSION',
        status: 400
      });
    }
    return null;
  }
  if (!metering) {
    throw Object.assign(new Error('A durable local metering context is required'), {
      code: 'METERING_CONTEXT_REQUIRED',
      status: 400
    });
  }
  if (metering.record !== true || !/^usage_[a-f0-9]{48}$/.test(String(metering.eventId || ''))) {
    throw Object.assign(new Error('The local metering context is invalid'), {
      code: 'INVALID_METERING_CONTEXT',
      status: 400
    });
  }
  const expectedExecutionId = gatewayExecutionId(metering.eventId);
  if (String(metering.gatewayExecutionId || '') !== expectedExecutionId) {
    throw Object.assign(new Error('The local metering execution identity is invalid'), {
      code: 'INVALID_METERING_CONTEXT',
      status: 400
    });
  }
  const requestId = String(metering.requestId || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const sourceApp = String(metering.sourceApp || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
  const organizationId = String(metering.organizationId || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  const organizationName = String(metering.organizationName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const actorId = String(metering.actorId || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
  const actorName = String(metering.actorName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const actorEmail = String(metering.actorEmail || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 254);
  if (!requestId || !sourceApp) {
    throw Object.assign(new Error('The local metering request identity is incomplete'), {
      code: 'INVALID_METERING_CONTEXT',
      status: 400
    });
  }
  return {
    eventId: metering.eventId,
    gatewayExecutionId: expectedExecutionId,
    requestId,
    sourceApp,
    organizationId: organizationId || undefined,
    organizationName: organizationName || undefined,
    actorId: actorId || undefined,
    actorName: actorName || undefined,
    actorEmail: actorEmail || undefined
  };
}

function meteredTokenCounts(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.prompt_tokens || usage.input_tokens || 0));
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Number(
      usage.prompt_tokens_details?.cached_tokens
      || usage.input_tokens_details?.cached_tokens
      || usage.cached_input_tokens
      || 0
    ))
  );
  const outputTokens = Math.max(0, Number(usage.completion_tokens || usage.output_tokens || 0));
  const reasoningTokens = Math.min(
    outputTokens,
    Math.max(0, Number(
      usage.completion_tokens_details?.reasoning_tokens
      || usage.output_tokens_details?.reasoning_tokens
      || usage.reasoning_output_tokens
      || 0
    ))
  );
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: Math.max(
      inputTokens + outputTokens,
      Number(usage.total_tokens || usage.totalTokens || 0)
    )
  };
}

function atSourceUsageRecord({
  metering,
  activity,
  engine,
  model,
  provider,
  providerRequestId,
  status,
  httpStatus,
  errorCode,
  latencyMs,
  usage,
  usageReported,
  usageSource,
  estimatedCostUsd,
  occurredAt = new Date().toISOString()
}) {
  if (!metering) return null;
  return {
    ...metering,
    activity,
    // Must match the provider identity in the completion response exactly:
    // the backend's usage reconciliation hashes provider into the event
    // identity, and a divergence poisons every retry of that execution.
    provider: provider || `local-${engine}`,
    model,
    providerRequestId,
    status,
    httpStatus,
    errorCode,
    latencyMs,
    usageReported: usageReported === true,
    usageSource: usageReported === true ? usageSource : 'unreported',
    estimatedCostUsd: Math.max(0, Number(estimatedCostUsd || 0)),
    ...meteredTokenCounts(usage),
    occurredAt
  };
}

async function persistAtSourceUsage(record) {
  if (!record) return;
  await telemetryStore.record(record);
  if (process.env.LOCAL_LLM_MIRROR_USAGE_TO_RECRUITER === 'true') {
    await usageMeteringOutbox.enqueue(record);
  }
}

function normalizeMeteringDurabilityError(error) {
  error.code = error.code === 'LOCAL_USAGE_IDENTITY_CONFLICT'
    ? error.code
    : 'LOCAL_METERING_DURABILITY_FAILED';
  error.status = error.code === 'LOCAL_USAGE_IDENTITY_CONFLICT' ? 409 : 503;
  error.retryable = error.code !== 'LOCAL_USAGE_IDENTITY_CONFLICT';
  return error;
}

async function ensurePreparedUsageIsDurable(prepared) {
  try {
    await persistAtSourceUsage(prepared?.usageRecord);
  } catch (error) {
    throw normalizeMeteringDurabilityError(error);
  }
}

// Codex subject control plane. Subject identity, the source-app allowlist, and
// claim validation live in codex-session-manager.cjs so they stay testable
// without booting this server.
const codexLoginLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: Number(process.env.CODEX_LOGIN_WINDOW_MS || 10 * 60_000),
  requests: Number(process.env.CODEX_LOGIN_REQUESTS || 5),
  maxKeys: 5_000
});
const codexLoginResetLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: Number(process.env.CODEX_LOGIN_RESET_WINDOW_MS || 10 * 60_000),
  requests: Number(process.env.CODEX_LOGIN_RESET_REQUESTS || 3),
  maxKeys: 5_000
});

/** "4 minutes" reads better than "247 seconds" in a message a person sees. */
function formatWait(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function codexSubjectFromBody(rawBody) {
  let input;
  try { input = JSON.parse(rawBody || '{}'); }
  catch { return { error: { status: 400, code: 'INVALID_JSON' } }; }
  return { ...codexSessions.resolveSubjectRequest(input), input };
}

async function handleCodexControl(request, response, rawBody, operation, requestPath) {
  if (!withinRateLimit(request)) {
    return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  }
  const verified = await verifySignature(request.headers, request.method, requestPath, rawBody, request);
  if (!verified.ok) return sendJson(response, 401, { code: verified.code, message: 'Request authentication failed' });
  if (!codexSessions.perUserSessionsEnabled()) {
    return sendJson(response, 503, {
      code: 'CODEX_PER_USER_DISABLED',
      message: 'Per-user Codex sessions are not enabled on this gateway host'
    });
  }
  const resolved = codexSubjectFromBody(rawBody);
  if (resolved.error) return sendJson(response, resolved.error.status, { code: resolved.error.code });
  const authorized = authorizeVerifiedService(verified, {
    requestPath,
    codexSource: resolved.input?.sourceApp
  });
  if (!authorized.ok) {
    return sendJson(response, 403, { code: authorized.code, message: 'Service is not authorized for this request' });
  }
  const { subjectKey } = resolved;
  // Device logins are the expensive, abusable operation. Reserve an attempt
  // before starting, then refund it when OpenAI/Codex itself fails or when the
  // request merely resumes an existing code. A provider failure must never use
  // up every recovery attempt for a real person.
  const resumingLogin = operation === 'login/start'
    && codexSessions.hasPendingDeviceLogin(subjectKey);
  const reservedLoginAttempt = operation === 'login/start' && !resumingLogin
    ? codexLoginLimiter.consume(subjectKey)
    : false;
  if (operation === 'login/start' && !resumingLogin && !reservedLoginAttempt) {
    // Being turned away with no idea when to try again is a dead end, so the
    // wait is part of the answer rather than something the caller must guess.
    const retryAfterSeconds = Math.max(1, Math.ceil(codexLoginLimiter.retryAfterMs(subjectKey) / 1000));
    return sendJson(response, 429, {
      code: 'CODEX_LOGIN_RATE_LIMITED',
      message: `Too many ChatGPT sign-in attempts. Try again in ${formatWait(retryAfterSeconds)}.`,
      retryAfterSeconds,
      retryable: true
    }, { 'retry-after': String(retryAfterSeconds) });
  }
  if (operation === 'login/reset' && !codexLoginResetLimiter.consume(subjectKey)) {
    return sendJson(response, 429, {
      code: 'CODEX_LOGIN_RESET_RATE_LIMITED',
      message: 'The ChatGPT sign-in was reset too many times. Please wait before resetting it again.',
      retryAfterSeconds: Math.max(1, Math.ceil(codexLoginResetLimiter.retryAfterMs(subjectKey) / 1000)),
      retryable: true
    });
  }
  try {
    if (operation === 'login/start') {
      const login = await codexSessions.startDeviceLogin(subjectKey);
      if (login.connected || login.resumed) codexLoginLimiter.refund(subjectKey);
      return sendJson(response, 200, login);
    }
    if (operation === 'login/cancel') return sendJson(response, 200, await codexSessions.cancelDeviceLogin(subjectKey));
    if (operation === 'login/reset') {
      const reset = await codexSessions.resetDeviceLogin(subjectKey);
      codexLoginLimiter.reset(subjectKey);
      return sendJson(response, 200, reset);
    }
    if (operation === 'account') return sendJson(response, 200, await codexSessions.accountStatusForSubject(subjectKey));
    if (operation === 'models') {
      return sendJson(response, 200, { models: await codexSessions.modelsForSubject(subjectKey) });
    }
    if (operation === 'logout') return sendJson(response, 200, await codexSessions.forgetSubject(subjectKey));
    return sendJson(response, 404, { code: 'CODEX_OPERATION_UNKNOWN' });
  } catch (error) {
    if (reservedLoginAttempt) codexLoginLimiter.refund(subjectKey);
    const code = error.code || 'CODEX_CONTROL_FAILED';
    const status = code === 'CODEX_NOT_INSTALLED' ? 503
      : code === 'CODEX_LOGIN_PENDING' ? 409
      : code === 'CODEX_SESSIONS_EXHAUSTED' ? 503 : 502;
    return sendJson(response, status, { code, message: error.message, retryable: status === 503 });
  }
}

async function handleCompletion(request, response, rawBody, { cvOnly = false } = {}) {
  if (!withinRateLimit(request)) {
    return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  }
  const requestPath = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`).pathname;
  const verified = await verifySignature(request.headers, request.method, requestPath, rawBody, request);
  if (!verified.ok) return sendJson(response, 401, { code: verified.code, message: 'Request authentication failed' });
  const state = readState();
  if (!state.ingressEnabled || !state.enabled) {
    return sendJson(response, 503, { code: 'LOCAL_LLM_DISABLED', retryable: true });
  }
  if (state.paused) {
    return sendJson(response, 503, { code: 'LOCAL_LLM_PAUSED', retryable: true });
  }
  let input;
  try { input = JSON.parse(rawBody); } catch { return sendJson(response, 400, { code: 'INVALID_JSON' }); }
  if (!isAllowedActivity(input.activity)) {
    return sendJson(response, 403, { code: 'ACTIVITY_NOT_ALLOWED' });
  }
  if (cvOnly && !cvActivities.has(input.activity)) {
    return sendJson(response, 403, { code: 'CV_ACTIVITY_REQUIRED' });
  }
  if (!Array.isArray(input.messages) || !input.messages.length) {
    return sendJson(response, 400, { code: 'INVALID_AI_REQUEST' });
  }
  if (input.jsonSchema !== undefined && (!input.jsonSchema || typeof input.jsonSchema !== 'object')) {
    return sendJson(response, 400, { code: 'INVALID_JSON_SCHEMA' });
  }
  if (cvOnly && typeof input.jsonSchema !== 'object') {
    return sendJson(response, 400, { code: 'INVALID_CV_REQUEST' });
  }
  if (cvOnly && !requiredCvFields.every((field) => input.jsonSchema.required?.includes(field))) {
    return sendJson(response, 400, { code: 'INVALID_CV_SCHEMA' });
  }
  if (!cvOnly && input.executionMode !== 'local-only') {
    return sendJson(response, 400, { code: 'LOCAL_ONLY_MODE_REQUIRED' });
  }
  const requestSource = String(input.requestSource || (cvOnly ? 'cv-route' : 'local-route'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 64);
  const authorized = authorizeVerifiedService(verified, {
    requestPath,
    activity: input.activity,
    requestSource,
    meteringSource: input.metering?.record === true ? input.metering?.sourceApp : null,
    codexSource: input.codexSourceApp
  });
  if (!authorized.ok) {
    return sendJson(response, 403, {
      code: authorized.code,
      message: 'Service is not authorized for this activity or identity namespace'
    });
  }
  // A subject key is always derived here, never accepted from the body. A
  // caller able to supply one directly could address any session on the host.
  delete input.codexSubject;
  if (input.codexSubjectId !== undefined) {
    if (!codexSessions.perUserSessionsEnabled()) {
      return sendJson(response, 503, { code: 'CODEX_PER_USER_DISABLED', retryable: true });
    }
    const resolvedSubject = codexSessions.resolveSubjectRequest({
      sourceApp: input.codexSourceApp, subjectId: input.codexSubjectId
    });
    if (resolvedSubject.error) {
      return sendJson(response, resolvedSubject.error.status, { code: resolvedSubject.error.code });
    }
    if (String(input.requiredEngine || '').trim().toLowerCase() !== 'codex') {
      return sendJson(response, 400, {
        code: 'CODEX_SUBJECT_ENGINE_MISMATCH',
        message: 'A per-user Codex subject may only be used with the codex engine'
      });
    }
    input.codexSubject = resolvedSubject.subjectKey;
  }
  let metering;
  try {
    metering = meteringContext(input, requestSource);
  } catch (error) {
    return sendJson(response, error.status || 400, { code: error.code, message: error.message });
  }
  const requestedRuntimeProfile = String(input.runtimeProfile || '').trim().toLowerCase();
  if (requestedRuntimeProfile && !isRuntimeProfile(requestedRuntimeProfile)) {
    return sendJson(response, 400, { code: 'INVALID_RUNTIME_PROFILE' });
  }
  const activityRuntimeProfile = runtimeProfileForActivity(input.activity);
  if (
    requestedRuntimeProfile
    && requestedRuntimeProfile !== activityRuntimeProfile
  ) {
    return sendJson(response, 400, {
      code: 'RUNTIME_PROFILE_ACTIVITY_MISMATCH',
      message: 'The requested runtime profile does not govern this activity'
    });
  }
  const runtimeProfile = requestedRuntimeProfile || activityRuntimeProfile;
  const executionState = stateForRuntimeProfile(state, runtimeProfile);
  const selected = engineSettings(executionState);
  if (input.executionMode === 'local-only' && !ENGINE_IDS.includes(selected.id)) {
    return sendJson(response, 503, {
      code: 'LOCAL_ENGINE_REQUIRED',
      retryable: true,
      message: `Local inference requires a managed local or local-cloud engine; ${selected.id} is unavailable`
    });
  }
  const requiredEngine = String(input.requiredEngine || '').trim().toLowerCase();
  const requiredModel = String(input.requiredModel || '').trim();
  if (requiredEngine && !ENGINE_IDS.includes(requiredEngine)) {
    return sendJson(response, 400, { code: 'INVALID_REQUIRED_ENGINE' });
  }
  if (requiredModel.length > 200 || /[\u0000-\u001f\u007f]/.test(requiredModel)) {
    return sendJson(response, 400, { code: 'INVALID_REQUIRED_MODEL' });
  }
  // A per-user Codex subject runs on the caller's own session, never the
  // managed engine slot, so the administrator's engine selection cannot gate
  // it: the request is pinned to the codex engine by construction.
  const engineMismatch = !input.codexSubject && requiredEngine && selected.id !== requiredEngine;
  const modelMismatch = !input.codexSubject && requiredModel
    && String(selected.model || '').trim().toLowerCase() !== requiredModel.toLowerCase();
  if (engineMismatch || modelMismatch) {
    return sendJson(response, 503, {
      code: 'REQUIRED_RUNTIME_UNAVAILABLE',
      retryable: true,
      message: 'The runtime required by this activity is not currently selected',
      required: { engine: requiredEngine || null, model: requiredModel || null },
      active: { engine: selected.id, model: selected.model }
    });
  }
  const requestController = new AbortController();
  const abortRequest = () => requestController.abort(new Error('Inference caller disconnected'));
  const abortIncompleteRequest = () => { if (!request.complete) abortRequest(); };
  const abortIncompleteResponse = () => { if (!response.writableEnded) abortRequest(); };
  request.once('aborted', abortRequest);
  request.once('close', abortIncompleteRequest);
  response.once('close', abortIncompleteResponse);
  const requestFingerprint = metering ? canonicalRequestFingerprint({
    method: 'POST',
    path: requestPath,
    body: {
      ...input,
      requestSource,
      runtimeProfile: runtimeProfile || undefined,
      metering: { record: true, ...metering }
    }
  }) : null;
  let executionLease = null;
  let heartbeatTimer = null;
  let executionController = null;
  let permit = null;
  let receiptPrepared = false;
  let providerOutcomeMustNotRepeat = false;
  let startedAt = Date.now();
  let executionStatus = 'failed';
  let executionPlan;
  try {
    executionPlan = resolveExecutionPolicy({
      ...input,
      requestSource,
      runtimeProfile: runtimeProfile || undefined
    });
    const requestedTimeoutMs = Number(input.timeoutMs);
    const effectiveTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? Math.min(executionPlan.timeoutMs, Math.max(10_000, requestedTimeoutMs))
      : executionPlan.timeoutMs;
    if (metering) {
      const acquisition = await executionReceiptStore.acquire({
        executionId: metering.gatewayExecutionId,
        requestFingerprint,
        signal: requestController.signal
      });
      if (acquisition.action === 'replay') {
        // The outbox deletes delivered files. Re-enqueueing the exact event on
        // every replay makes a completed receipt self-healing after a crash or
        // manual outbox loss; the hosted usage endpoint is event-idempotent.
        await ensurePreparedUsageIsDurable(acquisition.prepared);
        log('info', 'Local AI completion replayed from its durable receipt', {
          activity: input.activity,
          requestSource,
          runtimeProfile: runtimeProfile || undefined,
          endpoint: cvOnly ? 'cv' : 'general',
          gatewayExecutionId: metering.gatewayExecutionId
        });
        return sendJson(response, acquisition.prepared.response.status, acquisition.prepared.response.payload);
      }
      executionLease = acquisition;
      const heartbeatLease = acquisition;
      heartbeatTimer = setInterval(() => {
        void executionReceiptStore.heartbeat(heartbeatLease).catch((error) => {
          log('error', 'Local execution receipt heartbeat failed', {
            gatewayExecutionId: metering.gatewayExecutionId,
            error: error.message
          });
        });
      }, Math.max(50, Math.floor(executionReceiptStore.leaseMs / 3)));
      heartbeatTimer.unref?.();
      if (acquisition.action === 'recover') {
        receiptPrepared = true;
        try {
          await ensurePreparedUsageIsDurable(acquisition.prepared);
          await executionReceiptStore.complete(executionLease);
        } catch (error) {
          throw normalizeMeteringDurabilityError(error);
        }
        executionLease = null;
        log('info', 'Local AI completion recovered before provider dispatch', {
          activity: input.activity,
          requestSource,
          runtimeProfile: runtimeProfile || undefined,
          endpoint: cvOnly ? 'cv' : 'general',
          gatewayExecutionId: metering.gatewayExecutionId
        });
        return sendJson(response, acquisition.prepared.response.status, acquisition.prepared.response.payload);
      }
      // Once an execution identity is durably reserved, finish it even if the
      // initiating HTTP client disconnects. A later caller can replay the
      // encrypted receipt instead of paying for another inference.
      executionController = new AbortController();
    } else {
      executionController = requestController;
    }
    activeControllers.add(executionController);
    permit = await inferenceScheduler.acquire(input.activity, { signal: executionController.signal });
    lastRequestAt = new Date().toISOString();
    let providerDispatched = false;
    const data = await analyzeWithEngine({
      ...input,
      executionPlan,
      reasoningEffort: executionPlan.reasoningEffort,
      maxTokens: executionPlan.maxTokens,
      timeoutMs: effectiveTimeoutMs,
      signal: executionController.signal,
      onProviderDispatch: async () => {
        if (providerDispatched) return;
        // This callback runs immediately before fetch/spawn in every adapter.
        // Preflight failures remain retryable; once it returns, the outcome is
        // at-most-once and must be durably replayed or fail closed.
        if (executionLease) await executionReceiptStore.markStarted(executionLease);
        providerDispatched = true;
        providerOutcomeMustNotRepeat = true;
        startedAt = Date.now();
      }
    }, input.codexSubject ? { ...executionState, selectedEngine: 'codex' } : executionState);
    const schemaErrors = input.jsonSchema ? validateSchemaValue(data.data, input.jsonSchema) : [];
    if (schemaErrors.length) {
      const error = new Error(`Inference engine returned invalid structured data: ${schemaErrors.slice(0, 5).join('; ')}`);
      error.code = 'LOCAL_LLM_SCHEMA_INVALID';
      error.usageEnvelope = {
        id: data.id,
        engine: data.engine,
        model: data.model,
        usage: data.usage,
        usageReported: data.usageReported === true
      };
      throw error;
    }
    const latencyMs = Date.now() - startedAt;
    const {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens
    } = meteredTokenCounts(data.usage);
    const responseId = data.id || crypto.randomUUID();
    // A user-owned turn ran on the caller's connected ChatGPT account, not a
    // managed local engine; the provider identity must say so.
    const provider = data.runtimeOwner === 'user' ? 'chatgpt-codex' : `local-${data.engine}`;
    const providerLabel = data.runtimeOwner === 'user'
      ? `ChatGPT Codex (${data.model})`
      : localProviderLabel(provider, data.model);
    const usageRecord = atSourceUsageRecord({
      metering,
      activity: input.activity,
      engine: data.engine,
      model: data.model,
      provider,
      providerRequestId: responseId,
      status: 'success',
      httpStatus: 200,
      latencyMs,
      usage: data.usage,
      usageReported: data.usageReported,
      usageSource: data.usageReported === true ? `${data.engine}-response` : 'unreported',
      estimatedCostUsd: data.estimatedCostUsd
    });
    const responsePayload = {
      id: responseId,
      provider,
      providerLabel,
      engine: data.engine,
      model: data.model,
      runtimeOwner: data.runtimeOwner || undefined,
      planType: data.planType || undefined,
      modelSource: data.modelSource || undefined,
      reasoningEffortSource: data.reasoningEffortSource || undefined,
      degraded: data.degraded === true ? true : undefined,
      runtimeProfile: runtimeProfile || undefined,
      gatewayExecutionId: metering?.gatewayExecutionId,
      content: data.content,
      data: data.data,
      toolCalls: data.toolCalls || [],
      finishReason: data.finishReason || (data.toolCalls?.length ? 'tool_calls' : 'stop'),
      usage: data.usage,
      usageReported: data.usageReported === true,
      usageSource: data.usageReported === true ? `${data.engine}-response` : 'unreported',
      estimatedCostUsd: data.estimatedCostUsd,
      metrics: {
        ...(data.metrics || {}),
        executionPolicy: executionPolicyTelemetry(executionPlan),
        queueWaitMs: permit.waitMs,
        latencyMs
      }
    };
    if (executionLease) {
      try {
        await executionReceiptStore.prepare({
          ...executionLease,
          prepared: {
            response: { status: 200, payload: responsePayload },
            usageRecord
          }
        });
        receiptPrepared = true;
      } catch (error) {
        error.usageEnvelope = {
          id: responseId,
          engine: data.engine,
          model: data.model,
          usage: data.usage,
          usageReported: data.usageReported === true
        };
        throw error;
      }
    }
    try {
      await persistAtSourceUsage(usageRecord);
      if (executionLease) {
        await executionReceiptStore.complete(executionLease);
        executionLease = null;
      }
    } catch (meteringError) {
      meteringError.code = 'LOCAL_METERING_DURABILITY_FAILED';
      meteringError.status = 503;
      meteringError.retryable = true;
      meteringError.receiptPrepared = receiptPrepared;
      throw meteringError;
    }
    completed += 1;
    totalLatencyMs += latencyMs;
    executionStatus = 'completed';
    log('info', 'Local AI completion finished', {
      activity: input.activity,
      requestSource,
      runtimeProfile: runtimeProfile || undefined,
      endpoint: cvOnly ? 'cv' : 'general',
      queueWaitMs: permit.waitMs,
      latencyMs,
      engine: data.engine,
      model: data.model,
      gatewayExecutionId: metering?.gatewayExecutionId,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      workload: executionPlan.workload,
      workloadConfidence: executionPlan.confidence,
      workloadFallback: executionPlan.fallback,
      maxTurns: executionPlan.maxTurns
    });
    return sendJson(response, 200, responsePayload);
  } catch (error) {
    const usageEnvelope = error.usageEnvelope;
    let responseError = error;
    const failurePayload = (failure, retryable, envelope = usageEnvelope) => ({
      code: failure.code || 'LOCAL_LLM_UNAVAILABLE',
      message: failure.message,
      retryable,
      gatewayExecutionId: metering?.gatewayExecutionId,
      ...(executionPlan ? { metrics: { executionPolicy: executionPolicyTelemetry(executionPlan) } } : {}),
      ...(envelope ? {
        id: envelope.id,
        provider: `local-${envelope.engine || selected.id}`,
        providerLabel: localProviderLabel(
          `local-${envelope.engine || selected.id}`,
          envelope.model || selected.model
        ),
        engine: envelope.engine,
        model: envelope.model,
        usage: envelope.usage,
        usageReported: envelope.usageReported === true,
        usageSource: envelope.usageReported === true
          ? `${envelope.engine}-response`
          : 'unreported'
      } : {})
    });
    let responsePayload = failurePayload(error, error.retryable !== false);
    if (providerOutcomeMustNotRepeat && metering && executionLease && !receiptPrepared) {
      const terminalUsageEnvelope = {
        id: usageEnvelope?.id || metering.gatewayExecutionId,
        // A per-user turn never ran on the managed engine, so a failure must
        // not be audited against it: that reads as a fallback that never
        // happened. The subject pins the engine regardless of the selection.
        engine: usageEnvelope?.engine || (input.codexSubject ? 'codex' : selected.id),
        model: usageEnvelope?.model || selected.model,
        usage: usageEnvelope?.usage || {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 0
        },
        usageReported: usageEnvelope?.usageReported === true
      };
      const terminalUsageRecord = atSourceUsageRecord({
        metering,
        activity: input.activity,
        engine: terminalUsageEnvelope.engine,
        model: terminalUsageEnvelope.model,
        provider: input.codexSubject ? 'chatgpt-codex' : undefined,
        providerRequestId: terminalUsageEnvelope.id,
        status: 'failed',
        httpStatus: error.status || 503,
        errorCode: error.code || 'LOCAL_LLM_UNAVAILABLE',
        latencyMs: Date.now() - startedAt,
        usage: terminalUsageEnvelope.usage,
        usageReported: terminalUsageEnvelope.usageReported,
        usageSource: terminalUsageEnvelope.usageReported === true
          ? `${terminalUsageEnvelope.engine}-response`
          : 'unreported'
      });
      const terminalPayload = failurePayload(error, false, terminalUsageEnvelope);
      try {
        await executionReceiptStore.prepare({
          ...executionLease,
          prepared: {
            response: { status: error.status || 503, payload: terminalPayload },
            usageRecord: terminalUsageRecord
          }
        });
        receiptPrepared = true;
        await persistAtSourceUsage(terminalUsageRecord);
        await executionReceiptStore.complete(executionLease);
        executionLease = null;
        error.retryable = false;
        responsePayload = terminalPayload;
      } catch (durabilityError) {
        normalizeMeteringDurabilityError(durabilityError);
        durabilityError.receiptPrepared = receiptPrepared;
        responseError = durabilityError;
        responsePayload = failurePayload(durabilityError, durabilityError.retryable, null);
      }
    } else if (usageEnvelope && metering && !receiptPrepared) {
      try {
        await persistAtSourceUsage(atSourceUsageRecord({
          metering,
          activity: input.activity,
          engine: usageEnvelope.engine || (input.codexSubject ? 'codex' : selected.id),
          model: usageEnvelope.model || selected.model,
          provider: input.codexSubject ? 'chatgpt-codex' : undefined,
          providerRequestId: usageEnvelope.id,
          status: 'failed',
          httpStatus: error.status || 503,
          errorCode: error.code || 'LOCAL_LLM_UNAVAILABLE',
          latencyMs: Date.now() - startedAt,
          usage: usageEnvelope.usage,
          usageReported: usageEnvelope.usageReported,
          usageSource: usageEnvelope.usageReported === true
            ? `${usageEnvelope.engine || selected.id}-response`
            : 'unreported'
        }));
      } catch (meteringError) {
        log('error', 'Local usage event could not be persisted to the durable outbox', {
          eventId: metering.eventId,
          error: meteringError.message
        });
      }
    }
    if (permit || receiptPrepared) failed += 1;
    log('error', 'Local AI completion failed', {
      activity: input.activity,
      requestSource,
      endpoint: cvOnly ? 'cv' : 'general',
      latencyMs: Date.now() - startedAt,
      engine: selected.id,
      model: selected.model,
      errorCode: responseError.code || 'LOCAL_LLM_UNAVAILABLE',
      error: responseError.message,
      workload: executionPlan?.workload,
      workloadConfidence: executionPlan?.confidence,
      workloadFallback: executionPlan?.fallback,
      maxTurns: executionPlan?.maxTurns
    });
    return sendJson(response, responseError.status || 503, responsePayload);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (executionLease) {
      try {
        if (providerOutcomeMustNotRepeat && !receiptPrepared) {
          await executionReceiptStore.forfeitAmbiguous(executionLease);
        } else {
          await executionReceiptStore.release(executionLease);
        }
      } catch (error) {
        log('error', 'Local execution receipt could not release its lease', {
          gatewayExecutionId: metering?.gatewayExecutionId,
          error: error.message
        });
      }
    }
    if (executionController) activeControllers.delete(executionController);
    request.removeListener('aborted', abortRequest);
    request.removeListener('close', abortIncompleteRequest);
    response.removeListener('close', abortIncompleteResponse);
    permit?.release({
      status: executionStatus,
      latencyMs: Date.now() - startedAt
    });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    const publicRequest = isPublicRequest(request);
    if (publicRequest && !publicHealthLimiter.consume(rateLimitKey(request))) {
      return sendJson(
        response,
        429,
        { ok: false, code: 'HEALTH_RATE_LIMITED' },
        { 'retry-after': String(Math.max(1, Math.ceil(publicHealthRateLimitWindowMs / 1000))) }
      );
    }
    const health = await engineHealth(readState());
    if (publicRequest) {
      return sendJson(response, health.ok ? 200 : 503, {
        ok: health.ok,
        service: 'seemplify-local-cv-llm'
      });
    }
    return sendJson(response, health.ok ? 200 : 503, {
      ok: health.ok,
      service: 'seemplify-local-cv-llm',
      engine: health
    });
  }
  if (request.method === 'GET' && url.pathname === '/control/status') {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    return sendJson(response, 200, statusPayload());
  }
  if (request.method === 'GET' && url.pathname === '/control/queue-history') {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      const history = await fetchQueueHistory(url);
      return sendJson(response, history.status, history.payload);
    } catch (error) {
      return sendJson(response, 503, { code: 'CV_HISTORY_UNAVAILABLE', message: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/control/provider-telemetry') {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      const telemetry = await fetchProviderTelemetry();
      return sendJson(response, telemetry.status, telemetry.payload);
    } catch (error) {
      return sendJson(response, 503, { code: 'PROVIDER_TELEMETRY_UNAVAILABLE', message: error.message });
    }
  }
  const queueRetryMatch = request.method === 'POST'
    && url.pathname.match(/^\/control\/queue-retry\/(cv_[A-Za-z0-9_-]{8,100})$/);
  if (queueRetryMatch) {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      const input = JSON.parse(await readBody(request) || '{}');
      const result = await retryQueueJob(queueRetryMatch[1], input.stage);
      return sendJson(response, result.status, result.payload);
    } catch (error) {
      return sendJson(response, 503, { code: 'CV_RETRY_UNAVAILABLE', message: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/control/activity-analytics') {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      return sendJson(response, 200, telemetryStore.analytics(url.searchParams.get('range') || '24h'));
    } catch (error) {
      return sendJson(response, 503, { code: 'AI_ACTIVITY_ANALYTICS_UNAVAILABLE', message: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/control/activity-history') {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      return sendJson(response, 200, telemetryStore.activityHistory(Object.fromEntries(url.searchParams.entries())));
    } catch (error) {
      return sendJson(response, 503, { code: 'AI_ACTIVITY_HISTORY_UNAVAILABLE', message: error.message });
    }
  }
  const activityDetailMatch = request.method === 'GET'
    && url.pathname.match(/^\/control\/activity-history\/([a-f\d]{24})$/i);
  if (activityDetailMatch) {
    if (!isLocalControlRequest(request)) return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    try {
      const item = telemetryStore.detail(activityDetailMatch[1]);
      return item
        ? sendJson(response, 200, item)
        : sendJson(response, 404, { code: 'AI_ACTIVITY_NOT_FOUND', message: 'AI activity was not found' });
    } catch (error) {
      return sendJson(response, 503, { code: 'AI_ACTIVITY_DETAIL_UNAVAILABLE', message: error.message });
    }
  }
  if (request.method === 'PUT' && url.pathname === '/control/state') {
    if (!isLocalControlRequest(request)) {
      return sendJson(response, 403, { code: 'LOCAL_CONTROL_ONLY' });
    }
    try {
      const input = JSON.parse(await readBody(request));
      const allowed = {};
      for (const key of ['enabled', 'ingressEnabled', 'paused', 'autoStart']) {
        if (typeof input[key] === 'boolean') allowed[key] = input[key];
      }
      if (input.selectionMode !== undefined) {
        if (!['automatic', 'manual'].includes(input.selectionMode)) throw new Error('Unsupported selection mode');
        allowed.selectionMode = input.selectionMode;
      }
      let requestedConcurrency = null;
      if (input.concurrency !== undefined) {
        requestedConcurrency = Number(input.concurrency);
        if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > serviceConcurrencyCap) {
          const error = new Error(`Concurrency must be an integer from 1 to ${serviceConcurrencyCap}`);
          error.code = 'INVALID_CONCURRENCY';
          error.status = 400;
          throw error;
        }
      }
      if (input.selectedEngine !== undefined) {
        if (!ENGINE_IDS.includes(input.selectedEngine)) throw new Error(`Unsupported engine ${input.selectedEngine}`);
        allowed.selectedEngine = input.selectedEngine;
      }
      if (input.engines && typeof input.engines === 'object') {
        allowed.engines = { ...readState().engines };
        for (const id of ENGINE_IDS) {
          if (!input.engines[id]) continue;
          const modelValue = String(input.engines[id].model || '').trim();
          if (!/^[A-Za-z0-9._:/-]{2,200}$/.test(modelValue)) throw new Error(`Invalid ${id} model identifier`);
          allowed.engines[id] = { ...allowed.engines[id], model: modelValue };
        }
      }
      if (input.applicationDefaults && typeof input.applicationDefaults === 'object') {
        const knownApplicationDefaultKeys = new Set(RUNTIME_PROFILE_IDS.map((id) => (
          RUNTIME_PROFILE_DEFINITIONS[id].stateKey
        )));
        const unknownApplicationDefaultKey = Object.keys(input.applicationDefaults).find((key) => (
          !knownApplicationDefaultKeys.has(key)
        ));
        if (unknownApplicationDefaultKey) {
          const error = new Error(`Unsupported runtime profile ${unknownApplicationDefaultKey}`);
          error.code = 'INVALID_RUNTIME_PROFILE';
          error.status = 400;
          throw error;
        }
        const currentApplicationDefaults = readState().applicationDefaults;
        const nextApplicationDefaults = { ...currentApplicationDefaults };
        let applicationDefaultChanged = false;
        for (const id of RUNTIME_PROFILE_IDS) {
          const definition = RUNTIME_PROFILE_DEFINITIONS[id];
          const requested = input.applicationDefaults[definition.stateKey];
          if (requested === undefined) continue;
          const engine = String(requested?.engine || '').trim().toLowerCase();
          const model = String(requested?.model || '').trim();
          if (!ENGINE_IDS.includes(engine)) throw new Error(`Unsupported ${id} engine`);
          if (!/^[A-Za-z0-9._:/-]{2,200}$/.test(model)) throw new Error(`Invalid ${id} model identifier`);
          nextApplicationDefaults[definition.stateKey] = { engine, model };
          applicationDefaultChanged = true;
        }
        if (applicationDefaultChanged) allowed.applicationDefaults = nextApplicationDefaults;
      }
      if (requestedConcurrency !== null) {
        allowed.concurrency = normalizeConcurrency(requestedConcurrency);
      }
      const before = readState();
      const state = writeState(allowed);
      inferenceScheduler.notifyLimitsChanged();
      await log('info', 'Local AI control state changed', {
        action: 'control_state_updated',
        changes: controlStateChanges(before, state, allowed)
      });
      return sendJson(response, 200, { ok: true, state });
    } catch (error) {
      await log('warn', 'Local AI control state change rejected', {
        action: 'control_state_rejected',
        errorCode: error.code || 'INVALID_STATE',
        error: String(error.message || error).slice(0, 300)
      });
      return sendJson(response, error.status || 400, {
        code: error.code || 'INVALID_STATE',
        message: error.message,
        ...(error.details ? { concurrency: error.details } : {})
      });
    }
  }
  const codexControlOperation = request.method === 'POST' && url.pathname.startsWith('/v1/codex/')
    ? url.pathname.slice('/v1/codex/'.length)
    : '';
  if (codexControlOperation) {
    try {
      return await handleCodexControl(
        request, response, await readBody(request), codexControlOperation, url.pathname
      );
    } catch (error) {
      return sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { code: error.code || 'GATEWAY_ERROR' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/v1/cv/analyze') {
    try {
      return await handleCompletion(request, response, await readBody(request), { cvOnly: true });
    } catch (error) {
      return sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { code: error.code || 'GATEWAY_ERROR' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/v1/complete') {
    try {
      return await handleCompletion(request, response, await readBody(request));
    } catch (error) {
      return sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { code: error.code || 'GATEWAY_ERROR' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/v1/status') {
    try {
      if (!withinRateLimit(request)) {
        return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
      }
      const rawBody = await readBody(request);
      const verified = await verifySignature(request.headers, request.method, url.pathname, rawBody, request);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const input = JSON.parse(rawBody || '{}');
      const authorized = authorizeVerifiedService(verified, { requestPath: url.pathname });
      if (!authorized.ok) return sendJson(response, 403, { code: authorized.code });
      const runtimeProfile = runtimeProfileFromStatusInput(input);
      if (runtimeProfile && !isRuntimeProfile(runtimeProfile)) {
        return sendJson(response, 400, { code: 'INVALID_RUNTIME_PROFILE' });
      }
      const state = readState();
      const executionState = stateForRuntimeProfile(state, runtimeProfile);
      const selected = engineSettings(executionState);
      const health = await engineHealth(executionState);
      return sendJson(response, 200, {
        ...statusPayload(),
        ...(runtimeProfile ? {
          runtimeProfile,
          engine: selected.id,
          model: selected.model,
          provider: `local-${selected.id}`,
          providerLabel: localProviderLabel(`local-${selected.id}`, selected.model),
          executionMode: executionModeForEngine(selected.id)
        } : {}),
        health
      });
    } catch (error) {
      return sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { code: error.code || 'GATEWAY_ERROR' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/v1/queue-telemetry') {
    try {
      if (!withinRateLimit(request)) {
        return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
      }
      const rawBody = await readBody(request);
      const verified = await verifySignature(request.headers, request.method, url.pathname, rawBody, request);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const authorized = authorizeVerifiedService(verified, { requestPath: url.pathname });
      if (!authorized.ok) return sendJson(response, 403, { code: authorized.code });
      const input = JSON.parse(rawBody);
      queueTelemetry = normalizeQueueTelemetry(input);
      await telemetryStore.recordQueueSnapshot(queueTelemetry);
      const controlState = readState();
      const desiredConcurrencyByActivity = Object.fromEntries(
        [...cvActivities].map((activity) => [activity, cvDesiredConcurrency(controlState)])
      );
      return sendJson(response, 200, {
        ok: true,
        desiredConcurrency: cvDesiredConcurrency(controlState),
        desiredConcurrencyByActivity,
        desiredPaused: controlState.paused,
        maxQueueDepth: telemetryStore.status().maxQueueJobs
      });
    } catch (error) {
      return sendJson(response, 400, { code: 'INVALID_TELEMETRY', message: error.message });
    }
  }
  return sendJson(response, 404, { code: 'NOT_FOUND' });
});

server.listen(port, host, () => {
  if (process.env.LOCAL_LLM_MIRROR_USAGE_TO_RECRUITER === 'true') usageMeteringOutbox.start();
  void executionReceiptStore.prune({ force: true }).catch((error) => {
    log('error', 'Local execution receipt startup pruning failed', { error: error.message });
  });
  const selected = engineSettings(readState());
  log('info', 'Local CV LLM gateway started', { host, port, engine: selected.id, model: selected.model });
});

function shutdown(signal) {
  shuttingDown = true;
  if (process.env.LOCAL_LLM_MIRROR_USAGE_TO_RECRUITER === 'true') usageMeteringOutbox.stop();
  writeState({ paused: true });
  inferenceScheduler.stop();
  for (const controller of activeControllers) {
    controller.abort(new Error(`Gateway shutdown requested by ${signal}`));
  }
  log('info', 'Gateway shutdown requested', { signal });
  server.close(() => {
    void logWriteChain.finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
