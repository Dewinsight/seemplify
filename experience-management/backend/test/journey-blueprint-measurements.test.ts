import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type {DatabaseRuntime} from '../src/databaseAdapter.js';
import {JourneyBlueprintMeasurementRepository} from '../src/journeyBlueprintMeasurements.js';

const at='2026-08-08T10:00:00.000Z';
function setup(){const sqlite=new Database(':memory:');Object.defineProperty(sqlite,'provider',{value:'sqlite'});sqlite.exec(`
  CREATE TABLE journey_blueprint_versions(id TEXT,blueprint_id TEXT,space_id TEXT,journey_definition_id TEXT);
  CREATE TABLE journey_blueprint_elements(id TEXT,version_id TEXT,space_id TEXT,metric_refs_json TEXT);
  CREATE TABLE journey_metric_definitions(id TEXT,space_id TEXT,journey_definition_id TEXT);
  CREATE TABLE journey_metric_definition_versions(id TEXT,definition_id TEXT,space_id TEXT,target_value REAL,direction TEXT);
  CREATE TABLE journey_metric_observations(id TEXT,space_id TEXT,definition_id TEXT,definition_version_id TEXT,status TEXT,value REAL,
    unit TEXT,sample_size INTEGER,period_start TEXT,period_end TEXT,as_of TEXT,result_sha256 TEXT,source_snapshot_sha256 TEXT);
  INSERT INTO journey_blueprint_versions VALUES ('bpv','bp','space-a','journey-a');
  INSERT INTO journey_blueprint_elements VALUES ('element','bpv','space-a','["caller-free-form-ref"]');
  INSERT INTO journey_metric_definitions VALUES ('metric','space-a','journey-a'),('other-metric','space-a','journey-a');
  INSERT INTO journey_metric_definition_versions VALUES ('metric-v','metric','space-a',80,'higher_is_better'),
    ('other-v','other-metric','space-a',20,'lower_is_better');
  INSERT INTO journey_metric_observations VALUES
    ('baseline','space-a','metric','metric-v','available',60,'score',100,'2026-06-01T00:00:00.000Z','2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z','${'a'.repeat(64)}','${'b'.repeat(64)}'),
    ('after','space-a','metric','metric-v','available',75,'score',120,'2026-07-01T00:00:00.000Z','2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z','${'c'.repeat(64)}','${'d'.repeat(64)}'),
    ('wrong-version','space-a','other-metric','other-v','available',10,'score',20,'2026-07-01T00:00:00.000Z','2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z','${'e'.repeat(64)}','${'f'.repeat(64)}');`);
  const access:Array<string>=[];const repo=new JourneyBlueprintMeasurementRepository(sqlite as unknown as DatabaseRuntime,
    (_space,_user,capability)=>access.push(capability));return {sqlite,repo,access};}

test('plan pins exact governed blueprint, element, metric version, target and immutable baseline instead of metricRefs',()=>{
  const {sqlite,repo,access}=setup();const plan=repo.createPlan({spaceId:'space-a',actorUserId:'user-a',blueprintVersionId:'bpv',
    elementId:'element',metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',baselineObservationId:'baseline',
    idempotencyKey:'plan-key',at}) as any;assert.equal(plan.target_value,80);assert.equal(plan.baseline_value,60);
  assert.equal(plan.metric_definition_version_id,'metric-v');assert.deepEqual(access,['journeys.edit']);
  const replay=repo.createPlan({spaceId:'space-a',actorUserId:'user-a',blueprintVersionId:'bpv',elementId:'element',
    metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',baselineObservationId:'baseline',idempotencyKey:'plan-key',at}) as any;
  assert.equal(replay.id,plan.id);assert.throws(()=>repo.createPlan({spaceId:'space-a',actorUserId:'user-a',blueprintVersionId:'bpv',
    elementId:'element',metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',baselineObservationId:'after',
    idempotencyKey:'plan-key',at}),/different measurement plan/);
  assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_blueprint_measurement_audit').get() as any).count,1);
});

test('comparable after observation creates immutable descriptive non-causal outcome with CAS and replay',()=>{
  const {sqlite,repo}=setup();const plan=repo.createPlan({spaceId:'space-a',actorUserId:'user-a',blueprintVersionId:'bpv',elementId:'element',
    metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',baselineObservationId:'baseline',idempotencyKey:'plan-key',at}) as any;
  const outcome=repo.recordOutcome({spaceId:'space-a',actorUserId:'user-a',planId:plan.id,afterObservationId:'after',expectedRevision:1,
    idempotencyKey:'outcome-key',at:'2026-08-08T11:00:00.000Z'}) as any;assert.equal(outcome.absolute_delta,15);
  assert.equal(outcome.relative_delta,.25);assert.equal(outcome.interpretation,'descriptive_non_causal');assert.equal(outcome.causal_claim,0);
  assert.equal(outcome.target_met,0);const snapshot=JSON.parse(outcome.snapshot_json);assert.equal(snapshot.causalClaim,false);
  assert.equal(snapshot.metric.versionId,'metric-v');assert.equal((repo.recordOutcome({spaceId:'space-a',actorUserId:'user-a',planId:plan.id,
    afterObservationId:'after',expectedRevision:1,idempotencyKey:'outcome-key',at}) as any).id,outcome.id);
  assert.throws(()=>sqlite.prepare('UPDATE journey_blueprint_measurement_outcomes SET absolute_delta=999').run(),/immutable/);
  assert.throws(()=>repo.recordOutcome({spaceId:'space-a',actorUserId:'user-a',planId:plan.id,afterObservationId:'wrong-version',
    expectedRevision:2,idempotencyKey:'wrong',at}),/not comparable/);
});

test('plan close is optimistic and read paths demand read capability',()=>{const {repo,access}=setup();const plan=repo.createPlan({spaceId:'space-a',
  actorUserId:'user-a',blueprintVersionId:'bpv',elementId:'element',metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',
  baselineObservationId:'baseline',idempotencyKey:'plan-key',at}) as any;assert.throws(()=>repo.closePlan({spaceId:'space-a',actorUserId:'user-a',
  planId:plan.id,expectedRevision:2,idempotencyKey:'close',at}),/changed/);const closed=repo.closePlan({spaceId:'space-a',actorUserId:'user-a',
  planId:plan.id,expectedRevision:1,idempotencyKey:'close',at}) as any;assert.equal(closed.state,'closed');repo.read({spaceId:'space-a',
    actorUserId:'user-a',planId:plan.id});assert.equal(access.at(-1),'journeys.read');});
