'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DEPLOYMENT_HEALTH_PATH,
  DEPLOYMENT_HEALTH_SERVICE,
  SIGNATURE_VERSION,
  MAX_CLOCK_SKEW_MS,
  createDeploymentHealthVerifier
} = require('../services/deploymentHealthSecurity');

const TEST_SECRET = 'performance-deployment-health-secret';

function fakeNonceModel(records = new Map(), { failure } = {}) {
  const created = [];
  return {
    created,
    async create(value) {
      if (failure) throw failure;
      if (records.has(value.nonce)) {
        throw Object.assign(new Error('duplicate nonce'), { code: 11000 });
      }
      const stored = { ...value };
      records.set(value.nonce, stored);
      created.push(stored);
      return stored;
    }
  };
}

function signedRequest({ timestamp, nonce, body = {} }) {
  const headers = {
    'x-seemplify-timestamp': String(timestamp),
    'x-seemplify-nonce': nonce,
    'x-seemplify-service': DEPLOYMENT_HEALTH_SERVICE,
    'x-seemplify-signature-version': SIGNATURE_VERSION
  };
  const canonical = [
    headers['x-seemplify-timestamp'],
    nonce,
    DEPLOYMENT_HEALTH_SERVICE,
    'POST',
    DEPLOYMENT_HEALTH_PATH,
    JSON.stringify(body)
  ].join('\n');
  headers['x-seemplify-signature'] = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(canonical)
    .digest('hex');
  return {
    body,
    get(name) { return headers[String(name).toLowerCase()]; }
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function invoke(verifier, request) {
  const response = fakeResponse();
  let nextCalls = 0;
  await verifier(request, response, () => { nextCalls += 1; });
  return { response, nextCalls };
}

function verifierFor(nonceModel, nowMs) {
  return createDeploymentHealthVerifier({
    nonceModel,
    now: () => nowMs,
    secret: TEST_SECRET,
    logger: { error() {} }
  });
}

test('deployment health rejects replay through the same verifier instance', async () => {
  const nowMs = Date.parse('2026-08-09T12:00:00.000Z');
  const verifier = verifierFor(fakeNonceModel(), nowMs);
  const request = signedRequest({
    timestamp: nowMs,
    nonce: 'same_replica_nonce_123456'
  });

  const first = await invoke(verifier, request);
  const replay = await invoke(verifier, request);

  assert.equal(first.nextCalls, 1);
  assert.equal(replay.nextCalls, 0);
  assert.equal(replay.response.statusCode, 401);
  assert.equal(replay.response.payload.code, 'DEPLOYMENT_HEALTH_REPLAY_DETECTED');
});

test('deployment health rejects replay across replicas sharing Mongo storage', async () => {
  const nowMs = Date.parse('2026-08-09T12:00:00.000Z');
  const sharedRecords = new Map();
  const replicaA = verifierFor(fakeNonceModel(sharedRecords), nowMs);
  const replicaB = verifierFor(fakeNonceModel(sharedRecords), nowMs);
  const request = signedRequest({
    timestamp: nowMs,
    nonce: 'cross_replica_nonce_12345'
  });

  const first = await invoke(replicaA, request);
  const replay = await invoke(replicaB, request);

  assert.equal(first.nextCalls, 1);
  assert.equal(replay.nextCalls, 0);
  assert.equal(replay.response.statusCode, 401);
  assert.equal(replay.response.payload.code, 'DEPLOYMENT_HEALTH_REPLAY_DETECTED');
});

test('deployment health fails closed when durable nonce storage is unavailable', async () => {
  const nowMs = Date.parse('2026-08-09T12:00:00.000Z');
  const verifier = verifierFor(fakeNonceModel(new Map(), {
    failure: new Error('Mongo unavailable')
  }), nowMs);
  const result = await invoke(verifier, signedRequest({
    timestamp: nowMs,
    nonce: 'storage_failure_nonce_1234'
  }));

  assert.equal(result.nextCalls, 0);
  assert.equal(result.response.statusCode, 503);
  assert.equal(
    result.response.payload.code,
    'DEPLOYMENT_HEALTH_REPLAY_PROTECTION_UNAVAILABLE'
  );
});

test('future-skew request keeps its nonce until the full signature window closes', async () => {
  const nowMs = Date.parse('2026-08-09T12:00:00.000Z');
  const futureTimestamp = nowMs + MAX_CLOCK_SKEW_MS;
  const nonceModel = fakeNonceModel();
  const verifier = verifierFor(nonceModel, nowMs);
  const result = await invoke(verifier, signedRequest({
    timestamp: futureTimestamp,
    nonce: 'future_skew_nonce_1234567'
  }));

  assert.equal(result.nextCalls, 1);
  assert.equal(nonceModel.created.length, 1);
  assert.equal(
    nonceModel.created[0].expiresAt.getTime(),
    futureTimestamp + MAX_CLOCK_SKEW_MS
  );
});

test('deployment health nonce schema enforces a unique nonce and TTL expiry', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'models', 'DeploymentHealthNonce.js'),
    'utf8'
  );
  assert.match(source, /nonce:\s*\{[\s\S]*?unique:\s*true/);
  assert.match(source, /expiresAt:\s*\{[\s\S]*?index:\s*\{\s*expires:\s*0\s*\}/);
});
