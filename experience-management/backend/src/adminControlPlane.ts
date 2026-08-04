import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AccountProvisionError, currentSessionUser, isPlatformAdmin, isRootPlatformAdmin,
  provisionUserInvitation, type SessionUser
} from './auth.js';
import {
  getAdminCodexDefaults, resetAdminCodexDefaults, updateAdminCodexDefaults
} from './aiProvider.js';
import { aiJobRuntime } from './aiJobRuntime.js';
import { codexActionCatalog } from './codexActionCatalog.js';
import { codexClientForUser, codexRuntimeError } from './codexAppServer.js';
import { config } from './config.js';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import {
  activeControlPlaneRoleIds, assignControlPlaneRole, controlPlanePermissionsForUser,
  controlPlaneRoleAssignments, createControlPlaneRole, hasControlPlanePermission,
  listControlPlaneRoles, platformPermissionCatalog, platformPermissionIds,
  replaceControlPlaneRolePermissions, updateControlPlaneRoleMetadata,
  type PlatformPermissionId
} from './platformRbac.js';
import { TerraError } from './terraClient.js';

type JsonObject = Record<string, unknown>;

class AdminControlError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'ADMIN_CONTROL_ERROR') {
    super(message);
    this.name = 'AdminControlError';
    this.status = status;
    this.code = code;
  }
}

const uuidSchema = z.string().uuid();
const roleIdSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/u);
const reasonSchema = z.string().trim().min(5).max(1_000);
const permissionSchema = z.string().refine((value): value is PlatformPermissionId => platformPermissionIds.has(value), {
  message: 'Unknown platform permission.'
});
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  search: z.string().trim().max(160).default('')
});

function json<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function requestId(request: Request) {
  const supplied = String(request.get('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{8,120}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function actorRole(actor: SessionUser) {
  if (isRootPlatformAdmin(actor.id)) return 'superadmin';
  return activeControlPlaneRoleIds(actor.id)[0] || 'workspace_user';
}

function recordAudit(request: Request, actor: SessionUser, input: {
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  spaceId?: string | null;
  before?: JsonObject;
  after?: JsonObject;
}) {
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,
      request_id,ip_address,user_agent,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), actor.id, actorRole(actor), input.action, input.targetType, input.targetId,
      input.spaceId || null, input.reason || '', JSON.stringify(input.before || {}), JSON.stringify(input.after || {}),
      requestId(request), String(request.ip || '').slice(0, 100),
      String(request.get('user-agent') || '').slice(0, 500), new Date().toISOString()
    );
}

function sendError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues });
  }
  if (error instanceof AdminControlError || error instanceof AccountProvisionError || error instanceof TerraError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  if (isDatabaseConstraintError(error)) {
    return response.status(409).json({ error: 'The requested change conflicts with current platform state.', code: 'PLATFORM_STATE_CONFLICT' });
  }
  console.error('Admin control-plane request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The administration request could not be completed.', code: 'ADMIN_CONTROL_INTERNAL_ERROR' });
}

function authenticatedActor(request: Request, response: Response) {
  const actor = currentSessionUser(request);
  if (!actor) {
    response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    return null;
  }
  if (!actor.emailVerifiedAt) {
    response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
    return null;
  }
  if (!isPlatformAdmin(actor.id)) {
    response.status(403).json({ error: 'Platform administrator access is required.', code: 'PLATFORM_ADMIN_REQUIRED' });
    return null;
  }
  return actor;
}

function requirePermission(permission: PlatformPermissionId) {
  return (request: Request, response: Response, next: NextFunction) => {
    const actor = authenticatedActor(request, response);
    if (!actor) return;
    if (!isRootPlatformAdmin(actor.id) && !hasControlPlanePermission(actor.id, permission)) {
      return response.status(403).json({
        error: 'This administrator role does not grant the requested permission.',
        code: 'ADMIN_PERMISSION_REQUIRED', permission
      });
    }
    response.locals.adminActor = actor;
    return next();
  };
}

