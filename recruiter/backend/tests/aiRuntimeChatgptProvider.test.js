const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHATGPT_DEFAULT_CODEX_MODEL,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  MANAGED_ROUTES,
  isChatgptPinnedActivity,
  TERRA_PROVIDER,
  createDefaultRuntimeSettings,
  failoverPolicyForRoute,
  isGatewayProvider,
  isManagedLocalProvider,
  isUserOwnedProvider,
  normalizeRuntimePolicy
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

const TEST_ENV = {
  CHATGPT_GATEWAY_BASE_URL: 'http://chatgpt-gateway.test:11435',
  CHATGPT_GATEWAY_SHARED_SECRET: 'hosted-chatgpt-provider-test-secret',
  LOCAL_LLM_BASE_URL: 'http://local-runtime.test:11435',
  LOCAL_LLM_SHARED_SECRET: 'managed-local-provider-test-secret'
};

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

/** ChatGPT available but not required: the posture in which unusable
 * ChatGPT work degrades to the managed runtime instead of failing. */
function settingsWithChatgpt(overrides = {}) {
  const defaults = createDefaultRuntimeSettings();
  return {
    ...defaults,
    runtimePolicy: normalizeRuntimePolicy({
      localEnabled: true, chatgptEnabled: true, defaultRuntime: 'local', chatgptRequired: false
    }),
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
  assert.equal(model.enabled, true, 'recruiter AI is ChatGPT-only, so its model ships enabled');
  assert.equal(model.userOwned, true);
  // Inference bills to the connected account, so platform pricing must be zero.
  assert.equal(model.pricing.inputPerMillionUsd, 0);
  assert.equal(model.pricing.outputPerMillionUsd, 0);
});

