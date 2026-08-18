import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

export type NylasPlatformConfiguration = {
  clientId: string;
  apiKey: string;
  apiUri: string;
  redirectUri: string;
  connectScopes: string[];
  webhookSecret: string;
  revision?: number;
};

const serviceId = 'experience-management';
const pathname = '/api/internal/v1/platform-integrations/nylas';
let cached: { value: NylasPlatformConfiguration | null; expiresAt: number } | null = null;

function sharedSecret() {
  const file = config.idpPlatformConfigurationSecretFile;
  if (process.env.NODE_ENV === 'production' && !file) {
    throw new Error('Identity platform configuration HMAC secret file is not configured.');
  }
  const value = file ? fs.readFileSync(file, 'utf8').trim() : config.idpPlatformConfigurationSecret;
  if (value.length >= 32) return value;
  if (process.env.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('Identity platform configuration authentication is not configured.');
}

function localDevelopmentFallback(): NylasPlatformConfiguration | null {
  if (process.env.NODE_ENV === 'production' || !config.nylasClientId || !config.nylasApiKey) return null;
  return {
    clientId: config.nylasClientId,
    apiKey: config.nylasApiKey,
    apiUri: config.nylasApiUri,
    redirectUri: config.nylasRedirectUri,
    connectScopes: config.nylasConnectScopes,
    webhookSecret: String(process.env.NYLAS_WEBHOOK_SECRET || '').trim()
  };
}

function normalizePayload(payload: any): NylasPlatformConfiguration | null {
  if (payload?.configured !== true) return null;
  const clientId = String(payload.clientId || '').trim();
  const apiKey = String(payload.apiKey || '').trim();
  const apiUri = String(payload.apiUri || '').trim().replace(/\/+$/, '');
  if (!clientId || !apiKey || !apiUri) return null;
  return {
    clientId,
    apiKey,
    apiUri,
    redirectUri: String(payload.redirectUri || '').trim(),
    connectScopes: Array.isArray(payload.connectScopes)
      ? payload.connectScopes.map((scope: unknown) => String(scope || '').trim()).filter(Boolean).slice(0, 40)
      : [],
    webhookSecret: String(payload.webhookSecret || '').trim(),
    revision: Number(payload.revision || 0)
  };
}

export async function resolveNylasPlatformConfiguration(force = false): Promise<NylasPlatformConfiguration | null> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt > now) return cached.value;
  const developmentFallback = localDevelopmentFallback();
  if (developmentFallback && !process.env.IDP_PLATFORM_CONFIGURATION_URL) return developmentFallback;
  const timestamp = String(now);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${serviceId}\nGET\n${pathname}`;
  try {
    const response = await fetch(`${config.idpPlatformConfigurationBaseUrl}${pathname}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-seemplify-service': serviceId,
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-nonce': nonce,
        'x-seemplify-signature': crypto.createHmac('sha256', sharedSecret()).update(canonical).digest('hex')
      },
      signal: AbortSignal.timeout(config.idpPlatformConfigurationTimeoutMs)
    });
    if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
    const value = normalizePayload(await response.json());
    cached = { value, expiresAt: now + config.idpPlatformConfigurationCacheMs };
    return value;
  } catch (error) {
    const fallback = developmentFallback;
    if (fallback) return fallback;
    console.error('Identity Nylas configuration is unavailable:', error instanceof Error ? error.message : 'unknown error');
    cached = { value: null, expiresAt: now + Math.min(config.idpPlatformConfigurationCacheMs, 30_000) };
    return null;
  }
}

export function clearNylasPlatformConfigurationCache() { cached = null; }
