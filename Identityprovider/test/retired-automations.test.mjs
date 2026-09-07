import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { retiredAutomations, RETIRED_AUTOMATION_CLIENT_IDS } from '../src/middleware/retiredAutomations.js'
import { applyOidcClientSecretOverrides } from '../src/config/oidcClients.js'
import { materializeProductionOidcClients } from '../src/config/productionOidcClients.js'
import { externalProductAccessDecision } from '../src/utils/externalProductAccess.js'
import { getKnownAppIds, getDefaultRolePermissions } from '../src/config/accessControlCatalog.js'
import { getPlanFeatureKeyForApp } from '../src/config/planFeatures.js'
import platformIntegrations from '../src/routes/platformIntegrations.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const environmentKeys = [
  'NODE_ENV', 'N8N_HUB_ENABLED', 'N8N_INTEGRATION_ENABLED',
  'N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET', 'AUTOMATIONS_URL', 'WORKSPACE_AUTOMATIONS_URL'
]

for (const mode of ['development', 'production']) {
  for (const hub of ['false', 'true']) {
    for (const integration of ['false', 'true']) {
      test(`${mode}: Automations stays absent with stale flags ${hub}/${integration}`, async () => {
        const prior = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))
        Object.assign(process.env, {
          NODE_ENV: mode, N8N_HUB_ENABLED: hub, N8N_INTEGRATION_ENABLED: integration,
          N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'unused-test-secret',
          AUTOMATIONS_URL: 'https://automations.seemplifyai.com',
          WORKSPACE_AUTOMATIONS_URL: 'https://workspace.seemplifyai.com/automations?editor=standalone'
        })
        try {
          const apps = await import(`../src/config/hubApps.js?retirement=${mode}-${hub}-${integration}`)
          assert.equal(apps.getAppById('automation-hub'), undefined)
          assert.ok(!apps.getHubApps().some(app => app.appId === 'automation-hub'))
          assert.ok(!apps.getAllHubApps().some(app => app.appId === 'automation-hub'))
          assert.ok(apps.getAppById('messaging'))
        } finally {
          for (const [key, value] of Object.entries(prior)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
          }
        }
      })
    }
  }
}

for (const clientId of RETIRED_AUTOMATION_CLIENT_IDS) {
  test(`${clientId}: stale production secret cannot register retired OAuth`, () => {
    assert.deepEqual(materializeProductionOidcClients([
      { client_id: clientId, token_endpoint_auth_method: 'client_secret_basic' }
    ], { [clientId]: 'unused-test-secret' }), [])
  })
  test(`${clientId}: public client metadata cannot register retired OAuth`, () => {
    assert.deepEqual(materializeProductionOidcClients([
      { client_id: clientId, token_endpoint_auth_method: 'none' }
    ]), [])
  })
  test(`${clientId}: runtime client loading filters old protected inventory`, () => {
    assert.deepEqual(applyOidcClientSecretOverrides([{ client_id: clientId }], {
      N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET: 'unused-test-secret'
    }), [])
  })
  test(`${clientId}: old grants cannot authorize an already-issued token`, () => {
    const result = externalProductAccessDecision({
      clientId, env: { N8N_INTEGRATION_ENABLED: 'true' },
      claims: { product_permissions: { 'automation-hub': ['*'] } }
    })
    assert.equal(result.allowed, false)
    assert.equal(result.code, 'AUTOMATIONS_REMOVED')
  })
}

test('Workspace and other live client secret handling is unchanged', () => {
  const clients = [{ client_id: 'messaging', token_endpoint_auth_method: 'client_secret_basic' }]
  assert.equal(applyOidcClientSecretOverrides(clients, { MESSAGING_OIDC_CLIENT_SECRET: 'test-secret' })[0].client_secret, 'test-secret')
  assert.equal(materializeProductionOidcClients(clients, { messaging: 'test-secret' })[0].client_secret, 'test-secret')
})

test('client source and generated deployment inputs have no automation client', () => {
  const clients = JSON.parse(source('../clients.json')).clients
  assert.ok(clients.every(client => !RETIRED_AUTOMATION_CLIENT_IDS.has(client.client_id)))
  assert.doesNotMatch(source('../../deploy/hostinger/generate-idp-clients.sh'), /N8N|n8n-workspace-node/)
})

