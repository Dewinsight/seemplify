const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');
const { requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const {
  ACTIVITY_DEFINITIONS,
  CLAUDE_PROVIDER,
  CLAUDE_SONNET_MODEL,
  createDefaultRuntimeSettings,
  GROQ_120B,
  GROQ_20B,
  LOCAL_CV_MODEL,
  LOCAL_PROVIDER,
  TERRA_MODEL,
  TERRA_PROVIDER,
  localProviderLabel
} = require('../config/aiRuntimeCatalog');
const AIAuditEvent = require('../models/AIAuditEvent');
const { createBootstrapSettings, mergeCatalogSettings } = require('../scripts/seedAIRuntime');
const { assessRouting } = require('../services/adminAIRuntimeService');
const {
  AIRuntimeService,
  deriveGatewayExecutionId,
  deriveRuntimeUsageEventId,
  requiredCapabilitiesForActivity
} = require('../services/aiRuntime/aiRuntimeService');
const { retryDelayMinutes, scoringRequestId } = require('../services/aiInterviewScoringRetryService');
const { decryptSecret, encryptSecret, fingerprintSecret, maskSecret } = require('../services/aiRuntime/secretCrypto');
const { getAIRequestContext, runWithAIRequestContext } = require('../services/aiRuntime/requestContext');
const { validateJsonSchema } = require('../services/aiRuntime/jsonSchemaValidator');
const {
  buildQuotaSnapshotSet,
  calculateEstimatedCost,
  normalizeUsage,
  parseDurationMs,
  parseRateLimitHeaders,
  sanitizeMessage,
  utcDay
} = require('../services/aiRuntime/usageService');

const TEST_KEY = crypto.randomBytes(32).toString('base64');
const TEST_ENV = {
  AI_PROVIDER_ENCRYPTION_KEY: TEST_KEY,
  AI_PROVIDER_ENCRYPTION_KEY_VERSION: 'test-v1'
};

test('every seeded AI activity has one compatible explicit route', () => {
  const settings = createDefaultRuntimeSettings();
  const health = assessRouting(settings);
  assert.equal(health.valid, true);
  assert.equal(health.configured, health.expected);
  assert.ok(requiredCapabilitiesForActivity('interview.questions').includes('json_schema'));
  assert.ok(requiredCapabilitiesForActivity('ai_interview.chat.clarification').includes('streaming'));
});

test('the local knowledge graph extraction activity is registered and pinned to Terra', () => {
  const activity = ACTIVITY_DEFINITIONS['experience.knowledge_graph_extract'];
  assert.ok(activity);
  assert.equal(activity.provider, TERRA_PROVIDER);
  assert.equal(activity.model, TERRA_MODEL);
  assert.equal(activity.reasoningEffort, 'high');
  assert.equal(activity.lockedProvider, true);
});

test('the grounded knowledge answer activity is registered and pinned to Terra', () => {
  const activity = ACTIVITY_DEFINITIONS['experience.knowledge_answer'];
  assert.ok(activity);
  assert.equal(activity.provider, TERRA_PROVIDER);
  assert.equal(activity.model, TERRA_MODEL);
  assert.equal(activity.reasoningEffort, 'high');
  assert.equal(activity.lockedProvider, true);
});

test('default routing keeps CV and questions on managed local inference while Experience is pinned to Terra', () => {
  const settings = createDefaultRuntimeSettings();
  const liveChatActivities = new Set([
    'ai_interview.chat.introduction',
    'ai_interview.chat.clarification',
    'ai_interview.chat.acknowledgement'
  ]);
  const localActivities = new Set([
    'candidate.cv_parse',
    'interview.questions',
    'ai_interview.question_generation',
    'ai_interview.cv_parse'
  ]);
  const terraActivities = new Set(
    Object.keys(require('../config/aiRuntimeCatalog').ACTIVITY_DEFINITIONS)
      .filter((activity) => activity.startsWith('experience.'))
  );
  const claudeActivities = new Set(
    Object.entries(ACTIVITY_DEFINITIONS)
      .filter(([, definition]) => definition.provider === CLAUDE_PROVIDER)
      .map(([activity]) => activity)
  );

  for (const route of settings.routes) {
    const expectedModel = terraActivities.has(route.activity)
      ? TERRA_MODEL
      : claudeActivities.has(route.activity)
        ? CLAUDE_SONNET_MODEL
      : localActivities.has(route.activity)
        ? LOCAL_CV_MODEL
        : liveChatActivities.has(route.activity) ? GROQ_20B : GROQ_120B;
    const expectedProvider = terraActivities.has(route.activity)
      ? TERRA_PROVIDER
      : claudeActivities.has(route.activity)
        ? CLAUDE_PROVIDER
        : localActivities.has(route.activity) ? LOCAL_PROVIDER : 'groq';
    assert.equal(route.model, expectedModel, route.activity);
    assert.equal(route.provider, expectedProvider, route.activity);
  }
  assert.equal(settings.routes.find((route) => route.activity === 'matching.analysis').reasoningEffort, 'high');
  assert.equal(settings.routes.find((route) => route.activity === 'ai_interview.scoring').reasoningEffort, 'high');
  assert.equal(settings.routes.find((route) => route.activity === 'ai_interview.chat.clarification').reasoningEffort, 'low');
});

test('configurable activities can use local inference while CV, CRM, and Experience provider locks remain enforced', () => {
  const settings = createDefaultRuntimeSettings();
  for (const route of settings.routes) {
    if (ACTIVITY_DEFINITIONS[route.activity]?.lockedProvider !== true) {
      route.provider = LOCAL_PROVIDER;
      route.model = LOCAL_CV_MODEL;
    }
  }
  assert.equal(assessRouting(settings).valid, true);

  const cvRoute = settings.routes.find((route) => route.activity === 'candidate.cv_parse');
  cvRoute.provider = 'groq';
  cvRoute.model = GROQ_120B;
  const assessment = assessRouting(settings);
  assert.equal(assessment.valid, false);
  assert.ok(assessment.issues.some((issue) => (
    issue.activity === 'candidate.cv_parse'
    && issue.code === 'invalid_provider'
  )));
});

test('local provider labels reflect the actual engine and model', () => {
  assert.equal(
    localProviderLabel('local-codex', 'gpt-5.6-terra'),
    'Terra (Codex local-cloud)'
  );
  assert.equal(
    localProviderLabel('local-codex', 'gpt-5.6-sol'),
    'Codex local-cloud: gpt-5.6-sol'
  );
  assert.equal(
    localProviderLabel('local-ollama', 'gemma4:26b-a4b-it-qat'),
    'Ollama local GPU: gemma4:26b-a4b-it-qat'
  );
  assert.equal(
    localProviderLabel('local-vllm', 'Qwen/Qwen3-30B-A3B'),
    'vLLM local GPU: Qwen/Qwen3-30B-A3B'
  );
  assert.equal(localProviderLabel(LOCAL_PROVIDER, LOCAL_CV_MODEL), 'Managed local runtime');
});

test('local CV provider requests require local-only inference at the signed gateway', async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  let request;
  const runtime = new AIRuntimeService({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
    settingsModel: {},
    credentialModel: {},
    quotaModel: {}
  });
  try {
    await runtime.localProviderRequest({
      route: { activity: 'candidate.cv_parse', model: LOCAL_CV_MODEL },
      input: {
        messages: [{ role: 'user', content: 'Synthetic CV' }],
        jsonSchema: { type: 'object' },
        schemaName: 'candidate_cv',
        context: { sourceApp: 'recruiter-cv-upload' }
      },
      context: {
        sourceApp: 'recruiter-cv-upload',
        usageExecutionId: 'local-only-contract-test'
      },
      requestId: 'local-only-contract-request'
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }

  assert.equal(request.url, 'http://127.0.0.1:11435/v1/cv/analyze');
  assert.equal(JSON.parse(request.options.body).executionMode, 'local-only');
  assert.equal(JSON.parse(request.options.body).requestSource, 'recruiter-cv-upload');
  assert.equal(JSON.parse(request.options.body).metering.record, true);
  assert.ok(request.options.headers['x-seemplify-signature']);
});

test('Experience routes use the application profile managed by Local Control Center', async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  let request;
  const runtime = new AIRuntimeService({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    }
  });
  try {
    await runtime.localProviderRequest({
      route: {
        activity: 'experience.analyst_chat',
        provider: TERRA_PROVIDER,
        model: TERRA_MODEL,
        reasoningEffort: 'medium'
      },
      input: { messages: [{ role: 'user', content: 'Question' }] },
      context: { sourceApp: 'experience-management', usageExecutionId: 'terra-contract-test' },
      requestId: 'terra-contract-request'
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'http://127.0.0.1:11435/v1/complete');
  assert.equal(body.runtimeProfile, 'experience-management');
  assert.equal(body.requiredEngine, undefined);
  assert.equal(body.requiredModel, undefined);
});

test('local provider transport rejects production calls without a durable metering identity', async () => {
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  let called = false;
  const runtime = new AIRuntimeService({
    fetchImpl: async () => {
      called = true;
      return { ok: true };
    }
  });
  try {
    await assert.rejects(() => runtime.localProviderRequest({
      route: { activity: 'candidate.cv_parse', model: LOCAL_CV_MODEL },
      input: {
        messages: [{ role: 'user', content: 'Synthetic CV' }],
        jsonSchema: { type: 'object' }
      }
    }), (error) => (
      error.code === 'AI_USAGE_CONTEXT_REQUIRED'
      && error.statusCode === 500
      && error.retryable === false
    ));
  } finally {
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }
  assert.equal(called, false);
});

test('production local runtime calls carry one stable at-source metering identity', async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  let requestBody;
  const runtime = new AIRuntimeService({
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true };
    }
  });
  const route = {
    activity: 'candidate.cv_parse',
    provider: LOCAL_PROVIDER,
    model: LOCAL_CV_MODEL
  };
  const context = {
    sourceApp: 'recruiter',
    usageExecutionId: 'cv-job-1:attempt-1',
    structuredCompletionOrdinal: 1
  };
  try {
    await runtime.localProviderRequest({
      route,
      input: {
        messages: [{ role: 'user', content: 'Synthetic CV' }],
        jsonSchema: { type: 'object' }
      },
      context,
      requestId: 'opaque-runtime-request-1'
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }

  const eventId = deriveRuntimeUsageEventId({ context, route });
  assert.deepEqual(requestBody.metering, {
    record: true,
    eventId,
    requestId: 'opaque-runtime-request-1',
    gatewayExecutionId: deriveGatewayExecutionId(eventId),
    sourceApp: 'recruiter'
  });
});

test('terminal gateway failures preserve retryability and at-source metering identity', async () => {
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {}, quotaModel: {} });
  const gatewayExecutionId = `localexec_${'a'.repeat(48)}`;
  const error = await runtime.parseErrorResponse(new Response(JSON.stringify({
    code: 'CODEX_TURN_FAILED',
    message: 'The provider outcome was persisted and must not be repeated',
    retryable: false,
    id: gatewayExecutionId,
    gatewayExecutionId,
    engine: 'codex',
    model: 'gpt-5.6-terra',
    usage: {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0
    },
    usageReported: false,
    usageSource: 'unreported'
  }), {
    status: 503,
    headers: { 'content-type': 'application/json' }
  }), LOCAL_PROVIDER);

  assert.equal(error.retryable, false);
  assert.equal(error.details.usageEnvelope.gatewayExecutionId, gatewayExecutionId);
  assert.equal(error.details.usageEnvelope.provider, 'local-codex');
  assert.equal(error.details.usageEnvelope.model, 'gpt-5.6-terra');
  assert.equal(error.details.usageEnvelope.usage.total_tokens, 0);
  assert.equal(error.details.usageEnvelope.usageReported, false);
});

