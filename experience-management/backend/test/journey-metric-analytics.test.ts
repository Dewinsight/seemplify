import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-metric-analytics-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
const identityKeyFile = path.join(root, 'identity-key');
fs.writeFileSync(passwordFile, 'Metric-Analytics-Test-2026!');
fs.writeFileSync(sessionFile, 'metric-analytics-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'metric-analytics-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 81).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 82).toString('base64url'));
fs.writeFileSync(identityKeyFile, Buffer.alloc(32, 83));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5418', ADMIN_EMAIL: 'metric-analytics@seemplify.local',
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
const {
  journeyMetricPrivacyDecision, journeyMetricSafeResult, journeyMetricSafeLineage, journeyMetricSentimentLane
} = await import('../src/journeyMetricPrivacy.js');
const { buildJourneyMetricAnalyticsExport } = await import('../src/journeyMetricAnalyticsExport.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function admin() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'metric-analytics@seemplify.local',
    password: 'Metric-Analytics-Test-2026!' }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

/** `count` completed NPS responses so a definition with `minimumSampleSize`
 * below `count` publishes and one above it suppresses. */
function seedSurvey(spaceId: string, count: number, title = 'Analytics NPS') {
  const surveyId = crypto.randomUUID(); const collectorId = crypto.randomUUID(); const questionId = crypto.randomUUID();
  const occurredAt = '2026-08-04T10:00:00.000Z';
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
    VALUES (?,?,?,'','customer_experience','','active','nps',?,?)`).run(surveyId, spaceId, title, occurredAt, occurredAt);
  db.prepare(`INSERT INTO questions
    (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
    VALUES (?,?,1,0,'nps','Recommend?','',1,'[]','{}','[]')`).run(questionId, surveyId);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,'Web','web',?,'open','{}',?)`).run(collectorId, surveyId, `analytics-${collectorId}`, occurredAt);
  const insert = db.prepare(`INSERT INTO responses
    (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?,'completed',?,'{}',?,?,10)`);
  for (let index = 0; index < count; index += 1) {
    insert.run(crypto.randomUUID(), surveyId, collectorId, `person-${index}`,
      JSON.stringify({ [questionId]: index % 2 === 0 ? 10 : 9 }), occurredAt, occurredAt);
  }
  return { surveyId, collectorId, questionId, occurredAt };
}

const npsVersion = (bindingId: string, minimumSampleSize: number) => ({
  sourceKind: 'survey', bindingId, calculatorKind: 'nps', aggregation: 'net_promoter_score',
  direction: 'higher_is_better', windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize,
  freshnessMaxAgeSeconds: 86_400, population: { status: 'completed' }, filters: {},
  formula: { kind: 'net_promoter_score' }, configuration: {
    label: 'Analytics NPS', scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
    formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 }
  }
});

async function seedDefinition(owner: Awaited<ReturnType<typeof admin>>, input: {
  journeyId: string; targetType: string; targetId: string; name: string; responses: number;
  minimumSampleSize: number; suffix: string; asOf: string;
}) {
  const survey = seedSurvey(owner.spaceId, input.responses, `${input.name} survey`);
  const binding = await owner.agent.post('/api/journey-metrics/bindings').set('Idempotency-Key', `binding-${input.suffix}`)
    .send({ journeyDefinitionId: input.journeyId, targetType: input.targetType, targetId: input.targetId,
      surveyId: survey.surveyId, collectorId: survey.collectorId, questionId: survey.questionId }).expect(201);
  const definition = await owner.agent.post('/api/journey-metrics/definitions')
    .set('Idempotency-Key', `definition-${input.suffix}`)
    .send({ journeyDefinitionId: input.journeyId, targetType: input.targetType, targetId: input.targetId,
      name: input.name, version: npsVersion(String(binding.body.binding.id), input.minimumSampleSize),
      versionIdempotencyKey: `definition-${input.suffix}-v1` }).expect(201);
  const definitionId = String(definition.body.definition.id);
  await owner.agent.post('/api/journey-metrics/rebuilds').set('Idempotency-Key', `rebuild-${input.suffix}`)
    .send({ definitionId, reason: 'manual', asOf: input.asOf }).expect(202);
  assert.equal(await runOneJourneyMetricRebuild(`analytics-worker-${input.suffix}`), true);
  return definitionId;
}

