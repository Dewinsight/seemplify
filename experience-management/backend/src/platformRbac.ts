import crypto from 'node:crypto';
import { db } from './database.js';

export const platformPermissionCatalog = [
  { id: 'users.read', label: 'View users', description: 'View account and membership metadata.' },
  { id: 'users.create', label: 'Create users', description: 'Invite users to create a password and activate their account.' },
  { id: 'users.manage', label: 'Manage users', description: 'Change account status and revoke active sessions.' },
  { id: 'roles.read', label: 'View roles', description: 'View control-plane roles, permissions, and assignments.' },
  { id: 'roles.manage', label: 'Manage roles', description: 'Change role permissions and user role assignments.' },
  { id: 'spaces.read', label: 'View spaces', description: 'View operational space metadata.' },
  { id: 'spaces.manage', label: 'Manage spaces', description: 'Change operational space status.' },
  { id: 'subscriptions.read', label: 'View subscriptions', description: 'View subscription and request metadata.' },
  { id: 'subscriptions.manage', label: 'Manage subscriptions', description: 'Decide and update subscription state.' },
  { id: 'analytics.read', label: 'View analytics', description: 'View aggregate platform analytics.' },
  { id: 'ai_defaults.read', label: 'View AI defaults', description: 'View platform ChatGPT model and effort defaults.' },
  { id: 'ai_defaults.manage', label: 'Manage AI defaults', description: 'Change platform ChatGPT model and effort defaults.' },
  { id: 'jobs.read', label: 'View global AI jobs', description: 'View privacy-safe operational AI queue metadata.' },
  { id: 'activity.read', label: 'View activity', description: 'View privacy-safe product activity across spaces.' },
  { id: 'audit.read', label: 'View audit log', description: 'View administrative mutation history.' }
] as const;

export type PlatformPermissionId = typeof platformPermissionCatalog[number]['id'];
export type ControlPlaneRoleId = string;

const allPermissions = platformPermissionCatalog.map((permission) => permission.id);

export const seededControlPlaneRoles: ReadonlyArray<{
  id: 'admin' | 'editor' | 'viewer';
  name: string;
  description: string;
  permissions: readonly PlatformPermissionId[];
}> = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full control-plane administration, including roles and user provisioning.',
    permissions: allPermissions
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Operational management without permission or role administration.',
    permissions: allPermissions.filter((permission) => !['roles.manage', 'subscriptions.manage'].includes(permission))
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to users, roles, spaces, analytics, jobs, activity, and audit history.',
    permissions: allPermissions.filter((permission) => permission.endsWith('.read'))
  }
];

export const platformPermissionIds = new Set<string>(allPermissions);
export const controlPlaneRoleIds = new Set<string>(seededControlPlaneRoles.map((role) => role.id));

export function seedControlPlaneRoles() {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const role of seededControlPlaneRoles) {
      const exists = db.prepare('SELECT 1 FROM platform_rbac_roles WHERE id=?').get(role.id);
      if (exists) continue;
      db.prepare(`INSERT INTO platform_rbac_roles
        (id,name,description,built_in,version,created_at,updated_at) VALUES (?,?,?,1,1,?,?)`)
        .run(role.id, role.name, role.description, now, now);
      for (const permission of role.permissions) {
        db.prepare(`INSERT INTO platform_rbac_role_permissions
          (role_id,permission,granted_by_user_id,granted_at) VALUES (?,?,NULL,?)`)
          .run(role.id, permission, now);
      }
    }
  })();
}

export function activeControlPlaneRoleIds(userId: string): ControlPlaneRoleId[] {
  const rows = db.prepare(`SELECT DISTINCT assignment.role_id FROM platform_rbac_user_roles assignment
    JOIN platform_rbac_roles role ON role.id=assignment.role_id
    WHERE assignment.user_id=? AND assignment.revoked_at IS NULL ORDER BY assignment.role_id`)
    .all(userId) as Array<{ role_id: string }>;
  return rows.map((row) => String(row.role_id));
}

export function controlPlanePermissionsForUser(userId: string): PlatformPermissionId[] {
  const rows = db.prepare(`SELECT DISTINCT permission FROM platform_rbac_role_permissions permission
    JOIN platform_rbac_user_roles assignment ON assignment.role_id=permission.role_id
    WHERE assignment.user_id=? AND assignment.revoked_at IS NULL ORDER BY permission`)
    .all(userId) as Array<{ permission: string }>;
  return rows.map((row) => row.permission)
    .filter((permission): permission is PlatformPermissionId => platformPermissionIds.has(permission));
}

export function hasControlPlanePermission(userId: string, permission: PlatformPermissionId) {
  return Boolean(db.prepare(`SELECT 1 FROM platform_rbac_user_roles assignment
    JOIN platform_rbac_role_permissions role_permission ON role_permission.role_id=assignment.role_id
    WHERE assignment.user_id=? AND assignment.revoked_at IS NULL AND role_permission.permission=? LIMIT 1`)
    .get(userId, permission));
}

export function controlPlaneRoleAssignments(userId: string) {
  return (db.prepare(`SELECT assignment.id,assignment.role_id,role.name,assignment.assigned_by_user_id,
      assignment.assigned_at,assignment.revoked_by_user_id,assignment.revoked_at,assignment.reason,
      assignment.revocation_reason
    FROM platform_rbac_user_roles assignment JOIN platform_rbac_roles role ON role.id=assignment.role_id
    WHERE assignment.user_id=? ORDER BY assignment.assigned_at DESC,assignment.id DESC`).all(userId) as any[])
    .map((row) => ({
      id: String(row.id), roleId: String(row.role_id) as ControlPlaneRoleId, roleName: String(row.name),
      active: !row.revoked_at, assignedByUserId: row.assigned_by_user_id || null,
      assignedAt: row.assigned_at, revokedByUserId: row.revoked_by_user_id || null,
      revokedAt: row.revoked_at || null, reason: String(row.reason || ''),
      revocationReason: row.revocation_reason ? String(row.revocation_reason) : null
    }));
}

