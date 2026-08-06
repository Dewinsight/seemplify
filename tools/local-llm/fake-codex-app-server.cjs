'use strict';

/**
 * A stand-in for `codex app-server` that enforces the session manager's
 * obligations rather than merely answering them.
 *
 * Every sandbox and credential guarantee this fixture checks is a guarantee the
 * real CLI would enforce silently or not at all. Asserting them here turns the
 * isolation contract into something a test run can fail on.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const argv = process.argv.slice(2);
const home = String(process.env.CODEX_HOME || '');

/** Recorded so a test can assert that platform credentials never reach a
 * process that is supposed to be running on a person's own ChatGPT plan. */
const leakedSecret = process.env.CODEX_API_KEY
  || process.env.OPENAI_API_KEY
  || process.env.CODEX_TEST_SECRET_SHOULD_NOT_LEAK
  || null;

if (home) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'fake-app-server.json'), JSON.stringify({
    argv, pid: process.pid, leakedSecret, codexHome: home, cwd: process.cwd()
  }));
}

function updateMarker(patch) {
  if (!home) return;
  const marker = path.join(home, 'fake-app-server.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(marker, 'utf8')); }
  catch { /* Preserve the newest observation even if the marker was lost. */ }
  fs.writeFileSync(marker, JSON.stringify({ ...current, ...patch }));
}

/** The launch contract. A missing entry here means a real deployment would
 * have shared one ChatGPT login across every user, or handed the model more
 * reach than the profile intends. */
const requiredLaunchConfig = [
  'cli_auth_credentials_store="file"',
  'history.persistence="none"',
  'shell_environment_policy.inherit="none"',
  'default_permissions="seemplify-read-only"',
  'permissions.seemplify-read-only.network.enabled=false'
];

function launchContractFailure() {
  for (const expected of requiredLaunchConfig) {
    if (!argv.includes(expected)) return `missing launch config ${expected}`;
  }
  const filesystem = argv.find((entry) => entry.startsWith('permissions.seemplify-read-only.filesystem='));
  if (!filesystem) return 'missing filesystem permission profile';
  if (!filesystem.includes('":root"="deny"')) return 'filesystem profile must deny the host root';
  if (!filesystem.includes('auth.json"="deny"')) return 'filesystem profile must deny the credential file';
  if (!argv.includes('app-server')) return 'the session must launch the app-server subcommand';
  if (!argv.includes('stdio://')) return 'the session must listen on stdio';
  if (leakedSecret) return 'a platform API key reached a per-user Codex session';
  return null;
}

/** Connection state comes from the credential file, exactly as the real CLI's
 * file store behaves: a restarted process is still signed in. */
const authFile = home ? path.join(home, 'auth.json') : '';
let connected = Boolean(authFile) && fs.existsSync(authFile);
let pendingLogin = '';
let threadSequence = 0;
let turnSequence = 0;

const modelCatalog = [
  {
    id: 'gpt-test-codex', model: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false,
    isDefault: true, defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }
    ],
    inputModalities: ['text']
  },
  {
    id: 'gpt-test-codex-fast', model: 'gpt-test-codex-fast', displayName: 'GPT Test Codex Fast', hidden: false,
    isDefault: false, defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    inputModalities: ['text']
  },
  {
    id: 'gpt-test-codex-hidden', model: 'gpt-test-codex-hidden', displayName: 'Hidden', hidden: true,
    isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [], inputModalities: ['text']
  }
];

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function result(id, value) { send({ id, result: value }); }
function invalid(id, message) { send({ id, error: { code: -32600, message: `Invalid request: ${message}` } }); }

