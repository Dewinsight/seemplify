import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-reviewed-adapters-'));
for(const [name,value] of [['admin-password','Reviewed-Adapters-Test-Password-2026!'],
  ['session-secret','reviewed-adapters-session-secret-that-is-long-enough'],['terra','reviewed-adapters-terra-secret-that-is-long-enough'],
  ['x-key',Buffer.alloc(32,61).toString('base64url')],['esign-key',Buffer.alloc(32,62).toString('base64url')],
  ['webhook-key',Buffer.alloc(32,63).toString('base64url')]])fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),FRONTEND_DIST:path.join(root,'frontend'),
  PUBLIC_URL:'http://127.0.0.1:5412',ADMIN_EMAIL:'reviewed-adapters@seemplify.local',ADMIN_PASSWORD_FILE:path.join(root,'admin-password'),
  SESSION_SECRET_FILE:path.join(root,'session-secret'),TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),
  LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),EMAIL_MODE:'log',X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x-key'),
  ESIGN_STORAGE_DIR:path.join(root,'esign'),ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign-key'),
  JOURNEY_WEBHOOK_ENCRYPTION_KEY_FILE:path.join(root,'webhook-key')});
const {app}=await import('../src/app.js');const {db}=await import('../src/database.js');
const {executeReviewedJourneyAction,createJourneyWebhookDestination,validateJourneyWebhookUrl}=await import('../src/journeyReviewedAdapters.js');
const {claimJourneyAction}=await import('../src/journeyActionRuntimeRepository.js');
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true})});
function agent(){const value=request.agent(app);const server=(value as any).app;server?.on?.('listening',()=>server.unref?.());return value}
const owner=agent();await owner.post('/api/auth/login').send({email:'reviewed-adapters@seemplify.local',password:'Reviewed-Adapters-Test-Password-2026!'}).expect(200);
const session=(await owner.get('/api/auth/session').expect(200)).body;const spaceId=String(session.activeSpace.id),userId=String(session.user.id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
const reviewer=agent();
await signupVerifyAndOnboard(reviewer,{name:'Reviewed adapter approver',email:'reviewed-adapter-approver@example.test',
  password:'Strong-reviewed-adapter-approver-password-2026!',spaceName:'Reviewer home'});
const reviewerSession=(await reviewer.get('/api/auth/session').expect(200)).body;
const reviewerId=String(reviewerSession.user.id);const reviewerStamp=new Date().toISOString();
db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
  .run(spaceId,reviewerId,reviewerStamp,reviewerStamp);
db.prepare(`INSERT INTO journey_collaboration_role_assignments
  (id,space_id,scope_type,journey_definition_id,user_id,role,state,revision,assigned_by_user_id,assigned_at)
  VALUES (?,?,'space',NULL,?,'approver','active',1,?,?)`)
  .run('reviewed-adapter-independent-reviewer',spaceId,reviewerId,userId,reviewerStamp);
await reviewer.post(`/api/spaces/${spaceId}/select`).expect(200);
const gates=Object.fromEntries(['consent','suppression','entitlement','quota','quiet_hours','frequency_cap','source_state','platform_kill_switch',
  'space_kill_switch','workflow_kill_switch','adapter_kill_switch','profile_kill_switch'].map((key)=>[key,'allow']));

async function queue(action:any,suffix:string){
  const createResponse=await owner.post('/api/journey-orchestration/workflows').send({name:`Adapter ${suffix}`,
    trigger:{type:'event',eventName:`adapter.${suffix}`,sourceId:'test'},conditions:[],actions:[{...action,consequential:true}],
    automationPolicy:{mode:'human_approval'}});
  assert.equal(createResponse.status,201,JSON.stringify(createResponse.body));
  const created=createResponse.body.workflow;
  await owner.post(`/api/journey-orchestration/workflows/${created.id}/publish`).send({expectedRevision:1}).expect(200);
  const run=(await owner.post(`/api/journey-orchestration/workflows/${created.id}/simulations`).send({mode:'dry_run',
    triggerFingerprint:`trigger-${suffix}`,triggerMatched:true,subjectId:`subject-${suffix}`,facts:{},gates}).expect(201)).body.run;
  const approvalResponse=await reviewer.post(`/api/journey-orchestration/actions/${run.actions[0].id}/approval`)
    .send({decision:'approved',reason:'Reviewed adapter test approval.'});
  assert.equal(approvalResponse.status,201,JSON.stringify(approvalResponse.body));
  const approval=approvalResponse.body.approval;
  const claim=claimJourneyAction({spaceId,actorUserId:userId,workerIdentity:'reviewed-worker',leaseSeconds:300});
  assert.ok(claim,'the approved action must be claimable through the internal runtime repository');
  assert.equal(claim.id,approval.queueId);return claim;
}
async function retryClaim(id:string){db.prepare("UPDATE journey_action_queue SET available_at='2000-01-01T00:00:00.000Z',updated_at=?,revision=revision+1 WHERE id=?")
  .run(new Date().toISOString(),id);const claim=claimJourneyAction({spaceId,actorUserId:userId,
    workerIdentity:'reviewed-worker',leaseSeconds:300});assert.ok(claim,'the retry must be claimable internally');return claim}

test('exact adapter payload contracts reject unknown and mismatched fields',async()=>{
  await owner.post('/api/journey-orchestration/workflows').send({name:'Invalid adapter',trigger:{type:'event',eventName:'bad.payload',sourceId:'test'},
    conditions:[],actions:[{key:'bad',adapter:'assistant_action',purpose:'Bad',recipientScope:'ops',
      payload:{title:'Valid title',email:'not-allowed@example.test'}}],automationPolicy:{mode:'human_approval'}}).expect(400);
});

test('SSRF validation rejects private, mapped, multicast and documentation addresses',async()=>{
  const lookup=(address:string)=>async()=>[{address,family:address.includes(':')?6:4}] as any;
  for(const address of ['127.0.0.1','10.1.2.3','::1','::ffff:192.168.1.1','::ffff:c0a8:1','ff02::1','2001:db8::1'])
    await assert.rejects(validateJourneyWebhookUrl('https://hooks.example.test/events',lookup(address) as any),/public/u,address);
  const accepted=await validateJourneyWebhookUrl('https://hooks.example.test/events',lookup('93.184.216.34') as any);
  assert.deepEqual(accepted.addresses,[{address:'93.184.216.34',family:4}]);
  await assert.rejects(validateJourneyWebhookUrl('https://user:secret@hooks.example.test/events',lookup('93.184.216.34') as any),/credential-free/u);
});

test('internal effects and receipts are atomic under injected crashes and stale fences',async()=>{
  const claim=await queue({key:'assistant',adapter:'assistant_action',purpose:'Create reviewed action',recipientScope:'owner',
    payload:{title:'Follow up with the customer',description:'Reviewed recovery action.',priority:'high'}},'assistant-crash');
  await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,leaseToken:claim.leaseToken,
    fencingToken:claim.fencingToken},{afterInternalEffect:()=>{throw new Error('injected crash')}}),/Adapter execution failed/u);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM assistant_actions WHERE title='Follow up with the customer'").get() as any).count,0,
    'effect and receipt must roll back together');
  const retry=await retryClaim(claim.id);assert.ok(retry.fencingToken>claim.fencingToken);
  await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,leaseToken:claim.leaseToken,
    fencingToken:claim.fencingToken}),/stale/u);
  const completed=await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:retry.id,leaseToken:retry.leaseToken,
    fencingToken:retry.fencingToken});assert.equal(completed.replayed,false);
  const replay=await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:retry.id,leaseToken:retry.leaseToken,
    fencingToken:retry.fencingToken});assert.equal(replay.replayed,true);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM assistant_actions WHERE title='Follow up with the customer'").get() as any).count,1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_effect_receipts WHERE queue_id=?').get(retry.id) as any).count,1);
});

