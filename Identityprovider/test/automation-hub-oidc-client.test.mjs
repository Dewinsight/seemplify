import assert from 'node:assert/strict'
import test from 'node:test'
import { getHubApps, getOidcLaunchApiUrl } from '../src/config/hubApps.js'

test('Automation Hub launches its own OIDC backend', () => {
  const app = getHubApps().find(item => item.appId === 'automation-hub')
  assert.ok(app)
  assert.equal(app.clientId, 'automation-hub')
  assert.match(app.url, /^https?:\/\//)
  assert.match(app.apiUrl, /^https?:\/\//)
  assert.equal(getOidcLaunchApiUrl(app, 'http://wrong.example'), app.apiUrl)
})
