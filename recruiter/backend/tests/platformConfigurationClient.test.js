const assert = require('node:assert/strict');
const test = require('node:test');
const { hydrateAzureSpeechConfiguration } = require('../services/platformConfigurationClient');

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
