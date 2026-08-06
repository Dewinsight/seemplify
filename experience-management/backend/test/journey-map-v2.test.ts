import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-map-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Map-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-map-test-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-map-test-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 21).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 22).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'journey-maps@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile, LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const domain = await import('../src/journeyDomain.js');
const maps = await import('../src/journeyMaps.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const legacyStages = [
  {
    name: 'Discover', goal: 'Understand the product', touchpoints: ['Website', 'Search'], customerActions: ['Compare options'],
    emotions: ['Curious'], painPoints: ['Unclear fit'], metrics: ['Qualified visits'], opportunities: ['Clarify value'],
    recommendedActions: ['Publish use-case guidance']
  },
  {
    name: 'Activate', goal: 'Reach first value', touchpoints: ['Onboarding'], customerActions: ['Configure a workspace'],
    emotions: ['Hopeful'], painPoints: ['Too many steps'], metrics: ['Time to value'], opportunities: ['Progressive setup'],
    recommendedActions: ['Reduce required fields']
  }
];

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login')
    .send({ email: 'journey-maps@seemplify.local', password: 'Journey-Map-Test-Password-2026!' }).expect(200);
  return agent;
}

async function activeIdentity(agent: ReturnType<typeof request.agent>) {
  const session = await agent.get('/api/auth/session').expect(200);
  return { userId: String(session.body.user.id), spaceId: String(session.body.activeSpace.id) };
}

function seedSurveyEvidence(spaceId: string, suffix: string, responseCount = 1) {
  const now = new Date().toISOString();
  const surveyId = `journey-source-survey-${suffix}`;
  const questionId = `journey-source-question-${suffix}`;
  const collectorId = `journey-source-collector-${suffix}`;
  const responseId = `journey-source-response-${suffix}`;
  const insightId = `journey-source-insight-${suffix}`;
  const ticketId = `journey-source-ticket-${suffix}`;
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,?,'','customer_experience','','active','csat',?,?)`)
    .run(surveyId, spaceId, `Journey source survey ${suffix}`, now, now);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'long_text','What made setup difficult?','',1,'[]','{}','[]')`)
    .run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,?,'web',?,'open','{}',?)`)
    .run(collectorId, surveyId, 'Journey evidence collector', `journey-evidence-${suffix}`, now);
  const insertResponse = db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?, 'completed',?,'{}',?,?,60)`);
  for (let index = 0; index < Math.max(1, responseCount); index += 1) {
    insertResponse.run(index === 0 ? responseId : `${responseId}-${index}`, surveyId, collectorId,
      `respondent-${suffix}-${index}`, JSON.stringify({ [questionId]: 'The setup instructions were difficult to follow.' }), now, now);
  }
  db.prepare(`INSERT INTO insights (id,survey_id,ai_job_id,kind,payload_json,created_at)
    VALUES (?,?,NULL,'ai_insights',?,?)`)
    .run(insightId, surveyId, JSON.stringify({ summary: 'Setup guidance is the leading source of effort.' }), now);
  db.prepare(`INSERT INTO tickets
    (id,survey_id,response_id,title,priority,status,owner,notes,created_at,updated_at)
    VALUES (?,?,?,'Onboarding recovery','high','open','Success team','Customer requested clearer setup guidance.',?,?)`)
    .run(ticketId, surveyId, responseId, now, now);
  return { surveyId, questionId, collectorId, responseId, insightId, ticketId, now };
}

// ---------------------------------------------------------------- domain rules

test('deterministic identifiers are stable, well-formed, and namespace separated', () => {
  const first = domain.deterministicJourneyId('stage', 'journey-a', 0);
  const second = domain.deterministicJourneyId('stage', 'journey-a', 0);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(first, domain.deterministicJourneyId('card', 'journey-a', 0));
  // Concatenated parts must not alias: ('ab','c') and ('a','bc') are different keys.
  assert.notEqual(domain.deterministicJourneyId('ab', 'c'), domain.deterministicJourneyId('a', 'bc'));
});

test('stage keys survive renames by staying ordinal-anchored and slug-bounded', () => {
  assert.equal(domain.journeyStageKey(0, 'Discover the product'), 's01-discover-the-product');
  assert.equal(domain.journeyStageKey(11, '  Trailing  '), 's12-trailing');
  assert.equal(domain.journeyStageKey(0, '!!!'), 's01');
  assert.ok(domain.journeyStageKey(0, 'x'.repeat(200)).length <= 44);
});

test('the legacy converter preserves content, refuses to invent evidence, and quarantines the audience', () => {
  const converted = domain.convertLegacyJourney({
    id: '11111111-1111-4111-8111-111111111111', name: 'Adoption', audience: 'New customers',
    objective: 'Improve activation', industry: 'Software', summary: 'A hypothesis.', stages: legacyStages,
    provenance: {
      origin: 'terra', lastModifiedBy: 'terra', evidenceBasis: 'brief_only', evidenceLevel: 'hypothesis',
      generatedAt: null, optimizedAt: null
    },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(converted.mode, 'designed');
  assert.equal(converted.legacyAudience, 'New customers');
  assert.equal((converted as unknown as { audience?: string }).audience, undefined);
  assert.equal(converted.stages.length, 2);
  assert.equal(converted.stages[0].stageKey, 's01-discover');
  // Metric strings are proposals, never observations.
  const metricCards = converted.cards.filter((card) => card.laneType === 'metrics');
  assert.equal(metricCards.length, 2);
  assert.ok(metricCards.every((card) => card.kind === 'proposed_measure' && card.status === 'draft'));
  assert.ok(converted.cards.every((card) => card.origin === 'legacy_import'));
  assert.equal(converted.cards.filter((card) => card.laneType === 'evidence').length, 0);
  assert.equal(converted.cards.filter((card) => card.laneType === 'touchpoints' && card.stageKey === 's01-discover').length, 2);
  const again = domain.convertLegacyJourney({
    id: '11111111-1111-4111-8111-111111111111', name: 'Adoption', audience: 'New customers',
    objective: 'Improve activation', industry: 'Software', summary: 'A hypothesis.', stages: legacyStages,
    provenance: {
      origin: 'terra', lastModifiedBy: 'terra', evidenceBasis: 'brief_only', evidenceLevel: 'hypothesis',
      generatedAt: null, optimizedAt: null
    },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.deepEqual(again, converted);
});

test('legacy conversion preserves long card values exactly and fails instead of slicing an oversized cell', () => {
  const longPainPoint = `A long, structured pain point\n${'detail '.repeat(120)}with  deliberate  spacing.`;
  const journey = {
    id: '12121212-1212-4121-8121-121212121212', name: 'Long-form migration', audience: 'Operators',
    objective: 'Preserve every source byte', industry: 'Software', summary: 'Migration fixture',
    stages: [{ ...legacyStages[0], painPoints: [longPainPoint] }],
    provenance: {
      origin: 'workspace' as const, lastModifiedBy: 'workspace' as const, evidenceBasis: 'workspace_authored',
      evidenceLevel: 'hypothesis' as const, generatedAt: null, optimizedAt: null
    },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
  };
  const converted = domain.convertLegacyJourney(journey);
  const pain = converted.cards.find((card) => card.laneType === 'pain_points')!;
  assert.equal(pain.title.length, domain.journeyMapLimits.titleChars);
  assert.equal(pain.content, longPainPoint);

  const oversized = structuredClone(journey);
  oversized.stages[0].touchpoints = Array.from({ length: domain.journeyMapLimits.cardsPerCell + 1 }, (_, index) => `Touchpoint ${index}`);
  assert.throws(() => domain.convertLegacyJourney(oversized), (error: any) => {
    assert.equal(error.code, 'JOURNEY_LEGACY_CONVERSION_UNSAFE');
    assert.equal(error.details.field, 'touchpoints');
    return true;
  });
});

test('evidence state follows transparent rules and cannot be talked into strong support', () => {
  const now = Date.parse('2026-08-04T00:00:00.000Z');
  const fresh = '2026-07-01T00:00:00.000Z';
  const old = '2020-01-01T00:00:00.000Z';
  assert.equal(domain.computeEvidenceState([], { now }).state, 'hypothesis');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 1 }
  ], { now }).state, 'anecdotal');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 1 },
    { sourceType: 'observation', assessment: 'supports', collectedAt: fresh, sampleSize: 1 }
  ], { now }).state, 'supported');
  // Triangulation requires a quantitative source with an adequate sample.
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 3 },
    { sourceType: 'survey_analysis', assessment: 'supports', collectedAt: fresh, sampleSize: 400 }
  ], { now }).state, 'strongly_supported');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 3 },
    { sourceType: 'survey_analysis', assessment: 'supports', collectedAt: fresh, sampleSize: 4 }
  ], { now }).state, 'supported');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'survey_analysis', assessment: 'supports', collectedAt: old, sampleSize: 400 }
  ], { now }).state, 'stale');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 1 },
    { sourceType: 'survey_analysis', assessment: 'contradicts', collectedAt: fresh, sampleSize: 400 }
  ], { now }).state, 'contradicted');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 1, invalidated: true }
  ], { now }).state, 'invalidated');
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'interview', assessment: 'supports', collectedAt: fresh, sampleSize: 1, inaccessible: true }
  ], { now }).reason, 'all_links_inaccessible');
  // A per-link freshness policy overrides the default window in both directions.
  assert.equal(domain.computeEvidenceState([
    { sourceType: 'survey_analysis', assessment: 'supports', collectedAt: fresh, sampleSize: 400, freshnessDays: 5 }
  ], { now }).state, 'stale');
});

test('journey mode is derived from evidence rather than declared', () => {
  assert.equal(domain.computeJourneyMode({ evidenceLinkCount: 0 }), 'designed');
  assert.equal(domain.computeJourneyMode({ evidenceLinkCount: 2 }), 'evidence_backed');
  assert.equal(domain.computeJourneyMode({ evidenceLinkCount: 0, observedEventCount: 5 }), 'connected');
});

