const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sanitizeProviderTelemetrySnapshot
} = require('../services/localRuntimeProviderTelemetryService');

test('local control provider telemetry exposes only privacy-safe aggregate fields', () => {
  const result = sanitizeProviderTelemetrySnapshot({
    sampledAt: '2026-07-25T12:00:00.000Z',
    windowMinutes: 60,
    totals: {
      fiveMinutes: { calls: 2, failures: 1, averageLatencyMs: 250, totalTokens: 450, estimatedCostUsd: 0.001 },
      hour: { calls: 8, failures: 1, averageLatencyMs: 700, tokens: 4_000, cost: 0.02 }
    },
    providers: [{
      id: 'local-codex',
      calls: 5,
      failures: 0,
      averageLatencyMs: 1_500,
      totalTokens: 3_500,
      estimatedCostUsd: 0,
      lastRequestAt: '2026-07-25T11:59:00.000Z',
      organizationName: 'Private Ltd',
      actorEmail: 'person@example.test',
      requestId: 'private-request',
      prompt: 'private CV contents'
    }],
    recent: [{ actorName: 'Private Person' }],
    activities: [{ id: 'candidate.cv_parse' }],
    accountingHealth: { healthy: true }
  });

  assert.deepEqual(Object.keys(result), ['sampledAt', 'window', 'totals', 'providers']);
  assert.deepEqual(Object.keys(result.providers[0]), [
    'id',
    'calls',
    'failures',
    'averageLatencyMs',
    'totalTokens',
    'estimatedCostUsd',
    'lastRequestAt'
  ]);
  assert.equal(result.providers[0].id, 'local-codex');
  assert.equal(result.providers[0].totalTokens, 3_500);
  assert.equal(JSON.stringify(result).includes('Private'), false);
  assert.equal(JSON.stringify(result).includes('person@example.test'), false);
  assert.equal(JSON.stringify(result).includes('candidate.cv_parse'), false);
});

test('provider telemetry normalizes invalid and hostile aggregate values', () => {
  const result = sanitizeProviderTelemetrySnapshot({
    sampledAt: 'invalid',
    windowMinutes: 100_000,
    totals: { hour: { calls: -4, failures: 'nope', averageLatencyMs: Infinity } },
    providers: [{
      id: '<script>alert(1)</script>',
      calls: '3.4',
      totalTokens: -1,
      estimatedCostUsd: '0.123456789',
      lastRequestAt: 'not-a-date'
    }]
  });

  assert.equal(Number.isFinite(new Date(result.sampledAt).getTime()), true);
  assert.equal(result.window.minutes, 1_440);
  assert.equal(result.totals.hour.calls, 0);
  assert.equal(result.providers[0].id, 'unknown');
  assert.equal(result.providers[0].calls, 3);
  assert.equal(result.providers[0].totalTokens, 0);
  assert.equal(result.providers[0].estimatedCostUsd, 0.12345679);
  assert.equal(result.providers[0].lastRequestAt, null);
});
