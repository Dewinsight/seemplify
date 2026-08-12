'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deployGateway,
  releaseSha,
  waitForExactGatewayReadiness,
  waitForGatewayDeployment
} = require('./dokploy-deploy-gateway.cjs');

const RELEASE = 'a'.repeat(40);

test('gateway releases require an immutable commit identity', () => {
  assert.equal(releaseSha({ GITHUB_SHA: RELEASE.toUpperCase() }), RELEASE);
  assert.throws(() => releaseSha({ GITHUB_SHA: 'main' }), /40-character commit SHA/);
});

test('narrow gateway deployment changes only the release marker and proves the exact live build', async () => {
  const requests = [];
  let configured;
  let readinessCalls = 0;
  const result = await deployGateway({
    CHATGPT_GATEWAY_APP_ID: 'gateway-app',
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    GITHUB_SHA: RELEASE
  }, {
    requestImpl: async (path) => {
      requests.push(path);
      if (path.startsWith('/application.one')) {
        return { env: 'KEEP=yes\nRECRUITER_CHATGPT_GATEWAY_SECRET=current-secret' };
      }
      if (path.startsWith('/mounts.')) {
        return [{ Type: 'volume', Name: 'gateway-data', Destination: '/data' }];
      }
      return [{ volumeName: 'gateway-data', enabled: true }];
    },
    configureApplicationImpl: async (...args) => {
      configured = args;
      assert.equal(await args[4].readinessProbe(), true);
      return { status: 'done' };
    },
    readinessAttempts: 1,
    fetchImpl: async (url, init) => {
      readinessCalls += 1;
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          service: 'seemplify-ai-gateway',
          runtime: 'codex-app-server',
          ownership: 'seemplify-platform',
          consumers: ['recruiter', 'messaging'],
          release: RELEASE
        }), { status: 200 });
      }
      assert.equal(init.method, 'POST');
      return new Response(JSON.stringify({ connected: false }), { status: 200 });
    }
  });
  assert.equal(result.status, 'done');
  assert.deepEqual(requests, [
    '/application.one?applicationId=gateway-app',
    '/mounts.allNamedByApplicationId?applicationId=gateway-app',
    '/volumeBackups.list?id=gateway-app&volumeBackupType=application'
  ]);
  assert.equal(configured[0], 'gateway-app');
  assert.deepEqual(configured[1], { SEEMPLIFY_GATEWAY_RELEASE_SHA: RELEASE });
  assert.deepEqual(configured[2], []);
  assert.equal(configured[4].acceptRunningDeploymentWhenReady, true);
  assert.equal(configured[4].skipDeploymentWhenEnvironmentExact, undefined);
  assert.equal(typeof configured[4].waitForDeploymentImpl, 'function');
  assert.equal(readinessCalls, 4);
});

test('gateway deployment polling rejects build failures and accepts exact readiness while Dokploy is running', async () => {
  const running = await waitForGatewayDeployment('gateway-app', 'release-title', async () => true, {
    attempts: 1,
    requestImpl: async () => [{ title: 'release-title', status: 'running' }]
  });
  assert.deepEqual(running, { status: 'exact-readiness-passed', deploymentStatus: 'running' });

  await assert.rejects(waitForGatewayDeployment('gateway-app', 'release-title', async () => true, {
    attempts: 1,
    requestImpl: async () => ({
      data: { deployments: [{ title: 'release-title', status: 'error', errorMessage: 'image build failed' }] }
    })
  }), /image build failed/);
});

test('exact readiness retries transient cutover failures and rejects the wrong release', async () => {
  let calls = 0;
  assert.equal(await waitForExactGatewayReadiness({
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'current-secret',
    SEEMPLIFY_GATEWAY_RELEASE_SHA: RELEASE
  }, {
    attempts: 2,
    delayMs: 0,
    wait: async () => {},
    fetchImpl: async (url) => {
      calls += 1;
      if (calls === 1) throw new Error('transient cutover');
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          service: 'seemplify-ai-gateway',
          runtime: 'codex-app-server',
          ownership: 'seemplify-platform',
          consumers: ['messaging'],
          release: RELEASE
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ connected: false }), { status: 200 });
    }
  }), true);
  assert.equal(calls, 3);

  await assert.rejects(waitForExactGatewayReadiness({
    CHATGPT_GATEWAY_BASE_URL: 'https://gateway.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'current-secret',
    SEEMPLIFY_GATEWAY_RELEASE_SHA: RELEASE
  }, {
    attempts: 1,
    fetchImpl: async (url) => url.endsWith('/health')
      ? new Response(JSON.stringify({
          ok: true,
          service: 'seemplify-ai-gateway',
          runtime: 'codex-app-server',
          ownership: 'seemplify-platform',
          consumers: ['messaging'],
          release: 'b'.repeat(40)
        }), { status: 200 })
      : new Response(JSON.stringify({ connected: false }), { status: 200 })
  }), /Exact gateway release did not become ready/);
});
