#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'pg';
import { createDatabase } from '../backend/src/databaseAdapter.js';
import { JourneyBlueprintMeasurementError, JourneyBlueprintMeasurementRepository } from
  '../backend/src/journeyBlueprintMeasurements.js';

const required=(name:string)=>{const value=String(process.env[name]||'');assert.ok(value,`${name} is required`);return value;};
const database=required('POSTGRES_DATABASE'),host=String(process.env.POSTGRES_HOST||'127.0.0.1');
const port=Number(process.env.POSTGRES_PORT||5432),ownerUser=required('POSTGRES_PROBE_OWNER_USER');
const ownerPasswordFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE'),appUser=required('POSTGRES_USER');
const appPasswordFile=required('POSTGRES_PASSWORD_FILE'),sourceSha256=required('POSTGRES_SOURCE_SHA256');
const runtimeSchemaVersion=Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION'));
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES,'true');
assert.match(database,/^experience_e2e_[a-f0-9]{12}$/u,'Runtime48 probe refuses non-disposable databases.');
for(const file of [ownerPasswordFile,appPasswordFile])assert.ok(fs.existsSync(file));
const password=(file:string)=>fs.readFileSync(file,'utf8').replace(/[\r\n]+$/u,'');
const proof=`pg48_${crypto.randomBytes(6).toString('hex')}`,at='2026-08-08T08:00:00.000Z';
const digest=(label:string)=>crypto.createHash('sha256').update(`${proof}:${label}`).digest('hex');
const id=(label:string)=>`${proof}_${label}`;
const owner=new Client({host,port,database,user:ownerUser,password:password(ownerPasswordFile),ssl:false,
  application_name:'runtime48-blueprint-measurement-owner'});
const settings={databaseProvider:'postgres' as const,databasePath:'',postgres:{host,port,database,user:appUser,
  passwordFile:appPasswordFile,ssl:false as const,schemaVersion:1,runtimeSchemaVersion,sourceSha256}};
const left=createDatabase(settings),right=createDatabase(settings);
const allow=()=>{};
const leftRepository=new JourneyBlueprintMeasurementRepository(left,allow);
const rightRepository=new JourneyBlueprintMeasurementRepository(right,allow);
const user=id('user'),spaceA=id('space_a'),spaceB=id('space_b'),journey=id('journey'),mapVersion=id('map_v1');
const blueprint=id('blueprint'),blueprintVersion=id('blueprint_v1'),element=id('element');
const metric=id('metric'),metricVersion=id('metric_v1'),baselineRun=id('baseline_run'),afterRun=id('after_run');
const baseline=id('baseline'),after=id('after');

