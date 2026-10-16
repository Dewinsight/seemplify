const NOMIC_PROFILE = Object.freeze({ provider: 'nomic-node', model: 'nomic-ai/nomic-embed-text-v1.5', revision: 'e9b6763023c676ca8431644204f50c2b100d9aab', dtype: 'q8', dimensions: 768, vectorIndexVersion: 'nomic-embed-text-v1.5-q8-v1' });
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';

function readFirst(environment, keys) {
  for (const key of keys) {
    const value = environment[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getEmbeddingRuntimeConfig(environment = process.env) {
  const provider = environment.RECRUITER_EMBEDDING_PROVIDER || 'azure-openai';
  if (provider === 'nomic-node') {
    const url = String(environment.RECRUITER_EMBEDDING_URL || '').trim();
    const secretFile = String(environment.RECRUITER_EMBEDDING_HMAC_SECRET_FILE || '').trim();
    return Object.freeze({ ...NOMIC_PROFILE, url, secretFile, candidateClass: 'RecruiterCandidateNomicV1', jobClass: 'RecruiterJobNomicV1', configured: Boolean(url && secretFile) });
  }
  if (provider !== 'azure-openai') throw new Error('Unsupported Recruiter embedding provider.');
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
      'Embeddings are not configured. Set RECRUITER_EMBEDDING_URL and RECRUITER_EMBEDDING_HMAC_SECRET_FILE for Nomic, or AZURE_OPENAI_EMBEDDING_URL and AZURE_OPENAI_EMBEDDING_API_KEY for legacy Azure.'
    );
  }
  return config;
}

module.exports = {
  NOMIC_PROFILE,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingRuntimeConfig,
  requireEmbeddingRuntimeConfig
};
