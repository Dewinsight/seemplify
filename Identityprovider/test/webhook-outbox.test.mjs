import assert from 'node:assert/strict'
import test from 'node:test'

function acknowledged(init, status = 202) {
  const payload = JSON.parse(init.body)
  return new Response(JSON.stringify({
    received: true,
    event: payload.event,
    eventId: payload.eventId
  }), { status, headers: { 'content-type': 'application/json' } })
}

test('durable webhook records retry transient non-2xx delivery and keep the same event id', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  try {
    const service = await import(`../src/services/webhookService.js?outbox-test=${Date.now()}`)
    const payload = {
      eventId: '19fdc60c-6b17-44c3-9e69-048255cd6e4c',
      event: 'organization.member.removed',
      occurredAt: '2026-08-09T12:00:00.000Z',
      timestamp: '2026-08-09T12:00:00.000Z',
      data: { userId: 'stable-subject-a', organizationId: 'idp-org-a' },
      idpVersion: '1.0'
    }
    const record = {
      payload,
      status: 'processing',
      attempts: 0,
      async save() { this.saved = (this.saved || 0) + 1 }
    }
    await service.processWebhookOutboxRecord(record, {
      fetchImpl: async () => new Response('{}', { status: 500 }),
      now: () => new Date('2026-08-09T12:00:01.000Z')
    })
    assert.equal(record.status, 'pending')
    assert.equal(record.attempts, 1)
    assert.equal(record.payload.eventId, payload.eventId)

    await service.processWebhookOutboxRecord(record, {
      fetchImpl: async (_url, init) => acknowledged(init),
      now: () => new Date('2026-08-09T12:00:04.000Z')
    })
    assert.equal(record.status, 'delivered')
    assert.equal(record.payload.eventId, payload.eventId)
    assert.equal(record.saved, 2)
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})

test('durable webhook retries only failed consumers after partial fanout', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  try {
    const service = await import(`../src/services/webhookService.js?partial-fanout=${Date.now()}`)
    const payload = {
      eventId: '29fdc60c-6b17-44c3-9e69-048255cd6e4c',
      event: 'organization.member.app_access_changed',
      occurredAt: '2026-08-09T12:00:00.000Z',
      timestamp: '2026-08-09T12:00:00.000Z',
      data: { userId: 'stable-subject-b', organizationId: 'idp-org-b' },
      idpVersion: '1.0'
    }
    const record = {
      payload,
      status: 'processing',
      attempts: 0,
      async save() { this.saved = (this.saved || 0) + 1 }
    }
    const calls = new Map()
    const fetchImpl = async (url, init) => {
      calls.set(url, (calls.get(url) || 0) + 1)
      const isTransientFailure = url.includes(':3001/') && calls.get(url) === 1
      return isTransientFailure
        ? new Response('{}', { status: 500 })
        : acknowledged(init)
    }

    await service.processWebhookOutboxRecord(record, {
      fetchImpl,
      now: () => new Date('2026-08-09T12:00:01.000Z')
    })
    const deliveredAfterFirstAttempt = record.deliveries.filter(item => item.status === 'delivered')
    const pendingAfterFirstAttempt = record.deliveries.filter(item => item.status === 'pending')
    assert.equal(deliveredAfterFirstAttempt.length, 5)
    assert.equal(pendingAfterFirstAttempt.length, 1)

    await service.processWebhookOutboxRecord(record, {
      fetchImpl,
      now: () => new Date('2026-08-09T12:00:04.000Z')
    })
    assert.equal(record.status, 'delivered')
    assert.equal(record.deliveries.every(item => item.status === 'delivered'), true)
    for (const [url, count] of calls) {
      assert.equal(count, url.includes(':3001/') ? 2 : 1)
    }
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})

test('a 2xx proxy page is not a webhook acknowledgement and remains pending', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  try {
    const service = await import(`../src/services/webhookService.js?false-ack=${Date.now()}`)
    const record = {
      event: 'organization.member.removed',
      payload: {
        eventId: '49fdc60c-6b17-44c3-9e69-048255cd6e4c',
        event: 'organization.member.removed',
        occurredAt: '2026-08-09T12:00:00.000Z',
        timestamp: '2026-08-09T12:00:00.000Z',
        data: { userId: 'stable-subject-d', organizationId: 'idp-org-d' },
        idpVersion: '1.0'
      },
      status: 'processing',
      attempts: 0,
      async save() {}
    }
    await service.processWebhookOutboxRecord(record, {
      fetchImpl: async () => new Response('<html>proxy page</html>', { status: 200 }),
      now: () => new Date('2026-08-09T12:00:01.000Z')
    })
    assert.equal(record.status, 'pending')
    assert.equal(record.deliveries.every(delivery => delivery.status === 'pending'), true)
    assert.match(record.deliveries[0].lastError, /Invalid webhook acknowledgement/)
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})

