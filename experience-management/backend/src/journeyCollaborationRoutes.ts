import express from 'express';
import { z } from 'zod';
import { currentSessionUser } from './auth.js';
import {
  assignJourneyRole, createJourneyComment, decideJourneyGovernanceReview, deleteJourneyComment,
  editJourneyComment, getJourneyCollaborationContext, JourneyCollaborationError,
  journeyCollaborationPlanState, listJourneyCollaborationActivity, listJourneyCollaborationNotifications,
  listJourneyCommentHistory, listJourneyComments, listJourneyGovernanceReviews, listJourneyRoleAssignments,
  listJourneyWatchers, publishJourneyGovernanceReview, requestJourneyGovernanceReview, revokeJourneyRole,
  setJourneyWatcher, transitionJourneyComment, updateJourneyCollaborationNotification,
  updateJourneyCollaborationSettings, withdrawJourneyGovernanceReview
} from './journeyCollaboration.js';
import {
  journeyCollaborationRoles, journeyCollaborationTargetTypes, journeyGovernanceTargetTypes
} from './journeyCollaborationSchema.js';
import { resolveRequestSpace, SpaceError } from './spaces.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import {
  createJourneyReadOnlyShare, journeyShareTargetTypes, listJourneyReadOnlyShares,
  resolveJourneyReadOnlyShare, revokeJourneyReadOnlyShare, rotateJourneyReadOnlyShare
} from './journeySharing.js';

const id = z.string().trim().min(1).max(128);
const revision = z.number().int().min(1);
const limit = z.coerce.number().int().min(1).max(100).optional();
const cursor = z.string().trim().min(1).max(1_000).optional();
const targetType = z.enum(journeyCollaborationTargetTypes);
const governanceTargetType = z.enum(journeyGovernanceTargetTypes);
const target = z.object({ targetType, targetId: id }).strict();
const targetQuery = z.object({ targetType, targetId: id, limit, cursor }).strict();
const governanceText = z.string().trim().min(3).max(2_000);

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

function mutationContext(request: express.Request) {
  const idempotencyKey = String(request.header('Idempotency-Key') || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 200) throw new JourneyCollaborationError(
    'A valid Idempotency-Key is required.', 400, 'JOURNEY_COLLABORATION_IDEMPOTENCY_KEY_REQUIRED');
  const suppliedRequestId = String(request.header('X-Request-Id') || '').trim();
  if (suppliedRequestId.length > 200) throw new JourneyCollaborationError(
    'X-Request-Id is too long.', 400, 'JOURNEY_COLLABORATION_REQUEST_ID_INVALID');
  return { idempotencyKey, requestId: suppliedRequestId || null };
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({
    error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues
  });
  if (error instanceof JourneyCollaborationError || error instanceof SpaceError
    || error instanceof SubscriptionEntitlementError) return response.status(error.status).json({
    error: error.message, code: error.code, details: 'details' in error ? error.details : {}
  });
  console.error('Journey collaboration request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The journey collaboration request could not be completed.',
    code: 'JOURNEY_COLLABORATION_INTERNAL_ERROR' });
}

export const journeyCollaborationRouter = express.Router();
journeyCollaborationRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); next();
});

