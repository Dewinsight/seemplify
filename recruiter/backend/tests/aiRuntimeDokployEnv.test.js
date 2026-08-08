const test = require('node:test');
const assert = require('node:assert/strict');
const { apiBase, ensureAIRuntimeEnv, parseEnv } = require('../scripts/dokployEnsureAIRuntimeEnv');

function deterministicBytes(size) {
  return Buffer.alloc(size, size);
}

test('Dokploy AI Runtime setup adds only missing security values', () => {
  const original = 'MONGO_URI=mongodb://example\nEXISTING=value';
  const result = ensureAIRuntimeEnv(original, deterministicBytes);
  const parsed = parseEnv(result.env).values;

  assert.deepEqual(result.added, [
    'AI_PROVIDER_ENCRYPTION_KEY',
    'AI_PROVIDER_ENCRYPTION_KEY_VERSION',
    'AI_GATEWAY_HMAC_SECRET',
    'AI_GATEWAY_ALLOWED_SERVICES',
    'AI_USAGE_OUTBOX_ENABLED',
    'AI_USAGE_REDIS_HOST',
    'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED'
  ]);
  assert.equal(parsed.get('MONGO_URI'), 'mongodb://example');
  assert.equal(parsed.get('EXISTING'), 'value');
  assert.equal(Buffer.from(parsed.get('AI_PROVIDER_ENCRYPTION_KEY'), 'base64').length, 32);
  assert.equal(Buffer.from(parsed.get('AI_GATEWAY_HMAC_SECRET'), 'base64').length, 48);
  assert.equal(parsed.get('AI_USAGE_OUTBOX_ENABLED'), 'true');
  assert.equal(parsed.get('AI_USAGE_REDIS_HOST'), 'dokploy-redis');
  assert.equal(parsed.get('LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED'), 'false');
});

test('Dokploy AI Runtime setup never rotates existing secrets implicitly', () => {
  const original = [
    'AI_PROVIDER_ENCRYPTION_KEY=existing-encryption',
    'AI_PROVIDER_ENCRYPTION_KEY_VERSION=v9',
    'AI_GATEWAY_HMAC_SECRET=existing-hmac',
    'AI_GATEWAY_ALLOWED_SERVICES=ai-interview,worker',
    'AI_USAGE_OUTBOX_ENABLED=true',
    'AI_USAGE_REDIS_HOST=dokploy-redis',
    'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED=false'
  ].join('\n');
  const result = ensureAIRuntimeEnv(original, () => { throw new Error('must not generate'); });

  assert.equal(result.env, original);
  assert.deepEqual(result.added, []);
});

test('Dokploy setup configures the hosted gateway without creating a local dependency', () => {
  const result = ensureAIRuntimeEnv('LOCAL_LLM_BASE_URL=https://cv-llm.aiinnigeria.com\nLOCAL_LLM_SHARED_SECRET=old-local-secret', deterministicBytes, {
    chatgptBaseUrl: 'http://seemplify-chatgpt-gateway:11435',
    chatgptSharedSecret: 'hosted-gateway-secret',
    statusTokenSecret: 'opaque-status-secret',
    concurrency: 4,
    disableLocalRuntime: true
  });
  const parsed = parseEnv(result.env).values;
  assert.equal(parsed.get('CHATGPT_GATEWAY_BASE_URL'), 'http://seemplify-chatgpt-gateway:11435');
  assert.equal(parsed.get('CHATGPT_GATEWAY_SHARED_SECRET'), 'hosted-gateway-secret');
  assert.equal(parsed.has('LOCAL_LLM_BASE_URL'), false);
  assert.equal(parsed.has('LOCAL_LLM_SHARED_SECRET'), false);
  assert.equal(parsed.get('CV_STATUS_TOKEN_SECRET'), 'opaque-status-secret');
  assert.equal(parsed.get('CV_ANALYSIS_QUEUE_CONCURRENCY'), '4');
  assert.equal(parsed.get('LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED'), 'false');
  assert.equal(parsed.get('AI_USAGE_OUTBOX_ENABLED'), 'true');
  assert.equal(parsed.get('AI_USAGE_REDIS_HOST'), 'dokploy-redis');
});

test('Dokploy setup rejects disabled metering or a conflicting Redis host', () => {
  assert.throws(
    () => ensureAIRuntimeEnv('AI_USAGE_OUTBOX_ENABLED=false', deterministicBytes),
    /AI_USAGE_OUTBOX_ENABLED must be true/
  );
  assert.throws(
    () => ensureAIRuntimeEnv('AI_USAGE_REDIS_HOST=wrong-redis', deterministicBytes),
    /AI_USAGE_REDIS_HOST must be dokploy-redis/
  );
});

test('Dokploy URL normalization accepts root and API URLs', () => {
  assert.equal(apiBase('https://dokploy.example'), 'https://dokploy.example/api');
  assert.equal(apiBase('https://dokploy.example/api/'), 'https://dokploy.example/api');
});
