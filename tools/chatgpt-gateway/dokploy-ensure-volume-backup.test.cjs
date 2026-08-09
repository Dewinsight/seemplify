'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  apiBase,
  gatewayDataVolume,
  selectDestination
} = require('./dokploy-ensure-volume-backup.cjs');

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
