import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { effectiveJourneyRole, JourneyCollaborationError } from './journeyCollaboration.js';
import { JourneyExportBrandError, journeyExportBrandFonts, journeyExportBrandRepository } from './journeyExportBranding.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const id=z.string().trim().min(1).max(128),key=z.string().trim().min(1).max(200),revision=z.number().int().min(0);
const colour=z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/),configuration=z.object({organisationName:z.string().trim().min(1).max(160),
  logoAssetId:id.nullable().optional(),primaryHex:colour,accentHex:colour,backgroundHex:colour,textHex:colour,
  fontFamily:z.enum(journeyExportBrandFonts),footerText:z.string().trim().max(300).optional(),locale:z.string().trim().min(2).max(35).optional()}).strict();
function context(request:express.Request){const user=currentSessionUser(request);if(!user)throw new SpaceError('Authentication required.',401,
  'AUTHENTICATION_REQUIRED');return {user,space:resolveRequestSpace(request,user.id)};}
function sendError(response:express.Response,cause:unknown){if(cause instanceof z.ZodError)return response.status(400).json({error:'Validation failed.',
  code:'VALIDATION_FAILED',details:cause.issues});if(cause instanceof JourneyExportBrandError||cause instanceof JourneyCollaborationError
  ||cause instanceof SpaceError||cause instanceof SubscriptionEntitlementError)return response.status((cause as any).status||400).json({
    error:cause.message,code:(cause as any).code});console.error('Journey export branding request failed:',cause instanceof Error?cause.message:String(cause));
  return response.status(500).json({error:'Journey export branding request failed.',code:'JOURNEY_EXPORT_BRAND_INTERNAL_ERROR'});}
const asyncRoute=(handler:(request:express.Request,response:express.Response)=>Promise<unknown>)=>(request:express.Request,response:express.Response)=>{
  void handler(request,response).catch((cause)=>sendError(response,cause));};

export function createJourneyExportBrandRouter(repository=journeyExportBrandRepository){const router=express.Router();router.use((_request,response,next)=>{
  response.setHeader('Cache-Control','private, no-store');next();});
  router.get('/access',(request,response)=>{try{const {user,space}=context(request);const role=effectiveJourneyRole(space.id,user.id);
    return response.json({canRead:role.capabilities.has('journeys.read'),canEdit:role.capabilities.has('journeys.edit'),
      canManageViews:role.capabilities.has('journeys.manage_views'),canExport:role.capabilities.has('journeys.export')});}catch(cause){return sendError(response,cause);}});
  router.get('/profiles',(request,response)=>{try{const {user,space}=context(request);return response.json(repository.list({spaceId:space.id,
    actorUserId:user.id}));}catch(cause){return sendError(response,cause);}});
  router.get('/audit',(request,response)=>{try{const {user,space}=context(request);const query=z.object({limit:z.coerce.number().int().min(1).max(100)
    .optional()}).strict().parse(request.query);return response.json(repository.getAudit({spaceId:space.id,actorUserId:user.id,...query}));}
    catch(cause){return sendError(response,cause);}});
  router.post('/assets',asyncRoute(async(request,response)=>{const {user,space}=context(request);const body=z.object({uploadId:id,
    altText:z.string().trim().min(1).max(300),idempotencyKey:key}).strict().parse(request.body||{});return response.status(201).json({asset:
      await repository.createAsset({spaceId:space.id,actorUserId:user.id,...body})});}));
  router.post('/profiles',(request,response)=>{try{const {user,space}=context(request);const body=configuration.extend({name:z.string().trim().min(1)
    .max(120),idempotencyKey:key}).strict().parse(request.body||{});return response.status(201).json(repository.createProfile({spaceId:space.id,
      actorUserId:user.id,...body}));}catch(cause){return sendError(response,cause);}});
  router.post('/profiles/:profileId/versions',(request,response)=>{try{const {user,space}=context(request),params=z.object({profileId:id}).strict()
    .parse(request.params),body=configuration.extend({expectedRevision:z.number().int().positive(),idempotencyKey:key}).strict().parse(request.body||{});
    return response.status(201).json(repository.createVersion({spaceId:space.id,actorUserId:user.id,...params,...body}));}
    catch(cause){return sendError(response,cause);}});
  router.delete('/profiles/:profileId',(request,response)=>{try{const {user,space}=context(request),params=z.object({profileId:id}).strict()
    .parse(request.params),body=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:key}).strict().parse(request.body||{});
    return response.json(repository.retireProfile({spaceId:space.id,actorUserId:user.id,...params,...body}));}
    catch(cause){return sendError(response,cause);}});
  router.delete('/assets/:assetId',(request,response)=>{try{const {user,space}=context(request),params=z.object({assetId:id}).strict()
    .parse(request.params),body=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:key}).strict().parse(request.body||{});
    return response.json(repository.retireAsset({spaceId:space.id,actorUserId:user.id,...params,...body}));}
    catch(cause){return sendError(response,cause);}});
  router.put('/default',(request,response)=>{try{const {user,space}=context(request),body=z.object({profileId:id,profileVersion:z.number().int().positive(),
    expectedRevision:revision,idempotencyKey:key}).strict().parse(request.body||{});return response.json(repository.setDefault({spaceId:space.id,
      actorUserId:user.id,...body}));}catch(cause){return sendError(response,cause);}});
  router.delete('/default',(request,response)=>{try{const {user,space}=context(request),body=z.object({expectedRevision:z.number().int().positive(),
    idempotencyKey:key}).strict().parse(request.body||{});return response.json(repository.resetDefault({spaceId:space.id,actorUserId:user.id,...body}));}
    catch(cause){return sendError(response,cause);}});
  router.get('/saved-views/:viewId',(request,response)=>{try{const {user,space}=context(request),params=z.object({viewId:id}).strict()
    .parse(request.params);return response.json(repository.getSavedViewBinding({spaceId:space.id,actorUserId:user.id,...params}));}
    catch(cause){return sendError(response,cause);}});
  router.put('/saved-views/:viewId',(request,response)=>{try{const {user,space}=context(request),params=z.object({viewId:id}).strict().parse(request.params),
    body=z.object({viewRevision:z.number().int().positive(),brandPolicy:z.enum(['space_default','pinned']),profileId:id.nullable().optional(),
      profileVersion:z.number().int().positive().nullable().optional(),expectedRevision:revision,idempotencyKey:key}).strict().parse(request.body||{});
    return response.json(repository.bindSavedView({spaceId:space.id,actorUserId:user.id,...params,...body}));}
    catch(cause){return sendError(response,cause);}});
  return router;}

export const journeyExportBrandRouter=createJourneyExportBrandRouter();
