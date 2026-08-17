import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { jwtVerify } from 'jose'
import { getHubApps, getOidcLaunchApiUrl } from '../src/config/hubApps.js'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'

test('Experience is a first-class launchable IdP application', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const client = clients.find(item => item.client_id === 'experience-management')
  const app = getHubApps().find(item => item.appId === 'experience-management')

  assert.ok(client)
  assert.ok(client.redirect_uri_patterns.includes(
    'https://experience.seemplifyai.com/api/auth/oidc/callback'
  ))
  assert.equal(client.token_endpoint_auth_method, 'client_secret_basic')
  assert.equal(app?.clientId, 'experience-management')
  assert.equal(app?.url, 'http://localhost:5410')
  assert.equal(app?.isActive, true)
  assert.equal(getOidcLaunchApiUrl(app, 'https://api.seemplifyai.com'), app?.apiUrl)
})

test('production can override the Experience client secret without changing clients.json', () => {
  const overridden = applyOidcClientSecretOverrides([
    { client_id: 'experience-management', client_secret: 'development-secret' },
    { client_id: 'approver', client_secret: 'approver-secret' }
  ], { EXPERIENCE_OIDC_CLIENT_SECRET: 'protected-production-secret' })
  assert.equal(overridden[0].client_secret, 'protected-production-secret')
  assert.equal(overridden[1].client_secret, 'approver-secret')
})

test('IdP Admin creates a short-lived, audience-bound Experience launch', async () => {
  const priorSecret = process.env.EXPERIENCE_ADMIN_SSO_SECRET
  const priorUrl = process.env.EXPERIENCE_MANAGEMENT_URL
  process.env.EXPERIENCE_ADMIN_SSO_SECRET = 'test-experience-admin-sso-secret-that-is-long-enough'
  process.env.EXPERIENCE_MANAGEMENT_URL = 'https://experience.seemplifyai.com'
  try {
    const { buildExperienceAdminLaunchUrl } = await import('../src/services/experienceAdminSsoService.js')
    const launch = new URL(await buildExperienceAdminLaunchUrl({
      sub: 'idp-admin-sub', email: 'admin@example.test', profile: { name: 'IdP Admin' },
      isSuperAdmin: true, isSystemAdmin: true, hasAdminAccess: () => true
    }))
    assert.equal(launch.origin, 'https://experience.seemplifyai.com')
    assert.equal(launch.pathname, '/api/auth/idp-admin')
    const verified = await jwtVerify(
      launch.searchParams.get('token'),
      new TextEncoder().encode(process.env.EXPERIENCE_ADMIN_SSO_SECRET),
      { issuer: 'aiin-idp-admin', audience: 'experience-admin' }
    )
    assert.equal(verified.payload.sub, 'idp-admin-sub')
    assert.equal(verified.payload.isSuperAdmin, true)
    assert.ok(Number(verified.payload.exp) - Number(verified.payload.iat) <= 60)
  } finally {
    if (priorSecret === undefined) delete process.env.EXPERIENCE_ADMIN_SSO_SECRET
    else process.env.EXPERIENCE_ADMIN_SSO_SECRET = priorSecret
    if (priorUrl === undefined) delete process.env.EXPERIENCE_MANAGEMENT_URL
    else process.env.EXPERIENCE_MANAGEMENT_URL = priorUrl
  }
})
