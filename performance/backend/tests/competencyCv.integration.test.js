'use strict';
// Real routes, Mongo transactions, central-action/resource authorization and private
// file bytes. Only OIDC transport/directory and malware scanner are synthetic.
const mongoose=require('mongoose');
const express=require('express');
const request=require('supertest');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const auth=require('../services/competency/authorizationService');
const bridge=require('../services/competency/appraisalBridgeService');
const library=require('../services/competency/libraryService');
const safety=require('../services/competency/fileSafetyService');
const managed=require('../services/competency/managedCvStorageService');
const Assessment=require('../models/CompetencyAssessment');
const Evidence=require('../models/CompetencyEvidence');
const Appraisal=require('../models/Appraisal');
const {DomainError}=require('../contracts/competency');
let mongo,app,fixture,privateRoot,previousRoot;
const members=['owner','admin','hr','manager','employee','other'].map(userId=>({userId,name:`Fictional ${userId}`,organizationRole:userId==='employee'||userId==='other'?'staff':userId==='hr'?'hr_manager':userId==='manager'?'staff':userId,teamIds:userId==='other'?['team-b']:['team-a'],teams:[{organizationId:'org-a',id:userId==='other'?'team-b':'team-a',role:userId==='manager'?'line_manager':'member'}]}));
function principal(who='owner',organizationId='org-a') {
  const member=members.find(row=>row.userId===who),wide=['owner','admin','hr'].includes(who),manager=who==='manager';
  const permissions=wide||manager?auth.ACTIONS:['assessment.view','evidence.view','evidence.create','evidence.delete','report.view'].map(p=>`competency.${p}`);
  const organization={id:organizationId,role:member.organizationRole,authorization:{permissionsByApp:{'performance-management':permissions}}};
  return {session:{currentOrganizationId:organizationId,user:{sub:who,id:who,email:`${who}@example.test`,name:member.name,organizations:[organization],currentOrganization:organization}},_performanceDirectory:{organizationId,organizationRole:member.organizationRole,scope:wide?'organization':manager?'managed_teams':'self',canStartAppraisals:wide||manager,members:wide?members:manager?members.filter(row=>row.userId!=='other'):[member],teams:[{id:'team-a'}],reviewers:[{userId:'owner',name:'Fictional owner',organizationWide:true,eligibleTeamIds:[]},{userId:'manager',name:'Fictional manager',organizationWide:false,eligibleTeamIds:['team-a']}]}};
}
const call=(method,url,who='owner',org='org-a',key=crypto.randomUUID())=>request(app)[method]('/api/competency'+url).set('x-who',who).set('x-org',org).set('Idempotency-Key',key);
const assignment=(extra={})=>({participantId:'employee',roleVersionId:fixture.role.id,assessorIds:['manager'],...extra});
const launchInput=(extra={})=>({cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,assignments:[assignment(extra)]});
async function launch(extra={},who='owner') {return (await call('post','/assessments/launch',who).send(launchInput(extra)).expect(201)).body.data.outcomes[0].assessmentId;}
const cvBytes=Buffer.from('FICTIONAL QA CV ONLY\nDelivery experience: synthetic example. No real person.');
function upload(id,who='employee',fields={},key=crypto.randomUUID(),bytes=cvBytes,name='fictional-cv.txt',mime='text/plain') {let req=call('post',`/assessments/${id}/evidence`,who,'org-a',key).field('documentType','cv').field('title','Fictional QA CV');for(const [field,value] of Object.entries(fields))req=req.field(field,typeof value==='string'?value:JSON.stringify(value));return req.attach('file',bytes,{filename:name,contentType:mime});}
beforeAll(async()=>{mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());previousRoot=process.env.COMPETENCY_PRIVATE_STORAGE_ROOT;privateRoot=await fs.mkdtemp(path.join(os.tmpdir(),'competency-cv-test-'));process.env.COMPETENCY_PRIVATE_STORAGE_ROOT=privateRoot;app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,principal(req.get('x-who')||'owner',req.get('x-org')||'org-a'));next();});app.use('/api/competency',require('../routes/competency/assessments'));});
function mockedCloudinary() {
  const files=new Map();
  const client={uploader:{upload_stream:(options,callback)=>({end:buffer=>{files.set(options.public_id,buffer);callback(null,{public_id:options.public_id,resource_type:'raw',type:'authenticated',bytes:buffer.length});}}),destroy:async key=>{files.delete(key);return {result:'ok'};}},utils:{private_download_url:key=>`https://api.cloudinary.com/v1_1/synthetic/raw/download?public_id=${encodeURIComponent(key)}`}};
  return managed.createManagedCvStorage({configurationResolver:async()=>({configured:true,defaultProvider:'azure-blob',providers:{cloudinary:{configured:true,cloudName:'synthetic',apiKey:'synthetic-key',apiSecret:'synthetic-secret'}}}),cloudinaryClient:client,request:async url=>new Response(files.get(new URL(url).searchParams.get('public_id')),{status:200})});
}
beforeEach(async()=>{const adapter=mockedCloudinary();for(const method of ['store','read','remove'])jest.spyOn(managed,method).mockImplementation((...args)=>adapter[method](...args));await mongoose.connection.db.dropDatabase();for(const model of Object.values(mongoose.models))await model.createIndexes();fixture=await configure();const scan=safety.inspectAndScan;jest.spyOn(safety,'inspectAndScan').mockImplementation(input=>scan(input,{scan:async()=>({provider:'explicit-mocked-clean-scanner',version:'test',scannedAt:new Date().toISOString()})}));});
afterEach(()=>jest.restoreAllMocks());
afterAll(async()=>{await mongoose.disconnect();await mongo.stop();if(previousRoot===undefined)delete process.env.COMPETENCY_PRIVATE_STORAGE_ROOT;else process.env.COMPETENCY_PRIVATE_STORAGE_ROOT=previousRoot;if(privateRoot.startsWith(path.join(os.tmpdir(),'competency-cv-test-')))await fs.rm(privateRoot,{recursive:true,force:true});});
async function configure(sources=['internal']){const ctx=await auth.context(principal()),sourceRows=[];for(const source of sources){if(source==='strategy'){const s=await library.createStrategy(ctx,{title:'Strategy',description:'Synthetic strategy',criteria:[{id:'delivery',code:'DEL',name:'Delivery',description:'Delivery work',levelIds:[]}],levels:[]},{});sourceRows.push({...await library.publishStrategy(ctx,s.strategyId,s.id,s.revision),sourceType:'strategy'});}else{const f=await library.createFramework(ctx,{name:`${source} ${crypto.randomUUID()}`,sourceType:source,source:'Synthetic authored fixture',licenseProvenance:'Synthetic fixture only',levels:[{id:'low',label:'Guided',description:'Works with guidance',order:1},{id:'high',label:'Independent',description:'Works independently',order:2}],criteria:[{id:'delivery',code:'DEL',name:'Delivery',description:'Reliable delivery',levelIds:['low','high']}]});sourceRows.push(await library.publishFramework(ctx,f.id,f.draftVersion.id,1));}}
const role=await library.createRole(ctx,{name:`Delivery role ${crypto.randomUUID()}`,description:'Synthetic role',responsibilities:[{id:'r',text:'Deliver reliably'}],requirements:[{id:'q',text:'Experience',required:true}],criteria:sourceRows.map((source,index)=>({id:`criterion-${index}`,sourceType:source.sourceType,criterionId:'delivery',...(source.sourceType==='strategy'?{strategyVersionId:source.id,evaluationTarget:{scaleId:'percent',value:90}}:{frameworkVersionId:source.id,expectedLevelId:'high'}),weight:1,required:true,evidenceRequired:true,rationaleRequired:true,responsibilityIds:['r'],requirementIds:['q']}))});const publishedRole=await library.publishRole(ctx,role.id,role.draftVersion.id,1);const cycle=await library.createCycle(ctx,{name:'Synthetic cycle',period:{start:'2026-07-01',end:'2026-09-30'},selectedInputTypes:sources,frameworkVersionIds:sourceRows.filter(row=>row.sourceType!=='strategy').map(row=>row.id),strategyVersionIds:sourceRows.filter(row=>row.sourceType==='strategy').map(row=>row.id),roleVersionIds:[publishedRole.id],scoringConfig:{version:1,method:'weighted_mean',weightMode:'relative',inputWeights:Object.fromEntries(sources.map(s=>[s,1])),ratingScales:sources.includes('strategy')?[{id:'percent',label:'Completion',min:0,max:100}]:[],normalization:sourceRows.map(source=>({sourceVersionId:source.id,criterionId:'delivery',...(source.sourceType==='strategy'?{method:'rating_scale',ratingScaleId:'percent'}:{method:'level_map',levelScores:{low:60,high:80}})})),thresholds:[{id:'development',label:'Development needed',minInclusive:0,maxExclusive:75},{id:'suitable',label:'Suitable',minInclusive:75,maxInclusive:100}],missingPolicy:'block_unless_authorised_exception',exceptionPolicy:'retain_as_unscored'},rankingConfig:{enabled:true,scope:'role',direction:'desc',tieRule:'competition',decimalPlaces:2,measure:'overallScore'}});return{cycle:await library.publishCycle(ctx,cycle.id,1),role:publishedRole};}

