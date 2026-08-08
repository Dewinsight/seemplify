import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-stage-processing-'));
const files = Object.fromEntries(['admin-password', 'session-secret', 'x-key', 'esign-key', 'identity-key']
  .map((name) => [name, path.join(root, name)]));
fs.writeFileSync(files['admin-password']!, 'Journey-Stage-Test-2026!');
fs.writeFileSync(files['session-secret']!, 'journey-stage-test-session-secret-that-is-long-enough');
fs.writeFileSync(files['x-key']!, Buffer.alloc(32, 51).toString('base64url'));
fs.writeFileSync(files['esign-key']!, Buffer.alloc(32, 52).toString('base64url'));
fs.writeFileSync(files['identity-key']!, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-stage@seemplify.local', ADMIN_PASSWORD_FILE: files['admin-password'],
  SESSION_SECRET_FILE: files['session-secret'], EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files['x-key'], ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files['esign-key'], JOURNEY_IDENTITY_HASH_KEY_FILE: files['identity-key'],
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const {
  claimNextJourneyStageEvent, failJourneyStageEvent, processJourneyStageEvent,
  JourneyStageProcessingError
} = await import('../src/journeyStageProcessing.js');
const { replayJourneyEventDeadLetter } = await import('../src/journeyEventIngestionRepository.js');
const { signupVerifyAndOnboard } = await import('./authTestHelper.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const control = '/api/journey-event-control-plane';
const rulesBase = '/api/journey-stage-rules';
const origin = 'https://stage-rules.example.test';
const idem = (value: string) => ({ 'Idempotency-Key': value });
const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

async function owner() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-stage@seemplify.local', password: 'Journey-Stage-Test-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id); const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, userId, spaceId };
}

type Property = {
  name: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required: boolean;
  dataClass: 'operational' | 'personal' | 'sensitive' | 'prohibited_content'; description: string;
  maximumLength?: number; enumValues?: Array<string | number | boolean>;
};

async function trackingSource(agent: ReturnType<typeof request.agent>, suffix: string,
  schemas: Array<{ event: string; properties: Property[] }>, issueCredential = false) {
  const source = await agent.post(`${control}/sources`).set(idem(`stage-source-${suffix}`)).send({
    name: `Stage source ${suffix}`, environment: 'production', validationMode: 'enforce', allowedOrigins: [origin],
    allowedBundleIds: [], eventsPerMinute: 10_000, bytesPerMinute: 10_000_000
  }).expect(201);
  const sourceId = String(source.body.source.id);
  let secret = '';
  let serverSecret = '';
  if (issueCredential) {
    const credential = await agent.post(`${control}/sources/${sourceId}/credentials`)
      .set(idem(`stage-key-${suffix}`)).send({ kind: 'public_write' }).expect(201);
    secret = String(credential.body.secret);
    const server = await agent.post(`${control}/sources/${sourceId}/credentials`)
      .set(idem(`stage-server-key-${suffix}`)).send({ kind: 'server_secret' }).expect(201);
    serverSecret = String(server.body.secret);
  }
  for (const schemaInput of schemas) {
    const schema = await agent.post(`${control}/sources/${sourceId}/schemas`)
      .set(idem(`stage-schema-${suffix}-${schemaInput.event}`)).send({ eventName: schemaInput.event }).expect(201);
    const version = await agent.post(`${control}/schemas/${schema.body.schema.id}/versions`)
      .set(idem(`stage-schema-version-${suffix}-${schemaInput.event}`))
      .send({ version: '1.0', properties: schemaInput.properties }).expect(201);
    await agent.post(`${control}/schema-versions/${version.body.version.id}/publish`).send({}).expect(200);
  }
  return { sourceId, secret, serverSecret };
}

