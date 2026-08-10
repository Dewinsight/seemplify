import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import request from 'supertest';
import { JourneyStageIntelligenceError, type JourneyStageIntelligenceFact } from '../src/journeyStageIntelligence.js';
import { JourneyStageIntelligenceRepository } from '../src/journeyStageIntelligenceRepository.js';
import { createJourneyStageIntelligenceRouter } from '../src/journeyStageIntelligenceRoutes.js';
import { SubscriptionEntitlementError } from '../src/subscriptionEntitlements.js';

const facts: JourneyStageIntelligenceFact[] = Array.from({ length: 3 }, (_, index) => ({
  spaceId: 'space-authorised', subjectKey: `subject-${index}`, stageId: 'stage-one',
  metricDefinitionId: 'metric-one', metricDefinitionVersionId: 'metric-version-one',
  metricDefinitionVersionSha256: '1'.repeat(64), metricName: 'Completion', metricUnit: 'percent', value: 75,
  dimensions: { persona: ['buyer'], cohort: ['august'] }, sentiment: null, emotions: [],
  occurredAt: '2026-08-02T00:00:00.000Z', consentState: 'granted', allowedPurposes: ['analytics'],
  retentionExpiresAt: '2027-01-01T00:00:00.000Z', deletedAt: null,
  lineage: { sourceType: 'journey_event', sourceId: 'sdk-web', sourceVersion: '3', schemaVersion: 'event/v1',
    projectionVersion: 'stage/v2' }
}));

