import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-operational-feed-'));
for (const [name, value] of [['admin', 'Runtime52-Test-2026!'], ['session', 'runtime52-session-secret-long-enough'],
  ['terra', 'runtime52-terra-secret-long-enough'], ['identity', Buffer.alloc(32, 52)]] as const) {
  fs.writeFileSync(path.join(root, name), value);
}
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing'),
  PUBLIC_URL: 'http://127.0.0.1:5592', ADMIN_EMAIL: 'runtime52@seemplify.local', ADMIN_PASSWORD_FILE: path.join(root, 'admin'),
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
const { JourneyOperationalStageFeedRepository, JourneyOperationalStageFeedError } =
  await import('../src/journeyOperationalStageFeedRepository.js');
const { createRecoveryTicket } = await import('../src/recovery.js');
const { recordRecoveryTicketEvent } = await import('../src/recovery.js');
const { listJourneyProfileTimeline } = await import('../src/journeyIdentityRepository.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const at = '2026-08-08T10:00:00.000Z';
const ids = { user: crypto.randomUUID(), space: crypto.randomUUID(), foreignSpace: crypto.randomUUID(), journey: crypto.randomUUID(),
  mapVersion: crypto.randomUUID(), stage: crypto.randomUUID(), surveyBinding: crypto.randomUUID(), surveyDefinition: crypto.randomUUID(),
  surveyMetricVersion: crypto.randomUUID(), operationalDefinition: crypto.randomUUID(), operationalVersion: crypto.randomUUID(),
  profile: crypto.randomUUID() };

db.transaction(() => {
  db.prepare(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES (?,?,?,'hash','member',1,?,?)`).run(ids.user, 'runtime52-owner@example.test', 'Owner', at, at);
  for (const [id, name] of [[ids.space, 'Runtime 52'], [ids.foreignSpace, 'Foreign']] as const) {
    db.prepare(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES (?,?,?,?,NULL,?,?)`).run(id, name, `runtime52-${id}`, ids.user, at, at);
  }
  db.prepare(`INSERT INTO journey_definitions(id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
    current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES (?,?,?,'Recovery','customer','current_state','connected','draft',?,?,NULL,0,1,?,?)`)
    .run(ids.journey, ids.space, 'Recovery journey', ids.user, ids.mapVersion, at, at);
  db.prepare(`INSERT INTO journey_map_versions(id,definition_id,space_id,version_number,schema_version,state,map_type,mode,
    experience_type,objective,industry,summary,legacy_audience,provenance_json,author_user_id,created_at)
    VALUES (?,?,?,1,2,'draft','current_state','connected','customer','','','','','{}',?,?)`)
    .run(ids.mapVersion, ids.journey, ids.space, ids.user, at);
  db.prepare(`INSERT INTO journey_map_stages(id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES (?,?,?,'recover','Recover','','',0)`).run(ids.stage, ids.mapVersion, ids.space);
  db.prepare(`INSERT INTO journey_identity_profiles(id,space_id,kind,status,created_at,created_by_command_id)
    VALUES (?,?,'anonymous','active',?,'seed')`).run(ids.profile, ids.space, at);
  db.prepare(`INSERT INTO journey_identity_bindings(id,space_id,identifier_kind,identifier_namespace,identifier_value,
    profile_id,bound_at,bound_by_command_id) VALUES (?,?, 'anonymous_id','survey-recipient','governed-subject',?,?,'seed')`)
    .run(`binding-${ids.profile}`, ids.space, ids.profile, at);
})();

const survey = database.saveSurvey({ title: 'Recovery survey', status: 'live', primaryMetric: 'nps' }, [{ id: 'nps-question', type: 'nps',
  title: 'Recommend?', settings: { minimum: 0, maximum: 10 } }], ids.space);
const collector = database.createCollector(survey.id, { type: 'web', status: 'open', name: 'Web' });

