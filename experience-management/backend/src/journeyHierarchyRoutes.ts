import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { JourneyCollaborationError } from './journeyCollaboration.js';
import {
  assignJourneyTaxonomyTerm,
  calculateJourneyHierarchyHealthSnapshots,
  createJourneyHierarchyHealthPolicy,
  createJourneyHierarchyLink,
  createJourneyTaxonomyTerm,
  exportJourneyHierarchy,
  getJourneyHierarchyHealthSnapshot,
  getJourneyHierarchySettings,
  JourneyHierarchyRepositoryError,
  listJourneyHierarchyHealthPolicies,
  listJourneyHierarchyHealthSnapshots,
  listJourneyHierarchy,
  listJourneyTaxonomyTerms,
  persistedJourneyHierarchyBreadcrumbs,
  traversePersistedJourneyHierarchy,
  unassignJourneyTaxonomyTerm,
  updateJourneyHierarchyHealthPolicy,
  updateJourneyHierarchyLink,
  updateJourneyHierarchySettings,
  updateJourneyTaxonomyTerm
} from './journeyHierarchyRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const token = z.string().trim().min(1).max(128);
const nullableToken = z.union([token, z.null()]).optional();
const linkTypes = ['parent_child', 'stage_subjourney', 'variant', 'handoff', 'related'] as const;
const variantDimensions = ['persona', 'segment', 'product', 'geography', 'channel'] as const;
const reviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;
const lifecycles = ['active', 'retired'] as const;
const taxonomyKinds = ['product', 'geography', 'channel', 'segment', 'tag', 'business_unit'] as const;
const healthPolicySchema = z.object({
  version: token, ownWeight: z.number().finite().min(0).max(1), missingChild: z.enum(['exclude', 'unknown']),
  healthyAt: z.number().finite().min(0).max(100), watchAt: z.number().finite().min(0).max(100)
}).strict().refine((value) => value.watchAt <= value.healthyAt,
  { message: 'watchAt must be less than or equal to healthyAt.' });
const observationSchema = z.object({
  definitionId: token, score: z.number().finite().min(0).max(100).nullable(),
  observedAt: z.string().datetime({ offset: true }), sourceRevision: token
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
  if (error instanceof JourneyHierarchyRepositoryError || error instanceof SpaceError
    || error instanceof SubscriptionEntitlementError || error instanceof JourneyCollaborationError) {
    return response.status(error.status).json({
      error: error.message, code: error.code, details: 'details' in error ? error.details : {}
    });
  }
  console.error('Journey hierarchy request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({
    error: 'The journey hierarchy request could not be completed.', code: 'JOURNEY_HIERARCHY_INTERNAL_ERROR'
  });
}

export const journeyHierarchyRouter = express.Router();
journeyHierarchyRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

