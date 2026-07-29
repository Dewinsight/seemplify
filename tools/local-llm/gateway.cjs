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
const { LocalUsageMeteringOutbox } = require('./usage-metering-outbox.cjs');
const {
  ACTIVITY_DEFINITIONS,
  localProviderLabel
} = require('../../recruiter/backend/config/aiRuntimeCatalog');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(workspaceRoot, '.local-runtime', 'llm');
const secretFile = process.env.LOCAL_LLM_SECRET_FILE || path.join(runtimeDir, 'service-secret');
const controlSecretFile = process.env.LOCAL_LLM_CONTROL_SECRET_FILE || path.join(runtimeDir, 'control-secret');
const stateFile = process.env.LOCAL_LLM_STATE_FILE || path.join(runtimeDir, 'state.json');
const logFile = process.env.LOCAL_LLM_LOG_FILE || path.join(runtimeDir, 'gateway.log');
const nonceDir = process.env.LOCAL_LLM_NONCE_DIR || path.join(path.dirname(stateFile), 'nonces');
const usageOutboxDir = process.env.LOCAL_LLM_USAGE_OUTBOX_DIR || path.join(runtimeDir, 'usage-outbox');
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
const allowedActivities = new Set(Object.keys(ACTIVITY_DEFINITIONS));
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
    applicationDefaults: {
      experienceManagement: { engine: 'codex', model: 'gpt-5.6-terra' }
    },
    engines: Object.fromEntries(Object.entries(ENGINE_DEFAULTS).map(([id, item]) => [
      id,
      { model: item.model, ...(item.baseUrl ? { baseUrl: item.baseUrl } : {}) }
    ]))
  };
}

function applyConcurrencyPolicy(state) {
  const selectedEngine = ENGINE_IDS.includes(state.selectedEngine) ? state.selectedEngine : 'codex';
  const selectedModel = String(
    state.engines?.[selectedEngine]?.model
    || ENGINE_DEFAULTS[selectedEngine]?.model
    || ''
  );
  const decision = concurrencyDecision({
    engine: selectedEngine,
    model: selectedModel,
    requested: state.concurrency
  });
  return {
    ...state,
    concurrency: decision.effectiveConcurrency,
    requestedConcurrency: decision.requestedConcurrency,
    approvedConcurrency: decision.approvedConcurrency,
    concurrencySustainedValidated: decision.sustainedValidated
  };
}

