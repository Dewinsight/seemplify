import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-provider-'));
const preferenceFile = path.join(root, 'codex', 'provider-preferences.json');
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
  aiProviderSnapshot, completeWithAi, effectiveAiProviderSnapshot, getAdminCodexDefaults,
  getAiProviderPreference, resetAiProviderPreferenceCacheForTests,
  setAiProviderPreference, updateAdminCodexDefaults
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
  assert.equal(initial.body.preference.provider, 'codex');
  assert.equal(initial.body.preference.runtimeChoice, null);
  assert.equal(initial.body.codex.account.connected, false);
  assert.equal(aiProviderSnapshot(null, spaceId).provider, 'terra');
  const explicitlyLocal = await agent.patch('/api/ai-provider')
    .send({ provider: 'terra', codexModel: null }).expect(200);
  assert.equal(explicitlyLocal.body.preference.runtimeChoice, 'local');

  const login = await agent.post('/api/ai-provider/codex/device-login').send({}).expect(200);
  assert.equal(login.body.userCode, 'TEST-CODE');
  assert.equal(login.body.verificationUrl, 'https://auth.openai.com/codex/device');
  const connected = await waitForConnected(agent);
  assert.equal(connected.body.codex.models[0].id, 'gpt-test-codex');
  assert.equal(connected.body.codex.models[1].id, 'gpt-test-codex-fast');
  assert.equal(connected.body.codex.models[2].id, 'gpt-test-codex-minimal');
  assert.ok(connected.body.codex.models[0].supportedReasoningEfforts.some((item: any) => item.reasoningEffort === 'max'));

  await agent.patch('/api/ai-provider').send({ provider: 'codex', codexModel: 'gpt-test-codex' }).expect(409);
  const selected = await agent.patch('/api/ai-provider').send({
    provider: 'codex',
    codexModel: 'gpt-test-codex',
    codexReasoningEffort: 'max',
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'focused' }
    },
    codexDataSharingAcknowledged: true
  }).expect(200);
  assert.equal(selected.body.preference.provider, 'codex');
  assert.equal(selected.body.preference.runtimeChoice, 'chatgpt');
  assert.equal(selected.body.preference.codexReasoningEffort, 'max');
  assert.deepEqual(selected.body.preference.codexActionOverrides['analyst.chat'], {
    model: 'gpt-test-codex-fast', reasoningEffort: 'focused'
  });
  assert.ok(selected.body.preference.codexDataSharingAcknowledgedAt);
  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexDataSharingAcknowledged: false
  }).expect(409);
  assert.ok(getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt);

  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledged: true,
    codexActionOverrides: { 'unknown.action': { model: 'gpt-test-codex' } }
  }).expect(400);
  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledged: true,
    codexActionOverrides: { 'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'max' } }
  }).expect(409);
  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex-minimal',
    codexReasoningEffort: 'unadvertised', codexDataSharingAcknowledged: true
  }).expect(409);

  const automaticFallback = await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: null,
    codexActionOverrides: {
      'analyst.chat': {
        model: 'gpt-test-codex-fast', reasoningEffort: 'low', reasoningEffortAuto: true
      }
    },
    codexDataSharingAcknowledged: true
  }).expect(200);
  assert.equal(automaticFallback.body.preference.codexActionOverrides['analyst.chat'].reasoningEffortAuto, true);
  const inheritedFallback = await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'low',
    codexDataSharingAcknowledged: true
  }).expect(200);
  assert.deepEqual(inheritedFallback.body.preference.codexActionOverrides['analyst.chat'], {
    model: 'gpt-test-codex-fast', reasoningEffort: null
  });
  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'max',
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'focused' }
    },
    codexDataSharingAcknowledged: true
  }).expect(200);

  const defaultQueued = createJob('report.generate', { brief: 'Snapshot the default effort.' }, spaceId, null, null, userId);
  assert.equal((defaultQueued.input as any)._aiRuntime.codexReasoningEffort, 'max');

  const queued = createJob('analyst.chat', { question: 'Test the recorded runtime.' }, spaceId, null, null, userId);
  assert.deepEqual((queued.input as any)._aiRuntime, aiProviderSnapshot(userId, spaceId, 'analyst.chat'));
  assert.equal((queued.input as any)._aiRuntime.codexModel, 'gpt-test-codex-fast');
  assert.equal((queued.input as any)._aiRuntime.codexReasoningEffort, 'focused');
  assert.equal((queued.input as any)._aiRuntime.codexActionId, 'analyst.chat');
  const routed = await completeWithAi({
    userId, spaceId, actionId: 'analyst.chat',
    providerSnapshot: (queued.input as any)._aiRuntime,
    activity: 'experience.analyst_chat', requestId: 'configured-action',
    reasoningEffort: 'medium', messages: [{ role: 'user', content: 'Use the configured action route.' }]
  });
  assert.equal(routed.runtime.model, 'gpt-test-codex-fast');
  assert.equal(routed.runtime.reasoningEffort, 'focused');
  assert.equal(routed.runtime.action, 'analyst.chat');
  await agent.patch('/api/ai-provider').send({ provider: 'terra' }).expect(200);
  const configuredWhileLocal = await agent.patch('/api/ai-provider').send({
    provider: 'terra',
    codexModel: 'gpt-test-codex',
    codexReasoningEffort: 'high',
    codexActionOverrides: {
      'report.generate': { model: 'gpt-test-codex', reasoningEffort: 'max' }
    }
  }).expect(200);
  assert.equal(configuredWhileLocal.body.preference.provider, 'terra');
  assert.equal(configuredWhileLocal.body.preference.runtimeChoice, 'local');
  assert.equal(configuredWhileLocal.body.preference.codexReasoningEffort, 'high');
  assert.deepEqual(configuredWhileLocal.body.preference.codexActionOverrides['report.generate'], {
    model: 'gpt-test-codex', reasoningEffort: 'max'
  });
  assert.equal(effectiveAiProviderSnapshot(userId, spaceId, (queued.input as any)._aiRuntime).provider, 'codex');
  await agent.patch('/api/ai-provider').send({
    provider: 'terra', codexModel: 'no-longer-available', codexReasoningEffort: 'invalid',
    codexActionOverrides: { 'analyst.chat': { model: 'also-invalid', reasoningEffort: 'invalid' } },
    codexDataSharingAcknowledged: false
  }).expect(200);
  assert.equal(getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt, null);
  assert.equal(effectiveAiProviderSnapshot(userId, spaceId, (queued.input as any)._aiRuntime).provider, 'terra');
  assert.equal((queued.input as any)._aiRuntime.provider, 'codex');
  assert.equal((queued.input as any)._aiRuntime.codexModel, 'gpt-test-codex-fast');

  const automatic = createJob('response.analyze', {}, spaceId, null, null, null);
  assert.equal((automatic.input as any)._aiRuntime.provider, 'terra');

  setAiProviderPreference(userId, 'another-space', {
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledgedAt: new Date().toISOString()
  });
  assert.equal(getAiProviderPreference(userId, 'another-space').runtimeChoice, 'chatgpt');
  assert.equal(aiProviderSnapshot(userId, 'another-space', 'report.generate').codexReasoningEffort, 'high');
  setAiProviderPreference(userId, 'legacy-local-space', { provider: 'terra' });
  setAiProviderPreference(userId, 'legacy-chatgpt-space', {
    provider: 'codex', codexDataSharingAcknowledgedAt: new Date().toISOString()
  });
  const legacyFile = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'));
  delete legacyFile.preferences[`${userId}:legacy-local-space`].runtimeChoice;
  delete legacyFile.preferences[`${userId}:legacy-chatgpt-space`].runtimeChoice;
  fs.writeFileSync(preferenceFile, `${JSON.stringify(legacyFile, null, 2)}\n`);
  resetAiProviderPreferenceCacheForTests();
  assert.equal(getAiProviderPreference(userId, 'legacy-local-space').runtimeChoice, 'local');
  assert.equal(getAiProviderPreference(userId, 'legacy-chatgpt-space').runtimeChoice, 'chatgpt');
  assert.equal(getAiProviderPreference(userId, 'never-configured-space').runtimeChoice, null);
  assert.equal(getAiProviderPreference(userId, 'never-configured-space').provider, 'codex');
  await agent.post('/api/ai-provider/codex/disconnect').send({}).expect(200);
  assert.equal(getAiProviderPreference(userId, spaceId).provider, 'terra');
  assert.equal(getAiProviderPreference(userId, spaceId).runtimeChoice, 'local');
  assert.equal(getAiProviderPreference(userId, 'another-space').provider, 'codex');
  assert.equal(getAiProviderPreference(userId, 'another-space').runtimeChoice, null);
  assert.equal(getAiProviderPreference(userId, 'legacy-local-space').provider, 'terra');
  assert.equal(getAiProviderPreference(userId, 'legacy-local-space').runtimeChoice, 'local');
  assert.equal(getAiProviderPreference(userId, 'legacy-chatgpt-space').provider, 'codex');
  assert.equal(getAiProviderPreference(userId, 'legacy-chatgpt-space').runtimeChoice, null);
  assert.equal(getAiProviderPreference(userId, 'never-configured-space').provider, 'codex');
  assert.equal(getAiProviderPreference(userId, 'never-configured-space').runtimeChoice, null);
  assert.equal(getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt, null);
  assert.equal(getAiProviderPreference(userId, 'another-space').codexDataSharingAcknowledgedAt, null);
});

