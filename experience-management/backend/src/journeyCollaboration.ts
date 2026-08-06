import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './database.js';
import { assertSubscriptionFeature, assertSubscriptionQuota, effectiveSubscriptionForSpace } from './subscriptionEntitlements.js';
import {
  decodeJourneyPageCursor, encodeJourneyPageCursor, journeyCollaborationCapabilities,
  journeyCollaborationLimits, journeyCollaborationRoles, journeyCollaborationTargetTypes,
  journeyGovernanceTargetTypes, journeyRoleCapabilities, journeyRoleCapabilitiesContained,
  normalizeJourneyCommentBody,
  type JourneyCollaborationCapability, type JourneyCollaborationRole,
  type JourneyCollaborationTargetType, type JourneyGovernanceTargetType
} from './journeyCollaborationSchema.js';

export type JourneyTargetReference = {
  targetType: JourneyCollaborationTargetType;
  targetId: string;
};

export type JourneyResolvedTarget = JourneyTargetReference & {
  title: string;
  revision: number;
  checksum: string;
  journeyDefinitionId: string | null;
};

export type JourneyCollaborationSettings = {
  enabled: boolean;
  commentsEnabled: boolean;
  sharingEnabled: boolean;
  externalDownloadsEnabled: boolean;
  commentRetentionDays: number;
  viewRetentionDays: number;
  maximumShareDays: number;
  securityReviewReference: string | null;
  securityReviewedAt: string | null;
  revision: number;
  updatedAt: string | null;
};

export class JourneyCollaborationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_COLLABORATION_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyCollaborationError';
  }
}

function nowIso() { return new Date().toISOString(); }
function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  // `Object.entries(new Date())` is empty, so a Date canonicalised to `{}`. Only
  // SQLite stores timestamps as TEXT; the PostgreSQL adapter returns TIMESTAMPTZ
  // as a JS Date, so every replayed mutation response and every intent hash
  // containing a timestamp silently lost it there and nowhere else.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Set || value instanceof Map) return stable([...value]);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  // UTF-16 code-unit order, not `localeCompare`. These hashes are persisted --
  // `intent_sha256` gates idempotent replay and `content_sha256` is re-verified
  // on every comment read -- so key order has to be identical on every runtime
  // for ever. `localeCompare` is locale- and ICU-dependent: a small-ICU Node
  // build, a different LANG, or one future pair of keys differing only by case
  // reorders the object and turns stored comments unreadable behind
  // JOURNEY_COMMENT_INTEGRITY_FAILED. Runtime-28 is unapplied, so no persisted
  // hash exists yet and this is the last moment the ordering can be pinned for
  // free.
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, nested]) => [key, stable(nested)]));
}
function canonical(value: unknown) { return JSON.stringify(stable(value)); }
function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
/** Uniqueness only. The race-recovery paths (`upsertWatcher`, `appendNotification`)
 * retry or swallow on the strength of this predicate, so widening it to every
 * constraint class would make them absorb a foreign-key or CHECK failure as
 * "someone else already inserted this row". */
function isUniqueViolation(value: unknown) {
  const code = String((value as { code?: string })?.code || '');
  const message = String((value as Error)?.message || '');
  return ['23505', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(code)
    || /unique constraint|UNIQUE constraint/iu.test(message);
}
/** Any database guard rejecting a write. Used only to map a failed mutation onto
 * 409 rather than 500: a tenant target guard, a thread-shape trigger or a
 * composite foreign key firing means the request lost a race with a concurrent
 * change (or hit a guard the application check cannot see), which is a conflict
 * the caller can retry -- not an internal error. */
function isConstraintError(value: unknown) {
  const code = String((value as { code?: string })?.code || '');
  const message = String((value as Error)?.message || '');
  return isUniqueViolation(value)
    || ['23503', '23514', '23502', 'SQLITE_CONSTRAINT_TRIGGER', 'SQLITE_CONSTRAINT_FOREIGNKEY',
      'SQLITE_CONSTRAINT_CHECK', 'SQLITE_CONSTRAINT_NOTNULL'].includes(code)
    || /constraint failed|foreign key constraint|violates .* constraint/iu.test(message);
}
/** Catalogue lookup, never a probe SELECT. `SELECT 1 FROM <table>` in a
 * try/catch is safe on SQLite and poison on PostgreSQL: a missing relation
 * raises 42P01, which aborts the enclosing transaction, and the swallowed error
 * then turns every following statement into 25P02. This is reached from
 * `resolveJourneyCollaborationTarget`, which several mutations call inside
 * `run()` -- i.e. inside a transaction. */
function tableExists(name: string) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(name)) return false;
  const row = db.provider === 'postgres'
    ? db.prepare('SELECT to_regclass(?) present').get(`public.${name}`) as { present?: string | null } | undefined
    : db.prepare("SELECT name present FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { present?: string | null } | undefined;
  return Boolean(row?.present);
}

/** Tenant-scoped existence of a collaboration target, mirroring
 * `journey_collaboration_target_exists` in 0028. SQLite has no shared trigger
 * function, so the predicate is emitted once per target type per table. */
const targetExistsSql: Record<JourneyCollaborationTargetType, string> = {
  journey_map: `SELECT 1 FROM journey_definitions
    WHERE id=NEW.target_id AND space_id=NEW.space_id AND status<>'archived'`,
  journey_stage: `SELECT 1 FROM journey_map_stages stage
    JOIN journey_map_versions version ON version.id=stage.version_id AND version.space_id=stage.space_id
    JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
    WHERE stage.id=NEW.target_id AND stage.space_id=NEW.space_id AND definition.status<>'archived'`,
  journey_card: `SELECT 1 FROM journey_map_cards card
    JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
    JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
    WHERE card.id=NEW.target_id AND card.space_id=NEW.space_id AND definition.status<>'archived'`,
  persona: `SELECT 1 FROM journey_personas
    WHERE id=NEW.target_id AND space_id=NEW.space_id AND lifecycle_state<>'retired'`,
  portfolio_item: `SELECT 1 FROM journey_portfolio_items
    WHERE id=NEW.target_id AND space_id=NEW.space_id AND state='active'`,
  recommendation: `SELECT 1 FROM journey_map_cards card
    JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
    JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
    WHERE card.id=NEW.target_id AND card.space_id=NEW.space_id
      AND card.kind IN ('opportunity','solution','initiative') AND definition.status<>'archived'`
};

function targetGuardSql(table: string, types: readonly JourneyCollaborationTargetType[]) {
  let sql = '';
  for (const type of types) {
    // journey_portfolio_items is created by journeyPortfolio.ts at its own module
    // load and this module does not import it, so the trigger is only declared
    // once the table is present. Skipping it cannot open a write path: the facade
    // resolves every target through resolveJourneyCollaborationTarget first, and
    // that read is guarded by the same tableExists check.
    if (type === 'portfolio_item' && !tableExists('journey_portfolio_items')) continue;
    for (const event of ['INSERT', 'UPDATE OF space_id,target_type,target_id'] as const) {
      sql += `CREATE TRIGGER IF NOT EXISTS ${table}_${type}_guard_${event.startsWith('INSERT') ? 'insert' : 'update'}
        BEFORE ${event} ON ${table} WHEN NEW.target_type='${type}' AND NOT EXISTS (${targetExistsSql[type]})
        BEGIN SELECT RAISE(ABORT,'Journey collaboration target is outside the tenant'); END;\n`;
    }
  }
  return sql;
}

