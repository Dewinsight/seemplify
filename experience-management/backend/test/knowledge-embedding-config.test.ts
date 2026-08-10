import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  gteKnowledgeEmbeddingProfile, qwenKnowledgeEmbeddingProfile, resolveKnowledgeEmbeddingConfiguration
} from '../src/config.js';

test('keeps pinned CPU-based GTE as the production default', () => {
  const resolved = resolveKnowledgeEmbeddingConfiguration({});
  assert.deepEqual(resolved.profile, gteKnowledgeEmbeddingProfile);
  assert.equal(resolved.concurrency, 8);
  assert.equal(resolved.dualWrite, false);
  assert.equal(resolved.qwenRollbackRetained, false);
  assert.equal(resolved.forceQwen, false);
});

test('accepts only the pinned GTE q8 embedding-space contract', () => {
  const resolved = resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node',
    EXPERIENCE_EMBEDDING_MODEL: gteKnowledgeEmbeddingProfile.model,
    EXPERIENCE_EMBEDDING_MODEL_REVISION: gteKnowledgeEmbeddingProfile.revision,
    EXPERIENCE_EMBEDDING_DTYPE: 'q8',
    EXPERIENCE_EMBEDDING_DIMENSIONS: '768',
    EXPERIENCE_EMBEDDING_CONCURRENCY: '8',
    EXPERIENCE_VECTOR_INDEX_VERSION: 'gte-modernbert-v1',
    EXPERIENCE_EMBEDDING_DUAL_WRITE: 'false',
    EXPERIENCE_QWEN_ROLLBACK_RETAINED: 'false'
  });
  assert.deepEqual(resolved.profile, gteKnowledgeEmbeddingProfile);
  assert.equal(resolved.concurrency, 8);
  assert.equal(resolved.dualWrite, false);
  assert.equal(resolved.qwenRollbackRetained, false);
});

test('rejects mixed, unpinned, or unsafe provider settings before startup', () => {
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_EMBEDDING_PROVIDER: 'unknown' }),
    /must be either qwen-tei or gte-node/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node', EXPERIENCE_EMBEDDING_DIMENSIONS: '2560'
  }), /gte-node requires/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node', EXPERIENCE_EMBEDDING_DTYPE: 'float32'
  }), /gte-node requires/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_EMBEDDING_MODEL_REVISION: 'main' }),
    /pinned 40-character/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_EMBEDDING_MODEL_REVISION: '0'.repeat(40) }),
    /pinned Alibaba-NLP\/gte-modernbert-base/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_EMBEDDING_CONCURRENCY: '16' }),
    /between 1 and 8/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_VECTOR_INDEX_VERSION: 'GTE V1' }),
    /stable lowercase identifier/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({ EXPERIENCE_EMBEDDING_DUAL_WRITE: 'sometimes' }),
    /must be a boolean/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node', EXPERIENCE_QWEN_ROLLBACK_RETAINED: 'true'
  }),
    /requires dual-write/u);
  assert.throws(() => resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_QWEN_ROLLBACK_RETAINED: 'false', EXPERIENCE_EMBEDDING_DUAL_WRITE: 'true'
  }), /cannot dual-write/u);

  const forcedRollback = resolveKnowledgeEmbeddingConfiguration({
    EXPERIENCE_EMBEDDING_FORCE_QWEN: 'true', EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node',
    EXPERIENCE_EMBEDDING_MODEL: 'conflicting/model', EXPERIENCE_EMBEDDING_MODEL_REVISION: '0'.repeat(40),
    EXPERIENCE_EMBEDDING_DTYPE: 'q8', EXPERIENCE_EMBEDDING_DIMENSIONS: '768',
    EXPERIENCE_VECTOR_INDEX_VERSION: 'gte-modernbert-v1', EXPERIENCE_EMBEDDING_DUAL_WRITE: 'true'
  });
  assert.deepEqual(forcedRollback.profile, qwenKnowledgeEmbeddingProfile);
  assert.equal(forcedRollback.dualWrite, false);
  assert.equal(forcedRollback.forceQwen, true);
});

