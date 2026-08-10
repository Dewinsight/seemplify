import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { JourneyCollaborationError } from './journeyCollaboration.js';
import {
  createJourneyWorkspaceSavedView,
  JourneyWorkspaceSavedViewError,
  listJourneyWorkspaceSavedViews,
  retireJourneyWorkspaceSavedView,
  reviseJourneyWorkspaceSavedView,
  setJourneyWorkspaceDefaultView
} from './journeyWorkspaceSavedViews.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

const surface = z.enum(['hierarchy','service_blueprint']);
const audience = z.enum(['internal','executive','research','delivery','external']);
const id = z.string().trim().min(1).max(128);
const hierarchyConfiguration = z.object({
  version: z.literal(1), includeRetired: z.boolean(), rootDefinitionId: id.nullable(),
  direction: z.enum(['upstream','downstream','both']),
  taxonomyKinds: z.array(z.enum(['product','geography','channel','segment','tag','business_unit'])).max(6),
  reviewStates: z.array(z.enum(['draft','in_review','approved','changes_requested'])).max(4),
  lifecycles: z.array(z.enum(['active','retired'])).max(2)
}).strict();
const blueprintConfiguration = z.object({
  version: z.literal(1), blueprintId: id.nullable(), versionMode: z.enum(['current','future','comparison']),
  selectedSection: z.enum(['design','analysis','history','measurements']),
  lifecycles: z.array(z.enum(['draft','in_review','approved','retired'])).max(4)
}).strict();
const configuration = z.union([hierarchyConfiguration, blueprintConfiguration]);

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}
function idempotencyKey(request: express.Request) {
  return z.string().trim().min(8).max(200).parse(request.header('Idempotency-Key'));
}
function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({
    error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues
  });
  if (error instanceof JourneyWorkspaceSavedViewError || error instanceof SpaceError
    || error instanceof SubscriptionEntitlementError || error instanceof JourneyCollaborationError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('Journey workspace saved-view request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The saved-view request could not be completed.',
    code: 'JOURNEY_WORKSPACE_VIEW_INTERNAL_ERROR' });
}

export const journeyWorkspaceSavedViewRouter = express.Router();
journeyWorkspaceSavedViewRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});

journeyWorkspaceSavedViewRouter.get('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ surface, includeRetired: z.coerce.boolean().optional() }).strict().parse(request.query);
    return response.json(listJourneyWorkspaceSavedViews({ spaceId: space.id, actorUserId: user.id, ...query }));
  } catch (error) { return sendError(response, error); }
});

journeyWorkspaceSavedViewRouter.post('/', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ surface, audience, name: z.string().trim().min(1).max(160),
      configuration, makeDefault: z.boolean().optional(), expectedPreferenceRevision: z.number().int().nonnegative().optional() })
      .strict().superRefine((value, context) => {
        if (value.makeDefault && value.expectedPreferenceRevision === undefined) context.addIssue({
          code: z.ZodIssueCode.custom, path: ['expectedPreferenceRevision'],
          message: 'expectedPreferenceRevision is required when makeDefault is true.'
        });
      }).parse(request.body || {});
    return response.status(201).json(createJourneyWorkspaceSavedView({ spaceId: space.id, actorUserId: user.id,
      ...input, idempotencyKey: idempotencyKey(request) }));
  } catch (error) { return sendError(response, error); }
});

journeyWorkspaceSavedViewRouter.patch('/:viewId', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: z.number().int().positive(), audience,
      name: z.string().trim().min(1).max(160), configuration }).strict().parse(request.body || {});
    return response.json(reviseJourneyWorkspaceSavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: id.parse(request.params.viewId), ...input, idempotencyKey: idempotencyKey(request) }));
  } catch (error) { return sendError(response, error); }
});

journeyWorkspaceSavedViewRouter.post('/:viewId/retire', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(request.body || {});
    return response.json(retireJourneyWorkspaceSavedView({ spaceId: space.id, actorUserId: user.id,
      viewId: id.parse(request.params.viewId), ...input, idempotencyKey: idempotencyKey(request) }));
  } catch (error) { return sendError(response, error); }
});

journeyWorkspaceSavedViewRouter.put('/default/:surface', (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z.object({ viewId: id.nullable(), expectedRevision: z.number().int().nonnegative() })
      .strict().parse(request.body || {});
    return response.json(setJourneyWorkspaceDefaultView({ spaceId: space.id, actorUserId: user.id,
      surface: surface.parse(request.params.surface), ...input, idempotencyKey: idempotencyKey(request) }));
  } catch (error) { return sendError(response, error); }
});
