'use strict';

const mongoose=require('mongoose');

const PDFDocument=require('pdfkit');

const Assessment=require('../../models/CompetencyAssessment');

const auth=require('./authorizationService');

const scoring=require('./scoringService');

const files=require('./fileSafetyService');

const {DomainError,id,hash,cleanObject}=require('../../contracts/competency');

const clone=value=>JSON.parse(JSON.stringify(value));

const exportSchema=new mongoose.Schema({organizationId:String,kind:{type:String,enum:['participant','cohort'],default:'participant'},assessmentId:String,cycleId:String,filters:mongoose.Schema.Types.Mixed,reportSnapshot:mongoose.Schema.Types.Mixed,actorId:String,resultVersion:Number,visibilityHash:String,status:{type:String,enum:['pending','running','ready','failed','expired'],default:'pending'},attempts:{type:Number,default:0},leaseUntil:Date,errorCode:String,storageKey:{type:String,select:false},sha256:String,expiresAt:Date,deletedAt:Date},{timestamps:true});

// Bytes must be deleted before the tombstone; a metadata TTL would orphan files.

exportSchema.index({expiresAt:1,status:1});

const Export=mongoose.models.CompetencyExport||mongoose.model('CompetencyExport',exportSchema);

function buildReportDTO({assessment,resultVersion,viewer}) {

  auth.assertAssessment(viewer,assessment,'report.view');

  const number=resultVersion===undefined?assessment.currentResultNumber:Number(resultVersion);

  const result=assessment.results?.find(value=>value.number===number);

  if(!result)throw new DomainError(404,'REPORT_NOT_FOUND','There is no published result for this version.');

  const privileged=require('./assessmentService').isAssessor(viewer,assessment);

  const sourceDefinitions=[...(assessment.definitionSnapshot.frameworks||[]),...(assessment.definitionSnapshot.strategies||[]).map(value=>({...value,sourceType:'strategy'}))].map(value=>({id:value.id||value.versionId,sourceType:value.sourceType,name:value.name||value.title,version:value.version,description:value.description||'',provenance:value.source||value.licenseProvenance||''}));

  const reportCriteria=assessment.definitionSnapshot.criteria.map(criterion=>{const measure=assessment.definitionSnapshot.scoringConfig.normalization.find(value=>value.sourceVersionId===criterion.sourceVersionId&&value.criterionId===(criterion.nativeCriterionId||criterion.criterionId));return{...clone(criterion),sourceVersion:sourceDefinitions.find(source=>String(source.id)===String(criterion.sourceVersionId))?.version||null,ratingScale:measure?.method==='rating_scale'?clone(assessment.definitionSnapshot.scoringConfig.ratingScales.find(scale=>scale.id===measure.ratingScaleId)||null):null};});

  const evidence=auth.canAccessAssessment(viewer,assessment,'evidence.view')?result.evidenceReferences.filter(value=>value.visibility==='participant'||privileged):[];

  const ids=new Set(evidence.map(value=>value.id));

  const findings=result.findings.map(value=>{const criterion=reportCriteria.find(item=>item.id===value.criterionId);return {...clone(value),evidenceIds:(value.evidenceIds||[]).filter(evidenceId=>ids.has(evidenceId)),criterion:clone(criterion),name:criterion.name,sourceType:criterion.sourceType,sourceName:criterion.sourceName,sourceVersion:criterion.sourceVersion,expectedLevel:criterion.expectedLevel,observedLevel:value.status==='assessed'?criterion.levels?.find(level=>level.id===value.observedLevelId)||null:null,calculation:result.score.criterionScores.find(item=>item.criterionId===value.criterionId)};});

  const {evidenceReferences,oralFindings,findings:_findings,managerFeedback,managerSource,...base}=clone(result);

  const dto={...base,status:number===assessment.currentResultNumber&&assessment.status==='published'?'current':'superseded',assessmentId:String(assessment._id),appraisalId:assessment.appraisalId,participant:clone(assessment.participant),assessors:clone(assessment.assessors),role:clone(assessment.definitionSnapshot.role),selectedSources:clone(assessment.definitionSnapshot.selectedInputTypes),sourceDefinitions,criteria:reportCriteria,findings,evidenceReferences:clone(evidence),managerFeedback:[...managerFeedback,...(managerSource.entries||[])],managerSource:{state:managerSource.state,label:managerSource.label||null,sourceHash:managerSource.sourceHash,submittedAt:managerSource.submittedAt||null,author:managerSource.author||null,overallManagerRating:managerSource.overallManagerRating??null},oralFindings:clone(oralFindings.filter(value=>value.visibility==='participant'||privileged).map(value=>({...value,source:require('./oralService').safeSource(value.source)}))),visibilityScope:privileged?'assessors':'participant',reportVersion:1};

  // Every report view has a hash of its exact filtered DTO, alongside the immutable

  // full result hash. No raw source/media URL appears in either report surface.

  dto.visibilityHash=hash({...dto,status:undefined});

  return dto;

}

