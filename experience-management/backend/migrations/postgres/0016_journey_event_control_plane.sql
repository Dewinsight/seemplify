-- Runtime schema 16: tenant-scoped connected-journey event control plane.
--
-- Credentials are write-only capabilities. Only a salted scrypt digest and a
-- short display prefix are persisted; plaintext exists only in the successful
-- issuance response. Tracking-plan version content is immutable after insert,
-- while its explicit lifecycle fields may advance through the guarded state
-- machine. The control-plane audit ledger is append-only to the runtime role.

CREATE TABLE IF NOT EXISTS journey_event_sources (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
  validation_mode TEXT NOT NULL DEFAULT 'warn' CHECK(validation_mode IN ('observe','warn','enforce')),
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  allowed_bundle_ids_json TEXT NOT NULL DEFAULT '[]',
  events_per_minute BIGINT NOT NULL CHECK(events_per_minute BETWEEN 1 AND 10000000),
  bytes_per_minute BIGINT NOT NULL CHECK(bytes_per_minute BETWEEN 1 AND 10000000000),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_hash TEXT CHECK(intent_hash IS NULL OR intent_hash ~ '^[a-f0-9]{64}$'),
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
  source_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  kind TEXT NOT NULL CHECK(kind IN ('public_write','server_secret')),
  scope TEXT NOT NULL DEFAULT 'events:write' CHECK(scope='events:write'),
  display_prefix TEXT NOT NULL CHECK(length(display_prefix) BETWEEN 8 AND 160),
  algorithm TEXT NOT NULL DEFAULT 'scrypt-v1' CHECK(algorithm='scrypt-v1'),
  salt TEXT NOT NULL CHECK(length(salt) BETWEEN 16 AND 200),
  digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','overlap','revoked')),
  rotated_from_id TEXT REFERENCES journey_event_credentials(id) ON DELETE SET NULL,
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_hash TEXT CHECK(intent_hash IS NULL OR intent_hash ~ '^[a-f0-9]{64}$'),
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
CREATE INDEX IF NOT EXISTS journey_event_credentials_source_history
  ON journey_event_credentials(source_id,created_at DESC,id);

CREATE TABLE IF NOT EXISTS journey_event_schemas (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 128),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_hash TEXT CHECK(intent_hash IS NULL OR intent_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schemas_source_event
  ON journey_event_schemas(source_id,event_name);
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schemas_idempotency
  ON journey_event_schemas(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schemas_tenant_source_identity
  ON journey_event_schemas(id,source_id,space_id);
CREATE INDEX IF NOT EXISTS journey_event_schemas_space_history
  ON journey_event_schemas(space_id,updated_at DESC,id);

CREATE TABLE IF NOT EXISTS journey_event_schema_versions (
  id TEXT PRIMARY KEY,
  schema_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version TEXT NOT NULL CHECK(version ~ '^[0-9]+\.[0-9]+$'),
  version_major INTEGER NOT NULL CHECK(version_major >= 0),
  version_minor INTEGER NOT NULL CHECK(version_minor >= 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','deprecated','retired')),
  properties_json TEXT NOT NULL DEFAULT '[]',
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_hash TEXT CHECK(intent_hash IS NULL OR intent_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deprecated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  deprecated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_number
  ON journey_event_schema_versions(schema_id,version_major,version_minor);
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_one_published
  ON journey_event_schema_versions(schema_id) WHERE state='published';
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_idempotency
  ON journey_event_schema_versions(space_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS journey_event_schema_versions_history
  ON journey_event_schema_versions(schema_id,version_major DESC,version_minor DESC,id);

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
  before_fingerprint TEXT CHECK(before_fingerprint IS NULL OR before_fingerprint ~ '^[a-f0-9]{64}$'),
  after_fingerprint TEXT CHECK(after_fingerprint IS NULL OR after_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journey_event_control_audit_space
  ON journey_event_control_audit_events(space_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS journey_event_control_audit_source
  ON journey_event_control_audit_events(source_id,created_at DESC,id);

-- A current SQLite cutover can already contain the five tables above. Add the
-- PostgreSQL-only invariants explicitly so CREATE TABLE IF NOT EXISTS never
-- weakens a runtime-16 cutover merely because the source table already exists.
ALTER TABLE journey_event_sources
  ADD CONSTRAINT journey_event_sources_id_bound CHECK(length(id) BETWEEN 1 AND 128),
  ADD CONSTRAINT journey_event_sources_name_canonical CHECK(name=btrim(name)),
  ADD CONSTRAINT journey_event_sources_origins_json CHECK(
    octet_length(allowed_origins_json)<=65536 AND jsonb_typeof(allowed_origins_json::jsonb)='array'),
  ADD CONSTRAINT journey_event_sources_bundles_json CHECK(
    octet_length(allowed_bundle_ids_json)<=65536 AND jsonb_typeof(allowed_bundle_ids_json::jsonb)='array');

ALTER TABLE journey_event_credentials
  ADD CONSTRAINT journey_event_credentials_id_bound CHECK(length(id) BETWEEN 1 AND 128),
  ADD CONSTRAINT journey_event_credentials_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  ADD CONSTRAINT journey_event_credentials_rotation_not_self CHECK(rotated_from_id IS NULL OR rotated_from_id<>id),
  ADD CONSTRAINT journey_event_credentials_revocation_shape CHECK(
    (status='revoked' AND revoked_at IS NOT NULL)
    OR (status IN ('active','overlap') AND revoked_at IS NULL)),
  ADD CONSTRAINT journey_event_credentials_overlap_expiry CHECK(status<>'overlap' OR expires_at IS NOT NULL);

ALTER TABLE journey_event_schemas
  ADD CONSTRAINT journey_event_schemas_id_bound CHECK(length(id) BETWEEN 1 AND 128),
  ADD CONSTRAINT journey_event_schemas_event_name_canonical CHECK(event_name ~ '^[a-z][a-z0-9_]{0,127}$'),
  ADD CONSTRAINT journey_event_schemas_source_tenant_fk
    FOREIGN KEY(source_id,space_id)
    REFERENCES journey_event_sources(id,space_id) ON DELETE CASCADE;

ALTER TABLE journey_event_schema_versions
  ADD CONSTRAINT journey_event_schema_versions_id_bound CHECK(length(id) BETWEEN 1 AND 128),
  ADD CONSTRAINT journey_event_schema_versions_schema_tenant_source_fk
    FOREIGN KEY(schema_id,source_id,space_id)
    REFERENCES journey_event_schemas(id,source_id,space_id) ON DELETE CASCADE,
  ADD CONSTRAINT journey_event_schema_versions_number_consistent CHECK(
    version=(version_major::text || '.' || version_minor::text)),
  ADD CONSTRAINT journey_event_schema_versions_properties_json CHECK(
    octet_length(properties_json)<=1048576 AND jsonb_typeof(properties_json::jsonb)='array'),
  ADD CONSTRAINT journey_event_schema_versions_compatibility_json CHECK(
    octet_length(compatibility_json)<=262144 AND jsonb_typeof(compatibility_json::jsonb)='object'),
  ADD CONSTRAINT journey_event_schema_versions_lifecycle_shape CHECK(
    (state='draft' AND published_at IS NULL AND deprecated_at IS NULL)
    OR (state='published' AND published_at IS NOT NULL AND deprecated_at IS NULL)
    OR (state IN ('deprecated','retired') AND published_at IS NOT NULL AND deprecated_at IS NOT NULL));

ALTER TABLE journey_event_control_audit_events
  ADD CONSTRAINT journey_event_control_audit_target_bound CHECK(length(target_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT journey_event_control_audit_detail_json CHECK(
    octet_length(detail_json)<=262144 AND jsonb_typeof(detail_json::jsonb)='object');

CREATE OR REPLACE FUNCTION journey_event_credential_rotation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $journey_event_credential_rotation_guard$
DECLARE previous_source_id TEXT;
DECLARE previous_space_id TEXT;
DECLARE previous_environment TEXT;
DECLARE previous_kind TEXT;
BEGIN
  IF NEW.rotated_from_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT source_id,space_id,environment,kind
    INTO previous_source_id,previous_space_id,previous_environment,previous_kind
    FROM journey_event_credentials WHERE id=NEW.rotated_from_id;
  IF NOT FOUND OR ROW(previous_source_id,previous_space_id,previous_environment,previous_kind)
      IS DISTINCT FROM ROW(NEW.source_id,NEW.space_id,NEW.environment,NEW.kind) THEN
    RAISE EXCEPTION 'rotated credential must belong to the same source, tenant, environment, and kind'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_event_credential_rotation_guard$;

CREATE TRIGGER journey_event_credential_rotation_guard_trigger
BEFORE INSERT OR UPDATE OF rotated_from_id,source_id,space_id,environment,kind
ON journey_event_credentials
FOR EACH ROW EXECUTE FUNCTION journey_event_credential_rotation_guard();

CREATE OR REPLACE FUNCTION journey_event_schema_version_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $journey_event_schema_version_immutable_guard$
BEGIN
  IF ROW(OLD.schema_id,OLD.source_id,OLD.space_id,OLD.version,OLD.version_major,OLD.version_minor,
      OLD.properties_json,OLD.content_sha256,OLD.idempotency_key,OLD.intent_hash,OLD.created_at)
    IS DISTINCT FROM
    ROW(NEW.schema_id,NEW.source_id,NEW.space_id,NEW.version,NEW.version_major,NEW.version_minor,
      NEW.properties_json,NEW.content_sha256,NEW.idempotency_key,NEW.intent_hash,NEW.created_at) THEN
    RAISE EXCEPTION 'journey event schema version content is immutable after insert'
      USING ERRCODE='55000';
  END IF;
  IF OLD.state<>NEW.state AND NOT (
    (OLD.state='draft' AND NEW.state='published')
    OR (OLD.state='published' AND NEW.state='deprecated')
    OR (OLD.state='deprecated' AND NEW.state='retired')) THEN
    RAISE EXCEPTION 'invalid journey event schema version lifecycle transition: % -> %',OLD.state,NEW.state
      USING ERRCODE='23514';
  END IF;

  -- Compatibility is derived from the immutable tracking-plan content at the
  -- publication boundary. It may be written exactly on draft -> published,
  -- but must remain immutable before and after that transition.
  IF OLD.compatibility_json IS DISTINCT FROM NEW.compatibility_json
      AND NOT (OLD.state='draft' AND NEW.state='published') THEN
    RAISE EXCEPTION 'compatibility_json may change only while publishing a draft schema version'
      USING ERRCODE='55000';
  END IF;
  IF OLD.state='draft' AND NEW.state='published' THEN
    IF OLD.published_by_user_id IS NOT NULL OR OLD.published_at IS NOT NULL
        OR NEW.published_by_user_id IS NULL OR NEW.published_at IS NULL
        OR OLD.compatibility_json IS NOT DISTINCT FROM NEW.compatibility_json
        OR jsonb_typeof(NEW.compatibility_json::jsonb->'compatible')<>'boolean'
        OR jsonb_typeof(NEW.compatibility_json::jsonb->'issues')<>'array' THEN
      RAISE EXCEPTION 'publication attribution and compatibility must be set exactly on draft publication'
        USING ERRCODE='55000';
    END IF;
  ELSIF OLD.published_by_user_id IS DISTINCT FROM NEW.published_by_user_id
      OR OLD.published_at IS DISTINCT FROM NEW.published_at THEN
    RAISE EXCEPTION 'publication attribution is immutable outside draft publication'
      USING ERRCODE='55000';
  END IF;

  IF OLD.state='published' AND NEW.state='deprecated' THEN
    IF OLD.deprecated_by_user_id IS NOT NULL OR OLD.deprecated_at IS NOT NULL
        OR NEW.deprecated_by_user_id IS NULL OR NEW.deprecated_at IS NULL THEN
      RAISE EXCEPTION 'deprecation attribution must be set exactly on published deprecation'
        USING ERRCODE='55000';
    END IF;
  ELSIF OLD.deprecated_by_user_id IS DISTINCT FROM NEW.deprecated_by_user_id
      OR OLD.deprecated_at IS DISTINCT FROM NEW.deprecated_at THEN
    RAISE EXCEPTION 'deprecation attribution is immutable outside published deprecation'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$journey_event_schema_version_immutable_guard$;

CREATE TRIGGER journey_event_schema_version_immutable_guard_trigger
BEFORE UPDATE ON journey_event_schema_versions
FOR EACH ROW EXECUTE FUNCTION journey_event_schema_version_immutable_guard();

CREATE OR REPLACE FUNCTION journey_event_control_audit_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $journey_event_control_audit_tenant_guard$
DECLARE source_space_id TEXT;
BEGIN
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT space_id INTO source_space_id FROM journey_event_sources WHERE id=NEW.source_id;
  IF NOT FOUND OR source_space_id<>NEW.space_id THEN
    RAISE EXCEPTION 'journey event control audit source must belong to the audit tenant'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_event_control_audit_tenant_guard$;

CREATE TRIGGER journey_event_control_audit_tenant_guard_trigger
BEFORE INSERT OR UPDATE OF source_id,space_id
ON journey_event_control_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_event_control_audit_tenant_guard();
