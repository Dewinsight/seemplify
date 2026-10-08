import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { verifyLearningAdminSsoToken } from '../src/services/learningAdminSsoToken.js'
import { createLearningAdminSsoHandler } from '../src/routes/idpAdminSso.js'
import { provisionIdpLearningAdmin } from '../src/services/idpLearningSyncService.js'
import { Account } from '../src/models/Account.js'

const secret = 'learning-admin-contract-secret-for-tests'
const now = Math.floor(Date.now() / 1000)
const claims = {
  iss: 'aiin-idp-admin', aud: 'learning-admin', sub: 'central-admin-123', email: 'admin@example.test',
  name: 'Central Admin', email_verified: true, iat: now, exp: now + 60,
  isSystemAdmin: true, isSuperAdmin: true, jti: 'launch-123'
}
function token(payload = claims, header = { alg: 'HS256', typ: 'JWT' }) {
  const body = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
}

test('rejects forged, wrong-app, non-admin, expired, missing-time, and future launch claims', () => {
  assert.equal(verifyLearningAdminSsoToken(token(), { secret, now }).sub, claims.sub)
  for (const patch of [
    { aud: 'experience-admin' }, { iss: 'another-issuer' }, { exp: now }, { iat: now + 31 },
    { exp: now + 121 }, { iat: undefined }, { exp: undefined }, { email_verified: false },
    { isSuperAdmin: false, isSystemAdmin: false }, { sub: '' }, { email: '' }, { jti: '' }, { nbf: now + 1 }
  ]) assert.throws(() => verifyLearningAdminSsoToken(token({ ...claims, ...patch }), { secret, now }))
  assert.throws(() => verifyLearningAdminSsoToken(token(), { secret: 'wrong-secret', now }))
  assert.throws(() => verifyLearningAdminSsoToken(token(claims, { alg: 'none', typ: 'JWT' }), { secret, now }))
  assert.throws(() => verifyLearningAdminSsoToken('not-a-jwt', { secret, now }))
})

function sessionRequest(launch) {
  const req = { query: { token: launch }, session: { accountId: 'old-session' } }
  req.session.regenerate = callback => {
    req.session = { save: callback => callback() }
    callback()
  }
  return req
}
function response() {
  return {
    headers: {}, set(key, value) { this.headers[key] = value; return this },
    status(value) { this.statusCode = value; return this },
    send(value) { this.body = value; return this }, redirect(value) { this.destination = value; return this }
  }
}

test('handoff regenerates the session, saves the central identity and goes directly to /admin; replay is denied', async () => {
  const consumed = new Set()
  let provisions = 0
  const handler = createLearningAdminSsoHandler({
    verify: value => verifyLearningAdminSsoToken(value, { secret, now }),
    consume: async value => {
      if (consumed.has(value.jti)) throw Object.assign(new Error('Replay'), { code: 11000 })
      consumed.add(value.jti)
    },
    provision: async value => { provisions++; return { sub: value.sub, email: value.email } }
  })
  const req = sessionRequest(token()), res = response()
  await handler(req, res)
  assert.equal(req.session.accountId, claims.sub)
  assert.equal(req.session.idpIdentity.sub, claims.sub)
  assert.equal(res.destination, '/admin')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  const replay = response()
  await handler(sessionRequest(token()), replay)
  assert.equal(replay.statusCode, 403)
  assert.equal(provisions, 1)
  assert.equal(replay.destination, undefined)
})

test('central roles are mirrored, including super-admin demotion, without enabling product passwords', async () => {
  const original = Account.findOne
  const account = { _id: 'learning-123', sub: claims.sub, idpSubject: claims.sub, email: claims.email,
    profile: {}, passwordHash: 'old-product-password', authentication: {}, save: async () => {} }
  Account.findOne = async () => account
  try {
    await provisionIdpLearningAdmin(claims)
    assert.equal(account.learningRole, 'super_admin')
    assert.equal(account.isSuperAdmin, true)
    assert.equal(account.authentication.passwordEnabled, false)
    await provisionIdpLearningAdmin({ ...claims, isSuperAdmin: false })
    assert.equal(account.learningRole, 'admin')
    assert.equal(account.isSuperAdmin, false)
    assert.equal(account.isSystemAdmin, true)
    assert.equal(account.authentication.passwordEnabled, false)
    await assert.rejects(provisionIdpLearningAdmin({ ...claims, isSuperAdmin: false, isSystemAdmin: false }))
    account.idpSubject = 'other-identity'
    await assert.rejects(provisionIdpLearningAdmin(claims), { code: 'IDP_SUBJECT_CONFLICT' })
  } finally { Account.findOne = original }
})

test('a failed session save never redirects into an unauthenticated admin panel', async () => {
  const req = sessionRequest(token())
  req.session.regenerate = callback => {
    req.session = { save: callback => callback(new Error('Store unavailable')) }
    callback()
  }
  const res = response()
  await createLearningAdminSsoHandler({ verify: () => claims, consume: async () => {}, provision: async () => claims })(req, res)
  assert.equal(res.statusCode, 403)
  assert.equal(res.destination, undefined)
})
