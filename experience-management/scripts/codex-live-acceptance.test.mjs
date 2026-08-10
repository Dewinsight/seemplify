/**
 * Self-tests for the live ChatGPT / Codex acceptance harness.
 *
 * NOT A LIVE RUN. Every test here drives the harness against a fake in-process
 * HTTP API that imitates this application's own endpoints. No ChatGPT account,
 * no Codex App Server, no browser, and no real credential is involved, and the
 * evidence these tests produce is explicitly marked as non-live. The tests
 * exist to prove the harness logic itself: the opt-in gate, the fail-closed
 * checks, the fixture and Terra-fallback rejections, redaction, and the
 * same-day refusal of the expiry checkpoint.
 *
 * Run with: node --test scripts/codex-live-acceptance.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AcceptanceError, CHECKPOINT_ABSOLUTE_MINIMUM_HOURS, FIXTURE_MODEL_IDS, OPT_IN_VALUE, OPT_IN_VARIABLE,
  assertHarnessFilePath, assertLiveAccount, assertLiveModelCatalog, assertRedactedEvidence, chooseModelAndEffort,
  createCheckpointState, evaluateExpiryCheckpoint, evidenceFilename, resolveHarnessOptions, runAcceptance,
  verifyExpiryCheckpoint
} from './codex-live-acceptance-core.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const FAKE_RUNTIME_DIR = '/opt/seemplify/codex-runtime';
const FAKE_EVIDENCE_DIR = '/opt/seemplify/acceptance-evidence';
const OPERATOR_EMAIL = 'harness-operator@seemplifyai.com';
const OPERATOR_PASSWORD = 'fake-api-operator-password';

const running = new Set();
after(async () => {
  for (const api of running) await api.stop();
});

/* ------------------------------------------------------------------ */
/* Fake Experience HTTP API                                            */
/* ------------------------------------------------------------------ */

const LIVE_LOOKING_MODELS = [
  {
    id: 'gpt-5.1-codex', model: 'gpt-5.1-codex', displayName: 'GPT-5.1 Codex', hidden: false, isDefault: true,
    defaultReasoningEffort: 'medium', inputModalities: ['text'],
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }]
  },
  {
    id: 'gpt-5.1-codex-mini', model: 'gpt-5.1-codex-mini', displayName: 'GPT-5.1 Codex mini', hidden: false,
    isDefault: false, defaultReasoningEffort: 'low', inputModalities: ['text'],
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }]
  }
];