test('shared-dispatch lease abort reaches the local CV gateway and preserves its safety error', async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  const controller = new AbortController();
  let requestSignal;
  let requestStarted;
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  const runtime = new AIRuntimeService({
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      requestStarted();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
    settingsModel: {},
    credentialModel: {},
    quotaModel: {}
  });
  try {
    const request = runtime.localProviderRequest({
      route: { activity: 'candidate.cv_parse', model: LOCAL_CV_MODEL },
      input: {
        messages: [{ role: 'user', content: 'Synthetic CV' }],
        jsonSchema: { type: 'object' },
        schemaName: 'candidate_cv'
      },
      context: {
        sourceApp: 'recruiter',
        usageExecutionId: 'shared-dispatch-abort-test'
      },
      requestId: 'shared-dispatch-abort-request',
      signal: controller.signal
    });
    await started;
    const leaseError = Object.assign(new Error('shared lease was lost'), {
      code: 'CV_GLOBAL_DISPATCH_LEASE_LOST'
    });
    controller.abort(leaseError);
    await assert.rejects(request, (error) => error === leaseError);
    assert.equal(requestSignal.aborted, true);
    assert.equal(requestSignal.reason, leaseError);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }
});

test('non-CV local activities use the signed general completion endpoint', async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  const previousSecret = process.env.LOCAL_LLM_SHARED_SECRET;
  process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
  process.env.LOCAL_LLM_SHARED_SECRET = 'test-local-runtime-secret';
  let request;
  const runtime = new AIRuntimeService({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
    settingsModel: {},
    credentialModel: {},
    quotaModel: {}
  });
  try {
    await runtime.localProviderRequest({
      route: { activity: 'interview.questions', model: LOCAL_CV_MODEL },
      input: {
        messages: [{ role: 'user', content: 'Create interview questions' }],
        jsonSchema: { type: 'object' },
        schemaName: 'interview_questions'
      },
      context: {
        sourceApp: 'recruiter',
        usageExecutionId: 'general-local-contract-test'
      },
      requestId: 'general-local-contract-request'
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.LOCAL_LLM_SHARED_SECRET;
    else process.env.LOCAL_LLM_SHARED_SECRET = previousSecret;
  }
  assert.equal(request.url, 'http://127.0.0.1:11435/v1/complete');
  assert.equal(JSON.parse(request.options.body).executionMode, 'local-only');
});

test('local activities expose an OpenAI-compatible buffered SSE stream', async () => {
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {}, quotaModel: {} });
  runtime.getSettings = async () => createDefaultRuntimeSettings();
  runtime.complete = async () => ({
    requestId: 'local-stream-request',
    content: 'Local streamed answer',
    toolCalls: [],
    finishReason: 'stop',
    model: LOCAL_CV_MODEL,
    usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }
  });

  const response = await runtime.streamResponse('interview.questions', {
    messages: [{ role: 'user', content: 'Create one question.' }]
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.match(body, /Local streamed answer/);
  assert.match(body, /"finish_reason":"stop"/);
  assert.match(body, /data: \[DONE\]/);
});

