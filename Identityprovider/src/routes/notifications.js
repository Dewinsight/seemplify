import express from 'express'
import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'
import { Notification } from '../models/Notification.js'
import { notificationService } from '../services/notificationService.js'
import { hasLineManagerRole } from '../utils/teamManager.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin
} from '../middleware/permissions.js'

const router = express.Router()

// Simple in-memory rate limiting for notifications
const rateLimitMap = new Map()
const RATE_LIMIT_MAX = 20 // 20 notifications per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour

function checkRateLimit(userId) {
  const now = Date.now()
  const userKey = userId.toString()

  if (!rateLimitMap.has(userKey)) {
    rateLimitMap.set(userKey, { count: 0, windowStart: now })
  }

  const userLimit = rateLimitMap.get(userKey)

  // Reset window if expired
  if (now - userLimit.windowStart > RATE_LIMIT_WINDOW) {
    userLimit.count = 0
    userLimit.windowStart = now
  }

  if (userLimit.count >= RATE_LIMIT_MAX) {
    return false
  }

  userLimit.count++
  return true
}

/**
 * Send notification to organization, team, or member
 * POST /api/organizations/:orgId/notifications
 *
 * Body:
 * - targetType: 'organization' | 'team' | 'member'
 * - targetId: ID of team or member (required for team/member)
 * - subject: Email subject
 * - htmlContent: HTML email body
 * - textContent: Plain text fallback (optional)
 * - includeSubTeams: boolean (for team notifications)
 *
 * Permissions:
 * - Organization-wide: Owner or Admin only
 * - Team: Owner, Admin, HR Manager, or Team Manager (line_manager)
 * - Member: Owner, Admin, HR Manager
 */
router.post('/:orgId/notifications',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const { targetType, targetId, subject, htmlContent, textContent, includeSubTeams } = req.body
      const organizationId = req.params.orgId

      // Check rate limit
      if (!checkRateLimit(req.user._id)) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Maximum 20 notifications per hour.'
        })
      }

      // Validate required fields
      if (!targetType || !['organization', 'team', 'member'].includes(targetType)) {
        return res.status(400).json({
          error: 'targetType must be one of: organization, team, member'
        })
      }

      if (!subject || subject.trim().length === 0) {
        return res.status(400).json({ error: 'Subject is required' })
      }

      if (subject.length > 200) {
        return res.status(400).json({ error: 'Subject must be 200 characters or less' })
      }

      if (!htmlContent || htmlContent.trim().length === 0) {
        return res.status(400).json({ error: 'HTML content is required' })
      }

      if (htmlContent.length > 50000) {
        return res.status(400).json({ error: 'HTML content exceeds maximum size (50KB)' })
      }

      // Validate targetId for team/member
      if (targetType !== 'organization' && !targetId) {
        return res.status(400).json({ error: 'targetId is required for team or member notifications' })
      }

      // Permission checks based on target type
      const userRole = req.memberRole
      const allowedRoles = {
        organization: ['owner', 'admin'],
        team: ['owner', 'admin', 'hr_manager'],
        member: ['owner', 'admin', 'hr_manager']
      }

      let canSend = allowedRoles[targetType].includes(userRole)

      // Special case: team managers can send to their own team
      if (targetType === 'team' && !canSend) {
        const team = await Team.findById(targetId)
        if (team && team.organization.toString() === organizationId) {
          if (hasLineManagerRole(team, req.user._id)) {
            canSend = true
          }
        }
      }

      if (!canSend) {
        return res.status(403).json({
          error: `Insufficient permissions to send ${targetType} notifications`
        })
      }

      // Get recipients based on target type
      let recipients
      let resolvedTargetId = targetId

      try {
        switch (targetType) {
          case 'organization':
            recipients = await notificationService.getOrganizationRecipients(organizationId)
            resolvedTargetId = organizationId
            break

          case 'team':
            // Verify team belongs to organization
            const team = await Team.findById(targetId)
            if (!team || team.organization.toString() !== organizationId) {
              return res.status(404).json({ error: 'Team not found in this organization' })
            }
            recipients = await notificationService.getTeamRecipients(targetId, includeSubTeams === true)
            break

          case 'member':
            // Verify member belongs to organization
            const memberAccount = await Account.findById(targetId)
            if (!memberAccount) {
              return res.status(404).json({ error: 'Member not found' })
            }
            const org = await Organization.findById(organizationId)
            if (!org.isMember(targetId)) {
              return res.status(404).json({ error: 'Member not found in this organization' })
            }
            recipients = [await notificationService.getMemberRecipient(targetId)]
            break
        }
      } catch (error) {
        return res.status(400).json({ error: error.message })
      }

      if (recipients.length === 0) {
        return res.status(400).json({ error: 'No valid recipients found' })
      }

      // Send notifications
      const result = await notificationService.sendBatchNotifications({
        recipients,
        subject: subject.trim(),
        htmlContent,
        textContent: textContent?.trim(),
        organizationId,
        sentById: req.user._id,
        targetType,
        targetId: resolvedTargetId
      })

      console.log(`📧 Notification sent by ${req.user.email} to ${targetType}: ${result.sent} sent, ${result.failed} failed`)

      res.status(result.success ? 200 : 207).json({
        message: result.success ? 'Notification sent successfully' : 'Notification sent with some failures',
        notificationId: result.notificationId,
        recipientCount: recipients.length,
        sent: result.sent,
        failed: result.failed,
        errors: result.errors.length > 0 ? result.errors : undefined
      })
    } catch (error) {
      console.error('Send notification error:', error)
      res.status(500).json({ error: 'Failed to send notification' })
    }
  }
)

