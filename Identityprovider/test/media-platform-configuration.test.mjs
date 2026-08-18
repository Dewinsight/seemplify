import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAzureBlobAdminCredentialReveal,
  buildCloudinaryAdminCredentialReveal,
  buildCloudinaryEnvironmentVariable,
  buildAzureSpeechAdminCredentialReveal,
  canServiceAccessStorageSolution,
  decryptMediaConfiguration,
  encryptMediaConfiguration,
  normalizeAzureSpeechConfiguration,
  normalizeAzureBlobConfiguration,
  normalizeCloudinaryConfiguration,
  normalizeStorageDefaults,
  parseCloudinaryEnvironmentVariable
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

test('Cloudinary API environment variable is parsed without storing a redundant composite secret', () => {
  const input = 'CLOUDINARY_URL=cloudinary://test-key:test%40secret@demo-cloud'
  assert.deepEqual(normalizeCloudinaryConfiguration({ cloudinaryUrl: input }), {
    cloudName: 'demo-cloud',
    apiKey: 'test-key',
    apiSecret: 'test@secret'
  })
  assert.deepEqual(parseCloudinaryEnvironmentVariable(`"${input}"`), {
    cloudName: 'demo-cloud',
    apiKey: 'test-key',
    apiSecret: 'test@secret'
  })
  assert.equal(buildCloudinaryEnvironmentVariable({
    cloudName: 'demo-cloud',
    apiKey: 'test-key',
    apiSecret: 'test@secret'
  }), input)
  assert.throws(() => normalizeCloudinaryConfiguration({ cloudinaryUrl: 'https://example.com' }), /Cloudinary API environment variable/u)
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

test('Azure Blob configuration validates private storage coordinates and preserves a blank replacement key', () => {
  assert.deepEqual(normalizeAzureBlobConfiguration({
    accountName: 'seemplifyprod',
    accountKey: '',
    containerName: 'seemplify-files'
  }, {
    accountName: 'oldaccount',
    accountKey: 'existing-storage-key',
    containerName: 'old-container'
  }), {
    accountName: 'seemplifyprod',
    accountKey: 'existing-storage-key',
    containerName: 'seemplify-files',
    endpoint: 'https://seemplifyprod.blob.core.windows.net'
  })
  assert.throws(() => normalizeAzureBlobConfiguration({ accountName: 'Bad_Name', accountKey: 'key' }), /account name/u)
  assert.throws(() => normalizeAzureBlobConfiguration({ accountName: 'validaccount', accountKey: 'key', containerName: 'Bad_Container' }), /container name/u)
})

test('storage defaults are independent per solution and reject unknown providers', () => {
  const defaults = normalizeStorageDefaults({ workspace: 'azure-blob', recruiter: 'cloudinary' })
  assert.equal(defaults.defaults.workspace, 'azure-blob')
  assert.equal(defaults.defaults.recruiter, 'cloudinary')
  assert.equal(defaults.defaults['people-transitions'], 'cloudinary')
  assert.equal(defaults.defaults.performance, 'azure-blob')
  assert.equal(defaults.defaults.approver, 'azure-blob')
  assert.throws(() => normalizeStorageDefaults({ workspace: 'local-disk' }), /Unsupported storage provider/u)
})

test('storage solution access keeps People Transitions separate but bound to the Recruiter service', () => {
  assert.equal(canServiceAccessStorageSolution('recruiter', 'people-transitions'), true)
  assert.equal(canServiceAccessStorageSolution('recruiter', 'recruiter'), true)
  assert.equal(canServiceAccessStorageSolution('workspace', 'people-transitions'), false)
  assert.equal(canServiceAccessStorageSolution('identity-provider', 'people-transitions'), false)
})

test('Azure Blob account key is available only through the explicit admin reveal projection', () => {
  const record = { revision: 3, updatedAt: new Date('2026-08-18T16:00:00Z') }
  assert.deepEqual(buildAzureBlobAdminCredentialReveal(record, { accountKey: 'saved-storage-key' }), {
    accountKey: 'saved-storage-key',
    revision: 3,
    updatedAt: record.updatedAt
  })
  assert.throws(() => buildAzureBlobAdminCredentialReveal(record, {}), /not configured/u)
})

test('Azure Speech key is available only through the explicit admin reveal projection', () => {
  const record = { revision: 4, updatedAt: new Date('2026-08-18T14:00:00Z') }
  const configuration = { speechKey: 'saved-speech-key', region: 'swedencentral' }
  assert.deepEqual(buildAzureSpeechAdminCredentialReveal(record, configuration), {
    speechKey: 'saved-speech-key',
    revision: 4,
    updatedAt: record.updatedAt
  })
  assert.throws(() => buildAzureSpeechAdminCredentialReveal(record, { region: 'swedencentral' }), /not configured/u)
})

test('Cloudinary composite credential is available only through the explicit admin reveal projection', () => {
  const record = { revision: 2, updatedAt: new Date('2026-08-18T15:00:00Z') }
  const configuration = { cloudName: 'demo-cloud', apiKey: 'test-key', apiSecret: 'test-secret' }
  assert.deepEqual(buildCloudinaryAdminCredentialReveal(record, configuration), {
    cloudinaryUrl: 'CLOUDINARY_URL=cloudinary://test-key:test-secret@demo-cloud',
    revision: 2,
    updatedAt: record.updatedAt
  })
  assert.throws(() => buildCloudinaryAdminCredentialReveal(record, { cloudName: 'demo-cloud' }), /not configured/u)
})
