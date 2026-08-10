-- Runtime schema 38: reviewed internal adapters and allowlisted signed-webhook execution evidence.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>37 THEN
    RAISE EXCEPTION 'runtime-38 reviewed journey adapters requires runtime-37' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_webhook_destinations (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160), url TEXT NOT NULL CHECK(length(url) BETWEEN 9 AND 2048),
  hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 1 AND 253), port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  secret_enc TEXT NOT NULL, secret_sha256 TEXT NOT NULL CHECK(secret_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('active','disabled')), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE(id,space_id), CHECK(updated_at>=created_at)
);
CREATE INDEX journey_webhook_destinations_list ON journey_webhook_destinations(space_id,state,updated_at DESC,id);

CREATE TABLE journey_adapter_execution_attempts (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, action_id TEXT NOT NULL, space_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK(adapter IN ('survey_invitation','service_recovery_ticket','assistant_action','internal_notification','signed_webhook')),
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0), fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','retryable_failure','permanent_failure','safety_held')),
  error_code TEXT, request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  provider_receipt_sha256 TEXT CHECK(provider_receipt_sha256 IS NULL OR provider_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  safety_json JSONB NOT NULL CHECK(jsonb_typeof(safety_json)='object'),
  created_at TIMESTAMPTZ NOT NULL, UNIQUE(queue_id,attempt_number,outcome),
  FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_adapter_execution_attempts_history ON journey_adapter_execution_attempts(space_id,queue_id,attempt_number,id);

CREATE TABLE journey_adapter_effect_receipts (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, action_id TEXT NOT NULL, space_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK(adapter IN ('survey_invitation','service_recovery_ticket','assistant_action','internal_notification','signed_webhook')),
  idempotency_key TEXT NOT NULL, provider_reference_sha256 TEXT NOT NULL CHECK(provider_reference_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 TEXT NOT NULL CHECK(response_sha256 ~ '^[a-f0-9]{64}$'), fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  created_at TIMESTAMPTZ NOT NULL, UNIQUE(queue_id), UNIQUE(action_id), UNIQUE(space_id,idempotency_key),
  FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);

CREATE TABLE journey_adapter_internal_notifications (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, space_id TEXT NOT NULL, target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240), body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(queue_id), FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_adapter_internal_notifications_inbox
  ON journey_adapter_internal_notifications(space_id,target_user_id,created_at DESC,id);

CREATE TABLE journey_webhook_dispatches (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, destination_id TEXT NOT NULL, space_id TEXT NOT NULL,
  nonce TEXT NOT NULL, signed_at TIMESTAMPTZ NOT NULL, request_body_sha256 TEXT NOT NULL CHECK(request_body_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('prepared','sending','succeeded','retry_wait','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0), response_status INTEGER,
  response_sha256 TEXT CHECK(response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'), last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, UNIQUE(queue_id), UNIQUE(destination_id,nonce),
  FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(destination_id,space_id) REFERENCES journey_webhook_destinations(id,space_id) ON DELETE NO ACTION,
  CHECK(updated_at>=created_at)
);

CREATE TRIGGER journey_adapter_execution_attempts_append_only BEFORE UPDATE OR DELETE ON journey_adapter_execution_attempts
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_adapter_effect_receipts_append_only BEFORE UPDATE OR DELETE ON journey_adapter_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_adapter_internal_notifications_append_only BEFORE UPDATE OR DELETE ON journey_adapter_internal_notifications
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
