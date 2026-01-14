import express from 'express'
import { LmsRole, LMS_ROLE_PERMISSIONS } from '../models/LmsRole.js'
import { LmsAccessRequest } from '../models/LmsAccessRequest.js'
import { Account } from '../models/Account.js'
import { MongoAdapter } from '../adapter/mongoAdapter.js'

const router = express.Router()

/**
 * Get session from cookies (same logic as index.js)
 */
async function getSessionFromCookies(req) {
  try {
    const sessionCookie = req.cookies['_session']
    if (!sessionCookie) return null

    const adapter = new MongoAdapter('Session')
    const sessionData = await adapter.find(sessionCookie)

    if (!sessionData?.accountId) return null

    const account = await Account.findOne({ sub: sessionData.accountId })
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')
    
    return account
  } catch (error) {
    console.error('Session lookup error:', error)
    return null
  }
}

/**
 * Middleware to check if user is authenticated
 */
const requireAuth = async (req, res, next) => {
  try {
    // First check express-session (if accountId stored there)
    if (req.session?.accountId) {
      const account = await Account.findOne({ sub: req.session.accountId })
        .populate('organizations.organization', 'name')
        .populate('currentOrganization', 'name')
      if (account) {
        req.account = account
        return next()
      }
    }

    // Try cookie-based session
    const account = await getSessionFromCookies(req)
    if (account) {
      req.account = account
      return next()
    }

    return res.status(401).json({ error: 'Authentication required' })
  } catch (error) {
    console.error('Auth check error:', error)
    return res.status(500).json({ error: 'Authentication check failed' })
  }
}

/**
 * Middleware to check if user is org admin/owner
 */
const requireOrgAdmin = async (req, res, next) => {
  const { organizationId } = req.params
  
  try {
    const account = req.account
    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }
    
    const orgMembership = account.organizations.find(
      o => o.organization._id.toString() === organizationId && o.isActive
    )
    
    if (!orgMembership || !['owner', 'admin'].includes(orgMembership.role)) {
      return res.status(403).json({ error: 'Admin privileges required' })
    }
    
    req.orgMembership = orgMembership
    next()
  } catch (error) {
    console.error('Admin check error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ============================================================================
// LMS Role Endpoints
// ============================================================================

/**
 * GET /api/lms/roles/:organizationId/my-role
 * Get current user's LMS role for an organization
 */
router.get('/roles/:organizationId/my-role', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params
    const account = req.account
    
    const lmsRole = await LmsRole.getUserRole(account._id, organizationId)
    
    if (!lmsRole) {
      return res.json({ 
        hasRole: false,
        role: null,
        permissions: []
      })
    }
    
    res.json({
      hasRole: true,
      role: lmsRole.role,
      permissions: LMS_ROLE_PERMISSIONS[lmsRole.role] || [],
      assignedAt: lmsRole.assignedAt
    })
  } catch (error) {
    console.error('Get my LMS role error:', error)
    res.status(500).json({ error: 'Failed to get LMS role' })
  }
})

/**
 * GET /api/lms/roles/:organizationId
 * Get all LMS roles for an organization (admin only)
 */
router.get('/roles/:organizationId', requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { organizationId } = req.params
    
    const roles = await LmsRole.find({
      organization: organizationId,
      isActive: true
    }).populate('account', 'email profile.name')
      .populate('assignedBy', 'email profile.name')
    
    res.json({
      roles: roles.map(r => ({
        id: r._id,
        user: {
          id: r.account._id,
          email: r.account.email,
          name: r.account.profile?.name
        },
        role: r.role,
        permissions: LMS_ROLE_PERMISSIONS[r.role],
        assignedBy: r.assignedBy ? {
          id: r.assignedBy._id,
          email: r.assignedBy.email,
          name: r.assignedBy.profile?.name
        } : null,
        assignedAt: r.assignedAt
      }))
    })
  } catch (error) {
    console.error('Get LMS roles error:', error)
    res.status(500).json({ error: 'Failed to get LMS roles' })
  }
})

/**
 * POST /api/lms/roles/:organizationId
 * Assign or remove LMS role to a user (admin only or self-assign for admins)
 */
