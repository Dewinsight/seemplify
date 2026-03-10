import mongoose from 'mongoose'
import { Organization } from '../models/Organization.js'
import {
  PLATFORM_ADMIN_ROLES,
  PARTNER_ORGANIZATION_MEMBER_ROLES,
  resolveLearningRole
} from '../utils/learningRoles.js'

const isApiRequest = (req) => (
  String(req.originalUrl || '').startsWith('/api/')
  || String(req.get('accept') || '').includes('application/json')
)

const deny = (req, res, statusCode, message, code = 'FORBIDDEN') => {
  if (isApiRequest(req)) {
    return res.status(statusCode).json({ error: message, code })
  }
  return res.status(statusCode).send(message)
}

export function requireRole(allowedRoles = []) {
  const normalizedAllowedRoles = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
    : []

  return (req, res, next) => {
    if (!req.user) {
      return deny(req, res, 401, 'Authentication required', 'AUTH_REQUIRED')
    }

    const role = resolveLearningRole(req.user)
    req.learningRole = role

    if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(role)) {
      return deny(req, res, 403, 'You do not have permission to access this resource.', 'ROLE_FORBIDDEN')
    }

    return next()
  }
}

export function requirePartnerAccess(allowedOrgRoles = PARTNER_ORGANIZATION_MEMBER_ROLES, options = {}) {
  const normalizedAllowedOrgRoles = Array.isArray(allowedOrgRoles)
    ? allowedOrgRoles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
    : []
  const allowPlatformAdmin = options?.allowPlatformAdmin === true

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return deny(req, res, 401, 'Authentication required', 'AUTH_REQUIRED')
      }

      const learningRole = resolveLearningRole(req.user)
      req.learningRole = learningRole

      if (allowPlatformAdmin && PLATFORM_ADMIN_ROLES.includes(learningRole)) {
        return next()
      }

      const orgId = String(
        req.params?.orgId
        || req.body?.orgId
        || req.query?.orgId
        || req.user?.partnerOrganization
        || ''
      ).trim()

      if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
        return deny(req, res, 403, 'Partner organization context is required.', 'PARTNER_ORG_REQUIRED')
      }

      const org = await Organization.findById(orgId)
      if (!org || org.partnerType === 'none') {
        return deny(req, res, 404, 'Partner organization not found.', 'PARTNER_ORG_NOT_FOUND')
      }

      const memberRole = String(org.getMemberRole(req.user._id) || '').trim().toLowerCase()
      if (!memberRole) {
        return deny(req, res, 403, 'You are not a member of this partner organization.', 'PARTNER_MEMBERSHIP_REQUIRED')
      }

      if (normalizedAllowedOrgRoles.length > 0 && !normalizedAllowedOrgRoles.includes(memberRole)) {
        return deny(req, res, 403, 'You do not have partner access to this resource.', 'PARTNER_ROLE_FORBIDDEN')
      }

      req.partnerOrg = org
      req.partnerMemberRole = memberRole
      return next()
    } catch (error) {
      console.error('Partner access middleware error:', error)
      return deny(req, res, 500, 'Failed to validate partner access.', 'PARTNER_ACCESS_ERROR')
    }
  }
}
