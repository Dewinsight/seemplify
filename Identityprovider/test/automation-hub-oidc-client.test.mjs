import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { getHubApps, getOidcLaunchApiUrl, getOidcLaunchPath } from '../src/config/hubApps.js'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'

test('Automation Hub launches its own OIDC backend', () => {
  const app = getHubApps().find(item => item.appId === 'automation-hub')
  assert.ok(app)
  assert.equal(app.clientId, 'automation-hub')
  assert.match(app.url, /^https?:\/\//)
  assert.match(app.apiUrl, /^https?:\/\//)
  assert.equal(getOidcLaunchApiUrl(app, 'http://wrong.example'), app.apiUrl)
  assert.equal(getOidcLaunchPath(app), '/auth/login')
})

test('Automation Hub production launch never exposes Docker DNS to the browser', () => {
  const moduleUrl = new URL('../src/config/hubApps.js', import.meta.url).href
  const script = `
    const { getHubApps, getOidcLaunchApiUrl, getOidcLaunchPath } = await import(${JSON.stringify(moduleUrl)});
    const app = getHubApps().find((item) => item.appId === 'automation-hub');
    process.stdout.write(JSON.stringify({ apiUrl: getOidcLaunchApiUrl(app, 'http://wrong.example'), path: getOidcLaunchPath(app) }));
  `
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AUTOMATION_HUB_URL: 'https://automations.seemplifyai.com',
      AUTOMATION_HUB_API_URL: 'http://automation-hub:5420'
    }
  })
  assert.deepEqual(JSON.parse(output), {
    apiUrl: 'https://automations.seemplifyai.com',
    path: '/auth/login'
  })
})

test('Automation Hub uses the same root-only client secret as its IdP registration', () => {
  const secretPath = '/run/seemplify/automation-hub-oidc-client-secret'
  const configured = applyOidcClientSecretOverrides([
    { client_id: 'automation-hub', client_secret: 'development-only-secret' },
    { client_id: 'approver', client_secret: 'unchanged-secret' }
  ], {
    AUTOMATION_HUB_OIDC_CLIENT_SECRET_FILE: secretPath
  }, (path, encoding) => {
    assert.equal(path, secretPath)
    assert.equal(encoding, 'utf8')
    return 'root-only-production-secret\n'
  })

  assert.equal(configured[0].client_secret, 'root-only-production-secret')
  assert.equal(configured[1].client_secret, 'unchanged-secret')
})
