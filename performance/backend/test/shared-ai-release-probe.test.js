const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySharedAIHealth } = require('../scripts/verifySharedAIHealth');
const health = { ok: true, service: 'seemplify-shared-ai-account', consumer: 'performance-management', signatureVersion: '2' };
test('release probe accepts the signed Performance consumer identity', async () => {
  assert.deepEqual(await verifySharedAIHealth({ health: async () => health }), { sharedAiReady: true, signatureVersion: '2' });
});
test('release probe rejects an unavailable authority and incorrect consumer or signature version', async () => {
  for (const change of [{ ok: false }, { service: 'another-service' }, { consumer: 'another-product' }, { signatureVersion: '1' }]) {
    await assert.rejects(verifySharedAIHealth({ health: async () => ({ ...health, ...change }) }));
  }
  await assert.rejects(verifySharedAIHealth({ health: async () => { throw new Error('Connection unavailable'); } }));
});
