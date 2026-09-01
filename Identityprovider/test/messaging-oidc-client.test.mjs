import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'
import { materializeProductionOidcClients } from '../src/config/productionOidcClients.js'
import { otpService } from '../src/services/otpService.js'
import {
  appRequiresOrganization,
  getHubApps,
  getOrganizationManagedHubApps,
  getOidcLaunchApiUrl,
  getOidcLaunchPath,
  isCommunityProductionReady
} from '../src/config/hubApps.js'
import {
  buildEmailVerificationPath,
  buildInteractionVerificationPath,
  getEmailVerificationErrorCode,
  getInteractionSignupCredentialError,
  isMatchingLoginInteraction,
  normalizeInteractionUid
} from '../src/utils/oidcInteractionResume.js'

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

test('local Workspace uses a loopback-only public client protected by PKCE', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const client = clients.find(item => item.client_id === 'messaging-local')

  assert.ok(client)
  assert.equal(client.token_endpoint_auth_method, 'none')
  assert.equal('client_secret' in client, false)
  assert.deepEqual(client.redirect_uri_patterns, [
    'http://localhost:3333/api/auth/oidc/callback',
    'http://127.0.0.1:3333/api/auth/oidc/callback'
  ])
  assert.equal(client.redirect_uri_patterns.some(uri => uri.startsWith('https://')), false)
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

test('Community has a dedicated OIDC client without changing Workspace identity', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const communityClient = clients.find(item => item.client_id === 'community')
  const workspaceClient = clients.find(item => item.client_id === 'messaging')

  assert.ok(communityClient)
  assert.ok(communityClient.redirect_uri_patterns.includes(
    'https://api-workspace.seemplifyai.com/api/auth/oidc/community/callback'
  ))
  assert.equal(communityClient.token_endpoint_auth_method, 'client_secret_basic')

  assert.ok(workspaceClient)
  assert.equal(workspaceClient.client_secret, 'messaging-development-secret')
  assert.ok(workspaceClient.redirect_uri_patterns.includes(
    'https://api-workspace.seemplifyai.com/api/auth/oidc/callback'
  ))
  assert.equal(workspaceClient.redirect_uri_patterns.some(uri => uri.includes('/community/')), false)
})

test('Community hub metadata is account-level and uses its own OIDC entrypoint', () => {
  const community = getHubApps().find(item => item.appId === 'community')
  const workspace = getHubApps().find(item => item.appId === 'messaging')

  assert.equal(community?.clientId, 'community')
  assert.equal(community?.organizationRequired, false)
  assert.equal(appRequiresOrganization(community), false)
  assert.equal(getOidcLaunchPath(community), '/api/auth/oidc/community/start')
  assert.equal(getOidcLaunchApiUrl(community, 'https://api.seemplifyai.com'), community?.apiUrl)

  assert.equal(workspace?.clientId, 'messaging')
  assert.equal(appRequiresOrganization(workspace), true)
  assert.equal(getOidcLaunchPath(workspace), '/api/auth/oidc/start')
  assert.equal(getOrganizationManagedHubApps().some(app => app.appId === 'community'), false)
  assert.equal(getOrganizationManagedHubApps().some(app => app.appId === 'messaging'), true)
})

test('Hub launch keeps legacy organization gates and explicitly bypasses them for account-level apps', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const homeTemplate = await readFile(new URL('../src/views/home.ejs', import.meta.url), 'utf8')
  const launchStart = source.indexOf("app.get('/launch/:appId'")
  const launchEnd = source.indexOf("app.get('/", launchStart + 1)
  const launchRoute = source.slice(launchStart, launchEnd > launchStart ? launchEnd : undefined)

  assert.match(source, /apps = apps\.filter\(app => !appRequiresOrganization\(app\)\)/)
  assert.match(launchRoute, /const organizationRequired = appRequiresOrganization\(app\)/)
  assert.match(launchRoute, /if \(organizationRequired && !currentOrgId\)/)
  assert.match(launchRoute, /if \(organizationRequired && !currentMember\)/)
  assert.match(launchRoute, /if \(organizationRequired && !memberCanAccessApp/)
  assert.match(homeTemplate, /Available to your account/)
  assert.match(homeTemplate, /apps && apps\.length > 0/)
  assert.doesNotMatch(homeTemplate, /before you can use any apps/)
})

test('Community OIDC secret is independently supplied by deployment', () => {
  const clients = [
    { client_id: 'messaging', client_secret: 'workspace-placeholder' },
    { client_id: 'community', client_secret: 'community-placeholder' }
  ]
  const configured = applyOidcClientSecretOverrides(clients, {
    COMMUNITY_OIDC_CLIENT_SECRET: 'production-community-secret'
  })

  assert.equal(configured[0].client_secret, 'workspace-placeholder')
  assert.equal(configured[1].client_secret, 'production-community-secret')
})