function advertisedEfforts(model) {
  const listed = (model.supportedReasoningEfforts || []).map((item) => item.reasoningEffort);
  return [...new Set([...listed, ...(model.defaultReasoningEffort ? [model.defaultReasoningEffort] : [])])];
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

function createFakeExperienceApi(configuration = {}) {
  const settings = {
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    planType: 'pro',
    connected: true,
    models: LIVE_LOOKING_MODELS,
    processingDelayMs: 25,
    completionDelayMs: 120,
    providerOverride: null,
    engineOverride: null,
    modelOverride: null,
    effortOverride: null,
    allowSignedOutReads: false,
    ...configuration
  };
  const state = {
    sessions: new Set(),
    jobs: new Map(),
    surveysRemoved: [],
    requestIds: [],
    patches: [],
    deviceLoginCalls: 0,
    restarts: 0,
    preference: {
      provider: 'codex', runtimeChoice: 'chatgpt', codexModel: null, codexReasoningEffort: null,
      codexActionOverrides: {}, codexDataSharingAcknowledgedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', effectiveProvider: 'codex'
    }
  };

  function defaultModel() {
    return settings.models.find((model) => model.isDefault) || settings.models[0];
  }

  function resolveFor(actionId) {
    const override = actionId ? state.preference.codexActionOverrides[actionId] : null;
    const known = (id) => settings.models.some((model) => model.id === id);
    let model = null;
    if (override && override.model && known(override.model)) model = { value: override.model, source: 'user_action' };
    else if (state.preference.codexModel && known(state.preference.codexModel)) {
      model = { value: state.preference.codexModel, source: 'user_default' };
    } else model = { value: defaultModel().id, source: 'connected_model_default' };
    const definition = settings.models.find((entry) => entry.id === model.value);
    const supported = advertisedEfforts(definition);
    let effort = null;
    if (override && override.reasoningEffort && supported.includes(override.reasoningEffort)) {
      effort = { value: override.reasoningEffort, source: 'user_action' };
    } else if (state.preference.codexReasoningEffort && supported.includes(state.preference.codexReasoningEffort)) {
      effort = { value: state.preference.codexReasoningEffort, source: 'user_default' };
    } else {
      effort = {
        value: supported.includes(definition.defaultReasoningEffort) ? definition.defaultReasoningEffort : supported[0],
        source: 'model_default'
      };
    }
    return {
      model: { ...model, inherited: model.source !== 'user_action' },
      reasoningEffort: { ...effort, inherited: effort.source !== 'user_action' }
    };
  }

  function providerState() {
    return {
      preference: { ...state.preference },
      runtimePolicy: { localEnabled: true, chatgptEnabled: true, defaultRuntime: 'chatgpt', effectiveProvider: 'codex' },
      codex: {
        available: true,
        account: {
          connected: settings.connected, email: settings.connected ? settings.email : null,
          planType: settings.connected ? settings.planType : null,
          authMode: settings.connected ? 'chatgpt' : null, pendingLogin: false, loginError: null
        },
        models: settings.models,
        actions: [{ id: 'survey.generate', label: 'Survey generation', defaultReasoningEffort: 'medium' }],
        adminDefaults: { codexModel: null, codexReasoningEffort: null, codexActionOverrides: {}, updatedAt: null },
        effectiveConfiguration: { default: resolveFor(null), actions: { 'survey.generate': resolveFor('survey.generate') } },
        selectedModel: resolveFor(null).model.value,
        error: null
      }
    };
  }

  function jobView(job, now) {
    const base = job.restartedAt || job.queuedAt;
    const elapsed = now - base;
    const completedAt = base + settings.completionDelayMs;
    const completed = elapsed >= settings.completionDelayMs;
    const processing = !completed && elapsed >= settings.processingDelayMs;
    const provider = settings.providerOverride || 'codex';
    const model = settings.modelOverride || job.snapshot.model.value;
    const effort = settings.effortOverride || job.snapshot.reasoningEffort.value;
    const updatedAt = completed ? completedAt : processing ? base + settings.processingDelayMs : base;
    const view = {
      id: job.id, spaceId: 'space-acceptance', kind: 'survey.generate', surveyId: null, responseId: null,
      requestedBy: 'user-acceptance',
      state: completed ? 'completed' : processing ? 'processing' : 'queued',
      stage: completed ? 'completed' : processing ? 'running_ai' : job.recovered ? 'recovered_after_restart' : 'queued',
      progress: completed ? 100 : processing ? 35 : 0,
      attempt: job.attempt, input: {}, error: null, retryAt: null,
      createdAt: new Date(job.queuedAt).toISOString(),
      startedAt: processing || completed ? new Date(base + settings.processingDelayMs).toISOString() : null,
      completedAt: completed ? new Date(completedAt).toISOString() : null,
      updatedAt: new Date(updatedAt).toISOString(),
      result: null,
      runtime: {
        source: completed ? 'provider_result' : 'job_snapshot',
        status: completed ? 'actual' : 'planned',
        provider, providerLabel: provider === 'codex' ? 'ChatGPT / Codex' : 'Local AI runtime',
        model, reasoningEffort: effort, actionId: 'survey.generate'
      }
    };
    if (completed) {
      view.result = {
        output: { survey: { id: job.surveyId, title: 'Acceptance survey' }, collector: { id: `${job.surveyId}-collector` } },
        runtime: {
          provider: provider === 'codex' ? 'openai-codex' : 'terra',
          providerLabel: provider === 'codex' ? 'ChatGPT / Codex' : 'Local AI runtime',
          engine: settings.engineOverride || 'codex-app-server',
          model, reasoningEffort: effort, action: 'survey.generate',
          requestId: job.id, planType: settings.planType
        }
      };
    }
    return view;
  }

  function send(response, status, payload, headers = {}) {
    const body = payload === null ? '' : JSON.stringify(payload);
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(body);
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => send(response, 500, { error: 'fake api failure' }));
  });

  async function handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = request.method;
    state.requestIds.push(request.headers['x-request-id'] || null);
    const body = await readBody(request);
    const cookie = String(request.headers.cookie || '');
    const token = (cookie.match(/seemplify_session=([^;]+)/u) || [])[1] || '';
    const authenticated = state.sessions.has(token);
    const now = Date.now();

    if (pathname === '/health') {
      return send(response, 200, { status: 'ok', service: 'seemplify-experience', database: 'sqlite', databaseReady: true, at: new Date(now).toISOString() });
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      if (!body || body.email !== settings.email || body.password !== settings.password) {
        return send(response, 401, { error: 'Email or password is incorrect.' });
      }
      const issued = crypto.randomUUID();
      state.sessions.add(issued);
      return send(response, 200, { authenticated: true, email: settings.email, activeSpace: { id: 'space-acceptance' } },
        { 'set-cookie': `seemplify_session=${issued}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400` });
    }
    if (pathname === '/api/auth/session') {
      return authenticated
        ? send(response, 200, { authenticated: true, email: settings.email, activeSpace: { id: 'space-acceptance' } })
        : send(response, 200, { authenticated: false, email: null, activeSpace: null });
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      state.sessions.delete(token);
      return send(response, 204, null, { 'set-cookie': 'seemplify_session=; Path=/; Max-Age=0' });
    }
    if (!authenticated && !settings.allowSignedOutReads) {
      return send(response, 401, { error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    }
    if (pathname === '/api/runtime') {
      return send(response, 200, { worker: { running: true, active: 0, queued: 0, concurrency: 4 } });
    }
    if (pathname === '/api/ai-provider' && method === 'GET') return send(response, 200, providerState());
    if (pathname === '/api/ai-provider' && method === 'PATCH') {
      state.patches.push(body);
      if (!body || body.provider !== 'codex') return send(response, 409, { error: 'Codex is required.', code: 'CODEX_NOT_CONNECTED' });
      const overrides = body.codexActionOverrides || {};
      for (const override of Object.values(overrides)) {
        const definition = settings.models.find((model) => model.id === override.model);
        if (override.model && !definition) {
          return send(response, 409, { error: 'Unknown model.', code: 'CODEX_MODEL_UNAVAILABLE' });
        }
        if (override.reasoningEffort && definition && !advertisedEfforts(definition).includes(override.reasoningEffort)) {
          return send(response, 409, { error: 'Unsupported effort.', code: 'CODEX_REASONING_EFFORT_UNAVAILABLE' });
        }
      }
      state.preference = {
        ...state.preference,
        codexModel: body.codexModel ?? null,
        codexReasoningEffort: body.codexReasoningEffort ?? null,
        codexActionOverrides: overrides,
        updatedAt: new Date(now).toISOString()
      };
      return send(response, 200, providerState());
    }
    if (pathname.startsWith('/api/ai-provider/codex/device-login')) {
      state.deviceLoginCalls += 1;
      return send(response, 200, { connected: false, loginId: 'unexpected', verificationUrl: 'https://example.invalid', userCode: 'NOPE' });
    }
    if (pathname === '/api/ai/surveys' && method === 'POST') {
      const id = crypto.randomUUID();
      state.jobs.set(id, {
        id, queuedAt: now, restartedAt: null, recovered: false, attempt: 1,
        surveyId: crypto.randomUUID(), snapshot: resolveFor('survey.generate')
      });
      return send(response, 202, { jobId: id, state: 'queued', statusUrl: `/api/ai/jobs/${id}` });
    }
    if (pathname.startsWith('/api/ai/jobs/') && method === 'GET') {
      const job = state.jobs.get(pathname.slice('/api/ai/jobs/'.length));
      if (!job) return send(response, 404, { error: 'AI job not found.' });
      return send(response, 200, jobView(job, now));
    }
    if (pathname.startsWith('/api/surveys/') && method === 'DELETE') {
      state.surveysRemoved.push(pathname.slice('/api/surveys/'.length));
      return send(response, 204, null);
    }
    return send(response, 404, { error: 'not found in fake api' });
  }

  let port = 0;
  const api = {
    get port() { return port; },
    get state() { return state; },
    settings,
    async start() {
      await new Promise((resolve) => { server.listen(port, '127.0.0.1', resolve); });
      port = server.address().port;
      running.add(api);
      return api;
    },
    async stop() {
      running.delete(api);
      if (!server.listening) return;
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
    /** Imitates the backend restart: in-flight jobs are requeued for recovery. */
    async restartWithDowntime(downMs = 120) {
      state.restarts += 1;
      const now = Date.now();
      for (const job of state.jobs.values()) {
        const view = jobView(job, now);
        if (view.state !== 'processing') continue;
        job.restartedAt = now;
        job.recovered = true;
        job.attempt += 1;
      }
      await api.stop();
      setTimeout(() => { server.listen(port, '127.0.0.1'); running.add(api); }, downMs).unref();
    }
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Harness wiring for the fake API                                     */
/* ------------------------------------------------------------------ */

function testOptions(api, overrides = {}) {
  return {
    baseUrl: `http://127.0.0.1:${api.port}`,
    baseUrlHost: `127.0.0.1:${api.port}`,
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    spaceId: null,
    runtimeDir: FAKE_RUNTIME_DIR,
    evidenceDir: FAKE_EVIDENCE_DIR,
    requestedModel: null,
    requestedEffort: null,
    restart: { mode: 'command', command: 'fake restart' },
    timeouts: { jobMs: 20_000, signedOutWindowMs: 120, restartMs: 6_000, pollMs: 10, requestMs: 5_000 },
    checkpoint: { file: null, minimumHours: CHECKPOINT_ABSOLUTE_MINIMUM_HOURS },
    ...overrides
  };
}

function testDeps(api, overrides = {}) {
  return {
    fetchImpl: (...args) => fetch(...args),
    statDirectory: () => ({ isDirectory: true, ino: '4242', birthtimeMs: 1_700_000_000_000 }),
    restart: () => api.restartWithDowntime(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    log: () => {},
    ...overrides
  };
}

async function runAgainstFake(configuration = {}, optionOverrides = {}, depOverrides = {}) {
  const api = await createFakeExperienceApi(configuration).start();
  try {
    const report = await runAcceptance({
      options: testOptions(api, optionOverrides),
      deps: testDeps(api, depOverrides)
    });
    return { api, report };
  } finally {
    await api.stop();
  }
}

function phaseOf(report, id) {
  return report.phases.find((phase) => phase.id === id);
}

/* ------------------------------------------------------------------ */
/* Opt-in gate                                                         */
/* ------------------------------------------------------------------ */

function completeEnvironment(overrides = {}) {
  return {
    [OPT_IN_VARIABLE]: OPT_IN_VALUE,
    SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL: 'http://127.0.0.1:5410',
    SEEMPLIFY_CODEX_ACCEPTANCE_EMAIL: OPERATOR_EMAIL,
    SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD: OPERATOR_PASSWORD,
    SEEMPLIFY_CODEX_ACCEPTANCE_RUNTIME_DIR: FAKE_RUNTIME_DIR,
    SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE: 'manual',
    SEEMPLIFY_CODEX_ACCEPTANCE_EVIDENCE_DIR: FAKE_EVIDENCE_DIR,
    ...overrides
  };
}

function refusalCode(environment) {
  try {
    resolveHarnessOptions(environment, {});
    return null;
  } catch (error) {
    assert.ok(error instanceof AcceptanceError, 'expected an AcceptanceError');
    return error.code;
  }
}

test('the harness refuses to run unless an operator opts in explicitly', () => {
  assert.equal(refusalCode({}), 'OPT_IN_REQUIRED');
  assert.equal(refusalCode(completeEnvironment({ [OPT_IN_VARIABLE]: 'yes' })), 'OPT_IN_REQUIRED');
  assert.equal(refusalCode(completeEnvironment({ CI: 'true' })), 'CI_ENVIRONMENT_REFUSED');
  assert.equal(refusalCode(completeEnvironment({ GITHUB_ACTIONS: '1' })), 'CI_ENVIRONMENT_REFUSED');
  assert.equal(refusalCode(completeEnvironment({ NODE_ENV: 'test' })), 'TEST_ENVIRONMENT_REFUSED');
  assert.equal(
    refusalCode(completeEnvironment({ CODEX_CLI_PATH: 'backend/test/fixtures/fake-codex-app-server.js' })),
    'FIXTURE_CLI_REFUSED'
  );
});

test('the harness refuses to run without every capability it needs', () => {
  assert.equal(refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL: '' })), 'BASE_URL_REQUIRED');
  assert.equal(refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL: 'ftp://host' })), 'BASE_URL_INVALID');
  assert.equal(
    refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL: 'http://user:pass@127.0.0.1:5410' })),
    'BASE_URL_INVALID'
  );
  assert.equal(refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD: '' })), 'CREDENTIALS_REQUIRED');
  assert.equal(refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_RUNTIME_DIR: '' })), 'RUNTIME_DIR_REQUIRED');
  assert.equal(refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE: '' })), 'RESTART_MODE_REQUIRED');
  assert.equal(
    refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE: 'command' })),
    'RESTART_COMMAND_REQUIRED'
  );
  assert.equal(
    refusalCode(completeEnvironment({ SEEMPLIFY_CODEX_ACCEPTANCE_SIGNED_OUT_WINDOW_MS: '5' })),
    'OPTION_INVALID'
  );

  const options = resolveHarnessOptions(completeEnvironment(), {});
  assert.equal(options.baseUrl, 'http://127.0.0.1:5410');
  assert.equal(options.restart.mode, 'manual');
  assert.equal(options.timeouts.signedOutWindowMs, 90_000);
  assert.equal(options.checkpoint.minimumHours, CHECKPOINT_ABSOLUTE_MINIMUM_HOURS);
});

