import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { Provider } from 'oidc-provider'
import { MongoAdapter } from '../src/adapter/mongoAdapter.js'
import {
  WORKSPACE_REFRESH_TTL_SECONDS,
  workspaceOidcAccountSessionAllowed,
  workspaceOidcSessionPolicy,
} from '../src/config/workspaceOidcSessionPolicy.js'

const DAY = 24 * 60 * 60

// Exercise the production adapter contract with a disposable in-memory model,
// and the real provider's token endpoint, expiry checks and replay revocation.
function memoryModel(records) {
  const find = (filter) => [...records.values()].find(row => (
    Object.entries(filter).every(([key, value]) => row[key] === value)
  ))
  return {
    updateOne: async (filter, update, options = {}) => {
      const existing = find(filter)
      if (!existing && !options.upsert) return
      const row = { ...existing, ...(update.$set || update) }
      records.set(row._id, structuredClone(row))
    },
    findById: id => ({ lean: async () => structuredClone(records.get(id)) }),
    findOne: filter => ({ lean: async () => structuredClone(find(filter)) }),
    deleteOne: async (filter) => {
      const row = find(filter)
      if (row) records.delete(row._id)
    },
    deleteMany: async (filter) => {
      for (const [id, row] of records) {
        if (Object.entries(filter).every(([key, value]) => row[key] === value)) records.delete(id)
      }
    },
  }
}

