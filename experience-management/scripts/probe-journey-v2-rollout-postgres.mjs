#!/usr/bin/env node

/**
 * Production-shaped P1-03 rehearsal. Runs only inside the disposable
 * PostgreSQL E2E database and exercises the real synchronous application
 * adapter, including dual writes, shadow comparison, failure rollback,
 * least privilege, and exact cleanup.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const proof = `p103_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The P1-03 probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The P1-03 probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile), 'Owner password file is required.');
const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');

const owner = new Client({
  host, port, database, user: ownerUser, password: ownerPassword, ssl: false,
  application_name: 'journey-map-p1-03-proof', connectionTimeoutMillis: 10_000, query_timeout: 30_000
});

const userId = `${proof}_user`;
const spaceId = `${proof}_space`;
const journeyId = `${proof}_journey`;
const triggerName = `${proof}_projection_failure`;
const functionName = `${proof}_projection_failure_fn`;
const seededAt = '2026-08-04T12:00:00.000Z';
const trackedTables = [
  'users', 'spaces', 'journeys', 'journey_versions', 'journey_definitions',
  'journey_map_versions', 'journey_map_stages', 'journey_map_lanes', 'journey_map_cards',
  'journey_v2_rollout_spaces', 'journey_v2_divergences'
];

function emit(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

async function tableCounts() {
  const result = {};
  for (const table of trackedTables) {
    result[table] = Number((await owner.query(`SELECT COUNT(*)::int count FROM ${table}`)).rows[0].count);
  }
  return result;
}

function journeyInput(name = 'P1-03 rollout proof') {
  return {
    id: journeyId,
    name,
    audience: 'Existing customers',
    objective: 'Prove atomic progressive delivery',
    industry: 'Software',
    stages: [
      {
        name: 'Discover', goal: 'Understand the service', touchpoints: ['Website'],
        customerActions: ['Read overview'], emotions: ['Curious'], painPoints: ['Unclear next step'],
        metrics: ['Overview completion'], opportunities: ['Clarify guidance'],
        recommendedActions: ['Add a concise next step']
      },
      {
        name: 'Activate', goal: 'Complete setup', touchpoints: ['Product'],
        customerActions: ['Configure workspace'], emotions: ['Focused'], painPoints: ['Too many fields'],
        metrics: ['Setup completion'], opportunities: ['Use progressive disclosure'],
        recommendedActions: ['Shorten initial setup']
      }
    ],
    summary: 'A bounded compatibility journey.',
    provenance: {
      origin: 'workspace', lastModifiedBy: 'workspace', evidenceBasis: 'workspace_authored',
      evidenceLevel: 'hypothesis', generatedAt: null, optimizedAt: null
    }
  };
}

let applicationDatabase;
let baselineCounts;
let triggerInstalled = false;
let connected = false;
let exactCleanup = false;
let failureStage = 'connect';

try {
  await owner.connect();
  connected = true;
  baselineCounts = await tableCounts();

  failureStage = 'seed';
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'P1-03 rollout proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES ($1,'P1-03 rollout proof',$2,$3,NULL,$4,$4)`, [spaceId, `${proof}-space`, userId, seededAt]);

  applicationDatabase = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'database.js')).href);
  const maps = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyMaps.js')).href);
  const rollout = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyRollout.js')).href);
  const domain = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyDomain.js')).href);

  const rolloutInput = (existing, extra = {}) => ({
    spaceId,
    enrollment: 'included',
    v2ReadEnabled: true,
    v2WriteEnabled: true,
    dualWriteEnabled: true,
    compareReadsEnabled: true,
    rolloutPercentage: 100,
    forcedLegacy: false,
    killSwitchReference: null,
    killSwitchReviewAt: null,
    expectedRevision: existing?.revision ?? null,
    actorUserId: userId,
    reason: 'P1-03 disposable PostgreSQL verification',
    ...extra
  });

  failureStage = 'dual_create';
  let override = rollout.putJourneySpaceRollout(rolloutInput(null));
  const created = rollout.runLegacyJourneyWrite({
    spaceId,
    journeyId: null,
    requestId: `${proof}:create`,
    operation: () => applicationDatabase.createJourney(journeyInput(), spaceId)
  });
  const definitionId = domain.deterministicJourneyId('definition', journeyId);
  assert.equal(created.id, journeyId);
  assert.equal(maps.reconcileJourneyMap(spaceId, journeyId).matched, true);

  failureStage = 'legacy_to_v2';
  const beforeLegacyUpdate = applicationDatabase.getJourney(journeyId, spaceId);
  const legacyUpdated = rollout.runLegacyJourneyWrite({
    spaceId,
    journeyId,
    requestId: `${proof}:legacy-update`,
    operation: () => applicationDatabase.updateJourney(journeyId,
      { summary: 'Updated through the legitimate legacy source.' }, beforeLegacyUpdate.updatedAt,
      { reason: 'workspace_edit', actor: 'workspace' }, spaceId)
  });
  assert.equal(legacyUpdated.summary, 'Updated through the legitimate legacy source.');
  assert.equal(maps.reconcileJourneyMap(spaceId, journeyId).matched, true);

  failureStage = 'v2_to_legacy';
  let map = maps.getJourneyMap(spaceId, definitionId);
  const stageKey = map.stages[0].stageKey;
  map = rollout.runJourneyV2Write({
    spaceId,
    definitionId,
    requestId: `${proof}:v2-update`,
    operation: () => maps.updateJourneyStage(spaceId, definitionId, map.definition.revision, stageKey,
      { goal: 'Understand the service with a clear next step' })
  });
  assert.equal(applicationDatabase.getJourney(journeyId, spaceId).stages[0].goal,
    'Understand the service with a clear next step');
  assert.equal(maps.reconcileJourneyMap(spaceId, journeyId).matched, true);

  failureStage = 'unsupported_v2_rollback';
  const revisionBeforeUnsupported = map.definition.revision;
  assert.throws(() => rollout.runJourneyV2Write({
    spaceId,
    definitionId,
    requestId: `${proof}:unsupported`,
    operation: () => maps.updateJourneyStage(spaceId, definitionId, revisionBeforeUnsupported, stageKey,
      { description: 'A V2-only field that cannot be represented by the legacy journey.' })
  }), (error) => error?.code === 'JOURNEY_DUAL_WRITE_NOT_LEGACY_COMPATIBLE');
  assert.equal(maps.getJourneyMap(spaceId, definitionId).definition.revision, revisionBeforeUnsupported);
  assert.equal(maps.getJourneyMap(spaceId, definitionId).stages[0].description, '');

  failureStage = 'shadow_read';
  override = rollout.putJourneySpaceRollout(rolloutInput(override, {
    v2ReadEnabled: false,
    dualWriteEnabled: false,
    compareReadsEnabled: true
  }));
  map = maps.getJourneyMap(spaceId, definitionId);
  const card = map.cards.find((item) => item.laneType === 'pain_points');
  maps.updateJourneyCard(spaceId, definitionId, map.definition.revision, card.id,
    { content: 'Intentional shadow-only mismatch' });
  const sourceBeforeShadow = applicationDatabase.getJourney(journeyId, spaceId);
  const served = rollout.readLegacyJourneyWithRollout(spaceId, journeyId, `${proof}:shadow`);
  assert.deepEqual(stableValue(served), stableValue(sourceBeforeShadow),
    'shadow comparison must never change the already-selected legacy response');
  const divergences = rollout.listJourneyDivergences({ spaceId });
  assert.equal(divergences.length, 1);
  assert.equal(divergences[0].servedSource, 'legacy');
  assert.equal(divergences[0].reasonCode, 'checksum_mismatch');
  assert.doesNotMatch(JSON.stringify(divergences[0]), /Intentional shadow-only mismatch/u,
    'divergence records must not contain journey content');

  failureStage = 'least_privilege';
  assert.throws(() => applicationDatabase.db.prepare('UPDATE journey_v2_divergences SET id=id WHERE id=?')
    .run(divergences[0].id), (error) => error?.code === '42501');
  assert.throws(() => applicationDatabase.db.prepare('DELETE FROM journey_v2_divergences WHERE id=?')
    .run(divergences[0].id), (error) => error?.code === '42501');

  // Repair the intentionally drifted projection before re-enabling dual write.
  maps.refreshJourneyMapForLegacyJourney(sourceBeforeShadow, spaceId, { bumpRevision: true });
  override = rollout.putJourneySpaceRollout(rolloutInput(override));

  failureStage = 'kill_switch';
  override = rollout.putJourneySpaceRollout(rolloutInput(override, {
    forcedLegacy: true,
    killSwitchReference: `${proof}:incident`,
    killSwitchReviewAt: '2026-08-05T12:00:00.000Z'
  }));
  const forced = rollout.effectiveJourneyRollout(spaceId);
  assert.equal(forced.decisionCode, 'forced_legacy');
  assert.equal(forced.v2Read, false);
  assert.equal(forced.v2Write, false);
  assert.equal(forced.dualWrite, false);
  assert.equal(rollout.canReadJourneyDefinition(spaceId, maps.getJourneyMap(spaceId, definitionId).definition), false);
  override = rollout.putJourneySpaceRollout(rolloutInput(override));

  failureStage = 'database_failure_rollback';
  const sourceBeforeFailure = applicationDatabase.getJourney(journeyId, spaceId);
  const sourceChecksumBeforeFailure = checksum(sourceBeforeFailure);
  const versionsBeforeFailure = Number((await owner.query(
    'SELECT COUNT(*)::int count FROM journey_versions WHERE journey_id=$1', [journeyId])).rows[0].count);
  const projectionChecksumBeforeFailure = maps.reconcileJourneyMap(spaceId, journeyId).projectionChecksum;
  await owner.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.space_id='${spaceId}' THEN RAISE EXCEPTION 'P1-03 deliberate projection failure' USING ERRCODE='55000'; END IF;
      RETURN NEW;
    END $$`);
  await owner.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON journey_map_versions
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  triggerInstalled = true;
  assert.throws(() => rollout.runLegacyJourneyWrite({
    spaceId,
    journeyId,
    requestId: `${proof}:failure`,
    operation: () => applicationDatabase.updateJourney(journeyId,
      { summary: 'This source mutation must roll back.' }, sourceBeforeFailure.updatedAt,
      { reason: 'workspace_edit', actor: 'workspace' }, spaceId)
  }), /P1-03 deliberate projection failure/u);
  await owner.query(`DROP TRIGGER ${triggerName} ON journey_map_versions`);
  await owner.query(`DROP FUNCTION ${functionName}()`);
  triggerInstalled = false;
  assert.equal(checksum(applicationDatabase.getJourney(journeyId, spaceId)), sourceChecksumBeforeFailure);
  assert.equal(Number((await owner.query(
    'SELECT COUNT(*)::int count FROM journey_versions WHERE journey_id=$1', [journeyId])).rows[0].count),
  versionsBeforeFailure);
  assert.equal(maps.reconcileJourneyMap(spaceId, journeyId).projectionChecksum, projectionChecksumBeforeFailure);

  failureStage = 'optimistic_concurrency';
  const concurrentBase = applicationDatabase.getJourney(journeyId, spaceId);
  const first = rollout.runLegacyJourneyWrite({
    spaceId,
    journeyId,
    operation: () => applicationDatabase.updateJourney(journeyId,
      { summary: 'The accepted concurrent update.' }, concurrentBase.updatedAt,
      { reason: 'workspace_edit', actor: 'workspace' }, spaceId)
  });
  const rejected = rollout.runLegacyJourneyWrite({
    spaceId,
    journeyId,
    operation: () => applicationDatabase.updateJourney(journeyId,
      { summary: 'The stale concurrent update.' }, concurrentBase.updatedAt,
      { reason: 'workspace_edit', actor: 'workspace' }, spaceId)
  });
  assert.equal(first.summary, 'The accepted concurrent update.');
  assert.equal(rejected, null);
  assert.equal(applicationDatabase.getJourney(journeyId, spaceId).summary, 'The accepted concurrent update.');
  assert.equal(maps.reconcileJourneyMap(spaceId, journeyId).matched, true);

  failureStage = 'exact_cleanup';
  maps.discardJourneyMapForLegacyJourney(spaceId, journeyId);
  applicationDatabase.db.close();
  applicationDatabase = undefined;
  await owner.query('ALTER TABLE journey_v2_divergences DISABLE TRIGGER journey_v2_divergences_append_only_trigger');
  await owner.query('DELETE FROM journey_v2_divergences WHERE space_id=$1', [spaceId]);
  await owner.query('ALTER TABLE journey_v2_divergences ENABLE TRIGGER journey_v2_divergences_append_only_trigger');
  await owner.query('DELETE FROM journey_v2_rollout_spaces WHERE space_id=$1', [spaceId]);
  await owner.query('DELETE FROM journey_versions WHERE journey_id=$1', [journeyId]);
  await owner.query('DELETE FROM journeys WHERE id=$1', [journeyId]);
  await owner.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
  await owner.query('DELETE FROM users WHERE id=$1', [userId]);
  assert.deepEqual(await tableCounts(), baselineCounts, 'the P1-03 probe must restore exact table counts');
  exactCleanup = true;
  emit('journey_v2_rollout_postgres_probe_passed', {
    dualWrite: true,
    shadowRead: true,
    killSwitch: true,
    immutableDivergence: true,
    atomicFailureRollback: true,
    optimisticConcurrency: true,
    exactCleanup: true
  });
} catch (error) {
  emit('journey_v2_rollout_postgres_probe_failed', {
    stage: failureStage,
    code: String(error?.code || 'UNKNOWN'),
    exactCleanup
  });
  throw error;
} finally {
  if (connected && triggerInstalled) {
    await owner.query(`DROP TRIGGER IF EXISTS ${triggerName} ON journey_map_versions`).catch(() => {});
    await owner.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
  }
  try { applicationDatabase?.db.close(); } catch {}
  await owner.end().catch(() => {});
}
