import assert from 'node:assert/strict'
import test from 'node:test'

test('production requires a distinct configured secret for each webhook target', async () => {
  const service = await import(`../src/services/webhookService.js?target-secrets=${Date.now()}`)
  const source = {
    NODE_ENV: 'production',
    IDP_WEBHOOK_SECRET: 'idp-root-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_RECRUITER: 'recruiter-target-secret-at-least-32-characters',
    IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT: 'performance-target-secret-at-least-32-characters'
  }
  const recruiter = service.resolveWebhookSecretForTarget('smarthr', source)
  const performance = service.resolveWebhookSecretForTarget('performance', source)
  assert.notEqual(recruiter, performance)
  assert.throws(
    () => service.resolveWebhookSecretForTarget('payroll', source),
    /IDP_WEBHOOK_SECRET_PAYROLL is required/
  )
})

test('readiness probe is signed by the running IdP for every target receiver', async () => {
  const keys = {
    NODE_ENV: 'production',
    IDP_WEBHOOK_SECRET: 'idp-root-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_RECRUITER: 'recruiter-target-secret-at-least-32-characters',
    IDP_WEBHOOK_SECRET_LEAVE_MANAGEMENT: 'leave-target-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_PAYROLL: 'payroll-target-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT: 'performance-target-secret-at-least-32-characters',
    IDP_WEBHOOK_SECRET_TIME_ATTENDANCE: 'time-target-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_MESSAGING: 'messaging-target-secret-that-is-at-least-32-characters',
    IDP_WEBHOOK_SECRET_APPROVER: 'approver-target-secret-that-is-at-least-32-characters',
    WORKSPACE_AUTOMATION_HMAC_SECRET: 'automation-target-secret-that-is-at-least-32-characters'
  }
  const prior = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]))
  Object.assign(process.env, keys)
  try {
    const service = await import(`../src/services/webhookService.js?readiness=${Date.now()}`)
    const calls = []
    const result = await service.probeWebhookTargets({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        const payload = JSON.parse(init.body)
        return new Response(JSON.stringify({
          received: true,
          event: payload.event,
          eventId: payload.eventId
        }), { status: 200 })
      }
    })
    assert.equal(calls.length, 9)
    assert.deepEqual(result.results.map(item => item.name).sort(), [
      'approver', 'leaveManagement', 'messaging', 'payroll', 'performance', 'recruiter', 'smarthr', 'timeAttendance', 'workspaceAutomation'
    ])
    assert.equal(new Set(calls.map(call => call.init.headers['X-IDP-Signature-V2'])).size, 9)
    assert.ok(calls.every(call => call.init.headers['X-IDP-Delivery-Timestamp']))
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
