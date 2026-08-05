-- Runtime schema 18: published stage rules and durable anonymous journey projections.
--
-- This slice deliberately does not merge known identities. An anonymous
-- journey instance is scoped by tenant, source, environment, journey and the
-- HMAC identity emitted by runtime 17. Decisions and visits are immutable
-- facts; only the worker inbox, rule drafts and instance watermark are mutable.

DO $journey_stage_processing_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>17 THEN
    RAISE EXCEPTION 'runtime-18 stage processing requires the checksummed runtime-17 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_stage_processing_predecessor$;

-- Runtime 16 originally treated compatibility_json as immutable even though
-- publishing computes and stores the compatibility result. Keep all schema
-- content immutable, but permit that value to change exactly once as part of
-- the audited draft -> published transition. Lifecycle actors and timestamps
-- are transition-bound and cannot be backfilled, cleared or rewritten later.
CREATE OR REPLACE FUNCTION journey_event_schema_version_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $journey_event_schema_version_immutable_guard$
DECLARE
  is_publish BOOLEAN;
  is_deprecate BOOLEAN;
BEGIN
  is_publish := OLD.state='draft' AND NEW.state='published';
  is_deprecate := OLD.state='published' AND NEW.state='deprecated';

  IF ROW(OLD.schema_id,OLD.source_id,OLD.space_id,OLD.version,OLD.version_major,OLD.version_minor,
      OLD.properties_json,OLD.content_sha256,OLD.idempotency_key,OLD.intent_hash,OLD.created_at)
    IS DISTINCT FROM
    ROW(NEW.schema_id,NEW.source_id,NEW.space_id,NEW.version,NEW.version_major,NEW.version_minor,
      NEW.properties_json,NEW.content_sha256,NEW.idempotency_key,NEW.intent_hash,NEW.created_at) THEN
    RAISE EXCEPTION 'journey event schema version content is immutable after insert'
      USING ERRCODE='55000';
  END IF;

  IF OLD.state<>NEW.state AND NOT (
    is_publish OR is_deprecate
    OR (OLD.state='deprecated' AND NEW.state='retired')) THEN
    RAISE EXCEPTION 'invalid journey event schema version lifecycle transition: % -> %',OLD.state,NEW.state
      USING ERRCODE='23514';
  END IF;

  IF NEW.compatibility_json IS DISTINCT FROM OLD.compatibility_json AND NOT is_publish THEN
    RAISE EXCEPTION 'compatibility_json may change only while publishing a draft schema version'
      USING ERRCODE='55000';
  END IF;

  IF is_publish THEN
    IF OLD.published_by_user_id IS NOT NULL OR OLD.published_at IS NOT NULL
      OR NEW.published_by_user_id IS NULL OR NEW.published_at IS NULL THEN
      RAISE EXCEPTION 'published_by_user_id and published_at must be set exactly on draft publication'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
    OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'publication attribution is immutable outside draft publication'
      USING ERRCODE='55000';
  END IF;

  IF is_deprecate THEN
    IF OLD.deprecated_by_user_id IS NOT NULL OR OLD.deprecated_at IS NOT NULL
      OR NEW.deprecated_by_user_id IS NULL OR NEW.deprecated_at IS NULL THEN
      RAISE EXCEPTION 'deprecated_by_user_id and deprecated_at must be set exactly on schema deprecation'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.deprecated_by_user_id IS DISTINCT FROM OLD.deprecated_by_user_id
    OR NEW.deprecated_at IS DISTINCT FROM OLD.deprecated_at THEN
    RAISE EXCEPTION 'deprecation attribution is immutable outside published deprecation'
      USING ERRCODE='55000';
  END IF;

  RETURN NEW;
END
$journey_event_schema_version_immutable_guard$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_definitions_tenant_identity
  ON journey_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_map_versions_tenant_definition_identity
  ON journey_map_versions(id,definition_id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_map_stages_tenant_version_key
  ON journey_map_stages(version_id,stage_key,space_id);

CREATE TABLE journey_stage_rule_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  draft_version_id TEXT,
  published_version_id TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id,journey_definition_id),
  CONSTRAINT journey_stage_rule_definitions_journey_tenant_fk
    FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_stage_rule_definitions_journey
  ON journey_stage_rule_definitions(space_id,journey_definition_id,updated_at DESC,id);

