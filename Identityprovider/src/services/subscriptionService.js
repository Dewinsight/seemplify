import Plan from '../models/Plan.js'
import Subscription from '../models/Subscription.js'
import SubscriptionRequest from '../models/SubscriptionRequest.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import { emailService } from './emailService.js'

/**
 * Subscription Service
 *
 * Handles all subscription-related business logic including:
 * - Subscription requests
 * - Subscription creation and management
 * - Plan management
 * - Notifications
 * - Access control
 */
class SubscriptionService {
  constructor() {
    this.gracePeriodDays = 7 // Days of grace after expiration
  }

  // ========================================
  // PLAN OPERATIONS
  // ========================================

  /**
   * Get all active public plans
   */
  async getPublicPlans() {
    return Plan.findPublicPlans()
  }

  /**
   * Get all plans (for admin)
   */
  async getAllPlans() {
    return Plan.find().sort({ displayOrder: 1, createdAt: -1 })
  }

  /**
   * Get plan by ID
   */
  async getPlanById(planId) {
    return Plan.findById(planId)
  }

  /**
   * Get plan by slug
   */
  async getPlanBySlug(slug) {
    return Plan.findBySlug(slug)
  }

  /**
   * Create a new plan
   */
  async createPlan(planData, createdBy) {
    const plan = new Plan({
      ...planData,
      createdBy
    })
    return plan.save()
  }

