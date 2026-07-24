const assert = require('node:assert/strict');
const test = require('node:test');

const { createDefaultRuntimeSettings } = require('../config/aiRuntimeCatalog');
const AIUsageEvent = require('../models/AIUsageEvent');
const {
  AIRuntimeError,
  AIRuntimeService,
  calculateFailovers,
  deterministicBucket,
  isLocalRuntimeUnavailable,
  quotaSnapshotIsAvailable,
  shouldUseGroq,
  stripReasoning
} = require('../services/aiRuntime/aiRuntimeService');
const { AzureTextRollbackAdapter } = require('../services/aiRuntime/azureTextRollbackAdapter');

function successPayload(content = 'OK', extra = {}) {
  return {
    id: 'provider-request',
    model: 'openai/gpt-oss-120b',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...extra
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

class TestRuntime extends AIRuntimeService {
  constructor(responses, credentials = null) {
    super({ fetchImpl: async () => { throw new Error('unexpected fetch'); } });
    this.responses = [...responses];
    this.credentials = credentials || [
      { _id: 'key-1', label: 'Primary', quotaGroup: 'group-1', status: 'healthy' },
      { _id: 'key-2', label: 'Secondary', quotaGroup: 'group-1', status: 'healthy' }
    ];
    this.providerCalls = [];
    this.results = [];
    this.failures = [];
    this.successes = [];
  }

  async getSettings() { return createDefaultRuntimeSettings(); }

  async listEligibleCredentials({ excludeIds = [], excludeQuotaGroups = [] } = {}) {
    return this.credentials.filter((credential) => (
      !excludeIds.map(String).includes(String(credential._id))
      && !excludeQuotaGroups.includes(credential.quotaGroup)
    ));
  }

  async providerRequest({ credential, payload }) {
    this.providerCalls.push({ credential, payload });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next;
  }

  async markCredentialSuccess(credential) { this.successes.push(credential._id); }
  async markCredentialFailure(credential, error) { this.failures.push({ id: credential._id, error }); }
  async recordResult(input) { this.results.push(input); return { event: input, quota: null }; }
}

test('normal completion routes to GPT-OSS and strips reasoning traces', async () => {
  const runtime = new TestRuntime([jsonResponse(successPayload('Answer', {
    reasoning: 'hidden chain',
    choices: [{ message: { content: 'Answer', reasoning_content: 'hidden chain' }, finish_reason: 'stop' }]
  }))]);
  const result = await runtime.complete('candidate.insights', {
    messages: [{ role: 'user', content: 'Summarize' }],
    max_tokens: 99999,
    promptVersion: 'candidate-insights-v3',
    frequency_penalty: 0,
    presence_penalty: 0
  });
  assert.equal(result.content, 'Answer');
  assert.equal(result.raw.reasoning, undefined);
  assert.equal(result.raw.choices[0].message.reasoning_content, undefined);
  assert.equal(runtime.providerCalls[0].payload.model, 'openai/gpt-oss-120b');
  assert.equal(runtime.providerCalls[0].payload.max_tokens, 4000);
  assert.equal(runtime.providerCalls[0].payload.reasoning_format, undefined);
  assert.equal(runtime.providerCalls[0].payload.include_reasoning, false);
  assert.equal(runtime.providerCalls[0].payload.frequency_penalty, undefined);
  assert.equal(runtime.providerCalls[0].payload.presence_penalty, undefined);
  assert.equal(runtime.results[0].context.promptVersion, 'candidate-insights-v3');
});

test('eligible local request failure records the Terra attempt then succeeds on Groq', async () => {
  const runtime = new TestRuntime([jsonResponse(successPayload('Recovered on Groq'))]);
  runtime.localProviderRequest = async () => {
    throw new AIRuntimeError('Terra is offline', {
      code: 'AI_LOCAL_UNAVAILABLE',
      statusCode: 503,
      retryable: true
    });
  };

  const result = await runtime.complete('interview.questions', {
    messages: [{ role: 'user', content: 'Generate interview questions' }]
  });

  assert.equal(result.content, 'Recovered on Groq');
  assert.equal(result.provider, 'groq');
  assert.deepEqual(result.failover, {
    from: 'local-ollama',
    reason: 'AI_LOCAL_UNAVAILABLE'
  });
  assert.equal(runtime.providerCalls.length, 1);
  assert.equal(runtime.results.length, 2);
  assert.equal(runtime.results[0].status, 'failed');
  assert.equal(runtime.results[0].route.provider, 'local-ollama');
  assert.equal(runtime.results[1].status, 'success');
  assert.equal(runtime.results[1].route.provider, 'groq');
  assert.equal(runtime.results[1].route.failoverFrom, 'local-ollama');
  assert.equal(runtime.results[1].route.failoverReason, 'AI_LOCAL_UNAVAILABLE');
  assert.equal(runtime.results[0].requestId, runtime.results[1].requestId);
  assert.equal(calculateFailovers(runtime.results[0].route, 1), 0);
  assert.equal(calculateFailovers(runtime.results[1].route, 1), 1);
  assert.equal(calculateFailovers(runtime.results[1].route, 2), 2);
});

test('eligible local request does not fail over when automatic failover is disabled', async () => {
  const runtime = new TestRuntime([jsonResponse(successPayload('must not be used'))]);
  const settings = createDefaultRuntimeSettings();
  settings.localFailover.enabled = false;
  runtime.getSettings = async () => settings;
  runtime.localProviderRequest = async () => {
    throw new AIRuntimeError('Terra is offline', {
      code: 'AI_LOCAL_UNAVAILABLE',
      statusCode: 503,
      retryable: true
    });
  };

  await assert.rejects(() => runtime.complete('interview.questions', {
    messages: [{ role: 'user', content: 'Generate interview questions' }]
  }), (error) => error.code === 'AI_LOCAL_UNAVAILABLE');
  assert.equal(runtime.providerCalls.length, 0);
  assert.equal(runtime.results.length, 1);
});

test('eligible local request does not fail over for schema, authentication, or other non-outage errors', async () => {
  for (const error of [
    new AIRuntimeError('Invalid schema', {
      code: 'LOCAL_LLM_SCHEMA_INVALID',
      statusCode: 503,
      retryable: true
    }),
    new AIRuntimeError('Request rejected', {
      code: 'ACTIVITY_NOT_ALLOWED',
      statusCode: 403,
      providerStatus: 403,
      retryable: true
    }),
    new AIRuntimeError('Bad request', {
      code: 'INVALID_AI_REQUEST',
      statusCode: 400,
      providerStatus: 400,
      retryable: false
    })
  ]) {
    const runtime = new TestRuntime([jsonResponse(successPayload('must not be used'))]);
    runtime.localProviderRequest = async () => { throw error; };
    await assert.rejects(() => runtime.complete('interview.questions', {
      messages: [{ role: 'user', content: 'Generate interview questions' }]
    }), (caught) => caught.code === error.code);
    assert.equal(runtime.providerCalls.length, 0);
    assert.equal(runtime.results.length, 1);
  }
  assert.equal(isLocalRuntimeUnavailable(new AIRuntimeError('offline', {
    code: 'AI_LOCAL_UNAVAILABLE',
    retryable: true
  })), true);
  assert.equal(isLocalRuntimeUnavailable(new AIRuntimeError('malformed', {
    code: 'LOCAL_LLM_JSON_INVALID',
    retryable: true
  })), false);
});

test('usage audit schema persists local-to-Groq failover provenance', () => {
  assert.ok(AIUsageEvent.schema.path('failoverFrom'));
  assert.ok(AIUsageEvent.schema.path('failoverReason'));
});

for (const activity of ['candidate.cv_parse', 'ai_interview.cv_parse']) {
  test(`${activity} never silently falls back when local inference fails`, async () => {
    const runtime = new TestRuntime([jsonResponse(successPayload('must not be used'))]);
    runtime.localProviderRequest = async () => {
      throw new AIRuntimeError('Terra is offline', {
        code: 'AI_LOCAL_UNAVAILABLE',
        statusCode: 503,
        retryable: true
      });
    };

    await assert.rejects(() => runtime.complete(activity, {
      messages: [{ role: 'user', content: 'Extract this CV' }]
    }), (error) => error.code === 'AI_LOCAL_UNAVAILABLE');
    assert.equal(runtime.providerCalls.length, 0);
    assert.equal(runtime.results.length, 1);
    assert.equal(runtime.results[0].route.provider, 'local-ollama');
    assert.equal(runtime.results[0].route.failoverPolicy, 'wait_local');
    assert.equal(calculateFailovers(runtime.results[0].route, 1), 0);
  });
}

test('deterministic canary selection is stable and Groq-only at 100 percent', () => {
  const context = { organizationId: 'org-stable' };
  assert.equal(deterministicBucket(context), deterministicBucket(context));
  assert.equal(shouldUseGroq(context, { groqPercent: 100, azureBaselineEnabled: false }), true);
  const bucket = deterministicBucket(context, 'test-salt');
  assert.equal(
    shouldUseGroq(context, { groqPercent: 50, azureBaselineEnabled: true, samplingSalt: 'test-salt' }),
    bucket < 50
  );
});

test('Azure rollback adapter is explicit and removes Groq-only controls', async () => {
  let captured;
  const adapter = new AzureTextRollbackAdapter({
    configResolver: () => ({ endpoint: 'https://azure.example', deployment: 'baseline', apiVersion: '2024-05-01', apiKey: 'secret' }),
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return jsonResponse(successPayload('Baseline'));
    }
  });
  await adapter.request({
    payload: {
      model: 'openai/gpt-oss-120b',
      reasoning_effort: 'high',
      reasoning_format: 'hidden',
      include_reasoning: false,
      messages: [{ role: 'user', content: 'Return data' }],
      response_format: {
        type: 'json_schema',
        json_schema: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }
      }
    }
  });
  assert.match(captured.url, /deployments\/baseline\/chat\/completions/);
  assert.equal(captured.body.model, undefined);
  assert.equal(captured.body.reasoning_effort, undefined);
  assert.equal(captured.body.reasoning_format, undefined);
  assert.equal(captured.body.include_reasoning, undefined);
  assert.equal(captured.body.response_format.type, 'json_object');
  assert.match(captured.body.messages.at(-1).content, /"ok"/);
});

