#!/usr/bin/env node

/** Runtime-26 proof for governed Journey Map saved views. This probe only
 * writes to the disposable PostgreSQL E2E database and exercises exact tenant
 * constraints, append-only history, membership retention, and the two
 * row-lock protocols used for idempotency and quota admission. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'pg';
import { assertRuntimePrivileges, assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg26_view_${crypto.randomBytes(6).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-26 saved-view probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-26 saved-view probe refuses every non-disposable database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const password = (filename) => fs.readFileSync(filename, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (user, credential, name) => ({ host, port, database, user, password: credential, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-saved-view-runtime26-owner'));
const app = new Client(connection(appUser, password(appPasswordFile), 'journey-saved-view-runtime26-app'));
const left = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-saved-view-runtime26-left'));
const right = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-saved-view-runtime26-right'));
const at = '2026-08-05T16:00:00.000Z';
const hash = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ids = {
  owner: `${proof}_owner`, outsider: `${proof}_outsider`,
  spaceA: `${proof}_space_a`, spaceB: `${proof}_space_b`, spaceQuota: `${proof}_space_quota`,
  definitionA: `${proof}_definition_a`, definitionB: `${proof}_definition_b`, definitionQuota: `${proof}_definition_quota`,
  versionA: `${proof}_version_a`, versionB: `${proof}_version_b`, versionQuota: `${proof}_version_quota`,
  segmentA: `${proof}_segment_a`, segmentB: `${proof}_segment_b`, view: `${proof}_view`, quotaView: `${proof}_quota_view`
};

function configuration(versionId) {
  return JSON.stringify({
    schemaVersion: 1,
    binding: { policy: 'exact', versionId },
    filters: { personaIds: [], segmentIds: [], cohortIds: [], channelIds: [], evidenceLinkIds: [],
      evidenceStates: [], cardKinds: [], laneKeys: [], timeWindow: null },
    comparisonTarget: null,
    presentation: { density: 'comfortable', showEvidenceLegend: true, showResearchGaps: true,
      showEmptyLanes: true, title: '' }
  });
}

const insertView = `INSERT INTO journey_saved_views
  (id,space_id,definition_id,name,visibility,owner_user_id,binding_policy,bound_version_id,
   comparison_definition_id,comparison_version_id,schema_version,config_json,config_sha256,state,revision,
   idempotency_key,intent_sha256,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,retention_expires_at)
  VALUES ($1,$2,$3,$4,$5,$6,'exact',$7,NULL,NULL,1,$8,$9,'active',1,$10,$11,$6,$6,$12,$12,NULL,NULL)`;

try {
  await Promise.all([owner.connect(), app.connect(), left.connect(), right.connect()]);
  const migration = await owner.query('SELECT version,checksum FROM experience_runtime_schema_version WHERE version=26');
  assert.equal(migration.rowCount, 1);
  assert.match(String(migration.rows[0].checksum), /^[a-f0-9]{64}$/u);
  await assertRuntimeSchemaContract((sql) => owner.query(sql), { runtimeVersion: 26 });
  await assertRuntimePrivileges((sql) => owner.query(sql), appUser, { runtimeVersion: 26 });
  emit('journey_saved_view_runtime_contract_passed');

  for (const [id, email, name] of [[ids.owner, `${proof}-owner@example.invalid`, 'Saved view owner'],
    [ids.outsider, `${proof}-outsider@example.invalid`, 'Saved view outsider']]) {
    await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
      VALUES ($1,$2,$3,'not-a-login','member',1,$4,$4)`, [id, email, name, at]);
  }
  for (const [spaceId, slug] of [[ids.spaceA, `${proof}-a`], [ids.spaceB, `${proof}-b`],
    [ids.spaceQuota, `${proof}-quota`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 26 saved views',$2,$3,NULL,$4,$4)`, [spaceId, slug, ids.owner, at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,'owner',$3,$3)`, [spaceId, ids.owner, at]);
  }
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceB, ids.outsider, at]);
  for (const [definitionId, versionId, spaceId] of [
    [ids.definitionA, ids.versionA, ids.spaceA], [ids.definitionB, ids.versionB, ids.spaceB],
    [ids.definitionQuota, ids.versionQuota, ids.spaceQuota]
  ]) {
    await owner.query(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
       published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES ($1,$2,'Saved-view proof','Exact identity','customer','current_state','designed','draft',$3,
        NULL,NULL,30,1,$4,$4)`, [definitionId, spaceId, ids.owner, at]);
    await owner.query(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,state,map_type,mode,experience_type,author_user_id,published_at,created_at)
      VALUES ($1,$2,$3,1,'draft','current_state','designed','customer',$4,NULL,$5)`,
    [versionId, definitionId, spaceId, ids.owner, at]);
    await owner.query('UPDATE journey_definitions SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
      [versionId, definitionId, spaceId]);
  }
  for (const [segmentId, spaceId, definitionId] of [[ids.segmentA, ids.spaceA, ids.definitionA],
    [ids.segmentB, ids.spaceB, ids.definitionB]]) {
    await owner.query(`INSERT INTO journey_metric_segments
      (id,space_id,journey_definition_id,name,description,rule_json,state,revision,idempotency_key,intent_sha256,
       created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,'Exact segment','','{}','active',1,$4,$5,$6,$7,$7)`,
    [segmentId, spaceId, definitionId, `segment-${segmentId}`, hash(segmentId), ids.owner, at]);
  }

  const configA = configuration(ids.versionA);
  await app.query(insertView, [ids.view, ids.spaceA, ids.definitionA, 'My evidence view', 'private', ids.owner,
    ids.versionA, configA, crypto.createHash('sha256').update(configA).digest('hex'), `view-${proof}`,
    hash('view-intent'), at]);
  await assert.rejects(owner.query(insertView, [`${proof}_wrong_owner`, ids.spaceA, ids.definitionA, 'Wrong owner',
    'private', ids.outsider, ids.versionA, configA, crypto.createHash('sha256').update(configA).digest('hex'),
    `wrong-owner-${proof}`, hash('wrong-owner'), at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_saved_views_owner_membership_fk');
  const configB = configuration(ids.versionB);
  await assert.rejects(owner.query(insertView, [`${proof}_cross_version`, ids.spaceA, ids.definitionA, 'Cross version',
    'space', ids.owner, ids.versionB, configB, crypto.createHash('sha256').update(configB).digest('hex'),
    `cross-version-${proof}`, hash('cross-version'), at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_saved_views_bound_version_tenant_fk');
  await owner.query(`INSERT INTO journey_saved_view_references(view_id,space_id,kind,reference_value,ordinal)
    VALUES ($1,$2,'segment',$3,0)`, [ids.view, ids.spaceA, ids.segmentA]);
  await assert.rejects(owner.query(`INSERT INTO journey_saved_view_references(view_id,space_id,kind,reference_value,ordinal)
    VALUES ($1,$2,'segment',$3,1)`, [ids.view, ids.spaceA, ids.segmentB]),
  (error) => error?.code === '23503');
  await assert.rejects(owner.query(`INSERT INTO journey_saved_view_references(view_id,space_id,kind,reference_value,ordinal)
    VALUES ($1,$2,'cohort',$3,1)`, [ids.view, ids.spaceA, `${proof}_cohort`]),
  (error) => error?.code === '23514');
  emit('journey_saved_view_tenant_membership_and_reference_guards_passed');

  await owner.query(`INSERT INTO journey_saved_view_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'view.create',$5,'{}',$6)`,
  [`${proof}_operation`, ids.spaceA, ids.owner, `operation-${proof}`, hash('operation'), at]);
  await owner.query(`INSERT INTO journey_saved_view_audit_events
    (id,space_id,actor_user_id,action,view_id,definition_id,view_revision,detail_json,created_at)
    VALUES ($1,$2,$3,'view.created',$4,$5,1,'{}',$6)`,
  [`${proof}_audit`, ids.spaceA, ids.owner, ids.view, ids.definitionA, at]);
  for (const table of ['journey_saved_view_operations','journey_saved_view_audit_events']) {
    await assert.rejects(owner.query(`UPDATE ${table} SET created_at=created_at`), (error) => error?.code === '55000');
    await assert.rejects(app.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  await assert.rejects(owner.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2',
    [ids.spaceA, ids.owner]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_saved_views_owner_membership_fk');
  emit('journey_saved_view_append_only_and_owner_retention_passed');

  // Quota admission protocol: both transactions serialize on the space row;
  // the second admission observes the first committed count and refuses a
  // second insert under a limit of one.
  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [ids.spaceQuota]);
  let quotaRightFinished = false;
  const quotaRightLock = right.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [ids.spaceQuota])
    .finally(() => { quotaRightFinished = true; });
  await delay(100);
  assert.equal(quotaRightFinished, false);
  const configQuota = configuration(ids.versionQuota);
  await left.query(insertView, [ids.quotaView, ids.spaceQuota, ids.definitionQuota, 'Only admitted view', 'private',
    ids.owner, ids.versionQuota, configQuota, crypto.createHash('sha256').update(configQuota).digest('hex'),
    `quota-${proof}`, hash('quota-view'), at]);
  await left.query('COMMIT');
  await quotaRightLock;
  const admitted = Number((await right.query(`SELECT COUNT(*)::int count FROM journey_saved_views
    WHERE space_id=$1 AND state='active'`, [ids.spaceQuota])).rows[0].count);
  assert.equal(admitted, 1);
  await right.query('ROLLBACK');
  emit('journey_saved_view_two_connection_quota_lock_passed');

  // Idempotency protocol: the principal membership row is the deterministic
  // lock. A concurrent same-key request can only inspect the receipt after the
  // first commit and therefore cannot create a second operation.
  const concurrentKey = `same-key-${proof}`;
  const concurrentIntent = hash('same-key-intent');
  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE',
    [ids.spaceA, ids.owner]);
  let operationRightFinished = false;
  const operationRightLock = right.query(
    'SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE', [ids.spaceA, ids.owner]
  ).finally(() => { operationRightFinished = true; });
  await delay(100);
  assert.equal(operationRightFinished, false);
  await left.query(`INSERT INTO journey_saved_view_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'default.reset',$5,'{"reset":true}',$6)`,
  [`${proof}_concurrent_operation`, ids.spaceA, ids.owner, concurrentKey, concurrentIntent, at]);
  await left.query('COMMIT');
  await operationRightLock;
  const receipt = await right.query(`SELECT intent_sha256,response_json FROM journey_saved_view_operations
    WHERE space_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`, [ids.spaceA, ids.owner, concurrentKey]);
  assert.equal(receipt.rowCount, 1);
  assert.equal(receipt.rows[0].intent_sha256, concurrentIntent);
  assert.deepEqual(JSON.parse(receipt.rows[0].response_json), { reset: true });
  await right.query('ROLLBACK');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_saved_view_operations
    WHERE space_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`, [ids.spaceA, ids.owner, concurrentKey])).rows[0].count), 1);
  emit('journey_saved_view_two_connection_idempotency_lock_passed');
} finally {
  await Promise.allSettled([left.query('ROLLBACK'), right.query('ROLLBACK')]);
  await Promise.allSettled([owner.end(), app.end(), left.end(), right.end()]);
}