  /**
   * Update a plan
   */
  async updatePlan(planId, planData, updatedBy) {
    const plan = await Plan.findById(planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    Object.assign(plan, planData, { updatedBy })
    return plan.save()
  }

  /**
   * Deactivate a plan (soft delete)
   */
  async deactivatePlan(planId) {
    const plan = await Plan.findById(planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    plan.isActive = false
    return plan.save()
  }

  // ========================================
  // SUBSCRIPTION REQUEST OPERATIONS
  // ========================================

  /**
   * Create a subscription request
   */
  async createSubscriptionRequest(data, requestedBy) {
    const { organizationId, planId, billingCycle, contactInfo, message } = data

    // Validate organization
    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('Organization not found')
    }

    // Check if user is member of organization
    const isMember = organization.isMember(requestedBy._id)
    if (!isMember) {
      throw new Error('You must be a member of this organization')
    }

    // Validate plan
    const plan = await Plan.findById(planId)
    if (!plan || !plan.isActive || !plan.isPublic) {
      throw new Error('Plan not found or unavailable')
    }

    // Check for existing pending request
    const existingRequest = await SubscriptionRequest.findOne({
      organization: organizationId,
      status: 'pending',
      expiresAt: { $gte: new Date() }
    })
    if (existingRequest) {
      throw new Error('You already have a pending subscription request')
    }

    // Determine request type
    let requestType = 'new'
    let currentSubscription = null

    const activeSubscription = await Subscription.findActiveForOrg(organizationId)
    if (activeSubscription) {
      currentSubscription = activeSubscription._id

      // Compare plans to determine if upgrade/downgrade/renewal
      if (activeSubscription.plan._id.toString() === planId) {
        requestType = 'renewal'
      } else if (plan.pricing.monthly > activeSubscription.plan.pricing.monthly) {
        requestType = 'upgrade'
      } else {
        requestType = 'downgrade'
      }
    }

    // Get price for billing cycle
    const priceAtRequest = plan.getPriceForCycle(billingCycle)

    // Create request
    const request = new SubscriptionRequest({
      organization: organizationId,
      plan: planId,
      requestedBy: requestedBy._id,
      billingCycle,
      requestType,
      currentSubscription,
      contactInfo,
      message,
      priceAtRequest,
      currency: plan.pricing.currency
    })

    await request.save()

    // Send notification to admins
    await this.notifyAdminsOfNewRequest(request)

    return request
  }

  /**
   * Get pending requests (for admin)
   */
  async getPendingRequests() {
    return SubscriptionRequest.findPending()
  }

  /**
   * Get all requests (for admin)
   */
  async getAllRequests(filters = {}) {
    const query = {}

    if (filters.status) {
      query.status = filters.status
    }

    if (filters.organizationId) {
      query.organization = filters.organizationId
    }

    return SubscriptionRequest.find(query)
      .sort({ createdAt: -1 })
      .populate(['organization', 'plan', 'requestedBy', 'processedBy'])
  }

  /**
   * Get request by ID
   */
  async getRequestById(requestId) {
    return SubscriptionRequest.findById(requestId)
      .populate(['organization', 'plan', 'requestedBy', 'processedBy', 'currentSubscription'])
  }

  /**
   * Approve a subscription request
   */
  async approveRequest(requestId, adminId, options = {}) {
    const { notes, customStartDate, customEndDate, customLimits, customFeatures } = options

    const request = await this.getRequestById(requestId)
    if (!request) {
      throw new Error('Request not found')
    }

    if (request.status !== 'pending') {
      throw new Error('Request is not pending')
    }

    if (request.isExpired) {
      throw new Error('Request has expired')
    }

    // Calculate subscription dates
    const startDate = customStartDate || new Date()
    let endDate

    if (customEndDate) {
      endDate = new Date(customEndDate)
    } else {
      const duration = request.billingCycle === 'yearly' ? 365 : 30
      endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000)
    }

    const gracePeriodEnd = new Date(endDate.getTime() + this.gracePeriodDays * 24 * 60 * 60 * 1000)

    // Expire previous subscription if exists
    if (request.currentSubscription) {
      const previousSub = await Subscription.findById(request.currentSubscription)
      if (previousSub) {
        previousSub.status = 'expired'
        previousSub.endDate = new Date()
        await previousSub.save()
      }
    }

    // Create new subscription
    const subscription = new Subscription({
      organization: request.organization._id,
      plan: request.plan._id,
      billingCycle: request.billingCycle,
      priceAtPurchase: request.priceAtRequest,
      currency: request.currency,
      status: 'active',
      startDate,
      endDate,
      gracePeriodEnd,
      approvedBy: adminId,
      approvedAt: new Date(),
      notes,
      previousSubscription: request.currentSubscription,
      upgradeFromPlan: request.requestType === 'upgrade' ? request.currentSubscription?.plan : null,
      downgradeFromPlan: request.requestType === 'downgrade' ? request.currentSubscription?.plan : null,
      originatingRequest: request._id,
      customLimits,
      customFeatures
    })

    await subscription.save()

    // Update request
    await request.approve(adminId, notes, subscription._id)

    // Update organization subscription cache
    const organization = await Organization.findById(request.organization._id)
    await organization.updateSubscriptionCache(subscription)

    // Send notification to requester
    await this.notifyUserOfApproval(request, subscription)

    return { request, subscription }
  }

  /**
   * Reject a subscription request
   */
  async rejectRequest(requestId, adminId, reason, notes) {
    const request = await this.getRequestById(requestId)
    if (!request) {
      throw new Error('Request not found')
    }

    if (request.status !== 'pending') {
      throw new Error('Request is not pending')
    }

    await request.reject(adminId, reason, notes)

    // Send notification to requester
    await this.notifyUserOfRejection(request, reason)

    return request
  }

  /**
   * Cancel a subscription request (by user)
   */
  async cancelRequest(requestId, userId) {
    const request = await SubscriptionRequest.findById(requestId)
    if (!request) {
      throw new Error('Request not found')
    }

    if (request.requestedBy.toString() !== userId.toString()) {
      throw new Error('You can only cancel your own requests')
    }

    return request.cancel()
  }

  // ========================================
  // SUBSCRIPTION OPERATIONS
  // ========================================

  /**
   * Get subscription for organization
   */
  async getSubscriptionForOrg(organizationId) {
    return Subscription.findActiveForOrg(organizationId)
  }

  /**
   * Get all subscriptions for organization
   */
  async getAllSubscriptionsForOrg(organizationId) {
    return Subscription.findAllForOrg(organizationId)
  }

