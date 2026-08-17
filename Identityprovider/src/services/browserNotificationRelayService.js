import crypto from 'crypto'
import webpush from 'web-push'

import BrowserNotificationEvent from '../models/BrowserNotificationEvent.js'
import BrowserPushSubscription from '../models/BrowserPushSubscription.js'
import BrowserRelayNonce from '../models/BrowserRelayNonce.js'

const objectIdPattern = /^[a-f\d]{24}$/i
const subjectPattern = /^[\w:./@-]{3,200}$/
const identifierPattern = /^[\w:.-]{3,200}$/
const callKinds = new Set(['direct_call', 'voice_invite', 'meeting_invite'])

const bounded = (value, maximum, fallback = '') => {
  const normalized = typeof value === 'string' ? value : fallback
  return normalized.slice(0, maximum)
}

const safeDate = (value, fallback = null) => {
  if (value == null || value === '') return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

export const normalizeRelayIdentity = (value) => {
  const idpSubject = String(value?.idpSubject || '')
  if (!subjectPattern.test(idpSubject)) throw Object.assign(new Error('An Identity subject is required.'), { status: 400 })
  const organizationId = value?.organizationId == null ? null : String(value.organizationId)
  if (organizationId && !identifierPattern.test(organizationId)) {
    throw Object.assign(new Error('The organization identifier is invalid.'), { status: 400 })
  }
  return { idpSubject, organizationId }
}

export const normalizeRelayEvent = (value) => {
  if (value?.version !== 1 || !identifierPattern.test(String(value?.eventId || ''))) {
    throw Object.assign(new Error('A versioned event identifier is required.'), { status: 400 })
  }
  const kind = bounded(value.kind, 80)
  if (!identifierPattern.test(kind)) throw Object.assign(new Error('The event kind is invalid.'), { status: 400 })
  const callId = value.callId == null ? null : bounded(value.callId, 200)
  if (callId && !identifierPattern.test(callId)) throw Object.assign(new Error('The call identifier is invalid.'), { status: 400 })
  const deepLink = bounded(value.deepLink, 500, '/messaging')
  if (!deepLink.startsWith('/') || deepLink.startsWith('//')) {
    throw Object.assign(new Error('Only first-party relative deep links are allowed.'), { status: 400 })
  }
  return {
    version: 1,
    eventId: bounded(value.eventId, 200),
    kind,
    title: bounded(value.title, 120, 'Seemplify Workspace'),
    body: bounded(value.body, 240, 'Open Workspace to view this update.'),
    deepLink,
    conversationId: value.conversationId == null ? null : bounded(value.conversationId, 160),
    callId,
    occurredAt: safeDate(value.occurredAt, new Date()),
    expiresAt: safeDate(value.expiresAt),
    urgent: value.urgent === true,
    silent: value.silent === true
  }
}

export const verifyRelayRequest = async (req, env = process.env, now = Date.now()) => {
  const keyId = String(req.get('x-seemplify-key-id') || '')
  const timestamp = String(req.get('x-seemplify-timestamp') || '')
  const nonce = String(req.get('x-seemplify-nonce') || '')
  const signature = String(req.get('x-seemplify-signature') || '')
  const expectedKeyId = String(env.SEEMPLIFY_NOTIFICATION_RELAY_KEY_ID || '')
  const secret = String(env.SEEMPLIFY_NOTIFICATION_RELAY_HMAC_KEY || '')
  if (!expectedKeyId || !secret || keyId !== expectedKeyId) {
    throw Object.assign(new Error('Relay authentication failed.'), { status: 401 })
  }
  const timestampNumber = Number(timestamp)
  if (!Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber) > 5 * 60 * 1000) {
    throw Object.assign(new Error('Relay request timestamp is outside the allowed window.'), { status: 401 })
  }
  if (!/^[\w-]{12,200}$/.test(nonce) || !/^[\w-]{32,200}$/.test(signature)) {
    throw Object.assign(new Error('Relay authentication failed.'), { status: 401 })
  }
  const body = JSON.stringify(req.body || {})
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${body}`, 'utf8')
    .digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw Object.assign(new Error('Relay authentication failed.'), { status: 401 })
  }
  try {
    await BrowserRelayNonce.create({ keyId, nonce, expiresAt: new Date(now + 5 * 60 * 1000) })
  } catch (error) {
    if (error?.code === 11000) throw Object.assign(new Error('Relay request was already used.'), { status: 409 })
    throw error
  }
}

const configureWebPush = (env = process.env) => {
  const subject = env.WEB_PUSH_SUBJECT
  const publicKey = env.WEB_PUSH_PUBLIC_KEY
  const privateKey = env.WEB_PUSH_PRIVATE_KEY
  if (!subject || !publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

export const upsertRelaySubscription = async (payload) => {
  const identity = normalizeRelayIdentity(payload?.identity)
  const deviceId = String(payload?.deviceId || '')
  const appId = String(payload?.appId || '')
  const subscription = payload?.subscription || {}
  if (!identifierPattern.test(deviceId) || !identifierPattern.test(appId)) {
    throw Object.assign(new Error('The browser device is invalid.'), { status: 400 })
  }
  const endpoint = String(subscription.endpoint || '')
  let endpointUrl
  try { endpointUrl = new URL(endpoint) } catch { endpointUrl = null }
  if (!endpointUrl || endpointUrl.protocol !== 'https:' || endpoint.length > 2048) {
    throw Object.assign(new Error('The Web Push endpoint is invalid.'), { status: 400 })
  }
  const p256dh = String(subscription.keys?.p256dh || '')
  const auth = String(subscription.keys?.auth || '')
  if (!/^[\w-]{40,200}$/.test(p256dh) || !/^[\w-]{16,100}$/.test(auth)) {
    throw Object.assign(new Error('The Web Push keys are invalid.'), { status: 400 })
  }
  const record = await BrowserPushSubscription.findOneAndUpdate(
    { idpSubject: identity.idpSubject, appId, deviceId },
    {
      $set: {
        organizationId: identity.organizationId,
        endpoint,
        expirationTime: safeDate(subscription.expirationTime),
        keys: { p256dh, auth },
        userAgentHash: bounded(payload.userAgentHash, 128),
        lastConfirmedAt: new Date(),
        failureCount: 0
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean()
  return { subscriptionId: String(record._id) }
}

export const removeRelaySubscription = async (identityValue, deviceId) => {
  const identity = normalizeRelayIdentity(identityValue)
  await BrowserPushSubscription.deleteMany({ idpSubject: identity.idpSubject, deviceId: String(deviceId || '') })
}

const deliverPush = async (subscription, event, env) => {
  if (!configureWebPush(env)) return { delivered: false, reason: 'web_push_not_configured' }
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(event),
      { TTL: callKinds.has(event.kind) ? 45 : 300, urgency: event.urgent ? 'high' : 'normal' }
    )
    await BrowserPushSubscription.updateOne(
      { _id: subscription._id },
      { $set: { lastDeliveredAt: new Date(), failureCount: 0 } }
    )
    return { delivered: true }
  } catch (error) {
    if ([404, 410].includes(error?.statusCode)) {
      await BrowserPushSubscription.deleteOne({ _id: subscription._id })
      return { delivered: false, reason: 'expired' }
    }
    await BrowserPushSubscription.updateOne({ _id: subscription._id }, { $inc: { failureCount: 1 } })
    return { delivered: false, reason: 'failed' }
  }
}

export const publishRelayEvent = async (payload, env = process.env) => {
  const identity = normalizeRelayIdentity(payload?.identity)
  const event = normalizeRelayEvent(payload?.event)
  let created
  try {
    created = await BrowserNotificationEvent.create({
      idpSubject: identity.idpSubject,
      organizationId: identity.organizationId,
      ...event
    })
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true, delivered: 0 }
    throw error
  }
  const query = { idpSubject: identity.idpSubject }
  if (identity.organizationId) query.$or = [{ organizationId: identity.organizationId }, { organizationId: null }]
  const subscriptions = await BrowserPushSubscription.find(query).lean()
  const results = await Promise.all(subscriptions.map((subscription) => deliverPush(subscription, event, env)))
  return { eventId: String(created._id), duplicate: false, delivered: results.filter((result) => result.delivered).length }
}

export const listRelayEvents = async (idpSubject, after, limit = 30) => {
  if (!subjectPattern.test(String(idpSubject || ''))) return []
  const afterDate = safeDate(after, new Date(Date.now() - 30 * 1000))
  const now = new Date()
  const records = await BrowserNotificationEvent.find({
    idpSubject,
    occurredAt: { $gt: afterDate },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).sort({ occurredAt: 1 }).limit(Math.min(100, Math.max(1, Number(limit) || 30))).lean()
  return records.map((record) => ({
    version: 1,
    eventId: record.eventId,
    kind: record.kind,
    title: record.title,
    body: record.body,
    deepLink: record.deepLink,
    callId: record.callId,
    occurredAt: record.occurredAt,
    expiresAt: record.expiresAt,
    silent: record.silent
  }))
}