test.each(['owner','admin','hr','manager'])('%s can request a CV without changing the frozen role/cycle/scoring definition',async who=>{
  const cycleBefore=await require('../models/CompetencyCycle').findById(fixture.cycle.id).lean();
  const id=await launch({cvRequested:true},who);
  const detail=(await call('get',`/assessments/${id}`,'employee').expect(200)).body.data;
  expect(detail.cvRequested).toBe(true);expect(detail.definitionSnapshot.cvRequested).toBe(true);
  expect(detail.definitionSnapshot.role.versionId).toBe(fixture.role.id);
  const expected=await library.getPublishedDefinition({organizationId:'org-a',cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,roleVersionId:fixture.role.id});
  expect(detail.definitionSnapshot.definitionHash).toBe(expected.definitionHash);
  expect(await require('../models/CompetencyCycle').findById(fixture.cycle.id).lean()).toEqual(cycleBefore);
  expect((await call('get','/assessments','employee').expect(200)).body.data[0].cvRequested).toBe(true);
});

test('default false and request-on are assignment-specific; retry cannot change the frozen request',async()=>{
  const key=crypto.randomUUID(),input=launchInput({cvRequested:true});
  input.assignments.push(assignment({participantId:'other',assessorIds:['owner']}));
  const first=(await call('post','/assessments/launch','owner','org-a',key).send(input).expect(201)).body.data;
  expect(first.outcomes.map(row=>row.cvRequested)).toEqual([true,false]);
  expect((await call('post','/assessments/launch','owner','org-a',key).send(input).expect(201)).body.data).toEqual(first);
  const changed=launchInput({cvRequested:false});
  await call('post','/assessments/launch','owner','org-a',key).send(changed).expect(409);
  const retry=(await call('post','/assessments/launch').send(changed).expect(201)).body.data;
  expect(retry.outcomes[0]).toMatchObject({status:'existing',cvRequested:true});
  expect(await Assessment.countDocuments()).toBe(2);
});

