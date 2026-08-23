import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const panel = require('../control-center/email-panel.cjs');

function status(hostingMode) {
  const containers = ['mariadb','postal-web','postal-smtp','postfix-relay','postal-worker','mail-api']
    .map((service) => ({ service, name: `seemplify-mail-${service}-1`, state: 'running', status: 'healthy' }));
  return panel.buildStatus({
    domain: 'seemplifyai.com', bounceDomain: 'bounce.seemplifyai.com', mailHostname: 'mail.seemplifyai.com',
    docker: { containers }, dns: [], ptr: { state: 'not-applicable', detail: '' },
    relay: { state: 'ready' }, postalQueue: { available: true, detail: 'empty', queues: [] },
    mailApi: { available: true, ready: true, sendEnabled: true, telemetry: { available: true }, metrics: {}, status: {}, events: [], suppressions: {} },
    cloudflare: { available: true, detail: '200' }, hostingMode,
    dokployComposeUrl: 'https://dokploy.example/compose/mail',
  });
}

test('local migration mode retains rollback controls', () => {
  const result = status('local');
  assert.match(result.mode, /Local rollback/);
  assert.ok(result.actions.length > 0);
});

test('Cloudflare-proxied Hostinger ingress accepts A and AAAA records when CNAME is hidden', async () => {
  const enodata = Object.assign(new Error('no cname'), { code: 'ENODATA' });
  const records = await panel.readDns({
    resolveTxt: async () => [['v=spf1', ' -all']],
    resolveCname: async () => { throw enodata; },
    resolve4: async () => ['104.21.58.176'],
    resolve6: async () => ['2606:4700:3033::6815:3ab0'],
  }, { domain: 'seemplifyai.com' });
  const ingress = records.find((record) => record.role === 'Cloudflare-proxied API ingress');
  assert.equal(ingress.configured, true);
  assert.equal(ingress.type, 'A / AAAA');
  assert.equal(ingress.values.length, 2);
});

test('mail API keeps health separate from rejected Hostinger telemetry credentials', async () => {
  const fetchImpl = async (url) => {
    const protectedRoute = /\/v1\//.test(url);
    return {
      ok: !protectedRoute,
      status: protectedRoute ? 401 : 200,
      json: async () => protectedRoute ? { error: 'unauthorized' } : { release: 'hostinger-test' },
    };
  };
  const result = await panel.readMailApi(fetchImpl, { baseUrl: 'https://mail-control.seemplifyai.com', credential: 'control-center.invalid' });
  assert.equal(result.available, true);
  assert.equal(result.ready, true);
  assert.equal(result.telemetry.available, false);
  assert.equal(result.telemetry.state, 'credential-rejected');
  assert.equal(result.sendEnabled, null);
  assert.deepEqual(result.metrics, {});
});

test('Dokploy mode removes local lifecycle controls and exposes deployment ownership', () => {
  const result = status('dokploy');
  assert.equal(result.mode, 'Hosted on Dokploy');
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.containers, []);
  assert.ok(!result.components.some((component) => component.id === 'database'));
  assert.equal(result.queue.state, 'managed');
  assert.equal(result.operations.dokployComposeUrl, 'https://dokploy.example/compose/mail');
});

test('Dokploy plan describes the completed Hostinger production topology', () => {
  const result = panel.buildPlan('seemplifyai.com', { hostingMode: 'dokploy' });
  assert.match(result.mode, /Hostinger\/Dokploy/);
  assert.ok(result.phases.every((phase) => phase.state === 'complete'));
});