test('authorization invalidations never expire or become dead after the retry threshold', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  const priorAttempts = process.env.IDP_WEBHOOK_MAX_ATTEMPTS
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  process.env.IDP_WEBHOOK_MAX_ATTEMPTS = '1'
  try {
    const service = await import(`../src/services/webhookService.js?guaranteed-delivery=${Date.now()}`)
    const record = {
      event: 'organization.member.app_access_changed',
      payload: {
        eventId: '39fdc60c-6b17-44c3-9e69-048255cd6e4c',
        event: 'organization.member.app_access_changed',
        occurredAt: '2026-08-09T12:00:00.000Z',
        timestamp: '2026-08-09T12:00:00.000Z',
        data: { userId: 'stable-subject-c', organizationId: 'idp-org-c' },
        idpVersion: '1.0'
      },
      status: 'processing',
      attempts: 0,
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
      async save() {}
    }

    await service.processWebhookOutboxRecord(record, {
      fetchImpl: async () => new Response('{}', { status: 503 }),
      now: () => new Date('2026-08-09T12:00:01.000Z')
    })

    assert.equal(record.status, 'pending')
    assert.equal(record.deliveries.every(delivery => delivery.status === 'pending'), true)
    assert.equal(record.expiresAt, null)
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
    if (priorAttempts === undefined) delete process.env.IDP_WEBHOOK_MAX_ATTEMPTS
    else process.env.IDP_WEBHOOK_MAX_ATTEMPTS = priorAttempts
  }
})

test('production authorization mutation and outbox insertion share one transaction', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  try {
    const service = await import(`../src/services/webhookService.js?transaction=${Date.now()}`)
    const events = []
    const session = {
      id: 'session-a',
      async withTransaction(callback, options) {
        events.push(['begin', options])
        await callback()
        events.push(['commit'])
      },
      async endSession() { events.push(['end']) }
    }
    const outboxModel = {
      async create(records, options) {
        events.push(['outbox', records[0].event, options.session])
        assert.equal(options.session, session)
      }
    }
    await service.runAuthorizationMutationWithWebhook({
      event: 'organization.member.removed',
      data: { userId: 'stable-subject-c', organizationId: 'idp-org-c' },
      mutation: async receivedSession => {
        assert.equal(receivedSession, session)
        events.push(['mutation'])
      }
    }, {
      environment: 'production',
      sessionFactory: async () => session,
      outboxModel,
      scheduleDrain: false
    })
    assert.deepEqual(events.map(entry => entry[0]), ['begin', 'mutation', 'outbox', 'commit', 'end'])
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})

test('production authorization mutation fails closed when outbox insertion aborts', async () => {
  const priorSecret = process.env.IDP_WEBHOOK_SECRET
  process.env.IDP_WEBHOOK_SECRET = 'idp-webhook-outbox-test-secret-32-chars'
  try {
    const service = await import(`../src/services/webhookService.js?rollback=${Date.now()}`)
    let committed = false
    let mutationStaged = false
    let sessionEnded = false
    const session = {
      async withTransaction(callback) {
        try {
          await callback()
          committed = mutationStaged
        } catch (error) {
          mutationStaged = false
          throw error
        }
      },
      async endSession() { sessionEnded = true }
    }
    await assert.rejects(
      service.runAuthorizationMutationWithWebhook({
        event: 'organization.member.app_access_changed',
        data: { userId: 'stable-subject-d', organizationId: 'idp-org-d' },
        mutation: async receivedSession => {
          assert.equal(receivedSession, session)
          mutationStaged = true
        }
      }, {
        environment: 'production',
        sessionFactory: async () => session,
        outboxModel: { async create() { throw new Error('outbox unavailable') } },
        scheduleDrain: false
      }),
      /outbox unavailable/
    )
    assert.equal(committed, false)
    assert.equal(mutationStaged, false)
    assert.equal(sessionEnded, true)
  } finally {
    if (priorSecret === undefined) delete process.env.IDP_WEBHOOK_SECRET
    else process.env.IDP_WEBHOOK_SECRET = priorSecret
  }
})