test('retired product is absent from administrative permissions and subscriptions', () => {
  assert.ok(!getKnownAppIds().includes('automation-hub'))
  assert.equal(getPlanFeatureKeyForApp('automation-hub'), undefined)
})
for (const role of ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']) {
  test(`${role}: no automation product grant is issued`, () => {
    assert.deepEqual(getDefaultRolePermissions(role, 'automation-hub'), [])
  })
}

const app = express()
app.all('/launch/automation-hub', retiredAutomations)
app.use('/api/internal/automation', retiredAutomations)
app.use('/integrations', platformIntegrations)
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
test.after(() => new Promise(resolve => server.close(resolve)))

for (const path of [
  '/launch/automation-hub', '/launch/automation-hub?surface=external',
  '/api/internal/automation/authorize', '/integrations/workspace/automation-access',
  '/integrations/workspace/n8n-token-access', '/integrations/workspace/protected-approver-access'
]) {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    test(`${method} ${path}: retired before identity or action execution`, async () => {
      const result = await fetch(`${origin}${path}`, { method })
      assert.equal(result.status, 410)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.equal(result.headers.get('location'), null)
      assert.deepEqual(await result.json(), {
        allowed: false, code: 'AUTOMATIONS_REMOVED',
        message: 'Automations have been removed. Return to the app launcher to open Workspace.'
      })
    })
  }
}

test('actual Identity launch tombstone precedes the generic launch route', () => {
  const index = source('../src/index.js')
  assert.ok(index.indexOf("app.all('/launch/automation-hub', retiredAutomations)") < index.indexOf("app.get('/launch/:appId'"))
  assert.match(index, /app\.use\('\/api\/internal\/automation', retiredAutomations\)/)
  assert.doesNotMatch(index, /render\('automation-workspace'/)
})

test('removed editor assets cannot serve a stale embedded editor', () => {
  for (const path of ['../src/views/automation-workspace.ejs', '../src/public/css/automation-workspace.css']) {
    assert.equal(existsSync(fileURLToPath(new URL(path, import.meta.url))), false)
  }
})

test('core deployment has no automation URLs, keys or flags', () => {
  assert.doesNotMatch(source('../../deploy/hostinger/core-apps.compose.yml'), /N8N_|WORKSPACE_AUTOMATION_|automations\.seemplify/)
})

test('normal Workspace lifecycle webhooks remain, retired webhook is absent', () => {
  const webhooks = source('../src/services/webhookService.js')
  assert.match(webhooks, /messaging: process\.env\.MESSAGING_WEBHOOK_URL/)
  assert.match(webhooks, /messaging: 'IDP_WEBHOOK_SECRET_MESSAGING'/)
  assert.doesNotMatch(webhooks, /workspaceAutomation|WORKSPACE_AUTOMATION_/)
})

for (const product of ['leave-management', 'payroll', 'time-attendance']) {
  test(`${product}: no automation executor starts and old actions are retired`, () => {
    const main = source(`../../${product}/backend/server.js`)
    assert.doesNotMatch(main, /startAutomationEventWorker|require\('\.\/routes\/automation'\)/)
    assert.match(main, /app\.use\('\/api\/automation\/actions'.*status\(410\)/)
  })
}

for (const file of [
  'leave-management/backend/routes/leaveRequests.js', 'payroll/backend/routes/payroll.js',
  'payroll/backend/services/PayrollCycleService.js', 'time-attendance/backend/routes/timesheets.js',
  'time-attendance/backend/routes/approvals.js'
]) {
  test(`${file}: ordinary actions no longer enqueue automation platform jobs`, () => {
    assert.doesNotMatch(source(`../../${file}`), /queueLeaveSubmittedEvent|queuePayrollReadyEvent|queueTimesheetEvent/)
  })
}

test('shared connectors are preserved separately from the retired editor', () => {
  assert.match(source('../../deploy/hostinger/automation-nango.compose.yml'), /name: seemplify-connectors/)
  assert.match(source('../../deploy/hostinger/automation-nango.compose.yml'), /nango-server:/)
})
