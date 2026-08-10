-- Runtime schema 51: provider-neutral connector execution plane.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>50 THEN
    RAISE EXCEPTION 'runtime-51 journey connector execution plane requires runtime-50' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_connector_worker_principals(
  id TEXT PRIMARY KEY,key_id TEXT NOT NULL UNIQUE,
  secret_ref TEXT NOT NULL CHECK(length(secret_ref) BETWEEN 8 AND 507
    AND secret_ref ~ '^(file|env|vault|kms)://[A-Za-z0-9][A-Za-z0-9._/:@-]*$'),
  state TEXT NOT NULL CHECK(state IN ('active','draining','revoked')),
  allowed_space_ids_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_space_ids_json)='array' AND jsonb_array_length(allowed_space_ids_json) BETWEEN 1 AND 100),
  allowed_connector_ids_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_connector_ids_json)='array' AND jsonb_array_length(allowed_connector_ids_json) BETWEEN 1 AND 200),
  allowed_adapters_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_adapters_json)='array' AND jsonb_array_length(allowed_adapters_json) BETWEEN 1 AND 10),
  not_before TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,CHECK(expires_at>not_before),CHECK(updated_at>=created_at));
CREATE INDEX journey_connector_worker_principals_active ON journey_connector_worker_principals(state,not_before,expires_at,key_id);
CREATE TABLE journey_connector_worker_key_events(
  id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES journey_connector_worker_principals(id) ON DELETE NO ACTION,
  key_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('provisioned','draining','revoked')),
  revision INTEGER NOT NULL CHECK(revision>0),created_at TIMESTAMPTZ NOT NULL);
CREATE INDEX journey_connector_worker_key_events_history ON journey_connector_worker_key_events(principal_id,created_at,id);

CREATE TABLE journey_connector_worker_sources(
  id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK(adapter='service_recovery_tickets_v1'),state TEXT NOT NULL CHECK(state IN ('active','paused')),
  survey_ids_json JSONB NOT NULL CHECK(jsonb_typeof(survey_ids_json)='array' AND jsonb_array_length(survey_ids_json) BETWEEN 1 AND 100),
  interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 60 AND 86400),page_size INTEGER NOT NULL CHECK(page_size BETWEEN 1 AND 200),
  phase TEXT NOT NULL DEFAULT 'scan' CHECK(phase IN ('scan','deletion')),snapshot_at TIMESTAMPTZ,cursor_at TIMESTAMPTZ,cursor_id TEXT,
  deletion_cursor_id TEXT,generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),next_run_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10),last_error_code TEXT CHECK(length(last_error_code)<=100),
  lease_token_sha256 TEXT CHECK(lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[a-f0-9]{64}$'),lease_expires_at TIMESTAMPTZ,lease_run_id TEXT,
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK(fencing_token>=0),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,UNIQUE(connector_id,space_id),UNIQUE(id,connector_id,space_id),
  FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(lease_run_id,connector_id,space_id) REFERENCES journey_connector_import_runs(id,connector_id,space_id) ON DELETE NO ACTION,
  CHECK((lease_token_sha256 IS NULL)=(lease_expires_at IS NULL)),CHECK((lease_token_sha256 IS NULL)=(lease_run_id IS NULL)),CHECK(updated_at>=created_at));
CREATE INDEX journey_connector_worker_sources_due ON journey_connector_worker_sources(state,next_run_at,lease_expires_at,id);

CREATE TABLE journey_connector_worker_source_items(
  source_id TEXT NOT NULL,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,source_record_id TEXT NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 128),
  survey_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','tombstoned')),last_seen_generation INTEGER NOT NULL CHECK(last_seen_generation>=0),
  source_revision_sha256 TEXT NOT NULL CHECK(source_revision_sha256 ~ '^[a-f0-9]{64}$'),updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source_id,source_record_id),FOREIGN KEY(source_id,connector_id,space_id)
    REFERENCES journey_connector_worker_sources(id,connector_id,space_id) ON DELETE CASCADE);
CREATE INDEX journey_connector_worker_source_items_sweep ON journey_connector_worker_source_items(source_id,source_record_id);

CREATE TABLE journey_connector_worker_events(
  id TEXT PRIMARY KEY,source_id TEXT NOT NULL,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 100),fencing_token BIGINT,counts_json JSONB NOT NULL CHECK(jsonb_typeof(counts_json)='object'),
  created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(source_id,connector_id,space_id)
    REFERENCES journey_connector_worker_sources(id,connector_id,space_id) ON DELETE NO ACTION);
CREATE INDEX journey_connector_worker_events_list ON journey_connector_worker_events(space_id,created_at,id);

CREATE OR REPLACE FUNCTION journey_connector_worker_history_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN
  RAISE EXCEPTION 'Journey connector worker history is append-only' USING ERRCODE='55000'; END $guard$;
CREATE TRIGGER journey_connector_worker_events_append_only BEFORE UPDATE OR DELETE ON journey_connector_worker_events
  FOR EACH ROW EXECUTE FUNCTION journey_connector_worker_history_guard();
CREATE TRIGGER journey_connector_worker_key_events_append_only BEFORE UPDATE OR DELETE ON journey_connector_worker_key_events
  FOR EACH ROW EXECUTE FUNCTION journey_connector_worker_history_guard();
REVOKE ALL ON FUNCTION journey_connector_worker_history_guard() FROM PUBLIC;

-- Secrets are never stored here. Only an operator-approved external resolver
-- reference is persisted. Runtime workers receive no direct principal/config
-- mutation authority and history remains immutable.
REVOKE INSERT,UPDATE,DELETE ON journey_connector_worker_principals,journey_connector_worker_key_events,journey_connector_worker_sources,
  journey_connector_worker_source_items,journey_connector_worker_events FROM PUBLIC;