journeyHierarchyRouter.get('/settings', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ settings: getJourneyHierarchySettings({ spaceId: space.id, actorUserId: user.id }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.patch('/settings', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      expectedRevision: z.number().int().min(0), hierarchyEnabled: z.boolean().optional(),
      blueprintsEnabled: z.boolean().optional(), maximumDepth: z.number().int().min(1).max(32).optional(),
      maximumLinks: z.number().int().min(1).max(100_000).optional()
    }).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'),
      { message: 'At least one hierarchy setting change is required.' }).parse(request.body || {});
    return response.json({ settings: updateJourneyHierarchySettings({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeRetired: z.coerce.boolean().optional() }).strict().parse(request.query);
    return response.json(listJourneyHierarchy({ spaceId: space.id, actorUserId: user.id, ...query }));
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/export.:format', (request, response) => {
  try {
    const { user, space } = context(request);
    const { format } = z.object({ format: z.enum(['json', 'csv']) }).strict().parse(request.params);
    const artifact = exportJourneyHierarchy({
      spaceId: space.id, actorUserId: user.id, format,
      requestId: typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : null
    });
    response.setHeader('Content-Type', artifact.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    response.setHeader('X-Content-SHA256', artifact.contentSha256);
    return response.send(artifact.bytes);
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.post('/links', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      type: z.enum(linkTypes), fromDefinitionId: token, toDefinitionId: token,
      fromVersionId: nullableToken, toVersionId: nullableToken,
      fromStageKey: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
      toStageKey: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
      variantDimension: z.union([z.enum(variantDimensions), z.null()]).optional(),
      variantValueId: nullableToken, handoffOwnerUserId: nullableToken, handoffOwnerTeamId: nullableToken
    }).strict().parse(request.body || {});
    return response.status(201).json({ link: createJourneyHierarchyLink({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.patch('/links/:linkId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      expectedRevision: z.number().int().min(1), reviewState: z.enum(reviewStates).optional(),
      lifecycle: z.enum(lifecycles).optional()
    }).strict().refine((value) => value.reviewState !== undefined || value.lifecycle !== undefined,
      { message: 'At least one hierarchy link change is required.' }).parse(request.body || {});
    return response.json({ link: updateJourneyHierarchyLink({
      spaceId: space.id, actorUserId: user.id, linkId: String(request.params.linkId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/traversal/:definitionId', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({
      direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
      limit: z.coerce.number().int().min(1).max(500).optional()
    }).strict().parse(request.query);
    return response.json({ traversal: traversePersistedJourneyHierarchy({
      spaceId: space.id, actorUserId: user.id, startDefinitionId: String(request.params.definitionId),
      direction: query.direction, maximumDefinitions: query.limit
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/breadcrumbs/:definitionId', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(request.query);
    return response.json({ breadcrumbs: persistedJourneyHierarchyBreadcrumbs({
      spaceId: space.id, actorUserId: user.id, targetDefinitionId: String(request.params.definitionId),
      maximumTrails: query.limit
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/taxonomy', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeRetired: z.coerce.boolean().optional() }).strict().parse(request.query);
    return response.json({ terms: listJourneyTaxonomyTerms({ spaceId: space.id, actorUserId: user.id, ...query }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.post('/taxonomy', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ kind: z.enum(taxonomyKinds), name: z.string().trim().min(1).max(160), parentTermId: nullableToken })
      .strict().parse(request.body || {});
    return response.status(201).json({ term: createJourneyTaxonomyTerm({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.patch('/taxonomy/:termId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({
      expectedRevision: z.number().int().min(1), name: z.string().trim().min(1).max(160).optional(),
      parentTermId: z.union([token, z.null()]).optional(), lifecycle: z.enum(lifecycles).optional()
    }).strict().refine((value) => value.name !== undefined || value.parentTermId !== undefined || value.lifecycle !== undefined,
      { message: 'At least one taxonomy term change is required.' }).parse(request.body || {});
    return response.json({ term: updateJourneyTaxonomyTerm({
      spaceId: space.id, actorUserId: user.id, termId: String(request.params.termId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/health/policies', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ includeRetired: z.coerce.boolean().optional() }).strict().parse(request.query);
    return response.json({ policies: listJourneyHierarchyHealthPolicies({
      spaceId: space.id, actorUserId: user.id, ...query
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.post('/health/policies', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ id: token.optional(), name: z.string().trim().min(1).max(160),
      lifecycle: z.enum(['draft', 'active']).optional(), policy: healthPolicySchema }).strict().parse(request.body || {});
    return response.status(201).json({ policy: createJourneyHierarchyHealthPolicy({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.patch('/health/policies/:policyId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: z.number().int().min(1),
      name: z.string().trim().min(1).max(160).optional(), lifecycle: z.enum(['draft', 'active', 'retired']).optional(),
      policy: healthPolicySchema.optional() }).strict().refine(
      (value) => value.name !== undefined || value.lifecycle !== undefined || value.policy !== undefined,
      { message: 'At least one hierarchy health policy change is required.' }).parse(request.body || {});
    return response.json({ policy: updateJourneyHierarchyHealthPolicy({
      spaceId: space.id, actorUserId: user.id, policyId: String(request.params.policyId), ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.post('/health/snapshots', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ policyId: token, definitionId: token.optional(),
      observations: z.array(observationSchema).max(500) }).strict().parse(request.body || {});
    return response.status(201).json({ snapshots: calculateJourneyHierarchyHealthSnapshots({
      spaceId: space.id, actorUserId: user.id, ...input
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/health/snapshots', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ definitionId: token.optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .strict().parse(request.query);
    return response.json({ snapshots: listJourneyHierarchyHealthSnapshots({
      spaceId: space.id, actorUserId: user.id, ...query
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.get('/health/snapshots/:snapshotId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ snapshot: getJourneyHierarchyHealthSnapshot({
      spaceId: space.id, actorUserId: user.id, snapshotId: String(request.params.snapshotId)
    }) });
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.put('/journeys/:definitionId/taxonomy/:termId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(assignJourneyTaxonomyTerm({
      spaceId: space.id, actorUserId: user.id, definitionId: String(request.params.definitionId),
      termId: String(request.params.termId)
    }));
  } catch (error) { return sendError(response, error); }
});

journeyHierarchyRouter.delete('/journeys/:definitionId/taxonomy/:termId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(unassignJourneyTaxonomyTerm({
      spaceId: space.id, actorUserId: user.id, definitionId: String(request.params.definitionId),
      termId: String(request.params.termId)
    }));
  } catch (error) { return sendError(response, error); }
});