  /**
   * Get subscription by ID
   */
  async getSubscriptionById(subscriptionId) {
    return Subscription.findById(subscriptionId).populate(['plan', 'organization', 'approvedBy'])
  }

  /**
   * Get all subscriptions (for admin)
   */
  async getAllSubscriptions(filters = {}) {
    const query = {}

    if (filters.status) {
      query.status = filters.status
    }

    if (filters.organizationId) {
      query.organization = filters.organizationId
    }

    if (filters.planId) {
      query.plan = filters.planId
    }

    return Subscription.find(query)
      .sort({ createdAt: -1 })
      .populate(['plan', 'organization'])
  }

  /**
   * Create subscription directly (admin bypass)
   */
  async createSubscriptionDirectly(data, adminId) {
    const {
      organizationId,
      planId,
      billingCycle,
      startDate,
      endDate,
      customLimits,
      customFeatures,
      notes
    } = data

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      throw new Error('Organization not found')
    }

    const plan = await Plan.findById(planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    // Check for existing active subscription
    const existingSubscription = await Subscription.findActiveForOrg(organizationId)
    if (existingSubscription) {
      // Expire it
      existingSubscription.status = 'expired'
      existingSubscription.endDate = new Date()
      await existingSubscription.save()
    }

    const start = startDate ? new Date(startDate) : new Date()
    let end

    if (endDate) {
      end = new Date(endDate)
    } else {
      const duration = billingCycle === 'yearly' ? 365 : 30
      end = new Date(start.getTime() + duration * 24 * 60 * 60 * 1000)
    }

    const gracePeriodEnd = new Date(end.getTime() + this.gracePeriodDays * 24 * 60 * 60 * 1000)
    const priceAtPurchase = plan.getPriceForCycle(billingCycle)

    const subscription = new Subscription({
      organization: organizationId,
      plan: planId,
      billingCycle,
      priceAtPurchase,
      currency: plan.pricing.currency,
      status: 'active',
      startDate: start,
      endDate: end,
      gracePeriodEnd,
      approvedBy: adminId,
      approvedAt: new Date(),
      notes,
      previousSubscription: existingSubscription?._id,
      customLimits,
      customFeatures
    })

    await subscription.save()

    // Update organization
    await organization.updateSubscriptionCache(subscription)

    return subscription
  }