test('structural validation reports every issue rather than the first', () => {
  const issues = domain.validateJourneyStructure({
    stages: [{ stageKey: 's01', name: 'One', ordinal: 0 }, { stageKey: 's01', name: '', ordinal: 1 }],
    lanes: [{ laneType: 'emotions', ordinal: 0 }],
    cards: [{ stageKey: 'missing', laneType: 'metrics', title: '' }]
  }).map((issue) => issue.code);
  assert.ok(issues.includes('JOURNEY_STAGE_KEY_DUPLICATE'));
  assert.ok(issues.includes('JOURNEY_STAGE_NAME_REQUIRED'));
  assert.ok(issues.includes('JOURNEY_CARD_STAGE_UNKNOWN'));
  assert.ok(issues.includes('JOURNEY_CARD_LANE_UNKNOWN'));
  assert.ok(issues.includes('JOURNEY_CARD_TITLE_REQUIRED'));
});

test('custom lane keys are stable, reserved, and structurally validated', () => {
  assert.equal(domain.journeyCustomLaneKey('Customer commitment & follow-up'), 'custom_customer_commitment_follow_up');
  assert.equal(domain.journeyCustomLaneKey('Customer commitment & follow-up'), 'custom_customer_commitment_follow_up');
  assert.equal(domain.isCustomJourneyLaneKey('custom_customer_commitment_follow_up'), true);
  assert.equal(domain.isCustomJourneyLaneKey('customer_actions'), false);
  assert.equal(domain.isJourneyLaneKey('customer_actions'), true);
  assert.equal(domain.isJourneyLaneKey('custom_customer_commitment_follow_up'), true);
  assert.equal(domain.isJourneyLaneKey('custom:unsafe'), false);
  const issues = domain.validateJourneyStructure({
    stages: [{ stageKey: 's01', name: 'One', ordinal: 0 }],
    lanes: [
      { laneType: 'custom_customer_commitment', ordinal: 0 },
      { laneType: 'custom_customer_commitment', ordinal: 1 },
      { laneType: 'customer_actions_spoof', ordinal: 2 }
    ],
    cards: []
  }).map((issue) => issue.code);
  assert.ok(issues.includes('JOURNEY_LANE_DUPLICATE'));
  assert.ok(issues.includes('JOURNEY_LANE_KEY_INVALID'));
});

test('structural guard maps snake-case database rows instead of relying on camel-case SQL aliases', () => {
  const source = fs.readFileSync(new URL('../src/journeyMaps.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:stage_key\s+stageKey|lane_type\s+laneType)\b/u,
    'unquoted camel-case aliases are folded to lowercase by PostgreSQL');
  assert.match(source, /stageKey:\s*row\.stage_key/u);
  assert.match(source, /laneType:\s*row\.lane_type/u);
});

test('service blueprints add the operational lanes without dropping customer-facing ones', () => {
  const standard = domain.lanesForMapType('current_state').map((lane) => lane.laneType);
  const blueprint = domain.lanesForMapType('service_blueprint').map((lane) => lane.laneType);
  assert.equal(standard.length, 10);
  assert.ok(standard.every((lane) => blueprint.includes(lane)));
  assert.ok(blueprint.includes('backstage') && blueprint.includes('supporting_systems'));
  assert.deepEqual(blueprint.map((_, index) => index), domain.lanesForMapType('service_blueprint').map((lane) => lane.ordinal));
});

test('moveOrdinal clamps out-of-range targets instead of corrupting order', () => {
  assert.deepEqual(domain.moveOrdinal(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(domain.moveOrdinal(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(domain.moveOrdinal(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a']);
  assert.deepEqual(domain.moveOrdinal(['a', 'b', 'c'], 9, 0), ['a', 'b', 'c']);
});

// ------------------------------------------------------------------- API tests

test('a legacy journey opens as a Map 2.0 journey with content and history intact', async () => {
  const agent = await adminAgent();
  const legacy = await agent.post('/api/journeys').send({
    name: 'Legacy adoption', audience: 'New customers', objective: 'Improve activation',
    industry: 'Software', summary: 'Legacy summary', stages: legacyStages
  }).expect(201);

  const listed = await agent.get('/api/journey-maps').expect(200);
  const converted = listed.body.journeyMaps.find((item: any) => item.legacyJourneyId === legacy.body.id);
  assert.ok(converted, 'the legacy journey should have been converted on read');
  assert.equal(converted.mode, 'designed');
  assert.equal(converted.stageCount, 2);

  const map = await agent.get(`/api/journey-maps/${converted.id}`).expect(200);
  assert.equal(map.body.stages.length, 2);
  assert.equal(map.body.lanes.length, 10);
  assert.equal(map.body.version.legacyAudience, 'New customers');
  assert.equal(map.body.version.objective, 'Improve activation');
  assert.ok(map.body.cards.every((card: any) => card.evidence.state === 'hypothesis'));
  assert.ok(map.body.researchGaps.length > 0, 'unsupported claims should be reported as research gaps');

  // Reconciliation is the migration gate: it must match field for field.
  const reconciled = await agent.get(`/api/journey-maps/${converted.id}/reconciliation`).expect(200);
  assert.deepEqual(reconciled.body.differences, []);
  assert.equal(reconciled.body.matched, true);

  // The legacy record and its version history are untouched by conversion.
  const stillLegacy = await agent.get(`/api/journeys/${legacy.body.id}`).expect(200);
  assert.equal(stillLegacy.body.stages.length, 2);
  assert.equal(stillLegacy.body.audience, 'New customers');

  // Repeating the read must not create a second map.
  await agent.get('/api/journey-maps').expect(200);
  const count = (db.prepare('SELECT COUNT(*) count FROM journey_definitions WHERE legacy_journey_id=?')
    .get(legacy.body.id) as any).count;
  assert.equal(count, 1);
});

test('legacy history, timestamps, provenance, and AI job lineage project into stable Map 2.0 versions', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const longPainPoint = `Migration detail: ${'context '.repeat(110)}end.`;
  const initial = await agent.post('/api/journeys').send({
    name: 'Historical migration', audience: 'Existing customers', objective: 'Initial objective',
    industry: 'Software', summary: 'Initial summary',
    stages: [{ ...legacyStages[0], painPoints: [longPainPoint] }]
  }).expect(201);
  const firstUpdate = await agent.patch(`/api/journeys/${initial.body.id}`).send({
    expectedUpdatedAt: initial.body.updatedAt, objective: 'Second objective'
  }).expect(200);
  const current = await agent.patch(`/api/journeys/${initial.body.id}`).send({
    expectedUpdatedAt: firstUpdate.body.updatedAt, summary: 'Current summary'
  }).expect(200);

  const jobId = crypto.randomUUID();
  const jobAt = '2026-08-04T12:00:00.000Z';
  db.prepare(`INSERT INTO ai_jobs
    (id,space_id,kind,survey_id,response_id,requested_by,state,stage,progress,attempt,input_json,created_at,completed_at,updated_at)
    VALUES (?,?, 'journey.optimize',NULL,NULL,?,'completed','completed',100,1,'{}',?,?,?)`)
    .run(jobId, identity.spaceId, identity.userId, jobAt, jobAt, jobAt);
  const firstVersion = db.prepare(`SELECT id FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at ASC,created_at ASC,id ASC LIMIT 1`).get(initial.body.id) as { id: string };
  db.prepare('UPDATE journey_versions SET source_job_id=? WHERE id=?').run(jobId, firstVersion.id);
  const sourceBefore = db.prepare(`SELECT * FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at ASC,created_at ASC,id ASC`).all(initial.body.id) as any[];

  const listed = await agent.get('/api/journey-maps').expect(200);
  const definition = listed.body.journeyMaps.find((item: any) => item.legacyJourneyId === initial.body.id);
  assert.ok(definition);
  const map = await agent.get(`/api/journey-maps/${definition.id}`).expect(200);
  assert.equal(map.body.versions.length, 3);
  assert.equal(map.body.version.versionNumber, 3);
  assert.equal(map.body.version.id, domain.journeyVersionId(initial.body.id, 3));

  for (const [index, source] of sourceBefore.entries()) {
    const historical = maps.getJourneyMap(identity.spaceId, definition.id, domain.journeyVersionId(initial.body.id, index + 1))!;
    assert.deepEqual(maps.legacyJourneyFromMap(historical), JSON.parse(source.snapshot_json));
    assert.equal(historical.version.createdAt, source.created_at);
    assert.equal(historical.version.sourceJobId, source.source_job_id || null);
    assert.equal(historical.version.state, 'superseded');
  }
  const currentMap = maps.getJourneyMap(identity.spaceId, definition.id, domain.journeyVersionId(initial.body.id, 3))!;
  assert.deepEqual(maps.legacyJourneyFromMap(currentMap), current.body);
  assert.equal(currentMap.cards.find((card) => card.laneType === 'pain_points')!.content, longPainPoint);

  const reconciliation = maps.reconcileJourneyMap(identity.spaceId, initial.body.id);
  assert.equal(reconciliation.matched, true, reconciliation.differences.join(','));
  assert.equal(reconciliation.sourceVersionCount, 3);
  assert.equal(reconciliation.projectionVersionCount, 3);
  assert.equal(reconciliation.sourceChecksum, reconciliation.projectionChecksum);
  assert.equal(reconciliation.noFabricatedEvidence, true);
  assert.equal(reconciliation.noFabricatedPersonas, true);
  assert.equal(reconciliation.noFabricatedConnectedData, true);
  assert.deepEqual(db.prepare(`SELECT * FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at ASC,created_at ASC,id ASC`).all(initial.body.id), sourceBefore,
  'projection must not mutate legacy history');
});

test('stages and cards are editable with optimistic concurrency and keyboard-equivalent moves', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({
    name: 'Renewal journey', mapType: 'current_state', experienceType: 'customer', stageNames: ['Notice', 'Decide']
  }).expect(201);
  const definitionId = created.body.id;
  assert.equal(created.body.revision, 1);

  let map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(map.stages.length, 2);

  const added = await agent.post(`/api/journey-maps/${definitionId}/stages`)
    .send({ expectedRevision: map.definition.revision, name: 'Renew', goal: 'Complete the renewal' }).expect(201);
  assert.deepEqual(added.body.stages.map((stage: any) => stage.name), ['Notice', 'Decide', 'Renew']);

  // A stale editor must lose rather than silently overwrite.
  const stale = await agent.post(`/api/journey-maps/${definitionId}/stages`)
    .send({ expectedRevision: map.definition.revision, name: 'Ignored' }).expect(409);
  assert.equal(stale.body.code, 'JOURNEY_MAP_REVISION_CONFLICT');

  map = added.body;
  const withCard = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'pain_point',
    title: 'Renewal notice arrives too late'
  }).expect(201);
  const card = withCard.body.cards.find((item: any) => item.title === 'Renewal notice arrives too late');
  assert.equal(card.laneType, 'pain_points', 'card kind should select its default lane');
  assert.equal(card.evidence.state, 'hypothesis');

  // The same move primitive backs drag and the keyboard controls.
  const moved = await agent.post(`/api/journey-maps/${definitionId}/cards/${card.id}/move`).send({
    expectedRevision: withCard.body.definition.revision, stageKey: withCard.body.stages[2].stageKey, ordinal: 0
  }).expect(200);
  const relocated = moved.body.cards.find((item: any) => item.id === card.id);
  assert.equal(relocated.stageKey, moved.body.stages[2].stageKey);
  assert.equal(relocated.ordinal, 0);

  const reordered = await agent.post(`/api/journey-maps/${definitionId}/stages/${moved.body.stages[2].stageKey}/move`)
    .send({ expectedRevision: moved.body.definition.revision, toOrdinal: 0 }).expect(200);
  assert.deepEqual(reordered.body.stages.map((stage: any) => stage.name), ['Renew', 'Notice', 'Decide']);

  // Deleting a stage takes its cards with it; nothing is orphaned.
  const afterDelete = await agent.delete(`/api/journey-maps/${definitionId}/stages/${reordered.body.stages[0].stageKey}`)
    .send({ expectedRevision: reordered.body.definition.revision }).expect(200);
  assert.equal(afterDelete.body.stages.length, 2);
  assert.equal(afterDelete.body.cards.filter((item: any) => item.id === card.id).length, 0);
  assert.deepEqual(afterDelete.body.stages.map((stage: any) => stage.ordinal), [0, 1]);
});

test('compact card moves return only exact bounded authoritative cells while legacy callers retain full maps', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({
    name: 'Compact move contract', stageNames: ['Source', 'Destination']
  }).expect(201);
  let map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  const add = async (title: string) => {
    const response = await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
      expectedRevision: map.definition.revision,
      stageKey: map.stages[0].stageKey,
      laneType: 'pain_points',
      kind: 'pain_point',
      title
    }).expect(201);
    map = response.body;
    return map.cards.find((card: any) => card.title === title);
  };
  const first = await add('First compact card');
  const second = await add('Second compact card');

  // Any accidental getJourneyMap call would prepare this complete-stage query.
  // The compact native-map path must remain bounded to the two affected cells.
  const originalPrepare = db.prepare.bind(db);
  (db as any).prepare = (sql: string) => {
    if (sql.includes('SELECT * FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')) {
      throw new Error('compact move attempted a full journey-map read');
    }
    return originalPrepare(sql);
  };
  let sameCell: any;
  try {
    sameCell = await agent.post(`/api/journey-maps/${created.body.id}/cards/${second.id}/move`).send({
      expectedRevision: map.definition.revision,
      ordinal: 0,
      responseMode: 'affected_cells'
    }).expect(200);
  } finally {
    (db as any).prepare = originalPrepare;
  }
  assert.equal(sameCell.body.responseMode, 'affected_cells');
  assert.equal(sameCell.body.definitionId, created.body.id);
  assert.equal(sameCell.body.versionId, map.version.id);
  assert.equal(sameCell.body.cardId, second.id);
  assert.equal(sameCell.body.revision, map.definition.revision + 1);
  assert.equal(sameCell.body.cardsPerCellLimit, domain.journeyMapLimits.cardsPerCell);
  assert.equal(sameCell.body.affectedCells.length, 1);
  assert.deepEqual(sameCell.body.affectedCells[0].cards.map((card: any) => [card.id, card.ordinal]), [
    [second.id, 0], [first.id, 1]
  ]);
  assert.equal('stages' in sameCell.body, false);
  assert.equal('definition' in sameCell.body, false);

  const crossCell = await agent.post(`/api/journey-maps/${created.body.id}/cards/${first.id}/move`).send({
    expectedRevision: sameCell.body.revision,
    stageKey: map.stages[1].stageKey,
    laneType: 'pain_points',
    ordinal: 0,
    responseMode: 'affected_cells'
  }).expect(200);
  assert.equal(crossCell.body.affectedCells.length, 2);
  assert.deepEqual(crossCell.body.affectedCells.map((cell: any) => [
    cell.stageKey, cell.laneType, cell.cards.map((card: any) => [card.id, card.ordinal])
  ]), [
    [map.stages[0].stageKey, 'pain_points', [[second.id, 0]]],
    [map.stages[1].stageKey, 'pain_points', [[first.id, 0]]]
  ]);

  const stale = await agent.post(`/api/journey-maps/${created.body.id}/cards/${first.id}/move`).send({
    expectedRevision: sameCell.body.revision,
    ordinal: 0,
    responseMode: 'affected_cells'
  }).expect(409);
  assert.equal(stale.body.code, 'JOURNEY_MAP_REVISION_CONFLICT');
  await agent.post(`/api/journey-maps/${created.body.id}/cards/${first.id}/move`).send({
    expectedRevision: crossCell.body.revision,
    ordinal: 0,
    responseMode: 'full_map'
  }).expect(400);

  const legacyShape = await agent.post(`/api/journey-maps/${created.body.id}/cards/${first.id}/move`).send({
    expectedRevision: crossCell.body.revision,
    stageKey: map.stages[0].stageKey,
    ordinal: 1
  }).expect(200);
  assert.ok(Array.isArray(legacyShape.body.stages));
  assert.ok(Array.isArray(legacyShape.body.cards));
  assert.equal(legacyShape.body.definition.revision, crossCell.body.revision + 1);
});

