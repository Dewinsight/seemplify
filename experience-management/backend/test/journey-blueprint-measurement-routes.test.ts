import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{after,test}from'node:test';
import express from'express';import request from'supertest';import{signupVerifyAndOnboard}from'./authTestHelper.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-blueprint-measurement-routes-'));for(const[name,value]of[['admin','Runtime48-Password!'],
  ['session','runtime48-session-secret-long-enough'],['terra','runtime48-terra-secret-long-enough'],['identity',Buffer.alloc(32,48)],
  ['x',Buffer.alloc(32,49).toString('base64url')],['esign',Buffer.alloc(32,50).toString('base64url')]]as const)fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),FRONTEND_DIST:path.join(root,'frontend'),
  PUBLIC_URL:'http://127.0.0.1:5412',ADMIN_EMAIL:'runtime48@seemplify.local',ADMIN_PASSWORD_FILE:path.join(root,'admin'),
  SESSION_SECRET_FILE:path.join(root,'session'),TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),
  JOURNEY_IDENTITY_HASH_KEY_FILE:path.join(root,'identity'),X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x'),ESIGN_STORAGE_DIR:path.join(root,'esign-store'),
  ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign'),EMAIL_MODE:'log'});
const{app:mainApp}=await import('../src/app.js'),{login}=await import('../src/auth.js'),{db}=await import('../src/database.js');
const{createJourneyBlueprintMeasurementRouter}=await import('../src/journeyBlueprintMeasurementRoutes.js');const seen:string[]=[];
const repository={list(input:any){seen.push(input.spaceId);return[];},createPlan(input:any){seen.push(input.spaceId);return{id:'plan'};},
  read(){return{plan:{},outcomes:[]};},recordOutcome(){return{};},closePlan(){return{};}}as any;
const app=express();app.use(express.json());app.post('/api/auth/login',login);app.use('/api/journey-blueprint-measurements',
  createJourneyBlueprintMeasurementRouter(repository));const agent=(target:express.Express)=>{const value=request.agent(target);(value as any).app?.on?.('listening',
    ()=>((value as any).app).unref?.());return value;};
const seededAdmin=agent(mainApp);await signupVerifyAndOnboard(seededAdmin,{email:'runtime48-owner@example.test',password:'Runtime48-Password!',
  name:'Runtime 48 owner',spaceName:'Runtime 48 space'});const admin=agent(app);await admin.post('/api/auth/login')
  .send({email:'runtime48-owner@example.test',password:'Runtime48-Password!'}).expect(200);
const adminId=String((db.prepare('SELECT id FROM users WHERE email=?').get('runtime48-owner@example.test')as any).id),adminSpace=String((db.prepare(
  'SELECT active_space_id FROM users WHERE id=?').get(adminId)as any).active_space_id);db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(adminSpace);
const seededMember=agent(mainApp);await signupVerifyAndOnboard(seededMember,{email:'runtime48-member@example.test',password:'Runtime48-Member-Password!',name:'Member',
  spaceName:'Member home'});const memberRow=db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('runtime48-member@example.test') as any;
const memberId=String(memberRow.id),memberSpace=String(memberRow.active_space_id),member=agent(app);await member.post('/api/auth/login')
  .send({email:'runtime48-member@example.test',password:'Runtime48-Member-Password!'}).expect(200);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(memberSpace);const stamp=new Date().toISOString();
db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)").run(adminSpace,memberId,stamp,stamp);
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
test('request-derived tenant permits member reads but rejects member edits and foreign space headers',async()=>{await member.get('/api/journey-blueprint-measurements/plans')
  .set('x-seemplify-space',adminSpace).expect(200);assert.equal(seen.at(-1),adminSpace);await member.post('/api/journey-blueprint-measurements/plans')
    .set('x-seemplify-space',adminSpace).send({}).expect(403);await member.get('/api/journey-blueprint-measurements/plans')
    .set('x-seemplify-space','foreign-space').expect(403);});
test('manager mutation is strict and never accepts caller space or free-form metric references',async()=>{const body={blueprintVersionId:'bpv',elementId:'element',
  metricDefinitionId:'metric',metricDefinitionVersionId:'metric-v',baselineObservationId:'baseline',idempotencyKey:'key'};
  await admin.post('/api/journey-blueprint-measurements/plans').set('x-seemplify-space',adminSpace).send({...body,spaceId:'foreign'}).expect(400);
  await admin.post('/api/journey-blueprint-measurements/plans').set('x-seemplify-space',adminSpace).send({...body,metricRefs:['free-form']}).expect(400);
  await admin.post('/api/journey-blueprint-measurements/plans').set('x-seemplify-space',adminSpace).send(body).expect(201);assert.equal(seen.at(-1),adminSpace);});
