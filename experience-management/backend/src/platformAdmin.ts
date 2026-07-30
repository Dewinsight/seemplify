import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { currentSessionUser, isPlatformAdmin, isRootPlatformAdmin, type SessionUser } from './auth.js';
import { config } from './config.js';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import './knowledgeRepository.js';
import { resolveRequestSpace, type SpaceContext, SpaceError } from './spaces.js';
import {
  effectiveSubscriptionForSpace, publicSubscriptionPlan, subscriptionCatalogVersion,
  subscriptionPlanCatalog as planCatalog, subscriptionPlanCodes, subscriptionPlanSnapshot,
  validatedSubscriptionPlanSnapshot
} from './subscriptionEntitlements.js';

type JsonObject = Record<string, unknown>;
type PlatformRole = 'superadmin' | 'support' | 'billing_approver' | 'analyst';
type AccountStatus = 'active' | 'suspended' | 'disabled';
type SpaceStatus = 'active' | 'suspended' | 'archived';
type SubscriptionRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type SubscriptionStatus = 'active' | 'suspended' | 'cancelled';

const platformRoles = ['superadmin', 'support', 'billing_approver', 'analyst'] as const;
const accountStatuses = ['active', 'suspended', 'disabled'] as const;
const spaceStatuses = ['active', 'suspended', 'archived'] as const;
const subscriptionStatuses = ['active', 'suspended', 'cancelled'] as const;
const requestStatuses = ['pending', 'approved', 'rejected', 'cancelled'] as const;

const planCodeSchema = z.enum(subscriptionPlanCodes);
const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(1_000);
const noteSchema = z.string().trim().min(5).max(2_000);
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  page: z.coerce.number().int().min(1).max(40_001).optional(),
  search: z.string().trim().max(160).default(''),
  q: z.string().trim().max(160).default('')
});

function pageInput<T extends z.infer<typeof paginationSchema>>(input: T) {
  const limit = input.limit;
  const offset = input.offset ?? ((input.page || 1) - 1) * limit;
  if (offset > 1_000_000) throw new PlatformAdminError('The requested page is outside the supported range.', 400, 'PAGINATION_RANGE_INVALID');
  return { ...input, limit, offset, search: input.search || input.q, page: Math.floor(offset / limit) + 1 };
}

function paged<T>(name: 'users' | 'spaces' | 'subscriptions' | 'requests' | 'events', items: T[], input: { limit: number; offset: number; page: number }, total: number) {
  const hasMore = input.offset + items.length < total;
  return {
    [name]: items,
    items,
    total,
    page: input.page,
    pageSize: input.limit,
    hasMore,
    pagination: { limit: input.limit, offset: input.offset, total, hasMore }
  };
}

export class PlatformAdminError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'PLATFORM_ADMIN_ERROR') {
    super(message);
    this.name = 'PlatformAdminError';
    this.status = status;
    this.code = code;
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function publicPlan(code: string) {
  return publicSubscriptionPlan(code);
}

function safeTimestamp(value: unknown) {
  const timestamp = String(value || '');
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function sendPlatformError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues });
  }
  if (error instanceof PlatformAdminError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof SpaceError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  if (isDatabaseConstraintError(error)) {
    return response.status(409).json({ error: 'The requested change conflicts with current platform state.', code: 'PLATFORM_STATE_CONFLICT' });
  }
  console.error('Platform administration request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The platform administration request could not be completed.', code: 'PLATFORM_ADMIN_INTERNAL_ERROR' });
}

function account(request: Request, response: Response) {
  const user = currentSessionUser(request);
  if (!user) {
    response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    return null;
  }
  if (!user.emailVerifiedAt) {
    response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
    return null;
  }
  return user;
}

function platformActor(request: Request, response: Response) {
  const user = account(request, response);
  if (!user) return null;
  if (!isPlatformAdmin(user.id)) {
    response.status(403).json({ error: 'Platform administrator access is required.', code: 'PLATFORM_ADMIN_REQUIRED' });
    return null;
  }
  return user;
}

function requireRootActor(request: Request, response: Response) {
  const user = platformActor(request, response);
  if (!user) return null;
  if (!isRootPlatformAdmin(user.id)) {
    response.status(403).json({ error: 'Root platform administrator access is required.', code: 'ROOT_PLATFORM_ADMIN_REQUIRED' });
    return null;
  }
  return user;
}

function rolesForUser(userId: string) {
  return (db.prepare(`SELECT id,role,granted_by_user_id,granted_at,revoked_by_user_id,revoked_at,reason
    FROM platform_role_assignments WHERE user_id=? ORDER BY granted_at DESC,id DESC`).all(userId) as any[]).map((row) => ({
      id: String(row.id), role: String(row.role), active: !row.revoked_at,
      grantedByUserId: row.granted_by_user_id || null, grantedAt: row.granted_at,
      revokedByUserId: row.revoked_by_user_id || null, revokedAt: row.revoked_at || null,
      reason: row.reason || ''
    }));
}

function activeRoleNames(userId: string) {
  return (db.prepare(`SELECT role FROM platform_role_assignments
    WHERE user_id=? AND revoked_at IS NULL ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'root' THEN 0 ELSE 1 END,role`)
    .all(userId) as Array<{ role: string }>).map((row) => String(row.role));
}

type PlatformCapability = 'readUsers' | 'readSpaces' | 'readSubscriptions' | 'readAnalytics' | 'readAudit';

function platformCapabilities(user: SessionUser) {
  const root = isRootPlatformAdmin(user.id);
  const roles = new Set(activeRoleNames(user.id));
  return {
    readPlatform: true,
    readUsers: root || roles.has('support'),
    readSpaces: root || roles.has('support') || roles.has('billing_approver'),
    readSubscriptions: root || roles.has('support') || roles.has('billing_approver'),
    readAnalytics: root || roles.has('analyst'),
    readAudit: root,
    manageAccounts: root,
    manageRoles: root,
    manageSpaces: root,
    decideSubscriptions: root || roles.has('billing_approver')
  };
}

function requirePlatformCapability(capability: PlatformCapability) {
  return (request: Request, response: Response, next: NextFunction) => {
    const actor = platformActor(request, response);
    if (!actor) return;
    if (!platformCapabilities(actor)[capability]) {
      return response.status(403).json({ error: 'This platform role does not grant access to the requested data.', code: 'PLATFORM_CAPABILITY_REQUIRED' });
    }
    response.locals.platformActor = actor;
    return next();
  };
}

function actorRole(user: SessionUser) {
  if (isRootPlatformAdmin(user.id)) return 'superadmin';
  return activeRoleNames(user.id)[0] || 'workspace_user';
}

function requireBillingActor(request: Request, response: Response) {
  const user = platformActor(request, response);
  if (!user) return null;
  if (!isRootPlatformAdmin(user.id) && !activeRoleNames(user.id).includes('billing_approver')) {
    response.status(403).json({ error: 'Subscription approval access is required.', code: 'SUBSCRIPTION_APPROVER_REQUIRED' });
    return null;
  }
  return user;
}

function effectiveRootCount() {
  return Number((db.prepare(`SELECT COUNT(DISTINCT u.id) count FROM users u
    WHERE COALESCE(u.account_status,'active')='active' AND (LOWER(u.email)=LOWER(?) OR EXISTS (
      SELECT 1 FROM platform_role_assignments assignment
      WHERE assignment.user_id=u.id AND assignment.role='superadmin' AND assignment.revoked_at IS NULL
    ))`).get(config.adminEmail) as { count?: number } | undefined)?.count || 0);
}

