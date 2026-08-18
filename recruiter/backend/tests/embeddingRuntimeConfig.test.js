const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingRuntimeConfig,
  requireEmbeddingRuntimeConfig
} = require('../config/embeddingRuntimeConfig');

test('embedding configuration uses canonical production variables', () => {
  const config = getEmbeddingRuntimeConfig({
    AZURE_OPENAI_EMBEDDING_URL: 'https://example.test/embeddings',
    AZURE_OPENAI_EMBEDDING_API_KEY: 'test-key',
    AZURE_OPENAI_EMBEDDING_MODEL: 'production-model'
  });

  assert.deepEqual(config, {
    url: 'https://example.test/embeddings',
    apiKey: 'test-key',
    model: 'production-model',
    configured: true
  });
});

test('legacy lowercase variables remain supported during deployment migration', () => {
  const config = getEmbeddingRuntimeConfig({
    azure_openai_embedding_url: 'https://legacy.test/embeddings',
    azure_openai_embedding_key: 'legacy-key'
  });

  assert.equal(config.url, 'https://legacy.test/embeddings');
  assert.equal(config.apiKey, 'legacy-key');
  assert.equal(config.model, DEFAULT_EMBEDDING_MODEL);
  assert.equal(config.configured, true);
});

test('embedding generation fails closed when endpoint credentials are absent', () => {
  assert.throws(
    () => requireEmbeddingRuntimeConfig({}),
    /AZURE_OPENAI_EMBEDDING_URL.*AZURE_OPENAI_EMBEDDING_API_KEY/u
  );
});
