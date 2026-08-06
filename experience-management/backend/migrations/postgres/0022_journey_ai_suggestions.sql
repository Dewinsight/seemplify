-- Runtime schema 22: review-first Journey Map AI suggestions.
--
-- Provider output is retained as immutable, typed changes against one exact
-- draft and one exact authorised evidence selection. Humans append decisions;
-- an accepted set is applied once as a new draft version. Normal application
-- traffic cannot update or erase evidence, changes, decisions, or audit.

DO $journey_ai_suggestion_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>21 THEN
    RAISE EXCEPTION 'runtime-22 journey AI suggestions require the checksummed runtime-21 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_ai_suggestion_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_ai_suggestion_definitions_tenant_identity
  ON journey_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_ai_suggestion_versions_tenant_identity
  ON journey_map_versions(id,definition_id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_ai_suggestion_jobs_tenant_identity
  ON ai_jobs(id,space_id);

CREATE TABLE journey_ai_suggestion_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  definition_id TEXT NOT NULL,
  base_version_id TEXT NOT NULL,
  base_definition_revision INTEGER NOT NULL CHECK(base_definition_revision>=1),
  base_map_checksum TEXT NOT NULL CHECK(base_map_checksum ~ '^[a-f0-9]{64}$'),
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ai_job_id TEXT,
  state TEXT NOT NULL CHECK(state IN (
    'queued','generating','review','ready_to_apply','applied','dismissed','superseded','failed')),
  focus TEXT NOT NULL DEFAULT '' CHECK(octet_length(focus)<=8000),
  summary TEXT NOT NULL DEFAULT '' CHECK(octet_length(summary)<=16000),
  warning_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  runtime_json JSONB,
  prompt_contract_version TEXT NOT NULL CHECK(length(prompt_contract_version) BETWEEN 1 AND 100),
  change_schema_version INTEGER NOT NULL CHECK(change_schema_version>=1),
  selected_evidence_checksum TEXT NOT NULL CHECK(selected_evidence_checksum ~ '^[a-f0-9]{64}$'),
  selected_evidence_count INTEGER NOT NULL CHECK(selected_evidence_count BETWEEN 0 AND 20),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  applied_version_id TEXT,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=100),
  created_at TIMESTAMPTZ NOT NULL,
  generation_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_ai_suggestion_runs_definition_tenant_fk
    FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_runs_base_version_tenant_fk
    FOREIGN KEY(base_version_id,definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_runs_applied_version_tenant_fk
    FOREIGN KEY(applied_version_id,definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_runs_job_tenant_fk
    FOREIGN KEY(ai_job_id,space_id)
    REFERENCES ai_jobs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_runs_warning_json CHECK(
    jsonb_typeof(warning_codes_json)='array' AND octet_length(warning_codes_json::text)<=16384),
  CONSTRAINT journey_ai_suggestion_runs_runtime_json CHECK(
    runtime_json IS NULL OR (jsonb_typeof(runtime_json)='object' AND octet_length(runtime_json::text)<=65536)),
  CONSTRAINT journey_ai_suggestion_runs_time_order CHECK(
    (generation_started_at IS NULL OR generation_started_at>=created_at)
    AND (completed_at IS NULL OR completed_at>=created_at)
    AND (applied_at IS NULL OR applied_at>=created_at))
);
CREATE UNIQUE INDEX journey_ai_suggestion_runs_one_active
  ON journey_ai_suggestion_runs(space_id,definition_id)
  WHERE state IN ('queued','generating','review','ready_to_apply');
CREATE INDEX journey_ai_suggestion_runs_definition
  ON journey_ai_suggestion_runs(space_id,definition_id,created_at DESC,id DESC);

CREATE TABLE journey_ai_suggestion_evidence (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  evidence_link_id TEXT NOT NULL CHECK(length(evidence_link_id) BETWEEN 1 AND 128),
  target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200),
  source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 1 AND 100),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 500),
  source_label TEXT NOT NULL DEFAULT '' CHECK(octet_length(source_label)<=800),
  excerpt TEXT NOT NULL DEFAULT '' CHECK(octet_length(excerpt)<=8000),
  population TEXT NOT NULL DEFAULT '' CHECK(octet_length(population)<=8000),
  sample_size INTEGER CHECK(sample_size IS NULL OR sample_size>=0),
  collected_at TIMESTAMPTZ,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  source_fingerprint TEXT NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
  assessment TEXT NOT NULL CHECK(assessment IN ('supports','contradicts','neutral')),
  prompt_injection_suspected INTEGER NOT NULL DEFAULT 0 CHECK(prompt_injection_suspected IN (0,1)),
  selected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_evidence_link_once UNIQUE(run_id,evidence_link_id),
  CONSTRAINT journey_ai_suggestion_evidence_source_once UNIQUE(run_id,source_type,source_ref),
  CONSTRAINT journey_ai_suggestion_evidence_tenant_identity UNIQUE(id,run_id,space_id),
  CONSTRAINT journey_ai_suggestion_evidence_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_evidence_window_order CHECK(
    window_start IS NULL OR window_end IS NULL OR window_end>=window_start)
);
CREATE INDEX journey_ai_suggestion_evidence_run
  ON journey_ai_suggestion_evidence(run_id,source_type,source_ref,id);

