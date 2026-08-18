const crypto = require('crypto');
const fs = require('fs');

const SERVICE = 'recruiter';
const CLOUDINARY_PATH = '/api/internal/v1/platform-integrations/cloudinary';

function sharedSecret(environment = process.env) {
  const file = String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim();
  const value = file
    ? fs.readFileSync(file, 'utf8').trim()
    : String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || '').trim();
  if (value.length >= 32) return value;
  if (environment.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('Recruiter platform configuration authentication is not configured.');
}

function environmentCloudinary(environment = process.env) {
  if (environment.CLOUDINARY_URL) {
    try {
      const parsed = new URL(String(environment.CLOUDINARY_URL).trim().replace(/^CLOUDINARY_URL\s*=\s*/iu, ''));
      if (parsed.protocol === 'cloudinary:' && parsed.hostname && parsed.username && parsed.password) {
        return { cloudName: parsed.hostname, apiKey: decodeURIComponent(parsed.username), apiSecret: decodeURIComponent(parsed.password) };
      }
    } catch { /* Fall through to split variables. */ }
  }
  if (!environment.CLOUDINARY_CLOUD_NAME || !environment.CLOUDINARY_API_KEY || !environment.CLOUDINARY_API_SECRET) return null;
  return {
    cloudName: environment.CLOUDINARY_CLOUD_NAME,
    apiKey: environment.CLOUDINARY_API_KEY,
    apiSecret: environment.CLOUDINARY_API_SECRET
  };
}

function applyCloudinaryConfiguration(configuration, environment = process.env, cloudinaryClient = null) {
  environment.CLOUDINARY_CLOUD_NAME = configuration.cloudName;
  environment.CLOUDINARY_API_KEY = configuration.apiKey;
  environment.CLOUDINARY_API_SECRET = configuration.apiSecret;
  environment.CLOUDINARY_URL = `cloudinary://${encodeURIComponent(configuration.apiKey)}:${encodeURIComponent(configuration.apiSecret)}@${configuration.cloudName}`;
  (cloudinaryClient || require('cloudinary').v2).config({
    cloud_name: configuration.cloudName,
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret
  });
}

async function hydrateCloudinaryConfiguration({ environment = process.env, quiet = false, cloudinaryClient = null } = {}) {
  try {
    const baseUrl = String(environment.IDP_PLATFORM_CONFIGURATION_URL || environment.IDENTITY_PROVIDER_URL || 'https://auth.seemplifyai.com').trim().replace(/\/+$/u, '');
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(24).toString('base64url');
    const canonical = `${timestamp}\n${nonce}\n${SERVICE}\nGET\n${CLOUDINARY_PATH}`;
    const response = await fetch(`${baseUrl}${CLOUDINARY_PATH}`, {
      headers: {
        accept: 'application/json',
        'x-seemplify-service': SERVICE,
        'x-seemplify-timestamp': timestamp,
        'x-seemplify-nonce': nonce,
        'x-seemplify-signature': crypto.createHmac('sha256', sharedSecret(environment)).update(canonical).digest('hex')
      },
      signal: AbortSignal.timeout(Number(environment.IDP_PLATFORM_CONFIGURATION_TIMEOUT_MS || 5_000))
    });
    if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
    const configuration = await response.json();
    if (!configuration.configured || !configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) {
      const fallback = environmentCloudinary(environment);
      if (fallback) applyCloudinaryConfiguration(fallback, environment, cloudinaryClient);
      return Boolean(fallback);
    }
    applyCloudinaryConfiguration(configuration, environment, cloudinaryClient);
    if (!quiet) console.log('Cloudinary configuration loaded from Seemplify Identity.');
    return true;
  } catch (error) {
    const fallback = environmentCloudinary(environment);
    if (fallback) applyCloudinaryConfiguration(fallback, environment, cloudinaryClient);
    if (!fallback && !quiet) console.warn('Identity Cloudinary configuration is unavailable:', error.message);
    return Boolean(fallback);
  }
}

module.exports = { hydrateCloudinaryConfiguration };
