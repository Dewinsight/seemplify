import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-subscription-usage-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Usage-Ledger-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'usage-ledger-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 32).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'usage-ledger@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  SUBSCRIPTION_ENFORCEMENT_ENABLED: 'true',
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
const { db, getJob, updateJob } = await import('../src/database.js');
const { createAiJobFixture } = await import('./aiJobFixtures.js');
const { createSpace } = await import('../src/spaces.js');
const { getJourneyMap } = await import('../src/journeyMaps.js');
const { buildMeteredJourneyMapExport } = await import('../src/journeyRoutes.js');
const {
  claimNextAdmittedAiJob, createAdmittedAiJob, reserveAiJobRetryAttempt
} = await import('../src/aiJobAdmission.js');
const { aiJobRunner } = await import('../src/aiJobs.js');
const { createAssistantKnowledgeRun } = await import('../src/assistant.js');
const { subscribePublishedEvents } = await import('../src/events.js');
const {
  backfillLegacyDirectAiUsage, consumeDirectAiAction, consumeSubscriptionUsage, currentMonthlyAiActions,
  meteredUsageSnapshot, reconcileSubscriptionUsage, SubscriptionEntitlementError, usagePeriodAt
} = await import('../src/subscriptionEntitlements.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const agent = request.agent(app);
await agent.post('/api/auth/login')
  .send({ email: 'usage-ledger@seemplify.local', password: 'Usage-Ledger-Test-Password-2026!' }).expect(200);
const session = await agent.get('/api/auth/session').expect(200);
const user = { id: String(session.body.user.id), name: String(session.body.user.name) };

const planRow = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='starter'").get() as
  { limits_json: string };
const starterLimits = JSON.parse(planRow.limits_json);
starterLimits.monthlyJourneyExports = 2;
starterLimits.monthlyAiActions = 4;
db.prepare("UPDATE platform_subscription_plans SET limits_json=?,updated_at=? WHERE code='starter'")
  .run(JSON.stringify(starterLimits), new Date().toISOString());

const accountingSpace = createSpace(user, { name: 'Accounting fixture' });
const secondSpace = createSpace(user, { name: 'Accounting isolation fixture' });
const routeSpace = createSpace(user, { name: 'Journey export fixture' });

function aiUsageRows(spaceId: string) {
  return db.prepare(`SELECT id,source_type,source_id,idempotency_key FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyAiActions' ORDER BY created_at,id`).all(spaceId) as Array<any>;
}

test('monthly usage decisions are atomic, replay safe, UTC bounded, forecasted, and reconcilable', () => {
  const january = new Date('2026-01-15T12:00:00.000Z');
  const first = consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-one',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'pdf' }, sourceType: 'test_export', now: january
  });
  assert.equal(first.used, 1);
  assert.equal(first.replayed, false);
  assert.deepEqual(usagePeriodAt(january), {
    start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z'
  });

  const replay = consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-one',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'pdf' }, sourceType: 'test_export', now: january
  });
  assert.equal(replay.eventId, first.eventId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.used, 1);
  assert.throws(() => consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-one',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'csv' }, sourceType: 'test_export', now: january
  }), (error: unknown) => error instanceof SubscriptionEntitlementError
    && error.code === 'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT');

  const second = consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-two',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'csv' }, sourceType: 'test_export', now: january
  });
  assert.equal(second.used, 2);
  assert.equal(second.warningLevel, 'exhausted');
  const beforeDenied = Number((db.prepare(`SELECT COUNT(*) count FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyJourneyExports'`).get(accountingSpace.id) as any).count);
  assert.throws(() => consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-three',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'png' }, sourceType: 'test_export', now: january
  }), (error: unknown) => error instanceof SubscriptionEntitlementError
    && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED');
  const afterDenied = Number((db.prepare(`SELECT COUNT(*) count FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyJourneyExports'`).get(accountingSpace.id) as any).count);
  assert.equal(afterDenied, beforeDenied, 'a denied usage decision must roll back without a ledger row');

  const february = consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-one',
    intent: { mapId: 'map-a', versionId: 'version-a', format: 'pdf' }, sourceType: 'test_export',
    now: '2026-02-01T00:00:00.000Z'
  });
  assert.equal(february.used, 1, 'a UTC month boundary resets the allowance and idempotency scope');
  assert.equal(february.periodStart, '2026-02-01T00:00:00.000Z');

  const isolated = consumeSubscriptionUsage({
    spaceId: secondSpace.id, quota: 'monthlyJourneyExports', idempotencyKey: 'export-one',
    intent: { mapId: 'map-b', versionId: 'version-b', format: 'pdf' }, sourceType: 'test_export', now: january
  });
  assert.equal(isolated.used, 1, 'idempotency and allowances are scoped to a space');

  for (let index = 0; index < 3; index += 1) consumeSubscriptionUsage({
    spaceId: accountingSpace.id, quota: 'monthlyAiActions', idempotencyKey: `ai-${index}`,
    intent: { action: 'test', index }, sourceType: 'direct_ai_action', now: '2026-08-16T00:00:00.000Z'
  });
  const forecast = meteredUsageSnapshot(accountingSpace.id, 'monthlyAiActions', '2026-08-16T00:00:00.000Z');
  assert.equal(forecast.used, 3);
  assert.equal(forecast.warningLevel, 'approaching');
  assert.ok(forecast.projectedPeriodEnd >= forecast.used);

  assert.equal(reconcileSubscriptionUsage(accountingSpace.id).matched, true);
  const januaryPeriod = usagePeriodAt(january);
  db.prepare(`UPDATE platform_usage_buckets SET quantity=0
    WHERE space_id=? AND meter='monthlyJourneyExports' AND period_start=?`)
    .run(accountingSpace.id, januaryPeriod.start);
  const drift = reconcileSubscriptionUsage(accountingSpace.id);
  assert.equal(drift.matched, false);
  assert.ok(drift.differences.some((item) => item.quota === 'monthlyJourneyExports'
    && item.ledgerQuantity === 2 && item.bucketQuantity === 0 && item.delta === 2));
});

