#!/usr/bin/env node

/**
 * Run the complete Playwright matrix against an isolated PostgreSQL database.
 * The database and roles are randomly named and are removed in finally, even
 * when provisioning, verification, or a browser test fails.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suffix = crypto.randomBytes(6).toString('hex');
const requestedContainer = String(process.env.POSTGRES_TEST_CONTAINER || '').trim();
const usesEphemeralContainer = !requestedContainer;
const container = requestedContainer || `experience-pg-e2e-${suffix}`;
const postgresImage = process.env.POSTGRES_TEST_IMAGE || 'postgres:16-alpine';
const host = process.env.POSTGRES_TEST_HOST || '127.0.0.1';
let port = Number(process.env.POSTGRES_TEST_PORT || 0);
const database = `experience_e2e_${suffix}`;
const ownerRole = `experience_e2e_owner_${suffix}`;
const appRole = `experience_e2e_app_${suffix}`;
const ownerPassword = crypto.randomBytes(24).toString('base64url');
const appPassword = crypto.randomBytes(24).toString('base64url');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-pg-e2e-'));
const sqlitePath = path.join(temporaryDir, 'source.sqlite');
const ownerPasswordFile = path.join(temporaryDir, 'owner-password');
const appPasswordFile = path.join(temporaryDir, 'app-password');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const npmCli = process.env.npm_execpath
  || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const playwrightCli = path.join(projectDir, 'node_modules', '@playwright', 'test', 'cli.js');
const contractOnly = process.argv.includes('--contract-only');
const playwrightArguments = process.argv.slice(2).filter((argument) => argument !== '--contract-only');

function emit(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status}): ${result.stderr || result.stdout || 'no output'}`);
  }
  return result;
}

function runExpectedFailure(command, args, expectedPattern, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, `${path.basename(command)} unexpectedly succeeded.`);
  assert.match(`${result.stderr || ''}\n${result.stdout || ''}`, expectedPattern);
  return result;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertE2eServerPortAvailable() {
  const probe = spawnSync(process.execPath, ['-e', `
    const net = require('node:net');
    const server = net.createServer();
    server.unref();
    server.once('error', () => process.exit(1));
    server.listen(5412, '127.0.0.1', () => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(2), 3000).unref();
  `], { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error('The PostgreSQL E2E server requires free loopback port 5412; another test server is already running.');
  }
}

let adminUser = '';
let adminDatabase = '';
let ephemeralContainerStarted = false;
function dockerPsql(databaseName, sql, allowFailure = false) {
  const result = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q',
    '-U', adminUser, '-d', databaseName
  ], {
    input: sql,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error && !allowFailure) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker psql failed (${result.status}): ${result.stderr || result.stdout || 'no output'}`);
  }
  return result;
}

function inspectContainer() {
  const inspect = run(dockerCommand, ['inspect', container]);
  const definition = JSON.parse(inspect.stdout)[0];
  assert.ok(definition, `PostgreSQL container ${container} could not be inspected.`);
  return definition;
}

// A killed run cannot clean up after itself: Playwright is spawned with
// spawnSync, so the parent event loop is blocked for the whole suite and no
// signal handler could ever reach the finally block below. Sweeping the
// strictly-named leftovers of earlier runs is therefore the only cleanup that
// survives a kill. assertE2eServerPortAvailable() has already proven no other
// full run holds port 5412, so nothing removed here can belong to a live run.
function sweepStaleEphemeralContainers() {
  const listed = spawnSync(dockerCommand,
    ['ps', '--all', '--filter', 'name=experience-pg-e2e-', '--format', '{{.Names}}'],
    { encoding: 'utf8', windowsHide: true });
  if (listed.status !== 0) return;
  const stale = String(listed.stdout || '').trim().split(/\r?\n/u)
    .filter((name) => /^experience-pg-e2e-[a-f0-9]{12}$/u.test(name) && name !== container);
  for (const name of stale) {
    spawnSync(dockerCommand, ['rm', '--force', '--', name], { encoding: 'utf8', windowsHide: true });
  }
  if (stale.length) emit('postgres_e2e_stale_containers_removed', { containers: stale });
}

function configureContainer() {
  if (usesEphemeralContainer) {
    // --contract-only skips the exclusive-port assertion, so it cannot prove a
    // concurrent run is absent and must not sweep.
    if (!contractOnly) sweepStaleEphemeralContainers();
    const adminPassword = crypto.randomBytes(24).toString('base64url');
    run(dockerCommand, [
      'run', '--detach', '--rm', '--name', container,
      '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_DB=postgres',
      '--env', `POSTGRES_PASSWORD=${adminPassword}`,
      '--publish', port ? `127.0.0.1:${port}:5432` : '127.0.0.1::5432', postgresImage
    ]);
    ephemeralContainerStarted = true;
  }

  const definition = inspectContainer();
  const containerEnvironment = Object.fromEntries((definition.Config.Env || [])
    .map((entry) => entry.split(/=(.*)/su).slice(0, 2)));
  adminUser = containerEnvironment.POSTGRES_USER || 'postgres';
  adminDatabase = containerEnvironment.POSTGRES_DB || adminUser;

  const published = definition.NetworkSettings?.Ports?.['5432/tcp'] || [];
  assert.equal(published.length, 1, `PostgreSQL container ${container} must publish exactly one loopback port.`);
  assert.ok(['127.0.0.1', '::1'].includes(published[0].HostIp), 'PostgreSQL test port must be bound to loopback.');
  const publishedPort = Number(published[0].HostPort);
  assert.ok(Number.isInteger(publishedPort) && publishedPort > 0 && publishedPort <= 65_535,
    'The PostgreSQL container has an invalid published port.');
  if (port) assert.equal(port, publishedPort, 'POSTGRES_TEST_PORT does not match the inspected container mapping.');
  port = publishedPort;

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const ready = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-q', '-U', adminUser, '-d', adminDatabase], {
      encoding: 'utf8', windowsHide: true
    });
    if (ready.status === 0) return;
    if (attempt < 60) wait(500);
  }
  throw new Error(`PostgreSQL container ${container} did not become ready within 30 seconds.`);
}

function parseEvent(output, event) {
  const records = String(output || '').split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const record = records.findLast((item) => item.event === event);
  if (!record) throw new Error(`Expected ${event} in command output.`);
  return record;
}

function postgresEnvironment(sourceSha256) {
  return {
    ...process.env,
    DOTENV_CONFIG_QUIET: 'true',
    DATABASE_PROVIDER: 'postgres',
    POSTGRES_HOST: host,
    POSTGRES_PORT: String(port),
    POSTGRES_DATABASE: database,
    POSTGRES_USER: appRole,
    POSTGRES_PASSWORD_FILE: appPasswordFile,
    POSTGRES_SSL: 'disable',
    POSTGRES_SCHEMA_VERSION: '1',
    POSTGRES_RUNTIME_SCHEMA_VERSION: '29',
    POSTGRES_SOURCE_SHA256: sourceSha256,
    EXPERIENCE_E2E_DATABASE_PROVIDER: 'postgres',
    EXPERIENCE_POSTGRES_E2E_RUN_ID: suffix,
    PLAYWRIGHT_EXTERNAL_URL: '',
    KNOWLEDGE_E2E_LIVE: process.env.KNOWLEDGE_E2E_LIVE || ''
  };
}

let mainSucceeded = false;
try {
  assert.ok(['127.0.0.1', '::1', 'localhost'].includes(host), 'PostgreSQL E2E is restricted to a loopback host.');
  assert.match(database, /^experience_e2e_[a-f0-9]{12}$/u);
  assert.match(ownerRole, /^experience_e2e_owner_[a-f0-9]{12}$/u);
  assert.match(appRole, /^experience_e2e_app_[a-f0-9]{12}$/u);
  assert.ok(port === 0 || (Number.isInteger(port) && port > 0 && port <= 65_535), 'POSTGRES_TEST_PORT is invalid.');
  assert.ok(fs.existsSync(npmCli), `npm CLI was not found at ${npmCli}.`);
  if (!contractOnly) {
    assert.ok(fs.existsSync(playwrightCli), `Playwright CLI was not found at ${playwrightCli}.`);
    assertE2eServerPortAvailable();
  }

  configureContainer();
  emit('postgres_e2e_container_ready', { container, ephemeral: usesEphemeralContainer, port });

  emit('postgres_e2e_build_started', { contractOnly });
  run(process.execPath, contractOnly
    ? [npmCli, 'run', 'build', '--workspace', 'backend']
    : [npmCli, 'run', 'build']);
  emit('postgres_e2e_build_complete', { contractOnly });
  run(process.execPath, ['scripts/bootstrap-sqlite-store.mjs', '--sqlite', sqlitePath, '--json']);
  fs.writeFileSync(ownerPasswordFile, `${ownerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(appPasswordFile, `${appPassword}\n`, { encoding: 'utf8', mode: 0o600 });

  dockerPsql(adminDatabase, `
    CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(ownerPassword)};
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(appPassword)};
  `);
  dockerPsql(adminDatabase, `CREATE DATABASE ${database} OWNER ${ownerRole};`);
  dockerPsql(adminDatabase, `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT ON DATABASE ${database} TO ${ownerRole},${appRole};`);
  emit('postgres_e2e_database_created', { database });

  const migrated = run(process.execPath, [
    'scripts/migrate-sqlite-to-postgres.mjs', '--mode', 'migrate', '--sqlite', sqlitePath,
    '--backup-dir', path.join(temporaryDir, 'backups'), '--pg-host', host,
    '--pg-port', String(port), '--pg-database', database, '--pg-user', ownerRole,
    '--pg-password-file', ownerPasswordFile, '--pg-ssl', 'disable', '--json'
  ]);
  const migration = parseEvent(migrated.stdout, 'migration_complete');
  const sourceSha256 = String(migration.sourceSha256 || '');
  assert.match(sourceSha256, /^[a-f0-9]{64}$/u);

  const upgradeArgs = (targetVersion, migrationsDir = '') => [
    'scripts/upgrade-postgres-schema.mjs', '--target-version', String(targetVersion),
    '--expected-source-version', '1', '--expected-source-sha256', sourceSha256,
    '--pg-host', host, '--pg-port', String(port), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', ownerPasswordFile,
    '--pg-ssl', 'disable', '--json',
    ...(migrationsDir ? ['--migrations-dir', migrationsDir] : [])
  ];

  run(process.execPath, upgradeArgs(15));
  const rollbackMigrations = path.join(temporaryDir, 'rollback-migrations');
  fs.mkdirSync(rollbackMigrations);
  const committedMigrations = path.join(projectDir, 'backend', 'migrations', 'postgres');
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(rollbackMigrations, name), name.startsWith('0016_')
      ? `${source}\nSELECT * FROM journey_runtime_16_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(16, rollbackMigrations), /journey_runtime_16_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_16_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>15 THEN
        RAISE EXCEPTION 'failed runtime-16 migration advanced the ledger';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_event_schema_version_immutable_guard_trigger') THEN
        RAISE EXCEPTION 'failed runtime-16 migration left its trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_event_credentials_source_tenant_environment_fk') THEN
        RAISE EXCEPTION 'failed runtime-16 migration left its constraint behind';
      END IF;
    END
  $runtime_16_rollback$;`);
  emit('postgres_runtime_16_rollback_passed', { database });

  run(process.execPath, upgradeArgs(16));
  run(process.execPath, upgradeArgs(16));
  emit('postgres_runtime_16_replay_passed', { database });

  const runtime17RollbackMigrations = path.join(temporaryDir, 'runtime-17-rollback-migrations');
  fs.mkdirSync(runtime17RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime17RollbackMigrations, name), name.startsWith('0017_')
      ? `${source}\nSELECT * FROM journey_runtime_17_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(17, runtime17RollbackMigrations),
    /journey_runtime_17_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_17_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>16 THEN
        RAISE EXCEPTION 'failed runtime-17 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_raw_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-17 migration left raw-event storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_event_data_audit_append_only_trigger') THEN
        RAISE EXCEPTION 'failed runtime-17 migration left its append-only trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_raw_events_schema_version_tenant_source_fk') THEN
        RAISE EXCEPTION 'failed runtime-17 migration left its tenant/source constraint behind';
      END IF;
    END
  $runtime_17_rollback$;`);
  emit('postgres_runtime_17_rollback_passed', { database });

  run(process.execPath, upgradeArgs(17));
  run(process.execPath, upgradeArgs(17));
  emit('postgres_runtime_17_replay_passed', { database });

  const runtime18RollbackMigrations = path.join(temporaryDir, 'runtime-18-rollback-migrations');
  fs.mkdirSync(runtime18RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime18RollbackMigrations, name), name.startsWith('0018_')
      ? `${source}\nSELECT * FROM journey_runtime_18_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(18, runtime18RollbackMigrations),
    /journey_runtime_18_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_18_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>17 THEN
        RAISE EXCEPTION 'failed runtime-18 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_stage_rule_definitions') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-18 migration left stage-rule storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_stage_rule_decisions_append_only_trigger') THEN
        RAISE EXCEPTION 'failed runtime-18 migration left its append-only trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_anonymous_instances_latest_visit_fk') THEN
        RAISE EXCEPTION 'failed runtime-18 migration left its visit-projection constraint behind';
      END IF;
    END
  $runtime_18_rollback$;`);
  emit('postgres_runtime_18_rollback_passed', { database });

  run(process.execPath, upgradeArgs(18));
  run(process.execPath, upgradeArgs(18));
  emit('postgres_runtime_18_replay_passed', { database });

  // A freshly imported SQLite source can already carry this candidate key.
  // Remove the named copy so the failed-runtime-19 probe proves that 0019's
  // own CREATE UNIQUE INDEX is rolled back atomically.
  dockerPsql(database, 'DROP INDEX IF EXISTS knowledge_documents_research_tenant_identity;');

  const runtime19RollbackMigrations = path.join(temporaryDir, 'runtime-19-rollback-migrations');
  fs.mkdirSync(runtime19RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime19RollbackMigrations, name), name.startsWith('0019_')
      ? `${source}\nSELECT * FROM journey_runtime_19_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(19, runtime19RollbackMigrations),
    /journey_runtime_19_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_19_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>18 THEN
        RAISE EXCEPTION 'failed runtime-19 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_research_sources') IS NOT NULL
         OR to_regclass('public.journey_research_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-19 migration left research-hub storage behind';
      END IF;
      IF to_regclass('public.knowledge_documents_research_tenant_identity') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-19 migration left its tenant identity index behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_research_audit_append_only_trigger') THEN
        RAISE EXCEPTION 'failed runtime-19 migration left its append-only trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_research_intakes_document_base_tenant_fk') THEN
        RAISE EXCEPTION 'failed runtime-19 migration left its intake tenant constraint behind';
      END IF;
    END
  $runtime_19_rollback$;`);
  emit('postgres_runtime_19_rollback_passed', { database });

  run(process.execPath, upgradeArgs(19));
  run(process.execPath, upgradeArgs(19));
  emit('postgres_runtime_19_replay_passed', { database });

  const runtime20RollbackMigrations = path.join(temporaryDir, 'runtime-20-rollback-migrations');
  fs.mkdirSync(runtime20RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime20RollbackMigrations, name), name.startsWith('0020_')
      ? `${source}\nSELECT * FROM journey_runtime_20_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(20, runtime20RollbackMigrations),
    /journey_runtime_20_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_20_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>19 THEN
        RAISE EXCEPTION 'failed runtime-20 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_v2_rollout_platform') IS NOT NULL
         OR to_regclass('public.journey_v2_rollout_spaces') IS NOT NULL
         OR to_regclass('public.journey_v2_divergences') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-20 migration left rollout storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_v2_divergences_append_only_trigger') THEN
        RAISE EXCEPTION 'failed runtime-20 migration left its append-only trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM platform_rbac_role_permissions WHERE permission LIKE 'journey_rollout.%') THEN
        RAISE EXCEPTION 'failed runtime-20 migration left rollout permissions behind';
      END IF;
    END
  $runtime_20_rollback$;`);
  emit('postgres_runtime_20_rollback_passed', { database });

  run(process.execPath, upgradeArgs(20));
  run(process.execPath, upgradeArgs(20));
  emit('postgres_runtime_20_replay_passed', { database });

  const runtime21RollbackMigrations = path.join(temporaryDir, 'runtime-21-rollback-migrations');
  fs.mkdirSync(runtime21RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime21RollbackMigrations, name), name.startsWith('0021_')
      ? `${source}\nSELECT * FROM journey_runtime_21_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(21, runtime21RollbackMigrations),
    /journey_runtime_21_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_21_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>20 THEN
        RAISE EXCEPTION 'failed runtime-21 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_metric_definitions') IS NOT NULL
         OR to_regclass('public.journey_metric_observations') IS NOT NULL
         OR to_regclass('public.journey_metric_rebuild_runs') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-21 migration left metric storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_metric_observations_append_only') THEN
        RAISE EXCEPTION 'failed runtime-21 migration left its append-only trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM platform_rbac_role_permissions WHERE permission LIKE 'journey_metrics.%') THEN
        RAISE EXCEPTION 'failed runtime-21 migration left metric permissions behind';
      END IF;
    END
  $runtime_21_rollback$;`);
  emit('postgres_runtime_21_rollback_passed', { database });

  run(process.execPath, upgradeArgs(21));
  run(process.execPath, upgradeArgs(21));
  emit('postgres_runtime_21_replay_passed', { database });

  const runtime22RollbackMigrations = path.join(temporaryDir, 'runtime-22-rollback-migrations');
  fs.mkdirSync(runtime22RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime22RollbackMigrations, name), name.startsWith('0022_')
      ? `${source}\nSELECT * FROM journey_runtime_22_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(22, runtime22RollbackMigrations),
    /journey_runtime_22_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_22_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>21 THEN
        RAISE EXCEPTION 'failed runtime-22 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_ai_suggestion_runs') IS NOT NULL
         OR to_regclass('public.journey_ai_suggestion_changes') IS NOT NULL
         OR to_regclass('public.journey_ai_suggestion_purge_receipts') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-22 migration left suggestion storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journey_ai_suggestion_changes_immutable') THEN
        RAISE EXCEPTION 'failed runtime-22 migration left its immutable trigger behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='journey_ai_suggestion_controlled_purge') THEN
        RAISE EXCEPTION 'failed runtime-22 migration left its maintenance function behind';
      END IF;
    END
  $runtime_22_rollback$;`);
  emit('postgres_runtime_22_rollback_passed', { database });

  run(process.execPath, upgradeArgs(22));
  run(process.execPath, upgradeArgs(22));
  emit('postgres_runtime_22_replay_passed', { database });

  const runtime23RollbackMigrations = path.join(temporaryDir, 'runtime-23-rollback-migrations');
  fs.mkdirSync(runtime23RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime23RollbackMigrations, name), name.startsWith('0023_')
      ? `${source}\nSELECT * FROM journey_runtime_23_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(23, runtime23RollbackMigrations),
    /journey_runtime_23_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_23_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>22 THEN
        RAISE EXCEPTION 'failed runtime-23 migration advanced the ledger';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_personas_current_version_required','journey_persona_versions_immutable',
        'journey_persona_claims_immutable','journey_map_version_personas_immutable'
      )) THEN
        RAISE EXCEPTION 'failed runtime-23 migration left persona integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_personas_current_version_tenant_fk','journey_persona_claims_version_tenant_fk',
        'journey_map_version_personas_persona_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-23 migration left persona tenant constraints behind';
      END IF;
    END
  $runtime_23_rollback$;`);
  emit('postgres_runtime_23_rollback_passed', { database });

  run(process.execPath, upgradeArgs(23));
  run(process.execPath, upgradeArgs(23));
  emit('postgres_runtime_23_replay_passed', { database });

  const runtime24RollbackMigrations = path.join(temporaryDir, 'runtime-24-rollback-migrations');
  fs.mkdirSync(runtime24RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime24RollbackMigrations, name), name.startsWith('0024_')
      ? `${source}\nSELECT * FROM journey_runtime_24_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(24, runtime24RollbackMigrations),
    /journey_runtime_24_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_24_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>23 THEN
        RAISE EXCEPTION 'failed runtime-24 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_card_details') IS NOT NULL
         OR to_regclass('public.journey_asset_blob_purge_outbox') IS NOT NULL
         OR to_regclass('public.journey_rich_card_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-24 migration left rich-card storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_channel_versions_immutable','journey_touchpoint_versions_immutable',
        'journey_rich_card_audit_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-24 migration left rich-card integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_card_details_card_tenant_fk','journey_card_assets_upload_tenant_fk',
        'journey_touchpoint_versions_channel_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-24 migration left rich-card tenant constraints behind';
      END IF;
    END
  $runtime_24_rollback$;`);
  emit('postgres_runtime_24_rollback_passed', { database });

  run(process.execPath, upgradeArgs(24));
  run(process.execPath, upgradeArgs(24));
  emit('postgres_runtime_24_replay_passed', { database });

  const runtime25RollbackMigrations = path.join(temporaryDir, 'runtime-25-rollback-migrations');
  fs.mkdirSync(runtime25RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime25RollbackMigrations, name), name.startsWith('0025_')
      ? `${source}\nSELECT * FROM journey_runtime_25_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(25, runtime25RollbackMigrations),
    /journey_runtime_25_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_25_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>24 THEN
        RAISE EXCEPTION 'failed runtime-25 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_metric_alert_definitions') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_definition_versions') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_evaluation_runs') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_evaluation_results') IS NOT NULL
         OR to_regclass('public.journey_metric_alerts') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_events') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_notification_preferences') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_notifications') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_notification_states') IS NOT NULL
         OR to_regclass('public.journey_metric_alert_notification_state_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-25 migration left metric-alert storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_metric_alert_versions_append_only','journey_metric_alert_results_append_only',
        'journey_metric_alert_events_append_only','journey_metric_alert_notifications_append_only',
        'journey_metric_alert_notification_state_events_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-25 migration left metric-alert integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_metric_alert_definitions_current_version_tenant_fk',
        'journey_metric_alert_versions_parent_metric_tenant_fk',
        'journey_metric_alert_notifications_recipient_identity',
        'journey_metric_alert_notification_states_notification_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-25 migration left metric-alert tenant constraints behind';
      END IF;
    END
  $runtime_25_rollback$;`);
  emit('postgres_runtime_25_rollback_passed', { database });

  run(process.execPath, upgradeArgs(25));
  run(process.execPath, upgradeArgs(25));
  emit('postgres_runtime_25_replay_passed', { database });

  const runtime26RollbackMigrations = path.join(temporaryDir, 'runtime-26-rollback-migrations');
  fs.mkdirSync(runtime26RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime26RollbackMigrations, name), name.startsWith('0026_')
      ? `${source}\nSELECT * FROM journey_runtime_26_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(26, runtime26RollbackMigrations),
    /journey_runtime_26_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_26_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>25 THEN
        RAISE EXCEPTION 'failed runtime-26 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_saved_view_settings') IS NOT NULL
         OR to_regclass('public.journey_saved_views') IS NOT NULL
         OR to_regclass('public.journey_saved_view_references') IS NOT NULL
         OR to_regclass('public.journey_saved_view_selections') IS NOT NULL
         OR to_regclass('public.journey_saved_view_operations') IS NOT NULL
         OR to_regclass('public.journey_saved_view_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-26 migration left saved-view storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_saved_view_reference_tenant_guard','journey_saved_view_operations_append_only',
        'journey_saved_view_audit_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-26 migration left saved-view integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_saved_views_owner_membership_fk','journey_saved_views_bound_version_tenant_fk',
        'journey_saved_views_comparison_version_tenant_fk','journey_saved_view_selections_view_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-26 migration left saved-view tenant constraints behind';
      END IF;
    END
  $runtime_26_rollback$;`);
  emit('postgres_runtime_26_rollback_passed', { database });

  run(process.execPath, upgradeArgs(26));
  run(process.execPath, upgradeArgs(26));
  emit('postgres_runtime_26_replay_passed', { database });

  const runtime27RollbackMigrations = path.join(temporaryDir, 'runtime-27-rollback-migrations');
  fs.mkdirSync(runtime27RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime27RollbackMigrations, name), name.startsWith('0027_')
      ? `${source}\nSELECT * FROM journey_runtime_27_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(27, runtime27RollbackMigrations),
    /journey_runtime_27_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_27_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>26 THEN
        RAISE EXCEPTION 'failed runtime-27 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_portfolio_settings') IS NOT NULL
         OR to_regclass('public.journey_portfolio_items') IS NOT NULL
         OR to_regclass('public.journey_portfolio_item_versions') IS NOT NULL
         OR to_regclass('public.journey_portfolio_scoring_policies') IS NOT NULL
         OR to_regclass('public.journey_portfolio_scoring_policy_versions') IS NOT NULL
         OR to_regclass('public.journey_portfolio_reviews') IS NOT NULL
         OR to_regclass('public.journey_portfolio_operations') IS NOT NULL
         OR to_regclass('public.journey_portfolio_activity') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-27 migration left portfolio storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_portfolio_policy_current_version_required','journey_portfolio_item_versions_append_only',
        'journey_portfolio_operations_append_only','journey_portfolio_activity_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-27 migration left portfolio integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_portfolio_items_owner_membership_fk','journey_portfolio_settings_default_policy_fk',
        'journey_portfolio_scoring_current_version_fk','journey_portfolio_item_versions_item_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-27 migration left portfolio tenant constraints behind';
      END IF;
      -- The plan-limit merge is the one runtime-27 statement that touches a row
      -- seeded by an earlier runtime, so a rollback that missed it would be
      -- invisible to every to_regclass check above.
      IF EXISTS (SELECT 1 FROM platform_subscription_plans
        WHERE limits_json::jsonb ?| ARRAY['journeyPortfolioItems','journeyPortfolioScoringPolicies']) THEN
        RAISE EXCEPTION 'failed runtime-27 migration left portfolio plan limits behind';
      END IF;
    END
  $runtime_27_rollback$;`);
  emit('postgres_runtime_27_rollback_passed', { database });

  run(process.execPath, upgradeArgs(27));
  run(process.execPath, upgradeArgs(27));
  emit('postgres_runtime_27_replay_passed', { database });

  const runtime28RollbackMigrations = path.join(temporaryDir, 'runtime-28-rollback-migrations');
  fs.mkdirSync(runtime28RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime28RollbackMigrations, name), name.startsWith('0028_')
      ? `${source}\nSELECT * FROM journey_runtime_28_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(28, runtime28RollbackMigrations),
    /journey_runtime_28_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_28_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>27 THEN
        RAISE EXCEPTION 'failed runtime-28 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_collaboration_settings') IS NOT NULL
         OR to_regclass('public.journey_comments') IS NOT NULL
         OR to_regclass('public.journey_comment_versions') IS NOT NULL
         OR to_regclass('public.journey_governance_reviews') IS NOT NULL
         OR to_regclass('public.journey_collaboration_views') IS NOT NULL
         OR to_regclass('public.journey_read_only_shares') IS NOT NULL
         OR to_regclass('public.journey_collaboration_operations') IS NOT NULL
         OR to_regclass('public.journey_collaboration_activity') IS NOT NULL
         OR to_regclass('public.journey_collaboration_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-28 migration left collaboration storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_comments_author_membership_guard','journey_comment_versions_editor_membership_guard',
        'journey_comment_versions_append_only','journey_collaboration_operations_append_only',
        'journey_collaboration_activity_append_only','journey_collaboration_audit_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-28 migration left collaboration integrity triggers behind';
      END IF;
      -- The membership guard is a shared function, not a per-table trigger: 0028
      -- replaced five composite membership foreign keys with it, so a rollback
      -- that dropped the triggers but kept the function would leave the
      -- offboarding fix half-applied and re-runnable against a 27 database.
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='journey_collaboration_membership_guard') THEN
        RAISE EXCEPTION 'failed runtime-28 migration left its membership guard function behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_comments_current_version_fk','journey_comments_journey_tenant_fk',
        'journey_comments_root_tenant_fk','journey_read_only_shares_tenant_identity'
      )) THEN
        RAISE EXCEPTION 'failed runtime-28 migration left collaboration tenant constraints behind';
      END IF;
    END
  $runtime_28_rollback$;`);
  emit('postgres_runtime_28_rollback_passed', { database });

  run(process.execPath, upgradeArgs(28));
  run(process.execPath, upgradeArgs(28));
  emit('postgres_runtime_28_replay_passed', { database });

  const runtime29RollbackMigrations = path.join(temporaryDir, 'runtime-29-rollback-migrations');
  fs.mkdirSync(runtime29RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime29RollbackMigrations, name), name.startsWith('0029_')
      ? `${source}\nSELECT * FROM journey_runtime_29_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(29, runtime29RollbackMigrations),
    /journey_runtime_29_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_29_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>28 THEN
        RAISE EXCEPTION 'failed runtime-29 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_hierarchy_settings') IS NOT NULL
         OR to_regclass('public.journey_taxonomy_terms') IS NOT NULL
         OR to_regclass('public.journey_hierarchy_links') IS NOT NULL
         OR to_regclass('public.journey_hierarchy_health_snapshots') IS NOT NULL
         OR to_regclass('public.journey_blueprints') IS NOT NULL
         OR to_regclass('public.journey_blueprint_versions') IS NOT NULL
         OR to_regclass('public.journey_blueprint_elements') IS NOT NULL
         OR to_regclass('public.journey_blueprint_portfolio_links') IS NOT NULL
         OR to_regclass('public.journey_blueprint_comparisons') IS NOT NULL
         OR to_regclass('public.journey_hierarchy_operations') IS NOT NULL
         OR to_regclass('public.journey_hierarchy_activity') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-29 migration left hierarchy/blueprint storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_hierarchy_link_guard','journey_blueprint_comparison_guard',
        'journey_blueprint_portfolio_link_guard','journey_hierarchy_operations_append_only',
        'journey_hierarchy_activity_append_only','journey_blueprint_versions_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-29 migration left hierarchy/blueprint integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN (
        'journey_hierarchy_membership_guard','journey_hierarchy_link_guard',
        'journey_blueprint_portfolio_link_guard','journey_hierarchy_append_only_guard'
      )) THEN
        RAISE EXCEPTION 'failed runtime-29 migration left its guard functions behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_blueprints_current_version_fk','journey_hierarchy_links_logical_once',
        'journey_blueprint_versions_parent_fk','journey_blueprint_portfolio_links_item_version_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-29 migration left hierarchy/blueprint tenant constraints behind';
      END IF;
      IF EXISTS (SELECT 1 FROM platform_subscription_plans
        WHERE limits_json::jsonb ?| ARRAY['journeyHierarchyLinks','journeyBlueprints']) THEN
        RAISE EXCEPTION 'failed runtime-29 migration left hierarchy plan limits behind';
      END IF;
    END
  $runtime_29_rollback$;`);
  emit('postgres_runtime_29_rollback_passed', { database });

  run(process.execPath, upgradeArgs(29));
  // The plan-limit merge in 0027 and 0029 re-runs on every replay. Customising a
  // limit and re-applying proves the `- ARRAY(SELECT jsonb_object_keys(...))`
  // subtraction preserves an operator's edit instead of resetting it, which no
  // structural check above can observe.
  dockerPsql(database, `UPDATE platform_subscription_plans
    SET limits_json=(limits_json::jsonb || '{"journeyPortfolioItems":4242}'::jsonb)::text
    WHERE code='team';`);
  run(process.execPath, upgradeArgs(29));
  dockerPsql(database, `DO $runtime_29_replay$
    BEGIN
      IF (SELECT limits_json::jsonb ->> 'journeyPortfolioItems' FROM platform_subscription_plans
        WHERE code='team')<>'4242' THEN
        RAISE EXCEPTION 'replaying runtime 27-29 discarded a customised plan limit';
      END IF;
      IF (SELECT COUNT(*) FROM platform_subscription_plans
        WHERE code IN ('starter','team','enterprise')
          AND limits_json::jsonb ?& ARRAY['journeyHierarchyLinks','journeyBlueprints',
            'journeyBlueprintResources'])<>3 THEN
        RAISE EXCEPTION 'runtime-29 plan limits are not seeded on all three plan codes';
      END IF;
    END
  $runtime_29_replay$;`);
  emit('postgres_runtime_29_replay_passed', { database });

  const privilegeSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', 'runtime_privileges.sql'), 'utf8')
    .replaceAll('__DATABASE__', database)
    .replaceAll('__APP_ROLE__', appRole)
    .replaceAll('__OWNER_ROLE__', ownerRole);
  dockerPsql(database, privilegeSql);

  run(process.execPath, ['scripts/probe-journey-event-control-plane-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-event-data-plane-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-metrics-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-ai-suggestions-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-personas-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-rich-cards-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-metric-alerts-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-saved-views-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  // Runtime 27-29 run in migration order: the runtime-29 probe links a blueprint
  // element to a runtime-27 portfolio item version, so portfolio must have proven
  // its own invariants before hierarchy depends on them.
  run(process.execPath, ['scripts/probe-journey-portfolio-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-collaboration-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-hierarchy-blueprints-postgres.mjs'], {
    env: {
      ...postgresEnvironment(sourceSha256),
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });

  const runtimeEnvironment = postgresEnvironment(sourceSha256);
  run(process.execPath, ['scripts/verify-postgres-runtime.mjs', '--json'], {
    env: { ...runtimeEnvironment, DATABASE_PATH: sqlitePath }, stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-map-legacy-backfill-postgres.mjs'], {
    env: {
      ...runtimeEnvironment,
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-stage-processing-postgres.mjs'], {
    env: {
      ...runtimeEnvironment,
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  run(process.execPath, ['scripts/probe-journey-v2-rollout-postgres.mjs'], {
    env: {
      ...runtimeEnvironment,
      POSTGRES_PROBE_ALLOW_WRITES: 'true',
      POSTGRES_PROBE_OWNER_USER: ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE: ownerPasswordFile
    },
    stdio: 'inherit'
  });
  if (!contractOnly) {
    emit('postgres_e2e_playwright_started', { database });
    run(process.execPath, [playwrightCli, 'test', ...playwrightArguments], { env: runtimeEnvironment, stdio: 'inherit' });
  }
  emit('postgres_e2e_complete', { database });
  mainSucceeded = true;
} finally {
  const cleanupFailures = [];
  if (adminUser && adminDatabase) {
    const databaseCleanup = dockerPsql(adminDatabase, `
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname=${literal(database)} AND pid<>pg_backend_pid();
      DROP DATABASE IF EXISTS ${database};
    `, true);
    if (databaseCleanup.error || databaseCleanup.status !== 0) {
      cleanupFailures.push(databaseCleanup.stderr || databaseCleanup.stdout || databaseCleanup.error?.message || 'database cleanup failed');
    }
    const roleCleanup = dockerPsql(adminDatabase, `
      DROP ROLE IF EXISTS ${appRole};
      DROP ROLE IF EXISTS ${ownerRole};
    `, true);
    if (roleCleanup.error || roleCleanup.status !== 0) {
      cleanupFailures.push(roleCleanup.stderr || roleCleanup.stdout || roleCleanup.error?.message || 'role cleanup failed');
    }
  }
  if (ephemeralContainerStarted) {
    const containerCleanup = spawnSync(dockerCommand, ['rm', '--force', container], {
      encoding: 'utf8', windowsHide: true
    });
    if (containerCleanup.error || containerCleanup.status !== 0) {
      cleanupFailures.push(containerCleanup.stderr || containerCleanup.stdout || containerCleanup.error?.message || 'container cleanup failed');
    }
  }
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  if (cleanupFailures.length) {
    emit('postgres_e2e_cleanup_failed', { database, failures: cleanupFailures.length });
    if (mainSucceeded) throw new Error(`PostgreSQL E2E cleanup failed (${cleanupFailures.length} operation(s)).`);
  } else {
    emit('postgres_e2e_cleanup_complete', { database });
  }
}
