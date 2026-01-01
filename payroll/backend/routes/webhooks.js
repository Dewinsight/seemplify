/**
 * IDP Webhook Receiver for Payroll
 * Handles real-time notifications from the Identity Provider
 */

const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const sessionStore = require('../services/sessionStore')

const WEBHOOK_SECRET = process.env.IDP_WEBHOOK_SECRET || 'your-webhook-secret-key'

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
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Invalidated sessions for user ${data.userId} (removed from team)`)
        break

      case 'team.member.added':
        await sessionStore.updateUserTeamClaims(data.userId, data.team)
        console.log(`🔄 Updated team claims for user ${data.userId} (added to team)`)
        break

      case 'team.member.role_changed':
        await sessionStore.refreshUserClaims(data.userId)
        console.log(`🔄 Refreshed claims for user ${data.userId} (role changed)`)
        break

      case 'team.manager.changed':
        if (data.oldManagerId) {
          await sessionStore.refreshUserClaims(data.oldManagerId)
        }
        if (data.newManagerId) {
          await sessionStore.refreshUserClaims(data.newManagerId)
        }
        console.log(`🔄 Refreshed manager claims for team ${data.teamId}`)
        break

      case 'organization.member.removed':
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Invalidated sessions for user ${data.userId} (removed from org)`)
        break

      case 'organization.member.added':
        await sessionStore.updateUserOrgClaims(data.userId, data.organization)
        console.log(`🔄 Updated org claims for user ${data.userId}`)
        break

      case 'user.session.invalidate':
        await sessionStore.invalidateUserSessions(data.userId)
        console.log(`🔒 Force logout for user ${data.userId}: ${data.reason}`)
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
