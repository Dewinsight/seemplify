const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const {
  CONCURRENCY_LEVELS,
  EMPTY_GRAPH,
  MINIMUM_CHUNKS,
  benchmarkConcurrency,
  benchmarkQueries,
  cleanupReservedTenant,
  generateSyntheticCorpus,
  percentile,
} = require('./ann-benchmark.cjs');

test('ANN corpus deterministically exceeds the real vector training threshold', () => {
  const first = generateSyntheticCorpus();
  const second = generateSyntheticCorpus();
  assert.equal(first.chunkCount, second.chunkCount);
  assert.ok(first.chunkCount >= MINIMUM_CHUNKS);
  assert.ok(first.chunkCount >= 100);
  assert.ok(Buffer.byteLength(first.text) < CONFIG.limits.sourceBytes);
  assert.ok(first.text.includes('ann-anchor-003'));
  assert.deepEqual(CONCURRENCY_LEVELS, [1, 2, 4, 8]);
});

test('bounded concurrency harness proves widths above the worker limit wait', async () => {
  let active = 0;
  const waiting = [];
  const limit = 2;
  const pump = () => {
    while (active < limit && waiting.length) {
      active += 1;
      const job = waiting.shift();
      setTimeout(() => {
        active -= 1;
        job.resolve({
          citations: [{ documentName: 'synthetic-ann-benchmark.md', excerpt: job.input.query, channels: ['vector'] }],
          metrics: { durationMs: 3, vectorIndex: { ready: true, trainingState: 'ready', mode: 'ann' }, channels: { vector: 1, lexical: 1, graph: 0 } },
        });
        pump();
      }, 4);
    }
  };
  const runtime = {
    retrieve(input) {
      return new Promise((resolve) => { waiting.push({ input, resolve }); pump(); });
    },
    queue: { snapshot: () => ({ active: { retrieve: active }, waiting: waiting.length, limits: { retrieve: limit } }) },
  };
  const context = { runToken: 'test', spaceId: 'space', knowledgeBaseId: 'base', indexVersion: 1 };
  const output = await benchmarkConcurrency(runtime, context, benchmarkQueries(), { levels: CONCURRENCY_LEVELS, requestsPerLevel: 8 });
  assert.deepEqual(output.map((item) => item.width), [1, 2, 4, 8]);
  assert.ok(output.every((item) => item.maxActive <= limit && item.vectorModes[0] === 'ann'));
  assert.ok(output.filter((item) => item.width > limit).every((item) => item.maxWaiting > 0));
});

test('harness is reserved-tenant, empty-graph, cleanup-first infrastructure', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ann-benchmark.cjs'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'experience-management', 'package.json'), 'utf8'));
  const rootPackageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.deepEqual(EMPTY_GRAPH, { entities: [], claims: [], relations: [], windows: 0 });
  assert.match(source, /knowledge-live-benchmark-/);
  assert.match(source, /extractGraph: async \(\) => EMPTY_GRAPH/);
  assert.match(source, /cleanupTestTenant/);
  assert.match(source, /finally \{/);
  assert.match(source, /fs\.rmSync\(stagedFile, \{ force: true \}\)/);
  assert.match(source, /path\.join\(CONFIG\.paths\.runtime, 'benchmarks'\)/);
  assert.match(source, /ann-inflight\.json/);
  assert.match(source, /process\.once\('SIGINT'/);
  assert.equal(packageJson.scripts['test:knowledge:ann'], 'node ../tools/local-knowledge/ann-benchmark.cjs --live');
  assert.equal(rootPackageJson.scripts['test:knowledge:ann:live'], 'node tools/local-knowledge/ann-benchmark.cjs --live');
});

test('reserved tenant cleanup retries and verifies physical database absence', async () => {
  let calls = 0;
  const runtime = { cleanupTestTenant: async () => {
    calls += 1;
    if (calls === 1) throw new Error('transient Arango outage');
    return calls === 2 ? { cleaned: true, dropped: true } : { cleaned: true, dropped: false };
  } };
  const result = await cleanupReservedTenant(runtime, { source: 'knowledge-live-benchmark' });
  assert.equal(calls, 3);
  assert.deepEqual(result, { cleaned: true, dropped: true, verifiedAbsent: true });
});

test('percentile uses nearest-rank semantics', () => {
  assert.equal(percentile([40, 10, 20, 30], 0.5), 20);
  assert.equal(percentile([40, 10, 20, 30], 0.95), 40);
  assert.equal(percentile([], 0.5), null);
});
