import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { db, getCollector, getSurvey } from './database.js';
import { workflowActionSchema, type ReviewedWorkflowAction } from './journeyAdapterContracts.js';
import { decryptJourneyWebhookSecret, encryptJourneyWebhookSecret } from './journeyWebhookSecrets.js';
import { createRecoveryTicket } from './recovery.js';
import { createAssistantAction } from './assistantOperations.js';
import { sendInvitations } from './emailService.js';
import { assertSubscriptionFeature, assertSubscriptionQuota, consumeSubscriptionUsage } from './subscriptionEntitlements.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import { failJourneyAction } from './journeyActionRuntimeRepository.js';

export class JourneyReviewedAdapterError extends Error {
  constructor(message:string,public status=400,public code='JOURNEY_REVIEWED_ADAPTER_INVALID',
    public retryable=false,public details:Record<string,unknown>={}){super(message);this.name='JourneyReviewedAdapterError';}
}
const sha=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value);
const now=(value?:string)=>value||new Date().toISOString();
const secretContext=(spaceId:string,id:string)=>`journey-webhook:${spaceId}:${id}`;

function ensureSqliteSchema(){if(db.provider!=='sqlite')return;db.exec(`
  CREATE TABLE IF NOT EXISTS journey_webhook_destinations (
    id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,name TEXT NOT NULL,url TEXT NOT NULL,
    hostname TEXT NOT NULL,port INTEGER NOT NULL,secret_enc TEXT NOT NULL,secret_sha256 TEXT NOT NULL,state TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(id,space_id));
  CREATE INDEX IF NOT EXISTS journey_webhook_destinations_list ON journey_webhook_destinations(space_id,state,updated_at DESC,id);
  CREATE TABLE IF NOT EXISTS journey_adapter_execution_attempts (
    id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,action_id TEXT NOT NULL,space_id TEXT NOT NULL,adapter TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,fencing_token INTEGER NOT NULL,outcome TEXT NOT NULL,error_code TEXT,request_sha256 TEXT NOT NULL,
    provider_receipt_sha256 TEXT,safety_json TEXT NOT NULL CHECK(json_valid(safety_json)),created_at TEXT NOT NULL,
    UNIQUE(queue_id,attempt_number,outcome),FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
  CREATE INDEX IF NOT EXISTS journey_adapter_execution_attempts_history ON journey_adapter_execution_attempts(space_id,queue_id,attempt_number,id);
  CREATE TABLE IF NOT EXISTS journey_adapter_effect_receipts (
    id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,action_id TEXT NOT NULL,space_id TEXT NOT NULL,adapter TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,provider_reference_sha256 TEXT NOT NULL,response_sha256 TEXT NOT NULL,fencing_token INTEGER NOT NULL,
    created_at TEXT NOT NULL,UNIQUE(queue_id),UNIQUE(action_id),UNIQUE(space_id,idempotency_key),
    FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
  CREATE TABLE IF NOT EXISTS journey_adapter_internal_notifications (
    id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,space_id TEXT NOT NULL,target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
    title TEXT NOT NULL,body TEXT NOT NULL,severity TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(queue_id),
    FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
  CREATE INDEX IF NOT EXISTS journey_adapter_internal_notifications_inbox ON journey_adapter_internal_notifications(space_id,target_user_id,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS journey_webhook_dispatches (
    id TEXT PRIMARY KEY,queue_id TEXT NOT NULL,destination_id TEXT NOT NULL,space_id TEXT NOT NULL,nonce TEXT NOT NULL,
    signed_at TEXT NOT NULL,request_body_sha256 TEXT NOT NULL,state TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,
    response_status INTEGER,response_sha256 TEXT,last_error_code TEXT,updated_at TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(queue_id),UNIQUE(destination_id,nonce),FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
    FOREIGN KEY(destination_id,space_id) REFERENCES journey_webhook_destinations(id,space_id) ON DELETE NO ACTION);
  CREATE TRIGGER IF NOT EXISTS journey_adapter_execution_attempts_update_guard BEFORE UPDATE ON journey_adapter_execution_attempts BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_adapter_execution_attempts_delete_guard BEFORE DELETE ON journey_adapter_execution_attempts BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_adapter_effect_receipts_update_guard BEFORE UPDATE ON journey_adapter_effect_receipts BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_adapter_effect_receipts_delete_guard BEFORE DELETE ON journey_adapter_effect_receipts BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_adapter_internal_notifications_update_guard BEFORE UPDATE ON journey_adapter_internal_notifications BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_adapter_internal_notifications_delete_guard BEFORE DELETE ON journey_adapter_internal_notifications BEGIN SELECT RAISE(ABORT,'append-only');END;
`)}
ensureSqliteSchema();

