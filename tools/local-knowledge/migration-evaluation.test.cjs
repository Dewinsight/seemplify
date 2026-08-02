'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertReportIsRedacted,
  evaluateMigration,
  percentile,
  rankingMetrics,
  renderHumanSummary,
  validateEvaluationSet,
} = require('./migration-evaluation.cjs');

const FIXTURE_PATH = path.join(__dirname, 'migration-evaluation.synthetic.json');
const CLI_PATH = path.join(__dirname, 'migration-evaluation.cjs');
const HASH_KEY = 'unit-test-migration-evaluation-hmac-key';

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('synthetic fixture covers representative cases without granting real-data approval', () => {
  const input = fixture();
  const report = evaluateMigration(input, {
    hashKey: HASH_KEY,
    generatedAt: '2026-07-30T00:00:00.000Z',
  });

  const tags = new Set(input.cases.flatMap((item) => item.tags));
  for (const required of ['nigerian-terms', 'paraphrase', 'near-duplicate', 'no-answer', 'multilingual', 'yoruba']) {
    assert.ok(tags.has(required), `missing representative tag ${required}`);
  }
  assert.equal(report.qualityGate.decision, 'INSUFFICIENT_REAL_DATA');
  assert.equal(report.qualityGate.approved, false);
  assert.equal(report.qualityGate.provisionalDecision, 'PASS');
  assert.match(report.qualityGate.insufficientReason, /synthetic/i);
  assert.equal(report.providers.gte.postReranker.hitAt1, 1);
  assert.equal(report.providers.gte.postReranker.hitAt5, 1);
  assert.equal(report.providers.gte.postReranker.recallAt20, 1);
  assert.equal(report.providers.gte.postReranker.mrr, 1);
  assert.equal(report.providers.gte.postReranker.ndcgAt20, 1);
  assert.equal(report.providers.qwen.latencyMs.total.p50, 75);
  assert.equal(report.providers.qwen.latencyMs.total.p95, 88);
  assert.equal(report.providers.qwen.latencyMs.total.p99, 88);
  assert.equal(report.providers.gte.failures, 0);
  assert.equal(report.providers.gte.failureRate, 0);
  assert.equal(report.providers.gte.noAnswer.falsePositiveRate, 0);
  assert.equal(report.cases.length, input.cases.length);
  assert.ok(report.cases.every((item) => /^[a-f0-9]{64}$/.test(item.queryHash)));

  const json = JSON.stringify(report);
  const markdown = renderHumanSummary(report);
  for (const item of input.cases) {
    assert.equal(json.includes(item.query), false);
    assert.equal(markdown.includes(item.query), false);
  }
  assert.match(markdown, /not a real-data approval/i);
  assert.doesNotThrow(() => assertReportIsRedacted(report, input.cases.map((item) => item.query)));
});

test('ranking metrics calculate Hit@1, Hit@5, recall@20, MRR, and graded nDCG', () => {
  const item = {
    noAnswer: false,
    relevance: [
      { documentId: 'doc-a', gain: 3 },
      { documentId: 'doc-b', gain: 1 },
    ],
  };
  const metrics = rankingMetrics(item, [
    { documentId: 'noise-a' },
    { documentId: 'doc-b' },
    { documentId: 'noise-b' },
    { documentId: 'doc-a' },
  ]);

  assert.equal(metrics.hitAt1, 0);
  assert.equal(metrics.hitAt5, 1);
  assert.equal(metrics.recallAt20, 1);
  assert.equal(metrics.reciprocalRank, 0.5);
  assert.equal(metrics.firstRelevantRank, 2);
  const expectedDcg = (1 / Math.log2(3)) + (7 / Math.log2(5));
  const idealDcg = 7 + (1 / Math.log2(3));
  assert.ok(Math.abs(metrics.ndcgAt20 - (expectedDcg / idealDcg)) < 1e-12);
});

test('critical post-reranker rank regression fails the provisional gate', () => {
  const input = fixture();
  const target = input.cases.find((item) => item.id === 'ng-paye-policy');
  target.providers.gte.reranked = [
    { documentId: 'doc-ng-vat', score: 0.91 },
    { documentId: 'doc-ng-paye-current', score: 0.88 },
  ];
  const report = evaluateMigration(input, { hashKey: HASH_KEY });

  assert.equal(report.qualityGate.provisionalDecision, 'FAIL');
  assert.equal(report.qualityGate.decision, 'INSUFFICIENT_REAL_DATA');
  assert.equal(report.qualityGate.checks.noCriticalQueryRegression.passed, false);
  assert.deepEqual(report.criticalRegressions[0].reasons, ['reranked-reciprocal-rank-regressed']);
});

