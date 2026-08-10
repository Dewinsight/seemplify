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
const workerRole = `experience_e2e_worker_${suffix}`;
const privacyWorkerRole = `experience_e2e_privacy_${suffix}`;
const connectorWorkerRole = `experience_e2e_connector_${suffix}`;
const operationalFeedWorkerRole = `experience_e2e_operational_feed_${suffix}`;
const eventRetentionWorkerRole = `experience_e2e_event_retention_${suffix}`;
const ownerPassword = crypto.randomBytes(24).toString('base64url');
const appPassword = crypto.randomBytes(24).toString('base64url');
const workerPassword = crypto.randomBytes(24).toString('base64url');
const privacyWorkerPassword = crypto.randomBytes(24).toString('base64url');
const connectorWorkerPassword = crypto.randomBytes(24).toString('base64url');
const operationalFeedWorkerPassword = crypto.randomBytes(24).toString('base64url');
const eventRetentionWorkerPassword = crypto.randomBytes(24).toString('base64url');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-pg-e2e-'));
const sqlitePath = path.join(temporaryDir, 'source.sqlite');
const ownerPasswordFile = path.join(temporaryDir, 'owner-password');
const appPasswordFile = path.join(temporaryDir, 'app-password');
const workerPasswordFile = path.join(temporaryDir, 'worker-password');
const privacyWorkerPasswordFile = path.join(temporaryDir, 'privacy-worker-password');
const connectorWorkerPasswordFile = path.join(temporaryDir, 'connector-worker-password');
const operationalFeedWorkerPasswordFile = path.join(temporaryDir, 'operational-feed-worker-password');
const eventRetentionWorkerPasswordFile = path.join(temporaryDir, 'event-retention-worker-password');
const workerSecretFile = path.join(temporaryDir, 'journey-worker-secret');
const journeyIdentityHashKeyFile = path.join(temporaryDir, 'journey-identity-hash-key');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const npmCli = process.env.npm_execpath
  || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const playwrightCli = path.join(projectDir, 'node_modules', '@playwright', 'test', 'cli.js');
