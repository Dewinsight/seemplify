#!/usr/bin/env node

/**
 * Destructive only to an explicitly isolated PostgreSQL E2E database. Every
 * proof row is namespaced and removed before success; the enclosing E2E runner
 * also drops the random database in finally.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  assertRuntimePrivileges,
  assertRuntimeSchemaContract
} from './postgres-runtime-contract.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg16_${crypto.randomBytes(8).toString('hex')}`;
const now = '2026-08-04T22:00:00.000Z';

function password(file, label) {
  assert.ok(file && fs.existsSync(file), `${label} password file is required.`);
  const value = fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/u, '');
  assert.ok(value, `${label} password file is empty.`);
  return value;
}

function connection(user, passwordValue, applicationName) {
  return {
    host,
    port,
    database,
    user,
    password: passwordValue,
    ssl: false,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000
  };
}

function sourceValues(id, spaceId, environment, name) {
  return [id, spaceId, name, environment, 'active', 'enforce', '[]', '[]', 1_000, 1_000_000,
    `${proof}:${id}`, 'a'.repeat(64), now, now];
}

async function rejected(promise, codes) {
  await assert.rejects(promise, (error) => codes.includes(String(error?.code)),
    `Expected PostgreSQL error ${codes.join(' or ')}.`);
}

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-16 probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^(?:experience_e2e|experience_control_plane_test)_[a-f0-9]+$/u,
  'The runtime-16 probe refuses to run outside an isolated test database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);

const ownerConfig = connection(ownerUser, password(ownerPasswordFile, 'owner'), 'journey-control-plane-pg16-owner');
const appConfig = connection(appUser, password(appPasswordFile, 'app'), 'journey-control-plane-pg16-app');
const owner = new Client(ownerConfig);
const ownerPeer = new Client(ownerConfig);
const app = new Client(appConfig);

const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const sourceA = `${proof}_source_a`;
const sourceA2 = `${proof}_source_a2`;
const sourceB = `${proof}_source_b`;
const schemaA = `${proof}_schema_a`;
const credentialA = `${proof}_credential_a`;

try {
  await Promise.all([owner.connect(), ownerPeer.connect(), app.connect()]);
  const schemaContract = await assertRuntimeSchemaContract((sql) => owner.query(sql), {
    schema: 'public', runtimeVersion: 16
  });
  const privilegeContract = await assertRuntimePrivileges((sql) => owner.query(sql), appUser, {
    schema: 'public', runtimeVersion: 16
  });
  assert.equal(schemaContract.runtimeVersion, 16);
  assert.equal(privilegeContract.protectedTables, 15);

  const runtimeRows = await owner.query(`SELECT version,name,checksum FROM experience_runtime_schema_version
    WHERE version=16`);
  assert.equal(runtimeRows.rowCount, 1, 'Runtime migration 16 must have exactly one checksummed ledger row.');
  assert.equal(runtimeRows.rows[0].name, '0016_journey_event_control_plane.sql');
  const migrationSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres',
    '0016_journey_event_control_plane.sql'), 'utf8').replace(/\r\n?/gu, '\n');
  assert.equal(runtimeRows.rows[0].checksum, crypto.createHash('sha256').update(migrationSql).digest('hex'));

  const forbiddenColumns = await owner.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name LIKE 'journey_event_%'
      AND column_name ~ '(plaintext|secret_value|raw_key|access_token|refresh_token|private_key)'`);
  assert.equal(forbiddenColumns.rowCount, 0, 'Control-plane tables must not contain recoverable plaintext-secret columns.');

  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'PG16 proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, now]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'PG16 A',$2,$3,NULL,$4,$4),($5,'PG16 B',$6,$3,NULL,$4,$4)`,
  [spaceA, `${proof}-a`, userId, now, spaceB, `${proof}-b`]);

  const insertSource = `INSERT INTO journey_event_sources
    (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
      events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;
  await owner.query(insertSource, sourceValues(sourceA, spaceA, 'development', 'Browser development'));
  await owner.query(insertSource, sourceValues(sourceA2, spaceA, 'development', 'Node development'));
  await owner.query(insertSource, sourceValues(sourceB, spaceB, 'production', 'Browser production'));

  const insertCredential = `INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
      rotated_from_id,idempotency_key,intent_hash,created_at,expires_at,revoked_at)
    VALUES ($1,$2,$3,$4,$5,'events:write',$6,'scrypt-v1',$7,$8,$9,$10,$11,$12,$13,$14,$15)`;
  await rejected(owner.query(insertCredential, [`${proof}_cross_tenant`, sourceA, spaceB, 'development',
    'public_write', 'jpk_dev.cross', 's'.repeat(24), 'b'.repeat(64), 'active', null,
    `${proof}:cross`, 'c'.repeat(64), now, null, null]), ['23503']);
  await rejected(owner.query(insertCredential, [`${proof}_cross_environment`, sourceA, spaceA, 'production',
    'public_write', 'jpk_live.cross', 's'.repeat(24), 'b'.repeat(64), 'active', null,
    `${proof}:cross-env`, 'c'.repeat(64), now, null, null]), ['23503']);
  await owner.query(insertCredential, [credentialA, sourceA, spaceA, 'development', 'public_write',
    'jpk_dev.credential_a', 's'.repeat(24), 'b'.repeat(64), 'active', null,
    `${proof}:credential-a`, 'c'.repeat(64), now, null, null]);
  await rejected(owner.query(insertCredential, [`${proof}_duplicate_active`, sourceA, spaceA, 'development',
    'public_write', 'jpk_dev.duplicate', 's'.repeat(24), 'b'.repeat(64), 'active', null,
    `${proof}:duplicate`, 'c'.repeat(64), now, null, null]), ['23505']);
  await rejected(owner.query(insertCredential, [`${proof}_cross_rotation`, sourceA2, spaceA, 'development',
    'public_write', 'jpk_dev.cross_rotation', 's'.repeat(24), 'b'.repeat(64), 'active', credentialA,
    `${proof}:cross-rotation`, 'c'.repeat(64), now, null, null]), ['23514']);

  const insertSchema = `INSERT INTO journey_event_schemas
    (id,source_id,space_id,event_name,idempotency_key,intent_hash,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`;
  await rejected(owner.query(insertSchema, [`${proof}_cross_schema`, sourceA, spaceB, 'survey_published',
    `${proof}:cross-schema`, 'd'.repeat(64), now]), ['23503']);
  await owner.query(insertSchema, [schemaA, sourceA, spaceA, 'survey_published',
    `${proof}:schema-a`, 'd'.repeat(64), now]);

  const insertVersion = `INSERT INTO journey_event_schema_versions
    (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,
      compatibility_json,content_sha256,idempotency_key,intent_hash,created_at,published_at,deprecated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,NULL,NULL)`;
  const version1 = `${proof}_version_1`;
  const version2 = `${proof}_version_2`;
  await owner.query(insertVersion, [version1, schemaA, sourceA, spaceA, '1.0', 1, 0, '[]', '{}',
    'e'.repeat(64), `${proof}:version-1`, 'f'.repeat(64), now]);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET properties_json='[{}]'
    WHERE id=$1`, [version1]), ['55000']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET compatibility_json='{"compatible":true}'
    WHERE id=$1`, [version1]), ['55000']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions
    SET state='deprecated',published_at=$2,deprecated_at=$2 WHERE id=$1`, [version1, now]), ['23514']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET state='published',published_at=$2
    WHERE id=$1`, [version1, now]), ['23514']);
  await owner.query(`UPDATE journey_event_schema_versions SET state='published',compatibility_json=$2,
    published_by_user_id=$3,published_at=$4 WHERE id=$1`,
  [version1, JSON.stringify({ compatible: true, issues: [] }), userId, now]);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET compatibility_json='{}'
    WHERE id=$1`, [version1]), ['55000']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET published_at=$2
    WHERE id=$1`, [version1, '2026-08-04T22:01:00.000Z']), ['55000']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET deprecated_by_user_id=$2
    WHERE id=$1`, [version1, userId]), ['55000']);
  await owner.query(insertVersion, [version2, schemaA, sourceA, spaceA, '1.1', 1, 1, '[]', '{}',
    '1'.repeat(64), `${proof}:version-2`, '2'.repeat(64), now]);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET state='published',published_by_user_id=$2,
    published_at=$3 WHERE id=$1`, [version2, userId, now]), ['23505']);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET state='deprecated',deprecated_at=$2
    WHERE id=$1`, [version1, now]), ['23514']);
  await owner.query(`UPDATE journey_event_schema_versions SET state='deprecated',deprecated_by_user_id=$2,
    deprecated_at=$3 WHERE id=$1`, [version1, userId, now]);
  await rejected(owner.query(`UPDATE journey_event_schema_versions SET deprecated_at=$2
    WHERE id=$1`, [version1, '2026-08-04T22:01:00.000Z']), ['55000']);
  await owner.query(`UPDATE journey_event_schema_versions SET state='published',published_by_user_id=$2,
    published_at=$3 WHERE id=$1`, [version2, userId, now]);

  const insertAudit = `INSERT INTO journey_event_control_audit_events
    (id,space_id,source_id,action,target_type,target_id,detail_json,created_at)
    VALUES ($1,$2,$3,'source.updated','source',$4,'{}',$5)`;
  await rejected(owner.query(insertAudit, [`${proof}_audit_cross`, spaceB, sourceA, sourceA, now]), ['23514']);
  await owner.query(insertAudit, [`${proof}_audit`, spaceA, sourceA, sourceA, now]);
  await rejected(app.query(`UPDATE journey_event_control_audit_events SET detail_json='{"changed":true}'
    WHERE id=$1`, [`${proof}_audit`]), ['42501']);
  await rejected(app.query('DELETE FROM journey_event_control_audit_events WHERE id=$1',
    [`${proof}_audit`]), ['42501']);

  // The source quota transaction serializes on the tenant row. The second
  // transaction must remain blocked until the first releases its FOR UPDATE
  // lock, eliminating count-then-insert races across application instances.
  await owner.query('BEGIN');
  await owner.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceA]);
  await ownerPeer.query('BEGIN');
  let quotaLockResolved = false;
  const quotaLock = ownerPeer.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceA])
    .then(() => { quotaLockResolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(quotaLockResolved, false, 'Tenant quota lock did not serialize concurrent admissions.');
  await owner.query('ROLLBACK');
  await quotaLock;
  await ownerPeer.query('ROLLBACK');

  // The partial unique index also resolves a real concurrent issuance race:
  // the loser waits for the winner's transaction and then receives 23505.
  await owner.query('BEGIN');
  await owner.query(insertCredential, [`${proof}_race_winner`, sourceA2, spaceA, 'development',
    'server_secret', 'jsk_dev.race_winner', 's'.repeat(24), '3'.repeat(64), 'active', null,
    `${proof}:race-winner`, '4'.repeat(64), now, null, null]);
  await ownerPeer.query('BEGIN');
  let activeRaceSettled = false;
  const activeRace = ownerPeer.query(insertCredential, [`${proof}_race_loser`, sourceA2, spaceA, 'development',
    'server_secret', 'jsk_dev.race_loser', 's'.repeat(24), '5'.repeat(64), 'active', null,
    `${proof}:race-loser`, '6'.repeat(64), now, null, null])
    .then(() => ({ ok: true }), (error) => ({ ok: false, error }))
    .finally(() => { activeRaceSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(activeRaceSettled, false, 'Concurrent credential issuance did not wait on the active-key index.');
  await owner.query('COMMIT');
  const activeRaceResult = await activeRace;
  assert.equal(activeRaceResult.ok, false);
  assert.equal(String(activeRaceResult.error?.code), '23505');
  await ownerPeer.query('ROLLBACK');

  // Nested rollback proof: a savepoint-scoped control-plane write leaves no
  // row behind and does not disturb the outer transaction.
  await owner.query('BEGIN');
  await owner.query('SAVEPOINT pg16_nested');
  await owner.query(insertAudit, [`${proof}_nested_rollback`, spaceA, sourceA, sourceA, now]);
  await owner.query('ROLLBACK TO SAVEPOINT pg16_nested');
  assert.equal(Number((await owner.query(`SELECT COUNT(*) count FROM journey_event_control_audit_events
    WHERE id=$1`, [`${proof}_nested_rollback`])).rows[0].count), 0);
  await owner.query('ROLLBACK');

  await owner.query('DELETE FROM spaces WHERE id IN ($1,$2)', [spaceA, spaceB]);
  await owner.query('DELETE FROM users WHERE id=$1', [userId]);
  const durableWrites = await owner.query(`SELECT SUM(count)::int count FROM (
    SELECT COUNT(*) count FROM journey_event_sources WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_credentials WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_schemas WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_schema_versions WHERE id LIKE $1
    UNION ALL SELECT COUNT(*) FROM journey_event_control_audit_events WHERE id LIKE $1
  ) proof_rows`, [`${proof}%`]);
  assert.equal(Number(durableWrites.rows[0].count), 0, 'The PostgreSQL runtime-16 proof left durable rows.');

  process.stdout.write(`${JSON.stringify({
    event: 'journey_event_control_plane_postgres_probe_passed',
    runtimeSchemaVersion: 16,
    tenantIsolation: true,
    environmentIsolation: true,
    oneActiveKey: true,
    schemaContentImmutable: true,
    appendOnlyAudit: true,
    quotaMutex: true,
    nestedRollback: true,
    durableWrites: 0
  })}\n`);
} finally {
  await Promise.allSettled([
    owner.query('ROLLBACK'), ownerPeer.query('ROLLBACK'), app.query('ROLLBACK')
  ]);
  await owner.query('DELETE FROM spaces WHERE id IN ($1,$2)', [spaceA, spaceB]).catch(() => {});
  await owner.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
  await Promise.allSettled([owner.end(), ownerPeer.end(), app.end()]);
}