router.post('/roles/:organizationId', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params
    const { userId, role } = req.body
    const currentAccount = req.account
    
    // Validate role (can be null/empty to remove)
    // All Frappe LMS roles: student, course_creator, moderator, batch_evaluator, course_evaluator, administrator
    const validRoles = ['student', 'course_creator', 'moderator', 'batch_evaluator', 'course_evaluator', 'administrator']
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Valid roles: ' + validRoles.join(', ') })
    }
    
    // Check if user is org admin/owner
    const orgMembership = currentAccount.organizations.find(
      o => o.organization._id.toString() === organizationId && o.isActive
    )
    
    const isAdmin = orgMembership && ['owner', 'admin'].includes(orgMembership.role)
    
    // Determine target user
    let targetAccount
    if (userId && userId !== currentAccount._id.toString()) {
      // Assigning to another user - must be admin
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin privileges required to assign roles to others' })
      }
      targetAccount = await Account.findById(userId)
    } else {
      // Self-assignment - must be admin
      if (!isAdmin) {
        return res.status(403).json({ 
          error: 'You do not have permission to self-assign roles. Please submit an access request.',
          requiresAccessRequest: true
        })
      }
      targetAccount = currentAccount
    }
    
    if (!targetAccount) {
      return res.status(404).json({ error: 'Target user not found' })
    }
    
    // If role is empty/null, remove the role
    if (!role) {
      await LmsRole.findOneAndUpdate(
        { account: targetAccount._id, organization: organizationId },
        { isActive: false }
      )
      console.log(`✅ LMS role removed: ${targetAccount.email} in org ${organizationId}`)
      return res.json({ success: true, removed: true })
    }
    
    // Assign the role
    const lmsRole = await LmsRole.assignRole(
      targetAccount._id,
      organizationId,
      role,
      currentAccount._id
    )
    
    console.log(`✅ LMS role assigned: ${targetAccount.email} -> ${role} in org ${organizationId}`)
    
    res.json({
      success: true,
      role: {
        id: lmsRole._id,
        role: lmsRole.role,
        permissions: LMS_ROLE_PERMISSIONS[lmsRole.role],
        assignedAt: lmsRole.assignedAt
      }
    })
  } catch (error) {
    console.error('Assign LMS role error:', error)
    res.status(500).json({ error: 'Failed to assign LMS role' })
  }
})

/**
 * DELETE /api/lms/roles/:organizationId/:roleId
 * Remove LMS role (admin only)
 */
router.delete('/roles/:organizationId/:roleId', requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { roleId } = req.params
    
    const role = await LmsRole.findByIdAndUpdate(
      roleId,
      { isActive: false },
      { new: true }
    )
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found' })
    }
    
    console.log(`✅ LMS role removed: ${roleId}`)
    
    res.json({ success: true })
  } catch (error) {
    console.error('Remove LMS role error:', error)
    res.status(500).json({ error: 'Failed to remove LMS role' })
  }
})

// ============================================================================
// Access Request Endpoints
// ============================================================================

/**
 * POST /api/lms/access-requests/:organizationId
 * Submit access request (non-admins)
 */
router.post('/access-requests/:organizationId', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params
    const { role, reason } = req.body
    const account = req.account
    
    // Validate role - users can request any role, admins will approve
    const validRoles = ['student', 'course_creator', 'moderator', 'batch_evaluator', 'course_evaluator', 'administrator']
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Valid roles: ' + validRoles.join(', ') })
    }
    
    // Check if already has a role
    const existingRole = await LmsRole.getUserRole(account._id, organizationId)
    if (existingRole) {
      return res.status(400).json({ error: 'You already have an LMS role' })
    }
    
    // Create access request
    const request = await LmsAccessRequest.createRequest(
      account._id,
      organizationId,
      role,
      reason || ''
    )
    
    console.log(`📝 LMS access request created: ${account.email} -> ${role}`)
    
    res.json({
      success: true,
      request: {
        id: request._id,
        requestedRole: request.requestedRole,
        status: request.status,
        createdAt: request.createdAt
      }
    })
  } catch (error) {
    console.error('Create access request error:', error)
    if (error.message.includes('already have a pending')) {
      return res.status(400).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to create access request' })
  }
})

/**
 * GET /api/lms/access-requests/:organizationId
 * Get pending access requests (admin only)
 */
router.get('/access-requests/:organizationId', requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { organizationId } = req.params
    
    const requests = await LmsAccessRequest.getPendingRequests(organizationId)
    
    res.json({
      requests: requests.map(r => ({
        id: r._id,
        user: {
          id: r.requestedBy._id,
          email: r.requestedBy.email,
          name: r.requestedBy.profile?.name
        },
        requestedRole: r.requestedRole,
        reason: r.requestReason,
        status: r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt
      }))
    })
  } catch (error) {
    console.error('Get access requests error:', error)
    res.status(500).json({ error: 'Failed to get access requests' })
  }
})

/**
 * GET /api/lms/access-requests/my
 * Get current user's access request status
 */
router.get('/access-requests/my/:organizationId', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params
    const account = req.account
    
    const request = await LmsAccessRequest.findOne({
      requestedBy: account._id,
      organization: organizationId,
      status: 'pending'
    })
    
    if (!request) {
      return res.json({ hasPendingRequest: false })
    }
    
    res.json({
      hasPendingRequest: true,
      request: {
        id: request._id,
        requestedRole: request.requestedRole,
        status: request.status,
        createdAt: request.createdAt
      }
    })
  } catch (error) {
    console.error('Get my access request error:', error)
    res.status(500).json({ error: 'Failed to get access request' })
  }
})

/**
 * PUT /api/lms/access-requests/:organizationId/:requestId/approve
 * Approve access request (admin only)
 */
router.put('/access-requests/:organizationId/:requestId/approve', requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { requestId } = req.params
    const { notes } = req.body
    
    const request = await LmsAccessRequest.approveRequest(
      requestId,
      req.account._id,
      notes || ''
    )
    
    console.log(`✅ LMS access request approved: ${requestId}`)
    
    res.json({
      success: true,
      request: {
        id: request._id,
        status: request.status,
        reviewedAt: request.reviewedAt
      }
    })
  } catch (error) {
    console.error('Approve access request error:', error)
    res.status(500).json({ error: error.message || 'Failed to approve request' })
  }
})

