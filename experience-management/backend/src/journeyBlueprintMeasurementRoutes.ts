import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { assertJourneyCapability,JourneyCollaborationError } from './journeyCollaboration.js';
import { JourneyBlueprintMeasurementError,journeyBlueprintMeasurementRepository } from './journeyBlueprintMeasurements.js';
import { resolveRequestSpace,SpaceError } from './spaces.js';
import { assertSubscriptionFeature,SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const token=z.string().trim().min(1).max(128),idempotency=z.string().trim().min(1).max(200);
function context(request:express.Request,capability:'journeys.read'|'journeys.edit'){const user=currentSessionUser(request);
  if(!user)throw new SpaceError('Authentication required.',401,'AUTHENTICATION_REQUIRED');const space=resolveRequestSpace(request,user.id);
  assertSubscriptionFeature(space.id,'journeyBlueprints');assertSubscriptionFeature(space.id,'journeyMetrics');
  assertJourneyCapability(space.id,user.id,capability);return {user,space};}
function error(response:express.Response,cause:unknown){if(cause instanceof z.ZodError)return response.status(400).json({error:'Validation failed.',
  code:'VALIDATION_FAILED',details:cause.issues});if(cause instanceof JourneyBlueprintMeasurementError||cause instanceof SpaceError
  ||cause instanceof SubscriptionEntitlementError||cause instanceof JourneyCollaborationError)return response.status((cause as any).status||403)
    .json({error:cause.message,code:(cause as any).code});console.error('Journey blueprint measurement request failed:',
      cause instanceof Error?cause.message:String(cause));return response.status(500).json({error:'Blueprint measurement request failed.',
        code:'JOURNEY_BLUEPRINT_MEASUREMENT_INTERNAL_ERROR'});}

export function createJourneyBlueprintMeasurementRouter(repository=journeyBlueprintMeasurementRepository){const journeyBlueprintMeasurementRouter=express.Router();
journeyBlueprintMeasurementRouter.use((_request,response,next)=>{response.setHeader('Cache-Control','private, no-store');next();});
journeyBlueprintMeasurementRouter.get('/plans',(request,response)=>{try{const {user,space}=context(request,'journeys.read');const query=z.object({
  blueprintVersionId:token.optional()}).strict().parse(request.query);return response.json({plans:repository.list({
    spaceId:space.id,actorUserId:user.id,...query})});}catch(cause){return error(response,cause);}});
journeyBlueprintMeasurementRouter.post('/plans',(request,response)=>{try{const {user,space}=context(request,'journeys.edit');const body=z.object({
  blueprintVersionId:token,elementId:token,metricDefinitionId:token,metricDefinitionVersionId:token,baselineObservationId:token,
  idempotencyKey:idempotency}).strict().parse(request.body||{});return response.status(201).json({plan:repository
    .createPlan({spaceId:space.id,actorUserId:user.id,...body})});}catch(cause){return error(response,cause);}});
journeyBlueprintMeasurementRouter.get('/plans/:planId',(request,response)=>{try{const {user,space}=context(request,'journeys.read');const {planId}=z.object({
  planId:token}).strict().parse(request.params);return response.json(repository.read({spaceId:space.id,
    actorUserId:user.id,planId}));}catch(cause){return error(response,cause);}});
journeyBlueprintMeasurementRouter.post('/plans/:planId/outcomes',(request,response)=>{try{const {user,space}=context(request,'journeys.edit');
  const {planId}=z.object({planId:token}).strict().parse(request.params);const body=z.object({afterObservationId:token,
    expectedRevision:z.number().int().positive(),idempotencyKey:idempotency}).strict().parse(request.body||{});
  return response.status(201).json({outcome:repository.recordOutcome({spaceId:space.id,
    actorUserId:user.id,planId,...body})});}catch(cause){return error(response,cause);}});
journeyBlueprintMeasurementRouter.post('/plans/:planId/close',(request,response)=>{try{const {user,space}=context(request,'journeys.edit');
  const {planId}=z.object({planId:token}).strict().parse(request.params);const body=z.object({expectedRevision:z.number().int().positive(),
  idempotencyKey:idempotency}).strict().parse(request.body||{});return response.json({plan:repository.closePlan({
      spaceId:space.id,actorUserId:user.id,planId,...body})});}catch(cause){return error(response,cause);}});
return journeyBlueprintMeasurementRouter;}
export const journeyBlueprintMeasurementRouter=createJourneyBlueprintMeasurementRouter();
