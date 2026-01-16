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
  
  // LMS-specific role - matches Frappe LMS roles
  // Based on research from Frappe LMS codebase:
  // - LMS Student: Basic learner role (no desk access)
  // - Course Creator: Can create/edit courses (desk access)
  // - Moderator: Full LMS admin - publish courses, manage all content (desk access)
  // - Batch Evaluator: Evaluate batches, grade assignments (desk access)
  // - Course Evaluator: Evaluate course certifications (desk access)
  role: {
    type: String,
    enum: [
      'student',           // Maps to Frappe "LMS Student" role
      'course_creator',    // Maps to Frappe "Course Creator" role
      'moderator',         // Maps to Frappe "Moderator" role
      'batch_evaluator',   // Maps to Frappe "Batch Evaluator" role
      'course_evaluator',  // Maps to Frappe "Course Evaluator" role (for certifications)
      'administrator'      // Maps to Frappe "System Manager" role (full Frappe admin)
    ],
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
 * Maps IDP roles to their specific permissions
 * 
 * Based on Frappe LMS DocType permissions:
 * - LMS Student: Read-only on courses, batches, settings
 * - Course Creator: Full CRUD on courses, chapters, lessons, quizzes
 * - Moderator: Full CRUD on all LMS content + settings + publish
 * - Batch Evaluator: Full CRUD on batches, evaluations, assignments
 * - Course Evaluator: Manage course evaluations and certifications
 */
export const LMS_ROLE_PERMISSIONS = {
  // LMS Student - Basic learner role
  student: [
    'view_courses',
    'enroll_courses',
    'view_lessons',
    'submit_assignments',
    'take_quizzes',
    'view_certificates',
    'view_own_progress',
    'participate_discussions',
    'view_batches',
    'view_live_classes'
  ],
  
  // Course Creator - Can create and manage courses
  course_creator: [
    'view_courses',
    'create_courses',
    'edit_own_courses',
    'delete_own_courses',
    'create_chapters',
    'create_lessons',
    'create_quizzes',
    'create_assignments',
    'manage_course_content',
    'view_enrollments',
    'view_student_progress',
    'view_analytics',
    'export_data'
  ],
  
  // Moderator - Full LMS admin (like System Manager for LMS)
  moderator: [
    'view_courses',
    'create_courses',
    'edit_any_course',
    'delete_any_course',
    'publish_courses',
    'unpublish_courses',
    'create_chapters',
    'create_lessons',
    'create_quizzes',
    'create_assignments',
    'manage_course_content',
    'manage_batches',
    'create_batches',
    'edit_batches',
    'delete_batches',
    'manage_enrollments',
    'manage_live_classes',
    'manage_certifications',
    'manage_lms_settings',
    'view_all_analytics',
    'export_data',
    'import_data',
    'moderate_discussions',
    'manage_user_roles'
  ],
  
  // Batch Evaluator - Manages batches and evaluates students
  batch_evaluator: [
    'view_courses',
    'view_batches',
    'create_batches',
    'edit_batches',
    'delete_batches',
    'manage_batch_enrollments',
    'grade_assignments',
    'evaluate_quizzes',
    'view_student_progress',
    'manage_live_classes',
    'send_announcements',
    'view_analytics',
    'export_data',
    'manage_evaluator_schedule'
  ],
  
  // Course Evaluator - Handles certification evaluations
  course_evaluator: [
    'view_courses',
    'view_batches',
    'evaluate_certifications',
    'issue_certificates',
    'revoke_certificates',
    'view_evaluation_schedule',
    'manage_evaluator_schedule',
    'view_student_submissions',
    'grade_final_evaluations',
    'view_analytics'
  ],
  
  // Administrator - Full system access (maps to Frappe System Manager)
  administrator: [
    '*', // All permissions
    'manage_users',
    'manage_settings',
    'manage_system',
    'manage_all_courses',
    'manage_all_batches',
    'manage_all_certificates',
    'manage_all_evaluators',
    'manage_all_content',
    'full_desk_access'
  ]
}

/**
 * Frappe Role Mapping
 * Maps IDP LMS roles to Frappe role names
 */
export const FRAPPE_ROLE_MAPPING = {
  student: 'LMS Student',
  course_creator: 'Course Creator',
  moderator: 'Moderator',
  batch_evaluator: 'Batch Evaluator',
  course_evaluator: 'Course Evaluator',
  administrator: 'System Manager'
}

/**
 * Get Frappe role name from IDP role
 */
export function getFrappeRoleName(idpRole) {
  return FRAPPE_ROLE_MAPPING[idpRole] || 'LMS Student'
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
