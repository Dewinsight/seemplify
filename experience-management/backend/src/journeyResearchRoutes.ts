import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import { evidenceSourceTypes } from './journeyDomain.js';
import { JourneyEvidenceSourceError } from './journeyEvidenceSources.js';
import {
  applyLatestJourneyResearchSnapshot, catalogueJourneyResearchSource, createJourneyResearchAssessment,
  createJourneyResearchGap, createJourneyResearchIntake, createJourneyResearchLink, createJourneyResearchMonitor,
  getJourneyResearchGap, getJourneyResearchLink, getJourneyResearchSnapshot, getJourneyResearchSource,
  journeyResearchInbox, JourneyResearchError, listJourneyResearchAudit, listJourneyResearchCatalogue,
  listJourneyResearchGaps, listJourneyResearchIntakes, listJourneyResearchLinks, listJourneyResearchMonitors,
  listJourneyResearchNotifications, listJourneyResearchRefreshRuns, queueJourneyResearchRefresh,
  updateJourneyResearchGap, updateJourneyResearchMonitor, updateJourneyResearchNotification
} from './journeyResearchHub.js';
import { KnowledgeError } from './knowledgeRepository.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';

export const journeyResearchRouter = express.Router();

journeyResearchRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

function editor(request: express.Request) {
  const resolved = context(request);
  if (!spaceRoleOrIdpPermission(resolved.space, 'journeys.edit')) throw new JourneyResearchError(
    'You do not have permission to manage journey research.', 403, 'JOURNEY_RESEARCH_FORBIDDEN');
  return resolved;
}

function idempotencyKey(request: express.Request, bodyKey?: string | null) {
  const value = String(request.header('Idempotency-Key') || bodyKey || '').trim();
  if (!value || value.length > 200) throw new JourneyResearchError(
    'A valid Idempotency-Key header is required.', 400, 'JOURNEY_RESEARCH_IDEMPOTENCY_KEY_REQUIRED');
  return value;
}

function sendError(response: express.Response, value: unknown) {
  if (value instanceof z.ZodError) return response.status(400).json({
    error: 'Journey research validation failed.', code: 'JOURNEY_RESEARCH_INPUT_INVALID', details: value.issues
  });
  if (value instanceof JourneyResearchError || value instanceof JourneyEvidenceSourceError
      || value instanceof KnowledgeError || value instanceof SpaceError || value instanceof SubscriptionEntitlementError) {
    return response.status(value.status).json({ error: value.message, code: value.code });
  }
  return response.status(500).json({ error: 'Journey research request failed.', code: 'JOURNEY_RESEARCH_UNAVAILABLE' });
}

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
});
const targetType = z.enum(['definition', 'stage', 'card', 'persona']);
const sourceType = z.enum(evidenceSourceTypes);
const id = z.string().trim().min(1).max(128);

