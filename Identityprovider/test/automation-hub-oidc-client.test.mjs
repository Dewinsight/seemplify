import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { getHubApps, getOidcLaunchApiUrl, getOidcLaunchPath } from '../src/config/hubApps.js'

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