test('privacy suppression is a pure fail-closed decision over the immutable definition version', () => {
  const version = { minimum_sample_size: 25, population_json: '{}', filters_json: '{}' };
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 40, minimum_sample_warning: 0 }, version).suppressed, false);
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 24, minimum_sample_warning: 0 }, version).reasonCode,
    'SMALL_SAMPLE_SUPPRESSED');
  // The warning flag alone suppresses even when the raw count clears the floor.
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 40, minimum_sample_warning: 1 }, version).suppressed, true);
  // An unresolvable definition version has no trustworthy threshold.
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 400, minimum_sample_warning: 0 }, null).reasonCode,
    'DEFINITION_VERSION_UNAVAILABLE');
  // The version-pinned privacy floor can only ever raise the minimum.
  const raised = { minimum_sample_size: 5, population_json: JSON.stringify({ privacyMinimumSampleSize: 50 }),
    filters_json: '{}' };
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 40, minimum_sample_warning: 0 }, raised).suppressed, true);
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 40, minimum_sample_warning: 0 }, raised).minimumSampleSize, 50);
  const lowered = { minimum_sample_size: 30, population_json: JSON.stringify({ privacyMinimumSampleSize: 1 }),
    filters_json: '{}' };
  assert.equal(journeyMetricPrivacyDecision({ sample_size: 10, minimum_sample_warning: 0 }, lowered).suppressed, true);
  // All three externally asserted flag spellings suppress.
  for (const flagged of [{ privacySuppressed: true }, { privacy_suppressed: true }, { privacy: { suppressed: true } }]) {
    assert.equal(journeyMetricPrivacyDecision({ sample_size: 900, minimum_sample_warning: 0,
      result_json: JSON.stringify(flagged) }, version).suppressed, true);
  }
});

test('the safe result projection strips per-record identity, prose counts and derivable denominators', () => {
  const raw = {
    metricId: 'metric-1', metricType: 'nps', metricDefinitionVersion: '1', calculationVersion: 1,
    period: { start: 'a', end: 'b', timezone: 'UTC' }, sourceRefs: ['survey:1'],
    freshness: { status: 'fresh', asOf: 'b', latestObservedAt: 'a', ageSeconds: 5, maximumAgeSeconds: 60 },
    exclusions: {
      invalid: { count: 2, records: [{ sampleId: 'response-secret-1', reason: 'X' }] },
      duplicate: { count: 1, records: [{ sampleId: 'response-secret-2' }] },
      outsidePeriod: { count: 1, sampleIds: ['response-secret-3'] }
    },
    minimumSampleWarning: { active: true, minimumSampleSize: 30, actualSampleSize: 4,
      message: 'Only 4 supporting subjects are available; at least 30 are configured.' },
    breakdown: { promoters: 3, passives: 1, detractors: 0 },
    configuration: { decimalPlaces: 1 },
    explanation: '3 of 4 respondents were promoters.'
  };
  const published = journeyMetricSafeResult(raw, journeyMetricPrivacyDecision({ sample_size: 40,
    minimum_sample_warning: 0 }, { minimum_sample_size: 1 }));
  const publishedText = JSON.stringify(published);
  // Response identifiers and the prose restatement never cross the boundary,
  // suppressed or not.
  for (const secret of ['response-secret-1', 'response-secret-2', 'response-secret-3']) {
    assert.equal(publishedText.includes(secret), false);
  }
  assert.equal(publishedText.includes('explanation'), false);
  assert.equal(publishedText.includes('promoters were'), false);
  assert.equal(published.minimumSampleWarning, undefined ? undefined : published.minimumSampleWarning);
  assert.equal((published.minimumSampleWarning as Record<string, unknown>).actualSampleSize, undefined);
  assert.equal((published.minimumSampleWarning as Record<string, unknown>).message, undefined);
  // Published rows keep audit-legitimate counts.
  assert.deepEqual(published.exclusions, { duplicate: { count: 1 }, invalid: { count: 2 }, outsidePeriod: { count: 1 } });
  assert.deepEqual(published.breakdown, { promoters: 3, passives: 1, detractors: 0 });

  const suppressed = journeyMetricSafeResult(raw, journeyMetricPrivacyDecision({ sample_size: 4,
    minimum_sample_warning: 1 }, { minimum_sample_size: 30 }));
  const suppressedText = JSON.stringify(suppressed);
  // Exclusion counts and the breakdown reconstruct a denominator, so they go too.
  assert.equal(suppressed.exclusions, undefined);
  assert.equal(suppressed.breakdown, undefined);
  assert.equal(suppressedText.includes('"4"'), false);
  assert.equal(suppressedText.includes('actualSampleSize'), false);
  // Audit-legitimate source, window, definition and freshness metadata survives.
  assert.equal(suppressed.metricId, 'metric-1');
  assert.deepEqual(suppressed.sourceRefs, ['survey:1']);
  assert.deepEqual(suppressed.period, { start: 'a', end: 'b', timezone: 'UTC' });
  assert.equal((suppressed.freshness as Record<string, unknown>).status, 'fresh');
  assert.equal((suppressed.privacy as Record<string, unknown>).suppressed, true);
});

