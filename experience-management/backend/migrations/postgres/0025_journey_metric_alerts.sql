-- Runtime schema 25: deterministic journey metric/evidence alerts.
-- Definitions are versioned; evaluations, decisions, notifications and audit
-- history are content-free and durable. No survey answers, comments or event
-- properties are copied into this projection.

DO $journey_metric_alert_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>24 THEN
    RAISE EXCEPTION 'runtime-25 journey metric alerts require the checksummed runtime-24 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_metric_alert_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alert_journeys_tenant_identity
  ON journey_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alert_metrics_tenant_identity
  ON journey_metric_definitions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alert_metrics_journey_tenant_identity
  ON journey_metric_definitions(id,journey_definition_id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alert_metric_versions_tenant_identity
  ON journey_metric_definition_versions(id,definition_id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alert_observations_tenant_identity
  ON journey_metric_observations(id,space_id);

CREATE TABLE journey_metric_alert_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled','retired')),
  current_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_definitions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_definitions_metric_identity UNIQUE(id,metric_definition_id,space_id),
  CONSTRAINT journey_metric_alert_definitions_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_alert_definitions_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_definitions_metric_tenant_fk
    FOREIGN KEY(metric_definition_id,journey_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,journey_definition_id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_metric_alert_definitions_journey
  ON journey_metric_alert_definitions(space_id,journey_definition_id,state,updated_at DESC,id);

CREATE TABLE journey_metric_alert_definition_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  definition_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  metric_definition_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  rule_kind TEXT NOT NULL CHECK(rule_kind IN ('falling_metric','stale_source','small_sample','contradictory_evidence')),
  direction TEXT NOT NULL CHECK(direction IN ('decrease','increase','any')),
  threshold_value DOUBLE PRECISION NOT NULL CHECK(threshold_value>=0 AND threshold_value<=1000000000),
  window_seconds INTEGER NOT NULL CHECK(window_seconds BETWEEN 60 AND 315360000),
  cooldown_seconds INTEGER NOT NULL CHECK(cooldown_seconds BETWEEN 60 AND 315360000),
  minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 2 AND 100000000),
  stale_after_seconds INTEGER NOT NULL CHECK(stale_after_seconds BETWEEN 60 AND 315360000),
  contradiction_min_ratio DOUBLE PRECISION NOT NULL CHECK(contradiction_min_ratio>=0.01 AND contradiction_min_ratio<=0.5),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_versions_parent_identity UNIQUE(id,definition_id,space_id),
  CONSTRAINT journey_metric_alert_versions_sequence UNIQUE(definition_id,version_number),
  CONSTRAINT journey_metric_alert_versions_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_alert_versions_parent_metric_tenant_fk
    FOREIGN KEY(definition_id,metric_definition_id,space_id)
    REFERENCES journey_metric_alert_definitions(id,metric_definition_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_versions_metric_tenant_fk FOREIGN KEY(metric_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_versions_shape CHECK(
    (rule_kind='falling_metric' AND direction IN ('decrease','increase') AND threshold_value>0)
    OR (rule_kind<>'falling_metric' AND direction='any' AND threshold_value=0))
);
CREATE INDEX journey_metric_alert_versions_history
  ON journey_metric_alert_definition_versions(space_id,definition_id,version_number DESC,id);
ALTER TABLE journey_metric_alert_definitions
  ADD CONSTRAINT journey_metric_alert_definitions_current_version_tenant_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journey_metric_alert_evaluation_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('evaluating','completed','failed')),
  evaluated_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluated_count>=0),
  triggered_count INTEGER NOT NULL DEFAULT 0 CHECK(triggered_count>=0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count>=0),
  resolved_count INTEGER NOT NULL DEFAULT 0 CHECK(resolved_count>=0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
  CONSTRAINT journey_metric_alert_runs_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_runs_idempotency UNIQUE(space_id,idempotency_key),
  CONSTRAINT journey_metric_alert_runs_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_runs_state CHECK(
    (state='evaluating' AND completed_at IS NULL AND error_code IS NULL)
    OR (state='completed' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (state='failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL))
);
CREATE INDEX journey_metric_alert_runs_journey
  ON journey_metric_alert_evaluation_runs(space_id,journey_definition_id,created_at DESC,id);

CREATE TABLE journey_metric_alert_evaluation_results (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  alert_definition_id TEXT NOT NULL, alert_definition_version_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT,
  observation_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('triggered','warning','cleared','insufficient_data')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  severity TEXT NOT NULL CHECK(severity IN ('none','warning','strong')),
  observed_value DOUBLE PRECISION, baseline_value DOUBLE PRECISION, delta_value DOUBLE PRECISION,
  sample_size INTEGER NOT NULL CHECK(sample_size>=0),
  lineage_json JSONB NOT NULL,
  lineage_sha256 TEXT NOT NULL CHECK(lineage_sha256 ~ '^[a-f0-9]{64}$'),
  dedupe_sha256 TEXT NOT NULL CHECK(dedupe_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_results_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_results_run_definition UNIQUE(run_id,alert_definition_id),
  CONSTRAINT journey_metric_alert_results_lineage_json CHECK(
    jsonb_typeof(lineage_json)='object' AND octet_length(lineage_json::text)<=32768),
  CONSTRAINT journey_metric_alert_results_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_metric_alert_evaluation_runs(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_results_definition_tenant_fk FOREIGN KEY(alert_definition_id,space_id)
    REFERENCES journey_metric_alert_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_results_version_tenant_fk
    FOREIGN KEY(alert_definition_version_id,alert_definition_id,space_id)
    REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_alert_results_metric_tenant_fk FOREIGN KEY(metric_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_results_metric_version_tenant_fk
    FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_alert_results_observation_tenant_fk FOREIGN KEY(observation_id,space_id)
    REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_metric_alert_results_run
  ON journey_metric_alert_evaluation_results(space_id,run_id,created_at,id);

CREATE TABLE journey_metric_alerts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL,
  alert_definition_id TEXT NOT NULL, alert_definition_version_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT,
  observation_id TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('warning','strong')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  state TEXT NOT NULL CHECK(state IN ('open','acknowledged','snoozed','resolved')),
  dedupe_sha256 TEXT NOT NULL CHECK(dedupe_sha256 ~ '^[a-f0-9]{64}$'),
  lineage_json JSONB NOT NULL,
  lineage_sha256 TEXT NOT NULL CHECK(lineage_sha256 ~ '^[a-f0-9]{64}$'),
  observed_value DOUBLE PRECISION, baseline_value DOUBLE PRECISION, delta_value DOUBLE PRECISION,
  sample_size INTEGER NOT NULL CHECK(sample_size>=0),
  opened_at TIMESTAMPTZ NOT NULL, last_evaluated_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ, acknowledged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  snoozed_until TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  resolved_reason TEXT CHECK(resolved_reason IS NULL OR length(resolved_reason)<=100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  CONSTRAINT journey_metric_alerts_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alerts_lineage_json CHECK(
    jsonb_typeof(lineage_json)='object' AND octet_length(lineage_json::text)<=32768),
  CONSTRAINT journey_metric_alerts_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alerts_definition_tenant_fk FOREIGN KEY(alert_definition_id,space_id)
    REFERENCES journey_metric_alert_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alerts_version_tenant_fk
    FOREIGN KEY(alert_definition_version_id,alert_definition_id,space_id)
    REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_alerts_metric_tenant_fk FOREIGN KEY(metric_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alerts_metric_version_tenant_fk
    FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_alerts_observation_tenant_fk FOREIGN KEY(observation_id,space_id)
    REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_metric_alerts_state_shape CHECK(
    (state='snoozed' AND snoozed_until IS NOT NULL AND resolved_at IS NULL)
    OR (state='resolved' AND resolved_at IS NOT NULL AND snoozed_until IS NULL)
    OR (state IN ('open','acknowledged') AND snoozed_until IS NULL AND resolved_at IS NULL))
);
CREATE UNIQUE INDEX journey_metric_alerts_active_dedupe
  ON journey_metric_alerts(space_id,alert_definition_id,dedupe_sha256)
  WHERE state IN ('open','acknowledged','snoozed');
CREATE INDEX journey_metric_alerts_journey
  ON journey_metric_alerts(space_id,journey_definition_id,state,updated_at DESC,id);

CREATE TABLE journey_metric_alert_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  alert_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  run_id TEXT, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('opened','refreshed','acknowledged','snoozed','resolved','auto_resolved')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  state_from TEXT CHECK(state_from IS NULL OR state_from IN ('open','acknowledged','snoozed','resolved')),
  state_to TEXT NOT NULL CHECK(state_to IN ('open','acknowledged','snoozed','resolved')),
  detail_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_events_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_events_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=8192),
  CONSTRAINT journey_metric_alert_events_alert_tenant_fk FOREIGN KEY(alert_id,space_id)
    REFERENCES journey_metric_alerts(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_events_run_tenant_fk FOREIGN KEY(run_id,space_id)
    REFERENCES journey_metric_alert_evaluation_runs(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_metric_alert_events_history
  ON journey_metric_alert_events(space_id,alert_id,created_at DESC,id);

CREATE TABLE journey_metric_alert_notification_preferences (
  space_id TEXT NOT NULL, user_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,user_id),
  CONSTRAINT journey_metric_alert_notification_preferences_member_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE
);

CREATE TABLE journey_metric_alert_notifications (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  alert_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, event_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('in_app')),
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('queued','suppressed')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  dedupe_sha256 TEXT NOT NULL CHECK(dedupe_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_notifications_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_notifications_recipient_identity UNIQUE(id,space_id,user_id),
  CONSTRAINT journey_metric_alert_notifications_dedupe UNIQUE(space_id,user_id,dedupe_sha256),
  CONSTRAINT journey_metric_alert_notifications_alert_tenant_fk FOREIGN KEY(alert_id,space_id)
    REFERENCES journey_metric_alerts(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_notifications_event_tenant_fk FOREIGN KEY(event_id,space_id)
    REFERENCES journey_metric_alert_events(id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_metric_alert_notifications_history
  ON journey_metric_alert_notifications(space_id,user_id,created_at DESC,id);

CREATE TABLE journey_metric_alert_notification_states (
  notification_id TEXT NOT NULL, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), read_at TIMESTAMPTZ,
  PRIMARY KEY(notification_id,space_id),
  CONSTRAINT journey_metric_alert_notification_states_notification_fk FOREIGN KEY(notification_id,space_id,user_id)
    REFERENCES journey_metric_alert_notifications(id,space_id,user_id) ON DELETE CASCADE,
  CONSTRAINT journey_metric_alert_notification_states_shape CHECK(
    (state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
);

CREATE TABLE journey_metric_alert_notification_state_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  notification_id TEXT NOT NULL, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
  state_from TEXT NOT NULL CHECK(state_from IN ('unread','read','dismissed')),
  state_to TEXT NOT NULL CHECK(state_to IN ('read','dismissed')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_metric_alert_notification_state_events_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_metric_alert_notification_state_events_notification_fk FOREIGN KEY(notification_id,space_id,user_id)
    REFERENCES journey_metric_alert_notifications(id,space_id,user_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION journey_metric_alert_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_metric_alert_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey metric alert history is append-only' USING ERRCODE='55000';
END
$journey_metric_alert_append_only_guard$;
CREATE TRIGGER journey_metric_alert_versions_append_only
BEFORE UPDATE OR DELETE ON journey_metric_alert_definition_versions
FOR EACH ROW EXECUTE FUNCTION journey_metric_alert_append_only_guard();
CREATE TRIGGER journey_metric_alert_results_append_only
BEFORE UPDATE OR DELETE ON journey_metric_alert_evaluation_results
FOR EACH ROW EXECUTE FUNCTION journey_metric_alert_append_only_guard();
CREATE TRIGGER journey_metric_alert_events_append_only
BEFORE UPDATE OR DELETE ON journey_metric_alert_events
FOR EACH ROW EXECUTE FUNCTION journey_metric_alert_append_only_guard();
CREATE TRIGGER journey_metric_alert_notifications_append_only
BEFORE UPDATE OR DELETE ON journey_metric_alert_notifications
FOR EACH ROW EXECUTE FUNCTION journey_metric_alert_append_only_guard();
CREATE TRIGGER journey_metric_alert_notification_state_events_append_only
BEFORE UPDATE OR DELETE ON journey_metric_alert_notification_state_events
FOR EACH ROW EXECUTE FUNCTION journey_metric_alert_append_only_guard();

-- Preserve administrator customisations; only missing plan keys inherit the
-- bounded resource allowance introduced by this release.
UPDATE platform_subscription_plans SET
  limits_json=(limits_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeyMetricAlertDefinitions":0}'::jsonb
      WHEN 'team' THEN '{"journeyMetricAlertDefinitions":100}'::jsonb
      ELSE '{"journeyMetricAlertDefinitions":10000}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');