test('canary baseline requests never fall through to a Groq credential', async () => {
  const runtime = new TestRuntime([]);
  const settings = createDefaultRuntimeSettings();
  settings.rollout = { groqPercent: 10, azureBaselineEnabled: true, samplingSalt: 'canary-test' };
  let organizationId = 'org-0';
  while (deterministicBucket({ organizationId }, settings.rollout.samplingSalt) < 10) {
    organizationId = `org-${Number(organizationId.split('-')[1]) + 1}`;
  }
  runtime.getSettings = async () => settings;
  runtime.azureRollback = { request: async () => jsonResponse(successPayload('Azure baseline', { model: 'azure-baseline' })) };
  const result = await runtime.complete('recruiter.general', {
    context: { organizationId },
    messages: [{ role: 'user', content: 'Hello' }]
  });
  assert.equal(result.content, 'Azure baseline');
  assert.equal(runtime.providerCalls.length, 0);
  assert.equal(runtime.results[0].route.provider, 'azure');
});

test('quota snapshots block exhausted scopes before another key is selected', () => {
  const now = new Date('2026-07-21T12:34:00.000Z');
  assert.equal(quotaSnapshotIsAvailable({ blockedUntil: new Date(now.getTime() + 60_000) }, {}, now), false);
  assert.equal(quotaSnapshotIsAvailable({
    localDay: now,
    localRequestsToday: 1000,
    localMinute: now,
    localRequestsMinute: 1
  }, { rpd: 1000, rpm: 30 }, now), false);
  assert.equal(quotaSnapshotIsAvailable({
    localDay: now,
    localRequestsToday: 10,
    localMinute: now,
    localTokensMinute: 7999
  }, { rpd: 1000, tpm: 8000 }, now), true);
});

