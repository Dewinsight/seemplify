-- Runtime schema 48: governed, explicitly descriptive blueprint measurements.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>47 THEN
    RAISE EXCEPTION 'runtime-48 blueprint measurement requires runtime-47' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_blueprint_measurement_plans (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  blueprint_id TEXT NOT NULL,blueprint_version_id TEXT NOT NULL,element_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL,metric_definition_version_id TEXT NOT NULL,
  target_value DOUBLE PRECISION,target_direction TEXT NOT NULL CHECK(target_direction IN ('higher_is_better','lower_is_better','neutral')),
  baseline_observation_id TEXT NOT NULL,baseline_value DOUBLE PRECISION NOT NULL,baseline_unit TEXT NOT NULL CHECK(length(baseline_unit) BETWEEN 1 AND 40),
  baseline_sample_size INTEGER NOT NULL CHECK(baseline_sample_size>=0),baseline_period_start TIMESTAMPTZ NOT NULL,
  baseline_period_end TIMESTAMPTZ NOT NULL,baseline_as_of TIMESTAMPTZ NOT NULL,
  baseline_result_sha256 TEXT NOT NULL CHECK(baseline_result_sha256 ~ '^[a-f0-9]{64}$'),
  baseline_source_snapshot_sha256 TEXT NOT NULL CHECK(baseline_source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed')),current_outcome_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),UNIQUE(space_id,idempotency_key),
  FOREIGN KEY(blueprint_version_id,blueprint_id,space_id) REFERENCES journey_blueprint_versions(id,blueprint_id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(element_id,blueprint_version_id,space_id) REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(baseline_observation_id,space_id) REFERENCES journey_metric_observations(id,space_id) ON DELETE NO ACTION,
  CHECK(baseline_period_end>baseline_period_start),CHECK(updated_at>=created_at)
);
CREATE INDEX journey_blueprint_measurement_plans_scope ON journey_blueprint_measurement_plans
  (space_id,blueprint_version_id,element_id,state,created_at,id);

CREATE TABLE journey_blueprint_measurement_outcomes (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),plan_id TEXT NOT NULL,space_id TEXT NOT NULL,
  after_observation_id TEXT NOT NULL,after_value DOUBLE PRECISION NOT NULL,after_sample_size INTEGER NOT NULL CHECK(after_sample_size>=0),
  after_period_start TIMESTAMPTZ NOT NULL,after_period_end TIMESTAMPTZ NOT NULL,after_as_of TIMESTAMPTZ NOT NULL,
  after_result_sha256 TEXT NOT NULL CHECK(after_result_sha256 ~ '^[a-f0-9]{64}$'),
  after_source_snapshot_sha256 TEXT NOT NULL CHECK(after_source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  absolute_delta DOUBLE PRECISION NOT NULL,relative_delta DOUBLE PRECISION,target_distance DOUBLE PRECISION,target_met BOOLEAN,
  comparability_code TEXT NOT NULL CHECK(comparability_code='same_metric_version_unit_nonoverlapping_periods'),
  interpretation TEXT NOT NULL CHECK(interpretation='descriptive_non_causal'),causal_claim BOOLEAN NOT NULL CHECK(causal_claim=FALSE),
  snapshot_json JSONB NOT NULL,snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  plan_revision INTEGER NOT NULL CHECK(plan_revision>1),idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,UNIQUE(id,space_id),UNIQUE(id,plan_id,space_id),UNIQUE(space_id,idempotency_key),UNIQUE(plan_id,after_observation_id),
  FOREIGN KEY(plan_id,space_id) REFERENCES journey_blueprint_measurement_plans(id,space_id) ON DELETE NO ACTION,
  FOREIGN KEY(after_observation_id,space_id) REFERENCES journey_metric_observations(id,space_id) ON DELETE NO ACTION,
  CHECK(after_period_end>after_period_start),
  CHECK(jsonb_typeof(snapshot_json)='object' AND octet_length(snapshot_json::text)<=32768)
);
ALTER TABLE journey_blueprint_measurement_plans ADD CONSTRAINT journey_blueprint_measurement_current_outcome_fk
  FOREIGN KEY(current_outcome_id,id,space_id) REFERENCES journey_blueprint_measurement_outcomes(id,plan_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX journey_blueprint_measurement_outcomes_history ON journey_blueprint_measurement_outcomes(space_id,plan_id,created_at,id);

CREATE TABLE journey_blueprint_measurement_audit (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),plan_id TEXT NOT NULL,space_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('plan.created','outcome.recorded','plan.closed')),plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,UNIQUE(plan_id,plan_revision,action),
  FOREIGN KEY(plan_id,space_id) REFERENCES journey_blueprint_measurement_plans(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_blueprint_measurement_audit_history ON journey_blueprint_measurement_audit(space_id,plan_id,plan_revision,id);

CREATE OR REPLACE FUNCTION journey_blueprint_measurement_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE observation journey_metric_observations%ROWTYPE;metric_version journey_metric_definition_versions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='journey_blueprint_measurement_plans' AND TG_OP='INSERT' THEN
    SELECT * INTO observation FROM journey_metric_observations WHERE id=NEW.baseline_observation_id AND space_id=NEW.space_id;
    SELECT * INTO metric_version FROM journey_metric_definition_versions
      WHERE id=NEW.metric_definition_version_id AND definition_id=NEW.metric_definition_id AND space_id=NEW.space_id;
    IF observation.id IS NULL OR metric_version.id IS NULL OR observation.definition_id<>NEW.metric_definition_id
      OR observation.definition_version_id<>NEW.metric_definition_version_id OR observation.status<>'available'
      OR observation.value IS NULL OR observation.value<>NEW.baseline_value OR observation.unit<>NEW.baseline_unit
      OR observation.sample_size<>NEW.baseline_sample_size OR observation.period_start<>NEW.baseline_period_start
      OR observation.period_end<>NEW.baseline_period_end OR observation.as_of<>NEW.baseline_as_of
      OR observation.result_sha256<>NEW.baseline_result_sha256
      OR observation.source_snapshot_sha256<>NEW.baseline_source_snapshot_sha256
      OR metric_version.target_value IS DISTINCT FROM NEW.target_value OR metric_version.direction<>NEW.target_direction THEN
      RAISE EXCEPTION 'blueprint baseline lineage is invalid' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='journey_blueprint_measurement_outcomes' AND TG_OP='INSERT' THEN
    SELECT * INTO observation FROM journey_metric_observations WHERE id=NEW.after_observation_id AND space_id=NEW.space_id;
    IF observation.id IS NULL OR observation.status<>'available' OR observation.value IS NULL
      OR observation.value<>NEW.after_value OR observation.sample_size<>NEW.after_sample_size
      OR observation.period_start<>NEW.after_period_start OR observation.period_end<>NEW.after_period_end
      OR observation.as_of<>NEW.after_as_of OR observation.result_sha256<>NEW.after_result_sha256
      OR observation.source_snapshot_sha256<>NEW.after_source_snapshot_sha256
      OR NOT EXISTS(SELECT 1 FROM journey_blueprint_measurement_plans plan WHERE plan.id=NEW.plan_id AND plan.space_id=NEW.space_id
        AND plan.metric_definition_id=observation.definition_id AND plan.metric_definition_version_id=observation.definition_version_id
        AND plan.baseline_unit=observation.unit AND observation.period_start>=plan.baseline_period_end
        AND plan.state='active' AND NEW.plan_revision=plan.revision+1) THEN
      RAISE EXCEPTION 'blueprint after-observation is not comparable' USING ERRCODE='23514'; END IF;
  END IF;RETURN NEW;
END $guard$;
CREATE TRIGGER journey_blueprint_measurement_plan_lineage BEFORE INSERT ON journey_blueprint_measurement_plans
  FOR EACH ROW EXECUTE FUNCTION journey_blueprint_measurement_lineage_guard();
CREATE TRIGGER journey_blueprint_measurement_outcome_lineage BEFORE INSERT ON journey_blueprint_measurement_outcomes
  FOR EACH ROW EXECUTE FUNCTION journey_blueprint_measurement_lineage_guard();

CREATE OR REPLACE FUNCTION journey_blueprint_measurement_immutability_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('journey_blueprint_measurement_outcomes','journey_blueprint_measurement_audit') THEN
    RAISE EXCEPTION 'blueprint measurement evidence is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.blueprint_id<>OLD.blueprint_id
    OR NEW.blueprint_version_id<>OLD.blueprint_version_id OR NEW.element_id<>OLD.element_id
    OR NEW.metric_definition_id<>OLD.metric_definition_id OR NEW.metric_definition_version_id<>OLD.metric_definition_version_id
    OR NEW.target_value IS DISTINCT FROM OLD.target_value OR NEW.target_direction<>OLD.target_direction
    OR NEW.baseline_observation_id<>OLD.baseline_observation_id OR NEW.baseline_value<>OLD.baseline_value
    OR NEW.baseline_unit<>OLD.baseline_unit OR NEW.baseline_sample_size<>OLD.baseline_sample_size
    OR NEW.baseline_period_start<>OLD.baseline_period_start OR NEW.baseline_period_end<>OLD.baseline_period_end
    OR NEW.baseline_as_of<>OLD.baseline_as_of OR NEW.baseline_result_sha256<>OLD.baseline_result_sha256
    OR NEW.baseline_source_snapshot_sha256<>OLD.baseline_source_snapshot_sha256 OR NEW.idempotency_key<>OLD.idempotency_key
    OR NEW.intent_sha256<>OLD.intent_sha256 OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
    OR (OLD.state='closed' AND NEW.state<>'closed') THEN
    RAISE EXCEPTION 'blueprint baseline snapshot is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_blueprint_measurement_plan_guard BEFORE UPDATE OR DELETE ON journey_blueprint_measurement_plans
  FOR EACH ROW EXECUTE FUNCTION journey_blueprint_measurement_immutability_guard();
CREATE TRIGGER journey_blueprint_measurement_outcome_guard BEFORE UPDATE OR DELETE ON journey_blueprint_measurement_outcomes
  FOR EACH ROW EXECUTE FUNCTION journey_blueprint_measurement_immutability_guard();
CREATE TRIGGER journey_blueprint_measurement_audit_guard BEFORE UPDATE OR DELETE ON journey_blueprint_measurement_audit
  FOR EACH ROW EXECUTE FUNCTION journey_blueprint_measurement_immutability_guard();

REVOKE EXECUTE ON FUNCTION journey_blueprint_measurement_lineage_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION journey_blueprint_measurement_immutability_guard() FROM PUBLIC;
REVOKE UPDATE,DELETE ON journey_blueprint_measurement_outcomes,journey_blueprint_measurement_audit FROM PUBLIC;
