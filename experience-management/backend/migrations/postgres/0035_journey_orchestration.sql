-- Runtime schema 35: governed workflow definitions, simulations, approvals, and held outbox foundations.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>34 THEN
    RAISE EXCEPTION 'runtime-35 journey orchestration requires runtime-34' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_orchestration_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL DEFAULT FALSE, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  CHECK(updated_at>=created_at)
);
CREATE TABLE journey_workflow_definitions (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160), state TEXT NOT NULL CHECK(state IN ('draft','published','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), draft_json JSONB NOT NULL CHECK(jsonb_typeof(draft_json)='object'),
  current_version_id TEXT, current_version_number INTEGER CHECK(current_version_number IS NULL OR current_version_number>0),
  paused BOOLEAN NOT NULL DEFAULT FALSE, created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL, retired_at TIMESTAMPTZ, retired_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT journey_workflow_definitions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_definitions_lifecycle CHECK(
    (state='draft' AND current_version_id IS NULL AND current_version_number IS NULL AND retired_at IS NULL)
    OR (state='published' AND current_version_id IS NOT NULL AND current_version_number IS NOT NULL AND retired_at IS NULL)
    OR (state='retired' AND current_version_id IS NOT NULL AND current_version_number IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE INDEX journey_workflow_definitions_list ON journey_workflow_definitions(space_id,state,updated_at DESC,id);
CREATE TABLE journey_workflow_versions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, space_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number>0),
  content_json JSONB NOT NULL CHECK(jsonb_typeof(content_json)='object'), content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, published_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_workflow_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_versions_current_identity UNIQUE(id,workflow_id,space_id),
  CONSTRAINT journey_workflow_versions_number UNIQUE(workflow_id,space_id,version_number),
  CONSTRAINT journey_workflow_versions_parent_fk FOREIGN KEY(workflow_id,space_id)
    REFERENCES journey_workflow_definitions(id,space_id) ON DELETE NO ACTION
);
ALTER TABLE journey_workflow_definitions ADD CONSTRAINT journey_workflow_definitions_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_workflow_versions(id,workflow_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE journey_workflow_runs (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version_id TEXT NOT NULL, space_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('dry_run','historical','execution')), trigger_fingerprint_sha256 TEXT NOT NULL CHECK(trigger_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  subject_ref_sha256 TEXT NOT NULL CHECK(subject_ref_sha256 ~ '^[a-f0-9]{64}$'), result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'), actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, CONSTRAINT journey_workflow_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_runs_version_fk FOREIGN KEY(workflow_version_id,workflow_id,space_id)
    REFERENCES journey_workflow_versions(id,workflow_id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_workflow_runs_history ON journey_workflow_runs(space_id,workflow_id,created_at DESC,id);
CREATE TABLE journey_workflow_actions (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, space_id TEXT NOT NULL, action_key TEXT NOT NULL,
  adapter TEXT NOT NULL, idempotency_key TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('suppressed','pending_approval','approved_held')),
  approval_required BOOLEAN NOT NULL, trace_json JSONB NOT NULL CHECK(jsonb_typeof(trace_json)='array'), trace_sha256 TEXT NOT NULL CHECK(trace_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL, CONSTRAINT journey_workflow_actions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_actions_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_workflow_actions_once UNIQUE(run_id,action_key),
  CONSTRAINT journey_workflow_actions_run_fk FOREIGN KEY(run_id,space_id) REFERENCES journey_workflow_runs(id,space_id) ON DELETE NO ACTION
);
CREATE TABLE journey_workflow_approvals (
  id TEXT PRIMARY KEY, action_id TEXT NOT NULL, space_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, CONSTRAINT journey_workflow_approvals_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_approvals_once UNIQUE(action_id),
  CONSTRAINT journey_workflow_approvals_action_fk FOREIGN KEY(action_id,space_id)
    REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION
);
CREATE TABLE journey_workflow_outbox (
  id TEXT PRIMARY KEY, action_id TEXT NOT NULL, space_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'held' CHECK(state='held'), payload_json JSONB NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  payload_sha256 TEXT NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_workflow_outbox_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_workflow_outbox_action_once UNIQUE(action_id),
  CONSTRAINT journey_workflow_outbox_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_workflow_outbox_action_fk FOREIGN KEY(action_id,space_id)
    REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION
);
CREATE TABLE journey_workflow_audit (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX journey_workflow_audit_history ON journey_workflow_audit(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_orchestration_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN
  RAISE EXCEPTION 'Journey orchestration history is append-only' USING ERRCODE='55000';
END $guard$;
CREATE TRIGGER journey_workflow_versions_append_only BEFORE UPDATE OR DELETE ON journey_workflow_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_workflow_runs_append_only BEFORE UPDATE OR DELETE ON journey_workflow_runs
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_workflow_actions_append_only BEFORE UPDATE OR DELETE ON journey_workflow_actions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_workflow_approvals_append_only BEFORE UPDATE OR DELETE ON journey_workflow_approvals
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_workflow_outbox_append_only BEFORE UPDATE OR DELETE ON journey_workflow_outbox
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_workflow_audit_append_only BEFORE UPDATE OR DELETE ON journey_workflow_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
REVOKE ALL ON FUNCTION journey_orchestration_append_only_guard() FROM PUBLIC;