test('legacy direct AI events backfill without copying metadata and retain replay accounting', () => {
  const metadata = JSON.stringify({ actionId: 'knowledge.answer', requestKey: 'legacy-request' });
  const eventId = crypto.randomUUID();
  db.prepare(`INSERT INTO platform_subscription_events
    (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
    VALUES (?,?,NULL,NULL,'usage.ai_action',?,?,?)`).run(
      eventId, secondSpace.id, user.id, metadata, '2026-08-04T12:00:00.000Z'
    );
  assert.equal(backfillLegacyDirectAiUsage().inserted, 1);
  const imported = db.prepare('SELECT * FROM platform_usage_events WHERE source_id=?').get(eventId) as any;
  assert.equal(imported.source_type, 'legacy_subscription_event');
  assert.equal('metadata_json' in imported, false);
  const replay = consumeDirectAiAction({
    spaceId: secondSpace.id, userId: user.id, actionId: 'knowledge.answer', requestKey: 'legacy-request'
  });
  assert.deepEqual(replay, { id: eventId, replayed: true });
  assert.equal(currentMonthlyAiActions(secondSpace.id, '2026-08-04T12:00:00.000Z'), 1);
});

test('an Aug 31 direct request retried after Sep 1 replays globally while a new request charges September', () => {
  const space = createSpace(user, { name: 'Direct AI month-boundary fixture' });
  const augustRequest = '2026-08-31T23:59:59.900Z';
  const septemberRetry = '2026-09-01T00:00:00.100Z';
  const first = consumeDirectAiAction({
    spaceId: space.id, userId: user.id, actionId: 'knowledge.answer',
    requestKey: 'month-boundary-request', now: augustRequest
  });
  const replay = consumeDirectAiAction({
    spaceId: space.id, userId: user.id, actionId: 'knowledge.answer',
    requestKey: 'month-boundary-request', now: septemberRetry
  });
  assert.deepEqual(replay, { id: first.id, replayed: true });
  assert.equal(aiUsageRows(space.id).length, 1);
  assert.equal(meteredUsageSnapshot(space.id, 'monthlyAiActions', augustRequest).used, 1);
  assert.equal(meteredUsageSnapshot(space.id, 'monthlyAiActions', septemberRetry).used, 0);

  consumeDirectAiAction({
    spaceId: space.id, userId: user.id, actionId: 'knowledge.answer',
    requestKey: 'new-september-request', now: septemberRetry
  });
  assert.equal(meteredUsageSnapshot(space.id, 'monthlyAiActions', septemberRetry).used, 1);
  assert.equal(aiUsageRows(space.id).length, 2);
  assert.equal(reconcileSubscriptionUsage(space.id).matched, true);
});

