import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { publicSubscriptionPlan } from './subscriptionEntitlements.js';
import { resolveJourneyWorkerGates, type WorkerAuthority } from './journeyActionWorkerDomain.js';
import type { JourneyActionWorkerRepository, JourneyActionWorkerSafetyLifecycle, WorkerLease,
  WorkerQueueItem } from './journeyActionWorkerService.js';

import {
  assertContentFreeKeyMetadata, buildSafetyAuditDetail, JourneyActionWorkerSafetyError,
  resolveServicePrincipalSecret, workerServiceKeyRefPattern, workerServiceTokenPattern,
  type WorkerKeySecretResolver
} from './journeyActionWorkerSafetyDomain.js';

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
const token = workerServiceTokenPattern;
const keyRef = workerServiceKeyRefPattern;
const reviewedAdapters = new Set(['survey_invitation','service_recovery_ticket','assistant_action','internal_notification','signed_webhook']);
export class JourneyWorkerSafetyError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 409) { super(message); this.name = 'JourneyWorkerSafetyError'; }
}

/** Domain refusals surface as the single error type this repository's callers already handle. */
function adopt<Result>(run: () => Result): Result {
  try { return run(); } catch (error) {
    if (error instanceof JourneyActionWorkerSafetyError) throw new JourneyWorkerSafetyError(error.message, error.code, error.status);
    throw error;
  }
}

/** SQLite parity for the standalone runtime-42 contract. It never stores key material. */
export function initializeJourneyWorkerSafetySqlite(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_worker_service_principals(id TEXT PRIMARY KEY,key_id TEXT NOT NULL UNIQUE,
      key_ref TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('active','draining','revoked')),
      allowed_space_ids_json TEXT NOT NULL CHECK(json_valid(allowed_space_ids_json)),allowed_adapters_json TEXT NOT NULL CHECK(json_valid(allowed_adapters_json)),
      not_before TEXT NOT NULL,expires_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journey_worker_service_key_audit(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,action TEXT NOT NULL,
      previous_key_id_sha256 TEXT,resulting_key_id_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
      detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(principal_id) REFERENCES journey_worker_service_principals(id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_action_live_contexts(queue_id TEXT PRIMARY KEY,space_id TEXT NOT NULL,profile_ref_sha256 TEXT NOT NULL,
      purpose_key TEXT NOT NULL,source_key TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_action_subject_controls(space_id TEXT NOT NULL,profile_ref_sha256 TEXT NOT NULL,purpose_key TEXT NOT NULL,
      consent_state TEXT NOT NULL CHECK(consent_state IN ('granted','denied','unknown')),suppressed INTEGER NOT NULL CHECK(suppressed IN (0,1)),
      quiet_timezone TEXT NOT NULL,quiet_start_minute INTEGER NOT NULL CHECK(quiet_start_minute BETWEEN 0 AND 1439),quiet_end_minute INTEGER NOT NULL CHECK(quiet_end_minute BETWEEN 0 AND 1439),
      revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(space_id,profile_ref_sha256,purpose_key));
    CREATE TABLE IF NOT EXISTS journey_action_source_controls(space_id TEXT NOT NULL,source_key TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','paused','retired','unknown')),
      revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(space_id,source_key));
    CREATE TABLE IF NOT EXISTS journey_action_quota_counters(space_id TEXT NOT NULL,meter TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,
      reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0),updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,meter,period_start));
    CREATE TABLE IF NOT EXISTS journey_action_frequency_counters(space_id TEXT NOT NULL,profile_ref_sha256 TEXT NOT NULL,purpose_key TEXT NOT NULL,
      period_start TEXT NOT NULL,period_end TEXT NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
      consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0),updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,profile_ref_sha256,purpose_key,period_start));
    CREATE TABLE IF NOT EXISTS journey_action_worker_reservations(id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,space_id TEXT NOT NULL,
      profile_ref_sha256 TEXT NOT NULL,purpose_key TEXT NOT NULL,meter TEXT NOT NULL,quota_period_start TEXT NOT NULL,quota_period_end TEXT NOT NULL,
      frequency_period_start TEXT NOT NULL,frequency_period_end TEXT NOT NULL,quantity INTEGER NOT NULL,quota_limit_snapshot INTEGER NOT NULL,
      frequency_limit_snapshot INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released','expired')),
      fencing_token INTEGER NOT NULL,lease_token_sha256 TEXT NOT NULL,lease_expires_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
      UNIQUE(queue_id,fencing_token));
    CREATE UNIQUE INDEX IF NOT EXISTS journey_action_worker_reservation_active ON journey_action_worker_reservations(queue_id) WHERE state='reserved';
    CREATE INDEX IF NOT EXISTS journey_action_worker_reservations_reap ON journey_action_worker_reservations(state,lease_expires_at,space_id,queue_id);
    CREATE TABLE IF NOT EXISTS journey_action_worker_reservation_events(id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL,queue_id TEXT NOT NULL,
      space_id TEXT NOT NULL,event TEXT NOT NULL CHECK(event IN ('reserved','consumed','released','expired')),fencing_token INTEGER NOT NULL,
      detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(reservation_id) REFERENCES journey_action_worker_reservations(id) ON DELETE NO ACTION);
    CREATE TRIGGER IF NOT EXISTS journey_worker_service_key_audit_update_guard BEFORE UPDATE ON journey_worker_service_key_audit BEGIN SELECT RAISE(ABORT,'append-only');END;
    CREATE TRIGGER IF NOT EXISTS journey_worker_service_key_audit_delete_guard BEFORE DELETE ON journey_worker_service_key_audit BEGIN SELECT RAISE(ABORT,'append-only');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_live_contexts_update_guard BEFORE UPDATE ON journey_action_live_contexts BEGIN SELECT RAISE(ABORT,'append-only');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_live_contexts_delete_guard BEFORE DELETE ON journey_action_live_contexts BEGIN SELECT RAISE(ABORT,'append-only');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_worker_reservation_events_update_guard BEFORE UPDATE ON journey_action_worker_reservation_events BEGIN SELECT RAISE(ABORT,'append-only');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_worker_reservation_events_delete_guard BEFORE DELETE ON journey_action_worker_reservation_events BEGIN SELECT RAISE(ABORT,'append-only');END;
  `);
  // Parity for the runtime-42 PostgreSQL guards. Both engines refuse the same
  // rewinds, so SQLite is not the lenient copy that quietly proves less.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS journey_worker_service_principals_lifecycle_guard
      BEFORE UPDATE ON journey_worker_service_principals
      WHEN NEW.id<>OLD.id OR NEW.key_id<>OLD.key_id OR NEW.key_ref<>OLD.key_ref OR NEW.created_at<>OLD.created_at
        OR OLD.state='revoked'
        OR NOT ((OLD.state='active' AND NEW.state IN ('active','draining','revoked'))
          OR (OLD.state='draining' AND NEW.state IN ('draining','revoked')))
        OR NEW.revision<OLD.revision OR (NEW.state<>OLD.state AND NEW.revision<>OLD.revision+1)
      BEGIN SELECT RAISE(ABORT,'service principal lifecycle');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_worker_reservations_fence_insert_guard
      BEFORE INSERT ON journey_action_worker_reservations
      WHEN NEW.state<>'reserved' OR NEW.fencing_token<1 OR NEW.quantity<1
        OR EXISTS (SELECT 1 FROM journey_action_worker_reservations existing
          WHERE existing.space_id=NEW.space_id AND existing.queue_id=NEW.queue_id
            AND existing.fencing_token>=NEW.fencing_token)
      BEGIN SELECT RAISE(ABORT,'reservation fence');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_worker_reservations_settlement_guard
      BEFORE UPDATE ON journey_action_worker_reservations
      WHEN NEW.id<>OLD.id OR NEW.queue_id<>OLD.queue_id OR NEW.space_id<>OLD.space_id
        OR NEW.fencing_token<>OLD.fencing_token OR NEW.lease_token_sha256<>OLD.lease_token_sha256
        OR NEW.profile_ref_sha256<>OLD.profile_ref_sha256 OR NEW.purpose_key<>OLD.purpose_key
        OR NEW.meter<>OLD.meter OR NEW.quantity<>OLD.quantity OR NEW.created_at<>OLD.created_at
        OR NEW.quota_period_start<>OLD.quota_period_start
        OR NEW.frequency_period_start<>OLD.frequency_period_start
        OR OLD.state<>'reserved' OR NEW.state NOT IN ('consumed','released','expired')
        OR NEW.revision<>OLD.revision+1
      BEGIN SELECT RAISE(ABORT,'reservation settlement');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_quota_counters_monotonic_guard
      BEFORE UPDATE ON journey_action_quota_counters
      WHEN NEW.space_id<>OLD.space_id OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end
        OR NEW.consumed_quantity<OLD.consumed_quantity
      BEGIN SELECT RAISE(ABORT,'safety counter');END;
    CREATE TRIGGER IF NOT EXISTS journey_action_frequency_counters_monotonic_guard
      BEFORE UPDATE ON journey_action_frequency_counters
      WHEN NEW.space_id<>OLD.space_id OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end
        OR NEW.consumed_quantity<OLD.consumed_quantity
      BEGIN SELECT RAISE(ABORT,'safety counter');END;
    CREATE INDEX IF NOT EXISTS journey_worker_service_principals_state
      ON journey_worker_service_principals(state,not_before,expires_at,key_id);
    CREATE INDEX IF NOT EXISTS journey_worker_service_key_audit_history
      ON journey_worker_service_key_audit(principal_id,created_at,id);
    CREATE INDEX IF NOT EXISTS journey_action_live_context_subject
      ON journey_action_live_contexts(space_id,profile_ref_sha256,purpose_key,queue_id);
    CREATE INDEX IF NOT EXISTS journey_action_worker_reservation_events_history
      ON journey_action_worker_reservation_events(space_id,queue_id,created_at,id);
  `);
  // Receipt tables are optional in standalone fixtures. When present, either
  // canonical terminal receipt prevents a new reservation.
  const receipts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='journey_action_effect_receipts'").get();
  const reviewedReceipts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='journey_adapter_effect_receipts'").get();
  if (receipts || reviewedReceipts) db.exec(`
    CREATE TRIGGER IF NOT EXISTS journey_action_worker_reservations_no_redispatch_guard
      BEFORE INSERT ON journey_action_worker_reservations
      WHEN ${receipts ? `EXISTS (SELECT 1 FROM journey_action_effect_receipts receipt
        WHERE receipt.queue_id=NEW.queue_id AND receipt.space_id=NEW.space_id)` : '0'}
        OR ${reviewedReceipts ? `EXISTS (SELECT 1 FROM journey_adapter_effect_receipts receipt
        WHERE receipt.queue_id=NEW.queue_id AND receipt.space_id=NEW.space_id)` : '0'}
      BEGIN SELECT RAISE(ABORT,'settled action');END;`);
}