test('admin defaults inherit field-by-field, user reset is narrow, and queued candidates are durable', async () => {
  const agent = request.agent(app);
  const account = await signupVerifyAndOnboard(agent, {
    name: 'Codex Inheritance Tester', email: 'codex-inheritance@example.test',
    password: 'Codex-Inheritance-Password-2026!'
  });
  const userId = account.body.user.id as string;
  const spaceId = account.body.activeSpace.id as string;
  await agent.post('/api/ai-provider/codex/device-login').send({}).expect(200);
  await waitForConnected(agent);

  await updateAdminCodexDefaults(userId, {
    codexModel: 'gpt-test-codex',
    codexReasoningEffort: 'high',
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'focused' }
    }
  });
  await assert.rejects(() => updateAdminCodexDefaults(userId, {
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'max' }
    }
  }), /does not support the max reasoning effort/);

  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: null, codexReasoningEffort: null,
    codexActionOverrides: {}, codexDataSharingAcknowledged: true
  }).expect(200);
  let state = await agent.get('/api/ai-provider').expect(200);
  assert.deepEqual(state.body.codex.effectiveConfiguration.default.model, {
    value: 'gpt-test-codex', source: 'admin_default', inherited: true
  });
  assert.deepEqual(state.body.codex.effectiveConfiguration.default.reasoningEffort, {
    value: 'high', source: 'admin_default', inherited: true
  });
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].model.source, 'admin_action');
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].reasoningEffort.source, 'admin_action');

  await updateAdminCodexDefaults(userId, {
    codexModel: 'gpt-test-codex',
    codexReasoningEffort: 'high',
    codexActionOverrides: {}
  });
  const automaticUserFallback = await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: null, codexReasoningEffort: null,
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: null }
    }
  }).expect(200);
  assert.deepEqual(automaticUserFallback.body.preference.codexActionOverrides['analyst.chat'], {
    model: 'gpt-test-codex-fast', reasoningEffort: 'low', reasoningEffortAuto: true
  });
  await updateAdminCodexDefaults(userId, {
    codexReasoningEffort: 'low'
  });
  state = await agent.get('/api/ai-provider').expect(200);
  assert.deepEqual(state.body.codex.effectiveConfiguration.actions['analyst.chat'].reasoningEffort, {
    value: 'low', source: 'admin_default', inherited: true
  });

  await updateAdminCodexDefaults(userId, {
    codexModel: 'gpt-test-codex',
    codexReasoningEffort: 'high',
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'focused' }
    }
  });
  await agent.post('/api/ai-provider/reset-codex-defaults').send({}).expect(200);

  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'medium'
  }).expect(200);
  state = await agent.get('/api/ai-provider').expect(200);
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].model.source, 'user_default');
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].reasoningEffort.source, 'user_default');
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].model.inherited, true);

  await agent.patch('/api/ai-provider').send({
    provider: 'codex',
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'focused' }
    }
  }).expect(200);
  state = await agent.get('/api/ai-provider').expect(200);
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].model.source, 'user_action');
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].reasoningEffort.source, 'user_action');
  assert.equal(state.body.codex.effectiveConfiguration.actions['analyst.chat'].model.inherited, false);

  const beforeReset = getAiProviderPreference(userId, spaceId);
  const resetResponse = await agent.post('/api/ai-provider/reset-codex-defaults').send({}).expect(200);
  const reset = resetResponse.body.preference;
  assert.equal(reset.provider, 'codex');
  assert.equal(reset.codexDataSharingAcknowledgedAt, beforeReset.codexDataSharingAcknowledgedAt);
  assert.equal(reset.codexModel, null);
  assert.equal(reset.codexReasoningEffort, null);
  assert.deepEqual(reset.codexActionOverrides, {});

  const queued = createJob('analyst.chat', { question: 'Keep the inherited admin runtime.' },
    spaceId, null, null, userId);
  const queuedRuntime = (queued.input as any)._aiRuntime;
  assert.deepEqual(queuedRuntime.codexModelCandidates, [
    { value: 'gpt-test-codex-fast', source: 'admin_action' },
    { value: 'gpt-test-codex', source: 'admin_default' }
  ]);
  assert.deepEqual(queuedRuntime.codexReasoningEffortCandidates.slice(0, 2), [
    { value: 'focused', source: 'admin_action' },
    { value: 'high', source: 'admin_default' }
  ]);

  await updateAdminCodexDefaults(userId, {
    codexModel: 'gpt-test-codex-minimal',
    codexReasoningEffort: 'minimal',
    codexActionOverrides: {}
  });
  await agent.patch('/api/ai-provider').send({
    provider: 'codex', codexModel: 'gpt-test-codex-minimal', codexReasoningEffort: 'minimal'
  }).expect(200);
  const durable = await completeWithAi({
    userId, spaceId, actionId: 'analyst.chat', providerSnapshot: queuedRuntime,
    activity: 'experience.analyst_chat', requestId: 'durable-admin-defaults',
    messages: [{ role: 'user', content: 'Use the enqueued candidates.' }]
  });
  assert.equal(durable.runtime.model, 'gpt-test-codex-fast');
  assert.equal(durable.runtime.reasoningEffort, 'focused');

  const fallback = await completeWithAi({
    userId, spaceId, actionId: 'analyst.chat',
    providerSnapshot: {
      provider: 'codex', codexModel: 'not-in-this-catalog', codexReasoningEffort: 'max',
      codexModelCandidates: [
        { value: 'not-in-this-catalog', source: 'user_action' },
        { value: 'gpt-test-codex-fast', source: 'admin_default' }
      ],
      codexReasoningEffortCandidates: [
        { value: 'max', source: 'user_action' },
        { value: 'focused', source: 'admin_default' }
      ],
      codexActionId: 'analyst.chat',
      codexDataSharingAcknowledgedAt: getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt
    },
    activity: 'experience.analyst_chat', requestId: 'catalog-safe-fallback',
    messages: [{ role: 'user', content: 'Use the first live compatible candidates.' }]
  });
  assert.equal(fallback.runtime.model, 'gpt-test-codex-fast');
  assert.equal(fallback.runtime.reasoningEffort, 'focused');

  resetAiProviderPreferenceCacheForTests();
  assert.equal(getAdminCodexDefaults().codexModel, 'gpt-test-codex-minimal');
  await agent.patch('/api/ai-provider').send({ provider: 'terra' }).expect(200);
  assert.equal(aiProviderSnapshot(userId, spaceId, 'analyst.chat').provider, 'terra');
});

