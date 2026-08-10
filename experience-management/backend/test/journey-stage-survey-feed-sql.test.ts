import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-survey-feed-'));
for (const [name, value] of [['admin', 'Runtime43-Test-2026!'], ['session', 'runtime43-session-secret-long-enough'],
  ['terra', 'runtime43-terra-secret-long-enough'], ['identity', Buffer.alloc(32, 43)] ] as const) fs.writeFileSync(path.join(root, name), value);
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing'),
  PUBLIC_URL: 'http://127.0.0.1:5483', ADMIN_EMAIL: 'runtime43@seemplify.local', ADMIN_PASSWORD_FILE: path.join(root, 'admin'),
  SESSION_SECRET_FILE: path.join(root, 'session'), TERRA_GATEWAY_SHARED_SECRET_FILE: path.join(root, 'terra'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra'), EMAIL_MODE: 'log', JOURNEY_IDENTITY_HASH_KEY_FILE: path.join(root, 'identity'),
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing') });

const database = await import('../src/database.js'); const { db } = database;
await import('../src/spaces.js');
const { ensurePlatformSchema } = await import('../src/platformSchema.js'); ensurePlatformSchema();
const { ensureJourneyMetricSchema } = await import('../src/journeyMetricSchema.js'); ensureJourneyMetricSchema();
await import('../src/journeyStageIntelligenceSqlRepository.js');
const { JourneyStageSurveyFeedRepository } = await import('../src/journeyStageSurveyFeedRepository.js');
const { purgeExpiredJourneyStageSurveyFeed } = await import('../src/journeyStageSurveyFeedRetention.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const ids = { user: crypto.randomUUID(), space: crypto.randomUUID(), journey: crypto.randomUUID(), version: crypto.randomUUID(),
  stage: crypto.randomUUID(), binding: crypto.randomUUID(), definition: crypto.randomUUID(), metricVersion: crypto.randomUUID() };
const at = '2026-08-08T10:00:00.000Z';
db.transaction(() => {
  db.prepare(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES (?,?,?,'hash','member',1,?,?)`).run(ids.user, 'runtime43-owner@example.test', 'Owner', at, at);
  db.prepare(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES (?,?,?, ?,NULL,?,?)`).run(ids.space, 'Runtime 43', `runtime43-${ids.space}`, ids.user, at, at);
  db.prepare(`INSERT INTO journey_definitions(id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
    current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES (?,?,?,'Survey intelligence','customer','current_state','connected','draft',?,?,NULL,0,1,?,?)`)
    .run(ids.journey, ids.space, 'Survey journey', ids.user, ids.version, at, at);
  db.prepare(`INSERT INTO journey_map_versions(id,definition_id,space_id,version_number,schema_version,state,map_type,mode,
    experience_type,objective,industry,summary,legacy_audience,provenance_json,author_user_id,created_at)
    VALUES (?,?,?,1,2,'draft','current_state','connected','customer','','','','','{}',?,?)`)
    .run(ids.version, ids.journey, ids.space, ids.user, at);
  db.prepare(`INSERT INTO journey_map_stages(id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES (?,?,?,'discover','Discover','','',0)`).run(ids.stage, ids.version, ids.space);
})();
const survey = database.saveSurvey({ title: 'NPS', status: 'live', primaryMetric: 'nps' }, [{ id: 'nps-question', type: 'nps',
  title: 'Recommend?', settings: { minimum: 0, maximum: 10 } }], ids.space);
const collector = database.createCollector(survey.id, { type: 'web', status: 'open', name: 'Web' });
db.transaction(() => {
  db.prepare(`INSERT INTO journey_metric_bindings(id,space_id,journey_definition_id,target_type,target_id,stage_id,
    survey_id,survey_space_id,collector_id,collector_survey_id,question_id,question_survey_id,source_ref,state,revision,
    idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'stage',?,?, ?,?,?,?, 'nps-question',?,'survey:nps','active',1,'binding-key',?,?,?,?)`)
    .run(ids.binding, ids.space, ids.journey, ids.stage, ids.stage, survey.id, ids.space, collector.id, survey.id,
      survey.id, 'a'.repeat(64), ids.user, at, at);
  db.prepare(`INSERT INTO journey_metric_definitions(id,space_id,journey_definition_id,target_type,target_id,stage_id,name,state,
    current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'stage',?,?,'NPS','active',?,1,'definition-key',?,?,?,?)`)
    .run(ids.definition, ids.space, ids.journey, ids.stage, ids.stage, ids.metricVersion, 'b'.repeat(64), ids.user, at, at);
  db.prepare(`INSERT INTO journey_metric_definition_versions(id,definition_id,space_id,version_number,source_kind,binding_id,
    calculator_kind,aggregation,direction,window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,
    population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
    VALUES (?,?,?,1,'survey',?,'nps','mean','higher_is_better',86400,'UTC',3,86400,'{}','{}','{}',?,?, 'metric-version-key',?,?,?)`)
    .run(ids.metricVersion, ids.definition, ids.space, ids.binding,
      JSON.stringify({ scale: { minimum: 0, maximum: 10 }, formula: { promoterMinimum: 9, detractorMaximum: 6 } }),
      'c'.repeat(64), 'd'.repeat(64), ids.user, at);
})();
const repository = new JourneyStageSurveyFeedRepository();
const policy = repository.createPolicy({ spaceId: ids.space, surveyId: survey.id, collectorId: collector.id,
  actorUserId: ids.user, notice: 'We use this score for governed journey analytics only.',
  allowedPurposes: ['analytics'], retentionDays: 30, now: at });
const mapping = repository.createMapping({ spaceId: ids.space, metricDefinitionId: ids.definition, actorUserId: ids.user,
  allowedPurposes: ['analytics'], retentionDays: 20, idempotencyKey: 'runtime43-mapping-key', now: at });
assert.equal(repository.publicPolicy(ids.space, survey.id, collector.id)?.notice,
  'We use this score for governed journey analytics only.');

test('active mapping fails closed without current explicit governance', () => {
  const before = (db.prepare('SELECT COUNT(*) count FROM responses').get() as any).count;
  assert.throws(() => db.transaction(() => {
    const atomic = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'atomic-private',
      answers: { 'nps-question': 10 } });
    repository.recordResponse({ spaceId: ids.space, survey, collector, response: atomic, now: at });
  })(), /Explicit consent/u);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM responses').get() as any).count, before,
    'the public response and governed outbox boundary must roll back together');
  const response = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'private-subject',
    answers: { 'nps-question': 10 } });
  assert.throws(() => repository.recordResponse({ spaceId: ids.space, survey, collector, response, now: at }), /Explicit consent/u);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_survey_outbox').get() as any).count, 0);
});

