import crypto from 'node:crypto';
import type {DatabaseRuntime} from './databaseAdapter.js';
import {deriveJourneyEventReconciliation,planJourneyRawRetention,type JourneyRawRetentionCursor} from './journeyEventRetention.js';

const json=(value:unknown)=>JSON.stringify(value);
const sha=(...values:string[])=>crypto.createHash('sha256').update(values.join('\u001f')).digest('hex');
const iso=(value:unknown)=>{const date=value instanceof Date?value:new Date(String(value));if(!Number.isFinite(date.getTime()))throw new Error('Invalid retention timestamp.');return date.toISOString();};
const cursorFrom=(row:any):JourneyRawRetentionCursor|null=>row?.cursor_raw_event_id?{retentionExpiresAt:iso(row.cursor_retention_expires_at),
  receivedAt:iso(row.cursor_received_at),rawEventId:String(row.cursor_raw_event_id)}:null;
export function ensureJourneyEventRetentionSqliteSchema(db:DatabaseRuntime){if(db.provider!=='sqlite')return;db.exec(`
  CREATE TABLE IF NOT EXISTS journey_event_retention_runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('retention','reconciliation')),
    state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','failed','cancelled')),lease_owner TEXT,lease_token TEXT,lease_generation INTEGER NOT NULL DEFAULT 0,
    lease_expires_at TEXT,as_of TEXT NOT NULL,batch_size INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,intent_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
    CHECK((state='leased')=(lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
  CREATE TABLE IF NOT EXISTS journey_event_retention_checkpoints(run_id TEXT PRIMARY KEY REFERENCES journey_event_retention_runs(id) ON DELETE CASCADE,
    cursor_retention_expires_at TEXT,cursor_received_at TEXT,cursor_raw_event_id TEXT,scanned_count INTEGER NOT NULL DEFAULT 0,purged_count INTEGER NOT NULL DEFAULT 0,blocked_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,summary_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_event_retention_events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES journey_event_retention_runs(id) ON DELETE CASCADE,
    action TEXT NOT NULL,detail_json TEXT NOT NULL,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TRIGGER IF NOT EXISTS journey_event_retention_events_update_guard BEFORE UPDATE ON journey_event_retention_events
    BEGIN SELECT RAISE(ABORT,'journey event retention audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_event_retention_events_delete_guard BEFORE DELETE ON journey_event_retention_events
    BEGIN SELECT RAISE(ABORT,'journey event retention audit is append-only'); END;
`);}

