-- Apply after the aggregate application and Runtime47 privacy-worker grants.
-- Tokens are replaced by the runtime verifier; this file never creates roles.
BEGIN;
GRANT SELECT,INSERT ON TABLE public.journey_actual_path_snapshots,public.journey_actual_path_artifact_revisions
  TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_actual_path_rollups TO __APP_ROLE__;
GRANT SELECT ON TABLE public.journey_actual_path_privacy_invalidations TO __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.journey_actual_path_snapshots,public.journey_actual_path_artifact_revisions FROM __APP_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.journey_actual_path_privacy_invalidations FROM __APP_ROLE__;
REVOKE DELETE ON TABLE public.journey_actual_path_rollups FROM __APP_ROLE__;

GRANT EXECUTE ON FUNCTION public.journey_actual_path_privacy_invalidate(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  TO __PRIVACY_WORKER_ROLE__;
REVOKE ALL ON TABLE public.journey_actual_path_snapshots,public.journey_actual_path_rollups,
  public.journey_actual_path_artifact_revisions,public.journey_actual_path_privacy_invalidations FROM __PRIVACY_WORKER_ROLE__;
COMMIT;
