#!/usr/bin/env node

/** Destructive only to randomly named, isolated PostgreSQL test roles/database. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { assertRuntimePrivileges, assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.POSTGRES_TEST_CONTAINER || 'xplorer-postgres';
const host = process.env.POSTGRES_TEST_HOST || '127.0.0.1';
const port = Number(process.env.POSTGRES_TEST_PORT || 5432);
const suffix = crypto.randomBytes(5).toString('hex');
const database = `experience_migration_test_${suffix}`;
const ownerRole = `experience_owner_${suffix}`;
const appRole = `experience_app_${suffix}`;
const ownerPassword = crypto.randomBytes(24).toString('base64url');
const appPassword = crypto.randomBytes(24).toString('base64url');
const sourceSha256 = crypto.createHash('sha256').update(`source:${suffix}`).digest('hex');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-pg-runtime-'));
const passwordFile = path.join(temporaryDir, 'owner-password');
const migrationDir = path.join(temporaryDir, 'migrations');

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }

function dockerPsql(databaseName, sql, allowFailure = false) {
  const result = spawnSync('docker.exe', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-U', adminUser, '-d', databaseName], {
    input: sql,
    encoding: 'utf8',
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) throw new Error(`docker psql failed: ${result.stderr || result.stdout}`);
  return result;
}

function runUpgrade(extra = [], expectedStatus = 0) {
  const result = spawnSync(process.execPath, [
    path.join(projectDir, 'scripts', 'upgrade-postgres-schema.mjs'),
    '--target-version', '4',
    '--expected-source-version', '1',
    '--expected-source-sha256', sourceSha256,
    '--pg-host', host,
    '--pg-port', String(port),
    '--pg-database', database,
    '--pg-user', ownerRole,
    '--pg-password-file', passwordFile,
    '--pg-ssl', 'disable',
    '--json',
    ...extra
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, expectedStatus, `upgrade exit ${result.status}: ${result.stderr || result.stdout}`);
  return result;
}

const inspect = spawnSync('docker.exe', ['inspect', container], { encoding: 'utf8', windowsHide: true });
assert.equal(inspect.status, 0, `PostgreSQL test container ${container} is unavailable.`);
const containerDefinition = JSON.parse(inspect.stdout)[0];
const containerEnvironment = Object.fromEntries((containerDefinition.Config.Env || []).map((entry) => entry.split(/=(.*)/su).slice(0, 2)));
const adminUser = containerEnvironment.POSTGRES_USER;
const adminDatabase = containerEnvironment.POSTGRES_DB;
assert.ok(adminUser && adminDatabase, 'The PostgreSQL container does not expose its bootstrap identity.');

let ownerClient;
let appClient;
try {
  fs.writeFileSync(passwordFile, `${ownerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.mkdirSync(migrationDir);
  dockerPsql(adminDatabase, `
    CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(ownerPassword)};
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(appPassword)};
  `);
  dockerPsql(adminDatabase, `CREATE DATABASE ${database} OWNER ${ownerRole};`);
  dockerPsql(adminDatabase, `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT ON DATABASE ${database} TO ${ownerRole},${appRole};`);

  ownerClient = new Client({ host, port, database, user: ownerRole, password: ownerPassword, ssl: false });
  await ownerClient.connect();
  await ownerClient.query(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE spaces (id TEXT PRIMARY KEY);
    CREATE TABLE tickets (id TEXT PRIMARY KEY);
    CREATE TABLE ai_jobs (id TEXT PRIMARY KEY);
    CREATE TABLE knowledge_bases (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      current_version INTEGER NOT NULL DEFAULT 0, last_indexed_at TEXT,
      chunker_version TEXT NOT NULL DEFAULT 'docling-hybrid-v1',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,space_id)
    );
    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL,
      sha256 TEXT NOT NULL, index_version INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'queued', chunk_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE TABLE knowledge_jobs (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', target_version INTEGER
    );
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE experience_schema_version (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
      version INTEGER NOT NULL,
      source_sha256 TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      manifest_json TEXT NOT NULL
    );
    INSERT INTO schema_migrations(version,name,applied_at) VALUES (1,'base','2026-01-01T00:00:00.000Z');
    INSERT INTO spaces(id) VALUES ('legacy-space');
    INSERT INTO knowledge_bases(id,space_id,status,current_version,chunker_version,created_at,updated_at)
      VALUES ('legacy-base','legacy-space','ready',7,'docling-hybrid-v1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO knowledge_jobs(id,space_id,knowledge_base_id,state,target_version) VALUES
      ('legacy-failed-a','legacy-space','legacy-base','failed',8),
      ('legacy-failed-b','legacy-space','legacy-base','failed',8);
  `);
  await ownerClient.query(`INSERT INTO experience_schema_version(singleton,version,source_sha256,migrated_at,manifest_json)
    VALUES (TRUE,1,$1,'2026-01-01T00:00:00.000Z','{}')`, [sourceSha256]);

  await ownerClient.query(`CREATE TABLE assistant_runs (
    id TEXT PRIMARY KEY,space_id TEXT NOT NULL,requested_by TEXT NOT NULL,ai_job_id TEXT,
    created_at TEXT NOT NULL,idempotency_key TEXT
  )`);
  const malformedAssistant = runUpgrade([], 1);
  assert.match(malformedAssistant.stderr, /RUNTIME_SCHEMA_COLUMN_MISMATCH/u);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 3);
  await ownerClient.query('DROP TABLE assistant_runs');
  emit('malformed_assistant_schema_rejected');

  runUpgrade();
  runUpgrade();
  await assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 4 });
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 4);
  const assistantTables = (await ownerClient.query(`SELECT to_regclass(name) name FROM unnest(ARRAY[
    'assistant_nylas_connections','assistant_nylas_oauth_states','assistant_runs'
  ]) AS names(name)`)).rows;
  assert.ok(assistantTables.every((row) => row.name), 'Runtime schema 4 assistant tables are incomplete.');
  const assistantColumns = (await ownerClient.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND (table_name,column_name) IN (
      ('assistant_nylas_connections','grant_id_enc'),('assistant_nylas_connections','grant_fingerprint'),
      ('assistant_runs','input_snapshot_json'),('assistant_runs','request_fingerprint'),
      ('assistant_runs','advisory_only'),('assistant_runs','external_dispatched'))`)).rows;
  assert.equal(assistantColumns.length, 6, 'Runtime schema 4 assistant privacy/idempotency columns are incomplete.');
  const profiles = (await ownerClient.query(`SELECT provider,model,revision,dtype,dimensions,vector_index_version
    FROM knowledge_embedding_profiles ORDER BY vector_index_version`)).rows;
  assert.deepEqual(profiles.map((row) => [row.provider, row.dtype, Number(row.dimensions), row.vector_index_version]), [
    ['gte-node', 'q8', 768, 'gte-modernbert-v1'],
    ['qwen-tei', 'float16', 2560, 'qwen-v1']
  ]);
  const migrationTables = (await ownerClient.query(`SELECT to_regclass(name) name FROM unnest(ARRAY[
    'knowledge_base_embedding_profiles','knowledge_document_embeddings','knowledge_backfill_runs','knowledge_backfill_items'
  ]) AS names(name)`)).rows;
  assert.ok(migrationTables.every((row) => row.name), 'Runtime schema 3 embedding migration tables are incomplete.');
  assert.equal((await ownerClient.query(`SELECT COUNT(*)::int count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_jobs' AND column_name='embedding_profile_id'`)).rows[0].count, 1);
  const fencingIndexes = (await ownerClient.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('knowledge_jobs_one_processing_base','knowledge_jobs_unique_target_version') ORDER BY indexname`)).rows;
  assert.deepEqual(fencingIndexes.map((row) => row.indexname),
    ['knowledge_jobs_one_processing_base','knowledge_jobs_unique_target_version']);
  const leaseColumns = (await ownerClient.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_jobs' AND column_name IN
      ('lease_owner','lease_token','lease_generation','lease_acquired_at','lease_expires_at','heartbeat_at')`)).rows;
  assert.equal(leaseColumns.length, 6);
  const legacyReservations = await ownerClient.query(`SELECT COUNT(*)::int count,
    SUM(target_version_reserved)::int reserved FROM knowledge_jobs WHERE knowledge_base_id='legacy-base' AND target_version=8`);
  assert.deepEqual(legacyReservations.rows[0], { count: 2, reserved: 0 });
  assert.equal(Number((await ownerClient.query(`SELECT last_allocated_version FROM knowledge_bases
    WHERE id='legacy-base'`)).rows[0].last_allocated_version), 8);
  emit('upgrade_and_idempotency_passed');

  const wrongSource = spawnSync(process.execPath, [
    path.join(projectDir, 'scripts', 'upgrade-postgres-schema.mjs'), '--target-version', '4',
    '--expected-source-version', '1', '--expected-source-sha256', 'f'.repeat(64),
    '--pg-host', host, '--pg-port', String(port), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', passwordFile, '--pg-ssl', 'disable', '--json'
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.notEqual(wrongSource.status, 0);
  assert.match(wrongSource.stderr, /SOURCE_SCHEMA_PRECONDITION_FAILED/u);
  emit('source_precondition_passed');

  const sourceMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0002_platform_administration.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0002_platform_administration.sql'), sourceMigration.replace(/\r?\n/gu, '\r\n'));
  const embeddingMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0003_knowledge_embedding_profiles.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0003_knowledge_embedding_profiles.sql'), embeddingMigration.replace(/\r?\n/gu, '\r\n'));
  const assistantMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0004_experience_assistant.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0004_experience_assistant.sql'), assistantMigration.replace(/\r?\n/gu, '\r\n'));
  runUpgrade(['--migrations-dir', migrationDir]);
  fs.writeFileSync(path.join(migrationDir, '0005_intentional_failure.sql'), `CREATE TABLE should_rollback(id TEXT PRIMARY KEY);\nSELECT * FROM definitely_missing_table;\n`);
  const failedUpgrade = runUpgrade(['--target-version', '5', '--migrations-dir', migrationDir], 1);
  assert.match(failedUpgrade.stderr, /definitely_missing_table/u);
  assert.equal((await ownerClient.query("SELECT to_regclass('public.should_rollback') name")).rows[0].name, null);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 4);
  emit('checksum_normalization_and_rollback_passed');

  let privilegeSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', 'runtime_privileges.sql'), 'utf8');
  privilegeSql = privilegeSql.replaceAll('__DATABASE__', database).replaceAll('__APP_ROLE__', appRole).replaceAll('__OWNER_ROLE__', ownerRole);
  dockerPsql(database, privilegeSql);
  await assertRuntimePrivileges((sql) => ownerClient.query(sql), appRole, { schema: 'public' });
  appClient = new Client({ host, port, database, user: appRole, password: appPassword, ssl: false });
  await appClient.connect();
  await assert.rejects(appClient.query("UPDATE experience_schema_version SET migrated_at='changed'"), (error) => error?.code === '42501');
  await assert.rejects(appClient.query("DELETE FROM platform_audit_events"), (error) => error?.code === '42501');
  await appClient.query(`INSERT INTO platform_audit_events
    (id,action,target_type,target_id,created_at) VALUES ('test','read','test','test','2026-01-01T00:00:00.000Z')`);
  emit('atomic_least_privilege_passed');

  await ownerClient.query('BEGIN');
  try {
    await ownerClient.query('ALTER TABLE assistant_runs DROP COLUMN output_json');
    await assert.rejects(
      assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 4 }),
      (error) => error?.code === 'RUNTIME_SCHEMA_COLUMN_MISMATCH'
    );
  } finally { await ownerClient.query('ROLLBACK'); }
  emit('assistant_schema_drift_detection_passed');

  await ownerClient.query('DROP INDEX platform_audit_events_target');
  await assert.rejects(
    assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 4 }),
    (error) => error?.code === 'RUNTIME_SCHEMA_INDEX_MISMATCH'
  );
  emit('schema_drift_detection_passed');
  emit('postgres_runtime_migration_tests_passed', { database });
} finally {
  await appClient?.end().catch(() => {});
  await ownerClient?.end().catch(() => {});
  dockerPsql(adminDatabase, `
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${literal(database)} AND pid<>pg_backend_pid();
    DROP DATABASE IF EXISTS ${database};
    DROP ROLE IF EXISTS ${appRole};
    DROP ROLE IF EXISTS ${ownerRole};
  `, true);
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
