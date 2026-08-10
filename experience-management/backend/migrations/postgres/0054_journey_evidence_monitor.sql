-- Runtime schema 54: durable, content-safe Journey evidence monitoring.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>53 THEN
    RAISE EXCEPTION 'runtime-54 journey evidence monitor requires runtime-53' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_evidence_monitor_states (
  evidence_link_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','current','changed','stale','unavailable','authority_missing','invalidated')),
  observation_reason TEXT NOT NULL DEFAULT 'pending' CHECK(observation_reason IN (
    'pending','source_current','source_changed','freshness_expired','source_unavailable',
    'authority_missing','already_invalidated')),
  snapshot_fingerprint TEXT NOT NULL CHECK(snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  observed_source_fingerprint TEXT CHECK(observed_source_fingerprint IS NULL OR observed_source_fingerprint ~ '^[a-f0-9]{64}$'),
  observation_fingerprint TEXT CHECK(observation_fingerprint IS NULL OR observation_fingerprint ~ '^[a-f0-9]{64}$'),
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures BETWEEN 0 AND 20),
  last_error_sha256 TEXT CHECK(last_error_sha256 IS NULL OR last_error_sha256 ~ '^[a-f0-9]{64}$'),
  lease_owner TEXT,
  lease_token TEXT,
  lease_generation BIGINT NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(evidence_link_id,space_id),
  FOREIGN KEY(evidence_link_id,space_id) REFERENCES journey_evidence_links(id,space_id) ON DELETE CASCADE,
  CHECK((lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND length(lease_owner) BETWEEN 1 AND 200
      AND lease_token IS NOT NULL AND lease_token ~ '^[a-f0-9]{64}$' AND lease_expires_at IS NOT NULL))
);
CREATE INDEX journey_evidence_monitor_due
  ON journey_evidence_monitor_states(next_check_at,evidence_link_id)
  WHERE lease_owner IS NULL;
CREATE INDEX journey_evidence_monitor_expired_lease
  ON journey_evidence_monitor_states(lease_expires_at,evidence_link_id)
  WHERE lease_owner IS NOT NULL;
CREATE INDEX journey_evidence_monitor_space
  ON journey_evidence_monitor_states(space_id,status,last_observed_at DESC,evidence_link_id);

CREATE TABLE journey_evidence_monitor_events (
  id TEXT PRIMARY KEY,
  evidence_link_sha256 TEXT NOT NULL CHECK(evidence_link_sha256 ~ '^[a-f0-9]{64}$'),
  space_id TEXT NOT NULL,
  from_status TEXT NOT NULL CHECK(from_status IN (
    'pending','current','changed','stale','unavailable','authority_missing','invalidated')),
  to_status TEXT NOT NULL CHECK(to_status IN (
    'current','changed','stale','unavailable','authority_missing','invalidated')),
  observation_reason TEXT NOT NULL CHECK(observation_reason IN (
    'source_current','source_changed','freshness_expired','source_unavailable',
    'authority_missing','already_invalidated')),
  snapshot_fingerprint TEXT NOT NULL CHECK(snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  observed_source_fingerprint TEXT CHECK(observed_source_fingerprint IS NULL OR observed_source_fingerprint ~ '^[a-f0-9]{64}$'),
  observation_fingerprint TEXT NOT NULL CHECK(observation_fingerprint ~ '^[a-f0-9]{64}$'),
  invalidation_applied BOOLEAN NOT NULL DEFAULT FALSE,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  UNIQUE(evidence_link_sha256,from_status,to_status,observation_fingerprint)
);
CREATE INDEX journey_evidence_monitor_event_history
  ON journey_evidence_monitor_events(space_id,created_at DESC,id);

CREATE FUNCTION journey_evidence_monitor_event_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN RAISE EXCEPTION 'journey evidence monitor events are append-only' USING ERRCODE='55000'; END $guard$;
REVOKE ALL ON FUNCTION journey_evidence_monitor_event_append_only_guard() FROM PUBLIC;
-- Tenant deletion may cascade these content-free receipts. Runtime roles will
-- have no DELETE grant; the trigger independently prevents receipt rewriting.
CREATE TRIGGER journey_evidence_monitor_events_append_only BEFORE UPDATE OR DELETE
  ON journey_evidence_monitor_events FOR EACH ROW
  EXECUTE FUNCTION journey_evidence_monitor_event_append_only_guard();
