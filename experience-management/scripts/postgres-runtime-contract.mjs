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

export function runtimeExtensionTables(runtimeVersion = 11) {
  const tables = [...BASE_RUNTIME_EXTENSION_TABLES];
  if (runtimeVersion >= 6) tables.push('social_intelligence_publications');
  if (runtimeVersion >= 7) tables.push('assistant_outbound_messages');
  if (runtimeVersion >= 8) tables.push('platform_rbac_roles', 'platform_rbac_role_permissions', 'platform_rbac_user_roles');
  if (runtimeVersion >= 9) tables.push('platform_subscription_plans');
  if (runtimeVersion >= 10) tables.push('deep_analysis_runs', 'deep_analysis_partitions', 'deep_analysis_evidence');
  return tables;
}

export const RUNTIME_EXTENSION_TABLES = Object.freeze(runtimeExtensionTables(10));

export function runtimeTableSetDifference(sourceTableNames, actualTableNames, runtimeVersion = 11) {
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
  const runtimeVersion = Number(options.runtimeVersion ?? 11);
  if (!Number.isSafeInteger(runtimeVersion) || runtimeVersion < 1) {
    throw contractError('RUNTIME_SCHEMA_VERSION_INVALID', 'Runtime schema contract version must be a positive integer.');
  }
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
    if (JSON.stringify(byTable.get(table) || []) !== JSON.stringify(expected)) {
      throw contractError('RUNTIME_SCHEMA_COLUMN_MISMATCH', `Runtime table ${schema}.${table} does not match its exact column contract.`);
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
        throw contractError('RUNTIME_SCHEMA_CHECK_MISMATCH', `A required check constraint on ${schema}.${table} is missing or malformed.`);
      }
    }
  }

  const indexRows = await rows(query, `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=${sqlLiteral(schema)}`);
  const actualIndexes = new Map(indexRows.map((row) => [String(row.indexname), normalized(row.indexdef)]));
  for (const [name, fragments] of Object.entries(indexContract)) {
    const definition = actualIndexes.get(name) || '';
    if (!definition || fragments.some((fragment) => !definition.includes(normalized(fragment)))) {
      throw contractError('RUNTIME_SCHEMA_INDEX_MISMATCH', `Index ${schema}.${name} is missing or does not match its runtime contract.${definition ? ` Actual definition: ${definition}` : ''}`);
    }
  }

  return { schema, runtimeVersion, extensionTables: runtimeExtensionTables(runtimeVersion).length, indexes: Object.keys(indexContract).length };
}

export async function assertRuntimePrivileges(query, runtimeRole, options = {}) {
  const schema = String(options.schema || 'public');
  if (!IDENTIFIER.test(schema) || !IDENTIFIER.test(runtimeRole)) {
    throw contractError('RUNTIME_PRIVILEGE_IDENTIFIER_INVALID', 'Unsafe PostgreSQL schema or role identifier in privilege contract.');
  }
  const expectations = [
    ['experience_schema_version', true, false, false, false],
    ['schema_migrations', true, false, false, false],
    ['experience_runtime_schema_version', true, false, false, false],
    ['platform_audit_events', true, true, false, false],
    ['platform_subscription_events', true, true, false, false],
    ['ticket_events', true, true, false, false],
    ['assistant_audit_events', true, true, false, false],
    ['platform_rbac_roles', true, true, true, true],
    ['platform_rbac_role_permissions', true, true, true, true],
    ['platform_rbac_user_roles', true, true, true, true]
  ];
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
  return { role: runtimeRole, protectedTables: expectations.length };
}
