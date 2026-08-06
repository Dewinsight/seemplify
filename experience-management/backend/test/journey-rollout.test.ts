import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-rollout-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Rollout-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-rollout-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-rollout-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 41).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 42).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-rollout@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db, getJourney, updateJourney } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
const rollout = await import('../src/journeyRollout.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const stages = [
  {
    name: 'Discover', goal: 'Understand the offer', touchpoints: ['Website'], customerActions: ['Compare'],
    emotions: ['Curious'], painPoints: ['Unclear value'], metrics: ['Qualified visits'],
    opportunities: ['Clarify value'], recommendedActions: ['Publish guidance']
  },
  {
    name: 'Activate', goal: 'Reach first value', touchpoints: ['Onboarding'], customerActions: ['Configure'],
    emotions: ['Hopeful'], painPoints: ['Too many steps'], metrics: ['Time to value'],
    opportunities: ['Progressive setup'], recommendedActions: ['Reduce fields']
  }
];

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-rollout@seemplify.local', password: 'Journey-Rollout-Test-Password-2026!'
  }).expect(200);
  return agent;
}

async function identity(agent: ReturnType<typeof request.agent>) {
  const session = await agent.get('/api/auth/session').expect(200);
  return { userId: String(session.body.user.id), spaceId: String(session.body.activeSpace.id) };
}

async function setPlatform(agent: ReturnType<typeof request.agent>, patch: Partial<rollout.JourneyRolloutSettings>) {
  const current = (await agent.get('/api/platform-admin/journey-rollout').expect(200)).body.platform;
  const body = {
    v2ReadEnabled: current.v2ReadEnabled,
    v2WriteEnabled: current.v2WriteEnabled,
    dualWriteEnabled: current.dualWriteEnabled,
    compareReadsEnabled: current.compareReadsEnabled,
    rolloutPercentage: current.rolloutPercentage,
    forcedLegacy: current.forcedLegacy,
    killSwitchReference: current.killSwitchReference,
    killSwitchReviewAt: current.killSwitchReviewAt,
    ...patch,
    expectedRevision: current.revision,
    reason: 'Focused Journey Map 2.0 rollout test change.'
  };
  return (await agent.put('/api/platform-admin/journey-rollout/platform').send(body).expect(200)).body.platform;
}

async function createLegacy(agent: ReturnType<typeof request.agent>, name: string) {
  return (await agent.post('/api/journeys').send({
    name, audience: 'New customers', objective: 'Improve activation', industry: 'Software',
    summary: 'Planning hypothesis.', stages
  }).expect(201)).body;
}

