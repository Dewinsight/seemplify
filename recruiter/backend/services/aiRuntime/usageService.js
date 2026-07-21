const AIQuotaSnapshot = require('../../models/AIQuotaSnapshot');
const AIUsageDailyRollup = require('../../models/AIUsageDailyRollup');
const AIUsageEvent = require('../../models/AIUsageEvent');

const EVENT_RETENTION_DAYS = 90;

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw) * 1000;

  let total = 0;
  let matched = false;
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)/g;
  let match;
  while ((match = pattern.exec(raw))) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 'ms') total += amount;
    if (unit === 's') total += amount * 1000;
    if (unit === 'm') total += amount * 60 * 1000;
    if (unit === 'h') total += amount * 60 * 60 * 1000;
    if (unit === 'd') total += amount * 24 * 60 * 60 * 1000;
  }
  return matched ? Math.round(total) : null;
}

function parseRateLimitHeaders(headers, now = new Date()) {
  const requestResetMs = parseDurationMs(headerValue(headers, 'x-ratelimit-reset-requests'));
  const tokenResetMs = parseDurationMs(headerValue(headers, 'x-ratelimit-reset-tokens'));
  const retryAfterMs = parseDurationMs(headerValue(headers, 'retry-after'));
  return {
    requestLimitDaily: finiteNumber(headerValue(headers, 'x-ratelimit-limit-requests')),
    requestRemainingDaily: finiteNumber(headerValue(headers, 'x-ratelimit-remaining-requests')),
    requestResetAt: requestResetMs == null ? null : new Date(now.getTime() + requestResetMs),
    tokenLimitMinute: finiteNumber(headerValue(headers, 'x-ratelimit-limit-tokens')),
    tokenRemainingMinute: finiteNumber(headerValue(headers, 'x-ratelimit-remaining-tokens')),
    tokenResetAt: tokenResetMs == null ? null : new Date(now.getTime() + tokenResetMs),
    retryAfterMs,
    providerRequestId: headerValue(headers, 'x-request-id') || headerValue(headers, 'request-id') || null
  };
}

function normalizeUsage(usage = {}) {
  const inputTokens = finiteNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens) || 0;
  const outputTokens = finiteNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens) || 0;
  const cachedInputTokens = finiteNumber(
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens
  ) || 0;
  const reasoningTokens = finiteNumber(
    usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? usage.reasoningTokens
  ) || 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens: finiteNumber(usage.total_tokens ?? usage.totalTokens) || inputTokens + outputTokens
  };
}

function calculateEstimatedCost(usage, pricing = {}) {
  const normalized = normalizeUsage(usage);
  const regularInput = Math.max(0, normalized.inputTokens - normalized.cachedInputTokens);
  const inputCost = regularInput * (Number(pricing.inputPerMillionUsd) || 0) / 1_000_000;
  const cachedCost = normalized.cachedInputTokens * (Number(pricing.cachedInputPerMillionUsd) || 0) / 1_000_000;
  const outputCost = normalized.outputTokens * (Number(pricing.outputPerMillionUsd) || 0) / 1_000_000;
  return Number((inputCost + cachedCost + outputCost).toFixed(8));
}

