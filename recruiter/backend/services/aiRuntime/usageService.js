const crypto = require('node:crypto');
const AIQuotaSnapshot = require('../../models/AIQuotaSnapshot');
const AIUsageDailyRollup = require('../../models/AIUsageDailyRollup');
const AIUsageEvent = require('../../models/AIUsageEvent');
const AIUsageLogicalRequest = require('../../models/AIUsageLogicalRequest');
const AIUsageProjectionState = require('../../models/AIUsageProjectionState');
const { usageMeteringOutbox } = require('./usageMeteringOutbox');

const EVENT_RETENTION_DAYS = 90;
const PROJECTION_VERSION = 4;
const PROJECTION_SEQUENCE_ID = 'ai-usage-event-sequence';
const COMPATIBILITY_STATE_ID = 'ai-usage-projection-compatibility';
const PROJECTION_REPAIR_STATE_ID = 'ai-usage-projection-repair-status';
const COMPATIBILITY_VERSION = 4;
const COMPATIBILITY_OWNER_ID = `${process.pid}:${crypto.randomUUID()}`;
const DEFAULT_COMPATIBILITY_LEASE_MS = Math.max(
  5_000,
  Number(process.env.AI_USAGE_COMPATIBILITY_LEASE_MS) || 60_000
);
const DEFAULT_COMPATIBILITY_WAIT_MS = Math.max(
  DEFAULT_COMPATIBILITY_LEASE_MS,
  Number(process.env.AI_USAGE_COMPATIBILITY_WAIT_MS) || 10 * 60_000
);
const DEFAULT_COMPATIBILITY_POLL_MS = Math.max(
  25,
  Number(process.env.AI_USAGE_COMPATIBILITY_POLL_MS) || 250
);
const DEFAULT_REPAIR_DELAY_MS = Math.max(
  100,
  Number(process.env.AI_USAGE_REPAIR_INITIAL_DELAY_MS) || 1_000
);
const MAX_REPAIR_DELAY_MS = Math.max(
  DEFAULT_REPAIR_DELAY_MS,
  Number(process.env.AI_USAGE_REPAIR_MAX_DELAY_MS) || 60_000
);
const REPAIR_BATCH_LIMIT = Math.min(
  500,
  Math.max(1, Number(process.env.AI_USAGE_REPAIR_BATCH_LIMIT) || 100)
);
const RATE_LIMIT_FIELDS = [
  'requestLimitDaily', 'requestRemainingDaily', 'requestResetAt',
  'tokenLimitMinute', 'tokenRemainingMinute', 'tokenResetAt'
];

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

function utcMinute(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes()
  ));
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function idValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function usageHasTokenEvidence(event = {}) {
  return [
    event.totalTokens,
    event.inputTokens,
    event.cachedInputTokens,
    event.outputTokens,
    event.reasoningTokens
  ].some((value) => Math.max(0, Number(value || 0)) > 0);
}

function usageMeteringStatus(event = {}) {
  if (event.usageReported === true || usageHasTokenEvidence(event)) return 'metered';
  if (event.usageReported === false) return 'unmetered';
  return 'legacy-unknown';
}

function usageTokenEvidenceExpression() {
  return {
    $gt: [
      {
        $add: [
          { $ifNull: ['$totalTokens', 0] },
          { $ifNull: ['$inputTokens', 0] },
          { $ifNull: ['$cachedInputTokens', 0] },
          { $ifNull: ['$outputTokens', 0] },
          { $ifNull: ['$reasoningTokens', 0] }
        ]
      },
      0
    ]
  };
}

function usageMeteringGroupFields() {
  const hasTokenEvidence = usageTokenEvidenceExpression();
  const metered = {
    $or: [
      { $eq: ['$usageReported', true] },
      hasTokenEvidence
    ]
  };
  const noTokenEvidence = { $not: [usageTokenEvidenceExpression()] };
  return {
    meteredExecutions: { $sum: { $cond: [metered, 1, 0] } },
    unmeteredExecutions: {
      $sum: {
        $cond: [
          {
            $and: [
              { $eq: ['$usageReported', false] },
              noTokenEvidence
            ]
          },
          1,
          0
        ]
      }
    },
    unknownMeteringExecutions: {
      $sum: {
        $cond: [
          {
            $and: [
              { $eq: [{ $ifNull: ['$usageReported', null] }, null] },
              { $not: [usageTokenEvidenceExpression()] }
            ]
          },
          1,
          0
        ]
      }
    }
  };
}

function deriveUsageEventId(input = {}) {
  if (input.eventId) {
    const explicit = String(input.eventId).trim();
    if (!explicit || explicit.length > 200) {
      const error = new Error('AI usage eventId must be between 1 and 200 characters');
      error.code = 'AI_USAGE_EVENT_ID_INVALID';
      throw error;
    }
    return explicit;
  }
  const identity = [
    input.requestId,
    input.sourceApp || 'recruiter',
    input.activity,
    input.provider,
    input.model,
    input.status,
    input.providerRequestId,
    input.failoverFrom,
    input.jobId,
    input.sessionId,
    input.credential
  ].map(idValue);
  return `usage_${stableHash(identity).slice(0, 48)}`;
}

function usageEventFingerprint(input, usage, createdAt) {
  return stableHash({
    requestId: idValue(input.requestId),
    providerRequestId: idValue(input.providerRequestId),
    ...(input.gatewayExecutionId ? { gatewayExecutionId: idValue(input.gatewayExecutionId) } : {}),
    ...(input.meteringOrigin ? {
      meteringOrigin: idValue(input.meteringOrigin),
      atSourceOnly: input.atSourceOnly === true
    } : {}),
    sourceApp: input.sourceApp || 'recruiter',
    activity: idValue(input.activity),
    provider: idValue(input.provider),
    model: idValue(input.model),
    reasoningEffort: idValue(input.reasoningEffort),
    routeVersion: Number(input.routeVersion || 0),
    promptVersion: idValue(input.promptVersion || '1'),
    credential: idValue(input.credential),
    credentialLabel: idValue(input.credentialLabel),
    status: idValue(input.status),
    quotaGroup: idValue(input.quotaGroup),
    organizationId: idValue(input.organizationId),
    organizationName: idValue(input.organizationName),
    actorId: idValue(input.actorId),
    actorName: idValue(input.actorName),
    actorEmail: idValue(input.actorEmail),
    interviewId: idValue(input.interviewId),
    sessionId: idValue(input.sessionId),
    jobId: idValue(input.jobId),
    candidateId: idValue(input.candidateId),
    httpStatus: Number(input.httpStatus || 0),
    errorCode: idValue(input.errorCode),
    errorMessage: sanitizeMessage(input.errorMessage),
    attempts: Number(input.attempts || 1),
    failovers: Number(input.failovers || 0),
    failoverFrom: idValue(input.failoverFrom),
    failoverReason: idValue(input.failoverReason),
    attemptErrors: input.attemptErrors || [],
    latencyMs: Number(input.latencyMs || 0),
    promptBytes: Number(input.promptBytes || 0),
    responseBytes: Number(input.responseBytes || 0),
    usageReported: input.usageReported,
    usageSource: idValue(input.usageSource),
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: Number(input.estimatedCostUsd || 0),
    rateLimit: input.rateLimit || {},
    // Calls which do not provide a historical timestamp remain retry-safe: the
    // first insert owns its generated timestamp.
    createdAt: input.createdAt ? createdAt.toISOString() : null
  });
}

