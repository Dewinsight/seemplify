const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSignature, createAIPlatformClient, extractJsonObject } = require('../src/llmClient');

test('standalone client signs the exact path/body and never sends a provider key or model', async () => {
  let captured;
  const env = {
    SEEMPLIFY_AI_GATEWAY_URL: 'https://api.example.test',
    AI_GATEWAY_SERVICE_ID: 'ai-interview',
    AI_GATEWAY_HMAC_SECRET: 'shared-test-secret'
  };
  const now = 1784635200000;
  const client = createAIPlatformClient({
    env,
    now: () => now,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ content: '{"ok":true}', model: 'openai/gpt-oss-120b', requestId: 'request-1', usage: { totalTokens: 12 } }), { status: 200 });
    }
  });
  const result = await client.chatCompletion([{ role: 'user', content: 'Synthetic fixture' }], {
    activity: 'ai_interview.scoring',
    context: { organizationId: 'org-1', requestId: 'trace-1' },
    jsonSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    schemaName: 'fixture'
  });
  assert.equal(result.model, 'openai/gpt-oss-120b');
  assert.equal(captured.url, 'https://api.example.test/api/internal/ai/v1/complete');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.activity, 'ai_interview.scoring');
  assert.equal(body.model, undefined);
  assert.equal(JSON.stringify(body).includes('gsk_'), false);
  const expected = buildSignature({
    timestamp: String(now), serviceId: 'ai-interview', path: '/api/internal/ai/v1/complete',
    body: captured.init.body, secret: env.AI_GATEWAY_HMAC_SECRET
  });
  assert.equal(captured.init.headers['x-seemplify-signature'], expected);
  assert.equal(captured.init.headers['x-request-id'], 'trace-1');
  assert.ok(captured.init.signal);
});

test('gateway errors remain retryable service errors without leaking response bodies', async () => {
  const client = createAIPlatformClient({
    env: { SEEMPLIFY_AI_GATEWAY_URL: 'https://api.example.test', AI_GATEWAY_HMAC_SECRET: 'secret' },
    fetchImpl: async () => new Response(JSON.stringify({ code: 'AI_CREDENTIALS_EXHAUSTED', message: 'No healthy credential' }), { status: 503 })
  });
  await assert.rejects(() => client.chatCompletion([{ role: 'user', content: 'Fixture' }]), (error) => (
    error.code === 'AI_CREDENTIALS_EXHAUSTED' && error.statusCode === 503
  ));
});

test('gateway network deadlines become retryable service errors', async () => {
  const client = createAIPlatformClient({
    env: { SEEMPLIFY_AI_GATEWAY_URL: 'https://api.example.test', AI_GATEWAY_HMAC_SECRET: 'secret' },
    fetchImpl: async () => { throw new Error('socket timeout'); }
  });
  await assert.rejects(() => client.chatCompletion([{ role: 'user', content: 'Fixture' }], { timeoutMs: 1000 }), (error) => (
    error.code === 'LLM_REQUEST_FAILED'
      && error.statusCode === 503
      && !error.message.includes('socket timeout')
  ));
});

test('JSON extraction handles strict, fenced, and embedded objects', () => {
  assert.deepEqual(extractJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(extractJsonObject('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(extractJsonObject('Result: {"ok":true} done'), { ok: true });
});
