-- Runtime schema 28: tenant-bound Journey collaboration, governance, and
-- permissioned read-only sharing. All user-authored content is stored outside
-- indexed keys. Notifications and audit projections are deliberately
-- content-free.

DO $journey_collaboration_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>27 THEN
    RAISE EXCEPTION 'runtime-28 journey collaboration requires the checksummed runtime-27 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_collaboration_predecessor$;

-- Runtime-28 declares no upstream tenant-identity index of its own. The only
-- upstream key its own foreign keys need is journey_definitions(id,space_id),
-- and that already exists twice (journey_definitions_tenant_identity, 0018:82;
-- journey_metric_definitions_parent_identity, 0021:21). Re-declaring it, plus
-- journey_personas(id,space_id) (0021:24, 0023:19),
-- journey_map_versions(id,definition_id,space_id) (0018:84) and
-- journey_map_cards(id,version_id,space_id) (0024:20) under new names built four
-- duplicate B-trees over identical values -- IF NOT EXISTS matches on index
-- name, not on definition, so it does not deduplicate them. The fifth,
-- journey_map_stages(id,version_id,space_id), backed no foreign key in any
-- migration; the tenant lookups journey_collaboration_target_exists performs are
-- served by journey_metric_stages_tenant_identity(id,space_id) (0021:22).

CREATE TABLE journey_collaboration_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  comments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  external_downloads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  comment_retention_days INTEGER NOT NULL DEFAULT 30 CHECK(comment_retention_days BETWEEN 1 AND 3650),
  view_retention_days INTEGER NOT NULL DEFAULT 30 CHECK(view_retention_days BETWEEN 1 AND 3650),
  maximum_share_days INTEGER NOT NULL DEFAULT 30 CHECK(maximum_share_days BETWEEN 1 AND 365),
  security_review_reference TEXT CHECK(
    security_review_reference IS NULL OR length(security_review_reference) BETWEEN 8 AND 200),
  security_reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  security_reviewed_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_settings_time_order CHECK(updated_at>=created_at),
  CONSTRAINT journey_collaboration_settings_security_review CHECK(
    (sharing_enabled=FALSE AND security_review_reference IS NULL
      AND security_reviewed_by_user_id IS NULL AND security_reviewed_at IS NULL)
    OR (sharing_enabled=TRUE AND security_review_reference IS NOT NULL
      AND security_reviewed_by_user_id IS NOT NULL AND security_reviewed_at IS NOT NULL)),
  CONSTRAINT journey_collaboration_settings_downloads CHECK(
    external_downloads_enabled=FALSE OR sharing_enabled=TRUE)
);

CREATE TABLE journey_collaboration_role_assignments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('space','journey')),
  journey_definition_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  role TEXT NOT NULL CHECK(role IN ('viewer','contributor','editor','approver','manager','administrator')),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason_sha256 TEXT CHECK(
    revocation_reason_sha256 IS NULL OR revocation_reason_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT journey_collaboration_roles_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_roles_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_roles_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_roles_scope_shape CHECK(
    (scope_type='space' AND journey_definition_id IS NULL)
    OR (scope_type='journey' AND journey_definition_id IS NOT NULL)),
  CONSTRAINT journey_collaboration_roles_state_shape CHECK(
    (state='active' AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason_sha256 IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL AND revocation_reason_sha256 IS NOT NULL)),
  CONSTRAINT journey_collaboration_roles_index_width CHECK(
    octet_length(space_id)+octet_length(user_id)
    +COALESCE(octet_length(journey_definition_id),0)<=1024)
);
CREATE UNIQUE INDEX journey_collaboration_roles_one_active
  ON journey_collaboration_role_assignments(space_id,user_id,scope_type,COALESCE(journey_definition_id,''))
  WHERE state='active';
CREATE INDEX journey_collaboration_roles_lookup
  ON journey_collaboration_role_assignments(space_id,user_id,state,scope_type,journey_definition_id,assigned_at DESC,id);

