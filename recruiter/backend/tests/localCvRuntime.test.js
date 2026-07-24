const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const {
  ACTIVITY_DEFINITIONS,
  DEFAULT_ROUTES,
  GROQ_PROVIDER,
  LOCAL_CV_MODEL,
  LOCAL_PROVIDER
} = require('../config/aiRuntimeCatalog');
const { signLocalRequest } = require('../services/aiRuntime/aiRuntimeService');
const { createLocalRuntimeHistoryAuth, signLocalHistoryRequest } = require('../middleware/localRuntimeHistoryAuth');

const gatewayScript = path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm', 'gateway.cjs');

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitFor(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test('CV extraction and question generation default to local but remain admin configurable', () => {
  const routes = new Map(DEFAULT_ROUTES.map((route) => [route.activity, route]));
  for (const activity of ['candidate.cv_parse', 'ai_interview.cv_parse']) {
    assert.equal(routes.get(activity).provider, LOCAL_PROVIDER);
    assert.equal(routes.get(activity).model, LOCAL_CV_MODEL);
    assert.equal(ACTIVITY_DEFINITIONS[activity].defaultLocal, true);
    assert.notEqual(ACTIVITY_DEFINITIONS[activity].lockedProvider, true);
  }
  for (const activity of ['interview.questions', 'ai_interview.question_generation']) {
    assert.equal(routes.get(activity).provider, LOCAL_PROVIDER);
    assert.equal(routes.get(activity).model, LOCAL_CV_MODEL);
    assert.equal(ACTIVITY_DEFINITIONS[activity].defaultLocal, true);
    assert.notEqual(ACTIVITY_DEFINITIONS[activity].lockedProvider, true);
  }
  for (const [activity, route] of routes) {
    if (['candidate.cv_parse', 'ai_interview.cv_parse', 'interview.questions', 'ai_interview.question_generation'].includes(activity)) continue;
    assert.equal(route.provider, GROQ_PROVIDER, `${activity} must remain on Groq`);
  }
});

test('every recruiter CV upload entry point uses the durable local CV queue', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const candidateRoutes = fs.readFileSync(path.join(sourceRoot, 'routes', 'candidate.js'), 'utf8');
  const bulkRoutes = fs.readFileSync(path.join(sourceRoot, 'routes', 'bulkUpload.js'), 'utf8');
  const interviewRoutes = fs.readFileSync(path.join(sourceRoot, 'routes', 'cv.js'), 'utf8');
  const queueService = fs.readFileSync(path.join(sourceRoot, 'services', 'cvAnalysisQueueService.js'), 'utf8');
  const standaloneParser = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'ai-interview', 'backend', 'src', 'cvParsingService.js'), 'utf8');

  assert.match(candidateRoutes, /queueUpload\('private'\)/);
  assert.match(candidateRoutes, /queueUpload\('public'\)/);
  assert.match(bulkRoutes, /cvAnalysisQueue\.submitBatch\(req\)/);
  assert.match(interviewRoutes, /cvAnalysisQueue\.submitUpload\(req, 'ai-interview'\)/);
  assert.match(queueService, /processingJob\.source === 'ai-interview' \? 'ai_interview\.cv_parse' : 'candidate\.cv_parse'/);
  assert.match(standaloneParser, /activity: 'ai_interview\.cv_parse'/);
});

test('CV queue keeps a compact non-expiring operational history separate from CV contents', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const historyModel = fs.readFileSync(path.join(sourceRoot, 'models', 'CVProcessingAudit.js'), 'utf8');
  const queueService = fs.readFileSync(path.join(sourceRoot, 'services', 'cvAnalysisQueueService.js'), 'utf8');
  const historyRoute = fs.readFileSync(path.join(sourceRoot, 'routes', 'internalLocalCvQueue.js'), 'utf8');
  assert.doesNotMatch(historyModel, /resumeText|expireAfterSeconds|expiresAt/);
  assert.match(historyModel, /publicId/);
  assert.match(historyModel, /jobCreatedAt/);
  assert.match(queueService, /async function listHistory/);
  assert.match(queueService, /retainedIndefinitely: true/);
  assert.match(historyRoute, /createLocalRuntimeHistoryAuth/);
});

