'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AIGatewayService, selectRuntime } = require('../services/aiGatewayService');
const { aiRequestContext } = require('../services/aiRequestContext');
const chatGptAccountService = require('../services/chatGptAccountService');

function withEnvironment(values, fn) {
  const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  });
  return Promise.resolve().then(fn).finally(() => {
    Object.entries(prior).forEach(([key, value]) => {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    });
  });
}

test('Performance local-only mode uses the selected Control Center runtime without a ChatGPT subject', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'false',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', LOCAL_LLM_BASE_URL: 'https://local.test',
    LOCAL_LLM_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: null
  }, async () => {
    let captured;
    const service = new AIGatewayService({ fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ content: 'Generated', engine: 'claude', model: 'sonnet' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    } });
    service.invalidatePolicyCache();
    const response = await service.getChatCompletions([{ role: 'user', content: 'Draft an OKR' }], { activity: 'performance.okr' });
    assert.equal(response.choices[0].message.content, 'Generated');
    assert.equal(captured.url, 'https://local.test/v1/complete');
    assert.equal(captured.body.activity, 'performance.okr');
    assert.equal(captured.body.executionMode, 'local-only');
    assert.equal(captured.body.codexSubjectId, undefined);
    assert.match(captured.body.metering.eventId, /^usage_[a-f0-9]{48}$/);
    assert.match(captured.body.metering.gatewayExecutionId, /^localexec_[a-f0-9]{48}$/);
    assert.ok(captured.init.headers['x-seemplify-signature']);
  });
});

test('Performance both-enabled mode honors explicit choice and rejects ChatGPT without a connected subject', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: null
  }, async () => {
    const service = new AIGatewayService({ fetchImpl: async () => { throw new Error('must not call'); } });
    service.invalidatePolicyCache();
    assert.equal(await selectRuntime('local'), 'local');
    await assert.rejects(
      service.getChatCompletions([{ role: 'user', content: 'Review this' }], { runtimePreference: 'chatgpt' }),
      (error) => error.code === 'AI_RUNTIME_ACCOUNT_REQUIRED' && error.statusCode === 409
    );
  });
});

test('Performance ChatGPT mode binds the configured subject and never silently uses local inference', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: 'performance-user-9'
  }, async () => {
    let captured;
    const service = new AIGatewayService({ fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ content: 'Coaching draft', model: 'gpt-5.6-sol' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    } });
    service.invalidatePolicyCache();
    const response = await service.getChatCompletions(
      [{ role: 'user', content: 'Coach this review' }],
      { activity: 'performance.review', runtimePreference: 'chatgpt' }
    );
    assert.equal(response.provider, 'chatgpt');
    assert.equal(captured.url, 'https://chatgpt.test/v1/complete');
    assert.equal(captured.body.codexSourceApp, 'performance-management');
    assert.equal(captured.body.codexSubjectId, 'performance-user-9');
    assert.equal(captured.body.executionMode, 'codex-only');
    assert.equal(captured.body.requiredEngine, 'codex');
    assert.match(captured.body.metering.eventId, /^usage_[a-f0-9]{48}$/);
    assert.match(captured.body.metering.gatewayExecutionId, /^chatgptexec_[a-f0-9]{48}$/);
  });
});

test('Performance ChatGPT mode resolves the authenticated employee connection when no shared subject is configured', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: null
  }, async () => {
    const originalResolver = chatGptAccountService.resolveRoutableSubject;
    let captured;
    chatGptAccountService.resolveRoutableSubject = async (userId) => ({ subjectId: userId, sourceApp: 'performance-management' });
    try {
      const service = new AIGatewayService({ fetchImpl: async (_url, init) => {
        captured = JSON.parse(init.body);
        return new Response(JSON.stringify({ content: 'Connected coaching' }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      } });
      service.invalidatePolicyCache();
      const response = await new Promise((resolve, reject) => {
        aiRequestContext(
          { cookies: { performance_ai_runtime: 'chatgpt' }, session: { user: { sub: 'employee-42' } }, headers: {} },
          {},
          () => service.getChatCompletions([{ role: 'user', content: 'Coach me' }])
            .then(resolve, reject)
        );
      });
      assert.equal(response.choices[0].message.content, 'Connected coaching');
      assert.equal(captured.codexSubjectId, 'employee-42');
      assert.equal(captured.codexSourceApp, 'performance-management');
    } finally {
      chatGptAccountService.resolveRoutableSubject = originalResolver;
    }
  });
});

test('Performance account control requests are signed and isolated to the Performance namespace', async () => {
  await withEnvironment({
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret'
  }, async () => {
    let captured;
    const result = await chatGptAccountService.callGateway('login/start', 'employee-42', {
      fetchImpl: async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ userCode: 'ABCD-EFGH', verificationUrl: 'https://chatgpt.com/device' }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
    });
    assert.equal(result.userCode, 'ABCD-EFGH');
    assert.equal(captured.url, 'https://chatgpt.test/v1/codex/login/start');
    assert.deepEqual(captured.body, { sourceApp: 'performance-management', subjectId: 'employee-42' });
    assert.ok(captured.init.headers['x-seemplify-signature']);
    assert.ok(captured.init.headers['x-seemplify-nonce']);
  });
});