test('production Community stays dormant until its complete protected configuration is enabled', () => {
  assert.equal(isCommunityProductionReady({}), false)
  assert.equal(isCommunityProductionReady({
    COMMUNITY_PRODUCTION_ENABLED: 'true',
    COMMUNITY_URL: 'https://community.seemplifyai.com',
    COMMUNITY_API_URL: 'https://api-workspace.seemplifyai.com'
  }), false)
  assert.equal(isCommunityProductionReady({
    COMMUNITY_PRODUCTION_ENABLED: 'false',
    COMMUNITY_URL: 'https://community.seemplifyai.com',
    COMMUNITY_API_URL: 'https://api-workspace.seemplifyai.com',
    COMMUNITY_OIDC_CLIENT_SECRET: 'protected-secret'
  }), false)
  assert.equal(isCommunityProductionReady({
    COMMUNITY_PRODUCTION_ENABLED: 'true',
    COMMUNITY_URL: 'https://community.seemplifyai.com',
    COMMUNITY_API_URL: 'https://api-workspace.seemplifyai.com',
    COMMUNITY_OIDC_CLIENT_SECRET: 'protected-secret'
  }), true)
})

test('production client generation omits dormant Community and resolves its protected secret when enabled', () => {
  const clients = [
    { client_id: 'messaging', client_secret: 'development-workspace-secret' },
    {
      client_id: 'messaging-local',
      token_endpoint_auth_method: 'none',
      redirect_uri_patterns: ['http://localhost:3333/api/auth/oidc/callback']
    },
    { client_id: 'community', client_secret: 'development-community-secret' }
  ]
  const dormant = materializeProductionOidcClients(clients, {
    messaging: 'protected-workspace-secret'
  })
  assert.deepEqual(dormant.map(client => client.client_id), ['messaging', 'messaging-local'])
  assert.equal('client_secret' in dormant.find(client => client.client_id === 'messaging-local'), false)

  const protectedCommunitySecret = 'test-only-protected-community-value'
  const enabled = materializeProductionOidcClients(clients, {
    messaging: 'protected-workspace-secret',
    community: protectedCommunitySecret
  })
  const community = enabled.find(client => client.client_id === 'community')
  assert.equal(community?.client_secret, protectedCommunitySecret)
  assert.equal('idp_clients=ready'.includes(protectedCommunitySecret), false)
})

test('Hostinger wiring leaves Community optional until staged rollout is enabled', async () => {
  const compose = await readFile(new URL('../../deploy/hostinger/core-apps.compose.yml', import.meta.url), 'utf8')
  const generator = await readFile(new URL('../../deploy/hostinger/generate-idp-clients.sh', import.meta.url), 'utf8')
  const smoke = await readFile(new URL('../../deploy/hostinger/smoke-hostinger.sh', import.meta.url), 'utf8')

  assert.match(compose, /COMMUNITY_PRODUCTION_ENABLED: "\$\{COMMUNITY_PRODUCTION_ENABLED:-false\}"/)
  assert.match(compose, /COMMUNITY_URL: "\$\{COMMUNITY_URL:-\}"/)
  assert.match(compose, /COMMUNITY_API_URL: "\$\{COMMUNITY_API_URL:-\}"/)
  assert.match(compose, /COMMUNITY_OIDC_CLIENT_SECRET: "\$\{OIDC_COMMUNITY_SECRET:-\}"/)
  assert.match(generator, /OIDC_COMMUNITY_SECRET is required when COMMUNITY_PRODUCTION_ENABLED=true/)
  assert.match(generator, /unset OIDC_COMMUNITY_SECRET/)
  assert.match(generator, /materializeProductionOidcClients/)
  assert.match(smoke, /community production smoke skipped/)
  assert.match(smoke, /if \[\[ "\$\{community_smoke_enabled\}" == "true" \]\]; then/)
  assert.doesNotMatch(generator, /printf[^\n]*OIDC_COMMUNITY_SECRET/)
})

test('email verification preserves a valid OIDC interaction using internal paths only', () => {
  const path = buildEmailVerificationPath({
    accountId: 'account/with spaces',
    email: 'person+community@example.com',
    interactionUid: 'oidc_flow-123'
  })

  assert.equal(
    path,
    '/verify-email/account%2Fwith%20spaces?email=person%2Bcommunity%40example.com&interaction_uid=oidc_flow-123'
  )
  assert.equal(buildInteractionVerificationPath('oidc_flow-123'), '/interaction/oidc_flow-123/verify-email')
})

test('untrusted interaction values cannot become redirect targets', () => {
  assert.equal(normalizeInteractionUid('https://evil.example/path'), '')
  assert.equal(buildInteractionVerificationPath('//evil.example'), '')
  assert.equal(
    buildEmailVerificationPath({ accountId: 'abc', interactionUid: '../escape' }),
    '/verify-email/abc'
  )
})