function requestIdentifier(request: Request) {
  const supplied = String(request.get('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{8,120}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function auditInput(request: Request, actor: SessionUser, input: {
  action: string;
  targetType: string;
  targetId: string;
  spaceId?: string | null;
  reason?: string;
  before?: JsonObject | null;
  after?: JsonObject | null;
}) {
  return {
    id: crypto.randomUUID(), actorUserId: actor.id, actorRole: actorRole(actor),
    action: input.action, targetType: input.targetType, targetId: input.targetId,
    spaceId: input.spaceId || null, reason: input.reason || '',
    beforeJson: JSON.stringify(input.before || {}), afterJson: JSON.stringify(input.after || {}),
    requestId: requestIdentifier(request), ipAddress: String(request.ip || '').slice(0, 100),
    userAgent: String(request.get('user-agent') || '').slice(0, 500), createdAt: new Date().toISOString()
  };
}

function recordAudit(request: Request, actor: SessionUser, input: Parameters<typeof auditInput>[2]) {
  const event = auditInput(request, actor, input);
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,request_id,ip_address,user_agent,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    event.id, event.actorUserId, event.actorRole, event.action, event.targetType, event.targetId,
    event.spaceId, event.reason, event.beforeJson, event.afterJson, event.requestId,
    event.ipAddress, event.userAgent, event.createdAt
  );
  return event.id;
}

function mutationOriginGuard(request: Request, response: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return next();
  const origin = String(request.get('origin') || '').trim();
  if (origin) {
    let expected = '';
    try { expected = new URL(config.publicUrl).origin; } catch { /* invalid configuration is surfaced elsewhere */ }
    let trustedLoopback = false;
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const remote = String(request.ip || request.socket.remoteAddress || '').toLowerCase();
      const loopbackOrigin = ['localhost', '127.0.0.1', '::1'].includes(host);
      const loopbackRemote = remote === '::1' || remote === '127.0.0.1' || remote.startsWith('::ffff:127.');
      const trustedOrigins = new Set([
        `http://127.0.0.1:${config.port}`,
        `http://localhost:${config.port}`,
        `http://[::1]:${config.port}`
      ]);
      trustedLoopback = parsed.protocol === 'http:' && loopbackOrigin && loopbackRemote && trustedOrigins.has(parsed.origin);
    } catch { /* rejected below */ }
    if ((!expected || origin !== expected) && !trustedLoopback) {
      return response.status(403).json({ error: 'Cross-origin administration requests are not allowed.', code: 'ADMIN_ORIGIN_REJECTED' });
    }
  }
  return next();
}

function noStoreRouter(router: express.Router) {
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.vary('Cookie');
    next();
  });
  router.use(mutationOriginGuard);
}