export type WorkerReservationPolicy = Readonly<{ entitled: boolean; quotaLimit: number; canonicalQuotaUsed?: number;
  subscriptionId?: string|null; frequencyLimit: number;
  quotaPeriodStart: string; quotaPeriodEnd: string; frequencyPeriodStart: string; frequencyPeriodEnd: string }>;
export type WorkerReservationPolicyResolver = (input: { spaceId: string; workflowId: string; adapter: string;
  purposeKey: string; profileRefSha256: string; at: string }) => WorkerReservationPolicy;

export function productionJourneyWorkerPolicyResolver(db:DatabaseRuntime):WorkerReservationPolicyResolver{return(input)=>{
  const definition=db.prepare(`SELECT v.content_json FROM journey_workflow_definitions w JOIN journey_workflow_versions v
    ON v.id=w.current_version_id AND v.workflow_id=w.id AND v.space_id=w.space_id WHERE w.id=? AND w.space_id=? AND w.state='published'`)
    .get(input.workflowId,input.spaceId) as any;let content:any={};try{content=typeof definition?.content_json==='string'?JSON.parse(definition.content_json):definition?.content_json||{}}catch{content={}};
  const cap=content?.automationPolicy?.mode==='bounded_automatic'?Number(content.automationPolicy.maximumActionsPerSubjectPerDay):0;
  const subscription=db.prepare(db.provider==='postgres'
    ? 'SELECT id,plan_code,status FROM journey_worker_subscription_snapshot(?)'
    : 'SELECT id,plan_code,status FROM platform_subscriptions WHERE space_id=?')
    .get(input.spaceId) as any;
  const plan=subscription?.status==='active'?publicSubscriptionPlan(String(subscription.plan_code)):
    subscription?publicSubscriptionPlan('starter'):publicSubscriptionPlan('enterprise');
  if(!plan)throw new JourneyWorkerSafetyError('The managed subscription plan is unavailable.','SUBSCRIPTION_PLAN_INVALID',503);
  const instant=new Date(input.at);const quotaStart=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),1));
  const quotaEnd=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth()+1,1));const frequencyStart=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),instant.getUTCDate()));
  const frequencyEnd=new Date(frequencyStart.getTime()+86_400_000);const periodStart=quotaStart.toISOString();
  const canonical=db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyOrchestrationActions' AND period_start=?`)
    .get(input.spaceId,periodStart) as any;
  return {entitled:Boolean(plan.features.journeyOrchestration),quotaLimit:Number(plan.limits.monthlyOrchestrationActions||0),
    canonicalQuotaUsed:Number(canonical?.quantity||0),subscriptionId:subscription?.id?String(subscription.id):null,
    frequencyLimit:Number.isSafeInteger(cap)&&cap>0?cap:0,
    quotaPeriodStart:quotaStart.toISOString(),quotaPeriodEnd:quotaEnd.toISOString(),frequencyPeriodStart:frequencyStart.toISOString(),frequencyPeriodEnd:frequencyEnd.toISOString()};};}

export class JourneyActionWorkerSafetyRepository implements JourneyActionWorkerSafetyLifecycle, JourneyActionWorkerRepository {
  constructor(private readonly db: Database.Database | DatabaseRuntime, private readonly resolvePolicy: WorkerReservationPolicyResolver,
    private readonly secretResolver?: WorkerKeySecretResolver) {}

  /**
   * The only path from stored metadata to signing material. Nothing usable is
   * persisted, so the material has to come from the operator's KMS or vault on
   * every call and is verified against the reference that was approved.
   */
  async resolveSecretForKeyId(input: { keyId: string; at: string }): Promise<string> {
    const resolver = this.secretResolver;
    if (!resolver) throw new JourneyWorkerSafetyError(
      'No external key resolver is configured.', 'WORKER_KEY_RESOLVER_UNCONFIGURED', 503);
    const row = this.db.prepare('SELECT * FROM journey_worker_service_principals WHERE key_id=?').get(input.keyId) as any;
    if (!row) throw new JourneyWorkerSafetyError('Service principal is inactive.', 'WORKER_PRINCIPAL_INACTIVE', 403);
    const metadata = adopt(() => assertContentFreeKeyMetadata({ principalId: String(row.id), keyId: String(row.key_id),
      keyRef: String(row.key_ref), state: String(row.state) as 'active'|'draining'|'revoked',
      notBefore: String(row.not_before), expiresAt: String(row.expires_at), revision: Number(row.revision) }));
    // A resolver refusal is deliberately not audited here: the runtime-42 audit
    // vocabulary describes key lifecycle, and forcing a failure into one of its
    // actions would make the history claim something that did not happen.
    try {
      return await resolveServicePrincipalSecret({ metadata, resolver, now: input.at });
    } catch (error) {
      if (error instanceof JourneyActionWorkerSafetyError) {
        throw new JourneyWorkerSafetyError(error.message, error.code, error.status);
      }
      throw error;
    }
  }

