'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACTIVITY_DEFINITIONS,
  CHATGPT_DEFAULT_CODEX_MODEL,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  LOCAL_MODEL,
  LOCAL_PROVIDER,
  createDefaultRuntimeSettings,
  normalizeRuntimePolicy
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

test('the catalog exposes ChatGPT and the Control Center selected local runtime', () => {
  const settings = createDefaultRuntimeSettings();
  assert.deepEqual(settings.runtimePolicy, {
    localEnabled: true,
    chatgptEnabled: true,
    chatgptRequired: false,
    defaultRuntime: 'local'
  });
  assert.deepEqual(normalizeRuntimePolicy({ defaultRuntime: 'anything', chatgptRequired: false }), settings.runtimePolicy);
  assert.equal(settings.models.length, 2);
  assert.ok(settings.models.some((item) => item.provider === CHATGPT_PROVIDER && item.id === CHATGPT_MODEL));
  assert.ok(settings.models.some((item) => item.provider === LOCAL_PROVIDER && item.id === LOCAL_MODEL));
  assert.equal(settings.routes.length, Object.keys(ACTIVITY_DEFINITIONS).length);
  for (const route of settings.routes) {
    assert.equal(route.provider, CHATGPT_PROVIDER);
    assert.equal(route.model, CHATGPT_MODEL);
    assert.equal(route.codexModel, CHATGPT_DEFAULT_CODEX_MODEL);
    assert.equal(route.failoverPolicy, 'chatgpt_required');
  }
});

test('a request without a connected subject fails instead of falling back', async () => {
  const runtime = new AIRuntimeService({
    settingsModel: {},
    resolveSubject: async () => null,
    resolveInterviewSubject: async () => null
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  await assert.rejects(
    runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write a role description' }],
      context: { actorId: 'unconnected-user' }
    }),
    (error) => error.code === 'AI_RUNTIME_ACCOUNT_REQUIRED' && error.statusCode === 409
  );
});

test('candidate interview activities require the candidate ChatGPT account even when Local is the workspace default', async () => {
  const runtime = new AIRuntimeService({
    settingsModel: {},
    resolveSubject: async () => null,
    resolveInterviewSubject: async () => null
  });
  runtime.getSettings = async () => createDefaultRuntimeSettings();

  await assert.rejects(
    runtime.complete('ai_interview.chat.clarification', {
      messages: [{ role: 'user', content: 'What does this mean?' }],
      context: { interviewSessionId: 'candidate-session-1' }
    }),
    (error) => error.code === 'CHATGPT_CANDIDATE_ACCOUNT_REQUIRED' && error.statusCode === 409
  );
});

test('a connected subject is bound to the ChatGPT gateway request', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  let captured;
  const runtime = new AIRuntimeService({
    resolveSubject: async () => ({ subjectId: 'user-42', sourceApp: 'recruiter' }),
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        content: 'Done', model: 'gpt-5.6-sol', modelSource: 'activity',
        reasoningEffort: 'high', reasoningEffortSource: 'activity',
        degraded: false, planType: 'pro',
        usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  try {
    const result = await runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write it' }],
      context: { actorId: 'user-42', sourceApp: 'recruiter' }
    });
    assert.equal(result.provider, CHATGPT_PROVIDER);
    assert.equal(result.content, 'Done');
    assert.equal(result.modelSource, 'activity');
    assert.equal(result.reasoningEffort, 'high');
    assert.equal(result.reasoningEffortSource, 'activity');
    assert.equal(result.degraded, false);
    assert.equal(result.planType, 'pro');
    assert.equal(captured.url, 'https://gateway.example.test/v1/complete');
    assert.equal(captured.body.codexSubjectId, 'user-42');
    assert.equal(captured.body.codexSourceApp, 'recruiter');
    assert.equal(captured.body.requestSource, 'recruiter');
    assert.equal(captured.body.metering.sourceApp, 'recruiter');
    assert.equal(captured.body.requiredEngine, 'codex');
    assert.match(captured.body.metering.eventId, /^usage_[a-f0-9]{48}$/);
    assert.match(captured.body.metering.gatewayExecutionId, /^chatgptexec_[a-f0-9]{48}$/);
    assert.ok(captured.init.headers['x-seemplify-signature']);
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});