async function get(ctx,assessmentId,resultVersion) {const assessment=await require('./assessmentService').get(ctx,assessmentId,'report.view');const dto=buildReportDTO({assessment,resultVersion,viewer:ctx});const sources=await require('../../models/CompetencyEvidence').find({organizationId:ctx.organizationId,assessmentId,_id:{$in:dto.evidenceReferences.map(value=>value.id)}}).select('status sha256 retention').lean();dto.sourceAvailability=dto.evidenceReferences.map(source=>({id:source.id,status:(()=>{const live=sources.find(value=>String(value._id)===source.id);if(!live)return'unavailable';if(live.status==='ready'&&!require('./sourcePolicy').retained(live))return'expired';if(live.status==='ready'&&live.sha256!==source.sha256)return'changed';return live.status;})()}));if(require('./assessmentService').isAssessor(ctx,assessment)){const feedback=await require('./assessmentService').sourceFeedback(assessment);dto.sourceFeedbackChanged=dto.managerSource.sourceHash!==feedback.sourceHash;}await auth.audit(ctx,'report.viewed','assessment',assessmentId,{resultVersion:dto.number});return dto;}

async function rankingAtFinalise(ctx,assessment,result) {

  const config=assessment.definitionSnapshot.rankingConfig;if(!config.enabled)return null;

  const records=await Assessment.find({organizationId:ctx.organizationId,cycleId:assessment.cycleId,status:'published'}).lean();

  const compatible=[];

  for(const record of records){if(String(record._id)===String(assessment._id)||!auth.canAccessAssessment(ctx,record,'report.cohort'))continue;const prior=record.results?.find(value=>value.number===record.currentResultNumber);if(!prior||prior.compatibilityKey!==result.compatibilityKey)continue;if(config.scope==='department'&&record.participant.departmentId!==assessment.participant.departmentId)continue;if(config.scope==='role'&&record.definitionSnapshot.role.roleId!==assessment.definitionSnapshot.role.roleId)continue;compatible.push({...prior,assessmentId:String(record._id)});}

  compatible.push({...result,assessmentId:String(assessment._id)});const ranked=scoring.rankResults(compatible,config),value=ranked.find(item=>item.assessmentId===String(assessment._id));

  return value?{rank:value.rank,tieRule:config.tieRule,precision:config.decimalPlaces,scope:config.scope,cohortTimestamp:new Date().toISOString(),compatibilityKey:result.compatibilityKey,cohortSize:ranked.length}:null;

}

