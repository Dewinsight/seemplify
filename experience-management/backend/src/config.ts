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

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Math.max(1, Number(process.env.PORT || 5410)),
  publicUrl: String(process.env.PUBLIC_URL || 'http://127.0.0.1:5410').replace(/\/+$/, ''),
  databasePath: resolveFromBackend(
    process.env.DATABASE_PATH || '../../.local-runtime/experience-management/experience.sqlite'
  ),
  uploadDir: resolveFromBackend(
    process.env.UPLOAD_DIR || '../../.local-runtime/experience-management/uploads'
  ),
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

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.esignStorageDir, { recursive: true });