test('durable AI admission and retry claims charge each execution exactly once', () => {
  const space = createSpace(user, { name: 'Durable AI lifecycle fixture' });
  const job = createAdmittedAiJob('social.analyze', { mentionIds: [] }, space.id, null, null, user.id);
  assert.equal(job.attempt, 0);
  assert.equal(currentMonthlyAiActions(space.id), 1);
  assert.deepEqual(aiUsageRows(space.id).map((row) => [row.source_type, row.source_id]), [
    ['durable_ai_job_attempt', job.id]
  ]);

  const firstClaim = claimNextAdmittedAiJob();
  assert.ok(firstClaim && !firstClaim.denied);
  assert.equal(firstClaim.job.id, job.id);
  assert.equal(firstClaim.job.attempt, 1);
  assert.equal(currentMonthlyAiActions(space.id), 1, 'the initial claim must replay the creation reservation');

  const retry = reserveAiJobRetryAttempt(firstClaim.job);
  assert.equal(retry.replayed, false);
  assert.equal(retry.used, 2);
  const replay = reserveAiJobRetryAttempt(firstClaim.job);
  assert.equal(replay.replayed, true);
  assert.equal(replay.eventId, retry.eventId);
  assert.equal(currentMonthlyAiActions(space.id), 2);

  updateJob(job.id, { state: 'queued', stage: 'retrying', progress: 0, retryAt: null });
  const retryClaim = claimNextAdmittedAiJob();
  assert.ok(retryClaim && !retryClaim.denied);
  assert.equal(retryClaim.job.id, job.id);
  assert.equal(retryClaim.job.attempt, 2);
  assert.equal(currentMonthlyAiActions(space.id), 2, 'a retry claim must replay its pre-reserved attempt');
  assert.equal(aiUsageRows(space.id).length, 2);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, completedAt: new Date().toISOString() });
  assert.equal(reconcileSubscriptionUsage(space.id).matched, true);
});

