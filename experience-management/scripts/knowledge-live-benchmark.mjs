import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const repositoryDir = path.resolve(projectDir, '..');
const fixtureDir = path.join(projectDir, 'test-fixtures', 'knowledge');
const runtimeDir = path.join(repositoryDir, '.local-runtime', 'knowledge');
const stagingDir = process.env.SEEMPLIFY_KNOWLEDGE_STAGING_DIR || 'D:\\SeemplifyKnowledge\\staging';
const baseUrl = String(process.env.KNOWLEDGE_RUNTIME_BASE_URL || 'http://127.0.0.1:11540').replace(/\/+$/, '');
const secretFile = process.env.KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE || path.join(runtimeDir, 'service-secret');
const model = 'Qwen/Qwen3-Embedding-4B';
const dimension = 2560;
const chunkerVersion = 'docling-hybrid-v1';
const cleanupConfirmation = 'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK';

function secret() {
  const value = fs.readFileSync(secretFile, 'utf8').trim();
  if (value.length < 32) throw new Error('Knowledge runtime secret is missing or too short.');
  return value;
}

function signedHeaders(rawBody, requestPath, nonce = crypto.randomBytes(24).toString('base64url')) {
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', secret())
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

async function post(requestPath, payload, timeoutMs = 10 * 60_000, nonce) {
  const rawBody = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: 'POST', headers: signedHeaders(rawBody, requestPath, nonce), body: rawBody,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${requestPath} failed (${response.status}): ${body.code || body.error || body.message || 'unknown error'}`);
  return body;
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

async function timed(task) {
  const started = performance.now();
  const value = await task();
  return { value, milliseconds: Math.round(performance.now() - started) };
}

async function main() {
  fs.mkdirSync(stagingDir, { recursive: true });
  const benchmarkId = crypto.randomUUID();
  const spaceId = `knowledge-live-benchmark-${crypto.randomBytes(16).toString('hex')}`;
  const knowledgeBaseId = `benchmark-${crypto.randomUUID()}`;
  const expectations = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expectations.json'), 'utf8'));
  const documents = [...new Set(expectations.cases.map((item) => item.expectedDocument))];
  const staged = [];
  const indexing = [];
  let version = 0;

  try {
    const status = await post('/v1/status', { source: 'knowledge-live-benchmark' }, 15_000);
    if (!status.ready) throw new Error(`Knowledge runtime is not ready: ${JSON.stringify(status.components || {})}`);

    for (const originalName of documents) {
      const source = path.join(fixtureDir, originalName);
      const destination = path.join(stagingDir, `${crypto.randomUUID()}${path.extname(originalName)}`);
      fs.copyFileSync(source, destination);
      staged.push(destination);
      version += 1;
      const documentId = `benchmark-${crypto.randomUUID()}`;
      const result = await timed(() => post('/v1/index', {
        jobId: `benchmark-${crypto.randomUUID()}`,
        spaceId,
        knowledgeBase: {
          id: knowledgeBaseId, name: 'Synthetic GraphRAG benchmark', indexVersion: version,
          embeddingModel: model, embeddingDimension: dimension, chunkerVersion
        },
        document: {
          id: documentId, sourcePath: destination, originalName, mimeType: 'text/markdown',
          sizeBytes: fs.statSync(destination).size, sha256: sha256(destination),
          metadata: { source: 'synthetic-live-benchmark', expectedDocument: originalName }
        }
      }, 30 * 60_000));
      indexing.push({ document: originalName, latencyMs: result.milliseconds, output: result.value.document, metrics: result.value.metrics });
    }

    const quality = [];
    for (const testCase of expectations.cases) {
      const result = await timed(() => post('/v1/retrieve', {
        requestId: `benchmark-${crypto.randomUUID()}`, spaceId,
        knowledgeBases: [{ id: knowledgeBaseId, indexVersion: version }],
        query: testCase.query, topK: 8, graphDepth: 2,
        retrieval: { vector: true, bm25: true, graph: true, fusion: 'rrf', rerank: true }
      }, 180_000));
      const citations = result.value.citations || [];
      const evidence = citations.map((item) => `${item.documentName}\n${item.excerpt}`).join('\n');
      quality.push({
        id: testCase.id,
        passedDocument: citations.some((item) => item.documentName === testCase.expectedDocument),
        passedTerms: testCase.expectedTerms.every((term) => evidence.toLowerCase().includes(term.toLowerCase())),
        forbiddenTermsPresent: (testCase.forbiddenTerms || []).some((term) => evidence.toLowerCase().includes(term.toLowerCase())),
        topDocument: citations[0]?.documentName || null,
        citationCount: citations.length,
        latencyMs: result.milliseconds,
        metrics: result.value.metrics
      });
    }

    const concurrency = [];
    const workload = expectations.cases.flatMap((item) => [item.query, item.query]);
    for (const width of [1, 2, 4, 8]) {
      const latencies = [];
      let successes = 0;
      const started = performance.now();
      for (let offset = 0; offset < workload.length; offset += width) {
        await Promise.all(workload.slice(offset, offset + width).map(async (query) => {
          const request = await timed(() => post('/v1/retrieve', {
            requestId: `benchmark-${crypto.randomUUID()}`, spaceId,
            knowledgeBases: [{ id: knowledgeBaseId, indexVersion: version }],
            query, topK: 5, graphDepth: 2
          }, 180_000));
          latencies.push(request.milliseconds); successes += 1;
        }));
      }
      const elapsedMs = Math.round(performance.now() - started);
      concurrency.push({ width, requests: workload.length, successes, elapsedMs,
        throughputPerMinute: Number((successes / Math.max(1, elapsedMs) * 60_000).toFixed(2)),
        p50LatencyMs: percentile(latencies, 0.5), p95LatencyMs: percentile(latencies, 0.95) });
    }

    const report = {
      generatedAt: new Date().toISOString(), benchmarkId, runtime: status.version || null,
      model: { id: model, dimension }, corpus: { documents: documents.length, indexVersion: version },
      indexing,
      quality: {
        passed: quality.filter((item) => item.passedDocument && item.passedTerms).length,
        total: quality.length,
        recallAt8: quality.length ? quality.filter((item) => item.passedDocument).length / quality.length : 0,
        cases: quality
      },
      concurrency
    };
    const outputDir = path.join(runtimeDir, 'benchmarks');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `knowledge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ outputFile, ...report }, null, 2)}\n`);
    if (report.quality.passed !== report.quality.total) process.exitCode = 2;
  } finally {
    try {
      await post('/v1/test/cleanup', {
        source: 'knowledge-live-benchmark', spaceId, confirmation: cleanupConfirmation
      }, 2 * 60_000);
    } finally {
      for (const filename of staged) fs.rmSync(filename, { force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
