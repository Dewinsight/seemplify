import crypto from 'node:crypto';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { authenticateConnectorWorkerCredential, assertConnectorWorkerScope, JourneyConnectorWorkerError,
  type JourneyConnectorWorkerAdapter, type JourneyConnectorWorkerPrincipal, ticketConnectorPayload } from './journeyConnectorWorkerDomain.js';

const json=(value:unknown)=>JSON.stringify(value);
const parse=<T>(value:unknown,fallback:T):T=>{if(value!==null&&typeof value==='object')return value as T;
  try{return JSON.parse(String(value)) as T;}catch{return fallback;}};
const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])):value);
const placeholders=(values:readonly unknown[])=>values.map(()=>'?').join(',');
const validRef=/^(file|env|vault|kms):\/\/[A-Za-z0-9][A-Za-z0-9._/:@-]{0,500}$/u;
const iso=(value:unknown)=>{const parsed=value instanceof Date?value:new Date(String(value));return Number.isFinite(parsed.getTime())?parsed.toISOString():'';};
export type ExternalConnectorSecretResolver=(reference:string)=>string;
export type ConnectorWorkerLease=Readonly<{sourceId:string;runId:string;spaceId:string;connectorId:string;
  adapter:JourneyConnectorWorkerAdapter;leaseToken:string;fencingToken:number;leaseExpiresAt:string;phase:'scan'|'deletion';
  snapshotAt:string|null;cursorAt:string|null;cursorId:string|null;surveyIds:readonly string[];pageSize:number}>;

export function ensureJourneyConnectorWorkerSqliteSchema(db:DatabaseRuntime){if(db.provider!=='sqlite')return;db.exec(`
  CREATE TABLE IF NOT EXISTS journey_connector_worker_principals(
    id TEXT PRIMARY KEY,key_id TEXT NOT NULL UNIQUE,secret_ref TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','draining','revoked')),
    allowed_space_ids_json TEXT NOT NULL CHECK(json_valid(allowed_space_ids_json)),allowed_connector_ids_json TEXT NOT NULL CHECK(json_valid(allowed_connector_ids_json)),
    allowed_adapters_json TEXT NOT NULL CHECK(json_valid(allowed_adapters_json)),not_before TEXT NOT NULL,expires_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_connector_worker_key_events(
    id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,key_id TEXT NOT NULL,event_type TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,
    FOREIGN KEY(principal_id) REFERENCES journey_connector_worker_principals(id) ON DELETE NO ACTION);
  CREATE TABLE IF NOT EXISTS journey_connector_worker_sources(
    id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,adapter TEXT NOT NULL CHECK(adapter='service_recovery_tickets_v1'),
    state TEXT NOT NULL CHECK(state IN ('active','paused')),survey_ids_json TEXT NOT NULL CHECK(json_valid(survey_ids_json)),interval_seconds INTEGER NOT NULL,
    page_size INTEGER NOT NULL,phase TEXT NOT NULL DEFAULT 'scan' CHECK(phase IN ('scan','deletion')),snapshot_at TEXT,cursor_at TEXT,cursor_id TEXT,
    deletion_cursor_id TEXT,generation INTEGER NOT NULL DEFAULT 0,next_run_at TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,last_error_code TEXT,
    lease_token_sha256 TEXT,lease_expires_at TEXT,lease_run_id TEXT,fencing_token INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_id,space_id),FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION);
  CREATE INDEX IF NOT EXISTS journey_connector_worker_sources_due ON journey_connector_worker_sources(state,next_run_at,lease_expires_at,id);
  CREATE TABLE IF NOT EXISTS journey_connector_worker_source_items(
    source_id TEXT NOT NULL,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,source_record_id TEXT NOT NULL,survey_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','tombstoned')),last_seen_generation INTEGER NOT NULL,
    source_revision_sha256 TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(source_id,source_record_id),
    FOREIGN KEY(source_id) REFERENCES journey_connector_worker_sources(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS journey_connector_worker_events(
    id TEXT PRIMARY KEY,source_id TEXT NOT NULL,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,event_type TEXT NOT NULL,code TEXT NOT NULL,
    fencing_token INTEGER,counts_json TEXT NOT NULL CHECK(json_valid(counts_json)),created_at TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES journey_connector_worker_sources(id) ON DELETE NO ACTION);
  CREATE INDEX IF NOT EXISTS journey_connector_worker_events_list ON journey_connector_worker_events(space_id,created_at,id);
  CREATE TRIGGER IF NOT EXISTS journey_connector_worker_events_update_guard BEFORE UPDATE ON journey_connector_worker_events BEGIN SELECT RAISE(ABORT,'connector worker events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_connector_worker_events_delete_guard BEFORE DELETE ON journey_connector_worker_events BEGIN SELECT RAISE(ABORT,'connector worker events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_connector_worker_key_events_update_guard BEFORE UPDATE ON journey_connector_worker_key_events BEGIN SELECT RAISE(ABORT,'connector worker key history is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_connector_worker_key_events_delete_guard BEFORE DELETE ON journey_connector_worker_key_events BEGIN SELECT RAISE(ABORT,'connector worker key history is append-only'); END;
`);}

