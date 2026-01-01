/**
 * IDP Webhook Receiver for Performance Management
 * Handles real-time notifications from the Identity Provider
 *
 * Events handled:
 * - team.member.added: User added to a team
 * - team.member.removed: User removed from a team
 * - team.member.role_changed: User's team role changed
 * - team.manager.changed: Team's manager changed
 * - organization.member.added: User added to organization
 * - organization.member.removed: User removed from organization
 * - user.session.invalidate: Force logout requested
 */

const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const sessionStore = require('../services/sessionStore')

const WEBHOOK_SECRET = process.env.IDP_WEBHOOK_SECRET || 'your-webhook-secret-key'

// Optional: WebSocket service for real-time frontend notifications
let websocketService = null
try {
  websocketService = require('../services/websocketService')
} catch (e) {
  // WebSocket service not available, notifications will be session-only
}

/**
 * Verify webhook signature from IDP
 */
function verifyIdpSignature(req, res, next) {
  const signature = req.headers['x-idp-signature']
  const event = req.headers['x-idp-event']

  if (!signature) {
    console.warn('⚠️ Webhook received without signature')
    return res.status(401).json({ error: 'Missing signature' })
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex')

  if (signature !== expectedSignature) {
    console.warn('⚠️ Webhook signature mismatch')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  req.webhookEvent = event
  next()
}

/**
 * Handle IDP webhook events
 */
router.post('/idp', verifyIdpSignature, async (req, res) => {
  const { event, data, timestamp } = req.body

  console.log(`📨 Received IDP webhook: ${event}`, {
    userId: data.userId,
    teamId: data.teamId,
    action: data.action,
    timestamp,
  })

  try {
    switch (event) {
      case 'team.member.removed':
        // User removed from team - invalidate their sessions
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Invalidated sessions for user ${data.userId} (removed from team)`)
        // Notify frontend via WebSocket if available
        if (websocketService) {
          websocketService.notifyUserLogout(data.userId, 'You have been removed from a team')
        }
        break

      case 'team.member.added':
        // User added to team - update their session claims if they have active sessions
        await sessionStore.updateUserTeamClaims(data.userId, data.team)
        console.log(`🔄 Updated team claims for user ${data.userId} (added to team)`)
        // Notify frontend via WebSocket if available
        if (websocketService) {
          websocketService.notifyUser(data.userId, 'team_added', {
            teamName: data.team?.name,
            message: `You have been added to team: ${data.team?.name}`,
          })
        }
        break

      case 'team.member.role_changed':
        // Role changed - update session claims
        await sessionStore.refreshUserClaims(data.userId)
        console.log(`🔄 Refreshed claims for user ${data.userId} (role changed)`)
        // Notify frontend via WebSocket if available
        if (websocketService) {
          websocketService.notifyUser(data.userId, 'role_changed', {
            oldRole: data.oldRole,
            newRole: data.newRole,
            message: `Your role has changed from ${data.oldRole} to ${data.newRole}`,
          })
        }
        break

      case 'team.manager.changed':
        // Manager changed - refresh claims for old and new manager
        if (data.oldManagerId) {
          await sessionStore.refreshUserClaims(data.oldManagerId)
        }
        if (data.newManagerId) {
          await sessionStore.refreshUserClaims(data.newManagerId)
        }
        console.log(`🔄 Refreshed manager claims for team ${data.teamId}`)
        break

      case 'organization.member.removed':
        // User removed from org - invalidate all sessions
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Invalidated sessions for user ${data.userId} (removed from org)`)
        // Notify frontend via WebSocket if available
        if (websocketService) {
          websocketService.notifyUserLogout(data.userId, 'You have been removed from the organization')
        }
        break

      case 'organization.member.added':
        // User added to org - update claims if session exists
        await sessionStore.updateUserOrgClaims(data.userId, data.organization)
        console.log(`🔄 Updated org claims for user ${data.userId}`)
        break

      case 'user.session.invalidate':
        // Force logout requested by admin
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Force logout for user ${data.userId}: ${data.reason}`)
        // Notify frontend via WebSocket if available
        if (websocketService) {
          websocketService.notifyUserLogout(data.userId, data.reason || 'Session invalidated by administrator')
        }
        break

      default:
        console.log(`⚠️ Unknown webhook event: ${event}`)
    }

    res.status(200).json({ received: true, event })
  } catch (error) {
    console.error(`❌ Webhook processing error:`, error)
    res.status(500).json({ error: 'Processing failed' })
  }
})

module.exports = router
