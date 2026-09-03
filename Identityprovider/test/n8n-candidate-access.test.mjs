import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getN8nCandidateContext, hasN8nCandidateAccess } from '../src/utils/n8nCandidateAccess.js'
import {
  appRequiresOrganization, getOrganizationScopedAutomationSurfaceUrls,
  getOrganizationScopedDirectLaunchUrl, resolveAutomationHubSurface,
  withN8nCandidateReadiness,
} from '../src/config/hubApps.js'
import { normalizeAppAccess, memberCanAccessApp } from '../src/utils/appAccess.js'

const now = Date.parse('2026-09-03T10:00:00.000Z')
const releaseSha = '0123456789abcdef0123456789abcdef01234567'
const subject = '507f1f77bcf86cd799439010'
const organizationId = '507f1f77bcf86cd799439011'
const accountId = '507f1f77bcf86cd799439012'
const context = { subject, organizationId }
const fixture = () => ({
  expiresAt: '2026-09-03T11:00:00.000Z', releaseSha,
  subjects: [{ subject, organizationId }],
})
const environment = (access = fixture()) => ({
  NODE_ENV: 'production', N8N_HUB_ENABLED: 'false', N8N_INTEGRATION_ENABLED: 'true',
  AUTOMATIONS_URL: 'https://automations.seemplifyai.com',
  WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/automations?editor=standalone',
  N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'disposable-unit-test-value',
  N8N_CANDIDATE_RELEASE_SHA: releaseSha, N8N_CANDIDATE_ACCESS_JSON: JSON.stringify(access),
})
const accountFixture = () => ({ _id: accountId, sub: subject, emailVerified: true, currentOrganization: organizationId })
const organizationFixture = () => ({ _id: organizationId, name: 'Fixture organization', members: [{ account: accountId, status: 'active' }] })
const appFixture = () => ({ appId: 'automation-hub', name: 'Automations', isActive: false, authType: 'direct', url: 'https://workspace.seemplifyai.com/automations?editor=standalone' })

test('exact subject plus organization is allowed only in the configured candidate release window', () => {
  assert.equal(hasN8nCandidateAccess(context, environment(), now), true)
})

const invalidAccess = [
  ['null document', () => null], ['array document', () => []], ['string document', () => 'enabled'],
  ['unknown document field', value => ({ ...value, enabled: true })],
  ['missing expiry', value => ({ ...value, expiresAt: undefined })],
  ['expired timestamp', value => ({ ...value, expiresAt: '2026-09-03T09:00:00Z' })],
  ['expiry equal to now', value => ({ ...value, expiresAt: '2026-09-03T10:00:00Z' })],
  ['over 24 hour duration', value => ({ ...value, expiresAt: '2026-09-04T10:00:00.001Z' })],
  ['non UTC expiry', value => ({ ...value, expiresAt: '2026-09-03T11:00:00+00:00' })],
  ['numeric expiry', value => ({ ...value, expiresAt: now + 3600000 })],
  ['invalid timestamp', value => ({ ...value, expiresAt: '2026-09-03T25:00:00Z' })],
  ['missing release', value => ({ ...value, releaseSha: undefined })],
  ['another release', value => ({ ...value, releaseSha: 'f'.repeat(40) })],
  ['uppercase release', value => ({ ...value, releaseSha: releaseSha.toUpperCase() })],
  ['missing subjects', value => ({ ...value, subjects: undefined })],
  ['no subjects', value => ({ ...value, subjects: [] })],
  ['too many subjects', value => ({ ...value, subjects: Array.from({ length: 101 }, () => ({ ...context })) })],
  ['null subject entry', value => ({ ...value, subjects: [null] })],
  ['array subject entry', value => ({ ...value, subjects: [[subject, organizationId]] })],
  ['extra subject field', value => ({ ...value, subjects: [{ ...context, admin: true }] })],
  ['missing subject field', value => ({ ...value, subjects: [{ organizationId }] })],
  ['wildcard subject', value => ({ ...value, subjects: [{ ...context, subject: '*' }] })],
  ['wildcard organization', value => ({ ...value, subjects: [{ ...context, organizationId: '*' }] })],
  ['whitespace subject', value => ({ ...value, subjects: [{ ...context, subject: ` ${subject}` }] })],
  ['nonstring subject', value => ({ ...value, subjects: [{ ...context, subject: [subject] }] })],
  ['nonstring organization', value => ({ ...value, subjects: [{ ...context, organizationId: [organizationId] }] })],
  ['uppercase organization', value => ({ ...value, subjects: [{ ...context, organizationId: organizationId.toUpperCase() }] })],
  ['invalid second entry', value => ({ ...value, subjects: [context, { subject: '*', organizationId }] })],
]
for (const [name, mutate] of invalidAccess) test(`candidate denies ${name}`, () => {
  assert.equal(hasN8nCandidateAccess(context, environment(mutate(fixture())), now), false)
})
for (const [name, invalid] of [
  ['missing', undefined], ['null', null], ['array', []], ['empty', {}],
  ['wrong subject', { ...context, subject: 'other-user' }],
  ['wrong org', { ...context, organizationId: 'f'.repeat(24) }],
  ['subject array', { ...context, subject: [subject] }],
  ['organization array', { ...context, organizationId: [organizationId] }],
]) test(`candidate denies ${name} server context`, () => {
  assert.equal(hasN8nCandidateAccess(invalid, environment(), now), false)
})

