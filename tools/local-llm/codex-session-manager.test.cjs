'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');

const subjectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-subjects-'));
process.env.CODEX_SUBJECTS_DIR = subjectsRoot;
process.env.CODEX_CLI_PATH = path.join(__dirname, 'fake-codex-app-server.cjs');
process.env.CODEX_PER_USER_SESSIONS = 'true';
// A platform credential in the ambient environment must never survive into a
// per-user session; the fixture fails the launch contract if it does.
process.env.CODEX_API_KEY = 'platform-key-that-must-not-leak';
process.env.OPENAI_API_KEY = 'platform-key-that-must-not-leak';

const sessions = require('./codex-session-manager.cjs');
const { runCodexSubjectTurn } = require('./engine-adapters.cjs');

after(async () => {
  await sessions.stopAllSessions();
  fs.rmSync(subjectsRoot, { recursive: true, force: true });
});

const recruiterSubject = () => sessions.subjectKeyFor('recruiter', 'user-alpha');
const marker = (subjectKey) => JSON.parse(
  fs.readFileSync(path.join(subjectsRoot, subjectKey, 'fake-app-server.json'), 'utf8')
);

async function connect(subjectKey) {
  // Credentials persist in the subject's home, so a subject reused across
  // cases is already signed in — exactly as the real file store behaves.
  const login = await sessions.startDeviceLogin(subjectKey);
  if (login.connected) return sessions.accountStatusForSubject(subjectKey);
  assert.match(login.userCode, /TEST-CODE/u);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await sessions.accountStatusForSubject(subjectKey);
    if (status.connected) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the fake device login never completed');
}

beforeEach(async () => { await sessions.stopAllSessions(); });

test('subject keys are namespaced per source application and never collide', () => {
  const recruiter = sessions.subjectKeyFor('recruiter', 'user-1');
  const experience = sessions.subjectKeyFor('experience', 'user-1');
  assert.notEqual(recruiter, experience, 'one product must not reach another product session');
  assert.match(recruiter, /^[a-f0-9]{64}$/u);
  assert.equal(sessions.subjectKeyFor('RECRUITER', 'user-1'), recruiter, 'app names are case-insensitive');
  // Concatenated parts must not alias: ('ab','c') and ('a','bc') are different subjects.
  assert.notEqual(sessions.subjectKeyFor('ab', 'c'), sessions.subjectKeyFor('a', 'bc'));
  assert.throws(() => sessions.subjectKeyFor('', 'user-1'), /source application/u);
  assert.throws(() => sessions.subjectKeyFor('recruiter', ''), /subject identifier/u);
  assert.throws(() => sessions.sessionForSubject('not-a-digest'), /sha256 digest/u);
});

test('a subject claim is validated against a closed source-app allowlist', () => {
  assert.deepEqual([...sessions.allowedSourceApps({})], ['recruiter']);
  assert.deepEqual(
    [...sessions.allowedSourceApps({ CODEX_SUBJECT_SOURCE_APPS: 'recruiter, Experience ,,crm' })],
    ['recruiter', 'experience', 'crm']
  );

  const accepted = sessions.resolveSubjectRequest({ sourceApp: 'Recruiter', subjectId: 'user-1' });
  assert.equal(accepted.subjectKey, sessions.subjectKeyFor('recruiter', 'user-1'));
  assert.equal(accepted.error, undefined);

  // An unlisted product must not be able to open a namespace of its own.
  assert.deepEqual(
    sessions.resolveSubjectRequest({ sourceApp: 'attacker', subjectId: 'user-1' }).error,
    { status: 403, code: 'CODEX_SOURCE_APP_NOT_ALLOWED' }
  );
  for (const subjectId of ['', '   ', 'x'.repeat(201), `bad${String.fromCharCode(0)}id`, `bad${String.fromCharCode(10)}id`]) {
    assert.deepEqual(
      sessions.resolveSubjectRequest({ sourceApp: 'recruiter', subjectId }).error,
      { status: 400, code: 'CODEX_SUBJECT_INVALID' },
      `subject ${JSON.stringify(subjectId)} must be refused`
    );
  }
  // Validation reports rather than throws, so a bad claim is a status code.
  assert.doesNotThrow(() => sessions.resolveSubjectRequest(null));
  assert.doesNotThrow(() => sessions.resolveSubjectRequest({}));
});