test('tool-call responses are accepted without text content', async () => {
  const payload = successPayload('');
  payload.choices[0].message.tool_calls = [{ id: 'call-1', type: 'function', function: { name: 'search_jobs', arguments: '{}' } }];
  const result = await new TestRuntime([jsonResponse(payload)]).complete('assistant.tool_selection', {
    messages: [{ role: 'user', content: 'Find jobs' }]
  });
  assert.equal(result.toolCalls.length, 1);
});

test('structured completion repairs once and validates the final schema', async () => {
  const runtime = new TestRuntime([
    jsonResponse(successPayload('{"score":"bad"}')),
    jsonResponse(successPayload('{"score":88}'))
  ]);
  const result = await runtime.structuredComplete('ai_interview.scoring', {
    messages: [{ role: 'user', content: 'Score this fixture' }],
    jsonSchema: {
      type: 'object', additionalProperties: false, required: ['score'],
      properties: { score: { type: 'number', minimum: 0, maximum: 100 } }
    }
  });
  assert.deepEqual(result.data, { score: 88 });
  assert.equal(result.schemaRepairAttempted, true);
  assert.equal(runtime.providerCalls.length, 2);
  assert.equal(runtime.providerCalls[0].payload.jsonSchema, undefined);
  assert.equal(runtime.providerCalls[0].payload.schemaName, undefined);
  assert.equal(runtime.providerCalls[0].payload.schemaStrict, undefined);
  assert.equal(runtime.providerCalls[0].payload.response_format.type, 'json_schema');
  assert.equal(runtime.providerCalls[1].payload.messages.at(-1).content.includes('Validation issues'), true);
});

