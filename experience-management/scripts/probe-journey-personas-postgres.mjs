#!/usr/bin/env node

/**
 * Runtime-23 proof for versioned journey personas. Runs only inside the
 * disposable PostgreSQL E2E database and exercises cyclic root/version
 * creation, tenant FKs, immutable history, pinned publication stability,
 * commit-time orphan denial, rollback/replay, least privilege, and a real
 * two-connection optimistic conflict.
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
const proof = `pg23_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-23 persona probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-23 persona probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const appPassword = fs.readFileSync(appPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const configuration = (user, password, name) => ({ host, port, database, user, password, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(configuration(ownerUser, ownerPassword, 'journey-persona-runtime23-owner'));
const left = new Client(configuration(ownerUser, ownerPassword, 'journey-persona-runtime23-left'));
const right = new Client(configuration(ownerUser, ownerPassword, 'journey-persona-runtime23-right'));
const app = new Client(configuration(appUser, appPassword, 'journey-persona-runtime23-app'));

const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const personaA = `${proof}_persona_a`;
const personaB = `${proof}_persona_b`;
const personaConflict = `${proof}_persona_conflict`;
const versionA1 = `${proof}_persona_a_v1`;
const versionA2 = `${proof}_persona_a_v2`;
const versionA3 = `${proof}_persona_a_v3`;
const versionB1 = `${proof}_persona_b_v1`;
const versionConflict1 = `${proof}_persona_conflict_v1`;
const definitionA = `${proof}_definition_a`;
const mapVersionA = `${proof}_map_v1`;
const seededAt = '2026-08-05T00:00:00.000Z';
const checksum = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');

function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

const insertPersona = `INSERT INTO journey_personas
  (id,space_id,name,summary,lifecycle_state,owner_user_id,source,attributes_json,goals_json,behaviours_json,
   needs_json,barriers_json,review_at,revision,created_at,updated_at,current_version_id)
  VALUES ($1,$2,$3,$4,'draft',$5,'workspace','{}','[]','[]','[]','[]',NULL,1,$6,$6,$7)`;
const insertVersion = `INSERT INTO journey_persona_versions
  (id,persona_id,space_id,version_number,name,summary,lifecycle_state,owner_user_id,source,attributes_json,
   goals_json,behaviours_json,needs_json,barriers_json,review_at,content_checksum,created_by_user_id,created_at)
  VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,'workspace','{}','[]','[]','[]','[]',NULL,$8,$7,$9)`;

try {
  await Promise.all([owner.connect(), left.connect(), right.connect(), app.connect()]);
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'Runtime 23 persona proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  for (const [spaceId, slug] of [[spaceA, `${proof}-a`], [spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 23 persona proof',$2,$3,NULL,$4,$4)`, [spaceId, slug, userId, seededAt]);
  }

  await owner.query('BEGIN');
  await owner.query(insertPersona,
    [personaA, spaceA, 'Field engineer', 'Pinned v1', userId, seededAt, versionA1]);
  await owner.query(insertVersion,
    [versionA1, personaA, spaceA, 1, 'Field engineer', 'Pinned v1', userId, checksum('a-v1'), seededAt]);
  await owner.query(insertPersona,
    [personaB, spaceB, 'Tenant B engineer', 'Tenant B', userId, seededAt, versionB1]);
  await owner.query(insertVersion,
    [versionB1, personaB, spaceB, 1, 'Tenant B engineer', 'Tenant B', userId, checksum('b-v1'), seededAt]);
  await owner.query(insertPersona,
    [personaConflict, spaceA, 'Concurrent persona', 'Revision proof', userId, seededAt, versionConflict1]);
  await owner.query(insertVersion,
    [versionConflict1, personaConflict, spaceA, 1, 'Concurrent persona', 'Revision proof', userId,
      checksum('conflict-v1'), seededAt]);
  await owner.query(`INSERT INTO journey_persona_claims
    (id,persona_version_id,persona_id,space_id,claim_type,label,value,ordinal,claim_checksum,created_at)
    VALUES ($1,$2,$3,$4,'summary','Summary','Pinned v1',0,$5,$6)`,
  [`${proof}_claim_a1`, versionA1, personaA, spaceA, checksum('claim-a1'), seededAt]);
  await owner.query('COMMIT');
  emit('journey_persona_cyclic_creation_passed');

  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
     published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,'Pinned persona map','Historical pin proof','customer','current_state','evidence_backed',
      'published',$3,NULL,NULL,30,1,$4,$4)`, [definitionA, spaceA, userId, seededAt]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,state,map_type,mode,experience_type,author_user_id,published_at,created_at)
    VALUES ($1,$2,$3,1,'published','current_state','evidence_backed','customer',$4,$5,$5)`,
  [mapVersionA, definitionA, spaceA, userId, seededAt]);
  await owner.query(`UPDATE journey_definitions SET current_version_id=$1,published_version_id=$1
    WHERE id=$2 AND space_id=$3`, [mapVersionA, definitionA, spaceA]);
  await owner.query(`INSERT INTO journey_map_version_personas
    (version_id,definition_id,persona_id,persona_version_id,space_id,ordinal,review_state_at_pin,
     content_checksum_at_pin,evidence_coverage_at_pin,pinned_at)
    VALUES ($1,$2,$3,$4,$5,0,'draft',$6,0,$7)`,
  [mapVersionA, definitionA, personaA, versionA1, spaceA, checksum('a-v1'), seededAt]);

  await assert.rejects(owner.query(`INSERT INTO journey_persona_claims
    (id,persona_version_id,persona_id,space_id,claim_type,label,value,ordinal,claim_checksum,created_at)
    VALUES ($1,$2,$3,$4,'goal','Goal','Cross-space claim',0,$5,$6)`,
  [`${proof}_cross_claim`, versionA1, personaA, spaceB, checksum('cross-claim'), seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_persona_claims_version_tenant_fk');
  await assert.rejects(owner.query(`INSERT INTO journey_map_version_personas
    (version_id,definition_id,persona_id,persona_version_id,space_id,ordinal,review_state_at_pin,
     content_checksum_at_pin,evidence_coverage_at_pin,pinned_at)
    VALUES ($1,$2,$3,$4,$5,1,'draft',$6,0,$7)`,
  [mapVersionA, definitionA, personaB, versionB1, spaceA, checksum('b-v1'), seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_map_version_personas_persona_tenant_fk');
  emit('journey_persona_tenant_composite_foreign_keys_passed');

  await assert.rejects(owner.query('UPDATE journey_persona_versions SET summary=summary WHERE id=$1', [versionA1]),
    (error) => error?.code === '55000');
  await assert.rejects(owner.query('DELETE FROM journey_persona_claims WHERE id=$1', [`${proof}_claim_a1`]),
    (error) => error?.code === '55000');
  await assert.rejects(app.query('UPDATE journey_map_version_personas SET ordinal=ordinal WHERE version_id=$1',
    [mapVersionA]), (error) => error?.code === '42501');
  emit('journey_persona_immutable_history_passed');

  await assert.rejects(app.query(insertPersona,
    [`${proof}_null_root`, spaceA, 'Null root', 'Must not commit', userId, seededAt, null]),
  (error) => error?.code === '23502');
  await assert.rejects(app.query(insertPersona,
    [`${proof}_orphan_root`, spaceA, 'Orphan root', 'Must not commit', userId, seededAt, `${proof}_missing_version`]),
  (error) => error?.code === '23503');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_personas
    WHERE id IN ($1,$2)`, [`${proof}_null_root`, `${proof}_orphan_root`])).rows[0].count), 0);
  emit('journey_persona_direct_orphan_insert_denied');

  await owner.query(insertVersion,
    [versionA2, personaA, spaceA, 2, 'Field engineer v2', 'Working v2', userId, checksum('a-v2'), seededAt]);
  await owner.query(`UPDATE journey_personas SET current_version_id=$1,name='Field engineer v2',summary='Working v2',
    revision=revision+1,updated_at=$2 WHERE id=$3 AND space_id=$4`, [versionA2, seededAt, personaA, spaceA]);
  const pin = (await owner.query(`SELECT persona_version_id,content_checksum_at_pin
    FROM journey_map_version_personas WHERE version_id=$1 AND persona_id=$2`, [mapVersionA, personaA])).rows[0];
  assert.equal(pin.persona_version_id, versionA1);
  assert.equal(pin.content_checksum_at_pin, checksum('a-v1'));
  emit('journey_persona_published_pin_stability_passed');

  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM journey_personas WHERE id=$1 AND space_id=$2 FOR UPDATE', [personaConflict, spaceA]);
  let rightFinished = false;
  const competingUpdate = right.query(`UPDATE journey_personas SET revision=revision+1,updated_at=$1
    WHERE id=$2 AND space_id=$3 AND revision=1`, [seededAt, personaConflict, spaceA])
    .then((result) => { rightFinished = true; return result; });
  await delay(100);
  assert.equal(rightFinished, false, 'The competing persona edit must wait for the row lock.');
  await left.query(`UPDATE journey_personas SET revision=revision+1,updated_at=$1
    WHERE id=$2 AND space_id=$3 AND revision=1`, [seededAt, personaConflict, spaceA]);
  await left.query('COMMIT');
  const losingUpdate = await competingUpdate;
  await right.query('COMMIT');
  assert.equal(losingUpdate.rowCount, 0);
  emit('journey_persona_two_connection_revision_conflict_passed');

  const beforeReplay = (await owner.query(`SELECT current_version_id,revision,
      (SELECT COUNT(*)::int FROM journey_persona_versions WHERE persona_id=$1) version_count
    FROM journey_personas WHERE id=$1`, [personaA])).rows[0];
  await owner.query('BEGIN');
  await owner.query(insertVersion,
    [versionA3, personaA, spaceA, 3, 'Field engineer v3', 'Replay v3', userId, checksum('a-v3'), seededAt]);
  await owner.query('UPDATE journey_personas SET current_version_id=$1,revision=revision+1 WHERE id=$2',
    [versionA3, personaA]);
  await owner.query('ROLLBACK');
  const rolledBack = (await owner.query(`SELECT current_version_id,revision,
      (SELECT COUNT(*)::int FROM journey_persona_versions WHERE persona_id=$1) version_count
    FROM journey_personas WHERE id=$1`, [personaA])).rows[0];
  assert.deepEqual(rolledBack, beforeReplay);
  await owner.query('BEGIN');
  await owner.query(insertVersion,
    [versionA3, personaA, spaceA, 3, 'Field engineer v3', 'Replay v3', userId, checksum('a-v3'), seededAt]);
  await owner.query('UPDATE journey_personas SET current_version_id=$1,revision=revision+1 WHERE id=$2',
    [versionA3, personaA]);
  await owner.query('COMMIT');
  assert.equal((await owner.query('SELECT current_version_id FROM journey_personas WHERE id=$1', [personaA])).rows[0]
    .current_version_id, versionA3);
  emit('journey_persona_rollback_replay_passed');
} finally {
  await Promise.all([left.query('ROLLBACK').catch(() => {}), right.query('ROLLBACK').catch(() => {})]);
  await Promise.all([owner.end().catch(() => {}), left.end().catch(() => {}),
    right.end().catch(() => {}), app.end().catch(() => {})]);
}

emit('journey_persona_runtime_23_postgres_probe_passed', { database });
