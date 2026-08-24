import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { createAdmittedAiJob } from './aiJobAdmission.js';
import { db } from './database.js';
import { publishEvent } from './events.js';
import {
  applyJourneySuggestionRun, attachJourneySuggestionJob, createJourneySuggestionRun,
  getJourneySuggestionRun, JourneySuggestionError, listJourneySuggestionAudit,
  listJourneySuggestionEvidence, listJourneySuggestionRuns, reviewJourneySuggestionChange
} from './journeySuggestions.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError, type SpaceContext } from './spaces.js';
import {
  assertCanQueueAiAction, assertSubscriptionFeature, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';

export const journeySuggestionRouter = express.Router();
export const journeyMapSuggestionRouter = express.Router({ mergeParams: true });

const createBody = z.object({
  definitionId: z.string().uuid().optional(),
  focus: z.string().trim().max(2_000).optional(),
  evidenceLinkIds: z.array(z.string().uuid()).max(20).optional()
}).strict();
const reviewBody = z.object({
  expectedRunRevision: z.number().int().min(1),
  decision: z.enum(['accepted', 'rejected']),
  reason: z.string().trim().min(3).max(2_000)
}).strict();
const applyBody = z.object({
  expectedRunRevision: z.number().int().min(1),
  expectedDefinitionRevision: z.number().int().min(1)
}).strict();

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  const space = resolveRequestSpace(request, user.id);
  assertSubscriptionFeature(space.id, 'journeyDesign');
  assertSubscriptionFeature(space.id, 'journeyAi');
  return { user, space };
}

function requireEditor(space: SpaceContext) {
  if (!spaceRoleOrIdpPermission(space, 'journeys.edit')) throw new JourneySuggestionError(
    'You do not have permission to review AI journey suggestions in this space.', 403,
    'JOURNEY_SUGGESTION_FORBIDDEN');
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed', details: error.issues });
  if (error instanceof JourneySuggestionError) return response.status(error.status)
    .json({ error: error.message, code: error.code, details: error.details });
  if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof SubscriptionEntitlementError) return response.status(error.status)
    .json({ error: error.message, code: error.code, details: error.details });
  return response.status(500).json({ error: 'Journey suggestion request failed.' });
}

function guarded(handler: (request: express.Request, response: express.Response) => unknown) {
  return (request: express.Request, response: express.Response) => {
    try { return handler(request, response); } catch (error) { return sendError(response, error); }
  };
}

async function startRunner() {
  const { aiJobRunner } = await import('./aiJobs.js');
  await aiJobRunner.pump();
}

function queueSuggestion(request: express.Request, response: express.Response, definitionId: string) {
  const parsed = createBody.parse({ ...(request.body || {}), definitionId });
  const { user, space } = context(request);
  requireEditor(space);
  const queued = db.transaction(() => {
    const created = createJourneySuggestionRun({ spaceId: space.id, definitionId,
      userId: user.id, focus: parsed.focus, evidenceLinkIds: parsed.evidenceLinkIds });
    if (!created.created) return { created: false, detail: created.run, job: null };
    assertCanQueueAiAction(space.id);
    const job = createAdmittedAiJob('journey.optimize', { suggestionRunId: created.run.run.id },
      space.id, null, null, user.id);
    attachJourneySuggestionJob(space.id, created.run.run.id, job.id);
    return { created: true, detail: getJourneySuggestionRun(space.id, created.run.run.id, user.id), job };
  })();
  if (queued.job) {
    publishEvent('ai-job', queued.job, space.id);
    void startRunner();
  }
  const jobId = queued.job?.id || queued.detail.run.aiJobId;
  return response.status(202).json({ suggestion: queued.detail, created: queued.created,
    jobId, statusUrl: jobId ? `/api/ai/jobs/${jobId}` : null });
}

journeySuggestionRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

journeySuggestionRouter.post('/', guarded((request, response) => {
  const parsed = createBody.parse(request.body || {});
  if (!parsed.definitionId) throw new JourneySuggestionError('A journey definition is required.', 400,
    'JOURNEY_SUGGESTION_DEFINITION_REQUIRED');
  return queueSuggestion(request, response, parsed.definitionId);
}));

journeySuggestionRouter.get('/', guarded((request, response) => {
  const query = z.object({ definitionId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(50).optional() })
    .parse(request.query);
  const { user, space } = context(request);
  return response.json({ suggestions: listJourneySuggestionRuns(space.id, query.definitionId, user.id, query.limit) });
}));

journeySuggestionRouter.get('/:runId', guarded((request, response) => {
  const runId = z.string().uuid().parse(request.params.runId);
  const { user, space } = context(request);
  return response.json(getJourneySuggestionRun(space.id, runId, user.id));
}));

journeySuggestionRouter.get('/:runId/audit', guarded((request, response) => {
  const runId = z.string().uuid().parse(request.params.runId);
  const { space } = context(request);
  return response.json({ audit: listJourneySuggestionAudit(space.id, runId) });
}));

journeySuggestionRouter.post('/:runId/changes/:changeId/decision', guarded((request, response) => {
  const params = z.object({ runId: z.string().uuid(), changeId: z.string().uuid() }).parse(request.params);
  const body = reviewBody.parse(request.body || {});
  const { user, space } = context(request);
  requireEditor(space);
  return response.json(reviewJourneySuggestionChange({ spaceId: space.id, runId: params.runId,
    changeId: params.changeId, expectedRunRevision: body.expectedRunRevision,
    decision: body.decision, reason: body.reason, actorUserId: user.id }));
}));

journeySuggestionRouter.post('/:runId/apply', guarded((request, response) => {
  const runId = z.string().uuid().parse(request.params.runId);
  const body = applyBody.parse(request.body || {});
  const { user, space } = context(request);
  requireEditor(space);
  const result = applyJourneySuggestionRun({ spaceId: space.id, runId,
    expectedRunRevision: body.expectedRunRevision, expectedDefinitionRevision: body.expectedDefinitionRevision,
    actorUserId: user.id });
  publishEvent('data-changed', { reason: 'journey.ai_suggestion_reviewed', runId,
    definitionId: result.suggestion.run.definitionId, outcome: result.outcome }, space.id);
  return response.json(result);
}));

journeyMapSuggestionRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});
journeyMapSuggestionRouter.post('/', guarded((request, response) => queueSuggestion(
  request, response, z.string().uuid().parse(request.params.definitionId)
)));
journeyMapSuggestionRouter.get('/', guarded((request, response) => {
  const definitionId = z.string().uuid().parse(request.params.definitionId);
  const limit = z.coerce.number().int().min(1).max(50).optional().parse(request.query.limit);
  const { user, space } = context(request);
  return response.json({ suggestions: listJourneySuggestionRuns(space.id, definitionId, user.id, limit) });
}));
journeyMapSuggestionRouter.get('/evidence', guarded((request, response) => {
  const definitionId = z.string().uuid().parse(request.params.definitionId);
  const limit = z.coerce.number().int().min(1).max(200).optional().parse(request.query.limit) || 100;
  const { user, space } = context(request);
  return response.json({ evidence: listJourneySuggestionEvidence(space.id, definitionId, user.id, limit) });
}));
