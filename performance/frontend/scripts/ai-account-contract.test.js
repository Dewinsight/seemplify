const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadAIAccount(api) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'aiAccount.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request === './api') return { __esModule: true, default: api };
    return require(request);
  };
  new Function('exports', 'module', 'require', transpiled.outputText)(loaded.exports, loaded, localRequire);
  return loaded.exports;
}

function account() {
  return {
    status: 'connected', connectedEmail: 'person@example.test', planType: 'Plus',
    connectedAt: '2026-08-12T00:00:00.000Z', lastVerifiedAt: '2026-08-12T00:00:00.000Z',
    dataSharingAcknowledgedAt: '2026-08-12T00:00:00.000Z', routable: true,
    rateLimits: null, usageLimit: null, lastError: null,
    // This is owned by the shared account authority and must not override the
    // Performance runtime cookie returned beside the local policy.
    runtimePreference: 'local'
  };
}

function preferences() {
  return {
    defaults: {
      override: { codexModel: null, reasoningEffort: null },
      effective: { codexModel: null, reasoningEffort: null },
      provenance: { codexModel: 'admin_default', reasoningEffort: 'admin_default' }
    },
    activities: [{
      activity: 'performance.review', app: 'performance', label: 'Review', group: 'Performance',
      enabled: true, adminDefault: { codexModel: 'gpt-test', reasoningEffort: 'medium' },
      override: { codexModel: null, reasoningEffort: null },
      effective: { codexModel: 'gpt-test', reasoningEffort: 'medium' },
      provenance: { codexModel: 'admin_default', reasoningEffort: 'admin_default' }
    }],
    models: [{ id: 'gpt-test', displayName: 'GPT Test' }]
  };
}

test('AI account client unwraps Performance envelopes and maps policy and runtime preference', async () => {
  const payload = {
    account: account(),
    policy: { localEnabled: true, chatgptEnabled: true, defaultRuntime: 'local' },
    runtimePreference: 'chatgpt',
    preferences: preferences()
  };
  const api = {
    get: async (url) => {
      assert.equal(url, '/ai-account');
      return { data: { success: true, data: payload } };
    }
  };
  const { aiAccount, effectiveRuntime } = loadAIAccount(api);
  const state = await aiAccount.read();

  assert.equal(state.account.status, 'connected');
  assert.equal(state.runtimePolicy, payload.policy);
  assert.equal(state.runtimePreference, 'chatgpt');
  assert.equal(state.account.runtimePreference, 'chatgpt');
  assert.equal(state.preferences, payload.preferences);
  assert.equal(effectiveRuntime(state), 'chatgpt');
});
test('AI account client unwraps preference endpoints against the Performance proxy', async () => {
  const expected = preferences();
  const calls = [];
  const api = {
    get: async (url) => { calls.push(['get', url]); return { data: { success: true, data: expected } }; },
    put: async (url, body) => { calls.push(['put', url, body]); return { data: { success: true, data: expected } }; },
    delete: async (url, config) => { calls.push(['delete', url, config.data]); return { data: { success: true, data: expected } }; }
  };
  const { aiAccount } = loadAIAccount(api);

  assert.equal(await aiAccount.preferences(), expected);
  assert.equal(await aiAccount.savePreference('activity', 'performance.review', {
    codexModel: 'gpt-test', reasoningEffort: 'high'
  }), expected);
  assert.equal(await aiAccount.deletePreference('activity', 'performance.review'), expected);
  assert.deepEqual(calls, [
    ['get', '/ai-account/preferences'],
    ['put', '/ai-account/preferences', {
      scope: 'activity', activity: 'performance.review', codexModel: 'gpt-test', reasoningEffort: 'high'
    }],
    ['delete', '/ai-account/preferences', { scope: 'activity', activity: 'performance.review' }]
  ]);
});

test('AI account client preserves backend error and retry metadata', async () => {
  const api = {
    post: async () => {
      throw {
        message: 'Request failed with status code 503',
        response: {
          data: {
            error: 'The shared AI account service is unavailable.',
            code: 'SHARED_AI_UNAVAILABLE',
            retryAfterSeconds: 17
          },
          headers: {}
        }
      };
    }
  };
  const { aiAccount } = loadAIAccount(api);

  await assert.rejects(aiAccount.startLogin(), (error) => {
    assert.equal(error.message, 'The shared AI account service is unavailable.');
    assert.equal(error.code, 'SHARED_AI_UNAVAILABLE');
    assert.equal(error.retryAfterSeconds, 17);
    return true;
  });
});
