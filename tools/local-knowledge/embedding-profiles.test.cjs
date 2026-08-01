'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  EMBEDDING_PROFILES,
  GTE_MODEL_REVISION,
  embeddingConfigurationFromEnv,
  resolveEmbeddingProfile,
  validateEmbeddingProfile,
  validateEmbeddingVectors,
  vectorNorm,
} = require('./embedding-profiles.cjs');

test('embedding profiles are immutable, pinned, and default to qwen-tei', () => {
  assert.equal(resolveEmbeddingProfile(), EMBEDDING_PROFILES['qwen-tei']);
  assert.equal(resolveEmbeddingProfile('gte-modernbert-v1'), EMBEDDING_PROFILES['gte-node']);
  assert.equal(EMBEDDING_PROFILES['gte-node'].revision, GTE_MODEL_REVISION);
  assert.deepEqual({
    model: EMBEDDING_PROFILES['gte-node'].modelId,
    dtype: EMBEDDING_PROFILES['gte-node'].dtype,
    dimension: EMBEDDING_PROFILES['gte-node'].dimension,
    pooling: EMBEDDING_PROFILES['gte-node'].pooling,
    normalize: EMBEDDING_PROFILES['gte-node'].normalize,
  }, {
    model: 'Alibaba-NLP/gte-modernbert-base', dtype: 'q8', dimension: 768, pooling: 'cls', normalize: true,
  });
  assert.equal(Object.isFrozen(EMBEDDING_PROFILES), true);
  assert.equal(Object.isFrozen(EMBEDDING_PROFILES['gte-node']), true);
  assert.throws(() => { EMBEDDING_PROFILES['gte-node'].dimension = 12; }, TypeError);
});

test('environment configuration validates the complete provider profile and safety cap', () => {
  const config = embeddingConfigurationFromEnv({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node',
    EXPERIENCE_EMBEDDING_CONCURRENCY: '8',
    SEEMPLIFY_KNOWLEDGE_DATA_ROOT: path.join('D:\\', 'KnowledgeTest'),
  });
  assert.equal(config.provider, 'gte-node');
  assert.equal(config.concurrency, 8);
  assert.equal(config.profile.dimension, 768);
  assert.match(config.cacheDir, /models[\\/]transformers$/u);
  assert.throws(() => embeddingConfigurationFromEnv({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node', EXPERIENCE_EMBEDDING_DIMENSIONS: '2560',
  }), /invalid dimension/);
  assert.throws(() => embeddingConfigurationFromEnv({
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node', EXPERIENCE_EMBEDDING_CONCURRENCY: '9',
  }), /between 1 and 8/);
  assert.throws(() => validateEmbeddingProfile({
    ...EMBEDDING_PROFILES['gte-node'], revision: 'floating-main',
  }), /invalid revision/);
});

test('vector validation enforces count, 768 dimensions, finite values, and normalization', () => {
  const valid = [Array.from({ length: 768 }, (_value, index) => index === 11 ? 1 : 0)];
  assert.equal(validateEmbeddingVectors(valid, { expectedCount: 1 }), valid);
  assert.equal(vectorNorm(valid[0]), 1);
  assert.throws(() => validateEmbeddingVectors([[1, 0]], { expectedCount: 1 }), /exactly 768/);
  assert.throws(() => validateEmbeddingVectors([Array(768).fill(0)], { expectedCount: 1 }), /not normalized/);
  const invalid = Array(768).fill(0); invalid[0] = Number.NaN;
  assert.throws(() => validateEmbeddingVectors([invalid], { expectedCount: 1 }), /non-finite/);
});
