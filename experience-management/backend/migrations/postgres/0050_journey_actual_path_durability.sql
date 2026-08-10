-- Runtime schema 50: production durable actual-path artifacts and governed privacy invalidation.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>49 THEN
    RAISE EXCEPTION 'runtime-50 journey actual-path durability requires runtime-49' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_actual_path_snapshots (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,journey_map_version_id TEXT NOT NULL,
  subject_scope TEXT NOT NULL CHECK(subject_scope IN ('anonymous_only','known_profiles')),
  period_start TIMESTAMPTZ NOT NULL,period_end TIMESTAMPTZ NOT NULL,as_of TIMESTAMPTZ NOT NULL,
  minimum_cohort_size INTEGER NOT NULL CHECK(minimum_cohort_size>0),
  analytics_version TEXT NOT NULL CHECK(length(analytics_version) BETWEEN 1 AND 100),
  summary_json JSONB NOT NULL CHECK(jsonb_typeof(summary_json)='object' AND octet_length(summary_json::text)<=32768),
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=1048576),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,as_of,
    minimum_cohort_size,analytics_version),
  FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CHECK(period_end>=period_start AND as_of>=period_start)
);
CREATE INDEX journey_actual_path_snapshots_latest
  ON journey_actual_path_snapshots(space_id,journey_definition_id,subject_scope,created_at DESC,id);

CREATE TABLE journey_actual_path_rollups (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,journey_map_version_id TEXT NOT NULL,
  subject_scope TEXT NOT NULL CHECK(subject_scope IN ('anonymous_only','known_profiles')),
  period_start TIMESTAMPTZ NOT NULL,period_end TIMESTAMPTZ NOT NULL,
  minimum_cohort_size INTEGER NOT NULL CHECK(minimum_cohort_size>0),
  analytics_version TEXT NOT NULL CHECK(length(analytics_version) BETWEEN 1 AND 100),
  last_as_of TIMESTAMPTZ NOT NULL,latest_observed_event_at TIMESTAMPTZ,latest_reprojection_completed_at TIMESTAMPTZ,
  summary_json JSONB NOT NULL CHECK(jsonb_typeof(summary_json)='object' AND octet_length(summary_json::text)<=32768),
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=1048576),
  materialized_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,materialized_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),
  UNIQUE(space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,
    minimum_cohort_size,analytics_version),
  FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CHECK(period_end>=period_start AND last_as_of>=period_start)
);
CREATE INDEX journey_actual_path_rollups_latest
  ON journey_actual_path_rollups(space_id,journey_definition_id,subject_scope,materialized_at DESC,id);

-- Content-free, append-only revisions bind every artifact materialisation to
-- its exact version/window, correction checkpoint, source lineage and result.
CREATE TABLE journey_actual_path_artifact_revisions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('snapshot','rollup')),
  artifact_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,journey_map_version_id TEXT NOT NULL,
  subject_scope TEXT NOT NULL CHECK(subject_scope IN ('anonymous_only','known_profiles')),
  period_start TIMESTAMPTZ NOT NULL,period_end TIMESTAMPTZ NOT NULL,as_of TIMESTAMPTZ NOT NULL,
  analytics_version TEXT NOT NULL CHECK(length(analytics_version) BETWEEN 1 AND 100),
  source_lineage_sha256 TEXT NOT NULL CHECK(source_lineage_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  latest_reprojection_run_id TEXT,latest_reprojection_completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(artifact_kind,artifact_id,revision),UNIQUE(id,space_id),
  FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CHECK(period_end>=period_start AND as_of>=period_start),
  CHECK((latest_reprojection_run_id IS NULL)=(latest_reprojection_completed_at IS NULL))
);
CREATE INDEX journey_actual_path_artifact_revisions_latest
  ON journey_actual_path_artifact_revisions(space_id,artifact_kind,artifact_id,revision DESC);