function access(spaceId:string,userId:string,write=false){
  assertSubscriptionFeature(spaceId,'journeyOrchestration');
  const membership=db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId,userId) as any;
  if(!membership)throw new JourneyReviewedAdapterError('Space membership is required.',403,'JOURNEY_ADAPTER_FORBIDDEN');
  if(write&&(membership.role==='member'||!effectiveJourneyRole(spaceId,userId).capabilities.has('journeys.review')))
    throw new JourneyReviewedAdapterError('Journey reviewer access is required.',403,'JOURNEY_ADAPTER_REVIEW_REQUIRED');
}
function audit(spaceId:string,actorUserId:string,action:string,targetId:string,detail:Record<string,unknown>,at:string){
  const body=json(detail);db.prepare(`INSERT INTO journey_workflow_audit
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(),spaceId,actorUserId,action,'journey_adapter',targetId,body,sha(body),at);
}

function publicAddress(address:string):boolean{
  const family=net.isIP(address);if(!family)return false;
  if(family===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224
    ||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)
    ||(a===192&&b===0)||(a===198&&(b===18||b===19))||(a===198&&b===51)||(a===203&&b===0));}
  const normalized=address.toLowerCase();
  if(normalized==='::'||normalized==='::1'||normalized.startsWith('fe8')||normalized.startsWith('fe9')
      ||normalized.startsWith('fea')||normalized.startsWith('feb')||normalized.startsWith('fc')||normalized.startsWith('fd')
      ||normalized.startsWith('ff')||normalized.startsWith('2001:db8:')||normalized==='2001:db8::'
      ||normalized.startsWith('100:')||normalized.startsWith('2001:1'))return false;
  const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);if(mapped)return publicAddress(mapped[1]!);
  const mappedHex=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if(mappedHex){const high=parseInt(mappedHex[1]!,16),low=parseInt(mappedHex[2]!,16);
    return publicAddress(`${high>>8}.${high&255}.${low>>8}.${low&255}`);}
  return true;
}
export async function validateJourneyWebhookUrl(value:string,lookup:typeof dns.lookup=dns.lookup){
  let url:URL;try{url=new URL(value)}catch{throw new JourneyReviewedAdapterError('Webhook URL is invalid.',400,'WEBHOOK_URL_INVALID')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new JourneyReviewedAdapterError(
    'Webhook destinations must be credential-free HTTPS URLs without fragments.',400,'WEBHOOK_URL_UNSAFE');
  const hostname=url.hostname.toLowerCase().replace(/\.$/u,'');
  if(!hostname||hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw new JourneyReviewedAdapterError(
    'Webhook hostname is not public.',400,'WEBHOOK_HOST_NOT_PUBLIC');
  const records=await lookup(hostname,{all:true,verbatim:true});
  if(!records.length||records.some((record)=>!publicAddress(record.address)))throw new JourneyReviewedAdapterError(
    'Every resolved webhook address must be public.',400,'WEBHOOK_ADDRESS_NOT_PUBLIC');
  url.hostname=hostname;url.port=url.port||'443';
  return {url:url.toString(),hostname,port:Number(url.port),addresses:records.map((record)=>({address:record.address,family:record.family}))};
}

export async function createJourneyWebhookDestination(input:{spaceId:string;actorUserId:string;name:string;url:string;secret:string;
  lookup?:typeof dns.lookup;at?:string}){
  access(input.spaceId,input.actorUserId,true);const current=Number((db.prepare(
    'SELECT COUNT(*) count FROM journey_webhook_destinations WHERE space_id=?').get(input.spaceId) as any).count);
  assertSubscriptionQuota(input.spaceId,'webhookDestinations',current,1);
  const target=await validateJourneyWebhookUrl(input.url,input.lookup);const id=crypto.randomUUID(),at=now(input.at);
  db.transaction(()=>{db.prepare(`INSERT INTO journey_webhook_destinations
    (id,space_id,name,url,hostname,port,secret_enc,secret_sha256,state,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,?,?)`).run(id,input.spaceId,input.name,target.url,target.hostname,target.port,
      encryptJourneyWebhookSecret(input.secret,secretContext(input.spaceId,id)),sha(input.secret),input.actorUserId,input.actorUserId,at,at);
    audit(input.spaceId,input.actorUserId,'workflow.webhook_destination.created',id,
      {hostname:target.hostname,port:target.port,urlSha256:sha(target.url)},at)})();
  return {id,name:input.name,url:target.url,hostname:target.hostname,port:target.port,state:'active',revision:1,createdAt:at,updatedAt:at};
}
export function listJourneyWebhookDestinations(input:{spaceId:string;actorUserId:string}){
  access(input.spaceId,input.actorUserId);return (db.prepare(`SELECT id,name,url,hostname,port,state,revision,created_at,updated_at
    FROM journey_webhook_destinations WHERE space_id=? ORDER BY created_at,id`).all(input.spaceId) as any[]).map((row)=>({
      id:row.id,name:row.name,url:row.url,hostname:row.hostname,port:Number(row.port),state:row.state,revision:Number(row.revision),
      createdAt:row.created_at,updatedAt:row.updated_at}));
}
export async function updateJourneyWebhookDestination(input:{spaceId:string;actorUserId:string;id:string;expectedRevision:number;
  name?:string;url?:string;secret?:string;state?:'active'|'disabled';lookup?:typeof dns.lookup;at?:string}){
  access(input.spaceId,input.actorUserId,true);const row=db.prepare('SELECT * FROM journey_webhook_destinations WHERE id=? AND space_id=?')
    .get(input.id,input.spaceId) as any;if(!row)throw new JourneyReviewedAdapterError('Webhook destination not found.',404,'WEBHOOK_DESTINATION_NOT_FOUND');
  const target=input.url?await validateJourneyWebhookUrl(input.url,input.lookup):{url:row.url,hostname:row.hostname,port:Number(row.port)};
  const at=now(input.at),revision=input.expectedRevision+1;
  const changed=db.prepare(`UPDATE journey_webhook_destinations SET name=?,url=?,hostname=?,port=?,secret_enc=?,secret_sha256=?,
    state=?,revision=?,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(input.name??row.name,target.url,
      target.hostname,target.port,input.secret?encryptJourneyWebhookSecret(input.secret,secretContext(input.spaceId,input.id)):row.secret_enc,
      input.secret?sha(input.secret):row.secret_sha256,input.state??row.state,revision,input.actorUserId,at,input.id,input.spaceId,input.expectedRevision).changes;
  if(!changed)throw new JourneyReviewedAdapterError('Webhook destination revision conflict.',409,'WEBHOOK_DESTINATION_CONFLICT');
  audit(input.spaceId,input.actorUserId,'workflow.webhook_destination.updated',input.id,{revision,state:input.state??row.state,
    urlSha256:sha(target.url),secretRotated:Boolean(input.secret)},at);
  return listJourneyWebhookDestinations(input).find((item)=>item.id===input.id)!;
}

type LeaseInput={spaceId:string;actorUserId:string;queueId:string;leaseToken:string;fencingToken:number;at?:string};
export type ReviewedAdapterPorts={
  sendSurveyInvitation?:(input:{action:Extract<ReviewedWorkflowAction,{adapter:'survey_invitation'}>;idempotencyKey:string})=>Promise<unknown>;
  sendWebhook?:(input:{url:string;hostname:string;port:number;addresses:Array<{address:string;family:number}>;
    body:string;headers:Record<string,string>;timeoutMs:number})=>Promise<{status:number;body:string}>;
  beforeEffect?:(adapter:ReviewedWorkflowAction['adapter'])=>void;
  afterInternalEffect?:(adapter:'service_recovery_ticket'|'assistant_action'|'internal_notification')=>void;
  afterExternalEffect?:(adapter:'survey_invitation'|'signed_webhook')=>void;
  afterWebhookDispatchRecorded?:()=>void;
  lookup?:typeof dns.lookup;
};

function leased(input:LeaseInput,at:string){
  const row=db.prepare(`SELECT q.*,w.state workflow_state,w.paused workflow_paused,s.paused space_paused
    FROM journey_action_queue q JOIN journey_workflow_definitions w ON w.id=q.workflow_id AND w.space_id=q.space_id
    LEFT JOIN journey_orchestration_settings s ON s.space_id=q.space_id WHERE q.id=? AND q.space_id=?`)
    .get(input.queueId,input.spaceId) as any;
  if(!row)throw new JourneyReviewedAdapterError('Queued action not found.',404,'JOURNEY_ACTION_NOT_FOUND');
  if(row.state!=='leased'||row.lease_token!==input.leaseToken||Number(row.fencing_token)!==input.fencingToken
      ||Date.parse(row.lease_expires_at)<=Date.parse(at))throw new JourneyReviewedAdapterError('The action lease is stale.',409,'JOURNEY_ACTION_STALE_FENCE');
  if(row.workflow_state!=='published'||Boolean(row.workflow_paused)||Boolean(row.space_paused))throw new JourneyReviewedAdapterError(
    'Orchestration is paused.',409,'JOURNEY_ACTION_EXECUTION_PAUSED');
  const gateRows=db.prepare('SELECT gate_key,decision FROM journey_action_gate_resolutions WHERE queue_id=? AND space_id=?')
    .all(row.id,input.spaceId) as any[];
  const required=['consent','suppression','entitlement','quota','quiet_hours','frequency_cap','source_state','platform_kill_switch',
    'space_kill_switch','workflow_kill_switch','adapter_kill_switch','profile_kill_switch'];
  if(required.some((key)=>!gateRows.some((gate)=>gate.gate_key===key&&gate.decision==='allow')))throw new JourneyReviewedAdapterError(
    'Execution-time safety evidence is not allow.',409,'JOURNEY_ACTION_EXECUTION_SAFETY_HELD');
  const envelope=JSON.parse(String(row.payload_json));const reviewedAction=workflowActionSchema.parse(envelope.reviewedAction);
  if(reviewedAction.adapter!==row.adapter)throw new JourneyReviewedAdapterError('Adapter payload does not match the queue.',409,'JOURNEY_ACTION_ADAPTER_MISMATCH');
  return {row,reviewedAction,safety:{consent:'allow',suppression:'allow',quota:'allow',pause:'allow'}};
}

function requestHash(action:ReviewedWorkflowAction){return sha(json({adapter:action.adapter,payload:action.payload}));}
function attempt(row:any,input:LeaseInput,outcome:string,errorCode:string|null,requestSha:string,providerSha:string|null,
  safety:Record<string,string>,at:string){db.prepare(`INSERT INTO journey_adapter_execution_attempts
    (id,queue_id,action_id,space_id,adapter,attempt_number,fencing_token,outcome,error_code,request_sha256,
      provider_receipt_sha256,safety_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),row.id,row.action_id,
      input.spaceId,row.adapter,row.attempt_count,input.fencingToken,outcome,errorCode,requestSha,providerSha,json(safety),at)}

function holdForSafety(row:any,input:LeaseInput,errorCode:string,requestSha:string,safety:Record<string,string>,at:string){
  db.transaction(()=>{const changed=db.prepare(`UPDATE journey_action_queue SET state='held',hold_reason_code=?,lease_owner_sha256=NULL,
      lease_token=NULL,lease_expires_at=NULL,last_error_code=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`).run(errorCode,errorCode,at,row.id,
        input.spaceId,input.leaseToken,input.fencingToken).changes;
    if(!changed)throw new JourneyReviewedAdapterError('The action fence changed before it could be held.',409,'JOURNEY_ACTION_STALE_FENCE');
    attempt(row,input,'safety_held',errorCode,requestSha,null,safety,at);
    audit(input.spaceId,input.actorUserId,'workflow.adapter.safety_held',row.id,{adapter:row.adapter,errorCode,
      fencingToken:input.fencingToken},at)})();
}

function succeed(row:any,input:LeaseInput,providerReference:string,response:unknown,safety:Record<string,string>,at:string){
  return db.transaction(()=>{const existing=db.prepare('SELECT id,provider_reference_sha256 FROM journey_adapter_effect_receipts WHERE queue_id=? AND space_id=?')
      .get(row.id,input.spaceId) as any;if(existing)return {receiptId:existing.id,replayed:true,state:'succeeded'};
    const receiptId=crypto.randomUUID(),responseSha=sha(json(response)),providerSha=sha(providerReference);
    db.prepare(`INSERT INTO journey_adapter_effect_receipts
      (id,queue_id,action_id,space_id,adapter,idempotency_key,provider_reference_sha256,response_sha256,fencing_token,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(receiptId,row.id,row.action_id,input.spaceId,row.adapter,row.idempotency_key,providerSha,responseSha,input.fencingToken,at);
    const changed=db.prepare(`UPDATE journey_action_queue SET state='succeeded',lease_owner_sha256=NULL,lease_token=NULL,
      lease_expires_at=NULL,terminal_at=?,last_error_code=NULL,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`).run(at,at,row.id,input.spaceId,
        input.leaseToken,input.fencingToken).changes;
    if(!changed)throw new JourneyReviewedAdapterError('The action fence changed before completion.',409,'JOURNEY_ACTION_STALE_FENCE');
    attempt(row,input,'succeeded',null,requestHash(workflowActionSchema.parse(JSON.parse(String(row.payload_json)).reviewedAction)),providerSha,safety,at);
    audit(input.spaceId,input.actorUserId,'workflow.adapter.succeeded',row.id,{adapter:row.adapter,receiptId,
      providerReferenceSha256:providerSha,responseSha256:responseSha,fencingToken:input.fencingToken},at);
    return {receiptId,replayed:false,state:'succeeded'};})();
}

async function defaultSurvey(action:Extract<ReviewedWorkflowAction,{adapter:'survey_invitation'}>,spaceId:string){
  const survey=getSurvey(action.payload.surveyId,spaceId);const collector=getCollector(action.payload.collectorId);
  if(!survey||!collector||collector.surveyId!==survey.id)throw new JourneyReviewedAdapterError('Survey collector not found.',404,'SURVEY_COLLECTOR_NOT_FOUND');
  return sendInvitations(survey,collector,action.payload.recipients,action.payload.message);
}
export async function sendReviewedWebhook(input:Parameters<NonNullable<ReviewedAdapterPorts['sendWebhook']>>[0]){
  const address=input.addresses[0]!;
  return new Promise<{status:number;body:string}>((resolve,reject)=>{const request=https.request(input.url,{method:'POST',headers:input.headers,
      timeout:input.timeoutMs,lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family as 4|6)},(response)=>{
      const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>65_536){request.destroy(new Error('WEBHOOK_RESPONSE_TOO_LARGE'));return}chunks.push(chunk)});
      response.on('end',()=>resolve({status:Number(response.statusCode||0),body:Buffer.concat(chunks).toString('utf8')}));});
    request.on('timeout',()=>request.destroy(new Error('WEBHOOK_TIMEOUT')));request.on('error',reject);request.end(input.body)});
}

