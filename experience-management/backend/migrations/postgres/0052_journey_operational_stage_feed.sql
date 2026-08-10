-- Runtime schema 52: governed service-recovery feed for stage intelligence and Customer 360.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>51 THEN
    RAISE EXCEPTION 'runtime-52 journey operational stage feed requires runtime-51' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_operational_stage_mappings (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind='service_recovery_ticket'),
  state TEXT NOT NULL CHECK(state IN ('active','retired')),
  metric_definition_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  current_version_id TEXT,
  idempotency_key_hmac TEXT NOT NULL CHECK(idempotency_key_hmac ~ '^[a-f0-9]{64}$'),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK(updated_at>=created_at),
  UNIQUE(id,space_id),
  UNIQUE(space_id,idempotency_key_hmac),
  UNIQUE(space_id,source_kind,metric_definition_id)
);

CREATE TABLE journey_operational_stage_mapping_versions (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  journey_definition_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL,
  metric_definition_version_id TEXT NOT NULL,
  metric_definition_version_sha256 TEXT NOT NULL CHECK(metric_definition_version_sha256 ~ '^[a-f0-9]{64}$'),
  source_survey_hmacs_json JSONB NOT NULL CHECK(jsonb_typeof(source_survey_hmacs_json)='array'
    AND jsonb_array_length(source_survey_hmacs_json) BETWEEN 1 AND 20
    AND NOT jsonb_path_exists(source_survey_hmacs_json,'$[*] ? (!(@ like_regex "^[a-f0-9]{64}$"))')),
  event_map_json JSONB NOT NULL CHECK(jsonb_typeof(event_map_json)='object'
    AND octet_length(event_map_json::text)<=4096
    AND NOT (event_map_json ?| ARRAY['title','notes','content','body','message','email','name'])),
  identity_identifier_kind TEXT CHECK(identity_identifier_kind IS NULL OR identity_identifier_kind IN
    ('anonymous_id','authenticated_user_id','external_user_id')),
  identity_identifier_namespace TEXT CHECK(identity_identifier_namespace IS NULL OR
    length(identity_identifier_namespace) BETWEEN 1 AND 160),
  allowed_purposes_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_purposes_json)='array'
    AND jsonb_array_length(allowed_purposes_json) BETWEEN 1 AND 3
    AND allowed_purposes_json <@ '["service_improvement","analytics","research"]'::jsonb),
  retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
  projection_version TEXT NOT NULL CHECK(projection_version='ticket-stage-feed/v1'),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,mapping_id,space_id),
  UNIQUE(mapping_id,version_number),
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_operational_stage_mappings(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id,space_id) REFERENCES journey_map_stages(id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(metric_definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CHECK((identity_identifier_kind IS NULL)=(identity_identifier_namespace IS NULL))
);
ALTER TABLE journey_operational_stage_mappings ADD CONSTRAINT journey_operational_stage_mappings_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_operational_stage_mapping_versions(id,mapping_id,space_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE journey_stage_survey_governance_receipts
  ADD CONSTRAINT journey_stage_survey_governance_receipts_runtime52_tenant_identity UNIQUE(id,space_id);

CREATE TABLE journey_operational_stage_source_revisions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  mapping_id TEXT NOT NULL,
  mapping_version_id TEXT NOT NULL,
  governance_receipt_id TEXT NOT NULL,
  external_record_hmac TEXT NOT NULL CHECK(external_record_hmac ~ '^[a-f0-9]{64}$'),
  ticket_id_hmac TEXT NOT NULL CHECK(ticket_id_hmac ~ '^[a-f0-9]{64}$'),
  response_id_hmac TEXT NOT NULL CHECK(response_id_hmac ~ '^[a-f0-9]{64}$'),
  profile_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  supersedes_revision_id TEXT,
  projection_json JSONB NOT NULL CHECK(jsonb_typeof(projection_json)='object'
    AND octet_length(projection_json::text)<=8192
    AND NOT (projection_json ?| ARRAY['title','notes','detail','content','body','message','email','name','token','respondentToken'])),
  projection_sha256 TEXT NOT NULL CHECK(projection_sha256 ~ '^[a-f0-9]{64}$'),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(id,space_id,mapping_id,external_record_hmac),
  UNIQUE(space_id,mapping_id,external_record_hmac,revision),
  FOREIGN KEY(mapping_version_id,mapping_id,space_id)
    REFERENCES journey_operational_stage_mapping_versions(id,mapping_id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(governance_receipt_id,space_id) REFERENCES journey_stage_survey_governance_receipts(id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_revision_id,space_id,mapping_id,external_record_hmac)
    REFERENCES journey_operational_stage_source_revisions(id,space_id,mapping_id,external_record_hmac)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK((revision=1 AND supersedes_revision_id IS NULL) OR (revision>1 AND supersedes_revision_id IS NOT NULL)),
  CHECK(retention_expires_at>created_at)
);

CREATE TABLE journey_operational_stage_outbox (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  mapping_id TEXT NOT NULL,
  source_revision_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','leased','retry_wait','completed','dead_letter')),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
  last_error_code TEXT,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_operational_stage_mappings(id,space_id) ON DELETE CASCADE,
  UNIQUE(id,space_id),
  FOREIGN KEY(source_revision_id,space_id) REFERENCES journey_operational_stage_source_revisions(id,space_id) ON DELETE RESTRICT,
  CHECK((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK((state IN ('completed','dead_letter') AND terminal_at IS NOT NULL)
    OR (state NOT IN ('completed','dead_letter') AND terminal_at IS NULL))
);
CREATE INDEX journey_operational_stage_outbox_claim
  ON journey_operational_stage_outbox(state,available_at,lease_expires_at,created_at,id);

CREATE TABLE journey_operational_stage_outbox_attempts (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','retry_wait','dead_letter','lease_expired')),
  error_code TEXT,
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(outbox_id,lease_generation),
  FOREIGN KEY(outbox_id,space_id) REFERENCES journey_operational_stage_outbox(id,space_id) ON DELETE NO ACTION
);

CREATE TABLE journey_operational_stage_checkpoints (
  mapping_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  last_external_record_hmac TEXT,
  completed_revision_count BIGINT NOT NULL DEFAULT 0 CHECK(completed_revision_count>=0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(mapping_id,space_id),
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_operational_stage_mappings(id,space_id) ON DELETE CASCADE
);

CREATE TABLE journey_operational_stage_tombstones (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  mapping_id TEXT NOT NULL,
  external_record_hmac TEXT NOT NULL CHECK(external_record_hmac ~ '^[a-f0-9]{64}$'),
  deletion_revision INTEGER NOT NULL CHECK(deletion_revision>1),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('source_deleted','consent_withdrawn','privacy_erasure','retention_expired')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,mapping_id,external_record_hmac),
  FOREIGN KEY(mapping_id,space_id) REFERENCES journey_operational_stage_mappings(id,space_id) ON DELETE CASCADE
);

CREATE TABLE journey_operational_timeline_revisions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  source_revision_id TEXT NOT NULL UNIQUE,
  profile_id TEXT NOT NULL,
  canonical_profile_id TEXT NOT NULL,
  external_record_hmac TEXT NOT NULL CHECK(external_record_hmac ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL CHECK(revision>0),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
  supersedes_timeline_revision_id TEXT,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('service_recovery_opened','service_recovery_contact','service_recovery_closed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  purposes_json JSONB NOT NULL CHECK(jsonb_typeof(purposes_json)='array' AND jsonb_array_length(purposes_json) BETWEEN 1 AND 3),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id,profile_id,external_record_hmac),
  UNIQUE(space_id,profile_id,external_record_hmac,revision),
  FOREIGN KEY(source_revision_id,space_id) REFERENCES journey_operational_stage_source_revisions(id,space_id) ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_timeline_revision_id,space_id,profile_id,external_record_hmac)
    REFERENCES journey_operational_timeline_revisions(id,space_id,profile_id,external_record_hmac) ON DELETE NO ACTION,
  CHECK((revision=1 AND supersedes_timeline_revision_id IS NULL) OR
    (revision>1 AND supersedes_timeline_revision_id IS NOT NULL)),
  CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_operational_timeline_profile
  ON journey_operational_timeline_revisions(space_id,profile_id,occurred_at DESC,id);

CREATE TABLE journey_operational_stage_feed_audit (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('mapping.created','mapping.retired','revision.recorded','revision.excluded',
    'outbox.completed','outbox.failed','retention.purged','social.unsupported')),
  target_sha256 TEXT NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
  detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=4096
    AND NOT (detail_json ?| ARRAY['title','notes','detail','content','body','message','email','name','token','identifier','subjectId'])),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TRIGGER journey_operational_stage_mapping_versions_append_only
  BEFORE UPDATE OR DELETE ON journey_operational_stage_mapping_versions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE FUNCTION journey_operational_stage_retention_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE expires_at TIMESTAMPTZ;
BEGIN
  IF current_setting('seemplify.operational_feed_retention_purge',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'journey operational feed is append-only outside expired-retention purge' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='journey_operational_stage_source_revisions' THEN expires_at:=OLD.retention_expires_at;
  ELSIF TG_TABLE_NAME='journey_operational_timeline_revisions' THEN expires_at:=OLD.retention_expires_at;
  ELSIF TG_TABLE_NAME='journey_operational_stage_tombstones' THEN
    SELECT MAX(revision.retention_expires_at) INTO expires_at FROM journey_operational_stage_source_revisions revision
      WHERE revision.space_id=OLD.space_id AND revision.mapping_id=OLD.mapping_id
        AND revision.external_record_hmac=OLD.external_record_hmac;
  ELSE
    SELECT revision.retention_expires_at INTO expires_at FROM journey_operational_stage_outbox outbox
      JOIN journey_operational_stage_source_revisions revision ON revision.id=outbox.source_revision_id
      WHERE outbox.id=OLD.outbox_id;
  END IF;
  IF expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'journey operational feed retention purge is not yet authorised' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $guard$;
REVOKE ALL ON FUNCTION journey_operational_stage_retention_delete_guard() FROM PUBLIC;
CREATE TRIGGER journey_operational_stage_source_revisions_append_only_update BEFORE UPDATE
  ON journey_operational_stage_source_revisions FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_operational_stage_source_revisions_retention_delete BEFORE DELETE
  ON journey_operational_stage_source_revisions FOR EACH ROW EXECUTE FUNCTION journey_operational_stage_retention_delete_guard();
CREATE TRIGGER journey_operational_timeline_revisions_append_only_update BEFORE UPDATE
  ON journey_operational_timeline_revisions FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_operational_timeline_revisions_retention_delete BEFORE DELETE
  ON journey_operational_timeline_revisions FOR EACH ROW EXECUTE FUNCTION journey_operational_stage_retention_delete_guard();
CREATE TRIGGER journey_operational_stage_tombstones_append_only_update BEFORE UPDATE
  ON journey_operational_stage_tombstones FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_operational_stage_tombstones_retention_delete BEFORE DELETE
  ON journey_operational_stage_tombstones FOR EACH ROW EXECUTE FUNCTION journey_operational_stage_retention_delete_guard();
CREATE TRIGGER journey_operational_stage_outbox_attempts_append_only_update BEFORE UPDATE
  ON journey_operational_stage_outbox_attempts FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_operational_stage_outbox_attempts_retention_delete BEFORE DELETE
  ON journey_operational_stage_outbox_attempts FOR EACH ROW EXECUTE FUNCTION journey_operational_stage_retention_delete_guard();
CREATE TRIGGER journey_operational_stage_feed_audit_append_only
  BEFORE UPDATE OR DELETE ON journey_operational_stage_feed_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
