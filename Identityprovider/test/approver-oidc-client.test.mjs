import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getHubApps, getOidcLaunchApiUrl } from '../src/config/hubApps.js'

test('Approver is a launchable IdP application with a same-origin callback', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const client = clients.find(item => item.client_id === 'approver')
  const app = getHubApps().find(item => item.appId === 'approver')

  assert.ok(client)
  assert.ok(client.redirect_uri_patterns.includes(
    'https://approver.seemplifyai.com/api/auth/oidc/callback'
  ))
  assert.equal(client.token_endpoint_auth_method, 'client_secret_basic')
  assert.equal(app?.clientId, 'approver')
  assert.equal(app?.name, 'Approver')
  assert.equal(app?.isActive, true)
  assert.equal(getOidcLaunchApiUrl(app, 'https://api.seemplifyai.com'), app?.apiUrl)
})