function readStoredState() {
  const defaults = defaultState();
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      ...defaults,
      ...saved,
      applicationDefaults: {
        ...defaults.applicationDefaults,
        ...(saved.applicationDefaults || {})
      },
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
  if (runtimeProfile !== 'experience-management') return state;
  const profile = state.applicationDefaults?.experienceManagement || {};
  const engine = ENGINE_IDS.includes(profile.engine) ? profile.engine : 'codex';
  const model = String(profile.model || state.engines?.[engine]?.model || ENGINE_DEFAULTS[engine]?.model || '');
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
    String(activity || '').startsWith('experience.') ? 'experience-management' : ''
  );
  const selected = engineSettings(executionState);
  const available = !shuttingDown && state.enabled && !state.paused;
  const decision = activityConcurrencyDecision({
    engine: selected.id,
    model: selected.model,
    activity,
    requested: 128
  });
  return {
    globalLimit: available ? Math.max(1, Number(state.concurrency || 1)) : 0,
    activityLimit: available
      ? Math.min(
          Math.max(1, Number(state.concurrency || 1)),
          Math.max(1, Number(decision.approvedConcurrency || 1))
        )
      : 0,
    approvedConcurrency: decision.approvedConcurrency,
    candidateConcurrency: decision.candidateConcurrency,
    sustainedValidated: decision.sustainedValidated,
    globalApprovedConcurrency: decision.globalApprovedConcurrency,
    globalSustainedValidated: decision.globalSustainedValidated
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

async function verifySignature(headers, method, requestPath, rawBody) {
  const timestamp = String(headers['x-seemplify-timestamp'] || '');
  const nonce = String(headers['x-seemplify-nonce'] || '');
  const signature = String(headers['x-seemplify-signature'] || '');
  const numericTimestamp = Number(timestamp);
  const now = Date.now();
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > signatureSkewMs) {
    return { ok: false, code: 'SIGNATURE_EXPIRED' };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return { ok: false, code: 'NONCE_REJECTED' };
  }
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${String(method || '').toUpperCase()}\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  if (!safeEqual(expected, signature)) return { ok: false, code: 'SIGNATURE_INVALID' };
  await pruneNonces(now);
  if (!await claimNonce(nonce, now + nonceTtlMs, now)) return { ok: false, code: 'NONCE_REJECTED' };
  return { ok: true };
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

function signQueueHistoryPath(requestPath) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nGET\n${requestPath}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function fetchQueueHistory(inputUrl) {
  const requestPath = queueHistoryPath(inputUrl);
  const signed = signQueueHistoryPath(requestPath);
  const upstream = await fetch(`${recruiterBackendUrl}${requestPath}`, {
    headers: {
      accept: 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined
  });
  const payload = await upstream.json().catch(() => ({
    code: 'CV_HISTORY_INVALID_RESPONSE',
    message: 'The recruiter backend returned an invalid history response'
  }));
  return { status: upstream.status, payload };
}

async function fetchProviderTelemetry() {
  const requestPath = '/api/internal/local-cv-queue/provider-telemetry';
  const signed = signQueueHistoryPath(requestPath);
  const upstream = await fetch(`${recruiterBackendUrl}${requestPath}`, {
    headers: {
      accept: 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5_000) : undefined
  });
  const input = await upstream.json().catch(() => null);
  const payload = upstream.ok && input
    ? normalizeProviderTelemetry(input)
    : {
        code: queueText(input?.code, 80) || 'PROVIDER_TELEMETRY_UNAVAILABLE',
        message: 'Hosted AI provider telemetry is unavailable'
      };
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
    || request.headers['x-forwarded-for']
    || request.headers['x-forwarded-host']
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
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  response.end(body);
}

function validateSchemaValue(value, schema, location = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return [`${location} has no schema`];
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
  const selected = engineSettings(state);
  const limits = [...cvActivities].map((activity) => activityConcurrencyDecision({
    engine: selected.id,
    model: selected.model,
    activity,
    requested: 128
  }).approvedConcurrency);
  return Math.max(
    1,
    Math.min(
      Math.max(1, Number(state.concurrency || 1)),
      Math.max(...limits, 1)
    )
  );
}

function statusPayload() {
  const state = readState();
  const selected = engineSettings(state);
  const cvLocalEligible = ENGINE_IDS.includes(selected.id);
  const scheduler = inferenceScheduler.snapshot(allowedActivities);
  return {
    service: 'seemplify-local-cv-llm',
    state,
    engine: selected.id,
    model: selected.model,
    provider: `local-${selected.id}`,
    providerLabel: localProviderLabel(`local-${selected.id}`, selected.model),
    executionMode: selected.id === 'codex' ? 'local-cloud' : 'local',
    applicationDefaults: state.applicationDefaults,
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
    usageMetering: usageMeteringOutbox.status(),
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
    sourceApp
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

async function persistAtSourceUsage({
  metering,
  input,
  engine,
  model,
  providerRequestId,
  status,
  httpStatus,
  errorCode,
  latencyMs,
  usage,
  usageReported,
  usageSource
}) {
  if (!metering) return;
  await usageMeteringOutbox.enqueue({
    ...metering,
    activity: input.activity,
    provider: `local-${engine}`,
    model,
    providerRequestId,
    status,
    httpStatus,
    errorCode,
    latencyMs,
    usageReported: usageReported === true,
    usageSource: usageReported === true ? usageSource : 'unreported',
    ...meteredTokenCounts(usage),
    occurredAt: new Date().toISOString()
  });
}

async function handleCompletion(request, response, rawBody, { cvOnly = false } = {}) {
  if (!withinRateLimit(request)) {
    return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  }
  const requestPath = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`).pathname;
  const verified = await verifySignature(request.headers, request.method, requestPath, rawBody);
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
  if (!allowedActivities.has(input.activity)) {
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
  let metering;
  try {
    metering = meteringContext(input, requestSource);
  } catch (error) {
    return sendJson(response, error.status || 400, { code: error.code, message: error.message });
  }
  const runtimeProfile = String(input.runtimeProfile || '').trim().toLowerCase();
  if (runtimeProfile && runtimeProfile !== 'experience-management') {
    return sendJson(response, 400, { code: 'INVALID_RUNTIME_PROFILE' });
  }
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
  const engineMismatch = requiredEngine && selected.id !== requiredEngine;
  const modelMismatch = requiredModel
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
  const controller = new AbortController();
  activeControllers.add(controller);
  const abortIfDisconnected = () => controller.abort(new Error('Inference caller disconnected'));
  request.once('aborted', abortIfDisconnected);
  request.once('close', () => {
    if (!request.complete) abortIfDisconnected();
  });
  response.once('close', () => {
    if (!response.writableEnded) abortIfDisconnected();
  });
  let permit;
  try {
    permit = await inferenceScheduler.acquire(input.activity, { signal: controller.signal });
  } catch (error) {
    activeControllers.delete(controller);
    request.removeListener('aborted', abortIfDisconnected);
    return sendJson(response, error.status || 503, {
      code: error.code || 'ACTIVITY_QUEUE_UNAVAILABLE',
      message: error.message,
      retryable: error.retryable !== false,
      retryAfterMs: 1_000
    }, { 'retry-after': '1' });
  }
  const startedAt = Date.now();
  let executionStatus = 'failed';
  lastRequestAt = new Date().toISOString();
  try {
    const data = await analyzeWithEngine({ ...input, signal: controller.signal }, executionState);
    const schemaErrors = input.jsonSchema ? validateSchemaValue(data.data, input.jsonSchema) : [];
    if (schemaErrors.length && !data.toolCalls?.length) {
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
    const provider = `local-${data.engine}`;
    const providerLabel = localProviderLabel(provider, data.model);
    try {
      await persistAtSourceUsage({
        metering,
        input,
        engine: data.engine,
        model: data.model,
        providerRequestId: responseId,
        status: 'success',
        httpStatus: 200,
        latencyMs,
        usage: data.usage,
        usageReported: data.usageReported,
        usageSource: data.usageReported === true ? `${data.engine}-response` : 'unreported'
      });
    } catch (meteringError) {
      meteringError.code = 'LOCAL_METERING_DURABILITY_FAILED';
      meteringError.status = 503;
      meteringError.usageEnvelope = {
        id: responseId,
        engine: data.engine,
        model: data.model,
        usage: data.usage,
        usageReported: data.usageReported === true
      };
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
      totalTokens
    });
    return sendJson(response, 200, {
      id: responseId,
      provider,
      providerLabel,
      engine: data.engine,
      model: data.model,
      runtimeProfile: runtimeProfile || undefined,
      gatewayExecutionId: metering?.gatewayExecutionId,
      content: data.content,
      data: data.data,
      toolCalls: data.toolCalls || [],
      finishReason: data.finishReason || (data.toolCalls?.length ? 'tool_calls' : 'stop'),
      usage: data.usage,
      usageReported: data.usageReported === true,
      usageSource: data.usageReported === true ? `${data.engine}-response` : 'unreported',
      metrics: {
        ...(data.metrics || {}),
        queueWaitMs: permit.waitMs,
        latencyMs
      }
    });
  } catch (error) {
    const usageEnvelope = error.usageEnvelope;
    if (usageEnvelope && metering) {
      try {
        await persistAtSourceUsage({
          metering,
          input,
          engine: usageEnvelope.engine || selected.id,
          model: usageEnvelope.model || selected.model,
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
        });
      } catch (meteringError) {
        log('error', 'Local usage event could not be persisted to the durable outbox', {
          eventId: metering.eventId,
          error: meteringError.message
        });
      }
    }
    failed += 1;
    log('error', 'Local AI completion failed', {
      activity: input.activity,
      requestSource,
      endpoint: cvOnly ? 'cv' : 'general',
      latencyMs: Date.now() - startedAt,
      engine: selected.id,
      model: selected.model,
      errorCode: error.code || 'LOCAL_LLM_UNAVAILABLE',
      error: error.message
    });
    return sendJson(response, error.status || 503, {
      code: error.code || 'LOCAL_LLM_UNAVAILABLE',
      message: error.message,
      retryable: true,
      gatewayExecutionId: metering?.gatewayExecutionId,
      ...(usageEnvelope ? {
        id: usageEnvelope.id,
        provider: `local-${usageEnvelope.engine || selected.id}`,
        providerLabel: localProviderLabel(
          `local-${usageEnvelope.engine || selected.id}`,
          usageEnvelope.model || selected.model
        ),
        engine: usageEnvelope.engine,
        model: usageEnvelope.model,
        usage: usageEnvelope.usage,
        usageReported: usageEnvelope.usageReported === true,
        usageSource: usageEnvelope.usageReported === true
          ? `${usageEnvelope.engine}-response`
          : 'unreported'
      } : {})
    });
  } finally {
    activeControllers.delete(controller);
    request.removeListener('aborted', abortIfDisconnected);
    permit.release({
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
        if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 128) {
          const error = new Error('Concurrency must be an integer from 1 to 128');
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
        const requested = input.applicationDefaults.experienceManagement;
        if (requested !== undefined) {
          const engine = String(requested?.engine || '').trim().toLowerCase();
          const model = String(requested?.model || '').trim();
          if (!ENGINE_IDS.includes(engine)) throw new Error('Unsupported Experience Management engine');
          if (!/^[A-Za-z0-9._:/-]{2,200}$/.test(model)) throw new Error('Invalid Experience Management model identifier');
          allowed.applicationDefaults = {
            ...readState().applicationDefaults,
            experienceManagement: { engine, model }
          };
        }
      }
      if (requestedConcurrency !== null) {
        const current = readStoredState();
        const targetEngine = allowed.selectedEngine || current.selectedEngine;
        const targetEngines = allowed.engines || current.engines;
        const targetModel = targetEngines?.[targetEngine]?.model || ENGINE_DEFAULTS[targetEngine]?.model;
        assertConcurrencyApproved({
          engine: targetEngine,
          model: targetModel,
          requested: requestedConcurrency
        });
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
      const verified = await verifySignature(request.headers, request.method, url.pathname, rawBody);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const input = JSON.parse(rawBody || '{}');
      const runtimeProfile = input.source === 'experience-management' || input.runtimeProfile === 'experience-management'
        ? 'experience-management'
        : '';
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
          executionMode: selected.id === 'codex' ? 'local-cloud' : 'local'
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
      const verified = await verifySignature(request.headers, request.method, url.pathname, rawBody);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const input = JSON.parse(rawBody);
      queueTelemetry = normalizeQueueTelemetry(input);
      const controlState = readState();
      const selected = engineSettings(controlState);
      const desiredConcurrencyByActivity = Object.fromEntries(
        [...cvActivities].map((activity) => [
          activity,
          activityConcurrencyDecision({
            engine: selected.id,
            model: selected.model,
            activity,
            requested: 128
          }).approvedConcurrency
        ])
      );
      return sendJson(response, 200, {
        ok: true,
        desiredConcurrency: cvDesiredConcurrency(controlState),
        desiredConcurrencyByActivity,
        desiredPaused: controlState.paused
      });
    } catch (error) {
      return sendJson(response, 400, { code: 'INVALID_TELEMETRY', message: error.message });
    }
  }
  return sendJson(response, 404, { code: 'NOT_FOUND' });
});

server.listen(port, host, () => {
  usageMeteringOutbox.start();
  const selected = engineSettings(readState());
  log('info', 'Local CV LLM gateway started', { host, port, engine: selected.id, model: selected.model });
});

function shutdown(signal) {
  shuttingDown = true;
  usageMeteringOutbox.stop();
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
