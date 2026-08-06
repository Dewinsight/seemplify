-- Runtime schema 19: Journey Research Hub control plane.
--
-- This migration stores bounded references, immutable snapshots, reviewer
-- decisions and durable refresh work. Authoritative source content, document
-- chunks, embeddings and retrieval remain in their existing systems of
-- record. Runtime 19 requires the checksummed runtime-18 predecessor.

DO $journey_research_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>18 THEN
    RAISE EXCEPTION 'runtime-19 Journey Research Hub requires the checksummed runtime-18 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_research_predecessor$;

CREATE TABLE journey_research_sources (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN (
    'knowledge_document','survey_response','survey_analysis','social_mention','social_intelligence',
    'ticket','assistant_artifact','agreement','interview','observation','event_aggregate')),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 400),
  adapter TEXT NOT NULL CHECK(length(adapter) BETWEEN 1 AND 80),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','inaccessible','deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  last_resolved_at TIMESTAMPTZ,
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,source_type,source_ref),
  UNIQUE(space_id,idempotency_key)
);
CREATE INDEX journey_research_sources_catalogue
  ON journey_research_sources(space_id,state,source_type,updated_at DESC,id);

CREATE TABLE journey_research_snapshots (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  source_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  access_state TEXT NOT NULL CHECK(access_state IN ('available','inaccessible','deleted')),
  source_label TEXT NOT NULL CHECK(octet_length(source_label)<=800),
  excerpt TEXT NOT NULL CHECK(octet_length(excerpt)<=8192),
  population TEXT NOT NULL CHECK(octet_length(population)<=800),
  sample_size BIGINT CHECK(sample_size IS NULL OR sample_size BETWEEN 0 AND 1000000000),
  collected_at TIMESTAMPTZ,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,source_id,space_id),
  UNIQUE(source_id,version_number),
  UNIQUE(source_id,fingerprint),
  CONSTRAINT journey_research_snapshots_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_snapshots_metadata_json CHECK(
    jsonb_typeof(metadata_json)='object' AND octet_length(metadata_json::text)<=32768),
  CONSTRAINT journey_research_snapshots_window_order CHECK(
    window_start IS NULL OR window_end IS NULL OR window_end>=window_start),
  CONSTRAINT journey_research_snapshots_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_research_snapshots_history
  ON journey_research_snapshots(space_id,source_id,version_number DESC,id);
CREATE INDEX journey_research_snapshots_retention
  ON journey_research_snapshots(retention_expires_at,space_id,source_id,id);

CREATE TABLE journey_research_links (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card','persona')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','invalidated')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_research_links_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_links_snapshot_tenant_fk
    FOREIGN KEY(snapshot_id,source_id,space_id)
    REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX journey_research_links_one_active_source
  ON journey_research_links(space_id,target_type,target_id,source_id) WHERE state='active';
CREATE INDEX journey_research_links_target
  ON journey_research_links(space_id,target_type,target_id,updated_at DESC,id);

