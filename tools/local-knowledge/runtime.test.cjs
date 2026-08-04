const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const { AQL } = require('./aql.cjs');
const { createReplayGuard, signRequest, tenantDatabaseName, verifyRequest } = require('./auth.cjs');
const {
  BENCHMARK_CLEANUP_CONFIRMATION, blendRetrievalScore, chunkText, createKnowledgeRuntime, groundedMentions,
  normalizeRawRerankerScore, purgeKnowledgeEvidence, rerank,
  selectDeclaredBindVars, upstreamResponseError, validateRetrieveInput, validateScanInput, validateTestCleanupInput, vectorIndexState, weightedReciprocalRankFusion,
} = require('./runtime.cjs');

test('AQL requests send exactly their declared bind parameters', () => {
  assert.deepEqual(
    selectDeclaredBindVars('FOR item IN items FILTER item.spaceId == @spaceId LIMIT @limit RETURN item', {
      spaceId: 'space_1', limit: 10, documentId: 'must-not-leak-into-query', now: 'unused'
    }),
    { spaceId: 'space_1', limit: 10 }
  );
  assert.throws(
    () => selectDeclaredBindVars('RETURN @required', { unrelated: true }),
    /missing required bind parameter 'required'/
  );
});

test('canonical HMAC rejects replay and stale timestamps', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ source: 'experience-management' });
  const requestPath = '/v1/status';
  const signed = signRequest(secret, body, requestPath, { timestamp: '100000', nonce: 'abcdefghijklmnop' });
  const replayGuard = createReplayGuard({ now: () => 100000 });
  const headers = { 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature };
  assert.deepEqual(verifyRequest({ headers, requestPath, rawBody: body, secret, replayGuard, now: () => 100000 }), { ok: true });
  assert.equal(verifyRequest({ headers, requestPath, rawBody: body, secret, replayGuard, now: () => 100000 }).code, 'REPLAYED_REQUEST');
  const stale = signRequest(secret, body, requestPath, { timestamp: '1', nonce: 'ponmlkjihgfedcba' });
  assert.equal(verifyRequest({ headers: { 'x-seemplify-timestamp': stale.timestamp, 'x-seemplify-nonce': stale.nonce, 'x-seemplify-signature': stale.signature }, requestPath, rawBody: body, secret, replayGuard, now: () => 1000000, clockSkewMs: 10 }).code, 'STALE_SIGNATURE');
});

test('tenant database is opaque, deterministic, and never caller-selected', () => {
  const first = tenantDatabaseName('space_alpha');
  const second = tenantDatabaseName('space_alpha');
  assert.equal(first, second);
  assert.match(first, /^exp_[a-f0-9]{40}$/);
  assert.ok(!first.includes('alpha'));
  assert.notEqual(first, tenantDatabaseName('space_beta'));
});

test('retrieval enforces five bases and graph depth two', () => {
  const base = { requestId: 'request_1', spaceId: 'space_1', query: 'hello', topK: 5, graphDepth: 2 };
  const knowledgeBases = Array.from({ length: 5 }, (_, index) => ({ id: `base_${index}`, indexVersion: 2 }));
  assert.equal(validateRetrieveInput({ ...base, knowledgeBases }).knowledgeBases.length, 5);
  assert.throws(() => validateRetrieveInput({ ...base, knowledgeBases: [...knowledgeBases, { id: 'base_6', indexVersion: 1 }] }), /1 to 5/);
  assert.throws(() => validateRetrieveInput({ ...base, knowledgeBases, graphDepth: 3 }), /between 0 and 2/);
});

test('corpus scanning is bounded and the static query retains tenant, base, document, and version filters', () => {
  const input = validateScanInput({ requestId: 'scan_1', spaceId: 'space_1', knowledgeBaseId: 'base_1',
    documentId: 'document_1', indexVersion: 4, offset: 32, limit: 16 });
  assert.deepEqual(input, { requestId: 'scan_1', spaceId: 'space_1', knowledgeBaseId: 'base_1',
    documentId: 'document_1', indexVersion: 4, offset: 32, limit: 16 });
  assert.throws(() => validateScanInput({ ...input, offset: -1 }), /non-negative integer/);
  assert.throws(() => validateScanInput({ ...input, limit: 51 }), /positive integer/);
  assert.match(AQL.scanDocumentChunks, /chunk\.spaceId == @spaceId/);
  assert.match(AQL.scanDocumentChunks, /chunk\.knowledgeBaseId == @knowledgeBaseId/);
  assert.match(AQL.scanDocumentChunks, /chunk\.documentId == @documentId/);
  assert.match(AQL.scanDocumentChunks, /chunk\.indexVersion <= @indexVersion/);
  assert.match(AQL.scanDocumentChunks, /LIMIT @offset, @limit/);
  assert.doesNotMatch(AQL.scanDocumentChunks, /embedding/);
});

