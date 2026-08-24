-- Runtime privileges are deliberately applied in one transaction. The
-- deployment script replaces the two role placeholders with managed,
-- identifier-safe PostgreSQL role names before executing this file.
BEGIN;

DO $seemplify_privilege_contract$
DECLARE protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'experience_schema_version',
    'schema_migrations',
    'experience_runtime_schema_version',
    'platform_audit_events',
    'platform_subscription_events',
    'platform_usage_events',
    'platform_usage_buckets',
    'ticket_events',
    'assistant_audit_events',
    'journey_template_audit_events',
    'journey_evidence_audit_events',
    'journey_event_control_audit_events',
    'journey_raw_events',
    'journey_raw_events_2026_08',
    'journey_raw_events_default',
    'journey_event_ingest_receipts',
    'journey_event_ingest_receipts_2026_08',
    'journey_event_ingest_receipts_default',
    'journey_event_deduplication',
    'journey_event_rejections',
    'journey_event_rate_buckets',
    'journey_event_processing_inbox',
    'journey_event_processing_receipts',
    'journey_event_processing_receipts_2026_08',
    'journey_event_processing_receipts_default',
    'journey_event_dead_letters',
    'journey_event_data_audit',
    'journey_stage_rule_definitions',
    'journey_stage_rule_versions',
    'journey_stage_rule_decisions',
    'journey_anonymous_instances',
    'journey_anonymous_stage_visits',
    'journey_stage_rule_audit_events',
    'journey_research_sources',
    'journey_research_snapshots',
    'journey_research_links',
    'journey_research_assessments',
    'journey_research_gaps',
    'journey_research_intakes',
    'journey_research_monitors',
    'journey_research_refresh_runs',
    'journey_research_refresh_attempts',
    'journey_research_notifications',
    'journey_research_audit_events',
    'journey_v2_rollout_platform',
    'journey_v2_rollout_spaces',
    'journey_v2_divergences',
    'journey_metric_segments',
    'journey_metric_bindings',
    'journey_metric_definitions',
    'journey_metric_definition_versions',
    'journey_metric_imports',
    'journey_metric_rebuild_runs',
    'journey_metric_rebuild_attempts',
    'journey_metric_observations',
    'journey_metric_observation_sources',
    'journey_metric_checkpoints',
    'journey_metric_audit_events',
    'journey_ai_suggestion_runs',
    'journey_ai_suggestion_evidence',
    'journey_ai_suggestion_changes',
    'journey_ai_suggestion_decisions',
    'journey_ai_suggestion_audit_events',
    'journey_ai_suggestion_purge_receipts',
    'journey_persona_versions',
    'journey_persona_claims',
    'journey_persona_claim_evidence',
    'journey_persona_review_events',
    'journey_map_version_personas',
    'journey_channels',
    'journey_channel_versions',
    'journey_touchpoints',
    'journey_touchpoint_versions',
    'journey_card_details',
    'journey_card_touchpoints',
    'journey_card_assets',
    'journey_asset_blob_purge_outbox',
    'journey_rich_card_audit_events',
    'journey_metric_alert_definitions',
    'journey_metric_alert_definition_versions',
    'journey_metric_alert_evaluation_runs',
    'journey_metric_alert_evaluation_results',
    'journey_metric_alerts',
    'journey_metric_alert_events',
    'journey_metric_alert_notification_preferences',
    'journey_metric_alert_notifications',
    'journey_metric_alert_notification_states',
    'journey_metric_alert_notification_state_events',
    'journey_saved_view_settings',
    'journey_saved_views',
    'journey_saved_view_references',
    'journey_saved_view_selections',
    'journey_saved_view_operations',
    'journey_saved_view_audit_events',
    'journey_portfolio_settings',
    'journey_portfolio_items',
    'journey_portfolio_item_versions',
    'journey_portfolio_item_evidence',
    'journey_portfolio_item_tags',
    'journey_initiative_metric_targets',
    'journey_portfolio_relationships',
    'journey_portfolio_journey_links',
    'journey_initiative_dependencies',
    'journey_portfolio_scoring_policies',
    'journey_portfolio_scoring_policy_versions',
    'journey_portfolio_priority_assessments',
    'journey_initiative_baselines',
    'journey_initiative_outcome_comparisons',
    'journey_portfolio_reviews',
    'journey_portfolio_operational_links',
    'journey_portfolio_operations',
    'journey_portfolio_activity',
    'journey_collaboration_settings',
    'journey_collaboration_role_assignments',
    'journey_collaboration_role_events',
    'journey_comments',
    'journey_comment_versions',
    'journey_comment_mentions',
    'journey_collaboration_watchers',
    'journey_governance_reviews',
    'journey_governance_review_events',
    'journey_governance_publications',
    'journey_collaboration_notifications',
    'journey_collaboration_notification_states',
    'journey_collaboration_notification_state_events',
    'journey_collaboration_views',
    'journey_read_only_shares',
    'journey_share_access_events',
    'journey_share_rate_buckets',
    'journey_collaboration_operations',
    'journey_collaboration_activity',
    'journey_collaboration_audit_events',
    'journey_hierarchy_settings',
    'journey_taxonomy_terms',
    'journey_definition_taxonomy',
    'journey_hierarchy_links',
    'journey_hierarchy_health_policies',
    'journey_hierarchy_health_snapshots',
    'journey_blueprint_resources',
    'journey_blueprints',
    'journey_blueprint_versions',
    'journey_blueprint_stages',
    'journey_blueprint_elements',
    'journey_blueprint_element_resources',
    'journey_blueprint_relationships',
    'journey_blueprint_portfolio_links',
    'journey_blueprint_gap_assessments',
    'journey_blueprint_comparisons',
    'journey_hierarchy_operations',
    'journey_hierarchy_activity',
    'journey_stage_reprojection_runs',
    'journey_stage_reprojection_attempts',
    'journey_stage_reprojection_checkpoints',
    'journey_stage_reprojection_audit_events',
    'journey_identity_profiles',
    'journey_identity_bindings',
    'journey_identity_merges',
    'journey_identity_memberships',
    'journey_identity_groups',
    'journey_identity_source_facts',
    'journey_identity_audit_facts',
    'journey_identity_profile_tombstones',
    'journey_identity_identifier_tombstones',
    'journey_identity_processed_commands',
    'journey_profile_timeline_events',
    'journey_identity_sessions',
    'journey_identity_segments',
    'journey_identity_segment_versions',
    'journey_identity_segment_memberships',
    'journey_profile_privacy_states',
    'journey_profile_export_jobs',
    'journey_profile_privacy_jobs',
    'journey_identity_correction_runs',
    'idp_space_authorizations'
  ] LOOP
    IF to_regclass('public.' || protected_table) IS NULL THEN
      RAISE EXCEPTION 'Required runtime privilege target public.% is missing', protected_table;
    END IF;
  END LOOP;
