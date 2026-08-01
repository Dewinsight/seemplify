-- Runtime schema 6: reviewed, derived social-intelligence publications.
-- report_id intentionally remains a durable provenance identifier rather than
-- a cascading foreign key. If retained X history is removed, the publication
-- tombstone and derived document remain attributable without retaining raw post
-- text. Knowledge-base/document lifecycle still cascades the mapping.

CREATE TABLE IF NOT EXISTS social_intelligence_publications (
  report_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  knowledge_base_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  job_id TEXT REFERENCES knowledge_jobs(id) ON DELETE SET NULL,
  source_requested_by TEXT NOT NULL,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK(review_status='reviewed'),
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(report_id,knowledge_base_id),
  UNIQUE(document_id),
  FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS social_intelligence_publications_space_created
  ON social_intelligence_publications(space_id,created_at DESC);
