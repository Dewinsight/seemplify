import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './database.js';
import { assertSubscriptionFeature, assertSubscriptionQuota } from './subscriptionEntitlements.js';

export const approvedJourneyConnectorKinds = ['csv_upload', 'jsonl_upload', 'approved_object_store'] as const;
export type ApprovedJourneyConnectorKind = typeof approvedJourneyConnectorKinds[number];
export class JourneyConnectorImportError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_CONNECTOR_IMPORT_INVALID',
    public details: Record<string, unknown> = {}) { super(message); this.name = 'JourneyConnectorImportError'; }
}

const itemSchema = z.object({ externalId: z.string().trim().min(1).max(128), operation: z.enum(['upsert', 'delete']),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u), occurredAt: z.string().datetime(), payload: z.unknown().nullable() }).strict();
const now = (value?: string) => value || new Date().toISOString();
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, nested]) => [key, stable(nested)]));
}
const canonical = (value: unknown) => JSON.stringify(stable(value));
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const boolean = (value: unknown) => Boolean(value);

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_connector_definitions (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('csv_upload','jsonl_upload','approved_object_store')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160), state TEXT NOT NULL CHECK(state IN ('active','disabled')),
      deletion_mode TEXT NOT NULL DEFAULT 'tombstone' CHECK(deletion_mode='tombstone'),
      maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts BETWEEN 1 AND 10),
      base_retry_seconds INTEGER NOT NULL CHECK(base_retry_seconds BETWEEN 1 AND 300), revision INTEGER NOT NULL DEFAULT 1,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,space_id));
    CREATE INDEX IF NOT EXISTS journey_connector_definitions_list ON journey_connector_definitions(space_id,state,updated_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_connector_import_runs (
      id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, space_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','retry_wait','completed','failed','cancelled')),
      checkpoint_revision INTEGER NOT NULL DEFAULT 1, expected_cursor TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT, accepted_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0,
      tombstone_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,connector_id,space_id),
      FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION);
    CREATE INDEX IF NOT EXISTS journey_connector_import_runs_list ON journey_connector_import_runs(space_id,connector_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_connector_records (
      connector_id TEXT NOT NULL, space_id TEXT NOT NULL, external_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active','tombstoned')), payload_json TEXT,
      payload_sha256 TEXT, source_occurred_at TEXT NOT NULL, last_run_id TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(connector_id,space_id,external_id),
      FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION,
      FOREIGN KEY(last_run_id,connector_id,space_id) REFERENCES journey_connector_import_runs(id,connector_id,space_id) ON DELETE NO ACTION,
      CHECK((state='active' AND payload_json IS NOT NULL AND payload_sha256 IS NOT NULL) OR
        (state='tombstoned' AND payload_json IS NULL AND payload_sha256 IS NULL)));
    CREATE TABLE IF NOT EXISTS journey_connector_item_receipts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, connector_id TEXT NOT NULL, space_id TEXT NOT NULL,
      external_id_sha256 TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('upsert','delete','invalid')),
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected','tombstoned')),
      code TEXT NOT NULL, item_checksum TEXT, checkpoint_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(run_id,connector_id,space_id) REFERENCES journey_connector_import_runs(id,connector_id,space_id) ON DELETE NO ACTION);
    CREATE INDEX IF NOT EXISTS journey_connector_item_receipts_list ON journey_connector_item_receipts(space_id,run_id,created_at,id);
    CREATE TABLE IF NOT EXISTS journey_connector_idempotency (
      space_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      intent_sha256 TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at TEXT NOT NULL,
      PRIMARY KEY(space_id,actor_user_id,operation,idempotency_key));
    CREATE TABLE IF NOT EXISTS journey_connector_audit (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), detail_sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS journey_connector_audit_list ON journey_connector_audit(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_connector_receipts_append_only BEFORE UPDATE ON journey_connector_item_receipts
      BEGIN SELECT RAISE(ABORT,'connector receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_connector_receipts_delete_guard BEFORE DELETE ON journey_connector_item_receipts
      BEGIN SELECT RAISE(ABORT,'connector receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_connector_audit_append_only BEFORE UPDATE ON journey_connector_audit
      BEGIN SELECT RAISE(ABORT,'connector audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_connector_audit_delete_guard BEFORE DELETE ON journey_connector_audit
      BEGIN SELECT RAISE(ABORT,'connector audit is append-only'); END;
  `);
}
ensureSqliteSchema();

function access(spaceId: string, actorUserId: string) {
  assertSubscriptionFeature(spaceId, 'journeyConnectors');
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, actorUserId) as { role?: string } | undefined;
  if (!membership) throw new JourneyConnectorImportError('Space membership is required.', 403, 'JOURNEY_CONNECTOR_MEMBERSHIP_REQUIRED');
  return String(membership.role);
}
function manage(spaceId: string, actorUserId: string) {
  if (access(spaceId, actorUserId) === 'member') throw new JourneyConnectorImportError(
    'Owner or administrator access is required.', 403, 'JOURNEY_CONNECTOR_MANAGER_REQUIRED');
}
function requireIdempotency(key: string) {
  if (!key || key.length > 200) throw new JourneyConnectorImportError('A valid Idempotency-Key is required.', 400,
    'JOURNEY_CONNECTOR_IDEMPOTENCY_KEY_REQUIRED');
}
function mutation<T extends Record<string, unknown>>(input: { spaceId: string; actorUserId: string; operation: string;
  idempotencyKey: string; intent: unknown; run: () => T }): T & { replayed: boolean } {
  requireIdempotency(input.idempotencyKey); const intentSha = hash(canonical(input.intent));
  const readStored = () => db.prepare(`SELECT intent_sha256,response_json FROM journey_connector_idempotency
    WHERE space_id=? AND actor_user_id=? AND operation=? AND idempotency_key=?`)
    .get(input.spaceId, input.actorUserId, input.operation, input.idempotencyKey) as any;
  const stored = readStored();
  if (stored) {
    if (stored.intent_sha256 !== intentSha) throw new JourneyConnectorImportError(
      'The idempotency key was already used for a different request.', 409, 'JOURNEY_CONNECTOR_IDEMPOTENCY_CONFLICT');
    return { ...parse<T>(stored.response_json, {} as T), replayed: true };
  }
  let result!: T; let replayed = false;
  db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
      .get(`${input.spaceId}:${input.actorUserId}:${input.operation}:${input.idempotencyKey}`);
    const concurrent = readStored();
    if (concurrent) {
      if (concurrent.intent_sha256 !== intentSha) throw new JourneyConnectorImportError(
        'The idempotency key was already used for a different request.', 409, 'JOURNEY_CONNECTOR_IDEMPOTENCY_CONFLICT');
      result = parse<T>(concurrent.response_json, {} as T); replayed = true; return;
    }
    result = input.run(); db.prepare(`INSERT INTO journey_connector_idempotency
    (space_id,actor_user_id,operation,idempotency_key,intent_sha256,response_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(input.spaceId, input.actorUserId, input.operation, input.idempotencyKey, intentSha, canonical(result), now()); })();
  return { ...result, replayed };
}
function audit(spaceId: string, actorUserId: string, action: string, targetType: string, targetId: string,
  detail: Record<string, string | number | boolean | null>, at: string) {
  const forbidden = /content|payload|secret|token|cursor|external.?id/iu;
  if (Object.keys(detail).some((key) => forbidden.test(key))) throw new JourneyConnectorImportError(
    'Content or secret-bearing fields cannot be written to connector audit.', 500, 'JOURNEY_CONNECTOR_AUDIT_UNSAFE');
  const serialized = canonical(detail); db.prepare(`INSERT INTO journey_connector_audit
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, targetId, serialized, hash(serialized), at);
}
function connector(row: any) { return { id: String(row.id), kind: row.kind as ApprovedJourneyConnectorKind, name: String(row.name),
  state: row.state as 'active'|'disabled', deletionMode: 'tombstone' as const, maximumAttempts: Number(row.maximum_attempts),
  baseRetrySeconds: Number(row.base_retry_seconds), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function runRecord(row: any) { return { id: String(row.id), connectorId: String(row.connector_id), state: row.state as string,
  checkpointRevision: Number(row.checkpoint_revision), expectedCursor: row.expected_cursor || null, attemptCount: Number(row.attempt_count),
  retryAt: row.retry_at || null, acceptedCount: Number(row.accepted_count), rejectedCount: Number(row.rejected_count),
  tombstoneCount: Number(row.tombstone_count), lastErrorCode: row.last_error_code || null,
  createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function getConnectorRow(spaceId: string, id: string) {
  const row = db.prepare('SELECT * FROM journey_connector_definitions WHERE id=? AND space_id=?').get(id, spaceId) as any;
  if (!row) throw new JourneyConnectorImportError('Connector not found.', 404, 'JOURNEY_CONNECTOR_NOT_FOUND'); return row;
}
function getRunRow(spaceId: string, id: string) {
  const row = db.prepare('SELECT * FROM journey_connector_import_runs WHERE id=? AND space_id=?').get(id, spaceId) as any;
  if (!row) throw new JourneyConnectorImportError('Import run not found.', 404, 'JOURNEY_CONNECTOR_IMPORT_NOT_FOUND'); return row;
}

export function createJourneyConnector(input: { spaceId: string; actorUserId: string; kind: ApprovedJourneyConnectorKind; name: string;
  maximumAttempts: number; baseRetrySeconds: number; idempotencyKey: string; at?: string }) {
  manage(input.spaceId, input.actorUserId); const intent = { kind: input.kind, name: input.name,
    maximumAttempts: input.maximumAttempts, baseRetrySeconds: input.baseRetrySeconds };
  return mutation({ ...input, operation: 'connector.create', intent, run: () => { const id=crypto.randomUUID(), at=now(input.at);
    if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
      .get(`journey-connector-quota:${input.spaceId}`);
    const current=Number((db.prepare(`SELECT COUNT(*) count FROM journey_connector_definitions
      WHERE space_id=?`).get(input.spaceId) as any).count);
    assertSubscriptionQuota(input.spaceId,'journeyConnectorDefinitions',current,1);
    db.prepare(`INSERT INTO journey_connector_definitions (id,space_id,kind,name,state,deletion_mode,maximum_attempts,
      base_retry_seconds,revision,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'active','tombstone',?,?,1,?,?,?,?)`)
      .run(id,input.spaceId,input.kind,input.name,input.maximumAttempts,input.baseRetrySeconds,input.actorUserId,input.actorUserId,at,at);
    audit(input.spaceId,input.actorUserId,'connector.created','connector',id,{kind:input.kind,revision:1},at);
    return { connector:connector(getConnectorRow(input.spaceId,id)) }; }});
}
export function listJourneyConnectors(input: { spaceId: string; actorUserId: string }) {
  access(input.spaceId,input.actorUserId); return (db.prepare(`SELECT * FROM journey_connector_definitions WHERE space_id=?
    ORDER BY updated_at DESC,id`).all(input.spaceId) as any[]).map(connector);
}
export function updateJourneyConnectorState(input: { spaceId:string; actorUserId:string; connectorId:string; expectedRevision:number;
  state:'active'|'disabled'; idempotencyKey:string; at?:string }) {
  manage(input.spaceId,input.actorUserId); getConnectorRow(input.spaceId,input.connectorId);
  return mutation({...input,operation:'connector.state',intent:{id:input.connectorId,revision:input.expectedRevision,state:input.state},run:()=>{
    const at=now(input.at); const changed=db.prepare(`UPDATE journey_connector_definitions SET state=?,revision=revision+1,
      updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(input.state,input.actorUserId,at,
      input.connectorId,input.spaceId,input.expectedRevision); if(!changed.changes) throw new JourneyConnectorImportError(
        'Connector revision conflict.',409,'JOURNEY_CONNECTOR_REVISION_CONFLICT');
    audit(input.spaceId,input.actorUserId,'connector.state_changed','connector',input.connectorId,{state:input.state,revision:input.expectedRevision+1},at);
    return {connector:connector(getConnectorRow(input.spaceId,input.connectorId))};}});
}
export function startJourneyConnectorImport(input:{spaceId:string;actorUserId:string;connectorId:string;idempotencyKey:string;at?:string}) {
  manage(input.spaceId,input.actorUserId); const source=getConnectorRow(input.spaceId,input.connectorId);
  if(source.state!=='active') throw new JourneyConnectorImportError('Connector is disabled.',409,'JOURNEY_CONNECTOR_DISABLED');
  return mutation({...input,operation:'import.start',intent:{connectorId:input.connectorId},run:()=>{const id=crypto.randomUUID(),at=now(input.at);
    db.prepare(`INSERT INTO journey_connector_import_runs (id,connector_id,space_id,state,checkpoint_revision,attempt_count,
      accepted_count,rejected_count,tombstone_count,created_by_user_id,created_at,updated_at) VALUES (?,?,?,'open',1,0,0,0,0,?,?,?)`)
      .run(id,input.connectorId,input.spaceId,input.actorUserId,at,at); audit(input.spaceId,input.actorUserId,'import.started','import',id,{revision:1},at);
    return {run:runRecord(getRunRow(input.spaceId,id))};}});
}

