import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-connectors-'));
for(const [name,value] of [['admin-password','Connector-Test-Password-2026!'],['session-secret','connector-session-secret-that-is-long-enough'],
  ['terra','connector-terra-secret-that-is-long-enough'],['x-key',Buffer.alloc(32,61).toString('base64url')],
  ['esign-key',Buffer.alloc(32,62).toString('base64url')]]) fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),FRONTEND_DIST:path.join(root,'frontend'),
  PUBLIC_URL:'http://127.0.0.1:5412',ADMIN_EMAIL:'connectors@seemplify.local',ADMIN_PASSWORD_FILE:path.join(root,'admin-password'),
  SESSION_SECRET_FILE:path.join(root,'session-secret'),TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),
  LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),EMAIL_MODE:'log',X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x-key'),
  ESIGN_STORAGE_DIR:path.join(root,'esign'),ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign-key')});
const {app}=await import('../src/app.js'); const {db}=await import('../src/database.js');
const {journeyConnectorItemChecksum}=await import('../src/journeyConnectorImports.js');
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
function agent(){const value=request.agent(app);const server=(value as any).app;server?.on?.('listening',()=>server.unref?.());return value;}
async function owner(){const a=agent();await a.post('/api/auth/login').send({email:'connectors@seemplify.local',password:'Connector-Test-Password-2026!'}).expect(200);
  const session=await a.get('/api/auth/session').expect(200);const spaceId=String(session.body.activeSpace.id),userId=String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);return{a,spaceId,userId};}
const primary=await owner();
const headers=(key:string)=>({'Idempotency-Key':key});

test('strict approved connectors reject secret-shaped configuration and unsupported kinds',async()=>{
  await primary.a.post('/api/journey-connectors/connectors').set(headers('bad-extra')).send({kind:'csv_upload',name:'Orders',
    maximumAttempts:5,baseRetrySeconds:5,apiToken:'must-not-enter-contract'}).expect(400);
  await primary.a.post('/api/journey-connectors/connectors').set(headers('bad-kind')).send({kind:'salesforce_live',name:'CRM',
    maximumAttempts:5,baseRetrySeconds:5}).expect(400);
  await primary.a.post('/api/journey-connectors/connectors').send({kind:'csv_upload',name:'Orders',maximumAttempts:5,baseRetrySeconds:5})
    .expect(400).expect(({body})=>assert.equal(body.code,'JOURNEY_CONNECTOR_IDEMPOTENCY_KEY_REQUIRED'));
});

test('imports checkpoint exact cursors, return partial receipts, propagate tombstones and replay idempotently',async()=>{
  const created=await primary.a.post('/api/journey-connectors/connectors').set(headers('connector-create')).send({kind:'jsonl_upload',
    name:'Approved order archive',maximumAttempts:3,baseRetrySeconds:10}).expect(201); const connector=created.body.connector;
  assert.equal(created.body.replayed,false);assert.equal(JSON.stringify(created.body).includes('spaceId'),false);
  const replay=await primary.a.post('/api/journey-connectors/connectors').set(headers('connector-create')).send({kind:'jsonl_upload',
    name:'Approved order archive',maximumAttempts:3,baseRetrySeconds:10}).expect(201);
  assert.equal(replay.body.connector.id,connector.id);assert.equal(replay.body.replayed,true);
  await primary.a.post('/api/journey-connectors/connectors').set(headers('connector-create')).send({kind:'csv_upload',
    name:'Different',maximumAttempts:3,baseRetrySeconds:10}).expect(409);
  const started=await primary.a.post(`/api/journey-connectors/connectors/${connector.id}/imports`).set(headers('import-start')).send({}).expect(201);
  const run=started.body.run; const payload={order:'A-1',value:25};
  const items=[{externalId:'order-1',operation:'upsert',payload,occurredAt:'2026-08-07T10:00:00.000Z',
    checksum:journeyConnectorItemChecksum({externalId:'order-1',operation:'upsert',payload})},
  {externalId:'order-bad',operation:'upsert',payload:{value:1},occurredAt:'2026-08-07T10:00:00.000Z',checksum:'0'.repeat(64)}];
  const page=await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('page-1')).send({
    expectedCheckpointRevision:1,cursor:null,nextCursor:'opaque-page-2',providerOutcome:'ok',items}).expect(200);
  assert.deepEqual(page.body.receipts.map((item:any)=>item.outcome),['accepted','rejected']);
  assert.equal(page.body.run.expectedCursor,'opaque-page-2');assert.equal(page.body.run.checkpointRevision,2);
  assert.doesNotMatch(JSON.stringify(page.body),/order-1|A-1/u,'receipt responses expose hashes, not imported identifiers or payloads');
  const replayPage=await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('page-1')).send({
    expectedCheckpointRevision:1,cursor:null,nextCursor:'opaque-page-2',providerOutcome:'ok',items}).expect(200);
  assert.equal(replayPage.body.replayed,true);
  await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('wrong-cursor')).send({
    expectedCheckpointRevision:2,cursor:'invented',nextCursor:null,providerOutcome:'ok',items:[]}).expect(409);
  const deletion={externalId:'order-1',operation:'delete' as const,payload:null,occurredAt:'2026-08-07T11:00:00.000Z'};
  const deleted=await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('page-2')).send({
    expectedCheckpointRevision:2,cursor:'opaque-page-2',nextCursor:null,providerOutcome:'ok',items:[{...deletion,
      checksum:journeyConnectorItemChecksum(deletion)}]}).expect(200);
  assert.equal(deleted.body.receipts[0].outcome,'tombstoned',JSON.stringify(deleted.body));assert.equal(deleted.body.run.state,'completed');
  const secondRun=(await primary.a.post(`/api/journey-connectors/connectors/${connector.id}/imports`).set(headers('import-two')).send({}).expect(201)).body.run;
  const later={externalId:'order-1',operation:'upsert' as const,payload:{value:99},occurredAt:'2026-08-07T12:00:00.000Z'};
  const resurrection=await primary.a.post(`/api/journey-connectors/imports/${secondRun.id}/pages`).set(headers('resurrection')).send({
    expectedCheckpointRevision:1,cursor:null,nextCursor:null,providerOutcome:'ok',items:[{...later,checksum:journeyConnectorItemChecksum(later)}]}).expect(200);
  assert.equal(resurrection.body.receipts[0].code,'ITEM_TOMBSTONED');assert.equal(resurrection.body.receipts[0].outcome,'rejected');
  const receipts=await primary.a.get(`/api/journey-connectors/imports/${run.id}/receipts?limit=2`).expect(200);
  assert.equal(receipts.body.items.length,2);assert.ok(receipts.body.nextCursor);
  const next=await primary.a.get(`/api/journey-connectors/imports/${run.id}/receipts?limit=2&cursor=${encodeURIComponent(receipts.body.nextCursor)}`).expect(200);
  assert.equal(next.body.items.length,1);
  const audit=await primary.a.get('/api/journey-connectors/audit').expect(200);const serialized=JSON.stringify(audit.body);
  assert.doesNotMatch(serialized,/order-1|A-1|opaque-page/u);assert.doesNotMatch(serialized,/payload|content|secret|token|cursor/iu);
});