test('runtime schema 3 migration is additive and carries durable rollout state', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0003_knowledge_embedding_profiles.sql'), 'utf8');
  const compatibility = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'runtime-compatibility.json'), 'utf8'));
  for (const contract of [
    'knowledge_embedding_profiles', 'knowledge_base_embedding_profiles', 'knowledge_document_embeddings',
    'knowledge_backfill_runs', 'knowledge_backfill_run_bases', 'knowledge_backfill_items',
    'knowledge_embedding_promotion_approvals', 'lease_owner', 'lease_expires_at', 'source_index_version',
    'runtime_attestation_sha256', 'embedding_profile_id', 'target_version_reserved',
    'knowledge_embedding_promotion_evidence_immutable', 'gte-modernbert-v1', 'qwen-v1'
  ]) assert.match(migration, new RegExp(contract, 'u'));
  assert.match(migration, /ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS/u);
  assert.deepEqual(compatibility, {
    minimumRuntimeSchemaVersion: 55,
    maximumRuntimeSchemaVersion: 55,
    minimumUpgradeSourceRuntimeSchemaVersion: 4
  });
});

test('SQLite cutover restores reviewed social-publication hash checks before runtime migration 6 is validated', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0006_reviewed_social_intelligence_publications.sql'), 'utf8');
  const migrator = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'migrate-sqlite-to-postgres.mjs'), 'utf8');
  for (const column of ['source_snapshot_sha256', 'artifact_sha256']) {
    assert.match(migration, new RegExp(`${column} TEXT NOT NULL CHECK\\(${column} ~ '\\^\\[a-f0-9\\]\\{64\\}\\$'\\)`, 'u'));
    assert.match(migrator, new RegExp(`"${column} ~ '\\^\\[a-f0-9\\]\\{64\\}\\$'"`, 'u'),
      `${column} must be normalised for pre-constraint SQLite stores`);
  }
  assert.match(migrator, /new Set\(\[\.\.\.sourceChecks, \.\.\.\(REQUIRED_POSTGRES_CHECKS\.get\(raw\.name\) \|\| \[\]\)\]\)/u,
    'source and required checks must be deduplicated in the generated PostgreSQL table');
  assert.match(migrator,
    /social_intelligence_publications\\u001fdocument_id', 'social_intelligence_publications_document_id_key'/u,
    'the inline SQLite UNIQUE constraint must retain its stable PostgreSQL runtime index name');
});

test('SQLite cutover preserves exact integer widths and index names for runtime-owned tables', () => {
  const migrator = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'migrate-sqlite-to-postgres.mjs'), 'utf8');
  const integerColumns = {
    deep_analysis_runs: ['progress', 'total_partitions', 'completed_partitions', 'failed_partitions'],
    deep_analysis_partitions: ['ordinal', 'level', 'token_estimate'],
    journey_personas: ['revision'],
    journey_definitions: ['review_cadence_days', 'revision'],
    journey_map_versions: ['version_number', 'schema_version'],
    journey_map_stages: ['ordinal'],
    journey_map_lanes: ['ordinal', 'visible'],
    journey_map_cards: ['ordinal'],
    journey_definition_personas: ['ordinal'],
    journey_evidence_links: ['sample_size', 'freshness_days'],
    journey_templates: ['revision'],
    journey_template_versions: ['version_number', 'schema_version', 'revision']
  } as const;
  for (const [table, columns] of Object.entries(integerColumns)) {
    for (const column of columns) {
      assert.ok(migrator.includes(`['${table}\\u001f${column}', 'INTEGER']`),
        `${table}.${column} must retain its PostgreSQL INTEGER runtime contract`);
    }
  }
  assert.match(migrator,
    /deep_analysis_partitions\\u001frun_id,ordinal', 'deep_analysis_partitions_run_id_ordinal_key'/u,
    'the deep-analysis inline UNIQUE constraint must retain its stable PostgreSQL runtime index name');
  assert.match(migrator,
    /REQUIRED_POSTGRES_COLUMN_TYPES\.get\(`\$\{raw\.name\}\\u001f\$\{String\(column\.name\)\}`\)/u,
    'runtime-owned column overrides must be applied during schema introspection');
});

test('runtime schema 11 bounds active AI request indexes for PostgreSQL', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0011_bounded_active_request_indexes.sql'), 'utf8');
  const migrator = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'migrate-sqlite-to-postgres.mjs'), 'utf8');
  for (const index of [
    'social_reply_drafts_one_active_request',
    'social_intelligence_reports_one_active_request',
    'intelligence_reports_one_active_request'
  ]) {
    assert.match(migration, new RegExp(`DROP INDEX IF EXISTS ${index}`, 'u'));
    assert.match(migration, new RegExp(`CREATE UNIQUE INDEX ${index}`, 'u'));
    assert.match(migrator, new RegExp(`${index}: \\[`, 'u'));
  }
  assert.match(migration, /md5\(mention_ids_json\)/u);
  assert.match(migration, /md5\(instructions\)/u);
  assert.match(migration, /md5\(source_refs_json\)/u);
  assert.doesNotMatch(migration, /title,mention_ids_json\)/u);
});

