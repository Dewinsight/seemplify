const test = require('node:test');
const assert = require('node:assert/strict');
const {
    clearStoragePlatformConfigurationCache,
    resolveStoragePlatformConfiguration
} = require('../services/platformConfigurationClient');

test('Approver requests its solution-scoped storage policy over the signed Identity channel', async () => {
    const originalFetch = global.fetch;
    try {
        clearStoragePlatformConfigurationCache();
        global.fetch = async (url, options) => {
            assert.match(String(url), /platform-integrations\/storage$/u);
            assert.equal(options.headers['x-seemplify-service'], 'approver');
            assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u);
            return { ok: true, async json() { return {
                configured: true, solution: 'approver', defaultProvider: 'azure-blob',
                providers: { azureBlob: { configured: true }, cloudinary: { configured: true } }
            }; } };
        };
        const result = await resolveStoragePlatformConfiguration({ force: true, environment: {
            NODE_ENV: 'test', IDP_PLATFORM_CONFIGURATION_URL: 'https://identity.example.test',
            IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-secret-that-is-at-least-32-characters'
        } });
        assert.equal(result.solution, 'approver');
        assert.equal(result.defaultProvider, 'azure-blob');
    } finally {
        global.fetch = originalFetch;
        clearStoragePlatformConfigurationCache();
    }
});