test('lineage collapses to source types and the sentiment lane disappears under suppression', () => {
  const rows = [
    { sourceType: 'survey_response', sourceRecordId: 'r1', sourceRevisionSha256: 'a'.repeat(64),
      occurredAt: '2026-08-04T10:00:00.000Z', included: true, exclusionCode: null },
    { sourceType: 'survey_response', sourceRecordId: 'r2', sourceRevisionSha256: 'b'.repeat(64),
      occurredAt: '2026-08-04T10:00:00.000Z', included: true, exclusionCode: null },
    { sourceType: 'operational_import', sourceRecordId: 'r3', sourceRevisionSha256: 'c'.repeat(64),
      occurredAt: '2026-08-04T10:00:00.000Z', included: false, exclusionCode: 'SOURCE_DELETED' }
  ];
  const open = journeyMetricPrivacyDecision({ sample_size: 40, minimum_sample_warning: 0 }, { minimum_sample_size: 1 });
  const shut = journeyMetricPrivacyDecision({ sample_size: 2, minimum_sample_warning: 1 }, { minimum_sample_size: 30 });
  assert.equal(journeyMetricSafeLineage(rows, open).length, 3);
  const collapsed = journeyMetricSafeLineage(rows, shut);
  // Two distinct types, not three records: the row count can no longer be used
  // to recount the suppressed sample.
  assert.equal(collapsed.length, 2);
  assert.deepEqual(collapsed.map((row) => row.sourceType), ['operational_import', 'survey_response']);
  assert.equal(collapsed.every((row) => row.sourceRecordId === null && row.included === null), true);

  const sentimentResult = { kind: 'sentiment_trend', formula: 'current minus comparison',
    period: { start: 'a', end: 'b', timezone: 'UTC' }, comparisonPeriod: { start: 'x', end: 'a', timezone: 'UTC' },
    rows: [
      { key: 'negative', label: 'Negative', current: { value: 10, unit: 'percent', sampleSize: 40 },
        previous: { value: 12, unit: 'percent' }, change: { value: -2, unit: 'percentage_points' } },
      { key: 'positive', label: 'Positive', current: { value: 70, unit: 'percent', sampleSize: 40 },
        previous: { value: 60, unit: 'percent' }, change: { value: 10, unit: 'percentage_points' } }
    ] };
  const lane = journeyMetricSentimentLane(sentimentResult, open);
  assert.equal(lane?.kind, 'sentiment_trend');
  assert.equal(lane?.aggregateOnly, true);
  assert.equal(lane?.subjectType, 'social_post');
  // The lane exposes labelled aggregate shares, never a per-post record and
  // never a per-row sample that would reconstruct the denominator.
  assert.deepEqual(lane?.rows.map((row) => [row.key, row.currentValue, row.changeValue]),
    [['negative', 10, -2], ['positive', 70, 10]]);
  assert.equal(JSON.stringify(lane).includes('sampleSize'), false);
  assert.equal(journeyMetricSentimentLane(sentimentResult, shut), null);
});

