import { db } from './database.js';

/** SQLite parity for PostgreSQL runtime schema 25. Alert configuration is
 * versioned, evaluations are deterministic and durable, and all history is
 * content-free. Customer comments, survey answers and event properties never
 * enter these tables. */
export function ensureJourneyMetricAlertSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS journey_metric_alert_definitions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled','retired')),
      current_version_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,metric_definition_id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_id,journey_definition_id,space_id)
        REFERENCES journey_metric_definitions(id,journey_definition_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(current_version_id,id,space_id)
        REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_definitions_journey
      ON journey_metric_alert_definitions(space_id,journey_definition_id,state,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_definition_versions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      definition_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      metric_definition_id TEXT NOT NULL,
      version_number INTEGER NOT NULL CHECK(version_number>0),
      rule_kind TEXT NOT NULL CHECK(rule_kind IN ('falling_metric','stale_source','small_sample','contradictory_evidence')),
      direction TEXT NOT NULL CHECK(direction IN ('decrease','increase','any')),
      threshold_value REAL NOT NULL CHECK(threshold_value>=0 AND threshold_value<=1000000000),
      window_seconds INTEGER NOT NULL CHECK(window_seconds BETWEEN 60 AND 315360000),
      cooldown_seconds INTEGER NOT NULL CHECK(cooldown_seconds BETWEEN 60 AND 315360000),
      minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 2 AND 100000000),
      stale_after_seconds INTEGER NOT NULL CHECK(stale_after_seconds BETWEEN 60 AND 315360000),
      contradiction_min_ratio REAL NOT NULL CHECK(contradiction_min_ratio>=0.01 AND contradiction_min_ratio<=0.5),
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,definition_id,space_id),
      UNIQUE(definition_id,version_number), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(definition_id,metric_definition_id,space_id)
        REFERENCES journey_metric_alert_definitions(id,metric_definition_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_id,space_id)
        REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      CHECK((rule_kind='falling_metric' AND direction IN ('decrease','increase') AND threshold_value>0)
        OR (rule_kind<>'falling_metric' AND direction='any' AND threshold_value=0))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_versions_history
      ON journey_metric_alert_definition_versions(space_id,definition_id,version_number DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_evaluation_runs (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('evaluating','completed','failed')),
      evaluated_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluated_count>=0),
      triggered_count INTEGER NOT NULL DEFAULT 0 CHECK(triggered_count>=0),
      warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count>=0),
      resolved_count INTEGER NOT NULL DEFAULT 0 CHECK(resolved_count>=0),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      CHECK((state='evaluating' AND completed_at IS NULL AND error_code IS NULL)
        OR (state='completed' AND completed_at IS NOT NULL AND error_code IS NULL)
        OR (state='failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_runs_journey
      ON journey_metric_alert_evaluation_runs(space_id,journey_definition_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_evaluation_results (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      alert_definition_id TEXT NOT NULL, alert_definition_version_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT,
      observation_id TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('triggered','warning','cleared','insufficient_data')),
      reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
      severity TEXT NOT NULL CHECK(severity IN ('none','warning','strong')),
      observed_value REAL, baseline_value REAL, delta_value REAL,
      sample_size INTEGER NOT NULL CHECK(sample_size>=0),
      lineage_json TEXT NOT NULL CHECK(json_valid(lineage_json) AND length(lineage_json)<=32768),
      lineage_sha256 TEXT NOT NULL CHECK(length(lineage_sha256)=64),
      dedupe_sha256 TEXT NOT NULL CHECK(length(dedupe_sha256)=64),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(run_id,alert_definition_id),
      FOREIGN KEY(run_id,space_id)
        REFERENCES journey_metric_alert_evaluation_runs(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(alert_definition_id,space_id)
        REFERENCES journey_metric_alert_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(alert_definition_version_id,alert_definition_id,space_id)
        REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(metric_definition_id,space_id)
        REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(observation_id,space_id)
        REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_results_run
      ON journey_metric_alert_evaluation_results(space_id,run_id,created_at,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alerts (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      alert_definition_id TEXT NOT NULL, alert_definition_version_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT,
      observation_id TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('warning','strong')),
      reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
      state TEXT NOT NULL CHECK(state IN ('open','acknowledged','snoozed','resolved')),
      dedupe_sha256 TEXT NOT NULL CHECK(length(dedupe_sha256)=64),
      lineage_json TEXT NOT NULL CHECK(json_valid(lineage_json) AND length(lineage_json)<=32768),
      lineage_sha256 TEXT NOT NULL CHECK(length(lineage_sha256)=64),
      observed_value REAL, baseline_value REAL, delta_value REAL,
      sample_size INTEGER NOT NULL CHECK(sample_size>=0),
      opened_at TEXT NOT NULL, last_evaluated_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      acknowledged_at TEXT, acknowledged_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      snoozed_until TEXT, resolved_at TEXT, resolved_reason TEXT CHECK(resolved_reason IS NULL OR length(resolved_reason)<=100),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      UNIQUE(id,space_id),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(alert_definition_id,space_id)
        REFERENCES journey_metric_alert_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(alert_definition_version_id,alert_definition_id,space_id)
        REFERENCES journey_metric_alert_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(metric_definition_id,space_id)
        REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(observation_id,space_id)
        REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT,
      CHECK((state='snoozed' AND snoozed_until IS NOT NULL AND resolved_at IS NULL)
        OR (state='resolved' AND resolved_at IS NOT NULL AND snoozed_until IS NULL)
        OR (state IN ('open','acknowledged') AND snoozed_until IS NULL AND resolved_at IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_alerts_active_dedupe
      ON journey_metric_alerts(space_id,alert_definition_id,dedupe_sha256)
      WHERE state IN ('open','acknowledged','snoozed');
    CREATE INDEX IF NOT EXISTS journey_metric_alerts_journey
      ON journey_metric_alerts(space_id,journey_definition_id,state,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      alert_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      run_id TEXT, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('opened','refreshed','acknowledged','snoozed','resolved','auto_resolved')),
      reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
      state_from TEXT CHECK(state_from IS NULL OR state_from IN ('open','acknowledged','snoozed','resolved')),
      state_to TEXT NOT NULL CHECK(state_to IN ('open','acknowledged','snoozed','resolved')),
      detail_json TEXT NOT NULL CHECK(json_valid(detail_json) AND length(detail_json)<=8192),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      FOREIGN KEY(alert_id,space_id) REFERENCES journey_metric_alerts(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id,space_id) REFERENCES journey_metric_alert_evaluation_runs(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_events_history
      ON journey_metric_alert_events(space_id,alert_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_notification_preferences (
      space_id TEXT NOT NULL, user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS journey_metric_alert_notifications (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      alert_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, event_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('in_app')),
      delivery_status TEXT NOT NULL CHECK(delivery_status IN ('queued','suppressed')),
      reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
      dedupe_sha256 TEXT NOT NULL CHECK(length(dedupe_sha256)=64),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,space_id,user_id), UNIQUE(space_id,user_id,dedupe_sha256),
      FOREIGN KEY(alert_id,space_id) REFERENCES journey_metric_alerts(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(event_id,space_id) REFERENCES journey_metric_alert_events(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_metric_alert_notifications_history
      ON journey_metric_alert_notifications(space_id,user_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_alert_notification_states (
      notification_id TEXT NOT NULL, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread','read','dismissed')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), read_at TEXT,
      PRIMARY KEY(notification_id,space_id),
      FOREIGN KEY(notification_id,space_id,user_id)
        REFERENCES journey_metric_alert_notifications(id,space_id,user_id) ON DELETE CASCADE,
      CHECK((state='unread' AND read_at IS NULL) OR (state IN ('read','dismissed') AND read_at IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS journey_metric_alert_notification_state_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      notification_id TEXT NOT NULL, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
      state_from TEXT NOT NULL CHECK(state_from IN ('unread','read','dismissed')),
      state_to TEXT NOT NULL CHECK(state_to IN ('read','dismissed')),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      FOREIGN KEY(notification_id,space_id,user_id)
        REFERENCES journey_metric_alert_notifications(id,space_id,user_id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_versions_append_only
      BEFORE UPDATE ON journey_metric_alert_definition_versions
      BEGIN SELECT RAISE(ABORT,'Journey metric alert definition versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_versions_no_delete
      BEFORE DELETE ON journey_metric_alert_definition_versions
      BEGIN SELECT RAISE(ABORT,'Journey metric alert definition versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_results_append_only
      BEFORE UPDATE ON journey_metric_alert_evaluation_results
      BEGIN SELECT RAISE(ABORT,'Journey metric alert evaluation results are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_results_no_delete
      BEFORE DELETE ON journey_metric_alert_evaluation_results
      BEGIN SELECT RAISE(ABORT,'Journey metric alert evaluation results are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_events_append_only
      BEFORE UPDATE ON journey_metric_alert_events
      BEGIN SELECT RAISE(ABORT,'Journey metric alert events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_events_no_delete
      BEFORE DELETE ON journey_metric_alert_events
      BEGIN SELECT RAISE(ABORT,'Journey metric alert events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_notifications_append_only
      BEFORE UPDATE ON journey_metric_alert_notifications
      BEGIN SELECT RAISE(ABORT,'Journey metric alert notifications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_notifications_no_delete
      BEFORE DELETE ON journey_metric_alert_notifications
      BEGIN SELECT RAISE(ABORT,'Journey metric alert notifications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_notification_state_events_append_only
      BEFORE UPDATE ON journey_metric_alert_notification_state_events
      BEGIN SELECT RAISE(ABORT,'Journey metric alert notification state events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_alert_notification_state_events_no_delete
      BEFORE DELETE ON journey_metric_alert_notification_state_events
      BEGIN SELECT RAISE(ABORT,'Journey metric alert notification state events are append-only'); END;
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(25, 'journey_metric_alerts', new Date().toISOString());
}
