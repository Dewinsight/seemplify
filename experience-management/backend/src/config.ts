import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendDir = path.resolve(sourceDir, '..');
export const projectDir = path.resolve(backendDir, '..');
export const repositoryDir = path.resolve(projectDir, '..');

dotenv.config({ path: path.join(backendDir, '.env') });

function loadSharedBrevoEnvironment() {
  const configured = process.env.BREVO_ENV_FILE
    ? path.resolve(backendDir, process.env.BREVO_ENV_FILE)
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
    if (!process.env.BREVO_API_KEY && parsed.BREVO_API_KEY) { process.env.BREVO_API_KEY = parsed.BREVO_API_KEY; source = candidate; }
    if (!process.env.BREVO_API_URL && parsed.BREVO_API_URL) process.env.BREVO_API_URL = parsed.BREVO_API_URL;
  }
  return source;
}

export const brevoEnvironmentSource = loadSharedBrevoEnvironment();

function resolveFromBackend(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(backendDir, value);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
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

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Math.max(1, Number(process.env.PORT || 5410)),
  publicUrl: String(process.env.PUBLIC_URL || 'http://127.0.0.1:5410').replace(/\/+$/, ''),
  databasePath: resolveFromBackend(
    process.env.DATABASE_PATH || '../../.local-runtime/experience-management/experience.sqlite'
  ),
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
  knowledgeEmbeddingModel: String(process.env.KNOWLEDGE_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-4B').trim(),
  knowledgeEmbeddingDimension: boundedNumber(process.env.KNOWLEDGE_EMBEDDING_DIMENSION, 2560, 128, 8192),
  knowledgeChunkerVersion: String(process.env.KNOWLEDGE_CHUNKER_VERSION || 'docling-hybrid-v1').trim(),
  knowledgeMaxDocumentBytes: boundedNumber(process.env.KNOWLEDGE_MAX_DOCUMENT_BYTES, 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  knowledgeMaxSpaceBytes: boundedNumber(process.env.KNOWLEDGE_MAX_SPACE_BYTES, 20 * 1024 * 1024 * 1024, 100 * 1024 * 1024, 500 * 1024 * 1024 * 1024),
  knowledgeWorkerConcurrency: boundedNumber(process.env.KNOWLEDGE_WORKER_CONCURRENCY, 1, 1, 4),
  knowledgeWorkerPollMs: boundedNumber(process.env.KNOWLEDGE_WORKER_POLL_MS, 750, 250, 60_000),
  knowledgeRetrieveTopK: boundedNumber(process.env.KNOWLEDGE_RETRIEVE_TOP_K, 10, 2, 20),
  knowledgeContextMaxBytes: boundedNumber(process.env.KNOWLEDGE_CONTEXT_MAX_BYTES, 64 * 1024, 8 * 1024, 256 * 1024),
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
  terraGatewayBaseUrl: String(
    process.env.TERRA_GATEWAY_BASE_URL || process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435'
  ).replace(/\/+$/, ''),
  terraGatewaySecretFile: resolveFromBackend(
    process.env.TERRA_GATEWAY_SHARED_SECRET_FILE
      || process.env.LOCAL_LLM_SHARED_SECRET_FILE
      || '../../.local-runtime/llm/service-secret'
  ),
  aiWorkerConcurrency: Math.max(1, Math.min(16, Number(process.env.AI_WORKER_CONCURRENCY || 4))),
  brevoApiKey: process.env.BREVO_API_KEY || '',
  brevoApiUrl: process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email',
  brevoFromEmail: process.env.BREVO_FROM_EMAIL || 'no-reply@seemplifyai.com',
  brevoFromName: process.env.BREVO_FROM_NAME || 'Seemplify Experience',
  emailMode: String(process.env.EMAIL_MODE || 'send').toLowerCase(),
  // Brevo currently retains an idempotency key for 30 minutes. Keep one minute
  // of safety margin so no retry is dispatched at the documented boundary.
  brevoIdempotencyTtlMinutes: boundedNumber(process.env.BREVO_IDEMPOTENCY_TTL_MINUTES, 29, 5, 29),
  brevoWebhookSecretFile: resolveFromBackend(
    process.env.BREVO_WEBHOOK_SECRET_FILE || '../../.local-runtime/experience-management/brevo-webhook-secret'
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

if (config.databaseProvider === 'sqlite') fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.knowledgeStorageDir, { recursive: true });
fs.mkdirSync(config.esignStorageDir, { recursive: true });
