/**
 * IDP Webhook Service
 * Sends real-time notifications to connected backends when team/org membership changes
 *
 * This enables backends to immediately update user sessions when:
 * - User is added/removed from a team
 * - User's team role changes
 * - User is added/removed from an organization
 * - Manager changes for a team
 * - Admin requests force logout
 */

import crypto from 'crypto'
import fs from 'fs'
import mongoose from 'mongoose'
import WebhookOutbox from '../models/WebhookOutbox.js'

// Registered webhook endpoints for each backend
const WEBHOOK_ENDPOINTS = {
  smarthr: process.env.SMARTHR_WEBHOOK_URL || 'http://localhost:3001/api/webhooks/idp',
  // Backends (not frontends). These defaults should match local dev ports for each service.
  leaveManagement: process.env.LEAVE_WEBHOOK_URL || 'http://localhost:5002/api/webhooks/idp',
  payroll: process.env.PAYROLL_WEBHOOK_URL || 'http://localhost:5006/api/webhooks/idp',
  performance: process.env.PERFORMANCE_WEBHOOK_URL || 'http://localhost:5004/api/webhooks/idp',
  timeAttendance: process.env.TIME_ATTENDANCE_WEBHOOK_URL || 'http://localhost:5010/api/webhooks/idp',
  recruiter: process.env.RECRUITER_WEBHOOK_URL || 'http://localhost:5001/api/webhooks/idp-lifecycle',
  messaging: process.env.MESSAGING_WEBHOOK_URL || 'http://localhost:3333/api/webhooks/idp',
  approver: process.env.APPROVER_WEBHOOK_URL || 'http://localhost:5000/api/webhooks/idp',
  workspaceAutomation: process.env.WORKSPACE_AUTOMATION_WEBHOOK_URL || 'http://localhost:3333/hooks/identity',
}

const INSECURE_WEBHOOK_SECRET = 'your-webhook-secret-key'
const WEBHOOK_TARGET_SECRET_ENV = {
  smarthr: 'IDP_WEBHOOK_SECRET_RECRUITER',
  leaveManagement: 'IDP_WEBHOOK_SECRET_LEAVE_MANAGEMENT',
  payroll: 'IDP_WEBHOOK_SECRET_PAYROLL',
  performance: 'IDP_WEBHOOK_SECRET_PERFORMANCE_MANAGEMENT',
  timeAttendance: 'IDP_WEBHOOK_SECRET_TIME_ATTENDANCE',
  recruiter: 'IDP_WEBHOOK_SECRET_RECRUITER',
  messaging: 'IDP_WEBHOOK_SECRET_MESSAGING',
  approver: 'IDP_WEBHOOK_SECRET_APPROVER',
  workspaceAutomation: 'WORKSPACE_AUTOMATION_HMAC_SECRET'
}
const WEBHOOK_TARGET_SECRET_FILE_ENV = {
  workspaceAutomation: 'WORKSPACE_AUTOMATION_HMAC_SECRET_FILE'
}

export function resolveWebhookSecret(source = process.env) {
  const value = String(source.IDP_WEBHOOK_SECRET || '').trim()
  const production = String(source.NODE_ENV || '').trim().toLowerCase() === 'production'
  if (production && (value.length < 32 || value === INSECURE_WEBHOOK_SECRET)) {
    throw new Error('IDP_WEBHOOK_SECRET must be a rotated secret of at least 32 characters in production')
  }
  return value || INSECURE_WEBHOOK_SECRET
}

export function resolveWebhookSecretForTarget(targetName, source = process.env) {
  const environmentName = WEBHOOK_TARGET_SECRET_ENV[targetName]
  const fileEnvironmentName = WEBHOOK_TARGET_SECRET_FILE_ENV[targetName]
  const secretFile = String(fileEnvironmentName ? source[fileEnvironmentName] || '' : '').trim()
  const fromFile = secretFile ? fs.readFileSync(secretFile, 'utf8').trim() : ''
  const explicit = String(environmentName ? source[environmentName] || '' : '').trim()
  const production = String(source.NODE_ENV || '').trim().toLowerCase() === 'production'
  const resolved = fromFile || explicit
  if (resolved) {
    if (production && (resolved.length < 32 || resolved === INSECURE_WEBHOOK_SECRET)) {
      throw new Error(`${fileEnvironmentName || environmentName} must contain a rotated secret of at least 32 characters in production`)
    }
    return resolved
  }
  if (production) {
    throw new Error(`${fileEnvironmentName || environmentName || 'Target webhook secret'} is required in production`)
  }
  // Local development retains the single-key setup unless explicit target
  // keys are provided. Production is always isolated per destination.
  return resolveWebhookSecret(source)
}
const WEBHOOK_TIMEOUT = 5000 // 5 second timeout
const WEBHOOK_MAX_ATTEMPTS = Math.max(1, Number(process.env.IDP_WEBHOOK_MAX_ATTEMPTS || 12))
let outboxInterval = null