test('structure-aware chunking preserves headings, pages, tables, overlap, and deterministic hashes', () => {
  const sections = Array.from({ length: 18 }, (_, index) => `<!-- page_number: ${index + 1} -->\n## Section ${index + 1}\n\n| Metric | Value |\n|---|---|\n| Throughput | ${index + 10} |\n\n${'Operational evidence remains grounded in this section. '.repeat(65)}`).join('\n\n');
  const chunks = chunkText(sections, CONFIG, { pageCount: 18 });
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every((chunk) => chunk.page && chunk.section && chunk.contentHash && chunk.tokenEstimate <= 900));
  assert.equal(chunkText(sections, CONFIG, { pageCount: 18 })[0].contentHash, chunks[0].contentHash);
  assert.ok(chunks.some((chunk) => chunk.text.includes('| Metric | Value |')));
});

test('grounding rejects a fabricated Terra span', () => {
  assert.throws(() => groundedMentions([{ quote: 'not present', start: 0, end: 11 }], 'source evidence', 0), (error) => {
    assert.equal(error.code, 'UNGROUNDED_GRAPH');
    assert.equal(error.status, 422);
    assert.equal(error.retryable, false);
    return true;
  });
});

test('only transport, 429, and upstream 5xx failures are retryable', () => {
  const rejected = upstreamResponseError('docling', { status: 400 }, 'corrupt document');
  assert.deepEqual({ code: rejected.code, status: rejected.status, retryable: rejected.retryable }, { code: 'DOCLING_REQUEST_REJECTED', status: 422, retryable: false });
  const limited = upstreamResponseError('docling', { status: 429 }, 'busy');
  assert.deepEqual({ code: limited.code, status: limited.status, retryable: limited.retryable }, { code: 'DOCLING_UNAVAILABLE', status: 503, retryable: true });
  assert.equal(upstreamResponseError('terra_graph', { status: 500 }, 'offline').retryable, true);
});

test('Arango ingesting is treated as an in-progress vector training state', async () => {
  const state = await vectorIndexState({ request: async () => ({ indexes: [{ name: 'chunks_embedding_vector', trainingState: 'ingesting', id: 'chunks/1' }] }) }, 'tenant');
  assert.equal(state.ready, false);
  assert.equal(state.training, true);
  assert.equal(state.mode, 'exact-training');
});

test('BGE reranking uses bounded batches and preserves global candidate indexes', async () => {
  const batchLengths = [];
  const rawScoreFlags = [];
  const candidates = Array.from({ length: 35 }, (_, index) => ({ _key: `chunk_${index}`, text: `candidate ${index}` }));
  const output = await rerank('query', candidates, {
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      batchLengths.push(body.texts.length);
      rawScoreFlags.push(body.raw_scores);
      return { ok: true, status: 200, json: async () => body.texts.map((_text, index) => ({ index, score: index })) };
    },
  });
  assert.deepEqual(batchLengths, [16, 16, 3]);
  assert.deepEqual(rawScoreFlags, [true, true, true]);
  assert.equal(output.length, 35);
  assert.equal(output.filter((item) => item.candidate._key === 'chunk_34').length, 1);
  assert.ok(output.every((item) => candidates.includes(item.candidate)));
});

test('BGE raw logits are sigmoid-normalized exactly once before retrieval blending', () => {
  const relevantRawLogit = -8.09375;
  const irrelevantRawLogit = -11.03125;
  const relevantProbability = normalizeRawRerankerScore(relevantRawLogit);
  const irrelevantProbability = normalizeRawRerankerScore(irrelevantRawLogit);
  assert.ok(Math.abs(relevantProbability - 0.00030534892) < 1e-9);
  assert.ok(Math.abs(irrelevantProbability - 0.000016187581) < 1e-10);
  assert.ok(relevantProbability > irrelevantProbability * 18);
  const equalFusionScore = 0.01;
  const relevantFinal = blendRetrievalScore(relevantRawLogit, equalFusionScore);
  const irrelevantFinal = blendRetrievalScore(irrelevantRawLogit, equalFusionScore);
  assert.ok(relevantFinal > irrelevantFinal);
  assert.ok(relevantFinal - irrelevantFinal > 0.0002);
});

