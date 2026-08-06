-- Runtime schema 26: governed Journey Map saved views and exact-view exports.
--
-- A saved view is presentation state, never source-of-truth journey data. The
-- bounded checksummed configuration stores stable ordered filters while every
-- durable identity remains tenant-bound and is re-authorised on each read.

DO $journey_saved_view_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>25 THEN
    RAISE EXCEPTION 'runtime-26 journey saved views require the checksummed runtime-25 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_saved_view_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_saved_views_definition_tenant_identity
  ON journey_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_saved_views_version_tenant_identity
  ON journey_map_versions(id,definition_id,space_id);

CREATE TABLE journey_saved_view_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 3650),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_saved_view_settings_time_order CHECK(updated_at>=created_at)
);

CREATE TABLE journey_saved_views (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  visibility TEXT NOT NULL CHECK(visibility IN ('private','space')),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  binding_policy TEXT NOT NULL CHECK(binding_policy IN ('exact','follows_current')),
  bound_version_id TEXT,
  comparison_definition_id TEXT,
  comparison_version_id TEXT,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  config_json TEXT NOT NULL CHECK(octet_length(config_json) BETWEEN 2 AND 32768),
  config_sha256 TEXT NOT NULL CHECK(config_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  CONSTRAINT journey_saved_views_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_saved_views_definition_identity UNIQUE(id,definition_id,space_id),
  CONSTRAINT journey_saved_views_idempotency UNIQUE(space_id,owner_user_id,idempotency_key),
  CONSTRAINT journey_saved_views_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_saved_views_owner_membership_fk FOREIGN KEY(space_id,owner_user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT journey_saved_views_bound_version_tenant_fk FOREIGN KEY(bound_version_id,definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_saved_views_comparison_definition_tenant_fk FOREIGN KEY(comparison_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_saved_views_comparison_version_tenant_fk
    FOREIGN KEY(comparison_version_id,comparison_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_saved_views_binding_shape CHECK(
    (binding_policy='exact' AND bound_version_id IS NOT NULL)
    OR (binding_policy='follows_current' AND bound_version_id IS NULL)),
  CONSTRAINT journey_saved_views_comparison_shape CHECK(
    (comparison_definition_id IS NULL AND comparison_version_id IS NULL)
    OR (comparison_definition_id IS NOT NULL AND comparison_version_id IS NOT NULL)),
  CONSTRAINT journey_saved_views_lifecycle_shape CHECK(
    (state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
      AND retention_expires_at>=deleted_at)),
  CONSTRAINT journey_saved_views_time_order CHECK(updated_at>=created_at),
  CONSTRAINT journey_saved_views_config_json CHECK(
    jsonb_typeof(config_json::jsonb)='object'
    AND (config_json::jsonb->>'schemaVersion')::integer=1)
);
CREATE INDEX journey_saved_views_definition
  ON journey_saved_views(space_id,definition_id,state,visibility,updated_at DESC,id);
CREATE INDEX journey_saved_views_owner
  ON journey_saved_views(space_id,owner_user_id,state,updated_at DESC,id);
CREATE INDEX journey_saved_views_retention
  ON journey_saved_views(retention_expires_at,id) WHERE state='deleted';

-- Stable ordered references make configuration review and drift probes
-- possible without interpreting JSON. Reference targets remain polymorphic,
-- so the service re-authorises each one against its authoritative table.
CREATE TABLE journey_saved_view_references (
  view_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'persona','segment','cohort','channel','evidence_link','evidence_state','card_kind','lane')),
  reference_value TEXT NOT NULL CHECK(length(reference_value) BETWEEN 1 AND 256),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  PRIMARY KEY(view_id,kind,ordinal),
  CONSTRAINT journey_saved_view_references_value_once UNIQUE(view_id,kind,reference_value),
  CONSTRAINT journey_saved_view_references_view_tenant_fk FOREIGN KEY(view_id,space_id)
    REFERENCES journey_saved_views(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_saved_view_references_lookup
  ON journey_saved_view_references(space_id,kind,reference_value,view_id);

CREATE OR REPLACE FUNCTION journey_saved_view_reference_tenant_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_saved_view_reference_tenant_guard$
BEGIN
  IF NEW.kind='persona' AND NOT EXISTS (
    SELECT 1 FROM journey_personas WHERE id=NEW.reference_value AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Saved-view persona reference is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.kind='segment' AND NOT EXISTS (
    SELECT 1 FROM journey_metric_segments WHERE id=NEW.reference_value AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Saved-view segment reference is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.kind='cohort' THEN
    RAISE EXCEPTION 'Saved-view cohort references require the governed cohort catalogue' USING ERRCODE='23514';
  ELSIF NEW.kind='channel' AND NOT EXISTS (
    SELECT 1 FROM journey_channels WHERE id=NEW.reference_value AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Saved-view channel reference is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.kind='evidence_link' AND NOT EXISTS (
    SELECT 1 FROM journey_evidence_links WHERE id=NEW.reference_value AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Saved-view evidence reference is outside the tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_saved_view_reference_tenant_guard$;
CREATE TRIGGER journey_saved_view_reference_tenant_guard
BEFORE INSERT OR UPDATE ON journey_saved_view_references
FOR EACH ROW EXECUTE FUNCTION journey_saved_view_reference_tenant_guard();

CREATE TABLE journey_saved_view_selections (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  view_id TEXT NOT NULL,
  view_revision INTEGER NOT NULL CHECK(view_revision>0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,user_id,definition_id),
  CONSTRAINT journey_saved_view_selections_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_saved_view_selections_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_saved_view_selections_view_tenant_fk FOREIGN KEY(view_id,definition_id,space_id)
    REFERENCES journey_saved_views(id,definition_id,space_id) ON DELETE CASCADE
);

CREATE TABLE journey_saved_view_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(action IN (
    'view.create','view.update','view.duplicate','view.delete','view.restore',
    'default.select','default.reset','settings.update')),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json TEXT NOT NULL CHECK(octet_length(response_json)<=32768),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_saved_view_operations_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_saved_view_operations_idempotency UNIQUE(space_id,actor_user_id,idempotency_key),
  CONSTRAINT journey_saved_view_operations_response_json CHECK(jsonb_typeof(response_json::jsonb)='object')
);

CREATE TABLE journey_saved_view_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'view.created','view.updated','view.duplicated','view.deleted','view.restored','view.exported',
    'default.selected','default.reset','settings.updated','retention.purged')),
  view_id TEXT,
  definition_id TEXT,
  view_revision INTEGER CHECK(view_revision IS NULL OR view_revision>0),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(octet_length(detail_json)<=8192),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_saved_view_audit_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_saved_view_audit_detail_json CHECK(jsonb_typeof(detail_json::jsonb)='object')
);
CREATE INDEX journey_saved_view_audit_history
  ON journey_saved_view_audit_events(space_id,definition_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_saved_view_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_saved_view_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey saved-view history is append-only' USING ERRCODE='55000';
END
$journey_saved_view_append_only_guard$;
CREATE TRIGGER journey_saved_view_operations_append_only
BEFORE UPDATE OR DELETE ON journey_saved_view_operations
FOR EACH ROW EXECUTE FUNCTION journey_saved_view_append_only_guard();
CREATE TRIGGER journey_saved_view_audit_append_only
BEFORE UPDATE OR DELETE ON journey_saved_view_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_saved_view_append_only_guard();

-- Preserve administrator customisations: only missing keys inherit defaults.
UPDATE platform_subscription_plans SET
  features_json=(features_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeySavedViews":false}'::jsonb
      ELSE '{"journeySavedViews":true}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(features_json::jsonb))
  ))::text,
  limits_json=(limits_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeySavedViews":0}'::jsonb
      WHEN 'team' THEN '{"journeySavedViews":100}'::jsonb
      ELSE '{"journeySavedViews":5000}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');
