/**
 * Notification Service
 * Handles recipient resolution and batch email notifications through the
 * first-party Seemplify transactional mail service.
 */

import { emailService } from './emailService.js'
import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'
import { Notification } from '../models/Notification.js'

// Configuration
const BATCH_SIZE = 50 // Keep batches bounded so transactional sends stay predictable.
const BATCH_DELAY_MS = 100 // Small pause between batches to smooth send bursts.

class NotificationService {
  /**
   * Get all active members of an organization
   * @param {String} organizationId
   * @returns {Promise<Array<{email: String, name: String, accountId: String}>>}
   */
  async getOrganizationRecipients(organizationId) {
    const organization = await Organization.findById(organizationId)
      .populate('members.account', 'email profile.name')

    if (!organization) {
      throw new Error('Organization not found')
    }

    return organization.members
      .filter(m => m.status === 'active' && m.account?.email)
      .map(m => ({
        email: m.account.email,
        name: m.account.profile?.name || m.account.email.split('@')[0],
        accountId: m.account._id.toString()
      }))
  }

  /**
   * Get all active members of a team (optionally including sub-teams)
   * @param {String} teamId
   * @param {Boolean} includeSubTeams - Whether to include members from sub-teams
   * @returns {Promise<Array<{email: String, name: String, accountId: String}>>}
   */
  async getTeamRecipients(teamId, includeSubTeams = false) {
    const team = await Team.findById(teamId)
      .populate('members.account', 'email profile.name')

    if (!team) {
      throw new Error('Team not found')
    }

    let accountIds = team.members
      .filter(m => m.status === 'active')
      .map(m => m.account._id.toString())

    // Include sub-team members if requested
    if (includeSubTeams) {
      const descendantTeams = await team.getAllDescendantTeams()
      for (const subTeam of descendantTeams) {
        await subTeam.populate('members.account', 'email profile.name')
        const subMembers = subTeam.members
          .filter(m => m.status === 'active')
          .map(m => m.account._id.toString())
        accountIds.push(...subMembers)
      }
    }

    // Deduplicate
    const uniqueIds = [...new Set(accountIds)]

    const accounts = await Account.find({
      _id: { $in: uniqueIds }
    }).select('email profile.name')

    return accounts
      .filter(a => a.email)
      .map(a => ({
        email: a.email,
        name: a.profile?.name || a.email.split('@')[0],
        accountId: a._id.toString()
      }))
  }

  /**
   * Get a single member as recipient
   * @param {String} accountId
   * @returns {Promise<{email: String, name: String, accountId: String}>}
   */
  async getMemberRecipient(accountId) {
    const account = await Account.findById(accountId).select('email profile.name')

    if (!account) {
      throw new Error('Account not found')
    }

    if (!account.email) {
      throw new Error('Account has no email address')
    }

    return {
      email: account.email,
      name: account.profile?.name || account.email.split('@')[0],
      accountId: account._id.toString()
    }
  }

  /**
   * Send batch notifications with rate limiting
   * @param {Object} options
   * @param {Array<{email: String, name: String, accountId: String}>} options.recipients
   * @param {String} options.subject
   * @param {String} options.htmlContent - Custom HTML content
   * @param {String} options.textContent - Plain text fallback
   * @param {String} options.organizationId
   * @param {String} options.sentById - Account ID of sender
   * @param {String} options.targetType - 'organization' | 'team' | 'member'
   * @param {String} options.targetId - ID of target (org, team, or member)
   * @returns {Promise<{success: Boolean, notificationId: String, sent: Number, failed: Number, errors: Array}>}
   */
  async sendBatchNotifications(options) {
    const {
      recipients,
      subject,
      htmlContent,
      textContent,
      organizationId,
      sentById,
      targetType,
      targetId
    } = options

    // Create notification record
    const notification = await Notification.create({
      organization: organizationId,
      sentBy: sentById,
      targetType,
      targetId,
      subject,
      htmlContent,
      textContent,
      recipientCount: recipients.length,
      status: 'sending',
      recipients: recipients.map(r => ({
        accountId: r.accountId,
        email: r.email,
        status: 'pending'
      }))
    })

    let sent = 0
    let failed = 0
    const errors = []

    // Process in batches
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE)

      const batchResults = await Promise.allSettled(
        batch.map(async (recipient) => {
          try {
            await emailService.sendNotificationEmail({
              to: recipient.email,
              toName: recipient.name,
              subject,
              html: htmlContent,
              text: textContent
            })

            // Update recipient status in notification record
            await Notification.updateOne(
              { _id: notification._id, 'recipients.accountId': recipient.accountId },
              { $set: { 'recipients.$.status': 'sent', 'recipients.$.sentAt': new Date() } }
            )

            return { success: true, email: recipient.email }
          } catch (error) {
            // Update recipient status to failed
            await Notification.updateOne(
              { _id: notification._id, 'recipients.accountId': recipient.accountId },
              { $set: { 'recipients.$.status': 'failed', 'recipients.$.error': error.message } }
            )

            return { success: false, email: recipient.email, error: error.message }
          }
        })
      )

      // Count results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          sent++
        } else {
          failed++
          const error = result.status === 'rejected'
            ? result.reason?.message
            : result.value?.error
          errors.push({
            email: result.value?.email || 'unknown',
            error: error || 'Unknown error'
          })
        }
      }

      // Delay between batches (except for last batch)
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }

    // Update notification record with final status
    await Notification.findByIdAndUpdate(notification._id, {
      status: failed === 0 ? 'completed' : (sent === 0 ? 'failed' : 'partial'),
      sentCount: sent,
      failedCount: failed,
      completedAt: new Date()
    })

    console.log(`📧 Notification batch complete: ${sent} sent, ${failed} failed`)

    return {
      success: failed === 0,
      notificationId: notification._id,
      sent,
      failed,
      errors: errors.slice(0, 10) // Limit error details returned
    }
  }
}

export const notificationService = new NotificationService()
export default notificationService
