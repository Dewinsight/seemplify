const assert = require('node:assert/strict');
const { createGteEmbeddingClient } = require('./gte-embedding-client.cjs');
const { EMBEDDING_PROFILES } = require('./embedding-profiles.cjs');
if (!process.argv.includes('--live')) throw new Error('Pass --live to run the real local model.');
const client = createGteEmbeddingClient({ profile: EMBEDDING_PROFILES['nomic-node'],
  cacheDir: process.env.EXPERIENCE_EMBEDDING_CACHE_DIR,
  maxLogicalConcurrency: 2, maxQueueDepth: 32, maxBatchTexts: 8, maxTextsPerRequest: 8 });
const cosine = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
(async () => {
  await client.start();
  try {
    const docs = await client.embed(['Employees receive twenty days of paid annual leave each year.',
      'The application database is PostgreSQL and is backed up daily.'], { priority: 'live-index', requestId: 'documents' });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => client.embed(
      ['How much annual holiday can an employee take?'], { priority: 'query', requestId: `query-${i}` })));
    for (const r of results) assert.ok(cosine(r.vectors[0], docs.vectors[0]) > cosine(r.vectors[0], docs.vectors[1]) + 0.05);
    const status = client.status();
    console.log(JSON.stringify({ ok: true, provider: status.profile.provider, modelRevision: status.profile.revision,
      dimensions: docs.vectors[0].length, concurrentQueries: results.length, semanticRankingPassed: true,
      queue: status.queue, metrics: status.metrics }));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