export class JourneyEventRetentionRepository{
  constructor(private readonly db:DatabaseRuntime){ensureJourneyEventRetentionSqliteSchema(db);}
  request(input:{id:string;kind:'retention'|'reconciliation';asOf:string;batchSize:number;at:string}){const limit=Math.max(1,Math.min(500,Math.trunc(input.batchSize)||1));
    const intent=sha(input.kind,iso(input.asOf),String(limit));
    return this.db.transaction(()=>{const changed=this.db.prepare(`INSERT INTO journey_event_retention_runs
      (id,kind,state,lease_owner,lease_token,lease_generation,lease_expires_at,as_of,batch_size,idempotency_key,intent_sha256,created_at,updated_at,completed_at)
      VALUES (?,?,'pending',NULL,NULL,0,NULL,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO NOTHING`)
      .run(input.id,input.kind,iso(input.asOf),limit,input.id,intent,iso(input.at),iso(input.at)).changes;
      if(changed)this.db.prepare(`INSERT INTO journey_event_retention_checkpoints(run_id,cursor_retention_expires_at,cursor_received_at,cursor_raw_event_id,
        scanned_count,purged_count,blocked_count,failed_count,summary_json,revision,updated_at) VALUES (?,NULL,NULL,NULL,0,0,0,0,'{}',0,?)`)
        .run(input.id,iso(input.at));return changed===1;})();}
  claim(input:{owner:string;at:string;leaseExpiresAt:string}){return this.db.transaction(()=>{const at=iso(input.at);this.db.prepare(`UPDATE journey_event_retention_runs
      SET state='pending',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE state='leased' AND lease_expires_at<=?`)
      .run(at,at);const lock=this.db.provider==='postgres'?' FOR UPDATE SKIP LOCKED':'';const row=this.db.prepare(`SELECT * FROM journey_event_retention_runs
      WHERE state='pending' ORDER BY created_at,id LIMIT 1${lock}`).get() as any;if(!row)return null;const token=crypto.randomUUID();const changed=this.db.prepare(`UPDATE journey_event_retention_runs
      SET state='leased',lease_owner=?,lease_token=?,lease_generation=lease_generation+1,lease_expires_at=?,updated_at=? WHERE id=? AND state='pending'`)
      .run(input.owner,token,iso(input.leaseExpiresAt),at,row.id).changes;return changed?{...row,as_of:iso(row.as_of),leaseOwner:input.owner,leaseToken:token,
        leaseGeneration:Number(row.lease_generation)+1}:null;})();}
  reconcilePage(input:{runId:string;owner:string;token:string;at:string;rows:any[];cursor:JourneyRawRetentionCursor|null;hasMore:boolean}){
    return this.db.transaction(()=>{const run=this.db.prepare(`SELECT * FROM journey_event_retention_runs WHERE id=? AND state='leased' AND lease_owner=?
      AND lease_token=? AND lease_expires_at>?`).get(input.runId,input.owner,input.token,input.at) as any;if(!run)return null;
      const observation={raw:input.rows.length,terminalInbox:input.rows.filter(row=>['completed','dead_lettered'].includes(row.inboxState)).length,
        successfulReceipts:input.rows.filter(row=>row.successfulReceipt).length,decisions:input.rows.reduce((n,row)=>n+Number(row.stageDecisionCount||0),0),
        visits:input.rows.reduce((n,row)=>n+Number(row.stageVisitCount||0),0),expiredRaw:input.rows.filter(row=>Date.parse(row.retentionExpiresAt)<=Date.parse(run.as_of)).length};
      const report=deriveJourneyEventReconciliation({observation,windowSha256:sha(run.id,run.as_of,json(input.cursor))});
      this.db.prepare(`UPDATE journey_event_retention_checkpoints SET cursor_retention_expires_at=?,cursor_received_at=?,cursor_raw_event_id=?,
        scanned_count=scanned_count+?,summary_json=?,revision=revision+1,updated_at=? WHERE run_id=?`)
        .run(input.cursor?.retentionExpiresAt||null,input.cursor?.receivedAt||null,input.cursor?.rawEventId||null,input.rows.length,
          json(report),iso(input.at),input.runId);
      const action=input.hasMore?'page':'completed';const detail={counts:report.counts,driftCodes:report.driftCodes,
        windowSha256:report.windowSha256};this.db.prepare(`INSERT INTO journey_event_retention_events(id,run_id,action,detail_json,detail_sha256,created_at)
        VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(),input.runId,action,json(detail),sha(json(detail)),iso(input.at));
      if(!input.hasMore)this.db.prepare(`UPDATE journey_event_retention_runs SET state='completed',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
        ,completed_at=? WHERE id=? AND lease_token=?`).run(iso(input.at),iso(input.at),input.runId,input.token);return report;})();}
  planRetentionPage(input:{asOf:string;limit:number;rows:any[]}){return planJourneyRawRetention(input);}
  scanRetentionPage(input:{claim:any;limit:number;cursor?:JourneyRawRetentionCursor|null}){const limit=Math.max(1,Math.min(500,input.limit));
    const checkpoint=this.db.prepare(`SELECT checkpoint.* FROM journey_event_retention_checkpoints checkpoint
      JOIN journey_event_retention_runs run ON run.id=checkpoint.run_id WHERE run.id=? AND run.state='leased' AND run.lease_owner=?
        AND run.lease_token=? AND run.lease_generation=? AND run.lease_expires_at>?`).get(input.claim.id,input.claim.leaseOwner,
          input.claim.leaseToken,input.claim.leaseGeneration,new Date().toISOString()) as any;if(!checkpoint)return [];
    const cursor=input.cursor===undefined?cursorFrom(checkpoint):input.cursor;const predicate=cursor?
      `AND (raw.retention_expires_at,raw.received_at,raw.id)>(?,?,?)`:'';return (this.db.prepare(`SELECT raw.space_id "spaceId",
      raw.source_id "sourceId",raw.environment,raw.id "rawEventId",raw.received_at "receivedAt",raw.retention_expires_at "retentionExpiresAt",
      COALESCE(inbox.state,'completed') "inboxState",GREATEST(MAX(ingest.retention_expires_at),MAX(processing.retention_expires_at),
        MAX(dead.retention_expires_at),MAX(dedupe.retention_expires_at)) "latestDependentExpiry",
      (SELECT COUNT(*) FROM journey_stage_rule_decisions decision WHERE decision.raw_received_at=raw.received_at AND decision.raw_event_id=raw.id) "stageDecisionCount",
      (SELECT COUNT(*) FROM journey_anonymous_stage_visits visit WHERE visit.raw_received_at=raw.received_at AND visit.raw_event_id=raw.id) "stageVisitCount"
      FROM journey_raw_events raw LEFT JOIN journey_event_processing_inbox inbox ON inbox.raw_received_at=raw.received_at AND inbox.raw_event_id=raw.id
      LEFT JOIN journey_event_ingest_receipts ingest ON ingest.raw_received_at=raw.received_at AND ingest.raw_event_id=raw.id
      LEFT JOIN journey_event_processing_receipts processing ON processing.raw_received_at=raw.received_at AND processing.raw_event_id=raw.id
      LEFT JOIN journey_event_dead_letters dead ON dead.raw_received_at=raw.received_at AND dead.raw_event_id=raw.id
      LEFT JOIN journey_event_deduplication dedupe ON dedupe.raw_received_at=raw.received_at AND dedupe.raw_event_id=raw.id
      WHERE raw.retention_expires_at<=? ${predicate} GROUP BY raw.space_id,raw.source_id,raw.environment,raw.id,raw.received_at,
        raw.retention_expires_at,inbox.state ORDER BY raw.retention_expires_at,raw.received_at,raw.id LIMIT ?`)
      .all(input.claim.as_of,...(cursor?[cursor.retentionExpiresAt,cursor.receivedAt,cursor.rawEventId]:[]),limit) as any[]).map((row:any)=>({
        ...row,receivedAt:iso(row.receivedAt),retentionExpiresAt:iso(row.retentionExpiresAt),
        latestDependentExpiry:row.latestDependentExpiry?iso(row.latestDependentExpiry):null,
        stageDecisionCount:Number(row.stageDecisionCount||0),stageVisitCount:Number(row.stageVisitCount||0)}));}
  retentionCursor(claim:any){const row=this.db.prepare(`SELECT checkpoint.* FROM journey_event_retention_checkpoints checkpoint
    JOIN journey_event_retention_runs run ON run.id=checkpoint.run_id WHERE run.id=? AND run.state='leased' AND run.lease_owner=?
      AND run.lease_token=? AND run.lease_generation=?`).get(claim.id,claim.leaseOwner,claim.leaseToken,claim.leaseGeneration) as any;
    return row?cursorFrom(row):null;}
  purgeRetentionCandidate(input:{claim:any;candidate:any}){const row=this.db.prepare(`SELECT * FROM journey_event_retention_purge_raw(?,?,?,?,?,?,?,?,?)`)
      .get(input.claim.id,input.claim.leaseOwner,input.claim.leaseToken,input.candidate.spaceId,input.candidate.sourceId,
        input.candidate.environment,input.candidate.receivedAt,input.candidate.rawEventId,input.claim.as_of) as any;
    return {purgedCount:Number(row?.purged_count||0),outcomeCode:String(row?.outcome_code||'unknown')};}
  checkpointRetentionPage(input:{claim:any;cursor:JourneyRawRetentionCursor|null;scanned:number;purged:number;blocked:number;failed:number;
    complete:boolean;at:string}){return this.db.transaction(()=>{const at=iso(input.at);const run=this.db.prepare(`SELECT id FROM journey_event_retention_runs
      WHERE id=? AND kind='retention' AND state='leased' AND lease_owner=? AND lease_token=? AND lease_generation=? AND lease_expires_at>?`)
      .get(input.claim.id,input.claim.leaseOwner,input.claim.leaseToken,input.claim.leaseGeneration,at);if(!run)return false;
    const detail={scanned:input.scanned,purged:input.purged,blocked:input.blocked,failed:input.failed,complete:input.complete};
    this.db.prepare(`UPDATE journey_event_retention_checkpoints SET cursor_retention_expires_at=?,cursor_received_at=?,cursor_raw_event_id=?,
      scanned_count=scanned_count+?,purged_count=purged_count+?,blocked_count=blocked_count+?,failed_count=failed_count+?,summary_json=?,
      revision=revision+1,updated_at=? WHERE run_id=?`).run(input.cursor?.retentionExpiresAt||null,input.cursor?.receivedAt||null,
        input.cursor?.rawEventId||null,input.scanned,input.purged,input.blocked,input.failed,json(detail),at,input.claim.id);
    this.db.prepare(`INSERT INTO journey_event_retention_events(id,run_id,action,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?)`)
      .run(crypto.randomUUID(),input.claim.id,input.complete?'completed':'page',json(detail),sha(json(detail)),at);
    this.db.prepare(`UPDATE journey_event_retention_runs SET state=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      completed_at=?,updated_at=? WHERE id=? AND lease_token=? AND lease_generation=?`).run(input.complete?'completed':'pending',
        input.complete?at:null,at,input.claim.id,input.claim.leaseToken,input.claim.leaseGeneration);return true;})();}
}