test('Terra adapter records authoritative Codex token usage instead of zeroes', () => {
  const adapter = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm', 'engine-adapters.cjs'),
    'utf8'
  );
  assert.match(adapter, /'--json'/);
  assert.match(adapter, /rawUsage\.input_tokens/);
  assert.match(adapter, /rawUsage\.cached_input_tokens/);
  assert.match(adapter, /rawUsage\.output_tokens/);
  assert.match(adapter, /rawUsage\.reasoning_output_tokens/);
  assert.doesNotMatch(
    adapter,
    /engine:\s*'codex'[\s\S]{0,400}usage:\s*\{\s*prompt_tokens:\s*0,\s*completion_tokens:\s*0/
  );
});

test('local signatures are deterministic for fixed request inputs', () => {
  const signed = signLocalRequest('secret', '{"activity":"candidate.cv_parse"}', 1234, 'abcdefghijklmnop');
  const expected = crypto.createHmac('sha256', 'secret')
    .update('1234\nabcdefghijklmnop\n{"activity":"candidate.cv_parse"}')
    .digest('base64url');
  assert.deepEqual(signed, { timestamp: '1234', nonce: 'abcdefghijklmnop', signature: expected });
});

test('local queue history signatures cover the method, path, query, timestamp and nonce', () => {
  const timestamp = '1234';
  const nonce = 'history_nonce_1234567890';
  const requestPath = '/api/internal/local-cv-queue/history?page=2&limit=50';
  const signature = signLocalHistoryRequest('secret', 'GET', requestPath, timestamp, nonce);
  const expected = crypto.createHmac('sha256', 'secret')
    .update(`${timestamp}\n${nonce}\nGET\n${requestPath}`)
    .digest('base64url');
  assert.equal(signature, expected);
  let accepted = false;
  createLocalRuntimeHistoryAuth({
    env: { LOCAL_LLM_SHARED_SECRET: 'secret' },
    now: () => 1234
  })({
    method: 'GET',
    originalUrl: requestPath,
    get(name) {
      return {
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-nonce': nonce,
        'x-seemplify-signature': signature
      }[name];
    }
  }, {
    status() { return this; },
    json() { throw new Error('valid history signature was rejected'); }
  }, () => { accepted = true; });
  assert.equal(accepted, true);
});

