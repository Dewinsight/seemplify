'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');

const PATH = '/api/internal/ai/v1/account/status';

function signature({ secret, version, timestamp, nonce, service, body }) {
  const canonical = version === '2'
    ? [timestamp, nonce, service, 'POST', PATH, body].join('\n')
    : [timestamp, service, 'POST', PATH, body].join('\n');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

async function invoke({
  middleware,
  service,
  secret,
  version = '2',
  nonce = 'abcdefghijklmnop',
  body = '{}',
  timestamp = '1786291200000'
}) {
  const headers = {
    'x-seemplify-service': service,
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-signature-version': version,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature({ secret, version, timestamp, nonce, service, body })
  };
  const req = {
    method: 'POST',
    originalUrl: `${PATH}?ignored=true`,
    rawBody: Buffer.from(body),
    body: JSON.parse(body),
    get(name) { return headers[String(name).toLowerCase()]; }
  };
  const result = { statusCode: null, payload: null, next: false };
  const res = {
    status(statusCode) { result.statusCode = statusCode; return this; },
    json(payload) { result.payload = payload; return this; }
  };
  await middleware(req, res, () => { result.next = true; });
  return { req, result };
}

test('Performance v2 uses its service-specific proxy secret and rejects replay', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      AI_GATEWAY_HMAC_SECRET: 'legacy-ai-secret',
      PERFORMANCE_AI_SHARED_SECRET: 'performance-secret',
      // Simulate an older production deployment whose explicit allow-list did
      // not yet mention Performance.
      AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });

  const accepted = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'performance-secret'
  });
  assert.equal(accepted.result.next, true);
  assert.equal(accepted.req.internalService, 'performance-management');
  assert.equal(accepted.req.internalSignatureVersion, '2');

  const replay = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'performance-secret'
  });
  assert.equal(replay.result.statusCode, 409);
  assert.equal(replay.result.payload.code, 'AI_GATEWAY_REPLAY_REJECTED');
});

test('Messaging uses a distinct v2 proxy secret and cannot use the Performance key', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      PERFORMANCE_AI_SHARED_SECRET: 'performance-secret',
      MESSAGING_AI_SHARED_SECRET: 'messaging-secret'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });
  const accepted = await invoke({
    middleware, service: 'messaging', secret: 'messaging-secret', nonce: 'messagingNonce01'
  });
  assert.equal(accepted.result.next, true);
  assert.equal(accepted.req.internalService, 'messaging');

  const isolated = await invoke({
    middleware, service: 'messaging', secret: 'performance-secret', nonce: 'messagingNonce02'
  });
  assert.equal(isolated.result.statusCode, 401);
  assert.equal(isolated.result.payload.code, 'AI_GATEWAY_AUTH_INVALID');
});

test('Performance never accepts gateway/AI Interview keys or signature version', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      AI_GATEWAY_HMAC_SECRET: 'legacy-ai-secret',
      CHATGPT_GATEWAY_SHARED_SECRET: 'gateway-master-must-not-work',
      PERFORMANCE_AI_SHARED_SECRET: 'performance-secret',
      AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });

  const wrongSecret = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'legacy-ai-secret',
    nonce: 'qrstuvwxyzABCDEF'
  });
  assert.equal(wrongSecret.result.statusCode, 401);
  assert.equal(wrongSecret.result.payload.code, 'AI_GATEWAY_AUTH_INVALID');

  const gatewayMaster = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'gateway-master-must-not-work',
    nonce: 'GATEWAYmasterKey1'
  });
  assert.equal(gatewayMaster.result.statusCode, 401);
  assert.equal(gatewayMaster.result.payload.code, 'AI_GATEWAY_AUTH_INVALID');

  const legacyVersion = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'performance-secret',
    version: '1',
    nonce: ''
  });
  assert.equal(legacyVersion.result.statusCode, 401);
  assert.equal(legacyVersion.result.payload.code, 'AI_GATEWAY_AUTH_VERSION_REQUIRED');
});

