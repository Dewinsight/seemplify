const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';

function readFirst(environment, keys) {
  for (const key of keys) {
    const value = environment[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getEmbeddingRuntimeConfig(environment = process.env) {
  const url = readFirst(environment, [
    'AZURE_OPENAI_EMBEDDING_URL',
    'azure_openai_embedding_url'
  ]);
  const apiKey = readFirst(environment, [
    'AZURE_OPENAI_EMBEDDING_API_KEY',
    'AZURE_OPENAI_EMBEDDING_KEY',
    'azure_openai_embedding_key'
  ]);
  const model = readFirst(environment, [
    'AZURE_OPENAI_EMBEDDING_MODEL',
    'AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME',
    'azure_openai_embedding_model'
  ]) || DEFAULT_EMBEDDING_MODEL;

  return Object.freeze({ url, apiKey, model, configured: Boolean(url && apiKey) });
}

function requireEmbeddingRuntimeConfig(environment = process.env) {
  const config = getEmbeddingRuntimeConfig(environment);
  if (!config.configured) {
    throw new Error(
      'Azure OpenAI embeddings are not configured. Set AZURE_OPENAI_EMBEDDING_URL and AZURE_OPENAI_EMBEDDING_API_KEY.'
    );
  }
  return config;
}

module.exports = {
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingRuntimeConfig,
  requireEmbeddingRuntimeConfig
};
