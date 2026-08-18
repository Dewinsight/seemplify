import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(source, ...segments), 'utf8');

test('the blocking ChatGPT connection gate keeps application sign-out explicit', () => {
  const gate = read('components', 'settings', 'ChatGptConnectionGate.tsx');
  const shell = read('components', 'AppShell.tsx');

  assert.match(gate, /onSignOut: \(\) => void \| Promise<void>/);
  assert.match(gate, /data-testid="chatgpt-gate-sign-out"/);
  assert.match(gate, /<LogOut \/>\}Sign out of Seemplify/);
  assert.match(gate, /device-login\/cancel[\s\S]*await onSignOut\(\)/);
  assert.match(shell, /onSignOut=\{signOutOfApplication\}/);
  assert.match(shell, /api\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
});

test('the gate can disconnect ChatGPT and remain ready for another account', () => {
  const gate = read('components', 'settings', 'ChatGptConnectionGate.tsx');

  assert.match(gate, /data-testid="chatgpt-gate-disconnect"/);
  assert.match(gate, /Disconnect ChatGPT/);
  assert.match(gate, /api<AiProviderState>\('\/api\/ai-provider\/codex\/disconnect', json\('POST', \{\}\)\)/);
  assert.match(gate, /publishState\(next, true\)/);
  assert.match(gate, /data-testid="chatgpt-gate-connect"[\s\S]*Connect ChatGPT/);
});