function mutationOriginGuard(request: Request, response: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return next();
  const origin = String(request.get('origin') || '').trim();
  if (!origin) return next();
  let expected = '';
  try { expected = new URL(config.publicUrl).origin; } catch { /* configuration validation reports this elsewhere */ }
  let loopback = false;
  try {
    const parsed = new URL(origin); const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const remote = String(request.ip || request.socket.remoteAddress || '').toLowerCase();
    const trustedOrigins = new Set([
      `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, `http://[::1]:${config.port}`
    ]);
    loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (remote === '::1' || remote === '127.0.0.1' || remote.startsWith('::ffff:127.'))
      && trustedOrigins.has(parsed.origin);
  } catch { /* rejected below */ }
  if ((!expected || origin !== expected) && !loopback) {
    return response.status(403).json({ error: 'Cross-origin administration requests are not allowed.', code: 'ADMIN_ORIGIN_REJECTED' });
  }
  return next();
}

function page<T>(items: T[], total: number, input: { limit: number; offset: number }) {
  const hasMore = input.offset + items.length < total;
  return { items, total, pagination: { limit: input.limit, offset: input.offset, total, hasMore } };
}

function assertRoleExists(roleId: string) {
  const role = listControlPlaneRoles().find((item) => item.id === roleId);
  if (!role) throw new AdminControlError('Role not found.', 404, 'ADMIN_ROLE_NOT_FOUND');
  return role;
}

function assertPermissionGrantCeiling(actor: SessionUser, permissions: readonly PlatformPermissionId[]) {
  if (isRootPlatformAdmin(actor.id)) return;
  const actorPermissions = new Set(controlPlanePermissionsForUser(actor.id));
  const excessive = [...new Set(permissions)].filter((permission) => !actorPermissions.has(permission));
  if (excessive.length) {
    throw new AdminControlError(
      'Administrators may only grant permissions they currently hold.',
      403, 'ADMIN_PERMISSION_GRANT_EXCEEDS_ACTOR'
    );
  }
}

function canReadUserIdentity(actor: SessionUser) {
  return isRootPlatformAdmin(actor.id) || hasControlPlanePermission(actor.id, 'users.read');
}

function safeError(value: unknown) {
  return String(value || '').trim()
    ? { code: 'AI_JOB_FAILED', message: 'The AI job failed. Use the job ID to inspect protected service logs.' }
    : null;
}

function jobProjection(row: any, includeUserIdentity: boolean) {
  return {
    id: String(row.id), kind: String(row.kind), state: String(row.state), stage: String(row.stage),
    progress: Number(row.progress || 0), attempt: Number(row.attempt || 0),
    requester: row.requested_by && includeUserIdentity
      ? { id: String(row.requested_by), name: String(row.requester_name || ''), email: String(row.requester_email || '') }
      : null,
    requesterRestricted: Boolean(row.requested_by) && !includeUserIdentity,
    space: { id: String(row.space_id), name: String(row.space_name || '') },
    runtime: aiJobRuntime({ jobInput: row.input_json, jobResult: row.result_json,
      providerResult: row.provider_result_json, actionId: String(row.kind) }),
    retryAt: row.retry_at || null, error: safeError(row.error), createdAt: row.created_at,
    startedAt: row.started_at || null, completedAt: row.completed_at || null, updatedAt: row.updated_at
  };
}

export const adminControlPlaneRouter = express.Router();
adminControlPlaneRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store'); response.vary('Cookie'); next();
});
adminControlPlaneRouter.use(mutationOriginGuard);

adminControlPlaneRouter.get('/rbac', requirePermission('roles.read'), (_request, response) => {
  return response.json({ permissions: platformPermissionCatalog, roles: listControlPlaneRoles() });
});
adminControlPlaneRouter.get('/rbac/permissions', requirePermission('roles.read'), (_request, response) => {
  return response.json({ permissions: platformPermissionCatalog });
});
adminControlPlaneRouter.get('/rbac/roles', requirePermission('roles.read'), (_request, response) => {
  return response.json({ roles: listControlPlaneRoles() });
});