test('structured completion stops after one failed repair', async () => {
  const runtime = new TestRuntime([
    jsonResponse(successPayload('not json')),
    jsonResponse(successPayload('{"score":"still bad"}'))
  ]);
  await assert.rejects(() => runtime.structuredComplete('ai_interview.scoring', {
    messages: [{ role: 'user', content: 'Score' }],
    jsonSchema: { type: 'object', required: ['score'], properties: { score: { type: 'number' } } }
  }), (error) => error.code === 'AI_SCHEMA_VALIDATION_FAILED');
  assert.equal(runtime.providerCalls.length, 2);
});

test('flexible Groq structured tasks use best-effort provider mode and local validation', async () => {
  const runtime = new TestRuntime([jsonResponse(successPayload('{"dynamic_section":{"value":"kept"}}'))]);
  const result = await runtime.structuredComplete('matching.analysis', {
    messages: [{ role: 'user', content: 'Extract flexible sections' }],
    jsonSchema: { type: 'object', additionalProperties: true },
    schemaName: 'flexible_cv',
    schemaStrict: false
  });
  assert.equal(runtime.providerCalls[0].payload.response_format.json_schema.strict, false);
  assert.equal(result.data.dynamic_section.value, 'kept');
});

for (const [status, code] of [[401, 'invalid_api_key'], [403, 'model_not_allowed'], [498, 'provider_timeout'], [500, 'server_error'], [503, 'unavailable']]) {
  test(`provider ${status} retries one healthy alternative`, async () => {
    const runtime = new TestRuntime([
      jsonResponse({ error: { code, message: 'provider failure' } }, status),
      jsonResponse(successPayload('Recovered'))
    ]);
    const result = await runtime.complete('recruiter.general', { messages: [{ role: 'user', content: 'Hello' }] });
    assert.equal(result.content, 'Recovered');
    assert.equal(runtime.providerCalls.length, 2);
    assert.deepEqual(runtime.failures.map((item) => item.id), ['key-1']);
    assert.deepEqual(runtime.successes, ['key-2']);
    assert.equal(runtime.results[0].attemptErrors.length, 1);
    assert.equal(runtime.results[0].attemptErrors[0].code, code);
    assert.equal(runtime.results[0].attemptErrors[0].credentialId, 'key-1');
  });
}

