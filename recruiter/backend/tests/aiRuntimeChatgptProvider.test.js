const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  TERRA_PROVIDER,
  createDefaultRuntimeSettings,
  failoverPolicyForRoute,
  isGatewayProvider,
  isManagedLocalProvider,
  isUserOwnedProvider,
  normalizeRuntimePolicy
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

const TEST_ENV = { LOCAL_LLM_BASE_URL: 'http://127.0.0.1:9', LOCAL_LLM_SHARED_SECRET: 'chatgpt-provider-test-secret' };

function withEnv(run) {
  const previous = {};
  for (const [key, value] of Object.entries(TEST_ENV)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function runtimeWith(settings, fetchImpl = async () => ({ ok: true }), connectedSubjects = new Map()) {
  const runtime = new AIRuntimeService({
    fetchImpl,
    settingsModel: {},
    credentialModel: {},
    quotaModel: {},
    // Injected so subject resolution is exercised without a live database.
    resolveSubject: async (actorId) => connectedSubjects.get(String(actorId)) || null
  });
  runtime.getSettings = async () => settings;
  return runtime;
}

function settingsWithChatgpt(overrides = {}) {
  const defaults = createDefaultRuntimeSettings();
  return {
    ...defaults,
    runtimePolicy: normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: true, defaultRuntime: 'local' }),
    models: defaults.models.map((model) => (
      model.provider === CHATGPT_PROVIDER ? { ...model, enabled: true } : model
    )),
    routes: defaults.routes.map((route) => (
      route.activity === 'assistant.chat'
        ? { ...route, provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL, enabled: true }
        : route
    )),
    ...overrides
  };
}

test('the ChatGPT runtime shares the gateway transport but not managed-local failover', () => {
  assert.equal(isUserOwnedProvider(CHATGPT_PROVIDER), true);
  assert.equal(isManagedLocalProvider(CHATGPT_PROVIDER), false,
    'a personal plan must not inherit managed-local Groq failover');
  assert.equal(isGatewayProvider(CHATGPT_PROVIDER), true, 'it still reaches the shared gateway transport');
  assert.equal(isGatewayProvider(TERRA_PROVIDER), true);

  // Routing and execution are separate decisions. A route may be returned to
  // the managed runtime before a request is sent, but once a turn is running on
  // someone's own plan a mid-flight failure is reported rather than replayed on
  // billed Groq capacity.
  assert.equal(failoverPolicyForRoute('assistant.chat', CHATGPT_PROVIDER), 'chatgpt_required');
  assert.equal(failoverPolicyForRoute('candidate.cv_parse', CHATGPT_PROVIDER), 'chatgpt_required',
    'even a locked activity must not replay a personal-plan failure on Groq');
  assert.equal(failoverPolicyForRoute('assistant.chat', TERRA_PROVIDER), 'groq_immediate');
});

test('the ChatGPT model declares the capability every structured activity requires', () => {
  const model = createDefaultRuntimeSettings().models.find((item) => item.provider === CHATGPT_PROVIDER);
  assert.ok(model, 'the catalogue must register a ChatGPT model');
  assert.ok(model.capabilities.includes('json_schema'),
    'resolveRoute rejects a model that cannot satisfy a structured activity');
  assert.equal(model.enabled, false, 'the runtime stays off until an administrator enables it');
  assert.equal(model.userOwned, true);
  // Inference bills to the connected account, so platform pricing must be zero.
  assert.equal(model.pricing.inputPerMillionUsd, 0);
  assert.equal(model.pricing.outputPerMillionUsd, 0);
});

test('runtime policy normalisation never leaves a default pointing at a disabled runtime', () => {
  assert.deepEqual(normalizeRuntimePolicy(undefined),
    { localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' });
  assert.deepEqual(
    normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: false, defaultRuntime: 'chatgpt' }),
    { localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' },
    'a default aimed at a disabled runtime is corrected on read'
  );
  assert.deepEqual(
    normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'local' }),
    { localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' }
  );
  assert.equal(normalizeRuntimePolicy({ defaultRuntime: 'nonsense' }).defaultRuntime, 'local');
});

test('a disabled ChatGPT runtime refuses its routes instead of quietly using another', async () => {
  const settings = settingsWithChatgpt({
    runtimePolicy: normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' })
  });
  const runtime = runtimeWith(settings);
  assert.throws(() => runtime.resolveRoute('assistant.chat', settings), (error) => {
    assert.equal(error.code, 'AI_RUNTIME_CHATGPT_DISABLED');
    assert.equal(error.statusCode, 503);
    return true;
  });
});