const AUTHORIZATION_INVALIDATION_EVENTS = new Set([
  'organization.access_control.updated',
  'organization.member.removed',
  'organization.member.app_access_changed',
  'organization.member.app_access_updated',
  'organization.member.role_changed',
  'team.member.removed',
  'team.member.role_changed',
  'user.session.invalidate'
])

function requiresGuaranteedDelivery(event) {
  return AUTHORIZATION_INVALIDATION_EVENTS.has(String(event || ''))
}

export function createWebhookPayload(event, data) {
  const occurredAt = new Date().toISOString()
  return {
    eventId: crypto.randomUUID(),
    event,
    data,
    occurredAt,
    timestamp: occurredAt,
    idpVersion: '1.0',
  }
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret || resolveWebhookSecret())
  hmac.update(JSON.stringify(payload))
  return hmac.digest('hex')
}

function generateDeliverySignature(payload, deliveryTimestamp, secret) {
  return crypto.createHmac('sha256', secret || resolveWebhookSecret())
    .update(`${deliveryTimestamp}\n${JSON.stringify(payload)}`)
    .digest('hex')
}

async function requireWebhookAcknowledgement(response, payload) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  let acknowledgement
  try {
    acknowledgement = await response.json()
  } catch {
    throw new Error('Invalid webhook acknowledgement: response was not JSON')
  }
  if (acknowledgement?.received !== true
      || acknowledgement.event !== payload.event
      || acknowledgement.eventId !== payload.eventId) {
    throw new Error('Invalid webhook acknowledgement: event identity did not match')
  }
  return acknowledgement
}

function webhookDeliveryTargets() {
  return Object.entries(WEBHOOK_ENDPOINTS)
    .filter(([, url]) => Boolean(url))
    .map(([name, url]) => ({
      name,
      url,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date()
    }))
}

async function deliverWebhookTarget(payload, target, { fetchImpl = fetch } = {}) {
  const secret = resolveWebhookSecretForTarget(target.name)
  const signature = generateSignature(payload, secret)
  // The delivery timestamp is refreshed for every retry while occurredAt and
  // eventId remain immutable. That allows recovery after an extended outage
  // without weakening event identity or replay handling.
  const deliveryTimestamp = new Date().toISOString()
  const deliverySignature = generateDeliverySignature(payload, deliveryTimestamp, secret)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT)
  try {
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IDP-Signature': signature,
        'X-IDP-Signature-V2': deliverySignature,
        'X-IDP-Delivery-Timestamp': deliveryTimestamp,
        'X-IDP-Event': payload.event,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    await requireWebhookAcknowledgement(response, payload)
    return { name: target.name, success: true, status: response.status }
  } catch (error) {
    return { name: target.name, success: false, error: error.message }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Send webhook to all registered backends
 */
async function legacyDeliverWebhookPayload(payload, { fetchImpl = fetch } = {}) {
  const deliveryTimestamp = new Date().toISOString()

  const results = await Promise.allSettled(
    Object.entries(WEBHOOK_ENDPOINTS).map(async ([name, url]) => {
      if (!url) return { name, skipped: true }
      const secret = resolveWebhookSecretForTarget(name)
      const signature = generateSignature(payload, secret)
      const deliverySignature = generateDeliverySignature(payload, deliveryTimestamp, secret)

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT)

        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-IDP-Signature': signature,
            'X-IDP-Signature-V2': deliverySignature,
            'X-IDP-Delivery-Timestamp': deliveryTimestamp,
            'X-IDP-Event': payload.event,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        await requireWebhookAcknowledgement(response, payload)

        console.log(`✅ Webhook sent to ${name}:`, response.status)
        return { name, success: true, status: response.status }
      } catch (error) {
        console.error(`❌ Webhook failed for ${name}:`, error.message)
        return { name, success: false, error: error.message }
      }
    })
  )

  const failures = results.filter(result => (
    result.status === 'rejected' || result.value?.success === false
  ))
  if (failures.length) throw new Error(`Webhook delivery failed for ${failures.length} endpoint(s)`)
  return results
}