test('multi-card edits are atomic and consume exactly one optimistic revision', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({
    name: 'Atomic bulk journey', stageNames: ['Discover', 'Resolve']
  }).expect(201);
  const definitionId = created.body.id;
  let map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;

  const first = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    kind: 'pain_point',
    title: 'First selected card'
  }).expect(201);
  map = first.body;
  const second = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    kind: 'pain_point',
    title: 'Second selected card'
  }).expect(201);
  map = second.body;
  const selected = map.cards.filter((card: any) => card.title.includes('selected card'));
  assert.equal(selected.length, 2);
  const beforeRevision = map.definition.revision;

  const bulk = await agent.post(`/api/journey-maps/${definitionId}/cards/bulk`).send({
    expectedRevision: beforeRevision,
    cardIds: selected.map((card: any) => card.id),
    patch: { status: 'retired', stageKey: map.stages[1].stageKey }
  }).expect(200);
  assert.equal(bulk.body.definition.revision, beforeRevision + 1,
    'one atomic selection edit must consume one revision, not one revision per card');
  const changed = bulk.body.cards.filter((card: any) => selected.some((item: any) => item.id === card.id));
  assert.deepEqual(changed.map((card: any) => card.status), ['retired', 'retired']);
  assert.ok(changed.every((card: any) => card.stageKey === map.stages[1].stageKey));
  assert.deepEqual(changed.map((card: any) => card.ordinal), [0, 1]);

  const authoritative = bulk.body;
  const missingCard = '11111111-1111-4111-8111-111111111111';
  const rejected = await agent.post(`/api/journey-maps/${definitionId}/cards/bulk`).send({
    expectedRevision: authoritative.definition.revision,
    cardIds: [selected[0].id, missingCard],
    patch: { status: 'active' }
  }).expect(404);
  assert.equal(rejected.body.code, 'JOURNEY_CARD_NOT_FOUND');
  const afterRejected = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(afterRejected.definition.revision, authoritative.definition.revision,
    'a rejected bulk edit must roll back its optimistic revision');
  assert.equal(afterRejected.cards.find((card: any) => card.id === selected[0].id).status, 'retired',
    'a rejected bulk edit must roll back every card mutation');

  const duplicate = await agent.post(`/api/journey-maps/${definitionId}/cards/bulk`).send({
    expectedRevision: authoritative.definition.revision,
    cardIds: [selected[0].id, selected[0].id],
    patch: { status: 'active' }
  }).expect(400);
  assert.equal(duplicate.body.code, 'JOURNEY_CARD_BULK_DUPLICATE');
});