test('weighted RRF preserves vector-only, lexical-only, and graph-only evidence', () => {
  const result = weightedReciprocalRankFusion([
    { name: 'vector', weight: 0.45, items: [{ _key: 'semantic', text: 'semantic result' }] },
    { name: 'lexical', weight: 0.30, items: [{ _key: 'exact', text: 'exact result' }] },
    { name: 'graph', weight: 0.25, items: [{ _key: 'hop', text: 'graph result' }] },
  ]);
  assert.deepEqual(new Set(result.map((entry) => entry.candidate._key)), new Set(['semantic', 'exact', 'hop']));
  assert.deepEqual(Object.keys(result.find((entry) => entry.candidate._key === 'hop').channels), ['graph']);
});

test('AQL uses bounded hybrid channels, revision watermarks, and physical deletion', () => {
  assert.match(AQL.annVectorChunks, /APPROX_NEAR_COSINE/);
  assert.match(AQL.exactVectorChunks, /COSINE_SIMILARITY/);
  assert.match(AQL.annGteVectorChunks, /APPROX_NEAR_COSINE/);
  assert.ok(AQL.annVectorChunks.indexOf('FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds')
    < AQL.annVectorChunks.indexOf('APPROX_NEAR_COSINE'), 'Qwen ANN must filter the selected bases before probing');
  assert.ok(AQL.annGteVectorChunks.indexOf('FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds')
    < AQL.annGteVectorChunks.indexOf('APPROX_NEAR_COSINE'), 'GTE ANN must filter the selected bases before probing');
  assert.match(AQL.exactGteVectorChunks, /experience_chunks_gte_v1/);
  assert.match(AQL.exactGteVectorChunks, /vectorIndexVersion == @vectorIndexVersion/);
  assert.match(AQL.lexicalChunks, /BM25/);
  assert.match(AQL.graphNeighbors2, /confidence >= @minConfidence/);
  for (const query of [AQL.annVectorChunks, AQL.exactVectorChunks, AQL.lexicalChunks, AQL.graphChunks]) {
    assert.match(query, /spaceId == @spaceId/);
    assert.match(query, /indexVersion <= @watermarkByBase/);
    assert.match(query, /activeUntil/);
  }
  assert.match(AQL.purgeClaims, /REMOVE claim IN claims/);
  assert.match(AQL.purgeRelations, /REMOVE relation IN relations/);
  assert.match(AQL.purgeChunks, /REMOVE chunk IN chunks/);
  assert.match(AQL.purgeGteChunks, /REMOVE chunk IN experience_chunks_gte_v1/);
  assert.match(AQL.purgeDocuments, /REMOVE document IN documents/);
  assert.match(AQL.purgeIndexReceipts, /receipt\.type == 'index'/);
  assert.match(AQL.pruneEntityMentions, /mentions/);
  assert.match(AQL.removeUnsupportedEntities, /REMOVE entity/);
  for (const query of [AQL.purgeClaims, AQL.purgeRelations, AQL.purgeChunks, AQL.purgeDocuments]) {
    assert.doesNotMatch(query, /deletedAt|UPDATE/);
    assert.match(query, /waitForSync: true/);
  }
});