journeyCollaborationRouter.get('/plan', (request, response) => { try {
  const { user, space } = context(request); getJourneyCollaborationContext({ spaceId: space.id, actorUserId: user.id });
  return response.json(journeyCollaborationPlanState(space.id));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/context', (request, response) => { try {
  const { user, space } = context(request);
  const query = z.object({ targetType: targetType.optional(), targetId: id.optional() }).strict()
    .refine((value) => Boolean(value.targetType) === Boolean(value.targetId), { message: 'Target type and ID must be supplied together.' })
    .parse(request.query);
  return response.json(getJourneyCollaborationContext({ spaceId: space.id, actorUserId: user.id,
    target: query.targetType && query.targetId ? { targetType: query.targetType, targetId: query.targetId } : undefined }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/settings', (request, response) => { try {
  const { user, space } = context(request); const result = getJourneyCollaborationContext({ spaceId: space.id, actorUserId: user.id });
  return response.json({ settings: result.plan.settings, plan: result.plan });
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.patch('/settings', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: z.number().int().min(0), enabled: z.boolean(), commentsEnabled: z.boolean(),
    sharingEnabled: z.boolean(), externalDownloadsEnabled: z.boolean(), commentRetentionDays: z.number().int().min(1).max(3650),
    viewRetentionDays: z.number().int().min(1).max(3650), maximumShareDays: z.number().int().min(1).max(365),
    securityReviewReference: z.string().trim().max(200).nullable().optional() }).strict().parse(request.body || {});
  return response.json(updateJourneyCollaborationSettings({ spaceId: space.id, actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/roles', (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ journeyDefinitionId: id.optional(),
    state: z.enum(['active', 'revoked']).optional(), limit, cursor }).strict().parse(request.query);
  return response.json(listJourneyRoleAssignments({ spaceId: space.id, actorUserId: user.id, ...query }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/roles', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ userId: id, role: z.enum(journeyCollaborationRoles), scopeType: z.enum(['space', 'journey']),
    journeyDefinitionId: id.nullable().optional() }).strict().parse(request.body || {});
  return response.status(201).json(assignJourneyRole({ spaceId: space.id, actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/roles/:assignmentId/revoke', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision, reason: z.string().trim().min(3).max(500) }).strict().parse(request.body || {});
  return response.json(revokeJourneyRole({ spaceId: space.id, actorUserId: user.id,
    assignmentId: id.parse(request.params.assignmentId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/comments', (request, response) => { try {
  const { user, space } = context(request); const query = targetQuery.extend({
    state: z.enum(['active', 'resolved', 'deleted']).optional() }).strict().parse(request.query);
  return response.json(listJourneyComments({ spaceId: space.id, actorUserId: user.id,
    target: { targetType: query.targetType, targetId: query.targetId }, state: query.state, limit: query.limit, cursor: query.cursor }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/comments', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ target, parentCommentId: id.nullable().optional(), body: z.unknown(),
    mentionUserIds: z.array(id).max(50).optional() }).strict().parse(request.body || {});
  return response.status(201).json(createJourneyComment({ spaceId: space.id, actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.patch('/comments/:commentId', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision, body: z.unknown(), mentionUserIds: z.array(id).max(50).optional(),
    editReason: z.string().trim().min(3).max(500) }).strict().parse(request.body || {});
  return response.json(editJourneyComment({ spaceId: space.id, actorUserId: user.id,
    commentId: id.parse(request.params.commentId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.delete('/comments/:commentId', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision, reason: z.string().trim().min(3).max(500) }).strict().parse(request.body || {});
  return response.json(deleteJourneyComment({ spaceId: space.id, actorUserId: user.id,
    commentId: id.parse(request.params.commentId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

for (const action of ['resolve', 'reopen'] as const) journeyCollaborationRouter.post(`/comments/:commentId/${action}`, (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
  return response.json(transitionJourneyComment({ spaceId: space.id, actorUserId: user.id,
    commentId: id.parse(request.params.commentId), action, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/comments/:commentId/history', (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ limit, cursor }).strict().parse(request.query);
  return response.json(listJourneyCommentHistory({ spaceId: space.id, actorUserId: user.id,
    commentId: id.parse(request.params.commentId), ...query }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/watchers', (request, response) => { try {
  const { user, space } = context(request); const query = targetQuery.parse(request.query);
  return response.json(listJourneyWatchers({ spaceId: space.id, actorUserId: user.id,
    target: { targetType: query.targetType, targetId: query.targetId }, limit: query.limit, cursor: query.cursor }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.put('/watchers', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ target, state: z.enum(['watching', 'muted']) }).strict().parse(request.body || {});
  return response.json(setJourneyWatcher({ spaceId: space.id, actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/notifications', (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ state: z.enum(['unread', 'read', 'dismissed']).optional(),
    limit, cursor }).strict().parse(request.query);
  return response.json(listJourneyCollaborationNotifications({ spaceId: space.id, actorUserId: user.id, ...query }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.patch('/notifications/:notificationId', (request, response) => { try {
  const { user, space } = context(request); const input = z.object({ expectedRevision: revision,
    state: z.enum(['read', 'dismissed']) }).strict().parse(request.body || {});
  return response.json(updateJourneyCollaborationNotification({ spaceId: space.id, actorUserId: user.id,
    notificationId: id.parse(request.params.notificationId), ...input }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/governance/reviews', (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ targetType: governanceTargetType.optional(), targetId: id.optional(),
    state: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'published']).optional(), limit, cursor }).strict()
    .refine((value) => Boolean(value.targetType) === Boolean(value.targetId), { message: 'Target type and ID must be supplied together.' }).parse(request.query);
  return response.json(listJourneyGovernanceReviews({ spaceId: space.id, actorUserId: user.id,
    target: query.targetType && query.targetId ? { targetType: query.targetType, targetId: query.targetId } : undefined,
    state: query.state, limit: query.limit, cursor: query.cursor }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/governance/reviews', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ target: z.object({ targetType: governanceTargetType, targetId: id }).strict(),
    summary: governanceText, reason: governanceText, dueAt: z.string().datetime({ offset: true }).nullable().optional() }).strict().parse(request.body || {});
  return response.status(201).json(requestJourneyGovernanceReview({ spaceId: space.id, actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/governance/reviews/:reviewId/decision', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision, decision: z.enum(['approve', 'reject']),
    summary: governanceText, reason: governanceText }).strict().parse(request.body || {});
  return response.json(decideJourneyGovernanceReview({ spaceId: space.id, actorUserId: user.id,
    reviewId: id.parse(request.params.reviewId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

for (const action of ['withdraw', 'publish'] as const) journeyCollaborationRouter.post(`/governance/reviews/:reviewId/${action}`, (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision, reason: governanceText }).strict().parse(request.body || {});
  const common = { spaceId: space.id, actorUserId: user.id, reviewId: id.parse(request.params.reviewId), ...input, ...meta };
  return response.json(action === 'withdraw' ? withdrawJourneyGovernanceReview(common) : publishJourneyGovernanceReview(common));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/activity', (request, response) => { try {
  const { user, space } = context(request); const query = z.object({ targetType: targetType.optional(), targetId: id.optional(), limit, cursor }).strict()
    .refine((value) => Boolean(value.targetType) === Boolean(value.targetId), { message: 'Target type and ID must be supplied together.' }).parse(request.query);
  return response.json(listJourneyCollaborationActivity({ spaceId: space.id, actorUserId: user.id,
    target: query.targetType && query.targetId ? { targetType: query.targetType, targetId: query.targetId } : undefined,
    limit: query.limit, cursor: query.cursor }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.get('/shares', (request, response) => { try {
  const { user, space } = context(request);
  const query = z.object({ state: z.enum(['active', 'revoked']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional() }).strict().parse(request.query);
  return response.json(listJourneyReadOnlyShares({ spaceId: space.id, actorUserId: user.id, ...query }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/shares', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ targetType: z.enum(journeyShareTargetTypes), targetId: id,
    expiresAt: z.string().datetime({ offset: true }), allowExport: z.boolean().default(false),
    allowDownload: z.boolean().default(false) }).strict().parse(request.body || {});
  return response.status(201).json(createJourneyReadOnlyShare({ spaceId: space.id,
    actorUserId: user.id, ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/shares/:shareId/rotate', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision }).strict().parse(request.body || {});
  return response.json(rotateJourneyReadOnlyShare({ spaceId: space.id, actorUserId: user.id,
    shareId: id.parse(request.params.shareId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

journeyCollaborationRouter.post('/shares/:shareId/revoke', (request, response) => { try {
  const { user, space } = context(request); const meta = mutationContext(request);
  const input = z.object({ expectedRevision: revision,
    reason: z.string().trim().min(8).max(500) }).strict().parse(request.body || {});
  return response.json(revokeJourneyReadOnlyShare({ spaceId: space.id, actorUserId: user.id,
    shareId: id.parse(request.params.shareId), ...input, ...meta }));
} catch (error) { return sendError(response, error); } });

export const journeyPublicShareRouter = express.Router();
journeyPublicShareRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
journeyPublicShareRouter.get('/:token', (request, response) => { try {
  const input = z.object({ action: z.enum(['view', 'download']).default('view') }).strict().parse(request.query);
  const requesterKey = [request.ip || request.socket.remoteAddress || 'unknown',
    request.header('user-agent') || '', request.header('accept-language') || ''].join('\u0000');
  const result = resolveJourneyReadOnlyShare({ token: String(request.params.token || ''),
    requesterKey, action: input.action });
  if (input.action === 'download') response.setHeader('Content-Disposition',
    'attachment; filename="journey-share.json"');
  return response.json(result);
} catch (error) { return sendError(response, error); } });
