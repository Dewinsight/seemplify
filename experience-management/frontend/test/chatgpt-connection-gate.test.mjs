import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(source, ...segments), 'utf8');

test('the blocking ChatGPT connection gate always offers application sign-out', () => {
  const gate = read('components', 'settings', 'ChatGptConnectionGate.tsx');
  const shell = read('components', 'AppShell.tsx');

  assert.match(gate, /onSignOut: \(\) => void \| Promise<void>/);
  assert.match(gate, /data-testid="chatgpt-gate-sign-out"/);
  assert.match(gate, /<LogOut \/>\}Sign out/);
  assert.match(gate, /device-login\/cancel[\s\S]*await onSignOut\(\)/);
  assert.match(shell, /onSignOut=\{signOutOfApplication\}/);
  assert.match(shell, /api\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
});
