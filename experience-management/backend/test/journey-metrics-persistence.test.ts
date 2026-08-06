import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-metrics-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
const identityKeyFile = path.join(root, 'identity-key');
fs.writeFileSync(passwordFile, 'Journey-Metrics-Test-2026!');
fs.writeFileSync(sessionFile, 'journey-metrics-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-metrics-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 72).toString('base64url'));
fs.writeFileSync(identityKeyFile, Buffer.alloc(32, 73));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'journey-metrics@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile, LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { createJourneyMap } = await import('../src/journeyMaps.js');
const { runOneJourneyMetricRebuild } = await import('../src/journeyMetricRebuild.js');
const { createJourneyMetricBinding, createJourneyMetricDefinition, queueJourneyMetricRebuild } = await import('../src/journeyMetrics.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function admin() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'journey-metrics@seemplify.local',
    password: 'Journey-Metrics-Test-2026!' }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

function seedSurvey(spaceId: string) {
  const surveyId = crypto.randomUUID(); const collectorId = crypto.randomUUID(); const questionId = crypto.randomUUID();
  const occurredAt = '2026-08-04T10:00:00.000Z';
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,'Journey NPS','','customer_experience','','active','nps',?,?)`).run(surveyId, spaceId, occurredAt, occurredAt);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'nps','Recommend?','',1,'[]','{}','[]')`).run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,'Web','web',?,'open','{}',?)`).run(collectorId, surveyId, `metric-${collectorId}`, occurredAt);
  const insert = db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?,'completed',?,'{}',?,?,10)`);
  const responses = [
    { id: crypto.randomUUID(), value: 10 }, { id: crypto.randomUUID(), value: 0 }, { id: crypto.randomUUID(), value: 8 }
  ];
  responses.forEach((row, index) => insert.run(row.id, surveyId, collectorId, `person-${index}`,
    JSON.stringify({ [questionId]: row.value }), occurredAt, occurredAt));
  return { surveyId, collectorId, questionId, responses, occurredAt };
}

const npsVersion = (bindingId: string) => ({
  sourceKind: 'survey', bindingId, calculatorKind: 'nps', aggregation: 'net_promoter_score',
  direction: 'higher_is_better', windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize: 3,
  freshnessMaxAgeSeconds: 86_400, population: { status: 'completed' }, filters: {},
  formula: { kind: 'net_promoter_score' }, configuration: {
    label: 'Stage NPS', scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
    formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 }
  }
});

const csatVersion = (bindingId: string) => ({
  sourceKind: 'survey', bindingId, calculatorKind: 'csat', aggregation: 'mean',
  direction: 'higher_is_better', windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize: 3,
  freshnessMaxAgeSeconds: 86_400, population: { status: 'completed' }, filters: {}, formula: { kind: 'mean' },
  configuration: { label: 'Stage CSAT', scale: { minimum: 1, maximum: 5, step: 1 }, decimalPlaces: 1,
    formula: { kind: 'mean' }, favourable: { operator: 'gte', threshold: 4 } }
});

