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
    minimumRuntimeSchemaVersion: 8,
    maximumRuntimeSchemaVersion: 8,
    minimumUpgradeSourceRuntimeSchemaVersion: 4
  });
});

test('ordinary knowledge dispatch SQL is deterministic and PostgreSQL portable', () => {
  const repository = fs.readFileSync(path.resolve(process.cwd(), 'src', 'knowledgeRepository.ts'), 'utf8');
  assert.doesNotMatch(repository, /\browid\b/iu);
  assert.match(repository, /ORDER BY queued\.created_at,queued\.id LIMIT 1/iu);
  assert.match(repository, /candidate\.created_at,candidate\.id LIMIT 1\$\{lock\}/u);
  assert.match(repository, /ORDER BY created_at,id LIMIT \?/u);
  assert.match(repository, /FOR UPDATE OF candidate SKIP LOCKED/u);
});
