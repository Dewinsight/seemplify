import express from 'express'
import { requireAdminAuth, requireSuperAdminAuth, auditLog, adminRateLimit } from '../middleware/adminAuth.js'
import { Account } from '../models/Account.js'
import bcrypt from 'bcrypt'

const router = express.Router()

/**
 * Admin Users Management API Routes
 * Routes for managing system admins
 * Super admins can manage other admins
 */

// Apply admin auth to all routes
router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 100, windowMs: 15 * 60 * 1000 }))

/**
 * GET /api/admin/users
 * Get all system admins
 */
router.get('/', async (req, res) => {
  try {
    const admins = await Account.find({
      $or: [{ isSystemAdmin: true }, { isSuperAdmin: true }]
    }).select('email profile isSystemAdmin isSuperAdmin createdAt')

    res.json({ admins })
  } catch (error) {
    console.error('Error fetching admins:', error)
    res.status(500).json({ error: 'Failed to fetch admins' })
  }
})

/**
 * GET /api/admin/users/search
 * Search for users to make admin
 */
router.get('/search', async (req, res) => {
  try {
    const { email } = req.query

    if (!email || email.length < 3) {
      return res.status(400).json({ error: 'Email search must be at least 3 characters' })
    }

    const users = await Account.find({
      email: { $regex: email, $options: 'i' }
    })
      .select('email profile isSystemAdmin isSuperAdmin createdAt')
      .limit(10)

    res.json({ users })
  } catch (error) {
    console.error('Error searching users:', error)
    res.status(500).json({ error: 'Failed to search users' })
  }
})

/**
 * POST /api/admin/users
 * Create a new admin user (or promote existing user)
 * Requires super admin
 */
router.post('/', requireSuperAdminAuth, auditLog('create_admin'), async (req, res) => {
  try {
    const { email, password, name, isSystemAdmin, isSuperAdmin } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    // Check if user exists
    let account = await Account.findOne({ email: email.toLowerCase() })

    if (account) {
      // Promote existing user to admin
      account.isSystemAdmin = isSystemAdmin !== false
      account.isSuperAdmin = isSuperAdmin === true
      await account.save()

      return res.json({
        message: 'User promoted to admin',
        admin: {
          id: account._id,
          email: account.email,
          name: account.profile?.name,
          isSystemAdmin: account.isSystemAdmin,
          isSuperAdmin: account.isSuperAdmin
        }
      })
    }

    // Create new admin account
    if (!password) {
      return res.status(400).json({ error: 'Password is required for new accounts' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const sub = `local|${Date.now()}`

    account = new Account({
      sub,
      email: email.toLowerCase(),
      passwordHash,
      emailVerified: true,
      profile: {
        name: name || email.split('@')[0],
        preferred_username: email.split('@')[0]
      },
      isSystemAdmin: isSystemAdmin !== false,
      isSuperAdmin: isSuperAdmin === true,
      authProvider: 'local'
    })

    await account.save()

    res.status(201).json({
      message: 'Admin account created',
      admin: {
        id: account._id,
        email: account.email,
        name: account.profile?.name,
        isSystemAdmin: account.isSystemAdmin,
        isSuperAdmin: account.isSuperAdmin
      }
    })
  } catch (error) {
    console.error('Error creating admin:', error)
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' })
    }
    res.status(500).json({ error: 'Failed to create admin' })
  }
})

/**
 * PUT /api/admin/users/:userId
 * Update admin user
 * Requires super admin
 */
router.put('/:userId', requireSuperAdminAuth, auditLog('update_admin'), async (req, res) => {
  try {
    const { userId } = req.params
    const { isSystemAdmin, isSuperAdmin, name } = req.body

    const account = await Account.findById(userId)
    if (!account) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Prevent demoting yourself
    if (account._id.toString() === req.user._id.toString()) {
      if (isSuperAdmin === false && req.user.isSuperAdmin) {
        return res.status(400).json({ error: 'Cannot demote yourself' })
      }
    }

    if (typeof isSystemAdmin === 'boolean') {
      account.isSystemAdmin = isSystemAdmin
    }
    if (typeof isSuperAdmin === 'boolean') {
      account.isSuperAdmin = isSuperAdmin
    }
    if (name) {
      account.profile = account.profile || {}
      account.profile.name = name
    }

    await account.save()

    res.json({
      message: 'Admin updated',
      admin: {
        id: account._id,
        email: account.email,
        name: account.profile?.name,
        isSystemAdmin: account.isSystemAdmin,
        isSuperAdmin: account.isSuperAdmin
      }
    })
  } catch (error) {
    console.error('Error updating admin:', error)
    res.status(500).json({ error: 'Failed to update admin' })
  }
})

/**
 * DELETE /api/admin/users/:userId
 * Remove admin privileges from user
 * Requires super admin
 */
router.delete('/:userId', requireSuperAdminAuth, auditLog('remove_admin'), async (req, res) => {
  try {
    const { userId } = req.params

    const account = await Account.findById(userId)
    if (!account) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Prevent removing yourself
    if (account._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot remove your own admin privileges' })
    }

    account.isSystemAdmin = false
    account.isSuperAdmin = false
    await account.save()

    res.json({
      message: 'Admin privileges removed',
      userId: account._id
    })
  } catch (error) {
    console.error('Error removing admin:', error)
    res.status(500).json({ error: 'Failed to remove admin' })
  }
})

/**
 * POST /api/admin/users/:userId/reset-password
 * Reset admin password
 * Requires super admin
 */
router.post('/:userId/reset-password', requireSuperAdminAuth, auditLog('reset_admin_password'), async (req, res) => {
  try {
    const { userId } = req.params
    const { newPassword } = req.body

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const account = await Account.findById(userId)
    if (!account) {
      return res.status(404).json({ error: 'User not found' })
    }

    account.passwordHash = await bcrypt.hash(newPassword, 12)
    account.lastPasswordChange = new Date()
    await account.save()

    res.json({
      message: 'Password reset successfully',
      userId: account._id
    })
  } catch (error) {
    console.error('Error resetting password:', error)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

export default router