/**
 * POST /api/lms/access-requests/:requestId/approve
 * Approve access request (admin only) - simplified route for UI
 */
router.post('/access-requests/:requestId/approve', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.params
    const account = req.account
    
    // Get the request to find the organization
    const existingRequest = await LmsAccessRequest.findById(requestId)
    if (!existingRequest) {
      return res.status(404).json({ error: 'Request not found' })
    }
    
    // Check if user is admin for this organization
    const orgMembership = account?.organizations.find(
      o => o.organization._id.toString() === existingRequest.organization.toString() && o.isActive
    )
    
    if (!orgMembership || !['owner', 'admin'].includes(orgMembership.role)) {
      return res.status(403).json({ error: 'Admin privileges required' })
    }
    
    const request = await LmsAccessRequest.approveRequest(
      requestId,
      account._id,
      ''
    )
    
    console.log(`✅ LMS access request approved: ${requestId}`)
    
    res.json({
      success: true,
      request: {
        id: request._id,
        status: request.status,
        reviewedAt: request.reviewedAt
      }
    })
  } catch (error) {
    console.error('Approve access request error:', error)
    res.status(500).json({ error: error.message || 'Failed to approve request' })
  }
})

/**
 * POST /api/lms/access-requests/:requestId/reject
 * Reject access request (admin only) - simplified route for UI
 */
router.post('/access-requests/:requestId/reject', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.params
    const account = req.account
    
    // Get the request to find the organization
    const existingRequest = await LmsAccessRequest.findById(requestId)
    if (!existingRequest) {
      return res.status(404).json({ error: 'Request not found' })
    }
    
    // Check if user is admin for this organization
    const orgMembership = account?.organizations.find(
      o => o.organization._id.toString() === existingRequest.organization.toString() && o.isActive
    )
    
    if (!orgMembership || !['owner', 'admin'].includes(orgMembership.role)) {
      return res.status(403).json({ error: 'Admin privileges required' })
    }
    
    const request = await LmsAccessRequest.denyRequest(
      requestId,
      account._id,
      ''
    )
    
    console.log(`❌ LMS access request rejected: ${requestId}`)
    
    res.json({
      success: true,
      request: {
        id: request._id,
        status: request.status,
        reviewedAt: request.reviewedAt
      }
    })
  } catch (error) {
    console.error('Reject access request error:', error)
    res.status(500).json({ error: error.message || 'Failed to reject request' })
  }
})

/**
 * PUT /api/lms/access-requests/:organizationId/:requestId/deny
 * Deny access request (admin only)
 */
router.put('/access-requests/:organizationId/:requestId/deny', requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { requestId } = req.params
    const { notes } = req.body
    
    const request = await LmsAccessRequest.denyRequest(
      requestId,
      req.account._id,
      notes || ''
    )
    
    console.log(`❌ LMS access request denied: ${requestId}`)
    
    res.json({
      success: true,
      request: {
        id: request._id,
        status: request.status,
        reviewedAt: request.reviewedAt
      }
    })
  } catch (error) {
    console.error('Deny access request error:', error)
    res.status(500).json({ error: error.message || 'Failed to deny request' })
  }
})

// ============================================================================
// Utility Endpoints
// ============================================================================

/**
 * GET /api/lms/role-options
 * Get available LMS roles and their descriptions
 * These map directly to Frappe LMS roles
 */
router.get('/role-options', (req, res) => {
  res.json({
    roles: [
      {
        id: 'student',
        name: 'Student',
        frappeRole: 'LMS Student',
        description: 'Enroll in courses, submit assignments, take quizzes, and earn certificates',
        deskAccess: false,
        permissions: LMS_ROLE_PERMISSIONS.student
      },
      {
        id: 'course_creator',
        name: 'Course Creator',
        frappeRole: 'Course Creator',
        description: 'Create and manage courses, chapters, lessons, and quizzes',
        deskAccess: true,
        permissions: LMS_ROLE_PERMISSIONS.course_creator
      },
      {
        id: 'moderator',
        name: 'Moderator',
        frappeRole: 'Moderator',
        description: 'Full LMS admin - publish courses, manage all content, settings, and users',
        deskAccess: true,
        permissions: LMS_ROLE_PERMISSIONS.moderator
      },
      {
        id: 'batch_evaluator',
        name: 'Batch Evaluator',
        frappeRole: 'Batch Evaluator',
        description: 'Manage batches, grade assignments, evaluate student progress',
        deskAccess: true,
        permissions: LMS_ROLE_PERMISSIONS.batch_evaluator
      },
      {
        id: 'course_evaluator',
        name: 'Course Evaluator',
        frappeRole: 'Course Evaluator',
        description: 'Evaluate certifications, issue and manage certificates',
        deskAccess: true,
        permissions: LMS_ROLE_PERMISSIONS.course_evaluator
      }
    ]
  })
})

export default router
