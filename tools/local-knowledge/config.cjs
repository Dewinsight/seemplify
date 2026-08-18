const path = require('node:path');
const { embeddingConfigurationFromEnv } = require('./embedding-profiles.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR
  || path.join(REPOSITORY_ROOT, '.local-runtime', 'knowledge'));
const DATA_ROOT = path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_DATA_ROOT || 'D:\\SeemplifyKnowledge');
const SERVICE_HOST = String(process.env.KNOWLEDGE_RUNTIME_HOST || '127.0.0.1').trim();

function integerEnvironment(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function booleanEnvironment(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be true or false.`);
}

const FORCE_QWEN_ROLLBACK = booleanEnvironment('EXPERIENCE_EMBEDDING_FORCE_QWEN', false);
const EMBEDDING_ENVIRONMENT = embeddingConfigurationFromEnv(FORCE_QWEN_ROLLBACK ? {
  ...process.env,
  EXPERIENCE_EMBEDDING_PROVIDER: 'qwen-tei',
  EXPERIENCE_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
  EXPERIENCE_EMBEDDING_MODEL_REVISION: '5cf2132abc99cad020ac570b19d031efec650f2b',
  EXPERIENCE_EMBEDDING_DTYPE: 'float16',
  EXPERIENCE_EMBEDDING_DIMENSIONS: '2560',
  EXPERIENCE_VECTOR_INDEX_VERSION: 'qwen-v1',
} : process.env);

const CONFIG = Object.freeze({
  host: SERVICE_HOST,
  ports: Object.freeze({ runtime: 11540, embedding: 11541, reranker: 11542, docling: 11543, arango: 8529 }),
  images: Object.freeze({
    arango: Object.freeze({ tag: 'arangodb:3.12.9.4', reference: 'arangodb@sha256:bf5eabc0fb3a16a13d0d4de00cddfbf2209e3d25630e5331832efb206519ff8f' }),
    tei: Object.freeze({ tag: 'ghcr.io/huggingface/text-embeddings-inference:1.8.0', reference: 'ghcr.io/huggingface/text-embeddings-inference@sha256:8aeb97215f29e0ed48647384af89661c36cee04120c2d4e86b5a3aead47611fa' }),
    docling: Object.freeze({ tag: 'quay.io/docling-project/docling-serve-cpu:v1.28.0', reference: 'quay.io/docling-project/docling-serve-cpu@sha256:cc207e1eb768878456ed98042c5d84fae56af3729a9c03d3e5c8fef393902956' }),
  }),
  models: Object.freeze({
    embedding: Object.freeze({
      id: 'Qwen/Qwen3-Embedding-4B',
      revision: '5cf2132abc99cad020ac570b19d031efec650f2b',
      dimension: 2560,
    }),
    gteEmbedding: Object.freeze({
      id: 'Alibaba-NLP/gte-modernbert-base',
      revision: 'e7f32e3c00f91d699e8c43b53106206bcc72bb22',
      dtype: 'q8',
      dimension: 768,
      pooling: 'cls',
      normalize: true,
      vectorIndexVersion: 'gte-modernbert-v1',
    }),
    azureEmbedding: Object.freeze({
      id: 'text-embedding-3-large',
      revision: 'f0706db2d8dd64a5f9385fd9ab1713b9083eb881',
      dimension: 3072,
      dtype: 'float32',
      vectorIndexVersion: 'azure-text-embedding-3-large-v1',
    }),
    reranker: Object.freeze({
      id: 'text-embedding-3-large-cosine-reranker',
      revision: 'f0706db2d8dd64a5f9385fd9ab1713b9083eb881',
    }),
  }),
  supportedMimeTypes: Object.freeze([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/markdown', 'text/html', 'text/csv',
    'image/png', 'image/jpeg', 'image/tiff',
  ]),
  database: Object.freeze({
    appUser: 'seemplify_knowledge_app',
    provisionerUser: 'seemplify_knowledge_provisioner',
    prefix: 'exp_',
  }),
  paths: Object.freeze({
    repository: REPOSITORY_ROOT,
    runtime: RUNTIME_ROOT,
    secrets: path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_SECRETS_DIR || path.join(RUNTIME_ROOT, 'secrets')),
    state: path.join(RUNTIME_ROOT, 'state.json'),
    migrationState: path.join(RUNTIME_ROOT, 'embedding-migration-state.json'),
    pid: path.join(RUNTIME_ROOT, 'runtime.pid'),
    stdout: path.join(RUNTIME_ROOT, 'runtime.stdout.log'),
    stderr: path.join(RUNTIME_ROOT, 'runtime.stderr.log'),
    data: DATA_ROOT,
    staging: path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_STAGING_DIR || path.join(DATA_ROOT, 'staging')),
    storage: path.join(DATA_ROOT, 'storage'),
    models: path.join(DATA_ROOT, 'models'),
    backups: path.join(DATA_ROOT, 'backups'),
    logs: path.join(DATA_ROOT, 'logs'),
  }),
  embeddingMigration: Object.freeze({
    provider: EMBEDDING_ENVIRONMENT.provider,
    dualWrite: FORCE_QWEN_ROLLBACK ? false : booleanEnvironment('EXPERIENCE_EMBEDDING_DUAL_WRITE', false),
    qwenRollbackRetained: FORCE_QWEN_ROLLBACK ? true : booleanEnvironment(
      'EXPERIENCE_QWEN_ROLLBACK_RETAINED', EMBEDDING_ENVIRONMENT.provider === 'qwen-tei'
    ),
    concurrency: EMBEDDING_ENVIRONMENT.concurrency,
    queueDepth: EMBEDDING_ENVIRONMENT.queueDepth,
    timeoutMs: EMBEDDING_ENVIRONMENT.requestTimeoutMs,
    rolloutPercent: FORCE_QWEN_ROLLBACK ? 0 : integerEnvironment('EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT', EMBEDDING_ENVIRONMENT.provider === 'gte-node' ? 100 : 0, { min: 0, max: 100 }),
    shadowPercent: FORCE_QWEN_ROLLBACK ? 0 : integerEnvironment('EXPERIENCE_EMBEDDING_SHADOW_PERCENT', 0, { min: 0, max: 100 }),
    vectorIndexVersion: EMBEDDING_ENVIRONMENT.profile.vectorIndexVersion,
    cacheDir: EMBEDDING_ENVIRONMENT.cacheDir,
    forceQwenRollback: FORCE_QWEN_ROLLBACK,
  }),
  services: Object.freeze({
    arango: String(process.env.ARANGO_URL || `http://${SERVICE_HOST}:8529`).replace(/\/$/u, ''),
    azureEmbedding: String(process.env.AZURE_OPENAI_EMBEDDING_URL || '').trim(),
    docling: String(process.env.DOCLING_URL || `http://${SERVICE_HOST}:11543`).replace(/\/$/u, ''),
    chatgpt: String(process.env.CHATGPT_GATEWAY_URL || `http://${SERVICE_HOST}:11435`).replace(/\/$/u, ''),
    sharedAi: String(process.env.SHARED_AI_GATEWAY_URL || 'http://recruiter-backend:5001/api/internal/ai/v1').replace(/\/$/u, ''),
  }),
  limits: Object.freeze({
    requestBytes: 1024 * 1024,
    sourceBytes: 50 * 1024 * 1024,
    extractedCharacters: 600_000,
    graphWindowCharacters: 18_000,
    chunksPerDocument: 2_000,
    chunkCharacters: 3_200,
    chunkTargetTokens: 750,
    chunkMaxTokens: 900,
    chunkOverlapTokens: 100,
    candidateChunks: 180,
    citations: 24,
    excerptCharacters: 900,
    queueDepth: 256,
    requestsPerMinute: 180,
    clockSkewMs: 5 * 60_000,
    nonceTtlMs: 10 * 60_000,
  }),
});

module.exports = { CONFIG, booleanEnvironment, integerEnvironment };
