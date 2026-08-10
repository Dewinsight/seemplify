import { z } from 'zod';
import { api, json } from '@/lib/api';

export const targetTypes = ['journey_map', 'journey_stage', 'journey_card', 'persona', 'portfolio_item', 'recommendation'] as const;
export const governanceTargetTypes = ['journey_map', 'persona', 'portfolio_item', 'recommendation'] as const;
export const collaborationRoles = ['viewer', 'contributor', 'editor', 'approver', 'manager', 'administrator'] as const;
export type CollaborationTargetType = typeof targetTypes[number];
export type CollaborationRole = typeof collaborationRoles[number];
export type TargetRef = { targetType: CollaborationTargetType; targetId: string };

const actor = z.object({ id: z.string(), name: z.string() }).strict();
const settings = z.object({ enabled: z.boolean(), commentsEnabled: z.boolean(), sharingEnabled: z.boolean(),
  externalDownloadsEnabled: z.boolean(), commentRetentionDays: z.number(), viewRetentionDays: z.number(),
  maximumShareDays: z.number(), securityReviewReference: z.string().nullable(), securityReviewedAt: z.string().nullable(),
  revision: z.number(), updatedAt: z.string().nullable() }).strict();
const plan = z.object({ enabledByPlan: z.boolean(), limits: z.object({ collaborators: z.number(), shares: z.number(), views: z.number() }).strict(),
  settings, readOnly: z.boolean() }).strict();
const resolvedTarget = z.object({ targetType: z.enum(targetTypes), targetId: z.string(), title: z.string(), revision: z.number(),
  checksum: z.string(), journeyDefinitionId: z.string().nullable() }).strict();
export const contextSchema = z.object({ role: z.enum(collaborationRoles), roleSource: z.string(), readOnly: z.boolean(),
  capabilities: z.array(z.string()), target: resolvedTarget.nullable(), plan,
  limits: z.object({ commentCharacters: z.number(), commentBodyBytes: z.number(), mentionsPerComment: z.number(),
    threadReplies: z.number(), viewNameCharacters: z.number(), viewConfigurationBytes: z.number(), viewFilterValues: z.number(),
    shareSnapshotBytes: z.number(), shareTokenBytes: z.number(), shareRequestsPerMinute: z.number(), pageSize: z.number(),
    commentRetentionDays: z.object({ minimum: z.number(), maximum: z.number() }).strict(),
    viewRetentionDays: z.object({ minimum: z.number(), maximum: z.number() }).strict(),
    maximumShareDays: z.object({ minimum: z.number(), maximum: z.number() }).strict() }).strict() }).strict();
export type CollaborationContext = z.infer<typeof contextSchema>;

export const commentSchema = z.object({ id: z.string(), targetType: z.enum(targetTypes), targetId: z.string(),
  journeyDefinitionId: z.string().nullable(), parentCommentId: z.string().nullable(), rootCommentId: z.string(), author: actor,
  state: z.enum(['active', 'resolved', 'deleted']), revision: z.number(), body: z.unknown().nullable(), plainText: z.string().nullable(),
  mentions: z.array(actor), createdAt: z.string(), editedAt: z.string().nullable(), resolvedAt: z.string().nullable(),
  resolvedByUserId: z.string().nullable(), deletedAt: z.string().nullable() }).strict();
export type CollaborationComment = z.infer<typeof commentSchema>;

export const assignmentSchema = z.object({ id: z.string(), scopeType: z.enum(['space', 'journey']), journeyDefinitionId: z.string().nullable(),
  userId: z.string(), userName: z.string(), role: z.enum(collaborationRoles), state: z.enum(['active', 'revoked']), revision: z.number(),
  assignedByUserId: z.string().nullable(), assignedAt: z.string(), revokedByUserId: z.string().nullable(), revokedAt: z.string().nullable() }).strict();
export type RoleAssignment = z.infer<typeof assignmentSchema>;

export const reviewSchema = z.object({ id: z.string(), targetType: z.enum(governanceTargetTypes), targetId: z.string(),
  journeyDefinitionId: z.string().nullable(), targetRevision: z.number(), targetChecksum: z.string(),
  state: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'published']), revision: z.number(), requestedByUserId: z.string(),
  requestSummary: z.string(), requestedAt: z.string(), dueAt: z.string().nullable(), decidedByUserId: z.string().nullable(),
  decisionSummary: z.string().nullable(), decidedAt: z.string().nullable(), publishedByUserId: z.string().nullable(),
  publishedAt: z.string().nullable() }).strict();
export type GovernanceReview = z.infer<typeof reviewSchema>;

export const notificationSchema = z.object({ id: z.string(), kind: z.string(), targetType: z.string(), targetId: z.string(),
  actor: actor.nullable(), commentId: z.string().nullable(), reviewId: z.string().nullable(), state: z.enum(['unread', 'read', 'dismissed']),
  revision: z.number(), createdAt: z.string(), readAt: z.string().nullable() }).strict();
export type CollaborationNotification = z.infer<typeof notificationSchema>;