test('gateway rejects unsigned and replayed requests and enforces the CV activity allowlist', async (context) => {
  const ollamaPort = 11544;
  const gatewayPort = 11545;
  const historyBackendPort = 11546;
  const historySecret = 'local-cv-runtime-test-secret';
  let observedHistoryRequest = null;
  const fakeOllama = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'gemma4:26b-a4b-it-qat' }] }));
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    let content = 'Local text completion';
    if (payload.format?.properties?.toolCalls) {
      content = '{"content":"","toolCalls":[{"name":"find_candidates","arguments":{"skills":["Node.js"]}}]}';
    } else if (payload.format?.properties?.answer) {
      content = '{"answer":"Use a bounded worker queue."}';
    } else if (payload.format) {
      content = '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.test","skills":["Node.js"],"summary":"Engineer"}';
    }
    return response.end(JSON.stringify({
      model: 'gemma4:26b-a4b-it-qat',
      message: { content },
      prompt_eval_count: 4,
      eval_count: 3
    }));
  });
  await listen(fakeOllama, ollamaPort);
  context.after(() => new Promise((resolve) => fakeOllama.close(resolve)));
  const fakeHistoryBackend = http.createServer((request, response) => {
    observedHistoryRequest = {
      url: request.url,
      timestamp: String(request.headers['x-seemplify-timestamp'] || ''),
      nonce: String(request.headers['x-seemplify-nonce'] || ''),
      signature: String(request.headers['x-seemplify-signature'] || '')
    };
    const expected = signLocalHistoryRequest(
      historySecret,
      request.method,
      request.url,
      observedHistoryRequest.timestamp,
      observedHistoryRequest.nonce
    );
    response.setHeader('content-type', 'application/json');
    if (expected !== observedHistoryRequest.signature) {
      response.statusCode = 401;
      return response.end(JSON.stringify({ code: 'INVALID_SIGNATURE' }));
    }
    return response.end(JSON.stringify({
      page: 2,
      limit: 50,
      total: 51,
      pages: 2,
      retainedIndefinitely: true,
      jobs: [{ jobId: 'job_demo_123', state: 'completed', source: 'bulk' }]
    }));
  });
  await listen(fakeHistoryBackend, historyBackendPort);
  context.after(() => new Promise((resolve) => fakeHistoryBackend.close(resolve)));

  const isolatedRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-llm-test-'));
  const isolatedSecretFile = path.join(isolatedRuntime, 'service-secret');
  const isolatedStateFile = path.join(isolatedRuntime, 'state.json');
  const isolatedLogFile = path.join(isolatedRuntime, 'gateway.log');
  fs.writeFileSync(isolatedSecretFile, historySecret);
  fs.writeFileSync(isolatedStateFile, JSON.stringify({
    enabled: true,
    ingressEnabled: true,
    paused: false,
    concurrency: 1,
    autoStart: false,
    selectedEngine: 'ollama',
    engines: {
      ollama: { model: 'gemma4:26b-a4b-it-qat', baseUrl: `http://127.0.0.1:${ollamaPort}` }
    }
  }));
  context.after(() => fs.rmSync(isolatedRuntime, { recursive: true, force: true }));

  const gateway = spawn(process.execPath, [gatewayScript], {
    env: {
      ...process.env,
      LOCAL_LLM_MODEL: 'gemma4:26b-a4b-it-qat',
      LOCAL_LLM_GATEWAY_PORT: String(gatewayPort),
      LOCAL_LLM_SECRET_FILE: isolatedSecretFile,
      LOCAL_LLM_STATE_FILE: isolatedStateFile,
      LOCAL_LLM_LOG_FILE: isolatedLogFile,
      RECRUITER_BACKEND_URL: `http://127.0.0.1:${historyBackendPort}`
    },
    stdio: 'ignore',
    windowsHide: true
  });
  context.after(() => gateway.kill());
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);

  const unsigned = await fetch(`http://127.0.0.1:${gatewayPort}/v1/cv/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(unsigned.status, 401);

  const secret = fs.readFileSync(isolatedSecretFile, 'utf8').trim();
  const historyResponse = await fetch(`http://127.0.0.1:${gatewayPort}/control/queue-history?state=completed&page=2&limit=50&search=job_demo`);
  assert.equal(historyResponse.status, 200);
  const historyPayload = await historyResponse.json();
  assert.equal(historyPayload.total, 51);
  assert.equal(historyPayload.jobs[0].jobId, 'job_demo_123');
  assert.match(observedHistoryRequest.url, /state=completed/);
  assert.match(observedHistoryRequest.url, /search=job_demo/);
  const forbiddenBody = JSON.stringify({
    activity: 'unknown.activity',
    messages: [{ role: 'user', content: 'hello' }],
    jsonSchema: { type: 'object' }
  });
  const signed = signLocalRequest(secret, forbiddenBody, Date.now(), 'replay_nonce_1234567890');
  const headers = {
    'content-type': 'application/json',
    'x-seemplify-timestamp': signed.timestamp,
    'x-seemplify-nonce': signed.nonce,
    'x-seemplify-signature': signed.signature
  };
  const forbidden = await fetch(`http://127.0.0.1:${gatewayPort}/v1/cv/analyze`, { method: 'POST', headers, body: forbiddenBody });
  assert.equal(forbidden.status, 403);
  const replay = await fetch(`http://127.0.0.1:${gatewayPort}/v1/cv/analyze`, { method: 'POST', headers, body: forbiddenBody });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, 'NONCE_REJECTED');

  const initialState = (await (await fetch(`http://127.0.0.1:${gatewayPort}/control/status`)).json()).state;
  try {
    await fetch(`http://127.0.0.1:${gatewayPort}/control/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concurrency: 3, paused: true })
    });
    const telemetryBody = JSON.stringify({
      schemaVersion: 2,
      waiting: 7,
      active: 1,
      delayed: 2,
      completed: 4,
      failed: 0,
      oldestWaitMs: 1_500,
      paused: false,
      workerConcurrency: 1,
      available: true,
      queue: 'cv-analysis-local',
      sampledAt: '2026-07-24T10:00:00.000Z',
      counts: { waiting: 7, waitingTotal: 7, active: 1, delayed: 2, completed: 4, failed: 0 },
      durable: { queued: 5, waitingForRuntime: 2, processing: 1, completed: 4, failed: 0, retrying: 1 },
      rates: { completedLast5Minutes: 2, completedLastHour: 4, failedLastHour: 0, averageProcessingMs: 8_000, p95ProcessingMs: 12_000 },
      worker: { running: true, concurrency: 1, active: 1, availableSlots: 0, utilizationPercent: 100 },
      oldestQueuedAt: '2026-07-24T09:59:58.500Z',
      recentJobs: [{
        jobId: 'job_demo_123',
        source: 'ai-interview',
        state: 'waiting_for_local_runtime',
        progress: 20,
        attempts: 2,
        createdAt: '2026-07-24T09:59:58.500Z',
        updatedAt: '2026-07-24T10:00:00.000Z',
        waitMs: 1_500,
        processingMs: null,
        errorCode: 'LOCAL_LLM_PAUSED',
        originalName: 'must-not-cross-the-gateway.pdf'
      }]
    });
    const telemetrySignature = signLocalRequest(secret, telemetryBody);
    const telemetry = await fetch(`http://127.0.0.1:${gatewayPort}/v1/queue-telemetry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-timestamp': telemetrySignature.timestamp,
        'x-seemplify-nonce': telemetrySignature.nonce,
        'x-seemplify-signature': telemetrySignature.signature
      },
      body: telemetryBody
    });
    assert.equal(telemetry.status, 200);
    assert.deepEqual(await telemetry.json(), {
      ok: true,
      desiredConcurrency: 3,
      desiredPaused: true
    });
    const queueStatus = await (await fetch(`http://127.0.0.1:${gatewayPort}/control/status`)).json();
    assert.equal(queueStatus.queue.schemaVersion, 2);
    assert.equal(queueStatus.queue.durable.waitingForRuntime, 2);
    assert.equal(queueStatus.queue.rates.p95ProcessingMs, 12_000);
    assert.equal(queueStatus.queue.worker.utilizationPercent, 100);
    assert.equal(queueStatus.queue.recentJobs[0].jobId, 'job_demo_123');
    assert.equal(Object.hasOwn(queueStatus.queue.recentJobs[0], 'originalName'), false);
    await fetch(`http://127.0.0.1:${gatewayPort}/control/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: false })
    });

    const signedRequest = async (requestBody) => {
      const signature = signLocalRequest(secret, requestBody);
      return fetch(`http://127.0.0.1:${gatewayPort}/v1/complete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signature.timestamp,
          'x-seemplify-nonce': signature.nonce,
          'x-seemplify-signature': signature.signature
        },
        body: requestBody
      });
    };
    const structuredBody = JSON.stringify({
      activity: 'interview.questions',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'Create a systems question.' }],
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { type: 'string' } }
      }
    });
    const structured = await signedRequest(structuredBody);
    assert.equal(structured.status, 200);
    assert.deepEqual((await structured.json()).data, { answer: 'Use a bounded worker queue.' });

    const textBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'Say hello.' }]
    });
    const textCompletion = await signedRequest(textBody);
    assert.equal(textCompletion.status, 200);
    assert.equal((await textCompletion.json()).content, 'Local text completion');

    for (const activity of Object.keys(ACTIVITY_DEFINITIONS).filter((item) => !['candidate.cv_parse', 'ai_interview.cv_parse'].includes(item))) {
      const activityBody = JSON.stringify({
        activity,
        executionMode: 'local-only',
        messages: [{ role: 'user', content: `Synthetic contract check for ${activity}.` }]
      });
      const activityResponse = await signedRequest(activityBody);
      assert.equal(activityResponse.status, 200, `${activity} must be accepted by the local gateway`);
      assert.equal((await activityResponse.json()).content, 'Local text completion', activity);
    }

    const toolBody = JSON.stringify({
      activity: 'assistant.tool_selection',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'Find Node.js candidates.' }],
      tools: [{
        type: 'function',
        function: {
          name: 'find_candidates',
          parameters: {
            type: 'object',
            properties: { skills: { type: 'array', items: { type: 'string' } } }
          }
        }
      }]
    });
    const toolCompletion = await signedRequest(toolBody);
    assert.equal(toolCompletion.status, 200);
    const toolData = await toolCompletion.json();
    assert.equal(toolData.finishReason, 'tool_calls');
    assert.equal(toolData.toolCalls[0].function.name, 'find_candidates');

    const missingModeBody = JSON.stringify({
      activity: 'recruiter.general',
      messages: [{ role: 'user', content: 'This must not run.' }]
    });
    assert.equal((await signedRequest(missingModeBody)).status, 400);

    await fetch(`http://127.0.0.1:${gatewayPort}/control/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedEngine: 'codex', paused: false })
    });
    const localCloudStatus = await (await fetch(`http://127.0.0.1:${gatewayPort}/control/status`)).json();
    assert.equal(localCloudStatus.executionMode, 'local-cloud');
    assert.equal(localCloudStatus.cvLocalEligible, true);
  } finally {
    await fetch(`http://127.0.0.1:${gatewayPort}/control/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initialState)
    });
  }
});