async function publishedMap(agent: ReturnType<typeof request.agent>, name: string) {
  const created = await agent.post('/api/journey-maps').send({ name, stageNames: ['Start', 'Value'] }).expect(201);
  const map = await agent.get(`/api/journey-maps/${created.body.id}`).expect(200);
  const published = await agent.post(`/api/journey-maps/${created.body.id}/publish`)
    .send({ expectedRevision: map.body.definition.revision }).expect(200);
  const snapshot = await agent.get(`/api/journey-maps/${created.body.id}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  return { definitionId: String(created.body.id), versionId: String(published.body.publishedVersionId),
    stages: snapshot.body.stages as Array<{ stageKey: string; name: string }> };
}

function envelope(eventId: string, event: string, anonymousId: string, occurredAt: string,
  properties: Record<string, unknown> = { plan_id: 'team' }) {
  return {
    protocolVersion: '1.0', eventId, call: 'track', event, eventVersion: 1, occurredAt,
    anonymousId, properties, context: { library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'test-cmp', updatedAt: occurredAt }
  };
}

async function createAndPublishRule(input: {
  agent: ReturnType<typeof request.agent>; map: Awaited<ReturnType<typeof publishedMap>>; sourceId: string;
  name: string; eventName: string; stageIndex: number; role: 'entry' | 'progress' | 'success' | 'failure' | 'exit';
}) {
  const created = await input.agent.post(`${rulesBase}/${input.map.definitionId}/rules`).send({
    name: input.name, journeyMapVersionId: input.map.versionId,
    stageKey: input.map.stages[input.stageIndex]!.stageKey, role: input.role, priority: 100,
    eventName: input.eventName, sourceIds: [input.sourceId], environments: ['production'],
    predicates: [{ path: 'plan_id', operator: 'equals', value: 'team' }]
  }).expect(201);
  const published = await input.agent.post(`${rulesBase}/${input.map.definitionId}/rules/${created.body.rule.id}/publish`)
    .send({ expectedRevision: created.body.rule.revision });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return published.body.rule;
}

test('published rules process accepted events with fencing, privacy, event-time ordering, and bounded replay', async () => {
  const current = await owner();
  const operational: Property[] = [
    { name: 'plan_id', type: 'string', required: true, dataClass: 'operational', description: 'Bounded plan.',
      maximumLength: 32, enumValues: ['team', 'enterprise'] },
    { name: 'actor_user_id', type: 'string', required: false, dataClass: 'personal', description: 'Private actor.', maximumLength: 128 }
  ];
  const source = await trackingSource(current.agent, 'primary', [
    { event: 'workspace_created', properties: operational },
    { event: 'workspace_activated', properties: operational }
  ], true);
  const map = await publishedMap(current.agent, 'Connected activation');

  const entry = await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId,
    name: 'Workspace entered', eventName: 'workspace_created', stageIndex: 0, role: 'entry' });
  const success = await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId,
    name: 'Workspace reached value', eventName: 'workspace_activated', stageIndex: 1, role: 'success' });
  assert.equal(entry.versions.find((version: any) => version.state === 'published').journeyMapVersionId, map.versionId);

  const simulation = await current.agent.post(`${rulesBase}/${map.definitionId}/simulate`).send({
    useDrafts: false,
    event: { messageId: crypto.randomUUID(), eventName: 'workspace_created', timestamp: new Date().toISOString(),
      subjectId: 'simulated-subject', sourceId: source.sourceId, environment: 'production', properties: { plan_id: 'team' } }
  }).expect(200);
  assert.equal(simulation.body.matches.length, 1);
  assert.deepEqual(simulation.body.matches[0].reasons, ['predicate_matched:plan_id:equals', 'rule_matched']);

  // Drafts may be saved, but publish/simulate fail closed on private fields.
  const unsafe = await current.agent.post(`${rulesBase}/${map.definitionId}/rules`).send({
    name: 'Unsafe actor predicate', journeyMapVersionId: map.versionId, stageKey: map.stages[0]!.stageKey,
    role: 'entry', priority: 1, eventName: 'workspace_created', sourceIds: [source.sourceId],
    environments: ['production'], predicates: [{ path: 'actor_user_id', operator: 'equals', value: 'private-user' }]
  }).expect(201);
  const unsafePublish = await current.agent.post(`${rulesBase}/${map.definitionId}/rules/${unsafe.body.rule.id}/publish`)
    .send({ expectedRevision: unsafe.body.rule.revision }).expect(400);
  assert.equal(unsafePublish.body.code, 'JOURNEY_STAGE_RULE_PROPERTY_CLASS_FORBIDDEN');

  const secondary = await trackingSource(current.agent, 'secondary', [{
    event: 'workspace_created', properties: [
      { name: 'plan_id', type: 'number', required: true, dataClass: 'operational', description: 'Incompatible plan.' }
    ]
  }]);
  const inconsistent = await current.agent.post(`${rulesBase}/${map.definitionId}/rules`).send({
    name: 'Inconsistent predicate', journeyMapVersionId: map.versionId, stageKey: map.stages[0]!.stageKey,
    role: 'entry', priority: 1, eventName: 'workspace_created', sourceIds: [source.sourceId, secondary.sourceId],
    environments: ['production'], predicates: [{ path: 'plan_id', operator: 'equals', value: 'team' }]
  }).expect(201);
  const inconsistentPublish = await current.agent.post(`${rulesBase}/${map.definitionId}/rules/${inconsistent.body.rule.id}/publish`)
    .send({ expectedRevision: inconsistent.body.rule.revision }).expect(400);
  assert.equal(inconsistentPublish.body.code, 'JOURNEY_STAGE_RULE_PROPERTY_INCONSISTENT');

  const editableDraft = {
    name: 'Editable governed rule', journeyMapVersionId: map.versionId, stageKey: map.stages[0]!.stageKey,
    role: 'progress', priority: 20, eventName: 'workspace_created', sourceIds: [source.sourceId],
    environments: ['production'], predicates: [{ path: 'plan_id', operator: 'equals', value: 'team' }]
  };
  const editable = await current.agent.post(`${rulesBase}/${map.definitionId}/rules`).send(editableDraft).expect(201);
  const updated = await current.agent.put(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/draft`)
    .send({ expectedRevision: editable.body.rule.revision, draft: { ...editableDraft, priority: 30 } }).expect(200);
  await current.agent.put(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/draft`)
    .send({ expectedRevision: editable.body.rule.revision, draft: editableDraft }).expect(409);
  const firstPublished = await current.agent.post(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/publish`)
    .send({ expectedRevision: updated.body.rule.revision }).expect(200);
  const cloned = await current.agent.put(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/draft`)
    .send({ expectedRevision: firstPublished.body.rule.revision,
      draft: { ...editableDraft, priority: 40 } }).expect(200);
  const secondPublished = await current.agent.post(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/publish`)
    .send({ expectedRevision: cloned.body.rule.revision }).expect(200);
  assert.deepEqual(secondPublished.body.rule.versions.map((version: any) => version.state).sort(), ['published', 'retired']);
  const retired = await current.agent.post(`${rulesBase}/${map.definitionId}/rules/${editable.body.rule.id}/retire`)
    .send({ expectedRevision: secondPublished.body.rule.revision }).expect(200);
  assert.equal(retired.body.rule.publishedVersionId, null);
  assert.ok(retired.body.rule.versions.every((version: any) => version.state === 'retired'));

  const otherMap = await publishedMap(current.agent, 'Other governed map');
  const crossVersion = await current.agent.post(`${rulesBase}/${map.definitionId}/rules`).send({
    name: 'Cross-version splice', journeyMapVersionId: otherMap.versionId, stageKey: otherMap.stages[0]!.stageKey,
    role: 'entry', priority: 1, eventName: 'workspace_created', sourceIds: [source.sourceId], environments: ['production']
  }).expect(400);
  assert.equal(crossVersion.body.code, 'JOURNEY_STAGE_RULE_STAGE_VERSION_MISMATCH');

  const base = Date.now(); const anonymous = 'private-anonymous-stage-subject';
  const activatedId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
    .send(envelope(activatedId, 'workspace_activated', anonymous, new Date(base - 60_000).toISOString())).expect(202);
  const activatedClaim = claimNextJourneyStageEvent('stage-test-worker', new Date(base + 1_000));
  assert.ok(activatedClaim); processJourneyStageEvent(activatedClaim!, { now: new Date(base + 2_000) });

  const createdId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
    .send(envelope(createdId, 'workspace_created', anonymous, new Date(base - 120_000).toISOString())).expect(202);
  const createdClaim = claimNextJourneyStageEvent('stage-test-worker', new Date(base + 3_000));
  assert.ok(createdClaim); processJourneyStageEvent(createdClaim!, { now: new Date(base + 4_000) });

  const instanceRow = db.prepare(`SELECT id,state,current_stage_key FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=?`).get(current.spaceId, map.definitionId) as any;
  assert.equal(instanceRow.state, 'succeeded');
  assert.equal(instanceRow.current_stage_key, map.stages[1]!.stageKey,
    'an older arrival cannot regress the current stage or terminal state');
  const visits = db.prepare(`SELECT role,is_out_of_order,applied_to_current FROM journey_anonymous_stage_visits
    WHERE instance_id=? ORDER BY event_occurred_at`).all(instanceRow.id) as any[];
  assert.deepEqual(visits.map((visit) => [visit.role, Number(visit.is_out_of_order), Number(visit.applied_to_current)]),
    [['entry', 1, 0], ['success', 0, 1]]);

  const postTerminalId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
    .send(envelope(postTerminalId, 'workspace_created', anonymous, new Date(base + 4_100).toISOString())).expect(202);
  const postTerminalClaim = claimNextJourneyStageEvent('terminal-policy-worker', new Date(base + 4_200))!;
  processJourneyStageEvent(postTerminalClaim, { now: new Date(base + 4_300) });
  const afterTerminal = db.prepare(`SELECT state,current_stage_key FROM journey_anonymous_instances WHERE id=?`)
    .get(instanceRow.id) as any;
  assert.deepEqual(afterTerminal, { state: 'succeeded', current_stage_key: map.stages[1]!.stageKey });
  const terminalVisit = db.prepare(`SELECT applied_to_current,non_application_reason FROM journey_anonymous_stage_visits
    WHERE event_id=?`).get(postTerminalId) as any;
  assert.deepEqual(terminalVisit, { applied_to_current: 0, non_application_reason: 'terminal_absorbing' });

  const decisionRow = db.prepare(`SELECT id FROM journey_stage_rule_decisions
    WHERE event_id=? AND journey_definition_id=?`).get(createdId, map.definitionId) as { id: string };
  const explain = await current.agent.get(`${rulesBase}/${map.definitionId}/decisions/${decisionRow.id}`).expect(200);
  const decisionFields = ['id', 'eventId', 'journeyDefinitionId', 'journeyMapVersionId', 'outcome',
    'matchedRuleDefinitionId', 'matchedRuleVersionId', 'matchedRuleVersionNumber', 'stageKey', 'role',
    'eventOccurredAt', 'evaluatedAt', 'isLate', 'isOutOfOrder', 'ruleSetSha256', 'trace', 'provenance',
    'processor', 'processorVersion'].sort();
  assert.deepEqual(Object.keys(explain.body.decision).sort(), decisionFields);
  const protectedSentinels = ['private-anonymous-stage-subject', 'anonymous_id_hash', 'payload_json', 'properties',
    'context', 'consent', 'envelopeSha256', 'rawEventId', 'leaseToken', 'private-user'];
  for (const sentinel of protectedSentinels) assert.equal(JSON.stringify(explain.body).includes(sentinel), false, sentinel);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_stage_rule_audit_events
    WHERE action='decision.viewed' AND space_id=?`).get(current.spaceId) as any).count), 1);

  const list = await current.agent.get(`${rulesBase}/${map.definitionId}/instances`).expect(200);
  assert.deepEqual(Object.keys(list.body.instances[0]).sort(), ['id', 'sourceId', 'environment', 'subjectKind',
    'state', 'currentStageKey', 'firstEventAt', 'latestEventAt', 'latestEventId', 'latestVisitId', 'revision',
    'createdAt', 'updatedAt'].sort());
  assert.equal(JSON.stringify(list.body).includes(anonymous), false);
  const detail = await current.agent.get(`${rulesBase}/${map.definitionId}/instances/${instanceRow.id}`).expect(200);
  assert.deepEqual(Object.keys(detail.body.visits[0]).sort(), ['id', 'decisionId', 'eventId', 'journeyMapVersionId',
    'stageKey', 'role', 'ruleDefinitionId', 'ruleVersionId', 'ruleVersionNumber', 'eventOccurredAt', 'visitedAt',
    'isLate', 'isOutOfOrder', 'appliedToCurrent', 'nonApplicationReason', 'priorStageKey'].sort());
  assert.equal(JSON.stringify(detail.body).includes(anonymous), false);

  // Known-only identities are explicitly skipped until the identity-merging phase; they cannot be projected as anonymous.
  const knownOnlyId = crypto.randomUUID();
  const knownEnvelope: any = envelope(knownOnlyId, 'workspace_created', 'remove-me', new Date(base + 4_500).toISOString());
  delete knownEnvelope.anonymousId; knownEnvelope.userId = 'private-known-user';
  knownEnvelope.consent.personalisation = 'granted';
  await request(app).post('/v1/events').set(auth(source.serverSecret)).send(knownEnvelope).expect(202);
  const knownClaim = claimNextJourneyStageEvent('known-only-worker', new Date(base + 4_700))!;
  processJourneyStageEvent(knownClaim, { now: new Date(base + 4_800) });
  const knownDecision = db.prepare(`SELECT outcome,matched_rule_definition_id,stage_key
    FROM journey_stage_rule_decisions WHERE event_id=?`).get(knownOnlyId) as any;
  assert.deepEqual(knownDecision, {
    outcome: 'skipped_no_anonymous_subject', matched_rule_definition_id: null, stage_key: null
  });
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_anonymous_stage_visits WHERE event_id=?')
    .get(knownOnlyId) as any).count), 0);

  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, { name: 'Journey outsider', email: 'journey-stage-outsider@example.test',
    password: 'Journey-Stage-Outsider-2026!', spaceName: 'Outsider space' });
  const outsiderSession = await outsider.get('/api/auth/session').expect(200);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?")
    .run(String(outsiderSession.body.activeSpace.id));
  await outsider.get(`${rulesBase}/${map.definitionId}/decisions/${decisionRow.id}`).expect(404);
  await outsider.get(`${rulesBase}/${map.definitionId}/instances/${instanceRow.id}`).expect(404);

  // Expired claims are reclaimed with a receipt, while the stale generation is fenced.
  const staleEventId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
    .send(envelope(staleEventId, 'workspace_created', 'stale-subject', new Date(base).toISOString())).expect(202);
  const stale = claimNextJourneyStageEvent('crashed-worker', new Date(base + 5_000), 1_000)!;
  const reclaimed = claimNextJourneyStageEvent('recovery-worker', new Date(base + 7_000), 1_000)!;
  assert.ok(stale && reclaimed); assert.equal(reclaimed.leaseGeneration, stale.leaseGeneration + 1);
  assert.throws(() => processJourneyStageEvent(stale, { now: new Date(base + 7_100) }),
    (value) => value instanceof JourneyStageProcessingError && value.code === 'EVENT_STAGE_PROCESSING_LEASE_LOST');
  const receiptCountBeforeStaleFail = Number((db.prepare(`SELECT COUNT(*) count FROM journey_event_processing_receipts
    WHERE event_id=?`).get(staleEventId) as any).count);
  assert.throws(() => failJourneyStageEvent(stale, new Error('stale-private-error'), new Date(base + 7_150)),
    (value) => value instanceof JourneyStageProcessingError && value.code === 'EVENT_STAGE_PROCESSING_LEASE_LOST');
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_event_processing_receipts
    WHERE event_id=?`).get(staleEventId) as any).count), receiptCountBeforeStaleFail,
  'a stale failure transition cannot append a receipt');
  processJourneyStageEvent(reclaimed, { now: new Date(base + 7_200) });
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_event_processing_receipts
    WHERE event_id=? AND status='lease_expired'`).get(staleEventId) as any).count), 1);

  // Failure injection rolls projections back, retries are bounded, and an audited manual replay can succeed.
  const failedEventId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
    .send(envelope(failedEventId, 'workspace_created', 'retry-subject', new Date(base + 10_000).toISOString())).expect(202);
  let clock = base + 20_000;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claim = claimNextJourneyStageEvent(`failure-worker-${attempt}`, new Date(clock))!;
    assert.ok(claim); assert.equal(claim.attemptNumber, attempt);
    assert.throws(() => processJourneyStageEvent(claim, {
      now: new Date(clock + 100), beforeCommit: () => { throw new Error('private-failure-detail'); }
    }), /private-failure-detail/u);
    const transition = failJourneyStageEvent(claim, new Error('private-failure-detail'), new Date(clock + 200));
    assert.equal(transition.state, attempt < 5 ? 'retry_wait' : 'dead_lettered');
    clock += 24 * 60 * 60_000;
  }
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_stage_rule_decisions
    WHERE event_id=?`).get(failedEventId) as any).count), 0, 'failed transactions cannot leak projections');
  const dead = db.prepare(`SELECT id,state,replay_eligible,redacted_detail_json FROM journey_event_dead_letters
    WHERE event_id=?`).get(failedEventId) as any;
  assert.equal(dead.state, 'pending'); assert.equal(Number(dead.replay_eligible), 1);
  assert.equal(String(dead.redacted_detail_json).includes('private-failure-detail'), false);
  replayJourneyEventDeadLetter({ spaceId: current.spaceId, deadLetterId: dead.id,
    actorUserId: current.userId, now: new Date(clock + 1_000) });
  const replay = claimNextJourneyStageEvent('replay-worker', new Date(clock + 2_000))!;
  processJourneyStageEvent(replay, { now: new Date(clock + 3_000) });
  assert.equal((db.prepare('SELECT state FROM journey_event_dead_letters WHERE id=?').get(dead.id) as any).state, 'resolved');
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_anonymous_stage_visits
    WHERE event_id=?`).get(failedEventId) as any).count), 1);

  // Published versions and projection facts are immutable even through direct SQL.
  const entryPublished = entry.versions.find((version: any) => version.state === 'published');
  assert.throws(() => db.prepare('UPDATE journey_stage_rule_versions SET priority=999 WHERE id=?').run(entryPublished.id),
    /immutable/u);
  assert.throws(() => db.prepare('UPDATE journey_anonymous_stage_visits SET stage_key=? WHERE event_id=?')
    .run(map.stages[0]!.stageKey, activatedId), /append-only/u);
});
