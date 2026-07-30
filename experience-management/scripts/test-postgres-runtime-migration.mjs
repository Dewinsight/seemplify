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
    '--target-version', '2',
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
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE experience_schema_version (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
      version INTEGER NOT NULL,
      source_sha256 TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      manifest_json TEXT NOT NULL
    );
    INSERT INTO schema_migrations(version,name,applied_at) VALUES (1,'base','2026-01-01T00:00:00.000Z');
  `);
  await ownerClient.query(`INSERT INTO experience_schema_version(singleton,version,source_sha256,migrated_at,manifest_json)
    VALUES (TRUE,1,$1,'2026-01-01T00:00:00.000Z','{}')`, [sourceSha256]);

  runUpgrade();
  runUpgrade();
  await assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public' });
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 2);
  emit('upgrade_and_idempotency_passed');

  const wrongSource = spawnSync(process.execPath, [
    path.join(projectDir, 'scripts', 'upgrade-postgres-schema.mjs'), '--target-version', '2',
    '--expected-source-version', '1', '--expected-source-sha256', 'f'.repeat(64),
    '--pg-host', host, '--pg-port', String(port), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', passwordFile, '--pg-ssl', 'disable', '--json'
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.notEqual(wrongSource.status, 0);
  assert.match(wrongSource.stderr, /SOURCE_SCHEMA_PRECONDITION_FAILED/u);
  emit('source_precondition_passed');

  const sourceMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0002_platform_administration.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0002_platform_administration.sql'), sourceMigration.replace(/\r?\n/gu, '\r\n'));
  runUpgrade(['--migrations-dir', migrationDir]);
  fs.writeFileSync(path.join(migrationDir, '0003_intentional_failure.sql'), `CREATE TABLE should_rollback(id TEXT PRIMARY KEY);\nSELECT * FROM definitely_missing_table;\n`);
  const failedUpgrade = runUpgrade(['--target-version', '3', '--migrations-dir', migrationDir], 1);
  assert.match(failedUpgrade.stderr, /definitely_missing_table/u);
  assert.equal((await ownerClient.query("SELECT to_regclass('public.should_rollback') name")).rows[0].name, null);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 2);
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

  await ownerClient.query('DROP INDEX platform_audit_events_target');
  await assert.rejects(
    assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public' }),
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