test('the harness never writes beside credential material', () => {
  assert.throws(() => assertHarnessFilePath(path.join(FAKE_RUNTIME_DIR, 'evidence.json'), { runtimeDir: FAKE_RUNTIME_DIR }),
    (error) => error.code === 'HARNESS_PATH_REFUSED');
  assert.throws(() => assertHarnessFilePath(path.join(FAKE_EVIDENCE_DIR, 'auth.json'), { runtimeDir: FAKE_RUNTIME_DIR }),
    (error) => error.code === 'HARNESS_PATH_REFUSED');
  assert.throws(() => assertHarnessFilePath(path.join(FAKE_EVIDENCE_DIR, 'session-secret'), { runtimeDir: FAKE_RUNTIME_DIR }),
    (error) => error.code === 'HARNESS_PATH_REFUSED');
  assert.ok(assertHarnessFilePath(path.join(FAKE_EVIDENCE_DIR, 'expiry-checkpoint-state.json'), { runtimeDir: FAKE_RUNTIME_DIR }));
});

/* ------------------------------------------------------------------ */
/* Fixture and model selection                                         */
/* ------------------------------------------------------------------ */

test('the repository fake App Server is rejected, never accepted as live proof', () => {
  assert.throws(() => assertLiveAccount({ email: 'codex@example.test', connected: true }),
    (error) => error.code === 'FAKE_APP_SERVER_DETECTED');
  assert.throws(() => assertLiveAccount({ email: 'someone@example.com', connected: true }),
    (error) => error.code === 'FAKE_APP_SERVER_DETECTED');
  assert.throws(() => assertLiveModelCatalog(FIXTURE_MODEL_IDS.map((id) => ({ id, displayName: id }))),
    (error) => error.code === 'FAKE_APP_SERVER_DETECTED');
  assert.throws(() => assertLiveModelCatalog([{ id: 'gpt-mock-codex', displayName: 'Mock' }]),
    (error) => error.code === 'FAKE_APP_SERVER_DETECTED');
  assert.ok(assertLiveAccount({ email: OPERATOR_EMAIL, connected: true }));
  assert.ok(assertLiveModelCatalog(LIVE_LOOKING_MODELS));
});

