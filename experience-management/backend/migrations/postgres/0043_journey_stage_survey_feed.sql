-- Runtime schema 43: governed, server-derived survey feed for journey-stage intelligence.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>42 THEN
    RAISE EXCEPTION 'runtime-43 journey stage survey feed requires runtime-42' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_stage_source_mappings (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind='survey'), state TEXT NOT NULL CHECK(state IN ('active','retired')),
  metric_definition_id TEXT NOT NULL CHECK(length(metric_definition_id) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK(revision>0), current_version_id TEXT,
  idempotency_key_hmac TEXT NOT NULL CHECK(idempotency_key_hmac ~ '^[a-f0-9]{64}$'),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL CHECK(updated_at>=created_at),
  UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key_hmac), UNIQUE(space_id,source_kind,metric_definition_id)
);

CREATE TABLE journey_stage_source_mapping_versions (
  id TEXT PRIMARY KEY, mapping_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>0), journey_definition_id TEXT NOT NULL,
  stage_id TEXT NOT NULL, metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT NOT NULL,
  metric_definition_version_sha256 TEXT NOT NULL CHECK(metric_definition_version_sha256 ~ '^[a-f0-9]{64}$'),
  binding_id TEXT NOT NULL, question_id TEXT NOT NULL CHECK(length(question_id) BETWEEN 1 AND 128),
  question_schema_sha256 TEXT NOT NULL CHECK(question_schema_sha256 ~ '^[a-f0-9]{64}$'),
  calculator_kind TEXT NOT NULL CHECK(calculator_kind IN ('nps','csat','ces')),
  calculator_configuration_json JSONB NOT NULL CHECK(jsonb_typeof(calculator_configuration_json)='object'
    AND octet_length(calculator_configuration_json::text)<=32768),
  survey_id_hmac TEXT NOT NULL CHECK(survey_id_hmac ~ '^[a-f0-9]{64}$'),
  collector_id_hmac TEXT NOT NULL CHECK(collector_id_hmac ~ '^[a-f0-9]{64}$'),
  allowed_purposes_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_purposes_json)='array'
    AND jsonb_array_length(allowed_purposes_json) BETWEEN 1 AND 3
    AND allowed_purposes_json <@ '["service_improvement","analytics","research"]'::jsonb),
  retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
  projection_version TEXT NOT NULL CHECK(projection_version='survey-stage-feed/v1'),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,mapping_id,space_id), UNIQUE(mapping_id,version_number),
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_stage_source_mappings(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id,space_id) REFERENCES journey_map_stages(id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(metric_definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(binding_id,space_id) REFERENCES journey_metric_bindings(id,space_id) ON DELETE RESTRICT
);
ALTER TABLE journey_stage_source_mappings ADD CONSTRAINT journey_stage_source_mappings_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_stage_source_mapping_versions(id,mapping_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX journey_stage_source_mapping_versions_survey
  ON journey_stage_source_mapping_versions(space_id,survey_id_hmac,collector_id_hmac,mapping_id,version_number DESC);

CREATE TABLE journey_stage_survey_policies (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  survey_id_hmac TEXT NOT NULL CHECK(survey_id_hmac ~ '^[a-f0-9]{64}$'),
  collector_id_hmac TEXT NOT NULL CHECK(collector_id_hmac ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('active','retired')), revision INTEGER NOT NULL CHECK(revision>0),
  current_version_id TEXT, created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL CHECK(updated_at>=created_at),
  UNIQUE(id,space_id), UNIQUE(space_id,survey_id_hmac,collector_id_hmac)
);
CREATE TABLE journey_stage_survey_policy_versions (
  id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  notice_text TEXT NOT NULL CHECK(length(notice_text) BETWEEN 20 AND 4000),
  notice_sha256 TEXT NOT NULL CHECK(notice_sha256 ~ '^[a-f0-9]{64}$'),
  allowed_purposes_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_purposes_json)='array'
    AND jsonb_array_length(allowed_purposes_json) BETWEEN 1 AND 3
    AND allowed_purposes_json <@ '["service_improvement","analytics","research"]'::jsonb),
  retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 3650), requires_explicit_consent BOOLEAN NOT NULL CHECK(requires_explicit_consent),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,policy_id,space_id), UNIQUE(policy_id,version_number),
  FOREIGN KEY(policy_id,space_id) REFERENCES journey_stage_survey_policies(id,space_id) ON DELETE CASCADE
);
ALTER TABLE journey_stage_survey_policies ADD CONSTRAINT journey_stage_survey_policies_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_stage_survey_policy_versions(id,policy_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_stage_survey_governance_receipts (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  policy_version_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  response_id_hmac TEXT NOT NULL CHECK(response_id_hmac ~ '^[a-f0-9]{64}$'),
  subject_id_hmac TEXT NOT NULL CHECK(subject_id_hmac ~ '^[a-f0-9]{64}$'),
  consent_state TEXT NOT NULL CHECK(consent_state IN ('granted','denied','withdrawn')),
  purposes_json JSONB NOT NULL CHECK(jsonb_typeof(purposes_json)='array' AND jsonb_array_length(purposes_json) BETWEEN 1 AND 3
    AND purposes_json <@ '["service_improvement","analytics","research"]'::jsonb),
  notice_sha256 TEXT NOT NULL CHECK(notice_sha256 ~ '^[a-f0-9]{64}$'),
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  retention_expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,response_id_hmac,policy_version_id),
  FOREIGN KEY(policy_version_id,policy_id,space_id)
    REFERENCES journey_stage_survey_policy_versions(id,policy_id,space_id) ON DELETE RESTRICT
);