test('disabling every runtime is reported distinctly from disabling one', async () => {
  const settings = settingsWithChatgpt({
    runtimePolicy: { localEnabled: false, chatgptEnabled: false, defaultRuntime: 'local' }
  });
  const runtime = runtimeWith(settings);
  assert.throws(() => runtime.resolveRoute('assistant.chat', settings), (error) => {
    assert.equal(error.code, 'AI_RUNTIMES_DISABLED');
    return true;
  });
});

test('cross-product work runs where it ran before ChatGPT existed', async () => {
  // These arrive through /api/internal/ai carrying another product's user, so
  // there is no Recruiter account to bill. Experience Management degrades to
  // the managed runtime rather than failing the caller.
  const settings = settingsWithChatgpt();
  const runtime = runtimeWith(settings);
  for (const activity of ['experience.journey_mapping', 'knowledge.answer']) {
    const route = await runtime.attachCodexSubject(
      { activity, provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
      { actorId: 'recruiter-user-1' },
      settings
    );
    assert.notEqual(route.provider, CHATGPT_PROVIDER, `${activity} must not bill a recruiter's plan`);
    assert.equal(route.failoverReason, 'chatgpt_cross_product_request');
  }
});

test('withdrawn consent returns work to the managed runtime immediately', async () => {
  // Provider and model are durable job inputs, but a privacy revocation is an
  // immediate override: a queued or retried job stops using ChatGPT at once.
  const settings = settingsWithChatgpt();
  const runtime = runtimeWith(settings);
  const route = await runtime.attachCodexSubject(
    { activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
    { actorId: 'user-who-withdrew-consent' },
    settings
  );
  assert.notEqual(route.provider, CHATGPT_PROVIDER);
  assert.equal(route.failoverReason, 'chatgpt_consent_absent');
  assert.equal(route.failoverFrom, CHATGPT_PROVIDER);
});

test('with the managed runtime disabled there is nowhere to degrade, so it fails', async () => {
  const settings = settingsWithChatgpt({
    runtimePolicy: { localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt' }
  });
  const runtime = runtimeWith(settings);
  await assert.rejects(
    runtime.attachCodexSubject(
      { activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
      { actorId: 'user-who-withdrew-consent' },
      settings
    ),
    (error) => {
      assert.equal(error.code, 'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED');
      return true;
    }
  );
  await assert.rejects(
    runtime.attachCodexSubject(
      { activity: 'candidate.cv_parse', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
      { actorId: '' },
      settings
    ),
    (error) => {
      assert.equal(error.code, 'AI_RUNTIME_ACCOUNT_REQUIRED');
      return true;
    }
  );
});

test('unattributed work returns to the managed runtime instead of failing', async () => {
  // A public applicant's CV has no account that could ever be connected.
  const settings = settingsWithChatgpt();
  const runtime = runtimeWith(settings);
  const route = await runtime.attachCodexSubject(
    { activity: 'candidate.cv_parse', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
    { actorId: '' },
    settings
  );
  assert.notEqual(route.provider, CHATGPT_PROVIDER);
  assert.equal(route.failoverReason, 'chatgpt_unattributed_request');
  assert.ok(route.modelConfig, 'the fallback must resolve a real managed model');
});

test('a locked activity may be routed to a personal plan but not to another shared provider', () => {
  const settings = settingsWithChatgpt({
    routes: createDefaultRuntimeSettings().routes.map((route) => (
      route.activity === 'candidate.cv_parse'
        ? { ...route, provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL, enabled: true }
        : route
    ))
  });
  const runtime = runtimeWith(settings);
  const resolved = runtime.resolveRoute('candidate.cv_parse', settings);
  assert.equal(resolved.provider, CHATGPT_PROVIDER,
    'an explicit administrator choice of a personal plan survives the lock');

  // The lock still holds against drift onto a different shared provider.
  const drifted = settingsWithChatgpt({
    routes: createDefaultRuntimeSettings().routes.map((route) => (
      route.activity === 'candidate.cv_parse'
        ? { ...route, provider: 'groq', model: 'openai/gpt-oss-120b', enabled: true }
        : route
    ))
  });
  assert.equal(runtimeWith(drifted).resolveRoute('candidate.cv_parse', drifted).provider, TERRA_PROVIDER === 'local-codex'
    ? createDefaultRuntimeSettings().routes.find((route) => route.activity === 'candidate.cv_parse').provider
    : 'local-ollama');
});

test('a connected, consented user binds the route to their own plan', async () => {
  const settings = settingsWithChatgpt();
  const runtime = runtimeWith(settings, undefined, new Map([
    ['recruiter-user-1', { subjectId: 'recruiter-user-1', sourceApp: 'recruiter' }]
  ]));
  const route = await runtime.attachCodexSubject(
    { activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
    { actorId: 'recruiter-user-1' },
    settings
  );
  assert.equal(route.codexSubjectId, 'recruiter-user-1');
  assert.equal(route.runtimeOwner, 'user', 'personal-plan usage stays separable from platform usage');
  assert.equal(route.provider, CHATGPT_PROVIDER);
});

test('a managed-local route is left untouched by subject resolution', async () => {
  const runtime = runtimeWith(settingsWithChatgpt());
  const route = { activity: 'assistant.chat', provider: TERRA_PROVIDER, model: 'gpt-5.6-terra' };
  assert.deepEqual(await runtime.attachCodexSubject(route, { actorId: 'recruiter-user-1' }), route);
});

test('a user-owned request sends a subject claim and never a raw subject key', async () => {
  await withEnv(async () => {
    let sent;
    const runtime = runtimeWith(settingsWithChatgpt(), async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true };
    });
    await runtime.localProviderRequest({
      route: {
        activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL,
        reasoningEffort: 'high', codexSubjectId: 'recruiter-user-1'
      },
      input: { messages: [{ role: 'user', content: 'Draft an outreach note.' }] },
      context: { sourceApp: 'recruiter', usageExecutionId: 'chatgpt-contract-test' },
      requestId: 'chatgpt-contract-request'
    });

    assert.equal(sent.body.codexSourceApp, 'recruiter');
    assert.equal(sent.body.codexSubjectId, 'recruiter-user-1');
    // The gateway derives the key; sending one would let this caller address
    // any session on the host.
    assert.equal(sent.body.codexSubject, undefined);
    assert.equal(sent.body.requiredEngine, 'codex');
    assert.equal(sent.body.reasoningEffort, 'high');
    // Model choice belongs to the connected account's catalogue, not ours.
    assert.equal(sent.body.model, undefined);
    assert.equal(sent.body.requiredModel, undefined);
    // Metering identity is unchanged, so personal-plan turns still reconcile.
    assert.match(sent.body.metering.gatewayExecutionId, /^localexec_[a-f0-9]{48}$/u);
  });
});

test('a user-owned route without a resolved subject refuses to reach the gateway', async () => {
  await withEnv(async () => {
    let called = false;
    const runtime = runtimeWith(settingsWithChatgpt(), async () => { called = true; return { ok: true }; });
    await assert.rejects(runtime.localProviderRequest({
      route: { activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
      input: { messages: [{ role: 'user', content: 'x' }] },
      context: { sourceApp: 'recruiter', usageExecutionId: 'chatgpt-missing-subject' },
      requestId: 'chatgpt-missing-subject-request'
    }), (error) => {
      assert.equal(error.code, 'CHATGPT_SUBJECT_UNRESOLVED');
      return true;
    });
    assert.equal(called, false, 'no request may leave without an owner for the bill');
  });
});

test('managed-local requests keep their existing gateway contract', async () => {
  await withEnv(async () => {
    let sent;
    const runtime = runtimeWith(settingsWithChatgpt(), async (url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true };
    });
    await runtime.localProviderRequest({
      route: { activity: 'assistant.chat', provider: TERRA_PROVIDER, model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
      input: { messages: [{ role: 'user', content: 'x' }] },
      context: { sourceApp: 'recruiter', usageExecutionId: 'managed-local-regression' },
      requestId: 'managed-local-regression-request'
    });
    assert.equal(sent.requiredEngine, 'codex');
    assert.equal(sent.requiredModel, 'gpt-5.6-terra');
    assert.equal(sent.model, 'gpt-5.6-terra');
    assert.equal(sent.codexSubjectId, undefined, 'the shared account carries no subject');
    assert.equal(sent.codexSourceApp, undefined);
  });
});