test('the chosen model and effort avoid the account defaults where possible', () => {
  const chosen = chooseModelAndEffort(LIVE_LOOKING_MODELS, {});
  assert.equal(chosen.selection, 'non_default');
  assert.notDeepEqual([chosen.model, chosen.reasoningEffort], ['gpt-5.1-codex', 'medium']);

  const requested = chooseModelAndEffort(LIVE_LOOKING_MODELS,
    { requestedModel: 'gpt-5.1-codex-mini', requestedEffort: 'medium' });
  assert.deepEqual([requested.model, requested.reasoningEffort, requested.selection],
    ['gpt-5.1-codex-mini', 'medium', 'requested']);

  assert.throws(() => chooseModelAndEffort(LIVE_LOOKING_MODELS, { requestedModel: 'gpt-not-real' }),
    (error) => error.code === 'CODEX_MODEL_UNAVAILABLE');
  assert.throws(() => chooseModelAndEffort(LIVE_LOOKING_MODELS,
    { requestedModel: 'gpt-5.1-codex-mini', requestedEffort: 'high' }),
  (error) => error.code === 'CODEX_REASONING_EFFORT_UNAVAILABLE');
  assert.throws(() => chooseModelAndEffort([], {}), (error) => error.code === 'CODEX_MODEL_UNAVAILABLE');
});

