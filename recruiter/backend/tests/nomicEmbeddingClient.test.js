const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKnowledgeServer } = require('../../../tools/local-knowledge/server.cjs');
const { createKnowledgeRuntime } = require('../../../tools/local-knowledge/runtime.cjs');
const { CONFIG } = require('../../../tools/local-knowledge/config.cjs');
const { signRequest } = require('../../../tools/local-knowledge/auth.cjs');
const { generateNomicEmbedding, splitEmbeddingText, embeddingSourceHash } = require('../services/nomicEmbeddingClient');
const { NOMIC_PROFILE, getEmbeddingRuntimeConfig } = require('../config/embeddingRuntimeConfig');

async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recruiter-nomic-'));
  const secret = 'test-recruiter-embedding-credential-32-characters';
  const secretFile = path.join(directory, 'secret'); fs.writeFileSync(secretFile, secret);
  const calls = [];
  const runtime = createKnowledgeRuntime({ config: { ...CONFIG, paths: { ...CONFIG.paths, migrationState: null }, embeddingMigration: { ...CONFIG.embeddingMigration, provider: 'nomic-node' } }, secrets: { 'arango-app': 'test', 'arango-provisioner': 'test', 'chatgpt-gateway': 'test', 'docling-api': 'test' }, embedByProfile: async (profile, texts, options) => {
    calls.push({ profile, texts, options }); return texts.map(() => [1, ...Array(767).fill(0)]);
  }});
  const server = createKnowledgeServer({ runtime, serviceSecret: 'experience-only', recruiterEmbeddingSecret: secret, replayFilename: path.join(directory, 'replay.json') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { ...NOMIC_PROFILE, url: `${base}/v1/embeddings`, secretFile };
  try { await run({ base, config, calls, runtime, secret }); }
  finally { await new Promise(resolve => server.close(resolve)); await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('Recruiter uses the pinned Nomic profile, task priority, and signed internal endpoint', () => fixture(async ({ config, calls }) => {
  assert.equal((await generateNomicEmbedding('synthetic document', { config })).length, 768);
  await generateNomicEmbedding('synthetic query', { config, purpose: 'query' });
  assert.deepEqual(calls.map(call => call.options.priority), ['live-index', 'query']);
  assert.equal(calls[0].profile.revision, NOMIC_PROFILE.revision);
}));

test('the Recruiter key cannot read, mutate or administer Experience corpus data', () => fixture(async ({ base, secret }) => {
  for (const endpoint of ['/v1/status', '/v1/index', '/v1/delete', '/v1/shutdown', '/v1/migrate-nomic']) {
    const body = '{}'; const signed = signRequest(secret, body, endpoint);
    const response = await fetch(`${base}${endpoint}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-seemplify-client': 'recruiter-embeddings', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature } });
    assert.equal(response.status, 403, endpoint);
  }
  const body = '{}'; const signed = signRequest(secret, body, '/v1/status');
  assert.equal((await fetch(`${base}/v1/status`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature } })).status, 401);
}));

test('embedding requests reject replay, excessive batches and invalid task purposes', () => fixture(async ({ base, secret, runtime }) => {
  for (const input of [{ source: 'recruiter', texts: Array(9).fill('text'), purpose: 'document' }, { source: 'recruiter', texts: ['text'], purpose: 'admin' }, { source: 'other', texts: ['text'], purpose: 'query' }]) await assert.rejects(runtime.embeddings(input), { code: 'INVALID_REQUEST' });
  const body = JSON.stringify({ source: 'recruiter', texts: ['synthetic'], purpose: 'query' });
  const signed = signRequest(secret, body, '/v1/embeddings');
  const post = () => fetch(`${base}/v1/embeddings`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-seemplify-client': 'recruiter-embeddings', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature } });
  assert.equal((await post()).status, 200); assert.equal((await post()).status, 401);
}));

test('the embedding client rejects mixed profiles and malformed vectors without logging CV contents', () => fixture(async ({ config }) => {
  for (const result of [{ profile: { ...NOMIC_PROFILE, dimensions: 3072 }, vectors: [Array(768).fill(0)] }, { profile: NOMIC_PROFILE, vectors: [Array(3072).fill(0)] }, { profile: NOMIC_PROFILE, vectors: [Array(768).fill('0')] }]) {
    await assert.rejects(generateNomicEmbedding('private synthetic CV', { config, fetchImpl: async () => ({ ok: true, json: async () => result }) }), /profile mismatch|Invalid Nomic/);
  }
  await assert.rejects(generateNomicEmbedding('private synthetic CV', { config, fetchImpl: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
}));

test('Nomic configuration never silently falls back to available Azure credentials', () => {
  const config = getEmbeddingRuntimeConfig({ RECRUITER_EMBEDDING_PROVIDER: 'nomic-node', AZURE_OPENAI_EMBEDDING_URL: 'https://old.example', AZURE_OPENAI_EMBEDDING_API_KEY: 'unused' });
  assert.equal(config.configured, false); assert.equal(config.model, NOMIC_PROFILE.model);
  assert.equal(config.candidateClass, 'RecruiterCandidateNomicV1'); assert.equal(config.jobClass, 'RecruiterJobNomicV1');
});


test('a saturated shared worker returns retryable HTTP backpressure without uploading documents', () => fixture(async ({ config, runtime }) => {
  runtime.embeddings = async () => { throw Object.assign(new Error('The bounded embedding queue is full.'), { code: 'GTE_QUEUE_FULL', retryable: true }); };
  await assert.rejects(generateNomicEmbedding('synthetic query', { config, purpose: 'query' }), error => error.status === 429 && error.retryable === true);
}));


test('long CVs preserve the input budget in bounded model batches and produce one normalized vector', () => fixture(async ({ config, calls }) => {
  const text = 'Relevant candidate experience and skills. '.repeat(800);
  const output = await generateNomicEmbedding(text, { config });
  const texts = calls.flatMap(call => call.texts);
  assert.equal(texts.join(''), text.slice(0, 24000));
  assert.ok(texts.every(text => text.length <= 1024));
  assert.ok(calls.every(call => call.texts.length <= 8));
  assert.ok(calls.length >= 3);
  assert.equal(output.length, 768); assert.ok(Math.abs(Math.hypot(...output) - 1) < 0.00001);
}));

test('unbroken and non-English input cannot bypass the chunk limit; old vector hashes cannot resume', () => {
  for (const input of ['a'.repeat(24000), '候選人工作經驗'.repeat(4000)]) {
    const chunks = splitEmbeddingText(input); assert.equal(chunks.join(''), input.slice(0,24000));
    assert.ok(chunks.every(chunk => chunk.length <= 1024));
  }
  const old = require('node:crypto').createHash('sha256').update('same CV').digest('hex');
  assert.notEqual(embeddingSourceHash('same CV'), old);
});

test('the signed pure embedding endpoint rejects an unchunked long CV before inference', () => fixture(async ({ runtime, calls }) => {
  await assert.rejects(runtime.embeddings({ source: 'recruiter', texts: ['x'.repeat(1025)], purpose: 'document' }), { code: 'INVALID_REQUEST' });
  assert.equal(calls.length, 0);
}));
