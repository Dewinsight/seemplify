#!/usr/bin/env node

/**
 * Runtime-21 two-connection proof for definition-scoped external revisions.
 * It runs only in the disposable PostgreSQL E2E database. The probe exercises
 * the same per-space admission mutex used by the repository, proves a second
 * writer observes the committed revision, checks the database uniqueness
 * backstop, and proves the same source record may feed another definition.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const proof = `pg21_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-21 metric probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-21 metric probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile), 'Owner password file is required.');
const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (name) => ({ host, port, database, user: ownerUser, password: ownerPassword, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const control = new Client(connection('journey-metric-runtime21-control'));
const left = new Client(connection('journey-metric-runtime21-left'));
const right = new Client(connection('journey-metric-runtime21-right'));

const userId = `${proof}_user`;
const spaceId = `${proof}_space`;
const journeyId = `${proof}_journey`;
const sourceId = `${proof}_source`;
const schemaId = `${proof}_schema`;
const schemaVersionId = `${proof}_schema_v1`;
const definitionA = `${proof}_metric_a`;
const definitionB = `${proof}_metric_b`;
const versionA = `${proof}_version_a`;
const versionB = `${proof}_version_b`;
const externalHash = crypto.createHash('sha256').update(`${proof}:external-record`).digest('hex');
const digest = crypto.createHash('sha256').update(`${proof}:content`).digest('hex');
const seededAt = '2026-08-04T12:00:00.000Z';
const lineage = JSON.stringify({ sourceRef: `journey-event:${sourceId}:production`, sourceVersion: '1',
  schemaVersion: '1.0', projectionVersion: '1', journeyId: null, journeyVersion: null, ruleSetVersion: null });
const immutableTriggers = [
  ['journey_metric_definition_versions','journey_metric_definition_versions_append_only'],
  ['journey_metric_imports','journey_metric_imports_append_only'],
  ['journey_metric_rebuild_attempts','journey_metric_rebuild_attempts_append_only'],
  ['journey_metric_observations','journey_metric_observations_append_only'],
  ['journey_metric_observation_sources','journey_metric_observation_sources_append_only'],
  ['journey_metric_audit_events','journey_metric_audit_append_only']
];

function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function importValues(id, definitionId, definitionVersionId) {
  return [id, spaceId, definitionId, definitionVersionId, sourceId, 'production', schemaVersionId, externalHash,
    1, 'upsert', digest, 'custom', 'checkout.failed', seededAt, lineage, digest, `${id}:idempotency`, digest, seededAt];
}
const insertImport = `INSERT INTO journey_metric_imports
  (id,space_id,definition_id,definition_version_id,source_id,environment,schema_version_id,external_record_sha256,
   revision,operation,subject_id_hmac,subject_type,event_type,occurred_at,source_lineage_json,schema_content_sha256,
   idempotency_key,intent_sha256,created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`;

let connected = false;
try {
  await Promise.all([control.connect(), left.connect(), right.connect()]);
  connected = true;
  const repositorySource = fs.readFileSync(path.join(projectDir, 'backend', 'src', 'journeyMetrics.ts'), 'utf8');
  assert.match(repositorySource, /SELECT id FROM spaces WHERE id=\? FOR UPDATE/u,
    'Repository must acquire the PostgreSQL admission mutex.');
  assert.match(repositorySource,
    /WHERE space_id=\? AND definition_id=\? AND source_id=\? AND external_record_sha256=\?/u,
    'Repository revision lookup must remain definition-scoped.');

  await control.query('BEGIN');
  await control.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'Runtime 21 metric proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  await control.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'Runtime 21 metric proof',$2,$3,NULL,$4,$4)`, [spaceId, `${proof}-space`, userId, seededAt]);
  await control.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,created_at,updated_at)
    VALUES ($1,$2,'Runtime 21 metric proof','Concurrency proof','customer','current_state','connected','draft',$3,$4,$4)`,
  [journeyId, spaceId, userId, seededAt]);
  await control.query(`INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,events_per_minute,bytes_per_minute,intent_hash,
     created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'Runtime 21 metric source','production','active','enforce',1000,1000000,$3,$4,$5,$5)`,
  [sourceId, spaceId, digest, userId, seededAt]);
  await control.query(`INSERT INTO journey_event_schemas
    (id,source_id,space_id,event_name,intent_hash,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'journey_metric_import',$4,$5,$6,$6)`, [schemaId, sourceId, spaceId, digest, userId, seededAt]);
  await control.query(`INSERT INTO journey_event_schema_versions
    (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,compatibility_json,
     content_sha256,intent_hash,created_by_user_id,published_by_user_id,created_at,published_at)
    VALUES ($1,$2,$3,$4,'1.0',1,0,'published','[]','{}',$5,$5,$6,$6,$7,$7)`,
  [schemaVersionId, schemaId, sourceId, spaceId, digest, userId, seededAt]);
  for (const [definitionId, versionId, name] of [[definitionA, versionA, 'Metric A'], [definitionB, versionB, 'Metric B']]) {
    await control.query(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,name,current_version_id,intent_sha256,
       created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,'journey',$3,$4,NULL,$5,$6,$7,$7)`,
    [definitionId, spaceId, journeyId, name, digest, userId, seededAt]);
    await control.query(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,calculator_kind,aggregation,direction,window_seconds,
       timezone,minimum_sample_size,freshness_max_age_seconds,formula_json,configuration_json,content_sha256,
       intent_sha256,created_by_user_id,created_at)
      VALUES ($1,$2,$3,1,'operational_import','operational','count','neutral',86400,'UTC',1,86400,
        '{"kind":"custom_count"}','{"kind":"custom_count"}',$4,$4,$5,$6)`,
    [versionId, definitionId, spaceId, digest, userId, seededAt]);
    await control.query('UPDATE journey_metric_definitions SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
      [versionId, definitionId, spaceId]);
  }
  await control.query('COMMIT');

  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceId]);
  let rightAcquired = false;
  const rightLock = right.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceId])
    .then((result) => { rightAcquired = true; return result; });
  await delay(100);
  assert.equal(rightAcquired, false, 'The second PostgreSQL connection must wait for the admission mutex.');

  const leftPrior = await left.query(`SELECT revision FROM journey_metric_imports
    WHERE space_id=$1 AND definition_id=$2 AND source_id=$3 AND external_record_sha256=$4
    ORDER BY revision DESC,id LIMIT 1`, [spaceId, definitionA, sourceId, externalHash]);
  assert.equal(leftPrior.rowCount, 0);
  await left.query(insertImport, importValues(`${proof}_import_a1`, definitionA, versionA));
  await left.query('COMMIT');

  await rightLock;
  const rightPrior = await right.query(`SELECT revision FROM journey_metric_imports
    WHERE space_id=$1 AND definition_id=$2 AND source_id=$3 AND external_record_sha256=$4
    ORDER BY revision DESC,id LIMIT 1`, [spaceId, definitionA, sourceId, externalHash]);
  assert.equal(Number(rightPrior.rows[0]?.revision), 1,
    'The second connection must re-read the revision after acquiring the mutex.');
  const incomingRevision = 1;
  assert.equal(incomingRevision === Number(rightPrior.rows[0].revision) + 1, false);
  await right.query('ROLLBACK');
  emit('journey_metric_two_connection_revision_conflict_passed');

  await assert.rejects(control.query(insertImport,
    importValues(`${proof}_import_a_duplicate`, definitionA, versionA)),
  (error) => error?.code === '23505' && error?.constraint === 'journey_metric_imports_source_revision');
  await control.query(insertImport, importValues(`${proof}_import_b1`, definitionB, versionB));
  const rows = await control.query(`SELECT definition_id,revision FROM journey_metric_imports
    WHERE space_id=$1 AND source_id=$2 AND external_record_sha256=$3 ORDER BY definition_id`,
  [spaceId, sourceId, externalHash]);
  assert.deepEqual(rows.rows.map((row) => [row.definition_id, Number(row.revision)]),
    [[definitionA, 1], [definitionB, 1]]);
  emit('journey_metric_definition_scoped_revision_stream_passed');
} finally {
  if (connected) {
    await right.query('ROLLBACK').catch(() => {});
    await left.query('ROLLBACK').catch(() => {});
    for (const [table, trigger] of immutableTriggers) {
      await control.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`).catch(() => {});
    }
    await control.query('DELETE FROM spaces WHERE id=$1', [spaceId]).catch(() => {});
    await control.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    for (const [table, trigger] of immutableTriggers.reverse()) {
      await control.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`).catch(() => {});
    }
  }
  await Promise.all([control.end().catch(() => {}), left.end().catch(() => {}), right.end().catch(() => {})]);
}

emit('journey_metric_runtime_21_postgres_probe_passed', { database });
