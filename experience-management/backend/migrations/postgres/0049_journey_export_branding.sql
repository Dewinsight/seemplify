-- Runtime schema 49: tenant-governed, version-pinned Journey export branding.
-- Brand assets reuse authenticated protected uploads. Raw storage paths never
-- enter this schema or an API response; every render revalidates the pinned
-- byte count and SHA-256 before using a logo.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>48 THEN
    RAISE EXCEPTION 'runtime-49 Journey export branding requires runtime-48' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_export_upload_tenant_identity ON uploads(id,space_id);

CREATE TABLE journey_export_brand_assets (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_upload_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
  byte_size BIGINT NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 4096),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  alt_text TEXT NOT NULL CHECK(length(alt_text) BETWEEN 1 AND 300),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,retention_expires_at TIMESTAMPTZ,
  UNIQUE(id,space_id),UNIQUE(space_id,source_upload_id),UNIQUE(space_id,content_sha256),
  FOREIGN KEY(source_upload_id,space_id) REFERENCES uploads(id,space_id) ON DELETE RESTRICT,
  CHECK(updated_at>=created_at),
  CHECK((state='active' AND retired_at IS NULL AND retention_expires_at IS NULL)
    OR (state='retired' AND retired_at IS NOT NULL AND retention_expires_at>=retired_at))
);
CREATE INDEX journey_export_brand_assets_scope ON journey_export_brand_assets(space_id,state,updated_at DESC,id);
CREATE INDEX journey_export_brand_assets_retention ON journey_export_brand_assets(retention_expires_at,id)
  WHERE state='retired';