try{
  await owner.connect();
  assert.equal((await owner.query('SELECT version FROM experience_runtime_schema_version WHERE version=48')).rowCount,1);
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime48 owner','not-a-login','member',1,$3,$3)`,[user,`${proof}@example.invalid`,at]);
  for(const [space,slug] of [[spaceA,`${proof}-a`],[spaceB,`${proof}-b`]]){
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES($1,'Runtime48 measurement',$2,$3,NULL,$4,$4)`,[space,slug,user,at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES($1,$2,'owner',$3,$3)`,[space,user,at]);
  }
  await owner.query(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,created_at,updated_at)
    VALUES($1,$2,'Runtime48 journey','Executed measurement proof','customer','service_blueprint','designed','draft',$3,$4,$4)`,
    [journey,spaceA,user,at]);
  await owner.query(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,summary,
     legacy_audience,provenance_json,author_user_id,created_at)
    VALUES($1,$2,$3,1,2,'draft','service_blueprint','designed','customer','','','','','{}',$4,$5)`,
    [mapVersion,journey,spaceA,user,at]);
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES($1,$2,$3,'Runtime48 blueprint','draft',$4,NULL,1,$4,$4,$5,$5)`,[blueprint,spaceA,journey,user,at]);
  await owner.query(`INSERT INTO journey_blueprint_versions
    (id,blueprint_id,space_id,journey_definition_id,journey_version_id,version_number,blueprint_state,review_state,
     schema_version,snapshot_sha256,actor_user_id,created_at)
    VALUES($1,$2,$3,$4,$5,1,'current','draft','journey-service-blueprint/v1',$6,$7,$8)`,
    [blueprintVersion,blueprint,spaceA,journey,mapVersion,digest('blueprint'),user,at]);
  await owner.query(`INSERT INTO journey_blueprint_stages(version_id,space_id,stage_key,name,ordinal)
    VALUES($1,$2,'discover','Discover',0)`,[blueprintVersion,spaceA]);
  await owner.query(`INSERT INTO journey_blueprint_elements
    (id,version_id,space_id,stage_key,lane,kind,title,description,ordinal,evidence_refs_json,metric_refs_json)
    VALUES($1,$2,$3,'discover','customer','touchpoint','Governed element','',0,'[]','["caller-controlled-decoy"]')`,
    [element,blueprintVersion,spaceA]);
  await owner.query(`INSERT INTO journey_metric_definitions
    (id,space_id,journey_definition_id,target_type,target_id,name,current_version_id,revision,intent_sha256,
     created_by_user_id,created_at,updated_at)
    VALUES($1,$2,$3,'journey',$3,'Runtime48 metric',NULL,1,$4,$5,$6,$6)`,[metric,spaceA,journey,digest('metric'),user,at]);
  await owner.query(`INSERT INTO journey_metric_definition_versions
    (id,definition_id,space_id,version_number,source_kind,calculator_kind,aggregation,direction,window_seconds,timezone,
     minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,population_json,filters_json,formula_json,
     configuration_json,content_sha256,intent_sha256,created_by_user_id,created_at)
    VALUES($1,$2,$3,1,'operational_import','operational','average','higher_is_better',86400,'UTC',1,86400,50,80,
      '{}','{}','{"kind":"average"}','{}',$4,$4,$5,$6)`,[metricVersion,metric,spaceA,digest('metric-version'),user,at]);
  for(const [run,observation,value,start,end,label] of [
    [baselineRun,baseline,50,'2026-07-01T00:00:00.000Z','2026-07-08T00:00:00.000Z','baseline'],
    [afterRun,after,85,'2026-07-08T00:00:00.000Z','2026-07-15T00:00:00.000Z','after']] as const){
    await owner.query(`INSERT INTO journey_metric_rebuild_runs
      (id,space_id,definition_id,definition_version_id,reason,as_of,state,available_at,attempt_count,max_attempts,
       idempotency_key,intent_sha256,requested_by_user_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,'manual',$5,'pending',$5,0,3,$6,$7,$8,$5,$5)`,
      [run,spaceA,metric,metricVersion,end,`${proof}:${label}:run`,digest(`${label}-run`),user]);
    await owner.query(`INSERT INTO journey_metric_observations
      (id,space_id,definition_id,definition_version_id,revision,status,value,unit,numerator,denominator,sample_size,
       period_start,period_end,timezone,as_of,calculated_at,freshness_status,latest_observed_at,minimum_sample_warning,
       source_count,source_snapshot_sha256,result_sha256,result_json,rebuild_run_id,created_at)
      VALUES($1,$2,$3,$4,1,'available',$5::double precision,'points',$5::double precision,100,100,$6,$7,'UTC',$7,$7,
        'fresh',$7,0,1,$8,$9,jsonb_build_object('value',$5::double precision),$10,$7)`,
      [observation,spaceA,metric,metricVersion,value,start,end,digest(`${label}-source`),digest(`${label}-result`),run]);
  }
  await owner.query('COMMIT');

  const plan=leftRepository.createPlan({spaceId:spaceA,actorUserId:user,blueprintVersionId:blueprintVersion,elementId:element,
    metricDefinitionId:metric,metricDefinitionVersionId:metricVersion,baselineObservationId:baseline,
    idempotencyKey:`${proof}:plan`,at});
  assert.equal(plan.target_value,80);assert.equal(plan.baseline_value,50);
  assert.equal(leftRepository.createPlan({spaceId:spaceA,actorUserId:user,blueprintVersionId:blueprintVersion,elementId:element,
    metricDefinitionId:metric,metricDefinitionVersionId:metricVersion,baselineObservationId:baseline,
    idempotencyKey:`${proof}:plan`,at}).id,plan.id);
  assert.throws(()=>rightRepository.createPlan({spaceId:spaceB,actorUserId:user,blueprintVersionId:blueprintVersion,elementId:element,
    metricDefinitionId:metric,metricDefinitionVersionId:metricVersion,baselineObservationId:baseline,
    idempotencyKey:`${proof}:cross-space`,at}),(error:any)=>error instanceof JourneyBlueprintMeasurementError&&error.code==='JOURNEY_BLUEPRINT_MEASUREMENT_LINEAGE_INVALID');
  const outcome=leftRepository.recordOutcome({spaceId:spaceA,actorUserId:user,planId:plan.id,afterObservationId:after,
    expectedRevision:1,idempotencyKey:`${proof}:outcome`,at});
  assert.equal(outcome.interpretation,'descriptive_non_causal');assert.equal(outcome.causal_claim,false);
  assert.equal(outcome.absolute_delta,35);assert.equal(outcome.target_met,true);
  assert.throws(()=>rightRepository.recordOutcome({spaceId:spaceA,actorUserId:user,planId:plan.id,afterObservationId:after,
    expectedRevision:1,idempotencyKey:`${proof}:stale`,at}),(error:any)=>error instanceof JourneyBlueprintMeasurementError&&error.code==='JOURNEY_BLUEPRINT_MEASUREMENT_STALE');
  await assert.rejects(owner.query('UPDATE journey_blueprint_measurement_outcomes SET absolute_delta=999 WHERE id=$1',[outcome.id]),
    (error:any)=>error?.code==='55000');
  const evidence=await owner.query(`SELECT (snapshot_json->>'causalClaim')::boolean causal_claim,snapshot_sha256,
    (SELECT count(*)::int FROM journey_blueprint_measurement_audit WHERE plan_id=$1) audit_count
    FROM journey_blueprint_measurement_outcomes WHERE id=$2`,[plan.id,outcome.id]);
  assert.equal(evidence.rows[0].causal_claim,false);assert.equal(evidence.rows[0].audit_count,2);
  assert.match(String(evidence.rows[0].snapshot_sha256),/^[a-f0-9]{64}$/u);
  process.stdout.write(`${JSON.stringify({event:'journey_blueprint_measurement_runtime48_postgres_probe_passed',
    governedLineage:true,idempotentReplay:true,crossTenantDenied:true,twoAdapterStaleFence:true,
    immutableEvidence:true,descriptiveNonCausal:true})}\n`);
}finally{
  left.close();right.close();await owner.query('ROLLBACK').catch(()=>undefined);await owner.end().catch(()=>undefined);
}
