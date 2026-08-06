-- Runtime schema 17: durable connected-journey event data plane.
--
-- The globally unique deduplication registry is intentionally not partitioned:
-- PostgreSQL unique constraints on a partitioned table must contain the
-- partition key, which would weaken (space,source,event_id) idempotency. Raw
-- facts and immutable attempt receipts are time partitioned independently.
-- Mutable inbox, rate-window, and dead-letter rows are separate from those
-- immutable facts so workers can lease/retry without rewriting history.

-- A fresh SQLite cutover can already contain local/test parity tables. Stage
-- their rows before replacing the three high-volume tables with PostgreSQL
-- partitioned parents. This conversion is transactional; a failed migration
-- restores the original cutover tables and leaves the runtime ledger at 16.
DO $journey_event_data_plane_stage_cutover$
DECLARE table_name TEXT;
DECLARE relation_kind "char";
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>16 THEN
    RAISE EXCEPTION 'runtime-17 data-plane staging requires the checksummed runtime-16 predecessor'
      USING ERRCODE='55000';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'journey_event_data_audit','journey_event_dead_letters','journey_event_processing_receipts',
    'journey_event_processing_inbox','journey_event_rate_buckets','journey_event_rejections',
    'journey_event_deduplication','journey_event_ingest_receipts','journey_raw_events'
  ] LOOP
    SELECT relkind INTO relation_kind FROM pg_class
      WHERE oid=to_regclass('public.' || table_name);
    IF relation_kind IS NOT NULL AND relation_kind<>'p' THEN
      EXECUTE format('CREATE TEMP TABLE %I ON COMMIT DROP AS TABLE public.%I WITH DATA',
        'runtime17_cutover_' || table_name,table_name);
    END IF;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY[
    'journey_event_data_audit','journey_event_dead_letters','journey_event_processing_receipts',
    'journey_event_processing_inbox','journey_event_rate_buckets','journey_event_rejections',
    'journey_event_deduplication','journey_event_ingest_receipts','journey_raw_events'
  ] LOOP
    IF to_regclass('pg_temp.runtime17_cutover_' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TABLE public.%I CASCADE',table_name);
    END IF;
  END LOOP;
END
$journey_event_data_plane_stage_cutover$;

-- Credential lineage must carry the same tenant/source/environment tuple as
-- the immutable raw fact. The credential ID alone is never used as the tenant
-- boundary.
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_credentials_tenant_source_environment_identity
  ON journey_event_credentials(id,source_id,space_id,environment);
CREATE UNIQUE INDEX IF NOT EXISTS journey_event_schema_versions_tenant_source_identity
  ON journey_event_schema_versions(id,source_id,space_id);

CREATE TABLE journey_raw_events (
  received_at TIMESTAMPTZ NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  credential_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
  protocol_version TEXT NOT NULL CHECK(protocol_version='1.0'),
  event_call TEXT NOT NULL CHECK(event_call IN
    ('track','identify','alias','group','page','screen','consent','metric')),
  event_name TEXT CHECK(event_name IS NULL OR event_name ~ '^[a-z][a-z0-9_]{0,127}$'),
  event_version INTEGER CHECK(event_version IS NULL OR event_version BETWEEN 1 AND 1000000),
  occurred_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  schema_version_id TEXT,
  anonymous_id_hash TEXT CHECK(anonymous_id_hash IS NULL OR anonymous_id_hash ~ '^[a-f0-9]{64}$'),
  user_id_hash TEXT CHECK(user_id_hash IS NULL OR user_id_hash ~ '^[a-f0-9]{64}$'),
  account_id_hash TEXT CHECK(account_id_hash IS NULL OR account_id_hash ~ '^[a-f0-9]{64}$'),
  session_id_hash TEXT CHECK(session_id_hash IS NULL OR session_id_hash ~ '^[a-f0-9]{64}$'),
  channel TEXT NOT NULL CHECK(channel IN
    ('web','server','ios','android','react_native','webhook','connector','import','unknown')),
  consent_state TEXT NOT NULL CHECK(consent_state IN
    ('unknown','granted','denied','partial','not_required')),
  ingest_state TEXT NOT NULL CHECK(ingest_state IN ('accepted','quarantined')),
  payload_json JSONB NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  envelope_sha256 TEXT NOT NULL CHECK(envelope_sha256 ~ '^[a-f0-9]{64}$'),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 2 AND 2097152),
  sdk_name TEXT CHECK(sdk_name IS NULL OR length(sdk_name) BETWEEN 1 AND 80),
  sdk_version TEXT CHECK(sdk_version IS NULL OR length(sdk_version) BETWEEN 1 AND 80),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(received_at,id),
  UNIQUE(received_at,id,space_id,source_id,environment,event_id),
  CONSTRAINT journey_raw_events_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_raw_events_credential_tenant_source_environment_fk
    FOREIGN KEY(credential_id,source_id,space_id,environment)
    REFERENCES journey_event_credentials(id,source_id,space_id,environment) ON DELETE RESTRICT,
  CONSTRAINT journey_raw_events_schema_version_tenant_source_fk
    FOREIGN KEY(schema_version_id,source_id,space_id)
    REFERENCES journey_event_schema_versions(id,source_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_raw_events_track_shape CHECK(
    event_call NOT IN ('track','metric') OR (event_name IS NOT NULL AND event_version IS NOT NULL)),
  CONSTRAINT journey_raw_events_payload_json CHECK(
    octet_length(payload_json::text)<=2097152 AND jsonb_typeof(payload_json)='object'),
  CONSTRAINT journey_raw_events_context_json CHECK(
    octet_length(context_json::text)<=131072 AND jsonb_typeof(context_json)='object'),
  CONSTRAINT journey_raw_events_consent_json CHECK(
    octet_length(consent_json::text)<=32768 AND jsonb_typeof(consent_json)='object'),
  CONSTRAINT journey_raw_events_validation_issues_json CHECK(
    octet_length(validation_issues_json::text)<=32768 AND jsonb_typeof(validation_issues_json)='array'),
  CONSTRAINT journey_raw_events_quarantine_shape CHECK(
    ingest_state<>'quarantined' OR jsonb_array_length(validation_issues_json)>0),
  CONSTRAINT journey_raw_events_retention_order CHECK(retention_expires_at>received_at)
) PARTITION BY RANGE(received_at);

CREATE TABLE journey_raw_events_2026_08 PARTITION OF journey_raw_events
  FOR VALUES FROM ('2026-08-01T00:00:00Z') TO ('2026-09-01T00:00:00Z');
CREATE TABLE journey_raw_events_default PARTITION OF journey_raw_events DEFAULT;
CREATE INDEX journey_raw_events_source_received
  ON journey_raw_events(space_id,source_id,environment,received_at DESC,id);
CREATE INDEX journey_raw_events_event_time
  ON journey_raw_events(space_id,event_name,occurred_at DESC,id) WHERE event_name IS NOT NULL;
CREATE INDEX journey_raw_events_retention
  ON journey_raw_events(retention_expires_at,received_at,id);

CREATE TABLE journey_event_ingest_receipts (
  received_at TIMESTAMPTZ NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT CHECK(event_id IS NULL OR length(event_id) BETWEEN 1 AND 200),
  envelope_sha256 TEXT CHECK(envelope_sha256 IS NULL OR envelope_sha256 ~ '^[a-f0-9]{64}$'),
  raw_event_id TEXT,
  raw_received_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK(outcome IN (
    'accepted','quarantined','duplicate','content_conflict','rejected','rate_limited','over_quota','consent_denied')),
  http_status INTEGER NOT NULL CHECK(http_status IN (200,202,400,401,403,409,413,422,429)),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
  batch_id TEXT CHECK(batch_id IS NULL OR length(batch_id) BETWEEN 1 AND 128),
  attempt_ordinal INTEGER NOT NULL DEFAULT 1 CHECK(attempt_ordinal BETWEEN 1 AND 10000),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(received_at,id),
  UNIQUE(received_at,id,space_id,source_id,environment,event_id),
  CONSTRAINT journey_event_ingest_receipts_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_ingest_receipts_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_event_ingest_receipts_outcome_shape CHECK(
    (outcome IN ('accepted','quarantined') AND http_status=202 AND raw_event_id IS NOT NULL
      AND raw_received_at IS NOT NULL AND error_code IS NULL)
    OR (outcome='duplicate' AND http_status=200 AND raw_event_id IS NOT NULL
      AND raw_received_at IS NOT NULL AND error_code IS NULL)
    OR (outcome='content_conflict' AND http_status=409 AND error_code IS NOT NULL)
    OR (outcome='rate_limited' AND http_status=429 AND error_code IS NOT NULL)
    OR (outcome='over_quota' AND http_status=429 AND error_code IS NOT NULL)
    OR (outcome='consent_denied' AND http_status=403 AND error_code IS NOT NULL)
    OR (outcome='rejected' AND http_status IN (400,401,403,413,422) AND error_code IS NOT NULL)),
  CONSTRAINT journey_event_ingest_receipts_retention_order CHECK(retention_expires_at>received_at)
) PARTITION BY RANGE(received_at);

CREATE TABLE journey_event_ingest_receipts_2026_08 PARTITION OF journey_event_ingest_receipts
  FOR VALUES FROM ('2026-08-01T00:00:00Z') TO ('2026-09-01T00:00:00Z');
CREATE TABLE journey_event_ingest_receipts_default PARTITION OF journey_event_ingest_receipts DEFAULT;
CREATE INDEX journey_event_ingest_receipts_source_received
  ON journey_event_ingest_receipts(space_id,source_id,environment,received_at DESC,id);
CREATE INDEX journey_event_ingest_receipts_event_history
  ON journey_event_ingest_receipts(space_id,source_id,event_id,received_at DESC,id)
  WHERE event_id IS NOT NULL;
CREATE INDEX journey_event_ingest_receipts_retention
  ON journey_event_ingest_receipts(retention_expires_at,received_at,id);

CREATE TABLE journey_event_deduplication (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
  envelope_sha256 TEXT NOT NULL CHECK(envelope_sha256 ~ '^[a-f0-9]{64}$'),
  raw_event_id TEXT NOT NULL,
  raw_received_at TIMESTAMPTZ NOT NULL,
  ingest_receipt_id TEXT NOT NULL,
  first_outcome TEXT NOT NULL CHECK(first_outcome IN ('accepted','quarantined')),
  first_http_status INTEGER NOT NULL CHECK(first_http_status=202),
  first_result_code TEXT CHECK(first_result_code IS NULL OR length(first_result_code) BETWEEN 1 AND 100),
  first_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,source_id,event_id),
  CONSTRAINT journey_event_deduplication_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_deduplication_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_event_deduplication_receipt_fk
    FOREIGN KEY(raw_received_at,ingest_receipt_id,space_id,source_id,environment,event_id)
    REFERENCES journey_event_ingest_receipts(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_event_deduplication_first_result_json CHECK(
    octet_length(first_result_json::text)<=8192 AND jsonb_typeof(first_result_json)='object'),
  CONSTRAINT journey_event_deduplication_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_event_deduplication_retention
  ON journey_event_deduplication(retention_expires_at,space_id,source_id,event_id);

CREATE TABLE journey_event_rejections (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT CHECK(event_id IS NULL OR length(event_id) BETWEEN 1 AND 200),
  ingest_receipt_id TEXT,
  ingest_received_at TIMESTAMPTZ,
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 100),
  field_path TEXT CHECK(field_path IS NULL OR length(field_path) BETWEEN 1 AND 240),
  redacted_detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 TEXT CHECK(payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND 2097152),
  replay_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_event_rejections_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_rejections_ingest_receipt_fk
    FOREIGN KEY(ingest_received_at,ingest_receipt_id,space_id,source_id,environment,event_id)
    REFERENCES journey_event_ingest_receipts(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_event_rejections_receipt_shape CHECK(
    (ingest_receipt_id IS NULL)=(ingest_received_at IS NULL)),
  CONSTRAINT journey_event_rejections_detail_json CHECK(
    octet_length(redacted_detail_json::text)<=16384 AND jsonb_typeof(redacted_detail_json)='object'),
  CONSTRAINT journey_event_rejections_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_event_rejections_source_history
  ON journey_event_rejections(space_id,source_id,environment,created_at DESC,id);
CREATE INDEX journey_event_rejections_retention
  ON journey_event_rejections(retention_expires_at,created_at,id);

CREATE TABLE journey_event_rate_buckets (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  window_started_at TIMESTAMPTZ NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0 CHECK(event_count>=0),
  byte_count BIGINT NOT NULL DEFAULT 0 CHECK(byte_count>=0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,source_id,environment,window_started_at),
  CONSTRAINT journey_event_rate_buckets_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_rate_buckets_minute_aligned CHECK(
    date_trunc('minute',window_started_at)=window_started_at)
);
CREATE INDEX journey_event_rate_buckets_expiry
  ON journey_event_rate_buckets(window_started_at,space_id,source_id);

CREATE TABLE journey_event_processing_inbox (
  raw_received_at TIMESTAMPTZ NOT NULL,
  raw_event_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
  processor TEXT NOT NULL DEFAULT 'connected_journey_v1' CHECK(length(processor) BETWEEN 1 AND 100),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
    ('pending','leased','retry_wait','dead_lettered','completed')),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10000),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(raw_received_at,raw_event_id,processor),
  UNIQUE(raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor),
  CONSTRAINT journey_event_processing_inbox_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT,
  CONSTRAINT journey_event_processing_inbox_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_processing_inbox_lease_shape CHECK(
    (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_expires_at>updated_at)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_event_processing_inbox_terminal_shape CHECK(
    state NOT IN ('completed','dead_lettered') OR available_at<=updated_at)
);
CREATE INDEX journey_event_processing_inbox_claim
  ON journey_event_processing_inbox(state,available_at,lease_expires_at,space_id,source_id,raw_received_at,raw_event_id);
CREATE INDEX journey_event_processing_inbox_source
  ON journey_event_processing_inbox(space_id,source_id,environment,updated_at DESC,raw_event_id);

CREATE TABLE journey_event_processing_receipts (
  attempted_at TIMESTAMPTZ NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  raw_received_at TIMESTAMPTZ NOT NULL,
  raw_event_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
  processor TEXT NOT NULL CHECK(length(processor) BETWEEN 1 AND 100),
  processor_version TEXT NOT NULL CHECK(length(processor_version) BETWEEN 1 AND 80),
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 10000),
  status TEXT NOT NULL CHECK(status IN
    ('succeeded','retryable_failed','terminal_failed','lease_expired')),
  lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  lease_generation INTEGER NOT NULL CHECK(lease_generation>=1),
  checkpoint TEXT CHECK(checkpoint IS NULL OR length(checkpoint) BETWEEN 1 AND 200),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  error_detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(attempted_at,id),
  UNIQUE(attempted_at,id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor),
  CONSTRAINT journey_event_processing_receipts_inbox_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor)
    REFERENCES journey_event_processing_inbox(
      raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor)
    ON DELETE RESTRICT,
  CONSTRAINT journey_event_processing_receipts_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_processing_receipts_status_shape CHECK(
    (status='succeeded' AND error_code IS NULL)
    OR (status<>'succeeded' AND error_code IS NOT NULL)),
  CONSTRAINT journey_event_processing_receipts_error_json CHECK(
    octet_length(error_detail_json::text)<=16384 AND jsonb_typeof(error_detail_json)='object'),
  CONSTRAINT journey_event_processing_receipts_time_order CHECK(completed_at>=attempted_at),
  CONSTRAINT journey_event_processing_receipts_retention_order CHECK(retention_expires_at>completed_at)
) PARTITION BY RANGE(attempted_at);

