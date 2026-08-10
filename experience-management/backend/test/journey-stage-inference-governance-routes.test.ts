import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-stage-inference-governance-'));
const file = (name: string) => path.join(root, name);
fs.writeFileSync(file('admin-password'), 'Stage-Inference-Governance-2026!');
fs.writeFileSync(file('session-secret'), 'stage-inference-governance-session-secret-long-enough');
fs.writeFileSync(file('terra-secret'), 'stage-inference-governance-terra-secret-long-enough');
fs.writeFileSync(file('x-key'), Buffer.alloc(32, 81).toString('base64url'));
fs.writeFileSync(file('esign-key'), Buffer.alloc(32, 82).toString('base64url'));
fs.writeFileSync(file('identity-key'), crypto.randomBytes(48));
Object.assign(process.env, { DATABASE_PATH: file('test.sqlite'), UPLOAD_DIR: file('uploads'), FRONTEND_DIST: file('missing'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'stage-inference@seemplify.local',
  ADMIN_PASSWORD_FILE: file('admin-password'), SESSION_SECRET_FILE: file('session-secret'),
  TERRA_GATEWAY_SHARED_SECRET_FILE: file('terra-secret'), LOCAL_LLM_SHARED_SECRET_FILE: file('terra-secret'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: file('x-key'), ESIGN_STORAGE_DIR: file('esign'), ESIGN_ENCRYPTION_KEY_FILE: file('esign-key'),
  JOURNEY_IDENTITY_HASH_KEY_FILE: file('identity-key'), X_SEED_CONSUMER_KEY_FILE: file('missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: file('missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: file('missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: file('missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: file('missing-x-token-secret') });
const { app } = await import('../src/app.js'); const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function owner() {
  const agent = request.agent(app); await agent.post('/api/auth/login').send({ email: 'stage-inference@seemplify.local',
    password: 'Stage-Inference-Governance-2026!' }).expect(200); const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId: String(session.body.user.id) };
}
async function collaborator(spaceId: string, suffix: string, role: 'admin' | 'member') {
  const agent = request.agent(app); await signupVerifyAndOnboard(agent, { name: `Reviewer ${suffix}`, email: `${suffix}@example.test`,
    password: `Reviewer-${suffix}-2026!`, spaceName: `${suffix} home` }); const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id); const now = new Date().toISOString();
  db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)')
    .run(spaceId, userId, role, now, now); db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId };
}

function insertObservedPaths(input: { spaceId: string; definitionId: string; versionId: string;
  stages: Array<{ stageKey: string }>; count: number }) {
  const insertInstance = db.prepare(`INSERT INTO journey_anonymous_instances
    (id,space_id,source_id,environment,journey_definition_id,subject_kind,anonymous_id_hash,state,current_stage_key,
     first_event_at,latest_event_at,latest_event_id,latest_visit_id,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,'anonymous',?,'active',NULL,?,?,?,NULL,1,?,?)`);
  const insertDecision = db.prepare(`INSERT INTO journey_stage_rule_decisions
    (id,decision_key,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,journey_definition_id,
     journey_map_version_id,subject_kind,anonymous_id_hash,outcome,matched_rule_definition_id,matched_rule_version_id,
     matched_rule_version_number,stage_key,role,event_occurred_at,evaluated_at,is_late,is_out_of_order,rule_set_sha256,
     trace_json,provenance_json,processor,processor_version,lease_generation,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,'production',?,?,?,'anonymous',?,'matched',?,?,1,?,'progress',?,?,0,0,?,'{}','{}','test','projection-v1',1,?,?)`);
  const insertVisit = db.prepare(`INSERT INTO journey_anonymous_stage_visits
    (id,assignment_key,instance_id,decision_id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
     journey_definition_id,journey_map_version_id,subject_kind,stage_key,role,rule_definition_id,rule_version_id,
     rule_version_number,event_occurred_at,visited_at,is_late,is_out_of_order,applied_to_current,non_application_reason,
     prior_stage_key,provenance_json,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?, 'production',?,?,?,'anonymous',?,'progress',?,?,1,?,?,0,0,1,NULL,?,'{}',?,?)`);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    for (const window of ['baseline', 'current'] as const) for (let index = 0; index < input.count; index += 1) {
      const start = window === 'baseline' ? Date.UTC(2026, 0, 10, 10, index) : Date.UTC(2026, 1, 10, 10, index);
      const sequence = window === 'baseline' ? [input.stages[0]!, input.stages[1]!] : [input.stages[1]!, input.stages[0]!];
      const instanceId = `${window}-instance-${index}`; const anonymousHash = hash(`${window}-anonymous-${index}`);
      const first = new Date(start).toISOString(); const second = new Date(start + 60_000).toISOString();
      insertInstance.run(instanceId, input.spaceId, 'source-stage-inference', 'production', input.definitionId, anonymousHash,
        first, second, `${window}-event-${index}-1`, first, first);
      sequence.forEach((stage, position) => {
        const at = new Date(start + position * 60_000).toISOString(); const rawAt = new Date(start + position * 60_000 + 1).toISOString();
        const key = `${window}-${index}-${position}`; const decisionId = `decision-${key}`;
        insertDecision.run(decisionId, hash(`decision-${key}`), rawAt, `raw-${key}`, input.spaceId, 'source-stage-inference',
          `event-${key}`, input.definitionId, input.versionId, anonymousHash, `rule-definition-${position}`,
          `rule-version-${position}`, stage.stageKey, at, at, 'a'.repeat(64), at, '2027-01-01T00:00:00.000Z');
        insertVisit.run(`visit-${key}`, hash(`assignment-${key}`), instanceId, decisionId, rawAt, `raw-${key}`,
          input.spaceId, 'source-stage-inference', `event-${key}`, input.definitionId, input.versionId, stage.stageKey,
          `rule-definition-${position}`, `rule-version-${position}`, at, at, position ? sequence[position - 1]!.stageKey : null,
          at, '2027-01-01T00:00:00.000Z');
      });
    }
  } finally { db.exec('PRAGMA foreign_keys=ON'); }
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const scope = (journeyDefinitionId: string) => ({ journeyDefinitionId,
  baselineFrom: '2026-01-01T00:00:00.000Z', baselineTo: '2026-02-01T00:00:00.000Z',
  currentFrom: '2026-02-01T00:00:00.000Z', currentTo: '2026-03-01T00:00:00.000Z',
  minimumSampleSize: 10, minimumRecurrence: 10, minimumCoverage: 0.7, minimumWinningMargin: 0.2 });

