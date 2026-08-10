-- Dedicated Runtime47 privacy worker role. The role can authenticate its
-- externally provisioned principal and execute fenced control-plane functions;
-- it has no human-session, DDL, broad application, or direct authority-table writes.
BEGIN;
GRANT CONNECT ON DATABASE __DATABASE__ TO __PRIVACY_WORKER_ROLE__;
GRANT USAGE ON SCHEMA public TO __PRIVACY_WORKER_ROLE__;
GRANT SELECT ON TABLE public.experience_schema_version,public.experience_runtime_schema_version,
  public.spaces,public.journey_privacy_service_principals TO __PRIVACY_WORKER_ROLE__;
GRANT SELECT ON TABLE public.journey_identity_bindings,public.journey_action_queue,public.journey_workflow_runs,
  public.journey_workflow_actions,public.journey_event_intelligence_outbox,public.journey_stage_intelligence_facts,
  public.journey_stage_survey_outbox,public.journey_stage_survey_source_revisions,public.journey_stage_survey_governance_receipts,
  public.journey_anonymous_instances,public.journey_anonymous_stage_visits,public.journey_profile_privacy_jobs,
  public.journey_identity_correction_runs TO __PRIVACY_WORKER_ROLE__;
GRANT UPDATE ON TABLE public.journey_action_subject_controls,public.journey_action_queue,public.journey_webhook_dispatches,
  public.journey_event_intelligence_outbox,public.journey_stage_survey_outbox,public.journey_profile_privacy_jobs,
  public.journey_identity_correction_runs TO __PRIVACY_WORKER_ROLE__;
GRANT INSERT ON TABLE public.journey_event_intelligence_erasure_handles,public.journey_event_intelligence_tombstones,
  public.journey_stage_intelligence_facts,public.journey_stage_reprojection_runs,public.journey_prediction_audit TO __PRIVACY_WORKER_ROLE__;
GRANT DELETE ON TABLE public.journey_profile_export_jobs,public.journey_identity_segment_memberships,public.journey_profile_timeline_events,
  public.journey_identity_sessions TO __PRIVACY_WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_privacy_claim(TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER)
  TO __PRIVACY_WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_privacy_checkpoint(TEXT,TEXT,BIGINT,TEXT,INTEGER,TEXT,JSONB,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
  TO __PRIVACY_WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_privacy_erasure_ready(TEXT,TEXT) TO __PRIVACY_WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_actual_path_privacy_invalidate(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  TO __PRIVACY_WORKER_ROLE__;
REVOKE ALL ON TABLE public.journey_actual_path_snapshots,public.journey_actual_path_rollups,
  public.journey_actual_path_artifact_revisions,public.journey_actual_path_privacy_invalidations FROM __PRIVACY_WORKER_ROLE__;
REVOKE ALL ON TABLE public.journey_privacy_service_key_audit,public.journey_privacy_erasure_authorities,
  public.journey_privacy_propagation_claims,public.journey_privacy_propagation_events FROM __PRIVACY_WORKER_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.journey_privacy_service_principals FROM __PRIVACY_WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_privacy_runtime47_guard() FROM __PRIVACY_WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_privacy_principal_scope_guard() FROM __PRIVACY_WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_privacy_authority_scope_guard() FROM __PRIVACY_WORKER_ROLE__;
REVOKE CREATE ON SCHEMA public FROM __PRIVACY_WORKER_ROLE__;
COMMIT;
