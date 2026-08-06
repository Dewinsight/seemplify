import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const home = String(process.env.CODEX_HOME || '');
if (home) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'fake-app-server.json'), JSON.stringify({
    argv: process.argv.slice(2),
    pid: process.pid,
    leakedSecret: process.env.CODEX_TEST_SECRET_SHOULD_NOT_LEAK || null
  }));
}

let connected = false;
let pendingLogin = '';
let threadSequence = 0;
let turnSequence = 0;

const modelCatalog = [{
  id: 'gpt-test-codex', model: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false,
  isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Light test effort' },
    { reasoningEffort: 'medium', description: 'Balanced test effort' },
    { reasoningEffort: 'high', description: 'Deep test effort' },
    { reasoningEffort: 'max', description: 'Maximum test effort' }
  ], inputModalities: ['text']
}, {
  id: 'gpt-test-codex-fast', model: 'gpt-test-codex-fast', displayName: 'GPT Test Codex Fast', hidden: false,
  isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Fast test effort' },
    { reasoningEffort: 'focused', description: 'Future catalog-defined effort' }
  ], inputModalities: ['text']
}, {
  id: 'gpt-test-codex-minimal', model: 'gpt-test-codex-minimal', displayName: 'GPT Test Codex Minimal', hidden: false,
  isDefault: false, defaultReasoningEffort: 'minimal', supportedReasoningEfforts: [], inputModalities: ['text']
}];

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function result(id, value) {
  send({ id, result: value });
}

function updateMarker(patch) {
  if (!home) return;
  const marker = path.join(home, 'fake-app-server.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { /* Preserve the new observation. */ }
  fs.writeFileSync(marker, JSON.stringify({ ...current, ...patch }));
}

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialized') return;
  const id = message.id;
  if (message.method === 'initialize') {
    const capabilities = message.params?.capabilities;
    if (capabilities?.experimentalApi !== true || capabilities?.requestAttestation !== false) {
      send({ id, error: { code: -32600, message: 'Invalid request: the Experience client must enable its required App Server capabilities.' } });
      return;
    }
    return result(id, { userAgent: 'fake-codex-app-server' });
  }
  if (message.method === 'account/read') {
    if (home && fs.existsSync(path.join(home, 'crash-on-account-read'))) {
      const marker = path.join(home, 'crashed-once');
      if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, '1');
        process.exit(23);
      }
    }
    return result(id, {
      account: connected ? { type: 'chatgpt', email: 'codex@example.test', planType: 'plus' } : null,
      requiresOpenaiAuth: true
    });
  }
  if (message.method === 'account/login/start') {
    pendingLogin = 'fake-login-id';
    result(id, {
      type: 'chatgptDeviceCode', loginId: pendingLogin,
      verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE'
    });
    setTimeout(() => {
      if (!pendingLogin) return;
      connected = true;
      send({ method: 'account/login/completed', params: { loginId: pendingLogin, success: true, error: null } });
      send({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'plus' } });
      pendingLogin = '';
    }, 75);
    return;
  }
  if (message.method === 'account/login/cancel') {
    pendingLogin = '';
    return result(id, {});
  }
  if (message.method === 'account/logout') {
    connected = false; pendingLogin = '';
    result(id, {});
    send({ method: 'account/updated', params: { authMode: null, planType: null } });
    return;
  }
  if (message.method === 'model/list') {
    if (!message.params?.cursor) return result(id, { data: [modelCatalog[0]], nextCursor: 'fake-model-page-2' });
    if (message.params.cursor === 'fake-model-page-2') return result(id, { data: [modelCatalog[1]], nextCursor: 'fake-model-page-3' });
    if (message.params.cursor === 'fake-model-page-3') return result(id, { data: [modelCatalog[2]], nextCursor: null });
    return result(id, { data: [], nextCursor: null });
  }
  if (message.method === 'thread/start') {
    const runtimeRoots = message.params?.runtimeWorkspaceRoots;
    if (message.params?.sandbox !== undefined
      || message.params?.permissions !== 'experience-read-only'
      || !Array.isArray(runtimeRoots)
      || runtimeRoots.length !== 1
      || runtimeRoots[0] !== message.params?.cwd) {
      send({ id, error: { code: -32600, message: 'Invalid request: thread/start must use the isolated Experience permission profile.' } });
      return;
    }
    updateMarker({ lastThreadStart: message.params });
    const threadId = `fake-thread-${++threadSequence}`;
    result(id, { thread: { id: threadId, ephemeral: false } });
    send({ method: 'thread/started', params: { thread: { id: threadId } } });
    return;
  }
  if (message.method === 'turn/start') {
    if (message.params?.sandboxPolicy !== undefined || message.params?.permissions !== undefined) {
      send({ id, error: { code: -32600, message: 'Invalid request: turn/start must inherit the thread permission profile.' } });
      return;
    }
    const selectedModel = modelCatalog.find((model) => model.id === message.params?.model);
    const advertisedEfforts = selectedModel?.supportedReasoningEfforts.map((item) => item.reasoningEffort) || [];
    const supportedEfforts = advertisedEfforts.length ? advertisedEfforts : [selectedModel?.defaultReasoningEffort];
    if (!selectedModel || !supportedEfforts.includes(message.params?.effort)) {
      send({ id, error: { code: -32600, message: 'Invalid request: model and effort must match the advertised catalog.' } });
      return;
    }
    updateMarker({ lastTurnStart: message.params });
    const turnId = `fake-turn-${++turnSequence}`;
    result(id, { turn: { id: turnId, status: 'inProgress', items: [], error: null } });
    if (home && fs.existsSync(path.join(home, 'crash-during-turn'))) {
      setTimeout(() => process.exit(24), 25);
      return;
    }
    setTimeout(() => {
      send({ method: 'item/completed', params: {
        item: { id: `fake-message-${turnSequence}`, type: 'agentMessage', phase: 'final_answer', text: '{"answer":"fake completion"}' }
      } });
      send({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed', items: [], error: null } } });
    }, 25);
    return;
  }
  if (message.method === 'thread/read') return result(id, { thread: { turns: [] } });
  if (message.method === 'thread/delete') return result(id, {});
  send({ id, error: { code: -32601, message: `Unsupported fake method ${String(message.method)}` } });
});