async function legacyProcessWebhookOutboxRecord(record, { fetchImpl = fetch, now = () => new Date() } = {}) {
  try {
    await deliverWebhookPayload(record.payload, { fetchImpl })
    record.status = 'delivered'
    record.deliveredAt = now()
    record.leaseExpiresAt = null
    record.lastError = ''
  } catch (error) {
    record.attempts = Number(record.attempts || 0) + 1
    record.status = record.attempts >= WEBHOOK_MAX_ATTEMPTS ? 'dead' : 'pending'
    record.leaseExpiresAt = null
    record.lastError = String(error.message || error).slice(0, 1000)
    record.nextAttemptAt = new Date(now().getTime() + Math.min(15 * 60_000, 1000 * (2 ** Math.min(record.attempts, 9))))
  }
  await record.save()
  return record
}

async function deliverWebhookPayload(payload, { fetchImpl = fetch } = {}) {
  const results = await Promise.all(
    webhookDeliveryTargets().map(target => deliverWebhookTarget(payload, target, { fetchImpl }))
  )
  const failures = results.filter(result => result.success === false)
  if (failures.length) throw new Error(`Webhook delivery failed for ${failures.length} endpoint(s)`)
  return results
}

// Live end-to-end key-rotation probe. The caller is separately authenticated
// by the IdP route; this deliberately avoids the durable outbox so a readiness
// check cannot become an authorization event or retry forever.
export async function probeWebhookTargets({ fetchImpl = fetch } = {}) {
  const payload = createWebhookPayload('system.webhook_probe', {
    purpose: 'secret-rotation-readiness'
  })
  const results = await Promise.all(
    webhookDeliveryTargets().map(target => deliverWebhookTarget(payload, target, { fetchImpl }))
  )
  const failures = results.filter(result => result.success === false)
  if (failures.length) {
    const error = new Error(`Webhook readiness failed for: ${failures.map(item => item.name).join(', ')}`)
    error.results = results
    throw error
  }
  return { eventId: payload.eventId, results }
}

export async function processWebhookOutboxRecord(record, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const attemptTime = now()
  const guaranteedDelivery = requiresGuaranteedDelivery(record.event || record.payload?.event)
  if (!Array.isArray(record.deliveries) || record.deliveries.length === 0) {
    // Lazily migrate records queued by a previous release.
    record.deliveries = webhookDeliveryTargets().map(delivery => ({
      ...delivery,
      nextAttemptAt: attemptTime
    }))
  }
  if (guaranteedDelivery) {
    // Revocation/invalidation events are authorization state, not best-effort
    // notifications. Never abandon them after a temporary product outage.
    for (const delivery of record.deliveries) {
      if (delivery.status === 'dead') {
        delivery.status = 'pending'
        delivery.nextAttemptAt = attemptTime
      }
    }
    record.expiresAt = null
  }

  const dueDeliveries = record.deliveries.filter(delivery => (
    delivery.status === 'pending' &&
    (!delivery.nextAttemptAt || new Date(delivery.nextAttemptAt).getTime() <= attemptTime.getTime())
  ))
  const results = await Promise.all(dueDeliveries.map(async delivery => ({
    delivery,
    result: await deliverWebhookTarget(record.payload, delivery, { fetchImpl })
  })))

  for (const { delivery, result } of results) {
    if (result.success) {
      delivery.status = 'delivered'
      delivery.deliveredAt = attemptTime
      delivery.lastError = ''
      continue
    }
    delivery.attempts = Number(delivery.attempts || 0) + 1
    delivery.lastError = String(result.error || 'Webhook delivery failed').slice(0, 1000)
    delivery.status = !guaranteedDelivery && delivery.attempts >= WEBHOOK_MAX_ATTEMPTS ? 'dead' : 'pending'
    delivery.nextAttemptAt = new Date(
      attemptTime.getTime() + Math.min(15 * 60_000, 1000 * (2 ** Math.min(delivery.attempts, 9)))
    )
  }

  const pending = record.deliveries.filter(delivery => delivery.status === 'pending')
  const dead = record.deliveries.filter(delivery => delivery.status === 'dead')
  record.attempts = Math.max(0, ...record.deliveries.map(delivery => Number(delivery.attempts || 0)))
  record.leaseExpiresAt = null
  if (pending.length > 0) {
    record.status = 'pending'
    record.nextAttemptAt = new Date(Math.min(...pending.map(delivery => (
      new Date(delivery.nextAttemptAt || attemptTime).getTime()
    ))))
    record.lastError = dead.length > 0 ? `${dead.length} endpoint(s) exhausted retries` : ''
  } else if (dead.length > 0) {
    record.status = 'dead'
    record.lastError = `${dead.length} endpoint(s) exhausted retries`
  } else {
    record.status = 'delivered'
    record.deliveredAt = attemptTime
    record.lastError = ''
  }
  await record.save()
  return record
}

