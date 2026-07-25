const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  approvedConcurrency,
  assessSustainedRun,
  selectHeadroomConcurrency
} = require('../../../tools/local-llm/benchmark-approval.cjs');
const {
  activityApprovalFor,
  activityConcurrencyDecision,
  assertConcurrencyApproved,
  concurrencyDecision,
  readApprovals,
  recordActivityApproval,
  recordApproval
} = require('../../../tools/local-llm/approval-store.cjs');
const { BoundedFixedWindowRateLimiter } = require('../../../tools/local-llm/bounded-rate-limit.cjs');

function run(concurrency, acceptable = true) {
  return { concurrency, acceptable };
}

test('an intentional discovery failure does not invalidate lower acceptable levels', () => {
  const runs = [run(1), run(2), run(4), run(8, false)];
  assert.equal(selectHeadroomConcurrency(runs), 2);
});

test('headroom approval requires a separate sustained run', () => {
  const discoveryRuns = [run(1), run(2), run(4), run(8, false)];
  const result = approvedConcurrency({
    discoveryRuns,
    sustainedRun: {
      concurrency: 2,
      requests: 12,
      transportSuccessful: 12,
      qualityPassRate: 1,
      p95LatencyMs: 20_000,
      timeouts: 0,
      rateLimited: 0,
      outOfMemory: 0
    },
    acceptance: { minimumRequests: 12, maxP95LatencyMs: 30_000 }
  });
  assert.deepEqual(result, {
    candidateConcurrency: 2,
    concurrency: 2,
    sustainedValidated: true
  });
});

test('missing or weak sustained evidence keeps the production-safe cap at one', () => {
  assert.equal(approvedConcurrency({
    discoveryRuns: [run(1), run(2), run(4)],
    sustainedRun: null
  }).concurrency, 1);
  assert.equal(assessSustainedRun({
    concurrency: 2,
    requests: 4,
    transportSuccessful: 4,
    qualityPassRate: 1,
    p95LatencyMs: 1000
  }), false);
});

test('unapproved 64 and 128 requests cannot exceed the default sustained cap', () => {
  const approvals = { byEngineModel: {} };
  for (const requested of [64, 128]) {
    const decision = concurrencyDecision({
      engine: 'codex',
      model: 'gpt-5.6-terra',
      requested,
      approvals
    });
    assert.equal(decision.approvedConcurrency, 1);
    assert.equal(decision.effectiveConcurrency, 1);
    assert.equal(decision.allowed, false);
    assert.throws(
      () => assertConcurrencyApproved({
        engine: 'codex',
        model: 'gpt-5.6-terra',
        requested,
        approvals
      }),
      (error) => error.code === 'CONCURRENCY_NOT_APPROVED' && error.status === 409
    );
  }
});

test('legacy restore values are capped while a validated value remains usable', () => {
  const approvals = {
    byEngineModel: {
      'ollama:gemma4:26b-a4b-it-qat': {
        engine: 'ollama',
        model: 'gemma4:26b-a4b-it-qat',
        concurrency: 2,
        sustainedValidated: true
      }
    }
  };
  assert.deepEqual(
    concurrencyDecision({
      engine: 'ollama',
      model: 'gemma4:26b-a4b-it-qat',
      requested: 128,
      approvals
    }),
    {
      engine: 'ollama',
      model: 'gemma4:26b-a4b-it-qat',
      requestedConcurrency: 128,
      approvedConcurrency: 2,
      effectiveConcurrency: 2,
      allowed: false,
      sustainedValidated: true
    }
  );
  assert.equal(assertConcurrencyApproved({
    engine: 'ollama',
    model: 'gemma4:26b-a4b-it-qat',
    requested: 2,
    approvals
  }).effectiveConcurrency, 2);
});