CREATE TABLE journey_stage_rule_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  rule_definition_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL,
  stage_key TEXT NOT NULL CHECK(length(stage_key) BETWEEN 1 AND 128),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  state TEXT NOT NULL CHECK(state IN ('draft','published','retired')),
  role TEXT NOT NULL CHECK(role IN ('entry','progress','success','failure','exit')),
  priority INTEGER NOT NULL CHECK(priority BETWEEN -1000000 AND 1000000),
  event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 128),
  source_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  environments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  predicates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_prior_events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_event_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  UNIQUE(rule_definition_id,version_number),
  UNIQUE(id,rule_definition_id,space_id,journey_definition_id),
  UNIQUE(id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key),
  CONSTRAINT journey_stage_rule_versions_definition_tenant_fk
    FOREIGN KEY(rule_definition_id,space_id,journey_definition_id)
    REFERENCES journey_stage_rule_definitions(id,space_id,journey_definition_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_rule_versions_map_tenant_fk
    FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_versions_stage_tenant_fk
    FOREIGN KEY(journey_map_version_id,stage_key,space_id)
    REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_versions_time_order CHECK(
    expires_at IS NULL OR effective_at IS NULL OR expires_at>effective_at),
  CONSTRAINT journey_stage_rule_versions_state_shape CHECK(
    (state='draft' AND published_at IS NULL AND published_by_user_id IS NULL)
    OR (state IN ('published','retired') AND published_at IS NOT NULL)) ,
  CONSTRAINT journey_stage_rule_versions_json_shape CHECK(
    jsonb_typeof(source_ids_json)='array' AND jsonb_array_length(source_ids_json)<=100
    AND jsonb_typeof(environments_json)='array' AND jsonb_array_length(environments_json)<=3
    AND jsonb_typeof(predicates_json)='array' AND jsonb_array_length(predicates_json)<=20
    AND jsonb_typeof(required_prior_events_json)='array' AND jsonb_array_length(required_prior_events_json)<=20
    AND jsonb_typeof(excluded_event_names_json)='array' AND jsonb_array_length(excluded_event_names_json)<=100
    AND octet_length(source_ids_json::text)<=16384
    AND octet_length(predicates_json::text)<=65536
    AND octet_length(required_prior_events_json::text)<=32768
    AND octet_length(excluded_event_names_json::text)<=16384)
);
CREATE UNIQUE INDEX journey_stage_rule_versions_one_draft
  ON journey_stage_rule_versions(rule_definition_id) WHERE state='draft';
CREATE UNIQUE INDEX journey_stage_rule_versions_one_published
  ON journey_stage_rule_versions(rule_definition_id) WHERE state='published';
CREATE INDEX journey_stage_rule_versions_runtime
  ON journey_stage_rule_versions(space_id,event_name,state,journey_definition_id,priority DESC,id);

ALTER TABLE journey_stage_rule_definitions
  ADD CONSTRAINT journey_stage_rule_definitions_draft_version_fk
  FOREIGN KEY(draft_version_id,id,space_id,journey_definition_id)
  REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE journey_stage_rule_definitions
  ADD CONSTRAINT journey_stage_rule_definitions_published_version_fk
  FOREIGN KEY(published_version_id,id,space_id,journey_definition_id)
  REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_stage_rule_decisions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  decision_key TEXT NOT NULL UNIQUE CHECK(length(decision_key)=64),
  raw_received_at TIMESTAMPTZ NOT NULL,
  raw_event_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT NOT NULL,
  journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL,
  subject_kind TEXT CHECK(subject_kind IS NULL OR subject_kind='anonymous'),
  anonymous_id_hash TEXT CHECK(anonymous_id_hash IS NULL OR length(anonymous_id_hash)=64),
  outcome TEXT NOT NULL CHECK(outcome IN ('matched','no_match','skipped_no_anonymous_subject')),
  matched_rule_definition_id TEXT,
  matched_rule_version_id TEXT,
  matched_rule_version_number INTEGER,
  stage_key TEXT,
  role TEXT CHECK(role IS NULL OR role IN ('entry','progress','success','failure','exit')),
  event_occurred_at TIMESTAMPTZ NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  is_out_of_order BOOLEAN NOT NULL DEFAULT FALSE,
  rule_set_sha256 TEXT NOT NULL CHECK(length(rule_set_sha256)=64),
  trace_json JSONB NOT NULL,
  provenance_json JSONB NOT NULL,
  processor TEXT NOT NULL,
  processor_version TEXT NOT NULL,
  lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(raw_received_at,raw_event_id,journey_definition_id),
  UNIQUE(id,space_id,source_id,environment,journey_definition_id,raw_received_at,raw_event_id),
  CONSTRAINT journey_stage_rule_decisions_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_decisions_map_tenant_fk
    FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_decisions_rule_tenant_fk
    FOREIGN KEY(matched_rule_version_id,matched_rule_definition_id,space_id,journey_definition_id,
      journey_map_version_id,stage_key)
    REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id,
      journey_map_version_id,stage_key) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_decisions_stage_tenant_fk
    FOREIGN KEY(journey_map_version_id,stage_key,space_id)
    REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_rule_decisions_match_shape CHECK(
    (outcome='matched' AND matched_rule_definition_id IS NOT NULL AND matched_rule_version_id IS NOT NULL
      AND matched_rule_version_number IS NOT NULL AND stage_key IS NOT NULL AND role IS NOT NULL)
    OR (outcome<>'matched' AND matched_rule_definition_id IS NULL AND matched_rule_version_id IS NULL
      AND matched_rule_version_number IS NULL AND stage_key IS NULL AND role IS NULL)),
  CONSTRAINT journey_stage_rule_decisions_subject_shape CHECK(
    (outcome='skipped_no_anonymous_subject' AND subject_kind IS NULL AND anonymous_id_hash IS NULL)
    OR (outcome<>'skipped_no_anonymous_subject' AND subject_kind='anonymous' AND anonymous_id_hash IS NOT NULL)),
  CONSTRAINT journey_stage_rule_decisions_json_shape CHECK(
    jsonb_typeof(trace_json)='object' AND octet_length(trace_json::text)<=262144
    AND jsonb_typeof(provenance_json)='object' AND octet_length(provenance_json::text)<=65536),
  CONSTRAINT journey_stage_rule_decisions_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_stage_rule_decisions_explain
  ON journey_stage_rule_decisions(space_id,journey_definition_id,evaluated_at DESC,id);
