import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { JourneyActionWorkerSafetyRepository, initializeJourneyWorkerSafetySqlite,
  type WorkerReservationPolicy } from '../src/journeyActionWorkerSafetyRepository.js';
import type { WorkerAuthority } from '../src/journeyActionWorkerDomain.js';
import type { WorkerLease } from '../src/journeyActionWorkerService.js';
import { JourneyActionWorkerService, NoContentWorkerTelemetry } from '../src/journeyActionWorkerService.js';

const at='2026-08-08T12:00:00.000Z', later='2026-08-08T12:02:00.000Z';
const profile=crypto.createHash('sha256').update('profile-a').digest('hex');
const policy:WorkerReservationPolicy={entitled:true,quotaLimit:2,frequencyLimit:1,quotaPeriodStart:'2026-08-01T00:00:00.000Z',
  quotaPeriodEnd:'2026-09-01T00:00:00.000Z',frequencyPeriodStart:'2026-08-08T00:00:00.000Z',frequencyPeriodEnd:'2026-08-09T00:00:00.000Z'};
const authority=(keyId='key-a',spaces=['space-a']):WorkerAuthority=>Object.freeze({kind:'journey_action_worker',workerIdSha256:'a'.repeat(64),
  allowedSpaceIds:spaces,allowedAdapters:['assistant_action'],issuedAt:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-09T00:00:00.000Z',keyId});

function setup(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`
  CREATE TABLE spaces(id TEXT PRIMARY KEY);
  CREATE TABLE journey_workflow_versions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,content_json TEXT NOT NULL);
  CREATE TABLE journey_workflow_definitions(id TEXT NOT NULL,space_id TEXT NOT NULL,state TEXT NOT NULL,paused INTEGER NOT NULL,PRIMARY KEY(id,space_id));
  CREATE TABLE journey_orchestration_settings(space_id TEXT PRIMARY KEY,paused INTEGER NOT NULL);
  CREATE TABLE journey_workflow_runs(id TEXT PRIMARY KEY,workflow_version_id TEXT NOT NULL,space_id TEXT NOT NULL,subject_ref_sha256 TEXT NOT NULL);
  CREATE TABLE journey_workflow_actions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,space_id TEXT NOT NULL);
  CREATE TABLE journey_action_queue(id TEXT PRIMARY KEY,action_id TEXT NOT NULL,workflow_id TEXT NOT NULL,space_id TEXT NOT NULL,adapter TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,state TEXT NOT NULL,hold_reason_code TEXT,lease_owner_sha256 TEXT,lease_token TEXT,fencing_token INTEGER NOT NULL,lease_expires_at TEXT,
    terminal_at TEXT,last_error_code TEXT,available_at TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(id,space_id));
  CREATE TABLE journey_action_effect_receipts(id TEXT PRIMARY KEY,queue_id TEXT NOT NULL UNIQUE,action_id TEXT NOT NULL,space_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,adapter TEXT NOT NULL,effect_sha256 TEXT NOT NULL,fencing_token INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE journey_adapter_effect_receipts(id TEXT PRIMARY KEY,queue_id TEXT NOT NULL UNIQUE,action_id TEXT NOT NULL UNIQUE,space_id TEXT NOT NULL,
    adapter TEXT NOT NULL,idempotency_key TEXT NOT NULL,provider_reference_sha256 TEXT NOT NULL,response_sha256 TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(space_id,idempotency_key));
  CREATE TABLE journey_adapter_execution_attempts(id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,action_id TEXT NOT NULL,space_id TEXT NOT NULL,
    adapter TEXT NOT NULL,attempt_number INTEGER NOT NULL,fencing_token INTEGER NOT NULL,outcome TEXT NOT NULL,error_code TEXT,
    request_sha256 TEXT NOT NULL,provider_receipt_sha256 TEXT,safety_json TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(queue_id,attempt_number,outcome));
  CREATE TABLE platform_usage_events(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,subscription_id TEXT,meter TEXT NOT NULL,quantity INTEGER NOT NULL,
    period_start TEXT NOT NULL,period_end TEXT NOT NULL,idempotency_key TEXT NOT NULL,intent_hash TEXT NOT NULL,source_type TEXT NOT NULL,
    source_id TEXT,actor_user_id TEXT,created_at TEXT NOT NULL,UNIQUE(space_id,meter,period_start,idempotency_key));
  CREATE TABLE platform_usage_buckets(space_id TEXT NOT NULL,meter TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(space_id,meter,period_start));
  CREATE TABLE journey_kill_switch_states(scope_level TEXT NOT NULL,space_id TEXT,scope_key TEXT NOT NULL,state TEXT NOT NULL,
    reason_code TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
  INSERT INTO spaces VALUES ('space-a'),('space-b');
  INSERT INTO journey_workflow_definitions VALUES ('workflow-a','space-a','published',0),('workflow-a','space-b','published',0);
  INSERT INTO journey_orchestration_settings VALUES ('space-a',0),('space-b',0);`);initializeJourneyWorkerSafetySqlite(db);
  const repo=new JourneyActionWorkerSafetyRepository(db,()=>policy);
  repo.provisionPrincipal({id:'principal-a',keyId:'key-a',keyRef:'kms://workers/key-a',allowedSpaceIds:['space-a'],
    allowedAdapters:['assistant_action'],notBefore:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-09T00:00:00.000Z',at});
  return {db,repo};}
function seed(db:Database.Database,id:string,space='space-a',fence=1,expires=later){const version=`version-${id}`,run=`run-${id}`,action=`action-${id}`;
  db.prepare('INSERT INTO journey_workflow_versions VALUES (?,?,?)').run(version,space,'{}');
  db.prepare('INSERT INTO journey_workflow_runs VALUES (?,?,?,?)').run(run,version,space,profile);
  db.prepare('INSERT INTO journey_workflow_actions VALUES (?,?,?)').run(action,run,space);
  db.prepare(`INSERT INTO journey_action_queue(id,action_id,workflow_id,space_id,adapter,idempotency_key,state,hold_reason_code,
    lease_owner_sha256,lease_token,fencing_token,lease_expires_at,terminal_at,last_error_code,available_at,attempt_count,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'leased',NULL,?,?,?, ?,NULL,NULL,?,0,1,?,?)`).run(id,action,'workflow-a',space,'assistant_action',
      `idem-${id}`,'a'.repeat(64),`lease-${id}`,fence,expires,at,at,at);
  db.prepare('INSERT INTO journey_action_live_contexts VALUES (?,?,?,?,?,?)').run(id,space,profile,'service-recovery','source-a',at);
  db.prepare('INSERT OR IGNORE INTO journey_action_subject_controls VALUES (?,?,?,\'granted\',0,\'UTC\',60,120,1,?)').run(space,profile,'service-recovery',at);
  db.prepare("INSERT OR IGNORE INTO journey_action_source_controls VALUES (?,'source-a','active',1,?)").run(space,at);
  return {queueId:id,spaceId:space,adapter:'assistant_action',leaseToken:`lease-${id}`,fencingToken:fence,leaseExpiresAt:expires} as WorkerLease;}

test('atomically reserves caps, replays a fence, consumes, and enforces frequency',()=>{const {db,repo}=setup();const first=seed(db,'queue-a');
  const reserved=repo.reserve({authority:authority(),lease:first,at});assert.equal(reserved.replayed,false);
  assert.equal(repo.reserve({authority:authority(),lease:first,at}).replayed,true);
  assert.equal(repo.transition({authority:authority(),lease:first,reservationId:reserved.reservationId,to:'consumed',at}).replayed,false);
  assert.equal(repo.transition({authority:authority(),lease:first,reservationId:reserved.reservationId,to:'consumed',at}).replayed,true);
  const second=seed(db,'queue-b');assert.throws(()=>repo.reserve({authority:authority(),lease:second,at}),/gate denied/i);
  assert.deepEqual(db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_frequency_counters').get(),{reserved_quantity:0,consumed_quantity:1});
});

test('expiry releases both counters and permits safe retry with a higher fence',()=>{const {db,repo}=setup();const lease=seed(db,'queue-a',undefined,1,'2026-08-08T12:01:00.000Z');
  repo.reserve({authority:authority(),lease,at});assert.equal(repo.reapExpired(later),1);assert.equal(repo.reapExpired(later),0);
  const counts=db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_quota_counters').get();assert.deepEqual(counts,{reserved_quantity:0,consumed_quantity:0});
  db.prepare("UPDATE journey_action_queue SET lease_token='lease-retry',fencing_token=2,lease_expires_at=? WHERE id='queue-a'").run('2026-08-08T12:05:00.000Z');
  const retry={...lease,leaseToken:'lease-retry',fencingToken:2,leaseExpiresAt:'2026-08-08T12:05:00.000Z'};
  assert.equal(repo.reserve({authority:authority(),lease:retry,at:later}).replayed,false);
});

test('rotation drains old claims, allows old fenced completion, and never stores key material',()=>{const {db,repo}=setup();const lease=seed(db,'queue-a');
  const reservation=repo.reserve({authority:authority(),lease,at});repo.rotatePrincipal({previousId:'principal-a',expectedRevision:1,
    nextId:'principal-b',nextKeyId:'key-b',nextKeyRef:'kms://workers/key-b',notBefore:at,expiresAt:'2026-08-10T00:00:00.000Z',at});
  assert.throws(()=>repo.reserve({authority:authority(),lease:seed(db,'queue-b'),at}),/inactive/i);
  assert.equal(repo.transition({authority:authority(),lease,reservationId:reservation.reservationId,to:'released',at}).replayed,false);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_worker_service_principals WHERE key_ref LIKE 'kms://%'").get() as any).count,2);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM journey_worker_service_key_audit').all()),/kms:\/\/|secret|credential|token/i);
});

test('tenant and adapter scopes are rechecked for reservation and completion',()=>{const {db,repo}=setup();const foreign=seed(db,'queue-b','space-b');
  assert.throws(()=>repo.reserve({authority:authority(),lease:foreign,at}),/scope denied/i);
  const lease=seed(db,'queue-a');const reservation=repo.reserve({authority:authority(),lease,at});
  const forged={...lease,spaceId:'space-b'};assert.throws(()=>repo.transition({authority:authority('key-a',['space-b']),lease:forged,
    reservationId:reservation.reservationId,to:'consumed',at}),/not found|scope/i);
});

test('bounded contention admits only the configured cap and leaves consistent counters',async()=>{const {db,repo}=setup();
  const leases=Array.from({length:25},(_,index)=>seed(db,`queue-${index}`));let admitted=0;
  await Promise.all(leases.map(async(lease)=>{try{repo.reserve({authority:authority(),lease,at});admitted+=1}catch{}}));
  assert.equal(admitted,1);const row=db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_frequency_counters').get();
  assert.deepEqual(row,{reserved_quantity:1,consumed_quantity:0});
});

test('no-effect completion atomically settles receipt, queue, reservation, and counters',()=>{const {db,repo}=setup();const lease=seed(db,'queue-a');
  const reserved=repo.reserve({authority:authority(),lease,at});const result=repo.completeReservedNoEffect({authority:authority(),lease,
    reservationId:reserved.reservationId,receiptSha256:'b'.repeat(64),at});assert.equal(result.replayed,false);
  assert.equal((db.prepare("SELECT state FROM journey_action_queue WHERE id='queue-a'").get() as any).state,'succeeded');
  assert.equal((db.prepare('SELECT state FROM journey_action_worker_reservations WHERE id=?').get(reserved.reservationId) as any).state,'consumed');
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_action_effect_receipts WHERE queue_id='queue-a'").get() as any).count,1);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM platform_usage_events WHERE source_type='journey_action_worker' AND source_id='queue-a'").get() as any).count,1);
  assert.equal((db.prepare("SELECT quantity FROM platform_usage_buckets WHERE space_id='space-a' AND meter='monthlyOrchestrationActions'").get() as any).quantity,1);
  assert.deepEqual(db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_quota_counters').get(),{reserved_quantity:0,consumed_quantity:1});
  assert.equal(repo.completeReservedNoEffect({authority:authority(),lease,reservationId:reserved.reservationId,receiptSha256:'b'.repeat(64),at}).replayed,true);
});

test('reviewed-effect completion atomically settles canonical receipt, one usage event, reservation, and effect callback',()=>{
  const {db,repo}=setup();const lease=seed(db,'queue-reviewed');const reserved=repo.reserve({authority:authority(),lease,at});
  db.exec('CREATE TABLE durable_effects(id TEXT PRIMARY KEY)');
  const input={authority:authority(),lease,reservationId:reserved.reservationId,adapter:'assistant_action',
    providerReferenceSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),requestSha256:'d'.repeat(64),at,
    applyInternalEffect:()=>{db.prepare('INSERT INTO durable_effects VALUES (?)').run('effect-a')}};
  const result=repo.completeReservedReviewedEffect(input);assert.equal(result.replayed,false);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM durable_effects').get() as any).count,1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_effect_receipts').get() as any).count,1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_execution_attempts').get() as any).count,1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM platform_usage_events').get() as any).count,1);
  assert.equal((db.prepare('SELECT state FROM journey_action_worker_reservations WHERE id=?').get(reserved.reservationId) as any).state,'consumed');
  assert.equal(repo.completeReservedReviewedEffect({...input,applyInternalEffect:()=>{throw new Error('must not replay effect')}}).replayed,true);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM durable_effects').get() as any).count,1);
  assert.throws(()=>repo.completeReservedReviewedEffect({...input,responseSha256:'e'.repeat(64)}),/disagree/i);
});