CREATE TABLE journey_event_processing_receipts_2026_08 PARTITION OF journey_event_processing_receipts
  FOR VALUES FROM ('2026-08-01T00:00:00Z') TO ('2026-09-01T00:00:00Z');
CREATE TABLE journey_event_processing_receipts_default PARTITION OF journey_event_processing_receipts DEFAULT;
CREATE INDEX journey_event_processing_receipts_event_history
  ON journey_event_processing_receipts(
    space_id,source_id,raw_received_at,raw_event_id,processor,attempt_number,attempted_at,id);
CREATE INDEX journey_event_processing_receipts_retention
  ON journey_event_processing_receipts(retention_expires_at,attempted_at,id);

CREATE TABLE journey_event_dead_letters (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  raw_received_at TIMESTAMPTZ NOT NULL,
  raw_event_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
  processor TEXT NOT NULL CHECK(length(processor) BETWEEN 1 AND 100),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
    ('pending','replay_scheduled','resolved','terminal')),
  failure_code TEXT NOT NULL CHECK(length(failure_code) BETWEEN 1 AND 100),
  redacted_detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 10000),
  replay_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  replay_after TIMESTAMPTZ,
  last_processing_receipt_id TEXT,
  last_processing_attempted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_code TEXT CHECK(resolution_code IS NULL OR length(resolution_code) BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(raw_received_at,raw_event_id,processor),
  CONSTRAINT journey_event_dead_letters_raw_event_fk
    FOREIGN KEY(raw_received_at,raw_event_id,space_id,source_id,environment,event_id)
    REFERENCES journey_raw_events(received_at,id,space_id,source_id,environment,event_id)
    ON DELETE RESTRICT,
  CONSTRAINT journey_event_dead_letters_last_processing_receipt_fk
    FOREIGN KEY(last_processing_attempted_at,last_processing_receipt_id,raw_received_at,raw_event_id,
      space_id,source_id,environment,event_id,processor)
    REFERENCES journey_event_processing_receipts(attempted_at,id,raw_received_at,raw_event_id,
      space_id,source_id,environment,event_id,processor)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT journey_event_dead_letters_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_dead_letters_detail_json CHECK(
    octet_length(redacted_detail_json::text)<=16384 AND jsonb_typeof(redacted_detail_json)='object'),
  CONSTRAINT journey_event_dead_letters_receipt_shape CHECK(
    (last_processing_receipt_id IS NULL)=(last_processing_attempted_at IS NULL)),
  CONSTRAINT journey_event_dead_letters_state_shape CHECK(
    (state='pending' AND resolved_at IS NULL AND resolution_code IS NULL)
    OR (state='replay_scheduled' AND replay_eligible AND replay_after IS NOT NULL
      AND resolved_at IS NULL AND resolution_code IS NULL)
    OR (state IN ('resolved','terminal') AND NOT replay_eligible
      AND resolved_at IS NOT NULL AND resolution_code IS NOT NULL)),
  CONSTRAINT journey_event_dead_letters_retention_order CHECK(retention_expires_at>updated_at)
);
CREATE INDEX journey_event_dead_letters_queue
  ON journey_event_dead_letters(space_id,state,replay_eligible,replay_after,updated_at DESC,id);
