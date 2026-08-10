import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { JourneyCollaborationError } from './journeyCollaboration.js';
import {
  createGovernedStageInferenceRun, JourneyStageInferenceGovernanceError,
  governedStageInferencePermissions,
  listGovernedStageInferenceRecommendations, listGovernedStageInferenceRuns,
  previewGovernedStageInferenceRecommendations, reviewGovernedStageInferenceRecommendation
} from './journeyStageInferenceGovernanceRepository.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

export const journeyStageInferenceGovernanceRouter = express.Router();
journeyStageInferenceGovernanceRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); next(); });

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const scope = z.object({ journeyDefinitionId: id, subjectScope: z.enum(['anonymous_only', 'known_profiles']).optional(),
  baselineFrom: z.string().datetime({ offset: true }), baselineTo: z.string().datetime({ offset: true }),
  currentFrom: z.string().datetime({ offset: true }), currentTo: z.string().datetime({ offset: true }),
  baselineAsOf: z.string().datetime({ offset: true }).optional(), currentAsOf: z.string().datetime({ offset: true }).optional(),
  minimumSampleSize: z.coerce.number().int().min(3).max(1_000).default(20),
  minimumRecurrence: z.coerce.number().int().min(3).max(1_000).default(10),
  minimumCoverage: z.coerce.number().min(0.01).max(1).default(0.7),
  minimumWinningMargin: z.coerce.number().min(0).max(1).default(0.2) }).strict();

function context(request: express.Request) {
  const user = currentSessionUser(request); if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}
function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Invalid stage-inference request.',
    code: 'JOURNEY_STAGE_INFERENCE_REQUEST_INVALID', details: error.flatten() });
  if (error instanceof JourneyStageInferenceGovernanceError || error instanceof JourneyCollaborationError
    || error instanceof SubscriptionEntitlementError || error instanceof SpaceError) {
    const details = (error as { details?: unknown }).details;
    return response.status(error.status).json({ error: error.message, code: error.code, ...(details ? { details } : {}) });
  }
  console.error(error); return response.status(500).json({ error: 'Stage-inference governance failed.', code: 'JOURNEY_STAGE_INFERENCE_INTERNAL' });
}

journeyStageInferenceGovernanceRouter.get('/preview', (request, response) => { try {
  const { user, space } = context(request); const query = scope.parse(request.query);
  return response.json({ result: previewGovernedStageInferenceRecommendations({ spaceId: space.id, actorUserId: user.id, ...query }) });
} catch (error) { return sendError(response, error); } });

journeyStageInferenceGovernanceRouter.post('/runs', (request, response) => { try {
  const { user, space } = context(request); const body = scope.parse(request.body || {});
  const result = createGovernedStageInferenceRun({ spaceId: space.id, actorUserId: user.id, ...body });
  return response.status(result.replayed ? 200 : 201).json(result);
} catch (error) { return sendError(response, error); } });

for (const resource of ['runs', 'recommendations'] as const) journeyStageInferenceGovernanceRouter.get(`/${resource}`, (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ journeyDefinitionId: id }).strict().parse(request.query);
  return response.json({ [resource]: resource === 'runs'
    ? listGovernedStageInferenceRuns({ spaceId: space.id, actorUserId: user.id, ...query })
    : listGovernedStageInferenceRecommendations({ spaceId: space.id, actorUserId: user.id, ...query }),
    ...(resource === 'recommendations' ? { permissions: governedStageInferencePermissions({ spaceId: space.id,
      actorUserId: user.id, ...query }) } : {}) });
} catch (error) { return sendError(response, error); } });

journeyStageInferenceGovernanceRouter.post('/recommendations/:recommendationId/review', (request, response) => { try {
  const { user, space } = context(request); const body = z.object({ expectedRevision: z.number().int().min(1),
    action: z.enum(['submit_for_review', 'approve', 'reject', 'retire']), reason: z.string().trim().min(3).max(2_000) }).strict()
    .parse(request.body || {});
  return response.json({ recommendation: reviewGovernedStageInferenceRecommendation({ spaceId: space.id,
    actorUserId: user.id, recommendationId: id.parse(request.params.recommendationId), ...body }) });
} catch (error) { return sendError(response, error); } });
