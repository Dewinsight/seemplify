import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-export-brand-routes-'));
for(const [name,value] of [['admin-password','Export-Brand-Test-Password-2026!'],
  ['session-secret','export-brand-session-secret-that-is-long-enough'],
  ['terra','export-brand-terra-secret-that-is-long-enough'],
  ['x-key',Buffer.alloc(32,81).toString('base64url')],['esign-key',Buffer.alloc(32,82).toString('base64url')]])
  fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),
  FRONTEND_DIST:path.join(root,'frontend'),PUBLIC_URL:'http://127.0.0.1:5421',ADMIN_EMAIL:'brand-routes@seemplify.local',
  ADMIN_PASSWORD_FILE:path.join(root,'admin-password'),SESSION_SECRET_FILE:path.join(root,'session-secret'),
  TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),EMAIL_MODE:'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x-key'),ESIGN_STORAGE_DIR:path.join(root,'esign'),
  ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign-key')});

const {app}=await import('../src/app.js');
const {db}=await import('../src/database.js');
const maps=await import('../src/journeyMaps.js');
const savedViews=await import('../src/journeySavedViews.js');
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});

function agent(){const value=request.agent(app);const server=(value as any).app;server?.on?.('listening',()=>server.unref?.());return value;}
const owner=agent();
await owner.post('/api/auth/login').send({email:'brand-routes@seemplify.local',password:'Export-Brand-Test-Password-2026!'}).expect(200);
const ownerSession=await owner.get('/api/auth/session').expect(200);
const spaceId=String(ownerSession.body.activeSpace.id),ownerId=String(ownerSession.body.user.id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
const definition=maps.createJourneyMap(spaceId,ownerId,{name:'Branded renewal journey',stageNames:['Discover','Renew']});
const map=maps.getJourneyMap(spaceId,definition.id,undefined,ownerId)!;
const view=savedViews.createJourneySavedView({spaceId,actorUserId:ownerId,definitionId:definition.id,name:'Executive renewal view',
  visibility:'space',idempotencyKey:'brand-route-view',config:{schemaVersion:1,binding:{policy:'exact',versionId:map.version.id},
    filters:{personaIds:[],segmentIds:[],cohortIds:[],channelIds:[],evidenceLinkIds:[],evidenceStates:[],cardKinds:[],laneKeys:[],
      timeWindow:null},comparisonTarget:null,presentation:{density:'comfortable',showEvidenceLegend:true,showResearchGaps:true,
      showEmptyLanes:true,title:'Executive renewal'}}});

const member=agent();
await signupVerifyAndOnboard(member,{name:'Brand reader',email:'brand-reader@example.test',password:'Strong-brand-reader-password-2026!',
  spaceName:'Reader home'});
const memberSession=await member.get('/api/auth/session').expect(200),memberId=String(memberSession.body.user.id),
  memberHome=String(memberSession.body.activeSpace.id),at=new Date().toISOString();
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(memberHome);
db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
  .run(spaceId,memberId,at,at);

const profileInput={name:'Annual report',organisationName:'Acme Research',primaryHex:'#28503C',accentHex:'#B45309',
  backgroundHex:'#FFFFFF',textHex:'#111827',fontFamily:'Noto Sans',footerText:'Confidential',locale:'en-GB',
  idempotencyKey:'brand-route-profile'};

test('saved-view branding reloads exact bindings for readers and stays tenant- and role-scoped',async()=>{
  const profile=await owner.post('/api/journey-export-brand/profiles').set('x-seemplify-space',spaceId).send(profileInput).expect(201);
  const initial=await owner.get(`/api/journey-export-brand/saved-views/${view.view.id}`).set('x-seemplify-space',spaceId).expect(200);
  assert.deepEqual(initial.body.binding,{viewId:view.view.id,brandPolicy:'space_default',profileId:null,profileVersion:null,
    viewRevision:1,revision:0,updatedAt:null});
  const bound=await owner.put(`/api/journey-export-brand/saved-views/${view.view.id}`).set('x-seemplify-space',spaceId).send({
    viewRevision:1,brandPolicy:'pinned',profileId:profile.body.profile.id,profileVersion:1,expectedRevision:0,
    idempotencyKey:'brand-route-binding'}).expect(200);
  assert.equal(bound.body.binding.brandPolicy,'pinned');
  await member.post(`/api/spaces/${spaceId}/select`).expect(200);
  const readable=await member.get(`/api/journey-export-brand/saved-views/${view.view.id}`).expect(200);
  assert.equal(readable.body.binding.profileId,profile.body.profile.id);assert.equal(readable.body.binding.revision,1);
  await member.put(`/api/journey-export-brand/saved-views/${view.view.id}`).send({viewRevision:1,brandPolicy:'space_default',
    expectedRevision:1,idempotencyKey:'member-cannot-bind'}).expect(403);
  await member.post(`/api/spaces/${memberHome}/select`).expect(200);
  await member.get(`/api/journey-export-brand/saved-views/${view.view.id}`).expect(404);
});