function crashMarker(name) { return home && fs.existsSync(path.join(home, name)); }

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); }
  catch { return; }
  if (message.method === 'initialized') return;
  const id = message.id;

  if (message.method === 'initialize') {
    const failure = launchContractFailure();
    if (failure) return invalid(id, failure);
    const capabilities = message.params?.capabilities;
    if (capabilities?.experimentalApi !== true || capabilities?.requestAttestation !== false) {
      return invalid(id, 'the gateway client must declare its required App Server capabilities');
    }
    return result(id, { userAgent: 'fake-codex-app-server' });
  }

  if (message.method === 'account/read') {
    if (crashMarker('crash-on-account-read') && !crashMarker('crashed-once')) {
      fs.writeFileSync(path.join(home, 'crashed-once'), '1');
      process.exit(23);
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
      if (authFile) fs.writeFileSync(authFile, JSON.stringify({ tokens: { fake: true } }));
      send({ method: 'account/login/completed', params: { loginId: pendingLogin, success: true, error: null } });
      pendingLogin = '';
    }, 50);
    return;
  }

  if (message.method === 'account/login/cancel') { pendingLogin = ''; return result(id, {}); }

  if (message.method === 'account/logout') {
    connected = false;
    pendingLogin = '';
    if (authFile) fs.rmSync(authFile, { force: true });
    return result(id, {});
  }

  if (message.method === 'model/list') {
    // Paginated on purpose: the cursor loop and its repeat guard are real code.
    if (!message.params?.cursor) return result(id, { data: [modelCatalog[0]], nextCursor: 'page-2' });
    if (message.params.cursor === 'page-2') return result(id, { data: [modelCatalog[1]], nextCursor: 'page-3' });
    if (message.params.cursor === 'page-3') return result(id, { data: [modelCatalog[2]], nextCursor: null });
    return result(id, { data: [], nextCursor: null });
  }

  if (message.method === 'thread/start') {
    const roots = message.params?.runtimeWorkspaceRoots;
    if (message.params?.sandbox !== undefined) return invalid(id, 'thread/start must not override the sandbox');
    if (message.params?.permissions !== 'seemplify-read-only') {
      return invalid(id, 'thread/start must use the isolated Seemplify permission profile');
    }
    if (!Array.isArray(roots) || roots.length !== 1 || roots[0] !== message.params?.cwd) {
      return invalid(id, 'thread/start must confine the workspace root to its own cwd');
    }
    updateMarker({ lastThreadStart: message.params });
    const threadId = `fake-thread-${++threadSequence}`;
    return result(id, { thread: { id: threadId, ephemeral: false } });
  }

  if (message.method === 'turn/start') {
    if (message.params?.permissions !== undefined || message.params?.sandboxPolicy !== undefined) {
      return invalid(id, 'turn/start must inherit the thread permission profile');
    }
    const selected = modelCatalog.find((model) => model.id === message.params?.model);
    const advertised = selected?.supportedReasoningEfforts.map((item) => item.reasoningEffort) || [];
    const supported = advertised.length ? advertised : [selected?.defaultReasoningEffort];
    if (!selected || !supported.includes(message.params?.effort)) {
      return invalid(id, 'model and effort must match the advertised catalogue');
    }
    updateMarker({ lastTurnStart: message.params });
    const turnId = `fake-turn-${++turnSequence}`;
    result(id, { turn: { id: turnId, status: 'inProgress', items: [], error: null } });
    if (crashMarker('crash-during-turn')) {
      setTimeout(() => process.exit(24), 20);
      return;
    }
    const echoed = String(message.params?.input?.[0]?.text || '');
    setTimeout(() => {
      send({
        method: 'item/completed',
        params: {
          item: {
            id: `fake-message-${turnSequence}`, type: 'agentMessage', phase: 'commentary',
            text: 'thinking out loud, must be ignored'
          }
        }
      });
      send({
        method: 'item/completed',
        params: {
          item: {
            id: `fake-final-${turnSequence}`, type: 'agentMessage', phase: 'final_answer',
            text: message.params?.outputSchema
              ? JSON.stringify({ answer: 'fake structured completion' })
              : `fake completion for ${echoed.slice(0, 40)}`
          }
        }
      });
      send({
        method: 'turn/completed',
        params: {
          turn: {
            id: turnId, status: 'completed', items: [], error: null,
            usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, cached_input_tokens: 3 }
          }
        }
      });
    }, 20);
    return;
  }

  if (message.method === 'thread/read') return result(id, { thread: { turns: [] } });
  if (message.method === 'thread/delete') return result(id, {});
  send({ id, error: { code: -32601, message: `Unsupported fake method ${String(message.method)}` } });
});
