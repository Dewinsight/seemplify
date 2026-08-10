-- Runtime schema 45: governed journey-event to stage-intelligence adapter.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>44 THEN
    RAISE EXCEPTION 'runtime-45 journey event stage intelligence adapter requires runtime-44' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_event_intelligence_mappings (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_name TEXT NOT NULL CHECK(event_name ~ '^[a-z][a-z0-9_]{0,127}$'),
  state TEXT NOT NULL CHECK(state IN ('draft','active','retired')), current_version_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id), UNIQUE(space_id,source_id,environment,event_name),
  FOREIGN KEY(source_id,space_id,environment) REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CHECK((state='draft' AND current_version_id IS NULL) OR (state IN ('active','retired') AND current_version_id IS NOT NULL)),
  CHECK(updated_at>=created_at)
);

-- Event-derived metrics are operational calculations, but retain a distinct
-- immutable source kind so their provenance cannot masquerade as an import.
ALTER TABLE journey_metric_definition_versions DROP CONSTRAINT journey_metric_definition_versions_source_shape;
ALTER TABLE journey_metric_definition_versions DROP CONSTRAINT journey_metric_definition_versions_source_kind_check;
ALTER TABLE journey_metric_definition_versions ADD CONSTRAINT journey_metric_definition_versions_source_kind_check
  CHECK(source_kind IN ('survey','operational_import','journey_event'));
ALTER TABLE journey_metric_definition_versions ADD CONSTRAINT journey_metric_definition_versions_source_shape CHECK(
  (source_kind='survey' AND binding_id IS NOT NULL AND calculator_kind IN ('nps','csat','ces'))
  OR (source_kind IN ('operational_import','journey_event') AND binding_id IS NULL AND calculator_kind='operational'));

CREATE TABLE journey_event_intelligence_mapping_versions (
  id TEXT PRIMARY KEY, mapping_id TEXT NOT NULL, space_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number>0),
  source_id TEXT NOT NULL, schema_version_id TEXT NOT NULL, journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL, stage_key TEXT NOT NULL, stage_rule_version_id TEXT NOT NULL,
  stage_rule_definition_id TEXT NOT NULL, metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT NOT NULL,
  metric_definition_version_sha256 TEXT NOT NULL CHECK(metric_definition_version_sha256 ~ '^[a-f0-9]{64}$'),
  metric_unit TEXT NOT NULL CHECK(metric_unit IN ('score','percent','count','seconds','minutes','hours','rate','index','currency','unknown')),
  value_mode TEXT NOT NULL CHECK(value_mode IN ('count','constant','numeric_property','elapsed_since_prior')),
  constant_value DOUBLE PRECISION, numeric_property_path TEXT,
  dimension_keys_json JSONB NOT NULL CHECK(dimension_keys_json <@ '["channel","environment"]'::jsonb
    AND jsonb_typeof(dimension_keys_json)='array' AND jsonb_array_length(dimension_keys_json)<=2),
  consent_requirement TEXT NOT NULL CHECK(consent_requirement IN ('granted','granted_or_not_required')),
  purpose TEXT NOT NULL CHECK(purpose IN ('service_improvement','analytics','research')),
  retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 3650), projection_version TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(mapping_id,version_number), UNIQUE(id,mapping_id,space_id),
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_event_intelligence_mappings(id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(schema_version_id,source_id,space_id) REFERENCES journey_event_schema_versions(id,source_id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id) REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(stage_rule_version_id,stage_rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key)
    REFERENCES journey_stage_rule_versions(id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key) ON DELETE RESTRICT,
  FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CHECK((value_mode='constant' AND constant_value IS NOT NULL AND numeric_property_path IS NULL)
    OR (value_mode='numeric_property' AND constant_value IS NULL AND numeric_property_path ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,7}$')
    OR (value_mode IN ('count','elapsed_since_prior') AND constant_value IS NULL AND numeric_property_path IS NULL)),
  CHECK(length(projection_version) BETWEEN 1 AND 128)
);
ALTER TABLE journey_event_intelligence_mappings ADD CONSTRAINT journey_event_intelligence_mappings_current_fk
  FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_event_intelligence_mapping_versions(id,mapping_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_event_intelligence_erasure_handles (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION, subject_id_hmac TEXT NOT NULL CHECK(subject_id_hmac ~ '^[a-f0-9]{64}$'),
  command_id_sha256 TEXT NOT NULL CHECK(command_id_sha256 ~ '^[a-f0-9]{64}$'), erased_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,subject_id_hmac)
);

