import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-path-intelligence-routes-'));
const file = (name: string) => path.join(root, name);
fs.writeFileSync(file('admin-password'), 'Path-Intelligence-Routes-2026!');
fs.writeFileSync(file('session-secret'), 'path-intelligence-session-secret-that-is-long-enough');
fs.writeFileSync(file('terra-secret'), 'path-intelligence-terra-secret-that-is-long-enough');
fs.writeFileSync(file('x-key'), Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(file('esign-key'), Buffer.alloc(32, 72).toString('base64url'));
fs.writeFileSync(file('identity-key'), crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: file('test.sqlite'), UPLOAD_DIR: file('uploads'), FRONTEND_DIST: file('missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'path-intelligence@seemplify.local',
  ADMIN_PASSWORD_FILE: file('admin-password'), SESSION_SECRET_FILE: file('session-secret'),
  TERRA_GATEWAY_SHARED_SECRET_FILE: file('terra-secret'), LOCAL_LLM_SHARED_SECRET_FILE: file('terra-secret'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: file('x-key'), ESIGN_STORAGE_DIR: file('esign'), ESIGN_ENCRYPTION_KEY_FILE: file('esign-key'),
  JOURNEY_IDENTITY_HASH_KEY_FILE: file('identity-key'), X_SEED_CONSUMER_KEY_FILE: file('missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: file('missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: file('missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: file('missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: file('missing-x-token-secret')
});
const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function owner() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'path-intelligence@seemplify.local', password: 'Path-Intelligence-Routes-2026!' }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}
async function member(spaceId: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, { name: 'Path member', email: 'path-member@example.test',
    password: 'Path-Member-Routes-2026!', spaceName: 'Path member home' });
  const session = await agent.get('/api/auth/session').expect(200); const userId = String(session.body.user.id);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)')
    .run(spaceId, userId, 'member', now, now);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId };
}
const body = (journeyDefinitionId: string) => ({ journeyDefinitionId,
  from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z', asOf: '2026-08-02T00:00:00.000Z',
  minimumSampleSize: 10, secondarySuppressionThreshold: 3 });

