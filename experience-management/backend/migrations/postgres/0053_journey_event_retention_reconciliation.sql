-- Runtime schema 53: fenced raw Journey event retention and bulk reconciliation foundation.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>52 THEN
    RAISE EXCEPTION 'runtime-53 journey event retention requires runtime-52' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_event_retention_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK(kind IN ('retention','reconciliation')),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','failed','cancelled')),
  as_of TIMESTAMPTZ NOT NULL,batch_size INTEGER NOT NULL CHECK(batch_size BETWEEN 1 AND 500),
  lease_owner TEXT,lease_token TEXT,lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),lease_expires_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,CONSTRAINT journey_event_retention_runs_lease_shape CHECK(
    (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX journey_event_retention_runs_claim ON journey_event_retention_runs(state,updated_at,id);

CREATE TABLE journey_event_retention_checkpoints (
  run_id TEXT PRIMARY KEY REFERENCES journey_event_retention_runs(id) ON DELETE CASCADE,
  cursor_retention_expires_at TIMESTAMPTZ,cursor_received_at TIMESTAMPTZ,cursor_raw_event_id TEXT,
  scanned_count BIGINT NOT NULL DEFAULT 0 CHECK(scanned_count>=0),purged_count BIGINT NOT NULL DEFAULT 0 CHECK(purged_count>=0),
  blocked_count BIGINT NOT NULL DEFAULT 0 CHECK(blocked_count>=0),failed_count BIGINT NOT NULL DEFAULT 0 CHECK(failed_count>=0),
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary_json)='object' AND octet_length(summary_json::text)<=32768),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at TIMESTAMPTZ NOT NULL,
  CHECK((cursor_retention_expires_at IS NULL AND cursor_received_at IS NULL AND cursor_raw_event_id IS NULL)
    OR (cursor_retention_expires_at IS NOT NULL AND cursor_received_at IS NOT NULL AND cursor_raw_event_id IS NOT NULL))
);
CREATE TABLE journey_event_retention_events (
  id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES journey_event_retention_runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('requested','leased','page','raw.purged','raw.blocked','page.failed','completed','failed','cancelled')),
  detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=32768),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX journey_event_retention_events_history ON journey_event_retention_events(run_id,created_at,id);

CREATE OR REPLACE FUNCTION journey_event_retention_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'journey event retention events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER journey_event_retention_events_guard_trigger BEFORE UPDATE OR DELETE ON journey_event_retention_events
  FOR EACH ROW EXECUTE FUNCTION journey_event_retention_events_guard();

-- This narrow destructive primitive is intentionally unable to repair stage
-- history. A stage-linked raw row is reported for reconciliation and remains
-- retained until a later reviewed projection contract can prove the repair.
CREATE OR REPLACE FUNCTION journey_event_retention_purge_raw(
  p_run_id TEXT,p_lease_owner TEXT,p_lease_token TEXT,p_space_id TEXT,p_source_id TEXT,p_environment TEXT,
  p_received_at TIMESTAMPTZ,p_raw_event_id TEXT,p_as_of TIMESTAMPTZ)
RETURNS TABLE(purged_count INTEGER,outcome_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_run journey_event_retention_runs%ROWTYPE;v_raw journey_raw_events%ROWTYPE;v_count INTEGER:=0;
BEGIN
  SELECT * INTO v_run FROM journey_event_retention_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.kind<>'retention' OR v_run.state<>'leased' OR v_run.lease_owner<>p_lease_owner
    OR v_run.lease_token<>p_lease_token OR v_run.lease_expires_at<=clock_timestamp() OR v_run.as_of<>p_as_of THEN
    RAISE EXCEPTION 'journey event retention lease is invalid' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_raw FROM journey_raw_events WHERE received_at=p_received_at AND id=p_raw_event_id
    AND space_id=p_space_id AND source_id=p_source_id AND environment=p_environment FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0,'already_absent'::TEXT;RETURN;END IF;
  IF v_raw.retention_expires_at>p_as_of OR p_as_of>clock_timestamp() THEN RETURN QUERY SELECT 0,'not_expired'::TEXT;RETURN;END IF;
  IF EXISTS(SELECT 1 FROM journey_event_processing_inbox WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id
      AND state NOT IN ('completed','dead_lettered')) THEN RETURN QUERY SELECT 0,'active_processing'::TEXT;RETURN;END IF;
  IF EXISTS(SELECT 1 FROM journey_stage_rule_decisions WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id)
    OR EXISTS(SELECT 1 FROM journey_anonymous_stage_visits WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id) THEN
    RETURN QUERY SELECT 0,'stage_reconciliation_required'::TEXT;RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM journey_event_ingest_receipts WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id
      AND retention_expires_at>p_as_of) OR EXISTS(SELECT 1 FROM journey_event_processing_receipts
      WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id AND retention_expires_at>p_as_of)
    OR EXISTS(SELECT 1 FROM journey_event_dead_letters WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id
      AND retention_expires_at>p_as_of) OR EXISTS(SELECT 1 FROM journey_event_deduplication
      WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id AND retention_expires_at>p_as_of)
    THEN RETURN QUERY SELECT 0,'dependent_retention'::TEXT;RETURN;END IF;
  PERFORM set_config('seemplify.retention_purge','on',true);
  DELETE FROM journey_event_dead_letters WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id;
  DELETE FROM journey_event_processing_receipts WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id;
  DELETE FROM journey_event_processing_inbox WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id;
  DELETE FROM journey_event_deduplication WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id;
  DELETE FROM journey_event_ingest_receipts WHERE raw_received_at=p_received_at AND raw_event_id=p_raw_event_id;
  DELETE FROM journey_raw_events WHERE received_at=p_received_at AND id=p_raw_event_id;GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN QUERY SELECT v_count,'purged'::TEXT;
END $$;
REVOKE ALL ON FUNCTION journey_event_retention_purge_raw(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON TABLE journey_event_retention_runs,journey_event_retention_checkpoints,journey_event_retention_events FROM PUBLIC;
