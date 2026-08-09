const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const loaded = { exports: {} };
  new Function('exports', 'module', transpiled.outputText)(loaded.exports, loaded);
  return loaded.exports;
}

const { settleAssistantWebSocketError } = load('utils/assistantWebSocketState.ts');

test('a terminal WebSocket error replaces the pending assistant bubble', () => {
  const pending = [
    { id: 'user-1', type: 'user', content: 'Help', isLoading: false },
    { id: 'assistant-1', type: 'assistant', content: '', isLoading: true }
  ];
  const at = new Date('2026-08-09T21:30:00.000Z');
  const settled = settleAssistantWebSocketError(pending, 'Sign in again and retry.', at);

  assert.notEqual(settled, pending);
  assert.equal(settled[1].id, 'assistant-1');
  assert.equal(settled[1].content, 'Sign in again and retry.');
  assert.equal(settled[1].isLoading, false);
  assert.equal(settled[1].timestamp, at);
});

test('an idle conversation is unchanged by a connection-only error', () => {
  const messages = [{ id: 'assistant-1', type: 'assistant', content: 'Done', isLoading: false }];
  assert.equal(settleAssistantWebSocketError(messages, 'Disconnected'), messages);
});

test('the assistant sends the selected workspace and clears processing on socket failures', () => {
  const hook = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'useWebSocket.ts'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'assistant', 'page.tsx'), 'utf8');
  assert.match(hook, /organizationId\?: string/);
  assert.match(hook, /setError\('WebSocket connection error'\);\s*setIsConnecting\(false\);\s*setIsProcessing\(false\)/);
  assert.match(page, /seemplify_active_organization_id/);
  assert.match(page, /settleAssistantWebSocketError\(previous, wsError\)/);
});

test('a live socket cannot leave the assistant in a permanent thinking state', () => {
  const hook = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'useWebSocket.ts'), 'utf8');
  assert.match(hook, /ASSISTANT_RESPONSE_TIMEOUT_MS = 120_000/);
  assert.match(hook, /if \(!isProcessing\) return/);
  assert.match(hook, /did not finish within two minutes/);
  assert.match(hook, /setIsProcessing\(false\)/);
});
