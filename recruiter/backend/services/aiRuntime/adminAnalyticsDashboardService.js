const AIUsageEvent = require('../../models/AIUsageEvent');
const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const AIAuditEvent = require('../../models/AIAuditEvent');
const aiRuntimeService = require('./aiRuntimeService');
const cvAnalysisQueue = require('../cvAnalysisQueueService');

const MAX_HISTORY_PAGE_SIZE = 100;
const MAX_LOOKBACK_DAYS = 90;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function compactString(value, maximum = 120) {
  return String(value || '').trim().slice(0, maximum);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDashboardQuery(input = {}) {
  const status = compactString(input.status, 20).toLowerCase();
  const runtimeOwner = compactString(input.runtimeOwner, 20).toLowerCase();
  return {
    days: boundedInteger(input.days, 30, 1, MAX_LOOKBACK_DAYS),
    page: boundedInteger(input.page, 1, 1, 10_000),
    limit: boundedInteger(input.limit, 50, 10, MAX_HISTORY_PAGE_SIZE),
    sourceApp: compactString(input.sourceApp),
    activity: compactString(input.activity),
    provider: compactString(input.provider),
    model: compactString(input.model),
    organizationId: compactString(input.organizationId),
    status: ['success', 'failed'].includes(status) ? status : '',
    runtimeOwner: ['platform', 'user'].includes(runtimeOwner) ? runtimeOwner : '',
    search: compactString(input.search)
  };
}

function usageMatch(filters, now = new Date()) {
  const since = new Date(now.getTime() - filters.days * 24 * 60 * 60 * 1000);
  const match = { recordedAt: { $gte: since, $lte: now } };
  for (const key of ['sourceApp', 'activity', 'provider', 'model', 'organizationId', 'status', 'runtimeOwner']) {
    if (filters[key]) match[key] = filters[key];
  }
  if (filters.search) {
    const expression = new RegExp(escapeRegExp(filters.search), 'i');
    match.$or = [
      { requestId: expression },
      { sourceApp: expression },
      { activity: expression },
      { provider: expression },
      { model: expression },
      { organizationName: expression },
      { actorName: expression },
      { actorEmail: expression },
      { errorCode: expression }
    ];
  }
  return { match, since, until: now };
}

function metricRows(rows = [], keyName = 'key') {
  return rows.map((row) => ({
    [keyName]: row._id || 'unknown',
    executions: Number(row.executions || 0),
    successes: Number(row.successes || 0),
    failures: Number(row.failures || 0),
    tokens: Number(row.tokens || 0),
    costUsd: Number(row.costUsd || 0),
    averageLatencyMs: Math.round(Number(row.averageLatencyMs || 0))
  }));
}

function sanitizeGatewayProvider(value = {}) {
  return {
    configured: value.configured === true,
    reachable: value.reachable === true,
    status: compactString(value.status || value.state || (value.reachable ? 'healthy' : 'unavailable'), 60),
    version: compactString(value.version, 80),
    error: compactString(value.error, 180)
  };
}

function sanitizeQueue(snapshot = {}) {
  return {
    sampledAt: snapshot.sampledAt || null,
    available: snapshot.available === true,
    paused: snapshot.paused === true,
    concurrency: Number(snapshot.concurrency || 0),
    counts: {
      waiting: Number(snapshot.counts?.waitingTotal ?? snapshot.counts?.waiting ?? 0),
      active: Number(snapshot.counts?.active || 0),
      delayed: Number(snapshot.counts?.delayed || 0),
      completed: Number(snapshot.counts?.completed || 0),
      failed: Number(snapshot.counts?.failed || 0)
    },
    rates: {
      completedLast5Minutes: Number(snapshot.rates?.completedLast5Minutes || 0),
      completedLastHour: Number(snapshot.rates?.completedLastHour || 0),
      failedLastHour: Number(snapshot.rates?.failedLastHour || 0),
      averageProcessingMs: Number(snapshot.rates?.averageProcessingMs || 0),
      p95ProcessingMs: Number(snapshot.rates?.p95ProcessingMs || 0)
    },
    oldestWaitMs: Number(snapshot.oldestWaitMs || 0),
    error: compactString(snapshot.error, 180)
  };
}

function safeUsageEvent(event) {
  return {
    id: String(event._id || ''),
    recordedAt: event.recordedAt || event.createdAt || null,
    requestId: compactString(event.requestId),
    sourceApp: compactString(event.sourceApp),
    activity: compactString(event.activity),
    provider: compactString(event.provider),
    model: compactString(event.model),
    runtimeOwner: compactString(event.runtimeOwner),
    organizationId: compactString(event.organizationId),
    organizationName: compactString(event.organizationName),
    actorId: compactString(event.actorId),
    actorName: compactString(event.actorName),
    actorEmail: compactString(event.actorEmail, 254),
    status: compactString(event.status, 20),
    httpStatus: Number(event.httpStatus || 0),
    errorCode: compactString(event.errorCode),
    attempts: Number(event.attempts || 0),
    failovers: Number(event.failovers || 0),
    latencyMs: Number(event.latencyMs || 0),
    totalTokens: Number(event.totalTokens || 0),
    inputTokens: Number(event.inputTokens || 0),
    outputTokens: Number(event.outputTokens || 0),
    cachedInputTokens: Number(event.cachedInputTokens || 0),
    reasoningTokens: Number(event.reasoningTokens || 0),
    estimatedCostUsd: Number(event.estimatedCostUsd || 0),
    usageReported: event.usageReported === true ? true : event.usageReported === false ? false : null
  };
}

function safeAccount(account) {
  const consents = {
    recruiter: account.dataSharingAcknowledgedAt || null,
    performance: account.performanceDataSharingAcknowledgedAt || null,
    messaging: account.messagingDataSharingAcknowledgedAt || null,
    experience: account.experienceDataSharingAcknowledgedAt || null
  };
  return {
    id: String(account._id || ''),
    status: compactString(account.status, 20),
    connectedEmail: compactString(account.connectedEmail, 254),
    planType: compactString(account.planType, 80),
    runtimePreference: compactString(account.runtimePreference, 20),
    organizationId: String(account.organization?._id || account.organization || ''),
    organizationName: compactString(account.organization?.name),
    userId: String(account.user?._id || account.user || ''),
    userName: compactString(account.user?.profile?.displayName || account.user?.profile?.name),
    userEmail: compactString(account.user?.email, 254),
    connectedAt: account.connectedAt || null,
    lastVerifiedAt: account.lastVerifiedAt || null,
    updatedAt: account.updatedAt || null,
    consents
  };
}

function safeAuditEvent(event) {
  return {
    id: String(event._id || ''),
    createdAt: event.createdAt || null,
    category: compactString(event.category, 40),
    action: compactString(event.action),
    status: compactString(event.status, 30),
    actorEmail: compactString(event.actorEmail, 254),
    targetType: compactString(event.targetType, 80),
    targetId: compactString(event.targetId),
    quotaGroup: compactString(event.quotaGroup),
    model: compactString(event.model),
    message: compactString(event.message, 280)
  };
}

async function getSharedAIAdminDashboard(input = {}, dependencies = {}) {
  const models = {
    usage: dependencies.usage || AIUsageEvent,
    accounts: dependencies.accounts || AIUserRuntimeAccount,
    audit: dependencies.audit || AIAuditEvent
  };
  const filters = normalizeDashboardQuery(input);
  const { match, since, until } = usageMatch(filters, dependencies.now?.() || new Date());
  const skip = (filters.page - 1) * filters.limit;

  const dimensions = (field) => [
    { $group: {
      _id: `$${field}`,
      executions: { $sum: 1 },
      successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
      failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      tokens: { $sum: '$totalTokens' },
      costUsd: { $sum: '$estimatedCostUsd' },
      averageLatencyMs: { $avg: '$latencyMs' }
    } },
    { $sort: { executions: -1 } },
    { $limit: 20 }
  ];

  const [aggregateRows, events, eventCount, accountStatsRows, consentRows, accounts, audits, gatewayRaw, queueRaw] = await Promise.all([
    models.usage.aggregate([
      { $match: match },
      { $facet: {
        totals: [{ $group: {
          _id: null,
          executions: { $sum: 1 },
          successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          tokens: { $sum: '$totalTokens' },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          cachedInputTokens: { $sum: '$cachedInputTokens' },
          reasoningTokens: { $sum: '$reasoningTokens' },
          costUsd: { $sum: '$estimatedCostUsd' },
          failovers: { $sum: '$failovers' },
          averageLatencyMs: { $avg: '$latencyMs' },
          maxLatencyMs: { $max: '$latencyMs' },
          metered: { $sum: { $cond: [{ $eq: ['$usageReported', true] }, 1, 0] } },
          unmetered: { $sum: { $cond: [{ $eq: ['$usageReported', false] }, 1, 0] } },
          unknownMetering: { $sum: { $cond: [{ $in: ['$usageReported', [true, false]] }, 0, 1] } }
        } }],
        sourceApps: dimensions('sourceApp'),
        providers: dimensions('provider'),
        models: dimensions('model'),
        activities: dimensions('activity'),
        organizations: dimensions('organizationName'),
        logicalRequests: [
          { $group: {
            _id: '$requestId',
            succeeded: { $max: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } }
          } },
          { $group: {
            _id: null,
            requests: { $sum: 1 },
            successes: { $sum: '$succeeded' },
            failures: { $sum: { $cond: [{ $eq: ['$succeeded', 1] }, 0, 1] } }
          } }
        ],
        timeline: [
          { $group: {
            _id: { $dateToString: { date: '$recordedAt', format: '%Y-%m-%d', timezone: 'UTC' } },
            executions: { $sum: 1 },
            successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            tokens: { $sum: '$totalTokens' },
            costUsd: { $sum: '$estimatedCostUsd' }
          } },
          { $sort: { _id: 1 } }
        ]
      } }
    ]),
    models.usage.find(match).sort({ recordedAt: -1 }).skip(skip).limit(filters.limit).lean(),
    models.usage.countDocuments(match),
    models.accounts.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    models.accounts.aggregate([{ $group: {
      _id: null,
      recruiter: { $sum: { $cond: [{ $ne: ['$dataSharingAcknowledgedAt', null] }, 1, 0] } },
      performance: { $sum: { $cond: [{ $ne: ['$performanceDataSharingAcknowledgedAt', null] }, 1, 0] } },
      messaging: { $sum: { $cond: [{ $ne: ['$messagingDataSharingAcknowledgedAt', null] }, 1, 0] } },
      experience: { $sum: { $cond: [{ $ne: ['$experienceDataSharingAcknowledgedAt', null] }, 1, 0] } }
    } }]),
    models.accounts.find({}).sort({ updatedAt: -1 }).limit(25).populate('organization', 'name').populate('user', 'email profile').lean(),
    models.audit.find({}).sort({ createdAt: -1 }).limit(50).lean(),
    (dependencies.getGatewayStatus || (() => aiRuntimeService.getGatewayStatus()))().catch((error) => ({ error: error.message })),
    (dependencies.getQueueTelemetry || (() => cvAnalysisQueue.adminTelemetry()))().catch((error) => ({ error: error.message }))
  ]);

  const facets = aggregateRows[0] || {};
  const totals = facets.totals?.[0] || {};
  const logical = facets.logicalRequests?.[0] || {};
  const accountStatuses = Object.fromEntries(accountStatsRows.map((row) => [row._id || 'unknown', Number(row.count || 0)]));
  const consents = consentRows[0] || {};

  return {
    generatedAt: new Date().toISOString(),
    range: { since, until, days: filters.days },
    filters,
    totals: {
      logicalRequests: Number(logical.requests || 0),
      logicalSuccesses: Number(logical.successes || 0),
      logicalFailures: Number(logical.failures || 0),
      executions: Number(totals.executions || 0),
      successes: Number(totals.successes || 0),
      failures: Number(totals.failures || 0),
      successRate: totals.executions ? Number(((totals.successes || 0) / totals.executions * 100).toFixed(1)) : 0,
      tokens: Number(totals.tokens || 0),
      inputTokens: Number(totals.inputTokens || 0),
      outputTokens: Number(totals.outputTokens || 0),
      cachedInputTokens: Number(totals.cachedInputTokens || 0),
      reasoningTokens: Number(totals.reasoningTokens || 0),
      costUsd: Number(totals.costUsd || 0),
      failovers: Number(totals.failovers || 0),
      averageLatencyMs: Math.round(Number(totals.averageLatencyMs || 0)),
      maxLatencyMs: Number(totals.maxLatencyMs || 0),
      metered: Number(totals.metered || 0),
      unmetered: Number(totals.unmetered || 0),
      unknownMetering: Number(totals.unknownMetering || 0)
    },
    breakdowns: {
      sourceApps: metricRows(facets.sourceApps, 'sourceApp'),
      providers: metricRows(facets.providers, 'provider'),
      models: metricRows(facets.models, 'model'),
      activities: metricRows(facets.activities, 'activity'),
      organizations: metricRows(facets.organizations, 'organizationName'),
      timeline: (facets.timeline || []).map((row) => ({
        day: row._id,
        executions: Number(row.executions || 0),
        successes: Number(row.successes || 0),
        failures: Number(row.failures || 0),
        tokens: Number(row.tokens || 0),
        costUsd: Number(row.costUsd || 0)
      }))
    },
    history: {
      events: events.map(safeUsageEvent),
      total: Number(eventCount || 0),
      page: filters.page,
      limit: filters.limit,
      pages: Math.max(1, Math.ceil(Number(eventCount || 0) / filters.limit))
    },
    connectedAccounts: {
      total: Object.values(accountStatuses).reduce((sum, value) => sum + value, 0),
      statuses: accountStatuses,
      consents: {
        recruiter: Number(consents.recruiter || 0),
        performance: Number(consents.performance || 0),
        messaging: Number(consents.messaging || 0),
        experience: Number(consents.experience || 0)
      },
      recent: accounts.map(safeAccount)
    },
    audit: audits.map(safeAuditEvent),
    health: {
      gateway: {
        local: sanitizeGatewayProvider(gatewayRaw.local || {}),
        chatgpt: sanitizeGatewayProvider(gatewayRaw.chatgpt || {}),
        error: compactString(gatewayRaw.error, 180)
      },
      queue: sanitizeQueue(queueRaw)
    }
  };
}

module.exports = {
  MAX_HISTORY_PAGE_SIZE,
  MAX_LOOKBACK_DAYS,
  getSharedAIAdminDashboard,
  normalizeDashboardQuery,
  safeAccount,
  safeAuditEvent,
  safeUsageEvent,
  sanitizeQueue,
  usageMatch
};