export class JourneyConnectorWorkerRepository {
  constructor(private db:DatabaseRuntime,private resolveExternalSecret:ExternalConnectorSecretResolver){ensureJourneyConnectorWorkerSqliteSchema(db);}
  provisionPrincipal(input:{id:string;keyId:string;secretRef:string;state:'active'|'draining'|'revoked';allowedSpaceIds:string[];
    allowedConnectorIds:string[];allowedAdapters:JourneyConnectorWorkerAdapter[];notBefore:string;expiresAt:string;at:string}){
    if(!validRef.test(input.secretRef)||input.allowedSpaceIds.length<1||input.allowedSpaceIds.length>100||input.allowedConnectorIds.length<1
      ||input.allowedConnectorIds.length>200||new Set(input.allowedSpaceIds).size!==input.allowedSpaceIds.length
      ||new Set(input.allowedConnectorIds).size!==input.allowedConnectorIds.length)throw new JourneyConnectorWorkerError('Principal scope or external secret reference is invalid.','JOURNEY_CONNECTOR_WORKER_PRINCIPAL_INVALID',400);
    this.db.prepare(`INSERT INTO journey_connector_worker_principals(id,key_id,secret_ref,state,allowed_space_ids_json,allowed_connector_ids_json,
      allowed_adapters_json,not_before,expires_at,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`)
      .run(input.id,input.keyId,input.secretRef,input.state,json(input.allowedSpaceIds),json(input.allowedConnectorIds),json(input.allowedAdapters),input.notBefore,input.expiresAt,input.at,input.at);
    this.db.prepare(`INSERT INTO journey_connector_worker_key_events(id,principal_id,key_id,event_type,revision,created_at) VALUES(?,?,?,?,1,?)`)
      .run(crypto.randomUUID(),input.id,input.keyId,'provisioned',input.at);
  }
  rotatePrincipal(input:{currentId:string;expectedRevision:number;replacement:{id:string;keyId:string;secretRef:string;notBefore:string;expiresAt:string};at:string}){
    return this.db.transaction(()=>{const current=this.db.prepare('SELECT * FROM journey_connector_worker_principals WHERE id=?').get(input.currentId) as any;
      if(!current||current.state!=='active')throw new JourneyConnectorWorkerError('Active worker principal is unavailable.','JOURNEY_CONNECTOR_WORKER_PRINCIPAL_UNAVAILABLE',404);
      if(Number(current.revision)!==input.expectedRevision)throw new JourneyConnectorWorkerError('Worker principal revision conflict.','JOURNEY_CONNECTOR_WORKER_PRINCIPAL_CONFLICT',409);
      const changed=this.db.prepare(`UPDATE journey_connector_worker_principals SET state='draining',revision=revision+1,updated_at=? WHERE id=? AND state='active' AND revision=?`)
        .run(input.at,input.currentId,input.expectedRevision);if(!changed.changes)throw new JourneyConnectorWorkerError('Worker principal revision conflict.','JOURNEY_CONNECTOR_WORKER_PRINCIPAL_CONFLICT',409);
      this.db.prepare(`INSERT INTO journey_connector_worker_key_events(id,principal_id,key_id,event_type,revision,created_at) VALUES(?,?,?,?,?,?)`)
        .run(crypto.randomUUID(),input.currentId,current.key_id,'draining',input.expectedRevision+1,input.at);
      this.provisionPrincipal({id:input.replacement.id,keyId:input.replacement.keyId,secretRef:input.replacement.secretRef,state:'active',
        allowedSpaceIds:parse(current.allowed_space_ids_json,[]),allowedConnectorIds:parse(current.allowed_connector_ids_json,[]),
        allowedAdapters:parse(current.allowed_adapters_json,[]),notBefore:input.replacement.notBefore,expiresAt:input.replacement.expiresAt,at:input.at});
      return{previousId:input.currentId,replacementId:input.replacement.id};})();}
  authenticate(input:{credential:string;at:string}):JourneyConnectorWorkerPrincipal{
    let hint:{sub?:string;kid?:string};try{hint=JSON.parse(Buffer.from(input.credential.split('.')[0]||'','base64url').toString()) as any;}catch{throw new JourneyConnectorWorkerError('Worker credential is malformed.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);}
    const row=this.db.prepare('SELECT * FROM journey_connector_worker_principals WHERE id=? AND key_id=?').get(hint.sub||'',hint.kid||'') as any;
    if(!row||row.state!=='active'||input.at<iso(row.not_before)||input.at>=iso(row.expires_at))throw new JourneyConnectorWorkerError('Worker principal is unavailable.','JOURNEY_CONNECTOR_WORKER_AUTH_INVALID',401);
    const secret=this.resolveExternalSecret(String(row.secret_ref));if(typeof secret!=='string'||secret.length<32)throw new JourneyConnectorWorkerError('External worker secret is unavailable.','JOURNEY_CONNECTOR_WORKER_SECRET_UNAVAILABLE',503);
    const authority=authenticateConnectorWorkerCredential({credential:input.credential,secret,at:input.at});
    const spaces=parse<string[]>(row.allowed_space_ids_json,[]),connectors=parse<string[]>(row.allowed_connector_ids_json,[]),adapters=parse<JourneyConnectorWorkerAdapter[]>(row.allowed_adapters_json,[]);
    if(authority.allowedSpaceIds.some((v)=>!spaces.includes(v))||authority.allowedConnectorIds.some((v)=>!connectors.includes(v))
      ||authority.allowedAdapters.some((v)=>!adapters.includes(v)))throw new JourneyConnectorWorkerError('Credential scope exceeds the stored principal.','JOURNEY_CONNECTOR_WORKER_SCOPE_DENIED');
    return authority;
  }
  private assertStoredAuthority(authority:JourneyConnectorWorkerPrincipal,at:string){const row=this.db.prepare(`SELECT state,allowed_space_ids_json,
      allowed_connector_ids_json,allowed_adapters_json,not_before,expires_at FROM journey_connector_worker_principals WHERE id=? AND key_id=?`)
      .get(authority.principalId,authority.keyId) as any;
    const spaces=parse<string[]>(row?.allowed_space_ids_json,[]),connectors=parse<string[]>(row?.allowed_connector_ids_json,[]),adapters=parse<JourneyConnectorWorkerAdapter[]>(row?.allowed_adapters_json,[]);
    if(!row||row.state!=='active'||at<iso(row.not_before)||at>=iso(row.expires_at)||authority.allowedSpaceIds.some((v)=>!spaces.includes(v))
      ||authority.allowedConnectorIds.some((v)=>!connectors.includes(v))||authority.allowedAdapters.some((v)=>!adapters.includes(v)))
      throw new JourneyConnectorWorkerError('Stored worker authority is inactive or narrower than the claim.','JOURNEY_CONNECTOR_WORKER_AUTH_REVOKED',401);}
  provisionTicketSource(input:{id:string;spaceId:string;connectorId:string;surveyIds:string[];intervalSeconds:number;pageSize:number;at:string}){
    if(input.surveyIds.length<1||input.surveyIds.length>100||new Set(input.surveyIds).size!==input.surveyIds.length||input.intervalSeconds<60
      ||input.intervalSeconds>86400||input.pageSize<1||input.pageSize>200)throw new JourneyConnectorWorkerError('Connector source settings are invalid.','JOURNEY_CONNECTOR_WORKER_SOURCE_INVALID',400);
    const connector=this.db.prepare(`SELECT id FROM journey_connector_definitions WHERE id=? AND space_id=? AND state='active'`).get(input.connectorId,input.spaceId);
    const surveys=this.db.prepare(`SELECT id FROM surveys WHERE space_id=? AND id IN (${placeholders(input.surveyIds)})`).all(input.spaceId,...input.surveyIds) as any[];
    if(!connector||surveys.length!==input.surveyIds.length)throw new JourneyConnectorWorkerError('Connector or survey scope is unavailable.','JOURNEY_CONNECTOR_WORKER_SOURCE_SCOPE_INVALID',404);
    this.db.prepare(`INSERT INTO journey_connector_worker_sources(id,connector_id,space_id,adapter,state,survey_ids_json,interval_seconds,page_size,
      phase,generation,next_run_at,attempt_count,fencing_token,revision,created_at,updated_at) VALUES(?,?,?,'service_recovery_tickets_v1','active',?,?,?,'scan',0,?,0,0,1,?,?)`)
      .run(input.id,input.connectorId,input.spaceId,json(input.surveyIds),input.intervalSeconds,input.pageSize,input.at,input.at,input.at);
  }
  claim(input:{authority:JourneyConnectorWorkerPrincipal;now:string;leaseSeconds:number}):ConnectorWorkerLease|null{return this.db.transaction(()=>{
    this.assertStoredAuthority(input.authority,input.now);
    if(input.leaseSeconds<10||input.leaseSeconds>300)throw new JourneyConnectorWorkerError('Lease duration is invalid.','JOURNEY_CONNECTOR_WORKER_LEASE_INVALID',400);
    const spaces=input.authority.allowedSpaceIds,connectors=input.authority.allowedConnectorIds,adapters=input.authority.allowedAdapters;
    const lock=this.db.provider==='postgres'?' FOR UPDATE OF source SKIP LOCKED':'',feature=this.db.provider==='postgres'
      ?`COALESCE((subscription.features_json::jsonb->>'journeyConnectors')::boolean,FALSE)=TRUE`
      :`COALESCE(json_extract(subscription.features_json,'$.journeyConnectors'),0)=1`;
    const row=this.db.prepare(`SELECT source.* FROM journey_connector_worker_sources source JOIN journey_connector_definitions connector
      ON connector.id=source.connector_id AND connector.space_id=source.space_id LEFT JOIN platform_subscriptions subscription ON subscription.space_id=source.space_id
      WHERE source.state='active' AND connector.state='active' AND (subscription.id IS NULL OR (subscription.status='active' AND ${feature}))
      AND source.space_id IN (${placeholders(spaces)}) AND source.connector_id IN (${placeholders(connectors)}) AND source.adapter IN (${placeholders(adapters)})
      AND source.next_run_at<=? AND (source.lease_expires_at IS NULL OR source.lease_expires_at<=?) ORDER BY source.next_run_at,source.id LIMIT 1${lock}`)
      .get(...spaces,...connectors,...adapters,input.now,input.now) as any;if(!row)return null;
    assertConnectorWorkerScope({principal:input.authority,spaceId:row.space_id,connectorId:row.connector_id,adapter:row.adapter,at:input.now});
    const token=crypto.randomUUID(),expires=new Date(Date.parse(input.now)+input.leaseSeconds*1000).toISOString(),fence=Number(row.fencing_token)+1,runId=crypto.randomUUID();
    const snapshot=row.phase==='scan'?(row.snapshot_at?iso(row.snapshot_at):input.now):(row.snapshot_at?iso(row.snapshot_at):null);
    this.db.prepare(`INSERT INTO journey_connector_import_runs(id,connector_id,space_id,state,checkpoint_revision,attempt_count,
      accepted_count,rejected_count,tombstone_count,created_by_user_id,created_at,updated_at) VALUES(?,?,?,'open',1,0,0,0,0,NULL,?,?)`)
      .run(runId,row.connector_id,row.space_id,input.now,input.now);
    const changed=this.db.prepare(`UPDATE journey_connector_worker_sources SET lease_token_sha256=?,lease_expires_at=?,lease_run_id=?,fencing_token=?,snapshot_at=?,updated_at=?
      WHERE id=? AND fencing_token=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).run(sha(token),expires,runId,fence,snapshot,input.now,row.id,row.fencing_token,input.now);
    if(!changed.changes)throw new JourneyConnectorWorkerError('Connector claim changed concurrently.','JOURNEY_CONNECTOR_WORKER_CLAIM_CONFLICT',409);
    this.event(row,'lease.claimed','CLAIMED',fence,{attempt:Number(row.attempt_count)},input.now);
    return Object.freeze({sourceId:String(row.id),runId,spaceId:String(row.space_id),connectorId:String(row.connector_id),adapter:row.adapter,
      leaseToken:token,fencingToken:fence,leaseExpiresAt:expires,phase:row.phase,snapshotAt:snapshot||null,cursorAt:row.cursor_at?iso(row.cursor_at):null,
      cursorId:row.phase==='scan'?(row.cursor_id||null):(row.deletion_cursor_id||null),surveyIds:Object.freeze(parse<string[]>(row.survey_ids_json,[])),pageSize:Number(row.page_size)});
  })();}
  private leased(lease:ConnectorWorkerLease,authority:JourneyConnectorWorkerPrincipal,at:string){this.assertStoredAuthority(authority,at);assertConnectorWorkerScope({principal:authority,spaceId:lease.spaceId,
    connectorId:lease.connectorId,adapter:lease.adapter,at});const row=this.db.prepare(`SELECT * FROM journey_connector_worker_sources WHERE id=? AND space_id=? AND connector_id=?`).get(lease.sourceId,lease.spaceId,lease.connectorId) as any;
    if(!row||Number(row.fencing_token)!==lease.fencingToken||row.lease_token_sha256!==sha(lease.leaseToken)||iso(row.lease_expires_at)<=at)
      throw new JourneyConnectorWorkerError('Connector lease is stale.','JOURNEY_CONNECTOR_WORKER_LEASE_STALE',409);return row;}
  ticketPage(lease:ConnectorWorkerLease){if(lease.phase!=='scan'||!lease.snapshotAt)throw new JourneyConnectorWorkerError('Lease is not a scan lease.','JOURNEY_CONNECTOR_WORKER_PHASE_INVALID',409);
    const after=lease.cursorAt?`AND (ticket.updated_at>? OR (ticket.updated_at=? AND ticket.id>?))`:'';
    const params:unknown[]=[lease.spaceId,...lease.surveyIds,lease.snapshotAt];if(lease.cursorAt)params.push(lease.cursorAt,lease.cursorAt,lease.cursorId||'');params.push(lease.pageSize);
    return this.db.prepare(`SELECT ticket.id,ticket.survey_id,ticket.priority,ticket.status,ticket.created_at,ticket.updated_at FROM tickets ticket
      JOIN surveys survey ON survey.id=ticket.survey_id AND survey.space_id=? WHERE ticket.survey_id IN (${placeholders(lease.surveyIds)})
      AND ticket.updated_at<=? ${after} ORDER BY ticket.updated_at,ticket.id LIMIT ?`).all(...params) as any[];}
  commitTicketPage(input:{authority:JourneyConnectorWorkerPrincipal;lease:ConnectorWorkerLease;rows:any[];at:string}){return this.db.transaction(()=>{
    const source=this.leased(input.lease,input.authority,input.at);if(source.phase!=='scan')throw new JourneyConnectorWorkerError('Source phase changed.','JOURNEY_CONNECTOR_WORKER_PHASE_INVALID',409);
    let accepted=0;for(const row of input.rows){if(!input.lease.surveyIds.includes(String(row.survey_id)))throw new JourneyConnectorWorkerError('Adapter row escaped source scope.','JOURNEY_CONNECTOR_WORKER_SOURCE_SCOPE_INVALID',500);
      const payload=ticketConnectorPayload({surveyId:String(row.survey_id),priority:String(row.priority),status:String(row.status),createdAt:String(row.created_at),updatedAt:String(row.updated_at)});
      const serialized=canonical(payload),externalId=`ticket:${String(row.id)}`,checksum=sha(canonical({externalId,operation:'upsert',payload}));
      this.db.prepare(`INSERT INTO journey_connector_records(connector_id,space_id,external_id,state,payload_json,payload_sha256,source_occurred_at,last_run_id,updated_at)
        VALUES(?,?,?,'active',?,?,?,?,?) ON CONFLICT(connector_id,space_id,external_id) DO UPDATE SET state='active',payload_json=excluded.payload_json,
        payload_sha256=excluded.payload_sha256,source_occurred_at=excluded.source_occurred_at,last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`)
        .run(input.lease.connectorId,input.lease.spaceId,externalId,serialized,sha(serialized),String(row.updated_at),input.lease.runId,input.at);
      this.db.prepare(`INSERT INTO journey_connector_worker_source_items(source_id,connector_id,space_id,source_record_id,survey_id,state,last_seen_generation,source_revision_sha256,updated_at)
        VALUES(?,?,?,?,?,'active',?,?,?) ON CONFLICT(source_id,source_record_id) DO UPDATE SET survey_id=excluded.survey_id,state='active',last_seen_generation=excluded.last_seen_generation,
        source_revision_sha256=excluded.source_revision_sha256,updated_at=excluded.updated_at`).run(input.lease.sourceId,input.lease.connectorId,input.lease.spaceId,String(row.id),String(row.survey_id),Number(source.generation)+1,sha(serialized),input.at);
      this.receipt(input.lease,externalId,'upsert','accepted','ITEM_ACCEPTED',checksum,input.at);accepted++;}
    const last=input.rows.at(-1),complete=input.rows.length<input.lease.pageSize;
    const changed=this.db.prepare(`UPDATE journey_connector_worker_sources SET phase=?,generation=?,cursor_at=?,cursor_id=?,deletion_cursor_id=NULL,
      lease_token_sha256=NULL,lease_expires_at=NULL,lease_run_id=NULL,attempt_count=0,last_error_code=NULL,next_run_at=?,updated_at=? WHERE id=? AND fencing_token=? AND lease_token_sha256=?`)
      .run(complete?'deletion':'scan',complete?Number(source.generation)+1:Number(source.generation),complete?null:String(last.updated_at),complete?null:String(last.id),
        input.at,input.at,input.lease.sourceId,input.lease.fencingToken,sha(input.lease.leaseToken));if(!changed.changes)throw new JourneyConnectorWorkerError('Connector lease changed concurrently.','JOURNEY_CONNECTOR_WORKER_LEASE_STALE',409);
    this.db.prepare(`UPDATE journey_connector_import_runs SET state=?,accepted_count=?,checkpoint_revision=2,updated_at=? WHERE id=? AND connector_id=? AND space_id=?`)
      .run(complete?'completed':'open',accepted,input.at,input.lease.runId,input.lease.connectorId,input.lease.spaceId);
    this.event(source,'page.committed','OK',input.lease.fencingToken,{accepted,phaseComplete:complete?1:0},input.at);return{accepted,phaseComplete:complete};
  })();}
  deletionPage(lease:ConnectorWorkerLease){if(lease.phase!=='deletion')throw new JourneyConnectorWorkerError('Lease is not a deletion lease.','JOURNEY_CONNECTOR_WORKER_PHASE_INVALID',409);
    return this.db.prepare(`SELECT source_record_id,survey_id FROM journey_connector_worker_source_items WHERE source_id=? AND state='active' AND source_record_id>?
      ORDER BY source_record_id LIMIT ?`).all(lease.sourceId,lease.cursorId||'',lease.pageSize) as any[];}
  commitDeletionPage(input:{authority:JourneyConnectorWorkerPrincipal;lease:ConnectorWorkerLease;rows:any[];at:string}){return this.db.transaction(()=>{
    const source=this.leased(input.lease,input.authority,input.at);if(source.phase!=='deletion')throw new JourneyConnectorWorkerError('Source phase changed.','JOURNEY_CONNECTOR_WORKER_PHASE_INVALID',409);
    let tombstones=0;for(const row of input.rows){const exists=input.lease.surveyIds.includes(String(row.survey_id))&&this.db.prepare(`SELECT ticket.id FROM tickets ticket
        JOIN surveys survey ON survey.id=ticket.survey_id AND survey.space_id=? WHERE ticket.id=? AND ticket.survey_id=?`).get(input.lease.spaceId,row.source_record_id,row.survey_id);
      if(!exists){const externalId=`ticket:${String(row.source_record_id)}`;this.db.prepare(`UPDATE journey_connector_records SET state='tombstoned',payload_json=NULL,
          payload_sha256=NULL,source_occurred_at=?,last_run_id=?,updated_at=? WHERE connector_id=? AND space_id=? AND external_id=?`)
          .run(input.at,input.lease.runId,input.at,input.lease.connectorId,input.lease.spaceId,externalId);
        this.receipt(input.lease,externalId,'delete','tombstoned','SOURCE_DELETED',null,input.at);this.db.prepare(`UPDATE journey_connector_worker_source_items
          SET state='tombstoned',updated_at=? WHERE source_id=? AND source_record_id=? AND state='active'`).run(input.at,input.lease.sourceId,row.source_record_id);tombstones++;}}
    const last=input.rows.at(-1),complete=input.rows.length<input.lease.pageSize,next=new Date(Date.parse(input.at)+Number(source.interval_seconds)*1000).toISOString();
    const changed=this.db.prepare(`UPDATE journey_connector_worker_sources SET phase=?,snapshot_at=?,cursor_at=NULL,cursor_id=NULL,deletion_cursor_id=?,
      lease_token_sha256=NULL,lease_expires_at=NULL,lease_run_id=NULL,attempt_count=0,last_error_code=NULL,next_run_at=?,updated_at=? WHERE id=? AND fencing_token=? AND lease_token_sha256=?`)
      .run(complete?'scan':'deletion',complete?null:source.snapshot_at,complete?null:String(last.source_record_id),complete?next:input.at,input.at,input.lease.sourceId,
        input.lease.fencingToken,sha(input.lease.leaseToken));if(!changed.changes)throw new JourneyConnectorWorkerError('Connector lease changed concurrently.','JOURNEY_CONNECTOR_WORKER_LEASE_STALE',409);
    this.db.prepare(`UPDATE journey_connector_import_runs SET state='completed',tombstone_count=?,checkpoint_revision=2,updated_at=? WHERE id=? AND connector_id=? AND space_id=?`)
      .run(tombstones,input.at,input.lease.runId,input.lease.connectorId,input.lease.spaceId);
    this.event(source,'deletion.committed','OK',input.lease.fencingToken,{tombstones,cycleComplete:complete?1:0},input.at);return{tombstones,cycleComplete:complete};
  })();}
  fail(input:{authority:JourneyConnectorWorkerPrincipal;lease:ConnectorWorkerLease;code:string;at:string}){return this.db.transaction(()=>{const source=this.leased(input.lease,input.authority,input.at);
    const connector=this.db.prepare(`SELECT maximum_attempts,base_retry_seconds FROM journey_connector_definitions WHERE id=? AND space_id=?`)
      .get(input.lease.connectorId,input.lease.spaceId) as any;
    if(!connector)throw new JourneyConnectorWorkerError('Connector retry policy is unavailable.','JOURNEY_CONNECTOR_WORKER_POLICY_UNAVAILABLE',409);
    const attempts=Number(source.attempt_count)+1,max=Number(connector.maximum_attempts),terminal=attempts>=max,
      delay=Math.min(3600,Math.max(1,2**Math.max(0,attempts-1)*Number(connector.base_retry_seconds)));
    const next=terminal?new Date(Date.parse(input.at)+86400000).toISOString():new Date(Date.parse(input.at)+delay*1000).toISOString();
    const changed=this.db.prepare(`UPDATE journey_connector_worker_sources SET state=?,attempt_count=?,last_error_code=?,next_run_at=?,lease_token_sha256=NULL,
      lease_expires_at=NULL,lease_run_id=NULL,updated_at=? WHERE id=? AND fencing_token=? AND lease_token_sha256=?`).run(terminal?'paused':'active',attempts,input.code.slice(0,100),next,input.at,
      input.lease.sourceId,input.lease.fencingToken,sha(input.lease.leaseToken));if(!changed.changes)throw new JourneyConnectorWorkerError('Connector lease changed concurrently.','JOURNEY_CONNECTOR_WORKER_LEASE_STALE',409);
    this.db.prepare(`UPDATE journey_connector_import_runs SET state='failed',attempt_count=?,last_error_code=?,retry_at=NULL,checkpoint_revision=2,updated_at=? WHERE id=?`)
      .run(attempts,input.code.slice(0,100),input.at,input.lease.runId);
    this.event(source,'lease.failed',terminal?'TERMINAL':'RETRY',input.lease.fencingToken,{attempts,retrySeconds:terminal?0:delay},input.at);return{terminal,retryAt:terminal?null:next};})();}
  reapExpired(at:string){return this.db.transaction(()=>{const rows=this.db.prepare(`SELECT * FROM journey_connector_worker_sources WHERE lease_expires_at IS NOT NULL AND lease_expires_at<=?`).all(at) as any[];let reaped=0;
    for(const row of rows){const changed=this.db.prepare(`UPDATE journey_connector_worker_sources SET lease_token_sha256=NULL,lease_expires_at=NULL,lease_run_id=NULL,next_run_at=?,
        last_error_code='LEASE_EXPIRED',updated_at=? WHERE id=? AND fencing_token=? AND lease_expires_at<=?`).run(at,at,row.id,row.fencing_token,at);
      if(changed.changes){if(row.lease_run_id)this.db.prepare(`UPDATE journey_connector_import_runs SET state='failed',last_error_code='LEASE_EXPIRED',
          checkpoint_revision=checkpoint_revision+1,updated_at=? WHERE id=? AND connector_id=? AND space_id=? AND state='open'`)
          .run(at,row.lease_run_id,row.connector_id,row.space_id);
        this.event(row,'lease.reaped','LEASE_EXPIRED',Number(row.fencing_token),{count:1},at);reaped++;}}return reaped;})();}
  private receipt(lease:ConnectorWorkerLease,externalId:string,operation:'upsert'|'delete',outcome:'accepted'|'tombstoned',code:string,checksum:string|null,at:string){
    this.db.prepare(`INSERT INTO journey_connector_item_receipts(id,run_id,connector_id,space_id,external_id_sha256,operation,outcome,code,item_checksum,checkpoint_revision,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(),lease.runId,lease.connectorId,lease.spaceId,sha(externalId),operation,outcome,code,checksum,at);}
  private event(source:any,eventType:string,code:string,fence:number,counts:Record<string,number>,at:string){this.db.prepare(`INSERT INTO journey_connector_worker_events
    (id,source_id,connector_id,space_id,event_type,code,fencing_token,counts_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(),source.id,source.connector_id,source.space_id,eventType,code,fence,json(counts),at);}
}