test('actual-path intelligence is tenant scoped, manager reviewed, conflict safe, and never mutates a journey', async () => {
  const current = await owner(); const readonly = await member(current.spaceId);
  const map = maps.createJourneyMap(current.spaceId, current.userId, { name: 'Inference review journey', stageNames: ['Start', 'Finish'] });
  const revisionBefore = Number((db.prepare('SELECT revision FROM journey_definitions WHERE id=? AND space_id=?')
    .get(map.id, current.spaceId) as any).revision);
  const comparisonQuery = {
    journeyDefinitionId: map.id,
    baselineFrom: '2026-07-01T00:00:00.000Z', baselineTo: '2026-08-01T00:00:00.000Z',
    currentFrom: '2026-08-01T00:00:00.000Z', currentTo: '2026-09-01T00:00:00.000Z',
    minimumSampleSize: 10, secondarySuppressionThreshold: 3, limit: 20
  };
  await readonly.agent.get('/api/journey-metrics/actual-path-snapshots')
    .query({journeyDefinitionId:map.id,limit:20}).expect(200)
    .expect(({body})=>assert.deepEqual(body.snapshots,[]));
  await readonly.agent.get('/api/journey-metrics/actual-path-rollups/latest')
    .query({journeyDefinitionId:map.id}).expect(200)
    .expect(({body})=>assert.equal(body.rollup,null));
  await readonly.agent.post('/api/journey-metrics/actual-path-snapshots').send({journeyDefinitionId:map.id,
    minimumCohortSize:10}).expect(403).expect(({body:error})=>assert.equal(error.code,'JOURNEY_STAGE_REPROJECTION_EDIT_REQUIRED'));
  await readonly.agent.post('/api/journey-metrics/actual-path-rollups/materialize').send({journeyDefinitionId:map.id,
    minimumCohortSize:10}).expect(403).expect(({body:error})=>assert.equal(error.code,'JOURNEY_STAGE_REPROJECTION_EDIT_REQUIRED'));
  db.prepare(`INSERT INTO journey_stage_reprojection_runs
    (id,space_id,reason,journey_definition_id,journey_map_version_id,state,available_at,lease_generation,attempt_count,
     max_attempts,summary_json,idempotency_key,intent_sha256,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,'completed',?,0,1,5,'{}',?,?,?, ?,?)`).run('path-comparison-correction', current.spaceId,
      'manual', map.id, map.currentVersionId, '2026-09-02T00:00:00.000Z', 'path-comparison-correction', 'e'.repeat(64),
      '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
  const comparison = await current.agent.get('/api/journey-metrics/actual-path-comparisons')
    .query(comparisonQuery).expect(200);
  assert.equal(comparison.body.comparison.status, 'abstained');
  assert.equal(comparison.body.comparison.interpretation.mode, 'descriptive_comparison_only');
  assert.equal(comparison.body.comparison.provenance.sourceCitations.length, 2);
  assert.ok(comparison.body.comparison.provenance.sourceCitations.every((row: any) => /^[a-f0-9]{64}$/u.test(row.analyticsContentSha256)));
  const currentCitation = comparison.body.comparison.provenance.sourceCitations.find((row: any) => row.window === 'current');
  assert.equal(currentCitation.correction.latestCompletedReprojection.id, 'path-comparison-correction');
  assert.match(currentCitation.correction.latestCompletedReprojection.sourceScopeSha256, /^[a-f0-9]{64}$/u);
  assert.notEqual(currentCitation.correction.latestCompletedReprojection.sourceScopeSha256, 'all_sources');
  await readonly.agent.get('/api/journey-metrics/actual-path-comparisons').query(comparisonQuery).expect(200);
  await current.agent.get('/api/journey-metrics/actual-path-comparisons').query({ ...comparisonQuery,
    currentFrom: '2026-07-15T00:00:00.000Z' }).expect(400)
    .expect(({ body: error }) => assert.equal(error.code, 'JOURNEY_ACTUAL_PATH_COMPARISON_INVALID'));
  const created = await current.agent.post('/api/journey-metrics/actual-path-intelligence/runs').send(body(map.id)).expect(201);
  assert.equal(created.body.run.result.status, 'abstained');
  assert.ok(created.body.run.result.abstentionReasons.includes('PRIMARY_SAMPLE_SUPPRESSED')
    || created.body.run.result.abstentionReasons.includes('MINIMUM_SAMPLE_NOT_MET'));
  const replay = await current.agent.post('/api/journey-metrics/actual-path-intelligence/runs').send(body(map.id)).expect(200);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.run.contentSha256, created.body.run.contentSha256);
  await readonly.agent.get('/api/journey-metrics/actual-path-intelligence/runs').query({ journeyDefinitionId: map.id }).expect(200);
  await readonly.agent.post('/api/journey-metrics/actual-path-intelligence/runs').send(body(map.id)).expect(403);

  const recommendationId = crypto.randomUUID(); const now = new Date().toISOString();
  const recommendation = { key: 'start->finish', kind: 'review_stage_inference_rule', fromStageId: 'start', inferredStageId: 'finish',
    evidence: { occurrenceCount: 3, sampleSize: 10, percentage: 30 }, confidence: {
      sampleSufficiency: { observed: 10, required: 10, met: true }, recurrence: { observed: 3, required: 3, met: true },
      visibility: { suppressed: false } }, rationale: 'Review this deterministic stage inference.', limitations: ['Descriptive only.'],
    applyMode: 'human_review_only' };
  db.prepare(`INSERT INTO journey_stage_inference_recommendations
    (id,run_id,space_id,journey_definition_id,journey_map_version_id,recommendation_key,content_json,content_sha256,state,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'draft',1,?,?)`).run(recommendationId, created.body.run.id, current.spaceId, map.id,
      created.body.run.journeyMapVersionId, recommendation.key, JSON.stringify(recommendation), 'a'.repeat(64), now, now);
  const review = await current.agent.patch(`/api/journey-metrics/actual-path-intelligence/recommendations/${recommendationId}`)
    .send({ expectedRevision: 1, state: 'in_review', reason: 'Validate the observed transition.' }).expect(200);
  assert.equal(review.body.recommendation.revision, 2);
  await current.agent.patch(`/api/journey-metrics/actual-path-intelligence/recommendations/${recommendationId}`)
    .send({ expectedRevision: 1, state: 'accepted', reason: 'Stale review attempt.' }).expect(409)
    .expect(({ body: error }) => assert.equal(error.code, 'JOURNEY_STAGE_INFERENCE_REVISION_CONFLICT'));
  await readonly.agent.patch(`/api/journey-metrics/actual-path-intelligence/recommendations/${recommendationId}`)
    .send({ expectedRevision: 2, state: 'accepted', reason: 'Member may not accept.' }).expect(403);
  const accepted = await current.agent.patch(`/api/journey-metrics/actual-path-intelligence/recommendations/${recommendationId}`)
    .send({ expectedRevision: 2, state: 'accepted', reason: 'Reviewed as a recommendation only.' }).expect(200);
  assert.equal(accepted.body.recommendation.state, 'accepted');
  const revisionAfter = Number((db.prepare('SELECT revision FROM journey_definitions WHERE id=? AND space_id=?')
    .get(map.id, current.spaceId) as any).revision);
  assert.equal(revisionAfter, revisionBefore, 'accepting a recommendation must not apply a journey change');
  const auditDetails = (db.prepare(`SELECT detail_json FROM journey_path_intelligence_audit
    WHERE recommendation_id=? AND action='recommendation.reviewed' ORDER BY revision`).all(recommendationId) as any[])
    .map((row) => String(row.detail_json));
  assert.equal(auditDetails.length, 2);
  assert.ok(auditDetails.every((detail) => /"reasonSha256":"[a-f0-9]{64}"/u.test(detail)));
  assert.ok(auditDetails.every((detail) => !detail.includes('Validate the observed transition')
    && !detail.includes('Reviewed as a recommendation only')), 'append-only audit must not retain review text');

  const foreign = await signupVerifyAndOnboard(request.agent(app), { name: 'Foreign', email: 'path-foreign@example.test',
    password: 'Path-Foreign-Routes-2026!', spaceName: 'Foreign path space' });
  void foreign;
  const foreignAgent = request.agent(app);
  await foreignAgent.post('/api/auth/login').send({ email: 'path-foreign@example.test', password: 'Path-Foreign-Routes-2026!' }).expect(200);
  const foreignSession = await foreignAgent.get('/api/auth/session').expect(200);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(String(foreignSession.body.activeSpace.id));
  await foreignAgent.patch(`/api/journey-metrics/actual-path-intelligence/recommendations/${recommendationId}`)
    .send({ expectedRevision: 3, state: 'retired', reason: 'Foreign tenant attempt.' }).expect(404);

  db.prepare("UPDATE platform_subscriptions SET plan_code='team' WHERE space_id=?").run(current.spaceId);
  await current.agent.get('/api/journey-metrics/actual-path-intelligence/runs').query({ journeyDefinitionId: map.id })
    .expect(403).expect(({ body: error }) => assert.equal(error.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));
  await current.agent.get('/api/journey-metrics/actual-path-comparisons').query(comparisonQuery)
    .expect(403).expect(({ body: error }) => assert.equal(error.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));
});