db.transaction(() => {
  db.prepare(`INSERT INTO journey_metric_bindings(id,space_id,journey_definition_id,target_type,target_id,stage_id,
    survey_id,survey_space_id,collector_id,collector_survey_id,question_id,question_survey_id,source_ref,state,revision,
    idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'stage',?,?,?,?,?,?,'nps-question',?,'survey:nps','active',1,'survey-binding',?,?,?,?)`)
    .run(ids.surveyBinding, ids.space, ids.journey, ids.stage, ids.stage, survey.id, ids.space, collector.id, survey.id,
      survey.id, 'a'.repeat(64), ids.user, at, at);
  db.prepare(`INSERT INTO journey_metric_definitions(id,space_id,journey_definition_id,target_type,target_id,stage_id,name,state,
    current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'stage',?,?,'NPS','active',?,1,'survey-definition',?,?,?,?)`)
    .run(ids.surveyDefinition, ids.space, ids.journey, ids.stage, ids.stage, ids.surveyMetricVersion,
      'b'.repeat(64), ids.user, at, at);
  db.prepare(`INSERT INTO journey_metric_definition_versions(id,definition_id,space_id,version_number,source_kind,binding_id,
    calculator_kind,aggregation,direction,window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,
    population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
    VALUES (?,?,?,1,'survey',?,'nps','mean','higher_is_better',86400,'UTC',3,86400,'{}','{}','{}',?,?,'survey-version',?,?,?)`)
    .run(ids.surveyMetricVersion, ids.surveyDefinition, ids.space, ids.surveyBinding,
      JSON.stringify({ scale: { minimum: 0, maximum: 10 }, formula: { promoterMinimum: 9, detractorMaximum: 6 } }),
      'c'.repeat(64), 'd'.repeat(64), ids.user, at);
})();

const surveyFeed = new JourneyStageSurveyFeedRepository();
const policy = surveyFeed.createPolicy({ spaceId: ids.space, surveyId: survey.id, collectorId: collector.id,
  actorUserId: ids.user, notice: 'We use this response for governed recovery analytics only.',
  allowedPurposes: ['analytics'], retentionDays: 30, now: at });
surveyFeed.createMapping({ spaceId: ids.space, metricDefinitionId: ids.surveyDefinition, actorUserId: ids.user,
  allowedPurposes: ['analytics'], retentionDays: 20, idempotencyKey: 'survey-feed', now: at });
const response = database.createResponse({ surveyId: survey.id, collectorId: collector.id, respondentToken: 'governed-subject',
  answers: { 'nps-question': 9 } });
surveyFeed.recordResponse({ spaceId: ids.space, survey, collector, response, now: at,
  governance: { policyVersionId: policy.versionId, noticeAcknowledged: true, consentState: 'granted', purposes: ['analytics'] } });

const ticket = createRecoveryTicket(ids.space, ids.user, { surveyId: survey.id, responseId: response.id,
  title: 'PRIVATE escalation title', notes: 'PRIVATE customer message', priority: 'high' });
const event = db.prepare(`SELECT id FROM ticket_events WHERE ticket_id=? AND event_type='created'`).get(ticket.id) as { id: string };
const research = { source: crypto.randomUUID(), snapshot: crypto.randomUUID(), link: crypto.randomUUID() };
db.transaction(() => {
  db.prepare(`INSERT INTO journey_research_sources(id,space_id,source_type,source_ref,adapter,owner_user_id,state,revision,
    last_resolved_at,idempotency_key,intent_sha256,created_at,updated_at)
    VALUES (?,?,'ticket',?,'recovery',?,'active',1,?,'research-source',?, ?,?)`)
    .run(research.source, ids.space, `recovery-ticket:${ticket.id}`, ids.user, at, 'e'.repeat(64), at, at);
  db.prepare(`INSERT INTO journey_research_snapshots(id,source_id,space_id,version_number,fingerprint,access_state,source_label,
    excerpt,population,sample_size,collected_at,metadata_json,created_by_user_id,created_at,retention_expires_at)
    VALUES (?,?,?,1,?,'available','Recovery evidence','','',1,?,'{}',?,?,?)`)
    .run(research.snapshot, research.source, ids.space, 'f'.repeat(64), at, ids.user, at, '2027-08-08T00:00:00.000Z');
  db.prepare(`INSERT INTO journey_research_links(id,space_id,source_id,snapshot_id,target_type,target_id,state,revision,
    idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,'stage',?,'active',1,'research-link',?,?,?,?)`)
    .run(research.link, ids.space, research.source, research.snapshot, ids.stage, '1'.repeat(64), ids.user, at, at);
  const configuration = { measureId: ids.operationalDefinition, definitionVersion: '1', label: 'Recovery rate',
    kind: 'recovery_rate', subjectType: 'ticket', sourceLineages: [], minimumSampleSize: 3, freshnessMaxAgeSeconds: 86400,
    decimalPlaces: 1, eligibleEventType: 'ticket.opened', successEventType: 'ticket.recovered',
    nativeSource: { configVersion: 'journey-native-metric-source/v1', adapter: 'service_recovery_tickets', adapterVersion: '1',
      sourceIds: [survey.id], stageAssociation: { stageId: ids.stage, via: 'research_link' } } };
  db.prepare(`INSERT INTO journey_metric_definitions(id,space_id,journey_definition_id,target_type,target_id,stage_id,name,state,
    current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'stage',?,?,'Recovery rate','active',?,1,'operational-definition',?,?,?,?)`)
    .run(ids.operationalDefinition, ids.space, ids.journey, ids.stage, ids.stage, ids.operationalVersion,
      '2'.repeat(64), ids.user, at, at);
  db.prepare(`INSERT INTO journey_metric_definition_versions(id,definition_id,space_id,version_number,source_kind,binding_id,
    calculator_kind,aggregation,direction,window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,
    population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
    VALUES (?,?,?,1,'operational_import',NULL,'operational','rate','higher_is_better',86400,'UTC',3,86400,'{}','{}','{}',?,
      ?,'operational-version',?,?,?)`).run(ids.operationalVersion, ids.operationalDefinition, ids.space,
        JSON.stringify(configuration), '3'.repeat(64), '4'.repeat(64), ids.user, at);
})();