test('non-boolean flags and employee, unrelated-team and foreign-org launch attempts are rejected',async()=>{
  for(const cvRequested of ['true',1,null,{}])expect((await call('post','/assessments/launch').send(launchInput({cvRequested})).expect(422)).body.error.code).toBe('INVALID_CV_REQUEST');
  await call('post','/assessments/launch','employee').send(launchInput({cvRequested:true})).expect(403);
  await call('post','/assessments/launch','manager').send(launchInput({participantId:'other',cvRequested:true})).expect(404);
  await call('post','/assessments/launch','owner','org-b').send(launchInput({cvRequested:true})).expect(404);
  expect(await Assessment.countDocuments()).toBe(0);
});

test('appraisal bridge validates, freezes and reads back the optional per-link request',async()=>{
  const ctx=await auth.context(principal('manager'));
  const appraisal=await Appraisal.create({cycleId:new mongoose.Types.ObjectId(),organizationId:'org-a',employee:{userId:'employee',name:'Fictional employee',email:'employee@example.test'},manager:{userId:'manager',name:'Fictional manager',email:'manager@example.test'}});
  const input={appraisalId:String(appraisal._id),cycleId:fixture.cycle.id,cycleRevision:fixture.cycle.revision,roleVersionId:fixture.role.id,assessorIds:['manager'],cvRequested:true};
  await expect(bridge.validatePlan(ctx,{...launchInput(),assignments:[assignment({cvRequested:'true'})]})).rejects.toMatchObject({status:422,code:'INVALID_CV_REQUEST'});
  expect((await bridge.validatePlan(ctx,launchInput({cvRequested:true}))).valid).toBe(true);
  const result=await bridge.link(ctx,input,crypto.randomUUID());
  expect(result.outcomes[0].cvRequested).toBe(true);
  expect((await bridge.links(await auth.context(principal('employee')),input.appraisalId)).assessments[0].cvRequested).toBe(true);
  await expect(bridge.link(await auth.context(principal('employee')),input,crypto.randomUUID())).rejects.toMatchObject({status:403});
});