test('legacy AI Interview v1 remains compatible with its existing key', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      AI_GATEWAY_HMAC_SECRET: 'legacy-ai-secret',
      PERFORMANCE_AI_SHARED_SECRET: 'performance-secret',
      AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });
  const accepted = await invoke({
    middleware,
    service: 'ai-interview',
    secret: 'legacy-ai-secret',
    version: '1',
    nonce: ''
  });
  assert.equal(accepted.result.next, true);
  assert.equal(accepted.req.internalSignatureVersion, '1');
});

test('Performance fails closed when its service-specific key is absent', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      AI_GATEWAY_HMAC_SECRET: 'legacy-ai-secret',
      AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });
  const result = (await invoke({
    middleware,
    service: 'performance-management',
    secret: 'legacy-ai-secret'
  })).result;
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.code, 'AI_GATEWAY_NOT_CONFIGURED');
});

test('shared atomic nonce claim rejects replay across middleware replicas', async () => {
  const claims = new Set();
  const claimNonce = async (key) => {
    if (claims.has(key)) return false;
    claims.add(key);
    return true;
  };
  const options = {
    env: { PERFORMANCE_AI_SHARED_SECRET: 'performance-secret' },
    now: () => 1786291200000,
    claimNonce
  };
  const replicaA = createInternalServiceAuth(options);
  const replicaB = createInternalServiceAuth(options);
  assert.equal((await invoke({ middleware: replicaA, service: 'performance-management', secret: 'performance-secret' })).result.next, true);
  const replay = await invoke({ middleware: replicaB, service: 'performance-management', secret: 'performance-secret' });
  assert.equal(replay.result.statusCode, 409);
  assert.equal(replay.result.payload.code, 'AI_GATEWAY_REPLAY_REJECTED');
});

test('future-skewed signatures retain their nonce for the full accepted window', async () => {
  const baseTime = 1786291200000;
  const windowMs = 5 * 60 * 1000;
  const futureTimestamp = String(baseTime + windowMs - 1);
  let currentTime = baseTime;
  const nonceStore = new Map();
  const middleware = createInternalServiceAuth({
    env: { PERFORMANCE_AI_SHARED_SECRET: 'performance-secret' },
    now: () => currentTime,
    nonceStore
  });
  const request = {
    middleware,
    service: 'performance-management',
    secret: 'performance-secret',
    nonce: 'futureSkewNonce1',
    timestamp: futureTimestamp
  };
  assert.equal((await invoke(request)).result.next, true);
  assert.equal(
    nonceStore.get('performance-management:futureSkewNonce1'),
    Number(futureTimestamp) + windowMs
  );

  // One window after first receipt, the future-dated signature is still
  // valid. Its durable nonce must still block the captured replay.
  currentTime = baseTime + windowMs + 1;
  const replay = await invoke(request);
  assert.equal(replay.result.statusCode, 409);
  assert.equal(replay.result.payload.code, 'AI_GATEWAY_REPLAY_REJECTED');
});

test('Performance replay protection fails closed when durable storage is unavailable', async () => {
  const middleware = createInternalServiceAuth({
    env: { PERFORMANCE_AI_SHARED_SECRET: 'performance-secret' },
    now: () => 1786291200000,
    claimNonce: async () => { throw new Error('database unavailable'); }
  });
  const response = await invoke({ middleware, service: 'performance-management', secret: 'performance-secret' });
  assert.equal(response.result.statusCode, 503);
  assert.equal(response.result.payload.code, 'AI_GATEWAY_REPLAY_GUARD_UNAVAILABLE');
});

test('Performance accepts its previous proxy key during a staged rotation', async () => {
  const middleware = createInternalServiceAuth({
    env: {
      PERFORMANCE_AI_SHARED_SECRET: 'performance-current-secret',
      PERFORMANCE_AI_SHARED_SECRET_PREVIOUS: 'performance-previous-secret'
    },
    now: () => 1786291200000,
    nonceStore: new Map()
  });
  const accepted = await invoke({
    middleware,
    service: 'performance-management',
    secret: 'performance-previous-secret',
    nonce: 'rotationNonce1234'
  });
  assert.equal(accepted.result.next, true);
});