CREATE TABLE journey_ai_suggestion_changes (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 29),
  operation TEXT NOT NULL CHECK(operation IN (
    'stage.add','stage.update','lane.add','lane.update','card.add','card.update')),
  target_type TEXT NOT NULL CHECK(target_type IN ('stage','lane','card')),
  target_ref TEXT NOT NULL CHECK(length(target_ref) BETWEEN 1 AND 200),
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  rationale TEXT NOT NULL CHECK(length(rationale) BETWEEN 12 AND 2000),
  evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warning_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_checksum TEXT NOT NULL CHECK(change_checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_changes_ordinal_once UNIQUE(run_id,ordinal),
  CONSTRAINT journey_ai_suggestion_changes_checksum_once UNIQUE(run_id,change_checksum),
  CONSTRAINT journey_ai_suggestion_changes_tenant_identity UNIQUE(id,run_id,space_id),
  CONSTRAINT journey_ai_suggestion_changes_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_changes_before_json CHECK(
    jsonb_typeof(before_json) IN ('object','null') AND octet_length(before_json::text)<=131072),
  CONSTRAINT journey_ai_suggestion_changes_after_json CHECK(
    jsonb_typeof(after_json)='object' AND octet_length(after_json::text)<=131072),
  CONSTRAINT journey_ai_suggestion_changes_evidence_json CHECK(
    jsonb_typeof(evidence_refs_json)='array' AND octet_length(evidence_refs_json::text)<=16384),
  CONSTRAINT journey_ai_suggestion_changes_warning_json CHECK(
    jsonb_typeof(warning_codes_json)='array' AND octet_length(warning_codes_json::text)<=16384)
);
CREATE INDEX journey_ai_suggestion_changes_run
  ON journey_ai_suggestion_changes(run_id,ordinal,id);

CREATE TABLE journey_ai_suggestion_decisions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence>=1),
  decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_decisions_sequence_once UNIQUE(change_id,sequence),
  CONSTRAINT journey_ai_suggestion_decisions_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_decisions_change_tenant_fk FOREIGN KEY(change_id,run_id,space_id)
    REFERENCES journey_ai_suggestion_changes(id,run_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_ai_suggestion_decisions_run
  ON journey_ai_suggestion_decisions(run_id,change_id,sequence DESC);

CREATE TABLE journey_ai_suggestion_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  change_id TEXT,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'run.created','run.generation_started','run.generated','run.failed',
    'change.reviewed','run.applied','run.dismissed')),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_audit_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_audit_change_tenant_fk FOREIGN KEY(change_id,run_id,space_id)
    REFERENCES journey_ai_suggestion_changes(id,run_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_ai_suggestion_audit_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=32768)
);
CREATE INDEX journey_ai_suggestion_audit_run
  ON journey_ai_suggestion_audit_events(run_id,created_at,id);