  provisionPrincipal(input: { id: string; keyId: string; keyRef: string; allowedSpaceIds: string[];
    allowedAdapters: string[]; notBefore: string; expiresAt: string; at: string }): void {
    adopt(() => assertContentFreeKeyMetadata({ principalId: input.id, keyId: input.keyId, keyRef: input.keyRef,
      notBefore: input.notBefore, expiresAt: input.expiresAt }));
    if (!token.test(input.id) || !token.test(input.keyId) || !keyRef.test(input.keyRef) || !input.allowedSpaceIds.length
      || input.allowedSpaceIds.length>100 || new Set(input.allowedSpaceIds).size!==input.allowedSpaceIds.length
      || input.allowedSpaceIds.some((value)=>!token.test(value)) || !input.allowedAdapters.length
      || input.allowedAdapters.length>reviewedAdapters.size || new Set(input.allowedAdapters).size!==input.allowedAdapters.length
      || input.allowedAdapters.some((value)=>!reviewedAdapters.has(value))
      || Date.parse(input.expiresAt) <= Date.parse(input.notBefore)) throw new JourneyWorkerSafetyError(
        'Service principal metadata is invalid.', 'WORKER_PRINCIPAL_INVALID', 400);
    this.transact(() => {
      this.db.prepare(`INSERT INTO journey_worker_service_principals(id,key_id,key_ref,state,allowed_space_ids_json,allowed_adapters_json,
        not_before,expires_at,revision,created_at,updated_at) VALUES (?,?,?,'active',?,?,?,?,1,?,?)`).run(input.id,input.keyId,input.keyRef,
        json(input.allowedSpaceIds),json(input.allowedAdapters),input.notBefore,input.expiresAt,input.at,input.at);
      this.keyAudit(input.id,'provisioned',null,input.keyId,1,input.at);
    });
  }

  rotatePrincipal(input: { previousId: string; expectedRevision: number; nextId: string; nextKeyId: string; nextKeyRef: string;
    notBefore: string; expiresAt: string; at: string }): void {
    this.transact(() => {
      const old = this.db.prepare('SELECT * FROM journey_worker_service_principals WHERE id=?').get(input.previousId) as any;
      if (!old || old.state !== 'active' || Number(old.revision) !== input.expectedRevision) throw new JourneyWorkerSafetyError(
        'Service principal rotation conflict.', 'WORKER_PRINCIPAL_ROTATION_CONFLICT');
      adopt(()=>assertContentFreeKeyMetadata({principalId:input.nextId,keyId:input.nextKeyId,keyRef:input.nextKeyRef,
        notBefore:input.notBefore,expiresAt:input.expiresAt}));
      if(!token.test(input.nextId)||!token.test(input.nextKeyId)||!keyRef.test(input.nextKeyRef)
        ||Date.parse(input.expiresAt)<=Date.parse(input.notBefore))throw new JourneyWorkerSafetyError(
          'Replacement principal metadata is invalid.','WORKER_PRINCIPAL_INVALID',400);
      const changed=this.db.prepare("UPDATE journey_worker_service_principals SET state='draining',revision=revision+1,updated_at=? WHERE id=? AND revision=?")
        .run(input.at,input.previousId,input.expectedRevision).changes;
      if(!changed)throw new JourneyWorkerSafetyError('Service principal rotation conflict.','WORKER_PRINCIPAL_ROTATION_CONFLICT');
      this.db.prepare(`INSERT INTO journey_worker_service_principals(id,key_id,key_ref,state,allowed_space_ids_json,allowed_adapters_json,
        not_before,expires_at,revision,created_at,updated_at) VALUES (?,?,?,'active',?,?,?,?,1,?,?)`).run(input.nextId,input.nextKeyId,input.nextKeyRef,
        json(this.arrayValue(old.allowed_space_ids_json)),json(this.arrayValue(old.allowed_adapters_json)),input.notBefore,input.expiresAt,input.at,input.at);
      this.keyAudit(input.previousId,'draining',old.key_id,old.key_id,input.expectedRevision+1,input.at);
      this.keyAudit(input.nextId,'rotated',old.key_id,input.nextKeyId,1,input.at);
    });
  }

  revokePrincipal(input:{id:string;expectedRevision:number;at:string}):void{
    this.transact(()=>{const row=this.db.prepare('SELECT * FROM journey_worker_service_principals WHERE id=?').get(input.id) as any;
      if(!row||Number(row.revision)!==input.expectedRevision)throw new JourneyWorkerSafetyError('Service principal revision conflict.','WORKER_PRINCIPAL_REVISION_CONFLICT');
      this.db.prepare("UPDATE journey_worker_service_principals SET state='revoked',revision=revision+1,updated_at=? WHERE id=? AND revision=?")
      .run(input.at,input.id,input.expectedRevision);this.keyAudit(input.id,'revoked',row.key_id,row.key_id,input.expectedRevision+1,input.at)});
  }

  async claimCandidate(input:{authority:WorkerAuthority;now:string;leaseExpiresAt:string}):Promise<WorkerQueueItem|null>{return this.transact(()=>{
    const principal=this.principal(input.authority,input.now,true);const storedSpaces=this.arrayValue(principal.allowed_space_ids_json);
    const storedAdapters=this.arrayValue(principal.allowed_adapters_json);const spaces=input.authority.allowedSpaceIds.filter((value)=>storedSpaces.includes(value));
    const adapters=input.authority.allowedAdapters.filter((value)=>storedAdapters.includes(value));if(!spaces.length||!adapters.length)return null;
    const marks=(values:readonly unknown[])=>values.map(()=>'?').join(',');const lock='provider'in this.db&&this.db.provider==='postgres'?' FOR UPDATE OF q SKIP LOCKED':'';
    const candidate=this.db.prepare(`SELECT q.* FROM journey_action_queue q JOIN journey_workflow_definitions w ON w.id=q.workflow_id AND w.space_id=q.space_id
      JOIN journey_orchestration_settings s ON s.space_id=q.space_id WHERE q.space_id IN (${marks(spaces)}) AND q.adapter IN (${marks(adapters)})
      AND w.state='published' AND w.paused=FALSE AND s.paused=FALSE AND ((q.state IN ('ready','retry_scheduled') AND q.available_at<=?)
      OR(q.state='leased' AND q.lease_expires_at<=?)) ORDER BY q.available_at,q.created_at,q.id LIMIT 1${lock}`)
      .get(...spaces,...adapters,input.now,input.now) as any;if(!candidate)return null;if(!('provider'in this.db&&this.db.provider==='postgres'))this.lockSpace(candidate.space_id);
    const leaseToken=crypto.randomUUID(),fence=Number(candidate.fencing_token)+1;const changed=this.db.prepare(`UPDATE journey_action_queue SET state='leased',hold_reason_code=NULL,
      lease_owner_sha256=?,lease_token=?,fencing_token=?,lease_expires_at=?,attempt_count=attempt_count+1,revision=revision+1,updated_at=? WHERE id=? AND space_id=?
      AND revision=? AND ((state IN ('ready','retry_scheduled') AND available_at<=?) OR(state='leased' AND lease_expires_at<=?))`)
      .run(input.authority.workerIdSha256,leaseToken,fence,input.leaseExpiresAt,input.now,candidate.id,candidate.space_id,candidate.revision,input.now,input.now).changes;
    if(changed!==1)return null;return this.queueView(this.db.prepare('SELECT * FROM journey_action_queue WHERE id=? AND space_id=?').get(candidate.id,candidate.space_id) as any);
  });}

