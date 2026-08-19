import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const compose = await readFile(
  new URL('../deploy/hostinger/core-apps.compose.yml', import.meta.url),
  'utf8'
)
const identityService = compose.slice(
  compose.indexOf('  identity-provider:'),
  compose.indexOf('\n  recruiter-backend:')
)

test('Identity production wiring includes its dedicated presence signing secret', () => {
  assert.match(
    identityService,
    /PRESENCE_REPORTER_SERVICE_SECRET:\s*\$\{TIME_INTERNAL_SECRET:\?required\}/
  )
})

test('Identity production wiring exposes every dedicated webhook signing secret', () => {
  for (const variable of [
    'IDP_WEBHOOK_SECRET_RECRUITER',
    'IDP_WEBHOOK_SECRET_LEAVE_MANAGEMENT',
    'IDP_WEBHOOK_SECRET_PAYROLL',
    'IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT',
    'IDP_WEBHOOK_SECRET_TIME_ATTENDANCE',
    'IDP_WEBHOOK_SECRET_MESSAGING',
    'IDP_WEBHOOK_SECRET_APPROVER'
  ]) {
    assert.match(identityService, new RegExp(`\\b${variable}:`))
  }
})
