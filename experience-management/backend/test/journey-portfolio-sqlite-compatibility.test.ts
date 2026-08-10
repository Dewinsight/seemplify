import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('upgrades an existing SQLite portfolio owner FK without losing data, indexes, or child references', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(process.execPath, ['--import', 'tsx',
    path.join(root, 'test/fixtures/journey-portfolio-sqlite-compatibility-probe.ts')], {
    cwd: root, encoding: 'utf8', env: { ...process.env }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