test('granted response creates only pseudonymous immutable projection and worker applies exact lineage once', () => {
  const response = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'private-subject',
    answers: { 'nps-question': 10 } });
  assert.deepEqual(repository.recordResponse({ spaceId: ids.space, survey, collector, response, now: at,
    governance: { policyVersionId: policy.versionId, noticeAcknowledged: true, consentState: 'granted', purposes: ['analytics'] } }),
  { mapped: 1, skipped: false });
  const serialized = JSON.stringify(db.prepare('SELECT * FROM journey_stage_survey_source_revisions').all());
  assert.equal(serialized.includes('private-subject'), false); assert.equal(serialized.includes('nps-question":10'), false);
  const claim = repository.claim({ owner: 'runtime43-test', now: at }); assert.ok(claim);
  assert.deepEqual(repository.execute(claim, at), { complete: true, applied: 1 });
  const fact = db.prepare('SELECT * FROM journey_stage_intelligence_facts').get() as any;
  assert.match(fact.subject_id_hmac, /^[a-f0-9]{64}$/u); assert.equal(fact.value, 100);
  assert.equal(fact.metric_definition_version_sha256, 'c'.repeat(64));
  assert.throws(() => repository.execute(claim, at), /lease was lost/u);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_intelligence_facts').get() as any).count, 1);
});

test('denied consent records governance proof but cannot enqueue a fact', () => {
  const response = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'denied-subject',
    answers: { 'nps-question': 9 } });
  assert.deepEqual(repository.recordResponse({ spaceId: ids.space, survey, collector, response, now: at,
    governance: { policyVersionId: policy.versionId, noticeAcknowledged: true, consentState: 'denied', purposes: ['analytics'] } }),
  { mapped: 0, skipped: false });
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_stage_survey_governance_receipts WHERE consent_state='denied'").get() as any).count, 1);
});

test('execution failure is durably backed off and the fenced retry applies once', () => {
  const response = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'retry-subject',
    answers: { 'nps-question': 2 } });
  repository.recordResponse({ spaceId: ids.space, survey, collector, response, now: at,
    governance: { policyVersionId: policy.versionId, noticeAcknowledged: true, consentState: 'granted', purposes: ['analytics'] } });
  const claim = repository.claim({ owner: 'runtime43-failure', now: at }); assert.ok(claim);
  assert.equal(repository.fail(claim, 'INJECTED_PROVIDER_FAILURE', at), true);
  assert.equal(repository.fail(claim, 'INJECTED_PROVIDER_FAILURE', at), false, 'stale fence cannot fail the retry twice');
  const retryAt = '2026-08-08T10:01:00.000Z'; const retry = repository.claim({ owner: 'runtime43-retry', now: retryAt });
  assert.ok(retry); assert.ok(Number(retry.lease_generation) > Number(claim.lease_generation));
  assert.deepEqual(repository.execute(retry, retryAt), { complete: true, applied: 1 });
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_stage_survey_outbox_attempts WHERE outcome='retry_wait'").get() as any).count, 1);
});

