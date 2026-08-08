import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-actual-paths-'));
const files = Object.fromEntries(['admin-password', 'session-secret', 'x-key', 'esign-key', 'identity-key']
  .map((name) => [name, path.join(root, name)]));
fs.writeFileSync(files['admin-password']!, 'Journey-Actual-Paths-2026!');
fs.writeFileSync(files['session-secret']!, 'journey-actual-paths-session-secret-that-is-long-enough');
fs.writeFileSync(files['x-key']!, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(files['esign-key']!, Buffer.alloc(32, 62).toString('base64url'));
fs.writeFileSync(files['identity-key']!, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-actual-paths@seemplify.local', ADMIN_PASSWORD_FILE: files['admin-password'],
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
const { claimNextJourneyStageEvent, processJourneyStageEvent } = await import('../src/journeyStageProcessing.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const control = '/api/journey-event-control-plane';
const rulesBase = '/api/journey-stage-rules';
const origin = 'https://actual-paths.example.test';
const idem = (value: string) => ({ 'Idempotency-Key': value });
const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

async function owner() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-actual-paths@seemplify.local', password: 'Journey-Actual-Paths-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId };
}

type Property = {
  name: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required: boolean;
  dataClass: 'operational' | 'personal' | 'sensitive' | 'prohibited_content'; description: string;
  maximumLength?: number; enumValues?: Array<string | number | boolean>;
};

async function trackingSource(agent: ReturnType<typeof request.agent>, suffix: string,
  schemas: Array<{ event: string; properties: Property[] }>) {
  const source = await agent.post(`${control}/sources`).set(idem(`actual-source-${suffix}`)).send({
    name: `Actual path source ${suffix}`, environment: 'production', validationMode: 'enforce', allowedOrigins: [origin],
    allowedBundleIds: [], eventsPerMinute: 10_000, bytesPerMinute: 10_000_000
  }).expect(201);
  const sourceId = String(source.body.source.id);
  const credential = await agent.post(`${control}/sources/${sourceId}/credentials`)
    .set(idem(`actual-key-${suffix}`)).send({ kind: 'public_write' }).expect(201);
  for (const schemaInput of schemas) {
    const schema = await agent.post(`${control}/sources/${sourceId}/schemas`)
      .set(idem(`actual-schema-${suffix}-${schemaInput.event}`)).send({ eventName: schemaInput.event }).expect(201);
    const version = await agent.post(`${control}/schemas/${schema.body.schema.id}/versions`)
      .set(idem(`actual-schema-version-${suffix}-${schemaInput.event}`))
      .send({ version: '1.0', properties: schemaInput.properties }).expect(201);
    await agent.post(`${control}/schema-versions/${version.body.version.id}/publish`).send({}).expect(200);
  }
  return { sourceId, secret: String(credential.body.secret) };
}

async function publishedMap(agent: ReturnType<typeof request.agent>, name: string) {
  const created = await agent.post('/api/journey-maps').send({ name, stageNames: ['Discover', 'Adopt', 'Expand'] }).expect(201);
  const map = await agent.get(`/api/journey-maps/${created.body.id}`).expect(200);
  const published = await agent.post(`/api/journey-maps/${created.body.id}/publish`)
    .send({ expectedRevision: map.body.definition.revision }).expect(200);
  const snapshot = await agent.get(`/api/journey-maps/${created.body.id}`)
    .query({ versionId: published.body.publishedVersionId }).expect(200);
  return { definitionId: String(created.body.id), versionId: String(published.body.publishedVersionId),
    stages: snapshot.body.stages as Array<{ stageKey: string; id: string; name: string }> };
}

async function createAndPublishRule(input: {
  agent: ReturnType<typeof request.agent>; map: Awaited<ReturnType<typeof publishedMap>>; sourceId: string;
  name: string; eventName: string; stageIndex: number; role: 'entry' | 'progress' | 'success';
}) {
  const created = await input.agent.post(`${rulesBase}/${input.map.definitionId}/rules`).send({
    name: input.name, journeyMapVersionId: input.map.versionId,
    stageKey: input.map.stages[input.stageIndex]!.stageKey, role: input.role, priority: 100,
    eventName: input.eventName, sourceIds: [input.sourceId], environments: ['production']
  }).expect(201);
  await input.agent.post(`${rulesBase}/${input.map.definitionId}/rules/${created.body.rule.id}/publish`)
    .send({ expectedRevision: created.body.rule.revision }).expect(200);
}

function envelope(eventId: string, event: string, anonymousId: string, occurredAt: string) {
  return {
    protocolVersion: '1.0', eventId, call: 'track', event, eventVersion: 1, occurredAt, anonymousId, properties: {},
    context: { library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'test-cmp', updatedAt: occurredAt }
  };
}

async function ingest(secret: string, event: string, anonymousId: string, occurredAt: string) {
  const eventId = crypto.randomUUID();
  await request(app).post('/v1/events').set(auth(secret)).set('Origin', origin)
    .send(envelope(eventId, event, anonymousId, occurredAt)).expect(202);
  const claim = claimNextJourneyStageEvent('actual-paths-worker');
  assert.ok(claim);
  processJourneyStageEvent(claim!);
}

test('journey actual-path analytics route returns descriptive anonymous-path tables for the published journey version', async () => {
  const current = await owner();
  const source = await trackingSource(current.agent, 'primary', [
    { event: 'journey_started', properties: [] },
    { event: 'journey_adopted', properties: [] },
    { event: 'journey_expanded', properties: [] }
  ]);
  const map = await publishedMap(current.agent, 'Observed adoption journey');
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId, name: 'Start', eventName: 'journey_started', stageIndex: 0, role: 'entry' });
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId, name: 'Adopt', eventName: 'journey_adopted', stageIndex: 1, role: 'progress' });
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId, name: 'Expand', eventName: 'journey_expanded', stageIndex: 2, role: 'success' });

  const base = Date.UTC(2026, 7, 5, 9, 0, 0);
  await ingest(source.secret, 'journey_started', 'anon-a', new Date(base).toISOString());
  await ingest(source.secret, 'journey_adopted', 'anon-a', new Date(base + 60_000).toISOString());
  await ingest(source.secret, 'journey_expanded', 'anon-a', new Date(base + 120_000).toISOString());

  await ingest(source.secret, 'journey_started', 'anon-b', new Date(base + 180_000).toISOString());
  await ingest(source.secret, 'journey_expanded', 'anon-b', new Date(base + 240_000).toISOString());

  const response = await current.agent.get('/api/journey-metrics/actual-paths').query({
    journeyDefinitionId: map.definitionId,
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(200);

  assert.equal(response.body.scope.subjectKind, 'anonymous_only');
  assert.equal(response.body.scope.designVersionSource, 'published');
  assert.equal(response.body.analytics.analyticsVersion, 'journey-path-analytics/v1');
  assert.equal(response.body.analytics.sample.acceptedInstanceCount, 2);
  assert.equal(response.body.analytics.sample.acceptedVisitCount, 2);
  assert.equal(response.body.analytics.dataQuality.find((row: any) => row.reason === 'LINEAGE_MISMATCH')?.count, 3);
  assert.match(response.body.scope.notes.at(-1), /3 visits from other lineage versions were excluded/i);
  assert.deepEqual(response.body.analytics.tables.funnel.rows.map((row: any) => row.stageId), map.stages.map((stage) => stage.id));
  assert.ok(response.body.analytics.tables.pathSignatures.rows.length >= 1);
  assert.equal(response.body.designedVsObserved.stageRows.length, 3);
  assert.equal(response.body.designedVsObserved.stageRows[0].status, 'unobserved');
  assert.equal(response.body.designedVsObserved.stageRows[1].status, 'unobserved');
  assert.equal(response.body.designedVsObserved.summary.unobservedStageCount, 3);
  assert.equal(response.body.designedVsObserved.summary.atRiskStageCount, 0);

  const rollup = await current.agent.post('/api/journey-metrics/actual-path-rollups/materialize').send({
    journeyDefinitionId: map.definitionId,
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    asOf: new Date(base + 240_000).toISOString(),
    minimumCohortSize: 1
  }).expect(201);
  assert.equal(rollup.body.updated, false);
  assert.equal(rollup.body.rollup.scopeSubject, 'anonymous_only');
  assert.equal(rollup.body.rollup.summary.unobservedStageCount, 3);
  assert.equal(rollup.body.rollup.result.designedVsObserved.stageRows.length, 3);

  const latestRollup = await current.agent.get('/api/journey-metrics/actual-path-rollups/latest')
    .query({ journeyDefinitionId: map.definitionId }).expect(200);
  assert.equal(latestRollup.body.rollup.id, rollup.body.rollup.id);
  assert.equal(latestRollup.body.rollup.freshness.status, 'current');

  const snapshot = await current.agent.post('/api/journey-metrics/actual-path-snapshots').send({
    journeyDefinitionId: map.definitionId,
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    asOf: new Date(base + 240_000).toISOString(),
    minimumCohortSize: 1
  }).expect(201);
  assert.equal(snapshot.body.snapshot.scopeSubject, 'anonymous_only');
  assert.equal(snapshot.body.snapshot.summary.unobservedStageCount, 3);
  assert.equal(snapshot.body.snapshot.result.designedVsObserved.stageRows.length, 3);

  const latest = await current.agent.get('/api/journey-metrics/actual-path-snapshots/latest')
    .query({ journeyDefinitionId: map.definitionId }).expect(200);
  assert.equal(latest.body.snapshot.id, snapshot.body.snapshot.id);

  const replay = await current.agent.post('/api/journey-metrics/actual-path-snapshots').send({
    journeyDefinitionId: map.definitionId,
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    asOf: new Date(base + 240_000).toISOString(),
    minimumCohortSize: 1
  }).expect(200);
  assert.equal(replay.body.replayed, true);

  await ingest(source.secret, 'journey_started', 'anon-c', new Date(base + 300_000).toISOString());

  const staleRollup = await current.agent.get('/api/journey-metrics/actual-path-rollups/latest')
    .query({ journeyDefinitionId: map.definitionId }).expect(200);
  assert.equal(staleRollup.body.rollup.id, rollup.body.rollup.id);
  assert.equal(staleRollup.body.rollup.freshness.status, 'stale');
  assert.ok(staleRollup.body.rollup.freshness.staleReasons.includes('newer_observed_visit'));

  const refreshedRollup = await current.agent.post('/api/journey-metrics/actual-path-rollups/materialize').send({
    journeyDefinitionId: map.definitionId,
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(200);
  assert.equal(refreshedRollup.body.updated, true);
  assert.equal(refreshedRollup.body.rollup.id, rollup.body.rollup.id);
  assert.equal(refreshedRollup.body.rollup.freshness.status, 'current');
  assert.equal(refreshedRollup.body.rollup.summary.acceptedInstanceCount, 3);
  assert.equal(refreshedRollup.body.rollup.summary.acceptedVisitCount, 3);
  assert.equal(refreshedRollup.body.rollup.summary.unobservedStageCount, 2);
  assert.equal(refreshedRollup.body.rollup.summary.atRiskStageCount, 1);

  const staleLatest = await current.agent.get('/api/journey-metrics/actual-path-snapshots/latest')
    .query({ journeyDefinitionId: map.definitionId }).expect(200);
  assert.equal(staleLatest.body.snapshot.freshness.status, 'stale');
  assert.ok(staleLatest.body.snapshot.freshness.staleReasons.includes('newer_observed_visit'));

  const history = await current.agent.get('/api/journey-metrics/actual-path-snapshots')
    .query({ journeyDefinitionId: map.definitionId, limit: 20 }).expect(200);
  assert.ok(Array.isArray(history.body.snapshots));
  assert.equal(history.body.snapshots[0].id, snapshot.body.snapshot.id);
  assert.equal(history.body.snapshots[0].freshness.status, 'stale');

  const byId = await current.agent.get(`/api/journey-metrics/actual-path-snapshots/${snapshot.body.snapshot.id}`)
    .query({ journeyDefinitionId: map.definitionId }).expect(200);
  assert.equal(byId.body.snapshot.id, snapshot.body.snapshot.id);
  assert.equal(byId.body.snapshot.result.analytics.analyticsVersion, 'journey-path-analytics/v1');
  assert.equal(byId.body.snapshot.reconciliation.designVersionChanged, false);
  assert.equal(byId.body.snapshot.reconciliation.deltas.acceptedInstanceCount, 1);
  assert.equal(byId.body.snapshot.reconciliation.deltas.acceptedVisitCount, 1);
  assert.equal(byId.body.snapshot.reconciliation.deltas.unobservedStageCount, -1);
  assert.equal(byId.body.snapshot.reconciliation.deltas.atRiskStageCount, 1);
  assert.match(byId.body.snapshot.reconciliation.currentAsOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('journey actual-path analytics can stitch observed paths onto known profiles and accounts through existing anonymous bindings', async () => {
  const current = await owner();
  const source = await trackingSource(current.agent, 'known', [
    { event: 'journey_started', properties: [] },
    { event: 'journey_adopted', properties: [] }
  ]);
  const map = await publishedMap(current.agent, 'Known-profile adoption journey');
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId, name: 'Start', eventName: 'journey_started', stageIndex: 0, role: 'entry' });
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId, name: 'Adopt', eventName: 'journey_adopted', stageIndex: 1, role: 'success' });

  await current.agent.post('/api/journey-identities/commands').send({
    type: 'observe',
    commandId: 'known-profile-observe',
    occurredAt: '2026-08-05T10:59:00.000Z',
    profileId: 'anon-known-a',
    profileKind: 'anonymous',
    identifier: { kind: 'anonymous_id', namespace: 'browser', value: 'known-session-a' },
    sourceFact: {
      factId: 'known-profile-fact',
      source: 'sdk',
      sourceRef: 'event:known-session-a',
      occurredAt: '2026-08-05T10:58:59.000Z'
    }
  }).set('X-Seemplify-Space', current.spaceId).expect((response) => {
    assert.ok(response.status === 200 || response.status === 201);
  });
  await current.agent.post('/api/journey-identities/commands').send({
    type: 'identify',
    commandId: 'known-profile-identify',
    occurredAt: '2026-08-05T10:59:10.000Z',
    profile: { profileId: 'anon-known-a' },
    identifier: { kind: 'authenticated_user_id', namespace: 'auth0', value: 'known-user-a' },
    sourceFact: {
      factId: 'known-identify-fact',
      source: 'auth-service',
      sourceRef: 'login:known-user-a',
      occurredAt: '2026-08-05T10:59:09.000Z'
    }
  }).set('X-Seemplify-Space', current.spaceId).expect((response) => {
    assert.ok(response.status === 200 || response.status === 201);
  });
  await current.agent.post('/api/journey-identities/groups').send({
    id: 'account-known',
    groupType: 'account',
    name: 'Known account'
  }).set('X-Seemplify-Space', current.spaceId).expect((response) => {
    assert.ok(response.status === 200 || response.status === 201);
  });
  await current.agent.post('/api/journey-identities/commands').send({
    type: 'add_membership',
    commandId: 'known-membership',
    occurredAt: '2026-08-05T10:59:30.000Z',
    profile: { profileId: 'anon-known-a' },
    group: { groupType: 'account', groupId: 'account-known' },
    sourceFact: {
      factId: 'known-membership-fact',
      source: 'crm',
      sourceRef: 'account:account-known/member:known-user-a',
      occurredAt: '2026-08-05T10:59:29.000Z'
    }
  }).set('X-Seemplify-Space', current.spaceId).expect((response) => {
    assert.ok(response.status === 200 || response.status === 201);
  });

  const base = Date.UTC(2026, 7, 5, 11, 0, 0);
  await ingest(source.secret, 'journey_started', 'known-session-a', new Date(base).toISOString());
  await ingest(source.secret, 'journey_adopted', 'known-session-a', new Date(base + 60_000).toISOString());
  await ingest(source.secret, 'journey_started', 'anon-z', new Date(base + 120_000).toISOString());

  const anonymous = await current.agent.get('/api/journey-metrics/actual-paths').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'anonymous_only',
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(200);
  assert.equal(anonymous.body.scope.subjectKind, 'anonymous_only');
  assert.equal(anonymous.body.scope.identityModel, 'anonymous_instance_scoped');
  assert.match(String(anonymous.body.scope.notes[0]), /anonymous journey instances only/i);

  const stitched = await current.agent.get('/api/journey-metrics/actual-paths').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles',
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(200);
  assert.equal(stitched.body.scope.subjectKind, 'known_profiles');
  assert.equal(stitched.body.scope.identityModel, 'known_profile_stitched');
  assert.match(String(stitched.body.scope.notes[0]), /stitched to known canonical profiles/i);
  assert.equal(stitched.body.scope.stitchedSubjectSummary.stitchedKnownProfileCount, 1);
  assert.equal(stitched.body.scope.stitchedSubjectSummary.stitchedAccountCount, 1);
  assert.equal(stitched.body.scope.stitchedSubjectSummary.anonymousInstanceCount, 2);
  assert.equal(stitched.body.analytics.sample.acceptedInstanceCount, 2);
  assert.equal(stitched.body.analytics.sample.acceptedVisitCount, 2);

  const knownRollup = await current.agent.post('/api/journey-metrics/actual-path-rollups/materialize').send({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles',
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(201);
  assert.equal(knownRollup.body.rollup.scopeSubject, 'known_profiles');
  assert.equal(knownRollup.body.rollup.result.scope.subjectKind, 'known_profiles');

  const latestKnownRollup = await current.agent.get('/api/journey-metrics/actual-path-rollups/latest').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles'
  }).expect(200);
  assert.equal(latestKnownRollup.body.rollup.id, knownRollup.body.rollup.id);

  const knownSnapshot = await current.agent.post('/api/journey-metrics/actual-path-snapshots').send({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles',
    from: '2026-08-05T00:00:00.000Z',
    to: '2026-08-06T00:00:00.000Z',
    minimumCohortSize: 1
  }).expect(201);
  assert.equal(knownSnapshot.body.snapshot.scopeSubject, 'known_profiles');
  assert.equal(knownSnapshot.body.snapshot.result.scope.subjectKind, 'known_profiles');

  const latestKnownSnapshot = await current.agent.get('/api/journey-metrics/actual-path-snapshots/latest').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles'
  }).expect(200);
  assert.equal(latestKnownSnapshot.body.snapshot.id, knownSnapshot.body.snapshot.id);

  const knownSnapshotHistory = await current.agent.get('/api/journey-metrics/actual-path-snapshots').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles',
    limit: 20
  }).expect(200);
  assert.equal(knownSnapshotHistory.body.snapshots.length, 1);
  assert.equal(knownSnapshotHistory.body.snapshots[0].id, knownSnapshot.body.snapshot.id);

  const reopenedKnownSnapshot = await current.agent.get(`/api/journey-metrics/actual-path-snapshots/${knownSnapshot.body.snapshot.id}`).query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'known_profiles'
  }).expect(200);
  assert.equal(reopenedKnownSnapshot.body.snapshot.id, knownSnapshot.body.snapshot.id);

  const anonymousSnapshotHistory = await current.agent.get('/api/journey-metrics/actual-path-snapshots').query({
    journeyDefinitionId: map.definitionId,
    subjectKind: 'anonymous_only',
    limit: 20
  }).expect(200);
  assert.equal(anonymousSnapshotHistory.body.snapshots.length, 0);
});
