#!/usr/bin/env node

/**
 * Runtime-22 proof for reviewed Journey AI suggestions. This runs only in the
 * disposable PostgreSQL E2E database and exercises tenant-composite foreign
 * keys, JSON-null add changes, immutable history, optimistic two-connection
 * conflict behaviour, and the owner-only salted maintenance purge.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'pg';

const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg22_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-22 suggestion probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-22 suggestion probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile), 'Owner password file is required.');
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile), 'Application password file is required.');

const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const appPassword = fs.readFileSync(appPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const configuration = (user, password, name) => ({ host, port, database, user, password, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(configuration(ownerUser, ownerPassword, 'journey-ai-runtime22-owner'));
const left = new Client(configuration(ownerUser, ownerPassword, 'journey-ai-runtime22-left'));
const right = new Client(configuration(ownerUser, ownerPassword, 'journey-ai-runtime22-right'));
const app = new Client(configuration(appUser, appPassword, 'journey-ai-runtime22-app'));

const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const definitionA = `${proof}_definition_a`;
const definitionB = `${proof}_definition_b`;
const versionA = `${proof}_version_a`;
const versionB = `${proof}_version_b`;
const jobA = `${proof}_job_a`;
const jobB = `${proof}_job_b`;
const runId = `${proof}_run`;
const conflictRunId = `${proof}_conflict_run`;
const changeId = `${proof}_add_change`;
const digest = crypto.createHash('sha256').update(proof).digest('hex');
const crossSpaceDigest = crypto.createHash('sha256').update(`${proof}:cross-space-change`).digest('hex');
const seededAt = '2026-08-04T12:00:00.000Z';
const receiptSecret = crypto.randomBytes(48).toString('base64url');

function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

const insertRun = `INSERT INTO journey_ai_suggestion_runs
  (id,space_id,definition_id,base_version_id,base_definition_revision,base_map_checksum,requested_by_user_id,
   ai_job_id,state,focus,prompt_contract_version,change_schema_version,selected_evidence_checksum,
   selected_evidence_count,revision,created_at,updated_at)
  VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,'Reduce effort','journey-suggestion-review-v1',1,$5,0,1,$9,$9)`;

let connected = false;
try {
  await Promise.all([owner.connect(), left.connect(), right.connect(), app.connect()]);
  connected = true;
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'Runtime 22 suggestion proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  for (const [spaceId, slug] of [[spaceA, `${proof}-a`], [spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 22 suggestion proof',$2,$3,NULL,$4,$4)`, [spaceId, slug, userId, seededAt]);
  }
  for (const [definitionId, versionId, spaceId] of [
    [definitionA, versionA, spaceA], [definitionB, versionB, spaceB]
  ]) {
    await owner.query(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
       revision,created_at,updated_at)
      VALUES ($1,$2,'Runtime 22 suggestion proof','Review proof','customer','current_state','designed','draft',$3,NULL,1,$4,$4)`,
    [definitionId, spaceId, userId, seededAt]);
    await owner.query(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,state,author_user_id,created_at)
      VALUES ($1,$2,$3,1,'draft',$4,$5)`, [versionId, definitionId, spaceId, userId, seededAt]);
    await owner.query('UPDATE journey_definitions SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
      [versionId, definitionId, spaceId]);
  }
  for (const [jobId, spaceId] of [[jobA, spaceA], [jobB, spaceB]]) {
    await owner.query(`INSERT INTO ai_jobs
      (id,kind,space_id,requested_by,state,stage,progress,attempt,input_json,created_at,updated_at)
      VALUES ($1,'journey.optimize',$2,$3,'failed','failed',100,1,'{}',$4,$4)`,
    [jobId, spaceId, userId, seededAt]);
  }
  await owner.query(insertRun, [runId, spaceA, definitionA, versionA, digest, userId, jobA, 'failed', seededAt]);
  await owner.query(insertRun,
    [conflictRunId, spaceA, definitionA, versionA, digest, userId, jobA, 'ready_to_apply', seededAt]);
  await owner.query(`INSERT INTO journey_ai_suggestion_changes
    (id,run_id,space_id,ordinal,operation,target_type,target_ref,before_json,after_json,rationale,
     evidence_refs_json,warning_codes_json,change_checksum,created_at)
    VALUES ($1,$2,$3,0,'card.add','card',$4,'null',$5,$6,'[]','["unsupported"]',$7,$8)`,
  [changeId, runId, spaceA, `${proof}_new_card`, JSON.stringify({ title: 'Proposed step', content: 'A reviewed addition.' }),
    'Proposes one bounded addition for explicit review.', digest, seededAt]);
  await owner.query('COMMIT');

  const addChange = await owner.query('SELECT before_json,operation FROM journey_ai_suggestion_changes WHERE id=$1', [changeId]);
  assert.equal(addChange.rows[0].before_json, null);
  assert.equal(addChange.rows[0].operation, 'card.add');
  emit('journey_ai_json_null_add_change_passed');

  await assert.rejects(owner.query(insertRun,
    [`${proof}_cross_definition`, spaceB, definitionA, versionA, digest, userId, jobB, 'failed', seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_ai_suggestion_runs_definition_tenant_fk');
  await assert.rejects(owner.query(insertRun,
    [`${proof}_cross_job`, spaceA, definitionA, versionA, digest, userId, jobB, 'failed', seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_ai_suggestion_runs_job_tenant_fk');
  await assert.rejects(owner.query(`UPDATE journey_ai_suggestion_runs SET applied_version_id=$1
    WHERE id=$2 AND space_id=$3`, [versionB, runId, spaceA]),
  (error) => error?.code === '23503'
    && error?.constraint === 'journey_ai_suggestion_runs_applied_version_tenant_fk');
  await assert.rejects(owner.query(`INSERT INTO journey_ai_suggestion_changes
    (id,run_id,space_id,ordinal,operation,target_type,target_ref,before_json,after_json,rationale,
     evidence_refs_json,warning_codes_json,change_checksum,created_at)
    VALUES ($1,$2,$3,1,'stage.update','stage','cross-space','{}','{}',$4,'[]','[]',$5,$6)`,
  [`${proof}_cross_change`, runId, spaceB, 'Cross-space child rows must be rejected by the tenant key.',
    crossSpaceDigest, seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_ai_suggestion_changes_run_tenant_fk');
  emit('journey_ai_tenant_composite_foreign_keys_passed');

  await assert.rejects(owner.query('UPDATE journey_ai_suggestion_changes SET rationale=rationale WHERE id=$1', [changeId]),
    (error) => error?.code === '55000');
  await app.query("SELECT set_config('seemplify.journey_ai_audit_maintenance','privacy-purge',false)");
  await app.query("SELECT set_config('seemplify.journey_ai_audit_receipt_secret',$1,false)", [receiptSecret]);
  await assert.rejects(app.query('DELETE FROM journey_ai_suggestion_changes WHERE id=$1', [changeId]),
    (error) => error?.code === '42501');
  await assert.rejects(app.query(
    'SELECT journey_ai_suggestion_controlled_purge($1,NULL,$2,$3)', [spaceA, 'privacy_erasure', `${proof}-ticket`]),
  (error) => error?.code === '42501');
  emit('journey_ai_runtime_cannot_spoof_maintenance_passed');

  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM journey_ai_suggestion_runs WHERE id=$1 AND space_id=$2 FOR UPDATE',
    [conflictRunId, spaceA]);
  let rightFinished = false;
  const competingApply = right.query(`UPDATE journey_ai_suggestion_runs SET state='applied',revision=revision+1
    WHERE id=$1 AND space_id=$2 AND state='ready_to_apply' AND revision=1`, [conflictRunId, spaceA])
    .then((result) => { rightFinished = true; return result; });
  await delay(100);
  assert.equal(rightFinished, false, 'The competing apply must wait for the locked suggestion run.');
  await left.query(`UPDATE journey_ai_suggestion_runs SET state='applied',revision=revision+1
    WHERE id=$1 AND space_id=$2 AND state='ready_to_apply' AND revision=1`, [conflictRunId, spaceA]);
  await left.query('COMMIT');
  const losingApply = await competingApply;
  await right.query('COMMIT');
  assert.equal(losingApply.rowCount, 0, 'The losing apply must observe a stable optimistic conflict.');
  emit('journey_ai_two_connection_apply_conflict_passed');

  await assert.rejects(owner.query(
    'SELECT journey_ai_suggestion_controlled_purge($1,NULL,$2,$3)', [spaceA, 'privacy_erasure', `${proof}-ticket`]),
  (error) => error?.code === '55000');
  await owner.query("SELECT set_config('seemplify.journey_ai_audit_receipt_secret',$1,false)", [receiptSecret]);
  const purge = await owner.query('SELECT journey_ai_suggestion_controlled_purge($1,NULL,$2,$3) receipt_id',
    [spaceA, 'privacy_erasure', `${proof}-ticket`]);
  const receiptId = String(purge.rows[0].receipt_id);
  assert.match(receiptId, /^[a-f0-9]{64}$/u);
  const receipt = (await owner.query(`SELECT space_hash,definition_hash,change_ticket_hash,deleted_counts_json
    FROM journey_ai_suggestion_purge_receipts WHERE id=$1`, [receiptId])).rows[0];
  const unsaltedSpaceHash = crypto.createHash('md5').update(`space:${spaceA}`).digest('hex')
    + crypto.createHash('md5').update(`${spaceA}:space`).digest('hex');
  assert.notEqual(receipt.space_hash, unsaltedSpaceHash);
  assert.equal(receipt.definition_hash, null);
  assert.equal(Number(receipt.deleted_counts_json.runs), 2);
  assert.equal(Number((await owner.query('SELECT COUNT(*)::int count FROM journey_ai_suggestion_runs WHERE space_id=$1',
    [spaceA])).rows[0].count), 0);
  await assert.rejects(owner.query('UPDATE journey_ai_suggestion_purge_receipts SET reason_code=reason_code WHERE id=$1',
    [receiptId]), (error) => error?.code === '55000');
  emit('journey_ai_keyed_controlled_purge_passed');
} finally {
  if (connected) {
    await Promise.all([left.query('ROLLBACK').catch(() => {}), right.query('ROLLBACK').catch(() => {})]);
    await owner.query('DELETE FROM ai_jobs WHERE id=$1', [jobB]).catch(() => {});
    await owner.query('DELETE FROM spaces WHERE id=ANY($1::text[])', [[spaceA, spaceB]]).catch(() => {});
    await owner.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
  }
  await Promise.all([owner.end().catch(() => {}), left.end().catch(() => {}),
    right.end().catch(() => {}), app.end().catch(() => {})]);
}

emit('journey_ai_suggestion_runtime_22_postgres_probe_passed', { database });
