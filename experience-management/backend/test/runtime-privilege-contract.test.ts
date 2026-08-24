import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * STATIC registration test for table-creating runtimes 27-31 and 34.
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * source TEXT. This file does NOT create a database, does NOT apply a migration
 * and does NOT execute a single statement, so it is NOT executed-PostgreSQL
 * proof and must not be recorded as one. It cannot observe whether a GRANT takes
 * effect, whether the presence loop actually raises, or any plpgsql behaviour.
 *
 * What it does prove is the drift class that runtimes 27-29 shipped: a table
 * created by a migration but never registered in one of the three lists that are
 * supposed to describe it. Each list fails differently when it is short, which is
 * why none of them caught the others:
 *
 *   runtime_privileges.sql presence loop  fail-closed gate. A table missing here
 *                                         lets the file apply cleanly against a
 *                                         database that never created it, so the
 *                                         grants silently cover less than claimed.
 *   runtimeExtensionTables()              drives runtimeTableSetDifference. A
 *                                         table missing here reads as an unknown,
 *                                         unexpected table on a correct database.
 *   assertRuntimePrivileges expectations  a table missing here is never checked,
 *                                         so an over-broad grant on it is invisible.
 *
 * Runtimes 18-26 were exhaustive in all three; 27-31 were not, and no test paired
 * them (knowledge-embedding-config.test.ts stops at runtime 22 and checks one
 * runtime at a time). This pairs all three lists for every runtime 27-29 object so
 * the omission cannot recur in later table-creating runtimes.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const contractSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
const privilegeSource = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');

const RUNTIMES = [
  { version: 27, file: '0027_journey_portfolio.sql' },
  { version: 28, file: '0028_journey_collaboration.sql' },
  { version: 29, file: '0029_journey_hierarchy_blueprints.sql' },
  { version: 30, file: '0030_journey_stage_reprojection.sql' },
  { version: 31, file: '0031_journey_identity_profiles.sql' },
  { version: 34, file: '0034_idp_space_authorizations.sql' }
] as const;

/** Only top-of-line CREATE TABLE is a declaration; the same text inside a comment is prose. */
const createdTables = (file: string): string[] => [
  ...fs.readFileSync(path.join(migrationRoot, file), 'utf8')
    .matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(/gmu)
].map((match) => match[1]!);

const quotedNames = (source: string): string[] =>
  [...source.matchAll(/'([a-z_][a-z0-9_]*)'/gu)].map((match) => match[1]!);

const region = (source: string, open: string, close: string): string => {
  const start = source.indexOf(open);
  assert.notEqual(start, -1, `the source no longer contains ${open}`);
  const end = source.indexOf(close, start);
  assert.ok(end > start, `the source no longer contains ${close} after ${open}`);
  return source.slice(start, end);
};

/**
 * Splits a region into per-runtime blocks keyed by the version in its guard, so a
 * name registered under the wrong runtime fails rather than passing on presence.
 */
const versionBlocks = (source: string, variable: string): Map<number, string> => {
  const markers = [...source.matchAll(new RegExp(String.raw`if \(${variable} >= (\d+)\) \{`, 'gu'))];
  assert.ok(markers.length > 0, `no ${variable} version guards found`);
  const blocks = new Map<number, string>();
  markers.forEach((match, index) => {
    const from = match.index! + match[0].length;
    const to = markers[index + 1]?.index ?? source.length;
    blocks.set(Number(match[1]!), source.slice(from, to));
  });
  return blocks;
};

const presenceGate = new Set(quotedNames(
  region(privilegeSource, 'DO $seemplify_privilege_contract$', '$seemplify_privilege_contract$;')));

const extensionBlocks = versionBlocks(
  region(contractSource, 'export function runtimeExtensionTables(', 'export const RUNTIME_EXTENSION_TABLES'),
  'runtimeVersion');

const privilegeBlocks = versionBlocks(
  region(contractSource, 'export async function assertRuntimePrivileges(',
    'for (const [table, select, insert, update, remove] of expectations)'),
  'privilegeRuntimeVersion');