test('structured completion invokes a budget hook for every schema repair attempt', async () => {
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {}, quotaModel: {} });
  let completions = 0;
  let reservations = 0;
  const executionContexts = [];
  runtime.complete = async (_activity, input) => {
    executionContexts.push(input.context);
    return {
      content: completions++ === 0 ? '{"answer":1}' : '{"answer":"corrected"}'
    };
  };
  const result = await runtime.structuredComplete('interview.questions', {
    context: {
      requestId: 'cv-queue:job-1',
      usageExecutionId: 'cv-queue:job-1'
    },
    messages: [{ role: 'user', content: 'Return an answer.' }],
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['answer'],
      properties: { answer: { type: 'string' } }
    }
  }, {
    beforeAttempt: async () => { reservations += 1; }
  });
  assert.equal(result.data.answer, 'corrected');
  assert.equal(reservations, 2);
  assert.deepEqual(
    executionContexts.map((context) => context.structuredCompletionOrdinal),
    [1, 2]
  );
  assert.deepEqual(
    [...new Set(executionContexts.map((context) => context.usageExecutionId))],
    ['cv-queue:job-1']
  );
});

test('runtime reuses a stable request ID as its local usage execution identity', async () => {
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {}, quotaModel: {} });
  const executionContexts = [];
  runtime.complete = async (_activity, input) => {
    executionContexts.push(input.context);
    return { content: '{"answer":"ok"}' };
  };
  await runtime.structuredComplete('interview.questions', {
    context: { requestId: 'request-stable-across-retries' },
    messages: [{ role: 'user', content: 'Return an answer.' }],
    jsonSchema: {
      type: 'object',
      required: ['answer'],
      properties: { answer: { type: 'string' } }
    }
  });
  assert.equal(executionContexts[0].usageExecutionId, 'request-stable-across-retries');
});