test('runtime schema 12 adds the Journey Map 2.0 tables additively and at SQLite parity', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0012_journey_map_v2.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'database.ts'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  const tables = [
    'journey_personas', 'journey_definitions', 'journey_map_versions', 'journey_map_stages',
    'journey_map_lanes', 'journey_map_cards', 'journey_definition_personas', 'journey_evidence_links'
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'), `${table} is missing from the SQLite schema`);
    // Every journey table must carry the tenancy predicate as a typed column.
    const definition = migration.slice(migration.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
    assert.match(definition.slice(0, definition.indexOf(');')), /space_id TEXT NOT NULL REFERENCES spaces\(id\) ON DELETE CASCADE/u);
  }
  // Index names must match on both paths so one runtime contract covers a
  // fresh SQLite-to-PostgreSQL cutover and an in-place upgrade alike.
  for (const index of [
    'journey_personas_space_name', 'journey_definitions_legacy', 'journey_map_versions_definition_number',
    'journey_map_stages_version_key', 'journey_map_lanes_version_lane', 'journey_map_cards_cell',
    'journey_evidence_links_unique'
  ]) {
    assert.match(migration, new RegExp(`INDEX IF NOT EXISTS ${index}`, 'u'));
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}`, 'u'), `${index} is missing from the SQLite schema`);
  }
  // The legacy journey table gains no new referential dependency, so the
  // pre-Map-2.0 rollback window stays intact.
  assert.doesNotMatch(migration, /REFERENCES journeys\(id\)/u);
  assert.match(migration, /legacy_journey_id TEXT,/u);
  // A catalogue release must merge missing plan keys, never replace the object.
  assert.match(migration, /UPDATE platform_subscription_plans SET/u);
  assert.match(migration, /jsonb_object_keys\(features_json::jsonb\)/u);
  assert.match(migration, /"journeyDesign":true/u);
  // PostgreSQL REAL is 32-bit, unlike SQLite's dynamic REAL storage. Preserve
  // the exact double-precision contract used by cutovers and runtime readers.
  assert.match(migration, /confidence DOUBLE PRECISION NOT NULL DEFAULT 0/u);
  // PostgreSQL 16 renders these comparisons as `>= 0::double precision`; the
  // contract fragments must follow that stable pg_get_constraintdef shape.
  assert.match(runtimeContract, /\['confidence', '>= 0', '<= 1'\]/u);
});

test('runtime schema 13 adds governed journey templates, version pins, and explicit administration permissions', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0013_governed_journey_templates.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'database.ts'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  for (const table of [
    'journey_templates', 'journey_template_versions', 'journey_template_instantiations',
    'journey_template_audit_events'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(runtimeContract, new RegExp(`${table}: \\[`, 'u'));
  }
  assert.match(migration, /state TEXT NOT NULL DEFAULT 'draft' CHECK\(state IN \('draft','in_review','published','retired'\)\)/u);
  assert.match(migration, /template_version_id TEXT NOT NULL REFERENCES journey_template_versions\(id\) ON DELETE RESTRICT/u);
  assert.match(migration, /journey_templates\.read/u);
  assert.match(migration, /journey_templates\.manage/u);
  assert.doesNotMatch(migration, /INSERT INTO journey_templates/u,
    'reviewable system seeds are inserted by the canonical application catalogue, not duplicated in SQL');
});

test('runtime schema 14 adds permission-aware evidence refresh lineage and append-only audit', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0014_journey_evidence_lifecycle.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'database.ts'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  const manage = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'manage.ps1'), 'utf8');
  const autoDeploy = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'auto-deploy.ps1'), 'utf8');
  for (const column of ['source_updated_at', 'last_validated_at']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} TEXT`, 'u'));
    assert.match(sqlite, new RegExp(`${column} TEXT`, 'u'));
  }
  assert.match(migration, /CREATE TABLE IF NOT EXISTS journey_evidence_audit_events \(/u);
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS journey_evidence_audit_events \(/u);
  assert.match(migration, /before_fingerprint TEXT NOT NULL CHECK\(length\(before_fingerprint\)=64\)/u);
  assert.match(migration, /after_fingerprint TEXT NOT NULL CHECK\(length\(after_fingerprint\)=64\)/u);
  assert.match(privileges, /REVOKE UPDATE,DELETE ON TABLE public\.journey_evidence_audit_events/u);
  assert.match(manage, /function Get-ManagedPostgresRuntimeSchemaVersion\(\[string\]\$ProjectDir\)/u);
  assert.match(manage, /\$maximum = \[int\]\$metadata\.maximumRuntimeSchemaVersion/u);
  assert.match(manage, /\$targetRuntimeSchemaVersion = Get-ManagedPostgresRuntimeSchemaVersion \$ProjectDir/u);
  assert.match(autoDeploy, /PostgresRuntime14UpgradeMarker/u);
  assert.match(autoDeploy, /RequiredVersion -ge 14/u);
  assert.match(autoDeploy, /0014_journey_evidence_lifecycle\.sql/u);
  assert.match(autoDeploy, /SourceVersion 14 -TargetVersion 17/u);
});

