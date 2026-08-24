import assert from 'node:assert/strict'
import test from 'node:test'

import { externalProductAccessDecision } from '../src/utils/externalProductAccess.js'

const claims = (permissionsByApp) => ({
  current_organization: {
    authorization: { permissionsByApp }
  }
})

test('Automation and first-party clients retain their existing authorization paths', () => {
  for (const clientId of ['automation-hub', 'messaging', 'community', 'smarthr-backend']) {
    assert.deepEqual(
      externalProductAccessDecision({ clientId, claims: claims({}) }),
      { applicable: false, allowed: true }
    )
  }
})

test('AI Assistant direct OIDC requires its minimum IdP product permission', () => {
  assert.equal(externalProductAccessDecision({ clientId: 'openwebui', claims: claims({}) }).code, 'PRODUCT_NOT_ASSIGNED')
  assert.equal(externalProductAccessDecision({ clientId: 'openwebui', claims: claims({ openwebui: [] }) }).code, 'PRODUCT_PERMISSION_DENIED')
  assert.equal(externalProductAccessDecision({ clientId: 'openwebui', claims: claims({ openwebui: ['models.use'] }) }).allowed, false)
  assert.equal(externalProductAccessDecision({ clientId: 'openwebui', claims: claims({ openwebui: ['chat.use'] }) }).allowed, true)
})

test('Outline direct OIDC requires read access and honors wildcard administrators', () => {
  assert.equal(externalProductAccessDecision({ clientId: 'outline', claims: claims({ outline: ['documents.create'] }) }).allowed, false)
  assert.equal(externalProductAccessDecision({ clientId: 'outline', claims: claims({ outline: ['documents.read'] }) }).allowed, true)
  assert.equal(externalProductAccessDecision({ clientId: 'outline', claims: { product_permissions: { outline: ['*'] } } }).allowed, true)
})