/** PostgreSQL is migrated offline. SQLite gets a development/test projection at
 * module load so route and domain tests exercise the same normalised model and
 * referential behaviour. Divergences that remain are listed at the end of this
 * function; none of them is a weaker authorisation or tenancy check. */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_collaboration_definitions_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_collaboration_personas_tenant_identity
      ON journey_personas(id,space_id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_settings (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK(comments_enabled IN (0,1)),
      sharing_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sharing_enabled IN (0,1)),
      external_downloads_enabled INTEGER NOT NULL DEFAULT 0 CHECK(external_downloads_enabled IN (0,1)),
      comment_retention_days INTEGER NOT NULL DEFAULT 30 CHECK(comment_retention_days BETWEEN 1 AND 3650),
      view_retention_days INTEGER NOT NULL DEFAULT 30 CHECK(view_retention_days BETWEEN 1 AND 3650),
      maximum_share_days INTEGER NOT NULL DEFAULT 30 CHECK(maximum_share_days BETWEEN 1 AND 365),
      security_review_reference TEXT,
      security_reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      security_reviewed_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      CHECK((sharing_enabled=0 AND security_review_reference IS NULL AND security_reviewed_by_user_id IS NULL
          AND security_reviewed_at IS NULL)
        OR (sharing_enabled=1 AND length(security_review_reference) BETWEEN 8 AND 200
          AND security_reviewed_by_user_id IS NOT NULL AND security_reviewed_at IS NOT NULL)),
      CHECK(external_downloads_enabled=0 OR sharing_enabled=1)
    );
    CREATE TABLE IF NOT EXISTS journey_collaboration_role_assignments (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('space','journey')),journey_definition_id TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK(role IN ('viewer','contributor','editor','approver','manager','administrator')),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TEXT NOT NULL,revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TEXT,revocation_reason_sha256 TEXT,
      UNIQUE(id,space_id),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      CHECK((scope_type='space' AND journey_definition_id IS NULL)
        OR (scope_type='journey' AND journey_definition_id IS NOT NULL)),
      CHECK((state='active' AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason_sha256 IS NULL)
        OR (state='revoked' AND revoked_at IS NOT NULL AND length(revocation_reason_sha256)=64))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_collaboration_roles_one_active
      ON journey_collaboration_role_assignments(space_id,user_id,scope_type,IFNULL(journey_definition_id,''))
      WHERE state='active';
    CREATE INDEX IF NOT EXISTS journey_collaboration_roles_lookup
      ON journey_collaboration_role_assignments(space_id,user_id,state,scope_type,journey_definition_id,assigned_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_role_events (
      id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL,space_id TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('assigned','revoked')),
      role TEXT NOT NULL,scope_type TEXT NOT NULL,journey_definition_id TEXT,reason_sha256 TEXT,created_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      -- Per-subject audit follows its subject. The assignment cascades from
      -- space_memberships and journey_definitions, so under RESTRICT removing a
      -- member or deleting a journey raised a raw foreign-key error from here.
      -- The durable record of the same facts is the space-scoped activity and
      -- audit ledgers, which carry no parent key and stay sealed.
      FOREIGN KEY(assignment_id,space_id)
        REFERENCES journey_collaboration_role_assignments(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_role_events_history
      ON journey_collaboration_role_events(space_id,assignment_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_comments (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN (
        'journey_map','journey_stage','journey_card','persona','portfolio_item','recommendation')),
      target_id TEXT NOT NULL,journey_definition_id TEXT,parent_comment_id TEXT,root_comment_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','resolved','deleted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),current_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,edited_at TEXT,resolved_at TEXT,resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      deleted_at TEXT,retention_expires_at TEXT,UNIQUE(id,space_id),UNIQUE(id,space_id,target_type,target_id),
      FOREIGN KEY(space_id,author_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(parent_comment_id,space_id) REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(root_comment_id,space_id) REFERENCES journey_comments(id,space_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      CHECK((parent_comment_id IS NULL AND root_comment_id=id) OR (parent_comment_id IS NOT NULL AND root_comment_id<>id)),
      CHECK((state='active' AND resolved_at IS NULL AND resolved_by_user_id IS NULL AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='resolved' AND parent_comment_id IS NULL AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL
          AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
          AND retention_expires_at>=deleted_at))
    );
    CREATE INDEX IF NOT EXISTS journey_comments_target
      ON journey_comments(space_id,target_type,target_id,state,created_at,id);
    CREATE INDEX IF NOT EXISTS journey_comments_thread ON journey_comments(space_id,root_comment_id,created_at,id);
    CREATE INDEX IF NOT EXISTS journey_comments_retention ON journey_comments(retention_expires_at,id) WHERE state='deleted';
    CREATE TABLE IF NOT EXISTS journey_comment_versions (
      id TEXT PRIMARY KEY,comment_id TEXT NOT NULL,space_id TEXT NOT NULL,version_number INTEGER NOT NULL CHECK(version_number>0),
      schema_version INTEGER NOT NULL CHECK(schema_version=1),body_json TEXT NOT NULL CHECK(json_valid(body_json)),
      plain_text TEXT NOT NULL CHECK(length(plain_text) BETWEEN 1 AND 8000),content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      editor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,edit_reason_sha256 TEXT,created_at TEXT NOT NULL,
      UNIQUE(id,space_id),UNIQUE(id,comment_id,space_id),UNIQUE(comment_id,version_number),
      FOREIGN KEY(comment_id,space_id) REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(space_id,editor_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_comment_versions_history
      ON journey_comment_versions(space_id,comment_id,version_number DESC,id);
    CREATE TABLE IF NOT EXISTS journey_comment_mentions (
      comment_id TEXT NOT NULL,space_id TEXT NOT NULL,user_id TEXT NOT NULL,comment_revision INTEGER NOT NULL CHECK(comment_revision>0),
      created_at TEXT NOT NULL,PRIMARY KEY(comment_id,user_id,comment_revision),
      FOREIGN KEY(comment_id,space_id) REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(comment_id,comment_revision)
        REFERENCES journey_comment_versions(comment_id,version_number) ON DELETE CASCADE,
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_comment_mentions_recipient
      ON journey_comment_mentions(space_id,user_id,created_at DESC,comment_id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_watchers (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN (
        'journey_map','journey_stage','journey_card','persona','portfolio_item','recommendation')),
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'watching' CHECK(state IN ('watching','muted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(id,space_id),UNIQUE(space_id,target_type,target_id,user_id),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      CHECK(updated_at>=created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_watchers_target
      ON journey_collaboration_watchers(space_id,target_type,target_id,state,user_id);
    CREATE TABLE IF NOT EXISTS journey_governance_reviews (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio_item','recommendation')),
      target_id TEXT NOT NULL,journey_definition_id TEXT,target_revision INTEGER NOT NULL CHECK(target_revision>0),
      target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64),
      state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','withdrawn','published')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      request_summary TEXT NOT NULL CHECK(length(request_summary) BETWEEN 3 AND 2000),
      request_reason_sha256 TEXT NOT NULL CHECK(length(request_reason_sha256)=64),requested_at TEXT NOT NULL,due_at TEXT,
      decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,decision_summary TEXT,decided_at TEXT,
      published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,published_at TEXT,
      UNIQUE(id,space_id),FOREIGN KEY(space_id,requested_by_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      CHECK(decision_summary IS NULL OR length(decision_summary) BETWEEN 3 AND 2000),
      CHECK(due_at IS NULL OR due_at>requested_at),
      CHECK((state='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL
          AND published_by_user_id IS NULL AND published_at IS NULL)
        OR (state IN ('approved','rejected') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
          AND published_by_user_id IS NULL AND published_at IS NULL)
        OR (state='withdrawn' AND decided_at IS NOT NULL AND published_by_user_id IS NULL AND published_at IS NULL)
        OR (state='published' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
          AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_governance_reviews_one_pending
      ON journey_governance_reviews(space_id,target_type,target_id,target_revision) WHERE state='pending';
    CREATE INDEX IF NOT EXISTS journey_governance_reviews_target
      ON journey_governance_reviews(space_id,target_type,target_id,state,requested_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_governance_review_events (
      id TEXT PRIMARY KEY,review_id TEXT NOT NULL,space_id TEXT NOT NULL,actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('submitted','approved','rejected','withdrawn','published','superseded')),
      state_from TEXT,state_to TEXT NOT NULL CHECK(state_to IN ('pending','approved','rejected','withdrawn','published')),
      reason_sha256 TEXT NOT NULL CHECK(length(reason_sha256)=64),created_at TEXT NOT NULL,
      UNIQUE(id,space_id),FOREIGN KEY(review_id,space_id) REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_governance_review_events_history
      ON journey_governance_review_events(space_id,review_id,created_at,id);
    CREATE TABLE IF NOT EXISTS journey_governance_publications (
      id TEXT PRIMARY KEY,review_id TEXT NOT NULL,space_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio_item','recommendation')),
      target_id TEXT NOT NULL,
      target_revision INTEGER NOT NULL CHECK(target_revision>0),
      target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64),
      published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      published_at TEXT NOT NULL,UNIQUE(id,space_id),UNIQUE(review_id),
      FOREIGN KEY(review_id,space_id) REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_governance_publications_target
      ON journey_governance_publications(space_id,target_type,target_id,published_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_notifications (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,recipient_user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('mention','comment','reply','resolved','reopened',
        'review_requested','review_decided','published','role_changed')),
      target_type TEXT NOT NULL,target_id TEXT NOT NULL,actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      comment_id TEXT,review_id TEXT,event_id TEXT NOT NULL,dedupe_sha256 TEXT NOT NULL CHECK(length(dedupe_sha256)=64),created_at TEXT NOT NULL,
      UNIQUE(id,space_id),UNIQUE(id,space_id,recipient_user_id),UNIQUE(space_id,recipient_user_id,dedupe_sha256),
      FOREIGN KEY(space_id,recipient_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(comment_id,space_id) REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(review_id,space_id) REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE,
      CHECK((kind IN ('mention','comment','reply','resolved','reopened') AND comment_id IS NOT NULL)
        OR (kind IN ('review_requested','review_decided','published') AND review_id IS NOT NULL)
        OR kind='role_changed')
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_notifications_recipient
      ON journey_collaboration_notifications(space_id,recipient_user_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_notification_states (
      notification_id TEXT NOT NULL,space_id TEXT NOT NULL,recipient_user_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),read_at TEXT,PRIMARY KEY(notification_id,space_id),
      FOREIGN KEY(notification_id,space_id,recipient_user_id)
        REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE,
      CHECK((state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_notification_states_recipient
      ON journey_collaboration_notification_states(space_id,recipient_user_id,state,notification_id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_notification_state_events (
      id TEXT PRIMARY KEY,notification_id TEXT NOT NULL,space_id TEXT NOT NULL,recipient_user_id TEXT NOT NULL,
      state_from TEXT NOT NULL,state_to TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(id,space_id),
      FOREIGN KEY(notification_id,space_id,recipient_user_id)
        REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_collaboration_views (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('journey_map','portfolio')),resource_id TEXT NOT NULL,
      name TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
      visibility TEXT NOT NULL CHECK(visibility IN ('private','space')),owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      schema_version INTEGER NOT NULL CHECK(schema_version=1),configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
      configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64),state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      deleted_at TEXT,retention_expires_at TEXT,UNIQUE(id,space_id),
      FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      CHECK((resource_type='portfolio' AND resource_id=space_id) OR resource_type='journey_map'),
      CHECK((state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
          AND retention_expires_at>=deleted_at)),
      CHECK(updated_at>=created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_views_query
      ON journey_collaboration_views(space_id,resource_type,resource_id,state,audience,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_collaboration_views_owner
      ON journey_collaboration_views(space_id,owner_user_id,state,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_collaboration_views_retention
      ON journey_collaboration_views(retention_expires_at,id) WHERE state='deleted';
    CREATE TABLE IF NOT EXISTS journey_read_only_shares (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio','collaboration_view')),target_id TEXT NOT NULL,
      target_revision INTEGER NOT NULL CHECK(target_revision>0),token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
      token_prefix TEXT NOT NULL CHECK(length(token_prefix) BETWEEN 8 AND 16),
      token_version INTEGER NOT NULL DEFAULT 1 CHECK(token_version>0),permission TEXT NOT NULL DEFAULT 'view' CHECK(permission='view'),
      allow_export INTEGER NOT NULL DEFAULT 0 CHECK(allow_export IN (0,1)),allow_download INTEGER NOT NULL DEFAULT 0 CHECK(allow_download IN (0,1)),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
      rotated_at TEXT,revoked_at TEXT,revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,revocation_reason_sha256 TEXT,
      UNIQUE(id,space_id),FOREIGN KEY(space_id,created_by_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      CHECK(allow_download=0 OR allow_export=1),
      CHECK(expires_at>created_at),
      CHECK((state='active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason_sha256 IS NULL)
        OR (state='revoked' AND revoked_at IS NOT NULL AND length(revocation_reason_sha256)=64))
    );
    CREATE INDEX IF NOT EXISTS journey_read_only_shares_target
      ON journey_read_only_shares(space_id,target_type,target_id,state,expires_at,id);
    CREATE INDEX IF NOT EXISTS journey_read_only_shares_expiry
      ON journey_read_only_shares(expires_at,id) WHERE state='active';
    CREATE TABLE IF NOT EXISTS journey_share_access_events (
      id TEXT PRIMARY KEY,share_id TEXT,space_id TEXT,token_fingerprint TEXT NOT NULL,requester_fingerprint TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied')),reason_code TEXT NOT NULL,
      requested_action TEXT NOT NULL CHECK(requested_action IN ('view','download')),created_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      -- No foreign key to journey_read_only_shares, matching 0028: composite
      -- ON DELETE SET NULL is executed as an UPDATE that this table's append-only
      -- seal refuses, so an accessed share could never be deleted, and under
      -- MATCH SIMPLE a NULL space_id skipped the check the key existed for.
      CHECK((share_id IS NULL AND space_id IS NULL) OR (share_id IS NOT NULL AND space_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_share_access_events_share
      ON journey_share_access_events(space_id,share_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_share_access_events_retention
      ON journey_share_access_events(created_at,id);
    CREATE TABLE IF NOT EXISTS journey_share_rate_buckets (
      requester_fingerprint TEXT NOT NULL,token_fingerprint TEXT NOT NULL,bucket_started_at TEXT NOT NULL,
      attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 1000000),updated_at TEXT NOT NULL,
      PRIMARY KEY(requester_fingerprint,token_fingerprint,bucket_started_at)
    );
    CREATE TABLE IF NOT EXISTS journey_collaboration_operations (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,idempotency_key TEXT NOT NULL,
      action TEXT NOT NULL,intent_sha256 TEXT NOT NULL,response_json TEXT NOT NULL CHECK(json_valid(response_json)),created_at TEXT NOT NULL,
      UNIQUE(id,space_id),UNIQUE(space_id,actor_user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS journey_collaboration_activity (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
      journey_definition_id TEXT,comment_id TEXT,review_id TEXT,detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),created_at TEXT NOT NULL,
      UNIQUE(id,space_id)
      -- The three subject references carry no foreign key, matching 0028. As
      -- composite ON DELETE SET NULL edges they were doubly unusable: SET NULL is
      -- an UPDATE that this table's seal refuses, and it nulls every referencing
      -- column including space_id, which is NOT NULL -- so once any activity
      -- existed, deleting the journey, comment or review it describes failed.
      -- This is the audit of record for those events and must outlive its subject.
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_activity_target
      ON journey_collaboration_activity(space_id,target_type,target_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_collaboration_activity_retention
      ON journey_collaboration_activity(created_at,id);
    CREATE TABLE IF NOT EXISTS journey_collaboration_audit_events (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
      request_id TEXT,detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),created_at TEXT NOT NULL,UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_collaboration_audit_history
      ON journey_collaboration_audit_events(space_id,target_type,target_id,created_at DESC,id);
  `);
  // The circular current-version constraint must be added at CREATE time in
  // PostgreSQL. SQLite cannot add it later, so repository reads additionally
  // verify the exact comment/version identity before returning content.
  //
  // Two classes of sealed table, and the difference is load-bearing (0028:701).
  // Content sealed against rewriting but still reachable by its parent's cascade
  // and by the retention sweep takes BEFORE UPDATE only: every table here is the
  // child of a declared cascade, and under OR DELETE the cascade issued a DELETE
  // the guard refused, so deleting a journey, removing a member or sweeping an
  // expired comment failed and the cascade was dead DDL.
  const updateOnlySealed = [
    'journey_collaboration_role_events', 'journey_comment_versions', 'journey_governance_review_events',
    'journey_governance_publications', 'journey_collaboration_notifications',
    'journey_collaboration_notification_state_events'
  ];
  // Space-scoped ledgers stay sealed against DELETE as well: none is the child of
  // any cascade except spaces, and each records a fact that must outlive its
  // subject.
  const ledgerSealed = [
    'journey_share_access_events', 'journey_collaboration_operations',
    'journey_collaboration_activity', 'journey_collaboration_audit_events'
  ];
  for (const table of [...updateOnlySealed, ...ledgerSealed]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_update_append_only BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Journey collaboration history is append-only'); END;`);
  }
  for (const table of ledgerSealed) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_delete_append_only BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Journey collaboration history is append-only'); END;`);
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS journey_comment_root_thread_guard
      BEFORE INSERT ON journey_comments WHEN NEW.parent_comment_id IS NULL AND NEW.root_comment_id<>NEW.id
      BEGIN SELECT RAISE(ABORT,'Root comments must reference themselves'); END;
    CREATE TRIGGER IF NOT EXISTS journey_comment_root_thread_guard_update
      BEFORE UPDATE OF parent_comment_id,root_comment_id,target_type,target_id ON journey_comments
      WHEN NEW.parent_comment_id IS NULL AND NEW.root_comment_id<>NEW.id
      BEGIN SELECT RAISE(ABORT,'Root comments must reference themselves'); END;
    CREATE TRIGGER IF NOT EXISTS journey_comment_reply_thread_guard
      BEFORE INSERT ON journey_comments WHEN NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_comments parent WHERE parent.id=NEW.parent_comment_id AND parent.space_id=NEW.space_id
          AND parent.parent_comment_id IS NULL AND parent.root_comment_id=NEW.root_comment_id
          AND parent.target_type=NEW.target_type AND parent.target_id=NEW.target_id AND parent.state<>'deleted')
      BEGIN SELECT RAISE(ABORT,'Replies require an active root comment on the same target'); END;
    CREATE TRIGGER IF NOT EXISTS journey_comment_reply_thread_guard_update
      BEFORE UPDATE OF parent_comment_id,root_comment_id,target_type,target_id ON journey_comments
      WHEN NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_comments parent WHERE parent.id=NEW.parent_comment_id AND parent.space_id=NEW.space_id
          AND parent.parent_comment_id IS NULL AND parent.root_comment_id=NEW.root_comment_id
          AND parent.target_type=NEW.target_type AND parent.target_id=NEW.target_id AND parent.state<>'deleted')
      BEGIN SELECT RAISE(ABORT,'Replies require an active root comment on the same target'); END;
  `);
  db.exec(targetGuardSql('journey_comments', journeyCollaborationTargetTypes)
    + targetGuardSql('journey_collaboration_watchers', journeyCollaborationTargetTypes)
    + targetGuardSql('journey_governance_reviews', journeyGovernanceTargetTypes));
}
ensureSqliteSchema();

function settingsRow(spaceId: string): JourneyCollaborationSettings {
  const row = db.prepare('SELECT * FROM journey_collaboration_settings WHERE space_id=?').get(spaceId) as any;
  return row ? {
    enabled: Boolean(Number(row.enabled)), commentsEnabled: Boolean(Number(row.comments_enabled)),
    sharingEnabled: Boolean(Number(row.sharing_enabled)),
    externalDownloadsEnabled: Boolean(Number(row.external_downloads_enabled)),
    commentRetentionDays: Number(row.comment_retention_days), viewRetentionDays: Number(row.view_retention_days),
    maximumShareDays: Number(row.maximum_share_days), securityReviewReference: row.security_review_reference || null,
    securityReviewedAt: row.security_reviewed_at || null, revision: Number(row.revision), updatedAt: row.updated_at
  } : {
    enabled: true, commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: null, securityReviewedAt: null, revision: 0, updatedAt: null
  };
}

export function journeyCollaborationPlanState(spaceId: string) {
  const effective = effectiveSubscriptionForSpace(spaceId);
  const settings = settingsRow(spaceId);
  return {
    enabledByPlan: effective.plan.features.journeyCollaboration,
    limits: {
      collaborators: effective.plan.limits.seats,
      shares: effective.plan.limits.journeyShares,
      views: effective.plan.limits.journeySavedViews
    },
    settings,
    readOnly: !effective.plan.features.journeyCollaboration || !settings.enabled
  };
}

/** Membership is checked first, and that ordering is load-bearing twice over.
 *
 * It is the tenancy gate for idempotent replay. `idempotentMutation` returns the
 * stored response before `run()` executes, so for every mutation that resolves
 * its subject inside `run()` this is the only authorisation on the replay path.
 * With the plan gate first, an actor who had since been removed from the space
 * could replay their own key and be handed the stored payload back -- comment
 * bodies for `comment.resolve`, request and decision summaries for the
 * governance transitions.
 *
 * It is also the ordering that stops a non-member from reading tenant state:
 * probing a known space id used to answer `SUBSCRIPTION_FEATURE_REQUIRED` or
 * `JOURNEY_COMMENTS_DISABLED`, which discloses the tenant's plan and kill-switch
 * settings to someone with no membership at all. */
function assertCollaborationWritable(spaceId: string, actorUserId: string,
  capability?: 'comments' | 'sharing') {
  membership(spaceId, actorUserId);
  assertSubscriptionFeature(spaceId, 'journeyCollaboration');
  const settings = settingsRow(spaceId);
  if (!settings.enabled) throw new JourneyCollaborationError(
    'Journey collaboration is read-only because it is disabled for this space.', 403,
    'JOURNEY_COLLABORATION_READ_ONLY');
  if (capability === 'comments' && !settings.commentsEnabled) throw new JourneyCollaborationError(
    'Journey comments are disabled for this space.', 403, 'JOURNEY_COMMENTS_DISABLED');
  if (capability === 'sharing' && !settings.sharingEnabled) throw new JourneyCollaborationError(
    'External sharing requires a recorded security/privacy review and must be enabled by a manager.',
    403, 'JOURNEY_SHARING_SECURITY_REVIEW_REQUIRED');
  return settings;
}

/** `user` is a reserved keyword in PostgreSQL and is not accepted where a table
 * alias is parsed, with or without AS, so every statement in this module that
 * aliased `users` as `user` would have raised a syntax error on its first
 * PostgreSQL execution -- membership lookup, role listing, revocation, mentions,
 * edit history, watchers and activity. It never surfaced because runtime-28 has
 * never been applied and SQLite accepts the alias. Every other module in the
 * backend already uses a non-reserved alias; these now match. */
function membership(spaceId: string, userId: string) {
  const row = db.prepare(`SELECT membership.role,member_user.name,member_user.email FROM space_memberships membership
    JOIN users member_user ON member_user.id=membership.user_id
    WHERE membership.space_id=? AND membership.user_id=?`)
    .get(spaceId, userId) as { role?: string; name?: string; email?: string } | undefined;
  if (!row || !['owner', 'admin', 'member'].includes(String(row.role))) throw new JourneyCollaborationError(
    'Current space membership is required.', 403, 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED');
  return row as { role: 'owner' | 'admin' | 'member'; name: string; email: string };
}

function roleFromSpaceMembership(role: 'owner' | 'admin' | 'member'): JourneyCollaborationRole {
  return role === 'owner' ? 'administrator' : role === 'admin' ? 'manager' : 'viewer';
}

function roleRank(role: JourneyCollaborationRole) {
  return journeyCollaborationRoles.indexOf(role);
}

/** What a caller can still reach once the plan feature is gone or the space kill
 * switch is down. Every mutation passes assertCollaborationWritable, so this is
 * the advertised surface, not a second enforcement point. */
const readOnlyCapabilities = new Set<JourneyCollaborationCapability>([
  'journeys.read', 'journeys.view_activity'
]);

function targetJourneyDefinitionId(spaceId: string, target: JourneyTargetReference): string | null {
  if (target.targetType === 'journey_map') return target.targetId;
  if (target.targetType === 'journey_stage') return (db.prepare(`SELECT version.definition_id id
    FROM journey_map_stages target JOIN journey_map_versions version
      ON version.id=target.version_id AND version.space_id=target.space_id
    WHERE target.id=? AND target.space_id=?`).get(target.targetId, spaceId) as any)?.id || null;
  if (['journey_card', 'recommendation'].includes(target.targetType)) return (db.prepare(`SELECT version.definition_id id
    FROM journey_map_cards target JOIN journey_map_versions version
      ON version.id=target.version_id AND version.space_id=target.space_id
    WHERE target.id=? AND target.space_id=?`).get(target.targetId, spaceId) as any)?.id || null;
  return null;
}

export type EffectiveJourneyRole = {
  role: JourneyCollaborationRole;
  source: 'space_membership' | 'space_assignment' | 'journey_assignment';
  readOnly: boolean;
  capabilities: ReadonlySet<JourneyCollaborationCapability>;
};

/** Grants are additive. Taking the journey-scoped assignment, else the
 * space-scoped one, else membership let any manager issue a low journey-scoped
 * grant that silently replaced a higher one -- an administrator handed a
 * journey-scoped `viewer` lost that journey and could not revoke the grant,
 * because revocation re-checks capability in the assignment's own scope.
 *
 * The union is over capabilities, not over `roleRank`. The lattice is not
 * monotonic: an approver holds review/publish without edit and an editor the
 * reverse, so max-by-rank of {editor,approver} would silently drop
 * `journeys.edit`. `role` reports the highest-ranked contributor for display and
 * for the manager checks that read it. */
export function effectiveJourneyRole(spaceId: string, userId: string,
  journeyDefinitionId?: string | null): EffectiveJourneyRole {
  const member = membership(spaceId, userId);
  const baseRole = roleFromSpaceMembership(member.role);
  // Downgrades preserve collaboration records but stop scoped grants from
  // expanding core product permissions until the feature is restored.
  if (!effectiveSubscriptionForSpace(spaceId).plan.features.journeyCollaboration || !settingsRow(spaceId).enabled) {
    return { role: baseRole, source: 'space_membership', readOnly: true,
      capabilities: new Set(journeyRoleCapabilities[baseRole]) };
  }
  const contributors: Array<{ role: JourneyCollaborationRole; source: EffectiveJourneyRole['source'] }> = [
    { role: baseRole, source: 'space_membership' }
  ];
  const space = db.prepare(`SELECT role FROM journey_collaboration_role_assignments
    WHERE space_id=? AND user_id=? AND scope_type='space' AND state='active'
    ORDER BY assigned_at DESC,id DESC LIMIT 1`).get(spaceId, userId) as any;
  if (space && journeyCollaborationRoles.includes(space.role)) {
    contributors.push({ role: space.role as JourneyCollaborationRole, source: 'space_assignment' });
  }
  const scoped = journeyDefinitionId ? db.prepare(`SELECT role FROM journey_collaboration_role_assignments
    WHERE space_id=? AND user_id=? AND scope_type='journey' AND journey_definition_id=? AND state='active'
    ORDER BY assigned_at DESC,id DESC LIMIT 1`).get(spaceId, userId, journeyDefinitionId) as any : null;
  if (scoped && journeyCollaborationRoles.includes(scoped.role)) {
    contributors.push({ role: scoped.role as JourneyCollaborationRole, source: 'journey_assignment' });
  }
  const capabilities = new Set<JourneyCollaborationCapability>();
  for (const contributor of contributors) {
    for (const capability of journeyRoleCapabilities[contributor.role]) capabilities.add(capability);
  }
  const highest = contributors.reduce((left, right) =>
    roleRank(right.role) > roleRank(left.role) ? right : left);
  return { role: highest.role, source: highest.source, readOnly: false, capabilities };
}

/** `options.allowReadOnly` exists for exactly one caller: collaboration settings.
 * The space kill switch is stored in those settings, so enforcing read-only
 * against `journeys.manage_shares` would make disabling collaboration
 * irreversible -- nobody could turn it back on. Every other caller is gated. */
export function assertJourneyCapability(spaceId: string, userId: string,
  capability: JourneyCollaborationCapability,
  target?: JourneyTargetReference | { journeyDefinitionId?: string | null },
  options: { allowReadOnly?: boolean } = {}): EffectiveJourneyRole {
  if (!journeyCollaborationCapabilities.includes(capability)) throw new JourneyCollaborationError(
    'Unknown Journey capability.', 500, 'JOURNEY_CAPABILITY_UNKNOWN');
  const journeyDefinitionId: string | null | undefined = target && 'targetType' in target
    ? targetJourneyDefinitionId(spaceId, target) : target?.journeyDefinitionId;
  if (target && 'targetType' in target && !journeyDefinitionId
    && ['journey_map', 'journey_stage', 'journey_card', 'recommendation'].includes(target.targetType)) {
    throw new JourneyCollaborationError('Journey target not found.', 404, 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND');
  }
  const effective = effectiveJourneyRole(spaceId, userId, journeyDefinitionId);
  if (!effective.capabilities.has(capability)) throw new JourneyCollaborationError(
    'Your Journey role does not allow this action.', 403, 'JOURNEY_CAPABILITY_REQUIRED', {
      capability, role: effective.role, journeyDefinitionId: journeyDefinitionId || null
    });
  // `effectiveJourneyRole` returns the full base-role capability set alongside
  // `readOnly: true` when the plan drops the feature or the space kill switch is
  // down, and this function used to ignore the flag entirely. It was safe only
  // because every current mutation happens to call `assertCollaborationWritable`
  // first -- but this is exported, so the first route or future mutation that
  // authorised with it alone would have been fail-open. It is now fail-closed on
  // its own, and reports the same surface `getJourneyCollaborationContext`
  // advertises to clients.
  if (effective.readOnly && !options.allowReadOnly && !readOnlyCapabilities.has(capability)) {
    throw new JourneyCollaborationError(
      'Journey collaboration is read-only because it is disabled for this space.', 403,
      'JOURNEY_COLLABORATION_READ_ONLY', { capability });
  }
  return effective;
}

function targetSnapshot(value: Record<string, unknown>) {
  const serialized = canonical(value);
  return { serialized, checksum: sha256(serialized) };
}

export function resolveJourneyCollaborationTarget(spaceId: string, target: JourneyTargetReference): JourneyResolvedTarget {
  const { targetType, targetId } = target;
  let row: any;
  if (targetType === 'journey_map') {
    row = db.prepare(`SELECT id,name,revision,status FROM journey_definitions
      WHERE id=? AND space_id=? AND status<>'archived'`).get(targetId, spaceId);
    if (row) {
      const snapshot = targetSnapshot({ id: row.id, name: row.name, revision: Number(row.revision), status: row.status });
      return { ...target, title: row.name, revision: Number(row.revision), checksum: snapshot.checksum,
        journeyDefinitionId: row.id };
    }
  } else if (targetType === 'persona') {
    row = db.prepare(`SELECT id,name,summary,lifecycle_state,revision,current_version_id FROM journey_personas
      WHERE id=? AND space_id=? AND lifecycle_state<>'retired'`).get(targetId, spaceId);
    if (row) {
      const snapshot = targetSnapshot({ id: row.id, name: row.name, summary: row.summary,
        lifecycleState: row.lifecycle_state, revision: Number(row.revision), currentVersionId: row.current_version_id });
      return { ...target, title: row.name, revision: Number(row.revision), checksum: snapshot.checksum,
        journeyDefinitionId: null };
    }
  } else if (targetType === 'portfolio_item') {
    if (tableExists('journey_portfolio_items')) row = db.prepare(`SELECT id,title,kind,lifecycle,revision,state
      FROM journey_portfolio_items WHERE id=? AND space_id=? AND state='active'`).get(targetId, spaceId);
    if (row) {
      const snapshot = targetSnapshot({ id: row.id, title: row.title, kind: row.kind,
        lifecycle: row.lifecycle, revision: Number(row.revision) });
      return { ...target, title: row.title, revision: Number(row.revision), checksum: snapshot.checksum,
        journeyDefinitionId: null };
    }
  } else if (targetType === 'journey_stage') {
    row = db.prepare(`SELECT stage.id,stage.name,stage.goal,version.definition_id,definition.revision
      FROM journey_map_stages stage JOIN journey_map_versions version
        ON version.id=stage.version_id AND version.space_id=stage.space_id
      JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE stage.id=? AND stage.space_id=? AND definition.status<>'archived'`).get(targetId, spaceId);
    if (row) {
      const snapshot = targetSnapshot({ id: row.id, name: row.name, goal: row.goal,
        journeyDefinitionId: row.definition_id, revision: Number(row.revision) });
      return { ...target, title: row.name, revision: Number(row.revision), checksum: snapshot.checksum,
        journeyDefinitionId: row.definition_id };
    }
  } else if (targetType === 'journey_card' || targetType === 'recommendation') {
    row = db.prepare(`SELECT card.id,card.title,card.content,card.kind,version.definition_id,definition.revision
      FROM journey_map_cards card JOIN journey_map_versions version
        ON version.id=card.version_id AND version.space_id=card.space_id
      JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE card.id=? AND card.space_id=? AND definition.status<>'archived'`).get(targetId, spaceId);
    if (row && (targetType !== 'recommendation' || ['opportunity', 'solution', 'initiative'].includes(row.kind))) {
      const snapshot = targetSnapshot({ id: row.id, title: row.title, content: row.content, kind: row.kind,
        journeyDefinitionId: row.definition_id, revision: Number(row.revision) });
      return { ...target, title: row.title, revision: Number(row.revision), checksum: snapshot.checksum,
        journeyDefinitionId: row.definition_id };
    }
  }
  throw new JourneyCollaborationError('Journey collaboration target not found.', 404,
    'JOURNEY_COLLABORATION_TARGET_NOT_FOUND');
}

/** Serialises the space-wide invariants that a plain SELECT-then-INSERT cannot
 * hold under READ COMMITTED: quota counts, and the settings row whose creation
 * branches on `revision === 0`. SQLite already serialises writers. */
function lockSpace(spaceId: string) {
  const row = db.prepare(db.provider === 'postgres'
    ? 'SELECT id FROM spaces WHERE id=? FOR UPDATE' : 'SELECT id FROM spaces WHERE id=?').get(spaceId);
  if (!row) throw new JourneyCollaborationError('Space not found.', 404, 'SPACE_NOT_FOUND');
}

/** Row lock for the counted thread invariant; the reply cap is a COUNT(*) that
 * two concurrent replies would both read below the limit. */
function lockComment(spaceId: string, commentId: string) {
  db.prepare(db.provider === 'postgres'
    ? 'SELECT id FROM journey_comments WHERE id=? AND space_id=? FOR UPDATE'
    : 'SELECT id FROM journey_comments WHERE id=? AND space_id=?').get(commentId, spaceId);
}

function pageLimit(value?: number) {
  // `Number(value) || 50` turned every rejectable input -- 0, -0, NaN, '' and
  // 'abc' -- into the default instead of a 400, so a malformed page size was
  // indistinguishable from an omitted one.
  if (value === undefined || value === null) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > journeyCollaborationLimits.pageSize) {
    throw new JourneyCollaborationError(
      `Page size must be a whole number between 1 and ${journeyCollaborationLimits.pageSize}.`, 400,
      'JOURNEY_COLLABORATION_PAGE_INVALID');
  }
  return limit;
}

function pageCursor(value?: string | null) {
  try { return decodeJourneyPageCursor(value); }
  catch { throw new JourneyCollaborationError('The pagination cursor is invalid.', 400,
    'JOURNEY_COLLABORATION_CURSOR_INVALID'); }
}

function nextCursor(rows: Array<{ created_at: string; id: string }>, limit: number) {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  return encodeJourneyPageCursor({ createdAt: last.created_at, id: last.id });
}

const contentBearingKeyWords = new Set([
  'body', 'text', 'content', 'excerpt', 'description', 'comment', 'reason', 'title',
  'name', 'email', 'summary', 'message', 'note', 'label', 'query'
]);
/** The final word of a key decides, so a derived key keeps its subject word:
 * `contentSha256`, `bodyLength`, `mentionCount` and `reasonCode` all end in a
 * word that names a hash, a size, a tally or a bounded enum. The previous test was
 * `/(^|_)(body|text|...)$/`, which required the hazard word at the start of the
 * key or straight after an underscore -- but every call site here writes
 * camelCase, so `commentBody`, `plainText` and `authorName` all passed a guard
 * whose whole purpose was to stop them. It also only looked at top-level keys. */
function assertContentFreeKeys(value: unknown, path: string[] = []) {
  if (Array.isArray(value)) { value.forEach((entry) => assertContentFreeKeys(entry, path)); return; }
  if (!value || typeof value !== 'object' || value instanceof Date) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const words = key.split(/[^A-Za-z0-9]+/u).flatMap((part) => part.split(/(?=[A-Z])/u))
      .map((part) => part.toLowerCase()).filter(Boolean);
    const last = words.at(-1) || '';
    if (contentBearingKeyWords.has(last)) throw new JourneyCollaborationError(
      'Content cannot be written to Journey collaboration audit.', 500,
      'JOURNEY_COLLABORATION_AUDIT_CONTENT_REJECTED', { key: [...path, key].join('.') });
    assertContentFreeKeys(nested, [...path, key]);
  }
}

function contentFreeDetail(value: Record<string, unknown>) {
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized, 'utf8') > 32_768) throw new JourneyCollaborationError(
    'Audit detail is too large.', 413, 'JOURNEY_COLLABORATION_AUDIT_TOO_LARGE');
  // Defend against accidentally copying user-authored bodies into the audit
  // projection. Hashes, identifiers, bounded enum codes, and counts are safe.
  assertContentFreeKeys(value);
  return serialized;
}

function appendActivity(input: {
  spaceId: string; actorUserId: string | null; action: string; targetType: string; targetId: string;
  journeyDefinitionId?: string | null; commentId?: string | null; reviewId?: string | null;
  detail?: Record<string, unknown>; requestId?: string | null;
}) {
  const at = nowIso();
  const detailJson = contentFreeDetail(input.detail || {});
  const activityId = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_collaboration_activity
    (id,space_id,actor_user_id,action,target_type,target_id,journey_definition_id,comment_id,review_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(activityId, input.spaceId, input.actorUserId, input.action,
      input.targetType, input.targetId, input.journeyDefinitionId || null, input.commentId || null,
      input.reviewId || null, detailJson, at);
  db.prepare(`INSERT INTO journey_collaboration_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,request_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId, input.action,
      input.targetType, input.targetId, input.requestId?.slice(0, 200) || null, detailJson, at);
  return activityId;
}

type IdempotentMutationInput<T extends Record<string, unknown>> = {
  spaceId: string; actorUserId: string; idempotencyKey: string; action: string;
  intent: Record<string, unknown>; run: () => T;
  /** Projects the result down to identifiers before it is written to
   * `journey_collaboration_operations`, whose rows are sealed against UPDATE and
   * DELETE in both 0028 and the SQLite projection.
   *
   * Without this, the replay ledger was a second, permanent, un-erasable copy of
   * every comment body and governance summary: `comment.create`, `comment.edit`
   * and `comment.resolve` all return the rendered comment, so a body deleted
   * "because it contains customer data" and then swept by
   * `purgeExpiredJourneyComments` survived verbatim in a table no code path and
   * no operator can clear. That directly defeats the exit criterion that
   * deletions preserve valid audit while removing prohibited content.
   *
   * `restore` rebuilds the response from the live tables on replay, so a replay
   * after deletion re-applies the same redaction the normal read path does. */
  persist?: (result: T) => Record<string, unknown>;
  restore?: (stored: Record<string, unknown>) => T;
};

function normalizedIdempotencyKey(value: string) {
  const key = String(value || '');
  if (!key || key.length > 200 || key.trim() !== key || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new JourneyCollaborationError('A valid Idempotency-Key is required.', 400,
      'JOURNEY_COLLABORATION_IDEMPOTENCY_INVALID');
  }
  return key;
}

function readOperation<T extends Record<string, unknown>>(spaceId: string, actorUserId: string, key: string,
  intentSha256: string, restore?: (stored: Record<string, unknown>) => T): (T & { replayed: true }) | null {
  const row = db.prepare(`SELECT intent_sha256,response_json FROM journey_collaboration_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`).get(spaceId, actorUserId, key) as any;
  if (!row) return null;
  if (row.intent_sha256 !== intentSha256) throw new JourneyCollaborationError(
    'This idempotency key was already used for a different request.', 409,
    'JOURNEY_COLLABORATION_IDEMPOTENCY_CONFLICT');
  // Fail closed. `safeJson(..., {})` replayed an unreadable stored response as a
  // success carrying no payload, which reads to a caller as "the mutation
  // applied and produced nothing".
  let stored: Record<string, unknown>;
  try { stored = JSON.parse(String(row.response_json)) as Record<string, unknown>; }
  catch { throw new JourneyCollaborationError(
    'The stored response for this idempotency key could not be replayed.', 500,
    'JOURNEY_COLLABORATION_REPLAY_UNREADABLE'); }
  if (!stored || typeof stored !== 'object') throw new JourneyCollaborationError(
    'The stored response for this idempotency key could not be replayed.', 500,
    'JOURNEY_COLLABORATION_REPLAY_UNREADABLE');
  return { ...(restore ? restore(stored) : (stored as T)), replayed: true };
}

function idempotentMutation<T extends Record<string, unknown>>(input: IdempotentMutationInput<T>): T & { replayed: boolean } {
  const key = normalizedIdempotencyKey(input.idempotencyKey);
  const intentSha256 = sha256(canonical({ action: input.action, ...input.intent }));
  const existing = readOperation<T>(input.spaceId, input.actorUserId, key, intentSha256, input.restore);
  if (existing) return existing;
  try {
    const result = db.transaction(() => {
      const replay = readOperation<T>(input.spaceId, input.actorUserId, key, intentSha256, input.restore);
      if (replay) return replay;
      const response = input.run();
      const responseJson = canonical(input.persist ? input.persist(response) : response);
      if (Buffer.byteLength(responseJson, 'utf8') > 131_072) throw new JourneyCollaborationError(
        'The operation response is too large for safe replay.', 413, 'JOURNEY_COLLABORATION_REPLAY_TOO_LARGE');
      db.prepare(`INSERT INTO journey_collaboration_operations
        (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId, key,
          input.action, intentSha256, responseJson, nowIso());
      return { ...response, replayed: false } as T & { replayed: boolean };
    })();
    return result;
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const replay = readOperation<T>(input.spaceId, input.actorUserId, key, intentSha256);
    if (replay) return replay;
    // A unique violation with no matching operations row is a genuine concurrent
    // write against a business key -- roles_one_active, the watcher uniqueness
    // key, one_pending governance review. Rethrowing the driver error mapped it
    // to a 500; it is a conflict.
    throw new JourneyCollaborationError(
      'A concurrent change conflicted with this request. Reload and try again.', 409,
      'JOURNEY_COLLABORATION_CONCURRENT_CONFLICT');
  }
}

function assignmentRow(row: any) {
  return {
    id: String(row.id), scopeType: row.scope_type as 'space' | 'journey',
    journeyDefinitionId: row.journey_definition_id || null, userId: String(row.user_id),
    userName: String(row.user_name || ''), role: row.role as JourneyCollaborationRole,
    state: row.state as 'active' | 'revoked', revision: Number(row.revision),
    assignedByUserId: row.assigned_by_user_id || null, assignedAt: String(row.assigned_at),
    revokedByUserId: row.revoked_by_user_id || null, revokedAt: row.revoked_at || null
  };
}

function appendNotification(input: {
  spaceId: string; recipientUserId: string; kind: string; targetType: string; targetId: string;
  actorUserId: string | null; eventId: string; commentId?: string | null; reviewId?: string | null;
}) {
  if (input.actorUserId && input.actorUserId === input.recipientUserId) return null;
  if (!db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(input.spaceId, input.recipientUserId)) return null;
  const dedupe = sha256(canonical({ recipientUserId: input.recipientUserId, kind: input.kind,
    eventId: input.eventId, targetType: input.targetType, targetId: input.targetId }));
  const id = crypto.randomUUID();
  try {
    // Both inserts share a savepoint. Previously one `try` covered both and
    // swallowed any constraint error, so a notification whose state row failed
    // stayed in the table for ever, invisible behind the inner join every inbox
    // read performs.
    return db.transaction(() => {
      db.prepare(`INSERT INTO journey_collaboration_notifications
        (id,space_id,recipient_user_id,kind,target_type,target_id,actor_user_id,comment_id,review_id,event_id,dedupe_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.spaceId, input.recipientUserId, input.kind,
          input.targetType, input.targetId, input.actorUserId, input.commentId || null, input.reviewId || null,
          input.eventId, dedupe, nowIso());
      db.prepare(`INSERT INTO journey_collaboration_notification_states
        (notification_id,space_id,recipient_user_id,state,revision,read_at) VALUES (?,?,?,'unread',1,NULL)`)
        .run(id, input.spaceId, input.recipientUserId);
      return id;
    })();
  } catch (error) {
    // A dedupe collision is the designed outcome of notifying the same person
    // about the same event twice. Only uniqueness is swallowed here: a foreign
    // key or CHECK failure means the notification was malformed, and silently
    // dropping it would hide the defect.
    if (!isUniqueViolation(error)) throw error;
    return null;
  }
}

export function updateJourneyCollaborationSettings(input: {
  spaceId: string; actorUserId: string; expectedRevision: number;
  enabled: boolean; commentsEnabled: boolean; sharingEnabled: boolean; externalDownloadsEnabled: boolean;
  commentRetentionDays: number; viewRetentionDays: number; maximumShareDays: number;
  securityReviewReference?: string | null; idempotencyKey: string; requestId?: string | null;
}) {
  // Membership precedes the plan gate so a non-member probing a space id cannot
  // read its subscription state. `allowReadOnly` is required here and nowhere
  // else: the space kill switch lives in these settings, so enforcing read-only
  // against this write would make disabling collaboration irreversible.
  membership(input.spaceId, input.actorUserId);
  assertSubscriptionFeature(input.spaceId, 'journeyCollaboration');
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.manage_shares', undefined,
    { allowReadOnly: true });
  // Truncating first made every integer test below vacuously true, so 1.5 days
  // was silently accepted as 1. Retention is a policy value; it is rejected, not
  // rounded.
  const commentRetentionDays = Number(input.commentRetentionDays);
  const viewRetentionDays = Number(input.viewRetentionDays);
  const maximumShareDays = Number(input.maximumShareDays);
  const bounded = (value: number, range: { minimum: number; maximum: number }) =>
    Number.isInteger(value) && value >= range.minimum && value <= range.maximum;
  if (!bounded(commentRetentionDays, journeyCollaborationLimits.commentRetentionDays)
      || !bounded(viewRetentionDays, journeyCollaborationLimits.viewRetentionDays)
      || !bounded(maximumShareDays, journeyCollaborationLimits.maximumShareDays)) throw new JourneyCollaborationError(
    'Choose valid collaboration retention and share-expiry limits.', 400,
    'JOURNEY_COLLABORATION_SETTINGS_INVALID');
  const reference = input.sharingEnabled ? String(input.securityReviewReference || '').trim() : null;
  if (input.sharingEnabled && (!reference || reference.length < 8 || reference.length > 200)) {
    throw new JourneyCollaborationError(
      'Enabling external sharing requires a dedicated security/privacy review reference.', 422,
      'JOURNEY_SHARING_SECURITY_REVIEW_REQUIRED');
  }
  if (input.externalDownloadsEnabled && !input.sharingEnabled) throw new JourneyCollaborationError(
    'External downloads cannot be enabled while sharing is disabled.', 400,
    'JOURNEY_SHARING_DOWNLOAD_POLICY_INVALID');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'settings.update', intent: {
      expectedRevision: input.expectedRevision, enabled: input.enabled, commentsEnabled: input.commentsEnabled,
      sharingEnabled: input.sharingEnabled, externalDownloadsEnabled: input.externalDownloadsEnabled,
      commentRetentionDays, viewRetentionDays, maximumShareDays,
      securityReviewReferenceSha256: reference ? sha256(reference) : null
    }, run: () => {
      lockSpace(input.spaceId);
      const current = settingsRow(input.spaceId);
      if (current.revision !== input.expectedRevision) throw new JourneyCollaborationError(
        'Collaboration settings changed since they were opened.', 409,
        'JOURNEY_COLLABORATION_SETTINGS_CONFLICT', { currentRevision: current.revision });
      const at = nowIso();
      // The security/privacy review is a record, not a side effect of the last
      // save. Re-stamping reviewer and timestamp on every settings write meant
      // toggling an unrelated flag silently reattributed the review to whoever
      // touched the form last. A new reviewer is recorded only when sharing turns
      // on or the reference itself changes.
      const priorReviewer = String((db.prepare(`SELECT security_reviewed_by_user_id
        FROM journey_collaboration_settings WHERE space_id=?`).get(input.spaceId) as any)
        ?.security_reviewed_by_user_id || '');
      const reviewCarriesOver = Boolean(input.sharingEnabled && priorReviewer && current.securityReviewedAt
        && current.securityReviewReference === reference);
      const reviewedBy = input.sharingEnabled ? (reviewCarriesOver ? priorReviewer : input.actorUserId) : null;
      const reviewedAt = input.sharingEnabled ? (reviewCarriesOver ? current.securityReviewedAt : at) : null;
      if (current.revision === 0) {
        db.prepare(`INSERT INTO journey_collaboration_settings
          (space_id,enabled,comments_enabled,sharing_enabled,external_downloads_enabled,
            comment_retention_days,view_retention_days,maximum_share_days,security_review_reference,
            security_reviewed_by_user_id,security_reviewed_at,revision,updated_by_user_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.spaceId, input.enabled ? 1 : 0,
            input.commentsEnabled ? 1 : 0, input.sharingEnabled ? 1 : 0,
            input.externalDownloadsEnabled ? 1 : 0, commentRetentionDays, viewRetentionDays, maximumShareDays,
            reference, reviewedBy, reviewedAt, 1, input.actorUserId, at, at);
      } else {
        const changed = db.prepare(`UPDATE journey_collaboration_settings SET enabled=?,comments_enabled=?,
          sharing_enabled=?,external_downloads_enabled=?,comment_retention_days=?,view_retention_days=?,
          maximum_share_days=?,security_review_reference=?,security_reviewed_by_user_id=?,security_reviewed_at=?,
          revision=revision+1,updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`).run(
            input.enabled ? 1 : 0, input.commentsEnabled ? 1 : 0, input.sharingEnabled ? 1 : 0,
            input.externalDownloadsEnabled ? 1 : 0, commentRetentionDays, viewRetentionDays, maximumShareDays,
            reference, reviewedBy, reviewedAt, input.actorUserId, at, input.spaceId, input.expectedRevision).changes;
        if (changed !== 1) throw new JourneyCollaborationError(
          'Collaboration settings changed since they were opened.', 409,
          'JOURNEY_COLLABORATION_SETTINGS_CONFLICT');
      }
      appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'settings.updated', targetType: 'space', targetId: input.spaceId, requestId: input.requestId,
        detail: { enabled: input.enabled, commentsEnabled: input.commentsEnabled,
          sharingEnabled: input.sharingEnabled, externalDownloadsEnabled: input.externalDownloadsEnabled,
          commentRetentionDays, viewRetentionDays, maximumShareDays,
          securityReviewReferenceSha256: reference ? sha256(reference) : null } });
      return { settings: settingsRow(input.spaceId) };
    }
  });
}

export function getJourneyCollaborationContext(input: {
  spaceId: string; actorUserId: string; target?: JourneyTargetReference;
}) {
  const target = input.target ? resolveJourneyCollaborationTarget(input.spaceId, input.target) : null;
  const effective = effectiveJourneyRole(input.spaceId, input.actorUserId, target?.journeyDefinitionId);
  // `readOnly` was computed and then discarded, so a client whose plan lost the
  // feature or whose space killed collaboration was still told it held
  // journeys.comment and journeys.edit while every write 403'd from
  // assertCollaborationWritable. Advertise what is actually reachable.
  const capabilities = [...effective.capabilities]
    .filter((capability) => !effective.readOnly || readOnlyCapabilities.has(capability));
  return {
    role: effective.role, roleSource: effective.source, readOnly: effective.readOnly, capabilities,
    target, plan: journeyCollaborationPlanState(input.spaceId), limits: journeyCollaborationLimits
  };
}

export function listJourneyRoleAssignments(input: {
  spaceId: string; actorUserId: string; journeyDefinitionId?: string | null; state?: 'active' | 'revoked';
  limit?: number; cursor?: string | null;
}) {
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.manage_roles', {
    journeyDefinitionId: input.journeyDefinitionId || null
  });
  // An unvalidated filter returned an empty page instead of a 400, so a typo was
  // indistinguishable from "no assignments" -- the same defect
  // `listJourneyGovernanceReviews` already rejects.
  if (input.state && !['active', 'revoked'].includes(input.state)) throw new JourneyCollaborationError(
    'Unknown role assignment state.', 400, 'JOURNEY_ROLE_STATE_INVALID');
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const clauses = ['assignment.space_id=?']; const parameters: unknown[] = [input.spaceId];
  if (input.journeyDefinitionId) {
    clauses.push("assignment.scope_type='journey'", 'assignment.journey_definition_id=?');
    parameters.push(input.journeyDefinitionId);
  }
  if (input.state) { clauses.push('assignment.state=?'); parameters.push(input.state); }
  if (cursor) { clauses.push('(assignment.assigned_at<? OR (assignment.assigned_at=? AND assignment.id<?))');
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
  const rows = db.prepare(`SELECT assignment.*,subject.name user_name,assignment.assigned_at created_at
    FROM journey_collaboration_role_assignments assignment JOIN users subject ON subject.id=assignment.user_id
    WHERE ${clauses.join(' AND ')} ORDER BY assignment.assigned_at DESC,assignment.id DESC LIMIT ?`)
    .all(...parameters, limit + 1) as any[];
  return { items: rows.slice(0, limit).map(assignmentRow), nextCursor: nextCursor(rows, limit) };
}

export function assignJourneyRole(input: {
  spaceId: string; actorUserId: string; userId: string; role: JourneyCollaborationRole;
  scopeType: 'space' | 'journey'; journeyDefinitionId?: string | null;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  if (!journeyCollaborationRoles.includes(input.role)) throw new JourneyCollaborationError(
    'Choose a valid Journey role.', 400, 'JOURNEY_ROLE_INVALID');
  if ((input.scopeType === 'space' && input.journeyDefinitionId)
      || (input.scopeType === 'journey' && !input.journeyDefinitionId)) throw new JourneyCollaborationError(
    'The Journey role scope is invalid.', 400, 'JOURNEY_ROLE_SCOPE_INVALID');
  if (input.journeyDefinitionId) resolveJourneyCollaborationTarget(input.spaceId, {
    targetType: 'journey_map', targetId: input.journeyDefinitionId
  });
  const actor = assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.manage_roles', {
    journeyDefinitionId: input.journeyDefinitionId || null
  });
  const actorRole = actor.role;
  const targetMember = membership(input.spaceId, input.userId);
  if (targetMember.role === 'owner') throw new JourneyCollaborationError(
    'The space owner always has administrator capability and cannot be reassigned.', 409,
    'JOURNEY_OWNER_ROLE_PROTECTED');
  if (actorRole !== 'administrator' && (input.role === 'administrator' || roleRank(input.role) >= roleRank(actorRole))) {
    throw new JourneyCollaborationError('Only a Journey administrator can grant an equal or higher role.', 403,
      'JOURNEY_ROLE_GRANT_FORBIDDEN');
  }
  // Rank alone does not contain a grant: the lattice is not monotonic, so a role
  // of lower rank can still carry a capability the actor does not hold.
  if (actorRole !== 'administrator' && !journeyRoleCapabilitiesContained(input.role, actor.capabilities)) {
    throw new JourneyCollaborationError('You cannot grant a capability you do not hold.', 403,
      'JOURNEY_ROLE_GRANT_FORBIDDEN');
  }
  // The rank guard above only inspected the role being granted. Assigning any
  // role also revokes whatever active assignment the subject already holds, at
  // any rank, so `assign(viewer)` was an unguarded `revoke` -- a manager could
  // strip a space-scoped administrator that revokeJourneyRole would have refused
  // to touch, and the subject could not restore it.
  const existingAssignment = db.prepare(`SELECT role FROM journey_collaboration_role_assignments
    WHERE space_id=? AND user_id=? AND scope_type=? AND COALESCE(journey_definition_id,'')=COALESCE(?,'')
      AND state='active'`).get(input.spaceId, input.userId, input.scopeType,
        input.journeyDefinitionId || null) as any;
  if (existingAssignment && existingAssignment.role !== input.role && actorRole !== 'administrator'
    && roleRank(existingAssignment.role) >= roleRank(actorRole)) {
    throw new JourneyCollaborationError(
      'Only a Journey administrator can replace an equal or higher role.', 403,
      'JOURNEY_ROLE_REPLACE_FORBIDDEN');
  }
  if (input.userId === input.actorUserId && (!existingAssignment || existingAssignment.role !== input.role)) {
    throw new JourneyCollaborationError('Ask another Journey administrator to change your own assignment.', 409,
      'JOURNEY_ROLE_SELF_ASSIGNMENT_FORBIDDEN');
  }
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'role.assign', intent: { userId: input.userId, role: input.role, scopeType: input.scopeType,
      journeyDefinitionId: input.journeyDefinitionId || null }, run: () => {
      lockSpace(input.spaceId);
      const existing = db.prepare(`SELECT * FROM journey_collaboration_role_assignments WHERE space_id=? AND user_id=?
        AND scope_type=? AND COALESCE(journey_definition_id,'')=COALESCE(?,'') AND state='active'`)
        .get(input.spaceId, input.userId, input.scopeType, input.journeyDefinitionId || null) as any;
      if (existing?.role === input.role) return { assignment: assignmentRow({ ...existing, user_name: targetMember.name }) };
      // Collaborators are a plan resource. The count is over distinct people
      // holding any active assignment, so re-scoping or re-roling someone who is
      // already a collaborator consumes nothing further.
      const alreadyCollaborator = db.prepare(`SELECT 1 FROM journey_collaboration_role_assignments
        WHERE space_id=? AND user_id=? AND state='active' LIMIT 1`).get(input.spaceId, input.userId);
      if (!alreadyCollaborator) {
        assertSubscriptionQuota(input.spaceId, 'seats', Number((db.prepare(
          `SELECT COUNT(DISTINCT user_id) count FROM journey_collaboration_role_assignments
           WHERE space_id=? AND state='active'`).get(input.spaceId) as any)?.count || 0));
      }
      const at = nowIso();
      if (existing) {
        db.prepare(`UPDATE journey_collaboration_role_assignments SET state='revoked',revision=revision+1,
          revoked_by_user_id=?,revoked_at=?,revocation_reason_sha256=? WHERE id=? AND space_id=? AND state='active'`)
          .run(input.actorUserId, at, sha256('replaced'), existing.id, input.spaceId);
        db.prepare(`INSERT INTO journey_collaboration_role_events
          (id,assignment_id,space_id,actor_user_id,action,role,scope_type,journey_definition_id,reason_sha256,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), existing.id, input.spaceId, input.actorUserId,
            'revoked', existing.role, existing.scope_type, existing.journey_definition_id, sha256('replaced'), at);
      }
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_collaboration_role_assignments
        (id,space_id,scope_type,journey_definition_id,user_id,role,state,revision,assigned_by_user_id,assigned_at,
          revoked_by_user_id,revoked_at,revocation_reason_sha256) VALUES (?,?,?,?,?,?,'active',1,?,?,NULL,NULL,NULL)`)
        .run(id, input.spaceId, input.scopeType, input.journeyDefinitionId || null, input.userId, input.role,
          input.actorUserId, at);
      db.prepare(`INSERT INTO journey_collaboration_role_events
        (id,assignment_id,space_id,actor_user_id,action,role,scope_type,journey_definition_id,reason_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,NULL,?)`).run(crypto.randomUUID(), id, input.spaceId, input.actorUserId,
          'assigned', input.role, input.scopeType, input.journeyDefinitionId || null, at);
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'role.assigned', targetType: 'role_assignment', targetId: id,
        journeyDefinitionId: input.journeyDefinitionId || null, requestId: input.requestId,
        detail: { subjectUserId: input.userId, role: input.role, scopeType: input.scopeType,
          journeyDefinitionId: input.journeyDefinitionId || null } });
      appendNotification({ spaceId: input.spaceId, recipientUserId: input.userId, kind: 'role_changed',
        targetType: 'role_assignment', targetId: id, actorUserId: input.actorUserId, eventId });
      return { assignment: assignmentRow({
        id, scope_type: input.scopeType, journey_definition_id: input.journeyDefinitionId || null,
        user_id: input.userId, user_name: targetMember.name, role: input.role, state: 'active', revision: 1,
        assigned_by_user_id: input.actorUserId, assigned_at: at, revoked_by_user_id: null, revoked_at: null
      }) };
    }
  });
}

function requireRoleAssignment(spaceId: string, assignmentId: string) {
  const row = db.prepare(`SELECT assignment.*,subject.name user_name FROM journey_collaboration_role_assignments assignment
    JOIN users subject ON subject.id=assignment.user_id WHERE assignment.id=? AND assignment.space_id=?`)
    .get(assignmentId, spaceId) as any;
  if (!row) throw new JourneyCollaborationError('Journey role assignment not found.', 404,
    'JOURNEY_ROLE_ASSIGNMENT_NOT_FOUND');
  return row;
}

function assertRoleRevocable(spaceId: string, actorUserId: string, row: any) {
  const actorRole = assertJourneyCapability(spaceId, actorUserId, 'journeys.manage_roles', {
    journeyDefinitionId: row.journey_definition_id || null
  }).role;
  if (actorRole !== 'administrator' && roleRank(row.role) >= roleRank(actorRole)) throw new JourneyCollaborationError(
    'Only a Journey administrator can revoke an equal or higher role.', 403,
    'JOURNEY_ROLE_REVOKE_FORBIDDEN');
  if (row.user_id === actorUserId) throw new JourneyCollaborationError(
    'Ask another Journey administrator to revoke your own assignment.', 409,
    'JOURNEY_ROLE_SELF_REVOCATION_FORBIDDEN');
}

export function revokeJourneyRole(input: {
  spaceId: string; actorUserId: string; assignmentId: string; expectedRevision: number;
  reason: string; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new JourneyCollaborationError(
    'Revoking a role requires a short reason.', 400, 'JOURNEY_ROLE_REVOCATION_REASON_REQUIRED');
  // Resolved and authorised ahead of `idempotentMutation`, which returns a stored
  // response without ever entering `run()`. Leaving the capability check inside
  // meant a replay skipped it entirely.
  const assignment = requireRoleAssignment(input.spaceId, input.assignmentId);
  assertRoleRevocable(input.spaceId, input.actorUserId, assignment);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'role.revoke', intent: { assignmentId: input.assignmentId, expectedRevision: input.expectedRevision,
      reasonSha256: sha256(reason) }, run: () => {
      const row = requireRoleAssignment(input.spaceId, input.assignmentId);
      assertRoleRevocable(input.spaceId, input.actorUserId, row);
      const at = nowIso();
      const changed = db.prepare(`UPDATE journey_collaboration_role_assignments SET state='revoked',revision=revision+1,
        revoked_by_user_id=?,revoked_at=?,revocation_reason_sha256=?
        WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(input.actorUserId, at, sha256(reason),
          input.assignmentId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This role assignment changed since it was opened.', 409, 'JOURNEY_ROLE_REVISION_CONFLICT');
      db.prepare(`INSERT INTO journey_collaboration_role_events
        (id,assignment_id,space_id,actor_user_id,action,role,scope_type,journey_definition_id,reason_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.assignmentId, input.spaceId,
          input.actorUserId, 'revoked', row.role, row.scope_type, row.journey_definition_id, sha256(reason), at);
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'role.revoked', targetType: 'role_assignment', targetId: input.assignmentId,
        journeyDefinitionId: row.journey_definition_id || null, requestId: input.requestId,
        detail: { subjectUserId: row.user_id, role: row.role, scopeType: row.scope_type,
          reasonSha256: sha256(reason) } });
      appendNotification({ spaceId: input.spaceId, recipientUserId: row.user_id, kind: 'role_changed',
        targetType: 'role_assignment', targetId: input.assignmentId, actorUserId: input.actorUserId, eventId });
      return { assignmentId: input.assignmentId, state: 'revoked' as const, revision: input.expectedRevision + 1 };
    }
  });
}

function normalizeMentions(spaceId: string, actorUserId: string, target: JourneyResolvedTarget, values: unknown) {
  const parsed = z.array(z.string().trim().min(1).max(128)).max(journeyCollaborationLimits.mentionsPerComment)
    .safeParse(values || []);
  // A raw ZodError escaped to the caller as a 500 for the one input a client
  // controls most directly.
  if (!parsed.success) throw new JourneyCollaborationError(
    `Mention up to ${journeyCollaborationLimits.mentionsPerComment} people using their user ids.`, 422,
    'JOURNEY_COMMENT_MENTION_INVALID');
  const ids = [...new Set(parsed.data)];
  if (ids.length !== parsed.data.length) throw new JourneyCollaborationError(
    'A person can only be mentioned once.', 400, 'JOURNEY_COMMENT_MENTION_DUPLICATE');
  for (const userId of ids) {
    // The mentioned person's membership and capability are checked, not the
    // author's. Letting those throw surfaced a 403 that read as though the
    // author was unauthorised, and its details carried a third party's Journey
    // role -- which also made an arbitrary user id a membership oracle.
    let readable = false;
    try {
      membership(spaceId, userId);
      assertJourneyCapability(spaceId, userId, 'journeys.read', target);
      readable = true;
    } catch (error) {
      if (!(error instanceof JourneyCollaborationError)) throw error;
    }
    if (!readable) throw new JourneyCollaborationError(
      'Everyone you mention must already be able to read this Journey.', 422,
      'JOURNEY_COMMENT_MENTION_NOT_PERMITTED');
  }
  return ids.filter((userId) => userId !== actorUserId);
}

function insertMentions(commentId: string, spaceId: string, revision: number, userIds: string[], at: string) {
  const insert = db.prepare(`INSERT INTO journey_comment_mentions
    (comment_id,space_id,user_id,comment_revision,created_at) VALUES (?,?,?,?,?)`);
  for (const userId of userIds) insert.run(commentId, spaceId, userId, revision, at);
}

/** `intent: 'explicit'` is a user asking to watch or mute; `intent: 'auto'` is
 * the implicit subscribe that follows commenting. Auto must never overwrite an
 * existing row: it used to re-subscribe anyone who had deliberately muted a
 * target the moment they replied to it, so a mute could not survive taking part
 * in the thread it silenced. */
function upsertWatcher(spaceId: string, target: JourneyTargetReference, userId: string,
  state: 'watching' | 'muted', intent: 'explicit' | 'auto' = 'explicit') {
  const at = nowIso();
  const current = () => db.prepare(`SELECT id,revision,state FROM journey_collaboration_watchers
    WHERE space_id=? AND target_type=? AND target_id=? AND user_id=?`)
    .get(spaceId, target.targetType, target.targetId, userId) as any;
  const update = () => {
    const row = current();
    if (!row) return null;
    if (intent === 'auto') return { id: String(row.id), revision: Number(row.revision), state: row.state as typeof state };
    db.prepare(`UPDATE journey_collaboration_watchers SET state=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=?`).run(state, at, row.id, spaceId);
    return { id: String(row.id), revision: Number(row.revision) + 1, state };
  };
  const existing = update();
  if (existing) return existing;
  const id = crypto.randomUUID();
  try {
    // The insert takes its own savepoint. A bare INSERT inside a try/catch is
    // safe on SQLite and wrong on PostgreSQL, where the failed statement aborts
    // the enclosing transaction: the retry below then failed with 25P02, which is
    // not a unique violation, so it was rethrown raw as a 500 and the whole
    // comment was lost. `appendNotification` already uses this pattern.
    db.transaction(() => {
      db.prepare(`INSERT INTO journey_collaboration_watchers
        (id,space_id,target_type,target_id,user_id,state,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?)`).run(id, spaceId, target.targetType, target.targetId, userId, state, at, at);
    })();
    return { id, revision: 1, state };
  } catch (error) {
    // Select-then-insert races the (space_id,target_type,target_id,user_id)
    // uniqueness key: two comments on one target from the same author raced here.
    if (!isUniqueViolation(error)) throw error;
    const retried = update();
    if (!retried) throw error;
    return retried;
  }
}

/** Characters are not bytes. `normalizeJourneyRichText` bounds text at 8 000
 * characters but permits 40 blocks x 20 marks, each link mark carrying a 2 048
 * character href, so a document well inside the character limit can serialise
 * past the 64 KiB `body_json` column check and land as a raw 23514 -- a 500 for
 * what is a client input error. */
function commentBodyPayload(value: unknown) {
  let normalized: ReturnType<typeof normalizeJourneyCommentBody>;
  try { normalized = normalizeJourneyCommentBody(value); }
  catch (error) {
    const tooLarge = Number((error as { status?: number })?.status) === 413;
    throw new JourneyCollaborationError(
      error instanceof Error ? error.message : 'The comment body is invalid.', tooLarge ? 413 : 400,
      tooLarge ? 'JOURNEY_COMMENT_BODY_TOO_LARGE' : 'JOURNEY_COMMENT_BODY_INVALID');
  }
  const bodyJson = canonical(normalized.document);
  const bytes = Buffer.byteLength(bodyJson, 'utf8');
  if (bytes > journeyCollaborationLimits.commentBodyBytes) throw new JourneyCollaborationError(
    'The comment body is too large to store.', 413, 'JOURNEY_COMMENT_BODY_TOO_LARGE',
    { maximumBytes: journeyCollaborationLimits.commentBodyBytes, bytes });
  return { ...normalized, bodyJson, contentSha256: sha256(bodyJson) };
}

function commentRow(row: any) {
  const deleted = row.state === 'deleted';
  let body: unknown = null; let plainText: string | null = null;
  if (!deleted) {
    if (!row.version_id || row.version_comment_id !== row.id || Number(row.version_number) > Number(row.revision)) {
      throw new JourneyCollaborationError('The comment version pointer failed its integrity check.', 409,
        'JOURNEY_COMMENT_INTEGRITY_FAILED');
    }
    const serialized = String(row.body_json || '');
    if (sha256(serialized) !== row.content_sha256) throw new JourneyCollaborationError(
      'The comment body failed its integrity check.', 409, 'JOURNEY_COMMENT_INTEGRITY_FAILED');
    body = safeJson(serialized, null); plainText = String(row.plain_text || '');
  }
  return {
    id: row.id, targetType: row.target_type, targetId: row.target_id,
    journeyDefinitionId: row.journey_definition_id || null, parentCommentId: row.parent_comment_id || null,
    rootCommentId: row.root_comment_id, author: { id: row.author_user_id, name: row.author_name || 'Former member' },
    state: row.state, revision: Number(row.revision), body, plainText,
    mentions: (row.mentions || []) as Array<{ id: string; name: string }>,
    createdAt: row.created_at, editedAt: row.edited_at || null, resolvedAt: row.resolved_at || null,
    resolvedByUserId: row.resolved_by_user_id || null, deletedAt: row.deleted_at || null
  };
}

function commentSelect() {
  return `SELECT comment.*,author.name author_name,version.id version_id,version.comment_id version_comment_id,
      version.version_number,version.body_json,version.plain_text,version.content_sha256
    FROM journey_comments comment
    LEFT JOIN users author ON author.id=comment.author_user_id
    LEFT JOIN journey_comment_versions version ON version.id=comment.current_version_id
      AND version.comment_id=comment.id AND version.space_id=comment.space_id`;
}

function attachCurrentMentions(spaceId: string, rows: any[]) {
  if (!rows.length) return rows;
  const byComment = new Map<string, Array<{ id: string; name: string }>>();
  const ids = rows.map((row) => String(row.id));
  const mentions = db.prepare(`SELECT mention.comment_id,mention.comment_revision,mention.user_id,mentioned_user.name
    FROM journey_comment_mentions mention
    JOIN space_memberships membership ON membership.space_id=mention.space_id AND membership.user_id=mention.user_id
    JOIN users mentioned_user ON mentioned_user.id=membership.user_id
    WHERE mention.space_id=? AND mention.comment_id IN (${ids.map(() => '?').join(',')})
    ORDER BY mentioned_user.name,mention.user_id`).all(spaceId, ...ids) as any[];
  const revisionByComment = new Map(rows.map((row) => [String(row.id), Number(row.version_number)]));
  for (const mention of mentions) {
    if (Number(mention.comment_revision) !== revisionByComment.get(String(mention.comment_id))) continue;
    const list = byComment.get(String(mention.comment_id)) || [];
    list.push({ id: String(mention.user_id), name: String(mention.name) });
    byComment.set(String(mention.comment_id), list);
  }
  return rows.map((row) => ({ ...row, mentions: byComment.get(String(row.id)) || [] }));
}

/** Re-materialises a comment from the live tables. This is what an idempotent
 * replay returns instead of a stored copy of the body, so a replay after
 * deletion redacts exactly as the normal read path does, and a replay after the
 * retention sweep reports the comment as gone rather than resurrecting it from
 * the sealed operations ledger. */
function readCommentById(spaceId: string, commentId: string) {
  const row = db.prepare(`${commentSelect()} WHERE comment.id=? AND comment.space_id=?`)
    .get(commentId, spaceId) as any;
  if (!row) throw new JourneyCollaborationError(
    'The comment this operation created is no longer available.', 404, 'JOURNEY_COMMENT_NOT_FOUND');
  return commentRow(attachCurrentMentions(spaceId, [row])[0]);
}

function notifyCommentAudience(input: {
  spaceId: string; actorUserId: string; target: JourneyResolvedTarget; commentId: string;
  eventId: string; mentionUserIds: string[]; defaultKind: 'comment' | 'reply' | 'resolved' | 'reopened';
}) {
  const recipients = new Map<string, string>();
  for (const row of db.prepare(`SELECT user_id FROM journey_collaboration_watchers
    WHERE space_id=? AND target_type=? AND target_id=? AND state='watching'`)
    .all(input.spaceId, input.target.targetType, input.target.targetId) as Array<{ user_id: string }>) {
    recipients.set(row.user_id, input.defaultKind);
  }
  for (const userId of input.mentionUserIds) recipients.set(userId, 'mention');
  for (const [userId, kind] of recipients) appendNotification({ spaceId: input.spaceId,
    recipientUserId: userId, kind, targetType: input.target.targetType, targetId: input.target.targetId,
    actorUserId: input.actorUserId, eventId: input.eventId, commentId: input.commentId });
}

export function createJourneyComment(input: {
  spaceId: string; actorUserId: string; target: JourneyTargetReference; parentCommentId?: string | null;
  body: unknown; mentionUserIds?: string[]; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId, 'comments');
  const target = resolveJourneyCollaborationTarget(input.spaceId, input.target);
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.comment', target);
  const normalized = commentBodyPayload(input.body);
  const mentionUserIds = normalizeMentions(input.spaceId, input.actorUserId, target, input.mentionUserIds || []);
  const { bodyJson, contentSha256 } = normalized;
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'comment.create', intent: { targetType: target.targetType, targetId: target.targetId,
      parentCommentId: input.parentCommentId || null, contentSha256, mentionUserIds },
    persist: (result) => ({ commentId: result.comment.id }),
    restore: (stored) => ({ comment: readCommentById(input.spaceId, String(stored.commentId)) }),
    run: () => {
      let parent: any = null;
      if (input.parentCommentId) {
        parent = db.prepare(`SELECT * FROM journey_comments WHERE id=? AND space_id=?`)
          .get(input.parentCommentId, input.spaceId) as any;
        if (!parent || parent.parent_comment_id || parent.state === 'deleted'
          || parent.target_type !== target.targetType || parent.target_id !== target.targetId) {
          throw new JourneyCollaborationError('Replies require an active root comment on this target.', 409,
            'JOURNEY_COMMENT_PARENT_INVALID');
        }
        lockComment(input.spaceId, parent.id);
        const count = Number((db.prepare(`SELECT COUNT(*) count FROM journey_comments
          WHERE space_id=? AND root_comment_id=? AND parent_comment_id IS NOT NULL`)
          .get(input.spaceId, parent.id) as any)?.count || 0);
        if (count >= journeyCollaborationLimits.threadReplies) throw new JourneyCollaborationError(
          'This comment thread has reached its reply limit.', 409, 'JOURNEY_COMMENT_THREAD_LIMIT');
      }
      const id = crypto.randomUUID(); const versionId = crypto.randomUUID(); const at = nowIso();
      db.prepare(`INSERT INTO journey_comments
        (id,space_id,target_type,target_id,journey_definition_id,parent_comment_id,root_comment_id,author_user_id,
          state,revision,current_version_id,created_at,edited_at,resolved_at,resolved_by_user_id,deleted_at,retention_expires_at)
        VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,NULL,NULL,NULL,NULL,NULL)`).run(id, input.spaceId,
          target.targetType, target.targetId, target.journeyDefinitionId, parent?.id || null, parent?.root_comment_id || id,
          input.actorUserId, versionId, at);
      db.prepare(`INSERT INTO journey_comment_versions
        (id,comment_id,space_id,version_number,schema_version,body_json,plain_text,content_sha256,editor_user_id,
          edit_reason_sha256,created_at) VALUES (?,?,?,1,1,?,?,?,?,NULL,?)`).run(versionId, id, input.spaceId,
          bodyJson, normalized.plainText, contentSha256, input.actorUserId, at);
      insertMentions(id, input.spaceId, 1, mentionUserIds, at);
      upsertWatcher(input.spaceId, target, input.actorUserId, 'watching', 'auto');
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: parent ? 'comment.replied' : 'comment.created', targetType: target.targetType,
        targetId: target.targetId, journeyDefinitionId: target.journeyDefinitionId, commentId: id,
        requestId: input.requestId, detail: { contentSha256, bodyLength: normalized.plainText.length,
          mentionCount: mentionUserIds.length, parentCommentId: parent?.id || null } });
      notifyCommentAudience({ spaceId: input.spaceId, actorUserId: input.actorUserId, target, commentId: id,
        eventId, mentionUserIds, defaultKind: parent ? 'reply' : 'comment' });
      const row = db.prepare(`${commentSelect()} WHERE comment.id=? AND comment.space_id=?`).get(id, input.spaceId) as any;
      return { comment: commentRow(attachCurrentMentions(input.spaceId, [row])[0]) };
    }
  });
}

export function listJourneyComments(input: {
  spaceId: string; actorUserId: string; target: JourneyTargetReference; state?: 'active' | 'resolved' | 'deleted';
  limit?: number; cursor?: string | null;
}) {
  const target = resolveJourneyCollaborationTarget(input.spaceId, input.target);
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.read', target);
  if (input.state && !['active', 'resolved', 'deleted'].includes(input.state)) throw new JourneyCollaborationError(
    'Unknown comment state.', 400, 'JOURNEY_COMMENT_STATE_INVALID');
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const clauses = ['comment.space_id=?', 'comment.target_type=?', 'comment.target_id=?'];
  const parameters: unknown[] = [input.spaceId, target.targetType, target.targetId];
  if (input.state) { clauses.push('comment.state=?'); parameters.push(input.state); }
  if (cursor) { clauses.push('(comment.created_at>? OR (comment.created_at=? AND comment.id>?))');
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
  const rows = db.prepare(`${commentSelect()} WHERE ${clauses.join(' AND ')}
    ORDER BY comment.created_at,comment.id LIMIT ?`).all(...parameters, limit + 1) as any[];
  const pageRows = attachCurrentMentions(input.spaceId, rows.slice(0, limit));
  const cursorValue = rows.length > limit && pageRows.length
    ? encodeJourneyPageCursor({ createdAt: pageRows.at(-1)!.created_at, id: pageRows.at(-1)!.id }) : null;
  return { items: pageRows.map(commentRow), nextCursor: cursorValue,
    plan: journeyCollaborationPlanState(input.spaceId) };
}

function requireComment(spaceId: string, commentId: string) {
  const row = db.prepare('SELECT * FROM journey_comments WHERE id=? AND space_id=?').get(commentId, spaceId) as any;
  if (!row) throw new JourneyCollaborationError('Comment not found.', 404, 'JOURNEY_COMMENT_NOT_FOUND');
  return row;
}

function assertCommentOwnerOrManager(spaceId: string, actorUserId: string, row: any,
  target: JourneyResolvedTarget) {
  // The author shortcut still has to clear the capability gate. Returning early
  // on identity alone meant an author who had lost `journeys.comment` -- or whose
  // space had gone read-only -- could still act on their own comment, because
  // this was the only authorisation between the caller and the write.
  const role = assertJourneyCapability(spaceId, actorUserId, 'journeys.comment', target).role;
  if (row.author_user_id === actorUserId) return;
  if (!['manager', 'administrator'].includes(role)) throw new JourneyCollaborationError(
    'Only the comment author or a Journey manager can perform this action.', 403,
    'JOURNEY_COMMENT_OWNER_REQUIRED');
}

/** Resolves a comment and its target and authorises the actor against both.
 * Called once before `idempotentMutation` so a replay cannot skip the check, and
 * again inside `run()` so the state it authorised against is the state it
 * mutates. */
function authorizeCommentAction(spaceId: string, actorUserId: string, commentId: string) {
  const row = requireComment(spaceId, commentId);
  const target = resolveJourneyCollaborationTarget(spaceId, {
    targetType: row.target_type, targetId: row.target_id
  });
  assertCommentOwnerOrManager(spaceId, actorUserId, row, target);
  return { row, target };
}

export function editJourneyComment(input: {
  spaceId: string; actorUserId: string; commentId: string; expectedRevision: number;
  body: unknown; mentionUserIds?: string[]; editReason: string; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId, 'comments');
  const editReason = String(input.editReason || '').trim();
  if (editReason.length < 3 || editReason.length > 500) throw new JourneyCollaborationError(
    'Editing a comment requires a short reason.', 400, 'JOURNEY_COMMENT_EDIT_REASON_REQUIRED');
  const initial = requireComment(input.spaceId, input.commentId);
  const target = resolveJourneyCollaborationTarget(input.spaceId, {
    targetType: initial.target_type, targetId: initial.target_id
  });
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.comment', target);
  if (initial.author_user_id !== input.actorUserId) throw new JourneyCollaborationError(
    'Only the comment author can edit its content.', 403, 'JOURNEY_COMMENT_AUTHOR_REQUIRED');
  const normalized = commentBodyPayload(input.body);
  const mentionUserIds = normalizeMentions(input.spaceId, input.actorUserId, target, input.mentionUserIds || []);
  const { bodyJson, contentSha256 } = normalized;
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'comment.edit', intent: { commentId: input.commentId, expectedRevision: input.expectedRevision,
      contentSha256, mentionUserIds, editReasonSha256: sha256(editReason) },
    persist: (result) => ({ commentId: result.comment.id }),
    restore: (stored) => ({ comment: readCommentById(input.spaceId, String(stored.commentId)) }),
    run: () => {
      const current = requireComment(input.spaceId, input.commentId);
      if (current.state !== 'active') throw new JourneyCollaborationError(
        'Only an active comment can be edited.', 409, 'JOURNEY_COMMENT_STATE_CONFLICT');
      if (Number(current.revision) !== input.expectedRevision) throw new JourneyCollaborationError(
        'This comment changed since it was opened.', 409, 'JOURNEY_COMMENT_REVISION_CONFLICT',
        { currentRevision: Number(current.revision) });
      const nextRevision = input.expectedRevision + 1; const versionId = crypto.randomUUID(); const at = nowIso();
      db.prepare(`INSERT INTO journey_comment_versions
        (id,comment_id,space_id,version_number,schema_version,body_json,plain_text,content_sha256,
          editor_user_id,edit_reason_sha256,created_at) VALUES (?,?,?,?,1,?,?,?,?,?,?)`).run(versionId,
          input.commentId, input.spaceId, nextRevision, bodyJson, normalized.plainText, contentSha256,
          input.actorUserId, sha256(editReason), at);
      const changed = db.prepare(`UPDATE journey_comments SET current_version_id=?,revision=revision+1,edited_at=?
        WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(versionId, at, input.commentId,
          input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This comment changed while it was being saved.', 409, 'JOURNEY_COMMENT_REVISION_CONFLICT');
      insertMentions(input.commentId, input.spaceId, nextRevision, mentionUserIds, at);
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'comment.edited', targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, commentId: input.commentId, requestId: input.requestId,
        detail: { contentSha256, bodyLength: normalized.plainText.length, mentionCount: mentionUserIds.length,
          editReasonSha256: sha256(editReason), revision: nextRevision } });
      notifyCommentAudience({ spaceId: input.spaceId, actorUserId: input.actorUserId, target,
        commentId: input.commentId, eventId, mentionUserIds, defaultKind: current.parent_comment_id ? 'reply' : 'comment' });
      const row = db.prepare(`${commentSelect()} WHERE comment.id=? AND comment.space_id=?`)
        .get(input.commentId, input.spaceId) as any;
      return { comment: commentRow(attachCurrentMentions(input.spaceId, [row])[0]) };
    }
  });
}

export function deleteJourneyComment(input: {
  spaceId: string; actorUserId: string; commentId: string; expectedRevision: number;
  reason: string; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId, 'comments');
  const reason = String(input.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new JourneyCollaborationError(
    'Deleting a comment requires a short reason.', 400, 'JOURNEY_COMMENT_DELETE_REASON_REQUIRED');
  // Authorised before `idempotentMutation`, which returns a stored response
  // without entering `run()`.
  authorizeCommentAction(input.spaceId, input.actorUserId, input.commentId);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'comment.delete', intent: { commentId: input.commentId, expectedRevision: input.expectedRevision,
      reasonSha256: sha256(reason) }, run: () => {
      const { row, target } = authorizeCommentAction(input.spaceId, input.actorUserId, input.commentId);
      if (row.state === 'deleted') throw new JourneyCollaborationError('This comment is already deleted.', 409,
        'JOURNEY_COMMENT_STATE_CONFLICT');
      const at = nowIso();
      const expiry = new Date(Date.parse(at) + settingsRow(input.spaceId).commentRetentionDays * 86_400_000).toISOString();
      const changed = db.prepare(`UPDATE journey_comments SET state='deleted',revision=revision+1,deleted_at=?,
        retention_expires_at=?,resolved_at=NULL,resolved_by_user_id=NULL
        WHERE id=? AND space_id=? AND state<>'deleted' AND revision=?`).run(at, expiry, input.commentId,
          input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This comment changed since it was opened.', 409, 'JOURNEY_COMMENT_REVISION_CONFLICT');
      appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'comment.deleted', targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, commentId: input.commentId, requestId: input.requestId,
        detail: { reasonSha256: sha256(reason), retentionExpiresAt: expiry,
          contentSha256: String((db.prepare(`SELECT content_sha256 FROM journey_comment_versions
            WHERE id=? AND space_id=? AND comment_id=?`)
            .get(row.current_version_id, input.spaceId, input.commentId) as any)?.content_sha256 || '') } });
      return { commentId: input.commentId, state: 'deleted' as const,
        revision: input.expectedRevision + 1, retentionExpiresAt: expiry };
    }
  });
}

export function transitionJourneyComment(input: {
  spaceId: string; actorUserId: string; commentId: string; expectedRevision: number;
  action: 'resolve' | 'reopen'; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId, 'comments');
  if (!['resolve', 'reopen'].includes(String(input.action))) throw new JourneyCollaborationError(
    'A comment can only be resolved or reopened.', 400, 'JOURNEY_COMMENT_TRANSITION_INVALID');
  // Authorised before `idempotentMutation`, which returns a stored response
  // without entering `run()`. This one returns the rendered comment, so the
  // replay handed back the full body.
  authorizeCommentAction(input.spaceId, input.actorUserId, input.commentId);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: `comment.${input.action}`, intent: { commentId: input.commentId,
      expectedRevision: input.expectedRevision },
    persist: (result) => ({ commentId: result.comment.id }),
    restore: (stored) => ({ comment: readCommentById(input.spaceId, String(stored.commentId)) }),
    run: () => {
      const { row, target } = authorizeCommentAction(input.spaceId, input.actorUserId, input.commentId);
      if (row.parent_comment_id) throw new JourneyCollaborationError(
        'Resolve or reopen the root comment for this thread.', 409, 'JOURNEY_COMMENT_ROOT_REQUIRED');
      const expectedState = input.action === 'resolve' ? 'active' : 'resolved';
      const nextState = input.action === 'resolve' ? 'resolved' : 'active';
      const at = nowIso();
      const changed = input.action === 'resolve'
        ? db.prepare(`UPDATE journey_comments SET state='resolved',revision=revision+1,resolved_at=?,resolved_by_user_id=?
          WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(at, input.actorUserId,
            input.commentId, input.spaceId, input.expectedRevision).changes
        : db.prepare(`UPDATE journey_comments SET state='active',revision=revision+1,resolved_at=NULL,resolved_by_user_id=NULL
          WHERE id=? AND space_id=? AND state='resolved' AND revision=?`).run(input.commentId,
            input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        `Only a ${expectedState} comment at the expected revision can be ${input.action}d.`, 409,
        'JOURNEY_COMMENT_REVISION_CONFLICT');
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        // `comment.${action}d` produced "comment.reopend", which does not match
        // the notification kind for the same event.
        action: input.action === 'resolve' ? 'comment.resolved' : 'comment.reopened',
        targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, commentId: input.commentId, requestId: input.requestId,
        detail: { stateFrom: expectedState, stateTo: nextState, revision: input.expectedRevision + 1 } });
      notifyCommentAudience({ spaceId: input.spaceId, actorUserId: input.actorUserId, target,
        commentId: input.commentId, eventId, mentionUserIds: [],
        defaultKind: input.action === 'resolve' ? 'resolved' : 'reopened' });
      const current = db.prepare(`${commentSelect()} WHERE comment.id=? AND comment.space_id=?`)
        .get(input.commentId, input.spaceId) as any;
      return { comment: commentRow(attachCurrentMentions(input.spaceId, [current])[0]) };
    }
  });
}

export function listJourneyCommentHistory(input: {
  spaceId: string; actorUserId: string; commentId: string; limit?: number; cursor?: string | null;
}) {
  const comment = requireComment(input.spaceId, input.commentId);
  const target = resolveJourneyCollaborationTarget(input.spaceId, {
    targetType: comment.target_type, targetId: comment.target_id
  });
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.read', target);
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const parameters: unknown[] = [input.spaceId, input.commentId];
  // Ordering by created_at broke ties on a random UUID, so versions written in
  // the same millisecond came back in arbitrary order. version_number is the
  // sequence key and is unique per comment, which makes the order total; the
  // cursor still travels as (createdAt,id) and is resolved back to its sequence
  // position here.
  const cursorSql = cursor ? `AND version.version_number<(SELECT position.version_number
    FROM journey_comment_versions position WHERE position.id=? AND position.space_id=?
      AND position.comment_id=?)` : '';
  if (cursor) parameters.push(cursor.id, input.spaceId, input.commentId);
  const rows = db.prepare(`SELECT version.id,version.version_number,version.body_json,version.plain_text,
      version.content_sha256,version.editor_user_id,editor.name editor_name,version.edit_reason_sha256,
      version.created_at FROM journey_comment_versions version
    JOIN users editor ON editor.id=version.editor_user_id
    WHERE version.space_id=? AND version.comment_id=? ${cursorSql}
    ORDER BY version.version_number DESC LIMIT ?`).all(...parameters, limit + 1) as any[];
  // A deleted comment redacts its body on the read path, and the edit history
  // served every prior version of that same body in full to anyone holding
  // journeys.read. Deletion has to remove the content from both.
  const redacted = comment.state === 'deleted';
  return { items: rows.slice(0, limit).map((row) => ({
    id: row.id, versionNumber: Number(row.version_number),
    body: redacted ? null : safeJson(row.body_json, null),
    plainText: redacted ? null : row.plain_text, checksum: row.content_sha256,
    editor: { id: row.editor_user_id, name: row.editor_name },
    editReasonSha256: row.edit_reason_sha256 || null, createdAt: row.created_at
  })), redacted, nextCursor: nextCursor(rows, limit) };
}

export function setJourneyWatcher(input: {
  spaceId: string; actorUserId: string; target: JourneyTargetReference; state: 'watching' | 'muted';
  idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  const target = resolveJourneyCollaborationTarget(input.spaceId, input.target);
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.watch', target);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'watcher.set', intent: { targetType: target.targetType, targetId: target.targetId, state: input.state },
    run: () => {
      const watcher = upsertWatcher(input.spaceId, target, input.actorUserId, input.state);
      appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: input.state === 'watching' ? 'watcher.added' : 'watcher.muted', targetType: target.targetType,
        targetId: target.targetId, journeyDefinitionId: target.journeyDefinitionId, requestId: input.requestId,
        detail: { watcherId: watcher.id, state: watcher.state, revision: watcher.revision } });
      return { watcher };
    }
  });
}

export function listJourneyWatchers(input: {
  spaceId: string; actorUserId: string; target: JourneyTargetReference; limit?: number; cursor?: string | null;
}) {
  const target = resolveJourneyCollaborationTarget(input.spaceId, input.target);
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.read', target);
  // This read had no LIMIT and no cursor while every sibling reader is bounded;
  // a heavily watched target returned the whole watcher set in one response.
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const clauses = ['watcher.space_id=?', 'watcher.target_type=?', 'watcher.target_id=?'];
  const parameters: unknown[] = [input.spaceId, target.targetType, target.targetId];
  if (cursor) { clauses.push('(watcher.created_at>? OR (watcher.created_at=? AND watcher.id>?))');
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
  const rows = db.prepare(`SELECT watcher.id,watcher.user_id,watcher_user.name,watcher.state,watcher.revision,
      watcher.created_at,watcher.updated_at FROM journey_collaboration_watchers watcher
    JOIN space_memberships membership ON membership.space_id=watcher.space_id AND membership.user_id=watcher.user_id
    JOIN users watcher_user ON watcher_user.id=membership.user_id
    WHERE ${clauses.join(' AND ')} ORDER BY watcher.created_at,watcher.id LIMIT ?`)
    .all(...parameters, limit + 1) as any[];
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map((row) => ({ id: row.id, user: { id: row.user_id, name: row.name },
      state: row.state, revision: Number(row.revision), createdAt: row.created_at, updatedAt: row.updated_at })),
    nextCursor: rows.length > limit && pageRows.length
      ? encodeJourneyPageCursor({ createdAt: pageRows.at(-1)!.created_at, id: pageRows.at(-1)!.id }) : null
  };
}

/** `memo` collapses the per-row authorisation of an inbox page. Readability is a
 * function of (target_type,target_id) alone for a fixed reader, and the scan
 * below reads up to 25 x 401 rows, each costing a target resolve plus an
 * effective-role computation -- several queries per row for one inbox page. */
function notificationTargetReadable(spaceId: string, userId: string, row: any,
  memo?: Map<string, boolean>) {
  if (row.kind === 'role_changed') return Boolean(db.prepare(
    'SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId));
  if (!journeyCollaborationTargetTypes.includes(row.target_type)) return false;
  const cacheKey = `${row.target_type} ${row.target_id}`;
  const cached = memo?.get(cacheKey);
  if (cached !== undefined) return cached;
  let readable = false;
  try {
    const target = resolveJourneyCollaborationTarget(spaceId, {
      targetType: row.target_type, targetId: row.target_id
    });
    assertJourneyCapability(spaceId, userId, 'journeys.read', target);
    readable = true;
  } catch { readable = false; }
  memo?.set(cacheKey, readable);
  return readable;
}

export function listJourneyCollaborationNotifications(input: {
  spaceId: string; actorUserId: string; state?: 'unread' | 'read' | 'dismissed';
  limit?: number; cursor?: string | null;
}) {
  membership(input.spaceId, input.actorUserId);
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const baseClauses = ['notification.space_id=?', 'notification.recipient_user_id=?'];
  const baseParameters: unknown[] = [input.spaceId, input.actorUserId];
  if (input.state) { baseClauses.push('state.state=?'); baseParameters.push(input.state); }
  // Role/target reauthorisation can remove entries after the immutable
  // notification was created, so the scan is filtered after it is read. A single
  // bounded over-read reported `nextCursor: null` whenever the whole window was
  // filtered out, which stranded every older notification behind it -- unread
  // items became permanently unreachable. Keep advancing the raw scan until the
  // page is full or the scan is exhausted.
  const authorised: any[] = [];
  const readableMemo = new Map<string, boolean>();
  let scanCursor: { createdAt: string; id: string } | null = cursor;
  let exhausted = false;
  const batch = Math.min(limit * 4 + 1, 401);
  for (let pass = 0; pass < 25 && authorised.length <= limit && !exhausted; pass += 1) {
    const clauses = [...baseClauses]; const parameters = [...baseParameters];
    if (scanCursor) { clauses.push('(notification.created_at<? OR (notification.created_at=? AND notification.id<?))');
      parameters.push(scanCursor.createdAt, scanCursor.createdAt, scanCursor.id); }
    const rows = db.prepare(`SELECT notification.*,state.state,state.revision,state.read_at,actor.name actor_name
      FROM journey_collaboration_notifications notification
      JOIN journey_collaboration_notification_states state ON state.notification_id=notification.id
        AND state.space_id=notification.space_id AND state.recipient_user_id=notification.recipient_user_id
      LEFT JOIN users actor ON actor.id=notification.actor_user_id
      WHERE ${clauses.join(' AND ')} ORDER BY notification.created_at DESC,notification.id DESC LIMIT ?`)
      .all(...parameters, batch) as any[];
    if (rows.length < batch) exhausted = true;
    if (rows.length) scanCursor = { createdAt: String(rows.at(-1)!.created_at), id: String(rows.at(-1)!.id) };
    for (const row of rows) {
      if (notificationTargetReadable(input.spaceId, input.actorUserId, row, readableMemo)) authorised.push(row);
    }
  }
  const pageRows = authorised.slice(0, limit);
  return { items: pageRows.map((row) => ({
    id: row.id, kind: row.kind, targetType: row.target_type, targetId: row.target_id,
    actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name || 'Former member' } : null,
    commentId: row.comment_id || null, reviewId: row.review_id || null,
    state: row.state, revision: Number(row.revision), createdAt: row.created_at, readAt: row.read_at || null
  })), nextCursor: authorised.length > limit && pageRows.length
    ? encodeJourneyPageCursor({ createdAt: pageRows.at(-1)!.created_at, id: pageRows.at(-1)!.id }) : null };
}

export function updateJourneyCollaborationNotification(input: {
  spaceId: string; actorUserId: string; notificationId: string; expectedRevision: number;
  state: 'read' | 'dismissed';
}) {
  membership(input.spaceId, input.actorUserId);
  // The only write in this module that skipped the plan gate and the space kill
  // switch.
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  if (!['read', 'dismissed'].includes(String(input.state))) throw new JourneyCollaborationError(
    'A notification can only be marked read or dismissed.', 400, 'JOURNEY_NOTIFICATION_STATE_INVALID');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new JourneyCollaborationError(
    'A valid expected revision is required.', 400, 'JOURNEY_NOTIFICATION_REVISION_INVALID');
  return db.transaction(() => {
    const row = db.prepare(`SELECT notification.*,state.state,state.revision FROM journey_collaboration_notifications notification
      JOIN journey_collaboration_notification_states state ON state.notification_id=notification.id
        AND state.space_id=notification.space_id AND state.recipient_user_id=notification.recipient_user_id
      WHERE notification.id=? AND notification.space_id=? AND notification.recipient_user_id=?`)
      .get(input.notificationId, input.spaceId, input.actorUserId) as any;
    if (!row || !notificationTargetReadable(input.spaceId, input.actorUserId, row)) throw new JourneyCollaborationError(
      'Notification not found.', 404, 'JOURNEY_NOTIFICATION_NOT_FOUND');
    const at = nowIso();
    const changed = db.prepare(`UPDATE journey_collaboration_notification_states SET state=?,revision=revision+1,read_at=?
      WHERE notification_id=? AND space_id=? AND recipient_user_id=? AND revision=?`).run(input.state, at,
        input.notificationId, input.spaceId, input.actorUserId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyCollaborationError(
      'This notification changed since it was opened.', 409, 'JOURNEY_NOTIFICATION_REVISION_CONFLICT');
    db.prepare(`INSERT INTO journey_collaboration_notification_state_events
      (id,notification_id,space_id,recipient_user_id,state_from,state_to,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.notificationId, input.spaceId,
        input.actorUserId, row.state, input.state, at);
    return { notificationId: input.notificationId, state: input.state,
      revision: input.expectedRevision + 1, readAt: at };
  })();
}

/** Retention sweep for soft-deleted comments. `retention_expires_at` was
 * written on delete and indexed by 0028, but nothing ever read it, so
 * "deletions remove prohibited content" held only for the redacted read paths
 * while every body stayed in journey_comment_versions indefinitely.
 *
 * This is a scheduler entry point, not a request handler: it takes no actor and
 * must not be mounted on a route. Content is removed by deleting the comment,
 * which cascades its versions, mentions and notifications; the activity and
 * audit ledgers carry no foreign key to it and keep the trail, including the
 * content hash recorded at deletion. A root comment is held back while any reply
 * is still within its own retention window, because deleting it would cascade
 * that reply away early. */
export function purgeExpiredJourneyComments(input: {
  spaceId?: string | null; limit?: number; now?: string;
} = {}) {
  const limit = pageLimit(input.limit);
  const at = input.now ? new Date(input.now).toISOString() : nowIso();
  const scope = input.spaceId ? 'AND comment.space_id=?' : '';
  const parameters: unknown[] = input.spaceId ? [at, input.spaceId, at] : [at, at];
  const candidates = db.prepare(`SELECT comment.id,comment.space_id,comment.target_type,comment.target_id,
      comment.journey_definition_id,comment.retention_expires_at
    FROM journey_comments comment
    WHERE comment.state='deleted' AND comment.retention_expires_at IS NOT NULL
      AND comment.retention_expires_at<=? ${scope}
      AND NOT EXISTS (SELECT 1 FROM journey_comments reply
        WHERE reply.space_id=comment.space_id AND reply.root_comment_id=comment.id AND reply.id<>comment.id
          AND (reply.state<>'deleted' OR reply.retention_expires_at IS NULL OR reply.retention_expires_at>?))
    ORDER BY comment.retention_expires_at,comment.id LIMIT ?`).all(...parameters, limit) as any[];
  const purged: string[] = [];
  for (const candidate of candidates) {
    db.transaction(() => {
      const surviving = db.prepare('SELECT 1 FROM journey_comments WHERE id=? AND space_id=?')
        .get(candidate.id, candidate.space_id);
      if (!surviving) return;
      const versions = Number((db.prepare(`SELECT COUNT(*) count FROM journey_comment_versions
        WHERE space_id=? AND comment_id=?`).get(candidate.space_id, candidate.id) as any)?.count || 0);
      db.prepare('DELETE FROM journey_comments WHERE id=? AND space_id=?').run(candidate.id, candidate.space_id);
      appendActivity({ spaceId: candidate.space_id, actorUserId: null, action: 'comment.purged',
        targetType: candidate.target_type, targetId: candidate.target_id,
        journeyDefinitionId: candidate.journey_definition_id || null,
        detail: { purgedCommentId: candidate.id, versionCount: versions,
          retentionExpiresAt: candidate.retention_expires_at } });
      purged.push(String(candidate.id));
    })();
  }
  return { purged: purged.length, commentIds: purged, sweptAt: at };
}

function governanceTarget(spaceId: string, target: JourneyTargetReference) {
  if (!journeyGovernanceTargetTypes.includes(target.targetType as JourneyGovernanceTargetType)) {
    throw new JourneyCollaborationError('This target does not support governance review.', 400,
      'JOURNEY_GOVERNANCE_TARGET_INVALID');
  }
  return resolveJourneyCollaborationTarget(spaceId, target);
}

function governanceReviewRow(row: any) {
  return {
    id: String(row.id), targetType: row.target_type as JourneyGovernanceTargetType,
    targetId: String(row.target_id), journeyDefinitionId: row.journey_definition_id || null,
    targetRevision: Number(row.target_revision), targetChecksum: String(row.target_sha256),
    state: row.state as 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'published',
    revision: Number(row.revision), requestedByUserId: String(row.requested_by_user_id),
    requestSummary: String(row.request_summary), requestedAt: String(row.requested_at),
    dueAt: row.due_at || null, decidedByUserId: row.decided_by_user_id || null,
    decisionSummary: row.decision_summary || null, decidedAt: row.decided_at || null,
    publishedByUserId: row.published_by_user_id || null, publishedAt: row.published_at || null
  };
}

function requireGovernanceReview(spaceId: string, reviewId: string) {
  const row = db.prepare('SELECT * FROM journey_governance_reviews WHERE id=? AND space_id=?')
    .get(reviewId, spaceId) as any;
  if (!row) throw new JourneyCollaborationError('Governance review not found.', 404,
    'JOURNEY_GOVERNANCE_REVIEW_NOT_FOUND');
  return row;
}

/** Resolves a review and its target and authorises the actor against the named
 * capability. Called once before `idempotentMutation` so a replay cannot skip
 * the check -- these responses carry the request and decision summaries, which
 * are free text -- and again inside `run()` against the state being mutated. */
function authorizeGovernanceAction(spaceId: string, actorUserId: string, reviewId: string,
  capability: JourneyCollaborationCapability) {
  const row = requireGovernanceReview(spaceId, reviewId);
  const target = governanceTarget(spaceId, { targetType: row.target_type, targetId: row.target_id });
  const actor = assertJourneyCapability(spaceId, actorUserId, capability, target);
  return { row, target, actor };
}

/** Governance responses are re-read from `journey_governance_reviews` on replay
 * rather than served from a copy in the sealed operations ledger, so a summary
 * never outlives the review it belongs to. */
function governanceReplay(spaceId: string) {
  return {
    persist: (result: { review: { id: string } }) => ({ reviewId: result.review.id }),
    restore: (stored: Record<string, unknown>) => ({
      review: governanceReviewRow(requireGovernanceReview(spaceId, String(stored.reviewId)))
    })
  };
}

function appendGovernanceEvent(input: {
  spaceId: string; reviewId: string; actorUserId: string | null;
  action: 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'published' | 'superseded';
  stateFrom: string | null; stateTo: string; reasonSha256: string; at: string;
}) {
  db.prepare(`INSERT INTO journey_governance_review_events
    (id,review_id,space_id,actor_user_id,action,state_from,state_to,reason_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.reviewId, input.spaceId, input.actorUserId,
      input.action, input.stateFrom, input.stateTo, input.reasonSha256, input.at);
}

function boundedGovernanceText(value: unknown, field: 'summary' | 'reason', code: string) {
  const text = String(value || '').trim();
  const maximum = field === 'summary' ? 2_000 : 500;
  if (text.length < 3 || text.length > maximum) throw new JourneyCollaborationError(
    `A governance ${field} between 3 and ${maximum} characters is required.`, 400, code);
  return text;
}

/** Pins the review to the exact target revision and content hash it was raised
 * against, and supersedes any pending review of an older revision so an approval
 * can never be applied to content that moved underneath it. */
export function requestJourneyGovernanceReview(input: {
  spaceId: string; actorUserId: string; target: JourneyTargetReference; summary: string; reason: string;
  dueAt?: string | null; idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  const target = governanceTarget(input.spaceId, input.target);
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.request_review', target);
  const summary = boundedGovernanceText(input.summary, 'summary', 'JOURNEY_GOVERNANCE_SUMMARY_REQUIRED');
  const reason = boundedGovernanceText(input.reason, 'reason', 'JOURNEY_GOVERNANCE_REASON_REQUIRED');
  let dueAt: string | null = null;
  if (input.dueAt !== undefined && input.dueAt !== null && String(input.dueAt) !== '') {
    const parsed = Date.parse(String(input.dueAt));
    if (!Number.isFinite(parsed)) throw new JourneyCollaborationError('The review due date is invalid.', 400,
      'JOURNEY_GOVERNANCE_DUE_AT_INVALID');
    dueAt = new Date(parsed).toISOString();
  }
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'governance.request', intent: { targetType: target.targetType, targetId: target.targetId,
      targetRevision: target.revision, targetChecksum: target.checksum, summarySha256: sha256(summary),
      reasonSha256: sha256(reason), dueAt },
    ...governanceReplay(input.spaceId), run: () => {
      const at = nowIso();
      if (dueAt && dueAt <= at) throw new JourneyCollaborationError(
        'The review due date must be in the future.', 400, 'JOURNEY_GOVERNANCE_DUE_AT_INVALID');
      const pending = db.prepare(`SELECT * FROM journey_governance_reviews
        WHERE space_id=? AND target_type=? AND target_id=? AND state='pending'`)
        .all(input.spaceId, target.targetType, target.targetId) as any[];
      for (const stale of pending) {
        if (Number(stale.target_revision) === target.revision) throw new JourneyCollaborationError(
          'A review is already pending for this revision.', 409, 'JOURNEY_GOVERNANCE_REVIEW_PENDING',
          { reviewId: String(stale.id) });
        // Supersession is automatic, not a decision. Stamping the new requester
        // as `decided_by_user_id` made anyone holding journeys.request_review
        // appear in the audit as the decider of someone else's review. The
        // withdrawn state permits a null decider in both 0028 and the projection,
        // and the actor is recorded on the `superseded` event and the activity
        // ledger, where it belongs.
        const superseded = db.prepare(`UPDATE journey_governance_reviews SET state='withdrawn',revision=revision+1,
          decided_by_user_id=NULL,decision_summary=?,decided_at=? WHERE id=? AND space_id=? AND state='pending'`)
          .run('Superseded by a review of a newer revision.', at, stale.id, input.spaceId).changes;
        if (superseded !== 1) throw new JourneyCollaborationError(
          'A concurrent change conflicted with this request. Reload and try again.', 409,
          'JOURNEY_COLLABORATION_CONCURRENT_CONFLICT');
        appendGovernanceEvent({ spaceId: input.spaceId, reviewId: String(stale.id),
          actorUserId: input.actorUserId, action: 'superseded', stateFrom: 'pending', stateTo: 'withdrawn',
          reasonSha256: sha256(`superseded:${target.revision}`), at });
        appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'governance.superseded',
          targetType: target.targetType, targetId: target.targetId,
          journeyDefinitionId: target.journeyDefinitionId, reviewId: String(stale.id), requestId: input.requestId,
          detail: { supersededRevision: Number(stale.target_revision), targetRevision: target.revision } });
      }
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_governance_reviews
        (id,space_id,target_type,target_id,journey_definition_id,target_revision,target_sha256,state,revision,
          requested_by_user_id,request_summary,request_reason_sha256,requested_at,due_at,
          decided_by_user_id,decision_summary,decided_at,published_by_user_id,published_at)
        VALUES (?,?,?,?,?,?,?,'pending',1,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL)`).run(id, input.spaceId,
          target.targetType, target.targetId, target.journeyDefinitionId, target.revision, target.checksum,
          input.actorUserId, summary, sha256(reason), at, dueAt);
      appendGovernanceEvent({ spaceId: input.spaceId, reviewId: id, actorUserId: input.actorUserId,
        action: 'submitted', stateFrom: null, stateTo: 'pending', reasonSha256: sha256(reason), at });
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'governance.requested', targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, reviewId: id, requestId: input.requestId,
        detail: { targetRevision: target.revision, targetChecksum: target.checksum,
          summaryLength: summary.length, reasonSha256: sha256(reason), dueAt } });
      for (const row of db.prepare(`SELECT user_id FROM journey_collaboration_watchers
        WHERE space_id=? AND target_type=? AND target_id=? AND state='watching'`)
        .all(input.spaceId, target.targetType, target.targetId) as Array<{ user_id: string }>) {
        appendNotification({ spaceId: input.spaceId, recipientUserId: row.user_id, kind: 'review_requested',
          targetType: target.targetType, targetId: target.targetId, actorUserId: input.actorUserId,
          eventId, reviewId: id });
      }
      return { review: governanceReviewRow(requireGovernanceReview(input.spaceId, id)) };
    }
  });
}

/** Rejects a decision whose pinned revision or content hash no longer matches
 * the live target, so an approval cannot silently apply to edited content. */
function assertReviewCurrent(spaceId: string, row: any) {
  const current = resolveJourneyCollaborationTarget(spaceId, {
    targetType: row.target_type, targetId: row.target_id
  });
  if (Number(current.revision) !== Number(row.target_revision) || current.checksum !== row.target_sha256) {
    throw new JourneyCollaborationError(
      'This review is pinned to an older revision of its target. Request a new review.', 409,
      'JOURNEY_GOVERNANCE_REVIEW_STALE', { pinnedRevision: Number(row.target_revision),
        currentRevision: Number(current.revision) });
  }
  return current;
}

export function decideJourneyGovernanceReview(input: {
  spaceId: string; actorUserId: string; reviewId: string; expectedRevision: number;
  decision: 'approve' | 'reject'; summary: string; reason: string;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  if (!['approve', 'reject'].includes(String(input.decision))) throw new JourneyCollaborationError(
    'A governance decision must approve or reject.', 400, 'JOURNEY_GOVERNANCE_DECISION_INVALID');
  const summary = boundedGovernanceText(input.summary, 'summary', 'JOURNEY_GOVERNANCE_SUMMARY_REQUIRED');
  const reason = boundedGovernanceText(input.reason, 'reason', 'JOURNEY_GOVERNANCE_REASON_REQUIRED');
  authorizeGovernanceAction(input.spaceId, input.actorUserId, input.reviewId, 'journeys.review');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'governance.decide', intent: { reviewId: input.reviewId, expectedRevision: input.expectedRevision,
      decision: input.decision, summarySha256: sha256(summary), reasonSha256: sha256(reason) },
    ...governanceReplay(input.spaceId), run: () => {
      const { row, target } = authorizeGovernanceAction(input.spaceId, input.actorUserId, input.reviewId,
        'journeys.review');
      if (row.state !== 'pending') throw new JourneyCollaborationError(
        'Only a pending review can be decided.', 409, 'JOURNEY_GOVERNANCE_STATE_CONFLICT',
        { state: row.state });
      // Two-person rule. The migration cannot express it -- there is no CHECK
      // comparing decided_by_user_id with requested_by_user_id in 0028 -- so this
      // is the only place it holds, and it must stay ahead of the write.
      if (String(row.requested_by_user_id) === input.actorUserId) throw new JourneyCollaborationError(
        'A governance review must be decided by someone other than the person who requested it.', 409,
        'JOURNEY_GOVERNANCE_SELF_APPROVAL_FORBIDDEN');
      assertReviewCurrent(input.spaceId, row);
      const at = nowIso();
      const nextState = input.decision === 'approve' ? 'approved' : 'rejected';
      const changed = db.prepare(`UPDATE journey_governance_reviews SET state=?,revision=revision+1,
        decided_by_user_id=?,decision_summary=?,decided_at=?
        WHERE id=? AND space_id=? AND state='pending' AND revision=?`).run(nextState, input.actorUserId,
          summary, at, input.reviewId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This review changed since it was opened.', 409, 'JOURNEY_GOVERNANCE_REVISION_CONFLICT');
      appendGovernanceEvent({ spaceId: input.spaceId, reviewId: input.reviewId, actorUserId: input.actorUserId,
        action: nextState === 'approved' ? 'approved' : 'rejected', stateFrom: 'pending', stateTo: nextState,
        reasonSha256: sha256(reason), at });
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: `governance.${nextState}`, targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, reviewId: input.reviewId, requestId: input.requestId,
        detail: { stateFrom: 'pending', stateTo: nextState, targetRevision: Number(row.target_revision),
          summaryLength: summary.length, reasonSha256: sha256(reason) } });
      appendNotification({ spaceId: input.spaceId, recipientUserId: String(row.requested_by_user_id),
        kind: 'review_decided', targetType: target.targetType, targetId: target.targetId,
        actorUserId: input.actorUserId, eventId, reviewId: input.reviewId });
      return { review: governanceReviewRow(requireGovernanceReview(input.spaceId, input.reviewId)) };
    }
  });
}

export function withdrawJourneyGovernanceReview(input: {
  spaceId: string; actorUserId: string; reviewId: string; expectedRevision: number; reason: string;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  const reason = boundedGovernanceText(input.reason, 'reason', 'JOURNEY_GOVERNANCE_REASON_REQUIRED');
  const assertWithdrawable = () => {
    const resolved = authorizeGovernanceAction(input.spaceId, input.actorUserId, input.reviewId, 'journeys.read');
    if (String(resolved.row.requested_by_user_id) !== input.actorUserId
      && !['manager', 'administrator'].includes(resolved.actor.role)) throw new JourneyCollaborationError(
      'Only the requester or a Journey manager can withdraw this review.', 403,
      'JOURNEY_GOVERNANCE_WITHDRAW_FORBIDDEN');
    return resolved;
  };
  assertWithdrawable();
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'governance.withdraw', intent: { reviewId: input.reviewId,
      expectedRevision: input.expectedRevision, reasonSha256: sha256(reason) },
    ...governanceReplay(input.spaceId), run: () => {
      const { row, target } = assertWithdrawable();
      if (row.state !== 'pending') throw new JourneyCollaborationError(
        'Only a pending review can be withdrawn.', 409, 'JOURNEY_GOVERNANCE_STATE_CONFLICT',
        { state: row.state });
      const at = nowIso();
      const changed = db.prepare(`UPDATE journey_governance_reviews SET state='withdrawn',revision=revision+1,
        decided_by_user_id=?,decision_summary=?,decided_at=?
        WHERE id=? AND space_id=? AND state='pending' AND revision=?`).run(input.actorUserId,
          'Withdrawn by request.', at, input.reviewId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This review changed since it was opened.', 409, 'JOURNEY_GOVERNANCE_REVISION_CONFLICT');
      appendGovernanceEvent({ spaceId: input.spaceId, reviewId: input.reviewId, actorUserId: input.actorUserId,
        action: 'withdrawn', stateFrom: 'pending', stateTo: 'withdrawn', reasonSha256: sha256(reason), at });
      appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'governance.withdrawn',
        targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, reviewId: input.reviewId, requestId: input.requestId,
        detail: { stateFrom: 'pending', stateTo: 'withdrawn', reasonSha256: sha256(reason) } });
      return { review: governanceReviewRow(requireGovernanceReview(input.spaceId, input.reviewId)) };
    }
  });
}

export function publishJourneyGovernanceReview(input: {
  spaceId: string; actorUserId: string; reviewId: string; expectedRevision: number; reason: string;
  idempotencyKey: string; requestId?: string | null;
}) {
  assertCollaborationWritable(input.spaceId, input.actorUserId);
  const reason = boundedGovernanceText(input.reason, 'reason', 'JOURNEY_GOVERNANCE_REASON_REQUIRED');
  authorizeGovernanceAction(input.spaceId, input.actorUserId, input.reviewId, 'journeys.publish');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey,
    action: 'governance.publish', intent: { reviewId: input.reviewId,
      expectedRevision: input.expectedRevision, reasonSha256: sha256(reason) },
    ...governanceReplay(input.spaceId), run: () => {
      const { row, target } = authorizeGovernanceAction(input.spaceId, input.actorUserId, input.reviewId,
        'journeys.publish');
      if (row.state !== 'approved') throw new JourneyCollaborationError(
        'Only an approved review can be published.', 409, 'JOURNEY_GOVERNANCE_STATE_CONFLICT',
        { state: row.state });
      if (String(row.requested_by_user_id) === input.actorUserId) throw new JourneyCollaborationError(
        'A governance review must be published by someone other than the person who requested it.', 409,
        'JOURNEY_GOVERNANCE_SELF_APPROVAL_FORBIDDEN');
      assertReviewCurrent(input.spaceId, row);
      const at = nowIso();
      const changed = db.prepare(`UPDATE journey_governance_reviews SET state='published',revision=revision+1,
        published_by_user_id=?,published_at=? WHERE id=? AND space_id=? AND state='approved' AND revision=?`)
        .run(input.actorUserId, at, input.reviewId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneyCollaborationError(
        'This review changed since it was opened.', 409, 'JOURNEY_GOVERNANCE_REVISION_CONFLICT');
      db.prepare(`INSERT INTO journey_governance_publications
        (id,review_id,space_id,target_type,target_id,target_revision,target_sha256,published_by_user_id,published_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.reviewId, input.spaceId, row.target_type,
          row.target_id, Number(row.target_revision), row.target_sha256, input.actorUserId, at);
      appendGovernanceEvent({ spaceId: input.spaceId, reviewId: input.reviewId, actorUserId: input.actorUserId,
        action: 'published', stateFrom: 'approved', stateTo: 'published', reasonSha256: sha256(reason), at });
      const eventId = appendActivity({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'governance.published', targetType: target.targetType, targetId: target.targetId,
        journeyDefinitionId: target.journeyDefinitionId, reviewId: input.reviewId, requestId: input.requestId,
        detail: { stateFrom: 'approved', stateTo: 'published', targetRevision: Number(row.target_revision),
          targetChecksum: String(row.target_sha256), reasonSha256: sha256(reason) } });
      appendNotification({ spaceId: input.spaceId, recipientUserId: String(row.requested_by_user_id),
        kind: 'published', targetType: target.targetType, targetId: target.targetId,
        actorUserId: input.actorUserId, eventId, reviewId: input.reviewId });
      return { review: governanceReviewRow(requireGovernanceReview(input.spaceId, input.reviewId)) };
    }
  });
}

export function listJourneyGovernanceReviews(input: {
  spaceId: string; actorUserId: string; target?: JourneyTargetReference;
  state?: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'published';
  limit?: number; cursor?: string | null;
}) {
  let target: JourneyResolvedTarget | null = null;
  if (input.target) {
    target = governanceTarget(input.spaceId, input.target);
    assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.read', target);
  } else assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.read');
  if (input.state && !['pending', 'approved', 'rejected', 'withdrawn', 'published'].includes(input.state)) {
    throw new JourneyCollaborationError('Unknown governance review state.', 400,
      'JOURNEY_GOVERNANCE_STATE_INVALID');
  }
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const clauses = ['review.space_id=?']; const parameters: unknown[] = [input.spaceId];
  if (target) { clauses.push('review.target_type=?', 'review.target_id=?');
    parameters.push(target.targetType, target.targetId); }
  if (input.state) { clauses.push('review.state=?'); parameters.push(input.state); }
  if (cursor) { clauses.push('(review.requested_at<? OR (review.requested_at=? AND review.id<?))');
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
  const rows = db.prepare(`SELECT review.*,review.requested_at created_at FROM journey_governance_reviews review
    WHERE ${clauses.join(' AND ')} ORDER BY review.requested_at DESC,review.id DESC LIMIT ?`)
    .all(...parameters, limit + 1) as any[];
  return { items: rows.slice(0, limit).map(governanceReviewRow), nextCursor: nextCursor(rows, limit) };
}

export function listJourneyCollaborationActivity(input: {
  spaceId: string; actorUserId: string; target?: JourneyTargetReference; limit?: number; cursor?: string | null;
}) {
  let target: JourneyResolvedTarget | null = null;
  if (input.target) {
    target = resolveJourneyCollaborationTarget(input.spaceId, input.target);
    assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.view_activity', target);
  } else assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.view_activity');
  const limit = pageLimit(input.limit); const cursor = pageCursor(input.cursor);
  const clauses = ['activity.space_id=?']; const parameters: unknown[] = [input.spaceId];
  if (target) { clauses.push('activity.target_type=?', 'activity.target_id=?');
    parameters.push(target.targetType, target.targetId); }
  if (cursor) { clauses.push('(activity.created_at<? OR (activity.created_at=? AND activity.id<?))');
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
  const rows = db.prepare(`SELECT activity.*,actor.name actor_name FROM journey_collaboration_activity activity
    LEFT JOIN users actor ON actor.id=activity.actor_user_id WHERE ${clauses.join(' AND ')}
    ORDER BY activity.created_at DESC,activity.id DESC LIMIT ?`).all(...parameters, limit + 1) as any[];
  return { items: rows.slice(0, limit).map((row) => ({
    id: row.id, action: row.action, targetType: row.target_type, targetId: row.target_id,
    journeyDefinitionId: row.journey_definition_id || null,
    actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name || 'Former member' } : null,
    commentId: row.comment_id || null, reviewId: row.review_id || null,
    detail: safeJson(row.detail_json, {}), createdAt: row.created_at
  })), nextCursor: nextCursor(rows, limit) };
}