test('employee CV upload stores exact private bytes, defaults frozen criteria and is safe to retry',async()=>{
  const id=await launch({cvRequested:true}),key=crypto.randomUUID();
  const before=await Assessment.findById(id).lean();
  const cv=(await upload(id,'employee',{},key).expect(201)).body.data;
  expect(cv).toMatchObject({documentType:'cv',kind:'file',visibility:'participant',size:cvBytes.length,mimeType:'text/plain',createdBy:{userId:'employee'},criterionIds:['criterion-0'],status:'ready'});
  expect(cv.storageKey).toBeUndefined();expect(cv.sha256).toBe(crypto.createHash('sha256').update(cvBytes).digest('hex'));
  expect((await upload(id,'employee',{},key).expect(201)).body.data.id).toBe(cv.id);
  expect(await Evidence.countDocuments({assessmentId:id})).toBe(1);
  for(const who of ['employee','manager']){
    const source=await call('get',`/assessments/${id}/evidence/${cv.id}/source`,who).expect(200);
    expect(source.text).toBe(cvBytes.toString());expect(source.headers['cache-control']).toBe('private, no-store');
  }
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'other').expect(403);
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'owner','org-b').expect(404);
  const after=await Assessment.findById(id).lean();
  expect(after.items).toEqual(before.items);expect(after.results).toEqual(before.results);
  expect(await require('../models/CompetencyAISuggestion').countDocuments()).toBe(0);
});

test('assessor-uploaded CV is visible to its participant before publication; ordinary evidence stays restricted',async()=>{
  const id=await launch();
  const cv=(await upload(id,'manager').expect(201)).body.data;
  const normal=(await call('post',`/assessments/${id}/evidence`,'manager').send({title:'Ordinary draft',text:'Assessor draft',criterionIds:['criterion-0'],visibility:'participant'}).expect(201)).body.data;
  const employee=(await call('get',`/assessments/${id}`,'employee').expect(200)).body.data;
  expect(employee.evidence.map(row=>row.id)).toEqual([cv.id]);
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'employee').expect(200);
  await call('get',`/assessments/${id}/evidence/${normal.id}`,'employee').expect(404);
  await call('delete',`/assessments/${id}/evidence/${cv.id}`,'employee').expect(404);
});

test('invalid category, missing file, private audience, foreign criteria and misleading bytes fail before storage',async()=>{
  const id=await launch();
  for(const [body,code] of [[{documentType:'resume'},'INVALID_DOCUMENT_TYPE'],[{documentType:'cv',text:'manual note'},'CV_FILE_REQUIRED']])expect((await call('post',`/assessments/${id}/evidence`,'employee').send(body).expect(422)).body.error.code).toBe(code);
  expect((await upload(id,'manager',{visibility:'assessors'}).expect(422)).body.error.code).toBe('CV_AUDIENCE_REQUIRED');
  expect((await upload(id,'employee',{criterionIds:['foreign-criterion']}).expect(422)).body.error.code).toBe('INVALID_CRITERIA');
  expect((await upload(id,'employee',{},crypto.randomUUID(),Buffer.from('not a pdf'),'fake.pdf','application/pdf').expect(422)).body.error.code).toBe('UNSAFE_FILE');
  expect(await Evidence.countDocuments()).toBe(0);
});

