import assert from 'node:assert/strict'
import test from 'node:test'
import { clearStoragePlatformConfigurationCache, hydrateCloudinaryConfiguration, resolveStoragePlatformConfiguration } from '../src/services/platformConfigurationClient.js'

test('Learning resolves its provider-neutral storage policy over the signed Identity channel', async (t) => {
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch; clearStoragePlatformConfigurationCache() })
  clearStoragePlatformConfigurationCache()
  global.fetch = async (url, options) => {
    assert.match(String(url), /platform-integrations\/storage$/u)
    assert.equal(options.headers['x-seemplify-service'], 'seemplify-learning')
    return { ok: true, json: async () => ({ configured: true, solution: 'seemplify-learning',
      defaultProvider: 'cloudinary', providers: { cloudinary: { configured: true }, azureBlob: { configured: true } } }) }
  }
  const result = await resolveStoragePlatformConfiguration({ force: true, environment: {
    NODE_ENV: 'test', IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  } })
  assert.equal(result.solution, 'seemplify-learning')
  assert.equal(result.defaultProvider, 'cloudinary')
})

test('Learning hydrates Cloudinary from the signed Identity configuration channel', async (t) => {
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch })
  global.fetch = async (url, options) => {
    assert.match(String(url), /platform-integrations\/cloudinary$/u)
    assert.equal(options.headers['x-seemplify-service'], 'seemplify-learning')
    assert.match(options.headers['x-seemplify-signature'], /^[a-f0-9]{64}$/u)
    return {
      ok: true,
      json: async () => ({ configured: true, cloudName: 'demo-cloud', apiKey: 'test-key', apiSecret: 'test@secret' })
    }
  }
  const environment = {
    NODE_ENV: 'test',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  }

  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true }), true)
  assert.equal(environment.CLOUDINARY_CLOUD_NAME, 'demo-cloud')
  assert.equal(environment.CLOUDINARY_API_KEY, 'test-key')
  assert.equal(environment.CLOUDINARY_API_SECRET, 'test@secret')
  assert.equal(environment.CLOUDINARY_URL, 'cloudinary://test-key:test%40secret@demo-cloud')
})

test('Learning keeps a complete split-variable fallback when Identity is unavailable', async (t) => {
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch })
  global.fetch = async () => { throw new Error('offline') }
  const environment = {
    NODE_ENV: 'test',
    CLOUDINARY_CLOUD_NAME: 'fallback-cloud',
    CLOUDINARY_API_KEY: 'fallback-key',
    CLOUDINARY_API_SECRET: 'fallback-secret',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  }
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true }), true)
})

test('Learning accepts CLOUDINARY_URL as an offline compatibility fallback', async (t) => {
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch })
  global.fetch = async () => { throw new Error('offline') }
  const environment = {
    NODE_ENV: 'test',
    CLOUDINARY_URL: 'cloudinary://fallback-key:fallback%40secret@fallback-cloud',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  }
  assert.equal(await hydrateCloudinaryConfiguration({ environment, quiet: true }), true)
})

test('Learning storage policy fails closed instead of silently selecting Cloudinary', async (t) => {
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch; clearStoragePlatformConfigurationCache() })
  clearStoragePlatformConfigurationCache()
  global.fetch = async () => { throw new Error('offline') }
  const configuration = await resolveStoragePlatformConfiguration({ force: true, environment: {
    NODE_ENV: 'test',
    CLOUDINARY_URL: 'cloudinary://fallback-key:fallback-secret@fallback-cloud',
    IDP_PLATFORM_INTEGRATION_HMAC_SECRET: 'test-only-platform-service-secret-material-123456'
  } })
  assert.equal(configuration, null)
})
