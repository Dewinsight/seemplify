import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'

const clients = [
  { client_id: 'seemplify-learning', client_secret: 'repository-default' },
  { client_id: 'performance-management', client_secret: 'performance-secret' }
]

test('Learning OIDC secret can be supplied from the deployment environment', () => {
  const configured = applyOidcClientSecretOverrides(clients, {
    SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET: 'deployment-only-secret'
  })
  assert.equal(configured[0].client_secret, 'deployment-only-secret')
  assert.equal(configured[1].client_secret, 'performance-secret')
  assert.equal(clients[0].client_secret, 'repository-default')
})

test('a blank deployment override preserves the registered fallback', () => {
  const configured = applyOidcClientSecretOverrides(clients, {
    SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET: '   '
  })
  assert.equal(configured[0].client_secret, 'repository-default')
})
