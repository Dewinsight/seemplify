import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

test('member app-access changes are delivered as a signed cross-product webhook', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  const priorFetch = global.fetch
  process.env.IDP_WEBHOOK_SECRET = 'idp-app-access-test-secret-32-characters'
  const requests = []
  global.fetch = async (url, init) => {
    requests.push({ url, init })
    const payload = JSON.parse(init.body)
    return new Response(JSON.stringify({
      received: true,
      event: payload.event,
      eventId: payload.eventId
    }), { status: 202, headers: { 'content-type': 'application/json' } })
  }
  try {
    const service = await import(`../src/services/webhookService.js?app-access-test=${Date.now()}`)
    await service.notifyOrgMemberAppAccessChanged({
      organizationId: 'idp-org-42',
      memberId: 'member-record-42',
      accountId: 'account-42',
      subject: 'stable-subject-42',
      email: 'member@example.test',
      appAccess: { mode: 'selected', appIds: ['performance-management'] },
      changedBy: 'admin-7'
    })
    assert.equal(requests.length, 4)
    for (const { init } of requests) {
      const payload = JSON.parse(init.body)
      assert.equal(payload.event, 'organization.member.app_access_changed')
      assert.match(payload.eventId, /^[a-f0-9-]{20,80}$/i)
      assert.equal(payload.occurredAt, payload.timestamp)
      assert.deepEqual(payload.data, {
        userId: 'stable-subject-42',
        organizationId: 'idp-org-42',
        memberId: 'member-record-42',
        accountId: 'account-42',
        subject: 'stable-subject-42',
        email: 'member@example.test',
        appAccess: { mode: 'selected', appIds: ['performance-management'] },
        changedBy: 'admin-7',
        action: 'app_access_changed'
      })
      const expected = crypto.createHmac('sha256', 'idp-app-access-test-secret-32-characters')
        .update(init.body)
        .digest('hex')
      assert.equal(init.headers['X-IDP-Event'], 'organization.member.app_access_changed')
      assert.equal(init.headers['X-IDP-Signature'], expected)
      const deliveryExpected = crypto.createHmac('sha256', 'idp-app-access-test-secret-32-characters')
        .update(`${init.headers['X-IDP-Delivery-Timestamp']}\n${init.body}`)
        .digest('hex')
      assert.equal(init.headers['X-IDP-Signature-V2'], deliveryExpected)
    }
    const routeSource = fs.readFileSync(new URL('../src/routes/members.js', import.meta.url), 'utf8')
    const transactionAt = routeSource.indexOf('await webhookService.runAuthorizationMutationWithWebhook')
    const invalidationAt = routeSource.indexOf('invalidateClaimsCache(targetAccount.sub)')
    assert.ok(transactionAt >= 0 && transactionAt < invalidationAt)
  } finally {
    global.fetch = priorFetch
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})