test('creation-key replay cannot reclassify an old source and never infers CV from its filename',async()=>{
  const id=await launch(),key=crypto.randomUUID();
  const normal=(await call('post',`/assessments/${id}/evidence`,'employee','org-a',key).field('title','Old supporting file').field('visibility','participant').field('criterionIds','["criterion-0"]').attach('file',cvBytes,{filename:'my-cv.txt',contentType:'text/plain'}).expect(201)).body.data;
  expect(normal.documentType).toBe('supporting_evidence');
  await upload(id,'employee',{},key).expect(409);
  const ctx=await auth.context(principal('employee'));
  await expect(require('../services/competency/evidenceService').add(ctx,id,{documentType:'cv'}, {buffer:cvBytes,originalname:'cv.txt',mimetype:'text/plain'},key)).rejects.toMatchObject({code:'EVIDENCE_TYPE_CONFLICT'});
  expect((await Evidence.findById(normal.id).lean()).documentType).toBe('supporting_evidence');
  expect(await Evidence.countDocuments()).toBe(1);
});

async function fillWithoutCv(id) {
  const normal=(await call('post',`/assessments/${id}/evidence`,'manager').send({title:'Human observation',text:'Observed fictional delivery independently.',visibility:'participant',criterionIds:['criterion-0']}).expect(201)).body.data;
  const current=(await call('get',`/assessments/${id}`,'manager').expect(200)).body.data;
  return (await call('patch',`/assessments/${id}`,'manager').set('If-Match',String(current.revision)).send({items:[{criterionId:'criterion-0',status:'assessed',observedLevelId:'high',rationale:'Explicit human observation',evidenceIds:[normal.id],reviewedSuggestionIds:[]}]}).expect(200)).body.data;
}
test('a missing requested CV never blocks completion; typed metadata reaches a frozen report without affecting scores/history',async()=>{
  const id=await launch({cvRequested:true});let current=await fillWithoutCv(id);
  const check=(await call('post',`/assessments/${id}/completion-check`,'manager').send({}).expect(200)).body.data;expect(check.ready).toBe(true);
  const before=(await call('post',`/assessments/${id}/calculate`,'manager').send({}).expect(200)).body.data;
  const first=(await call('post',`/assessments/${id}/finalise`,'manager').set('If-Match',String(current.revision)).send({classificationId:'suitable'}).expect(200)).body.data;
  const old=(await call('get',`/assessments/${id}/report`,'employee').expect(200)).body.data;
  await upload(id).expect(409);
  await call('post',`/assessments/${id}/reopen`).set('If-Match',String(first.revision)).send({reason:'Add optional fictional source'}).expect(200);
  const cv=(await upload(id,'employee').expect(201)).body.data;
  const after=(await call('post',`/assessments/${id}/calculate`,'manager').send({}).expect(200)).body.data;
  expect(after.score).toEqual(before.score);expect(after.scoreHash).toBe(before.scoreHash);expect(after.compatibilityKey).toBe(before.compatibilityKey);
  current=(await call('get',`/assessments/${id}`,'manager').expect(200)).body.data;
  const second=(await call('post',`/assessments/${id}/finalise`,'manager').set('If-Match',String(current.revision)).send({classificationId:'suitable'}).expect(200)).body.data;
  expect(second.result.evidenceReferences.find(row=>row.id===cv.id)).toMatchObject({documentType:'cv',originalName:'fictional-cv.txt',mimeType:'text/plain',size:cvBytes.length,createdBy:{userId:'employee'}});
  expect(second.result.findings[0].evidenceIds).not.toContain(cv.id);
  expect(second.result.finalClassification.id).toBe(first.result.finalClassification.id);
  const historical=(await call('get',`/assessments/${id}/report?resultVersion=1`,'employee').expect(200)).body.data;
  expect(historical.reportHash).toBe(old.reportHash);expect(historical.visibilityHash).toBe(old.visibilityHash);
  const stored=await Assessment.findById(id).lean();expect(stored.results[0].reportHash).toBe(first.result.reportHash);
  expect(await require('../models/CompetencyAISuggestion').countDocuments()).toBe(0);
});