test('App Server completes structured turns and recovers after an unexpected exit', async () => {
  const client = new CodexAppServerClient('direct-client');
  const login = await client.startDeviceLogin();
  assert.equal(login.connected, false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await client.accountStatus()).connected, true);
  const completion = await client.complete({
    model: 'gpt-test-codex', reasoningEffort: 'medium', requestId: 'first-run', timeoutMs: 2_000,
    jsonSchema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } },
    messages: [{ role: 'user', content: 'Return the test answer.' }]
  });
  assert.deepEqual(completion.data, { answer: 'fake completion' });
  assert.equal(completion.runtime.reasoningEffort, 'medium');
  const marker = JSON.parse(fs.readFileSync(path.join(client.homeDir, 'fake-app-server.json'), 'utf8'));
  assert.ok(marker.argv.includes('cli_auth_credentials_store="file"'));
  assert.ok(marker.argv.includes('history.persistence="none"'));
  assert.ok(marker.argv.includes('shell_environment_policy.inherit="none"'));
  assert.ok(marker.argv.includes('default_permissions="experience-read-only"'));
  const authFile = JSON.stringify(path.join(client.homeDir, 'auth.json'));
  assert.ok(marker.argv.includes(`permissions.experience-read-only.filesystem={":root"="deny",":minimal"="read",${authFile}="deny",":workspace_roots"={"."="read"}}`));
  assert.ok(marker.argv.includes('permissions.experience-read-only.network.enabled=false'));
  assert.equal(marker.lastThreadStart.model, 'gpt-test-codex');
  assert.equal(marker.lastTurnStart.model, 'gpt-test-codex');
  assert.equal(marker.lastTurnStart.effort, 'medium');
  assert.equal(marker.lastTurnStart.clientUserMessageId, 'first-run');
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