test('candidate refuses a cross-product subject and organization combination', () => {
  const access = fixture()
  access.subjects = [{ subject, organizationId: 'f'.repeat(24) }, { subject: 'other-user', organizationId }]
  assert.equal(hasN8nCandidateAccess(context, environment(access), now), false)
})
test('candidate accepts exact 24 hour expiry and UTC seconds without milliseconds', () => {
  assert.equal(hasN8nCandidateAccess(context, environment({ ...fixture(), expiresAt: '2026-09-04T10:00:00Z' }), now), true)
})
test('candidate rejects malformed or oversized operational JSON without throwing', () => {
  for (const raw of ['{', '', ' '.repeat(65537), null, {}]) {
    assert.equal(hasN8nCandidateAccess(context, { ...environment(), N8N_CANDIDATE_ACCESS_JSON: raw }, now), false)
  }
})
test('candidate requires independent exact release binding', () => {
  for (const release of [undefined, '', 'f'.repeat(40), releaseSha.toUpperCase(), `${releaseSha} `]) {
    assert.equal(hasN8nCandidateAccess(context, { ...environment(), N8N_CANDIDATE_RELEASE_SHA: release }, now), false)
  }
})
test('candidate rejects invalid clocks', () => {
  for (const invalid of [NaN, Infinity, '2026-09-03']) assert.equal(hasN8nCandidateAccess(context, environment(), invalid), false)
})
test('candidate rejects calendar overflow even when Date.parse normalizes it', () => {
  assert.equal(hasN8nCandidateAccess(context, environment({ ...fixture(), expiresAt: '2026-02-30T11:00:00Z' }), Date.parse('2026-03-02T10:00:00Z')), false)
})

test('canonical verified active membership builds the exact candidate context', () => {
  assert.deepEqual(getN8nCandidateContext(accountFixture(), organizationFixture()), context)
})
test('populated account and membership IDs build the same exact context', () => {
  const account = { ...accountFixture(), currentOrganization: { _id: organizationId } }
  const organization = { ...organizationFixture(), members: [{ account: { _id: accountId }, status: 'active' }] }
  assert.deepEqual(getN8nCandidateContext(account, organization), context)
})
for (const [name, mutateAccount, mutateOrg] of [
  ['no account', () => null, value => value],
  ['unverified account', value => ({ ...value, emailVerified: false }), value => value],
  ['missing subject', value => ({ ...value, sub: undefined }), value => value],
  ['no current org', value => ({ ...value, currentOrganization: null }), value => value],
  ['wrong selected org', value => ({ ...value, currentOrganization: 'f'.repeat(24) }), value => value],
  ['no org', value => value, () => null],
  ['no active membership', value => value, value => ({ ...value, members: [] })],
  ['inactive membership', value => value, value => ({ ...value, members: [{ account: accountId, status: 'inactive' }] })],
  ['another member', value => value, value => ({ ...value, members: [{ account: 'other', status: 'active' }] })],
]) test(`candidate context denies ${name}`, () => {
  assert.equal(getN8nCandidateContext(mutateAccount(accountFixture()), mutateOrg(organizationFixture())), undefined)
})

