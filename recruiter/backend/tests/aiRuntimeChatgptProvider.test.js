'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACTIVITY_DEFINITIONS,
  CHATGPT_DEFAULT_CODEX_MODEL,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  createDefaultRuntimeSettings,
  normalizeRuntimePolicy
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

test('the catalog contains only connected ChatGPT routes and models', () => {
  const settings = createDefaultRuntimeSettings();
  assert.deepEqual(settings.runtimePolicy, {
    chatgptEnabled: true,
    chatgptRequired: true,
    defaultRuntime: 'chatgpt'
  });
  assert.deepEqual(normalizeRuntimePolicy({ defaultRuntime: 'anything', chatgptRequired: false }), settings.runtimePolicy);
  assert.equal(settings.models.length, 1);
  assert.equal(settings.models[0].provider, CHATGPT_PROVIDER);
  assert.equal(settings.models[0].id, CHATGPT_MODEL);
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
    assert.equal(captured.body.chatgptSubjectId, 'user-42');
    assert.equal(captured.body.chatgptSourceApp, 'recruiter');
    assert.ok(captured.init.headers['x-seemplify-signature']);
  } finally {
    if (priorUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = priorSecret;
  }
});
