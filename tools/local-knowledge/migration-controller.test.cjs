const test = require('node:test');
const assert = require('node:assert/strict');
const { EmbeddingMigrationController, deterministicPercentage, percentile } = require('./migration-controller.cjs');

test('rollout selection is deterministic, gated by readiness, and one-flag rollback is immediate', () => {
  const enabled = new EmbeddingMigrationController({ provider: 'gte-node', rolloutPercent: 100 });
  assert.equal(enabled.choose('request-a', { gteReady: false }), 'qwen-tei');
  assert.equal(enabled.choose('request-a', { gteReady: true }), 'gte-node');
  const rolledBack = new EmbeddingMigrationController({ provider: 'qwen-tei', rolloutPercent: 100 });
  assert.equal(rolledBack.choose('request-a', { gteReady: true }), 'qwen-tei');
  assert.equal(deterministicPercentage('stable'), deterministicPercentage('stable'));
});

test('shadow selection never shadows a request already served by GTE', () => {
  const controller = new EmbeddingMigrationController({ shadowPercent: 100 });
  assert.equal(controller.shouldShadow('request-a', { gteReady: true, servedProvider: 'qwen-tei' }), true);
  assert.equal(controller.shouldShadow('request-a', { gteReady: true, servedProvider: 'gte-node' }), false);
  assert.equal(controller.shouldShadow('request-a', { gteReady: false, servedProvider: 'qwen-tei' }), false);
  controller.pause('operating-gate');
  assert.equal(controller.shouldShadow('request-a', { gteReady: true, servedProvider: 'qwen-tei' }), false);
});

test('gate automatically pauses rollout after excessive errors and can be explicitly resumed', () => {
  let now = 1_000;
  const controller = new EmbeddingMigrationController({ provider: 'gte-node', rolloutPercent: 100, minGateSamples: 20, now: () => now });
  for (let index = 0; index < 20; index += 1) {
    controller.record({ provider: 'gte-node', durationMs: 100, failed: index === 0 });
    now += 10;
  }
  assert.equal(controller.status().paused, true);
  assert.match(controller.status().pauseReason, /^error-rate:/);
  assert.equal(controller.choose('request-a', { gteReady: true }), 'qwen-tei');
  controller.resume();
  assert.equal(controller.status().paused, false);
});

test('nearest-rank percentiles preserve operating gates', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.equal(percentile([], 0.95), 0);
});

test('operator pause and resume preserve an auditable rollout state', () => {
  const controller = new EmbeddingMigrationController({ provider: 'gte-node', rolloutPercent: 100, now: () => 1_000 });
  const paused = controller.pause('maintenance');
  assert.equal(paused.paused, true);
  assert.equal(paused.pauseReason, 'maintenance');
  assert.equal(controller.choose('request-a', { gteReady: true }), 'qwen-tei');
  controller.resume();
  assert.equal(controller.choose('request-a', { gteReady: true }), 'gte-node');
});
