import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'
import { getHubApps, getOidcLaunchApiUrl } from '../src/config/hubApps.js'

test('Workspace is a launchable IDP app with the stable messaging callback', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const client = clients.find(item => item.client_id === 'messaging')
  const app = getHubApps().find(item => item.appId === 'messaging')

  assert.ok(client)
  assert.ok(client.redirect_uri_patterns.includes(
    'https://api-workspace.seemplifyai.com/api/auth/oidc/callback'
  ))
  assert.equal(client.token_endpoint_auth_method, 'client_secret_basic')
  assert.equal(app?.clientId, 'messaging')
  assert.equal(app?.name, 'Workspace')
  assert.match(app?.description || '', /Messages, AI, boards, notes, pages, and meetings/)
  assert.equal(app?.category, 'productivity')
  assert.equal(app?.isActive, true)
  assert.equal(getOidcLaunchApiUrl(app, 'https://api.seemplifyai.com'), app?.apiUrl)
  assert.notEqual(getOidcLaunchApiUrl(app, 'https://api.seemplifyai.com'), 'https://api.seemplifyai.com')
})

test('Workspace OIDC client secret is supplied by the deployment environment', () => {
  const clients = [
    { client_id: 'messaging', client_secret: 'development-placeholder' },
    { client_id: 'another-app', client_secret: 'unchanged' }
  ]
  const configured = applyOidcClientSecretOverrides(clients, {
    MESSAGING_OIDC_CLIENT_SECRET: 'production-messaging-secret'
  })
  assert.equal(configured[0].client_secret, 'production-messaging-secret')
  assert.equal(configured[1].client_secret, 'unchanged')
});