test('expired and deleted CV files lose download access; legacy snapshot/source fields remain default-only DTO additions',async()=>{
  const id=await launch(),cv=(await upload(id).expect(201)).body.data;
  await Evidence.updateOne({_id:cv.id},{$set:{retention:{expiresAt:new Date(Date.now()-1000)}}});
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'manager').expect(409);
  await Evidence.updateOne({_id:cv.id},{$set:{retention:{expiresAt:null}}});
  await call('delete',`/assessments/${id}/evidence/${cv.id}`,'employee').expect(200);
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'manager').expect(409);
  const legacy=await Evidence.collection.insertOne({organizationId:'org-a',assessmentId:id,participantId:'employee',title:'Legacy CV-looking filename',originalName:'old-cv.txt',kind:'file',visibility:'participant',status:'ready',createdBy:{userId:'employee'}});
  await Assessment.updateOne({_id:id},{$unset:{'definitionSnapshot.cvRequested':1}});
  const snapshotBefore=await Assessment.findById(id).lean();
  const detail=(await call('get',`/assessments/${id}`,'employee').expect(200)).body.data;
  expect(detail.cvRequested).toBe(false);expect(detail.evidence.find(row=>row.id===String(legacy.insertedId)).documentType).toBe('supporting_evidence');
  expect(await Assessment.findById(id).lean()).toEqual(snapshotBefore);
  expect((await Evidence.collection.findOne({_id:legacy.insertedId})).documentType).toBeUndefined();
});


test('scanner/configuration preflight failures allow stable-key retry, but post-create audit uncertainty cannot replay',async()=>{
  const id=await launch(),key=crypto.randomUUID();
  safety.inspectAndScan.mockRejectedValueOnce(new DomainError(503,'SCAN_UNAVAILABLE','Scanner temporarily unavailable.'));
  expect((await upload(id,'employee',{},key).expect(503)).body.error.code).toBe('SCAN_UNAVAILABLE');
  expect(await Evidence.countDocuments()).toBe(0);
  expect((await upload(id,'employee',{},key).expect(201)).body.data.documentType).toBe('cv');
  const configKey=crypto.randomUUID(),unconfigured=managed.createManagedCvStorage({configurationResolver:async()=>({providers:{}})});
  managed.store.mockImplementationOnce((...args)=>unconfigured.store(...args));
  await upload(id,'employee',{},configKey).expect(503);
  await upload(id,'employee',{},configKey).expect(201);
  const auditKey=crypto.randomUUID(),audit=auth.audit;
  jest.spyOn(auth,'audit').mockImplementation(async(...args)=>{if(args[1]==='evidence.created')throw new DomainError(503,'AUDIT_UNAVAILABLE','Audit temporarily unavailable.');return audit(...args);});
  await upload(id,'employee',{},auditKey).expect(503);
  const count=await Evidence.countDocuments();
  const persisted=await Evidence.findOne({creationKey:auditKey}).select('+storageKey').lean();
  expect(await safety.readPrivate(persisted.storageKey)).toEqual(cvBytes);
  expect((await upload(id,'employee',{},auditKey).expect(409)).body.error.code).toBe('OPERATION_RECOVERY_REQUIRED');
  expect(await Evidence.countDocuments()).toBe(count);
});

