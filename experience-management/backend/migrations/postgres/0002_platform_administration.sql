-- Runtime schema 2: platform administration, subscription approvals, and
-- durable service-recovery history. This migration is additive and is applied
-- transactionally by scripts/upgrade-postgres-schema.mjs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS suspended_at TEXT;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS suspended_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

CREATE TABLE IF NOT EXISTS platform_role_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin','support','billing_approver','analyst')),
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

CREATE TABLE IF NOT EXISTS platform_subscription_requests (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('activate','change','cancel')),
  requested_plan_code TEXT CHECK (requested_plan_code IS NULL OR requested_plan_code IN ('starter','team','enterprise')),
  request_note TEXT NOT NULL DEFAULT '',
  plan_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  decision_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
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
  plan_code TEXT NOT NULL CHECK (plan_code IN ('starter','team','enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled')),
  features_json TEXT NOT NULL DEFAULT '{}',
  limits_json TEXT NOT NULL DEFAULT '{}',
  source_request_id TEXT REFERENCES platform_subscription_requests(id) ON DELETE SET NULL,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
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

-- The runtime role is granted SELECT/INSERT but explicitly denied
-- UPDATE/DELETE on event tables by manage.ps1. Foreign-key cascades therefore
-- remain usable when their parent aggregate is intentionally deleted.
