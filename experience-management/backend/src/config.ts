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
    if (!process.env.BREVO_FROM_EMAIL && (parsed.BREVO_FROM_EMAIL || parsed.BREVO_SENDER_EMAIL)) process.env.BREVO_FROM_EMAIL = parsed.BREVO_FROM_EMAIL || parsed.BREVO_SENDER_EMAIL;
    if (!process.env.BREVO_FROM_NAME && (parsed.BREVO_FROM_NAME || parsed.BREVO_SENDER_NAME)) process.env.BREVO_FROM_NAME = parsed.BREVO_FROM_NAME || parsed.BREVO_SENDER_NAME;
    if (!process.env.BREVO_API_URL && parsed.BREVO_API_URL) process.env.BREVO_API_URL = parsed.BREVO_API_URL;
  }
  return source;
}

export const brevoEnvironmentSource = loadSharedBrevoEnvironment();

function resolveFromBackend(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(backendDir, value);
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
  frontendDist: path.join(projectDir, 'frontend', 'dist'),
  localLlmBaseUrl: String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, ''),
  localLlmSecretFile: resolveFromBackend(
    process.env.LOCAL_LLM_SHARED_SECRET_FILE || '../../.local-runtime/llm/service-secret'
  ),
  aiWorkerConcurrency: Math.max(1, Math.min(16, Number(process.env.AI_WORKER_CONCURRENCY || 4))),
  brevoApiKey: process.env.BREVO_API_KEY || '',
  brevoApiUrl: process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email',
  brevoFromEmail: process.env.BREVO_FROM_EMAIL || 'no-reply@seemplifyai.com',
  brevoFromName: process.env.BREVO_FROM_NAME || 'Seemplify Experience',
  emailMode: String(process.env.EMAIL_MODE || 'send').toLowerCase(),
  adminEmail: String(process.env.ADMIN_EMAIL || 'admin@seemplify.local').trim().toLowerCase(),
  adminPasswordFile: resolveFromBackend(process.env.ADMIN_PASSWORD_FILE || '../../.local-runtime/experience-management/admin-password'),
  sessionSecretFile: resolveFromBackend(process.env.SESSION_SECRET_FILE || '../../.local-runtime/experience-management/session-secret'),
  sessionHours: Math.max(1, Math.min(168, Number(process.env.SESSION_HOURS || 24)))
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
