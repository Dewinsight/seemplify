-- Runtime schema 33: deterministic actual-path intelligence and reviewed stage inference.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>32 THEN
    RAISE EXCEPTION 'runtime-33 actual-path intelligence requires runtime-32' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_path_intelligence_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL, journey_map_version_id TEXT NOT NULL,
  subject_scope TEXT NOT NULL CHECK(subject_scope IN ('anonymous_only','known_profiles')),
  period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL, as_of TIMESTAMPTZ NOT NULL,
  minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size>0),
  secondary_suppression_threshold INTEGER NOT NULL CHECK(secondary_suppression_threshold>0),
  detector_version TEXT NOT NULL CHECK(length(detector_version) BETWEEN 1 AND 100),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=1048576),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_path_intelligence_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_path_intelligence_runs_subject_identity UNIQUE(id,space_id,journey_definition_id,journey_map_version_id),
  CONSTRAINT journey_path_intelligence_runs_definition_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_path_intelligence_runs_version_fk FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_path_intelligence_runs_window_order CHECK(period_end>=period_start AND as_of>=period_start),
  CONSTRAINT journey_path_intelligence_runs_dedup UNIQUE(space_id,journey_definition_id,journey_map_version_id,
    subject_scope,period_start,period_end,as_of,minimum_sample_size,secondary_suppression_threshold,detector_version,content_sha256)
);
CREATE INDEX journey_path_intelligence_runs_history
  ON journey_path_intelligence_runs(space_id,journey_definition_id,created_at DESC,id);

CREATE TABLE journey_stage_inference_recommendations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128), run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, journey_definition_id TEXT NOT NULL,
  journey_map_version_id TEXT NOT NULL, recommendation_key TEXT NOT NULL CHECK(length(recommendation_key) BETWEEN 1 AND 300),
  content_json JSONB NOT NULL CHECK(jsonb_typeof(content_json)='object' AND octet_length(content_json::text)<=131072),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('draft','in_review','accepted','rejected','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_reason TEXT CHECK(review_reason IS NULL OR length(review_reason) BETWEEN 3 AND 2000),
  reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_stage_inference_recommendations_tenant_identity UNIQUE(id,run_id,space_id),
  CONSTRAINT journey_stage_inference_recommendations_once UNIQUE(run_id,recommendation_key),
  CONSTRAINT journey_stage_inference_recommendations_run_fk FOREIGN KEY(run_id,space_id,journey_definition_id,journey_map_version_id)
    REFERENCES journey_path_intelligence_runs(id,space_id,journey_definition_id,journey_map_version_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_inference_recommendations_review_shape CHECK(
    (state='draft' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (state<>'draft' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL)),
  CONSTRAINT journey_stage_inference_recommendations_time_order CHECK(updated_at>=created_at AND (reviewed_at IS NULL OR reviewed_at>=created_at))
);
CREATE INDEX journey_stage_inference_recommendations_history
  ON journey_stage_inference_recommendations(space_id,journey_definition_id,state,created_at DESC,id);

CREATE TABLE journey_path_intelligence_audit (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128), space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL, recommendation_id TEXT, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('recommendation.created','recommendation.reviewed')),
  from_state TEXT, to_state TEXT, revision INTEGER CHECK(revision IS NULL OR revision>0),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=32768),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_path_intelligence_audit_run_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_path_intelligence_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_path_intelligence_audit_recommendation_fk FOREIGN KEY(recommendation_id,run_id,space_id)
    REFERENCES journey_stage_inference_recommendations(id,run_id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_path_intelligence_audit_history ON journey_path_intelligence_audit(space_id,run_id,created_at,id);

CREATE TRIGGER journey_path_intelligence_runs_append_only BEFORE UPDATE OR DELETE ON journey_path_intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_path_intelligence_audit_append_only BEFORE UPDATE OR DELETE ON journey_path_intelligence_audit
  FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();

CREATE OR REPLACE FUNCTION journey_stage_inference_content_guard()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF ROW(NEW.run_id,NEW.space_id,NEW.journey_definition_id,NEW.journey_map_version_id,NEW.recommendation_key,
      NEW.content_json,NEW.content_sha256,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.run_id,OLD.space_id,OLD.journey_definition_id,OLD.journey_map_version_id,OLD.recommendation_key,
      OLD.content_json,OLD.content_sha256,OLD.created_at) THEN
    RAISE EXCEPTION 'Stage inference recommendation content is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_stage_inference_content_guard BEFORE UPDATE ON journey_stage_inference_recommendations
  FOR EACH ROW EXECUTE FUNCTION journey_stage_inference_content_guard();
REVOKE EXECUTE ON FUNCTION journey_stage_inference_content_guard() FROM PUBLIC;