test('runtime schema 15 adds an append-only metering ledger and mutable reconciliation buckets', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0015_subscription_usage_ledger.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'platformSchema.ts'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  const autoDeploy = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'auto-deploy.ps1'), 'utf8');
  for (const table of ['platform_usage_events', 'platform_usage_buckets']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
  }
  assert.match(migration, /platform_usage_events_idempotency/u);
  assert.match(migration, /event_type='usage\.ai_action'/u);
  assert.doesNotMatch(migration, /metadata_json/u);
  assert.match(privileges, /REVOKE UPDATE,DELETE ON TABLE public\.platform_usage_events/u);
  assert.match(privileges, /REVOKE DELETE ON TABLE public\.platform_usage_buckets/u);
  assert.match(autoDeploy, /PostgresRuntime15UpgradeMarker/u);
  assert.match(autoDeploy, /RequiredVersion -ge 15/u);
  assert.match(autoDeploy, /0015_subscription_usage_ledger\.sql/u);
});

test('runtime schema 17 adds partitioned immutable event facts with global dedupe and leased processing', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0017_journey_event_data_plane.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'platformSchema.ts'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  const manage = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'manage.ps1'), 'utf8');
  for (const table of [
    'journey_event_deduplication','journey_raw_events','journey_event_ingest_receipts',
    'journey_event_rejections','journey_event_rate_buckets','journey_event_processing_inbox',
    'journey_event_processing_receipts','journey_event_dead_letters','journey_event_data_audit'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(runtimeContract, new RegExp(`${table}: \\[`, 'u'));
  }
  assert.match(migration, /PRIMARY KEY\(space_id,source_id,event_id\)/u);
  assert.match(migration, /PARTITION BY RANGE\(received_at\)/u);
  assert.match(migration, /PARTITION BY RANGE\(attempted_at\)/u);
  assert.match(migration, /protocol_version TEXT NOT NULL CHECK\(protocol_version='1\.0'\)/u);
  assert.match(migration, /event_call NOT IN \('track','metric'\)/u);
  assert.match(migration, /journey_raw_events_schema_version_tenant_source_fk/u);
  assert.match(migration, /first_outcome TEXT NOT NULL CHECK\(first_outcome IN \('accepted','quarantined'\)\)/u);
  assert.match(migration, /ingest_state<>'quarantined' OR jsonb_array_length\(validation_issues_json\)>0/u);
  assert.match(migration, /journey_event_append_only_guard/u);
  assert.match(privileges, /public\.journey_raw_events/u);
  assert.match(privileges, /public\.journey_event_processing_receipts/u);
  assert.doesNotMatch(migration, /INDEX[^;]+(?:payload_json|context_json|consent_json|validation_issues_json)/su);
  assert.match(manage, /\$JourneyIdentityHashKeyFile/u);
  assert.match(manage, /New-RandomSecret 49/u);
  assert.match(manage, /\$env:JOURNEY_IDENTITY_HASH_KEY_FILE=\$JourneyIdentityHashKeyFile/u);
  assert.match(manage, /Protect-RuntimeSecret \$secretFile/u);
});