test('an Aug 31 durable reservation claimed after Sep 1 replays globally and charges retries in their reservation month', () => {
  const space = createSpace(user, { name: 'Durable AI month-boundary fixture' });
  const augustAdmission = '2026-08-31T23:59:59.900Z';
  const septemberClaim = '2026-09-01T00:00:00.100Z';
  const august = usagePeriodAt(augustAdmission);
  const september = usagePeriodAt(septemberClaim);
  const job = createAdmittedAiJob('social.analyze', { mentionIds: [] }, space.id,
    null, null, user.id, augustAdmission);

  const firstClaim = claimNextAdmittedAiJob(septemberClaim);
  assert.ok(firstClaim && !firstClaim.denied);
  assert.equal(firstClaim.job.id, job.id);
  assert.equal(firstClaim.job.attempt, 1);
  assert.equal(aiUsageRows(space.id).length, 1, 'a delayed claim must not create a September copy of attempt 1');
  assert.equal(meteredUsageSnapshot(space.id, 'monthlyAiActions', augustAdmission).used, 1);
  assert.equal(meteredUsageSnapshot(space.id, 'monthlyAiActions', septemberClaim).used, 0);

  const retry = reserveAiJobRetryAttempt(firstClaim.job, 0, 2, septemberClaim);
  assert.equal(retry.replayed, false);
  assert.equal(retry.periodStart, september.start);
  updateJob(job.id, { state: 'queued', stage: 'retrying', progress: 0, retryAt: null });
  const retryClaim = claimNextAdmittedAiJob('2026-09-01T00:00:01.000Z');
  assert.ok(retryClaim && !retryClaim.denied);
  assert.equal(retryClaim.job.id, job.id);
  assert.equal(retryClaim.job.attempt, 2);
  assert.equal(aiUsageRows(space.id).length, 2);

  const buckets = db.prepare(`SELECT period_start,quantity FROM platform_usage_buckets
    WHERE space_id=? AND meter='monthlyAiActions' ORDER BY period_start`).all(space.id) as Array<any>;
  assert.deepEqual(buckets, [
    { period_start: august.start, quantity: 1 },
    { period_start: september.start, quantity: 1 }
  ]);
  assert.equal(reconcileSubscriptionUsage(space.id).matched, true);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, completedAt: new Date().toISOString() });
});

test('partial legacy durable adoption restores every missing prior attempt before a retry', () => {
  const space = createSpace(user, { name: 'Partial durable adoption fixture' });
  const job = createAiJobFixture('social.analyze', { mentionIds: [] }, space.id, null, null, user.id);
  db.prepare("UPDATE ai_jobs SET state='processing',attempt=2 WHERE id=?").run(job.id);

  reserveAiJobRetryAttempt(getJob(job.id)!, 0, 1);
  assert.equal(aiUsageRows(space.id).length, 2);
  const secondAttemptKey = `durable-ai-job:${job.id}:generation:0:attempt:2`;
  db.transaction(() => {
    db.prepare('DELETE FROM platform_usage_events WHERE space_id=? AND idempotency_key=?')
      .run(space.id, secondAttemptKey);
    db.prepare(`UPDATE platform_usage_buckets SET quantity=quantity-1
      WHERE space_id=? AND meter='monthlyAiActions'`).run(space.id);
  })();
  assert.equal(aiUsageRows(space.id).length, 1);

  const third = reserveAiJobRetryAttempt(getJob(job.id)!, 0, 3);
  assert.equal(third.used, 3);
  assert.equal(third.replayed, false);
  assert.deepEqual(aiUsageRows(space.id).map((row) => row.idempotency_key).sort(), [
    `durable-ai-job:${job.id}:generation:0:attempt:1`,
    secondAttemptKey,
    `durable-ai-job:${job.id}:generation:0:attempt:3`
  ].sort());
  assert.equal(reconcileSubscriptionUsage(space.id).matched, true);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, completedAt: new Date().toISOString() });
});