CREATE INDEX journey_stage_rule_decisions_raw
  ON journey_stage_rule_decisions(space_id,source_id,raw_received_at,raw_event_id);

CREATE TABLE journey_anonymous_instances (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  journey_definition_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL DEFAULT 'anonymous' CHECK(subject_kind='anonymous'),
  anonymous_id_hash TEXT NOT NULL CHECK(length(anonymous_id_hash)=64),
  state TEXT NOT NULL CHECK(state IN ('active','succeeded','failed','exited')),
  current_stage_key TEXT,
  first_event_at TIMESTAMPTZ NOT NULL,
  latest_event_at TIMESTAMPTZ NOT NULL,
  latest_event_id TEXT NOT NULL CHECK(length(latest_event_id) BETWEEN 1 AND 200),
  latest_visit_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,source_id,environment,journey_definition_id,anonymous_id_hash),
  UNIQUE(id,space_id,source_id,environment,journey_definition_id),
  CONSTRAINT journey_anonymous_instances_source_tenant_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_anonymous_instances_journey_tenant_fk
    FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_anonymous_instances_time_order CHECK(latest_event_at>=first_event_at),
  CONSTRAINT journey_anonymous_instances_current_visit_shape CHECK(
    (latest_visit_id IS NULL)=(current_stage_key IS NULL))
);
CREATE INDEX journey_anonymous_instances_journey
  ON journey_anonymous_instances(space_id,journey_definition_id,updated_at DESC,id);