export function submitJourneyConnectorPage(input:{spaceId:string;actorUserId:string;runId:string;expectedCheckpointRevision:number;
  cursor:string|null;nextCursor:string|null;providerOutcome:'ok'|'rate_limited'|'transient_failure';retryAfterSeconds?:number;
  items:unknown[];idempotencyKey:string;at?:string}) {
  manage(input.spaceId,input.actorUserId); const current=getRunRow(input.spaceId,input.runId); const source=getConnectorRow(input.spaceId,current.connector_id);
  return mutation({...input,operation:'import.page',intent:{runId:input.runId,expectedCheckpointRevision:input.expectedCheckpointRevision,
    cursor:input.cursor,nextCursor:input.nextCursor,providerOutcome:input.providerOutcome,retryAfterSeconds:input.retryAfterSeconds,items:input.items},run:()=>{
    if(!['open','retry_wait'].includes(current.state)) throw new JourneyConnectorImportError('Import is not writable.',409,'JOURNEY_CONNECTOR_IMPORT_CLOSED');
    if(Number(current.checkpoint_revision)!==input.expectedCheckpointRevision) throw new JourneyConnectorImportError(
      'Import checkpoint revision conflict.',409,'JOURNEY_CONNECTOR_CHECKPOINT_CONFLICT',{currentRevision:Number(current.checkpoint_revision)});
    if((current.expected_cursor||null)!==input.cursor) throw new JourneyConnectorImportError(
      'The supplied cursor does not match the persisted checkpoint.',409,'JOURNEY_CONNECTOR_CURSOR_CONFLICT');
    const at=now(input.at); if(input.providerOutcome!=='ok') {
      if(input.items.length) throw new JourneyConnectorImportError('Failed provider pages cannot include items.',400,'JOURNEY_CONNECTOR_FAILED_PAGE_ITEMS');
      if(input.nextCursor!==input.cursor) throw new JourneyConnectorImportError('Failed pages cannot advance the cursor.',400,
        'JOURNEY_CONNECTOR_FAILED_PAGE_CURSOR');
      const attempts=Number(current.attempt_count)+1; const bounded=Math.min(3600,Math.max(1,input.retryAfterSeconds||Number(source.base_retry_seconds)));
      const terminal=attempts>=Number(source.maximum_attempts); const retryAt=terminal?null:new Date(new Date(at).getTime()+bounded*1000).toISOString();
      const changed=db.prepare(`UPDATE journey_connector_import_runs SET state=?,attempt_count=?,retry_at=?,last_error_code=?,checkpoint_revision=checkpoint_revision+1,
        updated_at=? WHERE id=? AND space_id=? AND checkpoint_revision=? AND COALESCE(expected_cursor,'')=COALESCE(?,'')`)
        .run(terminal?'failed':'retry_wait',attempts,retryAt,
          input.providerOutcome==='rate_limited'?'PROVIDER_RATE_LIMITED':'PROVIDER_TRANSIENT_FAILURE',at,input.runId,input.spaceId,
          input.expectedCheckpointRevision,input.cursor);
      if(!changed.changes) throw new JourneyConnectorImportError('Import checkpoint changed concurrently.',409,'JOURNEY_CONNECTOR_CHECKPOINT_CONFLICT');
      audit(input.spaceId,input.actorUserId,'import.retry_recorded','import',input.runId,{attempt:attempts,retrySeconds:terminal?0:bounded,terminal},at);
      return {run:runRecord(getRunRow(input.spaceId,input.runId)),receipts:[]};
    }
    if(input.items.length>200) throw new JourneyConnectorImportError('An import page may contain at most 200 items.',400,'JOURNEY_CONNECTOR_PAGE_TOO_LARGE');
    const receipts:Array<Record<string,unknown>>=[]; let accepted=0,rejected=0,tombstones=0; const seen=new Set<string>();
    for(const [index,raw] of input.items.entries()) {
      const parsed=itemSchema.safeParse(raw); let externalId=`invalid:${index}`, operation:'upsert'|'delete'|'invalid'='invalid', checksum:string|null=null;
      let outcome:'accepted'|'rejected'|'tombstoned'='rejected',code='ITEM_INVALID';
      if(parsed.success) { const item=parsed.data; externalId=item.externalId; operation=item.operation; checksum=item.checksum;
        const fingerprint=hash(externalId); const duplicate=seen.has(fingerprint); seen.add(fingerprint);
        const serialized=item.payload===null?'null':canonical(item.payload); const expected=hash(canonical({externalId:item.externalId,operation:item.operation,payload:item.payload}));
        const existing=db.prepare(`SELECT state,source_occurred_at FROM journey_connector_records WHERE connector_id=? AND space_id=? AND external_id=?`)
          .get(source.id,input.spaceId,item.externalId) as any;
        if(duplicate) code='ITEM_DUPLICATE_IN_PAGE';
        else if(Buffer.byteLength(serialized)>16_384) code='ITEM_PAYLOAD_TOO_LARGE';
        else if(expected!==item.checksum) code='ITEM_CHECKSUM_MISMATCH';
        else if(item.operation==='delete'&&item.payload!==null) code='DELETE_PAYLOAD_FORBIDDEN';
        else if(existing?.state==='tombstoned'&&item.operation==='upsert') code='ITEM_TOMBSTONED';
        else if(existing&&String(existing.source_occurred_at)>item.occurredAt) code='ITEM_STALE';
        else { if(item.operation==='delete') { db.prepare(`INSERT INTO journey_connector_records
            (connector_id,space_id,external_id,state,payload_json,payload_sha256,source_occurred_at,last_run_id,updated_at)
            VALUES (?,?,?,'tombstoned',NULL,NULL,?,?,?) ON CONFLICT(connector_id,space_id,external_id) DO UPDATE SET
            state='tombstoned',payload_json=NULL,payload_sha256=NULL,source_occurred_at=excluded.source_occurred_at,last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`)
            .run(source.id,input.spaceId,item.externalId,item.occurredAt,input.runId,at); outcome='tombstoned';code='ITEM_TOMBSTONED';tombstones++; }
          else { db.prepare(`INSERT INTO journey_connector_records
            (connector_id,space_id,external_id,state,payload_json,payload_sha256,source_occurred_at,last_run_id,updated_at)
            VALUES (?,?,?,'active',?,?,?,?,?) ON CONFLICT(connector_id,space_id,external_id) DO UPDATE SET
            state='active',payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256,source_occurred_at=excluded.source_occurred_at,last_run_id=excluded.last_run_id,updated_at=excluded.updated_at`)
            .run(source.id,input.spaceId,item.externalId,serialized,hash(serialized),item.occurredAt,input.runId,at); outcome='accepted';code='ITEM_ACCEPTED';accepted++; } }
      }
      if(outcome==='rejected') rejected++; const externalSha=hash(externalId);
      const receipt={id:crypto.randomUUID(),externalIdSha256:externalSha,operation,outcome,code,itemChecksum:checksum,
        checkpointRevision:input.expectedCheckpointRevision,createdAt:at};
      db.prepare(`INSERT INTO journey_connector_item_receipts (id,run_id,connector_id,space_id,external_id_sha256,operation,outcome,code,
        item_checksum,checkpoint_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(receipt.id,input.runId,source.id,input.spaceId,
        externalSha,operation,outcome,code,checksum,input.expectedCheckpointRevision,at); receipts.push(receipt);
    }
    const state=input.nextCursor===null?'completed':'open'; const changed=db.prepare(`UPDATE journey_connector_import_runs SET state=?,expected_cursor=?,
      checkpoint_revision=checkpoint_revision+1,retry_at=NULL,last_error_code=NULL,accepted_count=accepted_count+?,rejected_count=rejected_count+?,
      tombstone_count=tombstone_count+?,updated_at=? WHERE id=? AND space_id=? AND checkpoint_revision=?
      AND COALESCE(expected_cursor,'')=COALESCE(?,'')`).run(state,input.nextCursor,accepted,rejected,tombstones,at,input.runId,input.spaceId,
        input.expectedCheckpointRevision,input.cursor);
    if(!changed.changes) throw new JourneyConnectorImportError('Import checkpoint changed concurrently.',409,'JOURNEY_CONNECTOR_CHECKPOINT_CONFLICT');
    audit(input.spaceId,input.actorUserId,'import.page_committed','import',input.runId,{accepted,rejected,tombstones,
      revision:input.expectedCheckpointRevision+1,complete:state==='completed'},at);
    return {run:runRecord(getRunRow(input.spaceId,input.runId)),receipts}; }});
}

export function getJourneyConnectorImport(input:{spaceId:string;actorUserId:string;runId:string}) {
  access(input.spaceId,input.actorUserId); return runRecord(getRunRow(input.spaceId,input.runId));
}
export function listJourneyConnectorReceipts(input:{spaceId:string;actorUserId:string;runId:string;limit?:number;cursor?:string}) {
  access(input.spaceId,input.actorUserId); getRunRow(input.spaceId,input.runId); const limit=Math.min(100,Math.max(1,input.limit||50));
  let after:{createdAt:string;id:string}|null=null; if(input.cursor) { try { after=z.object({createdAt:z.string().datetime(),id:z.string().uuid()}).strict()
      .parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString())); }
    catch { throw new JourneyConnectorImportError('Receipt cursor is invalid.',400,'JOURNEY_CONNECTOR_CURSOR_INVALID'); } }
  const rows=(after?db.prepare(`SELECT * FROM journey_connector_item_receipts WHERE space_id=? AND run_id=? AND
    (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT ?`).all(input.spaceId,input.runId,after.createdAt,after.createdAt,after.id,limit+1)
    :db.prepare(`SELECT * FROM journey_connector_item_receipts WHERE space_id=? AND run_id=? ORDER BY created_at,id LIMIT ?`)
      .all(input.spaceId,input.runId,limit+1)) as any[]; const page=rows.slice(0,limit);
  return {items:page.map((row)=>({id:String(row.id),externalIdSha256:String(row.external_id_sha256),operation:row.operation,
    outcome:row.outcome,code:String(row.code),itemChecksum:row.item_checksum||null,checkpointRevision:Number(row.checkpoint_revision),
    createdAt:String(row.created_at)})),nextCursor:rows.length>limit?Buffer.from(JSON.stringify({createdAt:page.at(-1).created_at,id:page.at(-1).id})).toString('base64url'):null};
}
export function listJourneyConnectorAudit(input:{spaceId:string;actorUserId:string;limit?:number}) {
  access(input.spaceId,input.actorUserId); const limit=Math.min(100,Math.max(1,input.limit||50));
  return (db.prepare(`SELECT id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at FROM journey_connector_audit
    WHERE space_id=? ORDER BY created_at DESC,id LIMIT ?`).all(input.spaceId,limit) as any[]).map((row)=>({id:String(row.id),
      actorUserId:row.actor_user_id||null,action:String(row.action),targetType:String(row.target_type),targetId:String(row.target_id),
      detail:parse(row.detail_json,{}),detailSha256:String(row.detail_sha256),createdAt:String(row.created_at)}));
}

export function journeyConnectorItemChecksum(value:{externalId:string;operation:'upsert'|'delete';payload:unknown|null}) {
  return hash(canonical({ externalId:value.externalId, operation:value.operation, payload:value.payload }));
}