/* ------------------------------------------------------------------ */
/* Expiry and refresh checkpoint                                       */
/* ------------------------------------------------------------------ */

const HOUR = 3_600_000;

test('the expiry checkpoint can never pass on the day it was armed', () => {
  const armedAt = Date.parse('2026-08-08T00:05:00.000Z');
  const state = createCheckpointState({
    now: armedAt, runId: 'run', host: '127.0.0.1:5410', accountFingerprint: 'abc', minimumHours: 20
  });

  for (const offsetHours of [0, 0.5, 6, 19, 20]) {
    const due = evaluateExpiryCheckpoint(state, armedAt + offsetHours * HOUR);
    assert.equal(due.due, false, `must not be due after ${offsetHours}h`);
  }
  // Twenty-one hours later is still the same UTC day, so it still cannot pass.
  const sameDay = evaluateExpiryCheckpoint(state, Date.parse('2026-08-08T23:59:59.000Z'));
  assert.equal(sameDay.due, false);
  assert.ok(sameDay.reasons.includes('SAME_UTC_DAY_AS_ARMING'));

  const nextDay = evaluateExpiryCheckpoint(state, armedAt + 21 * HOUR);
  assert.equal(nextDay.due, true, 'a different UTC day past the minimum wait is due');
  assert.deepEqual(nextDay.reasons, []);

  assert.equal(evaluateExpiryCheckpoint(state, armedAt - HOUR).reasons.includes('CLOCK_MOVED_BACKWARDS'), true);
  assert.deepEqual(evaluateExpiryCheckpoint({ harness: 'wrong' }, armedAt).reasons, ['CHECKPOINT_STATE_INVALID']);
});