export const activitySchema = z.object({ id: z.string(), action: z.string(), targetType: z.string(), targetId: z.string(),
  journeyDefinitionId: z.string().nullable(), actor: actor.nullable(), commentId: z.string().nullable(), reviewId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()), createdAt: z.string() }).strict();
export type CollaborationActivity = z.infer<typeof activitySchema>;
export const shareTargetTypes = ['journey_map', 'persona', 'portfolio', 'collaboration_view'] as const;
export type JourneyShareTargetType = typeof shareTargetTypes[number];
export const shareSchema = z.object({ id: z.string(), targetType: z.enum(shareTargetTypes), targetId: z.string(),
  targetRevision: z.number(), tokenPrefix: z.string(), permission: z.literal('view'), allowExport: z.boolean(),
  allowDownload: z.boolean(), checksum: z.string(), state: z.enum(['active', 'revoked']), revision: z.number(),
  createdAt: z.string(), expiresAt: z.string(), rotatedAt: z.string().nullable(), revokedAt: z.string().nullable() }).strict();
export type JourneyReadOnlyShare = z.infer<typeof shareSchema>;
const shareSecretSchema = z.object({ share: shareSchema, token: z.string(), url: z.string().url(), replayed: z.boolean() }).strict();
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict();
const mutation = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, replayed: z.boolean() }).strict();
const targetQuery = (target: TargetRef) => `targetType=${target.targetType}&targetId=${encodeURIComponent(target.targetId)}`;
const mutationOptions = (method: string, body: unknown) => ({ ...json(method, body), headers: {
  'Idempotency-Key': crypto.randomUUID(), 'X-Request-Id': crypto.randomUUID(), 'Content-Type': 'application/json'
} });
async function parsed<T>(schema: z.ZodType<T>, path: string, options?: RequestInit) { return schema.parse(await api<unknown>(path, options)); }

export const getCollaborationContext = (target?: TargetRef) => parsed(contextSchema,
  `/api/journey-collaboration/context${target ? `?${targetQuery(target)}` : ''}`);
export const getCollaborationSettings = () => parsed(z.object({ settings, plan }).strict(), '/api/journey-collaboration/settings');
export const updateCollaborationSettings = (input: z.infer<typeof settings>) => parsed(mutation({ settings }),
  '/api/journey-collaboration/settings', mutationOptions('PATCH', { expectedRevision: input.revision, enabled: input.enabled,
    commentsEnabled: input.commentsEnabled, sharingEnabled: input.sharingEnabled, externalDownloadsEnabled: input.externalDownloadsEnabled,
    commentRetentionDays: input.commentRetentionDays, viewRetentionDays: input.viewRetentionDays,
    maximumShareDays: input.maximumShareDays, securityReviewReference: input.securityReviewReference }));

export const listComments = (target: TargetRef) => parsed(page(commentSchema).extend({ plan }).strict(),
  `/api/journey-collaboration/comments?${targetQuery(target)}&limit=100`);
export const createComment = (target: TargetRef, body: string, mentionUserIds: string[], parentCommentId?: string) =>
  parsed(mutation({ comment: commentSchema }), '/api/journey-collaboration/comments', mutationOptions('POST', {
    target, body, mentionUserIds, parentCommentId: parentCommentId || null }));
export const editComment = (comment: CollaborationComment, body: string, mentionUserIds: string[]) =>
  parsed(mutation({ comment: commentSchema }), `/api/journey-collaboration/comments/${encodeURIComponent(comment.id)}`,
    mutationOptions('PATCH', { expectedRevision: comment.revision, body, mentionUserIds, editReason: 'Updated in collaboration workspace.' }));
export const deleteComment = (comment: CollaborationComment) => parsed(mutation({ commentId: z.string(), state: z.literal('deleted'),
  revision: z.number(), retentionExpiresAt: z.string() }), `/api/journey-collaboration/comments/${encodeURIComponent(comment.id)}`,
  mutationOptions('DELETE', { expectedRevision: comment.revision, reason: 'Removed in collaboration workspace.' }));
export const transitionComment = (comment: CollaborationComment, action: 'resolve' | 'reopen') => parsed(mutation({ comment: commentSchema }),
  `/api/journey-collaboration/comments/${encodeURIComponent(comment.id)}/${action}`,
  mutationOptions('POST', { expectedRevision: comment.revision }));
export const listCommentHistory = (commentId: string) => parsed(z.object({ items: z.array(z.object({ id: z.string(), versionNumber: z.number(),
  body: z.unknown().nullable(), plainText: z.string().nullable(), checksum: z.string(), editor: actor, editReasonSha256: z.string().nullable(),
  createdAt: z.string() }).strict()), redacted: z.boolean(), nextCursor: z.string().nullable() }).strict(),
  `/api/journey-collaboration/comments/${encodeURIComponent(commentId)}/history?limit=100`);

