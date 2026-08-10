import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendDir = path.resolve(sourceDir, '..');
export const projectDir = path.resolve(backendDir, '..');
export const repositoryDir = path.resolve(projectDir, '..');

dotenv.config({ path: path.join(backendDir, '.env') });

const sharedMailEnvironmentKeys = ['MAIL_API_TOKEN', 'MAIL_API_BASE_URL', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME'] as const;

/**
 * Optional compatibility loader for operator-managed shared environment files.
 * Production deployments should use this application's own MAIL_API_TOKEN or
 * MAIL_API_TOKEN_FILE so its credential can be rotated/revoked independently.
 */
function loadSharedMailEnvironment() {
  const configured = process.env.MAIL_ENV_FILE
    ? path.resolve(backendDir, process.env.MAIL_ENV_FILE)
    : null;
  const candidates = [
    configured,
    path.join(repositoryDir, 'Identityprovider', '.env'),
    path.join(repositoryDir, 'recruiter', 'backend', '.env'),
    path.join(repositoryDir, 'digilog-recruiter', 'backend', '.env'),
    path.join(path.dirname(repositoryDir), 'crm', 'Xplorer-Full-backend', '.env')
  ].filter((value): value is string => Boolean(value));
  let source: string | null = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = dotenv.parse(fs.readFileSync(candidate));
    for (const key of sharedMailEnvironmentKeys) {
      if (process.env[key] || !parsed[key]) continue;
      process.env[key] = parsed[key];
      if (key === 'MAIL_API_TOKEN') source = candidate;
    }
  }
  return source;
}

export const mailEnvironmentSource = loadSharedMailEnvironment();

const nylasEnvironmentKeys = [
  'NYLAS_CLIENT_ID',
  'NYLAS_API_KEY',
  'NYLAS_API_URI',
  'NYLAS_CONNECT_SCOPES',
  'NYLAS_REDIRECT_URI',
  'NYLAS_WEBHOOK_SECRET'
] as const;

function loadSharedNylasEnvironment() {
  const configured = process.env.NYLAS_ENV_FILE
    ? path.resolve(backendDir, process.env.NYLAS_ENV_FILE)
    : null;
  // Nylas is an Experience Management integration. The only supported
  // shared hand-off is the explicitly approved Recruiter environment.
  const candidates = [
    configured,
    path.join(repositoryDir, 'recruiter', 'backend', '.env')
  ].filter((value): value is string => Boolean(value));
  let source: string | null = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = dotenv.parse(fs.readFileSync(candidate));
    let used = false;
    for (const key of nylasEnvironmentKeys) {
      if (!process.env[key] && parsed[key]) {
        process.env[key] = parsed[key];
        used = true;
      }
    }
    if (used && !source) source = candidate;
  }
  return source;
}

export const nylasEnvironmentSource = loadSharedNylasEnvironment();

function resolveFromBackend(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(backendDir, value);
}

function readOptionalSecretFile(value: string) {
  try {
    return fs.readFileSync(resolveFromBackend(value), 'utf8').trim();
  } catch {
    return '';
  }
}

const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}

export type KnowledgeEmbeddingProvider = 'qwen-tei' | 'gte-node';

export interface KnowledgeEmbeddingProfile {
  provider: KnowledgeEmbeddingProvider;
  model: string;
  revision: string;
  dtype: string;
  dimensions: number;
  vectorIndexVersion: string;
}

export const qwenKnowledgeEmbeddingProfile: Readonly<KnowledgeEmbeddingProfile> = Object.freeze({
  provider: 'qwen-tei',
  model: 'Qwen/Qwen3-Embedding-4B',
  revision: '5cf2132abc99cad020ac570b19d031efec650f2b',
  dtype: 'float16',
  dimensions: 2560,
  vectorIndexVersion: 'qwen-v1'
});

export const gteKnowledgeEmbeddingProfile: Readonly<KnowledgeEmbeddingProfile> = Object.freeze({
  provider: 'gte-node',
  model: 'Alibaba-NLP/gte-modernbert-base',
  revision: 'e7f32e3c00f91d699e8c43b53106206bcc72bb22',
  dtype: 'q8',
  dimensions: 768,
  vectorIndexVersion: 'gte-modernbert-v1'
});

export const bgeKnowledgeRerankerProfile = Object.freeze({
  model: 'BAAI/bge-reranker-v2-m3',
  revision: '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'
});

function configuredInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function configuredToken(value: unknown, fallback: string, name: string, maximum = 300) {
  const normalized = String(value ?? fallback).trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function configuredBoolean(value: unknown, fallback: boolean, name: string) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value.`);
}

function configuredCsvTokens(value: unknown, name: string, maximum: number) {
  if (value === undefined || value === null || String(value).trim() === '') return [] as string[];
  const tokens = String(value).split(',').map((entry) => entry.trim());
  if (!tokens.length || tokens.length > maximum || new Set(tokens).size !== tokens.length
    || tokens.some((entry) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(entry))) {
    throw new Error(`${name} must contain 1 to ${maximum} unique comma-separated tokens.`);
  }
  return tokens;
}

/**
 * Resolve one immutable embedding-space identity. Keeping this pure makes
 * deployment configuration testable without importing the database runtime.
 */
export function resolveKnowledgeEmbeddingConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const forceQwen = configuredBoolean(environment.EXPERIENCE_EMBEDDING_FORCE_QWEN, false,
    'EXPERIENCE_EMBEDDING_FORCE_QWEN');
  const providerValue = forceQwen
    ? 'qwen-tei'
    : String(environment.EXPERIENCE_EMBEDDING_PROVIDER || 'gte-node').trim().toLowerCase();
  if (providerValue !== 'qwen-tei' && providerValue !== 'gte-node') {
    throw new Error('EXPERIENCE_EMBEDDING_PROVIDER must be either qwen-tei or gte-node.');
  }
  const provider = providerValue as KnowledgeEmbeddingProvider;
  const defaults = provider === 'gte-node' ? gteKnowledgeEmbeddingProfile : qwenKnowledgeEmbeddingProfile;
  const model = forceQwen ? qwenKnowledgeEmbeddingProfile.model : configuredToken(
    environment.EXPERIENCE_EMBEDDING_MODEL
      || (provider === 'qwen-tei' ? environment.KNOWLEDGE_EMBEDDING_MODEL : undefined),
    defaults.model,
    'EXPERIENCE_EMBEDDING_MODEL'
  );
  const revision = forceQwen ? qwenKnowledgeEmbeddingProfile.revision : configuredToken(
    environment.EXPERIENCE_EMBEDDING_MODEL_REVISION || environment.EXPERIENCE_EMBEDDING_REVISION,
    defaults.revision,
    'EXPERIENCE_EMBEDDING_MODEL_REVISION',
    80
  ).toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error('EXPERIENCE_EMBEDDING_MODEL_REVISION must be a pinned 40-character hexadecimal revision.');
  }
  const dtype = forceQwen ? qwenKnowledgeEmbeddingProfile.dtype
    : configuredToken(environment.EXPERIENCE_EMBEDDING_DTYPE, defaults.dtype,
      'EXPERIENCE_EMBEDDING_DTYPE', 40).toLowerCase();
  const dimensions = forceQwen ? qwenKnowledgeEmbeddingProfile.dimensions : configuredInteger(
    environment.EXPERIENCE_EMBEDDING_DIMENSIONS
      || (provider === 'qwen-tei' ? environment.KNOWLEDGE_EMBEDDING_DIMENSION : undefined),
    defaults.dimensions,
    128,
    8192,
    'EXPERIENCE_EMBEDDING_DIMENSIONS'
  );
  const vectorIndexVersion = forceQwen ? qwenKnowledgeEmbeddingProfile.vectorIndexVersion
    : configuredToken(environment.EXPERIENCE_VECTOR_INDEX_VERSION,
      defaults.vectorIndexVersion, 'EXPERIENCE_VECTOR_INDEX_VERSION', 100).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(vectorIndexVersion)) {
    throw new Error('EXPERIENCE_VECTOR_INDEX_VERSION must be a stable lowercase identifier.');
  }
  const concurrency = configuredInteger(environment.EXPERIENCE_EMBEDDING_CONCURRENCY, 8, 1, 8,
    'EXPERIENCE_EMBEDDING_CONCURRENCY');
  const dualWrite = forceQwen ? false : configuredBoolean(environment.EXPERIENCE_EMBEDDING_DUAL_WRITE, false,
    'EXPERIENCE_EMBEDDING_DUAL_WRITE');
  const qwenRollbackRetained = configuredBoolean(environment.EXPERIENCE_QWEN_ROLLBACK_RETAINED, provider === 'qwen-tei',
    'EXPERIENCE_QWEN_ROLLBACK_RETAINED');

  if (provider === 'gte-node'
      && (model !== gteKnowledgeEmbeddingProfile.model || revision !== gteKnowledgeEmbeddingProfile.revision
        || dtype !== 'q8' || dimensions !== 768
        || vectorIndexVersion !== gteKnowledgeEmbeddingProfile.vectorIndexVersion)) {
    throw new Error('gte-node requires the pinned Alibaba-NLP/gte-modernbert-base q8 profile and index version.');
  }
  if (provider === 'qwen-tei'
      && (model !== qwenKnowledgeEmbeddingProfile.model || revision !== qwenKnowledgeEmbeddingProfile.revision
        || dtype !== 'float16' || dimensions !== 2560
        || vectorIndexVersion !== qwenKnowledgeEmbeddingProfile.vectorIndexVersion)) {
    throw new Error('qwen-tei requires the pinned Qwen/Qwen3-Embedding-4B float16 profile and index version.');
  }
  if (provider === 'gte-node' && qwenRollbackRetained && !dualWrite) {
    throw new Error('gte-node requires dual-write while the Qwen rollback index is retained.');
  }
  if (provider === 'gte-node' && !qwenRollbackRetained && dualWrite) {
    throw new Error('gte-node cannot dual-write to Qwen after the Qwen rollback profile has been retired.');
  }

  return {
    profile: Object.freeze({ provider, model, revision, dtype, dimensions, vectorIndexVersion }) as Readonly<KnowledgeEmbeddingProfile>,
    concurrency,
    dualWrite,
    qwenRollbackRetained,
    forceQwen
  };
}

const knowledgeEmbedding = resolveKnowledgeEmbeddingConfiguration();

function enabled(value: unknown, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function databaseProvider(value: unknown): 'sqlite' | 'postgres' {
  const normalized = String(value || 'sqlite').trim().toLowerCase();
  if (normalized !== 'sqlite' && normalized !== 'postgres') {
    throw new Error(`DATABASE_PROVIDER must be either sqlite or postgres (received ${normalized || 'empty'}).`);
  }
  return normalized;
}

function postgresSsl(value: unknown): false | { rejectUnauthorized: boolean } {
  const normalized = String(value || 'false').trim().toLowerCase();
  if (['', '0', 'false', 'disable', 'disabled', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'require', 'required', 'on'].includes(normalized)) return { rejectUnauthorized: true };
  if (['no-verify', 'allow-self-signed'].includes(normalized)) return { rejectUnauthorized: false };
  throw new Error('POSTGRES_SSL must be false, true, require, or no-verify.');
}

function postgresSourceSha256(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error('POSTGRES_SOURCE_SHA256 must be a 64-character hexadecimal digest.');
  return normalized;
}

const resolvedDatabasePath = resolveFromBackend(
  process.env.DATABASE_PATH || '../../.local-runtime/experience-management/experience.sqlite'
);
const resolvedCodexRuntimeDir = process.env.CODEX_RUNTIME_DIR
  ? resolveFromBackend(process.env.CODEX_RUNTIME_DIR)
  : process.env.DATABASE_PATH
    ? path.join(path.dirname(resolvedDatabasePath), 'codex')
    : resolveFromBackend('../../.local-runtime/experience-management/codex');

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Math.max(1, Number(process.env.PORT || 5410)),
  publicUrl: String(process.env.PUBLIC_URL || 'http://127.0.0.1:5410').replace(/\/+$/, ''),
  databasePath: resolvedDatabasePath,
  codexRuntimeDir: resolvedCodexRuntimeDir,
  databaseProvider: databaseProvider(process.env.DATABASE_PROVIDER),
  postgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),
    port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_USER || 'seemplify_experience_app').trim(),
    passwordFile: resolveFromBackend(
      process.env.POSTGRES_PASSWORD_FILE || '../../.local-runtime/experience-management/postgres-password'
    ),
    ssl: postgresSsl(process.env.POSTGRES_SSL),
    schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION, 1, 1, 1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION, 55, 1, 1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  journeyActionWorkerEnabled: configuredBoolean(process.env.JOURNEY_ACTION_WORKER_ENABLED, false,
    'JOURNEY_ACTION_WORKER_ENABLED'),
  journeyActionWorkerPollMs: boundedNumber(process.env.JOURNEY_ACTION_WORKER_POLL_MS, 1_000, 100, 300_000),
  journeyActionWorkerKeyId: String(process.env.JOURNEY_ACTION_WORKER_KEY_ID || 'journey-worker-primary').trim(),
  journeyActionWorkerKeyRef: String(process.env.JOURNEY_ACTION_WORKER_KEY_REF || 'file://journey-worker-primary').trim(),
  journeyActionWorkerSpaceIds: configuredCsvTokens(process.env.JOURNEY_ACTION_WORKER_SPACE_IDS,
    'JOURNEY_ACTION_WORKER_SPACE_IDS', 100),
  journeyActionWorkerAdapters: configuredCsvTokens(process.env.JOURNEY_ACTION_WORKER_ADAPTERS,
    'JOURNEY_ACTION_WORKER_ADAPTERS', 5),
  journeyActionWorkerSecretFile: resolveFromBackend(process.env.JOURNEY_ACTION_WORKER_SECRET_FILE
    || '../../.local-runtime/experience-management/journey-worker-secret'),
  journeyActionWorkerPostgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),
    port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_WORKER_USER || 'seemplify_experience_worker').trim(),
    passwordFile: resolveFromBackend(process.env.POSTGRES_WORKER_PASSWORD_FILE
      || '../../.local-runtime/experience-management/postgres-worker-password'),
    ssl: postgresSsl(process.env.POSTGRES_SSL),
    schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION, 1, 1, 1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION, 55, 1, 1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  journeyConnectorWorkerEnabled: configuredBoolean(process.env.JOURNEY_CONNECTOR_WORKER_ENABLED, false,
    'JOURNEY_CONNECTOR_WORKER_ENABLED'),
  journeyConnectorWorkerPollMs: configuredInteger(process.env.JOURNEY_CONNECTOR_WORKER_POLL_MS, 5_000, 250, 60_000,
    'JOURNEY_CONNECTOR_WORKER_POLL_MS'),
  journeyConnectorWorkerPrincipalId: String(process.env.JOURNEY_CONNECTOR_WORKER_PRINCIPAL_ID || '').trim(),
  journeyConnectorWorkerKeyId: String(process.env.JOURNEY_CONNECTOR_WORKER_KEY_ID || '').trim(),
  journeyConnectorWorkerKeyRef: String(process.env.JOURNEY_CONNECTOR_WORKER_KEY_REF || '').trim(),
  journeyConnectorWorkerSecretFile: resolveFromBackend(process.env.JOURNEY_CONNECTOR_WORKER_SECRET_FILE
    || '../../.local-runtime/experience-management/journey-connector-worker-secret'),
  journeyConnectorWorkerSpaceIds: configuredCsvTokens(process.env.JOURNEY_CONNECTOR_WORKER_SPACE_IDS,
    'JOURNEY_CONNECTOR_WORKER_SPACE_IDS', 100),
  journeyConnectorWorkerConnectorIds: configuredCsvTokens(process.env.JOURNEY_CONNECTOR_WORKER_CONNECTOR_IDS,
    'JOURNEY_CONNECTOR_WORKER_CONNECTOR_IDS', 200),
  journeyConnectorWorkerPostgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),
    port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_CONNECTOR_WORKER_USER || 'seemplify_experience_connector_worker').trim(),
    passwordFile: resolveFromBackend(process.env.POSTGRES_CONNECTOR_WORKER_PASSWORD_FILE
      || '../../.local-runtime/experience-management/postgres-connector-worker-password'),
    ssl: postgresSsl(process.env.POSTGRES_SSL), schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION, 1, 1, 1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION, 55, 1, 1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  journeyPrivacyWorkerEnabled: configuredBoolean(process.env.JOURNEY_PRIVACY_WORKER_ENABLED, false,
    'JOURNEY_PRIVACY_WORKER_ENABLED'),
  journeyPrivacyWorkerPollMs: boundedNumber(process.env.JOURNEY_PRIVACY_WORKER_POLL_MS, 1_000, 100, 300_000),
  journeyPrivacyWorkerBatchSize: boundedNumber(process.env.JOURNEY_PRIVACY_WORKER_BATCH_SIZE, 10, 1, 50),
  journeyPrivacyWorkerLeaseSeconds: boundedNumber(process.env.JOURNEY_PRIVACY_WORKER_LEASE_SECONDS, 60, 5, 300),
  journeyPrivacyWorkerPrincipalId: String(process.env.JOURNEY_PRIVACY_WORKER_PRINCIPAL_ID || '').trim(),
  journeyPrivacyWorkerKeyId: String(process.env.JOURNEY_PRIVACY_WORKER_KEY_ID || '').trim(),
  journeyPrivacyWorkerKeyRef: String(process.env.JOURNEY_PRIVACY_WORKER_KEY_REF || '').trim(),
  journeyPrivacyWorkerSecretFile: resolveFromBackend(process.env.JOURNEY_PRIVACY_WORKER_SECRET_FILE
    || '../../.local-runtime/experience-management/journey-privacy-worker-secret'),
  journeyPrivacyWorkerPostgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),
    port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_PRIVACY_WORKER_USER || 'seemplify_experience_privacy_worker').trim(),
    passwordFile: resolveFromBackend(process.env.POSTGRES_PRIVACY_WORKER_PASSWORD_FILE
      || '../../.local-runtime/experience-management/postgres-privacy-worker-password'),
    ssl: postgresSsl(process.env.POSTGRES_SSL),schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION,1,1,1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION,55,1,1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  uploadDir: resolveFromBackend(
    process.env.UPLOAD_DIR || '../../.local-runtime/experience-management/uploads'
  ),
  knowledgeStorageDir: resolveFromBackend(
    process.env.KNOWLEDGE_STORAGE_DIR || '../../.local-runtime/experience-management/knowledge'
  ),
  knowledgeRuntimeBaseUrl: String(
    process.env.KNOWLEDGE_RUNTIME_BASE_URL || 'http://127.0.0.1:11540'
  ).replace(/\/+$/, ''),
  knowledgeRuntimeSecretFile: resolveFromBackend(
    process.env.KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE || '../../.local-runtime/knowledge/service-secret'
  ),
  knowledgeEmbeddingProfile: knowledgeEmbedding.profile,
  knowledgeEmbeddingProvider: knowledgeEmbedding.profile.provider,
  knowledgeEmbeddingModel: knowledgeEmbedding.profile.model,
  knowledgeEmbeddingRevision: knowledgeEmbedding.profile.revision,
  knowledgeEmbeddingDtype: knowledgeEmbedding.profile.dtype,
  knowledgeEmbeddingDimension: knowledgeEmbedding.profile.dimensions,
  knowledgeEmbeddingConcurrency: knowledgeEmbedding.concurrency,
  knowledgeEmbeddingDualWrite: knowledgeEmbedding.dualWrite,
  knowledgeQwenRollbackRetained: knowledgeEmbedding.qwenRollbackRetained,
  knowledgeEmbeddingForceQwen: knowledgeEmbedding.forceQwen,
  knowledgeVectorIndexVersion: knowledgeEmbedding.profile.vectorIndexVersion,
  knowledgeChunkerVersion: String(process.env.KNOWLEDGE_CHUNKER_VERSION || 'docling-hybrid-v1').trim(),
  knowledgeMaxDocumentBytes: boundedNumber(process.env.KNOWLEDGE_MAX_DOCUMENT_BYTES, 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  knowledgeMaxSpaceBytes: boundedNumber(process.env.KNOWLEDGE_MAX_SPACE_BYTES, 20 * 1024 * 1024 * 1024, 100 * 1024 * 1024, 500 * 1024 * 1024 * 1024),
  knowledgeWorkerConcurrency: boundedNumber(process.env.KNOWLEDGE_WORKER_CONCURRENCY, 1, 1, 4),
  knowledgeWorkerPollMs: boundedNumber(process.env.KNOWLEDGE_WORKER_POLL_MS, 750, 250, 60_000),
  knowledgeWorkerLeaseMs: boundedNumber(process.env.KNOWLEDGE_WORKER_LEASE_MS, 300_000, 30_000, 30 * 60_000),
  knowledgeWorkerHeartbeatMs: boundedNumber(process.env.KNOWLEDGE_WORKER_HEARTBEAT_MS, 30_000, 5_000, 5 * 60_000),
  knowledgeBackfillPollMs: boundedNumber(process.env.KNOWLEDGE_BACKFILL_POLL_MS, 2_000, 250, 60_000),
  knowledgeBackfillLeaseMs: boundedNumber(process.env.KNOWLEDGE_BACKFILL_LEASE_MS, 120_000, 30_000, 30 * 60_000),
  knowledgeBackfillHeartbeatMs: boundedNumber(process.env.KNOWLEDGE_BACKFILL_HEARTBEAT_MS, 30_000, 5_000, 5 * 60_000),
  knowledgeRetrieveTopK: boundedNumber(process.env.KNOWLEDGE_RETRIEVE_TOP_K, 10, 2, 20),
  knowledgeContextMaxBytes: boundedNumber(process.env.KNOWLEDGE_CONTEXT_MAX_BYTES, 64 * 1024, 8 * 1024, 256 * 1024),
  journeyIdentityHashKeyFile: resolveFromBackend(
    process.env.JOURNEY_IDENTITY_HASH_KEY_FILE || '../../.local-runtime/experience-management/journey-identity-hash-key'
  ),
  journeyStageWorkerPollMs: boundedNumber(process.env.JOURNEY_STAGE_WORKER_POLL_MS, 750, 100, 60_000),
  journeyStageWorkerLeaseMs: boundedNumber(process.env.JOURNEY_STAGE_WORKER_LEASE_MS, 60_000, 5_000, 10 * 60_000),
  journeyStageWorkerBatchSize: boundedNumber(process.env.JOURNEY_STAGE_WORKER_BATCH_SIZE, 25, 1, 100),
  journeyStageSurveyFeedWorkerEnabled: configuredBoolean(process.env.JOURNEY_STAGE_SURVEY_FEED_WORKER_ENABLED, false,
    'JOURNEY_STAGE_SURVEY_FEED_WORKER_ENABLED'),
  journeyOperationalStageFeedWorkerEnabled: configuredBoolean(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_ENABLED, false,
    'JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_ENABLED'),
  journeyOperationalStageFeedWorkerPollMs: boundedNumber(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_POLL_MS, 1_000, 100, 60_000),
  journeyOperationalStageFeedWorkerBatchSize: boundedNumber(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_BATCH_SIZE, 25, 1, 100),
  journeyOperationalStageFeedWorkerLeaseMs: boundedNumber(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_LEASE_MS, 30_000, 5_000, 300_000),
  journeyOperationalStageFeedRetentionPollMs: boundedNumber(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_RETENTION_POLL_MS,
    60_000, 1_000, 86_400_000),
  journeyOperationalStageFeedWorkerSpaceIds: configuredCsvTokens(process.env.JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_SPACE_IDS,
    'JOURNEY_OPERATIONAL_STAGE_FEED_WORKER_SPACE_IDS', 100),
  journeyOperationalStageFeedWorkerPostgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),
    port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_OPERATIONAL_FEED_WORKER_USER || 'seemplify_experience_operational_feed_worker').trim(),
    passwordFile: resolveFromBackend(process.env.POSTGRES_OPERATIONAL_FEED_WORKER_PASSWORD_FILE
      || '../../.local-runtime/experience-management/postgres-operational-feed-worker-password'),
    ssl: postgresSsl(process.env.POSTGRES_SSL), schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION, 1, 1, 1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION, 55, 1, 1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  journeyEventRetentionWorkerEnabled: configuredBoolean(process.env.JOURNEY_EVENT_RETENTION_WORKER_ENABLED, false,
    'JOURNEY_EVENT_RETENTION_WORKER_ENABLED'),
  journeyEventRetentionWorkerPollMs: boundedNumber(process.env.JOURNEY_EVENT_RETENTION_WORKER_POLL_MS, 60_000, 1_000, 86_400_000),
  journeyEventRetentionWorkerBatchSize: boundedNumber(process.env.JOURNEY_EVENT_RETENTION_WORKER_BATCH_SIZE, 100, 1, 500),
  journeyEventRetentionWorkerLeaseMs: boundedNumber(process.env.JOURNEY_EVENT_RETENTION_WORKER_LEASE_MS, 300_000, 30_000, 3_600_000),
  journeyEventRetentionPostgres: {
    host: String(process.env.POSTGRES_HOST || '127.0.0.1').trim(),port: boundedNumber(process.env.POSTGRES_PORT, 5432, 1, 65_535),
    database: String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim(),
    user: String(process.env.POSTGRES_EVENT_RETENTION_WORKER_USER || 'seemplify_experience_event_retention_worker').trim(),
    passwordFile: resolveFromBackend(process.env.POSTGRES_EVENT_RETENTION_WORKER_PASSWORD_FILE
      || '../../.local-runtime/experience-management/postgres-event-retention-worker-password'),
    ssl: postgresSsl(process.env.POSTGRES_SSL),schemaVersion: boundedNumber(process.env.POSTGRES_SCHEMA_VERSION,1,1,1_000_000),
    runtimeSchemaVersion: boundedNumber(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION,55,1,1_000_000),
    sourceSha256: postgresSourceSha256(process.env.POSTGRES_SOURCE_SHA256)
  },
  journeyEvidenceMonitorEnabled: configuredBoolean(process.env.JOURNEY_EVIDENCE_MONITOR_ENABLED,false,
    'JOURNEY_EVIDENCE_MONITOR_ENABLED'),
  journeyEvidenceMonitorPollMs: boundedNumber(process.env.JOURNEY_EVIDENCE_MONITOR_POLL_MS,60_000,1_000,86_400_000),
  journeyEvidenceMonitorBatchSize: boundedNumber(process.env.JOURNEY_EVIDENCE_MONITOR_BATCH_SIZE,25,1,100),
  // Outbound collaboration mail is off until a deployment decides otherwise.
  // Recipients still have to opt in individually; this switch only decides
  // whether the delivery worker exists at all.
  journeyCollaborationEmailWorkerEnabled: configuredBoolean(
    process.env.JOURNEY_COLLABORATION_EMAIL_WORKER_ENABLED, false,
    'JOURNEY_COLLABORATION_EMAIL_WORKER_ENABLED'),
  journeyCollaborationEmailWorkerPollMs: boundedNumber(
    process.env.JOURNEY_COLLABORATION_EMAIL_WORKER_POLL_MS, 15_000, 1_000, 3_600_000),
  journeyCollaborationEmailWorkerBatchSize: boundedNumber(
    process.env.JOURNEY_COLLABORATION_EMAIL_WORKER_BATCH_SIZE, 25, 1, 100),
  journeyEventIntelligenceWorkerEnabled: configuredBoolean(process.env.JOURNEY_EVENT_INTELLIGENCE_WORKER_ENABLED, false,
    'JOURNEY_EVENT_INTELLIGENCE_WORKER_ENABLED'),
  journeyEventIntelligenceWorkerPollMs: boundedNumber(process.env.JOURNEY_EVENT_INTELLIGENCE_WORKER_POLL_MS, 1_000, 100, 60_000),
  journeyEventIntelligenceWorkerBatchSize: boundedNumber(process.env.JOURNEY_EVENT_INTELLIGENCE_WORKER_BATCH_SIZE, 25, 1, 100),
  journeyResearchRefreshPollMs: boundedNumber(process.env.JOURNEY_RESEARCH_REFRESH_POLL_MS, 2_000, 100, 60_000),
  journeyResearchRefreshLeaseMs: boundedNumber(process.env.JOURNEY_RESEARCH_REFRESH_LEASE_MS, 60_000, 5_000, 10 * 60_000),
  journeyResearchRefreshBatchSize: boundedNumber(process.env.JOURNEY_RESEARCH_REFRESH_BATCH_SIZE, 10, 1, 100),
  esignStorageDir: resolveFromBackend(
    process.env.ESIGN_STORAGE_DIR || '../../.local-runtime/experience-management/esign'
  ),
  esignEncryptionKeyFile: resolveFromBackend(
    process.env.ESIGN_ENCRYPTION_KEY_FILE || '../../.local-runtime/experience-management/esign-encryption-key'
  ),
  esignMaxDocumentBytes: boundedNumber(process.env.ESIGN_MAX_DOCUMENT_BYTES, 50 * 1024 * 1024, 1024, 100 * 1024 * 1024),
  esignMaxDocumentPages: boundedNumber(process.env.ESIGN_MAX_DOCUMENT_PAGES, 300, 1, 1000),
  esignMaxEnvelopeBytes: boundedNumber(process.env.ESIGN_MAX_ENVELOPE_BYTES, 200 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
  esignMaxEnvelopeDocuments: boundedNumber(process.env.ESIGN_MAX_ENVELOPE_DOCUMENTS, 20, 1, 100),
  esignMaxSpaceBytes: boundedNumber(process.env.ESIGN_MAX_SPACE_BYTES, 5 * 1024 * 1024 * 1024, 100 * 1024 * 1024, 100 * 1024 * 1024 * 1024),
  esignWorkerPollMs: boundedNumber(process.env.ESIGN_WORKER_POLL_MS, 1000, 250, 60_000),
  esignSigningSessionHours: boundedNumber(process.env.ESIGN_SIGNING_SESSION_HOURS, 12, 1, 72),
  frontendDist: resolveFromBackend(process.env.FRONTEND_DIST || '../frontend/dist'),
  aiWorkerConcurrency: Math.max(1, Math.min(16, Number(process.env.AI_WORKER_CONCURRENCY || 4))),
  nylasClientId: String(process.env.NYLAS_CLIENT_ID || '').trim(),
  nylasApiKey: String(process.env.NYLAS_API_KEY || '').trim(),
  nylasApiUri: String(process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/+$/, ''),
  nylasConnectScopes: String(process.env.NYLAS_CONNECT_SCOPES || '')
    .split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean),
  nylasRedirectUri: String(process.env.NYLAS_REDIRECT_URI || '').trim(),
  nylasCredentialEncryptionKeyFile: resolveFromBackend(
    process.env.NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE || '../../.local-runtime/experience-management/nylas-credential-encryption-key'
  ),
  nylasOAuthStateMinutes: boundedNumber(process.env.NYLAS_OAUTH_STATE_MINUTES, 10, 1, 30),
  nylasRequestTimeoutMs: boundedNumber(process.env.NYLAS_REQUEST_TIMEOUT_MS, 20_000, 2_000, 60_000),
  nylasMaxThreadMessages: boundedNumber(process.env.NYLAS_MAX_THREAD_MESSAGES, 100, 1, 250),
  nylasMessageDetailConcurrency: boundedNumber(process.env.NYLAS_MESSAGE_DETAIL_CONCURRENCY, 6, 1, 8),
  nylasMaxMessageBodyBytes: boundedNumber(process.env.NYLAS_MAX_MESSAGE_BODY_BYTES, 128 * 1024, 4 * 1024, 512 * 1024),
  nylasMaxThreadBytes: boundedNumber(process.env.NYLAS_MAX_THREAD_BYTES, 1024 * 1024, 128 * 1024, 4 * 1024 * 1024),
  subscriptionEnforcementEnabled: enabled(process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED),
  // The local default only exists so a developer can run the mail service on
  // this workstation. Production must supply the address explicitly; an empty
  // value fails closed in mailClient.ts rather than sending anywhere.
  mailApiBaseUrl: String(process.env.MAIL_API_BASE_URL || (isProduction ? '' : 'http://127.0.0.1:5020')).trim().replace(/\/+$/, ''),
  mailApiToken: process.env.MAIL_API_TOKEN
    || readOptionalSecretFile(process.env.MAIL_API_TOKEN_FILE || '../../.local-runtime/mail/experience-management.bearer'),
  mailFromEmail: process.env.MAIL_FROM_EMAIL || 'no-reply@seemplifyai.com',
  mailFromName: process.env.MAIL_FROM_NAME || 'Seemplify Experience',
  mailTimeoutMs: boundedNumber(process.env.MAIL_TIMEOUT_MS, 15_000, 2_000, 60_000),
  emailMode: String(process.env.EMAIL_MODE || 'send').toLowerCase(),
  // Bound on how long a stored idempotency key is assumed to still deduplicate
  // at the mail service. A delivery whose outcome is unknown past this window is
  // failed instead of retried, so an unknown state never becomes a double send.
  mailIdempotencyTtlMinutes: boundedNumber(process.env.MAIL_IDEMPOTENCY_TTL_MINUTES, 29, 5, 1440),
  brevoWebhookSecretFile: resolveFromBackend(
    process.env.BREVO_WEBHOOK_SECRET_FILE || '../../.local-runtime/experience-management/brevo-webhook-secret'
  ),
  journeyWebhookEncryptionKeyFile: resolveFromBackend(
    process.env.JOURNEY_WEBHOOK_ENCRYPTION_KEY_FILE || '../../.local-runtime/experience-management/journey-webhook-encryption-key'
  ),
  xApiBaseUrl: String(process.env.X_API_BASE_URL || 'https://api.x.com').replace(/\/+$/, ''),
  xOAuthBaseUrl: String(process.env.X_OAUTH_BASE_URL || 'https://api.x.com').replace(/\/+$/, ''),
  xOAuth2AuthorizeBaseUrl: String(process.env.X_OAUTH2_AUTHORIZE_BASE_URL || 'https://x.com').replace(/\/+$/, ''),
  xCredentialEncryptionKeyFile: resolveFromBackend(
    process.env.X_CREDENTIAL_ENCRYPTION_KEY_FILE || '../../.local-runtime/experience-management/x-credential-encryption-key'
  ),
  xSeedConsumerKeyFile: resolveFromBackend(
    process.env.X_SEED_CONSUMER_KEY_FILE || '../../.local-runtime/experience-management/x-consumer-key'
  ),
  xSeedConsumerSecretFile: resolveFromBackend(
    process.env.X_SEED_CONSUMER_SECRET_FILE || '../../.local-runtime/experience-management/x-consumer-secret'
  ),
  xSeedBearerTokenFile: resolveFromBackend(
    process.env.X_SEED_BEARER_TOKEN_FILE || '../../.local-runtime/experience-management/x-bearer-token'
  ),
  xSeedAccessTokenFile: resolveFromBackend(
    process.env.X_SEED_ACCESS_TOKEN_FILE || '../../.local-runtime/experience-management/x-access-token'
  ),
  xSeedAccessTokenSecretFile: resolveFromBackend(
    process.env.X_SEED_ACCESS_TOKEN_SECRET_FILE || '../../.local-runtime/experience-management/x-access-token-secret'
  ),
  xSeedClientIdFile: resolveFromBackend(
    process.env.X_SEED_CLIENT_ID_FILE || '../../.local-runtime/experience-management/x-client-id'
  ),
  xSeedClientSecretFile: resolveFromBackend(
    process.env.X_SEED_CLIENT_SECRET_FILE || '../../.local-runtime/experience-management/x-client-secret'
  ),
  xSyncPollSeconds: boundedNumber(process.env.X_SYNC_POLL_SECONDS, 60, 15, 300),
  adminEmail: String(process.env.ADMIN_EMAIL || 'admin@seemplify.local').trim().toLowerCase(),
  adminPasswordFile: resolveFromBackend(process.env.ADMIN_PASSWORD_FILE || '../../.local-runtime/experience-management/admin-password'),
  sessionSecretFile: resolveFromBackend(process.env.SESSION_SECRET_FILE || '../../.local-runtime/experience-management/session-secret'),
  sessionHours: Math.max(1, Math.min(168, Number(process.env.SESSION_HOURS || 24)))
};

if (config.knowledgeBackfillHeartbeatMs * 2 >= config.knowledgeBackfillLeaseMs) {
  throw new Error('KNOWLEDGE_BACKFILL_HEARTBEAT_MS must be less than half of KNOWLEDGE_BACKFILL_LEASE_MS.');
}
if (config.knowledgeWorkerHeartbeatMs * 2 >= config.knowledgeWorkerLeaseMs) {
  throw new Error('KNOWLEDGE_WORKER_HEARTBEAT_MS must be less than half of KNOWLEDGE_WORKER_LEASE_MS.');
}

if (config.databaseProvider === 'sqlite') fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.knowledgeStorageDir, { recursive: true });
fs.mkdirSync(config.esignStorageDir, { recursive: true });
