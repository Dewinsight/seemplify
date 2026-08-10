import crypto from 'node:crypto';
import { db } from './database.js';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { assertJourneyCapability } from './journeyCollaboration.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`
  :JSON.stringify(value);
const sha=(value:unknown)=>crypto.createHash('sha256').update(stable(value)).digest('hex');
const iso=(value:unknown)=>{const parsed=new Date(String(value));if(!Number.isFinite(parsed.getTime()))throw new Error('Invalid timestamp.');return parsed.toISOString();};
const bool=(runtime:DatabaseRuntime,value:boolean)=>runtime.provider==='postgres'?value:value?1:0;

export class JourneyBlueprintMeasurementError extends Error{
  constructor(message:string,public readonly status=400,public readonly code='JOURNEY_BLUEPRINT_MEASUREMENT_INVALID'){
    super(message);this.name='JourneyBlueprintMeasurementError';}
}
type Capability='journeys.read'|'journeys.edit';
type Access=(spaceId:string,userId:string,capability:Capability)=>void;
const productionAccess:Access=(spaceId,userId,capability)=>{assertSubscriptionFeature(spaceId,'journeyBlueprints');
  assertSubscriptionFeature(spaceId,'journeyMetrics');assertJourneyCapability(spaceId,userId,capability);};

export function initializeJourneyBlueprintMeasurementSqlite(runtime:DatabaseRuntime){if(runtime.provider!=='sqlite')return;
  runtime.exec(`CREATE TABLE IF NOT EXISTS journey_blueprint_measurement_plans(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,
    blueprint_id TEXT NOT NULL,blueprint_version_id TEXT NOT NULL,element_id TEXT NOT NULL,metric_definition_id TEXT NOT NULL,
    metric_definition_version_id TEXT NOT NULL,target_value REAL,target_direction TEXT NOT NULL,baseline_observation_id TEXT NOT NULL,
    baseline_value REAL NOT NULL,baseline_unit TEXT NOT NULL,baseline_sample_size INTEGER NOT NULL,baseline_period_start TEXT NOT NULL,
    baseline_period_end TEXT NOT NULL,baseline_as_of TEXT NOT NULL,baseline_result_sha256 TEXT NOT NULL,
    baseline_source_snapshot_sha256 TEXT NOT NULL,state TEXT NOT NULL,current_outcome_id TEXT,revision INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,intent_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(id,space_id),UNIQUE(space_id,idempotency_key));
  CREATE TABLE IF NOT EXISTS journey_blueprint_measurement_outcomes(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,space_id TEXT NOT NULL,
    after_observation_id TEXT NOT NULL,after_value REAL NOT NULL,after_sample_size INTEGER NOT NULL,after_period_start TEXT NOT NULL,
    after_period_end TEXT NOT NULL,after_as_of TEXT NOT NULL,after_result_sha256 TEXT NOT NULL,after_source_snapshot_sha256 TEXT NOT NULL,
    absolute_delta REAL NOT NULL,relative_delta REAL,target_distance REAL,target_met INTEGER,comparability_code TEXT NOT NULL,
    interpretation TEXT NOT NULL,causal_claim INTEGER NOT NULL,snapshot_json TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,
    plan_revision INTEGER NOT NULL,idempotency_key TEXT NOT NULL,intent_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,
    UNIQUE(id,space_id),UNIQUE(id,plan_id,space_id),UNIQUE(space_id,idempotency_key),UNIQUE(plan_id,after_observation_id));
  CREATE TABLE IF NOT EXISTS journey_blueprint_measurement_audit(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,space_id TEXT NOT NULL,
    action TEXT NOT NULL,plan_revision INTEGER NOT NULL,actor_user_id TEXT,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(plan_id,plan_revision,action));
  CREATE TRIGGER IF NOT EXISTS journey_blueprint_measurement_outcome_immutable BEFORE UPDATE ON journey_blueprint_measurement_outcomes
    BEGIN SELECT RAISE(ABORT,'blueprint measurement outcome is immutable');END;
  CREATE TRIGGER IF NOT EXISTS journey_blueprint_measurement_outcome_no_delete BEFORE DELETE ON journey_blueprint_measurement_outcomes
    BEGIN SELECT RAISE(ABORT,'blueprint measurement outcome is immutable');END;
  CREATE TRIGGER IF NOT EXISTS journey_blueprint_measurement_audit_immutable BEFORE UPDATE ON journey_blueprint_measurement_audit
    BEGIN SELECT RAISE(ABORT,'blueprint measurement audit is immutable');END;
  CREATE TRIGGER IF NOT EXISTS journey_blueprint_measurement_audit_no_delete BEFORE DELETE ON journey_blueprint_measurement_audit
    BEGIN SELECT RAISE(ABORT,'blueprint measurement audit is immutable');END;`);}

