'use strict';
const mongoose=require('mongoose');
const crypto=require('node:crypto');
const Evidence=require('../../models/CompetencyEvidence');
const Suggestion=require('../../models/CompetencyAISuggestion');
const Oral=require('../../models/CompetencyOralSession');
const Assessment=require('../../models/CompetencyAssessment');
const files=require('./fileSafetyService');
const auth=require('./authorizationService');
const assessment=require('./assessmentService');
const schema=new mongoose.Schema({organizationId:{type:String,unique:true},owner:String,leaseUntil:Date},{timestamps:true});
const Lease=mongoose.models.CompetencyRetentionLease||mongoose.model('CompetencyRetentionLease',schema);
let running=false;
async function expireEvidence(source,now) {
  const record=await Assessment.findOne({_id:source.assessmentId,organizationId:source.organizationId}).lean();
  if(!record||record.mutationLock)return false;
  const ctx={organizationId:source.organizationId,actor:{userId:'system:competency-retention',name:'Assessment retention service'}};
  return assessment.withMutation(ctx,record,async()=>{
    const current=await Evidence.findOneAndUpdate({_id:source._id,organizationId:source.organizationId,legalHold:false,status:{$in:['ready','deletion_pending','deletion_failed']}},{$set:{status:'deletion_pending'}} ,{new:true}).select('+storageKey').lean();
    if(!current)return false;
    try{
      if(current.storageKey)await files.deletePrivate(current.storageKey);
      await Evidence.updateOne({_id:current._id,organizationId:source.organizationId,status:'deletion_pending',legalHold:false},{$set:{status:'deleted',text:'',spans:[],deletedAt:now,deletedBy:ctx.actor},$unset:{storageKey:1,deletionError:1},$inc:{revision:1}});
      await Suggestion.updateMany({organizationId:source.organizationId,assessmentId:source.assessmentId,'evidenceHashes.id':String(source._id)},{$set:{status:'cancelled',errorCode:'SOURCE_EXPIRED',text:'',originalText:'',observations:[]}});
      await scrubSuggestionCaches(source.organizationId,source.assessmentId,String(source._id));
      if(source.source?.oralSessionId)await Oral.updateOne({_id:source.source.oralSessionId,organizationId:source.organizationId,assessmentId:source.assessmentId},{$set:{prompts:[],versions:[],sourceWithdrawnAt:now}});await auth.audit(ctx,'evidence.expired','evidence',source._id,{beforeHash:source.sha256});return true;
    }catch(error){await Evidence.updateOne({_id:current._id,organizationId:source.organizationId},{$set:{status:'deletion_failed',deletionError:'PRIVATE_STORAGE_DELETE_FAILED'}});return false;}
  },{allowPublished:true});
}
async function processDue({now=new Date(),limit=100}={}) {
  if(running||mongoose.connection.readyState!==1)return{busy:true};running=true;
  const stats={evidenceDeleted:0,exportsDeleted:0,suggestionsDeleted:0,oralReferencesExpired:0,errors:0};
  try{
    const Export=require('./reportService').Export;
    // Mutations perform only bounded local persistence/private-file operations.
    // The lease exceeds their time bound; crashed processes cannot leave drafts
    // locked forever. Late continuations still have a unique ownership token.
    await Assessment.updateMany({mutationLock:{$ne:null},mutationLeaseUntil:{$lt:now}},{$set:{mutationLock:null},$unset:{mutationLeaseUntil:1},$inc:{revision:1}});
    // A lost authenticated request is never replayed against a personal provider
    // account by a generic worker. Mark the expired attempt recoverable instead.
    await Suggestion.updateMany({status:'running',leaseUntil:{$lt:now}},{$set:{status:'failed',errorCode:'LEASE_EXPIRED'},$unset:{leaseUntil:1}});
    const sources=await Evidence.find({legalHold:false,$or:[{status:'ready','retention.expiresAt':{$lte:now}},{status:{$in:['deletion_pending','deletion_failed']}}]}).limit(limit).lean();
    const expiredExports=await Export.find({expiresAt:{$lte:now},status:{$ne:'expired'}}).select('+storageKey').limit(limit).lean();
    const expiredSuggestions=await Suggestion.find({'consent.expiresAt':{$lte:now},status:{$nin:['cancelled']}}).limit(limit).lean();
    const oralReferences=await Oral.find({'source.retention.expiresAt':{$lte:now},'source.status':{$ne:'expired'}}).limit(limit).lean();
    const organizations=[...new Set([...sources,...expiredExports,...expiredSuggestions,...oralReferences].map(value=>value.organizationId))];
    for(const organizationId of organizations){
      const owner=crypto.randomUUID();let lease;
      try{lease=await Lease.findOneAndUpdate({organizationId,$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$set:{owner,leaseUntil:new Date(+now+60000)}},{upsert:true,new:true}).lean();}catch(error){if(error.code===11000)continue;throw error;}
      if(!lease||lease.owner!==owner)continue;
      try{
        for(const source of sources.filter(value=>value.organizationId===organizationId))try{if(await expireEvidence(source,now))stats.evidenceDeleted++;}catch{stats.errors++;}
        for(const job of expiredExports.filter(value=>value.organizationId===organizationId))try{if(job.storageKey)await files.deletePrivate(job.storageKey);await Export.updateOne({_id:job._id,organizationId},{$set:{status:'expired',deletedAt:now},$unset:{storageKey:1,leaseUntil:1}});stats.exportsDeleted++;}catch{stats.errors++;await Export.updateOne({_id:job._id,organizationId},{$set:{errorCode:'DELETION_RETRY_PENDING'}});}
        for(const suggestion of expiredSuggestions.filter(value=>value.organizationId===organizationId)){await Suggestion.updateOne({_id:suggestion._id,organizationId},{$set:{status:'cancelled',errorCode:'RETENTION_EXPIRED',text:'',originalText:'',observations:[]},$unset:{leaseUntil:1}});await require('../../models/CompetencyOperation').updateMany({organizationId,action:`assessment.ai:${suggestion.assessmentId}`,'result.id':String(suggestion._id)},{$set:{'result.status':'cancelled'},$unset:{'result.text':1,'result.originalText':1,'result.observations':1}});stats.suggestionsDeleted++;}
        for(const oral of oralReferences.filter(value=>value.organizationId===organizationId)){await Oral.updateOne({_id:oral._id,organizationId},{$set:{'source.status':'expired'},$unset:{'source.text':1}});stats.oralReferencesExpired++;}
      }finally{await Lease.updateOne({organizationId,owner},{$set:{leaseUntil:new Date(0)},$unset:{owner:1}});}
    }
    return stats;
  }finally{running=false;}
}
async function scrubSuggestionCaches(organizationId,assessmentId,evidenceId){const suggestions=await Suggestion.find({organizationId,assessmentId,'evidenceHashes.id':evidenceId}).select('_id').lean();if(suggestions.length)await require('../../models/CompetencyOperation').updateMany({organizationId,action:`assessment.ai:${assessmentId}`,'result.id':{$in:suggestions.map(value=>String(value._id))}},{$set:{'result.status':'cancelled'},$unset:{'result.text':1,'result.originalText':1,'result.observations':1}});}
module.exports={processDue,expireEvidence,Lease,scrubSuggestionCaches};
