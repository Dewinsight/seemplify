-- Runtime schema 14: permission-aware Journey evidence refresh lifecycle.
--
-- Existing bounded snapshots remain intact. The two nullable timestamps add
-- source-change lineage without pretending historical rows captured a source
-- revision. Explicit refreshes append content-free audit fingerprints.

ALTER TABLE journey_evidence_links
  ADD COLUMN IF NOT EXISTS source_updated_at TEXT;
ALTER TABLE journey_evidence_links
  ADD COLUMN IF NOT EXISTS last_validated_at TEXT;

UPDATE journey_evidence_links
SET last_validated_at=created_at
WHERE last_validated_at IS NULL;

CREATE TABLE IF NOT EXISTS journey_evidence_audit_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  evidence_link_id TEXT NOT NULL REFERENCES journey_evidence_links(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('refreshed')),
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  before_fingerprint TEXT NOT NULL CHECK(length(before_fingerprint)=64),
  after_fingerprint TEXT NOT NULL CHECK(length(after_fingerprint)=64),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journey_evidence_audit_link
  ON journey_evidence_audit_events(evidence_link_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS journey_evidence_audit_space
  ON journey_evidence_audit_events(space_id,created_at DESC,id);