CREATE TABLE journey_research_assessments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  link_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>0),
  relationship TEXT NOT NULL CHECK(relationship IN ('supports','contradicts','neutral')),
  classification TEXT NOT NULL CHECK(classification IN (
    'hypothesis','anecdotal','supported','strongly_supported','contradicted','stale','invalidated')),
  confidence NUMERIC(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  freshness_days INTEGER CHECK(freshness_days IS NULL OR freshness_days BETWEEN 1 AND 3650),
  reason_summary TEXT NOT NULL DEFAULT '' CHECK(octet_length(reason_summary)<=4096),
  reason_sha256 TEXT NOT NULL CHECK(reason_sha256 ~ '^[a-f0-9]{64}$'),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK(method IN ('human_review','imported_review')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(link_id,revision),
  UNIQUE(id,link_id,space_id),
  CONSTRAINT journey_research_assessments_link_tenant_fk
    FOREIGN KEY(link_id,space_id) REFERENCES journey_research_links(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_research_assessments_history
  ON journey_research_assessments(space_id,link_id,revision DESC,id);

CREATE TABLE journey_research_gaps (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card','persona')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK(octet_length(title) BETWEEN 1 AND 800),
  description TEXT NOT NULL DEFAULT '' CHECK(octet_length(description)<=8192),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','planned','in_progress','resolved','dismissed')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_link_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  due_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_research_gaps_resolution_tenant_fk
    FOREIGN KEY(resolution_link_id,space_id) REFERENCES journey_research_links(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_research_gaps_inbox
  ON journey_research_gaps(space_id,status,priority,updated_at DESC,id);

-- Both knowledge tables already expose tenant identities. The document needs
-- one additional candidate key so an intake cannot pair a real document with
-- a different knowledge base from the same (or another) space.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_research_tenant_identity
  ON knowledge_documents(id,knowledge_base_id,space_id);

CREATE TABLE journey_research_intakes (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  knowledge_document_id TEXT NOT NULL,
  intake_kind TEXT NOT NULL CHECK(intake_kind IN ('interview','observation','research_note')),
  method TEXT NOT NULL CHECK(length(method) BETWEEN 1 AND 120),
  conducted_at TIMESTAMPTZ,
  population TEXT NOT NULL DEFAULT '' CHECK(octet_length(population)<=800),
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_basis TEXT NOT NULL CHECK(consent_basis IN ('documented','not_required')),
  researcher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_research_intakes_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_research_intakes_base_tenant_fk
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_research_intakes_document_base_tenant_fk
    FOREIGN KEY(knowledge_document_id,knowledge_base_id,space_id)
    REFERENCES knowledge_documents(id,knowledge_base_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_research_intakes_tags_json CHECK(
    jsonb_typeof(tags_json)='array' AND octet_length(tags_json::text)<=4096),
  CONSTRAINT journey_research_intakes_retention_order CHECK(retention_expires_at>created_at)
);
CREATE INDEX journey_research_intakes_history
  ON journey_research_intakes(space_id,intake_kind,created_at DESC,id);

CREATE TABLE journey_research_monitors (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused')),
  interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 300 AND 2592000),
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,source_id,owner_user_id),
  UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_research_monitors_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_research_monitors_due
  ON journey_research_monitors(state,next_run_at,space_id,id);

CREATE TABLE journey_research_refresh_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  monitor_id TEXT,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual','scheduled')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry_wait','completed','failed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
  before_snapshot_id TEXT,
  after_snapshot_id TEXT,
  changed_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE(id,space_id),
  UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_research_refresh_runs_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_refresh_runs_monitor_tenant_fk
    FOREIGN KEY(monitor_id,space_id) REFERENCES journey_research_monitors(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_refresh_runs_before_snapshot_tenant_fk
    FOREIGN KEY(before_snapshot_id,source_id,space_id)
    REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_research_refresh_runs_after_snapshot_tenant_fk
    FOREIGN KEY(after_snapshot_id,source_id,space_id)
    REFERENCES journey_research_snapshots(id,source_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_research_refresh_runs_changed_fields_json CHECK(
    jsonb_typeof(changed_fields_json)='array' AND octet_length(changed_fields_json::text)<=16384),
  CONSTRAINT journey_research_refresh_runs_lease_shape CHECK(
    (state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_research_refresh_runs_completion_shape CHECK(
    (state IN ('completed','failed'))=(completed_at IS NOT NULL))
);
CREATE INDEX journey_research_refresh_runs_claim
  ON journey_research_refresh_runs(state,available_at,lease_expires_at,space_id,id);
CREATE INDEX journey_research_refresh_runs_source
  ON journey_research_refresh_runs(space_id,source_id,created_at DESC,id);

CREATE TABLE journey_research_refresh_attempts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 100),
  lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
  status TEXT NOT NULL CHECK(status IN ('succeeded','retryable_failed','terminal_failed','lease_expired')),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  UNIQUE(run_id,attempt_number,status),
  CONSTRAINT journey_research_refresh_attempts_run_tenant_fk
    FOREIGN KEY(run_id,space_id) REFERENCES journey_research_refresh_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_refresh_attempts_status_shape CHECK(
    (status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
  CONSTRAINT journey_research_refresh_attempts_time_order CHECK(completed_at>=started_at)
);
CREATE INDEX journey_research_refresh_attempts_history
  ON journey_research_refresh_attempts(space_id,run_id,attempt_number,id);

CREATE TABLE journey_research_notifications (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  refresh_run_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN (
    'source_changed','source_inaccessible','source_recovered','source_stale','refresh_failed')),
  dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,
  read_at TIMESTAMPTZ,
  UNIQUE(id,space_id),
  UNIQUE(space_id,user_id,dedupe_key),
  CONSTRAINT journey_research_notifications_source_tenant_fk
    FOREIGN KEY(source_id,space_id) REFERENCES journey_research_sources(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_notifications_run_tenant_fk
    FOREIGN KEY(refresh_run_id,space_id) REFERENCES journey_research_refresh_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_research_notifications_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=8192),
  CONSTRAINT journey_research_notifications_read_shape CHECK(
    (state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
);
CREATE INDEX journey_research_notifications_inbox
  ON journey_research_notifications(space_id,user_id,state,created_at DESC,id);

CREATE TABLE journey_research_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'source.catalogued','source.state_changed','snapshot.created','link.created','link.snapshot_applied',
    'assessment.created','gap.created','gap.updated','intake.created','monitor.created','monitor.updated',
    'refresh.queued','refresh.completed','refresh.failed','notification.updated')),
  target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 80),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_research_audit_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=8192)
);
CREATE INDEX journey_research_audit_history
  ON journey_research_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_research_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_research_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey Research Hub immutable history cannot be changed'
    USING ERRCODE='55000';
END
$journey_research_append_only_guard$;

CREATE TRIGGER journey_research_snapshots_append_only_trigger
BEFORE UPDATE ON journey_research_snapshots
FOR EACH ROW EXECUTE FUNCTION journey_research_append_only_guard();
CREATE TRIGGER journey_research_assessments_append_only_trigger
BEFORE UPDATE ON journey_research_assessments
FOR EACH ROW EXECUTE FUNCTION journey_research_append_only_guard();
CREATE TRIGGER journey_research_intakes_append_only_trigger
BEFORE UPDATE ON journey_research_intakes
FOR EACH ROW EXECUTE FUNCTION journey_research_append_only_guard();
CREATE TRIGGER journey_research_refresh_attempts_append_only_trigger
BEFORE UPDATE ON journey_research_refresh_attempts
FOR EACH ROW EXECUTE FUNCTION journey_research_append_only_guard();
CREATE TRIGGER journey_research_audit_append_only_trigger
BEFORE UPDATE ON journey_research_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_research_append_only_guard();
