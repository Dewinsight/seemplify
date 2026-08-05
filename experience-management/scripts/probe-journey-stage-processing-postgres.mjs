#!/usr/bin/env node

/**
 * Production-shaped runtime-18 proof. It runs only inside the randomly named
 * PostgreSQL E2E database, sends events through the real public HTTP endpoint,
 * restarts the real server, and lets its durable worker build projections.
 * The enclosing E2E runner drops the isolated database immediately afterward.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg18_${crypto.randomBytes(8).toString('hex')}`;
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-stage-pg18-'));
const identityKeyFile = path.join(temporaryDir, 'identity-hmac-key');
fs.writeFileSync(identityKeyFile, crypto.randomBytes(48));

function password(file, label) {
  assert.ok(file && fs.existsSync(file), `${label} password file is required.`);
  const value = fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/u, '');
  assert.ok(value, `${label} password file is empty.`);
  return value;
}

function connection(user, passwordValue, applicationName) {
  return { host, port, database, user, password: passwordValue, ssl: false,
    application_name: applicationName, connectionTimeoutMillis: 10_000, query_timeout: 30_000 };
}

async function rejected(promise, codes) {
  await assert.rejects(promise, (error) => codes.includes(String(error?.code)),
    `Expected PostgreSQL error ${codes.join(' or ')}.`);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become true within ${timeoutMs}ms.${lastError ? ` ${lastError}` : ''}`);
}

const serverPort = await availablePort();
const publicUrl = `http://127.0.0.1:${serverPort}`;
const serverEnvironment = {
  ...process.env,
  PORT: String(serverPort), HOST: '127.0.0.1', PUBLIC_URL: publicUrl,
  JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
  JOURNEY_STAGE_WORKER_POLL_MS: '60000', JOURNEY_STAGE_WORKER_BATCH_SIZE: '25',
  EMAIL_MODE: 'log', DOTENV_CONFIG_QUIET: 'true'
};

let serverProcess;
let serverOutput = '';
async function startServer() {
  serverOutput = '';
  const child = spawn(process.execPath, [path.join(projectDir, 'backend', 'dist', 'server.js')], {
    cwd: projectDir, env: serverEnvironment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
  child.stderr.on('data', (chunk) => { serverOutput += String(chunk); });
  serverProcess = child;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${serverOutput}`);
    const response = await fetch(`${publicUrl}/health`);
    return response.ok;
  }, 'runtime-18 HTTP server');
  return child;
}

async function stopServer() {
  const child = serverProcess;
  if (!child || child.exitCode !== null) { serverProcess = undefined; return; }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`server shutdown timed out: ${serverOutput}`)), 15_000))
  ]);
  serverProcess = undefined;
}

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-18 stage probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-18 stage probe refuses to run outside the disposable E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);

const owner = new Client(connection(ownerUser, password(ownerPasswordFile, 'owner'), 'journey-stage-pg18-owner'));
const app = new Client(connection(appUser, password(appPasswordFile, 'app'), 'journey-stage-pg18-app'));
const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const sourceId = `${proof}_source`;
const schemaCreated = `${proof}_schema_created`;
const schemaActivated = `${proof}_schema_activated`;
const schemaCreatedV1 = `${proof}_schema_created_v1`;
const schemaActivatedV1 = `${proof}_schema_activated_v1`;
const definitionId = `${proof}_journey`;
const mapVersionId = `${proof}_map_v1`;
const entryStage = `${proof}_entry`;
const valueStage = `${proof}_value`;
const entryRule = `${proof}_entry_rule`;
const entryRuleVersion = `${proof}_entry_rule_v1`;
const successRule = `${proof}_success_rule`;
const successRuleVersion = `${proof}_success_rule_v1`;
const credentialId = `${proof}_key`;
const secretPart = 's'.repeat(43);
const salt = 't'.repeat(24);
const credentialSecret = `jpk_live.${credentialId}.${secretPart}`;
const credentialDigest = crypto.scryptSync(credentialSecret, salt, 32,
  { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
const seededAt = new Date().toISOString();
const properties = JSON.stringify([{
  name: 'plan_id', type: 'string', required: true, dataClass: 'operational',
  description: 'Bounded plan identifier.', maximumLength: 32, enumValues: ['team', 'enterprise']
}]);

function envelope(eventId, event, anonymousId, occurredAt) {
  return {
    protocolVersion: '1.0', eventId, call: 'track', event, eventVersion: 1, occurredAt,
    anonymousId, properties: { plan_id: 'team' },
    context: { library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'pg18-proof', updatedAt: occurredAt }
  };
}

async function ingest(eventId, event, anonymousId, occurredAt) {
  const response = await fetch(`${publicUrl}/v1/events`, {
    method: 'POST', headers: { Authorization: `Bearer ${credentialSecret}`, Origin: publicUrl,
      'Content-Type': 'application/json', 'X-Request-Id': `${proof}:${eventId}` },
    body: JSON.stringify(envelope(eventId, event, anonymousId, occurredAt))
  });
  const body = await response.json();
  assert.equal(response.status, 202, JSON.stringify(body));
  assert.equal(body.status, 'accepted');
}

try {
  await Promise.all([owner.connect(), app.connect()]);
  assert.ok(Number((await owner.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version) >= 18,
    'the runtime-18 stage-processing schema must be present');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'PG18 stage proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'PG18 stage A',$2,$3,NULL,$4,$4),($5,'PG18 stage B',$6,$3,NULL,$4,$4)`,
  [spaceA, `${proof}-a`, userId, seededAt, spaceB, `${proof}-b`]);

  await owner.query(`INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
      events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_by_user_id,revision,created_at,updated_at)
    VALUES ($1,$2,'PG18 browser','production','active','enforce',$3,'[]',1000,1000000,$4,$5,$6,1,$7,$7)`,
  [sourceId, spaceA, JSON.stringify([publicUrl]), `${proof}:source`, 'a'.repeat(64), userId, seededAt]);
  await owner.query(`INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
      idempotency_key,intent_hash,created_by_user_id,created_at)
    VALUES ($1,$2,$3,'production','public_write','events:write',$4,'scrypt-v1',$5,$6,'active',$7,$8,$9,$10)`,
  [credentialId, sourceId, spaceA, `jpk_live.${credentialId}`, salt, credentialDigest,
    `${proof}:credential`, 'b'.repeat(64), userId, seededAt]);
  const insertSchema = `INSERT INTO journey_event_schemas
    (id,source_id,space_id,event_name,idempotency_key,intent_hash,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`;
  await owner.query(insertSchema, [schemaCreated, sourceId, spaceA, 'workspace_created', `${proof}:schema-created`,
    'c'.repeat(64), userId, seededAt]);
  await owner.query(insertSchema, [schemaActivated, sourceId, spaceA, 'workspace_activated', `${proof}:schema-activated`,
    'd'.repeat(64), userId, seededAt]);
  const insertSchemaVersion = `INSERT INTO journey_event_schema_versions
    (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,
      compatibility_json,content_sha256,idempotency_key,intent_hash,created_by_user_id,published_by_user_id,
      created_at,published_at)
    VALUES ($1,$2,$3,$4,'1.0',1,0,'published',$5,$6,$7,$8,$9,$10,$10,$11,$11)`;
  await owner.query(insertSchemaVersion, [schemaCreatedV1, schemaCreated, sourceId, spaceA, properties,
    JSON.stringify({ compatible: true, issues: [] }), 'e'.repeat(64), `${proof}:schema-created-v1`,
    'f'.repeat(64), userId, seededAt]);
  await owner.query(insertSchemaVersion, [schemaActivatedV1, schemaActivated, sourceId, spaceA, properties,
    JSON.stringify({ compatible: true, issues: [] }), '1'.repeat(64), `${proof}:schema-activated-v1`,
    '2'.repeat(64), userId, seededAt]);

  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
      published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,'PG18 connected activation','Runtime proof','customer','current_state','connected','published',
      $3,$4,$4,0,1,$5,$5)`, [definitionId, spaceA, userId, mapVersionId, seededAt]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,
      industry,summary,legacy_audience,provenance_json,author_user_id,published_at,created_at)
    VALUES ($1,$2,$3,1,2,'published','current_state','connected','customer','Activation','','','','{}',$4,$5,$5)`,
  [mapVersionId, definitionId, spaceA, userId, seededAt]);
  await owner.query(`INSERT INTO journey_map_stages(id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES ($1,$2,$3,$4,'Start','','',0),($5,$2,$3,$6,'Value','','',1)`,
  [`${proof}_entry_stage_row`, mapVersionId, spaceA, entryStage, `${proof}_value_stage_row`, valueStage]);

  const insertRuleDefinition = `INSERT INTO journey_stage_rule_definitions
    (id,space_id,journey_definition_id,name,revision,draft_version_id,published_version_id,
      created_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,1,NULL,NULL,$5,$6,$6)`;
  await owner.query(insertRuleDefinition, [entryRule, spaceA, definitionId, 'Entered workspace', userId, seededAt]);
  await owner.query(insertRuleDefinition, [successRule, spaceA, definitionId, 'Reached value', userId, seededAt]);
  const insertRuleVersion = `INSERT INTO journey_stage_rule_versions
    (id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key,version_number,
      state,role,priority,event_name,source_ids_json,environments_json,predicates_json,required_prior_events_json,
      excluded_event_names_json,revision,content_sha256,created_by_user_id,published_by_user_id,created_at,updated_at,published_at)
    VALUES ($1,$2,$3,$4,$5,$6,1,'published',$7,100,$8,$9,$10,$11,'[]','[]',1,$12,$13,$13,$14,$14,$14)`;
  const sourceIds = JSON.stringify([sourceId]);
  const environments = JSON.stringify(['production']);
  const predicates = JSON.stringify([{ path: 'plan_id', operator: 'equals', value: 'team' }]);
  await owner.query(insertRuleVersion, [entryRuleVersion, entryRule, spaceA, definitionId, mapVersionId,
    entryStage, 'entry', 'workspace_created', sourceIds, environments, predicates, '3'.repeat(64), userId, seededAt]);
  await owner.query(insertRuleVersion, [successRuleVersion, successRule, spaceA, definitionId, mapVersionId,
    valueStage, 'success', 'workspace_activated', sourceIds, environments, predicates, '4'.repeat(64), userId, seededAt]);
  await owner.query(`UPDATE journey_stage_rule_definitions SET published_version_id=$1 WHERE id=$2`,
    [entryRuleVersion, entryRule]);
  await owner.query(`UPDATE journey_stage_rule_definitions SET published_version_id=$1 WHERE id=$2`,
    [successRuleVersion, successRule]);

  // Composite FKs reject cross-tenant/cross-map splices independently of app predicates.
  await rejected(owner.query(insertRuleVersion, [`${proof}_splice_v1`, `${proof}_missing_rule`, spaceB,
    definitionId, mapVersionId, entryStage, 'entry', 'workspace_created', sourceIds, environments, predicates,
    '5'.repeat(64), userId, seededAt]), ['23503']);

  const subject = `${proof}_private_subject`;
  const eventSuccess = crypto.randomUUID();
  const eventOldEntry = crypto.randomUUID();
  const eventNewEntry = crypto.randomUUID();
  const eventRecovery = crypto.randomUUID();
  const eventReplay = crypto.randomUUID();
  const nowMs = Date.now();
  await startServer();
  await ingest(eventSuccess, 'workspace_activated', subject, new Date(nowMs - 2 * 86_400_000).toISOString());
  await ingest(eventOldEntry, 'workspace_created', subject, new Date(nowMs - 3 * 86_400_000).toISOString());
  await ingest(eventNewEntry, 'workspace_created', subject, new Date(nowMs + 1_000).toISOString());
  await ingest(eventRecovery, 'workspace_created', `${subject}_recovery`, new Date(nowMs).toISOString());
  await ingest(eventReplay, 'workspace_created', `${subject}_replay`, new Date(nowMs).toISOString());
  await stopServer();

  const recoveryInbox = (await owner.query(`SELECT raw_received_at,raw_event_id FROM journey_event_processing_inbox
    WHERE event_id=$1`, [eventRecovery])).rows[0];
  const leaseUpdated = new Date(nowMs - 120_000).toISOString();
  const leaseExpired = new Date(nowMs - 60_000).toISOString();
  await app.query(`UPDATE journey_event_processing_inbox SET state='leased',lease_owner='crashed-worker',
    lease_token=$1,lease_generation=1,lease_expires_at=$2,attempt_count=1,updated_at=$3
    WHERE event_id=$4 AND state='pending'`, [`${proof}_stale_lease_token`, leaseExpired, leaseUpdated, eventRecovery]);

  const replayInbox = (await owner.query(`SELECT raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
      processor FROM journey_event_processing_inbox WHERE event_id=$1`, [eventReplay])).rows[0];
  await app.query(`UPDATE journey_event_processing_inbox SET state='dead_lettered',available_at=$1,
    attempt_count=5,last_error_code='PROBE_RETRYABLE',updated_at=$1 WHERE event_id=$2 AND state='pending'`,
  [seededAt, eventReplay]);
  const deadLetterId = `${proof}_dead_letter`;
  const rawRetention = (await owner.query(`SELECT retention_expires_at FROM journey_raw_events
    WHERE received_at=$1 AND id=$2`, [replayInbox.raw_received_at, replayInbox.raw_event_id])).rows[0].retention_expires_at;
  await app.query(`INSERT INTO journey_event_dead_letters
    (id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,failure_code,
      redacted_detail_json,attempt_count,replay_eligible,replay_after,updated_at,retention_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','PROBE_RETRYABLE',$9,5,TRUE,NULL,$10,$11)`,
  [deadLetterId, replayInbox.raw_received_at, replayInbox.raw_event_id, spaceA, sourceId, 'production',
    eventReplay, 'connected_journey_v1', JSON.stringify({ category: 'stage_processing', code: 'PROBE_RETRYABLE' }),
    seededAt, rawRetention]);

  process.env.JOURNEY_IDENTITY_HASH_KEY_FILE = identityKeyFile;
  const repository = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist',
    'journeyEventIngestionRepository.js')).href);
  const databaseModule = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'database.js')).href);
  const replayResult = repository.replayJourneyEventDeadLetter({
    spaceId: spaceA, deadLetterId, actorUserId: userId, now: new Date(nowMs + 2_000)
  });
  assert.equal(replayResult.replayed, false);
  databaseModule.db.close();

  await startServer();
  await waitFor(async () => Number((await owner.query(`SELECT COUNT(*) count FROM journey_event_processing_inbox
    WHERE space_id=$1 AND event_id=ANY($2) AND state='completed'`,
  [spaceA, [eventSuccess, eventOldEntry, eventNewEntry, eventRecovery, eventReplay]])).rows[0].count) === 5,
  'all restarted stage jobs');
  await stopServer();

  const instance = (await owner.query(`SELECT id,state,current_stage_key FROM journey_anonymous_instances
    WHERE space_id=$1 AND source_id=$2 AND journey_definition_id=$3
      AND anonymous_id_hash=(SELECT anonymous_id_hash FROM journey_raw_events WHERE event_id=$4)`,
  [spaceA, sourceId, definitionId, eventSuccess])).rows[0];
  assert.deepEqual({ state: instance.state, current_stage_key: instance.current_stage_key },
    { state: 'succeeded', current_stage_key: valueStage });
  const visits = (await owner.query(`SELECT event_id,role,is_late,is_out_of_order,applied_to_current,non_application_reason
    FROM journey_anonymous_stage_visits WHERE instance_id=$1 ORDER BY event_occurred_at,event_id`, [instance.id])).rows;
  assert.deepEqual(visits.map((visit) => [visit.event_id, visit.role, visit.is_late, visit.is_out_of_order,
    visit.applied_to_current, visit.non_application_reason]), [
    [eventOldEntry, 'entry', true, true, false, 'out_of_order'],
    [eventSuccess, 'success', true, false, true, null],
    [eventNewEntry, 'entry', false, false, false, 'terminal_absorbing']
  ]);
  const decisions = await owner.query(`SELECT COUNT(*)::int count FROM journey_stage_rule_decisions
    WHERE space_id=$1 AND journey_definition_id=$2 AND event_id=ANY($3)`,
  [spaceA, definitionId, [eventSuccess, eventOldEntry, eventNewEntry, eventRecovery, eventReplay]]);
  assert.equal(decisions.rows[0].count, 5);
  const aggregate = (await owner.query(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE state='succeeded')::int succeeded,
      COUNT(*) FILTER (WHERE current_stage_key=$3)::int at_value
    FROM journey_anonymous_instances WHERE space_id=$1 AND journey_definition_id=$2`,
  [spaceA, definitionId, valueStage])).rows[0];
  assert.deepEqual(aggregate, { total: 3, succeeded: 1, at_value: 1 });

  const recoveryReceipts = await owner.query(`SELECT status,lease_generation FROM journey_event_processing_receipts
    WHERE event_id=$1 ORDER BY attempted_at,id`, [eventRecovery]);
  assert.deepEqual(recoveryReceipts.rows.map((row) => [row.status, Number(row.lease_generation)]),
    [['lease_expired', 1], ['succeeded', 2]]);
  const staleWrite = await app.query(`UPDATE journey_event_processing_inbox SET state='retry_wait'
    WHERE raw_received_at=$1 AND raw_event_id=$2 AND processor='connected_journey_v1'
      AND lease_token=$3 AND lease_generation=1`,
  [recoveryInbox.raw_received_at, recoveryInbox.raw_event_id, `${proof}_stale_lease_token`]);
  assert.equal(staleWrite.rowCount, 0);
  const deadLetter = (await owner.query(`SELECT state,replay_eligible,resolution_code FROM journey_event_dead_letters
    WHERE id=$1`, [deadLetterId])).rows[0];
  assert.deepEqual(deadLetter, { state: 'resolved', replay_eligible: false, resolution_code: 'EVENT_REPLAY_SUCCEEDED' });
  assert.equal(Number((await owner.query(`SELECT COUNT(*) count FROM journey_event_data_audit
    WHERE target_id=$1 AND action='dead_letter.replay_requested'`, [deadLetterId])).rows[0].count), 1);

  await rejected(app.query(`UPDATE journey_stage_rule_decisions SET trace_json='{}' WHERE event_id=$1`,
    [eventSuccess]), ['42501']);
  await rejected(app.query(`DELETE FROM journey_anonymous_stage_visits WHERE event_id=$1`,
    [eventSuccess]), ['42501']);
  assert.equal(JSON.stringify(visits).includes(subject), false, 'projection reads must not expose the raw anonymous identifier');

  process.stdout.write(`${JSON.stringify({
    event: 'journey_stage_processing_postgres_probe_passed', runtimeSchemaVersion: 18,
    realHttpIngestion: true, realRestartedWorker: true, decisions: 5, visits: 5, instances: 3,
    lateAndOutOfOrder: true, terminalAbsorbing: true, leaseRecoveryAndFencing: true,
    deadLetterReplayResolved: true, tenantForeignKeys: true, appRoleImmutable: true,
    cleanup: 'isolated database dropped by enclosing PostgreSQL E2E runner'
  })}\n`);
} finally {
  await stopServer().catch(() => {});
  await Promise.allSettled([owner.end(), app.end()]);
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