test('reviewed-effect callback failure rolls back receipt, usage, reservation, and queue',()=>{const {db,repo}=setup();
  const lease=seed(db,'queue-reviewed-fail');const reserved=repo.reserve({authority:authority(),lease,at});
  assert.throws(()=>repo.completeReservedReviewedEffect({authority:authority(),lease,reservationId:reserved.reservationId,
    adapter:'assistant_action',providerReferenceSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),requestSha256:'d'.repeat(64),at,
    applyInternalEffect:()=>{throw new Error('injected internal failure')}}),/injected internal failure/);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_effect_receipts').get() as any).count,0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM platform_usage_events').get() as any).count,0);
  assert.equal((db.prepare('SELECT state FROM journey_action_worker_reservations WHERE id=?').get(reserved.reservationId) as any).state,'reserved');
  assert.equal((db.prepare("SELECT state FROM journey_action_queue WHERE id='queue-reviewed-fail'").get() as any).state,'leased');
});

test('hold and failure atomically release capacity, clear leases, and advance fences',()=>{const {db,repo}=setup();const held=seed(db,'queue-a');
  const heldReservation=repo.reserve({authority:authority(),lease:held,at});repo.holdReservedLease({authority:authority(),lease:held,
    reservationId:heldReservation.reservationId,reasonCode:'CONSENT_DENIED',at});
  assert.deepEqual(db.prepare("SELECT state,fencing_token,hold_reason_code FROM journey_action_queue WHERE id='queue-a'").get(),
    {state:'held',fencing_token:2,hold_reason_code:'CONSENT_DENIED'});
  const failed=seed(db,'queue-b');const failedReservation=repo.reserve({authority:authority(),lease:failed,at});
  repo.failReservedLease({authority:authority(),lease:failed,reservationId:failedReservation.reservationId,errorCode:'DRY_RUN_FAILURE',at});
  assert.deepEqual(db.prepare("SELECT state,fencing_token,last_error_code FROM journey_action_queue WHERE id='queue-b'").get(),
    {state:'retry_scheduled',fencing_token:2,last_error_code:'DRY_RUN_FAILURE'});
  assert.deepEqual(db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_quota_counters').get(),{reserved_quantity:0,consumed_quantity:0});
});

test('queue transition failure rolls back receipt, reservation, counters, and event',()=>{const {db,repo}=setup();const lease=seed(db,'queue-a');
  const reserved=repo.reserve({authority:authority(),lease,at});db.exec(`CREATE TRIGGER reject_queue_completion BEFORE UPDATE ON journey_action_queue
    WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'injected queue failure');END;`);
  assert.throws(()=>repo.completeReservedNoEffect({authority:authority(),lease,reservationId:reserved.reservationId,
    receiptSha256:'b'.repeat(64),at}),/injected queue failure/);
  assert.equal((db.prepare('SELECT state FROM journey_action_worker_reservations WHERE id=?').get(reserved.reservationId) as any).state,'reserved');
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_action_effect_receipts').get() as any).count,0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM platform_usage_events').get() as any).count,0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM platform_usage_buckets').get() as any).count,0);
  assert.deepEqual(db.prepare('SELECT reserved_quantity,consumed_quantity FROM journey_action_quota_counters').get(),{reserved_quantity:1,consumed_quantity:0});
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_action_worker_reservation_events WHERE event='consumed'").get() as any).count,0);
});