test('trusted Performance completion bypasses only Recruiter runtime policy and preserves org metering', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  const captured = [];
  const subjectOptions = [];
  const subjectActors = [];
  const runtime = new AIRuntimeService({
    resolveSubject: async (actor, options) => {
      subjectActors.push(actor);
      subjectOptions.push(options);
      return { subjectId: 'canonical-recruiter-user', sourceApp: 'recruiter' };
    },
    fetchImpl: async (_url, init) => {
      captured.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        content: 'Done', model: 'gpt-5.6-terra', modelSource: 'preference',
        reasoningEffort: 'medium', reasoningEffortSource: 'preference',
        degraded: true, planType: 'pro', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.providerEnabled = false;
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' });
  runtime.getSettings = async () => settings;
  try {
    const call = (operationKey) => runtime.complete('performance.self_assessment.chat', {
      messages: [{ role: 'user', content: 'Coach me' }],
      context: {
        requestId: 'shared-request', operationKey,
        actorId: 'idp-subject-42', runtimeActorId: 'canonical-recruiter-user',
        organizationId: 'idp-active-org', localOrganizationId: 'local-active-org',
        organizationName: 'AIIN',
        sourceApp: 'performance-management'
      }
    }, { requiredRuntime: 'chatgpt', sharedAccountRuntime: true, consentApp: 'performance' });
    const first = await call('question-1');
    await call('question-2');
    await call('question-1');
    assert.equal(first.degraded, true);
    assert.equal(first.reasoningEffort, 'medium');
    assert.ok(captured.every((body) => body.codexSourceApp === 'recruiter'));
    assert.ok(captured.every((body) => body.metering.sourceApp === 'performance-management'));
    assert.ok(captured.every((body) => body.metering.actorId === 'idp-subject-42'));
    assert.ok(captured.every((body) => body.metering.organizationId === 'idp-active-org'));
    assert.ok(captured.every((body) => body.metering.organizationName === 'AIIN'));
    assert.notEqual(captured[0].metering.eventId, captured[1].metering.eventId);
    assert.equal(captured[0].metering.eventId, captured[2].metering.eventId);
    assert.equal(subjectActors[0], 'canonical-recruiter-user');
    assert.deepEqual(subjectOptions[0], { consentApp: 'performance', organizationId: 'local-active-org' });
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});

test('a user activity override controls only the connected-account model and effort candidates', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  let captured;
  const runtime = new AIRuntimeService({
    resolveSubject: async () => ({ subjectId: 'user-override', sourceApp: 'recruiter' }),
    resolveUserRoute: async (_actorId, _activity, adminRoute) => ({
      ...adminRoute,
      codexModel: 'gpt-5.6-terra',
      reasoningEffort: 'high'
    }),
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({
        content: 'Done', model: 'gpt-5.6-terra', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  try {
    await runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write it' }],
      context: { actorId: 'user-override' }
    });
    assert.deepEqual(captured.codexModelCandidates[0], {
      value: 'gpt-5.6-terra', source: 'activity'
    });
    assert.deepEqual(captured.codexEffortCandidates, [{ value: 'high', source: 'activity' }]);
    assert.equal(captured.codexSubjectId, 'user-override');
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});

test('worker and route labels remain diagnostic while metering uses the registered Recruiter identity', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  const captured = [];
  const runtime = new AIRuntimeService({
    resolveSubject: async () => ({ subjectId: 'user-42', sourceApp: 'recruiter' }),
    fetchImpl: async (_url, init) => {
      captured.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        content: 'Done', model: 'gpt-5.6-sol', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  try {
    for (const sourceApp of ['recruiter-cv-worker', 'recruiter-worker', 'recruiter-ai-interview', 'ai-interview', 'admin']) {
      await runtime.complete('job.description', {
        messages: [{ role: 'user', content: 'Write it' }],
        context: { actorId: 'user-42', sourceApp, requestId: `source-${sourceApp}` }
      });
    }
    assert.deepEqual(captured.map((body) => body.requestSource), [
      'recruiter-cv-worker', 'recruiter-worker', 'recruiter-ai-interview', 'ai-interview', 'admin'
    ]);
    assert.ok(captured.every((body) => body.codexSourceApp === 'recruiter'));
    assert.ok(captured.every((body) => body.metering.sourceApp === 'recruiter'));
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});

test('local-only policy bypasses ChatGPT account resolution and uses local gateway configuration', async () => {
  const priorUrl = process.env.LOCAL_LLM_BASE_URL;
  const priorSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  const priorServiceSecret = process.env.LOCAL_LLM_SERVICE_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'https://local.example.test';
  process.env.LOCAL_LLM_SHARED_SECRET = 'local-master-kept-for-usage-ingestion';
  process.env.LOCAL_LLM_SERVICE_SECRET = 'recruiter-local-service-secret';
  let subjectLookups = 0;
  let captured;
  const runtime = new AIRuntimeService({
    resolveSubject: async () => { subjectLookups += 1; return null; },
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        content: 'Local result', model: 'sonnet', engine: 'claude', usage: { input_tokens: 2, output_tokens: 2 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' });
  runtime.getSettings = async () => settings;
  try {
    const result = await runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write it locally' }], context: { actorId: 'user-7' }
    });
    assert.equal(subjectLookups, 0);
    assert.equal(result.provider, LOCAL_PROVIDER);
    assert.equal(result.engine, 'claude');
    assert.equal(captured.url, 'https://local.example.test/v1/complete');
    assert.equal(captured.body.executionMode, 'local-only');
    assert.equal(captured.body.codexSubjectId, undefined);
    assert.match(captured.body.metering.eventId, /^usage_[a-f0-9]{48}$/);
    assert.match(captured.body.metering.gatewayExecutionId, /^localexec_[a-f0-9]{48}$/);
    assert.equal(captured.headers['x-seemplify-service'], 'recruiter');
    assert.equal(captured.headers['x-seemplify-signature-version'], '2');
  } finally {
    if (priorUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL; else process.env.LOCAL_LLM_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET; else process.env.LOCAL_LLM_SHARED_SECRET = priorSecret;
    if (priorServiceSecret === undefined) delete process.env.LOCAL_LLM_SERVICE_SECRET;
    else process.env.LOCAL_LLM_SERVICE_SECRET = priorServiceSecret;
  }
});

test('both-enabled policy honors a user local preference and otherwise uses the admin default', async () => {
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  const localPreference = new AIRuntimeService({ resolveRuntimePreference: async () => 'local' });
  const defaultPreference = new AIRuntimeService({ resolveRuntimePreference: async () => 'default' });
  assert.equal(await localPreference.selectRuntime(settings, { actorId: 'one' }), 'local');
  assert.equal(await defaultPreference.selectRuntime(settings, { actorId: 'two' }), 'chatgpt');
});

test('different prompts in one request and activity receive distinct retry-stable execution receipts', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  const captured = [];
  const runtime = new AIRuntimeService({
    resolveSubject: async () => ({ subjectId: 'user-two-stage', sourceApp: 'recruiter' }),
    fetchImpl: async (_url, init) => {
      captured.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        content: 'Done', model: 'gpt-5.6-sol', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  const invoke = (content) => runtime.complete('assistant.tool_selection', {
    messages: [{ role: 'user', content }],
    context: { requestId: 'two-stage-request', actorId: 'user-two-stage' }
  });
  try {
    await invoke('Detect the user intent');
    await invoke('Choose the candidate agent tools');
    await invoke('Detect the user intent');
    assert.notEqual(captured[0].metering.eventId, captured[1].metering.eventId);
    assert.notEqual(captured[0].metering.gatewayExecutionId, captured[1].metering.gatewayExecutionId);
    assert.equal(captured[0].metering.eventId, captured[2].metering.eventId);
    assert.equal(captured[0].metering.gatewayExecutionId, captured[2].metering.gatewayExecutionId);
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});

test('structured JSON repair attempts use distinct IDs that remain stable when the operation retries', async () => {
  const priorUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const priorSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  const captured = [];
  const runtime = new AIRuntimeService({
    resolveSubject: async () => ({ subjectId: 'user-schema-repair', sourceApp: 'recruiter' }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      captured.push(body);
      const repair = body.messages.some((message) => String(message.content).startsWith('Correct the JSON'));
      return new Response(JSON.stringify({
        content: repair ? '{"answer":"fixed"}' : '{"wrong":true}',
        model: 'gpt-5.6-sol', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const settings = createDefaultRuntimeSettings();
  settings.runtimePolicy = normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' });
  runtime.getSettings = async () => settings;
  const invoke = () => runtime.structuredComplete('job.description', {
    messages: [{ role: 'user', content: 'Return the structured answer' }],
    jsonSchema: {
      type: 'object', additionalProperties: false,
      properties: { answer: { type: 'string' } }, required: ['answer']
    },
    context: { requestId: 'schema-repair-request', actorId: 'user-schema-repair' }
  });
  try {
    const first = await invoke();
    const second = await invoke();
    assert.equal(first.schemaRepairAttempted, true);
    assert.equal(second.schemaRepairAttempted, true);
    assert.equal(captured.length, 4);
    assert.notEqual(captured[0].metering.eventId, captured[1].metering.eventId);
    assert.notEqual(captured[0].metering.gatewayExecutionId, captured[1].metering.gatewayExecutionId);
    assert.equal(captured[0].metering.eventId, captured[2].metering.eventId);
    assert.equal(captured[1].metering.eventId, captured[3].metering.eventId);
    assert.equal(captured[0].metering.gatewayExecutionId, captured[2].metering.gatewayExecutionId);
    assert.equal(captured[1].metering.gatewayExecutionId, captured[3].metering.gatewayExecutionId);
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});