for (const { version, file } of RUNTIMES) {
  test(`every runtime-${version} table is registered in all three runtime contracts`, () => {
    const created = createdTables(file);
    assert.ok(created.length > 0, `${file} must declare tables`);
    assert.deepEqual([...new Set(created)], created, `${file} must not declare a table twice`);

    // Fail-closed presence gate. Without the name, runtime_privileges.sql applies
    // cleanly against a database that never ran this migration.
    const ungated = created.filter((table) => !presenceGate.has(table));
    assert.deepEqual(ungated, [],
      `runtime_privileges.sql must gate every runtime-${version} table before granting on it`);

    // Extension tables are order-sensitive: they are compared against the live
    // catalogue, so a name under the wrong version guard misreports either an
    // unknown table or a missing one.
    assert.deepEqual(quotedNames(extensionBlocks.get(version) ?? ''), created,
      `runtimeExtensionTables must list exactly the runtime-${version} tables, in migration order`);

    assert.deepEqual(quotedNames(privilegeBlocks.get(version) ?? ''), created,
      `assertRuntimePrivileges must expect a privilege set for exactly the runtime-${version} tables`);
  });
}

test('runtime-32 snapshots managed storage coordinates on every persisted upload table', () => {
  const source = fs.readFileSync(path.join(migrationRoot, '0032_managed_file_storage.sql'), 'utf8');
  for (const table of [
    'uploads',
    'knowledge_documents',
    'knowledge_file_cleanup',
    'journey_asset_blob_purge_outbox',
  ]) {
    assert.match(source, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_provider`, 'u'));
    assert.match(source, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_key`, 'u'));
    assert.match(source, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_container`, 'u'));
    assert.match(source, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_resource_type`, 'u'));
    assert.match(source, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_url`, 'u'));
  }

  const outboxContract = /journey_asset_blob_purge_outbox:\s*\[([\s\S]*?)\n\s*\],/u.exec(contractSource)?.[1] ?? '';
  for (const column of ['storage_provider', 'storage_key', 'storage_container', 'storage_resource_type', 'storage_url']) {
    assert.match(outboxContract, new RegExp(`\\['${column}'`, 'u'),
      `the runtime-32 exact column contract must include ${column}`);
  }
});

test('runtime-33 replaces fresh and cutover provider checks before seeding Azure embeddings', () => {
  const source = fs.readFileSync(path.join(migrationRoot, '0033_azure_knowledge_embeddings.sql'), 'utf8');
  assert.match(source, /pg_get_constraintdef\(constraint_record\.oid\) ILIKE '%provider%'/u);
  assert.match(source, /DROP CONSTRAINT %I/u);
  assert.match(source, /CHECK\(provider IN \('azure-openai','qwen-tei','gte-node'\)\)/u);
  assert.ok(source.indexOf('DROP CONSTRAINT %I') < source.indexOf("'azure-text-embedding-3-large-v1','azure-openai'"));
});

test('runtime-34 persists the authoritative IdP permission matrix by space membership', () => {
  const source = fs.readFileSync(path.join(migrationRoot, '0034_idp_space_authorizations.sql'), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS idp_space_authorizations/u);
  assert.match(source, /PRIMARY KEY\(space_id,user_id\)/u);
  assert.match(source, /REFERENCES space_memberships\(space_id,user_id\) ON DELETE CASCADE/u);
  assert.match(source, /authorization_revision INTEGER/u);
});

test('production provisions only the Experience shared-AI credential for knowledge graph extraction', () => {
  const workflow = fs.readFileSync(
    path.resolve(backendRoot, '..', '..', '.github', 'workflows', 'deploy-experience-hostinger.yml'), 'utf8');
  assert.match(workflow, /\$1=="EXPERIENCE_AI_SHARED_SECRET"/u);
  assert.doesNotMatch(workflow, /printf '%s' "\$gateway_secret" >"\$knowledge_secret_dir\/chatgpt-gateway"/u);
  assert.match(workflow, /seemplify-core-recruiter-backend-1/u);
  assert.doesNotMatch(workflow, /CHATGPT_GATEWAY_SHARED_SECRET/u,
    'the knowledge runtime must not receive the hosted gateway master secret');
});

test('the runtime contracts stay pinned to the shipped compatibility window', () => {
  const compatibility = JSON.parse(
    fs.readFileSync(path.join(migrationRoot, 'runtime-compatibility.json'), 'utf8')) as {
      minimumRuntimeSchemaVersion: number; maximumRuntimeSchemaVersion: number;
    };
  // Runtime 34 persists the IdP permission matrix beside each mirrored space membership.
  assert.equal(compatibility.maximumRuntimeSchemaVersion, 34);
  assert.equal(compatibility.minimumRuntimeSchemaVersion, 34);
  assert.match(contractSource, /LATEST_RUNTIME_SCHEMA_VERSION = 34/u);
  const beyondWindow = fs.readdirSync(migrationRoot)
    .map((name) => /^(\d{4})_.*\.sql$/u.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter((match) => Number(match[1]!) > 34)
    .map((match) => match[0]);
  assert.deepEqual(beyondWindow, [],
    'a migration past runtime-34 must be registered before it can ship');
});
