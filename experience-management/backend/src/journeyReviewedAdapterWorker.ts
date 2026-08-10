import crypto from 'node:crypto';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { workflowActionSchema, type ReviewedWorkflowAction } from './journeyAdapterContracts.js';
import { decryptJourneyWebhookSecret } from './journeyWebhookSecrets.js';
import { sendReviewedWebhook, validateJourneyWebhookUrl, type ReviewedAdapterPorts } from './journeyReviewedAdapters.js';
import type { WorkerAuthority } from './journeyActionWorkerDomain.js';
import type { JourneyActionWorkerService, WorkerLease } from './journeyActionWorkerService.js';

const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value);
const supported=new Set(['service_recovery_ticket','assistant_action','internal_notification','signed_webhook']);
export const reviewedWorkerAdapters=Object.freeze([...supported]);

export class JourneyReviewedAdapterWorkerError extends Error{
  constructor(message:string,public readonly code:string,public readonly retryable=false){super(message);this.name='JourneyReviewedAdapterWorkerError';}
}

type Ports=Pick<ReviewedAdapterPorts,'sendWebhook'|'lookup'|'beforeEffect'|'afterInternalEffect'|'afterExternalEffect'|'afterWebhookDispatchRecorded'>;

export class JourneyReviewedAdapterWorker{
  constructor(private readonly db:DatabaseRuntime,private readonly service:JourneyActionWorkerService,private readonly ports:Ports={}){}

