const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const BASE_RUNTIME_EXTENSION_TABLES = Object.freeze([
  'experience_runtime_schema_version',
  'platform_role_assignments',
  'platform_subscription_requests',
  'platform_subscriptions',
  'platform_subscription_events',
  'platform_audit_events',
  'ticket_events',
  'knowledge_embedding_profiles',
  'knowledge_base_embedding_profiles',
  'knowledge_document_embeddings',
  'knowledge_backfill_runs',
  'knowledge_backfill_run_bases',
  'knowledge_backfill_items',
  'knowledge_embedding_promotion_approvals',
  'assistant_nylas_connections',
  'assistant_nylas_oauth_states',
  'assistant_runs',
  'assistant_actions',
  'assistant_reminders',
  'assistant_audit_events'
]);

export const LATEST_RUNTIME_SCHEMA_VERSION = 55;

export function runtimeExtensionTables(runtimeVersion = LATEST_RUNTIME_SCHEMA_VERSION) {
  const tables = [...BASE_RUNTIME_EXTENSION_TABLES];
  if (runtimeVersion >= 6) tables.push('social_intelligence_publications');
  if (runtimeVersion >= 7) tables.push('assistant_outbound_messages');
  if (runtimeVersion >= 8) tables.push('platform_rbac_roles', 'platform_rbac_role_permissions', 'platform_rbac_user_roles');
  if (runtimeVersion >= 9) tables.push('platform_subscription_plans');
  if (runtimeVersion >= 10) tables.push('deep_analysis_runs', 'deep_analysis_partitions', 'deep_analysis_evidence');
  if (runtimeVersion >= 12) {
    tables.push('journey_personas', 'journey_definitions', 'journey_map_versions', 'journey_map_stages',
      'journey_map_lanes', 'journey_map_cards', 'journey_definition_personas', 'journey_evidence_links');
  }
  if (runtimeVersion >= 13) {
    tables.push('journey_templates', 'journey_template_versions', 'journey_template_instantiations',
      'journey_template_audit_events');
  }
  if (runtimeVersion >= 14) tables.push('journey_evidence_audit_events');
  if (runtimeVersion >= 15) tables.push('platform_usage_events', 'platform_usage_buckets');
  if (runtimeVersion >= 16) {
    tables.push('journey_event_sources', 'journey_event_credentials', 'journey_event_schemas',
      'journey_event_schema_versions', 'journey_event_control_audit_events');
  }
  if (runtimeVersion >= 17) {
    tables.push(
      'journey_event_deduplication','journey_raw_events','journey_raw_events_2026_08',
      'journey_raw_events_default','journey_event_ingest_receipts',
      'journey_event_ingest_receipts_2026_08','journey_event_ingest_receipts_default',
      'journey_event_rejections','journey_event_rate_buckets','journey_event_processing_inbox',
      'journey_event_processing_receipts','journey_event_processing_receipts_2026_08',
      'journey_event_processing_receipts_default','journey_event_dead_letters','journey_event_data_audit'
    );
  }
  if (runtimeVersion >= 18) {
    tables.push('journey_stage_rule_definitions','journey_stage_rule_versions','journey_stage_rule_decisions',
      'journey_anonymous_instances','journey_anonymous_stage_visits','journey_stage_rule_audit_events');
  }
  if (runtimeVersion >= 19) {
    tables.push('journey_research_sources','journey_research_snapshots','journey_research_links',
      'journey_research_assessments','journey_research_gaps','journey_research_intakes',
      'journey_research_monitors','journey_research_refresh_runs','journey_research_refresh_attempts',
      'journey_research_notifications','journey_research_audit_events');
  }
  if (runtimeVersion >= 20) {
    tables.push('journey_v2_rollout_platform','journey_v2_rollout_spaces','journey_v2_divergences');
  }
  if (runtimeVersion >= 21) {
    tables.push('journey_metric_segments','journey_metric_bindings','journey_metric_definitions',
      'journey_metric_definition_versions','journey_metric_imports','journey_metric_rebuild_runs',
      'journey_metric_rebuild_attempts','journey_metric_observations','journey_metric_observation_sources',
      'journey_metric_checkpoints','journey_metric_audit_events');
  }
  if (runtimeVersion >= 22) {
    tables.push('journey_ai_suggestion_runs','journey_ai_suggestion_evidence','journey_ai_suggestion_changes',
      'journey_ai_suggestion_decisions','journey_ai_suggestion_audit_events','journey_ai_suggestion_purge_receipts');
  }
  if (runtimeVersion >= 23) {
    tables.push('journey_persona_versions','journey_persona_claims','journey_persona_claim_evidence',
      'journey_persona_review_events','journey_map_version_personas');
  }
  if (runtimeVersion >= 24) {
    tables.push('journey_channels','journey_channel_versions','journey_touchpoints','journey_touchpoint_versions',
      'journey_card_details','journey_card_touchpoints','journey_card_assets',
      'journey_asset_blob_purge_outbox','journey_rich_card_audit_events');
  }
  if (runtimeVersion >= 25) {
    tables.push('journey_metric_alert_definitions','journey_metric_alert_definition_versions',
      'journey_metric_alert_evaluation_runs','journey_metric_alert_evaluation_results','journey_metric_alerts',
      'journey_metric_alert_events','journey_metric_alert_notification_preferences',
      'journey_metric_alert_notifications','journey_metric_alert_notification_states',
      'journey_metric_alert_notification_state_events');
  }
  if (runtimeVersion >= 26) {
    tables.push('journey_saved_view_settings','journey_saved_views','journey_saved_view_references',
      'journey_saved_view_selections','journey_saved_view_operations','journey_saved_view_audit_events');
  }
  if (runtimeVersion >= 27) {
    tables.push('journey_portfolio_settings','journey_portfolio_items','journey_portfolio_item_versions',
      'journey_portfolio_item_evidence','journey_portfolio_item_tags','journey_initiative_metric_targets',
      'journey_portfolio_relationships','journey_portfolio_journey_links','journey_initiative_dependencies',
      'journey_portfolio_scoring_policies','journey_portfolio_scoring_policy_versions',
      'journey_portfolio_priority_assessments','journey_initiative_baselines',
      'journey_initiative_outcome_comparisons','journey_portfolio_reviews',
      'journey_portfolio_operational_links','journey_portfolio_operations','journey_portfolio_activity');
  }
  if (runtimeVersion >= 28) {
    tables.push('journey_collaboration_settings','journey_collaboration_role_assignments',
      'journey_collaboration_role_events','journey_comments','journey_comment_versions',
      'journey_comment_mentions','journey_collaboration_watchers','journey_governance_reviews',
      'journey_governance_review_events','journey_governance_publications',
      'journey_collaboration_notifications','journey_collaboration_notification_states',
      'journey_collaboration_notification_state_events','journey_collaboration_views',
      'journey_read_only_shares','journey_share_access_events','journey_share_rate_buckets',
      'journey_collaboration_operations','journey_collaboration_activity','journey_collaboration_audit_events');
  }
  if (runtimeVersion >= 29) {
    tables.push('journey_hierarchy_settings','journey_taxonomy_terms','journey_definition_taxonomy',
      'journey_hierarchy_links','journey_hierarchy_health_policies','journey_hierarchy_health_snapshots',
      'journey_blueprint_resources','journey_blueprints','journey_blueprint_versions',
      'journey_blueprint_stages','journey_blueprint_elements','journey_blueprint_element_resources',
      'journey_blueprint_relationships','journey_blueprint_portfolio_links',
      'journey_blueprint_gap_assessments','journey_blueprint_comparisons','journey_hierarchy_operations',
      'journey_hierarchy_activity');
  }
  if (runtimeVersion >= 30) {
    tables.push('journey_stage_reprojection_runs','journey_stage_reprojection_attempts',
      'journey_stage_reprojection_checkpoints','journey_stage_reprojection_audit_events');
  }
  if (runtimeVersion >= 31) {
    tables.push('journey_identity_profiles','journey_identity_bindings','journey_identity_merges',
      'journey_identity_memberships','journey_identity_groups','journey_identity_source_facts',
      'journey_identity_audit_facts','journey_identity_profile_tombstones',
      'journey_identity_identifier_tombstones','journey_identity_processed_commands',
      'journey_profile_timeline_events','journey_identity_sessions','journey_identity_segments',
      'journey_identity_segment_versions','journey_identity_segment_memberships',
      'journey_profile_privacy_states','journey_profile_export_jobs','journey_profile_privacy_jobs',
      'journey_identity_correction_runs');
  }
  if (runtimeVersion >= 33) {
    tables.push('journey_path_intelligence_runs','journey_stage_inference_recommendations',
      'journey_path_intelligence_audit');
  }
  if (runtimeVersion >= 35) {
    tables.push('journey_orchestration_settings','journey_workflow_definitions','journey_workflow_versions',
      'journey_workflow_runs','journey_workflow_actions','journey_workflow_approvals','journey_workflow_outbox',
      'journey_workflow_audit');
  }
  if (runtimeVersion >= 36) {
    tables.push('journey_action_queue','journey_action_gate_resolutions','journey_action_attempts',
      'journey_action_effect_receipts');
  }
  if (runtimeVersion >= 37) {
    tables.push('journey_connector_definitions','journey_connector_import_runs','journey_connector_records',
      'journey_connector_item_receipts','journey_connector_idempotency','journey_connector_audit');
  }
  if (runtimeVersion >= 38) {
    tables.push('journey_webhook_destinations','journey_adapter_execution_attempts','journey_adapter_effect_receipts',
      'journey_adapter_internal_notifications','journey_webhook_dispatches');
  }
  if (runtimeVersion >= 39) {
    tables.push('journey_prediction_policies','journey_predictive_models','journey_predictive_model_versions',
      'journey_prediction_drift_evaluations','journey_prediction_runs','journey_prediction_audit');
  }
  if (runtimeVersion >= 40) {
    tables.push('journey_kill_switch_states','journey_kill_switch_mutations','journey_kill_switch_pauses',
      'journey_kill_switch_resumptions','journey_kill_switch_audit');
  }
  if (runtimeVersion >= 41) {
    tables.push('journey_stage_intelligence_policies','journey_stage_intelligence_policy_history',
      'journey_stage_intelligence_facts','journey_stage_intelligence_audit');
  }
  if (runtimeVersion >= 42) {
    tables.push('journey_worker_service_principals','journey_worker_service_key_audit','journey_action_live_contexts',
      'journey_action_subject_controls','journey_action_source_controls','journey_action_quota_counters',
      'journey_action_frequency_counters','journey_action_worker_reservations','journey_action_worker_reservation_events');
  }
  if (runtimeVersion >= 43) {
    tables.push('journey_stage_source_mappings','journey_stage_source_mapping_versions',
      'journey_stage_survey_policies','journey_stage_survey_policy_versions',
      'journey_stage_survey_governance_receipts','journey_stage_survey_source_revisions',
      'journey_stage_survey_outbox','journey_stage_survey_outbox_attempts',
      'journey_stage_survey_checkpoints','journey_stage_survey_feed_audit');
  }
  if (runtimeVersion >= 45) {
    tables.push('journey_event_intelligence_mappings','journey_event_intelligence_mapping_versions',
      'journey_event_intelligence_erasure_handles','journey_event_intelligence_outbox',
      'journey_event_intelligence_materialization_state','journey_event_intelligence_tombstones');
  }
  if (runtimeVersion >= 46) {
    tables.push('journey_portfolio_view_definitions','journey_portfolio_view_versions',
      'journey_portfolio_view_preferences','journey_portfolio_transition_requests',
      'journey_portfolio_transition_events');
  }
  if (runtimeVersion >= 47) {
    tables.push('journey_privacy_service_principals','journey_privacy_service_key_audit',
      'journey_privacy_erasure_authorities','journey_privacy_propagation_claims','journey_privacy_propagation_events');
  }
  if (runtimeVersion >= 48) {
    tables.push('journey_blueprint_measurement_plans','journey_blueprint_measurement_outcomes',
      'journey_blueprint_measurement_audit');
  }
  if (runtimeVersion >= 49) {
    tables.push('journey_export_brand_assets','journey_export_brand_profiles','journey_export_brand_profile_versions',
      'journey_export_brand_settings','journey_saved_view_brand_bindings','journey_export_brand_operations',
      'journey_export_brand_audit_events','journey_export_brand_asset_purge_queue');
  }
  if (runtimeVersion >= 50) {
    tables.push('journey_actual_path_snapshots','journey_actual_path_rollups',
      'journey_actual_path_artifact_revisions','journey_actual_path_privacy_invalidations');
  }
  if (runtimeVersion >= 51) {
    tables.push('journey_connector_worker_principals','journey_connector_worker_key_events',
      'journey_connector_worker_sources','journey_connector_worker_source_items','journey_connector_worker_events');
  }
  if (runtimeVersion >= 52) {
    tables.push('journey_operational_stage_mappings','journey_operational_stage_mapping_versions',
      'journey_operational_stage_source_revisions','journey_operational_stage_outbox',
      'journey_operational_stage_outbox_attempts','journey_operational_stage_checkpoints',
      'journey_operational_stage_tombstones','journey_operational_timeline_revisions',
      'journey_operational_stage_feed_audit');
  }
  if (runtimeVersion >= 53) {
    tables.push('journey_event_retention_runs','journey_event_retention_checkpoints','journey_event_retention_events');
  }
  if (runtimeVersion >= 54) {
    tables.push('journey_evidence_monitor_states','journey_evidence_monitor_events');
  }
  if (runtimeVersion >= 55) {
    tables.push('journey_workspace_view_definitions','journey_workspace_view_versions',
      'journey_workspace_view_preferences','journey_workspace_view_operations',
      'journey_workspace_view_audit_events');
  }
  return tables;
}

export const RUNTIME_EXTENSION_TABLES = Object.freeze(runtimeExtensionTables(LATEST_RUNTIME_SCHEMA_VERSION));

export function runtimeTableSetDifference(sourceTableNames, actualTableNames,
  runtimeVersion = LATEST_RUNTIME_SCHEMA_VERSION) {
  const expectedTables = new Set([...sourceTableNames, ...runtimeExtensionTables(runtimeVersion)]);
  return {
    unknownTables: actualTableNames.filter((name) => !expectedTables.has(name)),
    missingTables: [...expectedTables].filter((name) => !actualTableNames.includes(name))
  };
}

const exactColumns = Object.freeze({
  experience_runtime_schema_version: [
    ['version', 'integer', false], ['name', 'text', false], ['checksum', 'text', false], ['applied_at', 'text', false]
  ],
  platform_role_assignments: [
    ['id', 'text', false], ['user_id', 'text', false], ['role', 'text', false], ['granted_by_user_id', 'text', true],
    ['granted_at', 'text', false], ['revoked_by_user_id', 'text', true], ['revoked_at', 'text', true], ['reason', 'text', true]
  ],
  platform_subscription_requests: [
    ['id', 'text', false], ['space_id', 'text', false], ['request_type', 'text', false], ['requested_plan_code', 'text', true],
    ['request_note', 'text', false], ['plan_snapshot_json', 'text', false], ['status', 'text', false],
    ['requested_by_user_id', 'text', false], ['reviewed_by_user_id', 'text', true], ['review_note', 'text', true],
    ['decision_at', 'text', true], ['version', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  platform_subscriptions: [
    ['id', 'text', false], ['space_id', 'text', false], ['plan_code', 'text', false], ['status', 'text', false],
    ['features_json', 'text', false], ['limits_json', 'text', false], ['source_request_id', 'text', true],
    ['approved_by_user_id', 'text', true], ['effective_at', 'text', false], ['expires_at', 'text', true],
    ['version', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  platform_subscription_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['subscription_id', 'text', true], ['request_id', 'text', true],
    ['event_type', 'text', false], ['actor_user_id', 'text', true], ['metadata_json', 'text', false], ['created_at', 'text', false]
  ],
  platform_audit_events: [
    ['id', 'text', false], ['actor_user_id', 'text', true], ['actor_role', 'text', true], ['action', 'text', false],
    ['target_type', 'text', false], ['target_id', 'text', false], ['space_id', 'text', true], ['reason', 'text', true],
    ['before_json', 'text', true], ['after_json', 'text', true], ['request_id', 'text', true], ['ip_address', 'text', true],
    ['user_agent', 'text', true], ['created_at', 'text', false]
  ],
  ticket_events: [
    ['id', 'text', false], ['ticket_id', 'text', false], ['actor_user_id', 'text', true], ['event_type', 'text', false],
    ['detail_json', 'text', false], ['created_at', 'text', false]
  ]
});

const assistantExactColumns = Object.freeze({
  assistant_nylas_connections: [
    ['id', 'text', false], ['space_id', 'text', false], ['user_id', 'text', false], ['provider', 'text', false],
    ['grant_id_enc', 'text', false], ['grant_fingerprint', 'text', false], ['email', 'text', false],
    ['scopes_json', 'text', false], ['status', 'text', false], ['created_at', 'text', false],
    ['updated_at', 'text', false], ['revoked_at', 'text', true]
  ],
  assistant_nylas_oauth_states: [
    ['state_hash', 'text', false], ['space_id', 'text', false], ['user_id', 'text', false],
    ['provider', 'text', false], ['expires_at', 'text', false], ['consumed_at', 'text', true],
    ['created_at', 'text', false]
  ],
  assistant_runs: [
    ['id', 'text', false], ['space_id', 'text', false], ['requested_by', 'text', false], ['ai_job_id', 'text', true],
    ['kind', 'text', false], ['connection_id', 'text', true], ['subject_ref', 'text', true],
    ['source_refs_json', 'text', false], ['input_snapshot_json', 'text', false], ['input_sha256', 'text', false],
    ['request_fingerprint', 'text', false], ['state', 'text', false], ['output_json', 'text', true],
    ['runtime_json', 'text', true], ['generated_subject', 'text', true], ['generated_body', 'text', true],
    ['draft_subject', 'text', true], ['draft_body', 'text', true], ['draft_revision', 'integer', false],
    ['draft_updated_at', 'text', true], ['error', 'text', true], ['advisory_only', 'integer', false],
    ['external_dispatched', 'integer', false], ['idempotency_key', 'text', true], ['created_at', 'text', false],
    ['started_at', 'text', true], ['completed_at', 'text', true], ['updated_at', 'text', false]
  ]
});

const assistantPhase1ExactColumns = Object.freeze({
  assistant_runs: [
    ...assistantExactColumns.assistant_runs,
    ['document_type', 'text', true], ['title', 'text', true], ['knowledge_base_ids_json', 'text', false]
  ],
  assistant_actions: [
    ['id', 'text', false], ['space_id', 'text', false], ['created_by', 'text', false],
    ['source_run_id', 'text', true], ['source_item_index', 'integer', true], ['title', 'text', false],
    ['description', 'text', false], ['owner', 'text', false], ['status', 'text', false],
    ['priority', 'text', false], ['due_at', 'text', true], ['revision', 'integer', false],
    ['completed_at', 'text', true], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  assistant_reminders: [
    ['id', 'text', false], ['space_id', 'text', false], ['action_id', 'text', false],
    ['created_by', 'text', false], ['remind_at', 'text', false], ['note', 'text', false],
    ['state', 'text', false], ['revision', 'integer', false], ['delivered_at', 'text', true],
    ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  assistant_audit_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['actor_user_id', 'text', false],
    ['action', 'text', false], ['target_type', 'text', false], ['target_id', 'text', true],
    ['detail_json', 'text', false], ['created_at', 'text', false]
  ]
});

const reviewedIntelligenceExactColumns = Object.freeze({
  social_intelligence_publications: [
    ['report_id', 'text', false], ['space_id', 'text', false], ['knowledge_base_id', 'text', false],
    ['document_id', 'text', false], ['job_id', 'text', true], ['source_requested_by', 'text', false], ['published_by', 'text', true],
    ['review_status', 'text', false], ['source_snapshot_sha256', 'text', false],
    ['artifact_sha256', 'text', false], ['created_at', 'text', false]
  ]
});

const reviewedReplyExactColumns = Object.freeze({
  assistant_outbound_messages: [
    ['id', 'text', false], ['run_id', 'text', false], ['space_id', 'text', false], ['user_id', 'text', false],
    ['connection_id', 'text', false], ['thread_id', 'text', false], ['mode', 'text', false], ['status', 'text', false],
    ['provider_idempotency_key', 'text', false], ['provider_reply_to_message_id', 'text', false],
    ['provider_message_id', 'text', true], ['recipients_json', 'text', false],
    ['subject_sha256', 'text', false], ['body_sha256', 'text', false], ['error_code', 'text', true],
    ['created_at', 'text', false], ['sent_at', 'text', true], ['updated_at', 'text', false]
  ]
});

const adminControlExactColumns = Object.freeze({
  platform_rbac_roles: [
    ['id', 'text', false], ['name', 'text', false], ['description', 'text', false], ['built_in', 'integer', false],
    ['version', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  platform_rbac_role_permissions: [
    ['role_id', 'text', false], ['permission', 'text', false], ['granted_by_user_id', 'text', true],
    ['granted_at', 'text', false]
  ],
  platform_rbac_user_roles: [
    ['id', 'text', false], ['user_id', 'text', false], ['role_id', 'text', false],
    ['assigned_by_user_id', 'text', true], ['assigned_at', 'text', false], ['revoked_by_user_id', 'text', true],
    ['revoked_at', 'text', true], ['reason', 'text', true], ['revocation_reason', 'text', true]
  ]
});

const managedPlanExactColumns = Object.freeze({
  platform_subscription_plans: [
    ['code', 'text', false], ['name', 'text', false], ['description', 'text', false],
    ['requestable', 'integer', false], ['features_json', 'text', false], ['limits_json', 'text', false],
    ['display_order', 'integer', false], ['version', 'integer', false], ['created_at', 'text', false],
    ['updated_at', 'text', false]
  ]
});

const deepAnalysisExactColumns = Object.freeze({
  deep_analysis_runs: [
    ['id', 'text', false], ['space_id', 'text', false], ['user_id', 'text', false], ['title', 'text', false],
    ['objective', 'text', false], ['mode', 'text', false], ['state', 'text', false], ['stage', 'text', false],
    ['progress', 'integer', false], ['source_refs_json', 'text', false], ['knowledge_refs_json', 'text', false],
    ['corpus_manifest_json', 'text', false], ['estimate_json', 'text', false], ['result_json', 'text', true],
    ['runtime_json', 'text', true], ['error', 'text', true], ['idempotency_key', 'text', true],
    ['total_partitions', 'integer', false], ['completed_partitions', 'integer', false], ['failed_partitions', 'integer', false],
    ['created_at', 'text', false], ['started_at', 'text', true], ['completed_at', 'text', true], ['updated_at', 'text', false]
  ],
  deep_analysis_partitions: [
    ['id', 'text', false], ['run_id', 'text', false], ['space_id', 'text', false], ['ordinal', 'integer', false],
    ['level', 'integer', false], ['kind', 'text', false], ['state', 'text', false], ['ai_job_id', 'text', true],
    ['source_json', 'text', false], ['input_json', 'text', false], ['output_json', 'text', true], ['runtime_json', 'text', true],
    ['token_estimate', 'integer', false], ['error', 'text', true], ['created_at', 'text', false], ['started_at', 'text', true],
    ['completed_at', 'text', true], ['updated_at', 'text', false]
  ],
  deep_analysis_evidence: [
    ['id', 'text', false], ['run_id', 'text', false], ['partition_id', 'text', false], ['space_id', 'text', false],
    ['kind', 'text', false], ['statement', 'text', false], ['confidence', 'double precision', false],
    ['citations_json', 'text', false], ['metadata_json', 'text', false], ['created_at', 'text', false]
  ]
});

const additiveColumns = Object.freeze({
  users: [
    ['account_status', 'text', false], ['last_login_at', 'text', true], ['suspended_at', 'text', true],
    ['suspended_by_user_id', 'text', true], ['suspension_reason', 'text', true]
  ],
  spaces: [
    ['status', 'text', false], ['suspended_at', 'text', true], ['suspended_by_user_id', 'text', true],
    ['suspension_reason', 'text', true]
  ]
});

const primaryKeys = Object.freeze({
  experience_runtime_schema_version: ['version'],
  platform_role_assignments: ['id'],
  platform_subscription_requests: ['id'],
  platform_subscriptions: ['id'],
  platform_subscription_events: ['id'],
  platform_audit_events: ['id'],
  ticket_events: ['id']
});

const assistantPrimaryKeys = Object.freeze({
  assistant_nylas_connections: ['id'],
  assistant_nylas_oauth_states: ['state_hash'],
  assistant_runs: ['id']
});

const assistantPhase1PrimaryKeys = Object.freeze({
  assistant_actions: ['id'],
  assistant_reminders: ['id'],
  assistant_audit_events: ['id']
});

const reviewedIntelligencePrimaryKeys = Object.freeze({
  social_intelligence_publications: ['report_id', 'knowledge_base_id']
});

const reviewedReplyPrimaryKeys = Object.freeze({ assistant_outbound_messages: ['id'] });

const adminControlPrimaryKeys = Object.freeze({
  platform_rbac_roles: ['id'],
  platform_rbac_role_permissions: ['role_id', 'permission'],
  platform_rbac_user_roles: ['id']
});

const managedPlanPrimaryKeys = Object.freeze({ platform_subscription_plans: ['code'] });
const deepAnalysisPrimaryKeys = Object.freeze({
  deep_analysis_runs: ['id'], deep_analysis_partitions: ['id'], deep_analysis_evidence: ['id']
});

const requiredForeignKeys = Object.freeze([
  ['users', 'suspended_by_user_id', 'users', 'id', 'n'],
  ['spaces', 'suspended_by_user_id', 'users', 'id', 'n'],
  ['platform_role_assignments', 'user_id', 'users', 'id', 'c'],
  ['platform_role_assignments', 'granted_by_user_id', 'users', 'id', 'n'],
  ['platform_role_assignments', 'revoked_by_user_id', 'users', 'id', 'n'],
  ['platform_subscription_requests', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscription_requests', 'requested_by_user_id', 'users', 'id', 'r'],
  ['platform_subscription_requests', 'reviewed_by_user_id', 'users', 'id', 'n'],
  ['platform_subscriptions', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscriptions', 'source_request_id', 'platform_subscription_requests', 'id', 'n'],
  ['platform_subscriptions', 'approved_by_user_id', 'users', 'id', 'n'],
  ['platform_subscription_events', 'space_id', 'spaces', 'id', 'c'],
  ['platform_subscription_events', 'subscription_id', 'platform_subscriptions', 'id', 'n'],
  ['platform_subscription_events', 'request_id', 'platform_subscription_requests', 'id', 'n'],
  ['platform_subscription_events', 'actor_user_id', 'users', 'id', 'n'],
  ['platform_audit_events', 'actor_user_id', 'users', 'id', 'n'],
  ['platform_audit_events', 'space_id', 'spaces', 'id', 'n'],
  ['ticket_events', 'ticket_id', 'tickets', 'id', 'c'],
  ['ticket_events', 'actor_user_id', 'users', 'id', 'n']
]);

const assistantRequiredForeignKeys = Object.freeze([
  ['assistant_nylas_connections', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_nylas_connections', 'user_id', 'users', 'id', 'c'],
  ['assistant_nylas_oauth_states', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_nylas_oauth_states', 'user_id', 'users', 'id', 'c'],
  ['assistant_runs', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_runs', 'requested_by', 'users', 'id', 'r'],
  ['assistant_runs', 'ai_job_id', 'ai_jobs', 'id', 'n'],
  ['assistant_runs', 'connection_id', 'assistant_nylas_connections', 'id', 'n']
]);

const assistantPhase1RequiredForeignKeys = Object.freeze([
  ['assistant_actions', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_actions', 'created_by', 'users', 'id', 'r'],
  ['assistant_actions', 'source_run_id', 'assistant_runs', 'id', 'n'],
  ['assistant_reminders', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_reminders', 'action_id', 'assistant_actions', 'id', 'c'],
  ['assistant_reminders', 'created_by', 'users', 'id', 'r'],
  ['assistant_audit_events', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_audit_events', 'actor_user_id', 'users', 'id', 'r']
]);

const reviewedIntelligenceRequiredForeignKeys = Object.freeze([
  ['social_intelligence_publications', 'space_id', 'spaces', 'id', 'c'],
  ['social_intelligence_publications', 'job_id', 'knowledge_jobs', 'id', 'n'],
  ['social_intelligence_publications', 'published_by', 'users', 'id', 'n'],
  ['social_intelligence_publications', 'knowledge_base_id', 'knowledge_bases', 'id', 'c'],
  ['social_intelligence_publications', 'space_id', 'knowledge_bases', 'space_id', 'c'],
  ['social_intelligence_publications', 'document_id', 'knowledge_documents', 'id', 'c'],
  ['social_intelligence_publications', 'space_id', 'knowledge_documents', 'space_id', 'c']
]);

const reviewedReplyRequiredForeignKeys = Object.freeze([
  ['assistant_outbound_messages', 'run_id', 'assistant_runs', 'id', 'c'],
  ['assistant_outbound_messages', 'space_id', 'spaces', 'id', 'c'],
  ['assistant_outbound_messages', 'user_id', 'users', 'id', 'r'],
  ['assistant_outbound_messages', 'connection_id', 'assistant_nylas_connections', 'id', 'r']
]);

const adminControlRequiredForeignKeys = Object.freeze([
  ['platform_rbac_role_permissions', 'role_id', 'platform_rbac_roles', 'id', 'c'],
  ['platform_rbac_role_permissions', 'granted_by_user_id', 'users', 'id', 'n'],
  ['platform_rbac_user_roles', 'user_id', 'users', 'id', 'c'],
  ['platform_rbac_user_roles', 'role_id', 'platform_rbac_roles', 'id', 'c'],
  ['platform_rbac_user_roles', 'assigned_by_user_id', 'users', 'id', 'n'],
  ['platform_rbac_user_roles', 'revoked_by_user_id', 'users', 'id', 'n']
]);

const deepAnalysisRequiredForeignKeys = Object.freeze([
  ['deep_analysis_runs', 'space_id', 'spaces', 'id', 'c'],
  ['deep_analysis_runs', 'user_id', 'users', 'id', 'c'],
  ['deep_analysis_partitions', 'run_id', 'deep_analysis_runs', 'id', 'c'],
  ['deep_analysis_partitions', 'space_id', 'spaces', 'id', 'c'],
  ['deep_analysis_partitions', 'ai_job_id', 'ai_jobs', 'id', 'n'],
  ['deep_analysis_evidence', 'run_id', 'deep_analysis_runs', 'id', 'c'],
  ['deep_analysis_evidence', 'partition_id', 'deep_analysis_partitions', 'id', 'c'],
  ['deep_analysis_evidence', 'space_id', 'spaces', 'id', 'c']
]);

const requiredIndexes = Object.freeze({
  platform_role_assignments_active: ['create unique index', '(user_id, role)', 'where (revoked_at is null)'],
  platform_role_assignments_user: ['(user_id, granted_at desc)'],
  platform_subscription_requests_one_pending: ['create unique index', '(space_id)', "where (status = 'pending'::text)"],
  platform_subscription_requests_review: ['(status, created_at, id)'],
  platform_subscription_requests_space: ['(space_id, created_at desc, id)'],
  platform_subscriptions_one_per_space: ['create unique index', '(space_id)'],
  platform_subscriptions_space_history: ['(space_id, created_at desc, id)'],
  platform_subscription_events_space: ['(space_id, created_at desc, id)'],
  platform_subscription_events_request: ['(request_id, created_at, id)'],
  platform_audit_events_created: ['(created_at desc, id)'],
  platform_audit_events_target: ['(target_type, target_id, created_at desc, id)'],
  platform_audit_events_actor: ['(actor_user_id, created_at desc, id)'],
  platform_audit_events_space: ['(space_id, created_at desc, id)'],
  ticket_events_ticket: ['(ticket_id, created_at, id)']
});

const assistantRequiredIndexes = Object.freeze({
  assistant_nylas_connections_owner: ['(space_id, user_id, status, updated_at desc)'],
  assistant_nylas_connections_grant: ['create unique index', '(space_id, user_id, grant_fingerprint)', 'where (grant_fingerprint is not null)'],
  assistant_nylas_oauth_states_expiry: ['(expires_at, consumed_at)'],
  assistant_runs_owner_history: ['(space_id, requested_by, created_at desc, id)'],
  assistant_runs_job: ['(ai_job_id)'],
  assistant_runs_idempotency: ['create unique index', '(space_id, requested_by, idempotency_key)', 'where (idempotency_key is not null)']
});

const assistantPhase1RequiredIndexes = Object.freeze({
  assistant_actions_owner_history: ['(space_id, created_by, status, created_at desc, id)'],
  assistant_actions_source_item: [
    'create unique index', '(space_id, created_by, source_run_id, source_item_index)',
    'where ((source_run_id is not null) and (source_item_index is not null))'
  ],
  assistant_reminders_owner_schedule: ['(space_id, created_by, state, remind_at, id)'],
  assistant_audit_events_owner_history: ['(space_id, actor_user_id, created_at desc, id)']
});

const reviewedIntelligenceRequiredIndexes = Object.freeze({
  social_intelligence_publications_document_id_key: ['create unique index', '(document_id)'],
  social_intelligence_publications_space_created: ['(space_id, created_at desc)']
});

const reviewedReplyRequiredIndexes = Object.freeze({
  assistant_outbound_messages_run_id_key: ['create unique index', '(run_id)'],
  assistant_outbound_messages_provider_idempotency_key_key: ['create unique index', '(provider_idempotency_key)'],
  assistant_outbound_messages_owner: ['(space_id, user_id, created_at desc, id)']
});

const adminControlRequiredIndexes = Object.freeze({
  platform_rbac_user_roles_active: ['create unique index', '(user_id, role_id)', 'where (revoked_at is null)'],
  platform_rbac_user_roles_user: ['(user_id, assigned_at desc)']
});

const deepAnalysisRequiredIndexes = Object.freeze({
  deep_analysis_runs_idempotency: ['create unique index', '(space_id, user_id, idempotency_key)', 'where (idempotency_key is not null)'],
  deep_analysis_runs_space_state: ['(space_id, state, created_at)'],
  deep_analysis_partitions_run_id_ordinal_key: ['create unique index', '(run_id, ordinal)'],
  deep_analysis_partitions_run_state: ['(run_id, state, level, ordinal)'],
  deep_analysis_evidence_run_kind: ['(run_id, kind, created_at)']
});

const boundedActiveRequestRequiredIndexes = Object.freeze({
  social_reply_drafts_one_active_request: [
    'create unique index', '(space_id, requested_by, mention_id, tone, md5(instructions))', "where (state = 'queued'::text)"
  ],
  social_intelligence_reports_one_active_request: [
    'create unique index', '(space_id, user_id, connection_id, title, md5(mention_ids_json))', "where (state = 'queued'::text)"
  ],
  intelligence_reports_one_active_request: [
    'create unique index', '(space_id, user_id, title, md5(objective), md5(source_refs_json), md5(knowledge_refs_json))',
    "where (state = 'queued'::text)"
  ]
});

const requiredDefaults = Object.freeze({
  'users.account_status': "'active'::text",
  'spaces.status': "'active'::text",
  'platform_subscription_requests.request_note': "''::text",
  'platform_subscription_requests.plan_snapshot_json': "'{}'::text",
  'platform_subscription_requests.status': "'pending'::text",
  'platform_subscription_requests.version': '1',
  'platform_subscriptions.status': "'active'::text",
  'platform_subscriptions.features_json': "'{}'::text",
  'platform_subscriptions.limits_json': "'{}'::text",
  'platform_subscriptions.version': '1',
  'platform_subscription_events.metadata_json': "'{}'::text",
  'ticket_events.detail_json': "'{}'::text"
});

const assistantRequiredDefaults = Object.freeze({
  'assistant_nylas_connections.email': "''::text",
  'assistant_nylas_connections.scopes_json': "'[]'::text",
  'assistant_nylas_connections.status': "'connected'::text",
  'assistant_runs.source_refs_json': "'[]'::text",
  'assistant_runs.state': "'queued'::text",
  'assistant_runs.draft_revision': '0',
  'assistant_runs.advisory_only': '1',
  'assistant_runs.external_dispatched': '0'
});

const assistantPhase1RequiredDefaults = Object.freeze({
  'assistant_runs.knowledge_base_ids_json': "'[]'::text",
  'assistant_actions.description': "''::text",
  'assistant_actions.owner': "''::text",
  'assistant_actions.status': "'open'::text",
  'assistant_actions.priority': "'normal'::text",
  'assistant_actions.revision': '1',
  'assistant_reminders.note': "''::text",
  'assistant_reminders.state': "'scheduled'::text",
  'assistant_reminders.revision': '1',
  'assistant_audit_events.detail_json': "'{}'::text"
});

const reviewedIntelligenceRequiredDefaults = Object.freeze({
  'social_intelligence_publications.review_status': "'reviewed'::text"
});

const reviewedReplyRequiredDefaults = Object.freeze({
  'assistant_outbound_messages.recipients_json': "'[]'::text"
});

const adminControlRequiredDefaults = Object.freeze({
  'platform_rbac_roles.description': "''::text",
  'platform_rbac_roles.built_in': '1',
  'platform_rbac_roles.version': '1'
});

const managedPlanRequiredDefaults = Object.freeze({
  'platform_subscription_plans.description': "''::text",
  'platform_subscription_plans.requestable': '1',
  'platform_subscription_plans.display_order': '0',
  'platform_subscription_plans.version': '1'
});

const deepAnalysisRequiredDefaults = Object.freeze({
  'deep_analysis_runs.state': "'queued'::text",
  'deep_analysis_runs.stage': "'planning'::text",
  'deep_analysis_runs.progress': '0',
  'deep_analysis_runs.source_refs_json': "'[]'::text",
  'deep_analysis_runs.knowledge_refs_json': "'[]'::text",
  'deep_analysis_runs.corpus_manifest_json': "'{}'::text",
  'deep_analysis_runs.estimate_json': "'{}'::text",
  'deep_analysis_runs.total_partitions': '0',
  'deep_analysis_runs.completed_partitions': '0',
  'deep_analysis_runs.failed_partitions': '0',
  'deep_analysis_partitions.level': '0',
  'deep_analysis_partitions.state': "'queued'::text",
  'deep_analysis_partitions.source_json': "'{}'::text",
  'deep_analysis_partitions.input_json': "'{}'::text",
  'deep_analysis_partitions.token_estimate': '0',
  'deep_analysis_evidence.citations_json': "'[]'::text",
  'deep_analysis_evidence.metadata_json': "'{}'::text"
});

const adminControlRequiredChecks = Object.freeze({
  platform_rbac_roles: [['version', '> 0']]
});

const managedPlanRequiredChecks = Object.freeze({
  platform_subscription_plans: [
    ['code', 'starter', 'team', 'enterprise'],
    ['requestable', '0', '1'],
    ['display_order', '>= 0'],
    ['version', '> 0']
  ]
});

const requiredChecks = Object.freeze({
  platform_role_assignments: [['role', 'superadmin', 'support', 'billing_approver', 'analyst']],
  platform_subscription_requests: [
    ['request_type', 'activate', 'change', 'cancel'],
    ['requested_plan_code', 'starter', 'team', 'enterprise'],
    ['status', 'pending', 'approved', 'rejected', 'cancelled'],
    ['version', '> 0']
  ],
  platform_subscriptions: [
    ['plan_code', 'starter', 'team', 'enterprise'],
    ['status', 'active', 'suspended', 'cancelled'],
    ['version', '> 0']
  ]
});

const assistantRequiredChecks = Object.freeze({
  assistant_nylas_connections: [
    ['provider', 'google', 'microsoft'],
    ['status', 'connected', 'revoked', 'error']
  ],
  assistant_nylas_oauth_states: [['provider', 'google', 'microsoft']],
  assistant_runs: [
    ['kind', 'email_summary', 'email_draft', 'knowledge_answer'],
    ['state', 'queued', 'processing', 'completed', 'failed'],
    ['advisory_only', '= 1'],
    ['external_dispatched', '= 0']
  ]
});

const assistantPhase1RequiredChecks = Object.freeze({
  assistant_runs: [
    ['kind', 'email_summary', 'email_draft', 'knowledge_answer', 'work_product'],
    ['state', 'queued', 'processing', 'completed', 'failed'],
    ['document_type', 'correspondence', 'board_paper', 'policy_lookup', 'scheduling_proposal'],
    ['advisory_only', '= 1'],
    ['external_dispatched', '= 0']
  ],
  assistant_actions: [
    ['status', 'open', 'in_progress', 'completed', 'cancelled'],
    ['priority', 'low', 'normal', 'high', 'urgent']
  ],
  assistant_reminders: [['state', 'scheduled', 'dismissed', 'completed']]
});

const reviewedIntelligenceRequiredChecks = Object.freeze({
  social_intelligence_publications: [
    ['review_status', 'reviewed'],
    ['source_snapshot_sha256', '^[a-f0-9]{64}$'],
    ['artifact_sha256', '^[a-f0-9]{64}$']
  ]
});

const reviewedReplyRequiredChecks = Object.freeze({
  assistant_outbound_messages: [
    ['mode', 'reply', 'reply_all'],
    ['status', 'sending', 'sent', 'failed'],
    ['subject_sha256', '^[a-f0-9]{64}$'],
    ['body_sha256', '^[a-f0-9]{64}$']
  ]
});

/** Runtime schema 12: Journey Map 2.0 control plane. Every table carries a typed
 * space_id so the tenancy predicate never depends on a join, and reusable
 * entities such as personas and evidence links stay addressable independently of
 * the map version that happens to cite them. */
const journeyMapExactColumns = Object.freeze({
  journey_personas: [
    ['id', 'text', false], ['space_id', 'text', false], ['name', 'text', false], ['summary', 'text', false],
    ['lifecycle_state', 'text', false], ['owner_user_id', 'text', true], ['source', 'text', false],
    ['attributes_json', 'text', false], ['goals_json', 'text', false], ['behaviours_json', 'text', false],
    ['needs_json', 'text', false], ['barriers_json', 'text', false], ['review_at', 'text', true],
    ['revision', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_definitions: [
    ['id', 'text', false], ['space_id', 'text', false], ['legacy_journey_id', 'text', true], ['name', 'text', false],
    ['purpose', 'text', false], ['experience_type', 'text', false], ['map_type', 'text', false], ['mode', 'text', false],
    ['status', 'text', false], ['owner_user_id', 'text', true], ['current_version_id', 'text', true],
    ['published_version_id', 'text', true], ['review_cadence_days', 'integer', false], ['revision', 'integer', false],
    ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_map_versions: [
    ['id', 'text', false], ['definition_id', 'text', false], ['space_id', 'text', false],
    ['version_number', 'integer', false], ['schema_version', 'integer', false], ['state', 'text', false],
    ['map_type', 'text', false], ['mode', 'text', false], ['experience_type', 'text', false],
    ['objective', 'text', false], ['industry', 'text', false], ['summary', 'text', false],
    ['legacy_audience', 'text', false], ['provenance_json', 'text', false], ['source_job_id', 'text', true],
    ['author_user_id', 'text', true], ['published_at', 'text', true], ['created_at', 'text', false]
  ],
  journey_map_stages: [
    ['id', 'text', false], ['version_id', 'text', false], ['space_id', 'text', false], ['stage_key', 'text', false],
    ['name', 'text', false], ['goal', 'text', false], ['description', 'text', false], ['ordinal', 'integer', false]
  ],
  journey_map_lanes: [
    ['id', 'text', false], ['version_id', 'text', false], ['space_id', 'text', false], ['lane_type', 'text', false],
    ['title', 'text', false], ['description', 'text', false], ['ordinal', 'integer', false], ['visible', 'integer', false]
  ],
  journey_map_cards: [
    ['id', 'text', false], ['version_id', 'text', false], ['space_id', 'text', false], ['stage_key', 'text', false],
    ['lane_type', 'text', false], ['kind', 'text', false], ['title', 'text', false], ['content', 'text', false],
    ['ordinal', 'integer', false], ['persona_id', 'text', true], ['status', 'text', false], ['origin', 'text', false],
    ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_definition_personas: [
    ['definition_id', 'text', false], ['persona_id', 'text', false], ['space_id', 'text', false],
    ['ordinal', 'integer', false], ['created_at', 'text', false]
  ],
  journey_evidence_links: [
    ['id', 'text', false], ['space_id', 'text', false], ['target_type', 'text', false], ['target_id', 'text', false],
    ['source_type', 'text', false], ['source_ref', 'text', false], ['source_label', 'text', false],
    ['excerpt', 'text', false], ['assessment', 'text', false], ['confidence', 'double precision', false],
    ['population', 'text', false], ['sample_size', 'integer', true], ['collected_at', 'text', true],
    ['window_start', 'text', true], ['window_end', 'text', true], ['freshness_days', 'integer', true],
    ['invalidated_at', 'text', true], ['invalidated_reason', 'text', true], ['created_by', 'text', true],
    ['created_at', 'text', false], ['updated_at', 'text', false]
  ]
});

const journeyMapPrimaryKeys = Object.freeze({
  journey_personas: ['id'],
  journey_definitions: ['id'],
  journey_map_versions: ['id'],
  journey_map_stages: ['id'],
  journey_map_lanes: ['id'],
  journey_map_cards: ['id'],
  journey_definition_personas: ['definition_id', 'persona_id'],
  journey_evidence_links: ['id']
});

const journeyMapRequiredForeignKeys = Object.freeze([
  ['journey_personas', 'space_id', 'spaces', 'id', 'c'],
  ['journey_personas', 'owner_user_id', 'users', 'id', 'n'],
  ['journey_definitions', 'space_id', 'spaces', 'id', 'c'],
  ['journey_definitions', 'owner_user_id', 'users', 'id', 'n'],
  ['journey_map_versions', 'definition_id', 'journey_definitions', 'id', 'c'],
  ['journey_map_versions', 'space_id', 'spaces', 'id', 'c'],
  ['journey_map_versions', 'source_job_id', 'ai_jobs', 'id', 'n'],
  ['journey_map_versions', 'author_user_id', 'users', 'id', 'n'],
  ['journey_map_stages', 'version_id', 'journey_map_versions', 'id', 'c'],
  ['journey_map_stages', 'space_id', 'spaces', 'id', 'c'],
  ['journey_map_lanes', 'version_id', 'journey_map_versions', 'id', 'c'],
  ['journey_map_lanes', 'space_id', 'spaces', 'id', 'c'],
  ['journey_map_cards', 'version_id', 'journey_map_versions', 'id', 'c'],
  ['journey_map_cards', 'space_id', 'spaces', 'id', 'c'],
  ['journey_map_cards', 'persona_id', 'journey_personas', 'id', 'n'],
  ['journey_definition_personas', 'definition_id', 'journey_definitions', 'id', 'c'],
  ['journey_definition_personas', 'persona_id', 'journey_personas', 'id', 'c'],
  ['journey_definition_personas', 'space_id', 'spaces', 'id', 'c'],
  ['journey_evidence_links', 'space_id', 'spaces', 'id', 'c'],
  ['journey_evidence_links', 'created_by', 'users', 'id', 'n']
]);

const journeyMapRequiredIndexes = Object.freeze({
  journey_personas_space_name: ['create unique index', '(space_id, name)'],
  journey_personas_space_state: ['(space_id, lifecycle_state, updated_at desc)'],
  journey_definitions_legacy: ['create unique index', '(legacy_journey_id)', 'where (legacy_journey_id is not null)'],
  journey_definitions_space: ['(space_id, updated_at desc, id)'],
  journey_map_versions_definition_number: ['create unique index', '(definition_id, version_number)'],
  journey_map_versions_definition: ['(definition_id, version_number desc)'],
  journey_map_stages_version_key: ['create unique index', '(version_id, stage_key)'],
  journey_map_stages_order: ['(version_id, ordinal, id)'],
  journey_map_lanes_version_lane: ['create unique index', '(version_id, lane_type, ordinal)'],
  journey_map_lanes_order: ['(version_id, ordinal, id)'],
  journey_map_cards_cell: ['(version_id, stage_key, lane_type, ordinal, id)'],
  journey_definition_personas_persona: ['(persona_id, definition_id)'],
  journey_evidence_links_unique: ['create unique index', '(space_id, target_type, target_id, source_type, source_ref)'],
  journey_evidence_links_target: ['(space_id, target_type, target_id, created_at, id)']
});

const journeyMapRequiredDefaults = Object.freeze({
  'journey_personas.summary': "''::text",
  'journey_personas.lifecycle_state': "'draft'::text",
  'journey_personas.source': "'workspace'::text",
  'journey_personas.attributes_json': "'{}'::text",
  'journey_personas.goals_json': "'[]'::text",
  'journey_personas.behaviours_json': "'[]'::text",
  'journey_personas.needs_json': "'[]'::text",
  'journey_personas.barriers_json': "'[]'::text",
  'journey_personas.revision': '1',
  'journey_definitions.purpose': "''::text",
  'journey_definitions.experience_type': "'customer'::text",
  'journey_definitions.map_type': "'current_state'::text",
  'journey_definitions.mode': "'designed'::text",
  'journey_definitions.status': "'draft'::text",
  'journey_definitions.review_cadence_days': '0',
  'journey_definitions.revision': '1',
  'journey_map_versions.schema_version': '2',
  'journey_map_versions.state': "'draft'::text",
  'journey_map_versions.map_type': "'current_state'::text",
  'journey_map_versions.mode': "'designed'::text",
  'journey_map_versions.experience_type': "'customer'::text",
  'journey_map_versions.objective': "''::text",
  'journey_map_versions.industry': "''::text",
  'journey_map_versions.summary': "''::text",
  'journey_map_versions.legacy_audience': "''::text",
  'journey_map_versions.provenance_json': "'{}'::text",
  'journey_map_stages.goal': "''::text",
  'journey_map_stages.description': "''::text",
  'journey_map_lanes.description': "''::text",
  'journey_map_lanes.visible': '1',
  'journey_map_cards.content': "''::text",
  'journey_map_cards.status': "'active'::text",
  'journey_map_cards.origin': "'workspace'::text",
  'journey_definition_personas.ordinal': '0',
  'journey_evidence_links.source_label': "''::text",
  'journey_evidence_links.excerpt': "''::text",
  'journey_evidence_links.assessment': "'supports'::text",
  'journey_evidence_links.confidence': '0',
  'journey_evidence_links.population': "''::text"
});

const journeyMapRequiredChecks = Object.freeze({
  journey_personas: [
    ['lifecycle_state', 'draft', 'in_review', 'active', 'retired'],
    ['source', 'workspace', 'legacy_audience_draft', 'ai_draft'],
    ['revision', '> 0']
  ],
  journey_definitions: [
    ['experience_type', 'customer', 'employee', 'citizen', 'patient', 'partner', 'custom'],
    ['map_type', 'current_state', 'future_state', 'ideal_state', 'service_blueprint'],
    ['mode', 'designed', 'evidence_backed', 'connected'],
    ['status', 'draft', 'published', 'archived'],
    ['revision', '> 0']
  ],
  journey_map_versions: [
    ['state', 'draft', 'published', 'superseded'],
    ['version_number', '> 0'],
    ['schema_version', '> 0']
  ],
  journey_map_lanes: [['visible', '0', '1']],
  journey_map_cards: [
    ['status', 'draft', 'active', 'retired'],
    ['origin', 'legacy_import', 'workspace', 'ai_suggestion', 'template']
  ],
  journey_evidence_links: [
    ['target_type', 'card', 'stage', 'persona', 'definition'],
    ['assessment', 'supports', 'contradicts', 'neutral'],
    ['confidence', '>= 0', '<= 1']
  ]
});

/** Exported so the schema itself can be tested for drift without provisioning a
 * PostgreSQL server: a unit test compares these expectations to the SQLite DDL
 * and the checksummed migration that create the same tables. */
export const journeyMapRuntimeContract = Object.freeze({
  columns: journeyMapExactColumns,
  primaryKeys: journeyMapPrimaryKeys,
  foreignKeys: journeyMapRequiredForeignKeys,
  indexes: journeyMapRequiredIndexes,
  defaults: journeyMapRequiredDefaults,
  checks: journeyMapRequiredChecks
});

/** Runtime schema 13: governed template catalogue and immutable map pins. */
const journeyTemplateExactColumns = Object.freeze({
  journey_templates: [
    ['id', 'text', false], ['scope', 'text', false], ['space_id', 'text', true], ['template_key', 'text', false],
    ['status', 'text', false], ['current_version_id', 'text', true], ['published_version_id', 'text', true],
    ['revision', 'integer', false], ['created_by_user_id', 'text', true], ['created_at', 'text', false],
    ['updated_at', 'text', false]
  ],
  journey_template_versions: [
    ['id', 'text', false], ['template_id', 'text', false], ['scope', 'text', false], ['space_id', 'text', true],
    ['version_number', 'integer', false], ['schema_version', 'integer', false], ['state', 'text', false],
    ['name', 'text', false], ['description', 'text', false], ['industry', 'text', false], ['use_case', 'text', false],
    ['experience_type', 'text', false], ['map_type', 'text', false], ['lanes_json', 'text', false],
    ['stages_json', 'text', false], ['content_checksum', 'text', false], ['revision', 'integer', false],
    ['created_by_user_id', 'text', true], ['reviewed_by_user_id', 'text', true], ['reviewed_at', 'text', true],
    ['published_by_user_id', 'text', true], ['published_at', 'text', true], ['retired_by_user_id', 'text', true],
    ['retired_at', 'text', true], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_template_instantiations: [
    ['definition_id', 'text', false], ['version_id', 'text', false], ['template_version_id', 'text', false],
    ['space_id', 'text', false], ['created_by_user_id', 'text', true], ['created_at', 'text', false]
  ],
  journey_template_audit_events: [
    ['id', 'text', false], ['template_id', 'text', false], ['template_version_id', 'text', true],
    ['space_id', 'text', true], ['actor_user_id', 'text', true], ['action', 'text', false],
    ['reason', 'text', false], ['before_json', 'text', false], ['after_json', 'text', false],
    ['created_at', 'text', false]
  ]
});

const journeyTemplatePrimaryKeys = Object.freeze({
  journey_templates: ['id'],
  journey_template_versions: ['id'],
  journey_template_instantiations: ['definition_id'],
  journey_template_audit_events: ['id']
});

const journeyTemplateRequiredForeignKeys = Object.freeze([
  ['journey_templates', 'space_id', 'spaces', 'id', 'c'],
  ['journey_templates', 'current_version_id', 'journey_template_versions', 'id', 'n'],
  ['journey_templates', 'published_version_id', 'journey_template_versions', 'id', 'n'],
  ['journey_templates', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_template_versions', 'template_id', 'journey_templates', 'id', 'c'],
  ['journey_template_versions', 'space_id', 'spaces', 'id', 'c'],
  ['journey_template_versions', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_template_versions', 'reviewed_by_user_id', 'users', 'id', 'n'],
  ['journey_template_versions', 'published_by_user_id', 'users', 'id', 'n'],
  ['journey_template_versions', 'retired_by_user_id', 'users', 'id', 'n'],
  ['journey_template_instantiations', 'definition_id', 'journey_definitions', 'id', 'c'],
  ['journey_template_instantiations', 'version_id', 'journey_map_versions', 'id', 'c'],
  ['journey_template_instantiations', 'template_version_id', 'journey_template_versions', 'id', 'r'],
  ['journey_template_instantiations', 'space_id', 'spaces', 'id', 'c'],
  ['journey_template_instantiations', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_template_audit_events', 'template_id', 'journey_templates', 'id', 'c'],
  ['journey_template_audit_events', 'template_version_id', 'journey_template_versions', 'id', 'n'],
  ['journey_template_audit_events', 'space_id', 'spaces', 'id', 'c'],
  ['journey_template_audit_events', 'actor_user_id', 'users', 'id', 'n']
]);

const journeyTemplateRequiredIndexes = Object.freeze({
  journey_templates_system_key: ['create unique index', '(template_key)', "where (scope = 'system'::text)"],
  journey_templates_space_key: ['create unique index', '(space_id, template_key)', "where (scope = 'space'::text)"],
  journey_templates_space_status: ['(space_id, status, updated_at desc, id)'],
  journey_template_versions_number: ['create unique index', '(template_id, version_number)'],
  journey_template_versions_one_published: ['create unique index', '(template_id)', "where (state = 'published'::text)"],
  journey_template_versions_state: ['(template_id, state, version_number desc)'],
  journey_template_instantiations_version: ['create unique index', '(version_id)'],
  journey_template_instantiations_template: ['(template_version_id, created_at desc, definition_id)'],
  journey_template_audit_history: ['(template_id, created_at desc, id)'],
  journey_template_audit_space: ['(space_id, created_at desc, id)']
});

const journeyTemplateRequiredDefaults = Object.freeze({
  'journey_templates.status': "'active'::text",
  'journey_templates.revision': '1',
  'journey_template_versions.schema_version': '1',
  'journey_template_versions.state': "'draft'::text",
  'journey_template_versions.description': "''::text",
  'journey_template_versions.industry': "''::text",
  'journey_template_versions.use_case': "''::text",
  'journey_template_versions.experience_type': "'customer'::text",
  'journey_template_versions.map_type': "'current_state'::text",
  'journey_template_versions.lanes_json': "'[]'::text",
  'journey_template_versions.stages_json': "'[]'::text",
  'journey_template_versions.revision': '1',
  'journey_template_audit_events.reason': "''::text",
  'journey_template_audit_events.before_json': "'{}'::text",
  'journey_template_audit_events.after_json': "'{}'::text"
});

const journeyTemplateRequiredChecks = Object.freeze({
  journey_templates: [
    ['scope', 'system', 'space'], ['status', 'active', 'retired'], ['revision', '> 0'],
    ['scope', 'system', 'space_id is null', 'scope', 'space', 'space_id is not null']
  ],
  journey_template_versions: [
    ['scope', 'system', 'space'], ['state', 'draft', 'in_review', 'published', 'retired'],
    ['version_number', '> 0'], ['schema_version', '> 0'], ['content_checksum', 'length', '= 64'], ['revision', '> 0'],
    ['experience_type', 'customer', 'employee', 'citizen', 'patient', 'partner', 'custom'],
    ['map_type', 'current_state', 'future_state', 'ideal_state', 'service_blueprint'],
    ['scope', 'system', 'space_id is null', 'scope', 'space', 'space_id is not null']
  ],
  journey_template_audit_events: [[
    'action', 'seeded', 'created', 'draft_updated', 'version_created', 'submitted_for_review',
    'review_rejected', 'published', 'retired', 'map_created'
  ]]
});

export const journeyTemplateRuntimeContract = Object.freeze({
  columns: journeyTemplateExactColumns,
  primaryKeys: journeyTemplatePrimaryKeys,
  foreignKeys: journeyTemplateRequiredForeignKeys,
  indexes: journeyTemplateRequiredIndexes,
  defaults: journeyTemplateRequiredDefaults,
  checks: journeyTemplateRequiredChecks
});

/** Runtime schema 14: evidence snapshots retain source revision/validation
 * lineage and explicit refreshes append immutable, content-free audit rows. */
const journeyEvidenceLifecycleExactColumns = Object.freeze({
  journey_evidence_links: [
    ['id', 'text', false], ['space_id', 'text', false], ['target_type', 'text', false], ['target_id', 'text', false],
    ['source_type', 'text', false], ['source_ref', 'text', false], ['source_label', 'text', false],
    ['excerpt', 'text', false], ['assessment', 'text', false], ['confidence', 'double precision', false],
    ['population', 'text', false], ['sample_size', 'integer', true], ['collected_at', 'text', true],
    ['window_start', 'text', true], ['window_end', 'text', true], ['freshness_days', 'integer', true],
    ['source_updated_at', 'text', true], ['last_validated_at', 'text', true],
    ['invalidated_at', 'text', true], ['invalidated_reason', 'text', true], ['created_by', 'text', true],
    ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_evidence_audit_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['evidence_link_id', 'text', false],
    ['actor_user_id', 'text', true], ['action', 'text', false], ['changed_fields_json', 'text', false],
    ['before_fingerprint', 'text', false], ['after_fingerprint', 'text', false], ['created_at', 'text', false]
  ]
});
const journeyEvidenceLifecycleAppendedColumns = Object.freeze([
  ...journeyMapExactColumns.journey_evidence_links,
  ['source_updated_at', 'text', true], ['last_validated_at', 'text', true]
]);

const journeyEvidenceLifecyclePrimaryKeys = Object.freeze({ journey_evidence_audit_events: ['id'] });
const journeyEvidenceLifecycleRequiredForeignKeys = Object.freeze([
  ['journey_evidence_audit_events', 'space_id', 'spaces', 'id', 'c'],
  ['journey_evidence_audit_events', 'evidence_link_id', 'journey_evidence_links', 'id', 'c'],
  ['journey_evidence_audit_events', 'actor_user_id', 'users', 'id', 'n']
]);
const journeyEvidenceLifecycleRequiredIndexes = Object.freeze({
  journey_evidence_audit_link: ['(evidence_link_id, created_at desc, id)'],
  journey_evidence_audit_space: ['(space_id, created_at desc, id)']
});
const journeyEvidenceLifecycleRequiredDefaults = Object.freeze({
  'journey_evidence_audit_events.changed_fields_json': "'[]'::text"
});
const journeyEvidenceLifecycleRequiredChecks = Object.freeze({
  journey_evidence_audit_events: [
    ['action', 'refreshed'],
    ['before_fingerprint', 'length', '= 64'],
    ['after_fingerprint', 'length', '= 64']
  ]
});

export const journeyEvidenceLifecycleRuntimeContract = Object.freeze({
  columns: journeyEvidenceLifecycleExactColumns,
  primaryKeys: journeyEvidenceLifecyclePrimaryKeys,
  foreignKeys: journeyEvidenceLifecycleRequiredForeignKeys,
  indexes: journeyEvidenceLifecycleRequiredIndexes,
  defaults: journeyEvidenceLifecycleRequiredDefaults,
  checks: journeyEvidenceLifecycleRequiredChecks
});

/** Runtime schema 15: immutable monthly usage events plus reconcilable
 * materialized buckets. No customer payload or free-form metadata is stored. */
const usageLedgerExactColumns = Object.freeze({
  platform_usage_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['subscription_id', 'text', true],
    ['meter', 'text', false], ['quantity', 'bigint', false], ['period_start', 'text', false],
    ['period_end', 'text', false], ['idempotency_key', 'text', false], ['intent_hash', 'text', false],
    ['source_type', 'text', false], ['source_id', 'text', true], ['actor_user_id', 'text', true],
    ['created_at', 'text', false]
  ],
  platform_usage_buckets: [
    ['space_id', 'text', false], ['meter', 'text', false], ['period_start', 'text', false],
    ['period_end', 'text', false], ['quantity', 'bigint', false], ['updated_at', 'text', false]
  ]
});
const usageLedgerPrimaryKeys = Object.freeze({
  platform_usage_events: ['id'],
  platform_usage_buckets: ['space_id', 'meter', 'period_start']
});
const usageLedgerRequiredForeignKeys = Object.freeze([
  ['platform_usage_events', 'space_id', 'spaces', 'id', 'c'],
  ['platform_usage_events', 'subscription_id', 'platform_subscriptions', 'id', 'n'],
  ['platform_usage_events', 'actor_user_id', 'users', 'id', 'n'],
  ['platform_usage_buckets', 'space_id', 'spaces', 'id', 'c']
]);
const usageLedgerRequiredIndexes = Object.freeze({
  platform_usage_events_idempotency: [
    'create unique index', '(space_id, meter, period_start, idempotency_key)'
  ],
  platform_usage_events_space_period: ['(space_id, meter, period_start, created_at, id)'],
  platform_usage_events_source: [
    '(source_type, source_id)', 'where (source_id is not null)'
  ],
  platform_usage_buckets_period: ['(meter, period_start, space_id)']
});
const usageLedgerRequiredDefaults = Object.freeze({ 'platform_usage_buckets.quantity': '0' });
const usageLedgerRequiredChecks = Object.freeze({
  platform_usage_events: [
    ['meter', 'length', '>= 1', '<= 80'], ['quantity', '> 0'],
    ['period_start', 'length', '= 24'], ['period_end', 'length', '= 24', 'period_start'],
    ['idempotency_key', 'length', '>= 1', '<= 200'], ['intent_hash', '^[a-f0-9]{64}$'],
    ['source_type', 'length', '>= 1', '<= 80'], ['source_id', 'length', '>= 1', '<= 200']
  ],
  platform_usage_buckets: [
    ['meter', 'length', '>= 1', '<= 80'], ['period_start', 'length', '= 24'],
    ['period_end', 'length', '= 24', 'period_start'], ['quantity', '>= 0']
  ]
});

export const usageLedgerRuntimeContract = Object.freeze({
  columns: usageLedgerExactColumns,
  primaryKeys: usageLedgerPrimaryKeys,
  foreignKeys: usageLedgerRequiredForeignKeys,
  indexes: usageLedgerRequiredIndexes,
  defaults: usageLedgerRequiredDefaults,
  checks: usageLedgerRequiredChecks
});

/** Runtime schema 16: tenant- and environment-bound source/key administration,
 * immutable tracking-plan content, and append-only control-plane audit. */
const journeyEventControlPlaneExactColumns = Object.freeze({
  journey_event_sources: [
    ['id', 'text', false], ['space_id', 'text', false], ['name', 'text', false],
    ['environment', 'text', false], ['status', 'text', false], ['validation_mode', 'text', false],
    ['allowed_origins_json', 'text', false], ['allowed_bundle_ids_json', 'text', false],
    ['events_per_minute', 'bigint', false], ['bytes_per_minute', 'bigint', false],
    ['idempotency_key', 'text', true], ['intent_hash', 'text', true], ['created_by_user_id', 'text', true],
    ['revision', 'integer', false], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_event_credentials: [
    ['id', 'text', false], ['source_id', 'text', false], ['space_id', 'text', false],
    ['environment', 'text', false], ['kind', 'text', false], ['scope', 'text', false],
    ['display_prefix', 'text', false], ['algorithm', 'text', false], ['salt', 'text', false],
    ['digest', 'text', false], ['status', 'text', false], ['rotated_from_id', 'text', true],
    ['idempotency_key', 'text', true], ['intent_hash', 'text', true], ['created_by_user_id', 'text', true],
    ['created_at', 'text', false], ['expires_at', 'text', true], ['revoked_at', 'text', true]
  ],
  journey_event_schemas: [
    ['id', 'text', false], ['source_id', 'text', false], ['space_id', 'text', false],
    ['event_name', 'text', false], ['idempotency_key', 'text', true], ['intent_hash', 'text', true],
    ['created_by_user_id', 'text', true], ['created_at', 'text', false], ['updated_at', 'text', false]
  ],
  journey_event_schema_versions: [
    ['id', 'text', false], ['schema_id', 'text', false], ['source_id', 'text', false],
    ['space_id', 'text', false], ['version', 'text', false], ['version_major', 'integer', false],
    ['version_minor', 'integer', false], ['state', 'text', false], ['properties_json', 'text', false],
    ['compatibility_json', 'text', false], ['content_sha256', 'text', false],
    ['idempotency_key', 'text', true], ['intent_hash', 'text', true], ['created_by_user_id', 'text', true],
    ['published_by_user_id', 'text', true], ['deprecated_by_user_id', 'text', true],
    ['created_at', 'text', false], ['published_at', 'text', true], ['deprecated_at', 'text', true]
  ],
  journey_event_control_audit_events: [
    ['id', 'text', false], ['space_id', 'text', false], ['source_id', 'text', true],
    ['actor_user_id', 'text', true], ['action', 'text', false], ['target_type', 'text', false],
    ['target_id', 'text', false], ['detail_json', 'text', false], ['before_fingerprint', 'text', true],
    ['after_fingerprint', 'text', true], ['created_at', 'text', false]
  ]
});
const journeyEventControlPlanePrimaryKeys = Object.freeze({
  journey_event_sources: ['id'],
  journey_event_credentials: ['id'],
  journey_event_schemas: ['id'],
  journey_event_schema_versions: ['id'],
  journey_event_control_audit_events: ['id']
});
const journeyEventControlPlaneRequiredForeignKeys = Object.freeze([
  ['journey_event_sources', 'space_id', 'spaces', 'id', 'c'],
  ['journey_event_sources', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_event_credentials', 'source_id', 'journey_event_sources', 'id', 'c'],
  ['journey_event_credentials', 'space_id', 'journey_event_sources', 'space_id', 'c'],
  ['journey_event_credentials', 'environment', 'journey_event_sources', 'environment', 'c'],
  ['journey_event_credentials', 'space_id', 'spaces', 'id', 'c'],
  ['journey_event_credentials', 'rotated_from_id', 'journey_event_credentials', 'id', 'n'],
  ['journey_event_credentials', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_event_schemas', 'source_id', 'journey_event_sources', 'id', 'c'],
  ['journey_event_schemas', 'space_id', 'journey_event_sources', 'space_id', 'c'],
  ['journey_event_schemas', 'space_id', 'spaces', 'id', 'c'],
  ['journey_event_schemas', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_event_schema_versions', 'schema_id', 'journey_event_schemas', 'id', 'c'],
  ['journey_event_schema_versions', 'source_id', 'journey_event_schemas', 'source_id', 'c'],
  ['journey_event_schema_versions', 'space_id', 'journey_event_schemas', 'space_id', 'c'],
  ['journey_event_schema_versions', 'space_id', 'spaces', 'id', 'c'],
  ['journey_event_schema_versions', 'created_by_user_id', 'users', 'id', 'n'],
  ['journey_event_schema_versions', 'published_by_user_id', 'users', 'id', 'n'],
  ['journey_event_schema_versions', 'deprecated_by_user_id', 'users', 'id', 'n'],
  ['journey_event_control_audit_events', 'space_id', 'spaces', 'id', 'c'],
  ['journey_event_control_audit_events', 'source_id', 'journey_event_sources', 'id', 'n'],
  ['journey_event_control_audit_events', 'actor_user_id', 'users', 'id', 'n']
]);
const journeyEventControlPlaneRequiredIndexes = Object.freeze({
  journey_event_sources_space_name_environment: ['create unique index', '(space_id, environment, name)'],
  journey_event_sources_idempotency: ['create unique index', '(space_id, idempotency_key)', 'where (idempotency_key is not null)'],
  journey_event_sources_tenant_environment_identity: ['create unique index', '(id, space_id, environment)'],
  journey_event_sources_tenant_identity: ['create unique index', '(id, space_id)'],
  journey_event_sources_space_history: ['(space_id, updated_at desc, id)'],
  journey_event_credentials_display_prefix: ['create unique index', '(display_prefix)'],
  journey_event_credentials_one_active: ['create unique index', '(source_id, kind)', "where (status = 'active'::text)"],
  journey_event_credentials_idempotency: ['create unique index', '(space_id, idempotency_key)', 'where (idempotency_key is not null)'],
  journey_event_credentials_source_history: ['(source_id, created_at desc, id)'],
  journey_event_schemas_source_event: ['create unique index', '(source_id, event_name)'],
  journey_event_schemas_idempotency: ['create unique index', '(space_id, idempotency_key)', 'where (idempotency_key is not null)'],
  journey_event_schemas_tenant_source_identity: ['create unique index', '(id, source_id, space_id)'],
  journey_event_schemas_space_history: ['(space_id, updated_at desc, id)'],
  journey_event_schema_versions_number: ['create unique index', '(schema_id, version_major, version_minor)'],
  journey_event_schema_versions_one_published: ['create unique index', '(schema_id)', "where (state = 'published'::text)"],
  journey_event_schema_versions_idempotency: ['create unique index', '(space_id, idempotency_key)', 'where (idempotency_key is not null)'],
  journey_event_schema_versions_history: ['(schema_id, version_major desc, version_minor desc, id)'],
  journey_event_control_audit_space: ['(space_id, created_at desc, id)'],
  journey_event_control_audit_source: ['(source_id, created_at desc, id)']
});
const journeyEventControlPlaneRequiredDefaults = Object.freeze({
  'journey_event_sources.status': "'active'::text",
  'journey_event_sources.validation_mode': "'warn'::text",
  'journey_event_sources.allowed_origins_json': "'[]'::text",
  'journey_event_sources.allowed_bundle_ids_json': "'[]'::text",
  'journey_event_sources.revision': '1',
  'journey_event_credentials.scope': "'events:write'::text",
  'journey_event_credentials.algorithm': "'scrypt-v1'::text",
  'journey_event_credentials.status': "'active'::text",
  'journey_event_schema_versions.state': "'draft'::text",
  'journey_event_schema_versions.properties_json': "'[]'::text",
  'journey_event_schema_versions.compatibility_json': "'{}'::text",
  'journey_event_control_audit_events.detail_json': "'{}'::text"
});
const journeyEventControlPlaneRequiredChecks = Object.freeze({
  journey_event_sources: [
    ['environment', 'development', 'staging', 'production'], ['status', 'active', 'paused', 'revoked'],
    ['validation_mode', 'observe', 'warn', 'enforce'], ['events_per_minute', '>= 1', '<= 10000000'],
    ['bytes_per_minute', '>= 1', '10000000000'], ['allowed_origins_json', 'jsonb_typeof', 'array'],
    ['allowed_bundle_ids_json', 'jsonb_typeof', 'array'], ['intent_hash', '^[a-f0-9]{64}$']
  ],
  journey_event_credentials: [
    ['environment', 'development', 'staging', 'production'], ['kind', 'public_write', 'server_secret'],
    ['scope', 'events:write'], ['algorithm', 'scrypt-v1'], ['digest', '^[a-f0-9]{64}$'],
    ['status', 'active', 'overlap', 'revoked'], ['rotated_from_id', '<>', 'id'], ['status', 'revoked_at'],
    ['status', 'overlap', 'expires_at']
  ],
  journey_event_schemas: [
    ['event_name', '^[a-z][a-z0-9_]{0,127}$'], ['intent_hash', '^[a-f0-9]{64}$']
  ],
  journey_event_schema_versions: [
    ['version', '^[0-9]+\\.[0-9]+$'], ['version_major', '>= 0'], ['version_minor', '>= 0'],
    ['state', 'draft', 'published', 'deprecated', 'retired'], ['version_major', "'.'::text", 'version_minor'],
    ['properties_json', 'jsonb_typeof', 'array'], ['compatibility_json', 'jsonb_typeof', 'object'],
    ['content_sha256', '^[a-f0-9]{64}$'], ['state', 'published_at', 'deprecated_at']
  ],
  journey_event_control_audit_events: [
    ['action', 'source.created', 'schema.deprecated'], ['target_type', 'source', 'schema_version'],
    ['detail_json', 'jsonb_typeof', 'object'], ['before_fingerprint', '^[a-f0-9]{64}$'],
    ['after_fingerprint', '^[a-f0-9]{64}$']
  ]
});
const journeyEventControlPlaneRequiredConstraints = Object.freeze({
  journey_event_credentials_source_tenant_environment_fk: [
    'foreign key (source_id, space_id, environment)',
    'references journey_event_sources(id, space_id, environment)', 'on delete cascade'
  ],
  journey_event_schemas_source_tenant_fk: [
    'foreign key (source_id, space_id)', 'references journey_event_sources(id, space_id)', 'on delete cascade'
  ],
  journey_event_schema_versions_schema_tenant_source_fk: [
    'foreign key (schema_id, source_id, space_id)',
    'references journey_event_schemas(id, source_id, space_id)', 'on delete cascade'
  ]
});
const journeyEventControlPlaneRequiredTriggers = Object.freeze({
  journey_event_credential_rotation_guard_trigger: ['journey_event_credentials', 'journey_event_credential_rotation_guard'],
  journey_event_schema_version_immutable_guard_trigger: ['journey_event_schema_versions', 'journey_event_schema_version_immutable_guard'],
  journey_event_control_audit_tenant_guard_trigger: ['journey_event_control_audit_events', 'journey_event_control_audit_tenant_guard']
});

export const journeyEventControlPlaneRuntimeContract = Object.freeze({
  columns: journeyEventControlPlaneExactColumns,
  primaryKeys: journeyEventControlPlanePrimaryKeys,
  foreignKeys: journeyEventControlPlaneRequiredForeignKeys,
  indexes: journeyEventControlPlaneRequiredIndexes,
  defaults: journeyEventControlPlaneRequiredDefaults,
  checks: journeyEventControlPlaneRequiredChecks,
  constraints: journeyEventControlPlaneRequiredConstraints,
  triggers: journeyEventControlPlaneRequiredTriggers
});

/** Runtime schema 17: immutable, partitioned event facts/attempt receipts plus
 * an unpartitioned global dedupe registry and mutable lease/DLQ state. JSONB is
 * bounded but deliberately absent from B-tree index contracts. */
const journeyEventDataPlaneExactColumns = Object.freeze({
  journey_raw_events: [
    ['received_at', 'timestamp with time zone', false], ['id', 'text', false],
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['credential_id', 'text', false], ['event_id', 'text', false], ['protocol_version', 'text', false],
    ['event_call', 'text', false], ['event_name', 'text', true], ['event_version', 'integer', true],
    ['occurred_at', 'timestamp with time zone', false], ['sent_at', 'timestamp with time zone', true],
    ['schema_version_id', 'text', true], ['anonymous_id_hash', 'text', true], ['user_id_hash', 'text', true],
    ['account_id_hash', 'text', true], ['session_id_hash', 'text', true], ['channel', 'text', false],
    ['consent_state', 'text', false], ['ingest_state', 'text', false], ['payload_json', 'jsonb', false],
    ['context_json', 'jsonb', false], ['consent_json', 'jsonb', false],
    ['validation_issues_json', 'jsonb', false], ['envelope_sha256', 'text', false],
    ['payload_bytes', 'integer', false], ['sdk_name', 'text', true], ['sdk_version', 'text', true],
    ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_ingest_receipts: [
    ['received_at', 'timestamp with time zone', false], ['id', 'text', false],
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['event_id', 'text', true], ['envelope_sha256', 'text', true], ['raw_event_id', 'text', true],
    ['raw_received_at', 'timestamp with time zone', true], ['outcome', 'text', false],
    ['http_status', 'integer', false], ['error_code', 'text', true], ['request_id', 'text', false],
    ['batch_id', 'text', true], ['attempt_ordinal', 'integer', false],
    ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_deduplication: [
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['event_id', 'text', false], ['envelope_sha256', 'text', false], ['raw_event_id', 'text', false],
    ['raw_received_at', 'timestamp with time zone', false], ['ingest_receipt_id', 'text', false],
    ['first_outcome', 'text', false], ['first_http_status', 'integer', false],
    ['first_result_code', 'text', true], ['first_result_json', 'jsonb', false],
    ['created_at', 'timestamp with time zone', false], ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_rejections: [
    ['id', 'text', false], ['space_id', 'text', false], ['source_id', 'text', false],
    ['environment', 'text', false], ['event_id', 'text', true], ['ingest_receipt_id', 'text', true],
    ['ingest_received_at', 'timestamp with time zone', true], ['code', 'text', false],
    ['field_path', 'text', true], ['redacted_detail_json', 'jsonb', false], ['payload_sha256', 'text', true],
    ['payload_bytes', 'integer', false], ['replay_eligible', 'boolean', false],
    ['created_at', 'timestamp with time zone', false], ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_rate_buckets: [
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['window_started_at', 'timestamp with time zone', false], ['event_count', 'bigint', false],
    ['byte_count', 'bigint', false], ['updated_at', 'timestamp with time zone', false]
  ],
  journey_event_processing_inbox: [
    ['raw_received_at', 'timestamp with time zone', false], ['raw_event_id', 'text', false],
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['event_id', 'text', false], ['processor', 'text', false], ['state', 'text', false],
    ['available_at', 'timestamp with time zone', false], ['lease_owner', 'text', true],
    ['lease_token', 'text', true], ['lease_generation', 'integer', false],
    ['lease_expires_at', 'timestamp with time zone', true], ['attempt_count', 'integer', false],
    ['last_error_code', 'text', true], ['updated_at', 'timestamp with time zone', false]
  ],
  journey_event_processing_receipts: [
    ['attempted_at', 'timestamp with time zone', false], ['id', 'text', false],
    ['raw_received_at', 'timestamp with time zone', false], ['raw_event_id', 'text', false],
    ['space_id', 'text', false], ['source_id', 'text', false], ['environment', 'text', false],
    ['event_id', 'text', false], ['processor', 'text', false], ['processor_version', 'text', false],
    ['attempt_number', 'integer', false], ['status', 'text', false], ['lease_token', 'text', true],
    ['lease_generation', 'integer', false], ['checkpoint', 'text', true], ['error_code', 'text', true],
    ['error_detail_json', 'jsonb', false], ['completed_at', 'timestamp with time zone', false],
    ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_dead_letters: [
    ['id', 'text', false], ['raw_received_at', 'timestamp with time zone', false],
    ['raw_event_id', 'text', false], ['space_id', 'text', false], ['source_id', 'text', false],
    ['environment', 'text', false], ['event_id', 'text', false], ['processor', 'text', false],
    ['state', 'text', false], ['failure_code', 'text', false], ['redacted_detail_json', 'jsonb', false],
    ['attempt_count', 'integer', false], ['replay_eligible', 'boolean', false],
    ['replay_after', 'timestamp with time zone', true], ['last_processing_receipt_id', 'text', true],
    ['last_processing_attempted_at', 'timestamp with time zone', true],
    ['resolved_at', 'timestamp with time zone', true], ['resolution_code', 'text', true],
    ['updated_at', 'timestamp with time zone', false], ['retention_expires_at', 'timestamp with time zone', false]
  ],
  journey_event_data_audit: [
    ['id', 'text', false], ['space_id', 'text', false], ['source_id', 'text', false],
    ['environment', 'text', false], ['action', 'text', false], ['target_type', 'text', false],
    ['target_id', 'text', false], ['actor_user_id', 'text', true], ['detail_json', 'jsonb', false],
    ['created_at', 'timestamp with time zone', false], ['retention_expires_at', 'timestamp with time zone', false]
  ]
});
const journeyEventDataPlanePrimaryKeys = Object.freeze({
  journey_raw_events: ['received_at','id'],
  journey_event_ingest_receipts: ['received_at','id'],
  journey_event_deduplication: ['space_id','source_id','event_id'],
  journey_event_rejections: ['id'],
  journey_event_rate_buckets: ['space_id','source_id','environment','window_started_at'],
  journey_event_processing_inbox: ['raw_received_at','raw_event_id','processor'],
  journey_event_processing_receipts: ['attempted_at','id'],
  journey_event_dead_letters: ['id'],
  journey_event_data_audit: ['id']
});
const journeyEventDataPlaneRequiredForeignKeys = Object.freeze([
  ['journey_raw_events','space_id','spaces','id','c'],
  ['journey_raw_events','source_id','journey_event_sources','id','c'],
  ['journey_raw_events','credential_id','journey_event_credentials','id','r'],
  ['journey_raw_events','schema_version_id','journey_event_schema_versions','id','r'],
  ['journey_event_ingest_receipts','space_id','spaces','id','c'],
  ['journey_event_ingest_receipts','source_id','journey_event_sources','id','c'],
  ['journey_event_ingest_receipts','raw_event_id','journey_raw_events','id','r'],
  ['journey_event_deduplication','space_id','spaces','id','c'],
  ['journey_event_deduplication','source_id','journey_event_sources','id','c'],
  ['journey_event_deduplication','raw_event_id','journey_raw_events','id','r'],
  ['journey_event_deduplication','ingest_receipt_id','journey_event_ingest_receipts','id','r'],
  ['journey_event_rejections','space_id','spaces','id','c'],
  ['journey_event_rejections','source_id','journey_event_sources','id','c'],
  ['journey_event_rejections','ingest_receipt_id','journey_event_ingest_receipts','id','r'],
  ['journey_event_rate_buckets','space_id','spaces','id','c'],
  ['journey_event_rate_buckets','source_id','journey_event_sources','id','c'],
  ['journey_event_processing_inbox','space_id','spaces','id','c'],
  ['journey_event_processing_inbox','source_id','journey_event_sources','id','c'],
  ['journey_event_processing_inbox','raw_event_id','journey_raw_events','id','r'],
  ['journey_event_processing_receipts','space_id','spaces','id','c'],
  ['journey_event_processing_receipts','source_id','journey_event_sources','id','c'],
  ['journey_event_processing_receipts','raw_event_id','journey_event_processing_inbox','raw_event_id','r'],
  ['journey_event_dead_letters','space_id','spaces','id','c'],
  ['journey_event_dead_letters','source_id','journey_event_sources','id','c'],
  ['journey_event_dead_letters','raw_event_id','journey_raw_events','id','r'],
  ['journey_event_dead_letters','last_processing_receipt_id','journey_event_processing_receipts','id','r'],
  ['journey_event_data_audit','space_id','spaces','id','c'],
  ['journey_event_data_audit','source_id','journey_event_sources','id','c'],
  ['journey_event_data_audit','actor_user_id','users','id','n']
]);
const journeyEventDataPlaneRequiredIndexes = Object.freeze({
  journey_event_credentials_tenant_source_environment_identity: ['create unique index','(id, source_id, space_id, environment)'],
  journey_event_schema_versions_tenant_source_identity: ['create unique index','(id, source_id, space_id)'],
  journey_raw_events_source_received: ['(space_id, source_id, environment, received_at desc, id)'],
  journey_raw_events_event_time: ['(space_id, event_name, occurred_at desc, id)','where (event_name is not null)'],
  journey_raw_events_retention: ['(retention_expires_at, received_at, id)'],
  journey_event_ingest_receipts_source_received: ['(space_id, source_id, environment, received_at desc, id)'],
  journey_event_ingest_receipts_event_history: ['(space_id, source_id, event_id, received_at desc, id)','where (event_id is not null)'],
  journey_event_ingest_receipts_retention: ['(retention_expires_at, received_at, id)'],
  journey_event_deduplication_retention: ['(retention_expires_at, space_id, source_id, event_id)'],
  journey_event_rejections_source_history: ['(space_id, source_id, environment, created_at desc, id)'],
  journey_event_rejections_retention: ['(retention_expires_at, created_at, id)'],
  journey_event_rate_buckets_expiry: ['(window_started_at, space_id, source_id)'],
  journey_event_processing_inbox_claim: ['(state, available_at, lease_expires_at, space_id, source_id, raw_received_at, raw_event_id)'],
  journey_event_processing_inbox_source: ['(space_id, source_id, environment, updated_at desc, raw_event_id)'],
  journey_event_processing_receipts_event_history: ['(space_id, source_id, raw_received_at, raw_event_id, processor, attempt_number, attempted_at, id)'],
  journey_event_processing_receipts_retention: ['(retention_expires_at, attempted_at, id)'],
  journey_event_dead_letters_queue: ['(space_id, state, replay_eligible, replay_after, updated_at desc, id)'],
  journey_event_dead_letters_source: ['(space_id, source_id, environment, updated_at desc, id)'],
  journey_event_dead_letters_retention: ['(retention_expires_at, updated_at, id)'],
  journey_event_data_audit_space_history: ['(space_id, created_at desc, id)'],
  journey_event_data_audit_source_history: ['(space_id, source_id, environment, created_at desc, id)'],
  journey_event_data_audit_retention: ['(retention_expires_at, created_at, id)']
});
const journeyEventDataPlaneRequiredDefaults = Object.freeze({
  'journey_raw_events.context_json': "'{}'::jsonb",
  'journey_raw_events.consent_json': "'{}'::jsonb",
  'journey_raw_events.validation_issues_json': "'[]'::jsonb",
  'journey_event_ingest_receipts.attempt_ordinal': '1',
  'journey_event_deduplication.first_result_json': "'{}'::jsonb",
  'journey_event_rejections.redacted_detail_json': "'{}'::jsonb",
  'journey_event_rejections.replay_eligible': 'false',
  'journey_event_rate_buckets.event_count': '0',
  'journey_event_rate_buckets.byte_count': '0',
  'journey_event_processing_inbox.processor': "'connected_journey_v1'::text",
  'journey_event_processing_inbox.state': "'pending'::text",
  'journey_event_processing_inbox.lease_generation': '0',
  'journey_event_processing_inbox.attempt_count': '0',
  'journey_event_processing_receipts.error_detail_json': "'{}'::jsonb",
  'journey_event_dead_letters.state': "'pending'::text",
  'journey_event_dead_letters.redacted_detail_json': "'{}'::jsonb",
  'journey_event_dead_letters.replay_eligible': 'false',
  'journey_event_data_audit.detail_json': "'{}'::jsonb"
});
const journeyEventDataPlaneRequiredChecks = Object.freeze({
  journey_raw_events: [
    ['environment','development','staging','production'],
    ['protocol_version','1.0'], ['event_call','track','identify','alias','group','page','screen','consent','metric'],
    ['channel','web','server','ios','android','react_native','webhook','connector','import','unknown'],
    ['consent_state','unknown','granted','denied','partial','not_required'],
    ['ingest_state','accepted','quarantined'], ['ingest_state','quarantined','jsonb_array_length','> 0'],
    ['event_call','track','metric','event_name','event_version'], ['payload_json','jsonb_typeof','object'],
    ['validation_issues_json','jsonb_typeof','array'], ['retention_expires_at','received_at']
  ],
  journey_event_ingest_receipts: [
    ['outcome','accepted','quarantined','duplicate','content_conflict','rejected','rate_limited','over_quota','consent_denied'],
    ['http_status','200','202','400','401','403','409','413','422','429'], ['retention_expires_at','received_at']
  ],
  journey_event_deduplication: [
    ['first_outcome','accepted','quarantined'], ['first_http_status','= 202'],
    ['first_result_json','jsonb_typeof','object'], ['retention_expires_at','created_at']
  ],
  journey_event_rejections: [
    ['payload_bytes','>= 0','<= 2097152'],
    ['redacted_detail_json','jsonb_typeof','object'], ['retention_expires_at','created_at']
  ],
  journey_event_rate_buckets: [
    ['event_count','>= 0'], ['byte_count','>= 0'], ['date_trunc','minute','window_started_at']
  ],
  journey_event_processing_inbox: [
    ['state','pending','leased','retry_wait','dead_lettered','completed'],
    ['lease_generation','>= 0'], ['attempt_count','>= 0','<= 10000'], ['lease_owner','lease_token','lease_expires_at']
  ],
  journey_event_processing_receipts: [
    ['status','succeeded','retryable_failed','terminal_failed','lease_expired'],
    ['lease_generation','>= 1'], ['error_detail_json','jsonb_typeof','object'],
    ['completed_at','attempted_at'], ['retention_expires_at','completed_at']
  ],
  journey_event_dead_letters: [
    ['state','pending','replay_scheduled','resolved','terminal'], ['attempt_count','>= 1','<= 10000'],
    ['redacted_detail_json','jsonb_typeof','object'], ['replay_eligible','replay_after','resolved_at','resolution_code'],
    ['retention_expires_at','updated_at']
  ],
  journey_event_data_audit: [
    ['action','debug.viewed','rejection.viewed','dead_letter.viewed','dead_letter.replay_requested','dead_letter.resolved','event.redacted'],
    ['target_type','raw_event','ingest_receipt','rejection','dead_letter','processing_receipt'],
    ['detail_json','jsonb_typeof','object'], ['retention_expires_at','created_at']
  ]
});
const journeyEventDataPlaneRequiredConstraints = Object.freeze({
  journey_raw_events_source_tenant_environment_fk: ['foreign key (source_id, space_id, environment)','references journey_event_sources(id, space_id, environment)','on delete cascade'],
  journey_raw_events_credential_tenant_source_environment_fk: ['foreign key (credential_id, source_id, space_id, environment)','references journey_event_credentials(id, source_id, space_id, environment)','on delete restrict'],
  journey_raw_events_schema_version_tenant_source_fk: ['foreign key (schema_version_id, source_id, space_id)','references journey_event_schema_versions(id, source_id, space_id)','on delete restrict'],
  journey_event_ingest_receipts_raw_event_fk: ['foreign key (raw_received_at, raw_event_id, space_id, source_id, environment, event_id)','references journey_raw_events(received_at, id, space_id, source_id, environment, event_id)','deferrable initially deferred'],
  journey_event_deduplication_raw_event_fk: ['foreign key (raw_received_at, raw_event_id, space_id, source_id, environment, event_id)','references journey_raw_events(received_at, id, space_id, source_id, environment, event_id)','deferrable initially deferred'],
  journey_event_deduplication_receipt_fk: ['foreign key (raw_received_at, ingest_receipt_id, space_id, source_id, environment, event_id)','references journey_event_ingest_receipts(received_at, id, space_id, source_id, environment, event_id)','deferrable initially deferred'],
  journey_event_processing_inbox_raw_event_fk: ['foreign key (raw_received_at, raw_event_id, space_id, source_id, environment, event_id)','references journey_raw_events(received_at, id, space_id, source_id, environment, event_id)'],
  journey_event_processing_receipts_inbox_fk: ['foreign key (raw_received_at, raw_event_id, space_id, source_id, environment, event_id, processor)','references journey_event_processing_inbox(raw_received_at, raw_event_id, space_id, source_id, environment, event_id, processor)'],
  journey_event_dead_letters_last_processing_receipt_fk: ['foreign key (last_processing_attempted_at, last_processing_receipt_id, raw_received_at, raw_event_id, space_id, source_id, environment, event_id, processor)','references journey_event_processing_receipts(attempted_at, id, raw_received_at, raw_event_id, space_id, source_id, environment, event_id, processor)','deferrable initially deferred'],
  journey_event_data_audit_source_tenant_environment_fk: ['foreign key (source_id, space_id, environment)','references journey_event_sources(id, space_id, environment)','on delete cascade']
});
const journeyEventDataPlaneRequiredTriggers = Object.freeze({
  journey_raw_events_append_only_trigger: ['journey_raw_events','journey_event_append_only_guard'],
  journey_event_ingest_receipts_append_only_trigger: ['journey_event_ingest_receipts','journey_event_append_only_guard'],
  journey_event_deduplication_append_only_trigger: ['journey_event_deduplication','journey_event_append_only_guard'],
  journey_event_rejections_append_only_trigger: ['journey_event_rejections','journey_event_append_only_guard'],
  journey_event_processing_receipts_append_only_trigger: ['journey_event_processing_receipts','journey_event_append_only_guard'],
  journey_event_data_audit_append_only_trigger: ['journey_event_data_audit','journey_event_append_only_guard']
});
const journeyEventDataPlanePartitions = Object.freeze({
  journey_raw_events: ['journey_raw_events_2026_08','journey_raw_events_default'],
  journey_event_ingest_receipts: ['journey_event_ingest_receipts_2026_08','journey_event_ingest_receipts_default'],
  journey_event_processing_receipts: ['journey_event_processing_receipts_2026_08','journey_event_processing_receipts_default']
});

export const journeyEventDataPlaneRuntimeContract = Object.freeze({
  columns: journeyEventDataPlaneExactColumns,
  primaryKeys: journeyEventDataPlanePrimaryKeys,
  foreignKeys: journeyEventDataPlaneRequiredForeignKeys,
  indexes: journeyEventDataPlaneRequiredIndexes,
  defaults: journeyEventDataPlaneRequiredDefaults,
  checks: journeyEventDataPlaneRequiredChecks,
  constraints: journeyEventDataPlaneRequiredConstraints,
  triggers: journeyEventDataPlaneRequiredTriggers,
  partitions: journeyEventDataPlanePartitions
});

const journeyStageProcessingExactColumns = Object.freeze({
  journey_stage_rule_definitions: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],['name','text',false],
    ['revision','integer',false],['draft_version_id','text',true],['published_version_id','text',true],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_stage_rule_versions: [
    ['id','text',false],['rule_definition_id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['journey_map_version_id','text',false],['stage_key','text',false],['version_number','integer',false],['state','text',false],
    ['role','text',false],['priority','integer',false],['event_name','text',false],['source_ids_json','jsonb',false],
    ['environments_json','jsonb',false],['predicates_json','jsonb',false],['required_prior_events_json','jsonb',false],
    ['excluded_event_names_json','jsonb',false],['effective_at','timestamp with time zone',true],
    ['expires_at','timestamp with time zone',true],['revision','integer',false],['content_sha256','text',false],
    ['created_by_user_id','text',true],['published_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false],['published_at','timestamp with time zone',true]
  ],
  journey_stage_rule_decisions: [
    ['id','text',false],['decision_key','text',false],['raw_received_at','timestamp with time zone',false],
    ['raw_event_id','text',false],['space_id','text',false],['source_id','text',false],['environment','text',false],
    ['event_id','text',false],['journey_definition_id','text',false],['journey_map_version_id','text',false],
    ['subject_kind','text',true],['anonymous_id_hash','text',true],['outcome','text',false],
    ['matched_rule_definition_id','text',true],['matched_rule_version_id','text',true],
    ['matched_rule_version_number','integer',true],['stage_key','text',true],['role','text',true],
    ['event_occurred_at','timestamp with time zone',false],['evaluated_at','timestamp with time zone',false],
    ['is_late','boolean',false],['is_out_of_order','boolean',false],['rule_set_sha256','text',false],
    ['trace_json','jsonb',false],['provenance_json','jsonb',false],['processor','text',false],
    ['processor_version','text',false],['lease_generation','integer',false],['created_at','timestamp with time zone',false],
    ['retention_expires_at','timestamp with time zone',false]
  ],
  journey_anonymous_instances: [
    ['id','text',false],['space_id','text',false],['source_id','text',false],['environment','text',false],
    ['journey_definition_id','text',false],['subject_kind','text',false],['anonymous_id_hash','text',false],
    ['state','text',false],['current_stage_key','text',true],['first_event_at','timestamp with time zone',false],
    ['latest_event_at','timestamp with time zone',false],['latest_event_id','text',false],['latest_visit_id','text',true],
    ['revision','integer',false],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_anonymous_stage_visits: [
    ['id','text',false],['assignment_key','text',false],['instance_id','text',false],['decision_id','text',false],
    ['raw_received_at','timestamp with time zone',false],['raw_event_id','text',false],['space_id','text',false],
    ['source_id','text',false],['environment','text',false],['event_id','text',false],
    ['journey_definition_id','text',false],['journey_map_version_id','text',false],['subject_kind','text',false],
    ['stage_key','text',false],['role','text',false],['rule_definition_id','text',false],['rule_version_id','text',false],
    ['rule_version_number','integer',false],['event_occurred_at','timestamp with time zone',false],
    ['visited_at','timestamp with time zone',false],['is_late','boolean',false],['is_out_of_order','boolean',false],
    ['applied_to_current','boolean',false],['non_application_reason','text',true],['prior_stage_key','text',true],
    ['provenance_json','jsonb',false],['created_at','timestamp with time zone',false],
    ['retention_expires_at','timestamp with time zone',false]
  ],
  journey_stage_rule_audit_events: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['rule_definition_id','text',true],['rule_version_id','text',true],['actor_user_id','text',true],
    ['action','text',false],['detail_json','jsonb',false],['created_at','timestamp with time zone',false]
  ]
});
const journeyStageProcessingPrimaryKeys = Object.freeze(Object.fromEntries(
  Object.keys(journeyStageProcessingExactColumns).map((table) => [table,['id']])
));
const journeyStageProcessingRequiredForeignKeys = Object.freeze([
  ['journey_stage_rule_definitions','space_id','spaces','id','c'],
  ['journey_stage_rule_definitions','journey_definition_id','journey_definitions','id','c'],
  ['journey_stage_rule_versions','space_id','spaces','id','c'],
  ['journey_stage_rule_versions','rule_definition_id','journey_stage_rule_definitions','id','c'],
  ['journey_stage_rule_versions','journey_map_version_id','journey_map_versions','id','r'],
  ['journey_stage_rule_decisions','space_id','spaces','id','c'],
  ['journey_stage_rule_decisions','raw_event_id','journey_raw_events','id','r'],
  ['journey_anonymous_instances','space_id','spaces','id','c'],
  ['journey_anonymous_instances','source_id','journey_event_sources','id','c'],
  ['journey_anonymous_instances','journey_definition_id','journey_definitions','id','c'],
  ['journey_anonymous_stage_visits','space_id','spaces','id','c'],
  ['journey_anonymous_stage_visits','instance_id','journey_anonymous_instances','id','r'],
  ['journey_anonymous_stage_visits','decision_id','journey_stage_rule_decisions','id','r'],
  ['journey_anonymous_stage_visits','raw_event_id','journey_raw_events','id','r'],
  ['journey_stage_rule_audit_events','space_id','spaces','id','c'],
  ['journey_stage_rule_audit_events','journey_definition_id','journey_definitions','id','c']
]);
const journeyStageProcessingRequiredIndexes = Object.freeze({
  journey_definitions_tenant_identity: ['create unique index','(id, space_id)'],
  journey_map_versions_tenant_definition_identity: ['create unique index','(id, definition_id, space_id)'],
  journey_map_stages_tenant_version_key: ['create unique index','(version_id, stage_key, space_id)'],
  journey_stage_rule_definitions_journey: ['(space_id, journey_definition_id, updated_at desc, id)'],
  journey_stage_rule_versions_one_draft: ['create unique index','(rule_definition_id)','where (state =','draft'],
  journey_stage_rule_versions_one_published: ['create unique index','(rule_definition_id)','where (state =','published'],
  journey_stage_rule_versions_runtime: ['(space_id, event_name, state, journey_definition_id, priority desc, id)'],
  journey_stage_rule_decisions_explain: ['(space_id, journey_definition_id, evaluated_at desc, id)'],
  journey_stage_rule_decisions_raw: ['(space_id, source_id, raw_received_at, raw_event_id)'],
  journey_anonymous_instances_journey: ['(space_id, journey_definition_id, updated_at desc, id)'],
  journey_anonymous_stage_visits_timeline: ['(space_id, journey_definition_id, instance_id, event_occurred_at, id)'],
  journey_stage_rule_audit_history: ['(space_id, journey_definition_id, created_at desc, id)']
});
const journeyStageProcessingRequiredDefaults = Object.freeze({
  'journey_stage_rule_definitions.revision':'1',
  'journey_stage_rule_versions.source_ids_json':"'[]'::jsonb",
  'journey_stage_rule_versions.environments_json':"'[]'::jsonb",
  'journey_stage_rule_versions.predicates_json':"'[]'::jsonb",
  'journey_stage_rule_versions.required_prior_events_json':"'[]'::jsonb",
  'journey_stage_rule_versions.excluded_event_names_json':"'[]'::jsonb",
  'journey_stage_rule_versions.revision':'1',
  'journey_stage_rule_decisions.is_late':'false','journey_stage_rule_decisions.is_out_of_order':'false',
  'journey_anonymous_instances.subject_kind':"'anonymous'::text",'journey_anonymous_instances.revision':'1',
  'journey_anonymous_stage_visits.subject_kind':"'anonymous'::text",
  'journey_anonymous_stage_visits.is_late':'false','journey_anonymous_stage_visits.is_out_of_order':'false',
  'journey_stage_rule_audit_events.detail_json':"'{}'::jsonb"
});
const journeyStageProcessingRequiredChecks = Object.freeze({
  journey_stage_rule_versions: [['state','draft','published','retired'],['role','entry','progress','success','failure','exit'],
    ['predicates_json','jsonb_typeof','array'],['expires_at','effective_at']],
  journey_stage_rule_decisions: [['outcome','matched','no_match','skipped_no_anonymous_subject'],
    ['subject_kind','anonymous'],['trace_json','jsonb_typeof','object'],['retention_expires_at','created_at']],
  journey_anonymous_instances: [['subject_kind','anonymous'],['state','active','succeeded','failed','exited'],
    ['latest_event_at','first_event_at'],['latest_visit_id','current_stage_key']],
  journey_anonymous_stage_visits: [['role','entry','progress','success','failure','exit'],
    ['non_application_reason','out_of_order','terminal_absorbing'],['applied_to_current','non_application_reason'],
    ['provenance_json','jsonb_typeof','object'],['retention_expires_at','created_at']],
  journey_stage_rule_audit_events: [['action','rule.created','rule.draft_updated','rule.published','rule.retired','rule.simulated','decision.viewed'],
    ['detail_json','jsonb_typeof','object']]
});
const journeyStageProcessingRequiredConstraints = Object.freeze({
  journey_stage_rule_versions_definition_tenant_fk: ['foreign key (rule_definition_id, space_id, journey_definition_id)',
    'references journey_stage_rule_definitions(id, space_id, journey_definition_id)','on delete cascade'],
  journey_stage_rule_versions_stage_tenant_fk: ['foreign key (journey_map_version_id, stage_key, space_id)',
    'references journey_map_stages(version_id, stage_key, space_id)','on delete restrict'],
  journey_stage_rule_decisions_rule_tenant_fk: ['foreign key (matched_rule_version_id, matched_rule_definition_id, space_id, journey_definition_id, journey_map_version_id, stage_key)',
    'references journey_stage_rule_versions(id, rule_definition_id, space_id, journey_definition_id, journey_map_version_id, stage_key)','on delete restrict'],
  journey_anonymous_instances_latest_visit_fk: ['foreign key (latest_visit_id, id, space_id, source_id, environment, journey_definition_id, current_stage_key)',
    'references journey_anonymous_stage_visits(id, instance_id, space_id, source_id, environment, journey_definition_id, stage_key)','deferrable initially deferred'],
  journey_anonymous_stage_visits_decision_tenant_fk: ['foreign key (decision_id, space_id, source_id, environment, journey_definition_id, raw_received_at, raw_event_id)',
    'references journey_stage_rule_decisions(id, space_id, source_id, environment, journey_definition_id, raw_received_at, raw_event_id)','on delete restrict'],
  journey_anonymous_stage_visits_rule_tenant_fk: ['foreign key (rule_version_id, rule_definition_id, space_id, journey_definition_id, journey_map_version_id, stage_key)',
    'references journey_stage_rule_versions(id, rule_definition_id, space_id, journey_definition_id, journey_map_version_id, stage_key)','on delete restrict']
});
const journeyStageProcessingRequiredTriggers = Object.freeze({
  journey_stage_rule_version_guard_trigger: ['journey_stage_rule_versions','journey_stage_rule_version_guard'],
  journey_stage_rule_decisions_append_only_trigger: ['journey_stage_rule_decisions','journey_event_append_only_guard'],
  journey_anonymous_stage_visits_append_only_trigger: ['journey_anonymous_stage_visits','journey_event_append_only_guard'],
  journey_stage_rule_audit_append_only_trigger: ['journey_stage_rule_audit_events','journey_event_append_only_guard']
});

export const journeyStageProcessingRuntimeContract = Object.freeze({
  columns: journeyStageProcessingExactColumns, primaryKeys: journeyStageProcessingPrimaryKeys,
  foreignKeys: journeyStageProcessingRequiredForeignKeys, indexes: journeyStageProcessingRequiredIndexes,
  defaults: journeyStageProcessingRequiredDefaults, checks: journeyStageProcessingRequiredChecks,
  constraints: journeyStageProcessingRequiredConstraints, triggers: journeyStageProcessingRequiredTriggers
});

/** Runtime schema 19: bounded Journey Research Hub control plane. */
const journeyResearchHubExactColumns = Object.freeze({
  journey_research_sources: [
    ['id','text',false],['space_id','text',false],['source_type','text',false],['source_ref','text',false],
    ['adapter','text',false],['owner_user_id','text',true],['state','text',false],['revision','integer',false],
    ['last_resolved_at','timestamp with time zone',true],['last_error_code','text',true],['idempotency_key','text',true],
    ['intent_sha256','text',false],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_research_snapshots: [
    ['id','text',false],['source_id','text',false],['space_id','text',false],['version_number','integer',false],
    ['fingerprint','text',false],['access_state','text',false],['source_label','text',false],['excerpt','text',false],
    ['population','text',false],['sample_size','bigint',true],['collected_at','timestamp with time zone',true],
    ['window_start','timestamp with time zone',true],['window_end','timestamp with time zone',true],
    ['source_updated_at','timestamp with time zone',true],['metadata_json','jsonb',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['retention_expires_at','timestamp with time zone',false]
  ],
  journey_research_links: [
    ['id','text',false],['space_id','text',false],['source_id','text',false],['snapshot_id','text',false],
    ['target_type','text',false],['target_id','text',false],['state','text',false],['revision','integer',false],
    ['idempotency_key','text',true],['intent_sha256','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_research_assessments: [
    ['id','text',false],['link_id','text',false],['space_id','text',false],['revision','integer',false],
    ['relationship','text',false],['classification','text',false],['confidence','numeric',false],
    ['freshness_days','integer',true],['reason_summary','text',false],['reason_sha256','text',false],
    ['reviewer_user_id','text',true],['method','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_research_gaps: [
    ['id','text',false],['space_id','text',false],['target_type','text',false],['target_id','text',false],
    ['title','text',false],['description','text',false],['priority','text',false],['status','text',false],
    ['owner_user_id','text',true],['resolution_link_id','text',true],['revision','integer',false],
    ['idempotency_key','text',true],['intent_sha256','text',false],['due_at','timestamp with time zone',true],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_research_intakes: [
    ['id','text',false],['space_id','text',false],['source_id','text',false],['knowledge_base_id','text',false],
    ['knowledge_document_id','text',false],['intake_kind','text',false],['method','text',false],
    ['conducted_at','timestamp with time zone',true],['population','text',false],['tags_json','jsonb',false],
    ['consent_basis','text',false],['researcher_user_id','text',true],['retention_expires_at','timestamp with time zone',false],
    ['idempotency_key','text',false],['intent_sha256','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_research_monitors: [
    ['id','text',false],['space_id','text',false],['source_id','text',false],['owner_user_id','text',false],
    ['state','text',false],['interval_seconds','integer',false],['next_run_at','timestamp with time zone',false],
    ['last_run_at','timestamp with time zone',true],['revision','integer',false],['idempotency_key','text',true],
    ['intent_sha256','text',false],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_research_refresh_runs: [
    ['id','text',false],['space_id','text',false],['source_id','text',false],['monitor_id','text',true],
    ['requested_by_user_id','text',true],['trigger_kind','text',false],['state','text',false],['revision','integer',false],
    ['available_at','timestamp with time zone',false],['lease_owner','text',true],['lease_token','text',true],
    ['lease_generation','integer',false],['lease_expires_at','timestamp with time zone',true],['attempt_count','integer',false],
    ['max_attempts','integer',false],['before_snapshot_id','text',true],['after_snapshot_id','text',true],
    ['changed_fields_json','jsonb',false],['error_code','text',true],['idempotency_key','text',false],
    ['intent_sha256','text',false],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['completed_at','timestamp with time zone',true]
  ],
  journey_research_refresh_attempts: [
    ['id','text',false],['run_id','text',false],['space_id','text',false],['attempt_number','integer',false],
    ['lease_generation','integer',false],['status','text',false],['error_code','text',true],
    ['started_at','timestamp with time zone',false],['completed_at','timestamp with time zone',false]
  ],
  journey_research_notifications: [
    ['id','text',false],['space_id','text',false],['user_id','text',false],['source_id','text',false],
    ['refresh_run_id','text',true],['kind','text',false],['dedupe_key','text',false],['state','text',false],
    ['detail_json','jsonb',false],['revision','integer',false],['created_at','timestamp with time zone',false],
    ['read_at','timestamp with time zone',true]
  ],
  journey_research_audit_events: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_type','text',false],['target_id','text',false],['detail_json','jsonb',false],
    ['created_at','timestamp with time zone',false]
  ]
});
const journeyResearchHubPrimaryKeys = Object.freeze(Object.fromEntries(
  Object.keys(journeyResearchHubExactColumns).map((table) => [table,['id']])
));
const journeyResearchHubRequiredForeignKeys = Object.freeze([
  ...Object.keys(journeyResearchHubExactColumns).map((table) => [table,'space_id','spaces','id','c']),
  ['journey_research_snapshots','source_id','journey_research_sources','id','c'],
  ['journey_research_links','source_id','journey_research_sources','id','c'],
  ['journey_research_links','snapshot_id','journey_research_snapshots','id','r'],
  ['journey_research_assessments','link_id','journey_research_links','id','c'],
  ['journey_research_gaps','resolution_link_id','journey_research_links','id','r'],
  ['journey_research_intakes','source_id','journey_research_sources','id','r'],
  ['journey_research_intakes','knowledge_base_id','knowledge_bases','id','r'],
  ['journey_research_intakes','knowledge_document_id','knowledge_documents','id','r'],
  ['journey_research_monitors','source_id','journey_research_sources','id','c'],
  ['journey_research_refresh_runs','source_id','journey_research_sources','id','c'],
  ['journey_research_refresh_runs','monitor_id','journey_research_monitors','id','c'],
  ['journey_research_refresh_attempts','run_id','journey_research_refresh_runs','id','c'],
  ['journey_research_notifications','source_id','journey_research_sources','id','c'],
  ['journey_research_notifications','refresh_run_id','journey_research_refresh_runs','id','c']
]);
const journeyResearchHubRequiredIndexes = Object.freeze({
  knowledge_documents_research_tenant_identity: ['create unique index','(id, knowledge_base_id, space_id)'],
  journey_research_sources_catalogue: ['(space_id, state, source_type, updated_at desc, id)'],
  journey_research_snapshots_history: ['(space_id, source_id, version_number desc, id)'],
  journey_research_snapshots_retention: ['(retention_expires_at, space_id, source_id, id)'],
  journey_research_links_one_active_source: ['create unique index','(space_id, target_type, target_id, source_id)','where (state =','active'],
  journey_research_links_target: ['(space_id, target_type, target_id, updated_at desc, id)'],
  journey_research_assessments_history: ['(space_id, link_id, revision desc, id)'],
  journey_research_gaps_inbox: ['(space_id, status, priority, updated_at desc, id)'],
  journey_research_intakes_history: ['(space_id, intake_kind, created_at desc, id)'],
  journey_research_monitors_due: ['(state, next_run_at, space_id, id)'],
  journey_research_refresh_runs_claim: ['(state, available_at, lease_expires_at, space_id, id)'],
  journey_research_refresh_runs_source: ['(space_id, source_id, created_at desc, id)'],
  journey_research_refresh_attempts_history: ['(space_id, run_id, attempt_number, id)'],
  journey_research_notifications_inbox: ['(space_id, user_id, state, created_at desc, id)'],
  journey_research_audit_history: ['(space_id, created_at desc, id)']
});
const journeyResearchHubRequiredDefaults = Object.freeze({
  'journey_research_sources.state':"'active'::text",'journey_research_sources.revision':'1',
  'journey_research_snapshots.metadata_json':"'{}'::jsonb",'journey_research_links.state':"'active'::text",
  'journey_research_links.revision':'1','journey_research_assessments.reason_summary':"''::text",
  'journey_research_gaps.description':"''::text",'journey_research_gaps.priority':"'medium'::text",
  'journey_research_gaps.status':"'open'::text",'journey_research_gaps.revision':'1',
  'journey_research_intakes.population':"''::text",'journey_research_intakes.tags_json':"'[]'::jsonb",
  'journey_research_monitors.state':"'active'::text",'journey_research_monitors.revision':'1',
  'journey_research_refresh_runs.state':"'queued'::text",'journey_research_refresh_runs.revision':'1',
  'journey_research_refresh_runs.lease_generation':'0','journey_research_refresh_runs.attempt_count':'0',
  'journey_research_refresh_runs.max_attempts':'3','journey_research_refresh_runs.changed_fields_json':"'[]'::jsonb",
  'journey_research_notifications.state':"'unread'::text",'journey_research_notifications.detail_json':"'{}'::jsonb",
  'journey_research_notifications.revision':'1','journey_research_audit_events.detail_json':"'{}'::jsonb"
});
const journeyResearchHubRequiredChecks = Object.freeze({
  journey_research_sources: [['source_type','knowledge_document','agreement','event_aggregate'],['state','active','inaccessible','deleted']],
  journey_research_snapshots: [['access_state','available','inaccessible','deleted'],['metadata_json','jsonb_typeof','object'],['retention_expires_at','created_at']],
  journey_research_links: [['target_type','definition','stage','card','persona'],['state','active','invalidated']],
  journey_research_assessments: [['relationship','supports','contradicts','neutral'],['classification','strongly_supported','invalidated'],['confidence','0','1']],
  journey_research_gaps: [['priority','low','medium','high','critical'],['status','open','resolved','dismissed']],
  journey_research_intakes: [['intake_kind','interview','observation','research_note'],['consent_basis','documented','not_required'],['tags_json','jsonb_typeof','array']],
  journey_research_monitors: [['state','active','paused'],['interval_seconds','300','2592000']],
  journey_research_refresh_runs: [['trigger_kind','manual','scheduled'],['state','queued','leased','retry_wait','completed','failed'],
    ['state','leased','lease_owner','lease_token','lease_expires_at'],['state','completed','failed','completed_at']],
  journey_research_refresh_attempts: [['status','succeeded','retryable_failed','terminal_failed','lease_expired'],['completed_at','started_at']],
  journey_research_notifications: [['kind','source_changed','refresh_failed'],['state','unread','read','dismissed'],['detail_json','jsonb_typeof','object']],
  journey_research_audit_events: [['action','source.catalogued','refresh.completed','notification.updated'],['detail_json','jsonb_typeof','object']]
});
const journeyResearchHubRequiredConstraints = Object.freeze({
  journey_research_intakes_base_tenant_fk: ['foreign key (knowledge_base_id, space_id)','references knowledge_bases(id, space_id)','on delete restrict'],
  journey_research_intakes_document_base_tenant_fk: ['foreign key (knowledge_document_id, knowledge_base_id, space_id)',
    'references knowledge_documents(id, knowledge_base_id, space_id)','on delete restrict'],
  journey_research_links_snapshot_tenant_fk: ['foreign key (snapshot_id, source_id, space_id)',
    'references journey_research_snapshots(id, source_id, space_id)','on delete restrict'],
  journey_research_refresh_runs_before_snapshot_tenant_fk: ['foreign key (before_snapshot_id, source_id, space_id)',
    'references journey_research_snapshots(id, source_id, space_id)','on delete restrict'],
  journey_research_refresh_runs_after_snapshot_tenant_fk: ['foreign key (after_snapshot_id, source_id, space_id)',
    'references journey_research_snapshots(id, source_id, space_id)','on delete restrict']
});
const journeyResearchHubRequiredTriggers = Object.freeze({
  journey_research_snapshots_append_only_trigger: ['journey_research_snapshots','journey_research_append_only_guard'],
  journey_research_assessments_append_only_trigger: ['journey_research_assessments','journey_research_append_only_guard'],
  journey_research_intakes_append_only_trigger: ['journey_research_intakes','journey_research_append_only_guard'],
  journey_research_refresh_attempts_append_only_trigger: ['journey_research_refresh_attempts','journey_research_append_only_guard'],
  journey_research_audit_append_only_trigger: ['journey_research_audit_events','journey_research_append_only_guard']
});

export const journeyResearchHubRuntimeContract = Object.freeze({
  columns: journeyResearchHubExactColumns, primaryKeys: journeyResearchHubPrimaryKeys,
  foreignKeys: journeyResearchHubRequiredForeignKeys, indexes: journeyResearchHubRequiredIndexes,
  defaults: journeyResearchHubRequiredDefaults, checks: journeyResearchHubRequiredChecks,
  constraints: journeyResearchHubRequiredConstraints, triggers: journeyResearchHubRequiredTriggers
});

/** Runtime schema 20: Journey Map 2.0 progressive rollout controls. */
const journeyV2RolloutExactColumns = Object.freeze({
  journey_v2_rollout_platform: [
    ['id','text',false],['v2_read_enabled','integer',false],['v2_write_enabled','integer',false],
    ['dual_write_enabled','integer',false],['compare_reads_enabled','integer',false],
    ['rollout_percentage','integer',false],['forced_legacy','integer',false],
    ['kill_switch_reference','text',true],['kill_switch_review_at','timestamp with time zone',true],
    ['revision','integer',false],['updated_by_user_id','text',true],['reason','text',false],
    ['effective_at','timestamp with time zone',false],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_v2_rollout_spaces: [
    ['space_id','text',false],['enrollment','text',false],['v2_read_enabled','integer',true],
    ['v2_write_enabled','integer',true],['dual_write_enabled','integer',true],
    ['compare_reads_enabled','integer',true],['rollout_percentage','integer',true],
    ['forced_legacy','integer',false],['kill_switch_reference','text',true],
    ['kill_switch_review_at','timestamp with time zone',true],['revision','integer',false],
    ['updated_by_user_id','text',true],['reason','text',false],
    ['effective_at','timestamp with time zone',false],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_v2_divergences: [
    ['id','text',false],['space_id','text',false],['journey_id','text',true],['definition_id','text',true],
    ['operation','text',false],['served_source','text',false],['legacy_checksum','text',true],
    ['v2_checksum','text',true],['reason_code','text',false],['detail_codes_json','jsonb',false],
    ['request_id','text',true],['created_at','timestamp with time zone',false]
  ]
});
const journeyV2RolloutPrimaryKeys = Object.freeze({
  journey_v2_rollout_platform: ['id'], journey_v2_rollout_spaces: ['space_id'], journey_v2_divergences: ['id']
});
const journeyV2RolloutRequiredForeignKeys = Object.freeze([
  ['journey_v2_rollout_platform','updated_by_user_id','users','id','n'],
  ['journey_v2_rollout_spaces','space_id','spaces','id','c'],
  ['journey_v2_rollout_spaces','updated_by_user_id','users','id','n'],
  ['journey_v2_divergences','space_id','spaces','id','c']
]);
const journeyV2RolloutRequiredIndexes = Object.freeze({
  journey_v2_rollout_spaces_enrollment: ['(enrollment, forced_legacy, updated_at desc, space_id)'],
  journey_v2_divergences_space_created: ['(space_id, created_at desc, id desc)']
});
const journeyV2RolloutRequiredDefaults = Object.freeze({
  'journey_v2_rollout_platform.reason': "''::text",
  'journey_v2_rollout_spaces.enrollment': "'inherit'::text",
  'journey_v2_rollout_spaces.forced_legacy': '0',
  'journey_v2_divergences.detail_codes_json': "'[]'::jsonb"
});
const journeyV2RolloutRequiredChecks = Object.freeze({
  journey_v2_rollout_platform: [['id','platform'],['rollout_percentage','0','100'],
    ['forced_legacy','kill_switch_reference','kill_switch_review_at']],
  journey_v2_rollout_spaces: [['enrollment','inherit','included','excluded'],['rollout_percentage','0','100'],
    ['forced_legacy','kill_switch_reference','kill_switch_review_at']],
  journey_v2_divergences: [['operation','legacy_to_v2_write','v2_to_legacy_write','shadow_read'],
    ['served_source','legacy','v2','none'],['detail_codes_json','jsonb_typeof','array','50']]
});
const journeyV2RolloutRequiredConstraints = Object.freeze({
  journey_v2_rollout_platform_kill_switch_shape: ['forced_legacy','kill_switch_reference','kill_switch_review_at'],
  journey_v2_rollout_spaces_kill_switch_shape: ['forced_legacy','kill_switch_reference','kill_switch_review_at'],
  journey_v2_divergences_detail_codes_json: ['jsonb_typeof','array','jsonb_array_length','50']
});
const journeyV2RolloutRequiredTriggers = Object.freeze({
  journey_v2_divergences_append_only_trigger: ['journey_v2_divergences','journey_v2_divergence_append_only_guard']
});

export const journeyV2RolloutRuntimeContract = Object.freeze({
  columns: journeyV2RolloutExactColumns, primaryKeys: journeyV2RolloutPrimaryKeys,
  foreignKeys: journeyV2RolloutRequiredForeignKeys, indexes: journeyV2RolloutRequiredIndexes,
  defaults: journeyV2RolloutRequiredDefaults, checks: journeyV2RolloutRequiredChecks,
  constraints: journeyV2RolloutRequiredConstraints, triggers: journeyV2RolloutRequiredTriggers
});

/** Runtime schema 21: governed metric bindings, observations and rebuild history. */
const journeyMetricExactColumns = Object.freeze({
  journey_metric_segments: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],['name','text',false],
    ['description','text',false],['rule_json','jsonb',false],['state','text',false],['revision','integer',false],
    ['idempotency_key','text',true],['intent_sha256','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_metric_bindings: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],['target_type','text',false],
    ['target_id','text',false],['stage_id','text',true],['touchpoint_id','text',true],['persona_id','text',true],
    ['segment_id','text',true],['survey_id','text',true],['survey_space_id','text',true],['collector_id','text',true],
    ['collector_survey_id','text',true],['question_id','text',true],['question_survey_id','text',true],
    ['source_ref','text',false],['state','text',false],['revision','integer',false],['idempotency_key','text',true],
    ['intent_sha256','text',false],['created_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_metric_definitions: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],['target_type','text',false],
    ['target_id','text',false],['stage_id','text',true],['touchpoint_id','text',true],['persona_id','text',true],
    ['segment_id','text',true],['name','text',false],['state','text',false],['current_version_id','text',true],
    ['revision','integer',false],['idempotency_key','text',true],['intent_sha256','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_metric_definition_versions: [
    ['id','text',false],['definition_id','text',false],['space_id','text',false],['version_number','integer',false],
    ['source_kind','text',false],['binding_id','text',true],['calculator_kind','text',false],['aggregation','text',false],
    ['direction','text',false],['window_seconds','integer',false],['timezone','text',false],
    ['minimum_sample_size','integer',false],['freshness_max_age_seconds','integer',false],
    ['baseline_value','double precision',true],['target_value','double precision',true],['population_json','jsonb',false],
    ['filters_json','jsonb',false],['formula_json','jsonb',false],['configuration_json','jsonb',false],
    ['content_sha256','text',false],['idempotency_key','text',true],['intent_sha256','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_metric_imports: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['definition_version_id','text',false],
    ['source_id','text',false],['environment','text',false],['schema_version_id','text',false],
    ['external_record_sha256','text',false],['revision','integer',false],['operation','text',false],
    ['subject_id_hmac','text',false],['subject_type','text',false],['event_type','text',false],
    ['occurred_at','timestamp with time zone',false],['stage_id','text',true],['sentiment','text',true],
    ['invalid_reason','text',true],['source_lineage_json','jsonb',false],['schema_content_sha256','text',false],
    ['supersedes_import_id','text',true],['idempotency_key','text',false],['intent_sha256','text',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_metric_rebuild_runs: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['definition_version_id','text',false],
    ['reason','text',false],['as_of','timestamp with time zone',false],['state','text',false],
    ['available_at','timestamp with time zone',false],['lease_owner','text',true],['lease_token','text',true],
    ['lease_generation','integer',false],['lease_expires_at','timestamp with time zone',true],
    ['attempt_count','integer',false],['max_attempts','integer',false],['observation_id','text',true],
    ['error_code','text',true],['idempotency_key','text',false],['intent_sha256','text',false],
    ['requested_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false],['completed_at','timestamp with time zone',true]
  ],
  journey_metric_rebuild_attempts: [
    ['id','text',false],['run_id','text',false],['space_id','text',false],['attempt_number','integer',false],
    ['lease_generation','integer',false],['status','text',false],['error_code','text',true],
    ['started_at','timestamp with time zone',false],['completed_at','timestamp with time zone',false]
  ],
  journey_metric_observations: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['definition_version_id','text',false],
    ['revision','integer',false],['supersedes_observation_id','text',true],['status','text',false],
    ['value','double precision',true],['unit','text',false],['numerator','double precision',true],
    ['denominator','integer',false],['sample_size','integer',false],['period_start','timestamp with time zone',false],
    ['period_end','timestamp with time zone',false],['timezone','text',false],['as_of','timestamp with time zone',false],
    ['calculated_at','timestamp with time zone',false],['freshness_status','text',false],
    ['latest_observed_at','timestamp with time zone',true],['minimum_sample_warning','integer',false],
    ['source_count','integer',false],['source_snapshot_sha256','text',false],['result_sha256','text',false],
    ['result_json','jsonb',false],['rebuild_run_id','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_metric_observation_sources: [
    ['id','text',false],['observation_id','text',false],['space_id','text',false],['source_type','text',false],
    ['source_record_id','text',false],['source_revision_sha256','text',false],
    ['occurred_at','timestamp with time zone',false],['included','integer',false],['exclusion_code','text',true],
    ['created_at','timestamp with time zone',false]
  ],
  journey_metric_checkpoints: [
    ['definition_version_id','text',false],['space_id','text',false],['last_observation_id','text',true],
    ['source_snapshot_sha256','text',false],['source_record_count','integer',false],
    ['reconciled_at','timestamp with time zone',false],['revision','integer',false]
  ],
  journey_metric_audit_events: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_type','text',false],['target_id','text',false],['detail_json','jsonb',false],
    ['created_at','timestamp with time zone',false]
  ]
});
const journeyMetricPrimaryKeys = Object.freeze({
  ...Object.fromEntries(Object.keys(journeyMetricExactColumns).map((table) => [table,['id']])),
  journey_metric_checkpoints: ['definition_version_id','space_id']
});
const journeyMetricRequiredForeignKeys = Object.freeze([
  ...Object.keys(journeyMetricExactColumns).filter((table) => table !== 'journey_metric_checkpoints')
    .map((table) => [table,'space_id','spaces','id','c']),
  ['journey_metric_checkpoints','space_id','spaces','id','c'],
  ['journey_metric_segments','created_by_user_id','users','id','n'],
  ['journey_metric_bindings','created_by_user_id','users','id','n'],
  ['journey_metric_definitions','created_by_user_id','users','id','n'],
  ['journey_metric_definition_versions','created_by_user_id','users','id','n'],
  ['journey_metric_rebuild_runs','requested_by_user_id','users','id','n'],
  ['journey_metric_audit_events','actor_user_id','users','id','n']
]);
const journeyMetricRequiredIndexes = Object.freeze({
  surveys_tenant_identity: ['create unique index','(id, space_id)'],
  collectors_survey_identity: ['create unique index','(id, survey_id)'],
  questions_survey_identity: ['create unique index','(id, survey_id)'],
  journey_metric_segments_journey: ['(space_id, journey_definition_id, state, updated_at desc, id)'],
  journey_metric_bindings_active_source_target: ['create unique index','(space_id, journey_definition_id, target_type, target_id, source_ref)','where (state =','active'],
  journey_metric_bindings_target: ['(space_id, journey_definition_id, target_type, target_id, updated_at desc, id)'],
  journey_metric_bindings_survey: ['(space_id, survey_id, collector_id, question_id, id)'],
  journey_metric_definitions_target: ['(space_id, journey_definition_id, target_type, target_id, state, updated_at desc, id)'],
  journey_metric_definition_versions_history: ['(space_id, definition_id, version_number desc, id)'],
  journey_metric_imports_definition: ['(space_id, definition_version_id, occurred_at, id)'],
  journey_metric_rebuild_runs_claim: ['(state, available_at, lease_expires_at, space_id, id)'],
  journey_metric_rebuild_runs_definition: ['(space_id, definition_id, created_at desc, id)'],
  journey_metric_rebuild_attempts_history: ['(space_id, run_id, attempt_number, id)'],
  journey_metric_observations_query: ['(space_id, definition_id, period_end desc, revision desc, id)'],
  journey_metric_observation_sources_lookup: ['(space_id, source_type, source_record_id, observation_id)'],
  journey_metric_audit_history: ['(space_id, created_at desc, id)']
});
const journeyMetricRequiredDefaults = Object.freeze({
  'journey_metric_segments.description': "''::text",
  'journey_metric_segments.rule_json': "'{}'::jsonb",
  'journey_metric_segments.state': "'active'::text",
  'journey_metric_segments.revision': '1',
  'journey_metric_bindings.state': "'active'::text",
  'journey_metric_bindings.revision': '1',
  'journey_metric_definitions.state': "'active'::text",
  'journey_metric_definitions.revision': '1',
  'journey_metric_definition_versions.population_json': "'{}'::jsonb",
  'journey_metric_definition_versions.filters_json': "'{}'::jsonb",
  'journey_metric_rebuild_runs.state': "'pending'::text",
  'journey_metric_rebuild_runs.lease_generation': '0',
  'journey_metric_rebuild_runs.attempt_count': '0',
  'journey_metric_rebuild_runs.max_attempts': '3',
  'journey_metric_checkpoints.revision': '1',
  'journey_metric_audit_events.detail_json': "'{}'::jsonb"
});
const journeyMetricRequiredChecks = Object.freeze({
  journey_metric_segments: [['state','active','retired'],['rule_json','jsonb_typeof','object']],
  journey_metric_bindings: [['target_type','journey','stage','touchpoint','persona','segment'],['state','active','retired'],
    ['target_type','target_id','stage_id','touchpoint_id','persona_id','segment_id']],
  journey_metric_definitions: [['target_type','journey','stage','touchpoint','persona','segment'],['state','active','retired'],
    ['target_type','target_id','stage_id','touchpoint_id','persona_id','segment_id']],
  journey_metric_definition_versions: [['source_kind','survey','operational_import'],['calculator_kind','nps','csat','ces','operational'],
    ['direction','higher_is_better','lower_is_better','neutral'],['formula_json','jsonb_typeof','object']],
  journey_metric_imports: [['environment','development','staging','production'],['operation','upsert','delete'],
    ['subject_type','journey_instance','profile','ticket','social_post','custom'],['source_lineage_json','jsonb_typeof','object']],
  journey_metric_rebuild_runs: [['reason','manual','source_created','source_corrected','source_deleted','reconcile','scheduled'],
    ['state','pending','leased','retryable','completed','failed'],['state','leased','lease_owner','lease_token','lease_expires_at']],
  journey_metric_rebuild_attempts: [['status','succeeded','retryable_failed','terminal_failed','lease_expired'],['completed_at','started_at']],
  journey_metric_observations: [['status','available','unavailable','retracted'],['freshness_status','fresh','stale','unavailable'],
    ['period_end','period_start'],['result_json','jsonb_typeof','object']],
  journey_metric_observation_sources: [['source_type','survey_response','operational_import'],['included','0','1']],
  journey_metric_audit_events: [['action','segment.created','observation.read'],['detail_json','jsonb_typeof','object']]
});
const journeyMetricRequiredConstraints = Object.freeze({
  journey_metric_bindings_survey_tenant_fk: ['foreign key (survey_id, survey_space_id)','references surveys(id, space_id)','on delete set null'],
  journey_metric_bindings_collector_survey_fk: ['foreign key (collector_id, collector_survey_id)','references collectors(id, survey_id)','on delete set null'],
  journey_metric_bindings_question_survey_fk: ['foreign key (question_id, question_survey_id)','references questions(id, survey_id)','on delete set null'],
  journey_metric_definitions_current_version_fk: ['foreign key (current_version_id, id, space_id)',
    'references journey_metric_definition_versions(id, definition_id, space_id)','deferrable initially deferred'],
  journey_metric_imports_version_tenant_fk: ['foreign key (definition_version_id, definition_id, space_id)',
    'references journey_metric_definition_versions(id, definition_id, space_id)','on delete restrict'],
  journey_metric_imports_source_tenant_fk: ['foreign key (source_id, space_id, environment)',
    'references journey_event_sources(id, space_id, environment)','on delete restrict'],
  journey_metric_imports_schema_tenant_fk: ['foreign key (schema_version_id, source_id, space_id)',
    'references journey_event_schema_versions(id, source_id, space_id)','on delete restrict'],
  journey_metric_imports_source_revision: ['unique (space_id, definition_id, source_id, external_record_sha256, revision)'],
  journey_metric_rebuild_runs_version_tenant_fk: ['foreign key (definition_version_id, definition_id, space_id)',
    'references journey_metric_definition_versions(id, definition_id, space_id)','on delete restrict'],
  journey_metric_observations_version_tenant_fk: ['foreign key (definition_version_id, definition_id, space_id)',
    'references journey_metric_definition_versions(id, definition_id, space_id)','on delete restrict'],
  journey_metric_rebuild_runs_observation_tenant_fk: ['foreign key (observation_id, space_id)',
    'references journey_metric_observations(id, space_id)','deferrable initially deferred']
});
const journeyMetricRequiredTriggers = Object.freeze({
  journey_metric_definition_versions_append_only: ['journey_metric_definition_versions','journey_metric_append_only_guard'],
  journey_metric_imports_append_only: ['journey_metric_imports','journey_metric_append_only_guard'],
  journey_metric_observations_append_only: ['journey_metric_observations','journey_metric_append_only_guard'],
  journey_metric_observation_sources_append_only: ['journey_metric_observation_sources','journey_metric_append_only_guard'],
  journey_metric_rebuild_attempts_append_only: ['journey_metric_rebuild_attempts','journey_metric_append_only_guard'],
  journey_metric_audit_append_only: ['journey_metric_audit_events','journey_metric_append_only_guard']
});

export const journeyMetricRuntimeContract = Object.freeze({
  columns: journeyMetricExactColumns, primaryKeys: journeyMetricPrimaryKeys,
  foreignKeys: journeyMetricRequiredForeignKeys, indexes: journeyMetricRequiredIndexes,
  defaults: journeyMetricRequiredDefaults, checks: journeyMetricRequiredChecks,
  constraints: journeyMetricRequiredConstraints, triggers: journeyMetricRequiredTriggers
});

/** Runtime schema 22: immutable reviewed AI suggestion inputs, diffs and decisions. */
const journeyAiSuggestionExactColumns = Object.freeze({
  journey_ai_suggestion_runs: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['base_version_id','text',false],
    ['base_definition_revision','integer',false],['base_map_checksum','text',false],
    ['requested_by_user_id','text',true],['ai_job_id','text',true],['state','text',false],['focus','text',false],
    ['summary','text',false],['warning_codes_json','jsonb',false],['runtime_json','jsonb',true],
    ['prompt_contract_version','text',false],['change_schema_version','integer',false],
    ['selected_evidence_checksum','text',false],['selected_evidence_count','integer',false],['revision','integer',false],
    ['applied_version_id','text',true],['failure_code','text',true],['created_at','timestamp with time zone',false],
    ['generation_started_at','timestamp with time zone',true],['completed_at','timestamp with time zone',true],
    ['applied_at','timestamp with time zone',true],['updated_at','timestamp with time zone',false]
  ],
  journey_ai_suggestion_evidence: [
    ['id','text',false],['run_id','text',false],['space_id','text',false],['evidence_link_id','text',false],
    ['target_type','text',false],['target_id','text',false],['source_type','text',false],['source_ref','text',false],
    ['source_label','text',false],['excerpt','text',false],['population','text',false],['sample_size','integer',true],
    ['collected_at','timestamp with time zone',true],['window_start','timestamp with time zone',true],
    ['window_end','timestamp with time zone',true],['source_updated_at','timestamp with time zone',true],
    ['source_fingerprint','text',false],['assessment','text',false],['prompt_injection_suspected','integer',false],
    ['selected_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_ai_suggestion_changes: [
    ['id','text',false],['run_id','text',false],['space_id','text',false],['ordinal','integer',false],
    ['operation','text',false],['target_type','text',false],['target_ref','text',false],['before_json','jsonb',false],
    ['after_json','jsonb',false],['rationale','text',false],['evidence_refs_json','jsonb',false],
    ['warning_codes_json','jsonb',false],['change_checksum','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_ai_suggestion_decisions: [
    ['id','text',false],['run_id','text',false],['change_id','text',false],['space_id','text',false],
    ['sequence','integer',false],['decision','text',false],['actor_user_id','text',true],['reason','text',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_ai_suggestion_audit_events: [
    ['id','text',false],['run_id','text',false],['change_id','text',true],['space_id','text',false],
    ['actor_user_id','text',true],['action','text',false],['detail_json','jsonb',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_ai_suggestion_purge_receipts: [
    ['id','text',false],['scope','text',false],['space_hash','text',false],['definition_hash','text',true],
    ['change_ticket_hash','text',false],['reason_code','text',false],['deleted_counts_json','jsonb',false],
    ['created_at','timestamp with time zone',false]
  ]
});
const journeyAiSuggestionPrimaryKeys = Object.freeze(Object.fromEntries(
  Object.keys(journeyAiSuggestionExactColumns).map((table) => [table,['id']])
));
const journeyAiSuggestionRequiredForeignKeys = Object.freeze([
  ['journey_ai_suggestion_runs','space_id','spaces','id','r'],
  ['journey_ai_suggestion_runs','requested_by_user_id','users','id','n'],
  ['journey_ai_suggestion_runs','ai_job_id','ai_jobs','id','r'],
  ['journey_ai_suggestion_evidence','space_id','spaces','id','r'],
  ['journey_ai_suggestion_evidence','selected_by_user_id','users','id','n'],
  ['journey_ai_suggestion_changes','space_id','spaces','id','r'],
  ['journey_ai_suggestion_decisions','space_id','spaces','id','r'],
  ['journey_ai_suggestion_decisions','actor_user_id','users','id','n'],
  ['journey_ai_suggestion_audit_events','space_id','spaces','id','r'],
  ['journey_ai_suggestion_audit_events','actor_user_id','users','id','n']
]);
const journeyAiSuggestionRequiredIndexes = Object.freeze({
  journey_ai_suggestion_definitions_tenant_identity: ['create unique index','(id, space_id)'],
  journey_ai_suggestion_versions_tenant_identity: ['create unique index','(id, definition_id, space_id)'],
  journey_ai_suggestion_jobs_tenant_identity: ['create unique index','(id, space_id)'],
  journey_ai_suggestion_runs_one_active: ['create unique index','(space_id, definition_id)','where (state = any'],
  journey_ai_suggestion_runs_definition: ['(space_id, definition_id, created_at desc, id desc)'],
  journey_ai_suggestion_evidence_run: ['(run_id, source_type, source_ref, id)'],
  journey_ai_suggestion_changes_run: ['(run_id, ordinal, id)'],
  journey_ai_suggestion_decisions_run: ['(run_id, change_id, sequence desc)'],
  journey_ai_suggestion_audit_run: ['(run_id, created_at, id)'],
  journey_ai_suggestion_purge_receipts_created: ['(created_at, id)']
});
const journeyAiSuggestionRequiredDefaults = Object.freeze({
  'journey_ai_suggestion_runs.focus': "''::text",
  'journey_ai_suggestion_runs.summary': "''::text",
  'journey_ai_suggestion_runs.warning_codes_json': "'[]'::jsonb",
  'journey_ai_suggestion_runs.revision': '1',
  'journey_ai_suggestion_evidence.source_label': "''::text",
  'journey_ai_suggestion_evidence.excerpt': "''::text",
  'journey_ai_suggestion_evidence.population': "''::text",
  'journey_ai_suggestion_evidence.prompt_injection_suspected': '0',
  'journey_ai_suggestion_changes.evidence_refs_json': "'[]'::jsonb",
  'journey_ai_suggestion_changes.warning_codes_json': "'[]'::jsonb",
  'journey_ai_suggestion_audit_events.detail_json': "'{}'::jsonb"
});
const journeyAiSuggestionRequiredChecks = Object.freeze({
  journey_ai_suggestion_runs: [['state','queued','generating','review','ready_to_apply','applied','dismissed','superseded','failed'],
    ['selected_evidence_count','0','20'],['warning_codes_json','jsonb_typeof','array']],
  journey_ai_suggestion_evidence: [['target_type','definition','stage','card'],['assessment','supports','contradicts','neutral'],
    ['prompt_injection_suspected','0','1']],
  journey_ai_suggestion_changes: [['ordinal','0','29'],['operation','stage.add','stage.update','lane.add','lane.update','card.add','card.update'],
    ['target_type','stage','lane','card'],['before_json','jsonb_typeof','object','null'],['after_json','jsonb_typeof','object']],
  journey_ai_suggestion_decisions: [['decision','accepted','rejected'],['sequence','1']],
  journey_ai_suggestion_audit_events: [['action','run.created','change.reviewed','run.applied','run.dismissed'],
    ['detail_json','jsonb_typeof','object']],
  journey_ai_suggestion_purge_receipts: [['scope','definition','space'],
    ['reason_code','privacy_erasure','retention_expiry','legal_order'],['deleted_counts_json','jsonb_typeof','object']]
});
const journeyAiSuggestionRequiredConstraints = Object.freeze({
  journey_ai_suggestion_runs_definition_tenant_fk: ['foreign key (definition_id, space_id)',
    'references journey_definitions(id, space_id)','on delete restrict'],
  journey_ai_suggestion_runs_base_version_tenant_fk: ['foreign key (base_version_id, definition_id, space_id)',
    'references journey_map_versions(id, definition_id, space_id)','on delete restrict'],
  journey_ai_suggestion_runs_applied_version_tenant_fk: ['foreign key (applied_version_id, definition_id, space_id)',
    'references journey_map_versions(id, definition_id, space_id)','on delete restrict'],
  journey_ai_suggestion_runs_job_tenant_fk: ['foreign key (ai_job_id, space_id)',
    'references ai_jobs(id, space_id)','on delete restrict'],
  journey_ai_suggestion_evidence_run_tenant_fk: ['foreign key (run_id, space_id)',
    'references journey_ai_suggestion_runs(id, space_id)','on delete restrict'],
  journey_ai_suggestion_changes_run_tenant_fk: ['foreign key (run_id, space_id)',
    'references journey_ai_suggestion_runs(id, space_id)','on delete restrict'],
  journey_ai_suggestion_decisions_run_tenant_fk: ['foreign key (run_id, space_id)',
    'references journey_ai_suggestion_runs(id, space_id)','on delete restrict'],
  journey_ai_suggestion_decisions_change_tenant_fk: ['foreign key (change_id, run_id, space_id)',
    'references journey_ai_suggestion_changes(id, run_id, space_id)','on delete restrict'],
  journey_ai_suggestion_audit_run_tenant_fk: ['foreign key (run_id, space_id)',
    'references journey_ai_suggestion_runs(id, space_id)','on delete restrict'],
  journey_ai_suggestion_audit_change_tenant_fk: ['foreign key (change_id, run_id, space_id)',
    'references journey_ai_suggestion_changes(id, run_id, space_id)','on delete restrict']
});
const journeyAiSuggestionRequiredTriggers = Object.freeze({
  journey_ai_suggestion_evidence_immutable: ['journey_ai_suggestion_evidence','journey_ai_suggestion_immutable_guard'],
  journey_ai_suggestion_changes_immutable: ['journey_ai_suggestion_changes','journey_ai_suggestion_immutable_guard'],
  journey_ai_suggestion_decisions_immutable: ['journey_ai_suggestion_decisions','journey_ai_suggestion_immutable_guard'],
  journey_ai_suggestion_audit_immutable: ['journey_ai_suggestion_audit_events','journey_ai_suggestion_immutable_guard'],
  journey_ai_suggestion_purge_receipts_append_only: ['journey_ai_suggestion_purge_receipts','journey_ai_suggestion_receipt_append_only_guard']
});

export const journeyAiSuggestionRuntimeContract = Object.freeze({
  columns: journeyAiSuggestionExactColumns, primaryKeys: journeyAiSuggestionPrimaryKeys,
  foreignKeys: journeyAiSuggestionRequiredForeignKeys, indexes: journeyAiSuggestionRequiredIndexes,
  defaults: journeyAiSuggestionRequiredDefaults, checks: journeyAiSuggestionRequiredChecks,
  constraints: journeyAiSuggestionRequiredConstraints, triggers: journeyAiSuggestionRequiredTriggers
});

/** Runtime schema 23: immutable persona versions, claims, evidence bindings,
 * governance history, and publication pins. */
const journeyPersonaRootRuntime23Columns = Object.freeze([
  ...journeyMapExactColumns.journey_personas,
  ['current_version_id','text',true],['approved_version_id','text',true]
]);
const journeyPersonaVersionExactColumns = Object.freeze({
  journey_persona_versions: [
    ['id','text',false],['persona_id','text',false],['space_id','text',false],['version_number','integer',false],
    ['name','text',false],['summary','text',false],['lifecycle_state','text',false],['owner_user_id','text',true],
    ['source','text',false],['attributes_json','text',false],['goals_json','text',false],
    ['behaviours_json','text',false],['needs_json','text',false],['barriers_json','text',false],
    ['review_at','timestamp with time zone',true],['content_checksum','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_persona_claims: [
    ['id','text',false],['persona_version_id','text',false],['persona_id','text',false],['space_id','text',false],
    ['claim_type','text',false],['label','text',false],['value','text',false],['ordinal','integer',false],
    ['claim_checksum','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_persona_claim_evidence: [
    ['id','text',false],['claim_id','text',false],['persona_version_id','text',false],['persona_id','text',false],
    ['evidence_link_id','text',false],['space_id','text',false],['assessment_at_link','text',false],
    ['evidence_snapshot_fingerprint','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false]
  ],
  journey_persona_review_events: [
    ['id','text',false],['persona_version_id','text',false],['persona_id','text',false],['space_id','text',false],
    ['sequence','integer',false],['action','text',false],['actor_user_id','text',true],['comment','text',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_map_version_personas: [
    ['version_id','text',false],['definition_id','text',false],['persona_id','text',false],
    ['persona_version_id','text',false],['space_id','text',false],['ordinal','integer',false],
    ['review_state_at_pin','text',false],['content_checksum_at_pin','text',false],
    ['evidence_coverage_at_pin','integer',false],['pinned_at','timestamp with time zone',false]
  ]
});
const journeyPersonaVersionPrimaryKeys = Object.freeze({
  journey_persona_versions: ['id'],
  journey_persona_claims: ['id'],
  journey_persona_claim_evidence: ['id'],
  journey_persona_review_events: ['id'],
  journey_map_version_personas: ['version_id','persona_id']
});
const journeyPersonaVersionRequiredForeignKeys = Object.freeze([
  ['journey_persona_versions','space_id','spaces','id','r'],
  ['journey_persona_versions','owner_user_id','users','id','n'],
  ['journey_persona_versions','created_by_user_id','users','id','n'],
  ['journey_persona_claims','space_id','spaces','id','r'],
  ['journey_persona_claim_evidence','space_id','spaces','id','r'],
  ['journey_persona_claim_evidence','created_by_user_id','users','id','n'],
  ['journey_persona_review_events','space_id','spaces','id','r'],
  ['journey_persona_review_events','actor_user_id','users','id','n'],
  ['journey_map_version_personas','space_id','spaces','id','r']
]);
const journeyPersonaVersionRequiredIndexes = Object.freeze({
  journey_personas_tenant_identity: ['create unique index','(id, space_id)'],
  journey_evidence_links_tenant_identity: ['create unique index','(id, space_id)'],
  journey_persona_versions_persona: ['(space_id, persona_id, version_number desc)'],
  journey_persona_claims_version: ['(persona_version_id, claim_type, ordinal, id)'],
  journey_persona_claim_evidence_claim: ['(claim_id, evidence_link_id, id)'],
  journey_persona_review_events_version: ['(persona_version_id, sequence desc, id)'],
  journey_map_version_personas_persona: ['(space_id, persona_id, version_id)']
});
const journeyPersonaVersionRequiredDefaults = Object.freeze({
  'journey_persona_versions.summary': "''::text",
  'journey_persona_versions.attributes_json': "'{}'::text",
  'journey_persona_versions.goals_json': "'[]'::text",
  'journey_persona_versions.behaviours_json': "'[]'::text",
  'journey_persona_versions.needs_json': "'[]'::text",
  'journey_persona_versions.barriers_json': "'[]'::text",
  'journey_persona_claims.label': "''::text",
  'journey_persona_review_events.comment': "''::text",
  'journey_map_version_personas.evidence_coverage_at_pin': '0'
});
const journeyPersonaVersionRequiredChecks = Object.freeze({
  journey_persona_versions: [
    ['version_number','> 0'],['lifecycle_state','draft','in_review','active','retired'],
    ['source','workspace','legacy_audience_draft','ai_draft'],['content_checksum','^[a-f0-9]{64}$'],
    ['attributes_json','jsonb_typeof','object'],['goals_json','jsonb_typeof','array']
  ],
  journey_persona_claims: [
    ['claim_type','summary','attribute','goal','behaviour','need','barrier'],['ordinal','>= 0'],
    ['claim_checksum','^[a-f0-9]{64}$']
  ],
  journey_persona_claim_evidence: [
    ['assessment_at_link','supports','contradicts','neutral'],['evidence_snapshot_fingerprint','^[a-f0-9]{64}$']
  ],
  journey_persona_review_events: [
    ['sequence','> 0'],['action','submitted','approved','changes_requested','withdrawn']
  ],
  journey_map_version_personas: [
    ['ordinal','>= 0'],['review_state_at_pin','draft','in_review','changes_requested','approved'],
    ['content_checksum_at_pin','^[a-f0-9]{64}$'],['evidence_coverage_at_pin','>= 0']
  ]
});
const journeyPersonaVersionRequiredConstraints = Object.freeze({
  journey_personas_current_version_tenant_fk: [
    'foreign key (current_version_id, id, space_id)','references journey_persona_versions(id, persona_id, space_id)',
    'on delete restrict','deferrable initially deferred'
  ],
  journey_personas_approved_version_tenant_fk: [
    'foreign key (approved_version_id, id, space_id)','references journey_persona_versions(id, persona_id, space_id)',
    'on delete restrict'
  ],
  journey_persona_versions_persona_tenant_fk: [
    'foreign key (persona_id, space_id)','references journey_personas(id, space_id)','on delete restrict'
  ],
  journey_persona_claims_version_tenant_fk: [
    'foreign key (persona_version_id, persona_id, space_id)',
    'references journey_persona_versions(id, persona_id, space_id)','on delete restrict'
  ],
  journey_persona_claim_evidence_claim_tenant_fk: [
    'foreign key (claim_id, persona_version_id, persona_id, space_id)',
    'references journey_persona_claims(id, persona_version_id, persona_id, space_id)','on delete restrict'
  ],
  journey_persona_claim_evidence_link_tenant_fk: [
    'foreign key (evidence_link_id, space_id)','references journey_evidence_links(id, space_id)','on delete restrict'
  ],
  journey_persona_review_events_version_tenant_fk: [
    'foreign key (persona_version_id, persona_id, space_id)',
    'references journey_persona_versions(id, persona_id, space_id)','on delete restrict'
  ],
  journey_map_version_personas_map_tenant_fk: [
    'foreign key (version_id, definition_id, space_id)',
    'references journey_map_versions(id, definition_id, space_id)','on delete cascade'
  ],
  journey_map_version_personas_persona_tenant_fk: [
    'foreign key (persona_version_id, persona_id, space_id)',
    'references journey_persona_versions(id, persona_id, space_id)','on delete restrict'
  ]
});
const journeyPersonaVersionRequiredTriggers = Object.freeze({
  journey_personas_current_version_required: ['journey_personas','journey_persona_current_version_guard'],
  journey_persona_versions_immutable: ['journey_persona_versions','journey_persona_immutable_guard'],
  journey_persona_claims_immutable: ['journey_persona_claims','journey_persona_immutable_guard'],
  journey_persona_claim_evidence_immutable: ['journey_persona_claim_evidence','journey_persona_immutable_guard'],
  journey_persona_review_events_immutable: ['journey_persona_review_events','journey_persona_immutable_guard'],
  journey_map_version_personas_immutable: ['journey_map_version_personas','journey_persona_immutable_guard']
});

export const journeyPersonaVersionRuntimeContract = Object.freeze({
  columns: journeyPersonaVersionExactColumns, primaryKeys: journeyPersonaVersionPrimaryKeys,
  foreignKeys: journeyPersonaVersionRequiredForeignKeys, indexes: journeyPersonaVersionRequiredIndexes,
  defaults: journeyPersonaVersionRequiredDefaults, checks: journeyPersonaVersionRequiredChecks,
  constraints: journeyPersonaVersionRequiredConstraints, triggers: journeyPersonaVersionRequiredTriggers
});

/** Runtime schema 24: governed rich-card detail, immutable catalogue
 * versions, safe media references, durable purge receipts and audit history. */
const journeyRichCardExactColumns = Object.freeze({
  journey_channels: [
    ['id','text',false],['space_id','text',false],['status','text',false],
    ['current_version_number','integer',false],['revision','integer',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_channel_versions: [
    ['id','text',false],['channel_id','text',false],['space_id','text',false],
    ['version_number','integer',false],['name','text',false],['description','text',false],
    ['category','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false]
  ],
  journey_touchpoints: [
    ['id','text',false],['space_id','text',false],['status','text',false],
    ['current_version_number','integer',false],['revision','integer',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_touchpoint_versions: [
    ['id','text',false],['touchpoint_id','text',false],['space_id','text',false],
    ['version_number','integer',false],['name','text',false],['description','text',false],
    ['channel_id','text',false],['channel_version_id','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_card_details: [
    ['card_id','text',false],['version_id','text',false],['space_id','text',false],
    ['schema_version','integer',false],['rich_text_json','jsonb',false],['plain_text','text',false],
    ['emotion_valence','integer',true],['emotion_intensity','integer',true],
    ['emotion_label','text',false],['revision','integer',false],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_card_touchpoints: [
    ['id','text',false],['card_id','text',false],['version_id','text',false],['space_id','text',false],
    ['touchpoint_id','text',false],['touchpoint_version_id','text',false],['ordinal','integer',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_card_assets: [
    ['id','text',false],['card_id','text',false],['version_id','text',false],['space_id','text',false],
    ['kind','text',false],['source_kind','text',false],['source_upload_id','text',true],
    ['source_external_url','text',true],['display_name','text',false],['mime_type','text',false],
    ['byte_size','bigint',false],['sha256','text',true],['alt_text','text',false],['caption','text',false],
    ['ordinal','integer',false],['state','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['deleted_at','timestamp with time zone',true],
    ['retention_expires_at','timestamp with time zone',true]
  ],
  journey_asset_blob_purge_outbox: [
    ['id','text',false],['space_id','text',false],['source_upload_id','text',false],
    ['stored_filename','text',false],['expected_sha256','text',false],['expected_byte_size','bigint',false],
    ['state','text',false],['attempt_count','integer',false],['last_error_fingerprint','text',true],
    ['next_attempt_at','timestamp with time zone',false],['lease_expires_at','timestamp with time zone',true],
    ['completed_at','timestamp with time zone',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false]
  ],
  journey_rich_card_audit_events: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_type','text',false],['target_id','text',false],['definition_id','text',true],
    ['version_id','text',true],['before_fingerprint','text',true],['after_fingerprint','text',true],
    ['detail_json','jsonb',false],['created_at','timestamp with time zone',false]
  ]
});
const journeyRichCardPrimaryKeys = Object.freeze({
  journey_channels: ['id'], journey_channel_versions: ['id'], journey_touchpoints: ['id'],
  journey_touchpoint_versions: ['id'], journey_card_details: ['card_id'],
  journey_card_touchpoints: ['id'], journey_card_assets: ['id'],
  journey_asset_blob_purge_outbox: ['id'], journey_rich_card_audit_events: ['id']
});
const journeyRichCardRequiredForeignKeys = Object.freeze([
  ['journey_channels','space_id','spaces','id','c'],
  ['journey_channels','created_by_user_id','users','id','n'],
  ['journey_channel_versions','space_id','spaces','id','c'],
  ['journey_channel_versions','created_by_user_id','users','id','n'],
  ['journey_touchpoints','space_id','spaces','id','c'],
  ['journey_touchpoints','created_by_user_id','users','id','n'],
  ['journey_touchpoint_versions','space_id','spaces','id','c'],
  ['journey_touchpoint_versions','created_by_user_id','users','id','n'],
  ['journey_card_details','space_id','spaces','id','c'],
  ['journey_card_details','updated_by_user_id','users','id','n'],
  ['journey_card_touchpoints','space_id','spaces','id','c'],
  ['journey_card_touchpoints','created_by_user_id','users','id','n'],
  ['journey_card_assets','space_id','spaces','id','c'],
  ['journey_card_assets','created_by_user_id','users','id','n'],
  ['journey_rich_card_audit_events','space_id','spaces','id','c'],
  ['journey_rich_card_audit_events','actor_user_id','users','id','n']
]);
const journeyRichCardRequiredIndexes = Object.freeze({
  journey_rich_versions_tenant_identity: ['create unique index','(id, space_id)'],
  journey_rich_cards_tenant_identity: ['create unique index','(id, version_id, space_id)'],
  journey_rich_uploads_tenant_identity: ['create unique index','(id, space_id)'],
  journey_channels_space_status: ['(space_id, status, updated_at desc, id)'],
  journey_channel_versions_history: ['(space_id, channel_id, version_number desc, id)'],
  journey_touchpoints_space_status: ['(space_id, status, updated_at desc, id)'],
  journey_touchpoint_versions_history: ['(space_id, touchpoint_id, version_number desc, id)'],
  journey_touchpoint_versions_channel: ['(space_id, channel_id, channel_version_id, id)'],
  journey_card_details_version: ['(space_id, version_id, card_id)'],
  journey_card_touchpoints_version: ['(space_id, version_id, card_id, ordinal, id)'],
  journey_card_assets_version: ['(space_id, version_id, card_id, ordinal, id)'],
  journey_card_assets_active_ordinal_once: ['create unique index','(card_id, ordinal)','where (state = \'active\'::text)'],
  journey_card_assets_retention: ['(retention_expires_at, id)','where (state = \'deleted\'::text)'],
  journey_asset_blob_purge_outbox_due: ['(state, next_attempt_at, lease_expires_at, id)'],
  journey_rich_card_audit_history: ['(space_id, created_at desc, id)']
});
const journeyRichCardRequiredDefaults = Object.freeze({
  'journey_channels.status': "'active'::text", 'journey_channels.revision': '1',
  'journey_channel_versions.description': "''::text",
  'journey_touchpoints.status': "'active'::text", 'journey_touchpoints.revision': '1',
  'journey_touchpoint_versions.description': "''::text",
  'journey_card_details.schema_version': '1',
  'journey_card_details.plain_text': "''::text", 'journey_card_details.emotion_label': "''::text",
  'journey_card_details.revision': '1', 'journey_card_assets.byte_size': '0',
  'journey_card_assets.alt_text': "''::text", 'journey_card_assets.caption': "''::text",
  'journey_card_assets.state': "'active'::text", 'journey_asset_blob_purge_outbox.state': "'pending'::text",
  'journey_asset_blob_purge_outbox.attempt_count': '0',
  'journey_rich_card_audit_events.detail_json': "'{}'::jsonb"
});
const journeyRichCardRequiredChecks = Object.freeze({
  journey_channels: [['status','active','retired'],['current_version_number','>= 1'],['revision','>= 1']],
  journey_channel_versions: [['version_number','>= 1'],['category','web','mobile_app','other']],
  journey_touchpoints: [['status','active','retired'],['current_version_number','>= 1'],['revision','>= 1']],
  journey_touchpoint_versions: [['version_number','>= 1']],
  journey_card_details: [['schema_version','= 1'],['emotion_valence','-5','5'],['emotion_intensity','0','5'],
    ['rich_text_json','jsonb_typeof','object']],
  journey_card_touchpoints: [['ordinal','0','7']],
  journey_card_assets: [['kind','image','attachment'],['source_kind','upload','external_url'],
    ['state','active','deleted'],['sha256','^[a-f0-9]{64}$']],
  journey_asset_blob_purge_outbox: [['expected_sha256','^[a-f0-9]{64}$'],
    ['state','pending','processing','failed','completed'],['attempt_count','>= 0']],
  journey_rich_card_audit_events: [['target_type','channel','touchpoint','card','asset'],
    ['action','channel.created','card.asset_purged'],['detail_json','jsonb_typeof','object']]
});
const journeyRichCardRequiredConstraints = Object.freeze({
  journey_channel_versions_channel_tenant_fk: ['foreign key (channel_id, space_id)',
    'references journey_channels(id, space_id)','on delete cascade'],
  journey_touchpoint_versions_touchpoint_tenant_fk: ['foreign key (touchpoint_id, space_id)',
    'references journey_touchpoints(id, space_id)','on delete cascade'],
  journey_touchpoint_versions_channel_tenant_fk: ['foreign key (channel_version_id, channel_id, space_id)',
    'references journey_channel_versions(id, channel_id, space_id)','on delete restrict'],
  journey_card_details_card_tenant_fk: ['foreign key (card_id, version_id, space_id)',
    'references journey_map_cards(id, version_id, space_id)','on delete cascade'],
  journey_card_touchpoints_card_tenant_fk: ['foreign key (card_id, version_id, space_id)',
    'references journey_map_cards(id, version_id, space_id)','on delete cascade'],
  journey_card_touchpoints_catalog_tenant_fk: ['foreign key (touchpoint_version_id, touchpoint_id, space_id)',
    'references journey_touchpoint_versions(id, touchpoint_id, space_id)','on delete restrict'],
  journey_card_assets_card_tenant_fk: ['foreign key (card_id, version_id, space_id)',
    'references journey_map_cards(id, version_id, space_id)','on delete cascade'],
  journey_card_assets_upload_tenant_fk: ['foreign key (source_upload_id, space_id)',
    'references uploads(id, space_id)','on delete restrict'],
  journey_asset_blob_purge_state_shape: ['state','completed','processing','pending','failed']
});
const journeyRichCardRequiredTriggers = Object.freeze({
  journey_channel_versions_immutable: ['journey_channel_versions','journey_rich_snapshot_immutable_guard'],
  journey_touchpoint_versions_immutable: ['journey_touchpoint_versions','journey_rich_snapshot_immutable_guard'],
  journey_rich_card_audit_append_only: ['journey_rich_card_audit_events','journey_rich_audit_append_only_guard']
});

export const journeyRichCardRuntimeContract = Object.freeze({
  columns: journeyRichCardExactColumns, primaryKeys: journeyRichCardPrimaryKeys,
  foreignKeys: journeyRichCardRequiredForeignKeys, indexes: journeyRichCardRequiredIndexes,
  defaults: journeyRichCardRequiredDefaults, checks: journeyRichCardRequiredChecks,
  constraints: journeyRichCardRequiredConstraints, triggers: journeyRichCardRequiredTriggers
});

/** Runtime schema 25: deterministic, versioned journey metric/evidence alert
 * decisions with bounded lineage and durable per-recipient notification state. */
const journeyMetricAlertExactColumns = Object.freeze({
  journey_metric_alert_definitions: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['metric_definition_id','text',false],['name','text',false],['state','text',false],
    ['current_version_id','text',false],['revision','integer',false],['idempotency_key','text',true],
    ['intent_sha256','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_metric_alert_definition_versions: [
    ['id','text',false],['definition_id','text',false],['space_id','text',false],
    ['metric_definition_id','text',false],['version_number','integer',false],['rule_kind','text',false],
    ['direction','text',false],['threshold_value','double precision',false],['window_seconds','integer',false],
    ['cooldown_seconds','integer',false],['minimum_sample_size','integer',false],
    ['stale_after_seconds','integer',false],['contradiction_min_ratio','double precision',false],
    ['content_sha256','text',false],['idempotency_key','text',true],['intent_sha256','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false]
  ],
  journey_metric_alert_evaluation_runs: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['as_of','timestamp with time zone',false],['state','text',false],['evaluated_count','integer',false],
    ['triggered_count','integer',false],['warning_count','integer',false],['resolved_count','integer',false],
    ['error_code','text',true],['idempotency_key','text',false],['intent_sha256','text',false],
    ['requested_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['completed_at','timestamp with time zone',true]
  ],
  journey_metric_alert_evaluation_results: [
    ['id','text',false],['run_id','text',false],['space_id','text',false],
    ['alert_definition_id','text',false],['alert_definition_version_id','text',false],
    ['metric_definition_id','text',false],['metric_definition_version_id','text',true],
    ['observation_id','text',true],['outcome','text',false],['reason_code','text',false],
    ['severity','text',false],['observed_value','double precision',true],
    ['baseline_value','double precision',true],['delta_value','double precision',true],
    ['sample_size','integer',false],['lineage_json','jsonb',false],['lineage_sha256','text',false],
    ['dedupe_sha256','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_metric_alerts: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['alert_definition_id','text',false],['alert_definition_version_id','text',false],
    ['metric_definition_id','text',false],['metric_definition_version_id','text',true],
    ['observation_id','text',true],['severity','text',false],['reason_code','text',false],
    ['state','text',false],['dedupe_sha256','text',false],['lineage_json','jsonb',false],
    ['lineage_sha256','text',false],['observed_value','double precision',true],
    ['baseline_value','double precision',true],['delta_value','double precision',true],
    ['sample_size','integer',false],['opened_at','timestamp with time zone',false],
    ['last_evaluated_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['acknowledged_at','timestamp with time zone',true],['acknowledged_by_user_id','text',true],
    ['snoozed_until','timestamp with time zone',true],['resolved_at','timestamp with time zone',true],
    ['resolved_reason','text',true],['revision','integer',false]
  ],
  journey_metric_alert_events: [
    ['id','text',false],['alert_id','text',false],['space_id','text',false],['run_id','text',true],
    ['actor_user_id','text',true],['action','text',false],['reason_code','text',false],
    ['state_from','text',true],['state_to','text',false],['detail_json','jsonb',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_metric_alert_notification_preferences: [
    ['space_id','text',false],['user_id','text',false],['enabled','boolean',false],
    ['revision','integer',false],['updated_at','timestamp with time zone',false]
  ],
  journey_metric_alert_notifications: [
    ['id','text',false],['alert_id','text',false],['space_id','text',false],['user_id','text',false],
    ['event_id','text',false],['channel','text',false],['delivery_status','text',false],
    ['reason_code','text',false],['dedupe_sha256','text',false],['created_at','timestamp with time zone',false]
  ],
  journey_metric_alert_notification_states: [
    ['notification_id','text',false],['space_id','text',false],['user_id','text',false],
    ['state','text',false],['revision','integer',false],['read_at','timestamp with time zone',true]
  ],
  journey_metric_alert_notification_state_events: [
    ['id','text',false],['notification_id','text',false],['space_id','text',false],['user_id','text',false],
    ['state_from','text',false],['state_to','text',false],['created_at','timestamp with time zone',false]
  ]
});
const journeyMetricAlertPrimaryKeys = Object.freeze({
  journey_metric_alert_definitions: ['id'], journey_metric_alert_definition_versions: ['id'],
  journey_metric_alert_evaluation_runs: ['id'], journey_metric_alert_evaluation_results: ['id'],
  journey_metric_alerts: ['id'], journey_metric_alert_events: ['id'],
  journey_metric_alert_notification_preferences: ['space_id','user_id'],
  journey_metric_alert_notifications: ['id'],
  journey_metric_alert_notification_states: ['notification_id','space_id'],
  journey_metric_alert_notification_state_events: ['id']
});
const journeyMetricAlertRequiredForeignKeys = Object.freeze([
  ['journey_metric_alert_definitions','space_id','spaces','id','c'],
  ['journey_metric_alert_definitions','created_by_user_id','users','id','n'],
  ['journey_metric_alert_definition_versions','space_id','spaces','id','c'],
  ['journey_metric_alert_definition_versions','created_by_user_id','users','id','n'],
  ['journey_metric_alert_evaluation_runs','space_id','spaces','id','c'],
  ['journey_metric_alert_evaluation_runs','requested_by_user_id','users','id','n'],
  ['journey_metric_alert_evaluation_results','space_id','spaces','id','c'],
  ['journey_metric_alerts','space_id','spaces','id','c'],
  ['journey_metric_alerts','acknowledged_by_user_id','users','id','n'],
  ['journey_metric_alert_events','space_id','spaces','id','c'],
  ['journey_metric_alert_events','actor_user_id','users','id','n'],
  ['journey_metric_alert_notifications','space_id','spaces','id','c'],
  ['journey_metric_alert_notifications','user_id','users','id','r']
]);
const journeyMetricAlertRequiredIndexes = Object.freeze({
  journey_metric_alert_journeys_tenant_identity: ['create unique index','(id, space_id)'],
  journey_metric_alert_metrics_tenant_identity: ['create unique index','(id, space_id)'],
  journey_metric_alert_metrics_journey_tenant_identity: ['create unique index','(id, journey_definition_id, space_id)'],
  journey_metric_alert_metric_versions_tenant_identity: ['create unique index','(id, definition_id, space_id)'],
  journey_metric_alert_observations_tenant_identity: ['create unique index','(id, space_id)'],
  journey_metric_alert_definitions_journey: ['(space_id, journey_definition_id, state, updated_at desc, id)'],
  journey_metric_alert_versions_history: ['(space_id, definition_id, version_number desc, id)'],
  journey_metric_alert_runs_journey: ['(space_id, journey_definition_id, created_at desc, id)'],
  journey_metric_alert_results_run: ['(space_id, run_id, created_at, id)'],
  journey_metric_alerts_active_dedupe: ['create unique index','(space_id, alert_definition_id, dedupe_sha256)',
    "where (state = any (array['open'::text, 'acknowledged'::text, 'snoozed'::text]))"],
  journey_metric_alerts_journey: ['(space_id, journey_definition_id, state, updated_at desc, id)'],
  journey_metric_alert_events_history: ['(space_id, alert_id, created_at desc, id)'],
  journey_metric_alert_notifications_history: ['(space_id, user_id, created_at desc, id)']
});
const journeyMetricAlertRequiredDefaults = Object.freeze({
  'journey_metric_alert_definitions.state': "'active'::text",
  'journey_metric_alert_definitions.revision': '1',
  'journey_metric_alert_evaluation_runs.evaluated_count': '0',
  'journey_metric_alert_evaluation_runs.triggered_count': '0',
  'journey_metric_alert_evaluation_runs.warning_count': '0',
  'journey_metric_alert_evaluation_runs.resolved_count': '0',
  'journey_metric_alerts.revision': '1',
  'journey_metric_alert_notification_preferences.enabled': 'true',
  'journey_metric_alert_notification_preferences.revision': '1',
  'journey_metric_alert_notification_states.state': "'unread'::text",
  'journey_metric_alert_notification_states.revision': '1'
});
const journeyMetricAlertRequiredChecks = Object.freeze({
  journey_metric_alert_definitions: [['state','active','disabled','retired'],['revision','> 0']],
  journey_metric_alert_definition_versions: [['rule_kind','falling_metric','stale_source','small_sample','contradictory_evidence'],
    ['direction','decrease','increase','any'],['version_number','> 0'],['contradiction_min_ratio','0.01','0.5']],
  journey_metric_alert_evaluation_runs: [['state','evaluating','completed','failed'],['evaluated_count','>= 0']],
  journey_metric_alert_evaluation_results: [['outcome','triggered','warning','cleared','insufficient_data'],
    ['severity','none','warning','strong'],['lineage_json','jsonb_typeof','object']],
  journey_metric_alerts: [['state','open','acknowledged','snoozed','resolved'],
    ['severity','warning','strong'],['lineage_json','jsonb_typeof','object']],
  journey_metric_alert_events: [['action','opened','refreshed','acknowledged','snoozed','resolved','auto_resolved'],
    ['detail_json','jsonb_typeof','object']],
  journey_metric_alert_notifications: [['channel','in_app'],['delivery_status','queued','suppressed']],
  journey_metric_alert_notification_states: [['state','unread','read','dismissed'],['state','read_at']],
  journey_metric_alert_notification_state_events: [['state_from','unread','read','dismissed'],['state_to','read','dismissed']]
});
const journeyMetricAlertRequiredConstraints = Object.freeze({
  journey_metric_alert_definitions_journey_tenant_fk: ['foreign key (journey_definition_id, space_id)',
    'references journey_definitions(id, space_id)','on delete cascade'],
  journey_metric_alert_definitions_metric_tenant_fk: ['foreign key (metric_definition_id, journey_definition_id, space_id)',
    'references journey_metric_definitions(id, journey_definition_id, space_id)','on delete cascade'],
  journey_metric_alert_definitions_current_version_tenant_fk: ['foreign key (current_version_id, id, space_id)',
    'references journey_metric_alert_definition_versions(id, definition_id, space_id)','deferrable initially deferred'],
  journey_metric_alert_versions_parent_metric_tenant_fk: ['foreign key (definition_id, metric_definition_id, space_id)',
    'references journey_metric_alert_definitions(id, metric_definition_id, space_id)','on delete cascade'],
  journey_metric_alert_results_version_tenant_fk: ['foreign key (alert_definition_version_id, alert_definition_id, space_id)',
    'references journey_metric_alert_definition_versions(id, definition_id, space_id)','on delete restrict'],
  journey_metric_alerts_version_tenant_fk: ['foreign key (alert_definition_version_id, alert_definition_id, space_id)',
    'references journey_metric_alert_definition_versions(id, definition_id, space_id)','on delete restrict'],
  journey_metric_alert_notification_preferences_member_fk: ['foreign key (space_id, user_id)',
    'references space_memberships(space_id, user_id)','on delete cascade'],
  journey_metric_alert_notifications_alert_tenant_fk: ['foreign key (alert_id, space_id)',
    'references journey_metric_alerts(id, space_id)','on delete cascade'],
  journey_metric_alert_notifications_event_tenant_fk: ['foreign key (event_id, space_id)',
    'references journey_metric_alert_events(id, space_id)','on delete restrict'],
  journey_metric_alert_notification_states_notification_fk: ['foreign key (notification_id, space_id, user_id)',
    'references journey_metric_alert_notifications(id, space_id, user_id)','on delete cascade'],
  journey_metric_alert_notification_state_events_notification_fk: ['foreign key (notification_id, space_id, user_id)',
    'references journey_metric_alert_notifications(id, space_id, user_id)','on delete cascade']
});
const journeyMetricAlertRequiredTriggers = Object.freeze({
  journey_metric_alert_versions_append_only: ['journey_metric_alert_definition_versions','journey_metric_alert_append_only_guard'],
  journey_metric_alert_results_append_only: ['journey_metric_alert_evaluation_results','journey_metric_alert_append_only_guard'],
  journey_metric_alert_events_append_only: ['journey_metric_alert_events','journey_metric_alert_append_only_guard'],
  journey_metric_alert_notifications_append_only: ['journey_metric_alert_notifications','journey_metric_alert_append_only_guard'],
  journey_metric_alert_notification_state_events_append_only: ['journey_metric_alert_notification_state_events','journey_metric_alert_append_only_guard']
});
export const journeyMetricAlertRuntimeContract = Object.freeze({
  columns: journeyMetricAlertExactColumns, primaryKeys: journeyMetricAlertPrimaryKeys,
  foreignKeys: journeyMetricAlertRequiredForeignKeys, indexes: journeyMetricAlertRequiredIndexes,
  defaults: journeyMetricAlertRequiredDefaults, checks: journeyMetricAlertRequiredChecks,
  constraints: journeyMetricAlertRequiredConstraints, triggers: journeyMetricAlertRequiredTriggers
});

/** Runtime schema 26: tenant-bound, revisioned Journey Map saved views with
 * durable personal defaults, bounded idempotency receipts, and append-only audit. */
const journeySavedViewExactColumns = Object.freeze({
  journey_saved_view_settings: [
    ['space_id','text',false],['enabled','boolean',false],['retention_days','integer',false],
    ['revision','integer',false],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false]
  ],
  journey_saved_views: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['name','text',false],
    ['visibility','text',false],['owner_user_id','text',false],['binding_policy','text',false],
    ['bound_version_id','text',true],['comparison_definition_id','text',true],['comparison_version_id','text',true],
    ['schema_version','integer',false],['config_json','text',false],['config_sha256','text',false],
    ['state','text',false],['revision','integer',false],['idempotency_key','text',true],['intent_sha256','text',false],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['deleted_at','timestamp with time zone',true],['retention_expires_at','timestamp with time zone',true]
  ],
  journey_saved_view_references: [
    ['view_id','text',false],['space_id','text',false],['kind','text',false],
    ['reference_value','text',false],['ordinal','integer',false]
  ],
  journey_saved_view_selections: [
    ['space_id','text',false],['user_id','text',false],['definition_id','text',false],['view_id','text',false],
    ['view_revision','integer',false],['revision','integer',false],['updated_at','timestamp with time zone',false]
  ],
  journey_saved_view_operations: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',false],['idempotency_key','text',false],
    ['action','text',false],['intent_sha256','text',false],['response_json','text',false],
    ['created_at','timestamp with time zone',false]
  ],
  journey_saved_view_audit_events: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['view_id','text',true],['definition_id','text',true],['view_revision','integer',true],
    ['detail_json','text',false],['created_at','timestamp with time zone',false]
  ]
});
const journeySavedViewPrimaryKeys = Object.freeze({
  journey_saved_view_settings: ['space_id'], journey_saved_views: ['id'],
  journey_saved_view_references: ['view_id','kind','ordinal'],
  journey_saved_view_selections: ['space_id','user_id','definition_id'],
  journey_saved_view_operations: ['id'], journey_saved_view_audit_events: ['id']
});
const journeySavedViewRequiredForeignKeys = Object.freeze([
  ['journey_saved_view_settings','space_id','spaces','id','c'],
  ['journey_saved_view_settings','updated_by_user_id','users','id','n'],
  ['journey_saved_views','space_id','spaces','id','c'],
  ['journey_saved_views','owner_user_id','users','id','r'],
  ['journey_saved_views','created_by_user_id','users','id','n'],
  ['journey_saved_views','updated_by_user_id','users','id','n'],
  ['journey_saved_view_operations','space_id','spaces','id','c'],
  ['journey_saved_view_operations','actor_user_id','users','id','r'],
  ['journey_saved_view_audit_events','space_id','spaces','id','c'],
  ['journey_saved_view_audit_events','actor_user_id','users','id','n']
]);
const journeySavedViewRequiredIndexes = Object.freeze({
  journey_saved_views_definition_tenant_identity: ['create unique index','(id, space_id)'],
  journey_saved_views_version_tenant_identity: ['create unique index','(id, definition_id, space_id)'],
  journey_saved_views_definition: ['(space_id, definition_id, state, visibility, updated_at desc, id)'],
  journey_saved_views_owner: ['(space_id, owner_user_id, state, updated_at desc, id)'],
  journey_saved_views_retention: ['(retention_expires_at, id)',"where (state = 'deleted'::text)"],
  journey_saved_view_references_lookup: ['(space_id, kind, reference_value, view_id)'],
  journey_saved_view_audit_history: ['(space_id, definition_id, created_at desc, id)']
});
const journeySavedViewRequiredDefaults = Object.freeze({
  'journey_saved_view_settings.enabled': 'true',
  'journey_saved_view_settings.retention_days': '30',
  'journey_saved_view_settings.revision': '1',
  'journey_saved_views.state': "'active'::text",
  'journey_saved_views.revision': '1',
  'journey_saved_view_selections.revision': '1',
  'journey_saved_view_audit_events.detail_json': "'{}'::text"
});
const journeySavedViewRequiredChecks = Object.freeze({
  journey_saved_view_settings: [['retention_days','1','3650'],['revision','> 0']],
  journey_saved_views: [['visibility','private','space'],['binding_policy','exact','follows_current'],
    ['schema_version','= 1'],['state','active','deleted'],['config_sha256','^[a-f0-9]{64}$'],
    ['config_json','jsonb_typeof','object']],
  journey_saved_view_references: [['kind','persona','segment','cohort','channel','evidence_link','evidence_state','card_kind','lane'],
    ['ordinal','>= 0']],
  journey_saved_view_selections: [['view_revision','> 0'],['revision','> 0']],
  journey_saved_view_operations: [['action','view.create','view.update','view.duplicate','view.delete','view.restore',
    'default.select','default.reset','settings.update'],['response_json','jsonb_typeof','object']],
  journey_saved_view_audit_events: [['action','view.created','view.updated','view.duplicated','view.deleted','view.restored',
    'view.exported','default.selected','default.reset','settings.updated','retention.purged'],
    ['detail_json','jsonb_typeof','object']]
});
const journeySavedViewRequiredConstraints = Object.freeze({
  journey_saved_views_definition_tenant_fk: ['foreign key (definition_id, space_id)',
    'references journey_definitions(id, space_id)','on delete cascade'],
  journey_saved_views_owner_membership_fk: ['foreign key (space_id, owner_user_id)',
    'references space_memberships(space_id, user_id)','on delete restrict'],
  journey_saved_views_bound_version_tenant_fk: ['foreign key (bound_version_id, definition_id, space_id)',
    'references journey_map_versions(id, definition_id, space_id)','on delete restrict'],
  journey_saved_views_comparison_definition_tenant_fk: ['foreign key (comparison_definition_id, space_id)',
    'references journey_definitions(id, space_id)','on delete restrict'],
  journey_saved_views_comparison_version_tenant_fk: ['foreign key (comparison_version_id, comparison_definition_id, space_id)',
    'references journey_map_versions(id, definition_id, space_id)','on delete restrict'],
  journey_saved_view_references_view_tenant_fk: ['foreign key (view_id, space_id)',
    'references journey_saved_views(id, space_id)','on delete cascade'],
  journey_saved_view_selections_membership_fk: ['foreign key (space_id, user_id)',
    'references space_memberships(space_id, user_id)','on delete cascade'],
  journey_saved_view_selections_definition_tenant_fk: ['foreign key (definition_id, space_id)',
    'references journey_definitions(id, space_id)','on delete cascade'],
  journey_saved_view_selections_view_tenant_fk: ['foreign key (view_id, definition_id, space_id)',
    'references journey_saved_views(id, definition_id, space_id)','on delete cascade']
});
const journeySavedViewRequiredTriggers = Object.freeze({
  journey_saved_view_reference_tenant_guard: ['journey_saved_view_references','journey_saved_view_reference_tenant_guard'],
  journey_saved_view_operations_append_only: ['journey_saved_view_operations','journey_saved_view_append_only_guard'],
  journey_saved_view_audit_append_only: ['journey_saved_view_audit_events','journey_saved_view_append_only_guard']
});
export const journeySavedViewRuntimeContract = Object.freeze({
  columns: journeySavedViewExactColumns, primaryKeys: journeySavedViewPrimaryKeys,
  foreignKeys: journeySavedViewRequiredForeignKeys, indexes: journeySavedViewRequiredIndexes,
  defaults: journeySavedViewRequiredDefaults, checks: journeySavedViewRequiredChecks,
  constraints: journeySavedViewRequiredConstraints, triggers: journeySavedViewRequiredTriggers
});

// ---------------------------------------------------------------------------
// Runtime 27 (journey portfolio), 28 (collaboration) and 29 (hierarchy and
// service blueprints).
//
// These three blocks were derived from the schema the committed migrations
// actually produce on the pinned PostgreSQL 16 engine, not hand-transcribed, so
// every column, key, index, default, check, composite constraint and trigger of
// all 56 new tables is pinned exactly. assertRuntimeSchemaContract runs inside
// the migration transaction (scripts/upgrade-postgres-schema.mjs), so any drift
// between a release's SQL and this contract aborts that migration rather than
// leaving a half-registered runtime behind.
//
// Named-constraint entries are deliberately restricted to composite keys: a
// single-column foreign key is already pinned exactly by RequiredForeignKeys,
// while the grouping of a composite key is the tenant-isolation guarantee that
// the per-column shape cannot express. Constraint-backing indexes are likewise
// omitted -- the primary-key and constraint contracts already own them.
// ---------------------------------------------------------------------------
const journeyPortfolioExactColumns = Object.freeze({
  journey_portfolio_settings: [
    ['space_id','text',false],['enabled','boolean',false],['retention_days','integer',false],
    ['approval_required','boolean',false],['default_scoring_policy_id','text',true],
    ['revision','integer',false],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_portfolio_items: [
    ['id','text',false],['space_id','text',false],['kind','text',false],['title','text',false],
    ['description','text',false],['lifecycle','text',false],['owner_user_id','text',true],
    ['owner_team_id','text',true],['priority','text',true],['risk','text',true],['severity','integer',true],
    ['frequency','text',true],['desired_outcome','text',true],['hypothesis','text',true],
    ['constraints_json','text',false],['estimated_effort','numeric',true],['estimated_cost','numeric',true],
    ['expected_outcome','text',true],['planned_start','date',true],['planned_end','date',true],
    ['actual_start','date',true],['actual_end','date',true],['due_date','date',true],
    ['progress_percent','integer',true],['review_cadence_days','integer',true],['review_state','text',false],
    ['latest_review_id','text',true],['target_metrics_json','text',false],
    ['evidence_link_ids_json','text',false],['tags_json','text',false],['state','text',false],
    ['revision','integer',false],['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['deleted_at','timestamp with time zone',true],['retention_expires_at','timestamp with time zone',true],
  ],
  journey_portfolio_item_versions: [
    ['id','text',false],['item_id','text',false],['space_id','text',false],['revision','integer',false],
    ['schema_version','integer',false],['snapshot_json','text',false],['snapshot_sha256','text',false],
    ['change_reason','text',true],['actor_user_id','text',true],['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_item_evidence: [
    ['item_id','text',false],['space_id','text',false],['evidence_link_id','text',false],
    ['ordinal','integer',false],
  ],
  journey_portfolio_item_tags: [
    ['item_id','text',false],['space_id','text',false],['tag','text',false],['ordinal','integer',false],
  ],
  journey_initiative_metric_targets: [
    ['item_id','text',false],['space_id','text',false],['metric_definition_id','text',false],
    ['metric_definition_version_id','text',false],['direction','text',false],['target_value','numeric',false],
    ['unit','text',false],['ordinal','integer',false],
  ],
  journey_portfolio_relationships: [
    ['id','text',false],['space_id','text',false],['relationship_type','text',false],
    ['from_item_id','text',false],['from_item_kind','text',false],['to_item_id','text',false],
    ['to_item_kind','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_journey_links: [
    ['id','text',false],['space_id','text',false],['item_id','text',false],['item_kind','text',false],
    ['canonical_item_revision','integer',false],['journey_definition_id','text',false],
    ['journey_version_id','text',true],['target_type','text',false],['target_id','text',false],
    ['relationship','text',false],['valid_from','timestamp with time zone',true],
    ['valid_until','timestamp with time zone',true],['item_snapshot_json','text',true],
    ['item_snapshot_sha256','text',true],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_initiative_dependencies: [
    ['id','text',false],['space_id','text',false],['initiative_id','text',false],
    ['depends_on_initiative_id','text',false],['dependency_type','text',false],
    ['created_by_user_id','text',true],['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_scoring_policies: [
    ['id','text',false],['space_id','text',false],['name','text',false],['method','text',false],
    ['state','text',false],['revision','integer',false],['current_version_id','text',true],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_portfolio_scoring_policy_versions: [
    ['id','text',false],['policy_id','text',false],['space_id','text',false],['version_number','integer',false],
    ['method','text',false],['formula_version','text',false],['configuration_json','text',false],
    ['configuration_sha256','text',false],['actor_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_priority_assessments: [
    ['id','text',false],['space_id','text',false],['item_id','text',false],['item_revision','integer',false],
    ['policy_version_id','text',false],['method','text',false],['input_json','text',false],
    ['result_json','text',false],['score','numeric',true],['actor_user_id','text',true],
    ['assessed_at','timestamp with time zone',false],
  ],
  journey_initiative_baselines: [
    ['id','text',false],['space_id','text',false],['initiative_id','text',false],
    ['initiative_revision','integer',false],['metric_definition_id','text',false],
    ['metric_definition_version','text',false],['target_json','text',false],['observation_json','text',false],
    ['checksum','text',false],['captured_by_user_id','text',true],
    ['captured_at','timestamp with time zone',false],
  ],
  journey_initiative_outcome_comparisons: [
    ['id','text',false],['space_id','text',false],['initiative_id','text',false],['baseline_id','text',false],
    ['baseline_checksum','text',false],['after_observation_json','text',false],['comparison_json','text',false],
    ['actor_user_id','text',true],['compared_at','timestamp with time zone',false],
  ],
  journey_portfolio_reviews: [
    ['id','text',false],['space_id','text',false],['item_id','text',false],['item_revision','integer',false],
    ['decision','text',false],['note','text',false],['actor_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_operational_links: [
    ['id','text',false],['space_id','text',false],['initiative_id','text',false],
    ['operational_kind','text',false],['operational_id','text',false],['relationship','text',false],
    ['outcome_state','text',false],['outcome_detail_json','text',false],['revision','integer',false],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_portfolio_operations: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',false],
    ['idempotency_key','text',false],['action','text',false],['intent_sha256','text',false],
    ['response_json','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_portfolio_activity: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_kind','text',false],['target_id','text',false],['target_revision','integer',true],
    ['detail_json','text',false],['created_at','timestamp with time zone',false],
  ],
});
const journeyPortfolioPrimaryKeys = Object.freeze({
  journey_initiative_baselines: ['id'],
  journey_initiative_dependencies: ['id'],
  journey_initiative_metric_targets: ['item_id','metric_definition_id','metric_definition_version_id'],
  journey_initiative_outcome_comparisons: ['id'],
  journey_portfolio_activity: ['id'],
  journey_portfolio_item_evidence: ['item_id','evidence_link_id'],
  journey_portfolio_item_tags: ['item_id','tag'],
  journey_portfolio_item_versions: ['id'],
  journey_portfolio_items: ['id'],
  journey_portfolio_journey_links: ['id'],
  journey_portfolio_operational_links: ['id'],
  journey_portfolio_operations: ['id'],
  journey_portfolio_priority_assessments: ['id'],
  journey_portfolio_relationships: ['id'],
  journey_portfolio_reviews: ['id'],
  journey_portfolio_scoring_policies: ['id'],
  journey_portfolio_scoring_policy_versions: ['id'],
  journey_portfolio_settings: ['space_id'],
});
const journeyPortfolioRequiredForeignKeys = Object.freeze([
  ['journey_initiative_baselines','captured_by_user_id','users','id','n'],
  ['journey_initiative_baselines','initiative_id','journey_portfolio_item_versions','item_id','c'],
  ['journey_initiative_baselines','initiative_revision','journey_portfolio_item_versions','revision','c'],
  ['journey_initiative_baselines','space_id','journey_portfolio_item_versions','space_id','c'],
  ['journey_initiative_baselines','space_id','spaces','id','c'],
  ['journey_initiative_dependencies','created_by_user_id','users','id','n'],
  ['journey_initiative_dependencies','depends_on_initiative_id','journey_portfolio_items','id','c'],
  ['journey_initiative_dependencies','initiative_id','journey_portfolio_items','id','c'],
  ['journey_initiative_dependencies','space_id','journey_portfolio_items','space_id','c'],
  ['journey_initiative_dependencies','space_id','journey_portfolio_items','space_id','c'],
  ['journey_initiative_dependencies','space_id','spaces','id','c'],
  ['journey_initiative_metric_targets','item_id','journey_portfolio_items','id','c'],
  ['journey_initiative_metric_targets','metric_definition_id','journey_metric_definition_versions','definition_id','a'],
  ['journey_initiative_metric_targets','metric_definition_id','journey_metric_definitions','id','a'],
  ['journey_initiative_metric_targets','metric_definition_version_id','journey_metric_definition_versions','id','a'],
  ['journey_initiative_metric_targets','space_id','journey_metric_definition_versions','space_id','a'],
  ['journey_initiative_metric_targets','space_id','journey_metric_definitions','space_id','a'],
  ['journey_initiative_metric_targets','space_id','journey_portfolio_items','space_id','c'],
  ['journey_initiative_outcome_comparisons','actor_user_id','users','id','n'],
  ['journey_initiative_outcome_comparisons','baseline_id','journey_initiative_baselines','id','c'],
  ['journey_initiative_outcome_comparisons','initiative_id','journey_portfolio_items','id','c'],
  ['journey_initiative_outcome_comparisons','space_id','journey_initiative_baselines','space_id','c'],
  ['journey_initiative_outcome_comparisons','space_id','journey_portfolio_items','space_id','c'],
  ['journey_initiative_outcome_comparisons','space_id','spaces','id','c'],
  ['journey_portfolio_activity','actor_user_id','users','id','n'],
  ['journey_portfolio_activity','space_id','spaces','id','c'],
  ['journey_portfolio_item_evidence','evidence_link_id','journey_evidence_links','id','a'],
  ['journey_portfolio_item_evidence','item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_item_evidence','space_id','journey_evidence_links','space_id','a'],
  ['journey_portfolio_item_evidence','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_item_tags','item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_item_tags','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_item_versions','actor_user_id','users','id','n'],
  ['journey_portfolio_item_versions','item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_item_versions','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_items','created_by_user_id','users','id','n'],
  ['journey_portfolio_items','latest_review_id','journey_portfolio_reviews','id','a'],
  ['journey_portfolio_items','owner_user_id','space_memberships','user_id','a'],
  ['journey_portfolio_items','space_id','journey_portfolio_reviews','space_id','a'],
  ['journey_portfolio_items','space_id','space_memberships','space_id','a'],
  ['journey_portfolio_items','space_id','spaces','id','c'],
  ['journey_portfolio_items','updated_by_user_id','users','id','n'],
  ['journey_portfolio_journey_links','canonical_item_revision','journey_portfolio_item_versions','revision','c'],
  ['journey_portfolio_journey_links','created_by_user_id','users','id','n'],
  ['journey_portfolio_journey_links','item_id','journey_portfolio_item_versions','item_id','c'],
  ['journey_portfolio_journey_links','item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_journey_links','journey_definition_id','journey_definitions','id','c'],
  ['journey_portfolio_journey_links','journey_definition_id','journey_map_versions','definition_id','a'],
  ['journey_portfolio_journey_links','journey_version_id','journey_map_versions','id','a'],
  ['journey_portfolio_journey_links','space_id','journey_definitions','space_id','c'],
  ['journey_portfolio_journey_links','space_id','journey_map_versions','space_id','a'],
  ['journey_portfolio_journey_links','space_id','journey_portfolio_item_versions','space_id','c'],
  ['journey_portfolio_journey_links','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_journey_links','space_id','spaces','id','c'],
  ['journey_portfolio_operational_links','created_by_user_id','users','id','n'],
  ['journey_portfolio_operational_links','initiative_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_operational_links','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_operational_links','space_id','spaces','id','c'],
  ['journey_portfolio_operational_links','updated_by_user_id','users','id','n'],
  ['journey_portfolio_operations','actor_user_id','users','id','a'],
  ['journey_portfolio_operations','space_id','spaces','id','c'],
  ['journey_portfolio_priority_assessments','actor_user_id','users','id','n'],
  ['journey_portfolio_priority_assessments','item_id','journey_portfolio_item_versions','item_id','c'],
  ['journey_portfolio_priority_assessments','item_revision','journey_portfolio_item_versions','revision','c'],
  ['journey_portfolio_priority_assessments','policy_version_id','journey_portfolio_scoring_policy_versions','id','a'],
  ['journey_portfolio_priority_assessments','space_id','journey_portfolio_item_versions','space_id','c'],
  ['journey_portfolio_priority_assessments','space_id','journey_portfolio_scoring_policy_versions','space_id','a'],
  ['journey_portfolio_priority_assessments','space_id','spaces','id','c'],
  ['journey_portfolio_relationships','created_by_user_id','users','id','n'],
  ['journey_portfolio_relationships','from_item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_relationships','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_relationships','space_id','journey_portfolio_items','space_id','c'],
  ['journey_portfolio_relationships','space_id','spaces','id','c'],
  ['journey_portfolio_relationships','to_item_id','journey_portfolio_items','id','c'],
  ['journey_portfolio_reviews','actor_user_id','users','id','n'],
  ['journey_portfolio_reviews','item_id','journey_portfolio_item_versions','item_id','c'],
  ['journey_portfolio_reviews','item_revision','journey_portfolio_item_versions','revision','c'],
  ['journey_portfolio_reviews','space_id','journey_portfolio_item_versions','space_id','c'],
  ['journey_portfolio_reviews','space_id','spaces','id','c'],
  ['journey_portfolio_scoring_policies','created_by_user_id','users','id','n'],
  ['journey_portfolio_scoring_policies','current_version_id','journey_portfolio_scoring_policy_versions','id','a'],
  ['journey_portfolio_scoring_policies','id','journey_portfolio_scoring_policy_versions','policy_id','a'],
  ['journey_portfolio_scoring_policies','space_id','journey_portfolio_scoring_policy_versions','space_id','a'],
  ['journey_portfolio_scoring_policies','space_id','spaces','id','c'],
  ['journey_portfolio_scoring_policies','updated_by_user_id','users','id','n'],
  ['journey_portfolio_scoring_policy_versions','actor_user_id','users','id','n'],
  ['journey_portfolio_scoring_policy_versions','policy_id','journey_portfolio_scoring_policies','id','c'],
  ['journey_portfolio_scoring_policy_versions','space_id','journey_portfolio_scoring_policies','space_id','c'],
  ['journey_portfolio_settings','default_scoring_policy_id','journey_portfolio_scoring_policies','id','a'],
  ['journey_portfolio_settings','space_id','journey_portfolio_scoring_policies','space_id','a'],
  ['journey_portfolio_settings','space_id','spaces','id','c'],
  ['journey_portfolio_settings','updated_by_user_id','users','id','n'],
]);
const journeyPortfolioRequiredIndexes = Object.freeze({
  journey_initiative_baselines_history: ['create index journey_initiative_baselines_history on public.journey_initiative_baselines using btree (space_id, initiative_id, captured_at desc, id)'],
  journey_initiative_dependencies_reverse: ['create index journey_initiative_dependencies_reverse on public.journey_initiative_dependencies using btree (space_id, depends_on_initiative_id, dependency_type, initiative_id)'],
  journey_initiative_metric_targets_metric: ['create index journey_initiative_metric_targets_metric on public.journey_initiative_metric_targets using btree (space_id, metric_definition_id, item_id)'],
  journey_initiative_outcome_history: ['create index journey_initiative_outcome_history on public.journey_initiative_outcome_comparisons using btree (space_id, initiative_id, compared_at desc, id)'],
  journey_portfolio_activity_history: ['create index journey_portfolio_activity_history on public.journey_portfolio_activity using btree (space_id, target_kind, target_id, created_at desc, id)'],
  journey_portfolio_activity_retention: ['create index journey_portfolio_activity_retention on public.journey_portfolio_activity using btree (created_at, id)'],
  journey_portfolio_item_evidence_reverse: ['create index journey_portfolio_item_evidence_reverse on public.journey_portfolio_item_evidence using btree (space_id, evidence_link_id, item_id)'],
  journey_portfolio_item_tags_reverse: ['create index journey_portfolio_item_tags_reverse on public.journey_portfolio_item_tags using btree (space_id, tag, item_id)'],
  journey_portfolio_item_versions_history: ['create index journey_portfolio_item_versions_history on public.journey_portfolio_item_versions using btree (space_id, item_id, revision desc, id)'],
  journey_portfolio_items_delivery: ['create index journey_portfolio_items_delivery on public.journey_portfolio_items using btree (space_id, state, kind, lifecycle, due_date, priority, id)'],
  journey_portfolio_items_owner: ['create index journey_portfolio_items_owner on public.journey_portfolio_items using btree (space_id, owner_user_id, state, updated_at desc, id)'],
  journey_portfolio_items_query: ['create index journey_portfolio_items_query on public.journey_portfolio_items using btree (space_id, state, kind, lifecycle, updated_at desc, id)'],
  journey_portfolio_items_retention: ['create index journey_portfolio_items_retention on public.journey_portfolio_items using btree (retention_expires_at, id) where (state = \'deleted\'::text)'],
  journey_portfolio_journey_links_current_once: ['create unique index journey_portfolio_journey_links_current_once on public.journey_portfolio_journey_links using btree (space_id, item_id, journey_definition_id, target_type, target_id, relationship) where (journey_version_id is null)'],
  journey_portfolio_journey_links_item: ['create index journey_portfolio_journey_links_item on public.journey_portfolio_journey_links using btree (space_id, item_id, journey_definition_id, journey_version_id)'],
  journey_portfolio_journey_links_journey: ['create index journey_portfolio_journey_links_journey on public.journey_portfolio_journey_links using btree (space_id, journey_definition_id, target_type, target_id, item_kind)'],
  journey_portfolio_priority_assessments_history: ['create index journey_portfolio_priority_assessments_history on public.journey_portfolio_priority_assessments using btree (space_id, item_id, assessed_at desc, id)'],
  journey_portfolio_relationships_from: ['create index journey_portfolio_relationships_from on public.journey_portfolio_relationships using btree (space_id, from_item_id, relationship_type, to_item_id)'],
  journey_portfolio_relationships_to: ['create index journey_portfolio_relationships_to on public.journey_portfolio_relationships using btree (space_id, to_item_id, relationship_type, from_item_id)'],
  journey_portfolio_reviews_history: ['create index journey_portfolio_reviews_history on public.journey_portfolio_reviews using btree (space_id, item_id, created_at desc, id)'],
  journey_portfolio_scoring_policies_state: ['create index journey_portfolio_scoring_policies_state on public.journey_portfolio_scoring_policies using btree (space_id, state, updated_at desc, id)'],
});
const journeyPortfolioRequiredDefaults = Object.freeze({
  'journey_portfolio_activity.detail_json': '\'{}\'::text',
  'journey_portfolio_items.constraints_json': '\'[]\'::text',
  'journey_portfolio_items.review_state': '\'not_submitted\'::text',
  'journey_portfolio_items.target_metrics_json': '\'[]\'::text',
  'journey_portfolio_items.evidence_link_ids_json': '\'[]\'::text',
  'journey_portfolio_items.tags_json': '\'[]\'::text',
  'journey_portfolio_items.state': '\'active\'::text',
  'journey_portfolio_items.revision': '1',
  'journey_portfolio_operational_links.outcome_state': '\'linked\'::text',
  'journey_portfolio_operational_links.outcome_detail_json': '\'{}\'::text',
  'journey_portfolio_operational_links.revision': '1',
  'journey_portfolio_reviews.note': '\'\'::text',
  'journey_portfolio_scoring_policies.revision': '1',
  'journey_portfolio_settings.enabled': 'true',
  'journey_portfolio_settings.retention_days': '30',
  'journey_portfolio_settings.approval_required': 'true',
  'journey_portfolio_settings.revision': '1',
});
const journeyPortfolioRequiredChecks = Object.freeze({
  journey_initiative_baselines: [
    ['check (checksum ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (initiative_revision > 0)'],
    ['check (length(metric_definition_version) >= 1 and length(metric_definition_version) <= 128)'],
    ['check (octet_length(observation_json) <= 65536 and jsonb_typeof(observation_json::jsonb) = \'object\'::text)'],
    ['check (octet_length(target_json) <= 16384 and jsonb_typeof(target_json::jsonb) = \'object\'::text)']
  ],
  journey_initiative_dependencies: [
    ['check (dependency_type = any (array[\'finish_to_start\'::text, \'blocks\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (initiative_id <> depends_on_initiative_id)']
  ],
  journey_initiative_metric_targets: [
    ['check (direction = any (array[\'higher_is_better\'::text, \'lower_is_better\'::text]))'],
    ['check (ordinal >= 0 and ordinal <= 63)'],
    ['check (length(unit) >= 1 and length(unit) <= 80)']
  ],
  journey_initiative_outcome_comparisons: [
    ['check (octet_length(after_observation_json) <= 65536 and jsonb_typeof(after_observation_json::jsonb) = \'object\'::text)'],
    ['check (baseline_checksum ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(comparison_json) <= 65536 and jsonb_typeof(comparison_json::jsonb) = \'object\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)']
  ],
  journey_portfolio_activity: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (octet_length(detail_json) <= 32768 and jsonb_typeof(detail_json::jsonb) = \'object\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (length(target_kind) >= 1 and length(target_kind) <= 64)'],
    ['check (target_revision is null or target_revision > 0)']
  ],
  journey_portfolio_item_evidence: [
    ['check (ordinal >= 0 and ordinal <= 255)']
  ],
  journey_portfolio_item_tags: [
    ['check (ordinal >= 0 and ordinal <= 63)'],
    ['check (length(tag) >= 1 and length(tag) <= 80)']
  ],
  journey_portfolio_item_versions: [
    ['check (change_reason is null or length(change_reason) <= 1000)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (revision > 0)'],
    ['check (schema_version = 1)'],
    ['check (octet_length(snapshot_json) >= 2 and octet_length(snapshot_json) <= 131072 and jsonb_typeof(snapshot_json::jsonb) = \'object\'::text)'],
    ['check (snapshot_sha256 ~ \'^[a-f0-9]{64}$\'::text)']
  ],
  journey_portfolio_items: [
    ['check (actual_start is null or actual_end is null or actual_end >= actual_start)'],
    ['check (octet_length(constraints_json) <= 32768 and jsonb_typeof(constraints_json::jsonb) = \'array\'::text)'],
    ['check (length(description) >= 1 and length(description) <= 10000)'],
    ['check (desired_outcome is null or length(desired_outcome) >= 1 and length(desired_outcome) <= 5000)'],
    ['check (estimated_cost is null or estimated_cost >= 0::numeric)'],
    ['check (estimated_effort is null or estimated_effort >= 0::numeric)'],
    ['check (octet_length(evidence_link_ids_json) <= 65536 and jsonb_typeof(evidence_link_ids_json::jsonb) = \'array\'::text)'],
    ['check (expected_outcome is null or length(expected_outcome) >= 1 and length(expected_outcome) <= 5000)'],
    ['check (frequency is null or (frequency = any (array[\'rare\'::text, \'occasional\'::text, \'frequent\'::text, \'pervasive\'::text, \'unknown\'::text])))'],
    ['check (hypothesis is null or length(hypothesis) >= 1 and length(hypothesis) <= 5000)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (kind = \'initiative\'::text and progress_percent is not null or kind <> \'initiative\'::text and due_date is null and progress_percent is null)'],
    ['check (kind = any (array[\'pain_point\'::text, \'opportunity\'::text, \'solution\'::text, \'initiative\'::text]))'],
    ['check (kind = \'pain_point\'::text and severity is not null and frequency is not null and desired_outcome is null and hypothesis is null and expected_outcome is null and priority is null and risk is null or kind = \'opportunity\'::text and desired_outcome is not null and severity is null and frequency is null and hypothesis is null and expected_outcome is null and priority is null and risk is null or kind = \'solution\'::text and hypothesis is not null and risk is not null and severity is null and frequency is null and desired_outcome is null and expected_outcome is null and priority is null or kind = \'initiative\'::text and expected_outcome is not null and priority is not null and risk is not null and severity is null and frequency is null and desired_outcome is null and hypothesis is null)'],
    ['check (lifecycle = any (array[\'draft\'::text, \'validated\'::text, \'approved\'::text, \'planned\'::text, \'active\'::text, \'blocked\'::text, \'completed\'::text, \'cancelled\'::text, \'archived\'::text]))'],
    ['check (kind <> \'initiative\'::text and (lifecycle = any (array[\'draft\'::text, \'validated\'::text, \'approved\'::text, \'archived\'::text])) or kind = \'initiative\'::text and (lifecycle = any (array[\'draft\'::text, \'planned\'::text, \'active\'::text, \'blocked\'::text, \'completed\'::text, \'cancelled\'::text, \'archived\'::text])))'],
    ['check (state = \'active\'::text and deleted_at is null and retention_expires_at is null or state = \'deleted\'::text and deleted_at is not null and retention_expires_at is not null and retention_expires_at >= deleted_at)'],
    ['check (owner_team_id is null or length(owner_team_id) >= 1 and length(owner_team_id) <= 128)'],
    ['check (planned_start is null or planned_end is null or planned_end >= planned_start)'],
    ['check (priority is null or (priority = any (array[\'low\'::text, \'medium\'::text, \'high\'::text, \'critical\'::text])))'],
    ['check (progress_percent is null or progress_percent >= 0 and progress_percent <= 100)'],
    ['check (review_cadence_days is null or review_cadence_days >= 1 and review_cadence_days <= 3650)'],
    ['check (review_state = any (array[\'not_submitted\'::text, \'in_review\'::text, \'approved\'::text, \'changes_requested\'::text]))'],
    ['check (revision > 0)'],
    ['check (risk is null or (risk = any (array[\'low\'::text, \'medium\'::text, \'high\'::text, \'unknown\'::text])))'],
    ['check (severity is null or severity >= 1 and severity <= 5)'],
    ['check (state = any (array[\'active\'::text, \'deleted\'::text]))'],
    ['check (octet_length(tags_json) <= 32768 and jsonb_typeof(tags_json::jsonb) = \'array\'::text)'],
    ['check (octet_length(target_metrics_json) <= 65536 and jsonb_typeof(target_metrics_json::jsonb) = \'array\'::text)'],
    ['check (updated_at >= created_at)'],
    ['check (length(title) >= 1 and length(title) <= 200)']
  ],
  journey_portfolio_journey_links: [
    ['check (canonical_item_revision > 0)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(item_id) + octet_length(journey_definition_id) + coalesce(octet_length(journey_version_id), 0) + octet_length(target_type) + octet_length(target_id) + octet_length(relationship)) <= 1024)'],
    ['check (item_kind = any (array[\'pain_point\'::text, \'opportunity\'::text, \'solution\'::text, \'initiative\'::text]))'],
    ['check (relationship = any (array[\'occurs_at\'::text, \'affects\'::text, \'improves\'::text, \'changes\'::text, \'delivers\'::text]))'],
    ['check (journey_version_id is null and item_snapshot_json is null and item_snapshot_sha256 is null or journey_version_id is not null and item_snapshot_json is not null and jsonb_typeof(item_snapshot_json::jsonb) = \'object\'::text and octet_length(item_snapshot_json) <= 131072 and item_snapshot_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_type = any (array[\'journey\'::text, \'stage\'::text, \'touchpoint\'::text, \'persona\'::text]))'],
    ['check (valid_from is null or valid_until is null or valid_until > valid_from)']
  ],
  journey_portfolio_operational_links: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(initiative_id) + octet_length(operational_id)) <= 1024)'],
    ['check (length(operational_id) >= 1 and length(operational_id) <= 128)'],
    ['check (operational_kind = any (array[\'assistant_action\'::text, \'recovery_ticket\'::text]))'],
    ['check (octet_length(outcome_detail_json) <= 16384 and jsonb_typeof(outcome_detail_json::jsonb) = \'object\'::text)'],
    ['check (outcome_state = any (array[\'linked\'::text, \'succeeded\'::text, \'failed\'::text, \'cancelled\'::text, \'unknown\'::text]))'],
    ['check (relationship = any (array[\'informs\'::text, \'supports\'::text, \'delivers_follow_up\'::text]))'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
  journey_portfolio_operations: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(idempotency_key) >= 1 and length(idempotency_key) <= 200)'],
    ['check ((octet_length(space_id) + octet_length(actor_user_id) + octet_length(idempotency_key)) <= 1024)'],
    ['check (intent_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(response_json) <= 131072 and jsonb_typeof(response_json::jsonb) = \'object\'::text)']
  ],
  journey_portfolio_priority_assessments: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (octet_length(input_json) <= 32768 and jsonb_typeof(input_json::jsonb) = \'object\'::text)'],
    ['check (item_revision > 0)'],
    ['check (method = any (array[\'rice\'::text, \'ice\'::text, \'weighted\'::text]))'],
    ['check (octet_length(result_json) <= 32768 and jsonb_typeof(result_json::jsonb) = \'object\'::text)']
  ],
  journey_portfolio_relationships: [
    ['check (from_item_kind = any (array[\'pain_point\'::text, \'opportunity\'::text, \'solution\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(from_item_id) + octet_length(to_item_id)) <= 1024)'],
    ['check (from_item_id <> to_item_id)'],
    ['check (relationship_type = any (array[\'pain_point_to_opportunity\'::text, \'opportunity_to_solution\'::text, \'solution_to_initiative\'::text]))'],
    ['check (relationship_type = \'pain_point_to_opportunity\'::text and from_item_kind = \'pain_point\'::text and to_item_kind = \'opportunity\'::text or relationship_type = \'opportunity_to_solution\'::text and from_item_kind = \'opportunity\'::text and to_item_kind = \'solution\'::text or relationship_type = \'solution_to_initiative\'::text and from_item_kind = \'solution\'::text and to_item_kind = \'initiative\'::text)'],
    ['check (to_item_kind = any (array[\'opportunity\'::text, \'solution\'::text, \'initiative\'::text]))']
  ],
  journey_portfolio_reviews: [
    ['check (decision = any (array[\'submit\'::text, \'approve\'::text, \'request_changes\'::text, \'withdraw\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (item_revision > 0)'],
    ['check (length(note) <= 4000)']
  ],
  journey_portfolio_scoring_policies: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (method = any (array[\'rice\'::text, \'ice\'::text, \'weighted\'::text]))'],
    ['check (length(name) >= 1 and length(name) <= 160)'],
    ['check (revision > 0)'],
    ['check (state = any (array[\'draft\'::text, \'active\'::text, \'retired\'::text]))'],
    ['check (updated_at >= created_at)']
  ],
  journey_portfolio_scoring_policy_versions: [
    ['check (configuration_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(configuration_json) >= 2 and octet_length(configuration_json) <= 32768 and jsonb_typeof(configuration_json::jsonb) = \'object\'::text)'],
    ['check (length(formula_version) >= 1 and length(formula_version) <= 80)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (method = any (array[\'rice\'::text, \'ice\'::text, \'weighted\'::text]))'],
    ['check (version_number > 0)']
  ],
  journey_portfolio_settings: [
    ['check (retention_days >= 1 and retention_days <= 3650)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
});
const journeyPortfolioRequiredConstraints = Object.freeze({
  journey_initiative_baselines_initiative_version_fk: ['foreign key (initiative_id, space_id, initiative_revision) references journey_portfolio_item_versions(item_id, space_id, revision) on delete cascade'],
  journey_initiative_baselines_tenant_identity: ['unique (id, space_id)'],
  journey_initiative_dependencies_initiative_tenant_fk: ['foreign key (initiative_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_initiative_dependencies_once: ['unique (space_id, initiative_id, depends_on_initiative_id)'],
  journey_initiative_dependencies_prerequisite_tenant_fk: ['foreign key (depends_on_initiative_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_initiative_dependencies_tenant_identity: ['unique (id, space_id)'],
  journey_initiative_metric_targets_item_fk: ['foreign key (item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_initiative_metric_targets_metric_fk: ['foreign key (metric_definition_id, space_id) references journey_metric_definitions(id, space_id)'],
  journey_initiative_metric_targets_ordinal: ['unique (item_id, ordinal)'],
  journey_initiative_metric_targets_version_fk: ['foreign key (metric_definition_version_id, metric_definition_id, space_id) references journey_metric_definition_versions(id, definition_id, space_id)'],
  journey_initiative_outcome_comparisons_tenant_identity: ['unique (id, space_id)'],
  journey_initiative_outcomes_baseline_tenant_fk: ['foreign key (baseline_id, space_id) references journey_initiative_baselines(id, space_id) on delete cascade'],
  journey_initiative_outcomes_initiative_tenant_fk: ['foreign key (initiative_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_activity_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_item_evidence_item_fk: ['foreign key (item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_item_evidence_ordinal: ['unique (item_id, ordinal)'],
  journey_portfolio_item_evidence_source_fk: ['foreign key (evidence_link_id, space_id) references journey_evidence_links(id, space_id)'],
  journey_portfolio_item_tags_item_fk: ['foreign key (item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_item_tags_ordinal: ['unique (item_id, ordinal)'],
  journey_portfolio_item_versions_item_revision: ['unique (item_id, space_id, revision)'],
  journey_portfolio_item_versions_item_tenant_fk: ['foreign key (item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_item_versions_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_items_latest_review_fk: ['foreign key (latest_review_id, space_id) references journey_portfolio_reviews(id, space_id) deferrable initially deferred'],
  journey_portfolio_items_owner_membership_fk: ['foreign key (space_id, owner_user_id) references space_memberships(space_id, user_id)'],
  journey_portfolio_items_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_journey_links_item_tenant_fk: ['foreign key (item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_journey_links_item_version_fk: ['foreign key (item_id, space_id, canonical_item_revision) references journey_portfolio_item_versions(item_id, space_id, revision) on delete cascade'],
  journey_portfolio_journey_links_journey_tenant_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_portfolio_journey_links_once: ['unique (space_id, item_id, journey_definition_id, journey_version_id, target_type, target_id, relationship)'],
  journey_portfolio_journey_links_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_journey_links_version_tenant_fk: ['foreign key (journey_version_id, journey_definition_id, space_id) references journey_map_versions(id, definition_id, space_id)'],
  journey_portfolio_operational_links_initiative_fk: ['foreign key (initiative_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_operational_links_once: ['unique (space_id, initiative_id, operational_kind, operational_id, relationship)'],
  journey_portfolio_operational_links_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_operations_idempotency: ['unique (space_id, actor_user_id, idempotency_key)'],
  journey_portfolio_operations_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_priority_assessments_item_version_fk: ['foreign key (item_id, space_id, item_revision) references journey_portfolio_item_versions(item_id, space_id, revision) on delete cascade'],
  journey_portfolio_priority_assessments_policy_version_fk: ['foreign key (policy_version_id, space_id) references journey_portfolio_scoring_policy_versions(id, space_id)'],
  journey_portfolio_priority_assessments_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_relationships_edge_once: ['unique (space_id, relationship_type, from_item_id, to_item_id)'],
  journey_portfolio_relationships_from_tenant_fk: ['foreign key (from_item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_relationships_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_relationships_to_tenant_fk: ['foreign key (to_item_id, space_id) references journey_portfolio_items(id, space_id) on delete cascade'],
  journey_portfolio_reviews_item_version_fk: ['foreign key (item_id, space_id, item_revision) references journey_portfolio_item_versions(item_id, space_id, revision) on delete cascade'],
  journey_portfolio_reviews_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_scoring_current_version_fk: ['foreign key (current_version_id, id, space_id) references journey_portfolio_scoring_policy_versions(id, policy_id, space_id) deferrable initially deferred'],
  journey_portfolio_scoring_policies_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_scoring_policy_versions_current_identity: ['unique (id, policy_id, space_id)'],
  journey_portfolio_scoring_policy_versions_parent_fk: ['foreign key (policy_id, space_id) references journey_portfolio_scoring_policies(id, space_id) on delete cascade'],
  journey_portfolio_scoring_policy_versions_policy_version: ['unique (policy_id, space_id, version_number)'],
  journey_portfolio_scoring_policy_versions_tenant_identity: ['unique (id, space_id)'],
  journey_portfolio_settings_default_policy_fk: ['foreign key (default_scoring_policy_id, space_id) references journey_portfolio_scoring_policies(id, space_id)'],
});
const journeyPortfolioRequiredTriggers = Object.freeze({
  journey_initiative_dependency_kind_guard: ['journey_initiative_dependencies','journey_initiative_dependency_kind_guard'],
  journey_portfolio_activity_append_only: ['journey_portfolio_activity','journey_portfolio_append_only_guard'],
  journey_portfolio_assessments_append_only: ['journey_portfolio_priority_assessments','journey_portfolio_append_only_guard'],
  journey_portfolio_baselines_append_only: ['journey_initiative_baselines','journey_portfolio_append_only_guard'],
  journey_portfolio_item_review_guard: ['journey_portfolio_items','journey_portfolio_item_review_guard'],
  journey_portfolio_item_versions_append_only: ['journey_portfolio_item_versions','journey_portfolio_append_only_guard'],
  journey_portfolio_journey_link_guard: ['journey_portfolio_journey_links','journey_portfolio_journey_link_guard'],
  journey_portfolio_operational_link_guard: ['journey_portfolio_operational_links','journey_portfolio_operational_link_guard'],
  journey_portfolio_operations_append_only: ['journey_portfolio_operations','journey_portfolio_append_only_guard'],
  journey_portfolio_outcomes_append_only: ['journey_initiative_outcome_comparisons','journey_portfolio_append_only_guard'],
  journey_portfolio_policy_current_version_required: ['journey_portfolio_scoring_policies','journey_portfolio_policy_current_version_guard'],
  journey_portfolio_policy_versions_append_only: ['journey_portfolio_scoring_policy_versions','journey_portfolio_append_only_guard'],
  journey_portfolio_relationship_kind_guard: ['journey_portfolio_relationships','journey_portfolio_relationship_kind_guard'],
  journey_portfolio_reviews_append_only: ['journey_portfolio_reviews','journey_portfolio_append_only_guard'],
});
export const journeyPortfolioRuntimeContract = Object.freeze({
  columns: journeyPortfolioExactColumns, primaryKeys: journeyPortfolioPrimaryKeys,
  foreignKeys: journeyPortfolioRequiredForeignKeys, indexes: journeyPortfolioRequiredIndexes,
  defaults: journeyPortfolioRequiredDefaults, checks: journeyPortfolioRequiredChecks,
  constraints: journeyPortfolioRequiredConstraints, triggers: journeyPortfolioRequiredTriggers
});
// runtime 27

const journeyCollaborationExactColumns = Object.freeze({
  journey_collaboration_settings: [
    ['space_id','text',false],['enabled','boolean',false],['comments_enabled','boolean',false],
    ['sharing_enabled','boolean',false],['external_downloads_enabled','boolean',false],
    ['comment_retention_days','integer',false],['view_retention_days','integer',false],
    ['maximum_share_days','integer',false],['security_review_reference','text',true],
    ['security_reviewed_by_user_id','text',true],['security_reviewed_at','timestamp with time zone',true],
    ['revision','integer',false],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_collaboration_role_assignments: [
    ['id','text',false],['space_id','text',false],['scope_type','text',false],
    ['journey_definition_id','text',true],['user_id','text',false],['role','text',false],['state','text',false],
    ['revision','integer',false],['assigned_by_user_id','text',true],
    ['assigned_at','timestamp with time zone',false],['revoked_by_user_id','text',true],
    ['revoked_at','timestamp with time zone',true],['revocation_reason_sha256','text',true],
  ],
  journey_collaboration_role_events: [
    ['id','text',false],['assignment_id','text',false],['space_id','text',false],['actor_user_id','text',true],
    ['action','text',false],['role','text',false],['scope_type','text',false],
    ['journey_definition_id','text',true],['reason_sha256','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_comments: [
    ['id','text',false],['space_id','text',false],['target_type','text',false],['target_id','text',false],
    ['journey_definition_id','text',true],['parent_comment_id','text',true],['root_comment_id','text',false],
    ['author_user_id','text',false],['state','text',false],['revision','integer',false],
    ['current_version_id','text',false],['created_at','timestamp with time zone',false],
    ['edited_at','timestamp with time zone',true],['resolved_at','timestamp with time zone',true],
    ['resolved_by_user_id','text',true],['deleted_at','timestamp with time zone',true],
    ['retention_expires_at','timestamp with time zone',true],
  ],
  journey_comment_versions: [
    ['id','text',false],['comment_id','text',false],['space_id','text',false],
    ['version_number','integer',false],['schema_version','integer',false],['body_json','text',false],
    ['plain_text','text',false],['content_sha256','text',false],['editor_user_id','text',false],
    ['edit_reason_sha256','text',true],['created_at','timestamp with time zone',false],
  ],
  journey_comment_mentions: [
    ['comment_id','text',false],['space_id','text',false],['user_id','text',false],
    ['comment_revision','integer',false],['created_at','timestamp with time zone',false],
  ],
  journey_collaboration_watchers: [
    ['id','text',false],['space_id','text',false],['target_type','text',false],['target_id','text',false],
    ['user_id','text',false],['state','text',false],['revision','integer',false],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_governance_reviews: [
    ['id','text',false],['space_id','text',false],['target_type','text',false],['target_id','text',false],
    ['journey_definition_id','text',true],['target_revision','integer',false],['target_sha256','text',false],
    ['state','text',false],['revision','integer',false],['requested_by_user_id','text',false],
    ['request_summary','text',false],['request_reason_sha256','text',false],
    ['requested_at','timestamp with time zone',false],['due_at','timestamp with time zone',true],
    ['decided_by_user_id','text',true],['decision_summary','text',true],
    ['decided_at','timestamp with time zone',true],['published_by_user_id','text',true],
    ['published_at','timestamp with time zone',true],
  ],
  journey_governance_review_events: [
    ['id','text',false],['review_id','text',false],['space_id','text',false],['actor_user_id','text',true],
    ['action','text',false],['state_from','text',true],['state_to','text',false],['reason_sha256','text',false],
    ['created_at','timestamp with time zone',false],
  ],
  journey_governance_publications: [
    ['id','text',false],['review_id','text',false],['space_id','text',false],['target_type','text',false],
    ['target_id','text',false],['target_revision','integer',false],['target_sha256','text',false],
    ['published_by_user_id','text',true],['published_at','timestamp with time zone',false],
  ],
  journey_collaboration_notifications: [
    ['id','text',false],['space_id','text',false],['recipient_user_id','text',false],['kind','text',false],
    ['target_type','text',false],['target_id','text',false],['actor_user_id','text',true],
    ['comment_id','text',true],['review_id','text',true],['event_id','text',false],
    ['dedupe_sha256','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_collaboration_notification_states: [
    ['notification_id','text',false],['space_id','text',false],['recipient_user_id','text',false],
    ['state','text',false],['revision','integer',false],['read_at','timestamp with time zone',true],
  ],
  journey_collaboration_notification_state_events: [
    ['id','text',false],['notification_id','text',false],['space_id','text',false],
    ['recipient_user_id','text',false],['state_from','text',false],['state_to','text',false],
    ['created_at','timestamp with time zone',false],
  ],
  journey_collaboration_views: [
    ['id','text',false],['space_id','text',false],['resource_type','text',false],['resource_id','text',false],
    ['name','text',false],['audience','text',false],['visibility','text',false],['owner_user_id','text',false],
    ['schema_version','integer',false],['configuration_json','text',false],
    ['configuration_sha256','text',false],['state','text',false],['revision','integer',false],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['deleted_at','timestamp with time zone',true],['retention_expires_at','timestamp with time zone',true],
  ],
  journey_read_only_shares: [
    ['id','text',false],['space_id','text',false],['target_type','text',false],['target_id','text',false],
    ['target_revision','integer',false],['token_hash','text',false],['token_prefix','text',false],
    ['token_version','integer',false],['permission','text',false],['allow_export','boolean',false],
    ['allow_download','boolean',false],['snapshot_json','text',false],['snapshot_sha256','text',false],
    ['state','text',false],['revision','integer',false],['created_by_user_id','text',false],
    ['created_at','timestamp with time zone',false],['expires_at','timestamp with time zone',false],
    ['rotated_at','timestamp with time zone',true],['revoked_at','timestamp with time zone',true],
    ['revoked_by_user_id','text',true],['revocation_reason_sha256','text',true],
  ],
  journey_share_access_events: [
    ['id','text',false],['share_id','text',true],['space_id','text',true],['token_fingerprint','text',false],
    ['requester_fingerprint','text',false],['outcome','text',false],['reason_code','text',false],
    ['requested_action','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_share_rate_buckets: [
    ['requester_fingerprint','text',false],['token_fingerprint','text',false],
    ['bucket_started_at','timestamp with time zone',false],['attempts','integer',false],
    ['updated_at','timestamp with time zone',false],
  ],
  journey_collaboration_operations: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',false],
    ['idempotency_key','text',false],['action','text',false],['intent_sha256','text',false],
    ['response_json','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_collaboration_activity: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_type','text',false],['target_id','text',false],['journey_definition_id','text',true],
    ['comment_id','text',true],['review_id','text',true],['detail_json','text',false],
    ['created_at','timestamp with time zone',false],
  ],
  journey_collaboration_audit_events: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_type','text',false],['target_id','text',false],['request_id','text',true],
    ['detail_json','text',false],['created_at','timestamp with time zone',false],
  ],
});
const journeyCollaborationPrimaryKeys = Object.freeze({
  journey_collaboration_activity: ['id'],
  journey_collaboration_audit_events: ['id'],
  journey_collaboration_notification_state_events: ['id'],
  journey_collaboration_notification_states: ['notification_id','space_id'],
  journey_collaboration_notifications: ['id'],
  journey_collaboration_operations: ['id'],
  journey_collaboration_role_assignments: ['id'],
  journey_collaboration_role_events: ['id'],
  journey_collaboration_settings: ['space_id'],
  journey_collaboration_views: ['id'],
  journey_collaboration_watchers: ['id'],
  journey_comment_mentions: ['comment_id','user_id','comment_revision'],
  journey_comment_versions: ['id'],
  journey_comments: ['id'],
  journey_governance_publications: ['id'],
  journey_governance_review_events: ['id'],
  journey_governance_reviews: ['id'],
  journey_read_only_shares: ['id'],
  journey_share_access_events: ['id'],
  journey_share_rate_buckets: ['requester_fingerprint','token_fingerprint','bucket_started_at'],
});
const journeyCollaborationRequiredForeignKeys = Object.freeze([
  ['journey_collaboration_activity','actor_user_id','users','id','n'],
  ['journey_collaboration_activity','space_id','spaces','id','c'],
  ['journey_collaboration_audit_events','actor_user_id','users','id','n'],
  ['journey_collaboration_audit_events','space_id','spaces','id','c'],
  ['journey_collaboration_notification_state_events','notification_id','journey_collaboration_notifications','id','c'],
  ['journey_collaboration_notification_state_events','recipient_user_id','journey_collaboration_notifications','recipient_user_id','c'],
  ['journey_collaboration_notification_state_events','space_id','journey_collaboration_notifications','space_id','c'],
  ['journey_collaboration_notification_states','notification_id','journey_collaboration_notifications','id','c'],
  ['journey_collaboration_notification_states','recipient_user_id','journey_collaboration_notifications','recipient_user_id','c'],
  ['journey_collaboration_notification_states','space_id','journey_collaboration_notifications','space_id','c'],
  ['journey_collaboration_notifications','actor_user_id','users','id','n'],
  ['journey_collaboration_notifications','comment_id','journey_comments','id','c'],
  ['journey_collaboration_notifications','recipient_user_id','space_memberships','user_id','c'],
  ['journey_collaboration_notifications','review_id','journey_governance_reviews','id','c'],
  ['journey_collaboration_notifications','space_id','journey_comments','space_id','c'],
  ['journey_collaboration_notifications','space_id','journey_governance_reviews','space_id','c'],
  ['journey_collaboration_notifications','space_id','space_memberships','space_id','c'],
  ['journey_collaboration_notifications','space_id','spaces','id','c'],
  ['journey_collaboration_operations','actor_user_id','users','id','a'],
  ['journey_collaboration_operations','space_id','spaces','id','c'],
  ['journey_collaboration_role_assignments','assigned_by_user_id','users','id','n'],
  ['journey_collaboration_role_assignments','journey_definition_id','journey_definitions','id','c'],
  ['journey_collaboration_role_assignments','revoked_by_user_id','users','id','n'],
  ['journey_collaboration_role_assignments','space_id','journey_definitions','space_id','c'],
  ['journey_collaboration_role_assignments','space_id','space_memberships','space_id','c'],
  ['journey_collaboration_role_assignments','space_id','spaces','id','c'],
  ['journey_collaboration_role_assignments','user_id','space_memberships','user_id','c'],
  ['journey_collaboration_role_assignments','user_id','users','id','a'],
  ['journey_collaboration_role_events','actor_user_id','users','id','n'],
  ['journey_collaboration_role_events','assignment_id','journey_collaboration_role_assignments','id','c'],
  ['journey_collaboration_role_events','space_id','journey_collaboration_role_assignments','space_id','c'],
  ['journey_collaboration_settings','security_reviewed_by_user_id','users','id','n'],
  ['journey_collaboration_settings','space_id','spaces','id','c'],
  ['journey_collaboration_settings','updated_by_user_id','users','id','n'],
  ['journey_collaboration_views','created_by_user_id','users','id','n'],
  ['journey_collaboration_views','owner_user_id','users','id','a'],
  ['journey_collaboration_views','space_id','spaces','id','c'],
  ['journey_collaboration_views','updated_by_user_id','users','id','n'],
  ['journey_collaboration_watchers','space_id','space_memberships','space_id','c'],
  ['journey_collaboration_watchers','space_id','spaces','id','c'],
  ['journey_collaboration_watchers','user_id','space_memberships','user_id','c'],
  ['journey_comment_mentions','comment_id','journey_comment_versions','comment_id','c'],
  ['journey_comment_mentions','comment_id','journey_comments','id','c'],
  ['journey_comment_mentions','comment_revision','journey_comment_versions','version_number','c'],
  ['journey_comment_mentions','space_id','journey_comments','space_id','c'],
  ['journey_comment_mentions','space_id','space_memberships','space_id','c'],
  ['journey_comment_mentions','user_id','space_memberships','user_id','c'],
  ['journey_comment_versions','comment_id','journey_comments','id','c'],
  ['journey_comment_versions','editor_user_id','users','id','a'],
  ['journey_comment_versions','space_id','journey_comments','space_id','c'],
  ['journey_comments','author_user_id','users','id','a'],
  ['journey_comments','current_version_id','journey_comment_versions','id','a'],
  ['journey_comments','id','journey_comment_versions','comment_id','a'],
  ['journey_comments','journey_definition_id','journey_definitions','id','c'],
  ['journey_comments','parent_comment_id','journey_comments','id','c'],
  ['journey_comments','resolved_by_user_id','users','id','n'],
  ['journey_comments','root_comment_id','journey_comments','id','c'],
  ['journey_comments','space_id','journey_comment_versions','space_id','a'],
  ['journey_comments','space_id','journey_comments','space_id','c'],
  ['journey_comments','space_id','journey_comments','space_id','c'],
  ['journey_comments','space_id','journey_definitions','space_id','c'],
  ['journey_comments','space_id','spaces','id','c'],
  ['journey_governance_publications','published_by_user_id','users','id','n'],
  ['journey_governance_publications','review_id','journey_governance_reviews','id','c'],
  ['journey_governance_publications','space_id','journey_governance_reviews','space_id','c'],
  ['journey_governance_review_events','actor_user_id','users','id','n'],
  ['journey_governance_review_events','review_id','journey_governance_reviews','id','c'],
  ['journey_governance_review_events','space_id','journey_governance_reviews','space_id','c'],
  ['journey_governance_reviews','decided_by_user_id','users','id','n'],
  ['journey_governance_reviews','journey_definition_id','journey_definitions','id','c'],
  ['journey_governance_reviews','published_by_user_id','users','id','n'],
  ['journey_governance_reviews','requested_by_user_id','users','id','a'],
  ['journey_governance_reviews','space_id','journey_definitions','space_id','c'],
  ['journey_governance_reviews','space_id','spaces','id','c'],
  ['journey_read_only_shares','created_by_user_id','users','id','a'],
  ['journey_read_only_shares','revoked_by_user_id','users','id','n'],
  ['journey_read_only_shares','space_id','spaces','id','c'],
]);
const journeyCollaborationRequiredIndexes = Object.freeze({
  journey_collaboration_activity_retention: ['create index journey_collaboration_activity_retention on public.journey_collaboration_activity using btree (created_at, id)'],
  journey_collaboration_activity_target: ['create index journey_collaboration_activity_target on public.journey_collaboration_activity using btree (space_id, target_type, target_id, created_at desc, id)'],
  journey_collaboration_audit_history: ['create index journey_collaboration_audit_history on public.journey_collaboration_audit_events using btree (space_id, target_type, target_id, created_at desc, id)'],
  journey_collaboration_notification_state_events_history: ['create index journey_collaboration_notification_state_events_history on public.journey_collaboration_notification_state_events using btree (space_id, notification_id, created_at, id)'],
  journey_collaboration_notification_states_recipient: ['create index journey_collaboration_notification_states_recipient on public.journey_collaboration_notification_states using btree (space_id, recipient_user_id, state, notification_id)'],
  journey_collaboration_notifications_recipient: ['create index journey_collaboration_notifications_recipient on public.journey_collaboration_notifications using btree (space_id, recipient_user_id, created_at desc, id)'],
  journey_collaboration_roles_lookup: ['create index journey_collaboration_roles_lookup on public.journey_collaboration_role_assignments using btree (space_id, user_id, state, scope_type, journey_definition_id, assigned_at desc, id)'],
  journey_collaboration_roles_one_active: ['create unique index journey_collaboration_roles_one_active on public.journey_collaboration_role_assignments using btree (space_id, user_id, scope_type, coalesce(journey_definition_id, \'\'::text)) where (state = \'active\'::text)'],
  journey_collaboration_role_events_history: ['create index journey_collaboration_role_events_history on public.journey_collaboration_role_events using btree (space_id, assignment_id, created_at desc, id)'],
  journey_collaboration_views_owner: ['create index journey_collaboration_views_owner on public.journey_collaboration_views using btree (space_id, owner_user_id, state, updated_at desc, id)'],
  journey_collaboration_views_query: ['create index journey_collaboration_views_query on public.journey_collaboration_views using btree (space_id, resource_type, resource_id, state, audience, updated_at desc, id)'],
  journey_collaboration_views_retention: ['create index journey_collaboration_views_retention on public.journey_collaboration_views using btree (retention_expires_at, id) where (state = \'deleted\'::text)'],
  journey_collaboration_watchers_target: ['create index journey_collaboration_watchers_target on public.journey_collaboration_watchers using btree (space_id, target_type, target_id, state, user_id)'],
  journey_comment_mentions_recipient: ['create index journey_comment_mentions_recipient on public.journey_comment_mentions using btree (space_id, user_id, created_at desc, comment_id)'],
  journey_comment_versions_history: ['create index journey_comment_versions_history on public.journey_comment_versions using btree (space_id, comment_id, version_number desc, id)'],
  journey_comments_retention: ['create index journey_comments_retention on public.journey_comments using btree (retention_expires_at, id) where (state = \'deleted\'::text)'],
  journey_comments_target: ['create index journey_comments_target on public.journey_comments using btree (space_id, target_type, target_id, state, created_at, id)'],
  journey_comments_thread: ['create index journey_comments_thread on public.journey_comments using btree (space_id, root_comment_id, created_at, id)'],
  journey_governance_publications_target: ['create index journey_governance_publications_target on public.journey_governance_publications using btree (space_id, target_type, target_id, published_at desc, id)'],
  journey_governance_review_events_history: ['create index journey_governance_review_events_history on public.journey_governance_review_events using btree (space_id, review_id, created_at, id)'],
  journey_governance_reviews_one_pending: ['create unique index journey_governance_reviews_one_pending on public.journey_governance_reviews using btree (space_id, target_type, target_id, target_revision) where (state = \'pending\'::text)'],
  journey_governance_reviews_target: ['create index journey_governance_reviews_target on public.journey_governance_reviews using btree (space_id, target_type, target_id, state, requested_at desc, id)'],
  journey_read_only_shares_expiry: ['create index journey_read_only_shares_expiry on public.journey_read_only_shares using btree (expires_at, id) where (state = \'active\'::text)'],
  journey_read_only_shares_target: ['create index journey_read_only_shares_target on public.journey_read_only_shares using btree (space_id, target_type, target_id, state, expires_at, id)'],
  journey_share_access_events_retention: ['create index journey_share_access_events_retention on public.journey_share_access_events using btree (created_at, id)'],
  journey_share_access_events_share: ['create index journey_share_access_events_share on public.journey_share_access_events using btree (space_id, share_id, created_at desc, id)'],
  journey_share_rate_buckets_expiry: ['create index journey_share_rate_buckets_expiry on public.journey_share_rate_buckets using btree (bucket_started_at, requester_fingerprint)'],
});
const journeyCollaborationRequiredDefaults = Object.freeze({
  'journey_collaboration_activity.detail_json': '\'{}\'::text',
  'journey_collaboration_audit_events.detail_json': '\'{}\'::text',
  'journey_collaboration_notification_states.state': '\'unread\'::text',
  'journey_collaboration_notification_states.revision': '1',
  'journey_collaboration_role_assignments.state': '\'active\'::text',
  'journey_collaboration_role_assignments.revision': '1',
  'journey_collaboration_settings.enabled': 'true',
  'journey_collaboration_settings.comments_enabled': 'true',
  'journey_collaboration_settings.sharing_enabled': 'false',
  'journey_collaboration_settings.external_downloads_enabled': 'false',
  'journey_collaboration_settings.comment_retention_days': '30',
  'journey_collaboration_settings.view_retention_days': '30',
  'journey_collaboration_settings.maximum_share_days': '30',
  'journey_collaboration_settings.revision': '1',
  'journey_collaboration_views.state': '\'active\'::text',
  'journey_collaboration_views.revision': '1',
  'journey_collaboration_watchers.state': '\'watching\'::text',
  'journey_collaboration_watchers.revision': '1',
  'journey_comments.state': '\'active\'::text',
  'journey_comments.revision': '1',
  'journey_governance_reviews.revision': '1',
  'journey_read_only_shares.token_version': '1',
  'journey_read_only_shares.permission': '\'view\'::text',
  'journey_read_only_shares.allow_export': 'false',
  'journey_read_only_shares.allow_download': 'false',
  'journey_read_only_shares.state': '\'active\'::text',
  'journey_read_only_shares.revision': '1',
});
const journeyCollaborationRequiredChecks = Object.freeze({
  journey_collaboration_activity: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (comment_id is null or length(comment_id) >= 1 and length(comment_id) <= 128)'],
    ['check (octet_length(detail_json) <= 32768 and jsonb_typeof(detail_json::jsonb) = \'object\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (journey_definition_id is null or length(journey_definition_id) >= 1 and length(journey_definition_id) <= 128)'],
    ['check (review_id is null or length(review_id) >= 1 and length(review_id) <= 128)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (length(target_type) >= 1 and length(target_type) <= 64)']
  ],
  journey_collaboration_audit_events: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (octet_length(detail_json) <= 32768 and jsonb_typeof(detail_json::jsonb) = \'object\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (request_id is null or length(request_id) <= 200)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (length(target_type) >= 1 and length(target_type) <= 64)']
  ],
  journey_collaboration_notification_state_events: [
    ['check (state_from = any (array[\'unread\'::text, \'read\'::text, \'dismissed\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (state_to = any (array[\'read\'::text, \'dismissed\'::text]))']
  ],
  journey_collaboration_notification_states: [
    ['check (revision > 0)'],
    ['check (state = \'unread\'::text and read_at is null or (state = any (array[\'read\'::text, \'dismissed\'::text])) and read_at is not null)'],
    ['check (state = any (array[\'unread\'::text, \'read\'::text, \'dismissed\'::text]))']
  ],
  journey_collaboration_notifications: [
    ['check (dedupe_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(event_id) >= 1 and length(event_id) <= 128)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(recipient_user_id)) <= 1024)'],
    ['check (kind = any (array[\'mention\'::text, \'comment\'::text, \'reply\'::text, \'resolved\'::text, \'reopened\'::text, \'review_requested\'::text, \'review_decided\'::text, \'published\'::text, \'role_changed\'::text]))'],
    ['check ((kind = any (array[\'mention\'::text, \'comment\'::text, \'reply\'::text, \'resolved\'::text, \'reopened\'::text])) and comment_id is not null or (kind = any (array[\'review_requested\'::text, \'review_decided\'::text, \'published\'::text])) and review_id is not null or kind = \'role_changed\'::text)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (length(target_type) >= 1 and length(target_type) <= 64)']
  ],
  journey_collaboration_operations: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(idempotency_key) >= 1 and length(idempotency_key) <= 200)'],
    ['check ((octet_length(space_id) + octet_length(actor_user_id) + octet_length(idempotency_key)) <= 1024)'],
    ['check (intent_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(response_json) <= 131072 and jsonb_typeof(response_json::jsonb) = \'object\'::text)']
  ],
  journey_collaboration_role_assignments: [
    ['check (revocation_reason_sha256 is null or revocation_reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (revision > 0)'],
    ['check (role = any (array[\'viewer\'::text, \'contributor\'::text, \'editor\'::text, \'approver\'::text, \'manager\'::text, \'administrator\'::text]))'],
    ['check (scope_type = any (array[\'space\'::text, \'journey\'::text]))'],
    ['check (state = any (array[\'active\'::text, \'revoked\'::text]))'],
    ['check ((octet_length(space_id) + octet_length(user_id) + coalesce(octet_length(journey_definition_id), 0)) <= 1024)'],
    ['check (scope_type = \'space\'::text and journey_definition_id is null or scope_type = \'journey\'::text and journey_definition_id is not null)'],
    ['check (state = \'active\'::text and revoked_by_user_id is null and revoked_at is null and revocation_reason_sha256 is null or state = \'revoked\'::text and revoked_at is not null and revocation_reason_sha256 is not null)']
  ],
  journey_collaboration_role_events: [
    ['check (action = any (array[\'assigned\'::text, \'revoked\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (reason_sha256 is null or reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (role = any (array[\'viewer\'::text, \'contributor\'::text, \'editor\'::text, \'approver\'::text, \'manager\'::text, \'administrator\'::text]))'],
    ['check (scope_type = any (array[\'space\'::text, \'journey\'::text]))']
  ],
  journey_collaboration_settings: [
    ['check (comment_retention_days >= 1 and comment_retention_days <= 3650)'],
    ['check (external_downloads_enabled = false or sharing_enabled = true)'],
    ['check (maximum_share_days >= 1 and maximum_share_days <= 365)'],
    ['check (revision > 0)'],
    ['check (sharing_enabled = false and security_review_reference is null and security_reviewed_by_user_id is null and security_reviewed_at is null or sharing_enabled = true and security_review_reference is not null and security_reviewed_by_user_id is not null and security_reviewed_at is not null)'],
    ['check (security_review_reference is null or length(security_review_reference) >= 8 and length(security_review_reference) <= 200)'],
    ['check (updated_at >= created_at)'],
    ['check (view_retention_days >= 1 and view_retention_days <= 3650)']
  ],
  journey_collaboration_views: [
    ['check (audience = any (array[\'internal\'::text, \'executive\'::text, \'research\'::text, \'delivery\'::text, \'external\'::text]))'],
    ['check (octet_length(configuration_json) >= 2 and octet_length(configuration_json) <= 65536 and jsonb_typeof(configuration_json::jsonb) = \'object\'::text)'],
    ['check (configuration_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (state = \'active\'::text and deleted_at is null and retention_expires_at is null or state = \'deleted\'::text and deleted_at is not null and retention_expires_at is not null and retention_expires_at >= deleted_at)'],
    ['check (length(name) >= 1 and length(name) <= 160)'],
    ['check (length(resource_id) >= 1 and length(resource_id) <= 128)'],
    ['check (resource_type = \'portfolio\'::text and resource_id = space_id or resource_type = \'journey_map\'::text)'],
    ['check (resource_type = any (array[\'journey_map\'::text, \'portfolio\'::text]))'],
    ['check (revision > 0)'],
    ['check (schema_version = 1)'],
    ['check (state = any (array[\'active\'::text, \'deleted\'::text]))'],
    ['check (updated_at >= created_at)'],
    ['check (visibility = any (array[\'private\'::text, \'space\'::text]))']
  ],
  journey_collaboration_watchers: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(target_type) + octet_length(target_id) + octet_length(user_id)) <= 1024)'],
    ['check (revision > 0)'],
    ['check (state = any (array[\'watching\'::text, \'muted\'::text]))'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_type = any (array[\'journey_map\'::text, \'journey_stage\'::text, \'journey_card\'::text, \'persona\'::text, \'portfolio_item\'::text, \'recommendation\'::text]))'],
    ['check (updated_at >= created_at)']
  ],
  journey_comment_mentions: [
    ['check (comment_revision > 0)']
  ],
  journey_comment_versions: [
    ['check (octet_length(body_json) >= 2 and octet_length(body_json) <= 65536 and jsonb_typeof(body_json::jsonb) = \'object\'::text)'],
    ['check (content_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (edit_reason_sha256 is null or edit_reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(plain_text) >= 1 and length(plain_text) <= 8000)'],
    ['check (schema_version = 1)'],
    ['check (version_number > 0)']
  ],
  journey_comments: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(id) + octet_length(space_id) + octet_length(target_type) + octet_length(target_id)) <= 1024)'],
    ['check (revision > 0)'],
    ['check (state = any (array[\'active\'::text, \'resolved\'::text, \'deleted\'::text]))'],
    ['check (state = \'active\'::text and resolved_at is null and resolved_by_user_id is null and deleted_at is null and retention_expires_at is null or state = \'resolved\'::text and parent_comment_id is null and resolved_at is not null and resolved_by_user_id is not null and deleted_at is null and retention_expires_at is null or state = \'deleted\'::text and deleted_at is not null and retention_expires_at is not null and retention_expires_at >= deleted_at)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_type = any (array[\'journey_map\'::text, \'journey_stage\'::text, \'journey_card\'::text, \'persona\'::text, \'portfolio_item\'::text, \'recommendation\'::text]))'],
    ['check (parent_comment_id is null and root_comment_id = id or parent_comment_id is not null and root_comment_id <> id)']
  ],
  journey_governance_publications: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_revision > 0)'],
    ['check (target_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (target_type = any (array[\'journey_map\'::text, \'persona\'::text, \'portfolio_item\'::text, \'recommendation\'::text]))']
  ],
  journey_governance_review_events: [
    ['check (action = any (array[\'submitted\'::text, \'approved\'::text, \'rejected\'::text, \'withdrawn\'::text, \'published\'::text, \'superseded\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (state_to = any (array[\'pending\'::text, \'approved\'::text, \'rejected\'::text, \'withdrawn\'::text, \'published\'::text]))']
  ],
  journey_governance_reviews: [
    ['check (decision_summary is null or length(decision_summary) >= 3 and length(decision_summary) <= 2000)'],
    ['check (due_at is null or due_at > requested_at)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(target_type) + octet_length(target_id)) <= 1024)'],
    ['check (request_reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(request_summary) >= 3 and length(request_summary) <= 2000)'],
    ['check (revision > 0)'],
    ['check (state = any (array[\'pending\'::text, \'approved\'::text, \'rejected\'::text, \'withdrawn\'::text, \'published\'::text]))'],
    ['check (state = \'pending\'::text and decided_by_user_id is null and decided_at is null and published_by_user_id is null and published_at is null or (state = any (array[\'approved\'::text, \'rejected\'::text])) and decided_by_user_id is not null and decided_at is not null and published_by_user_id is null and published_at is null or state = \'withdrawn\'::text and decided_at is not null and published_by_user_id is null and published_at is null or state = \'published\'::text and decided_by_user_id is not null and decided_at is not null and published_by_user_id is not null and published_at is not null)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_revision > 0)'],
    ['check (target_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (target_type = any (array[\'journey_map\'::text, \'persona\'::text, \'portfolio_item\'::text, \'recommendation\'::text]))']
  ],
  journey_read_only_shares: [
    ['check (allow_download = false or allow_export = true)'],
    ['check (expires_at > created_at)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (permission = \'view\'::text)'],
    ['check (revision > 0)'],
    ['check (revocation_reason_sha256 is null or revocation_reason_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(snapshot_json) >= 2 and octet_length(snapshot_json) <= 1048576 and jsonb_typeof(snapshot_json::jsonb) = \'object\'::text)'],
    ['check (snapshot_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (state = any (array[\'active\'::text, \'revoked\'::text]))'],
    ['check (state = \'active\'::text and revoked_at is null and revoked_by_user_id is null and revocation_reason_sha256 is null or state = \'revoked\'::text and revoked_at is not null and revocation_reason_sha256 is not null)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_revision > 0)'],
    ['check (target_type = any (array[\'journey_map\'::text, \'persona\'::text, \'portfolio\'::text, \'collaboration_view\'::text]))'],
    ['check (token_hash ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (token_prefix ~ \'^[a-za-z0-9_-]{8,16}$\'::text)'],
    ['check (token_version > 0)']
  ],
  journey_share_access_events: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (outcome = any (array[\'allowed\'::text, \'denied\'::text]))'],
    ['check (length(reason_code) >= 1 and length(reason_code) <= 80)'],
    ['check (requested_action = any (array[\'view\'::text, \'download\'::text]))'],
    ['check (requester_fingerprint ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (share_id is null and space_id is null or share_id is not null and space_id is not null and length(share_id) >= 1 and length(share_id) <= 128 and length(space_id) >= 1 and length(space_id) <= 128)'],
    ['check (token_fingerprint ~ \'^[a-f0-9]{64}$\'::text)']
  ],
  journey_share_rate_buckets: [
    ['check (attempts >= 1 and attempts <= 1000000)'],
    ['check (requester_fingerprint ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (token_fingerprint ~ \'^[a-f0-9]{64}$\'::text)']
  ],
});
const journeyCollaborationRequiredConstraints = Object.freeze({
  journey_collaboration_activity_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_audit_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_notification_state_events_notification_fk: ['foreign key (notification_id, space_id, recipient_user_id) references journey_collaboration_notifications(id, space_id, recipient_user_id) on delete cascade'],
  journey_collaboration_notification_state_events_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_notification_states_notification_fk: ['foreign key (notification_id, space_id, recipient_user_id) references journey_collaboration_notifications(id, space_id, recipient_user_id) on delete cascade'],
  journey_collaboration_notifications_comment_fk: ['foreign key (comment_id, space_id) references journey_comments(id, space_id) on delete cascade'],
  journey_collaboration_notifications_dedupe: ['unique (space_id, recipient_user_id, dedupe_sha256)'],
  journey_collaboration_notifications_membership_fk: ['foreign key (space_id, recipient_user_id) references space_memberships(space_id, user_id) on delete cascade'],
  journey_collaboration_notifications_recipient_identity: ['unique (id, space_id, recipient_user_id)'],
  journey_collaboration_notifications_review_fk: ['foreign key (review_id, space_id) references journey_governance_reviews(id, space_id) on delete cascade'],
  journey_collaboration_notifications_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_operations_idempotency: ['unique (space_id, actor_user_id, idempotency_key)'],
  journey_collaboration_operations_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_role_events_assignment_fk: ['foreign key (assignment_id, space_id) references journey_collaboration_role_assignments(id, space_id) on delete cascade'],
  journey_collaboration_role_events_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_roles_journey_tenant_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_collaboration_roles_membership_fk: ['foreign key (space_id, user_id) references space_memberships(space_id, user_id) on delete cascade'],
  journey_collaboration_roles_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_views_tenant_identity: ['unique (id, space_id)'],
  journey_collaboration_watchers_membership_fk: ['foreign key (space_id, user_id) references space_memberships(space_id, user_id) on delete cascade'],
  journey_collaboration_watchers_one: ['unique (space_id, target_type, target_id, user_id)'],
  journey_collaboration_watchers_tenant_identity: ['unique (id, space_id)'],
  journey_comment_mentions_comment_fk: ['foreign key (comment_id, space_id) references journey_comments(id, space_id) on delete cascade'],
  journey_comment_mentions_membership_fk: ['foreign key (space_id, user_id) references space_memberships(space_id, user_id) on delete cascade'],
  journey_comment_mentions_revision_fk: ['foreign key (comment_id, comment_revision) references journey_comment_versions(comment_id, version_number) on delete cascade'],
  journey_comment_versions_comment_tenant_fk: ['foreign key (comment_id, space_id) references journey_comments(id, space_id) on delete cascade'],
  journey_comment_versions_parent_identity: ['unique (id, comment_id, space_id)'],
  journey_comment_versions_sequence: ['unique (comment_id, version_number)'],
  journey_comment_versions_tenant_identity: ['unique (id, space_id)'],
  journey_comments_current_version_fk: ['foreign key (current_version_id, id, space_id) references journey_comment_versions(id, comment_id, space_id) deferrable initially deferred'],
  journey_comments_journey_tenant_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_comments_parent_tenant_fk: ['foreign key (parent_comment_id, space_id) references journey_comments(id, space_id) on delete cascade'],
  journey_comments_root_tenant_fk: ['foreign key (root_comment_id, space_id) references journey_comments(id, space_id) on delete cascade deferrable initially deferred'],
  journey_comments_target_identity: ['unique (id, space_id, target_type, target_id)'],
  journey_comments_tenant_identity: ['unique (id, space_id)'],
  journey_governance_publications_review_fk: ['foreign key (review_id, space_id) references journey_governance_reviews(id, space_id) on delete cascade'],
  journey_governance_publications_tenant_identity: ['unique (id, space_id)'],
  journey_governance_review_events_review_fk: ['foreign key (review_id, space_id) references journey_governance_reviews(id, space_id) on delete cascade'],
  journey_governance_review_events_tenant_identity: ['unique (id, space_id)'],
  journey_governance_reviews_journey_tenant_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_governance_reviews_tenant_identity: ['unique (id, space_id)'],
  journey_read_only_shares_tenant_identity: ['unique (id, space_id)'],
  journey_share_access_events_tenant_identity: ['unique (id, space_id)'],
});
const journeyCollaborationRequiredTriggers = Object.freeze({
  journey_collaboration_activity_append_only: ['journey_collaboration_activity','journey_collaboration_append_only_guard'],
  journey_collaboration_audit_append_only: ['journey_collaboration_audit_events','journey_collaboration_append_only_guard'],
  journey_collaboration_notification_state_events_append_only: ['journey_collaboration_notification_state_events','journey_collaboration_append_only_guard'],
  journey_collaboration_notifications_append_only: ['journey_collaboration_notifications','journey_collaboration_append_only_guard'],
  journey_collaboration_operations_append_only: ['journey_collaboration_operations','journey_collaboration_append_only_guard'],
  journey_collaboration_role_events_append_only: ['journey_collaboration_role_events','journey_collaboration_append_only_guard'],
  journey_collaboration_view_guard: ['journey_collaboration_views','journey_collaboration_view_guard'],
  journey_collaboration_views_owner_membership_guard: ['journey_collaboration_views','journey_collaboration_membership_guard'],
  journey_comment_thread_guard: ['journey_comments','journey_comment_thread_guard'],
  journey_comment_versions_append_only: ['journey_comment_versions','journey_collaboration_append_only_guard'],
  journey_comment_versions_editor_membership_guard: ['journey_comment_versions','journey_collaboration_membership_guard'],
  journey_comments_author_membership_guard: ['journey_comments','journey_collaboration_membership_guard'],
  journey_comments_target_guard: ['journey_comments','journey_collaboration_target_guard'],
  journey_governance_publications_append_only: ['journey_governance_publications','journey_collaboration_append_only_guard'],
  journey_governance_review_events_append_only: ['journey_governance_review_events','journey_collaboration_append_only_guard'],
  journey_governance_reviews_requester_membership_guard: ['journey_governance_reviews','journey_collaboration_membership_guard'],
  journey_governance_reviews_target_guard: ['journey_governance_reviews','journey_collaboration_target_guard'],
  journey_read_only_shares_creator_membership_guard: ['journey_read_only_shares','journey_collaboration_membership_guard'],
  journey_share_access_events_append_only: ['journey_share_access_events','journey_collaboration_append_only_guard'],
  journey_share_target_guard: ['journey_read_only_shares','journey_share_target_guard'],
  journey_watchers_target_guard: ['journey_collaboration_watchers','journey_collaboration_target_guard'],
});
export const journeyCollaborationRuntimeContract = Object.freeze({
  columns: journeyCollaborationExactColumns, primaryKeys: journeyCollaborationPrimaryKeys,
  foreignKeys: journeyCollaborationRequiredForeignKeys, indexes: journeyCollaborationRequiredIndexes,
  defaults: journeyCollaborationRequiredDefaults, checks: journeyCollaborationRequiredChecks,
  constraints: journeyCollaborationRequiredConstraints, triggers: journeyCollaborationRequiredTriggers
});
// runtime 28

const journeyHierarchyBlueprintExactColumns = Object.freeze({
  journey_hierarchy_settings: [
    ['space_id','text',false],['hierarchy_enabled','boolean',false],['blueprints_enabled','boolean',false],
    ['maximum_depth','integer',false],['maximum_links','integer',false],['revision','integer',false],
    ['updated_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false],
  ],
  journey_taxonomy_terms: [
    ['id','text',false],['space_id','text',false],['kind','text',false],['name','text',false],
    ['normalized_name','text',false],['parent_term_id','text',true],['lifecycle','text',false],
    ['revision','integer',false],['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_definition_taxonomy: [
    ['space_id','text',false],['definition_id','text',false],['term_id','text',false],
    ['assigned_by_user_id','text',true],['created_at','timestamp with time zone',false],
  ],
  journey_hierarchy_links: [
    ['id','text',false],['space_id','text',false],['link_type','text',false],
    ['from_definition_id','text',false],['to_definition_id','text',false],['from_version_id','text',true],
    ['to_version_id','text',true],['from_stage_key','text',true],['to_stage_key','text',true],
    ['variant_dimension','text',true],['variant_value_id','text',true],['handoff_owner_user_id','text',true],
    ['handoff_owner_team_id','text',true],['review_state','text',false],['reviewed_by_user_id','text',true],
    ['reviewed_at','timestamp with time zone',true],['lifecycle','text',false],['revision','integer',false],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_hierarchy_health_policies: [
    ['id','text',false],['space_id','text',false],['name','text',false],['lifecycle','text',false],
    ['configuration_json','text',false],['configuration_sha256','text',false],['revision','integer',false],
    ['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_hierarchy_health_snapshots: [
    ['id','text',false],['space_id','text',false],['definition_id','text',false],['policy_id','text',false],
    ['policy_version','text',false],['policy_revision','integer',false],
    ['policy_configuration_sha256','text',false],['definition_revision','integer',false],
    ['score','numeric',true],['status','text',false],['explanation','text',false],
    ['components_json','text',false],['child_lineage_json','text',false],
    ['calculated_at','timestamp with time zone',false],
  ],
  journey_blueprint_resources: [
    ['id','text',false],['space_id','text',false],['kind','text',false],['name','text',false],
    ['description','text',false],['owner_user_id','text',true],['lifecycle','text',false],
    ['revision','integer',false],['created_by_user_id','text',true],['updated_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
  ],
  journey_blueprints: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],['name','text',false],
    ['lifecycle','text',false],['owner_user_id','text',true],['owner_team_id','text',true],
    ['current_version_id','text',true],['revision','integer',false],['created_by_user_id','text',true],
    ['updated_by_user_id','text',true],['created_at','timestamp with time zone',false],
    ['updated_at','timestamp with time zone',false],
  ],
  journey_blueprint_versions: [
    ['id','text',false],['blueprint_id','text',false],['space_id','text',false],
    ['journey_definition_id','text',false],['journey_version_id','text',false],
    ['version_number','integer',false],['blueprint_state','text',false],['review_state','text',false],
    ['schema_version','text',false],['snapshot_sha256','text',false],['change_reason','text',true],
    ['actor_user_id','text',true],['created_at','timestamp with time zone',false],
    ['approved_by_user_id','text',true],['approved_at','timestamp with time zone',true],
  ],
  journey_blueprint_stages: [
    ['version_id','text',false],['space_id','text',false],['stage_key','text',false],['name','text',false],
    ['ordinal','integer',false],
  ],
  journey_blueprint_elements: [
    ['id','text',false],['version_id','text',false],['space_id','text',false],['stage_key','text',false],
    ['lane','text',false],['kind','text',false],['title','text',false],['description','text',false],
    ['owner_team_resource_id','text',true],['actor_resource_id','text',true],['system_resource_id','text',true],
    ['vendor_resource_id','text',true],['control_resource_id','text',true],['sla_minutes','numeric',true],
    ['unit_cost','numeric',true],['risk_probability','numeric',true],['risk_impact','numeric',true],
    ['ordinal','integer',false],['evidence_refs_json','text',false],['metric_refs_json','text',false],
  ],
  journey_blueprint_element_resources: [
    ['version_id','text',false],['element_id','text',false],['space_id','text',false],
    ['resource_id','text',false],['role','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_blueprint_relationships: [
    ['id','text',false],['version_id','text',false],['space_id','text',false],['kind','text',false],
    ['from_element_id','text',false],['to_element_id','text',false],['label','text',false],
  ],
  journey_blueprint_portfolio_links: [
    ['id','text',false],['space_id','text',false],['blueprint_version_id','text',false],
    ['element_id','text',false],['portfolio_item_id','text',false],['portfolio_item_revision','integer',false],
    ['relationship','text',false],['created_by_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_blueprint_gap_assessments: [
    ['id','text',false],['space_id','text',false],['blueprint_version_id','text',false],
    ['gap_type','text',false],['target_element_id','text',true],['target_relationship_id','text',true],
    ['severity','text',false],['state','text',false],['reason_code','text',false],['detail_json','text',false],
    ['reviewer_user_id','text',true],['reviewed_at','timestamp with time zone',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_blueprint_comparisons: [
    ['id','text',false],['space_id','text',false],['journey_definition_id','text',false],
    ['from_version_id','text',false],['to_version_id','text',false],['result_json','text',false],
    ['result_sha256','text',false],['actor_user_id','text',true],
    ['created_at','timestamp with time zone',false],
  ],
  journey_hierarchy_operations: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',false],
    ['idempotency_key','text',false],['action','text',false],['intent_sha256','text',false],
    ['response_json','text',false],['created_at','timestamp with time zone',false],
  ],
  journey_hierarchy_activity: [
    ['id','text',false],['space_id','text',false],['actor_user_id','text',true],['action','text',false],
    ['target_kind','text',false],['target_id','text',false],['target_revision','integer',true],
    ['detail_json','text',false],['created_at','timestamp with time zone',false],
  ],
});
const journeyHierarchyBlueprintPrimaryKeys = Object.freeze({
  journey_blueprint_comparisons: ['id'],
  journey_blueprint_element_resources: ['version_id','element_id','resource_id','role'],
  journey_blueprint_elements: ['version_id','id'],
  journey_blueprint_gap_assessments: ['id'],
  journey_blueprint_portfolio_links: ['id'],
  journey_blueprint_relationships: ['version_id','id'],
  journey_blueprint_resources: ['id'],
  journey_blueprint_stages: ['version_id','stage_key'],
  journey_blueprint_versions: ['id'],
  journey_blueprints: ['id'],
  journey_definition_taxonomy: ['space_id','definition_id','term_id'],
  journey_hierarchy_activity: ['id'],
  journey_hierarchy_health_policies: ['id'],
  journey_hierarchy_health_snapshots: ['id'],
  journey_hierarchy_links: ['id'],
  journey_hierarchy_operations: ['id'],
  journey_hierarchy_settings: ['space_id'],
  journey_taxonomy_terms: ['id'],
});
const journeyHierarchyBlueprintRequiredForeignKeys = Object.freeze([
  ['journey_blueprint_comparisons','actor_user_id','users','id','n'],
  ['journey_blueprint_comparisons','from_version_id','journey_blueprint_versions','id','c'],
  ['journey_blueprint_comparisons','journey_definition_id','journey_blueprint_versions','journey_definition_id','c'],
  ['journey_blueprint_comparisons','journey_definition_id','journey_blueprint_versions','journey_definition_id','c'],
  ['journey_blueprint_comparisons','space_id','journey_blueprint_versions','space_id','c'],
  ['journey_blueprint_comparisons','space_id','journey_blueprint_versions','space_id','c'],
  ['journey_blueprint_comparisons','space_id','spaces','id','c'],
  ['journey_blueprint_comparisons','to_version_id','journey_blueprint_versions','id','c'],
  ['journey_blueprint_element_resources','element_id','journey_blueprint_elements','id','c'],
  ['journey_blueprint_element_resources','resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_element_resources','space_id','journey_blueprint_elements','space_id','c'],
  ['journey_blueprint_element_resources','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_element_resources','version_id','journey_blueprint_elements','version_id','c'],
  ['journey_blueprint_elements','actor_resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_elements','control_resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_elements','owner_team_resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_resources','space_id','a'],
  ['journey_blueprint_elements','space_id','journey_blueprint_versions','space_id','c'],
  ['journey_blueprint_elements','stage_key','journey_blueprint_stages','stage_key','c'],
  ['journey_blueprint_elements','system_resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_elements','vendor_resource_id','journey_blueprint_resources','id','a'],
  ['journey_blueprint_elements','version_id','journey_blueprint_stages','version_id','c'],
  ['journey_blueprint_elements','version_id','journey_blueprint_versions','id','c'],
  ['journey_blueprint_gap_assessments','blueprint_version_id','journey_blueprint_elements','version_id','c'],
  ['journey_blueprint_gap_assessments','blueprint_version_id','journey_blueprint_relationships','version_id','c'],
  ['journey_blueprint_gap_assessments','blueprint_version_id','journey_blueprint_versions','id','c'],
  ['journey_blueprint_gap_assessments','reviewer_user_id','users','id','a'],
  ['journey_blueprint_gap_assessments','space_id','journey_blueprint_elements','space_id','c'],
  ['journey_blueprint_gap_assessments','space_id','journey_blueprint_relationships','space_id','c'],
  ['journey_blueprint_gap_assessments','space_id','journey_blueprint_versions','space_id','c'],
  ['journey_blueprint_gap_assessments','space_id','spaces','id','c'],
  ['journey_blueprint_gap_assessments','target_element_id','journey_blueprint_elements','id','c'],
  ['journey_blueprint_gap_assessments','target_relationship_id','journey_blueprint_relationships','id','c'],
  ['journey_blueprint_portfolio_links','blueprint_version_id','journey_blueprint_elements','version_id','c'],
  ['journey_blueprint_portfolio_links','created_by_user_id','users','id','n'],
  ['journey_blueprint_portfolio_links','element_id','journey_blueprint_elements','id','c'],
  ['journey_blueprint_portfolio_links','portfolio_item_id','journey_portfolio_item_versions','item_id','a'],
  ['journey_blueprint_portfolio_links','portfolio_item_revision','journey_portfolio_item_versions','revision','a'],
  ['journey_blueprint_portfolio_links','space_id','journey_blueprint_elements','space_id','c'],
  ['journey_blueprint_portfolio_links','space_id','journey_portfolio_item_versions','space_id','a'],
  ['journey_blueprint_portfolio_links','space_id','spaces','id','c'],
  ['journey_blueprint_relationships','from_element_id','journey_blueprint_elements','id','c'],
  ['journey_blueprint_relationships','space_id','journey_blueprint_elements','space_id','c'],
  ['journey_blueprint_relationships','space_id','journey_blueprint_elements','space_id','c'],
  ['journey_blueprint_relationships','to_element_id','journey_blueprint_elements','id','c'],
  ['journey_blueprint_relationships','version_id','journey_blueprint_elements','version_id','c'],
  ['journey_blueprint_relationships','version_id','journey_blueprint_elements','version_id','c'],
  ['journey_blueprint_resources','created_by_user_id','users','id','n'],
  ['journey_blueprint_resources','owner_user_id','users','id','a'],
  ['journey_blueprint_resources','space_id','spaces','id','c'],
  ['journey_blueprint_resources','updated_by_user_id','users','id','n'],
  ['journey_blueprint_stages','space_id','journey_blueprint_versions','space_id','c'],
  ['journey_blueprint_stages','version_id','journey_blueprint_versions','id','c'],
  ['journey_blueprint_versions','actor_user_id','users','id','n'],
  ['journey_blueprint_versions','approved_by_user_id','users','id','n'],
  ['journey_blueprint_versions','blueprint_id','journey_blueprints','id','c'],
  ['journey_blueprint_versions','journey_definition_id','journey_blueprints','journey_definition_id','c'],
  ['journey_blueprint_versions','journey_definition_id','journey_definitions','id','c'],
  ['journey_blueprint_versions','journey_definition_id','journey_map_versions','definition_id','a'],
  ['journey_blueprint_versions','journey_version_id','journey_map_versions','id','a'],
  ['journey_blueprint_versions','space_id','journey_blueprints','space_id','c'],
  ['journey_blueprint_versions','space_id','journey_definitions','space_id','c'],
  ['journey_blueprint_versions','space_id','journey_map_versions','space_id','a'],
  ['journey_blueprints','created_by_user_id','users','id','n'],
  ['journey_blueprints','current_version_id','journey_blueprint_versions','id','a'],
  ['journey_blueprints','id','journey_blueprint_versions','blueprint_id','a'],
  ['journey_blueprints','journey_definition_id','journey_definitions','id','c'],
  ['journey_blueprints','owner_user_id','users','id','a'],
  ['journey_blueprints','space_id','journey_blueprint_versions','space_id','a'],
  ['journey_blueprints','space_id','journey_definitions','space_id','c'],
  ['journey_blueprints','space_id','spaces','id','c'],
  ['journey_blueprints','updated_by_user_id','users','id','n'],
  ['journey_definition_taxonomy','assigned_by_user_id','users','id','n'],
  ['journey_definition_taxonomy','definition_id','journey_definitions','id','c'],
  ['journey_definition_taxonomy','space_id','journey_definitions','space_id','c'],
  ['journey_definition_taxonomy','space_id','journey_taxonomy_terms','space_id','c'],
  ['journey_definition_taxonomy','term_id','journey_taxonomy_terms','id','c'],
  ['journey_hierarchy_activity','actor_user_id','users','id','n'],
  ['journey_hierarchy_activity','space_id','spaces','id','c'],
  ['journey_hierarchy_health_policies','created_by_user_id','users','id','n'],
  ['journey_hierarchy_health_policies','space_id','spaces','id','c'],
  ['journey_hierarchy_health_policies','updated_by_user_id','users','id','n'],
  ['journey_hierarchy_health_snapshots','definition_id','journey_definitions','id','c'],
  ['journey_hierarchy_health_snapshots','policy_id','journey_hierarchy_health_policies','id','a'],
  ['journey_hierarchy_health_snapshots','space_id','journey_definitions','space_id','c'],
  ['journey_hierarchy_health_snapshots','space_id','journey_hierarchy_health_policies','space_id','a'],
  ['journey_hierarchy_health_snapshots','space_id','spaces','id','c'],
  ['journey_hierarchy_links','created_by_user_id','users','id','n'],
  ['journey_hierarchy_links','from_definition_id','journey_definitions','id','c'],
  ['journey_hierarchy_links','from_definition_id','journey_map_versions','definition_id','a'],
  ['journey_hierarchy_links','from_version_id','journey_map_versions','id','a'],
  ['journey_hierarchy_links','handoff_owner_user_id','users','id','a'],
  ['journey_hierarchy_links','reviewed_by_user_id','users','id','a'],
  ['journey_hierarchy_links','space_id','journey_definitions','space_id','c'],
  ['journey_hierarchy_links','space_id','journey_definitions','space_id','c'],
  ['journey_hierarchy_links','space_id','journey_map_versions','space_id','a'],
  ['journey_hierarchy_links','space_id','journey_map_versions','space_id','a'],
  ['journey_hierarchy_links','space_id','spaces','id','c'],
  ['journey_hierarchy_links','to_definition_id','journey_definitions','id','c'],
  ['journey_hierarchy_links','to_definition_id','journey_map_versions','definition_id','a'],
  ['journey_hierarchy_links','to_version_id','journey_map_versions','id','a'],
  ['journey_hierarchy_links','updated_by_user_id','users','id','n'],
  ['journey_hierarchy_operations','actor_user_id','users','id','a'],
  ['journey_hierarchy_operations','space_id','spaces','id','c'],
  ['journey_hierarchy_settings','space_id','spaces','id','c'],
  ['journey_hierarchy_settings','updated_by_user_id','users','id','n'],
  ['journey_taxonomy_terms','created_by_user_id','users','id','n'],
  ['journey_taxonomy_terms','parent_term_id','journey_taxonomy_terms','id','a'],
  ['journey_taxonomy_terms','space_id','journey_taxonomy_terms','space_id','a'],
  ['journey_taxonomy_terms','space_id','spaces','id','c'],
  ['journey_taxonomy_terms','updated_by_user_id','users','id','n'],
]);
const journeyHierarchyBlueprintRequiredIndexes = Object.freeze({
  journey_blueprint_comparisons_journey: ['create index journey_blueprint_comparisons_journey on public.journey_blueprint_comparisons using btree (space_id, journey_definition_id, created_at desc, id)'],
  journey_blueprint_comparisons_retention: ['create index journey_blueprint_comparisons_retention on public.journey_blueprint_comparisons using btree (created_at, id)'],
  journey_blueprint_element_resources_reverse: ['create index journey_blueprint_element_resources_reverse on public.journey_blueprint_element_resources using btree (space_id, resource_id, role, version_id, element_id)'],
  journey_blueprint_gap_assessments_open: ['create index journey_blueprint_gap_assessments_open on public.journey_blueprint_gap_assessments using btree (space_id, blueprint_version_id, state, severity, gap_type, id)'],
  journey_blueprint_gap_assessments_open_once: ['create unique index journey_blueprint_gap_assessments_open_once on public.journey_blueprint_gap_assessments using btree (blueprint_version_id, gap_type, target_element_id, target_relationship_id) nulls not distinct where (state = \'open\'::text)'],
  journey_blueprint_portfolio_links_reverse: ['create index journey_blueprint_portfolio_links_reverse on public.journey_blueprint_portfolio_links using btree (space_id, portfolio_item_id, relationship, blueprint_version_id, element_id)'],
  journey_blueprint_relationships_incoming: ['create index journey_blueprint_relationships_incoming on public.journey_blueprint_relationships using btree (version_id, to_element_id, kind, from_element_id)'],
  journey_blueprint_resources_query: ['create index journey_blueprint_resources_query on public.journey_blueprint_resources using btree (space_id, kind, lifecycle, name, id)'],
  journey_blueprint_versions_history: ['create index journey_blueprint_versions_history on public.journey_blueprint_versions using btree (space_id, blueprint_id, version_number desc, id)'],
  journey_blueprint_versions_state: ['create index journey_blueprint_versions_state on public.journey_blueprint_versions using btree (space_id, journey_definition_id, blueprint_state, review_state, version_number desc, id)'],
  journey_blueprints_definition: ['create index journey_blueprints_definition on public.journey_blueprints using btree (space_id, journey_definition_id, lifecycle, updated_at desc, id)'],
  journey_definition_taxonomy_reverse: ['create index journey_definition_taxonomy_reverse on public.journey_definition_taxonomy using btree (space_id, term_id, definition_id)'],
  journey_hierarchy_activity_history: ['create index journey_hierarchy_activity_history on public.journey_hierarchy_activity using btree (space_id, target_kind, target_id, created_at desc, id)'],
  journey_hierarchy_activity_retention: ['create index journey_hierarchy_activity_retention on public.journey_hierarchy_activity using btree (created_at, id)'],
  journey_hierarchy_health_history: ['create index journey_hierarchy_health_history on public.journey_hierarchy_health_snapshots using btree (space_id, definition_id, calculated_at desc, id)'],
  journey_hierarchy_health_retention: ['create index journey_hierarchy_health_retention on public.journey_hierarchy_health_snapshots using btree (calculated_at, id)'],
  journey_hierarchy_links_from: ['create index journey_hierarchy_links_from on public.journey_hierarchy_links using btree (space_id, from_definition_id, lifecycle, link_type, to_definition_id)'],
  journey_hierarchy_links_lifecycle: ['create index journey_hierarchy_links_lifecycle on public.journey_hierarchy_links using btree (space_id, lifecycle, id)'],
  journey_hierarchy_links_to: ['create index journey_hierarchy_links_to on public.journey_hierarchy_links using btree (space_id, to_definition_id, lifecycle, link_type, from_definition_id)'],
  journey_taxonomy_terms_children: ['create index journey_taxonomy_terms_children on public.journey_taxonomy_terms using btree (space_id, parent_term_id, lifecycle, id)'],
});
const journeyHierarchyBlueprintRequiredDefaults = Object.freeze({
  'journey_blueprint_elements.description': '\'\'::text',
  'journey_blueprint_elements.evidence_refs_json': '\'[]\'::text',
  'journey_blueprint_elements.metric_refs_json': '\'[]\'::text',
  'journey_blueprint_relationships.label': '\'\'::text',
  'journey_blueprint_resources.description': '\'\'::text',
  'journey_blueprint_resources.lifecycle': '\'active\'::text',
  'journey_blueprint_resources.revision': '1',
  'journey_blueprints.lifecycle': '\'draft\'::text',
  'journey_blueprints.revision': '1',
  'journey_hierarchy_activity.detail_json': '\'{}\'::text',
  'journey_hierarchy_health_policies.revision': '1',
  'journey_hierarchy_links.review_state': '\'draft\'::text',
  'journey_hierarchy_links.lifecycle': '\'active\'::text',
  'journey_hierarchy_links.revision': '1',
  'journey_hierarchy_settings.hierarchy_enabled': 'true',
  'journey_hierarchy_settings.blueprints_enabled': 'true',
  'journey_hierarchy_settings.maximum_depth': '12',
  'journey_hierarchy_settings.maximum_links': '2000',
  'journey_hierarchy_settings.revision': '1',
  'journey_taxonomy_terms.lifecycle': '\'active\'::text',
  'journey_taxonomy_terms.revision': '1',
});
const journeyHierarchyBlueprintRequiredChecks = Object.freeze({
  journey_blueprint_comparisons: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(journey_definition_id) >= 1 and length(journey_definition_id) <= 128)'],
    ['check (from_version_id <> to_version_id)'],
    ['check (octet_length(result_json) <= 262144 and jsonb_typeof(result_json::jsonb) = \'object\'::text)'],
    ['check (result_sha256 ~ \'^[a-f0-9]{64}$\'::text)']
  ],
  journey_blueprint_element_resources: [
    ['check (role = any (array[\'owner_team\'::text, \'actor\'::text, \'system\'::text, \'vendor\'::text, \'policy\'::text, \'control\'::text]))']
  ],
  journey_blueprint_elements: [
    ['check (length(description) <= 10000)'],
    ['check (octet_length(evidence_refs_json) <= 65536 and jsonb_typeof(evidence_refs_json::jsonb) = \'array\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (kind = any (array[\'action\'::text, \'touchpoint\'::text, \'process\'::text, \'system\'::text, \'policy\'::text, \'control\'::text, \'handoff\'::text, \'failure_point\'::text]))'],
    ['check (lane = any (array[\'customer\'::text, \'frontstage\'::text, \'backstage\'::text, \'supporting_system\'::text, \'policy_control\'::text]))'],
    ['check (octet_length(metric_refs_json) <= 65536 and jsonb_typeof(metric_refs_json::jsonb) = \'array\'::text)'],
    ['check (ordinal >= 0)'],
    ['check (risk_impact is null or risk_impact >= 0::numeric and risk_impact <= 1::numeric)'],
    ['check (risk_probability is null or risk_probability >= 0::numeric and risk_probability <= 1::numeric)'],
    ['check (risk_probability is null and risk_impact is null or risk_probability is not null and risk_impact is not null)'],
    ['check (sla_minutes is null or sla_minutes > 0::numeric)'],
    ['check (length(title) >= 1 and length(title) <= 200)'],
    ['check (unit_cost is null or unit_cost >= 0::numeric)']
  ],
  journey_blueprint_gap_assessments: [
    ['check (octet_length(detail_json) <= 16384 and jsonb_typeof(detail_json::jsonb) = \'object\'::text)'],
    ['check (gap_type = any (array[\'owner_missing\'::text, \'handoff_missing\'::text, \'support_missing\'::text, \'control_missing\'::text, \'sla_missing\'::text, \'failure_unmitigated\'::text]))'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(reason_code) >= 1 and length(reason_code) <= 100)'],
    ['check (state = \'open\'::text and reviewer_user_id is null and reviewed_at is null or state <> \'open\'::text and reviewer_user_id is not null and reviewed_at is not null)'],
    ['check (severity = any (array[\'info\'::text, \'warning\'::text, \'critical\'::text]))'],
    ['check (state = any (array[\'open\'::text, \'accepted\'::text, \'resolved\'::text, \'dismissed\'::text]))'],
    ['check (target_element_id is null or target_relationship_id is null)']
  ],
  journey_blueprint_portfolio_links: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (portfolio_item_revision > 0)'],
    ['check (relationship = any (array[\'causes\'::text, \'affected_by\'::text, \'mitigated_by\'::text, \'improved_by\'::text]))']
  ],
  journey_blueprint_relationships: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (kind = any (array[\'supports\'::text, \'depends_on\'::text, \'handoff_to\'::text, \'causes\'::text, \'mitigates\'::text, \'governed_by\'::text]))'],
    ['check (length(label) <= 500)'],
    ['check (from_element_id <> to_element_id)']
  ],
  journey_blueprint_resources: [
    ['check (length(description) <= 5000)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (kind = any (array[\'team\'::text, \'actor\'::text, \'system\'::text, \'vendor\'::text, \'policy\'::text, \'control\'::text]))'],
    ['check (lifecycle = any (array[\'active\'::text, \'retired\'::text]))'],
    ['check (length(name) >= 1 and length(name) <= 200)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
  journey_blueprint_stages: [
    ['check (length(name) >= 1 and length(name) <= 200)'],
    ['check (ordinal >= 0)'],
    ['check (length(stage_key) >= 1 and length(stage_key) <= 80)']
  ],
  journey_blueprint_versions: [
    ['check (review_state = \'approved\'::text and approved_by_user_id is not null and approved_at is not null or review_state <> \'approved\'::text and approved_by_user_id is null and approved_at is null)'],
    ['check (approved_at is null or approved_at >= created_at)'],
    ['check (length(blueprint_id) >= 1 and length(blueprint_id) <= 128)'],
    ['check (blueprint_state = any (array[\'current\'::text, \'future\'::text]))'],
    ['check (change_reason is null or length(change_reason) <= 1000)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(journey_definition_id) >= 1 and length(journey_definition_id) <= 128)'],
    ['check (length(journey_version_id) >= 1 and length(journey_version_id) <= 128)'],
    ['check (review_state = any (array[\'draft\'::text, \'in_review\'::text, \'approved\'::text, \'changes_requested\'::text]))'],
    ['check (schema_version = \'journey-service-blueprint/v1\'::text)'],
    ['check (snapshot_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (version_number > 0)']
  ],
  journey_blueprints: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(journey_definition_id) >= 1 and length(journey_definition_id) <= 128)'],
    ['check (lifecycle = any (array[\'draft\'::text, \'in_review\'::text, \'approved\'::text, \'retired\'::text]))'],
    ['check (length(name) >= 1 and length(name) <= 200)'],
    ['check (owner_team_id is null or length(owner_team_id) >= 1 and length(owner_team_id) <= 128)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
  journey_hierarchy_activity: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (octet_length(detail_json) <= 32768 and jsonb_typeof(detail_json::jsonb) = \'object\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(target_id) >= 1 and length(target_id) <= 128)'],
    ['check (target_kind = any (array[\'taxonomy\'::text, \'hierarchy_link\'::text, \'health\'::text, \'resource\'::text, \'blueprint\'::text, \'blueprint_version\'::text, \'gap\'::text]))'],
    ['check (target_revision is null or target_revision > 0)']
  ],
  journey_hierarchy_health_policies: [
    ['check (octet_length(configuration_json) >= 2 and octet_length(configuration_json) <= 32768 and jsonb_typeof(configuration_json::jsonb) = \'object\'::text)'],
    ['check (configuration_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (lifecycle = any (array[\'draft\'::text, \'active\'::text, \'retired\'::text]))'],
    ['check (length(name) >= 1 and length(name) <= 160)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
  journey_hierarchy_health_snapshots: [
    ['check (policy_configuration_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(child_lineage_json) <= 131072 and jsonb_typeof(child_lineage_json::jsonb) = \'array\'::text)'],
    ['check (octet_length(components_json) <= 65536 and jsonb_typeof(components_json::jsonb) = \'array\'::text)'],
    ['check (length(definition_id) >= 1 and length(definition_id) <= 128)'],
    ['check (definition_revision > 0)'],
    ['check (length(explanation) >= 1 and length(explanation) <= 2000)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (policy_revision > 0)'],
    ['check (length(policy_version) >= 1 and length(policy_version) <= 128)'],
    ['check (score is null or score >= 0::numeric and score <= 100::numeric)'],
    ['check (status = any (array[\'healthy\'::text, \'watch\'::text, \'at_risk\'::text, \'unknown\'::text]))'],
    ['check (status = \'unknown\'::text and score is null or status <> \'unknown\'::text and score is not null)']
  ],
  journey_hierarchy_links: [
    ['check (length(from_definition_id) >= 1 and length(from_definition_id) <= 128)'],
    ['check (from_stage_key is null or length(from_stage_key) >= 1 and length(from_stage_key) <= 80)'],
    ['check (from_version_id is null or length(from_version_id) >= 1 and length(from_version_id) <= 128)'],
    ['check (handoff_owner_team_id is null or length(handoff_owner_team_id) >= 1 and length(handoff_owner_team_id) <= 128)'],
    ['check (handoff_owner_user_id is null or length(handoff_owner_user_id) >= 1 and length(handoff_owner_user_id) <= 128)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check ((octet_length(space_id) + octet_length(from_definition_id) + octet_length(to_definition_id) + coalesce(octet_length(from_stage_key), 0) + coalesce(octet_length(to_stage_key), 0) + coalesce(octet_length(variant_value_id), 0)) <= 1024)'],
    ['check (lifecycle = any (array[\'active\'::text, \'retired\'::text]))'],
    ['check (link_type = any (array[\'parent_child\'::text, \'stage_subjourney\'::text, \'variant\'::text, \'handoff\'::text, \'related\'::text]))'],
    ['check (from_definition_id <> to_definition_id)'],
    ['check (review_state = \'draft\'::text and reviewed_by_user_id is null and reviewed_at is null or review_state <> \'draft\'::text and reviewed_by_user_id is not null and reviewed_at is not null)'],
    ['check (review_state = any (array[\'draft\'::text, \'in_review\'::text, \'approved\'::text, \'changes_requested\'::text]))'],
    ['check (reviewed_at is null or reviewed_at >= created_at)'],
    ['check (revision > 0)'],
    ['check (link_type = \'stage_subjourney\'::text and from_stage_key is not null and to_stage_key is null and variant_dimension is null and variant_value_id is null or link_type = \'handoff\'::text and from_stage_key is not null and to_stage_key is not null and variant_dimension is null and variant_value_id is null or link_type = \'variant\'::text and from_stage_key is null and to_stage_key is null and variant_dimension is not null and variant_value_id is not null or (link_type = any (array[\'parent_child\'::text, \'related\'::text])) and from_stage_key is null and to_stage_key is null and variant_dimension is null and variant_value_id is null)'],
    ['check (updated_at >= created_at)'],
    ['check (length(to_definition_id) >= 1 and length(to_definition_id) <= 128)'],
    ['check (to_stage_key is null or length(to_stage_key) >= 1 and length(to_stage_key) <= 80)'],
    ['check (to_version_id is null or length(to_version_id) >= 1 and length(to_version_id) <= 128)'],
    ['check (variant_dimension is null or (variant_dimension = any (array[\'persona\'::text, \'segment\'::text, \'product\'::text, \'geography\'::text, \'channel\'::text])))'],
    ['check (variant_value_id is null or length(variant_value_id) >= 1 and length(variant_value_id) <= 128)']
  ],
  journey_hierarchy_operations: [
    ['check (length(action) >= 1 and length(action) <= 100)'],
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (length(idempotency_key) >= 1 and length(idempotency_key) <= 200)'],
    ['check (intent_sha256 ~ \'^[a-f0-9]{64}$\'::text)'],
    ['check (octet_length(response_json) <= 131072 and jsonb_typeof(response_json::jsonb) = \'object\'::text)']
  ],
  journey_hierarchy_settings: [
    ['check (maximum_depth >= 1 and maximum_depth <= 32)'],
    ['check (maximum_links >= 1 and maximum_links <= 100000)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
  journey_taxonomy_terms: [
    ['check (length(id) >= 1 and length(id) <= 128)'],
    ['check (kind = any (array[\'product\'::text, \'geography\'::text, \'channel\'::text, \'segment\'::text, \'tag\'::text, \'business_unit\'::text]))'],
    ['check (lifecycle = any (array[\'active\'::text, \'retired\'::text]))'],
    ['check (length(name) >= 1 and length(name) <= 160)'],
    ['check (parent_term_id is null or parent_term_id <> id)'],
    ['check (length(normalized_name) >= 1 and length(normalized_name) <= 160)'],
    ['check (revision > 0)'],
    ['check (updated_at >= created_at)']
  ],
});
const journeyHierarchyBlueprintRequiredConstraints = Object.freeze({
  journey_blueprint_comparisons_from_fk: ['foreign key (from_version_id, space_id, journey_definition_id) references journey_blueprint_versions(id, space_id, journey_definition_id) on delete cascade'],
  journey_blueprint_comparisons_pair_once: ['unique (space_id, from_version_id, to_version_id, result_sha256)'],
  journey_blueprint_comparisons_tenant_identity: ['unique (id, space_id)'],
  journey_blueprint_comparisons_to_fk: ['foreign key (to_version_id, space_id, journey_definition_id) references journey_blueprint_versions(id, space_id, journey_definition_id) on delete cascade'],
  journey_blueprint_element_resources_element_fk: ['foreign key (element_id, version_id, space_id) references journey_blueprint_elements(id, version_id, space_id) on delete cascade'],
  journey_blueprint_element_resources_resource_fk: ['foreign key (resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_actor_fk: ['foreign key (actor_resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_control_fk: ['foreign key (control_resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_owner_team_fk: ['foreign key (owner_team_resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_position_once: ['unique (version_id, stage_key, lane, ordinal)'],
  journey_blueprint_elements_stage_fk: ['foreign key (version_id, stage_key) references journey_blueprint_stages(version_id, stage_key) on delete cascade'],
  journey_blueprint_elements_system_fk: ['foreign key (system_resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_tenant_identity: ['unique (id, version_id, space_id)'],
  journey_blueprint_elements_vendor_fk: ['foreign key (vendor_resource_id, space_id) references journey_blueprint_resources(id, space_id)'],
  journey_blueprint_elements_version_fk: ['foreign key (version_id, space_id) references journey_blueprint_versions(id, space_id) on delete cascade'],
  journey_blueprint_gap_assessments_element_fk: ['foreign key (target_element_id, blueprint_version_id, space_id) references journey_blueprint_elements(id, version_id, space_id) on delete cascade'],
  journey_blueprint_gap_assessments_relationship_fk: ['foreign key (target_relationship_id, blueprint_version_id, space_id) references journey_blueprint_relationships(id, version_id, space_id) on delete cascade'],
  journey_blueprint_gap_assessments_tenant_identity: ['unique (id, space_id)'],
  journey_blueprint_gap_assessments_version_fk: ['foreign key (blueprint_version_id, space_id) references journey_blueprint_versions(id, space_id) on delete cascade'],
  journey_blueprint_portfolio_links_element_fk: ['foreign key (element_id, blueprint_version_id, space_id) references journey_blueprint_elements(id, version_id, space_id) on delete cascade'],
  journey_blueprint_portfolio_links_item_version_fk: ['foreign key (portfolio_item_id, space_id, portfolio_item_revision) references journey_portfolio_item_versions(item_id, space_id, revision)'],
  journey_blueprint_portfolio_links_once: ['unique (space_id, blueprint_version_id, element_id, portfolio_item_id, relationship)'],
  journey_blueprint_portfolio_links_tenant_identity: ['unique (id, space_id)'],
  journey_blueprint_relationships_edge_once: ['unique (version_id, kind, from_element_id, to_element_id)'],
  journey_blueprint_relationships_from_fk: ['foreign key (from_element_id, version_id, space_id) references journey_blueprint_elements(id, version_id, space_id) on delete cascade'],
  journey_blueprint_relationships_tenant_identity: ['unique (id, version_id, space_id)'],
  journey_blueprint_relationships_to_fk: ['foreign key (to_element_id, version_id, space_id) references journey_blueprint_elements(id, version_id, space_id) on delete cascade'],
  journey_blueprint_resources_tenant_identity: ['unique (id, space_id)'],
  journey_blueprint_stages_ordinal_once: ['unique (version_id, ordinal)'],
  journey_blueprint_stages_version_fk: ['foreign key (version_id, space_id) references journey_blueprint_versions(id, space_id) on delete cascade'],
  journey_blueprint_versions_current_identity: ['unique (id, blueprint_id, space_id)'],
  journey_blueprint_versions_definition_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_blueprint_versions_journey_identity: ['unique (id, space_id, journey_definition_id)'],
  journey_blueprint_versions_map_version_fk: ['foreign key (journey_version_id, journey_definition_id, space_id) references journey_map_versions(id, definition_id, space_id)'],
  journey_blueprint_versions_number: ['unique (blueprint_id, space_id, version_number)'],
  journey_blueprint_versions_parent_fk: ['foreign key (blueprint_id, space_id, journey_definition_id) references journey_blueprints(id, space_id, journey_definition_id) on delete cascade'],
  journey_blueprint_versions_tenant_identity: ['unique (id, space_id)'],
  journey_blueprints_current_version_fk: ['foreign key (current_version_id, id, space_id) references journey_blueprint_versions(id, blueprint_id, space_id) deferrable initially deferred'],
  journey_blueprints_definition_fk: ['foreign key (journey_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_blueprints_journey_identity: ['unique (id, space_id, journey_definition_id)'],
  journey_blueprints_tenant_identity: ['unique (id, space_id)'],
  journey_definition_taxonomy_definition_fk: ['foreign key (definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_definition_taxonomy_term_fk: ['foreign key (term_id, space_id) references journey_taxonomy_terms(id, space_id) on delete cascade'],
  journey_hierarchy_activity_tenant_identity: ['unique (id, space_id)'],
  journey_hierarchy_health_policies_tenant_identity: ['unique (id, space_id)'],
  journey_hierarchy_health_snapshots_definition_fk: ['foreign key (definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_hierarchy_health_snapshots_policy_fk: ['foreign key (policy_id, space_id) references journey_hierarchy_health_policies(id, space_id)'],
  journey_hierarchy_health_snapshots_tenant_identity: ['unique (id, space_id)'],
  journey_hierarchy_links_from_definition_fk: ['foreign key (from_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_hierarchy_links_from_version_fk: ['foreign key (from_version_id, from_definition_id, space_id) references journey_map_versions(id, definition_id, space_id)'],
  journey_hierarchy_links_logical_once: ['unique nulls not distinct (space_id, link_type, from_definition_id, to_definition_id, from_stage_key, to_stage_key, variant_dimension, variant_value_id)'],
  journey_hierarchy_links_tenant_identity: ['unique (id, space_id)'],
  journey_hierarchy_links_to_definition_fk: ['foreign key (to_definition_id, space_id) references journey_definitions(id, space_id) on delete cascade'],
  journey_hierarchy_links_to_version_fk: ['foreign key (to_version_id, to_definition_id, space_id) references journey_map_versions(id, definition_id, space_id)'],
  journey_hierarchy_operations_idempotency: ['unique (space_id, actor_user_id, idempotency_key)'],
  journey_hierarchy_operations_tenant_identity: ['unique (id, space_id)'],
  journey_taxonomy_terms_name_once: ['unique (space_id, kind, normalized_name)'],
  journey_taxonomy_terms_parent_tenant_fk: ['foreign key (parent_term_id, space_id) references journey_taxonomy_terms(id, space_id)'],
  journey_taxonomy_terms_tenant_identity: ['unique (id, space_id)'],
});
const journeyHierarchyBlueprintRequiredTriggers = Object.freeze({
  journey_blueprint_comparison_guard: ['journey_blueprint_comparisons','journey_blueprint_comparison_guard'],
  journey_blueprint_comparisons_append_only: ['journey_blueprint_comparisons','journey_hierarchy_append_only_guard'],
  journey_blueprint_element_append_only: ['journey_blueprint_elements','journey_hierarchy_append_only_guard'],
  journey_blueprint_element_resource_append_only: ['journey_blueprint_element_resources','journey_hierarchy_append_only_guard'],
  journey_blueprint_element_resource_kind_guard: ['journey_blueprint_elements','journey_blueprint_element_resource_kind_guard'],
  journey_blueprint_element_resource_role_guard: ['journey_blueprint_element_resources','journey_blueprint_element_resource_role_guard'],
  journey_blueprint_gap_assessments_reviewer_membership_guard: ['journey_blueprint_gap_assessments','journey_hierarchy_membership_guard'],
  journey_blueprint_portfolio_link_guard: ['journey_blueprint_portfolio_links','journey_blueprint_portfolio_link_guard'],
  journey_blueprint_relationships_append_only: ['journey_blueprint_relationships','journey_hierarchy_append_only_guard'],
  journey_blueprint_resources_owner_membership_guard: ['journey_blueprint_resources','journey_hierarchy_membership_guard'],
  journey_blueprint_stages_append_only: ['journey_blueprint_stages','journey_hierarchy_append_only_guard'],
  journey_blueprint_versions_append_only: ['journey_blueprint_versions','journey_hierarchy_append_only_guard'],
  journey_blueprint_versions_settings_guard: ['journey_blueprint_versions','journey_blueprint_versions_settings_guard'],
  journey_blueprints_owner_membership_guard: ['journey_blueprints','journey_hierarchy_membership_guard'],
  journey_definition_taxonomy_guard: ['journey_definition_taxonomy','journey_definition_taxonomy_guard'],
  journey_hierarchy_activity_append_only: ['journey_hierarchy_activity','journey_hierarchy_append_only_guard'],
  journey_hierarchy_health_snapshots_append_only: ['journey_hierarchy_health_snapshots','journey_hierarchy_append_only_guard'],
  journey_hierarchy_link_guard: ['journey_hierarchy_links','journey_hierarchy_link_guard'],
  journey_hierarchy_links_handoff_owner_membership_guard: ['journey_hierarchy_links','journey_hierarchy_membership_guard'],
  journey_hierarchy_links_reviewer_membership_guard: ['journey_hierarchy_links','journey_hierarchy_membership_guard'],
  journey_hierarchy_operations_append_only: ['journey_hierarchy_operations','journey_hierarchy_append_only_guard'],
  journey_taxonomy_parent_guard: ['journey_taxonomy_terms','journey_taxonomy_parent_guard'],
});
const journeyPortfolioRuntime34RequiredConstraints = Object.freeze({
  journey_portfolio_items_owner_user_fk: [
    'foreign key (owner_user_id) references users(id)'
  ]
});
const journeyPortfolioRuntime34RequiredTriggers = Object.freeze({
  journey_portfolio_items_owner_membership_guard: [
    'journey_portfolio_items','journey_portfolio_owner_membership_guard'
  ]
});
const journeyOrchestrationRequiredTriggers = Object.freeze({
  journey_workflow_versions_append_only: ['journey_workflow_versions','journey_orchestration_append_only_guard'],
  journey_workflow_runs_append_only: ['journey_workflow_runs','journey_orchestration_append_only_guard'],
  journey_workflow_actions_append_only: ['journey_workflow_actions','journey_orchestration_append_only_guard'],
  journey_workflow_approvals_append_only: ['journey_workflow_approvals','journey_orchestration_append_only_guard'],
  journey_workflow_outbox_append_only: ['journey_workflow_outbox','journey_orchestration_append_only_guard'],
  journey_workflow_audit_append_only: ['journey_workflow_audit','journey_orchestration_append_only_guard']
});
const journeyActionRuntimeRequiredTriggers = Object.freeze({
  journey_action_gate_resolutions_append_only: ['journey_action_gate_resolutions','journey_orchestration_append_only_guard'],
  journey_action_attempts_append_only: ['journey_action_attempts','journey_orchestration_append_only_guard'],
  journey_action_effect_receipts_append_only: ['journey_action_effect_receipts','journey_orchestration_append_only_guard']
});
const journeyConnectorImportRequiredTriggers = Object.freeze({
  journey_connector_receipts_append_only: ['journey_connector_item_receipts','journey_connector_append_only_guard'],
  journey_connector_audit_append_only: ['journey_connector_audit','journey_connector_append_only_guard']
});
const journeyReviewedAdapterRequiredTriggers = Object.freeze({
  journey_adapter_execution_attempts_append_only: ['journey_adapter_execution_attempts','journey_orchestration_append_only_guard'],
  journey_adapter_effect_receipts_append_only: ['journey_adapter_effect_receipts','journey_orchestration_append_only_guard'],
  journey_adapter_internal_notifications_append_only: ['journey_adapter_internal_notifications','journey_orchestration_append_only_guard']
});
const journeyPredictiveGovernanceRequiredTriggers = Object.freeze({
  journey_predictive_versions_append_only: ['journey_predictive_model_versions','journey_orchestration_append_only_guard'],
  journey_prediction_drift_append_only: ['journey_prediction_drift_evaluations','journey_orchestration_append_only_guard'],
  journey_prediction_runs_append_only: ['journey_prediction_runs','journey_orchestration_append_only_guard'],
  journey_prediction_audit_append_only: ['journey_prediction_audit','journey_orchestration_append_only_guard']
});
const journeyKillSwitchRequiredTriggers = Object.freeze({
  journey_kill_switch_mutations_append_only: ['journey_kill_switch_mutations','journey_orchestration_append_only_guard'],
  journey_kill_switch_pauses_append_only: ['journey_kill_switch_pauses','journey_orchestration_append_only_guard'],
  journey_kill_switch_resumptions_append_only: ['journey_kill_switch_resumptions','journey_orchestration_append_only_guard'],
  journey_kill_switch_audit_append_only: ['journey_kill_switch_audit','journey_orchestration_append_only_guard']
});
const journeyStageIntelligenceRequiredTriggers = Object.freeze({
  journey_stage_intelligence_policy_history_append_only: [
    'journey_stage_intelligence_policy_history','journey_orchestration_append_only_guard'
  ],
  journey_stage_intelligence_facts_append_only: [
    'journey_stage_intelligence_facts','journey_orchestration_append_only_guard'
  ],
  journey_stage_intelligence_facts_retention_delete: [
    'journey_stage_intelligence_facts','journey_stage_intelligence_retention_delete_guard'
  ],
  journey_stage_intelligence_audit_append_only: [
    'journey_stage_intelligence_audit','journey_orchestration_append_only_guard'
  ]
});
const journeyActionWorkerSafetyRequiredTriggers = Object.freeze({
  journey_worker_service_key_audit_append_only:['journey_worker_service_key_audit','journey_worker_safety_append_only_guard'],
  journey_action_live_contexts_append_only:['journey_action_live_contexts','journey_worker_safety_append_only_guard'],
  journey_action_worker_reservation_events_append_only:['journey_action_worker_reservation_events','journey_worker_safety_append_only_guard'],
  journey_worker_service_principals_lifecycle:['journey_worker_service_principals','journey_worker_service_principal_lifecycle_guard'],
  journey_action_worker_reservations_fenced:['journey_action_worker_reservations','journey_action_worker_reservation_fence_guard'],
  journey_action_quota_counters_monotonic:['journey_action_quota_counters','journey_action_safety_counter_guard'],
  journey_action_frequency_counters_monotonic:['journey_action_frequency_counters','journey_action_safety_counter_guard']
});
const journeyStageSurveyFeedRequiredTriggers = Object.freeze({
  journey_stage_source_mapping_versions_append_only: [
    'journey_stage_source_mapping_versions','journey_orchestration_append_only_guard'],
  journey_stage_survey_policy_versions_append_only: [
    'journey_stage_survey_policy_versions','journey_orchestration_append_only_guard'],
  journey_stage_survey_governance_receipts_append_only: [
    'journey_stage_survey_governance_receipts','journey_stage_survey_retention_delete_guard'],
  journey_stage_survey_source_revisions_append_only: [
    'journey_stage_survey_source_revisions','journey_stage_survey_retention_delete_guard'],
  journey_stage_survey_outbox_attempts_append_only: [
    'journey_stage_survey_outbox_attempts','journey_stage_survey_retention_delete_guard'],
  journey_stage_survey_feed_audit_append_only: [
    'journey_stage_survey_feed_audit','journey_orchestration_append_only_guard']
});
const journeyEventIntelligenceRequiredTriggers = Object.freeze({
  journey_event_intelligence_visit_outbox: [
    'journey_anonymous_stage_visits','journey_event_intelligence_enqueue_visit'],
  journey_event_intelligence_mapping_versions_append_only: [
    'journey_event_intelligence_mapping_versions','journey_orchestration_append_only_guard'],
  journey_event_intelligence_tombstones_append_only: [
    'journey_event_intelligence_tombstones','journey_orchestration_append_only_guard'],
  journey_event_intelligence_erasure_handles_append_only: [
    'journey_event_intelligence_erasure_handles','journey_orchestration_append_only_guard']
});
const journeyPortfolioRuntime46RequiredTriggers = Object.freeze({
  journey_portfolio_view_versions_guard: [
    'journey_portfolio_view_versions','journey_portfolio_runtime46_guard'],
  journey_portfolio_transition_events_guard: [
    'journey_portfolio_transition_events','journey_portfolio_runtime46_guard'],
  journey_portfolio_transition_request_guard: [
    'journey_portfolio_transition_requests','journey_portfolio_runtime46_guard'],
  journey_portfolio_view_preference_guard: [
    'journey_portfolio_view_preferences','journey_portfolio_view_preference_guard']
});
const journeyPrivacyRuntime47RequiredTriggers = Object.freeze({
  journey_privacy_principal_scope: ['journey_privacy_service_principals','journey_privacy_principal_scope_guard'],
  journey_privacy_principal_guard: ['journey_privacy_service_principals','journey_privacy_runtime47_guard'],
  journey_privacy_key_audit_guard: ['journey_privacy_service_key_audit','journey_privacy_runtime47_guard'],
  journey_privacy_authority_scope: ['journey_privacy_erasure_authorities','journey_privacy_authority_scope_guard'],
  journey_privacy_authority_guard: ['journey_privacy_erasure_authorities','journey_privacy_runtime47_guard'],
  journey_privacy_claim_guard: ['journey_privacy_propagation_claims','journey_privacy_runtime47_guard'],
  journey_privacy_event_guard: ['journey_privacy_propagation_events','journey_privacy_runtime47_guard']
});
const journeyBlueprintMeasurementRuntime48RequiredTriggers = Object.freeze({
  journey_blueprint_measurement_plan_lineage: [
    'journey_blueprint_measurement_plans','journey_blueprint_measurement_lineage_guard'],
  journey_blueprint_measurement_outcome_lineage: [
    'journey_blueprint_measurement_outcomes','journey_blueprint_measurement_lineage_guard'],
  journey_blueprint_measurement_plan_guard: [
    'journey_blueprint_measurement_plans','journey_blueprint_measurement_immutability_guard'],
  journey_blueprint_measurement_outcome_guard: [
    'journey_blueprint_measurement_outcomes','journey_blueprint_measurement_immutability_guard'],
  journey_blueprint_measurement_audit_guard: [
    'journey_blueprint_measurement_audit','journey_blueprint_measurement_immutability_guard']
});
const journeyExportBrandRuntime49RequiredTriggers = Object.freeze({
  journey_export_brand_versions_immutable: [
    'journey_export_brand_profile_versions','journey_export_brand_append_only_guard'],
  journey_export_brand_operations_immutable: [
    'journey_export_brand_operations','journey_export_brand_append_only_guard'],
  journey_export_brand_audit_immutable: [
    'journey_export_brand_audit_events','journey_export_brand_append_only_guard']
});
const journeyActualPathRuntime50RequiredTriggers = Object.freeze({
  journey_actual_path_snapshots_update_guard: [
    'journey_actual_path_snapshots','journey_actual_path_runtime50_immutable_guard'],
  journey_actual_path_artifact_revisions_guard: [
    'journey_actual_path_artifact_revisions','journey_actual_path_runtime50_immutable_guard'],
  journey_actual_path_privacy_invalidations_guard: [
    'journey_actual_path_privacy_invalidations','journey_actual_path_runtime50_immutable_guard']
});
const journeyTaxonomyRetirementRequiredTriggers = Object.freeze({
  journey_taxonomy_assignment_lifecycle_guard: [
    'journey_definition_taxonomy','journey_taxonomy_assignment_lifecycle_guard'
  ],
  journey_taxonomy_retirement_assignment_guard: [
    'journey_taxonomy_terms','journey_taxonomy_assignment_lifecycle_guard'
  ]
});
export const journeyHierarchyBlueprintRuntimeContract = Object.freeze({
  columns: journeyHierarchyBlueprintExactColumns, primaryKeys: journeyHierarchyBlueprintPrimaryKeys,
  foreignKeys: journeyHierarchyBlueprintRequiredForeignKeys, indexes: journeyHierarchyBlueprintRequiredIndexes,
  defaults: journeyHierarchyBlueprintRequiredDefaults, checks: journeyHierarchyBlueprintRequiredChecks,
  constraints: journeyHierarchyBlueprintRequiredConstraints, triggers: journeyHierarchyBlueprintRequiredTriggers
});
// runtime 29

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function normalized(value) { return String(value || '').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function key(parts) { return parts.join('|'); }
function textArray(value) {
  if (Array.isArray(value)) return value.map(String);
  const source = String(value || '');
  if (source.startsWith('{') && source.endsWith('}')) {
    return source.slice(1, -1).split(',').filter(Boolean).map((entry) => entry.replace(/^"|"$/gu, ''));
  }
  return source ? [source] : [];
}

async function rows(query, sql) {
  const result = await query(sql);
  return Array.isArray(result) ? result : result?.rows || [];
}

export async function assertRuntimeSchemaContract(query, options = {}) {
  const schema = String(options.schema || 'public');
  if (!IDENTIFIER.test(schema)) throw contractError('RUNTIME_SCHEMA_IDENTIFIER_INVALID', `Unsafe PostgreSQL schema identifier: ${schema}`);
  const runtimeVersion = Number(options.runtimeVersion ?? LATEST_RUNTIME_SCHEMA_VERSION);
  if (!Number.isSafeInteger(runtimeVersion) || runtimeVersion < 1) {
    throw contractError('RUNTIME_SCHEMA_VERSION_INVALID', 'Runtime schema contract version must be a positive integer.');
  }
  const journeyMapTables = runtimeVersion >= 12;
  const journeyTemplateTables = runtimeVersion >= 13;
  const journeyEvidenceLifecycleTables = runtimeVersion >= 14;
  const usageLedgerTables = runtimeVersion >= 15;
  const journeyEventControlPlaneTables = runtimeVersion >= 16;
  const journeyEventDataPlaneTables = runtimeVersion >= 17;
  const journeyStageProcessingTables = runtimeVersion >= 18;
  const journeyResearchHubTables = runtimeVersion >= 19;
  const journeyV2RolloutTables = runtimeVersion >= 20;
  const journeyMetricTables = runtimeVersion >= 21;
  const journeyAiSuggestionTables = runtimeVersion >= 22;
  const journeyPersonaVersionTables = runtimeVersion >= 23;
  const journeyRichCardTables = runtimeVersion >= 24;
  const journeyMetricAlertTables = runtimeVersion >= 25;
  const journeySavedViewTables = runtimeVersion >= 26;
  const journeyPortfolioTables = runtimeVersion >= 27;
  const journeyCollaborationTables = runtimeVersion >= 28;
  const journeyHierarchyBlueprintTables = runtimeVersion >= 29;
  const exactColumnContract = runtimeVersion >= 10
    ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns, ...reviewedIntelligenceExactColumns, ...reviewedReplyExactColumns, ...adminControlExactColumns, ...managedPlanExactColumns, ...deepAnalysisExactColumns }
    : runtimeVersion >= 9
    ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns, ...reviewedIntelligenceExactColumns, ...reviewedReplyExactColumns, ...adminControlExactColumns, ...managedPlanExactColumns }
    : runtimeVersion >= 8
    ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns, ...reviewedIntelligenceExactColumns, ...reviewedReplyExactColumns, ...adminControlExactColumns }
    : runtimeVersion >= 7
    ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns, ...reviewedIntelligenceExactColumns, ...reviewedReplyExactColumns }
    : runtimeVersion >= 6
    ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns, ...reviewedIntelligenceExactColumns }
    : runtimeVersion >= 5 ? { ...exactColumns, ...assistantExactColumns, ...assistantPhase1ExactColumns }
    : runtimeVersion >= 4 ? { ...exactColumns, ...assistantExactColumns } : exactColumns;
  if (journeyMapTables) Object.assign(exactColumnContract, journeyMapExactColumns);
  if (journeyTemplateTables) Object.assign(exactColumnContract, journeyTemplateExactColumns);
  if (journeyEvidenceLifecycleTables) Object.assign(exactColumnContract, journeyEvidenceLifecycleExactColumns);
  if (usageLedgerTables) Object.assign(exactColumnContract, usageLedgerExactColumns);
  if (journeyEventControlPlaneTables) Object.assign(exactColumnContract, journeyEventControlPlaneExactColumns);
  if (journeyEventDataPlaneTables) Object.assign(exactColumnContract, journeyEventDataPlaneExactColumns);
  if (journeyStageProcessingTables) Object.assign(exactColumnContract, journeyStageProcessingExactColumns);
  if (journeyResearchHubTables) Object.assign(exactColumnContract, journeyResearchHubExactColumns);
  if (journeyV2RolloutTables) Object.assign(exactColumnContract, journeyV2RolloutExactColumns);
  if (journeyMetricTables) Object.assign(exactColumnContract, journeyMetricExactColumns);
  if (journeyAiSuggestionTables) Object.assign(exactColumnContract, journeyAiSuggestionExactColumns);
  if (journeyPersonaVersionTables) {
    exactColumnContract.journey_personas = journeyPersonaRootRuntime23Columns;
    Object.assign(exactColumnContract, journeyPersonaVersionExactColumns);
  }
  if (journeyRichCardTables) Object.assign(exactColumnContract, journeyRichCardExactColumns);
  if (journeyMetricAlertTables) Object.assign(exactColumnContract, journeyMetricAlertExactColumns);
  if (journeySavedViewTables) Object.assign(exactColumnContract, journeySavedViewExactColumns);
  if (journeyPortfolioTables) Object.assign(exactColumnContract, journeyPortfolioExactColumns);
  if (journeyCollaborationTables) Object.assign(exactColumnContract, journeyCollaborationExactColumns);
  if (journeyHierarchyBlueprintTables) Object.assign(exactColumnContract, journeyHierarchyBlueprintExactColumns);
  const primaryKeyContract = runtimeVersion >= 10
    ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys, ...reviewedIntelligencePrimaryKeys, ...reviewedReplyPrimaryKeys, ...adminControlPrimaryKeys, ...managedPlanPrimaryKeys, ...deepAnalysisPrimaryKeys }
    : runtimeVersion >= 9
    ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys, ...reviewedIntelligencePrimaryKeys, ...reviewedReplyPrimaryKeys, ...adminControlPrimaryKeys, ...managedPlanPrimaryKeys }
    : runtimeVersion >= 8
    ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys, ...reviewedIntelligencePrimaryKeys, ...reviewedReplyPrimaryKeys, ...adminControlPrimaryKeys }
    : runtimeVersion >= 7
    ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys, ...reviewedIntelligencePrimaryKeys, ...reviewedReplyPrimaryKeys }
    : runtimeVersion >= 6
    ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys, ...reviewedIntelligencePrimaryKeys }
    : runtimeVersion >= 5 ? { ...primaryKeys, ...assistantPrimaryKeys, ...assistantPhase1PrimaryKeys }
    : runtimeVersion >= 4 ? { ...primaryKeys, ...assistantPrimaryKeys } : primaryKeys;
  if (journeyMapTables) Object.assign(primaryKeyContract, journeyMapPrimaryKeys);
  if (journeyTemplateTables) Object.assign(primaryKeyContract, journeyTemplatePrimaryKeys);
  if (journeyEvidenceLifecycleTables) Object.assign(primaryKeyContract, journeyEvidenceLifecyclePrimaryKeys);
  if (usageLedgerTables) Object.assign(primaryKeyContract, usageLedgerPrimaryKeys);
  if (journeyEventControlPlaneTables) Object.assign(primaryKeyContract, journeyEventControlPlanePrimaryKeys);
  if (journeyEventDataPlaneTables) Object.assign(primaryKeyContract, journeyEventDataPlanePrimaryKeys);
  if (journeyStageProcessingTables) Object.assign(primaryKeyContract, journeyStageProcessingPrimaryKeys);
  if (journeyResearchHubTables) Object.assign(primaryKeyContract, journeyResearchHubPrimaryKeys);
  if (journeyV2RolloutTables) Object.assign(primaryKeyContract, journeyV2RolloutPrimaryKeys);
  if (journeyMetricTables) Object.assign(primaryKeyContract, journeyMetricPrimaryKeys);
  if (journeyAiSuggestionTables) Object.assign(primaryKeyContract, journeyAiSuggestionPrimaryKeys);
  if (journeyPersonaVersionTables) Object.assign(primaryKeyContract, journeyPersonaVersionPrimaryKeys);
  if (journeyRichCardTables) Object.assign(primaryKeyContract, journeyRichCardPrimaryKeys);
  if (journeyMetricAlertTables) Object.assign(primaryKeyContract, journeyMetricAlertPrimaryKeys);
  if (journeySavedViewTables) Object.assign(primaryKeyContract, journeySavedViewPrimaryKeys);
  if (journeyPortfolioTables) Object.assign(primaryKeyContract, journeyPortfolioPrimaryKeys);
  if (journeyCollaborationTables) Object.assign(primaryKeyContract, journeyCollaborationPrimaryKeys);
  if (journeyHierarchyBlueprintTables) Object.assign(primaryKeyContract, journeyHierarchyBlueprintPrimaryKeys);
  const foreignKeyContract = runtimeVersion >= 10
    ? [...requiredForeignKeys, ...assistantRequiredForeignKeys, ...assistantPhase1RequiredForeignKeys, ...reviewedIntelligenceRequiredForeignKeys, ...reviewedReplyRequiredForeignKeys, ...adminControlRequiredForeignKeys, ...deepAnalysisRequiredForeignKeys]
    : runtimeVersion >= 8
    ? [...requiredForeignKeys, ...assistantRequiredForeignKeys, ...assistantPhase1RequiredForeignKeys, ...reviewedIntelligenceRequiredForeignKeys, ...reviewedReplyRequiredForeignKeys, ...adminControlRequiredForeignKeys]
    : runtimeVersion >= 7
    ? [...requiredForeignKeys, ...assistantRequiredForeignKeys, ...assistantPhase1RequiredForeignKeys, ...reviewedIntelligenceRequiredForeignKeys, ...reviewedReplyRequiredForeignKeys]
    : runtimeVersion >= 6
    ? [...requiredForeignKeys, ...assistantRequiredForeignKeys, ...assistantPhase1RequiredForeignKeys, ...reviewedIntelligenceRequiredForeignKeys]
    : runtimeVersion >= 5 ? [...requiredForeignKeys, ...assistantRequiredForeignKeys, ...assistantPhase1RequiredForeignKeys]
    : runtimeVersion >= 4 ? [...requiredForeignKeys, ...assistantRequiredForeignKeys] : requiredForeignKeys;
  if (journeyMapTables) foreignKeyContract.push(...journeyMapRequiredForeignKeys);
  if (journeyTemplateTables) foreignKeyContract.push(...journeyTemplateRequiredForeignKeys);
  if (journeyEvidenceLifecycleTables) foreignKeyContract.push(...journeyEvidenceLifecycleRequiredForeignKeys);
  if (usageLedgerTables) foreignKeyContract.push(...usageLedgerRequiredForeignKeys);
  if (journeyEventControlPlaneTables) foreignKeyContract.push(...journeyEventControlPlaneRequiredForeignKeys);
  if (journeyEventDataPlaneTables) foreignKeyContract.push(...journeyEventDataPlaneRequiredForeignKeys);
  if (journeyStageProcessingTables) foreignKeyContract.push(...journeyStageProcessingRequiredForeignKeys);
  if (journeyResearchHubTables) foreignKeyContract.push(...journeyResearchHubRequiredForeignKeys);
  if (journeyV2RolloutTables) foreignKeyContract.push(...journeyV2RolloutRequiredForeignKeys);
  if (journeyMetricTables) foreignKeyContract.push(...journeyMetricRequiredForeignKeys);
  if (journeyAiSuggestionTables) foreignKeyContract.push(...journeyAiSuggestionRequiredForeignKeys);
  if (journeyPersonaVersionTables) foreignKeyContract.push(...journeyPersonaVersionRequiredForeignKeys);
  if (journeyRichCardTables) foreignKeyContract.push(...journeyRichCardRequiredForeignKeys);
  if (journeyMetricAlertTables) foreignKeyContract.push(...journeyMetricAlertRequiredForeignKeys);
  if (journeySavedViewTables) foreignKeyContract.push(...journeySavedViewRequiredForeignKeys);
  if (journeyPortfolioTables) foreignKeyContract.push(...journeyPortfolioRequiredForeignKeys.filter((edge) =>
    runtimeVersion < 34 || !(edge[0] === 'journey_portfolio_items' && edge[2] === 'space_memberships')));
  if (runtimeVersion >= 34) foreignKeyContract.push(
    ['journey_portfolio_items','owner_user_id','users','id','a']);
  if (journeyCollaborationTables) foreignKeyContract.push(...journeyCollaborationRequiredForeignKeys);
  if (journeyHierarchyBlueprintTables) foreignKeyContract.push(...journeyHierarchyBlueprintRequiredForeignKeys);
  const indexContract = runtimeVersion >= 11
    ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes, ...reviewedIntelligenceRequiredIndexes, ...reviewedReplyRequiredIndexes, ...adminControlRequiredIndexes, ...deepAnalysisRequiredIndexes, ...boundedActiveRequestRequiredIndexes }
    : runtimeVersion >= 10
    ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes, ...reviewedIntelligenceRequiredIndexes, ...reviewedReplyRequiredIndexes, ...adminControlRequiredIndexes, ...deepAnalysisRequiredIndexes }
    : runtimeVersion >= 8
    ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes, ...reviewedIntelligenceRequiredIndexes, ...reviewedReplyRequiredIndexes, ...adminControlRequiredIndexes }
    : runtimeVersion >= 7
    ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes, ...reviewedIntelligenceRequiredIndexes, ...reviewedReplyRequiredIndexes }
    : runtimeVersion >= 6
    ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes, ...reviewedIntelligenceRequiredIndexes }
    : runtimeVersion >= 5 ? { ...requiredIndexes, ...assistantRequiredIndexes, ...assistantPhase1RequiredIndexes }
    : runtimeVersion >= 4 ? { ...requiredIndexes, ...assistantRequiredIndexes } : requiredIndexes;
  if (journeyMapTables) Object.assign(indexContract, journeyMapRequiredIndexes);
  if (journeyTemplateTables) Object.assign(indexContract, journeyTemplateRequiredIndexes);
  if (journeyEvidenceLifecycleTables) Object.assign(indexContract, journeyEvidenceLifecycleRequiredIndexes);
  if (usageLedgerTables) Object.assign(indexContract, usageLedgerRequiredIndexes);
  if (journeyEventControlPlaneTables) Object.assign(indexContract, journeyEventControlPlaneRequiredIndexes);
  if (journeyEventDataPlaneTables) Object.assign(indexContract, journeyEventDataPlaneRequiredIndexes);
  if (journeyStageProcessingTables) Object.assign(indexContract, journeyStageProcessingRequiredIndexes);
  if (journeyResearchHubTables) Object.assign(indexContract, journeyResearchHubRequiredIndexes);
  if (journeyV2RolloutTables) Object.assign(indexContract, journeyV2RolloutRequiredIndexes);
  if (journeyMetricTables) Object.assign(indexContract, journeyMetricRequiredIndexes);
  if (journeyAiSuggestionTables) Object.assign(indexContract, journeyAiSuggestionRequiredIndexes);
  if (journeyPersonaVersionTables) Object.assign(indexContract, journeyPersonaVersionRequiredIndexes);
  if (journeyRichCardTables) Object.assign(indexContract, journeyRichCardRequiredIndexes);
  if (journeyMetricAlertTables) Object.assign(indexContract, journeyMetricAlertRequiredIndexes);
  if (journeySavedViewTables) Object.assign(indexContract, journeySavedViewRequiredIndexes);
  if (journeyPortfolioTables) Object.assign(indexContract, journeyPortfolioRequiredIndexes);
  if (journeyCollaborationTables) Object.assign(indexContract, journeyCollaborationRequiredIndexes);
  if (journeyHierarchyBlueprintTables) Object.assign(indexContract, journeyHierarchyBlueprintRequiredIndexes);
  const defaultContract = runtimeVersion >= 10
    ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults, ...reviewedIntelligenceRequiredDefaults, ...reviewedReplyRequiredDefaults, ...adminControlRequiredDefaults, ...managedPlanRequiredDefaults, ...deepAnalysisRequiredDefaults }
    : runtimeVersion >= 9
    ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults, ...reviewedIntelligenceRequiredDefaults, ...reviewedReplyRequiredDefaults, ...adminControlRequiredDefaults, ...managedPlanRequiredDefaults }
    : runtimeVersion >= 8
    ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults, ...reviewedIntelligenceRequiredDefaults, ...reviewedReplyRequiredDefaults, ...adminControlRequiredDefaults }
    : runtimeVersion >= 7
    ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults, ...reviewedIntelligenceRequiredDefaults, ...reviewedReplyRequiredDefaults }
    : runtimeVersion >= 6
    ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults, ...reviewedIntelligenceRequiredDefaults }
    : runtimeVersion >= 5 ? { ...requiredDefaults, ...assistantRequiredDefaults, ...assistantPhase1RequiredDefaults }
    : runtimeVersion >= 4 ? { ...requiredDefaults, ...assistantRequiredDefaults } : requiredDefaults;
  if (journeyMapTables) Object.assign(defaultContract, journeyMapRequiredDefaults);
  if (journeyTemplateTables) Object.assign(defaultContract, journeyTemplateRequiredDefaults);
  if (journeyEvidenceLifecycleTables) Object.assign(defaultContract, journeyEvidenceLifecycleRequiredDefaults);
  if (usageLedgerTables) Object.assign(defaultContract, usageLedgerRequiredDefaults);
  if (journeyEventControlPlaneTables) Object.assign(defaultContract, journeyEventControlPlaneRequiredDefaults);
  if (journeyEventDataPlaneTables) Object.assign(defaultContract, journeyEventDataPlaneRequiredDefaults);
  if (journeyStageProcessingTables) Object.assign(defaultContract, journeyStageProcessingRequiredDefaults);
  if (journeyResearchHubTables) Object.assign(defaultContract, journeyResearchHubRequiredDefaults);
  if (journeyV2RolloutTables) Object.assign(defaultContract, journeyV2RolloutRequiredDefaults);
  if (journeyMetricTables) Object.assign(defaultContract, journeyMetricRequiredDefaults);
  if (journeyAiSuggestionTables) Object.assign(defaultContract, journeyAiSuggestionRequiredDefaults);
  if (journeyPersonaVersionTables) Object.assign(defaultContract, journeyPersonaVersionRequiredDefaults);
  if (journeyRichCardTables) Object.assign(defaultContract, journeyRichCardRequiredDefaults);
  if (journeyMetricAlertTables) Object.assign(defaultContract, journeyMetricAlertRequiredDefaults);
  if (journeySavedViewTables) Object.assign(defaultContract, journeySavedViewRequiredDefaults);
  if (journeyPortfolioTables) Object.assign(defaultContract, journeyPortfolioRequiredDefaults);
  if (journeyCollaborationTables) Object.assign(defaultContract, journeyCollaborationRequiredDefaults);
  if (journeyHierarchyBlueprintTables) Object.assign(defaultContract, journeyHierarchyBlueprintRequiredDefaults);
  const checkContract = runtimeVersion >= 9
    ? { ...requiredChecks, ...assistantRequiredChecks, ...assistantPhase1RequiredChecks, ...reviewedIntelligenceRequiredChecks, ...reviewedReplyRequiredChecks, ...adminControlRequiredChecks, ...managedPlanRequiredChecks }
    : runtimeVersion >= 8
    ? { ...requiredChecks, ...assistantRequiredChecks, ...assistantPhase1RequiredChecks, ...reviewedIntelligenceRequiredChecks, ...reviewedReplyRequiredChecks, ...adminControlRequiredChecks }
    : runtimeVersion >= 7
    ? { ...requiredChecks, ...assistantRequiredChecks, ...assistantPhase1RequiredChecks, ...reviewedIntelligenceRequiredChecks, ...reviewedReplyRequiredChecks }
    : runtimeVersion >= 6
    ? { ...requiredChecks, ...assistantRequiredChecks, ...assistantPhase1RequiredChecks, ...reviewedIntelligenceRequiredChecks }
    : runtimeVersion >= 5 ? { ...requiredChecks, ...assistantRequiredChecks, ...assistantPhase1RequiredChecks }
    : runtimeVersion >= 4 ? { ...requiredChecks, ...assistantRequiredChecks } : requiredChecks;
  if (journeyMapTables) Object.assign(checkContract, journeyMapRequiredChecks);
  if (journeyTemplateTables) Object.assign(checkContract, journeyTemplateRequiredChecks);
  if (journeyEvidenceLifecycleTables) Object.assign(checkContract, journeyEvidenceLifecycleRequiredChecks);
  if (usageLedgerTables) Object.assign(checkContract, usageLedgerRequiredChecks);
  if (journeyEventControlPlaneTables) Object.assign(checkContract, journeyEventControlPlaneRequiredChecks);
  if (journeyEventDataPlaneTables) Object.assign(checkContract, journeyEventDataPlaneRequiredChecks);
  if (journeyStageProcessingTables) Object.assign(checkContract, journeyStageProcessingRequiredChecks);
  if (journeyResearchHubTables) Object.assign(checkContract, journeyResearchHubRequiredChecks);
  if (journeyV2RolloutTables) Object.assign(checkContract, journeyV2RolloutRequiredChecks);
  if (journeyMetricTables) Object.assign(checkContract, journeyMetricRequiredChecks);
  if (journeyAiSuggestionTables) Object.assign(checkContract, journeyAiSuggestionRequiredChecks);
  if (journeyPersonaVersionTables) Object.assign(checkContract, journeyPersonaVersionRequiredChecks);
  if (journeyRichCardTables) Object.assign(checkContract, journeyRichCardRequiredChecks);
  if (journeyMetricAlertTables) Object.assign(checkContract, journeyMetricAlertRequiredChecks);
  if (journeySavedViewTables) Object.assign(checkContract, journeySavedViewRequiredChecks);
  if (journeyPortfolioTables) Object.assign(checkContract, journeyPortfolioRequiredChecks);
  if (journeyCollaborationTables) Object.assign(checkContract, journeyCollaborationRequiredChecks);
  if (journeyHierarchyBlueprintTables) Object.assign(checkContract, journeyHierarchyBlueprintRequiredChecks);
  const columnRows = await rows(query, `SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position
    FROM information_schema.columns WHERE table_schema=${sqlLiteral(schema)}
      AND table_name IN (${Object.keys({ ...exactColumnContract, ...additiveColumns }).map(sqlLiteral).join(',')})
    ORDER BY table_name,ordinal_position`);
  const byTable = new Map();
  const defaults = new Map();
  for (const row of columnRows) {
    const list = byTable.get(String(row.table_name)) || [];
    list.push([String(row.column_name), String(row.data_type), String(row.is_nullable) === 'YES']);
    byTable.set(String(row.table_name), list);
    defaults.set(`${String(row.table_name)}.${String(row.column_name)}`, normalized(row.column_default));
  }
  for (const [table, expected] of Object.entries(exactColumnContract)) {
    const actual = byTable.get(table) || [];
    // The current SQLite cutover source can already contain the schema-14
    // evidence lineage columns before runtime migrations 12 and 13 are
    // recorded. Older cutover sources legitimately gain those columns only
    // when migration 14 runs. Accept either complete shape at those two
    // intermediate versions, while still rejecting partial/unknown shapes.
    const accepted = table === 'journey_evidence_links' && runtimeVersion >= 12
      ? runtimeVersion < 14
        ? [expected, journeyEvidenceLifecycleExactColumns.journey_evidence_links]
        : [expected, journeyEvidenceLifecycleAppendedColumns]
      : table === 'journey_personas' && runtimeVersion >= 12 && runtimeVersion < 23
        ? [expected, journeyPersonaRootRuntime23Columns]
      : [expected];
    if (!accepted.some((shape) => JSON.stringify(actual) === JSON.stringify(shape))) {
      throw contractError('RUNTIME_SCHEMA_COLUMN_MISMATCH', `Runtime table ${schema}.${table} does not match its exact column contract. Actual: ${JSON.stringify(byTable.get(table) || [])}; expected: ${JSON.stringify(expected)}.`);
    }
  }
  for (const [table, expected] of Object.entries(additiveColumns)) {
    const actual = new Map((byTable.get(table) || []).map((column) => [column[0], column.slice(1)]));
    for (const [name, type, nullable] of expected) {
      if (JSON.stringify(actual.get(name)) !== JSON.stringify([type, nullable])) {
        throw contractError('RUNTIME_SCHEMA_COLUMN_MISMATCH', `Column ${schema}.${table}.${name} does not match its runtime contract.`);
      }
    }
  }
  for (const [column, expected] of Object.entries(defaultContract)) {
    if (defaults.get(column) !== normalized(expected)) {
      throw contractError('RUNTIME_SCHEMA_DEFAULT_MISMATCH', `Default for ${schema}.${column} does not match its runtime contract.`);
    }
  }

  const pkRows = await rows(query, `SELECT rel.relname table_name,array_agg(att.attname ORDER BY keys.ordinality) columns
    FROM pg_constraint constraint_record
    JOIN pg_class rel ON rel.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY keys(attnum,ordinality) ON TRUE
    JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=keys.attnum
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='p'
      AND rel.relname IN (${Object.keys(primaryKeyContract).map(sqlLiteral).join(',')})
    GROUP BY rel.relname`);
  const actualPrimaryKeys = new Map(pkRows.map((row) => [String(row.table_name), textArray(row.columns)]));
  for (const [table, expected] of Object.entries(primaryKeyContract)) {
    if (JSON.stringify(actualPrimaryKeys.get(table) || []) !== JSON.stringify(expected)) {
      throw contractError('RUNTIME_SCHEMA_PRIMARY_KEY_MISMATCH', `Primary key for ${schema}.${table} does not match its runtime contract.`);
    }
  }

  const fkRows = await rows(query, `SELECT source.relname table_name,source_attribute.attname column_name,
      target.relname referenced_table,target_attribute.attname referenced_column,constraint_record.confdeltype delete_action
    FROM pg_constraint constraint_record
    JOIN pg_class source ON source.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=source.relnamespace
    JOIN pg_class target ON target.oid=constraint_record.confrelid
    JOIN unnest(constraint_record.conkey,constraint_record.confkey) pairs(source_number,target_number) ON TRUE
    JOIN pg_attribute source_attribute ON source_attribute.attrelid=source.oid AND source_attribute.attnum=pairs.source_number
    JOIN pg_attribute target_attribute ON target_attribute.attrelid=target.oid AND target_attribute.attnum=pairs.target_number
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='f'`);
  const actualForeignKeys = new Set(fkRows.map((row) => key([
    row.table_name, row.column_name, row.referenced_table, row.referenced_column, row.delete_action
  ].map(String))));
  for (const expected of foreignKeyContract) {
    if (!actualForeignKeys.has(key(expected))) {
      throw contractError('RUNTIME_SCHEMA_FOREIGN_KEY_MISMATCH', `Required foreign key ${expected[0]}.${expected[1]} -> ${expected[2]}.${expected[3]} is missing or has the wrong delete action.`);
    }
  }

  const checkRows = await rows(query, `SELECT rel.relname table_name,pg_get_constraintdef(constraint_record.oid,true) definition
    FROM pg_constraint constraint_record
    JOIN pg_class rel ON rel.oid=constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
    WHERE namespace_record.nspname=${sqlLiteral(schema)} AND constraint_record.contype='c'`);
  const checksByTable = new Map();
  for (const row of checkRows) {
    const definitions = checksByTable.get(String(row.table_name)) || [];
    definitions.push(normalized(row.definition));
    checksByTable.set(String(row.table_name), definitions);
  }
  for (const [table, patterns] of Object.entries(checkContract)) {
    const definitions = checksByTable.get(table) || [];
    for (const fragments of patterns) {
      if (!definitions.some((definition) => fragments.every((fragment) => definition.includes(normalized(fragment))))) {
        throw contractError('RUNTIME_SCHEMA_CHECK_MISMATCH',
          `A required check constraint on ${schema}.${table} is missing or malformed. Required fragments: ${JSON.stringify(fragments)}. Actual: ${JSON.stringify(definitions)}.`);
      }
    }
  }

  const indexRows = await rows(query, `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=${sqlLiteral(schema)}`);
  const actualIndexes = new Map(indexRows.map((row) => [String(row.indexname), normalized(row.indexdef)]));
  for (const [name, fragments] of Object.entries(indexContract)) {
    const definition = actualIndexes.get(name) || '';
    if (!definition || fragments.some((fragment) => !definition.includes(normalized(fragment)))) {
      throw contractError('RUNTIME_SCHEMA_INDEX_MISMATCH', `Index ${schema}.${name} is missing or does not match its runtime contract.${definition ? ` Actual definition: ${definition}` : ''}`);
    }
  }

  const portfolioNamedConstraints = journeyPortfolioTables
    ? { ...journeyPortfolioRequiredConstraints }
    : {};
  if (runtimeVersion >= 34) {
    delete portfolioNamedConstraints.journey_portfolio_items_owner_membership_fk;
    Object.assign(portfolioNamedConstraints, journeyPortfolioRuntime34RequiredConstraints);
  }
  const requiredNamedConstraints = {
    ...(journeyEventControlPlaneTables ? journeyEventControlPlaneRequiredConstraints : {}),
    ...(journeyEventDataPlaneTables ? journeyEventDataPlaneRequiredConstraints : {}),
    ...(journeyStageProcessingTables ? journeyStageProcessingRequiredConstraints : {}),
    ...(journeyResearchHubTables ? journeyResearchHubRequiredConstraints : {}),
    ...(journeyV2RolloutTables ? journeyV2RolloutRequiredConstraints : {}),
    ...(journeyMetricTables ? journeyMetricRequiredConstraints : {}),
    ...(journeyAiSuggestionTables ? journeyAiSuggestionRequiredConstraints : {}),
    ...(journeyPersonaVersionTables ? journeyPersonaVersionRequiredConstraints : {}),
    ...(journeyRichCardTables ? journeyRichCardRequiredConstraints : {}),
    ...(journeyMetricAlertTables ? journeyMetricAlertRequiredConstraints : {}),
    ...(journeySavedViewTables ? journeySavedViewRequiredConstraints : {}),
    ...portfolioNamedConstraints,
    ...(journeyCollaborationTables ? journeyCollaborationRequiredConstraints : {}),
    ...(journeyHierarchyBlueprintTables ? journeyHierarchyBlueprintRequiredConstraints : {})
  };
  const requiredNamedTriggers = {
    ...(journeyEventControlPlaneTables ? journeyEventControlPlaneRequiredTriggers : {}),
    ...(journeyEventDataPlaneTables ? journeyEventDataPlaneRequiredTriggers : {}),
    ...(journeyStageProcessingTables ? journeyStageProcessingRequiredTriggers : {}),
    ...(journeyResearchHubTables ? journeyResearchHubRequiredTriggers : {}),
    ...(journeyV2RolloutTables ? journeyV2RolloutRequiredTriggers : {}),
    ...(journeyMetricTables ? journeyMetricRequiredTriggers : {}),
    ...(journeyAiSuggestionTables ? journeyAiSuggestionRequiredTriggers : {}),
    ...(journeyPersonaVersionTables ? journeyPersonaVersionRequiredTriggers : {}),
    ...(journeyRichCardTables ? journeyRichCardRequiredTriggers : {}),
    ...(journeyMetricAlertTables ? journeyMetricAlertRequiredTriggers : {}),
    ...(journeySavedViewTables ? journeySavedViewRequiredTriggers : {}),
    ...(journeyPortfolioTables ? journeyPortfolioRequiredTriggers : {}),
    ...(journeyCollaborationTables ? journeyCollaborationRequiredTriggers : {}),
    ...(journeyHierarchyBlueprintTables ? journeyHierarchyBlueprintRequiredTriggers : {}),
    ...(runtimeVersion >= 32 ? journeyTaxonomyRetirementRequiredTriggers : {}),
    ...(runtimeVersion >= 34 ? journeyPortfolioRuntime34RequiredTriggers : {}),
    ...(runtimeVersion >= 35 ? journeyOrchestrationRequiredTriggers : {}),
    ...(runtimeVersion >= 36 ? journeyActionRuntimeRequiredTriggers : {}),
    ...(runtimeVersion >= 37 ? journeyConnectorImportRequiredTriggers : {}),
    ...(runtimeVersion >= 38 ? journeyReviewedAdapterRequiredTriggers : {}),
    ...(runtimeVersion >= 39 ? journeyPredictiveGovernanceRequiredTriggers : {}),
    ...(runtimeVersion >= 40 ? journeyKillSwitchRequiredTriggers : {}),
    ...(runtimeVersion >= 41 ? journeyStageIntelligenceRequiredTriggers : {}),
    ...(runtimeVersion >= 42 ? journeyActionWorkerSafetyRequiredTriggers : {}),
    ...(runtimeVersion >= 43 ? journeyStageSurveyFeedRequiredTriggers : {}),
    ...(runtimeVersion >= 45 ? journeyEventIntelligenceRequiredTriggers : {}),
    ...(runtimeVersion >= 46 ? journeyPortfolioRuntime46RequiredTriggers : {}),
    ...(runtimeVersion >= 47 ? journeyPrivacyRuntime47RequiredTriggers : {}),
    ...(runtimeVersion >= 48 ? journeyBlueprintMeasurementRuntime48RequiredTriggers : {}),
    ...(runtimeVersion >= 49 ? journeyExportBrandRuntime49RequiredTriggers : {}),
    ...(runtimeVersion >= 50 ? journeyActualPathRuntime50RequiredTriggers : {})
  };
  if (Object.keys(requiredNamedConstraints).length) {
    const constraintRows = await rows(query, `SELECT constraint_record.conname,
        pg_get_constraintdef(constraint_record.oid,true) definition
      FROM pg_constraint constraint_record
      JOIN pg_class rel ON rel.oid=constraint_record.conrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
      WHERE namespace_record.nspname=${sqlLiteral(schema)}
        AND constraint_record.conname IN (${Object.keys(requiredNamedConstraints).map(sqlLiteral).join(',')})`);
    const actualConstraints = new Map(constraintRows.map((row) => [String(row.conname), normalized(row.definition)]));
    for (const [name, fragments] of Object.entries(requiredNamedConstraints)) {
      const definition = actualConstraints.get(name) || '';
      if (!definition || fragments.some((fragment) => !definition.includes(normalized(fragment)))) {
        throw contractError('RUNTIME_SCHEMA_CONSTRAINT_MISMATCH',
          `Constraint ${schema}.${name} is missing or does not match its tenant-isolation contract.${definition ? ` Actual definition: ${definition}` : ''}`);
      }
    }

  }

  if (Object.keys(requiredNamedTriggers).length) {
    const triggerTables = [...new Set(Object.values(requiredNamedTriggers).map((entry) => entry[0]))];
    const triggerRows = await rows(query, `SELECT trigger_record.tgname,rel.relname table_name,
        function_record.proname function_name,trigger_record.tgenabled
      FROM pg_trigger trigger_record
      JOIN pg_class rel ON rel.oid=trigger_record.tgrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid=rel.relnamespace
      JOIN pg_proc function_record ON function_record.oid=trigger_record.tgfoid
      WHERE namespace_record.nspname=${sqlLiteral(schema)} AND NOT trigger_record.tgisinternal
        AND trigger_record.tgname IN (${Object.keys(requiredNamedTriggers).map(sqlLiteral).join(',')})
        AND rel.relname IN (${triggerTables.map(sqlLiteral).join(',')})`);
    const actualTriggers = new Map(triggerRows.map((row) => [String(row.tgname), [
      String(row.table_name), String(row.function_name), String(row.tgenabled)
    ]]));
    for (const [name, expected] of Object.entries(requiredNamedTriggers)) {
      const actual = actualTriggers.get(name) || [];
      if (JSON.stringify(actual) !== JSON.stringify([...expected, 'O'])) {
        throw contractError('RUNTIME_SCHEMA_TRIGGER_MISMATCH',
          `Trigger ${schema}.${name} is missing, disabled, or bound to the wrong table/function.`);
      }
    }
  }

  if (runtimeVersion >= 44) {
    const fenceRows = await rows(query, `SELECT pg_get_functiondef(procedure_record.oid) definition
      FROM pg_proc procedure_record JOIN pg_namespace namespace_record ON namespace_record.oid=procedure_record.pronamespace
      WHERE namespace_record.nspname=${sqlLiteral(schema)}
        AND procedure_record.proname='journey_action_worker_reservation_fence_guard'`);
    const definition = normalized(fenceRows[0]?.definition || '');
    if (!definition.includes('journey_action_effect_receipts') || !definition.includes('journey_adapter_effect_receipts')) {
      throw contractError('RUNTIME_SCHEMA_FUNCTION_MISMATCH',
        `${schema}.journey_action_worker_reservation_fence_guard must fence both no-effect and reviewed-effect receipts.`);
    }
  }

  if (journeyEventDataPlaneTables) {
    const partitionRows = await rows(query, `SELECT parent.relname parent_name,child.relname child_name,
        partitioned.partstrat strategy,pg_get_expr(child.relpartbound,child.oid,true) partition_bound
      FROM pg_partitioned_table partitioned
      JOIN pg_class parent ON parent.oid=partitioned.partrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid=parent.relnamespace
      LEFT JOIN pg_inherits inheritance ON inheritance.inhparent=parent.oid
      LEFT JOIN pg_class child ON child.oid=inheritance.inhrelid
      WHERE namespace_record.nspname=${sqlLiteral(schema)}
        AND parent.relname IN (${Object.keys(journeyEventDataPlanePartitions).map(sqlLiteral).join(',')})`);
    const actualPartitions = new Map();
    for (const row of partitionRows) {
      if (String(row.strategy) !== 'r') {
        throw contractError('RUNTIME_SCHEMA_PARTITION_MISMATCH', `${schema}.${row.parent_name} must use range partitioning.`);
      }
      const list = actualPartitions.get(String(row.parent_name)) || [];
      if (row.child_name) list.push([String(row.child_name), normalized(row.partition_bound)]);
      actualPartitions.set(String(row.parent_name), list);
    }
    for (const [parent, expectedChildren] of Object.entries(journeyEventDataPlanePartitions)) {
      const actual = actualPartitions.get(parent) || [];
      const actualNames = actual.map((entry) => entry[0]).sort();
      if (JSON.stringify(actualNames) !== JSON.stringify([...expectedChildren].sort())
          || !actual.some(([name,bound]) => name.endsWith('_2026_08') && bound.includes('from') && bound.includes('to'))
          || !actual.some(([name,bound]) => name.endsWith('_default') && bound.includes('default'))) {
        throw contractError('RUNTIME_SCHEMA_PARTITION_MISMATCH',
          `Partition contract for ${schema}.${parent} is incomplete: ${JSON.stringify(actual)}.`);
      }
    }
    const jsonColumns = new Set(Object.entries(journeyEventDataPlaneExactColumns).flatMap(([table, columns]) =>
      columns.filter((column) => column[1] === 'jsonb').map((column) => `${table}.${column[0]}`)));
    const unsafeJsonIndexes = indexRows.filter((row) => {
      const definition = normalized(row.indexdef);
      return [...jsonColumns].some((qualified) => {
        const [table,column] = qualified.split('.');
        return String(row.tablename) === table && new RegExp(`\\b${column}\\b`, 'u').test(definition);
      });
    });
    if (unsafeJsonIndexes.length) {
      throw contractError('RUNTIME_SCHEMA_JSON_INDEX_FORBIDDEN',
        `Arbitrary connected-journey JSON columns must not have B-tree indexes: ${unsafeJsonIndexes.map((row) => row.indexname).join(',')}.`);
    }
  }

  return { schema, runtimeVersion, extensionTables: runtimeExtensionTables(runtimeVersion).length, indexes: Object.keys(indexContract).length };
}

export async function assertRuntimePrivileges(query, runtimeRole, options = {}) {
  const schema = String(options.schema || 'public');
  if (!IDENTIFIER.test(schema) || !IDENTIFIER.test(runtimeRole)) {
    throw contractError('RUNTIME_PRIVILEGE_IDENTIFIER_INVALID', 'Unsafe PostgreSQL schema or role identifier in privilege contract.');
  }
  // Resolved once. Every gate below used to inline its own `?? 26`, so a caller
  // that omitted runtimeVersion silently asserted the runtime-26 expectations
  // and skipped every later one -- the privilege contract reported success
  // without ever evaluating the tables it was extended to cover.
  const privilegeRuntimeVersion = Number(options.runtimeVersion ?? LATEST_RUNTIME_SCHEMA_VERSION);
  if (!Number.isSafeInteger(privilegeRuntimeVersion) || privilegeRuntimeVersion < 1) {
    throw contractError('RUNTIME_PRIVILEGE_VERSION_INVALID',
      'Runtime privilege contract version must be a positive integer.');
  }
  const expectations = [
    ['experience_schema_version', true, false, false, false],
    ['schema_migrations', true, false, false, false],
    ['experience_runtime_schema_version', true, false, false, false],
    ['platform_audit_events', true, true, false, false],
    ['platform_subscription_events', true, true, false, false],
    ['ticket_events', true, true, false, false],
    ['assistant_audit_events', true, true, false, false],
    ['journey_template_audit_events', true, true, false, false],
    ['platform_rbac_roles', true, true, true, true],
    ['platform_rbac_role_permissions', true, true, true, true],
    ['platform_rbac_user_roles', true, true, true, true]
  ];
  if (privilegeRuntimeVersion >= 14) {
    expectations.push(['journey_evidence_audit_events', true, true, false, false]);
  }
  if (privilegeRuntimeVersion >= 15) {
    expectations.push(
      ['platform_usage_events', true, true, false, false],
      ['platform_usage_buckets', true, true, true, false]
    );
  }
  if (privilegeRuntimeVersion >= 16) {
    expectations.push(['journey_event_control_audit_events', true, true, false, false]);
  }
  if (privilegeRuntimeVersion >= 17) {
    expectations.push(
      ['journey_raw_events', true, true, false, false],
      ['journey_raw_events_2026_08', true, true, false, false],
      ['journey_raw_events_default', true, true, false, false],
      ['journey_event_ingest_receipts', true, true, false, false],
      ['journey_event_ingest_receipts_2026_08', true, true, false, false],
      ['journey_event_ingest_receipts_default', true, true, false, false],
      ['journey_event_deduplication', true, true, false, false],
      ['journey_event_rejections', true, true, false, false],
      ['journey_event_rate_buckets', true, true, true, false],
      ['journey_event_processing_inbox', true, true, true, false],
      ['journey_event_processing_receipts', true, true, false, false],
      ['journey_event_processing_receipts_2026_08', true, true, false, false],
      ['journey_event_processing_receipts_default', true, true, false, false],
      ['journey_event_dead_letters', true, true, true, false],
      ['journey_event_data_audit', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 18) {
    expectations.push(
      ['journey_stage_rule_definitions', true, true, true, false],
      ['journey_stage_rule_versions', true, true, true, false],
      ['journey_stage_rule_decisions', true, true, false, false],
      ['journey_anonymous_instances', true, true, true, false],
      ['journey_anonymous_stage_visits', true, true, false, false],
      ['journey_stage_rule_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 19) {
    expectations.push(
      ['journey_research_snapshots', true, true, false, false],
      ['journey_research_assessments', true, true, false, false],
      ['journey_research_intakes', true, true, false, false],
      ['journey_research_refresh_attempts', true, true, false, false],
      ['journey_research_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 20) {
    expectations.push(['journey_v2_divergences', true, true, false, false]);
  }
  if (privilegeRuntimeVersion >= 21) {
    expectations.push(
      ['journey_metric_segments', true, true, true, false],
      ['journey_metric_bindings', true, true, true, false],
      ['journey_metric_definitions', true, true, true, false],
      ['journey_metric_definition_versions', true, true, false, false],
      ['journey_metric_imports', true, true, false, false],
      ['journey_metric_rebuild_runs', true, true, true, false],
      ['journey_metric_rebuild_attempts', true, true, false, false],
      ['journey_metric_observations', true, true, false, false],
      ['journey_metric_observation_sources', true, true, false, false],
      ['journey_metric_checkpoints', true, true, true, false],
      ['journey_metric_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 22) {
    expectations.push(
      ['journey_ai_suggestion_runs', true, true, true, false],
      ['journey_ai_suggestion_evidence', true, true, false, false],
      ['journey_ai_suggestion_changes', true, true, false, false],
      ['journey_ai_suggestion_decisions', true, true, false, false],
      ['journey_ai_suggestion_audit_events', true, true, false, false],
      ['journey_ai_suggestion_purge_receipts', true, false, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 23) {
    expectations.push(
      ['journey_persona_versions', true, true, false, false],
      ['journey_persona_claims', true, true, false, false],
      ['journey_persona_claim_evidence', true, true, false, false],
      ['journey_persona_review_events', true, true, false, false],
      ['journey_map_version_personas', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 24) {
    expectations.push(
      ['journey_channels', true, true, true, true],
      ['journey_channel_versions', true, true, false, false],
      ['journey_touchpoints', true, true, true, true],
      ['journey_touchpoint_versions', true, true, false, false],
      ['journey_card_details', true, true, true, true],
      ['journey_card_touchpoints', true, true, true, true],
      ['journey_card_assets', true, true, true, true],
      ['journey_asset_blob_purge_outbox', true, true, true, false],
      ['journey_rich_card_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 25) {
    expectations.push(
      ['journey_metric_alert_definitions', true, true, true, false],
      ['journey_metric_alert_definition_versions', true, true, false, false],
      ['journey_metric_alert_evaluation_runs', true, true, true, false],
      ['journey_metric_alert_evaluation_results', true, true, false, false],
      ['journey_metric_alerts', true, true, true, false],
      ['journey_metric_alert_events', true, true, false, false],
      ['journey_metric_alert_notification_preferences', true, true, true, false],
      ['journey_metric_alert_notifications', true, true, false, false],
      ['journey_metric_alert_notification_states', true, true, true, false],
      ['journey_metric_alert_notification_state_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 26) {
    expectations.push(
      ['journey_saved_view_settings', true, true, true, false],
      ['journey_saved_views', true, true, true, true],
      ['journey_saved_view_references', true, true, true, true],
      ['journey_saved_view_selections', true, true, true, true],
      ['journey_saved_view_operations', true, true, false, false],
      ['journey_saved_view_audit_events', true, true, false, false]
    );
  }
  // Three shapes, applied consistently across runtimes 27-29:
  //   append-only history            SELECT+INSERT only
  //   parent of append-only history  no DELETE (a cascade would erase the seal
  //                                  from underneath a BEFORE UPDATE-only guard)
  //   settings/quota/credential rows no DELETE
  // Everything else stays fully mutable. The seals themselves raise 55000, but a
  // trigger is not a privilege: without these the grants said the runtime could
  // rewrite its own audit.
  if (privilegeRuntimeVersion >= 27) {
    expectations.push(
      ['journey_portfolio_settings', true, true, true, false],
      ['journey_portfolio_items', true, true, true, false],
      ['journey_portfolio_item_versions', true, true, false, false],
      ['journey_portfolio_item_evidence', true, true, true, true],
      ['journey_portfolio_item_tags', true, true, true, true],
      ['journey_initiative_metric_targets', true, true, true, true],
      ['journey_portfolio_relationships', true, true, true, true],
      ['journey_portfolio_journey_links', true, true, true, true],
      ['journey_initiative_dependencies', true, true, true, true],
      ['journey_portfolio_scoring_policies', true, true, true, false],
      ['journey_portfolio_scoring_policy_versions', true, true, false, false],
      ['journey_portfolio_priority_assessments', true, true, false, false],
      ['journey_initiative_baselines', true, true, false, false],
      ['journey_initiative_outcome_comparisons', true, true, false, false],
      ['journey_portfolio_reviews', true, true, false, false],
      ['journey_portfolio_operational_links', true, true, true, true],
      ['journey_portfolio_operations', true, true, false, false],
      ['journey_portfolio_activity', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 28) {
    expectations.push(
      ['journey_collaboration_settings', true, true, true, false],
      ['journey_collaboration_role_assignments', true, true, true, false],
      ['journey_collaboration_role_events', true, true, false, false],
      ['journey_comments', true, true, true, false],
      ['journey_comment_versions', true, true, false, false],
      ['journey_comment_mentions', true, true, true, true],
      ['journey_collaboration_watchers', true, true, true, true],
      ['journey_governance_reviews', true, true, true, false],
      ['journey_governance_review_events', true, true, false, false],
      ['journey_governance_publications', true, true, false, false],
      ['journey_collaboration_notifications', true, true, false, false],
      ['journey_collaboration_notification_states', true, true, true, false],
      ['journey_collaboration_notification_state_events', true, true, false, false],
      ['journey_collaboration_views', true, true, true, true],
      ['journey_read_only_shares', true, true, true, false],
      ['journey_share_access_events', true, true, false, false],
      ['journey_share_rate_buckets', true, true, true, false],
      ['journey_collaboration_operations', true, true, false, false],
      ['journey_collaboration_activity', true, true, false, false],
      ['journey_collaboration_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 29) {
    expectations.push(
      ['journey_hierarchy_settings', true, true, true, false],
      ['journey_taxonomy_terms', true, true, true, true],
      ['journey_definition_taxonomy', true, true, true, true],
      ['journey_hierarchy_links', true, true, true, true],
      ['journey_hierarchy_health_policies', true, true, true, false],
      ['journey_hierarchy_health_snapshots', true, true, false, false],
      ['journey_blueprint_resources', true, true, true, true],
      ['journey_blueprints', true, true, true, false],
      ['journey_blueprint_versions', true, true, false, false],
      ['journey_blueprint_stages', true, true, false, false],
      ['journey_blueprint_elements', true, true, false, false],
      ['journey_blueprint_element_resources', true, true, false, false],
      ['journey_blueprint_relationships', true, true, false, false],
      ['journey_blueprint_portfolio_links', true, true, true, true],
      ['journey_blueprint_gap_assessments', true, true, true, true],
      ['journey_blueprint_comparisons', true, true, false, false],
      ['journey_hierarchy_operations', true, true, false, false],
      ['journey_hierarchy_activity', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 30) {
    expectations.push(
      ['journey_stage_reprojection_runs', true, true, true, false],
      ['journey_stage_reprojection_attempts', true, true, false, false],
      ['journey_stage_reprojection_checkpoints', true, true, true, false],
      ['journey_stage_reprojection_audit_events', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 31) {
    expectations.push(
      ['journey_identity_profiles', true, true, true, true],
      ['journey_identity_bindings', true, true, true, true],
      ['journey_identity_merges', true, true, true, true],
      ['journey_identity_memberships', true, true, true, true],
      ['journey_identity_groups', true, true, true, true],
      ['journey_identity_source_facts', true, true, true, true],
      ['journey_identity_audit_facts', true, true, true, true],
      ['journey_identity_profile_tombstones', true, true, true, true],
      ['journey_identity_identifier_tombstones', true, true, true, true],
      ['journey_identity_processed_commands', true, true, true, true],
      ['journey_profile_timeline_events', true, true, true, true],
      ['journey_identity_sessions', true, true, true, true],
      ['journey_identity_segments', true, true, true, true],
      ['journey_identity_segment_versions', true, true, true, true],
      ['journey_identity_segment_memberships', true, true, true, true],
      ['journey_profile_privacy_states', true, true, true, true],
      ['journey_profile_export_jobs', true, true, true, true],
      ['journey_profile_privacy_jobs', true, true, true, true],
      ['journey_identity_correction_runs', true, true, true, true]
    );
  }
  if (privilegeRuntimeVersion >= 32) {
    const taxonomyGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.journey_taxonomy_assignment_lifecycle_guard()`)} ,'EXECUTE') can_execute`))[0];
    if (Boolean(taxonomyGuardPrivilege?.can_execute)) {
      throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute the taxonomy assignment lifecycle trigger guard.`);
    }
  }
  if (privilegeRuntimeVersion >= 33) {
    expectations.push(
      ['journey_path_intelligence_runs', true, true, false, false],
      ['journey_stage_inference_recommendations', true, true, true, false],
      ['journey_path_intelligence_audit', true, true, false, false]
    );
    const inferenceGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.journey_stage_inference_content_guard()`)} ,'EXECUTE') can_execute`))[0];
    if (Boolean(inferenceGuardPrivilege?.can_execute)) throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the stage-inference content guard.`);
  }
  if (privilegeRuntimeVersion >= 34) {
    const portfolioGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.journey_portfolio_owner_membership_guard()`)} ,'EXECUTE') can_execute`))[0];
    if (Boolean(portfolioGuardPrivilege?.can_execute)) throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the portfolio owner membership guard.`);
  }
  if (privilegeRuntimeVersion >= 35) {
    expectations.push(
      ['journey_orchestration_settings', true, true, true, false],
      ['journey_workflow_definitions', true, true, true, false],
      ['journey_workflow_versions', true, true, false, false],
      ['journey_workflow_runs', true, true, false, false],
      ['journey_workflow_actions', true, true, false, false],
      ['journey_workflow_approvals', true, true, false, false],
      ['journey_workflow_outbox', true, true, false, false],
      ['journey_workflow_audit', true, true, false, false]
    );
    const orchestrationGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.journey_orchestration_append_only_guard()`)} ,'EXECUTE') can_execute`))[0];
    if (Boolean(orchestrationGuardPrivilege?.can_execute)) throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the orchestration append-only guard.`);
  }
  if (privilegeRuntimeVersion >= 36) {
    expectations.push(
      ['journey_action_queue', true, true, true, false],
      ['journey_action_gate_resolutions', true, true, false, false],
      ['journey_action_attempts', true, true, false, false],
      ['journey_action_effect_receipts', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 37) {
    expectations.push(
      ['journey_connector_definitions', true, true, true, false],
      ['journey_connector_import_runs', true, true, true, false],
      ['journey_connector_records', true, true, true, false],
      ['journey_connector_item_receipts', true, true, false, false],
      ['journey_connector_idempotency', true, true, false, false],
      ['journey_connector_audit', true, true, false, false]
    );
    const connectorGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.journey_connector_append_only_guard()`)} ,'EXECUTE') can_execute`))[0];
    if (Boolean(connectorGuardPrivilege?.can_execute)) throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the connector append-only guard.`);
  }
  if (privilegeRuntimeVersion >= 38) {
    expectations.push(
      ['journey_webhook_destinations', true, true, true, false],
      ['journey_adapter_execution_attempts', true, true, false, false],
      ['journey_adapter_effect_receipts', true, true, false, false],
      ['journey_adapter_internal_notifications', true, true, false, false],
      ['journey_webhook_dispatches', true, true, true, false]
    );
  }
  if (privilegeRuntimeVersion >= 39) {
    expectations.push(
      ['journey_prediction_policies', true, true, true, false],
      ['journey_predictive_models', true, true, true, false],
      ['journey_predictive_model_versions', true, true, false, false],
      ['journey_prediction_drift_evaluations', true, true, false, false],
      ['journey_prediction_runs', true, true, false, false],
      ['journey_prediction_audit', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 40) {
    expectations.push(
      ['journey_kill_switch_states', true, true, true, false],
      ['journey_kill_switch_mutations', true, true, false, false],
      ['journey_kill_switch_pauses', true, true, false, false],
      ['journey_kill_switch_resumptions', true, true, false, false],
      ['journey_kill_switch_audit', true, true, false, false]
    );
  }
  if (privilegeRuntimeVersion >= 41) {
    expectations.push(
      ['journey_stage_intelligence_policies', true, true, true, false],
      ['journey_stage_intelligence_policy_history', true, true, false, false],
      ['journey_stage_intelligence_facts', true, true, false, false],
      ['journey_stage_intelligence_audit', true, true, false, false]
    );
    const retentionGuardPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_stage_intelligence_retention_delete_guard()`)},
      'EXECUTE') can_execute`))[0];
    if (Boolean(retentionGuardPrivilege?.can_execute)) {
      throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute the journey-stage retention purge guard.`);
    }
  }
  if (privilegeRuntimeVersion >= 42) {
    expectations.push(
      ['journey_worker_service_principals',false,false,false,false],
      ['journey_worker_service_key_audit',false,false,false,false],
      ['journey_action_live_contexts',false,false,false,false],
      ['journey_action_subject_controls',false,false,false,false],
      ['journey_action_source_controls',false,false,false,false],
      ['journey_action_quota_counters',false,false,false,false],
      ['journey_action_frequency_counters',false,false,false,false],
      ['journey_action_worker_reservations',false,false,false,false],
      ['journey_action_worker_reservation_events',false,false,false,false]
    );
    for (const signature of ['journey_worker_safety_append_only_guard()','journey_worker_service_principal_lifecycle_guard()',
      'journey_action_worker_reservation_fence_guard()','journey_action_safety_counter_guard()']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',`${runtimeRole} must not execute ${signature}.`);
    }
  }
  if (privilegeRuntimeVersion >= 43) {
    expectations.push(
      ['journey_stage_source_mappings',true,true,true,false],
      ['journey_stage_source_mapping_versions',true,true,false,false],
      ['journey_stage_survey_policies',true,true,true,false],
      ['journey_stage_survey_policy_versions',true,true,false,false],
      ['journey_stage_survey_governance_receipts',true,true,false,true],
      ['journey_stage_survey_source_revisions',true,true,false,true],
      ['journey_stage_survey_outbox',true,true,true,true],
      ['journey_stage_survey_outbox_attempts',true,true,false,true],
      ['journey_stage_survey_checkpoints',true,true,true,false],
      ['journey_stage_survey_feed_audit',true,true,false,false]
    );
    const feedGuardPrivilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_stage_survey_retention_delete_guard()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(feedGuardPrivilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the journey-stage survey retention guard.`);
  }
  if (privilegeRuntimeVersion >= 45) {
    expectations.push(
      ['journey_event_intelligence_mappings',true,true,true,false],
      ['journey_event_intelligence_mapping_versions',true,true,false,false],
      ['journey_event_intelligence_erasure_handles',true,true,false,false],
      ['journey_event_intelligence_outbox',true,true,true,false],
      ['journey_event_intelligence_materialization_state',true,true,true,false],
      ['journey_event_intelligence_tombstones',true,true,false,false]
    );
    const enqueuePrivilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_event_intelligence_enqueue_visit()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(enqueuePrivilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute the journey-event intelligence trigger function.`);
  }
  if (privilegeRuntimeVersion >= 46) {
    expectations.push(
      ['journey_portfolio_view_definitions',true,true,true,false],
      ['journey_portfolio_view_versions',true,true,false,false],
      ['journey_portfolio_view_preferences',true,true,true,false],
      ['journey_portfolio_transition_requests',true,true,true,false],
      ['journey_portfolio_transition_events',true,true,false,false]
    );
    for (const signature of ['journey_portfolio_runtime46_guard()','journey_portfolio_view_preference_guard()']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
        ${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute ${signature}.`);
    }
  }
  if (privilegeRuntimeVersion >= 47) {
    expectations.push(
      ['journey_privacy_service_principals',false,false,false,false],
      ['journey_privacy_service_key_audit',false,false,false,false],
      ['journey_privacy_erasure_authorities',false,false,false,false],
      ['journey_privacy_propagation_claims',false,false,false,false],
      ['journey_privacy_propagation_events',false,false,false,false]
    );
    for (const signature of ['journey_privacy_runtime47_guard()','journey_privacy_principal_scope_guard()',
      'journey_privacy_authority_scope_guard()','journey_privacy_erasure_ready(text,text)',
      'journey_privacy_claim(text,text,text,timestamp with time zone,integer)',
      'journey_privacy_checkpoint(text,text,bigint,text,integer,text,jsonb,text,timestamp with time zone,timestamp with time zone)']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
        ${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute ${signature}.`);
    }
  }
  if (privilegeRuntimeVersion >= 48) {
    expectations.push(
      ['journey_blueprint_measurement_plans',true,true,true,false],
      ['journey_blueprint_measurement_outcomes',true,true,false,false],
      ['journey_blueprint_measurement_audit',true,true,false,false]
    );
    for (const signature of ['journey_blueprint_measurement_lineage_guard()',
      'journey_blueprint_measurement_immutability_guard()']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
        ${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute ${signature}.`);
    }
  }
  if (privilegeRuntimeVersion >= 49) {
    expectations.push(
      ['journey_export_brand_assets',true,true,true,false],
      ['journey_export_brand_profiles',true,true,true,false],
      ['journey_export_brand_profile_versions',true,true,false,false],
      ['journey_export_brand_settings',true,true,true,false],
      ['journey_saved_view_brand_bindings',true,true,true,false],
      ['journey_export_brand_operations',true,true,false,false],
      ['journey_export_brand_audit_events',true,true,false,false],
      ['journey_export_brand_asset_purge_queue',true,true,true,false]
    );
    const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_export_brand_append_only_guard()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute journey_export_brand_append_only_guard().`);
  }
  if (privilegeRuntimeVersion >= 50) {
    expectations.push(
      ['journey_actual_path_snapshots',true,true,false,false],
      ['journey_actual_path_rollups',true,true,true,false],
      ['journey_actual_path_artifact_revisions',true,true,false,false],
      ['journey_actual_path_privacy_invalidations',true,false,false,false]
    );
    for (const signature of ['journey_actual_path_runtime50_immutable_guard()',
      'journey_actual_path_privacy_invalidate(text,text,text,text,text,timestamp with time zone)']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
        ${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute ${signature}.`);
    }
  }
  if (privilegeRuntimeVersion >= 51) {
    expectations.push(
      ['journey_connector_worker_principals',false,false,false,false],
      ['journey_connector_worker_key_events',false,false,false,false],
      ['journey_connector_worker_sources',false,false,false,false],
      ['journey_connector_worker_source_items',false,false,false,false],
      ['journey_connector_worker_events',false,false,false,false]
    );
    const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_connector_worker_history_guard()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute journey_connector_worker_history_guard().`);
  }
  if (privilegeRuntimeVersion >= 52) {
    expectations.push(
      ['journey_operational_stage_mappings',true,true,true,false],
      ['journey_operational_stage_mapping_versions',true,true,false,false],
      ['journey_operational_stage_source_revisions',true,true,false,false],
      ['journey_operational_stage_outbox',true,true,false,false],
      ['journey_operational_stage_outbox_attempts',false,false,false,false],
      ['journey_operational_stage_checkpoints',false,false,false,false],
      ['journey_operational_stage_tombstones',true,true,false,false],
      ['journey_operational_timeline_revisions',true,false,false,false],
      ['journey_operational_stage_feed_audit',true,true,false,false]
    );
    const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_operational_stage_retention_delete_guard()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute journey_operational_stage_retention_delete_guard().`);
  }
  if (privilegeRuntimeVersion >= 53) {
    expectations.push(
      ['journey_event_retention_runs',false,false,false,false],
      ['journey_event_retention_checkpoints',false,false,false,false],
      ['journey_event_retention_events',false,false,false,false]
    );
    const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_event_retention_purge_raw(text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone)`)},
      'EXECUTE') can_execute`))[0];
    if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute journey_event_retention_purge_raw().`);
  }
  if (privilegeRuntimeVersion >= 54) {
    expectations.push(
      ['journey_evidence_monitor_states',true,true,true,false],
      ['journey_evidence_monitor_events',true,true,false,false]
    );
    const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_evidence_monitor_event_append_only_guard()`)},'EXECUTE') can_execute`))[0];
    if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
      `${runtimeRole} must not directly execute journey_evidence_monitor_event_append_only_guard().`);
  }
  if (privilegeRuntimeVersion >= 55) {
    expectations.push(
      ['journey_workspace_view_definitions',true,true,true,false],
      ['journey_workspace_view_versions',true,true,false,false],
      ['journey_workspace_view_preferences',true,true,true,false],
      ['journey_workspace_view_operations',true,true,false,false],
      ['journey_workspace_view_audit_events',true,true,false,false]
    );
    for (const signature of ['journey_workspace_view_history_guard()','journey_workspace_view_preference_guard()']) {
      const privilege=(await rows(query,`SELECT has_function_privilege(${sqlLiteral(runtimeRole)},
        ${sqlLiteral(`${schema}.${signature}`)},'EXECUTE') can_execute`))[0];
      if(Boolean(privilege?.can_execute))throw contractError('RUNTIME_PRIVILEGE_OVER_GRANT',
        `${runtimeRole} must not directly execute ${signature}.`);
    }
  }
  for (const [table, select, insert, update, remove] of expectations) {
    const qualified = `${schema}.${table}`;
    const result = (await rows(query, `SELECT
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'SELECT') can_select,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'INSERT') can_insert,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'UPDATE') can_update,
      has_table_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(qualified)},'DELETE') can_delete`))[0];
    const actual = [Boolean(result?.can_select), Boolean(result?.can_insert), Boolean(result?.can_update), Boolean(result?.can_delete)];
    if (JSON.stringify(actual) !== JSON.stringify([select, insert, update, remove])) {
      throw contractError('RUNTIME_PRIVILEGE_MISMATCH', `Privileges for ${runtimeRole} on ${qualified} are ${actual.join('/')}, expected ${[select, insert, update, remove].join('/')}.`);
    }
  }
  const schemaPrivilege = (await rows(query, `SELECT has_schema_privilege(${sqlLiteral(runtimeRole)},${sqlLiteral(schema)},'CREATE') can_create`))[0];
  if (Boolean(schemaPrivilege?.can_create)) {
    throw contractError('RUNTIME_PRIVILEGE_MISMATCH', `${runtimeRole} must not have CREATE on schema ${schema}.`);
  }
  if (privilegeRuntimeVersion >= 22) {
    const functionPrivilege = (await rows(query, `SELECT has_function_privilege(
      ${sqlLiteral(runtimeRole)},
      ${sqlLiteral(`${schema}.journey_ai_suggestion_controlled_purge(text,text,text,text)`)},
      'EXECUTE') can_execute`))[0];
    if (Boolean(functionPrivilege?.can_execute)) {
      throw contractError('RUNTIME_PRIVILEGE_MISMATCH',
        `${runtimeRole} must not execute the controlled journey suggestion purge function.`);
    }
  }
  return { role: runtimeRole, protectedTables: expectations.length };
}
