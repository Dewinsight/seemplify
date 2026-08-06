import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-stage-reprojection-'));
const files = Object.fromEntries(['admin-password', 'session-secret', 'terra-secret', 'x-key', 'esign-key', 'identity-key']
  .map((name) => [name, path.join(root, name)]));
fs.writeFileSync(files['admin-password']!, 'Journey-Reprojection-Test-2026!');
fs.writeFileSync(files['session-secret']!, 'journey-reprojection-test-session-secret-that-is-long-enough');
fs.writeFileSync(files['terra-secret']!, 'journey-reprojection-test-terra-secret-that-is-long-enough');
fs.writeFileSync(files['x-key']!, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(files['esign-key']!, Buffer.alloc(32, 62).toString('base64url'));
fs.writeFileSync(files['identity-key']!, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-reprojection@seemplify.local', ADMIN_PASSWORD_FILE: files['admin-password'],
  SESSION_SECRET_FILE: files['session-secret'], TERRA_GATEWAY_SHARED_SECRET_FILE: files['terra-secret'],
  LOCAL_LLM_SHARED_SECRET_FILE: files['terra-secret'], EMAIL_MODE: 'log',
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
  claimJourneyStageReprojection, processJourneyStageReprojection, queueJourneyStageReprojection
} = await import('../src/journeyStageReprojection.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const control = '/api/journey-event-control-plane';
const rulesBase = '/api/journey-stage-rules';
const origin = 'https://stage-reprojection.example.test';
const idem = (value: string) => ({ 'Idempotency-Key': value });
const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

type Property = {
  name: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required: boolean;
  dataClass: 'operational' | 'personal' | 'sensitive' | 'prohibited_content'; description: string;
  maximumLength?: number; enumValues?: Array<string | number | boolean>;
};

async function owner() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-reprojection@seemplify.local', password: 'Journey-Reprojection-Test-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id); const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, userId, spaceId };
}

async function trackingSource(agent: ReturnType<typeof request.agent>, suffix: string,
  schemas: Array<{ event: string; properties: Property[] }>) {
  const source = await agent.post(`${control}/sources`).set(idem(`reprojection-source-${suffix}`)).send({
    name: `Reprojection source ${suffix}`, environment: 'production', validationMode: 'enforce', allowedOrigins: [origin],
    allowedBundleIds: [], eventsPerMinute: 10_000, bytesPerMinute: 10_000_000
  }).expect(201);
  const sourceId = String(source.body.source.id);
  const credential = await agent.post(`${control}/sources/${sourceId}/credentials`)
    .set(idem(`reprojection-key-${suffix}`)).send({ kind: 'public_write' }).expect(201);
  for (const schemaInput of schemas) {
    const schema = await agent.post(`${control}/sources/${sourceId}/schemas`)
      .set(idem(`reprojection-schema-${suffix}-${schemaInput.event}`)).send({ eventName: schemaInput.event }).expect(201);
    const version = await agent.post(`${control}/schemas/${schema.body.schema.id}/versions`)
      .set(idem(`reprojection-schema-version-${suffix}-${schemaInput.event}`))
      .send({ version: '1.0', properties: schemaInput.properties }).expect(201);
    await agent.post(`${control}/schema-versions/${version.body.version.id}/publish`).send({}).expect(200);
  }
  return { sourceId, secret: String(credential.body.secret) };
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
  await input.agent.post(`${rulesBase}/${input.map.definitionId}/rules/${created.body.rule.id}/publish`)
    .send({ expectedRevision: created.body.rule.revision }).expect(200);
}

function envelope(eventId: string, event: string, anonymousId: string, occurredAt: string,
  properties: Record<string, unknown> = { plan_id: 'team' }) {
  return {
    protocolVersion: '1.0', eventId, call: 'track', event, eventVersion: 1, occurredAt,
    anonymousId, properties, context: { library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'test-cmp', updatedAt: occurredAt }
  };
}

