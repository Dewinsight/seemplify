const test = require('node:test');
const assert = require('node:assert/strict');
const { afterEach, mock } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const AIAuditEvent = require('../models/AIAuditEvent');
const AIUsageEvent = require('../models/AIUsageEvent');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const { AIRuntimeError } = require('../services/aiRuntime/aiRuntimeService');
const { getLiveOperations, listRequests, runRuntimeTest } = require('../services/adminAIRuntimeService');

const route = {
  activity: 'recruiter.general',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  reasoningEffort: 'medium',
  routeVersion: 3,
  enabled: true
};

const request = {
  admin: {
    _id: 'admin-1',
    name: 'Runtime Admin',
    email: 'runtime-admin@example.com'
  },
  ip: '127.0.0.1',
  get: () => 'node-test'
};

afterEach(() => mock.restoreAll());

test('runtime test endpoint requires system settings access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.post\('\/test', \.\.\.settingsAccess/);
});

test('credential management uses the explicit system settings permission', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /const secretAccess = \[adminAuth, requirePermission\('systemSettings'\)\]/);
  assert.doesNotMatch(routeSource, /requireSuperAdmin/);
});

test('queue telemetry stream is authenticated, unbuffered, and cleans up timers', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.get\('\/local\/queue\/stream', \.\.\.analyticsAccess/);
  assert.match(routeSource, /'Content-Type': 'text\/event-stream'/);
  assert.match(routeSource, /'X-Accel-Buffering': 'no'/);
  assert.match(routeSource, /setInterval\(\(\) => void sendSnapshot\(\), 2_000\)/);
  assert.match(routeSource, /req\.on\('close', close\)/);
  assert.match(routeSource, /clearInterval\(snapshotTimer\)/);
});

test('live operations and click-through audit endpoints require analytics access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.get\('\/live\/stream', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/requests\/:id', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/audit\/:id', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/local\/queue\/jobs\/:jobId', \.\.\.analyticsAccess/);
  assert.match(routeSource, /cvAnalysisQueue\.adminTelemetry\(\)/);
});

test('live operations compares providers and recent attributable activity', async () => {
  mock.method(AIUsageEvent, 'aggregate', async () => [{
    hour: [{ calls: 8, successes: 7, failures: 1, tokens: 4000, cost: 0.02, averageLatencyMs: 700, maxLatencyMs: 1900, failovers: 1 }],
    fiveMinutes: [{ calls: 2, successes: 2, failures: 0, tokens: 900, averageLatencyMs: 500 }],
    providers: [
      { _id: 'groq', calls: 6, successes: 5, failures: 1, averageLatencyMs: 600, maxLatencyMs: 1200, lastRequestAt: new Date() },
      { _id: 'local-ollama', calls: 2, successes: 2, failures: 0, averageLatencyMs: 1000, maxLatencyMs: 1900, lastRequestAt: new Date() }
    ],
    activities: [{ _id: 'candidate.cv_parse', calls: 2, successes: 2, failures: 0 }],
    timeline: [{ _id: '2026-07-24T10:00:00Z', calls: 2, failures: 0 }]
  }]);
  mock.method(AIUsageEvent, 'find', () => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() {
      return [{
        _id: 'usage-1',
        requestId: 'request-1',
        provider: 'local-ollama',
        activity: 'candidate.cv_parse',
        organizationName: 'Example Ltd',
        actorName: 'Ada Recruiter',
        status: 'success'
      }];
    }
  }));

  const result = await getLiveOperations();
  assert.equal(result.totals.hour.calls, 8);
  assert.equal(result.totals.hour.successRate, 87.5);
  assert.equal(result.providers[1].id, 'local-ollama');
  assert.equal(result.recent[0].organizationName, 'Example Ltd');
  assert.equal(result.recent[0].actorName, 'Ada Recruiter');
});

function mockUsageQuery(value) {
  return {
    select() { return this; },
    async lean() { return value; }
  };
}

test('admin runtime test uses production routing with a fixed synthetic prompt', async () => {
  let completionInput;
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [route] }));
  mock.method(aiRuntimeService, 'complete', async (activity, input) => {
    assert.equal(activity, route.activity);
    completionInput = input;
    return {
      requestId: 'runtime-test-1',
      content: 'AI runtime test passed.',
      finishReason: 'stop',
      model: route.model,
      usage: { inputTokens: 18, outputTokens: 6, totalTokens: 24 }
    };
  });
  mock.method(AIUsageEvent, 'findOne', () => mockUsageQuery({
    provider: 'groq',
    model: route.model,
    reasoningEffort: 'medium',
    routeVersion: 3,
    quotaGroup: 'groq-primary',
    latencyMs: 125,
    attempts: 1,
    failovers: 0,
    inputTokens: 18,
    cachedInputTokens: 0,
    outputTokens: 6,
    reasoningTokens: 2,
    totalTokens: 24,
    estimatedCostUsd: 0.00001
  }));
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);

  const result = await runRuntimeTest(route.activity, request);

  assert.equal(completionInput.context.sourceApp, 'admin-runtime-test');
  assert.equal(completionInput.context.actorId, 'admin-1');
  assert.equal(completionInput.promptVersion, 'admin-runtime-test-v2');
  assert.equal(completionInput.max_tokens, 512);
  assert.equal(completionInput.messages.length, 2);
  assert.equal(JSON.stringify(completionInput).includes('candidate'), false);
  assert.equal(result.success, true);
  assert.equal(result.execution.requestId, 'runtime-test-1');
  assert.equal(result.execution.quotaGroup, 'groq-primary');
  assert.equal(result.execution.usage.totalTokens, 24);
  assert.equal(audit.mock.calls[0].arguments[0].action, 'runtime_test_succeeded');
  assert.equal('response' in audit.mock.calls[0].arguments[0].metadata, false);
});

