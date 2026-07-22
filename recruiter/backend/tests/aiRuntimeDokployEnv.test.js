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
    'AI_GATEWAY_ALLOWED_SERVICES'
  ]);
  assert.equal(parsed.get('MONGO_URI'), 'mongodb://example');
  assert.equal(parsed.get('EXISTING'), 'value');
  assert.equal(Buffer.from(parsed.get('AI_PROVIDER_ENCRYPTION_KEY'), 'base64').length, 32);
  assert.equal(Buffer.from(parsed.get('AI_GATEWAY_HMAC_SECRET'), 'base64').length, 48);
});

test('Dokploy AI Runtime setup never rotates existing secrets implicitly', () => {
  const original = [
    'AI_PROVIDER_ENCRYPTION_KEY=existing-encryption',
    'AI_PROVIDER_ENCRYPTION_KEY_VERSION=v9',
    'AI_GATEWAY_HMAC_SECRET=existing-hmac',
    'AI_GATEWAY_ALLOWED_SERVICES=ai-interview,worker'
  ].join('\n');
  const result = ensureAIRuntimeEnv(original, () => { throw new Error('must not generate'); });

  assert.equal(result.env, original);
  assert.deepEqual(result.added, []);
});

test('Dokploy URL normalization accepts root and API URLs', () => {
  assert.equal(apiBase('https://dokploy.example'), 'https://dokploy.example/api');
  assert.equal(apiBase('https://dokploy.example/api/'), 'https://dokploy.example/api');
});
