const { getLiveOperations } = require('./adminAIRuntimeService');

function nonNegativeNumber(value, { integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return integer ? Math.round(parsed) : parsed;
}

function isoDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function metricSummary(value = {}) {
  return {
    calls: nonNegativeNumber(value.calls, { integer: true }),
    failures: nonNegativeNumber(value.failures, { integer: true }),
    averageLatencyMs: nonNegativeNumber(value.averageLatencyMs, { integer: true }),
    totalTokens: nonNegativeNumber(value.totalTokens ?? value.tokens, { integer: true }),
    estimatedCostUsd: Number(nonNegativeNumber(value.estimatedCostUsd ?? value.cost).toFixed(8))
  };
}

function providerId(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized) ? normalized : 'unknown';
}

function sanitizeProviderTelemetrySnapshot(snapshot = {}) {
  const sampledAt = isoDateOrNull(snapshot.sampledAt) || new Date().toISOString();
  return {
    sampledAt,
    window: {
      minutes: Math.max(1, Math.min(24 * 60, nonNegativeNumber(snapshot.windowMinutes, { integer: true }) || 60))
    },
    totals: {
      fiveMinutes: metricSummary(snapshot.totals?.fiveMinutes),
      hour: metricSummary(snapshot.totals?.hour)
    },
    providers: (Array.isArray(snapshot.providers) ? snapshot.providers : [])
      .slice(0, 16)
      .map((provider) => ({
        id: providerId(provider?.id),
        ...metricSummary(provider),
        lastRequestAt: isoDateOrNull(provider?.lastRequestAt)
      }))
  };
}

async function getLocalRuntimeProviderTelemetry() {
  return sanitizeProviderTelemetrySnapshot(await getLiveOperations());
}

module.exports = {
  getLocalRuntimeProviderTelemetry,
  sanitizeProviderTelemetrySnapshot
};
