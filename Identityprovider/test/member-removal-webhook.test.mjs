import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('member removal payload uses the stable subject and both remove/leave routes emit it', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  const priorFetch = global.fetch
  process.env.IDP_WEBHOOK_SECRET = 'idp-member-removal-test-secret-32-chars'
  const bodies = []
  global.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body)
    bodies.push(payload)
    return new Response(JSON.stringify({
      received: true,
      event: payload.event,
      eventId: payload.eventId
    }), { status: 202 })
  }
  try {
    const service = await import(`../src/services/webhookService.js?member-removal-test=${Date.now()}`)
    await service.notifyOrgMemberRemoved({
      organizationId: 'idp-org-a',
      memberId: 'member-record-a',
      accountId: 'account-a',
      subject: 'stable-subject-a',
      email: 'person@example.test'
    })
    assert.equal(bodies.length, 6)
    assert.deepEqual(bodies[0].data, {
      userId: 'stable-subject-a',
      subject: 'stable-subject-a',
      email: 'person@example.test',
      accountId: 'account-a',
      memberId: 'member-record-a',
      organizationId: 'idp-org-a',
      action: 'removed'
    })
    const routeSource = fs.readFileSync(new URL('../src/routes/members.js', import.meta.url), 'utf8')
    assert.equal((routeSource.match(/event: 'organization\.member\.removed'/g) || []).length, 2)
    assert.equal((routeSource.match(/await webhookService\.runAuthorizationMutationWithWebhook\(/g) || []).length, 4)
    assert.match(routeSource, /event: 'organization\.member\.role_changed'/)
    // Role/app-access changes plus both removal paths invalidate cached OIDC claims.
    assert.equal((routeSource.match(/invalidateClaimsCache\((targetAccount|leavingAccount)\.sub\)/g) || []).length, 4)
  } finally {
    global.fetch = priorFetch
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})
