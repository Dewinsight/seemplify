import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  RUNTIME_EXTENSION_TABLES,
  runtimeTableSetDifference
} from '../../scripts/postgres-runtime-contract.mjs';

const migrationDirectory = path.resolve(import.meta.dirname, '..', '..', 'backend', 'migrations', 'postgres');

function tablesCreatedByRuntimeMigrations() {
  return fs.readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
    .flatMap((name) => {
      const sql = fs.readFileSync(path.join(migrationDirectory, name), 'utf8');
      return [...sql.matchAll(/^CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*)/gimu)]
        .map((match) => match[1]);
    });
}

test('allows every migration-owned runtime table and no arbitrary tables', () => {
  const legitimateExtensions = new Set([
    'experience_runtime_schema_version',
    ...tablesCreatedByRuntimeMigrations()
  ]);
  const verifierExtensions = new Set(RUNTIME_EXTENSION_TABLES);

  assert.deepEqual(
    [...verifierExtensions].sort(),
    [...legitimateExtensions].sort(),
    'The verifier extension allowlist must exactly match migration-owned runtime tables.'
  );

  const sourceTables = ['users', 'spaces'];
  const legitimateActualTables = [...sourceTables, ...verifierExtensions];
  assert.deepEqual(runtimeTableSetDifference(sourceTables, legitimateActualTables), {
    unknownTables: [],
    missingTables: []
  });
  assert.deepEqual(
    runtimeTableSetDifference(sourceTables, [...legitimateActualTables, 'unexpected_runtime_table']),
    { unknownTables: ['unexpected_runtime_table'], missingTables: [] }
  );
});
