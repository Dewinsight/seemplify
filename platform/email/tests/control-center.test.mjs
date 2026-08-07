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
    mailApi: { available: true, ready: true, sendEnabled: true, metrics: {}, status: {}, events: [], suppressions: {} },
    cloudflare: { available: true, detail: '200' }, hostingMode,
    dokployComposeUrl: 'https://dokploy.example/compose/mail',
  });
}

test('local migration mode retains rollback controls', () => {
  const result = status('local');
  assert.match(result.mode, /Local rollback/);
  assert.ok(result.actions.length > 0);
});

test('Dokploy mode removes local lifecycle controls and exposes deployment ownership', () => {
  const result = status('dokploy');
  assert.equal(result.mode, 'Hosted on Dokploy');
  assert.deepEqual(result.actions, []);
  assert.equal(result.operations.dokployComposeUrl, 'https://dokploy.example/compose/mail');
});
