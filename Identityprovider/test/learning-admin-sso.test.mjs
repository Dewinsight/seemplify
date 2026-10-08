import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildLearningAdminLaunchUrl, resolveLearningAdminSsoSecret } from '../src/services/learningAdminSsoService.js'
import { verifyLearningAdminSsoToken } from '../../seemplify-learning/src/services/learningAdminSsoToken.js'

const secret = 'learning-admin-contract-secret-for-tests'
const account = {
  sub: 'central-admin-123', email: 'admin@example.test', profile: { name: 'Central Admin' },
  isSuperAdmin: true, isSystemAdmin: true, hasAdminAccess: () => true
}

test('central admin launch is accepted by Learning and targets its admin handoff', async () => {
  const oldSecret = process.env.OIDC_LEARNING_SECRET
  const oldUrl = process.env.SEEMPLIFY_LEARNING_URL
  process.env.OIDC_LEARNING_SECRET = secret
  process.env.SEEMPLIFY_LEARNING_URL = 'https://learning.example.test'
  try {
    for (const isSuperAdmin of [true, false]) {
      const url = new URL(await buildLearningAdminLaunchUrl({ ...account, isSuperAdmin }))
      assert.equal(url.origin, 'https://learning.example.test')
      assert.equal(url.pathname, '/auth/idp-admin')
      const claims = verifyLearningAdminSsoToken(url.searchParams.get('token'), { secret })
      assert.equal(claims.sub, account.sub)
      assert.equal(claims.email, account.email)
      assert.equal(claims.isSuperAdmin, isSuperAdmin)
      assert.equal(claims.isSystemAdmin, true)
      assert.equal(claims.exp - claims.iat, 60)
    }
    await assert.rejects(buildLearningAdminLaunchUrl({ ...account, hasAdminAccess: () => false }))
    await assert.rejects(buildLearningAdminLaunchUrl({ ...account, isSuperAdmin: false, isSystemAdmin: false }))
  } finally {
    if (oldSecret === undefined) delete process.env.OIDC_LEARNING_SECRET
    else process.env.OIDC_LEARNING_SECRET = oldSecret
    if (oldUrl === undefined) delete process.env.SEEMPLIFY_LEARNING_URL
    else process.env.SEEMPLIFY_LEARNING_URL = oldUrl
  }
})

test('Learning uses its registered client secret and fails closed for missing configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-admin-'))
  const clients = path.join(root, 'clients.json')
  try {
    fs.writeFileSync(clients, JSON.stringify({ clients: [
      { client_id: 'smarthr-backend', client_secret: 'different-app-secret' },
      { client_id: 'seemplify-learning', client_secret: secret }
    ] }))
    assert.equal(resolveLearningAdminSsoSecret({ CLIENTS_CONFIG: clients }), secret)
    assert.equal(resolveLearningAdminSsoSecret({ CLIENTS_CONFIG: clients, LEARNING_ADMIN_SSO_SECRET: 'dedicated' }), 'dedicated')
    assert.equal(resolveLearningAdminSsoSecret({ CLIENTS_CONFIG: path.join(root, 'missing') }), '')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
