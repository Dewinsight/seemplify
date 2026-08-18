const test = require('node:test');
const assert = require('node:assert/strict');
const { clearStoragePlatformConfigurationCache, resolveStoragePlatformConfiguration } = require('../services/platformConfigurationClient');

test('Performance requests its solution-scoped storage policy from Identity', async () => {
  const originalFetch = global.fetch;
  try {
    clearStoragePlatformConfigurationCache();
    global.fetch = async (url, options) => {
      assert.match(String(url), /platform-integrations\/storage$/u);
      assert.equal(options.headers['x-seemplify-service'], 'performance');
      assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u);
      return { ok: true, async json() { return { configured: true, solution: 'performance',
        defaultProvider: 'azure-blob', providers: { cloudinary: { configured: true }, azureBlob: { configured: true } } }; } };
    };
    const result = await resolveStoragePlatformConfiguration({ force: true, environment: {
      NODE_ENV: 'test', IDP_PLATFORM_CONFIGURATION_URL: 'https://identity.example.test',
      IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-secret-that-is-at-least-32-characters'
    } });
    assert.equal(result.solution, 'performance');
    assert.equal(result.defaultProvider, 'azure-blob');
  } finally {
    global.fetch = originalFetch;
    clearStoragePlatformConfigurationCache();
  }
});
