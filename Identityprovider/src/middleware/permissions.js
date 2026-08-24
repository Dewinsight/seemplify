import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'
import { MongoAdapter } from '../adapter/mongoAdapter.js'
import { hasLineManagerRole } from '../utils/teamManager.js'
import {
  authorizationHasPermission,
  resolveOrganizationAuthorization
} from '../services/accessControlService.js'

/**
 * Fallback: resolve account from hub session cookie (_session)
 * Mirrors logic in index.js getSessionFromCookies.
 */
const getAccountFromSessionCookie = async (req) => {
  try {
    const sessionCookie = req.cookies?._session
    if (!sessionCookie) return null

    const adapter = new MongoAdapter('Session')
    const sessionData = await adapter.find(sessionCookie)
    if (!sessionData?.accountId) return null

    return await Account.findOne({ sub: sessionData.accountId })
  } catch (error) {
    console.error('Session cookie lookup error:', error.message)
    return null
  }
}

/**
 * Middleware to require authenticated user
 * Checks for session-based authentication
 */
export const requireAuth = async (req, res, next) => {
  // Check for session user (set during login)
  if (!req.session || !req.session.accountId) {
    // Fallback to hub session cookie
    const cookieAccount = await getAccountFromSessionCookie(req)
    if (cookieAccount) {
      req.session = req.session || {}
      req.session.accountId = cookieAccount.sub
      req.user = cookieAccount
      return next()
    }

    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(401).json({ error: 'Account not found' })
    }

    req.user = account
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(500).json({ error: 'Authentication failed' })
  }
}

/**
 * Middleware to require organization membership
 * Must be used after requireAuth
 * Sets req.organization and req.memberRole
 */
export const requireOrganizationMember = async (req, res, next) => {
  const orgId = req.params.orgId || req.params.organizationId
  if (!orgId) {
    return res.status(400).json({ error: 'Organization ID required' })
  }

  try {
    const organization = await Organization.findById(orgId)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }
    await organization.save()

    const member = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    req.organization = organization
    req.memberRole = member.role
    req.organizationAuthorization = await resolveOrganizationAuthorization({
      account: req.user,
      organization,
      member
    })

    next()
  } catch (error) {
    console.error('Organization member middleware error:', error)
    res.status(500).json({ error: 'Failed to verify organization membership' })
  }
}

/**
 * Middleware to require organization admin role (admin or owner)
 * Must be used after requireOrganizationMember
 */
export const requestHasIdentityPermission = (req, permission) =>
  authorizationHasPermission(req.organizationAuthorization, 'identity', permission)

export const requireIdentityPermission = (permission) => (req, res, next) => {
  if (!requestHasIdentityPermission(req, permission)) {
    return res.status(403).json({
      error: `Organization permission required: ${permission}`,
      code: 'ORGANIZATION_PERMISSION_REQUIRED',
      requiredPermission: permission
    })
  }
  return next()
}

export const requireOrganizationAdmin = requireIdentityPermission('organization.manage')

/**
 * Middleware to require organization owner role
 * Must be used after requireOrganizationMember
 */
export const requireOrganizationOwner = requireIdentityPermission('owner.transfer')

/**
 * Middleware to require specific permission
 * Must be used after requireOrganizationMember
 */
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!requestHasIdentityPermission(req, permission)) {
      return res.status(403).json({ error: `Permission required: ${permission}` })
    }
    next()
  }
}

/**
 * Middleware to require team membership
 * Must be used after requireAuth
 * Sets req.team and req.teamMember
 */
export const requireTeamMember = async (req, res, next) => {
  const teamId = req.params.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'Team ID required' })
  }

  try {
    const team = await Team.findById(teamId)
    if (!team) {
      return res.status(404).json({ error: 'Team not found' })
    }

    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!teamMember) {
      return res.status(403).json({ error: 'Not a member of this team' })
    }

    req.team = team
    req.teamMember = teamMember

    next()
  } catch (error) {
    console.error('Team member middleware error:', error)
    res.status(500).json({ error: 'Failed to verify team membership' })
  }
}