test('the launch contract carries every credential and sandbox guarantee', () => {
  const args = sessions.subjectLaunchArgs('/tmp/subject-home', '/tmp/codex.js');
  // Without a file credential store the CLI uses the machine-wide OS keychain
  // and every user on the host shares one ChatGPT login.
  assert.ok(args.includes('cli_auth_credentials_store="file"'));
  assert.ok(args.includes('default_permissions="seemplify-read-only"'));
  assert.ok(args.includes('permissions.seemplify-read-only.network.enabled=false'));
  assert.ok(args.includes('history.persistence="none"'));
  assert.ok(args.includes('shell_environment_policy.inherit="none"'));
  const filesystem = args.find((entry) => entry.startsWith('permissions.seemplify-read-only.filesystem='));
  assert.ok(filesystem.includes('":root"="deny"'));
  assert.ok(filesystem.includes('auth.json"="deny"'), 'the model must not read its own credentials');
  assert.deepEqual(args.slice(-3), ['app-server', '--listen', 'stdio://']);
});

test('platform API keys are stripped from a per-user session environment', () => {
  const env = sessions.subjectChildEnv('/tmp/subject-home', {
    PATH: '/usr/bin',
    CODEX_API_KEY: 'platform-key',
    OPENAI_API_KEY: 'platform-key',
    OPENAI_BASE_URL: 'https://example.invalid',
    LOCAL_LLM_SHARED_SECRET: 'gateway-secret'
  });
  assert.equal(env.CODEX_HOME, '/tmp/subject-home');
  assert.equal(env.PATH, '/usr/bin');
  for (const forbidden of ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'LOCAL_LLM_SHARED_SECRET']) {
    assert.equal(env[forbidden], undefined, `${forbidden} must not reach the model process`);
  }
});

test('two subjects never share a credential home and cannot see each other', async () => {
  const alpha = sessions.subjectKeyFor('recruiter', 'user-alpha');
  const beta = sessions.subjectKeyFor('recruiter', 'user-beta');
  await connect(alpha);
  const betaStatus = await sessions.accountStatusForSubject(beta);
  assert.equal(betaStatus.connected, false, 'one connection must not authenticate another subject');

  assert.ok(fs.existsSync(path.join(subjectsRoot, alpha, 'auth.json')));
  assert.ok(!fs.existsSync(path.join(subjectsRoot, beta, 'auth.json')));
  assert.equal(marker(alpha).codexHome, path.join(subjectsRoot, alpha));
  assert.equal(marker(beta).codexHome, path.join(subjectsRoot, beta));
  assert.equal(marker(alpha).leakedSecret, null, 'a platform key reached the per-user process');
});

test('a turn runs on the subject session and returns the shared Codex envelope', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const output = await runCodexSubjectTurn({
    codexSubject: subjectKey,
    codexModel: 'gpt-test-codex',
    reasoningEffort: 'high',
    messages: [{ role: 'user', content: 'Summarise this candidate.' }],
    timeoutMs: 10_000
  }, {});

  assert.equal(output.engine, 'codex');
  assert.equal(output.model, 'gpt-test-codex');
  assert.equal(output.runtimeOwner, 'user', 'personal-plan usage must be separable from platform usage');
  assert.equal(output.planType, 'plus');
  assert.match(output.content, /fake completion/u);
  // Commentary phases are private reasoning and must never surface as the answer.
  assert.doesNotMatch(output.content, /thinking out loud/u);
  assert.equal(output.usageReported, true);
  assert.equal(output.usage.prompt_tokens, 11);
  assert.equal(output.usage.completion_tokens, 7);
  assert.ok(output.metrics.latencyMs >= 0);

  const observed = marker(subjectKey);
  assert.equal(observed.lastThreadStart.permissions, 'seemplify-read-only');
  assert.deepEqual(observed.lastThreadStart.runtimeWorkspaceRoots, [observed.lastThreadStart.cwd]);
  assert.equal(observed.lastTurnStart.effort, 'high');
});

test('a structured turn passes its schema through as the output contract', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['answer'], properties: { answer: { type: 'string' } }
  };
  const output = await runCodexSubjectTurn({
    codexSubject: subjectKey,
    codexModel: 'gpt-test-codex',
    reasoningEffort: 'medium',
    jsonSchema: schema,
    messages: [{ role: 'user', content: 'Return structured data.' }],
    timeoutMs: 10_000
  }, {});
  assert.deepEqual(output.data, { answer: 'fake structured completion' });
  assert.deepEqual(marker(subjectKey).lastTurnStart.outputSchema, schema);
});

test('turns on one subject are serialised rather than interleaved on shared stdio', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const turn = (index) => runCodexSubjectTurn({
    codexSubject: subjectKey,
    codexModel: 'gpt-test-codex',
    reasoningEffort: 'low',
    messages: [{ role: 'user', content: `request ${index}` }],
    timeoutMs: 10_000
  }, {});
  const outputs = await Promise.all([turn(1), turn(2), turn(3)]);
  assert.equal(outputs.length, 3);
  assert.equal(new Set(outputs.map((output) => output.id)).size, 3, 'each turn needs its own identity');
  assert.ok(outputs.every((output) => /fake completion/u.test(output.content)));
});