function outboxRecordForPayload(payload) {
  return {
    eventId: payload.eventId,
    event: payload.event,
    payload,
    deliveries: webhookDeliveryTargets(),
    ...(requiresGuaranteedDelivery(payload.event) ? { expiresAt: null } : {})
  }
}

/**
 * Commit an authorization mutation and its invalidation intent atomically.
 * Production deliberately has no sequential fallback: if MongoDB cannot
 * provide transactions, the authorization mutation is rejected rather than
 * committing a grant/revoke that downstream products never learn about.
 * Local development may use the explicit sequential fallback because a
 * standalone MongoDB is common there.
 */
export async function runAuthorizationMutationWithWebhook({
  event,
  data,
  mutation
}, {
  environment = process.env.NODE_ENV,
  sessionFactory = () => mongoose.startSession(),
  outboxModel = WebhookOutbox,
  scheduleDrain = true
} = {}) {
  if (typeof mutation !== 'function') throw new Error('Authorization mutation callback is required')
  const payload = createWebhookPayload(event, data)
  const production = String(environment || '').trim().toLowerCase() === 'production'
  let result

  if (!production) {
    result = await mutation(null)
    await outboxModel.create(outboxRecordForPayload(payload))
  } else {
    const session = await sessionFactory()
    try {
      await session.withTransaction(async () => {
        result = await mutation(session)
        await outboxModel.create([outboxRecordForPayload(payload)], { session })
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      })
    } finally {
      await session.endSession()
    }
  }

  if (scheduleDrain) {
    queueMicrotask(() => void drainWebhookOutbox().catch(error => (
      console.error('Webhook outbox drain failed:', error.message)
    )))
  }
  return { result, queued: true, eventId: payload.eventId }
}

export async function drainWebhookOutbox({ fetchImpl = fetch, limit = 20 } = {}) {
  let processed = 0
  while (processed < limit) {
    const now = new Date()
    const record = await WebhookOutbox.findOneAndUpdate({
      nextAttemptAt: { $lte: now },
      $or: [
        { status: 'pending' },
        { status: 'processing', leaseExpiresAt: { $lte: now } },
        { status: 'dead', event: { $in: [...AUTHORIZATION_INVALIDATION_EVENTS] } }
      ]
    }, {
      $set: { status: 'processing', leaseExpiresAt: new Date(now.getTime() + 60_000) }
    }, { sort: { nextAttemptAt: 1 }, new: true })
    if (!record) break
    await processWebhookOutboxRecord(record, { fetchImpl })
    processed += 1
  }
  return processed
}

export function startWebhookOutboxWorker(intervalMs = 5000) {
  if (outboxInterval) return outboxInterval
  void drainWebhookOutbox().catch(error => console.error('Webhook outbox initial drain failed:', error.message))
  outboxInterval = setInterval(() => {
    void drainWebhookOutbox().catch(error => console.error('Webhook outbox drain failed:', error.message))
  }, Math.max(1000, intervalMs))
  outboxInterval.unref?.()
  return outboxInterval
}

// Backwards-compatible worker name used by older bootstraps. Both names start
// the same durable per-target outbox worker.
export function startWebhookDeliveryWorker(intervalMs = 5000) {
  return startWebhookOutboxWorker(intervalMs)
}

export async function sendWebhook(event, data) {
  const payload = createWebhookPayload(event, data)
  const durable = String(process.env.IDP_WEBHOOK_OUTBOX_ENABLED || '').toLowerCase() === 'true'
    || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
  if (!durable) return deliverWebhookPayload(payload)
  const record = await WebhookOutbox.create(outboxRecordForPayload(payload))
  queueMicrotask(() => void drainWebhookOutbox().catch(error => console.error('Webhook outbox drain failed:', error.message)))
  return { queued: true, eventId: record.eventId }
}