test('service recovery and internal notification use their tenant-bound repositories exactly once',async()=>{
  const survey=(await owner.post('/api/surveys').send({title:'Recovery source',questions:[]}).expect(201)).body;
  const collector=(await owner.post(`/api/surveys/${survey.id}/collectors`).send({name:'Reviewed email',type:'email'}).expect(201)).body;
  const ticket=await queue({key:'ticket',adapter:'service_recovery_ticket',purpose:'Open reviewed recovery',recipientScope:'support',
    payload:{surveyId:survey.id,title:'Reviewed recovery case',priority:'urgent',notes:'Created by reviewed orchestration.'}},'ticket');
  await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:ticket.id,leaseToken:ticket.leaseToken,fencingToken:ticket.fencingToken});
  assert.equal((db.prepare("SELECT COUNT(*) count FROM tickets WHERE title='Reviewed recovery case'").get() as any).count,1);
  const notification=await queue({key:'notification',adapter:'internal_notification',purpose:'Notify owner',recipientScope:'owner',
    payload:{targetUserId:userId,title:'Recovery opened',body:'A reviewed recovery case was opened.',severity:'warning'}},'notification');
  await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:notification.id,leaseToken:notification.leaseToken,
    fencingToken:notification.fencingToken});
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_internal_notifications WHERE queue_id=?').get(notification.id) as any).count,1);
  const invitation=await queue({key:'real-survey',adapter:'survey_invitation',purpose:'Send reviewed survey',recipientScope:'customer',
    payload:{surveyId:survey.id,collectorId:collector.id,recipients:[{email:'reviewed-recipient@example.test',name:'Reviewed Recipient'}]}},'real-survey');
  await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:invitation.id,leaseToken:invitation.leaseToken,
    fencingToken:invitation.fencingToken});
  assert.equal((db.prepare('SELECT COUNT(*) count FROM recipients WHERE collector_id=? AND email=?')
    .get(collector.id,'reviewed-recipient@example.test') as any).count,1);
});