function activeAssignmentsForUsers(userIds: string[]) {
  const unique = [...new Set(userIds)].filter(Boolean);
  const result = new Map<string, string[]>();
  if (!unique.length) return result;
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT user_id,role FROM platform_role_assignments
    WHERE revoked_at IS NULL AND user_id IN (${placeholders}) ORDER BY role`).all(...unique) as any[];
  for (const row of rows) result.set(String(row.user_id), [...(result.get(String(row.user_id)) || []), String(row.role)]);
  return result;
}

function userSummary(row: any, roles: string[] = []) {
  const accountStatus = String(row.account_status || 'active') as AccountStatus;
  const emailVerified = Boolean(row.email_verified_at);
  const displayStatus = accountStatus === 'active' && !emailVerified ? 'pending' : accountStatus;
  const plan = row.primary_plan_code ? publicPlan(String(row.primary_plan_code)) : null;
  return {
    id: String(row.id), name: String(row.name), email: String(row.email),
    accountStatus, status: displayStatus,
    emailVerified, onboardingCompleted: Boolean(row.onboarding_completed_at),
    platformRoles: roles,
    rootPlatformAdmin: roles.includes('superadmin') || String(row.email).toLowerCase() === config.adminEmail,
    rootSource: String(row.email).toLowerCase() === config.adminEmail ? 'configured' : roles.includes('superadmin') ? 'assigned' : null,
    spaceCount: Number(row.space_count || 0),
    lastLoginAt: row.last_login_at || null, lastActiveAt: row.last_login_at || null,
    planName: plan?.name || null, subscriptionStatus: row.primary_subscription_status || null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function subscriptionRow(row: any) {
  if (!row) return null;
  return {
    id: String(row.id), spaceId: String(row.space_id), planCode: String(row.plan_code),
    plan: publicPlan(String(row.plan_code)), status: String(row.status) as SubscriptionStatus,
    features: parseJson<JsonObject>(row.features_json, {}), limits: parseJson<JsonObject>(row.limits_json, {}),
    sourceRequestId: row.source_request_id || null, effectiveAt: row.effective_at,
    expiresAt: row.expires_at || null, version: Number(row.version || 1),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function subscriptionForSpace(spaceId: string) {
  return subscriptionRow(db.prepare('SELECT * FROM platform_subscriptions WHERE space_id=?').get(spaceId));
}

function requestRow(row: any) {
  return {
    id: String(row.id), spaceId: String(row.space_id), requestType: String(row.request_type),
    requestedPlanCode: row.requested_plan_code || null,
    requestedPlan: row.requested_plan_code ? publicPlan(String(row.requested_plan_code)) : null,
    requestNote: String(row.request_note || ''), status: String(row.status) as SubscriptionRequestStatus,
    requestedBy: row.requested_by_user_id ? {
      id: String(row.requested_by_user_id), name: String(row.requested_by_name || ''),
      ...(row.requested_by_email ? { email: String(row.requested_by_email) } : {})
    } : null,
    reviewedBy: row.reviewed_by_user_id ? {
      id: String(row.reviewed_by_user_id), name: String(row.reviewed_by_name || '')
    } : null,
    reviewNote: row.review_note || '', decisionAt: row.decision_at || null,
    version: Number(row.version || 1), createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.space_name ? { space: { id: String(row.space_id), name: String(row.space_name) } } : {})
  };
}

function subscriptionRequestById(id: string, exposeRequesterEmail = false) {
  const row = db.prepare(`SELECT r.*,s.name space_name,requester.name requested_by_name,
      ${exposeRequesterEmail ? 'requester.email' : "''"} requested_by_email,reviewer.name reviewed_by_name
    FROM platform_subscription_requests r
    JOIN spaces s ON s.id=r.space_id
    JOIN users requester ON requester.id=r.requested_by_user_id
    LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by_user_id
    WHERE r.id=?`).get(id);
  return row ? requestRow(row) : null;
}

function subscriptionDecisionConflict(actorId: string, requestRow: any) {
  const reasons: Array<'requester' | 'space_member'> = [];
  if (String(requestRow.requested_by_user_id) === actorId) reasons.push('requester');
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(String(requestRow.space_id), actorId) as { role?: string } | undefined;
  if (membership) reasons.push('space_member');
  return {
    conflicted: reasons.length > 0,
    reasons,
    membershipRole: membership?.role ? String(membership.role) : null
  };
}

function tenantContext(request: Request, response: Response) {
  const user = account(request, response);
  if (!user) return null;
  try { return { user, space: resolveRequestSpace(request, user.id) }; }
  catch (error) { sendPlatformError(response, error); return null; }
}

function requireSpaceManager(context: { user: SessionUser; space: SpaceContext }, response: Response) {
  if (context.space.role !== 'owner' && context.space.role !== 'admin') {
    response.status(403).json({ error: 'Space owner or admin access is required.', code: 'SPACE_MANAGER_REQUIRED' });
    return false;
  }
  return true;
}

export const platformAdminRouter = express.Router();
noStoreRouter(platformAdminRouter);
platformAdminRouter.use((request, response, next) => {
  const user = platformActor(request, response);
  if (!user) return;
  next();
});

platformAdminRouter.get('/me', (request, response) => {
  const actor = platformActor(request, response);
  if (!actor) return;
  return response.json({
    user: { id: actor.id, name: actor.name, email: actor.email },
    roles: activeRoleNames(actor.id), root: isRootPlatformAdmin(actor.id),
    effectiveRootCount: effectiveRootCount(),
    capabilities: platformCapabilities(actor)
  });
});

function platformOverview() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const accounts = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN COALESCE(account_status,'active')='active' THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN COALESCE(account_status,'active')<>'active' THEN 1 ELSE 0 END) restricted,
      SUM(CASE WHEN email_verified_at IS NULL THEN 1 ELSE 0 END) unverified,
      SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) new_30d
    FROM users`).get(since) as any;
  const spaces = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN COALESCE(status,'active')='active' THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN COALESCE(status,'active')<>'active' THEN 1 ELSE 0 END) restricted
    FROM spaces`).get() as any;
  const subscriptions = db.prepare(`SELECT
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) suspended,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled
    FROM platform_subscriptions`).get() as any;
  const pendingRequests = Number((db.prepare("SELECT COUNT(*) count FROM platform_subscription_requests WHERE status='pending'").get() as any)?.count || 0);
  const product = db.prepare(`SELECT
      (SELECT COUNT(*) FROM surveys) surveys,
      (SELECT COUNT(*) FROM responses) responses,
      (SELECT COUNT(*) FROM campaigns) campaigns,
      (SELECT COUNT(*) FROM esign_envelopes) agreements,
      (SELECT COUNT(*) FROM ai_jobs) ai_jobs,
      (SELECT COUNT(*) FROM ai_jobs WHERE state='failed') ai_failures,
      (SELECT COUNT(*) FROM tickets WHERE status<>'closed') open_tickets,
      (SELECT COUNT(*) FROM knowledge_bases) knowledge_bases`).get() as any;
  const aiQueue = (db.prepare('SELECT state,COUNT(*) count FROM ai_jobs GROUP BY state').all() as any[])
    .reduce<Record<string, number>>((result, row) => ({ ...result, [String(row.state)]: Number(row.count) }), {});
  return {
    generatedAt: new Date().toISOString(),
    accounts: {
      total: Number(accounts?.total || 0), active: Number(accounts?.active || 0),
      restricted: Number(accounts?.restricted || 0), unverified: Number(accounts?.unverified || 0),
      new30d: Number(accounts?.new_30d || 0)
    },
    spaces: { total: Number(spaces?.total || 0), active: Number(spaces?.active || 0), restricted: Number(spaces?.restricted || 0) },
    subscriptions: {
      active: Number(subscriptions?.active || 0), suspended: Number(subscriptions?.suspended || 0),
      cancelled: Number(subscriptions?.cancelled || 0), pendingRequests
    },
    product: {
      surveys: Number(product?.surveys || 0), responses: Number(product?.responses || 0),
      campaigns: Number(product?.campaigns || 0), agreements: Number(product?.agreements || 0),
      aiJobs: Number(product?.ai_jobs || 0), aiFailures: Number(product?.ai_failures || 0),
      openTickets: Number(product?.open_tickets || 0), knowledgeBases: Number(product?.knowledge_bases || 0)
    },
    aiQueue,
    platformAdministrators: {
      root: effectiveRootCount(),
      support: Number((db.prepare("SELECT COUNT(DISTINCT user_id) count FROM platform_role_assignments WHERE role='support' AND revoked_at IS NULL").get() as any)?.count || 0),
      billingApprover: Number((db.prepare("SELECT COUNT(DISTINCT user_id) count FROM platform_role_assignments WHERE role='billing_approver' AND revoked_at IS NULL").get() as any)?.count || 0),
      analyst: Number((db.prepare("SELECT COUNT(DISTINCT user_id) count FROM platform_role_assignments WHERE role='analyst' AND revoked_at IS NULL").get() as any)?.count || 0)
    }
  };
}

platformAdminRouter.get('/overview', (_request, response) => response.json(platformOverview()));
platformAdminRouter.get('/analytics/overview', requirePlatformCapability('readAnalytics'), (_request, response) => response.json(platformOverview()));

const dateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional()
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'The start date must be before the end date.')
  .refine((value) => !value.from || !value.to
    || Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`) <= 365 * 24 * 60 * 60_000,
  'Analytics ranges cannot exceed 366 days.');