test('journey metrics persist versioned bindings, corrections, deletion propagation and server imports', async () => {
  const owner = await admin(); const survey = seedSurvey(owner.spaceId);
  const map = createJourneyMap(owner.spaceId, owner.userId, { name: 'Activation', purpose: 'Metric test',
    stageNames: ['Start', 'Value'] });

  await request(app).get('/api/journey-metrics/definitions').expect(401);
  const bindingResponse = await owner.agent.post('/api/journey-metrics/bindings').set('Idempotency-Key', 'binding-nps')
    .send({ journeyDefinitionId: map.id, targetType: 'journey', targetId: map.id, surveyId: survey.surveyId,
      collectorId: survey.collectorId, questionId: survey.questionId }).expect(201);
  const bindingId = String(bindingResponse.body.binding.id);
  const bindingReplay = await owner.agent.post('/api/journey-metrics/bindings').set('Idempotency-Key', 'binding-nps')
    .send({ journeyDefinitionId: map.id, targetType: 'journey', targetId: map.id, surveyId: survey.surveyId,
      collectorId: survey.collectorId, questionId: survey.questionId }).expect(200);
  assert.equal(bindingReplay.body.replayed, true);

  const definitionResponse = await owner.agent.post('/api/journey-metrics/definitions').set('Idempotency-Key', 'definition-nps')
    .send({ journeyDefinitionId: map.id, targetType: 'journey', targetId: map.id, name: 'Activation NPS',
      version: npsVersion(bindingId), versionIdempotencyKey: 'definition-nps-v1' }).expect(201);
  const definitionId = String(definitionResponse.body.definition.id);
  await owner.agent.post('/api/journey-metrics/definitions').set('Idempotency-Key', 'definition-wrong-question-type')
    .send({ journeyDefinitionId: map.id, targetType: 'journey', targetId: map.id, name: 'Invalid CSAT',
      version: csatVersion(bindingId), versionIdempotencyKey: 'definition-wrong-question-type-v1' }).expect(409)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_QUESTION_TYPE_MISMATCH'));
  const asOf = '2026-08-04T11:00:00.000Z';
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', 'rebuild-nps-1')
    .send({ definitionId, reason: 'manual', asOf }).expect(202);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  let observations = await owner.agent.get('/api/journey-metrics/observations').query({ definitionId }).expect(200);
  assert.equal(observations.body.observations.length, 1);
  assert.equal(observations.body.observations[0].value, 0);
  assert.equal(observations.body.observations[0].denominator, 3);
  assert.equal(observations.body.observations[0].sampleSize, 3);
  assert.equal(observations.body.observations[0].minimumSampleWarning, false);
  const firstObservationId = String(observations.body.observations[0].id);

  db.prepare('UPDATE responses SET answers_json=? WHERE id=?').run(
    JSON.stringify({ [survey.questionId]: 10 }), survey.responses[1].id);
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', 'rebuild-nps-2')
    .send({ definitionId, reason: 'source_corrected', asOf }).expect(202);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  observations = await owner.agent.get('/api/journey-metrics/observations').query({ definitionId }).expect(200);
  assert.equal(observations.body.observations[0].revision, 2);
  assert.equal(observations.body.observations[0].value, 66.7);
  assert.equal(observations.body.observations[0].supersedesObservationId, firstObservationId);
  assert.throws(() => db.prepare('UPDATE journey_metric_observations SET value=99 WHERE id=?')
    .run(firstObservationId), /immutable/u);

  db.prepare('DELETE FROM responses WHERE id=?').run(survey.responses[2].id);
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', 'rebuild-nps-3')
    .send({ definitionId, reason: 'source_deleted', asOf }).expect(202);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  observations = await owner.agent.get('/api/journey-metrics/observations').query({ definitionId }).expect(200);
  assert.equal(observations.body.observations[0].revision, 3);
  // Dropping to two responses falls below the configured minimum, so the
  // observation is now privacy suppressed at the projection boundary: the
  // warning state survives, every number behind it does not.
  assert.equal(observations.body.observations[0].minimumSampleWarning, true);
  assert.equal(observations.body.observations[0].privacy.suppressed, true);
  assert.equal(observations.body.observations[0].privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
  assert.equal(observations.body.observations[0].sampleSize, null);
  assert.equal(observations.body.observations[0].value, null);
  assert.equal(observations.body.observations[0].numerator, null);
  assert.equal(observations.body.observations[0].denominator, null);
  assert.equal(observations.body.observations[0].sourceCount, null);
  const lineage = await owner.agent.get(`/api/journey-metrics/observations/${observations.body.observations[0].id}/lineage`)
    .expect(200);
  // Lineage cardinality is itself a denominator, so a suppressed observation
  // collapses to the distinct source types rather than one row per record.
  assert.equal(lineage.body.observation.lineage.length, 1);
  assert.equal(lineage.body.observation.lineage[0].sourceType, 'survey_response');
  assert.equal(lineage.body.observation.lineage[0].sourceRecordId, null);
  assert.equal(JSON.stringify(lineage.body).includes('respondent'), false);
  db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, owner.userId);
  await owner.agent.get(`/api/journey-metrics/observations/${observations.body.observations[0].id}/lineage`).expect(200);
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', 'member-rebuild-denied')
    .send({ definitionId, reason: 'manual', asOf }).expect(403);
  db.prepare("UPDATE space_memberships SET role='owner' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, owner.userId);

  const secondUserId = crypto.randomUUID(); const secondSpaceId = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO users(id,email,name,password_hash,created_at,updated_at)
    VALUES (?,?,?,'unused',?,?)`).run(secondUserId, 'other-metrics@seemplify.local', 'Other metrics', now, now);
  db.prepare('INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(secondSpaceId, 'Other space', `other-${secondSpaceId}`, secondUserId, now, now);
  db.prepare(`INSERT INTO platform_subscriptions
    (id,space_id,plan_code,status,features_json,limits_json,effective_at,version,created_at,updated_at)
    VALUES (?,?,'enterprise','active','{}','{}',?,1,?,?)`).run(crypto.randomUUID(), secondSpaceId, now, now, now);
  const crossSurvey = seedSurvey(secondSpaceId);
  const denied = await owner.agent.post('/api/journey-metrics/bindings').set('Idempotency-Key', 'binding-cross-space')
    .send({ journeyDefinitionId: map.id, targetType: 'journey', targetId: map.id,
      surveyId: crossSurvey.surveyId, questionId: crossSurvey.questionId }).expect(404);
  assert.equal(denied.body.code, 'JOURNEY_METRIC_SURVEY_NOT_FOUND');

  const source = await owner.agent.post('/api/journey-event-control-plane/sources').set('Idempotency-Key', 'metric-source')
    .send({ name: 'Metric import', environment: 'production', validationMode: 'enforce', allowedOrigins: [],
      allowedBundleIds: [], eventsPerMinute: 1000, bytesPerMinute: 1_000_000 }).expect(201);
  const sourceId = String(source.body.source.id);
  const credential = await owner.agent.post(`/api/journey-event-control-plane/sources/${sourceId}/credentials`)
    .set('Idempotency-Key', 'metric-server-key').send({ kind: 'server_secret' }).expect(201);
  const serverSecret = String(credential.body.secret);
  const publicCredential = await owner.agent.post(`/api/journey-event-control-plane/sources/${sourceId}/credentials`)
    .set('Idempotency-Key', 'metric-public-key').send({ kind: 'public_write' }).expect(201);
  const properties = [
    ['subject_id', 'string'], ['subject_type', 'string'], ['event_type', 'string'], ['occurred_at', 'string'],
    ['operation', 'string'], ['revision', 'number']
  ].map(([name, type]) => ({ name, type, required: true, dataClass: 'operational', description: String(name),
    ...(type === 'string' ? { maximumLength: 500 } : {}) }));
  const schema = await owner.agent.post(`/api/journey-event-control-plane/sources/${sourceId}/schemas`)
    .set('Idempotency-Key', 'metric-schema').send({ eventName: 'journey_metric_import' }).expect(201);
  const schemaVersion = await owner.agent.post(`/api/journey-event-control-plane/schemas/${schema.body.schema.id}/versions`)
    .set('Idempotency-Key', 'metric-schema-v1').send({ version: '1.0', properties }).expect(201);
  await owner.agent.post(`/api/journey-event-control-plane/schema-versions/${schemaVersion.body.version.id}/publish`)
    .send({}).expect(200);
  const sourceRef = `journey-event:${sourceId}:production`;
  const operationalVersion = {
    sourceKind: 'operational_import', calculatorKind: 'operational', aggregation: 'count', direction: 'neutral',
    windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize: 1, freshnessMaxAgeSeconds: 86_400,
    population: {}, filters: {}, formula: { kind: 'custom_count' }, configuration: {
      kind: 'custom_count', label: 'Checkout failures', subjectType: 'custom',
      sourceLineages: [{ sourceRef, sourceVersion: '1', schemaVersion: '1.0', projectionVersion: '1',
        journeyId: null, journeyVersion: null, ruleSetVersion: null }], decimalPlaces: 0,
      eventType: 'checkout.failed', aggregation: 'events'
    }
  };
  const operationalDefinition = await owner.agent.post('/api/journey-metrics/definitions')
    .set('Idempotency-Key', 'definition-operational').send({ journeyDefinitionId: map.id, targetType: 'journey',
      targetId: map.id, name: 'Checkout failures', versionIdempotencyKey: 'definition-operational-v1',
      version: operationalVersion }).expect(201);
  const operationalDefinitionId = String(operationalDefinition.body.definition.id);
  const importBody = { definitionId: operationalDefinitionId, schemaVersionId: schemaVersion.body.version.id,
    externalRecordId: 'failure-1', revision: 1, operation: 'upsert', subjectId: 'customer-secret-1',
    subjectType: 'custom', eventType: 'checkout.failed', occurredAt: '2026-08-04T10:30:00.000Z',
    sourceLineage: { sourceRef, sourceVersion: '1', schemaVersion: '1.0', projectionVersion: '1',
      journeyId: null, journeyVersion: null, ruleSetVersion: null }, properties: {} };
  await request(app).post('/v1/metric-imports').set('Content-Type', 'text/plain').send('{}').expect(415)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_CONTENT_TYPE_UNSUPPORTED'));
  await request(app).post('/v1/metric-imports').set('Content-Type', 'application/json').send('{"invalid"').expect(400)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_JSON_INVALID'));
  await request(app).post('/v1/metric-imports').set('Content-Type', 'application/json')
    .send(JSON.stringify({ padding: 'x'.repeat(300 * 1024) })).expect(413)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_BODY_TOO_LARGE'));
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${publicCredential.body.secret}`)
    .set('Idempotency-Key', 'metric-import-public').send(importBody).expect(403);
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-spoof-ref').send({ ...importBody,
      sourceLineage: { ...importBody.sourceLineage, sourceRef: 'journey-event:spoof:production' } }).expect(422)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_LINEAGE_MISMATCH'));
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-spoof-schema').send({ ...importBody,
      sourceLineage: { ...importBody.sourceLineage, schemaVersion: '99.0' } }).expect(422)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_LINEAGE_MISMATCH'));
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-survey-definition').send({ ...importBody, definitionId }).expect(409)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_IMPORT_NOT_SUPPORTED'));
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-gap').send({ ...importBody, revision: 2 }).expect(409)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_IMPORT_REVISION_CONFLICT'));
  const imported = await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-one').send(importBody).expect(202);
  assert.equal(imported.body.replayed, false);
  const importReplay = await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-one').send(importBody);
  assert.equal(importReplay.status, 200, JSON.stringify(importReplay.body));
  assert.equal(importReplay.body.replayed, true);
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-duplicate-revision').send(importBody).expect(409)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_IMPORT_REVISION_CONFLICT'));
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyJourneyMetricImports'`).get(owner.spaceId) as any).count), 1);
  const secondOperationalDefinition = await owner.agent.post('/api/journey-metrics/definitions')
    .set('Idempotency-Key', 'definition-operational-second').send({ journeyDefinitionId: map.id, targetType: 'journey',
      targetId: map.id, name: 'Checkout failures secondary', versionIdempotencyKey: 'definition-operational-second-v1',
      version: operationalVersion }).expect(201);
  const secondImport = await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-second-definition').send({ ...importBody,
      definitionId: secondOperationalDefinition.body.definition.id }).expect(202);
  assert.equal(secondImport.body.replayed, false);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_metric_imports
    WHERE external_record_sha256=(SELECT external_record_sha256 FROM journey_metric_imports WHERE id=?)`)
    .get(imported.body.importId) as any).count), 2);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyJourneyMetricImports'`).get(owner.spaceId) as any).count), 2);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);

  const otherSource = await owner.agent.post('/api/journey-event-control-plane/sources')
    .set('Idempotency-Key', 'metric-source-other').send({ name: 'Other metric import', environment: 'staging',
      validationMode: 'enforce', allowedOrigins: [], allowedBundleIds: [], eventsPerMinute: 1000,
      bytesPerMinute: 1_000_000 }).expect(201);
  const otherSourceId = String(otherSource.body.source.id);
  const otherCredential = await owner.agent.post(`/api/journey-event-control-plane/sources/${otherSourceId}/credentials`)
    .set('Idempotency-Key', 'metric-server-key-other').send({ kind: 'server_secret' }).expect(201);
  const otherSchema = await owner.agent.post(`/api/journey-event-control-plane/sources/${otherSourceId}/schemas`)
    .set('Idempotency-Key', 'metric-schema-other').send({ eventName: 'journey_metric_import' }).expect(201);
  const otherSchemaVersion = await owner.agent.post(`/api/journey-event-control-plane/schemas/${otherSchema.body.schema.id}/versions`)
    .set('Idempotency-Key', 'metric-schema-other-v1').send({ version: '1.0', properties }).expect(201);
  await owner.agent.post(`/api/journey-event-control-plane/schema-versions/${otherSchemaVersion.body.version.id}/publish`)
    .send({}).expect(200);
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-other-schema').send({ ...importBody,
      schemaVersionId: otherSchemaVersion.body.version.id }).expect(409)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_SCHEMA_NOT_PUBLISHED'));
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${otherCredential.body.secret}`)
    .set('Idempotency-Key', 'metric-import-other-source').send({ ...importBody,
      schemaVersionId: otherSchemaVersion.body.version.id }).expect(403)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_SOURCE_NOT_AUTHORISED'));

  await owner.agent.post(`/api/journey-event-control-plane/credentials/${otherCredential.body.credential.id}/revoke`)
    .send({}).expect(200);
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${otherCredential.body.secret}`)
    .set('Idempotency-Key', 'metric-import-revoked-key').send({ ...importBody, externalRecordId: 'revoked-key-record' })
    .expect(401).expect((response) => assert.equal(response.body.code, 'EVENT_CREDENTIAL_INVALID'));

  const rotated = await owner.agent.post(`/api/journey-event-control-plane/credentials/${credential.body.credential.id}/rotate`)
    .set('Idempotency-Key', 'metric-server-key-rotate').send({ overlapSeconds: 600 }).expect(201);
  db.prepare(`UPDATE journey_event_credentials SET expires_at='2026-08-04T00:00:00.000Z'
    WHERE id=?`).run(credential.body.credential.id);
  await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${serverSecret}`)
    .set('Idempotency-Key', 'metric-import-expired-overlap').send({ ...importBody, externalRecordId: 'expired-key-record' })
    .expect(401).expect((response) => assert.equal(response.body.code, 'EVENT_CREDENTIAL_INVALID'));
  const deleteImport = await request(app).post('/v1/metric-imports').set('Authorization', `Bearer ${rotated.body.secret}`)
    .set('Idempotency-Key', 'metric-import-delete').send({ ...importBody, revision: 2, operation: 'delete' }).expect(202);
  assert.equal(deleteImport.body.replayed, false);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  const operationalObservations = await owner.agent.get('/api/journey-metrics/observations')
    .query({ definitionId: operationalDefinitionId }).expect(200);
  assert.equal(operationalObservations.body.observations.length, 2);
  assert.equal(operationalObservations.body.observations[0].revision, 1);
  // The deleted-source observation drops to a zero sample, below this
  // definition's minimum of 1, so it is suppressed: identity, window and
  // freshness stay readable, the measured numbers do not. The prior revision
  // still meets the minimum and is published unchanged, which is the control
  // proving suppression is scoped and not a blanket redaction.
  assert.equal(operationalObservations.body.observations[0].privacy.suppressed, true);
  assert.equal(operationalObservations.body.observations[0].privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
  assert.equal(operationalObservations.body.observations[0].value, null);
  assert.equal(operationalObservations.body.observations[0].denominator, null);
  assert.equal(operationalObservations.body.observations[0].sampleSize, null);
  assert.equal(operationalObservations.body.observations[0].sentiment, null);
  assert.equal(operationalObservations.body.observations[1].privacy.suppressed, false);
  assert.equal(operationalObservations.body.observations[1].value, 1);
  assert.equal(operationalObservations.body.observations[1].sampleSize, 1);
  const deletedLineage = await owner.agent.get(`/api/journey-metrics/observations/${
    operationalObservations.body.observations[0].id}/lineage`).expect(200);
  assert.equal(deletedLineage.body.observation.lineage.length, 1);
  assert.equal(deletedLineage.body.observation.lineage[0].sourceType, 'operational_import');
  assert.equal(deletedLineage.body.observation.lineage[0].included, null);
  assert.equal(deletedLineage.body.observation.lineage[0].sourceRecordId, null);

  const otherMap = createJourneyMap(owner.spaceId, owner.userId, { name: 'Retention', purpose: 'Journey filter test',
    stageNames: ['Renew'] });
  const otherBinding = await owner.agent.post('/api/journey-metrics/bindings').set('Idempotency-Key', 'binding-other-journey')
    .send({ journeyDefinitionId: otherMap.id, targetType: 'journey', targetId: otherMap.id, surveyId: survey.surveyId,
      collectorId: survey.collectorId, questionId: survey.questionId }).expect(201);
  const otherDefinition = await owner.agent.post('/api/journey-metrics/definitions')
    .set('Idempotency-Key', 'definition-other-journey').send({ journeyDefinitionId: otherMap.id, targetType: 'journey',
      targetId: otherMap.id, name: 'Retention NPS', versionIdempotencyKey: 'definition-other-journey-v1',
      version: npsVersion(otherBinding.body.binding.id) }).expect(201);
  const otherDefinitionId = String(otherDefinition.body.definition.id);
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', 'rebuild-other-journey')
    .send({ definitionId: otherDefinitionId, reason: 'manual', asOf }).expect(202);
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  const journeyObservations = await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, limit: 100 }).expect(200);
  assert.equal(journeyObservations.body.observations.some((row: { definitionId: string }) => row.definitionId === otherDefinitionId), false);
  const mismatchedObservationScope = await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, definitionId: otherDefinitionId }).expect(200);
  assert.equal(mismatchedObservationScope.body.observations.length, 0);
  const journeyRebuilds = await owner.agent.get('/api/journey-metrics/rebuilds')
    .query({ journeyDefinitionId: map.id, limit: 100 }).expect(200);
  assert.equal(journeyRebuilds.body.rebuilds.some((row: { definitionId: string }) => row.definitionId === otherDefinitionId), false);
  const mismatchedRebuildScope = await owner.agent.get('/api/journey-metrics/rebuilds')
    .query({ journeyDefinitionId: map.id, definitionId: otherDefinitionId }).expect(200);
  assert.equal(mismatchedRebuildScope.body.rebuilds.length, 0);

  const tenantMap = createJourneyMap(secondSpaceId, secondUserId, { name: 'Foreign tenant journey', purpose: 'Isolation test',
    stageNames: ['Foreign stage'] });
  const tenantBinding = createJourneyMetricBinding({ spaceId: secondSpaceId, actorUserId: secondUserId,
    journeyDefinitionId: tenantMap.id, targetType: 'journey', targetId: tenantMap.id, surveyId: crossSurvey.surveyId,
    collectorId: crossSurvey.collectorId, questionId: crossSurvey.questionId, idempotencyKey: 'foreign-tenant-binding' });
  const tenantDefinition = createJourneyMetricDefinition({ spaceId: secondSpaceId, actorUserId: secondUserId,
    journeyDefinitionId: tenantMap.id, targetType: 'journey', targetId: tenantMap.id, name: 'Foreign tenant NPS',
    version: npsVersion(tenantBinding.binding.id), idempotencyKey: 'foreign-tenant-definition',
    versionIdempotencyKey: 'foreign-tenant-definition-v1' });
  queueJourneyMetricRebuild({ spaceId: secondSpaceId, actorUserId: secondUserId, definitionId: tenantDefinition.definition.id,
    reason: 'manual', asOf, idempotencyKey: 'foreign-tenant-rebuild' });
  assert.equal(await runOneJourneyMetricRebuild('test-metric-worker'), true);
  for (const path of ['observations', 'rebuilds']) {
    const byJourney = await owner.agent.get(`/api/journey-metrics/${path}`).query({ journeyDefinitionId: tenantMap.id }).expect(200);
    assert.equal(byJourney.body[path].length, 0);
    const byDefinition = await owner.agent.get(`/api/journey-metrics/${path}`).query({ definitionId: tenantDefinition.definition.id }).expect(200);
    assert.equal(byDefinition.body[path].length, 0);
    const byBoth = await owner.agent.get(`/api/journey-metrics/${path}`).query({ journeyDefinitionId: tenantMap.id,
      definitionId: tenantDefinition.definition.id }).expect(200);
    assert.equal(byBoth.body[path].length, 0);
  }
  await owner.agent.get('/api/journey-metrics/observations').query({ journeyDefinitionId: map.id, unexpected: 'no' }).expect(400);
  await owner.agent.get('/api/journey-metrics/rebuilds').query({ journeyDefinitionId: map.id, unexpected: 'no' }).expect(400);

  const audit = await owner.agent.get('/api/journey-metrics/audit').expect(200);
  assert.equal(JSON.stringify(audit.body).includes('customer-secret-1'), false);
  assert.equal(JSON.stringify(audit.body).includes(serverSecret), false);
});
