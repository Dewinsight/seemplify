import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { disableSecretResponseCaching, requireSensitiveAdminAction } from '../src/middleware/sensitiveAdminAction.js'

function request(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return { get(name) { return normalized[String(name).toLowerCase()] || '' } }
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this }
  }
}

test('sensitive admin action requires the explicit same-origin reveal request', () => {
  const middleware = requireSensitiveAdminAction('reveal-azure-speech-key')
  let nextCalls = 0
  const allowedResponse = response()
  middleware(request({
    host: 'auth.seemplifyai.com',
    origin: 'https://auth.seemplifyai.com',
    'sec-fetch-site': 'same-origin',
    'x-seemplify-admin-action': 'reveal-azure-speech-key'
  }), allowedResponse, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)

  const missingConfirmation = response()
  middleware(request({ host: 'auth.seemplifyai.com' }), missingConfirmation, () => { nextCalls += 1 })
  assert.equal(missingConfirmation.statusCode, 400)

  const crossSite = response()
  middleware(request({
    host: 'auth.seemplifyai.com',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
    'x-seemplify-admin-action': 'reveal-azure-speech-key'
  }), crossSite, () => { nextCalls += 1 })
  assert.equal(crossSite.statusCode, 403)
  assert.equal(nextCalls, 1)
})

test('secret responses are non-cacheable and MIME-sniffing is disabled', () => {
  const result = response()
  let nextCalls = 0
  disableSecretResponseCaching(request(), result, () => { nextCalls += 1 })
  assert.match(result.headers['Cache-Control'], /no-store/u)
  assert.equal(result.headers.Pragma, 'no-cache')
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(nextCalls, 1)
})

test('Azure Speech reveal route and UI retain the privileged short-lived contract', () => {
  const route = fs.readFileSync(new URL('../src/routes/adminViews.js', import.meta.url), 'utf8')
  const view = fs.readFileSync(new URL('../src/views/admin/media-ai-integration.ejs', import.meta.url), 'utf8')
  assert.match(route, /\/api\/integrations\/media-ai\/azure-speech\/reveal[\s\S]*requireSuperAdmin[\s\S]*disableSecretResponseCaching[\s\S]*auditLog\('reveal_azure_speech_platform_credential'\)[\s\S]*requireSensitiveAdminAction\('reveal-azure-speech-key'\)/u)
  assert.match(view, /admin\?\.isSuperAdmin[\s\S]*Reveal saved key/u)
  assert.match(view, /X-Seemplify-Admin-Action[\s\S]*reveal-azure-speech-key/u)
  assert.match(view, /30_000/u)
  assert.match(view, /visibilitychange/u)
  assert.match(view, /pagehide/u)
})

test('Cloudinary environment-variable reveal uses the same privileged short-lived contract', () => {
  const route = fs.readFileSync(new URL('../src/routes/adminViews.js', import.meta.url), 'utf8')
  const view = fs.readFileSync(new URL('../src/views/admin/media-ai-integration.ejs', import.meta.url), 'utf8')
  assert.match(route, /\/api\/integrations\/media-ai\/cloudinary\/reveal[\s\S]*requireSuperAdmin[\s\S]*disableSecretResponseCaching[\s\S]*auditLog\('reveal_cloudinary_platform_credential'\)[\s\S]*requireSensitiveAdminAction\('reveal-cloudinary-url'\)/u)
  assert.match(view, /API environment variable[\s\S]*admin\?\.isSuperAdmin[\s\S]*Reveal saved variable/u)
  assert.match(view, /X-Seemplify-Admin-Action[\s\S]*reveal-cloudinary-url/u)
})
