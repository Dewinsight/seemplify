import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-metric-alerts-'));
const secret = (name: string, value: string | Buffer) => {
  const target = path.join(root, name); fs.writeFileSync(target, value); return target;
};
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'metric-alerts@seemplify.local',
  ADMIN_PASSWORD_FILE: secret('admin-password', 'Metric-Alerts-Test-2026!'),
  SESSION_SECRET_FILE: secret('session-secret', 'metric-alerts-session-secret-that-is-long-enough'),
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: secret('x-key', Buffer.alloc(32, 81).toString('base64url')),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: secret('esign-key', Buffer.alloc(32, 82).toString('base64url')),
  JOURNEY_IDENTITY_HASH_KEY_FILE: secret('identity-key', Buffer.alloc(32, 83)),
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  JOURNEY_METRIC_ALERTS_ENABLED: 'true'
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { createJourneyMap } = await import('../src/journeyMaps.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function ownerIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'metric-alerts@seemplify.local',
    password: 'Metric-Alerts-Test-2026!' }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

async function collaborator(spaceId: string, role: 'admin' | 'member', suffix: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, { name: `Alert ${role}`, email: `alert-${role}-${suffix}@example.test`,
    password: `Alert-${role}-Collaborator-2026!`, spaceName: `Alert ${role} home` });
  const session = await agent.get('/api/auth/session').expect(200); const userId = String(session.body.user.id);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)`)
    .run(spaceId, userId, role, at, at);
  return { agent, userId };
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function seedMetric(input: { spaceId: string; userId: string; journeyId: string; name: string;
  direction?: 'higher_is_better' | 'lower_is_better' | 'neutral' }) {
  const id = crypto.randomUUID(); const versionId = crypto.randomUUID(); const at = '2026-08-01T00:00:00.000Z';
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,name,state,current_version_id,revision,
       idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'journey',?,?,'active',?,1,?,?,?,?,?)`)
      .run(id, input.spaceId, input.journeyId, input.journeyId, input.name, versionId, `metric-${id}`, hash(id),
        input.userId, at, at);
    db.prepare(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,
       window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,
       population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,
       created_by_user_id,created_at)
      VALUES (?,?,?,1,'operational_import',NULL,'operational','count',?,86400,'UTC',2,86400,NULL,NULL,
        '{}','{}','{"kind":"count"}','{"kind":"count"}',?,?,?,?,?)`)
      .run(versionId, id, input.spaceId, input.direction || 'higher_is_better', hash(`content-${id}`),
        `metric-version-${id}`, hash(`intent-${id}`), input.userId, at);
  })();
  return { id, versionId };
}

function seedObservation(input: { spaceId: string; userId: string; metricId: string; metricVersionId: string;
  periodStart: string; periodEnd: string; value: number | null; sampleSize: number; revision?: number;
  supersedesId?: string; latestObservedAt?: string; result?: Record<string, unknown> }) {
  const id = crypto.randomUUID(); const runId = crypto.randomUUID(); const revision = input.revision || 1;
  db.prepare(`INSERT INTO journey_metric_rebuild_runs
    (id,space_id,definition_id,definition_version_id,reason,as_of,state,available_at,lease_owner,lease_token,
     lease_generation,lease_expires_at,attempt_count,max_attempts,observation_id,error_code,idempotency_key,
     intent_sha256,requested_by_user_id,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,'manual',?,'completed',?,NULL,NULL,0,NULL,0,3,NULL,NULL,?,?,?,?,?,?)`)
    .run(runId, input.spaceId, input.metricId, input.metricVersionId, input.periodEnd, input.periodEnd,
      `alert-rebuild-${runId}`, hash(`run-${runId}`), input.userId, input.periodEnd, input.periodEnd, input.periodEnd);
  const result = JSON.stringify(input.result || { kind: 'count' });
  db.prepare(`INSERT INTO journey_metric_observations
    (id,space_id,definition_id,definition_version_id,revision,supersedes_observation_id,status,value,unit,numerator,
     denominator,sample_size,period_start,period_end,timezone,as_of,calculated_at,freshness_status,latest_observed_at,
     minimum_sample_warning,source_count,source_snapshot_sha256,result_sha256,result_json,rebuild_run_id,created_at)
    VALUES (?,?,?,?,?,?,'available',?,'score',?,?,?,?,?,'UTC',?,?,'fresh',?,?,?,?,?,?,?,?)`)
    .run(id, input.spaceId, input.metricId, input.metricVersionId, revision, input.supersedesId || null, input.value,
      input.value, input.sampleSize, input.sampleSize, input.periodStart, input.periodEnd, input.periodEnd,
      input.periodEnd, input.latestObservedAt || input.periodEnd, input.sampleSize < 2 ? 1 : 0, input.sampleSize,
      hash(`source-${id}`), hash(result), result, runId, input.periodEnd);
  return id;
}

function seedResearchAssessment(input: { spaceId: string; userId: string; journeyId: string;
  relationship: 'supports' | 'contradicts'; ordinal: number }) {
  const sourceId = crypto.randomUUID(); const snapshotId = crypto.randomUUID(); const linkId = crypto.randomUUID();
  const at = `2026-08-05T10:${String(input.ordinal).padStart(2, '0')}:00.000Z`;
  db.prepare(`INSERT INTO journey_research_sources
    (id,space_id,source_type,source_ref,adapter,owner_user_id,state,revision,last_resolved_at,last_error_code,
     idempotency_key,intent_sha256,created_at,updated_at)
    VALUES (?,?,'observation',?,'test',?,'active',1,?,NULL,?,?,?,?)`)
    .run(sourceId, input.spaceId, `secret-qualitative-source-${input.ordinal}`, input.userId, at,
      `research-source-${sourceId}`, hash(sourceId), at, at);
  db.prepare(`INSERT INTO journey_research_snapshots
    (id,source_id,space_id,version_number,fingerprint,access_state,source_label,excerpt,population,sample_size,
     collected_at,window_start,window_end,source_updated_at,metadata_json,created_by_user_id,created_at,retention_expires_at)
    VALUES (?,?,?,1,?,'available','Reviewed source','Never expose this excerpt','Customers',25,?,?,?,?,'{}',?,?,?)`)
    .run(snapshotId, sourceId, input.spaceId, hash(`snapshot-${sourceId}`), at, at, at, at, input.userId, at,
      '2027-08-05T00:00:00.000Z');
  db.prepare(`INSERT INTO journey_research_links
    (id,space_id,source_id,snapshot_id,target_type,target_id,state,revision,idempotency_key,intent_sha256,
     created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,'definition',?,'active',1,?,?,?,?,?)`)
    .run(linkId, input.spaceId, sourceId, snapshotId, input.journeyId, `research-link-${linkId}`, hash(linkId),
      input.userId, at, at);
  db.prepare(`INSERT INTO journey_research_assessments
    (id,link_id,space_id,revision,relationship,classification,confidence,freshness_days,reason_summary,
     reason_sha256,reviewer_user_id,method,created_at)
    VALUES (?,?,?,1,?, ?,0.9,30,'Reviewed',?,?, 'human_review',?)`)
    .run(crypto.randomUUID(), linkId, input.spaceId, input.relationship,
      input.relationship === 'supports' ? 'supported' : 'contradicted', hash(`assessment-${linkId}`), input.userId, at);
}

const alertVersion = (ruleKind: 'falling_metric' | 'stale_source' | 'small_sample' | 'contradictory_evidence',
  direction: 'decrease' | 'increase' | 'any' = 'any') => ({ ruleKind, direction,
  thresholdValue: ruleKind === 'falling_metric' ? 10 : 0, windowSeconds: 172800, cooldownSeconds: 3600,
  minimumSampleSize: 2, staleAfterSeconds: 3600, contradictionMinRatio: 0.4 });

function createAlert(agent: ReturnType<typeof request.agent>, input: { journeyId: string; metricId: string;
  name: string; ruleKind: 'falling_metric' | 'stale_source' | 'small_sample' | 'contradictory_evidence';
  direction?: 'decrease' | 'increase' | 'any'; headerSpaceId?: string }) {
  const call = agent.post('/api/journey-metrics/alert-definitions')
    .set('Idempotency-Key', `alert-${input.name}`).send({ journeyDefinitionId: input.journeyId,
      metricDefinitionId: input.metricId, name: input.name,
      version: alertVersion(input.ruleKind, input.direction), versionIdempotencyKey: `alert-${input.name}-v1` });
  if (input.headerSpaceId) call.set('x-seemplify-space', input.headerSpaceId);
  return call;
}

test('metric/evidence alerts are deterministic, tenant-safe, durable, and role-aware', async () => {
  const owner = await ownerIdentity(); const admin = await collaborator(owner.spaceId, 'admin', 'one');
  const member = await collaborator(owner.spaceId, 'member', 'one');
  const journey = createJourneyMap(owner.spaceId, owner.userId, { name: 'Alert journey', purpose: 'Test alerts',
    stageNames: ['Discover', 'Activate'] });
  const otherJourney = createJourneyMap(owner.spaceId, owner.userId, { name: 'Other journey', purpose: 'Isolation',
    stageNames: ['Other'] });
  const falling = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Activation score', direction: 'higher_is_better' });
  const noBaseline = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Window bounded score', direction: 'higher_is_better' });
  const boundary = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Exact window boundary score', direction: 'higher_is_better' });
  const small = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Small sample score', direction: 'higher_is_better' });
  const stale = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Stale source score', direction: 'higher_is_better' });
  const contradiction = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
    name: 'Qualitative conflict', direction: 'neutral' });
  const sentimentOnly = seedMetric({ spaceId: owner.spaceId, userId: owner.userId, journeyId: otherJourney.id,
    name: 'Sentiment is not assessment', direction: 'neutral' });
  const asOf = '2026-08-05T13:00:00.000+01:00';
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, ...{ metricId: falling.id,
    metricVersionId: falling.versionId }, periodStart: '2026-08-03T11:00:00.000Z',
    periodEnd: '2026-08-04T11:00:00.000Z', value: 80, sampleSize: 20 });
  const fallingCurrent = seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: falling.id,
    metricVersionId: falling.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 55, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: noBaseline.id,
    metricVersionId: noBaseline.versionId, periodStart: '2025-08-01T00:00:00.000Z',
    periodEnd: '2025-08-02T00:00:00.000Z', value: 90, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: noBaseline.id,
    metricVersionId: noBaseline.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 40, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: boundary.id,
    metricVersionId: boundary.versionId, periodStart: '2026-08-03T11:00:00.000Z',
    periodEnd: '2026-08-03T12:00:00.000Z', value: 90, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: boundary.id,
    metricVersionId: boundary.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 60, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: small.id,
    metricVersionId: small.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 1, sampleSize: 1 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: stale.id,
    metricVersionId: stale.versionId, periodStart: '2026-06-30T00:00:00.000Z',
    periodEnd: '2026-07-01T00:00:00.000Z', value: 1, sampleSize: 20 });
  seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: sentimentOnly.id,
    metricVersionId: sentimentOnly.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 0, sampleSize: 100,
    result: { sentiments: ['positive', 'negative'], contradictory: true } });
  ['supports', 'supports', 'contradicts', 'contradicts'].forEach((relationship, index) =>
    seedResearchAssessment({ spaceId: owner.spaceId, userId: owner.userId, journeyId: journey.id,
      relationship: relationship as 'supports' | 'contradicts', ordinal: index + 1 }));

  await request(app).get('/api/journey-metrics/alerts').expect(401);
  const createdFalling = await createAlert(owner.agent, { journeyId: journey.id, metricId: falling.id,
    name: 'falling', ruleKind: 'falling_metric', direction: 'decrease' }).expect(201);
  await createAlert(owner.agent, { journeyId: journey.id, metricId: falling.id,
    name: 'falling', ruleKind: 'falling_metric', direction: 'decrease' }).expect(200)
    .expect((response) => assert.equal(response.body.replayed, true));
  await createAlert(owner.agent, { journeyId: journey.id, metricId: noBaseline.id,
    name: 'bounded', ruleKind: 'falling_metric', direction: 'decrease' }).expect(201);
  const createdBoundary = await createAlert(owner.agent, { journeyId: journey.id, metricId: boundary.id,
    name: 'boundary', ruleKind: 'falling_metric', direction: 'decrease' }).expect(201);
  await createAlert(owner.agent, { journeyId: journey.id, metricId: small.id,
    name: 'small', ruleKind: 'small_sample' }).expect(201);
  await createAlert(owner.agent, { journeyId: journey.id, metricId: stale.id,
    name: 'stale', ruleKind: 'stale_source' }).expect(201);
  await createAlert(owner.agent, { journeyId: journey.id, metricId: contradiction.id,
    name: 'contradiction', ruleKind: 'contradictory_evidence' }).expect(201);
  await createAlert(owner.agent, { journeyId: otherJourney.id, metricId: sentimentOnly.id,
    name: 'sentiment', ruleKind: 'contradictory_evidence' }).expect(201);
  await createAlert(owner.agent, { journeyId: otherJourney.id, metricId: falling.id,
    name: 'cross-journey', ruleKind: 'small_sample' }).expect(404);

  await member.agent.get('/api/journey-metrics/alert-definitions').set('x-seemplify-space', owner.spaceId).expect(200);
  await createAlert(member.agent, { journeyId: journey.id, metricId: falling.id, name: 'member-denied',
    ruleKind: 'small_sample', headerSpaceId: owner.spaceId }).expect(403);
  await member.agent.post('/api/journey-metrics/alert-evaluations').set('x-seemplify-space', owner.spaceId)
    .set('Idempotency-Key', 'member-evaluate').send({ journeyDefinitionId: journey.id, asOf }).expect(403);

  const evaluated = await owner.agent.post('/api/journey-metrics/alert-evaluations')
    .set('Idempotency-Key', 'alerts-evaluation-1').send({ journeyDefinitionId: journey.id, asOf }).expect(201);
  assert.equal(evaluated.body.run.asOf, '2026-08-05T12:00:00.000Z');
  assert.equal(evaluated.body.run.triggeredCount, 4);
  assert.equal(evaluated.body.run.warningCount, 1);
  await owner.agent.post('/api/journey-metrics/alert-evaluations').set('Idempotency-Key', 'alerts-evaluation-1')
    .send({ journeyDefinitionId: journey.id, asOf }).expect(200)
    .expect((response) => assert.equal(response.body.replayed, true));
  const resultRows = db.prepare(`SELECT outcome,reason_code,severity,lineage_json FROM journey_metric_alert_evaluation_results
    WHERE run_id=? ORDER BY reason_code`).all(evaluated.body.run.id) as any[];
  assert.ok(resultRows.some((row) => row.reason_code === 'BASELINE_OUTSIDE_ALERT_WINDOW' && row.outcome === 'insufficient_data'));
  assert.ok(resultRows.some((row) => row.reason_code === 'SOURCE_OBSERVATION_STALE' && row.severity === 'strong'));
  assert.ok(resultRows.some((row) => row.reason_code === 'SMALL_SAMPLE_WARNING' && row.severity === 'warning'));
  assert.ok(resultRows.some((row) => row.reason_code === 'CONTRADICTORY_RESEARCH_ASSESSMENTS' && row.severity === 'strong'));
  assert.equal((db.prepare(`SELECT reason_code FROM journey_metric_alert_evaluation_results
    WHERE run_id=? AND alert_definition_id=?`).get(evaluated.body.run.id,
    createdBoundary.body.definition.id) as any).reason_code, 'METRIC_FELL_BEYOND_THRESHOLD');
  assert.equal(JSON.stringify(resultRows).includes('Never expose this excerpt'), false);
  assert.equal(JSON.stringify(resultRows).includes('secret-qualitative-source'), false);

  const otherEvaluation = await owner.agent.post('/api/journey-metrics/alert-evaluations')
    .set('Idempotency-Key', 'alerts-evaluation-other').send({ journeyDefinitionId: otherJourney.id, asOf }).expect(201);
  assert.equal(otherEvaluation.body.run.triggeredCount, 0);
  const sentimentResult = db.prepare(`SELECT outcome,reason_code,severity FROM journey_metric_alert_evaluation_results
    WHERE run_id=?`).get(otherEvaluation.body.run.id) as any;
  assert.equal(sentimentResult.reason_code, 'SMALL_SAMPLE_SUPPRESSED_STRONG');
  assert.equal(sentimentResult.severity, 'warning');

  let alerts = (await owner.agent.get('/api/journey-metrics/alerts').query({ journeyDefinitionId: journey.id })
    .expect(200)).body.alerts as any[];
  const fallingAlert = alerts.find((row) => row.alertDefinitionId === createdFalling.body.definition.id)!;
  assert.equal(fallingAlert.reasonCode, 'METRIC_FELL_BEYOND_THRESHOLD');
  const fallingNotifications = db.prepare(`SELECT * FROM journey_metric_alert_notifications WHERE alert_id=?
    ORDER BY user_id`).all(fallingAlert.id) as any[];
  assert.deepEqual(fallingNotifications.map((row) => row.user_id).sort(), [admin.userId, owner.userId].sort());
  assert.equal(fallingNotifications.some((row) => row.user_id === member.userId), false);

  const ownerInbox = await owner.agent.get('/api/journey-metrics/alert-notifications').expect(200);
  const ownerNotice = ownerInbox.body.notifications.find((row: any) => row.alertId === fallingAlert.id)!;
  await owner.agent.patch(`/api/journey-metrics/alert-notifications/${ownerNotice.id}`)
    .send({ expectedRevision: ownerNotice.revision, state: 'read' }).expect(200)
    .expect((response) => assert.equal(response.body.notification.state, 'read'));
  const preference = await admin.agent.get('/api/journey-metrics/alert-notification-preference')
    .set('x-seemplify-space', owner.spaceId).expect(200);
  await admin.agent.patch('/api/journey-metrics/alert-notification-preference').set('x-seemplify-space', owner.spaceId)
    .send({ expectedRevision: preference.body.preference.revision, enabled: false }).expect(200);

  let action = await owner.agent.post(`/api/journey-metrics/alerts/${fallingAlert.id}/actions`)
    .send({ expectedRevision: fallingAlert.revision, action: 'acknowledge' }).expect(200);
  action = await owner.agent.post(`/api/journey-metrics/alerts/${fallingAlert.id}/actions`)
    .send({ expectedRevision: action.body.alert.revision, action: 'snooze',
      snoozedUntil: '2026-08-06T12:00:00.000Z' }).expect(200);
  assert.equal(action.body.alert.state, 'snoozed');

  const corrected = seedObservation({ spaceId: owner.spaceId, userId: owner.userId, metricId: falling.id,
    metricVersionId: falling.versionId, periodStart: '2026-08-04T11:00:00.000Z',
    periodEnd: '2026-08-05T11:00:00.000Z', value: 50, sampleSize: 20, revision: 2,
    supersedesId: fallingCurrent });
  assert.ok(corrected);
  const secondAsOf = '2026-08-05T12:05:00.000Z';
  await owner.agent.post('/api/journey-metrics/alert-evaluations').set('Idempotency-Key', 'alerts-evaluation-2')
    .send({ journeyDefinitionId: journey.id, asOf: secondAsOf }).expect(201);
  const notificationCounts = db.prepare(`SELECT user_id,delivery_status,COUNT(*) count
    FROM journey_metric_alert_notifications notification JOIN journey_metric_alerts alert ON alert.id=notification.alert_id
    WHERE alert.alert_definition_id=? GROUP BY user_id,delivery_status ORDER BY user_id,delivery_status`)
    .all(createdFalling.body.definition.id) as any[];
  assert.ok(notificationCounts.some((row) => row.user_id === owner.userId && row.delivery_status === 'queued'
    && Number(row.count) === 1));
  assert.ok(notificationCounts.some((row) => row.user_id === owner.userId && row.delivery_status === 'suppressed'
    && Number(row.count) === 1));
  assert.equal(notificationCounts.filter((row) => row.user_id === admin.userId).reduce((sum, row) => sum + Number(row.count), 0), 1);
  alerts = (await owner.agent.get('/api/journey-metrics/alerts').query({ journeyDefinitionId: journey.id })
    .expect(200)).body.alerts;
  assert.ok(alerts.some((row: any) => row.alertDefinitionId === createdFalling.body.definition.id
    && row.state === 'resolved' && row.resolvedReason === 'SOURCE_LINEAGE_CHANGED'));

  const adminInbox = await admin.agent.get('/api/journey-metrics/alert-notifications')
    .set('x-seemplify-space', owner.spaceId).expect(200);
  const adminNotice = adminInbox.body.notifications[0];
  db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, admin.userId);
  await admin.agent.get('/api/journey-metrics/alert-notifications').set('x-seemplify-space', owner.spaceId).expect(200)
    .expect((response) => assert.deepEqual(response.body.notifications, []));
  await admin.agent.patch(`/api/journey-metrics/alert-notifications/${adminNotice.id}`)
    .set('x-seemplify-space', owner.spaceId).send({ expectedRevision: adminNotice.revision, state: 'read' }).expect(404);
  assert.ok(Number((db.prepare(`SELECT COUNT(*) count FROM journey_metric_alert_notifications WHERE user_id=?`)
    .get(admin.userId) as any).count) > 0, 'role changes must not erase immutable notification history');

  const alertDefinitionId = String(createdFalling.body.definition.id);
  assert.throws(() => db.prepare(`INSERT INTO journey_metric_alert_definition_versions
    (id,definition_id,space_id,metric_definition_id,version_number,rule_kind,direction,threshold_value,window_seconds,
     cooldown_seconds,minimum_sample_size,stale_after_seconds,contradiction_min_ratio,content_sha256,idempotency_key,
     intent_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,99,'small_sample','any',0,3600,3600,2,3600,0.2,?,?,?,?,?)`)
    .run(crypto.randomUUID(), alertDefinitionId, owner.spaceId, noBaseline.id, hash('mismatch-content'),
      `mismatch-${crypto.randomUUID()}`, hash('mismatch-intent'), owner.userId, asOf), /FOREIGN KEY/u);
  const directBase = `INSERT INTO journey_metric_alert_definitions
    (id,space_id,journey_definition_id,metric_definition_id,name,state,current_version_id,revision,idempotency_key,
     intent_sha256,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,1,?,?,?,?,?)`;
  assert.throws(() => db.prepare(directBase).run(crypto.randomUUID(), owner.spaceId, journey.id, falling.id,
    'Null pointer', null, `null-${crypto.randomUUID()}`, hash('null'), owner.userId, asOf, asOf), /NOT NULL/u);
  assert.throws(() => db.transaction(() => db.prepare(directBase).run(crypto.randomUUID(), owner.spaceId, journey.id,
    falling.id, 'Orphan pointer', crypto.randomUUID(), `orphan-${crypto.randomUUID()}`, hash('orphan'), owner.userId,
    asOf, asOf))(), /FOREIGN KEY/u);
  assert.throws(() => db.prepare('UPDATE journey_metric_alert_definition_versions SET threshold_value=20 WHERE definition_id=?')
    .run(alertDefinitionId), /immutable/u);
  assert.throws(() => db.prepare('DELETE FROM journey_metric_alert_events WHERE alert_id=?').run(fallingAlert.id),
    /append-only/u);

  const other = await collaborator(owner.spaceId, 'member', 'other-space-seed');
  const otherSession = await other.agent.get('/api/auth/session').expect(200);
  const otherSpaceId = String(otherSession.body.activeSpace.id);
  const otherMap = createJourneyMap(otherSpaceId, other.userId, { name: 'Foreign journey', purpose: 'Tenant isolation',
    stageNames: ['Foreign'] });
  const foreignMetric = seedMetric({ spaceId: otherSpaceId, userId: other.userId, journeyId: otherMap.id,
    name: 'Foreign metric' });
  assert.throws(() => db.transaction(() => db.prepare(directBase).run(crypto.randomUUID(), owner.spaceId, journey.id,
    foreignMetric.id, 'Cross tenant', crypto.randomUUID(), `foreign-${crypto.randomUUID()}`, hash('foreign'),
    owner.userId, asOf, asOf))(), /FOREIGN KEY/u);

  const plan = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'").get() as any;
  const originalLimits = String(plan.limits_json); const limits = JSON.parse(originalLimits);
  const activeCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_metric_alert_definitions
    WHERE space_id=? AND state<>'retired'`).get(owner.spaceId) as any).count);
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'")
    .run(JSON.stringify({ ...limits, journeyMetricAlertDefinitions: activeCount }));
  await createAlert(owner.agent, { journeyId: journey.id, metricId: falling.id,
    name: 'quota-denied', ruleKind: 'small_sample' }).expect(409)
    .expect((response) => assert.equal(response.body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED'));
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(originalLimits);
  process.env.JOURNEY_METRIC_ALERTS_ENABLED = 'false';
  await owner.agent.get('/api/journey-metrics/alerts').expect(503)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_ALERTS_DISABLED'));
  process.env.JOURNEY_METRIC_ALERTS_ENABLED = 'true';
});
