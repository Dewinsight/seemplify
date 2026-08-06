#!/usr/bin/env node

/**
 * Production-shaped runtime-30 proof for durable stage reprojection.
 *
 * It runs only inside the disposable PostgreSQL E2E database, seeds a bounded
 * connected-journey slice, queues a reprojection run, processes it through the
 * real runtime module, and proves least-privilege immutability for append-only
 * attempt/audit history.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
const proof = `pg30_${crypto.randomBytes(8).toString('hex')}`;
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-stage-reprojection-pg30-'));
const identityKeyFile = path.join(temporaryDir, 'identity-hmac-key');
fs.writeFileSync(identityKeyFile, crypto.randomBytes(48));

function password(file, label) {
  assert.ok(file && fs.existsSync(file), `${label} password file is required.`);
  const value = fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/u, '');
  assert.ok(value, `${label} password file is empty.`);
  return value;
}

function connection(user, passwordValue, applicationName) {
  return {
    host, port, database, user, password: passwordValue, ssl: false,
    application_name: applicationName, connectionTimeoutMillis: 10_000, query_timeout: 30_000
  };
}

async function rejected(promise, codes) {
  await assert.rejects(promise, (error) => codes.includes(String(error?.code)),
    `Expected PostgreSQL error ${codes.join(' or ')}.`);
}

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-30 stage reprojection probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-30 stage reprojection probe refuses to run outside the disposable E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);

const owner = new Client(connection(ownerUser, password(ownerPasswordFile, 'owner'), 'journey-stage-reprojection-pg30-owner'));
const app = new Client(connection(appUser, password(appPasswordFile, 'app'), 'journey-stage-reprojection-pg30-app'));

const seededAt = new Date().toISOString();
const userId = `${proof}_user`;
const spaceId = `${proof}_space`;
const sourceId = `${proof}_source`;
const sourceId2 = `${proof}_source_b`;
const credentialId = `${proof}_credential`;
const definitionId = `${proof}_journey`;
const mapVersionId = `${proof}_map_v1`;
const stageKey = `${proof}_activated`;
const schemaCreated = `${proof}_schema_created`;
const schemaCreatedV1 = `${proof}_schema_created_v1`;
const ruleDefinitionId = `${proof}_entry_rule`;
const ruleVersionId = `${proof}_entry_rule_v1`;
const visitA = `${proof}_visit_a`;
const scaleSubjects = 24;
const scaleBatchSize = 5;

function payloadJson(kind) {
  return JSON.stringify({ properties: { plan_id: 'team', kind } });
}

try {
  await Promise.all([owner.connect(), app.connect()]);
  assert.ok(Number((await owner.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version) >= 30,
    'the runtime-30 journey stage reprojection schema must be present');

  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'PG30 stage reprojection proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'PG30 stage reprojection',$2,$3,NULL,$4,$4)`,
  [spaceId, `${proof}-space`, userId, seededAt]);

  await owner.query(`INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
      events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_by_user_id,revision,created_at,updated_at)
    VALUES
      ($1,$2,'PG30 browser','production','active','enforce','[]','[]',1000,1000000,$3,$4,$5,1,$6,$6),
      ($7,$2,'PG30 browser B','production','active','enforce','[]','[]',1000,1000000,$8,$9,$5,1,$6,$6)`,
  [sourceId, spaceId, `${proof}:source`, 'a'.repeat(64), userId, seededAt,
    sourceId2, `${proof}:source-b`, 'b'.repeat(64)]);
  await owner.query(`INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
      idempotency_key,intent_hash,created_at)
    VALUES ($1,$2,$3,'production','server_secret','events:write',$4,'scrypt-v1',$5,$6,'active',$7,$8,$9)`,
  [credentialId, sourceId, spaceId, 'jsk_live.pg30proof', '9'.repeat(24), 'a'.repeat(64),
    `${proof}:credential`, 'b'.repeat(64), seededAt]);

  await owner.query(`INSERT INTO journey_event_schemas
    (id,source_id,space_id,event_name,idempotency_key,intent_hash,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'workspace_created',$4,$5,$6,$7,$7)`,
  [schemaCreated, sourceId, spaceId, `${proof}:schema-created`, 'c'.repeat(64), userId, seededAt]);
  await owner.query(`INSERT INTO journey_event_schema_versions
    (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,
      compatibility_json,content_sha256,idempotency_key,intent_hash,created_by_user_id,published_by_user_id,created_at,published_at)
    VALUES ($1,$2,$3,$4,'1.0',1,0,'published',$5,$6,$7,$8,$9,$10,$10,$11,$11)`,
  [schemaCreatedV1, schemaCreated, sourceId, spaceId,
    JSON.stringify([{ name: 'plan_id', type: 'string', required: true, dataClass: 'operational', description: 'Bounded plan.', maximumLength: 32, enumValues: ['team', 'enterprise'] },
      { name: 'kind', type: 'string', required: true, dataClass: 'operational', description: 'Bounded kind.', maximumLength: 32 }]),
    JSON.stringify({ compatible: true, issues: [] }), 'd'.repeat(64), `${proof}:schema-created-v1`,
    'e'.repeat(64), userId, seededAt]);

  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,published_version_id,
      review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,'PG30 connected activation','Runtime proof','customer','current_state','connected','published',
      $3,$4,$4,0,1,$5,$5)`, [definitionId, spaceId, userId, mapVersionId, seededAt]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,
      industry,summary,legacy_audience,provenance_json,author_user_id,published_at,created_at)
    VALUES ($1,$2,$3,1,2,'published','current_state','connected','customer','Activation','','','','{}',$4,$5,$5)`,
  [mapVersionId, definitionId, spaceId, userId, seededAt]);
  await owner.query(`INSERT INTO journey_map_stages(id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES ($1,$2,$3,$4,'Activated','','',0)`,
  [`${proof}_stage_row`, mapVersionId, spaceId, stageKey]);
  await owner.query(`INSERT INTO journey_stage_rule_definitions
    (id,space_id,journey_definition_id,name,revision,draft_version_id,published_version_id,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Activated event',1,NULL,NULL,$4,$5,$5)`,
  [ruleDefinitionId, spaceId, definitionId, userId, seededAt]);
  await owner.query(`INSERT INTO journey_stage_rule_versions
    (id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key,version_number,
      state,role,priority,event_name,source_ids_json,environments_json,predicates_json,required_prior_events_json,
      excluded_event_names_json,revision,content_sha256,created_by_user_id,published_by_user_id,created_at,updated_at,published_at)
    VALUES ($1,$2,$3,$4,$5,$6,1,'published','entry',100,'workspace_created',$7,$8,$9,'[]','[]',1,$10,$11,$11,$12,$12,$12)`,
  [ruleVersionId, ruleDefinitionId, spaceId, definitionId, mapVersionId, stageKey,
    JSON.stringify([sourceId]), JSON.stringify(['production']),
    JSON.stringify([{ path: 'plan_id', operator: 'equals', value: 'team' }]), 'f'.repeat(64), userId, seededAt]);
  await owner.query(`UPDATE journey_stage_rule_definitions SET published_version_id=$1 WHERE id=$2`,
    [ruleVersionId, ruleDefinitionId]);

  const receivedA = new Date(Date.now() - 60_000).toISOString();
  const occurredA = new Date(Date.now() - 120_000).toISOString();
  const rawA = `${proof}_raw_a`;
  const eventA = `${proof}_event_a`;
  const payloadA = payloadJson('first');
  await owner.query(`INSERT INTO journey_raw_events
    (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,
      event_name,event_version,occurred_at,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,
      channel,consent_state,ingest_state,payload_json,context_json,consent_json,validation_issues_json,
      envelope_sha256,payload_bytes,sdk_name,sdk_version,retention_expires_at)
    VALUES ($1,$2,$3,$4,'production',$5,$6,'1.0','track','workspace_created',1,$7,$8,$9,NULL,NULL,
      'web','granted','accepted',$10,'{}','{}','[]',$11,$12,'@seemplify/journey-browser-sdk','0.1.0',$13)`,
  [receivedA, rawA, spaceId, sourceId, credentialId, eventA, occurredA, schemaCreatedV1,
    '1'.repeat(64), payloadA, '2'.repeat(64), Buffer.byteLength(payloadA, 'utf8'),
    new Date(Date.now() + 86_400_000).toISOString()]);
  await owner.query(`INSERT INTO journey_stage_rule_decisions
    (id,decision_key,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,journey_definition_id,
      journey_map_version_id,subject_kind,anonymous_id_hash,outcome,matched_rule_definition_id,matched_rule_version_id,
      matched_rule_version_number,stage_key,role,event_occurred_at,evaluated_at,is_late,is_out_of_order,
      rule_set_sha256,trace_json,provenance_json,processor,processor_version,lease_generation,created_at,retention_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,'production',$7,$8,$9,'anonymous',$10,'matched',$11,$12,1,$13,'entry',$14,$15,false,false,
      $16,'{\"eventMessageId\":\"seed\",\"matches\":[],\"traces\":[]}'::jsonb,'{\"seeded\":true}'::jsonb,'connected_journey_v1','stage-rules-v1',1,$15,$17)`,
  [`${proof}_decision_a`, '4'.repeat(64), receivedA, rawA, spaceId, sourceId, eventA, definitionId, mapVersionId,
    '1'.repeat(64), ruleDefinitionId, ruleVersionId, stageKey, occurredA, seededAt, '5'.repeat(64),
    new Date(Date.now() + 86_400_000).toISOString()]);
  await owner.query(`INSERT INTO journey_anonymous_instances
    (id,space_id,source_id,environment,journey_definition_id,subject_kind,anonymous_id_hash,state,current_stage_key,
      first_event_at,latest_event_at,latest_event_id,latest_visit_id,revision,created_at,updated_at)
    VALUES ($1,$2,$3,'production',$4,'anonymous',$5,'active',NULL,$6,$6,$7,NULL,1,$8,$8)`,
  [`${proof}_instance_a`, spaceId, sourceId, definitionId, '1'.repeat(64), occurredA, eventA, seededAt]);
  await owner.query(`INSERT INTO journey_anonymous_stage_visits
    (id,assignment_key,instance_id,decision_id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
      journey_definition_id,journey_map_version_id,subject_kind,stage_key,role,rule_definition_id,rule_version_id,
      rule_version_number,event_occurred_at,visited_at,is_late,is_out_of_order,applied_to_current,non_application_reason,
      prior_stage_key,provenance_json,created_at,retention_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'production',$9,$10,$11,'anonymous',$12,'entry',$13,$14,1,$15,$16,
      false,false,true,NULL,NULL,'{\"seeded\":true}'::jsonb,$16,$17)`,
  [visitA, '6'.repeat(64), `${proof}_instance_a`, `${proof}_decision_a`, receivedA, rawA, spaceId, sourceId,
    eventA, definitionId, mapVersionId, stageKey, ruleDefinitionId, ruleVersionId, occurredA, seededAt,
    new Date(Date.now() + 86_400_000).toISOString()]);
  await owner.query(`UPDATE journey_anonymous_instances
    SET current_stage_key=$1,latest_visit_id=$2,updated_at=$3
    WHERE id=$4 AND space_id=$5`,
  [stageKey, visitA, seededAt, `${proof}_instance_a`, spaceId]);

  const firstScaleRawId = `${proof}_raw_b_001`;
  const retainedAt = new Date(Date.now() + 86_400_000).toISOString();
  for (let index = 0; index < scaleSubjects; index += 1) {
    const ordinal = String(index + 1).padStart(3, '0');
    const receivedAt = new Date(Date.now() + index * 1_000).toISOString();
    const occurredAt = new Date(Date.now() + (index + 1) * 1_000).toISOString();
    const rawId = `${proof}_raw_b_${ordinal}`;
    const eventId = `${proof}_event_b_${ordinal}`;
    const payload = payloadJson(`scale_${ordinal}`);
    await owner.query(`INSERT INTO journey_raw_events
      (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,
        event_name,event_version,occurred_at,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,
        channel,consent_state,ingest_state,payload_json,context_json,consent_json,validation_issues_json,
        envelope_sha256,payload_bytes,sdk_name,sdk_version,retention_expires_at)
      VALUES ($1,$2,$3,$4,'production',$5,$6,'1.0','track','workspace_created',1,$7,$8,$9,NULL,NULL,
        'web','granted','accepted',$10,'{}','{}','[]',$11,$12,'@seemplify/journey-browser-sdk','0.1.0',$13)`,
    [receivedAt, rawId, spaceId, sourceId, credentialId, eventId, occurredAt, schemaCreatedV1,
      crypto.createHash('sha256').update(`anon-${proof}-${ordinal}`).digest('hex'),
      payload, crypto.createHash('sha256').update(`envelope-${proof}-${ordinal}`).digest('hex'),
      Buffer.byteLength(payload, 'utf8'), retainedAt]);
  }

  process.env.JOURNEY_IDENTITY_HASH_KEY_FILE = identityKeyFile;
  const reprojection = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyStageReprojection.js')).href);
  const databaseModule = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'database.js')).href);

  const queued = reprojection.queueJourneyStageReprojection({
    spaceId,
    actorUserId: userId,
    journeyDefinitionId: definitionId,
    journeyMapVersionId: mapVersionId,
    reason: 'manual',
    sourceId,
    environment: 'production',
    idempotencyKey: `${proof}:reprojection`
  });
  assert.equal(queued.replayed, false);
  const replayed = reprojection.queueJourneyStageReprojection({
    spaceId,
    actorUserId: userId,
    journeyDefinitionId: definitionId,
    journeyMapVersionId: mapVersionId,
    reason: 'manual',
    sourceId,
    environment: 'production',
    idempotencyKey: `${proof}:reprojection`
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.run.id, queued.run.id);

  const claim = reprojection.claimJourneyStageReprojection({ owner: `${proof}-worker`, now: new Date() });
  assert.ok(claim);
  const started = Date.now();
  const firstBatch = reprojection.processJourneyStageReprojection(claim, { now: new Date(), batchSize: scaleBatchSize });
  assert.equal(firstBatch.state, 'leased');
  assert.equal(firstBatch.checkpoint.processedCount, scaleBatchSize);
  assert.equal(firstBatch.summary.projected.matched, scaleBatchSize);

  const secondBatch = reprojection.processJourneyStageReprojection(claim, { now: new Date(), batchSize: scaleBatchSize });
  assert.equal(secondBatch.state, 'leased');
  assert.equal(secondBatch.checkpoint.processedCount, scaleBatchSize * 2);
  assert.equal(secondBatch.summary.projected.matched, scaleBatchSize * 2);

  let processed = secondBatch;
  let batches = 2;
  while (processed.state === 'leased') {
    processed = reprojection.processJourneyStageReprojection(claim, { now: new Date(), batchSize: scaleBatchSize });
    batches += 1;
  }
  const elapsedMs = Date.now() - started;
  assert.equal(processed.state, 'completed');
  assert.equal(processed.checkpoint.processedCount, scaleSubjects + 1);
  assert.equal(processed.summary.sourceScope.sourceId, sourceId);
  assert.equal(processed.summary.projected.matched, scaleSubjects + 1);
  assert.equal(processed.summary.projected.changedCurrentStage, scaleSubjects);
  assert.equal(processed.summary.before.decisions, 1);

  const checkpoint = (await owner.query(`SELECT processed_count,matched_count,no_match_count,last_raw_event_id
    FROM journey_stage_reprojection_checkpoints WHERE run_id=$1 AND space_id=$2`, [queued.run.id, spaceId])).rows[0];
  assert.deepEqual({
    processed: Number(checkpoint.processed_count),
    matched: Number(checkpoint.matched_count),
    noMatch: Number(checkpoint.no_match_count),
    lastRawEventId: checkpoint.last_raw_event_id
  }, { processed: scaleSubjects + 1, matched: scaleSubjects + 1, noMatch: 0, lastRawEventId: `${proof}_raw_b_024` });

  const attempt = (await owner.query(`SELECT status,attempt_number FROM journey_stage_reprojection_attempts
    WHERE run_id=$1 AND space_id=$2`, [queued.run.id, spaceId])).rows;
  assert.deepEqual(attempt.map((row) => [row.status, Number(row.attempt_number)]), [['succeeded', 1]]);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_stage_reprojection_audit_events
    WHERE space_id=$1 AND target_id=$2`, [spaceId, queued.run.id])).rows[0].count), 2);

  await rejected(app.query(`UPDATE journey_stage_reprojection_attempts SET error_code='mutated'
    WHERE run_id=$1`, [queued.run.id]), ['42501']);
  await rejected(app.query(`DELETE FROM journey_stage_reprojection_runs WHERE id=$1`,
    [queued.run.id]), ['42501']);

  databaseModule.db.close();

  process.stdout.write(`${JSON.stringify({
    event: 'journey_stage_reprojection_postgres_probe_passed',
    runtimeSchemaVersion: 30,
    queued: true,
    idempotentReplay: true,
    completed: true,
    batches,
    batchSize: scaleBatchSize,
    elapsedMs,
    processedCount: scaleSubjects + 1,
    matchedCount: scaleSubjects + 1,
    changedCurrentStageCount: scaleSubjects,
    unchangedCurrentStageCount: 1,
    firstReprocessedRawEventId: rawA,
    firstNewRawEventId: firstScaleRawId,
    appendOnlyAttempts: true,
    noDeleteRuntimeRows: true,
    cleanup: 'isolated database dropped by enclosing PostgreSQL E2E runner'
  })}\n`);
} finally {
  await Promise.allSettled([owner.end(), app.end()]);
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
