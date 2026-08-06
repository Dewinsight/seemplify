#!/usr/bin/env node

/** Runtime-24 proof for governed journey rich cards. Runs only in the
 * disposable PostgreSQL E2E database. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[2] === '--domain-child') {
  const [, , , spaceId, userId, name] = process.argv;
  try {
    const { createJourneyChannel } = await import('../backend/src/journeyRichCards.ts');
    const result = createJourneyChannel(spaceId, userId, { name, description: '', category: 'web' });
    process.stdout.write(`RICH_PROBE_RESULT ${JSON.stringify({ ok: true, id: result.id })}\n`);
  } catch (error) {
    process.stdout.write(`RICH_PROBE_RESULT ${JSON.stringify({ ok: false,
      code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error) })}\n`);
  }
  process.exit(0);
}

const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg24_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-24 rich-card probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The runtime-24 rich-card probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const appPassword = fs.readFileSync(appPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
const configuration = (user, password, name) => ({ host, port, database, user, password, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(configuration(ownerUser, ownerPassword, 'journey-rich-card-runtime24-owner'));
const left = new Client(configuration(ownerUser, ownerPassword, 'journey-rich-card-runtime24-left'));
const right = new Client(configuration(ownerUser, ownerPassword, 'journey-rich-card-runtime24-right'));
const app = new Client(configuration(appUser, appPassword, 'journey-rich-card-runtime24-app'));

const userId = `${proof}_user`;
const spaceA = `${proof}_space_a`;
const spaceB = `${proof}_space_b`;
const definitionA = `${proof}_definition_a`;
const versionA = `${proof}_version_a`;
const cardA = `${proof}_card_a`;
const channelA = `${proof}_channel_a`;
const channelVersionA = `${proof}_channel_a_v1`;
const touchpointB = `${proof}_touchpoint_b`;
const seededAt = '2026-08-05T00:00:00.000Z';
const sha256 = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');

function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

try {
  await Promise.all([owner.connect(), left.connect(), right.connect(), app.connect()]);
  const runtime = await owner.query('SELECT version,checksum FROM experience_runtime_schema_version ORDER BY version DESC LIMIT 1');
  assert.ok(Number(runtime.rows[0]?.version) >= 24,
    'Runtime 24 must be present before the rich-card probe runs against this or a later compatible runtime.');
  assert.match(String(runtime.rows[0]?.checksum), /^[a-f0-9]{64}$/u);

  const source = fs.readFileSync(path.join(projectDir, 'backend', 'src', 'journeyRichCards.ts'), 'utf8');
  assert.match(source, /function lockSpaceForRichCardQuota[\s\S]*SELECT id FROM spaces WHERE id=\? FOR UPDATE/u);

  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'Runtime 24 rich-card proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  for (const [spaceId, slug] of [[spaceA, `${proof}-a`], [spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 24 rich-card proof',$2,$3,NULL,$4,$4)`, [spaceId, slug, userId, seededAt]);
  }
  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
      published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,'Runtime 24 map','Rich-card proof','customer','current_state','evidence_backed','draft',$3,
      NULL,NULL,30,1,$4,$4)`, [definitionA, spaceA, userId, seededAt]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,state,map_type,mode,experience_type,author_user_id,created_at)
    VALUES ($1,$2,$3,1,'draft','current_state','evidence_backed','customer',$4,$5)`,
  [versionA, definitionA, spaceA, userId, seededAt]);
  await owner.query('UPDATE journey_definitions SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
    [versionA, definitionA, spaceA]);
  await owner.query(`INSERT INTO journey_map_cards
    (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,status,origin,created_at,updated_at)
    VALUES ($1,$2,$3,'use','touchpoints','touchpoint','Checkout','',0,'active','workspace',$4,$4)`,
  [cardA, versionA, spaceA, seededAt]);
  await owner.query(`INSERT INTO journey_channels
    (id,space_id,status,current_version_number,revision,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'active',1,1,$3,$4,$4)`, [channelA, spaceA, userId, seededAt]);
  await owner.query(`INSERT INTO journey_channel_versions
    (id,channel_id,space_id,version_number,name,description,category,created_by_user_id,created_at)
    VALUES ($1,$2,$3,1,'Website','','web',$4,$5)`, [channelVersionA, channelA, spaceA, userId, seededAt]);
  await owner.query(`INSERT INTO journey_touchpoints
    (id,space_id,status,current_version_number,revision,created_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'active',1,1,$3,$4,$4)`, [touchpointB, spaceB, userId, seededAt]);

  await assert.rejects(owner.query(`INSERT INTO journey_touchpoint_versions
    (id,touchpoint_id,space_id,version_number,name,description,channel_id,channel_version_id,created_by_user_id,created_at)
    VALUES ($1,$2,$3,1,'Cross-space','','${channelA}',$4,$5,$6)`,
  [`${proof}_cross_touchpoint_version`, touchpointB, spaceB, channelVersionA, userId, seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_touchpoint_versions_channel_tenant_fk');
  await assert.rejects(owner.query(`INSERT INTO journey_card_details
    (card_id,version_id,space_id,schema_version,rich_text_json,plain_text,emotion_label,revision,created_at,updated_at)
    VALUES ($1,$2,$3,1,'{"version":1,"blocks":[]}','', '',1,$4,$4)`,
  [cardA, versionA, spaceB, seededAt]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_card_details_card_tenant_fk');
  emit('journey_rich_card_tenant_composite_foreign_keys_passed');

  await assert.rejects(owner.query('UPDATE journey_channel_versions SET name=name WHERE id=$1', [channelVersionA]),
    (error) => error?.code === '55000');
  await assert.rejects(owner.query('DELETE FROM journey_channel_versions WHERE id=$1', [channelVersionA]),
    (error) => error?.code === '55000');
  await assert.rejects(app.query('UPDATE journey_channel_versions SET name=name WHERE id=$1', [channelVersionA]),
    (error) => error?.code === '42501');
  await assert.rejects(app.query('DELETE FROM journey_rich_card_audit_events'), (error) => error?.code === '42501');
  await assert.rejects(app.query('DELETE FROM journey_asset_blob_purge_outbox'), (error) => error?.code === '42501');
  emit('journey_rich_card_immutability_and_least_privilege_passed');

  await owner.query(`INSERT INTO journey_card_assets
    (id,card_id,version_id,space_id,kind,source_kind,source_external_url,display_name,mime_type,byte_size,
      sha256,alt_text,caption,ordinal,state,created_by_user_id,created_at,deleted_at,retention_expires_at)
    VALUES ($1,$2,$3,$4,'attachment','external_url','https://example.invalid/archive.pdf','Archive','application/pdf',0,
      NULL,'','',0,'deleted',$5,$6,$6,$7)`,
  [`${proof}_deleted_asset`, cardA, versionA, spaceA, userId, seededAt, '2026-09-05T00:00:00.000Z']);
  await owner.query(`INSERT INTO journey_card_assets
    (id,card_id,version_id,space_id,kind,source_kind,source_external_url,display_name,mime_type,byte_size,
      sha256,alt_text,caption,ordinal,state,created_by_user_id,created_at)
    VALUES ($1,$2,$3,$4,'attachment','external_url','https://example.invalid/current.pdf','Current','application/pdf',0,
      NULL,'','',0,'active',$5,$6)`, [`${proof}_active_asset`, cardA, versionA, spaceA, userId, seededAt]);
  assert.equal(Number((await owner.query('SELECT COUNT(*)::int count FROM journey_card_assets WHERE card_id=$1',
    [cardA])).rows[0].count), 2);
  await owner.query(`INSERT INTO journey_asset_blob_purge_outbox
    (id,space_id,source_upload_id,stored_filename,expected_sha256,expected_byte_size,state,attempt_count,
      next_attempt_at,created_at,updated_at)
    VALUES ($1,$2,$3,'detached-proof.bin',$4,1,'pending',0,$5,$5,$5)`,
  [`${proof}_orphan_receipt`, `${proof}_already_deleted_space`, `${proof}_upload`, sha256('blob'), seededAt]);
  emit('journey_rich_card_active_ordinal_and_non_cascading_outbox_passed');

  const originalLimits = (await owner.query("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'"))
    .rows[0].limits_json;
  await owner.query(`UPDATE platform_subscription_plans SET limits_json=
    jsonb_set(limits_json::jsonb,'{journeyChannels}','1'::jsonb)::text WHERE code='enterprise'`);
  try {
    const raceSpace = `${proof}_quota_space`;
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 24 quota proof',$2,$3,NULL,$4,$4)`, [raceSpace, `${proof}-quota`, userId, seededAt]);
    // Children intentionally use the shared quota space.
    const child = (name) => {
      const tsx = path.join(projectDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      return new Promise((resolve, reject) => {
        const processChild = spawn(process.execPath,
          [tsx, fileURLToPath(import.meta.url), '--domain-child', raceSpace, userId, name],
          { cwd: projectDir, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
        let stdout = ''; let stderr = '';
        processChild.stdout.on('data', (chunk) => { stdout += chunk; });
        processChild.stderr.on('data', (chunk) => { stderr += chunk; });
        processChild.on('error', reject);
        processChild.on('close', (code) => {
          if (code !== 0) return reject(new Error(stderr || stdout));
          const line = stdout.split(/\r?\n/u).find((entry) => entry.startsWith('RICH_PROBE_RESULT '));
          return line ? resolve(JSON.parse(line.slice('RICH_PROBE_RESULT '.length)))
            : reject(new Error(stderr || stdout));
        });
      });
    };
    const outcomes = await Promise.all([child('Quota writer A'), child('Quota writer B')]);
    emit('journey_rich_card_two_process_quota_race_outcomes', { outcomes });
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1,
      `Expected one admitted rich-card catalogue writer: ${JSON.stringify(outcomes)}`);
    assert.deepEqual(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.code),
      ['SUBSCRIPTION_QUOTA_EXCEEDED']);
    assert.equal(Number((await owner.query('SELECT COUNT(*)::int count FROM journey_channels WHERE space_id=$1',
      [raceSpace])).rows[0].count), 1);
    emit('journey_rich_card_two_process_quota_race_passed');
  } finally {
    await owner.query("UPDATE platform_subscription_plans SET limits_json=$1 WHERE code='enterprise'", [originalLimits]);
  }

  await left.query('BEGIN');
  await right.query('BEGIN');
  await left.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceA]);
  let rightAcquired = false;
  const rightLock = right.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceA])
    .then((result) => { rightAcquired = true; return result; });
  await delay(100);
  assert.equal(rightAcquired, false);
  await left.query('COMMIT');
  await rightLock;
  await right.query('ROLLBACK');
  emit('journey_rich_card_space_mutex_blocks_competing_writer_passed');
} finally {
  await Promise.all([left.query('ROLLBACK').catch(() => {}), right.query('ROLLBACK').catch(() => {})]);
  await Promise.all([owner.end().catch(() => {}), left.end().catch(() => {}),
    right.end().catch(() => {}), app.end().catch(() => {})]);
}

emit('journey_rich_card_runtime_24_postgres_probe_passed', { database });