test('the expiry checkpoint refuses same-day verification against the fake API', async () => {
  const api = await createFakeExperienceApi().start();
  try {
    const now = Date.now();
    const state = createCheckpointState({
      now, runId: 'run', host: `127.0.0.1:${api.port}`, accountFingerprint: 'abc', minimumHours: 20
    });
    const report = await verifyExpiryCheckpoint({ options: testOptions(api), state, deps: testDeps(api) });
    assert.equal(report.passed, false);
    assert.equal(report.failure.code, 'EXPIRY_CHECKPOINT_NOT_DUE');
    assert.equal(report.live, false);
    assert.equal(api.state.jobs.size, 0, 'no live job may run before the boundary');
  } finally {
    await api.stop();
  }
});

test('the expiry checkpoint verifies once the boundary has passed', async () => {
  const api = await createFakeExperienceApi().start();
  try {
    const armedAt = Date.now() - 26 * HOUR;
    const state = createCheckpointState({
      now: armedAt, runId: 'run', host: `127.0.0.1:${api.port}`, accountFingerprint: null, minimumHours: 20
    });
    state.accountFingerprint = null;
    const report = await verifyExpiryCheckpoint({ options: testOptions(api), state, deps: testDeps(api) });
    // The armed fingerprint deliberately does not match, so the run must fail.
    assert.equal(report.passed, false);
    assert.equal(report.failure.code, 'CHATGPT_ACCOUNT_CHANGED');
  } finally {
    await api.stop();
  }
});