test('queues, claims, checkpoints and completes a durable stage reprojection over retained accepted raw events', async () => {
  const current = await owner();
  const operational: Property[] = [
    { name: 'plan_id', type: 'string', required: true, dataClass: 'operational', description: 'Bounded plan.',
      maximumLength: 32, enumValues: ['team', 'enterprise'] }
  ];
  const source = await trackingSource(current.agent, 'primary', [
    { event: 'workspace_created', properties: operational },
    { event: 'workspace_activated', properties: operational }
  ]);
  const map = await publishedMap(current.agent, 'Connected activation reprojection');
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId,
    name: 'Workspace entered', eventName: 'workspace_created', stageIndex: 0, role: 'entry' });
  await createAndPublishRule({ agent: current.agent, map, sourceId: source.sourceId,
    name: 'Workspace reached value', eventName: 'workspace_activated', stageIndex: 1, role: 'success' });

  const subjects = Array.from({ length: 12 }, (_value, index) => `reprojection-subject-${index + 1}`);
  const base = Date.now() - subjects.length * 60_000;
  for (const [index, subject] of subjects.entries()) {
    await request(app).post('/v1/events').set(auth(source.secret)).set('Origin', origin)
      .send(envelope(crypto.randomUUID(), 'workspace_created', subject, new Date(base + index * 60_000).toISOString()))
      .expect(202);
  }

  const first = queueJourneyStageReprojection({
    spaceId: current.spaceId,
    actorUserId: current.userId,
    journeyDefinitionId: map.definitionId,
    journeyMapVersionId: map.versionId,
    reason: 'manual',
    sourceId: source.sourceId,
    environment: 'production',
    idempotencyKey: 'reprojection-run-1'
  });
  const replay = queueJourneyStageReprojection({
    spaceId: current.spaceId,
    actorUserId: current.userId,
    journeyDefinitionId: map.definitionId,
    journeyMapVersionId: map.versionId,
    reason: 'manual',
    sourceId: source.sourceId,
    environment: 'production',
    idempotencyKey: 'reprojection-run-1'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.id, first.run.id);

  const leaseBase = Date.now();
  const claim = claimJourneyStageReprojection({ owner: 'reprojection-test-worker', now: new Date(leaseBase) });
  assert.ok(claim);
  const firstBatch = processJourneyStageReprojection(claim!, { now: new Date(leaseBase + 1_000), batchSize: 5 });
  assert.equal(firstBatch.state, 'leased');
  assert.equal(firstBatch.checkpoint?.processedCount, 5);
  assert.equal(firstBatch.summary?.projected.matched, 5);
  assert.equal(firstBatch.summary?.projected.changedCurrentStage, 5);

  const secondBatch = processJourneyStageReprojection(claim!, { now: new Date(leaseBase + 2_000), batchSize: 5 });
  assert.equal(secondBatch.state, 'leased');
  assert.equal(secondBatch.checkpoint?.processedCount, 10);
  assert.equal(secondBatch.summary?.projected.matched, 10);
  assert.equal(secondBatch.summary?.projected.changedCurrentStage, 10);

  const completed = processJourneyStageReprojection(claim!, { now: new Date(leaseBase + 3_000), batchSize: 5 });
  assert.equal(completed.state, 'completed');
  assert.equal(completed.reason, 'manual');
  assert.equal(completed.checkpoint?.processedCount, 12);
  assert.equal(completed.summary?.sourceScope.journeyDefinitionId, map.definitionId);
  assert.equal(completed.summary?.sourceScope.journeyMapVersionId, map.versionId);
  assert.equal(completed.summary?.before.decisions, 0);
  assert.equal(completed.summary?.projected.processed, 12);
  assert.equal(completed.summary?.projected.matched, 12);
  assert.equal(completed.summary?.projected.noMatch, 0);
  assert.equal(completed.summary?.projected.changedCurrentStage, 12);
  assert.equal(completed.summary?.projected.changedTerminalState, 0);

  const attempts = db.prepare(`SELECT status,attempt_number FROM journey_stage_reprojection_attempts WHERE run_id=? ORDER BY id`)
    .all(first.run.id) as Array<{ status: string; attempt_number: number }>;
  assert.deepEqual(attempts, [{ status: 'succeeded', attempt_number: 1 }]);
});
