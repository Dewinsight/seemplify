const crypto = require('node:crypto');
const { assertId } = require('./auth.cjs');
const { NOMIC_AQL, NOMIC_COLLECTION } = require('./nomic-aql.cjs');
const { validateEmbeddingVectors } = require('./embedding-profiles.cjs');

function fingerprint(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function validateMigration(input) {
  if (input?.source !== 'experience-nomic-migration' || !Number.isSafeInteger(input.indexVersion) || input.indexVersion < 1
      || !Array.isArray(input.documents) || !input.documents.length || input.documents.length > 200) {
    throw new Error('A pinned completed knowledge-base snapshot is required.');
  }
  const documents = input.documents.map((d) => {
    if (!/^[a-f0-9]{64}$/.test(d.sha256) || !Number.isSafeInteger(d.chunkCount) || d.chunkCount < 1) {
      throw new Error('Every source document must have a checksum and a completed chunk count.');
    }
    return { id: assertId(d.id, 'documentId'), sha256: d.sha256, chunkCount: d.chunkCount };
  });
  if (new Set(documents.map((d) => d.id)).size !== documents.length) throw new Error('Duplicate source documents.');
  return { spaceId: assertId(input.spaceId, 'spaceId'), knowledgeBaseId: assertId(input.knowledgeBaseId, 'knowledgeBaseId'),
    indexVersion: input.indexVersion, documents };
}

// Fixed identifiers; request data is always an AQL bind parameter. Original
// vectors and document/graph/receipt records are never modified by this backfill.
const sourceQuery = `FOR c IN chunks
  FILTER c.spaceId == @spaceId AND c.knowledgeBaseId == @knowledgeBaseId
  FILTER c.indexVersion <= @indexVersion AND (c.activeUntil == null OR c.activeUntil > @indexVersion
    OR (c.supersededByReceiptKey != null AND DOCUMENT('operation_receipts',c.supersededByReceiptKey) == null))
  FILTER c.receiptKey == null OR DOCUMENT('operation_receipts',c.receiptKey) != null
  SORT c._key LIMIT 10001 RETURN c`;

async function migrateNomicCorpus(input, { app, database, profile, embed }) {
  const snapshot = validateMigration(input);
  const vars = { spaceId: snapshot.spaceId, knowledgeBaseId: snapshot.knowledgeBaseId, indexVersion: snapshot.indexVersion };
  const source = await app.query(database, sourceQuery, vars);
  if (source.length > 10000 || source.length !== snapshot.documents.reduce((n, d) => n + d.chunkCount, 0)) {
    throw new Error('Source chunk coverage does not match the PostgreSQL snapshot.');
  }
  for (const d of snapshot.documents) {
    const chunks = source.filter((c) => c.documentId === d.id);
    if (chunks.length !== d.chunkCount || chunks.some((c) => c.sourceSha256 !== d.sha256 || !c.text || !c.contentHash
      || c.embeddingProvider !== 'azure-openai' || c.embeddingDimensions !== 3072
      || c.vectorIndexVersion !== 'azure-text-embedding-3-large-v1')) throw new Error('Source profile or document checksum mismatch.');
  }
  const before = fingerprint(source);
  for (let offset = 0; offset < source.length; offset += 8) {
    const batch = source.slice(offset, offset + 8);
    const vectors = await embed(batch.map((c) => c.text));
    validateEmbeddingVectors(vectors, { expectedCount: batch.length, dimension: 768, normalized: true });
    const records = batch.map(({ _id, _rev, ...c }, i) => ({ ...c, embedding: vectors[i],
      embeddingProvider: profile.provider, embeddingModel: profile.model, embeddingRevision: profile.revision,
      embeddingDtype: profile.dtype, embeddingDimensions: profile.dimensions, vectorIndexVersion: profile.vectorIndexVersion }));
    await app.query(database, NOMIC_AQL.upsertGteChunks, { chunks: records });
  }
  const target = await app.query(database, sourceQuery.replace('IN chunks', 'IN '+NOMIC_COLLECTION), vars);
  if (target.length !== source.length || target.some((c, i) => c._key !== source[i]._key || c.text !== source[i].text
    || c.contentHash !== source[i].contentHash || c.sourceSha256 !== source[i].sourceSha256
    || c.embeddingProvider !== profile.provider || c.embeddingRevision !== profile.revision
    || c.vectorIndexVersion !== profile.vectorIndexVersion || c.embedding?.length !== 768
    || c.embedding.some((v) => !Number.isFinite(v)))) throw new Error('Parallel Nomic index verification failed.');
  if (fingerprint(await app.query(database, sourceQuery, vars)) !== before) throw new Error('Source changed during backfill.');
  return { prepared: true, sourcePreserved: true, sourceFingerprint: before, chunks: target.length,
    documents: snapshot.documents.length, indexVersion: snapshot.indexVersion, profile };
}

module.exports = { migrateNomicCorpus, validateMigration, sourceQuery, fingerprint };