test('quota denial rolls a representative assistant artifact and its durable job back together', () => {
  const space = createSpace(user, { name: 'Assistant admission rollback fixture' });
  for (let index = 0; index < 4; index += 1) consumeDirectAiAction({
    spaceId: space.id, userId: user.id, actionId: 'knowledge.answer', requestKey: `rollback-${index}`
  });
  const before = {
    runs: Number((db.prepare('SELECT COUNT(*) count FROM assistant_runs WHERE space_id=?').get(space.id) as any).count),
    jobs: Number((db.prepare('SELECT COUNT(*) count FROM ai_jobs WHERE space_id=?').get(space.id) as any).count)
  };
  assert.throws(() => createAssistantKnowledgeRun({
    user: {
      id: user.id, name: user.name, email: 'usage-ledger@seemplify.local', role: 'admin',
      sessionVersion: 1, emailVerifiedAt: new Date().toISOString()
    },
    spaceId: space.id,
    question: 'What is the supported conclusion?',
    sources: [{
      sourceRef: 'evidence:test', type: 'knowledge', title: 'Test evidence',
      createdAt: new Date().toISOString(), content: 'A bounded authorized evidence fixture.'
    }],
    sourceRefs: ['evidence:test'], knowledgeBaseIds: [], requestFingerprint: 'rollback-fingerprint'
  }), (error: unknown) => error instanceof SubscriptionEntitlementError
    && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED');
  assert.deepEqual({
    runs: Number((db.prepare('SELECT COUNT(*) count FROM assistant_runs WHERE space_id=?').get(space.id) as any).count),
    jobs: Number((db.prepare('SELECT COUNT(*) count FROM ai_jobs WHERE space_id=?').get(space.id) as any).count)
  }, before);
  assert.equal(currentMonthlyAiActions(space.id), 4);
  assert.equal(aiUsageRows(space.id).length, 4);
});

test('a claim-time quota denial terminally fails its linked run, publishes state, and does not starve another space', async () => {
  const deniedSpace = createSpace(user, { name: 'Denied legacy claim fixture' });
  const admitted = createAssistantKnowledgeRun({
    user: {
      id: user.id, name: user.name, email: 'usage-ledger@seemplify.local', role: 'admin',
      sessionVersion: 1, emailVerifiedAt: new Date().toISOString()
    },
    spaceId: deniedSpace.id,
    question: 'Summarise the evidence.',
    sources: [{
      sourceRef: 'evidence:legacy', type: 'knowledge', title: 'Legacy evidence',
      createdAt: new Date().toISOString(), content: 'A legacy durable admission fixture.'
    }],
    sourceRefs: ['evidence:legacy'], knowledgeBaseIds: [], requestFingerprint: 'legacy-claim-fingerprint'
  });
  db.transaction(() => {
    db.prepare(`DELETE FROM platform_usage_events WHERE space_id=? AND source_type='durable_ai_job_attempt'
      AND source_id=?`).run(deniedSpace.id, admitted.job.id);
    db.prepare(`DELETE FROM platform_usage_buckets WHERE space_id=? AND meter='monthlyAiActions'`)
      .run(deniedSpace.id);
    db.prepare("UPDATE ai_jobs SET attempt=1,state='queued',stage='retrying' WHERE id=?").run(admitted.job.id);
  })();
  for (let index = 0; index < 3; index += 1) consumeDirectAiAction({
    spaceId: deniedSpace.id, userId: user.id, actionId: 'knowledge.answer', requestKey: `claim-denied-${index}`
  });
  assert.equal(currentMonthlyAiActions(deniedSpace.id), 4);

  const continuationSpace = createSpace(user, { name: 'Claim continuation fixture' });
  const continuation = createAdmittedAiJob('social.analyze', { mentionIds: [] }, continuationSpace.id,
    null, null, user.id);
  const events: Array<{ type: string; data: any; spaceId: string | null }> = [];
  const unsubscribe = subscribePublishedEvents((event) => events.push(event as any));
  try {
    aiJobRunner.start();
    assert.equal(await aiJobRunner.drain(), true);
  } finally {
    aiJobRunner.stop();
    unsubscribe();
  }

  const deniedJob = getJob(admitted.job.id)!;
  assert.equal(deniedJob.state, 'failed');
  assert.equal(deniedJob.stage, 'subscription_quota_exceeded');
  assert.equal(deniedJob.retryAt, null);
  const deniedRun = db.prepare('SELECT state,error,completed_at FROM assistant_runs WHERE id=?')
    .get(admitted.run.id) as any;
  assert.equal(deniedRun.state, 'failed');
  assert.ok(deniedRun.error);
  assert.ok(deniedRun.completed_at);
  assert.ok(events.some((event) => event.spaceId === deniedSpace.id && event.type === 'data-changed'
    && event.data?.reason === 'assistant-data-changed'));

  const continuedJob = getJob(continuation.id)!;
  assert.equal(continuedJob.state, 'failed', 'the worker must continue to the next eligible space after denial');
  assert.equal(continuedJob.attempt, 1);
  assert.notEqual(continuedJob.stage, 'subscription_quota_exceeded');
  assert.ok(events.some((event) => event.spaceId === continuationSpace.id && event.type === 'ai-job'
    && event.data?.id === continuation.id && event.data?.state === 'failed'));
});

test('Journey exports render before charging, enforce exact quotas, and expose aggregate-only usage', async () => {
  const created = await agent.post('/api/journey-maps').set('X-Seemplify-Space', routeSpace.id).send({
    name: 'Metered export map', stageNames: ['Discover']
  }).expect(201);
  const definitionId = String(created.body.id);
  const readModel = getJourneyMap(routeSpace.id, definitionId, undefined, user.id);
  assert.ok(readModel);
  await assert.rejects(() => buildMeteredJourneyMapExport({
    map: readModel!, format: 'json', spaceId: routeSpace.id, userId: user.id, idempotencyKey: 'failed-render'
  }, async () => { throw new Error('renderer failed'); }), /renderer failed/u);
  assert.equal(meteredUsageSnapshot(routeSpace.id, 'monthlyJourneyExports').used, 0,
    'a failed renderer must not create usage');

  const first = await agent.get(`/api/journey-maps/${definitionId}/export.json`)
    .set('X-Seemplify-Space', routeSpace.id).set('Idempotency-Key', 'route-export-one').expect(200);
  assert.equal(first.headers['x-seemplify-usage-used'], '1');
  assert.equal(first.headers['x-seemplify-usage-replayed'], 'false');
  assert.match(String(first.headers['x-seemplify-usage-receipt']), /^[0-9a-f-]{36}$/u);
  const replay = await agent.get(`/api/journey-maps/${definitionId}/export.json`)
    .set('X-Seemplify-Space', routeSpace.id).set('Idempotency-Key', 'route-export-one').expect(200);
  assert.equal(replay.headers['x-seemplify-usage-used'], '1');
  assert.equal(replay.headers['x-seemplify-usage-replayed'], 'true');
  assert.equal(replay.headers['x-seemplify-usage-receipt'], first.headers['x-seemplify-usage-receipt']);
  await agent.get(`/api/journey-maps/${definitionId}/export.csv`)
    .set('X-Seemplify-Space', routeSpace.id).set('Idempotency-Key', 'route-export-one').expect(409)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT'));
  await agent.get(`/api/journey-maps/${definitionId}/export.csv`)
    .set('X-Seemplify-Space', routeSpace.id).set('Idempotency-Key', 'route-export-two').expect(200)
    .expect('X-Seemplify-Usage-Used', '2');
  await agent.get(`/api/journey-maps/${definitionId}/export.png`)
    .set('X-Seemplify-Space', routeSpace.id).set('Idempotency-Key', 'route-export-three').expect(409)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED'));
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyJourneyExports'`).get(routeSpace.id) as any).count), 2);

  const current = await agent.get('/api/subscriptions/current').set('X-Seemplify-Space', routeSpace.id).expect(200);
  const exportUsage = current.body.meteredUsage.find((item: any) => item.quota === 'monthlyJourneyExports');
  assert.deepEqual({ used: exportUsage.used, limit: exportUsage.limit, remaining: exportUsage.remaining },
    { used: 2, limit: 2, remaining: 0 });
  for (const forbidden of ['eventId', 'idempotencyKey', 'intentHash', 'sourceId', 'actorUserId']) {
    assert.equal(JSON.stringify(current.body.meteredUsage).includes(forbidden), false);
  }

  const platform = await agent.get(`/api/platform-admin/spaces/${routeSpace.id}`).expect(200);
  assert.equal(platform.body.meteredUsage.find((item: any) => item.quota === 'monthlyJourneyExports').used, 2);
  assert.equal(JSON.stringify(platform.body.meteredUsage).includes('route-export-one'), false);
});
