const path = require('node:path');

const GTE_MODEL_REVISION = 'e7f32e3c00f91d699e8c43b53106206bcc72bb22';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const EMBEDDING_PROFILES = deepFreeze({
  'azure-openai': {
    id: 'azure-openai',
    provider: 'azure-openai',
    modelId: 'text-embedding-3-large',
    revision: 'f0706db2d8dd64a5f9385fd9ab1713b9083eb881',
    dtype: 'float32',
    dimension: 3072,
    pooling: 'model-default',
    normalize: true,
    vectorIndexVersion: 'azure-text-embedding-3-large-v1',
    execution: 'azure-openai',
  },
  'qwen-tei': {
    id: 'qwen-tei',
    provider: 'qwen-tei',
    modelId: 'Qwen/Qwen3-Embedding-4B',
    revision: '5cf2132abc99cad020ac570b19d031efec650f2b',
    dtype: 'float16',
    dimension: 2560,
    pooling: 'model-default',
    normalize: true,
    vectorIndexVersion: 'qwen-v1',
    execution: 'gpu-tei',
  },
  'gte-node': {
    id: 'gte-node',
    provider: 'gte-node',
    modelId: 'Alibaba-NLP/gte-modernbert-base',
    revision: GTE_MODEL_REVISION,
    dtype: 'q8',
    dimension: 768,
    pooling: 'cls',
    normalize: true,
    vectorIndexVersion: 'gte-modernbert-v1',
    execution: 'cpu-worker',
  },
});

function configurationError(message) {
  return Object.assign(new Error(message), { code: 'EMBEDDING_CONFIGURATION_INVALID' });
}

function resolveEmbeddingProfile(value = 'qwen-tei') {
  const normalized = String(value || 'qwen-tei').trim().toLowerCase();
  const profile = EMBEDDING_PROFILES[normalized]
    || Object.values(EMBEDDING_PROFILES).find((candidate) => candidate.vectorIndexVersion === normalized);
  if (!profile) throw configurationError(`Unsupported embedding provider or index version '${normalized}'.`);
  return profile;
}

function validateEmbeddingProfile(input) {
  if (!input || typeof input !== 'object') throw configurationError('An embedding profile is required.');
  const canonical = resolveEmbeddingProfile(input.provider || input.id || input.vectorIndexVersion);
  const checks = [
    ['modelId', String(input.modelId || '')],
    ['revision', String(input.revision || '')],
    ['dtype', String(input.dtype || '')],
    ['dimension', Number(input.dimension)],
    ['pooling', String(input.pooling || '')],
    ['normalize', input.normalize],
    ['vectorIndexVersion', String(input.vectorIndexVersion || '')],
  ];
  for (const [field, received] of checks) {
    if (received !== canonical[field]) {
      throw configurationError(`Embedding profile '${canonical.id}' has an invalid ${field}.`);
    }
  }
  return canonical;
}

function integerSetting(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function vectorNorm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
}

function validateEmbeddingVectors(vectors, {
  expectedCount,
  dimension = EMBEDDING_PROFILES['gte-node'].dimension,
  normalized = true,
  normTolerance = 0.02,
} = {}) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: 'INVALID_EMBEDDING_RESPONSE', retryable: false });
  };
  if (!Array.isArray(vectors)) fail('Embedding output must be an array of vectors.');
  if (expectedCount !== undefined && vectors.length !== expectedCount) {
    fail(`Embedding output contained ${vectors.length} vectors; expected ${expectedCount}.`);
  }
  for (let index = 0; index < vectors.length; index += 1) {
    const vector = vectors[index];
    if (!Array.isArray(vector) || vector.length !== dimension) {
      fail(`Embedding vector ${index} does not contain exactly ${dimension} values.`);
    }
    if (vector.some((value) => !Number.isFinite(value))) fail(`Embedding vector ${index} contains a non-finite value.`);
    if (normalized) {
      const norm = vectorNorm(vector);
      if (!Number.isFinite(norm) || Math.abs(norm - 1) > normTolerance) {
        fail(`Embedding vector ${index} is not normalized (L2 norm ${norm}).`);
      }
    }
  }
  return vectors;
}

function embeddingConfigurationFromEnv(environment = process.env) {
  const profile = resolveEmbeddingProfile(environment.EXPERIENCE_EMBEDDING_PROVIDER || 'qwen-tei');
  const configured = {
    ...profile,
    modelId: String(environment.EXPERIENCE_EMBEDDING_MODEL || profile.modelId).trim(),
    revision: String(environment.EXPERIENCE_EMBEDDING_MODEL_REVISION || profile.revision).trim(),
    dtype: String(environment.EXPERIENCE_EMBEDDING_DTYPE || profile.dtype).trim().toLowerCase(),
    dimension: integerSetting(environment.EXPERIENCE_EMBEDDING_DIMENSIONS, profile.dimension,
      'EXPERIENCE_EMBEDDING_DIMENSIONS', 128, 8192),
    vectorIndexVersion: String(environment.EXPERIENCE_VECTOR_INDEX_VERSION || profile.vectorIndexVersion).trim(),
  };
  validateEmbeddingProfile(configured);
  const dataRoot = path.resolve(environment.SEEMPLIFY_KNOWLEDGE_DATA_ROOT || 'D:\\SeemplifyKnowledge');
  return deepFreeze({
    profile,
    provider: profile.provider,
    cacheDir: path.resolve(environment.EXPERIENCE_EMBEDDING_CACHE_DIR || path.join(dataRoot, 'models', 'transformers')),
    concurrency: integerSetting(environment.EXPERIENCE_EMBEDDING_CONCURRENCY, 8,
      'EXPERIENCE_EMBEDDING_CONCURRENCY', 1, 8),
    queueDepth: integerSetting(environment.EXPERIENCE_EMBEDDING_QUEUE_DEPTH, 256,
      'EXPERIENCE_EMBEDDING_QUEUE_DEPTH', 1, 4096),
    maxBatchTexts: integerSetting(environment.EXPERIENCE_EMBEDDING_BATCH_TEXTS, 32,
      'EXPERIENCE_EMBEDDING_BATCH_TEXTS', 1, 128),
    requestTimeoutMs: integerSetting(environment.EXPERIENCE_EMBEDDING_TIMEOUT_MS, 120_000,
      'EXPERIENCE_EMBEDDING_TIMEOUT_MS', 1_000, 30 * 60_000),
  });
}

module.exports = {
  EMBEDDING_PROFILES,
  GTE_MODEL_REVISION,
  deepFreeze,
  embeddingConfigurationFromEnv,
  resolveEmbeddingProfile,
  validateEmbeddingVectors,
  validateEmbeddingProfile,
  vectorNorm,
};