/**
 * Middleware to require team manager role
 * CRITICAL: Manager must have line_manager role in the team
 * Must be used after requireAuth
 */
export const requireTeamManager = async (req, res, next) => {
  const teamId = req.params.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'Team ID required' })
  }

  try {
    const team = await Team.findById(teamId)
    if (!team) {
      return res.status(404).json({ error: 'Team not found' })
    }

    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!teamMember || !hasLineManagerRole(team, req.user._id)) {
      return res.status(403).json({
        error: 'Line manager role required'
      })
    }

    req.team = team
    req.teamMember = teamMember

    next()
  } catch (error) {
    console.error('Team manager middleware error:', error)
    res.status(500).json({ error: 'Failed to verify team manager' })
  }
}

/**
 * Middleware to require line_manager role in team
 * Must be used after requireAuth
 */
export const requireLineManagerRole = async (req, res, next) => {
  const teamId = req.params.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'Team ID required' })
  }

  try {
    const team = await Team.findById(teamId)
    if (!team) {
      return res.status(404).json({ error: 'Team not found' })
    }

    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!teamMember || teamMember.role !== 'line_manager') {
      return res.status(403).json({
        error: 'Line manager role required'
      })
    }

    req.team = team
    req.teamMember = teamMember

    next()
  } catch (error) {
    console.error('Line manager middleware error:', error)
    res.status(500).json({ error: 'Failed to verify line manager role' })
  }
}

/**
 * Middleware to allow organization admin OR team manager
 * Must be used after requireAuth
 * Useful for team management operations
 */
export const requireTeamAdminOrManager = async (req, res, next) => {
  const teamId = req.params.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'Team ID required' })
  }

  try {
    const team = await Team.findById(teamId)
    if (!team) {
      return res.status(404).json({ error: 'Team not found' })
    }

    // Check organization admin
    const organization = await Organization.findById(team.organization)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }

    const orgMember = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    const authorization = orgMember
      ? await resolveOrganizationAuthorization({ account: req.user, organization, member: orgMember })
      : null
    const canManageAllTeams = authorizationHasPermission(authorization, 'identity', 'teams.manage')
    const canManageAssignedTeams = authorizationHasPermission(authorization, 'identity', 'teams.manage.assigned')
    const isDepartmentHead = organization.isDepartmentHead(req.user._id, team.department)

    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    const isTeamManager = teamMember && hasLineManagerRole(team, req.user._id)

    const isOrgAdmin = Boolean(canManageAllTeams)
    const canManageThisTeam = canManageAssignedTeams && (isDepartmentHead || isTeamManager)

    if (!isOrgAdmin && !canManageThisTeam) {
      return res.status(403).json({
        error: 'Organization admin, department head, or line manager role required'
      })
    }

    req.team = team
    req.organization = organization
    req.memberRole = orgMember?.role
    req.teamMember = teamMember
    req.isOrgAdmin = isOrgAdmin
    req.isDepartmentHead = isDepartmentHead
    req.isTeamManager = !!isTeamManager

    next()
  } catch (error) {
    console.error('Team admin/manager middleware error:', error)
    res.status(500).json({ error: 'Failed to verify permissions' })
  }
}

/**
 * Rate limiting for sensitive operations
 * Simple in-memory rate limiter (for production, use Redis)
 */
const rateLimitStore = new Map()

export const rateLimit = (options = {}) => {
  const {
    windowMs = 60 * 60 * 1000, // 1 hour
    maxRequests = 10,
    keyPrefix = 'default'
  } = options

  return (req, res, next) => {
    const key = `${keyPrefix}:${req.user?._id || req.ip}`
    const now = Date.now()

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key)
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now }
    }

    entry.count++
    rateLimitStore.set(key, entry)

    // Check limit
    if (entry.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000)
      })
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + windowMs) / 1000))

    next()
  }
}

// Cleanup old rate limit entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  const hourAgo = now - 60 * 60 * 1000

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.windowStart < hourAgo) {
      rateLimitStore.delete(key)
    }
  }
}, 5 * 60 * 1000)
