const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createKnowledgeServer } = require('./server.cjs');
const { signRequest } = require('./auth.cjs');
const { CONFIG } = require('./config.cjs');

async function withServer(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-server-'));
  const runtime = {
    index: async () => ({ document: { chunkCount: 1, relationshipCount: 1 }, metrics: {} }),
    backfill: async (input) => ({ jobId: input.jobId, written: 1, complete: false }),
    retrieve: async () => ({ citations: [], metrics: {} }),
    remove: async () => ({ deleted: true }),
    graph: async () => ({ nodes: [], edges: [], metrics: {} }),
    migrationControl: async (input) => ({ action: input.action, controlledBy: input.source }),
    cleanupTestTenant: async () => ({ cleaned: true, dropped: true }),
    status: async () => ({ ready: true, healthy: true }),
  };
  const server = createKnowledgeServer({ runtime, serviceSecret: 'service-secret', replayFilename: path.join(directory, 'replay.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, server); }
  finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
}

async function signedPost(base, requestPath, input, overrides = {}) {
  const body = JSON.stringify(input);
  const signed = signRequest('service-secret', body, requestPath, overrides);
  return fetch(`${base}${requestPath}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature }, body });
}

test('signed status and graph endpoints are loopback service contracts', async () => withServer(async (base) => {
  const statusResponse = await signedPost(base, '/v1/status', { source: 'experience-management' });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { ready: true, healthy: true });
  assert.equal((await signedPost(base, '/v1/graph', { requestId: 'r', spaceId: 's', knowledgeBase: { id: 'b', indexVersion: 1 }, limit: 10 })).status, 200);
  assert.equal((await signedPost(base, '/v1/test/cleanup', { source: 'knowledge-live-benchmark', spaceId: `knowledge-live-benchmark-${'a'.repeat(32)}`, confirmation: 'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK' })).status, 200);
  const backfill = await signedPost(base, '/v1/backfill', { jobId: 'backfill_1', spaceId: 'space_1', batchSize: 32 });
  assert.equal(backfill.status, 200);
  assert.deepEqual(await backfill.json(), { jobId: 'backfill_1', written: 1, complete: false });
  const migration = await signedPost(base, '/v1/migration', { source: 'control-center', action: 'pause', reason: 'operator-test' });
  assert.equal(migration.status, 200);
  assert.deepEqual(await migration.json(), { action: 'pause', controlledBy: 'control-center' });
}));

test('signed graceful shutdown is restricted to the control center and emits a drain request', async () => withServer(async (base, server) => {
  assert.equal((await signedPost(base, '/v1/shutdown', { source: 'experience-management', mode: 'graceful' })).status, 400);
  const emitted = once(server, 'knowledge-shutdown-request');
  const accepted = await signedPost(base, '/v1/shutdown', { source: 'control-center', mode: 'graceful' });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { accepted: true, mode: 'graceful', pid: process.pid });
  await emitted;
}));

test('replayed signature and unallowlisted paths are rejected', async () => withServer(async (base) => {
  const timestamp = String(Date.now());
  const nonce = 'abcdefghijklmnop';
  assert.equal((await signedPost(base, '/v1/status', { source: 'control-center' }, { timestamp, nonce })).status, 200);
  assert.equal((await signedPost(base, '/v1/status', { source: 'control-center' }, { timestamp, nonce })).status, 401);
  assert.equal((await signedPost(base, '/v1/admin', {})).status, 404);
}));

test('GET and unsigned mutations are rejected', async () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/v1/status`)).status, 404);
  assert.equal((await fetch(`${base}/v1/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
}));

test('replay nonce survives a server restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-restart-replay-'));
  const replayFilename = path.join(directory, 'replay.json');
  const runtime = { index: async () => ({}), backfill: async () => ({}), retrieve: async () => ({}), remove: async () => ({}), graph: async () => ({}), migrationControl: async () => ({}), cleanupTestTenant: async () => ({}), status: async () => ({ ready: true, healthy: true }) };
  const timestamp = String(Date.now());
  const nonce = 'restartpersistnonce';
  const body = JSON.stringify({ source: 'knowledge-live-benchmark' });
  const signature = signRequest('service-secret', body, '/v1/status', { timestamp, nonce });
  const request = async (base) => fetch(`${base}/v1/status`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature.signature }, body });
  const start = async () => {
    const server = createKnowledgeServer({ runtime, serviceSecret: 'service-secret', replayFilename });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  };
  const first = await start();
  assert.equal((await request(`http://127.0.0.1:${first.address().port}`)).status, 200);
  await new Promise((resolve) => first.close(resolve));
  const second = await start();
  assert.equal((await request(`http://127.0.0.1:${second.address().port}`)).status, 401);
  await new Promise((resolve) => second.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});