async function cohort(ctx,cycleId,filters={}) {

  auth.requireAction(ctx,'report.cohort');

  if(!await require('../../models/CompetencyCycle').exists({_id:id(cycleId),organizationId:ctx.organizationId}))throw new DomainError(404,'CYCLE_NOT_FOUND','This assessment cycle is unavailable.');

  const query={organizationId:ctx.organizationId,cycleId:id(cycleId)};

  if(!ctx.organizationWide)query.$or=[{'participant.userId':{$in:ctx.directory.members.map(person=>person.userId)}},{assessorIds:ctx.actor.userId}];

  const candidates=await Assessment.find(query).sort({createdAt:-1}).limit(2000).lean();
  const scanCapped=candidates.length===2000;
  const records=candidates.filter(record=>auth.canAccessAssessment(ctx,record,'report.cohort'));

  // Resolve filters only after authorization: counts/filter suggestions cannot

  // reveal teams, participants or role names outside the caller's scope.

  const filtered=records.filter(record=>(!filters.departmentId||record.participant.departmentId===filters.departmentId)&&(!filters.teamId||record.participant.teamIds.includes(filters.teamId))&&(!filters.roleVersionId||record.definitionSnapshot.role.versionId===filters.roleVersionId)&&(!filters.status||record.status===filters.status));

  const readiness=new Map();for(const record of filtered){let state;if(['published','finalised'].includes(record.status))state='finalised';else if(record.status==='reopened')state='reopened';else if(record.status==='draft'&&record.items.every(item=>item.status==='not_started'))state='not_started';else {const check=await require('./assessmentService').completion(ctx,record);state=check.ready?'ready':check.blockers.some(blocker=>['EVIDENCE_REQUIRED','FINDING_REQUIRED','ORAL_SOURCE_UNAVAILABLE'].includes(blocker.code))?'evidence_incomplete':'draft';}readiness.set(String(record._id),state);}

  const rows=filtered.map(record=>{const result=record.results?.find(value=>value.number===record.currentResultNumber);return{assessmentId:String(record._id),participant:record.participant,role:{name:record.definitionSnapshot.role.name,version:record.definitionSnapshot.role.version,versionId:record.definitionSnapshot.role.versionId},status:record.status,completionState:readiness.get(String(record._id)),selectedSources:record.definitionSnapshot.selectedInputTypes,definitionHash:record.definitionSnapshot.definitionHash,resultVersion:result?.number||null,score:record.status==='published'?result?.score?.overallScore??null:null,finalClassification:record.status==='published'?result?.finalClassification||null:null,compatibilityKey:result?.compatibilityKey||null,rankingEnabled:record.definitionSnapshot.rankingConfig.enabled,rankingConfig:record.definitionSnapshot.rankingConfig,criterionScores:record.status==='published'?result?.score?.criterionScores||[]:[],criteria:record.definitionSnapshot.criteria,exclusionReason:record.status!=='published'?'Assessment not published':result?.score?.overallScore===null?'Insufficient scored evidence':null};});

  const groups=new Map();for(const row of rows){if(!row.rankingEnabled||row.exclusionReason)continue;const key=`${row.compatibilityKey}:${row.rankingConfig.scope==='department'?row.participant.departmentId||'unassigned':row.rankingConfig.scope==='role'?row.role.versionId:'organization'}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}

  const rankings=[];for(const [key,group]of groups)for(const ranked of scoring.rankResults(group.map(row=>({...row,score:{overallScore:row.score}})),group[0].rankingConfig))rankings.push({assessmentId:ranked.assessmentId,participant:ranked.participant,rank:ranked.rank,score:ranked.score.overallScore,compatibilityKey:ranked.compatibilityKey,groupKey:key,tieRule:ranked.rankingConfig.tieRule,precision:ranked.rankingConfig.decimalPlaces,scope:ranked.rankingConfig.scope});

  const gapGroups=new Map();for(const row of rows)for(const criterion of row.criteria){const measured=row.criterionScores.find(score=>score.criterionId===criterion.id);const key=`${row.compatibilityKey}:${criterion.id}`;if(!gapGroups.has(key))gapGroups.set(key,{criterionId:criterion.id,name:criterion.name,sourceType:criterion.sourceType,sourceName:criterion.sourceName,roleName:row.role.name,compatibilityKey:row.compatibilityKey,assessed:0,missing:0,gaps:[]});const group=gapGroups.get(key);if(measured?.score!==null&&measured?.score!==undefined){group.assessed++;if(typeof measured.gap==='number')group.gaps.push(measured.gap);}else group.missing++;}

  const gaps=[...gapGroups.values()].map(({gaps,...value})=>({...value,averageGap:gaps.length?Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length*100)/100:null}));

  const statusCounts=Object.fromEntries(['draft','in_progress','reopened','published','finalised'].map(status=>[status,rows.filter(row=>row.status===status).length]));

  const completionCounts=Object.fromEntries(['not_started','draft','evidence_incomplete','ready','finalised','reopened'].map(state=>[state,rows.filter(row=>row.completionState===state).length]));

  return{cycleId,scope:ctx.organizationWide?'organization':ctx.directory.scope,total:rows.length,completed:statusCounts.published+statusCounts.finalised,statusCounts,completionCounts,truncated:scanCapped,rows:rows.map(({criteria,criterionScores,rankingConfig,...row})=>({...row,ranking:rankings.find(rank=>rank.assessmentId===row.assessmentId)||null})),rankings,gaps,rankingNotice:'Only matching measurement configurations are compared. Each comparison group is ranked separately.',filters:{departments:[...new Set(records.map(record=>record.participant.departmentId).filter(Boolean))].map(id=>({id,name:ctx.directory.departments?.find(value=>String(value.id)===String(id))?.name||ctx.directory.teams?.find(value=>String(value.departmentId)===String(id))?.departmentName||'Department name unavailable'})),teams:[...new Set(records.flatMap(record=>record.participant.teamIds||[]))].map(id=>({id,name:ctx.directory.teams?.find(value=>String(value.id)===String(id))?.name||ctx.directory.members.flatMap(person=>person.teams||[]).find(value=>String(value.id)===String(id))?.name||'Team name unavailable'})),departmentIds:[...new Set(records.map(record=>record.participant.departmentId).filter(Boolean))],teamIds:[...new Set(records.flatMap(record=>record.participant.teamIds||[]))],roles:[...new Map(records.map(record=>[record.definitionSnapshot.role.versionId,{versionId:record.definitionSnapshot.role.versionId,name:record.definitionSnapshot.role.name}])).values()]},generatedAt:new Date().toISOString()};

}

function pdfBuffer(report) {

  return new Promise((resolve,reject)=>{const document=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:`Competency assessment — ${report.participant.name}`,Author:'Seemplify Performance'}}),chunks=[];document.on('data',chunk=>chunks.push(chunk));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);

    const safe=value=>String(value??'Not recorded').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');

    const heading=text=>{if(document.y>740)document.addPage();document.moveDown(.5).font('Helvetica-Bold').fontSize(14).fillColor('#1D3855').text(safe(text)).moveDown(.4);};

    const text=(label,value)=>{document.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(`${safe(label)}: `,{continued:true});document.font('Helvetica').fontSize(10).fillColor('#182433').text(safe(value),{paragraphGap:3}).moveDown(.25);};

    document.font('Helvetica-Bold').fontSize(10).fillColor('#6B48C8').text('SEEMPLIFY / PERFORMANCE');document.moveDown().fontSize(25).fillColor('#142D4E').text('Competency assessment');text('Participant',report.participant.name);text('Role',`${report.role.name} · version ${report.role.version}`);text('Report',`Result ${report.number} · ${report.status} · ${report.visibilityScope}`);text('Created',report.dates?.createdAt||'Not recorded');text('Finalised',report.finalClassification.finalisedAt);text('Sources',report.selectedSources.join(', '));for(const source of report.sourceDefinitions||[])text('Source version',`${source.name} · version ${source.version??'Not recorded'} (${source.sourceType})`);

    heading('1  Outcome & calculation');text('Calculated score',report.score.overallScore===null?'Unscored — see coverage and exceptions':`${report.score.overallScore} / 100`);text('Suggested outcome',report.suggestedOutcome?.label||'No numeric suggestion');text('Human final classification',report.finalClassification.label);text('Decision reason',report.finalClassification.reason||'Confirmed calculated suggestion');text('Finalised by',`${report.finalClassification.finalisedBy.name} (${report.finalClassification.finalisedBy.userId})`);text('Coverage',`${report.score.coverage.assessedRequired} / ${report.score.coverage.required} required; ${report.score.coverage.assessed} / ${report.score.coverage.selected} selected; weighted ${(report.score.coverage.weighted*100).toFixed(2)}%`);text('Calculation',`Weighted mean; half-up ${report.score.formula.calculationPrecision} decimal places; displayed ${report.score.formula.displayPrecision}; input denominator ${report.score.formula.inputDenominator}; exceptions ${report.score.formula.exceptionPolicy}`);

    for(const source of report.score.sourceScores){text(`${source.sourceType} score`,`${source.score??'Unscored'} / 100 · effective weight ${source.effectiveWeight}`);if(source.score!==null){const y=document.y;if(y>745)document.addPage();const top=document.y;document.roundedRect(44,top,500,7,3).fill('#E9E6F3');document.roundedRect(44,top,Math.max(1,5*source.score),7,3).fill('#7656CC');document.moveDown(1);}}

    if(report.ranking)text('Frozen ranking',`${report.ranking.rank} of ${report.ranking.cohortSize}; ${report.ranking.scope}; ${report.ranking.tieRule} ties at ${report.ranking.precision} decimal places; cohort ${report.ranking.cohortTimestamp}`);

    heading('2  Role expectations');text('Role description',report.role.description||'Not recorded');for(const responsibility of report.role.responsibilities||[])text('Responsibility',responsibility.text);for(const requirement of report.role.requirements||[])text(requirement.required?'Required requirement':'Requirement',requirement.text);

    heading('3  Criterion findings');for(const finding of report.findings){const c=finding.criterion;heading(c.name);text('Source',`${c.sourceType} · ${c.sourceName} · version ${c.sourceVersion??'Not recorded'}`);if(c.description)text('Criterion definition',c.description);text('Expected',c.expectedLevel?.label||(c.evaluationTarget?`${c.evaluationTarget.value} (${c.ratingScale?.label||c.evaluationTarget.scaleId})`:'Not recorded'));if(c.ratingScale)text('Rating scale',`${c.ratingScale.label}: ${c.ratingScale.min}–${c.ratingScale.max}`);if(c.expectedLevel?.description)text('Expected level definition',c.expectedLevel.description);text('Observed',finding.status==='assessed'?(finding.observedLevel?.label??finding.rating??'Not recorded'):finding.status);if(finding.observedLevel?.description)text('Observed level definition',finding.observedLevel.description);text('Rationale',finding.rationale||'Not recorded');text('Assessor',finding.assessedBy?.name||'Not recorded');text('Assessment date',finding.assessedAt||'Not recorded');text('Score / gap',`${finding.calculation?.score??'Unscored'} / 100; gap ${finding.calculation?.gap??'Not recorded'}; weight ${finding.calculation?.weight??c.weight}; effective weight ${finding.calculation?.effectiveWeight??'Not recorded'}`);text('Evidence',finding.evidenceIds.map(evidenceId=>report.evidenceReferences.find(source=>source.id===evidenceId)?.title).filter(Boolean).join('; ')||'No visible retained evidence');}

    heading('4  Manager feedback');text('Linked reviewer source',report.managerSource.state==='not_configured'?'Reviewer step not configured':report.managerSource.state);text('Overall manager rating',report.managerSource.overallManagerRating);for(const entry of report.managerFeedback){if(entry.sectionTitle)text('Review section',entry.sectionTitle);if(entry.questionPrompt)text('Review question',entry.questionPrompt);text(`${entry.title||entry.section}${entry.goalTitle?` — ${entry.goalTitle}`:entry.criterionName?` — ${entry.criterionName}`:''}`,entry.text);if(entry.rating!==undefined)text('Rating',entry.rating);if(entry.verifiedCompletion!==undefined)text('Verified completion',entry.verifiedCompletion);text('Attribution',`${entry.author?.name||'Not recorded'} · ${entry.submittedAt||'Not recorded'}`);}

    heading('5  Oral assessment');for(const session of report.oralFindings){text('Session',`${session.title} · ${session.callType}`);text('Session date',`${session.occurredAt||'Not recorded'} · ${session.timeZone||'Time zone not recorded'}`);text('Participants',(session.participants||[]).map(person=>person.name||person.userId||'Not recorded').join('; ')||'Not recorded');text('Session status',`${session.status||'Not recorded'} · revision ${session.revision??'Not recorded'}`);for(const prompt of session.prompts){text('Criterion',report.criteria.find(c=>c.id===prompt.criterionId)?.name||prompt.criterionId);text('Question',prompt.question);text('Answer',prompt.answer||'Not recorded');text('Assessor notes',prompt.notes||'Not recorded');}text('Recorded by',`${session.createdBy?.name||'Not recorded'} · ${session.createdAt||'Not recorded'}`);text('Submitted by',`${session.submittedBy?.name||session.updatedBy?.name||'Not recorded'} · ${session.submittedAt||'Not recorded'}`);}

    heading('6  Evidence & exceptions');for(const source of report.evidenceReferences){text('Evidence',`${source.title}${source.documentType==='cv'?' (CV)':''} · ${source.kind} · ${source.visibility}`);text('Provenance',`${source.createdBy?.name||'Not recorded'} · ${source.createdAt||'Not recorded'} · SHA256 ${source.sha256}`);}for(const exception of report.exceptions)text('Authorised exception',`${report.criteria.find(c=>c.id===exception.criterionId)?.name||exception.criterionId}: ${exception.reason} · ${exception.author.name} · ${exception.recordedAt}`);for(const excluded of report.score.exclusions)text('Scoring exclusion',`${report.criteria.find(c=>c.id===excluded.criterionId)?.name||excluded.criterionId}: ${excluded.reason}; ${excluded.policy}; weight ${excluded.weight}`);

    const integrityRows=[['Definition',report.definitionHash],['Score',report.scoreHash],['Report',report.reportHash],['Visibility',report.visibilityHash],['Reviewer source',report.managerSource.sourceHash],['Report schema',report.reportVersion]].map(([label,value])=>`${label}: ${safe(value)}`);document.font('Helvetica').fontSize(7);const integrityHeight=integrityRows.reduce((total,row)=>total+document.heightOfString(row,{lineGap:1}),0)+32;if(document.y+integrityHeight>790)document.addPage();document.moveDown(.3).font('Helvetica-Bold').fontSize(14).fillColor('#1D3855').text('7  Integrity').moveDown(.3);document.font('Helvetica').fontSize(7).fillColor('#64748B');for(const row of integrityRows)document.text(row,{lineGap:1});

    const pages=document.bufferedPageRange();for(let index=0;index<pages.count;index++){document.switchToPage(index);document.font('Helvetica').fontSize(8).fillColor('#64748B').text(`Seemplify · Result ${report.number} · ${index+1} / ${pages.count}`,44,805,{lineBreak:false});}document.end();

  });

}

const exportDTO=value=>({id:String(value._id),status:value.status,resultVersion:value.resultVersion,errorCode:value.errorCode||null,createdAt:value.createdAt,...(value.status==='ready'?{downloadUrl:`/api/competency/exports/${value._id}/download`,sha256:value.sha256,expiresAt:value.expiresAt}:{})});

async function createExport(ctx,assessmentId,input,key) {cleanObject(input,['resultVersion']);const assessment=await require('./assessmentService').get(ctx,assessmentId,'report.export');const report=buildReportDTO({assessment,resultVersion:input.resultVersion,viewer:ctx});const settings=await require('./settingsService').getSettings(ctx.organizationId);return auth.operation(ctx,`report.export:${assessmentId}`,key,input,async()=>{const job=await Export.create({organizationId:ctx.organizationId,assessmentId,actorId:ctx.actor.userId,resultVersion:report.number,visibilityHash:report.visibilityHash,expiresAt:new Date(Date.now()+settings.exportRetentionHours*3600000)});return runExport(ctx,job);});}

async function runExport(ctx,job) {if(job.status==='ready')return exportDTO(job);const leaseUntil=new Date(Date.now()+60000);const claimed=await Export.findOneAndUpdate({_id:job._id,organizationId:ctx.organizationId,$or:[{status:{$in:['pending','failed']}},{status:'running',leaseUntil:{$lt:new Date()}}],attempts:{$lt:3}},{$set:{status:'running',leaseUntil},$inc:{attempts:1}},{new:true}).lean();if(!claimed)return exportDTO(job);let key;try{const assessment=await require('./assessmentService').get(ctx,job.assessmentId,'report.export');const report=buildReportDTO({assessment,resultVersion:job.resultVersion,viewer:ctx});if(report.visibilityHash!==job.visibilityHash)throw new DomainError(409,'EXPORT_SCOPE_CHANGED','Your report visibility changed. Create a new export.');const buffer=await pdfBuffer(report);key=await files.storePrivate(buffer);const sha256=require('node:crypto').createHash('sha256').update(buffer).digest('hex');const saved=await Export.findOneAndUpdate({_id:job._id,status:'running',leaseUntil},{$set:{status:'ready',storageKey:key,sha256},$unset:{leaseUntil:1}},{new:true}).lean();if(!saved)throw new DomainError(409,'EXPORT_LEASE_LOST','Export processing was superseded.');await auth.audit(ctx,'report.exported','assessment',job.assessmentId,{resultVersion:job.resultVersion,afterHash:sha256});return exportDTO(saved);}catch(error){if(key)await files.deletePrivate(key);await Export.updateOne({_id:job._id,leaseUntil},{$set:{status:'failed',errorCode:error.code||'PDF_GENERATION_FAILED'},$unset:{leaseUntil:1}});throw error;}}

async function getExport(ctx,exportId,{download=false}={}) {const job=await Export.findOne({_id:id(exportId),organizationId:ctx.organizationId,actorId:ctx.actor.userId}).select('+storageKey').lean();if(!job)throw new DomainError(404,'EXPORT_NOT_FOUND','This export is unavailable.');if(job.kind==='cohort')return require('./cohortExportService').get(ctx,job,{download});const assessment=await require('./assessmentService').get(ctx,job.assessmentId,'report.export');const report=buildReportDTO({assessment,resultVersion:job.resultVersion,viewer:ctx});if(report.visibilityHash!==job.visibilityHash)throw new DomainError(409,'EXPORT_SCOPE_CHANGED','Your report visibility changed. Create a new export.');if(new Date(job.expiresAt)<=new Date())throw new DomainError(410,'EXPORT_EXPIRED','This download expired. Create a new export.');if(!download)return ['pending','failed'].includes(job.status)||(job.status==='running'&&new Date(job.leaseUntil)<new Date())?runExport(ctx,job):exportDTO(job);if(job.status!=='ready')throw new DomainError(409,'EXPORT_NOT_READY','This PDF is not ready yet.');const buffer=await files.readPrivate(job.storageKey);await auth.audit(ctx,'report.downloaded','assessment',job.assessmentId,{resultVersion:job.resultVersion});return {buffer,name:`competency-assessment-${job.assessmentId}-v${job.resultVersion}.pdf`,mimeType:'application/pdf'};}

module.exports={buildReportDTO,get,rankingAtFinalise,cohort,pdfBuffer,createExport,getExport,Export};
