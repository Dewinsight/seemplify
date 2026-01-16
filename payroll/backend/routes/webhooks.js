/**
 * IDP Webhook Receiver for Payroll
 * Handles real-time notifications from the Identity Provider
 */

const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const sessionStore = require('../services/sessionStore')
const PayrollProfile = require('../models/PayrollProfile')

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

        // Update PayrollProfile
        await PayrollProfile.findOneAndUpdate(
          { userId: data.userId },
          {
            $set: {
              'employeeInfo.teamId': null,
              'employeeInfo.teamName': null,
              'employeeInfo.managerId': null,
              'employeeInfo.managerName': null,
              'employeeInfo.lastSyncedAt': new Date()
            }
          }
        );

        console.log(`🔒 Invalidated sessions for user ${data.userId} (removed from team)`)
        break

      case 'team.member.added':
        await sessionStore.updateUserTeamClaims(data.userId, data.team)

        // Update PayrollProfile with new team info
        await PayrollProfile.findOneAndUpdate(
          { userId: data.userId },
          {
            $set: {
              'employeeInfo.teamId': data.team.id,
              'employeeInfo.teamName': data.team.name,
              'employeeInfo.managerId': data.team.managerId,
              'employeeInfo.managerName': data.team.managerName,
              'employeeInfo.lastSyncedAt': new Date()
            }
          }
        );

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

        // Auto-Onboarding: Create/Update PayrollProfile
        await PayrollProfile.findOrCreateForUser(data.userId, data.organization.id, {
          employeeInfo: {
            name: data.user.name,
            email: data.user.email,
            designation: data.user.jobTitle || data.user.designation,
            lastSyncedAt: new Date()
          },
          status: 'active'
        });

        console.log(`🔄 Updated org claims & Onboarded user ${data.userId}`)
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