CREATE INDEX journey_event_dead_letters_source
  ON journey_event_dead_letters(space_id,source_id,environment,updated_at DESC,id);
CREATE INDEX journey_event_dead_letters_retention
  ON journey_event_dead_letters(retention_expires_at,updated_at,id);

CREATE TABLE journey_event_data_audit (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  action TEXT NOT NULL CHECK(action IN (
    'debug.viewed','rejection.viewed','dead_letter.viewed','dead_letter.replay_requested',
    'dead_letter.resolved','event.redacted')),
  target_type TEXT NOT NULL CHECK(target_type IN
    ('raw_event','ingest_receipt','rejection','dead_letter','processing_receipt')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_event_data_audit_source_tenant_environment_fk
    FOREIGN KEY(source_id,space_id,environment)
    REFERENCES journey_event_sources(id,space_id,environment) ON DELETE CASCADE,
  CONSTRAINT journey_event_data_audit_detail_json CHECK(
    octet_length(detail_json::text)<=16384 AND jsonb_typeof(detail_json)='object'),
  CONSTRAINT journey_event_data_audit_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_event_data_audit_space_history
  ON journey_event_data_audit(space_id,created_at DESC,id);
CREATE INDEX journey_event_data_audit_source_history
  ON journey_event_data_audit(space_id,source_id,environment,created_at DESC,id);
CREATE INDEX journey_event_data_audit_retention
  ON journey_event_data_audit(retention_expires_at,created_at,id);

-- Appending is allowed, rewriting is not. Retention purges require both the
-- table owner and an explicit transaction-local opt-in after expiry; the
-- application role cannot bypass this with an arbitrary custom GUC.
CREATE OR REPLACE FUNCTION journey_event_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $journey_event_append_only_guard$
DECLARE table_owner TEXT;
DECLARE expires_at TIMESTAMPTZ;
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'journey event facts and receipts are append-only'
      USING ERRCODE='55000';
  END IF;
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid=TG_RELID;
  expires_at := NULLIF(to_jsonb(OLD)->>'retention_expires_at','')::timestamptz;
  IF current_user=table_owner
      AND current_setting('seemplify.retention_purge',TRUE)='on'
      AND expires_at IS NOT NULL AND expires_at<=clock_timestamp() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'journey event facts and receipts cannot be deleted before an authorised retention purge'
    USING ERRCODE='55000';
END
$journey_event_append_only_guard$;

CREATE TRIGGER journey_raw_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_raw_events
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_event_ingest_receipts_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_event_ingest_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_event_deduplication_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_event_deduplication
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_event_rejections_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_event_rejections
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_event_processing_receipts_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_event_processing_receipts
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();
CREATE TRIGGER journey_event_data_audit_append_only_trigger
  BEFORE UPDATE OR DELETE ON journey_event_data_audit
  FOR EACH ROW EXECUTE FUNCTION journey_event_append_only_guard();

-- Restore any development rows staged from an SQLite cutover. JSON, boolean,
-- and timestamp conversion is explicit so production column types do not
-- inherit SQLite's TEXT/INTEGER affinity.
DO $journey_event_data_plane_restore_cutover$
BEGIN
  IF to_regclass('pg_temp.runtime17_cutover_journey_raw_events') IS NOT NULL THEN
    INSERT INTO journey_raw_events(received_at,id,space_id,source_id,environment,credential_id,event_id,
      protocol_version,event_call,event_name,event_version,occurred_at,sent_at,schema_version_id,
      anonymous_id_hash,user_id_hash,account_id_hash,session_id_hash,channel,consent_state,ingest_state,
      payload_json,context_json,consent_json,validation_issues_json,envelope_sha256,payload_bytes,
      sdk_name,sdk_version,retention_expires_at)
    SELECT received_at::timestamptz,id,space_id,source_id,environment,credential_id,event_id,
      protocol_version,event_call,event_name,event_version::integer,occurred_at::timestamptz,
      NULLIF(sent_at,'')::timestamptz,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,
      session_id_hash,channel,consent_state,ingest_state,payload_json::jsonb,context_json::jsonb,
      consent_json::jsonb,validation_issues_json::jsonb,envelope_sha256,payload_bytes::integer,
      sdk_name,sdk_version,retention_expires_at::timestamptz
    FROM runtime17_cutover_journey_raw_events;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_ingest_receipts') IS NOT NULL THEN
    INSERT INTO journey_event_ingest_receipts(received_at,id,space_id,source_id,environment,event_id,
      envelope_sha256,raw_event_id,raw_received_at,outcome,http_status,error_code,request_id,batch_id,
      attempt_ordinal,retention_expires_at)
    SELECT received_at::timestamptz,id,space_id,source_id,environment,event_id,envelope_sha256,
      raw_event_id,NULLIF(raw_received_at,'')::timestamptz,outcome,http_status::integer,error_code,
      request_id,batch_id,attempt_ordinal::integer,retention_expires_at::timestamptz
    FROM runtime17_cutover_journey_event_ingest_receipts;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_deduplication') IS NOT NULL THEN
    INSERT INTO journey_event_deduplication(space_id,source_id,environment,event_id,envelope_sha256,
      raw_event_id,raw_received_at,ingest_receipt_id,first_outcome,first_http_status,first_result_code,
      first_result_json,created_at,retention_expires_at)
    SELECT space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at::timestamptz,
      ingest_receipt_id,first_outcome,first_http_status::integer,first_result_code,first_result_json::jsonb,
      created_at::timestamptz,retention_expires_at::timestamptz
    FROM runtime17_cutover_journey_event_deduplication;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_rejections') IS NOT NULL THEN
    INSERT INTO journey_event_rejections(id,space_id,source_id,environment,event_id,ingest_receipt_id,
      ingest_received_at,code,field_path,redacted_detail_json,payload_sha256,payload_bytes,replay_eligible,
      created_at,retention_expires_at)
    SELECT id,space_id,source_id,environment,event_id,ingest_receipt_id,
      NULLIF(ingest_received_at,'')::timestamptz,code,field_path,redacted_detail_json::jsonb,payload_sha256,
      payload_bytes::integer,replay_eligible::text IN ('1','true'),created_at::timestamptz,
      retention_expires_at::timestamptz FROM runtime17_cutover_journey_event_rejections;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_rate_buckets') IS NOT NULL THEN
    INSERT INTO journey_event_rate_buckets(space_id,source_id,environment,window_started_at,event_count,
      byte_count,updated_at)
    SELECT space_id,source_id,environment,window_started_at::timestamptz,event_count::bigint,
      byte_count::bigint,updated_at::timestamptz FROM runtime17_cutover_journey_event_rate_buckets;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_processing_inbox') IS NOT NULL THEN
    INSERT INTO journey_event_processing_inbox(raw_received_at,raw_event_id,space_id,source_id,environment,
      event_id,processor,state,available_at,lease_owner,lease_token,lease_generation,lease_expires_at,
      attempt_count,last_error_code,updated_at)
    SELECT raw_received_at::timestamptz,raw_event_id,space_id,source_id,environment,event_id,processor,state,
      available_at::timestamptz,lease_owner,lease_token,lease_generation::integer,
      NULLIF(lease_expires_at,'')::timestamptz,attempt_count::integer,last_error_code,updated_at::timestamptz
    FROM runtime17_cutover_journey_event_processing_inbox;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_processing_receipts') IS NOT NULL THEN
    INSERT INTO journey_event_processing_receipts(attempted_at,id,raw_received_at,raw_event_id,space_id,
      source_id,environment,event_id,processor,processor_version,attempt_number,status,lease_token,
      lease_generation,checkpoint,error_code,error_detail_json,completed_at,retention_expires_at)
    SELECT attempted_at::timestamptz,id,raw_received_at::timestamptz,raw_event_id,space_id,source_id,
      environment,event_id,processor,processor_version,attempt_number::integer,status,lease_token,
      lease_generation::integer,checkpoint,error_code,error_detail_json::jsonb,completed_at::timestamptz,
      retention_expires_at::timestamptz FROM runtime17_cutover_journey_event_processing_receipts;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_dead_letters') IS NOT NULL THEN
    INSERT INTO journey_event_dead_letters(id,raw_received_at,raw_event_id,space_id,source_id,environment,
      event_id,processor,state,failure_code,redacted_detail_json,attempt_count,replay_eligible,replay_after,
      last_processing_receipt_id,last_processing_attempted_at,resolved_at,resolution_code,updated_at,
      retention_expires_at)
    SELECT id,raw_received_at::timestamptz,raw_event_id,space_id,source_id,environment,event_id,processor,
      state,failure_code,redacted_detail_json::jsonb,attempt_count::integer,
      replay_eligible::text IN ('1','true'),NULLIF(replay_after,'')::timestamptz,last_processing_receipt_id,
      NULLIF(last_processing_attempted_at,'')::timestamptz,NULLIF(resolved_at,'')::timestamptz,
      resolution_code,updated_at::timestamptz,retention_expires_at::timestamptz
    FROM runtime17_cutover_journey_event_dead_letters;
  END IF;
  IF to_regclass('pg_temp.runtime17_cutover_journey_event_data_audit') IS NOT NULL THEN
    INSERT INTO journey_event_data_audit(id,space_id,source_id,environment,action,target_type,target_id,
      actor_user_id,detail_json,created_at,retention_expires_at)
    SELECT id,space_id,source_id,environment,action,target_type,target_id,actor_user_id,detail_json::jsonb,
      created_at::timestamptz,retention_expires_at::timestamptz
    FROM runtime17_cutover_journey_event_data_audit;
  END IF;
END
$journey_event_data_plane_restore_cutover$;
