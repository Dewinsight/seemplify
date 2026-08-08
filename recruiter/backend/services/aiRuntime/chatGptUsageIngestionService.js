const crypto = require('node:crypto');
const { ACTIVITY_DEFINITIONS } = require('../../config/aiRuntimeCatalog');
const { recordUsage } = require('./usageService');

const SIGNATURE_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_COUNT = 100_000_000;
const ALLOWED_PROVIDERS = new Set(['chatgpt-connect']);
const seenNonces = new Map();

function text(value, maximumLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximumLength);
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function deriveGatewayExecutionId(eventId) {
  return `chatgptexec_${crypto.createHash('sha256').update(String(eventId)).digest('hex').slice(0, 48)}`;
}

function authFailure(code, message) {
  return { ok: false, statusCode: 401, code, message };
}

function verifyChatGptUsageSignature({
  headers = {},
  method = 'POST',
  requestPath = '/api/internal/ai/v1/chatgpt-usage/events',
  rawBody = '',
  secret = process.env.CHATGPT_GATEWAY_SHARED_SECRET,
  now = Date.now(),
  nonceStore = seenNonces
} = {}) {
  if (!secret) {
    return {
      ok: false,
      statusCode: 503,
      code: 'CHATGPT_USAGE_INGESTION_NOT_CONFIGURED',
      message: 'ChatGPT usage ingestion is not configured'
    };
  }
  const header = (name) => headers[name] ?? headers[name.toLowerCase()];
  const timestamp = String(header('x-seemplify-timestamp') || '');
  const nonce = String(header('x-seemplify-nonce') || '');
  const signature = String(header('x-seemplify-signature') || '');
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > SIGNATURE_SKEW_MS) {
    return authFailure('CHATGPT_USAGE_SIGNATURE_EXPIRED', 'ChatGPT usage signature has expired');
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return authFailure('CHATGPT_USAGE_NONCE_INVALID', 'ChatGPT usage nonce is invalid');
  }
  const expected = crypto.createHmac('sha256', String(secret))
    .update(`${timestamp}\n${nonce}\n${String(method).toUpperCase()}\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  if (!timingSafeEqual(signature, expected)) {
    return authFailure('CHATGPT_USAGE_SIGNATURE_INVALID', 'ChatGPT usage signature is invalid');
  }
  for (const [storedNonce, expiresAt] of nonceStore) {
    if (expiresAt <= now) nonceStore.delete(storedNonce);
  }
  if (nonceStore.has(nonce)) {
    return authFailure('CHATGPT_USAGE_REPLAY_REJECTED', 'ChatGPT usage request was already received');
  }
  nonceStore.set(nonce, now + NONCE_TTL_MS);
  return { ok: true };
}

function validationError(message) {
  const error = new TypeError(message);
  error.code = 'CHATGPT_USAGE_EVENT_INVALID';
  error.statusCode = 400;
  return error;
}

function boundedToken(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_TOKEN_COUNT) {
    throw validationError(`${field} must be a non-negative safe integer no greater than ${MAX_TOKEN_COUNT}`);
  }
  return parsed;
}

function validateChatGptUsageEnvelope(payload = {}) {
  if (payload.schemaVersion !== 1 || !payload.event || typeof payload.event !== 'object') {
    throw validationError('ChatGPT usage envelope schema is invalid');
  }
  const input = payload.event;
  const eventId = text(input.eventId, 200);
  const gatewayExecutionId = text(input.gatewayExecutionId, 200);
  if (!/^usage_[a-f0-9]{48}$/.test(eventId)) {
    throw validationError('ChatGPT usage event ID is invalid');
  }
  if (gatewayExecutionId !== deriveGatewayExecutionId(eventId)) {
    throw validationError('ChatGPT usage gateway execution ID is invalid');
  }
  const requestId = text(input.requestId, 200);
  const sourceApp = text(input.sourceApp, 64);
  const activity = text(input.activity, 100);
  const provider = text(input.provider, 80);
  const model = text(input.model, 200);
  if (!requestId || !sourceApp || !ACTIVITY_DEFINITIONS[activity]) {
    throw validationError('ChatGPT usage request metadata is invalid');
  }
  if (!ALLOWED_PROVIDERS.has(provider) || !model) {
    throw validationError('ChatGPT usage provider metadata is invalid');
  }
  if (!['success', 'failed'].includes(input.status)) {
    throw validationError('ChatGPT usage status is invalid');
  }
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw validationError('ChatGPT usage timestamp is invalid');
  }
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
    throw validationError('ChatGPT usage token composition is inconsistent');
  }
  const httpStatus = Number(input.httpStatus || 0);
  if (httpStatus && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    throw validationError('ChatGPT usage HTTP status is invalid');
  }
  const estimatedCostUsd = Number(input.estimatedCostUsd || 0);
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0 || estimatedCostUsd > 1_000_000) {
    throw validationError('ChatGPT usage estimated cost is invalid');
  }
  return {
    eventId,
    gatewayExecutionId,
    requestId,
    sourceApp,
    organizationId: text(input.organizationId, 120) || undefined,
    organizationName: text(input.organizationName, 200) || undefined,
    actorId: text(input.actorId, 160) || undefined,
    actorName: text(input.actorName, 200) || undefined,
    actorEmail: text(input.actorEmail, 254) || undefined,
    activity,
    provider,
    model,
    providerRequestId: text(input.providerRequestId, 200) || undefined,
    status: input.status,
    httpStatus: httpStatus || undefined,
    errorCode: text(input.errorCode, 100) || undefined,
    latencyMs: Math.max(0, Math.floor(Number(input.latencyMs) || 0)),
    usageReported: input.usageReported === true,
    usageSource: text(input.usageSource || (input.usageReported ? 'chatgpt-gateway' : 'unreported'), 100),
    usage,
    estimatedCostUsd,
    occurredAt
  };
}

async function ingestChatGptUsageEnvelope(payload, { recordUsageImpl = recordUsage } = {}) {
  const event = validateChatGptUsageEnvelope(payload);
  const result = await recordUsageImpl({
    eventId: event.eventId,
    gatewayExecutionId: event.gatewayExecutionId,
    meteringOrigin: 'chatgpt-gateway-at-source',
    atSourceOnly: true,
    requestId: event.requestId,
    sourceApp: event.sourceApp,
    organizationId: event.organizationId,
    organizationName: event.organizationName,
    actorId: event.actorId,
    actorName: event.actorName,
    actorEmail: event.actorEmail,
    activity: event.activity,
    provider: event.provider,
    model: event.model,
    providerRequestId: event.providerRequestId,
    status: event.status,
    httpStatus: event.httpStatus,
    errorCode: event.errorCode,
    latencyMs: event.latencyMs,
    usageReported: event.usageReported,
    usageSource: event.usageSource,
    usage: {
      prompt_tokens: event.usage.inputTokens,
      prompt_tokens_details: { cached_tokens: event.usage.cachedInputTokens },
      completion_tokens: event.usage.outputTokens,
      completion_tokens_details: { reasoning_tokens: event.usage.reasoningTokens },
      total_tokens: event.usage.totalTokens
    },
    estimatedCostUsd: event.estimatedCostUsd,
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

function resetChatGptUsageNonceStoreForTests() {
  seenNonces.clear();
}

module.exports = {
  ALLOWED_PROVIDERS,
  deriveGatewayExecutionId,
  ingestChatGptUsageEnvelope,
  resetChatGptUsageNonceStoreForTests,
  validateChatGptUsageEnvelope,
  verifyChatGptUsageSignature
};
