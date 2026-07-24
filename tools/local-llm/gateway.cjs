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
  assertConcurrencyApproved,
  concurrencyDecision,
  normalizeConcurrency
} = require('./approval-store.cjs');
const { BoundedFixedWindowRateLimiter } = require('./bounded-rate-limit.cjs');
const { ACTIVITY_DEFINITIONS } = require('../../recruiter/backend/config/aiRuntimeCatalog');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(workspaceRoot, '.local-runtime', 'llm');
const secretFile = process.env.LOCAL_LLM_SECRET_FILE || path.join(runtimeDir, 'service-secret');
const controlSecretFile = process.env.LOCAL_LLM_CONTROL_SECRET_FILE || path.join(runtimeDir, 'control-secret');
const stateFile = process.env.LOCAL_LLM_STATE_FILE || path.join(runtimeDir, 'state.json');
const logFile = process.env.LOCAL_LLM_LOG_FILE || path.join(runtimeDir, 'gateway.log');
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
const maxWaitingRequests = Number(process.env.LOCAL_LLM_MAX_WAITING_REQUESTS || 1000);
const recruiterBackendUrl = String(process.env.RECRUITER_BACKEND_URL || 'https://api.seemplifyai.com').replace(/\/+$/, '');
const allowedActivities = new Set(Object.keys(ACTIVITY_DEFINITIONS));
const cvActivities = new Set(['candidate.cv_parse', 'ai_interview.cv_parse']);
const requiredCvFields = ['firstName', 'lastName', 'email', 'skills', 'summary'];

