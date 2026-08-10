-- Apply after Runtime53. Raw retention is restricted to a dedicated non-human role.
BEGIN;
GRANT CONNECT ON DATABASE __DATABASE__ TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT USAGE ON SCHEMA public TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT SELECT ON experience_schema_version,experience_runtime_schema_version TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT SELECT,INSERT,UPDATE ON journey_event_retention_runs,journey_event_retention_checkpoints TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT SELECT,INSERT ON journey_event_retention_events TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT SELECT ON journey_raw_events,journey_event_processing_inbox,journey_event_ingest_receipts,
  journey_event_processing_receipts,journey_event_dead_letters,journey_event_deduplication,
  journey_stage_rule_decisions,journey_anonymous_stage_visits TO __EVENT_RETENTION_WORKER_ROLE__;
GRANT EXECUTE ON FUNCTION journey_event_retention_purge_raw(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ)
  TO __EVENT_RETENTION_WORKER_ROLE__;
REVOKE ALL ON journey_event_retention_runs,journey_event_retention_checkpoints,journey_event_retention_events FROM __APP_ROLE__;
REVOKE EXECUTE ON FUNCTION journey_event_retention_purge_raw(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ)
  FROM PUBLIC,__APP_ROLE__;
REVOKE UPDATE,DELETE ON journey_event_retention_events FROM __EVENT_RETENTION_WORKER_ROLE__;
REVOKE CREATE ON SCHEMA public FROM __APP_ROLE__,__EVENT_RETENTION_WORKER_ROLE__;
COMMIT;
