'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { complete } = require('./chatgpt-completion.cjs');
const sessions = require('./chatgpt-session-manager.cjs');
const { BoundedFixedWindowRateLimiter } = require('./rate-limit.cjs');
const { ActivityQueueScheduler } = require('./request-queue.cjs');
const { ChatGptExecutionReceiptStore, canonicalRequestFingerprint } = require('./execution-receipt-store.cjs');
const { ChatGptUsageMeteringOutbox } = require('./usage-metering-outbox.cjs');
const { PlatformUsageLedger } = require('./usage-ledger.cjs');
const { canonicalConsumerId } = require('./consumer-registry.cjs');
const { signatureMatchesAny } = require('./request-auth.cjs');

const dataDir = path.resolve(process.env.CHATGPT_GATEWAY_DATA_DIR || path.join(__dirname, '.data'));
const host = process.env.CHATGPT_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.CHATGPT_GATEWAY_PORT || 11435);
// Request authentication is deliberately separate from at-rest receipt
// encryption. The original shared secret was once distributed to multiple
// products; accepting it forever would let an old consumer impersonate the
// Recruiter credential namespace. Production deployment now rotates a fresh
// Recruiter-only request key while retaining the legacy value only as the
// storage key so existing execution receipts remain decryptable.
const production = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const requestSecret = String(
  process.env.RECRUITER_CHATGPT_GATEWAY_SECRET
  || (!production ? process.env.CHATGPT_GATEWAY_SHARED_SECRET : '')
  || ''
).trim();
const previousRequestSecret = String(
  process.env.RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET || ''
).trim();
const requestSecrets = [...new Set([requestSecret, previousRequestSecret].filter(Boolean))];
const storageSecret = String(
  process.env.CHATGPT_GATEWAY_STORAGE_SECRET
  || process.env.CHATGPT_GATEWAY_SHARED_SECRET
  || requestSecret
).trim();
const usageSinkUrl = String(process.env.PLATFORM_AI_USAGE_SINK_URL || '').trim();
const maxBodyBytes = Math.max(1024, Number(process.env.CHATGPT_GATEWAY_MAX_BODY_BYTES || 8 * 1024 * 1024));
const signatureSkewMs = Number(process.env.CHATGPT_GATEWAY_SIGNATURE_SKEW_MS || 5 * 60_000);
const nonceTtlMs = Number(process.env.CHATGPT_GATEWAY_NONCE_TTL_MS || 10 * 60_000);
const nonceDir = path.join(dataDir, 'nonces');
const logFile = path.join(dataDir, 'gateway.log');

if (!requestSecret) throw new Error('RECRUITER_CHATGPT_GATEWAY_SECRET is required');
if (!storageSecret) throw new Error('CHATGPT_GATEWAY_STORAGE_SECRET is required');
for (const directory of [dataDir, nonceDir]) fs.mkdirSync(directory, { recursive: true });

