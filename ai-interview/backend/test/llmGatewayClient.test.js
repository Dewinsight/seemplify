const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSignature,
  createAIPlatformClient,
  extractJsonObject,
  normalizeGatewayTimeoutMs
} = require('../src/llmClient');

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
      return new Response(JSON.stringify({ content: '{"ok":true}', model: 'chatgpt-connected-account', requestId: 'request-1', usage: { totalTokens: 12 } }), { status: 200 });
    }
  });
  const result = await client.chatCompletion([{ role: 'user', content: 'Synthetic fixture' }], {
    activity: 'ai_interview.scoring',
    context: { organizationId: 'org-1', requestId: 'trace-1' },
    jsonSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    schemaName: 'fixture'
  });
  assert.equal(result.model, 'chatgpt-connected-account');
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

test('shared-dispatch lease abort reaches the gateway request and preserves its safety error', async () => {
  const controller = new AbortController();
  let requestSignal;
  let requestStarted;
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  const client = createAIPlatformClient({
    env: {
      SEEMPLIFY_AI_GATEWAY_URL: 'https://api.example.test',
      AI_GATEWAY_HMAC_SECRET: 'secret'
    },
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      requestStarted();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    }
  });
  const request = client.chatCompletion(
    [{ role: 'user', content: 'Fixture' }],
    { signal: controller.signal }
  );
  await started;
  const leaseError = Object.assign(new Error('shared lease was lost'), {
    code: 'CV_GLOBAL_DISPATCH_LEASE_LOST'
  });
  controller.abort(leaseError);
  await assert.rejects(request, (error) => error === leaseError);
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason, leaseError);
});

test('gateway accepts the four-minute CV deadline and caps unsafe values', () => {
  assert.equal(normalizeGatewayTimeoutMs(240_000), 240_000);
  assert.equal(normalizeGatewayTimeoutMs(600_000), 300_000);
  assert.equal(normalizeGatewayTimeoutMs(100), 1_000);
});

test('JSON extraction handles strict, fenced, and embedded objects', () => {
  assert.deepEqual(extractJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(extractJsonObject('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(extractJsonObject('Result: {"ok":true} done'), { ok: true });
});
