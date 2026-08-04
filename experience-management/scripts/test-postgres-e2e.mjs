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
const playwrightArguments = process.argv.slice(2);

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

function configureContainer() {
  if (usesEphemeralContainer) {
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
    POSTGRES_RUNTIME_SCHEMA_VERSION: '11',
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
  assert.ok(fs.existsSync(playwrightCli), `Playwright CLI was not found at ${playwrightCli}.`);
  assertE2eServerPortAvailable();

  configureContainer();
  emit('postgres_e2e_container_ready', { container, ephemeral: usesEphemeralContainer, port });

  emit('postgres_e2e_build_started');
  run(process.execPath, [npmCli, 'run', 'build']);
  emit('postgres_e2e_build_complete');
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

  run(process.execPath, [
    'scripts/upgrade-postgres-schema.mjs', '--target-version', '10',
    '--expected-source-version', '1', '--expected-source-sha256', sourceSha256,
    '--pg-host', host, '--pg-port', String(port), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', ownerPasswordFile,
    '--pg-ssl', 'disable', '--json'
  ]);

  const privilegeSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', 'runtime_privileges.sql'), 'utf8')
    .replaceAll('__DATABASE__', database)
    .replaceAll('__APP_ROLE__', appRole)
    .replaceAll('__OWNER_ROLE__', ownerRole);
  dockerPsql(database, privilegeSql);

  const runtimeEnvironment = postgresEnvironment(sourceSha256);
  run(process.execPath, ['scripts/verify-postgres-runtime.mjs', '--json'], {
    env: { ...runtimeEnvironment, DATABASE_PATH: sqlitePath }, stdio: 'inherit'
  });
  emit('postgres_e2e_playwright_started', { database });
  run(process.execPath, [playwrightCli, 'test', ...playwrightArguments], { env: runtimeEnvironment, stdio: 'inherit' });
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