/**
 * Notify backends when user is added to a team
 */
export async function notifyTeamMemberAdded(userId, teamId, teamData, organizationId) {
  console.log(`📤 [WEBHOOK] team.member.added: user=${userId}, team=${teamId}`)
  return sendWebhook('team.member.added', {
    userId,
    teamId,
    organizationId,
    team: teamData, // Include fresh team claims for this user
    action: 'added',
  })
}

/**
 * Notify backends when user is removed from a team
 */
export async function notifyTeamMemberRemoved(userId, teamId, organizationId) {
  console.log(`📤 [WEBHOOK] team.member.removed: user=${userId}, team=${teamId}`)
  return sendWebhook('team.member.removed', {
    userId,
    teamId,
    organizationId,
    action: 'removed',
  })
}

/**
 * Notify backends when user's team role changes
 */
export async function notifyTeamRoleChanged(userId, teamId, oldRole, newRole, organizationId) {
  console.log(`📤 [WEBHOOK] team.member.role_changed: user=${userId}, ${oldRole} -> ${newRole}`)
  return sendWebhook('team.member.role_changed', {
    userId,
    teamId,
    organizationId,
    oldRole,
    newRole,
    action: 'role_changed',
  })
}

/**
 * Notify backends when user is added to an organization
 */
export async function notifyOrgMemberAdded(userId, organizationId, orgData, role) {
  console.log(`📤 [WEBHOOK] organization.member.added: user=${userId}, org=${organizationId}`)
  return sendWebhook('organization.member.added', {
    userId,
    organizationId,
    organization: orgData,
    role,
    action: 'added',
  })
}

/**
 * Notify backends when user is removed from an organization
 */
export async function notifyOrgMemberRemoved(identityOrUserId, legacyOrganizationId) {
  const identity = typeof identityOrUserId === 'object' && identityOrUserId !== null
    ? identityOrUserId
    : { userId: identityOrUserId, organizationId: legacyOrganizationId }
  const userId = String(identity.subject || identity.userId || '').trim()
  const organizationId = String(identity.organizationId || legacyOrganizationId || '').trim()
  console.log(`📤 [WEBHOOK] organization.member.removed: user=${userId}, org=${organizationId}`)
  return sendWebhook('organization.member.removed', {
    userId,
    subject: userId,
    email: identity.email,
    accountId: identity.accountId,
    memberId: identity.memberId,
    organizationId,
    action: 'removed',
  })
}

/**
 * Notify products immediately when one member's per-app entitlement changes.
 * `subject` is the stable OIDC identity; `accountId` and `memberId` are kept
 * for products that already map the IdP's local records.
 */
export async function notifyOrgMemberAppAccessChanged({
  organizationId,
  memberId,
  accountId,
  subject,
  email,
  appAccess,
  changedBy
}) {
  console.log(`ðŸ“¤ [WEBHOOK] organization.member.app_access_changed: account=${accountId}, org=${organizationId}`)
  return sendWebhook('organization.member.app_access_changed', {
    userId: subject,
    organizationId,
    memberId,
    accountId,
    subject,
    email,
    appAccess,
    changedBy,
    action: 'app_access_changed',
  })
}

/**
 * Notify backends when manager changes for a team
 */
export async function notifyManagerChanged(teamId, oldManagerId, newManagerId, organizationId) {
  console.log(`📤 [WEBHOOK] team.manager.changed: team=${teamId}, ${oldManagerId} -> ${newManagerId}`)
  return sendWebhook('team.manager.changed', {
    teamId,
    organizationId,
    oldManagerId,
    newManagerId,
    action: 'manager_changed',
  })
}

/**
 * Force session invalidation for a user across all backends
 */
export async function forceUserLogout(userId, reason = 'admin_action') {
  console.log(`📤 [WEBHOOK] user.session.invalidate: user=${userId}, reason=${reason}`)
  return sendWebhook('user.session.invalidate', {
    userId,
    reason,
    action: 'force_logout',
  })
}

export default {
  sendWebhook,
  runAuthorizationMutationWithWebhook,
  notifyTeamMemberAdded,
  notifyTeamMemberRemoved,
  notifyTeamRoleChanged,
  notifyOrgMemberAdded,
  notifyOrgMemberRemoved,
  notifyOrgMemberAppAccessChanged,
  notifyManagerChanged,
  forceUserLogout,
  startWebhookOutboxWorker,
}
