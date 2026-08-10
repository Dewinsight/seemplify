import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  exportJourneyStageComparisons, JourneyStageIntelligenceError,
  journeyStageComparisonDimensions, journeyStagePurposes
} from './journeyStageIntelligence.js';
import { JourneyStageIntelligenceRepository,
  type JourneyStageIntelligencePrincipal } from './journeyStageIntelligenceRepository.js';
import { SqlJourneyStageIntelligenceStorage } from './journeyStageIntelligenceSqlRepository.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { assertSubscriptionFeature, SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import { journeyStageSurveyFeedRepository } from './journeyStageSurveyFeedRepository.js';
import { JourneyOperationalStageFeedError,
  journeyOperationalStageFeedRepository } from './journeyOperationalStageFeedRepository.js';

const querySchema = z.object({
  journeyDefinitionId: z.string().trim().min(1).max(128),
  purpose: z.enum(journeyStagePurposes),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }),
  dimensions: z.preprocess((value) => value === undefined ? undefined
    : (Array.isArray(value) ? value : String(value).split(',')).map((item) => String(item).trim()).filter(Boolean),
  z.array(z.enum(journeyStageComparisonDimensions)).min(1).max(4)).optional()
}).strict();
const trendQuerySchema = querySchema.extend({ bucketDays: z.coerce.number().int().min(1).max(31) }).strict();

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({
    error: 'Journey stage intelligence validation failed.', code: 'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID',
    details: error.issues
  });
  if (error instanceof JourneyStageIntelligenceError || error instanceof JourneyOperationalStageFeedError || error instanceof SpaceError
      || error instanceof SubscriptionEntitlementError) return response.status(error.status)
    .json({ error: error.message, code: error.code });
  return response.status(500).json({ error: 'Journey stage intelligence is unavailable.',
    code: 'JOURNEY_STAGE_INTELLIGENCE_UNAVAILABLE' });
}