/**
 * Get notification history for organization
 * GET /api/organizations/:orgId/notifications
 * Requires admin or owner role
 */
router.get('/:orgId/notifications',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status } = req.query
      const skip = (parseInt(page) - 1) * parseInt(limit)

      const query = { organization: req.params.orgId }
      if (status) {
        query.status = status
      }

      const [notifications, total] = await Promise.all([
        Notification.find(query)
          .populate('sentBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .select('-recipients -htmlContent -textContent'),
        Notification.countDocuments(query)
      ])

      res.json({
        notifications: notifications.map(n => ({
          id: n._id,
          targetType: n.targetType,
          targetId: n.targetId,
          subject: n.subject,
          status: n.status,
          recipientCount: n.recipientCount,
          sentCount: n.sentCount,
          failedCount: n.failedCount,
          sentBy: {
            id: n.sentBy._id,
            email: n.sentBy.email,
            name: n.sentBy.profile?.name
          },
          createdAt: n.createdAt,
          completedAt: n.completedAt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      })
    } catch (error) {
      console.error('Get notifications error:', error)
      res.status(500).json({ error: 'Failed to get notifications' })
    }
  }
)

/**
 * Get single notification details
 * GET /api/organizations/:orgId/notifications/:notificationId
 * Requires admin or owner role
 */
router.get('/:orgId/notifications/:notificationId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      const notification = await Notification.findOne({
        _id: req.params.notificationId,
        organization: req.params.orgId
      })
        .populate('sentBy', 'email profile.name')
        .populate('recipients.accountId', 'email profile.name')

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' })
      }

      res.json({
        id: notification._id,
        targetType: notification.targetType,
        targetId: notification.targetId,
        subject: notification.subject,
        htmlContent: notification.htmlContent,
        textContent: notification.textContent,
        status: notification.status,
        recipientCount: notification.recipientCount,
        sentCount: notification.sentCount,
        failedCount: notification.failedCount,
        sentBy: {
          id: notification.sentBy._id,
          email: notification.sentBy.email,
          name: notification.sentBy.profile?.name
        },
        recipients: notification.recipients.map(r => ({
          accountId: r.accountId?._id,
          email: r.email,
          name: r.accountId?.profile?.name,
          status: r.status,
          sentAt: r.sentAt,
          error: r.error
        })),
        createdAt: notification.createdAt,
        completedAt: notification.completedAt
      })
    } catch (error) {
      console.error('Get notification error:', error)
      res.status(500).json({ error: 'Failed to get notification' })
    }
  }
)

export default router
