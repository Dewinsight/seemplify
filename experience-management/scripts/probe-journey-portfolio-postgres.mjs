#!/usr/bin/env node

/** Runtime-34 proof for the governed journey portfolio. This probe only writes
 * to the disposable PostgreSQL E2E database and exercises the invariants the
 * static migration test cannot reach: tenant-bound quota admission under a real
 * row lock, the default-scoring-policy tenant edge, the deferred
 * current-version integrity trigger, governed review state, and append-only
 * history against both the owner and the least-privileged application role. */
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
const proof = `pg27_portfolio_${crypto.randomBytes(6).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-27 portfolio probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
// {12}, not +: the harness names its disposable database with exactly twelve hex
// characters (test-postgres-e2e.mjs). An open-ended suffix would also accept a
// hand-named long-lived database that merely starts the same way.
assert.match(database, /^experience_e2e_[a-f0-9]{12}$/u,
  'The runtime-27 portfolio probe refuses every non-disposable database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const password = (filename) => fs.readFileSync(filename, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (user, credential, name) => ({ host, port, database, user, password: credential, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-portfolio-runtime27-owner'));
const app = new Client(connection(appUser, password(appPasswordFile), 'journey-portfolio-runtime27-app'));
const left = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-portfolio-runtime27-left'));
const right = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-portfolio-runtime27-right'));
const at = '2026-08-05T16:00:00.000Z';
const hash = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ids = {
  owner: `${proof}_owner`, outsider: `${proof}_outsider`, leaver: `${proof}_leaver`,
  spaceA: `${proof}_space_a`, spaceB: `${proof}_space_b`,
  itemA: `${proof}_item_a`, itemQuota: `${proof}_item_quota`,
  policyA: `${proof}_policy_a`, policyB: `${proof}_policy_b`,
  policyVersionA: `${proof}_policy_version_a`, policyVersionB: `${proof}_policy_version_b`
};

const insertItem = `INSERT INTO journey_portfolio_items
  (id,space_id,kind,title,description,lifecycle,owner_user_id,expected_outcome,priority,risk,
   progress_percent,state,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
  VALUES ($1,$2,'initiative',$3,'Runtime 27 executed proof','planned',$4,'Measured outcome','high','low',
    0,'active',1,$4,$4,$5,$5)`;

try {
  await Promise.all([owner.connect(), app.connect(), left.connect(), right.connect()]);
  const migration = await owner.query('SELECT version,checksum FROM experience_runtime_schema_version WHERE version=34');
  assert.equal(migration.rowCount, 1);
  assert.match(String(migration.rows[0].checksum), /^[a-f0-9]{64}$/u);
  await assertRuntimeSchemaContract((sql) => owner.query(sql), { runtimeVersion: 34 });
  await assertRuntimePrivileges((sql) => owner.query(sql), appUser, { runtimeVersion: 34 });
  emit('journey_portfolio_runtime_contract_passed');

  for (const [id, email, name] of [[ids.owner, `${proof}-owner@example.invalid`, 'Portfolio owner'],
    [ids.outsider, `${proof}-outsider@example.invalid`, 'Portfolio outsider'],
    [ids.leaver, `${proof}-leaver@example.invalid`, 'Departing item owner']]) {
    await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
      VALUES ($1,$2,$3,'not-a-login','member',1,$4,$4)`, [id, email, name, at]);
  }
  for (const [spaceId, slug] of [[ids.spaceA, `${proof}-a`], [ids.spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 27 portfolio',$2,$3,NULL,$4,$4)`, [spaceId, slug, ids.owner, at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,'owner',$3,$3)`, [spaceId, ids.owner, at]);
    await owner.query(`INSERT INTO journey_portfolio_settings
      (space_id,enabled,retention_days,approval_required,default_scoring_policy_id,revision,
       updated_by_user_id,created_at,updated_at)
      VALUES ($1,TRUE,30,TRUE,NULL,1,$2,$3,$3)`, [spaceId, ids.owner, at]);
  }
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceB, ids.outsider, at]);
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceA, ids.leaver, at]);

  // Tenancy: an owner who is not a member of the space cannot hold an item.
  await owner.query(insertItem, [ids.itemA, ids.spaceA, 'Same-tenant initiative', ids.owner, at]);
  await assert.rejects(owner.query(insertItem, [`${proof}_cross`, ids.spaceA, 'Cross-tenant owner', ids.outsider, at]),
    (error) => error?.code === '23503' && /not a member of space/u.test(String(error?.message)));
  emit('journey_portfolio_tenant_owner_guard_passed');

  await owner.query(`UPDATE journey_portfolio_items SET owner_user_id=$1,updated_by_user_id=$1,updated_at=$2
    WHERE id=$3 AND space_id=$4`, [ids.leaver, at, ids.itemA, ids.spaceA]);
  await owner.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2', [ids.spaceA, ids.leaver]);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM space_memberships
    WHERE space_id=$1 AND user_id=$2`, [ids.spaceA, ids.leaver])).rows[0].count), 0);
  assert.equal((await owner.query(`SELECT owner_user_id FROM journey_portfolio_items
    WHERE id=$1 AND space_id=$2`, [ids.itemA, ids.spaceA])).rows[0].owner_user_id, ids.leaver);
  emit('journey_portfolio_owner_offboarding_passed');

  // The policy root and its first immutable version reference each other, so the
  // integrity rule can only be a commit-time invariant. The pointer is set
  // INLINE in the INSERT and the deferred foreign key carries the forward
  // reference until the version lands, exactly as runtime 23 does for personas
  // (journeyMaps.ts, probe-journey-personas-postgres.mjs).
  //
  // This is not interchangeable with insert-NULL-then-patch: see the executed
  // negative below. A deferred AFTER ROW constraint trigger is queued against
  // the tuple version its own statement produced, so a later UPDATE in the same
  // transaction queues a SECOND event and does not revise the first. The INSERT
  // event still presents current_version_id = NULL at COMMIT.
  const insertPolicy = `INSERT INTO journey_portfolio_scoring_policies
    (id,space_id,name,method,state,revision,current_version_id,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'Reviewed policy',$3,'active',1,$4,$5,$5,$6,$6)`;
  const insertPolicyVersion = `INSERT INTO journey_portfolio_scoring_policy_versions
    (id,policy_id,space_id,version_number,method,formula_version,configuration_json,configuration_sha256,
     actor_user_id,created_at)
    VALUES ($1,$2,$3,1,$4,'v1','{}',$5,$6,$7)`;
  for (const [policyId, versionId, spaceId] of [[ids.policyA, ids.policyVersionA, ids.spaceA],
    [ids.policyB, ids.policyVersionB, ids.spaceB]]) {
    await owner.query('BEGIN');
    await owner.query(insertPolicy, [policyId, spaceId, 'rice', versionId, ids.owner, at]);
    await owner.query(insertPolicyVersion, [versionId, policyId, spaceId, 'rice', hash(versionId), ids.owner, at]);
    await owner.query('COMMIT');
  }
  emit('journey_portfolio_policy_inline_creation_passed');
  // A policy that never gains a current version must not be able to commit.
  await owner.query('BEGIN');
  await owner.query(insertPolicy, [`${proof}_dangling_policy`, ids.spaceA, 'rice', null, ids.owner, at]);
  await assert.rejects(owner.query('COMMIT'), (error) => error?.code === '23502');
  await owner.query('ROLLBACK');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_portfolio_scoring_policies
    WHERE id=$1`, [`${proof}_dangling_policy`])).rows[0].count), 0);
  // Nor may a policy whose method disagrees with the version it points at.
  await owner.query('BEGIN');
  await owner.query(insertPolicy, [`${proof}_mismatch_policy`, ids.spaceA, 'ice',
    `${proof}_mismatch_version`, ids.owner, at]);
  await owner.query(insertPolicyVersion, [`${proof}_mismatch_version`, `${proof}_mismatch_policy`, ids.spaceA,
    'rice', hash('mismatch'), ids.owner, at]);
  await assert.rejects(owner.query('COMMIT'), (error) => error?.code === '23514');
  await owner.query('ROLLBACK');

  emit('journey_portfolio_policy_current_version_invariant_passed');

  // Default policy is a governance control, so it must not be settable to
  // another tenant's policy.
  await owner.query('UPDATE journey_portfolio_settings SET default_scoring_policy_id=$1 WHERE space_id=$2',
    [ids.policyA, ids.spaceA]);
  await assert.rejects(owner.query('UPDATE journey_portfolio_settings SET default_scoring_policy_id=$1 WHERE space_id=$2',
    [ids.policyB, ids.spaceA]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_portfolio_settings_default_policy_fk');
  emit('journey_portfolio_default_policy_tenant_guard_passed');

  // Governed review history: a decision is durable and cannot be rewritten or
  // erased, by the owner role or the application role.
  await owner.query(`INSERT INTO journey_portfolio_item_versions
    (id,item_id,space_id,revision,schema_version,snapshot_json,snapshot_sha256,change_reason,actor_user_id,created_at)
    VALUES ($1,$2,$3,1,1,'{}',$4,'initial',$5,$6)`,
  [`${proof}_item_v1`, ids.itemA, ids.spaceA, hash('item-v1'), ids.owner, at]);
  await owner.query(`INSERT INTO journey_portfolio_reviews
    (id,space_id,item_id,item_revision,decision,note,actor_user_id,created_at)
    VALUES ($1,$2,$3,1,'approve','Reviewed for the executed probe',$4,$5)`,
  [`${proof}_review`, ids.spaceA, ids.itemA, ids.owner, at]);
  await owner.query(`INSERT INTO journey_portfolio_activity
    (id,space_id,actor_user_id,action,target_kind,target_id,target_revision,detail_json,created_at)
    VALUES ($1,$2,$3,'item.reviewed','portfolio_item',$4,1,'{}',$5)`,
  [`${proof}_activity`, ids.spaceA, ids.owner, ids.itemA, at]);
  // Every negative below is scoped to this probe's own tenant. PostgreSQL checks
  // privileges before it touches a row, so an unscoped statement would pass the
  // same assertion today -- but if a REVOKE were ever dropped, the unscoped form
  // would empty the table before failing the assertion that was meant to catch it.
  for (const table of ['journey_portfolio_item_versions', 'journey_portfolio_reviews', 'journey_portfolio_activity']) {
    await assert.rejects(owner.query(`UPDATE ${table} SET created_at=created_at WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '55000');
    await assert.rejects(app.query(`UPDATE ${table} SET created_at=created_at WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
    await assert.rejects(app.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
  }
  // journey_portfolio_activity is sealed against DELETE as well, so not even the
  // owner may erase it; that is what forces the retention sweep to be a soft one
  // and what makes this probe's fixture space undeletable (see the cleanup block).
  await assert.rejects(owner.query('DELETE FROM journey_portfolio_activity WHERE space_id=$1', [ids.spaceA]),
    (error) => error?.code === '55000');
  // The parent of that sealed history must not be erasable by the application
  // role either: its ON DELETE CASCADE would reach a BEFORE UPDATE-only seal.
  await assert.rejects(app.query('DELETE FROM journey_portfolio_items WHERE space_id=$1', [ids.spaceA]),
    (error) => error?.code === '42501');
  await assert.rejects(app.query('DELETE FROM journey_portfolio_settings WHERE space_id=$1', [ids.spaceA]),
    (error) => error?.code === '42501');
  emit('journey_portfolio_append_only_history_passed');

  // Quota admission protocol: both transactions serialize on the space row, so
  // the second admission observes the first committed count.
  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [ids.spaceB]);
  let rightFinished = false;
  const rightLock = right.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [ids.spaceB])
    .finally(() => { rightFinished = true; });
  await delay(100);
  assert.equal(rightFinished, false);
  await left.query(insertItem, [ids.itemQuota, ids.spaceB, 'Only admitted initiative', ids.owner, at]);
  await left.query('COMMIT');
  await rightLock;
  assert.equal(Number((await right.query(`SELECT COUNT(*)::int count FROM journey_portfolio_items
    WHERE space_id=$1 AND state='active'`, [ids.spaceB])).rows[0].count), 1);
  await right.query('ROLLBACK');
  emit('journey_portfolio_two_connection_quota_lock_passed');
} finally {
  // owner is rolled back too: the policy blocks above run inside BEGIN on this
  // connection, so a throw there would otherwise leave every teardown statement
  // failing with 25P02 in an aborted transaction.
  await Promise.allSettled([owner.query('ROLLBACK'), left.query('ROLLBACK'), right.query('ROLLBACK')]);
  // Deterministic teardown in dependency order, scoped by exact space id rather
  // than a LIKE pattern (the proof prefix contains '_', which LIKE treats as a
  // single-character wildcard). Failures are reported, not swallowed.
  const failures = [];
  for (const spaceId of [ids.spaceA, ids.spaceB]) {
    for (const statement of [
      'DELETE FROM journey_portfolio_reviews WHERE space_id=$1',
      'DELETE FROM journey_portfolio_item_versions WHERE space_id=$1',
      'DELETE FROM journey_portfolio_items WHERE space_id=$1',
      'UPDATE journey_portfolio_settings SET default_scoring_policy_id=NULL WHERE space_id=$1',
      'DELETE FROM journey_portfolio_scoring_policies WHERE space_id=$1',
      'DELETE FROM journey_portfolio_settings WHERE space_id=$1',
      'DELETE FROM space_memberships WHERE space_id=$1'
    ]) {
      const result = await owner.query(statement, [spaceId]).then(() => null, (error) => error);
      if (result) failures.push(`${statement} [${spaceId}]: ${result.code || ''} ${result.message}`);
    }
  }
  // spaces and users are deliberately retained, and journey_portfolio_activity
  // with them. That table cascades from spaces(id) and its seal covers DELETE,
  // so DELETE FROM spaces raises 55000; users cannot go either, because the
  // ON DELETE SET NULL on activity.actor_user_id is an UPDATE the same seal
  // refuses. There is no ordering that removes the fixture without erasing an
  // append-only ledger -- the earlier version of this block only appeared to
  // work because every statement was wrapped in .catch(() => {}). The disposable
  // database is dropped by the harness; what matters is that the residue is
  // exactly the sealed ledger and nothing else.
  const residueTables = ['journey_portfolio_reviews', 'journey_portfolio_item_versions',
    'journey_portfolio_items', 'journey_portfolio_scoring_policy_versions',
    'journey_portfolio_scoring_policies', 'journey_portfolio_settings'];
  const sealed = await owner.query(`SELECT COUNT(*)::int count FROM journey_portfolio_activity
    WHERE space_id IN ($1,$2)`, [ids.spaceA, ids.spaceB])
    .then((result) => Number(result.rows[0].count),
      (error) => { failures.push(`sealed count: ${error.message}`); return -1; });
  const residue = await owner.query(`SELECT ${residueTables
    .map((table, index) => `(SELECT COUNT(*)::int FROM ${table} WHERE space_id IN ($1,$2)) t${index}`)
    .join(',')}`, [ids.spaceA, ids.spaceB])
    .then((result) => Object.values(result.rows[0]).reduce((total, value) => total + Number(value), 0),
      (error) => { failures.push(`residue count: ${error.message}`); return -1; });
  emit('journey_portfolio_cleanup_complete', { deletableResidue: residue, sealedRetained: sealed, failures });
  await Promise.allSettled([owner.end(), app.end(), left.end(), right.end()]);
  assert.deepEqual(failures, [], 'runtime-27 teardown must not fail silently');
  assert.equal(residue, 0, 'runtime-27 teardown must leave no deletable fixture row behind');
}