test('governed stage inference is tenant-scoped, two-person reviewed, revision-safe and never mutates stages', async () => {
  const current = await owner(); const reviewer1 = await collaborator(current.spaceId, 'reviewer-one', 'admin');
  const reviewer2 = await collaborator(current.spaceId, 'reviewer-two', 'admin');
  const member = await collaborator(current.spaceId, 'readonly-member', 'member');
  const mapSummary = maps.createJourneyMap(current.spaceId, current.userId, { name: 'Governed inference journey',
    stageNames: ['Discover', 'Activate'] });
  const map = maps.getJourneyMap(current.spaceId, mapSummary.id, mapSummary.currentVersionId)!;
  insertObservedPaths({ spaceId: current.spaceId, definitionId: mapSummary.id, versionId: mapSummary.currentVersionId,
    stages: map.stages, count: 20 });
  const beforeRevision = Number((db.prepare('SELECT revision FROM journey_definitions WHERE id=? AND space_id=?')
    .get(mapSummary.id, current.spaceId) as any).revision);
  const beforeVisits = Number((db.prepare('SELECT COUNT(*) count FROM journey_anonymous_stage_visits WHERE space_id=?')
    .get(current.spaceId) as any).count);
  const preview = await current.agent.get('/api/journey-metrics/actual-path-stage-inference/preview').query(scope(mapSummary.id)).expect(200);
  assert.equal(preview.body.result.status, 'recommended'); assert.equal(preview.body.result.recommendations.length, 1);
  assert.equal(preview.body.result.recommendations[0].review.applyMode, 'never_automatic');
  const created = await current.agent.post('/api/journey-metrics/actual-path-stage-inference/runs').send(scope(mapSummary.id)).expect(201);
  const recommendation = created.body.recommendations[0]; assert.equal(recommendation.state, 'draft');
  const replay = await current.agent.post('/api/journey-metrics/actual-path-stage-inference/runs').send(scope(mapSummary.id)).expect(200);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.run.contentSha256, created.body.run.contentSha256);
  await member.agent.get('/api/journey-metrics/actual-path-stage-inference/recommendations').query({ journeyDefinitionId: mapSummary.id }).expect(200);
  await member.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 1, action: 'submit_for_review', reason: 'Member cannot review.' }).expect(403);
  const submitted = await reviewer1.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 1, action: 'submit_for_review', reason: 'First independent evidence review.' }).expect(200);
  assert.equal(submitted.body.recommendation.state, 'in_review'); assert.equal(submitted.body.recommendation.reviewReasonProof.length, 34);
  await reviewer1.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 2, action: 'approve', reason: 'Cannot self approve.' }).expect(403);
  await current.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 2, action: 'approve', reason: 'Proposer cannot approve.' }).expect(403);
  const approved = await reviewer2.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 2, action: 'approve', reason: 'Second independent reviewer approves the recommendation.' }).expect(200);
  assert.equal(approved.body.recommendation.state, 'approved'); assert.equal(approved.body.recommendation.revision, 3);
  await reviewer2.agent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 2, action: 'retire', reason: 'Stale revision.' }).expect(409);
  assert.equal(Number((db.prepare('SELECT revision FROM journey_definitions WHERE id=? AND space_id=?')
    .get(mapSummary.id, current.spaceId) as any).revision), beforeRevision);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_anonymous_stage_visits WHERE space_id=?')
    .get(current.spaceId) as any).count), beforeVisits);
  const audit = db.prepare('SELECT detail_json FROM journey_path_intelligence_audit WHERE recommendation_id=? ORDER BY revision')
    .all(recommendation.id) as any[];
  assert.ok(audit.every((row) => !String(row.detail_json).includes('independent reviewer')));

  const foreignAgent = request.agent(app); await signupVerifyAndOnboard(foreignAgent, { name: 'Foreign reviewer',
    email: 'foreign-stage-review@example.test', password: 'Foreign-Stage-Review-2026!', spaceName: 'Foreign stage space' });
  const foreignSession = await foreignAgent.get('/api/auth/session').expect(200);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(String(foreignSession.body.activeSpace.id));
  await foreignAgent.post(`/api/journey-metrics/actual-path-stage-inference/recommendations/${recommendation.id}/review`)
    .send({ expectedRevision: 3, action: 'retire', reason: 'Cross tenant attempt.' }).expect(404);
});
