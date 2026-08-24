import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(source, ...parts), 'utf8');

test('Experience renders and refreshes the authoritative IdP permission matrix', () => {
  const types = read('types.ts');
  const shell = read('components', 'AppShell.tsx');

  assert.match(types, /productPermissions\?: string\[\] \| null/u);
  assert.match(shell, /productPermissionEnabled\(session, 'spaces\.manage'\)/u);
  assert.match(shell, /routeProductPermission\(routePath\)/u);
  assert.match(shell, /Required: \{requiredProductPermission\}/u);
  assert.match(shell, /Open Identity administration/u);
  assert.match(shell, /api<AuthSession>\('\/api\/auth\/session'\)/u);
});
