import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceJourneyPrivacyCheckpoint, contentSafePrivacyBacklog, createJourneyPrivacyCheckpoint,
  hmacAnonymousSubjects, journeyPrivacyPropagationLimitations, journeyPrivacyPropagationTargets,
  journeyPrivacyStoreMatrix, parseJourneyPrivacyCheckpoint, sha256SubjectReferences
} from '../src/journeyPrivacyPropagationDomain.js';

const at='2026-08-08T12:00:00.000Z';

test('privacy propagation inventory covers raw, derived, prediction and effect surfaces',()=>{
  assert.deepEqual(journeyPrivacyPropagationTargets,[
    'future_effect_controls','action_queue','event_stage_outbox','stage_intelligence','survey_stage_outbox',
    'actual_path_projections','prediction_projections','mutable_identity_projections','immutable_evidence',
    'raw_identity_event_erasure','backup_region_legal_hold']);
  assert.deepEqual(journeyPrivacyPropagationLimitations,[
    'legal_hold_authority_not_modelled','backup_deletion_is_external_to_the_online_database',
    'regional_replica_deletion_is_external_to_the_online_database',
    'append_only_audit_receipts_and_dispatch_evidence_are_preserved',
    'raw_identifier_erasure_requires_a_pseudonymous_reidentification_barrier']);
  const stores=journeyPrivacyStoreMatrix.flatMap(entry=>entry.stores);
  for(const required of ['journey_raw_events','journey_identity_bindings','journey_actual_path_snapshots',
    'journey_stage_intelligence_facts','journey_prediction_runs','journey_stage_survey_outbox',
    'journey_event_intelligence_outbox','journey_action_queue','journey_adapter_effect_receipts','journey_webhook_dispatches'])
    assert.equal(stores.includes(required),true,`${required} must have an authoritative propagation disposition`);
});

test('checkpoint advances durably and stops on operator authority without fabricating completion',()=>{
  const initial=createJourneyPrivacyCheckpoint(at);
  const first=advanceJourneyPrivacyCheckpoint({checkpoint:initial,target:'future_effect_controls',state:'completed',
    affectedCount:2,code:'suppressed',at});
  assert.equal(first.cursor,1);assert.equal(first.status,'running');
  const blocked=advanceJourneyPrivacyCheckpoint({checkpoint:{...first,cursor:9},target:'raw_identity_event_erasure',
    state:'operator_required',affectedCount:0,code:'legal_hold_required',at});
  assert.equal(blocked.cursor,9);assert.equal(blocked.status,'operator_required');
  assert.equal(parseJourneyPrivacyCheckpoint(blocked,at).limitations.length,5);
  const corrupt=parseJourneyPrivacyCheckpoint({...initial,privatePayload:'do-not-trust'},at);
  assert.equal(corrupt.cursor,0);assert.equal(corrupt.status,'operator_required');
  assert.equal((corrupt.targets.future_effect_controls as any).code,'checkpoint_corrupt_operator_review_required');
  const waiting=advanceJourneyPrivacyCheckpoint({checkpoint:{...initial,cursor:1},target:'action_queue',state:'waiting',
    affectedCount:2,code:'leased_work_waiting',at});
  const resumed=advanceJourneyPrivacyCheckpoint({checkpoint:waiting,target:'action_queue',state:'completed',
    affectedCount:3,code:'leased_work_settled',at});
  assert.equal(resumed.targets.action_queue?.affectedCount,5);
});

test('subject derivation is deterministic, deduplicated, and content-safe backlog excludes identifiers',()=>{
  const refs=sha256SubjectReferences('profile-a',['anonymous-a','anonymous-a']);
  assert.equal(refs.length,2);assert.equal(refs.every(value=>/^[a-f0-9]{64}$/u.test(value)),true);
  const subjects=hmacAnonymousSubjects(Buffer.alloc(32,7),['anonymous-a','anonymous-a']);
  assert.equal(subjects.length,1);assert.match(subjects[0],/^[a-f0-9]{64}$/u);
  const backlog=contentSafePrivacyBacklog({queued:3,waiting:1,operatorRequired:1,oldestCreatedAt:at});
  assert.deepEqual(Object.keys(backlog),['schema','queued','waiting','operatorRequired','oldestCreatedAt']);
  assert.doesNotMatch(JSON.stringify(backlog),/profile|anonymous|email|payload/iu);
});
