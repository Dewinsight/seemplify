#!/usr/bin/env node

/**
 * Production-shaped P1-02 rehearsal. It uses the real PostgreSQL adapter and
 * migration repository against the enclosing disposable E2E database. Source
 * rows are checksummed before/after projection, rollback deletes only derived
 * definitions, and final cleanup restores every observed table count.
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
const proof = `p102_${crypto.randomBytes(8).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The P1-02 probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
assert.match(database, /^experience_e2e_[a-f0-9]+$/u,
  'The P1-02 probe refuses to run outside the disposable PostgreSQL E2E database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile), 'Owner password file is required.');
const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').replace(/[\r\n]+$/u, '');
assert.ok(ownerPassword);

const owner = new Client({
  host, port, database, user: ownerUser, password: ownerPassword, ssl: false,
  application_name: 'journey-map-p1-02-proof', connectionTimeoutMillis: 10_000, query_timeout: 30_000
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

const userId = `${proof}_user`;
const spaces = [`${proof}_space_a`, `${proof}_space_b`, `${proof}_space_c`];
const [spaceA, spaceB, spaceC] = spaces;
const journeyIds = [`${proof}_a_1`, `${proof}_a_2`, `${proof}_b_1`, `${proof}_c_1`, `${proof}_c_2`];
const [journeyA1, journeyA2, journeyB1, journeyC1, journeyC2] = journeyIds;
const aiJobId = `${proof}_ai_job`;
const nativeDefinitionId = `${proof}_native_definition`;
const nativeVersionId = `${proof}_native_version`;
const nativeStageId = `${proof}_native_stage`;
const seededAt = '2026-08-04T10:00:00.000Z';
const provenance = Object.freeze({
  origin: 'workspace', lastModifiedBy: 'workspace', evidenceBasis: 'workspace_authored',
  evidenceLevel: 'hypothesis', generatedAt: null, optimizedAt: null
});
const longPainPoint = `Structured migration evidence\n${'bounded context '.repeat(90)}with  exact  spacing.`;

function stage(label, painPoint = `Pain at ${label}`) {
  return {
    name: label, goal: `Complete ${label} without losing context`,
    touchpoints: [`${label} portal`, `${label} email`], customerActions: [`Complete ${label}`],
    emotions: ['Focused'], painPoints: [painPoint], metrics: [`${label} completion rate`],
    opportunities: [`Simplify ${label}`], recommendedActions: [`Improve ${label} guidance`]
  };
}

function journey(id, name, createdAt, updatedAt, extra = {}) {
  return {
    id, name, audience: 'Existing customers', objective: `Improve ${name}`,
    industry: 'Software', stages: [stage('Discover'), stage('Activate')],
    summary: `Current ${name} summary`, provenance: { ...provenance }, createdAt, updatedAt, ...extra
  };
}

const currentJourneys = [
  journey(journeyA1, 'A historical large-content journey', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', {
    stages: [stage('Discover', longPainPoint), stage('Activate')], summary: `${'Summary detail. '.repeat(250)}Current.`
  }),
  journey(journeyA2, 'A second journey', '2026-01-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z'),
  journey(journeyB1, 'B isolated journey', '2026-01-03T00:00:00.000Z', '2026-03-03T00:00:00.000Z'),
  journey(journeyC1, 'C recoverable failure', '2026-01-04T00:00:00.000Z', '2026-02-04T00:00:00.000Z'),
  journey(journeyC2, 'C continues after failure', '2026-01-05T00:00:00.000Z', '2026-02-05T00:00:00.000Z')
];
const journeySpaces = new Map([
  [journeyA1, spaceA], [journeyA2, spaceA], [journeyB1, spaceB], [journeyC1, spaceC], [journeyC2, spaceC]
]);
const history = [
  {
    id: `${proof}_a1_v0`, journeyId: journeyA1, reason: 'workspace_edit', actor: 'workspace', sourceJobId: aiJobId,
    snapshot: journey(journeyA1, 'A historical large-content journey', '2026-01-01T00:00:00.000Z', '2026-01-10T00:00:00.000Z', {
      objective: 'Initial objective', stages: [stage('Discover', longPainPoint)]
    }), createdAt: '2026-01-11T00:00:00.000Z'
  },
  {
    id: `${proof}_a1_v1`, journeyId: journeyA1, reason: 'terra_optimize', actor: 'terra', sourceJobId: null,
    snapshot: journey(journeyA1, 'A historical large-content journey', '2026-01-01T00:00:00.000Z', '2026-02-10T00:00:00.000Z', {
      objective: 'Optimized objective', stages: [stage('Discover', longPainPoint), stage('Activate')]
    }), createdAt: '2026-02-11T00:00:00.000Z'
  },
  {
    id: `${proof}_b1_v0`, journeyId: journeyB1, reason: 'workspace_edit', actor: 'workspace', sourceJobId: null,
    snapshot: journey(journeyB1, 'B isolated journey', '2026-01-03T00:00:00.000Z', '2026-02-03T00:00:00.000Z', {
      summary: 'Prior B summary'
    }), createdAt: '2026-02-04T00:00:00.000Z'
  }
];

const trackedTables = [
  'users', 'spaces', 'ai_jobs', 'journeys', 'journey_versions', 'journey_definitions',
  'journey_map_versions', 'journey_map_stages', 'journey_map_lanes', 'journey_map_cards'
];

async function tableCounts() {
  const counts = {};
  for (const table of trackedTables) {
    counts[table] = Number((await owner.query(`SELECT COUNT(*)::int count FROM ${table}`)).rows[0].count);
  }
  return counts;
}

async function sourceRows() {
  return {
    journeys: (await owner.query(`SELECT * FROM journeys WHERE id=ANY($1) ORDER BY space_id,id`, [journeyIds])).rows,
    versions: (await owner.query(`SELECT * FROM journey_versions WHERE journey_id=ANY($1)
      ORDER BY journey_id,snapshot_updated_at,created_at,id`, [journeyIds])).rows,
    jobs: (await owner.query('SELECT * FROM ai_jobs WHERE id=$1', [aiJobId])).rows
  };
}

async function projectionRows() {
  const definitions = (await owner.query(`SELECT * FROM journey_definitions
    WHERE legacy_journey_id=ANY($1) ORDER BY space_id,legacy_journey_id,id`, [journeyIds])).rows;
  const definitionIds = definitions.map((row) => row.id);
  if (!definitionIds.length) return { definitions: [], versions: [], stages: [], lanes: [], cards: [] };
  return {
    definitions,
    versions: (await owner.query(`SELECT * FROM journey_map_versions WHERE definition_id=ANY($1)
      ORDER BY definition_id,version_number,id`, [definitionIds])).rows,
    stages: (await owner.query(`SELECT stage.* FROM journey_map_stages stage JOIN journey_map_versions version
      ON version.id=stage.version_id WHERE version.definition_id=ANY($1)
      ORDER BY version.definition_id,version.version_number,stage.ordinal,stage.id`, [definitionIds])).rows,
    lanes: (await owner.query(`SELECT lane.* FROM journey_map_lanes lane JOIN journey_map_versions version
      ON version.id=lane.version_id WHERE version.definition_id=ANY($1)
      ORDER BY version.definition_id,version.version_number,lane.ordinal,lane.id`, [definitionIds])).rows,
    cards: (await owner.query(`SELECT card.* FROM journey_map_cards card JOIN journey_map_versions version
      ON version.id=card.version_id WHERE version.definition_id=ANY($1)
      ORDER BY version.definition_id,version.version_number,card.stage_key,card.lane_type,card.ordinal,card.id`, [definitionIds])).rows
  };
}

async function nativeMapRows() {
  return {
    definition: (await owner.query('SELECT * FROM journey_definitions WHERE id=$1', [nativeDefinitionId])).rows,
    version: (await owner.query('SELECT * FROM journey_map_versions WHERE id=$1', [nativeVersionId])).rows,
    stage: (await owner.query('SELECT * FROM journey_map_stages WHERE id=$1', [nativeStageId])).rows
  };
}

function legacyExportRows(value) {
  const rows = [['stage_number', 'stage_name', 'stage_goal', 'category', 'value']];
  const fields = [
    ['touchpoint', 'touchpoints'], ['customer_action', 'customerActions'], ['emotion', 'emotions'],
    ['pain_point', 'painPoints'], ['metric', 'metrics'], ['opportunity', 'opportunities'],
    ['recommended_action', 'recommendedActions']
  ];
  value.stages.forEach((item, index) => fields.forEach(([category, field]) =>
    item[field].forEach((entry) => rows.push([index + 1, item.name, item.goal, category, entry]))));
  return rows;
}

let databaseModule;
let baselineCounts;
let exactCleanup = false;
let failureStage = 'connect';
try {
  await owner.connect();
  failureStage = 'seed';
  baselineCounts = await tableCounts();
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ($1,$2,'P1-02 migration proof','not-a-login','member',1,$3,$3)`,
  [userId, `${proof}@example.invalid`, seededAt]);
  for (const [index, spaceId] of spaces.entries()) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,NULL,$5,$5)`,
    [spaceId, `P1-02 proof ${index + 1}`, `${proof}-space-${index + 1}`, userId, seededAt]);
  }
  await owner.query(`INSERT INTO ai_jobs
    (id,space_id,kind,survey_id,response_id,requested_by,state,stage,progress,attempt,input_json,created_at,completed_at,updated_at)
    VALUES ($1,$2,'journey.optimize',NULL,NULL,$3,'completed','completed',100,1,'{}',$4,$4,$4)`,
  [aiJobId, spaceA, userId, seededAt]);
  for (const item of currentJourneys) {
    await owner.query(`INSERT INTO journeys
      (id,space_id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [item.id, journeySpaces.get(item.id), item.name, item.audience, item.objective, item.industry,
      JSON.stringify(item.stages), item.summary, JSON.stringify(item.provenance), item.createdAt, item.updatedAt]);
  }
  for (const version of history) {
    const serialized = JSON.stringify(version.snapshot);
    await owner.query(`INSERT INTO journey_versions
      (id,journey_id,reason,actor,source_job_id,snapshot_json,snapshot_name,stage_count,snapshot_bytes,
        snapshot_updated_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [version.id, version.journeyId, version.reason, version.actor, version.sourceJobId, serialized,
      version.snapshot.name, version.snapshot.stages.length, Buffer.byteLength(serialized),
      version.snapshot.updatedAt, version.createdAt]);
  }
  const sourceBefore = await sourceRows();
  const sourceChecksum = checksum(sourceBefore);

  const domain = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyDomain.js')).href);
  const collisionId = domain.deterministicJourneyId('definition', journeyC1);
  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,legacy_journey_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
      current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,NULL,'P1-02 intentional collision','','customer','current_state','designed','draft',NULL,
      NULL,NULL,0,1,$3,$3)`, [collisionId, spaceC, seededAt]);
  // A native V2 map coexists with the legacy-derived rows throughout rollback.
  // Its byte checksum proves rollback is scoped by legacy_journey_id rather
  // than deleting every V2 definition in an enrolled space.
  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,legacy_journey_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
      current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ($1,$2,NULL,'Native Map 2.0 control','Mixed-version rollback control','customer','current_state',
      'designed','draft',$3,$4,NULL,0,1,$5,$5)`, [nativeDefinitionId, spaceB, userId, nativeVersionId, seededAt]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,
      industry,summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
    VALUES ($1,$2,$3,1,2,'draft','current_state','designed','customer','Native control','','','','{}',NULL,$4,NULL,$5)`,
  [nativeVersionId, nativeDefinitionId, spaceB, userId, seededAt]);
  await owner.query(`INSERT INTO journey_map_stages
    (id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES ($1,$2,$3,'native-start','Native start','','',0)`, [nativeStageId, nativeVersionId, spaceB]);
  const nativeMapChecksum = checksum(await nativeMapRows());

  databaseModule = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'database.js')).href);
  const maps = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyMaps.js')).href);
  const exportsModule = await import(pathToFileURL(path.join(projectDir, 'backend', 'dist', 'journeyMapExports.js')).href);

  failureStage = 'bounded_backfill';
  const batches = [];
  let cursor;
  do {
    const report = maps.backfillJourneyMaps({ spaceIds: spaces, limit: 2, cursor });
    assert.equal(report.reportSchema, 'seemplify.journey-map.legacy-backfill/v1');
    assert.deepEqual(report.nextPhaseBlocker,
      { id: 'P1-15', reason: 'phase_1_release_gates_not_complete' });
    batches.push(report);
    cursor = report.nextCursor || undefined;
  } while (cursor);
  assert.equal(batches.length, 3, 'five rows at limit two must require three resumable batches');
  const firstPassItems = batches.flatMap((batch) => batch.items);
  assert.deepEqual(firstPassItems.map((item) => [item.spaceId, item.journeyId]), [
    [spaceA, journeyA1], [spaceA, journeyA2], [spaceB, journeyB1], [spaceC, journeyC1], [spaceC, journeyC2]
  ]);
  const isolatedFailure = batches.flatMap((batch) => batch.failures).find((failure) => failure.journeyId === journeyC1);
  assert.ok(isolatedFailure, 'the intentionally colliding row must be reported');
  assert.ok(firstPassItems.some((item) => item.journeyId === journeyC2 && item.outcome === 'created'),
    'a failed row must not prevent a later row in the same space from projecting');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_definitions
    WHERE legacy_journey_id=ANY($1) AND space_id<>ALL($2)`, [journeyIds, spaces])).rows[0].count), 0);

  await owner.query('DELETE FROM journey_definitions WHERE id=$1 AND legacy_journey_id IS NULL', [collisionId]);
  const repaired = maps.backfillJourneyMaps({ spaceIds: spaces, limit: 2, cursor: isolatedFailure.retryCursor || undefined });
  assert.equal(repaired.failures.length, 0);
  assert.ok(repaired.items.some((item) => item.journeyId === journeyC1 && item.outcome === 'created'));
  const idempotent = maps.backfillJourneyMaps({ spaceIds: spaces, limit: 500 });
  assert.equal(idempotent.completed, true);
  assert.equal(idempotent.failures.length, 0);
  assert.equal(idempotent.mapsCreated, 0);
  assert.equal(idempotent.alreadyPresent, journeyIds.length);

  failureStage = 'reconciliation';
  const byJourney = new Map(currentJourneys.map((item) => [item.id, item]));
  const histories = new Map();
  for (const version of history) {
    const entries = histories.get(version.journeyId) || [];
    entries.push(version);
    histories.set(version.journeyId, entries);
  }
  for (const journeyId of journeyIds) {
    const spaceId = journeySpaces.get(journeyId);
    const source = byJourney.get(journeyId);
    const definitionId = domain.deterministicJourneyId('definition', journeyId);
    const reconciliation = maps.reconcileJourneyMap(spaceId, journeyId);
    assert.equal(reconciliation.matched, true, `${journeyId}: ${reconciliation.differences.join(',')}`);
    assert.equal(reconciliation.sourceChecksum, reconciliation.projectionChecksum);
    assert.equal(reconciliation.noFabricatedEvidence, true);
    assert.equal(reconciliation.noFabricatedPersonas, true);
    assert.equal(reconciliation.noFabricatedConnectedData, true);
    const snapshots = [...(histories.get(journeyId) || []).map((version) => version.snapshot), source];
    for (const [index, snapshot] of snapshots.entries()) {
      const map = maps.getJourneyMap(spaceId, definitionId, domain.journeyVersionId(journeyId, index + 1));
      assert.ok(map);
      const legacyRead = maps.legacyJourneyFromMap(map);
      assert.deepEqual(stableValue(legacyRead), stableValue(snapshot));
      assert.equal(checksum(legacyExportRows(legacyRead)), checksum(legacyExportRows(snapshot)));
      const safeExport = exportsModule.sanitizeJourneyMapForExport(map);
      assert.equal(safeExport.definition.mode, 'designed');
      assert.equal(safeExport.personas.length, 0);
      assert.ok(safeExport.cards.every((card) => card.evidence.state === 'hypothesis'));
    }
    assert.equal(maps.getJourneyMap(spaceId === spaceA ? spaceB : spaceA, definitionId), null,
      'cross-space reads must fail closed');
  }
  const aDefinition = domain.deterministicJourneyId('definition', journeyA1);
  const aHistorical = maps.getJourneyMap(spaceA, aDefinition, domain.journeyVersionId(journeyA1, 1));
  assert.equal(aHistorical.version.sourceJobId, aiJobId);
  assert.ok(aHistorical.cards.some((card) => card.content === longPainPoint), 'large card content must survive exactly');

  const definitionIds = journeyIds.map((id) => domain.deterministicJourneyId('definition', id));
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_definition_personas
    WHERE definition_id=ANY($1)`, [definitionIds])).rows[0].count), 0);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_evidence_links
    WHERE space_id=ANY($1)`, [spaces])).rows[0].count), 0);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_map_versions
    WHERE definition_id=ANY($1) AND mode<>'designed'`, [definitionIds])).rows[0].count), 0);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_stage_rule_definitions
    WHERE journey_definition_id=ANY($1)`, [definitionIds])).rows[0].count), 0);
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_anonymous_instances
    WHERE journey_definition_id=ANY($1)`, [definitionIds])).rows[0].count), 0);

  failureStage = 'rollback_rebackfill';
  const projectionBefore = await projectionRows();
  const projectionChecksum = checksum(projectionBefore);
  const itemChecksums = new Map(idempotent.items.map((item) => [item.journeyId, item.projectionChecksum]));
  for (const journeyId of journeyIds) {
    assert.equal(maps.discardJourneyMapForLegacyJourney(journeySpaces.get(journeyId), journeyId), 1);
  }
  assert.equal((await projectionRows()).definitions.length, 0);
  assert.equal(checksum(await nativeMapRows()), nativeMapChecksum,
    'rollback must leave a coexisting native Map 2.0 definition byte-equivalent');
  assert.equal(checksum(await sourceRows()), sourceChecksum, 'rollback must leave source/history/AI rows byte-equivalent');
  const rebackfill = maps.backfillJourneyMaps({ spaceIds: spaces, limit: 500 });
  assert.equal(rebackfill.failures.length, 0);
  assert.equal(rebackfill.mapsCreated, journeyIds.length);
  assert.equal(checksum(await projectionRows()), projectionChecksum, 're-backfill must reproduce byte-identical projections');
  assert.equal(checksum(await nativeMapRows()), nativeMapChecksum,
    're-backfill must not rewrite a coexisting native Map 2.0 definition');
  for (const item of rebackfill.items) assert.equal(item.projectionChecksum, itemChecksums.get(item.journeyId));
  assert.equal(checksum(await sourceRows()), sourceChecksum, 'projection and re-projection must never mutate source rows');

  failureStage = 'exact_cleanup';
  for (const journeyId of journeyIds) maps.discardJourneyMapForLegacyJourney(journeySpaces.get(journeyId), journeyId);
  databaseModule.db.close();
  databaseModule = undefined;
  await owner.query('DELETE FROM journey_versions WHERE journey_id=ANY($1)', [journeyIds]);
  await owner.query('DELETE FROM journeys WHERE id=ANY($1)', [journeyIds]);
  await owner.query('DELETE FROM ai_jobs WHERE id=$1', [aiJobId]);
  await owner.query('DELETE FROM spaces WHERE id=ANY($1)', [spaces]);
  await owner.query('DELETE FROM users WHERE id=$1', [userId]);
  assert.deepEqual(await tableCounts(), baselineCounts, 'the probe must restore exact global table counts');
  exactCleanup = true;

  process.stdout.write(`${JSON.stringify({
    event: 'journey_map_legacy_backfill_postgres_probe_passed',
    reportSchema: 'seemplify.journey-map.legacy-backfill/v1',
    legacyJourneys: journeyIds.length,
    legacyHistoricalSnapshots: history.length,
    projectedVersions: projectionBefore.versions.length,
    boundedBatches: batches.length,
    resumableCursor: true,
    deterministicOrder: true,
    perSpaceFailureIsolation: true,
    stableIdsAndChecksums: true,
    legacyReadAndExportEquivalent: true,
    sourceRowsUnchanged: true,
    projectionOnlyRollback: true,
    mixedVersionRollback: true,
    rebackfillByteEquivalent: true,
    crossSpaceIsolation: true,
    noFabricatedEvidencePersonasOrConnectedData: true,
    largeContentPreserved: true,
    contentSafe: true,
    exactCleanup,
    projectionSha256: projectionChecksum,
    nextPhaseBlocker: { id: 'P1-15', reason: 'phase_1_release_gates_not_complete' }
  })}\n`);
} catch (error) {
  const rawCode = String(error?.code || error?.name || 'P1_02_PROBE_FAILED');
  const code = rawCode.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 100) || 'P1_02_PROBE_FAILED';
  process.stdout.write(`${JSON.stringify({
    event: 'journey_map_legacy_backfill_postgres_probe_failed',
    reportSchema: 'seemplify.journey-map.legacy-backfill/v1',
    stage: failureStage,
    code,
    contentSafe: true,
    nextPhaseBlocker: { id: 'P1-15', reason: 'phase_1_release_gates_not_complete' }
  })}\n`);
  process.exitCode = 1;
} finally {
  try { databaseModule?.db?.close(); } catch {}
  if (!exactCleanup && owner._connected) {
    await owner.query('DELETE FROM spaces WHERE id=ANY($1)', [spaces]).catch(() => {});
    await owner.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
  }
  await owner.end().catch(() => {});
}
