import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-predictive-'));
for(const [name,value] of [['admin-password','Predictive-Test-Password-2026!'],['session-secret','predictive-session-secret-that-is-long-enough'],
  ['terra','predictive-terra-secret-that-is-long-enough'],['x-key',Buffer.alloc(32,71).toString('base64url')],
  ['esign-key',Buffer.alloc(32,72).toString('base64url')]]) fs.writeFileSync(path.join(root,name),value);
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),FRONTEND_DIST:path.join(root,'frontend'),
  PUBLIC_URL:'http://127.0.0.1:5419',ADMIN_EMAIL:'predictive@seemplify.local',ADMIN_PASSWORD_FILE:path.join(root,'admin-password'),
  SESSION_SECRET_FILE:path.join(root,'session-secret'),TERRA_GATEWAY_SHARED_SECRET_FILE:path.join(root,'terra'),
  LOCAL_LLM_SHARED_SECRET_FILE:path.join(root,'terra'),EMAIL_MODE:'log',X_CREDENTIAL_ENCRYPTION_KEY_FILE:path.join(root,'x-key'),
  ESIGN_STORAGE_DIR:path.join(root,'esign'),ESIGN_ENCRYPTION_KEY_FILE:path.join(root,'esign-key')});
const {app}=await import('../src/app.js'); const {db}=await import('../src/database.js');
after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
function agent(){const value=request.agent(app);const server=(value as any).app;server?.on?.('listening',()=>server.unref?.());return value;}
const manager=agent();await manager.post('/api/auth/login').send({email:'predictive@seemplify.local',password:'Predictive-Test-Password-2026!'}).expect(200);
const managerSession=await manager.get('/api/auth/session').expect(200);const spaceId=String(managerSession.body.activeSpace.id);
const managerId=String(managerSession.body.user.id);db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
const member=agent();await signupVerifyAndOnboard(member,{name:'Predictive trainer',email:'predictive-trainer@example.test',
  password:'Strong-predictive-trainer-password-2026!',spaceName:'Trainer home'});
const memberSession=await member.get('/api/auth/session').expect(200);const trainerId=String(memberSession.body.user.id);
const memberHome=String(memberSession.body.activeSpace.id);db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id IN (?,?)").run(spaceId,memberHome);
const stamp=new Date().toISOString();db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
  .run(spaceId,trainerId,stamp,stamp);await member.post(`/api/spaces/${spaceId}/select`).expect(200);

const evidence={id:'churn-risk-v1',target:'churn',version:'1.0.0',
  trainingWindow:{from:'2025-01-01T00:00:00.000Z',to:'2025-07-01T00:00:00.000Z'},
  validationWindow:{from:'2025-07-01T00:00:00.000Z',to:'2025-09-01T00:00:00.000Z'},
  trainingSamples:2000,positiveSamples:700,negativeSamples:1300,validationSamples:500,areaUnderRoc:.82,brierScore:.14,
  featureNames:['recent_complaints','days_since_visit'],trainedByUserId:trainerId};
const policy={enabled:true,purpose:'journey_churn_decision_support',minimumTrainingSamples:1000,minimumClassSamples:100,
  minimumValidationSamples:200,minimumAreaUnderRoc:.7,maximumBrierScore:.25,maximumPopulationStabilityIndex:.2,
  maximumMissingFeatureRatio:.1,maximumOutOfDistributionScore:10};

test('manager approves exact evidence while independent members remain read-only',async()=>{
  await manager.post('/api/journey-predictive-governance/models').send({name:'Churn risk review',model:{...evidence,spaceId}})
    .expect(400).expect(({body})=>assert.equal(body.code,'VALIDATION_FAILED'));
  await manager.post('/api/journey-predictive-governance/models').send({name:'Self approved',model:{...evidence,trainedByUserId:managerId}})
    .expect(422).expect(({body})=>assert.ok(body.details.issues.includes('INDEPENDENT_APPROVAL_REQUIRED')));
  const approved=await manager.post('/api/journey-predictive-governance/models').send({name:'Churn risk review',model:evidence}).expect(201);
  assert.equal(approved.body.model.state,'approved');assert.match(approved.body.versions[0].contentSha256,/^[a-f0-9]{64}$/u);
  assert.equal(approved.body.versions[0].model.approvedByUserId,managerId);
  const listing=await member.get('/api/journey-predictive-governance').expect(200);assert.equal(listing.body.models.length,1);
  await member.put('/api/journey-predictive-governance/policies/churn').send({expectedRevision:0,policy}).expect(403)
    .expect(({body})=>assert.equal(body.code,'JOURNEY_PREDICTIVE_REVIEW_REQUIRED'));
});

test('a space-scoped approver grant authorises governance without changing membership role',async()=>{
  const at=new Date().toISOString();
  db.prepare(`INSERT INTO journey_collaboration_role_assignments
    (id,space_id,scope_type,journey_definition_id,user_id,role,state,revision,assigned_by_user_id,assigned_at)
    VALUES (? ,?,'space',NULL,?,'approver','active',1,?,?)`)
    .run('predictive-trainer-approver',spaceId,trainerId,managerId,at);
  const membership=db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(spaceId,trainerId) as any;
  assert.equal(membership.role,'member');
  const configured=await member.put('/api/journey-predictive-governance/policies/conversion')
    .send({expectedRevision:0,policy:{...policy,purpose:'journey_conversion_decision_support'}}).expect(200);
  assert.equal(configured.body.revision,1);
});