test('429 failover skips every key in the shared quota group', async () => {
  const credentials = [
    { _id: 'shared-a', label: 'A', quotaGroup: 'shared', status: 'healthy' },
    { _id: 'shared-b', label: 'B', quotaGroup: 'shared', status: 'healthy' },
    { _id: 'independent', label: 'C', quotaGroup: 'independent', status: 'healthy' }
  ];
  const runtime = new TestRuntime([
    jsonResponse({ error: { code: 'rate_limit_exceeded', message: 'limit' } }, 429, { 'retry-after': '30s' }),
    jsonResponse(successPayload('Independent quota'))
  ], credentials);
  const result = await runtime.complete('recruiter.general', { messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(result.content, 'Independent quota');
  assert.deepEqual(runtime.providerCalls.map((call) => call.credential._id), ['shared-a', 'independent']);
});

test('blocked_api_access also requires an independent quota group', async () => {
  const credentials = [
    { _id: 'shared-a', label: 'A', quotaGroup: 'shared', status: 'healthy' },
    { _id: 'shared-b', label: 'B', quotaGroup: 'shared', status: 'healthy' },
    { _id: 'independent', label: 'C', quotaGroup: 'independent', status: 'healthy' }
  ];
  const runtime = new TestRuntime([
    jsonResponse({ error: { code: 'blocked_api_access', message: 'spend limit reached' } }, 400),
    jsonResponse(successPayload('Recovered'))
  ], credentials);
  await runtime.complete('recruiter.general', { messages: [{ role: 'user', content: 'Hello' }] });
  assert.deepEqual(runtime.providerCalls.map((call) => call.credential._id), ['shared-a', 'independent']);
});

test('ordinary 400 validation errors do not retry', async () => {
  const runtime = new TestRuntime([jsonResponse({ error: { code: 'bad_request', message: 'invalid' } }, 400)]);
  await assert.rejects(() => runtime.complete('recruiter.general', {
    messages: [{ role: 'user', content: 'Hello' }]
  }), (error) => error.code === 'bad_request');
  assert.equal(runtime.providerCalls.length, 1);
});

test('network failures can fail over once', async () => {
  const runtime = new TestRuntime([
    new AIRuntimeError('network', { code: 'AI_PROVIDER_NETWORK_ERROR', retryable: true }),
    jsonResponse(successPayload('Recovered'))
  ]);
  const result = await runtime.complete('recruiter.general', { messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(result.content, 'Recovered');
  assert.equal(runtime.providerCalls.length, 2);
});

test('streaming responses pass through while telemetry consumes a tee', async () => {
  const streamBody = 'data: {"id":"stream-1","model":"openai/gpt-oss-20b","choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\ndata: [DONE]\n\n';
  const runtime = new TestRuntime([new Response(streamBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
  const response = await runtime.streamResponse('ai_interview.chat.clarification', {
    messages: [{ role: 'user', content: 'Clarify' }]
  });
  assert.equal(await response.text(), streamBody);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.results.some((item) => item.status === 'success'), true);
});

test('streaming failures are recorded after bounded failover attempts', async () => {
  const runtime = new TestRuntime([
    jsonResponse({ error: { code: 'server_error', message: 'first' } }, 500),
    jsonResponse({ error: { code: 'unavailable', message: 'second' } }, 503)
  ]);
  await assert.rejects(() => runtime.streamResponse('assistant.chat', {
    messages: [{ role: 'user', content: 'Stream' }]
  }), (error) => error.code === 'unavailable');
  assert.equal(runtime.results.length, 1);
  assert.equal(runtime.results[0].status, 'failed');
  assert.equal(runtime.results[0].attemptErrors.length, 2);
});

test('reasoning sanitizer preserves tools and user-visible content', () => {
  const cleaned = stripReasoning({
    reasoning: 'private',
    choices: [{ reasoning: 'private', message: { content: 'Visible', reasoning_content: 'private', tool_calls: [{ id: '1' }] } }]
  });
  assert.equal(cleaned.reasoning, undefined);
  assert.equal(cleaned.choices[0].message.content, 'Visible');
  assert.equal(cleaned.choices[0].message.tool_calls.length, 1);
});

test('credential cooldowns form a circuit breaker and 401 disables a key', async () => {
  const updates = [];
  let eligibilityQuery;
  const Credential = {
    find(query) {
      eligibilityQuery = query;
      return {
        select() { return this; },
        sort() { return Promise.resolve([]); }
      };
    },
    updateOne(filter, update) {
      updates.push({ filter, update });
      return Promise.resolve();
    }
  };
  const runtime = new AIRuntimeService({ credentialModel: Credential, settingsModel: {} });
  const settings = createDefaultRuntimeSettings();
  settings.alerts.enabled = false;
  await runtime.listEligibleCredentials({ model: 'openai/gpt-oss-120b' });
  assert.equal(eligibilityQuery.enabled, true);
  assert.ok(eligibilityQuery.$or.some((condition) => condition.cooldownUntil?.$lte instanceof Date));

  await runtime.markCredentialFailure(
    { _id: 'timeout-key', status: 'healthy', consecutiveFailures: 0 },
    new AIRuntimeError('timeout', { code: 'provider_timeout', providerStatus: 498, retryable: true }),
    'openai/gpt-oss-120b',
    settings
  );
  assert.equal(updates[0].update.$set.status, 'degraded');
  assert.ok(updates[0].update.$set.cooldownUntil instanceof Date);

  await runtime.markCredentialFailure(
    { _id: 'bad-key', status: 'healthy', consecutiveFailures: 0 },
    new AIRuntimeError('unauthorized', { code: 'invalid_api_key', providerStatus: 401, retryable: true }),
    'openai/gpt-oss-120b',
    settings
  );
  assert.equal(updates[1].update.$set.enabled, false);
  assert.equal(updates[1].update.$set.status, 'disabled');
});

test('organization-wide rate limits cool every key in the same quota group', async () => {
  const updates = [];
  const groupUpdates = [];
  const quotaUpdates = [];
  const Credential = {
    updateOne(filter, update) {
      updates.push({ filter, update });
      return Promise.resolve();
    },
    updateMany(filter, update) {
      groupUpdates.push({ filter, update });
      return Promise.resolve();
    }
  };
  const runtime = new AIRuntimeService({
    credentialModel: Credential,
    quotaModel: { updateOne: (filter, update) => { quotaUpdates.push({ filter, update }); return Promise.resolve(); } },
    settingsModel: {}
  });
  const settings = createDefaultRuntimeSettings();
  settings.alerts.enabled = false;
  await runtime.markCredentialFailure(
    { _id: 'limited-key', label: 'Limited', quotaGroup: 'shared-org', status: 'healthy' },
    new AIRuntimeError('limited', {
      code: 'rate_limit_exceeded',
      providerStatus: 429,
      retryable: true,
      details: { rateLimit: { retryAfterMs: 30_000 } }
    }),
    'openai/gpt-oss-120b',
    settings
  );
  assert.equal(updates.length, 1);
  assert.equal(groupUpdates.length, 1);
  assert.equal(quotaUpdates.length, 1);
  assert.equal(groupUpdates[0].filter.quotaGroup, 'shared-org');
  assert.ok(groupUpdates[0].update.$set.cooldownUntil instanceof Date);
});
