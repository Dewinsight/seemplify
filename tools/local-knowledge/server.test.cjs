const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKnowledgeServer } = require('./server.cjs');
const { signRequest } = require('./auth.cjs');
const { CONFIG } = require('./config.cjs');

async function withServer(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-server-'));
  const runtime = {
    index: async () => ({ document: { chunkCount: 1, relationshipCount: 1 }, metrics: {} }),
    retrieve: async () => ({ citations: [], metrics: {} }),
    remove: async () => ({ deleted: true }),
    graph: async () => ({ nodes: [], edges: [], metrics: {} }),
    cleanupTestTenant: async () => ({ cleaned: true, dropped: true }),
    status: async () => ({ ready: true, healthy: true }),
  };
  const server = createKnowledgeServer({ runtime, serviceSecret: 'service-secret', replayFilename: path.join(directory, 'replay.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
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
  const runtime = { index: async () => ({}), retrieve: async () => ({}), remove: async () => ({}), graph: async () => ({}), cleanupTestTenant: async () => ({}), status: async () => ({ ready: true, healthy: true }) };
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