test('policy revisions conflict and governed evaluations abstain before persisting a valid prediction',async()=>{
  const configured=await manager.put('/api/journey-predictive-governance/policies/churn').send({expectedRevision:0,policy}).expect(200);
  assert.equal(configured.body.revision,1);
  await manager.put('/api/journey-predictive-governance/policies/churn').send({expectedRevision:0,policy}).expect(409)
    .expect(({body})=>assert.equal(body.code,'JOURNEY_PREDICTIVE_POLICY_CONFLICT'));
  const model=(await manager.get('/api/journey-predictive-governance/models/churn-risk-v1').expect(200)).body;
  const versionId=String(model.versions[0].id);const base={modelVersionId:versionId,evaluatorKind:'governed_fixture',request:{
    subjectId:'customer-secret-442',purpose:policy.purpose,optedIn:true,consentAllowed:true,
    sourceWindow:{from:'2026-07-01T00:00:00.000Z',to:'2026-08-01T00:00:00.000Z'},score:.76,confidence:.88,
    featureValues:{recent_complaints:3,days_since_visit:12},featureContributions:{recent_complaints:.4,days_since_visit:-.2}}};
  await manager.post('/api/journey-predictive-governance/evaluations').send({...base,evaluatorKind:'approved_deterministic'})
    .expect(400).expect(({body})=>assert.equal(body.code,'VALIDATION_FAILED'));
  const abstained=await manager.post('/api/journey-predictive-governance/evaluations').send(base).expect(201);
  assert.equal(abstained.body.result.decision,'abstained');assert.equal(abstained.body.result.score,null);
  assert.ok(abstained.body.result.reasonCodes.includes('DRIFT_EVIDENCE_MISSING'));
  const drift=await manager.post(`/api/journey-predictive-governance/models/churn-risk-v1/versions/${versionId}/drift-evaluations`)
    .send({populationStabilityIndex:.08,missingFeatureRatio:0,outOfDistributionScore:2}).expect(201);
  assert.equal(drift.body.decision,'within_envelope');
  const predicted=await manager.post('/api/journey-predictive-governance/evaluations').send(base).expect(201);
  assert.equal(predicted.body.result.decision,'predicted');assert.equal(predicted.body.result.score,.76);
  assert.doesNotMatch(JSON.stringify(predicted.body),/customer-secret-442|featureValues|featureContributions/u);
  const failedDrift=await manager.post(`/api/journey-predictive-governance/models/churn-risk-v1/versions/${versionId}/drift-evaluations`)
    .send({populationStabilityIndex:.9,missingFeatureRatio:.5,outOfDistributionScore:20}).expect(201);
  assert.equal(failedDrift.body.decision,'abstain');
  const failed=await manager.post('/api/journey-predictive-governance/evaluations').send(base).expect(201);
  assert.equal(failed.body.result.decision,'abstained');assert.ok(failed.body.result.reasonCodes.includes('POPULATION_DRIFT_EXCEEDED'));
  const stale=await manager.post('/api/journey-predictive-governance/evaluations').send({...base,request:{...base.request,
    sourceWindow:{from:'2027-01-01T00:00:00.000Z',to:'2027-02-01T00:00:00.000Z'}}}).expect(201);
  assert.equal(stale.body.result.decision,'abstained');assert.ok(stale.body.result.reasonCodes.includes('DRIFT_EVIDENCE_STALE'));
  const runs=await member.get('/api/journey-predictive-governance/runs?limit=10').expect(200);
  assert.equal(runs.body.runs.length,4);assert.doesNotMatch(JSON.stringify(runs.body),/customer-secret-442|featureValues|featureContributions/u);
  const persisted=JSON.stringify(db.prepare('SELECT result_json FROM journey_prediction_runs').all());
  const audits=JSON.stringify(db.prepare('SELECT detail_json FROM journey_prediction_audit').all());
  assert.doesNotMatch(persisted+audits,/customer-secret-442|featureValues|featureContributions/u);
  assert.throws(()=>db.prepare('UPDATE journey_prediction_runs SET created_at=created_at').run(),/append-only/u);
  assert.throws(()=>db.prepare('DELETE FROM journey_prediction_drift_evaluations').run(),/append-only/u);
  const latest=(await manager.get('/api/journey-predictive-governance/models/churn-risk-v1').expect(200)).body;
  await manager.post('/api/journey-predictive-governance/models/churn-risk-v1/retire').send({expectedRevision:latest.model.revision}).expect(200);
  await manager.post('/api/journey-predictive-governance/evaluations').send(base).expect(422)
    .expect(({body})=>assert.equal(body.code,'JOURNEY_PREDICTIVE_MODEL_RETIRED'));
});

test('request-derived tenant and entitlement boundaries prevent cross-space reads',async()=>{
  await member.post(`/api/spaces/${memberHome}/select`).expect(200);
  const isolated=await member.get('/api/journey-predictive-governance').expect(200);assert.equal(isolated.body.models.length,0);
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(memberHome);
  await member.get('/api/journey-predictive-governance').expect(403);
});

test('runtime 39 migration is predecessor-gated and contains no inference or credential surface',()=>{
  const migration=fs.readFileSync(path.join(process.cwd(),'migrations/postgres/0039_journey_predictive_governance.sql'),'utf8');
  assert.match(migration,/MAX\(version\)[\s\S]*<>38/u);assert.match(migration,/journey_prediction_runs_append_only/u);
  assert.match(migration,/journey_prediction_audit_append_only/u);assert.doesNotMatch(migration,/api[_ -]?key|credential|provider_secret|training_job/iu);
});