-- Purge receipts deliberately retain no tenant identifiers or user content.
-- Their hashes prove that a controlled erasure ran without recreating the
-- erased relationship in an application-readable audit table.
CREATE TABLE journey_ai_suggestion_purge_receipts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  scope TEXT NOT NULL CHECK(scope IN ('definition','space')),
  space_hash TEXT NOT NULL CHECK(space_hash ~ '^[a-f0-9]{64}$'),
  definition_hash TEXT CHECK(definition_hash IS NULL OR definition_hash ~ '^[a-f0-9]{64}$'),
  change_ticket_hash TEXT NOT NULL CHECK(change_ticket_hash ~ '^[a-f0-9]{64}$'),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('privacy_erasure','retention_expiry','legal_order')),
  deleted_counts_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_ai_suggestion_purge_receipts_scope_shape CHECK(
    (scope='space' AND definition_hash IS NULL) OR (scope='definition' AND definition_hash IS NOT NULL)),
  CONSTRAINT journey_ai_suggestion_purge_receipts_counts_json CHECK(
    jsonb_typeof(deleted_counts_json)='object' AND octet_length(deleted_counts_json::text)<=8192)
);
CREATE INDEX journey_ai_suggestion_purge_receipts_created
  ON journey_ai_suggestion_purge_receipts(created_at,id);

CREATE OR REPLACE FUNCTION journey_ai_suggestion_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_ai_suggestion_immutable_guard$
BEGIN
  IF TG_OP='DELETE'
     AND current_setting('seemplify.journey_ai_audit_maintenance',true)='privacy-purge' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Journey AI suggestion history is immutable' USING ERRCODE='55000';
END
$journey_ai_suggestion_immutable_guard$;

CREATE OR REPLACE FUNCTION journey_ai_suggestion_receipt_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_ai_suggestion_receipt_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey AI suggestion purge receipts are append-only' USING ERRCODE='55000';
END
$journey_ai_suggestion_receipt_append_only_guard$;

CREATE TRIGGER journey_ai_suggestion_evidence_immutable
BEFORE UPDATE OR DELETE ON journey_ai_suggestion_evidence
FOR EACH ROW EXECUTE FUNCTION journey_ai_suggestion_immutable_guard();
CREATE TRIGGER journey_ai_suggestion_changes_immutable
BEFORE UPDATE OR DELETE ON journey_ai_suggestion_changes
FOR EACH ROW EXECUTE FUNCTION journey_ai_suggestion_immutable_guard();
CREATE TRIGGER journey_ai_suggestion_decisions_immutable
BEFORE UPDATE OR DELETE ON journey_ai_suggestion_decisions
FOR EACH ROW EXECUTE FUNCTION journey_ai_suggestion_immutable_guard();
CREATE TRIGGER journey_ai_suggestion_audit_immutable
BEFORE UPDATE OR DELETE ON journey_ai_suggestion_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_ai_suggestion_immutable_guard();
CREATE TRIGGER journey_ai_suggestion_purge_receipts_append_only
BEFORE UPDATE OR DELETE ON journey_ai_suggestion_purge_receipts
FOR EACH ROW EXECUTE FUNCTION journey_ai_suggestion_receipt_append_only_guard();

