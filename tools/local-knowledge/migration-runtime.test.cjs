const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AQL } = require('./aql.cjs');
const { CONFIG } = require('./config.cjs');
const { EmbeddingMigrationController } = require('./migration-controller.cjs');
const {
  WorkQueue, createKnowledgeRuntime, embeddingProfiles, tenantDatabaseName,
  validateBackfillInput, validateRetrieveInput,
} = (() => {
  const runtime = require('./runtime.cjs');
  return { ...runtime, tenantDatabaseName: require('./auth.cjs').tenantDatabaseName };
})();

const SECRETS = { 'arango-app': 'a', 'arango-provisioner': 'p', 'llm-service': 'l', 'tei-api': 't', 'docling-api': 'd' };

function publicProfile(profile) {
  return Object.fromEntries(['provider', 'model', 'revision', 'dtype', 'dimensions', 'vectorIndexVersion']
    .map((key) => [key, profile[key]]));
}

function backfillRequest(overrides = {}) {
  const profiles = embeddingProfiles(CONFIG);
  return {
    jobId: 'backfill_1', spaceId: 'space_mixed', knowledgeBaseId: 'base_mixed', documentId: 'doc_mixed',
    sourceIndexVersion: 1, sourceSha256: 'a'.repeat(64), sourceChunkerVersion: 'structured-v1',
    sourceEmbeddingProfile: publicProfile(profiles['qwen-tei']),
    embeddingProfile: publicProfile(profiles['gte-node']), batchSize: 32, ...overrides,
  };
}

function fakeTenantClients(spaceId, config, query, { sourceDocument = true } = {}) {
  const database = tenantDatabaseName(spaceId, config.database.prefix);
  return {
    provisioner: { authorization: 'Basic test', request: async (_database, requestPath) => requestPath === '/_api/database/user' ? { result: [database] } : {} },
    app: {
      request: async (_database, requestPath) => {
        if (requestPath === '/_api/collection') return { result: ['documents', 'chunks', 'experience_chunks_gte_v1', 'entities', 'claims', 'relations', 'operation_receipts'].map((name) => ({ name })) };
        if (requestPath === '/_api/analyzer') return { result: [{ name: 'knowledge_segmentation' }] };
        if (requestPath === '/_api/index?collection=chunks') return { indexes: [{ name: 'chunks_text_inverted' }] };
        if (requestPath === '/_api/index?collection=experience_chunks_gte_v1') return { indexes: [] };
        if (requestPath === '/_api/view') return { result: [{ name: 'chunks_search' }] };
        return {};
      },
      query: async (databaseName, queryText, variables) => {
        if (queryText === AQL.gteBackfillSourceDocument) {
          return sourceDocument ? [{ _key: 'source', indexVersion: variables.sourceIndexVersion }] : [];
        }
        return query(databaseName, queryText, variables);
      },
    },
  };
}

test('provider validation rejects mixed query and document embedding spaces', () => {
  const profiles = embeddingProfiles(CONFIG);
  assert.throws(() => validateRetrieveInput({
    requestId: 'request_mixed', spaceId: 'space_mixed', query: 'evidence', topK: 5, graphDepth: 0,
    embeddingProfile: profiles['gte-node'],
    knowledgeBases: [{ id: 'base_mixed', indexVersion: 1, embeddingProfile: profiles['qwen-tei'] }],
  }), (error) => error.code === 'MIXED_EMBEDDING_SPACES' && error.status === 409);
  assert.equal(validateBackfillInput(backfillRequest({ batchSize: 128 })).batchSize, 128);
  assert.throws(() => validateBackfillInput(backfillRequest({ batchSize: 129 })), /positive integer/);
  assert.throws(() => validateBackfillInput(backfillRequest({ sourceEmbeddingProfile: { provider: 'qwen-tei' } })),
    (error) => error.code === 'EMBEDDING_PROFILE_MISMATCH');
});