test('candidate readiness returns a request-scoped clone without changing the global catalog', () => {
  const app = appFixture()
  const candidate = withN8nCandidateReadiness(app, { candidateContext: context }, environment(), now)
  assert.equal(candidate.isActive, true)
  assert.notEqual(candidate, app)
  assert.equal(app.isActive, false)
  assert.equal(withN8nCandidateReadiness(app, {}, environment(), now).isActive, false)
})
for (const [name, override] of [
  ['disabled integration', { N8N_INTEGRATION_ENABLED: 'false' }],
  ['missing delegated secret', { N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: '' }],
  ['untrusted editor origin', { AUTOMATIONS_URL: 'https://attacker.example' }],
  ['untrusted Workspace origin', { WORKSPACE_AUTOMATIONS_URL: 'https://attacker.example/automations?editor=standalone' }],
  ['wrong Workspace path', { WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/admin?editor=standalone' }],
]) test(`preview cannot overcome ${name}`, () => {
  assert.equal(withN8nCandidateReadiness(appFixture(), { candidateContext: context }, { ...environment(), ...override }, now).isActive, false)
})
test('preview never activates another application or mutates a publicly active application', () => {
  const other = { appId: 'other', isActive: false }
  const active = { ...appFixture(), isActive: true }
  assert.equal(withN8nCandidateReadiness(other, { candidateContext: context }, environment(), now), other)
  assert.equal(withN8nCandidateReadiness(active, {}, environment(), now), active)
})

// Execute the actual Express launch callback with dependency doubles. This
// covers guard order and real responses without connecting to production data.
const indexSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
const launchSource = indexSource.slice(indexSource.indexOf("app.get('/launch/:appId'"), indexSource.indexOf('// API: Get all apps'))
async function launch({ account = accountFixture(), organization = organizationFixture(), subscription = { isLocked: false, features: { messaging: true } }, query = {}, env = environment() } = {}) {
  let handler
  const activity = []
  const req = { params: { appId: 'automation-hub' }, query, originalUrl: '/launch/automation-hub' }
  const result = { status: 200 }
  const res = {
    set() { return this }, status(value) { result.status = value; return this },
    redirect(url) { result.redirect = url; return this }, send(body) { result.body = body; return this },
    render(view, data) { result.view = view; result.data = data; return this },
  }
  const dependencies = {
    app: { get(path, callback) { handler = callback } },
    console: { log() {}, warn() {}, error() {} },
    getSessionFromCookies: async () => account,
    logAppLaunchActivity: async event => { activity.push(event.status) },
    buildInternalLoginRedirect: () => '/login',
    Organization: { findById() { return { select() { return this }, lean: async () => organization } } },
    getN8nCandidateContext,
    getAppById: (id, options) => withN8nCandidateReadiness(appFixture(), options, env, now),
    appRequiresOrganization,
    getCurrentOrganizationSubscriptionAccessState: async () => subscription,
    getHubAppMetadata: () => ({ appIdSet: new Set(['automation-hub', 'messaging']) }),
    normalizeAppAccess, memberCanAccessApp,
    getPlanFeatureKeyForApp: () => 'messaging',
    resolveAutomationHubSurface,
    getOrganizationScopedAutomationSurfaceUrls,
    getOrganizationScopedDirectLaunchUrl,
    setAutomationEditorResponseHeaders() {},
  }
  new Function(...Object.keys(dependencies), launchSource)(...Object.values(dependencies))
  await handler(req, res)
  return { ...result, activity }
}
test('actual launch route requires the existing IdP session', async () => {
  assert.equal((await launch({ account: null })).redirect, '/login')
})
test('actual launch route opens the candidate Identity embedded surface', async () => {
  const result = await launch()
  assert.equal(result.view, 'automation-workspace')
  assert.equal(result.data.workspaceEmbedUrl, `https://workspace.seemplifyai.com/automations?organizationId=${organizationId}`)
  assert.deepEqual(result.activity, ['launched_embedded'])
})
test('actual launch route opens the same candidate externally', async () => {
  const result = await launch({ query: { surface: 'external' } })
  assert.equal(result.redirect, `https://workspace.seemplifyai.com/automations?editor=standalone&organizationId=${organizationId}`)
})
test('actual launch route rejects non-allowlisted users with public flags disabled', async () => {
  const result = await launch({ account: { ...accountFixture(), sub: 'other-user' } })
  assert.equal(result.status, 404)
  assert.deepEqual(result.activity, ['app_not_found'])
})
test('actual launch route rejects an expired candidate without relying on a process restart', async () => {
  const result = await launch({ env: environment({ ...fixture(), expiresAt: '2026-09-03T09:00:00Z' }) })
  assert.equal(result.status, 404)
  assert.deepEqual(result.activity, ['app_not_found'])
})
test('request-scoped readiness expires without activating later catalog reads', () => {
  const app = appFixture()
  const env = environment()
  assert.equal(withN8nCandidateReadiness(app, { candidateContext: context }, env, now).isActive, true)
  assert.equal(withN8nCandidateReadiness(app, { candidateContext: context }, env, now + 3600000).isActive, false)
  assert.equal(app.isActive, false)
})
test('actual launch route cannot authorize via a client supplied preview query', async () => {
  const result = await launch({ query: { candidate: 'true', subject, organizationId } })
  assert.equal(result.status, 400)
  assert.deepEqual(result.activity, ['blocked_invalid_launch_context'])
})
test('actual launch route cannot preview after canonical membership is revoked', async () => {
  const result = await launch({ organization: { ...organizationFixture(), members: [] } })
  assert.equal(result.status, 404)
})
test('actual launch route still denies a locked subscription', async () => {
  const result = await launch({ subscription: { isLocked: true } })
  assert.equal(result.redirect, '/?subscription=locked')
  assert.deepEqual(result.activity, ['blocked_subscription'])
})
test('actual launch route still denies an unassigned application', async () => {
  const organization = organizationFixture()
  organization.members[0].appAccess = { mode: 'selected', appIds: ['messaging'] }
  const result = await launch({ organization })
  assert.equal(result.redirect, '/?error=app_not_assigned&app=Automations')
  assert.deepEqual(result.activity, ['blocked_member_scope'])
})
test('actual launch route allows explicitly assigned candidate application', async () => {
  const organization = organizationFixture()
  organization.members[0].appAccess = { mode: 'selected', appIds: ['automation-hub'] }
  assert.equal((await launch({ organization })).view, 'automation-workspace')
})
test('actual launch route still denies missing subscription entitlement', async () => {
  const result = await launch({ subscription: { isLocked: false, features: {} } })
  assert.equal(result.view, 'subscription-required')
  assert.deepEqual(result.activity, ['blocked_subscription'])
})
test('hub candidate context comes from canonical org reads, never request fields', () => {
  const home = indexSource.slice(indexSource.indexOf("app.get('/',"), indexSource.indexOf('// Hub Login Page'))
  assert.match(home, /getN8nCandidateContext\(account, userOrganizations\.find/)
  assert.match(home, /getHubAppMetadata\(\{ candidateContext \}\)/)
  assert.match(home, /getPinEligibleHubApps\(req, candidateContext\)/)
  assert.doesNotMatch(home, /candidateContext:\s*req\./)
  assert.match(home, /memberAppAccess\.mode === APP_ACCESS_MODE_SELECTED/)
  assert.match(home, /currentSubscriptionAccess\?\.isLocked/)
  assert.match(home, /res\.set\('Cache-Control', 'private, no-store'\)/)
})