test('the model catalogue is paginated to exhaustion and hides unavailable models', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const models = await sessions.modelsForSubject(subjectKey);
  assert.deepEqual(models.map((model) => model.id), ['gpt-test-codex', 'gpt-test-codex-fast']);
});

test('resolution walks ordered candidates and reports the source that won', () => {
  const models = [
    {
      id: 'big', displayName: 'Big', isDefault: true, defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }]
    },
    { id: 'small', displayName: 'Small', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
    { id: 'hidden', displayName: 'Hidden', hidden: true, supportedReasoningEfforts: [] }
  ];

  // First candidate the account actually advertises wins.
  const preferred = sessions.resolveCodexConfiguration({
    models,
    modelCandidates: [{ value: 'small', source: 'admin_action' }, { value: 'big', source: 'admin_default' }],
    effortCandidates: [{ value: 'low', source: 'admin_action' }]
  });
  assert.equal(preferred.model, 'small');
  assert.equal(preferred.modelSource, 'admin_action');
  assert.equal(preferred.degraded, false);

  // A plan that lacks the administrator's choice degrades to its own default
  // rather than failing the request outright.
  const degraded = sessions.resolveCodexConfiguration({
    models,
    modelCandidates: [{ value: 'not-on-this-plan', source: 'admin_action' }],
    effortCandidates: [{ value: 'high', source: 'admin_action' }]
  });
  assert.equal(degraded.model, 'big', 'falls back to the account default model');
  assert.equal(degraded.modelSource, 'connected_model_default');
  assert.equal(degraded.reasoningEffort, 'high', 'the requested effort is supported by the fallback model');
  assert.equal(degraded.degraded, true);

  // An effort the chosen model does not advertise degrades to the model default.
  const effortDegraded = sessions.resolveCodexConfiguration({
    models,
    modelCandidates: [{ value: 'small', source: 'admin_action' }],
    effortCandidates: [{ value: 'high', source: 'admin_action' }]
  });
  assert.equal(effortDegraded.model, 'small');
  assert.equal(effortDegraded.reasoningEffort, 'low');
  assert.equal(effortDegraded.reasoningEffortSource, 'model_default');
  assert.equal(effortDegraded.degraded, true);

  // Hidden models are never selectable, even as a last resort.
  assert.throws(
    () => sessions.resolveCodexConfiguration({ models: [models[2]], modelCandidates: [], effortCandidates: [] }),
    (error) => error.code === 'CODEX_MODEL_UNAVAILABLE'
  );
  assert.deepEqual(sessions.supportedEfforts(models[1]), ['low']);
  assert.equal(sessions.safeConnectedModel(models).id, 'big');
});

test('an effort the connected plan cannot honour degrades instead of failing the turn', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const output = await runCodexSubjectTurn({
    codexSubject: subjectKey,
    codexModelCandidates: [{ value: 'gpt-test-codex-fast', source: 'admin_action' }],
    codexEffortCandidates: [{ value: 'high', source: 'admin_action' }],
    messages: [{ role: 'user', content: 'x' }],
    timeoutMs: 10_000
  }, {});
  assert.equal(output.model, 'gpt-test-codex-fast');
  assert.equal(output.reasoningEffort, 'low', 'the fast model only advertises low effort');
  assert.equal(output.reasoningEffortSource, 'model_default');
  assert.equal(output.degraded, true);
});

test('a model absent from the connected plan falls back to that account default', async () => {
  const subjectKey = recruiterSubject();
  await connect(subjectKey);
  const output = await runCodexSubjectTurn({
    codexSubject: subjectKey,
    codexModelCandidates: [{ value: 'gpt-5-not-on-this-plan', source: 'admin_action' }],
    codexEffortCandidates: [{ value: 'medium', source: 'admin_action' }],
    messages: [{ role: 'user', content: 'x' }],
    timeoutMs: 10_000
  }, {});
  assert.equal(output.model, 'gpt-test-codex');
  assert.equal(output.modelSource, 'connected_model_default');
  assert.equal(output.degraded, true);
});

