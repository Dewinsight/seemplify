import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'
import { MongoAdapter } from '../adapter/mongoAdapter.js'

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

    const member = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member) {
      return res.status(403).json({ error: 'Not a member of this organization' })
    }

    req.organization = organization
    req.memberRole = member.role

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
export const requireOrganizationAdmin = (req, res, next) => {
  if (!['owner', 'admin'].includes(req.memberRole)) {
    return res.status(403).json({ error: 'Admin or owner role required' })
  }
  next()
}

/**
 * Middleware to require organization owner role
 * Must be used after requireOrganizationMember
 */
export const requireOrganizationOwner = (req, res, next) => {
  if (req.memberRole !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' })
  }
  next()
}

/**
 * Middleware to require specific permission
 * Must be used after requireOrganizationMember
 */
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.organization.hasPermission(req.user._id, permission)) {
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

    // Check if user is the team manager
    if (!team.manager || team.manager.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not team manager' })
    }

    // CRITICAL: Check that manager has line_manager role
    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!teamMember || teamMember.role !== 'line_manager') {
      return res.status(403).json({
        error: 'Manager must have line_manager role in team'
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

    const isOrgAdmin = orgMember && ['owner', 'admin'].includes(orgMember.role)

    // Check team manager with line_manager role
    const isTeamManager = team.manager &&
      team.manager.toString() === req.user._id.toString()

    const teamMember = team.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    const hasLineManagerRole = teamMember && teamMember.role === 'line_manager'

    if (!isOrgAdmin && !(isTeamManager && hasLineManagerRole)) {
      return res.status(403).json({
        error: 'Organization admin or team manager (with line_manager role) required'
      })
    }

    req.team = team
    req.organization = organization
    req.memberRole = orgMember?.role
    req.teamMember = teamMember
    req.isOrgAdmin = isOrgAdmin
    req.isTeamManager = isTeamManager && hasLineManagerRole

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