async function reserveProjectionSequences(count = 1) {
  const amount = Math.max(1, Math.floor(Number(count) || 1));
  const state = await AIUsageProjectionState.findOneAndUpdate(
    { _id: PROJECTION_SEQUENCE_ID },
    { $inc: { value: amount } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  const last = Number(state.value);
  return { first: last - amount + 1, last };
}

async function allocateProjectionSequence() {
  const reservation = await reserveProjectionSequences(1);
  return reservation.last;
}

function eventObject(document) {
  if (!document) return null;
  return typeof document.toObject === 'function' ? document.toObject() : { ...document };
}

function isDuplicateKey(error) {
  return Number(error?.code) === 11000;
}

function identityConflict(eventId) {
  const error = new Error(`AI usage event identity conflict for ${eventId}`);
  error.code = 'AI_USAGE_IDENTITY_CONFLICT';
  return error;
}

function atSourceMeteringCore(event = {}) {
  return stableHash({
    eventId: idValue(event.eventId),
    gatewayExecutionId: idValue(event.gatewayExecutionId),
    requestId: idValue(event.requestId),
    providerRequestId: idValue(event.providerRequestId),
    sourceApp: event.sourceApp || 'recruiter',
    activity: idValue(event.activity),
    provider: idValue(event.provider),
    model: idValue(event.model),
    status: idValue(event.status),
    usageReported: event.usageReported === true,
    usageSource: idValue(event.usageSource),
    inputTokens: Number(event.inputTokens || 0),
    cachedInputTokens: Number(event.cachedInputTokens || 0),
    outputTokens: Number(event.outputTokens || 0),
    reasoningTokens: Number(event.reasoningTokens || 0),
    totalTokens: Number(event.totalTokens || 0)
  });
}

function isAtSourceEvent(event = {}) {
  return event.atSourceOnly === true
    && event.meteringOrigin === 'local-gateway-at-source';
}

function isBackendMeteringEvent(event = {}) {
  return event.atSourceOnly !== true
    && ['backend-response', 'reconciled'].includes(event.meteringOrigin);
}

function sameAtSourceMeteringIdentity(existing, incoming) {
  return /^localexec_[a-f0-9]{48}$/.test(String(existing?.gatewayExecutionId || ''))
    && existing.gatewayExecutionId === incoming?.gatewayExecutionId
    && atSourceMeteringCore(existing) === atSourceMeteringCore(incoming);
}

async function reconcileAtSourceEvent(existing, incoming, incomingFingerprint) {
  const set = {};
  const immutable = new Set([
    '_id',
    '__v',
    'eventId',
    'projectionSequence',
    'createdAt',
    'recordedAt',
    'expiresAt'
  ]);
  for (const [key, value] of Object.entries(incoming)) {
    if (!immutable.has(key) && value !== undefined) set[key] = value;
  }
  Object.assign(set, {
    eventFingerprint: incomingFingerprint,
    meteringOrigin: 'reconciled',
    atSourceOnly: false,
    reconciledAt: new Date(),
    dailyRollupProjectedAt: null,
    logicalRollupProjectedAt: null,
    quotaProjectedAt: null
  });
  const filter = {
    _id: existing._id,
    ...(existing.eventFingerprint
      ? { eventFingerprint: existing.eventFingerprint }
      : { $or: [{ eventFingerprint: null }, { eventFingerprint: { $exists: false } }] })
  };
  return AIUsageEvent.findOneAndUpdate(
    filter,
    {
      $set: set,
      $unset: { projectionLastError: '' }
    },
    { new: true }
  ).lean();
}

async function insertAuthoritativeEvent(event, fingerprint, attempt = 0) {
  const sequence = await allocateProjectionSequence();
  try {
    const created = await AIUsageEvent.create({
      ...event,
      eventFingerprint: fingerprint,
      projectionSequence: sequence,
      recordedAt: new Date()
    });
    return { event: eventObject(created), created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await AIUsageEvent.findOne({ eventId: event.eventId }).lean();
    if (!existing) throw error;
    if (existing.eventFingerprint && existing.eventFingerprint !== fingerprint) {
      if (sameAtSourceMeteringIdentity(existing, event)) {
        if (isAtSourceEvent(existing) && isBackendMeteringEvent(event)) {
          const reconciled = await reconcileAtSourceEvent(existing, event, fingerprint);
          if (reconciled) {
            return {
              event: reconciled,
              created: false,
              reconciled: true,
              previousEvent: existing
            };
          }
          if (attempt < 2) return insertAuthoritativeEvent(event, fingerprint, attempt + 1);
        }
        if (isBackendMeteringEvent(existing) && isAtSourceEvent(event)) {
          return { event: existing, created: false, reconciled: false };
        }
      }
      throw identityConflict(event.eventId);
    }
    return { event: existing, created: false };
  }
}

function normalizedEventDimensions(event) {
  return {
    day: utcDay(event.createdAt || new Date()),
    sourceApp: event.sourceApp || 'recruiter',
    activity: idValue(event.activity),
    provider: idValue(event.provider),
    model: idValue(event.model),
    quotaGroup: idValue(event.quotaGroup),
    organizationId: idValue(event.organizationId),
    actorId: idValue(event.actorId)
  };
}

function nullableDimension(field, value, defaultValue = '') {
  if (value !== defaultValue) return { [field]: value };
  return {
    $or: [
      { [field]: defaultValue },
      { [field]: null },
      { [field]: { $exists: false } }
    ]
  };
}

function dailyEventMatch(dimensions) {
  const nextDay = new Date(dimensions.day.getTime() + 24 * 60 * 60 * 1000);
  const sourceCondition = dimensions.sourceApp === 'recruiter'
    ? {
        $or: [
          { sourceApp: 'recruiter' },
          { sourceApp: null },
          { sourceApp: { $exists: false } }
        ]
      }
    : { sourceApp: dimensions.sourceApp };
  return {
    $and: [
      { createdAt: { $gte: dimensions.day, $lt: nextDay } },
      sourceCondition,
      { activity: dimensions.activity },
      { provider: dimensions.provider },
      { model: dimensions.model },
      nullableDimension('quotaGroup', dimensions.quotaGroup),
      nullableDimension('organizationId', dimensions.organizationId),
      nullableDimension('actorId', dimensions.actorId),
      { projectionExcluded: { $ne: true } }
    ]
  };
}

function dailyRollupFilter(dimensions) {
  return {
    day: dimensions.day,
    sourceApp: dimensions.sourceApp,
    activity: dimensions.activity,
    provider: dimensions.provider,
    model: dimensions.model,
    quotaGroup: dimensions.quotaGroup,
    organizationId: dimensions.organizationId,
    actorId: dimensions.actorId
  };
}

function projectionCasFilter(filter, watermark, projectionHash, force, sameWatermarkGuard = {}) {
  const sameWatermark = {
    projectionWatermark: watermark,
    ...(force ? {} : sameWatermarkGuard),
    ...(force
      ? {}
      : {
          $or: [
            { projectionHash: { $ne: projectionHash } },
            { projectionVersion: { $lt: PROJECTION_VERSION } },
            { projectionVersion: { $exists: false } }
          ]
        })
  };
  return {
    ...filter,
    $or: [
      { projectionWatermark: { $exists: false } },
      { projectionWatermark: { $lt: watermark } },
      sameWatermark
    ]
  };
}

async function findProjectedDocument(model, filter, casFilter, values) {
  try {
    return await model.findOneAndUpdate(
      casFilter,
      { $set: values },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (error) {
    // A concurrent projector may win the unique-key upsert race. Retry the
    // compare-and-set without upsert: if this projector has the larger
    // watermark it must still replace the just-created lower-watermark row.
    if (!isDuplicateKey(error)) throw error;
    const updated = await model.findOneAndUpdate(
      casFilter,
      { $set: values },
      { upsert: false, new: true }
    ).lean();
    if (updated) return updated;
    return model.findOne(filter).lean();
  }
}

async function projectDailyRollup(event, { force = false, skipDriftRepair = false } = {}) {
  const dimensions = normalizedEventDimensions(event);
  const match = dailyEventMatch(dimensions);
  const [totals] = await AIUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        calls: { $sum: 1 },
        successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
        cachedInputTokens: { $sum: { $ifNull: ['$cachedInputTokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
        reasoningTokens: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
        totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
        estimatedCostUsd: { $sum: { $ifNull: ['$estimatedCostUsd', 0] } },
        latencyTotalMs: { $sum: { $ifNull: ['$latencyMs', 0] } },
        latencyMaxMs: { $max: { $ifNull: ['$latencyMs', 0] } },
        ...usageMeteringGroupFields(),
        projectionWatermark: { $max: '$projectionSequence' }
      }
    }
  ]);
  if (!totals || !Number.isFinite(Number(totals.projectionWatermark))) return null;

  const latest = await AIUsageEvent.findOne(match)
    .sort({ recordedAt: -1, projectionSequence: -1 })
    .select('organizationName actorName')
    .lean();
  const exact = {
    organizationName: latest?.organizationName || '',
    actorName: latest?.actorName || '',
    calls: Number(totals.calls || 0),
    successes: Number(totals.successes || 0),
    failures: Number(totals.failures || 0),
    inputTokens: Number(totals.inputTokens || 0),
    cachedInputTokens: Number(totals.cachedInputTokens || 0),
    outputTokens: Number(totals.outputTokens || 0),
    reasoningTokens: Number(totals.reasoningTokens || 0),
    totalTokens: Number(totals.totalTokens || 0),
    estimatedCostUsd: Number(totals.estimatedCostUsd || 0),
    latencyTotalMs: Number(totals.latencyTotalMs || 0),
    latencyMaxMs: Number(totals.latencyMaxMs || 0),
    meteredExecutions: Number(totals.meteredExecutions || 0),
    unmeteredExecutions: Number(totals.unmeteredExecutions || 0),
    unknownMeteringExecutions: Number(totals.unknownMeteringExecutions || 0)
  };
  const projectionWatermark = Number(totals.projectionWatermark);
  const projectionHash = stableHash(exact);
  const filter = dailyRollupFilter(dimensions);
  const values = {
    ...filter,
    ...exact,
    projectionWatermark,
    projectionVersion: PROJECTION_VERSION,
    projectionHash,
    projectedAt: new Date()
  };
  const rollup = await findProjectedDocument(
    AIUsageDailyRollup,
    filter,
    projectionCasFilter(
      filter,
      projectionWatermark,
      projectionHash,
      force,
      { calls: { $lte: exact.calls } }
    ),
    values
  );
  await AIUsageEvent.updateMany(
    {
      ...match,
      projectionSequence: { $lte: projectionWatermark },
      dailyRollupProjectedAt: null
    },
    {
      $set: { dailyRollupProjectedAt: new Date() },
      $unset: { projectionLastError: '' }
    }
  );
  if (!skipDriftRepair && event.atSourceOnly === true && event._id) {
    const current = await AIUsageEvent.findById(event._id).lean();
    if (current && !sameDailyDimensions(event, current)) {
      await repairVacatedDailyRollup(event, current);
    }
  }
  return rollup;
}

function sameDailyDimensions(left, right) {
  const a = normalizedEventDimensions(left);
  const b = normalizedEventDimensions(right);
  return stableHash(a) === stableHash(b);
}

async function repairVacatedDailyRollup(previousEvent, currentEvent) {
  if (!previousEvent || sameDailyDimensions(previousEvent, currentEvent)) return;
  const dimensions = normalizedEventDimensions(previousEvent);
  const match = dailyEventMatch(dimensions);
  if (await AIUsageEvent.countDocuments(match)) {
    await projectDailyRollup(previousEvent, { force: true, skipDriftRepair: true });
    return;
  }
  await AIUsageDailyRollup.deleteOne(dailyRollupFilter(dimensions));
}

function logicalRequestKey(event) {
  return stableHash([
    event.sourceApp || 'recruiter',
    idValue(event.requestId)
  ]);
}

function logicalRequestEventMatch(event) {
  const sourceApp = event.sourceApp || 'recruiter';
  const sourceCondition = sourceApp === 'recruiter'
    ? {
        $or: [
          { sourceApp: 'recruiter' },
          { sourceApp: null },
          { sourceApp: { $exists: false } }
        ]
      }
    : { sourceApp };
  return {
    $and: [
      sourceCondition,
      { requestId: idValue(event.requestId) },
      { projectionExcluded: { $ne: true } }
    ]
  };
}

async function projectLogicalRequest(event, { force = false } = {}) {
  const match = logicalRequestEventMatch(event);
  const [totals] = await AIUsageEvent.aggregate([
    { $match: match },
    { $sort: { projectionSequence: 1, _id: 1 } },
    {
      $group: {
        _id: null,
        activity: { $last: '$activity' },
        firstCreatedAt: { $min: '$createdAt' },
        statuses: { $addToSet: '$status' },
        latencyTotalMs: { $sum: { $ifNull: ['$latencyMs', 0] } },
        latencyMaxMs: { $max: { $ifNull: ['$latencyMs', 0] } },
        failovers: { $max: { $ifNull: ['$failovers', 0] } },
        executionCount: { $sum: 1 },
        ...usageMeteringGroupFields(),
        projectionWatermark: { $max: '$projectionSequence' }
      }
    }
  ]);
  if (!totals || !Number.isFinite(Number(totals.projectionWatermark))) return null;

  const exact = {
    sourceApp: event.sourceApp || 'recruiter',
    activity: idValue(totals.activity || event.activity),
    day: utcDay(totals.firstCreatedAt || event.createdAt || new Date()),
    status: Array.isArray(totals.statuses) && totals.statuses.includes('success')
      ? 'success'
      : 'failed',
    latencyTotalMs: Number(totals.latencyTotalMs || 0),
    latencyMaxMs: Number(totals.latencyMaxMs || 0),
    failovers: Number(totals.failovers || 0),
    executionCount: Number(totals.executionCount || 0),
    meteredExecutions: Number(totals.meteredExecutions || 0),
    unmeteredExecutions: Number(totals.unmeteredExecutions || 0),
    unknownMeteringExecutions: Number(totals.unknownMeteringExecutions || 0)
  };
  const projectionWatermark = Number(totals.projectionWatermark);
  const projectionHash = stableHash(exact);
  const filter = { requestKey: logicalRequestKey(event) };
  const values = {
    ...filter,
    ...exact,
    projectionWatermark,
    projectionVersion: PROJECTION_VERSION,
    projectionHash,
    projectedAt: new Date()
  };
  const logicalRequest = await findProjectedDocument(
    AIUsageLogicalRequest,
    filter,
    projectionCasFilter(
      filter,
      projectionWatermark,
      projectionHash,
      force,
      { executionCount: { $lte: exact.executionCount } }
    ),
    values
  );
  await AIUsageEvent.updateMany(
    {
      ...match,
      projectionSequence: { $lte: projectionWatermark },
      logicalRollupProjectedAt: null
    },
    {
      $set: { logicalRollupProjectedAt: new Date() },
      $unset: { projectionLastError: '' }
    }
  );
  return logicalRequest;
}

function quotaEventMatch(event) {
  return {
    provider: idValue(event.provider),
    quotaGroup: idValue(event.quotaGroup),
    model: idValue(event.model),
    projectionExcluded: { $ne: true }
  };
}

function quotaSnapshotFilter(event) {
  return {
    provider: idValue(event.provider),
    quotaGroup: idValue(event.quotaGroup),
    model: idValue(event.model)
  };
}

async function projectQuotaSnapshot(event, { force = false } = {}) {
  if (!event.quotaGroup || !event.model) {
    if (event._id) {
      await AIUsageEvent.updateOne(
        { _id: event._id },
        { $set: { quotaProjectedAt: new Date() }, $unset: { projectionLastError: '' } }
      );
    }
    return null;
  }
  const match = quotaEventMatch(event);
  const [bounds] = await AIUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        projectionWatermark: { $max: '$projectionSequence' },
        latestCreatedAt: { $max: '$createdAt' }
      }
    }
  ]);
  if (!bounds || !Number.isFinite(Number(bounds.projectionWatermark))) return null;

  const day = utcDay(bounds.latestCreatedAt);
  const minute = utcMinute(bounds.latestCreatedAt);
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const nextMinute = new Date(minute.getTime() + 60 * 1000);
  const [counters] = await AIUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        localRequestsToday: {
          $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', day] }, { $lt: ['$createdAt', nextDay] }] }, 1, 0] }
        },
        localTokensToday: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$createdAt', day] }, { $lt: ['$createdAt', nextDay] }] },
              { $ifNull: ['$totalTokens', 0] },
              0
            ]
          }
        },
        localRequestsMinute: {
          $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', minute] }, { $lt: ['$createdAt', nextMinute] }] }, 1, 0] }
        },
        localTokensMinute: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$createdAt', minute] }, { $lt: ['$createdAt', nextMinute] }] },
              { $ifNull: ['$totalTokens', 0] },
              0
            ]
          }
        }
      }
    }
  ]);
  const latest = await AIUsageEvent.findOne(match)
    .sort({ recordedAt: -1, projectionSequence: -1 })
    .select('createdAt recordedAt status httpStatus errorCode rateLimit')
    .lean();
  const exact = {
    localDay: day,
    localRequestsToday: Number(counters?.localRequestsToday || 0),
    localTokensToday: Number(counters?.localTokensToday || 0),
    localMinute: minute,
    localRequestsMinute: Number(counters?.localRequestsMinute || 0),
    localTokensMinute: Number(counters?.localTokensMinute || 0)
  };
  const rateLimit = latest?.rateLimit || {};
  for (const field of RATE_LIMIT_FIELDS) {
    if (rateLimit[field] !== null && rateLimit[field] !== undefined) exact[field] = rateLimit[field];
  }
  if (latest?.errorCode === 'rate_limit_exceeded' || latest?.httpStatus === 429) {
    exact.blockedUntil = rateLimit.retryAfterMs
      ? new Date(new Date(latest.createdAt).getTime() + Number(rateLimit.retryAfterMs))
      : rateLimit.tokenResetAt || rateLimit.requestResetAt || new Date(new Date(latest.createdAt).getTime() + 60_000);
    exact.blockedReason = 'rate_limit';
  }

  const projectionWatermark = Number(bounds.projectionWatermark);
  const projectionHash = stableHash(exact);
  const filter = quotaSnapshotFilter(event);
  const values = {
    ...filter,
    ...exact,
    observedAt: latest?.recordedAt || latest?.createdAt || new Date(),
    projectionWatermark,
    projectionVersion: PROJECTION_VERSION,
    projectionHash,
    projectedAt: new Date()
  };
  const quota = await findProjectedDocument(
    AIQuotaSnapshot,
    filter,
    projectionCasFilter(filter, projectionWatermark, projectionHash, force),
    values
  );
  await AIUsageEvent.updateMany(
    {
      ...match,
      projectionSequence: { $lte: projectionWatermark },
      quotaProjectedAt: null
    },
    {
      $set: { quotaProjectedAt: new Date() },
      $unset: { projectionLastError: '' }
    }
  );
  return quota;
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