CREATE TABLE journey_actual_path_privacy_invalidations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  journey_definition_id TEXT NOT NULL,source_type TEXT NOT NULL CHECK(source_type IN ('privacy_job','correction_run')),
  source_id_sha256 TEXT NOT NULL CHECK(source_id_sha256 ~ '^[a-f0-9]{64}$'),
  operation TEXT NOT NULL CHECK(operation IN ('suppress','erasure','correction')),
  removed_snapshot_count INTEGER NOT NULL CHECK(removed_snapshot_count>=0),
  removed_rollup_count INTEGER NOT NULL CHECK(removed_rollup_count>=0),invalidated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(space_id,journey_definition_id,source_type,source_id_sha256)
);
CREATE INDEX journey_actual_path_privacy_invalidations_history
  ON journey_actual_path_privacy_invalidations(space_id,journey_definition_id,invalidated_at DESC,id);

CREATE OR REPLACE FUNCTION journey_actual_path_runtime50_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'journey actual-path history is append-only' USING ERRCODE='55000';
END $guard$;
CREATE TRIGGER journey_actual_path_snapshots_update_guard BEFORE UPDATE ON journey_actual_path_snapshots
  FOR EACH ROW EXECUTE FUNCTION journey_actual_path_runtime50_immutable_guard();
CREATE TRIGGER journey_actual_path_artifact_revisions_guard BEFORE UPDATE OR DELETE ON journey_actual_path_artifact_revisions
  FOR EACH ROW EXECUTE FUNCTION journey_actual_path_runtime50_immutable_guard();
CREATE TRIGGER journey_actual_path_privacy_invalidations_guard BEFORE UPDATE OR DELETE ON journey_actual_path_privacy_invalidations
  FOR EACH ROW EXECUTE FUNCTION journey_actual_path_runtime50_immutable_guard();

CREATE OR REPLACE FUNCTION journey_actual_path_privacy_invalidate(
  p_principal_id TEXT,p_source_type TEXT,p_source_id TEXT,p_space_id TEXT,p_journey_definition_id TEXT,p_at TIMESTAMPTZ)
RETURNS TABLE(removed_snapshots INTEGER,removed_rollups INTEGER) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $invalidate$
DECLARE principal journey_privacy_service_principals%ROWTYPE;claim journey_privacy_propagation_claims%ROWTYPE;
  snapshot_count INTEGER;rollup_count INTEGER;
BEGIN
  SELECT * INTO principal FROM public.journey_privacy_service_principals WHERE id=p_principal_id;
  SELECT * INTO claim FROM public.journey_privacy_propagation_claims
    WHERE source_type=p_source_type AND source_id=p_source_id AND space_id=p_space_id AND state='leased' FOR UPDATE;
  IF principal.id IS NULL OR principal.state NOT IN ('active','draining') OR p_at<principal.not_before OR p_at>=principal.expires_at
    OR NOT(principal.allowed_space_ids_json ? p_space_id) OR claim.id IS NULL OR claim.lease_expires_at<=p_at
    OR NOT EXISTS(SELECT 1 FROM public.journey_definitions WHERE id=p_journey_definition_id AND space_id=p_space_id) THEN
    RAISE EXCEPTION 'actual-path privacy authority is invalid' USING ERRCODE='42501'; END IF;
  DELETE FROM public.journey_actual_path_snapshots WHERE space_id=p_space_id AND journey_definition_id=p_journey_definition_id;
  GET DIAGNOSTICS snapshot_count=ROW_COUNT;
  DELETE FROM public.journey_actual_path_rollups WHERE space_id=p_space_id AND journey_definition_id=p_journey_definition_id;
  GET DIAGNOSTICS rollup_count=ROW_COUNT;
  INSERT INTO public.journey_actual_path_privacy_invalidations
    (id,space_id,journey_definition_id,source_type,source_id_sha256,operation,removed_snapshot_count,removed_rollup_count,invalidated_at)
  VALUES(gen_random_uuid()::text,p_space_id,p_journey_definition_id,claim.source_type,encode(digest(p_source_id,'sha256'),'hex'),
    claim.operation,snapshot_count,rollup_count,p_at)
  ON CONFLICT(space_id,journey_definition_id,source_type,source_id_sha256) DO NOTHING;
  RETURN QUERY SELECT snapshot_count,rollup_count;
END $invalidate$;

REVOKE EXECUTE ON FUNCTION journey_actual_path_runtime50_immutable_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_actual_path_privacy_invalidate(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE UPDATE,DELETE ON journey_actual_path_snapshots,journey_actual_path_artifact_revisions,
  journey_actual_path_privacy_invalidations FROM PUBLIC;
REVOKE DELETE ON journey_actual_path_rollups FROM PUBLIC;
