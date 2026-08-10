-- Runtime schema 37: approved, provider-neutral connector import contracts.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>36 THEN
    RAISE EXCEPTION 'runtime-37 journey connector imports requires runtime-36' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_connector_definitions (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('csv_upload','jsonl_upload','approved_object_store')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160), state TEXT NOT NULL CHECK(state IN ('active','disabled')),
  deletion_mode TEXT NOT NULL DEFAULT 'tombstone' CHECK(deletion_mode='tombstone'),
  maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts BETWEEN 1 AND 10),
  base_retry_seconds INTEGER NOT NULL CHECK(base_retry_seconds BETWEEN 1 AND 300), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE(id,space_id), CHECK(updated_at>=created_at));
CREATE INDEX journey_connector_definitions_list ON journey_connector_definitions(space_id,state,updated_at DESC,id);

CREATE TABLE journey_connector_import_runs (
  id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, space_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open','retry_wait','completed','failed','cancelled')),
  checkpoint_revision INTEGER NOT NULL DEFAULT 1 CHECK(checkpoint_revision>0), expected_cursor TEXT CHECK(length(expected_cursor)<=2000),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0), retry_at TIMESTAMPTZ,
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK(accepted_count>=0), rejected_count INTEGER NOT NULL DEFAULT 0 CHECK(rejected_count>=0),
  tombstone_count INTEGER NOT NULL DEFAULT 0 CHECK(tombstone_count>=0), last_error_code TEXT CHECK(length(last_error_code)<=100),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id), UNIQUE(id,connector_id,space_id),
  FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION,
  CHECK(updated_at>=created_at), CHECK((state='retry_wait' AND retry_at IS NOT NULL) OR (state<>'retry_wait' AND retry_at IS NULL)));
CREATE INDEX journey_connector_import_runs_list ON journey_connector_import_runs(space_id,connector_id,created_at DESC,id);

CREATE TABLE journey_connector_records (
  connector_id TEXT NOT NULL, space_id TEXT NOT NULL, external_id TEXT NOT NULL CHECK(length(external_id) BETWEEN 1 AND 128),
  state TEXT NOT NULL CHECK(state IN ('active','tombstoned')), payload_json JSONB, payload_sha256 TEXT,
  source_occurred_at TIMESTAMPTZ NOT NULL, last_run_id TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(connector_id,space_id,external_id),
  FOREIGN KEY(connector_id,space_id) REFERENCES journey_connector_definitions(id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(last_run_id,connector_id,space_id) REFERENCES journey_connector_import_runs(id,connector_id,space_id) ON DELETE NO ACTION,
  CHECK((state='active' AND jsonb_typeof(payload_json) IS NOT NULL AND payload_sha256 ~ '^[a-f0-9]{64}$') OR
    (state='tombstoned' AND payload_json IS NULL AND payload_sha256 IS NULL)));

CREATE TABLE journey_connector_item_receipts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, connector_id TEXT NOT NULL, space_id TEXT NOT NULL,
  external_id_sha256 TEXT NOT NULL CHECK(external_id_sha256 ~ '^[a-f0-9]{64}$'),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete','invalid')),
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected','tombstoned')), code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 100),
  item_checksum TEXT CHECK(item_checksum IS NULL OR item_checksum ~ '^[a-f0-9]{64}$'),
  checkpoint_revision INTEGER NOT NULL CHECK(checkpoint_revision>0), created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(run_id,connector_id,space_id) REFERENCES journey_connector_import_runs(id,connector_id,space_id) ON DELETE NO ACTION);
CREATE INDEX journey_connector_item_receipts_list ON journey_connector_item_receipts(space_id,run_id,created_at,id);

CREATE TABLE journey_connector_idempotency (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json JSONB NOT NULL CHECK(jsonb_typeof(response_json)='object'), created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,actor_user_id,operation,idempotency_key));
CREATE TABLE journey_connector_audit (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT NOT NULL, detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL);
CREATE INDEX journey_connector_audit_list ON journey_connector_audit(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_connector_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN
  RAISE EXCEPTION 'Journey connector history is append-only' USING ERRCODE='55000'; END $guard$;
CREATE TRIGGER journey_connector_receipts_append_only BEFORE UPDATE OR DELETE ON journey_connector_item_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_connector_append_only_guard();
CREATE TRIGGER journey_connector_audit_append_only BEFORE UPDATE OR DELETE ON journey_connector_audit
  FOR EACH ROW EXECUTE FUNCTION journey_connector_append_only_guard();
REVOKE ALL ON FUNCTION journey_connector_append_only_guard() FROM PUBLIC;