test('custom lanes are versioned structural content and deletion never discards cards', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({
    name: 'Custom lane journey', stageNames: ['Commit']
  }).expect(201);
  const definitionId = created.body.id;
  let map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;

  const invalidKey = await agent.post(`/api/journey-maps/${definitionId}/lanes`).send({
    expectedRevision: map.definition.revision, laneKey: 'customer_actions', title: 'Spoofed built-in'
  }).expect(400);
  assert.equal(invalidKey.body.code, 'JOURNEY_LANE_KEY_INVALID');
  assert.equal((await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body.definition.revision,
    map.definition.revision, 'rejected lane writes must not consume a revision');
  const builtInDelete = await agent.delete(`/api/journey-maps/${definitionId}/lanes/customer_actions`)
    .send({ expectedRevision: map.definition.revision }).expect(422);
  assert.equal(builtInDelete.body.code, 'JOURNEY_LANE_BUILT_IN');

  const added = await agent.post(`/api/journey-maps/${definitionId}/lanes`).send({
    expectedRevision: map.definition.revision,
    laneKey: 'custom_customer_commitment',
    title: 'Customer commitment',
    description: 'What the organisation promised to do next.'
  }).expect(201);
  map = added.body;
  const custom = map.lanes.find((lane: any) => lane.laneType === 'custom_customer_commitment');
  assert.ok(custom);
  assert.equal(custom.visible, true);
  assert.equal(custom.ordinal, map.lanes.length - 1);

  const secondAdded = await agent.post(`/api/journey-maps/${definitionId}/lanes`).send({
    expectedRevision: map.definition.revision,
    laneKey: 'custom_internal_commitment',
    title: 'Internal commitment'
  }).expect(201);
  map = secondAdded.body;
  assert.deepEqual(map.lanes.filter((lane: any) => lane.laneType.startsWith('custom_')).map((lane: any) => lane.laneType),
    ['custom_customer_commitment', 'custom_internal_commitment']);

  const updated = await agent.patch(`/api/journey-maps/${definitionId}/lanes/custom_customer_commitment`).send({
    expectedRevision: map.definition.revision,
    title: 'Customer commitments',
    description: 'Durable promises and their intended outcome.'
  }).expect(200);
  map = updated.body;
  assert.equal(map.lanes.find((lane: any) => lane.laneType === custom.laneType).title, 'Customer commitments');

  const moved = await agent.post(`/api/journey-maps/${definitionId}/lanes/custom_customer_commitment/move`).send({
    expectedRevision: map.definition.revision, toOrdinal: 0
  }).expect(200);
  map = moved.body;
  assert.equal(map.lanes[0].laneType, 'custom_customer_commitment');

  const hidden = await agent.post(`/api/journey-maps/${definitionId}/lanes/custom_customer_commitment/visibility`).send({
    expectedRevision: map.definition.revision, visible: false
  }).expect(200);
  map = hidden.body;
  assert.equal(map.lanes[0].visible, false);

  const noteWithoutLane = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    kind: 'note',
    title: 'Ambiguous note'
  }).expect(422);
  assert.equal(noteWithoutLane.body.code, 'JOURNEY_CARD_LANE_REQUIRED');
  const wrongKind = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    laneType: 'custom_customer_commitment',
    kind: 'action',
    title: 'Wrong custom card kind'
  }).expect(422);
  assert.equal(wrongKind.body.code, 'JOURNEY_CUSTOM_LANE_KIND');

  const withCard = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    laneType: 'custom_customer_commitment',
    kind: 'note',
    title: 'Call the customer tomorrow'
  }).expect(201);
  map = withCard.body;
  const card = map.cards.find((item: any) => item.laneType === 'custom_customer_commitment');
  assert.ok(card);
  const invalidUpdate = await agent.patch(`/api/journey-maps/${definitionId}/cards/${card.id}`).send({
    expectedRevision: map.definition.revision, kind: 'action'
  }).expect(422);
  assert.equal(invalidUpdate.body.code, 'JOURNEY_CUSTOM_LANE_KIND');
  const withSecondCard = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    laneType: 'custom_internal_commitment',
    kind: 'note',
    title: 'Prepare the support handoff'
  }).expect(201);
  map = withSecondCard.body;
  assert.equal(map.cards.filter((item: any) => item.laneType.startsWith('custom_')).length, 2);

  const notEmpty = await agent.delete(`/api/journey-maps/${definitionId}/lanes/custom_customer_commitment`)
    .send({ expectedRevision: map.definition.revision }).expect(409);
  assert.equal(notEmpty.body.code, 'JOURNEY_LANE_NOT_EMPTY');
  assert.equal(notEmpty.body.details.cardCount, 1);
  const unchanged = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(unchanged.definition.revision, map.definition.revision);
  assert.ok(unchanged.cards.some((item: any) => item.id === card.id));

  const published = await agent.post(`/api/journey-maps/${definitionId}/publish`)
    .send({ expectedRevision: unchanged.definition.revision }).expect(200);
  const publishedSnapshot = (await agent.get(`/api/journey-maps/${definitionId}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200)).body;
  assert.equal(publishedSnapshot.lanes[0].laneType, 'custom_customer_commitment');
  assert.equal(publishedSnapshot.lanes[0].title, 'Customer commitments');
  assert.equal(publishedSnapshot.lanes[0].visible, false);
  assert.ok(publishedSnapshot.cards.some((item: any) => item.laneType === 'custom_customer_commitment'));
  assert.ok(publishedSnapshot.lanes.some((lane: any) => lane.laneType === 'custom_internal_commitment'));
  assert.ok(publishedSnapshot.cards.some((item: any) => item.laneType === 'custom_internal_commitment'));

  map = published.body.journeyMap;
  const draftCard = map.cards.find((item: any) => item.laneType === 'custom_customer_commitment');
  assert.ok(draftCard);
  const removedCard = await agent.delete(`/api/journey-maps/${definitionId}/cards/${draftCard.id}`)
    .send({ expectedRevision: map.definition.revision }).expect(200);
  const deletedLane = await agent.delete(`/api/journey-maps/${definitionId}/lanes/custom_customer_commitment`)
    .send({ expectedRevision: removedCard.body.definition.revision }).expect(200);
  assert.equal(deletedLane.body.lanes.some((lane: any) => lane.laneType === 'custom_customer_commitment'), false);
  assert.equal(deletedLane.body.lanes.some((lane: any) => lane.laneType === 'custom_internal_commitment'), true);
  assert.deepEqual(deletedLane.body.lanes.map((lane: any) => lane.ordinal),
    deletedLane.body.lanes.map((_lane: any, index: number) => index));

  const immutablePublished = (await agent.get(`/api/journey-maps/${definitionId}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200)).body;
  assert.ok(immutablePublished.lanes.some((lane: any) => lane.laneType === 'custom_customer_commitment'));
});

test('evidence links change the computed state, the mode, and the research gap list', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const source = seedSurveyEvidence(identity.spaceId, 'evidence-state', 40);
  const created = await agent.post('/api/journey-maps')
    .send({ name: 'Evidence journey', stageNames: ['Onboard'] }).expect(201);
  const definitionId = created.body.id;
  let map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  const withCard = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'pain_point',
    title: 'Setup takes too long'
  }).expect(201);
  const cardId = withCard.body.cards[0].id;
  assert.equal(withCard.body.definition.mode, 'designed');
  assert.equal(withCard.body.researchGaps.length, 1);

  await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_response', sourceRef: source.responseId,
    sourceLabel: 'Caller-supplied labels are ignored', excerpt: 'Caller-supplied excerpts are ignored',
    assessment: 'supports', confidence: 0.6, sampleSize: 999
  }).expect(201);
  map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(map.cards[0].evidence.state, 'anecdotal');
  assert.equal(map.definition.mode, 'evidence_backed');

  const quantitative = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_analysis', sourceRef: source.insightId,
    assessment: 'supports', confidence: 0.9
  }).expect(201);
  map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(map.cards[0].evidence.state, 'strongly_supported');
  assert.equal(map.cards[0].evidence.reason, 'triangulated_qualitative_and_quantitative');
  assert.equal(map.researchGaps.length, 0);

  // The same source cannot be double counted into stronger support.
  const duplicate = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_analysis', sourceRef: `survey-insight:${source.insightId}`,
    assessment: 'supports'
  }).expect(409);
  assert.equal(duplicate.body.code, 'JOURNEY_EVIDENCE_LINK_EXISTS');

  // Invalidation demands an auditable reason and demotes the state.
  await agent.patch(`/api/journey-evidence/${quantitative.body.id}`).send({ invalidated: true }).expect(400);
  await agent.patch(`/api/journey-evidence/${quantitative.body.id}`)
    .send({ invalidated: true, reason: 'The analysis was withdrawn by the research owner.' }).expect(200);
  map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(map.cards[0].evidence.state, 'anecdotal');
  assert.equal(map.researchGaps.length, 1);

  // Deleting the card removes its evidence links rather than orphaning them.
  await agent.delete(`/api/journey-maps/${definitionId}/cards/${cardId}`)
    .send({ expectedRevision: map.definition.revision }).expect(200);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_evidence_links WHERE target_id=?').get(cardId) as any).count, 0);
});