CREATE TABLE journey_collaboration_role_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  assignment_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('assigned','revoked')),
  role TEXT NOT NULL CHECK(role IN ('viewer','contributor','editor','approver','manager','administrator')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('space','journey')),
  journey_definition_id TEXT,
  reason_sha256 TEXT CHECK(reason_sha256 IS NULL OR reason_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_role_events_tenant_identity UNIQUE(id,space_id),
  -- Per-subject audit follows its subject. The assignment itself is declared to
  -- cascade from space_memberships and journey_definitions, so under RESTRICT
  -- removing a member or deleting a journey raised a raw foreign-key error from
  -- this table instead. The durable, space-scoped record of the same facts is
  -- journey_collaboration_audit_events / journey_collaboration_activity, which
  -- carry no parent foreign key and stay sealed against UPDATE and DELETE.
  CONSTRAINT journey_collaboration_role_events_assignment_fk FOREIGN KEY(assignment_id,space_id)
    REFERENCES journey_collaboration_role_assignments(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_collaboration_role_events_history
  ON journey_collaboration_role_events(space_id,assignment_id,created_at DESC,id);

CREATE TABLE journey_comments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN (
    'journey_map','journey_stage','journey_card','persona','portfolio_item','recommendation')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  journey_definition_id TEXT,
  parent_comment_id TEXT,
  root_comment_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','resolved','deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  edited_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  CONSTRAINT journey_comments_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_comments_target_identity UNIQUE(id,space_id,target_type,target_id),
  CONSTRAINT journey_comments_index_width CHECK(
    octet_length(id)+octet_length(space_id)+octet_length(target_type)+octet_length(target_id)<=1024),
  -- Authorship is historical; membership is current. A composite foreign key to
  -- space_memberships conflated the two: after any comment existed,
  -- spaces.ts removeSpaceMember's DELETE FROM space_memberships raised 23503 and
  -- the member could never be offboarded. Tenancy-at-write is re-enforced by
  -- journey_collaboration_membership_guard below, which locks the membership row
  -- FOR SHARE so the check cannot be raced by a concurrent removal, while
  -- author_user_id keeps its immutable users(id) ON DELETE NO ACTION attribution.
  CONSTRAINT journey_comments_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_comments_parent_tenant_fk FOREIGN KEY(parent_comment_id,space_id)
    REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_comments_root_tenant_fk FOREIGN KEY(root_comment_id,space_id)
    REFERENCES journey_comments(id,space_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_comments_thread_shape CHECK(
    (parent_comment_id IS NULL AND root_comment_id=id)
    OR (parent_comment_id IS NOT NULL AND root_comment_id<>id)),
  CONSTRAINT journey_comments_state_shape CHECK(
    (state='active' AND resolved_at IS NULL AND resolved_by_user_id IS NULL
      AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='resolved' AND parent_comment_id IS NULL AND resolved_at IS NOT NULL
      AND resolved_by_user_id IS NOT NULL AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
      AND retention_expires_at>=deleted_at))
);
CREATE INDEX journey_comments_target
  ON journey_comments(space_id,target_type,target_id,state,created_at,id);
CREATE INDEX journey_comments_thread
  ON journey_comments(space_id,root_comment_id,created_at,id);
CREATE INDEX journey_comments_retention
  ON journey_comments(retention_expires_at,id) WHERE state='deleted';

CREATE TABLE journey_comment_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  comment_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  body_json TEXT NOT NULL CHECK(
    octet_length(body_json) BETWEEN 2 AND 65536 AND jsonb_typeof(body_json::jsonb)='object'),
  plain_text TEXT NOT NULL CHECK(length(plain_text) BETWEEN 1 AND 8000),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  editor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  edit_reason_sha256 TEXT CHECK(edit_reason_sha256 IS NULL OR edit_reason_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_comment_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_comment_versions_parent_identity UNIQUE(id,comment_id,space_id),
  CONSTRAINT journey_comment_versions_sequence UNIQUE(comment_id,version_number),
  -- Editor attribution is sealed history (see the author note on
  -- journey_comments): tenancy is checked at write time by
  -- journey_collaboration_membership_guard, never by a live membership edge.
  CONSTRAINT journey_comment_versions_comment_tenant_fk FOREIGN KEY(comment_id,space_id)
    REFERENCES journey_comments(id,space_id) ON DELETE CASCADE
);
ALTER TABLE journey_comments ADD CONSTRAINT journey_comments_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_comment_versions(id,comment_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX journey_comment_versions_history
  ON journey_comment_versions(space_id,comment_id,version_number DESC,id);

CREATE TABLE journey_comment_mentions (
  comment_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  comment_revision INTEGER NOT NULL CHECK(comment_revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(comment_id,user_id,comment_revision),
  CONSTRAINT journey_comment_mentions_comment_fk FOREIGN KEY(comment_id,space_id)
    REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
  -- comment_revision was part of the primary key but pinned nothing: any integer
  -- was accepted, including a revision that never existed. journey_comments
  -- .revision and journey_comment_versions.version_number advance in lockstep and
  -- the version row is always inserted before its mentions
  -- (journeyCollaboration.ts insertMentions), so pinning it to the sequence key
  -- rejects only writes that were already incoherent.
  CONSTRAINT journey_comment_mentions_revision_fk FOREIGN KEY(comment_id,comment_revision)
    REFERENCES journey_comment_versions(comment_id,version_number) ON DELETE CASCADE,
  CONSTRAINT journey_comment_mentions_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE
);
CREATE INDEX journey_comment_mentions_recipient
  ON journey_comment_mentions(space_id,user_id,created_at DESC,comment_id);

CREATE TABLE journey_collaboration_watchers (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN (
    'journey_map','journey_stage','journey_card','persona','portfolio_item','recommendation')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'watching' CHECK(state IN ('watching','muted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_watchers_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_watchers_one UNIQUE(space_id,target_type,target_id,user_id),
  CONSTRAINT journey_collaboration_watchers_index_width CHECK(
    octet_length(space_id)+octet_length(target_type)+octet_length(target_id)
    +octet_length(user_id)<=1024),
  CONSTRAINT journey_collaboration_watchers_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_watchers_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_collaboration_watchers_target
  ON journey_collaboration_watchers(space_id,target_type,target_id,state,user_id);

CREATE TABLE journey_governance_reviews (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio_item','recommendation')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  journey_definition_id TEXT,
  target_revision INTEGER NOT NULL CHECK(target_revision>0),
  target_sha256 TEXT NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','withdrawn','published')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  request_summary TEXT NOT NULL CHECK(length(request_summary) BETWEEN 3 AND 2000),
  request_reason_sha256 TEXT NOT NULL CHECK(request_reason_sha256 ~ '^[a-f0-9]{64}$'),
  requested_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ,
  decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_summary TEXT CHECK(decision_summary IS NULL OR length(decision_summary) BETWEEN 3 AND 2000),
  decided_at TIMESTAMPTZ,
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  CONSTRAINT journey_governance_reviews_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_governance_reviews_index_width CHECK(
    octet_length(space_id)+octet_length(target_type)+octet_length(target_id)<=1024),
  -- Requester attribution is sealed history (see the author note on
  -- journey_comments): tenancy is checked at write time by
  -- journey_collaboration_membership_guard, never by a live membership edge.
  CONSTRAINT journey_governance_reviews_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_governance_reviews_due_order CHECK(due_at IS NULL OR due_at>requested_at),
  CONSTRAINT journey_governance_reviews_state_shape CHECK(
    (state='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL
      AND published_by_user_id IS NULL AND published_at IS NULL)
    OR (state IN ('approved','rejected') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
      AND published_by_user_id IS NULL AND published_at IS NULL)
    OR (state='withdrawn' AND decided_at IS NOT NULL AND published_by_user_id IS NULL AND published_at IS NULL)
    OR (state='published' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
      AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX journey_governance_reviews_one_pending
  ON journey_governance_reviews(space_id,target_type,target_id,target_revision)
  WHERE state='pending';
CREATE INDEX journey_governance_reviews_target
  ON journey_governance_reviews(space_id,target_type,target_id,state,requested_at DESC,id);

CREATE TABLE journey_governance_review_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  review_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('submitted','approved','rejected','withdrawn','published','superseded')),
  state_from TEXT,
  state_to TEXT NOT NULL CHECK(state_to IN ('pending','approved','rejected','withdrawn','published')),
  reason_sha256 TEXT NOT NULL CHECK(reason_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_governance_review_events_tenant_identity UNIQUE(id,space_id),
  -- The review itself cascades from spaces and journey_definitions. RESTRICT here
  -- pinned the parent it was supposed to describe, so deleting a journey failed.
  CONSTRAINT journey_governance_review_events_review_fk FOREIGN KEY(review_id,space_id)
    REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_governance_review_events_history
  ON journey_governance_review_events(space_id,review_id,created_at,id);

CREATE TABLE journey_governance_publications (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  review_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio_item','recommendation')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER NOT NULL CHECK(target_revision>0),
  target_sha256 TEXT NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_governance_publications_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_governance_publications_review_once UNIQUE(review_id),
  CONSTRAINT journey_governance_publications_review_fk FOREIGN KEY(review_id,space_id)
    REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE
);
-- "What is published for this target" had no access path: the two unique keys
-- lead with id or review_id.
CREATE INDEX journey_governance_publications_target
  ON journey_governance_publications(space_id,target_type,target_id,published_at DESC,id);

CREATE TABLE journey_collaboration_notifications (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'mention','comment','reply','resolved','reopened','review_requested','review_decided','published','role_changed')),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 64),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment_id TEXT,
  review_id TEXT,
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 128),
  dedupe_sha256 TEXT NOT NULL CHECK(dedupe_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_notifications_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_notifications_recipient_identity UNIQUE(id,space_id,recipient_user_id),
  CONSTRAINT journey_collaboration_notifications_dedupe UNIQUE(space_id,recipient_user_id,dedupe_sha256),
  CONSTRAINT journey_collaboration_notifications_index_width CHECK(
    octet_length(space_id)+octet_length(recipient_user_id)<=1024),
  CONSTRAINT journey_collaboration_notifications_membership_fk FOREIGN KEY(space_id,recipient_user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_notifications_comment_fk FOREIGN KEY(comment_id,space_id)
    REFERENCES journey_comments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_notifications_review_fk FOREIGN KEY(review_id,space_id)
    REFERENCES journey_governance_reviews(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_notifications_shape CHECK(
    (kind IN ('mention','comment','reply','resolved','reopened') AND comment_id IS NOT NULL)
    OR (kind IN ('review_requested','review_decided','published') AND review_id IS NOT NULL)
    OR kind='role_changed')
);
CREATE INDEX journey_collaboration_notifications_recipient
  ON journey_collaboration_notifications(space_id,recipient_user_id,created_at DESC,id);

CREATE TABLE journey_collaboration_notification_states (
  notification_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  read_at TIMESTAMPTZ,
  PRIMARY KEY(notification_id,space_id),
  CONSTRAINT journey_collaboration_notification_states_notification_fk
    FOREIGN KEY(notification_id,space_id,recipient_user_id)
    REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE,
  CONSTRAINT journey_collaboration_notification_states_shape CHECK(
    (state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
);
-- The per-recipient unread count leads with notification_id under the primary
-- key alone, so it would scan the whole table for one inbox badge.
CREATE INDEX journey_collaboration_notification_states_recipient
  ON journey_collaboration_notification_states(space_id,recipient_user_id,state,notification_id);

CREATE TABLE journey_collaboration_notification_state_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  notification_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  state_from TEXT NOT NULL CHECK(state_from IN ('unread','read','dismissed')),
  state_to TEXT NOT NULL CHECK(state_to IN ('read','dismissed')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_notification_state_events_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_notification_state_events_notification_fk
    FOREIGN KEY(notification_id,space_id,recipient_user_id)
    REFERENCES journey_collaboration_notifications(id,space_id,recipient_user_id) ON DELETE CASCADE
);
CREATE INDEX journey_collaboration_notification_state_events_history
  ON journey_collaboration_notification_state_events(space_id,notification_id,created_at,id);

CREATE TABLE journey_collaboration_views (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('journey_map','portfolio')),
  resource_id TEXT NOT NULL CHECK(length(resource_id) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','space')),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  configuration_json TEXT NOT NULL CHECK(
    octet_length(configuration_json) BETWEEN 2 AND 65536 AND jsonb_typeof(configuration_json::jsonb)='object'),
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  CONSTRAINT journey_collaboration_views_tenant_identity UNIQUE(id,space_id),
  -- Owner attribution is sealed history (see the author note on
  -- journey_comments): tenancy is checked at write time by
  -- journey_collaboration_membership_guard, never by a live membership edge.
  CONSTRAINT journey_collaboration_views_resource_shape CHECK(
    (resource_type='portfolio' AND resource_id=space_id) OR resource_type='journey_map'),
  CONSTRAINT journey_collaboration_views_lifecycle_shape CHECK(
    (state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
      AND retention_expires_at>=deleted_at)),
  CONSTRAINT journey_collaboration_views_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_collaboration_views_query
  ON journey_collaboration_views(space_id,resource_type,resource_id,state,audience,updated_at DESC,id);
CREATE INDEX journey_collaboration_views_owner
  ON journey_collaboration_views(space_id,owner_user_id,state,updated_at DESC,id);
CREATE INDEX journey_collaboration_views_retention
  ON journey_collaboration_views(retention_expires_at,id) WHERE state='deleted';

CREATE TABLE journey_read_only_shares (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey_map','persona','portfolio','collaboration_view')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER NOT NULL CHECK(target_revision>0),
  token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix TEXT NOT NULL CHECK(token_prefix ~ '^[A-Za-z0-9_-]{8,16}$'),
  token_version INTEGER NOT NULL DEFAULT 1 CHECK(token_version>0),
  permission TEXT NOT NULL DEFAULT 'view' CHECK(permission='view'),
  allow_export BOOLEAN NOT NULL DEFAULT FALSE,
  allow_download BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_json TEXT NOT NULL CHECK(
    octet_length(snapshot_json) BETWEEN 2 AND 1048576 AND jsonb_typeof(snapshot_json::jsonb)='object'),
  snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason_sha256 TEXT CHECK(
    revocation_reason_sha256 IS NULL OR revocation_reason_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT journey_read_only_shares_tenant_identity UNIQUE(id,space_id),
  -- Creator attribution is sealed history (see the author note on
  -- journey_comments): tenancy is checked at write time by
  -- journey_collaboration_membership_guard, never by a live membership edge.
  CONSTRAINT journey_read_only_shares_expiry CHECK(expires_at>created_at),
  CONSTRAINT journey_read_only_shares_download_policy CHECK(allow_download=FALSE OR allow_export=TRUE),
  CONSTRAINT journey_read_only_shares_state_shape CHECK(
    (state='active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason_sha256 IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL AND revocation_reason_sha256 IS NOT NULL))
);
CREATE INDEX journey_read_only_shares_target
  ON journey_read_only_shares(space_id,target_type,target_id,state,expires_at,id);
CREATE INDEX journey_read_only_shares_expiry
  ON journey_read_only_shares(expires_at,id) WHERE state='active';

CREATE TABLE journey_share_access_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  share_id TEXT,
  space_id TEXT,
  token_fingerprint TEXT NOT NULL CHECK(token_fingerprint ~ '^[a-f0-9]{64}$'),
  requester_fingerprint TEXT NOT NULL CHECK(requester_fingerprint ~ '^[a-f0-9]{64}$'),
  outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 80),
  requested_action TEXT NOT NULL CHECK(requested_action IN ('view','download')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_share_access_events_tenant_identity UNIQUE(id,space_id),
  -- No foreign key to journey_read_only_shares, deliberately, for two reasons
  -- that both make one unenforceable here.
  --
  -- ON DELETE SET NULL is executed as an ordinary UPDATE against this table and
  -- fires its row-level BEFORE triggers, so the append-only seal below refused
  -- it: once a share had been accessed it could never be deleted, and neither
  -- could the space it belongs to.
  --
  -- Both key columns are also nullable, which is required -- a denial for an
  -- unrecognised token has no share and no tenant to name -- and under the
  -- default MATCH SIMPLE a row with space_id IS NULL skips the composite check
  -- entirely, so the foreign key never constrained the case it mattered for.
  --
  -- This table is therefore a content-free, space-scoped ledger like
  -- journey_collaboration_audit_events: bounded columns plus a shape check that
  -- makes the half-populated pair unrepresentable.
  CONSTRAINT journey_share_access_events_share_shape CHECK(
    (share_id IS NULL AND space_id IS NULL)
    OR (share_id IS NOT NULL AND space_id IS NOT NULL
      AND length(share_id) BETWEEN 1 AND 128 AND length(space_id) BETWEEN 1 AND 128))
);
CREATE INDEX journey_share_access_events_share
  ON journey_share_access_events(space_id,share_id,created_at DESC,id);
CREATE INDEX journey_share_access_events_retention
  ON journey_share_access_events(created_at,id);

CREATE TABLE journey_share_rate_buckets (
  requester_fingerprint TEXT NOT NULL CHECK(requester_fingerprint ~ '^[a-f0-9]{64}$'),
  token_fingerprint TEXT NOT NULL CHECK(token_fingerprint ~ '^[a-f0-9]{64}$'),
  bucket_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 1000000),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(requester_fingerprint,token_fingerprint,bucket_started_at)
);
-- Rate buckets are written by unauthenticated share traffic and are never
-- deleted by any declared cascade, so the expiry sweep needs its own leading
-- time access path or the table grows without bound.
CREATE INDEX journey_share_rate_buckets_expiry
  ON journey_share_rate_buckets(bucket_started_at,requester_fingerprint);

CREATE TABLE journey_collaboration_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json TEXT NOT NULL CHECK(
    octet_length(response_json)<=131072 AND jsonb_typeof(response_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_operations_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_collaboration_operations_idempotency UNIQUE(space_id,actor_user_id,idempotency_key),
  CONSTRAINT journey_collaboration_operations_index_width CHECK(
    octet_length(space_id)+octet_length(actor_user_id)+octet_length(idempotency_key)<=1024)
);

CREATE TABLE journey_collaboration_activity (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 64),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  journey_definition_id TEXT CHECK(
    journey_definition_id IS NULL OR length(journey_definition_id) BETWEEN 1 AND 128),
  comment_id TEXT CHECK(comment_id IS NULL OR length(comment_id) BETWEEN 1 AND 128),
  review_id TEXT CHECK(review_id IS NULL OR length(review_id) BETWEEN 1 AND 128),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(
    octet_length(detail_json)<=32768 AND jsonb_typeof(detail_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_activity_tenant_identity UNIQUE(id,space_id)
  -- The three subject references carry no foreign key, matching
  -- journey_collaboration_audit_events here and journey_portfolio_activity in
  -- runtime-27. As composite ON DELETE SET NULL edges they were doubly
  -- unusable: SET NULL is executed as an ordinary UPDATE that fires this table's
  -- BEFORE UPDATE OR DELETE seal, and it nulls every referencing column
  -- including space_id, which is NOT NULL -- so deleting a journey, a comment or
  -- a review raised 55000 or 23502 and the delete could never succeed. This is
  -- the audit of record for exactly those events; it must outlive its subject,
  -- which is what a foreign key of any action cannot express.
);
CREATE INDEX journey_collaboration_activity_target
  ON journey_collaboration_activity(space_id,target_type,target_id,created_at DESC,id);
CREATE INDEX journey_collaboration_activity_retention
  ON journey_collaboration_activity(created_at,id);

CREATE TABLE journey_collaboration_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 64),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  request_id TEXT CHECK(request_id IS NULL OR length(request_id)<=200),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(
    octet_length(detail_json)<=32768 AND jsonb_typeof(detail_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_collaboration_audit_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_collaboration_audit_history
  ON journey_collaboration_audit_events(space_id,target_type,target_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_collaboration_target_exists(
  requested_space TEXT, requested_type TEXT, requested_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $journey_collaboration_target_exists$
BEGIN
  IF requested_type='journey_map' THEN
    RETURN EXISTS (SELECT 1 FROM journey_definitions
      WHERE id=requested_id AND space_id=requested_space AND status<>'archived');
  ELSIF requested_type='journey_stage' THEN
    RETURN EXISTS (SELECT 1 FROM journey_map_stages stage
      JOIN journey_map_versions version ON version.id=stage.version_id AND version.space_id=stage.space_id
      JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE stage.id=requested_id AND stage.space_id=requested_space AND definition.status<>'archived');
  ELSIF requested_type='journey_card' THEN
    RETURN EXISTS (SELECT 1 FROM journey_map_cards card
      JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
      JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE card.id=requested_id AND card.space_id=requested_space AND definition.status<>'archived');
  ELSIF requested_type='persona' THEN
    RETURN EXISTS (SELECT 1 FROM journey_personas
      WHERE id=requested_id AND space_id=requested_space AND lifecycle_state<>'retired');
  ELSIF requested_type='portfolio_item' THEN
    RETURN EXISTS (SELECT 1 FROM journey_portfolio_items
      WHERE id=requested_id AND space_id=requested_space AND state='active');
  ELSIF requested_type='recommendation' THEN
    RETURN EXISTS (SELECT 1 FROM journey_map_cards card
      JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
      JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE card.id=requested_id AND card.space_id=requested_space
        AND card.kind IN ('opportunity','solution','initiative') AND definition.status<>'archived');
  END IF;
  RETURN FALSE;
END
$journey_collaboration_target_exists$;

-- Write-time tenancy for actor columns whose value is durable attribution.
-- TG_ARGV[0] names the actor column; to_jsonb(NEW) reads it without dynamic SQL.
-- The FOR SHARE lock is what makes this an invariant rather than advice: under
-- READ COMMITTED a bare EXISTS could be satisfied by a membership row that a
-- concurrent transaction is already deleting, so the write and the offboarding
-- would both commit. Holding a share lock on that row until commit forces the
-- concurrent DELETE to wait, so this check decides against a settled row.
-- What that buys is membership at the instant of the write, not membership
-- forever: once this transaction commits the waiting DELETE proceeds and
-- SUCCEEDS. That is the intended shape. Attribution here is users(id) ON DELETE
-- NO ACTION, so offboarding leaves the history intact instead of being refused
-- by it, and the four surviving membership edges all cascade. (An earlier
-- revision of this comment claimed the DELETE then fails its own restrict or
-- cascade evaluation. That described the composite membership foreign keys this
-- migration used to declare on the attribution columns, and stopped being true
-- when they were replaced by this guard.)
CREATE OR REPLACE FUNCTION journey_collaboration_membership_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_collaboration_membership_guard$
DECLARE actor TEXT;
BEGIN
  actor := to_jsonb(NEW) ->> TG_ARGV[0];
  IF actor IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM space_memberships
    WHERE space_id=NEW.space_id AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey collaboration actor % is not a member of space %', actor, NEW.space_id
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_collaboration_membership_guard$;
CREATE TRIGGER journey_comments_author_membership_guard
BEFORE INSERT OR UPDATE OF space_id,author_user_id ON journey_comments
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard('author_user_id');
CREATE TRIGGER journey_comment_versions_editor_membership_guard
BEFORE INSERT OR UPDATE OF space_id,editor_user_id ON journey_comment_versions
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard('editor_user_id');
CREATE TRIGGER journey_governance_reviews_requester_membership_guard
BEFORE INSERT OR UPDATE OF space_id,requested_by_user_id ON journey_governance_reviews
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard('requested_by_user_id');
CREATE TRIGGER journey_collaboration_views_owner_membership_guard
BEFORE INSERT OR UPDATE OF space_id,owner_user_id ON journey_collaboration_views
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard('owner_user_id');
CREATE TRIGGER journey_read_only_shares_creator_membership_guard
BEFORE INSERT OR UPDATE OF space_id,created_by_user_id ON journey_read_only_shares
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard('created_by_user_id');

CREATE OR REPLACE FUNCTION journey_collaboration_target_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_collaboration_target_guard$
BEGIN
  IF NOT journey_collaboration_target_exists(NEW.space_id,NEW.target_type,NEW.target_id) THEN
    RAISE EXCEPTION 'Journey collaboration target is outside the tenant or unavailable' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_collaboration_target_guard$;
CREATE TRIGGER journey_comments_target_guard
BEFORE INSERT OR UPDATE OF space_id,target_type,target_id ON journey_comments
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_target_guard();
CREATE TRIGGER journey_watchers_target_guard
BEFORE INSERT OR UPDATE OF space_id,target_type,target_id ON journey_collaboration_watchers
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_target_guard();
CREATE TRIGGER journey_governance_reviews_target_guard
BEFORE INSERT OR UPDATE OF space_id,target_type,target_id ON journey_governance_reviews
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_target_guard();

CREATE OR REPLACE FUNCTION journey_comment_thread_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_comment_thread_guard$
DECLARE parent_row journey_comments%ROWTYPE;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN
    IF NEW.root_comment_id<>NEW.id THEN
      RAISE EXCEPTION 'Root comments must reference themselves' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO parent_row FROM journey_comments
    WHERE id=NEW.parent_comment_id AND space_id=NEW.space_id;
  IF NOT FOUND OR parent_row.parent_comment_id IS NOT NULL
    OR parent_row.target_type<>NEW.target_type OR parent_row.target_id<>NEW.target_id
    OR parent_row.root_comment_id<>NEW.root_comment_id OR parent_row.state='deleted' THEN
    RAISE EXCEPTION 'Replies require an active root comment on the same target' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_comment_thread_guard$;
CREATE TRIGGER journey_comment_thread_guard
BEFORE INSERT OR UPDATE OF parent_comment_id,root_comment_id,target_type,target_id ON journey_comments
FOR EACH ROW EXECUTE FUNCTION journey_comment_thread_guard();

CREATE OR REPLACE FUNCTION journey_collaboration_view_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_collaboration_view_guard$
BEGIN
  IF NEW.resource_type='journey_map' AND NOT EXISTS (
      SELECT 1 FROM journey_definitions WHERE id=NEW.resource_id AND space_id=NEW.space_id AND status<>'archived') THEN
    RAISE EXCEPTION 'Collaboration view journey is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.resource_type='portfolio' AND NEW.resource_id<>NEW.space_id THEN
    RAISE EXCEPTION 'Portfolio collaboration views must be space scoped' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_collaboration_view_guard$;
CREATE TRIGGER journey_collaboration_view_guard
BEFORE INSERT OR UPDATE OF space_id,resource_type,resource_id ON journey_collaboration_views
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_view_guard();

CREATE OR REPLACE FUNCTION journey_share_target_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_share_target_guard$
BEGIN
  IF NEW.target_type='journey_map' AND NOT journey_collaboration_target_exists(
      NEW.space_id,'journey_map',NEW.target_id) THEN
    RAISE EXCEPTION 'Share journey is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.target_type='persona' AND NOT journey_collaboration_target_exists(
      NEW.space_id,'persona',NEW.target_id) THEN
    RAISE EXCEPTION 'Share persona is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.target_type='portfolio' AND NEW.target_id<>NEW.space_id THEN
    RAISE EXCEPTION 'Portfolio shares must be space scoped' USING ERRCODE='23514';
  ELSIF NEW.target_type='collaboration_view' AND NOT EXISTS (
      SELECT 1 FROM journey_collaboration_views
        WHERE id=NEW.target_id AND space_id=NEW.space_id AND state='active') THEN
    RAISE EXCEPTION 'Share view is outside the tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_share_target_guard$;
CREATE TRIGGER journey_share_target_guard
BEFORE INSERT OR UPDATE OF space_id,target_type,target_id ON journey_read_only_shares
FOR EACH ROW EXECUTE FUNCTION journey_share_target_guard();

CREATE OR REPLACE FUNCTION journey_collaboration_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_collaboration_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey collaboration history is append-only' USING ERRCODE='55000';
END
$journey_collaboration_append_only_guard$;
-- Two classes of sealed table, and the difference is load-bearing.
--
-- Content sealed against rewriting but still reachable by its parent's cascade
-- and by a retention sweep uses BEFORE UPDATE, matching
-- journey_portfolio_item_versions in runtime-27 and the sealed blueprint content
-- tables in runtime-29. Every table below is the child of a declared cascade:
-- comment versions from journey_comments (which cascades from
-- journey_definitions and is purged by journey_comments_retention), role events
-- from role assignments, review events and publications from governance reviews,
-- notifications from space_memberships/comments/reviews, and state events from
-- notifications. Under OR DELETE each of those cascades issued a DELETE the
-- guard refused, so deleting a journey, removing a member, or sweeping an
-- expired comment failed with 55000 and the declared cascade was dead DDL.
CREATE TRIGGER journey_collaboration_role_events_append_only
BEFORE UPDATE ON journey_collaboration_role_events
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_comment_versions_append_only
BEFORE UPDATE ON journey_comment_versions
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_governance_review_events_append_only
BEFORE UPDATE ON journey_governance_review_events
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_governance_publications_append_only
BEFORE UPDATE ON journey_governance_publications
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_collaboration_notifications_append_only
BEFORE UPDATE ON journey_collaboration_notifications
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_collaboration_notification_state_events_append_only
BEFORE UPDATE ON journey_collaboration_notification_state_events
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
-- The space-scoped ledgers below stay sealed against DELETE as well. None of
-- them is the child of any cascade except spaces, and each records a fact that
-- must outlive its subject: deleting an operations row lets an idempotency key
-- replay to a different result, and deleting an activity, audit or share-access
-- row erases the trail those tables exist to keep.
CREATE TRIGGER journey_share_access_events_append_only
BEFORE UPDATE OR DELETE ON journey_share_access_events
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_collaboration_operations_append_only
BEFORE UPDATE OR DELETE ON journey_collaboration_operations
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_collaboration_activity_append_only
BEFORE UPDATE OR DELETE ON journey_collaboration_activity
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();
CREATE TRIGGER journey_collaboration_audit_append_only
BEFORE UPDATE OR DELETE ON journey_collaboration_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_collaboration_append_only_guard();

-- No experience_runtime_schema_version row is written here. The migration runner
-- owns that table and stamps it itself, inside the same transaction, with a
-- checksum column this file cannot supply -- a migration cannot know its own
-- sha256 (scripts/upgrade-postgres-schema.mjs). A self-stamp would abort the
-- whole file on its last statement with SQLSTATE 23502, and no migration from
-- 0002 to 0026 writes one.