-- This is intentionally not exposed over HTTP. Only the migration-owner role
-- may execute it after supplying an approved change ticket and reason. Runtime
-- privileges explicitly revoke execution from the application role.
CREATE OR REPLACE FUNCTION journey_ai_suggestion_controlled_purge(
  p_space_id TEXT,
  p_definition_id TEXT,
  p_reason_code TEXT,
  p_change_ticket TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $journey_ai_suggestion_controlled_purge$
DECLARE
  v_receipt_id TEXT;
  v_receipt_secret TEXT;
  v_job_ids TEXT[];
  v_runs INTEGER:=0;
  v_evidence INTEGER:=0;
  v_changes INTEGER:=0;
  v_decisions INTEGER:=0;
  v_audit_events INTEGER:=0;
  v_ai_jobs INTEGER:=0;
BEGIN
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('privacy_erasure','retention_expiry','legal_order') THEN
    RAISE EXCEPTION 'A permitted journey suggestion purge reason is required' USING ERRCODE='22023';
  END IF;
  IF p_change_ticket IS NULL OR p_change_ticket !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,119}$' THEN
    RAISE EXCEPTION 'A valid change-control ticket is required' USING ERRCODE='22023';
  END IF;
  v_receipt_secret:=current_setting('seemplify.journey_ai_audit_receipt_secret',true);
  IF v_receipt_secret IS NULL OR octet_length(v_receipt_secret)<32 THEN
    RAISE EXCEPTION 'A privileged ephemeral journey suggestion receipt secret is required'
      USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spaces WHERE id=p_space_id) THEN
    RAISE EXCEPTION 'Journey suggestion purge space not found' USING ERRCODE='P0002';
  END IF;
  IF p_definition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journey_definitions WHERE id=p_definition_id AND space_id=p_space_id) THEN
    RAISE EXCEPTION 'Journey suggestion purge definition not found in space' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(array_agg(ai_job_id) FILTER (WHERE ai_job_id IS NOT NULL),ARRAY[]::TEXT[])
    INTO v_job_ids
  FROM public.journey_ai_suggestion_runs
  WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id);

  PERFORM set_config('seemplify.journey_ai_audit_maintenance','privacy-purge',true);

  DELETE FROM public.journey_ai_suggestion_audit_events
  WHERE space_id=p_space_id AND run_id IN (
    SELECT id FROM public.journey_ai_suggestion_runs
    WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id));
  GET DIAGNOSTICS v_audit_events=ROW_COUNT;

  DELETE FROM public.journey_ai_suggestion_decisions
  WHERE space_id=p_space_id AND run_id IN (
    SELECT id FROM public.journey_ai_suggestion_runs
    WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id));
  GET DIAGNOSTICS v_decisions=ROW_COUNT;

  DELETE FROM public.journey_ai_suggestion_changes
  WHERE space_id=p_space_id AND run_id IN (
    SELECT id FROM public.journey_ai_suggestion_runs
    WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id));
  GET DIAGNOSTICS v_changes=ROW_COUNT;

  DELETE FROM public.journey_ai_suggestion_evidence
  WHERE space_id=p_space_id AND run_id IN (
    SELECT id FROM public.journey_ai_suggestion_runs
    WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id));
  GET DIAGNOSTICS v_evidence=ROW_COUNT;

  DELETE FROM public.journey_ai_suggestion_runs
  WHERE space_id=p_space_id AND (p_definition_id IS NULL OR definition_id=p_definition_id);
  GET DIAGNOSTICS v_runs=ROW_COUNT;

  DELETE FROM public.ai_jobs
  WHERE id=ANY(v_job_ids) AND space_id=p_space_id AND kind='journey.optimize';
  GET DIAGNOSTICS v_ai_jobs=ROW_COUNT;

  v_receipt_id:=md5(random()::text || clock_timestamp()::text || p_space_id)
    || md5(p_change_ticket || clock_timestamp()::text || random()::text);
  INSERT INTO public.journey_ai_suggestion_purge_receipts
    (id,scope,space_hash,definition_hash,change_ticket_hash,reason_code,deleted_counts_json,created_at)
  VALUES (
    v_receipt_id,
    CASE WHEN p_definition_id IS NULL THEN 'space' ELSE 'definition' END,
    md5(v_receipt_secret || ':space:' || p_space_id)
      || md5(p_space_id || ':space:' || v_receipt_secret),
    CASE WHEN p_definition_id IS NULL THEN NULL
      ELSE md5(v_receipt_secret || ':definition:' || p_definition_id)
        || md5(p_definition_id || ':definition:' || v_receipt_secret) END,
    md5(v_receipt_secret || ':ticket:' || p_change_ticket)
      || md5(p_change_ticket || ':ticket:' || v_receipt_secret),
    p_reason_code,
    jsonb_build_object('runs',v_runs,'evidence',v_evidence,'changes',v_changes,
      'decisions',v_decisions,'auditEvents',v_audit_events,'aiJobs',v_ai_jobs),
    clock_timestamp()
  );
  RETURN v_receipt_id;
END
$journey_ai_suggestion_controlled_purge$;

REVOKE ALL ON FUNCTION journey_ai_suggestion_controlled_purge(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