test('no-answer false positives and provider failures are counted', () => {
  const input = fixture();
  input.cases.find((item) => item.id === 'no-answer-benefit').providers.gte.abstained = false;
  const failed = input.cases.find((item) => item.id === 'survey-export').providers.gte;
  failed.failure = { code: 'TIMEOUT' };
  failed.retrieved = [];
  failed.reranked = [];
  delete failed.latencyMs;
  const report = evaluateMigration(input, { hashKey: HASH_KEY });

  assert.equal(report.providers.gte.failures, 1);
  assert.equal(report.providers.gte.failureRate, 0.166667);
  assert.deepEqual(report.providers.gte.failureCodes, ['TIMEOUT']);
  assert.equal(report.providers.gte.noAnswer.falsePositives, 1);
  assert.equal(report.providers.gte.noAnswer.falsePositiveRate, 1);
  assert.ok(report.comparison.failureRate > 0);
});

test('redaction validation rejects unattested, sensitive, and raw-text inputs', () => {
  const unattested = fixture();
  unattested.dataset.redaction.confirmedNoRawSensitiveText = false;
  assert.throws(() => validateEvaluationSet(unattested), { code: 'REDACTION_ATTESTATION_REQUIRED' });

  const sensitive = fixture();
  sensitive.cases[0].query = 'Find the policy for private.person@example.test';
  assert.throws(() => validateEvaluationSet(sensitive), { code: 'QUERY_REDACTION_REQUIRED' });

  const rawField = fixture();
  rawField.cases[0].rawText = 'must never be accepted';
  assert.throws(() => validateEvaluationSet(rawField), { code: 'RAW_TEXT_FIELD_REJECTED' });

  assert.throws(() => evaluateMigration(fixture(), { hashKey: 'too-short' }), { code: 'HASH_KEY_TOO_SHORT' });
  assert.throws(() => assertReportIsRedacted({ query: 'leak' }), /raw-text field/i);
});

test('real-data gate requires at least one hundred redacted cases', () => {
  const base = fixture().cases.find((item) => item.id === 'survey-export');
  const build = (count) => ({
    schemaVersion: 1,
    dataset: {
      id: `real-redacted-${count}`,
      kind: 'real-redacted',
      redaction: { status: 'redacted', confirmedNoRawSensitiveText: true },
    },
    cases: Array.from({ length: count }, (_, index) => ({
      ...clone(base),
      id: `real-case-${index}`,
      query: `Redacted evaluation variant ${index} about an approved policy`,
    })),
  });

  const insufficient = evaluateMigration(build(99), { hashKey: HASH_KEY });
  assert.equal(insufficient.qualityGate.decision, 'INSUFFICIENT_REAL_DATA');
  assert.equal(insufficient.qualityGate.approved, false);

  const sufficient = evaluateMigration(build(100), { hashKey: HASH_KEY });
  assert.equal(sufficient.qualityGate.decision, 'PASS');
  assert.equal(sufficient.qualityGate.approved, true);
  assert.equal(sufficient.qualityGate.realDatasetSufficient, true);
});

test('CLI writes redacted machine and human reports', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-evaluation-'));
  const jsonOutput = path.join(temporaryRoot, 'report.json');
  const markdownOutput = path.join(temporaryRoot, 'report.md');
  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH,
      '--input', FIXTURE_PATH,
      '--json-output', jsonOutput,
      '--markdown-output', markdownOutput,
    ], {
      encoding: 'utf8',
      env: { ...process.env, EXPERIENCE_MIGRATION_EVAL_HASH_KEY: HASH_KEY },
    });

    assert.equal(result.status, 0, result.stderr);
    const operational = JSON.parse(result.stdout);
    assert.equal(operational.decision, 'INSUFFICIENT_REAL_DATA');
    assert.equal(operational.approved, false);
    assert.equal(path.resolve(operational.jsonOutput), path.resolve(jsonOutput));
    assert.equal(path.resolve(operational.markdownOutput), path.resolve(markdownOutput));

    const savedJson = fs.readFileSync(jsonOutput, 'utf8');
    const savedMarkdown = fs.readFileSync(markdownOutput, 'utf8');
    for (const item of fixture().cases) {
      assert.equal(savedJson.includes(item.query), false);
      assert.equal(savedMarkdown.includes(item.query), false);
    }
    assert.doesNotMatch(savedJson, /"query"\s*:/i);
    assert.match(savedMarkdown, /INSUFFICIENT_REAL_DATA/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('percentile uses nearest-rank semantics', () => {
  assert.equal(percentile([9, 1, 5, 3], 0.5), 3);
  assert.equal(percentile([9, 1, 5, 3], 0.95), 9);
  assert.equal(percentile([], 0.95), null);
});