test('OIDC continuation accepts only the matching pending login interaction', () => {
  assert.equal(isMatchingLoginInteraction('flow-123', {
    uid: 'flow-123',
    prompt: { name: 'login' }
  }), true)
  assert.equal(isMatchingLoginInteraction('flow-123', {
    uid: 'another-flow',
    prompt: { name: 'login' }
  }), false)
  assert.equal(isMatchingLoginInteraction('flow-123', {
    uid: 'flow-123',
    prompt: { name: 'consent' }
  }), false)
})

test('interaction signup enforces the browser credential contract on the server', () => {
  assert.equal(getInteractionSignupCredentialError({
    email: 'member@example.com',
    password: 'long-enough',
    confirmPassword: 'long-enough'
  }), '')
  assert.equal(getInteractionSignupCredentialError({
    email: 'not-an-email',
    password: 'long-enough',
    confirmPassword: 'long-enough'
  }), 'invalid_email')
  assert.equal(getInteractionSignupCredentialError({
    email: 'member@example.com',
    password: 'short',
    confirmPassword: 'short'
  }), 'weak_password')
  assert.equal(getInteractionSignupCredentialError({
    email: 'member@example.com',
    password: 'long-enough',
    confirmPassword: 'different-value'
  }), 'passwords_mismatch')
})

test('OTP service failures map to stable verification page errors', () => {
  assert.equal(getEmailVerificationErrorCode('Invalid OTP'), 'invalid_code')
  assert.equal(getEmailVerificationErrorCode('OTP has expired'), 'expired_code')
  assert.equal(getEmailVerificationErrorCode('No OTP found or expired'), 'expired_code')
  assert.equal(getEmailVerificationErrorCode('Too many invalid attempts'), 'too_many_attempts')
  assert.equal(getEmailVerificationErrorCode('Account locked. Try again later'), 'account_locked')
})

test('active verification OTPs can be reused across an interrupted OIDC login', () => {
  const originalStore = global.otpStore
  global.otpStore = new Map()

  try {
    const accountId = 'oidc-resume-account'
    otpService.storeOTP(accountId, '123456', 'email_verification')
    assert.equal(otpService.hasActiveOTP(accountId, 'email_verification'), true)

    const stored = global.otpStore.get(`${accountId}_email_verification`)
    stored.createdAt = Date.now() - otpService.otpExpiry - 1
    assert.equal(otpService.hasActiveOTP(accountId, 'email_verification'), false)
    assert.equal(global.otpStore.has(`${accountId}_email_verification`), false)
  } finally {
    global.otpStore = originalStore
  }
})

test('interaction signup and verification are wired to resume oidc-provider', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const signupStart = source.indexOf("app.post('/interaction/:uid/signup'")
  const verificationStart = source.indexOf("app.post('/interaction/:uid/verify-email'")
  const standaloneVerificationStart = source.indexOf("app.post('/verify-email'", verificationStart)

  assert.ok(signupStart >= 0)
  assert.ok(verificationStart > signupStart)
  assert.ok(standaloneVerificationStart > verificationStart)

  const signupRoute = source.slice(signupStart, verificationStart)
  const interactionVerificationRoute = source.slice(verificationStart, standaloneVerificationStart)
  assert.ok(signupRoute.indexOf('requireMatchingLoginInteraction(req, res)') < signupRoute.indexOf('Account.create'))
  assert.match(signupRoute, /buildPathWithQuery\(`\/signup\/\$\{interactionUid\}`,[\s\S]*attributionQuery/)
  assert.doesNotMatch(signupRoute, /buildPathWithQuery\([^\n]*req\.body/)
  assert.match(signupRoute, /buildEmailVerificationPath\([\s\S]*interactionUid/)
  assert.match(interactionVerificationRoute, /requireMatchingLoginInteraction\(req, res\)/)
  assert.match(interactionVerificationRoute, /verification\.verified/)
  assert.match(interactionVerificationRoute, /provider\.interactionFinished\(req, res/)
  assert.match(source, /app\.get\('\/verify-email\/:accountId'[\s\S]*Cache-Control', 'no-store'/)
  assert.match(source, /<meta name="referrer" content="no-referrer">/)
})

test('OIDC login cannot bypass pending email verification and inactive apps cannot launch', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const loginStart = source.indexOf("app.post('/interaction/:uid/login'")
  const signupStart = source.indexOf("app.post('/interaction/:uid/signup'", loginStart)
  const loginRoute = source.slice(loginStart, signupStart)
  const launchStart = source.indexOf("app.get('/launch/:appId'")
  const launchEnd = source.indexOf("app.get('/", launchStart + 1)
  const launchRoute = source.slice(launchStart, launchEnd > launchStart ? launchEnd : undefined)

  assert.ok(loginRoute.indexOf('requireMatchingLoginInteraction(req, res)') < loginRoute.indexOf('Account.findOne'))
  assert.match(loginRoute, /if \(!acc\.emailVerified\)/)
  assert.match(loginRoute, /otpService\.hasActiveOTP/)
  assert.match(loginRoute, /buildEmailVerificationPath/)
  assert.match(launchRoute, /if \(!app \|\| !app\.isActive\)/)
})