  /**
   * Extend subscription
   */
  async extendSubscription(subscriptionId, days, adminId, notes) {
    const subscription = await Subscription.findById(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    // Add notes about extension
    subscription.notes = (subscription.notes ? subscription.notes + '\n' : '') +
      `Extended by ${days} days on ${new Date().toISOString()}: ${notes || 'Admin extension'}`

    await subscription.extend(days)

    // Update organization cache
    const organization = await Organization.findById(subscription.organization)
    await organization.updateSubscriptionCache(subscription)

    return subscription
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId, reason, cancelledBy) {
    const subscription = await Subscription.findById(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    await subscription.cancel(reason, cancelledBy)

    // Update organization cache
    const organization = await Organization.findById(subscription.organization)
    await organization.updateSubscriptionCache(null)

    return subscription
  }

  /**
   * Suspend subscription
   */
  async suspendSubscription(subscriptionId, reason) {
    const subscription = await Subscription.findById(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    await subscription.suspend(reason)

    // Update organization cache
    const organization = await Organization.findById(subscription.organization)
    await organization.updateSubscriptionCache(subscription)

    return subscription
  }

  /**
   * Reactivate subscription
   */
  async reactivateSubscription(subscriptionId) {
    const subscription = await Subscription.findById(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    await subscription.reactivate()

    // Update organization cache
    const organization = await Organization.findById(subscription.organization)
    await organization.updateSubscriptionCache(subscription)

    return subscription
  }

  /**
   * Update subscription custom limits/features
   */
  async updateSubscriptionCustomizations(subscriptionId, customLimits, customFeatures, notes) {
    const subscription = await Subscription.findById(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (customLimits) {
      subscription.customLimits = { ...subscription.customLimits?.toObject(), ...customLimits }
    }

    if (customFeatures) {
      subscription.customFeatures = { ...subscription.customFeatures?.toObject(), ...customFeatures }
    }

    if (notes) {
      subscription.notes = (subscription.notes ? subscription.notes + '\n' : '') + notes
    }

    return subscription.save()
  }

  // ========================================
  // ACCESS CONTROL
  // ========================================

  /**
   * Check if organization can access an app
   */
  async canAccessApp(organizationId, appKey) {
    const subscription = await Subscription.findActiveForOrg(organizationId)
    if (!subscription) return false

    return subscription.canAccessApp(appKey)
  }

  /**
   * Check if organization can add more members
   */
  async canAddMembers(organizationId, currentMemberCount) {
    const subscription = await Subscription.findActiveForOrg(organizationId)
    if (!subscription) return false

    return subscription.canAddMembers(currentMemberCount)
  }

  /**
   * Get organization's effective features
   */
  async getEffectiveFeatures(organizationId) {
    const subscription = await Subscription.findActiveForOrg(organizationId)
    if (!subscription) {
      return {
        recruiter: false,
        leaveManagement: false,
        payrollManagement: false,
        performanceManagement: false,
        outlineDocs: false,
        aiChat: false,
        lms: false
      }
    }

    return subscription.getEffectiveFeatures()
  }

  /**
   * Get organization's effective limits
   */
  async getEffectiveLimits(organizationId) {
    const subscription = await Subscription.findActiveForOrg(organizationId)
    if (!subscription) {
      return {
        maxMembers: 0,
        maxTeams: 0,
        maxStorage: 0
      }
    }

    return subscription.getEffectiveLimits()
  }

  // ========================================
  // LIFECYCLE MANAGEMENT
  // ========================================

  /**
   * Process expired subscriptions
   * Should be run daily via cron job
   */
  async processExpiredSubscriptions() {
    const expired = await Subscription.findExpiredNeedingUpdate()

    for (const subscription of expired) {
      subscription.status = 'expired'
      await subscription.save()

      const organization = await Organization.findById(subscription.organization)
      await organization.updateSubscriptionCache(subscription)

      // Send expiry notification
      await this.notifyOrgOfExpiry(subscription)
    }

    return expired.length
  }

  /**
   * Process subscriptions past grace period
   * Should be run daily via cron job
   */
  async processGracePeriodEnd() {
    const pastGrace = await Subscription.findPastGracePeriod()

    for (const subscription of pastGrace) {
      const organization = await Organization.findById(subscription.organization)
      await organization.updateSubscriptionCache(null) // Clear subscription

      // Send final access removal notification
      await this.notifyOrgOfAccessRemoval(subscription)
    }

    return pastGrace.length
  }

  /**
   * Send renewal reminders
   * Should be run daily via cron job
   */
  async sendRenewalReminders() {
    const reminders = [
      { days: 7, field: 'renewalReminder7DaysSent' },
      { days: 3, field: 'renewalReminder3DaysSent' },
      { days: 1, field: 'renewalReminder1DaySent' }
    ]

    let sentCount = 0

    for (const { days, field } of reminders) {
      const subscriptions = await Subscription.findExpiringSoon(days)

      for (const subscription of subscriptions) {
        if (!subscription[field]) {
          await this.sendRenewalReminderEmail(subscription, days)
          subscription[field] = true
          await subscription.save()
          sentCount++
        }
      }
    }

    return sentCount
  }

  /**
   * Expire old pending requests
   * Should be run daily via cron job
   */
  async expireOldRequests() {
    const expiredRequests = await SubscriptionRequest.findExpiredPending()

    for (const request of expiredRequests) {
      await request.markExpired()
    }

    return expiredRequests.length
  }

  // ========================================
  // NOTIFICATIONS
  // ========================================

  /**
   * Notify admins of new subscription request
   */
  async notifyAdminsOfNewRequest(request) {
    try {
      await request.populate(['organization', 'plan', 'requestedBy'])

      const admins = await Account.findSystemAdmins()

      for (const admin of admins) {
        await this.sendNewRequestNotificationEmail(admin.email, request)
      }

      await request.markAdminNotified()
    } catch (error) {
      console.error('Failed to notify admins of new request:', error)
    }
  }

  /**
   * Notify user of request approval
   */
  async notifyUserOfApproval(request, subscription) {
    try {
      await request.populate('requestedBy')

      await this.sendApprovalNotificationEmail(
        request.contactInfo.email,
        request.contactInfo.name,
        request,
        subscription
      )

      await request.markUserNotified()
    } catch (error) {
      console.error('Failed to notify user of approval:', error)
    }
  }

  /**
   * Notify user of request rejection
   */
  async notifyUserOfRejection(request, reason) {
    try {
      await this.sendRejectionNotificationEmail(
        request.contactInfo.email,
        request.contactInfo.name,
        request,
        reason
      )

      await request.markUserNotified()
    } catch (error) {
      console.error('Failed to notify user of rejection:', error)
    }
  }

  /**
   * Notify organization of subscription expiry
   */
  async notifyOrgOfExpiry(subscription) {
    try {
      await subscription.populate(['organization', 'plan'])

      const owner = await Account.findById(subscription.organization.owner)
      if (owner) {
        await this.sendExpiryNotificationEmail(owner.email, subscription)
      }
    } catch (error) {
      console.error('Failed to notify org of expiry:', error)
    }
  }

  /**
   * Notify organization of access removal
   */
  async notifyOrgOfAccessRemoval(subscription) {
    try {
      await subscription.populate(['organization', 'plan'])

      const owner = await Account.findById(subscription.organization.owner)
      if (owner) {
        await this.sendAccessRemovalEmail(owner.email, subscription)
      }
    } catch (error) {
      console.error('Failed to notify org of access removal:', error)
    }
  }

  // ========================================
  // EMAIL TEMPLATES
  // ========================================

  async sendNewRequestNotificationEmail(toEmail, request) {
    const identityProviderUrl = process.env.ISSUER_URL || 'http://localhost:4000'

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">New Subscription Request</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              A new subscription request has been submitted and requires your review.
            </p>

            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="margin: 0 0 16px; color: #333;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Organization:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.organization.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Plan:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.plan.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Billing Cycle:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.billingCycle}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Type:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.requestTypeDisplay}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Contact:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.contactInfo.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Email:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.contactInfo.email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Phone:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.contactInfo.phone}</td>
                </tr>
              </table>
            </div>

            ${request.message ? `<div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>Message from requester:</strong><br>
                ${request.message}
              </p>
            </div>` : ''}

            <div style="text-align: center; margin: 32px 0;">
              <a href="${identityProviderUrl}/admin/requests/${request._id}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Review Request
              </a>
            </div>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              AIIN Identity Admin Notification
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: toEmail,
      subject: `New Subscription Request from ${request.organization.name}`,
      html: htmlContent
    })
  }

  async sendApprovalNotificationEmail(toEmail, name, request, subscription) {
    const displayName = name || toEmail.split('@')[0]

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ✓
            </div>
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">Subscription Approved!</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello ${displayName},</p>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Great news! Your subscription request has been approved. Your organization now has access to the selected plan.
            </p>

            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="margin: 0 0 16px; color: #333;">Subscription Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Plan:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${request.plan.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Start Date:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${new Date(subscription.startDate).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">End Date:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${new Date(subscription.endDate).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Billing Cycle:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${subscription.billingCycle}</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              You can now access all the features included in your plan. Log in to your account to get started!
            </p>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              Thank you for choosing AIIN Identity
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: toEmail,
      subject: 'Your Subscription Request Has Been Approved!',
      html: htmlContent
    })
  }

  async sendRejectionNotificationEmail(toEmail, name, request, reason) {
    const displayName = name || toEmail.split('@')[0]

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">Subscription Request Update</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello ${displayName},</p>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              We have reviewed your subscription request for the <strong>${request.plan.name}</strong> plan.
              Unfortunately, we are unable to approve it at this time.
            </p>

            ${reason ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #991b1b;">
                <strong>Reason:</strong><br>
                ${reason}
              </p>
            </div>` : ''}

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              If you have any questions or would like to discuss this further, please contact our support team.
            </p>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              AIIN Identity
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: toEmail,
      subject: 'Update on Your Subscription Request',
      html: htmlContent
    })
  }

  async sendRenewalReminderEmail(subscription, daysRemaining) {
    await subscription.populate(['organization', 'plan'])

    const owner = await Account.findById(subscription.organization.owner)
    if (!owner) return

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">Subscription Renewal Reminder</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello,</p>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Your subscription for <strong>${subscription.organization.name}</strong> will expire in <strong>${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>.
            </p>

            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="margin: 0 0 16px; color: #333;">Current Plan Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Plan:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${subscription.plan.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Expires:</td>
                  <td style="padding: 8px 0; font-weight: 600;">${new Date(subscription.endDate).toLocaleDateString()}</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              To continue enjoying uninterrupted access, please renew your subscription before the expiry date.
            </p>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              AIIN Identity
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: owner.email,
      subject: `Subscription Renewal Reminder - ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} remaining`,
      html: htmlContent
    })
  }

  async sendExpiryNotificationEmail(toEmail, subscription) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">Subscription Expired</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Your subscription for <strong>${subscription.organization.name}</strong> has expired.
            </p>

            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>Grace Period:</strong> You have a ${this.gracePeriodDays}-day grace period during which your data will be preserved.
                After this period, access to premium features will be disabled.
              </p>
            </div>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              To restore access, please renew your subscription as soon as possible.
            </p>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              AIIN Identity
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: toEmail,
      subject: 'Your Subscription Has Expired',
      html: htmlContent
    })
  }

  async sendAccessRemovalEmail(toEmail, subscription) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); padding: 40px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">Access Removed</h1>
          </div>

          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              The grace period for <strong>${subscription.organization.name}</strong> has ended.
              Access to premium features has been disabled.
            </p>

            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 24px 0;">
              Your data is still preserved. To restore access, please contact us to renew your subscription.
            </p>
          </div>

          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #999;">
              AIIN Identity
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    return emailService.sendEmail({
      to: toEmail,
      subject: 'Subscription Access Has Been Removed',
      html: htmlContent
    })
  }

  // ========================================
  // STATISTICS
  // ========================================

  /**
   * Get subscription statistics for admin dashboard
   */
  async getStats() {
    const [
      totalOrganizations,
      orgsWithSubscription,
      orgsWithoutSubscription,
      activeSubscriptions,
      expiredSubscriptions,
      requestStats,
      planStats
    ] = await Promise.all([
      Organization.countDocuments(),
      Organization.countDocuments({ subscriptionStatus: { $in: ['active', 'grace_period'] } }),
      Organization.countDocuments({ $or: [{ subscriptionStatus: 'none' }, { subscriptionStatus: { $exists: false } }] }),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ status: 'expired' }),
      SubscriptionRequest.getStats(),
      this.getPlanStats()
    ])

    return {
      organizations: {
        total: totalOrganizations,
        withSubscription: orgsWithSubscription,
        withoutSubscription: orgsWithoutSubscription
      },
      subscriptions: {
        active: activeSubscriptions,
        expired: expiredSubscriptions
      },
      requests: requestStats,
      plans: planStats
    }
  }

  async getPlanStats() {
    const plans = await Plan.find()
    const stats = []

    for (const plan of plans) {
      const activeCount = await Subscription.countDocuments({
        plan: plan._id,
        status: 'active'
      })

      stats.push({
        id: plan._id,
        name: plan.name,
        activeSubscriptions: activeCount,
        isActive: plan.isActive,
        isPublic: plan.isPublic
      })
    }

    return stats
  }
}

export const subscriptionService = new SubscriptionService()
export default subscriptionService
