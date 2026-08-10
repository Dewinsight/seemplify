-- Runtime schema 36: non-external, durable journey action queue foundations.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>35 THEN
    RAISE EXCEPTION 'runtime-36 journey action runtime requires runtime-35' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_action_queue (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('held','ready','leased','retry_scheduled','succeeded','dead_letter','cancelled')),
  hold_reason_code TEXT,
  payload_json JSONB NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  payload_sha256 TEXT NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 25),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner_sha256 TEXT CHECK(lease_owner_sha256 IS NULL OR lease_owner_sha256 ~ '^[a-f0-9]{64}$'),
  lease_token TEXT,
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
  lease_expires_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  last_error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_action_queue_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_action_queue_action_once UNIQUE(action_id),
  CONSTRAINT journey_action_queue_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_action_queue_action_fk FOREIGN KEY(action_id,space_id)
    REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_action_queue_workflow_fk FOREIGN KEY(workflow_id,space_id)
    REFERENCES journey_workflow_definitions(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_action_queue_lease_shape CHECK(
    (state='leased' AND lease_owner_sha256 IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner_sha256 IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_action_queue_terminal_shape CHECK(
    (state IN ('succeeded','dead_letter','cancelled') AND terminal_at IS NOT NULL)
    OR (state NOT IN ('succeeded','dead_letter','cancelled') AND terminal_at IS NULL)),
  CHECK(updated_at>=created_at)
);
CREATE INDEX journey_action_queue_claim ON journey_action_queue(space_id,state,available_at,created_at,id);

CREATE TABLE journey_action_gate_resolutions (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  gate_key TEXT NOT NULL CHECK(gate_key IN ('consent','suppression','entitlement','quota','quiet_hours','frequency_cap',
    'source_state','platform_kill_switch','space_kill_switch','workflow_kill_switch','adapter_kill_switch','profile_kill_switch')),
  decision TEXT NOT NULL CHECK(decision IN ('allow','deny','unknown')),
  reason_code TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  resolved_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_action_gate_resolutions_once UNIQUE(queue_id,gate_key),
  CONSTRAINT journey_action_gate_resolutions_queue_fk FOREIGN KEY(queue_id,space_id)
    REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);

CREATE TABLE journey_action_attempts (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('leased','no_effect_succeeded','retry_scheduled','dead_letter')),
  error_code TEXT,
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_action_attempts_once UNIQUE(queue_id,attempt_number,outcome),
  CONSTRAINT journey_action_attempts_queue_fk FOREIGN KEY(queue_id,space_id)
    REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_action_attempts_history ON journey_action_attempts(space_id,queue_id,attempt_number,id);

CREATE TABLE journey_action_effect_receipts (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK(adapter='deterministic_no_effect'),
  effect_sha256 TEXT NOT NULL CHECK(effect_sha256 ~ '^[a-f0-9]{64}$'),
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_action_effect_receipts_queue_once UNIQUE(queue_id),
  CONSTRAINT journey_action_effect_receipts_action_once UNIQUE(action_id),
  CONSTRAINT journey_action_effect_receipts_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_action_effect_receipts_queue_fk FOREIGN KEY(queue_id,space_id)
    REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);

CREATE TRIGGER journey_action_gate_resolutions_append_only BEFORE UPDATE OR DELETE ON journey_action_gate_resolutions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_action_attempts_append_only BEFORE UPDATE OR DELETE ON journey_action_attempts
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_action_effect_receipts_append_only BEFORE UPDATE OR DELETE ON journey_action_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