test('one force-Qwen flag overrides a conflicting GTE rollout for emergency rollback', () => {
  const script = "const {CONFIG}=require('./config.cjs');process.stdout.write(JSON.stringify(CONFIG.embeddingMigration));";
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: __dirname,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPERIENCE_EMBEDDING_FORCE_QWEN: 'true',
      EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node',
      EXPERIENCE_EMBEDDING_MODEL: 'Alibaba-NLP/gte-modernbert-base',
      EXPERIENCE_EMBEDDING_DTYPE: 'q8',
      EXPERIENCE_EMBEDDING_DIMENSIONS: '768',
      EXPERIENCE_VECTOR_INDEX_VERSION: 'gte-modernbert-v1',
      EXPERIENCE_EMBEDDING_DUAL_WRITE: 'true',
      EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT: '100',
      EXPERIENCE_EMBEDDING_SHADOW_PERCENT: '100',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const configuration = JSON.parse(result.stdout);
  assert.deepEqual({ provider: configuration.provider, dualWrite: configuration.dualWrite, rolloutPercent: configuration.rolloutPercent, shadowPercent: configuration.shadowPercent }, {
    provider: 'qwen-tei', dualWrite: false, rolloutPercent: 0, shadowPercent: 0,
  });
});

test('dual-write extracts once and writes immutable Qwen and GTE profiles to separate collections', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-dual-write-'));
  const filename = path.join(directory, 'source.md');
  fs.writeFileSync(filename, 'Lagos service recovery evidence.');
  const config = {
    ...CONFIG,
    paths: { ...CONFIG.paths, staging: directory },
    models: { ...CONFIG.models, embedding: { ...CONFIG.models.embedding, dimension: 2 } },
    embeddingMigration: { ...CONFIG.embeddingMigration, dualWrite: false },
  };
  const profiles = embeddingProfiles(config);
  let qwenChunks = [];
  let gteChunks = [];
  let extractions = 0;
  const clients = fakeTenantClients('space_dual', config, async (_database, query, variables = {}) => {
    if (query === AQL.findReceipt) return [];
    if (query === AQL.upsertChunks) qwenChunks = variables.chunks;
    if (query === AQL.upsertGteChunks) gteChunks = variables.chunks;
    if (query === AQL.collectionCounts) return [{ documents: 1, chunks: qwenChunks.length, entities: 0, claims: 0, relations: 0 }];
    if (query === AQL.gteCollectionCount) return [gteChunks.length];
    return [];
  });
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner,
    extractDocument: async () => { extractions += 1; return { text: 'Lagos service recovery evidence.', pageCount: 1 }; },
    embedByProfile: async (profile, texts) => texts.map(() => profile.provider === 'qwen-tei' ? [1, 0] : [1, ...Array(767).fill(0)]),
    extractGraph: async () => ({ windows: 0, entities: [], claims: [], relations: [] }),
  });
  try {
    const result = await runtime.index({
      jobId: 'job_dual', spaceId: 'space_dual',
      knowledgeBase: {
        id: 'base_dual', indexVersion: 1, embeddingModel: config.models.embedding.id, embeddingDimension: 2,
        chunkerVersion: 'structured-v1', targetEmbeddingProfiles: [profiles['qwen-tei'], profiles['gte-node']],
      },
      document: {
        id: 'doc_dual', sourcePath: filename, originalName: 'source.md', mimeType: 'text/markdown', sizeBytes: fs.statSync(filename).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), metadata: {},
      },
    });
    assert.equal(extractions, 1);
    assert.equal(qwenChunks.length, 1);
    assert.equal(gteChunks.length, 1);
    assert.equal(qwenChunks[0]._key, gteChunks[0]._key);
    assert.equal(qwenChunks[0].embedding.length, 2);
    assert.equal(gteChunks[0].embedding.length, 768);
    assert.deepEqual(result.metrics.embeddingProfiles.map((profile) => profile.provider), ['qwen-tei', 'gte-node']);
    assert.equal(gteChunks[0].sourceSha256, qwenChunks[0].sourceSha256);
  } finally {
    await runtime.close({ force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GTE-only indexing never calls or writes the retired Qwen provider', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-gte-only-'));
  const filename = path.join(directory, 'source.md');
  fs.writeFileSync(filename, 'CPU-only GTE evidence.');
  const config = {
    ...CONFIG,
    paths: { ...CONFIG.paths, staging: directory },
    embeddingMigration: {
      ...CONFIG.embeddingMigration,
      provider: 'gte-node', dualWrite: false, qwenRollbackRetained: false, rolloutPercent: 100,
    },
  };
  const profiles = embeddingProfiles(config);
  let qwenWrites = 0;
  let gteChunks = [];
  const embeddedProviders = [];
  const clients = fakeTenantClients('space_gte_only', config, async (_database, query, variables = {}) => {
    if (query === AQL.findReceipt) return [];
    if (query === AQL.upsertChunks) qwenWrites += 1;
    if (query === AQL.upsertGteChunks) gteChunks = variables.chunks;
    if (query === AQL.collectionCounts) return [{ documents: 1, chunks: 0, entities: 0, claims: 0, relations: 0 }];
    if (query === AQL.gteCollectionCount) return [gteChunks.length];
    return [];
  });
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner,
    extractDocument: async () => ({ text: 'CPU-only GTE evidence.', pageCount: 1 }),
    embedByProfile: async (profile, texts) => {
      embeddedProviders.push(profile.provider);
      return texts.map(() => [1, ...Array(767).fill(0)]);
    },
    extractGraph: async () => ({ windows: 0, entities: [], claims: [], relations: [] }),
  });
  try {
    const result = await runtime.index({
      jobId: 'job_gte_only', spaceId: 'space_gte_only',
      knowledgeBase: {
        id: 'base_gte_only', indexVersion: 1,
        embeddingModel: profiles['gte-node'].model, embeddingDimension: profiles['gte-node'].dimensions,
        embeddingProfile: profiles['gte-node'], chunkerVersion: 'structured-v1',
        targetEmbeddingProfiles: [profiles['gte-node']],
      },
      document: {
        id: 'doc_gte_only', sourcePath: filename, originalName: 'source.md', mimeType: 'text/markdown',
        sizeBytes: fs.statSync(filename).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), metadata: {},
      },
    });
    assert.deepEqual(embeddedProviders, ['gte-node']);
    assert.equal(qwenWrites, 0);
    assert.equal(gteChunks.length, 1);
    assert.deepEqual(result.metrics.embeddingProfiles.map((profile) => profile.provider), ['gte-node']);
    assert.equal(result.metrics.vectorIndexes.qwen, undefined);
  } finally {
    await runtime.close({ force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GTE backfill reuses canonical chunk boundaries and is resumable and idempotent', async () => {
  const config = { ...CONFIG, embeddingMigration: { ...CONFIG.embeddingMigration, dualWrite: false } };
  const canonical = [{
    _key: 'a'.repeat(64), spaceId: 'space_backfill', knowledgeBaseId: 'base_backfill', documentId: 'doc_backfill', documentName: 'source.md',
    indexVersion: 3, ordinal: 0, text: 'Existing extracted Lagos evidence.', contentHash: 'content-hash', sourceSha256: 'a'.repeat(64),
    tokenEstimate: 5, start: 0, end: 34, section: 'Evidence', page: 1, entityRefs: [], activeUntil: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }];
  let written = [];
  const clients = fakeTenantClients('space_backfill', config, async (_database, query, variables = {}) => {
    if (query === AQL.gteBackfillCandidates) return written.length ? [] : canonical;
    if (query === AQL.upsertGteBackfillChunks) { written = variables.chunks; return written.map((item) => item._key); }
    if (query === AQL.gteBackfillCoverage) return [{
      canonicalCount: 1, validSourceCount: 1, validTargetCount: written.length ? 1 : 0,
      targetCount: written.length ? 1 : 0, exact: written.length === 1,
    }];
    if (query === AQL.gteBackfillRemaining) return [0];
    if (query === AQL.gteCollectionCount) return [written.length];
    return [];
  });
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner,
    embedByProfile: async (_profile, texts) => texts.map(() => [1, ...Array(767).fill(0)]),
  });
  try {
    const request = backfillRequest({
      jobId: 'backfill_1', spaceId: 'space_backfill', knowledgeBaseId: 'base_backfill', documentId: 'doc_backfill',
      sourceIndexVersion: 3,
    });
    const first = await runtime.backfill(request);
    assert.deepEqual({ processed: first.processed, written: first.written, complete: first.complete }, { processed: 1, written: 1, complete: true });
    assert.equal(first.afterKey, canonical[0]._key);
    assert.equal(written[0].contentHash, canonical[0].contentHash);
    assert.equal(written[0].sourceSha256, canonical[0].sourceSha256);
    assert.equal(written[0].vectorIndexVersion, 'gte-modernbert-v1');
    assert.equal(first.sourceIndexVersion, 3);
    assert.deepEqual(first.coverage, { canonicalCount: 1, validSourceCount: 1, validTargetCount: 1, targetCount: 1, exact: true });
    assert.equal(first.attestation.payloadSha256.length, 64);
    assert.match(first.attestation.signature, /^[A-Za-z0-9_-]+$/);
    const retry = await runtime.backfill({ ...request, jobId: 'backfill_2', afterKey: '' });
    assert.equal(retry.written, 0);
  } finally {
    await runtime.close({ force: true });
  }
});

