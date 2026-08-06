-- Runtime schema 21: journey metric bindings, versioned definitions,
-- immutable observations, operational imports, and crash-safe rebuilds.
--
-- This projection layer never copies survey answers or arbitrary import
-- properties.  It stores bounded aggregate results, immutable content-free
-- lineage and the minimum operational fields required by the existing
-- deterministic calculators.

DO $journey_metric_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>20 THEN
    RAISE EXCEPTION 'runtime-21 journey metrics require the checksummed runtime-20 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_metric_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS surveys_tenant_identity ON surveys(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS collectors_survey_identity ON collectors(id,survey_id);
CREATE UNIQUE INDEX IF NOT EXISTS questions_survey_identity ON questions(id,survey_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_definitions_parent_identity ON journey_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_stages_tenant_identity ON journey_map_stages(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_cards_tenant_identity ON journey_map_cards(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_personas_tenant_identity ON journey_personas(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_schema_versions_tenant_identity
  ON journey_event_schema_versions(id,source_id,space_id);

CREATE TABLE journey_metric_segments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(octet_length(description)<=2000),
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_segments_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_segments_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_segments_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_segments_rule_json CHECK(
    jsonb_typeof(rule_json)='object' AND octet_length(rule_json::text)<=32768)
);
CREATE INDEX journey_metric_segments_journey
  ON journey_metric_segments(space_id,journey_definition_id,state,updated_at DESC,id);

CREATE TABLE journey_metric_bindings (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey','stage','touchpoint','persona','segment')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  stage_id TEXT,
  touchpoint_id TEXT,
  persona_id TEXT,
  segment_id TEXT,
  survey_id TEXT,
  survey_space_id TEXT,
  collector_id TEXT,
  collector_survey_id TEXT,
  question_id TEXT,
  question_survey_id TEXT,
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 500),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_bindings_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_bindings_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_bindings_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_bindings_stage_tenant_fk FOREIGN KEY(stage_id,space_id)
    REFERENCES journey_map_stages(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_bindings_touchpoint_tenant_fk FOREIGN KEY(touchpoint_id,space_id)
    REFERENCES journey_map_cards(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_bindings_persona_tenant_fk FOREIGN KEY(persona_id,space_id)
    REFERENCES journey_personas(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_bindings_segment_tenant_fk FOREIGN KEY(segment_id,space_id)
    REFERENCES journey_metric_segments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_bindings_survey_tenant_fk FOREIGN KEY(survey_id,survey_space_id)
    REFERENCES surveys(id,space_id) ON DELETE SET NULL,
  CONSTRAINT journey_metric_bindings_collector_survey_fk FOREIGN KEY(collector_id,collector_survey_id)
    REFERENCES collectors(id,survey_id) ON DELETE SET NULL,
  CONSTRAINT journey_metric_bindings_question_survey_fk FOREIGN KEY(question_id,question_survey_id)
    REFERENCES questions(id,survey_id) ON DELETE SET NULL,
  CONSTRAINT journey_metric_bindings_target_shape CHECK(
    (target_type='journey' AND target_id=journey_definition_id AND stage_id IS NULL
      AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='stage' AND stage_id=target_id AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='touchpoint' AND touchpoint_id=target_id AND stage_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='persona' AND persona_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND segment_id IS NULL)
    OR (target_type='segment' AND segment_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND persona_id IS NULL)),
  CONSTRAINT journey_metric_bindings_collector_shape CHECK(
    (collector_id IS NULL AND collector_survey_id IS NULL)
      OR (collector_id IS NOT NULL AND collector_survey_id=survey_id)),
  CONSTRAINT journey_metric_bindings_question_shape CHECK(
    (question_id IS NULL AND question_survey_id IS NULL)
      OR (question_id IS NOT NULL AND question_survey_id=survey_id)),
  CONSTRAINT journey_metric_bindings_survey_shape CHECK(
    (survey_id IS NULL AND survey_space_id IS NULL)
      OR (survey_id IS NOT NULL AND survey_space_id=space_id))
);
CREATE UNIQUE INDEX journey_metric_bindings_active_source_target
  ON journey_metric_bindings(space_id,journey_definition_id,target_type,target_id,source_ref)
  WHERE state='active';
CREATE INDEX journey_metric_bindings_target
  ON journey_metric_bindings(space_id,journey_definition_id,target_type,target_id,updated_at DESC,id);
CREATE INDEX journey_metric_bindings_survey
  ON journey_metric_bindings(space_id,survey_id,collector_id,question_id,id);

CREATE TABLE journey_metric_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey','stage','touchpoint','persona','segment')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  stage_id TEXT,
  touchpoint_id TEXT,
  persona_id TEXT,
  segment_id TEXT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  current_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_definitions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_definitions_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_definitions_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definitions_stage_tenant_fk FOREIGN KEY(stage_id,space_id)
    REFERENCES journey_map_stages(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definitions_touchpoint_tenant_fk FOREIGN KEY(touchpoint_id,space_id)
    REFERENCES journey_map_cards(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definitions_persona_tenant_fk FOREIGN KEY(persona_id,space_id)
    REFERENCES journey_personas(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definitions_segment_tenant_fk FOREIGN KEY(segment_id,space_id)
    REFERENCES journey_metric_segments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definitions_target_shape CHECK(
    (target_type='journey' AND target_id=journey_definition_id AND stage_id IS NULL
      AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='stage' AND stage_id=target_id AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='touchpoint' AND touchpoint_id=target_id AND stage_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
    OR (target_type='persona' AND persona_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND segment_id IS NULL)
    OR (target_type='segment' AND segment_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND persona_id IS NULL))
);
CREATE INDEX journey_metric_definitions_target
  ON journey_metric_definitions(space_id,journey_definition_id,target_type,target_id,state,updated_at DESC,id);

CREATE TABLE journey_metric_definition_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  definition_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('survey','operational_import')),
  binding_id TEXT,
  calculator_kind TEXT NOT NULL CHECK(calculator_kind IN ('nps','csat','ces','operational')),
  aggregation TEXT NOT NULL CHECK(length(aggregation) BETWEEN 1 AND 80),
  direction TEXT NOT NULL CHECK(direction IN ('higher_is_better','lower_is_better','neutral')),
  window_seconds INTEGER NOT NULL CHECK(window_seconds BETWEEN 60 AND 315360000),
  timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80),
  minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 1 AND 100000000),
  freshness_max_age_seconds INTEGER NOT NULL CHECK(freshness_max_age_seconds BETWEEN 1 AND 315360000),
  baseline_value DOUBLE PRECISION,
  target_value DOUBLE PRECISION,
  population_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  formula_json JSONB NOT NULL,
  configuration_json JSONB NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_definition_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_definition_versions_definition_identity UNIQUE(id,definition_id,space_id),
  CONSTRAINT journey_metric_definition_versions_number UNIQUE(definition_id,version_number),
  CONSTRAINT journey_metric_definition_versions_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_definition_versions_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_definition_versions_binding_tenant_fk FOREIGN KEY(binding_id,space_id)
    REFERENCES journey_metric_bindings(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_definition_versions_source_shape CHECK(
    (source_kind='survey' AND binding_id IS NOT NULL AND calculator_kind IN ('nps','csat','ces'))
      OR (source_kind='operational_import' AND binding_id IS NULL AND calculator_kind='operational')),
  CONSTRAINT journey_metric_definition_versions_population_json CHECK(
    jsonb_typeof(population_json)='object' AND octet_length(population_json::text)<=32768),
  CONSTRAINT journey_metric_definition_versions_filters_json CHECK(
    jsonb_typeof(filters_json)='object' AND octet_length(filters_json::text)<=32768),
  CONSTRAINT journey_metric_definition_versions_formula_json CHECK(
    jsonb_typeof(formula_json)='object' AND octet_length(formula_json::text)<=65536),
  CONSTRAINT journey_metric_definition_versions_configuration_json CHECK(
    jsonb_typeof(configuration_json)='object' AND octet_length(configuration_json::text)<=131072)
);
CREATE INDEX journey_metric_definition_versions_history
  ON journey_metric_definition_versions(space_id,definition_id,version_number DESC,id);

ALTER TABLE journey_metric_definitions
  ADD CONSTRAINT journey_metric_definitions_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_metric_definition_versions(id,definition_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_metric_imports (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  definition_version_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  schema_version_id TEXT NOT NULL,
  external_record_sha256 TEXT NOT NULL CHECK(external_record_sha256 ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL CHECK(revision>0),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  subject_id_hmac TEXT NOT NULL CHECK(subject_id_hmac ~ '^[a-f0-9]{64}$'),
  subject_type TEXT NOT NULL CHECK(subject_type IN ('journey_instance','profile','ticket','social_post','custom')),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 128),
  occurred_at TIMESTAMPTZ NOT NULL,
  stage_id TEXT,
  sentiment TEXT CHECK(sentiment IS NULL OR sentiment IN ('positive','neutral','negative','unknown')),
  invalid_reason TEXT CHECK(invalid_reason IS NULL OR octet_length(invalid_reason)<=500),
  source_lineage_json JSONB NOT NULL,
  schema_content_sha256 TEXT NOT NULL CHECK(schema_content_sha256 ~ '^[a-f0-9]{64}$'),
  supersedes_import_id TEXT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_imports_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_imports_idempotency UNIQUE(space_id,idempotency_key),
  -- Revision streams are definition-scoped: one authoritative source record
  -- may feed more than one metric definition without sharing correction state.
  CONSTRAINT journey_metric_imports_source_revision
    UNIQUE(space_id,definition_id,source_id,external_record_sha256,revision),
  CONSTRAINT journey_metric_imports_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_imports_version_tenant_fk FOREIGN KEY(definition_version_id,definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_imports_source_tenant_fk FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_imports_schema_tenant_fk FOREIGN KEY(schema_version_id,source_id,space_id)
    REFERENCES journey_event_schema_versions(id,source_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_imports_supersedes_tenant_fk FOREIGN KEY(supersedes_import_id,space_id)
    REFERENCES journey_metric_imports(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_imports_operation_shape CHECK(
    (operation='upsert' AND invalid_reason IS NULL) OR operation='delete'),
  CONSTRAINT journey_metric_imports_lineage_json CHECK(
    jsonb_typeof(source_lineage_json)='object' AND octet_length(source_lineage_json::text)<=32768)
);
CREATE INDEX journey_metric_imports_definition
  ON journey_metric_imports(space_id,definition_version_id,occurred_at,id);

CREATE TABLE journey_metric_rebuild_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  definition_version_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('manual','source_created','source_corrected','source_deleted','reconcile','scheduled')),
  as_of TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retryable','completed','failed')),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
  observation_id TEXT,
  error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT journey_metric_rebuild_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_rebuild_runs_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_rebuild_runs_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_rebuild_runs_version_tenant_fk FOREIGN KEY(definition_version_id,definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_rebuild_runs_lease_shape CHECK(
    (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_metric_rebuild_runs_completion_shape CHECK(
    (state IN ('completed','failed'))=(completed_at IS NOT NULL))
);
CREATE INDEX journey_metric_rebuild_runs_claim
  ON journey_metric_rebuild_runs(state,available_at,lease_expires_at,space_id,id);
CREATE INDEX journey_metric_rebuild_runs_definition
  ON journey_metric_rebuild_runs(space_id,definition_id,created_at DESC,id);

CREATE TABLE journey_metric_rebuild_attempts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 100),
  lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  status TEXT NOT NULL CHECK(status IN ('succeeded','retryable_failed','terminal_failed','lease_expired')),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_rebuild_attempts_once UNIQUE(run_id,attempt_number,status),
  CONSTRAINT journey_metric_rebuild_attempts_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_metric_rebuild_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_rebuild_attempts_status_shape CHECK(
    (status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
  CONSTRAINT journey_metric_rebuild_attempts_time_order CHECK(completed_at>=started_at)
);
CREATE INDEX journey_metric_rebuild_attempts_history
  ON journey_metric_rebuild_attempts(space_id,run_id,attempt_number,id);

CREATE TABLE journey_metric_observations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  definition_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  supersedes_observation_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('available','unavailable','retracted')),
  value DOUBLE PRECISION,
  unit TEXT NOT NULL CHECK(length(unit) BETWEEN 1 AND 40),
  numerator DOUBLE PRECISION,
  denominator INTEGER NOT NULL CHECK(denominator>=0),
  sample_size INTEGER NOT NULL CHECK(sample_size>=0),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80),
  as_of TIMESTAMPTZ NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK(freshness_status IN ('fresh','stale','unavailable')),
  latest_observed_at TIMESTAMPTZ,
  minimum_sample_warning INTEGER NOT NULL CHECK(minimum_sample_warning IN (0,1)),
  source_count INTEGER NOT NULL CHECK(source_count>=0),
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  result_json JSONB NOT NULL,
  rebuild_run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_observations_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_observations_revision UNIQUE(
    definition_id,definition_version_id,period_start,period_end,revision),
  CONSTRAINT journey_metric_observations_definition_tenant_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_observations_version_tenant_fk FOREIGN KEY(definition_version_id,definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_observations_supersedes_tenant_fk FOREIGN KEY(supersedes_observation_id,space_id)
    REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_observations_run_tenant_fk FOREIGN KEY(rebuild_run_id,space_id)
    REFERENCES journey_metric_rebuild_runs(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_observations_period_order CHECK(period_end>period_start),
  CONSTRAINT journey_metric_observations_status_shape CHECK(
    status='available' OR (value IS NULL AND numerator IS NULL)),
  CONSTRAINT journey_metric_observations_result_json CHECK(
    jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=1048576)
);
CREATE INDEX journey_metric_observations_query
  ON journey_metric_observations(space_id,definition_id,period_end DESC,revision DESC,id);

ALTER TABLE journey_metric_rebuild_runs
  ADD CONSTRAINT journey_metric_rebuild_runs_observation_tenant_fk
  FOREIGN KEY(observation_id,space_id)
  REFERENCES journey_metric_observations(id,space_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_metric_observation_sources (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  observation_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('survey_response','operational_import')),
  source_record_id TEXT NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 128),
  source_revision_sha256 TEXT NOT NULL CHECK(source_revision_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  included INTEGER NOT NULL CHECK(included IN (0,1)),
  exclusion_code TEXT CHECK(exclusion_code IS NULL OR length(exclusion_code)<=100),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_observation_sources_once UNIQUE(observation_id,source_type,source_record_id),
  CONSTRAINT journey_metric_observation_sources_observation_tenant_fk FOREIGN KEY(observation_id,space_id)
    REFERENCES journey_metric_observations(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_metric_observation_sources_lookup
  ON journey_metric_observation_sources(space_id,source_type,source_record_id,observation_id);

CREATE TABLE journey_metric_checkpoints (
  definition_version_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  last_observation_id TEXT,
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_record_count INTEGER NOT NULL CHECK(source_record_count>=0),
  reconciled_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  PRIMARY KEY(definition_version_id,space_id),
  CONSTRAINT journey_metric_checkpoints_version_tenant_fk FOREIGN KEY(definition_version_id,space_id)
    REFERENCES journey_metric_definition_versions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_checkpoints_observation_tenant_fk FOREIGN KEY(last_observation_id,space_id)
    REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT
);

CREATE TABLE journey_metric_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('segment.created','segment.updated','binding.created','binding.updated',
    'definition.created','definition.version_created','rebuild.queued','rebuild.completed','rebuild.failed',
    'import.accepted','import.deleted','observation.read')),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 80),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_audit_events_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=8192)
);
CREATE INDEX journey_metric_audit_history
  ON journey_metric_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_metric_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_metric_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey metric history is append-only' USING ERRCODE='55000';
END
$journey_metric_append_only_guard$;

CREATE TRIGGER journey_metric_definition_versions_append_only
BEFORE UPDATE OR DELETE ON journey_metric_definition_versions
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();
CREATE TRIGGER journey_metric_imports_append_only
BEFORE UPDATE OR DELETE ON journey_metric_imports
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();
CREATE TRIGGER journey_metric_observations_append_only
BEFORE UPDATE OR DELETE ON journey_metric_observations
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();
CREATE TRIGGER journey_metric_observation_sources_append_only
BEFORE UPDATE OR DELETE ON journey_metric_observation_sources
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();
CREATE TRIGGER journey_metric_rebuild_attempts_append_only
BEFORE UPDATE OR DELETE ON journey_metric_rebuild_attempts
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();
CREATE TRIGGER journey_metric_audit_append_only
BEFORE UPDATE OR DELETE ON journey_metric_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_metric_append_only_guard();

INSERT INTO platform_rbac_role_permissions(role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_metrics.read',NULL,CURRENT_TIMESTAMP FROM platform_rbac_roles
WHERE id IN ('admin','editor','viewer')
ON CONFLICT(role_id,permission) DO NOTHING;

INSERT INTO platform_rbac_role_permissions(role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_metrics.manage',NULL,CURRENT_TIMESTAMP FROM platform_rbac_roles
WHERE id IN ('admin','editor')
ON CONFLICT(role_id,permission) DO NOTHING;

-- Add only missing plan keys so administrators' existing custom limits remain
-- authoritative.  The server-secret scope remains `events:write`; metric
-- imports additionally require the exact source/environment, a published
-- schema and an explicit source/schema lineage in the target definition.
UPDATE platform_subscription_plans SET
  limits_json=(limits_json::jsonb || (
    CASE code
      WHEN 'starter' THEN '{"journeyMetricDefinitions":0,"journeyMetricBindings":0,"journeyMetricSegments":0,"monthlyJourneyMetricImports":0}'::jsonb
      WHEN 'team' THEN '{"journeyMetricDefinitions":100,"journeyMetricBindings":250,"journeyMetricSegments":100,"monthlyJourneyMetricImports":50000}'::jsonb
      ELSE '{"journeyMetricDefinitions":10000,"journeyMetricBindings":50000,"journeyMetricSegments":5000,"monthlyJourneyMetricImports":10000000}'::jsonb
    END - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');
