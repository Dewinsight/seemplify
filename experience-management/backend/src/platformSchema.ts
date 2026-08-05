import crypto from 'node:crypto';
import './spaces.js';
import { db } from './database.js';
import { seedControlPlaneRoles } from './platformRbac.js';
import { backfillLegacyDirectAiUsage, defaultSubscriptionPlanCatalog } from './subscriptionEntitlements.js';

/** A catalogue release can add features or quotas. Stored plan rows predate
 * them, and an administrator's own customisations must survive, so missing keys
 * are merged from the catalogue defaults instead of overwriting the row. */
function completeManagedPlanCatalog() {
  const update = db.prepare('UPDATE platform_subscription_plans SET features_json=?,limits_json=?,updated_at=? WHERE code=?');
  for (const plan of defaultSubscriptionPlanCatalog) {
    const row = db.prepare('SELECT features_json,limits_json FROM platform_subscription_plans WHERE code=?')
      .get(plan.code) as { features_json?: string; limits_json?: string } | undefined;
    if (!row) continue;
    let features: Record<string, unknown> = {};
    let limits: Record<string, unknown> = {};
    try { features = JSON.parse(String(row.features_json || '{}')); limits = JSON.parse(String(row.limits_json || '{}')); }
    catch { features = {}; limits = {}; }
    const nextFeatures = { ...plan.features, ...features } as Record<string, unknown>;
    const nextLimits = { ...plan.limits, ...limits } as Record<string, unknown>;
    for (const key of Object.keys(plan.features)) {
      if (typeof nextFeatures[key] !== 'boolean') nextFeatures[key] = plan.features[key as keyof typeof plan.features];
    }
    for (const key of Object.keys(plan.limits)) {
      if (!Number.isSafeInteger(Number(nextLimits[key]))) nextLimits[key] = plan.limits[key as keyof typeof plan.limits];
    }
    if (JSON.stringify(nextFeatures) === String(row.features_json) && JSON.stringify(nextLimits) === String(row.limits_json)) continue;
    update.run(JSON.stringify(nextFeatures), JSON.stringify(nextLimits), new Date().toISOString(), plan.code);
  }
}

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

    CREATE TABLE IF NOT EXISTS platform_subscription_plans (
      code TEXT PRIMARY KEY CHECK(code IN ('starter','team','enterprise')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      requestable INTEGER NOT NULL DEFAULT 1 CHECK(requestable IN (0,1)),
      features_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS platform_usage_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      subscription_id TEXT REFERENCES platform_subscriptions(id) ON DELETE SET NULL,
      meter TEXT NOT NULL CHECK(length(meter) BETWEEN 1 AND 80),
      quantity BIGINT NOT NULL CHECK(quantity > 0),
      period_start TEXT NOT NULL CHECK(length(period_start)=24),
      period_end TEXT NOT NULL CHECK(length(period_end)=24 AND period_end > period_start),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
      source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 1 AND 80),
      source_id TEXT CHECK(source_id IS NULL OR length(source_id) BETWEEN 1 AND 200),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_usage_events_idempotency
      ON platform_usage_events(space_id,meter,period_start,idempotency_key);
    CREATE INDEX IF NOT EXISTS platform_usage_events_space_period
      ON platform_usage_events(space_id,meter,period_start,created_at,id);
    CREATE INDEX IF NOT EXISTS platform_usage_events_source
      ON platform_usage_events(source_type,source_id) WHERE source_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS platform_usage_buckets (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      meter TEXT NOT NULL CHECK(length(meter) BETWEEN 1 AND 80),
      period_start TEXT NOT NULL CHECK(length(period_start)=24),
      period_end TEXT NOT NULL CHECK(length(period_end)=24 AND period_end > period_start),
      quantity BIGINT NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,meter,period_start)
    );
    CREATE INDEX IF NOT EXISTS platform_usage_buckets_period
      ON platform_usage_buckets(meter,period_start,space_id);

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

    CREATE TABLE IF NOT EXISTS journey_event_sources (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
      validation_mode TEXT NOT NULL DEFAULT 'warn' CHECK(validation_mode IN ('observe','warn','enforce')),
      allowed_origins_json TEXT NOT NULL DEFAULT '[]',
      allowed_bundle_ids_json TEXT NOT NULL DEFAULT '[]',
      events_per_minute INTEGER NOT NULL CHECK(events_per_minute BETWEEN 1 AND 10000000),
      bytes_per_minute INTEGER NOT NULL CHECK(bytes_per_minute BETWEEN 1 AND 10000000000),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_hash TEXT CHECK(intent_hash IS NULL OR length(intent_hash)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_sources_space_name_environment
      ON journey_event_sources(space_id,environment,name);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_sources_idempotency
      ON journey_event_sources(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_sources_tenant_environment_identity
      ON journey_event_sources(id,space_id,environment);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_sources_tenant_identity
      ON journey_event_sources(id,space_id);
    CREATE INDEX IF NOT EXISTS journey_event_sources_space_history
      ON journey_event_sources(space_id,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_event_credentials (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES journey_event_sources(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      kind TEXT NOT NULL CHECK(kind IN ('public_write','server_secret')),
      scope TEXT NOT NULL DEFAULT 'events:write' CHECK(scope='events:write'),
      display_prefix TEXT NOT NULL CHECK(length(display_prefix) BETWEEN 8 AND 160),
      algorithm TEXT NOT NULL DEFAULT 'scrypt-v1' CHECK(algorithm='scrypt-v1'),
      salt TEXT NOT NULL CHECK(length(salt) BETWEEN 16 AND 200),
      digest TEXT NOT NULL CHECK(length(digest)=64),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','overlap','revoked')),
      rotated_from_id TEXT REFERENCES journey_event_credentials(id) ON DELETE SET NULL,
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_hash TEXT CHECK(intent_hash IS NULL OR length(intent_hash)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_credentials_display_prefix
      ON journey_event_credentials(display_prefix);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_credentials_one_active
      ON journey_event_credentials(source_id,kind) WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_credentials_idempotency
      ON journey_event_credentials(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_credentials_tenant_source_environment_identity
      ON journey_event_credentials(id,source_id,space_id,environment);
    CREATE INDEX IF NOT EXISTS journey_event_credentials_source_history
      ON journey_event_credentials(source_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_event_schemas (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES journey_event_sources(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 128),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_hash TEXT CHECK(intent_hash IS NULL OR length(intent_hash)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schemas_source_event
      ON journey_event_schemas(source_id,event_name);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schemas_idempotency
      ON journey_event_schemas(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS journey_event_schemas_space_history
      ON journey_event_schemas(space_id,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_event_schema_versions (
      id TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL REFERENCES journey_event_schemas(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES journey_event_sources(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      version_major INTEGER NOT NULL CHECK(version_major >= 0),
      version_minor INTEGER NOT NULL CHECK(version_minor >= 0),
      state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','deprecated','retired')),
      properties_json TEXT NOT NULL DEFAULT '[]',
      compatibility_json TEXT NOT NULL DEFAULT '{}',
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_hash TEXT CHECK(intent_hash IS NULL OR length(intent_hash)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      deprecated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      published_at TEXT,
      deprecated_at TEXT,
      CHECK(version GLOB '[0-9]*.[0-9]*')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_number
      ON journey_event_schema_versions(schema_id,version_major,version_minor);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_one_published
      ON journey_event_schema_versions(schema_id) WHERE state='published';
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_idempotency
      ON journey_event_schema_versions(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_tenant_source_identity
      ON journey_event_schema_versions(id,source_id,space_id);
    CREATE INDEX IF NOT EXISTS journey_event_schema_versions_history
      ON journey_event_schema_versions(schema_id,version_major DESC,version_minor DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_event_schema_versions_content_update_guard
      BEFORE UPDATE ON journey_event_schema_versions
      WHEN OLD.schema_id IS NOT NEW.schema_id OR OLD.source_id IS NOT NEW.source_id
        OR OLD.space_id IS NOT NEW.space_id OR OLD.version IS NOT NEW.version
        OR OLD.version_major IS NOT NEW.version_major OR OLD.version_minor IS NOT NEW.version_minor
        OR OLD.properties_json IS NOT NEW.properties_json OR OLD.content_sha256 IS NOT NEW.content_sha256
        OR OLD.idempotency_key IS NOT NEW.idempotency_key OR OLD.intent_hash IS NOT NEW.intent_hash
        OR OLD.created_at IS NOT NEW.created_at
      BEGIN SELECT RAISE(ABORT,'journey event schema version content is immutable after insert'); END;
    CREATE TRIGGER IF NOT EXISTS journey_event_schema_versions_lifecycle_update_guard
      BEFORE UPDATE ON journey_event_schema_versions
      WHEN OLD.state IS NOT NEW.state AND NOT (
        (OLD.state='draft' AND NEW.state='published')
        OR (OLD.state='published' AND NEW.state='deprecated')
        OR (OLD.state='deprecated' AND NEW.state='retired'))
      BEGIN SELECT RAISE(ABORT,'invalid journey event schema version lifecycle transition'); END;
    CREATE TRIGGER IF NOT EXISTS journey_event_schema_versions_compatibility_update_guard
      BEFORE UPDATE ON journey_event_schema_versions
      WHEN OLD.compatibility_json IS NOT NEW.compatibility_json
        AND NOT (OLD.state='draft' AND NEW.state='published')
      BEGIN SELECT RAISE(ABORT,'compatibility_json may change only while publishing a draft schema version'); END;
    CREATE TRIGGER IF NOT EXISTS journey_event_schema_versions_publication_attribution_guard
      BEFORE UPDATE ON journey_event_schema_versions
      WHEN (
        OLD.state='draft' AND NEW.state='published'
        AND (OLD.published_by_user_id IS NOT NULL OR OLD.published_at IS NOT NULL
          OR NEW.published_by_user_id IS NULL OR NEW.published_at IS NULL
          OR OLD.compatibility_json IS NEW.compatibility_json
          OR COALESCE(json_type(NEW.compatibility_json,'$.compatible'),'') NOT IN ('true','false')
          OR COALESCE(json_type(NEW.compatibility_json,'$.issues'),'')<>'array')
      ) OR (
        NOT (OLD.state='draft' AND NEW.state='published')
        AND (OLD.published_by_user_id IS NOT NEW.published_by_user_id OR OLD.published_at IS NOT NEW.published_at)
      )
      BEGIN SELECT RAISE(ABORT,'publication attribution must be set exactly on draft publication'); END;
    CREATE TRIGGER IF NOT EXISTS journey_event_schema_versions_deprecation_attribution_guard
      BEFORE UPDATE ON journey_event_schema_versions
      WHEN (
        OLD.state='published' AND NEW.state='deprecated'
        AND (OLD.deprecated_by_user_id IS NOT NULL OR OLD.deprecated_at IS NOT NULL
          OR NEW.deprecated_by_user_id IS NULL OR NEW.deprecated_at IS NULL)
      ) OR (
        NOT (OLD.state='published' AND NEW.state='deprecated')
        AND (OLD.deprecated_by_user_id IS NOT NEW.deprecated_by_user_id OR OLD.deprecated_at IS NOT NEW.deprecated_at)
      )
      BEGIN SELECT RAISE(ABORT,'deprecation attribution must be set exactly on published deprecation'); END;

    CREATE TABLE IF NOT EXISTS journey_event_control_audit_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT REFERENCES journey_event_sources(id) ON DELETE SET NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN (
        'source.created','source.updated','credential.issued','credential.rotated','credential.revoked',
        'schema.created','schema.version_created','schema.published','schema.deprecated'
      )),
      target_type TEXT NOT NULL CHECK(target_type IN ('source','credential','schema','schema_version')),
      target_id TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      before_fingerprint TEXT CHECK(before_fingerprint IS NULL OR length(before_fingerprint)=64),
      after_fingerprint TEXT CHECK(after_fingerprint IS NULL OR length(after_fingerprint)=64),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_event_control_audit_space
      ON journey_event_control_audit_events(space_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_control_audit_source
      ON journey_event_control_audit_events(source_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_raw_events (
      received_at TEXT NOT NULL,
      id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      credential_id TEXT NOT NULL,
      event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
      protocol_version TEXT NOT NULL CHECK(protocol_version='1.0'),
      event_call TEXT NOT NULL CHECK(event_call IN
        ('track','identify','alias','group','page','screen','consent','metric')),
      event_name TEXT CHECK(event_name IS NULL OR length(event_name) BETWEEN 1 AND 128),
      event_version INTEGER CHECK(event_version IS NULL OR event_version BETWEEN 1 AND 1000000),
      occurred_at TEXT NOT NULL,
      sent_at TEXT,
      schema_version_id TEXT,
      anonymous_id_hash TEXT CHECK(anonymous_id_hash IS NULL OR length(anonymous_id_hash)=64),
      user_id_hash TEXT CHECK(user_id_hash IS NULL OR length(user_id_hash)=64),
      account_id_hash TEXT CHECK(account_id_hash IS NULL OR length(account_id_hash)=64),
      session_id_hash TEXT CHECK(session_id_hash IS NULL OR length(session_id_hash)=64),
      channel TEXT NOT NULL CHECK(channel IN
        ('web','server','ios','android','react_native','webhook','connector','import','unknown')),
      consent_state TEXT NOT NULL CHECK(consent_state IN
        ('unknown','granted','denied','partial','not_required')),
      ingest_state TEXT NOT NULL CHECK(ingest_state IN ('accepted','quarantined')),
      payload_json TEXT NOT NULL CHECK(length(payload_json)<=2097152),
      context_json TEXT NOT NULL DEFAULT '{}' CHECK(length(context_json)<=131072),
      consent_json TEXT NOT NULL DEFAULT '{}' CHECK(length(consent_json)<=32768),
      validation_issues_json TEXT NOT NULL DEFAULT '[]' CHECK(length(validation_issues_json)<=32768),
      envelope_sha256 TEXT NOT NULL CHECK(length(envelope_sha256)=64),
      payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 2 AND 2097152),
      sdk_name TEXT CHECK(sdk_name IS NULL OR length(sdk_name) BETWEEN 1 AND 80),
      sdk_version TEXT CHECK(sdk_version IS NULL OR length(sdk_version) BETWEEN 1 AND 80),
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>received_at),
      PRIMARY KEY(received_at,id),
      UNIQUE(received_at,id,space_id,source_id,environment,event_id),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      FOREIGN KEY(credential_id,source_id,space_id,environment)
        REFERENCES journey_event_credentials(id,source_id,space_id,environment) ON DELETE RESTRICT,
      FOREIGN KEY(schema_version_id,source_id,space_id)
        REFERENCES journey_event_schema_versions(id,source_id,space_id) ON DELETE RESTRICT,
      CHECK(event_call NOT IN ('track','metric') OR (event_name IS NOT NULL AND event_version IS NOT NULL)),
      CHECK(ingest_state<>'quarantined' OR length(validation_issues_json)>2)
    );
    CREATE INDEX IF NOT EXISTS journey_raw_events_source_received
      ON journey_raw_events(space_id,source_id,environment,received_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_raw_events_event_time
      ON journey_raw_events(space_id,event_name,occurred_at DESC,id) WHERE event_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS journey_raw_events_retention
      ON journey_raw_events(retention_expires_at,received_at,id);

    CREATE TABLE IF NOT EXISTS journey_event_ingest_receipts (
      received_at TEXT NOT NULL,
      id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT CHECK(event_id IS NULL OR length(event_id) BETWEEN 1 AND 200),
      envelope_sha256 TEXT CHECK(envelope_sha256 IS NULL OR length(envelope_sha256)=64),
      raw_event_id TEXT,
      raw_received_at TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN (
        'accepted','quarantined','duplicate','content_conflict','rejected','rate_limited','over_quota','consent_denied')),
      http_status INTEGER NOT NULL CHECK(http_status IN (200,202,400,401,403,409,413,422,429)),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
      request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
      batch_id TEXT CHECK(batch_id IS NULL OR length(batch_id) BETWEEN 1 AND 128),
      attempt_ordinal INTEGER NOT NULL DEFAULT 1 CHECK(attempt_ordinal BETWEEN 1 AND 10000),
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>received_at),
      PRIMARY KEY(received_at,id),
      UNIQUE(received_at,id,space_id,source_id,environment,event_id),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT,
      CHECK(
        (outcome IN ('accepted','quarantined') AND http_status=202 AND raw_event_id IS NOT NULL
          AND raw_received_at IS NOT NULL AND error_code IS NULL)
        OR (outcome='duplicate' AND http_status=200 AND raw_event_id IS NOT NULL
          AND raw_received_at IS NOT NULL AND error_code IS NULL)
        OR (outcome='content_conflict' AND http_status=409 AND error_code IS NOT NULL)
        OR (outcome IN ('rate_limited','over_quota') AND http_status=429 AND error_code IS NOT NULL)
        OR (outcome='consent_denied' AND http_status=403 AND error_code IS NOT NULL)
        OR (outcome='rejected' AND http_status IN (400,401,403,413,422) AND error_code IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_event_ingest_receipts_source_received
      ON journey_event_ingest_receipts(space_id,source_id,environment,received_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_ingest_receipts_event_history
      ON journey_event_ingest_receipts(space_id,source_id,event_id,received_at DESC,id)
      WHERE event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS journey_event_ingest_receipts_retention
      ON journey_event_ingest_receipts(retention_expires_at,received_at,id);

    CREATE TABLE IF NOT EXISTS journey_event_deduplication (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
      envelope_sha256 TEXT NOT NULL CHECK(length(envelope_sha256)=64),
      raw_event_id TEXT NOT NULL,
      raw_received_at TEXT NOT NULL,
      ingest_receipt_id TEXT NOT NULL,
      first_outcome TEXT NOT NULL CHECK(first_outcome IN ('accepted','quarantined')),
      first_http_status INTEGER NOT NULL CHECK(first_http_status=202),
      first_result_code TEXT CHECK(first_result_code IS NULL OR length(first_result_code) BETWEEN 1 AND 100),
      first_result_json TEXT NOT NULL DEFAULT '{}' CHECK(length(first_result_json)<=8192),
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>created_at),
      PRIMARY KEY(space_id,source_id,event_id),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT,
      FOREIGN KEY(raw_received_at,ingest_receipt_id,space_id,source_id,environment,event_id)
        REFERENCES journey_event_ingest_receipts(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_event_deduplication_retention
      ON journey_event_deduplication(retention_expires_at,space_id,source_id,event_id);

    CREATE TABLE IF NOT EXISTS journey_event_rejections (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT CHECK(event_id IS NULL OR length(event_id) BETWEEN 1 AND 200),
      ingest_receipt_id TEXT,
      ingest_received_at TEXT,
      code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 100),
      field_path TEXT CHECK(field_path IS NULL OR length(field_path) BETWEEN 1 AND 240),
      redacted_detail_json TEXT NOT NULL DEFAULT '{}' CHECK(length(redacted_detail_json)<=16384),
      payload_sha256 TEXT CHECK(payload_sha256 IS NULL OR length(payload_sha256)=64),
      payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND 2097152),
      replay_eligible INTEGER NOT NULL DEFAULT 0 CHECK(replay_eligible IN (0,1)),
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>created_at),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      FOREIGN KEY(ingest_received_at,ingest_receipt_id,space_id,source_id,environment,event_id)
        REFERENCES journey_event_ingest_receipts(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT,
      CHECK((ingest_receipt_id IS NULL)=(ingest_received_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_event_rejections_source_history
      ON journey_event_rejections(space_id,source_id,environment,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_rejections_retention
      ON journey_event_rejections(retention_expires_at,created_at,id);

    CREATE TABLE IF NOT EXISTS journey_event_rate_buckets (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      window_started_at TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0 CHECK(event_count>=0),
      byte_count INTEGER NOT NULL DEFAULT 0 CHECK(byte_count>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,source_id,environment,window_started_at),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_event_rate_buckets_expiry
      ON journey_event_rate_buckets(window_started_at,space_id,source_id);

    CREATE TABLE IF NOT EXISTS journey_event_processing_inbox (
      raw_received_at TEXT NOT NULL,
      raw_event_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
      processor TEXT NOT NULL DEFAULT 'connected_journey_v1' CHECK(length(processor) BETWEEN 1 AND 100),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
        ('pending','leased','retry_wait','dead_lettered','completed')),
      available_at TEXT NOT NULL,
      lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
      lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
      lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10000),
      last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(raw_received_at,raw_event_id,processor),
      UNIQUE(raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor),
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT,
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      CHECK(
        (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_event_processing_inbox_claim
      ON journey_event_processing_inbox(state,available_at,lease_expires_at,space_id,source_id,raw_received_at,raw_event_id);
    CREATE INDEX IF NOT EXISTS journey_event_processing_inbox_source
      ON journey_event_processing_inbox(space_id,source_id,environment,updated_at DESC,raw_event_id);

    CREATE TABLE IF NOT EXISTS journey_event_processing_receipts (
      attempted_at TEXT NOT NULL,
      id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
      raw_received_at TEXT NOT NULL,
      raw_event_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
      processor TEXT NOT NULL CHECK(length(processor) BETWEEN 1 AND 100),
      processor_version TEXT NOT NULL CHECK(length(processor_version) BETWEEN 1 AND 80),
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 10000),
      status TEXT NOT NULL CHECK(status IN
        ('succeeded','retryable_failed','terminal_failed','lease_expired')),
      lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
      lease_generation INTEGER NOT NULL CHECK(lease_generation>=1),
      checkpoint TEXT CHECK(checkpoint IS NULL OR length(checkpoint) BETWEEN 1 AND 200),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
      error_detail_json TEXT NOT NULL DEFAULT '{}' CHECK(length(error_detail_json)<=16384),
      completed_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>completed_at),
      PRIMARY KEY(attempted_at,id),
      UNIQUE(attempted_at,id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor),
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor)
        REFERENCES journey_event_processing_inbox(
          raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor)
        ON DELETE RESTRICT,
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      CHECK((status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
      CHECK(completed_at>=attempted_at)
    );
    CREATE INDEX IF NOT EXISTS journey_event_processing_receipts_event_history
      ON journey_event_processing_receipts(
        space_id,source_id,raw_received_at,raw_event_id,processor,attempt_number,attempted_at,id);
    CREATE INDEX IF NOT EXISTS journey_event_processing_receipts_retention
      ON journey_event_processing_receipts(retention_expires_at,attempted_at,id);

    CREATE TABLE IF NOT EXISTS journey_event_dead_letters (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      raw_received_at TEXT NOT NULL,
      raw_event_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
      processor TEXT NOT NULL CHECK(length(processor) BETWEEN 1 AND 100),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
        ('pending','replay_scheduled','resolved','terminal')),
      failure_code TEXT NOT NULL CHECK(length(failure_code) BETWEEN 1 AND 100),
      redacted_detail_json TEXT NOT NULL DEFAULT '{}' CHECK(length(redacted_detail_json)<=16384),
      attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 10000),
      replay_eligible INTEGER NOT NULL DEFAULT 0 CHECK(replay_eligible IN (0,1)),
      replay_after TEXT,
      last_processing_receipt_id TEXT,
      last_processing_attempted_at TEXT,
      resolved_at TEXT,
      resolution_code TEXT CHECK(resolution_code IS NULL OR length(resolution_code) BETWEEN 1 AND 100),
      updated_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>updated_at),
      UNIQUE(raw_received_at,raw_event_id,processor),
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
        ON DELETE RESTRICT,
      FOREIGN KEY(last_processing_attempted_at,last_processing_receipt_id,raw_received_at,raw_event_id,
        space_id,source_id,environment,event_id,processor)
        REFERENCES journey_event_processing_receipts(attempted_at,id,raw_received_at,raw_event_id,
          space_id,source_id,environment,event_id,processor) ON DELETE RESTRICT,
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      CHECK((last_processing_receipt_id IS NULL)=(last_processing_attempted_at IS NULL)),
      CHECK(
        (state='pending' AND resolved_at IS NULL AND resolution_code IS NULL)
        OR (state='replay_scheduled' AND replay_eligible=1 AND replay_after IS NOT NULL
          AND resolved_at IS NULL AND resolution_code IS NULL)
        OR (state IN ('resolved','terminal') AND replay_eligible=0
          AND resolved_at IS NOT NULL AND resolution_code IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_event_dead_letters_queue
      ON journey_event_dead_letters(space_id,state,replay_eligible,replay_after,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_dead_letters_source
      ON journey_event_dead_letters(space_id,source_id,environment,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_dead_letters_retention
      ON journey_event_dead_letters(retention_expires_at,updated_at,id);

    CREATE TABLE IF NOT EXISTS journey_event_data_audit (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      action TEXT NOT NULL CHECK(action IN (
        'debug.viewed','rejection.viewed','dead_letter.viewed','dead_letter.replay_requested',
        'dead_letter.resolved','event.redacted')),
      target_type TEXT NOT NULL CHECK(target_type IN
        ('raw_event','ingest_receipt','rejection','dead_letter','processing_receipt')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(length(detail_json)<=16384),
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>created_at),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_event_data_audit_space_history
      ON journey_event_data_audit(space_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_data_audit_source_history
      ON journey_event_data_audit(space_id,source_id,environment,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_event_data_audit_retention
      ON journey_event_data_audit(retention_expires_at,created_at,id);

    CREATE UNIQUE INDEX IF NOT EXISTS journey_definitions_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_map_versions_tenant_definition_identity
      ON journey_map_versions(id,definition_id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_map_stages_tenant_version_key
      ON journey_map_stages(version_id,stage_key,space_id);

    CREATE TABLE IF NOT EXISTS journey_stage_rule_definitions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      draft_version_id TEXT,
      published_version_id TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id,space_id,journey_definition_id),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(draft_version_id,id,space_id,journey_definition_id)
        REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id)
        DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY(published_version_id,id,space_id,journey_definition_id)
        REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX IF NOT EXISTS journey_stage_rule_definitions_journey
      ON journey_stage_rule_definitions(space_id,journey_definition_id,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_stage_rule_versions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      rule_definition_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      journey_map_version_id TEXT NOT NULL,
      stage_key TEXT NOT NULL CHECK(length(stage_key) BETWEEN 1 AND 128),
      version_number INTEGER NOT NULL CHECK(version_number>0),
      state TEXT NOT NULL CHECK(state IN ('draft','published','retired')),
      role TEXT NOT NULL CHECK(role IN ('entry','progress','success','failure','exit')),
      priority INTEGER NOT NULL CHECK(priority BETWEEN -1000000 AND 1000000),
      event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 128),
      source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_ids_json)),
      environments_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(environments_json)),
      predicates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(predicates_json)),
      required_prior_events_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(required_prior_events_json)),
      excluded_event_names_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(excluded_event_names_json)),
      effective_at TEXT,
      expires_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE(rule_definition_id,version_number),
      UNIQUE(id,rule_definition_id,space_id,journey_definition_id),
      UNIQUE(id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key),
      FOREIGN KEY(rule_definition_id,space_id,journey_definition_id)
        REFERENCES journey_stage_rule_definitions(id,space_id,journey_definition_id) ON DELETE CASCADE,
      FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(journey_map_version_id,stage_key,space_id)
        REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
      CHECK(expires_at IS NULL OR effective_at IS NULL OR expires_at>effective_at),
      CHECK((state='draft' AND published_at IS NULL AND published_by_user_id IS NULL)
        OR (state IN ('published','retired') AND published_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_stage_rule_versions_one_draft
      ON journey_stage_rule_versions(rule_definition_id) WHERE state='draft';
    CREATE UNIQUE INDEX IF NOT EXISTS journey_stage_rule_versions_one_published
      ON journey_stage_rule_versions(rule_definition_id) WHERE state='published';
    CREATE INDEX IF NOT EXISTS journey_stage_rule_versions_runtime
      ON journey_stage_rule_versions(space_id,event_name,state,journey_definition_id,priority DESC,id);

    CREATE TABLE IF NOT EXISTS journey_stage_rule_decisions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      decision_key TEXT NOT NULL UNIQUE CHECK(length(decision_key)=64),
      raw_received_at TEXT NOT NULL,
      raw_event_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      event_id TEXT NOT NULL,
      journey_definition_id TEXT NOT NULL,
      journey_map_version_id TEXT NOT NULL,
      subject_kind TEXT CHECK(subject_kind IS NULL OR subject_kind='anonymous'),
      anonymous_id_hash TEXT CHECK(anonymous_id_hash IS NULL OR length(anonymous_id_hash)=64),
      outcome TEXT NOT NULL CHECK(outcome IN ('matched','no_match','skipped_no_anonymous_subject')),
      matched_rule_definition_id TEXT,
      matched_rule_version_id TEXT,
      matched_rule_version_number INTEGER,
      stage_key TEXT,
      role TEXT CHECK(role IS NULL OR role IN ('entry','progress','success','failure','exit')),
      event_occurred_at TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      is_late INTEGER NOT NULL DEFAULT 0 CHECK(is_late IN (0,1)),
      is_out_of_order INTEGER NOT NULL DEFAULT 0 CHECK(is_out_of_order IN (0,1)),
      rule_set_sha256 TEXT NOT NULL CHECK(length(rule_set_sha256)=64),
      trace_json TEXT NOT NULL CHECK(json_valid(trace_json)),
      provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
      processor TEXT NOT NULL,
      processor_version TEXT NOT NULL,
      lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>created_at),
      UNIQUE(raw_received_at,raw_event_id,journey_definition_id),
      UNIQUE(id,space_id,source_id,environment,journey_definition_id,raw_received_at,raw_event_id),
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id) ON DELETE RESTRICT,
      FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(matched_rule_version_id,matched_rule_definition_id,space_id,journey_definition_id,
        journey_map_version_id,stage_key)
        REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id,
          journey_map_version_id,stage_key) ON DELETE RESTRICT,
      FOREIGN KEY(journey_map_version_id,stage_key,space_id)
        REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
      CHECK((outcome='matched' AND matched_rule_definition_id IS NOT NULL AND matched_rule_version_id IS NOT NULL
          AND matched_rule_version_number IS NOT NULL AND stage_key IS NOT NULL AND role IS NOT NULL)
        OR (outcome<>'matched' AND matched_rule_definition_id IS NULL AND matched_rule_version_id IS NULL
          AND matched_rule_version_number IS NULL AND stage_key IS NULL AND role IS NULL)),
      CHECK((outcome='skipped_no_anonymous_subject' AND subject_kind IS NULL AND anonymous_id_hash IS NULL)
        OR (outcome<>'skipped_no_anonymous_subject' AND subject_kind='anonymous' AND anonymous_id_hash IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_stage_rule_decisions_explain
      ON journey_stage_rule_decisions(space_id,journey_definition_id,evaluated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_stage_rule_decisions_raw
      ON journey_stage_rule_decisions(space_id,source_id,raw_received_at,raw_event_id);

    CREATE TABLE IF NOT EXISTS journey_anonymous_instances (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      journey_definition_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL DEFAULT 'anonymous' CHECK(subject_kind='anonymous'),
      anonymous_id_hash TEXT NOT NULL CHECK(length(anonymous_id_hash)=64),
      state TEXT NOT NULL CHECK(state IN ('active','succeeded','failed','exited')),
      current_stage_key TEXT,
      first_event_at TEXT NOT NULL,
      latest_event_at TEXT NOT NULL,
      latest_event_id TEXT NOT NULL CHECK(length(latest_event_id) BETWEEN 1 AND 200),
      latest_visit_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(space_id,source_id,environment,journey_definition_id,anonymous_id_hash),
      UNIQUE(id,space_id,source_id,environment,journey_definition_id),
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(latest_visit_id,id,space_id,source_id,environment,journey_definition_id,current_stage_key)
        REFERENCES journey_anonymous_stage_visits(id,instance_id,space_id,source_id,environment,journey_definition_id,stage_key)
        DEFERRABLE INITIALLY DEFERRED,
      CHECK(latest_event_at>=first_event_at),
      CHECK((latest_visit_id IS NULL)=(current_stage_key IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_anonymous_instances_journey
      ON journey_anonymous_instances(space_id,journey_definition_id,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_anonymous_stage_visits (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      assignment_key TEXT NOT NULL UNIQUE CHECK(length(assignment_key)=64),
      instance_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      raw_received_at TEXT NOT NULL,
      raw_event_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      event_id TEXT NOT NULL,
      journey_definition_id TEXT NOT NULL,
      journey_map_version_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL DEFAULT 'anonymous' CHECK(subject_kind='anonymous'),
      stage_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('entry','progress','success','failure','exit')),
      rule_definition_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      rule_version_number INTEGER NOT NULL CHECK(rule_version_number>0),
      event_occurred_at TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      is_late INTEGER NOT NULL DEFAULT 0 CHECK(is_late IN (0,1)),
      is_out_of_order INTEGER NOT NULL DEFAULT 0 CHECK(is_out_of_order IN (0,1)),
      applied_to_current INTEGER NOT NULL CHECK(applied_to_current IN (0,1)),
      non_application_reason TEXT CHECK(non_application_reason IS NULL OR non_application_reason IN
        ('out_of_order','terminal_absorbing')),
      prior_stage_key TEXT,
      provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL CHECK(retention_expires_at>created_at),
      UNIQUE(raw_received_at,raw_event_id,journey_definition_id),
      UNIQUE(id,instance_id,space_id,source_id,environment,journey_definition_id),
      UNIQUE(id,instance_id,space_id,source_id,environment,journey_definition_id,stage_key),
      FOREIGN KEY(decision_id,space_id,source_id,environment,journey_definition_id,raw_received_at,raw_event_id)
        REFERENCES journey_stage_rule_decisions(id,space_id,source_id,environment,journey_definition_id,
          raw_received_at,raw_event_id) ON DELETE RESTRICT,
      FOREIGN KEY(instance_id,space_id,source_id,environment,journey_definition_id)
        REFERENCES journey_anonymous_instances(id,space_id,source_id,environment,journey_definition_id) ON DELETE RESTRICT,
      FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
        REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id) ON DELETE RESTRICT,
      FOREIGN KEY(journey_map_version_id,stage_key,space_id)
        REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(rule_version_id,rule_definition_id,space_id,journey_definition_id,
        journey_map_version_id,stage_key)
        REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id,
          journey_map_version_id,stage_key) ON DELETE RESTRICT,
      CHECK((applied_to_current=1 AND non_application_reason IS NULL)
        OR (applied_to_current=0 AND non_application_reason IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_anonymous_stage_visits_timeline
      ON journey_anonymous_stage_visits(space_id,journey_definition_id,instance_id,event_occurred_at,id);

    CREATE TABLE IF NOT EXISTS journey_stage_rule_audit_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      rule_definition_id TEXT,
      rule_version_id TEXT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('rule.created','rule.draft_updated','rule.published','rule.retired','rule.simulated','decision.viewed')),
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
      created_at TEXT NOT NULL,
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_stage_rule_audit_history
      ON journey_stage_rule_audit_events(space_id,journey_definition_id,created_at DESC,id);

    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_versions_published_update_guard
      BEFORE UPDATE ON journey_stage_rule_versions
      WHEN OLD.state IN ('published','retired') AND NOT (
        OLD.state='published' AND NEW.state='retired'
        AND NEW.id IS OLD.id AND NEW.rule_definition_id IS OLD.rule_definition_id
        AND NEW.space_id IS OLD.space_id AND NEW.journey_definition_id IS OLD.journey_definition_id
        AND NEW.journey_map_version_id IS OLD.journey_map_version_id AND NEW.stage_key IS OLD.stage_key
        AND NEW.version_number IS OLD.version_number AND NEW.role IS OLD.role AND NEW.priority IS OLD.priority
        AND NEW.event_name IS OLD.event_name AND NEW.source_ids_json IS OLD.source_ids_json
        AND NEW.environments_json IS OLD.environments_json AND NEW.predicates_json IS OLD.predicates_json
        AND NEW.required_prior_events_json IS OLD.required_prior_events_json
        AND NEW.excluded_event_names_json IS OLD.excluded_event_names_json
        AND NEW.effective_at IS OLD.effective_at AND NEW.expires_at IS OLD.expires_at
        AND NEW.revision IS OLD.revision AND NEW.content_sha256 IS OLD.content_sha256
        AND NEW.created_by_user_id IS OLD.created_by_user_id AND NEW.published_by_user_id IS OLD.published_by_user_id
        AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at)
      BEGIN SELECT RAISE(ABORT,'published journey stage-rule versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_versions_published_delete_guard
      BEFORE DELETE ON journey_stage_rule_versions WHEN OLD.state IN ('published','retired')
      BEGIN SELECT RAISE(ABORT,'published journey stage-rule versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_decisions_update_guard
      BEFORE UPDATE ON journey_stage_rule_decisions
      BEGIN SELECT RAISE(ABORT,'journey stage-rule decisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_decisions_delete_guard
      BEFORE DELETE ON journey_stage_rule_decisions
      BEGIN SELECT RAISE(ABORT,'journey stage-rule decisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_anonymous_stage_visits_update_guard
      BEFORE UPDATE ON journey_anonymous_stage_visits
      BEGIN SELECT RAISE(ABORT,'journey anonymous stage visits are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_anonymous_stage_visits_delete_guard
      BEFORE DELETE ON journey_anonymous_stage_visits
      BEGIN SELECT RAISE(ABORT,'journey anonymous stage visits are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_audit_update_guard
      BEFORE UPDATE ON journey_stage_rule_audit_events
      BEGIN SELECT RAISE(ABORT,'journey stage-rule audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_rule_audit_delete_guard
      BEFORE DELETE ON journey_stage_rule_audit_events
      BEGIN SELECT RAISE(ABORT,'journey stage-rule audit is append-only'); END;

    CREATE TABLE IF NOT EXISTS journey_research_sources (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN (
        'knowledge_document','survey_response','survey_analysis','social_mention','social_intelligence',
        'ticket','assistant_artifact','agreement','interview','observation','event_aggregate')),
      source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 400),
      adapter TEXT NOT NULL CHECK(length(adapter) BETWEEN 1 AND 80),
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','inaccessible','deleted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      last_resolved_at TEXT,
      last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,source_type,source_ref), UNIQUE(space_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS journey_research_sources_catalogue
      ON journey_research_sources(space_id,state,source_type,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_snapshots (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      source_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK(version_number>0),
      fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
      access_state TEXT NOT NULL CHECK(access_state IN ('available','inaccessible','deleted')),
      source_label TEXT NOT NULL CHECK(length(source_label)<=800),
      excerpt TEXT NOT NULL CHECK(length(excerpt)<=8192),
      population TEXT NOT NULL CHECK(length(population)<=800),
      sample_size INTEGER CHECK(sample_size IS NULL OR sample_size BETWEEN 0 AND 1000000000),
      collected_at TEXT, window_start TEXT, window_end TEXT, source_updated_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND length(metadata_json)<=32768),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL,
      UNIQUE(id,source_id,space_id), UNIQUE(source_id,version_number), UNIQUE(source_id,fingerprint),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
      CHECK(window_start IS NULL OR window_end IS NULL OR window_end>=window_start),
      CHECK(retention_expires_at>created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_research_snapshots_history
      ON journey_research_snapshots(space_id,source_id,version_number DESC,id);
    CREATE INDEX IF NOT EXISTS journey_research_snapshots_retention
      ON journey_research_snapshots(retention_expires_at,space_id,source_id,id);

    CREATE TABLE IF NOT EXISTS journey_research_links (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card','persona')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','invalidated')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(snapshot_id,source_id,space_id)
        REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_research_links_one_active_source
      ON journey_research_links(space_id,target_type,target_id,source_id) WHERE state='active';
    CREATE INDEX IF NOT EXISTS journey_research_links_target
      ON journey_research_links(space_id,target_type,target_id,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_assessments (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      link_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK(revision>0),
      relationship TEXT NOT NULL CHECK(relationship IN ('supports','contradicts','neutral')),
      classification TEXT NOT NULL CHECK(classification IN (
        'hypothesis','anecdotal','supported','strongly_supported','contradicted','stale','invalidated')),
      confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      freshness_days INTEGER CHECK(freshness_days IS NULL OR freshness_days BETWEEN 1 AND 3650),
      reason_summary TEXT NOT NULL DEFAULT '' CHECK(length(reason_summary)<=4096),
      reason_sha256 TEXT NOT NULL CHECK(length(reason_sha256)=64),
      reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      method TEXT NOT NULL CHECK(method IN ('human_review','imported_review')),
      created_at TEXT NOT NULL,
      UNIQUE(link_id,revision), UNIQUE(id,link_id,space_id),
      FOREIGN KEY(link_id,space_id) REFERENCES journey_research_links(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_research_assessments_history
      ON journey_research_assessments(space_id,link_id,revision DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_gaps (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card','persona')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 800),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=8192),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','planned','in_progress','resolved','dismissed')),
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolution_link_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      due_at TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(resolution_link_id,space_id) REFERENCES journey_research_links(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_research_gaps_inbox
      ON journey_research_gaps(space_id,status,priority,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_intakes (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      knowledge_document_id TEXT NOT NULL,
      intake_kind TEXT NOT NULL CHECK(intake_kind IN ('interview','observation','research_note')),
      method TEXT NOT NULL CHECK(length(method) BETWEEN 1 AND 120),
      conducted_at TEXT,
      population TEXT NOT NULL DEFAULT '' CHECK(length(population)<=800),
      tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND length(tags_json)<=4096),
      consent_basis TEXT NOT NULL CHECK(consent_basis IN ('documented','not_required')),
      researcher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      retention_expires_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(knowledge_document_id,knowledge_base_id,space_id)
        REFERENCES knowledge_documents(id,knowledge_base_id,space_id) ON DELETE RESTRICT,
      CHECK(retention_expires_at>created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_research_intakes_history
      ON journey_research_intakes(space_id,intake_kind,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_monitors (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused')),
      interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 300 AND 2592000),
      next_run_at TEXT NOT NULL, last_run_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,source_id,owner_user_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_research_monitors_due
      ON journey_research_monitors(state,next_run_at,space_id,id);

    CREATE TABLE IF NOT EXISTS journey_research_refresh_runs (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL, monitor_id TEXT,
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual','scheduled')),
      state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry_wait','completed','failed')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      available_at TEXT NOT NULL,
      lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
      lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
      lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
      before_snapshot_id TEXT, after_snapshot_id TEXT,
      changed_fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(changed_fields_json) AND length(changed_fields_json)<=16384),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(monitor_id,space_id) REFERENCES journey_research_monitors(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(before_snapshot_id,source_id,space_id)
        REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(after_snapshot_id,source_id,space_id)
        REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT,
      CHECK((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
      CHECK((state IN ('completed','failed'))=(completed_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_research_refresh_runs_claim
      ON journey_research_refresh_runs(state,available_at,lease_expires_at,space_id,id);
    CREATE INDEX IF NOT EXISTS journey_research_refresh_runs_source
      ON journey_research_refresh_runs(space_id,source_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_refresh_attempts (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 100),
      lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
      status TEXT NOT NULL CHECK(status IN ('succeeded','retryable_failed','terminal_failed','lease_expired')),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
      started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      UNIQUE(run_id,attempt_number,status),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_research_refresh_runs(id,space_id) ON DELETE CASCADE,
      CHECK((status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
      CHECK(completed_at>=started_at)
    );
    CREATE INDEX IF NOT EXISTS journey_research_refresh_attempts_history
      ON journey_research_refresh_attempts(space_id,run_id,attempt_number,id);

    CREATE TABLE IF NOT EXISTS journey_research_notifications (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL, refresh_run_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('source_changed','source_inaccessible','source_recovered','source_stale','refresh_failed')),
      dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 200),
      state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND length(detail_json)<=8192),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at TEXT NOT NULL, read_at TEXT,
      UNIQUE(id,space_id), UNIQUE(space_id,user_id,dedupe_key),
      FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(refresh_run_id,space_id) REFERENCES journey_research_refresh_runs(id,space_id) ON DELETE CASCADE,
      CHECK((state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_research_notifications_inbox
      ON journey_research_notifications(space_id,user_id,state,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_research_audit_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN (
        'source.catalogued','source.state_changed','snapshot.created','link.created','link.snapshot_applied',
        'assessment.created','gap.created','gap.updated','intake.created','monitor.created','monitor.updated',
        'refresh.queued','refresh.completed','refresh.failed','notification.updated')),
      target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 80),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND length(detail_json)<=8192),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_research_audit_history
      ON journey_research_audit_events(space_id,created_at DESC,id);

    CREATE TRIGGER IF NOT EXISTS journey_research_snapshots_append_only_trigger
      BEFORE UPDATE ON journey_research_snapshots
      BEGIN SELECT RAISE(ABORT,'Journey Research Hub snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_research_assessments_append_only_trigger
      BEFORE UPDATE ON journey_research_assessments
      BEGIN SELECT RAISE(ABORT,'Journey Research Hub assessments are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_research_intakes_append_only_trigger
      BEFORE UPDATE ON journey_research_intakes
      BEGIN SELECT RAISE(ABORT,'Journey Research Hub intakes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_research_refresh_attempts_append_only_trigger
      BEFORE UPDATE ON journey_research_refresh_attempts
      BEGIN SELECT RAISE(ABORT,'Journey Research Hub attempts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_research_audit_append_only_trigger
      BEFORE UPDATE ON journey_research_audit_events
      BEGIN SELECT RAISE(ABORT,'Journey Research Hub audit is append-only'); END;

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

  const planSeededAt = '2026-08-04T00:00:00.000Z';
  const displayOrders: Record<string, number> = { starter: 10, team: 20, enterprise: 30 };
  const insertPlan = db.prepare(`INSERT OR IGNORE INTO platform_subscription_plans
    (code,name,description,requestable,features_json,limits_json,display_order,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,?,?)`);
  for (const plan of defaultSubscriptionPlanCatalog) {
    insertPlan.run(plan.code, plan.name, plan.description, plan.requestable ? 1 : 0, JSON.stringify(plan.features),
      JSON.stringify(plan.limits), displayOrders[plan.code] ?? 0, planSeededAt, planSeededAt);
  }
  completeManagedPlanCatalog();
  backfillLegacyDirectAiUsage();

  addColumn('platform_rbac_user_roles', 'revocation_reason', 'TEXT');

  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(15, 'platform_administration_and_recovery_history', new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(16, 'administrator_rbac_control_plane', new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(17, 'managed_subscription_plan_catalog', new Date().toISOString());
  seedControlPlaneRoles();

  // New built-in permissions are added once so an upgrade grants them to the
  // shipped roles without continually restoring a permission an administrator
  // may later choose to remove.
  const journeyTemplatePermissionMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(18);
  if (!journeyTemplatePermissionMigration) {
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT OR IGNORE INTO platform_rbac_role_permissions
      (role_id,permission,granted_by_user_id,granted_at) VALUES (?,?,NULL,?)`);
    for (const roleId of ['admin', 'editor', 'viewer']) insert.run(roleId, 'journey_templates.read', now);
    for (const roleId of ['admin', 'editor']) insert.run(roleId, 'journey_templates.manage', now);
    db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
      .run(18, 'governed_journey_template_permissions', now);
  }
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(19, 'durable_subscription_usage_ledger', new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(20, 'journey_event_control_plane', new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(21, 'journey_research_hub', new Date().toISOString());
}

ensurePlatformSchema();

export function ensureConfiguredRootPlatformRole(userId: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_role_assignments
    (id,user_id,role,granted_by_user_id,granted_at,revoked_by_user_id,revoked_at,reason)
    VALUES (?,?, 'superadmin', ?, ?, NULL, NULL, ?)
    ON CONFLICT DO NOTHING`).run(crypto.randomUUID(), userId, userId, now, 'Configured platform bootstrap administrator');
}
