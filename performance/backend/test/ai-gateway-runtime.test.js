'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AIGatewayService, selectRuntime } = require('../services/aiGatewayService');
const { aiRequestContext } = require('../services/aiRequestContext');
const chatGptAccountService = require('../services/chatGptAccountService');
const sharedAIAccountService = require('../services/sharedAIAccountService');

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

test('Performance both-enabled mode honors explicit choice and rejects ChatGPT without an IDP identity', async () => {
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
      (error) => error.code === 'SHARED_AI_IDENTITY_REQUIRED' && error.statusCode === 401
    );
  });
});

test('Performance ChatGPT mode uses the central shared account and never calls the gateway directly', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: null
  }, async () => {
    let captured;
    const originalComplete = sharedAIAccountService.complete;
    sharedAIAccountService.complete = async (identity, input) => {
      captured = { identity, input };
      return { content: 'Coaching draft', model: 'gpt-5.6-sol' };
    };
    try {
      const service = new AIGatewayService({ fetchImpl: async () => { throw new Error('direct gateway must not be called'); } });
      service.invalidatePolicyCache();
      const response = await service.getChatCompletions(
        [{ role: 'user', content: 'Coach this review' }],
        {
          activity: 'performance.review', runtimePreference: 'chatgpt',
          identity: { sub: 'idp-performance-user-9', email: 'person@example.com' }
        }
      );
      assert.equal(response.provider, 'chatgpt');
      assert.deepEqual(captured.identity, { sub: 'idp-performance-user-9', email: 'person@example.com' });
      assert.equal(captured.input.activity, 'performance.review');
      assert.equal(captured.input.context.sourceApp, 'performance-management');
    } finally {
      sharedAIAccountService.complete = originalComplete;
    }
  });
});

test('Performance ChatGPT mode forwards the authenticated employee IDP identity from request context', async () => {
  await withEnvironment({
    PERFORMANCE_AI_LOCAL_ENABLED: 'true', PERFORMANCE_AI_CHATGPT_ENABLED: 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: 'local', CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'secret', PERFORMANCE_CHATGPT_SUBJECT_ID: null
  }, async () => {
    const originalComplete = sharedAIAccountService.complete;
    let captured;
    sharedAIAccountService.complete = async (identity, input) => {
      captured = { identity, input };
      return { content: 'Connected coaching' };
    };
    try {
      const service = new AIGatewayService({ fetchImpl: async () => { throw new Error('direct gateway must not be called'); } });
      service.invalidatePolicyCache();
      const response = await new Promise((resolve, reject) => {
        aiRequestContext(
          {
            cookies: { performance_ai_runtime: 'chatgpt' },
            session: { user: { sub: 'idp-employee-42', email: 'employee@example.com' } },
            headers: {}
          },
          {},
          () => service.getChatCompletions([{ role: 'user', content: 'Coach me' }])
            .then(resolve, reject)
        );
      });
      assert.equal(response.choices[0].message.content, 'Connected coaching');
      assert.deepEqual(captured.identity, {
        sub: 'idp-employee-42', email: 'employee@example.com'
      });
      assert.equal(captured.input.context.sourceApp, 'performance-management');
    } finally {
      sharedAIAccountService.complete = originalComplete;
    }
  });
});

test('Performance resolves the same canonical credential key as Recruiter for one IDP subject', () => {
  const subject = 'idp-employee-42';
  const expected = require('node:crypto').createHash('sha256')
    .update(`recruiter\u001f${subject}`).digest('hex');
  assert.equal(chatGptAccountService.subjectKeyForUser(subject), expected);
});
