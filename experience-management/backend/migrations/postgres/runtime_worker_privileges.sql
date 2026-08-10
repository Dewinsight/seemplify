-- Dedicated runtime-42 worker role. Apply after runtime_privileges.sql.
-- The worker has no schema ownership, DDL, delete, user-session, or broad application-table authority.
BEGIN;
GRANT CONNECT ON DATABASE __DATABASE__ TO __WORKER_ROLE__;
GRANT USAGE ON SCHEMA public TO __WORKER_ROLE__;
GRANT SELECT ON TABLE public.experience_schema_version,public.experience_runtime_schema_version TO __WORKER_ROLE__;
GRANT SELECT ON TABLE public.spaces,public.journey_orchestration_settings,public.journey_workflow_definitions,
  public.journey_workflow_versions,public.journey_workflow_runs,public.journey_workflow_actions,
  public.journey_workflow_approvals,public.journey_kill_switch_states,
  public.space_memberships,public.surveys,public.responses,public.journey_webhook_destinations TO __WORKER_ROLE__;
GRANT SELECT,UPDATE ON TABLE public.journey_action_queue TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_action_effect_receipts TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_adapter_execution_attempts,public.journey_adapter_effect_receipts,
  public.journey_adapter_internal_notifications TO __WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_webhook_dispatches TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.tickets,public.ticket_events,public.assistant_actions,
  public.assistant_audit_events TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.platform_usage_events TO __WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.platform_usage_buckets TO __WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_worker_service_principals TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_worker_service_key_audit TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_action_live_contexts TO __WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON TABLE public.journey_action_subject_controls,public.journey_action_source_controls,
  public.journey_action_quota_counters,public.journey_action_frequency_counters,
  public.journey_action_worker_reservations TO __WORKER_ROLE__;
GRANT SELECT,INSERT ON TABLE public.journey_action_worker_reservation_events TO __WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_worker_subscription_snapshot(TEXT) TO __WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION public.journey_worker_lock_space(TEXT) TO __WORKER_ROLE__;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM __WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_worker_safety_append_only_guard() FROM __WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_worker_service_principal_lifecycle_guard() FROM __WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_action_worker_reservation_fence_guard() FROM __WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_action_safety_counter_guard() FROM __WORKER_ROLE__;
REVOKE CREATE ON SCHEMA public FROM __WORKER_ROLE__;
COMMIT;
