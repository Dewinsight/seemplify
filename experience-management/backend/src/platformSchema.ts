import crypto from 'node:crypto';
import './spaces.js';
import { db } from './database.js';
import { seedControlPlaneRoles } from './platformRbac.js';

function tableColumns(table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function addColumn(table: string, column: string, definition: string) {
  if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Keep the isolated SQLite development/test store at parity with the
 * checksummed PostgreSQL runtime migration. PostgreSQL never executes this DDL
 * at application startup.
 */
export function ensurePlatformSchema() {
  if (db.provider !== 'sqlite') return;

  addColumn('users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
  addColumn('users', 'last_login_at', 'TEXT');
  addColumn('users', 'suspended_at', 'TEXT');
  addColumn('users', 'suspended_by_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumn('users', 'suspension_reason', 'TEXT');

  addColumn('spaces', 'status', "TEXT NOT NULL DEFAULT 'active'");
  addColumn('spaces', 'suspended_at', 'TEXT');
  addColumn('spaces', 'suspended_by_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumn('spaces', 'suspension_reason', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_role_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('superadmin','support','billing_approver','analyst')),
      granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL,
      revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TEXT,
      reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_role_assignments_active
      ON platform_role_assignments(user_id,role) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS platform_role_assignments_user
      ON platform_role_assignments(user_id,granted_at DESC);

    CREATE TABLE IF NOT EXISTS platform_rbac_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      built_in INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_rbac_role_permissions (
      role_id TEXT NOT NULL REFERENCES platform_rbac_roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY(role_id,permission)
    );
    CREATE TABLE IF NOT EXISTS platform_rbac_user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES platform_rbac_roles(id) ON DELETE CASCADE,
      assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TEXT NOT NULL,
      revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TEXT,
      reason TEXT,
      revocation_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_rbac_user_roles_active
      ON platform_rbac_user_roles(user_id,role_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS platform_rbac_user_roles_user
      ON platform_rbac_user_roles(user_id,assigned_at DESC);

    CREATE TABLE IF NOT EXISTS platform_subscription_requests (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL CHECK(request_type IN ('activate','change','cancel')),
      requested_plan_code TEXT CHECK(requested_plan_code IS NULL OR requested_plan_code IN ('starter','team','enterprise')),
      request_note TEXT NOT NULL DEFAULT '',
      plan_snapshot_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_note TEXT,
      decision_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_subscription_requests_one_pending
      ON platform_subscription_requests(space_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS platform_subscription_requests_review
      ON platform_subscription_requests(status,created_at,id);
    CREATE INDEX IF NOT EXISTS platform_subscription_requests_space
      ON platform_subscription_requests(space_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS platform_subscriptions (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      plan_code TEXT NOT NULL CHECK(plan_code IN ('starter','team','enterprise')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','cancelled')),
      features_json TEXT NOT NULL DEFAULT '{}',
      limits_json TEXT NOT NULL DEFAULT '{}',
      source_request_id TEXT REFERENCES platform_subscription_requests(id) ON DELETE SET NULL,
      approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      effective_at TEXT NOT NULL,
      expires_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_subscriptions_one_per_space
      ON platform_subscriptions(space_id);
    CREATE INDEX IF NOT EXISTS platform_subscriptions_space_history
      ON platform_subscriptions(space_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS platform_subscription_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      subscription_id TEXT REFERENCES platform_subscriptions(id) ON DELETE SET NULL,
      request_id TEXT REFERENCES platform_subscription_requests(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS platform_subscription_events_space
      ON platform_subscription_events(space_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS platform_subscription_events_request
      ON platform_subscription_events(request_id,created_at,id);

    CREATE TABLE IF NOT EXISTS platform_audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
      reason TEXT,
      before_json TEXT,
      after_json TEXT,
      request_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS platform_audit_events_created
      ON platform_audit_events(created_at DESC,id);
    CREATE INDEX IF NOT EXISTS platform_audit_events_target
      ON platform_audit_events(target_type,target_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS platform_audit_events_actor
      ON platform_audit_events(actor_user_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS platform_audit_events_space
      ON platform_audit_events(space_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS ticket_events (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_events_ticket
      ON ticket_events(ticket_id,created_at,id);

  `);

  addColumn('platform_rbac_user_roles', 'revocation_reason', 'TEXT');

  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(15, 'platform_administration_and_recovery_history', new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(16, 'administrator_rbac_control_plane', new Date().toISOString());
  seedControlPlaneRoles();
}

ensurePlatformSchema();

export function ensureConfiguredRootPlatformRole(userId: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_role_assignments
    (id,user_id,role,granted_by_user_id,granted_at,revoked_by_user_id,revoked_at,reason)
    VALUES (?,?, 'superadmin', ?, ?, NULL, NULL, ?)
    ON CONFLICT DO NOTHING`).run(crypto.randomUUID(), userId, userId, now, 'Configured platform bootstrap administrator');
}
