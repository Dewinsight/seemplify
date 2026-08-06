-- Runtime schema 12: Journey Map 2.0 control-plane tables.
--
-- Additive only. The legacy `journeys` and `journey_versions` tables are left
-- untouched so the read compatibility adapter and the rollback window keep
-- working while structure, personas, and evidence move to stable per-entity
-- identifiers. Every table carries space_id as a typed column so the tenancy
-- predicate is expressible on every query without a join.

CREATE TABLE IF NOT EXISTS journey_personas (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_state IN ('draft','in_review','active','retired')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'workspace' CHECK(source IN ('workspace','legacy_audience_draft','ai_draft')),
  attributes_json TEXT NOT NULL DEFAULT '{}',
  goals_json TEXT NOT NULL DEFAULT '[]',
  behaviours_json TEXT NOT NULL DEFAULT '[]',
  needs_json TEXT NOT NULL DEFAULT '[]',
  barriers_json TEXT NOT NULL DEFAULT '[]',
  review_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_personas_space_name ON journey_personas(space_id,name);
CREATE INDEX IF NOT EXISTS journey_personas_space_state ON journey_personas(space_id,lifecycle_state,updated_at DESC);

CREATE TABLE IF NOT EXISTS journey_definitions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  legacy_journey_id TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  experience_type TEXT NOT NULL DEFAULT 'customer'
    CHECK(experience_type IN ('customer','employee','citizen','patient','partner','custom')),
  map_type TEXT NOT NULL DEFAULT 'current_state'
    CHECK(map_type IN ('current_state','future_state','ideal_state','service_blueprint')),
  mode TEXT NOT NULL DEFAULT 'designed' CHECK(mode IN ('designed','evidence_backed','connected')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_version_id TEXT,
  published_version_id TEXT,
  review_cadence_days INTEGER NOT NULL DEFAULT 0 CHECK(review_cadence_days >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_definitions_legacy
  ON journey_definitions(legacy_journey_id) WHERE legacy_journey_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journey_definitions_space ON journey_definitions(space_id,updated_at DESC,id);

CREATE TABLE IF NOT EXISTS journey_map_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES journey_definitions(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  schema_version INTEGER NOT NULL DEFAULT 2 CHECK(schema_version > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','superseded')),
  map_type TEXT NOT NULL DEFAULT 'current_state'
    CHECK(map_type IN ('current_state','future_state','ideal_state','service_blueprint')),
  mode TEXT NOT NULL DEFAULT 'designed' CHECK(mode IN ('designed','evidence_backed','connected')),
  experience_type TEXT NOT NULL DEFAULT 'customer'
    CHECK(experience_type IN ('customer','employee','citizen','patient','partner','custom')),
  objective TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  legacy_audience TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  source_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_map_versions_definition_number
  ON journey_map_versions(definition_id,version_number);
CREATE INDEX IF NOT EXISTS journey_map_versions_definition
  ON journey_map_versions(definition_id,version_number DESC);

CREATE TABLE IF NOT EXISTS journey_map_stages (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES journey_map_versions(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_map_stages_version_key ON journey_map_stages(version_id,stage_key);
CREATE INDEX IF NOT EXISTS journey_map_stages_order ON journey_map_stages(version_id,ordinal,id);

CREATE TABLE IF NOT EXISTS journey_map_lanes (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES journey_map_versions(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  lane_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_map_lanes_version_lane ON journey_map_lanes(version_id,lane_type,ordinal);
CREATE INDEX IF NOT EXISTS journey_map_lanes_order ON journey_map_lanes(version_id,ordinal,id);

CREATE TABLE IF NOT EXISTS journey_map_cards (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES journey_map_versions(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  lane_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  persona_id TEXT REFERENCES journey_personas(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
  origin TEXT NOT NULL DEFAULT 'workspace' CHECK(origin IN ('legacy_import','workspace','ai_suggestion','template')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journey_map_cards_cell
  ON journey_map_cards(version_id,stage_key,lane_type,ordinal,id);

CREATE TABLE IF NOT EXISTS journey_definition_personas (
  definition_id TEXT NOT NULL REFERENCES journey_definitions(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES journey_personas(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK(ordinal >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (definition_id,persona_id)
);
CREATE INDEX IF NOT EXISTS journey_definition_personas_persona
  ON journey_definition_personas(persona_id,definition_id);

-- Evidence links are references, not copies. The excerpt is the bounded quote
-- needed for explainability and audit; the source of record keeps the content.
CREATE TABLE IF NOT EXISTS journey_evidence_links (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('card','stage','persona','definition')),
  target_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT 'supports' CHECK(assessment IN ('supports','contradicts','neutral')),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  population TEXT NOT NULL DEFAULT '',
  sample_size INTEGER,
  collected_at TEXT,
  window_start TEXT,
  window_end TEXT,
  freshness_days INTEGER,
  invalidated_at TEXT,
  invalidated_reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_evidence_links_unique
  ON journey_evidence_links(space_id,target_type,target_id,source_type,source_ref);
CREATE INDEX IF NOT EXISTS journey_evidence_links_target
  ON journey_evidence_links(space_id,target_type,target_id,created_at,id);

-- A catalogue release adds features and quotas. Stored plan rows predate them,
-- and administrator customisations must survive, so missing keys are merged
-- from the release defaults instead of replacing the stored object.
UPDATE platform_subscription_plans SET
  features_json=(features_json::jsonb || (
    CASE code
      WHEN 'starter' THEN '{"journeyDesign":true,"journeyPersonas":false,"journeyEvidence":false}'::jsonb
      ELSE '{"journeyDesign":true,"journeyPersonas":true,"journeyEvidence":true}'::jsonb
    END - ARRAY(SELECT jsonb_object_keys(features_json::jsonb))
  ))::text,
  limits_json=(limits_json::jsonb || (
    CASE code
      WHEN 'starter' THEN '{"journeyMaps":3,"journeyPersonas":0}'::jsonb
      WHEN 'team' THEN '{"journeyMaps":50,"journeyPersonas":50}'::jsonb
      ELSE '{"journeyMaps":1000,"journeyPersonas":1000}'::jsonb
    END - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');
