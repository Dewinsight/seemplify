const assert = require('node:assert/strict');
const test = require('node:test');
const { hydrateCloudinaryConfiguration } = require('../services/platformConfigurationClient');

test('legacy Recruiter loads Cloudinary from signed Identity configuration', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    assert.match(String(url), /platform-integrations\/cloudinary$/u);
    assert.equal(options.headers['x-seemplify-service'], 'recruiter');
    assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u);
    return { ok: true, json: async () => ({ configured: true, cloudName: 'demo-cloud', apiKey: 'test-key', apiSecret: 'test-secret' }) };
  };
  const environment = {
    NODE_ENV: 'test',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true, cloudinaryClient: { config() {} } }), true);
  assert.equal(environment.CLOUDINARY_CLOUD_NAME, 'demo-cloud');
  assert.equal(environment.CLOUDINARY_URL, 'cloudinary://test-key:test-secret@demo-cloud');
});

test('legacy Recruiter accepts CLOUDINARY_URL as an offline fallback', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error('offline'); };
  const environment = {
    NODE_ENV: 'test',
    CLOUDINARY_URL: 'cloudinary://fallback-key:fallback%40secret@fallback-cloud',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  };
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true, cloudinaryClient: { config() {} } }), true);
  assert.equal(environment.CLOUDINARY_API_SECRET, 'fallback@secret');
});
