import crypto from 'node:crypto';

export const journeyPrivacyPropagationTargets = [
  'future_effect_controls',
  'action_queue',
  'event_stage_outbox',
  'stage_intelligence',
  'survey_stage_outbox',
  'actual_path_projections',
  'prediction_projections',
  'mutable_identity_projections',
  'immutable_evidence',
  'raw_identity_event_erasure',
  'backup_region_legal_hold'
] as const;

export type JourneyPrivacyPropagationTarget = typeof journeyPrivacyPropagationTargets[number];
export type JourneyPrivacyPropagationOperation = 'suppress' | 'erasure' | 'correction';
export type JourneyPrivacyTargetState = 'completed' | 'preserved_append_only' | 'waiting' | 'operator_required';

export type JourneyPrivacyCheckpoint = {
  schema: 'seemplify.journey-privacy-propagation/v1';
  status: 'running' | 'waiting' | 'operator_required' | 'completed';
  cursor: number;
  updatedAt: string;
  targets: Partial<Record<JourneyPrivacyPropagationTarget, {
    state: JourneyPrivacyTargetState;
    affectedCount: number;
    code: string;
    updatedAt: string;
  }>>;
  limitations: readonly string[];
};

export const journeyPrivacyPropagationLimitations = Object.freeze([
  'legal_hold_authority_not_modelled',
  'backup_deletion_is_external_to_the_online_database',
  'regional_replica_deletion_is_external_to_the_online_database',
  'append_only_audit_receipts_and_dispatch_evidence_are_preserved',
  'raw_identifier_erasure_requires_a_pseudonymous_reidentification_barrier'
]);

export const journeyPrivacyStoreMatrix = Object.freeze([
  { stores: ['journey_raw_events','journey_event_ingest_receipts','journey_event_deduplication','journey_event_rejections',
    'journey_event_processing_inbox','journey_event_processing_receipts','journey_event_dead_letters','journey_event_data_audit'],
    layer: 'raw_event', checkpoint: 'retention_expires_at plus processing lease', disposition: 'operator_authority_required_for_subject_erasure' },
  { stores: ['journey_identity_profiles','journey_identity_bindings','journey_identity_source_facts','journey_identity_profile_tombstones',
    'journey_identity_identifier_tombstones','journey_identity_audit_facts','journey_identity_processed_commands'],
    layer: 'identity_evidence', checkpoint: 'journey_profile_privacy_jobs.result_json', disposition: 'suppress_and_preserve_reidentification_barrier' },
  { stores: ['journey_profile_timeline_events','journey_identity_sessions','journey_identity_segment_memberships','journey_profile_export_jobs'],
    layer: 'identity_projection', checkpoint: 'journey_profile_privacy_jobs.result_json', disposition: 'delete_and_rebuild' },
  { stores: ['journey_stage_rule_decisions','journey_anonymous_instances','journey_anonymous_stage_visits','journey_actual_path_snapshots',
    'journey_actual_path_rollups','journey_path_intelligence_runs','journey_stage_inference_recommendations','journey_path_intelligence_audit'],
    layer: 'path', checkpoint: 'privacy job cursor plus reprojection checkpoints', disposition: 'invalidate_aggregates_preserve_append_only_lineage' },
  { stores: ['journey_stage_intelligence_facts','journey_stage_intelligence_audit'], layer: 'stage_intelligence',
    checkpoint: 'append-only delete revision plus retention cursor', disposition: 'tombstone_then_expired_retention_purge' },
  { stores: ['journey_prediction_runs','journey_prediction_audit','journey_prediction_drift_evaluations'], layer: 'prediction',
    checkpoint: 'privacy job cursor', disposition: 'preserve_history_suppress_future_effects' },
  { stores: ['journey_stage_survey_governance_receipts','journey_stage_survey_source_revisions','journey_stage_survey_outbox',
    'journey_stage_survey_outbox_attempts','journey_stage_survey_checkpoints','journey_stage_survey_feed_audit'], layer: 'survey_feed',
    checkpoint: 'leased outbox plus mapping checkpoint and retention cursor', disposition: 'fenced_stop_tombstone_and_expired_purge' },
  { stores: ['journey_event_intelligence_erasure_handles','journey_event_intelligence_outbox',
    'journey_event_intelligence_materialization_state','journey_event_intelligence_tombstones'], layer: 'event_feed',
    checkpoint: 'event outbox state plus materialization state', disposition: 'block_or_append_tombstone' },
  { stores: ['journey_workflow_runs','journey_workflow_actions','journey_workflow_outbox','journey_action_queue',
    'journey_action_gate_resolutions','journey_action_attempts','journey_action_effect_receipts','journey_adapter_execution_attempts',
    'journey_adapter_effect_receipts','journey_adapter_internal_notifications','journey_webhook_dispatches',
    'journey_action_live_contexts','journey_action_subject_controls','journey_action_worker_reservations',
    'journey_action_worker_reservation_events'], layer: 'action', checkpoint: 'queue fence plus reservation fence',
    disposition: 'deny_future_cancel_unleased_wait_for_fenced_precompletion_preserve_receipts' }
]);

export function createJourneyPrivacyCheckpoint(at: string): JourneyPrivacyCheckpoint {
  return { schema: 'seemplify.journey-privacy-propagation/v1', status: 'running', cursor: 0,
    updatedAt: at, targets: {}, limitations: journeyPrivacyPropagationLimitations };
}