async function fixture(t, { authorizationFlow = false } = {}) {
  const stores = new Map()
  class TestAdapter extends MongoAdapter {
    constructor(name) {
      super(name)
      if (!stores.has(name)) stores.set(name, new Map())
      this.Model = memoryModel(stores.get(name))
    }
  }
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  }))
  const issuer = `http://127.0.0.1:${server.address().port}`
  const active = { value: true }
  const account = { security: {} }
  let productionConfiguration
  let productionConsent
  if (authorizationFlow) {
    // Execute the checked-in provider configuration and trusted-consent branch,
    // so these tests cover /auth scope filtering and real interaction resumes.
    const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
    const configStart = source.indexOf('const config = {') + 'const config = '.length
    const configEnd = source.indexOf('\nconst provider = new Provider', configStart)
    assert.ok(configStart > 0 && configEnd > configStart)
    const catalog = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8'))
    const clients = catalog.clients.filter(client => ['messaging', 'messaging-local'].includes(client.client_id))
      .map(client => ({ ...client, ...(client.client_secret ? { client_secret: 'test-client-secret' } : {}) }))
    productionConfiguration = vm.runInThisContext(`(({ workspaceOidcSessionPolicy,
      workspaceOidcAccountSessionAllowed, MongoAdapter, configuredOidcClients,
      isProduction, process, console }) => (${source.slice(configStart, configEnd).trim()}))`)({
      workspaceOidcSessionPolicy,
      workspaceOidcAccountSessionAllowed,
      MongoAdapter: TestAdapter,
      configuredOidcClients: clients,
      isProduction: false,
      process: { env: { OIDC_COOKIE_SECRET: 'test-cookie-key' } },
      console: { log() {}, warn() {} },
    })
    const consentStart = source.indexOf("if (prompt.name === 'consent')")
    const resultStart = source.indexOf('      const result = {', consentStart)
    const resultEnd = source.indexOf('\n      return', resultStart)
    assert.ok(consentStart > 0 && resultStart > consentStart && resultEnd > resultStart)
    productionConsent = vm.runInThisContext(`(async (provider, req, res) => {${source.slice(resultStart, resultEnd)}\n})`)
  }
  const provider = new Provider(issuer, {
    ...workspaceOidcSessionPolicy,
    adapter: TestAdapter,
    cookies: { keys: ['test-cookie-key'] },
    clients: ['messaging', 'messaging-local', 'other-product'].map(client_id => ({
      client_id,
      ...(client_id === 'messaging' ? { client_secret: 'test-client-secret' } : {}),
      token_endpoint_auth_method: client_id === 'messaging' ? 'client_secret_basic' : 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: [`${issuer}/callback`],
    })),
    features: { devInteractions: { enabled: false }, revocation: { enabled: true } },
    scopes: ['openid', 'offline_access'],
    ...(productionConfiguration || {}),
    findAccount: async (ctx, id, token) => active.value && workspaceOidcAccountSessionAllowed(ctx, account, token)
      ? { accountId: id, claims: async () => ({ sub: id }) }
      : undefined,
  })
  const interactionPrompts = []
  const callback = provider.callback()
  server.on('request', async (req, res) => {
    if (!authorizationFlow || !req.url.startsWith('/interaction/')) return callback(req, res)
    try {
      const details = await provider.interactionDetails(req, res)
      interactionPrompts.push(details.prompt.name)
      if (details.prompt.name === 'login') {
        await provider.interactionFinished(req, res, { login: { accountId: 'member-one' } }, {
          mergeWithLastSubmission: false,
        })
      } else if (details.prompt.name === 'consent') {
        await productionConsent(provider, req, res)
      } else {
        throw new Error(`Unexpected interaction ${details.prompt.name}`)
      }
    } catch (error) {
      res.statusCode = 500
      res.end(error.stack)
    }
  })
  const verifier = 'test-pkce-code-verifier-which-is-long-enough-for-the-spec'
  const redirectUri = authorizationFlow ? 'http://localhost:3333/api/auth/oidc/callback' : `${issuer}/callback`
  const seed = async (clientId, kind = 'RefreshToken') => {
    const client = await provider.Client.find(clientId)
    const grant = new provider.Grant({ clientId, accountId: 'member-one' })
    grant.addOIDCScope('openid offline_access')
    const grantId = await grant.save()
    const token = new provider[kind]({
      client,
      accountId: 'member-one',
      grantId,
      scope: 'openid offline_access',
      expiresWithSession: false,
      gty: 'authorization_code',
      authTime: Math.floor(Date.now() / 1000),
      ...(kind === 'AuthorizationCode' ? {
        redirectUri,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
      } : {}),
    })
    return { token: await token.save(), grantId }
  }
  const exchange = async (clientId, params) => {
    const form = new URLSearchParams(params)
    const headers = { 'content-type': 'application/x-www-form-urlencoded' }
    if (clientId === 'messaging') {
      headers.authorization = `Basic ${Buffer.from('messaging:test-client-secret').toString('base64')}`
    } else {
      form.set('client_id', clientId)
    }
    const response = await fetch(`${issuer}/token`, { method: 'POST', headers, body: form })
    return { status: response.status, body: await response.json() }
  }
  const userinfo = async (accessToken) => fetch(`${issuer}/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const refresh = (clientId, token) => exchange(clientId, { grant_type: 'refresh_token', refresh_token: token })
  const exchangeCode = (clientId, code) => exchange(clientId, {
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri,
  })
  const cookies = new Map()
  const authorize = async (clientId, prompt) => {
    interactionPrompts.length = 0
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid email profile organizations teams offline_access',
      state: 'test-state', nonce: 'test-nonce', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(prompt ? { prompt } : {}),
      ...(prompt?.includes('login') ? { max_age: '0' } : {}),
    })
    let url = `${issuer}/auth?${params}`
    for (let hop = 0; hop < 12; hop++) {
      const response = await fetch(url, {
        redirect: 'manual', headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      })
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0]
        const split = pair.indexOf('=')
        cookies.set(pair.slice(0, split), pair.slice(split + 1))
      }
      const location = response.headers.get('location')
      assert.ok(location, `Authorization stopped at ${url}: ${response.status} ${await response.text()}`)
      const next = new URL(location, issuer)
      if (next.href.startsWith(redirectUri)) {
        assert.equal(next.searchParams.get('error'), null, next.search)
        assert.equal(next.searchParams.get('state'), 'test-state')
        assert.ok(next.searchParams.get('code'))
        return { code: next.searchParams.get('code'), prompts: [...interactionPrompts] }
      }
      assert.equal(next.origin, issuer)
      url = next.href
    }
    assert.fail('Authorization did not finish after 12 redirects')
  }
  return { provider, seed, refresh, exchangeCode, authorize, stores, active, account, userinfo }
}

for (const clientId of ['messaging', 'messaging-local']) {
  test(`${clientId} remains signed in past the original grant expiry and expires after 30 idle days`, async (t) => {
    let now = Date.now()
    t.mock.method(Date, 'now', () => now)
    const { provider, seed, refresh } = await fixture(t)
    const original = await seed(clientId)
    const first = await provider.RefreshToken.find(original.token)
    assert.equal(first.remainingTTL, WORKSPACE_REFRESH_TTL_SECONDS)
    const initialGrant = await provider.Grant.find(original.grantId)
    assert.equal(initialGrant.remainingTTL, WORKSPACE_REFRESH_TTL_SECONDS)

    now += 29 * DAY * 1000
    const renewal = await refresh(clientId, original.token)
    assert.equal(renewal.status, 200, JSON.stringify(renewal.body))
    assert.notEqual(renewal.body.refresh_token, original.token)
    assert.equal((await provider.RefreshToken.find(renewal.body.refresh_token)).remainingTTL, 30 * DAY)
    assert.equal((await provider.Grant.find(original.grantId)).remainingTTL, 30 * DAY)

    now += 16 * DAY * 1000
    const afterOriginalExpiry = await refresh(clientId, renewal.body.refresh_token)
    assert.equal(afterOriginalExpiry.status, 200, JSON.stringify(afterOriginalExpiry.body))

    now += 31 * DAY * 1000
    const idleExpiry = await refresh(clientId, afterOriginalExpiry.body.refresh_token)
    assert.equal(idleExpiry.status, 400)
    assert.equal(idleExpiry.body.error, 'invalid_grant')
    assert.equal((await provider.RefreshToken.find(afterOriginalExpiry.body.refresh_token, {
      ignoreExpiration: true,
    })).isExpired, true)
  })
}

test('reusing a rotated Workspace refresh credential revokes its successor', async (t) => {
  const { seed, refresh } = await fixture(t)
  const original = await seed('messaging')
  const renewal = await refresh('messaging', original.token)
  assert.equal(renewal.status, 200, JSON.stringify(renewal.body))
  const replay = await refresh('messaging', original.token)
  assert.equal(replay.status, 400)
  assert.equal(replay.body.error, 'invalid_grant')
  const revokedSuccessor = await refresh('messaging', renewal.body.refresh_token)
  assert.equal(revokedSuccessor.status, 400)
  assert.equal(revokedSuccessor.body.error, 'invalid_grant')
})

test('revoked grants and unavailable accounts cannot be renewed', async (t) => {
  const { provider, seed, refresh, active } = await fixture(t)
  const original = await seed('messaging')
  const grant = await provider.Grant.find(original.grantId)
  await grant.destroy()
  assert.equal((await refresh('messaging', original.token)).body.error, 'invalid_grant')
  assert.equal(await provider.Grant.find(original.grantId), undefined)

  const other = await seed('messaging-local')
  active.value = false
  const denied = await refresh('messaging-local', other.token)
  assert.equal(denied.status, 400)
  assert.equal(denied.body.error, 'invalid_grant')
})

test('other products retain the existing 14-day grant and public refresh lifetime', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const { provider, seed, refresh } = await fixture(t)
  const original = await seed('other-product')
  assert.equal((await provider.RefreshToken.find(original.token)).remainingTTL, 14 * DAY)
  assert.equal((await provider.Grant.find(original.grantId)).remainingTTL, 14 * DAY)
  now += DAY * 1000
  const renewal = await refresh('other-product', original.token)
  assert.equal(renewal.status, 200, JSON.stringify(renewal.body))
  assert.equal((await provider.RefreshToken.find(renewal.body.refresh_token)).remainingTTL, 13 * DAY)
  assert.equal((await provider.Grant.find(original.grantId)).remainingTTL, 13 * DAY)
})

test('central sign-out invalidates rotated Workspace credentials while a later sign-in succeeds', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const { seed, refresh, account, userinfo } = await fixture(t)
  const original = await seed('messaging')
  now += DAY * 1000
  const renewed = await refresh('messaging', original.token)
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body))
  assert.equal((await userinfo(renewed.body.access_token)).status, 200)
  now += 60_000
  // The Hub's /logout writes this field on the canonical Account document.
  account.security.sessionInvalidBefore = new Date(now)
  assert.equal((await userinfo(renewed.body.access_token)).status, 401)
  assert.equal((await refresh('messaging', renewed.body.refresh_token)).body.error, 'invalid_grant')
  now += 1000
  const newSignIn = await seed('messaging')
  assert.equal((await refresh('messaging', newSignIn.token)).status, 200)
})

test('central sign-out binding preserves other products and fresh authorization interactions', () => {
  const account = { security: { sessionInvalidBefore: new Date(2_000_000) } }
  assert.equal(workspaceOidcAccountSessionAllowed(null, account, {
    clientId: 'other-product', authTime: 1000,
  }), true)
  assert.equal(workspaceOidcAccountSessionAllowed({ oidc: { client: { clientId: 'messaging' } } }, account), true)
})

test('PKCE code exchange issues a 30-day Workspace refresh token and rejects code replay', async (t) => {
  const { provider, seed, exchangeCode, refresh } = await fixture(t)
  const authorization = await seed('messaging-local', 'AuthorizationCode')
  const response = await exchangeCode('messaging-local', authorization.token)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal((await provider.RefreshToken.find(response.body.refresh_token)).remainingTTL, 30 * DAY)
  const replay = await exchangeCode('messaging-local', authorization.token)
  assert.equal(replay.status, 400)
  assert.equal(replay.body.error, 'invalid_grant')
  assert.equal((await refresh('messaging-local', response.body.refresh_token)).body.error, 'invalid_grant')
})

test('the Mongo adapter exposes existing consumed markers through all provider lookups', async () => {
  const adapter = new MongoAdapter('AuthorizationCode')
  const records = new Map()
  adapter.Model = memoryModel(records)
  await adapter.upsert('code-one', { userCode: 'user-code', uid: 'session-uid' }, 60)
  await adapter.consume('code-one')
  const byId = await adapter.find('code-one')
  assert.ok(byId.consumed > 0)
  assert.deepEqual(await adapter.findByUserCode('user-code'), byId)
  assert.deepEqual(await adapter.findByUid('session-uid'), byId)
  assert.equal(await adapter.find('missing'), undefined)
})

for (const clientId of ['messaging', 'messaging-local']) {
  test(`${clientId} authorization grants refresh credentials for fresh, returning SSO, and forced sign-in`, async (t) => {
    const { provider, authorize, exchangeCode } = await fixture(t, { authorizationFlow: true })
    for (const [prompt, expectedPrompts] of [
      ['consent', ['login', 'consent']],
      ['consent', ['consent']],
      ['login consent', ['login', 'consent']],
    ]) {
      const authorization = await authorize(clientId, prompt)
      assert.deepEqual(authorization.prompts, expectedPrompts)
      const response = await exchangeCode(clientId, authorization.code)
      assert.equal(response.status, 200, JSON.stringify(response.body))
      assert.ok(response.body.refresh_token)
      assert.ok(response.body.scope.split(' ').includes('offline_access'))
      assert.equal((await provider.RefreshToken.find(response.body.refresh_token)).remainingTTL, 30 * DAY)
    }
  })
}

test('the production authorization configuration strips offline access when consent is omitted', async (t) => {
  const { authorize, exchangeCode } = await fixture(t, { authorizationFlow: true })
  const authorization = await authorize('messaging')
  const response = await exchangeCode('messaging', authorization.code)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(response.body.refresh_token, undefined)
  assert.equal(response.body.scope.split(' ').includes('offline_access'), false)
})
