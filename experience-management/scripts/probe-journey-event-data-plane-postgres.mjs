#!/usr/bin/env node

/**
 * Destructive only to an explicitly isolated PostgreSQL E2E database. The
 * proof exercises storage primitives, not HTTP route behaviour, and removes
 * every namespaced row before reporting success.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { assertRuntimePrivileges, assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg17_${crypto.randomBytes(8).toString('hex')}`;
const receivedAt = '2026-08-01T12:00:00.000Z';
const retainedUntil = '2026-08-02T12:00:00.000Z';
const now = '2026-08-04T22:00:00.000Z';
const deadLetterRetainedUntil = '2026-08-18T22:00:00.000Z';

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
  'The runtime-17 probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^(?:experience_e2e|experience_data_plane_test)_[a-f0-9]+$/u,
  'The runtime-17 probe refuses to run outside an isolated test database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);

const owner = new Client(connection(ownerUser, password(ownerPasswordFile, 'owner'), 'journey-data-plane-pg17-owner'));
const ownerPeer = new Client(connection(ownerUser, password(ownerPasswordFile, 'owner'), 'journey-data-plane-pg17-peer'));
const app = new Client(connection(appUser, password(appPasswordFile, 'app'), 'journey-data-plane-pg17-app'));
const appPeer = new Client(connection(appUser, password(appPasswordFile, 'app'), 'journey-data-plane-pg17-app-peer'));

const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const sourceA = `${proof}_source_a`;
const sourceB = `${proof}_source_b`;
const credentialA = `${proof}_credential_a`;
const credentialB = `${proof}_credential_b`;
const schemaA = `${proof}_schema_a`;
const schemaVersionA = `${proof}_schema_version_a`;
const rawA = `${proof}_raw_a`;
const receiptA = `${proof}_receipt_a`;
const eventA = `${proof}_event_a`;
const processor = 'connected_journey_v1';
const processingReceiptA = `${proof}_processing_receipt_a`;
const deadLetterA = `${proof}_dead_letter_a`;

try {
  await Promise.all([owner.connect(), ownerPeer.connect(), app.connect(), appPeer.connect()]);
  const schemaContract = await assertRuntimeSchemaContract((sql) => owner.query(sql), {
    schema: 'public', runtimeVersion: 18
  });
  const privilegeContract = await assertRuntimePrivileges((sql) => owner.query(sql), appUser, {
    schema: 'public', runtimeVersion: 18
  });
  assert.equal(schemaContract.runtimeVersion, 18);
  assert.equal(privilegeContract.protectedTables, 36);

  const runtimeRows = await owner.query(`SELECT version,name,checksum FROM experience_runtime_schema_version
    WHERE version=17`);
  assert.equal(runtimeRows.rowCount, 1);
  assert.equal(runtimeRows.rows[0].name, '0017_journey_event_data_plane.sql');
  const migrationSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres',
    '0017_journey_event_data_plane.sql'), 'utf8').replace(/\r\n?/gu, '\n');
  assert.equal(runtimeRows.rows[0].checksum, crypto.createHash('sha256').update(migrationSql).digest('hex'));

  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'PG17 proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, now]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'PG17 A',$2,$3,NULL,$4,$4),($5,'PG17 B',$6,$3,NULL,$4,$4)`,
  [spaceA, `${proof}-a`, userId, now, spaceB, `${proof}-b`]);

  const insertSource = `INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
      events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'active','enforce','[]','[]',1000,1000000,$5,$6,$7,$7)`;
  await owner.query(insertSource, [sourceA, spaceA, 'PG17 production A', 'production',
    `${proof}:source-a`, 'a'.repeat(64), now]);
  await owner.query(insertSource, [sourceB, spaceB, 'PG17 development B', 'development',
    `${proof}:source-b`, 'b'.repeat(64), now]);

  const insertCredential = `INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
      idempotency_key,intent_hash,created_at)
    VALUES ($1,$2,$3,$4,'server_secret','events:write',$5,'scrypt-v1',$6,$7,'active',$8,$9,$10)`;
  await owner.query(insertCredential, [credentialA, sourceA, spaceA, 'production', 'jsk_live.pg17a',
    's'.repeat(24), 'c'.repeat(64), `${proof}:credential-a`, 'd'.repeat(64), now]);
  await owner.query(insertCredential, [credentialB, sourceB, spaceB, 'development', 'jsk_dev.pg17b',
    't'.repeat(24), 'e'.repeat(64), `${proof}:credential-b`, 'f'.repeat(64), now]);
  await owner.query(`INSERT INTO journey_event_schemas
    (id,source_id,space_id,event_name,idempotency_key,intent_hash,created_at,updated_at)
    VALUES ($1,$2,$3,'survey_published',$4,$5,$6,$6)`,
  [schemaA, sourceA, spaceA, `${proof}:schema-a`, '1'.repeat(64), now]);
  await owner.query(`INSERT INTO journey_event_schema_versions
    (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,
      compatibility_json,content_sha256,idempotency_key,intent_hash,created_at,published_at)
    VALUES ($1,$2,$3,$4,'1.0',1,0,'published','[]','{}',$5,$6,$7,$8,$8)`,
  [schemaVersionA, schemaA, sourceA, spaceA, '2'.repeat(64), `${proof}:schema-version-a`, '3'.repeat(64), now]);

  const rawValues = [receivedAt, rawA, spaceA, sourceA, 'production', credentialA, eventA, '1.0',
    'track', 'survey_published', 1, receivedAt, schemaVersionA, 'web', 'granted', 'accepted',
    JSON.stringify({ surveyId: 'redacted-proof' }), '{}', '{"analytics":"granted"}', '[]',
    '4'.repeat(64), 64, '@seemplify/journey-browser-sdk', '0.1.0', retainedUntil];
  const insertRaw = `INSERT INTO journey_raw_events
    (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,
      event_name,event_version,occurred_at,schema_version_id,channel,consent_state,ingest_state,payload_json,
      context_json,consent_json,validation_issues_json,envelope_sha256,payload_bytes,sdk_name,sdk_version,
      retention_expires_at)
    VALUES (${Array.from({ length: 25 }, (_, index) => `$${index + 1}`).join(',')})`;
  const insertReceipt = `INSERT INTO journey_event_ingest_receipts
    (received_at,id,space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      outcome,http_status,error_code,request_id,batch_id,attempt_ordinal,retention_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',202,NULL,$10,NULL,1,$11)`;

  // This is the durable primitive behind a future HTTP 202: reserve the global
  // event ID first, then append raw fact, receipt, and inbox in one commit. The
  // two partition FKs are deferred so the global reservation remains the race
  // winner without weakening referential integrity.
  await app.query('BEGIN');
  await app.query(`INSERT INTO journey_event_deduplication
    (space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      ingest_receipt_id,first_outcome,first_http_status,first_result_code,first_result_json,created_at,
      retention_expires_at)
    VALUES ($1,$2,'production',$3,$4,$5,$6,$7,'accepted',202,NULL,$8,$6,$9)`,
  [spaceA, sourceA, eventA, '4'.repeat(64), rawA, receivedAt, receiptA,
    JSON.stringify({ receiptId: receiptA, receivedAt }), retainedUntil]);
  await app.query(insertRaw, rawValues);
  await app.query(insertReceipt, [receivedAt, receiptA, spaceA, sourceA, 'production', eventA,
    '4'.repeat(64), rawA, receivedAt, `${proof}_request_a`, retainedUntil]);
  await app.query(`INSERT INTO journey_event_processing_inbox
    (raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,available_at,
      lease_generation,attempt_count,updated_at)
    VALUES ($1,$2,$3,$4,'production',$5,$6,'pending',$1,0,0,$1)`,
  [receivedAt, rawA, spaceA, sourceA, eventA, processor]);
  await app.query('COMMIT');

  const durablePrimitive = await owner.query(`SELECT
    (SELECT COUNT(*) FROM journey_event_deduplication WHERE space_id=$1 AND source_id=$2 AND event_id=$3)::int dedupe,
    (SELECT COUNT(*) FROM journey_raw_events WHERE id=$4)::int raw,
    (SELECT COUNT(*) FROM journey_event_ingest_receipts WHERE id=$5)::int receipt,
    (SELECT COUNT(*) FROM journey_event_processing_inbox WHERE raw_event_id=$4)::int inbox`,
  [spaceA, sourceA, eventA, rawA, receiptA]);
  assert.deepEqual(durablePrimitive.rows[0], { dedupe: 1, raw: 1, receipt: 1, inbox: 1 });

  const routed = await owner.query(`SELECT tableoid::regclass::text partition_name
    FROM journey_raw_events WHERE received_at=$1 AND id=$2`, [receivedAt, rawA]);
  assert.equal(routed.rows[0].partition_name, 'journey_raw_events_2026_08');
  const routedReceipt = await owner.query(`SELECT tableoid::regclass::text partition_name
    FROM journey_event_ingest_receipts WHERE received_at=$1 AND id=$2`, [receivedAt, receiptA]);
  assert.equal(routedReceipt.rows[0].partition_name, 'journey_event_ingest_receipts_2026_08');

  const duplicate = await app.query(`INSERT INTO journey_event_deduplication
    (space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      ingest_receipt_id,first_outcome,first_http_status,first_result_json,created_at,retention_expires_at)
    VALUES ($1,$2,'production',$3,$4,$5,$6,$7,'accepted',202,'{}',$6,$8)
    ON CONFLICT(space_id,source_id,event_id) DO NOTHING RETURNING event_id`,
  [spaceA, sourceA, eventA, '4'.repeat(64), rawA, receivedAt, receiptA, retainedUntil]);
  assert.equal(duplicate.rowCount, 0);
  const prior = (await app.query(`SELECT envelope_sha256,first_outcome,first_http_status,first_result_json,
    raw_received_at FROM journey_event_deduplication WHERE space_id=$1 AND source_id=$2 AND event_id=$3`,
  [spaceA, sourceA, eventA])).rows[0];
  assert.equal(prior.envelope_sha256, '4'.repeat(64));
  assert.equal(prior.first_outcome, 'accepted');
  assert.equal(Number(prior.first_http_status), 202);
  assert.equal(prior.first_result_json.receiptId, receiptA);

  const conflict = await app.query(`INSERT INTO journey_event_deduplication
    (space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      ingest_receipt_id,first_outcome,first_http_status,first_result_json,created_at,retention_expires_at)
    VALUES ($1,$2,'production',$3,$4,$5,$6,$7,'accepted',202,'{}',$6,$8)
    ON CONFLICT(space_id,source_id,event_id) DO NOTHING RETURNING event_id`,
  [spaceA, sourceA, eventA, '5'.repeat(64), rawA, receivedAt, receiptA, retainedUntil]);
  assert.equal(conflict.rowCount, 0);
  assert.notEqual(prior.envelope_sha256, '5'.repeat(64));
  assert.equal(Number((await owner.query(`SELECT COUNT(*) count FROM journey_raw_events
    WHERE space_id=$1 AND source_id=$2 AND event_id=$3`, [spaceA, sourceA, eventA])).rows[0].count), 1);

  await rejected(app.query(`UPDATE journey_raw_events SET payload_json='{}' WHERE id=$1`, [rawA]), ['42501']);
  await rejected(app.query(`DELETE FROM journey_event_ingest_receipts WHERE id=$1`, [receiptA]), ['42501']);
  await rejected(owner.query(`UPDATE journey_event_deduplication SET first_http_status=202
    WHERE space_id=$1 AND source_id=$2 AND event_id=$3`, [spaceA, sourceA, eventA]), ['55000']);

  // Cross-tenant, cross-environment, cross-credential, and cross-schema lineage
  // all fail at composite foreign-key boundaries, independent of application
  // predicates.
  const crossTenant = [...rawValues];
  crossTenant[1] = `${rawA}_cross_tenant`;
  crossTenant[2] = spaceB;
  await rejected(owner.query(insertRaw, crossTenant), ['23503']);
  const crossEnvironment = [...rawValues];
  crossEnvironment[1] = `${rawA}_cross_environment`;
  crossEnvironment[4] = 'development';
  await rejected(owner.query(insertRaw, crossEnvironment), ['23503']);
  const crossCredential = [...rawValues];
  crossCredential[1] = `${rawA}_cross_credential`;
  crossCredential[5] = credentialB;
  await rejected(owner.query(insertRaw, crossCredential), ['23503']);
  const crossSchema = [...rawValues];
  crossSchema[1] = `${rawA}_cross_schema`;
  crossSchema[12] = `${proof}_wrong_schema_version`;
  await rejected(owner.query(insertRaw, crossSchema), ['23503']);

  // Protocol-invalid input after credential resolution is represented without
  // inventing an event ID or retaining hostile content.
  const invalidReceipt = `${proof}_invalid_receipt`;
  const rejection = `${proof}_rejection`;
  await app.query(`INSERT INTO journey_event_ingest_receipts
    (received_at,id,space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      outcome,http_status,error_code,request_id,attempt_ordinal,retention_expires_at)
    VALUES ($1,$2,$3,$4,'production',NULL,$5,NULL,NULL,'rejected',422,'EVENT_ID_INVALID',$6,1,$7)`,
  [receivedAt, invalidReceipt, spaceA, sourceA, '6'.repeat(64), `${proof}_invalid_request`, retainedUntil]);
  await app.query(`INSERT INTO journey_event_rejections
    (id,space_id,source_id,environment,event_id,ingest_receipt_id,ingest_received_at,code,field_path,
      redacted_detail_json,payload_sha256,payload_bytes,replay_eligible,created_at,retention_expires_at)
    VALUES ($1,$2,$3,'production',NULL,$4,$5,'EVENT_ID_INVALID','eventId',$6,$7,128,FALSE,$5,$8)`,
  [rejection, spaceA, sourceA, invalidReceipt, receivedAt, JSON.stringify({ reason: 'redacted' }),
    '6'.repeat(64), retainedUntil]);
  const invalidRows = await owner.query(`SELECT receipt.event_id,rejection_record.event_id,
      rejection_record.redacted_detail_json FROM journey_event_ingest_receipts receipt
    JOIN journey_event_rejections rejection_record ON rejection_record.ingest_receipt_id=receipt.id
    WHERE receipt.id=$1`, [invalidReceipt]);
  assert.equal(invalidRows.rows[0].event_id, null);
  assert.deepEqual(invalidRows.rows[0].redacted_detail_json, { reason: 'redacted' });

  // Lease expiry is recoverable and lease_generation fences a stale worker.
  const leaseToken1 = `${proof}_lease_token_0001`;
  const leaseToken2 = `${proof}_lease_token_0002`;
  await app.query(`UPDATE journey_event_processing_inbox SET state='leased',lease_owner='worker-a',
    lease_token=$1,lease_generation=lease_generation+1,lease_expires_at=$2,attempt_count=attempt_count+1,
    updated_at=$3 WHERE raw_received_at=$4 AND raw_event_id=$5 AND processor=$6`,
  [leaseToken1, '2026-08-01T12:01:00.000Z', receivedAt, receivedAt, rawA, processor]);
  await app.query(`UPDATE journey_event_processing_inbox SET state='pending',lease_owner=NULL,lease_token=NULL,
    lease_generation=lease_generation+1,lease_expires_at=NULL,available_at=$1,last_error_code='LEASE_EXPIRED',
    updated_at=$1 WHERE raw_received_at=$2 AND raw_event_id=$3 AND processor=$4
      AND state='leased' AND lease_expires_at<$5`,
  ['2026-08-01T12:02:00.000Z', receivedAt, rawA, processor, now]);
  const stale = await app.query(`UPDATE journey_event_processing_inbox SET state='completed',lease_owner=NULL,
    lease_token=NULL,lease_expires_at=NULL,updated_at=$1 WHERE raw_received_at=$2 AND raw_event_id=$3
      AND processor=$4 AND lease_token=$5 AND lease_generation=1`,
  [now, receivedAt, rawA, processor, leaseToken1]);
  assert.equal(stale.rowCount, 0);
  await app.query(`UPDATE journey_event_processing_inbox SET state='leased',lease_owner='worker-b',
    lease_token=$1,lease_generation=lease_generation+1,lease_expires_at=$2,attempt_count=attempt_count+1,
    updated_at=$3 WHERE raw_received_at=$4 AND raw_event_id=$5 AND processor=$6 AND state='pending'`,
  [leaseToken2, '2026-08-04T22:01:00.000Z', now, receivedAt, rawA, processor]);
  const leaseState = (await owner.query(`SELECT state,lease_generation,attempt_count,lease_token
    FROM journey_event_processing_inbox WHERE raw_received_at=$1 AND raw_event_id=$2 AND processor=$3`,
  [receivedAt, rawA, processor])).rows[0];
  assert.equal(leaseState.state, 'leased');
  assert.equal(Number(leaseState.lease_generation), 3);
  assert.equal(Number(leaseState.attempt_count), 2);
  assert.equal(leaseState.lease_token, leaseToken2);

  await app.query(`INSERT INTO journey_event_processing_receipts
    (attempted_at,id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,
      processor_version,attempt_number,status,lease_token,lease_generation,checkpoint,error_code,
      error_detail_json,completed_at,retention_expires_at)
    VALUES ($1,$2,$1,$3,$4,$5,'production',$6,$7,'1.0.0',2,'terminal_failed',$8,3,'validate',
      'PROCESSOR_TERMINAL',$9,$10,$11)`,
  [receivedAt, processingReceiptA, rawA, spaceA, sourceA, eventA, processor, leaseToken2,
    JSON.stringify({ reason: 'redacted' }), '2026-08-01T12:03:00.000Z', retainedUntil]);
  const processingPartition = (await owner.query(`SELECT tableoid::regclass::text partition_name
    FROM journey_event_processing_receipts WHERE id=$1`, [processingReceiptA])).rows[0].partition_name;
  assert.equal(processingPartition, 'journey_event_processing_receipts_2026_08');
  await app.query(`UPDATE journey_event_processing_inbox SET state='dead_lettered',lease_owner=NULL,
    lease_token=NULL,lease_expires_at=NULL,last_error_code='PROCESSOR_TERMINAL',updated_at=$1
    WHERE raw_received_at=$2 AND raw_event_id=$3 AND processor=$4 AND lease_generation=3`,
  ['2026-08-01T12:03:00.000Z', receivedAt, rawA, processor]);
  await app.query(`INSERT INTO journey_event_dead_letters
    (id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,failure_code,
      redacted_detail_json,attempt_count,replay_eligible,replay_after,last_processing_receipt_id,
      last_processing_attempted_at,resolved_at,resolution_code,updated_at,retention_expires_at)
    VALUES ($1,$2,$3,$4,$5,'production',$6,$7,'pending','PROCESSOR_TERMINAL',$8,2,TRUE,NULL,$9,$2,
      NULL,NULL,$10,$11)`,
  [deadLetterA, receivedAt, rawA, spaceA, sourceA, eventA, processor,
    JSON.stringify({ reason: 'redacted' }), processingReceiptA, '2026-08-01T12:03:00.000Z',
    deadLetterRetainedUntil]);
  await rejected(app.query(`UPDATE journey_event_dead_letters SET state='replay_scheduled',replay_after=NULL
    WHERE id=$1`, [deadLetterA]), ['23514']);
  await app.query(`UPDATE journey_event_dead_letters SET state='replay_scheduled',replay_after=$2,updated_at=$3
    WHERE id=$1 AND replay_eligible=TRUE`,
  [deadLetterA, '2026-08-04T23:00:00.000Z', now]);
  await app.query(`INSERT INTO journey_event_data_audit
    (id,space_id,source_id,environment,action,target_type,target_id,actor_user_id,detail_json,created_at,
      retention_expires_at)
    VALUES ($1,$2,$3,'production','dead_letter.replay_requested','dead_letter',$4,$5,$6,$7,$8)`,
  [`${proof}_audit`, spaceA, sourceA, deadLetterA, userId, JSON.stringify({ reason: 'operator-reviewed' }),
    receivedAt, retainedUntil]);
  await rejected(app.query(`UPDATE journey_event_data_audit SET detail_json='{}' WHERE id=$1`,
    [`${proof}_audit`]), ['42501']);

  // Concurrent UPSERTs are additive, not last-writer-wins. The same primitive
  // backs per-minute rate windows and the existing monthly quota bucket.
  const rateSql = `INSERT INTO journey_event_rate_buckets
    (space_id,source_id,environment,window_started_at,event_count,byte_count,updated_at)
    VALUES ($1,$2,'production',$3,1,64,$4)
    ON CONFLICT(space_id,source_id,environment,window_started_at) DO UPDATE SET
      event_count=journey_event_rate_buckets.event_count+EXCLUDED.event_count,
      byte_count=journey_event_rate_buckets.byte_count+EXCLUDED.byte_count,
      updated_at=EXCLUDED.updated_at`;
  await Promise.all([
    app.query(rateSql, [spaceA, sourceA, '2026-08-01T12:00:00.000Z', now]),
    appPeer.query(rateSql, [spaceA, sourceA, '2026-08-01T12:00:00.000Z', now])
  ]);
  const rate = (await owner.query(`SELECT event_count,byte_count FROM journey_event_rate_buckets
    WHERE space_id=$1 AND source_id=$2`, [spaceA, sourceA])).rows[0];
  assert.equal(Number(rate.event_count), 2);
  assert.equal(Number(rate.byte_count), 128);

  const periodStart = '2026-08-01T00:00:00.000Z';
  const periodEnd = '2026-09-01T00:00:00.000Z';
  const quotaSql = `INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
    VALUES ($1,'monthlyTrackedEvents',$2,$3,1,$4)
    ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
      quantity=platform_usage_buckets.quantity+EXCLUDED.quantity,updated_at=EXCLUDED.updated_at`;
  await Promise.all([
    app.query(quotaSql, [spaceA, periodStart, periodEnd, now]),
    appPeer.query(quotaSql, [spaceA, periodStart, periodEnd, now])
  ]);
  assert.equal(Number((await owner.query(`SELECT quantity FROM platform_usage_buckets
    WHERE space_id=$1 AND meter='monthlyTrackedEvents'`, [spaceA])).rows[0].quantity), 2);

  await owner.query('BEGIN');
  await owner.query('SAVEPOINT pg17_nested');
  await owner.query(`INSERT INTO journey_event_rejections
    (id,space_id,source_id,environment,code,redacted_detail_json,payload_bytes,replay_eligible,
      created_at,retention_expires_at)
    VALUES ($1,$2,$3,'production','NESTED_ROLLBACK','{}',0,FALSE,$4,$5)`,
  [`${proof}_nested`, spaceA, sourceA, receivedAt, retainedUntil]);
  await owner.query('ROLLBACK TO SAVEPOINT pg17_nested');
  assert.equal(Number((await owner.query(`SELECT COUNT(*) count FROM journey_event_rejections WHERE id=$1`,
    [`${proof}_nested`])).rows[0].count), 0);
  await owner.query('ROLLBACK');

  // Explicit owner-only expired-retention purge. Runtime roles cannot invoke
  // it and every proof row is removed before the script reports success.
  await owner.query('BEGIN');
  await owner.query("SET LOCAL seemplify.retention_purge='on'");
  await owner.query('DELETE FROM journey_event_data_audit WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_dead_letters WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_processing_receipts WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_processing_inbox WHERE raw_event_id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_rejections WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_deduplication WHERE event_id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_ingest_receipts WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_raw_events WHERE id LIKE $1', [`${proof}%`]);
  await owner.query('DELETE FROM journey_event_rate_buckets WHERE space_id IN ($1,$2)', [spaceA, spaceB]);
  await owner.query(`DELETE FROM platform_usage_buckets WHERE space_id IN ($1,$2)
    AND meter='monthlyTrackedEvents'`, [spaceA, spaceB]);
  await owner.query('DELETE FROM spaces WHERE id IN ($1,$2)', [spaceA, spaceB]);
  await owner.query('DELETE FROM users WHERE id=$1', [userId]);
  await owner.query('COMMIT');

  const durableWrites = await owner.query(`SELECT SUM(count)::int count FROM (
    SELECT COUNT(*) count FROM journey_event_deduplication WHERE event_id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_raw_events WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_ingest_receipts WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_rejections WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_rate_buckets WHERE space_id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_processing_inbox WHERE raw_event_id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_processing_receipts WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_dead_letters WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_data_audit WHERE id LIKE $1
  ) proof_rows`, [`${proof}%`]);
  assert.equal(Number(durableWrites.rows[0].count), 0);

  process.stdout.write(`${JSON.stringify({
    event: 'journey_event_data_plane_postgres_probe_passed',
    runtimeSchemaVersion: 18,
    durable202Primitive: true,
    globalDedupe: true,
    contentConflict: true,
    appendOnly: true,
    leaseRecovery: true,
    deadLetterReplay: true,
    tenantEnvironmentIsolation: true,
    partitionRouting: true,
    atomicRateAndQuota: true,
    redactedInvalidAttempt: true,
    nestedRollback: true,
    durableWrites: 0
  })}\n`);
} finally {
  await Promise.allSettled([owner.query('ROLLBACK'), ownerPeer.query('ROLLBACK'), app.query('ROLLBACK'), appPeer.query('ROLLBACK')]);
  await Promise.allSettled([owner.end(), ownerPeer.end(), app.end(), appPeer.end()]);
}
