import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { DatabaseRuntime } from '../src/databaseAdapter.js';
import { hmacAnonymousSubjects, sha256SubjectReferences } from '../src/journeyPrivacyPropagationDomain.js';
import { JourneyPrivacyPropagationRepository } from '../src/journeyPrivacyPropagationWorker.js';

const at='2026-08-08T12:00:00.000Z',key=Buffer.alloc(32,9),profile='profile-a',anonymous='anonymous-a';

function setup(erasureReady:()=>boolean=()=>false){const sqlite=new Database(':memory:');Object.defineProperty(sqlite,'provider',{value:'sqlite'});
  sqlite.exec(`
  CREATE TABLE journey_identity_bindings(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT,identifier_kind TEXT,identifier_value TEXT);
  CREATE TABLE journey_profile_privacy_jobs(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT,operation TEXT,state TEXT,
    result_json TEXT,created_at TEXT,completed_at TEXT);
  CREATE TABLE journey_action_subject_controls(space_id TEXT,profile_ref_sha256 TEXT,purpose_key TEXT,consent_state TEXT,
    suppressed INTEGER,revision INTEGER,updated_at TEXT,PRIMARY KEY(space_id,profile_ref_sha256,purpose_key));
  CREATE TABLE journey_workflow_runs(id TEXT PRIMARY KEY,space_id TEXT,subject_ref_sha256 TEXT);
  CREATE TABLE journey_workflow_actions(id TEXT PRIMARY KEY,run_id TEXT,space_id TEXT);
  CREATE TABLE journey_action_queue(id TEXT PRIMARY KEY,action_id TEXT,space_id TEXT,state TEXT,hold_reason_code TEXT,
    terminal_at TEXT,lease_owner_sha256 TEXT,lease_token TEXT,lease_expires_at TEXT,revision INTEGER,updated_at TEXT);
  CREATE TABLE journey_webhook_dispatches(id TEXT PRIMARY KEY,queue_id TEXT,space_id TEXT,state TEXT,last_error_code TEXT,updated_at TEXT);
  CREATE TABLE journey_event_intelligence_erasure_handles(space_id TEXT,subject_id_hmac TEXT,command_id_sha256 TEXT,erased_at TEXT,
    PRIMARY KEY(space_id,subject_id_hmac));
  CREATE TABLE journey_event_intelligence_outbox(id TEXT PRIMARY KEY,space_id TEXT,subject_id_hmac TEXT,state TEXT,block_reason TEXT,
    materialized_fact_id TEXT);
  CREATE TABLE journey_event_intelligence_tombstones(id TEXT PRIMARY KEY,space_id TEXT,source_outbox_id TEXT,reason TEXT,
    correction_ref_sha256 TEXT,created_at TEXT,UNIQUE(source_outbox_id,reason,correction_ref_sha256));
  CREATE TABLE journey_stage_intelligence_facts(id TEXT PRIMARY KEY,space_id TEXT,journey_definition_id TEXT,source_type TEXT,
    source_id_hmac TEXT,external_record_hmac TEXT,source_version TEXT,schema_version TEXT,projection_version TEXT,revision INTEGER,
    operation TEXT,supersedes_fact_id TEXT,subject_id_hmac TEXT,stage_id TEXT,metric_definition_id TEXT,metric_definition_version_id TEXT,
    metric_definition_version_sha256 TEXT,metric_unit TEXT,value REAL,dimensions_json TEXT,sentiment TEXT,emotions_json TEXT,
    occurred_at TEXT,consent_state TEXT,purposes_json TEXT,retention_expires_at TEXT,idempotency_key_hmac TEXT,intent_sha256 TEXT,created_at TEXT);
  CREATE TABLE journey_stage_survey_governance_receipts(id TEXT PRIMARY KEY,space_id TEXT,subject_id_hmac TEXT);
  CREATE TABLE journey_stage_survey_source_revisions(id TEXT PRIMARY KEY,governance_receipt_id TEXT);
  CREATE TABLE journey_stage_survey_outbox(id TEXT PRIMARY KEY,space_id TEXT,source_revision_id TEXT,state TEXT,last_error_code TEXT,
    terminal_at TEXT,lease_owner TEXT,lease_token TEXT,lease_expires_at TEXT,updated_at TEXT);
  CREATE TABLE journey_anonymous_instances(id TEXT PRIMARY KEY,space_id TEXT,anonymous_id_hash TEXT,journey_definition_id TEXT);
  CREATE TABLE journey_anonymous_stage_visits(id TEXT PRIMARY KEY,instance_id TEXT,space_id TEXT,journey_map_version_id TEXT);
  CREATE TABLE journey_actual_path_snapshots(id TEXT PRIMARY KEY,space_id TEXT,journey_definition_id TEXT);
  CREATE TABLE journey_actual_path_rollups(id TEXT PRIMARY KEY,space_id TEXT,journey_definition_id TEXT);
  CREATE TABLE journey_actual_path_privacy_invalidations(id TEXT PRIMARY KEY,space_id TEXT,journey_definition_id TEXT,
    source_type TEXT,source_id_sha256 TEXT,operation TEXT,removed_snapshot_count INTEGER,removed_rollup_count INTEGER,
    invalidated_at TEXT,UNIQUE(space_id,journey_definition_id,source_type,source_id_sha256));
  CREATE TABLE journey_stage_reprojection_runs(id TEXT PRIMARY KEY,space_id TEXT,reason TEXT,journey_definition_id TEXT,
    journey_map_version_id TEXT,rule_definition_id TEXT,rule_version_id TEXT,source_id TEXT,environment TEXT,window_start TEXT,
    window_end TEXT,state TEXT,available_at TEXT,lease_owner TEXT,lease_token TEXT,lease_generation INTEGER,lease_expires_at TEXT,
    attempt_count INTEGER,max_attempts INTEGER,summary_json TEXT,error_code TEXT,idempotency_key TEXT,intent_sha256 TEXT,
    requested_by_user_id TEXT,created_at TEXT,updated_at TEXT,completed_at TEXT,UNIQUE(space_id,idempotency_key));
  CREATE TABLE journey_prediction_audit(id TEXT PRIMARY KEY,space_id TEXT,actor_user_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
    detail_json TEXT,detail_sha256 TEXT,created_at TEXT);
  CREATE TABLE journey_profile_export_jobs(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT);
  CREATE TABLE journey_identity_segment_memberships(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT,canonical_profile_id TEXT);
  CREATE TABLE journey_profile_timeline_events(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT,canonical_profile_id TEXT);
  CREATE TABLE journey_identity_sessions(id TEXT PRIMARY KEY,space_id TEXT,profile_id TEXT,canonical_profile_id TEXT);
  CREATE TABLE journey_identity_correction_runs(id TEXT PRIMARY KEY,space_id TEXT,command_id TEXT,profile_ids_json TEXT,
    result_json TEXT,created_at TEXT);
  `);
  const ref=sha256SubjectReferences(profile,[anonymous])[0];const subject=hmacAnonymousSubjects(key,[anonymous])[0];
  sqlite.prepare('INSERT INTO journey_identity_bindings VALUES (?,?,?,?,?)').run('binding-a','space-a',profile,'anonymous_id',anonymous);
  sqlite.prepare('INSERT INTO journey_action_subject_controls VALUES (?,?,?,?,?,?,?)').run('space-a',ref,'analytics','granted',0,1,at);
  sqlite.prepare('INSERT INTO journey_workflow_runs VALUES (?,?,?)').run('run-a','space-a',ref);
  sqlite.prepare('INSERT INTO journey_workflow_actions VALUES (?,?,?)').run('action-a','run-a','space-a');
  sqlite.prepare('INSERT INTO journey_action_queue VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('queue-a','action-a','space-a','ready',null,null,null,null,null,1,at);
  sqlite.prepare('INSERT INTO journey_webhook_dispatches VALUES (?,?,?,?,?,?)').run('dispatch-a','queue-a','space-a','prepared',null,at);
  sqlite.prepare('INSERT INTO journey_event_intelligence_outbox VALUES (?,?,?,?,?,?)').run('event-outbox-a','space-a',subject,'ready',null,null);
  const fact=['fact-a','space-a','journey-a','survey','a'.repeat(64),'b'.repeat(64),'source-v1','schema-v1','projection-v1',1,
    'upsert',null,subject,'stage-a','metric-a','metric-v1','c'.repeat(64),'count',1,'{}',null,'[]',at,'granted',
    JSON.stringify(['analytics']),'2026-09-08T12:00:00.000Z','d'.repeat(64),'e'.repeat(64),at];
  sqlite.prepare(`INSERT INTO journey_stage_intelligence_facts VALUES (${fact.map(()=>'?').join(',')})`).run(...fact);
  sqlite.prepare('INSERT INTO journey_stage_survey_governance_receipts VALUES (?,?,?)').run('receipt-a','space-a',subject);
  sqlite.prepare('INSERT INTO journey_stage_survey_source_revisions VALUES (?,?)').run('revision-a','receipt-a');
  sqlite.prepare('INSERT INTO journey_stage_survey_outbox VALUES (?,?,?,?,?,?,?,?,?,?)').run('survey-outbox-a','space-a','revision-a','pending',null,null,null,null,null,at);
  sqlite.prepare('INSERT INTO journey_anonymous_instances VALUES (?,?,?,?)').run('instance-a','space-a',subject,'journey-a');
  sqlite.prepare('INSERT INTO journey_anonymous_stage_visits VALUES (?,?,?,?)').run('visit-a','instance-a','space-a','map-a');
  sqlite.prepare('INSERT INTO journey_actual_path_snapshots VALUES (?,?,?)').run('snapshot-a','space-a','journey-a');
  sqlite.prepare('INSERT INTO journey_actual_path_rollups VALUES (?,?,?)').run('rollup-a','space-a','journey-a');
  for(const table of ['journey_profile_export_jobs','journey_identity_segment_memberships','journey_profile_timeline_events','journey_identity_sessions']){
    if(table==='journey_profile_export_jobs')sqlite.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(`${table}-a`,'space-a',profile);
    else sqlite.prepare(`INSERT INTO ${table} VALUES (?,?,?,?)`).run(`${table}-a`,'space-a',profile,profile);}
  return {sqlite,repo:new JourneyPrivacyPropagationRepository(sqlite as unknown as DatabaseRuntime,key,()=>erasureReady()),ref,subject};}

function insertJob(sqlite:Database.Database,id:string,operation:'suppress'|'erasure',createdAt=at){
  sqlite.prepare(`INSERT INTO journey_profile_privacy_jobs VALUES (?,?,?,?,'queued','{}',?,NULL)`)
    .run(id,'space-a',profile,operation,createdAt);
}

test('suppression resumes one target at a time and completes every mutable projection without deleting evidence',()=>{
  const {sqlite,repo}=setup();insertJob(sqlite,'job-suppress','suppress');
  for(let step=0;step<20;step+=1){repo.claimNext(at);const row=sqlite.prepare('SELECT state FROM journey_profile_privacy_jobs WHERE id=?').get('job-suppress') as any;
    if(row.state==='completed')break;}
  const job=sqlite.prepare('SELECT * FROM journey_profile_privacy_jobs WHERE id=?').get('job-suppress') as any;
  const result=JSON.parse(job.result_json);assert.equal(job.state,'completed');assert.equal(result.privacyPropagation.cursor,11);
  assert.equal((sqlite.prepare('SELECT suppressed FROM journey_action_subject_controls').get() as any).suppressed,1);
  assert.equal((sqlite.prepare('SELECT state FROM journey_action_queue').get() as any).state,'cancelled');
  assert.equal((sqlite.prepare('SELECT state FROM journey_webhook_dispatches').get() as any).state,'failed');
  assert.deepEqual(sqlite.prepare('SELECT state,block_reason FROM journey_event_intelligence_outbox').get(),
    {state:'blocked',block_reason:'consent_denied'});
  assert.equal((sqlite.prepare('SELECT state FROM journey_stage_survey_outbox').get() as any).state,'dead_letter');
  assert.deepEqual((sqlite.prepare('SELECT operation,revision,value FROM journey_stage_intelligence_facts ORDER BY revision').all() as any[]),
    [{operation:'upsert',revision:1,value:1},{operation:'delete',revision:2,value:null}]);
  assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_actual_path_snapshots').get() as any).count,0);
  assert.deepEqual(sqlite.prepare(`SELECT source_type,operation,removed_snapshot_count,removed_rollup_count
    FROM journey_actual_path_privacy_invalidations`).get(),
    {source_type:'privacy_job',operation:'suppress',removed_snapshot_count:1,removed_rollup_count:1});
  assert.deepEqual(sqlite.prepare('SELECT state,reason,journey_definition_id,journey_map_version_id FROM journey_stage_reprojection_runs').get(),
    {state:'pending',reason:'reconcile',journey_definition_id:'journey-a',journey_map_version_id:'map-a'});
  assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_prediction_audit').get() as any).count,1);
  assert.equal(result.privacyPropagation.targets.immutable_evidence.state,'preserved_append_only');
});

test('identity corrections use the same resumable projection targets and preserve append-only history',()=>{
  const {sqlite,repo}=setup();sqlite.prepare('INSERT INTO journey_identity_correction_runs VALUES (?,?,?,?,?,?)')
    .run('correction-a','space-a','command-a',JSON.stringify([profile]),JSON.stringify({timelineEventCount:1}),at);
  for(let step=0;step<20;step+=1){const result=repo.claimNextCorrection(at);if(result?.checkpoint.status==='completed')break;}
  const stored=JSON.parse((sqlite.prepare('SELECT result_json FROM journey_identity_correction_runs').get() as any).result_json);
  assert.equal(stored.timelineEventCount,1);assert.equal(stored.privacyPropagation.status,'completed');
  assert.equal(stored.privacyPropagation.targets.immutable_evidence.state,'preserved_append_only');
  assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_actual_path_snapshots').get() as any).count,0);
  assert.deepEqual(sqlite.prepare(`SELECT source_type,operation,removed_snapshot_count,removed_rollup_count
    FROM journey_actual_path_privacy_invalidations`).get(),
    {source_type:'correction_run',operation:'correction',removed_snapshot_count:1,removed_rollup_count:1});
});

test('erasure installs fail-closed handles, stops at missing legal authority, and does not starve later jobs',()=>{
  const {sqlite,repo,subject}=setup();insertJob(sqlite,'job-erasure','erasure','2026-08-08T11:00:00.000Z');
  for(let step=0;step<20;step+=1){repo.claimNext(at);const checkpoint=repo.backlog(at);if(checkpoint.operatorRequired===1)break;}
  const erased=sqlite.prepare('SELECT * FROM journey_event_intelligence_erasure_handles ORDER BY subject_id_hmac').all() as any[];
  assert.equal(erased.some(row=>row.subject_id_hmac===subject),true);assert.doesNotMatch(JSON.stringify(erased),/job-erasure|anonymous-a/);
  const first=JSON.parse((sqlite.prepare('SELECT result_json FROM journey_profile_privacy_jobs WHERE id=?').get('job-erasure') as any).result_json);
  assert.equal(first.privacyPropagation.status,'operator_required');
  assert.equal(first.privacyPropagation.targets.raw_identity_event_erasure.code,'pseudonymous_tombstone_and_legal_hold_authority_required');
  insertJob(sqlite,'job-later','suppress','2026-08-08T13:00:00.000Z');
  for(let step=0;step<20;step+=1)repo.claimNext(at);
  assert.equal((sqlite.prepare('SELECT state FROM journey_profile_privacy_jobs WHERE id=?').get('job-later') as any).state,'completed');
  const backlog=repo.backlog(at);assert.equal(backlog.operatorRequired,1);assert.equal(backlog.queued,1);
  assert.doesNotMatch(JSON.stringify(backlog),/profile-a|anonymous-a|job-erasure/);
});

test('leased action and survey work remain fenced and checkpoint for a later non-starving pass',()=>{
  const {sqlite,repo}=setup();sqlite.prepare("UPDATE journey_action_queue SET state='leased'").run();
  sqlite.prepare("UPDATE journey_stage_survey_outbox SET state='leased'").run();insertJob(sqlite,'job-wait','suppress');
  repo.claimNext(at);const result=repo.claimNext(at);assert.equal(result?.checkpoint.status,'waiting');
  assert.equal((sqlite.prepare('SELECT state FROM journey_action_queue').get() as any).state,'leased');
  sqlite.prepare("UPDATE journey_action_queue SET state='ready'").run();
  for(let step=0;step<20;step+=1)repo.claimNext(at);
  const job=JSON.parse((sqlite.prepare('SELECT result_json FROM journey_profile_privacy_jobs').get() as any).result_json);
  assert.equal(job.privacyPropagation.targets.survey_stage_outbox.state,'waiting');
  assert.equal((sqlite.prepare('SELECT state FROM journey_stage_survey_outbox').get() as any).state,'leased');
});

test('more than one scan window of operator-held erasures cannot starve a later runnable job',()=>{
  const {sqlite,repo}=setup();const held={schema:'seemplify.journey-privacy-propagation/v1',status:'operator_required',cursor:9,
    updatedAt:at,targets:{},limitations:[]};
  const insert=sqlite.prepare(`INSERT INTO journey_profile_privacy_jobs VALUES (?,?,?,?,'queued',?, ?,NULL)`);
  for(let index=0;index<105;index+=1)insert.run(`held-${String(index).padStart(3,'0')}`,'space-a',`held-profile-${index}`,
    'erasure',JSON.stringify({privacyPropagation:held}),`2026-08-08T10:${String(index%60).padStart(2,'0')}:00.000Z`);
  insert.run('runnable-late','space-a','profile-without-bindings','suppress','{}','2026-08-08T14:00:00.000Z');
  const first=repo.claimNext(at);assert.equal(first?.jobId,'runnable-late');
  assert.equal(first?.checkpoint.cursor,1);assert.equal(repo.backlog(at).operatorRequired,105);
});

test('erasure without an authoritative source binding fails closed before claiming downstream coverage',()=>{
  const {sqlite,repo}=setup();sqlite.prepare('DELETE FROM journey_identity_bindings').run();
  sqlite.prepare(`INSERT INTO journey_profile_privacy_jobs VALUES (?,?,?,?,'queued','{}',?,NULL)`)
    .run('binding-gap','space-a',profile,'erasure',at);
  for(let step=0;step<5;step+=1)repo.claimNext(at);
  const stored=JSON.parse((sqlite.prepare('SELECT result_json FROM journey_profile_privacy_jobs WHERE id=?').get('binding-gap') as any).result_json);
  assert.equal(stored.privacyPropagation.status,'operator_required');
  assert.equal(stored.privacyPropagation.targets.event_stage_outbox.code,'subject_binding_coverage_unresolved');
  assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_event_intelligence_erasure_handles').get() as any).count,0);
});

test('externally confirmed erasure authority resumes the final raw, backup, region and legal-hold checkpoints',()=>{
  const {sqlite,repo}=setup(()=>true);insertJob(sqlite,'job-authorized','erasure');
  for(let step=0;step<20;step+=1){repo.claimNext(at);const row=sqlite.prepare('SELECT state FROM journey_profile_privacy_jobs WHERE id=?')
    .get('job-authorized') as any;if(row.state==='completed')break;}
  const row=sqlite.prepare('SELECT state,result_json FROM journey_profile_privacy_jobs WHERE id=?').get('job-authorized') as any;
  const checkpoint=JSON.parse(row.result_json).privacyPropagation;assert.equal(row.state,'completed');assert.equal(checkpoint.cursor,11);
  assert.equal(checkpoint.targets.raw_identity_event_erasure.code,'raw_erasure_external_authority_confirmed');
  assert.equal(checkpoint.targets.backup_region_legal_hold.code,'backup_region_and_legal_hold_authority_confirmed');
});
