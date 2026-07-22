const test = require('node:test');
const assert = require('node:assert/strict');
const { afterEach, mock } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const AIAuditEvent = require('../models/AIAuditEvent');
const AIUsageEvent = require('../models/AIUsageEvent');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const { AIRuntimeError } = require('../services/aiRuntime/aiRuntimeService');
const { runRuntimeTest } = require('../services/adminAIRuntimeService');

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
  assert.equal(completionInput.promptVersion, 'admin-runtime-test-v1');
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