test('configured staged rollout can route an explicit Qwen base to exact-covered GTE', async () => {
  const config = {
    ...CONFIG,
    models: { ...CONFIG.models, embedding: { ...CONFIG.models.embedding, dimension: 2 } },
    embeddingMigration: { ...CONFIG.embeddingMigration, provider: 'gte-node', rolloutPercent: 100, shadowPercent: 0, forceQwenRollback: false },
  };
  const profiles = embeddingProfiles(config);
  const candidate = {
    _key: 'candidate', knowledgeBaseId: 'base_rollout', documentId: 'doc_rollout', documentName: 'source.md',
    text: 'Lagos recovery evidence', page: 1, section: 'Evidence', entityRefs: [], channelScore: 1,
  };
  const clients = fakeTenantClients('space_rollout', config, async (_database, query) => {
    if (query === AQL.gteCoverageByBase) return [{ knowledgeBaseId: 'base_rollout', canonical: 1, gte: 1, valid: 1, complete: true }];
    if (query === AQL.eligibleGteChunkCount) return [1];
    if (query === AQL.exactGteVectorChunks) return [candidate];
    if (query === AQL.lexicalChunks) return [];
    return [];
  });
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner,
    embedByProfile: async (profile) => [profile.provider === 'gte-node' ? [1, ...Array(767).fill(0)] : [1, 0]],
    rerank: async (_query, candidates) => candidates.map((item) => ({ candidate: item, score: 1 })),
  });
  try {
    const result = await runtime.retrieve({
      requestId: 'request_rollout', spaceId: 'space_rollout', query: 'recovery', topK: 5, graphDepth: 0,
      embeddingProfile: profiles['qwen-tei'],
      knowledgeBases: [{ id: 'base_rollout', indexVersion: 1, embeddingProfile: profiles['qwen-tei'] }],
    });
    assert.equal(result.metrics.embeddingProfile.provider, 'gte-node');
    assert.deepEqual(result.metrics.providerRouting, { type: 'rollout', from: 'qwen-tei', to: 'gte-node', rolloutPercent: 100 });
  } finally {
    await runtime.close({ force: true });
  }
});