CREATE TABLE journey_anonymous_stage_visits (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  assignment_key TEXT NOT NULL UNIQUE CHECK(length(assignment_key)=64),
  instance_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  raw_received_at TIMESTAMPTZ NOT NULL,
  raw_event_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_id TEXT NOT NULL,
  journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL DEFAULT 'anonymous' CHECK(subject_kind='anonymous'),
  stage_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('entry','progress','success','failure','exit')),
  rule_definition_id TEXT NOT NULL,
  rule_version_id TEXT NOT NULL,
  rule_version_number INTEGER NOT NULL CHECK(rule_version_number>0),
  event_occurred_at TIMESTAMPTZ NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  is_out_of_order BOOLEAN NOT NULL DEFAULT FALSE,
  applied_to_current BOOLEAN NOT NULL,
  non_application_reason TEXT CHECK(non_application_reason IS NULL OR non_application_reason IN
    ('out_of_order','terminal_absorbing')),
  prior_stage_key TEXT,
  provenance_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(raw_received_at,raw_event_id,journey_definition_id),
  UNIQUE(id,instance_id,space_id,source_id,environment,journey_definition_id),
  UNIQUE(id,instance_id,space_id,source_id,environment,journey_definition_id,stage_key),
  CONSTRAINT journey_anonymous_stage_visits_decision_tenant_fk
    FOREIGN KEY(decision_id,space_id,source_id,environment,journey_definition_id,raw_received_at,raw_event_id)
    REFERENCES journey_stage_rule_decisions(id,space_id,source_id,environment,journey_definition_id,
      raw_received_at,raw_event_id) ON DELETE RESTRICT,
  CONSTRAINT journey_anonymous_stage_visits_instance_tenant_fk
    FOREIGN KEY(instance_id,space_id,source_id,environment,journey_definition_id)
    REFERENCES journey_anonymous_instances(id,space_id,source_id,environment,journey_definition_id) ON DELETE RESTRICT,
  CONSTRAINT journey_anonymous_stage_visits_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id) ON DELETE RESTRICT,
  CONSTRAINT journey_anonymous_stage_visits_map_stage_tenant_fk
    FOREIGN KEY(journey_map_version_id,stage_key,space_id)
    REFERENCES journey_map_stages(version_id,stage_key,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_anonymous_stage_visits_rule_tenant_fk
    FOREIGN KEY(rule_version_id,rule_definition_id,space_id,journey_definition_id,
      journey_map_version_id,stage_key)
    REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id,
      journey_map_version_id,stage_key) ON DELETE RESTRICT,
  CONSTRAINT journey_anonymous_stage_visits_provenance_shape CHECK(
    jsonb_typeof(provenance_json)='object' AND octet_length(provenance_json::text)<=65536),
  CONSTRAINT journey_anonymous_stage_visits_application_shape CHECK(
    (applied_to_current AND non_application_reason IS NULL)
    OR (NOT applied_to_current AND non_application_reason IS NOT NULL)),
  CONSTRAINT journey_anonymous_stage_visits_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_anonymous_stage_visits_timeline
  ON journey_anonymous_stage_visits(space_id,journey_definition_id,instance_id,event_occurred_at,id);

ALTER TABLE journey_anonymous_instances
  ADD CONSTRAINT journey_anonymous_instances_latest_visit_fk
  FOREIGN KEY(latest_visit_id,id,space_id,source_id,environment,journey_definition_id,current_stage_key)
  REFERENCES journey_anonymous_stage_visits(id,instance_id,space_id,source_id,environment,journey_definition_id,stage_key)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_stage_rule_audit_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  rule_definition_id TEXT,
  rule_version_id TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('rule.created','rule.draft_updated','rule.published','rule.retired','rule.simulated','decision.viewed')),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_stage_rule_audit_journey_tenant_fk
    FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_rule_audit_detail_shape CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=16384)
);
CREATE INDEX journey_stage_rule_audit_history
  ON journey_stage_rule_audit_events(space_id,journey_definition_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_stage_rule_version_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_stage_rule_version_guard$
BEGIN
  IF OLD.state IN ('published','retired') THEN
    IF OLD.state='published' AND NEW.state='retired'
      AND ROW(NEW.id,NEW.rule_definition_id,NEW.space_id,NEW.journey_definition_id,
        NEW.journey_map_version_id,NEW.stage_key,NEW.version_number,NEW.role,NEW.priority,NEW.event_name,
        NEW.source_ids_json,NEW.environments_json,NEW.predicates_json,NEW.required_prior_events_json,
        NEW.excluded_event_names_json,NEW.effective_at,NEW.expires_at,NEW.revision,NEW.content_sha256,
        NEW.created_by_user_id,NEW.published_by_user_id,NEW.created_at,NEW.published_at)
      IS NOT DISTINCT FROM
        ROW(OLD.id,OLD.rule_definition_id,OLD.space_id,OLD.journey_definition_id,
        OLD.journey_map_version_id,OLD.stage_key,OLD.version_number,OLD.role,OLD.priority,OLD.event_name,
        OLD.source_ids_json,OLD.environments_json,OLD.predicates_json,OLD.required_prior_events_json,
        OLD.excluded_event_names_json,OLD.effective_at,OLD.expires_at,OLD.revision,OLD.content_sha256,
        OLD.created_by_user_id,OLD.published_by_user_id,OLD.created_at,OLD.published_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'published journey stage-rule versions are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$journey_stage_rule_version_guard$;
CREATE TRIGGER journey_stage_rule_version_guard_trigger
  BEFORE UPDATE OR DELETE ON journey_stage_rule_versions
  FOR EACH ROW EXECUTE FUNCTION journey_stage_rule_version_guard();

CREATE TRIGGER journey_stage_rule_decisions_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_stage_rule_decisions
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_anonymous_stage_visits_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_anonymous_stage_visits
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_stage_rule_audit_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_stage_rule_audit_events
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