test('runtime never falls back to the general route for a missing activity route', () => {
  const settings = createDefaultRuntimeSettings();
  settings.routes = settings.routes.filter((route) => route.activity !== 'interview.questions');
  const health = assessRouting(settings);
  assert.equal(health.valid, false);
  assert.ok(health.issues.some((issue) => issue.activity === 'interview.questions' && issue.code === 'missing_route'));
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {} });
  assert.throws(
    () => runtime.resolveRoute('interview.questions', settings),
    (error) => error.code === 'AI_ROUTE_NOT_CONFIGURED'
  );
});

test('routing rejects models that lack an activity capability', () => {
  const settings = createDefaultRuntimeSettings();
  const route = settings.routes.find((item) => item.activity === 'interview.questions');
  const model = settings.models.find((item) => item.id === route.model);
  model.capabilities = model.capabilities.filter((capability) => capability !== 'json_schema');
  const runtime = new AIRuntimeService({ settingsModel: {}, credentialModel: {} });
  assert.throws(
    () => runtime.resolveRoute('interview.questions', settings),
    (error) => error.code === 'AI_MODEL_CAPABILITY_MISMATCH'
  );
});

test('Groq model synchronization never marks the managed local model unavailable', async () => {
  const previousKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  const previousVersion = process.env.AI_PROVIDER_ENCRYPTION_KEY_VERSION;
  process.env.AI_PROVIDER_ENCRYPTION_KEY = TEST_ENV.AI_PROVIDER_ENCRYPTION_KEY;
  process.env.AI_PROVIDER_ENCRYPTION_KEY_VERSION = TEST_ENV.AI_PROVIDER_ENCRYPTION_KEY_VERSION;
  let persistedModels;
  const runtime = new AIRuntimeService({
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{ id: GROQ_20B }, { id: GROQ_120B }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
    settingsModel: {
      async updateOne(_filter, update) { persistedModels = update.$set.models; }
    },
    credentialModel: {},
    quotaModel: {}
  });
  runtime.getSettings = async () => createDefaultRuntimeSettings();
  runtime.getCredential = async () => ({
    encryptedSecret: encryptSecret(`gsk_${'z'.repeat(36)}`, { env: TEST_ENV })
  });
  try {
    await runtime.syncModels('credential-id');
  } finally {
    if (previousKey === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
    else process.env.AI_PROVIDER_ENCRYPTION_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY_VERSION;
    else process.env.AI_PROVIDER_ENCRYPTION_KEY_VERSION = previousVersion;
  }
  const local = persistedModels.find((model) => model.provider === LOCAL_PROVIDER);
  assert.equal(local.available, true);
  assert.equal(persistedModels.filter((model) => model.provider === 'groq').every((model) => model.available), true);
});

test('AES-GCM credentials round-trip, mask, and reject the wrong key', () => {
  const secret = `gsk_${'x'.repeat(36)}`;
  const encrypted = encryptSecret(secret, { env: TEST_ENV });
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.equal(encrypted.keyVersion, 'test-v1');
  assert.equal(decryptSecret(encrypted, { env: TEST_ENV }), secret);
  assert.equal(maskSecret(secret), `****${secret.slice(-4)}`);
  assert.equal(fingerprintSecret(secret).length, 64);
  assert.throws(() => decryptSecret(encrypted, {
    env: { ...TEST_ENV, AI_PROVIDER_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') }
  }));
});

test('secret sanitization removes Groq and bearer credentials', () => {
  const message = sanitizeMessage(`bad ${`gsk_${'a'.repeat(32)}`} and Bearer abc.def.ghi`);
  assert.equal(message.includes('gsk_'), false);
  assert.equal(message.includes('abc.def.ghi'), false);
});

test('usage and price calculations include cached and reasoning tokens', () => {
  const usage = normalizeUsage({
    prompt_tokens: 1000,
    completion_tokens: 500,
    prompt_tokens_details: { cached_tokens: 200 },
    completion_tokens_details: { reasoning_tokens: 125 }
  });
  assert.deepEqual(usage, {
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 200,
    reasoningTokens: 125,
    totalTokens: 1500
  });
  assert.equal(calculateEstimatedCost(usage, {
    inputPerMillionUsd: 1,
    cachedInputPerMillionUsd: 0.5,
    outputPerMillionUsd: 2
  }), 0.0019);
});

test('Groq rate headers and reset durations are normalized', () => {
  const now = new Date('2026-07-21T12:00:00.000Z');
  const headers = new Headers({
    'x-ratelimit-limit-requests': '1000',
    'x-ratelimit-remaining-requests': '250',
    'x-ratelimit-reset-requests': '1h2m3.5s',
    'x-ratelimit-limit-tokens': '8000',
    'x-ratelimit-remaining-tokens': '4000',
    'x-ratelimit-reset-tokens': '750ms',
    'x-request-id': 'groq-request-1'
  });
  const parsed = parseRateLimitHeaders(headers, now);
  assert.equal(parsed.requestLimitDaily, 1000);
  assert.equal(parsed.requestRemainingDaily, 250);
  assert.equal(parsed.tokenRemainingMinute, 4000);
  assert.equal(parsed.requestResetAt.toISOString(), '2026-07-21T13:02:03.500Z');
  assert.equal(parsed.tokenResetAt.toISOString(), '2026-07-21T12:00:00.750Z');
  assert.equal(parsed.providerRequestId, 'groq-request-1');
  assert.equal(parseDurationMs('2m30s'), 150000);
  assert.equal(utcDay(now).toISOString(), '2026-07-21T00:00:00.000Z');
});

test('quota counters use atomic window-aware update expressions', () => {
  const observedAt = new Date('2026-07-21T12:34:56.000Z');
  const update = buildQuotaSnapshotSet({
    createdAt: observedAt,
    totalTokens: 42,
    status: 'success',
    rateLimit: { requestLimitDaily: 1000, requestRemainingDaily: 900 }
  }, observedAt);
  assert.deepEqual(update.localRequestsToday.$cond[1], {
    $add: [{ $ifNull: ['$localRequestsToday', 0] }, 1]
  });
  assert.deepEqual(update.localTokensMinute.$cond[1], {
    $add: [{ $ifNull: ['$localTokensMinute', 0] }, 42]
  });
  assert.equal(update.localDay.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.equal(update.localMinute.toISOString(), '2026-07-21T12:34:00.000Z');
  assert.equal(update.requestRemainingDaily, 900);
  assert.deepEqual(update.blockedUntil, {
    $cond: [{ $gt: ['$blockedUntil', observedAt] }, '$blockedUntil', null]
  });
});

test('JSON Schema validation covers strict objects and nested arrays', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'scores'],
    properties: {
      name: { type: 'string', minLength: 2 },
      scores: { type: 'array', minItems: 1, items: { type: 'number', minimum: 0, maximum: 5 } }
    }
  };
  assert.equal(validateJsonSchema({ name: 'Ada', scores: [5, 4] }, schema).valid, true);
  const invalid = validateJsonSchema({ name: 'A', scores: [8], extra: true }, schema);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 3);
});

