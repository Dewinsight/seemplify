'use strict';

const crypto = require('node:crypto');
const { ACTIVITY_DEFINITIONS } = require('../../config/aiRuntimeCatalog');
const { claimMongoNonce } = require('../../middleware/internalServiceAuth');
const { recordUsage } = require('./usageService');

const SIGNATURE_SKEW_MS = 5 * 60_000;
const NONCE_TTL_MS = 10 * 60_000;
const MAX_TOKEN_COUNT = 100_000_000;
const ALLOWED_SOURCE_APPS = new Set([
  'identity-provider', 'leave-management', 'payroll',
  'performance-management', 'recruiter', 'time-attendance'
]);

function text(value, maximumLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximumLength);
}

function fail(code, message, statusCode = 401) {
  return { ok: false, statusCode, code, message };
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyLocalUsageSignature({
  headers = {},
  method = 'POST',
  requestPath = '/api/internal/ai/v1/local-usage/events',
  rawBody = '',
  secret = process.env.LOCAL_LLM_SHARED_SECRET,
  now = Date.now()
} = {}) {
  if (!secret) return fail('LOCAL_USAGE_INGESTION_NOT_CONFIGURED', 'Local usage ingestion is not configured', 503);
  const header = name => headers[name] ?? headers[name.toLowerCase()];
  const timestamp = String(header('x-seemplify-timestamp') || '');
  const nonce = String(header('x-seemplify-nonce') || '');
  const signature = String(header('x-seemplify-signature') || '');
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > SIGNATURE_SKEW_MS) {
    return fail('LOCAL_USAGE_SIGNATURE_EXPIRED', 'Local usage signature has expired');
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return fail('LOCAL_USAGE_NONCE_INVALID', 'Local usage nonce is invalid');
  }
  const expected = crypto.createHmac('sha256', String(secret))
    .update(`${timestamp}\n${nonce}\n${String(method).toUpperCase()}\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  return timingSafeEqual(signature, expected)
    ? { ok: true, nonce, timestampMs }
    : fail('LOCAL_USAGE_SIGNATURE_INVALID', 'Local usage signature is invalid');
}

async function verifyAndClaimLocalUsageSignature(input = {}, { claimNonce = claimMongoNonce } = {}) {
  const verified = verifyLocalUsageSignature(input);
  if (!verified.ok) return verified;
  try {
    const currentTime = Number(input.now) || Date.now();
    const claimed = await claimNonce(`local-usage:${verified.nonce}`, currentTime + NONCE_TTL_MS);
    return claimed
      ? verified
      : fail('LOCAL_USAGE_REPLAY_REJECTED', 'Local usage request was already received', 409);
  } catch (error) {
    return fail('LOCAL_USAGE_REPLAY_GUARD_UNAVAILABLE', 'Local usage replay protection is unavailable', 503);
  }
}

function validationError(message) {
  const error = new TypeError(message);
  error.code = 'LOCAL_USAGE_EVENT_INVALID';
  return error;
}

function boundedToken(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_TOKEN_COUNT) {
    throw validationError(`${field} must be a bounded non-negative integer`);
  }
  return parsed;
}

function deriveLocalExecutionId(eventId) {
  return `localexec_${crypto.createHash('sha256').update(String(eventId)).digest('hex').slice(0, 48)}`;
}

function validateLocalUsageEnvelope(payload = {}) {
  if (payload.schemaVersion !== 1 || !payload.event || typeof payload.event !== 'object') {
    throw validationError('Local usage envelope schema is invalid');
  }
  const input = payload.event;
  const eventId = text(input.eventId, 200);
  const gatewayExecutionId = text(input.gatewayExecutionId, 200);
  if (!/^usage_[a-f0-9]{48}$/.test(eventId) || gatewayExecutionId !== deriveLocalExecutionId(eventId)) {
    throw validationError('Local usage execution identity is invalid');
  }
  const requestId = text(input.requestId, 200);
  const sourceApp = text(input.sourceApp, 64);
  const activity = text(input.activity, 100);
  const provider = text(input.provider, 80);
  const model = text(input.model, 200);
  if (!requestId || !ALLOWED_SOURCE_APPS.has(sourceApp) || !ACTIVITY_DEFINITIONS[activity]) {
    throw validationError('Local usage request metadata is invalid');
  }
  if (!model || !(/^(local-[A-Za-z0-9._-]+|chatgpt-codex)$/.test(provider))) {
    throw validationError('Local usage provider metadata is invalid');
  }
  if (!['success', 'failed'].includes(input.status)) throw validationError('Local usage status is invalid');
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw validationError('Local usage timestamp is invalid');
  const usage = {
    inputTokens: boundedToken(input.inputTokens, 'inputTokens'),
    cachedInputTokens: boundedToken(input.cachedInputTokens, 'cachedInputTokens'),
    outputTokens: boundedToken(input.outputTokens, 'outputTokens'),
    reasoningTokens: boundedToken(input.reasoningTokens, 'reasoningTokens'),
    totalTokens: boundedToken(input.totalTokens, 'totalTokens')
  };
  if (usage.cachedInputTokens > usage.inputTokens
    || usage.reasoningTokens > usage.outputTokens
    || usage.totalTokens < usage.inputTokens + usage.outputTokens) {
    throw validationError('Local usage token composition is inconsistent');
  }
  const estimatedCostUsd = Number(input.estimatedCostUsd || 0);
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0 || estimatedCostUsd > 1_000_000) {
    throw validationError('Local usage estimated cost is invalid');
  }
  return {
    eventId, gatewayExecutionId, requestId, sourceApp,
    organizationId: text(input.organizationId, 120) || undefined,
    organizationName: text(input.organizationName, 200) || undefined,
    actorId: text(input.actorId, 160) || undefined,
    actorName: text(input.actorName, 200) || undefined,
    actorEmail: text(input.actorEmail, 254) || undefined,
    activity, provider, model,
    providerRequestId: text(input.providerRequestId, 200) || undefined,
    status: input.status,
    httpStatus: Math.max(0, Math.min(599, Math.floor(Number(input.httpStatus) || 0))) || undefined,
    errorCode: text(input.errorCode, 100) || undefined,
    latencyMs: Math.max(0, Math.floor(Number(input.latencyMs) || 0)),
    usageReported: input.usageReported === true,
    usageSource: text(input.usageSource || (input.usageReported ? 'local-gateway' : 'unreported'), 100),
    usage, estimatedCostUsd, occurredAt
  };
}

async function ingestLocalUsageEnvelope(payload, { recordUsageImpl = recordUsage } = {}) {
  const event = validateLocalUsageEnvelope(payload);
  const result = await recordUsageImpl({
    ...event,
    meteringOrigin: 'local-gateway-at-source',
    atSourceOnly: true,
    usage: {
      prompt_tokens: event.usage.inputTokens,
      prompt_tokens_details: { cached_tokens: event.usage.cachedInputTokens },
      completion_tokens: event.usage.outputTokens,
      completion_tokens_details: { reasoning_tokens: event.usage.reasoningTokens },
      total_tokens: event.usage.totalTokens
    },
    createdAt: event.occurredAt
  });
  return {
    accepted: true,
    eventId: event.eventId,
    duplicate: result.duplicate === true,
    reconciled: result.reconciled === true,
    projectionPending: result.projectionPending === true,
    persistencePending: result.persistencePending === true
  };
}

module.exports = {
  ALLOWED_SOURCE_APPS,
  deriveLocalExecutionId,
  ingestLocalUsageEnvelope,
  validateLocalUsageEnvelope,
  verifyAndClaimLocalUsageSignature,
  verifyLocalUsageSignature
};