test('provider-dispatch uncertainty remains closed; holds prevent provider deletion and retention retries delete the same source',async()=>{
  const id=await launch(),key=crypto.randomUUID();
  managed.store.mockRejectedValueOnce(new DomainError(503,'PRIVATE_STORAGE_UNAVAILABLE','Provider response unavailable.'));
  await upload(id,'employee',{},key).expect(503);
  expect((await upload(id,'employee',{},key).expect(409)).body.error.code).toBe('OPERATION_RECOVERY_REQUIRED');
  const cv=(await upload(id).expect(201)).body.data;
  await Evidence.updateOne({_id:cv.id},{$set:{legalHold:true,retention:{expiresAt:new Date(Date.now()-1000)}}});
  const removeCalls=managed.remove.mock.calls.length;
  expect((await call('delete',`/assessments/${id}/evidence/${cv.id}`,'employee').expect(409)).body.error.code).toBe('EVIDENCE_ON_HOLD');
  const retention=require('../services/competency/retentionService');
  expect((await retention.processDue()).evidenceDeleted).toBe(0);expect(managed.remove).toHaveBeenCalledTimes(removeCalls);
  await Evidence.updateOne({_id:cv.id},{$set:{legalHold:false}});
  managed.remove.mockRejectedValueOnce(new DomainError(503,'PRIVATE_DELETION_UNAVAILABLE','Provider temporarily unavailable.'));
  expect((await retention.processDue()).evidenceDeleted).toBe(0);
  expect((await Evidence.findById(cv.id).lean()).status).toBe('deletion_failed');
  expect((await retention.processDue()).evidenceDeleted).toBe(1);
  const deleted=await Evidence.findById(cv.id).select('+storageKey').lean();expect(deleted.status).toBe('deleted');expect(deleted.storageKey).toBeUndefined();expect(deleted.text).toBe('');
  await call('get',`/assessments/${id}/evidence/${cv.id}/source`,'manager').expect(409);
});


test('the no-effect replay proof is server-only and cannot relax other operation types',async()=>{
  const ctx=await auth.context(principal()),key=crypto.randomUUID();let attempts=0;
  const error=auth.confirmEvidenceNoEffect(new DomainError(503,'TEST_PREFLIGHT','Known preflight'));
  await expect(auth.operation(ctx,'assessment.finalise:synthetic',key,{},async()=>{attempts++;throw error;})).rejects.toMatchObject({status:503});
  await expect(auth.operation(ctx,'assessment.finalise:synthetic',key,{},async()=>{attempts++;return {};})).rejects.toMatchObject({code:'OPERATION_RECOVERY_REQUIRED'});
  expect(attempts).toBe(1);
  const untrusted=new DomainError(503,'PROVIDER_RESPONSE_LOST','Unknown provider outcome');untrusted.evidenceNoEffectConfirmed=true;
  const evidenceKey=crypto.randomUUID(),action=`evidence.create:${new mongoose.Types.ObjectId()}`;
  await expect(auth.operation(ctx,action,evidenceKey,{},async()=>{throw untrusted;})).rejects.toMatchObject({status:503});
  await expect(auth.operation(ctx,action,evidenceKey,{},async()=>({}))).rejects.toMatchObject({code:'OPERATION_RECOVERY_REQUIRED'});
});


test('detail exposes current assessor authority to unassigned HR/admin and denies a revoked assessor',async()=>{
  const id=await launch({cvRequested:true});
  for(const actor of ['hr','admin']){
    const detail=(await call('get',`/assessments/${id}`,actor).expect(200)).body.data;
    expect(detail.assessors.map(person=>person.userId)).not.toContain(actor);
    expect(detail.viewerIsAssessor).toBe(true);
    expect(detail.allowedActions).toContain('competency.evidence.delete');
  }
  const participant=(await call('get',`/assessments/${id}`,'employee').expect(200)).body.data;
  expect(participant.viewerIsAssessor).toBe(false);
  // The current resource relation, not the frozen assessor list, controls access.
  const request=principal('manager');request._performanceDirectory.reviewers=[];
  const revoked=await auth.context(request),stored=await Assessment.findById(id).lean();
  const assessments=require('../services/competency/assessmentService');
  expect(stored.assessorIds).toContain('manager');
  expect(assessments.isAssessor(revoked,stored)).toBe(false);
  await expect(assessments.get(revoked,id)).rejects.toMatchObject({status:403,code:'ASSESSMENT_DENIED'});
});