for (const file of [secretFile, controlSecretFile, stateFile, logFile]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

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

function log(level, message, metadata = {}) {
  const record = JSON.stringify({ at: new Date().toISOString(), level, message, ...metadata });
  fs.appendFileSync(logFile, `${record}\n`, 'utf8');
  process.stdout.write(`${record}\n`);
}

const secret = ensureSecret(secretFile);
const controlSecret = ensureSecret(controlSecretFile);
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
const waiting = [];
let active = 0;
let completed = 0;
let failed = 0;
let totalLatencyMs = 0;
let lastRequestAt = null;
let shuttingDown = false;
let queueTelemetry = null;

function pruneNonces(now = Date.now()) {
  for (const [nonce, expiresAt] of seenNonces) if (expiresAt <= now) seenNonces.delete(nonce);
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

function normalizeQueueTelemetry(input = {}) {
  const recentJobs = Array.isArray(input.recentJobs)
    ? input.recentJobs.slice(0, 20).map((job) => ({
        jobId: queueText(job?.jobId, 100),
        source: queueText(job?.source, 40),
        producer: queueText(job?.producer, 40),
        queue: queueText(job?.queue, 80),
        state: queueText(job?.state, 40),
        phase: queueText(job?.phase || job?.state, 40),
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

function verifySignature(headers, rawBody) {
  const timestamp = String(headers['x-seemplify-timestamp'] || '');
  const nonce = String(headers['x-seemplify-nonce'] || '');
  const signature = String(headers['x-seemplify-signature'] || '');
  const numericTimestamp = Number(timestamp);
  const now = Date.now();
  pruneNonces(now);
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > signatureSkewMs) {
    return { ok: false, code: 'SIGNATURE_EXPIRED' };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || seenNonces.has(nonce)) {
    return { ok: false, code: 'NONCE_REJECTED' };
  }
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${rawBody}`)
    .digest('base64url');
  if (!safeEqual(expected, signature)) return { ok: false, code: 'SIGNATURE_INVALID' };
  seenNonces.set(nonce, now + nonceTtlMs);
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

function acquireSlot() {
  return new Promise((resolve) => {
    const dispatch = () => {
      const state = readState();
      if (shuttingDown || !state.enabled || state.paused) return false;
      if (active >= Math.max(1, Number(state.concurrency || 1))) return false;
      active += 1;
      resolve(() => {
        active = Math.max(0, active - 1);
        pumpQueue();
      });
      return true;
    };
    if (!dispatch()) waiting.push(dispatch);
  });
}

function pumpQueue() {
  for (let index = 0; index < waiting.length;) {
    if (waiting[index]()) waiting.splice(index, 1);
    else index += 1;
  }
}

function statusPayload() {
  const state = readState();
  const selected = engineSettings(state);
  const cvLocalEligible = ENGINE_IDS.includes(selected.id);
  return {
    service: 'seemplify-local-cv-llm',
    state,
    engine: selected.id,
    model: selected.model,
    executionMode: selected.id === 'codex' ? 'local-cloud' : 'local',
    cvLocalEligible,
    engines: Object.entries(state.engines || {}).map(([id, value]) => ({
      id,
      label: ENGINE_DEFAULTS[id]?.label || id,
      model: value.model,
      selected: id === selected.id
    })),
    active,
    waiting: waiting.length,
    completed,
    failed,
    averageLatencyMs: completed ? Math.round(totalLatencyMs / completed) : 0,
    lastRequestAt,
    queue: queueTelemetry,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime())
  };
}

async function handleCompletion(request, response, rawBody, { cvOnly = false } = {}) {
  if (!withinRateLimit(request)) {
    return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  }
  const verified = verifySignature(request.headers, rawBody);
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
  const selected = engineSettings(state);
  if (input.executionMode === 'local-only' && !ENGINE_IDS.includes(selected.id)) {
    return sendJson(response, 503, {
      code: 'LOCAL_ENGINE_REQUIRED',
      retryable: true,
      message: `Local inference requires a managed local or local-cloud engine; ${selected.id} is unavailable`
    });
  }
  if (waiting.length >= maxWaitingRequests) {
    return sendJson(response, 503, { code: 'GATEWAY_QUEUE_FULL', retryable: true });
  }

  const release = await acquireSlot();
  const startedAt = Date.now();
  lastRequestAt = new Date().toISOString();
  try {
    const data = await analyzeWithEngine(input, readState());
    const schemaErrors = input.jsonSchema ? validateSchemaValue(data.data, input.jsonSchema) : [];
    if (schemaErrors.length && !data.toolCalls?.length) {
      const error = new Error(`Inference engine returned invalid structured data: ${schemaErrors.slice(0, 5).join('; ')}`);
      error.code = 'LOCAL_LLM_SCHEMA_INVALID';
      throw error;
    }
    const latencyMs = Date.now() - startedAt;
    completed += 1;
    totalLatencyMs += latencyMs;
    log('info', 'Local AI completion finished', { activity: input.activity, latencyMs, engine: data.engine, model: data.model });
    return sendJson(response, 200, {
      id: data.id || crypto.randomUUID(),
      engine: data.engine,
      model: data.model,
      content: data.content,
      data: data.data,
      toolCalls: data.toolCalls || [],
      finishReason: data.finishReason || (data.toolCalls?.length ? 'tool_calls' : 'stop'),
      usage: data.usage,
      metrics: {
        ...(data.metrics || {}),
        latencyMs
      }
    });
  } catch (error) {
    failed += 1;
    log('error', 'Local AI completion failed', { activity: input.activity, error: error.message });
    return sendJson(response, error.status || 503, {
      code: error.code || 'LOCAL_LLM_UNAVAILABLE',
      message: error.message,
      retryable: true
    });
  } finally {
    release();
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
      const state = writeState(allowed);
      pumpQueue();
      return sendJson(response, 200, { ok: true, state });
    } catch (error) {
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
      const verified = verifySignature(request.headers, rawBody);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const health = await engineHealth(readState());
      return sendJson(response, 200, { ...statusPayload(), health });
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
      const verified = verifySignature(request.headers, rawBody);
      if (!verified.ok) return sendJson(response, 401, { code: verified.code });
      const input = JSON.parse(rawBody);
      queueTelemetry = normalizeQueueTelemetry(input);
      const controlState = readState();
      return sendJson(response, 200, {
        ok: true,
        desiredConcurrency: controlState.concurrency,
        desiredPaused: controlState.paused
      });
    } catch (error) {
      return sendJson(response, 400, { code: 'INVALID_TELEMETRY', message: error.message });
    }
  }
  return sendJson(response, 404, { code: 'NOT_FOUND' });
});

server.listen(port, host, () => {
  const selected = engineSettings(readState());
  log('info', 'Local CV LLM gateway started', { host, port, engine: selected.id, model: selected.model });
});

function shutdown(signal) {
  shuttingDown = true;
  writeState({ paused: true });
  log('info', 'Gateway shutdown requested', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