test('the analytics export is deterministic, formula safe and free of suppressed values', () => {
  const base = {
    journeyDefinitionId: 'journey-1', journeyName: 'Activation',
    definitions: [{ id: 'd1', name: '=cmd|calc', targetType: 'journey', targetId: 'journey-1',
      targetName: 'Activation', calculatorKind: 'nps', sourceKind: 'survey', versionNumber: 1,
      windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize: 30, contentSha256: 'f'.repeat(64) }],
    observations: [
      { id: 'o1', definitionId: 'd1', definitionVersionId: 'v1', revision: 1, status: 'available',
        value: 42, unit: 'nps_score', numerator: 21, denominator: 50, sampleSize: 50, sourceCount: 50,
        period: { start: 'a', end: 'b', timezone: 'UTC' }, asOf: 'b', calculatedAt: 'b',
        freshnessStatus: 'fresh', latestObservedAt: 'a', minimumSampleWarning: false, result: { formula: 'nps' },
        sentiment: null, privacy: { suppressed: false, reasonCode: null, minimumSampleSize: 30, privacyVersion: 1 } },
      { id: 'o2', definitionId: 'd1', definitionVersionId: 'v1', revision: 2, status: 'available',
        value: null, unit: 'nps_score', numerator: null, denominator: null, sampleSize: null, sourceCount: null,
        period: { start: 'a', end: 'b', timezone: 'UTC' }, asOf: 'b', calculatedAt: 'b',
        freshnessStatus: 'fresh', latestObservedAt: 'a', minimumSampleWarning: true, result: { formula: 'nps' },
        sentiment: null, privacy: { suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED',
          minimumSampleSize: 30, privacyVersion: 1 } }
    ],
    appliedFilters: { selection: 'materialised_authorised_observations', personas: [], segments: [] },
    generatedAt: '2026-08-05T00:00:00.000Z'
  } as const;
  const csv = buildJourneyMetricAnalyticsExport({ ...base, format: 'csv' });
  const text = csv.bytes.toString('utf8');
  assert.equal(csv.suppressedObservationCount, 1);
  assert.equal(csv.mimeType.startsWith('text/csv'), true);
  assert.equal(csv.filename, 'journey-metric-analytics-journey-1.csv');
  // A leading formula character is neutralised even inside a quoted field.
  assert.equal(text.includes('"\'=cmd|calc"'), true);
  assert.equal(text.includes('"=cmd|calc"'), false);
  const dataRows = text.split('\r\n').filter((line) => line.startsWith('"d1"'));
  assert.equal(dataRows.length, 2);
  assert.equal(dataRows[0]!.includes('"42"'), true);
  // The suppressed row carries the reason and the definition identity, and no
  // value, numerator, denominator, sample or source count.
  assert.equal(dataRows[1]!.includes('"SMALL_SAMPLE_SUPPRESSED"'), true);
  assert.equal(dataRows[1]!.includes('"42"'), false);
  assert.equal(dataRows[1]!.includes('"50"'), false);
  assert.equal(dataRows[1]!.includes('"21"'), false);
  assert.equal(text.includes('not recomputed at export time'), true);
  // Deterministic: same inputs and generatedAt produce identical bytes.
  assert.equal(buildJourneyMetricAnalyticsExport({ ...base, format: 'csv' }).bytes.equals(csv.bytes), true);

  const json = buildJourneyMetricAnalyticsExport({ ...base, format: 'json' });
  const parsed = JSON.parse(json.bytes.toString('utf8'));
  assert.equal(parsed.metadata.suppressedObservationCount, 1);
  assert.equal(parsed.metadata.selection, 'materialised_authorised_observations');
  assert.equal(parsed.observations[1].value, null);
  assert.equal(parsed.observations[1].sampleSize, null);
  assert.equal(buildJourneyMetricAnalyticsExport({ ...base, format: 'json' }).bytes.equals(json.bytes), true);
});

