import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { JourneyCollaborationError } from './journeyCollaboration.js';
import {
  analysePersistedJourneyServiceBlueprint,
  comparePersistedJourneyServiceBlueprints,
  createJourneyBlueprintResource,
  createJourneyServiceBlueprint,
  createJourneyServiceBlueprintVersion,
  exportJourneyServiceBlueprintVersion,
  JourneyServiceBlueprintRepositoryError,
  listJourneyBlueprintResources,
  listJourneyServiceBlueprints,
  listJourneyServiceBlueprintVersions,
  readJourneyServiceBlueprintVersion,
  reviewJourneyBlueprintGap,
  reviewJourneyServiceBlueprintVersion,
  updateJourneyBlueprintResource,
  updateJourneyServiceBlueprint
} from './journeyServiceBlueprintRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const token = z.string().trim().min(1).max(128);
const nullableToken = z.union([token, z.null()]).optional();
const blueprintStates = ['current', 'future'] as const;
const reviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;
const blueprintLifecycles = ['draft', 'in_review', 'approved', 'retired'] as const;
const resourceKinds = ['team', 'actor', 'system', 'vendor', 'policy', 'control'] as const;
const resourceLifecycles = ['active', 'retired'] as const;
const lanes = ['customer', 'frontstage', 'backstage', 'supporting_system', 'policy_control'] as const;
const elementKinds = ['action', 'touchpoint', 'process', 'system', 'policy', 'control', 'handoff', 'failure_point'] as const;
const relationshipKinds = ['supports', 'depends_on', 'handoff_to', 'causes', 'mitigates', 'governed_by'] as const;
const portfolioKinds = ['pain_point', 'opportunity', 'solution', 'initiative'] as const;
const portfolioRelationships = ['causes', 'affected_by', 'mitigated_by', 'improved_by'] as const;

const stageSchema = z.object({
  stageKey: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), ordinal: z.number().int().min(0)
}).strict();
const elementSchema = z.object({
  id: token, stageKey: z.string().trim().min(1).max(80), lane: z.enum(lanes), kind: z.enum(elementKinds),
  title: z.string().trim().min(1).max(200), description: z.string().max(10_000).optional(),
  ownerTeamId: nullableToken, actorId: nullableToken, systemId: nullableToken, vendorId: nullableToken, controlId: nullableToken,
  slaMinutes: z.number().positive().nullable().optional(), unitCost: z.number().min(0).nullable().optional(),
  riskProbability: z.number().min(0).max(1).nullable().optional(), riskImpact: z.number().min(0).max(1).nullable().optional(),
  ordinal: z.number().int().min(0).nullable().optional(), evidenceRefs: z.array(token).max(500).optional(),
  metricRefs: z.array(token).max(500).optional()
}).strict();
const relationshipSchema = z.object({
  id: token, kind: z.enum(relationshipKinds), fromElementId: token, toElementId: token,
  label: z.string().max(500).optional()
}).strict();
const portfolioLinkSchema = z.object({
  id: token, elementId: token, portfolioItemId: token, portfolioItemKind: z.enum(portfolioKinds),
  portfolioItemRevision: z.number().int().positive(), relationship: z.enum(portfolioRelationships)
}).strict();

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({
    error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues
  });
  if (error instanceof JourneyServiceBlueprintRepositoryError || error instanceof SpaceError
    || error instanceof SubscriptionEntitlementError || error instanceof JourneyCollaborationError) return response.status(error.status).json({
    error: error.message, code: error.code, details: 'details' in error ? error.details : {}
  });
  console.error('Journey service blueprint request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({
    error: 'The service blueprint request could not be completed.', code: 'JOURNEY_BLUEPRINT_INTERNAL_ERROR'
  });
}

export const journeyServiceBlueprintRouter = express.Router();
journeyServiceBlueprintRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});

journeyServiceBlueprintRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeRetired: z.coerce.boolean().optional(), journeyDefinitionId: token.optional() })
      .strict().parse(request.query);
    return response.json({ blueprints: listJourneyServiceBlueprints({
      spaceId: space.id, actorUserId: user.id, ...query
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.post('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ journeyDefinitionId: token, name: z.string().trim().min(1).max(200),
      ownerUserId: nullableToken, ownerTeamId: nullableToken }).strict().parse(request.body || {});
    return response.status(201).json({ blueprint: createJourneyServiceBlueprint({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.patch('/:blueprintId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: z.number().int().positive(), name: z.string().trim().min(1).max(200).optional(),
      lifecycle: z.enum(blueprintLifecycles).optional(), ownerUserId: nullableToken, ownerTeamId: nullableToken })
      .strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'),
        { message: 'At least one blueprint change is required.' }).parse(request.body || {});
    return response.json({ blueprint: updateJourneyServiceBlueprint({
      spaceId: space.id, actorUserId: user.id, blueprintId: String(request.params.blueprintId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.get('/:blueprintId/versions', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ versions: listJourneyServiceBlueprintVersions({
      spaceId: space.id, actorUserId: user.id, blueprintId: String(request.params.blueprintId)
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.post('/:blueprintId/versions', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      journeyVersionId: token, state: z.enum(blueprintStates), changeReason: z.string().max(1000).nullable().optional(),
      stages: z.array(stageSchema).min(1).max(200), elements: z.array(elementSchema).max(5000),
      relationships: z.array(relationshipSchema).max(20_000), portfolioLinks: z.array(portfolioLinkSchema).max(5000).optional()
    }).strict().parse(request.body || {});
    return response.status(201).json(createJourneyServiceBlueprintVersion({
      spaceId: space.id, actorUserId: user.id, blueprintId: String(request.params.blueprintId), ...input
    }));
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.get('/versions/:versionId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ version: readJourneyServiceBlueprintVersion({
      spaceId: space.id, actorUserId: user.id, versionId: String(request.params.versionId)
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.patch('/versions/:versionId/review', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedReviewState: z.enum(reviewStates), reviewState: z.enum(reviewStates) })
      .strict().parse(request.body || {});
    return response.json({ version: reviewJourneyServiceBlueprintVersion({
      spaceId: space.id, actorUserId: user.id, versionId: String(request.params.versionId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.get('/versions/:versionId/analysis', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ analysis: analysePersistedJourneyServiceBlueprint({
      spaceId: space.id, actorUserId: user.id, versionId: String(request.params.versionId)
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.get('/versions/:versionId/export.:format', (request, response) => {
  try {
    const { user, space } = context(request);
    const { versionId, format } = z.object({ versionId: token, format: z.enum(['json', 'csv']) })
      .strict().parse(request.params);
    const artifact = exportJourneyServiceBlueprintVersion({
      spaceId: space.id, actorUserId: user.id, versionId, format,
      requestId: typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : null
    });
    response.setHeader('Content-Type', artifact.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    response.setHeader('X-Content-SHA256', artifact.contentSha256);
    return response.send(artifact.bytes);
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.post('/comparisons', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ fromVersionId: token, toVersionId: token }).strict().parse(request.body || {});
    return response.status(201).json(comparePersistedJourneyServiceBlueprints({
      spaceId: space.id, actorUserId: user.id, ...input
    }));
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.get('/resources/catalogue', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeRetired: z.coerce.boolean().optional() }).strict().parse(request.query);
    return response.json({ resources: listJourneyBlueprintResources({
      spaceId: space.id, actorUserId: user.id, ...query
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.post('/resources/catalogue', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ kind: z.enum(resourceKinds), name: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(), ownerUserId: nullableToken }).strict().parse(request.body || {});
    return response.status(201).json({ resource: createJourneyBlueprintResource({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.patch('/resources/catalogue/:resourceId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: z.number().int().positive(), name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).optional(), lifecycle: z.enum(resourceLifecycles).optional(), ownerUserId: nullableToken })
      .strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'),
        { message: 'At least one resource change is required.' }).parse(request.body || {});
    return response.json({ resource: updateJourneyBlueprintResource({
      spaceId: space.id, actorUserId: user.id, resourceId: String(request.params.resourceId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyServiceBlueprintRouter.patch('/gaps/:gapId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ state: z.enum(['accepted', 'resolved', 'dismissed']) }).strict().parse(request.body || {});
    return response.json({ gap: reviewJourneyBlueprintGap({
      spaceId: space.id, actorUserId: user.id, gapId: String(request.params.gapId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});