test('an unvalidated benchmark cannot silently overwrite a sustained approval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-approval-test-'));
  const approvalPath = path.join(directory, 'approved-concurrency.json');
  try {
    recordApproval({
      engine: 'vllm',
      model: 'Qwen/Qwen3-14B-AWQ',
      concurrency: 2,
      candidateConcurrency: 2,
      sustainedValidated: true,
      approvalPath
    });
    recordApproval({
      engine: 'vllm',
      model: 'Qwen/Qwen3-14B-AWQ',
      concurrency: 1,
      candidateConcurrency: 64,
      sustainedValidated: false,
      approvalPath
    });
    const saved = readApprovals(approvalPath).byEngineModel['vllm:Qwen/Qwen3-14B-AWQ'];
    assert.equal(saved.concurrency, 2);
    assert.equal(saved.sustainedValidated, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('activity approvals are independently capped by the sustained global profile', () => {
  const approvals = {
    byEngineModel: {
      'codex:gpt-5.6-terra': {
        engine: 'codex',
        model: 'gpt-5.6-terra',
        concurrency: 32,
        sustainedValidated: true
      }
    },
    byEngineModelActivity: {
      'codex:gpt-5.6-terra:candidate.cv_parse': {
        engine: 'codex',
        model: 'gpt-5.6-terra',
        activity: 'candidate.cv_parse',
        concurrency: 8,
        candidateConcurrency: 16,
        sustainedValidated: true
      },
      'codex:gpt-5.6-terra:interview.questions': {
        engine: 'codex',
        model: 'gpt-5.6-terra',
        activity: 'interview.questions',
        concurrency: 64,
        candidateConcurrency: 64,
        sustainedValidated: true
      }
    }
  };
  assert.equal(
    activityApprovalFor('codex', 'gpt-5.6-terra', 'candidate.cv_parse', approvals).concurrency,
    8
  );
  assert.equal(
    activityApprovalFor('codex', 'gpt-5.6-terra', 'interview.questions', approvals).concurrency,
    32
  );
  assert.equal(
    activityApprovalFor('codex', 'gpt-5.6-terra', 'assistant.chat', approvals).concurrency,
    1
  );
  assert.deepEqual(
    activityConcurrencyDecision({
      engine: 'codex',
      model: 'gpt-5.6-terra',
      activity: 'candidate.cv_parse',
      requested: 64,
      approvals
    }),
    {
      engine: 'codex',
      model: 'gpt-5.6-terra',
      activity: 'candidate.cv_parse',
      requestedConcurrency: 64,
      approvedConcurrency: 8,
      candidateConcurrency: 16,
      effectiveConcurrency: 8,
      allowed: false,
      sustainedValidated: true,
      globalApprovedConcurrency: 32,
      globalSustainedValidated: true
    }
  );
});

test('activity approval persistence requires and preserves sustained evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-activity-approval-test-'));
  const approvalPath = path.join(directory, 'approved-concurrency.json');
  try {
    recordApproval({
      engine: 'codex',
      model: 'gpt-5.6-terra',
      concurrency: 32,
      candidateConcurrency: 32,
      sustainedValidated: true,
      approvalPath
    });
    recordActivityApproval({
      engine: 'codex',
      model: 'gpt-5.6-terra',
      activity: 'candidate.cv_parse',
      concurrency: 16,
      candidateConcurrency: 16,
      sustainedValidated: true,
      approvalPath
    });
    recordActivityApproval({
      engine: 'codex',
      model: 'gpt-5.6-terra',
      activity: 'candidate.cv_parse',
      concurrency: 1,
      candidateConcurrency: 64,
      sustainedValidated: false,
      approvalPath
    });
    const saved = readApprovals(approvalPath);
    const profile = saved.byEngineModelActivity['codex:gpt-5.6-terra:candidate.cv_parse'];
    assert.equal(profile.concurrency, 16);
    assert.equal(profile.sustainedValidated, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fixed-window rate limiter caps unique keys and frees expired entries', () => {
  const limiter = new BoundedFixedWindowRateLimiter({
    windowMs: 100,
    requests: 2,
    maxKeys: 2,
    pruneIntervalMs: 1
  });
  assert.equal(limiter.consume('one', 1_000), true);
  assert.equal(limiter.consume('one', 1_001), true);
  assert.equal(limiter.consume('one', 1_002), false);
  assert.equal(limiter.consume('two', 1_003), true);
  assert.equal(limiter.consume('three', 1_004), false);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.consume('three', 1_104), true);
  assert.equal(limiter.size, 1);
});

test('benchmark, restore and engine launch paths all enforce the persisted cap', () => {
  const toolRoot = path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm');
  for (const name of ['benchmark.cjs', 'benchmark-engine.cjs', 'benchmark-codex.cjs']) {
    const source = fs.readFileSync(path.join(toolRoot, name), 'utf8');
    assert.match(source, /assertConcurrencyApproved/);
    assert.match(source, /skippedUnapprovedLevels/);
  }
  const evaluator = fs.readFileSync(path.join(toolRoot, 'evaluate-runtime-models.cjs'), 'utf8');
  assert.match(evaluator, /concurrencyDecision/);
  assert.match(evaluator, /effectiveConcurrency/);

  const manager = fs.readFileSync(path.join(toolRoot, 'manage.ps1'), 'utf8');
  assert.match(manager, /Assert-ApprovedConcurrency/);
  assert.match(manager, /OLLAMA_NUM_PARALLEL = '\$parallel'/);
  assert.match(manager, /--max-num-seqs \$approvedConcurrency/);
  assert.match(manager, /\$defaults\.concurrency = \[Math\]::Min\(\$requestedConcurrency, \$approvedConcurrency\)/);
});

test('activity benchmark isolates ingress and requires mixed sustained evidence before approval', () => {
  const toolRoot = path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm');
  const source = fs.readFileSync(path.join(toolRoot, 'benchmark-activities.cjs'), 'utf8');
  assert.match(source, /analyzeWithEngine/);
  assert.match(source, /ingressEnabled: false/);
  assert.match(source, /paused: true/);
  assert.match(source, /await restoreGateway\(original\)/);
  assert.match(source, /report\.mixed\.sustainedValidated/);
  assert.match(source, /recordActivityApproval/);
  assert.match(source, /activity-concurrency-benchmark\.lock/);
});