/** Strict router with request-derived tenant identity. */
export function createJourneyStageIntelligenceRouter(input: {
  authorize(request: express.Request): JourneyStageIntelligencePrincipal;
  repository: JourneyStageIntelligenceRepository;
  surveyFeedRepository?: Pick<typeof journeyStageSurveyFeedRepository, 'createPolicy' | 'createMapping'>;
  operationalFeedRepository?: Pick<typeof journeyOperationalStageFeedRepository,
    'createTicketMapping' | 'listTicketMappings' | 'retireTicketMapping'>;
}) {
  const router = express.Router();
  const surveyFeed = input.surveyFeedRepository || journeyStageSurveyFeedRepository;
  const operationalFeed = input.operationalFeedRepository || journeyOperationalStageFeedRepository;
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  const resolve = async (request: express.Request, action: 'comparison.read' | 'export.read' = 'comparison.read') => {
    const principal = input.authorize(request);
    const query = querySchema.parse(request.query);
    return input.repository.compare(principal, query, action);
  };
  router.get('/policy', async (request, response) => {
    try { return response.json({ policy: await input.repository.readPolicy(input.authorize(request)) }); }
    catch (error) { return sendError(response, error); }
  });
  router.put('/policy', express.json({ limit: '8kb', strict: true }), async (request, response) => {
    try {
      const update = z.object({ expectedRevision: z.number().int().min(1),
        minimumSampleSize: z.number().int().min(3).max(1_000),
        dimensions: z.array(z.enum(journeyStageComparisonDimensions)).min(1).max(4),
        maximumRows: z.number().int().min(1).max(5_000) }).strict().parse(request.body || {});
      return response.json({ policy: await input.repository.updatePolicy(input.authorize(request), update) });
    } catch (error) { return sendError(response, error); }
  });
  router.post('/survey-feed/policies', express.json({ limit: '8kb', strict: true }), async (request, response) => {
    try {
      const principal = input.authorize(request);
      if (!principal.capabilities.has('journeys.edit')) throw new JourneyStageIntelligenceError(
        'Journey edit capability is required.', 403, 'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED');
      const body = z.object({ surveyId: z.string().trim().min(1).max(128), collectorId: z.string().trim().min(1).max(128),
        notice: z.string().trim().min(20).max(4000), allowedPurposes: z.array(z.enum(journeyStagePurposes)).min(1).max(3),
        retentionDays: z.number().int().min(1).max(3650), expectedRevision: z.number().int().min(0).optional() })
        .strict().parse(request.body || {});
      return response.status(201).json({ policy: surveyFeed.createPolicy({ ...body,
        spaceId: principal.spaceId, actorUserId: principal.userId }) });
    } catch (error) { return sendError(response, error); }
  });
  router.post('/survey-feed/mappings', express.json({ limit: '8kb', strict: true }), async (request, response) => {
    try {
      const principal = input.authorize(request);
      if (!principal.capabilities.has('journeys.edit')) throw new JourneyStageIntelligenceError(
        'Journey edit capability is required.', 403, 'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED');
      const body = z.object({ metricDefinitionId: z.string().trim().min(1).max(128),
        allowedPurposes: z.array(z.enum(journeyStagePurposes)).min(1).max(3), retentionDays: z.number().int().min(1).max(3650),
        idempotencyKey: z.string().trim().min(8).max(200) }).strict().parse(request.body || {});
      return response.status(201).json({ mapping: surveyFeed.createMapping({ ...body,
        spaceId: principal.spaceId, actorUserId: principal.userId }) });
    } catch (error) { return sendError(response, error); }
  });
  router.get('/operational-feed/mappings', async(request,response)=>{
    try { const principal=input.authorize(request);assertSubscriptionFeature(principal.spaceId,'journeyProfiles');
      if(!principal.capabilities.has('journeys.read'))throw new JourneyStageIntelligenceError('Journey read capability is required.',403,
        'JOURNEY_STAGE_INTELLIGENCE_READ_REQUIRED');return response.json({mappings:operationalFeed.listTicketMappings(principal.spaceId)}); }
    catch(error){return sendError(response,error);}
  });
  router.post('/operational-feed/mappings',express.json({limit:'8kb',strict:true}),async(request,response)=>{
    try { const principal=input.authorize(request);assertSubscriptionFeature(principal.spaceId,'journeyProfiles');
      if(!principal.capabilities.has('journeys.edit'))throw new JourneyStageIntelligenceError('Journey edit capability is required.',403,
        'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED');const body=z.object({metricDefinitionId:z.string().trim().min(1).max(128),
        allowedPurposes:z.array(z.enum(journeyStagePurposes)).min(1).max(3),retentionDays:z.number().int().min(1).max(3650),
        idempotencyKey:z.string().trim().min(8).max(200),identity:z.object({kind:z.enum(['anonymous_id','authenticated_user_id',
          'external_user_id']),namespace:z.string().trim().min(1).max(160)}).strict().nullable().optional()}).strict().parse(request.body||{});
      return response.status(201).json({mapping:operationalFeed.createTicketMapping({...body,spaceId:principal.spaceId,
        actorUserId:principal.userId})});}catch(error){return sendError(response,error);}
  });
  router.delete('/operational-feed/mappings/:mappingId',express.json({limit:'4kb',strict:true}),async(request,response)=>{
    try { const principal=input.authorize(request);assertSubscriptionFeature(principal.spaceId,'journeyProfiles');
      if(!principal.capabilities.has('journeys.edit'))throw new JourneyStageIntelligenceError('Journey edit capability is required.',403,
        'JOURNEY_STAGE_INTELLIGENCE_EDIT_REQUIRED');const params=z.object({mappingId:z.string().trim().min(1).max(128)}).strict()
        .parse(request.params),body=z.object({expectedRevision:z.number().int().positive()}).strict().parse(request.body||{});
      return response.json({mapping:operationalFeed.retireTicketMapping({...params,...body,spaceId:principal.spaceId,
        actorUserId:principal.userId})});}catch(error){return sendError(response,error);}
  });
  router.get('/comparisons', async (request, response) => {
    try { return response.json(await resolve(request)); } catch (error) { return sendError(response, error); }
  });
  router.get('/trends', async (request, response) => {
    try {
      const principal = input.authorize(request);
      const query = trendQuerySchema.parse(request.query);
      return response.json(await input.repository.trend(principal, query));
    } catch (error) { return sendError(response, error); }
  });
  router.get('/comparisons.:format', async (request, response) => {
    try {
      const format = z.enum(['csv', 'json']).parse(request.params.format);
      const result = await resolve(request, 'export.read'); const artifact = exportJourneyStageComparisons(result, format);
      response.setHeader('Content-Type', artifact.mimeType);
      response.setHeader('Content-Disposition', `attachment; filename="journey-stage-comparisons.${format}"`);
      response.setHeader('Content-Length', String(artifact.bytes.length));
      return response.send(artifact.bytes);
    } catch (error) { return sendError(response, error); }
  });
  return router;
}

const journeyStageIntelligenceRepository = new JourneyStageIntelligenceRepository(
  new SqlJourneyStageIntelligenceStorage());

export const journeyStageIntelligenceRouter = createJourneyStageIntelligenceRouter({
  repository: journeyStageIntelligenceRepository,
  authorize(request) {
    const user = currentSessionUser(request);
    if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
    const space = resolveRequestSpace(request, user.id);
    assertSubscriptionFeature(space.id, 'journeyMetrics');
    const effective = effectiveJourneyRole(space.id, user.id);
    return { userId: user.id, spaceId: space.id, role: space.role,
      capabilities: new Set([...effective.capabilities].filter((capability): capability is 'journeys.read' | 'journeys.edit' =>
        capability === 'journeys.read' || capability === 'journeys.edit')) };
  }
});