test('authoritative evidence adapters canonicalize current same-space records and fail closed', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const source = seedSurveyEvidence(identity.spaceId, 'adapter-contract', 35);
  const now = new Date().toISOString();

  const knowledgeBase = (await agent.post('/api/knowledge-bases').send({
    name: 'Journey evidence source base', description: 'Authoritative journey evidence', privacy: 'space'
  }).expect(201)).body.knowledgeBase;
  const knowledgeUpload = await agent.post(`/api/knowledge-bases/${knowledgeBase.id}/documents`)
    .attach('files', Buffer.from('Customers need clearer setup guidance backed by support research.'), {
      filename: 'journey-evidence.md', contentType: 'text/markdown'
    }).expect(202);
  const knowledgeDocumentId = String(knowledgeUpload.body.documents[0].id);

  const socialMentionId = 'journey-source-social-mention';
  db.prepare(`INSERT INTO social_mentions
    (id,space_id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,
      metadata_json,analysis_json,created_at)
    VALUES (?,?, 'x','journey-source-external',NULL,'import','Customer voice',
      'Onboarding takes too long and the instructions are unclear.','https://example.test/post','en',?,'{}',NULL,?)`)
    .run(socialMentionId, identity.spaceId, now, now);
  const socialReportId = 'journey-source-social-report';
  db.prepare(`INSERT INTO social_intelligence_reports
    (id,space_id,user_id,connection_id,title,mention_ids_json,source_snapshot_json,state,result_json,runtime_json,
      ai_job_id,idempotency_key,error,created_at,completed_at,updated_at)
    VALUES (?,?,?,NULL,'Onboarding social intelligence',?,?,'completed',?,NULL,NULL,NULL,NULL,?,?,?)`)
    .run(socialReportId, identity.spaceId, identity.userId, JSON.stringify([socialMentionId]),
      JSON.stringify([{ id: socialMentionId, publishedAt: now }]),
      JSON.stringify({ summary: 'Social evidence consistently identifies onboarding effort.' }), now, now, now);

  const assistantRunId = 'journey-source-assistant-run';
  db.prepare(`INSERT INTO assistant_runs
    (id,space_id,requested_by,ai_job_id,kind,connection_id,subject_ref,source_refs_json,knowledge_base_ids_json,
      document_type,title,input_snapshot_json,input_sha256,request_fingerprint,state,output_json,runtime_json,
      generated_subject,generated_body,draft_subject,draft_body,draft_revision,draft_updated_at,error,advisory_only,
      external_dispatched,idempotency_key,created_at,started_at,completed_at,updated_at)
    VALUES (?,?,?,NULL,'work_product',NULL,NULL,'[]','[]','brief','Onboarding action brief','{}',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','completed',?,NULL,
      NULL,NULL,NULL,NULL,0,NULL,NULL,1,0,NULL,?,?,?,?)`)
    .run(assistantRunId, identity.spaceId, identity.userId,
      JSON.stringify({ summary: 'Prioritize clearer setup guidance and measure completion effort.' }), now, now, now, now);

  const agreementId = 'journey-source-agreement';
  db.prepare(`INSERT INTO esign_envelopes
    (id,space_id,created_by_user_id,source_envelope_id,title,subject,message,status,routing_mode,expires_at,
      expiration_days,reminder_interval_hours,last_reminder_at,finalization_attempt,finalization_retry_at,
      finalization_error,revision,created_at,updated_at,sent_at,completed_at,declined_at,voided_at,void_reason)
    VALUES (?,?,?,NULL,'Completed onboarding agreement','Customer onboarding terms','Signed onboarding agreement.',
      'completed','sequential',NULL,NULL,NULL,NULL,0,NULL,NULL,1,?,?,?,?,NULL,NULL,NULL)`)
    .run(agreementId, identity.spaceId, identity.userId, now, now, now, now);

  const discovered = await agent.get('/api/journey-evidence/sources').query({
    sourceType: 'survey_analysis', query: 'adapter-contract', limit: 5
  }).expect(200);
  assert.equal(discovered.headers['cache-control'], 'private, no-store');
  assert.equal(discovered.body.sources.length, 1);
  assert.equal(discovered.body.sources[0].sourceRef, `survey-insight:${source.insightId}`);
  assert.match(discovered.body.sources[0].label, /Journey source survey adapter-contract/u);
  assert.ok(discovered.body.sources[0].path.startsWith('/surveys/'));
  assert.deepEqual(discovered.body.supportedSourceTypes, [
    'knowledge_document', 'survey_response', 'survey_analysis', 'social_mention',
    'social_intelligence', 'ticket', 'assistant_artifact', 'agreement'
  ]);
  assert.equal(discovered.body.supportedSourceTypes.includes('interview'), false);

  const discoveredKnowledge = await agent.get('/api/journey-evidence/sources').query({
    sourceType: 'knowledge_document', query: 'journey-evidence.md', limit: 1
  }).expect(200);
  assert.equal(discoveredKnowledge.body.sources.length, 1);
  assert.equal(discoveredKnowledge.body.sources[0].sourceRef, `knowledge-document:${knowledgeDocumentId}`);
  assert.ok(JSON.stringify(discoveredKnowledge.body).length < 8_000, 'discovery must return bounded source views');

  await agent.get('/api/journey-evidence/sources').query({ sourceType: 'interview' }).expect(400);
  await agent.get('/api/journey-evidence/sources').query({ sourceType: 'survey_response', limit: 51 }).expect(400);

  const created = await agent.post('/api/journey-maps')
    .send({ name: 'Authoritative evidence map', stageNames: ['Onboard'] }).expect(201);
  let map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  map = (await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey,
    kind: 'pain_point', title: 'Setup effort'
  }).expect(201)).body;
  const cardId = map.cards[0].id;
  const requested = [
    ['knowledge_document', knowledgeDocumentId, `knowledge-document:${knowledgeDocumentId}`],
    ['survey_response', source.responseId, `survey-response:${source.responseId}`],
    ['survey_analysis', `survey-analysis:${source.insightId}`, `survey-insight:${source.insightId}`],
    ['social_mention', `x-post:${socialMentionId}`, `social-mention:${socialMentionId}`],
    ['social_intelligence', `social-intelligence:${socialReportId}`, `social-report:${socialReportId}`],
    ['ticket', source.ticketId, `recovery-ticket:${source.ticketId}`],
    ['assistant_artifact', assistantRunId, `assistant-run:${assistantRunId}`],
    ['agreement', agreementId, `agreement:${agreementId}`]
  ] as const;
  const links: any[] = [];
  for (const [sourceType, sourceRef, canonicalRef] of requested) {
    const attached = await agent.post('/api/journey-evidence').send({
      targetType: 'card', targetId: cardId, sourceType, sourceRef,
      sourceLabel: '<script>spoofed label</script>', excerpt: 'spoofed excerpt',
      population: 'spoofed population', sampleSize: 999_999, collectedAt: '1999-01-01T00:00:00.000Z'
    }).expect(201);
    assert.equal(attached.body.sourceRef, canonicalRef);
    assert.notEqual(attached.body.sourceLabel, '<script>spoofed label</script>');
    assert.notEqual(attached.body.excerpt, 'spoofed excerpt');
    assert.notEqual(attached.body.population, 'spoofed population');
    assert.notEqual(attached.body.sampleSize, 999_999);
    assert.notEqual(attached.body.collectedAt, '1999-01-01T00:00:00.000Z');
    assert.ok(attached.body.sourceLabel.length <= 200);
    assert.ok(attached.body.excerpt.length <= 2_000);
    links.push(attached.body);
  }

  const listed = await agent.get('/api/journey-evidence')
    .query({ targetType: 'card', targetId: cardId }).expect(200);
  assert.equal(listed.body.links.length, requested.length);
  for (const link of links) {
    const viewed = await agent.get(`/api/journey-evidence/${link.id}/source`).expect(200);
    assert.equal(viewed.body.source.sourceRef, link.sourceRef);
    assert.equal(viewed.body.source.sourceType, link.sourceType);
    assert.ok(String(viewed.body.source.path).startsWith('/'));
    assert.ok(JSON.stringify(viewed.body).length < 8_000, 'source views must remain bounded metadata, not raw records');
  }
  const sourceViews = JSON.stringify(await Promise.all(links.map(async (link) =>
    (await agent.get(`/api/journey-evidence/${link.id}/source`).expect(200)).body)));
  assert.doesNotMatch(sourceViews, /respondent-adapter-contract/u);
  assert.doesNotMatch(sourceViews, /input_snapshot_json|respondent_token|access_token/u);

  // Aliases collapse to the canonical reference and cannot double count one
  // source relationship.
  const duplicate = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_analysis', sourceRef: source.insightId
  }).expect(409);
  assert.equal(duplicate.body.code, 'JOURNEY_EVIDENCE_LINK_EXISTS');

  for (const unavailable of ['interview', 'observation', 'event_aggregate']) {
    const rejected = await agent.post('/api/journey-evidence').send({
      targetType: 'card', targetId: cardId, sourceType: unavailable, sourceRef: `${unavailable}-not-authoritative`
    }).expect(422);
    assert.equal(rejected.body.code, 'JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE');
  }
  const opaque = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_response', sourceRef: 'made-up-response'
  }).expect(404);
  assert.equal(opaque.body.code, 'JOURNEY_EVIDENCE_SOURCE_NOT_FOUND');

  // Assistant artefacts are user-private even inside a shared space. The link
  // snapshot and live source endpoint both fail closed for another member.
  const collaborator = request.agent(app);
  const collaboratorAccount = await signupVerifyAndOnboard(collaborator, {
    name: 'Journey evidence collaborator', email: 'journey-evidence-collaborator@example.test',
    password: 'Journey-Evidence-Collaborator-Password-2026!'
  });
  const collaboratorIdentity = await activeIdentity(collaborator);
  const foreignSource = seedSurveyEvidence(collaboratorIdentity.spaceId, 'cross-space-adapter');
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'admin',?,?)`).run(identity.spaceId, collaboratorAccount.body.user.id, now, now);
  const sharedHeaders = { 'X-Seemplify-Space': identity.spaceId };
  const assistantLink = links.find((link) => link.sourceType === 'assistant_artifact');
  await collaborator.get(`/api/journey-evidence/${assistantLink.id}/source`).set(sharedHeaders).expect(404);
  const privateDiscovery = await collaborator.get('/api/journey-evidence/sources').set(sharedHeaders)
    .query({ sourceType: 'assistant_artifact', query: 'Onboarding action brief' }).expect(200);
  assert.equal(privateDiscovery.body.sources.length, 0, 'assistant discovery must retain requested-by ownership');
  const crossSpaceDiscovery = await collaborator.get('/api/journey-evidence/sources').set(sharedHeaders)
    .query({ sourceType: 'survey_response', query: 'cross-space-adapter' }).expect(200);
  assert.equal(crossSpaceDiscovery.body.sources.length, 0, 'source discovery must not cross the selected space');
  const collaboratorLinks = await collaborator.get('/api/journey-evidence').set(sharedHeaders)
    .query({ targetType: 'card', targetId: cardId }).expect(200);
  const restrictedAssistantLink = collaboratorLinks.body.links.find((link: any) => link.id === assistantLink.id);
  assert.ok(restrictedAssistantLink, 'the relationship should remain visible for evidence review');
  assert.equal(restrictedAssistantLink.sourceAccess, 'inaccessible');
  assert.equal(restrictedAssistantLink.refreshStatus, 'unavailable');
  assert.equal(restrictedAssistantLink.sourceRef, 'restricted');
  assert.equal(restrictedAssistantLink.sourceLabel, 'Linked source unavailable');
  assert.equal(restrictedAssistantLink.excerpt, '');
  assert.equal(restrictedAssistantLink.population, '');
  assert.equal(restrictedAssistantLink.sampleSize, null);
  assert.equal(restrictedAssistantLink.collectedAt, null);

  await collaborator.post('/api/journey-evidence').set(sharedHeaders).send({
    targetType: 'card', targetId: cardId,
    sourceType: 'survey_response', sourceRef: foreignSource.responseId
  }).expect(404);

  const collaboratorMap = await collaborator.post('/api/journey-maps').set(sharedHeaders)
    .send({ name: 'Collaborator evidence map', stageNames: ['Start'] }).expect(201);
  const collaboratorRead = await collaborator.get(`/api/journey-maps/${collaboratorMap.body.id}`).set(sharedHeaders).expect(200);
  const collaboratorCard = await collaborator.post(`/api/journey-maps/${collaboratorMap.body.id}/cards`).set(sharedHeaders)
    .send({ expectedRevision: collaboratorRead.body.definition.revision,
      stageKey: collaboratorRead.body.stages[0].stageKey, kind: 'opportunity', title: 'Private source probe' }).expect(201);
  await collaborator.post('/api/journey-evidence').set(sharedHeaders).send({
    targetType: 'card', targetId: collaboratorCard.body.cards[0].id,
    sourceType: 'assistant_artifact', sourceRef: assistantRunId
  }).expect(404);
});

test('evidence lifecycle detects source changes, refreshes explicitly, audits hashes, and redacts unavailable sources', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const source = seedSurveyEvidence(identity.spaceId, 'evidence-lifecycle');
  const created = await agent.post('/api/journey-maps')
    .send({ name: 'Evidence lifecycle map', stageNames: ['Onboard'] }).expect(201);
  let map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  map = (await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    kind: 'pain_point',
    title: 'Setup guidance creates effort'
  }).expect(201)).body;
  const originalCardId = String(map.cards[0].id);
  const attached = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: originalCardId,
    sourceType: 'survey_response', sourceRef: source.responseId,
    assessment: 'supports'
  }).expect(201);
  assert.equal(attached.body.sourceAccess, 'available');
  assert.equal(attached.body.refreshStatus, 'current');
  assert.match(attached.body.snapshotFingerprint, /^[a-f0-9]{64}$/u);
  const reviewedExcerpt = String(attached.body.excerpt);

  const changedAt = new Date(Date.now() + 1_000).toISOString();
  db.prepare('UPDATE responses SET answers_json=?,analyzed_at=? WHERE id=?')
    .run(JSON.stringify({ [source.questionId]: 'The revised setup flow is now difficult on mobile.' }), changedAt, source.responseId);
  const changed = await agent.get('/api/journey-evidence')
    .query({ targetType: 'card', targetId: originalCardId }).expect(200);
  const changedLink = changed.body.links[0];
  assert.equal(changedLink.refreshStatus, 'changed');
  assert.ok(changedLink.changedFields.includes('excerpt'));
  assert.ok(changedLink.changedFields.includes('sourceUpdatedAt'));
  assert.equal(changedLink.excerpt, reviewedExcerpt, 'source changes must not silently rewrite the reviewed snapshot');
  assert.doesNotMatch(changedLink.excerpt, /revised setup flow/iu);

  const stale = await agent.post(`/api/journey-evidence/${attached.body.id}/refresh`)
    .send({ expectedFingerprint: '0'.repeat(64) }).expect(409);
  assert.equal(stale.body.code, 'EVIDENCE_REFRESH_CONFLICT');
  const refreshed = await agent.post(`/api/journey-evidence/${attached.body.id}/refresh`)
    .send({ expectedFingerprint: changedLink.snapshotFingerprint }).expect(200);
  assert.equal(refreshed.body.refreshStatus, 'current');
  assert.match(refreshed.body.excerpt, /revised setup flow/iu);
  assert.equal(refreshed.body.sourceUpdatedAt, changedAt);
  assert.ok(Number.isFinite(Date.parse(refreshed.body.lastValidatedAt)));
  assert.notEqual(refreshed.body.lastValidatedAt, attached.body.lastValidatedAt);

  const audit = await agent.get(`/api/journey-evidence/${attached.body.id}/audit`).expect(200);
  assert.equal(audit.body.events.length, 1);
  assert.equal(audit.body.events[0].action, 'refreshed');
  assert.ok(audit.body.events[0].changedFields.includes('excerpt'));
  assert.match(audit.body.events[0].beforeFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(audit.body.events[0].afterFingerprint, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(audit.body), /revised setup flow|difficult on mobile/iu,
    'refresh audit records must not copy evidence content');

  map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  const published = await agent.post(`/api/journey-maps/${created.body.id}/publish`)
    .send({ expectedRevision: map.definition.revision }).expect(200);
  const immutable = await agent.post(`/api/journey-evidence/${attached.body.id}/refresh`)
    .send({ expectedFingerprint: refreshed.body.snapshotFingerprint }).expect(409);
  assert.equal(immutable.body.code, 'JOURNEY_EVIDENCE_TARGET_IMMUTABLE');

  // The current draft received a version-pinned copy. If the source is later
  // deleted or becomes unusable, the relationship remains reviewable but no
  // historical source identity or content is disclosed to the viewer.
  const draftCardId = String(published.body.journeyMap.cards[0].id);
  db.prepare("UPDATE responses SET status='in_progress' WHERE id=?").run(source.responseId);
  const unavailable = await agent.get('/api/journey-evidence')
    .query({ targetType: 'card', targetId: draftCardId }).expect(200);
  assert.equal(unavailable.body.links.length, 1);
  const restricted = unavailable.body.links[0];
  assert.equal(restricted.sourceAccess, 'inaccessible');
  assert.equal(restricted.refreshStatus, 'unavailable');
  assert.equal(restricted.sourceRef, 'restricted');
  assert.equal(restricted.sourceLabel, 'Linked source unavailable');
  assert.equal(restricted.excerpt, '');
  assert.equal(restricted.population, '');
  assert.equal(restricted.sampleSize, null);
  assert.equal(restricted.collectedAt, null);
  assert.doesNotMatch(JSON.stringify(restricted), new RegExp(source.responseId, 'u'));
  assert.doesNotMatch(JSON.stringify(restricted), /revised setup flow|difficult on mobile/iu);

  const degraded = await agent.get(`/api/journey-maps/${created.body.id}`).expect(200);
  assert.equal(degraded.body.definition.mode, 'designed');
  assert.equal(degraded.body.definition.evidenceLinkCount, 0);
  assert.equal(degraded.body.cards[0].evidence.state, 'hypothesis');
  assert.equal(degraded.body.cards[0].evidence.reason, 'all_links_inaccessible');
  assert.equal(degraded.body.cards[0].evidence.inaccessible, 1);
});

test('a persona is reusable across maps and a legacy audience only becomes a labelled draft', async () => {
  const agent = await adminAgent();
  const legacy = await agent.post('/api/journeys').send({
    name: 'Audience conversion', audience: 'Operations managers', objective: 'Reduce effort',
    industry: 'Logistics', summary: '', stages: legacyStages
  }).expect(201);
  const listed = await agent.get('/api/journey-maps').expect(200);
  const converted = listed.body.journeyMaps.find((item: any) => item.legacyJourneyId === legacy.body.id);

  const drafted = await agent.post(`/api/journey-maps/${converted.id}/personas/from-legacy-audience`).send({}).expect(201);
  assert.equal(drafted.body.persona.name, 'Operations managers');
  assert.equal(drafted.body.persona.lifecycleState, 'draft');
  assert.equal(drafted.body.persona.source, 'legacy_audience_draft');
  assert.match(drafted.body.persona.summary, /Attach evidence/u);
  assert.equal(drafted.body.journeyMap.personas.length, 1);

  const second = await agent.post('/api/journey-maps').send({ name: 'Second map', stageNames: ['Start'] }).expect(201);
  await agent.post(`/api/journey-maps/${second.body.id}/personas`)
    .send({ personaId: drafted.body.persona.id }).expect(200);
  const personas = await agent.get('/api/journey-personas').expect(200);
  const reused = personas.body.personas.find((item: any) => item.id === drafted.body.persona.id);
  assert.equal(reused.linkedJourneyCount, 2, 'one persona should be reused by two maps without duplication');
  assert.equal(reused.evidenceState, 'hypothesis');

  // Editing the persona once updates both maps.
  const renamed = await agent.patch(`/api/journey-personas/${reused.id}`)
    .send({ expectedRevision: reused.revision, name: 'Operations leads', lifecycleState: 'in_review' }).expect(200);
  assert.equal(renamed.body.name, 'Operations leads');
  const secondMap = await agent.get(`/api/journey-maps/${second.body.id}`).expect(200);
  assert.equal(secondMap.body.personas[0].name, 'Operations leads');

  const conflicted = await agent.patch(`/api/journey-personas/${reused.id}`)
    .send({ expectedRevision: reused.revision, name: 'Ignored' }).expect(409);
  assert.equal(conflicted.body.code, 'JOURNEY_PERSONA_REVISION_CONFLICT');
});

test('publishing freezes the reviewed version and opens a fresh draft', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({ name: 'Publishable', stageNames: ['Only'] }).expect(201);
  const definitionId = created.body.id;
  const map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  const withCard = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'action', title: 'Sign in'
  }).expect(201);

  const published = await agent.post(`/api/journey-maps/${definitionId}/publish`)
    .send({ expectedRevision: withCard.body.definition.revision }).expect(200);
  assert.notEqual(published.body.publishedVersionId, published.body.draftVersionId);
  assert.equal(published.body.journeyMap.definition.status, 'published');
  assert.equal(published.body.journeyMap.version.state, 'draft');
  assert.equal(published.body.journeyMap.version.versionNumber, 2);
  assert.equal(published.body.journeyMap.cards.length, 1, 'the new draft should carry the published structure forward');
  assert.equal(published.body.journeyMap.stages.length, 1);

  const frozen = await agent.get(`/api/journey-maps/${definitionId}?versionId=${published.body.publishedVersionId}`).expect(200);
  assert.equal(frozen.body.version.state, 'published');
  assert.ok(frozen.body.version.publishedAt);

  // Editing the draft must not alter the published snapshot.
  const edited = await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: published.body.journeyMap.definition.revision,
    stageKey: published.body.journeyMap.stages[0].stageKey, kind: 'action', title: 'Added after publication'
  }).expect(201);
  assert.equal(edited.body.cards.length, 2);
  const frozenAgain = await agent.get(`/api/journey-maps/${definitionId}?versionId=${published.body.publishedVersionId}`).expect(200);
  assert.equal(frozenAgain.body.cards.length, 1);
});

test('publishing preserves immutable evidence and carries version-pinned links into the new draft', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const source = seedSurveyEvidence(identity.spaceId, 'evidence-publication');
  const created = await agent.post('/api/journey-maps')
    .send({ name: 'Evidence publication', stageNames: ['Onboard'] }).expect(201);
  const definitionId = created.body.id;
  let map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  map = (await agent.post(`/api/journey-maps/${definitionId}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey,
    kind: 'pain_point', title: 'Setup takes too long'
  }).expect(201)).body;
  const publishedStageId = map.stages[0].id;
  const publishedCardId = map.cards[0].id;

  const persona = await agent.post('/api/journey-personas').send({ name: 'Evidence publication persona' }).expect(201);
  map = (await agent.post(`/api/journey-maps/${definitionId}/personas`)
    .send({ personaId: persona.body.id }).expect(200)).body;

  const definitionEvidence = await agent.post('/api/journey-evidence').send({
    targetType: 'definition', targetId: definitionId, sourceType: 'survey_analysis',
    sourceRef: source.insightId
  }).expect(201);
  const personaEvidence = await agent.post('/api/journey-evidence').send({
    targetType: 'persona', targetId: persona.body.id, sourceType: 'survey_response',
    sourceRef: source.responseId
  }).expect(201);
  const stageEvidence = await agent.post('/api/journey-evidence').send({
    targetType: 'stage', targetId: publishedStageId, sourceType: 'ticket',
    sourceRef: source.ticketId
  }).expect(201);
  const cardEvidence = await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: publishedCardId, sourceType: 'survey_response',
    sourceRef: source.responseId
  }).expect(201);

  map = (await agent.get(`/api/journey-maps/${definitionId}`).expect(200)).body;
  assert.equal(map.definition.evidenceLinkCount, 4, 'all supported target types should contribute to map evidence');
  assert.equal(map.definition.mode, 'evidence_backed');

  const published = await agent.post(`/api/journey-maps/${definitionId}/publish`)
    .send({ expectedRevision: map.definition.revision }).expect(200);
  const draft = published.body.journeyMap;
  assert.equal(draft.definition.evidenceLinkCount, 4);
  assert.equal(draft.definition.mode, 'evidence_backed');
  assert.notEqual(draft.stages[0].id, publishedStageId);
  assert.notEqual(draft.cards[0].id, publishedCardId);

  const draftStageLinks = await agent.get('/api/journey-evidence')
    .query({ targetType: 'stage', targetId: draft.stages[0].id }).expect(200);
  const draftCardLinks = await agent.get('/api/journey-evidence')
    .query({ targetType: 'card', targetId: draft.cards[0].id }).expect(200);
  assert.equal(draftStageLinks.body.links.length, 1);
  assert.equal(draftStageLinks.body.links[0].sourceRef, `recovery-ticket:${source.ticketId}`);
  assert.notEqual(draftStageLinks.body.links[0].id, stageEvidence.body.id);
  assert.equal(draftCardLinks.body.links.length, 1);
  assert.equal(draftCardLinks.body.links[0].sourceRef, `survey-response:${source.responseId}`);
  assert.notEqual(draftCardLinks.body.links[0].id, cardEvidence.body.id);

  const frozen = await agent.get(`/api/journey-maps/${definitionId}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  assert.equal(frozen.body.definition.evidenceLinkCount, 4,
    'a historical read must report its own version-pinned evidence, not the current draft counts');
  assert.equal(frozen.body.definition.mode, 'evidence_backed');
  assert.equal(frozen.body.cards[0].evidenceLinkCount, 1);

  // Reviewed stage/card evidence cannot be rewritten through the generic
  // evidence API after publication; authors work on the carried draft copies.
  await agent.patch(`/api/journey-evidence/${cardEvidence.body.id}`)
    .send({ confidence: 0.1 }).expect(409);
  await agent.delete(`/api/journey-evidence/${stageEvidence.body.id}`).expect(409);
  await agent.post('/api/journey-evidence').send({
    targetType: 'stage', targetId: publishedStageId, sourceType: 'observation',
    sourceRef: 'observation:late-published-edit'
  }).expect(409);

  // Removing the carried draft relationships cannot erase the immutable
  // published evidence. Definition/persona links still count for both maps.
  await agent.delete(`/api/journey-evidence/${draftStageLinks.body.links[0].id}`).expect(204);
  await agent.delete(`/api/journey-evidence/${draftCardLinks.body.links[0].id}`).expect(204);
  const changedDraft = await agent.get(`/api/journey-maps/${definitionId}`).expect(200);
  assert.equal(changedDraft.body.definition.evidenceLinkCount, 2);
  assert.equal(changedDraft.body.definition.mode, 'evidence_backed');
  const frozenAgain = await agent.get(`/api/journey-maps/${definitionId}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  assert.equal(frozenAgain.body.definition.evidenceLinkCount, 4);
  assert.equal(frozenAgain.body.cards[0].evidenceLinkCount, 1);

  // Shared evidence is not duplicated because its stable target survives the
  // publication boundary; only stage/card targets require deterministic copies.
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_evidence_links WHERE id IN (?,?)')
    .get(definitionEvidence.body.id, personaEvidence.body.id) as any).count, 2);
});

