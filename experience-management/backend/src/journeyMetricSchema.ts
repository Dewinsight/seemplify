import { db } from './database.js';

/**
 * SQLite parity for PostgreSQL runtime schema 21.  The tables hold control
 * plane configuration, immutable calculated observations and content-free
 * lineage.  Survey answers and arbitrary import payloads remain in their
 * existing sources of record; this schema is not a second raw analytics store.
 */
export function ensureJourneyMetricSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS surveys_tenant_identity ON surveys(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS collectors_survey_identity ON collectors(id,survey_id);
    CREATE UNIQUE INDEX IF NOT EXISTS questions_survey_identity ON questions(id,survey_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_definitions_parent_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_stages_tenant_identity
      ON journey_map_stages(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_cards_tenant_identity
      ON journey_map_cards(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_personas_tenant_identity
      ON journey_personas(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_schema_versions_tenant_identity
      ON journey_event_schema_versions(id,source_id,space_id);

    CREATE TABLE IF NOT EXISTS journey_metric_segments (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
      rule_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rule_json) AND length(rule_json)<=32768),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_metric_segments_journey
      ON journey_metric_segments(space_id,journey_definition_id,state,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_bindings (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('journey','stage','touchpoint','persona','segment')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      stage_id TEXT, touchpoint_id TEXT, persona_id TEXT, segment_id TEXT,
      survey_id TEXT, survey_space_id TEXT,
      collector_id TEXT, collector_survey_id TEXT,
      question_id TEXT, question_survey_id TEXT,
      source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 500),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(stage_id,space_id) REFERENCES journey_map_stages(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(touchpoint_id,space_id) REFERENCES journey_map_cards(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(persona_id,space_id) REFERENCES journey_personas(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(segment_id,space_id) REFERENCES journey_metric_segments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(survey_id,survey_space_id) REFERENCES surveys(id,space_id) ON DELETE SET NULL,
      FOREIGN KEY(collector_id,collector_survey_id) REFERENCES collectors(id,survey_id) ON DELETE SET NULL,
      FOREIGN KEY(question_id,question_survey_id) REFERENCES questions(id,survey_id) ON DELETE SET NULL,
      CHECK((target_type='journey' AND target_id=journey_definition_id AND stage_id IS NULL
          AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='stage' AND stage_id=target_id AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='touchpoint' AND touchpoint_id=target_id AND stage_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='persona' AND persona_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND segment_id IS NULL)
        OR (target_type='segment' AND segment_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND persona_id IS NULL)),
      CHECK((collector_id IS NULL AND collector_survey_id IS NULL)
        OR (collector_id IS NOT NULL AND collector_survey_id=survey_id)),
      CHECK((question_id IS NULL AND question_survey_id IS NULL)
        OR (question_id IS NOT NULL AND question_survey_id=survey_id)),
      CHECK((survey_id IS NULL AND survey_space_id IS NULL)
        OR (survey_id IS NOT NULL AND survey_space_id=space_id))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_metric_bindings_active_source_target
      ON journey_metric_bindings(space_id,journey_definition_id,target_type,target_id,source_ref)
      WHERE state='active';
    CREATE INDEX IF NOT EXISTS journey_metric_bindings_target
      ON journey_metric_bindings(space_id,journey_definition_id,target_type,target_id,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_metric_bindings_survey
      ON journey_metric_bindings(space_id,survey_id,collector_id,question_id,id);

    CREATE TABLE IF NOT EXISTS journey_metric_definitions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('journey','stage','touchpoint','persona','segment')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      stage_id TEXT, touchpoint_id TEXT, persona_id TEXT, segment_id TEXT,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
      current_version_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(journey_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(stage_id,space_id) REFERENCES journey_map_stages(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(touchpoint_id,space_id) REFERENCES journey_map_cards(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(persona_id,space_id) REFERENCES journey_personas(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(segment_id,space_id) REFERENCES journey_metric_segments(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(current_version_id,id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id)
        DEFERRABLE INITIALLY DEFERRED,
      CHECK((target_type='journey' AND target_id=journey_definition_id AND stage_id IS NULL
          AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='stage' AND stage_id=target_id AND touchpoint_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='touchpoint' AND touchpoint_id=target_id AND stage_id IS NULL AND persona_id IS NULL AND segment_id IS NULL)
        OR (target_type='persona' AND persona_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND segment_id IS NULL)
        OR (target_type='segment' AND segment_id=target_id AND stage_id IS NULL AND touchpoint_id IS NULL AND persona_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_definitions_target
      ON journey_metric_definitions(space_id,journey_definition_id,target_type,target_id,state,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_definition_versions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      definition_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK(version_number>0),
      source_kind TEXT NOT NULL CHECK(source_kind IN ('survey','operational_import')),
      binding_id TEXT,
      calculator_kind TEXT NOT NULL CHECK(calculator_kind IN ('nps','csat','ces','operational')),
      aggregation TEXT NOT NULL CHECK(length(aggregation) BETWEEN 1 AND 80),
      direction TEXT NOT NULL CHECK(direction IN ('higher_is_better','lower_is_better','neutral')),
      window_seconds INTEGER NOT NULL CHECK(window_seconds BETWEEN 60 AND 315360000),
      timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80),
      minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size BETWEEN 1 AND 100000000),
      freshness_max_age_seconds INTEGER NOT NULL CHECK(freshness_max_age_seconds BETWEEN 1 AND 315360000),
      baseline_value REAL, target_value REAL,
      population_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(population_json) AND length(population_json)<=32768),
      filters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(filters_json) AND length(filters_json)<=32768),
      formula_json TEXT NOT NULL CHECK(json_valid(formula_json) AND length(formula_json)<=65536),
      configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json) AND length(configuration_json)<=131072),
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,definition_id,space_id), UNIQUE(definition_id,version_number),
      UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(binding_id,space_id) REFERENCES journey_metric_bindings(id,space_id) ON DELETE RESTRICT,
      CHECK((source_kind='survey' AND binding_id IS NOT NULL AND calculator_kind IN ('nps','csat','ces'))
        OR (source_kind='operational_import' AND binding_id IS NULL AND calculator_kind='operational'))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_definition_versions_history
      ON journey_metric_definition_versions(space_id,definition_id,version_number DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_imports (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      definition_id TEXT NOT NULL, definition_version_id TEXT NOT NULL,
      source_id TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
      schema_version_id TEXT NOT NULL,
      external_record_sha256 TEXT NOT NULL CHECK(length(external_record_sha256)=64),
      revision INTEGER NOT NULL CHECK(revision>0),
      operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
      subject_id_hmac TEXT NOT NULL CHECK(length(subject_id_hmac)=64),
      subject_type TEXT NOT NULL CHECK(subject_type IN ('journey_instance','profile','ticket','social_post','custom')),
      event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 128),
      occurred_at TEXT NOT NULL, stage_id TEXT, sentiment TEXT CHECK(sentiment IS NULL OR sentiment IN ('positive','neutral','negative','unknown')),
      invalid_reason TEXT CHECK(invalid_reason IS NULL OR length(invalid_reason)<=500),
      source_lineage_json TEXT NOT NULL CHECK(json_valid(source_lineage_json) AND length(source_lineage_json)<=32768),
      schema_content_sha256 TEXT NOT NULL CHECK(length(schema_content_sha256)=64),
      supersedes_import_id TEXT,
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      UNIQUE(space_id,definition_id,source_id,external_record_sha256,revision),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(definition_version_id,definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(source_id,space_id,environment)
        REFERENCES journey_event_sources(id,space_id,environment) ON DELETE RESTRICT,
      FOREIGN KEY(schema_version_id,source_id,space_id)
        REFERENCES journey_event_schema_versions(id,source_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(supersedes_import_id,space_id) REFERENCES journey_metric_imports(id,space_id) ON DELETE RESTRICT,
      CHECK((operation='upsert' AND invalid_reason IS NULL) OR operation='delete')
    );
    CREATE INDEX IF NOT EXISTS journey_metric_imports_definition
      ON journey_metric_imports(space_id,definition_version_id,occurred_at,id);

    CREATE TABLE IF NOT EXISTS journey_metric_rebuild_runs (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      definition_id TEXT NOT NULL, definition_version_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('manual','source_created','source_corrected','source_deleted','reconcile','scheduled')),
      as_of TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retryable','completed','failed')),
      available_at TEXT NOT NULL,
      lease_owner TEXT, lease_token TEXT, lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
      lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 100),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
      observation_id TEXT, error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(definition_version_id,definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      CHECK((state='leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state<>'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
      CHECK((state IN ('completed','failed'))=(completed_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_rebuild_runs_claim
      ON journey_metric_rebuild_runs(state,available_at,lease_expires_at,space_id,id);
    CREATE INDEX IF NOT EXISTS journey_metric_rebuild_runs_definition
      ON journey_metric_rebuild_runs(space_id,definition_id,created_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_rebuild_attempts (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 100),
      lease_generation INTEGER NOT NULL CHECK(lease_generation>0),
      status TEXT NOT NULL CHECK(status IN ('succeeded','retryable_failed','terminal_failed','lease_expired')),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=100),
      started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      UNIQUE(run_id,attempt_number,status),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_metric_rebuild_runs(id,space_id) ON DELETE CASCADE,
      CHECK((status='succeeded' AND error_code IS NULL) OR (status<>'succeeded' AND error_code IS NOT NULL)),
      CHECK(completed_at>=started_at)
    );
    CREATE INDEX IF NOT EXISTS journey_metric_rebuild_attempts_history
      ON journey_metric_rebuild_attempts(space_id,run_id,attempt_number,id);

    CREATE TABLE IF NOT EXISTS journey_metric_observations (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      definition_id TEXT NOT NULL, definition_version_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), supersedes_observation_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('available','unavailable','retracted')),
      value REAL, unit TEXT NOT NULL CHECK(length(unit) BETWEEN 1 AND 40),
      numerator REAL, denominator INTEGER NOT NULL CHECK(denominator>=0), sample_size INTEGER NOT NULL CHECK(sample_size>=0),
      period_start TEXT NOT NULL, period_end TEXT NOT NULL, timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 80),
      as_of TEXT NOT NULL, calculated_at TEXT NOT NULL,
      freshness_status TEXT NOT NULL CHECK(freshness_status IN ('fresh','stale','unavailable')),
      latest_observed_at TEXT, minimum_sample_warning INTEGER NOT NULL CHECK(minimum_sample_warning IN (0,1)),
      source_count INTEGER NOT NULL CHECK(source_count>=0),
      source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
      result_sha256 TEXT NOT NULL CHECK(length(result_sha256)=64),
      result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=1048576),
      rebuild_run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(definition_id,definition_version_id,period_start,period_end,revision),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(definition_version_id,definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(supersedes_observation_id,space_id) REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(rebuild_run_id,space_id) REFERENCES journey_metric_rebuild_runs(id,space_id) ON DELETE RESTRICT,
      CHECK(period_end>period_start),
      CHECK((status='available') OR (value IS NULL AND numerator IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_metric_observations_query
      ON journey_metric_observations(space_id,definition_id,period_end DESC,revision DESC,id);

    CREATE TABLE IF NOT EXISTS journey_metric_observation_sources (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      observation_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('survey_response','operational_import')),
      source_record_id TEXT NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 128),
      source_revision_sha256 TEXT NOT NULL CHECK(length(source_revision_sha256)=64),
      occurred_at TEXT NOT NULL, included INTEGER NOT NULL CHECK(included IN (0,1)),
      exclusion_code TEXT CHECK(exclusion_code IS NULL OR length(exclusion_code)<=100),
      created_at TEXT NOT NULL,
      UNIQUE(observation_id,source_type,source_record_id),
      FOREIGN KEY(observation_id,space_id) REFERENCES journey_metric_observations(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_metric_observation_sources_lookup
      ON journey_metric_observation_sources(space_id,source_type,source_record_id,observation_id);

    CREATE TABLE IF NOT EXISTS journey_metric_checkpoints (
      definition_version_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      last_observation_id TEXT, source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
      source_record_count INTEGER NOT NULL CHECK(source_record_count>=0),
      reconciled_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      PRIMARY KEY(definition_version_id,space_id),
      FOREIGN KEY(definition_version_id,space_id)
        REFERENCES journey_metric_definition_versions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(last_observation_id,space_id) REFERENCES journey_metric_observations(id,space_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS journey_metric_audit_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('segment.created','segment.updated','binding.created','binding.updated',
        'definition.created','definition.version_created','rebuild.queued','rebuild.completed','rebuild.failed',
        'import.accepted','import.deleted','observation.read')),
      target_type TEXT NOT NULL CHECK(length(target_type) BETWEEN 1 AND 80),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND length(detail_json)<=8192),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_metric_audit_history
      ON journey_metric_audit_events(space_id,created_at DESC,id);

    CREATE TRIGGER IF NOT EXISTS journey_metric_definition_versions_append_only
      BEFORE UPDATE ON journey_metric_definition_versions
      BEGIN SELECT RAISE(ABORT,'Journey metric definition versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_imports_append_only
      BEFORE UPDATE ON journey_metric_imports
      BEGIN SELECT RAISE(ABORT,'Journey metric imports are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_observations_append_only
      BEFORE UPDATE ON journey_metric_observations
      BEGIN SELECT RAISE(ABORT,'Journey metric observations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_observation_sources_append_only
      BEFORE UPDATE ON journey_metric_observation_sources
      BEGIN SELECT RAISE(ABORT,'Journey metric observation lineage is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_rebuild_attempts_append_only
      BEFORE UPDATE ON journey_metric_rebuild_attempts
      BEGIN SELECT RAISE(ABORT,'Journey metric rebuild attempts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_metric_audit_append_only
      BEFORE UPDATE ON journey_metric_audit_events
      BEGIN SELECT RAISE(ABORT,'Journey metric audit is append-only'); END;
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(22, 'journey_metric_observations', new Date().toISOString());
}