test('admin runtime test exercises strict structured transport for structured activities', async () => {
  const structuredRoute = { ...route, activity: 'interview.questions' };
  let structuredInput;
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [structuredRoute] }));
  mock.method(aiRuntimeService, 'structuredComplete', async (activity, input) => {
    assert.equal(activity, structuredRoute.activity);
    structuredInput = input;
    return {
      requestId: 'runtime-structured-1',
      content: JSON.stringify({ passed: true, activity, message: 'Structured route passed.' }),
      data: { passed: true, activity, message: 'Structured route passed.' },
      finishReason: 'stop',
      model: structuredRoute.model,
      usage: { totalTokens: 30 }
    };
  });
  mock.method(AIUsageEvent, 'findOne', () => mockUsageQuery({ provider: 'groq', model: structuredRoute.model, totalTokens: 30 }));
  mock.method(AIAuditEvent, 'create', async (event) => event);

  const result = await runRuntimeTest(structuredRoute.activity, request);
  assert.equal(structuredInput.schemaStrict, true);
  assert.equal(structuredInput.jsonSchema.additionalProperties, false);
  assert.equal(result.execution.structuredOutput, true);
  assert.match(result.execution.response, /Structured route passed/);
});

test('admin runtime test rejects unknown and disabled activities before provider use', async () => {
  const complete = mock.method(aiRuntimeService, 'complete', async () => { throw new Error('should not run'); });
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [{ ...route, enabled: false }] }));

  await assert.rejects(
    runRuntimeTest(route.activity, request),
    { code: 'AI_RUNTIME_TEST_ACTIVITY_DISABLED', field: 'activity', statusCode: 400 }
  );
  await assert.rejects(
    runRuntimeTest('unknown.activity', request),
    { code: 'AI_RUNTIME_TEST_ACTIVITY_INVALID', field: 'activity', statusCode: 400 }
  );
  assert.equal(complete.mock.calls.length, 0);
});

test('admin runtime test records a content-free failed audit', async () => {
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [route] }));
  mock.method(aiRuntimeService, 'complete', async () => {
    throw new AIRuntimeError('No healthy Groq credential is available', {
      code: 'AI_CREDENTIALS_EXHAUSTED',
      statusCode: 503
    });
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);

  await assert.rejects(
    runRuntimeTest(route.activity, request),
    { code: 'AI_CREDENTIALS_EXHAUSTED', statusCode: 503 }
  );
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'runtime_test_failed');
  assert.equal(event.status, 'failed');
  assert.deepEqual(Object.keys(event.metadata).sort(), ['errorCode', 'latencyMs']);
});

test('request analytics summarize the complete filtered result set', async () => {
  const filters = [];
  mock.method(AIUsageEvent, 'find', (filter) => {
    filters.push(filter);
    const latencyOnly = Object.hasOwn(filter, 'latencyMs');
    return {
      select() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      async lean() {
        return latencyOnly
          ? [{ latencyMs: 900 }, { latencyMs: 100 }, { latencyMs: 400 }]
          : [{ requestId: 'request-1', activity: 'interview.questions' }];
      }
    };
  });
  mock.method(AIUsageEvent, 'countDocuments', async () => 42);
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.activity, 'interview.questions');
    assert.equal(pipeline[0].$match.status, 'success');
    assert.equal(pipeline[0].$match.organizationId, 'org-1');
    return [{
      calls: 4,
      successes: 4,
      failures: 0,
      inputTokens: 1200,
      cachedInputTokens: 200,
      outputTokens: 600,
      reasoningTokens: 300,
      totalTokens: 2100,
      estimatedCostUsd: 0.01234567,
      averageLatencyMs: 466.6,
      failovers: 2
    }];
  });

  const result = await listRequests({
    activity: 'interview.questions',
    status: 'success',
    organizationId: 'org-1',
    range: '7d',
    page: '2',
    limit: '10'
  });

  assert.equal(result.items[0].requestId, 'request-1');
  assert.deepEqual(result.summary, {
    calls: 4,
    successes: 4,
    failures: 0,
    successRate: 100,
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 600,
    reasoningTokens: 300,
    totalTokens: 2100,
    estimatedCostUsd: 0.012346,
    averageLatencyMs: 467,
    p50LatencyMs: 400,
    p95LatencyMs: 900,
    failovers: 2,
    detailWindow: '7d'
  });
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 42, pages: 5 });
  assert.equal(filters.length, 2);
  assert.equal(filters[0].activity, 'interview.questions');
  assert.ok(filters[0].createdAt.$gte instanceof Date);
});

test('all-time request details remain bounded to the raw-event retention window', async () => {
  const matches = [];
  mock.method(AIUsageEvent, 'find', (filter) => {
    matches.push(filter);
    return {
      select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
      async lean() { return []; }
    };
  });
  mock.method(AIUsageEvent, 'countDocuments', async (filter) => {
    matches.push(filter);
    return 0;
  });
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    matches.push(pipeline[0].$match);
    return [];
  });

  const result = await listRequests({ range: 'all' });
  assert.equal(result.summary.detailWindow, 'retained-90d');
  assert.ok(matches.length >= 4);
  for (const match of matches) assert.ok(match.createdAt.$gte instanceof Date);
});
