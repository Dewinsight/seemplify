const crypto = require('node:crypto');
const fs = require('node:fs');

const SERVICE = 'ai-interview';
const PATH = '/api/internal/v1/platform-integrations/azure-speech';

function sharedSecret(environment = process.env) {
  const file = String(environment.IDP_AI_INTERVIEW_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim();
  const value = file
    ? fs.readFileSync(file, 'utf8').trim()
    : String(environment.IDP_AI_INTERVIEW_PLATFORM_INTEGRATION_HMAC_SECRET || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || '').trim();
  if (value.length >= 32) return value;
  if (environment.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('AI Interview platform configuration authentication is not configured.');
}

async function fetchAzureSpeechConfiguration(environment = process.env) {
  const baseUrl = String(environment.IDP_PLATFORM_CONFIGURATION_URL || environment.IDENTITY_PROVIDER_URL || 'https://auth.seemplifyai.com').trim().replace(/\/+$/u, '');
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${SERVICE}\nGET\n${PATH}`;
  const response = await fetch(`${baseUrl}${PATH}`, {
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
  return response.json();
}

function applyAzureSpeechConfiguration(configuration, environment = process.env) {
  if (!configuration?.configured || !configuration.speechKey || !configuration.region) return false;
  environment.AZURE_SPEECH_KEY = configuration.speechKey;
  environment.AZURE_SPEECH_REGION = configuration.region;
  if (configuration.ttsEndpoint) environment.AZURE_SPEECH_TTS_ENDPOINT = configuration.ttsEndpoint;
  if (configuration.language) environment.AZURE_AI_INTERVIEW_SPEECH_LANGUAGE = configuration.language;
  if (configuration.voice) environment.AZURE_AI_INTERVIEW_SPEECH_VOICE = configuration.voice;
  if (configuration.outputFormat) environment.AZURE_SPEECH_OUTPUT_FORMAT = configuration.outputFormat;
  return true;
}

async function hydrateAzureSpeechConfiguration({ environment = process.env, quiet = false } = {}) {
  try {
    const configured = applyAzureSpeechConfiguration(await fetchAzureSpeechConfiguration(environment), environment);
    if (configured && !quiet) console.log('Azure Speech configuration loaded from Seemplify Identity.');
    return configured;
  } catch (error) {
    const fallback = Boolean((environment.AZURE_SPEECH_KEY || environment.AZURE_VOICELIVE_API_KEY) && (environment.AZURE_SPEECH_REGION || environment.AZURE_LOCATION));
    if (!fallback && !quiet) console.warn('Identity Azure Speech configuration is unavailable:', error.message);
    return fallback;
  }
}

module.exports = { applyAzureSpeechConfiguration, fetchAzureSpeechConfiguration, hydrateAzureSpeechConfiguration };
