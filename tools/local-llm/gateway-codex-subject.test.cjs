'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const sessions = require('./codex-session-manager.cjs');

const gatewayScript = path.join(__dirname, 'gateway.cjs');
const fakeCodexScript = path.join(__dirname, 'fake-codex-app-server.cjs');

function signRequest(secret, body, requestPath) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
    .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

async function waitForHealth(url) {
  // Booting a real gateway can be slow when other suites are running on the
  // same machine, so this waits well past the normal start time.
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      const response = await fetch(url);
      // This fixture deliberately selects an unavailable managed engine. A
      // 503 health response still proves the HTTP server is ready for the
      // per-user Codex control plane exercised below.
      if (response.status > 0) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`gateway never became healthy at ${url}`);
}

test('a per-user Codex turn runs even when the managed engine selection is not codex', async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-codex-subject-'));

  // The subject is already signed in: credentials persist in the file store,
  // so a pre-seeded auth.json is a connected account, exactly as the real CLI.
  const subjectsDir = path.join(runtimeDir, 'subjects');
  const subjectKey = sessions.subjectKeyFor('recruiter', 'subject-e2e');
  fs.mkdirSync(path.join(subjectsDir, subjectKey), { recursive: true });
  fs.writeFileSync(
    path.join(subjectsDir, subjectKey, 'auth.json'),
    JSON.stringify({ tokens: { fake: true } })
  );

  const secretFile = path.join(runtimeDir, 'service-secret');
  const controlSecretFile = path.join(runtimeDir, 'control-secret');
  const stateFile = path.join(runtimeDir, 'state.json');
  const secret = 'gateway-codex-subject-test-secret';
  fs.writeFileSync(secretFile, secret);
  fs.writeFileSync(controlSecretFile, 'gateway-codex-subject-control');
  // The regression condition: the administrator has selected a managed engine
  // that is not codex. Before the fix this made every per-user turn fail with
  // REQUIRED_RUNTIME_UNAVAILABLE even though it never uses the managed slot.
  fs.writeFileSync(stateFile, JSON.stringify({
    enabled: true,
    ingressEnabled: true,
    paused: false,
    concurrency: 8,
    autoStart: false,
    selectedEngine: 'claude',
    engines: { claude: { model: 'sonnet' } }
  }));

  const port = 20000 + (process.pid % 10000);
  const gateway = spawn(process.execPath, [gatewayScript], {
    env: {
      ...process.env,
      LOCAL_LLM_GATEWAY_PORT: String(port),
      LOCAL_LLM_SECRET_FILE: secretFile,
      LOCAL_LLM_CONTROL_SECRET_FILE: controlSecretFile,
      LOCAL_LLM_STATE_FILE: stateFile,
      LOCAL_LLM_LOG_FILE: path.join(runtimeDir, 'gateway.log'),
      LOCAL_LLM_NONCE_DIR: path.join(runtimeDir, 'nonces'),
      LOCAL_LLM_USAGE_OUTBOX_DIR: path.join(runtimeDir, 'usage-outbox'),
      LOCAL_LLM_EXECUTION_RECEIPT_DIR: path.join(runtimeDir, 'execution-receipts'),
      LOCAL_LLM_USAGE_INITIAL_DELAY_MS: '600000',
      CODEX_PER_USER_SESSIONS: 'true',
      CODEX_LOGIN_REQUESTS: '1',
      CODEX_CLI_PATH: fakeCodexScript,
      CODEX_SUBJECTS_DIR: subjectsDir,
      RECRUITER_BACKEND_URL: 'http://127.0.0.1:9'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let gatewayDiagnostics = '';
  gateway.stdout.on('data', (chunk) => { gatewayDiagnostics += String(chunk); });
  gateway.stderr.on('data', (chunk) => { gatewayDiagnostics += String(chunk); });
  t.after(async () => {
    // The gateway's codex child holds its workspace directory as cwd; it exits
    // on stdin EOF once the gateway dies, so removal is awaited with retries.
    const exited = new Promise((resolve) => gateway.once('exit', resolve));
    gateway.kill();
    await exited;
    fs.rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });
  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  } catch (error) {
    error.message += `\nGateway diagnostics:\n${gatewayDiagnostics.slice(-4_000)}`;
    throw error;
  }

  const loginBody = JSON.stringify({ sourceApp: 'recruiter', subjectId: 'login-recovery-e2e' });
  const postCodex = async (operation) => {
    const pathName = `/v1/codex/${operation}`;
    const response = await fetch(`http://127.0.0.1:${port}${pathName}`, {
      method: 'POST', headers: signRequest(secret, loginBody, pathName), body: loginBody
    });
    return { response, payload: await response.json() };
  };
  const firstLogin = await postCodex('login/start');
  assert.equal(firstLogin.response.status, 200);
  assert.ok(firstLogin.payload.userCode);
  const resumedLogin = await postCodex('login/start');
  assert.equal(resumedLogin.response.status, 200,
    'a pending code resumes even after the one-attempt allowance is used');
  assert.equal(resumedLogin.payload.resumed, true);
  assert.equal(resumedLogin.payload.userCode, firstLogin.payload.userCode);
  const resetLogin = await postCodex('login/reset');
  assert.equal(resetLogin.response.status, 200);
  assert.equal(resetLogin.payload.reset, true);
  const loginAfterReset = await postCodex('login/start');
  assert.equal(loginAfterReset.response.status, 200,
    'an explicit recovery clears the old attempt window');
  assert.ok(loginAfterReset.payload.userCode);

  const requestPath = '/v1/complete';
  const subjectBody = JSON.stringify({
    activity: 'job.description',
    executionMode: 'local-only',
    requestSource: 'gateway-integration-test',
    metering: { record: false, exclusion: 'harness' },
    timeoutMs: 30000,
    requiredEngine: 'codex',
    codexSourceApp: 'recruiter',
    codexSubjectId: 'subject-e2e',
    reasoningEffort: 'medium',
    messages: [{ role: 'user', content: 'Draft a one-line description for a QA engineer role.' }]
  });
  const subjectResponse = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
    method: 'POST',
    headers: signRequest(secret, subjectBody, requestPath),
    body: subjectBody,
    signal: AbortSignal.timeout(60_000)
  });
  const subjectPayload = await subjectResponse.json();
  assert.equal(subjectResponse.status, 200, JSON.stringify(subjectPayload).slice(0, 400));
  assert.equal(subjectPayload.engine, 'codex');
  assert.equal(subjectPayload.provider, 'chatgpt-codex');
  assert.equal(subjectPayload.runtimeOwner, 'user');
  assert.equal(subjectPayload.model, 'gpt-test-codex');
  assert.ok(String(subjectPayload.content || '').length > 0, 'the turn must produce content');

  // The managed guard is untouched: without a subject, an activity that
  // requires codex while claude is selected must still fail loudly.
  const managedBody = JSON.stringify({
    activity: 'job.description',
    executionMode: 'local-only',
    requestSource: 'gateway-integration-test',
    metering: { record: false, exclusion: 'harness' },
    timeoutMs: 30000,
    requiredEngine: 'codex',
    reasoningEffort: 'medium',
    messages: [{ role: 'user', content: 'Draft a one-line description for a QA engineer role.' }]
  });
  const managedResponse = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
    method: 'POST',
    headers: signRequest(secret, managedBody, requestPath),
    body: managedBody,
    signal: AbortSignal.timeout(60_000)
  });
  const managedPayload = await managedResponse.json();
  assert.equal(managedResponse.status, 503);
  assert.equal(managedPayload.code, 'REQUIRED_RUNTIME_UNAVAILABLE');
});
