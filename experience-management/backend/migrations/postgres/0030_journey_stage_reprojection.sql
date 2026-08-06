-- Runtime schema 30: durable journey stage reprojection runs, checkpoints,
-- append-only attempts and operator audit.
--
-- This runtime adds governed retained reprojection over the existing runtime-18
-- stage-processing facts. Raw events, decisions and visits remain immutable.

DO $journey_stage_reprojection_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>29 THEN
    RAISE EXCEPTION 'runtime-30 journey stage reprojection requires the checksummed runtime-29 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_stage_reprojection_predecessor$;

CREATE TABLE journey_stage_reprojection_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('manual','rule_published','rule_corrected','reconcile','incident_recovery')),
  journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL,
  rule_definition_id TEXT,
  rule_version_id TEXT,
  source_id TEXT,
  environment TEXT CHECK(environment IS NULL OR environment IN ('development','staging','production')),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retryable','completed','failed','cancelled')),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT journey_stage_reprojection_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_stage_reprojection_runs_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_stage_reprojection_runs_definition_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_reprojection_runs_map_tenant_fk FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_reprojection_runs_rule_definition_tenant_fk FOREIGN KEY(rule_definition_id,space_id,journey_definition_id)
    REFERENCES journey_stage_rule_definitions(id,space_id,journey_definition_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_reprojection_runs_rule_version_tenant_fk FOREIGN KEY(rule_version_id,rule_definition_id,space_id,journey_definition_id)
    REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_reprojection_runs_source_tenant_fk FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_reprojection_runs_window_order CHECK(window_end IS NULL OR window_start IS NULL OR window_end>window_start),
  CONSTRAINT journey_stage_reprojection_runs_lease_shape CHECK(
    (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_stage_reprojection_runs_completion_shape CHECK(
    (state IN ('completed','failed','cancelled'))=(completed_at IS NOT NULL)),
  CONSTRAINT journey_stage_reprojection_runs_summary_shape CHECK(
    jsonb_typeof(summary_json)='object' AND octet_length(summary_json::text)<=262144)
);
CREATE INDEX journey_stage_reprojection_runs_claim
  ON journey_stage_reprojection_runs(state,available_at,lease_expires_at,space_id,id);
CREATE INDEX journey_stage_reprojection_runs_scope
  ON journey_stage_reprojection_runs(space_id,journey_definition_id,created_at DESC,id);

CREATE TABLE journey_stage_reprojection_attempts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 100),
  lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  status TEXT NOT NULL CHECK(status IN ('succeeded','retryable_failed','terminal_failed','lease_expired','cancelled')),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_stage_reprojection_attempts_once UNIQUE(run_id,attempt_number,status),
  CONSTRAINT journey_stage_reprojection_attempts_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_stage_reprojection_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_reprojection_attempts_status_shape CHECK(
    (status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
  CONSTRAINT journey_stage_reprojection_attempts_time_order CHECK(completed_at>=started_at)
);
CREATE INDEX journey_stage_reprojection_attempts_history
  ON journey_stage_reprojection_attempts(space_id,run_id,attempt_number,id);

CREATE TABLE journey_stage_reprojection_checkpoints (
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  last_event_occurred_at TIMESTAMPTZ,
  last_raw_received_at TIMESTAMPTZ,
  last_raw_event_id TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count>=0),
  matched_count INTEGER NOT NULL DEFAULT 0 CHECK(matched_count>=0),
  no_match_count INTEGER NOT NULL DEFAULT 0 CHECK(no_match_count>=0),
  skipped_no_anonymous_subject_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_no_anonymous_subject_count>=0),
  late_count INTEGER NOT NULL DEFAULT 0 CHECK(late_count>=0),
  out_of_order_count INTEGER NOT NULL DEFAULT 0 CHECK(out_of_order_count>=0),
  changed_current_stage_count INTEGER NOT NULL DEFAULT 0 CHECK(changed_current_stage_count>=0),
  changed_terminal_state_count INTEGER NOT NULL DEFAULT 0 CHECK(changed_terminal_state_count>=0),
  no_change_count INTEGER NOT NULL DEFAULT 0 CHECK(no_change_count>=0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(run_id,space_id),
  CONSTRAINT journey_stage_reprojection_checkpoints_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_stage_reprojection_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_reprojection_checkpoints_cursor_shape CHECK(
    (last_raw_received_at IS NULL AND last_raw_event_id IS NULL)
      OR (last_raw_received_at IS NOT NULL AND last_raw_event_id IS NOT NULL))
);

CREATE TABLE journey_stage_reprojection_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'reprojection.requested','reprojection.started','reprojection.completed','reprojection.failed','reprojection.cancelled','reprojection.viewed')),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 80),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_stage_reprojection_audit_events_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=16384)
);
CREATE INDEX journey_stage_reprojection_audit_history
  ON journey_stage_reprojection_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_stage_reprojection_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_stage_reprojection_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey stage reprojection history is append-only' USING ERRCODE='55000';
END
$journey_stage_reprojection_append_only_guard$;

CREATE TRIGGER journey_stage_reprojection_attempts_append_only
BEFORE UPDATE OR DELETE ON journey_stage_reprojection_attempts
FOR EACH ROW EXECUTE FUNCTION journey_stage_reprojection_append_only_guard();
CREATE TRIGGER journey_stage_reprojection_audit_append_only
BEFORE UPDATE OR DELETE ON journey_stage_reprojection_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_stage_reprojection_append_only_guard();
