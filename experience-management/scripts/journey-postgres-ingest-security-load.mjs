#!/usr/bin/env node

/**
 * Opt-in, destructive-isolated PostgreSQL qualification for the real /v1
 * ingestion routes. Every database, role, file, process, and container is
 * randomly namespaced and removed before a successful result is emitted.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(projectDirectory, '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const suffix = crypto.randomBytes(6).toString('hex');
const container = `experience-pg-ingest-${suffix}`;
const database = `experience_ingest_gate_${suffix}`;
const ownerRole = `experience_ingest_owner_${suffix}`;
const appRole = `experience_ingest_app_${suffix}`;
const postgresImage = String(process.env.JOURNEY_POSTGRES_GATE_IMAGE || 'postgres:16-alpine');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-pg-ingest-'));
const sqlitePath = path.join(temporaryDirectory, 'source.sqlite');
const ownerPasswordFile = path.join(temporaryDirectory, 'owner-password');
const appPasswordFile = path.join(temporaryDirectory, 'app-password');
const adminPasswordFile = path.join(temporaryDirectory, 'admin-password');
const sessionSecretFile = path.join(temporaryDirectory, 'session-secret');
const terraSecretFile = path.join(temporaryDirectory, 'terra-secret');
const xKeyFile = path.join(temporaryDirectory, 'x-key');
const esignKeyFile = path.join(temporaryDirectory, 'esign-key');
const identityKeyFile = path.join(temporaryDirectory, 'journey-identity-key');
const ownerPassword = crypto.randomBytes(24).toString('base64url');
const appPassword = crypto.randomBytes(24).toString('base64url');
const containerAdminPassword = crypto.randomBytes(24).toString('base64url');
const adminPassword = 'Journey-PG-Gate-2026!';
const sessionSecret = crypto.randomBytes(48).toString('base64url');
const terraSecret = crypto.randomBytes(48).toString('base64url');
const xEncryptionKey = crypto.randomBytes(32).toString('base64url');
const esignEncryptionKey = crypto.randomBytes(32).toString('base64url');
const identityHashKey = crypto.randomBytes(48);
const adminEmail = 'journey-pg-gate@seemplify.local';
const allowedOrigin = 'https://postgres-ingest.example.test';
const payloadSentinel = `payload-sentinel-${suffix}`;
const piiSentinel = `pii-sentinel-${suffix}@example.invalid`;
const urlSentinel = `url-sentinel-${suffix}`;
const compatibility = JSON.parse(fs.readFileSync(
  path.join(projectDirectory, 'backend', 'migrations', 'postgres', 'runtime-compatibility.json'), 'utf8'
));
const configuredRuntime = process.env.JOURNEY_POSTGRES_GATE_RUNTIME_VERSION
  ? Number(process.env.JOURNEY_POSTGRES_GATE_RUNTIME_VERSION)
  : Number(compatibility.maximumRuntimeSchemaVersion);
const loadEventCount = Math.max(200, Math.min(2_000,
  Number(process.env.JOURNEY_POSTGRES_GATE_EVENTS || 600)));
const loadConcurrency = Math.max(2, Math.min(32,
  Number(process.env.JOURNEY_POSTGRES_GATE_CONCURRENCY || 8)));
const soakDurationMs = Math.max(2_000, Math.min(60_000,
  Number(process.env.JOURNEY_POSTGRES_GATE_SOAK_MS || 5_000)));
const commandLogs = [];
const serverLogs = [];
const servers = new Set();
let containerStarted = false;
let postgresPort = 0;
let ownerClient;
let appClient;
let summary;
let currentPhase = 'initialization';
let cleanup = {
  databaseDropped: false,
  rolesDropped: false,
  containerRemoved: false,
  temporaryFilesRemoved: false,
  residualContainers: -1
};

function emit(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function redactOperationalText(value) {
  let redacted = String(value || '').replaceAll(temporaryDirectory, '<temporary-directory>');
  for (const secret of [
    ownerPassword, appPassword, containerAdminPassword, adminPassword, sessionSecret,
    terraSecret, xEncryptionKey, esignEncryptionKey, identityHashKey.toString('base64url'),
    payloadSentinel, piiSentinel, urlSentinel
  ]) {
    if (secret) redacted = redacted.replaceAll(secret, '<redacted>');
  }
  return redacted.replace(/\bjp[ks]_(?:dev|stg|live)\.[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{20,}\b/gu,
    '<redacted-event-credential>');
}

function enterPhase(phase) {
  currentPhase = phase;
  emit('journey_postgres_ingest_gate_phase', { phase });
}

function boundedInteger(value, label) {
  assert.ok(Number.isSafeInteger(value), `${label} must be an integer.`);
  return value;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: projectDirectory,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  commandLogs.push(String(result.stdout || ''), String(result.stderr || ''));
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with exit ${result.status}.`);
  }
  return result;
}

function dockerPsql(databaseName, sql, allowFailure = false) {
  const result = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q',
    '-U', 'postgres', '-d', databaseName
  ], {
    input: sql,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  commandLogs.push(String(result.stdout || ''), String(result.stderr || ''));
  if (!allowFailure && result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`docker psql failed with exit ${result.status}.`);
  return result;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate a loopback port.'));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function parseMigration(output) {
  const records = String(output || '').split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const completed = records.findLast((entry) => entry.event === 'migration_complete');
  assert.ok(completed, 'Migration did not emit migration_complete.');
  assert.match(String(completed.sourceSha256 || ''), /^[a-f0-9]{64}$/u);
  return String(completed.sourceSha256);
}

function runtimeEnvironment(sourceSha256, port, stageWorkerEnabled = false) {
  const preserve = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME'];
  const environment = Object.fromEntries(preserve.filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  return {
    ...environment,
    DOTENV_CONFIG_QUIET: 'true',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    FRONTEND_DIST: path.join(temporaryDirectory, 'missing-frontend'),
    UPLOAD_DIR: path.join(temporaryDirectory, 'uploads'),
    KNOWLEDGE_STORAGE_DIR: path.join(temporaryDirectory, 'knowledge'),
    CODEX_RUNTIME_DIR: path.join(temporaryDirectory, 'codex'),
    DATABASE_PROVIDER: 'postgres',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: String(postgresPort),
    POSTGRES_DATABASE: database,
    POSTGRES_USER: appRole,
    POSTGRES_PASSWORD_FILE: appPasswordFile,
    POSTGRES_SSL: 'disable',
    POSTGRES_SCHEMA_VERSION: '1',
    POSTGRES_RUNTIME_SCHEMA_VERSION: String(configuredRuntime),
    POSTGRES_SOURCE_SHA256: sourceSha256,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD_FILE: adminPasswordFile,
    SESSION_SECRET_FILE: sessionSecretFile,
    TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
    LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
    JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
    JOURNEY_POSTGRES_GATE_STAGE_PROCESSING: stageWorkerEnabled ? 'true' : 'false',
    JOURNEY_STAGE_WORKER_POLL_MS: '100',
    JOURNEY_STAGE_WORKER_BATCH_SIZE: '100',
    X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
    ESIGN_STORAGE_DIR: path.join(temporaryDirectory, 'esign'),
    ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
    EMAIL_MODE: 'log',
    MAIL_API_TOKEN: 'disabled-for-postgres-gate',
    NYLAS_CLIENT_ID: 'disabled-for-postgres-gate',
    NYLAS_API_KEY: 'disabled-for-postgres-gate',
    NYLAS_WEBHOOK_SECRET: 'disabled-for-postgres-gate',
    X_SEED_CONSUMER_KEY_FILE: path.join(temporaryDirectory, 'missing-x-key'),
    X_SEED_CONSUMER_SECRET_FILE: path.join(temporaryDirectory, 'missing-x-secret'),
    X_SEED_BEARER_TOKEN_FILE: path.join(temporaryDirectory, 'missing-x-bearer'),
    X_SEED_ACCESS_TOKEN_FILE: path.join(temporaryDirectory, 'missing-x-token'),
    X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(temporaryDirectory, 'missing-x-token-secret')
  };
}

async function waitForExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server ${child.pid} did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function startServer(sourceSha256, port, label, stageWorkerEnabled = false) {
  const child = fork(path.join(projectDirectory, 'scripts', 'journey-postgres-ingest-server.mjs'), [], {
    cwd: projectDirectory,
    env: runtimeEnvironment(sourceSha256, port, stageWorkerEnabled),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  servers.add(child);
  child.stdout.on('data', (chunk) => serverLogs.push(`${label}:stdout:${String(chunk)}`));
  child.stderr.on('data', (chunk) => serverLogs.push(`${label}:stderr:${String(chunk)}`));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} did not become ready.`)), 30_000);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited before readiness (${String(code || signal)}).`));
    };
    child.once('exit', onExit);
    child.on('message', (message) => {
      if (message?.event !== 'journey_postgres_ingest_server_ready') return;
      clearTimeout(timeout);
      child.off('exit', onExit);
      resolve();
    });
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200, `${label} health check failed.`);
  const body = await health.json();
  assert.equal(body.database, 'postgres');
  assert.equal(body.databaseReady, true);
  assert.equal(body.databaseRuntimeSchemaVersion, configuredRuntime);
  return { child, label, port, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.send({ type: 'shutdown' });
  const exited = await waitForExit(server.child);
  assert.equal(exited.code, 0, `${server.label} did not stop gracefully.`);
  servers.delete(server.child);
}

async function crashServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill('SIGKILL');
  await waitForExit(server.child);
  servers.delete(server.child);
}

async function jsonRequest(url, options = {}, timings) {
  const started = performance.now();
  const response = await fetch(url, options);
  const elapsedMs = performance.now() - started;
  if (timings) timings.push(elapsedMs);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { invalidJson: true }; }
  return { status: response.status, headers: response.headers, body, elapsedMs };
}

async function login(baseUrl) {
  const response = await jsonRequest(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert.equal(response.status, 200, 'Admin login failed.');
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  assert.ok(setCookies.length, 'Admin login did not return a session cookie.');
  return setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

async function control(baseUrl, cookie, pathName, input = {}) {
  const response = await jsonRequest(`${baseUrl}${pathName}`, {
    method: input.method || 'GET',
    headers: {
      cookie,
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {})
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
  });
  assert.ok(response.status >= 200 && response.status < 300,
    `Control request ${input.method || 'GET'} ${pathName} failed with ${response.status}.`);
  return response;
}

async function createSource(baseUrl, cookie, input) {
  const created = await control(baseUrl, cookie, '/api/journey-event-control-plane/sources', {
    method: 'POST', idempotencyKey: `${input.key}-source`, body: {
      name: input.name,
      environment: 'production',
      validationMode: 'enforce',
      allowedOrigins: [allowedOrigin],
      allowedBundleIds: [],
      eventsPerMinute: input.eventsPerMinute,
      bytesPerMinute: 10_000_000_000
    }
  });
  const sourceId = String(created.body.source.id);
  const publicCredential = await control(baseUrl, cookie,
    `/api/journey-event-control-plane/sources/${sourceId}/credentials`, {
      method: 'POST', idempotencyKey: `${input.key}-public`, body: { kind: 'public_write' }
    });
  const serverCredential = await control(baseUrl, cookie,
    `/api/journey-event-control-plane/sources/${sourceId}/credentials`, {
      method: 'POST', idempotencyKey: `${input.key}-server`, body: { kind: 'server_secret' }
    });
  const schema = await control(baseUrl, cookie,
    `/api/journey-event-control-plane/sources/${sourceId}/schemas`, {
      method: 'POST', idempotencyKey: `${input.key}-schema`, body: { eventName: 'pg_ingest_event' }
    });
  const version = await control(baseUrl, cookie,
    `/api/journey-event-control-plane/schemas/${schema.body.schema.id}/versions`, {
      method: 'POST', idempotencyKey: `${input.key}-schema-v1`, body: {
        version: '1.0',
        properties: [{
          name: 'kind', type: 'string', required: true, dataClass: 'operational',
          description: 'Bounded PostgreSQL gate traffic class.',
          enumValues: ['direct', 'load', 'race', 'rate', 'quota', 'restart', 'hostile', 'stage']
        }]
      }
    });
  await control(baseUrl, cookie,
    `/api/journey-event-control-plane/schema-versions/${version.body.version.id}/publish`, {
      method: 'POST', body: {}
    });
  return {
    sourceId,
    publicCredentialId: String(publicCredential.body.credential.id),
    publicKey: String(publicCredential.body.secret),
    serverSecret: String(serverCredential.body.secret)
  };
}

async function patchSource(baseUrl, cookie, sourceId, body) {
  const current = await control(baseUrl, cookie, `/api/journey-event-control-plane/sources/${sourceId}`);
  return control(baseUrl, cookie, `/api/journey-event-control-plane/sources/${sourceId}`, {
    method: 'PATCH', body: { expectedRevision: Number(current.body.source.revision), ...body }
  });
}

function envelope(eventId, kind = 'direct', input = {}) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  return {
    protocolVersion: '1.0',
    eventId,
    call: 'track',
    event: 'pg_ingest_event',
    eventVersion: 1,
    occurredAt,
    anonymousId: input.anonymousId || `gate-subject-${eventId}`,
    properties: { kind, ...(input.properties || {}) },
    context: {
      library: { name: 'journey-postgres-gate', version: '1.0.0' },
      ...(input.url ? { page: { url: input.url } } : {})
    },
    ...(input.public ? {
      consent: { analytics: input.consent || 'granted', source: 'postgres_gate', updatedAt: occurredAt }
    } : {})
  };
}

async function postEvent(baseUrl, secret, event, input = {}, timings) {
  return jsonRequest(`${baseUrl}/v1/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...(input.origin ? { origin: input.origin } : {})
    },
    body: JSON.stringify(event)
  }, timings);
}

async function postBatch(baseUrl, secret, events, timings) {
  return jsonRequest(`${baseUrl}/v1/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      protocolVersion: '1.0', batchId: crypto.randomUUID(), sentAt: new Date().toISOString(), events
    })
  }, timings);
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function eventually(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await probe();
    if (lastValue) return lastValue;
    await wait(100);
  }
  throw new Error(`${label} did not converge within ${timeoutMs}ms (last=${JSON.stringify(lastValue)}).`);
}

async function stageProjection(spaceId, eventId, journeyDefinitionId) {
  const row = (await ownerClient.query(`SELECT
    (SELECT state FROM journey_event_processing_inbox WHERE space_id=$1 AND event_id=$2
      AND processor='connected_journey_v1' LIMIT 1) inbox_state,
    (SELECT COUNT(*)::int FROM journey_event_processing_receipts WHERE space_id=$1 AND event_id=$2
      AND processor='connected_journey_v1' AND status='succeeded') succeeded_receipts,
    (SELECT COUNT(*)::int FROM journey_stage_rule_decisions WHERE space_id=$1 AND event_id=$2
      AND journey_definition_id=$3 AND outcome='matched') matched_decisions,
    (SELECT MIN(id) FROM journey_stage_rule_decisions WHERE space_id=$1 AND event_id=$2
      AND journey_definition_id=$3 AND outcome='matched') decision_id,
    (SELECT COUNT(*)::int FROM journey_anonymous_stage_visits WHERE space_id=$1 AND event_id=$2
      AND journey_definition_id=$3) visits,
    (SELECT COUNT(*)::int FROM journey_anonymous_instances WHERE space_id=$1 AND latest_event_id=$2
      AND journey_definition_id=$3) instances,
    (SELECT MIN(id) FROM journey_anonymous_instances WHERE space_id=$1 AND latest_event_id=$2
      AND journey_definition_id=$3) instance_id`, [spaceId, eventId, journeyDefinitionId])).rows[0];
  return {
    inboxState: row.inbox_state || null,
    succeededReceipts: Number(row.succeeded_receipts),
    matchedDecisions: Number(row.matched_decisions),
    decisionId: row.decision_id || null,
    visits: Number(row.visits),
    instances: Number(row.instances),
    instanceId: row.instance_id || null
  };
}

function completedStageProjection(value) {
  return value.inboxState === 'completed' && value.succeededReceipts >= 1
    && value.matchedDecisions === 1 && value.visits === 1 && value.instances === 1
    && Boolean(value.decisionId) && Boolean(value.instanceId);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function assertNoSensitiveOutput(values, logs) {
  const combined = logs.join('\n');
  for (const [label, value] of values) {
    if (!value) continue;
    assert.equal(combined.includes(value), false, `Operational output exposed ${label}.`);
  }
  const credentialPattern = /\bjp[ks]_(?:dev|stg|live)\.[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{20,}\b/gu;
  assert.equal(credentialPattern.test(combined), false, 'Operational output exposed an event credential shape.');
}

async function provisionPostgres() {
  run(dockerCommand, [
    'run', '--detach', '--rm', '--name', container,
    '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_DB=postgres',
    '--env', `POSTGRES_PASSWORD=${containerAdminPassword}`,
    '--publish', '127.0.0.1::5432', postgresImage
  ]);
  containerStarted = true;
  const inspectedPorts = JSON.parse(run(dockerCommand, [
    'inspect', '--format', '{{json .NetworkSettings.Ports}}', container
  ]).stdout);
  const published = inspectedPorts?.['5432/tcp'] || [];
  assert.equal(published.length, 1);
  assert.equal(published[0].HostIp, '127.0.0.1');
  postgresPort = boundedInteger(Number(published[0].HostPort), 'PostgreSQL port');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-q', '-U', 'postgres', '-d', 'postgres'], {
      encoding: 'utf8', windowsHide: true
    });
    if (ready.status === 0) break;
    if (attempt === 59) throw new Error('PostgreSQL container did not become ready within 30 seconds.');
    await wait(500);
  }
  dockerPsql('postgres', `
    CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${sqlLiteral(ownerPassword)};
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${sqlLiteral(appPassword)};
    CREATE DATABASE ${database} OWNER ${ownerRole};
  `);
  dockerPsql('postgres', `
    REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${database} TO ${ownerRole},${appRole};
  `);
}

async function runGate() {
  enterPhase('preflight');
  assert.equal(process.env.JOURNEY_POSTGRES_GATE_ALLOW_DOCKER, 'true',
    'Set JOURNEY_POSTGRES_GATE_ALLOW_DOCKER=true to run the destructive-isolated Docker gate.');
  assert.match(container, /^experience-pg-ingest-[a-f0-9]{12}$/u);
  assert.match(database, /^experience_ingest_gate_[a-f0-9]{12}$/u);
  assert.ok(Number.isSafeInteger(configuredRuntime));
  assert.ok(configuredRuntime >= Number(compatibility.minimumRuntimeSchemaVersion)
    && configuredRuntime <= Number(compatibility.maximumRuntimeSchemaVersion),
  'Requested runtime version is outside runtime-compatibility.json.');
  assert.equal(Number.isSafeInteger(loadEventCount), true);
  assert.equal(Number.isSafeInteger(loadConcurrency), true);
  assert.equal(Number.isSafeInteger(soakDurationMs), true);

  fs.writeFileSync(ownerPasswordFile, `${ownerPassword}\n`, { mode: 0o600 });
  fs.writeFileSync(appPasswordFile, `${appPassword}\n`, { mode: 0o600 });
  fs.writeFileSync(adminPasswordFile, `${adminPassword}\n`, { mode: 0o600 });
  fs.writeFileSync(sessionSecretFile, `${sessionSecret}\n`, { mode: 0o600 });
  fs.writeFileSync(terraSecretFile, `${terraSecret}\n`, { mode: 0o600 });
  fs.writeFileSync(xKeyFile, `${xEncryptionKey}\n`, { mode: 0o600 });
  fs.writeFileSync(esignKeyFile, `${esignEncryptionKey}\n`, { mode: 0o600 });
  fs.writeFileSync(identityKeyFile, identityHashKey, { mode: 0o600 });

  enterPhase('backend-build');
  run(process.execPath, [process.env.npm_execpath || path.join(path.dirname(process.execPath),
    'node_modules', 'npm', 'bin', 'npm-cli.js'), 'run', 'build', '--workspace', 'backend']);
  enterPhase('sqlite-bootstrap');
  run(process.execPath, ['scripts/bootstrap-sqlite-store.mjs', '--sqlite', sqlitePath, '--json']);
  enterPhase('postgres-provision');
  await provisionPostgres();
  enterPhase('sqlite-to-postgres-migration');
  const migrated = run(process.execPath, [
    'scripts/migrate-sqlite-to-postgres.mjs', '--mode', 'migrate', '--sqlite', sqlitePath,
    '--backup-dir', path.join(temporaryDirectory, 'backups'), '--pg-host', '127.0.0.1',
    '--pg-port', String(postgresPort), '--pg-database', database, '--pg-user', ownerRole,
    '--pg-password-file', ownerPasswordFile, '--pg-ssl', 'disable', '--json'
  ]);
  const sourceSha256 = parseMigration(migrated.stdout);
  enterPhase('postgres-runtime-upgrade');
  run(process.execPath, [
    'scripts/upgrade-postgres-schema.mjs', '--target-version', String(configuredRuntime),
    '--expected-source-version', '1', '--expected-source-sha256', sourceSha256,
    '--pg-host', '127.0.0.1', '--pg-port', String(postgresPort), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', ownerPasswordFile, '--pg-ssl', 'disable', '--json'
  ]);
  const privileges = fs.readFileSync(path.join(projectDirectory, 'backend', 'migrations', 'postgres',
    'runtime_privileges.sql'), 'utf8').replaceAll('__DATABASE__', database)
    .replaceAll('__APP_ROLE__', appRole).replaceAll('__OWNER_ROLE__', ownerRole);
  enterPhase('least-privilege-grants');
  dockerPsql(database, privileges);
  const verifyEnvironment = runtimeEnvironment(sourceSha256, 1);
  enterPhase('postgres-runtime-verification');
  run(process.execPath, ['scripts/verify-postgres-runtime.mjs', '--json'], {
    env: { ...verifyEnvironment, DATABASE_PATH: sqlitePath }
  });

  enterPhase('least-privilege-runtime-role');
  ownerClient = new Client({
    host: '127.0.0.1', port: postgresPort, database, user: ownerRole,
    password: ownerPassword, ssl: false, application_name: 'journey-postgres-ingest-gate-owner'
  });
  await ownerClient.connect();
  appClient = new Client({
    host: '127.0.0.1', port: postgresPort, database, user: appRole,
    password: appPassword, ssl: false, application_name: 'journey-postgres-ingest-gate-app-contract'
  });
  await appClient.connect();
  assert.equal((await appClient.query('SELECT current_user value')).rows[0].value, appRole);
  for (const statement of [
    'CREATE TABLE journey_gate_forbidden(id integer)',
    'UPDATE experience_runtime_schema_version SET version=version',
    `SET ROLE ${ownerRole}`
  ]) {
    await assert.rejects(appClient.query(statement), (error) => error?.code === '42501');
  }
  assert.equal((await ownerClient.query("SELECT to_regclass('public.journey_gate_forbidden') value")).rows[0].value, null);

  enterPhase('http-process-startup');
  const portA = await freePort();
  const portB = await freePort();
  let serverA = await startServer(sourceSha256, portA, 'ingest-a', configuredRuntime >= 18);
  const serverB = await startServer(sourceSha256, portB, 'ingest-b', false);
  const bases = [serverA.baseUrl, serverB.baseUrl];
  const cookie = await login(serverA.baseUrl);
  const session = await control(serverA.baseUrl, cookie, '/api/auth/session');
  const spaceId = String(session.body.activeSpace.id);
  const main = await createSource(serverA.baseUrl, cookie, {
    key: `pg-main-${suffix}`, name: 'PostgreSQL ingress load', eventsPerMinute: 1_000_000
  });
  const rateSource = await createSource(serverA.baseUrl, cookie, {
    key: `pg-rate-${suffix}`, name: 'PostgreSQL atomic rate', eventsPerMinute: 5
  });
  const sensitiveValues = [
    ['owner database password', ownerPassword],
    ['application database password', appPassword],
    ['container database password', containerAdminPassword],
    ['bootstrap administrator password', adminPassword],
    ['session secret', sessionSecret],
    ['Terra shared secret', terraSecret],
    ['X encryption key', xEncryptionKey],
    ['e-sign encryption key', esignEncryptionKey],
    ['identity hash key', identityHashKey.toString('base64url')],
    ['public write key', main.publicKey],
    ['server secret', main.serverSecret],
    ['rate server secret', rateSource.serverSecret],
    ['hostile payload sentinel', payloadSentinel],
    ['synthetic PII sentinel', piiSentinel],
    ['URL sentinel', urlSentinel]
  ];

  const receiptsBeforeParserFailures = Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_event_ingest_receipts WHERE space_id=$1', [spaceId]
  )).rows[0].count);
  const malformed = await jsonRequest(`${serverA.baseUrl}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${main.publicKey}`, 'content-type': 'application/json', origin: allowedOrigin },
    body: '{"malformed":'
  });
  assert.equal(malformed.status, 400);
  const oversized = await jsonRequest(`${serverB.baseUrl}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${main.publicKey}`, 'content-type': 'application/json', origin: allowedOrigin },
    body: JSON.stringify({ oversized: 'x'.repeat(600 * 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_event_ingest_receipts WHERE space_id=$1', [spaceId]
  )).rows[0].count), receiptsBeforeParserFailures);

  const wrongOrigin = await postEvent(serverA.baseUrl, main.publicKey,
    envelope(crypto.randomUUID(), 'direct', { public: true }), { origin: 'https://forbidden.example.test' });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);

  const hostileId = crypto.randomUUID();
  const hostile = await postEvent(serverB.baseUrl, main.publicKey,
    envelope(hostileId, 'hostile', {
      public: true,
      anonymousId: piiSentinel,
      properties: { api_token: payloadSentinel, nested: { email: piiSentinel } }
    }), { origin: allowedOrigin });
  assert.equal(hostile.status, 422,
    `Hostile payload status mismatch (code=${String(hostile.body?.error?.code || 'missing')}).`);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_event_rejections WHERE event_id=$1', [hostileId]
  )).rows[0].count), 1);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_raw_events WHERE event_id=$1', [hostileId]
  )).rows[0].count), 0);

  const directId = crypto.randomUUID();
  const directEnvelope = envelope(directId, 'direct', {
    url: `https://product.example.test/activate?token=${urlSentinel}#${payloadSentinel}`
  });
  assert.equal((await postEvent(serverA.baseUrl, main.serverSecret, directEnvelope)).status, 202);
  const duplicate = await postEvent(serverB.baseUrl, main.serverSecret, directEnvelope);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'duplicate');
  const conflict = await postEvent(serverA.baseUrl, main.serverSecret, {
    ...directEnvelope, properties: { kind: 'restart' }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'EVENT_ID_CONFLICT');

  const loadEvents = Array.from({ length: loadEventCount }, () =>
    envelope(crypto.randomUUID(), 'load'));
  const batchSize = 20;
  const batches = [];
  for (let index = 0; index < loadEvents.length; index += batchSize) batches.push(loadEvents.slice(index, index + batchSize));
  const requestLatencies = [];
  const waveCount = 5;
  const waveDurations = [];
  const loadStarted = performance.now();
  for (let wave = 0; wave < waveCount; wave += 1) {
    const waveBatches = batches.filter((_batch, index) => index % waveCount === wave);
    const waveStarted = performance.now();
    const responses = await pool(waveBatches, loadConcurrency, (batch, index) =>
      postBatch(bases[(wave + index) % bases.length], main.serverSecret, batch, requestLatencies));
    for (const response of responses) {
      assert.equal(response.status, 202);
      assert.ok(response.body.results.every((entry) => entry.status === 'accepted'));
    }
    waveDurations.push(performance.now() - waveStarted);
  }
  const loadElapsedMs = performance.now() - loadStarted;

  enterPhase('bounded-sustained-soak');
  const soakStarted = performance.now();
  let soakEvents = 0;
  let soakRequests = 0;
  while (performance.now() - soakStarted < soakDurationMs) {
    const soakBatch = Array.from({ length: 20 }, () => envelope(crypto.randomUUID(), 'load'));
    const response = await postBatch(bases[soakRequests % bases.length], main.serverSecret,
      soakBatch, requestLatencies);
    assert.equal(response.status, 202);
    assert.ok(response.body.results.every((entry) => entry.status === 'accepted'));
    soakEvents += soakBatch.length;
    soakRequests += 1;
    const target = soakStarted + soakRequests * 100;
    if (performance.now() < target) await wait(Math.min(100, target - performance.now()));
  }
  const soakElapsedMs = performance.now() - soakStarted;

  enterPhase('atomic-deduplication-and-conflict');
  const duplicateSample = loadEvents.slice(0, 40);
  const duplicateResponses = await Promise.all([
    postBatch(serverA.baseUrl, main.serverSecret, duplicateSample.slice(0, 20), requestLatencies),
    postBatch(serverB.baseUrl, main.serverSecret, duplicateSample.slice(20), requestLatencies)
  ]);
  for (const response of duplicateResponses) {
    assert.equal(response.status, 200);
    assert.ok(response.body.results.every((entry) => entry.status === 'duplicate'));
  }
  const conflictEvents = loadEvents.slice(40, 50).map((event) => ({
    ...event, properties: { kind: 'direct' }
  }));
  const conflictBatch = await postBatch(serverA.baseUrl, main.serverSecret, conflictEvents, requestLatencies);
  assert.equal(conflictBatch.status, 207);
  assert.ok(conflictBatch.body.results.every((entry) =>
    entry.status === 'rejected' && entry.code === 'EVENT_ID_CONFLICT'));

  const raceEnvelope = envelope(crypto.randomUUID(), 'race');
  const raceResponses = await Promise.all(Array.from({ length: 16 }, (_value, index) =>
    postEvent(bases[index % bases.length], main.serverSecret, raceEnvelope, {}, requestLatencies)));
  assert.equal(raceResponses.filter((response) => response.status === 202).length, 1);
  assert.equal(raceResponses.filter((response) => response.status === 200).length, 15);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_raw_events WHERE event_id=$1', [raceEnvelope.eventId]
  )).rows[0].count), 1);

  const rateEvents = Array.from({ length: 10 }, () => envelope(crypto.randomUUID(), 'rate'));
  const rateLimited = await postBatch(serverB.baseUrl, rateSource.serverSecret, rateEvents, requestLatencies);
  assert.equal(rateLimited.status, 207);
  assert.equal(rateLimited.body.results.filter((entry) => entry.status === 'accepted').length, 5);
  const rateRetryEvents = rateEvents.filter((event) => rateLimited.body.results
    .some((entry) => entry.eventId === event.eventId && entry.code === 'EVENT_SOURCE_RATE_LIMITED'));
  assert.equal(rateRetryEvents.length, 5);
  await patchSource(serverA.baseUrl, cookie, rateSource.sourceId, { eventsPerMinute: 1_000_000 });
  const rateRetry = await postBatch(serverA.baseUrl, rateSource.serverSecret, rateEvents, requestLatencies);
  assert.equal(rateRetry.status, 207);
  assert.equal(rateRetry.body.results.filter((entry) => entry.status === 'duplicate').length, 5);
  assert.equal(rateRetry.body.results.filter((entry) => entry.status === 'accepted').length, 5);

  const planResult = await ownerClient.query(
    "SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'");
  const originalLimits = planResult.rows[0].limits_json;
  const parsedLimits = typeof originalLimits === 'string' ? JSON.parse(originalLimits) : originalLimits;
  const usedBeforeQuota = Number((await ownerClient.query(`SELECT COALESCE(SUM(quantity),0)::int used
    FROM platform_usage_events WHERE space_id=$1 AND meter='monthlyTrackedEvents'`, [spaceId])).rows[0].used);
  const quotaLimits = { ...parsedLimits, monthlyTrackedEvents: usedBeforeQuota + 5 };
  await ownerClient.query("UPDATE platform_subscription_plans SET limits_json=$1 WHERE code='enterprise'",
    [JSON.stringify(quotaLimits)]);
  const quotaEvents = Array.from({ length: 20 }, () => envelope(crypto.randomUUID(), 'quota'));
  const quotaResponses = await Promise.all(quotaEvents.map((event, index) =>
    postEvent(bases[index % bases.length], main.serverSecret, event, {}, requestLatencies)));
  assert.equal(quotaResponses.filter((response) => response.status === 202).length, 5);
  assert.equal(quotaResponses.filter((response) => response.status === 429
    && response.body.code === 'EVENT_MONTHLY_QUOTA_EXCEEDED').length, 15);
  await ownerClient.query("UPDATE platform_subscription_plans SET limits_json=$1 WHERE code='enterprise'",
    [typeof originalLimits === 'string' ? originalLimits : JSON.stringify(originalLimits)]);
  const quotaRetryEvents = quotaEvents.filter((_event, index) => quotaResponses[index].status === 429);
  const quotaRetry = await Promise.all(quotaRetryEvents.map((event, index) =>
    postEvent(bases[index % bases.length], main.serverSecret, event, {}, requestLatencies)));
  assert.ok(quotaRetry.every((response) => response.status === 202));

  const restartEnvelope = envelope(crypto.randomUUID(), 'restart');
  assert.equal((await postEvent(serverA.baseUrl, main.serverSecret, restartEnvelope)).status, 202);
  await stopServer(serverA);
  assert.equal((await postEvent(serverB.baseUrl, main.serverSecret, restartEnvelope)).status, 200);
  serverA = await startServer(sourceSha256, portA, 'ingest-a-restarted', configuredRuntime >= 18);
  assert.equal((await postEvent(serverA.baseUrl, main.serverSecret, restartEnvelope)).status, 200);

  const crashEvents = Array.from({ length: 50 }, () => envelope(crypto.randomUUID(), 'restart'));
  const uncertain = postBatch(serverA.baseUrl, main.serverSecret, crashEvents, requestLatencies)
    .catch(() => ({ status: 0, body: null }));
  await wait(125);
  await crashServer(serverA);
  await uncertain;
  serverA = await startServer(sourceSha256, portA, 'ingest-a-crash-recovered', configuredRuntime >= 18);
  const crashRetry = await postBatch(serverA.baseUrl, main.serverSecret, crashEvents, requestLatencies);
  assert.ok([200, 202, 207].includes(crashRetry.status));
  assert.ok(crashRetry.body.results.every((entry) => ['accepted', 'duplicate'].includes(entry.status)));
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_raw_events WHERE event_id=ANY($1::text[])',
    [crashEvents.map((event) => event.eventId)])).rows[0].count), crashEvents.length);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_event_deduplication WHERE event_id=ANY($1::text[])',
    [crashEvents.map((event) => event.eventId)])).rows[0].count), crashEvents.length);

  let stageProcessingSummary = {
    exercised: false,
    reason: `runtime schema ${configuredRuntime} does not include stage processing`
  };
  if (configuredRuntime >= 18) {
    enterPhase('runtime18-stage-processing');
    const createdMap = await control(serverA.baseUrl, cookie, '/api/journey-maps', {
      method: 'POST',
      body: {
        name: 'PostgreSQL connected-journey gate',
        purpose: 'Exercise the real runtime-18 stage projection on a least-privilege PostgreSQL process.',
        experienceType: 'customer',
        mapType: 'current_state',
        stageNames: ['Activated']
      }
    });
    const journeyDefinitionId = String(createdMap.body.id);
    const draftMap = await control(serverA.baseUrl, cookie, `/api/journey-maps/${journeyDefinitionId}`);
    assert.equal(draftMap.body.stages.length, 1);
    const stageKey = String(draftMap.body.stages[0].stageKey);
    const publishedMap = await control(serverA.baseUrl, cookie,
      `/api/journey-maps/${journeyDefinitionId}/publish`, {
        method: 'POST', body: { expectedRevision: Number(createdMap.body.revision) }
      });
    const publishedVersionId = String(publishedMap.body.publishedVersionId);
    assert.equal(publishedVersionId, String(draftMap.body.version.id));
    const createdRule = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/rules`, {
        method: 'POST',
        body: {
          name: 'Activated event', journeyMapVersionId: publishedVersionId, stageKey,
          role: 'entry', priority: 100, eventName: 'pg_ingest_event',
          sourceIds: [main.sourceId], environments: ['production'],
          predicates: [{ path: 'kind', operator: 'equals', value: 'stage' }],
          requiredPriorEvents: [], excludedEventNames: []
        }
      });
    const ruleDefinitionId = String(createdRule.body.rule.id);
    const publishedRule = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/rules/${ruleDefinitionId}/publish`, {
        method: 'POST', body: { expectedRevision: Number(createdRule.body.rule.revision) }
      });
    assert.equal(publishedRule.body.replayed, false);

    const projectedEvent = envelope(crypto.randomUUID(), 'stage', {
      anonymousId: `stage-subject-primary-${suffix}`
    });
    assert.equal((await postEvent(serverA.baseUrl, main.serverSecret, projectedEvent)).status, 202);
    const firstProjection = await eventually('runtime-18 stage projection', async () => {
      const value = await stageProjection(spaceId, projectedEvent.eventId, journeyDefinitionId);
      return completedStageProjection(value) ? value : null;
    });
    const decision = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/decisions/${firstProjection.decisionId}`);
    assert.equal(decision.body.decision.outcome, 'matched');
    assert.equal(decision.body.decision.stageKey, stageKey);
    assert.equal(decision.body.decision.processor, 'connected_journey_v1');
    assert.equal(decision.body.decision.journeyMapVersionId, publishedVersionId);
    assert.ok(decision.body.decision.provenance.schemaVersionId);

    await stopServer(serverA);
    const recoveredEvent = envelope(crypto.randomUUID(), 'stage', {
      anonymousId: `stage-subject-recovery-${suffix}`
    });
    assert.equal((await postEvent(serverB.baseUrl, main.serverSecret, recoveredEvent)).status, 202);
    const queuedBeforeRestart = await stageProjection(spaceId, recoveredEvent.eventId, journeyDefinitionId);
    assert.equal(queuedBeforeRestart.inboxState, 'pending');
    assert.equal(queuedBeforeRestart.succeededReceipts, 0);
    serverA = await startServer(sourceSha256, portA, 'ingest-a-stage-recovered', true);
    const recoveredProjection = await eventually('runtime-18 restart projection recovery', async () => {
      const value = await stageProjection(spaceId, recoveredEvent.eventId, journeyDefinitionId);
      return completedStageProjection(value) ? value : null;
    });

    const aggregates = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/aggregates`);
    assert.equal(aggregates.body.total, 2);
    assert.equal(aggregates.body.byState.active, 2);
    assert.equal(aggregates.body.byStage[stageKey], 2);
    const instances = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/instances?limit=10`);
    assert.equal(instances.body.instances.length, 2);
    const instanceDetail = await control(serverA.baseUrl, cookie,
      `/api/journey-stage-rules/${journeyDefinitionId}/instances/${recoveredProjection.instanceId}`);
    assert.equal(instanceDetail.body.instance.currentStageKey, stageKey);
    assert.equal(instanceDetail.body.visits.length, 1);
    assert.equal(instanceDetail.body.visits[0].eventId, recoveredEvent.eventId);
    assert.equal(instanceDetail.body.visits[0].appliedToCurrent, true);
    const processingPartitions = (await ownerClient.query(`SELECT tableoid::regclass::text partition,COUNT(*)::int count
      FROM journey_event_processing_receipts WHERE space_id=$1 AND event_id=ANY($2::text[])
      GROUP BY tableoid ORDER BY partition`, [spaceId, [projectedEvent.eventId, recoveredEvent.eventId]])).rows;
    assert.ok(processingPartitions.length > 0 && processingPartitions.every((entry) =>
      /^journey_event_processing_receipts_\d{4}_\d{2}$/u.test(entry.partition)));
    stageProcessingSummary = {
      exercised: true,
      journeyDefinitionId,
      publishedMapVersionId: publishedVersionId,
      publishedRuleDefinitionId: ruleDefinitionId,
      projectedEvents: 2,
      decisions: firstProjection.matchedDecisions + recoveredProjection.matchedDecisions,
      visits: firstProjection.visits + recoveredProjection.visits,
      instances: Number(aggregates.body.total),
      aggregateStageCount: Number(aggregates.body.byStage[stageKey]),
      restartRecoveryQueuedState: queuedBeforeRestart.inboxState,
      restartRecoveryCompletedState: recoveredProjection.inboxState,
      processingReceiptPartitions: processingPartitions
    };
  }

  enterPhase('credential-revocation');
  await control(serverA.baseUrl, cookie,
    `/api/journey-event-control-plane/credentials/${main.publicCredentialId}/revoke`, {
      method: 'POST', body: {}
    });
  const revokedId = crypto.randomUUID();
  const revoked = await postEvent(serverB.baseUrl, main.publicKey,
    envelope(revokedId, 'direct', { public: true }), { origin: allowedOrigin });
  assert.equal(revoked.status, 401);
  assert.equal(Number((await ownerClient.query(
    'SELECT COUNT(*)::int count FROM journey_event_ingest_receipts WHERE event_id=$1', [revokedId]
  )).rows[0].count), 0);

  const rejectedDebug = await control(serverA.baseUrl, cookie,
    `/api/journey-event-control-plane/sources/${main.sourceId}/debug-events?outcome=rejected&limit=100`);
  const debuggerJson = JSON.stringify(rejectedDebug.body);
  assertNoSensitiveOutput(sensitiveValues, [debuggerJson]);

  const storedSentinels = await ownerClient.query(`SELECT
    (SELECT COUNT(*)::int FROM journey_raw_events WHERE space_id=$1 AND
      (payload_json::text LIKE $2 OR context_json::text LIKE $2 OR consent_json::text LIKE $2)) raw_hits,
    (SELECT COUNT(*)::int FROM journey_event_rejections WHERE space_id=$1 AND redacted_detail_json::text LIKE $2) rejection_hits`,
  [spaceId, `%${payloadSentinel}%`]);
  assert.deepEqual(storedSentinels.rows[0], { raw_hits: 0, rejection_hits: 0 });
  const storedPii = await ownerClient.query(`SELECT COUNT(*)::int count FROM journey_raw_events
    WHERE space_id=$1 AND (payload_json::text LIKE $2 OR context_json::text LIKE $2
      OR anonymous_id_hash LIKE $2 OR user_id_hash LIKE $2)`, [spaceId, `%${piiSentinel}%`]);
  assert.equal(storedPii.rows[0].count, 0);
  const storedUrl = await ownerClient.query(`SELECT COUNT(*)::int count FROM journey_raw_events
    WHERE event_id=$1 AND context_json::text LIKE $2`, [directId, `%${urlSentinel}%`]);
  assert.equal(storedUrl.rows[0].count, 0);

  const reconciliation = (await ownerClient.query(`SELECT
    (SELECT COUNT(*)::int FROM journey_raw_events WHERE space_id=$1) raw_events,
    (SELECT COUNT(*)::int FROM journey_event_deduplication WHERE space_id=$1) dedupe_events,
    (SELECT COUNT(*)::int FROM journey_event_processing_inbox WHERE space_id=$1) inbox_events,
    (SELECT COALESCE(SUM(quantity),0)::int FROM platform_usage_events
      WHERE space_id=$1 AND meter='monthlyTrackedEvents') metered_events,
    (SELECT COUNT(*)::int FROM journey_event_ingest_receipts WHERE space_id=$1) receipts,
    (SELECT COUNT(*)::int FROM journey_event_rejections WHERE space_id=$1) rejections,
    (SELECT COALESCE(EXTRACT(EPOCH FROM (NOW()-MIN(available_at::timestamptz)))*1000,0)::bigint
      FROM journey_event_processing_inbox WHERE space_id=$1 AND state='pending') oldest_queue_age_ms`,
  [spaceId])).rows[0];
  for (const key of ['raw_events', 'dedupe_events', 'inbox_events', 'metered_events']) {
    reconciliation[key] = Number(reconciliation[key]);
  }
  reconciliation.receipts = Number(reconciliation.receipts);
  reconciliation.rejections = Number(reconciliation.rejections);
  reconciliation.oldest_queue_age_ms = Number(reconciliation.oldest_queue_age_ms);
  assert.equal(reconciliation.raw_events, reconciliation.dedupe_events);
  assert.equal(reconciliation.raw_events, reconciliation.inbox_events);
  assert.equal(reconciliation.raw_events, reconciliation.metered_events);

  const rawPartitions = (await ownerClient.query(`SELECT tableoid::regclass::text partition,COUNT(*)::int count
    FROM journey_raw_events WHERE space_id=$1 GROUP BY tableoid ORDER BY partition`, [spaceId])).rows;
  const receiptPartitions = (await ownerClient.query(`SELECT tableoid::regclass::text partition,COUNT(*)::int count
    FROM journey_event_ingest_receipts WHERE space_id=$1 GROUP BY tableoid ORDER BY partition`, [spaceId])).rows;
  assert.ok(rawPartitions.length > 0 && rawPartitions.every((entry) => /^journey_raw_events_\d{4}_\d{2}$/u.test(entry.partition)));
  assert.ok(receiptPartitions.length > 0 && receiptPartitions.every((entry) =>
    /^journey_event_ingest_receipts_\d{4}_\d{2}$/u.test(entry.partition)));

  const receiptOutcomes = (await ownerClient.query(`SELECT outcome,COUNT(*)::int count
    FROM journey_event_ingest_receipts WHERE space_id=$1 GROUP BY outcome ORDER BY outcome`, [spaceId])).rows;
  const queueStates = (await ownerClient.query(`SELECT state,COUNT(*)::int count
    FROM journey_event_processing_inbox WHERE space_id=$1 GROUP BY state ORDER BY state`, [spaceId])).rows;
  assertNoSensitiveOutput(sensitiveValues, [...commandLogs, ...serverLogs]);
  await stopServer(serverA);
  await stopServer(serverB);

  return {
    runtime: {
      node: process.version,
      postgresImage,
      runtimeSchemaVersion: configuredRuntime,
      appProcesses: 2,
      databaseRole: 'dedicated-non-owner-runtime'
    },
    traffic: {
      generatedLoadEvents: loadEventCount,
      waves: waveCount,
      batchSize,
      concurrency: loadConcurrency,
      elapsedMs: Number(loadElapsedMs.toFixed(2)),
      throughputEventsPerSecond: Number((loadEventCount / (loadElapsedMs / 1_000)).toFixed(2)),
      waveDurationsMs: waveDurations.map((value) => Number(value.toFixed(2)))
    },
    soak: {
      durationMs: Number(soakElapsedMs.toFixed(2)),
      requests: soakRequests,
      events: soakEvents,
      averageEventsPerSecond: Number((soakEvents / (soakElapsedMs / 1_000)).toFixed(2))
    },
    latencyMs: {
      requests: requestLatencies.length,
      p50: Number(percentile(requestLatencies, 0.5).toFixed(2)),
      p95: Number(percentile(requestLatencies, 0.95).toFixed(2)),
      p99: Number(percentile(requestLatencies, 0.99).toFixed(2)),
      maximum: Number(Math.max(...requestLatencies).toFixed(2))
    },
    reconciliation: {
      ...reconciliation,
      rawDedupeDrift: reconciliation.raw_events - reconciliation.dedupe_events,
      rawInboxDrift: reconciliation.raw_events - reconciliation.inbox_events,
      rawMeterDrift: reconciliation.raw_events - reconciliation.metered_events
    },
    queue: {
      states: Object.fromEntries(queueStates.map((entry) => [entry.state, Number(entry.count)])),
      oldestPendingAgeMs: reconciliation.oldest_queue_age_ms
    },
    partitions: { raw: rawPartitions, receipts: receiptPartitions },
    outcomes: Object.fromEntries(receiptOutcomes.map((entry) => [entry.outcome, Number(entry.count)])),
    expectedErrorTraffic: {
      malformedJson: 1,
      oversizedBody: 1,
      forbiddenOrigin: 1,
      hostilePayload: 1,
      eventIdConflicts: 11,
      sourceRateLimitedThenRetried: 5,
      globalQuotaLimitedThenRetried: 15,
      revokedCredential: 1,
      unexpectedResponses: 0
    },
    atomicity: {
      sameEventRace: { attempts: 16, accepted: 1, duplicates: 15, durableRows: 1 },
      sourceRateLimit: { attempted: 10, initiallyAccepted: 5, initiallyLimited: 5, retryAccepted: 5 },
      globalQuota: { attempted: 20, initiallyAccepted: 5, initiallyLimited: 15, retryAccepted: 15 },
      duplicateBatchEvents: 40,
      conflictingBatchEvents: 10
    },
    recovery: {
      gracefulRestartDuplicateSafe: true,
      forcedMidBatchRetryReconciled: true,
      crashBatchEvents: crashEvents.length
    },
    stageProcessing: stageProcessingSummary,
    security: {
      leastPrivilegeRuntimeRole: true,
      deniedRuntimeOperations: ['schema_create', 'runtime_metadata_update', 'owner_role_assumption'],
      malformedRejectedBeforeDurability: true,
      oversizedRejectedBeforeDurability: true,
      hostilePayloadRedacted: true,
      originBindingEnforced: true,
      revokeObservedAcrossProcesses: true,
      outputAndLogSentinelFindings: 0,
      storedSentinelFindings: 0
    },
    informationalTargets: {
      ratified: false,
      candidateAcceptedBatchP95Ms: 300,
      observedAgainstCandidate: percentile(requestLatencies, 0.95) <= 300 ? 'within' : 'outside',
      note: 'Local Docker evidence only; hardware profile and production SLO are not ratified.'
    },
    remainingBlockers: [
      'INDEPENDENT_SECURITY_PRIVACY_REVIEW_PENDING',
      'RATIFIED_HARDWARE_AND_LOAD_PROFILE_PENDING',
      'MULTI_NODE_PRODUCTION_POSTGRES_FAILOVER_NOT_EXERCISED',
      'SUSTAINED_RECOVERY_AND_LIVE_TRAFFIC_SOAK_PENDING',
      'SIGNED_SLO_AND_CAPACITY_APPROVAL_PENDING'
    ]
  };
}

let failure;
try {
  summary = await runGate();
} catch (error) {
  failure = error;
} finally {
  for (const child of [...servers]) {
    try { child.kill('SIGKILL'); await waitForExit(child, 5_000); } catch { /* cleanup recorded below */ }
    servers.delete(child);
  }
  try { await appClient?.end(); } catch { /* database termination below is authoritative */ }
  try { await ownerClient?.end(); } catch { /* database termination below is authoritative */ }
  if (containerStarted) {
    const databaseCleanup = dockerPsql('postgres', `
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname=${sqlLiteral(database)} AND pid<>pg_backend_pid();
      DROP DATABASE IF EXISTS ${database};
      DO $cleanup$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_database WHERE datname=${sqlLiteral(database)}) THEN
          RAISE EXCEPTION 'database cleanup failed';
        END IF;
      END $cleanup$;
    `, true);
    cleanup.databaseDropped = !databaseCleanup.error && databaseCleanup.status === 0;
    const roleCleanup = dockerPsql('postgres', `
      DROP ROLE IF EXISTS ${appRole};
      DROP ROLE IF EXISTS ${ownerRole};
      DO $cleanup$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (${sqlLiteral(appRole)},${sqlLiteral(ownerRole)})) THEN
          RAISE EXCEPTION 'role cleanup failed';
        END IF;
      END $cleanup$;
    `, true);
    cleanup.rolesDropped = !roleCleanup.error && roleCleanup.status === 0;
    const removed = spawnSync(dockerCommand, ['rm', '--force', container], {
      encoding: 'utf8', windowsHide: true
    });
    commandLogs.push(String(removed.stdout || ''), String(removed.stderr || ''));
    cleanup.containerRemoved = !removed.error && removed.status === 0;
    const residual = spawnSync(dockerCommand, ['inspect', container], { encoding: 'utf8', windowsHide: true });
    cleanup.residualContainers = residual.status === 0 ? 1 : 0;
  } else {
    cleanup.databaseDropped = true;
    cleanup.rolesDropped = true;
    cleanup.containerRemoved = true;
    cleanup.residualContainers = 0;
  }
  const resolvedTemporary = path.resolve(temporaryDirectory);
  const resolvedSystemTemporary = path.resolve(os.tmpdir());
  if (resolvedTemporary.startsWith(`${resolvedSystemTemporary}${path.sep}`)
      && path.basename(resolvedTemporary).startsWith('experience-pg-ingest-')) {
    fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    cleanup.temporaryFilesRemoved = !fs.existsSync(resolvedTemporary);
  }
}

if (failure) {
  const diagnostic = serverLogs.findLast((entry) => entry.includes('request failed:'));
  emit('journey_postgres_ingest_gate_failed', {
    code: failure.code || 'GATE_ASSERTION_FAILED',
    phase: currentPhase,
    message: redactOperationalText(failure.message || failure),
    ...(diagnostic ? { diagnostic: redactOperationalText(diagnostic).slice(0, 1_000) } : {}),
    cleanup
  });
  process.exitCode = 1;
} else {
  assert.deepEqual(cleanup, {
    databaseDropped: true,
    rolesDropped: true,
    containerRemoved: true,
    temporaryFilesRemoved: true,
    residualContainers: 0
  });
  emit('journey_postgres_ingest_gate_complete', { ...summary, cleanup });
}