/* ------------------------------------------------------------------ */
/* Full harness against the fake API                                   */
/* ------------------------------------------------------------------ */

test('the whole harness passes against the fake API and marks the run as not live', async () => {
  const { api, report } = await runAgainstFake();

  assert.equal(report.status, 'passed', JSON.stringify(report.failure));
  assert.equal(report.mode, 'self-test');
  assert.equal(report.live, false);
  assert.match(report.proves, /NOT evidence of live/u);
  assert.match(evidenceFilename(report), /self-test/u);
  assert.deepEqual(report.phases.map((phase) => phase.id), [
    'readiness', 'device_status', 'model_catalog', 'foreground_job', 'signed_out_job', 'backend_restart'
  ]);
  assert.ok(report.phases.every((phase) => phase.status === 'passed'));
  assert.ok(report.phases.every((phase) => phase.checks.every((entry) => entry.ok)));

  assert.equal(report.requestIds.allUnique, true);
  assert.ok(report.requestIds.issued > 10);
  const observed = api.state.requestIds.filter(Boolean);
  assert.equal(observed.length, api.state.requestIds.length, 'every request carried an x-request-id');
  assert.equal(new Set(observed).size, observed.length, 'request ids were unique on the wire');

  const foreground = phaseOf(report, 'foreground_job');
  assert.equal(foreground.data.chosenSelection, 'non_default');
  assert.equal(foreground.data.runtime.model, foreground.data.chosenModel);
  assert.equal(foreground.data.runtime.reasoningEffort, foreground.data.chosenReasoningEffort);
  assert.equal(foreground.data.runtime.provider, 'codex');
  assert.equal(foreground.data.runtime.status, 'actual');
  assert.equal(foreground.data.runtime.requestIdMatchesJobId, true);
  assert.equal(foreground.data.generatedSurveyRemoved, true);

  const signedOut = phaseOf(report, 'signed_out_job');
  assert.ok(signedOut.data.signedOutProbes > 0);
  assert.ok(signedOut.data.completedAfterLogoutMs > 0);

  const restart = phaseOf(report, 'backend_restart');
  assert.equal(restart.data.recoveredAfterRestartObserved, true);
  assert.equal(api.state.restarts, 1);

  assert.equal(api.state.deviceLoginCalls, 0, 'the harness must never start a device login');
  assert.equal(api.state.surveysRemoved.length, 3, 'every generated survey is cleaned up');
  assert.equal(report.restoredPreference, true);
  assert.deepEqual(api.state.preference.codexActionOverrides, {}, 'the workspace override is restored');
});

test('a local Terra result fails the run instead of counting as acceptance', async () => {
  const { report } = await runAgainstFake({ providerOverride: 'terra' });
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.phase, 'foreground_job');
  assert.equal(report.failure.code, 'CODEX_RUNTIME_REQUIRED');
});

test('a fixture App Server catalog or account fails the run', async () => {
  const catalog = await runAgainstFake({
    models: [{
      id: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false, isDefault: true,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }]
    }]
  });
  assert.equal(catalog.report.status, 'failed');
  assert.equal(catalog.report.failure.phase, 'model_catalog');
  assert.equal(catalog.report.failure.code, 'FAKE_APP_SERVER_DETECTED');

  const account = await runAgainstFake({ email: 'codex@example.test' });
  assert.equal(account.report.status, 'failed');
  assert.equal(account.report.failure.phase, 'device_status');
  assert.equal(account.report.failure.code, 'FAKE_APP_SERVER_DETECTED');
});

test('a job that ignores the chosen model or effort fails the run', async () => {
  const model = await runAgainstFake({ modelOverride: 'gpt-5.1-codex' });
  assert.equal(model.report.failure.code, 'CODEX_MODEL_MISMATCH');

  const effort = await runAgainstFake({ effortOverride: 'high' });
  assert.equal(effort.report.failure.code, 'CODEX_EFFORT_MISMATCH');

  const engine = await runAgainstFake({ engineOverride: 'something-else' });
  assert.equal(engine.report.failure.code, 'CODEX_ENGINE_UNEXPECTED');
});

test('a backend that still answers a signed-out reader fails the run', async () => {
  const { report } = await runAgainstFake({ allowSignedOutReads: true });
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.phase, 'readiness');
  assert.equal(report.failure.code, 'AUTHENTICATION_NOT_ENFORCED');
});