adminControlPlaneRouter.post('/rbac/roles', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser;
    const input = z.object({
      name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default(''),
      permissions: z.array(permissionSchema).max(platformPermissionCatalog.length).default([])
    }).strict().parse(request.body);
    if (db.prepare('SELECT 1 FROM platform_rbac_roles WHERE LOWER(name)=LOWER(?)').get(input.name)) {
      throw new AdminControlError('A role with that name already exists.', 409, 'ADMIN_ROLE_NAME_EXISTS');
    }
    assertPermissionGrantCeiling(actor, input.permissions);
    const role = db.transaction(() => {
      const created = createControlPlaneRole({ ...input, actorUserId: actor.id });
      recordAudit(request, actor, { action: 'admin_role.created', targetType: 'admin_role', targetId: created.id,
        reason: 'Custom administrator role created.', after: { name: created.name, permissions: created.permissions } });
      return created;
    })();
    return response.status(201).json({ role });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.patch('/rbac/roles/:roleId', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const roleId = roleIdSchema.parse(request.params.roleId);
    const before = assertRoleExists(roleId);
    assertPermissionGrantCeiling(actor, before.permissions);
    const input = z.object({
      name: z.string().trim().min(2).max(80), description: z.string().trim().max(500),
      expectedVersion: z.number().int().min(1).optional()
    }).strict().parse(request.body);
    if (db.prepare('SELECT 1 FROM platform_rbac_roles WHERE LOWER(name)=LOWER(?) AND id<>?').get(input.name, roleId)) {
      throw new AdminControlError('A role with that name already exists.', 409, 'ADMIN_ROLE_NAME_EXISTS');
    }
    const role = db.transaction(() => {
      const result = updateControlPlaneRoleMetadata({ roleId, ...input });
      if (result.status === 'not_found') throw new AdminControlError('Role not found.', 404, 'ADMIN_ROLE_NOT_FOUND');
      if (result.status === 'conflict') throw new AdminControlError('The role changed before this update.', 409, 'ADMIN_ROLE_VERSION_CONFLICT');
      const updated = assertRoleExists(roleId);
      recordAudit(request, actor, { action: 'admin_role.updated', targetType: 'admin_role', targetId: roleId,
        reason: 'Administrator role metadata updated.', before: { name: before.name, description: before.description },
        after: { name: updated.name, description: updated.description } });
      return updated;
    })();
    return response.json({ role });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.put('/rbac/roles/:roleId/permissions', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const roleId = roleIdSchema.parse(request.params.roleId);
    const before = assertRoleExists(roleId);
    const input = z.object({
      permissions: z.array(permissionSchema).max(platformPermissionCatalog.length),
      expectedVersion: z.number().int().min(1).optional()
    }).strict().parse(request.body);
    assertPermissionGrantCeiling(actor, before.permissions);
    assertPermissionGrantCeiling(actor, input.permissions);
    if (!isRootPlatformAdmin(actor.id) && before.permissions.includes('roles.manage')
      && !input.permissions.includes('roles.manage')) {
      const actorUsesRole = db.prepare(`SELECT 1 FROM platform_rbac_user_roles
        WHERE user_id=? AND role_id=? AND revoked_at IS NULL`).get(actor.id, roleId);
      const alternatePath = db.prepare(`SELECT 1 FROM platform_rbac_user_roles assignment
        JOIN platform_rbac_role_permissions permission ON permission.role_id=assignment.role_id
        WHERE assignment.user_id=? AND assignment.revoked_at IS NULL AND assignment.role_id<>?
          AND permission.permission='roles.manage' LIMIT 1`).get(actor.id, roleId);
      if (actorUsesRole && !alternatePath) {
        throw new AdminControlError(
          'Assign yourself another role with roles.manage before removing your final role-management permission.',
          409, 'ADMIN_ROLE_SELF_LOCKOUT_BLOCKED'
        );
      }
    }
    const role = db.transaction(() => {
      const result = replaceControlPlaneRolePermissions({ roleId, permissions: input.permissions,
        expectedVersion: input.expectedVersion, actorUserId: actor.id });
      if (result.status === 'not_found') throw new AdminControlError('Role not found.', 404, 'ADMIN_ROLE_NOT_FOUND');
      if (result.status === 'conflict') throw new AdminControlError('The role changed before this update.', 409, 'ADMIN_ROLE_VERSION_CONFLICT');
      const updated = assertRoleExists(roleId);
      recordAudit(request, actor, { action: 'admin_role.permissions_changed', targetType: 'admin_role', targetId: roleId,
        reason: 'Administrator role permissions updated.', before: { permissions: before.permissions, version: before.version },
        after: { permissions: updated.permissions, version: updated.version } });
      return updated;
    })();
    return response.json({ role });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.delete('/rbac/roles/:roleId', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const roleId = roleIdSchema.parse(request.params.roleId);
    const input = z.object({ reason: reasonSchema }).strict().parse(request.body || {}); const role = assertRoleExists(roleId);
    assertPermissionGrantCeiling(actor, role.permissions);
    if (role.builtIn) throw new AdminControlError('Built-in roles cannot be deleted.', 409, 'BUILT_IN_ROLE_PROTECTED');
    const assignmentHistory = Number((db.prepare(`SELECT COUNT(*) count FROM platform_rbac_user_roles
      WHERE role_id=?`).get(roleId) as any)?.count || 0);
    if (assignmentHistory) {
      throw new AdminControlError('Roles with assignment history cannot be deleted.', 409, 'ADMIN_ROLE_HAS_HISTORY');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM platform_rbac_roles WHERE id=? AND built_in=0').run(roleId);
      recordAudit(request, actor, { action: 'admin_role.deleted', targetType: 'admin_role', targetId: roleId,
        reason: input.reason, before: { name: role.name, permissions: role.permissions }, after: { deleted: true } });
    })();
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.post('/users', requirePermission('users.create'), async (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser;
    const input = z.object({
      email: z.string().trim().email().max(254), name: z.string().trim().min(2).max(100),
      spaceName: z.string().trim().min(2).max(100).optional(), roleId: roleIdSchema.optional()
    }).strict().parse(request.body);
    if (input.roleId && !isRootPlatformAdmin(actor.id) && !hasControlPlanePermission(actor.id, 'roles.manage')) {
      throw new AdminControlError('Role assignment requires roles.manage.', 403, 'ADMIN_PERMISSION_REQUIRED');
    }
    const requestedRole = input.roleId ? assertRoleExists(input.roleId) : null;
    if (requestedRole) assertPermissionGrantCeiling(actor, requestedRole.permissions);
    const created = await provisionUserInvitation(input);
    const assignment = db.transaction(() => {
      const assigned = input.roleId ? assignControlPlaneRole({ userId: created.user.id, roleId: input.roleId,
        actorUserId: actor.id, reason: 'Assigned during administrator provisioning.' }) : null;
      recordAudit(request, actor, { action: 'user.provisioned', targetType: 'user', targetId: created.user.id,
        reason: 'User invited by a platform administrator.', after: {
          email: created.user.email, invitationDelivery: created.invitation.delivery.state, roleId: input.roleId || null
        } });
      return assigned;
    })();
    return response.status(201).json({ ...created, assignment });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.get('/users/:id/admin-roles', requirePermission('roles.read'), (request, response) => {
  try {
    const userId = uuidSchema.parse(request.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new AdminControlError('User not found.', 404, 'USER_NOT_FOUND');
    return response.json({ userId, assignments: controlPlaneRoleAssignments(userId) });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.post('/users/:id/admin-roles', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const userId = uuidSchema.parse(request.params.id);
    const input = z.object({ roleId: roleIdSchema, reason: reasonSchema }).strict().parse(request.body);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new AdminControlError('User not found.', 404, 'USER_NOT_FOUND');
    const role = assertRoleExists(input.roleId);
    assertPermissionGrantCeiling(actor, role.permissions);
    if (db.prepare(`SELECT 1 FROM platform_rbac_user_roles WHERE user_id=? AND role_id=? AND revoked_at IS NULL`).get(userId, input.roleId)) {
      throw new AdminControlError('That administrator role is already active.', 409, 'ADMIN_ROLE_ALREADY_ACTIVE');
    }
    const assignment = db.transaction(() => {
      const assigned = assignControlPlaneRole({ userId, roleId: input.roleId, actorUserId: actor.id, reason: input.reason });
      recordAudit(request, actor, { action: 'user.admin_role_assigned', targetType: 'user', targetId: userId,
        reason: input.reason, before: { roleId: input.roleId, active: false }, after: { roleId: input.roleId, active: true } });
      return assigned;
    })();
    return response.status(201).json({ assignment });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.delete('/users/:userId/admin-roles/:assignmentId', requirePermission('roles.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const userId = uuidSchema.parse(request.params.userId);
    const assignmentId = uuidSchema.parse(request.params.assignmentId);
    const input = z.object({ reason: reasonSchema }).strict().parse(request.body || {});
    db.transaction(() => {
      const assignment = db.prepare(`SELECT assignment.role_id,
          EXISTS(SELECT 1 FROM platform_rbac_role_permissions permission
            WHERE permission.role_id=assignment.role_id AND permission.permission='roles.manage') supplies_role_management
        FROM platform_rbac_user_roles assignment
        WHERE assignment.id=? AND assignment.user_id=? AND assignment.revoked_at IS NULL`)
        .get(assignmentId, userId) as { role_id: string; supplies_role_management: number | boolean } | undefined;
      if (!assignment) throw new AdminControlError('Active administrator role assignment not found.', 404, 'ADMIN_ROLE_ASSIGNMENT_NOT_FOUND');
      assertPermissionGrantCeiling(actor, assertRoleExists(assignment.role_id).permissions);
      if (!isRootPlatformAdmin(actor.id) && actor.id === userId && Boolean(assignment.supplies_role_management)) {
        const alternatePath = db.prepare(`SELECT 1 FROM platform_rbac_user_roles alternate
          JOIN platform_rbac_role_permissions permission ON permission.role_id=alternate.role_id
          WHERE alternate.user_id=? AND alternate.revoked_at IS NULL AND alternate.id<>?
            AND permission.permission='roles.manage' LIMIT 1`).get(actor.id, assignmentId);
        if (!alternatePath) {
          throw new AdminControlError(
            'Assign yourself another role with roles.manage before revoking your final role-management assignment.',
            409, 'ADMIN_ROLE_SELF_LOCKOUT_BLOCKED'
          );
        }
      }
      const now = new Date().toISOString();
      const changed = db.prepare(`UPDATE platform_rbac_user_roles SET revoked_by_user_id=?,revoked_at=?,revocation_reason=?
        WHERE id=? AND user_id=? AND revoked_at IS NULL`).run(actor.id, now, input.reason, assignmentId, userId).changes;
      if (changed !== 1) throw new AdminControlError('The assignment changed before it could be revoked.', 409, 'ADMIN_ROLE_ASSIGNMENT_CONFLICT');
      recordAudit(request, actor, { action: 'user.admin_role_revoked', targetType: 'user', targetId: userId,
        reason: input.reason, before: { roleId: assignment.role_id, active: true }, after: { roleId: assignment.role_id, active: false } });
    })();
    return response.status(204).end();
  } catch (error) { return sendError(response, error); }
});

async function actorCodexCatalog(actorId: string) {
  try {
    const client = codexClientForUser(actorId); const account = await client.accountStatus();
    const models = account.connected ? (await client.models()).filter((model) => !model.hidden && model.id && model.displayName) : [];
    return { available: true, account, models, actions: codexActionCatalog, error: null };
  } catch (error) {
    return { available: false, account: { connected: false, email: null, planType: null, authMode: null,
      pendingLogin: false, loginError: null }, models: [], actions: codexActionCatalog, error: codexRuntimeError(error) };
  }
}

adminControlPlaneRouter.get('/ai-defaults', requirePermission('ai_defaults.read'), async (_request, response) => {
  const actor = response.locals.adminActor as SessionUser;
  return response.json({ defaults: getAdminCodexDefaults(), codex: await actorCodexCatalog(actor.id) });
});

adminControlPlaneRouter.put('/ai-defaults', requirePermission('ai_defaults.manage'), async (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const before = getAdminCodexDefaults();
    const setting = z.string().trim().min(1).max(200).nullable();
    const input = z.object({
      codexModel: setting.optional(), codexReasoningEffort: setting.optional(),
      codexActionOverrides: z.record(z.string().trim().min(1).max(100), z.object({
        model: setting.optional(), reasoningEffort: setting.optional(), reasoningEffortAuto: z.boolean().optional()
      }).strict()).refine((value) => Object.keys(value).length <= 100, 'Too many action overrides.').optional(),
      runtimePolicy: z.object({
        localEnabled: z.boolean(), chatgptEnabled: z.boolean(),
        defaultRuntime: z.enum(['local', 'chatgpt'])
      }).strict().optional()
    }).strict().parse(request.body);
    const defaults = await updateAdminCodexDefaults(actor.id, input);
    recordAudit(request, actor, { action: 'ai_defaults.updated', targetType: 'ai_defaults', targetId: 'platform',
      reason: 'Platform ChatGPT defaults updated.', before, after: defaults });
    return response.json({ defaults, codex: await actorCodexCatalog(actor.id) });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.delete('/ai-defaults', requirePermission('ai_defaults.manage'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser; const before = getAdminCodexDefaults();
    const defaults = resetAdminCodexDefaults();
    recordAudit(request, actor, { action: 'ai_defaults.reset', targetType: 'ai_defaults', targetId: 'platform',
      reason: 'Platform ChatGPT defaults reset.', before, after: defaults });
    return response.json({ defaults });
  } catch (error) { return sendError(response, error); }
});

const jobSelect = `SELECT j.id,j.kind,j.state,j.stage,j.progress,j.attempt,j.requested_by,j.space_id,j.input_json,
  j.result_json,j.provider_result_json,
  j.error,j.retry_at,j.created_at,j.started_at,j.completed_at,j.updated_at,
  requester.name requester_name,requester.email requester_email,space.name space_name
  FROM ai_jobs j LEFT JOIN users requester ON requester.id=j.requested_by JOIN spaces space ON space.id=j.space_id`;

function jobFilters(query: unknown, includeState = true, includeUserIdentity = false) {
  const input = paginationSchema.extend({
    state: z.enum(['all', 'queued', 'processing', 'completed', 'failed']).default('all'),
    provider: z.enum(['all', 'terra', 'codex']).default('all'),
    kind: z.string().trim().max(100).default('')
  }).parse(query);
  const search = input.search.toLowerCase(); const like = `%${search}%`;
  const identitySearch = includeUserIdentity
    ? " OR LOWER(COALESCE(requester.name,'')) LIKE ? OR LOWER(COALESCE(requester.email,'')) LIKE ?"
    : '';
  const where = `${includeState ? "(?='all' OR j.state=?) AND" : ''}
    (?='' OR j.kind=?) AND
    (?='all' OR COALESCE(CASE WHEN json_valid(j.input_json)
      THEN json_extract(j.input_json,'$._aiRuntime.provider') END,'terra')=?) AND
    (?='' OR LOWER(j.id) LIKE ? OR LOWER(j.kind) LIKE ?${identitySearch} OR LOWER(space.name) LIKE ?)`;
  const parameters = [
    ...(includeState ? [input.state, input.state] : []), input.kind, input.kind,
    input.provider, input.provider, search, like, like, ...(includeUserIdentity ? [like, like] : []), like
  ];
  return { input, where, parameters };
}

function globalJobSummary() {
  const rows = db.prepare('SELECT state,COUNT(*) count FROM ai_jobs GROUP BY state').all() as any[];
  const byState = Object.fromEntries(rows.map((row) => [String(row.state), Number(row.count)]));
  const total = Object.values(byState).reduce((sum, value) => sum + Number(value), 0);
  return { total, active: Number(byState.queued || 0) + Number(byState.processing || 0), failed: Number(byState.failed || 0), byState };
}

adminControlPlaneRouter.get('/jobs/summary', requirePermission('jobs.read'), (_request, response) => {
  return response.json({ summary: globalJobSummary(), generatedAt: new Date().toISOString() });
});

adminControlPlaneRouter.get('/jobs', requirePermission('jobs.read'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser;
    const includeUserIdentity = canReadUserIdentity(actor);
    const { input, where, parameters } = jobFilters(request.query, true, includeUserIdentity);
    const rows = db.prepare(`${jobSelect} WHERE ${where} ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, input.limit, input.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count FROM ai_jobs j LEFT JOIN users requester ON requester.id=j.requested_by
      JOIN spaces space ON space.id=j.space_id WHERE ${where}`).get(...parameters) as any)?.count || 0);
    const jobs = rows.map((row) => jobProjection(row, includeUserIdentity));
    return response.json({ jobs, ...page(jobs, total, input), summary: globalJobSummary(), generatedAt: new Date().toISOString() });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.get('/jobs/:id', requirePermission('jobs.read'), (request, response) => {
  try {
    const actor = response.locals.adminActor as SessionUser;
    const id = uuidSchema.parse(request.params.id); const row = db.prepare(`${jobSelect} WHERE j.id=?`).get(id) as any;
    if (!row) throw new AdminControlError('AI job not found.', 404, 'AI_JOB_NOT_FOUND');
    return response.json({ job: jobProjection(row, canReadUserIdentity(actor)) });
  } catch (error) { return sendError(response, error); }
});

const activityUnion = `
  SELECT 'account.created' event_type,'account' entity_type,u.id entity_id,u.id actor_user_id,NULL space_id,
    COALESCE(u.account_status,'active') status,NULL kind,u.created_at occurred_at FROM users u
  UNION ALL SELECT 'space.created','space',s.id,s.created_by_user_id,s.id,COALESCE(s.status,'active'),NULL,s.created_at FROM spaces s
  UNION ALL SELECT 'survey.created','survey',survey.id,NULL,survey.space_id,survey.status,NULL,survey.created_at FROM surveys survey
  UNION ALL SELECT 'response.completed','response',response.id,NULL,survey.space_id,response.status,NULL,response.completed_at
    FROM responses response JOIN surveys survey ON survey.id=response.survey_id WHERE response.completed_at IS NOT NULL
  UNION ALL SELECT 'campaign.created','campaign',campaign.id,NULL,campaign.space_id,campaign.status,NULL,campaign.created_at FROM campaigns campaign
  UNION ALL SELECT 'agreement.created','agreement',agreement.id,agreement.created_by_user_id,agreement.space_id,agreement.status,NULL,agreement.created_at
    FROM esign_envelopes agreement
  UNION ALL SELECT 'knowledge_base.created','knowledge_base',knowledge.id,knowledge.created_by,knowledge.space_id,knowledge.status,NULL,knowledge.created_at
    FROM knowledge_bases knowledge
  UNION ALL SELECT 'ai_job.created','ai_job',job.id,job.requested_by,job.space_id,job.state,job.kind,job.created_at FROM ai_jobs job`;

adminControlPlaneRouter.get('/activity', requirePermission('activity.read'), (request, response) => {
  try {
    const actorUser = response.locals.adminActor as SessionUser;
    const includeUserIdentity = canReadUserIdentity(actorUser);
    const input = paginationSchema.extend({
      type: z.enum(['all', 'account', 'space', 'survey', 'response', 'campaign', 'agreement', 'knowledge_base', 'ai_job']).default('all')
    }).parse(request.query);
    const search = input.search.toLowerCase(); const like = `%${search}%`;
    const identitySearch = includeUserIdentity
      ? " OR LOWER(COALESCE(actor.name,'')) LIKE ? OR LOWER(COALESCE(actor.email,'')) LIKE ?"
      : '';
    const where = `(?=1 OR event.entity_type<>'account') AND (?='all' OR event.entity_type=?) AND
      (?='' OR LOWER(event.entity_id) LIKE ? OR LOWER(event.event_type) LIKE ? OR LOWER(COALESCE(event.kind,'')) LIKE ?
        OR LOWER(COALESCE(event.status,'')) LIKE ?${identitySearch} OR LOWER(COALESCE(space.name,'')) LIKE ?)`;
    const parameters = [includeUserIdentity ? 1 : 0, input.type, input.type, search, like, like, like, like,
      ...(includeUserIdentity ? [like, like] : []), like];
    const source = `FROM (${activityUnion}) event LEFT JOIN users actor ON actor.id=event.actor_user_id
      LEFT JOIN spaces space ON space.id=event.space_id`;
    const rows = db.prepare(`SELECT event.*,actor.name actor_name,actor.email actor_email,space.name space_name
      ${source} WHERE ${where} ORDER BY event.occurred_at DESC,event.entity_id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, input.limit, input.offset) as any[];
    const total = Number((db.prepare(`SELECT COUNT(*) count ${source} WHERE ${where}`).get(...parameters) as any)?.count || 0);
    const activity = rows.map((row) => ({
      id: `${row.event_type}:${row.entity_id}`, type: String(row.event_type), entityType: String(row.entity_type),
      entityId: String(row.entity_id), status: row.status || null, kind: row.kind || null,
      actor: row.actor_user_id && includeUserIdentity
        ? { id: String(row.actor_user_id), name: String(row.actor_name || ''), email: String(row.actor_email || '') }
        : null,
      actorRestricted: Boolean(row.actor_user_id) && !includeUserIdentity,
      space: row.space_id ? { id: String(row.space_id), name: String(row.space_name || '') } : null,
      occurredAt: row.occurred_at
    }));
    return response.json({ activity, ...page(activity, total, input), generatedAt: new Date().toISOString() });
  } catch (error) { return sendError(response, error); }
});

adminControlPlaneRouter.get('/access', (request, response) => {
  const actor = authenticatedActor(request, response); if (!actor) return;
  return response.json({
    roles: activeControlPlaneRoleIds(actor.id),
    permissions: isRootPlatformAdmin(actor.id)
      ? platformPermissionCatalog.map((permission) => permission.id)
      : controlPlanePermissionsForUser(actor.id),
    root: isRootPlatformAdmin(actor.id)
  });
});
