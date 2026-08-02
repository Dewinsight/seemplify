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

// Registered webhook endpoints for each backend
const WEBHOOK_ENDPOINTS = {
  smarthr: process.env.SMARTHR_WEBHOOK_URL || 'http://localhost:3001/api/webhooks/idp',
  // Backends (not frontends). These defaults should match local dev ports for each service.
  leaveManagement: process.env.LEAVE_WEBHOOK_URL || 'http://localhost:5002/api/webhooks/idp',
  payroll: process.env.PAYROLL_WEBHOOK_URL || 'http://localhost:5006/api/webhooks/idp',
  performance: process.env.PERFORMANCE_WEBHOOK_URL || 'http://localhost:5004/api/webhooks/idp',
}

const WEBHOOK_SECRET = process.env.IDP_WEBHOOK_SECRET || 'your-webhook-secret-key'
const WEBHOOK_TIMEOUT = 5000 // 5 second timeout

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload) {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  hmac.update(JSON.stringify(payload))
  return hmac.digest('hex')
}

/**
 * Send webhook to all registered backends
 */
async function sendWebhook(event, data) {
  const payload = {
    event,
    data,
    timestamp: new Date().toISOString(),
    idpVersion: '1.0',
  }

  const signature = generateSignature(payload)

  const results = await Promise.allSettled(
    Object.entries(WEBHOOK_ENDPOINTS).map(async ([name, url]) => {
      if (!url) return { name, skipped: true }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT)

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-IDP-Signature': signature,
            'X-IDP-Event': event,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        console.log(`✅ Webhook sent to ${name}:`, response.status)
        return { name, success: true, status: response.status }
      } catch (error) {
        console.error(`❌ Webhook failed for ${name}:`, error.message)
        return { name, success: false, error: error.message }
      }
    })
  )

  return results
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