test('survey port receives a stable provider idempotency key across an unknown-outcome retry',async()=>{
  const claim=await queue({key:'survey',adapter:'survey_invitation',purpose:'Invite reviewed recipient',recipientScope:'customer',
    payload:{surveyId:'survey-id',collectorId:'collector-id',recipients:[{email:'person@example.test',name:'Person'}],message:'Please respond.'}},'survey');
  const keys:string[]=[];const logical=new Set<string>();let inject=true;
  const ports={sendSurveyInvitation:async({idempotencyKey}:{idempotencyKey:string})=>{keys.push(idempotencyKey);logical.add(idempotencyKey);return {accepted:true}},
    afterExternalEffect:()=>{if(inject){inject=false;throw new Error('unknown provider outcome')}}};
  await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,leaseToken:claim.leaseToken,
    fencingToken:claim.fencingToken},ports),/Adapter execution failed/u);
  const retry=await retryClaim(claim.id);await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:retry.id,
    leaseToken:retry.leaseToken,fencingToken:retry.fencingToken},ports);
  assert.equal(keys.length,2);assert.equal(new Set(keys).size,1);assert.equal(logical.size,1);
});

test('survey execution rechecks suppression before quota or delivery and holds the queue',async()=>{
  const claim=await queue({key:'suppressed-survey',adapter:'survey_invitation',purpose:'Invite reviewed recipient',recipientScope:'customer',
    payload:{surveyId:'survey-id',collectorId:'collector-id',recipients:[{email:'suppressed@example.test'}]}},'suppressed-survey');
  const at=new Date().toISOString();db.prepare(`INSERT INTO email_suppressions
    (space_id,email,reason,source,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(spaceId,'suppressed@example.test','opt_out','test',at,at);
  let delivered=false;await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,
    leaseToken:claim.leaseToken,fencingToken:claim.fencingToken},{sendSurveyInvitation:async()=>{delivered=true;return {}}}),/suppressed/u);
  assert.equal(delivered,false);const held=db.prepare('SELECT state,hold_reason_code FROM journey_action_queue WHERE id=?').get(claim.id) as any;
  assert.deepEqual(held,{state:'held',hold_reason_code:'RECIPIENT_SUPPRESSED'});
  assert.equal((db.prepare("SELECT COUNT(*) count FROM platform_usage_events WHERE source_id=?").get(claim.id) as any).count,0);
});

test('signed webhook pins public DNS and reuses HMAC timestamp nonce and idempotency after a crash',async()=>{
  const lookup=async()=>[{address:'93.184.216.34',family:4}] as any;const secret='webhook-secret-value-that-is-at-least-thirty-two-bytes';
  const destination=await createJourneyWebhookDestination({spaceId,actorUserId:userId,name:'Approved CRM',
    url:'https://hooks.example.test/events',secret,lookup:lookup as any});
  assert.ok(db.prepare("SELECT id FROM journey_webhook_destinations WHERE id=? AND space_id=? AND state='active'")
    .get(destination.id,spaceId));
  const claim=await queue({key:'webhook',adapter:'signed_webhook',purpose:'Notify approved CRM',recipientScope:'crm',externallyVisible:true,
    payload:{destinationId:destination.id,destinationRevision:destination.revision,eventType:'recovery.opened',
      data:{case:'reviewed',priority:3}}},'webhook');
  const calls:Array<{body:string;headers:Record<string,string>;addresses:any[]}>=[];let inject=true;let injectAfterRecorded=true;
  const ports={lookup:lookup as any,sendWebhook:async(input:any)=>{calls.push(input);return {status:202,body:'accepted'}},
    afterExternalEffect:()=>{if(inject){inject=false;throw new Error('crash after receiver accepted')}},
    afterWebhookDispatchRecorded:()=>{if(injectAfterRecorded){injectAfterRecorded=false;throw new Error('crash after dispatch receipt')}}};
  await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,leaseToken:claim.leaseToken,
    fencingToken:claim.fencingToken},ports),/Adapter execution failed/u);
  const retry=await retryClaim(claim.id);await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:retry.id,
    leaseToken:retry.leaseToken,fencingToken:retry.fencingToken},ports),/Adapter execution failed/u);
  const finalClaim=await retryClaim(claim.id);await executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:finalClaim.id,
    leaseToken:finalClaim.leaseToken,fencingToken:finalClaim.fencingToken},ports);
  assert.equal(calls.length,2);for(const call of calls)assert.deepEqual(call.addresses,[{address:'93.184.216.34',family:4}]);
  for(const name of ['x-seemplify-timestamp','x-seemplify-nonce','x-seemplify-signature','idempotency-key'])
    assert.equal(calls[0]!.headers[name],calls[1]!.headers[name],`${name} must be replay-stable`);
  const canonical=`${calls[0]!.headers['x-seemplify-timestamp']}.${calls[0]!.headers['x-seemplify-nonce']}.${calls[0]!.body}`;
  assert.equal(calls[0]!.headers['x-seemplify-signature'],`sha256=${crypto.createHmac('sha256',secret).update(canonical).digest('hex')}`);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_webhook_dispatches WHERE queue_id=?').get(retry.id) as any).count,1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_adapter_effect_receipts WHERE queue_id=?').get(retry.id) as any).count,1);
});

test('a webhook destination revision change after review fails closed without a request',async()=>{
  const lookup=async()=>[{address:'93.184.216.34',family:4}] as any;
  const destination=await createJourneyWebhookDestination({spaceId,actorUserId:userId,name:'Revision guarded',
    url:'https://hooks.example.test/revision',secret:'another-webhook-secret-that-is-at-least-thirty-two-bytes',lookup:lookup as any});
  const claim=await queue({key:'revision-webhook',adapter:'signed_webhook',purpose:'Revision guard',recipientScope:'crm',externallyVisible:true,
    payload:{destinationId:destination.id,destinationRevision:destination.revision,eventType:'revision.test',data:{ok:true}}},'revision-webhook');
  db.prepare('UPDATE journey_webhook_destinations SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(),destination.id);
  let requested=false;await assert.rejects(executeReviewedJourneyAction({spaceId,actorUserId:userId,queueId:claim.id,
    leaseToken:claim.leaseToken,fencingToken:claim.fencingToken},{lookup:lookup as any,sendWebhook:async()=>{requested=true;return {status:200,body:''}}}),
  /changed after this action was reviewed/u);
  assert.equal(requested,false);assert.equal((db.prepare('SELECT state FROM journey_action_queue WHERE id=?').get(claim.id) as any).state,'dead_letter');
});