test('observation filters are server authoritative and the export is governed end to end', async () => {
  const owner = await admin();
  const asOf = '2026-08-04T11:00:00.000Z';
  const map = createJourneyMap(owner.spaceId, owner.userId, { name: 'Analytics journey',
    purpose: 'Analytics slice', stageNames: ['Discover', 'Decide'] });
  const otherMap = createJourneyMap(owner.spaceId, owner.userId, { name: 'Other journey',
    purpose: 'Scope control', stageNames: ['Renew'] });

  const segment = await owner.agent.post('/api/journey-metrics/segments').set('Idempotency-Key', 'analytics-segment')
    .send({ journeyDefinitionId: map.id, name: 'Enterprise', rule: { conditions: [] } }).expect(201);
  const segmentId = String(segment.body.segment.id);

  const stageId = String((db.prepare(`SELECT stage.id FROM journey_map_stages stage
    JOIN journey_map_versions version ON version.id=stage.version_id AND version.space_id=stage.space_id
    WHERE stage.space_id=? AND version.definition_id=? ORDER BY stage.ordinal,stage.id LIMIT 1`)
    .get(owner.spaceId, map.id) as { id: string }).id);

  const journeyDefinitionId = await seedDefinition(owner, { journeyId: map.id, targetType: 'journey',
    targetId: map.id, name: 'Journey NPS', responses: 40, minimumSampleSize: 5, suffix: 'journey', asOf });
  const stageDefinitionId = await seedDefinition(owner, { journeyId: map.id, targetType: 'stage',
    targetId: stageId, name: 'Stage NPS', responses: 40, minimumSampleSize: 5, suffix: 'stage', asOf });
  const segmentDefinitionId = await seedDefinition(owner, { journeyId: map.id, targetType: 'segment',
    targetId: segmentId, name: 'Segment NPS', responses: 3, minimumSampleSize: 30, suffix: 'segment', asOf });
  await seedDefinition(owner, { journeyId: otherMap.id, targetType: 'journey', targetId: otherMap.id,
    name: 'Other NPS', responses: 40, minimumSampleSize: 5, suffix: 'other', asOf });

  // Journey scope excludes the other journey's observations entirely.
  const scoped = await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id }).expect(200);
  assert.equal(scoped.body.observations.length, 3);
  assert.equal(scoped.body.appliedFilters.selection, 'materialised_authorised_observations');
  assert.equal(scoped.body.appliedFilters.cohortsSupported, false);
  assert.equal(scoped.body.appliedFilters.truncated, false);

  // The server echoes the exact resolved facet identities and names.
  const bySegment = await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, segmentIds: segmentId }).expect(200);
  assert.equal(bySegment.body.observations.length, 1);
  assert.equal(bySegment.body.observations[0].definitionId, segmentDefinitionId);
  assert.deepEqual(bySegment.body.appliedFilters.segments, [{ id: segmentId, name: 'Enterprise' }]);
  // The segment metric has three responses against a minimum of thirty.
  assert.equal(bySegment.body.observations[0].privacy.suppressed, true);
  assert.equal(bySegment.body.observations[0].value, null);
  assert.equal(bySegment.body.observations[0].sampleSize, null);
  assert.equal(bySegment.body.observations[0].denominator, null);
  assert.equal(bySegment.body.observations[0].numerator, null);
  assert.equal(bySegment.body.observations[0].sourceCount, null);

  const byTargetType = await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, targetTypes: 'stage' }).expect(200);
  assert.equal(byTargetType.body.observations.length, 1);
  assert.equal(byTargetType.body.observations[0].definitionId, stageDefinitionId);
  assert.equal(byTargetType.body.observations[0].privacy.suppressed, false);
  assert.equal(typeof byTargetType.body.observations[0].value, 'number');

  // Ordinary reads for a sufficient sample are unchanged.
  const journeyRow = scoped.body.observations
    .find((row: { definitionId: string }) => row.definitionId === journeyDefinitionId);
  assert.equal(journeyRow.privacy.suppressed, false);
  assert.equal(typeof journeyRow.sampleSize, 'number');
  assert.equal(typeof journeyRow.denominator, 'number');

  // Unknown and foreign facet identities fail loudly rather than returning an
  // empty list that reads as "no data".
  await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, segmentIds: crypto.randomUUID() }).expect(404)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_FILTER_NOT_FOUND'));
  await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, personaIds: crypto.randomUUID() }).expect(404);
  // Cohorts have no governed catalogue, so they are refused rather than aliased.
  await owner.agent.get('/api/journey-metrics/observations')
    .query({ journeyDefinitionId: map.id, cohortIds: segmentId }).expect(422)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_COHORT_UNSUPPORTED'));

  const suppressedId = String(bySegment.body.observations[0].id);
  const exact = await owner.agent.get(`/api/journey-metrics/observations/${suppressedId}`).expect(200);
  assert.equal(exact.body.observation.value, null);
  assert.equal(exact.body.observation.sampleSize, null);
  assert.equal(JSON.stringify(exact.body).includes('explanation'), false);
  const lineage = await owner.agent.get(`/api/journey-metrics/observations/${suppressedId}/lineage`).expect(200);
  assert.equal(lineage.body.observation.lineage.length, 1);
  assert.equal(lineage.body.observation.lineage[0].sourceRecordId, null);

  // Members read and export; only mutations are owner/admin.
  db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, owner.userId);
  await owner.agent.get('/api/journey-metrics/observations').query({ journeyDefinitionId: map.id }).expect(200);
  const memberExport = await owner.agent.get('/api/journey-metrics/analytics-export.csv')
    .query({ journeyDefinitionId: map.id }).set('Idempotency-Key', 'analytics-export-member').expect(200);
  assert.equal(memberExport.headers['content-type'].startsWith('text/csv'), true);
  assert.equal(memberExport.headers['x-seemplify-usage-replayed'], 'false');
  assert.equal(memberExport.headers['content-disposition'].includes('attachment'), true);
  db.prepare("UPDATE space_memberships SET role='owner' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, owner.userId);

  const csvText = memberExport.text || memberExport.body.toString('utf8');
  // The suppressed segment metric appears with its reason and without numbers.
  assert.equal(csvText.includes('SMALL_SAMPLE_SUPPRESSED'), true);
  assert.equal(csvText.includes('Segment NPS'), true);
  assert.equal(csvText.includes('not recomputed at export time'), true);

  // Replaying the same key on the same scope is free and returns the same bytes.
  const replay = await owner.agent.get('/api/journey-metrics/analytics-export.csv')
    .query({ journeyDefinitionId: map.id }).set('Idempotency-Key', 'analytics-export-member').expect(200);
  assert.equal(replay.headers['x-seemplify-usage-replayed'], 'true');
  // Reusing the key after changing the filter scope is a conflict, not a stale
  // download charged to the original intent.
  await owner.agent.get('/api/journey-metrics/analytics-export.csv')
    .query({ journeyDefinitionId: map.id, targetTypes: 'stage' })
    .set('Idempotency-Key', 'analytics-export-member').expect(409)
    .expect((response) => assert.equal(response.body.code, 'SUBSCRIPTION_USAGE_IDEMPOTENCY_CONFLICT'));

  const jsonExport = await owner.agent.get('/api/journey-metrics/analytics-export.json')
    .query({ journeyDefinitionId: map.id, segmentIds: segmentId })
    .set('Idempotency-Key', 'analytics-export-json').expect(200);
  const payload = JSON.parse(jsonExport.text || jsonExport.body.toString('utf8'));
  assert.equal(payload.observations.length, 1);
  assert.equal(payload.observations[0].privacy.suppressed, true);
  assert.equal(payload.observations[0].value, null);
  assert.equal(payload.observations[0].sampleSize, null);
  assert.deepEqual(payload.metadata.appliedFilters.segments, [{ id: segmentId, name: 'Enterprise' }]);
  assert.equal(payload.metadata.suppressedObservationCount, 1);

  await owner.agent.get('/api/journey-metrics/analytics-export.pdf')
    .query({ journeyDefinitionId: map.id }).expect(400)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_EXPORT_FORMAT_UNSUPPORTED'));
  await request(app).get('/api/journey-metrics/analytics-export.csv')
    .query({ journeyDefinitionId: map.id }).expect(401);
});

