import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-provider-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const frontendDist = path.join(root, 'frontend');
fs.mkdirSync(frontendDist, { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>AI provider test</title>');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: frontendDist,
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'qa@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  CODEX_RUNTIME_DIR: path.join(root, 'codex'),
  CODEX_CLI_PATH: fileURLToPath(new URL('./fixtures/fake-codex-app-server.js', import.meta.url)),
  CODEX_TEST_SECRET_SHOULD_NOT_LEAK: 'sensitive-parent-value'
});

const { app } = await import('../src/app.js');
const { stopCodexClients, CodexAppServerClient } = await import('../src/codexAppServer.js');
const {
  aiProviderSnapshot, effectiveAiProviderSnapshot, getAiProviderPreference, setAiProviderPreference
} = await import('../src/aiProvider.js');
const { createJob, db } = await import('../src/database.js');

after(async () => {
  await stopCodexClients();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function waitForConnected(agent: request.SuperAgentTest) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await agent.get('/api/ai-provider').expect(200);
    if (response.body.codex.account.connected) return response;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Fake ChatGPT account did not connect.');
}

test('device login, consent, model choice, job snapshots, and disconnect are isolated', async () => {
  const agent = request.agent(app);
  const account = await signupVerifyAndOnboard(agent, {
    name: 'Codex Tester', email: 'codex-tester@example.test', password: 'Codex-Tester-Password-2026!'
  });
  const userId = account.body.user.id as string;
  const spaceId = account.body.activeSpace.id as string;

  const initial = await agent.get('/api/ai-provider').expect(200);
  assert.equal(initial.body.preference.provider, 'terra');
  assert.equal(initial.body.codex.account.connected, false);

  const login = await agent.post('/api/ai-provider/codex/device-login').send({}).expect(200);
  assert.equal(login.body.userCode, 'TEST-CODE');
  assert.equal(login.body.verificationUrl, 'https://auth.openai.com/codex/device');
  const connected = await waitForConnected(agent);
  assert.equal(connected.body.codex.models[0].id, 'gpt-test-codex');

  await agent.patch('/api/ai-provider').send({ provider: 'codex', codexModel: 'gpt-test-codex' }).expect(409);
  const selected = await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledged: true
  }).expect(200);
  assert.equal(selected.body.preference.provider, 'codex');
  assert.ok(selected.body.preference.codexDataSharingAcknowledgedAt);

  const queued = createJob('survey.generate', { brief: 'Test the recorded runtime.' }, spaceId, null, null, userId);
  assert.deepEqual((queued.input as any)._aiRuntime, aiProviderSnapshot(userId, spaceId));
  await agent.patch('/api/ai-provider').send({ provider: 'terra' }).expect(200);
  assert.equal(effectiveAiProviderSnapshot(userId, spaceId, (queued.input as any)._aiRuntime).provider, 'codex');
  await agent.patch('/api/ai-provider').send({
    provider: 'terra', codexDataSharingAcknowledged: false
  }).expect(200);
  assert.equal(getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt, null);
  assert.equal(effectiveAiProviderSnapshot(userId, spaceId, (queued.input as any)._aiRuntime).provider, 'terra');
  assert.equal((queued.input as any)._aiRuntime.provider, 'codex');
  assert.equal((queued.input as any)._aiRuntime.codexModel, 'gpt-test-codex');

  const automatic = createJob('response.analyze', {}, spaceId, null, null, null);
  assert.equal((automatic.input as any)._aiRuntime.provider, 'terra');

  setAiProviderPreference(userId, 'another-space', {
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledgedAt: new Date().toISOString()
  });
  await agent.post('/api/ai-provider/codex/disconnect').send({}).expect(200);
  assert.equal(getAiProviderPreference(userId, spaceId).provider, 'terra');
  assert.equal(getAiProviderPreference(userId, 'another-space').provider, 'terra');
  assert.equal(getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt, null);
  assert.equal(getAiProviderPreference(userId, 'another-space').codexDataSharingAcknowledgedAt, null);
});

test('App Server completes structured turns and recovers after an unexpected exit', async () => {
  const client = new CodexAppServerClient('direct-client');
  const login = await client.startDeviceLogin();
  assert.equal(login.connected, false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await client.accountStatus()).connected, true);
  const completion = await client.complete({
    model: 'gpt-test-codex', reasoningEffort: 'medium', timeoutMs: 2_000,
    jsonSchema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } },
    messages: [{ role: 'user', content: 'Return the test answer.' }]
  });
  assert.deepEqual(completion.data, { answer: 'fake completion' });
  const marker = JSON.parse(fs.readFileSync(path.join(client.homeDir, 'fake-app-server.json'), 'utf8'));
  assert.ok(marker.argv.includes('cli_auth_credentials_store="file"'));
  assert.ok(marker.argv.includes('history.persistence="none"'));
  assert.ok(marker.argv.includes('shell_environment_policy.inherit="none"'));
  assert.ok(marker.argv.includes('default_permissions="experience-read-only"'));
  const authFile = JSON.stringify(path.join(client.homeDir, 'auth.json'));
  assert.ok(marker.argv.includes(`permissions.experience-read-only.filesystem={":root"="deny",":minimal"="read",${authFile}="deny",":workspace_roots"={"."="read"}}`));
  assert.ok(marker.argv.includes('permissions.experience-read-only.network.enabled=false'));
  assert.equal(marker.leakedSecret, null);
  await client.stop();

  const recovering = new CodexAppServerClient('recovering-client');
  fs.mkdirSync(recovering.homeDir, { recursive: true });
  fs.writeFileSync(path.join(recovering.homeDir, 'crash-on-account-read'), '1');
  await assert.rejects(() => recovering.accountStatus(), /stopped unexpectedly/);
  assert.equal((await recovering.accountStatus()).connected, false);
  await recovering.stop();

  const crashingTurn = new CodexAppServerClient('crashing-turn-client');
  const crashingLogin = await crashingTurn.startDeviceLogin();
  assert.equal(crashingLogin.connected, false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(crashingTurn.homeDir, 'crash-during-turn'), '1');
  const startedAt = Date.now();
  await assert.rejects(() => crashingTurn.complete({
    model: 'gpt-test-codex', reasoningEffort: 'medium', timeoutMs: 5_000,
    messages: [{ role: 'user', content: 'Crash before completing.' }]
  }), /stopped unexpectedly/);
  assert.ok(Date.now() - startedAt < 2_000, 'turn crash should reject without waiting for the completion timeout');
  await crashingTurn.stop();
});