  async readLiveFacts(input:{authority:WorkerAuthority;queueId:string;now:string}){const queue=this.db.prepare(`SELECT q.*,r.subject_ref_sha256 FROM journey_action_queue q
    JOIN journey_workflow_actions a ON a.id=q.action_id AND a.space_id=q.space_id JOIN journey_workflow_runs r ON r.id=a.run_id AND r.space_id=a.space_id WHERE q.id=?`)
    .get(input.queueId) as any;if(!queue)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);
    const principal=this.principal(input.authority,input.now,false);this.assertScope(principal,input.authority,queue.space_id,queue.adapter);
    const live=this.liveFacts(queue,input.now);return {item:this.queueView(queue),facts:live};}

  async holdLease(input:{authority:WorkerAuthority;lease:WorkerLease;reasonCode:string;now:string}){this.transact(()=>{this.lockSpace(input.lease.spaceId);
    const principal=this.principal(input.authority,input.now,false);const row=this.db.prepare('SELECT * FROM journey_action_queue WHERE id=? AND space_id=?').get(input.lease.queueId,input.lease.spaceId) as any;
    if(!row)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);this.assertScope(principal,input.authority,row.space_id,row.adapter);
    const changed=this.db.prepare(`UPDATE journey_action_queue SET state='held',hold_reason_code=?,lease_owner_sha256=NULL,lease_token=NULL,lease_expires_at=NULL,
      fencing_token=fencing_token+1,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`)
      .run(input.reasonCode,input.now,row.id,row.space_id,input.lease.leaseToken,input.lease.fencingToken).changes;
    if(changed!==1)throw new JourneyWorkerSafetyError('Lease is stale.','WORKER_STALE_FENCE');});}
  async completeNoEffect():Promise<{replayed:boolean}>{throw new JourneyWorkerSafetyError('Durable reservation is required.','WORKER_RESERVATION_REQUIRED',500);}
  async failLease():Promise<void>{throw new JourneyWorkerSafetyError('Durable reservation is required.','WORKER_RESERVATION_REQUIRED',500);}
  async listHeld(input:{authority:WorkerAuthority;limit:number}){const principal=this.principal(input.authority,new Date().toISOString(),false);
    const spaces=input.authority.allowedSpaceIds.filter((value)=>this.arrayValue(principal.allowed_space_ids_json).includes(value));if(!spaces.length)return [];
    return (this.db.prepare(`SELECT * FROM journey_action_queue WHERE state='held' AND space_id IN (${spaces.map(()=>'?').join(',')}) ORDER BY updated_at,id LIMIT ?`)
      .all(...spaces,input.limit) as any[]).filter((row)=>input.authority.allowedAdapters.includes(row.adapter)).map((row)=>this.queueView(row));}
  async releaseHeld(input:{authority:WorkerAuthority;queueId:string;expectedRevision:number;now:string}){return this.transact(()=>{const row=this.db.prepare(
    'SELECT * FROM journey_action_queue WHERE id=?').get(input.queueId) as any;if(!row)return false;this.lockSpace(row.space_id);const principal=this.principal(input.authority,input.now,false);
    this.assertScope(principal,input.authority,row.space_id,row.adapter);return this.db.prepare(`UPDATE journey_action_queue SET state='ready',hold_reason_code=NULL,
      available_at=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='held' AND revision=?`).run(input.now,input.now,row.id,row.space_id,input.expectedRevision).changes===1;});}

  reserve(input: { authority: WorkerAuthority; lease: WorkerLease; at: string }): { reservationId: string; replayed: boolean } {
    return this.transact(() => {
      this.lockSpace(input.lease.spaceId);
      const principal=this.principal(input.authority,input.at,true);
      const queue=this.db.prepare(`SELECT q.*,r.subject_ref_sha256,v.content_json FROM journey_action_queue q
        JOIN journey_workflow_actions a ON a.id=q.action_id AND a.space_id=q.space_id
        JOIN journey_workflow_runs r ON r.id=a.run_id AND r.space_id=a.space_id
        JOIN journey_workflow_versions v ON v.id=r.workflow_version_id AND v.space_id=r.space_id
        WHERE q.id=? AND q.space_id=?`).get(input.lease.queueId,input.lease.spaceId) as any;
      if(!queue||queue.state!=='leased'||queue.lease_token!==input.lease.leaseToken||Number(queue.fencing_token)!==input.lease.fencingToken
        ||Date.parse(queue.lease_expires_at)<=Date.parse(input.at))throw new JourneyWorkerSafetyError('Lease is stale.','WORKER_STALE_FENCE');
      this.assertScope(principal,input.authority,queue.space_id,queue.adapter);
      const replay=this.db.prepare('SELECT id,state,lease_token_sha256 FROM journey_action_worker_reservations WHERE queue_id=? AND fencing_token=?')
        .get(queue.id,input.lease.fencingToken) as any;
      if(replay){if(replay.lease_token_sha256!==sha(input.lease.leaseToken))throw new JourneyWorkerSafetyError('Reservation intent conflict.','WORKER_RESERVATION_CONFLICT');
        return {reservationId:replay.id,replayed:true};}
      const context=this.db.prepare('SELECT * FROM journey_action_live_contexts WHERE queue_id=? AND space_id=?').get(queue.id,queue.space_id) as any;
      if(!context||context.profile_ref_sha256!==queue.subject_ref_sha256)throw new JourneyWorkerSafetyError('Live context is unavailable.','WORKER_LIVE_CONTEXT_UNKNOWN');
      const subject=this.db.prepare(`SELECT * FROM journey_action_subject_controls WHERE space_id=? AND profile_ref_sha256=? AND purpose_key=?`)
        .get(queue.space_id,context.profile_ref_sha256,context.purpose_key) as any;
      const source=this.db.prepare('SELECT * FROM journey_action_source_controls WHERE space_id=? AND source_key=?').get(queue.space_id,context.source_key) as any;
      const switches=(this.db.prepare(`SELECT scope_level AS level,scope_key AS "scopeRef",state,reason_code AS "reasonCode",revision,updated_at AS "updatedAt"
        FROM journey_kill_switch_states WHERE (scope_level='platform' AND space_id IS NULL) OR space_id=?`).all(queue.space_id) as any[]);
      const policy=this.resolvePolicy({spaceId:queue.space_id,workflowId:queue.workflow_id,adapter:queue.adapter,purposeKey:context.purpose_key,
        profileRefSha256:context.profile_ref_sha256,at:input.at});
      const quota=this.counter('journey_action_quota_counters',['space_id','meter','period_start'],[queue.space_id,'monthlyOrchestrationActions',policy.quotaPeriodStart]);
      const frequency=this.counter('journey_action_frequency_counters',['space_id','profile_ref_sha256','purpose_key','period_start'],
        [queue.space_id,context.profile_ref_sha256,context.purpose_key,policy.frequencyPeriodStart]);
      const resolved=resolveJourneyWorkerGates({consent:subject?.consent_state||'unknown',suppressed:subject?Boolean(subject.suppressed):null,
        entitled:policy.entitled,quota:{used:Number(policy.canonicalQuotaUsed??quota?.consumed_quantity??0),reserved:Number(quota?.reserved_quantity||0),limit:policy.quotaLimit},
        quietHours:subject?{timezone:subject.quiet_timezone,startMinute:Number(subject.quiet_start_minute),endMinute:Number(subject.quiet_end_minute)}:null,
        frequency:{observed:Number(frequency?.consumed_quantity||0)+Number(frequency?.reserved_quantity||0),maximum:policy.frequencyLimit,
          windowEndsAt:policy.frequencyPeriodEnd},sourceState:source?.state||'unknown',killSwitchScope:{spaceId:queue.space_id,workflowId:queue.workflow_id,
          adapter:queue.adapter,profileId:context.profile_ref_sha256},killSwitchRecords:switches},input.at);
      if(resolved.decision!=='allow')throw new JourneyWorkerSafetyError('Live reservation gate denied.',resolved.reasonCode);
      this.upsertCounter('journey_action_quota_counters',['space_id','meter','period_start','period_end'],
        [queue.space_id,'monthlyOrchestrationActions',policy.quotaPeriodStart,policy.quotaPeriodEnd],input.at);
      this.upsertCounter('journey_action_frequency_counters',['space_id','profile_ref_sha256','purpose_key','period_start','period_end'],
        [queue.space_id,context.profile_ref_sha256,context.purpose_key,policy.frequencyPeriodStart,policy.frequencyPeriodEnd],input.at);
      const id=crypto.randomUUID();this.db.prepare(`INSERT INTO journey_action_worker_reservations(id,queue_id,space_id,profile_ref_sha256,purpose_key,meter,
        quota_period_start,quota_period_end,frequency_period_start,frequency_period_end,quantity,quota_limit_snapshot,frequency_limit_snapshot,state,
        fencing_token,lease_token_sha256,lease_expires_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,'monthlyOrchestrationActions',?,?,?,?,1,?,?,'reserved',?,?,?,1,?,?)`)
        .run(id,queue.id,queue.space_id,context.profile_ref_sha256,context.purpose_key,policy.quotaPeriodStart,policy.quotaPeriodEnd,
          policy.frequencyPeriodStart,policy.frequencyPeriodEnd,policy.quotaLimit,policy.frequencyLimit,input.lease.fencingToken,
          sha(input.lease.leaseToken),input.lease.leaseExpiresAt,input.at,input.at);
      this.bump(id,'reserved',input.at);return {reservationId:id,replayed:false};
    });
  }

  transition(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;to:'consumed'|'released';at:string}):{replayed:boolean}{
    return this.transact(()=>{this.lockSpace(input.lease.spaceId);
      const row=this.db.prepare('SELECT * FROM journey_action_worker_reservations WHERE id=? AND queue_id=? AND space_id=?').get(input.reservationId,input.lease.queueId,input.lease.spaceId) as any;
      if(!row)throw new JourneyWorkerSafetyError('Reservation not found.','WORKER_RESERVATION_NOT_FOUND',404);
      const principal=this.principal(input.authority,input.at,false);
      const queue=this.db.prepare('SELECT adapter FROM journey_action_queue WHERE id=? AND space_id=?').get(row.queue_id,row.space_id) as any;
      if(!queue)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);
      this.assertScope(principal,input.authority,row.space_id,queue.adapter);if(row.state===input.to)return {replayed:true};
      if(row.state!=='reserved'||Number(row.fencing_token)!==input.lease.fencingToken||row.lease_token_sha256!==sha(input.lease.leaseToken))
        throw new JourneyWorkerSafetyError('Reservation fence is stale.','WORKER_RESERVATION_STALE_FENCE');
      this.moveCounters(row,input.to,input.at);const changed=this.db.prepare('UPDATE journey_action_worker_reservations SET state=?,revision=revision+1,updated_at=? WHERE id=? AND state=\'reserved\'')
        .run(input.to,input.at,row.id).changes;if(changed!==1)throw new JourneyWorkerSafetyError('Reservation state raced.','WORKER_RESERVATION_CAS_FAILED');
      this.bump(row.id,input.to,input.at);return {replayed:false};});
  }

  release(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;at:string}){
    return this.transition({...input,to:'released'});
  }

  /** Atomically settles the reservation, deterministic receipt, and fenced runtime-36 queue row. */
  completeReservedNoEffect(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;receiptSha256:string;at:string}){
    return this.transact(()=>{this.lockSpace(input.lease.spaceId);const principal=this.principal(input.authority,input.at,false);
      const queue=this.db.prepare('SELECT * FROM journey_action_queue WHERE id=? AND space_id=?').get(input.lease.queueId,input.lease.spaceId) as any;
      if(!queue)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);
      this.assertScope(principal,input.authority,queue.space_id,queue.adapter);
      const existing=this.db.prepare('SELECT id FROM journey_action_effect_receipts WHERE queue_id=? AND space_id=?').get(queue.id,queue.space_id) as any;
      const reservation=this.db.prepare('SELECT * FROM journey_action_worker_reservations WHERE id=? AND queue_id=? AND space_id=?')
        .get(input.reservationId,queue.id,queue.space_id) as any;
      const quotaPeriodStart=reservation?.quota_period_start?new Date(reservation.quota_period_start).toISOString():'';
      const quotaPeriodEnd=reservation?.quota_period_end?new Date(reservation.quota_period_end).toISOString():'';
      const usageKey=this.usageIdempotencyKey(queue.id,input.lease.fencingToken);
      const usage=this.db.prepare(`SELECT id,quantity,intent_hash FROM platform_usage_events
        WHERE space_id=? AND meter='monthlyOrchestrationActions' AND period_start=? AND idempotency_key=?`)
        .get(queue.space_id,quotaPeriodStart,usageKey) as any;
      if(existing){if(!reservation||reservation.state!=='consumed'||!usage||Number(usage.quantity)!==1
          ||usage.intent_hash!==this.usageIntentHash(queue.id,input.lease.fencingToken))
        throw new JourneyWorkerSafetyError('Receipt, reservation, and usage ledger disagree.','WORKER_RESERVATION_COUNTER_INCONSISTENT',500);return {replayed:true};}
      if(!reservation||reservation.state!=='reserved'||Number(reservation.fencing_token)!==input.lease.fencingToken
        ||reservation.lease_token_sha256!==sha(input.lease.leaseToken)||queue.state!=='leased'||queue.lease_token!==input.lease.leaseToken
        ||Number(queue.fencing_token)!==input.lease.fencingToken||Date.parse(queue.lease_expires_at)<=Date.parse(input.at))
        throw new JourneyWorkerSafetyError('Completion fence is stale.','WORKER_RESERVATION_STALE_FENCE');
      const receiptId=crypto.randomUUID();this.db.prepare(`INSERT INTO journey_action_effect_receipts
        (id,queue_id,action_id,space_id,idempotency_key,adapter,effect_sha256,fencing_token,created_at)
        VALUES (?,?,?,?,?,'deterministic_no_effect',?,?,?)`).run(receiptId,queue.id,queue.action_id,queue.space_id,queue.idempotency_key,
          input.receiptSha256,input.lease.fencingToken,input.at);
      const policy=this.resolvePolicy({spaceId:queue.space_id,workflowId:queue.workflow_id,adapter:queue.adapter,
        purposeKey:String(reservation.purpose_key),profileRefSha256:String(reservation.profile_ref_sha256),at:input.at});
      const outstanding=Number(this.counter('journey_action_quota_counters',['space_id','meter','period_start'],
        [queue.space_id,'monthlyOrchestrationActions',reservation.quota_period_start])?.reserved_quantity||0);
      if(!policy.entitled||Number(policy.canonicalQuotaUsed??0)+outstanding>policy.quotaLimit)
        throw new JourneyWorkerSafetyError('Live usage settlement gate denied.','WORKER_QUOTA_EXCEEDED');
      this.db.prepare(`INSERT INTO platform_usage_events(id,space_id,subscription_id,meter,quantity,period_start,period_end,
        idempotency_key,intent_hash,source_type,source_id,actor_user_id,created_at)
        VALUES (?,?,?,'monthlyOrchestrationActions',1,?,?,?,?,'journey_action_worker',?,NULL,?)`)
        .run(crypto.randomUUID(),queue.space_id,policy.subscriptionId??null,quotaPeriodStart,quotaPeriodEnd,
          usageKey,this.usageIntentHash(queue.id,input.lease.fencingToken),queue.id,input.at);
      const reconciledQuantity=Number((this.db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM platform_usage_events
        WHERE space_id=? AND meter='monthlyOrchestrationActions' AND period_start=?`).get(queue.space_id,quotaPeriodStart) as any)?.quantity||0);
      this.db.prepare(`INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
        VALUES (?,'monthlyOrchestrationActions',?,?,?,?) ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
        period_end=excluded.period_end,quantity=excluded.quantity,updated_at=excluded.updated_at`)
        .run(queue.space_id,quotaPeriodStart,quotaPeriodEnd,reconciledQuantity,input.at);
      this.moveCounters(reservation,'consumed',input.at);
      const reservationChanged=this.db.prepare("UPDATE journey_action_worker_reservations SET state='consumed',revision=revision+1,updated_at=? WHERE id=? AND state='reserved' AND fencing_token=?")
        .run(input.at,reservation.id,input.lease.fencingToken).changes;
      if(reservationChanged!==1)throw new JourneyWorkerSafetyError('Reservation settlement raced.','WORKER_RESERVATION_CAS_FAILED');
      const queueChanged=this.db.prepare(`UPDATE journey_action_queue SET state='succeeded',lease_owner_sha256=NULL,lease_token=NULL,lease_expires_at=NULL,
        terminal_at=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`)
        .run(input.at,input.at,queue.id,queue.space_id,input.lease.leaseToken,input.lease.fencingToken).changes;
      if(queueChanged!==1)throw new JourneyWorkerSafetyError('Queue completion raced.','WORKER_RESERVATION_STALE_FENCE');
      this.bump(reservation.id,'consumed',input.at);return {replayed:false};});
  }

  /** Atomically binds a runtime-38 reviewed receipt to runtime-42 usage and fencing. */
  completeReservedReviewedEffect(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;adapter:string;
    providerReferenceSha256:string;responseSha256:string;requestSha256:string;applyInternalEffect?:()=>void;at:string}){
    return this.transact(()=>{this.lockSpace(input.lease.spaceId);const principal=this.principal(input.authority,input.at,false);
      const queue=this.db.prepare('SELECT * FROM journey_action_queue WHERE id=? AND space_id=?').get(input.lease.queueId,input.lease.spaceId) as any;
      if(!queue)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);
      this.assertScope(principal,input.authority,queue.space_id,queue.adapter);
      if(queue.adapter!==input.adapter)throw new JourneyWorkerSafetyError('Reviewed adapter does not match the fenced queue.','WORKER_ADAPTER_MISMATCH');
      const noEffect=this.db.prepare('SELECT id FROM journey_action_effect_receipts WHERE queue_id=? AND space_id=?').get(queue.id,queue.space_id) as any;
      if(noEffect)throw new JourneyWorkerSafetyError('A no-effect receipt already settled this action.','WORKER_RECEIPT_KIND_CONFLICT',500);
      const existing=this.db.prepare(`SELECT receipt.id,receipt.adapter,receipt.fencing_token,receipt.provider_reference_sha256,
          receipt.response_sha256,attempt.request_sha256
        FROM journey_adapter_effect_receipts receipt LEFT JOIN journey_adapter_execution_attempts attempt
          ON attempt.queue_id=receipt.queue_id AND attempt.space_id=receipt.space_id AND attempt.outcome='succeeded'
        WHERE receipt.queue_id=? AND receipt.space_id=?`)
        .get(queue.id,queue.space_id) as any;
      const reservation=this.db.prepare('SELECT * FROM journey_action_worker_reservations WHERE id=? AND queue_id=? AND space_id=?')
        .get(input.reservationId,queue.id,queue.space_id) as any;
      const quotaPeriodStart=reservation?.quota_period_start?new Date(reservation.quota_period_start).toISOString():'';
      const quotaPeriodEnd=reservation?.quota_period_end?new Date(reservation.quota_period_end).toISOString():'';
      const usageKey=this.usageIdempotencyKey(queue.id,input.lease.fencingToken);
      const usage=this.db.prepare(`SELECT id,quantity,intent_hash FROM platform_usage_events
        WHERE space_id=? AND meter='monthlyOrchestrationActions' AND period_start=? AND idempotency_key=?`)
        .get(queue.space_id,quotaPeriodStart,usageKey) as any;
      if(existing){if(existing.adapter!==input.adapter||Number(existing.fencing_token)!==input.lease.fencingToken
          ||existing.provider_reference_sha256!==input.providerReferenceSha256||existing.response_sha256!==input.responseSha256
          ||existing.request_sha256!==input.requestSha256
          ||!reservation||reservation.state!=='consumed'||!usage||Number(usage.quantity)!==1
          ||usage.intent_hash!==this.usageIntentHash(queue.id,input.lease.fencingToken))
        throw new JourneyWorkerSafetyError('Reviewed receipt, reservation, and usage ledger disagree.','WORKER_RESERVATION_COUNTER_INCONSISTENT',500);
        return {receiptId:String(existing.id),replayed:true};}
      if(!reservation||reservation.state!=='reserved'||Number(reservation.fencing_token)!==input.lease.fencingToken
        ||reservation.lease_token_sha256!==sha(input.lease.leaseToken)||queue.state!=='leased'||queue.lease_token!==input.lease.leaseToken
        ||Number(queue.fencing_token)!==input.lease.fencingToken||Date.parse(queue.lease_expires_at)<=Date.parse(input.at))
        throw new JourneyWorkerSafetyError('Reviewed-effect completion fence is stale.','WORKER_RESERVATION_STALE_FENCE');
      const policy=this.resolvePolicy({spaceId:queue.space_id,workflowId:queue.workflow_id,adapter:queue.adapter,
        purposeKey:String(reservation.purpose_key),profileRefSha256:String(reservation.profile_ref_sha256),at:input.at});
      const outstanding=Number(this.counter('journey_action_quota_counters',['space_id','meter','period_start'],
        [queue.space_id,'monthlyOrchestrationActions',reservation.quota_period_start])?.reserved_quantity||0);
      if(!policy.entitled||Number(policy.canonicalQuotaUsed??0)+outstanding>policy.quotaLimit)
        throw new JourneyWorkerSafetyError('Live usage settlement gate denied.','WORKER_QUOTA_EXCEEDED');
      input.applyInternalEffect?.();
      const receiptId=crypto.randomUUID();this.db.prepare(`INSERT INTO journey_adapter_effect_receipts
        (id,queue_id,action_id,space_id,adapter,idempotency_key,provider_reference_sha256,response_sha256,fencing_token,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(receiptId,queue.id,queue.action_id,queue.space_id,input.adapter,queue.idempotency_key,
          input.providerReferenceSha256,input.responseSha256,input.lease.fencingToken,input.at);
      this.db.prepare(`INSERT INTO journey_adapter_execution_attempts
        (id,queue_id,action_id,space_id,adapter,attempt_number,fencing_token,outcome,error_code,request_sha256,
          provider_receipt_sha256,safety_json,created_at) VALUES (?,?,?,?,?,?,?,'succeeded',NULL,?,?,?,?)`)
        .run(crypto.randomUUID(),queue.id,queue.action_id,queue.space_id,input.adapter,queue.attempt_count,input.lease.fencingToken,
          input.requestSha256,input.providerReferenceSha256,json({workerReservation:'allow',quota:'allow'}),input.at);
      this.db.prepare(`INSERT INTO platform_usage_events(id,space_id,subscription_id,meter,quantity,period_start,period_end,
        idempotency_key,intent_hash,source_type,source_id,actor_user_id,created_at)
        VALUES (?,?,?,'monthlyOrchestrationActions',1,?,?,?,?,'journey_action_worker',?,NULL,?)`)
        .run(crypto.randomUUID(),queue.space_id,policy.subscriptionId??null,quotaPeriodStart,quotaPeriodEnd,
          usageKey,this.usageIntentHash(queue.id,input.lease.fencingToken),queue.id,input.at);
      const reconciledQuantity=Number((this.db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM platform_usage_events
        WHERE space_id=? AND meter='monthlyOrchestrationActions' AND period_start=?`).get(queue.space_id,quotaPeriodStart) as any)?.quantity||0);
      this.db.prepare(`INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
        VALUES (?,'monthlyOrchestrationActions',?,?,?,?) ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
        period_end=excluded.period_end,quantity=excluded.quantity,updated_at=excluded.updated_at`)
        .run(queue.space_id,quotaPeriodStart,quotaPeriodEnd,reconciledQuantity,input.at);
      this.moveCounters(reservation,'consumed',input.at);
      if(this.db.prepare("UPDATE journey_action_worker_reservations SET state='consumed',revision=revision+1,updated_at=? WHERE id=? AND state='reserved' AND fencing_token=?")
        .run(input.at,reservation.id,input.lease.fencingToken).changes!==1)throw new JourneyWorkerSafetyError('Reservation settlement raced.','WORKER_RESERVATION_CAS_FAILED');
      if(this.db.prepare(`UPDATE journey_action_queue SET state='succeeded',lease_owner_sha256=NULL,lease_token=NULL,lease_expires_at=NULL,
        terminal_at=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`)
        .run(input.at,input.at,queue.id,queue.space_id,input.lease.leaseToken,input.lease.fencingToken).changes!==1)
        throw new JourneyWorkerSafetyError('Queue completion raced.','WORKER_RESERVATION_STALE_FENCE');
      this.bump(reservation.id,'consumed',input.at);return {receiptId,replayed:false};});
  }

  holdReservedLease(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;reasonCode:string;at:string}):void{
    if(!/^[A-Z][A-Z0-9_]{2,127}$/u.test(input.reasonCode))throw new JourneyWorkerSafetyError('Hold code is unsafe.','WORKER_HOLD_CODE_INVALID',400);
    this.releaseAndMoveQueue({...input,nextState:'held',holdReasonCode:input.reasonCode,errorCode:input.reasonCode});
  }

  failReservedLease(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;errorCode:string;at:string}):void{
    if(!/^[A-Z][A-Z0-9_]{2,127}$/u.test(input.errorCode))throw new JourneyWorkerSafetyError('Failure code is unsafe.','WORKER_ERROR_CODE_INVALID',400);
    this.releaseAndMoveQueue({...input,nextState:'retry_scheduled',holdReasonCode:null,errorCode:input.errorCode});
  }

  reapExpired(at:string):number{return this.transact(()=>{const rows=this.db.prepare("SELECT * FROM journey_action_worker_reservations WHERE state='reserved' AND lease_expires_at<=?").all(at) as any[];let reaped=0;
    for(const row of rows){this.moveCounters(row,'released',at);const changed=this.db.prepare("UPDATE journey_action_worker_reservations SET state='expired',revision=revision+1,updated_at=? WHERE id=? AND state='reserved'").run(at,row.id).changes;
      if(changed!==1)throw new JourneyWorkerSafetyError('Reservation expiry raced.','WORKER_RESERVATION_CAS_FAILED');this.bump(row.id,'expired',at);reaped+=1}return reaped;});}

  private principal(authority:WorkerAuthority,at:string,claim:boolean){const row=this.db.prepare('SELECT * FROM journey_worker_service_principals WHERE key_id=?').get(authority.keyId) as any;
    if(!row||row.state==='revoked'||(claim&&row.state!=='active')||Date.parse(row.not_before)>Date.parse(at)||Date.parse(row.expires_at)<=Date.parse(at))
      throw new JourneyWorkerSafetyError('Service principal is inactive.','WORKER_PRINCIPAL_INACTIVE',403);return row;}
  private assertScope(row:any,authority:WorkerAuthority,spaceId:string,adapter:string){const spaces=this.arrayValue(row.allowed_space_ids_json),adapters=this.arrayValue(row.allowed_adapters_json);
    if(!spaces.includes(spaceId)||!adapters.includes(adapter)||!authority.allowedSpaceIds.includes(spaceId)||!authority.allowedAdapters.includes(adapter))
      throw new JourneyWorkerSafetyError('Service principal scope denied.','WORKER_PRINCIPAL_SCOPE_DENIED',403);}
  private counter(table:string,columns:string[],values:unknown[]){return this.db.prepare(`SELECT * FROM ${table} WHERE ${columns.map(c=>`${c}=?`).join(' AND ')}`).get(...values) as any;}
  private upsertCounter(table:string,columns:string[],values:unknown[],at:string){this.db.prepare(`INSERT OR IGNORE INTO ${table}(${columns.join(',')},reserved_quantity,consumed_quantity,updated_at) VALUES (${columns.map(()=>'?').join(',')},0,0,?)`).run(...values,at);
    const changed=this.db.prepare(`UPDATE ${table} SET reserved_quantity=reserved_quantity+1,updated_at=? WHERE ${columns.slice(0,-1).map(c=>`${c}=?`).join(' AND ')}`).run(at,...values.slice(0,-1)).changes;
    if(changed!==1)throw new JourneyWorkerSafetyError('Reservation counter is unavailable.','WORKER_RESERVATION_COUNTER_INCONSISTENT',500);}
  private moveCounters(row:any,to:'consumed'|'released',at:string){const consumed=to==='consumed'?1:0;
    const quota=this.db.prepare(`UPDATE journey_action_quota_counters SET reserved_quantity=reserved_quantity-1,consumed_quantity=consumed_quantity+?,updated_at=? WHERE space_id=? AND meter=? AND period_start=? AND reserved_quantity>0`)
      .run(consumed,at,row.space_id,row.meter,row.quota_period_start).changes;
    const frequency=this.db.prepare(`UPDATE journey_action_frequency_counters SET reserved_quantity=reserved_quantity-1,consumed_quantity=consumed_quantity+?,updated_at=? WHERE space_id=? AND profile_ref_sha256=? AND purpose_key=? AND period_start=? AND reserved_quantity>0`)
      .run(consumed,at,row.space_id,row.profile_ref_sha256,row.purpose_key,row.frequency_period_start).changes;
    if(quota!==1||frequency!==1)throw new JourneyWorkerSafetyError('Reservation counters are inconsistent.','WORKER_RESERVATION_COUNTER_INCONSISTENT',500);}
  private bump(reservationId:string,event:string,at:string){const row=this.db.prepare('SELECT queue_id,space_id,fencing_token FROM journey_action_worker_reservations WHERE id=?').get(reservationId) as any;
    const detail=sha(json({reservationIdSha256:sha(reservationId),event,fencingToken:Number(row.fencing_token)}));this.db.prepare(`INSERT INTO journey_action_worker_reservation_events
      (id,reservation_id,queue_id,space_id,event,fencing_token,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),reservationId,row.queue_id,row.space_id,event,row.fencing_token,detail,at);}
  private keyAudit(id:string,action:string,previous:string|null,resulting:string,revision:number,at:string){
    const detail=adopt(()=>buildSafetyAuditDetail({action,revision}));this.db.prepare(`INSERT INTO journey_worker_service_key_audit
      (id,principal_id,action,previous_key_id_sha256,resulting_key_id_sha256,revision,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(),id,action,previous?sha(previous):null,sha(resulting),revision,detail.json,detail.sha256,at);}
  private lockSpace(spaceId:string){if('provider' in this.db&&this.db.provider==='postgres'){
      const row=this.db.prepare('SELECT journey_worker_lock_space(?) locked').get(spaceId) as any;if(!row?.locked)throw new JourneyWorkerSafetyError('Space not found.','WORKER_SPACE_NOT_FOUND',404);
    }else{const changed=this.db.prepare('UPDATE spaces SET id=id WHERE id=?').run(spaceId).changes;if(changed!==1)throw new JourneyWorkerSafetyError('Space not found.','WORKER_SPACE_NOT_FOUND',404);}}
  private arrayValue(value:unknown):string[]{if(Array.isArray(value))return value.map(String);if(typeof value==='string'){const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(String):[];}return [];}
  private queueView(row:any):WorkerQueueItem{return Object.freeze({id:String(row.id),spaceId:String(row.space_id),workflowId:String(row.workflow_id),
    adapter:String(row.adapter),profileId:'redacted',state:row.state,availableAt:String(row.available_at),leaseToken:row.lease_token||null,
    fencingToken:Number(row.fencing_token),leaseExpiresAt:row.lease_expires_at?new Date(row.lease_expires_at).toISOString():null,
    holdReasonCode:row.hold_reason_code||null,revision:Number(row.revision)});}
  private liveFacts(queue:any,at:string){const context=this.db.prepare('SELECT * FROM journey_action_live_contexts WHERE queue_id=? AND space_id=?').get(queue.id,queue.space_id) as any;
    const subject=context?this.db.prepare('SELECT * FROM journey_action_subject_controls WHERE space_id=? AND profile_ref_sha256=? AND purpose_key=?')
      .get(queue.space_id,context.profile_ref_sha256,context.purpose_key) as any:null;
    const source=context?this.db.prepare('SELECT * FROM journey_action_source_controls WHERE space_id=? AND source_key=?').get(queue.space_id,context.source_key) as any:null;
    const policy=context?this.resolvePolicy({spaceId:queue.space_id,workflowId:queue.workflow_id,adapter:queue.adapter,purposeKey:context.purpose_key,
      profileRefSha256:context.profile_ref_sha256,at}):null;
    const quota=policy?this.counter('journey_action_quota_counters',['space_id','meter','period_start'],[queue.space_id,'monthlyOrchestrationActions',policy.quotaPeriodStart]):null;
    const frequency=policy?this.counter('journey_action_frequency_counters',['space_id','profile_ref_sha256','purpose_key','period_start'],
      [queue.space_id,context.profile_ref_sha256,context.purpose_key,policy.frequencyPeriodStart]):null;
    const own=this.db.prepare("SELECT quantity FROM journey_action_worker_reservations WHERE queue_id=? AND state='reserved' ORDER BY fencing_token DESC LIMIT 1").get(queue.id) as any;
    const reservedAdjustment=Number(own?.quantity||0);const switches=this.db.prepare(`SELECT scope_level AS level,scope_key AS "scopeRef",state,
      reason_code AS "reasonCode",revision,updated_at AS "updatedAt" FROM journey_kill_switch_states
      WHERE(scope_level='platform' AND space_id IS NULL)OR space_id=?`).all(queue.space_id) as any[];
    return {consent:subject?.consent_state||'unknown',suppressed:subject?Boolean(subject.suppressed):null,entitled:policy?.entitled??null,
      quota:policy?{used:Number(policy.canonicalQuotaUsed??quota?.consumed_quantity??0),reserved:Math.max(0,Number(quota?.reserved_quantity||0)-reservedAdjustment),limit:policy.quotaLimit}:null,
      quietHours:subject?{timezone:subject.quiet_timezone,startMinute:Number(subject.quiet_start_minute),endMinute:Number(subject.quiet_end_minute)}:null,
      frequency:policy?{observed:Math.max(0,Number(frequency?.consumed_quantity||0)+Number(frequency?.reserved_quantity||0)-reservedAdjustment),
        maximum:policy.frequencyLimit,windowEndsAt:policy.frequencyPeriodEnd}:null,sourceState:source?.state||'unknown',
      killSwitchScope:{spaceId:queue.space_id,workflowId:queue.workflow_id,adapter:queue.adapter,profileId:context?.profile_ref_sha256||null},
      killSwitchRecords:switches} as const;}
  private releaseAndMoveQueue(input:{authority:WorkerAuthority;lease:WorkerLease;reservationId:string;at:string;
    nextState:'held'|'retry_scheduled';holdReasonCode:string|null;errorCode:string}){this.transact(()=>{this.lockSpace(input.lease.spaceId);
      const principal=this.principal(input.authority,input.at,false);const queue=this.db.prepare('SELECT * FROM journey_action_queue WHERE id=? AND space_id=?')
        .get(input.lease.queueId,input.lease.spaceId) as any;if(!queue)throw new JourneyWorkerSafetyError('Queue item not found.','WORKER_QUEUE_NOT_FOUND',404);
      this.assertScope(principal,input.authority,queue.space_id,queue.adapter);const reservation=this.db.prepare(
        'SELECT * FROM journey_action_worker_reservations WHERE id=? AND queue_id=? AND space_id=?').get(input.reservationId,queue.id,queue.space_id) as any;
      if(!reservation||reservation.state!=='reserved'||Number(reservation.fencing_token)!==input.lease.fencingToken
        ||reservation.lease_token_sha256!==sha(input.lease.leaseToken)||queue.state!=='leased'||queue.lease_token!==input.lease.leaseToken
        ||Number(queue.fencing_token)!==input.lease.fencingToken)throw new JourneyWorkerSafetyError('Release fence is stale.','WORKER_RESERVATION_STALE_FENCE');
      this.moveCounters(reservation,'released',input.at);const reservationChanged=this.db.prepare(
        "UPDATE journey_action_worker_reservations SET state='released',revision=revision+1,updated_at=? WHERE id=? AND state='reserved' AND fencing_token=?")
        .run(input.at,reservation.id,input.lease.fencingToken).changes;if(reservationChanged!==1)throw new JourneyWorkerSafetyError('Reservation release raced.','WORKER_RESERVATION_CAS_FAILED');
      const queueChanged=this.db.prepare(`UPDATE journey_action_queue SET state=?,hold_reason_code=?,lease_owner_sha256=NULL,lease_token=NULL,
        lease_expires_at=NULL,fencing_token=fencing_token+1,last_error_code=?,available_at=?,revision=revision+1,updated_at=?
        WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`).run(input.nextState,input.holdReasonCode,input.errorCode,
          input.at,input.at,queue.id,queue.space_id,input.lease.leaseToken,input.lease.fencingToken).changes;
      if(queueChanged!==1)throw new JourneyWorkerSafetyError('Queue release raced.','WORKER_RESERVATION_STALE_FENCE');this.bump(reservation.id,'released',input.at);});}
  private usageIdempotencyKey(queueId:string,fencingToken:number){return `journey-worker:${queueId}:${fencingToken}`;}
  private usageIntentHash(queueId:string,fencingToken:number){return sha(json({queueId,fencingToken,meter:'monthlyOrchestrationActions',quantity:1}));}
  private transact<T>(callback:()=>T):T{const transaction=this.db.transaction as unknown as (work:()=>T) => (()=>T);
    return transaction.call(this.db,callback)();}
}
