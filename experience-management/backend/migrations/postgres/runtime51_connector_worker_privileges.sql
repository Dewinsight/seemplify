-- Runtime-51 connector worker: data-plane lifecycle only. Principal and source
-- configuration remain owner-operated; no human session role receives access.
BEGIN;
GRANT CONNECT ON DATABASE __DATABASE__ TO __CONNECTOR_WORKER_ROLE__;
GRANT USAGE ON SCHEMA public TO __CONNECTOR_WORKER_ROLE__;
GRANT SELECT ON TABLE public.experience_schema_version,public.experience_runtime_schema_version,
  public.journey_connector_worker_principals,public.journey_connector_worker_sources,
  public.journey_connector_worker_source_items,public.journey_connector_definitions,
  public.journey_connector_import_runs,public.journey_connector_records,
  public.journey_connector_item_receipts,public.platform_subscriptions,public.surveys,public.tickets
TO __CONNECTOR_WORKER_ROLE__;
GRANT UPDATE(phase,snapshot_at,cursor_at,cursor_id,deletion_cursor_id,generation,next_run_at,attempt_count,last_error_code,
  lease_token_sha256,lease_expires_at,lease_run_id,fencing_token,updated_at)
  ON public.journey_connector_worker_sources TO __CONNECTOR_WORKER_ROLE__;
GRANT INSERT,UPDATE ON TABLE public.journey_connector_worker_source_items TO __CONNECTOR_WORKER_ROLE__;
GRANT INSERT ON TABLE public.journey_connector_worker_events,public.journey_connector_import_runs,
  public.journey_connector_records,public.journey_connector_item_receipts TO __CONNECTOR_WORKER_ROLE__;
GRANT UPDATE(state,accepted_count,tombstone_count,attempt_count,last_error_code,retry_at,checkpoint_revision,updated_at)
  ON public.journey_connector_import_runs TO __CONNECTOR_WORKER_ROLE__;
GRANT UPDATE(state,payload_json,payload_sha256,source_occurred_at,last_run_id,updated_at)
  ON public.journey_connector_records TO __CONNECTOR_WORKER_ROLE__;
REVOKE ALL ON TABLE public.journey_connector_worker_key_events FROM __CONNECTOR_WORKER_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.journey_connector_worker_principals FROM __CONNECTOR_WORKER_ROLE__;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM __CONNECTOR_WORKER_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_connector_worker_history_guard() FROM __CONNECTOR_WORKER_ROLE__;
REVOKE CREATE ON SCHEMA public FROM __CONNECTOR_WORKER_ROLE__;
COMMIT;