test('provider retry-after is bounded and terminates at the configured attempt limit',async()=>{
  const connector=(await primary.a.post('/api/journey-connectors/connectors').set(headers('retry-source')).send({kind:'approved_object_store',
    name:'Approved object snapshot',maximumAttempts:2,baseRetrySeconds:5}).expect(201)).body.connector;
  const run=(await primary.a.post(`/api/journey-connectors/connectors/${connector.id}/imports`).set(headers('retry-run')).send({}).expect(201)).body.run;
  const first=await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('retry-1')).send({expectedCheckpointRevision:1,
    cursor:null,nextCursor:null,providerOutcome:'rate_limited',retryAfterSeconds:86400,items:[]}).expect(200);
  assert.equal(first.body.run.state,'retry_wait');
  const waitSeconds=(new Date(first.body.run.retryAt).getTime()-new Date(first.body.run.updatedAt).getTime())/1000;assert.equal(waitSeconds,3600);
  const terminal=await primary.a.post(`/api/journey-connectors/imports/${run.id}/pages`).set(headers('retry-2')).send({expectedCheckpointRevision:2,
    cursor:null,nextCursor:null,providerOutcome:'transient_failure',retryAfterSeconds:10,items:[]}).expect(200);
  assert.equal(terminal.body.run.state,'failed');assert.equal(terminal.body.run.retryAt,null);
});

test('members read but cannot write; entitlement and tenant boundaries remain request-derived',async()=>{
  const member=agent();await signupVerifyAndOnboard(member,{name:'Connector member',email:'connector-member@example.test',
    password:'Strong-connector-member-password-2026!',spaceName:'Connector member home'});
  const session=await member.get('/api/auth/session').expect(200);const memberId=String(session.body.user.id),home=String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(home);const stamp=new Date().toISOString();
  db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
    .run(primary.spaceId,memberId,stamp,stamp);await member.post(`/api/spaces/${primary.spaceId}/select`).expect(200);
  const listed=await member.get('/api/journey-connectors/connectors').expect(200);assert.ok(listed.body.connectors.length>=2);
  await member.post('/api/journey-connectors/connectors').set(headers('member-write')).send({kind:'csv_upload',name:'Denied',
    maximumAttempts:2,baseRetrySeconds:5}).expect(403);
  await member.post(`/api/spaces/${home}/select`).expect(200);await member.get('/api/journey-connectors/connectors').expect(200)
    .expect(({body})=>assert.equal(body.connectors.length,0));
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(home);
  await member.get('/api/journey-connectors/connectors').expect(403);
});
