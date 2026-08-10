import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  createMongoWebhookReadinessNonceClaimer,
  createWebhookReadinessVerifier,
  NONCE_TTL_MS,
  READINESS_PATH
} from '../src/middleware/webhookReadinessAuth.js'
import WebhookReadinessNonce from '../src/models/WebhookReadinessNonce.js'

const NOW = 1786291200000
const SECRET = 'idp-webhook-readiness-secret-at-least-32-characters'
const BODY = '{}'

function sign({
  timestamp = String(NOW),
  nonce = 'readinessNonce0001',
  secret = SECRET,
  body = BODY
} = {}) {
  return crypto.createHmac('sha256', secret)
    .update([timestamp, nonce, 'POST', READINESS_PATH, body].join('\n'))
    .digest('hex')
}

async function invoke(verifier, {
  timestamp = String(NOW),
  nonce = 'readinessNonce0001',
  secret = SECRET,
  body = BODY
} = {}) {
  const headers = {
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': sign({ timestamp, nonce, secret, body })
  }
  const req = {
    body: JSON.parse(body),
    get(name) {
      return headers[String(name).toLowerCase()]
    }
  }
  const result = { next: false, payload: null, statusCode: null }
  const res = {
    status(statusCode) {
      result.statusCode = statusCode
      return this
    },
    json(payload) {
      result.payload = payload
      return this
    }
  }

  await verifier(req, res, () => {
    result.next = true
  })
  return result
}

function createSharedFakeMongoModel() {
  const documents = new Map()
  let initCalls = 0

  return {
    get initCalls() {
      return initCalls
    },
    documents,
    purgeExpired(currentTime) {
      for (const [key, document] of documents) {
        if (document.expiresAt.getTime() <= currentTime) documents.delete(key)
      }
    },
    async init() {
      initCalls += 1
      return this
    },
    async create(document) {
      if (documents.has(document.key)) {
        const error = new Error('duplicate key')
        error.code = 11000
        throw error
      }
      documents.set(document.key, document)
      return document
    }
  }
}

function createVerifier(claimNonce, now = () => NOW) {
  return createWebhookReadinessVerifier({
    now,
    resolveSecret: () => SECRET,
    claimNonce,
    logger: { error() {} }
  })
}

test('Mongo claim rejects a replay across two IdP verifier instances', async () => {
  const nonceModel = createSharedFakeMongoModel()
  // Each claimer owns its own index-initialization state, like two processes,
  // while both models write to the same durable Mongo collection.
  const verifierA = createVerifier(createMongoWebhookReadinessNonceClaimer({ nonceModel }))
  const verifierB = createVerifier(createMongoWebhookReadinessNonceClaimer({ nonceModel }))

  const accepted = await invoke(verifierA)
  assert.equal(accepted.next, true)

  const replay = await invoke(verifierB)
  assert.equal(replay.next, false)
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.payload.code, 'WEBHOOK_READINESS_REPLAYED')
  assert.equal(nonceModel.documents.size, 1)
  assert.equal(nonceModel.initCalls, 2)
})

test('durable Mongo claim still rejects replay after a simulated IdP restart', async () => {
  const nonceModel = createSharedFakeMongoModel()
  const beforeRestart = createVerifier(createMongoWebhookReadinessNonceClaimer({ nonceModel }))
  assert.equal((await invoke(beforeRestart)).next, true)

  // Recreate both the claimer and verifier to discard every process-local
  // reference. Only the fake Mongo collection survives the restart.
  const afterRestart = createVerifier(createMongoWebhookReadinessNonceClaimer({ nonceModel }))
  const replay = await invoke(afterRestart)
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.payload.code, 'WEBHOOK_READINESS_REPLAYED')
  assert.equal(nonceModel.documents.size, 1)
})

test('readiness authentication fails closed when the Mongo replay guard is unavailable', async () => {
  const verifier = createVerifier(async () => {
    throw new Error('database unavailable')
  })

  const response = await invoke(verifier)
  assert.equal(response.next, false)
  assert.equal(response.statusCode, 503)
  assert.equal(response.payload.code, 'WEBHOOK_READINESS_REPLAY_GUARD_UNAVAILABLE')
})

test('invalid signatures do not consume a replay nonce', async () => {
  let claims = 0
  const verifier = createVerifier(async () => {
    claims += 1
    return true
  })

  const response = await invoke(verifier, { secret: 'wrong-secret' })
  assert.equal(response.statusCode, 401)
  assert.equal(response.payload.code, 'WEBHOOK_READINESS_AUTH_INVALID')
  assert.equal(claims, 0)
})

test('readiness nonce model has unique-key and TTL indexes', () => {
  const indexes = WebhookReadinessNonce.schema.indexes()
  const uniqueKey = indexes.find(([fields]) => fields.key === 1)
  const ttl = indexes.find(([fields]) => fields.expiresAt === 1)

  assert.equal(uniqueKey?.[1]?.unique, true)
  assert.equal(ttl?.[1]?.expireAfterSeconds, 0)
  assert.equal(WebhookReadinessNonce.schema.options.autoIndex, true)
})

test('claimed nonce expiry matches the signed-request acceptance window', async () => {
  let claim
  const verifier = createVerifier(async (key, expiresAt) => {
    claim = { key, expiresAt }
    return true
  })

  assert.equal((await invoke(verifier)).next, true)
  assert.deepEqual(claim, {
    key: 'webhook-readiness:readinessNonce0001',
    expiresAt: NOW + NONCE_TTL_MS
  })
})

test('future-skewed timestamps retain the nonce through their entire acceptance window', async () => {
  const futureTimestamp = NOW + NONCE_TTL_MS - 1_000
  let expiresAt
  const verifier = createVerifier(async (_key, claimedUntil) => {
    expiresAt = claimedUntil
    return true
  })

  const response = await invoke(verifier, {
    timestamp: String(futureTimestamp),
    nonce: 'futureSkewNonce001'
  })
  assert.equal(response.next, true)
  assert.equal(expiresAt, futureTimestamp + NONCE_TTL_MS)
  assert.ok(expiresAt > NOW + NONCE_TTL_MS)
})

test('future-skewed signed request remains replay-blocked after one local TTL window', async () => {
  const futureTimestamp = NOW + NONCE_TTL_MS - 1_000
  const replayTime = NOW + NONCE_TTL_MS + 1_000
  const nonce = 'futureReplayNonce01'
  const nonceModel = createSharedFakeMongoModel()

  const beforeRestart = createVerifier(
    createMongoWebhookReadinessNonceClaimer({ nonceModel }),
    () => NOW
  )
  assert.equal((await invoke(beforeRestart, {
    timestamp: String(futureTimestamp),
    nonce
  })).next, true)

  // Simulate the TTL monitor and a process restart after five local minutes.
  // The signed request remains fresh because its timestamp was in the future,
  // so the durable claim must still exist and reject it.
  nonceModel.purgeExpired(replayTime)
  const afterRestart = createVerifier(
    createMongoWebhookReadinessNonceClaimer({ nonceModel }),
    () => replayTime
  )
  const replay = await invoke(afterRestart, {
    timestamp: String(futureTimestamp),
    nonce
  })
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.payload.code, 'WEBHOOK_READINESS_REPLAYED')
})
