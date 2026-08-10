import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AcceptanceApi, BACKGROUND_SESSION_FREE_MIN_MS, DEVICE_FLOW_OPT_IN, LIVE_OPT_IN, REFRESH_WAIT_MS,
  appendEvidence, assertLiveGate, digest, readEvidence, runPhase, safeEvidence,
  selectLiveModel } from './chatgpt-codex-live-acceptance.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-live-harness-'));
let server; let baseUrl; let connected = true; let jobSequence = 0; const jobs = new Map();
const realLookingModel = { id: 'gpt-5-codex', displayName: 'GPT-5 Codex', hidden: false, isDefault: true,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] };
const state = () => ({ preference: { provider: 'codex', effectiveProvider: 'codex' }, codex: { available: true,
  account: { connected, authMode: connected ? 'chatgpt' : null, email: connected ? 'person@example.invalid' : null },
  models: connected ? [realLookingModel] : [], error: null } });

before(async () => {
  server = http.createServer((request, response) => {
    const send = (status, value, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
    let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/auth/login') return send(200, { authenticated: true }, { 'set-cookie': 'session=self-test; HttpOnly' });
      if (url.pathname === '/api/auth/logout') { response.writeHead(204, { 'set-cookie': 'session=; Max-Age=0' }); return response.end(); }
      if (url.pathname === '/api/ai-provider' && request.method === 'GET') return send(200, state());
      if (url.pathname === '/api/ai-provider' && request.method === 'PATCH') return send(200, state());
      if (url.pathname === '/api/ai-provider/codex/device-login') return send(200, { connected: false,
        loginId: 'self-test-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'SELF-TEST' });
      if (/^\/api\/surveys\/[^/]+\/ai\/ask$/u.test(url.pathname)) { const id = `job-${++jobSequence}`;
        jobs.set(id, { id, state: 'completed', completedAt: new Date().toISOString(), result: { runtime: {
          provider: 'openai-codex', engine: 'codex-app-server', model: realLookingModel.id, reasoningEffort: 'medium' } } });
        return send(202, { jobId: id, state: 'queued' }); }
      const match = /^\/api\/ai\/jobs\/(.+)$/u.exec(url.pathname); if (match && jobs.has(match[1])) return send(200, jobs.get(match[1]));
      return send(404, { error: 'self-test route missing' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });

test('ordinary and CI execution fail closed before network activity', () => {
  assert.throws(() => assertLiveGate({}), /Refusing live execution/u);
  assert.throws(() => assertLiveGate({ LIVE_CHATGPT_ACCEPTANCE: LIVE_OPT_IN, CI: 'true', CODEX_RUNTIME_DIR: 'x' }), /in CI/u);
  assert.throws(() => assertLiveGate({ LIVE_CHATGPT_ACCEPTANCE: LIVE_OPT_IN, CODEX_RUNTIME_DIR: 'x', CODEX_CLI_PATH: 'fake.js' }), /overrides/u);
});

test('synthetic catalogues and secret-shaped evidence are rejected', () => {
  assert.throws(() => selectLiveModel({ codex: { available: true, account: { connected: true, authMode: 'chatgpt' },
    models: [{ ...realLookingModel, id: 'gpt-test-codex' }] } }), /synthetic/u);
  assert.throws(() => safeEvidence({ phase: 'x', accessToken: 'never' }), /forbidden/u);
  assert.deepEqual(safeEvidence({ phase: 'x', requestSha256: 'a'.repeat(64) }), { phase: 'x', requestSha256: 'a'.repeat(64) });
});

test('HTTP harness carries a session cookie without exposing it', async () => {
  const api = new AcceptanceApi(baseUrl);
  await api.login('self-test@example.invalid', 'not-recorded'); assert.match(api.cookie, /^session=/u);
  await api.logout(); assert.equal(api.cookie, '');
});

test('self-test HTTP API validates readiness and foreground evidence logic only', async () => {
  const evidence = path.join(root, 'evidence.jsonl');
  const environment = { LIVE_CHATGPT_BASE_URL: baseUrl, CODEX_RUNTIME_DIR: path.join(root, 'runtime'),
    LIVE_BACKEND_INSTANCE_ID: 'self-test-instance', LIVE_APP_EMAIL: 'self-test@example.invalid',
    LIVE_APP_PASSWORD: 'not-recorded', LIVE_CHATGPT_SURVEY_ID: 'survey-self-test', LIVE_CHATGPT_EVIDENCE_FILE: evidence };
  const ready = await runPhase('readiness', environment, { testMode: true }); assert.equal(ready.status, 'passed');
  const foreground = await runPhase('foreground', environment, { testMode: true }); assert.equal(foreground.status, 'passed');
  const records = readEvidence(evidence); assert.deepEqual(records.map((item) => item.phase), ['readiness','foreground']);
  assert.ok(records.every((item) => item.proofClass === 'self_test_logic_only'));
  assert.ok(records.every((item) => !JSON.stringify(item).includes('not-recorded')));
});

test('device status needs a second opt-in and long-lived reuse remains a refresh candidate', async () => {
  assert.equal(REFRESH_WAIT_MS, 25 * 60 * 60 * 1000); connected = false;
  assert.equal(BACKGROUND_SESSION_FREE_MIN_MS, 60_000);
  const evidence = path.join(root, 'device-evidence.jsonl'); const environment = { LIVE_CHATGPT_BASE_URL: baseUrl,
    CODEX_RUNTIME_DIR: path.join(root, 'runtime-2'), LIVE_BACKEND_INSTANCE_ID: 'device-instance',
    LIVE_APP_EMAIL: 'self-test@example.invalid', LIVE_APP_PASSWORD: 'not-recorded',
    LIVE_CHATGPT_EVIDENCE_FILE: evidence };
  await assert.rejects(() => runPhase('readiness', environment, { testMode: true }), /separate device-flow opt-in/u);
  environment.LIVE_CHATGPT_START_DEVICE_FLOW = DEVICE_FLOW_OPT_IN;
  const result = await runPhase('readiness', environment, { testMode: true }); assert.equal(result.status, 'device_authorization_required');
  assert.equal(readEvidence(evidence)[0].status, 'device_authorization_required'); connected = true;
});

test('mature checkpoint records long-lived credential reuse as a candidate, never token refresh proof', async () => {
  const evidence = path.join(root, 'refresh-evidence.jsonl');
  const runtimeDirectory = path.join(root, 'runtime-refresh');
  appendEvidence(evidence, { schema: 'seemplify.chatgpt-codex-live-acceptance/v1',
    proofClass: 'self_test_logic_only', phase: 'refresh-prepare', status: 'checkpoint_prepared',
    claim: 'long_lived_credential_reuse', observedAt: '2020-01-01T00:00:00.000Z', requestSha256: 'a'.repeat(64),
    runtimeDirectorySha256: digest(path.resolve(runtimeDirectory)), instanceSha256: digest('previous-instance'),
    model: realLookingModel.id, effort: 'medium', modelCount: 1,
    notBefore: '2020-01-02T01:00:00.000Z', preparedDate: '2020-01-01' });
  const result = await runPhase('refresh-checkpoint', { LIVE_CHATGPT_BASE_URL: baseUrl, CODEX_RUNTIME_DIR: runtimeDirectory,
    LIVE_BACKEND_INSTANCE_ID: 'current-instance', LIVE_APP_EMAIL: 'self-test@example.invalid',
    LIVE_APP_PASSWORD: 'not-recorded', LIVE_CHATGPT_SURVEY_ID: 'survey-self-test',
    LIVE_CHATGPT_EVIDENCE_FILE: evidence }, { testMode: true });
  assert.equal(result.status, 'refresh_candidate'); assert.equal(result.claim, 'long_lived_credential_reuse');
  const serialized = JSON.stringify(readEvidence(evidence));
  assert.match(serialized, /long_lived_credential_reuse/u); assert.doesNotMatch(serialized, /token_refresh_proven/u);
});
