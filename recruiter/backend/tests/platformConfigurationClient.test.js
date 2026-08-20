const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clearStoragePlatformConfigurationCache,
  hydrateAzureSpeechConfiguration,
  hydrateCloudinaryConfiguration,
  hydratePlatformConfiguration,
  resolveStoragePlatformConfiguration
} = require('../services/platformConfigurationClient');

test('People Transitions requests its independently switchable storage policy', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; clearStoragePlatformConfigurationCache(); });
  clearStoragePlatformConfigurationCache();
  global.fetch = async (url, options) => {
    assert.match(String(url), /platform-integrations\/storage\/people-transitions$/u);
    assert.equal(options.headers['x-seemplify-service'], 'recruiter');
    return { ok: true, json: async () => ({
      configured: true,
      solution: 'people-transitions',
      defaultProvider: 'cloudinary',
      providers: { cloudinary: { configured: true }, azureBlob: { configured: true } }
    }) };
  };
  const configuration = await resolveStoragePlatformConfiguration({
    environment: {
      NODE_ENV: 'test',
      IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
    },
    solution: 'people-transitions',
    force: true
  });
  assert.equal(configuration.solution, 'people-transitions');
});

test('Recruiter hydrates AI Interview speech settings from signed Identity configuration', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => {
    assert.equal(options.headers['x-seemplify-service'], 'recruiter');
    assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u);
    return { ok: true, json: async () => ({ configured: true, speechKey: 'speech-key', region: 'westeurope', language: 'en-GB', voice: 'en-GB-SoniaNeural' }) };
  };
  const environment = {
    NODE_ENV: 'test',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.equal(await hydrateAzureSpeechConfiguration({ environment, quiet: true }), true);
  assert.equal(environment.AZURE_SPEECH_KEY, 'speech-key');
  assert.equal(environment.AZURE_SPEECH_REGION, 'westeurope');
});

test('Recruiter hydrates Cloudinary settings and derives CLOUDINARY_URL from signed Identity configuration', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    assert.match(String(url), /platform-integrations\/cloudinary$/u);
    assert.equal(options.headers['x-seemplify-service'], 'recruiter');
    assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u);
    return { ok: true, json: async () => ({ configured: true, cloudName: 'demo-cloud', apiKey: 'test-key', apiSecret: 'test@secret' }) };
  };
  const environment = {
    NODE_ENV: 'test',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true }), true);
  assert.equal(environment.CLOUDINARY_CLOUD_NAME, 'demo-cloud');
  assert.equal(environment.CLOUDINARY_API_KEY, 'test-key');
  assert.equal(environment.CLOUDINARY_API_SECRET, 'test@secret');
  assert.equal(environment.CLOUDINARY_URL, 'cloudinary://test-key:test%40secret@demo-cloud');
});

test('Recruiter hydrates Cloudinary and Azure Speech together', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => String(url).endsWith('/cloudinary')
    ? { ok: true, json: async () => ({ configured: true, cloudName: 'demo-cloud', apiKey: 'key', apiSecret: 'secret' }) }
    : { ok: true, json: async () => ({ configured: true, speechKey: 'speech-key', region: 'westeurope' }) };
  const environment = {
    NODE_ENV: 'test',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.deepEqual(await hydratePlatformConfiguration({ environment, quiet: true }), { cloudinary: true, azureSpeech: true });
});

test('Recruiter accepts CLOUDINARY_URL as an offline compatibility fallback', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error('offline'); };
  const environment = {
    NODE_ENV: 'test',
    CLOUDINARY_URL: 'cloudinary://fallback-key:fallback%40secret@fallback-cloud',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true }), true);
  assert.equal(environment.CLOUDINARY_CLOUD_NAME, 'fallback-cloud');
  assert.equal(environment.CLOUDINARY_API_SECRET, 'fallback@secret');
});

test('Recruiter storage policy fails closed instead of silently selecting Cloudinary', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; clearStoragePlatformConfigurationCache(); });
  clearStoragePlatformConfigurationCache();
  global.fetch = async () => { throw new Error('offline'); };
  const configuration = await resolveStoragePlatformConfiguration({
    force: true,
    environment: {
      NODE_ENV: 'test',
      CLOUDINARY_URL: 'cloudinary://fallback-key:fallback-secret@fallback-cloud',
      IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
    }
  });
  assert.equal(configuration, null);
});
