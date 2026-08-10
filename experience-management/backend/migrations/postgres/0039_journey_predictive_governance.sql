-- Runtime schema 39: approved predictive governance evidence and abstention-first decision records.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>38 THEN
    RAISE EXCEPTION 'runtime-39 journey predictive governance requires runtime-38' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_prediction_policies (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK(target IN ('churn','conversion')),
  enabled BOOLEAN NOT NULL, purpose TEXT NOT NULL CHECK(length(purpose) BETWEEN 1 AND 500),
  policy_json JSONB NOT NULL CHECK(jsonb_typeof(policy_json)='object'), revision INTEGER NOT NULL CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,target), CHECK(updated_at>=created_at)
);

CREATE TABLE journey_predictive_models (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK(target IN ('churn','conversion')), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  state TEXT NOT NULL CHECK(state IN ('approved','retired')), revision INTEGER NOT NULL CHECK(revision>0),
  current_version_id TEXT NOT NULL, created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id), UNIQUE(current_version_id,id,space_id), CHECK(updated_at>=created_at)
);
CREATE INDEX journey_predictive_models_list ON journey_predictive_models(space_id,state,updated_at DESC,id);

CREATE TABLE journey_predictive_model_versions (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, space_id TEXT NOT NULL,
  version TEXT NOT NULL CHECK(length(version) BETWEEN 1 AND 128),
  model_json JSONB NOT NULL CHECK(jsonb_typeof(model_json)='object'),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,model_id,space_id), UNIQUE(model_id,space_id,version),
  FOREIGN KEY(model_id,space_id) REFERENCES journey_predictive_models(id,space_id) ON DELETE NO ACTION
);

CREATE TABLE journey_prediction_drift_evaluations (
  id TEXT PRIMARY KEY, model_version_id TEXT NOT NULL, model_id TEXT NOT NULL, space_id TEXT NOT NULL,
  population_stability_index DOUBLE PRECISION, missing_feature_ratio DOUBLE PRECISION NOT NULL,
  out_of_distribution_score DOUBLE PRECISION, decision TEXT NOT NULL CHECK(decision IN ('within_envelope','abstain')),
  reason_codes_json JSONB NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  evaluated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, evaluated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(model_version_id,model_id,space_id)
    REFERENCES journey_predictive_model_versions(id,model_id,space_id) ON DELETE NO ACTION,
  CHECK(population_stability_index IS NULL OR population_stability_index BETWEEN 0 AND 10),
  CHECK(missing_feature_ratio BETWEEN 0 AND 1),
  CHECK(out_of_distribution_score IS NULL OR out_of_distribution_score BETWEEN 0 AND 100)
);
CREATE INDEX journey_prediction_drift_history
  ON journey_prediction_drift_evaluations(space_id,model_version_id,evaluated_at DESC,id);

CREATE TABLE journey_prediction_runs (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  model_id TEXT NOT NULL, model_version_id TEXT NOT NULL,
  evaluator_kind TEXT NOT NULL CHECK(evaluator_kind = 'governed_fixture'),
  evaluator_output_sha256 TEXT NOT NULL CHECK(evaluator_output_sha256 ~ '^[a-f0-9]{64}$'),
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(model_version_id,model_id,space_id)
    REFERENCES journey_predictive_model_versions(id,model_id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_prediction_runs_list ON journey_prediction_runs(space_id,created_at DESC,id);

CREATE TABLE journey_prediction_audit (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 128),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  CHECK(NOT (detail_json ?| ARRAY['subjectId','featureValues','featureContributions']))
);
CREATE INDEX journey_prediction_audit_list ON journey_prediction_audit(space_id,created_at DESC,id);

CREATE TRIGGER journey_predictive_versions_append_only BEFORE UPDATE OR DELETE ON journey_predictive_model_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_prediction_drift_append_only BEFORE UPDATE OR DELETE ON journey_prediction_drift_evaluations
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_prediction_runs_append_only BEFORE UPDATE OR DELETE ON journey_prediction_runs
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_prediction_audit_append_only BEFORE UPDATE OR DELETE ON journey_prediction_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