const contractOnly = process.argv.includes('--contract-only');
const playwrightArguments = process.argv.slice(2).filter((argument) => argument !== '--contract-only');
const playwrightPort = Number(process.env.PLAYWRIGHT_PORT || 5412);
assert.ok(Number.isInteger(playwrightPort) && playwrightPort >= 1024 && playwrightPort <= 65_535,
  'PLAYWRIGHT_PORT must be an integer between 1024 and 65535.');

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
    server.listen(${playwrightPort}, '127.0.0.1', () => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(2), 3000).unref();
  `], { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error(`The PostgreSQL E2E server requires free loopback port ${playwrightPort}; another test server is already running.`);
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
// the full run holds its configured Playwright port, so nothing removed here
// can belong to another full run using the same isolated harness contract.
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
    POSTGRES_WORKER_USER:workerRole,
    POSTGRES_WORKER_PASSWORD_FILE:workerPasswordFile,
    POSTGRES_PRIVACY_WORKER_USER:privacyWorkerRole,
    POSTGRES_PRIVACY_WORKER_PASSWORD_FILE:privacyWorkerPasswordFile,
    POSTGRES_CONNECTOR_WORKER_USER:connectorWorkerRole,
    POSTGRES_CONNECTOR_WORKER_PASSWORD_FILE:connectorWorkerPasswordFile,
    POSTGRES_OPERATIONAL_FEED_WORKER_USER:operationalFeedWorkerRole,
    POSTGRES_OPERATIONAL_FEED_WORKER_PASSWORD_FILE:operationalFeedWorkerPasswordFile,
    POSTGRES_EVENT_RETENTION_WORKER_USER:eventRetentionWorkerRole,
    POSTGRES_EVENT_RETENTION_WORKER_PASSWORD_FILE:eventRetentionWorkerPasswordFile,
    JOURNEY_ACTION_WORKER_ENABLED:'false',
    JOURNEY_ACTION_WORKER_SECRET_FILE:workerSecretFile,
    JOURNEY_IDENTITY_HASH_KEY_FILE:journeyIdentityHashKeyFile,
    POSTGRES_SSL: 'disable',
    POSTGRES_SCHEMA_VERSION: '1',
    POSTGRES_RUNTIME_SCHEMA_VERSION: '55',
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
  assert.match(workerRole, /^experience_e2e_worker_[a-f0-9]{12}$/u);
  assert.match(privacyWorkerRole, /^experience_e2e_privacy_[a-f0-9]{12}$/u);
  assert.match(connectorWorkerRole, /^experience_e2e_connector_[a-f0-9]{12}$/u);
  assert.match(operationalFeedWorkerRole, /^experience_e2e_operational_feed_[a-f0-9]{12}$/u);
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
  fs.writeFileSync(workerPasswordFile, `${workerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(privacyWorkerPasswordFile, `${privacyWorkerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(connectorWorkerPasswordFile, `${connectorWorkerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(operationalFeedWorkerPasswordFile, `${operationalFeedWorkerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(eventRetentionWorkerPasswordFile, `${eventRetentionWorkerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(workerSecretFile, `${crypto.randomBytes(48).toString('base64url')}\n`, {encoding:'utf8',mode:0o600});
  fs.writeFileSync(journeyIdentityHashKeyFile, crypto.randomBytes(32), {mode:0o600});

  dockerPsql(adminDatabase, `
    CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(ownerPassword)};
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(appPassword)};
    CREATE ROLE ${workerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(workerPassword)};
    CREATE ROLE ${privacyWorkerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(privacyWorkerPassword)};
    CREATE ROLE ${connectorWorkerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(connectorWorkerPassword)};
    CREATE ROLE ${operationalFeedWorkerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(operationalFeedWorkerPassword)};
    CREATE ROLE ${eventRetentionWorkerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(eventRetentionWorkerPassword)};
  `);
  dockerPsql(adminDatabase, `CREATE DATABASE ${database} OWNER ${ownerRole};`);
  dockerPsql(adminDatabase, `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT ON DATABASE ${database} TO ${ownerRole},${appRole},${workerRole},${privacyWorkerRole},${connectorWorkerRole},${operationalFeedWorkerRole},${eventRetentionWorkerRole};`);
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

  const runtime30RollbackMigrations = path.join(temporaryDir, 'runtime-30-rollback-migrations');
  fs.mkdirSync(runtime30RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime30RollbackMigrations, name), name.startsWith('0030_')
      ? `${source}\nSELECT * FROM journey_runtime_30_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(30, runtime30RollbackMigrations),
    /journey_runtime_30_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_30_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>29 THEN
        RAISE EXCEPTION 'failed runtime-30 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_stage_reprojection_runs') IS NOT NULL
         OR to_regclass('public.journey_stage_reprojection_attempts') IS NOT NULL
         OR to_regclass('public.journey_stage_reprojection_checkpoints') IS NOT NULL
         OR to_regclass('public.journey_stage_reprojection_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-30 migration left stage reprojection storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
        'journey_stage_reprojection_attempts_append_only',
        'journey_stage_reprojection_audit_append_only'
      )) THEN
        RAISE EXCEPTION 'failed runtime-30 migration left stage reprojection integrity triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='journey_stage_reprojection_append_only_guard') THEN
        RAISE EXCEPTION 'failed runtime-30 migration left its append-only guard function behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_stage_reprojection_runs_map_tenant_fk',
        'journey_stage_reprojection_attempts_run_tenant_fk',
        'journey_stage_reprojection_checkpoints_run_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-30 migration left stage reprojection tenant constraints behind';
      END IF;
    END
  $runtime_30_rollback$;`);
  emit('postgres_runtime_30_rollback_passed', { database });

  run(process.execPath, upgradeArgs(30));
  run(process.execPath, upgradeArgs(30));
  emit('postgres_runtime_30_replay_passed', { database });

  const runtime31RollbackMigrations = path.join(temporaryDir, 'runtime-31-rollback-migrations');
  fs.mkdirSync(runtime31RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime31RollbackMigrations, name), name.startsWith('0031_')
      ? `${source}\nSELECT * FROM journey_runtime_31_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(31, runtime31RollbackMigrations),
    /journey_runtime_31_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_31_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>30 THEN
        RAISE EXCEPTION 'failed runtime-31 migration advanced the ledger';
      END IF;
      IF to_regclass('public.journey_identity_profiles') IS NOT NULL
         OR to_regclass('public.journey_identity_bindings') IS NOT NULL
         OR to_regclass('public.journey_identity_merges') IS NOT NULL
         OR to_regclass('public.journey_identity_memberships') IS NOT NULL
         OR to_regclass('public.journey_identity_groups') IS NOT NULL
         OR to_regclass('public.journey_identity_source_facts') IS NOT NULL
         OR to_regclass('public.journey_identity_audit_facts') IS NOT NULL
         OR to_regclass('public.journey_identity_profile_tombstones') IS NOT NULL
         OR to_regclass('public.journey_identity_identifier_tombstones') IS NOT NULL
         OR to_regclass('public.journey_identity_processed_commands') IS NOT NULL
         OR to_regclass('public.journey_profile_timeline_events') IS NOT NULL
         OR to_regclass('public.journey_identity_sessions') IS NOT NULL
         OR to_regclass('public.journey_identity_segments') IS NOT NULL
         OR to_regclass('public.journey_identity_segment_versions') IS NOT NULL
         OR to_regclass('public.journey_identity_segment_memberships') IS NOT NULL
         OR to_regclass('public.journey_profile_privacy_states') IS NOT NULL
         OR to_regclass('public.journey_profile_export_jobs') IS NOT NULL
         OR to_regclass('public.journey_profile_privacy_jobs') IS NOT NULL
         OR to_regclass('public.journey_identity_correction_runs') IS NOT NULL THEN
        RAISE EXCEPTION 'failed runtime-31 migration left identity/profile storage behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN (
        'journey_identity_bindings_profile_tenant_fk',
        'journey_identity_merges_source_tenant_fk',
        'journey_identity_memberships_profile_tenant_fk',
        'journey_identity_source_facts_profile_tenant_fk'
      )) THEN
        RAISE EXCEPTION 'failed runtime-31 migration left identity tenant constraints behind';
      END IF;
    END
  $runtime_31_rollback$;`);
  emit('postgres_runtime_31_rollback_passed', { database });

  run(process.execPath, upgradeArgs(31));
  run(process.execPath, upgradeArgs(31));
  emit('postgres_runtime_31_replay_passed', { database });

  const runtime32RollbackMigrations = path.join(temporaryDir, 'runtime-32-rollback-migrations');
  fs.mkdirSync(runtime32RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime32RollbackMigrations, name), name.startsWith('0032_')
      ? `${source}\nSELECT * FROM journey_runtime_32_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(32, runtime32RollbackMigrations),
    /journey_runtime_32_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_32_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>31 THEN
        RAISE EXCEPTION 'failed runtime-32 migration advanced the ledger';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
          'journey_taxonomy_assignment_lifecycle_guard','journey_taxonomy_retirement_assignment_guard')) THEN
        RAISE EXCEPTION 'failed runtime-32 migration left taxonomy guard triggers behind';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='journey_taxonomy_assignment_lifecycle_guard') THEN
        RAISE EXCEPTION 'failed runtime-32 migration left taxonomy guard function behind';
      END IF;
    END
  $runtime_32_rollback$;`);
  emit('postgres_runtime_32_rollback_passed', { database });

  run(process.execPath, upgradeArgs(32));
  run(process.execPath, upgradeArgs(32));
  emit('postgres_runtime_32_replay_passed', { database });

  run(process.execPath, upgradeArgs(33));
  run(process.execPath, upgradeArgs(33));
  emit('postgres_runtime_33_replay_passed', { database });

  const runtime34RollbackMigrations = path.join(temporaryDir, 'runtime-34-rollback-migrations');
  fs.mkdirSync(runtime34RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime34RollbackMigrations, name), name.startsWith('0034_')
      ? `${source}\nSELECT * FROM journey_runtime_34_deliberate_failure;\n`
      : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(34, runtime34RollbackMigrations),
    /journey_runtime_34_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_34_rollback$
    BEGIN
      IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>33 THEN
        RAISE EXCEPTION 'failed runtime-34 migration advanced the ledger';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname='journey_portfolio_items_owner_membership_fk')
        OR EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname='journey_portfolio_items_owner_user_fk') THEN
        RAISE EXCEPTION 'failed runtime-34 migration did not restore the owner foreign key';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgname='journey_portfolio_items_owner_membership_guard')
        OR EXISTS (SELECT 1 FROM pg_proc
        WHERE proname='journey_portfolio_owner_membership_guard') THEN
        RAISE EXCEPTION 'failed runtime-34 migration left its membership guard behind';
      END IF;
    END
  $runtime_34_rollback$;`);
  emit('postgres_runtime_34_rollback_passed', { database });

  run(process.execPath, upgradeArgs(34));
  run(process.execPath, upgradeArgs(34));
  emit('postgres_runtime_34_replay_passed', { database });

  const runtime35RollbackMigrations = path.join(temporaryDir, 'runtime-35-rollback-migrations');
  fs.mkdirSync(runtime35RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime35RollbackMigrations, name), name.startsWith('0035_')
      ? `${source}\nSELECT * FROM journey_runtime_35_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(35, runtime35RollbackMigrations), /journey_runtime_35_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_35_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>34 THEN
      RAISE EXCEPTION 'failed runtime-35 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_workflow_definitions') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_proc WHERE proname='journey_orchestration_append_only_guard') THEN
      RAISE EXCEPTION 'failed runtime-35 migration left orchestration objects behind';
    END IF;
  END $runtime_35_rollback$;`);
  emit('postgres_runtime_35_rollback_passed', { database });
  run(process.execPath, upgradeArgs(35));
  run(process.execPath, upgradeArgs(35));
  emit('postgres_runtime_35_replay_passed', { database });

  const runtime36RollbackMigrations = path.join(temporaryDir, 'runtime-36-rollback-migrations');
  fs.mkdirSync(runtime36RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime36RollbackMigrations, name), name.startsWith('0036_')
      ? `${source}\nSELECT * FROM journey_runtime_36_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(36, runtime36RollbackMigrations), /journey_runtime_36_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_36_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>35 THEN
      RAISE EXCEPTION 'failed runtime-36 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_action_queue') IS NOT NULL
       OR to_regclass('public.journey_action_effect_receipts') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-36 migration left action-runtime objects behind';
    END IF;
  END $runtime_36_rollback$;`);
  emit('postgres_runtime_36_rollback_passed', { database });
  run(process.execPath, upgradeArgs(36));
  run(process.execPath, upgradeArgs(36));
  emit('postgres_runtime_36_replay_passed', { database });

  const runtime37RollbackMigrations = path.join(temporaryDir, 'runtime-37-rollback-migrations');
  fs.mkdirSync(runtime37RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime37RollbackMigrations, name), name.startsWith('0037_')
      ? `${source}\nSELECT * FROM journey_runtime_37_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(37, runtime37RollbackMigrations), /journey_runtime_37_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_37_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>36 THEN
      RAISE EXCEPTION 'failed runtime-37 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_connector_definitions') IS NOT NULL
       OR to_regclass('public.journey_connector_item_receipts') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-37 migration left connector-import objects behind';
    END IF;
  END $runtime_37_rollback$;`);
  emit('postgres_runtime_37_rollback_passed', { database });
  run(process.execPath, upgradeArgs(37));
  run(process.execPath, upgradeArgs(37));
  emit('postgres_runtime_37_replay_passed', { database });

  const runtime38RollbackMigrations = path.join(temporaryDir, 'runtime-38-rollback-migrations');
  fs.mkdirSync(runtime38RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime38RollbackMigrations, name), name.startsWith('0038_')
      ? `${source}\nSELECT * FROM journey_runtime_38_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(38, runtime38RollbackMigrations), /journey_runtime_38_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_38_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>37 THEN
      RAISE EXCEPTION 'failed runtime-38 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_webhook_destinations') IS NOT NULL
       OR to_regclass('public.journey_adapter_effect_receipts') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-38 migration left reviewed-adapter objects behind';
    END IF;
  END $runtime_38_rollback$;`);
  emit('postgres_runtime_38_rollback_passed', { database });
  run(process.execPath, upgradeArgs(38));
  run(process.execPath, upgradeArgs(38));
  emit('postgres_runtime_38_replay_passed', { database });

  const runtime39RollbackMigrations = path.join(temporaryDir, 'runtime-39-rollback-migrations');
  fs.mkdirSync(runtime39RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime39RollbackMigrations, name), name.startsWith('0039_')
      ? `${source}\nSELECT * FROM journey_runtime_39_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(39, runtime39RollbackMigrations), /journey_runtime_39_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_39_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>38 THEN
      RAISE EXCEPTION 'failed runtime-39 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_predictive_models') IS NOT NULL
       OR to_regclass('public.journey_prediction_runs') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-39 migration left predictive-governance objects behind';
    END IF;
  END $runtime_39_rollback$;`);
  emit('postgres_runtime_39_rollback_passed', { database });
  run(process.execPath, upgradeArgs(39));
  run(process.execPath, upgradeArgs(39));
  emit('postgres_runtime_39_replay_passed', { database });

  const runtime40RollbackMigrations = path.join(temporaryDir, 'runtime-40-rollback-migrations');
  fs.mkdirSync(runtime40RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime40RollbackMigrations, name), name.startsWith('0040_')
      ? `${source}\nSELECT * FROM journey_runtime_40_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(40, runtime40RollbackMigrations), /journey_runtime_40_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_40_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>39 THEN
      RAISE EXCEPTION 'failed runtime-40 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_kill_switch_states') IS NOT NULL
       OR to_regclass('public.journey_kill_switch_audit') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-40 migration left kill-switch objects behind';
    END IF;
  END $runtime_40_rollback$;`);
  emit('postgres_runtime_40_rollback_passed', { database });
  run(process.execPath, upgradeArgs(40));
  run(process.execPath, upgradeArgs(40));
  emit('postgres_runtime_40_replay_passed', { database });

  const runtime41RollbackMigrations = path.join(temporaryDir, 'runtime-41-rollback-migrations');
  fs.mkdirSync(runtime41RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime41RollbackMigrations, name), name.startsWith('0041_')
      ? `${source}\nSELECT * FROM journey_runtime_41_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(41, runtime41RollbackMigrations), /journey_runtime_41_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_41_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>40 THEN
      RAISE EXCEPTION 'failed runtime-41 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_stage_intelligence_policies') IS NOT NULL
       OR to_regclass('public.journey_stage_intelligence_facts') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-41 migration left stage-intelligence objects behind';
    END IF;
  END $runtime_41_rollback$;`);
  emit('postgres_runtime_41_rollback_passed', { database });
  run(process.execPath, upgradeArgs(41));
  run(process.execPath, upgradeArgs(41));
  emit('postgres_runtime_41_replay_passed', { database });

  const runtime42RollbackMigrations = path.join(temporaryDir, 'runtime-42-rollback-migrations');
  fs.mkdirSync(runtime42RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime42RollbackMigrations, name), name.startsWith('0042_')
      ? `${source}\nSELECT * FROM journey_runtime_42_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(42, runtime42RollbackMigrations), /journey_runtime_42_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_42_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>41 THEN
      RAISE EXCEPTION 'failed runtime-42 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_worker_service_principals') IS NOT NULL
       OR to_regclass('public.journey_action_worker_reservations') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-42 migration left worker-safety objects behind';
    END IF;
  END $runtime_42_rollback$;`);
  emit('postgres_runtime_42_rollback_passed', { database });
  run(process.execPath, upgradeArgs(42));
  run(process.execPath, upgradeArgs(42));
  emit('postgres_runtime_42_replay_passed', { database });

  const runtime43RollbackMigrations = path.join(temporaryDir, 'runtime-43-rollback-migrations');
  fs.mkdirSync(runtime43RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime43RollbackMigrations, name), name.startsWith('0043_')
      ? `${source}\nSELECT * FROM journey_runtime_43_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(43, runtime43RollbackMigrations), /journey_runtime_43_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_43_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>42 THEN
      RAISE EXCEPTION 'failed runtime-43 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_stage_source_mappings') IS NOT NULL
       OR to_regclass('public.journey_stage_survey_outbox') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-43 migration left survey-feed objects behind';
    END IF;
  END $runtime_43_rollback$;`);
  emit('postgres_runtime_43_rollback_passed', { database });
  run(process.execPath, upgradeArgs(43));
  run(process.execPath, upgradeArgs(43));
  emit('postgres_runtime_43_replay_passed', { database });

  const runtime44RollbackMigrations = path.join(temporaryDir, 'runtime-44-rollback-migrations');
  fs.mkdirSync(runtime44RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime44RollbackMigrations, name), name.startsWith('0044_')
      ? `${source}\nSELECT * FROM journey_runtime_44_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(44, runtime44RollbackMigrations), /journey_runtime_44_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_44_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>43 THEN
      RAISE EXCEPTION 'failed runtime-44 migration advanced the ledger';
    END IF;
    IF pg_get_functiondef('journey_action_worker_reservation_fence_guard()'::regprocedure)
       LIKE '%journey_adapter_effect_receipts%' THEN
      RAISE EXCEPTION 'failed runtime-44 migration left reviewed-effect fencing behind';
    END IF;
  END $runtime_44_rollback$;`);
  emit('postgres_runtime_44_rollback_passed', { database });
  run(process.execPath, upgradeArgs(44));
  run(process.execPath, upgradeArgs(44));
  dockerPsql(database, `DO $runtime_44_contract$ BEGIN
    IF pg_get_functiondef('journey_action_worker_reservation_fence_guard()'::regprocedure)
       NOT LIKE '%journey_adapter_effect_receipts%' THEN
      RAISE EXCEPTION 'runtime-44 reviewed-effect fencing is unavailable';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc procedure_record
      CROSS JOIN LATERAL aclexplode(COALESCE(procedure_record.proacl,acldefault('f',procedure_record.proowner))) privilege
      WHERE procedure_record.oid='journey_action_worker_reservation_fence_guard()'::regprocedure
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-44 fence guard is executable by PUBLIC';
    END IF;
  END $runtime_44_contract$;`);
  emit('postgres_runtime_44_replay_passed', { database });

  const runtime45RollbackMigrations = path.join(temporaryDir, 'runtime-45-rollback-migrations');
  fs.mkdirSync(runtime45RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime45RollbackMigrations, name), name.startsWith('0045_')
      ? `${source}\nSELECT * FROM journey_runtime_45_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(45, runtime45RollbackMigrations), /journey_runtime_45_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_45_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>44 THEN
      RAISE EXCEPTION 'failed runtime-45 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_event_intelligence_outbox') IS NOT NULL
       OR to_regclass('public.journey_event_intelligence_mappings') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-45 migration left event-intelligence objects behind';
    END IF;
  END $runtime_45_rollback$;`);
  emit('postgres_runtime_45_rollback_passed', { database });
  run(process.execPath, upgradeArgs(45));
  run(process.execPath, upgradeArgs(45));
  dockerPsql(database, `DO $runtime_45_contract$ BEGIN
    IF to_regclass('public.journey_event_intelligence_outbox') IS NULL
       OR to_regclass('public.journey_event_intelligence_tombstones') IS NULL THEN
      RAISE EXCEPTION 'runtime-45 event intelligence adapter is unavailable';
    END IF;
    IF has_function_privilege('public','journey_event_intelligence_enqueue_visit()','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-45 enqueue function is executable by PUBLIC';
    END IF;
  END $runtime_45_contract$;`);
  emit('postgres_runtime_45_replay_passed', { database });

  const runtime46RollbackMigrations = path.join(temporaryDir, 'runtime-46-rollback-migrations');
  fs.mkdirSync(runtime46RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime46RollbackMigrations, name), name.startsWith('0046_')
      ? `${source}\nSELECT * FROM journey_runtime_46_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(46, runtime46RollbackMigrations), /journey_runtime_46_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_46_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>45 THEN
      RAISE EXCEPTION 'failed runtime-46 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_portfolio_view_definitions') IS NOT NULL
       OR to_regclass('public.journey_portfolio_transition_requests') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-46 migration left portfolio-governance objects behind';
    END IF;
  END $runtime_46_rollback$;`);
  emit('postgres_runtime_46_rollback_passed', { database });
  run(process.execPath, upgradeArgs(46));
  run(process.execPath, upgradeArgs(46));
  dockerPsql(database, `DO $runtime_46_contract$ BEGIN
    IF to_regclass('public.journey_portfolio_view_versions') IS NULL
       OR to_regclass('public.journey_portfolio_transition_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-46 portfolio governance is unavailable';
    END IF;
    IF has_function_privilege('public','journey_portfolio_runtime46_guard()','EXECUTE')
       OR has_function_privilege('public','journey_portfolio_view_preference_guard()','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-46 guard function is executable by PUBLIC';
    END IF;
  END $runtime_46_contract$;`);
  emit('postgres_runtime_46_replay_passed', { database });

  const runtime47RollbackMigrations = path.join(temporaryDir, 'runtime-47-rollback-migrations');
  fs.mkdirSync(runtime47RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime47RollbackMigrations, name), name.startsWith('0047_')
      ? `${source}\nSELECT * FROM journey_runtime_47_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(47, runtime47RollbackMigrations), /journey_runtime_47_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_47_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>46 THEN
      RAISE EXCEPTION 'failed runtime-47 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_privacy_service_principals') IS NOT NULL
       OR to_regclass('public.journey_privacy_propagation_claims') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-47 migration left privacy-authority objects behind';
    END IF;
  END $runtime_47_rollback$;`);
  emit('postgres_runtime_47_rollback_passed', { database });
  run(process.execPath, upgradeArgs(47));
  run(process.execPath, upgradeArgs(47));
  dockerPsql(database, `DO $runtime_47_contract$ BEGIN
    IF to_regclass('public.journey_privacy_service_principals') IS NULL
       OR to_regclass('public.journey_privacy_erasure_authorities') IS NULL
       OR to_regclass('public.journey_privacy_propagation_claims') IS NULL
       OR to_regclass('public.journey_privacy_propagation_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-47 privacy propagation authority is unavailable';
    END IF;
    IF has_function_privilege('public','journey_privacy_claim(text,text,text,timestamptz,integer)','EXECUTE')
       OR has_function_privilege('public','journey_privacy_checkpoint(text,text,bigint,text,integer,text,jsonb,text,timestamptz,timestamptz)','EXECUTE')
       OR has_function_privilege('public','journey_privacy_erasure_ready(text,text)','EXECUTE')
       OR has_function_privilege('public','journey_privacy_runtime47_guard()','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-47 control functions are executable by PUBLIC';
    END IF;
  END $runtime_47_contract$;`);
  emit('postgres_runtime_47_replay_passed', { database });

  const runtime48RollbackMigrations = path.join(temporaryDir, 'runtime-48-rollback-migrations');
  fs.mkdirSync(runtime48RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime48RollbackMigrations, name), name.startsWith('0048_')
      ? `${source}\nSELECT * FROM journey_runtime_48_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(48, runtime48RollbackMigrations), /journey_runtime_48_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_48_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>47 THEN
      RAISE EXCEPTION 'failed runtime-48 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_blueprint_measurement_plans') IS NOT NULL
       OR to_regclass('public.journey_blueprint_measurement_outcomes') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-48 migration left blueprint measurement objects behind';
    END IF;
  END $runtime_48_rollback$;`);
  emit('postgres_runtime_48_rollback_passed', { database });
  run(process.execPath, upgradeArgs(48));
  run(process.execPath, upgradeArgs(48));
  dockerPsql(database, `DO $runtime_48_contract$ BEGIN
    IF to_regclass('public.journey_blueprint_measurement_plans') IS NULL
       OR to_regclass('public.journey_blueprint_measurement_outcomes') IS NULL
       OR to_regclass('public.journey_blueprint_measurement_audit') IS NULL THEN
      RAISE EXCEPTION 'runtime-48 blueprint measurement evidence is unavailable';
    END IF;
    IF has_function_privilege('public','journey_blueprint_measurement_lineage_guard()','EXECUTE')
       OR has_function_privilege('public','journey_blueprint_measurement_immutability_guard()','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-48 guard functions are executable by PUBLIC';
    END IF;
  END $runtime_48_contract$;`);
  emit('postgres_runtime_48_replay_passed', { database });

  const runtime49RollbackMigrations = path.join(temporaryDir, 'runtime-49-rollback-migrations');
  fs.mkdirSync(runtime49RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime49RollbackMigrations, name), name.startsWith('0049_')
      ? `${source}\nSELECT * FROM journey_runtime_49_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(49, runtime49RollbackMigrations), /journey_runtime_49_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_49_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>48 THEN
      RAISE EXCEPTION 'failed runtime-49 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_export_brand_profiles') IS NOT NULL
       OR to_regclass('public.journey_export_brand_profile_versions') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-49 migration left export brand objects behind';
    END IF;
  END $runtime_49_rollback$;`);
  emit('postgres_runtime_49_rollback_passed', { database });
  run(process.execPath, upgradeArgs(49));
  run(process.execPath, upgradeArgs(49));
  dockerPsql(database, `DO $runtime_49_contract$ BEGIN
    IF to_regclass('public.journey_export_brand_assets') IS NULL
       OR to_regclass('public.journey_export_brand_profiles') IS NULL
       OR to_regclass('public.journey_export_brand_profile_versions') IS NULL
       OR to_regclass('public.journey_saved_view_brand_bindings') IS NULL
       OR to_regclass('public.journey_export_brand_audit_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-49 export branding is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid='journey_export_brand_append_only_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_export_brand_append_only_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-49 append-only guard is executable by PUBLIC';
    END IF;
  END $runtime_49_contract$;`);
  emit('postgres_runtime_49_replay_passed', { database });

  const runtime50RollbackMigrations = path.join(temporaryDir, 'runtime-50-rollback-migrations');
  fs.mkdirSync(runtime50RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime50RollbackMigrations, name), name.startsWith('0050_')
      ? `${source}\nSELECT * FROM journey_runtime_50_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(50, runtime50RollbackMigrations), /journey_runtime_50_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_50_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>49 THEN
      RAISE EXCEPTION 'failed runtime-50 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_actual_path_snapshots') IS NOT NULL
       OR to_regclass('public.journey_actual_path_rollups') IS NOT NULL
       OR to_regclass('public.journey_actual_path_artifact_revisions') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-50 migration left actual-path objects behind';
    END IF;
  END $runtime_50_rollback$;`);
  emit('postgres_runtime_50_rollback_passed', { database });
  run(process.execPath, upgradeArgs(50));
  run(process.execPath, upgradeArgs(50));
  dockerPsql(database, `DO $runtime_50_contract$ BEGIN
    IF to_regclass('public.journey_actual_path_snapshots') IS NULL
       OR to_regclass('public.journey_actual_path_rollups') IS NULL
       OR to_regclass('public.journey_actual_path_artifact_revisions') IS NULL
       OR to_regclass('public.journey_actual_path_privacy_invalidations') IS NULL THEN
      RAISE EXCEPTION 'runtime-50 actual-path durability is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_actual_path_runtime50_immutable_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_actual_path_runtime50_immutable_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE')
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_actual_path_privacy_invalidate(text,text,text,text,text,timestamp with time zone)'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc
        WHERE oid='journey_actual_path_privacy_invalidate(text,text,text,text,text,timestamp with time zone)'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-50 governed functions are executable by PUBLIC';
    END IF;
  END $runtime_50_contract$;`);
  emit('postgres_runtime_50_replay_passed', { database });

  const runtime51RollbackMigrations = path.join(temporaryDir, 'runtime-51-rollback-migrations');
  fs.mkdirSync(runtime51RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime51RollbackMigrations, name), name.startsWith('0051_')
      ? `${source}\nSELECT * FROM journey_runtime_51_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(51, runtime51RollbackMigrations), /journey_runtime_51_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_51_rollback$ BEGIN
    IF (SELECT MAX(version) FROM experience_runtime_schema_version)<>50 THEN
      RAISE EXCEPTION 'failed runtime-51 migration advanced the ledger';
    END IF;
    IF to_regclass('public.journey_connector_worker_principals') IS NOT NULL
       OR to_regclass('public.journey_connector_worker_sources') IS NOT NULL
       OR to_regclass('public.journey_connector_worker_events') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-51 migration left connector worker objects behind';
    END IF;
  END $runtime_51_rollback$;`);
  emit('postgres_runtime_51_rollback_passed', { database });
  run(process.execPath, upgradeArgs(51));
  run(process.execPath, upgradeArgs(51));
  dockerPsql(database, `DO $runtime_51_contract$ BEGIN
    IF to_regclass('public.journey_connector_worker_principals') IS NULL
       OR to_regclass('public.journey_connector_worker_sources') IS NULL
       OR to_regclass('public.journey_connector_worker_source_items') IS NULL
       OR to_regclass('public.journey_connector_worker_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-51 connector execution plane is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid='journey_connector_worker_history_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_connector_worker_history_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime-51 history guard is executable by PUBLIC'; END IF;
  END $runtime_51_contract$;`);
  emit('postgres_runtime_51_replay_passed', { database });

  const runtime52RollbackMigrations = path.join(temporaryDir, 'runtime-52-rollback-migrations');
  fs.mkdirSync(runtime52RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime52RollbackMigrations, name), name.startsWith('0052_')
      ? `${source}\nSELECT * FROM journey_runtime_52_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(52, runtime52RollbackMigrations), /journey_runtime_52_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_52_rollback$ BEGIN
    IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>51 THEN
      RAISE EXCEPTION 'failed runtime-52 migration advanced runtime ledger';
    END IF;
    IF to_regclass('public.journey_operational_stage_mappings') IS NOT NULL
       OR to_regclass('public.journey_operational_stage_outbox') IS NOT NULL
       OR to_regclass('public.journey_operational_timeline_revisions') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-52 migration left operational feed objects behind';
    END IF;
  END $runtime_52_rollback$;`);
  emit('postgres_runtime_52_rollback_passed', { database });
  run(process.execPath, upgradeArgs(52));
  run(process.execPath, upgradeArgs(52));
  dockerPsql(database, `DO $runtime_52_contract$ BEGIN
    IF to_regclass('public.journey_operational_stage_mappings') IS NULL
       OR to_regclass('public.journey_operational_stage_source_revisions') IS NULL
       OR to_regclass('public.journey_operational_stage_outbox') IS NULL
       OR to_regclass('public.journey_operational_timeline_revisions') IS NULL THEN
      RAISE EXCEPTION 'runtime-52 operational feed is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_operational_stage_retention_delete_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_operational_stage_retention_delete_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-52 retention guard is executable by PUBLIC';
    END IF;
  END $runtime_52_contract$;`);
  emit('postgres_runtime_52_replay_passed', { database });

  const runtime53RollbackMigrations = path.join(temporaryDir, 'runtime-53-rollback-migrations');
  fs.mkdirSync(runtime53RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime53RollbackMigrations, name), name.startsWith('0053_')
      ? `${source}\nSELECT * FROM journey_runtime_53_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(53, runtime53RollbackMigrations), /journey_runtime_53_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_53_rollback$ BEGIN
    IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>52 THEN
      RAISE EXCEPTION 'failed runtime-53 migration advanced runtime ledger';
    END IF;
    IF to_regclass('public.journey_event_retention_runs') IS NOT NULL
       OR to_regclass('public.journey_event_retention_checkpoints') IS NOT NULL
       OR to_regclass('public.journey_event_retention_events') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-53 migration left retention objects behind';
    END IF;
  END $runtime_53_rollback$;`);
  emit('postgres_runtime_53_rollback_passed', { database });
  run(process.execPath, upgradeArgs(53));
  run(process.execPath, upgradeArgs(53));
  dockerPsql(database, `DO $runtime_53_contract$ BEGIN
    IF to_regclass('public.journey_event_retention_runs') IS NULL
       OR to_regclass('public.journey_event_retention_checkpoints') IS NULL
       OR to_regclass('public.journey_event_retention_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-53 event retention is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_event_retention_purge_raw(text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone)'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_event_retention_purge_raw(text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone)'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime-53 purge is executable by PUBLIC'; END IF;
  END $runtime_53_contract$;`);
  emit('postgres_runtime_53_replay_passed', { database });

  const runtime54RollbackMigrations = path.join(temporaryDir, 'runtime-54-rollback-migrations');
  fs.mkdirSync(runtime54RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime54RollbackMigrations, name), name.startsWith('0054_')
      ? `${source}\nSELECT * FROM journey_runtime_54_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(54, runtime54RollbackMigrations), /journey_runtime_54_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_54_rollback$ BEGIN
    IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>53 THEN
      RAISE EXCEPTION 'failed runtime-54 migration advanced runtime ledger';
    END IF;
    IF to_regclass('public.journey_evidence_monitor_states') IS NOT NULL
       OR to_regclass('public.journey_evidence_monitor_events') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-54 migration left evidence monitor objects behind';
    END IF;
  END $runtime_54_rollback$;`);
  emit('postgres_runtime_54_rollback_passed', { database });
  run(process.execPath, upgradeArgs(54));
  run(process.execPath, upgradeArgs(54));
  dockerPsql(database, `DO $runtime_54_contract$ BEGIN
    IF to_regclass('public.journey_evidence_monitor_states') IS NULL
       OR to_regclass('public.journey_evidence_monitor_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-54 evidence monitor is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_evidence_monitor_event_append_only_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_evidence_monitor_event_append_only_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime-54 guard is executable by PUBLIC'; END IF;
  END $runtime_54_contract$;`);
  emit('postgres_runtime_54_replay_passed', { database });

  const runtime55RollbackMigrations = path.join(temporaryDir, 'runtime-55-rollback-migrations');
  fs.mkdirSync(runtime55RollbackMigrations);
  for (const name of fs.readdirSync(committedMigrations).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry))) {
    const source = fs.readFileSync(path.join(committedMigrations, name), 'utf8');
    fs.writeFileSync(path.join(runtime55RollbackMigrations, name), name.startsWith('0055_')
      ? `${source}\nSELECT * FROM journey_runtime_55_deliberate_failure;\n` : source);
  }
  runExpectedFailure(process.execPath, upgradeArgs(55, runtime55RollbackMigrations), /journey_runtime_55_deliberate_failure/u);
  dockerPsql(database, `DO $runtime_55_rollback$ BEGIN
    IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>54 THEN
      RAISE EXCEPTION 'failed runtime-55 migration advanced runtime ledger';
    END IF;
    IF to_regclass('public.journey_workspace_view_definitions') IS NOT NULL
       OR to_regclass('public.journey_workspace_view_versions') IS NOT NULL
       OR to_regclass('public.journey_workspace_view_preferences') IS NOT NULL
       OR to_regclass('public.journey_workspace_view_operations') IS NOT NULL
       OR to_regclass('public.journey_workspace_view_audit_events') IS NOT NULL THEN
      RAISE EXCEPTION 'failed runtime-55 migration left workspace saved-view objects behind';
    END IF;
  END $runtime_55_rollback$;`);
  emit('postgres_runtime_55_rollback_passed', { database });
  run(process.execPath, upgradeArgs(55));
  run(process.execPath, upgradeArgs(55));
  dockerPsql(database, `DO $runtime_55_contract$ BEGIN
    IF to_regclass('public.journey_workspace_view_definitions') IS NULL
       OR to_regclass('public.journey_workspace_view_versions') IS NULL
       OR to_regclass('public.journey_workspace_view_preferences') IS NULL
       OR to_regclass('public.journey_workspace_view_operations') IS NULL
       OR to_regclass('public.journey_workspace_view_audit_events') IS NULL THEN
      RAISE EXCEPTION 'runtime-55 workspace saved views are unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_workspace_view_history_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_workspace_view_history_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-55 history guard is executable by PUBLIC';
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
      WHERE oid='journey_workspace_view_preference_guard()'::regprocedure),
      acldefault('f',(SELECT proowner FROM pg_proc WHERE oid='journey_workspace_view_preference_guard()'::regprocedure))))
      WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'runtime-55 preference guard is executable by PUBLIC';
    END IF;
  END $runtime_55_contract$;`);
  emit('postgres_runtime_55_replay_passed', { database });

  const privilegeSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', 'runtime_privileges.sql'), 'utf8')
    .replaceAll('__DATABASE__', database)
    .replaceAll('__APP_ROLE__', appRole)
    .replaceAll('__OWNER_ROLE__', ownerRole);
  dockerPsql(database, privilegeSql);
  const workerPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres','runtime_worker_privileges.sql'),'utf8')
    .replaceAll('__DATABASE__',database).replaceAll('__WORKER_ROLE__',workerRole);
  dockerPsql(database,workerPrivilegeSql);
  const surveyFeedPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres','runtime43_survey_feed_privileges.sql'),'utf8')
    .replaceAll('__APP_ROLE__',appRole).replaceAll('__WORKER_ROLE__',workerRole);
  dockerPsql(database,surveyFeedPrivilegeSql);
  const privacyWorkerPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres','runtime_privacy_worker_privileges.sql'),'utf8')
    .replaceAll('__DATABASE__',database).replaceAll('__PRIVACY_WORKER_ROLE__',privacyWorkerRole);
  dockerPsql(database,privacyWorkerPrivilegeSql);
  const connectorWorkerPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres','runtime51_connector_worker_privileges.sql'),'utf8')
    .replaceAll('__DATABASE__',database).replaceAll('__CONNECTOR_WORKER_ROLE__',connectorWorkerRole);
  dockerPsql(database,connectorWorkerPrivilegeSql);
  const operationalFeedPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres',
    'runtime52_operational_stage_feed_privileges.sql'),'utf8').replaceAll('__DATABASE__',database).replaceAll('__APP_ROLE__',appRole)
    .replaceAll('__OPERATIONAL_FEED_WORKER_ROLE__',operationalFeedWorkerRole);
  dockerPsql(database,operationalFeedPrivilegeSql);
  const eventRetentionPrivilegeSql=fs.readFileSync(path.join(projectDir,'backend','migrations','postgres',
    'runtime53_event_retention_privileges.sql'),'utf8').replaceAll('__DATABASE__',database).replaceAll('__APP_ROLE__',appRole)
    .replaceAll('__EVENT_RETENTION_WORKER_ROLE__',eventRetentionWorkerRole);
  dockerPsql(database,eventRetentionPrivilegeSql);
  dockerPsql(database,`DO $event_retention_privilege$ BEGIN
    IF NOT has_table_privilege('${eventRetentionWorkerRole}','public.journey_event_retention_runs','UPDATE')
       OR NOT has_function_privilege('${eventRetentionWorkerRole}',
         'journey_event_retention_purge_raw(text,text,text,text,text,text,timestamptz,text,timestamptz)','EXECUTE')
       OR has_table_privilege('${appRole}','public.journey_event_retention_runs','SELECT')
       OR has_function_privilege('${appRole}',
         'journey_event_retention_purge_raw(text,text,text,text,text,text,timestamptz,text,timestamptz)','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-53 event retention least-privilege contract was not applied';
    END IF;
  END $event_retention_privilege$;`);
  dockerPsql(database,`DO $operational_feed_worker_privilege$ BEGIN
    IF NOT has_table_privilege('${operationalFeedWorkerRole}','public.journey_operational_stage_outbox','UPDATE')
       OR NOT has_table_privilege('${operationalFeedWorkerRole}','public.journey_operational_stage_source_revisions','DELETE')
       OR NOT has_table_privilege('${operationalFeedWorkerRole}','public.journey_stage_intelligence_facts','INSERT')
       OR has_table_privilege('${operationalFeedWorkerRole}','public.journey_operational_stage_mappings','UPDATE')
       OR has_table_privilege('${appRole}','public.journey_operational_stage_outbox_attempts','SELECT')
       OR has_function_privilege('${appRole}','journey_operational_stage_retention_delete_guard()','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-52 operational feed least-privilege contract was not applied';
    END IF;
  END $operational_feed_worker_privilege$;`);
  dockerPsql(database,`DO $connector_worker_privilege$ BEGIN
    IF NOT has_table_privilege('${connectorWorkerRole}','public.journey_connector_worker_sources','SELECT')
       OR has_table_privilege('${connectorWorkerRole}','public.journey_connector_worker_principals','UPDATE')
       OR has_table_privilege('${connectorWorkerRole}','public.journey_connector_worker_key_events','INSERT')
       OR has_table_privilege('${connectorWorkerRole}','public.journey_connector_worker_sources','DELETE')
       OR has_table_privilege('${appRole}','public.journey_connector_worker_sources','SELECT') THEN
      RAISE EXCEPTION 'runtime-51 connector worker least-privilege contract was not applied';
    END IF;
  END $connector_worker_privilege$;`);
  dockerPsql(database,`DO $worker_privilege$ BEGIN
    IF NOT has_table_privilege('${workerRole}','public.journey_workflow_definitions','SELECT')
       OR NOT has_table_privilege('${workerRole}','public.journey_action_queue','UPDATE')
       OR NOT has_table_privilege('${workerRole}','public.journey_stage_survey_outbox','UPDATE')
       OR NOT has_table_privilege('${workerRole}','public.journey_stage_survey_governance_receipts','DELETE') THEN
      RAISE EXCEPTION 'runtime-42 worker role privilege contract was not applied';
    END IF;
  END $worker_privilege$;`);
  dockerPsql(database,`DO $privacy_worker_privilege$ BEGIN
    IF NOT has_table_privilege('${privacyWorkerRole}','public.journey_privacy_service_principals','SELECT')
       OR NOT has_function_privilege('${privacyWorkerRole}','journey_privacy_claim(text,text,text,timestamptz,integer)','EXECUTE')
       OR NOT has_function_privilege('${privacyWorkerRole}','journey_privacy_checkpoint(text,text,bigint,text,integer,text,jsonb,text,timestamptz,timestamptz)','EXECUTE')
       OR NOT has_function_privilege('${privacyWorkerRole}','journey_privacy_erasure_ready(text,text)','EXECUTE')
       OR has_table_privilege('${privacyWorkerRole}','public.journey_privacy_propagation_claims','SELECT')
       OR has_table_privilege('${privacyWorkerRole}','public.journey_privacy_erasure_authorities','UPDATE')
       OR NOT has_table_privilege('${privacyWorkerRole}','public.journey_action_subject_controls','UPDATE')
       OR has_table_privilege('${privacyWorkerRole}','public.users','UPDATE')
       OR has_function_privilege('${appRole}','journey_privacy_claim(text,text,text,timestamptz,integer)','EXECUTE') THEN
      RAISE EXCEPTION 'runtime-47 privacy worker least-privilege contract was not applied';
    END IF;
  END $privacy_worker_privilege$;`);

  dockerPsql(database,`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ('worker42-user','worker42-probe@example.invalid','Runtime 42 probe','not-a-login','member',1,
      '2026-08-08T12:00:00.000Z','2026-08-08T12:00:00.000Z') ON CONFLICT(id) DO NOTHING;
    INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ('worker42-space','Runtime 42 probe','worker42-probe','worker42-user',NULL,
      '2026-08-08T12:00:00.000Z','2026-08-08T12:00:00.000Z') ON CONFLICT(id) DO NOTHING;
    INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ('worker42-space','worker42-user','admin','2026-08-08T12:00:00.000Z','2026-08-08T12:00:00.000Z')
      ON CONFLICT(space_id,user_id) DO UPDATE SET role='admin',updated_at=EXCLUDED.updated_at;`);
  const probeSpaceId='worker42-space';
  assert.match(probeSpaceId,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u,'Runtime-42 worker probe requires one token-safe seeded space.');
  const probeProfile='a'.repeat(64),probeHash='b'.repeat(64),probeAt='2026-08-08T12:00:00.000Z';
  dockerPsql(database,`BEGIN;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO journey_orchestration_settings(space_id,paused,revision,created_at,updated_at)
      VALUES ('${probeSpaceId}',FALSE,1,'${probeAt}','${probeAt}') ON CONFLICT(space_id) DO UPDATE SET paused=FALSE,updated_at=EXCLUDED.updated_at;
    INSERT INTO journey_workflow_definitions(id,space_id,name,state,revision,draft_json,paused,created_at,updated_at)
      VALUES ('worker42-workflow','${probeSpaceId}','Runtime 42 probe','draft',1,'{}',FALSE,'${probeAt}','${probeAt}');
    INSERT INTO journey_workflow_versions(id,workflow_id,space_id,version_number,content_json,content_sha256,published_at)
      VALUES ('worker42-version','worker42-workflow','${probeSpaceId}',1,
        '{"automationPolicy":{"mode":"bounded_automatic","maximumActionsPerSubjectPerDay":1}}','${probeHash}','${probeAt}');
    UPDATE journey_workflow_definitions SET state='published',current_version_id='worker42-version',current_version_number=1,revision=2,updated_at='${probeAt}'
      WHERE id='worker42-workflow';
    INSERT INTO journey_kill_switch_states(id,scope_level,space_id,scope_key,state,reason_code,revision,created_at,updated_at)
      VALUES ('worker42-space-switch','space','${probeSpaceId}','${probeSpaceId}','enabled','recovery_verified',1,'${probeAt}','${probeAt}'),
      ('worker42-workflow-switch','workflow','${probeSpaceId}','worker42-workflow','enabled','recovery_verified',1,'${probeAt}','${probeAt}'),
      ('worker42-adapter-switch','adapter','${probeSpaceId}','assistant_action','enabled','recovery_verified',1,'${probeAt}','${probeAt}'),
      ('worker44-webhook-switch','adapter','${probeSpaceId}','signed_webhook','enabled','recovery_verified',1,'${probeAt}','${probeAt}'),
      ('worker42-profile-switch','profile','${probeSpaceId}','${probeProfile}','enabled','recovery_verified',1,'${probeAt}','${probeAt}');
    INSERT INTO journey_action_subject_controls(space_id,profile_ref_sha256,purpose_key,consent_state,suppressed,quiet_timezone,
      quiet_start_minute,quiet_end_minute,revision,updated_at) VALUES
      ('${probeSpaceId}','${probeProfile}','contention','granted',FALSE,'UTC',60,120,1,'${probeAt}'),
      ('${probeSpaceId}','${probeProfile}','crash','granted',FALSE,'UTC',60,120,1,'${probeAt}'),
      ('${probeSpaceId}','${probeProfile}','rotation','granted',FALSE,'UTC',60,120,1,'${probeAt}'),
      ('${probeSpaceId}','${probeProfile}','replacement','granted',FALSE,'UTC',60,120,1,'${probeAt}'),
      ('${probeSpaceId}','${probeProfile}','webhook','granted',FALSE,'UTC',60,120,1,'${probeAt}');
    INSERT INTO journey_action_source_controls(space_id,source_key,state,revision,updated_at)
      VALUES ('${probeSpaceId}','worker42-source','active',1,'${probeAt}');
    INSERT INTO journey_webhook_destinations(id,space_id,name,url,hostname,port,secret_enc,secret_sha256,state,revision,
      created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES ('worker44-webhook','${probeSpaceId}','Runtime 44',
      'https://example.invalid/','example.invalid',443,'not-used','${'f'.repeat(64)}','active',1,'worker42-user','worker42-user','${probeAt}','${probeAt}');
    ${Array.from({length:6},(_,index)=>{const number=index+1,purpose=number<=2?'contention':number===3?'crash':number===4?'rotation':number===5?'replacement':'webhook';
      const adapter=number===6?'signed_webhook':'assistant_action';const reviewedAction=adapter==='assistant_action'
        ? {reviewedAction:{key:`action-${number}`,purpose:'Runtime 44 reviewed effect',recipientScope:'internal',adapter,
          payload:{title:'Runtime 44 reviewed effect',description:'Atomic worker bridge probe.',priority:'normal'}}}
        : {reviewedAction:{key:`action-${number}`,purpose:'Runtime 44 webhook retry',recipientScope:'integration',adapter,
          externallyVisible:true,payload:{destinationId:'worker44-webhook',destinationRevision:1,eventType:'probe',data:{status:'accepted'}}}};
      const payloadJson=JSON.stringify(reviewedAction).replaceAll("'","''");return `
      INSERT INTO journey_workflow_runs(id,workflow_id,workflow_version_id,space_id,mode,trigger_fingerprint_sha256,subject_ref_sha256,result_json,result_sha256,actor_user_id,created_at)
        VALUES ('worker42-run-${number}','worker42-workflow','worker42-version','${probeSpaceId}','execution','${probeHash}','${probeProfile}','{}','${probeHash}','worker42-user','${probeAt}');
      INSERT INTO journey_workflow_actions(id,run_id,space_id,action_key,adapter,idempotency_key,decision,approval_required,trace_json,trace_sha256,created_at)
        VALUES ('worker42-action-${number}','worker42-run-${number}','${probeSpaceId}','action-${number}','${adapter}','worker42-action-${number}','approved_held',FALSE,'[]','${probeHash}','${probeAt}');
      INSERT INTO journey_workflow_approvals(id,action_id,space_id,decision,reason,reviewer_user_id,created_at)
        VALUES ('worker42-approval-${number}','worker42-action-${number}','${probeSpaceId}','approved','Approved runtime bridge probe','worker42-user','${probeAt}');
      INSERT INTO journey_action_queue(id,action_id,workflow_id,space_id,adapter,idempotency_key,state,payload_json,payload_sha256,max_attempts,
        available_at,fencing_token,revision,created_at,updated_at) VALUES ('worker42-queue-${number}','worker42-action-${number}','worker42-workflow','${probeSpaceId}',
        '${adapter}','worker42-queue-${number}','ready','${payloadJson}','${probeHash}',5,'${probeAt}',0,1,'${probeAt}','${probeAt}');
      INSERT INTO journey_action_live_contexts(queue_id,space_id,profile_ref_sha256,purpose_key,source_key,created_at)
        VALUES ('worker42-queue-${number}','${probeSpaceId}','${probeProfile}','${purpose}','worker42-source','${probeAt}');`;}).join('')}
    DO $platform$ BEGIN
      IF EXISTS(SELECT 1 FROM journey_kill_switch_states WHERE scope_level='platform') THEN
        UPDATE journey_kill_switch_states SET state='enabled',reason_code='recovery_verified',revision=revision+1,updated_at='${probeAt}' WHERE scope_level='platform';
      ELSE INSERT INTO journey_kill_switch_states(id,scope_level,space_id,scope_key,state,reason_code,revision,created_at,updated_at)
        VALUES ('worker42-platform-switch','platform',NULL,'platform','enabled','recovery_verified',1,'${probeAt}','${probeAt}'); END IF;
    END $platform$;
  COMMIT;`);
  const reviewedWorkerProbe=run(process.execPath,['scripts/probe-journey-action-worker-postgres.mjs'],{env:{...postgresEnvironment(sourceSha256),
    JOURNEY_WORKER_PROBE_SPACE_ID:probeSpaceId}});
  assert.match(reviewedWorkerProbe.stdout,/"reviewedEffectReplayVerified":true/);
  assert.match(reviewedWorkerProbe.stdout,/"webhookUnknownRetryFenced":true/);
  emit('postgres_runtime_44_reviewed_worker_probe_passed',{database});
  const privacyWorkerProbe=run(process.execPath,['scripts/probe-journey-privacy-runtime47-postgres.mjs'],{env:{...postgresEnvironment(sourceSha256),
    POSTGRES_PROBE_OWNER_USER:ownerRole,POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(privacyWorkerProbe.stdout,/"noFalseCompletion":true/u);
  emit('postgres_runtime_47_privacy_worker_probe_passed',{database});
  const blueprintMeasurementProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-blueprint-measurements-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',
      POSTGRES_PROBE_OWNER_USER:ownerRole,POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(blueprintMeasurementProbe.stdout,/"descriptiveNonCausal":true/u);
  emit('postgres_runtime_48_blueprint_measurement_probe_passed',{database});
  const connectorWorkerProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-connector-worker-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',POSTGRES_PROBE_OWNER_USER:ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(connectorWorkerProbe.stdout,/"twoAdapters":true/u);assert.match(connectorWorkerProbe.stdout,/"crossTenant":true/u);
  emit('postgres_runtime_51_connector_worker_probe_passed',{database});
  const operationalFeedProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-operational-stage-feed-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',POSTGRES_PROBE_OWNER_USER:ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(operationalFeedProbe.stdout,/"twoAdapters":true/u);assert.match(operationalFeedProbe.stdout,/"tombstone":true/u);
  emit('postgres_runtime_52_operational_stage_feed_probe_passed',{database});
  const eventRetentionProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-event-retention-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',POSTGRES_PROBE_OWNER_USER:ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(eventRetentionProbe.stdout,/"purgedEligible":true/u);assert.match(eventRetentionProbe.stdout,/"stageLinkedBlocked":true/u);
  emit('postgres_runtime_53_event_retention_probe_passed',{database});
  const evidenceMonitorProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-evidence-monitor-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',POSTGRES_PROBE_OWNER_USER:ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(evidenceMonitorProbe.stdout,/"appRoleRepository":true/u);assert.match(evidenceMonitorProbe.stdout,/"staleFence":true/u);
  emit('postgres_runtime_54_evidence_monitor_probe_passed',{database});
  const workspaceSavedViewProbe=run(process.execPath,['--import','tsx','scripts/probe-journey-workspace-saved-views-postgres.mts'],{
    env:{...postgresEnvironment(sourceSha256),POSTGRES_PROBE_ALLOW_WRITES:'true',POSTGRES_PROBE_OWNER_USER:ownerRole,
      POSTGRES_PROBE_OWNER_PASSWORD_FILE:ownerPasswordFile}});
  assert.match(workspaceSavedViewProbe.stdout,/"appRoleRepository":true/u);
  assert.match(workspaceSavedViewProbe.stdout,/"crossTenantDenied":true/u);
  emit('postgres_runtime_55_workspace_saved_views_probe_passed',{database});

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
  run(process.execPath, ['scripts/probe-journey-stage-reprojection-postgres.mjs'], {
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
      DROP ROLE IF EXISTS ${privacyWorkerRole};
      DROP ROLE IF EXISTS ${connectorWorkerRole};
      DROP ROLE IF EXISTS ${operationalFeedWorkerRole};
      DROP ROLE IF EXISTS ${eventRetentionWorkerRole};
      DROP ROLE IF EXISTS ${workerRole};
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
