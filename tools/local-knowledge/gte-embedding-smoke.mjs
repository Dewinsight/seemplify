import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGteEmbeddingClient, validateEmbeddingVectors } = require('./gte-embedding-client.cjs');

if (!process.argv.includes('--live') && process.env.GTE_EMBEDDING_LIVE_SMOKE !== '1') {
  throw new Error('The real GTE smoke test is opt-in. Pass --live or set GTE_EMBEDDING_LIVE_SMOKE=1.');
}

const client = createGteEmbeddingClient();
try {
  await client.start();
  const output = await client.embed([
    'Customer feedback in Lagos shows that faster service recovery improves trust.',
    'Quicker resolution of customer complaints increases confidence in the service.',
  ], { priority: 'query', requestId: `gte-live-smoke-${Date.now()}`, timeoutMs: 5 * 60_000 });
  validateEmbeddingVectors(output.vectors, { expectedCount: 2, dimension: 768, normalized: true });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    profile: output.profile,
    vectorCount: output.vectors.length,
    vectorDimension: output.vectors[0].length,
    metrics: output.metrics,
    runtime: client.status(),
  }, null, 2)}\n`);
} finally {
  await client.close({ drainTimeoutMs: 30_000 });
}
