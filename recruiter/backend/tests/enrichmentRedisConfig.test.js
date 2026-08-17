const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEnrichmentRedisConnection } = require('../config/enrichmentRedis');

test('enrichment Redis uses the shared password when configured by host and port', () => {
  const config = resolveEnrichmentRedisConnection({
    NODE_ENV: 'production',
    REDIS_HOST: 'seemplify-shared-redis-1',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: 'protected-value',
  });

  assert.equal(config.url, undefined);
  assert.equal(config.options.host, 'seemplify-shared-redis-1');
  assert.equal(config.options.port, 6379);
  assert.equal(config.options.password, 'protected-value');
  assert.equal(config.options.maxRetriesPerRequest, null);
});

test('enrichment-specific Redis URL takes precedence over shared connection fields', () => {
  const config = resolveEnrichmentRedisConnection({
    REDIS_ENABLED: 'true',
    ENRICHMENT_REDIS_URL: 'redis://:secret@queue.internal:6379/4',
    REDIS_HOST: 'ignored.internal',
  });

  assert.equal(config.url, 'redis://:secret@queue.internal:6379/4');
  assert.deepEqual(Object.keys(config.options).sort(), [
    'enableReadyCheck',
    'lazyConnect',
    'maxRetriesPerRequest',
  ]);
});

test('enrichment Redis can be explicitly disabled', () => {
  assert.equal(resolveEnrichmentRedisConnection({
    NODE_ENV: 'production',
    REDIS_ENABLED: 'false',
  }), null);
});
