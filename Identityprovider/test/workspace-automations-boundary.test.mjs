import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { PRODUCT_PERMISSION_CATALOG } from '../src/config/accessControlCatalog.js'

async function loadHubApps(nodeEnv) {
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  try {
    const moduleUrl = new URL('../src/config/hubApps.js', import.meta.url)
    moduleUrl.searchParams.set('workspace-automations-boundary', `${nodeEnv}-${Date.now()}`)
    const { getAllHubApps } = await import(moduleUrl.href)
    return getAllHubApps()
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
}

test('Automations is not registered as a standalone IdP Hub application', async () => {
  for (const nodeEnv of ['development', 'production']) {
    const apps = await loadHubApps(nodeEnv)
    assert.equal(
      apps.some((app) => app.appId === 'automation-hub' || app.clientId === 'automation-hub'),
      false,
      `${nodeEnv} must launch Automations through Workspace instead of a standalone app`
    )
  }
})

test('Workspace keeps the automation permission namespace used for role-based access', () => {
  const automationPermissions = PRODUCT_PERMISSION_CATALOG
    .find((product) => product.appId === 'automation-hub')
    ?.permissions.map((permission) => permission.id)

  assert.ok(automationPermissions, 'Workspace automation permissions must remain catalogued in the IdP')
  for (const permissionId of [
    'automations.read',
    'automations.create',
    'automations.edit',
    'automations.run',
    'executions.read',
    'connections.read',
    'settings.manage'
  ]) {
    assert.ok(automationPermissions.includes(permissionId), `missing Workspace permission ${permissionId}`)
  }
})

test('runtime configuration contains no standalone Automation URL, client, or compatibility setting', async () => {
  const sources = await Promise.all([
    '../../deploy/hostinger/core-apps.compose.yml',
    '../../deploy/hostinger/generate-idp-clients.sh',
    '../clients.json',
    '../src/middleware/automationRequestAuth.js',
    '../../leave-management/backend/.env.example',
    '../../leave-management/backend/services/automationEventService.js',
    '../../leave-management/backend/services/automationHubSecurity.js',
    '../../payroll/backend/services/automationEventService.js',
    '../../payroll/backend/services/automationHubSecurity.js',
    '../../time-attendance/backend/.env.example',
    '../../time-attendance/backend/services/automationEventService.js',
    '../../time-attendance/backend/services/automationHubSecurity.js'
  ].map((relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')))
  const deploymentContract = sources.join('\n')
  const compose = sources[0]

  assert.doesNotMatch(deploymentContract, /automations\.seemplifyai\.com/)
  assert.doesNotMatch(deploymentContract, /AUTOMATION_HUB_(?:URL|API_URL|OIDC_CLIENT_SECRET)/)
  assert.doesNotMatch(deploymentContract, /AUTOMATION_HUB_HMAC_SECRET/)
  assert.doesNotMatch(deploymentContract, /OIDC_AUTOMATION_SECRET/)
  assert.doesNotMatch(deploymentContract, /"client_id"\s*:\s*"automation-hub"/)
  assert.match(compose, /WORKSPACE_AUTOMATION_API_URL: https:\/\/api-workspace\.seemplifyai\.com/)

  for (const relativePath of ['../../automation-hub/.env.example', '../../automation-hub/.dockerignore']) {
    await assert.rejects(access(new URL(relativePath, import.meta.url)), (error) => error?.code === 'ENOENT')
  }
})
