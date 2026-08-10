import crypto from 'node:crypto';
import type { DatabaseRuntime } from './databaseAdapter.js';
import {
  advanceJourneyPrivacyCheckpoint, contentSafePrivacyBacklog, createJourneyPrivacyCheckpoint,
  hmacAnonymousSubjects, journeyPrivacyPropagationTargets, nextJourneyPrivacyTarget,
  parseJourneyPrivacyCheckpoint, sha256SubjectReferences,
  type JourneyPrivacyCheckpoint, type JourneyPrivacyPropagationOperation,
  type JourneyPrivacyPropagationTarget, type JourneyPrivacyTargetState
} from './journeyPrivacyPropagationDomain.js';

type TargetResult = { state: JourneyPrivacyTargetState; affectedCount: number; code: string };
type JobRow = { id: string; space_id: string; profile_id: string; operation: 'suppress' | 'erasure';
  state: 'queued' | 'completed'; result_json: string | Record<string, unknown>; created_at: string };
type ActualPathInvalidator = (input:{sourceId:string;spaceId:string;journeyDefinitionId:string;
  operation:JourneyPrivacyPropagationOperation;at:string})=>number;

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return (typeof value === 'string' ? JSON.parse(value) : value) as T; } catch { return fallback; } };
const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(',');
const stableId = (...parts: string[]) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export class JourneyPrivacyPropagationRepository {
  constructor(private readonly db: DatabaseRuntime, private readonly identityHmacKey: Buffer | string,
    private readonly erasureAuthorityReady: (spaceId:string,jobId:string)=>boolean = ()=>false,
    private readonly actualPathInvalidator?:ActualPathInvalidator) {
    if ((typeof identityHmacKey === 'string' ? Buffer.from(identityHmacKey) : identityHmacKey).length < 32) {
      throw new Error('Journey privacy propagation requires the governed identity HMAC key.');
    }
  }

  private identifiers(spaceId: string, profileId: string) {
    const rows = this.db.prepare(`SELECT identifier_kind,identifier_value FROM journey_identity_bindings
      WHERE space_id=? AND profile_id=? ORDER BY id`).all(spaceId, profileId) as any[];
    const values = rows.map((row) => String(row.identifier_value));
    return { refs: sha256SubjectReferences(profileId, values), bindings:rows.length,
      anonymous: hmacAnonymousSubjects(this.identityHmacKey, values) };
  }

  private processTarget(input: { jobId: string; spaceId: string; profileId: string;
    operation: JourneyPrivacyPropagationOperation; target: JourneyPrivacyPropagationTarget; at: string }): TargetResult {
    const subjects = this.identifiers(input.spaceId, input.profileId);
    const refs = subjects.refs; const anon = subjects.anonymous;
    if(input.operation==='erasure'&&subjects.bindings===0&&['event_stage_outbox','stage_intelligence','survey_stage_outbox'].includes(input.target))
      return {state:'operator_required',affectedCount:0,code:'subject_binding_coverage_unresolved'};
    switch (input.target) {
      case 'future_effect_controls': {
        if (!refs.length) return { state: 'completed', affectedCount: 0, code: 'no_subject_references' };
        const yes=this.db.provider==='postgres'?true:1;const no=this.db.provider==='postgres'?false:0;
        const changed = this.db.prepare(`UPDATE journey_action_subject_controls SET consent_state=?,suppressed=?,
          revision=revision+1,updated_at=? WHERE space_id=? AND profile_ref_sha256 IN (${placeholders(refs)})
          AND (consent_state<>? OR suppressed=?)`).run('denied',yes,input.at, input.spaceId, ...refs,'denied',no).changes;
        return { state: 'completed', affectedCount: changed, code: 'future_effects_suppressed' };
      }
      case 'action_queue': {
        if (!refs.length) return { state: 'completed', affectedCount: 0, code: 'no_subject_references' };
        const active = Number((this.db.prepare(`SELECT COUNT(*) count FROM journey_action_queue queue
          JOIN journey_workflow_runs run ON run.id=(SELECT action.run_id FROM journey_workflow_actions action WHERE action.id=queue.action_id)
          WHERE queue.space_id=? AND run.subject_ref_sha256 IN (${placeholders(refs)}) AND queue.state='leased'`)
          .get(input.spaceId, ...refs) as any)?.count || 0);
        const changed = this.db.prepare(`UPDATE journey_action_queue SET state='cancelled',hold_reason_code='privacy_suppressed',
          terminal_at=?,lease_owner_sha256=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=?
          WHERE space_id=? AND state IN ('held','ready','retry_scheduled') AND action_id IN
          (SELECT action.id FROM journey_workflow_actions action JOIN journey_workflow_runs run ON run.id=action.run_id
           WHERE run.space_id=? AND run.subject_ref_sha256 IN (${placeholders(refs)}))`)
          .run(input.at, input.at, input.spaceId, input.spaceId, ...refs).changes;
        const dispatches = this.db.prepare(`UPDATE journey_webhook_dispatches SET state='failed',last_error_code='JOURNEY_PRIVACY_SUPPRESSED',
          updated_at=? WHERE space_id=? AND state IN ('prepared','retry_wait') AND queue_id IN
          (SELECT queue.id FROM journey_action_queue queue JOIN journey_workflow_actions action ON action.id=queue.action_id
           JOIN journey_workflow_runs run ON run.id=action.run_id WHERE queue.space_id=?
           AND run.subject_ref_sha256 IN (${placeholders(refs)}))`).run(input.at,input.spaceId,input.spaceId,...refs).changes;
        return active ? { state: 'waiting', affectedCount: changed+dispatches, code: 'leased_action_waiting_for_fenced_precompletion' }
          : { state: 'completed', affectedCount: changed+dispatches, code: 'pending_actions_and_dispatches_cancelled_receipts_preserved' };
      }
      case 'event_stage_outbox': {
        if (!anon.length) return { state: 'completed', affectedCount: 0, code: 'no_anonymous_subjects' };
        let affected = 0;
        if (input.operation === 'erasure') for (const subject of anon) {
          affected += this.db.prepare(`INSERT INTO journey_event_intelligence_erasure_handles
            (space_id,subject_id_hmac,command_id_sha256,erased_at) VALUES (?,?,?,?)
            ON CONFLICT(space_id,subject_id_hmac) DO NOTHING`).run(input.spaceId, subject, stableId(input.jobId), input.at).changes;
        }
        if(input.operation!=='correction')affected += this.db.prepare(`UPDATE journey_event_intelligence_outbox SET state='blocked',block_reason=?
          WHERE space_id=? AND subject_id_hmac IN (${placeholders(anon)}) AND state='ready'`)
          .run(input.operation === 'erasure' ? 'privacy_erased' : 'consent_denied', input.spaceId, ...anon).changes;
        const materialized = this.db.prepare(`SELECT id,materialized_fact_id FROM journey_event_intelligence_outbox
          WHERE space_id=? AND subject_id_hmac IN (${placeholders(anon)}) AND state='materialized' ORDER BY id LIMIT 100`)
          .all(input.spaceId, ...anon) as any[];
        for (const row of materialized) {
          affected += this.appendStageFactDelete({ factId: String(row.materialized_fact_id), outboxId: String(row.id),
            commandId: input.jobId, at: input.at });
          affected += this.db.prepare(`INSERT INTO journey_event_intelligence_tombstones
            (id,space_id,source_outbox_id,reason,correction_ref_sha256,created_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(source_outbox_id,reason,correction_ref_sha256) DO NOTHING`).run(
              stableId('privacy-tombstone', input.jobId, row.id), input.spaceId, row.id,
              input.operation === 'correction' ? 'correction' : 'privacy_erasure', stableId(input.jobId), input.at).changes;
          affected += this.db.prepare(`UPDATE journey_event_intelligence_outbox SET state='tombstoned',block_reason=NULL
            WHERE id=? AND space_id=? AND state='materialized'`).run(row.id, input.spaceId).changes;
        }
        return materialized.length >= 100 ? { state: 'waiting', affectedCount: affected, code: 'event_stage_batch_continues' }
          : { state: 'completed', affectedCount: affected, code: 'event_stage_projections_invalidated' };
      }
      case 'stage_intelligence': {
        if (!anon.length) return { state: 'completed', affectedCount: 0, code: 'no_anonymous_subjects' };
        const rows = this.db.prepare(`SELECT id FROM journey_stage_intelligence_facts fact WHERE space_id=?
          AND subject_id_hmac IN (${placeholders(anon)}) AND operation='upsert'
          AND NOT EXISTS(SELECT 1 FROM journey_stage_intelligence_facts successor WHERE successor.supersedes_fact_id=fact.id)
          ORDER BY id LIMIT 100`).all(input.spaceId, ...anon) as any[];
        let affected = 0; for (const row of rows) affected += this.appendStageFactDelete({ factId: String(row.id),
          outboxId: `privacy:${input.jobId}`, commandId: input.jobId, at: input.at });
        return rows.length >= 100 ? { state: 'waiting', affectedCount: affected, code: 'stage_fact_batch_continues' }
          : { state: 'completed', affectedCount: affected, code: 'stage_facts_tombstoned_append_only' };
      }
      case 'survey_stage_outbox': {
        if (!anon.length) return { state: 'completed', affectedCount: 0, code: 'no_anonymous_subjects' };
        const leased = Number((this.db.prepare(`SELECT COUNT(*) count FROM journey_stage_survey_outbox outbox
          JOIN journey_stage_survey_source_revisions revision ON revision.id=outbox.source_revision_id
          JOIN journey_stage_survey_governance_receipts receipt ON receipt.id=revision.governance_receipt_id
          WHERE outbox.space_id=? AND receipt.subject_id_hmac IN (${placeholders(anon)}) AND outbox.state='leased'`)
          .get(input.spaceId, ...anon) as any)?.count || 0);
        const changed = this.db.prepare(`UPDATE journey_stage_survey_outbox SET state='dead_letter',last_error_code='JOURNEY_PRIVACY_SUPPRESSED',
          terminal_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE space_id=?
          AND state IN ('pending','retry_wait') AND source_revision_id IN (SELECT revision.id FROM journey_stage_survey_source_revisions revision
          JOIN journey_stage_survey_governance_receipts receipt ON receipt.id=revision.governance_receipt_id
          WHERE receipt.space_id=? AND receipt.subject_id_hmac IN (${placeholders(anon)}))`)
          .run(input.at, input.at, input.spaceId, input.spaceId, ...anon).changes;
        return leased ? { state: 'waiting', affectedCount: changed, code: 'leased_survey_projection_waiting_for_fence' }
          : { state: 'completed', affectedCount: changed, code: 'survey_outbox_stopped_receipts_preserved' };
      }
      case 'actual_path_projections': {
        if (!anon.length) return { state: 'completed', affectedCount: 0, code: 'no_anonymous_subjects' };
        if(this.db.provider==='postgres'&&!Boolean((this.db.prepare(
          "SELECT to_regclass('public.journey_actual_path_snapshots') IS NOT NULL AND to_regclass('public.journey_actual_path_rollups') IS NOT NULL available")
          .get() as {available?:unknown}|undefined)?.available))return {state:'operator_required',affectedCount:0,
          code:'actual_path_projection_store_unavailable'};
        const journeys = this.db.prepare(`SELECT DISTINCT instance.journey_definition_id,visit.journey_map_version_id
          FROM journey_anonymous_instances instance LEFT JOIN journey_anonymous_stage_visits visit
          ON visit.instance_id=instance.id AND visit.space_id=instance.space_id
          WHERE instance.space_id=? AND instance.anonymous_id_hash IN (${placeholders(anon)})`).all(input.spaceId, ...anon) as any[];
        if(journeys.some(row=>!row.journey_map_version_id))return {state:'operator_required',affectedCount:0,
          code:'path_reprojection_scope_unresolved'};
        if(this.db.provider==='postgres'&&!this.actualPathInvalidator)return {state:'operator_required',affectedCount:0,
          code:'actual_path_privacy_authority_unavailable'};
        let changed = 0;
        for (const row of journeys) {
          if(this.actualPathInvalidator)changed+=this.actualPathInvalidator({sourceId:input.jobId,spaceId:input.spaceId,
            journeyDefinitionId:String(row.journey_definition_id),operation:input.operation,at:input.at});
          else changed+=this.db.transaction(()=>{const snapshotCount=Number((this.db.prepare(
              'SELECT COUNT(*) count FROM journey_actual_path_snapshots WHERE space_id=? AND journey_definition_id=?')
              .get(input.spaceId,row.journey_definition_id) as any)?.count||0);
            const rollupCount=Number((this.db.prepare(
              'SELECT COUNT(*) count FROM journey_actual_path_rollups WHERE space_id=? AND journey_definition_id=?')
              .get(input.spaceId,row.journey_definition_id) as any)?.count||0);
            this.db.prepare(`INSERT INTO journey_actual_path_privacy_invalidations
              (id,space_id,journey_definition_id,source_type,source_id_sha256,operation,removed_snapshot_count,removed_rollup_count,invalidated_at)
              VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(space_id,journey_definition_id,source_type,source_id_sha256) DO NOTHING`).run(
                crypto.randomUUID(),input.spaceId,row.journey_definition_id,input.operation==='correction'?'correction_run':'privacy_job',
                stableId(input.jobId),input.operation,snapshotCount,rollupCount,input.at);
            const snapshots=this.db.prepare('DELETE FROM journey_actual_path_snapshots WHERE space_id=? AND journey_definition_id=?')
              .run(input.spaceId,row.journey_definition_id).changes;
            const rollups=this.db.prepare('DELETE FROM journey_actual_path_rollups WHERE space_id=? AND journey_definition_id=?')
              .run(input.spaceId,row.journey_definition_id).changes;
            return snapshots+rollups;})();
          const idempotencyKey=`privacy:${stableId(input.jobId,row.journey_definition_id,row.journey_map_version_id)}`;
          const intent=stableId('privacy-reprojection',input.spaceId,row.journey_definition_id,row.journey_map_version_id,input.jobId);
          changed+=this.db.prepare(`INSERT INTO journey_stage_reprojection_runs
            (id,space_id,reason,journey_definition_id,journey_map_version_id,rule_definition_id,rule_version_id,source_id,
             environment,window_start,window_end,state,available_at,lease_owner,lease_token,lease_generation,lease_expires_at,
             attempt_count,max_attempts,summary_json,error_code,idempotency_key,intent_sha256,requested_by_user_id,created_at,updated_at,completed_at)
             VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,'pending',?,NULL,NULL,0,NULL,0,5,?,NULL,?,?,NULL,?,?,NULL)
             ON CONFLICT(space_id,idempotency_key) DO NOTHING`).run(stableId('privacy-reprojection-run',idempotencyKey),input.spaceId,
              'reconcile',row.journey_definition_id,row.journey_map_version_id,input.at,
              json({reason:'privacy_propagation',operation:input.operation}),idempotencyKey,intent,input.at,input.at).changes;
        }
        return { state: 'completed', affectedCount: changed, code: 'aggregate_paths_invalidated_and_reprojection_enqueued' };
      }
      case 'prediction_projections': {
        const changed = this.db.prepare(`INSERT INTO journey_prediction_audit
          (id,space_id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at)
          VALUES (?,?,NULL,'privacy.propagated','profile_ref',?,?,?,?) ON CONFLICT(id) DO NOTHING`)
          .run(stableId('prediction-privacy', input.jobId), input.spaceId, stableId(input.profileId),
            json({ operation: input.operation, subjectReferenceCount: refs.length }),
            stableId(input.operation, String(refs.length)), input.at).changes;
        return { state: 'preserved_append_only', affectedCount: changed, code: 'prediction_history_preserved_future_effects_suppressed' };
      }
      case 'mutable_identity_projections': {
        let changed = 0;
        changed += this.db.prepare(`DELETE FROM journey_profile_export_jobs WHERE space_id=? AND profile_id=?`)
          .run(input.spaceId, input.profileId).changes;
        changed += this.db.prepare(`DELETE FROM journey_identity_segment_memberships WHERE space_id=?
          AND (profile_id=? OR canonical_profile_id=?)`).run(input.spaceId, input.profileId, input.profileId).changes;
        changed += this.db.prepare(`DELETE FROM journey_profile_timeline_events WHERE space_id=?
          AND (profile_id=? OR canonical_profile_id=?)`).run(input.spaceId, input.profileId, input.profileId).changes;
        changed += this.db.prepare(`DELETE FROM journey_identity_sessions WHERE space_id=?
          AND (profile_id=? OR canonical_profile_id=?)`).run(input.spaceId, input.profileId, input.profileId).changes;
        return { state: 'completed', affectedCount: changed, code: 'mutable_identity_views_removed' };
      }
      case 'immutable_evidence':
        return { state: 'preserved_append_only', affectedCount: 0,
          code: 'content_safe_audit_attempt_receipt_dispatch_and_prediction_history_preserved' };
      case 'raw_identity_event_erasure':
        return input.operation === 'erasure'
          ? this.erasureAuthorityReady(input.spaceId,input.jobId)
            ? {state:'completed',affectedCount:0,code:'raw_erasure_external_authority_confirmed'}
            : { state: 'operator_required', affectedCount: 0, code: 'pseudonymous_tombstone_and_legal_hold_authority_required' }
          : { state: 'completed', affectedCount: 0, code: 'raw_evidence_access_suppressed_not_physically_erased' };
      case 'backup_region_legal_hold':
        return input.operation === 'erasure'
          ? this.erasureAuthorityReady(input.spaceId,input.jobId)
            ? {state:'completed',affectedCount:0,code:'backup_region_and_legal_hold_authority_confirmed'}
            : { state: 'operator_required', affectedCount: 0, code: 'external_backup_region_and_legal_hold_confirmation_required' }
          : { state: 'completed', affectedCount: 0, code: 'not_required_for_suppression_or_correction' };
    }
  }

  private appendStageFactDelete(input: { factId: string; outboxId: string; commandId: string; at: string }) {
    const row = this.db.prepare('SELECT * FROM journey_stage_intelligence_facts WHERE id=?').get(input.factId) as any;
    if (!row || row.operation === 'delete') return 0;
    const existing = this.db.prepare('SELECT id FROM journey_stage_intelligence_facts WHERE supersedes_fact_id=?').get(row.id);
    if (existing || Date.parse(String(row.retention_expires_at)) <= Date.parse(input.at)) return 0;
    const id = stableId('privacy-delete', input.commandId, row.id);
    const revision = Number(row.revision) + 1;
    return this.db.prepare(`INSERT INTO journey_stage_intelligence_facts
      (id,space_id,journey_definition_id,source_type,source_id_hmac,external_record_hmac,source_version,schema_version,
       projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,stage_id,metric_definition_id,
       metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,sentiment,emotions_json,
       occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'delete',?,?,?,?,?,?,?,NULL,?,NULL,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(id,row.space_id,row.journey_definition_id,row.source_type,row.source_id_hmac,row.external_record_hmac,row.source_version,
        row.schema_version,row.projection_version,revision,row.id,row.subject_id_hmac,row.stage_id,row.metric_definition_id,
        row.metric_definition_version_id,row.metric_definition_version_sha256,row.metric_unit,
        typeof row.dimensions_json==='string'?row.dimensions_json:json(row.dimensions_json),
        typeof row.emotions_json==='string'?row.emotions_json:json(row.emotions_json),row.occurred_at,'withdrawn',
        typeof row.purposes_json==='string'?row.purposes_json:json(row.purposes_json),row.retention_expires_at,
        crypto.createHmac('sha256',this.identityHmacKey).update(`${input.outboxId}:${row.id}:${revision}`).digest('hex'),
        stableId(input.commandId,row.id,String(revision)),input.at).changes;
  }

  processNext(jobId: string, at = new Date().toISOString()) {
    return this.db.transaction(() => {
      const lock = this.db.provider === 'postgres' ? ' FOR UPDATE' : '';
      const row = this.db.prepare(`SELECT * FROM journey_profile_privacy_jobs WHERE id=?${lock}`).get(jobId) as JobRow | undefined;
      if (!row || row.state !== 'queued') return null;
      const result = parse<Record<string, unknown>>(row.result_json, {});
      const checkpoint = parseJourneyPrivacyCheckpoint(result.privacyPropagation, at);
      if (checkpoint.status === 'operator_required') {this.db.prepare('UPDATE journey_profile_privacy_jobs SET result_json=? WHERE id=?')
        .run(json({...result,privacyPropagation:checkpoint}),row.id);return { jobId, checkpoint, changed: true };}
      const target = nextJourneyPrivacyTarget(checkpoint);
      if (!target) return this.completeJob(row, result, checkpoint, at);
      const outcome = this.processTarget({ jobId: row.id, spaceId: row.space_id, profileId: row.profile_id,
        operation: row.operation, target, at });
      const next = advanceJourneyPrivacyCheckpoint({ checkpoint, target, ...outcome, at });
      const nextResult = { ...result, privacyPropagation: next };
      this.db.prepare(`UPDATE journey_profile_privacy_jobs SET result_json=?,state=?,completed_at=? WHERE id=? AND state='queued'`)
        .run(json(nextResult), next.status === 'completed' ? 'completed' : 'queued', next.status === 'completed' ? at : null, row.id);
      return { jobId, checkpoint: next, changed: true };
    })();
  }

  private completeJob(row: JobRow, result: Record<string, unknown>, checkpoint: JourneyPrivacyCheckpoint, at: string) {
    const next = { ...checkpoint, status: 'completed' as const, cursor: journeyPrivacyPropagationTargets.length, updatedAt: at };
    this.db.prepare(`UPDATE journey_profile_privacy_jobs SET result_json=?,state='completed',completed_at=? WHERE id=? AND state='queued'`)
      .run(json({ ...result, privacyPropagation: next }), at, row.id);
    return { jobId: row.id, checkpoint: next, changed: true };
  }

  claimNext(at = new Date().toISOString()) {
    const rows = this.db.prepare(`SELECT id,result_json FROM journey_profile_privacy_jobs WHERE state='queued'
      AND COALESCE(json_extract(result_json,'$.privacyPropagation.status'),'running')<>'operator_required'
      ORDER BY CASE WHEN COALESCE(json_extract(result_json,'$.privacyPropagation.status'),'running')='waiting' THEN 1 ELSE 0 END,
      created_at,id LIMIT 100`).all() as any[];
    const candidates=rows.map(row=>{const result=parse<Record<string,unknown>>(row.result_json,{});
      return {row,status:parseJourneyPrivacyCheckpoint(result.privacyPropagation,at).status};});
    for (const candidate of [...candidates.filter(entry=>entry.status==='running'),...candidates.filter(entry=>entry.status==='waiting')]) {
      const row=candidate.row;
      const result = parse<Record<string, unknown>>(row.result_json, {});
      const checkpoint = parseJourneyPrivacyCheckpoint(result.privacyPropagation, at);
      if (checkpoint.status !== 'operator_required') return this.processNext(String(row.id), at);
    }
    return null;
  }

  processNextCorrection(runId:string,at=new Date().toISOString()){
    return this.db.transaction(()=>{const lock=this.db.provider==='postgres'?' FOR UPDATE':'';
      const row=this.db.prepare(`SELECT * FROM journey_identity_correction_runs WHERE id=?${lock}`).get(runId) as any;
      if(!row)return null;const result=parse<Record<string,unknown>>(row.result_json,{});
      const checkpoint=parseJourneyPrivacyCheckpoint(result.privacyPropagation,at);
      if(checkpoint.status==='operator_required'){this.db.prepare('UPDATE journey_identity_correction_runs SET result_json=? WHERE id=?')
        .run(json({...result,privacyPropagation:checkpoint}),row.id);return {runId,checkpoint,changed:true};}
      const target=nextJourneyPrivacyTarget(checkpoint);if(!target)return {runId,checkpoint,changed:false};
      const profileIds=parse<string[]>(row.profile_ids_json,[]).filter(value=>typeof value==='string'&&value.length>0);
      let affectedCount=0;let state:JourneyPrivacyTargetState='completed';let code='correction_projection_reconciled';
      for(const profileId of profileIds){const outcome=this.processTarget({jobId:String(row.id),spaceId:row.space_id,
        profileId,operation:'correction',target,at});affectedCount+=outcome.affectedCount;
        if(outcome.state==='operator_required'){state='operator_required';code=outcome.code;break;}
        if(outcome.state==='waiting'){state='waiting';code=outcome.code;break;}
        if(outcome.state==='preserved_append_only'){state='preserved_append_only';code=outcome.code;}}
      const next=advanceJourneyPrivacyCheckpoint({checkpoint,target,state,affectedCount,code,at});
      this.db.prepare('UPDATE journey_identity_correction_runs SET result_json=? WHERE id=?')
        .run(json({...result,privacyPropagation:next}),row.id);
      return {runId,checkpoint:next,changed:true};})();
  }

  claimNextCorrection(at=new Date().toISOString()){
    const rows=this.db.prepare(`SELECT id,result_json FROM journey_identity_correction_runs
      WHERE COALESCE(json_extract(result_json,'$.privacyPropagation.status'),'running') NOT IN ('completed','operator_required')
      ORDER BY CASE WHEN COALESCE(json_extract(result_json,'$.privacyPropagation.status'),'running')='waiting' THEN 1 ELSE 0 END,
      created_at,id LIMIT 100`).all() as any[];
    const candidates=rows.map(row=>{const result=parse<Record<string,unknown>>(row.result_json,{});
      return {row,status:parseJourneyPrivacyCheckpoint(result.privacyPropagation,at).status};});
    const candidate=[...candidates.filter(entry=>entry.status==='running'),...candidates.filter(entry=>entry.status==='waiting')][0];
    return candidate?this.processNextCorrection(String(candidate.row.id),at):null;
  }

  backlog(at = new Date().toISOString()) {
    const rows = this.db.prepare(`SELECT created_at,result_json FROM journey_profile_privacy_jobs WHERE state='queued'
      ORDER BY created_at,id`).all() as any[];
    let waiting=0,operatorRequired=0;
    for(const row of rows){const result=parse<Record<string,unknown>>(row.result_json,{});
      const state=parseJourneyPrivacyCheckpoint(result.privacyPropagation,at).status;
      if(state==='waiting')waiting+=1;if(state==='operator_required')operatorRequired+=1;}
    return contentSafePrivacyBacklog({queued:rows.length,waiting,operatorRequired,oldestCreatedAt:rows[0]?.created_at||null});
  }
}

export class JourneyPrivacyPropagationWorker {
  private timer: NodeJS.Timeout | null = null; private running = false; private stopped = true;
  constructor(private readonly repository: JourneyPrivacyPropagationRepository,
    private readonly intervalMs = 1_000, private readonly batchSize = 25) {}
  start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>this.runOnce(),this.intervalMs);this.timer.unref();this.runOnce();}
  runOnce(at=new Date().toISOString()){if(this.stopped||this.running)return null;this.running=true;let processed=0;
    try{for(let index=0;index<this.batchSize;index+=1){const privacy=this.repository.claimNext(at);
      const correction=this.repository.claimNextCorrection(at);if(!privacy&&!correction)break;processed+=(privacy?1:0)+(correction?1:0);}
      return {processed,backlog:this.repository.backlog(at)};}finally{this.running=false;}}
  stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
  async drain(timeoutMs=8_000){const deadline=Date.now()+timeoutMs;while(this.running&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));return !this.running;}
}