export const listWatchers = (target: TargetRef) => parsed(page(z.object({ id: z.string(), user: actor,
  state: z.enum(['watching', 'muted']), revision: z.number(), createdAt: z.string(), updatedAt: z.string() }).strict()),
  `/api/journey-collaboration/watchers?${targetQuery(target)}&limit=100`);
export const setWatcher = (target: TargetRef, state: 'watching' | 'muted') => parsed(mutation({ watcher: z.unknown() }),
  '/api/journey-collaboration/watchers', mutationOptions('PUT', { target, state }));

export const listNotifications = (state?: 'unread' | 'read' | 'dismissed') => parsed(page(notificationSchema),
  `/api/journey-collaboration/notifications?limit=100${state ? `&state=${state}` : ''}`);
export const updateNotification = (item: CollaborationNotification, state: 'read' | 'dismissed') => parsed(
  z.object({ notification: notificationSchema }).strict(), `/api/journey-collaboration/notifications/${encodeURIComponent(item.id)}`,
  json('PATCH', { expectedRevision: item.revision, state }));

export const listRoles = () => parsed(page(assignmentSchema), '/api/journey-collaboration/roles?state=active&limit=100');
export const assignRole = (input: { userId: string; role: CollaborationRole; scopeType: 'space' | 'journey'; journeyDefinitionId?: string }) =>
  parsed(mutation({ assignment: assignmentSchema }), '/api/journey-collaboration/roles', mutationOptions('POST', {
    ...input, journeyDefinitionId: input.journeyDefinitionId || null }));
export const revokeRole = (item: RoleAssignment) => parsed(mutation({ assignment: assignmentSchema }),
  `/api/journey-collaboration/roles/${encodeURIComponent(item.id)}/revoke`,
  mutationOptions('POST', { expectedRevision: item.revision, reason: 'Access changed in collaboration workspace.' }));

export const listReviews = (target?: TargetRef) => parsed(page(reviewSchema),
  `/api/journey-collaboration/governance/reviews?limit=100${target ? `&${targetQuery(target)}` : ''}`);
export const requestReview = (target: TargetRef, summary: string, reason: string) => parsed(mutation({ review: reviewSchema }),
  '/api/journey-collaboration/governance/reviews', mutationOptions('POST', { target, summary, reason }));
export const decideReview = (review: GovernanceReview, decision: 'approve' | 'reject', summary: string, reason: string) =>
  parsed(mutation({ review: reviewSchema }), `/api/journey-collaboration/governance/reviews/${encodeURIComponent(review.id)}/decision`,
    mutationOptions('POST', { expectedRevision: review.revision, decision, summary, reason }));
export const transitionReview = (review: GovernanceReview, action: 'withdraw' | 'publish', reason: string) =>
  parsed(mutation({ review: reviewSchema }), `/api/journey-collaboration/governance/reviews/${encodeURIComponent(review.id)}/${action}`,
    mutationOptions('POST', { expectedRevision: review.revision, reason }));
export const listActivity = (target?: TargetRef) => parsed(page(activitySchema),
  `/api/journey-collaboration/activity?limit=100${target ? `&${targetQuery(target)}` : ''}`);

export const listReadOnlyShares = (state?: 'active' | 'revoked') => parsed(z.object({ items: z.array(shareSchema),
  page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }).strict(), plan }).strict(),
  `/api/journey-collaboration/shares?limit=100${state ? `&state=${state}` : ''}`);
export const createReadOnlyShare = (input: { targetType: JourneyShareTargetType; targetId: string;
  expiresAt: string; allowExport: boolean; allowDownload: boolean }) => parsed(shareSecretSchema,
  '/api/journey-collaboration/shares', mutationOptions('POST', input));
export const rotateReadOnlyShare = (item: JourneyReadOnlyShare) => parsed(shareSecretSchema,
  `/api/journey-collaboration/shares/${encodeURIComponent(item.id)}/rotate`,
  mutationOptions('POST', { expectedRevision: item.revision }));
export const revokeReadOnlyShare = (item: JourneyReadOnlyShare, reason: string) => parsed(
  mutation({ share: shareSchema }), `/api/journey-collaboration/shares/${encodeURIComponent(item.id)}/revoke`,
  mutationOptions('POST', { expectedRevision: item.revision, reason }));

const publicShareSchema = z.object({ targetType: z.enum(shareTargetTypes), targetRevision: z.number(),
  permission: z.literal('view'), allowExport: z.boolean(), allowDownload: z.boolean(),
  state: z.enum(['active', 'revoked']), expiresAt: z.string() }).strict();
export const publicShareResponseSchema = z.object({ share: publicShareSchema, snapshot: z.object({ schemaVersion: z.literal(2),
  title: z.string(), targetType: z.enum(shareTargetTypes), targetRevision: z.number(),
  capturedAt: z.string(), content: z.record(z.string(), z.unknown()) }).strict() }).strict();
export type PublicJourneyShare = z.infer<typeof publicShareResponseSchema>;
export const getPublicJourneyShare = (token: string) => parsed(publicShareResponseSchema,
  `/api/public/journey-shares/${encodeURIComponent(token)}`);
