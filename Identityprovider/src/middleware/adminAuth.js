import { Account } from '../models/Account.js'

/**
 * Admin Authentication Middleware for IDP Admin Views
 *
 * Provides session-based authentication for system admins.
 * System admins can manage plans, subscriptions, and organization access.
 *
 * CRITICAL SECURITY REQUIREMENTS:
 * - User must have a valid session
 * - User must have isSystemAdmin or isSuperAdmin flag
 * - Super admins can manage other admins
 */

/**
 * Require authenticated user (any user with valid session)
 * Sets req.user with the account
 */
export const requireAuth = async (req, res, next) => {
  if (!req.session || !req.session.accountId) {
    // For API routes, return JSON
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=auth_required&redirect=' + encodeURIComponent(req.originalUrl))
    }
    // For other view routes, redirect to login
    return res.redirect('/login?error=auth_required&redirect=' + encodeURIComponent(req.originalUrl))
  }

  try {
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      // Clear invalid session
      req.session.destroy()
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Account not found' })
      }
      // For admin routes, redirect to admin login
      if (req.path.startsWith('/admin')) {
        return res.redirect('/admin/login?error=account_not_found')
      }
      return res.redirect('/login?error=account_not_found')
    }

    req.user = account
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ error: 'Authentication failed' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=auth_error')
    }
    return res.redirect('/login?error=auth_error')
  }
}

/**
 * Require system admin access
 * Must be used after requireAuth
 * User must have isSystemAdmin or isSuperAdmin flag
 */
export const requireSystemAdmin = (req, res, next) => {
  if (!req.user) {
    console.error('requireSystemAdmin called without requireAuth')
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=auth_required')
    }
    return res.redirect('/login?error=auth_required')
  }

  if (!req.user.hasAdminAccess()) {
    console.warn(`Unauthorized admin access attempt by: ${req.user.email}`)
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=admin_access_required')
    }
    return res.redirect('/?error=admin_access_required')
  }

  next()
}

/**
 * Require super admin access
 * Must be used after requireAuth
 * User must have isSuperAdmin flag
 */
export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    console.error('requireSuperAdmin called without requireAuth')
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=auth_required')
    }
    return res.redirect('/login?error=auth_required')
  }

  if (!req.user.canManageAdmins()) {
    console.warn(`Unauthorized super admin access attempt by: ${req.user.email}`)
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Super admin access required' })
    }
    // For admin routes, redirect to admin login
    if (req.path.startsWith('/admin')) {
      return res.redirect('/admin/login?error=super_admin_required')
    }
    return res.redirect('/admin?error=super_admin_required')
  }

  next()
}

/**
 * Combined middleware: requireAuth + requireSystemAdmin
 * Convenience middleware for admin routes
 */
export const requireAdminAuth = async (req, res, next) => {
  await requireAuth(req, res, (err) => {
    if (err) return next(err)
    requireSystemAdmin(req, res, next)
  })
}

/**
 * Combined middleware: requireAuth + requireSuperAdmin
 * Convenience middleware for super admin routes
 */
export const requireSuperAdminAuth = async (req, res, next) => {
  await requireAuth(req, res, (err) => {
    if (err) return next(err)
    requireSuperAdmin(req, res, next)
  })
}

/**
 * Set admin context for views
 * Adds common admin-related variables to res.locals
 * Must be used after requireAdminAuth
 */
export const setAdminContext = async (req, res, next) => {
  if (!req.user) {
    return next()
  }

  // Add admin info to response locals for EJS templates
  res.locals.admin = {
    id: req.user._id,
    email: req.user.email,
    name: req.user.profile?.name || req.user.email,
    isSystemAdmin: req.user.isSystemAdmin,
    isSuperAdmin: req.user.isSuperAdmin
  }

  // Add pending counts for badges in navigation
  try {
    const SubscriptionRequest = (await import('../models/SubscriptionRequest.js')).default
    res.locals.adminStats = {
      pendingRequests: await SubscriptionRequest.countPending()
    }
  } catch (error) {
    console.error('Failed to load admin stats:', error)
    res.locals.adminStats = {
      pendingRequests: 0
    }
  }

  next()
}

/**
 * Audit logging for admin actions
 * Logs important admin operations for security tracking
 */
export const auditLog = (action) => {
  return (req, res, next) => {
    const originalEnd = res.end
    const startTime = Date.now()

    res.end = function (...args) {
      const duration = Date.now() - startTime

      console.log('[ADMIN AUDIT]', {
        timestamp: new Date().toISOString(),
        action,
        admin: req.user?.email || 'unknown',
        adminId: req.user?._id,
        method: req.method,
        path: req.path,
        params: req.params,
        query: req.query,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip || req.connection?.remoteAddress
      })

      originalEnd.apply(res, args)
    }

    next()
  }
}

/**
 * Rate limiting for admin operations
 * More generous limits than public routes but still protected
 */
const adminRateLimitStore = new Map()

export const adminRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 100,
    keyPrefix = 'admin'
  } = options

  return (req, res, next) => {
    const key = `${keyPrefix}:${req.user?._id || req.ip}`
    const now = Date.now()

    let entry = adminRateLimitStore.get(key)
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now }
    }

    entry.count++
    adminRateLimitStore.set(key, entry)

    if (entry.count > maxRequests) {
      console.warn(`Admin rate limit exceeded for: ${req.user?.email}`)
      if (req.path.startsWith('/api/')) {
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000)
        })
      }
      return res.render('error', {
        title: 'Rate Limit Exceeded',
        message: 'Too many requests. Please try again later.'
      })
    }

    res.setHeader('X-RateLimit-Limit', maxRequests)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + windowMs) / 1000))

    next()
  }
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  const fifteenMinutesAgo = now - 15 * 60 * 1000

  for (const [key, entry] of adminRateLimitStore.entries()) {
    if (entry.windowStart < fifteenMinutesAgo) {
      adminRateLimitStore.delete(key)
    }
  }
}, 5 * 60 * 1000)

export default {
  requireAuth,
  requireSystemAdmin,
  requireSuperAdmin,
  requireAdminAuth,
  requireSuperAdminAuth,
  setAdminContext,
  auditLog,
  adminRateLimit
}