test('pre-existing canonical usage is included in atomic reservation admission',()=>{const {db}=setup();const lease=seed(db,'queue-a');
  const repo=new JourneyActionWorkerSafetyRepository(db,()=>({...policy,canonicalQuotaUsed:2,frequencyLimit:10}));
  assert.throws(()=>repo.reserve({authority:authority(),lease,at}),/gate denied/i);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_action_worker_reservations').get() as any).count,0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_action_quota_counters').get() as any).count,0);
});

test('successful settlement reconciles a drifted usage bucket from the immutable ledger',()=>{const {db}=setup();const lease=seed(db,'queue-a');
  db.prepare(`INSERT INTO platform_usage_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('prior','space-a',null,'monthlyOrchestrationActions',1,
    policy.quotaPeriodStart,policy.quotaPeriodEnd,'prior', 'c'.repeat(64),'prior_source','prior',null,at);
  db.prepare(`INSERT INTO platform_usage_buckets VALUES (?,?,?,?,?,?)`).run('space-a','monthlyOrchestrationActions',policy.quotaPeriodStart,
    policy.quotaPeriodEnd,0,at);
  const repo=new JourneyActionWorkerSafetyRepository(db,()=>({...policy,canonicalQuotaUsed:1,frequencyLimit:10}));
  const reserved=repo.reserve({authority:authority(),lease,at});repo.completeReservedNoEffect({authority:authority(),lease,
    reservationId:reserved.reservationId,receiptSha256:'d'.repeat(64),at});
  assert.equal((db.prepare("SELECT quantity FROM platform_usage_buckets WHERE space_id='space-a' AND meter='monthlyOrchestrationActions'").get() as any).quantity,2);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM platform_usage_events WHERE space_id='space-a'").get() as any).count,2);
});

test('real durable worker path claims, reserves, rechecks, and completes through one repository',async()=>{const {db,repo}=setup();seed(db,'queue-a');
  db.prepare("UPDATE journey_action_queue SET state='ready',lease_owner_sha256=NULL,lease_token=NULL,lease_expires_at=NULL,fencing_token=0 WHERE id='queue-a'").run();
  const service=new JourneyActionWorkerService(repo,new NoContentWorkerTelemetry(),()=>new Date(at),{mode:'durable',safety:repo});
  const lease=await service.claim(authority());assert.ok(lease?.reservationId);await service.completeNoEffect(authority(),lease!);
  assert.equal((db.prepare("SELECT state FROM journey_action_queue WHERE id='queue-a'").get() as any).state,'succeeded');
  assert.equal((db.prepare('SELECT state FROM journey_action_worker_reservations WHERE id=?').get(lease!.reservationId) as any).state,'consumed');
});