export function parseJourneyPrivacyCheckpoint(value: unknown, at: string): JourneyPrivacyCheckpoint {
  if (!value || typeof value !== 'object') return createJourneyPrivacyCheckpoint(at);
  const candidate = value as Partial<JourneyPrivacyCheckpoint>;
  const topLevelKeys=new Set(['schema','status','cursor','updatedAt','targets','limitations']);
  const statuses=['running','waiting','operator_required','completed'];
  const states=['completed','preserved_append_only','waiting','operator_required'];
  const known=new Set<string>(journeyPrivacyPropagationTargets);
  const targetEntries=candidate.targets&&typeof candidate.targets==='object'&&!Array.isArray(candidate.targets)
    ?Object.entries(candidate.targets):[];
  const validTargetEntries=targetEntries.every(([name,target])=>known.has(name)&&Boolean(target)&&typeof target==='object'
    &&Object.keys(target as object).every(key=>['state','affectedCount','code','updatedAt'].includes(key))
    &&Object.keys(target as object).length===4
    && states.includes(String((target as any).state))&&Number.isSafeInteger((target as any).affectedCount)
    && Number((target as any).affectedCount)>=0&&/^[a-z0-9_]{1,160}$/u.test(String((target as any).code||''))
    && Number.isFinite(Date.parse(String((target as any).updatedAt||'')))
    && Date.parse(String((target as any).updatedAt))<=Date.parse(at));
  const cursor=Number(candidate.cursor);
  const validLimitations=Array.isArray(candidate.limitations)
    && candidate.limitations.length===journeyPrivacyPropagationLimitations.length
    && candidate.limitations.every((entry,index)=>entry===journeyPrivacyPropagationLimitations[index]);
  const valid=Object.keys(candidate).every(key=>topLevelKeys.has(key))&&Object.keys(candidate).length===6
    &&candidate.schema==='seemplify.journey-privacy-propagation/v1'&&statuses.includes(String(candidate.status))
    &&Number.isSafeInteger(cursor)&&cursor>=0&&cursor<=journeyPrivacyPropagationTargets.length
    &&Number.isFinite(Date.parse(String(candidate.updatedAt||'')))&&Date.parse(String(candidate.updatedAt))<=Date.parse(at)
    &&validTargetEntries&&validLimitations
    &&(candidate.status==='completed'?cursor===journeyPrivacyPropagationTargets.length:cursor<journeyPrivacyPropagationTargets.length)
    &&(candidate.status==='waiting'||candidate.status==='operator_required'
      ?(candidate.targets as any)?.[journeyPrivacyPropagationTargets[cursor]]?.state===candidate.status:true);
  if(!valid){const corrupt=createJourneyPrivacyCheckpoint(at);return {...corrupt,status:'operator_required',targets:{
    [journeyPrivacyPropagationTargets[0]]:{state:'operator_required',affectedCount:0,
      code:'checkpoint_corrupt_operator_review_required',updatedAt:at}}};}
  return { schema:'seemplify.journey-privacy-propagation/v1',status:candidate.status!,cursor,updatedAt:String(candidate.updatedAt),
    targets:Object.fromEntries(targetEntries) as JourneyPrivacyCheckpoint['targets'],limitations:journeyPrivacyPropagationLimitations };
}

export function nextJourneyPrivacyTarget(checkpoint: JourneyPrivacyCheckpoint) {
  return journeyPrivacyPropagationTargets[checkpoint.cursor] || null;
}

export function advanceJourneyPrivacyCheckpoint(input: {
  checkpoint: JourneyPrivacyCheckpoint;
  target: JourneyPrivacyPropagationTarget;
  state: JourneyPrivacyTargetState;
  affectedCount: number;
  code: string;
  at: string;
}) {
  const terminal = input.state === 'operator_required';
  const waiting = input.state === 'waiting';
  const cursor = terminal || waiting ? input.checkpoint.cursor : input.checkpoint.cursor + 1;
  const prior=input.checkpoint.targets[input.target];
  const affectedCount=(prior?.affectedCount||0)+Math.max(0,Math.trunc(input.affectedCount));
  return {
    ...input.checkpoint,
    status: terminal ? 'operator_required' as const : waiting ? 'waiting' as const
      : cursor >= journeyPrivacyPropagationTargets.length ? 'completed' as const : 'running' as const,
    cursor,
    updatedAt: input.at,
    targets: { ...input.checkpoint.targets, [input.target]: { state: input.state,
      affectedCount, code: input.code, updatedAt: input.at } }
  };
}

export function sha256SubjectReferences(profileId: string, identifierValues: readonly string[]) {
  return [...new Set([profileId, ...identifierValues].filter(Boolean)
    .map((value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex')))];
}

export function hmacAnonymousSubjects(key: Buffer | string, identifierValues: readonly string[]) {
  return [...new Set(identifierValues.filter(Boolean)
    .map((value) => crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')))];
}

export function contentSafePrivacyBacklog(input: {
  queued: number; waiting: number; operatorRequired: number; oldestCreatedAt: string | null;
}) {
  return { schema: 'seemplify.journey-privacy-backlog/v1', queued: Math.max(0, input.queued),
    waiting: Math.max(0, input.waiting), operatorRequired: Math.max(0, input.operatorRequired),
    oldestCreatedAt: input.oldestCreatedAt };
}