let logChain = Promise.resolve();
function log(level, message, metadata = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), level, message, ...metadata })}\n`;
  process.stdout.write(line);
  logChain = logChain.then(() => fs.promises.appendFile(logFile, line, 'utf8')).catch(() => undefined);
}

const requestLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: Number(process.env.CHATGPT_GATEWAY_RATE_WINDOW_MS || 60_000),
  requests: Number(process.env.CHATGPT_GATEWAY_RATE_REQUESTS || 600),
  maxKeys: Number(process.env.CHATGPT_GATEWAY_RATE_MAX_KEYS || 20_000)
});
const loginLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: Number(process.env.CHATGPT_LOGIN_WINDOW_MS || 10 * 60_000),
  requests: Number(process.env.CHATGPT_LOGIN_REQUESTS || 6), maxKeys: 10_000
});
const resetLimiter = new BoundedFixedWindowRateLimiter({
  windowMs: Number(process.env.CHATGPT_LOGIN_RESET_WINDOW_MS || 10 * 60_000),
  requests: Number(process.env.CHATGPT_LOGIN_RESET_REQUESTS || 6), maxKeys: 10_000
});
const scheduler = new ActivityQueueScheduler({
  getLimits: () => ({
    globalLimit: Math.max(1, Number(process.env.CHATGPT_GATEWAY_CONCURRENCY || 64)),
    activityLimit: Math.max(1, Number(process.env.CHATGPT_GATEWAY_ACTIVITY_CONCURRENCY || 16))
  }),
  maxQueuePerActivity: Number(process.env.CHATGPT_GATEWAY_MAX_QUEUE_PER_ACTIVITY || 10_000),
  maxWaitMs: Number(process.env.CHATGPT_GATEWAY_QUEUE_MAX_WAIT_MS || 10 * 60_000)
});
const receipts = new ChatGptExecutionReceiptStore({
  directory: path.join(dataDir, 'execution-receipts'), encryptionSecret: storageSecret,
  retentionMs: Number(process.env.CHATGPT_GATEWAY_RECEIPT_RETENTION_MS || 30 * 24 * 60 * 60_000),
  leaseMs: Number(process.env.CHATGPT_GATEWAY_EXECUTION_LEASE_MS || 300_000), log
});
const usageLedger = new PlatformUsageLedger({ directory: path.join(dataDir, 'usage-ledger'), log });
const usageOutbox = usageSinkUrl ? new ChatGptUsageMeteringOutbox({
  directory: path.join(dataDir, 'usage-outbox'), endpointUrl: usageSinkUrl, secret: requestSecret,
  initialDelayMs: Number(process.env.CHATGPT_GATEWAY_USAGE_INITIAL_DELAY_MS || 1_000), log
}) : null;
usageOutbox?.start?.();

const seenNonces = new Map();
function remoteKey(request) {
  return String(request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown')
    .split(',')[0].trim().slice(0, 100);
}

async function claimNonce(nonce, expiresAt) {
  const now = Date.now();
  for (const [key, expiry] of seenNonces) if (expiry <= now) seenNonces.delete(key);
  if (seenNonces.has(nonce)) return false;
  const file = path.join(nonceDir, `${nonce}.nonce`);
  try {
    const handle = await fs.promises.open(file, 'wx', 0o600);
    await handle.writeFile(String(expiresAt), 'utf8');
    await handle.close();
    seenNonces.set(nonce, expiresAt);
    setTimeout(() => fs.promises.rm(file, { force: true }).catch(() => undefined), nonceTtlMs).unref?.();
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') return false;
    try {
      const priorExpiry = Number(await fs.promises.readFile(file, 'utf8'));
      if (priorExpiry > now) return false;
      await fs.promises.rm(file, { force: true });
      return claimNonce(nonce, expiresAt);
    } catch { return false; }
  }
}

async function verifySignature(headers, method, requestPath, body) {
  const timestamp = String(headers['x-seemplify-timestamp'] || '');
  const nonce = String(headers['x-seemplify-nonce'] || '');
  const supplied = String(headers['x-seemplify-signature'] || '');
  const at = Number(timestamp);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > signatureSkewMs) return { ok: false, code: 'SIGNATURE_EXPIRED' };
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(nonce) || !/^[A-Za-z0-9_-]{40,120}$/.test(supplied)) {
    return { ok: false, code: 'SIGNATURE_INVALID' };
  }
  const signatureInput = { timestamp, nonce, method, path: requestPath, body };
  if (!signatureMatchesAny(requestSecrets, signatureInput, supplied)) {
    return { ok: false, code: 'SIGNATURE_INVALID' };
  }
  return await claimNonce(nonce, at + nonceTtlMs)
    ? { ok: true } : { ok: false, code: 'SIGNATURE_REPLAYED' };
}

function sendJson(response, status, payload, headers = {}) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...headers
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('Request body is too large'), { code: 'REQUEST_TOO_LARGE', status: 413 }));
        request.destroy(); return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parseJson(raw) {
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('Request body must be valid JSON'), { code: 'INVALID_JSON', status: 400 }); }
}

function subjectFrom(input) {
  return sessions.resolveSubjectRequest({ sourceApp: input.sourceApp, subjectId: input.subjectId });
}

function formatWait(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

async function handleAccountOperation(request, response, operation, requestPath, raw) {
  if (!requestLimiter.consume(remoteKey(request))) return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  const verified = await verifySignature(request.headers, 'POST', requestPath, raw);
  if (!verified.ok) return sendJson(response, 401, { code: verified.code, message: 'Request authentication failed' });
  if (!sessions.perUserSessionsEnabled()) return sendJson(response, 503, { code: 'CHATGPT_SESSIONS_DISABLED' });
  const input = parseJson(raw);
  const resolved = subjectFrom(input);
  if (resolved.error) return sendJson(response, resolved.error.status, { code: resolved.error.code });
  const key = resolved.subjectKey;
  if (operation === 'account/adopt') {
    try {
      const legacySubjectKeys = (Array.isArray(input.legacySubjects) ? input.legacySubjects : [])
        .slice(0, 8)
        .map((legacy) => sessions.legacySubjectKeyFor(legacy?.sourceApp, legacy?.subjectId));
      return sendJson(response, 200, await sessions.adoptSubjectCredential(key, legacySubjectKeys));
    } catch (error) {
      return sendJson(response, error.status || 400, {
        code: error.code || 'CODEX_CREDENTIAL_ADOPTION_FAILED', message: error.message, retryable: false
      });
    }
  }
  const resume = operation === 'login/start' && sessions.hasPendingDeviceLogin(key);
  const reserved = operation === 'login/start' && !resume ? loginLimiter.consume(key) : false;
  if (operation === 'login/start' && !resume && !reserved) {
    const retryAfterSeconds = Math.max(1, Math.ceil(loginLimiter.retryAfterMs(key) / 1000));
    return sendJson(response, 429, {
      code: 'CHATGPT_LOGIN_RATE_LIMITED', retryable: true, retryAfterSeconds,
      message: `Too many ChatGPT sign-in attempts. Try again in ${formatWait(retryAfterSeconds)}.`
    }, { 'retry-after': String(retryAfterSeconds) });
  }
  if (operation === 'login/reset' && !resetLimiter.consume(key)) {
    return sendJson(response, 429, { code: 'CHATGPT_LOGIN_RESET_RATE_LIMITED', retryable: true });
  }
  try {
    if (operation === 'login/start') {
      const result = await sessions.startDeviceLogin(key);
      if (result.connected || result.resumed) loginLimiter.refund(key);
      return sendJson(response, 200, result);
    }
    if (operation === 'login/cancel') return sendJson(response, 200, await sessions.cancelDeviceLogin(key));
    if (operation === 'login/reset') {
      const result = await sessions.resetDeviceLogin(key); loginLimiter.reset(key); return sendJson(response, 200, result);
    }
    if (operation === 'account') return sendJson(response, 200, await sessions.accountStatusForSubject(key));
    if (operation === 'models') return sendJson(response, 200, { models: await sessions.modelsForSubject(key) });
    if (operation === 'logout') return sendJson(response, 200, await sessions.forgetSubject(key));
    return sendJson(response, 404, { code: 'CHATGPT_OPERATION_UNKNOWN' });
  } catch (error) {
    if (reserved) loginLimiter.refund(key);
    return sendJson(response, error.status || 502, {
      code: error.code || 'CHATGPT_ACCOUNT_OPERATION_FAILED', message: error.message, retryable: error.retryable !== false
    });
  }
}

function meteringContext(input) {
  if (input.metering?.record !== true) return null;
  const eventId = String(input.metering.eventId || '');
  const executionId = String(input.metering.gatewayExecutionId || '');
  if (!/^usage_[a-f0-9]{48}$/.test(eventId) || !/^chatgptexec_[a-f0-9]{48}$/.test(executionId)) {
    throw Object.assign(new Error('Invalid ChatGPT usage identity'), { code: 'CHATGPT_USAGE_CONTEXT_INVALID', status: 400 });
  }
  const sourceApp = canonicalConsumerId(input.metering.sourceApp || 'recruiter');
  if (!sourceApp) {
    throw Object.assign(new Error('Invalid ChatGPT metering source application'), {
      code: 'CHATGPT_USAGE_SOURCE_INVALID', status: 400
    });
  }
  const dimension = (value, maximum) => String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum) || undefined;
  return {
    eventId,
    executionId,
    requestId: dimension(input.metering.requestId, 200) || '',
    sourceApp,
    actorId: dimension(input.metering.actorId, 160),
    organizationId: dimension(input.metering.organizationId, 120),
    organizationName: dimension(input.metering.organizationName, 200)
  };
}

function tokenCounts(usage = {}) {
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  return {
    inputTokens, cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens || 0),
    outputTokens, reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(usage.total_tokens || inputTokens + outputTokens)
  };
}

function usageRecord({ input, metering, result, status, latencyMs, error }) {
  const counts = tokenCounts(result?.usage || error?.usageEnvelope?.usage || {});
  return {
    eventId: metering.eventId, gatewayExecutionId: metering.executionId,
    requestId: metering.requestId, sourceApp: metering.sourceApp,
    actorId: metering.actorId, organizationId: metering.organizationId,
    organizationName: metering.organizationName,
    activity: input.activity, provider: 'chatgpt-connect',
    model: result?.model || error?.usageEnvelope?.model || 'connected-account',
    providerRequestId: result?.id || error?.usageEnvelope?.id || metering.executionId,
    status, httpStatus: status === 'success' ? 200 : Number(error?.status || 503),
    errorCode: error?.code, latencyMs, usageReported: result?.usageReported === true || error?.usageEnvelope?.usageReported === true,
    usageSource: 'chatgpt-connect', ...counts, occurredAt: new Date().toISOString()
  };
}

async function persistUsage(record) {
  if (!record) return;
  const canonicalRecord = await usageLedger.record(record);
  if (usageOutbox) await usageOutbox.enqueue(canonicalRecord);
}

async function handleTelemetry(request, response, requestPath, raw, operation) {
  if (!requestLimiter.consume(remoteKey(request))) return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  const verified = await verifySignature(request.headers, 'POST', requestPath, raw);
  if (!verified.ok) return sendJson(response, 401, { code: verified.code, message: 'Request authentication failed' });
  let input = parseJson(raw);
  const requestedSourceApp = input.sourceApp ? canonicalConsumerId(input.sourceApp) : null;
  if (input.sourceApp && (!requestedSourceApp || !sessions.allowedSourceApps().has(requestedSourceApp))) {
    return sendJson(response, 403, { code: 'CODEX_SOURCE_APP_NOT_ALLOWED' });
  }
  if (requestedSourceApp) input = { ...input, sourceApp: requestedSourceApp };
  if (operation === 'events') return sendJson(response, 200, { events: await usageLedger.query(input) });
  if (operation === 'summary') return sendJson(response, 200, await usageLedger.summary(input));
  return sendJson(response, 404, { code: 'NOT_FOUND' });
}

async function handleCompletion(request, response, requestPath, raw, cvOnly) {
  if (!requestLimiter.consume(remoteKey(request))) return sendJson(response, 429, { code: 'RATE_LIMITED', retryable: true });
  const verified = await verifySignature(request.headers, 'POST', requestPath, raw);
  if (!verified.ok) return sendJson(response, 401, { code: verified.code, message: 'Request authentication failed' });
  let input;
  try { input = parseJson(raw); } catch (error) { return sendJson(response, error.status, { code: error.code, message: error.message }); }
  if (!/^[a-z][a-z0-9_.-]{1,99}$/i.test(String(input.activity || ''))) return sendJson(response, 400, { code: 'ACTIVITY_INVALID' });
  if (!Array.isArray(input.messages) || !input.messages.length) return sendJson(response, 400, { code: 'AI_REQUEST_INVALID' });
  if (!String(input.codexSubjectId || input.chatgptSubjectId || '').trim()) {
    return sendJson(response, 409, { code: 'CHATGPT_CONNECTION_REQUIRED', message: 'Connect ChatGPT before using AI features.' });
  }
  if (cvOnly && !['candidate.cv_parse', 'ai_interview.cv_parse'].includes(input.activity)) return sendJson(response, 403, { code: 'CV_ACTIVITY_REQUIRED' });
  const resolved = sessions.resolveSubjectRequest({
    sourceApp: input.codexSourceApp || input.chatgptSourceApp || 'recruiter',
    subjectId: input.codexSubjectId || input.chatgptSubjectId
  });
  if (resolved.error) return sendJson(response, resolved.error.status, { code: resolved.error.code });
  let metering;
  try { metering = meteringContext(input); } catch (error) { return sendJson(response, error.status, { code: error.code, message: error.message }); }
  input.chatgptSubject = resolved.subjectKey;
  input.modelCandidates = input.codexModelCandidates || input.modelCandidates;
  input.effortCandidates = input.codexEffortCandidates || input.effortCandidates;
  const fingerprint = metering ? canonicalRequestFingerprint({ path: requestPath, body: input }) : null;
  let lease = null; let permit = null; let dispatched = false; const startedAt = Date.now();
  try {
    if (metering) {
      const acquired = await receipts.acquire({ executionId: metering.executionId, requestFingerprint: fingerprint });
      if (acquired.action === 'replay' || acquired.action === 'recover') {
        await persistUsage(acquired.prepared.usageRecord);
        if (acquired.action === 'recover') await receipts.complete(acquired);
        return sendJson(response, acquired.prepared.response.status, acquired.prepared.response.payload);
      }
      lease = acquired;
    }
    permit = await scheduler.acquire(input.activity);
    const result = await complete({
      ...input,
      onProviderDispatch: async () => { if (lease) await receipts.markStarted(lease); dispatched = true; }
    });
    const payload = {
      id: result.id, provider: 'chatgpt-connect', providerLabel: `ChatGPT Connect (${result.model})`,
      engine: 'codex-app-server', model: result.model, runtimeOwner: 'user', planType: result.planType || undefined,
      modelSource: result.modelSource, reasoningEffort: result.reasoningEffort,
      reasoningEffortSource: result.reasoningEffortSource,
      degraded: result.degraded || undefined, gatewayExecutionId: metering?.executionId,
      content: result.content, data: result.data, toolCalls: result.toolCalls,
      finishReason: result.finishReason, usage: result.usage, usageReported: result.usageReported,
      usageSource: 'chatgpt-connect', metrics: { ...result.metrics, queueWaitMs: permit.waitMs }
    };
    const record = metering ? usageRecord({ input, metering, result, status: 'success', latencyMs: Date.now() - startedAt }) : null;
    if (lease) await receipts.prepare({ ...lease, prepared: { response: { status: 200, payload }, usageRecord: record } });
    await persistUsage(record);
    if (lease) { await receipts.complete(lease); lease = null; }
    log('info', 'ChatGPT completion finished', { activity: input.activity, model: result.model, latencyMs: Date.now() - startedAt });
    return sendJson(response, 200, payload);
  } catch (error) {
    const terminal = dispatched;
    const payload = {
      code: error.code || 'CHATGPT_GATEWAY_UNAVAILABLE', message: error.message,
      retryable: terminal ? false : error.retryable !== false,
      gatewayExecutionId: metering?.executionId
    };
    if (terminal && lease && metering) {
      const record = usageRecord({ input, metering, error, status: 'failed', latencyMs: Date.now() - startedAt });
      try {
        await receipts.prepare({ ...lease, prepared: { response: { status: error.status || 503, payload }, usageRecord: record } });
        await persistUsage(record); await receipts.complete(lease); lease = null;
      } catch (durabilityError) {
        payload.code = 'CHATGPT_DURABILITY_FAILED'; payload.message = durabilityError.message; payload.retryable = false;
      }
    }
    log('error', 'ChatGPT completion failed', { activity: input.activity, code: payload.code, latencyMs: Date.now() - startedAt });
    return sendJson(response, error.status || 503, payload);
  } finally {
    if (lease) {
      try { dispatched ? await receipts.forfeitAmbiguous(lease) : await receipts.release(lease); } catch {}
    }
    permit?.release({ status: 'completed', latencyMs: Date.now() - startedAt });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      const ready = sessions.perUserSessionsEnabled() && fs.existsSync(sessions.resolveCodexScript());
      return sendJson(response, ready ? 200 : 503, {
        ok: ready, service: 'seemplify-ai-gateway', runtime: 'codex-app-server',
        ownership: 'seemplify-platform', consumers: [...sessions.allowedSourceApps()],
        telemetry: usageLedger.status(), telemetryMirrorConfigured: Boolean(usageOutbox), persistence: 'server-volume'
      });
    }
    if (request.method !== 'POST') return sendJson(response, 404, { code: 'NOT_FOUND' });
    const raw = await readBody(request);
    if (url.pathname.startsWith('/v1/codex/')) {
      return handleAccountOperation(request, response, url.pathname.slice('/v1/codex/'.length), url.pathname, raw);
    }
    if (url.pathname === '/v1/telemetry/events') return handleTelemetry(request, response, url.pathname, raw, 'events');
    if (url.pathname === '/v1/telemetry/summary') return handleTelemetry(request, response, url.pathname, raw, 'summary');
    if (url.pathname === '/v1/complete') return handleCompletion(request, response, url.pathname, raw, false);
    if (url.pathname === '/v1/cv/analyze') return handleCompletion(request, response, url.pathname, raw, true);
    return sendJson(response, 404, { code: 'NOT_FOUND' });
  } catch (error) {
    log('error', 'Gateway request failed', { path: url.pathname, code: error.code, error: error.message });
    return sendJson(response, error.status || 500, { code: error.code || 'CHATGPT_GATEWAY_ERROR', message: error.message });
  }
});

server.listen(port, host, () => log('info', 'ChatGPT gateway listening', { host, port }));

async function shutdown(signal) {
  log('info', 'ChatGPT gateway stopping', { signal });
  scheduler.stop?.();
  server.close();
  await sessions.stopAllSessions();
  await usageOutbox?.flush({ force: true }).catch(() => undefined);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