CREATE TABLE journey_stage_survey_source_revisions (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  mapping_id TEXT NOT NULL, mapping_version_id TEXT NOT NULL, governance_receipt_id TEXT,
  external_record_hmac TEXT NOT NULL CHECK(external_record_hmac ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL CHECK(revision>0), operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  supersedes_revision_id TEXT, projection_json JSONB NOT NULL CHECK(jsonb_typeof(projection_json)='object'
    AND octet_length(projection_json::text)<=8192
    AND NOT (projection_json ?| ARRAY['answer','answers','text','content','body','email','name','respondentToken','token'])),
  projection_sha256 TEXT NOT NULL CHECK(projection_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id,mapping_id,external_record_hmac),
  UNIQUE(space_id,mapping_id,external_record_hmac,revision),
  FOREIGN KEY(mapping_version_id,mapping_id,space_id)
    REFERENCES journey_stage_source_mapping_versions(id,mapping_id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(governance_receipt_id) REFERENCES journey_stage_survey_governance_receipts(id) ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_revision_id,space_id,mapping_id,external_record_hmac)
    REFERENCES journey_stage_survey_source_revisions(id,space_id,mapping_id,external_record_hmac)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK((revision=1 AND supersedes_revision_id IS NULL) OR (revision>1 AND supersedes_revision_id IS NOT NULL))
);

CREATE TABLE journey_stage_survey_outbox (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  mapping_id TEXT NOT NULL, source_revision_id TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete','delete_scope')),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','retry_wait','completed','dead_letter')),
  available_at TIMESTAMPTZ NOT NULL, lease_owner TEXT, lease_token TEXT, lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
  last_error_code TEXT, terminal_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(source_revision_id), FOREIGN KEY(mapping_id,space_id) REFERENCES journey_stage_source_mappings(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(source_revision_id) REFERENCES journey_stage_survey_source_revisions(id) ON DELETE RESTRICT,
  CHECK((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK((state IN ('completed','dead_letter') AND terminal_at IS NOT NULL) OR (state NOT IN ('completed','dead_letter') AND terminal_at IS NULL))
);
CREATE INDEX journey_stage_survey_outbox_claim ON journey_stage_survey_outbox(state,available_at,lease_expires_at,created_at,id);
CREATE TABLE journey_stage_survey_outbox_attempts (
  id TEXT PRIMARY KEY, outbox_id TEXT NOT NULL REFERENCES journey_stage_survey_outbox(id) ON DELETE NO ACTION,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION, lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0), outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','retry_wait','dead_letter','lease_expired')),
  error_code TEXT, detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(outbox_id,lease_generation)
);
CREATE TABLE journey_stage_survey_checkpoints (
  mapping_id TEXT NOT NULL, space_id TEXT NOT NULL, last_external_record_hmac TEXT,
  completed_revision_count BIGINT NOT NULL DEFAULT 0 CHECK(completed_revision_count>=0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(mapping_id,space_id), FOREIGN KEY(mapping_id,space_id) REFERENCES journey_stage_source_mappings(id,space_id) ON DELETE CASCADE
);
CREATE TABLE journey_stage_survey_feed_audit (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('mapping.created','mapping.retired','policy.created','policy.retired','receipt.recorded','revision.recorded','scope_delete.enqueued','outbox.completed','outbox.failed','retention.purged')),
  target_sha256 TEXT NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'), detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'
    AND octet_length(detail_json::text)<=4096 AND NOT (detail_json ?| ARRAY['answer','answers','text','content','body','email','name','subject','token'])),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER journey_stage_source_mapping_versions_append_only BEFORE UPDATE OR DELETE ON journey_stage_source_mapping_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_stage_survey_policy_versions_append_only BEFORE UPDATE OR DELETE ON journey_stage_survey_policy_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();

-- Pseudonymous subjects remain personal data. Only an explicitly activated,
-- transaction-local retention authority may delete expired feed evidence.
CREATE FUNCTION journey_stage_survey_retention_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE expires_at TIMESTAMPTZ;
BEGIN
  IF current_setting('seemplify.survey_feed_retention_purge',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'journey stage survey history is append-only outside expired-retention purge' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='journey_stage_survey_governance_receipts' THEN expires_at:=OLD.retention_expires_at;
  ELSIF TG_TABLE_NAME='journey_stage_survey_source_revisions' THEN
    SELECT receipt.retention_expires_at INTO expires_at FROM journey_stage_survey_governance_receipts receipt
      WHERE receipt.id=OLD.governance_receipt_id;
  ELSE
    SELECT receipt.retention_expires_at INTO expires_at
      FROM journey_stage_survey_outbox outbox
      JOIN journey_stage_survey_source_revisions revision ON revision.id=outbox.source_revision_id
      JOIN journey_stage_survey_governance_receipts receipt ON receipt.id=revision.governance_receipt_id
      WHERE outbox.id=OLD.outbox_id;
  END IF;
  IF expires_at IS NULL OR expires_at>clock_timestamp() THEN
    RAISE EXCEPTION 'journey stage survey retention purge is not yet authorised' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $guard$;
CREATE TRIGGER journey_stage_survey_governance_receipts_append_only BEFORE UPDATE OR DELETE ON journey_stage_survey_governance_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_stage_survey_retention_delete_guard();
CREATE TRIGGER journey_stage_survey_source_revisions_append_only BEFORE UPDATE OR DELETE ON journey_stage_survey_source_revisions
  FOR EACH ROW EXECUTE FUNCTION journey_stage_survey_retention_delete_guard();
CREATE TRIGGER journey_stage_survey_outbox_attempts_append_only BEFORE UPDATE OR DELETE ON journey_stage_survey_outbox_attempts
  FOR EACH ROW EXECUTE FUNCTION journey_stage_survey_retention_delete_guard();
CREATE TRIGGER journey_stage_survey_feed_audit_append_only BEFORE UPDATE OR DELETE ON journey_stage_survey_feed_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
