'use strict';
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const Assessment=require('../../models/CompetencyAssessment');
const Evidence=require('../../models/CompetencyEvidence');
const Oral=require('../../models/CompetencyOralSession');
const Suggestion=require('../../models/CompetencyAISuggestion');
const Appraisal=require('../../models/Appraisal');
const {DomainError,id,hash,cleanObject,requiredText}=require('../../contracts/competency');
const auth=require('./authorizationService');
const scoring=require('./scoringService');
const {retained,effective}=require('./sourcePolicy');
const editable=['draft','in_progress','reopened'];
const plain=value=>value?.toObject?value.toObject():value;
const clone=value=>JSON.parse(JSON.stringify(value));
function validateCvRequested(value) { if(value!==undefined&&typeof value!=='boolean')throw new DomainError(422,'INVALID_CV_REQUEST','Choose whether to request an optional CV.'); return value===true; }
function isAssessor(ctx,assessment) { return auth.isCurrentAssessor(ctx,assessment); }
const parentWriteActions=new Set(['assessment.edit','assessment.finalise','assessment.reopen','assessment.exception','evidence.create','ai.use'].map(value=>`competency.${value}`));
async function annotateParentState(records,session=null) {
  const linked=records.filter(record=>record.appraisalId),ids=[...new Set(linked.map(record=>record.appraisalId).filter(value=>mongoose.isValidObjectId(value)))];
  if(!linked.length)return;
  const parents=ids.length?await Appraisal.find({_id:{$in:ids},organizationId:linked[0].organizationId}).withRemoved().select('_id status removedAt').session(session).lean():[];
  const byId=new Map(parents.map(parent=>[String(parent._id),parent]));
  for(const record of linked){const parent=byId.get(String(record.appraisalId));record.linkedAppraisalReadOnly=!parent||Boolean(parent.removedAt)||parent.status==='cancelled';}
}
async function assertParentEditable(record,session=null) {
  await annotateParentState([record],session);
  if(record.linkedAppraisalReadOnly)throw new DomainError(409,'APPRAISAL_CLOSED','This linked appraisal was cancelled or removed. Its assessment is read-only; previous reports and retention controls remain available.');
}
async function get(ctx,assessmentId,permission='assessment.view',session=null) {
  const record=auth.assertAssessment(ctx,await Assessment.findOne({_id:id(assessmentId),organizationId:ctx.organizationId}).session(session).lean(),permission);
  await annotateParentState([record],session);
  if(parentWriteActions.has(permission.startsWith('competency.')?permission:`competency.${permission}`)&&record.linkedAppraisalReadOnly)await assertParentEditable(record,session);
  return record;
}
function assertEditable(record) { if(record.mutationLock) throw new DomainError(409,'ASSESSMENT_BUSY','Evidence is being updated. Try again shortly.'); if(!editable.includes(record.status)) throw new DomainError(409,'ASSESSMENT_LOCKED','Reopen this assessment before editing its published findings.'); }
async function cas(ctx,record,expected,changes,{status=editable,extra={},session=null,allowClosedParent=false}={}) {
  if(!allowClosedParent)await assertParentEditable(record,session);
  if(record.revision!==expected) throw new DomainError(409,'STALE_REVISION','This assessment changed. Reload it before saving.');
  const updated=await Assessment.findOneAndUpdate({_id:record._id,organizationId:ctx.organizationId,revision:expected,mutationLock:null,status:{$in:status},...extra},{$set:changes,$inc:{revision:1}},{new:true,runValidators:true,session}).lean();
  if(!updated) throw new DomainError(409,'STALE_REVISION','This assessment changed. Reload it before saving.'); return updated;
}
async function launch(ctx,input,key) {
  auth.requireAction(ctx,'assessment.launch'); cleanObject(input,['cycleId','cycleRevision','assignments']); id(input.cycleId);
  if(!Number.isInteger(input.cycleRevision)||!Array.isArray(input.assignments)||!input.assignments.length||input.assignments.length>100) throw new DomainError(422,'INVALID_ASSIGNMENTS','Choose one to 100 participants and a current cycle revision.');
  input={...input,cycleId:String(new mongoose.Types.ObjectId(id(input.cycleId))),assignments:input.assignments.map(assignment=>({...assignment,...(assignment?.appraisalId?{appraisalId:String(new mongoose.Types.ObjectId(id(assignment.appraisalId)))}:{}),...(assignment?.roleVersionId?{roleVersionId:String(new mongoose.Types.ObjectId(id(assignment.roleVersionId)))}:{})}))};
  return auth.operation(ctx,'assessment.launch',key,input,async()=>{
  const identities=new Set();
  // Validate every assignment before persisting any; receipts still describe
  // per-assignment persistence failures without promising multi-doc atomicity.
  const assignments=[];
  for(const assignment of input.assignments) {
    cleanObject(assignment,['participantId','roleVersionId','assessorIds','appraisalId','cvRequested']);
    validateCvRequested(assignment.cvRequested);
    const participant=auth.assertParticipant(ctx,assignment.participantId);
    if(identities.has(assignment.participantId)) throw new DomainError(422,'DUPLICATE_PARTICIPANT','Select each participant once.'); identities.add(assignment.participantId);
    if(!Array.isArray(assignment.assessorIds)||!assignment.assessorIds.length||assignment.assessorIds.length>20||new Set(assignment.assessorIds).size!==assignment.assessorIds.length) throw new DomainError(422,'ASSESSOR_REQUIRED','Select at least one eligible assessor.');
    const assessors=assignment.assessorIds.map(userId=>{ if(userId===participant.userId) throw new DomainError(422,'SELF_ASSESSOR','Choose another eligible person as assessor.');
      const reviewer=ctx.directory.reviewers?.find(value=>value.userId===userId);
      const participantTeams=participant.teamIds||(participant.teams||[]).map(team=>String(team.id||team.teamId));
      const eligible=reviewer&&(reviewer.organizationWide||(reviewer.eligibleTeamIds||[]).some(teamId=>participantTeams.includes(String(teamId))));
      if(!eligible) throw new DomainError(422,'ASSESSOR_NOT_ELIGIBLE','Choose an eligible administrator, HR manager or team leader.'); return {userId:reviewer.userId,name:reviewer.name||'Not recorded'}; });
    if(assignment.appraisalId) { const appraisal=await Appraisal.findOne({_id:id(assignment.appraisalId),organizationId:ctx.organizationId,'employee.userId':participant.userId,removedAt:null}).lean(); if(!appraisal) throw new DomainError(404,'APPRAISAL_NOT_FOUND','This appraisal is unavailable for the selected participant.');if(!ctx.req||!await require('../appraisalAccessService').canManageAppraisal(ctx.req,appraisal))throw new DomainError(403,'APPRAISAL_ACCESS_DENIED','You cannot manage the linked appraisal.');if(['completed','employee_acknowledged','cancelled'].includes(appraisal.status))throw new DomainError(409,'APPRAISAL_CLOSED','Add the assessment role before this appraisal is finalised.');if(assignment.assessorIds.length!==1||assignment.assessorIds[0]!==appraisal.manager.userId)throw new DomainError(422,'REVIEWER_MISMATCH','Use the reviewer selected for this appraisal.'); }
    const definition=await require('./libraryService').getPublishedDefinition({organizationId:ctx.organizationId,cycleId:input.cycleId,cycleRevision:input.cycleRevision,roleVersionId:id(assignment.roleVersionId)});
    assignments.push({assignment,participant,assessors,definition});
  }
    const outcomes=[];
    for(const {assignment,participant,assessors,definition} of assignments) {
      const scope={organizationId:ctx.organizationId,cycleId:input.cycleId,cycleVersion:definition.cycleVersion,occurrenceKey:{$in:['legacy',null]},'participant.userId':participant.userId};
      const existing=await Assessment.findOne(scope).lean();
      if(!existing&&await Assessment.exists({organizationId:ctx.organizationId,cycleId:input.cycleId,cycleVersion:definition.cycleVersion,occurrenceKey:{$nin:['legacy',null]},'participant.userId':participant.userId}))throw new DomainError(409,'USE_UNIFIED_APPRAISALS','This cycle uses appraisal periods. Start the next period from Start appraisals.');
      if(existing) { if(existing.definitionSnapshot.role.versionId!==definition.role.versionId)throw new DomainError(409,'ROLE_ASSIGNMENT_CONFLICT','This participant already has a different frozen role in this cycle. Start a new cycle to assess a different role.'); if((assignment.appraisalId||null)!==(existing.appraisalId||null)) throw new DomainError(409,'LINK_CONFLICT','This person already has an assessment linked to a different appraisal.'); outcomes.push({assessmentId:String(existing._id),participantId:participant.userId,status:'existing',cvRequested:existing.definitionSnapshot.cvRequested===true}); continue; }
      try {
        const payload={organizationId:ctx.organizationId,cycleId:input.cycleId,cycleVersion:definition.cycleVersion,cycleRevision:input.cycleRevision,appraisalId:assignment.appraisalId||null,participant:{userId:participant.userId,name:participant.name||'Not recorded',departmentId:participant.departmentId||null,teamIds:participant.teamIds||(participant.teams||[]).map(team=>String(team.id||team.teamId))},assessors,assessorIds:assessors.map(person=>person.userId),definitionSnapshot:{...clone(definition),cvRequested:validateCvRequested(assignment.cvRequested)},items:definition.criteria.map(criterion=>({criterionId:criterion.id,status:'not_started',rationale:'',evidenceIds:[],reviewedSuggestionIds:[]})),managerFeedback:[],createdBy:ctx.actor,results:[]};
        let record;if(assignment.appraisalId){const session=await Assessment.db.startSession();try{await session.withTransaction(async()=>{const parent=await Appraisal.findOne({_id:assignment.appraisalId,organizationId:ctx.organizationId,'employee.userId':participant.userId,removedAt:null}).session(session).lean();if(!parent)throw new DomainError(404,'APPRAISAL_NOT_FOUND','The linked appraisal is unavailable.');if(['completed','employee_acknowledged','cancelled'].includes(parent.status))throw new DomainError(409,'APPRAISAL_CLOSED','This appraisal was finalised before its role could be linked.');if(assignment.assessorIds.length!==1||assignment.assessorIds[0]!==parent.manager.userId)throw new DomainError(422,'REVIEWER_MISMATCH','Use the reviewer currently selected for this appraisal.');await Appraisal.updateOne({_id:parent._id,organizationId:ctx.organizationId},{$inc:{__v:1}},{session});record=(await Assessment.create([payload],{session}))[0];});}catch(error){if(error.code===20||/replica set|mongos/i.test(error.message))throw new DomainError(503,'LINK_REQUIRES_TRANSACTION','Linking an appraisal requires transactional database support. The original appraisal is unchanged.');throw error;}finally{await session.endSession();}}else record=await Assessment.create(payload);
        await auth.audit(ctx,'assessment.launched','assessment',record._id,{afterHash:definition.definitionHash}); outcomes.push({assessmentId:String(record._id),participantId:participant.userId,status:'created',cvRequested:record.definitionSnapshot.cvRequested===true});
      } catch(error) { if(error.code===11000) { const duplicate=await Assessment.findOne(scope).lean();if(!duplicate||(duplicate.appraisalId||null)!==(assignment.appraisalId||null))throw new DomainError(409,'LINK_CONFLICT','This appraisal is already linked to a different competency assessment.');if(duplicate.definitionSnapshot.role.versionId!==definition.role.versionId)throw new DomainError(409,'ROLE_ASSIGNMENT_CONFLICT','This participant already has a different role in this cycle.'); outcomes.push({assessmentId:String(duplicate._id),participantId:participant.userId,status:'existing',cvRequested:duplicate.definitionSnapshot.cvRequested===true}); } else throw error; }
    }
    return {outcomes,created:outcomes.filter(item=>item.status==='created').length,existing:outcomes.filter(item=>item.status==='existing').length};
  });
}
async function list(ctx,filters={}) {
  auth.requireAction(ctx,'assessment.view');
  const query={organizationId:ctx.organizationId};
  if(!ctx.organizationWide)query.$or=[{'participant.userId':{$in:ctx.directory.members.map(person=>person.userId)}},{assessorIds:ctx.actor.userId}];
  if(filters.cycleId) query.cycleId=id(filters.cycleId);
  if(filters.status) { if(!['draft','in_progress','finalised','published','reopened'].includes(filters.status)) throw new DomainError(422,'INVALID_STATUS','Choose a valid assessment status.'); query.status=filters.status; }
  if(filters.participantId) query['participant.userId']=auth.assertParticipant(ctx,filters.participantId).userId;
  const records=await Assessment.find(query).sort({createdAt:-1,_id:-1}).limit(500).lean();
  await annotateParentState(records);
  return records.filter(record=>auth.canAccessAssessment(ctx,record)).map(record=>({id:String(record._id),revision:record.revision,status:record.status,cycleId:record.cycleId,cycleVersion:record.cycleVersion,participant:record.participant,assessors:record.assessors,cvRequested:record.definitionSnapshot.cvRequested===true,role:{name:record.definitionSnapshot.role.name,version:record.definitionSnapshot.role.version,versionId:record.definitionSnapshot.role.versionId},selectedInputTypes:record.definitionSnapshot.selectedInputTypes,createdAt:record.createdAt,updatedAt:record.updatedAt,appraisalId:record.appraisalId,linkedAppraisalReadOnly:Boolean(record.linkedAppraisalReadOnly),currentResultNumber:record.currentResultNumber||null,allowedActions:actions(ctx,record)}));
}
function actions(ctx,record) { return auth.ACTIONS.filter(action=>(!record.linkedAppraisalReadOnly||!parentWriteActions.has(action))&&auth.canAccessAssessment(ctx,record,action)); }
function visible(ctx,record,source) { return source.visibility==='participant'||isAssessor(ctx,record); }
function evidenceDTO(source,{includeText=true}={}) { const value=effective(plain(source)); return {id:String(value._id),title:value.title,kind:value.kind,documentType:value.documentType||'supporting_evidence',criterionIds:value.criterionIds,visibility:value.visibility,status:value.status,...(includeText&&value.status==='ready'?{text:value.text,spans:value.spans}:{}),sha256:value.sha256,originalName:value.originalName,mimeType:value.mimeType,size:value.size,source:value.source,createdBy:value.createdBy,createdAt:value.createdAt,revision:value.revision,retention:value.retention,legalHold:value.legalHold,deletedAt:value.deletedAt}; }
async function sourceFeedback(record,session=null) {
  if(!record.appraisalId) return {state:'not_linked',sourceHash:hash({state:'not_linked'}),entries:[],submittedAt:null,author:null};
  const appraisal=await Appraisal.findOne({_id:record.appraisalId,organizationId:record.organizationId,'employee.userId':record.participant.userId,removedAt:null}).session(session).lean();
  if(!appraisal||appraisal.status==='cancelled') return {state:'unavailable',sourceHash:hash({state:'unavailable'}),entries:[]};
  const flow=appraisal.cycleConfigurationSnapshot?.appraisalFlow;
  const enabled=flow?flow.steps?.some(step=>step.type==='managerReview'):appraisal.cycleConfigurationSnapshot?.workflowDefinition?.stages?.managerReview?.enabled!==false;
  if(!enabled) return {state:'not_configured',label:'Reviewer step not configured',sourceHash:hash({state:'not_configured'}),entries:[]};
  if(!appraisal.managerReview?.submittedAt) return {state:'awaiting_submission',sourceHash:hash({state:'awaiting_submission'}),entries:[],appraisalId:record.appraisalId};
  // Attribution comes from a recorded submission event, not the current manager.
  const audit=(appraisal.auditLog||[]).filter(event=>['manager_review_submitted','review_submitted'].includes(event.action)).at(-1);
  const actor=audit?.performedBy?.userId?{userId:audit.performedBy.userId,name:audit.performedBy.name||'Not recorded'}:null;
  const review=clone(appraisal.managerReview),submittedAt=review.submittedAt;
  const entries=[]; const add=(section,key,text,extra={})=>{if(text!==undefined&&text!==null&&String(text).trim()) entries.push({id:`appraisal:${key}`,section,text:String(text),submitted:true,author:actor,submittedAt,...extra});};
  for(const [key,value] of Object.entries(review.overallSummary||{})) add(key==='recommendations'?'recommendation':'overall',key,value);
  add('overall','overallManagerRating',review.overallManagerRating,{rating:review.overallManagerRating});
  for(const [index,value] of (review.competencyRatings||[]).entries()) add('competency',`competency:${index}`,value.managerComments||'No comment recorded',{criterionId:value.competencyId,criterionName:value.competencyName,rating:value.managerRating});
  for(const [index,value] of (review.okrAssessment||[]).entries()) add('goal',`goal:${index}`,value.managerComments||'No comment recorded',{goalId:value.okrId,goalTitle:value.okrTitle,rating:value.qualityRating,verifiedCompletion:value.managerVerifiedCompletion});
  const sections=appraisal.cycleConfigurationSnapshot?.workflowDefinition?.sections||[];
  const responses=(appraisal.customResponses||[]).filter(value=>value.respondentRole==='manager'&&value.submittedAt).map(value=>{const section=sections.find(section=>section.id===value.sectionId),question=section?.questions?.find(question=>question.id===value.questionId);return{sectionId:value.sectionId,questionId:value.questionId,sectionTitle:section?.title||'Not recorded',questionPrompt:question?.prompt||'Not recorded',title:question?.prompt||'Custom question not recorded',responseType:question?.responseType||'Not recorded',value:value.value,respondentId:value.respondentId,submittedAt:value.submittedAt,score:value.score};});
  for(const response of responses) entries.push({id:`appraisal:custom:${response.sectionId}:${response.questionId}`,section:'custom',sectionId:response.sectionId,questionId:response.questionId,sectionTitle:response.sectionTitle,questionPrompt:response.questionPrompt,title:response.title,responseType:response.responseType,text:typeof response.value==='string'?response.value:JSON.stringify(response.value),...(response.score!==undefined?{rating:response.score}:{}),submitted:true,author:response.respondentId?{userId:response.respondentId,name:actor?.userId===response.respondentId?actor.name:'Not recorded'}:null,submittedAt:response.submittedAt});
  return {state:'submitted',sourceHash:hash({review,responses,actor,submittedAt}),entries,submittedAt,author:actor,overallManagerRating:review.overallManagerRating??null,appraisalId:record.appraisalId};
}
async function completion(ctx,record,exceptions=[],session=null) {
  const blockers=[]; const definitions=record.definitionSnapshot.criteria;
  const evidence=(await Evidence.find({organizationId:ctx.organizationId,assessmentId:String(record._id),status:'ready'}).session(session).lean()).filter(source=>retained(source));
  const exceptionMap=new Map();
  for(const exception of exceptions) { cleanObject(exception,['criterionId','reason']); if(!definitions.some(item=>item.id===exception.criterionId)||exceptionMap.has(exception.criterionId)) throw new DomainError(422,'INVALID_EXCEPTION','Choose a criterion once for each exception.'); auth.requireAction(ctx,'assessment.exception'); exceptionMap.set(exception.criterionId,requiredText(exception.reason,'exception reason',2000)); }
  for(const criterion of definitions) {
    const finding=record.items.find(item=>item.criterionId===criterion.id);
    const add=(code,message)=>{if(!exceptionMap.has(criterion.id)) blockers.push({criterionId:criterion.id,code,message});};
    if(criterion.required && finding?.status!=='assessed') add('FINDING_REQUIRED',`Assess ${criterion.name} or record an authorised exception.`);
    if(finding?.status==='assessed') {
      scoring.evaluateFinding(record.definitionSnapshot,criterion,finding);
      if(criterion.rationaleRequired&&!finding.rationale?.trim()) add('RATIONALE_REQUIRED',`Explain the finding for ${criterion.name}.`);
      if(criterion.evidenceRequired&&!finding.evidenceIds?.some(evidenceId=>evidence.some(source=>String(source._id)===evidenceId&&source.criterionIds.includes(criterion.id)))) add('EVIDENCE_REQUIRED',`Link retained evidence to ${criterion.name}.`);
    }
  }
  const feedback=await sourceFeedback(record,session);
  const oralSources=await Oral.find({organizationId:ctx.organizationId,assessmentId:String(record._id),callType:{$in:['native','nylas']}}).session(session).lean();
  for(const oral of oralSources)try{if(oral.source?.status==='expired'||new Date(oral.source?.retention?.expiresAt)<=new Date())throw new Error('Expired source');await require('./oralService').callSource(ctx,record,oral.callType,oral.callId,oral.consent);}catch{blockers.push({code:'ORAL_SOURCE_UNAVAILABLE',sessionId:String(oral._id),message:'A linked call is no longer authorised or retained. Remove the call link and keep manual notes, or restore participant consent.'});}
  if(['awaiting_submission','unavailable'].includes(feedback.state)) blockers.push({code:'MANAGER_FEEDBACK_REQUIRED',message:feedback.state==='unavailable'?'Restore access to the linked appraisal before finalising.':'Submit the linked reviewer assessment before finalising.',appraisalId:record.appraisalId});
  return {ready:blockers.length===0,blockers,exceptions:[...exceptionMap].map(([criterionId,reason])=>({criterionId,reason,author:ctx.actor,recordedAt:new Date().toISOString()})),sourceFeedback:feedback};
}
async function detail(ctx,record) {
  const assessor=isAssessor(ctx,record), canEvidence=auth.canAccessAssessment(ctx,record,'evidence.view'), evidenceRows=canEvidence?(await Evidence.find({organizationId:ctx.organizationId,assessmentId:String(record._id)}).sort({createdAt:-1}).lean()).filter(source=>visible(ctx,record,source)&&(assessor||source.createdBy?.userId===ctx.actor.userId||record.status==='published'||(source.documentType==='cv'&&record.participant.userId===ctx.actor.userId))):[];
  const evidence=await Promise.all(evidenceRows.map(source=>require('./callEvidencePolicy').current(ctx,record,source)));
  const oral=assessor?(await Oral.find({organizationId:ctx.organizationId,assessmentId:String(record._id)}).sort({createdAt:-1}).lean()).filter(source=>visible(ctx,record,source)):[];
  for(const source of oral)if(source.callType!=='manual')try{await require('./callEvidencePolicy').assertCurrent(ctx,record,{source:{oralSessionId:String(source._id)}});}catch{source.prompts=[];source.versions=[];source.sourceUnavailable=true;}
  const suggestions=assessor&&canEvidence?await Suggestion.find({organizationId:ctx.organizationId,assessmentId:String(record._id)}).sort({createdAt:-1}).lean():[];
  const result=record.results?.find(value=>value.number===record.currentResultNumber);
  const value={id:String(record._id),viewerIsAssessor:assessor,revision:record.revision,status:record.status,cycleId:record.cycleId,cycleVersion:record.cycleVersion,appraisalId:record.appraisalId,linkedAppraisalReadOnly:Boolean(record.linkedAppraisalReadOnly),participant:record.participant,assessors:record.assessors,cvRequested:record.definitionSnapshot.cvRequested===true,definitionSnapshot:record.definitionSnapshot,items:assessor?record.items.map(item=>({...item,evidenceIds:(item.evidenceIds||[]).filter(evidenceId=>evidence.some(source=>String(source._id)===evidenceId))})):[],managerFeedback:assessor?record.managerFeedback:[],allowedActions:actions(ctx,record),createdBy:record.createdBy,createdAt:record.createdAt,updatedAt:record.updatedAt,evidence:evidence.map(source=>evidenceDTO(source)),oralSessions:oral.map(source=>({...source,source:require('./oralService').safeSource(source.source),id:String(source._id),_id:undefined,organizationId:undefined,versions:assessor?source.versions:undefined})),aiSuggestions:suggestions.filter(suggestion=>(suggestion.evidenceHashes||[]).every(reference=>evidence.some(source=>String(source._id)===reference.id&&source.status==='ready'&&retained(source)))).map(source=>({...source,id:String(source._id),_id:undefined,organizationId:undefined})),resultVersions:(record.results||[]).map(source=>({number:source.number,status:source.number===record.currentResultNumber&&record.status==='published'?'current':'superseded',finalisedAt:source.finalClassification.finalisedAt,reportHash:source.reportHash})),...(result&&auth.canAccessAssessment(ctx,record,'report.view')?{result:require('./reportService').buildReportDTO({assessment:record,resultVersion:result.number,viewer:ctx})}:{})};
  if(assessor) {value.completion=await completion(ctx,record); value.sourceFeedback=value.completion.sourceFeedback; if(result) value.sourceFeedbackChanged=result.managerSource.sourceHash!==value.sourceFeedback.sourceHash;}
  return value;
}
async function patch(ctx,assessmentId,input,expected) {
  const record=await get(ctx,assessmentId,'assessment.edit'); assertEditable(record); cleanObject(input,['items','managerFeedback']); const updates={status:'in_progress'};
  if(input.items!==undefined) {
    if(!Array.isArray(input.items)||input.items.length>1000||new Set(input.items.map(item=>item.criterionId)).size!==input.items.length) throw new DomainError(422,'INVALID_FINDINGS','Save each criterion once.');
    const evidence=(await Evidence.find({organizationId:ctx.organizationId,assessmentId:String(record._id),status:'ready'}).lean()).filter(source=>retained(source));
    const items=clone(record.items);
    for(const finding of input.items) {
      cleanObject(finding,['criterionId','status','observedLevelId','rating','rationale','evidenceIds','reviewedSuggestionIds']);
      const criterion=record.definitionSnapshot.criteria.find(value=>value.id===finding.criterionId);
      if(!criterion||!['not_started','assessed','insufficient_evidence'].includes(finding.status)||typeof finding.rationale!=='string'||finding.rationale.length>10000||!Array.isArray(finding.evidenceIds)||finding.evidenceIds.length>100) throw new DomainError(422,'INVALID_FINDING','Select a valid criterion, status, evidence and rationale.');
      if(finding.evidenceIds.some(evidenceId=>!evidence.some(source=>String(source._id)===evidenceId&&source.criterionIds.includes(criterion.id)&&visible(ctx,record,source)))) throw new DomainError(404,'EVIDENCE_NOT_FOUND','Some selected evidence is unavailable for this criterion.');
      for(const evidenceId of finding.evidenceIds)await require('./callEvidencePolicy').assertCurrent(ctx,record,evidence.find(source=>String(source._id)===evidenceId));
      if(finding.status==='assessed') scoring.evaluateFinding(record.definitionSnapshot,criterion,finding);
      const reviewed=finding.reviewedSuggestionIds||[];
      if(!Array.isArray(reviewed)||reviewed.length>100) throw new DomainError(422,'INVALID_SUGGESTIONS','Select valid reviewed suggestions.');
      if(reviewed.length && await Suggestion.countDocuments({_id:{$in:reviewed.map(id)},organizationId:ctx.organizationId,assessmentId:String(record._id),status:{$in:['accepted','edited']}})!==new Set(reviewed).size) throw new DomainError(422,'SUGGESTION_NOT_REVIEWED','Review each selected AI suggestion before linking it.');
      const cleaned={...finding,reviewedSuggestionIds:reviewed,assessedBy:ctx.actor,assessedAt:new Date().toISOString()};if(finding.status!=='assessed'){delete cleaned.rating;delete cleaned.observedLevelId;}
      items[items.findIndex(value=>value.criterionId===finding.criterionId)]=cleaned;
    }
    updates.items=items;
  }
  if(input.managerFeedback!==undefined) {
    if(!Array.isArray(input.managerFeedback)||input.managerFeedback.length>200||new Set(input.managerFeedback.filter(value=>value.id).map(value=>value.id)).size!==input.managerFeedback.filter(value=>value.id).length) throw new DomainError(422,'INVALID_FEEDBACK','Provide each feedback entry once.');
    updates.managerFeedback=input.managerFeedback.map(entry=>{cleanObject(entry,['id','section','criterionId','goalId','text','submitted']);if(!['overall','competency','goal','custom','recommendation'].includes(entry.section)||typeof entry.submitted!=='boolean') throw new DomainError(422,'INVALID_FEEDBACK','Choose a valid feedback section and submission state.'); if(entry.criterionId&&!record.definitionSnapshot.criteria.some(criterion=>criterion.id===entry.criterionId)) throw new DomainError(422,'INVALID_CRITERION','Select a criterion from this assessment.'); const prior=record.managerFeedback.find(value=>value.id===entry.id);const content={id:entry.id||crypto.randomUUID(),section:entry.section,criterionId:entry.criterionId||null,goalId:entry.goalId||null,text:requiredText(entry.text,'feedback',10000),submitted:entry.submitted};if(prior){const previous=Object.fromEntries(Object.keys(content).map(key=>[key,prior[key]??null]));if(hash(previous)===hash(content))return clone(prior);if(prior.author?.userId!==ctx.actor.userId)throw new DomainError(403,'FEEDBACK_AUTHOR_REQUIRED','Only the recorded author can edit this feedback.');} return {...content,author:ctx.actor,...(entry.submitted?{submittedAt:new Date().toISOString()}:{})};});
    if(record.managerFeedback.some(entry=>entry.author?.userId!==ctx.actor.userId&&!updates.managerFeedback.some(value=>value.id===entry.id))) throw new DomainError(403,'FEEDBACK_AUTHOR_REQUIRED','Keep feedback recorded by other assessors.');
  }
  const updated=await cas(ctx,record,expected,updates); await auth.audit(ctx,'assessment.saved','assessment',record._id,{revision:updated.revision}); return detail(ctx,updated);
}
async function calculate(ctx,assessmentId,exceptions=[]) { const record=await get(ctx,assessmentId,'assessment.edit'); const checks=await completion(ctx,record,exceptions); const blockedIds=new Set(checks.blockers.filter(blocker=>blocker.code==='EVIDENCE_REQUIRED').map(blocker=>blocker.criterionId));const items=record.items.map(item=>blockedIds.has(item.criterionId)?{...item,status:'insufficient_evidence'}:item);return {...scoring.calculate(record.definitionSnapshot,items,checks.exceptions),completion:checks}; }
async function finalise(ctx,assessmentId,input,expected,key) {
  const record=await get(ctx,assessmentId,'assessment.finalise'); cleanObject(input,['classificationId','reason','exceptions']);
  const receipt=await auth.operation(ctx,`assessment.finalise:${assessmentId}`,key,{...input,revision:expected},async()=>{
    const publish=async(session=null)=>{
    const current=await get(ctx,assessmentId,'assessment.finalise',session); assertEditable(current); if(current.revision!==expected) throw new DomainError(409,'STALE_REVISION','Reload the changed assessment before finalising.');
    const checks=await completion(ctx,current,input.exceptions||[],session); if(!checks.ready) throw new DomainError(422,'ASSESSMENT_INCOMPLETE','Complete the assessment before finalising.',checks.blockers.map(blocker=>({path:blocker.criterionId||'managerFeedback',code:blocker.code,message:blocker.message})));
    // A transactional write on the linked source document makes simultaneous
    // reviewer amendments conflict rather than freezing a stale source read.
    if(session&&current.appraisalId)await Appraisal.updateOne({_id:current.appraisalId,organizationId:ctx.organizationId},{$inc:{__v:1}},{session});
    const calculation=scoring.calculate(current.definitionSnapshot,current.items,checks.exceptions), classification=current.definitionSnapshot.scoringConfig.thresholds.find(value=>value.id===input.classificationId);
    if(!classification) throw new DomainError(422,'CLASSIFICATION_REQUIRED','Choose the final human classification.');
    const reason=input.reason?requiredText(input.reason,'classification reason',2000):'';
    if(calculation.suggestedOutcome?.id!==classification.id&&!reason) throw new DomainError(422,'OVERRIDE_REASON_REQUIRED','Explain why the final classification differs from the calculated suggestion.');
    const evidence=(await Evidence.find({organizationId:ctx.organizationId,assessmentId:String(current._id),status:'ready'}).session(session).lean()).filter(source=>retained(source));
    const oral=await Oral.find({organizationId:ctx.organizationId,assessmentId:String(current._id),status:'submitted',sourceWithdrawnAt:null}).session(session).lean();
    const number=(current.results||[]).length+1, now=new Date().toISOString();
    const result={id:crypto.randomUUID(),number,status:'current',definitionHash:current.definitionSnapshot.definitionHash,...calculation,finalClassification:{id:classification.id,label:classification.label,reason,finalisedBy:ctx.actor,finalisedAt:now},exceptions:checks.exceptions,ranking:null,findings:clone(current.items),managerFeedback:clone(current.managerFeedback.filter(value=>value.submitted)),managerSource:checks.sourceFeedback,evidenceReferences:evidence.map(source=>({id:String(source._id),title:source.title,kind:source.kind,documentType:source.documentType||'supporting_evidence',originalName:source.originalName,mimeType:source.mimeType,size:source.size,criterionIds:source.criterionIds,visibility:source.visibility,sha256:source.sha256,createdBy:source.createdBy,createdAt:source.createdAt,source:source.source})),oralFindings:oral.map(source=>({id:String(source._id),title:source.title,prompts:source.prompts,visibility:source.visibility,callType:source.callType,callId:source.callId||null,source:require('./oralService').safeSource(source.source),createdBy:source.createdBy,createdAt:source.createdAt,occurredAt:source.occurredAt,timeZone:source.timeZone,participants:source.participants,status:source.status,submittedAt:source.submittedAt,revision:source.revision,updatedBy:source.updatedBy,submittedBy:source.updatedBy})),dates:{createdAt:current.createdAt,finalisedAt:now},reportVersion:1};
    result.ranking=await require('./reportService').rankingAtFinalise(ctx,current,result);
    result.reportHash=hash({...result,status:undefined});
    const updated=await cas(ctx,current,expected,{status:'published',currentResultNumber:number,results:[...(current.results||[]),result]},{session});
    if(session)await require('../../models/CompetencyAuditEvent').create([{organizationId:ctx.organizationId,actor:ctx.actor,action:'assessment.published',resourceType:'assessment',resourceId:assessmentId,details:{revision:updated.revision,resultVersion:number,afterHash:result.reportHash}}],{session});
    return {id:String(current._id),revision:updated.revision,status:'published',result:{number,reportHash:result.reportHash}};
    };
    let result;
    if(record.appraisalId){const session=await Assessment.db.startSession();try{await session.withTransaction(async()=>{result=await publish(session);});}catch(error){if(error.code===20||/replica set|mongos/i.test(error.message))throw new DomainError(503,'FINALISATION_REQUIRES_TRANSACTION','Linked appraisal publication requires transactional database support. Your draft is saved.');throw error;}finally{await session.endSession();}}
    else result=await publish();
    if(!record.appraisalId)try{await auth.audit(ctx,'assessment.published','assessment',assessmentId,{revision:result.revision,resultVersion:result.result.number,afterHash:result.result.reportHash});}catch{console.error('[competency] Secondary publication audit unavailable; embedded publication provenance retained.');}
    return result;
  });
  const current=await get(ctx,assessmentId,'assessment.finalise');return auth.canAccessAssessment(ctx,current,'report.view')?{...receipt,result:require('./reportService').buildReportDTO({assessment:current,resultVersion:receipt.result.number,viewer:ctx})}:receipt;
}
async function reopen(ctx,assessmentId,input,expected,key) { await get(ctx,assessmentId,'assessment.reopen'); cleanObject(input,['reason']); const reason=requiredText(input.reason,'reopen reason',2000); return auth.operation(ctx,`assessment.reopen:${assessmentId}`,key,{...input,revision:expected},async()=>{ const current=await get(ctx,assessmentId,'assessment.reopen'); if(!['published','finalised'].includes(current.status)) throw new DomainError(409,'NOT_PUBLISHED','Only a published assessment can be reopened.'); const updated=await cas(ctx,current,expected,{status:'reopened',reopenHistory:[...(current.reopenHistory||[]),{actor:ctx.actor,reason,at:new Date().toISOString(),previousResultNumber:current.currentResultNumber}]},{status:['published','finalised']}); await auth.audit(ctx,'assessment.reopened','assessment',current._id,{reason,revision:updated.revision,resultVersion:current.currentResultNumber}); return {id:String(updated._id),revision:updated.revision,status:'reopened',previousResultNumber:current.currentResultNumber}; }); }
async function withMutation(ctx,record,work,{allowPublished=false}={}) { if(!allowPublished) assertEditable(record); const token=crypto.randomUUID(),scope={_id:record._id,organizationId:ctx.organizationId,mutationLock:token}; await cas(ctx,record,record.revision,{mutationLock:token,mutationLeaseUntil:new Date(Date.now()+300000)},{status:allowPublished?['draft','in_progress','reopened','published','finalised']:editable,allowClosedParent:allowPublished});const heartbeat=setInterval(()=>{void Assessment.updateOne(scope,{$set:{mutationLeaseUntil:new Date(Date.now()+300000)}}).catch(()=>{});},15000);heartbeat.unref();const ensureLease=async()=>{if(!allowPublished)await assertParentEditable(record);if(!await Assessment.exists({...scope,mutationLeaseUntil:{$gt:new Date()}}))throw new DomainError(409,'MUTATION_LEASE_LOST','This evidence update was superseded. Reload before retrying.');};try{return await work(ensureLease);} finally{clearInterval(heartbeat);await Assessment.updateOne(scope,{$set:{mutationLock:null},$unset:{mutationLeaseUntil:1},$inc:{revision:1}});} }
module.exports={validateCvRequested,get,launch,list,detail,patch,calculate,completion,finalise,reopen,sourceFeedback,assertEditable,cas,visible,evidenceDTO,isAssessor,actions,plain,clone,withMutation};
