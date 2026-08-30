import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ejs from 'ejs'

import { PRODUCT_PERMISSION_CATALOG } from '../src/config/accessControlCatalog.js'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'
import { materializeProductionOidcClients } from '../src/config/productionOidcClients.js'
import {
  externalProductAccessDecision,
  N8N_EDITOR_PERMISSION_BUNDLE
} from '../src/utils/externalProductAccess.js'
import { matchesRegisteredUrl } from '../src/utils/registeredUrlMatcher.js'

const HUB_ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'N8N_HUB_ENABLED',
  'N8N_INTEGRATION_ENABLED',
  'AUTOMATIONS_URL',
  'WORKSPACE_AUTOMATIONS_URL',
  'N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET',
]
let hubAppsImport = 0

async function loadHubApps(nodeEnv, env = {}) {
  const previous = Object.fromEntries(HUB_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]))
  for (const key of HUB_ENVIRONMENT_KEYS) delete process.env[key]
  process.env.NODE_ENV = nodeEnv
  Object.assign(process.env, env)

  try {
    const moduleUrl = new URL('../src/config/hubApps.js', import.meta.url)
    moduleUrl.searchParams.set('workspace-automations-boundary', String(hubAppsImport += 1))
    const { getAllHubApps, getHubApps } = await import(moduleUrl.href)
    return { all: getAllHubApps(), visible: getHubApps() }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function loadHubAppLaunchHelpers() {
  const moduleUrl = new URL('../src/config/hubApps.js', import.meta.url)
  moduleUrl.searchParams.set('workspace-automations-launch-helper', String(hubAppsImport += 1))
  return import(moduleUrl.href)
}

function automationApp(apps) {
  return apps.find((candidate) => candidate.appId === 'automation-hub')
}

test('the n8n Hub surface stays hidden until integration and visibility gates are both ready', async () => {
  const developmentDisabled = await loadHubApps('development')
  assert.equal(automationApp(developmentDisabled.all)?.isActive, false)
  assert.equal(automationApp(developmentDisabled.visible), undefined)

  const developmentEnabled = await loadHubApps('development', {
    N8N_HUB_ENABLED: 'true',
    N8N_INTEGRATION_ENABLED: 'true',
  })
  assert.equal(automationApp(developmentEnabled.visible)?.clientId, 'messaging')
  assert.equal(
    automationApp(developmentEnabled.visible)?.url,
    'http://localhost:4200/automations?editor=standalone'
  )

  const productionDisabled = await loadHubApps('production', {
    N8N_INTEGRATION_ENABLED: 'true',
    AUTOMATIONS_URL: 'https://automations.seemplifyai.com',
    WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/automations?editor=standalone',
    N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'delegated-runtime-secret',
  })
  assert.equal(automationApp(productionDisabled.all)?.isActive, false)
  assert.equal(automationApp(productionDisabled.visible), undefined)

  const productionPartiallyConfigured = await loadHubApps('production', {
    N8N_HUB_ENABLED: 'true',
    N8N_INTEGRATION_ENABLED: 'true',
    AUTOMATIONS_URL: 'https://automations.seemplifyai.com',
    WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/automations?editor=standalone',
  })
  assert.equal(automationApp(productionPartiallyConfigured.visible), undefined)

  const productionDevHostsRejected = await loadHubApps('production', {
    N8N_HUB_ENABLED: 'true',
    N8N_INTEGRATION_ENABLED: 'true',
    AUTOMATIONS_URL: 'https://automations-dev.seemplifyai.com',
    WORKSPACE_AUTOMATIONS_URL: 'https://workspace-dev.seemplifyai.com/automations?editor=standalone',
    N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'delegated-runtime-secret',
  })
  assert.equal(automationApp(productionDevHostsRejected.visible), undefined)

  const productionEnabled = await loadHubApps('production', {
    N8N_HUB_ENABLED: 'true',
    N8N_INTEGRATION_ENABLED: 'true',
    AUTOMATIONS_URL: 'https://automations.seemplifyai.com',
    WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/automations?editor=standalone',
    N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'delegated-runtime-secret',
  })
  const app = automationApp(productionEnabled.visible)
  assert.ok(app)
  assert.equal(app.clientId, 'messaging')
  assert.equal(app.authType, 'direct')
  assert.equal(app.url, 'https://workspace.seemplifyai.com/automations?editor=standalone')
  assert.equal(app.apiUrl, 'https://automations.seemplifyai.com/')
})

test('Identity derives embedded and external n8n surfaces from one pinned Workspace broker', async () => {
  const {
    getOrganizationScopedAutomationSurfaceUrls,
    getOrganizationScopedDirectLaunchUrl,
  } = await loadHubAppLaunchHelpers()
  const app = {
    appId: 'automation-hub',
    url: 'https://workspace.seemplifyai.com/automations?editor=standalone',
  }
  const surfaces = getOrganizationScopedAutomationSurfaceUrls(
    app,
    '64B7F9A1C2D3E4F506172839',
    { NODE_ENV: 'production' },
  )

  assert.deepEqual(surfaces, {
    embedUrl: 'https://workspace.seemplifyai.com/automations?organizationId=64b7f9a1c2d3e4f506172839',
    externalUrl: 'https://workspace.seemplifyai.com/automations?editor=standalone&organizationId=64b7f9a1c2d3e4f506172839',
    workspaceOrigin: 'https://workspace.seemplifyai.com',
    workspaceApiOrigin: 'https://api-workspace.seemplifyai.com',
  })
  assert.equal(getOrganizationScopedDirectLaunchUrl(app, '64B7F9A1C2D3E4F506172839'),
    'https://workspace.seemplifyai.com/automations?editor=standalone&organizationId=64b7f9a1c2d3e4f506172839',
  )
})

test('Identity refuses malformed organization context for a standalone n8n launch', async () => {
  const {
    getOrganizationScopedAutomationSurfaceUrls,
    getOrganizationScopedDirectLaunchUrl,
  } = await loadHubAppLaunchHelpers()
  for (const organizationId of ['', 'org-a', '../org-a', '64b7f9a1c2d3e4f506172839%0d%0a']) {
    assert.equal(getOrganizationScopedDirectLaunchUrl({
      appId: 'automation-hub',
      url: 'https://workspace.seemplifyai.com/automations?editor=standalone',
    }, organizationId), '')
    assert.equal(getOrganizationScopedAutomationSurfaceUrls({
      appId: 'automation-hub',
      url: 'https://workspace.seemplifyai.com/automations?editor=standalone',
    }, organizationId, { NODE_ENV: 'production' }), null)
  }
})

test('Identity rejects caller-controlled Workspace hosts, paths, ports, fragments, and query parameters', async () => {
  const { getOrganizationScopedAutomationSurfaceUrls } = await loadHubAppLaunchHelpers()
  const unsafeUrls = [
    'https://evil.test/automations?editor=standalone',
    'https://workspace.seemplifyai.com.evil.test/automations?editor=standalone',
    'https://user:pass@workspace.seemplifyai.com/automations?editor=standalone',
    'https://workspace.seemplifyai.com:444/automations?editor=standalone',
    'http://workspace.seemplifyai.com/automations?editor=standalone',
    'https://workspace.seemplifyai.com/automations/other?editor=standalone',
    'https://workspace.seemplifyai.com/automations?editor=standalone&next=https://evil.test',
    'https://workspace.seemplifyai.com/automations?editor=standalone#other',
    'https://workspace.seemplifyai.com/automations?editor=standalone&editor=standalone',
  ]

  for (const url of unsafeUrls) {
    assert.equal(getOrganizationScopedAutomationSurfaceUrls({
      appId: 'automation-hub',
      url,
    }, '64b7f9a1c2d3e4f506172839', { NODE_ENV: 'production' }), null, url)
  }
})

test('Identity accepts local Workspace automation embedding only outside production', async () => {
  const { getOrganizationScopedAutomationSurfaceUrls } = await loadHubAppLaunchHelpers()
  const app = {
    appId: 'automation-hub',
    url: 'http://localhost:4200/automations?editor=standalone',
  }

  assert.equal(getOrganizationScopedAutomationSurfaceUrls(
    app,
    '64b7f9a1c2d3e4f506172839',
    { NODE_ENV: 'production' },
  ), null)
  assert.equal(getOrganizationScopedAutomationSurfaceUrls(
    app,
    '64b7f9a1c2d3e4f506172839',
    { NODE_ENV: 'development' },
  )?.workspaceOrigin, 'http://localhost:4200')
})

test('Identity selects only the default embedded surface or exact external query', async () => {
  const { resolveAutomationHubSurface } = await loadHubAppLaunchHelpers()
  assert.equal(resolveAutomationHubSurface({}), 'embedded')
  assert.equal(resolveAutomationHubSurface({ surface: 'external' }), 'external')
  for (const query of [
    { surface: 'embedded' },
    { surface: 'external', next: 'https://evil.test' },
    { surface: ['external', 'external'] },
    { Surface: 'external' },
    [],
    null,
  ]) assert.equal(resolveAutomationHubSurface(query), '')
})

test('Identity leaves unrelated direct application launch URLs unchanged', async () => {
  const { getOrganizationScopedDirectLaunchUrl } = await loadHubAppLaunchHelpers()
  assert.equal(getOrganizationScopedDirectLaunchUrl({
    appId: 'another-direct-app',
    url: 'https://example.test/start?mode=direct',
  }, '64b7f9a1c2d3e4f506172839'), 'https://example.test/start?mode=direct')
})

test('the Hub route embeds by default and redirects only for the exact external surface', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const launchStart = source.indexOf("app.get('/launch/:appId'")
  const launchEnd = source.indexOf('// Special handling for Outline', launchStart)
  const directLaunchSource = source.slice(launchStart, launchEnd)

  assert.match(directLaunchSource, /app\.appId === 'automation-hub'/)
  assert.match(directLaunchSource, /resolveAutomationHubSurface\(req\.query\)/)
  assert.match(directLaunchSource, /getOrganizationScopedAutomationSurfaceUrls\(app, currentOrgId\)/)
  assert.match(directLaunchSource, /requestedSurface === 'external'/)
  assert.match(directLaunchSource, /return res\.redirect\(automationSurfaceUrls\.externalUrl\)/)
  assert.match(directLaunchSource, /return res\.render\('automation-workspace'/)
  assert.match(directLaunchSource, /workspaceEmbedUrl: automationSurfaceUrls\.embedUrl/)
  assert.match(directLaunchSource, /externalLaunchPath: '\/launch\/automation-hub\?surface=external'/)
  assert.match(directLaunchSource, /getOrganizationScopedDirectLaunchUrl\(app, currentOrgId\)/)
  assert.match(directLaunchSource, /status: 'blocked_invalid_launch_context'/)
  assert.match(directLaunchSource, /redirectUrl: directLaunchUrl/)
  assert.match(directLaunchSource, /return res\.redirect\(directLaunchUrl\)/)
  assert.doesNotMatch(directLaunchSource, /return res\.redirect\(app\.url\)/)
})

test('the Identity editor shell is accessible and exposes only fixed internal navigation', async () => {
  const [view, styles] = await Promise.all([
    readFile(new URL('../src/views/automation-workspace.ejs', import.meta.url), 'utf8'),
    readFile(new URL('../src/public/css/automation-workspace.css', import.meta.url), 'utf8'),
  ])

  assert.match(view, /<html lang="en">/)
  assert.match(view, /<main class="editor-shell">/)
  assert.match(view, /title="n8n automation editor for <%= organizationName %>"/)
  assert.match(view, /aria-label="Automation editor actions"/)
  assert.match(view, /role="status"/)
  assert.match(view, /role="alert" aria-live="assertive"/)
  assert.match(view, /target="_blank" rel="noopener noreferrer"/)
  assert.match(view, /href="<%= externalLaunchPath %>"/)
  assert.doesNotMatch(view, /<script|javascript:|onload=|onerror=/i)
  assert.match(styles, /a:focus-visible/)
  assert.match(styles, /@media \(max-width: 680px\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('the Identity editor shell escapes organization and editor URL output', async () => {
  const view = await readFile(new URL('../src/views/automation-workspace.ejs', import.meta.url), 'utf8')
  const rendered = ejs.render(view, {
    brand: { name: 'Seemplify' },
    organizationName: '<img src=x onerror=alert(1)>',
    workspaceEmbedUrl: 'https://workspace.seemplifyai.com/automations?organizationId=64b7f9a1c2d3e4f506172839&safe=1',
    externalLaunchPath: '/launch/automation-hub?surface=external',
    errorMessage: '',
  })

  assert.doesNotMatch(rendered, /<img src=x onerror=/)
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(rendered, /organizationId=64b7f9a1c2d3e4f506172839&amp;safe=1/)
  assert.match(rendered, /href="\/launch\/automation-hub\?surface=external"/)
})

test('the Identity editor response pins framing and denies being embedded itself', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const headersStart = source.indexOf('function setAutomationEditorResponseHeaders')
  const headersEnd = source.indexOf('// Hub App Launch', headersStart)
  const headerSource = source.slice(headersStart, headersEnd)

  assert.match(headerSource, /AUTOMATION_EDITOR_ALLOWED_FRAME_ORIGINS\.has\(origin\)/)
  assert.match(headerSource, /frame-src 'self' \$\{safeFrameOrigins\.join\(' '\)\}/)
  assert.match(headerSource, /frame-src 'none'/)
  assert.match(headerSource, /frame-ancestors 'none'/)
  assert.match(headerSource, /'X-Frame-Options': 'DENY'/)
  assert.match(headerSource, /"form-action 'self'"/)
  assert.match(headerSource, /"object-src 'none'"/)
  assert.doesNotMatch(headerSource, /req\.query|req\.headers|\*/)
})

test('end-user n8n login is Workspace-brokered and only delegated node OAuth is registered', async () => {
  const clients = JSON.parse(await readFile(new URL('../clients.json', import.meta.url), 'utf8')).clients
  const interactiveClient = clients.find((candidate) => candidate.client_id === 'n8n')
  const workspaceNodeClient = clients.find((candidate) => candidate.client_id === 'n8n-workspace-node')
  assert.equal(interactiveClient, undefined)
  assert.ok(workspaceNodeClient)

  assert.deepEqual(workspaceNodeClient.grant_types, ['authorization_code', 'refresh_token'])
  assert.ok(workspaceNodeClient.redirect_uri_patterns.every((uri) => uri.endsWith('/rest/oauth2-credential/callback')))
  assert.equal(workspaceNodeClient.redirect_uri_patterns.some((uri) => uri.includes('/sso/oidc/')), false)

  const overridden = applyOidcClientSecretOverrides(
    [workspaceNodeClient],
    {
      N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'delegated-protected-secret',
    },
  )
  assert.equal(overridden[0].client_secret, 'delegated-protected-secret')

  const productionClients = materializeProductionOidcClients(
    [workspaceNodeClient],
    {
      'n8n-workspace-node': 'delegated-protected-secret',
    },
  )
  assert.deepEqual(
    productionClients.map((client) => [client.client_id, client.client_secret]),
    [
      ['n8n-workspace-node', 'delegated-protected-secret'],
    ],
  )
  assert.deepEqual(productionClients[0].redirect_uri_patterns, [
    'https://automations.seemplifyai.com/rest/oauth2-credential/callback',
  ])
  assert.deepEqual(productionClients[0].allowed_origins, [
    'https://automations.seemplifyai.com',
  ])
  assert.equal(JSON.stringify(productionClients[0]).includes('localhost'), false)
  assert.equal(JSON.stringify(productionClients[0]).includes('automations-dev'), false)
})

test('Identity denies delegated n8n node OAuth unless enabled and assigned', () => {
  for (const clientId of ['n8n-workspace-node']) {
    const disabled = externalProductAccessDecision({
      clientId,
      claims: { product_permissions: { 'automation-hub': ['automations.read'] } },
      env: { N8N_INTEGRATION_ENABLED: 'false' },
    })
    assert.equal(disabled.allowed, false)
    assert.equal(disabled.code, 'PRODUCT_DISABLED')

    const allowed = externalProductAccessDecision({
      clientId,
      claims: { product_permissions: { 'automation-hub': [...N8N_EDITOR_PERMISSION_BUNDLE] } },
      env: { N8N_INTEGRATION_ENABLED: 'true' },
    })
    assert.equal(allowed.allowed, true)
    assert.equal(allowed.appId, 'automation-hub')

    const denied = externalProductAccessDecision({
      clientId,
      claims: { product_permissions: { 'automation-hub': ['automations.read'] } },
      env: { N8N_INTEGRATION_ENABLED: 'true' },
    })
    assert.equal(denied.allowed, false)
    assert.equal(denied.code, 'PRODUCT_PERMISSION_DENIED')
    assert.deepEqual(denied.missingPermissions, N8N_EDITOR_PERMISSION_BUNDLE.slice(1))
  }
})

test('Identity retains the Workspace automation permission namespace', () => {
  const automationPermissions = PRODUCT_PERMISSION_CATALOG
    .find((product) => product.appId === 'automation-hub')
    ?.permissions.map((permission) => permission.id)
  assert.ok(automationPermissions)
  for (const permissionId of [
    'automations.read',
    'automations.create',
    'automations.edit',
    'automations.run',
    'executions.read',
    'connections.read',
    'settings.manage',
  ]) assert.ok(automationPermissions.includes(permissionId), `missing Workspace permission ${permissionId}`)
})

test('Workspace editor sessions revalidate through a body-bound signed Identity endpoint', async () => {
  const routeSource = await readFile(new URL('../src/routes/platformIntegrations.js', import.meta.url), 'utf8')
  assert.match(routeSource, /router\.post\('\/workspace\/automation-access'/)
  assert.match(routeSource, /router\.post\('\/workspace\/n8n-token-access'/)
  assert.match(routeSource, /createPlatformIntegrationServiceAuth\(\['workspace'\], \{ requireBodyHash: true \}\)/)
  assert.match(routeSource, /resolveWorkspaceAutomationAccess\(req\.body \|\| \{\}\)/)
  assert.match(routeSource, /resolveWorkspaceAutomationTokenAccess\(req\.body \|\| \{\}\)/)
  assert.match(routeSource, /Cache-Control', 'no-store'/)
})

test('central Identity logout durably invalidates previously issued embedded editor sessions', async () => {
  const [accountSource, indexSource, accessSource] = await Promise.all([
    readFile(new URL('../src/models/Account.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/workspaceAutomationAccessService.js', import.meta.url), 'utf8'),
  ])
  assert.match(accountSource, /sessionInvalidBefore:\s*Date/)
  const logoutStart = indexSource.indexOf("app.get('/logout'")
  const logoutEnd = indexSource.indexOf("app.get('/simple-lms'", logoutStart)
  const logoutSource = indexSource.slice(logoutStart, logoutEnd)
  assert.match(logoutSource, /adapter\.find\(sessionCookie\)/)
  assert.match(logoutSource, /\$max:\s*\{\s*'security\.sessionInvalidBefore': logoutAt\s*\}/)
  assert.ok(
    logoutSource.indexOf("'security.sessionInvalidBefore'") < logoutSource.indexOf('adapter.destroy(sessionCookie)'),
    'the durable revocation marker must advance before the central session is destroyed'
  )
  assert.match(accessSource, /issuedAt \* 1000 <= invalidBefore/)
  assert.match(accessSource, /N8N_IDENTITY_SESSION_REVOKED/)
})

test('registered callbacks match exact URLs and one whole wildcard hostname label', () => {
  assert.equal(matchesRegisteredUrl(
    'https://automations.seemplifyai.com/rest/oauth2-credential/callback',
    ['https://automations.seemplifyai.com/rest/oauth2-credential/callback'],
  ), true)
  assert.equal(matchesRegisteredUrl(
    'https://automations.seemplifyai.com/rest/oauth2-credential/callback?next=1',
    ['https://automations.seemplifyai.com/rest/oauth2-credential/callback'],
  ), false)

  const wildcardPatterns = ['https://*.smarthr.com/api/auth/oidc/callback']
  assert.equal(matchesRegisteredUrl('https://tenant.smarthr.com/api/auth/oidc/callback', wildcardPatterns), true)
  assert.equal(matchesRegisteredUrl('https://TENANT.smarthr.com/api/auth/oidc/callback', wildcardPatterns), true)
  assert.equal(matchesRegisteredUrl('https://nested.tenant.smarthr.com/api/auth/oidc/callback', wildcardPatterns), false)
  assert.equal(matchesRegisteredUrl(
    'https://nested.tenant.smarthr.com/api/auth/oidc/callback',
    ['https://*.*.smarthr.com/api/auth/oidc/callback'],
  ), false)
  assert.equal(matchesRegisteredUrl('https://smarthr.com/api/auth/oidc/callback', wildcardPatterns), false)
  assert.equal(matchesRegisteredUrl('https://tenant.smarthr.com.evil.test/api/auth/oidc/callback', wildcardPatterns), false)
  assert.equal(matchesRegisteredUrl('https://tenant.smarthr.com/api/auth/oidc/other', wildcardPatterns), false)
})

test('malformed and over-broad registered URL patterns fail closed', () => {
  assert.equal(matchesRegisteredUrl('https://tenant-1.smarthr.com/callback', ['https://tenant-*.smarthr.com/callback']), false)
  assert.equal(matchesRegisteredUrl('https://smarthr.com/callback/tenant', ['https://smarthr.com/callback/*']), false)
  assert.equal(matchesRegisteredUrl('not a URL', ['https://*.smarthr.com/callback']), false)
  assert.equal(matchesRegisteredUrl('https://tenant.smarthr.com/callback', []), false)
  assert.equal(matchesRegisteredUrl('', ['https://*.smarthr.com/callback']), false)
})

test('root deployment wiring is fail-closed and contains no development secrets', async () => {
  const [compose, generator, workflow] = await Promise.all([
    readFile(new URL('../../deploy/hostinger/core-apps.compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/hostinger/generate-idp-clients.sh', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/deploy-core-hostinger.yml', import.meta.url), 'utf8'),
  ])

  assert.match(compose, /N8N_HUB_ENABLED: "\$\{N8N_HUB_ENABLED:-false\}"/)
  assert.match(compose, /N8N_INTEGRATION_ENABLED: "\$\{N8N_INTEGRATION_ENABLED:-false\}"/)
  assert.match(compose, /WORKSPACE_AUTOMATIONS_URL: \$\{WORKSPACE_AUTOMATIONS_URL:-https:\/\/workspace\.seemplifyai\.com\/automations\?editor=standalone\}/)
  assert.match(compose, /N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: \$\{OIDC_N8N_WORKSPACE_NODE_SECRET:-\}/)
  assert.match(compose, /IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION: "v1"/)
  assert.doesNotMatch(compose, /workspace-platform-integration-hmac:ro/)
  assert.match(generator, /OIDC_N8N_WORKSPACE_NODE_SECRET is required when N8N_INTEGRATION_ENABLED=true/)
  assert.match(generator, /"n8n-workspace-node": process\.env\.OIDC_N8N_WORKSPACE_NODE_SECRET/)
  assert.match(workflow, /test\/workspace-automations-boundary\.test\.mjs/)
  assert.match(workflow, /test\/workspace-platform-integration-auth\.test\.mjs/)
  assert.doesNotMatch([compose, generator].join('\n'), /n8n(?:-workspace-node)?-development-secret|OIDC_N8N_SECRET/)
})
