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
  LOCAL_PROVIDER,
  TERRA_MODEL,
  TERRA_PROVIDER
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

async function waitForCondition(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('CV extraction is locked local while local question generation has audited Groq failover', () => {
  const routes = new Map(DEFAULT_ROUTES.map((route) => [route.activity, route]));
  for (const activity of ['candidate.cv_parse', 'ai_interview.cv_parse']) {
    assert.equal(routes.get(activity).provider, LOCAL_PROVIDER);
    assert.equal(routes.get(activity).model, LOCAL_CV_MODEL);
    assert.equal(routes.get(activity).failoverPolicy, 'wait_local');
    assert.equal(ACTIVITY_DEFINITIONS[activity].defaultLocal, true);
    assert.equal(ACTIVITY_DEFINITIONS[activity].lockedProvider, true);
  }
  for (const activity of ['interview.questions', 'ai_interview.question_generation']) {
    assert.equal(routes.get(activity).provider, LOCAL_PROVIDER);
    assert.equal(routes.get(activity).model, LOCAL_CV_MODEL);
    assert.equal(routes.get(activity).failoverPolicy, 'groq_immediate');
    assert.equal(ACTIVITY_DEFINITIONS[activity].defaultLocal, true);
    assert.notEqual(ACTIVITY_DEFINITIONS[activity].lockedProvider, true);
  }
  const experienceActivities = Object.keys(ACTIVITY_DEFINITIONS).filter((activity) => activity.startsWith('experience.'));
  for (const activity of experienceActivities) {
    assert.equal(routes.get(activity).provider, TERRA_PROVIDER);
    assert.equal(routes.get(activity).model, TERRA_MODEL);
    assert.equal(routes.get(activity).failoverPolicy, 'wait_local');
    assert.equal(ACTIVITY_DEFINITIONS[activity].lockedProvider, true);
  }
  for (const [activity, route] of routes) {
    if (['candidate.cv_parse', 'ai_interview.cv_parse', 'interview.questions', 'ai_interview.question_generation'].includes(activity) || experienceActivities.includes(activity)) continue;
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

test('the standalone AI Interview queue publishes signed events into the shared permanent history', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const internalRoute = fs.readFileSync(path.join(sourceRoot, 'routes', 'internalAI.js'), 'utf8');
  const standaloneQueue = fs.readFileSync(
    path.resolve(sourceRoot, '..', '..', 'ai-interview', 'backend', 'src', 'cvProcessingQueueService.js'),
    'utf8'
  );
  assert.match(internalRoute, /\/v1\/cv-queue\/events/);
  assert.match(internalRoute, /ingestExternalQueueEvent\(req\.internalService/);
  assert.match(standaloneQueue, /QUEUE_EVENT_PATH = '\/api\/internal\/ai\/v1\/cv-queue\/events'/);
  assert.match(standaloneQueue, /buildSignature/);
  assert.match(standaloneQueue, /flushQueueEvents/);
  assert.match(standaloneQueue, /Math\.min\(requestedConcurrency, approvedConcurrency\)/);
  assert.doesNotMatch(standaloneQueue.match(/function operationalQueueEvent[\s\S]*?\n\}/)?.[0] || '', /resumeText|originalName/);
});

test('CV queue keeps a compact non-expiring operational history separate from CV contents', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const historyModel = fs.readFileSync(path.join(sourceRoot, 'models', 'CVProcessingAudit.js'), 'utf8');
  const queueService = fs.readFileSync(path.join(sourceRoot, 'services', 'cvAnalysisQueueService.js'), 'utf8');
  const historyRoute = fs.readFileSync(path.join(sourceRoot, 'routes', 'internalLocalCvQueue.js'), 'utf8');
  assert.doesNotMatch(historyModel, /resumeText|expireAfterSeconds|expiresAt/);
  assert.match(historyModel, /publicId/);
  assert.match(historyModel, /jobCreatedAt/);
  assert.match(historyModel, /transitions/);
  assert.match(historyModel, /'retrying'/);
  assert.match(queueService, /async function listHistory/);
  assert.match(queueService, /retainedIndefinitely: true/);
  assert.match(queueService, /coverageStartedAt/);
  assert.match(queueService, /HISTORY_REPAIR_INTERVAL_MS/);
  assert.match(queueService, /\.limit\(HISTORY_REPAIR_BATCH_SIZE\)/);
  assert.match(queueService, /lastUpdatedAt: \{ \$lt: document\.lastUpdatedAt \}/);
  assert.match(queueService, /async function adminJobsFromAudits/);
  assert.match(queueService, /producer === 'ai-interview'/);
  assert.match(historyRoute, /createLocalRuntimeHistoryAuth/);
});

test('CV queue publishes debounced telemetry on lifecycle changes as well as heartbeat recovery', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const queueService = fs.readFileSync(path.join(sourceRoot, 'services', 'cvAnalysisQueueService.js'), 'utf8');
  assert.match(queueService, /function publishTelemetrySoon\(delayMs = 150\)/);
  assert.match(queueService, /\['active', 'progress', 'completed', 'stalled'\]/);
  assert.match(queueService, /worker\.on\('failed'/);
  assert.match(queueService, /setInterval\(\(\) => \{\s*void publishTelemetry\(\)/);
  assert.match(queueService, /CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY \|\| 1/);
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

test('gateway completion logs include workload provenance and token composition', () => {
  const gateway = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm', 'gateway.cjs'),
    'utf8'
  );
  assert.match(gateway, /requestSource/);
  assert.match(gateway, /endpoint:\s*cvOnly \? 'cv' : 'general'/);
  assert.match(gateway, /inputTokens/);
  assert.match(gateway, /cachedInputTokens/);
  assert.match(gateway, /outputTokens/);
  assert.match(gateway, /reasoningTokens/);
  assert.match(gateway, /totalTokens/);
  assert.match(gateway, /Number\.isFinite\(schema\.maximum\)/);
  assert.match(gateway, /if \(schemaErrors\.length\)/);
  assert.doesNotMatch(gateway, /schemaErrors\.length && !data\.toolCalls/);
  assert.match(gateway, /fs\.promises\.appendFile/);
  assert.doesNotMatch(gateway, /fs\.appendFileSync\(logFile/);
});

test('CV quality harness reads engine metadata through the signed status endpoint', () => {
  const harness = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'evaluateLocalCvRuntime.js'),
    'utf8'
  );
  assert.match(harness, /async function getRuntimeStatus/);
  assert.match(harness, /`\$\{gatewayUrl\}\/v1\/status`/);
  assert.match(harness, /x-seemplify-signature/);
  assert.doesNotMatch(harness, /fetch\(`\$\{gatewayUrl\}\/control\/status`/);
  assert.match(harness, /Local runtime status omitted the selected engine or model/);
});

test('local signatures are deterministic for fixed request inputs', () => {
  const signed = signLocalRequest('secret', '{"activity":"candidate.cv_parse"}', {
    now: 1234,
    nonce: 'abcdefghijklmnop',
    method: 'POST',
    path: '/v1/cv/analyze'
  });
  const expected = crypto.createHmac('sha256', 'secret')
    .update('1234\nabcdefghijklmnop\nPOST\n/v1/cv/analyze\n{"activity":"candidate.cv_parse"}')
    .digest('base64url');
  assert.deepEqual(signed, { timestamp: '1234', nonce: 'abcdefghijklmnop', signature: expected });
});

test('gateway replay protection keeps durable nonce I/O off the event loop', () => {
  const gateway = fs.readFileSync(gatewayScript, 'utf8');
  const nonceIo = gateway.slice(
    gateway.indexOf('async function pruneNonces'),
    gateway.indexOf('function safeEqual')
  );
  assert.match(nonceIo, /fs\.promises\.readdir/);
  assert.match(nonceIo, /fs\.promises\.open\(file, 'wx'/);
  assert.match(nonceIo, /fs\.promises\.readFile/);
  assert.doesNotMatch(nonceIo, /(?:readdirSync|openSync|readFileSync|writeFileSync|unlinkSync)/);
});

test('local verification, benchmark, soak, and public smoke tools bind signatures to the CV endpoint', () => {
  const toolsRoot = path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm');
  const signingTools = [
    'verify-engine.cjs',
    'soak.cjs',
    'external-smoke.cjs',
    'evaluate-runtime-models.cjs',
    'benchmark.cjs',
    'benchmark-engine.cjs',
    'benchmark-codex.cjs'
  ];
  for (const filename of signingTools) {
    const source = fs.readFileSync(path.join(toolsRoot, filename), 'utf8');
    assert.doesNotMatch(
      source,
      /\.update\(`\$\{timestamp\}\\n\$\{nonce\}\\n\$\{body\}`\)/,
      `${filename} must not use the legacy body-only signature`
    );
    assert.match(source, /POST\\n(?:\/v1\/cv\/analyze|\$\{requestPath\})\\n/);
  }
  const modelMatrix = fs.readFileSync(path.join(toolsRoot, 'evaluate-runtime-models.cjs'), 'utf8');
  assert.match(modelMatrix, /sign\(secret, body, endpoint\)/);
});

test('sustained soak dispatches only within the approved gateway capacity', () => {
  const soak = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'tools', 'local-llm', 'soak.cjs'),
    'utf8'
  );
  assert.match(soak, /dispatchWithinApprovedCapacity\(requestCount, configuredConcurrency\)/);
  assert.match(soak, /const workerCount = Math\.min\(count, concurrency\)/);
  assert.doesNotMatch(
    soak,
    /Promise\.all\(Array\.from\(\{ length: requestCount \}, \(_, index\) => analyze/
  );
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
  let observedProviderTelemetryRequest = null;
  let ollamaCompletionCalls = 0;
  const fakeOllama = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'gemma4:26b-a4b-it-qat' }] }));
    ollamaCompletionCalls += 1;
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (payload.messages?.some((message) => String(message.content || '').includes('hold the slot'))) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    let content = 'Local text completion';
    if (payload.messages?.some((message) => String(message.content || '').includes('return an invalid structured result'))) {
      content = '{"unexpected":true}';
    } else if (payload.format?.properties?.toolCalls) {
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
    const observedRequest = {
      url: request.url,
      timestamp: String(request.headers['x-seemplify-timestamp'] || ''),
      nonce: String(request.headers['x-seemplify-nonce'] || ''),
      signature: String(request.headers['x-seemplify-signature'] || '')
    };
    if (request.url === '/api/internal/local-cv-queue/provider-telemetry') {
      observedProviderTelemetryRequest = observedRequest;
    } else {
      observedHistoryRequest = observedRequest;
    }
    const expected = signLocalHistoryRequest(
      historySecret,
      request.method,
      request.url,
      observedRequest.timestamp,
      observedRequest.nonce
    );
    response.setHeader('content-type', 'application/json');
    if (expected !== observedRequest.signature) {
      response.statusCode = 401;
      return response.end(JSON.stringify({ code: 'INVALID_SIGNATURE' }));
    }
    if (request.url === '/api/internal/local-cv-queue/provider-telemetry') {
      return response.end(JSON.stringify({
        sampledAt: '2026-07-25T12:00:00.000Z',
        window: { minutes: 60 },
        totals: {
          fiveMinutes: { calls: 2, failures: 0, averageLatencyMs: 500, totalTokens: 900, estimatedCostUsd: 0.001 },
          hour: { calls: 8, failures: 1, averageLatencyMs: 700, totalTokens: 4_000, estimatedCostUsd: 0.02 }
        },
        providers: [{ id: 'local-codex', calls: 5, failures: 0, averageLatencyMs: 1_200, totalTokens: 3_100, estimatedCostUsd: 0, lastRequestAt: '2026-07-25T11:59:00.000Z', actorEmail: 'private@example.test' }],
        recent: [{ organizationName: 'Private Ltd' }]
      }));
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
  const isolatedControlSecretFile = path.join(isolatedRuntime, 'control-secret');
  const isolatedStateFile = path.join(isolatedRuntime, 'state.json');
  const isolatedApprovalFile = path.join(isolatedRuntime, 'approved-concurrency.json');
  const isolatedLogFile = path.join(isolatedRuntime, 'gateway.log');
  const isolatedUsageOutboxDir = path.join(isolatedRuntime, 'usage-outbox');
  const isolatedExecutionReceiptDir = path.join(isolatedRuntime, 'execution-receipts');
  fs.writeFileSync(isolatedSecretFile, historySecret);
  fs.writeFileSync(isolatedControlSecretFile, 'local-control-test-secret');
  fs.writeFileSync(isolatedApprovalFile, JSON.stringify({ byEngineModel: {} }));
  fs.writeFileSync(isolatedLogFile, 'x'.repeat(70 * 1024));
  fs.writeFileSync(isolatedStateFile, JSON.stringify({
    enabled: true,
    ingressEnabled: true,
    paused: false,
    concurrency: 128,
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
      LOCAL_LLM_CONTROL_SECRET_FILE: isolatedControlSecretFile,
      LOCAL_LLM_STATE_FILE: isolatedStateFile,
      LOCAL_LLM_APPROVAL_FILE: isolatedApprovalFile,
      LOCAL_LLM_LOG_FILE: isolatedLogFile,
      LOCAL_LLM_LOG_MAX_BYTES: String(64 * 1024),
      LOCAL_LLM_USAGE_OUTBOX_DIR: isolatedUsageOutboxDir,
      LOCAL_LLM_EXECUTION_RECEIPT_DIR: isolatedExecutionReceiptDir,
      LOCAL_LLM_USAGE_INITIAL_DELAY_MS: '600000',
      LOCAL_LLM_HEALTH_RATE_LIMIT_REQUESTS: '2',
      RECRUITER_BACKEND_URL: `http://127.0.0.1:${historyBackendPort}`
    },
    stdio: 'ignore',
    windowsHide: true
  });
  context.after(() => gateway.kill());
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
  assert.equal(await waitForCondition(() => fs.existsSync(`${isolatedLogFile}.1`)), true);

  const unsigned = await fetch(`http://127.0.0.1:${gatewayPort}/v1/cv/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(unsigned.status, 401);

  const secret = fs.readFileSync(isolatedSecretFile, 'utf8').trim();
  const controlSecret = fs.readFileSync(isolatedControlSecretFile, 'utf8').trim();
  const controlRequest = (requestPath, options = {}) => fetch(`http://127.0.0.1:${gatewayPort}${requestPath}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'x-seemplify-control-secret': controlSecret
    }
  });
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/control/status`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/control/queue-history`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/control/provider-telemetry`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/control/status`, {
    headers: {
      'x-seemplify-control-secret': controlSecret,
      'cf-connecting-ip': '203.0.113.10'
    }
  })).status, 403);
  for (let index = 0; index < 2; index += 1) {
    const publicHealth = await fetch(`http://127.0.0.1:${gatewayPort}/health`, {
      headers: { 'cf-connecting-ip': '203.0.113.20' }
    });
    assert.equal(publicHealth.status, 200);
    const payload = await publicHealth.json();
    assert.deepEqual(Object.keys(payload).sort(), ['ok', 'service']);
  }
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/health`, {
    headers: { 'cf-connecting-ip': '203.0.113.20' }
  })).status, 429);

  const historyResponse = await controlRequest('/control/queue-history?state=completed&page=2&limit=50&search=job_demo');
  assert.equal(historyResponse.status, 200);
  const historyPayload = await historyResponse.json();
  assert.equal(historyPayload.total, 51);
  assert.equal(historyPayload.jobs[0].jobId, 'job_demo_123');
  assert.match(observedHistoryRequest.url, /state=completed/);
  assert.match(observedHistoryRequest.url, /search=job_demo/);
  await controlRequest('/control/queue-history?state=retrying&page=1&limit=25');
  assert.match(observedHistoryRequest.url, /state=retrying/);
  const providerTelemetryResponse = await controlRequest('/control/provider-telemetry');
  assert.equal(providerTelemetryResponse.status, 200);
  const providerTelemetry = await providerTelemetryResponse.json();
  assert.equal(providerTelemetry.providers[0].id, 'local-codex');
  assert.equal(providerTelemetry.totals.fiveMinutes.calls, 2);
  assert.equal(JSON.stringify(providerTelemetry).includes('private@example.test'), false);
  assert.equal(JSON.stringify(providerTelemetry).includes('Private Ltd'), false);
  assert.equal(observedProviderTelemetryRequest.url, '/api/internal/local-cv-queue/provider-telemetry');
  assert.equal(observedProviderTelemetryRequest.signature.includes(historySecret), false);
  const forbiddenBody = JSON.stringify({
    activity: 'unknown.activity',
    messages: [{ role: 'user', content: 'hello' }],
    jsonSchema: { type: 'object' }
  });
  const signed = signLocalRequest(secret, forbiddenBody, {
    now: Date.now(),
    nonce: 'replay_nonce_1234567890',
    method: 'POST',
    path: '/v1/cv/analyze'
  });
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

  const pathBound = signLocalRequest(secret, forbiddenBody, {
    nonce: 'path_bound_nonce_1234567890',
    method: 'POST',
    path: '/v1/cv/analyze'
  });
  const pathHeaders = {
    'content-type': 'application/json',
    'x-seemplify-timestamp': pathBound.timestamp,
    'x-seemplify-nonce': pathBound.nonce,
    'x-seemplify-signature': pathBound.signature
  };
  const tamperedPath = await fetch(`http://127.0.0.1:${gatewayPort}/v1/complete`, {
    method: 'POST',
    headers: pathHeaders,
    body: forbiddenBody
  });
  assert.equal(tamperedPath.status, 401);
  assert.equal((await tamperedPath.json()).code, 'SIGNATURE_INVALID');
  const untamperedPath = await fetch(`http://127.0.0.1:${gatewayPort}/v1/cv/analyze`, {
    method: 'POST',
    headers: pathHeaders,
    body: forbiddenBody
  });
  assert.equal(untamperedPath.status, 403);

  const secondGatewayPort = 11547;
  const secondGateway = spawn(process.execPath, [gatewayScript], {
    env: {
      ...process.env,
      LOCAL_LLM_GATEWAY_PORT: String(secondGatewayPort),
      LOCAL_LLM_SECRET_FILE: isolatedSecretFile,
      LOCAL_LLM_CONTROL_SECRET_FILE: isolatedControlSecretFile,
      LOCAL_LLM_STATE_FILE: isolatedStateFile,
      LOCAL_LLM_APPROVAL_FILE: isolatedApprovalFile,
      LOCAL_LLM_LOG_FILE: isolatedLogFile,
      LOCAL_LLM_USAGE_OUTBOX_DIR: isolatedUsageOutboxDir,
      LOCAL_LLM_EXECUTION_RECEIPT_DIR: isolatedExecutionReceiptDir,
      LOCAL_LLM_USAGE_INITIAL_DELAY_MS: '600000',
      RECRUITER_BACKEND_URL: `http://127.0.0.1:${historyBackendPort}`
    },
    stdio: 'ignore',
    windowsHide: true
  });
  context.after(() => secondGateway.kill());
  await waitFor(`http://127.0.0.1:${secondGatewayPort}/health`);
  const crossProcessReplay = await fetch(`http://127.0.0.1:${secondGatewayPort}/v1/cv/analyze`, {
    method: 'POST',
    headers,
    body: forbiddenBody
  });
  assert.equal(crossProcessReplay.status, 401);
  assert.equal((await crossProcessReplay.json()).code, 'NONCE_REJECTED');

  const initialState = (await (await controlRequest('/control/status')).json()).state;
  assert.equal(initialState.requestedConcurrency, 128);
  assert.equal(initialState.approvedConcurrency, 1);
  assert.equal(initialState.concurrency, 1);
  try {
    for (const concurrency of [64, 128]) {
      const unapproved = await controlRequest('/control/state', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ concurrency })
      });
      assert.equal(unapproved.status, 409);
      assert.equal((await unapproved.json()).code, 'CONCURRENCY_NOT_APPROVED');
    }
    await controlRequest('/control/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(await waitForCondition(() => {
      const auditLog = fs.readFileSync(isolatedLogFile, 'utf8');
      return auditLog.includes('"message":"Local AI control state changed"')
        && auditLog.includes('"action":"control_state_updated"')
        && auditLog.includes('"paused":{"from":false,"to":true}')
        && auditLog.includes('"message":"Local AI control state change rejected"')
        && auditLog.includes('"errorCode":"CONCURRENCY_NOT_APPROVED"');
    }), true);
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
      queues: [
        { name: 'cv-analysis-local', producer: 'recruiter', durable: { queued: 5, processing: 1, completed: 4 } },
        { name: 'ai-interview-cv-analysis-local', producer: 'ai-interview', durable: { waitingForRuntime: 2 } }
      ],
      oldestQueuedAt: '2026-07-24T09:59:58.500Z',
      recentJobs: [{
        jobId: 'job_demo_123',
        source: 'ai-interview',
        producer: 'ai-interview',
        queue: 'ai-interview-cv-analysis-local',
        state: 'waiting_for_local_runtime',
        phase: 'retrying',
        progress: 20,
        attempts: 2,
        createdAt: '2026-07-24T09:59:58.500Z',
        updatedAt: '2026-07-24T10:00:00.000Z',
        waitMs: 1_500,
        processingMs: null,
        errorCode: 'LOCAL_LLM_PAUSED',
        transitions: [
          { state: 'processing', phase: 'processing', progress: 30, attempts: 1, at: '2026-07-24T09:59:59.000Z' },
          { state: 'waiting_for_local_runtime', phase: 'retrying', progress: 20, attempts: 2, at: '2026-07-24T10:00:00.000Z' }
        ],
        originalName: 'must-not-cross-the-gateway.pdf'
      }]
    });
    const telemetrySignature = signLocalRequest(secret, telemetryBody, {
      method: 'POST',
      path: '/v1/queue-telemetry'
    });
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
      desiredConcurrency: 1,
      desiredConcurrencyByActivity: {
        'ai_interview.cv_parse': 1,
        'candidate.cv_parse': 1
      },
      desiredPaused: true
    });
    const queueStatus = await (await controlRequest('/control/status')).json();
    assert.equal(queueStatus.queue.schemaVersion, 2);
    assert.equal(queueStatus.queue.durable.waitingForRuntime, 2);
    assert.equal(queueStatus.queue.rates.p95ProcessingMs, 12_000);
    assert.equal(queueStatus.queue.worker.utilizationPercent, 100);
    assert.equal(queueStatus.queue.queues.length, 2);
    assert.equal(queueStatus.queue.recentJobs[0].jobId, 'job_demo_123');
    assert.equal(queueStatus.queue.recentJobs[0].phase, 'retrying');
    assert.equal(queueStatus.queue.recentJobs[0].transitions.length, 2);
    assert.equal(Object.hasOwn(queueStatus.queue.recentJobs[0], 'originalName'), false);
    await controlRequest('/control/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: false })
    });
    const experienceDefaultResponse = await controlRequest('/control/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        applicationDefaults: {
          experienceManagement: { engine: 'ollama', model: 'gemma4:26b-a4b-it-qat' }
        }
      })
    });
    assert.equal(experienceDefaultResponse.status, 200);
    const experienceDefaultState = (await experienceDefaultResponse.json()).state.applicationDefaults.experienceManagement;
    assert.deepEqual(experienceDefaultState, { engine: 'ollama', model: 'gemma4:26b-a4b-it-qat' });

    const signedRequest = async (requestBody, { harness = true, targetPort = gatewayPort } = {}) => {
      const parsedBody = JSON.parse(requestBody);
      const signedBody = harness && !parsedBody.metering
        ? JSON.stringify({
            ...parsedBody,
            requestSource: 'gateway-integration-test',
            metering: { record: false, exclusion: 'harness' }
          })
        : requestBody;
      const signature = signLocalRequest(secret, signedBody, {
        method: 'POST',
        path: '/v1/complete'
      });
      return fetch(`http://127.0.0.1:${targetPort}/v1/complete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signature.timestamp,
          'x-seemplify-nonce': signature.nonce,
          'x-seemplify-signature': signature.signature
        },
        body: signedBody
      });
    };
    const missingMeteringBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'This must not run without metering.' }]
    });
    const missingMetering = await signedRequest(missingMeteringBody, { harness: false });
    assert.equal(missingMetering.status, 400);
    assert.equal((await missingMetering.json()).code, 'METERING_CONTEXT_REQUIRED');

    const invalidExclusionBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      requestSource: 'unrecognized-test-client',
      metering: { record: false, exclusion: 'harness' },
      messages: [{ role: 'user', content: 'This exclusion must be rejected.' }]
    });
    const invalidExclusion = await signedRequest(invalidExclusionBody, { harness: false });
    assert.equal(invalidExclusion.status, 400);
    assert.equal((await invalidExclusion.json()).code, 'INVALID_METERING_EXCLUSION');

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

    const experienceBody = JSON.stringify({
      activity: 'experience.analyst_chat',
      executionMode: 'local-only',
      runtimeProfile: 'experience-management',
      messages: [{ role: 'user', content: 'Use the Experience default.' }]
    });
    const experienceCompletion = await signedRequest(experienceBody);
    assert.equal(experienceCompletion.status, 200);
    const experiencePayload = await experienceCompletion.json();
    assert.equal(experiencePayload.runtimeProfile, 'experience-management');
    assert.equal(experiencePayload.engine, 'ollama');
    assert.equal(experiencePayload.model, 'gemma4:26b-a4b-it-qat');

    const terraRequiredBody = JSON.stringify({
      activity: 'experience.analyst_chat',
      executionMode: 'local-only',
      requiredEngine: 'codex',
      requiredModel: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'Use Terra only.' }]
    });
    const terraRequired = await signedRequest(terraRequiredBody);
    assert.equal(terraRequired.status, 503);
    const terraRequiredPayload = await terraRequired.json();
    assert.equal(terraRequiredPayload.code, 'REQUIRED_RUNTIME_UNAVAILABLE');
    assert.equal(terraRequiredPayload.retryable, true);
    assert.deepEqual(terraRequiredPayload.required, { engine: 'codex', model: 'gpt-5.6-terra' });
    assert.equal(terraRequiredPayload.active.engine, 'ollama');

    const meteredEventId = `usage_${crypto.createHash('sha256').update('gateway-success-transport').digest('hex').slice(0, 48)}`;
    const meteredExecutionId = `localexec_${crypto.createHash('sha256').update(meteredEventId).digest('hex').slice(0, 48)}`;
    const textBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'Say hello.' }],
      metering: {
        record: true,
        eventId: meteredEventId,
        requestId: 'gateway-success-request',
        gatewayExecutionId: meteredExecutionId,
        sourceApp: 'recruiter'
      }
    });
    const textCompletion = await signedRequest(textBody);
    assert.equal(textCompletion.status, 200);
    const textCompletionPayload = await textCompletion.json();
    assert.equal(textCompletionPayload.content, 'Local text completion');
    assert.equal(textCompletionPayload.gatewayExecutionId, meteredExecutionId);
    assert.equal(textCompletionPayload.provider, 'local-ollama');
    assert.equal(
      textCompletionPayload.providerLabel,
      'Ollama local GPU: gemma4:26b-a4b-it-qat'
    );
    const meteringStatus = await (await controlRequest('/control/status')).json();
    assert.equal(meteringStatus.usageMetering.pending, 1);
    assert.equal(meteringStatus.usageMetering.dead, 0);
    assert.equal(meteringStatus.usageMetering.health, 'healthy');
    const providerCallsAfterFirstMeteredCompletion = ollamaCompletionCalls;
    const sameProcessReplay = await signedRequest(textBody);
    assert.equal(sameProcessReplay.status, 200);
    assert.deepEqual(await sameProcessReplay.json(), textCompletionPayload);
    assert.equal(ollamaCompletionCalls, providerCallsAfterFirstMeteredCompletion);
    const [deliveredSimulation] = fs.readdirSync(isolatedUsageOutboxDir)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    assert.ok(deliveredSimulation);
    fs.unlinkSync(path.join(isolatedUsageOutboxDir, deliveredSimulation));
    const crossProcessReceiptReplay = await signedRequest(textBody, { targetPort: secondGatewayPort });
    assert.equal(crossProcessReceiptReplay.status, 200);
    assert.deepEqual(await crossProcessReceiptReplay.json(), textCompletionPayload);
    assert.equal(ollamaCompletionCalls, providerCallsAfterFirstMeteredCompletion);
    const replayMeteringStatus = await (await controlRequest('/control/status')).json();
    assert.equal(replayMeteringStatus.usageMetering.pending, 1);

    const conflictingExecutionBody = JSON.stringify({
      ...JSON.parse(textBody),
      messages: [{ role: 'user', content: 'A changed request must never reuse the prior execution identity.' }]
    });
    const conflictingExecution = await signedRequest(conflictingExecutionBody, { targetPort: secondGatewayPort });
    assert.equal(conflictingExecution.status, 409);
    const conflictingExecutionPayload = await conflictingExecution.json();
    assert.equal(conflictingExecutionPayload.code, 'LOCAL_EXECUTION_IDENTITY_CONFLICT');
    assert.equal(conflictingExecutionPayload.retryable, false);
    assert.equal(ollamaCompletionCalls, providerCallsAfterFirstMeteredCompletion);

    const concurrentEventId = `usage_${crypto.createHash('sha256').update('gateway-concurrent-transport').digest('hex').slice(0, 48)}`;
    const concurrentExecutionId = `localexec_${crypto.createHash('sha256').update(concurrentEventId).digest('hex').slice(0, 48)}`;
    const concurrentBody = JSON.stringify({
      activity: 'experience.analyst_chat',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'hold the slot briefly while a duplicate arrives' }],
      metering: {
        record: true,
        eventId: concurrentEventId,
        requestId: 'gateway-concurrent-request',
        gatewayExecutionId: concurrentExecutionId,
        sourceApp: 'experience-management'
      }
    });
    const beforeConcurrentDuplicates = ollamaCompletionCalls;
    const [concurrentFirst, concurrentSecond] = await Promise.all([
      signedRequest(concurrentBody),
      signedRequest(concurrentBody, { targetPort: secondGatewayPort })
    ]);
    assert.equal(concurrentFirst.status, 200);
    assert.equal(concurrentSecond.status, 200);
    assert.deepEqual(await concurrentFirst.json(), await concurrentSecond.json());
    assert.equal(ollamaCompletionCalls, beforeConcurrentDuplicates + 1);
    const receiptStatus = await (await controlRequest('/control/status')).json();
    assert.equal(receiptStatus.executionReceipts.configured, true);
    assert.equal(receiptStatus.executionReceipts.conflicts >= 0, true);

    const invalidEventId = `usage_${crypto.createHash('sha256').update('gateway-invalid-schema').digest('hex').slice(0, 48)}`;
    const invalidExecutionId = `localexec_${crypto.createHash('sha256').update(invalidEventId).digest('hex').slice(0, 48)}`;
    const invalidStructuredBody = JSON.stringify({
      activity: 'interview.questions',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'return an invalid structured result' }],
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { type: 'string' } }
      },
      metering: {
        record: true,
        eventId: invalidEventId,
        requestId: 'gateway-invalid-schema-request',
        gatewayExecutionId: invalidExecutionId,
        sourceApp: 'recruiter'
      }
    });
    const beforeInvalidStructured = ollamaCompletionCalls;
    const invalidStructured = await signedRequest(invalidStructuredBody);
    assert.equal(invalidStructured.status, 503);
    const invalidStructuredPayload = await invalidStructured.json();
    assert.equal(invalidStructuredPayload.code, 'LOCAL_LLM_SCHEMA_INVALID');
    assert.equal(invalidStructuredPayload.retryable, false);
    assert.equal(ollamaCompletionCalls, beforeInvalidStructured + 1);
    const invalidStructuredReplay = await signedRequest(invalidStructuredBody, { targetPort: secondGatewayPort });
    assert.equal(invalidStructuredReplay.status, 503);
    assert.deepEqual(await invalidStructuredReplay.json(), invalidStructuredPayload);
    assert.equal(ollamaCompletionCalls, beforeInvalidStructured + 1);

    const heldBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'hold the slot briefly' }]
    });
    const heldCompletion = signedRequest(heldBody);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const busyBody = JSON.stringify({
      activity: 'recruiter.general',
      executionMode: 'local-only',
      messages: [{ role: 'user', content: 'second request must wait in its activity lane' }]
    });
    const waitingCompletion = signedRequest(busyBody);
    let queuedStatus = null;
    const observedWaiting = await waitForCondition(async () => {
      queuedStatus = await (await controlRequest('/control/status')).json();
      return queuedStatus.waiting === 1
        && queuedStatus.activityQueues.some((lane) => (
          lane.activity === 'recruiter.general' && lane.waiting === 1
        ));
    });
    assert.equal(observedWaiting, true);
    assert.equal((await heldCompletion).status, 200);
    const waitingResponse = await waitingCompletion;
    assert.equal(waitingResponse.status, 200);
    const waitingPayload = await waitingResponse.json();
    assert.equal(waitingPayload.content, 'Local text completion');
    assert.equal(waitingPayload.metrics.queueWaitMs > 0, true);
    const drainedActivityQueue = await (await controlRequest('/control/status')).json();
    assert.equal(drainedActivityQueue.waiting, 0);
    assert.equal(
      drainedActivityQueue.activityQueues.find((lane) => lane.activity === 'recruiter.general').completed,
      3
    );

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

    await controlRequest('/control/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedEngine: 'codex', paused: false })
    });
    const localCloudStatus = await (await controlRequest('/control/status')).json();
    assert.equal(localCloudStatus.executionMode, 'local-cloud');
    assert.equal(localCloudStatus.cvLocalEligible, true);
  } finally {
    await controlRequest('/control/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initialState)
    });
  }
});