test('runtime schema 20 adds revisioned journey rollout controls and a content-free immutable divergence ledger', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0020_journey_v2_rollout.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'journeyRollout.ts'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  for (const table of ['journey_v2_rollout_platform', 'journey_v2_rollout_spaces', 'journey_v2_divergences']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(runtimeContract, new RegExp(`${table}: \\[`, 'u'));
  }
  assert.match(migration, /require(?:s)? the checksummed runtime-19 predecessor/u);
  assert.match(migration, /effective_at TIMESTAMPTZ NOT NULL/u);
  assert.match(migration, /journey_v2_divergences_append_only_trigger/u);
  assert.match(migration, /journey_rollout\.read/u);
  assert.match(migration, /journey_rollout\.manage/u);
  assert.match(privileges, /public\.journey_v2_divergences/u);
  assert.doesNotMatch(migration, /(?:content|excerpt|payload)_json|journey_content|legacy_content/iu,
    'divergence storage must remain identifiers, checksums, and bounded reason codes only');
});

test('runtime schema 21 adds definition-scoped immutable metric observations without copying source payloads', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0021_journey_metric_observations.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'journeyMetricSchema.ts'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  for (const table of ['journey_metric_segments','journey_metric_bindings','journey_metric_definitions',
    'journey_metric_definition_versions','journey_metric_imports','journey_metric_rebuild_runs',
    'journey_metric_rebuild_attempts','journey_metric_observations','journey_metric_observation_sources',
    'journey_metric_checkpoints','journey_metric_audit_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(runtimeContract, new RegExp(`${table}: \\[`, 'u'));
    assert.match(privileges, new RegExp(`(?:public\\.)?${table}`, 'u'));
  }
  assert.match(migration, /MAX\(version\)[^;]*<>20/isu);
  assert.match(migration, /UNIQUE\(space_id,definition_id,source_id,external_record_sha256,revision\)/u);
  assert.match(migration, /journey_metric_observations_append_only/u);
  assert.doesNotMatch(migration, /answers_json|properties_json\s+JSONB|payload_json/u,
    'runtime 21 must retain bounded aggregates and content-free lineage, not duplicate source payloads');
});

test('runtime schema 22 adds tenant-scoped reviewed journey suggestion history and owner-only purge', () => {
  const migrationRoot = path.resolve(process.cwd(), 'migrations', 'postgres');
  const migration = fs.readFileSync(path.join(migrationRoot, '0022_journey_ai_suggestions.sql'), 'utf8');
  const sqlite = fs.readFileSync(path.resolve(process.cwd(), 'src', 'journeySuggestions.ts'), 'utf8');
  const runtimeContract = fs.readFileSync(path.resolve(process.cwd(), '..', 'scripts', 'postgres-runtime-contract.mjs'), 'utf8');
  const privileges = fs.readFileSync(path.join(migrationRoot, 'runtime_privileges.sql'), 'utf8');
  for (const table of ['journey_ai_suggestion_runs','journey_ai_suggestion_evidence',
    'journey_ai_suggestion_changes','journey_ai_suggestion_decisions','journey_ai_suggestion_audit_events',
    'journey_ai_suggestion_purge_receipts']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'u'));
    assert.match(runtimeContract, new RegExp(`${table}: \\[`, 'u'));
    assert.match(privileges, new RegExp(`(?:public\\.)?${table}`, 'u'));
  }
  assert.match(migration, /MAX\(version\)[^;]*<>21/isu);
  assert.match(migration, /journey_ai_suggestion_controlled_purge/u);
  assert.match(privileges, /REVOKE EXECUTE ON FUNCTION public\.journey_ai_suggestion_controlled_purge/u);
  assert.match(migration, /FOREIGN KEY\(change_id,run_id,space_id\)/u);
  assert.doesNotMatch(migration, /answers_json|properties_json\s+JSONB|raw_payload_json/u);
});

test('ordinary knowledge dispatch SQL is deterministic and PostgreSQL portable', () => {
  const repository = fs.readFileSync(path.resolve(process.cwd(), 'src', 'knowledgeRepository.ts'), 'utf8');
  assert.doesNotMatch(repository, /\browid\b/iu);
  assert.match(repository, /ORDER BY queued\.created_at,queued\.id LIMIT 1/iu);
  assert.match(repository, /candidate\.created_at,candidate\.id LIMIT 1\$\{lock\}/u);
  assert.match(repository, /ORDER BY created_at,id LIMIT \?/u);
  assert.match(repository, /FOR UPDATE OF candidate SKIP LOCKED/u);
});