test('exports declare mode, version, and an evidence legend in both formats', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({ name: 'Exportable', stageNames: ['Stage one'] }).expect(201);
  const map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'emotion', title: 'Frustrated'
  }).expect(201);

  const json = await agent.get(`/api/journey-maps/${created.body.id}/export.json`).expect(200);
  assert.equal(json.body.mode, 'designed');
  assert.equal(json.body.versionNumber, 1);
  assert.match(json.body.notice, /designed hypothesis/u);
  assert.equal(json.body.legacyCompatible.stages[0].emotions[0], 'Frustrated');

  const csv = await agent.get(`/api/journey-maps/${created.body.id}/export.csv`).expect(200);
  assert.match(csv.text, /^# \{/u);
  assert.match(csv.text, /"Frustrated"/u);
  assert.match(csv.text, /evidenceState/u);
  assert.match(String(csv.headers['content-disposition']),
    new RegExp(`journey-map-${created.body.id}-v1\\.csv`, 'u'));
  await agent.get(`/api/journey-maps/${created.body.id}/export.pdf`).expect(200)
    .expect('Content-Type', /application\/pdf/u)
    .expect('X-Content-Type-Options', 'nosniff');
  await agent.get(`/api/journey-maps/${created.body.id}/export.pptx`).expect(200)
    .expect('Content-Type', /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/u)
    .expect('X-Content-Type-Options', 'nosniff');
  await agent.get(`/api/journey-maps/${created.body.id}/export.png`).expect(200)
    .expect('Content-Type', /image\/png/u)
    .expect('X-Content-Type-Options', 'nosniff');
});