  async execute(authority:WorkerAuthority,lease:WorkerLease){
    if(!supported.has(lease.adapter))throw new JourneyReviewedAdapterWorkerError(
      lease.adapter==='survey_invitation'
        ? 'Survey invitation worker dispatch is disabled until its provider proves durable idempotency.'
        : 'The reviewed adapter is not enabled for durable worker execution.',
      lease.adapter==='survey_invitation'?'WORKER_SURVEY_PROVIDER_IDEMPOTENCY_REQUIRED':'WORKER_ADAPTER_UNSUPPORTED');
    const row=this.db.prepare(`SELECT q.*,a.run_id,approval.reviewer_user_id,run.actor_user_id run_actor_user_id
      FROM journey_action_queue q JOIN journey_workflow_actions a ON a.id=q.action_id AND a.space_id=q.space_id
      JOIN journey_workflow_runs run ON run.id=a.run_id AND run.space_id=a.space_id
      LEFT JOIN journey_workflow_approvals approval ON approval.action_id=a.id AND approval.space_id=a.space_id
      WHERE q.id=? AND q.space_id=?`).get(lease.queueId,lease.spaceId) as any;
    if(!row||row.state!=='leased'||row.lease_token!==lease.leaseToken||Number(row.fencing_token)!==lease.fencingToken)
      throw new JourneyReviewedAdapterWorkerError('The reviewed action fence is stale.','WORKER_RESERVATION_STALE_FENCE');
    const envelope=typeof row.payload_json==='string'?JSON.parse(row.payload_json):row.payload_json;
    const action=workflowActionSchema.parse(envelope.reviewedAction) as ReviewedWorkflowAction;
    if(action.adapter!==lease.adapter)throw new JourneyReviewedAdapterWorkerError('Reviewed payload adapter mismatch.','WORKER_ADAPTER_MISMATCH');
    const requestSha256=sha(json({adapter:action.adapter,payload:action.payload}));
    this.ports.beforeEffect?.(action.adapter);
    if(action.adapter==='signed_webhook')return this.webhook(authority,lease,row,action,requestSha256);
    if(action.adapter==='survey_invitation')throw new JourneyReviewedAdapterWorkerError(
      'Survey invitation worker dispatch requires a durable-idempotency provider.','WORKER_SURVEY_PROVIDER_IDEMPOTENCY_REQUIRED');
    const actor=String(row.reviewer_user_id||row.run_actor_user_id||'');
    if(!actor||!this.db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(lease.spaceId,actor))
      throw new JourneyReviewedAdapterWorkerError('The reviewed action no longer has an active tenant reviewer.','WORKER_REVIEWER_UNAVAILABLE');
    const effectId=crypto.randomUUID();
    const effect=()=>{
      if(action.adapter==='internal_notification'){
        if(!this.db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(lease.spaceId,action.payload.targetUserId))
          throw new JourneyReviewedAdapterWorkerError('Notification target is not a space member.','NOTIFICATION_TARGET_INVALID');
        this.db.prepare(`INSERT INTO journey_adapter_internal_notifications
          (id,queue_id,space_id,target_user_id,title,body,severity,created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(effectId,row.id,lease.spaceId,action.payload.targetUserId,action.payload.title,action.payload.body,action.payload.severity,new Date().toISOString());
      }else if(action.adapter==='assistant_action'){
        this.db.prepare(`INSERT INTO assistant_actions
          (id,space_id,created_by,source_run_id,source_item_index,title,description,owner,status,priority,due_at,revision,completed_at,created_at,updated_at)
          VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,1,NULL,?,?)`).run(effectId,lease.spaceId,actor,action.payload.title,
            action.payload.description||'',action.payload.owner||'','open',action.payload.priority||'normal',action.payload.dueAt||null,
            new Date().toISOString(),new Date().toISOString());
        this.db.prepare(`INSERT INTO assistant_audit_events(id,space_id,actor_user_id,action,target_type,target_id,detail_json,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),lease.spaceId,actor,'assistant.action.created','action',effectId,
            json({source:'journey_action_worker',queueIdSha256:sha(row.id)}),new Date().toISOString());
      }else{
        const survey=this.db.prepare('SELECT id FROM surveys WHERE id=? AND space_id=?').get(action.payload.surveyId,lease.spaceId) as any;
        if(!survey)throw new JourneyReviewedAdapterWorkerError('Survey not found.','SURVEY_NOT_FOUND');
        if(action.payload.responseId&&!this.db.prepare('SELECT 1 FROM responses WHERE id=? AND survey_id=?').get(action.payload.responseId,survey.id))
          throw new JourneyReviewedAdapterWorkerError('Response not found for this survey.','RESPONSE_NOT_FOUND');
        this.db.prepare(`INSERT INTO tickets(id,survey_id,response_id,title,priority,status,owner,notes,created_at,updated_at)
          VALUES (?,?,?,?,?,'open',?,?,?,?)`).run(effectId,survey.id,action.payload.responseId||null,action.payload.title,
            action.payload.priority||'normal',action.payload.owner||'',action.payload.notes||'',new Date().toISOString(),new Date().toISOString());
        this.db.prepare(`INSERT INTO ticket_events(id,ticket_id,actor_user_id,event_type,detail_json,created_at) VALUES (?,?,?,?,?,?)`)
          .run(crypto.randomUUID(),effectId,actor,'created',json({source:'journey_action_worker',queueIdSha256:sha(row.id)}),new Date().toISOString());
      }
      this.ports.afterInternalEffect?.(action.adapter);
    };
    return this.service.completeReviewedEffect(authority,lease,{adapter:action.adapter,requestSha256,
      providerReferenceSha256:sha(effectId),responseSha256:sha(json({effectIdSha256:sha(effectId)})),applyInternalEffect:effect});
  }

  private async webhook(authority:WorkerAuthority,lease:WorkerLease,row:any,
    action:Extract<ReviewedWorkflowAction,{adapter:'signed_webhook'}>,requestSha256:string){
    const destination=this.db.prepare("SELECT * FROM journey_webhook_destinations WHERE id=? AND space_id=? AND state='active'")
      .get(action.payload.destinationId,lease.spaceId) as any;
    if(!destination||Number(destination.revision)!==action.payload.destinationRevision)
      throw new JourneyReviewedAdapterWorkerError('Reviewed webhook destination is unavailable or changed.','WEBHOOK_DESTINATION_REVISION_CHANGED');
    const target=await validateJourneyWebhookUrl(String(destination.url),this.ports.lookup);
    const body=json({eventType:action.payload.eventType,data:action.payload.data,idempotencyKey:row.idempotency_key});
    let dispatch=this.db.prepare('SELECT * FROM journey_webhook_dispatches WHERE queue_id=? AND space_id=?').get(row.id,lease.spaceId) as any;
    if(!dispatch){const at=new Date().toISOString();this.db.prepare(`INSERT INTO journey_webhook_dispatches
      (id,queue_id,destination_id,space_id,nonce,signed_at,request_body_sha256,state,attempt_count,updated_at,created_at)
      VALUES (?,?,?,?,?,?,?,'prepared',0,?,?)`).run(crypto.randomUUID(),row.id,destination.id,lease.spaceId,crypto.randomUUID(),at,sha(body),at,at);
      dispatch=this.db.prepare('SELECT * FROM journey_webhook_dispatches WHERE queue_id=? AND space_id=?').get(row.id,lease.spaceId) as any;}
    if(dispatch.request_body_sha256!==sha(body))throw new JourneyReviewedAdapterWorkerError('Webhook replay body changed.','WEBHOOK_REPLAY_CONFLICT');
    if(dispatch.state!=='succeeded'){
      const signature=crypto.createHmac('sha256',decryptJourneyWebhookSecret(destination.secret_enc,`journey-webhook:${lease.spaceId}:${destination.id}`))
        .update(`${dispatch.signed_at}.${dispatch.nonce}.${body}`).digest('hex');
      this.db.prepare("UPDATE journey_webhook_dispatches SET state='sending',attempt_count=attempt_count+1,updated_at=? WHERE id=?")
        .run(new Date().toISOString(),dispatch.id);
      const response=await (this.ports.sendWebhook||sendReviewedWebhook)({url:target.url,hostname:target.hostname,port:target.port,
        addresses:target.addresses,body,timeoutMs:5_000,headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),
          'x-seemplify-timestamp':dispatch.signed_at,'x-seemplify-nonce':dispatch.nonce,'x-seemplify-signature':`sha256=${signature}`,
          'idempotency-key':row.idempotency_key}});
      const responseSha=sha(response.body.slice(0,65_536));
      if(response.status<200||response.status>=300)throw new JourneyReviewedAdapterWorkerError('Webhook delivery failed.',
        response.status===408||response.status===429||response.status>=500?'WEBHOOK_RETRYABLE_STATUS':'WEBHOOK_REJECTED',
        response.status===408||response.status===429||response.status>=500);
      this.ports.afterExternalEffect?.('signed_webhook');
      this.db.prepare("UPDATE journey_webhook_dispatches SET state='succeeded',response_status=?,response_sha256=?,last_error_code=NULL,updated_at=? WHERE id=?")
        .run(response.status,responseSha,new Date().toISOString(),dispatch.id);this.ports.afterWebhookDispatchRecorded?.();
      dispatch=this.db.prepare('SELECT * FROM journey_webhook_dispatches WHERE id=?').get(dispatch.id) as any;
    }
    return this.service.completeReviewedEffect(authority,lease,{adapter:action.adapter,requestSha256,
      providerReferenceSha256:sha(`webhook:${destination.id}:${dispatch.nonce}`),responseSha256:String(dispatch.response_sha256)});
  }
}