journeyResearchRouter.get('/catalogue', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ query: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(50).default(25),
      cursor: z.string().trim().max(500).optional() }).parse(request.query);
    return response.json(listJourneyResearchCatalogue({ spaceId: space.id, userId: user.id, ...query }));
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/inbox', (request, response) => {
  try {
    const { user, space } = context(request); const query = page.parse(request.query);
    return response.json(journeyResearchInbox({ spaceId: space.id, userId: user.id, ...query }));
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/sources', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ sourceType, sourceRef: z.string().trim().min(1).max(400),
      retentionDays: z.number().int().min(1).max(3650).optional(), idempotencyKey: z.string().trim().max(200).optional() }).strict()
      .parse(request.body || {});
    const result = catalogueJourneyResearchSource({ spaceId: space.id, userId: user.id, ...body,
      idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.created ? 201 : 200).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/sources/:sourceId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(getJourneyResearchSource({ spaceId: space.id, userId: user.id, sourceId: id.parse(request.params.sourceId) }));
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/snapshots/:snapshotId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({ snapshot: getJourneyResearchSnapshot({ spaceId: space.id, userId: user.id,
      snapshotId: id.parse(request.params.snapshotId) }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/links', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ targetType: targetType.optional(), targetId: id.optional(), ...page.shape }).superRefine((value, issue) => {
      if (Boolean(value.targetType) !== Boolean(value.targetId)) issue.addIssue({ code: 'custom',
        message: 'targetType and targetId must be supplied together.' });
    }).parse(request.query);
    return response.json({ links: listJourneyResearchLinks({ spaceId: space.id, userId: user.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/links', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ sourceId: id, targetType, targetId: id,
      idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyResearchLink({ spaceId: space.id, userId: user.id, ...body,
      idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/links/:linkId', (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(getJourneyResearchLink({ spaceId: space.id, userId: user.id, linkId: id.parse(request.params.linkId) }));
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/links/:linkId/apply-latest-snapshot', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ expectedRevision: z.number().int().min(1) }).strict().parse(request.body || {});
    return response.json({ link: applyLatestJourneyResearchSnapshot({ spaceId: space.id, userId: user.id,
      linkId: id.parse(request.params.linkId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/links/:linkId/assessments', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({
      expectedRevision: z.number().int().min(1), relationship: z.enum(['supports', 'contradicts', 'neutral']),
      classification: z.enum(['hypothesis', 'anecdotal', 'supported', 'strongly_supported', 'contradicted', 'stale', 'invalidated']),
      confidence: z.number().min(0).max(1), freshnessDays: z.number().int().min(1).max(3650).nullable().optional(),
      reason: z.string().trim().max(4096).optional(), method: z.enum(['human_review', 'imported_review']).optional()
    }).strict().parse(request.body || {});
    return response.status(201).json(createJourneyResearchAssessment({ spaceId: space.id, userId: user.id,
      linkId: id.parse(request.params.linkId), ...body }));
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/gaps', (request, response) => {
  try {
    const { space } = context(request);
    const query = z.object({ status: z.enum(['open', 'planned', 'in_progress', 'resolved', 'dismissed']).optional(),
      ...page.shape }).parse(request.query);
    return response.json({ gaps: listJourneyResearchGaps({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/gaps', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ targetType, targetId: id, title: z.string().trim().min(1).max(800),
      description: z.string().trim().max(8192).optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      ownerUserId: id.nullable().optional(), dueAt: z.string().datetime({ offset: true }).nullable().optional(),
      idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyResearchGap({ spaceId: space.id, userId: user.id, ...body,
      idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/gaps/:gapId', (request, response) => {
  try {
    const { space } = context(request);
    return response.json({ gap: getJourneyResearchGap({ spaceId: space.id, gapId: id.parse(request.params.gapId) }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.patch('/gaps/:gapId', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ expectedRevision: z.number().int().min(1),
      status: z.enum(['open', 'planned', 'in_progress', 'resolved', 'dismissed']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(), ownerUserId: id.nullable().optional(),
      resolutionLinkId: id.nullable().optional(), dueAt: z.string().datetime({ offset: true }).nullable().optional()
    }).strict().parse(request.body || {});
    return response.json({ gap: updateJourneyResearchGap({ spaceId: space.id, userId: user.id,
      gapId: id.parse(request.params.gapId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/intakes', (request, response) => {
  try {
    const { space } = context(request); const query = page.parse(request.query);
    return response.json({ intakes: listJourneyResearchIntakes({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/intakes', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ knowledgeBaseId: id, kind: z.enum(['interview', 'observation', 'research_note']),
      method: z.string().trim().min(1).max(120), markdown: z.string().trim().min(1).max(1_000_000),
      conductedAt: z.string().datetime({ offset: true }).nullable().optional(), population: z.string().trim().max(800).optional(),
      tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(), consentBasis: z.enum(['documented', 'not_required']),
      retentionExpiresAt: z.string().datetime({ offset: true }), idempotencyKey: z.string().trim().max(200).optional()
    }).strict().parse(request.body || {});
    const result = createJourneyResearchIntake({ spaceId: space.id, userId: user.id, ...body,
      idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/monitors', (request, response) => {
  try {
    const { space } = context(request); const query = page.parse(request.query);
    return response.json({ monitors: listJourneyResearchMonitors({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/monitors', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ sourceId: id, intervalSeconds: z.number().int().min(300).max(2_592_000),
      idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = createJourneyResearchMonitor({ spaceId: space.id, userId: user.id, ...body,
      idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.patch('/monitors/:monitorId', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ expectedRevision: z.number().int().min(1), state: z.enum(['active', 'paused']).optional(),
      intervalSeconds: z.number().int().min(300).max(2_592_000).optional() }).strict().parse(request.body || {});
    return response.json({ monitor: updateJourneyResearchMonitor({ spaceId: space.id, userId: user.id,
      monitorId: id.parse(request.params.monitorId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/refresh-runs', (request, response) => {
  try {
    const { space } = context(request); const query = page.parse(request.query);
    return response.json({ runs: listJourneyResearchRefreshRuns({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.post('/refresh-runs', (request, response) => {
  try {
    const { user, space } = editor(request);
    const body = z.object({ sourceId: id, idempotencyKey: z.string().trim().max(200).optional() }).strict().parse(request.body || {});
    const result = queueJourneyResearchRefresh({ spaceId: space.id, sourceId: body.sourceId,
      requestedByUserId: user.id, trigger: 'manual', idempotencyKey: idempotencyKey(request, body.idempotencyKey) });
    return response.status(result.replayed ? 200 : 202).json(result);
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/notifications', (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z.object({ state: z.enum(['unread', 'read', 'dismissed']).optional(), ...page.shape }).parse(request.query);
    return response.json({ notifications: listJourneyResearchNotifications({ spaceId: space.id, userId: user.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.patch('/notifications/:notificationId', (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z.object({ expectedRevision: z.number().int().min(1), state: z.enum(['read', 'dismissed']) }).strict()
      .parse(request.body || {});
    return response.json({ notification: updateJourneyResearchNotification({ spaceId: space.id, userId: user.id,
      notificationId: id.parse(request.params.notificationId), ...body }) });
  } catch (value) { return sendError(response, value); }
});

journeyResearchRouter.get('/audit', (request, response) => {
  try {
    const { space } = context(request); const query = page.parse(request.query);
    return response.json({ events: listJourneyResearchAudit({ spaceId: space.id, ...query }) });
  } catch (value) { return sendError(response, value); }
});
