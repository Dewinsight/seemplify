import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

export type StoragePlatformConfiguration = {
  configured: boolean;
  solution: string;
  defaultProvider: 'cloudinary' | 'azure-blob';
  providers: {
    cloudinary: { configured: boolean; cloudName?: string; apiKey?: string; apiSecret?: string };
    azureBlob: { configured: boolean; accountName?: string; accountKey?: string; containerName?: string; endpoint?: string };
  };
};

const serviceId = 'experience-management';
const pathname = '/api/internal/v1/platform-integrations/storage';
let cached: { value: StoragePlatformConfiguration | null; expiresAt: number } | null = null;

function sharedSecret() {
  const file = config.idpPlatformConfigurationSecretFile;
  if (process.env.NODE_ENV === 'production' && !file) throw new Error('Identity platform configuration HMAC secret file is not configured.');
  const value = file ? fs.readFileSync(file, 'utf8').trim() : config.idpPlatformConfigurationSecret;
  if (value.length >= 32) return value;
  if (process.env.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('Identity platform configuration authentication is not configured.');
}

export async function resolveStoragePlatformConfiguration(force = false): Promise<StoragePlatformConfiguration | null> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt > now) return cached.value;
  const timestamp = String(now);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${serviceId}\nGET\n${pathname}`;
  try {
    const response = await fetch(`${config.idpPlatformConfigurationBaseUrl}${pathname}`, {
      headers: {
        accept: 'application/json', 'x-seemplify-service': serviceId, 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce,
        'x-seemplify-signature': crypto.createHmac('sha256', sharedSecret()).update(canonical).digest('hex')
      },
      signal: AbortSignal.timeout(config.idpPlatformConfigurationTimeoutMs)
    });
    if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
    const value = await response.json() as StoragePlatformConfiguration;
    if (!value?.configured || !['cloudinary', 'azure-blob'].includes(value.defaultProvider)) throw new Error('Identity returned an incomplete storage configuration.');
    cached = { value, expiresAt: now + config.idpPlatformConfigurationCacheMs };
    return value;
  } catch (error) {
    console.error('Identity storage configuration is unavailable:', error instanceof Error ? error.message : 'unknown error');
    cached = { value: null, expiresAt: now + 30_000 };
    return null;
  }
}

export function clearStoragePlatformConfigurationCache() { cached = null; }
