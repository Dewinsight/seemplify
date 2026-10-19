'use strict';
// Real product routes/authorization and real IdP policy/directory definitions.
// Only signed-in identity transport is synthetic; no competencyContext bypass.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { requireAuth } = require('../middleware/rbac');
const { requireOrganization } = require('../services/tenantPolicy');
const Appraisal = require('../models/Appraisal');
const Assessment = require('../models/CompetencyAssessment');
const User = require('../models/User');
const GoalPeriod = require('../models/GoalPeriod');
const OKR = require('../models/OKR');
const DomainEvent = require('../models/DomainEvent');
const AppraisalCycle = require('../models/AppraisalCycle');
const ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const actors = ['admin', 'manager', 'alternate_manager', 'employee', 'peer', 'other_manager', 'outsider', 'foreign', 'foreign_admin'];
let mongo, app, identities, extraGrants, fixture, storage;

function actualIdentityFixture() {
  // Jest's CommonJS VM cannot import these ESM files directly. A dependency-free
  // child reads the exact current IdP exports, rather than copying permissions.
  const code = `
    import {DEFAULT_ACCESS_ROLES} from './Identityprovider/src/config/accessControlCatalog.js';
    import {buildPerformanceDirectory} from './Identityprovider/src/utils/performanceDirectory.js';
    const actors=${JSON.stringify(actors)},orgA='${ORG}',orgB='bbbbbbbbbbbbbbbbbbbbbbbb';
    const id=a=>'role-chain-'+a;
    const members=actors.filter(a=>!a.startsWith('foreign')).map(a=>({account:{_id:id(a),sub:id(a),email:a+'@example.test',profile:{name:'Synthetic '+a}},role:a==='admin'?'admin':'employee',status:'active'}));
    const organization={_id:orgA,owner:'role-chain-unused-owner',members,departments:[]};
    const teams=[{_id:'team-a',name:'Delivery',organization:orgA,members:['manager','alternate_manager','employee','peer'].map(a=>({account:id(a),status:'active',role:['manager','alternate_manager'].includes(a)?'line_manager':'member'}))},{_id:'team-b',name:'Other team',organization:orgA,members:['other_manager','outsider'].map(a=>({account:id(a),status:'active',role:a==='other_manager'?'line_manager':'member'}))}];
    const foreign={_id:orgB,owner:'unused-foreign-owner',members:['foreign','foreign_admin'].map(a=>({account:{_id:id(a),sub:id(a),email:a+'@example.test',profile:{name:'Synthetic '+a}},role:a==='foreign_admin'?'admin':'employee',status:'active'})),departments:[]};
    const result={};
    for(const actor of actors){
      const isForeign=actor.startsWith('foreign'),isAdmin=actor==='admin'||actor==='foreign_admin';
      const organizationId=isForeign?orgB:orgA,keys=new Set(['employee',...(isAdmin?['organization_admin']:['manager','alternate_manager','other_manager'].includes(actor)?['line_manager']:[])]);
      const selected=DEFAULT_ACCESS_ROLES.filter(r=>keys.has(r.key)),denies=new Set(selected.flatMap(r=>r.denies.filter(x=>x.appId==='performance-management').flatMap(x=>x.permissions)));
      const permissions=[...new Set(selected.flatMap(r=>r.grants.filter(x=>x.appId==='performance-management').flatMap(x=>x.permissions)))].filter(p=>!denies.has(p));
      const directory=buildPerformanceDirectory({organization:isForeign?foreign:organization,teams:isForeign?[]:teams,actorId:id(actor)});
      const own=directory.members.find(m=>m.userId===id(actor));
      const membership={id:organizationId,role:isAdmin?'admin':'employee',appAccess:{mode:'all',appIds:[]},authorization:{permissionsByApp:{'performance-management':permissions}}};
      result[actor]={directory,user:{id:id(actor),sub:id(actor),email:actor+'@example.test',name:'Synthetic '+actor,organizations:[membership],currentOrganization:membership,teams:own.teams,idpTeams:own.teams,accessToken:'synthetic-role-chain-'+actor}};
    }
    console.log(JSON.stringify(result));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }));
}
function call(actor, method, route) {
  return request(app)[method](`/api/${route}`).set('x-role-chain-actor', actor).set('Idempotency-Key', crypto.randomUUID());
}
async function json(actor, method, route, input, status = 200, revision) {
  let pending = call(actor, method, route);
  if (revision !== undefined) pending = pending.set('If-Match', String(revision));
  if (input !== undefined) pending = pending.send(input);
  const result = await pending;
  expect({status:result.status,body:result.status===status?undefined:result.body}).toEqual({status,body:undefined});
  return result.body.data;
}
async function configure() {
  await json('admin', 'patch', 'organization-features', {features:{competencyAssessments:true}});
  const framework = await json('admin', 'post', 'competency/frameworks', {name:'Role chain framework',sourceType:'internal',source:'Synthetic authored definition',levels:[{id:'guided',label:'Guided',order:1,description:'Works with guidance'},{id:'independent',label:'Independent',order:2,description:'Works independently'}],criteria:[{id:'delivery',name:'Delivery',code:'DEL',description:'Deliver documented work',levelIds:['guided','independent']}]},201);
  const publishedFramework = await json('admin','post',`competency/frameworks/${framework.id}/versions/${framework.draftVersion.id}/publish`,{},200,1);
  const role = await json('admin','post','competency/roles',{name:'Synthetic delivery role',description:'Synthetic role for the full role chain',responsibilities:[{id:'responsibility',text:'Deliver reliable outcomes'}],requirements:[],criteria:[{id:'delivery',sourceType:'internal',criterionId:'delivery',frameworkVersionId:publishedFramework.id,expectedLevelId:'independent',weight:1,required:true,evidenceRequired:true,rationaleRequired:true,responsibilityIds:['responsibility'],requirementIds:[]}]},201);
  const publishedRole = await json('admin','post',`competency/roles/${role.id}/versions/${role.draftVersion.id}/publish`,{},200,1);
  const cycle = await json('admin','post','competency/cycles',{name:'Synthetic role chain cycle',period:{start:'2026-07-01',end:'2026-09-30'},selectedInputTypes:['internal'],frameworkVersionIds:[publishedFramework.id],strategyVersionIds:[],roleVersionIds:[publishedRole.id],scoringConfig:{version:1,method:'weighted_mean',weightMode:'relative',inputWeights:{internal:1},ratingScales:[],normalization:[{sourceVersionId:publishedFramework.id,criterionId:'delivery',method:'level_map',levelScores:{guided:40,independent:80}}],thresholds:[{id:'development',label:'Development needed',minInclusive:0,maxExclusive:75},{id:'suitable',label:'Suitable',minInclusive:75,maxInclusive:100}],missingPolicy:'block_unless_authorised_exception',exceptionPolicy:'retain_as_unscored'},rankingConfig:{enabled:false}},201);
  return {cycle:await json('admin','post',`competency/cycles/${cycle.id}/publish`,{},200,1),role:publishedRole};
}
async function launchLinked() {
  const roster=await json('admin','get','appraisals/colleague-roster');
  expect(roster.employees.find(p=>p.userId==='role-chain-employee').reviewerOptions.map(p=>p.userId)).toContain('role-chain-manager');
  const templates=await json('admin','get','appraisals/cycle-templates');
  const template=templates.find(t=>t.id==='balanced_performance'||t.templateId==='balanced_performance')||templates[0];
  const launch=await json('admin','post','appraisals/cycles',{name:'Synthetic selected-reviewer appraisal',periodStart:'2026-07-01',periodEnd:'2026-09-30',workflowDefinition:template.design,settings:{enableAiAssist:false,requireOkrAlignment:false,requireDocumentUpload:false},launchNow:true,reviewerMode:'selected',employees:[{userId:'role-chain-employee',reviewerId:'role-chain-manager'}],responseDeadlines:{selfAssessmentDue:'2027-01-10',managerReviewDue:'2027-01-20'}},201);
  expect(launch.launchSummary.launched).toBe(1);
  const parent=await Appraisal.findOne({cycleId:launch.cycle._id}).lean();expect(parent.manager.userId).toBe('role-chain-manager');expect(parent.launchContext.createdBy.userId).toBe('role-chain-admin');
  const plan={cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,assignments:[{participantId:'role-chain-employee',roleVersionId:fixture.role.id,assessorIds:['role-chain-manager']}]};
  await json('admin','post','competency/appraisal-links/validate',plan);
  const linked=await json('admin','post','competency/appraisal-links',{appraisalId:String(parent._id),cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,roleVersionId:fixture.role.id,assessorIds:['role-chain-manager']},201);
  return {parentId:String(parent._id),assessmentId:linked.outcomes[0].assessmentId,template};
}
async function submitParentReview(journey) {
  const responses=respondent=>journey.template.design.sections.flatMap(section=>(section.questions||[]).filter(()=>section.respondent===respondent||section.respondent==='both').map(question=>({sectionId:section.id,questionId:question.id,value:['rating','number'].includes(question.responseType)?4:question.responseType==='boolean'?true:question.responseType==='multi_select'?[question.options[0]?.value||question.options[0]]:question.responseType==='single_select'?question.options[0]?.value||question.options[0]:'Synthetic documented delivery and next-step learning.'})));
  const id=journey.parentId;
  await json('employee','put',`appraisals/${id}/custom-responses`,{respondentRole:'employee',submit:true,responses:responses('employee')});
  await json('employee','post',`appraisals/${id}/self-assessment`,{submit:true,selfAssessment:{overallSummary:{achievements:'Delivered a synthetic project with measurable outcomes.',challenges:'Resolved a synthetic dependency through early planning.',learnings:'Applied a structured discovery method to delivery.',improvements:'Improve early risk communication for the next project.',goals:'Complete the next synthetic milestone with documented evidence.'},overallSelfRating:4}});
  await json('manager','post',`appraisals/${id}/manager-review/start`);
  await json('manager','put',`appraisals/${id}/custom-responses`,{respondentRole:'manager',submit:true,responses:responses('manager')});
  await json('manager','post',`appraisals/${id}/manager-review`,{submit:true,managerReview:{overallManagerRating:4,overallSummary:{strengths:'Submitted manager source feedback sentinel.',areasForImprovement:'Continue early risk updates.'}}});
  await json('manager','put',`appraisals/${id}/discussion`,{markCompleted:true,notes:{strengths:'Discussed documented delivery.',nextSteps:'Continue structured planning.'}});
}
async function fill(journey) {
  const id=journey.assessmentId;
  const ownEvidence=await json('employee','post',`competency/assessments/${id}/evidence`,{title:'Synthetic employee work',text:'Completed the agreed delivery on time.',criterionIds:['delivery'],visibility:'participant'},201);
  await json('manager','post',`competency/assessments/${id}/evidence`,{title:'Private assessor sentinel',text:'Internal assessor-only source sentinel.',criterionIds:['delivery'],visibility:'assessors'},201);
  const detail=await json('manager','get',`competency/assessments/${id}`);
  return json('manager','patch',`competency/assessments/${id}`,{items:[{criterionId:'delivery',status:'assessed',observedLevelId:'independent',rationale:'Synthetic public human finding.',evidenceIds:[ownEvidence.id],reviewedSuggestionIds:[]}],managerFeedback:[{id:'role-feedback',section:'overall',text:'Submitted role feedback sentinel.',submitted:true}]},200,detail.revision);
}
async function finalise(journey) {
  const current=await json('manager','get',`competency/assessments/${journey.assessmentId}`);
  return json('manager','post',`competency/assessments/${journey.assessmentId}/finalise`,{classificationId:'suitable'},200,current.revision);
}
async function pdf(actor, assessmentId) {
  const job=await json(actor,'post',`competency/assessments/${assessmentId}/exports`,{},201);expect(job.status).toBe('ready');
  const download=await call(actor,'get',`competency/exports/${job.id}/download`).buffer(true).parse((res,done)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done(null,Buffer.concat(chunks)));}).expect(200);
  const parsed=await require('pdf-parse')(new Uint8Array(download.body),{version:'v2.0.550'});return {job,text:parsed.text};
}
beforeAll(async()=>{
  identities=actualIdentityFixture();storage=fs.mkdtempSync(path.join(os.tmpdir(),'competency-role-chain-'));process.env.COMPETENCY_PRIVATE_STORAGE_ROOT=storage;
  mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());app=express();app.use(express.json());
  app.use((req,_res,next)=>{const actor=req.get('x-role-chain-actor');if(identities[actor]){const identity=JSON.parse(JSON.stringify(identities[actor]));identity.user.organizations[0].authorization.permissionsByApp['performance-management'].push(...(extraGrants[actor]||[]));identity.user.currentOrganization=identity.user.organizations[0];req.session={user:identity.user,currentOrganizationId:identity.user.currentOrganization.id};req._performanceDirectory=identity.directory;}next();});
  app.use('/api/organization-features',require('../routes/organizationFeatures'));
  app.use('/api/competency',requireAuth,requireOrganization,require('../routes/competency'));
  app.post('/api/appraisals/:appraisalId/finalize',requireAuth,requireOrganization,require('../services/competency/appraisalBridgeService').guardFinalOutcome);
  app.use('/api/appraisals',require('../routes/appraisals'));
  app.use('/api/okrs',requireAuth,require('../routes/okrs'));
});
beforeEach(async()=>{extraGrants={};await mongoose.connection.db.dropDatabase();await Promise.all(Object.values(mongoose.models).map(model=>model.createIndexes()));for(const actor of actors){const{user}=identities[actor];await User.create({idpSub:user.sub,email:user.email,profile:{displayName:user.name},currentOrganizationId:user.currentOrganization.id,idpTeams:user.teams,organizationMemberships:[{organization:user.currentOrganization.id,role:user.currentOrganization.role,isActive:true}]});}fixture=await configure();await json('foreign_admin','patch','organization-features',{features:{competencyAssessments:true}});});
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();if(storage){expect(path.dirname(storage)).toBe(path.resolve(os.tmpdir()));expect(path.basename(storage)).toMatch(/^competency-role-chain-/);fs.rmSync(storage,{recursive:true,force:true});}delete process.env.COMPETENCY_PRIVATE_STORAGE_ROOT;});

test('actual IdP defaults expose admin configuration, managed manager scope and employee personal capabilities',async()=>{
  const admin=await json('admin','get','competency/bootstrap'),manager=await json('manager','get','competency/bootstrap'),employee=await json('employee','get','competency/bootstrap');
  expect(admin.scope).toBe('organization');expect(admin.capabilities.roleManage).toBe(true);expect(manager.scope).toBe('managed_teams');expect(manager.capabilities.assessmentEdit).toBe(true);expect(manager.capabilities.roleManage).toBe(false);expect(employee.scope).toBe('self');expect(employee.capabilities.assessmentEdit).toBe(false);expect(employee.capabilities.reportView).toBe(true);expect(employee.capabilities.reportExport).toBe(false);
  await json('employee','patch','organization-features',{features:{competencyAssessments:false}},403);await json('manager','post','competency/roles',{name:'Forbidden'},403);await json('employee','patch','competency/settings',{aiDraftsEnabled:true},403,0);
});
test('admin selects real manager, employee submits, manager publishes both linked outcomes, employee reads attributed report',async()=>{
  const journey=await launchLinked();await submitParentReview(journey);const filled=await fill(journey);
  const denied=await call('manager','post',`appraisals/${journey.parentId}/finalize`).send({finalRating:4,justification:'Synthetic evidence supports this final outcome.'}).expect(409);expect(denied.body.code).toBe('ROLE_ASSESSMENT_REQUIRED');
  const published=await finalise(journey);expect(published.result.score.overallScore).toBe(80);expect(published.result.managerSource.author.userId).toBe('role-chain-manager');expect(JSON.stringify(published.result.managerFeedback)).toContain('Submitted manager source feedback sentinel.');
  expect(published.result.managerFeedback.find(entry=>entry.text==='Submitted role feedback sentinel.').author.userId).toBe('role-chain-manager');
  await json('manager','post',`appraisals/${journey.parentId}/finalize`,{finalRating:4,justification:'Synthetic evidence supports this final outcome.'});
  const ownReport=await json('employee','get',`competency/assessments/${journey.assessmentId}/report`);expect(ownReport.participant.userId).toBe('role-chain-employee');expect(JSON.stringify(ownReport)).not.toContain('Internal assessor-only source sentinel.');expect(ownReport.finalClassification.label).toBe('Suitable');
  const ordinary=await json('employee','get',`appraisals/${journey.parentId}/report`);expect(ordinary.finalRating.overall).toBe(4);await json('employee','post',`appraisals/${journey.parentId}/acknowledge`,{});expect((await Appraisal.findById(journey.parentId).lean()).status).toBe('employee_acknowledged');expect(filled.items[0].assessedBy.userId).toBe('role-chain-manager');
});
test('employee sees no assessor drafts and cannot edit findings, finalise, reopen, or access another employee',async()=>{
  const journey=await launchLinked();await fill(journey);const own=await json('employee','get',`competency/assessments/${journey.assessmentId}`);expect(own.items).toEqual([]);expect(own.managerFeedback).toEqual([]);expect(JSON.stringify(own)).not.toContain('Private assessor sentinel');
  for(const route of ['finalise','reopen'])await json('employee','post',`competency/assessments/${journey.assessmentId}/${route}`,{classificationId:'suitable',reason:'Unauthorized employee request'},403,own.revision);
  await json('employee','patch',`competency/assessments/${journey.assessmentId}`,{items:[]},403,own.revision);await json('peer','get',`competency/assessments/${journey.assessmentId}`,undefined,403);await json('other_manager','get',`competency/assessments/${journey.assessmentId}`,undefined,403);await json('foreign','get',`competency/assessments/${journey.assessmentId}`,undefined,404);
  const unpublished=await call('employee','get',`competency/assessments/${journey.assessmentId}/report`).expect(404);expect(unpublished.body.error.code).toBe('REPORT_NOT_FOUND');await json('employee','post',`competency/assessments/${journey.assessmentId}/exports`,{},403);
});
test('explicit employee export grant permits own PDF only and cannot read a manager-owned export receipt',async()=>{
  const journey=await launchLinked();await submitParentReview(journey);await fill(journey);await finalise(journey);
  await json('employee','post',`competency/assessments/${journey.assessmentId}/exports`,{},403);extraGrants.employee=['competency.report.export'];const own=await pdf('employee',journey.assessmentId);expect(own.text).toContain('Synthetic public human finding.');expect(own.text).not.toContain('Internal assessor-only source sentinel.');
  const manager=await pdf('manager',journey.assessmentId);await json('employee','get',`competency/exports/${manager.job.id}`,undefined,404);await json('peer','get',`competency/exports/${own.job.id}/download`,undefined,404);
  const other=await json('admin','post','competency/assessments/launch',{cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,assignments:[{participantId:'role-chain-outsider',roleVersionId:fixture.role.id,assessorIds:['role-chain-other_manager']}]},201);await json('employee','post',`competency/assessments/${other.outcomes[0].assessmentId}/exports`,{},403);
  extraGrants.employee=[];await json('employee','get',`competency/exports/${own.job.id}/download`,undefined,403);
});
test('linked appraisal private findings and decisions require the currently eligible selected manager, not another team manager',async()=>{
  const journey=await launchLinked(),filled=await fill(journey);
  expect(identities.alternate_manager.directory.reviewers.find(p=>p.userId==='role-chain-alternate_manager').eligibleTeamIds).toContain('team-a');
  await json('alternate_manager','get',`appraisals/${journey.parentId}`,undefined,403);
  await json('alternate_manager','get',`competency/assessments/${journey.assessmentId}`,undefined,403);
  for(const action of ['finalise','exports'])await json('alternate_manager','post',`competency/assessments/${journey.assessmentId}/${action}`,action==='finalise'?{classificationId:'suitable'}:{},403,filled.revision);
  await json('alternate_manager','patch',`competency/assessments/${journey.assessmentId}`,{items:[]},403,filled.revision);
  expect((await json('admin','get',`competency/assessments/${journey.assessmentId}`)).items[0].rationale).toBe('Synthetic public human finding.');
  const original=identities.manager.directory;identities.manager.directory={...original,members:original.members.filter(person=>person.userId!=='role-chain-employee')};
  try{await json('manager','get',`competency/assessments/${journey.assessmentId}`,undefined,403);}finally{identities.manager.directory=original;}
  identities.manager.directory={...original,reviewers:original.reviewers.filter(person=>person.userId!=='role-chain-manager')};
  try{await json('manager','get',`competency/assessments/${journey.assessmentId}`,undefined,403);}finally{identities.manager.directory=original;}
});
test('standalone assessments retain the existing managed-team contract without broadening linked appraisal authority',async()=>{
  const result=await json('admin','post','competency/assessments/launch',{cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,assignments:[{participantId:'role-chain-employee',roleVersionId:fixture.role.id,assessorIds:['role-chain-manager']}]},201);
  const detail=await json('alternate_manager','get',`competency/assessments/${result.outcomes[0].assessmentId}`);expect(detail.allowedActions).toContain('competency.assessment.edit');await json('alternate_manager','patch',`competency/assessments/${detail.id}`,{items:[]},200,detail.revision);
});
test('manager cannot launch or assess outside current team even when forging a selected reviewer or participant',async()=>{
  const body={cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,assignments:[{participantId:'role-chain-outsider',roleVersionId:fixture.role.id,assessorIds:['role-chain-manager']}]};await json('manager','post','competency/assessments/launch',body,404);
  await json('admin','post','competency/assessments/launch',body,422);body.assignments[0].assessorIds=['role-chain-other_manager'];const launched=await json('admin','post','competency/assessments/launch',body,201);const id=launched.outcomes[0].assessmentId;await json('manager','get',`competency/assessments/${id}`,undefined,403);await json('employee','get',`competency/assessments/${id}`,undefined,403);await json('manager','patch',`competency/assessments/${id}`,{items:[]},403,1);expect((await json('other_manager','get',`competency/assessments/${id}`)).participant.userId).toBe('role-chain-outsider');
});

async function goalRequiredLaunchBody(employees = ['employee']) {
  const templates = await json('admin', 'get', 'appraisals/cycle-templates');
  return {
    name: 'Synthetic goal-required preflight', periodStart: '2026-07-01', periodEnd: '2026-09-30',
    workflowDefinition: templates[0].design,
    settings: { enableAiAssist: false, requireOkrAlignment: true, requireDocumentUpload: false },
    launchNow: true, reviewerMode: 'selected',
    employees: employees.map(actor => ({ userId: `role-chain-${actor}`, reviewerId: 'role-chain-manager' })),
    responseDeadlines: { selfAssessmentDue: '2027-01-10', managerReviewDue: '2027-01-20' }
  };
}
async function createAlignedGoal() {
  const period = await GoalPeriod.create({ organizationId: ORG, name: 'Synthetic approved-goal period', code: 'ROLE-CHAIN-GOALS', type: 'custom', startDate: '2026-07-01', endDate: '2026-09-30', status: 'open', planningStartDate: '2026-01-01', planningEndDate: '2027-01-01' });
  const objectives = [{ title: 'Document delivery', keyResults: [{ title: 'Agreed work delivered', metricType: 'number', startValue: 0, targetValue: 10 }] }];
  const parent = await json('admin', 'post', 'okrs', { title: 'Synthetic company priority', type: 'organization', periodId: String(period._id), objectives }, 201);
  const child = await json('employee', 'post', 'okrs', { title: 'Synthetic aligned delivery', type: 'individual', periodId: String(period._id), parentOKRId: parent._id, objectives }, 201);
  expect(child.lifecycle.state).toBe('draft');
  expect(String(child.alignment.parentOKRId)).toBe(String(parent._id));
  return child;
}

test('goal-required empty launch fails before creating any appraisal or notification event', async () => {
  const body = await goalRequiredLaunchBody();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const denied = await json('admin', 'post', 'appraisals/cycles', body, 400);
    expect(denied).toMatchObject({ launched: 0, replayed: 0, errors: 1 });
    expect(denied.errorDetails[0]).toMatchObject({ userId: 'role-chain-employee', code: 'APPROVED_GOALS_REQUIRED' });
    expect(denied.errorDetails[0].error).toMatch(/Approve the goals before starting.*cycle that does not require goal alignment/);
    expect(await Appraisal.countDocuments()).toBe(0);
    expect(await AppraisalCycle.countDocuments({ name: body.name })).toBe(0);
    expect(await DomainEvent.countDocuments({ 'aggregate.type': 'appraisal' })).toBe(0);
  }
});

test('goal-required mixed launch admits an approved aligned snapshot and reuses it on retry without duplicate events', async () => {
  const goal = await createAlignedGoal();
  const body = await goalRequiredLaunchBody(['employee', 'peer']);
  const draftRejected = await json('admin', 'post', 'appraisals/cycles', body, 400);
  expect(draftRejected.errorDetails.map(error => error.code)).toEqual(['APPROVED_GOALS_REQUIRED', 'APPROVED_GOALS_REQUIRED']);
  await json('employee', 'post', `okrs/${goal._id}/submit`, {});
  const pendingRejected = await json('admin', 'post', 'appraisals/cycles', body, 400);
  expect(pendingRejected.launched).toBe(0);
  const approved = await json('admin', 'post', `okrs/${goal._id}/decision`, { decision: 'approve' });
  expect(approved).toMatchObject({ approvalStatus: 'approved', lifecycle: { state: 'active' } });
  const launched = await json('admin', 'post', 'appraisals/cycles', body, 201);
  expect(launched.launchSummary).toMatchObject({ launched: 1, replayed: 0, errors: 1 });
  expect(launched.launchSummary.errorDetails[0]).toMatchObject({ userId: 'role-chain-peer', code: 'APPROVED_GOALS_REQUIRED' });
  const appraisal = await Appraisal.findOne({ cycleId: launched.cycle._id }).lean();
  expect(appraisal.employee.userId).toBe('role-chain-employee');
  expect(appraisal.manager.userId).toBe('role-chain-manager');
  expect(appraisal.cycleConfigurationSnapshot.settings.requireOkrAlignment).toBe(true);
  expect(appraisal.goalSnapshots).toHaveLength(1);
  expect(String(appraisal.goalSnapshots[0].sourceGoalId)).toBe(String(goal._id));
  expect(appraisal.goalSnapshots[0].definition.title).toBe('Synthetic aligned delivery');
  expect(appraisal.goalSnapshots[0].alignment.parentOKRId).toBeTruthy();
  const eventCount = await DomainEvent.countDocuments({ 'aggregate.type': 'appraisal' });
  expect(eventCount).toBeGreaterThan(0);
  // Later source changes must not rewrite a frozen review or duplicate events.
  await OKR.updateOne({ _id: goal._id }, { $set: { approvalStatus: 'pending', 'lifecycle.state': 'pending_approval', title: 'Later source change' } });
  const retried = await json('admin', 'post', `appraisals/cycles/${launched.cycle._id}/launch`, { reviewerMode: 'selected', employees: body.employees, responseDeadlines: body.responseDeadlines });
  expect(retried).toMatchObject({ launched: 0, replayed: 1, errors: 1 });
  expect(retried.errorDetails[0].code).toBe('APPROVED_GOALS_REQUIRED');
  expect(await Appraisal.countDocuments()).toBe(1);
  expect(await DomainEvent.countDocuments({ 'aggregate.type': 'appraisal' })).toBe(eventCount);
  const frozen = await Appraisal.findById(appraisal._id).lean();
  expect(frozen.goalSnapshots[0].definition.title).toBe('Synthetic aligned delivery');
  expect(String(frozen._id)).toBe(String(appraisal._id));
});
