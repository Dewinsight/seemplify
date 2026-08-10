#!/usr/bin/env node

/** Runtime-28 proof for journey collaboration. This probe only writes to the
 * disposable PostgreSQL E2E database.
 *
 * Its load-bearing case is member offboarding. Five composite foreign keys used
 * to bind durable attribution (comment author, version editor, review
 * requester, view owner, share creator) to current space_memberships, so once a
 * member had collaborated at all, the DELETE FROM space_memberships in
 * spaces.ts removeSpaceMember raised 23503 and the member could not be removed.
 * Only an executed database can show both halves of the fix: that the removal
 * now succeeds, and that every attributed row survives it unchanged. */
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
const runtimeVersion = Number(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION || 0);
const proof = `pg28_collab_${crypto.randomBytes(6).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-28 collaboration probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
// {12}, not +: the harness names its disposable database with exactly twelve hex
// characters (test-postgres-e2e.mjs). An open-ended suffix would also accept a
// hand-named long-lived database that merely starts the same way.
assert.match(database, /^experience_e2e_[a-f0-9]{12}$/u,
  'The runtime-28 collaboration probe refuses every non-disposable database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));
assert.ok(Number.isInteger(runtimeVersion) && runtimeVersion >= 28,
  'The collaboration probe requires the configured current runtime schema version.');

const password = (filename) => fs.readFileSync(filename, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (user, credential, name) => ({ host, port, database, user, password: credential, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-collaboration-runtime28-owner'));
const app = new Client(connection(appUser, password(appPasswordFile), 'journey-collaboration-runtime28-app'));
const left = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-collaboration-runtime28-left'));
const right = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-collaboration-runtime28-right'));
const at = '2026-08-05T16:00:00.000Z';
const later = '2026-08-05T17:00:00.000Z';
const expiry = '2026-08-20T16:00:00.000Z';
const hash = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ids = {
  owner: `${proof}_owner`, leaver: `${proof}_leaver`, outsider: `${proof}_outsider`,
  spaceA: `${proof}_space_a`, spaceB: `${proof}_space_b`,
  definitionA: `${proof}_definition_a`, definitionB: `${proof}_definition_b`,
  comment: `${proof}_comment`, commentV1: `${proof}_comment_v1`, commentV2: `${proof}_comment_v2`,
  review: `${proof}_review`, view: `${proof}_view`, share: `${proof}_share`
};

const commentBody = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', text: 'Executed proof', marks: [] }] });
const insertComment = `INSERT INTO journey_comments
  (id,space_id,target_type,target_id,journey_definition_id,parent_comment_id,root_comment_id,author_user_id,
   state,revision,current_version_id,created_at)
  VALUES ($1,$2,'journey_map',$3,$3,NULL,$1,$4,'active',$5,$6,$7)`;
const insertVersion = `INSERT INTO journey_comment_versions
  (id,comment_id,space_id,version_number,schema_version,body_json,plain_text,content_sha256,editor_user_id,
   edit_reason_sha256,created_at)
  VALUES ($1,$2,$3,$4,1,$5,'Executed proof',$6,$7,NULL,$8)`;

try {
  await Promise.all([owner.connect(), app.connect(), left.connect(), right.connect()]);
  const migration = await owner.query('SELECT version,checksum FROM experience_runtime_schema_version WHERE version=28');
  assert.equal(migration.rowCount, 1);
  assert.match(String(migration.rows[0].checksum), /^[a-f0-9]{64}$/u);
  // Migration 28 owns this capability, but the disposable database may have
  // later forward-only repairs. Validate the schema that is actually running;
  // pretending a runtime-34 database is runtime 28 would incorrectly require
  // historical foreign keys intentionally replaced by later migrations.
  await assertRuntimeSchemaContract((sql) => owner.query(sql), { runtimeVersion });
  await assertRuntimePrivileges((sql) => owner.query(sql), appUser, { runtimeVersion });
  emit('journey_collaboration_runtime_contract_passed');

  for (const [id, email, name] of [[ids.owner, `${proof}-owner@example.invalid`, 'Collaboration owner'],
    [ids.leaver, `${proof}-leaver@example.invalid`, 'Departing collaborator'],
    [ids.outsider, `${proof}-outsider@example.invalid`, 'Collaboration outsider']]) {
    await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
      VALUES ($1,$2,$3,'not-a-login','member',1,$4,$4)`, [id, email, name, at]);
  }
  for (const [spaceId, slug, definitionId] of [[ids.spaceA, `${proof}-a`, ids.definitionA],
    [ids.spaceB, `${proof}-b`, ids.definitionB]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 28 collaboration',$2,$3,NULL,$4,$4)`, [spaceId, slug, ids.owner, at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,'owner',$3,$3)`, [spaceId, ids.owner, at]);
    await owner.query(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
       published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES ($1,$2,'Collaboration proof','Executed tenancy','customer','current_state','designed','draft',$3,
        NULL,NULL,30,1,$4,$4)`, [definitionId, spaceId, ids.owner, at]);
    await owner.query(`INSERT INTO journey_collaboration_settings
      (space_id,enabled,comments_enabled,sharing_enabled,external_downloads_enabled,comment_retention_days,
       view_retention_days,maximum_share_days,revision,updated_by_user_id,created_at,updated_at)
      VALUES ($1,TRUE,TRUE,FALSE,FALSE,30,30,30,1,$2,$3,$3)`, [spaceId, ids.owner, at]);
  }
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceA, ids.leaver, at]);
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceB, ids.outsider, at]);

  // Tenancy at write time. The membership guard replaced a live composite
  // foreign key, so it has to refuse exactly what that edge refused: an author
  // who is not a member of the space the comment belongs to.
  await assert.rejects((async () => {
    await owner.query('BEGIN');
    await owner.query(insertComment, [`${proof}_foreign_author`, ids.spaceA, ids.definitionA, ids.outsider, 1,
      `${proof}_foreign_author_v1`, at]);
    await owner.query(insertVersion, [`${proof}_foreign_author_v1`, `${proof}_foreign_author`, ids.spaceA, 1,
      commentBody, hash('foreign'), ids.outsider, at]);
    await owner.query('COMMIT');
  })(), (error) => error?.code === '23503');
  await owner.query('ROLLBACK').catch(() => {});
  // And the target guard must still refuse a journey from another tenant.
  await assert.rejects((async () => {
    await owner.query('BEGIN');
    await owner.query(insertComment, [`${proof}_foreign_target`, ids.spaceA, ids.definitionB, ids.owner, 1,
      `${proof}_foreign_target_v1`, at]);
    await owner.query('COMMIT');
  })(), (error) => error?.code === '23503');
  await owner.query('ROLLBACK').catch(() => {});
  emit('journey_collaboration_tenant_and_membership_guards_passed');

  // A departing member's full collaboration footprint.
  await owner.query('BEGIN');
  await owner.query(insertComment, [ids.comment, ids.spaceA, ids.definitionA, ids.leaver, 1, ids.commentV1, at]);
  await owner.query(insertVersion, [ids.commentV1, ids.comment, ids.spaceA, 1, commentBody, hash('v1'), ids.leaver, at]);
  await owner.query('COMMIT');
  await owner.query('BEGIN');
  await owner.query(insertVersion, [ids.commentV2, ids.comment, ids.spaceA, 2, commentBody, hash('v2'), ids.leaver, later]);
  await owner.query(`UPDATE journey_comments SET revision=2,current_version_id=$1,edited_at=$2
    WHERE id=$3 AND space_id=$4`, [ids.commentV2, later, ids.comment, ids.spaceA]);
  await owner.query('COMMIT');
  const revisions = await owner.query(`SELECT version_number,editor_user_id FROM journey_comment_versions
    WHERE comment_id=$1 ORDER BY version_number`, [ids.comment]);
  assert.deepEqual(revisions.rows.map((row) => [Number(row.version_number), row.editor_user_id]),
    [[1, ids.leaver], [2, ids.leaver]]);
  await assert.rejects(owner.query(insertVersion,
    [`${proof}_duplicate_v2`, ids.comment, ids.spaceA, 2, commentBody, hash('dup'), ids.leaver, later]),
  (error) => error?.code === '23505');
  emit('journey_collaboration_comment_revision_sequence_passed');

  await owner.query(`INSERT INTO journey_governance_reviews
    (id,space_id,target_type,target_id,journey_definition_id,target_revision,target_sha256,state,revision,
     requested_by_user_id,request_summary,request_reason_sha256,requested_at)
    VALUES ($1,$2,'journey_map',$3,$3,1,$4,'pending',1,$5,'Executed governance proof',$6,$7)`,
  [ids.review, ids.spaceA, ids.definitionA, hash('target'), ids.leaver, hash('reason'), at]);
  await owner.query(`INSERT INTO journey_collaboration_views
    (id,space_id,resource_type,resource_id,name,audience,visibility,owner_user_id,schema_version,
     configuration_json,configuration_sha256,state,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'journey_map',$3,'Leaver view','internal','space',$4,1,'{}',$5,'active',1,$4,$4,$6,$6)`,
  [ids.view, ids.spaceA, ids.definitionA, ids.leaver, hash('view'), at]);
  await owner.query(`INSERT INTO journey_read_only_shares
    (id,space_id,target_type,target_id,target_revision,token_hash,token_prefix,token_version,permission,
     allow_export,allow_download,snapshot_json,snapshot_sha256,state,revision,created_by_user_id,created_at,expires_at)
    VALUES ($1,$2,'journey_map',$3,1,$4,'abcd1234',1,'view',FALSE,FALSE,'{}',$5,'active',1,$6,$7,$8)`,
  [ids.share, ids.spaceA, ids.definitionA, hash('token'), hash('snapshot'), ids.leaver, at, expiry]);
  // Durable, parentless audit: exactly what must outlive the membership.
  await owner.query(`INSERT INTO journey_collaboration_activity
    (id,space_id,actor_user_id,action,target_type,target_id,journey_definition_id,comment_id,review_id,detail_json,created_at)
    VALUES ($1,$2,$3,'comment.created','journey_map',$4,$4,$5,$6,'{}',$7)`,
  [`${proof}_activity`, ids.spaceA, ids.leaver, ids.definitionA, ids.comment, ids.review, at]);
  await owner.query(`INSERT INTO journey_collaboration_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,request_id,detail_json,created_at)
    VALUES ($1,$2,$3,'comment.created','journey_map',$4,NULL,'{}',$5)`,
  [`${proof}_audit`, ids.spaceA, ids.leaver, ids.definitionA, at]);

  // THE REGRESSION. Before the fix each of these five rows independently made
  // this statement fail with 23503 and no application code caught it.
  await owner.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2', [ids.spaceA, ids.leaver]);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM space_memberships
    WHERE space_id=$1 AND user_id=$2`, [ids.spaceA, ids.leaver])).rows[0].count), 0,
  'the departing member must actually be gone');
  // Attribution survives the removal, unchanged and still resolvable.
  const surviving = await owner.query(`SELECT
      (SELECT author_user_id FROM journey_comments WHERE id=$1) comment_author,
      (SELECT COUNT(*)::int FROM journey_comment_versions WHERE comment_id=$1 AND editor_user_id=$2) versions,
      (SELECT requested_by_user_id FROM journey_governance_reviews WHERE id=$3) review_requester,
      (SELECT owner_user_id FROM journey_collaboration_views WHERE id=$4) view_owner,
      (SELECT created_by_user_id FROM journey_read_only_shares WHERE id=$5) share_creator,
      (SELECT actor_user_id FROM journey_collaboration_activity WHERE id=$6) activity_actor,
      (SELECT actor_user_id FROM journey_collaboration_audit_events WHERE id=$7) audit_actor`,
  [ids.comment, ids.leaver, ids.review, ids.view, ids.share, `${proof}_activity`, `${proof}_audit`]);
  assert.deepEqual(surviving.rows[0], {
    comment_author: ids.leaver, versions: 2, review_requester: ids.leaver, view_owner: ids.leaver,
    share_creator: ids.leaver, activity_actor: ids.leaver, audit_actor: ids.leaver
  }, 'offboarding must not erase or rewrite a single attributed row');
  // The user row itself is still protected, so attribution stays resolvable.
  await assert.rejects(owner.query('DELETE FROM users WHERE id=$1', [ids.leaver]),
    (error) => error?.code === '23503');
  // A former member cannot start collaborating again without rejoining.
  await assert.rejects((async () => {
    await owner.query('BEGIN');
    await owner.query(insertComment, [`${proof}_after_leaving`, ids.spaceA, ids.definitionA, ids.leaver, 1,
      `${proof}_after_leaving_v1`, later]);
    await owner.query(insertVersion, [`${proof}_after_leaving_v1`, `${proof}_after_leaving`, ids.spaceA, 1,
      commentBody, hash('after'), ids.leaver, later]);
    await owner.query('COMMIT');
  })(), (error) => error?.code === '23503');
  await owner.query('ROLLBACK').catch(() => {});
  emit('journey_collaboration_member_offboarding_passed');

  // Redaction: a deleted comment keeps its authorship and its versions; only
  // its lifecycle columns move, and the seal still refuses a rewrite.
  await owner.query(`UPDATE journey_comments SET state='deleted',deleted_at=$1,retention_expires_at=$2
    WHERE id=$3 AND space_id=$4`, [later, expiry, ids.comment, ids.spaceA]);
  const redacted = (await owner.query(`SELECT state,author_user_id,retention_expires_at FROM journey_comments
    WHERE id=$1`, [ids.comment])).rows[0];
  assert.equal(redacted.state, 'deleted');
  assert.equal(redacted.author_user_id, ids.leaver);
  assert.ok(redacted.retention_expires_at);
  // Every negative below is scoped to this probe's own tenant. PostgreSQL checks
  // privileges before it touches a row, so an unscoped statement would pass the
  // same assertion today -- but if a REVOKE were ever dropped, the unscoped form
  // would empty the table before failing the assertion that was meant to catch it.
  for (const table of ['journey_comment_versions', 'journey_collaboration_activity',
    'journey_collaboration_audit_events']) {
    await assert.rejects(owner.query(`UPDATE ${table} SET created_at=created_at WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '55000');
    await assert.rejects(app.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
  }
  // The two ledgers are sealed against DELETE for the owner as well, which is
  // what makes this probe's fixture space undeletable (see the cleanup block).
  for (const table of ['journey_collaboration_activity', 'journey_collaboration_audit_events']) {
    await assert.rejects(owner.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '55000');
  }
  await assert.rejects(app.query('DELETE FROM journey_comments WHERE space_id=$1', [ids.spaceA]),
    (error) => error?.code === '42501');
  emit('journey_collaboration_redaction_and_append_only_passed');

  // Replay: the operation receipt is unique per (space, actor, key), and a
  // concurrent same-key request can only observe it after the first commits.
  const replayKey = `replay-${proof}`;
  const replayIntent = hash('replay-intent');
  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE',
    [ids.spaceA, ids.owner]);
  let rightFinished = false;
  const rightLock = right.query('SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE',
    [ids.spaceA, ids.owner]).finally(() => { rightFinished = true; });
  await delay(100);
  assert.equal(rightFinished, false);
  await left.query(`INSERT INTO journey_collaboration_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'comment.create',$5,'{"replayed":false}',$6)`,
  [`${proof}_operation`, ids.spaceA, ids.owner, replayKey, replayIntent, at]);
  await left.query('COMMIT');
  await rightLock;
  const receipt = await right.query(`SELECT intent_sha256,response_json FROM journey_collaboration_operations
    WHERE space_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`, [ids.spaceA, ids.owner, replayKey]);
  assert.equal(receipt.rowCount, 1);
  assert.equal(receipt.rows[0].intent_sha256, replayIntent);
  await right.query('ROLLBACK');
  await assert.rejects(owner.query(`INSERT INTO journey_collaboration_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'comment.create',$5,'{}',$6)`,
  [`${proof}_operation_duplicate`, ids.spaceA, ids.owner, replayKey, replayIntent, at]),
  (error) => error?.code === '23505');
  emit('journey_collaboration_two_connection_replay_lock_passed');
} finally {
  await Promise.allSettled([owner.query('ROLLBACK'), left.query('ROLLBACK'), right.query('ROLLBACK')]);
  // Deterministic teardown in dependency order, scoped by exact space id rather
  // than a LIKE pattern (the proof prefix contains '_', which LIKE treats as a
  // single-character wildcard). Failures are reported, not swallowed.
  const failures = [];
  for (const spaceId of [ids.spaceA, ids.spaceB]) {
    for (const statement of [
      'DELETE FROM journey_read_only_shares WHERE space_id=$1',
      'DELETE FROM journey_collaboration_views WHERE space_id=$1',
      'DELETE FROM journey_governance_reviews WHERE space_id=$1',
      'DELETE FROM journey_comments WHERE space_id=$1',
      'DELETE FROM journey_collaboration_settings WHERE space_id=$1',
      'DELETE FROM journey_definitions WHERE space_id=$1',
      'DELETE FROM space_memberships WHERE space_id=$1'
    ]) {
      const result = await owner.query(statement, [spaceId]).then(() => null, (error) => error);
      if (result) failures.push(`${statement} [${spaceId}]: ${result.code || ''} ${result.message}`);
    }
  }
  // spaces and users are deliberately retained, and the three ledgers with them.
  // journey_collaboration_operations/_activity/_audit_events all cascade from
  // spaces(id) and their seals cover DELETE, so DELETE FROM spaces raises 55000;
  // users cannot go either, because the ON DELETE SET NULL on actor_user_id is an
  // UPDATE the same seal refuses. There is no ordering that removes the fixture
  // without erasing an append-only ledger -- the earlier version of this block
  // only appeared to work because every statement was wrapped in
  // .catch(() => {}). The disposable database is dropped by the harness; what
  // matters is that the residue is exactly the sealed ledgers and nothing else.
  const residueTables = ['journey_read_only_shares', 'journey_collaboration_views',
    'journey_governance_reviews', 'journey_comment_versions', 'journey_comments',
    'journey_collaboration_settings', 'journey_definitions'];
  const sealed = await owner.query(`SELECT
      (SELECT COUNT(*)::int FROM journey_collaboration_operations WHERE space_id IN ($1,$2)) operations,
      (SELECT COUNT(*)::int FROM journey_collaboration_activity WHERE space_id IN ($1,$2)) activity,
      (SELECT COUNT(*)::int FROM journey_collaboration_audit_events WHERE space_id IN ($1,$2)) audit_events`,
  [ids.spaceA, ids.spaceB])
    .then((result) => result.rows[0], (error) => { failures.push(`sealed count: ${error.message}`); return null; });
  const residue = await owner.query(`SELECT ${residueTables
    .map((table, index) => `(SELECT COUNT(*)::int FROM ${table} WHERE space_id IN ($1,$2)) t${index}`)
    .join(',')}`, [ids.spaceA, ids.spaceB])
    .then((result) => Object.values(result.rows[0]).reduce((total, value) => total + Number(value), 0),
      (error) => { failures.push(`residue count: ${error.message}`); return -1; });
  emit('journey_collaboration_cleanup_complete', { deletableResidue: residue, sealedRetained: sealed, failures });
  await Promise.allSettled([owner.end(), app.end(), left.end(), right.end()]);
  assert.deepEqual(failures, [], 'runtime-28 teardown must not fail silently');
  assert.equal(residue, 0, 'runtime-28 teardown must leave no deletable fixture row behind');
}
