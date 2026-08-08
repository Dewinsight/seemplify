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
    localEnabled: false,
    chatgptEnabled: true,
    chatgptRequired: true,
    defaultRuntime: 'chatgpt'
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
  runtime.getSettings = async () => createDefaultRuntimeSettings();
  await assert.rejects(
    runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write a role description' }],
      context: { actorId: 'unconnected-user' }
    }),
    (error) => error.code === 'AI_RUNTIME_ACCOUNT_REQUIRED' && error.statusCode === 409
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
        content: 'Done', model: 'gpt-5.6-sol', usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  runtime.getSettings = async () => createDefaultRuntimeSettings();
  try {
    const result = await runtime.complete('job.description', {
      messages: [{ role: 'user', content: 'Write it' }],
      context: { actorId: 'user-42', sourceApp: 'recruiter' }
    });
    assert.equal(result.provider, CHATGPT_PROVIDER);
    assert.equal(result.content, 'Done');
    assert.equal(captured.url, 'https://gateway.example.test/v1/complete');
    assert.equal(captured.body.codexSubjectId, 'user-42');
    assert.equal(captured.body.codexSourceApp, 'recruiter');
    assert.equal(captured.body.requiredEngine, 'codex');
    assert.ok(captured.init.headers['x-seemplify-signature']);
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
  process.env.LOCAL_LLM_BASE_URL = 'https://local.example.test';
  process.env.LOCAL_LLM_SHARED_SECRET = 'local-test-secret';
  let subjectLookups = 0;
  let captured;
  const runtime = new AIRuntimeService({
    resolveSubject: async () => { subjectLookups += 1; return null; },
    fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
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
  } finally {
    if (priorUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL; else process.env.LOCAL_LLM_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET; else process.env.LOCAL_LLM_SHARED_SECRET = priorSecret;
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