test('survey deletion is mapping-scoped and tombstones retained facts without raw survey IDs', () => {
  assert.deepEqual(repository.enqueueSurveyDeletion({ spaceId: ids.space, surveyId: survey.id, actorUserId: ids.user, now: at }),
    { enqueued: 1 });
  const claim = repository.claim({ owner: 'runtime43-delete', now: at }); assert.ok(claim);
  assert.deepEqual(repository.execute(claim, at), { complete: true, applied: 2 });
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_stage_intelligence_facts WHERE operation='delete'").get() as any).count, 2);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM journey_stage_survey_feed_audit').all()).includes(survey.id), false);
  assert.ok(mapping.id);
});

test('expired pseudonymous feed state is physically purged while content-safe audit proof survives', () => {
  const result = repository.purgeExpired({ spaceId: ids.space, now: '2026-09-10T00:00:00.000Z', limit: 100 });
  assert.ok(result.purgedCount >= 2);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_survey_governance_receipts').get() as any).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_survey_source_revisions').get() as any).count, 0);
  const retentionAudit = db.prepare("SELECT detail_json FROM journey_stage_survey_feed_audit WHERE action='retention.purged'").get() as any;
  assert.ok(retentionAudit); assert.equal(retentionAudit.detail_json.includes('private-subject'), false);
});

test('bounded tenant cursor advances past a failing early space and reaches space 101', () => {
  const insert = db.prepare(`INSERT INTO journey_stage_survey_governance_receipts
    (id,space_id,policy_version_id,policy_id,response_id_hmac,subject_id_hmac,consent_state,purposes_json,notice_sha256,
     source_snapshot_sha256,retention_expires_at,created_at) VALUES (?,?,?,?,?,?,'granted','["analytics"]',?,?,?,?)`);
  for (let index = 0; index < 101; index += 1) {
    const suffix = String(index).padStart(3, '0'); insert.run(`cursor-receipt-${suffix}`, `cursor-space-${suffix}`,
      'policy-version', 'policy', crypto.createHash('sha256').update(`response-${suffix}`).digest('hex'),
      crypto.createHash('sha256').update(`subject-${suffix}`).digest('hex'), 'e'.repeat(64), 'f'.repeat(64),
      '2026-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
  }
  const visited: string[] = []; const purge = (spaceId: string) => {
    visited.push(spaceId); if (spaceId === 'cursor-space-000') throw new Error('injected private failure');
    return { purgedCount: 1, hasMore: false };
  };
  const first = purgeExpiredJourneyStageSurveyFeed('2026-08-08T00:00:00.000Z', 100, null, purge);
  assert.equal(first.spacesScanned, 100); assert.equal(first.failedSpaces, 1); assert.equal(first.nextCursor, 'cursor-space-099');
  assert.match(first.failureFingerprints[0] || '', /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(first).includes('injected private failure'), false);
  const second = purgeExpiredJourneyStageSurveyFeed('2026-08-08T00:00:00.000Z', 100, first.nextCursor, purge);
  assert.equal(second.spacesScanned, 1); assert.equal(visited.at(-1), 'cursor-space-100');
  db.prepare("DELETE FROM journey_stage_survey_governance_receipts WHERE space_id LIKE 'cursor-space-%'").run();
});

test('policy revisions use manager CAS and preserve immutable prior versions', () => {
  assert.throws(() => repository.createPolicy({ spaceId: ids.space, surveyId: survey.id, collectorId: collector.id,
    actorUserId: ids.user, notice: 'We use this score for a revised governed analytics purpose.',
    allowedPurposes: ['analytics'], retentionDays: 20,
    expectedRevision: 0, now: at }), /changed; reload/u);
  const revised = repository.createPolicy({ spaceId: ids.space, surveyId: survey.id, collectorId: collector.id,
    actorUserId: ids.user, notice: 'We use this score for a revised governed analytics purpose.',
    allowedPurposes: ['analytics'], retentionDays: 20,
    expectedRevision: 1, now: at });
  assert.equal(revised.versionNumber, 2);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_survey_policy_versions').get() as any).count, 2);
});
