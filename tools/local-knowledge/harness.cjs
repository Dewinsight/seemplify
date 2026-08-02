const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const { signedRequest } = require('./client.cjs');
const { BENCHMARK_CLEANUP_CONFIRMATION } = require('./runtime.cjs');

async function sha256(filename) {
  return crypto.createHash('sha256').update(await fs.promises.readFile(filename)).digest('hex');
}

async function run() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to stage and index the synthetic quality corpus.');
  const fixtureRoot = path.resolve(__dirname, '..', '..', 'experience-management', 'test-fixtures', 'knowledge');
  const expectation = JSON.parse(await fs.promises.readFile(path.join(fixtureRoot, 'expectations.json'), 'utf8'));
  await fs.promises.mkdir(CONFIG.paths.staging, { recursive: true });
  const documents = (await fs.promises.readdir(fixtureRoot)).filter((name) => name.endsWith('.md'));
  const spaceId = `knowledge-live-benchmark-${crypto.randomBytes(16).toString('hex')}`;
  const knowledgeBaseId = `benchmark_base_${crypto.randomBytes(8).toString('hex')}`;
  const stagedFiles = [];
  let indexVersion = 0;
  const results = [];
  try {
    for (const name of documents) {
      indexVersion += 1;
      const source = path.join(fixtureRoot, name);
      const staged = path.join(CONFIG.paths.staging, `${spaceId}-${crypto.randomBytes(6).toString('hex')}-${path.basename(name)}`);
      await fs.promises.copyFile(source, staged);
      stagedFiles.push(staged);
      const stat = await fs.promises.stat(staged);
      await signedRequest('/v1/index', {
        jobId: `harness_index_${crypto.randomBytes(12).toString('hex')}`, spaceId,
        knowledgeBase: { id: knowledgeBaseId, indexVersion, embeddingModel: CONFIG.models.embedding.id, embeddingDimension: CONFIG.models.embedding.dimension, chunkerVersion: 'structured-approx-v1' },
        document: { id: `fixture_${indexVersion}`, sourcePath: staged, originalName: name, mimeType: 'text/markdown', sizeBytes: stat.size, sha256: await sha256(staged), metadata: { synthetic: true } },
      }, { timeoutMs: 30 * 60_000 });
    }
    for (const item of expectation.cases || []) {
      const output = await signedRequest('/v1/retrieve', { requestId: `harness_query_${crypto.randomBytes(12).toString('hex')}`, spaceId, knowledgeBases: [{ id: knowledgeBaseId, indexVersion }], query: item.query, topK: 8, graphDepth: 2 }, { timeoutMs: 3 * 60_000 });
      results.push({ id: item.id, expected: item, citations: output.citations, metrics: output.metrics });
    }
  } finally {
    try {
      await signedRequest('/v1/test/cleanup', { source: 'knowledge-live-benchmark', spaceId, confirmation: BENCHMARK_CLEANUP_CONFIRMATION }, { timeoutMs: 2 * 60_000 });
    } finally {
      await Promise.all(stagedFiles.map((filename) => fs.promises.rm(filename, { force: true })));
    }
  }
  process.stdout.write(`${JSON.stringify({ indexed: documents.length, results }, null, 2)}\n`);
}

if (require.main === module) run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
