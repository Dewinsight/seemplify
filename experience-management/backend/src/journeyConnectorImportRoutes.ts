import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  approvedJourneyConnectorKinds, createJourneyConnector, getJourneyConnectorImport, JourneyConnectorImportError,
  listJourneyConnectorAudit, listJourneyConnectorReceipts, listJourneyConnectors, startJourneyConnectorImport,
  submitJourneyConnectorPage, updateJourneyConnectorState
} from './journeyConnectorImports.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const id = z.string().trim().min(1).max(128);
const opaqueCursor = z.string().min(1).max(2_000);
const mutationHeaders = (request: express.Request) => {
  const idempotencyKey=String(request.header('Idempotency-Key')||'').trim();
  if(!idempotencyKey||idempotencyKey.length>200) throw new JourneyConnectorImportError(
    'A valid Idempotency-Key is required.',400,'JOURNEY_CONNECTOR_IDEMPOTENCY_KEY_REQUIRED'); return {idempotencyKey};
};
function context(request:express.Request){const user=currentSessionUser(request);if(!user)throw new SpaceError(
  'Authentication required.',401,'AUTHENTICATION_REQUIRED');return{user,space:resolveRequestSpace(request,user.id)};}
function sendError(response:express.Response,error:unknown){
  if(error instanceof z.ZodError)return response.status(400).json({error:'Validation failed.',code:'VALIDATION_FAILED',details:error.issues});
  if(error instanceof JourneyConnectorImportError||error instanceof SpaceError||error instanceof SubscriptionEntitlementError)
    return response.status(error.status).json({error:error.message,code:error.code,details:'details'in error?error.details:{}});
  console.error('Journey connector import request failed:',error instanceof Error?error.message:String(error));
  return response.status(500).json({error:'Journey connector import request failed.',code:'JOURNEY_CONNECTOR_INTERNAL_ERROR'});
}

export const journeyConnectorImportRouter=express.Router();
journeyConnectorImportRouter.use((_request,response,next)=>{response.setHeader('Cache-Control','private, no-store');next();});
journeyConnectorImportRouter.get('/connectors',(request,response)=>{try{const{user,space}=context(request);
  return response.json({connectors:listJourneyConnectors({spaceId:space.id,actorUserId:user.id})});}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.post('/connectors',(request,response)=>{try{const{user,space}=context(request);const headers=mutationHeaders(request);
  const body=z.object({kind:z.enum(approvedJourneyConnectorKinds),name:z.string().trim().min(1).max(160),
    maximumAttempts:z.number().int().min(1).max(10).default(5),baseRetrySeconds:z.number().int().min(1).max(300).default(5)}).strict().parse(request.body||{});
  return response.status(201).json(createJourneyConnector({spaceId:space.id,actorUserId:user.id,...headers,...body}));
}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.patch('/connectors/:connectorId',(request,response)=>{try{const{user,space}=context(request);const headers=mutationHeaders(request);
  const body=z.object({expectedRevision:z.number().int().min(1),state:z.enum(['active','disabled'])}).strict().parse(request.body||{});
  return response.json(updateJourneyConnectorState({spaceId:space.id,actorUserId:user.id,connectorId:id.parse(request.params.connectorId),...headers,...body}));
}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.post('/connectors/:connectorId/imports',(request,response)=>{try{const{user,space}=context(request);const headers=mutationHeaders(request);
  z.object({}).strict().parse(request.body||{});return response.status(201).json(startJourneyConnectorImport({spaceId:space.id,
    actorUserId:user.id,connectorId:id.parse(request.params.connectorId),...headers}));}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.get('/imports/:runId',(request,response)=>{try{const{user,space}=context(request);
  return response.json({run:getJourneyConnectorImport({spaceId:space.id,actorUserId:user.id,runId:id.parse(request.params.runId)})});
}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.post('/imports/:runId/pages',(request,response)=>{try{const{user,space}=context(request);const headers=mutationHeaders(request);
  const body=z.object({expectedCheckpointRevision:z.number().int().min(1),cursor:opaqueCursor.nullable(),nextCursor:opaqueCursor.nullable(),
    providerOutcome:z.enum(['ok','rate_limited','transient_failure']),retryAfterSeconds:z.number().int().min(1).max(86_400).optional(),
    items:z.array(z.unknown()).max(201)}).strict().superRefine((value,ctx)=>{if(value.providerOutcome==='ok'&&value.retryAfterSeconds!==undefined)
      ctx.addIssue({code:'custom',message:'Successful pages cannot specify retryAfterSeconds.',path:['retryAfterSeconds']});
    if(value.providerOutcome!=='ok'&&value.nextCursor!==value.cursor)ctx.addIssue({code:'custom',message:'Failed pages cannot advance the cursor.',path:['nextCursor']});}).parse(request.body||{});
  return response.json(submitJourneyConnectorPage({spaceId:space.id,actorUserId:user.id,runId:id.parse(request.params.runId),...headers,...body}));
}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.get('/imports/:runId/receipts',(request,response)=>{try{const{user,space}=context(request);
  const query=z.object({limit:z.coerce.number().int().min(1).max(100).optional(),cursor:opaqueCursor.optional()}).strict().parse(request.query);
  return response.json(listJourneyConnectorReceipts({spaceId:space.id,actorUserId:user.id,runId:id.parse(request.params.runId),...query}));
}catch(error){return sendError(response,error);}});
journeyConnectorImportRouter.get('/audit',(request,response)=>{try{const{user,space}=context(request);
  const query=z.object({limit:z.coerce.number().int().min(1).max(100).optional()}).strict().parse(request.query);
  return response.json({events:listJourneyConnectorAudit({spaceId:space.id,actorUserId:user.id,...query})});
}catch(error){return sendError(response,error);}});