const repository = new JourneyOperationalStageFeedRepository();
const mapping = repository.createTicketMapping({ spaceId: ids.space, metricDefinitionId: ids.operationalDefinition,
  actorUserId: ids.user, allowedPurposes: ['analytics'], retentionDays: 15, idempotencyKey: 'ticket-feed',
  identity: { kind: 'anonymous_id', namespace: 'survey-recipient' }, now: at });

test('mapping is idempotent, tenant-derived and social fails closed', () => {
  assert.equal(mapping.replayed, false);
  assert.equal(repository.createTicketMapping({ spaceId: ids.space, metricDefinitionId: ids.operationalDefinition,
    actorUserId: ids.user, allowedPurposes: ['analytics'], retentionDays: 15, idempotencyKey: 'ticket-feed',
    identity: { kind: 'anonymous_id', namespace: 'survey-recipient' }, now: at }).replayed, true);
  assert.throws(() => repository.assertSocialUnsupported(), (error: unknown) =>
    error instanceof JourneyOperationalStageFeedError && error.code === 'JOURNEY_OPERATIONAL_FEED_SOCIAL_UNGOVERNED');
  assert.equal(repository.captureTicketEvent('missing-event', at).captured, 0);
});

test('authoritative ticket event projects to stage intelligence and Customer 360 without raw text', () => {
  assert.deepEqual(repository.captureTicketEvent(event.id, at), { captured: 1, excluded: null });
  assert.deepEqual(repository.captureTicketEvent(event.id, at), { captured: 0, excluded: null });
  const serialized = JSON.stringify(db.prepare('SELECT * FROM journey_operational_stage_source_revisions').all());
  assert.equal(serialized.includes('PRIVATE escalation title'), false);
  assert.equal(serialized.includes('PRIVATE customer message'), false);
  const claim = repository.claim({ owner: 'runtime52-worker', now: at }); assert.ok(claim);
  assert.throws(() => repository.complete({ ...claim, lease_token: 'stale-fence' }, at), /lease was lost/u);
  assert.equal(repository.complete(claim, at), true);
  const fact = db.prepare(`SELECT * FROM journey_stage_intelligence_facts WHERE source_type='service_recovery_ticket'`).get() as any;
  assert.equal(fact.metric_definition_id, ids.operationalDefinition); assert.equal(fact.stage_id, ids.stage);
  assert.equal(fact.sentiment, null); assert.equal(fact.emotions_json, '[]'); assert.equal(fact.value, 1);
  const timeline = repository.listProfileTimeline(ids.space, ids.profile);
  assert.equal(timeline.length, 1); assert.equal(timeline[0].eventKind, 'service_recovery_opened');
  assert.equal(JSON.stringify(timeline).includes(ticket.id), false);
  const customer360 = listJourneyProfileTimeline({ spaceId: ids.space, profileId: ids.profile, limit: 20, offset: 0 });
  assert.ok(customer360.some((item) => item.sourceType === 'service_recovery_ticket'));
});

