#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client } from 'pg';

const required = (name: string) => {
  const value = String(process.env[name] || '');
  assert.ok(value, `${name} is required`);
  return value;
};
const password = (file: string) => fs.readFileSync(file, 'utf8').trim();
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const database = required('POSTGRES_DATABASE');
const ownerUser = required('POSTGRES_PROBE_OWNER_USER');
const ownerPasswordFile = required('POSTGRES_PROBE_OWNER_PASSWORD_FILE');
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true');
assert.match(database, /^experience_e2e_[a-f0-9]{12}$/u);

const proof = `pg54_${crypto.randomBytes(5).toString('hex')}`;
const id = (suffix: string) => `${proof}_${suffix}`;
const at = '2026-08-08T12:00:00.000Z';
const owner = new Client({ host, port, database, user: ownerUser, password: password(ownerPasswordFile), ssl: false });

try {
  await owner.connect();
  const user = id('user');
  const space = id('space');
  const link = id('link');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime54','none','member',1,$3,$3)`, [user, `${proof}@example.invalid`, at]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at)
    VALUES($1,'Runtime54',$2,$3,$4,$4)`, [space, proof, user, at]);
  await owner.query(`INSERT INTO journey_evidence_links(id,space_id,target_type,target_id,source_type,source_ref,
    source_label,excerpt,assessment,confidence,population,sample_size,collected_at,window_start,window_end,
    freshness_days,created_by,created_at,updated_at)
    VALUES($1,$2,'definition',$3,'survey_response',$4,'Reviewed unavailable response','Reviewed excerpt',
      'supports',0.8,'Runtime54',1,$5,$5,$5,30,$6,$5,$5)`,
    [link, space, id('definition'), id('missing_response'), at, user]);

  const { journeyEvidenceMonitorRepository: repository } = await import('../backend/src/journeyEvidenceMonitorRepository.js');
  assert.equal(repository.seedMissing(at, 10), 1);
  const first = repository.claim({ owner: id('worker_a'), now: at, leaseMs: 5_000 });
  assert.ok(first);
  await owner.query(`UPDATE journey_evidence_monitor_states SET lease_expires_at='2000-01-01T00:00:00.000Z'
    WHERE evidence_link_id=$1 AND space_id=$2`, [link, space]);
  const second = repository.claim({ owner: id('worker_b'), now: at, leaseMs: 60_000 });
  assert.ok(second);
  assert.ok(second.leaseGeneration > first.leaseGeneration);
  const observation = repository.observe(second, at);
  assert.deepEqual(observation, { status: 'unavailable', reason: 'source_unavailable', sourceFingerprint: null });
  assert.throws(() => repository.complete(first, observation, at), /JOURNEY_EVIDENCE_MONITOR_LEASE_LOST/u);
  const result = repository.complete(second, observation, at);
  assert.equal(result.invalidationApplied, true);

  const checked = await owner.query(`SELECT link.invalidated_reason,state.status,state.observation_reason,
      event.evidence_link_sha256,event.invalidation_applied,event.observation_reason event_reason
    FROM journey_evidence_links link
    JOIN journey_evidence_monitor_states state ON state.evidence_link_id=link.id AND state.space_id=link.space_id
    JOIN journey_evidence_monitor_events event ON event.space_id=link.space_id
    WHERE link.id=$1 AND link.space_id=$2`, [link, space]);
  assert.equal(checked.rows.length, 1);
  assert.equal(checked.rows[0].invalidated_reason, 'automatic_source_unavailable');
  assert.equal(checked.rows[0].status, 'unavailable');
  assert.equal(checked.rows[0].observation_reason, 'source_unavailable');
  assert.equal(checked.rows[0].event_reason, 'source_unavailable');
  assert.equal(checked.rows[0].invalidation_applied, true);
  assert.equal(checked.rows[0].evidence_link_sha256, crypto.createHash('sha256').update(link).digest('hex'));
  const serialized = JSON.stringify(checked.rows);
  assert.equal(serialized.includes(id('missing_response')), false);
  assert.equal(serialized.includes('Reviewed excerpt'), false);
  process.stdout.write(`${JSON.stringify({ event: 'journey_evidence_monitor_postgres_probe_passed',
    appRoleRepository: true, authoritativeUnavailable: true, invalidated: true, staleFence: true,
    contentSafeEvent: true })}\n`);
} finally {
  const imported = await import('../backend/src/database.js').catch(() => null);
  imported?.db.close();
  await owner.end().catch(() => {});
}