test('physical purge removes every deleted evidence channel and preserves unrelated evidence', async () => {
  const state = {
    documents: [{ knowledgeBaseId: 'base_a', documentId: 'doc_a' }, { knowledgeBaseId: 'base_a', documentId: 'doc_b' }, { knowledgeBaseId: 'base_b', documentId: 'doc_c' }],
    chunks: [{ knowledgeBaseId: 'base_a', documentId: 'doc_a', text: 'deleted vector and lexical evidence', embedding: [1] }, { knowledgeBaseId: 'base_a', documentId: 'doc_b', text: 'retained evidence', embedding: [2] }],
    claims: [{ knowledgeBaseId: 'base_a', documentId: 'doc_a' }, { knowledgeBaseId: 'base_a', documentId: 'doc_b' }],
    relations: [{ knowledgeBaseId: 'base_a', documentId: 'doc_a' }, { knowledgeBaseId: 'base_a', documentId: 'doc_b' }],
    entities: [{ knowledgeBaseId: 'base_a', name: 'Deleted alias', aliases: ['Deleted alias', 'Retained name'], mentions: [{ documentId: 'doc_a', quote: 'Deleted alias' }, { documentId: 'doc_b', quote: 'Retained name' }] }],
    receipts: [{ type: 'index', knowledgeBaseId: 'base_a', documentId: 'doc_a' }, { type: 'index', knowledgeBaseId: 'base_a', documentId: 'doc_b' }],
  };
  const matches = (item, vars) => item.knowledgeBaseId === vars.knowledgeBaseId && (vars.documentId == null || item.documentId === vars.documentId);
  const removeMatches = (name, vars) => { state[name] = state[name].filter((item) => !matches(item, vars)); };
  const counts = (vars) => Object.fromEntries(['documents', 'chunks', 'claims', 'relations'].map((name) => [name, state[name].filter((item) => matches(item, vars)).length]));
  const app = { query: async (_database, query, vars) => {
    if (query === AQL.purgeTargetCounts) return [counts(vars)];
    if (query === AQL.purgeRelations) removeMatches('relations', vars);
    if (query === AQL.purgeClaims) removeMatches('claims', vars);
    if (query === AQL.purgeChunks) removeMatches('chunks', vars);
    if (query === AQL.purgeDocuments) removeMatches('documents', vars);
    if (query === AQL.pruneEntityMentions) state.entities.forEach((entity) => { if (entity.knowledgeBaseId === vars.knowledgeBaseId) { entity.mentions = entity.mentions.filter((mention) => vars.documentId != null && mention.documentId !== vars.documentId); entity.aliases = [...new Set(entity.mentions.map((mention) => mention.quote))]; if (entity.aliases.length) [entity.name] = entity.aliases; } });
    if (query === AQL.removeUnsupportedEntities) state.entities = state.entities.filter((entity) => entity.mentions.length > 0);
    if (query === AQL.purgeIndexReceipts) state.receipts = state.receipts.filter((receipt) => receipt.type !== 'index' || !matches(receipt, vars));
    return [];
  } };

  const first = await purgeKnowledgeEvidence(app, 'tenant', { knowledgeBaseId: 'base_a', documentId: 'doc_a' });
  assert.equal(first.verified, true);
  assert.deepEqual(first.removed, { documents: 1, chunks: 1, claims: 1, relations: 1 });
  assert.equal(state.chunks.some((chunk) => chunk.text.includes('deleted')), false, 'deleted text/embedding is unavailable to retrieval');
  assert.deepEqual(state.entities[0].mentions, [{ documentId: 'doc_b', quote: 'Retained name' }], 'deleted graph provenance is no longer visible');
  assert.deepEqual({ name: state.entities[0].name, aliases: state.entities[0].aliases }, { name: 'Retained name', aliases: ['Retained name'] }, 'deleted aliases are no longer searchable or visible');
  assert.equal(state.receipts.some((receipt) => receipt.documentId === 'doc_a'), false);

  await purgeKnowledgeEvidence(app, 'tenant', { knowledgeBaseId: 'base_a', documentId: null });
  assert.equal(state.documents.some((item) => item.knowledgeBaseId === 'base_a'), false);
  assert.equal(state.chunks.some((item) => item.knowledgeBaseId === 'base_a'), false);
  assert.equal(state.entities.length, 0);
  assert.equal(state.documents.some((item) => item.knowledgeBaseId === 'base_b'), true);
});

test('test tenant cleanup cannot target an arbitrary production space', () => {
  assert.throws(() => validateTestCleanupInput({ source: 'knowledge-live-benchmark', spaceId: 'production_space', confirmation: BENCHMARK_CLEANUP_CONFIRMATION }), (error) => error.code === 'TEST_CLEANUP_NOT_ALLOWED' && error.status === 403);
  const spaceId = `knowledge-live-benchmark-${'a'.repeat(32)}`;
  assert.deepEqual(validateTestCleanupInput({ source: 'knowledge-live-benchmark', spaceId, confirmation: BENCHMARK_CLEANUP_CONFIRMATION }), { spaceId });
});