END
$seemplify_privilege_contract$;

DO $seemplify_admin_rbac_privilege_contract$
DECLARE required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'platform_rbac_roles',
    'platform_rbac_role_permissions',
    'platform_rbac_user_roles'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Required administrator RBAC privilege target public.% is missing', required_table;
    END IF;
  END LOOP;
END
$seemplify_admin_rbac_privilege_contract$;

GRANT CONNECT ON DATABASE __DATABASE__ TO __APP_ROLE__;
GRANT USAGE ON SCHEMA public TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO __APP_ROLE__;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO __APP_ROLE__;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE
  public.platform_rbac_roles,
  public.platform_rbac_role_permissions,
  public.platform_rbac_user_roles
TO __APP_ROLE__;

ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO __APP_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO __APP_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO __APP_ROLE__;

-- Migration metadata is immutable to the application runtime.
REVOKE INSERT,UPDATE,DELETE ON TABLE public.experience_schema_version FROM __APP_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.schema_migrations FROM __APP_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.experience_runtime_schema_version FROM __APP_ROLE__;

-- Operational history is append-only to the application runtime.
REVOKE UPDATE,DELETE ON TABLE public.platform_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.platform_subscription_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.platform_usage_events FROM __APP_ROLE__;
REVOKE DELETE ON TABLE public.platform_usage_buckets FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.ticket_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.assistant_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.journey_template_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.journey_evidence_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.journey_event_control_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE
  public.journey_raw_events,
  public.journey_raw_events_2026_08,
  public.journey_raw_events_default,
  public.journey_event_ingest_receipts,
  public.journey_event_ingest_receipts_2026_08,
  public.journey_event_ingest_receipts_default,
  public.journey_event_deduplication,
  public.journey_event_rejections,
  public.journey_event_processing_receipts,
  public.journey_event_processing_receipts_2026_08,
  public.journey_event_processing_receipts_default,
  public.journey_event_data_audit,
  public.journey_stage_rule_decisions,
  public.journey_anonymous_stage_visits,
  public.journey_stage_rule_audit_events,
  public.journey_research_snapshots,
  public.journey_research_assessments,
  public.journey_research_intakes,
  public.journey_research_refresh_attempts,
  public.journey_research_audit_events,
  public.journey_v2_divergences,
  public.journey_metric_definition_versions,
  public.journey_metric_imports,
  public.journey_metric_rebuild_attempts,
  public.journey_metric_observations,
  public.journey_metric_observation_sources,
  public.journey_metric_audit_events,
  public.journey_ai_suggestion_evidence,
  public.journey_ai_suggestion_changes,
  public.journey_ai_suggestion_decisions,
  public.journey_ai_suggestion_audit_events,
  public.journey_ai_suggestion_purge_receipts,
  public.journey_persona_versions,
  public.journey_persona_claims,
  public.journey_persona_claim_evidence,
  public.journey_persona_review_events,
  public.journey_map_version_personas,
  public.journey_channel_versions,
  public.journey_touchpoint_versions,
  public.journey_rich_card_audit_events,
  public.journey_metric_alert_definition_versions,
  public.journey_metric_alert_evaluation_results,
  public.journey_metric_alert_events,
  public.journey_metric_alert_notifications,
  public.journey_metric_alert_notification_state_events,
  public.journey_saved_view_operations,
  public.journey_saved_view_audit_events,
  public.journey_portfolio_item_versions,
  public.journey_portfolio_scoring_policy_versions,
  public.journey_portfolio_priority_assessments,
  public.journey_initiative_baselines,
  public.journey_initiative_outcome_comparisons,
  public.journey_portfolio_reviews,
  public.journey_portfolio_operations,
  public.journey_portfolio_activity,
  public.journey_collaboration_role_events,
  public.journey_comment_versions,
  public.journey_governance_review_events,
  public.journey_governance_publications,
  public.journey_collaboration_notifications,
  public.journey_collaboration_notification_state_events,
  public.journey_share_access_events,
  public.journey_collaboration_operations,
  public.journey_collaboration_activity,
  public.journey_collaboration_audit_events,
  public.journey_hierarchy_health_snapshots,
  public.journey_blueprint_versions,
  public.journey_blueprint_stages,
  public.journey_blueprint_elements,
  public.journey_blueprint_element_resources,
  public.journey_blueprint_relationships,
  public.journey_blueprint_comparisons,
  public.journey_hierarchy_operations,
  public.journey_hierarchy_activity,
  public.journey_stage_reprojection_attempts,
  public.journey_stage_reprojection_audit_events,
  public.journey_identity_merges,
  public.journey_identity_source_facts,
  public.journey_identity_audit_facts,
  public.journey_identity_profile_tombstones,
  public.journey_identity_identifier_tombstones,
  public.journey_identity_processed_commands