test('AsyncLocalStorage propagates and overrides AI request dimensions', async () => {
  await runWithAIRequestContext({ sourceApp: 'recruiter', organizationId: 'org-1' }, async () => {
    await Promise.resolve();
    assert.deepEqual(getAIRequestContext({ actorId: 'user-1' }), {
      sourceApp: 'recruiter', organizationId: 'org-1', actorId: 'user-1'
    });
  });
  assert.deepEqual(getAIRequestContext(), {});
});

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('internal gateway accepts exact HMAC signatures and rejects stale or unknown services', () => {
  const now = 1784635200000;
  const secret = 'test-hmac-secret';
  const body = JSON.stringify({ activity: 'ai_interview.scoring' });
  const timestamp = String(now);
  const path = '/api/internal/ai/v1/complete';
  const canonical = [timestamp, 'ai-interview', 'POST', path, body].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const middleware = createInternalServiceAuth({
    env: { AI_GATEWAY_HMAC_SECRET: secret, AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview' },
    now: () => now
  });
  const request = {
    method: 'POST', originalUrl: path, rawBody: Buffer.from(body),
    get(name) { return ({ 'x-seemplify-service': 'ai-interview', 'x-seemplify-timestamp': timestamp, 'x-seemplify-signature': signature })[name]; }
  };
  let nextCalled = false;
  middleware(request, createResponseRecorder(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const stale = createResponseRecorder();
  middleware({ ...request, get(name) { return ({ 'x-seemplify-service': 'ai-interview', 'x-seemplify-timestamp': String(now - 600000), 'x-seemplify-signature': signature })[name]; } }, stale, () => {});
  assert.equal(stale.statusCode, 401);

  const forbidden = createResponseRecorder();
  middleware({ ...request, get(name) { return ({ 'x-seemplify-service': 'unknown', 'x-seemplify-timestamp': timestamp, 'x-seemplify-signature': signature })[name]; } }, forbidden, () => {});
  assert.equal(forbidden.statusCode, 403);
});

test('admin permission boundaries keep secrets super-admin only', () => {
  const denied = createResponseRecorder();
  requirePermission('systemSettings')({ admin: { role: 'admin', permissions: {} } }, denied, () => {});
  assert.equal(denied.statusCode, 403);

  let allowed = false;
  requirePermission('systemSettings')({ admin: { role: 'admin', permissions: { systemSettings: true } } }, createResponseRecorder(), () => { allowed = true; });
  assert.equal(allowed, true);

  const secretDenied = createResponseRecorder();
  requireSuperAdmin({ admin: { role: 'admin' } }, secretDenied, () => {});
  assert.equal(secretDenied.statusCode, 403);
  requireSuperAdmin({ admin: { role: 'super_admin' } }, createResponseRecorder(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('default catalog keeps CV and question generation local and pins every Experience activity to Terra', () => {
  const settings = createDefaultRuntimeSettings();
  assert.ok(settings.routes.length >= 25);
  const localRoutes = settings.routes.filter((route) => route.provider === LOCAL_PROVIDER);
  assert.deepEqual(localRoutes.map((route) => route.activity).sort(), [
    'ai_interview.cv_parse',
    'ai_interview.question_generation',
    'candidate.cv_parse',
    'interview.questions'
  ]);
  const terraRoutes = settings.routes.filter((route) => route.provider === TERRA_PROVIDER);
  assert.deepEqual(terraRoutes.map((route) => route.activity).sort(), [
    'experience.analyst_chat',
    'experience.assistant.action_extract',
    'experience.assistant.correspondence_draft',
    'experience.assistant.document_compare',
    'experience.assistant.document_summarise',
    'experience.assistant.email_draft',
    'experience.assistant.email_summarise',
    'experience.assistant.executive_brief',
    'experience.assistant.knowledge_answer',
    'experience.assistant.meeting_minutes',
    'experience.assistant.meeting_prepare',
    'experience.assistant.work_product',
    'experience.cross_source_intelligence',
    'experience.insight_generation',
    'experience.journey_mapping',
    'experience.knowledge_answer',
    'experience.knowledge_graph_extract',
    'experience.report_generation',
    'experience.response_analysis',
    'experience.social_listening',
    'experience.social_reply_draft',
    'experience.survey_generation',
    'experience.translation'
  ]);
  assert.equal(terraRoutes.every((route) => route.model === TERRA_MODEL && route.failoverPolicy === 'wait_local'), true);
  const claudeRoutes = settings.routes.filter((route) => route.provider === CLAUDE_PROVIDER);
  assert.equal(claudeRoutes.length, 11);
  assert.equal(claudeRoutes.every((route) => route.model === CLAUDE_SONNET_MODEL && route.failoverPolicy === 'wait_local'), true);
  assert.equal(settings.routes.filter((route) => !localRoutes.includes(route) && !terraRoutes.includes(route) && !claudeRoutes.includes(route)).every((route) => route.provider === 'groq'), true);
  assert.equal(settings.models.some((model) => model.id === 'openai/gpt-oss-120b'), true);
  assert.equal(settings.models.some((model) => model.id === 'openai/gpt-oss-20b'), true);
  assert.equal(settings.models.some((model) => model.id === LOCAL_CV_MODEL), true);
  assert.equal(settings.models.some((model) => model.id === TERRA_MODEL && model.provider === TERRA_PROVIDER), true);
  assert.deepEqual(settings.rollout, {
    groqPercent: 100,
    azureBaselineEnabled: false,
    samplingSalt: 'groq-gpt-oss-v1'
  });
});

test('fresh bootstrap starts at the deterministic ten percent canary', () => {
  assert.deepEqual(createBootstrapSettings({}).rollout, {
    groqPercent: 10,
    azureBaselineEnabled: true,
    samplingSalt: 'groq-gpt-oss-v1'
  });
  assert.equal(createBootstrapSettings({ GROQ_BOOTSTRAP_ROLLOUT_PERCENT: '100' }).rollout.azureBaselineEnabled, false);
  assert.throws(() => createBootstrapSettings({ GROQ_BOOTSTRAP_ROLLOUT_PERCENT: '25' }));
});

test('runtime seed merges catalog updates without overwriting admin routing', () => {
  const defaults = createDefaultRuntimeSettings();
  const merged = mergeCatalogSettings({
    providerEnabled: false,
    models: [{
      ...defaults.models[0],
      enabled: false,
      available: true,
      pricing: { inputPerMillionUsd: 999 }
    }],
    routes: [
      { ...defaults.routes[0], model: 'openai/gpt-oss-20b', routeVersion: 7 },
      {
        ...defaults.routes.find((route) => route.activity === 'candidate.cv_parse'),
        provider: 'groq',
        model: GROQ_120B,
        enabled: false,
        routeVersion: 7
      }
    ],
    quotaGroups: [{ id: 'existing', label: 'Existing', enabled: true }],
    alerts: { recipients: ['ops@example.com'] },
    rollout: { groqPercent: 50, azureBaselineEnabled: true, samplingSalt: 'existing-salt' }
  }, defaults);
  assert.equal(merged.providerEnabled, false);
  assert.equal(merged.models[0].enabled, false);
  assert.equal(merged.models[0].available, true);
  assert.deepEqual(merged.models[0].pricing, defaults.models[0].pricing);
  assert.equal(merged.models.length, defaults.models.length);
  assert.equal(merged.routes[0].model, 'openai/gpt-oss-20b');
  assert.equal(merged.routes[0].routeVersion, 7);
  const mergedCvRoute = merged.routes.find((route) => route.activity === 'candidate.cv_parse');
  assert.equal(mergedCvRoute.provider, LOCAL_PROVIDER);
  assert.equal(mergedCvRoute.model, LOCAL_CV_MODEL);
  assert.equal(mergedCvRoute.failoverPolicy, 'wait_local');
  assert.equal(mergedCvRoute.enabled, false);
  assert.equal(mergedCvRoute.routeVersion, 7);
  assert.equal(merged.routes.length, defaults.routes.length);
  assert.deepEqual(merged.alerts.recipients, ['ops@example.com']);
  assert.equal(merged.rollout.groqPercent, 50);
  assert.equal(merged.rollout.samplingSalt, 'existing-salt');
});

test('bootstrap replaces only an untouched auto-created Groq-only rollout', () => {
  const runtimeDefaults = createDefaultRuntimeSettings();
  const bootstrapDefaults = createBootstrapSettings({});
  const merged = mergeCatalogSettings(runtimeDefaults, bootstrapDefaults);
  assert.equal(merged.rollout.groqPercent, 10);
  assert.equal(merged.rollout.azureBaselineEnabled, true);

  const completed = mergeCatalogSettings({
    ...runtimeDefaults,
    updatedBy: 'admin-1',
    rollout: { ...runtimeDefaults.rollout, updatedAt: new Date(), updatedBy: 'admin-1' }
  }, bootstrapDefaults);
  assert.equal(completed.rollout.groqPercent, 100);
  assert.equal(completed.rollout.azureBaselineEnabled, false);
});

test('alert reservations are protected by a unique sparse dedupe key', () => {
  const dedupeIndex = AIAuditEvent.schema.indexes().find(([fields]) => fields.dedupeKey === 1);
  assert.ok(dedupeIndex);
  assert.equal(dedupeIndex[1].unique, true);
  assert.equal(dedupeIndex[1].sparse, true);
});

test('interview scoring retries back off without becoming permanently failed', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(retryDelayMinutes), [2, 4, 8, 16, 32, 32]);
  assert.equal(scoringRequestId('session-42'), 'ai-interview-score:session-42');
});
