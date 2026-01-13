import mongoose from 'mongoose'

/**
 * LMS Role Schema
 * 
 * Stores LMS-specific roles for users within organizations.
 * These roles are separate from organization roles (admin, staff, etc.)
 * and specifically control access to LMS features.
 */
const LmsRoleSchema = new mongoose.Schema({
  // The user account
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  
  // The organization context (user can have different LMS roles in different orgs)
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  
  // LMS-specific role
  role: {
    type: String,
    enum: ['instructor', 'student', 'course_creator', 'moderator'],
    required: true
  },
  
  // Who assigned this role (null if self-assigned by admin)
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  
  // When the role was assigned
  assignedAt: {
    type: Date,
    default: Date.now
  },
  
  // Whether this role is currently active
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Optional notes about the role assignment
  notes: {
    type: String
  }
}, {
  timestamps: true
})

// Compound index for unique role per user per org
LmsRoleSchema.index({ account: 1, organization: 1 }, { unique: true })

// Index for querying by role type
LmsRoleSchema.index({ organization: 1, role: 1 })

/**
 * LMS Role Permissions
 * Maps roles to their specific permissions
 */
export const LMS_ROLE_PERMISSIONS = {
  instructor: [
    'view_courses',
    'create_courses',
    'edit_own_courses',
    'manage_batches',
    'grade_assignments',
    'view_student_progress',
    'create_quizzes',
    'send_announcements',
    'view_analytics'
  ],
  student: [
    'view_courses',
    'enroll_courses',
    'submit_assignments',
    'take_quizzes',
    'view_certificates',
    'view_own_progress',
    'participate_discussions'
  ],
  course_creator: [
    'view_courses',
    'create_courses',
    'edit_any_course',
    'manage_course_content',
    'create_quizzes',
    'manage_certifications',
    'view_analytics'
  ],
  moderator: [
    'view_courses',
    'moderate_discussions',
    'manage_user_enrollments',
    'view_reports',
    'handle_support_tickets'
  ]
}

/**
 * Get permissions for a specific LMS role
 */
LmsRoleSchema.statics.getPermissionsForRole = function(role) {
  return LMS_ROLE_PERMISSIONS[role] || []
}

/**
 * Check if user has specific LMS permission
 */
LmsRoleSchema.statics.hasPermission = function(role, permission) {
  const permissions = LMS_ROLE_PERMISSIONS[role] || []
  return permissions.includes(permission)
}

/**
 * Get user's LMS role for an organization
 */
LmsRoleSchema.statics.getUserRole = async function(accountId, organizationId) {
  return this.findOne({
    account: accountId,
    organization: organizationId,
    isActive: true
  })
}

/**
 * Get all users with a specific role in an organization
 */
LmsRoleSchema.statics.getUsersByRole = async function(organizationId, role) {
  return this.find({
    organization: organizationId,
    role: role,
    isActive: true
  }).populate('account', 'email profile.name')
}

/**
 * Assign LMS role to user
 */
LmsRoleSchema.statics.assignRole = async function(accountId, organizationId, role, assignedById) {
  // Check if user already has a role
  const existing = await this.findOne({
    account: accountId,
    organization: organizationId
  })
  
  if (existing) {
    // Update existing role
    existing.role = role
    existing.assignedBy = assignedById
    existing.assignedAt = new Date()
    existing.isActive = true
    return existing.save()
  }
  
  // Create new role
  return this.create({
    account: accountId,
    organization: organizationId,
    role: role,
    assignedBy: assignedById
  })
}

/**
 * Remove LMS role from user
 */
LmsRoleSchema.statics.removeRole = async function(accountId, organizationId) {
  return this.findOneAndUpdate(
    { account: accountId, organization: organizationId },
    { isActive: false },
    { new: true }
  )
}

export const LmsRole = mongoose.model('LmsRole', LmsRoleSchema)
