import { z } from 'zod';
import { api, json } from '@/lib/api';

const id=z.string().min(1).max(128),instant=z.string().datetime({offset:true}),sha=z.string().regex(/^[a-f0-9]{64}$/u);
const numeric=z.union([z.number(),z.string().transform((value)=>Number(value))]);
const nullableNumeric=z.union([numeric,z.null()]);
const booleanValue=z.union([z.boolean(),z.number().int().min(0).max(1).transform(Boolean)]);
const planSchema=z.object({id,space_id:id,blueprint_id:id,blueprint_version_id:id,element_id:id,metric_definition_id:id,
  metric_definition_version_id:id,target_value:nullableNumeric,target_direction:z.enum(['higher_is_better','lower_is_better','neutral']),
  baseline_observation_id:id,baseline_value:numeric,baseline_unit:z.string(),baseline_sample_size:z.number().int().nonnegative(),
  baseline_period_start:instant,baseline_period_end:instant,baseline_as_of:instant,baseline_result_sha256:sha,
  baseline_source_snapshot_sha256:sha,state:z.enum(['active','closed']),current_outcome_id:id.nullable(),revision:z.number().int().positive(),
  idempotency_key:z.string(),intent_sha256:sha,created_by_user_id:id.nullable(),created_at:instant,updated_at:instant}).strict();
const outcomeSchema=z.object({id,plan_id:id,space_id:id,after_observation_id:id,after_value:numeric,
  after_sample_size:z.number().int().nonnegative(),after_period_start:instant,after_period_end:instant,after_as_of:instant,
  after_result_sha256:sha,after_source_snapshot_sha256:sha,absolute_delta:numeric,relative_delta:nullableNumeric,
  target_distance:nullableNumeric,target_met:booleanValue.nullable(),comparability_code:z.literal('same_metric_version_unit_nonoverlapping_periods'),
  interpretation:z.literal('descriptive_non_causal'),causal_claim:booleanValue,snapshot_json:z.union([z.string(),z.record(z.string(),z.unknown())]),
  snapshot_sha256:sha,plan_revision:z.number().int().positive(),idempotency_key:z.string(),intent_sha256:sha,
  created_by_user_id:id.nullable(),created_at:instant}).strict();

export type JourneyBlueprintMeasurementPlan=z.infer<typeof planSchema>;
export type JourneyBlueprintMeasurementOutcome=z.infer<typeof outcomeSchema>;
const key=(kind:string)=>`${kind}:${crypto.randomUUID()}`;
function parse<T>(schema:z.ZodType<T>,value:unknown,label:string){const result=schema.safeParse(value);if(!result.success)
  throw new Error(`Invalid ${label} response: ${result.error.issues[0]?.message||'contract mismatch'}`);return result.data;}

export async function listJourneyBlueprintMeasurements(blueprintVersionId:string){const raw=await api<unknown>(
  `/api/journey-blueprint-measurements/plans?blueprintVersionId=${encodeURIComponent(blueprintVersionId)}`);
  return parse(z.object({plans:z.array(planSchema)}).strict(),raw,'blueprint measurement list').plans;}
export async function readJourneyBlueprintMeasurement(planId:string){return parse(z.object({plan:planSchema,
  outcomes:z.array(outcomeSchema)}).strict(),await api<unknown>(`/api/journey-blueprint-measurements/plans/${encodeURIComponent(planId)}`),
  'blueprint measurement detail');}
export async function createJourneyBlueprintMeasurement(input:{blueprintVersionId:string;elementId:string;metricDefinitionId:string;
  metricDefinitionVersionId:string;baselineObservationId:string}){const raw=await api<unknown>('/api/journey-blueprint-measurements/plans',
  json('POST',{...input,idempotencyKey:key('blueprint-measurement-plan')}));return parse(z.object({plan:planSchema}).strict(),raw,
  'blueprint measurement plan').plan;}
export async function recordJourneyBlueprintMeasurementOutcome(plan:JourneyBlueprintMeasurementPlan,afterObservationId:string){const raw=
  await api<unknown>(`/api/journey-blueprint-measurements/plans/${encodeURIComponent(plan.id)}/outcomes`,json('POST',{
    afterObservationId,expectedRevision:plan.revision,idempotencyKey:key('blueprint-measurement-outcome')}));return parse(
    z.object({outcome:outcomeSchema}).strict(),raw,'blueprint measurement outcome').outcome;}
export async function closeJourneyBlueprintMeasurement(plan:JourneyBlueprintMeasurementPlan){const raw=await api<unknown>(
  `/api/journey-blueprint-measurements/plans/${encodeURIComponent(plan.id)}/close`,json('POST',{
    expectedRevision:plan.revision,idempotencyKey:key('blueprint-measurement-close')}));return parse(z.object({plan:planSchema}).strict(),raw,
  'closed blueprint measurement').plan;}
