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
import { WebhookDelivery } from '../models/WebhookDelivery.js'

// Registered webhook endpoints for each backend
const WEBHOOK_ENDPOINTS = {
  smarthr: process.env.SMARTHR_WEBHOOK_URL || 'http://localhost:3001/api/webhooks/idp',
  // Backends (not frontends). These defaults should match local dev ports for each service.
  leaveManagement: process.env.LEAVE_WEBHOOK_URL || 'http://localhost:5002/api/webhooks/idp',
  payroll: process.env.PAYROLL_WEBHOOK_URL || 'http://localhost:5006/api/webhooks/idp',
  performance: process.env.PERFORMANCE_WEBHOOK_URL || 'http://localhost:5004/api/webhooks/idp',
  timeAttendance: process.env.TIME_ATTENDANCE_WEBHOOK_URL || 'http://localhost:5010/api/webhooks/idp',
  recruiter: process.env.RECRUITER_WEBHOOK_URL || 'http://localhost:5001/api/webhooks/idp-lifecycle',
}

const WEBHOOK_SECRET = process.env.IDP_WEBHOOK_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-webhook-secret')
const WEBHOOK_TIMEOUT = 5000 // 5 second timeout

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload) {
  if (!WEBHOOK_SECRET) throw new Error('IDP_WEBHOOK_SECRET is required in production')
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  hmac.update(JSON.stringify(payload))
  return hmac.digest('hex')
}

/**
 * Send webhook to all registered backends
 */
export async function sendWebhook(event, data) {
  return queueWebhook(event, data)
}

async function queueWebhook(event, data) {
  const eventId = crypto.randomUUID()
  const payload = {
    schemaVersion: '1.0',
    eventId,
    event,
    data,
    organizationId: data.organizationId,
    subjectId: data.idpSubject || data.userId || data.memberId || data.teamId,
    occurredAt: new Date().toISOString(),
    correlationId: data.correlationId || eventId,
    idempotencyKey: data.idempotencyKey || eventId,
    timestamp: new Date().toISOString(),
    idpVersion: '1.0',
  }
  const signature = generateSignature(payload)
  const deliveries = await Promise.all(Object.entries(WEBHOOK_ENDPOINTS)
    .filter(([, endpointUrl]) => Boolean(endpointUrl))
    .map(([endpointName, endpointUrl]) => WebhookDelivery.create({
      eventId,
      event,
      endpointName,
      endpointUrl,
      payload,
      signature,
    })))
  deliverPendingWebhooks().catch(error => console.error('Webhook delivery error:', error))
  return deliveries.map(delivery => ({ name: delivery.endpointName, queued: true, eventId }))
}

async function claimDelivery() {
  const now = new Date()
  return WebhookDelivery.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
        { status: 'delivering', leaseUntil: { $lt: now } }
      ]
    },
    {
      $set: { status: 'delivering', leaseUntil: new Date(now.getTime() + 60000) },
      $inc: { attempts: 1 }
    },
    { sort: { nextAttemptAt: 1 }, new: true }
  )
}

async function deliverOne(delivery) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT)
  try {
    const response = await fetch(delivery.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IDP-Signature': delivery.signature,
        'X-IDP-Event': delivery.event,
      },
      body: JSON.stringify(delivery.payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    delivery.status = 'delivered'
    delivery.responseStatus = response.status
    delivery.deliveredAt = new Date()
    delivery.lastError = ''
  } catch (error) {
    delivery.status = delivery.attempts >= delivery.maxAttempts ? 'dead' : 'failed'
    delivery.lastError = String(error.message || error).slice(0, 4000)
    delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 15000 * (2 ** Math.max(0, delivery.attempts - 1))))
  } finally {
    clearTimeout(timeoutId)
    delivery.leaseUntil = undefined
    await delivery.save()
  }
}

let delivering = false
export async function deliverPendingWebhooks(limit = 25) {
  if (delivering) return { skipped: true }
  delivering = true
  let processed = 0
  try {
    for (; processed < limit; processed += 1) {
      const delivery = await claimDelivery()
      if (!delivery) break
      await deliverOne(delivery)
    }
    return { processed }
  } finally {
    delivering = false
  }
}

let deliveryTimer = null
export function startWebhookDeliveryWorker() {
  if (deliveryTimer) return
  deliveryTimer = setInterval(() => deliverPendingWebhooks().catch(error => console.error('Webhook worker error:', error)), 15000)
  deliveryTimer.unref?.()
  deliverPendingWebhooks().catch(error => console.error('Webhook worker startup error:', error))
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
export async function notifyTeamMemberRemoved(userId, teamId, organizationId, role) {
  console.log(`📤 [WEBHOOK] team.member.removed: user=${userId}, team=${teamId}`)
  return sendWebhook('team.member.removed', {
    userId,
    teamId,
    organizationId,
    role,
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
export async function notifyOrgMemberRemoved(userId, organizationId) {
  console.log(`📤 [WEBHOOK] organization.member.removed: user=${userId}, org=${organizationId}`)
  return sendWebhook('organization.member.removed', {
    userId,
    organizationId,
    action: 'removed',
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
  notifyTeamMemberAdded,
  notifyTeamMemberRemoved,
  notifyTeamRoleChanged,
  notifyOrgMemberAdded,
  notifyOrgMemberRemoved,
  notifyManagerChanged,
  forceUserLogout,
}
