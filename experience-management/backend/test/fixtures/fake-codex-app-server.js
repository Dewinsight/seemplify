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

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function result(id, value) {
  send({ id, result: value });
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
  if (message.method === 'model/list') return result(id, { data: [{
    id: 'gpt-test-codex', model: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false,
    isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Test effort' }
    ], inputModalities: ['text']
  }], nextCursor: null });
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
