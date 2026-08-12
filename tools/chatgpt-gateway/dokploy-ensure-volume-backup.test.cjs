'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  apiBase,
  gatewayDataVolume,
  selectDestination,
  requestHostSnapshot,
  main
} = require('./dokploy-ensure-volume-backup.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('normalizes the Dokploy API base', () => {
  assert.equal(apiBase('https://deploy.example.com/'), 'https://deploy.example.com/api');
  assert.equal(apiBase('https://deploy.example.com/api'), 'https://deploy.example.com/api');
});

test('finds the named gateway data volume from Docker mount payloads', () => {
  assert.deepEqual(gatewayDataVolume([{ Type: 'volume', Name: 'gateway_data', Destination: '/data' }]), {
    type: 'volume',
    volumeName: 'gateway_data',
    mountPath: '/data'
  });
});

test('selects the sole configured destination', () => {
  assert.equal(selectDestination([{ destinationId: 'dest-1' }]).destinationId, 'dest-1');
});

test('requires an explicit destination when more than one exists', () => {
  assert.throws(() => selectDestination([
    { destinationId: 'dest-1' },
    { destinationId: 'dest-2' }
  ]), /Exactly one/);
  assert.equal(selectDestination([
    { destinationId: 'dest-1' },
    { destinationId: 'dest-2' }
  ], 'dest-2').destinationId, 'dest-2');
});

test('writes a narrow host snapshot request without accepting unsafe volume names', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-backup-output-'));
  const output = path.join(directory, 'github-output');
  assert.deepEqual(requestHostSnapshot('chatgpt_gateway_data', output), {
    hostSnapshotRequired: true,
    volumeName: 'chatgpt_gateway_data'
  });
  assert.equal(
    fs.readFileSync(output, 'utf8'),
    'host_snapshot_required=true\nvolume_name=chatgpt_gateway_data\n'
  );
  assert.throws(() => requestHostSnapshot('../data', output), /not safe/);
});

test('requires the host snapshot only for an installation with no S3 destination', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-backup-main-'));
  const output = path.join(directory, 'github-output');
  const fetchImpl = async (url) => {
    if (url.includes('/mounts.allNamedByApplicationId')) {
      return new Response(JSON.stringify([
        { type: 'volume', volumeName: 'chatgpt_gateway_data', mountPath: '/data' }
      ]));
    }
    if (url.includes('/volumeBackups.list')) return new Response(JSON.stringify([]));
    if (url.endsWith('/destination.all')) return new Response(JSON.stringify([]));
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await main({
    fetchImpl,
    source: {
      DOKPLOY_URL: 'https://deploy.example.test',
      DOKPLOY_TOKEN: 'test-token',
      CHATGPT_GATEWAY_APP_ID: 'gateway-app',
      ALLOW_HOST_SNAPSHOT_FALLBACK: 'true',
      GITHUB_OUTPUT: output
    }
  });

  assert.equal(result.hostSnapshotRequired, true);
  assert.match(fs.readFileSync(output, 'utf8'), /volume_name=chatgpt_gateway_data/);
});