function fixture() {
  const loaded: Array<{ spaceId: string; journeyDefinitionId: string }> = [];
  const surveyCalls: Array<Record<string, unknown>> = [];
  let policy = { revision: 1, minimumSampleSize: 3, dimensions: ['persona', 'segment', 'cohort', 'channel'] as const,
    maximumRows: 500 };
  const repository = new JourneyStageIntelligenceRepository({
    recordRead() {},
    loadFacts(input) { loaded.push(input); return facts; },
    readPolicy() { return { ...policy, dimensions: [...policy.dimensions] }; },
    updatePolicy(input) {
      if (input.expectedRevision !== policy.revision) throw new JourneyStageIntelligenceError(
        'Policy changed.', 409, 'JOURNEY_STAGE_INTELLIGENCE_POLICY_CONFLICT');
      policy = { revision: policy.revision + 1, minimumSampleSize: input.minimumSampleSize,
        dimensions: input.dimensions as unknown as typeof policy.dimensions, maximumRows: input.maximumRows };
      return { ...policy, dimensions: [...policy.dimensions] };
    }
  });
  const app = express();
  app.use('/api/journey-stage-intelligence', createJourneyStageIntelligenceRouter({ repository,
    surveyFeedRepository: {
      createPolicy(input) { surveyCalls.push({ kind: 'policy', ...input }); return { id: 'policy-one', versionId: 'policy-v1' } as any; },
      createMapping(input) { surveyCalls.push({ kind: 'mapping', ...input }); return { id: 'mapping-one', versionId: 'mapping-v1' } as any; }
    },
    authorize(request) {
      const role = request.get('X-Test-Session');
      if (!role || !['member', 'admin', 'editor', 'denied'].includes(role)) throw new JourneyStageIntelligenceError(
        'Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
      if (request.get('X-Test-Plan') === 'disabled') throw new SubscriptionEntitlementError(
        'Journey metrics is not enabled for this plan.', 403, 'SUBSCRIPTION_FEATURE_DISABLED');
      const capabilities = new Set<'journeys.read' | 'journeys.edit'>();
      if (role !== 'denied') capabilities.add('journeys.read');
      if (role === 'admin' || role === 'editor') capabilities.add('journeys.edit');
      return { userId: `${role}-1`, spaceId: 'space-authorised',
        role: role === 'admin' ? 'admin' : 'member', capabilities };
    }
  }));
  return { app, loaded, surveyCalls };
}

const query = { journeyDefinitionId: 'journey-one', purpose: 'analytics',
  from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
  asOf: '2026-08-04T01:00:00.000Z' };

test('strict comparison route derives tenant from the authenticated request and permits member reads', async () => {
  const { app, loaded } = fixture();
  const response = await request(app).get('/api/journey-stage-intelligence/comparisons')
    .set('X-Test-Session', 'member').query({ ...query, dimensions: 'persona,cohort' }).expect(200)
    .expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
  assert.equal(response.body.rows.length, 2);
  assert.deepEqual(loaded, [{ spaceId: 'space-authorised', journeyDefinitionId: 'journey-one',
    from: query.from, to: query.to, asOf: query.asOf }]);
});

test('trend route uses the same governed facts and preserves explicit time buckets', async () => {
  const { app, loaded } = fixture();
  const response = await request(app).get('/api/journey-stage-intelligence/trends')
    .set('X-Test-Session', 'member').query({ ...query, dimensions: 'persona', bucketDays: 1 }).expect(200);
  assert.equal(response.body.schemaVersion, 'journey-stage-trends/v1');
  assert.equal(response.body.bucketDays, 1);
  assert.equal(response.body.buckets.length, 3);
  assert.equal(response.body.buckets[0].rows.length, 0);
  assert.equal(response.body.buckets[1].rows[0].sampleSize, 3);
  assert.deepEqual(loaded, [{ spaceId: 'space-authorised', journeyDefinitionId: 'journey-one',
    from: query.from, to: query.to, asOf: query.asOf }]);
  await request(app).get('/api/journey-stage-intelligence/trends').set('X-Test-Session', 'member')
    .query({ ...query, dimensions: 'persona', bucketDays: 0 }).expect(400);
  await request(app).get('/api/journey-stage-intelligence/trends').set('X-Test-Session', 'member')
    .query({ ...query, dimensions: 'persona', bucketDays: 32 }).expect(400);
});

test('privacy policy is server-owned: members read but only managers can revise it', async () => {
  const { app } = fixture();
  const read = await request(app).get('/api/journey-stage-intelligence/policy')
    .set('X-Test-Session', 'member').expect(200);
  assert.equal(read.body.policy.minimumSampleSize, 3);
  const update = { expectedRevision: 1, minimumSampleSize: 30, dimensions: ['persona', 'cohort'], maximumRows: 250 };
  await request(app).put('/api/journey-stage-intelligence/policy').set('X-Test-Session', 'member')
    .send(update).expect(403).expect(({ body }) =>
      assert.equal(body.code, 'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED'));
  await request(app).put('/api/journey-stage-intelligence/policy').set('X-Test-Session', 'editor')
    .send(update).expect(200);
  update.expectedRevision = 2;
  const changed = await request(app).put('/api/journey-stage-intelligence/policy').set('X-Test-Session', 'admin')
    .send(update).expect(200);
  assert.equal(changed.body.policy.revision, 3);
  assert.equal(changed.body.policy.minimumSampleSize, 30);
  await request(app).get('/api/journey-stage-intelligence/comparisons').set('X-Test-Session', 'member')
    .query({ ...query, minimumSampleSize: 3 }).expect(400);
  await request(app).get('/api/journey-stage-intelligence/comparisons').set('X-Test-Session', 'member')
    .query({ ...query, dimensions: 'channel' }).expect(403);
});

test('managed feature and granular read capabilities fail closed at the route', async () => {
  const { app } = fixture();
  await request(app).get('/api/journey-stage-intelligence/policy').set('X-Test-Session', 'member')
    .set('X-Test-Plan', 'disabled').expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_FEATURE_DISABLED'));
  await request(app).get('/api/journey-stage-intelligence/policy').set('X-Test-Session', 'denied')
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_STAGE_INTELLIGENCE_READ_REQUIRED'));
});

test('survey feed configuration is manager-only and derives tenant and actor from the request', async () => {
  const { app, surveyCalls } = fixture();
  const policy = { surveyId: 'survey-one', collectorId: 'collector-one',
    notice: 'We use this score for governed journey analytics only.',
    allowedPurposes: ['analytics'], retentionDays: 30, expectedRevision: 0 };
  await request(app).post('/api/journey-stage-intelligence/survey-feed/policies').set('X-Test-Session', 'member')
    .send(policy).expect(403);
  await request(app).post('/api/journey-stage-intelligence/survey-feed/policies').set('X-Test-Session', 'editor')
    .send({ ...policy, spaceId: 'foreign-space' }).expect(400);
  await request(app).post('/api/journey-stage-intelligence/survey-feed/policies').set('X-Test-Session', 'editor')
    .send(policy).expect(201);
  await request(app).post('/api/journey-stage-intelligence/survey-feed/mappings').set('X-Test-Session', 'admin')
    .send({ metricDefinitionId: 'metric-one', allowedPurposes: ['analytics'], retentionDays: 30,
      idempotencyKey: 'mapping-request-one' }).expect(201);
  assert.equal(surveyCalls.length, 2);
  assert.equal(surveyCalls[0]?.spaceId, 'space-authorised'); assert.equal(surveyCalls[0]?.actorUserId, 'editor-1');
  assert.equal(surveyCalls[1]?.spaceId, 'space-authorised'); assert.equal(surveyCalls[1]?.actorUserId, 'admin-1');
});

test('survey response correction is not exposed until an authoritative source correction contract exists', async () => {
  const { app, surveyCalls } = fixture();
  await request(app).put('/api/journey-stage-intelligence/survey-feed/responses/response-one')
    .set('X-Test-Session', 'editor').send({ value: 7, revision: 2 }).expect(404);
  assert.equal(surveyCalls.length, 0);
});

test('tenant injection, unknown fields and unauthenticated reads fail closed', async () => {
  const { app, loaded } = fixture();
  await request(app).get('/api/journey-stage-intelligence/comparisons').query(query).expect(401);
  await request(app).get('/api/journey-stage-intelligence/comparisons').set('X-Test-Session', 'member')
    .query({ ...query, spaceId: 'space-foreign' }).expect(400);
  await request(app).get('/api/journey-stage-intelligence/comparisons').set('X-Test-Session', 'member')
    .query({ ...query, dimensions: 'persona,not-a-dimension' }).expect(400);
  assert.equal(loaded.length, 0);
});

test('export route emits only the governed projection with bounded response headers', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/journey-stage-intelligence/comparisons.csv')
    .set('X-Test-Session', 'member').query({ ...query, dimensions: 'persona' }).expect(200)
    .expect('Content-Type', /text\/csv/u).expect('Content-Disposition', /journey-stage-comparisons\.csv/u);
  assert.match(response.text, /metricDefinitionVersionSha256/u);
  assert.match(response.text, /metric-version-one/u);
  await request(app).get('/api/journey-stage-intelligence/comparisons.pdf')
    .set('X-Test-Session', 'member').query(query).expect(400);
});