CREATE TABLE journey_event_intelligence_outbox (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  mapping_version_id TEXT NOT NULL, source_visit_id TEXT NOT NULL, source_decision_id TEXT NOT NULL,
  raw_received_at TIMESTAMPTZ NOT NULL, raw_event_id TEXT NOT NULL,
  source_envelope_sha256 TEXT NOT NULL CHECK(source_envelope_sha256 ~ '^[a-f0-9]{64}$'),
  source_id TEXT NOT NULL, schema_version_id TEXT NOT NULL,
  journey_definition_id TEXT NOT NULL, journey_map_version_id TEXT NOT NULL, stage_rule_version_id TEXT NOT NULL,
  stage_rule_definition_id TEXT NOT NULL, mapping_content_sha256 TEXT NOT NULL CHECK(mapping_content_sha256 ~ '^[a-f0-9]{64}$'),
  stage_key TEXT NOT NULL, metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT NOT NULL,
  metric_definition_version_sha256 TEXT NOT NULL, metric_unit TEXT NOT NULL, projection_version TEXT NOT NULL,
  subject_id_hmac TEXT NOT NULL CHECK(subject_id_hmac ~ '^[a-f0-9]{64}$'), value_mode TEXT NOT NULL,
  value DOUBLE PRECISION, dimensions_json JSONB NOT NULL CHECK(jsonb_typeof(dimensions_json)='object'
    AND NOT(dimensions_json ?| ARRAY['text','rawText','raw_text','content','body','message','email','name'])),
  occurred_at TIMESTAMPTZ NOT NULL, consent_state TEXT NOT NULL, purpose TEXT NOT NULL,
  raw_retention_expires_at TIMESTAMPTZ NOT NULL, visit_retention_expires_at TIMESTAMPTZ NOT NULL,
  mapping_retention_days INTEGER NOT NULL CHECK(mapping_retention_days BETWEEN 1 AND 3650),
  retention_expires_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL CHECK(state IN ('ready','blocked','materialized','tombstoned')),
  block_reason TEXT CHECK(block_reason IS NULL OR block_reason IN
    ('consent_denied','consent_unknown','retention_expired','privacy_erased','numeric_value_invalid')),
  created_at TIMESTAMPTZ NOT NULL, materialized_fact_id TEXT,
  UNIQUE(mapping_version_id,source_visit_id),
  FOREIGN KEY(mapping_version_id) REFERENCES journey_event_intelligence_mapping_versions(id) ON DELETE NO ACTION,
  FOREIGN KEY(source_visit_id) REFERENCES journey_anonymous_stage_visits(id) ON DELETE NO ACTION,
  CHECK((state='blocked')=(block_reason IS NOT NULL)), CHECK(state='blocked' OR retention_expires_at>created_at),
  CHECK(value IS NULL OR value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
CREATE INDEX journey_event_intelligence_outbox_claim ON journey_event_intelligence_outbox(state,created_at,space_id,id);

CREATE TABLE journey_event_intelligence_materialization_state (
  mapping_version_id TEXT NOT NULL REFERENCES journey_event_intelligence_mapping_versions(id) ON DELETE NO ACTION,
  space_id TEXT NOT NULL, subject_id_hmac TEXT NOT NULL, stage_key TEXT NOT NULL,
  last_occurred_at TIMESTAMPTZ NOT NULL, last_outbox_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(mapping_version_id,space_id,subject_id_hmac,stage_key)
);

CREATE TABLE journey_event_intelligence_tombstones (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  source_outbox_id TEXT NOT NULL REFERENCES journey_event_intelligence_outbox(id) ON DELETE NO ACTION,
  reason TEXT NOT NULL CHECK(reason IN ('correction','reprojection','privacy_erasure','retention_expiry')),
  correction_ref_sha256 TEXT NOT NULL CHECK(correction_ref_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(source_outbox_id,reason,correction_ref_sha256)
);

CREATE OR REPLACE FUNCTION journey_event_intelligence_enqueue_visit()
RETURNS trigger LANGUAGE plpgsql AS $enqueue$
DECLARE raw_row journey_raw_events%ROWTYPE; instance_row journey_anonymous_instances%ROWTYPE; mapping_row RECORD;
  derived_value DOUBLE PRECISION; derived_state TEXT; derived_reason TEXT; derived_dimensions JSONB;
BEGIN
  SELECT * INTO raw_row FROM journey_raw_events WHERE received_at=NEW.raw_received_at AND id=NEW.raw_event_id;
  SELECT * INTO instance_row FROM journey_anonymous_instances WHERE id=NEW.instance_id AND space_id=NEW.space_id;
  FOR mapping_row IN SELECT version.* FROM journey_event_intelligence_mappings mapping
    JOIN journey_event_intelligence_mapping_versions version ON version.id=mapping.current_version_id
    WHERE mapping.space_id=NEW.space_id AND mapping.source_id=NEW.source_id AND mapping.environment=NEW.environment
      AND mapping.event_name=raw_row.event_name AND mapping.state='active' AND version.schema_version_id=raw_row.schema_version_id
      AND version.journey_definition_id=NEW.journey_definition_id AND version.journey_map_version_id=NEW.journey_map_version_id
      AND version.stage_rule_version_id=NEW.rule_version_id AND version.stage_key=NEW.stage_key
  LOOP
    derived_state:='ready'; derived_reason:=NULL; derived_value:=NULL;
    IF EXISTS(SELECT 1 FROM journey_event_intelligence_erasure_handles erased
      WHERE erased.space_id=NEW.space_id AND erased.subject_id_hmac=instance_row.anonymous_id_hash) THEN
      derived_state:='blocked'; derived_reason:='privacy_erased';
    ELSIF raw_row.retention_expires_at<=CURRENT_TIMESTAMP OR NEW.retention_expires_at<=CURRENT_TIMESTAMP THEN
      derived_state:='blocked'; derived_reason:='retention_expired';
    ELSIF raw_row.consent_state IN ('denied','partial') THEN derived_state:='blocked'; derived_reason:='consent_denied';
    ELSIF raw_row.consent_state='unknown' OR
      (mapping_row.consent_requirement='granted' AND raw_row.consent_state<>'granted') THEN
      derived_state:='blocked'; derived_reason:='consent_unknown';
    ELSIF mapping_row.value_mode='count' THEN derived_value:=1;
    ELSIF mapping_row.value_mode='constant' THEN derived_value:=mapping_row.constant_value;
    ELSIF mapping_row.value_mode='numeric_property' THEN
      BEGIN derived_value:=(raw_row.payload_json #>> string_to_array(mapping_row.numeric_property_path,'.'))::DOUBLE PRECISION;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        derived_state:='blocked'; derived_reason:='numeric_value_invalid'; derived_value:=NULL;
      END;
    END IF;
    derived_dimensions:=jsonb_strip_nulls(jsonb_build_object(
      'channel',CASE WHEN mapping_row.dimension_keys_json ? 'channel' THEN raw_row.channel END,
      'environment',CASE WHEN mapping_row.dimension_keys_json ? 'environment' THEN NEW.environment END));
    INSERT INTO journey_event_intelligence_outbox(id,space_id,mapping_version_id,source_visit_id,source_decision_id,
      raw_received_at,raw_event_id,source_envelope_sha256,source_id,schema_version_id,journey_definition_id,journey_map_version_id,stage_rule_version_id,
      stage_rule_definition_id,mapping_content_sha256,
      stage_key,metric_definition_id,metric_definition_version_id,metric_definition_version_sha256,metric_unit,projection_version,
      subject_id_hmac,value_mode,value,dimensions_json,occurred_at,consent_state,purpose,raw_retention_expires_at,
      visit_retention_expires_at,mapping_retention_days,retention_expires_at,state,block_reason,created_at)
    VALUES(mapping_row.id||':'||NEW.id,NEW.space_id,mapping_row.id,NEW.id,NEW.decision_id,NEW.raw_received_at,NEW.raw_event_id,
      raw_row.envelope_sha256,NEW.source_id,raw_row.schema_version_id,NEW.journey_definition_id,NEW.journey_map_version_id,NEW.rule_version_id,
      NEW.rule_definition_id,mapping_row.content_sha256,NEW.stage_key,
      mapping_row.metric_definition_id,mapping_row.metric_definition_version_id,mapping_row.metric_definition_version_sha256,
      mapping_row.metric_unit,mapping_row.projection_version,instance_row.anonymous_id_hash,mapping_row.value_mode,derived_value,
      derived_dimensions,NEW.event_occurred_at,raw_row.consent_state,mapping_row.purpose,raw_row.retention_expires_at,
      NEW.retention_expires_at,mapping_row.retention_days,
      LEAST(raw_row.retention_expires_at,NEW.retention_expires_at,NEW.created_at+(mapping_row.retention_days||' days')::interval),
      derived_state,derived_reason,NEW.created_at) ON CONFLICT(mapping_version_id,source_visit_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $enqueue$;
REVOKE ALL ON FUNCTION journey_event_intelligence_enqueue_visit() FROM PUBLIC;
CREATE TRIGGER journey_event_intelligence_visit_outbox AFTER INSERT ON journey_anonymous_stage_visits
  FOR EACH ROW EXECUTE FUNCTION journey_event_intelligence_enqueue_visit();

CREATE TRIGGER journey_event_intelligence_mapping_versions_append_only BEFORE UPDATE OR DELETE ON journey_event_intelligence_mapping_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_event_intelligence_tombstones_append_only BEFORE UPDATE OR DELETE ON journey_event_intelligence_tombstones
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_event_intelligence_erasure_handles_append_only BEFORE UPDATE OR DELETE ON journey_event_intelligence_erasure_handles
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
