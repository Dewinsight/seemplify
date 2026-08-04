-- Runtime schema 8: extensible administrator RBAC and privacy-safe global
-- control-plane projections. Product data remains in its existing tables;
-- these tables contain only role definitions, permissions, and assignments.

CREATE TABLE IF NOT EXISTS platform_rbac_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_rbac_role_permissions (
  role_id TEXT NOT NULL REFERENCES platform_rbac_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (role_id,permission)
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

INSERT INTO platform_rbac_roles (id,name,description,built_in,version,created_at,updated_at) VALUES
  ('admin','Admin','Full control-plane administration, including roles and user provisioning.',1,1,
    '2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z'),
  ('editor','Editor','Operational management without permission or role administration.',1,1,
    '2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z'),
  ('viewer','Viewer','Read-only access to users, roles, spaces, analytics, jobs, activity, and audit history.',1,1,
    '2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform_rbac_role_permissions (role_id,permission,granted_by_user_id,granted_at)
SELECT role_id,permission,NULL,'2026-08-04T00:00:00.000Z' FROM (VALUES
  ('admin','users.read'),('admin','users.create'),('admin','users.manage'),
  ('admin','roles.read'),('admin','roles.manage'),
  ('admin','spaces.read'),('admin','spaces.manage'),
  ('admin','subscriptions.read'),('admin','subscriptions.manage'),
  ('admin','analytics.read'),('admin','ai_defaults.read'),('admin','ai_defaults.manage'),
  ('admin','jobs.read'),('admin','activity.read'),('admin','audit.read'),
  ('editor','users.read'),('editor','users.create'),('editor','users.manage'),
  ('editor','roles.read'),('editor','spaces.read'),('editor','spaces.manage'),
  ('editor','subscriptions.read'),('editor','analytics.read'),
  ('editor','ai_defaults.read'),('editor','ai_defaults.manage'),
  ('editor','jobs.read'),('editor','activity.read'),('editor','audit.read'),
  ('viewer','users.read'),('viewer','roles.read'),('viewer','spaces.read'),
  ('viewer','subscriptions.read'),('viewer','analytics.read'),('viewer','ai_defaults.read'),
  ('viewer','jobs.read'),('viewer','activity.read'),('viewer','audit.read')
) AS defaults(role_id,permission)
ON CONFLICT (role_id,permission) DO NOTHING;
