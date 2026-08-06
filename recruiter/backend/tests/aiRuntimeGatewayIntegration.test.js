const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');

const PATH = '/api/internal/ai/v1/complete';

function sign({ body, secret, service = 'ai-interview', timestamp }) {
  return crypto.createHmac('sha256', secret)
    .update([timestamp, service, 'POST', PATH, body].join('\n'))
    .digest('hex');
}

async function startGateway() {
  const app = express();
  app.use('/api/internal/ai', express.raw({ type: 'application/json', limit: '2mb' }), (req, res, next) => {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body.toString('utf8'));
    next();
  });
  delete require.cache[require.resolve('../routes/internalAI')];
  app.use('/api/internal/ai', require('../routes/internalAI'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}${PATH}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

test('signed gateway routes activity and context but ignores caller provider controls', async () => {
  const originalSecret = process.env.AI_GATEWAY_HMAC_SECRET;
  const originalAllowed = process.env.AI_GATEWAY_ALLOWED_SERVICES;
  const originalComplete = aiRuntimeService.complete;
  const secret = 'integration-hmac-secret';
  process.env.AI_GATEWAY_HMAC_SECRET = secret;
  process.env.AI_GATEWAY_ALLOWED_SERVICES = 'ai-interview';
  let captured;
  aiRuntimeService.complete = async (activity, input, options) => {
    captured = { activity, input, options };
    return {
      requestId: 'runtime-request-1',
      content: 'Hello',
      model: 'openai/gpt-oss-20b',
      usage: { totalTokens: 5 },
      finishReason: 'stop'
    };
  };

  const gateway = await startGateway();
  try {
    const body = JSON.stringify({
      activity: 'ai_interview.chat.clarification',
      promptVersion: 'clarification-v2',
      messages: [{ role: 'user', content: 'Please clarify.' }],
      context: { organizationId: 'org-1', actorId: 'user-1' },
      model: 'caller-controlled-model',
      credentialId: 'caller-controlled-key'
    });
    const timestamp = String(Date.now());
    const response = await fetch(gateway.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-service': 'ai-interview',
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-signature': sign({ body, secret, timestamp })
      },
      body
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.model, 'openai/gpt-oss-20b');
    assert.equal(captured.activity, 'ai_interview.chat.clarification');
    assert.equal(captured.input.promptVersion, 'clarification-v2');
    assert.equal(captured.input.context.sourceApp, 'ai-interview');
    assert.equal(captured.input.context.organizationId, 'org-1');
    assert.equal(captured.input.model, undefined);
    assert.equal(captured.input.credentialId, undefined);
    assert.ok(captured.options.signal);
    assert.equal(captured.options.signal.aborted, false);

    const rejected = await fetch(gateway.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-service': 'ai-interview',
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-signature': 'bad-signature'
      },
      body
    });
    assert.equal(rejected.status, 401);
  } finally {
    await gateway.close();
    aiRuntimeService.complete = originalComplete;
    if (originalSecret === undefined) delete process.env.AI_GATEWAY_HMAC_SECRET;
    else process.env.AI_GATEWAY_HMAC_SECRET = originalSecret;
    if (originalAllowed === undefined) delete process.env.AI_GATEWAY_ALLOWED_SERVICES;
    else process.env.AI_GATEWAY_ALLOWED_SERVICES = originalAllowed;
  }
});

test('signed gateway aborts inference when its client disconnects', async () => {
  const originalSecret = process.env.AI_GATEWAY_HMAC_SECRET;
  const originalAllowed = process.env.AI_GATEWAY_ALLOWED_SERVICES;
  const originalComplete = aiRuntimeService.complete;
  const secret = 'disconnect-hmac-secret';
  process.env.AI_GATEWAY_HMAC_SECRET = secret;
  process.env.AI_GATEWAY_ALLOWED_SERVICES = 'ai-interview';
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let abortedResolve;
  const aborted = new Promise((resolve) => { abortedResolve = resolve; });
  let aborts = 0;
  aiRuntimeService.complete = async (_activity, _input, options) => {
    startedResolve();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborts += 1;
        abortedResolve(options.signal.reason);
        reject(options.signal.reason);
      }, { once: true });
    });
  };

  const gateway = await startGateway();
  try {
    const body = JSON.stringify({
      activity: 'ai_interview.chat.clarification',
      messages: [{ role: 'user', content: 'Disconnect fixture' }]
    });
    const timestamp = String(Date.now());
    const url = new URL(gateway.url);
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-seemplify-service': 'ai-interview',
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-signature': sign({ body, secret, timestamp })
      }
    });
    request.on('error', () => {});
    request.end(body);
    await started;
    request.destroy();
    const reason = await aborted;
    assert.equal(reason.code, 'AI_CLIENT_DISCONNECTED');
    assert.equal(aborts, 1);
  } finally {
    await gateway.close();
    aiRuntimeService.complete = originalComplete;
    if (originalSecret === undefined) delete process.env.AI_GATEWAY_HMAC_SECRET;
    else process.env.AI_GATEWAY_HMAC_SECRET = originalSecret;
    if (originalAllowed === undefined) delete process.env.AI_GATEWAY_ALLOWED_SERVICES;
    else process.env.AI_GATEWAY_ALLOWED_SERVICES = originalAllowed;
  }
});