FROM __APP_ROLE__;
REVOKE UPDATE ON TABLE public.journey_profile_timeline_events FROM __APP_ROLE__;
REVOKE DELETE ON TABLE
  public.journey_event_rate_buckets,
  public.journey_event_processing_inbox,
  public.journey_event_dead_letters,
  public.journey_stage_rule_definitions,
  public.journey_stage_rule_versions,
  public.journey_anonymous_instances,
  public.journey_metric_segments,
  public.journey_metric_bindings,
  public.journey_metric_definitions,
  public.journey_metric_rebuild_runs,
  public.journey_metric_checkpoints,
  public.journey_ai_suggestion_runs,
  public.journey_metric_alert_definitions,
  public.journey_metric_alert_evaluation_runs,
  public.journey_metric_alerts,
  public.journey_metric_alert_notification_preferences,
  public.journey_metric_alert_notification_states,
  public.journey_saved_view_settings,
  -- Runtime 27-29. Two reasons appear here: a settings/quota/credential row the
  -- runtime may change but must not erase, and a parent whose ON DELETE CASCADE
  -- reaches append-only children. The children's seals are BEFORE UPDATE only so
  -- an owner retention sweep can still reach them, which means a cascade from an
  -- app-role DELETE would have erased that history without ever firing a guard.
  public.journey_portfolio_settings,
  public.journey_portfolio_items,
  public.journey_portfolio_scoring_policies,
  public.journey_collaboration_settings,
  public.journey_collaboration_role_assignments,
  public.journey_comments,
  public.journey_governance_reviews,
  public.journey_collaboration_notification_states,
  public.journey_read_only_shares,
  public.journey_share_rate_buckets,
  public.journey_hierarchy_settings,
  public.journey_hierarchy_health_policies,
  public.journey_blueprints,
  public.journey_stage_reprojection_runs,
  public.journey_stage_reprojection_checkpoints,
  public.journey_identity_profiles,
  public.journey_identity_groups,
  public.journey_identity_segments,
  public.journey_identity_segment_versions,
  public.journey_profile_privacy_states,
  public.journey_profile_privacy_jobs,
  public.journey_identity_correction_runs
FROM __APP_ROLE__;
-- Blob purge receipts are stateful while pending, but are durable history:
-- the runtime may claim/update them and cannot erase completed or failed
-- evidence. Owner-operated retention remains possible outside the app role.
REVOKE DELETE ON TABLE public.journey_asset_blob_purge_outbox FROM __APP_ROLE__;

-- Suggestion purge is an offline, owner-operated maintenance procedure. The
-- ordinary runtime can append reviewed history but cannot invoke erasure or
-- forge its deidentified receipts.
REVOKE INSERT ON TABLE public.journey_ai_suggestion_purge_receipts FROM __APP_ROLE__;
REVOKE EXECUTE ON FUNCTION public.journey_ai_suggestion_controlled_purge(TEXT,TEXT,TEXT,TEXT)
  FROM __APP_ROLE__;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM __APP_ROLE__;
COMMIT;
