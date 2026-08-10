const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getNotetakerJoinAction,
  mapNylasNotetakerStatus
} = require('../services/notetakerJoinPolicy');

test('maps Nyla lobby and in-call provider states accurately', () => {
  assert.equal(mapNylasNotetakerStatus('waiting_for_entry', 'connecting'), 'joining');
  assert.equal(mapNylasNotetakerStatus('dispatched', 'connecting'), 'joining');
  assert.equal(mapNylasNotetakerStatus('in_call', 'connected'), 'recording');
  assert.equal(mapNylasNotetakerStatus('unknown', 'joined'), 'joined');
  assert.equal(mapNylasNotetakerStatus('failed_entry', 'disconnected'), 'failed');
  assert.equal(mapNylasNotetakerStatus('api_request', 'disconnected'), 'stopped');
});

test('reuses the saved Nyla bot while it can still be dispatched', () => {
  for (const status of ['pending', 'scheduled', 'enabled']) {
    assert.equal(getNotetakerJoinAction('notetaker-1', status), 'dispatch-existing');
  }
});

test('does not create another bot when Nyla is already active or processing', () => {
  for (const status of ['joining', 'joined', 'recording', 'processing', 'completed']) {
    assert.equal(getNotetakerJoinAction('notetaker-1', status), 'already-active');
  }
});

test('only replaces a provider-confirmed terminal bot', () => {
  for (const status of ['failed', 'cancelled', 'deleted', 'stopped']) {
    assert.equal(getNotetakerJoinAction('notetaker-1', status), 'replace-failed');
  }

  assert.equal(getNotetakerJoinAction(null, 'pending'), 'create');
  assert.equal(getNotetakerJoinAction('notetaker-1', 'unknown'), 'blocked');
});
