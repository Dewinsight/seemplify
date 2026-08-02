import Subscription from '../models/Subscription.js'

class SubscriptionService {
  async getSubscriptionForOrg(organizationId) {
    if (!organizationId) return null
    return Subscription.findActiveForOrg(organizationId)
  }

  async getEffectiveFeatures(organizationId) {
    const subscription = await this.getSubscriptionForOrg(organizationId)
    if (!subscription) {
      return {
        recruiter: false,
        leaveManagement: false,
        payrollManagement: false,
        performanceManagement: false,
        timeAttendance: false,
        outlineDocs: false,
        aiChat: false,
        lms: true
      }
    }

    try {
      const features = await subscription.getEffectiveFeatures()
      return {
        ...features,
        lms: features?.lms !== false
      }
    } catch {
      return {
        recruiter: false,
        leaveManagement: false,
        payrollManagement: false,
        performanceManagement: false,
        timeAttendance: false,
        outlineDocs: false,
        aiChat: false,
        lms: true
      }
    }
  }

  async getEffectiveLimits(organizationId) {
    const subscription = await this.getSubscriptionForOrg(organizationId)
    if (!subscription) {
      return {
        maxMembers: null,
        maxTeams: null,
        maxStorage: null,
        maxSystemCourses: null
      }
    }

    try {
      return await subscription.getEffectiveLimits()
    } catch {
      return {
        maxMembers: null,
        maxTeams: null,
        maxStorage: null,
        maxSystemCourses: null
      }
    }
  }
}

export const subscriptionService = new SubscriptionService()
export default subscriptionService