async function markProjectionFailure(event, error) {
  if (!event?._id) return;
  await AIUsageEvent.updateOne(
    { _id: event._id },
    {
      $set: {
        projectionLastError: sanitizeMessage(error.message || error)
      }
    }
  ).catch(() => {});
}

async function projectStoredEvent(event, { force = false } = {}) {
  if (event.projectionExcluded) {
    if (event._id) {
      const projectedAt = new Date();
      await AIUsageEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            dailyRollupProjectedAt: projectedAt,
            logicalRollupProjectedAt: projectedAt,
            quotaProjectedAt: projectedAt
          },
          $unset: { projectionLastError: '' }
        }
      );
    }
    return { rollup: null, logicalRequest: null, quota: null };
  }

  let rollup = null;
  let logicalRequest = null;
  let quota = null;
  const errors = [];
  try {
    rollup = await projectDailyRollup(event, { force });
  } catch (error) {
    errors.push(error);
  }
  try {
    logicalRequest = await projectLogicalRequest(event, { force });
  } catch (error) {
    errors.push(error);
  }
  try {
    quota = await projectQuotaSnapshot(event, { force });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    const error = errors.length === 1
      ? errors[0]
      : new AggregateError(errors, 'One or more AI usage projections failed');
    await markProjectionFailure(event, error);
    throw error;
  }
  return { rollup, logicalRequest, quota };
}

