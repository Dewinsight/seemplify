import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { db } from './database.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import { JourneyEventStageIntelligenceRepository } from './journeyEventStageIntelligenceRepository.js';
import { resolveRequestSpace,SpaceError } from './spaces.js';
import { assertSubscriptionFeature,SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const version=z.object({sourceId:z.string().trim().min(1).max(128),environment:z.enum(['development','staging','production']),
  eventName:z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),schemaVersionId:z.string().trim().min(1).max(128),
  journeyDefinitionId:z.string().trim().min(1).max(128),journeyMapVersionId:z.string().trim().min(1).max(128),
  stageKey:z.string().trim().min(1).max(128),stageRuleVersionId:z.string().trim().min(1).max(128),
  metricDefinitionId:z.string().trim().min(1).max(128),metricDefinitionVersionId:z.string().trim().min(1).max(128),
  metricUnit:z.enum(['score','percent','count','seconds','minutes','hours','rate','index','currency','unknown']),
  valueMode:z.enum(['count','constant','numeric_property','elapsed_since_prior']),constantValue:z.number().finite().nullable(),
  numericPropertyPath:z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,7}$/).nullable(),
  dimensionKeys:z.array(z.enum(['channel','environment'])).max(2),consentRequirement:z.enum(['granted','granted_or_not_required']),
  purpose:z.enum(['service_improvement','analytics','research']),retentionDays:z.number().int().min(1).max(3650)}).strict().superRefine((value,context)=>{
    if((value.valueMode==='constant')!==(value.constantValue!==null))context.addIssue({code:'custom',message:'Constant value must match constant mode.'});
    if((value.valueMode==='numeric_property')!==(value.numericPropertyPath!==null))context.addIssue({code:'custom',message:'Numeric property path must match numeric-property mode.'});
  });
type Repository=Pick<JourneyEventStageIntelligenceRepository,'listMappings'|'readMapping'|'createMapping'|'appendVersion'|'retireMapping'>;

function sendError(response:express.Response,error:unknown){if(error instanceof z.ZodError)return response.status(400).json({error:'Mapping validation failed.',code:'JOURNEY_EVENT_MAPPING_INVALID',details:error.issues});
  if(error instanceof SpaceError||error instanceof SubscriptionEntitlementError)return response.status(error.status).json({error:error.message,code:error.code});
  const message=error instanceof Error?error.message:'';if(/^(Event mapping|Mapping source|Published server-owned)/i.test(message)){
    const status=/not found/i.test(message)?404:/changed|already exists/i.test(message)?409:400;
    return response.status(status).json({error:message,code:status===409?'JOURNEY_EVENT_MAPPING_CONFLICT':'JOURNEY_EVENT_MAPPING_INVALID'});}
  console.error('Journey event mapping request failed:',error instanceof Error?error.message:String(error));
  return response.status(500).json({error:'Journey event mappings are unavailable.',code:'JOURNEY_EVENT_MAPPING_UNAVAILABLE'});}

export function createJourneyEventStageIntelligenceRouter(repository:Repository){const router=express.Router();router.use((_request,response,next)=>{
  response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');next();});
  const principal=(request:express.Request)=>{const user=currentSessionUser(request);if(!user)throw new SpaceError('Authentication required.',401,'AUTHENTICATION_REQUIRED');
    const space=resolveRequestSpace(request,user.id);assertSubscriptionFeature(space.id,'journeyMetrics');const role=effectiveJourneyRole(space.id,user.id);
    if(!role.capabilities.has('journeys.read'))throw new SpaceError('Journey read capability is required.',403,'JOURNEY_READ_REQUIRED');
    return {user,space,canEdit:role.capabilities.has('journeys.edit')};};
  const editable=(request:express.Request)=>{const value=principal(request);if(!value.canEdit)throw new SpaceError('Journey edit capability is required.',403,'JOURNEY_EDIT_REQUIRED');return value;};
  router.get('/mappings',(request,response)=>{try{const {space}=principal(request);return response.json({mappings:repository.listMappings(space.id)});}catch(error){return sendError(response,error);}});
  router.get('/mappings/:mappingId',(request,response)=>{try{const {space}=principal(request);const mapping=repository.readMapping(space.id,z.string().uuid().parse(request.params.mappingId));
    return mapping?response.json(mapping):response.status(404).json({error:'Event mapping not found.',code:'JOURNEY_EVENT_MAPPING_NOT_FOUND'});}catch(error){return sendError(response,error);}});
  router.post('/mappings',express.json({limit:'12kb',strict:true}),(request,response)=>{try{const {space}=editable(request);return response.status(201).json(repository.createMapping({spaceId:space.id,at:new Date().toISOString(),version:version.parse(request.body)}));}catch(error){return sendError(response,error);}});
  router.post('/mappings/:mappingId/versions',express.json({limit:'12kb',strict:true}),(request,response)=>{try{const {space}=editable(request);const body=z.object({expectedRevision:z.number().int().min(1),version}).strict().parse(request.body);
    return response.status(201).json(repository.appendVersion({spaceId:space.id,mappingId:z.string().uuid().parse(request.params.mappingId),at:new Date().toISOString(),...body}));}catch(error){return sendError(response,error);}});
  router.post('/mappings/:mappingId/retire',express.json({limit:'2kb',strict:true}),(request,response)=>{try{const {space}=editable(request);const body=z.object({expectedRevision:z.number().int().min(1)}).strict().parse(request.body);
    return response.json(repository.retireMapping({spaceId:space.id,mappingId:z.string().uuid().parse(request.params.mappingId),at:new Date().toISOString(),...body}));}catch(error){return sendError(response,error);}});
  return router;}

export const journeyEventStageIntelligenceRouter=createJourneyEventStageIntelligenceRouter(new JourneyEventStageIntelligenceRepository(db));
