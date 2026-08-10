-- Runtime-43 least-privilege delta. Apply after runtime_privileges.sql and
-- runtime_worker_privileges.sql; this file does not register a runtime version.
BEGIN;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_stage_source_mappings,
  public.journey_stage_survey_policies,public.journey_stage_survey_outbox TO __APP_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_stage_source_mapping_versions,
  public.journey_stage_survey_policy_versions,public.journey_stage_survey_governance_receipts,
  public.journey_stage_survey_source_revisions,public.journey_stage_survey_feed_audit TO __APP_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_stage_survey_outbox_attempts,
  public.journey_stage_intelligence_facts,public.journey_stage_intelligence_audit TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_stage_survey_checkpoints TO __APP_ROLE__;
GRANT DELETE ON TABLE public.journey_stage_survey_outbox_attempts,public.journey_stage_survey_outbox,
  public.journey_stage_survey_source_revisions,public.journey_stage_survey_governance_receipts TO __APP_ROLE__;
GRANT SELECT ON TABLE public.journey_stage_survey_policies,public.journey_stage_survey_policy_versions,
  public.journey_stage_source_mappings,public.journey_stage_source_mapping_versions,
  public.journey_stage_survey_source_revisions TO __WORKER_ROLE__;
GRANT SELECT,UPDATE ON TABLE public.journey_stage_survey_outbox TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_stage_survey_outbox_attempts,public.journey_stage_survey_feed_audit,
  public.journey_stage_intelligence_facts,public.journey_stage_intelligence_audit TO __WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_stage_survey_checkpoints TO __WORKER_ROLE__;
GRANT DELETE ON TABLE public.journey_stage_survey_outbox_attempts,public.journey_stage_survey_outbox,
  public.journey_stage_survey_source_revisions,public.journey_stage_survey_governance_receipts TO __WORKER_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.journey_stage_source_mapping_versions,
  public.journey_stage_survey_policy_versions,public.journey_stage_survey_feed_audit FROM __APP_ROLE__;
REVOKE UPDATE ON TABLE public.journey_stage_survey_governance_receipts,
  public.journey_stage_survey_source_revisions,public.journey_stage_survey_outbox_attempts FROM __APP_ROLE__;
REVOKE DELETE ON TABLE public.journey_stage_source_mappings,public.journey_stage_survey_policies,
  public.journey_stage_survey_checkpoints FROM __APP_ROLE__,__WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_stage_survey_retention_delete_guard() FROM PUBLIC,__APP_ROLE__;
REVOKE CREATE ON SCHEMA public FROM __APP_ROLE__,__WORKER_ROLE__;
COMMIT;