test('another tenant cannot read or export this journey', async () => {
  const owner = await admin();
  const asOf = '2026-08-04T11:00:00.000Z';
  const map = createJourneyMap(owner.spaceId, owner.userId, { name: 'Tenant isolation',
    purpose: 'Isolation', stageNames: ['Only'] });
  await seedDefinition(owner, { journeyId: map.id, targetType: 'journey', targetId: map.id,
    name: 'Isolated NPS', responses: 40, minimumSampleSize: 5, suffix: 'isolated', asOf });

  const intruder = request.agent(app);
  await signupVerifyAndOnboard(intruder, { name: 'Intruder', email: 'intruder-analytics@example.test',
    password: 'Intruder-Analytics-2026!', spaceName: 'Intruder home' });
  const intruderSession = await intruder.get('/api/auth/session').expect(200);
  const intruderSpaceId = String(intruderSession.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(intruderSpaceId);

  // Reading in the intruder's own space: the other tenant's journey simply does
  // not exist, so the scope filter yields nothing rather than leaking rows.
  const crossRead = await intruder.get('/api/journey-metrics/observations')
    .set('x-seemplify-space', intruderSpaceId).query({ journeyDefinitionId: map.id }).expect(200);
  assert.equal(crossRead.body.observations.length, 0);
  await intruder.get('/api/journey-metrics/analytics-export.csv')
    .set('x-seemplify-space', intruderSpaceId).query({ journeyDefinitionId: map.id })
    .set('Idempotency-Key', 'cross-tenant-export').expect(404)
    .expect((response) => assert.equal(response.body.code, 'JOURNEY_METRIC_JOURNEY_NOT_FOUND'));

  // Naming the victim space directly is refused at the space boundary.
  await intruder.get('/api/journey-metrics/observations')
    .set('x-seemplify-space', owner.spaceId).query({ journeyDefinitionId: map.id }).expect(403)
    .expect((response) => assert.equal(response.body.code, 'SPACE_ACCESS_DENIED'));
  await intruder.get('/api/journey-metrics/analytics-export.csv')
    .set('x-seemplify-space', owner.spaceId).query({ journeyDefinitionId: map.id })
    .set('Idempotency-Key', 'cross-tenant-export-direct').expect(403);
});
