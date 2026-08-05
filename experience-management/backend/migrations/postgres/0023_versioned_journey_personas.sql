-- Runtime schema 23: reusable, immutable, evidence-backed persona versions.
--
-- Existing journey_personas rows remain the compatibility/current-state
-- projection. Every row is losslessly snapshotted into version 1 before the
-- current pointer is made mandatory at the application boundary. Published
-- journey versions pin an exact persona version; later working edits never
-- rewrite those historical reads.

DO $journey_persona_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>22 THEN
    RAISE EXCEPTION 'runtime-23 versioned personas require the checksummed runtime-22 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_persona_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_personas_tenant_identity
  ON journey_personas(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_evidence_links_tenant_identity
  ON journey_evidence_links(id,space_id);
-- Runtime 22 already owns the canonical
-- journey_ai_suggestion_versions_tenant_identity index on
-- (id,definition_id,space_id). Reuse it for publication-pin tenant FKs rather
-- than maintaining a duplicate B-tree over the same values.

ALTER TABLE journey_personas ADD COLUMN IF NOT EXISTS current_version_id TEXT;
ALTER TABLE journey_personas ADD COLUMN IF NOT EXISTS approved_version_id TEXT;

CREATE TABLE IF NOT EXISTS journey_persona_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  persona_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  name TEXT NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 800),
  summary TEXT NOT NULL DEFAULT '' CHECK(octet_length(summary)<=65536),
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('draft','in_review','active','retired')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('workspace','legacy_audience_draft','ai_draft')),
  attributes_json TEXT NOT NULL DEFAULT '{}',
  goals_json TEXT NOT NULL DEFAULT '[]',
  behaviours_json TEXT NOT NULL DEFAULT '[]',
  needs_json TEXT NOT NULL DEFAULT '[]',
  barriers_json TEXT NOT NULL DEFAULT '[]',
  review_at TIMESTAMPTZ,
  content_checksum TEXT NOT NULL CHECK(content_checksum ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_persona_versions_number_once UNIQUE(persona_id,version_number),
  CONSTRAINT journey_persona_versions_tenant_identity UNIQUE(id,persona_id,space_id),
  CONSTRAINT journey_persona_versions_persona_tenant_fk FOREIGN KEY(persona_id,space_id)
    REFERENCES journey_personas(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_persona_versions_attributes_json CHECK(
    jsonb_typeof(attributes_json::jsonb)='object' AND octet_length(attributes_json)<=131072),
  CONSTRAINT journey_persona_versions_goals_json CHECK(
    jsonb_typeof(goals_json::jsonb)='array' AND octet_length(goals_json)<=131072),
  CONSTRAINT journey_persona_versions_behaviours_json CHECK(
    jsonb_typeof(behaviours_json::jsonb)='array' AND octet_length(behaviours_json)<=131072),
  CONSTRAINT journey_persona_versions_needs_json CHECK(
    jsonb_typeof(needs_json::jsonb)='array' AND octet_length(needs_json)<=131072),
  CONSTRAINT journey_persona_versions_barriers_json CHECK(
    jsonb_typeof(barriers_json::jsonb)='array' AND octet_length(barriers_json)<=131072)
);
CREATE INDEX IF NOT EXISTS journey_persona_versions_persona
  ON journey_persona_versions(space_id,persona_id,version_number DESC);

CREATE TABLE IF NOT EXISTS journey_persona_claims (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  persona_version_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  claim_type TEXT NOT NULL CHECK(claim_type IN ('summary','attribute','goal','behaviour','need','barrier')),
  label TEXT NOT NULL DEFAULT '' CHECK(octet_length(label)<=800),
  value TEXT NOT NULL CHECK(octet_length(value) BETWEEN 1 AND 65536),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  claim_checksum TEXT NOT NULL CHECK(claim_checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_persona_claims_slot_once UNIQUE(persona_version_id,claim_type,ordinal),
  CONSTRAINT journey_persona_claims_tenant_identity UNIQUE(id,persona_version_id,persona_id,space_id),
  CONSTRAINT journey_persona_claims_version_tenant_fk
    FOREIGN KEY(persona_version_id,persona_id,space_id)
    REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS journey_persona_claims_version
  ON journey_persona_claims(persona_version_id,claim_type,ordinal,id);

CREATE TABLE IF NOT EXISTS journey_persona_claim_evidence (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  claim_id TEXT NOT NULL,
  persona_version_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  evidence_link_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  assessment_at_link TEXT NOT NULL CHECK(assessment_at_link IN ('supports','contradicts','neutral')),
  evidence_snapshot_fingerprint TEXT NOT NULL CHECK(evidence_snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_persona_claim_evidence_once UNIQUE(claim_id,evidence_link_id),
  CONSTRAINT journey_persona_claim_evidence_claim_tenant_fk
    FOREIGN KEY(claim_id,persona_version_id,persona_id,space_id)
    REFERENCES journey_persona_claims(id,persona_version_id,persona_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_persona_claim_evidence_link_tenant_fk FOREIGN KEY(evidence_link_id,space_id)
    REFERENCES journey_evidence_links(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS journey_persona_claim_evidence_claim
  ON journey_persona_claim_evidence(claim_id,evidence_link_id,id);

CREATE TABLE IF NOT EXISTS journey_persona_review_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  persona_version_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  action TEXT NOT NULL CHECK(action IN ('submitted','approved','changes_requested','withdrawn')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL DEFAULT '' CHECK(octet_length(comment)<=16000),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_persona_review_events_sequence_once UNIQUE(persona_version_id,sequence),
  CONSTRAINT journey_persona_review_events_version_tenant_fk
    FOREIGN KEY(persona_version_id,persona_id,space_id)
    REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS journey_persona_review_events_version
  ON journey_persona_review_events(persona_version_id,sequence DESC,id);

CREATE TABLE IF NOT EXISTS journey_map_version_personas (
  version_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  persona_version_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  review_state_at_pin TEXT NOT NULL CHECK(review_state_at_pin IN ('draft','in_review','changes_requested','approved')),
  content_checksum_at_pin TEXT NOT NULL CHECK(content_checksum_at_pin ~ '^[a-f0-9]{64}$'),
  evidence_coverage_at_pin INTEGER NOT NULL DEFAULT 0 CHECK(evidence_coverage_at_pin>=0),
  pinned_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(version_id,persona_id),
  CONSTRAINT journey_map_version_personas_map_tenant_fk
    FOREIGN KEY(version_id,definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_map_version_personas_persona_tenant_fk
    FOREIGN KEY(persona_version_id,persona_id,space_id)
    REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS journey_map_version_personas_persona
  ON journey_map_version_personas(space_id,persona_id,version_id);

-- A live SQLite source can already contain these local-runtime tables. The
-- cutover faithfully copies them before PostgreSQL runtime migrations run, so
-- add the stable, operator-visible constraint names when CREATE TABLE above
-- was intentionally a no-op. Existing equivalent generated constraints remain
-- harmless; these names make tenant-boundary drift directly auditable.
DO $journey_persona_cutover_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_versions_persona_tenant_fk') THEN
    ALTER TABLE journey_persona_versions ADD CONSTRAINT journey_persona_versions_persona_tenant_fk
      FOREIGN KEY(persona_id,space_id) REFERENCES journey_personas(id,space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_claims_version_tenant_fk') THEN
    ALTER TABLE journey_persona_claims ADD CONSTRAINT journey_persona_claims_version_tenant_fk
      FOREIGN KEY(persona_version_id,persona_id,space_id)
      REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_claim_evidence_claim_tenant_fk') THEN
    ALTER TABLE journey_persona_claim_evidence ADD CONSTRAINT journey_persona_claim_evidence_claim_tenant_fk
      FOREIGN KEY(claim_id,persona_version_id,persona_id,space_id)
      REFERENCES journey_persona_claims(id,persona_version_id,persona_id,space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_claim_evidence_link_tenant_fk') THEN
    ALTER TABLE journey_persona_claim_evidence ADD CONSTRAINT journey_persona_claim_evidence_link_tenant_fk
      FOREIGN KEY(evidence_link_id,space_id) REFERENCES journey_evidence_links(id,space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_review_events_version_tenant_fk') THEN
    ALTER TABLE journey_persona_review_events ADD CONSTRAINT journey_persona_review_events_version_tenant_fk
      FOREIGN KEY(persona_version_id,persona_id,space_id)
      REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_map_version_personas_map_tenant_fk') THEN
    ALTER TABLE journey_map_version_personas ADD CONSTRAINT journey_map_version_personas_map_tenant_fk
      FOREIGN KEY(version_id,definition_id,space_id)
      REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_map_version_personas_persona_tenant_fk') THEN
    ALTER TABLE journey_map_version_personas ADD CONSTRAINT journey_map_version_personas_persona_tenant_fk
      FOREIGN KEY(persona_version_id,persona_id,space_id)
      REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT;
  END IF;
END
$journey_persona_cutover_constraints$;

DO $journey_persona_cutover_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_versions_checksum_runtime23') THEN
    ALTER TABLE journey_persona_versions ADD CONSTRAINT journey_persona_versions_checksum_runtime23
      CHECK(content_checksum ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_versions_json_runtime23') THEN
    ALTER TABLE journey_persona_versions ADD CONSTRAINT journey_persona_versions_json_runtime23 CHECK(
      jsonb_typeof(attributes_json::jsonb)='object'
      AND jsonb_typeof(goals_json::jsonb)='array'
      AND jsonb_typeof(behaviours_json::jsonb)='array'
      AND jsonb_typeof(needs_json::jsonb)='array'
      AND jsonb_typeof(barriers_json::jsonb)='array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_claims_checksum_runtime23') THEN
    ALTER TABLE journey_persona_claims ADD CONSTRAINT journey_persona_claims_checksum_runtime23
      CHECK(claim_checksum ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_persona_claim_evidence_checksum_runtime23') THEN
    ALTER TABLE journey_persona_claim_evidence ADD CONSTRAINT journey_persona_claim_evidence_checksum_runtime23
      CHECK(evidence_snapshot_fingerprint ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journey_map_version_personas_checksum_runtime23') THEN
    ALTER TABLE journey_map_version_personas ADD CONSTRAINT journey_map_version_personas_checksum_runtime23
      CHECK(content_checksum_at_pin ~ '^[a-f0-9]{64}$');
  END IF;
END
$journey_persona_cutover_checks$;

-- Validate legacy JSON before inserting anything. A malformed row stops the
-- migration with its persona ID instead of silently dropping a claim.
DO $journey_persona_validate_legacy_json$
DECLARE legacy RECORD;
BEGIN
  FOR legacy IN
    SELECT id,attributes_json,goals_json,behaviours_json,needs_json,barriers_json FROM journey_personas
    UNION ALL
    SELECT id,attributes_json,goals_json,behaviours_json,needs_json,barriers_json FROM journey_persona_versions
  LOOP
    BEGIN
      IF jsonb_typeof(legacy.attributes_json::jsonb)<>'object'
        OR jsonb_typeof(legacy.goals_json::jsonb)<>'array'
        OR jsonb_typeof(legacy.behaviours_json::jsonb)<>'array'
        OR jsonb_typeof(legacy.needs_json::jsonb)<>'array'
        OR jsonb_typeof(legacy.barriers_json::jsonb)<>'array' THEN
        RAISE EXCEPTION 'invalid persona JSON shape';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'runtime-23 cannot losslessly version malformed persona % JSON',legacy.id
        USING ERRCODE='22023';
    END;
  END LOOP;
END
$journey_persona_validate_legacy_json$;

INSERT INTO journey_persona_versions
  (id,persona_id,space_id,version_number,name,summary,lifecycle_state,owner_user_id,source,attributes_json,
   goals_json,behaviours_json,needs_json,barriers_json,review_at,content_checksum,created_by_user_id,created_at)
SELECT
  'pv_' || md5(persona.id || ':1') || substr(md5('persona-version:' || persona.id || ':1'),1,16),
  persona.id,persona.space_id,1,persona.name,persona.summary,persona.lifecycle_state,persona.owner_user_id,persona.source,
  persona.attributes_json,persona.goals_json,persona.behaviours_json,persona.needs_json,persona.barriers_json,
  NULLIF(persona.review_at,'')::TIMESTAMPTZ,
  md5(concat_ws(E'\x1f',persona.name,persona.summary,persona.lifecycle_state,COALESCE(persona.owner_user_id,''),persona.source,
    persona.attributes_json,persona.goals_json,persona.behaviours_json,persona.needs_json,persona.barriers_json,
    COALESCE(persona.review_at,'')))
  || md5(concat_ws(E'\x1e',COALESCE(persona.review_at,''),persona.barriers_json,persona.needs_json,
    persona.behaviours_json,persona.goals_json,persona.attributes_json,persona.source,persona.lifecycle_state,
    persona.summary,persona.name)),
  persona.owner_user_id,persona.created_at::TIMESTAMPTZ
FROM journey_personas persona
ON CONFLICT(persona_id,version_number) DO NOTHING;

WITH versioned AS (
  SELECT persona.*,version.id persona_version_id
  FROM journey_personas persona
  JOIN journey_persona_versions version ON version.persona_id=persona.id AND version.space_id=persona.space_id
    AND version.version_number=1
), claims AS (
  SELECT versioned.persona_version_id,versioned.id persona_id,versioned.space_id,'summary'::TEXT claim_type,
    'Summary'::TEXT label,versioned.summary value,0 ordinal,versioned.created_at
  FROM versioned WHERE versioned.summary<>''
  UNION ALL
  SELECT versioned.persona_version_id,versioned.id,versioned.space_id,'attribute',attribute.key,attribute.value,
    (row_number() OVER (PARTITION BY versioned.id ORDER BY attribute.key)-1)::INTEGER,versioned.created_at
  FROM versioned CROSS JOIN LATERAL jsonb_each_text(versioned.attributes_json::jsonb) attribute
  UNION ALL
  SELECT versioned.persona_version_id,versioned.id,versioned.space_id,'goal','Goal',item.value,(item.ordinality-1)::INTEGER,versioned.created_at
  FROM versioned CROSS JOIN LATERAL jsonb_array_elements_text(versioned.goals_json::jsonb) WITH ORDINALITY item(value,ordinality)
  UNION ALL
  SELECT versioned.persona_version_id,versioned.id,versioned.space_id,'behaviour','Behaviour',item.value,(item.ordinality-1)::INTEGER,versioned.created_at
  FROM versioned CROSS JOIN LATERAL jsonb_array_elements_text(versioned.behaviours_json::jsonb) WITH ORDINALITY item(value,ordinality)
  UNION ALL
  SELECT versioned.persona_version_id,versioned.id,versioned.space_id,'need','Need',item.value,(item.ordinality-1)::INTEGER,versioned.created_at
  FROM versioned CROSS JOIN LATERAL jsonb_array_elements_text(versioned.needs_json::jsonb) WITH ORDINALITY item(value,ordinality)
  UNION ALL
  SELECT versioned.persona_version_id,versioned.id,versioned.space_id,'barrier','Barrier',item.value,(item.ordinality-1)::INTEGER,versioned.created_at
  FROM versioned CROSS JOIN LATERAL jsonb_array_elements_text(versioned.barriers_json::jsonb) WITH ORDINALITY item(value,ordinality)
)
INSERT INTO journey_persona_claims
  (id,persona_version_id,persona_id,space_id,claim_type,label,value,ordinal,claim_checksum,created_at)
SELECT
  'pc_' || md5(concat_ws(':',claims.persona_version_id,claims.claim_type,claims.ordinal::TEXT,claims.label,claims.value))
    || substr(md5(concat_ws(E'\x1f',claims.value,claims.label,claims.claim_type,claims.ordinal::TEXT)),1,16),
  claims.persona_version_id,claims.persona_id,claims.space_id,claims.claim_type,claims.label,claims.value,claims.ordinal,
  md5(concat_ws(E'\x1f',claims.claim_type,claims.label,claims.value,claims.ordinal::TEXT))
    || md5(concat_ws(E'\x1e',claims.ordinal::TEXT,claims.value,claims.label,claims.claim_type)),
  claims.created_at::TIMESTAMPTZ
FROM claims
WHERE claims.value<>''
ON CONFLICT(persona_version_id,claim_type,ordinal) DO NOTHING;

UPDATE journey_personas persona SET current_version_id=version.id
FROM journey_persona_versions version
WHERE version.persona_id=persona.id AND version.space_id=persona.space_id AND version.version_number=1;

-- Historical reads previously resolved definition-wide persona links. Freeze
-- exactly that upgrade-time view for every retained publication/superseded map
-- rather than letting future persona edits rewrite history.
INSERT INTO journey_map_version_personas
  (version_id,definition_id,persona_id,persona_version_id,space_id,ordinal,review_state_at_pin,
   content_checksum_at_pin,evidence_coverage_at_pin,pinned_at)
SELECT map_version.id,map_version.definition_id,link.persona_id,persona.current_version_id,link.space_id,link.ordinal,
  'draft',persona_version.content_checksum,0,clock_timestamp()
FROM journey_map_versions map_version
JOIN journey_definition_personas link ON link.definition_id=map_version.definition_id AND link.space_id=map_version.space_id
JOIN journey_personas persona ON persona.id=link.persona_id AND persona.space_id=link.space_id
JOIN journey_persona_versions persona_version ON persona_version.id=persona.current_version_id
  AND persona_version.persona_id=persona.id AND persona_version.space_id=persona.space_id
WHERE map_version.state IN ('published','superseded')
ON CONFLICT(version_id,persona_id) DO NOTHING;

ALTER TABLE journey_personas
  ADD CONSTRAINT journey_personas_current_version_tenant_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE journey_personas
  ADD CONSTRAINT journey_personas_approved_version_tenant_fk
  FOREIGN KEY(approved_version_id,id,space_id)
  REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT;

-- current_version_id stays physically nullable because the persona root and
-- its first immutable version reference each other. This deferred commit-time
-- invariant is stronger than application-only validation: a direct app-role
-- INSERT/UPDATE cannot commit a NULL, missing, cross-persona, or cross-space
-- current pointer, while one atomic root+version creation transaction works.
CREATE OR REPLACE FUNCTION journey_persona_current_version_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_persona_current_version_guard$
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RAISE EXCEPTION 'journey_personas.current_version_id is required'
      USING ERRCODE='23502';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journey_persona_versions version
    WHERE version.id=NEW.current_version_id AND version.persona_id=NEW.id AND version.space_id=NEW.space_id
  ) THEN
    RAISE EXCEPTION 'journey_personas.current_version_id must reference this persona and space'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_persona_current_version_guard$;

CREATE CONSTRAINT TRIGGER journey_personas_current_version_required
AFTER INSERT OR UPDATE ON journey_personas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION journey_persona_current_version_guard();

CREATE OR REPLACE FUNCTION journey_persona_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_persona_immutable_guard$
BEGIN
  RAISE EXCEPTION 'Versioned journey persona history is immutable' USING ERRCODE='55000';
END
$journey_persona_immutable_guard$;

CREATE TRIGGER journey_persona_versions_immutable
BEFORE UPDATE OR DELETE ON journey_persona_versions
FOR EACH ROW EXECUTE FUNCTION journey_persona_immutable_guard();
CREATE TRIGGER journey_persona_claims_immutable
BEFORE UPDATE OR DELETE ON journey_persona_claims
FOR EACH ROW EXECUTE FUNCTION journey_persona_immutable_guard();
CREATE TRIGGER journey_persona_claim_evidence_immutable
BEFORE UPDATE OR DELETE ON journey_persona_claim_evidence
FOR EACH ROW EXECUTE FUNCTION journey_persona_immutable_guard();
CREATE TRIGGER journey_persona_review_events_immutable
BEFORE UPDATE OR DELETE ON journey_persona_review_events
FOR EACH ROW EXECUTE FUNCTION journey_persona_immutable_guard();
CREATE TRIGGER journey_map_version_personas_immutable
BEFORE UPDATE ON journey_map_version_personas
FOR EACH ROW EXECUTE FUNCTION journey_persona_immutable_guard();
