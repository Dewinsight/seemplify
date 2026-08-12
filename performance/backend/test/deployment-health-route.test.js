'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const test = require('node:test');
const request = require('supertest');

const DeploymentHealthNonce = require('../models/DeploymentHealthNonce');
const sharedAIAccountService = require('../services/sharedAIAccountService');
const {
  DEPLOYMENT_HEALTH_PATH,
  DEPLOYMENT_HEALTH_SERVICE,
  SIGNATURE_VERSION
} = require('../services/deploymentHealthSecurity');
const aiAccountRoutes = require('../routes/aiAccount');

const TEST_SECRET = 'performance-deployment-health-route-secret';

function signedHeaders({
  secret = TEST_SECRET,
  timestamp = Date.now(),
  nonce = crypto.randomBytes(24).toString('base64url'),
  body = {}
} = {}) {
  const rawBody = JSON.stringify(body);
  const canonical = [
    String(timestamp), nonce, DEPLOYMENT_HEALTH_SERVICE, 'POST',
    DEPLOYMENT_HEALTH_PATH, rawBody
  ].join('\n');
  return {
    'x-seemplify-service': DEPLOYMENT_HEALTH_SERVICE,
    'x-seemplify-signature-version': SIGNATURE_VERSION,
    'x-seemplify-timestamp': String(timestamp),
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  };
}

function testApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-account', aiAccountRoutes);
  return app;
}

function sharedAuthority(overrides = {}) {
  return {
    ok: true,
    service: 'seemplify-shared-ai-account',
    consumer: DEPLOYMENT_HEALTH_SERVICE,
    signatureVersion: SIGNATURE_VERSION,
    ...overrides
  };
}

function withDeploymentHealthDependencies(fn) {
  const priorSecret = process.env.PERFORMANCE_AI_SHARED_SECRET;
  const originalCreate = DeploymentHealthNonce.create;
  const originalHealth = sharedAIAccountService.health;
  const claimed = new Set();
  process.env.PERFORMANCE_AI_SHARED_SECRET = TEST_SECRET;
  DeploymentHealthNonce.create = async ({ nonce }) => {
    if (claimed.has(nonce)) throw Object.assign(new Error('duplicate nonce'), { code: 11000 });
    claimed.add(nonce);
    return { nonce };
  };
  return Promise.resolve().then(() => fn({
    setHealth(health) { sharedAIAccountService.health = health; }
  })).finally(() => {
    DeploymentHealthNonce.create = originalCreate;
    sharedAIAccountService.health = originalHealth;
    if (priorSecret === undefined) delete process.env.PERFORMANCE_AI_SHARED_SECRET;
    else process.env.PERFORMANCE_AI_SHARED_SECRET = priorSecret;
  });
}

test('signed deployment health reaches Recruiter and returns only the exact service identity', async () => {
  await withDeploymentHealthDependencies(async ({ setHealth }) => {
    let healthCalls = 0;
    setHealth(async () => {
      healthCalls += 1;
      return sharedAuthority({ account: { connectedEmail: 'must-not-leak@example.test' } });
    });

    const response = await request(testApp())
      .post(DEPLOYMENT_HEALTH_PATH)
      .set(signedHeaders())
      .send({})
      .expect(200);

    assert.equal(healthCalls, 1);
    assert.deepEqual(response.body, {
      ok: true,
      service: 'seemplify-shared-ai-consumer-deployment',
      consumer: DEPLOYMENT_HEALTH_SERVICE,
      signatureVersion: SIGNATURE_VERSION,
      shared: sharedAuthority()
    });
    assert.equal(JSON.stringify(response.body).includes('must-not-leak'), false);
  });
});

test('deployment health is available without a Performance user session but rejects the wrong secret', async () => {
  await withDeploymentHealthDependencies(async ({ setHealth }) => {
    let healthCalls = 0;
    setHealth(async () => { healthCalls += 1; return sharedAuthority(); });

    const response = await request(testApp())
      .post(DEPLOYMENT_HEALTH_PATH)
      .set(signedHeaders({ secret: 'wrong-performance-secret' }))
      .send({})
      .expect(401);

    assert.equal(response.body.code, 'DEPLOYMENT_HEALTH_AUTH_INVALID');
    assert.equal(healthCalls, 0);
  });
});

test('deployment health rejects a replay before calling Recruiter twice', async () => {
  await withDeploymentHealthDependencies(async ({ setHealth }) => {
    let healthCalls = 0;
    setHealth(async () => { healthCalls += 1; return sharedAuthority(); });
    const nonce = 'deployment_health_replay_nonce_1234';
    const headers = signedHeaders({ nonce });

    await request(testApp()).post(DEPLOYMENT_HEALTH_PATH).set(headers).send({}).expect(200);
    const replay = await request(testApp()).post(DEPLOYMENT_HEALTH_PATH).set(headers).send({}).expect(401);

    assert.equal(replay.body.code, 'DEPLOYMENT_HEALTH_REPLAY_DETECTED');
    assert.equal(healthCalls, 1);
  });
});

test('deployment health fails closed when Recruiter returns another consumer identity', async () => {
  await withDeploymentHealthDependencies(async ({ setHealth }) => {
    setHealth(async () => sharedAuthority({ consumer: 'messaging' }));

    const response = await request(testApp())
      .post(DEPLOYMENT_HEALTH_PATH)
      .set(signedHeaders())
      .send({})
      .expect(503);

    assert.deepEqual(response.body, {
      ok: false,
      code: 'DEPLOYMENT_HEALTH_AUTHORITY_IDENTITY_INVALID',
      message: 'The shared AI authority returned an unexpected service identity'
    });
  });
});

test('deployment health sanitizes Recruiter reachability failures', async () => {
  await withDeploymentHealthDependencies(async ({ setHealth }) => {
    setHealth(async () => { throw new Error('private upstream detail'); });

    const response = await request(testApp())
      .post(DEPLOYMENT_HEALTH_PATH)
      .set(signedHeaders())
      .send({})
      .expect(503);

    assert.deepEqual(response.body, {
      ok: false,
      code: 'DEPLOYMENT_HEALTH_SHARED_AUTHORITY_UNAVAILABLE',
      message: 'Performance could not verify the shared AI authority'
    });
    assert.equal(JSON.stringify(response.body).includes('private upstream detail'), false);
  });
});
