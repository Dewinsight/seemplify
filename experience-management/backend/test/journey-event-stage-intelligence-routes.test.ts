import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {after,test} from 'node:test';
import express from 'express';import request from 'supertest';import {signupVerifyAndOnboard} from './authTestHelper.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-event-intelligence-routes-'));for(const [name,value] of [['admin','Runtime45-Routes-Password!'],
  ['session','runtime45-route-session-secret-long-enough'],['terra','runtime45-route-terra-secret-long-enough'],['identity',Buffer.alloc(32,45)],
  ['x',Buffer.alloc(32,46).toString('base64url')],['esign-key',Buffer.alloc(32,47).toString('base64url')],['webhook',Buffer.alloc(32,48).toString('base64url')]] as const)
  fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),FRONTEND_DIST:path.join(root,'frontend'),
  PUBLIC_URL:'http://127.0.0.1:5412',ADMIN_EMAIL:'runtime45@seemplify.local',ADMIN_PASSWORD_FILE:path.join(root,'admin'),SESSION_SECRET_FILE:path.join(root,'session'),
  TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),JOURNEY_IDENTITY_HASH_KEY_FILE:path.join(root,'identity'),
  X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x'),JOURNEY_WEBHOOK_ENCRYPTION_KEY_FILE:path.join(root,'webhook'),ESIGN_STORAGE_DIR:path.join(root,'esign'),
  ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign-key'),EMAIL_MODE:'log'});
const {app:mainApp}=await import('../src/app.js');const {login}=await import('../src/auth.js');const {db}=await import('../src/database.js');
const {createJourneyEventStageIntelligenceRouter}=await import('../src/journeyEventStageIntelligenceRoutes.js');
const seen:string[]=[];const repository={listMappings(spaceId:string){seen.push(spaceId);return[];},readMapping(){return null;},createMapping(){return{};},appendVersion(){return{};},retireMapping(){return{};}} as any;
const app=express();app.use(express.json());app.post('/api/auth/login',login);app.use('/api/journey-event-intelligence',createJourneyEventStageIntelligenceRouter(repository));
const agent=(target:express.Express)=>{const value=request.agent(target);(value as any).app?.on?.('listening',()=>((value as any).app).unref?.());return value;};
const admin=agent(app);await admin.post('/api/auth/login').send({email:'runtime45@seemplify.local',password:'Runtime45-Routes-Password!'}).expect(200);
const adminId=String((db.prepare('SELECT id FROM users WHERE email=?').get('runtime45@seemplify.local') as any).id);
const adminSpace=String((db.prepare('SELECT active_space_id FROM users WHERE id=?').get(adminId) as any).active_space_id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(adminSpace);
const memberAgent=agent(mainApp);await signupVerifyAndOnboard(memberAgent,{email:'runtime45-member@example.test',password:'Runtime45-Member-Password!',name:'Member',spaceName:'Member Space'});
const memberSession=await memberAgent.get('/api/auth/session').expect(200);const member={agent:memberAgent,userId:String(memberSession.body.user.id),spaceId:String(memberSession.body.activeSpace.id)};
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(member.spaceId);
const joinedAt=new Date().toISOString();db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
  .run(adminSpace,member.userId,joinedAt,joinedAt);
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
test('member can read safe lineage but cannot mutate mappings',async()=>{const readable=await member.agent.get('/api/journey-event-intelligence/mappings').set('x-seemplify-space',adminSpace);
  assert.equal(readable.status,200,JSON.stringify(readable.body));
  await member.agent.post('/api/journey-event-intelligence/mappings').set('x-seemplify-space',adminSpace).send({}).expect(403);});
test('request-derived tenant rejects cross-space headers',async()=>{await member.agent.get('/api/journey-event-intelligence/mappings').set('x-seemplify-space','foreign-space-id').expect(403);
  await admin.get('/api/journey-event-intelligence/mappings').set('x-seemplify-space',adminSpace).expect(200);assert.equal(seen.at(-1),adminSpace);});
test('strict mutation body rejects unknown fields before repository access',async()=>{await admin.post('/api/journey-event-intelligence/mappings').set('x-seemplify-space',adminSpace)
  .send({unexpected:true}).expect(400);});