test('an unobserved restart or a replaced runtime directory fails the run', async () => {
  const unobserved = await runAgainstFake({}, { timeouts: {
    jobMs: 20_000, signedOutWindowMs: 120, restartMs: 400, pollMs: 10, requestMs: 5_000
  } }, { restart: () => Promise.resolve({ triggered: 'command' }) });
  assert.equal(unobserved.report.failure.phase, 'backend_restart');
  assert.equal(unobserved.report.failure.code, 'RESTART_NOT_OBSERVED');

  let calls = 0;
  const replaced = await runAgainstFake({}, {}, {
    statDirectory: () => {
      calls += 1;
      return { isDirectory: true, ino: `ino-${calls > 2 ? 'new' : 'original'}`, birthtimeMs: 1_700_000_000_000 };
    }
  });
  assert.equal(replaced.report.failure.phase, 'backend_restart');
  assert.equal(replaced.report.failure.code, 'RUNTIME_DIR_CHANGED');
});

/* ------------------------------------------------------------------ */
/* Evidence and source guarantees                                      */
/* ------------------------------------------------------------------ */

test('evidence is redacted and carries no secret, account, or absolute path', async () => {
  const { report } = await runAgainstFake();
  const serialized = JSON.stringify(report);
  for (const secret of [OPERATOR_EMAIL, OPERATOR_PASSWORD, FAKE_RUNTIME_DIR, FAKE_EVIDENCE_DIR, 'seemplify_session']) {
    assert.equal(serialized.includes(secret), false, `evidence leaked ${secret}`);
  }
  assert.ok(assertRedactedEvidence(report, [OPERATOR_EMAIL, OPERATOR_PASSWORD]));

  assert.throws(() => assertRedactedEvidence({ note: `signed in as ${OPERATOR_EMAIL}` }, [OPERATOR_EMAIL]),
    (error) => error.code === 'EVIDENCE_NOT_REDACTED');
  assert.throws(() => assertRedactedEvidence({ note: 'C:\\Users\\operator\\auth.json' }, []),
    (error) => error.code === 'EVIDENCE_NOT_REDACTED');
  assert.throws(() => assertRedactedEvidence({ note: '/home/operator/.codex' }, []),
    (error) => error.code === 'EVIDENCE_NOT_REDACTED');
  // A URL must not be mistaken for a Windows drive letter.
  assert.ok(assertRedactedEvidence({ note: 'https://127.0.0.1:5410 refused the request' }, []));
});

test('the harness cannot touch the filesystem, spawn processes, or start a login', () => {
  const core = fs.readFileSync(path.join(scriptDir, 'codex-live-acceptance-core.mjs'), 'utf8');
  assert.equal(/from 'node:fs'|require\('node:fs'\)/u.test(core), false, 'the core must not import node:fs');
  assert.equal(/from 'node:child_process'/u.test(core), false, 'the core must not import node:child_process');

  const sources = [
    'codex-live-acceptance-core.mjs',
    'codex-live-acceptance-runtime.mjs',
    'codex-live-acceptance.mjs',
    'codex-live-expiry-checkpoint.mjs'
  ].map((file) => fs.readFileSync(path.join(scriptDir, file), 'utf8'));

  for (const source of sources) {
    assert.equal(/device-login/u.test(source), false, 'no script may start or cancel a ChatGPT sign-in');
    assert.equal(/auth\.json|admin-password|session-secret|service-secret/u.test(source), false,
      'no script may reference credential files');
    assert.equal(/chromium|playwright|puppeteer|openBrowser/u.test(source), false, 'no script may drive a browser');
  }

  const runtime = fs.readFileSync(path.join(scriptDir, 'codex-live-acceptance-runtime.mjs'), 'utf8');
  const reads = runtime.match(/fs\.[A-Za-z]+/gu) || [];
  assert.deepEqual([...new Set(reads)].sort(),
    ['fs.existsSync', 'fs.mkdirSync', 'fs.readFileSync', 'fs.statSync', 'fs.writeFileSync'],
    'the runtime helper uses only its own narrow filesystem surface');
});
