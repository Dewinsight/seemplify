-- Runtime schema 41: governed journey-stage comparison facts and privacy policy.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>40 THEN
    RAISE EXCEPTION 'runtime-41 journey stage intelligence requires runtime-40' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_stage_intelligence_policies (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0),
  minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 3 AND 1000),
  dimensions_json JSONB NOT NULL CHECK(jsonb_typeof(dimensions_json)='array'
    AND jsonb_array_length(dimensions_json) BETWEEN 1 AND 4
    AND dimensions_json <@ '["persona","segment","cohort","channel"]'::jsonb),
  maximum_rows INTEGER NOT NULL CHECK(maximum_rows BETWEEN 1 AND 5000),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK(updated_at>=created_at)
);

CREATE TABLE journey_stage_intelligence_policy_history (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  revision INTEGER NOT NULL CHECK(revision>0),
  minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 3 AND 1000),
  dimensions_json JSONB NOT NULL CHECK(jsonb_typeof(dimensions_json)='array'
    AND jsonb_array_length(dimensions_json) BETWEEN 1 AND 4
    AND dimensions_json <@ '["persona","segment","cohort","channel"]'::jsonb),
  maximum_rows INTEGER NOT NULL CHECK(maximum_rows BETWEEN 1 AND 5000),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,revision)
);

CREATE TABLE journey_stage_intelligence_facts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN
    ('survey','service_recovery_ticket','social_mention','journey_event','operational_import')),
  source_id_hmac TEXT NOT NULL CHECK(source_id_hmac ~ '^[a-f0-9]{64}$'),
  external_record_hmac TEXT NOT NULL CHECK(external_record_hmac ~ '^[a-f0-9]{64}$'),
  source_version TEXT NOT NULL CHECK(length(source_version) BETWEEN 1 AND 128),
  schema_version TEXT NOT NULL CHECK(length(schema_version) BETWEEN 1 AND 128),
  projection_version TEXT NOT NULL CHECK(length(projection_version) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK(revision>0),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  supersedes_fact_id TEXT,
  subject_id_hmac TEXT NOT NULL CHECK(subject_id_hmac ~ '^[a-f0-9]{64}$'),
  stage_id TEXT NOT NULL CHECK(length(stage_id) BETWEEN 1 AND 128),
  metric_definition_id TEXT NOT NULL,
  metric_definition_version_id TEXT NOT NULL,
  metric_definition_version_sha256 TEXT NOT NULL CHECK(metric_definition_version_sha256 ~ '^[a-f0-9]{64}$'),
  metric_unit TEXT NOT NULL CHECK(metric_unit IN ('score','percent','count','seconds','minutes','hours','rate','index','currency','unknown')),
  value DOUBLE PRECISION CHECK(value IS NULL OR value NOT IN
    ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  dimensions_json JSONB NOT NULL CHECK(jsonb_typeof(dimensions_json)='object'
    AND NOT (dimensions_json ?| ARRAY['text','rawText','raw_text','content','body','message','email','name'])
    AND octet_length(dimensions_json::text)<=8192),
  sentiment TEXT CHECK(sentiment IS NULL OR sentiment IN ('negative','neutral','positive','mixed','unknown')),
  emotions_json JSONB NOT NULL CHECK(jsonb_typeof(emotions_json)='array' AND jsonb_array_length(emotions_json)<=10
    AND emotions_json <@ '["anger","anxiety","confusion","delight","disappointment","frustration","relief","sadness","trust","unknown"]'::jsonb),
  occurred_at TIMESTAMPTZ NOT NULL,
  consent_state TEXT NOT NULL CHECK(consent_state IN ('granted','not_required','denied','unknown','withdrawn')),
  purposes_json JSONB NOT NULL CHECK(jsonb_typeof(purposes_json)='array' AND jsonb_array_length(purposes_json) BETWEEN 1 AND 3
    AND purposes_json <@ '["service_improvement","analytics","research"]'::jsonb),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key_hmac TEXT NOT NULL CHECK(idempotency_key_hmac ~ '^[a-f0-9]{64}$'),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_stage_intelligence_facts_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_stage_intelligence_facts_chain_identity UNIQUE
    (id,space_id,metric_definition_id,source_id_hmac,external_record_hmac),
  CONSTRAINT journey_stage_intelligence_facts_idempotency UNIQUE(space_id,idempotency_key_hmac),
  CONSTRAINT journey_stage_intelligence_facts_source_revision UNIQUE
    (space_id,metric_definition_id,source_id_hmac,external_record_hmac,revision),
  CONSTRAINT journey_stage_intelligence_facts_journey_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_intelligence_facts_metric_fk FOREIGN KEY(metric_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_stage_intelligence_facts_metric_version_fk
    FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_stage_intelligence_facts_supersedes_fk FOREIGN KEY
    (supersedes_fact_id,space_id,metric_definition_id,source_id_hmac,external_record_hmac)
    REFERENCES journey_stage_intelligence_facts
      (id,space_id,metric_definition_id,source_id_hmac,external_record_hmac)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_stage_intelligence_facts_revision_shape CHECK(
    (revision=1 AND supersedes_fact_id IS NULL) OR (revision>1 AND supersedes_fact_id IS NOT NULL)),
  CONSTRAINT journey_stage_intelligence_facts_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_stage_intelligence_facts_window ON journey_stage_intelligence_facts
  (space_id,journey_definition_id,occurred_at,metric_definition_version_id,id);
CREATE INDEX journey_stage_intelligence_facts_latest ON journey_stage_intelligence_facts
  (space_id,metric_definition_id,source_id_hmac,external_record_hmac,revision DESC,id);
CREATE INDEX journey_stage_intelligence_facts_retention ON journey_stage_intelligence_facts
  (retention_expires_at,space_id,id);

CREATE TABLE journey_stage_intelligence_audit (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('fact.accepted','fact.deleted','policy.updated','comparison.read','export.read','retention.purged')),
  target_type TEXT NOT NULL CHECK(target_type IN ('fact','policy','comparison','export','retention')),
  target_sha256 TEXT NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
  detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=4096
    AND NOT (detail_json ?| ARRAY['payload','content','body','message','subject','subjectId','email','identifier','secret','token'])),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX journey_stage_intelligence_audit_list ON journey_stage_intelligence_audit(space_id,created_at DESC,id);

CREATE TRIGGER journey_stage_intelligence_policy_history_append_only
  BEFORE UPDATE OR DELETE ON journey_stage_intelligence_policy_history
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_stage_intelligence_facts_append_only
  BEFORE UPDATE ON journey_stage_intelligence_facts
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE OR REPLACE FUNCTION journey_stage_intelligence_retention_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_stage_intelligence_retention_delete_guard$
BEGIN
  IF current_setting('seemplify.retention_purge',TRUE)='on' AND OLD.retention_expires_at<=CURRENT_TIMESTAMP THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Journey stage intelligence facts require an authorised expired-retention purge' USING ERRCODE='55000';
END
$journey_stage_intelligence_retention_delete_guard$;
REVOKE ALL ON FUNCTION journey_stage_intelligence_retention_delete_guard() FROM PUBLIC;
CREATE TRIGGER journey_stage_intelligence_facts_retention_delete
  BEFORE DELETE ON journey_stage_intelligence_facts FOR EACH ROW
  EXECUTE FUNCTION journey_stage_intelligence_retention_delete_guard();
CREATE TRIGGER journey_stage_intelligence_audit_append_only
  BEFORE UPDATE OR DELETE ON journey_stage_intelligence_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
