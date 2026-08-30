import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import WebhookReadinessNonce from '../src/models/WebhookReadinessNonce.js'
import router from '../src/routes/platformIntegrations.js'
import {
  canonicalPlatformConfigurationRequest,
  deriveWorkspacePlatformIntegrationHmacKey,
  WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION,
  WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_SALT,
} from '../src/middleware/platformIntegrationAuth.js'

const routePath = '/api/internal/v1/platform-integrations/workspace/automation-access'

test('Workspace platform signing derivation matches the v1 cross-service contract vector', () => {
  assert.equal(
    deriveWorkspacePlatformIntegrationHmacKey(
      'workspace-platform-integration-contract-vector-2026',
    ).toString('hex'),
    '949486e0275ca3943a5c0bceb1cd7e3d1df269907e51d29eec99333110f9e8b0',
  )
})

function signedRequest(secret, nonce) {
  const body = { subject: 'identity-subject-1', organizationId: 'identity-org-1' }
  const timestamp = String(Date.now())
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const headers = {
    'x-seemplify-service': 'workspace',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-content-sha256': contentHash,
  }
  headers['x-seemplify-signature'] = crypto.createHmac('sha256', secret).update(
    canonicalPlatformConfigurationRequest({
      timestamp,
      nonce,
      service: 'workspace',
      method: 'POST',
      path: routePath,
      contentHash,
    }),
  ).digest('hex')
  return {
    body,
    method: 'POST',
    originalUrl: routePath,
    get(name) { return headers[String(name).toLowerCase()] },
  }
}

async function authenticate(middleware, request) {
  let statusCode = 200
  let responseBody
  let continued = false
  const response = {
    status(value) { statusCode = value; return this },
    json(value) { responseBody = value; return this },
  }
  await middleware(request, response, () => { continued = true })
  return { continued, statusCode, responseBody }
}

test('Workspace automation access accepts only the versioned protocol-derived key', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'seemplify-workspace-hmac-'))
  const dedicatedFile = path.join(temporaryDirectory, 'workspace-hmac-secret')
  const genericFile = path.join(temporaryDirectory, 'experience-hmac-secret')
  const dedicatedSecret = 'future-workspace-only-test-secret-material-1234567890'
  const genericSecret = 'generic-sibling-test-secret-material-1234567890'
  const oidcSecret = 'pairwise-workspace-oidc-secret-material-1234567890'
  await writeFile(dedicatedFile, dedicatedSecret, { mode: 0o600 })
  await writeFile(genericFile, genericSecret, { mode: 0o600 })

  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    dedicatedFile: process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE,
    genericFile: process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE,
    messagingOidcSecret: process.env.MESSAGING_OIDC_CLIENT_SECRET,
    derivationVersion: process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION,
  }
  const originalInit = WebhookReadinessNonce.init
  const originalCreate = WebhookReadinessNonce.create
  t.after(async () => {
    if (originalEnvironment.NODE_ENV === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalEnvironment.NODE_ENV
    if (originalEnvironment.dedicatedFile === undefined) delete process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE
    else process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE = originalEnvironment.dedicatedFile
    if (originalEnvironment.genericFile === undefined) delete process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE
    else process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE = originalEnvironment.genericFile
    if (originalEnvironment.messagingOidcSecret === undefined) delete process.env.MESSAGING_OIDC_CLIENT_SECRET
    else process.env.MESSAGING_OIDC_CLIENT_SECRET = originalEnvironment.messagingOidcSecret
    if (originalEnvironment.derivationVersion === undefined) delete process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION
    else process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION = originalEnvironment.derivationVersion
    WebhookReadinessNonce.init = originalInit
    WebhookReadinessNonce.create = originalCreate
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  WebhookReadinessNonce.init = async () => undefined
  WebhookReadinessNonce.create = async () => ({})
  process.env.NODE_ENV = 'production'
  process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE = genericFile
  delete process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE
  delete process.env.MESSAGING_OIDC_CLIENT_SECRET
  process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION = WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION

  const workspaceRoute = router.stack.find((layer) => layer.route?.path === '/workspace/automation-access')
  assert.ok(workspaceRoute, 'Workspace automation access route must exist')
  const authenticationMiddleware = workspaceRoute.route.stack[0].handle

  const genericOnly = await authenticate(
    authenticationMiddleware,
    signedRequest(genericSecret, 'generic-only-nonce-000001'),
  )
  assert.equal(genericOnly.continued, false)
  assert.equal(genericOnly.statusCode, 503)
  assert.equal(genericOnly.responseBody.error, 'Service authentication is unavailable.')

  process.env.MESSAGING_OIDC_CLIENT_SECRET = 'too-short'
  const weakInput = await authenticate(
    authenticationMiddleware,
    signedRequest(genericSecret, 'weak-oidc-input-nonce-0001'),
  )
  assert.equal(weakInput.continued, false)
  assert.equal(weakInput.statusCode, 503)

  process.env.MESSAGING_OIDC_CLIENT_SECRET = oidcSecret
  const siblingSignature = await authenticate(
    authenticationMiddleware,
    signedRequest(genericSecret, 'generic-sibling-nonce-0002'),
  )
  assert.equal(siblingSignature.continued, false)
  assert.equal(siblingSignature.statusCode, 401)

  const rawOidcSignature = await authenticate(
    authenticationMiddleware,
    signedRequest(oidcSecret, 'raw-oidc-secret-nonce-0003'),
  )
  assert.equal(rawOidcSignature.continued, false)
  assert.equal(rawOidcSignature.statusCode, 401)

  const wrongInfoKey = Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(oidcSecret, 'utf8'),
    Buffer.from(WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_SALT, 'utf8'),
    Buffer.from('seemplify:workspace-platform-integration:v2', 'utf8'),
    32,
  ))
  const wrongInfoSignature = await authenticate(
    authenticationMiddleware,
    signedRequest(wrongInfoKey, 'wrong-hkdf-info-nonce-0004'),
  )
  assert.equal(wrongInfoSignature.continued, false)
  assert.equal(wrongInfoSignature.statusCode, 401)

  process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION = 'v2'
  const unsupportedVersion = await authenticate(
    authenticationMiddleware,
    signedRequest(deriveWorkspacePlatformIntegrationHmacKey(oidcSecret), 'wrong-version-nonce-0005'),
  )
  assert.equal(unsupportedVersion.continued, false)
  assert.equal(unsupportedVersion.statusCode, 503)

  process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION = WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION
  const derivedOidcSignature = await authenticate(
    authenticationMiddleware,
    signedRequest(deriveWorkspacePlatformIntegrationHmacKey(oidcSecret), 'derived-oidc-nonce-0006'),
  )
  assert.equal(derivedOidcSignature.continued, true)
  assert.equal(derivedOidcSignature.statusCode, 200)

  process.env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE = dedicatedFile
  const fileOverrideSignature = await authenticate(
    authenticationMiddleware,
    signedRequest(deriveWorkspacePlatformIntegrationHmacKey(dedicatedSecret), 'file-override-nonce-0007'),
  )
  assert.equal(fileOverrideSignature.continued, true)
  assert.equal(fileOverrideSignature.statusCode, 200)
})