test('an automatic gate pause rolls an explicitly promoted GTE base back to Qwen', async () => {
  const config = {
    ...CONFIG,
    models: { ...CONFIG.models, embedding: { ...CONFIG.models.embedding, dimension: 2 } },
    embeddingMigration: { ...CONFIG.embeddingMigration, provider: 'gte-node', rolloutPercent: 100, shadowPercent: 0, forceQwenRollback: false },
  };
  const profiles = embeddingProfiles(config);
  const candidate = {
    _key: 'candidate', knowledgeBaseId: 'base_paused', documentId: 'doc_paused', documentName: 'source.md',
    text: 'Lagos recovery evidence', page: 1, section: 'Evidence', entityRefs: [], channelScore: 1,
  };
  const clients = fakeTenantClients('space_paused', config, async (_database, query) => {
    if (query === AQL.gteCoverageByBase) return [{ knowledgeBaseId: 'base_paused', canonical: 1, gte: 1, valid: 1, complete: true }];
    if (query === AQL.eligibleChunkCount) return [1];
    if (query === AQL.exactVectorChunks) return [candidate];
    if (query === AQL.lexicalChunks) return [];
    return [];
  });
  const migrationController = new EmbeddingMigrationController({ provider: 'gte-node', rolloutPercent: 100 });
  migrationController.pause('p95-latency:750');
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner, migrationController,
    embedByProfile: async (profile) => [profile.provider === 'gte-node' ? [1, ...Array(767).fill(0)] : [1, 0]],
    rerank: async (_query, candidates) => candidates.map((item) => ({ candidate: item, score: 1 })),
  });
  try {
    const result = await runtime.retrieve({
      requestId: 'request_paused', spaceId: 'space_paused', query: 'recovery', topK: 5, graphDepth: 0,
      embeddingProfile: profiles['gte-node'],
      knowledgeBases: [{ id: 'base_paused', indexVersion: 1, embeddingProfile: profiles['gte-node'] }],
    });
    assert.equal(result.metrics.embeddingProfile.provider, 'qwen-tei');
    assert.deepEqual(result.metrics.providerRouting, {
      type: 'rollback', from: 'gte-node', to: 'qwen-tei', code: 'MIGRATION_GATE_PAUSED',
    });
  } finally {
    await runtime.close({ force: true });
  }
});

