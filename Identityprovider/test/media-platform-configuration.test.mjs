import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decryptMediaConfiguration,
  encryptMediaConfiguration,
  normalizeAzureSpeechConfiguration,
  normalizeCloudinaryConfiguration
} from '../src/services/mediaPlatformConfigurationService.js'

const environment = { NODE_ENV: 'test', IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'test-only-platform-encryption-key-material-123456' }

test('media configurations are encrypted with integration-specific authenticated data', () => {
  const configuration = { cloudName: 'workspace', apiKey: 'key', apiSecret: 'secret' }
  const envelope = encryptMediaConfiguration('cloudinary', configuration, environment)
  assert.equal(envelope.includes('secret'), false)
  assert.deepEqual(decryptMediaConfiguration('cloudinary', envelope, environment), configuration)
  assert.throws(() => decryptMediaConfiguration('azure-speech', envelope, environment))
})

test('blank admin secrets preserve existing Cloudinary and Azure values', () => {
  assert.deepEqual(normalizeCloudinaryConfiguration(
    { cloudName: 'new-cloud', apiKey: '', apiSecret: '' },
    { cloudName: 'old-cloud', apiKey: 'existing-key', apiSecret: 'existing-secret' }
  ), { cloudName: 'new-cloud', apiKey: 'existing-key', apiSecret: 'existing-secret' })
  assert.equal(normalizeAzureSpeechConfiguration(
    { speechKey: '', region: 'westeurope', language: 'en-GB' },
    { speechKey: 'existing-speech-key', region: 'eastus', voice: 'en-US-AvaNeural' }
  ).speechKey, 'existing-speech-key')
})

test('Azure custom endpoints reject insecure production URLs', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(() => normalizeAzureSpeechConfiguration({ speechKey: 'key', region: 'eastus', ttsEndpoint: 'http://speech.example.com' }), /HTTPS/u)
  } finally {
    process.env.NODE_ENV = previous
  }
})