export function activeControlPlaneRolesForUsers(userIds: string[]) {
  const unique = [...new Set(userIds)].filter(Boolean);
  const result = new Map<string, ControlPlaneRoleId[]>();
  if (!unique.length) return result;
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT user_id,role_id FROM platform_rbac_user_roles
    WHERE revoked_at IS NULL AND user_id IN (${placeholders}) ORDER BY role_id`).all(...unique) as any[];
  for (const row of rows) {
    const role = String(row.role_id);
    const userId = String(row.user_id);
    result.set(userId, [...(result.get(userId) || []), role]);
  }
  return result;
}

export function listControlPlaneRoles() {
  const rows = db.prepare(`SELECT id,name,description,built_in,version,created_at,updated_at
    FROM platform_rbac_roles ORDER BY CASE id WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 WHEN 'viewer' THEN 2 ELSE 3 END,id`)
    .all() as any[];
  const permissions = db.prepare(`SELECT role_id,permission FROM platform_rbac_role_permissions ORDER BY permission`).all() as any[];
  const permissionMap = new Map<string, PlatformPermissionId[]>();
  for (const row of permissions) {
    const permission = String(row.permission);
    if (!platformPermissionIds.has(permission)) continue;
    permissionMap.set(String(row.role_id), [...(permissionMap.get(String(row.role_id)) || []), permission as PlatformPermissionId]);
  }
  return rows.map((row) => ({
    id: String(row.id) as ControlPlaneRoleId, name: String(row.name), description: String(row.description),
    builtIn: Boolean(row.built_in), version: Number(row.version),
    permissions: permissionMap.get(String(row.id)) || [], createdAt: row.created_at, updatedAt: row.updated_at
  }));
}

export function replaceControlPlaneRolePermissions(input: {
  roleId: ControlPlaneRoleId;
  permissions: PlatformPermissionId[];
  actorUserId: string;
  expectedVersion?: number;
}) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const current = db.prepare('SELECT version FROM platform_rbac_roles WHERE id=?').get(input.roleId) as { version: number } | undefined;
    if (!current) return { status: 'not_found' as const };
    if (input.expectedVersion !== undefined && Number(current.version) !== input.expectedVersion) {
      return { status: 'conflict' as const, version: Number(current.version) };
    }
    const nextVersion = Number(current.version) + 1;
    const changed = db.prepare(`UPDATE platform_rbac_roles SET version=?,updated_at=? WHERE id=? AND version=?`)
      .run(nextVersion, now, input.roleId, Number(current.version)).changes;
    if (changed !== 1) return { status: 'conflict' as const, version: Number(current.version) };
    db.prepare('DELETE FROM platform_rbac_role_permissions WHERE role_id=?').run(input.roleId);
    for (const permission of [...new Set(input.permissions)].sort()) {
      db.prepare(`INSERT INTO platform_rbac_role_permissions
        (role_id,permission,granted_by_user_id,granted_at) VALUES (?,?,?,?)`)
        .run(input.roleId, permission, input.actorUserId, now);
    }
    return { status: 'updated' as const, version: nextVersion };
  })();
}

export function createControlPlaneRole(input: {
  name: string;
  description: string;
  permissions: PlatformPermissionId[];
  actorUserId: string;
}) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  return db.transaction(() => {
    db.prepare(`INSERT INTO platform_rbac_roles
      (id,name,description,built_in,version,created_at,updated_at) VALUES (?,?,?,0,1,?,?)`)
      .run(id, input.name, input.description, now, now);
    for (const permission of [...new Set(input.permissions)].sort()) {
      db.prepare(`INSERT INTO platform_rbac_role_permissions
        (role_id,permission,granted_by_user_id,granted_at) VALUES (?,?,?,?)`)
        .run(id, permission, input.actorUserId, now);
    }
    return listControlPlaneRoles().find((role) => role.id === id)!;
  })();
}

export function updateControlPlaneRoleMetadata(input: {
  roleId: string;
  name: string;
  description: string;
  expectedVersion?: number;
}) {
  const current = db.prepare('SELECT version FROM platform_rbac_roles WHERE id=?').get(input.roleId) as { version: number } | undefined;
  if (!current) return { status: 'not_found' as const };
  if (input.expectedVersion !== undefined && Number(current.version) !== input.expectedVersion) {
    return { status: 'conflict' as const, version: Number(current.version) };
  }
  const version = Number(current.version) + 1;
  const changed = db.prepare(`UPDATE platform_rbac_roles SET name=?,description=?,version=?,updated_at=?
    WHERE id=? AND version=?`).run(input.name, input.description, version, new Date().toISOString(),
      input.roleId, Number(current.version)).changes;
  return changed === 1 ? { status: 'updated' as const, version }
    : { status: 'conflict' as const, version: Number(current.version) };
}

export function assignControlPlaneRole(input: {
  userId: string;
  roleId: ControlPlaneRoleId;
  actorUserId: string;
  reason: string;
}) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_rbac_user_roles
    (id,user_id,role_id,assigned_by_user_id,assigned_at,revoked_by_user_id,revoked_at,reason)
    VALUES (?,?,?,?,?,NULL,NULL,?)`).run(id, input.userId, input.roleId, input.actorUserId, now, input.reason);
  return controlPlaneRoleAssignments(input.userId).find((assignment) => assignment.id === id)!;
}