test('runtime policy normalisation never leaves a default pointing at a disabled runtime', () => {
  // Recruiter AI ships ChatGPT-only: connected accounts are the runtime, and
  // the managed local runtime remains only for other products' intake.
  assert.deepEqual(normalizeRuntimePolicy(undefined),
    { localEnabled: true, chatgptEnabled: true, defaultRuntime: 'chatgpt', chatgptRequired: true });
  assert.deepEqual(
    normalizeRuntimePolicy({ localEnabled: true, chatgptEnabled: false, defaultRuntime: 'chatgpt' }),
    { localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local', chatgptRequired: false },
    'a default aimed at a disabled runtime is corrected on read'
  );
  assert.deepEqual(
    normalizeRuntimePolicy({ localEnabled: false, chatgptEnabled: true, defaultRuntime: 'local', chatgptRequired: false }),
    { localEnabled: false, chatgptEnabled: true, defaultRuntime: 'chatgpt', chatgptRequired: false }
  );
  // Requiring a runtime that is switched off is meaningless, so it is dropped.
  assert.equal(
    normalizeRuntimePolicy({ chatgptEnabled: false, chatgptRequired: true }).chatgptRequired,
    false
  );
  assert.equal(normalizeRuntimePolicy({ chatgptEnabled: false, defaultRuntime: 'nonsense' }).defaultRuntime, 'local');
});

test('every recruiter activity ships routed to the connected ChatGPT account', () => {
  const settings = createDefaultRuntimeSettings();
  const chatgptModel = settings.models.find((model) => model.provider === CHATGPT_PROVIDER);
  assert.equal(chatgptModel.enabled, true, 'the shipped runtime must have an enabled model');
  for (const route of settings.routes) {
    if (isChatgptPinnedActivity(route.activity)) {
      assert.equal(route.provider, CHATGPT_PROVIDER, `${route.activity} must run on ChatGPT`);
      assert.equal(route.codexModel, CHATGPT_DEFAULT_CODEX_MODEL, `${route.activity} must prefer the sol model`);
      assert.equal(route.failoverPolicy, 'chatgpt_required');
    } else {
      // Another product's intake keeps its managed runtime: a recruiter's
      // personal plan must never be billed for Experience or CRM work.
      assert.notEqual(route.provider, CHATGPT_PROVIDER, `${route.activity} is cross-product`);
    }
  }
});

test('when ChatGPT is required there is no managed runtime to fall back to', async () => {
  const settings = settingsWithChatgpt({
    runtimePolicy: normalizeRuntimePolicy({
      localEnabled: true, chatgptEnabled: true, defaultRuntime: 'chatgpt', chatgptRequired: true
    })
  });
  const runtime = runtimeWith(settings);
  // An unconnected user is told to connect rather than having private work
  // quietly billed to platform capacity.
  await assert.rejects(
    runtime.attachCodexSubject(
      { activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
      { actorId: 'user-without-an-account' },
      settings
    ),
    (error) => {
      // Both codes mean the same thing to the caller: this person must act on
      // their own ChatGPT account before the work can run.
      assert.ok(
        ['AI_RUNTIME_ACCOUNT_REQUIRED', 'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED'].includes(error.code),
        `unexpected code ${error.code}`
      );
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  // Cross-product intake still runs: it never belonged to a personal plan.
  const crossProduct = await runtime.attachCodexSubject(
    { activity: 'experience.journey_mapping', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL },
    { actorId: 'recruiter-user-1' },
    settings
  );
  assert.notEqual(crossProduct.provider, CHATGPT_PROVIDER);
  assert.equal(crossProduct.failoverReason, 'chatgpt_cross_product_request');
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

  // The lock still holds against drift onto a different shared provider: it is
  // forced back to the activity's own managed runtime, never to Groq.
  const drifted = settingsWithChatgpt({
    routes: createDefaultRuntimeSettings().routes.map((route) => (
      route.activity === 'candidate.cv_parse'
        ? { ...route, provider: 'groq', model: 'openai/gpt-oss-120b', enabled: true }
        : route
    ))
  });
  const managedCvProvider = MANAGED_ROUTES
    .find((route) => route.activity === 'candidate.cv_parse').provider;
  assert.equal(runtimeWith(drifted).resolveRoute('candidate.cv_parse', drifted).provider, managedCvProvider);
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
    assert.equal(sent.url, 'http://chatgpt-gateway.test:11435/v1/complete');
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

test('a user-owned request never falls back to local runtime configuration', async () => {
  await withEnv(async () => {
    delete process.env.CHATGPT_GATEWAY_BASE_URL;
    delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    let called = false;
    const runtime = runtimeWith(settingsWithChatgpt(), async () => { called = true; return { ok: true }; });
    await assert.rejects(runtime.localProviderRequest({
      route: {
        activity: 'assistant.chat', provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL,
        codexSubjectId: 'recruiter-user-1'
      },
      input: { messages: [{ role: 'user', content: 'x' }] },
      context: { sourceApp: 'recruiter', usageExecutionId: 'no-local-fallback' },
      requestId: 'no-local-fallback-request'
    }), (error) => {
      assert.equal(error.code, 'CHATGPT_GATEWAY_NOT_CONFIGURED');
      return true;
    });
    assert.equal(called, false);
  });
});

test('managed-local requests keep their existing gateway contract', async () => {
  await withEnv(async () => {
    let sent;
    const runtime = runtimeWith(settingsWithChatgpt(), async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true };
    });
    await runtime.localProviderRequest({
      route: { activity: 'assistant.chat', provider: TERRA_PROVIDER, model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
      input: { messages: [{ role: 'user', content: 'x' }] },
      context: { sourceApp: 'recruiter', usageExecutionId: 'managed-local-regression' },
      requestId: 'managed-local-regression-request'
    });
    assert.equal(sent.url, 'http://local-runtime.test:11435/v1/complete');
    assert.equal(sent.body.requiredEngine, 'codex');
    assert.equal(sent.body.requiredModel, 'gpt-5.6-terra');
    assert.equal(sent.body.model, 'gpt-5.6-terra');
    assert.equal(sent.body.codexSubjectId, undefined, 'the shared account carries no subject');
    assert.equal(sent.body.codexSourceApp, undefined);
  });
});