test('runtime queue drains active work and rejects admission during shutdown', async () => {
  const queue = new WorkQueue({ limits: { index: 1 }, maxDepth: 2 });
  let release;
  const active = queue.schedule('index', 'active', () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const closing = queue.close({ timeoutMs: 2_000 });
  await assert.rejects(queue.schedule('index', 'late', async () => true), (error) => error.code === 'RUNTIME_DRAINING');
  release('done');
  assert.equal(await active, 'done');
  await closing;
  assert.equal(queue.snapshot().accepting, false);
});

test('runtime serializes index, backfill, and delete mutations while prioritizing live work', async () => {
  const queue = new WorkQueue({ maxDepth: 8 });
  const order = [];
  let release;
  const first = queue.schedule('backfill', 'backfill-active', () => new Promise((resolve) => {
    order.push('backfill-active');
    release = () => resolve('done');
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const secondBackfill = queue.schedule('backfill', 'backfill-waiting', async () => { order.push('backfill-waiting'); });
  const index = queue.schedule('index', 'index-live', async () => { order.push('index-live'); });
  const remove = queue.schedule('delete', 'delete-live', async () => { order.push('delete-live'); });
  release();
  await Promise.all([first, index, remove, secondBackfill]);
  assert.deepEqual(order, ['backfill-active', 'index-live', 'delete-live', 'backfill-waiting']);
  assert.equal(queue.snapshot().limits.retrieve, 8);
  await queue.close();
});

test('migration AQL accepts pinned legacy Qwen chunks and exact-validates GTE coverage', () => {
  assert.match(AQL.gteBackfillCandidates, /embeddingProvider == null AND LENGTH\(chunk\.embedding \|\| \[\]\) == @sourceEmbeddingDimensions/);
  assert.match(AQL.gteBackfillCandidates, /document\.sha256 == @sourceSha256/);
  assert.match(AQL.gteBackfillRemaining, /target\.embeddingRevision != @embeddingRevision/);
  assert.match(AQL.gteCoverageByBase, /LENGTH\(target\.embedding \|\| \[\]\) == @embeddingDimensions/);
  assert.match(AQL.gteStandaloneCoverageByBase, /complete: targetCount > 0/);
  assert.match(AQL.gteBackfillCoverage, /validTargetCount/);
  assert.match(AQL.gteBackfillCoverage, /targetCount/);
  assert.match(AQL.gteBackfillCoverage, /LENGTH\(canonical\) == LENGTH\(validSource\)/);
  assert.match(AQL.upsertGteBackfillChunks, /source\.indexVersion == @sourceIndexVersion/);
  for (const query of [AQL.gteBackfillSourceDocument, AQL.gteBackfillCandidates, AQL.gteBackfillRemaining, AQL.upsertGteBackfillChunks]) {
    assert.match(query, /document\.embeddingModel == @sourceEmbeddingModel|sourceDocument[\s\S]*document\.embeddingModel == @sourceEmbeddingModel/);
    assert.match(query, /document\.embeddingDimension == @sourceEmbeddingDimensions|sourceDocument[\s\S]*document\.embeddingDimension == @sourceEmbeddingDimensions/);
  }
  assert.match(AQL.closeChunkRevision, /supersededByReceiptKey: @receiptKey/);
});

test('backfill rejects an untagged 2560-dimensional legacy vector when its source document is not pinned Qwen', async () => {
  const config = { ...CONFIG, embeddingMigration: { ...CONFIG.embeddingMigration, dualWrite: false } };
  const clients = fakeTenantClients('space_invalid_legacy', config, async () => [], { sourceDocument: false });
  const runtime = createKnowledgeRuntime({
    config, secrets: SECRETS, appClient: clients.app, provisionerClient: clients.provisioner,
    embedByProfile: async () => { throw new Error('Embedding must not run for an unauthenticated legacy source.'); },
  });
  try {
    await assert.rejects(runtime.backfill(backfillRequest({
      spaceId: 'space_invalid_legacy', knowledgeBaseId: 'base_invalid_legacy', documentId: 'doc_invalid_legacy',
    })), (error) => error.code === 'BACKFILL_SOURCE_INVALID' && error.status === 409 && error.retryable === false);
  } finally {
    await runtime.close({ force: true });
  }
});