test('status exposes a consistent ready and healthy contract', async () => {
  const runtime = createKnowledgeRuntime({
    secrets: { 'arango-app': 'a', 'arango-provisioner': 'p', 'llm-service': 'l', 'tei-api': 't', 'docling-api': 'd' },
    appClient: {},
    provisionerClient: { authorization: 'Basic test', request: async () => ({ result: [] }) },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const status = await runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.healthy, true);
  assert.deepEqual(Object.keys(status.services).sort(), ['arango', 'docling', 'embedding', 'gteEmbedding', 'reranker', 'terra']);
});

test('index response exposes canonical relationshipCount and scoped receipt metadata', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-contract-'));
  const filename = path.join(directory, 'source.md');
  fs.writeFileSync(filename, 'Acme works with Beta');
  const config = {
    ...CONFIG,
    paths: { ...CONFIG.paths, staging: directory },
    models: { ...CONFIG.models, embedding: { ...CONFIG.models.embedding, dimension: 2 } },
  };
  const database = tenantDatabaseName('space_contract', config.database.prefix);
  let receipt = null;
  const provisioner = { request: async (_db, requestPath) => requestPath === '/_api/database/user' ? { result: [database] } : {} };
  const app = {
    request: async (_db, requestPath) => {
      if (requestPath === '/_api/collection') return { result: ['documents', 'chunks', 'entities', 'claims', 'relations', 'operation_receipts'].map((name) => ({ name })) };
      if (requestPath === '/_api/analyzer') return { result: [{ name: 'knowledge_segmentation' }] };
      if (requestPath === '/_api/index?collection=chunks') return { indexes: [{ name: 'chunks_text_inverted' }] };
      if (requestPath === '/_api/view') return { result: [{ name: 'chunks_search' }] };
      return {};
    },
    query: async (_db, query, vars) => {
      if (query === AQL.findReceipt) return [];
      if (query === AQL.collectionCounts) return [{ documents: 1, chunks: 1, entities: 2, claims: 0, relations: 1 }];
      if (query === AQL.upsertReceipt) receipt = vars.receipt;
      return [];
    },
  };
  try {
    const runtime = createKnowledgeRuntime({
      config, appClient: app, provisionerClient: provisioner,
      secrets: { 'arango-app': 'a', 'arango-provisioner': 'p', 'llm-service': 'l', 'tei-api': 't', 'docling-api': 'd' },
      extractDocument: async () => ({ text: 'Acme works with Beta', pageCount: 1 }),
      embedTexts: async (texts) => texts.map(() => [1, 0]),
      extractGraph: async () => ({ windows: 1, claims: [], entities: [
        { windowIndex: 0, localId: 'acme', type: 'organization', name: 'Acme', aliases: [], mentions: [{ quote: 'Acme', start: 0, end: 4 }] },
        { windowIndex: 0, localId: 'beta', type: 'organization', name: 'Beta', aliases: [], mentions: [{ quote: 'Beta', start: 16, end: 20 }] },
      ], relations: [{ windowIndex: 0, sourceEntityId: 'acme', targetEntityId: 'beta', type: 'works with', confidence: 0.9, mentions: [{ quote: 'works with', start: 5, end: 15 }] }] }),
    });
    const result = await runtime.index({
      jobId: 'job_contract', spaceId: 'space_contract',
      knowledgeBase: { id: 'base_contract', indexVersion: 1, embeddingModel: config.models.embedding.id, embeddingDimension: 2, chunkerVersion: 'structured-v1' },
      document: { id: 'doc_contract', sourcePath: filename, originalName: 'source.md', mimeType: 'text/markdown', sizeBytes: fs.statSync(filename).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), metadata: {} },
    });
    assert.equal(result.document.relationshipCount, 1);
    assert.equal(receipt.knowledgeBaseId, 'base_contract');
    assert.equal(receipt.documentId, 'doc_contract');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('quality corpus is present for the live hybrid harness', () => {
  const fixtureRoot = path.resolve(__dirname, '..', '..', 'experience-management', 'test-fixtures', 'knowledge');
  const names = fs.readdirSync(fixtureRoot);
  assert.ok(names.includes('expectations.json'));
  assert.ok(names.includes('untrusted-instructions.md'));
  assert.ok(names.filter((name) => name.endsWith('.md')).length >= 4);
});

test('service secret is canonical outside Git-facing source files', () => {
  assert.equal(path.basename(path.join(CONFIG.paths.runtime, 'service-secret')), 'service-secret');
  assert.ok(CONFIG.paths.runtime.includes(`${path.sep}.local-runtime${path.sep}`));
  assert.equal(CONFIG.limits.sourceBytes, 50 * 1024 * 1024);
  assert.ok(CONFIG.supportedMimeTypes.includes('text/csv'));
  assert.ok(CONFIG.supportedMimeTypes.includes('image/png'));
});