test('a pending device sign-in is resumable rather than a dead end', async () => {
  // The person still has to type the code on OpenAI's site, so asking again
  // must hand back the code already issued instead of refusing.
  const subjectKey = sessions.subjectKeyFor('recruiter', 'user-resume');
  const first = await sessions.startDeviceLogin(subjectKey);
  if (first.connected) return; // already signed in from an earlier case
  assert.ok(first.userCode, 'the first attempt issues a code');

  const second = await sessions.startDeviceLogin(subjectKey);
  assert.equal(second.connected, false);
  assert.equal(second.resumed, true, 'a second attempt resumes rather than throwing');
  assert.equal(second.userCode, first.userCode, 'the same code is handed back');
  assert.equal(second.verificationUrl, first.verificationUrl);

  // Cancelling clears it so a fresh code can be issued.
  await sessions.cancelDeviceLogin(subjectKey);
  const status = await sessions.accountStatusForSubject(subjectKey);
  assert.equal(status.pendingLogin, false, 'cancelling clears the pending sign-in');
});

test('a turn on a subject with no connected account fails closed', async () => {
  const subjectKey = sessions.subjectKeyFor('recruiter', 'never-connected');
  await assert.rejects(runCodexSubjectTurn({
    codexSubject: subjectKey, codexModel: 'gpt-test-codex', reasoningEffort: 'medium',
    messages: [{ role: 'user', content: 'x' }], timeoutMs: 10_000
  }, {}), (error) => error.code === 'CODEX_NOT_CONNECTED');
});

test('per-user sessions stay off until a deployment opts in', async () => {
  assert.equal(sessions.perUserSessionsEnabled({}), false);
  assert.equal(sessions.perUserSessionsEnabled({ CODEX_PER_USER_SESSIONS: 'TRUE' }), true);
  const previous = process.env.CODEX_PER_USER_SESSIONS;
  process.env.CODEX_PER_USER_SESSIONS = 'false';
  try {
    const { runCodex } = require('./engine-adapters.cjs');
    await assert.rejects(runCodex({
      codexSubject: recruiterSubject(), messages: [{ role: 'user', content: 'x' }]
    }, {}), (error) => error.code === 'CODEX_PER_USER_DISABLED');
  } finally { process.env.CODEX_PER_USER_SESSIONS = previous; }
});

test('a crashed session recovers on the next request instead of wedging', async () => {
  const subjectKey = sessions.subjectKeyFor('recruiter', 'crash-victim');
  await connect(subjectKey);
  fs.writeFileSync(path.join(subjectsRoot, subjectKey, 'crash-during-turn'), '1');
  await assert.rejects(runCodexSubjectTurn({
    codexSubject: subjectKey, codexModel: 'gpt-test-codex', reasoningEffort: 'low',
    messages: [{ role: 'user', content: 'x' }], timeoutMs: 5_000
  }, {}));
  fs.rmSync(path.join(subjectsRoot, subjectKey, 'crash-during-turn'), { force: true });
  const recovered = await runCodexSubjectTurn({
    codexSubject: subjectKey, codexModel: 'gpt-test-codex', reasoningEffort: 'low',
    messages: [{ role: 'user', content: 'after the crash' }], timeoutMs: 10_000
  }, {});
  assert.match(recovered.content, /fake completion/u);
});

test('forgetting a subject removes the credential home that holds its refresh token', async () => {
  const subjectKey = sessions.subjectKeyFor('recruiter', 'forgettable');
  await connect(subjectKey);
  assert.ok(fs.existsSync(path.join(subjectsRoot, subjectKey, 'auth.json')));
  await sessions.forgetSubject(subjectKey);
  assert.ok(!fs.existsSync(path.join(subjectsRoot, subjectKey)), 'revocation must delete the stored credential');
  const status = await sessions.accountStatusForSubject(subjectKey);
  assert.equal(status.connected, false);
});

test('the session pool evicts the idlest session rather than growing without bound', async () => {
  const previous = process.env.CODEX_MAX_SUBJECT_SESSIONS;
  process.env.CODEX_MAX_SUBJECT_SESSIONS = '2';
  try {
    delete require.cache[require.resolve('./codex-session-manager.cjs')];
    const bounded = require('./codex-session-manager.cjs');
    const first = bounded.sessionForSubject(bounded.subjectKeyFor('recruiter', 'pool-1'));
    const second = bounded.sessionForSubject(bounded.subjectKeyFor('recruiter', 'pool-2'));
    const third = bounded.sessionForSubject(bounded.subjectKeyFor('recruiter', 'pool-3'));
    assert.notEqual(third.subjectKey, first.subjectKey);
    assert.notEqual(third.subjectKey, second.subjectKey);
    await bounded.stopAllSessions();
  } finally {
    process.env.CODEX_MAX_SUBJECT_SESSIONS = previous;
    delete require.cache[require.resolve('./codex-session-manager.cjs')];
  }
});