async function ensureProjectionSequenceFloor() {
  const latest = await AIUsageEvent.findOne({ projectionSequence: { $type: 'number' } })
    .sort({ projectionSequence: -1 })
    .select('projectionSequence')
    .lean();
  const floor = Number(latest?.projectionSequence || 0);
  await AIUsageProjectionState.findOneAndUpdate(
    { _id: PROJECTION_SEQUENCE_ID },
    { $max: { value: floor } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return floor;
}

async function migrateLegacyUsageEvents({ batchSize = 250 } = {}) {
  await ensureProjectionSequenceFloor();
  let migrated = 0;
  let duplicates = 0;
  while (true) {
    const batch = await AIUsageEvent.find({
      $or: [
        { eventId: { $exists: false } },
        { eventId: null },
        { eventId: '' },
        { eventFingerprint: { $exists: false } },
        { projectionSequence: { $exists: false } },
        { projectionSequence: null }
      ]
    })
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!batch.length) break;

    const needsSequence = batch.filter((item) => !Number.isFinite(Number(item.projectionSequence)));
    const reservation = needsSequence.length
      ? await reserveProjectionSequences(needsSequence.length)
      : null;
    let nextSequence = reservation?.first;

    for (const item of batch) {
      const usage = normalizeUsage(item);
      const canonicalEventId = deriveUsageEventId(item);
      const canonical = await AIUsageEvent.findOne({
        eventId: canonicalEventId,
        _id: { $ne: item._id }
      }).select('_id').lean();
      const isDuplicate = Boolean(canonical);
      const eventId = isDuplicate
        ? `legacy_duplicate_${String(item._id)}`
        : canonicalEventId;
      const fingerprint = usageEventFingerprint(item, usage, new Date(item.createdAt || Date.now()));
      const update = {
        eventId,
        eventFingerprint: fingerprint,
        recordedAt: item.recordedAt || item.createdAt || new Date(),
        ...(Number.isFinite(Number(item.projectionSequence))
          ? {}
          : { projectionSequence: nextSequence++ })
      };
      if (isDuplicate) {
        update.projectionExcluded = true;
        update.projectionDuplicateOf = canonical._id;
        duplicates += 1;
      }
      await AIUsageEvent.updateOne({ _id: item._id }, { $set: update });
      migrated += 1;
    }
  }
  await AIUsageEvent.createIndexes();
  await AIUsageLogicalRequest.createIndexes();
  return { migrated, duplicates };
}

function rollupKey(value) {
  const dimensions = value.day
    ? value
    : normalizedEventDimensions(value);
  return [
    new Date(dimensions.day).toISOString(),
    dimensions.sourceApp || 'recruiter',
    idValue(dimensions.activity),
    idValue(dimensions.provider),
    idValue(dimensions.model),
    idValue(dimensions.quotaGroup),
    idValue(dimensions.organizationId),
    idValue(dimensions.actorId)
  ].join('\u001f');
}

function quotaKey(value) {
  return [
    idValue(value.provider),
    idValue(value.quotaGroup),
    idValue(value.model)
  ].join('\u001f');
}

function defaultProjectionRepairSince(now = new Date()) {
  // TTL expiry can leave the oldest retained UTC day only partially present.
  // Rebuild the 89 complete days for which the raw ledger is guaranteed to be
  // whole, while leaving the already-materialized boundary day untouched.
  return utcDay(new Date(
    new Date(now).getTime() - (EVENT_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
  ));
}

async function rebuildAllUsageProjections({
  since = defaultProjectionRepairSince()
} = {}) {
  const canonicalMatch = {
    createdAt: { $gte: since },
    projectionExcluded: { $ne: true },
    projectionSequence: { $type: 'number' }
  };
  const [dailyGroups, quotaGroups, logicalGroups, eventCount] = await Promise.all([
    AIUsageEvent.aggregate([
      { $match: canonicalMatch },
      {
        $group: {
          _id: {
            day: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' } },
            sourceApp: { $ifNull: ['$sourceApp', 'recruiter'] },
            activity: '$activity',
            provider: '$provider',
            model: '$model',
            quotaGroup: { $ifNull: ['$quotaGroup', ''] },
            organizationId: { $ifNull: ['$organizationId', ''] },
            actorId: { $ifNull: ['$actorId', ''] }
          }
        }
      }
    ]),
    AIUsageEvent.aggregate([
      {
        $match: {
          ...canonicalMatch,
          quotaGroup: { $exists: true, $nin: [null, ''] },
          model: { $exists: true, $nin: [null, ''] }
        }
      },
      {
        $group: {
          _id: {
            provider: '$provider',
            quotaGroup: '$quotaGroup',
            model: '$model'
          }
        }
      }
    ]),
    AIUsageEvent.aggregate([
      { $match: canonicalMatch },
      {
        $group: {
          _id: {
            sourceApp: { $ifNull: ['$sourceApp', 'recruiter'] },
            requestId: '$requestId'
          },
          activity: { $last: '$activity' },
          createdAt: { $min: '$createdAt' }
        }
      }
    ]),
    AIUsageEvent.countDocuments(canonicalMatch)
  ]);
  const dailyBuckets = new Map();
  const quotaBuckets = new Map();
  const logicalKeys = new Set();
  for (const group of dailyGroups) {
    const event = {
      createdAt: group._id.day,
      sourceApp: group._id.sourceApp,
      activity: group._id.activity,
      provider: group._id.provider,
      model: group._id.model,
      quotaGroup: group._id.quotaGroup,
      organizationId: group._id.organizationId,
      actorId: group._id.actorId
    };
    dailyBuckets.set(rollupKey(event), event);
  }
  for (const group of quotaGroups) {
    const event = { ...group._id };
    quotaBuckets.set(quotaKey(event), event);
  }
  for (const group of logicalGroups) {
    logicalKeys.add(logicalRequestKey({
      sourceApp: group._id.sourceApp,
      requestId: group._id.requestId
    }));
  }

  for (const event of dailyBuckets.values()) {
    await projectDailyRollup(event, { force: true });
  }
  for (const event of quotaBuckets.values()) {
    await projectQuotaSnapshot(event, { force: true });
  }
  for (const group of logicalGroups) {
    await projectLogicalRequest({
      sourceApp: group._id.sourceApp,
      requestId: group._id.requestId,
      activity: group.activity,
      createdAt: group.createdAt
    }, { force: true });
  }

  // A previous Promise.all implementation could increment a rollup even when
  // its raw event insert failed. Within the retained-event window there is
  // enough source data to prove and remove those ghost buckets.
  let removedGhostRollups = 0;
  const recentRollups = await AIUsageDailyRollup.find({ day: { $gte: utcDay(since) } }).lean();
  for (const rollup of recentRollups) {
    if (dailyBuckets.has(rollupKey(rollup))) continue;
    const result = await AIUsageDailyRollup.deleteOne({ _id: rollup._id });
    removedGhostRollups += Number(result.deletedCount || 0);
  }

  let removedGhostLogicalRequests = 0;
  const recentLogicalRequests = await AIUsageLogicalRequest.find({
    day: { $gte: utcDay(since) }
  }).lean();
  for (const logicalRequest of recentLogicalRequests) {
    if (logicalKeys.has(logicalRequest.requestKey)) continue;
    const result = await AIUsageLogicalRequest.deleteOne({ _id: logicalRequest._id });
    removedGhostLogicalRequests += Number(result.deletedCount || 0);
  }

  let resetGhostQuotaSnapshots = 0;
  const recentQuotaSnapshots = await AIQuotaSnapshot.find({
    localDay: { $gte: utcDay(since) }
  }).lean();
  for (const snapshot of recentQuotaSnapshots) {
    if (quotaBuckets.has(quotaKey(snapshot))) continue;
    const exact = {
      localRequestsToday: 0,
      localTokensToday: 0,
      localRequestsMinute: 0,
      localTokensMinute: 0
    };
    const result = await AIQuotaSnapshot.updateOne(
      { _id: snapshot._id },
      {
        $set: {
          ...exact,
          projectionWatermark: 0,
          projectionVersion: PROJECTION_VERSION,
          projectionHash: stableHash(exact),
          projectedAt: new Date()
        }
      }
    );
    resetGhostQuotaSnapshots += Number(result.modifiedCount || 0);
  }

  const projectedAt = new Date();
  await AIUsageEvent.updateMany(
    canonicalMatch,
    { $set: { logicalRollupProjectedAt: projectedAt } }
  );
  await AIUsageEvent.updateMany(
    { projectionExcluded: true },
    {
      $set: {
        dailyRollupProjectedAt: projectedAt,
        logicalRollupProjectedAt: projectedAt,
        quotaProjectedAt: projectedAt
      },
      $unset: { projectionLastError: '' }
    }
  );
  return {
    events: eventCount,
    dailyBuckets: dailyBuckets.size,
    logicalRequests: logicalGroups.length,
    quotaBuckets: quotaBuckets.size,
    removedGhostRollups,
    removedGhostLogicalRequests,
    resetGhostQuotaSnapshots
  };
}

async function repairUsageProjections({
  limit = 500,
  force = true,
  since = defaultProjectionRepairSince()
} = {}) {
  const cutoff = since == null ? null : new Date(since);
  if (cutoff && !Number.isFinite(cutoff.getTime())) {
    throw new TypeError('AI usage projection repair cutoff is invalid');
  }
  const pendingFilter = {
    projectionExcluded: { $ne: true },
    ...(cutoff ? { createdAt: { $gte: cutoff } } : {}),
    $or: [
      { dailyRollupProjectedAt: null },
      { logicalRollupProjectedAt: null },
      { quotaProjectedAt: null },
      { projectionLastError: { $exists: true, $ne: '' } }
    ]
  };
  const pending = await AIUsageEvent.find(pendingFilter)
    .sort({ projectionSequence: 1, _id: 1 })
    .limit(Math.max(1, Number(limit) || 500))
    .lean();
  let repaired = 0;
  const errors = [];
  for (const event of pending) {
    try {
      await projectStoredEvent(event, { force });
      repaired += 1;
    } catch (error) {
      errors.push({ eventId: event.eventId, error: sanitizeMessage(error.message) });
    }
  }
  const remaining = await AIUsageEvent.countDocuments(pendingFilter);
  return { processed: pending.length, repaired, remaining, errors };
}

let projectionRepairTimer = null;
let projectionRepairInFlight = null;
let projectionRepairGeneration = 0;
let projectionRepairNextDelayMs = null;
let projectionRepairRequested = false;
let projectionRepairHealth = {
  status: 'idle',
  processed: 0,
  remaining: 0,
  lastError: null,
  updatedAt: null
};

async function writeProjectionRepairState(values) {
  await AIUsageProjectionState.updateOne(
    { _id: PROJECTION_REPAIR_STATE_ID },
    {
      $set: {
        value: 0,
        repairOwner: COMPATIBILITY_OWNER_ID,
        ...values
      }
    },
    { upsert: true }
  );
}

function setProjectionRepairHealth(values) {
  projectionRepairHealth = {
    ...projectionRepairHealth,
    ...values,
    updatedAt: new Date().toISOString()
  };
}

async function runObservableProjectionRepair(options = {}) {
  const startedAt = new Date();
  setProjectionRepairHealth({ status: 'running', lastError: null });
  await writeProjectionRepairState({
    repairStatus: 'running',
    repairStartedAt: startedAt,
    repairLastError: null
  });
  try {
    const result = await repairUsageProjections(options);
    const lastError = result.errors?.length
      ? result.errors.map((item) => `${item.eventId}: ${item.error}`).join('; ').slice(0, 600)
      : null;
    const status = lastError ? 'failed' : Number(result.remaining || 0) > 0 ? 'idle' : 'complete';
    setProjectionRepairHealth({
      status,
      processed: Number(result.processed || 0),
      remaining: Number(result.remaining || 0),
      lastError
    });
    await writeProjectionRepairState({
      repairStatus: status,
      repairCompletedAt: new Date(),
      repairProcessed: Number(result.processed || 0),
      repairRemaining: Number(result.remaining || 0),
      repairLastError: lastError
    });
    return result;
  } catch (error) {
    const lastError = sanitizeMessage(error.message);
    setProjectionRepairHealth({ status: 'failed', lastError });
    await writeProjectionRepairState({
      repairStatus: 'failed',
      repairCompletedAt: new Date(),
      repairLastError: lastError
    }).catch(() => {});
    throw error;
  }
}

async function repairPendingUsageProjectionsOnStartup({
  batchLimit = REPAIR_BATCH_LIMIT,
  maxBatches = 10_000
} = {}) {
  let batches = 0;
  let processed = 0;
  let repaired = 0;
  while (batches < Math.max(1, Number(maxBatches) || 10_000)) {
    const result = await runObservableProjectionRepair({
      limit: Math.min(500, Math.max(1, Number(batchLimit) || REPAIR_BATCH_LIMIT)),
      force: true
    });
    batches += 1;
    processed += Number(result.processed || 0);
    repaired += Number(result.repaired || 0);
    if (result.errors?.length) {
      const error = new Error(`AI usage projection repair failed for ${result.errors.length} event(s)`);
      error.code = 'AI_USAGE_PROJECTION_REPAIR_FAILED';
      error.details = result.errors;
      throw error;
    }
    if (Number(result.remaining || 0) === 0) {
      return { batches, processed, repaired, remaining: 0 };
    }
    if (Number(result.processed || 0) === 0) break;
  }
  const error = new Error('AI usage projection repair did not converge before startup');
  error.code = 'AI_USAGE_PROJECTION_REPAIR_INCOMPLETE';
  throw error;
}

function scheduleUsageProjectionRepair({
  delayMs = DEFAULT_REPAIR_DELAY_MS,
  baseDelayMs = DEFAULT_REPAIR_DELAY_MS,
  maxDelayMs = MAX_REPAIR_DELAY_MS,
  batchLimit = REPAIR_BATCH_LIMIT,
  repairFn = runObservableProjectionRepair
} = {}) {
  if (projectionRepairTimer || projectionRepairInFlight) {
    // Coalesce the wake-up without losing a failure which arrives after the
    // active repair's final remaining-count query.
    projectionRepairRequested = true;
    return false;
  }
  const generation = projectionRepairGeneration;
  const boundedBase = Math.max(1, Number(baseDelayMs) || DEFAULT_REPAIR_DELAY_MS);
  const boundedMaximum = Math.max(boundedBase, Number(maxDelayMs) || MAX_REPAIR_DELAY_MS);
  const boundedDelay = Math.min(
    boundedMaximum,
    Math.max(1, Number(delayMs) || boundedBase)
  );
  const boundedBatch = Math.min(500, Math.max(1, Number(batchLimit) || REPAIR_BATCH_LIMIT));
  setProjectionRepairHealth({
    status: 'idle',
    remaining: Math.max(1, Number(projectionRepairHealth.remaining || 0))
  });
  void writeProjectionRepairState({
    repairStatus: 'idle',
    repairRemaining: Math.max(1, Number(projectionRepairHealth.remaining || 0))
  }).catch(() => {});
  projectionRepairNextDelayMs = boundedDelay;
  projectionRepairTimer = setTimeout(() => {
    projectionRepairTimer = null;
    projectionRepairNextDelayMs = null;
    // Any request made while this timer was waiting is covered by this run.
    projectionRepairRequested = false;
    let shouldRetry = false;
    projectionRepairInFlight = Promise.resolve()
      .then(() => repairFn({ limit: boundedBatch, force: true }))
      .then((result) => {
        shouldRetry = Number(result?.remaining || 0) > 0 || Boolean(result?.errors?.length);
      })
      .catch((error) => {
        console.error('AI usage background projection repair failed:', sanitizeMessage(error.message));
        shouldRetry = true;
      })
      .finally(() => {
        const retry = shouldRetry || projectionRepairRequested;
        projectionRepairRequested = false;
        projectionRepairInFlight = null;
        if (generation !== projectionRepairGeneration || !retry) return;
        scheduleUsageProjectionRepair({
          delayMs: Math.min(boundedMaximum, Math.max(boundedBase, boundedDelay * 2)),
          baseDelayMs: boundedBase,
          maxDelayMs: boundedMaximum,
          batchLimit: boundedBatch,
          repairFn
        });
      });
  }, boundedDelay);
  // Telemetry repair must never keep a worker or one-off script alive.
  projectionRepairTimer.unref?.();
  return true;
}

function resetUsageProjectionRepairSchedulerForTests() {
  projectionRepairGeneration += 1;
  if (projectionRepairTimer) clearTimeout(projectionRepairTimer);
  projectionRepairTimer = null;
  projectionRepairNextDelayMs = null;
  projectionRepairRequested = false;
  projectionRepairInFlight = null;
  projectionRepairHealth = {
    status: 'idle',
    processed: 0,
    remaining: 0,
    lastError: null,
    updatedAt: null
  };
}

function usageProjectionRepairSchedulerState() {
  return {
    scheduled: Boolean(projectionRepairTimer),
    inFlight: Boolean(projectionRepairInFlight),
    nextDelayMs: projectionRepairNextDelayMs,
    requested: projectionRepairRequested
  };
}

function usageProjectionRepairHealth() {
  return {
    ...projectionRepairHealth,
    scheduled: Boolean(projectionRepairTimer),
    inFlight: Boolean(projectionRepairInFlight),
    healthy: projectionRepairHealth.status !== 'failed'
      && Number(projectionRepairHealth.remaining || 0) === 0
  };
}

let compatibilityPromise;
let meteringOutbox = usageMeteringOutbox;

async function runUsageProjectionCompatibility() {
  const migration = await migrateLegacyUsageEvents();
  const rebuild = await rebuildAllUsageProjections();
  return { migration, rebuild };
}

function compatibilityLeaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCompatibilityState(stateModel) {
  return stateModel.findById(COMPATIBILITY_STATE_ID).lean();
}

async function tryAcquireCompatibilityLease({
  stateModel,
  ownerId,
  version,
  leaseMs,
  now
}) {
  const leaseUntil = new Date(now.getTime() + leaseMs);
  try {
    const state = await stateModel.findOneAndUpdate(
      {
        _id: COMPATIBILITY_STATE_ID,
        $and: [
          {
            $or: [
              { compatibilityVersion: { $lt: version } },
              { compatibilityVersion: { $exists: false } },
              { compatibilityStatus: { $ne: 'complete' } }
            ]
          },
          {
            $or: [
              { compatibilityStatus: { $ne: 'running' } },
              { compatibilityLeaseUntil: { $lte: now } },
              { compatibilityLeaseUntil: null },
              { compatibilityLeaseUntil: { $exists: false } }
            ]
          }
        ]
      },
      {
        $set: {
          compatibilityVersion: version,
          compatibilityStatus: 'running',
          compatibilityOwner: ownerId,
          compatibilityLeaseUntil: leaseUntil,
          compatibilityStartedAt: now
        },
        $unset: {
          compatibilityCompletedAt: '',
          compatibilityLastError: '',
          compatibilityResult: ''
        },
        $setOnInsert: { value: 0 }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    ).lean();
    return state?.compatibilityOwner === ownerId
      && state?.compatibilityStatus === 'running'
      ? state
      : null;
  } catch (error) {
    // Two replicas can both observe a missing document and race the upsert.
    // The unique _id makes one the lease owner and the loser simply waits.
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

async function runWithCompatibilityLease({
  stateModel,
  ownerId,
  version,
  leaseMs,
  nowFn,
  runCompatibility
}) {
  const renewEveryMs = Math.max(10, Math.floor(leaseMs / 3));
  let stopped = false;
  let renewalPromise = Promise.resolve();
  const renew = () => {
    if (stopped) return;
    renewalPromise = renewalPromise
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        const now = new Date(nowFn());
        await stateModel.updateOne(
          {
            _id: COMPATIBILITY_STATE_ID,
            compatibilityVersion: version,
            compatibilityStatus: 'running',
            compatibilityOwner: ownerId
          },
          {
            $set: {
              compatibilityLeaseUntil: new Date(now.getTime() + leaseMs)
            }
          }
        );
      });
  };
  const renewalTimer = setInterval(renew, renewEveryMs);
  renewalTimer.unref?.();

  try {
    const result = await runCompatibility();
    stopped = true;
    clearInterval(renewalTimer);
    await renewalPromise.catch(() => {});
    const completedAt = new Date(nowFn());
    const completed = await stateModel.updateOne(
      {
        _id: COMPATIBILITY_STATE_ID,
        compatibilityVersion: version,
        compatibilityStatus: 'running',
        compatibilityOwner: ownerId
      },
      {
        $set: {
          compatibilityStatus: 'complete',
          compatibilityCompletedAt: completedAt,
          compatibilityLeaseUntil: completedAt,
          compatibilityResult: result
        },
        $unset: { compatibilityLastError: '' }
      }
    );
    if (Number(completed.modifiedCount || 0) !== 1) {
      throw compatibilityLeaseError(
        'AI_USAGE_COMPATIBILITY_LEASE_LOST',
        'AI usage projection compatibility lease was lost before completion'
      );
    }
    return {
      ...result,
      compatibilityVersion: version,
      compatibilityCoordinator: 'owner'
    };
  } catch (error) {
    stopped = true;
    clearInterval(renewalTimer);
    await renewalPromise.catch(() => {});
    const failedAt = new Date(nowFn());
    await stateModel.updateOne(
      {
        _id: COMPATIBILITY_STATE_ID,
        compatibilityVersion: version,
        compatibilityStatus: 'running',
        compatibilityOwner: ownerId
      },
      {
        $set: {
          compatibilityStatus: 'failed',
          compatibilityLeaseUntil: failedAt,
          compatibilityLastError: sanitizeMessage(error.message)
        }
      }
    ).catch(() => {});
    throw error;
  }
}

async function coordinateUsageProjectionCompatibility({
  stateModel = AIUsageProjectionState,
  ownerId = COMPATIBILITY_OWNER_ID,
  version = COMPATIBILITY_VERSION,
  leaseMs = DEFAULT_COMPATIBILITY_LEASE_MS,
  waitTimeoutMs = DEFAULT_COMPATIBILITY_WAIT_MS,
  pollMs = DEFAULT_COMPATIBILITY_POLL_MS,
  nowFn = Date,
  sleepFn = delay,
  runCompatibility = runUsageProjectionCompatibility
} = {}) {
  const boundedLeaseMs = Math.max(20, Number(leaseMs) || DEFAULT_COMPATIBILITY_LEASE_MS);
  const boundedPollMs = Math.max(5, Number(pollMs) || DEFAULT_COMPATIBILITY_POLL_MS);
  const boundedWaitMs = Math.max(
    boundedPollMs,
    Number(waitTimeoutMs) || DEFAULT_COMPATIBILITY_WAIT_MS
  );
  const startedAt = new Date(nowFn());
  const deadline = startedAt.getTime() + boundedWaitMs;

  while (true) {
    const state = await readCompatibilityState(stateModel);
    if (
      Number(state?.compatibilityVersion || 0) >= version
      && state?.compatibilityStatus === 'complete'
    ) {
      return {
        ...(state.compatibilityResult || {}),
        compatibilityVersion: state.compatibilityVersion,
        compatibilityCoordinator: state.compatibilityOwner === ownerId ? 'owner' : 'waiter'
      };
    }

    const now = new Date(nowFn());
    const acquired = await tryAcquireCompatibilityLease({
      stateModel,
      ownerId,
      version,
      leaseMs: boundedLeaseMs,
      now
    });
    if (acquired) {
      return runWithCompatibilityLease({
        stateModel,
        ownerId,
        version,
        leaseMs: boundedLeaseMs,
        nowFn,
        runCompatibility
      });
    }

    const remainingMs = deadline - new Date(nowFn()).getTime();
    if (remainingMs <= 0) {
      throw compatibilityLeaseError(
        'AI_USAGE_COMPATIBILITY_WAIT_TIMEOUT',
        `Timed out waiting for AI usage projection compatibility version ${version}`
      );
    }
    await sleepFn(Math.min(boundedPollMs, remainingMs));
  }
}

function ensureAIUsageProjectionCompatibility() {
  if (!compatibilityPromise) {
    compatibilityPromise = coordinateUsageProjectionCompatibility().catch((error) => {
      compatibilityPromise = null;
      throw error;
    });
  }
  return compatibilityPromise;
}

function resetUsageProjectionCompatibilityForTests() {
  compatibilityPromise = null;
}

function buildUsageEnvelope(input) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
  const usage = normalizeUsage(input.usage || input);
  const eventId = deriveUsageEventId(input);
  const fingerprint = usageEventFingerprint(input, usage, createdAt);
  const event = {
    ...input,
    ...usage,
    eventId,
    createdAt,
    errorMessage: sanitizeMessage(input.errorMessage),
    expiresAt: new Date(createdAt.getTime() + EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  };
  delete event.usage;
  delete event.pricing;
  return { event, fingerprint };
}

async function persistUsageEnvelope(envelope) {
  const { event, fingerprint } = envelope;
  let stored;
  try {
    stored = await insertAuthoritativeEvent(event, fingerprint);
  } catch (error) {
    throw error;
  }
  try {
    const projections = await projectStoredEvent(stored.event, { force: stored.reconciled === true });
    if (stored.reconciled) {
      await repairVacatedDailyRollup(stored.previousEvent, stored.event);
    }
    return {
      event: stored.event,
      rollup: projections.rollup,
      logicalRequest: projections.logicalRequest,
      quota: projections.quota,
      duplicate: !stored.created && !stored.reconciled,
      reconciled: stored.reconciled === true
    };
  } catch (error) {
    console.error('AI usage projection failed:', sanitizeMessage(error.message));
    scheduleUsageProjectionRepair();
    return {
      event: stored.event,
      rollup: null,
      logicalRequest: null,
      quota: null,
      duplicate: !stored.created && !stored.reconciled,
      reconciled: stored.reconciled === true,
      projectionPending: true,
      error
    };
  }
}

function usagePersistenceFailure(eventId, writeError, outboxError) {
  const error = new Error(`AI usage event ${eventId} could not be persisted to MongoDB or the metering outbox`);
  error.code = 'AI_USAGE_PERSISTENCE_FAILED';
  error.eventId = eventId;
  error.cause = new AggregateError(
    [writeError, outboxError],
    'MongoDB and AI usage metering outbox writes both failed'
  );
  return error;
}

async function recordUsage(input) {
  const envelope = buildUsageEnvelope(input);
  try {
    return await persistUsageEnvelope(envelope);
  } catch (writeError) {
    if (writeError?.code === 'AI_USAGE_IDENTITY_CONFLICT') {
      throw writeError;
    }
    console.error('AI usage event write failed:', sanitizeMessage(writeError.message));
    try {
      const queued = await meteringOutbox.enqueue(envelope);
      return {
        event: null,
        eventId: envelope.event.eventId,
        rollup: null,
        logicalRequest: null,
        quota: null,
        persistencePending: true,
        outboxJobId: queued.jobId,
        duplicate: queued.duplicate === true,
        writeError
      };
    } catch (outboxError) {
      if (outboxError?.code === 'AI_USAGE_IDENTITY_CONFLICT') throw outboxError;
      throw usagePersistenceFailure(
        envelope.event.eventId,
        writeError,
        outboxError
      );
    }
  }
}

function setUsageMeteringOutboxForTests(outbox = usageMeteringOutbox) {
  meteringOutbox = outbox;
}

module.exports = {
  COMPATIBILITY_STATE_ID,
  COMPATIBILITY_VERSION,
  EVENT_RETENTION_DAYS,
  PROJECTION_REPAIR_STATE_ID,
  PROJECTION_VERSION,
  buildUsageEnvelope,
  buildQuotaSnapshotSet,
  calculateEstimatedCost,
  coordinateUsageProjectionCompatibility,
  defaultProjectionRepairSince,
  deriveUsageEventId,
  ensureAIUsageProjectionCompatibility,
  migrateLegacyUsageEvents,
  normalizeUsage,
  parseDurationMs,
  parseRateLimitHeaders,
  persistUsageEnvelope,
  projectStoredEvent,
  recordUsage,
  rebuildAllUsageProjections,
  repairPendingUsageProjectionsOnStartup,
  repairUsageProjections,
  resetUsageProjectionCompatibilityForTests,
  resetUsageProjectionRepairSchedulerForTests,
  scheduleUsageProjectionRepair,
  sanitizeMessage,
  setUsageMeteringOutboxForTests,
  usageHasTokenEvidence,
  usageMeteringGroupFields,
  usageMeteringStatus,
  usageProjectionRepairHealth,
  usageProjectionRepairSchedulerState,
  utcDay,
  utcMinute,
  _runUsageProjectionCompatibilityForTests: runUsageProjectionCompatibility
};
