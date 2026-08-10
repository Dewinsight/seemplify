-- Runtime schema 55: private, revisioned hierarchy and service-blueprint saved views.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>54 THEN
    RAISE EXCEPTION 'runtime-55 journey workspace saved views require runtime-54' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_workspace_view_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  state TEXT NOT NULL CHECK(state IN ('active','retired')),
  current_version_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  UNIQUE(id,space_id),
  FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CHECK(updated_at>=created_at),
  CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX journey_workspace_view_active_name
  ON journey_workspace_view_definitions(space_id,owner_user_id,surface,LOWER(name)) WHERE state='active';
CREATE INDEX journey_workspace_view_owner
  ON journey_workspace_view_definitions(space_id,owner_user_id,surface,state,updated_at DESC,id);

CREATE TABLE journey_workspace_view_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  view_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  configuration_json TEXT NOT NULL,
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(id,view_id,space_id),
  UNIQUE(view_id,space_id,version_number),
  FOREIGN KEY(view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id) ON DELETE CASCADE,
  CHECK(octet_length(configuration_json) BETWEEN 2 AND 16384 AND jsonb_typeof(configuration_json::jsonb)='object')
);
ALTER TABLE journey_workspace_view_definitions ADD CONSTRAINT journey_workspace_view_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_workspace_view_versions(id,view_id,space_id) ON DELETE NO ACTION;

CREATE TABLE journey_workspace_view_preferences (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  default_view_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,user_id,surface),
  FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(default_view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id)
    ON DELETE SET NULL (default_view_id)
);

CREATE TABLE journey_workspace_view_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key_sha256 TEXT NOT NULL CHECK(idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  operation TEXT NOT NULL CHECK(operation IN ('create','revise','retire','set_default')),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  result_json TEXT NOT NULL,
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,actor_user_id,idempotency_key_sha256),
  FOREIGN KEY(space_id,actor_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CHECK(octet_length(result_json) BETWEEN 2 AND 4096 AND jsonb_typeof(result_json::jsonb)='object')
);

CREATE TABLE journey_workspace_view_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  view_id TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK(event IN ('created','revised','retired','default_changed')),
  detail_json TEXT NOT NULL,
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  FOREIGN KEY(view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id) ON DELETE CASCADE,
  CHECK(octet_length(detail_json) BETWEEN 2 AND 4096 AND jsonb_typeof(detail_json::jsonb)='object')
);
CREATE INDEX journey_workspace_view_audit_history
  ON journey_workspace_view_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_workspace_view_history_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'runtime55 workspace view history is append-only' USING ERRCODE='55000';
END $guard$;
CREATE TRIGGER journey_workspace_view_versions_guard BEFORE UPDATE OR DELETE ON journey_workspace_view_versions
  FOR EACH ROW EXECUTE FUNCTION journey_workspace_view_history_guard();
CREATE TRIGGER journey_workspace_view_operations_guard BEFORE UPDATE OR DELETE ON journey_workspace_view_operations
  FOR EACH ROW EXECUTE FUNCTION journey_workspace_view_history_guard();
CREATE TRIGGER journey_workspace_view_audit_guard BEFORE UPDATE OR DELETE ON journey_workspace_view_audit_events
  FOR EACH ROW EXECUTE FUNCTION journey_workspace_view_history_guard();

CREATE OR REPLACE FUNCTION journey_workspace_view_preference_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF NEW.default_view_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM journey_workspace_view_definitions view
    WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id
      AND view.owner_user_id=NEW.user_id AND view.surface=NEW.surface AND view.state='active'
  ) THEN
    RAISE EXCEPTION 'default workspace view must be an active user-owned view for the same surface' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_workspace_view_preference_guard BEFORE INSERT OR UPDATE ON journey_workspace_view_preferences
  FOR EACH ROW EXECUTE FUNCTION journey_workspace_view_preference_guard();

REVOKE UPDATE,DELETE ON journey_workspace_view_versions,journey_workspace_view_operations,
  journey_workspace_view_audit_events FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION journey_workspace_view_history_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION journey_workspace_view_preference_guard() FROM PUBLIC;
