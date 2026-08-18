const crypto = require('crypto');
const fs = require('fs');

const SERVICE = 'recruiter';
const PATH = '/api/internal/v1/platform-integrations/azure-speech';

function secret(environment = process.env) {
  const file = String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : String(environment.IDP_RECRUITER_PLATFORM_INTEGRATION_HMAC_SECRET || environment.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || '').trim();
  if (value.length >= 32) return value;
  if (environment.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me';
  throw new Error('Recruiter platform configuration authentication is not configured.');
}

async function hydrateAzureSpeechConfiguration({ environment = process.env, quiet = false } = {}) {
  try {
    const baseUrl = String(environment.IDP_PLATFORM_CONFIGURATION_URL || environment.IDENTITY_PROVIDER_URL || 'https://auth.seemplifyai.com').trim().replace(/\/+$/u, '');
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(24).toString('base64url');
    const canonical = `${timestamp}\n${nonce}\n${SERVICE}\nGET\n${PATH}`;
    const response = await fetch(`${baseUrl}${PATH}`, {
      headers: {
        accept: 'application/json', 'x-seemplify-service': SERVICE, 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce,
        'x-seemplify-signature': crypto.createHmac('sha256', secret(environment)).update(canonical).digest('hex')
      },
      signal: AbortSignal.timeout(Number(environment.IDP_PLATFORM_CONFIGURATION_TIMEOUT_MS || 5_000))
    });
    if (!response.ok) throw new Error(`Identity returned ${response.status}.`);
    const configuration = await response.json();
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

module.exports = { hydrateAzureSpeechConfiguration };
