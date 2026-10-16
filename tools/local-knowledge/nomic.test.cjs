const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { EMBEDDING_PROFILES, embeddingConfigurationFromEnv } = require('./embedding-profiles.cjs');
const { createGteEmbeddingClient } = require('./gte-embedding-client.cjs');
const { NOMIC_AQL, NOMIC_COLLECTION } = require('./nomic-aql.cjs');
const { EmbeddingMigrationController } = require('./migration-controller.cjs');
const { migrateNomicCorpus, sourceQuery } = require('./nomic-migration.cjs');
const { embeddingProfiles } = require('./runtime.cjs');
const { CONFIG } = require('./config.cjs');

test('Nomic uses a pinned independent embedding space and refuses mixed dimensions', () => {
  const config = embeddingConfigurationFromEnv({ EXPERIENCE_EMBEDDING_PROVIDER: 'nomic-node' });
  assert.equal(config.profile.dimension, 768);
  assert.equal(config.profile.pooling, 'mean');
  assert.match(config.profile.revision, /^[a-f0-9]{40}$/);
  assert.throws(() => embeddingConfigurationFromEnv({ EXPERIENCE_EMBEDDING_PROVIDER: 'nomic-node',
    EXPERIENCE_EMBEDDING_DIMENSIONS: '3072' }), /invalid dimension/);
  const controller = new EmbeddingMigrationController({ provider: 'nomic-node' });
  assert.equal(controller.choose('request'), 'nomic-node');
  assert.equal(controller.status().configuredProvider, 'nomic-node');
});

test('Nomic queue applies query and document prefixes before micro-batching', async () => {
  const batches = [];
  class Worker extends EventEmitter {
    postMessage(m) {
      setImmediate(() => {
        if (m.type === 'initialize') this.emit('message', { type: 'ready', requestId: m.requestId });
        if (m.type === 'embed') {
          batches.push(m.texts);
          this.emit('message', { type: 'embedding-result', requestId: m.requestId,
            vectors: m.texts.map(() => [1, ...Array(767).fill(0)]) });
        }
        if (m.type === 'shutdown') this.emit('message', { type: 'shutdown-complete', requestId: m.requestId });
      });
    }
    terminate() { return Promise.resolve(); }
  }
  const c = createGteEmbeddingClient({ profile: EMBEDDING_PROFILES['nomic-node'],
    cacheDir: '/tmp/nomic-test', workerFactory: () => new Worker(), maxQueueDepth: 2, microBatchDelayMs: 20 });
  await c.start();
  try {
    const doc = c.embed(['A retained document'], { priority: 'live-index', requestId: 'doc' });
    const query = c.embed(['Find the document'], { priority: 'query', requestId: 'query' });
    await assert.rejects(c.embed(['overflow'], { requestId: 'overflow' }), { code: 'GTE_QUEUE_FULL' });
    await Promise.all([doc, query]);
    assert.deepEqual(batches, [['search_query: Find the document', 'search_document: A retained document']]);
  } finally { await c.close(); }
});

test('Nomic vector, graph and deletion queries cannot touch the original vector collections', () => {
  for (const name of ['upsertGteChunks', 'closeGteChunkRevision', 'eligibleGteChunkCount',
    'exactGteVectorChunks', 'annGteVectorChunks', 'graphGteChunks', 'purgeGteChunks', 'purgeGteTargetCount']) {
    assert.ok(NOMIC_AQL[name].includes(NOMIC_COLLECTION), name);
    assert.doesNotMatch(NOMIC_AQL[name], /\bexperience_chunks_gte_v1\b|\bIN chunks\b|\bINTO chunks\b|'gte-node'/);
  }
  assert.match(NOMIC_AQL.exactGteVectorChunks, /vectorIndexVersion == @vectorIndexVersion/);
  assert.match(NOMIC_AQL.exactGteVectorChunks, /embeddingProvider == 'nomic-node'/);
});

test('parallel migration preserves original vectors and refuses incomplete or changed source snapshots', async () => {
  const original = { _key: 'chunk1', documentId: 'document1', text: 'A preserved source document',
    contentHash: 'content-hash', sourceSha256: 'a'.repeat(64), embedding: [0.1],
    embeddingProvider: 'azure-openai', embeddingDimensions: 3072, vectorIndexVersion: 'azure-text-embedding-3-large-v1' };
  let target = [], writes = 0;
  const source = structuredClone(original);
  const app = { query: async (_database, query, vars) => {
    if (query === sourceQuery) return [structuredClone(original)];
    if (query === NOMIC_AQL.upsertGteChunks) { writes++; target = vars.chunks; return []; }
    if (query.includes('IN '+NOMIC_COLLECTION)) return target;
    throw new Error('Unexpected query');
  } };
  const input = { source: 'experience-nomic-migration', spaceId: 'space1', knowledgeBaseId: 'base1',
    indexVersion: 6, documents: [{ id: 'document1', sha256: 'a'.repeat(64), chunkCount: 1 }] };
  const options = { app, database: 'test', profile: embeddingProfiles(CONFIG)['nomic-node'],
    embed: async (texts) => texts.map(() => [1, ...Array(767).fill(0)]) };
  const proof = await migrateNomicCorpus(input, options);
  assert.equal(proof.sourcePreserved, true);
  assert.equal(target[0].embeddingProvider, 'nomic-node');
  assert.equal(target[0].embedding.length, 768);
  assert.deepEqual(original, source);
  const oldWrites = writes;
  await assert.rejects(migrateNomicCorpus({ ...input, documents: [{ ...input.documents[0], chunkCount: 2 }] }, options), /coverage/);
  await assert.rejects(migrateNomicCorpus({ ...input, documents: [{ ...input.documents[0], sha256: 'b'.repeat(64) }] }, options), /checksum/);
  assert.equal(writes, oldWrites);
});
