const crypto = require('crypto');
const fs = require('fs');

const SERVICE = 'recruiter';
const AZURE_SPEECH_PATH = '/api/internal/v1/platform-integrations/azure-speech';
const CLOUDINARY_PATH = '/api/internal/v1/platform-integrations/cloudinary';
const STORAGE_PATH = '/api/internal/v1/platform-integrations/storage';
const storageCache = new Map();

function secret(environment = process.env) {
  const file = String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || '').trim();
  if (value.length >= 32) return value;
  if (environment.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('Recruiter platform configuration authentication is not configured.');
}

async function signedConfiguration(path, environment) {
  const baseUrl = String(environment.IDP_PLATFORM_CONFIGURATION_URL || environment.IDENTITY_PROVIDER_URL || 'https://auth.seemplifyai.com').trim().replace(/\/+$/u, '');
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${SERVICE}\nGET\n${path}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: 'application/json', 'x-seemplify-service': SERVICE, 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce,
      'x-seemplify-signature': crypto.createHmac('sha256', secret(environment)).update(canonical).digest('hex')
    },
    signal: AbortSignal.timeout(Number(environment.IDP_PLATFORM_CONFIGURATION_TIMEOUT_MS || 5_000))
  });
  if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
  return response.json();
}

function applyCloudinaryConfiguration(configuration, environment) {
  environment.CLOUDINARY_CLOUD_NAME = configuration.cloudName;
  environment.CLOUDINARY_API_KEY = configuration.apiKey;
  environment.CLOUDINARY_API_SECRET = configuration.apiSecret;
  environment.CLOUDINARY_URL = `cloudinary://${encodeURIComponent(configuration.apiKey)}:${encodeURIComponent(configuration.apiSecret)}@${configuration.cloudName}`;
  require('cloudinary').v2.config({
    cloud_name: configuration.cloudName,
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret
  });
}

function environmentCloudinary(environment) {
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

async function hydrateCloudinaryConfiguration({ environment = process.env, quiet = false } = {}) {
  try {
    const configuration = await signedConfiguration(CLOUDINARY_PATH, environment);
    if (!configuration.configured || !configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) {
      const fallback = environmentCloudinary(environment);
      if (fallback) applyCloudinaryConfiguration(fallback, environment);
      return Boolean(fallback);
    }
    applyCloudinaryConfiguration(configuration, environment);
    if (!quiet) console.log('Cloudinary configuration loaded from Seemplify Identity.');
    return true;
  } catch (error) {
    const fallback = environmentCloudinary(environment);
    if (fallback) applyCloudinaryConfiguration(fallback, environment);
    if (!fallback && !quiet) console.warn('Identity Cloudinary configuration is unavailable:', error.message);
    return Boolean(fallback);
  }
}

async function hydrateAzureSpeechConfiguration({ environment = process.env, quiet = false } = {}) {
  try {
    const configuration = await signedConfiguration(AZURE_SPEECH_PATH, environment);
    if (!configuration.configured || !configuration.speechKey || !configuration.region) return false;
    environment.AZURE_SPEECH_KEY = configuration.speechKey;
    environment.AZURE_SPEECH_REGION = configuration.region;
    if (configuration.ttsEndpoint) environment.AZURE_SPEECH_TTS_ENDPOINT = configuration.ttsEndpoint;
    if (configuration.language) environment.AZURE_AI_INTERVIEW_SPEECH_LANGUAGE = configuration.language;
    if (configuration.voice) environment.AZURE_AI_INTERVIEW_SPEECH_VOICE = configuration.voice;
    if (configuration.outputFormat) environment.AZURE_SPEECH_OUTPUT_FORMAT = configuration.outputFormat;
    if (!quiet) console.log('Azure Speech configuration loaded from Seemplify Identity.');
    return true;
  } catch (error) {
    const fallback = Boolean((environment.AZURE_SPEECH_KEY || environment.AZURE_VOICELIVE_API_KEY) && (environment.AZURE_SPEECH_REGION || environment.AZURE_LOCATION));
    if (!fallback && !quiet) console.warn('Identity Azure Speech configuration is unavailable:', error.message);
    return fallback;
  }
}

async function resolveStoragePlatformConfiguration({ environment = process.env, force = false, solution = SERVICE } = {}) {
  const normalizedSolution = String(solution || SERVICE).trim().toLowerCase();
  if (![SERVICE, 'people-transitions'].includes(normalizedSolution)) {
    throw new Error('Recruiter is not permitted to request that storage solution.');
  }
  const path = normalizedSolution === SERVICE ? STORAGE_PATH : `${STORAGE_PATH}/${normalizedSolution}`;
  const now = Date.now();
  const cached = storageCache.get(normalizedSolution);
  if (!force && cached?.expiresAt > now) return cached.value;
  try {
    const configuration = await signedConfiguration(path, environment);
    if (!configuration?.configured || !['cloudinary', 'azure-blob'].includes(configuration.defaultProvider)) {
      throw new Error('Identity returned an incomplete storage configuration.');
    }
    storageCache.set(normalizedSolution, { value: configuration, expiresAt: now + 5 * 60_000 });
    return configuration;
  } catch (error) {
    const cloudinary = environmentCloudinary(environment);
    const fallback = cloudinary ? {
      configured: true,
      solution: normalizedSolution,
      defaultProvider: 'cloudinary',
      providers: { cloudinary: { configured: true, ...cloudinary }, azureBlob: { configured: false } }
    } : null;
    storageCache.set(normalizedSolution, { value: fallback, expiresAt: now + 30_000 });
    return fallback;
  }
}

async function hydratePlatformConfiguration(options = {}) {
  const [cloudinary, azureSpeech] = await Promise.all([
    hydrateCloudinaryConfiguration(options),
    hydrateAzureSpeechConfiguration(options)
  ]);
  return { cloudinary, azureSpeech };
}

function clearStoragePlatformConfigurationCache() { storageCache.clear(); }

module.exports = {
  clearStoragePlatformConfigurationCache,
  hydrateAzureSpeechConfiguration,
  hydrateCloudinaryConfiguration,
  hydratePlatformConfiguration,
  resolveStoragePlatformConfiguration
};
