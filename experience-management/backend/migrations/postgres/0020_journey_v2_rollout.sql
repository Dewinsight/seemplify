-- Runtime schema 20: Journey Map 2.0 dual-write, shadow-read, and cutover controls.
--
-- Rollout configuration is small, revisioned control-plane state. Divergence
-- rows contain only identifiers, checksums, bounded reason/detail codes, and
-- correlation IDs; legacy or V2 journey content is never copied into them.

DO $journey_rollout_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>19 THEN
    RAISE EXCEPTION 'runtime-20 Journey Map 2.0 rollout controls require the checksummed runtime-19 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_rollout_predecessor$;

CREATE TABLE journey_v2_rollout_platform (
  id TEXT PRIMARY KEY CHECK(id='platform'),
  v2_read_enabled INTEGER NOT NULL CHECK(v2_read_enabled IN (0,1)),
  v2_write_enabled INTEGER NOT NULL CHECK(v2_write_enabled IN (0,1)),
  dual_write_enabled INTEGER NOT NULL CHECK(dual_write_enabled IN (0,1)),
  compare_reads_enabled INTEGER NOT NULL CHECK(compare_reads_enabled IN (0,1)),
  rollout_percentage INTEGER NOT NULL CHECK(rollout_percentage BETWEEN 0 AND 100),
  forced_legacy INTEGER NOT NULL CHECK(forced_legacy IN (0,1)),
  kill_switch_reference TEXT CHECK(kill_switch_reference IS NULL OR length(kill_switch_reference) BETWEEN 3 AND 200),
  kill_switch_review_at TIMESTAMPTZ,
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK(octet_length(reason)<=4000),
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_v2_rollout_platform_kill_switch_shape CHECK(
    forced_legacy=0 OR (kill_switch_reference IS NOT NULL AND kill_switch_review_at IS NOT NULL))
);

INSERT INTO journey_v2_rollout_platform
  (id,v2_read_enabled,v2_write_enabled,dual_write_enabled,compare_reads_enabled,rollout_percentage,
    forced_legacy,kill_switch_reference,kill_switch_review_at,revision,updated_by_user_id,reason,
    effective_at,created_at,updated_at)
VALUES
  ('platform',1,1,0,0,100,0,NULL,NULL,1,NULL,'initial compatibility defaults',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

CREATE TABLE journey_v2_rollout_spaces (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  enrollment TEXT NOT NULL DEFAULT 'inherit' CHECK(enrollment IN ('inherit','included','excluded')),
  v2_read_enabled INTEGER CHECK(v2_read_enabled IS NULL OR v2_read_enabled IN (0,1)),
  v2_write_enabled INTEGER CHECK(v2_write_enabled IS NULL OR v2_write_enabled IN (0,1)),
  dual_write_enabled INTEGER CHECK(dual_write_enabled IS NULL OR dual_write_enabled IN (0,1)),
  compare_reads_enabled INTEGER CHECK(compare_reads_enabled IS NULL OR compare_reads_enabled IN (0,1)),
  rollout_percentage INTEGER CHECK(rollout_percentage IS NULL OR rollout_percentage BETWEEN 0 AND 100),
  forced_legacy INTEGER NOT NULL DEFAULT 0 CHECK(forced_legacy IN (0,1)),
  kill_switch_reference TEXT CHECK(kill_switch_reference IS NULL OR length(kill_switch_reference) BETWEEN 3 AND 200),
  kill_switch_review_at TIMESTAMPTZ,
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK(octet_length(reason) BETWEEN 5 AND 4000),
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_v2_rollout_spaces_kill_switch_shape CHECK(
    forced_legacy=0 OR (kill_switch_reference IS NOT NULL AND kill_switch_review_at IS NOT NULL))
);
CREATE INDEX journey_v2_rollout_spaces_enrollment
  ON journey_v2_rollout_spaces(enrollment,forced_legacy,updated_at DESC,space_id);

CREATE TABLE journey_v2_divergences (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_id TEXT CHECK(journey_id IS NULL OR length(journey_id) BETWEEN 1 AND 128),
  definition_id TEXT CHECK(definition_id IS NULL OR length(definition_id) BETWEEN 1 AND 128),
  operation TEXT NOT NULL CHECK(operation IN ('legacy_to_v2_write','v2_to_legacy_write','shadow_read')),
  served_source TEXT NOT NULL CHECK(served_source IN ('legacy','v2','none')),
  legacy_checksum TEXT CHECK(legacy_checksum IS NULL OR legacy_checksum ~ '^[a-f0-9]{64}$'),
  v2_checksum TEXT CHECK(v2_checksum IS NULL OR v2_checksum ~ '^[a-f0-9]{64}$'),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  detail_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_id TEXT CHECK(request_id IS NULL OR length(request_id) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_v2_divergences_detail_codes_json CHECK(
    jsonb_typeof(detail_codes_json)='array' AND jsonb_array_length(detail_codes_json)<=50
    AND octet_length(detail_codes_json::text)<=8000)
);
CREATE INDEX journey_v2_divergences_space_created
  ON journey_v2_divergences(space_id,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION journey_v2_divergence_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_v2_divergence_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey Map 2.0 divergence records are immutable'
    USING ERRCODE='55000';
END
$journey_v2_divergence_append_only_guard$;

CREATE TRIGGER journey_v2_divergences_append_only_trigger
BEFORE UPDATE OR DELETE ON journey_v2_divergences
FOR EACH ROW EXECUTE FUNCTION journey_v2_divergence_append_only_guard();

-- New built-in control-plane permissions are seeded additively. Custom role
-- assignments remain untouched; administrators grant these capabilities
-- explicitly when they do not use a shipped role.
INSERT INTO platform_rbac_role_permissions(role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_rollout.read',NULL,CURRENT_TIMESTAMP FROM platform_rbac_roles
WHERE id IN ('admin','editor','viewer')
ON CONFLICT(role_id,permission) DO NOTHING;

INSERT INTO platform_rbac_role_permissions(role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_rollout.manage',NULL,CURRENT_TIMESTAMP FROM platform_rbac_roles
WHERE id IN ('admin','editor')
ON CONFLICT(role_id,permission) DO NOTHING;