CREATE TABLE journey_export_brand_profiles (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  current_version INTEGER NOT NULL CHECK(current_version>0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,retention_expires_at TIMESTAMPTZ,
  UNIQUE(id,space_id),UNIQUE(id,space_id,current_version),
  CHECK(updated_at>=created_at),
  CHECK((state='active' AND retired_at IS NULL AND retention_expires_at IS NULL)
    OR (state='retired' AND retired_at IS NOT NULL AND retention_expires_at>=retired_at))
);
CREATE UNIQUE INDEX journey_export_brand_profiles_active_name
  ON journey_export_brand_profiles(space_id,lower(name)) WHERE state='active';
CREATE INDEX journey_export_brand_profiles_scope ON journey_export_brand_profiles(space_id,state,updated_at DESC,id);

CREATE TABLE journey_export_brand_profile_versions (
  profile_id TEXT NOT NULL,space_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
  organisation_name TEXT NOT NULL CHECK(length(organisation_name) BETWEEN 1 AND 160),
  logo_asset_id TEXT,
  primary_hex TEXT NOT NULL CHECK(primary_hex ~ '^#[0-9A-Fa-f]{6}$'),
  accent_hex TEXT NOT NULL CHECK(accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  background_hex TEXT NOT NULL CHECK(background_hex ~ '^#[0-9A-Fa-f]{6}$'),
  text_hex TEXT NOT NULL CHECK(text_hex ~ '^#[0-9A-Fa-f]{6}$'),
  font_family TEXT NOT NULL CHECK(font_family IN ('Aptos','Arial','Helvetica','Noto Sans')),
  footer_text TEXT NOT NULL DEFAULT '' CHECK(length(footer_text)<=300),
  locale TEXT NOT NULL DEFAULT 'en-GB' CHECK(locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(profile_id,space_id,version),UNIQUE(profile_id,version),
  FOREIGN KEY(profile_id,space_id) REFERENCES journey_export_brand_profiles(id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(logo_asset_id,space_id) REFERENCES journey_export_brand_assets(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_export_brand_versions_history
  ON journey_export_brand_profile_versions(space_id,profile_id,version DESC);

ALTER TABLE journey_export_brand_profiles ADD CONSTRAINT journey_export_brand_current_version_fk
  FOREIGN KEY(id,space_id,current_version)
  REFERENCES journey_export_brand_profile_versions(profile_id,space_id,version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_export_brand_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  default_profile_id TEXT,default_profile_version INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(default_profile_id,space_id,default_profile_version)
    REFERENCES journey_export_brand_profile_versions(profile_id,space_id,version) ON DELETE RESTRICT,
  CHECK((default_profile_id IS NULL AND default_profile_version IS NULL)
    OR (default_profile_id IS NOT NULL AND default_profile_version IS NOT NULL)),
  CHECK(updated_at>=created_at)
);

CREATE TABLE journey_saved_view_brand_bindings (
  view_id TEXT NOT NULL,space_id TEXT NOT NULL,
  brand_policy TEXT NOT NULL CHECK(brand_policy IN ('space_default','pinned')),
  profile_id TEXT,profile_version INTEGER,view_revision INTEGER NOT NULL CHECK(view_revision>0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(view_id,space_id),
  FOREIGN KEY(view_id,space_id) REFERENCES journey_saved_views(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id,space_id,profile_version)
    REFERENCES journey_export_brand_profile_versions(profile_id,space_id,version) ON DELETE RESTRICT,
  CHECK((brand_policy='space_default' AND profile_id IS NULL AND profile_version IS NULL)
    OR (brand_policy='pinned' AND profile_id IS NOT NULL AND profile_version IS NOT NULL))
);
CREATE INDEX journey_saved_view_brand_profile
  ON journey_saved_view_brand_bindings(space_id,profile_id,profile_version,view_id);

CREATE TABLE journey_export_brand_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(action IN ('asset.create','asset.retire','profile.create','profile.version','profile.retire','default.set','default.reset','view.bind')),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json JSONB NOT NULL CHECK(jsonb_typeof(response_json)='object' AND octet_length(response_json::text)<=32768),
  created_at TIMESTAMPTZ NOT NULL,UNIQUE(space_id,actor_user_id,idempotency_key)
);

CREATE TABLE journey_export_brand_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('asset.created','asset.retired','profile.created','profile.versioned','profile.retired','default.set','default.reset','view.bound','export.rendered','asset.purge_completed')),
  target_type TEXT NOT NULL CHECK(target_type IN ('asset','profile','settings','saved_view','export')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER CHECK(target_revision IS NULL OR target_revision>0),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX journey_export_brand_audit_history
  ON journey_export_brand_audit_events(space_id,created_at DESC,id);

CREATE TABLE journey_export_brand_asset_purge_queue (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,source_upload_id TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL CHECK(expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size BIGINT NOT NULL CHECK(expected_byte_size BETWEEN 1 AND 5242880),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retry','completed','cancelled')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  lease_token_sha256 TEXT CHECK(lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  lease_expires_at TIMESTAMPTZ,next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error_sha256 TEXT CHECK(last_error_sha256 IS NULL OR last_error_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ,
  UNIQUE(space_id,asset_id),CHECK(updated_at>=created_at),
  CHECK((state='leased' AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('pending','retry') AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL)
    OR (state IN ('completed','cancelled') AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL))
);
CREATE INDEX journey_export_brand_asset_purge_due
  ON journey_export_brand_asset_purge_queue(state,next_attempt_at,id) WHERE state IN ('pending','retry');

CREATE OR REPLACE FUNCTION journey_export_brand_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN RAISE EXCEPTION 'Journey export brand history is append-only' USING ERRCODE='55000'; END $guard$;
CREATE TRIGGER journey_export_brand_versions_immutable BEFORE UPDATE OR DELETE ON journey_export_brand_profile_versions
  FOR EACH ROW EXECUTE FUNCTION journey_export_brand_append_only_guard();
CREATE TRIGGER journey_export_brand_operations_immutable BEFORE UPDATE OR DELETE ON journey_export_brand_operations
  FOR EACH ROW EXECUTE FUNCTION journey_export_brand_append_only_guard();
CREATE TRIGGER journey_export_brand_audit_immutable BEFORE UPDATE OR DELETE ON journey_export_brand_audit_events
  FOR EACH ROW EXECUTE FUNCTION journey_export_brand_append_only_guard();
REVOKE EXECUTE ON FUNCTION journey_export_brand_append_only_guard() FROM PUBLIC;
REVOKE UPDATE,DELETE ON journey_export_brand_profile_versions,journey_export_brand_operations,journey_export_brand_audit_events FROM PUBLIC;
