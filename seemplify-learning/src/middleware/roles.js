import mongoose from 'mongoose'
import { Organization } from '../models/Organization.js'
import { resolveAccessProfile } from '../utils/accessProfile.js'
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

const buildAccessibleRoleSet = ({ learningRole, accessProfile }) => {
  const roles = new Set()
  const normalizedLearningRole = String(learningRole || '').trim().toLowerCase()
  if (normalizedLearningRole) roles.add(normalizedLearningRole)
  if (accessProfile?.platformRole) roles.add(String(accessProfile.platformRole).trim().toLowerCase())
  if (accessProfile?.partnerAccess?.dashboardRole) roles.add(String(accessProfile.partnerAccess.dashboardRole).trim().toLowerCase())
  if (accessProfile?.agentAccess?.dashboardRole) roles.add(String(accessProfile.agentAccess.dashboardRole).trim().toLowerCase())
  return roles
}

export function requireRole(allowedRoles = []) {
  const normalizedAllowedRoles = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
    : []

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return deny(req, res, 401, 'Authentication required', 'AUTH_REQUIRED')
      }

      const role = resolveLearningRole(req.user)
      const accessProfile = req.accessProfile || await resolveAccessProfile(req.user)
      req.learningRole = role
      req.accessProfile = accessProfile
      res.locals.user = req.user
      res.locals.learningRole = role
      res.locals.accessProfile = accessProfile

      if (normalizedAllowedRoles.length > 0) {
        const accessibleRoles = buildAccessibleRoleSet({ learningRole: role, accessProfile })
        const allowed = normalizedAllowedRoles.some((allowedRole) => accessibleRoles.has(allowedRole))
        if (!allowed) {
          return deny(req, res, 403, 'You do not have permission to access this resource.', 'ROLE_FORBIDDEN')
        }
      }

      return next()
    } catch (error) {
      console.error('Role middleware error:', error)
      return deny(req, res, 500, 'Failed to validate account role.', 'ROLE_ACCESS_ERROR')
    }
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
      const accessProfile = req.accessProfile || await resolveAccessProfile(req.user)
      req.learningRole = learningRole
      req.accessProfile = accessProfile
      res.locals.user = req.user
      res.locals.learningRole = learningRole
      res.locals.accessProfile = accessProfile

      if (allowPlatformAdmin && (accessProfile?.platformRole && PLATFORM_ADMIN_ROLES.includes(accessProfile.platformRole))) {
        return next()
      }

      const requestedOrgId = String(req.params?.orgId || req.body?.orgId || req.query?.orgId || '').trim()
      const accessOrgId = String(accessProfile?.partnerAccess?.organizationId || accessProfile?.agentAccess?.organizationId || '').trim()
      const orgId = requestedOrgId || accessOrgId

      if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
        return deny(req, res, 403, 'Partner organization context is required.', 'PARTNER_ORG_REQUIRED')
      }

      const activePartnerAccess = accessProfile?.partnerAccess || null
      if (activePartnerAccess && String(activePartnerAccess.organizationId) !== orgId) {
        return deny(req, res, 403, 'Only the active partner organization can be accessed.', 'PARTNER_CONTEXT_MISMATCH')
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