test('journey exports are denied when the active plan disables the export feature', async () => {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Export entitlement user', email: 'journey-export-entitlement@example.test',
    password: 'Journey-Export-Entitlement-2026!', spaceName: 'Export entitlement space'
  });
  const identity = await activeIdentity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(identity.spaceId);
  const created = await agent.post('/api/journey-maps').send({ name: 'Plan governed export' }).expect(201);
  const plan = db.prepare("SELECT features_json FROM platform_subscription_plans WHERE code='starter'")
    .get() as { features_json: string };
  const original = plan.features_json;
  const features = JSON.parse(original) as Record<string, boolean>;
  features.journeyExports = false;
  db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='starter'")
    .run(JSON.stringify(features));
  try {
    const denied = await agent.get(`/api/journey-maps/${created.body.id}/export.json`).expect(403);
    assert.equal(denied.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
    assert.equal(denied.body.details.feature, 'journeyExports');
  } finally {
    db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='starter'").run(original);
  }
});

test('journey plan subfeatures are hidden at the API boundary and design-off blocks both map generations', async () => {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Journey entitlement user', email: 'journey-feature-entitlement@example.test',
    password: 'Journey-Feature-Entitlement-2026!', spaceName: 'Journey entitlement space'
  });
  const identity = await activeIdentity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(identity.spaceId);

  const plan = db.prepare("SELECT features_json FROM platform_subscription_plans WHERE code='starter'")
    .get() as { features_json: string };
  const original = plan.features_json;
  let created: any;
  let cardId = '';
  created = (await agent.post('/api/journey-maps')
    .send({ name: 'Entitled design map', stageNames: ['Discover'] }).expect(201)).body;
  const persona = (await agent.post('/api/journey-personas').send({ name: 'Hidden persona' }).expect(201)).body;
  await agent.post(`/api/journey-maps/${created.id}/personas`).send({ personaId: persona.id }).expect(200);
  const map = (await agent.get(`/api/journey-maps/${created.id}`).expect(200)).body;
  const withCard = await agent.post(`/api/journey-maps/${created.id}/cards`).send({
    expectedRevision: map.definition.revision,
    stageKey: map.stages[0].stageKey,
    kind: 'pain_point',
    title: 'Entitled evidence',
    personaId: persona.id
  }).expect(201);
  cardId = withCard.body.cards[0].id;
  const source = seedSurveyEvidence(identity.spaceId, 'feature-redaction', 1);
  await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: cardId, sourceType: 'survey_response', sourceRef: source.responseId,
    assessment: 'supports', confidence: 0.8
  }).expect(201);
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(identity.spaceId);

  const list = await agent.get('/api/journey-maps').expect(200);
  assert.deepEqual(list.body.personas, [], 'the core map collection must not leak disabled persona records');
  const redacted = await agent.get(`/api/journey-maps/${created.id}`).expect(200);
  assert.deepEqual(redacted.body.personas, []);
  assert.equal(redacted.body.cards[0].personaId, null);
  assert.equal(redacted.body.cards[0].evidenceLinkCount, 0);
  assert.deepEqual(redacted.body.researchGaps, []);
  assert.deepEqual(redacted.body.evidenceSummary, {
    hypothesis: 0, anecdotal: 0, supported: 0, strongly_supported: 0,
    contradicted: 0, stale: 0, invalidated: 0
  });
  const deniedCardPersonaChange = await agent.patch(`/api/journey-maps/${created.id}/cards/${cardId}`).send({
    expectedRevision: redacted.body.definition.revision, personaId: null
  }).expect(403);
  assert.equal(deniedCardPersonaChange.body.details.feature, 'journeyPersonas');
  const unchanged = await agent.get(`/api/journey-maps/${created.id}`).expect(200);
  assert.equal(unchanged.body.definition.revision, redacted.body.definition.revision);

  const personaDenied = await agent.get('/api/journey-personas').expect(403);
  assert.equal(personaDenied.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
  assert.match(String(personaDenied.body.error), /Starter does not include/u);
  const evidenceDenied = await agent.get('/api/journey-evidence')
    .query({ targetType: 'definition', targetId: created.id }).expect(403);
  assert.equal(evidenceDenied.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
  assert.match(String(evidenceDenied.body.error), /Starter does not include/u);

  const features = JSON.parse(original) as Record<string, boolean>;
  features.journeyDesign = false;
  db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='starter'")
    .run(JSON.stringify(features));
  const before = Number((db.prepare('SELECT COUNT(*) count FROM journey_definitions WHERE space_id=?')
    .get(identity.spaceId) as { count: number }).count);
  try {
    const mapListDenied = await agent.get('/api/journey-maps').expect(403);
    assert.equal(mapListDenied.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
    const classicListDenied = await agent.get('/api/journeys').expect(403);
    assert.equal(classicListDenied.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
    await agent.post('/api/journey-maps').send({ name: 'Must not persist' }).expect(403);
    await agent.post(`/api/journey-maps/${created.id}/lanes`).send({
      expectedRevision: withCard.body.definition.revision, title: 'Must not persist'
    }).expect(403);
    assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_definitions WHERE space_id=?')
      .get(identity.spaceId) as { count: number }).count), before);
    assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_lanes lane
      JOIN journey_map_versions version ON version.id=lane.version_id
      WHERE version.definition_id=? AND lane.title='Must not persist'`).get(created.id) as { count: number }).count), 0);
  } finally {
    db.prepare("UPDATE platform_subscription_plans SET features_json=? WHERE code='starter'").run(original);
  }
});

test('journey maps, personas, and evidence are invisible and unwritable across spaces', async () => {
  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, {
    name: 'Outsider', email: 'journey-outsider@example.test', password: 'Outsider-Password-2026!', spaceName: 'Outsider space'
  });
  const owner = await adminAgent();
  const created = await owner.post('/api/journey-maps').send({ name: 'Private map', stageNames: ['Private'] }).expect(201);
  const map = (await owner.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  const persona = await owner.post('/api/journey-personas').send({ name: 'Private persona' }).expect(201);

  await outsider.get(`/api/journey-maps/${created.body.id}`).expect(404);
  await outsider.get(`/api/journey-personas/${persona.body.id}`).expect(404);
  await outsider.delete(`/api/journey-maps/${created.body.id}`).send({ expectedRevision: 1 }).expect(404);
  await outsider.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: 1, stageKey: map.stages[0].stageKey, kind: 'action', title: 'Injected'
  }).expect(404);
  await outsider.post(`/api/journey-maps/${created.body.id}/lanes`).send({
    expectedRevision: 1, title: 'Injected lane'
  }).expect(404);
  // An evidence link may not reach a target in another space.
  await outsider.post('/api/journey-evidence').send({
    targetType: 'card', targetId: map.stages[0].id, sourceType: 'interview', sourceRef: 'interview:x'
  }).expect(404);
  const outsiderList = await outsider.get('/api/journey-maps').expect(200);
  assert.equal(outsiderList.body.journeyMaps.filter((item: any) => item.id === created.body.id).length, 0);
});

test('structural limits and unknown vocabulary are rejected before persistence', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({ name: 'Bounded', stageNames: ['Only'] }).expect(201);
  const map = (await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body;
  await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'not_a_kind', title: 'x'
  }).expect(400);
  await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: 'no-such-stage', kind: 'action', title: 'x'
  }).expect(404);
  await agent.post(`/api/journey-maps/${created.body.id}/cards`).send({
    expectedRevision: map.definition.revision, stageKey: map.stages[0].stageKey, kind: 'action',
    title: 'x'.repeat(journeyLimit() + 1)
  }).expect(400);
  await agent.post('/api/journey-evidence').send({
    targetType: 'card', targetId: map.stages[0].id, sourceType: 'astrology', sourceRef: 'x'
  }).expect(400);
  let bounded = map;
  const availableCustomLanes = domain.journeyMapLimits.lanes - map.lanes.length;
  for (let index = 0; index < availableCustomLanes; index += 1) {
    bounded = (await agent.post(`/api/journey-maps/${created.body.id}/lanes`).send({
      expectedRevision: bounded.definition.revision, title: `Bounded lane ${index + 1}`
    }).expect(201)).body;
  }
  const laneLimit = await agent.post(`/api/journey-maps/${created.body.id}/lanes`).send({
    expectedRevision: bounded.definition.revision, title: 'One lane too many'
  }).expect(422);
  assert.equal(laneLimit.body.code, 'JOURNEY_LANE_LIMIT');
  assert.equal((await agent.get(`/api/journey-maps/${created.body.id}`).expect(200)).body.definition.revision,
    bounded.definition.revision, 'the lane limit must fail before a revision is committed');
  function journeyLimit() { return domain.journeyMapLimits.titleChars; }
});

test('the backfill reports deterministic results and stays idempotent across repeats', async () => {
  const agent = await adminAgent();
  await agent.post('/api/journeys').send({
    name: 'Backfill target', audience: 'Everyone', objective: '', industry: '', summary: '', stages: legacyStages
  }).expect(201);
  const first = await agent.post('/api/journey-maps/backfill').send({}).expect(200);
  assert.equal(first.body.failures.length, 0);
  const second = await agent.post('/api/journey-maps/backfill').send({}).expect(200);
  assert.equal(second.body.mapsCreated, 0);
  assert.equal(second.body.alreadyPresent, second.body.journeysExamined);
  assert.ok(second.body.journeysExamined > 0);
});

test('backfill fails closed on malformed legacy JSON without leaving a partial projection', async () => {
  const agent = await adminAgent();
  const identity = await activeIdentity(agent);
  const legacy = await agent.post('/api/journeys').send({
    name: 'Malformed source isolation', audience: 'Everyone', objective: '', industry: '', summary: '', stages: legacyStages
  }).expect(201);
  db.prepare('UPDATE journeys SET stages_json=? WHERE id=?').run('{not-json', legacy.body.id);
  try {
    const report = maps.backfillJourneyMaps({ spaceIds: [identity.spaceId], limit: 500 });
    const failure = report.failures.find((item) => item.journeyId === legacy.body.id);
    assert.equal(failure?.code, 'JOURNEY_LEGACY_SOURCE_INVALID');
    assert.equal(db.prepare('SELECT 1 FROM journey_definitions WHERE legacy_journey_id=?').get(legacy.body.id), undefined);
  } finally {
    db.prepare('UPDATE journeys SET stages_json=? WHERE id=?').run(JSON.stringify(legacyStages), legacy.body.id);
  }
});

test('a member cannot mutate journey maps but can still read them', async () => {
  const agent = await adminAgent();
  const created = await agent.post('/api/journey-maps').send({ name: 'Role gated', stageNames: ['Only'] }).expect(201);
  const session = await agent.get('/api/auth/session').expect(200);
  const invited = await agent.post(`/api/spaces/${session.body.activeSpace.id}/invitations`)
    .send({ email: 'journey-member@example.test', role: 'member' }).expect(201);
  const token = new URL(invited.body.inviteUrl).pathname.split('/').at(-1)!;
  const member = request.agent(app);
  await signupVerifyAndOnboard(member, {
    name: 'Journey member', email: 'journey-member@example.test', password: 'Member-Password-2026!', inviteToken: token
  });
  await member.post(`/api/spaces/invitations/${token}/accept`).send({}).expect(200);
  const readable = await member.get(`/api/journey-maps/${created.body.id}`);
  assert.equal(readable.status, 200);
  const blocked = await member.post(`/api/journey-maps/${created.body.id}/stages`)
    .send({ expectedRevision: readable.body.definition.revision, name: 'Not allowed' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'JOURNEY_MAP_FORBIDDEN');
  const laneBlocked = await member.post(`/api/journey-maps/${created.body.id}/lanes`)
    .send({ expectedRevision: readable.body.definition.revision, title: 'Not allowed either' });
  assert.equal(laneBlocked.status, 403);
  assert.equal(laneBlocked.body.code, 'JOURNEY_MAP_FORBIDDEN');
  const compactMoveBlocked = await member.post(
    `/api/journey-maps/${created.body.id}/cards/11111111-1111-4111-8111-111111111111/move`
  ).send({ expectedRevision: readable.body.definition.revision, responseMode: 'affected_cells' });
  assert.equal(compactMoveBlocked.status, 403);
  assert.equal(compactMoveBlocked.body.code, 'JOURNEY_MAP_FORBIDDEN');
});

test('deleting a legacy journey removes its derived map instead of orphaning it', async () => {
  const agent = await adminAgent();
  const legacy = await agent.post('/api/journeys').send({
    name: 'Disposable', audience: '', objective: '', industry: '', summary: '', stages: legacyStages
  }).expect(201);
  await agent.get('/api/journey-maps').expect(200);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_definitions WHERE legacy_journey_id=?')
    .get(legacy.body.id) as any).count, 1);
  await agent.delete(`/api/journeys/${legacy.body.id}`).send({ expectedUpdatedAt: legacy.body.updatedAt }).expect(204);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_definitions WHERE legacy_journey_id=?')
    .get(legacy.body.id) as any).count, 0);
});

test('the legacy compatibility adapter renders a Map 2.0 version back into the v1 shape', async () => {
  const agent = await adminAgent();
  const legacy = await agent.post('/api/journeys').send({
    name: 'Adapter check', audience: 'Buyers', objective: 'Objective', industry: 'Retail',
    summary: 'Summary', stages: legacyStages
  }).expect(201);
  await agent.get('/api/journey-maps').expect(200);
  const definition = (db.prepare('SELECT id,space_id FROM journey_definitions WHERE legacy_journey_id=?')
    .get(legacy.body.id) as { id: string; space_id: string });
  const rendered = maps.legacyJourneyFromMap(maps.getJourneyMap(definition.space_id, definition.id)!);
  assert.equal(rendered.id, legacy.body.id);
  assert.equal(rendered.audience, 'Buyers');
  assert.deepEqual(rendered.stages.map((stage) => stage.name), ['Discover', 'Activate']);
  assert.deepEqual(rendered.stages[0].touchpoints, ['Website', 'Search']);
  assert.deepEqual(rendered.stages[0].recommendedActions, ['Publish use-case guidance']);
  assert.deepEqual(rendered.stages[1].metrics, ['Time to value']);

  // Projections written by the pre-P1-02 converter did not have the nested
  // `legacySnapshot`/`legacyProvenance` metadata. The compatibility reader must
  // keep those rows readable throughout the mixed-version window.
  const currentVersionId = maps.getJourneyMap(definition.space_id, definition.id)!.version.id;
  db.prepare('UPDATE journey_map_versions SET provenance_json=? WHERE id=?').run(JSON.stringify({
    ...legacy.body.provenance, convertedFrom: 'journey_v1', schemaVersion: domain.JOURNEY_MAP_SCHEMA_VERSION
  }), currentVersionId);
  const oldProjection = maps.legacyJourneyFromMap(maps.getJourneyMap(definition.space_id, definition.id)!);
  assert.deepEqual(oldProjection, legacy.body);
});