export class JourneyBlueprintMeasurementRepository{
  constructor(private readonly runtime:DatabaseRuntime=db,private readonly access:Access=productionAccess){
    initializeJourneyBlueprintMeasurementSqlite(runtime);}
  createPlan(input:{spaceId:string;actorUserId:string;blueprintVersionId:string;elementId:string;metricDefinitionId:string;
    metricDefinitionVersionId:string;baselineObservationId:string;idempotencyKey:string;at?:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.edit');const at=iso(input.at||new Date());
    const intent=sha({blueprintVersionId:input.blueprintVersionId,elementId:input.elementId,metricDefinitionId:input.metricDefinitionId,
      metricDefinitionVersionId:input.metricDefinitionVersionId,baselineObservationId:input.baselineObservationId});
    const replay=this.runtime.prepare('SELECT * FROM journey_blueprint_measurement_plans WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId,input.idempotencyKey) as any;if(replay){if(replay.intent_sha256!==intent)throw new JourneyBlueprintMeasurementError(
        'Idempotency key was used for a different measurement plan.',409,'JOURNEY_BLUEPRINT_MEASUREMENT_IDEMPOTENCY_CONFLICT');return replay;}
    const lineage=this.runtime.prepare(`SELECT version.blueprint_id,version.journey_definition_id,element.id element_id,
      definition.journey_definition_id metric_journey_definition_id,metric_version.target_value,metric_version.direction,
      observation.status,observation.value,observation.unit,observation.sample_size,observation.period_start,observation.period_end,
      observation.as_of,observation.result_sha256,observation.source_snapshot_sha256
      FROM journey_blueprint_versions version JOIN journey_blueprint_elements element
        ON element.version_id=version.id AND element.space_id=version.space_id AND element.id=?
      JOIN journey_metric_definitions definition ON definition.id=? AND definition.space_id=version.space_id
      JOIN journey_metric_definition_versions metric_version ON metric_version.id=? AND metric_version.definition_id=definition.id
        AND metric_version.space_id=definition.space_id
      JOIN journey_metric_observations observation ON observation.id=? AND observation.definition_id=definition.id
        AND observation.definition_version_id=metric_version.id AND observation.space_id=definition.space_id
      WHERE version.id=? AND version.space_id=?`).get(input.elementId,input.metricDefinitionId,input.metricDefinitionVersionId,
        input.baselineObservationId,input.blueprintVersionId,input.spaceId) as any;
    if(!lineage||lineage.journey_definition_id!==lineage.metric_journey_definition_id||lineage.status!=='available'||lineage.value===null)
      throw new JourneyBlueprintMeasurementError('The governed baseline lineage is unavailable or belongs to another journey.',
        409,'JOURNEY_BLUEPRINT_MEASUREMENT_LINEAGE_INVALID');
    const id=crypto.randomUUID();return this.runtime.transaction(()=>{this.runtime.prepare(`INSERT INTO journey_blueprint_measurement_plans
      (id,space_id,blueprint_id,blueprint_version_id,element_id,metric_definition_id,metric_definition_version_id,target_value,
       target_direction,baseline_observation_id,baseline_value,baseline_unit,baseline_sample_size,baseline_period_start,baseline_period_end,
       baseline_as_of,baseline_result_sha256,baseline_source_snapshot_sha256,state,current_outcome_id,revision,idempotency_key,intent_sha256,
       created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL,1,?,?,?,?,?)`).run(id,input.spaceId,
        lineage.blueprint_id,input.blueprintVersionId,input.elementId,input.metricDefinitionId,input.metricDefinitionVersionId,lineage.target_value,
        lineage.direction,input.baselineObservationId,lineage.value,lineage.unit,lineage.sample_size,iso(lineage.period_start),iso(lineage.period_end),
        iso(lineage.as_of),lineage.result_sha256,lineage.source_snapshot_sha256,input.idempotencyKey,intent,input.actorUserId,at,at);
      this.audit(id,input.spaceId,'plan.created',1,input.actorUserId,sha({intent}),at);return this.readPlanRow(input.spaceId,id);})();}
  recordOutcome(input:{spaceId:string;actorUserId:string;planId:string;afterObservationId:string;expectedRevision:number;
    idempotencyKey:string;at?:string}){this.access(input.spaceId,input.actorUserId,'journeys.edit');const at=iso(input.at||new Date());
    const intent=sha({planId:input.planId,afterObservationId:input.afterObservationId,expectedRevision:input.expectedRevision});
    const replay=this.runtime.prepare('SELECT * FROM journey_blueprint_measurement_outcomes WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId,input.idempotencyKey) as any;if(replay){if(replay.intent_sha256!==intent)throw new JourneyBlueprintMeasurementError(
        'Idempotency key was used for a different outcome.',409,'JOURNEY_BLUEPRINT_MEASUREMENT_IDEMPOTENCY_CONFLICT');return replay;}
    return this.runtime.transaction(()=>{const lock=this.runtime.provider==='postgres'?' FOR UPDATE':'';
      const plan=this.runtime.prepare(`SELECT * FROM journey_blueprint_measurement_plans WHERE id=? AND space_id=?${lock}`)
        .get(input.planId,input.spaceId) as any;if(!plan)throw new JourneyBlueprintMeasurementError('Measurement plan not found.',404,
          'JOURNEY_BLUEPRINT_MEASUREMENT_NOT_FOUND');if(plan.state!=='active'||Number(plan.revision)!==input.expectedRevision)
        throw new JourneyBlueprintMeasurementError('Measurement plan changed.',409,'JOURNEY_BLUEPRINT_MEASUREMENT_STALE');
      const observation=this.runtime.prepare(`SELECT * FROM journey_metric_observations WHERE id=? AND space_id=?
        AND definition_id=? AND definition_version_id=?`).get(input.afterObservationId,input.spaceId,plan.metric_definition_id,
          plan.metric_definition_version_id) as any;if(!observation||observation.status!=='available'||observation.value===null
          ||observation.unit!==plan.baseline_unit||Date.parse(String(observation.period_start))<Date.parse(String(plan.baseline_period_end)))
        throw new JourneyBlueprintMeasurementError('After observation is not comparable with the immutable baseline.',409,
          'JOURNEY_BLUEPRINT_MEASUREMENT_NOT_COMPARABLE');
      const after=Number(observation.value),baseline=Number(plan.baseline_value),target=plan.target_value===null?null:Number(plan.target_value);
      const absolute=after-baseline,relative=baseline===0?null:absolute/Math.abs(baseline),targetDistance=target===null?null:after-target;
      const targetMet=target===null||plan.target_direction==='neutral'?null:plan.target_direction==='higher_is_better'?after>=target:after<=target;
      const snapshot={schema:'seemplify.journey-blueprint-measurement-outcome/v1',interpretation:'descriptive_non_causal',causalClaim:false,
        blueprint:{id:plan.blueprint_id,versionId:plan.blueprint_version_id,elementId:plan.element_id},
        metric:{definitionId:plan.metric_definition_id,versionId:plan.metric_definition_version_id,targetValue:target,direction:plan.target_direction},
        baseline:{observationId:plan.baseline_observation_id,value:baseline,unit:plan.baseline_unit,sampleSize:Number(plan.baseline_sample_size),
          periodStart:iso(plan.baseline_period_start),periodEnd:iso(plan.baseline_period_end),resultSha256:plan.baseline_result_sha256},
        after:{observationId:observation.id,value:after,unit:observation.unit,sampleSize:Number(observation.sample_size),
          periodStart:iso(observation.period_start),periodEnd:iso(observation.period_end),resultSha256:observation.result_sha256},
        result:{absoluteDelta:absolute,relativeDelta:relative,targetDistance,targetMet}};const snapshotSha=sha(snapshot),id=crypto.randomUUID();
      this.runtime.prepare(`INSERT INTO journey_blueprint_measurement_outcomes(id,plan_id,space_id,after_observation_id,after_value,
        after_sample_size,after_period_start,after_period_end,after_as_of,after_result_sha256,after_source_snapshot_sha256,absolute_delta,
        relative_delta,target_distance,target_met,comparability_code,interpretation,causal_claim,snapshot_json,snapshot_sha256,plan_revision,
        idempotency_key,intent_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
        'same_metric_version_unit_nonoverlapping_periods','descriptive_non_causal',?,?,?,?,?,?,?,?)`).run(id,plan.id,input.spaceId,
          observation.id,after,observation.sample_size,iso(observation.period_start),iso(observation.period_end),iso(observation.as_of),
          observation.result_sha256,observation.source_snapshot_sha256,absolute,relative,targetDistance,
          targetMet===null?null:bool(this.runtime,targetMet),
          bool(this.runtime,false),JSON.stringify(snapshot),snapshotSha,input.expectedRevision+1,input.idempotencyKey,intent,input.actorUserId,at);
      const changed=this.runtime.prepare(`UPDATE journey_blueprint_measurement_plans SET current_outcome_id=?,revision=revision+1,updated_at=?
        WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(id,at,plan.id,input.spaceId,input.expectedRevision).changes;
      if(changed!==1)throw new JourneyBlueprintMeasurementError('Measurement plan changed.',409,'JOURNEY_BLUEPRINT_MEASUREMENT_STALE');
      this.audit(plan.id,input.spaceId,'outcome.recorded',input.expectedRevision+1,input.actorUserId,snapshotSha,at);
      return this.runtime.prepare('SELECT * FROM journey_blueprint_measurement_outcomes WHERE id=?').get(id);})();}
  closePlan(input:{spaceId:string;actorUserId:string;planId:string;expectedRevision:number;idempotencyKey:string;at?:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.edit');const at=iso(input.at||new Date()),detail=sha({idempotencyKey:input.idempotencyKey});
    return this.runtime.transaction(()=>{const row=this.readPlanRow(input.spaceId,input.planId);if(row.state==='closed')return row;
      const changed=this.runtime.prepare(`UPDATE journey_blueprint_measurement_plans SET state='closed',revision=revision+1,updated_at=?
        WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(at,input.planId,input.spaceId,input.expectedRevision).changes;
      if(changed!==1)throw new JourneyBlueprintMeasurementError('Measurement plan changed.',409,'JOURNEY_BLUEPRINT_MEASUREMENT_STALE');
      this.audit(input.planId,input.spaceId,'plan.closed',input.expectedRevision+1,input.actorUserId,detail,at);return this.readPlanRow(input.spaceId,input.planId);})();}
  list(input:{spaceId:string;actorUserId:string;blueprintVersionId?:string}){this.access(input.spaceId,input.actorUserId,'journeys.read');
    return input.blueprintVersionId?this.runtime.prepare(`SELECT * FROM journey_blueprint_measurement_plans WHERE space_id=?
      AND blueprint_version_id=? ORDER BY created_at,id`).all(input.spaceId,input.blueprintVersionId):this.runtime.prepare(
      'SELECT * FROM journey_blueprint_measurement_plans WHERE space_id=? ORDER BY created_at,id').all(input.spaceId);}
  read(input:{spaceId:string;actorUserId:string;planId:string}){this.access(input.spaceId,input.actorUserId,'journeys.read');
    const plan=this.readPlanRow(input.spaceId,input.planId);const outcomes=this.runtime.prepare(
      'SELECT * FROM journey_blueprint_measurement_outcomes WHERE plan_id=? AND space_id=? ORDER BY plan_revision,id').all(plan.id,input.spaceId);
    return {plan,outcomes};}
  private readPlanRow(spaceId:string,id:string){const row=this.runtime.prepare(
    'SELECT * FROM journey_blueprint_measurement_plans WHERE id=? AND space_id=?').get(id,spaceId) as any;
    if(!row)throw new JourneyBlueprintMeasurementError('Measurement plan not found.',404,'JOURNEY_BLUEPRINT_MEASUREMENT_NOT_FOUND');return row;}
  private audit(planId:string,spaceId:string,action:string,revision:number,userId:string,detailSha:string,at:string){this.runtime.prepare(
    `INSERT INTO journey_blueprint_measurement_audit(id,plan_id,space_id,action,plan_revision,actor_user_id,detail_sha256,created_at)
     VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),planId,spaceId,action,revision,userId,detailSha,at);}
}

export const journeyBlueprintMeasurementRepository=new JourneyBlueprintMeasurementRepository();