platformAdminRouter.get('/analytics/timeseries', requirePlatformCapability('readAnalytics'), (request, response) => {
  try {
    const parsed = dateRangeSchema.parse(request.query);
    const toDay = parsed.to || new Date().toISOString().slice(0, 10);
    const fromDay = parsed.from || new Date(Date.parse(`${toDay}T00:00:00.000Z`) - 29 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const from = `${fromDay}T00:00:00.000Z`; const to = `${toDay}T23:59:59.999Z`;
    const metrics: Array<{ key: string; table: string; timestamp: string; where?: string }> = [
      { key: 'accounts', table: 'users', timestamp: 'created_at' },
      { key: 'spaces', table: 'spaces', timestamp: 'created_at' },
      { key: 'responses', table: 'responses', timestamp: 'completed_at', where: 'completed_at IS NOT NULL' },
      { key: 'aiJobs', table: 'ai_jobs', timestamp: 'created_at' },
      { key: 'agreements', table: 'esign_envelopes', timestamp: 'created_at' },
      { key: 'campaigns', table: 'campaigns', timestamp: 'created_at' }
    ];
    const days = new Map<string, Record<string, number>>();
    for (const metric of metrics) {
      const rows = db.prepare(`SELECT substr(${metric.timestamp},1,10) day,COUNT(*) count FROM ${metric.table}
        WHERE ${metric.timestamp}>=? AND ${metric.timestamp}<=?${metric.where ? ` AND ${metric.where}` : ''}
        GROUP BY substr(${metric.timestamp},1,10) ORDER BY day`).all(from, to) as any[];
      for (const row of rows) {
        const day = String(row.day); const current = days.get(day) || {};
        current[metric.key] = Number(row.count); days.set(day, current);
      }
    }
    const series: Array<Record<string, string | number>> = [];
    for (let cursor = Date.parse(`${fromDay}T00:00:00.000Z`), end = Date.parse(`${toDay}T00:00:00.000Z`); cursor <= end; cursor += 24 * 60 * 60_000) {
      const day = new Date(cursor).toISOString().slice(0, 10); const values = days.get(day) || {};
      series.push({ day, accounts: values.accounts || 0, spaces: values.spaces || 0, responses: values.responses || 0,
        aiJobs: values.aiJobs || 0, agreements: values.agreements || 0, campaigns: values.campaigns || 0 });
    }
    return response.json({ from: fromDay, to: toDay, series });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/users', requirePlatformCapability('readUsers'), (request, response) => {
  try {
    const page = pageInput(paginationSchema.extend({ status: z.enum(['all', 'pending', ...accountStatuses]).default('all') }).parse(request.query));
    const search = page.search.toLowerCase(); const like = `%${search}%`;
    const where = `(?='' OR LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)
      AND (?='all'
        OR (?='pending' AND COALESCE(u.account_status,'active')='active' AND u.email_verified_at IS NULL)
        OR (?<>'pending' AND COALESCE(u.account_status,'active')=? AND (?<>'active' OR u.email_verified_at IS NOT NULL)))`;
    const parameters = [search, like, like, page.status, page.status, page.status, page.status, page.status];
    const rows = db.prepare(`SELECT u.id,u.email,u.name,u.account_status,u.email_verified_at,u.last_login_at,u.created_at,u.updated_at,
        p.onboarding_completed_at,(SELECT COUNT(*) FROM space_memberships m WHERE m.user_id=u.id) space_count,
        (SELECT subscription.plan_code FROM space_memberships membership
          JOIN platform_subscriptions subscription ON subscription.space_id=membership.space_id
          WHERE membership.user_id=u.id ORDER BY CASE subscription.status WHEN 'active' THEN 0 ELSE 1 END,subscription.updated_at DESC LIMIT 1) primary_plan_code,
        (SELECT subscription.status FROM space_memberships membership
          JOIN platform_subscriptions subscription ON subscription.space_id=membership.space_id
          WHERE membership.user_id=u.id ORDER BY CASE subscription.status WHEN 'active' THEN 0 ELSE 1 END,subscription.updated_at DESC LIMIT 1) primary_subscription_status
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE ${where}
      ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`).all(...parameters, page.limit, page.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM users u WHERE ${where}`).get(...parameters) as any)?.count || 0);
    const assignments = activeAssignmentsForUsers(rows.map((row) => String(row.id)));
    const users = rows.map((row) => userSummary(row, assignments.get(String(row.id)) || []));
    return response.json(paged('users', users, page, total));
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/users/:id', requirePlatformCapability('readUsers'), (request, response) => {
  try {
    const id = uuidSchema.parse(request.params.id);
    const row = db.prepare(`SELECT u.id,u.email,u.name,u.account_status,u.email_verified_at,u.last_login_at,u.created_at,u.updated_at,
        p.job_title,p.organization_name,p.timezone,p.onboarding_completed_at,
        (SELECT COUNT(*) FROM space_memberships m WHERE m.user_id=u.id) space_count,
        (SELECT subscription.plan_code FROM space_memberships membership
          JOIN platform_subscriptions subscription ON subscription.space_id=membership.space_id
          WHERE membership.user_id=u.id ORDER BY CASE subscription.status WHEN 'active' THEN 0 ELSE 1 END,subscription.updated_at DESC LIMIT 1) primary_plan_code,
        (SELECT subscription.status FROM space_memberships membership
          JOIN platform_subscriptions subscription ON subscription.space_id=membership.space_id
          WHERE membership.user_id=u.id ORDER BY CASE subscription.status WHEN 'active' THEN 0 ELSE 1 END,subscription.updated_at DESC LIMIT 1) primary_subscription_status
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`).get(id) as any;
    if (!row) throw new PlatformAdminError('User not found.', 404, 'USER_NOT_FOUND');
    const memberships = (db.prepare(`SELECT s.id,s.name,s.slug,COALESCE(s.status,'active') status,m.role,m.joined_at
      FROM space_memberships m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=?
      ORDER BY m.joined_at DESC,s.id`).all(id) as any[]).map((membership) => ({
        space: { id: String(membership.id), name: String(membership.name), slug: String(membership.slug), status: String(membership.status) },
        role: String(membership.role), joinedAt: membership.joined_at
      }));
    const summary = userSummary(row, activeRoleNames(id));
    const primarySubscription = row.primary_plan_code ? {
      planName: publicPlan(String(row.primary_plan_code))?.name || String(row.primary_plan_code),
      status: row.primary_subscription_status || null,
      startedAt: null,
      endsAt: null
    } : null;
    const recentAudit = (db.prepare(`SELECT a.*,actor.name actor_name FROM platform_audit_events a
      LEFT JOIN users actor ON actor.id=a.actor_user_id
      WHERE (a.target_type='user' AND a.target_id=?) OR a.actor_user_id=?
      ORDER BY a.created_at DESC,a.id DESC LIMIT 20`).all(id, id) as any[]).map((event) => auditSummary(event));
    return response.json({
      user: summary,
      memberships,
      roleAssignments: rolesForUser(id),
      profile: { jobTitle: row.job_title || '', organizationName: row.organization_name || '', timezone: row.timezone || '' },
      spaces: memberships.map((membership) => ({ ...membership.space, role: membership.role, joinedAt: membership.joinedAt })),
      subscription: primarySubscription,
      recentAudit
    });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.patch('/users/:id/status', (request, response) => {
  try {
    const actor = requireRootActor(request, response); if (!actor) return;
    const id = uuidSchema.parse(request.params.id);
    const input = z.object({ status: z.enum(accountStatuses), reason: reasonSchema }).strict().parse(request.body);
    if (id === actor.id && input.status !== 'active') {
      throw new PlatformAdminError('Use another root administrator to restrict your own account.', 409, 'ADMIN_SELF_RESTRICTION_BLOCKED');
    }
    const updated = db.transaction(() => {
      const current = db.prepare('SELECT id,COALESCE(account_status,\'active\') account_status FROM users WHERE id=?').get(id) as any;
      if (!current) throw new PlatformAdminError('User not found.', 404, 'USER_NOT_FOUND');
      if (current.account_status === input.status) return { changed: false, status: input.status };
      const now = new Date().toISOString();
      db.prepare(`UPDATE users SET account_status=?,suspended_at=?,suspended_by_user_id=?,suspension_reason=?,
        session_version=session_version+1,updated_at=? WHERE id=?`).run(
        input.status, input.status === 'active' ? null : now, input.status === 'active' ? null : actor.id,
        input.status === 'active' ? '' : input.reason, now, id
      );
      recordAudit(request, actor, { action: 'user.status_changed', targetType: 'user', targetId: id, reason: input.reason,
        before: { status: current.account_status }, after: { status: input.status } });
      return { changed: true, status: input.status };
    })();
    return response.json({ userId: id, accountStatus: updated.status, changed: updated.changed });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.post('/users/:id/revoke-sessions', (request, response) => {
  try {
    const actor = requireRootActor(request, response); if (!actor) return;
    const id = uuidSchema.parse(request.params.id);
    const input = z.object({ reason: reasonSchema }).strict().parse(request.body);
    const changed = db.transaction(() => {
      const exists = db.prepare('SELECT id FROM users WHERE id=?').get(id);
      if (!exists) throw new PlatformAdminError('User not found.', 404, 'USER_NOT_FOUND');
      const count = db.prepare('UPDATE users SET session_version=session_version+1,updated_at=? WHERE id=?')
        .run(new Date().toISOString(), id).changes;
      recordAudit(request, actor, { action: 'user.sessions_revoked', targetType: 'user', targetId: id, reason: input.reason,
        before: { sessionsValid: true }, after: { sessionsValid: false } });
      return count;
    })();
    return response.json({ userId: id, revoked: changed > 0 });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.post('/users/:id/platform-roles', (request, response) => {
  try {
    const actor = requireRootActor(request, response); if (!actor) return;
    const userId = uuidSchema.parse(request.params.id);
    const input = z.object({ role: z.enum(platformRoles), reason: reasonSchema }).strict().parse(request.body);
    const assignment = db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new PlatformAdminError('User not found.', 404, 'USER_NOT_FOUND');
      if (db.prepare('SELECT 1 FROM platform_role_assignments WHERE user_id=? AND role=? AND revoked_at IS NULL').get(userId, input.role)) {
        throw new PlatformAdminError('That platform role is already active.', 409, 'PLATFORM_ROLE_ALREADY_ACTIVE');
      }
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      db.prepare(`INSERT INTO platform_role_assignments
        (id,user_id,role,granted_by_user_id,granted_at,revoked_by_user_id,revoked_at,reason)
        VALUES (?,?,?,?,?,NULL,NULL,?)`).run(id, userId, input.role, actor.id, now, input.reason);
      recordAudit(request, actor, { action: 'user.platform_role_granted', targetType: 'user', targetId: userId,
        reason: input.reason, before: { role: input.role, active: false }, after: { role: input.role, active: true } });
      return rolesForUser(userId).find((item) => item.id === id)!;
    })();
    return response.status(201).json({ assignment });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.delete('/users/:userId/platform-roles/:assignmentId', (request, response) => {
  try {
    const actor = requireRootActor(request, response); if (!actor) return;
    const userId = uuidSchema.parse(request.params.userId); const assignmentId = uuidSchema.parse(request.params.assignmentId);
    const input = z.object({ reason: reasonSchema }).strict().parse(request.body);
    db.transaction(() => {
      const assignment = db.prepare(`SELECT id,user_id,role FROM platform_role_assignments
        WHERE id=? AND user_id=? AND revoked_at IS NULL`).get(assignmentId, userId) as any;
      if (!assignment) throw new PlatformAdminError('Active platform role assignment not found.', 404, 'PLATFORM_ROLE_NOT_FOUND');
      if (assignment.role === 'superadmin') {
        const target = db.prepare("SELECT email,COALESCE(account_status,'active') account_status FROM users WHERE id=?")
          .get(userId) as { email?: string; account_status?: string } | undefined;
        if (target?.email?.toLowerCase() === config.adminEmail) {
          throw new PlatformAdminError('The configured recovery administrator role cannot be revoked here.', 409, 'CONFIGURED_ROOT_ADMIN_PROTECTED');
        }
        if (target?.account_status === 'active' && effectiveRootCount() <= 1) {
          throw new PlatformAdminError('The final active root administrator cannot be removed.', 409, 'LAST_ROOT_ADMIN_PROTECTED');
        }
      }
      const now = new Date().toISOString();
      const changed = db.prepare(`UPDATE platform_role_assignments SET revoked_by_user_id=?,revoked_at=?,reason=?
        WHERE id=? AND user_id=? AND revoked_at IS NULL`).run(actor.id, now, input.reason, assignmentId, userId).changes;
      if (changed !== 1) throw new PlatformAdminError('The platform role changed before it could be revoked.', 409, 'PLATFORM_ROLE_CONFLICT');
      recordAudit(request, actor, { action: 'user.platform_role_revoked', targetType: 'user', targetId: userId,
        reason: input.reason, before: { role: assignment.role, active: true }, after: { role: assignment.role, active: false } });
    })();
    return response.status(204).end();
  } catch (error) { return sendPlatformError(response, error); }
});

function spaceSummary(row: any) {
  return {
    id: String(row.id), name: String(row.name), slug: String(row.slug),
    status: String(row.status || 'active') as SpaceStatus, personal: Boolean(row.personal_for_user_id),
    memberCount: Number(row.member_count || 0), owner: row.owner_id ? { id: String(row.owner_id), name: String(row.owner_name || '') } : null,
    subscription: row.subscription_id ? {
      id: String(row.subscription_id), planCode: String(row.plan_code), status: String(row.subscription_status), version: Number(row.subscription_version || 1)
    } : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

platformAdminRouter.get('/spaces', requirePlatformCapability('readSpaces'), (request, response) => {
  try {
    const page = pageInput(paginationSchema.extend({ status: z.enum(['all', ...spaceStatuses]).default('all') }).parse(request.query));
    const search = page.search.toLowerCase(); const like = `%${search}%`;
    const where = `(?='' OR LOWER(s.name) LIKE ? OR LOWER(s.slug) LIKE ?)
      AND (?='all' OR COALESCE(s.status,'active')=?)`;
    const parameters = [search, like, like, page.status, page.status];
    const rows = db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM space_memberships members WHERE members.space_id=s.id) member_count,
        owner.user_id owner_id,owner_user.name owner_name,
        subscription.id subscription_id,subscription.plan_code,subscription.status subscription_status,subscription.version subscription_version
      FROM spaces s
      LEFT JOIN space_memberships owner ON owner.space_id=s.id AND owner.role='owner'
      LEFT JOIN users owner_user ON owner_user.id=owner.user_id
      LEFT JOIN platform_subscriptions subscription ON subscription.space_id=s.id
      WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, page.limit, page.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM spaces s WHERE ${where}`).get(...parameters) as any)?.count || 0);
    return response.json(paged('spaces', rows.map(spaceSummary), page, total));
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/spaces/:id', requirePlatformCapability('readSpaces'), (request, response) => {
  try {
    const actor = response.locals.platformActor as SessionUser;
    const exposeMemberEmails = isRootPlatformAdmin(actor.id) || activeRoleNames(actor.id).includes('support');
    const id = uuidSchema.parse(request.params.id);
    const row = db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM space_memberships members WHERE members.space_id=s.id) member_count,
        owner.user_id owner_id,owner_user.name owner_name,
        subscription.id subscription_id,subscription.plan_code,subscription.status subscription_status,subscription.version subscription_version
      FROM spaces s
      LEFT JOIN space_memberships owner ON owner.space_id=s.id AND owner.role='owner'
      LEFT JOIN users owner_user ON owner_user.id=owner.user_id
      LEFT JOIN platform_subscriptions subscription ON subscription.space_id=s.id
      WHERE s.id=?`).get(id) as any;
    if (!row) throw new PlatformAdminError('Space not found.', 404, 'SPACE_NOT_FOUND');
    const members = (db.prepare(`SELECT u.id,u.name,u.email,m.role,m.joined_at
      FROM space_memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name,u.id`).all(id) as any[]).map((member) => ({
        id: String(member.id), name: String(member.name),
        ...(exposeMemberEmails ? { email: String(member.email) } : {}),
        role: String(member.role), joinedAt: member.joined_at
      }));
    const counts = db.prepare(`SELECT
        (SELECT COUNT(*) FROM surveys WHERE space_id=?) surveys,
        (SELECT COUNT(*) FROM responses r JOIN surveys s ON s.id=r.survey_id WHERE s.space_id=?) responses,
        (SELECT COUNT(*) FROM campaigns WHERE space_id=?) campaigns,
        (SELECT COUNT(*) FROM esign_envelopes WHERE space_id=?) agreements,
        (SELECT COUNT(*) FROM ai_jobs WHERE space_id=?) ai_jobs,
        (SELECT COUNT(*) FROM tickets t JOIN surveys s ON s.id=t.survey_id WHERE s.space_id=? AND t.status<>'closed') open_tickets,
        (SELECT COUNT(*) FROM knowledge_bases WHERE space_id=?) knowledge_bases`).get(id, id, id, id, id, id, id) as any;
    return response.json({
      space: spaceSummary(row), members, subscription: subscriptionForSpace(id),
      counts: {
        surveys: Number(counts?.surveys || 0), responses: Number(counts?.responses || 0), campaigns: Number(counts?.campaigns || 0),
        agreements: Number(counts?.agreements || 0), aiJobs: Number(counts?.ai_jobs || 0),
        openTickets: Number(counts?.open_tickets || 0), knowledgeBases: Number(counts?.knowledge_bases || 0)
      }
    });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.patch('/spaces/:id/status', (request, response) => {
  try {
    const actor = requireRootActor(request, response); if (!actor) return;
    const id = uuidSchema.parse(request.params.id);
    const input = z.object({ status: z.enum(spaceStatuses), reason: reasonSchema }).strict().parse(request.body);
    const result = db.transaction(() => {
      const current = db.prepare("SELECT id,COALESCE(status,'active') status FROM spaces WHERE id=?").get(id) as any;
      if (!current) throw new PlatformAdminError('Space not found.', 404, 'SPACE_NOT_FOUND');
      if (current.status === input.status) return { changed: false };
      const now = new Date().toISOString();
      db.prepare(`UPDATE spaces SET status=?,suspended_at=?,suspended_by_user_id=?,suspension_reason=?,updated_at=? WHERE id=?`).run(
        input.status, input.status === 'active' ? null : now, input.status === 'active' ? null : actor.id,
        input.status === 'active' ? '' : input.reason, now, id
      );
      recordAudit(request, actor, { action: 'space.status_changed', targetType: 'space', targetId: id, spaceId: id,
        reason: input.reason, before: { status: current.status }, after: { status: input.status } });
      return { changed: true };
    })();
    return response.json({ spaceId: id, status: input.status, changed: result.changed });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/subscriptions', requirePlatformCapability('readSubscriptions'), (request, response) => {
  try {
    const page = pageInput(paginationSchema.extend({ status: z.enum(['all', ...subscriptionStatuses]).default('all') }).parse(request.query));
    const search = page.search.toLowerCase(); const like = `%${search}%`;
    const where = `(?='' OR LOWER(s.name) LIKE ? OR LOWER(subscription.plan_code) LIKE ?)
      AND (?='all' OR subscription.status=?)`;
    const parameters = [search, like, like, page.status, page.status];
    const rows = db.prepare(`SELECT subscription.*,s.name space_name FROM platform_subscriptions subscription
      JOIN spaces s ON s.id=subscription.space_id WHERE ${where}
      ORDER BY subscription.updated_at DESC,subscription.id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, page.limit, page.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM platform_subscriptions subscription
      JOIN spaces s ON s.id=subscription.space_id WHERE ${where}`).get(...parameters) as any)?.count || 0);
    const subscriptions = rows.map((row) => ({ ...subscriptionRow(row), space: { id: row.space_id, name: row.space_name } }));
    return response.json(paged('subscriptions', subscriptions, page, total));
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.patch('/spaces/:id/subscription', (request, response) => {
  try {
    const actor = requireBillingActor(request, response); if (!actor) return;
    const spaceId = uuidSchema.parse(request.params.id);
    const input = z.object({ status: z.enum(subscriptionStatuses), reason: reasonSchema, expectedVersion: z.number().int().min(1) }).strict().parse(request.body);
    const subscription = db.transaction(() => {
      const current = db.prepare('SELECT * FROM platform_subscriptions WHERE space_id=?').get(spaceId) as any;
      if (!current) throw new PlatformAdminError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
      const now = new Date().toISOString();
      const changed = db.prepare(`UPDATE platform_subscriptions SET status=?,version=version+1,updated_at=?
        WHERE space_id=? AND version=?`).run(input.status, now, spaceId, input.expectedVersion).changes;
      if (changed !== 1) throw new PlatformAdminError('The subscription changed before this update.', 409, 'SUBSCRIPTION_VERSION_CONFLICT');
      const eventId = crypto.randomUUID();
      db.prepare(`INSERT INTO platform_subscription_events
        (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(eventId, spaceId, current.id, null, 'subscription.status_changed', actor.id,
        JSON.stringify({ from: current.status, to: input.status, reason: input.reason }), now);
      recordAudit(request, actor, { action: 'subscription.status_changed', targetType: 'subscription', targetId: current.id,
        spaceId, reason: input.reason, before: { status: current.status, version: Number(current.version) },
        after: { status: input.status, version: Number(current.version) + 1 } });
      return subscriptionForSpace(spaceId)!;
    })();
    return response.json({ subscription });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/subscription-requests', requirePlatformCapability('readSubscriptions'), (request, response) => {
  try {
    const page = pageInput(paginationSchema.extend({ status: z.enum(['all', ...requestStatuses]).default('pending') }).parse(request.query));
    const search = page.search.toLowerCase(); const like = `%${search}%`;
    const where = `(?='' OR LOWER(s.name) LIKE ? OR LOWER(r.requested_plan_code) LIKE ?)
      AND (?='all' OR r.status=?)`;
    const parameters = [search, like, like, page.status, page.status];
    const rows = db.prepare(`SELECT r.*,s.name space_name,requester.name requested_by_name,'' requested_by_email,reviewer.name reviewed_by_name
      FROM platform_subscription_requests r
      JOIN spaces s ON s.id=r.space_id JOIN users requester ON requester.id=r.requested_by_user_id
      LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by_user_id
      WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...parameters, page.limit, page.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM platform_subscription_requests r JOIN spaces s ON s.id=r.space_id
      WHERE ${where}`).get(...parameters) as any)?.count || 0);
    return response.json(paged('requests', rows.map(requestRow), page, total));
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/subscription-requests/:id', requirePlatformCapability('readSubscriptions'), (request, response) => {
  try {
    const actor = response.locals.platformActor as SessionUser;
    const id = uuidSchema.parse(request.params.id); const item = subscriptionRequestById(id, isRootPlatformAdmin(actor.id));
    if (!item) throw new PlatformAdminError('Subscription request not found.', 404, 'SUBSCRIPTION_REQUEST_NOT_FOUND');
    const decisionConflict = subscriptionDecisionConflict(actor.id, {
      requested_by_user_id: item.requestedBy?.id,
      space_id: item.spaceId
    });
    return response.json({
      request: item,
      subscription: subscriptionForSpace(item.spaceId),
      decisionConflict: {
        ...decisionConflict,
        breakGlassRequired: isRootPlatformAdmin(actor.id) && decisionConflict.conflicted,
        approvalForbidden: !isRootPlatformAdmin(actor.id) && decisionConflict.conflicted
      }
    });
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.post('/subscription-requests/:id/decision', (request, response) => {
  try {
    const actor = requireBillingActor(request, response); if (!actor) return;
    const id = uuidSchema.parse(request.params.id);
    const input = z.object({
      decision: z.enum(['approved', 'rejected']), reviewNote: noteSchema,
      expectedVersion: z.number().int().min(1), breakGlass: z.boolean()
    }).strict().parse(request.body);
    const result = db.transaction(() => {
      const current = db.prepare('SELECT * FROM platform_subscription_requests WHERE id=?').get(id) as any;
      if (!current) throw new PlatformAdminError('Subscription request not found.', 404, 'SUBSCRIPTION_REQUEST_NOT_FOUND');
      if (current.status !== 'pending') throw new PlatformAdminError('This request has already been decided.', 409, 'SUBSCRIPTION_REQUEST_DECIDED');
      const rootActor = isRootPlatformAdmin(actor.id);
      const conflict = subscriptionDecisionConflict(actor.id, current);
      if (!rootActor && conflict.reasons.includes('requester')) {
        throw new PlatformAdminError('A delegated billing approver cannot decide their own request.', 403, 'SUBSCRIPTION_SELF_APPROVAL_FORBIDDEN');
      }
      if (!rootActor && conflict.conflicted) {
        throw new PlatformAdminError('A delegated billing approver cannot decide a request for a space they belong to.', 403, 'SUBSCRIPTION_APPROVAL_CONFLICT');
      }
      if (rootActor && conflict.conflicted && !input.breakGlass) {
        throw new PlatformAdminError('This decision conflicts with your tenant role. Confirm an explicit break-glass approval to continue.', 409, 'SUBSCRIPTION_BREAK_GLASS_REQUIRED');
      }
      if (!conflict.conflicted && input.breakGlass) {
        throw new PlatformAdminError('Break-glass approval is only valid when the approver has a disclosed conflict.', 400, 'SUBSCRIPTION_BREAK_GLASS_NOT_REQUIRED');
      }
      const now = new Date().toISOString();
      const changed = db.prepare(`UPDATE platform_subscription_requests SET status=?,reviewed_by_user_id=?,review_note=?,decision_at=?,
        version=version+1,updated_at=? WHERE id=? AND status='pending' AND version=?`)
        .run(input.decision, actor.id, input.reviewNote, now, now, id, input.expectedVersion).changes;
      if (changed !== 1) throw new PlatformAdminError('The request changed before this decision.', 409, 'SUBSCRIPTION_REQUEST_VERSION_CONFLICT');

      let subscriptionId: string | null = null;
      if (input.decision === 'approved') {
        const requestType = String(current.request_type);
        const existing = db.prepare('SELECT * FROM platform_subscriptions WHERE space_id=?').get(current.space_id) as any;
        subscriptionId = existing?.id || crypto.randomUUID();
        if (requestType === 'cancel') {
          if (!existing) throw new PlatformAdminError('There is no subscription to cancel.', 409, 'SUBSCRIPTION_NOT_FOUND');
          db.prepare(`UPDATE platform_subscriptions SET status='cancelled',source_request_id=?,approved_by_user_id=?,
            version=version+1,updated_at=? WHERE id=?`).run(id, actor.id, now, existing.id);
        } else {
          const plan = validatedSubscriptionPlanSnapshot(current.plan_snapshot_json, String(current.requested_plan_code));
          if (!plan) {
            throw new PlatformAdminError('The requested plan terms changed. Ask the space to review and submit a new request.', 409, 'SUBSCRIPTION_PLAN_TERMS_CHANGED');
          }
          db.prepare(`INSERT INTO platform_subscriptions
            (id,space_id,plan_code,status,features_json,limits_json,source_request_id,approved_by_user_id,effective_at,expires_at,version,created_at,updated_at)
            VALUES (?,?,?,'active',?,?,?,?,?,NULL,1,?,?)
            ON CONFLICT(space_id) DO UPDATE SET plan_code=excluded.plan_code,status='active',features_json=excluded.features_json,
              limits_json=excluded.limits_json,source_request_id=excluded.source_request_id,approved_by_user_id=excluded.approved_by_user_id,
              effective_at=excluded.effective_at,expires_at=NULL,version=platform_subscriptions.version+1,updated_at=excluded.updated_at`)
            .run(subscriptionId, current.space_id, plan.code, JSON.stringify(plan.features), JSON.stringify(plan.limits), id, actor.id, now, now, now);
        }
      }

      db.prepare(`INSERT INTO platform_subscription_events
        (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), current.space_id, subscriptionId, id,
        `request.${input.decision}${input.breakGlass ? '.break_glass' : ''}`, actor.id, JSON.stringify({
          requestType: current.request_type, planCode: current.requested_plan_code,
          breakGlass: input.breakGlass, conflictReasons: conflict.reasons
        }), now);
      recordAudit(request, actor, { action: `subscription_request.${input.decision}`, targetType: 'subscription_request',
        targetId: id, spaceId: current.space_id, reason: input.reviewNote,
        before: { status: current.status, version: Number(current.version) },
        after: {
          status: input.decision, version: Number(current.version) + 1, planCode: current.requested_plan_code,
          breakGlass: input.breakGlass, conflictReasons: conflict.reasons
        } });
      if (input.breakGlass) {
        recordAudit(request, actor, { action: 'subscription_request.break_glass_used', targetType: 'subscription_request',
          targetId: id, spaceId: current.space_id, reason: input.reviewNote,
          before: { status: current.status, conflictReasons: conflict.reasons },
          after: { status: input.decision, approvedByUserId: actor.id, breakGlass: true } });
      }
      return { request: subscriptionRequestById(id, true)!, subscription: subscriptionForSpace(current.space_id) };
    })();
    return response.json(result);
  } catch (error) { return sendPlatformError(response, error); }
});

function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted-depth]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditValue(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (/(password|secret|token|authorization|cookie|api.?key|private.?key|answers?|document.?content|raw.?content|prompt)/i.test(key)) {
      result[key] = '[redacted]';
    } else {
      result[key] = redactAuditValue(child, depth + 1);
    }
  }
  return result;
}

function auditSummary(row: any, includeDetail = false, exposeNetwork = false) {
  return {
    id: String(row.id), actor: row.actor_user_id ? { id: String(row.actor_user_id), name: String(row.actor_name || '') } : null,
    actorRole: String(row.actor_role), action: String(row.action), targetType: String(row.target_type), targetId: String(row.target_id),
    spaceId: row.space_id || null, reason: String(row.reason || ''), requestId: String(row.request_id || ''), createdAt: row.created_at,
    ...(includeDetail ? {
      before: redactAuditValue(parseJson<JsonObject>(row.before_json, {})),
      after: redactAuditValue(parseJson<JsonObject>(row.after_json, {})),
      ...(exposeNetwork ? { ipAddress: row.ip_address || null, userAgent: row.user_agent || null } : {})
    } : {})
  };
}

platformAdminRouter.get('/audit-events', requirePlatformCapability('readAudit'), (request, response) => {
  try {
    const page = pageInput(paginationSchema.extend({ action: z.string().trim().max(120).default('') }).parse(request.query));
    const search = page.search.toLowerCase(); const like = `%${search}%`;
    const where = `(?='' OR LOWER(a.action) LIKE ? OR LOWER(a.target_type) LIKE ? OR LOWER(a.target_id) LIKE ?)
      AND (?='' OR a.action=?)`;
    const parameters = [search, like, like, like, page.action, page.action];
    const rows = db.prepare(`SELECT a.*,u.name actor_name FROM platform_audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...parameters, page.limit, page.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events a WHERE ${where}`).get(...parameters) as any)?.count || 0);
    return response.json(paged('events', rows.map((row) => auditSummary(row)), page, total));
  } catch (error) { return sendPlatformError(response, error); }
});

platformAdminRouter.get('/audit-events/:id', requirePlatformCapability('readAudit'), (request, response) => {
  try {
    const id = uuidSchema.parse(request.params.id);
    const row = db.prepare(`SELECT a.*,u.name actor_name FROM platform_audit_events a
      LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.id=?`).get(id) as any;
    if (!row) throw new PlatformAdminError('Audit event not found.', 404, 'AUDIT_EVENT_NOT_FOUND');
    const actor = response.locals.platformActor as SessionUser;
    return response.json({ event: auditSummary(row, true, isRootPlatformAdmin(actor.id)) });
  } catch (error) { return sendPlatformError(response, error); }
});

export const subscriptionRouter = express.Router();
noStoreRouter(subscriptionRouter);
subscriptionRouter.use((request, response, next) => {
  const user = account(request, response);
  if (!user) return;
  next();
});

subscriptionRouter.get('/plans', (_request, response) => response.json({ plans: planCatalog }));

subscriptionRouter.get('/current', (request, response) => {
  const context = tenantContext(request, response); if (!context) return;
  const subscription = subscriptionForSpace(context.space.id);
  const effective = effectiveSubscriptionForSpace(context.space.id);
  return response.json({
    space: { id: context.space.id, name: context.space.name, role: context.space.role },
    subscription,
    effectivePlan: effective.plan,
    entitlement: {
      source: effective.source,
      subscriptionStatus: effective.subscriptionStatus,
      catalogVersion: effective.catalogVersion
    }
  });
});

subscriptionRouter.get('/requests', (request, response) => {
  const context = tenantContext(request, response); if (!context) return;
  const rows = db.prepare(`SELECT r.*,requester.name requested_by_name,'' requested_by_email,reviewer.name reviewed_by_name
    FROM platform_subscription_requests r JOIN users requester ON requester.id=r.requested_by_user_id
    LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by_user_id
    WHERE r.space_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100`).all(context.space.id) as any[];
  const canManage = context.space.role === 'owner' || context.space.role === 'admin';
  const requests = rows.map(requestRow).map((item) => canManage ? item : {
    ...item,
    requestNote: '', reviewNote: '', requestedBy: null, reviewedBy: null
  });
  return response.json({ requests, detailAccess: canManage ? 'full' : 'redacted' });
});

subscriptionRouter.post('/requests', (request, response) => {
  try {
    const context = tenantContext(request, response); if (!context || !requireSpaceManager(context, response)) return;
    const input = z.union([
      z.object({ requestType: z.enum(['activate', 'change']).optional().default('change'), planCode: planCodeSchema, note: noteSchema }).strict(),
      z.object({ requestType: z.literal('cancel'), note: noteSchema }).strict()
    ]).parse(request.body);
    const currentSubscription = subscriptionForSpace(context.space.id);
    const requestType = input.requestType === 'cancel' ? 'cancel' : currentSubscription ? 'change' : 'activate';
    const plan = 'planCode' in input ? publicPlan(input.planCode) : null;
    if (requestType !== 'cancel' && !plan?.requestable) throw new PlatformAdminError('That subscription plan is not requestable.', 400, 'SUBSCRIPTION_PLAN_UNAVAILABLE');
    if (requestType === 'cancel' && !currentSubscription) throw new PlatformAdminError('This space does not have a managed subscription to cancel.', 409, 'SUBSCRIPTION_NOT_FOUND');
    const item = db.transaction(() => {
      const pending = db.prepare("SELECT id FROM platform_subscription_requests WHERE space_id=? AND status='pending'").get(context.space.id);
      if (pending) throw new PlatformAdminError('This space already has a pending subscription request.', 409, 'SUBSCRIPTION_REQUEST_PENDING');
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      db.prepare(`INSERT INTO platform_subscription_requests
        (id,space_id,request_type,requested_plan_code,request_note,plan_snapshot_json,status,requested_by_user_id,
          reviewed_by_user_id,review_note,decision_at,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,NULL,'',NULL,1,?,?)`).run(
        id, context.space.id, requestType, plan?.code || null, input.note,
        JSON.stringify(plan ? subscriptionPlanSnapshot(plan) : {
          catalogVersion: subscriptionCatalogVersion, requestType: 'cancel', plan: null
        }), context.user.id, now, now
      );
      db.prepare(`INSERT INTO platform_subscription_events
        (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), context.space.id, currentSubscription?.id || null, id,
        'request.created', context.user.id, JSON.stringify({ requestType, planCode: plan?.code || null }), now);
      recordAudit(request, context.user, { action: 'subscription_request.created', targetType: 'subscription_request',
        targetId: id, spaceId: context.space.id, reason: input.note,
        before: { status: null }, after: { status: 'pending', requestType, planCode: plan?.code || null } });
      return subscriptionRequestById(id)!;
    })();
    return response.status(201).json({ request: item });
  } catch (error) { return sendPlatformError(response, error); }
});

subscriptionRouter.post('/requests/:id/cancel', (request, response) => {
  try {
    const context = tenantContext(request, response); if (!context || !requireSpaceManager(context, response)) return;
    const id = uuidSchema.parse(request.params.id);
    const input = z.object({ reason: reasonSchema, expectedVersion: z.number().int().min(1) }).strict().parse(request.body);
    const item = db.transaction(() => {
      const current = db.prepare(`SELECT * FROM platform_subscription_requests
        WHERE id=? AND space_id=?`).get(id, context.space.id) as any;
      if (!current) throw new PlatformAdminError('Subscription request not found.', 404, 'SUBSCRIPTION_REQUEST_NOT_FOUND');
      if (current.status !== 'pending') throw new PlatformAdminError('Only a pending request can be cancelled.', 409, 'SUBSCRIPTION_REQUEST_DECIDED');
      const now = new Date().toISOString();
      const changed = db.prepare(`UPDATE platform_subscription_requests SET status='cancelled',review_note=?,decision_at=?,
        version=version+1,updated_at=? WHERE id=? AND space_id=? AND status='pending' AND version=?`)
        .run(input.reason, now, now, id, context.space.id, input.expectedVersion).changes;
      if (changed !== 1) throw new PlatformAdminError('The request changed before it could be cancelled.', 409, 'SUBSCRIPTION_REQUEST_VERSION_CONFLICT');
      db.prepare(`INSERT INTO platform_subscription_events
        (id,space_id,subscription_id,request_id,event_type,actor_user_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), context.space.id, subscriptionForSpace(context.space.id)?.id || null,
        id, 'request.cancelled', context.user.id, JSON.stringify({ reason: input.reason }), now);
      recordAudit(request, context.user, { action: 'subscription_request.cancelled', targetType: 'subscription_request',
        targetId: id, spaceId: context.space.id, reason: input.reason,
        before: { status: current.status, version: Number(current.version) },
        after: { status: 'cancelled', version: Number(current.version) + 1 } });
      return subscriptionRequestById(id)!;
    })();
    return response.json({ request: item });
  } catch (error) { return sendPlatformError(response, error); }
});
