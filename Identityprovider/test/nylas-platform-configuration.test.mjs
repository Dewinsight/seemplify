import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decryptPlatformConfiguration,
  encryptPlatformConfiguration,
  normalizeNylasConfiguration,
  publicNylasConfiguration
} from '../src/services/nylasPlatformConfigurationService.js'
import { canonicalPlatformConfigurationRequest } from '../src/middleware/platformIntegrationAuth.js'

const environment = {
  NODE_ENV: 'test',
  IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'unit-test-platform-credential-key-material-32-chars'
}

test('Nylas platform credentials are authenticated-encrypted and round trip', () => {
  const configuration = normalizeNylasConfiguration({
    clientId: 'client-id', apiKey: 'secret-api-key', apiUri: 'https://api.us.nylas.com/',
    redirectUri: 'https://experience.example.test/api/integrations/nylas/callback',
    connectScopes: 'openid, Mail.Read openid', webhookSecret: 'webhook-secret'
  })
  const encrypted = encryptPlatformConfiguration(configuration, environment)
  assert.doesNotMatch(encrypted, /secret-api-key|webhook-secret/u)
  assert.deepEqual(decryptPlatformConfiguration(encrypted, environment), configuration)
  const parts = encrypted.split('.')
  parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`
  assert.throws(() => decryptPlatformConfiguration(parts.join('.'), environment))
})

test('public Nylas status never returns stored secret values', () => {
  const status = publicNylasConfiguration({ revision: 3, updatedAt: new Date('2026-08-18T12:00:00Z') }, {
    clientId: 'client-id', apiKey: 'secret-api-key', apiUri: 'https://api.us.nylas.com',
    redirectUri: '', connectScopes: ['openid'], webhookSecret: 'webhook-secret'
  })
  assert.equal(status.configured, true)
  assert.equal(status.apiKeyConfigured, true)
  assert.equal(JSON.stringify(status).includes('secret-api-key'), false)
  assert.equal(JSON.stringify(status).includes('webhook-secret'), false)
})

test('platform configuration request canonical form binds service, method, and path', () => {
  assert.equal(canonicalPlatformConfigurationRequest({
    timestamp: '123', nonce: 'nonce', service: 'experience-management', method: 'GET',
    path: '/api/internal/v1/platform-integrations/nylas'
  }), '123\nnonce\nexperience-management\nGET\n/api/internal/v1/platform-integrations/nylas')
})

test('signed mutation canonical form also binds the request content', () => {
  assert.equal(canonicalPlatformConfigurationRequest({
    timestamp: '123', nonce: 'nonce', service: 'workspace', method: 'PUT',
    path: '/api/internal/v1/product-access/messaging/roles/employee',
    contentHash: 'a'.repeat(64)
  }), `123\nnonce\nworkspace\nPUT\n/api/internal/v1/product-access/messaging/roles/employee\n${'a'.repeat(64)}`)
})
