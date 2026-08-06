#!/usr/bin/env node

/** Runtime-25 proof for deterministic journey metric/evidence alerts. This
 * script refuses every non-disposable database and stores no source content. */
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
const proof = `pg25_alert_${crypto.randomBytes(6).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-25 metric-alert probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-25 metric-alert probe refuses every non-disposable database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const password = (filename) => fs.readFileSync(filename, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (user, credential, name) => ({ host, port, database, user, password: credential, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-metric-alert-runtime25-owner'));
const app = new Client(connection(appUser, password(appPasswordFile), 'journey-metric-alert-runtime25-app'));
const left = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-metric-alert-runtime25-left'));
const right = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-metric-alert-runtime25-right'));

const at = '2026-08-05T12:00:00.000Z';
const hash = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ids = {
  owner: `${proof}_owner`, admin: `${proof}_admin`, member: `${proof}_member`,
  spaceA: `${proof}_space_a`, spaceB: `${proof}_space_b`,
  journeyA: `${proof}_journey_a`, journeyA2: `${proof}_journey_a2`, journeyB: `${proof}_journey_b`,
  metricA: `${proof}_metric_a`, metricA2: `${proof}_metric_a2`, metricB: `${proof}_metric_b`,
  metricVersionA: `${proof}_metric_a_v1`, metricVersionA2: `${proof}_metric_a2_v1`,
  metricVersionB: `${proof}_metric_b_v1`, alert: `${proof}_alert`, alertVersion: `${proof}_alert_v1`
};

const insertAlertRoot = `INSERT INTO journey_metric_alert_definitions
  (id,space_id,journey_definition_id,metric_definition_id,name,state,current_version_id,revision,idempotency_key,
   intent_sha256,created_by_user_id,created_at,updated_at)
  VALUES ($1,$2,$3,$4,$5,'active',$6,1,$7,$8,$9,$10,$10)`;
const insertAlertVersion = `INSERT INTO journey_metric_alert_definition_versions
  (id,definition_id,space_id,metric_definition_id,version_number,rule_kind,direction,threshold_value,window_seconds,
   cooldown_seconds,minimum_sample_size,stale_after_seconds,contradiction_min_ratio,content_sha256,idempotency_key,
   intent_sha256,created_by_user_id,created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,172800,3600,2,3600,0.25,$9,$10,$11,$12,$13)`;

async function seedMetric(client, { metricId, versionId, spaceId, journeyId, userId }) {
  await client.query('BEGIN');
  await client.query(`INSERT INTO journey_metric_definitions
    (id,space_id,journey_definition_id,target_type,target_id,name,state,current_version_id,revision,idempotency_key,
     intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'journey',$3,$4,'active',$5,1,$6,$7,$8,$9,$9)`,
  [metricId, spaceId, journeyId, `Metric ${metricId}`, versionId, `metric-${metricId}`, hash(metricId), userId, at]);
  await client.query(`INSERT INTO journey_metric_definition_versions
    (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,
     window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,
     population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,
     created_by_user_id,created_at)
    VALUES ($1,$2,$3,1,'operational_import',NULL,'operational','count','higher_is_better',86400,'UTC',2,86400,
      NULL,NULL,'{}','{}','{"kind":"count"}','{"kind":"count"}',$4,$5,$6,$7,$8)`,
  [versionId, metricId, spaceId, hash(`metric-content-${metricId}`), `metric-version-${metricId}`,
    hash(`metric-intent-${metricId}`), userId, at]);
  await client.query('COMMIT');
}

try {
  await Promise.all([owner.connect(), app.connect(), left.connect(), right.connect()]);
  const migration = await owner.query(`SELECT version,checksum FROM experience_runtime_schema_version WHERE version=25`);
  assert.equal(migration.rowCount, 1); assert.match(String(migration.rows[0].checksum), /^[a-f0-9]{64}$/u);
  await assertRuntimeSchemaContract((sql) => owner.query(sql), { runtimeVersion: 25 });
  await assertRuntimePrivileges((sql) => owner.query(sql), appUser, { runtimeVersion: 25 });
  emit('journey_metric_alert_runtime_contract_passed');

  for (const [id, email, name] of [[ids.owner, `${proof}-owner@example.invalid`, 'Owner'],
    [ids.admin, `${proof}-admin@example.invalid`, 'Admin'], [ids.member, `${proof}-member@example.invalid`, 'Member']]) {
    await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
      VALUES ($1,$2,$3,'not-a-login','member',1,$4,$4)`, [id, email, name, at]);
  }
  for (const [spaceId, slug] of [[ids.spaceA, `${proof}-a`], [ids.spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 25 alert proof',$2,$3,NULL,$4,$4)`, [spaceId, slug, ids.owner, at]);
  }
  for (const [spaceId, userId, role] of [[ids.spaceA, ids.owner, 'owner'], [ids.spaceA, ids.admin, 'admin'],
    [ids.spaceA, ids.member, 'member'], [ids.spaceB, ids.owner, 'owner']]) {
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,$3,$4,$4)`, [spaceId, userId, role, at]);
  }
  for (const [journeyId, spaceId] of [[ids.journeyA, ids.spaceA], [ids.journeyA2, ids.spaceA], [ids.journeyB, ids.spaceB]]) {
    await owner.query(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
       published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES ($1,$2,'Runtime alert map','Probe','customer','current_state','evidence_backed','draft',$3,
        NULL,NULL,30,1,$4,$4)`, [journeyId, spaceId, ids.owner, at]);
  }
  await seedMetric(owner, { metricId: ids.metricA, versionId: ids.metricVersionA,
    spaceId: ids.spaceA, journeyId: ids.journeyA, userId: ids.owner });
  await seedMetric(owner, { metricId: ids.metricA2, versionId: ids.metricVersionA2,
    spaceId: ids.spaceA, journeyId: ids.journeyA2, userId: ids.owner });
  await seedMetric(owner, { metricId: ids.metricB, versionId: ids.metricVersionB,
    spaceId: ids.spaceB, journeyId: ids.journeyB, userId: ids.owner });

  await owner.query('BEGIN');
  await owner.query(insertAlertRoot, [ids.alert, ids.spaceA, ids.journeyA, ids.metricA, 'Metric deterioration',
    ids.alertVersion, `alert-${proof}`, hash('alert-root'), ids.owner, at]);
  await owner.query(insertAlertVersion, [ids.alertVersion, ids.alert, ids.spaceA, ids.metricA, 1,
    'falling_metric', 'decrease', 5, hash('alert-v1'), `alert-v1-${proof}`, hash('alert-v1-intent'), ids.owner, at]);
  await owner.query('COMMIT');

  await assert.rejects(owner.query(insertAlertRoot, [`${proof}_wrong_journey`, ids.spaceA, ids.journeyA,
    ids.metricA2, 'Wrong journey', `${proof}_missing_v`, `wrong-journey-${proof}`, hash('wrong-journey'), ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_metric_alert_definitions_metric_tenant_fk');
  await assert.rejects(owner.query(insertAlertRoot, [`${proof}_cross_tenant`, ids.spaceA, ids.journeyA,
    ids.metricB, 'Cross tenant', `${proof}_missing_v`, `cross-tenant-${proof}`, hash('cross-tenant'), ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_metric_alert_definitions_metric_tenant_fk');
  await assert.rejects(owner.query(insertAlertRoot, [`${proof}_null_pointer`, ids.spaceA, ids.journeyA,
    ids.metricA, 'Null pointer', null, `null-${proof}`, hash('null'), ids.owner, at]),
  (error) => error?.code === '23502' && error?.column === 'current_version_id');
  await owner.query('BEGIN');
  await owner.query(insertAlertRoot, [`${proof}_orphan`, ids.spaceA, ids.journeyA, ids.metricA, 'Orphan pointer',
    `${proof}_missing_v`, `orphan-${proof}`, hash('orphan'), ids.owner, at]);
  await assert.rejects(owner.query('COMMIT'),
    (error) => error?.code === '23503' && error?.constraint === 'journey_metric_alert_definitions_current_version_tenant_fk');
  await owner.query('ROLLBACK').catch(() => {});
  await assert.rejects(owner.query(insertAlertVersion, [`${proof}_metric_mismatch_v`, ids.alert, ids.spaceA,
    ids.metricA2, 2, 'small_sample', 'any', 0, hash('mismatch-v'), `mismatch-v-${proof}`,
    hash('mismatch-v-intent'), ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_metric_alert_versions_parent_metric_tenant_fk');
  emit('journey_metric_alert_direct_orphan_mismatch_and_tenant_denial_passed');

  await assert.rejects(owner.query(`UPDATE journey_metric_alert_definition_versions SET threshold_value=threshold_value
    WHERE id=$1`, [ids.alertVersion]), (error) => error?.code === '55000');
  await assert.rejects(owner.query('DELETE FROM journey_metric_alert_definition_versions WHERE id=$1', [ids.alertVersion]),
    (error) => error?.code === '55000');
  for (const [table, update] of [
    ['journey_metric_alert_definition_versions', 'threshold_value=threshold_value'],
    ['journey_metric_alert_evaluation_results', 'sample_size=sample_size'],
    ['journey_metric_alert_events', 'reason_code=reason_code'],
    ['journey_metric_alert_notifications', 'reason_code=reason_code'],
    ['journey_metric_alert_notification_state_events', 'state_to=state_to']
  ]) {
    await assert.rejects(app.query(`UPDATE ${table} SET ${update}`), (error) => error?.code === '42501');
    await assert.rejects(app.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  emit('journey_metric_alert_append_only_and_least_privilege_passed');

  const version2 = `${proof}_alert_v2`;
  await owner.query('BEGIN');
  await owner.query(insertAlertVersion, [version2, ids.alert, ids.spaceA, ids.metricA, 2,
    'small_sample', 'any', 0, hash('alert-v2'), `alert-v2-${proof}`, hash('alert-v2-intent'), ids.owner, at]);
  await owner.query('UPDATE journey_metric_alert_definitions SET current_version_id=$1,revision=2 WHERE id=$2',
    [version2, ids.alert]);
  await owner.query('ROLLBACK');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_metric_alert_definition_versions
    WHERE id=$1`, [version2])).rows[0].count), 0);
  await owner.query('BEGIN');
  await owner.query(insertAlertVersion, [version2, ids.alert, ids.spaceA, ids.metricA, 2,
    'small_sample', 'any', 0, hash('alert-v2'), `alert-v2-${proof}`, hash('alert-v2-intent'), ids.owner, at]);
  await owner.query('UPDATE journey_metric_alert_definitions SET current_version_id=$1,revision=2 WHERE id=$2',
    [version2, ids.alert]);
  await owner.query('COMMIT');
  assert.equal((await owner.query('SELECT current_version_id FROM journey_metric_alert_definitions WHERE id=$1',
    [ids.alert])).rows[0].current_version_id, version2);
  emit('journey_metric_alert_rollback_replay_passed');

  const run = `${proof}_run`; const alertInstance = `${proof}_alert_instance`; const event = `${proof}_event`;
  await owner.query(`INSERT INTO journey_metric_alert_evaluation_runs
    (id,space_id,journey_definition_id,as_of,state,evaluated_count,triggered_count,warning_count,resolved_count,
     error_code,idempotency_key,intent_sha256,requested_by_user_id,created_at,completed_at)
    VALUES ($1,$2,$3,$4,'completed',1,1,0,0,NULL,$5,$6,$7,$4,$4)`,
  [run, ids.spaceA, ids.journeyA, at, `run-${proof}`, hash('run'), ids.owner]);
  await owner.query(`INSERT INTO journey_metric_alerts
    (id,space_id,journey_definition_id,alert_definition_id,alert_definition_version_id,metric_definition_id,
     metric_definition_version_id,observation_id,severity,reason_code,state,dedupe_sha256,lineage_json,lineage_sha256,
     observed_value,baseline_value,delta_value,sample_size,opened_at,last_evaluated_at,updated_at,revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'strong','METRIC_FELL_BEYOND_THRESHOLD','open',$8,'{}',$9,
      40,60,-20,20,$10,$10,$10,1)`,
  [alertInstance, ids.spaceA, ids.journeyA, ids.alert, version2, ids.metricA, ids.metricVersionA,
    hash('alert-dedupe'), hash('lineage'), at]);
  await owner.query(`INSERT INTO journey_metric_alert_events
    (id,alert_id,space_id,run_id,actor_user_id,action,reason_code,state_from,state_to,detail_json,created_at)
    VALUES ($1,$2,$3,$4,NULL,'opened','METRIC_FELL_BEYOND_THRESHOLD',NULL,'open','{}',$5)`,
  [event, alertInstance, ids.spaceA, run, at]);
  await owner.query(`INSERT INTO journey_metric_alert_notification_preferences(space_id,user_id,enabled,revision,updated_at)
    VALUES ($1,$2,TRUE,1,$3)`, [ids.spaceA, ids.admin, at]);
  const notificationOwner = `${proof}_notification_owner`; const notificationAdmin = `${proof}_notification_admin`;
  const notificationSql = `INSERT INTO journey_metric_alert_notifications
    (id,alert_id,space_id,user_id,event_id,channel,delivery_status,reason_code,dedupe_sha256,created_at)
    VALUES ($1,$2,$3,$4,$5,'in_app','queued','METRIC_FELL_BEYOND_THRESHOLD',$6,$7)`;
  await owner.query(notificationSql, [notificationOwner, alertInstance, ids.spaceA, ids.owner, event,
    hash('notification-owner'), at]);
  await owner.query(notificationSql, [notificationAdmin, alertInstance, ids.spaceA, ids.admin, event,
    hash('notification-admin'), at]);
  await assert.rejects(owner.query(notificationSql, [`${proof}_duplicate`, alertInstance, ids.spaceA, ids.owner, event,
    hash('notification-owner'), at]),
  (error) => error?.code === '23505' && error?.constraint === 'journey_metric_alert_notifications_dedupe');
  await assert.rejects(owner.query(`INSERT INTO journey_metric_alert_notification_states
    (notification_id,space_id,user_id,state,revision,read_at) VALUES ($1,$2,$3,'unread',1,NULL)`,
  [notificationAdmin, ids.spaceA, ids.owner]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_metric_alert_notification_states_notification_fk');
  await owner.query(`INSERT INTO journey_metric_alert_notification_states
    (notification_id,space_id,user_id,state,revision,read_at) VALUES ($1,$2,$3,'unread',1,NULL)`,
  [notificationOwner, ids.spaceA, ids.owner]);
  await owner.query(`INSERT INTO journey_metric_alert_notification_states
    (notification_id,space_id,user_id,state,revision,read_at) VALUES ($1,$2,$3,'unread',1,NULL)`,
  [notificationAdmin, ids.spaceA, ids.admin]);
  await owner.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2', [ids.spaceA, ids.admin]);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_metric_alert_notifications
    WHERE user_id=$1`, [ids.admin])).rows[0].count), 1);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_metric_alert_notification_preferences
    WHERE user_id=$1`, [ids.admin])).rows[0].count), 0);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM space_memberships
    WHERE space_id=$1 AND user_id=$2 AND role IN ('owner','admin')`, [ids.spaceA, ids.admin])).rows[0].count), 0);
  emit('journey_metric_alert_per_recipient_dedupe_and_role_removal_passed');

  const concurrentKey = `concurrent-${proof}`;
  const insertRun = `INSERT INTO journey_metric_alert_evaluation_runs
    (id,space_id,journey_definition_id,as_of,state,evaluated_count,triggered_count,warning_count,resolved_count,
     error_code,idempotency_key,intent_sha256,requested_by_user_id,created_at,completed_at)
    VALUES ($1,$2,$3,$4,'evaluating',0,0,0,0,NULL,$5,$6,$7,$4,NULL)`;
  await left.query('BEGIN'); await right.query('BEGIN'); await right.query('SET LOCAL statement_timeout=5000');
  await left.query(insertRun, [`${proof}_run_left`, ids.spaceA, ids.journeyA, at, concurrentKey,
    hash('concurrent'), ids.owner]);
  let rightFinished = false;
  const competing = right.query(insertRun, [`${proof}_run_right`, ids.spaceA, ids.journeyA, at, concurrentKey,
    hash('concurrent'), ids.owner]).then(() => ({ ok: true })).catch((error) => ({ ok: false, error }))
    .finally(() => { rightFinished = true; });
  await delay(100); assert.equal(rightFinished, false);
  await left.query('COMMIT'); const outcome = await competing; await right.query('ROLLBACK');
  assert.equal(outcome.ok, false); assert.equal(outcome.error?.code, '23505');
  assert.equal(outcome.error?.constraint, 'journey_metric_alert_runs_idempotency');
  emit('journey_metric_alert_concurrent_idempotency_passed');
} finally {
  await Promise.all([left.query('ROLLBACK').catch(() => {}), right.query('ROLLBACK').catch(() => {})]);
  await Promise.all([owner.end().catch(() => {}), app.end().catch(() => {}),
    left.end().catch(() => {}), right.end().catch(() => {})]);
}

emit('journey_metric_alert_runtime_25_postgres_probe_passed', { database });