function sanitizeMessage(value) {
  return String(value || '')
    .replace(/gsk_[A-Za-z0-9_-]+/g, '[REDACTED_GROQ_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 600);
}

function utcDay(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function windowCounter(field, windowField, windowValue, amount) {
  return {
    $cond: [
      { $eq: [`$${windowField}`, windowValue] },
      { $add: [{ $ifNull: [`$${field}`, 0] }, amount] },
      amount
    ]
  };
}

function buildQuotaSnapshotSet(event, observedAt = new Date()) {
  const day = utcDay(event.createdAt || new Date());
  const eventDate = new Date(event.createdAt || new Date());
  const minute = new Date(Date.UTC(
    eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate(),
    eventDate.getUTCHours(), eventDate.getUTCMinutes()
  ));
  const rateLimit = event.rateLimit || {};
  const totalTokens = Number(event.totalTokens || 0);
  const set = {
    observedAt,
    localDay: day,
    localRequestsToday: windowCounter('localRequestsToday', 'localDay', day, 1),
    localTokensToday: windowCounter('localTokensToday', 'localDay', day, totalTokens),
    localMinute: minute,
    localRequestsMinute: windowCounter('localRequestsMinute', 'localMinute', minute, 1),
    localTokensMinute: windowCounter('localTokensMinute', 'localMinute', minute, totalTokens)
  };
  for (const key of [
    'requestLimitDaily', 'requestRemainingDaily', 'requestResetAt',
    'tokenLimitMinute', 'tokenRemainingMinute', 'tokenResetAt'
  ]) {
    if (rateLimit[key] !== null && rateLimit[key] !== undefined) set[key] = rateLimit[key];
  }
  if (event.errorCode === 'rate_limit_exceeded' || event.httpStatus === 429) {
    set.blockedUntil = rateLimit.retryAfterMs
      ? new Date(Date.now() + rateLimit.retryAfterMs)
      : rateLimit.tokenResetAt || rateLimit.requestResetAt || new Date(Date.now() + 60_000);
    set.blockedReason = 'rate_limit';
  } else if (event.status === 'success') {
    const activeBlock = { $gt: ['$blockedUntil', observedAt] };
    set.blockedUntil = { $cond: [activeBlock, '$blockedUntil', null] };
    set.blockedReason = { $cond: [activeBlock, '$blockedReason', null] };
  }
  return set;
}

async function updateQuotaSnapshot(event) {
  if (!event.quotaGroup || !event.model) return null;
  const filter = { provider: event.provider, quotaGroup: event.quotaGroup, model: event.model };
  const set = buildQuotaSnapshotSet(event);
  return AIQuotaSnapshot.findOneAndUpdate(filter, [{ $set: set }], { upsert: true, new: true }).lean();
}

async function updateDailyRollup(event) {
  const day = utcDay(event.createdAt || new Date());
  const filter = {
    day,
    sourceApp: event.sourceApp || 'recruiter',
    activity: event.activity,
    provider: event.provider,
    model: event.model,
    quotaGroup: event.quotaGroup || '',
    organizationId: event.organizationId || '',
    actorId: event.actorId || ''
  };
  return AIUsageDailyRollup.findOneAndUpdate(filter, {
    $set: {
      organizationName: event.organizationName || '',
      actorName: event.actorName || ''
    },
    $inc: {
      calls: 1,
      successes: event.status === 'success' ? 1 : 0,
      failures: event.status === 'failed' ? 1 : 0,
      inputTokens: Number(event.inputTokens || 0),
      cachedInputTokens: Number(event.cachedInputTokens || 0),
      outputTokens: Number(event.outputTokens || 0),
      reasoningTokens: Number(event.reasoningTokens || 0),
      totalTokens: Number(event.totalTokens || 0),
      estimatedCostUsd: Number(event.estimatedCostUsd || 0),
      latencyTotalMs: Number(event.latencyMs || 0)
    },
    $max: { latencyMaxMs: Number(event.latencyMs || 0) }
  }, { upsert: true, new: true }).lean();
}

async function recordUsage(input) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
  const usage = normalizeUsage(input.usage || input);
  const event = {
    ...input,
    ...usage,
    createdAt,
    errorMessage: sanitizeMessage(input.errorMessage),
    expiresAt: new Date(createdAt.getTime() + EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  };
  delete event.usage;
  delete event.pricing;

  try {
    const [savedEvent, rollup, quota] = await Promise.all([
      AIUsageEvent.create(event),
      updateDailyRollup(event),
      updateQuotaSnapshot(event)
    ]);
    return { event: savedEvent.toObject(), rollup, quota };
  } catch (error) {
    console.error('AI usage telemetry write failed:', sanitizeMessage(error.message));
    return { event: null, rollup: null, quota: null, error };
  }
}

module.exports = {
  buildQuotaSnapshotSet,
  calculateEstimatedCost,
  normalizeUsage,
  parseDurationMs,
  parseRateLimitHeaders,
  recordUsage,
  sanitizeMessage,
  utcDay
};