export async function executeReviewedJourneyAction(input:LeaseInput,ports:ReviewedAdapterPorts={}){
  access(input.spaceId,input.actorUserId,true);const at=now(input.at);
  const replay=db.prepare('SELECT id FROM journey_adapter_effect_receipts WHERE queue_id=? AND space_id=?').get(input.queueId,input.spaceId) as any;
  if(replay)return {receiptId:replay.id,replayed:true,state:'succeeded'};
  let state;try{state=leased(input,at)}catch(error){throw error}
  const {row,reviewedAction,safety}=state;const reqSha=requestHash(reviewedAction);
  if(reviewedAction.adapter==='survey_invitation'){
    const emails=reviewedAction.payload.recipients.map((item)=>item.email);
    const suppressed=emails.some((email)=>Boolean(db.prepare('SELECT 1 FROM email_suppressions WHERE space_id=? AND email=?').get(input.spaceId,email)));
    if(suppressed){holdForSafety(row,input,'RECIPIENT_SUPPRESSED',reqSha,{...safety,suppression:'deny'},at);
      throw new JourneyReviewedAdapterError('A survey recipient is suppressed.',409,'RECIPIENT_SUPPRESSED');}
  }
  // Quota is consumed once per reviewed action. Provider-unknown retries replay the same ledger intent and do not consume twice.
  try{consumeSubscriptionUsage({spaceId:input.spaceId,quota:'monthlyOrchestrationActions',idempotencyKey:`journey-adapter:${row.id}`,
    quantity:1,now:at,intent:{kind:'journey_reviewed_adapter',adapter:reviewedAction.adapter},
    sourceType:'journey_reviewed_adapter',sourceId:row.id,actorUserId:input.actorUserId});}
  catch(error){holdForSafety(row,input,'EXECUTION_QUOTA_DENIED',reqSha,{...safety,quota:'deny'},at);
    throw new JourneyReviewedAdapterError('Execution quota is unavailable.',409,'EXECUTION_QUOTA_DENIED',false,
      {cause:error instanceof Error?error.name:'unknown'});}
  try{
    ports.beforeEffect?.(reviewedAction.adapter);
    if(reviewedAction.adapter==='service_recovery_ticket'){
      return db.transaction(()=>{const ticket=createRecoveryTicket(input.spaceId,input.actorUserId,reviewedAction.payload);
        ports.afterInternalEffect?.('service_recovery_ticket');
        return succeed(row,input,String(ticket.id),{ticketIdSha256:sha(String(ticket.id))},safety,at)})();
    }
    if(reviewedAction.adapter==='assistant_action'){
      return db.transaction(()=>{const action=createAssistantAction({spaceId:input.spaceId,userId:input.actorUserId,...reviewedAction.payload});
        ports.afterInternalEffect?.('assistant_action');
        return succeed(row,input,String((action as any).id),{actionIdSha256:sha(String((action as any).id))},safety,at)})();
    }
    if(reviewedAction.adapter==='internal_notification'){
      const member=db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(input.spaceId,reviewedAction.payload.targetUserId);
      if(!member)throw new JourneyReviewedAdapterError('Notification target is not a space member.',409,'NOTIFICATION_TARGET_INVALID');
      const id=crypto.randomUUID();return db.transaction(()=>{db.prepare(`INSERT INTO journey_adapter_internal_notifications
        (id,queue_id,space_id,target_user_id,title,body,severity,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(id,row.id,input.spaceId,
          reviewedAction.payload.targetUserId,reviewedAction.payload.title,reviewedAction.payload.body,reviewedAction.payload.severity,at);
        ports.afterInternalEffect?.('internal_notification');
        return succeed(row,input,id,{notificationIdSha256:sha(id)},safety,at)})();
    }
    if(reviewedAction.adapter==='survey_invitation'){
      const result=ports.sendSurveyInvitation?await ports.sendSurveyInvitation({action:reviewedAction,idempotencyKey:row.idempotency_key})
        :await defaultSurvey(reviewedAction,input.spaceId);
      ports.afterExternalEffect?.('survey_invitation');
      return succeed(row,input,`survey:${row.idempotency_key}`,result,safety,at);
    }
    const destination=db.prepare("SELECT * FROM journey_webhook_destinations WHERE id=? AND space_id=? AND state='active'")
      .get(reviewedAction.payload.destinationId,input.spaceId) as any;
    if(!destination)throw new JourneyReviewedAdapterError('Webhook destination not found.',404,'WEBHOOK_DESTINATION_NOT_FOUND');
    if(Number(destination.revision)!==reviewedAction.payload.destinationRevision)throw new JourneyReviewedAdapterError(
      'Webhook destination changed after this action was reviewed.',409,'WEBHOOK_DESTINATION_REVISION_CHANGED');
    const target=await validateJourneyWebhookUrl(destination.url,ports.lookup);const body=json({eventType:reviewedAction.payload.eventType,
      data:reviewedAction.payload.data,idempotencyKey:row.idempotency_key});
    let dispatch=db.prepare('SELECT * FROM journey_webhook_dispatches WHERE queue_id=? AND space_id=?').get(row.id,input.spaceId) as any;
    if(!dispatch){const id=crypto.randomUUID(),nonce=crypto.randomUUID();db.prepare(`INSERT INTO journey_webhook_dispatches
      (id,queue_id,destination_id,space_id,nonce,signed_at,request_body_sha256,state,attempt_count,updated_at,created_at)
      VALUES (?,?,?,?,?,?,?,'prepared',0,?,?)`).run(id,row.id,destination.id,input.spaceId,nonce,at,sha(body),at,at);
      dispatch=db.prepare('SELECT * FROM journey_webhook_dispatches WHERE id=?').get(id)}
    if(dispatch.request_body_sha256!==sha(body))throw new JourneyReviewedAdapterError('Webhook replay body changed.',409,'WEBHOOK_REPLAY_CONFLICT');
    if(dispatch.state==='succeeded')return succeed(row,input,`webhook:${destination.id}:${dispatch.nonce}`,
      {status:Number(dispatch.response_status),responseSha256:dispatch.response_sha256},safety,at);
    const canonical=`${dispatch.signed_at}.${dispatch.nonce}.${body}`;const signature=crypto.createHmac('sha256',
      decryptJourneyWebhookSecret(destination.secret_enc,secretContext(input.spaceId,destination.id))).update(canonical).digest('hex');
    db.prepare("UPDATE journey_webhook_dispatches SET state='sending',attempt_count=attempt_count+1,updated_at=? WHERE id=?")
      .run(at,dispatch.id);
    const response=await (ports.sendWebhook||sendReviewedWebhook)({url:target.url,hostname:target.hostname,port:target.port,
      addresses:target.addresses,body,timeoutMs:5_000,headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),
        'x-seemplify-timestamp':dispatch.signed_at,'x-seemplify-nonce':dispatch.nonce,'x-seemplify-signature':`sha256=${signature}`,
        'idempotency-key':row.idempotency_key}});
    const responseBody=response.body.slice(0,65_536),responseSha=sha(responseBody);
    if(response.status<200||response.status>=300){const retryable=response.status===408||response.status===429||response.status>=500;
      db.prepare("UPDATE journey_webhook_dispatches SET state=?,response_status=?,response_sha256=?,last_error_code=?,updated_at=? WHERE id=?")
        .run(retryable?'retry_wait':'failed',response.status,responseSha,retryable?'WEBHOOK_RETRYABLE_STATUS':'WEBHOOK_REJECTED',at,dispatch.id);
      throw new JourneyReviewedAdapterError('Webhook returned an unsuccessful status.',502,
        retryable?'WEBHOOK_RETRYABLE_STATUS':'WEBHOOK_REJECTED',retryable,{status:response.status});}
    ports.afterExternalEffect?.('signed_webhook');
    db.prepare("UPDATE journey_webhook_dispatches SET state='succeeded',response_status=?,response_sha256=?,last_error_code=NULL,updated_at=? WHERE id=?")
      .run(response.status,responseSha,at,dispatch.id);
    ports.afterWebhookDispatchRecorded?.();
    return succeed(row,input,`webhook:${destination.id}:${dispatch.nonce}`,{status:response.status,responseSha256:responseSha},safety,at);
  }catch(error){
    const caught=error instanceof JourneyReviewedAdapterError?error:new JourneyReviewedAdapterError('Adapter execution failed.',502,
      'ADAPTER_EXECUTION_FAILED',true);
    if(caught.retryable){db.transaction(()=>{attempt(row,input,'retryable_failure',caught.code,reqSha,null,safety,at);
      failJourneyAction({...input,errorCode:caught.code,at})})();}
    else db.transaction(()=>{attempt(row,input,'permanent_failure',caught.code,reqSha,null,safety,at);
      db.prepare(`UPDATE journey_action_queue SET state='dead_letter',lease_owner_sha256=NULL,lease_token=NULL,
      lease_expires_at=NULL,terminal_at=?,last_error_code=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='leased'
      AND lease_token=? AND fencing_token=?`).run(at,caught.code,at,row.id,input.spaceId,input.leaseToken,input.fencingToken);
      audit(input.spaceId,input.actorUserId,'workflow.adapter.permanent_failure',row.id,{adapter:row.adapter,errorCode:caught.code,
        fencingToken:input.fencingToken},at)})();
    throw caught;
  }
}