test('source correction creates a consecutive revision and deletion creates matching tombstones', () => {
  const correctedAt = '2026-08-08T10:02:00.000Z';
  db.prepare(`UPDATE ticket_events SET event_type='closed',created_at=? WHERE id=?`).run(correctedAt, event.id);
  assert.equal(repository.captureTicketEvent(event.id, correctedAt).captured, 1);
  const correction = repository.claim({ owner: 'runtime52-correction', now: correctedAt }); assert.ok(correction);
  repository.complete(correction, correctedAt);
  assert.deepEqual(db.prepare(`SELECT revision,operation FROM journey_stage_intelligence_facts
    WHERE source_type='service_recovery_ticket' ORDER BY revision`).all(), [
    { revision: 1, operation: 'upsert' }, { revision: 2, operation: 'upsert' }
  ]);
  const deletedAt = '2026-08-08T10:03:00.000Z';
  assert.deepEqual(repository.tombstoneTicketEvent({ spaceId: ids.space, ticketEventId: event.id,
    reason: 'source_deleted', now: deletedAt }), { enqueued: 1 });
  const deletion = repository.claim({ owner: 'runtime52-delete', now: deletedAt }); assert.ok(deletion);
  repository.complete(deletion, deletedAt);
  const latest = db.prepare(`SELECT revision,operation,value FROM journey_stage_intelligence_facts
    WHERE source_type='service_recovery_ticket' ORDER BY revision DESC LIMIT 1`).get();
  assert.deepEqual(latest, { revision: 3, operation: 'delete', value: null });
  assert.equal(repository.listProfileTimeline(ids.space, ids.profile).length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_operational_stage_tombstones').get() as any).count, 1);
});

test('unlinked and consentless tickets remain excluded without cross-tenant fallback', () => {
  const unlinked = createRecoveryTicket(ids.space, ids.user, { surveyId: survey.id, responseId: null,
    title: 'Unlinked', notes: 'Must not project' });
  const unlinkedEvent = db.prepare('SELECT id FROM ticket_events WHERE ticket_id=?').get(unlinked.id) as { id: string };
  assert.deepEqual(repository.captureTicketEvent(unlinkedEvent.id, at),
    { captured: 0, excluded: 'ticket_without_governed_response' });
  assert.deepEqual(repository.tombstoneTicketEvent({ spaceId: ids.foreignSpace, ticketEventId: event.id,
    reason: 'privacy_erasure', now: at }), { enqueued: 0 });
});

test('execution rechecks the newest consent receipt and refuses a queued upsert after withdrawal', () => {
  const queuedAt = '2026-08-08T10:04:00.000Z';
  recordRecoveryTicketEvent(ticket.id, ids.user, 'created', { title: 'must never cross the projection boundary' }, queuedAt);
  const policyV2 = surveyFeed.createPolicy({ spaceId: ids.space, surveyId: survey.id, collectorId: collector.id,
    actorUserId: ids.user, notice: 'We use this response for governed recovery analytics only.',
    allowedPurposes: ['analytics'], retentionDays: 30, expectedRevision: 1, now: queuedAt });
  surveyFeed.recordResponse({ spaceId: ids.space, survey, collector, response, now: queuedAt,
    governance: { policyVersionId: policyV2.versionId, noticeAcknowledged: true, consentState: 'withdrawn', purposes: ['analytics'] } });
  const claim = repository.claim({ owner: 'runtime52-consent-check', now: queuedAt }); assert.ok(claim);
  repository.complete(claim, queuedAt);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM journey_stage_intelligence_facts
    WHERE source_type='service_recovery_ticket'`).get() as any).count, 3);
  const audit = db.prepare(`SELECT detail_json FROM journey_operational_stage_feed_audit
    WHERE action='outbox.completed' ORDER BY created_at DESC,id DESC LIMIT 1`).get() as any;
  assert.equal(JSON.parse(audit.detail_json).authorised, false);
});

test('retention physically purges complete operational chains while preserving content-safe audit proof', () => {
  const result = repository.purgeExpired({ spaceId: ids.space, now: '2027-09-01T00:00:00.000Z', limit: 100 });
  assert.equal(result.hasMore, false); assert.ok(result.purgedCount >= 2);
  for (const table of ['journey_operational_stage_source_revisions', 'journey_operational_stage_outbox',
    'journey_operational_stage_outbox_attempts', 'journey_operational_stage_tombstones',
    'journey_operational_timeline_revisions']) {
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE space_id=?`).get(ids.space) as any).count, 0, table);
  }
  const proof = db.prepare(`SELECT detail_json FROM journey_operational_stage_feed_audit
    WHERE space_id=? AND action='retention.purged'`).get(ids.space) as any;
  assert.ok(proof); assert.deepEqual(Object.keys(JSON.parse(proof.detail_json)), ['purgedCount']);
});