test('platform-only rollout controls are revisioned, audited, cohort-aware, and forced legacy wins immediately', async () => {
  const admin = await adminAgent();
  const { spaceId } = await identity(admin);
  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, {
    email: 'journey-rollout-outsider@example.com', password: 'Journey-Rollout-Outsider-2026!',
    name: 'Rollout outsider', spaceName: 'Outsider rollout space'
  });
  await outsider.get('/api/platform-admin/journey-rollout').expect(403);

  const initial = (await admin.get('/api/platform-admin/journey-rollout').expect(200)).body.platform;
  assert.equal(initial.v2ReadEnabled, true);
  const stale = { ...initial, expectedRevision: initial.revision, reason: 'First revision-safe rollout update.' };
  delete stale.effectiveAt; delete stale.createdAt; delete stale.updatedAt; delete stale.updatedByUserId; delete stale.revision;
  const changed = (await admin.put('/api/platform-admin/journey-rollout/platform').send({
    ...stale, compareReadsEnabled: true
  }).expect(200)).body.platform;
  assert.equal(changed.revision, initial.revision + 1);
  await admin.put('/api/platform-admin/journey-rollout/platform').send({
    ...stale, compareReadsEnabled: false
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'JOURNEY_ROLLOUT_REVISION_CONFLICT'));

  const legacy = await createLegacy(admin, 'Forced legacy journey');
  const nativeMap = (await admin.post('/api/journey-maps').send({ name: 'Native V2 control', stageNames: ['Start'] })
    .expect(201)).body;
  const allMaps = (await admin.get('/api/journey-maps').expect(200)).body.journeyMaps;
  const legacyDefinition = allMaps.find((item: any) => item.legacyJourneyId === legacy.id);
  assert.ok(legacyDefinition);

  const reviewAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const override = (await admin.put(`/api/platform-admin/journey-rollout/spaces/${spaceId}`).send({
    enrollment: 'included', v2ReadEnabled: null, v2WriteEnabled: null, dualWriteEnabled: null,
    compareReadsEnabled: null, rolloutPercentage: null, forcedLegacy: true,
    killSwitchReference: 'INC-ROLLBACK-42', killSwitchReviewAt: reviewAt,
    expectedRevision: null, reason: 'Exercise the immediate forced-legacy containment switch.'
  }).expect(({ body, status }) => assert.equal(status, 200, JSON.stringify(body)))).body;
  assert.equal(override.effective.forcedLegacy, true);
  assert.equal(override.effective.v2Read, false);
  assert.equal((await admin.get(`/api/journeys/${legacy.id}`).expect(200)).body.name, legacy.name);
  const forcedMaps = (await admin.get('/api/journey-maps').expect(200)).body.journeyMaps;
  assert.ok(forcedMaps.some((item: any) => item.id === nativeMap.id), 'native V2 map remains isolated');
  assert.ok(!forcedMaps.some((item: any) => item.id === legacyDefinition.id), 'legacy projection is hidden');
  await admin.get(`/api/journey-maps/${legacyDefinition.id}`).expect(404)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_V2_READ_DISABLED'));

  await admin.delete(`/api/platform-admin/journey-rollout/spaces/${spaceId}`).send({
    expectedRevision: override.space.revision, reason: 'Return this space to inherited rollout controls.'
  }).expect(204);
  assert.equal(rollout.effectiveJourneyRollout(spaceId).forcedLegacy, false);
  const auditCount = Number((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events
    WHERE action LIKE 'journey_rollout.%'`).get() as any).count);
  assert.ok(auditCount >= 3);
});

test('shadow comparison is content-free, immutable, and never changes the selected legacy response', async () => {
  const admin = await adminAgent();
  const { spaceId } = await identity(admin);
  await setPlatform(admin, { v2ReadEnabled: false, v2WriteEnabled: true, dualWriteEnabled: false,
    compareReadsEnabled: true, rolloutPercentage: 100, forcedLegacy: false,
    killSwitchReference: null, killSwitchReviewAt: null });
  const journey = await createLegacy(admin, 'Shadow baseline');
  maps.ensureJourneyMapForLegacyJourney(getJourney(journey.id, spaceId)!, spaceId);
  const current = getJourney(journey.id, spaceId)!;
  const drifted = updateJourney(journey.id, { name: 'Legacy response selected' }, current.updatedAt,
    { reason: 'workspace_edit', actor: 'workspace' }, spaceId)!;

  const response = await admin.get(`/api/journeys/${journey.id}`).set('x-request-id', 'shadow-request-0001').expect(200);
  assert.equal(response.body.name, 'Legacy response selected');
  const divergence = rollout.listJourneyDivergences({ spaceId, limit: 1 })[0];
  assert.equal(divergence.operation, 'shadow_read');
  assert.equal(divergence.servedSource, 'legacy');
  assert.equal(divergence.reasonCode, 'checksum_mismatch');
  assert.equal(divergence.requestId, 'shadow-request-0001');
  assert.ok(!JSON.stringify(divergence).includes(drifted.name), 'ledger contains checksums and field codes, not content');
  assert.throws(() => db.prepare('UPDATE journey_v2_divergences SET reason_code=? WHERE id=?')
    .run('tampered', divergence.id), /immutable/u);
  assert.throws(() => db.prepare('DELETE FROM journey_v2_divergences WHERE id=?').run(divergence.id), /immutable/u);
  await setPlatform(admin, { v2ReadEnabled: true, compareReadsEnabled: false });
});

test('dual-write keeps legacy and V2 route responses/history atomic across stage, card, bulk, move, conflicts, and delete', async () => {
  const admin = await adminAgent();
  const { spaceId } = await identity(admin);
  await setPlatform(admin, { v2ReadEnabled: true, v2WriteEnabled: true, dualWriteEnabled: true,
    compareReadsEnabled: false, rolloutPercentage: 100, forcedLegacy: false,
    killSwitchReference: null, killSwitchReviewAt: null });

  const journey = await createLegacy(admin, 'Atomic dual-write journey');
  let reconciliation = maps.reconcileJourneyMap(spaceId, journey.id);
  assert.equal(reconciliation.matched, true);
  let map = maps.getJourneyMap(spaceId, reconciliation.definitionId!)!;
  assert.equal(map.versions.length, 1);

  const legacyUpdated = (await admin.patch(`/api/journeys/${journey.id}`).send({
    summary: 'Updated on the legacy route.', expectedUpdatedAt: journey.updatedAt
  }).expect(200)).body;
  reconciliation = maps.reconcileJourneyMap(spaceId, journey.id);
  assert.equal(reconciliation.matched, true);
  map = maps.getJourneyMap(spaceId, reconciliation.definitionId!)!;
  assert.equal(map.versions.length, 2);
  await admin.patch(`/api/journeys/${journey.id}`).send({
    summary: 'Stale legacy write must not persist.', expectedUpdatedAt: journey.updatedAt
  }).expect(409);
  assert.equal(getJourney(journey.id, spaceId)!.summary, legacyUpdated.summary);

  const discover = map.stages[0];
  map = (await admin.patch(`/api/journey-maps/${map.definition.id}/stages/${discover.stageKey}`).send({
    expectedRevision: map.definition.revision, name: 'Explore'
  }).expect(({ body, status }) => assert.equal(status, 200, JSON.stringify(body)))).body;
  assert.equal(map.definition.revision, 3);
  assert.equal(map.stages[0].name, 'Explore');
  assert.equal(getJourney(journey.id, spaceId)!.stages[0].name, 'Explore');
  assert.equal(maps.reconcileJourneyMap(spaceId, journey.id).matched, true);

  let touchpoint = map.cards.find((card: any) => card.laneType === 'touchpoints' && card.stageKey === map.stages[0].stageKey)!;
  map = (await admin.patch(`/api/journey-maps/${map.definition.id}/cards/${touchpoint.id}`).send({
    expectedRevision: map.definition.revision, title: 'Product website', content: ''
  }).expect(200)).body;
  assert.equal(map.definition.id, reconciliation.definitionId);
  assert.ok(getJourney(journey.id, spaceId)!.stages[0].touchpoints.includes('Product website'));

  touchpoint = map.cards.find((card: any) => card.laneType === 'touchpoints' && card.stageKey === map.stages[0].stageKey)!;
  const beforeCompactRevision = map.definition.revision;
  const compactMove = await admin.post(`/api/journey-maps/${map.definition.id}/cards/${touchpoint.id}/move`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[1].stageKey, ordinal: 1,
    responseMode: 'affected_cells'
  }).expect(409);
  assert.equal(compactMove.body.code, 'JOURNEY_COMPACT_MOVE_FULL_RECOVERY_REQUIRED');
  map = maps.getJourneyMap(spaceId, map.definition.id)!;
  assert.equal(map.definition.revision, beforeCompactRevision,
    'the explicit compact recovery response must roll back both V2 and legacy writes');
  assert.ok(!getJourney(journey.id, spaceId)!.stages[1].touchpoints.includes('Product website'));

  touchpoint = map.cards.find((card: any) => card.laneType === 'touchpoints' && card.stageKey === map.stages[0].stageKey)!;
  map = (await admin.post(`/api/journey-maps/${map.definition.id}/cards/${touchpoint.id}/move`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[1].stageKey, ordinal: 1
  }).expect(200)).body;
  assert.ok(getJourney(journey.id, spaceId)!.stages[1].touchpoints.includes('Product website'));

  const pain = map.cards.find((card: any) => card.laneType === 'pain_points' && card.stageKey === map.stages[0].stageKey)!;
  map = (await admin.post(`/api/journey-maps/${map.definition.id}/cards/bulk`).send({
    expectedRevision: map.definition.revision, cardIds: [pain.id], patch: { stageKey: map.stages[1].stageKey }
  }).expect(200)).body;
  assert.ok(getJourney(journey.id, spaceId)!.stages[1].painPoints.includes('Unclear value'));

  const beforeRejected = maps.getJourneyMap(spaceId, map.definition.id)!;
  const sourceBeforeRejected = maps.journeyLegacyChecksum(getJourney(journey.id, spaceId)!);
  const divergencesBefore = rollout.listJourneyDivergences({ spaceId, limit: 200 }).length;
  await admin.post(`/api/journey-maps/${map.definition.id}/lanes`).send({
    expectedRevision: beforeRejected.definition.revision, title: 'Unsupported custom detail'
  }).expect(422).expect(({ body }) => assert.equal(body.code, 'JOURNEY_DUAL_WRITE_NOT_LEGACY_COMPATIBLE'));
  const afterRejected = maps.getJourneyMap(spaceId, map.definition.id)!;
  assert.equal(afterRejected.definition.revision, beforeRejected.definition.revision);
  assert.equal(afterRejected.lanes.length, beforeRejected.lanes.length);
  assert.equal(maps.journeyLegacyChecksum(getJourney(journey.id, spaceId)!), sourceBeforeRejected);
  assert.equal(rollout.listJourneyDivergences({ spaceId, limit: 200 }).length, divergencesBefore);

  await admin.patch(`/api/journey-maps/${map.definition.id}/stages/${map.stages[0].stageKey}`).send({
    expectedRevision: beforeRejected.definition.revision - 1, name: 'Stale V2 edit'
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_REVISION_CONFLICT'));

  const deletable = await createLegacy(admin, 'Dual-write deletion');
  const deletionDefinition = maps.reconcileJourneyMap(spaceId, deletable.id).definitionId!;
  await admin.delete(`/api/journeys/${deletable.id}`).send({ expectedUpdatedAt: deletable.updatedAt }).expect(204);
  assert.equal(getJourney(deletable.id, spaceId), null);
  assert.equal(maps.getJourneyMap(spaceId, deletionDefinition), null);
});

test('database failure after the source write rolls back legacy history and the V2 projection together', async () => {
  const admin = await adminAgent();
  const { spaceId } = await identity(admin);
  await setPlatform(admin, { v2ReadEnabled: true, v2WriteEnabled: true, dualWriteEnabled: true,
    compareReadsEnabled: false, rolloutPercentage: 100, forcedLegacy: false,
    killSwitchReference: null, killSwitchReviewAt: null });
  const journey = await createLegacy(admin, 'Injected rollback journey');
  const definitionId = maps.reconcileJourneyMap(spaceId, journey.id).definitionId!;
  const beforeSource = getJourney(journey.id, spaceId)!;
  const beforeMap = maps.getJourneyMap(spaceId, definitionId)!;
  const historyBefore = Number((db.prepare('SELECT COUNT(*) count FROM journey_versions WHERE journey_id=?')
    .get(journey.id) as any).count);
  db.exec(`CREATE TRIGGER journey_rollout_test_insert_failure BEFORE INSERT ON journey_map_versions
    WHEN NEW.definition_id='${definitionId}' AND NEW.version_number=2
    BEGIN SELECT RAISE(ABORT,'injected projection failure'); END;`);
  try {
    await admin.patch(`/api/journeys/${journey.id}`).send({
      summary: 'This source update must roll back.', expectedUpdatedAt: beforeSource.updatedAt
    }).expect(500);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS journey_rollout_test_insert_failure');
  }
  assert.deepEqual(getJourney(journey.id, spaceId), beforeSource);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_versions WHERE journey_id=?')
    .get(journey.id) as any).count), historyBefore);
  const afterMap = maps.getJourneyMap(spaceId, definitionId)!;
  assert.equal(afterMap.definition.revision, beforeMap.definition.revision);
  assert.equal(maps.reconcileJourneyMap(spaceId, journey.id).matched, true);
});
