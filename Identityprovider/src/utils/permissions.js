/**
 * Permission utility for OIDC claims
 * Maps roles to permissions for inclusion in OIDC userinfo claims
 *
 * Extensible permission system - supports app-specific permissions
 */

import { Organization } from '../models/Organization.js'
import { normalizeAppAccess } from './appAccess.js'
import {
  getOrCreateGlobalAccessPolicy,
  resolveOrganizationAuthorization
} from '../services/accessControlService.js'

export function organizationClaimAppAccess(accountMembership, organizationMember) {
  // The Organization member is the canonical authorization record used by
  // app launch checks. An older embedded Account membership may still carry
  // its historical default `all`; it must not mask a newer selected-app rule.
  return normalizeAppAccess(organizationMember?.appAccess || accountMembership?.appAccess)
}

// Base permissions (organization-level)
const basePermissions = {
  owner: ['*'], // All permissions
  admin: [
    'manage_users',
    'manage_organizations',
    'manage_invitations',
    'manage_members',
    'manage_roles',
    'manage_jobs',
    'manage_candidates',
    'view_analytics'
  ],
  hr_manager: [
    'manage_jobs',
    'manage_candidates',
    'view_analytics'
  ],
  recruiter: [
    'manage_candidates',
    'view_jobs',
    'view_candidates'
  ],
  interviewer: [
    'view_candidates',
    'view_jobs'
  ]
}

// App-specific permissions (extensible)
const appPermissions = {
  // SmartHR permissions
  smarthr: {
    owner: ['*'],
    admin: ['manage_users', 'manage_jobs', 'manage_candidates', 'view_analytics'],
    hr_manager: ['manage_jobs', 'manage_candidates', 'view_analytics'],
    recruiter: ['manage_candidates', 'view_jobs', 'view_candidates'],
    interviewer: ['view_candidates', 'view_jobs']
  },

  // Leave Management permissions
  'leave-management': {
    owner: ['*'],
    admin: ['manage_leaves', 'approve_leaves', 'view_all_leaves', 'manage_policies'],
    hr_manager: ['approve_leaves', 'view_all_leaves', 'view_analytics'],
    recruiter: ['view_own_leaves', 'request_leaves'],
    interviewer: ['view_own_leaves', 'request_leaves'],
    // Team-based permissions (separate from organization role)
    line_manager: ['approve_leaves', 'view_team_leaves', 'view_direct_reports_leaves'],
    team_lead: ['approve_leaves', 'view_team_leaves', 'view_direct_reports_leaves']
  },

  // LMS permissions (role-based, not org-role based)
  // Based on Frappe LMS DocType permissions
  lms: {
    // LMS Student - Basic learner role (no desk access in Frappe)
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
    
    // Course Creator - Can create and manage courses (desk access in Frappe)
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
    
    // Moderator - Full LMS admin (desk access in Frappe)
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
    
    // Batch Evaluator - Manages batches and evaluates students (desk access in Frappe)
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
    
    // Course Evaluator - Handles certification evaluations (desk access in Frappe)
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
    ]
  }
}

/**
 * Get permissions for a role
 * @param {string} role - The role name
 * @param {string} appContext - Optional app context (e.g., 'smarthr', 'leave-management')
 * @returns {string[]} - Array of permission strings
 */
export function getPermissionsForRole(role, appContext = null) {
  // If app context provided, return app-specific permissions
  if (appContext && appPermissions[appContext]) {
    return appPermissions[appContext][role] || []
  }

  // Return base permissions
  return basePermissions[role] || []
}

/**
 * Get permissions for a specific app
 * @param {string} role - The role name
 * @param {string} appId - The app identifier
 * @returns {string[]} - Array of permission strings
 */
export function getAppPermissions(role, appId) {
  return getPermissionsForRole(role, appId)
}

/**
 * Check if a role has a specific permission
 * @param {string} role - The role name
 * @param {string} permission - The permission to check
 * @param {string} appContext - Optional app context
 * @returns {boolean} - True if role has permission
 */
export function hasPermission(role, permission, appContext = null) {
  const permissions = getPermissionsForRole(role, appContext)
  return permissions.includes('*') || permissions.includes(permission)
}

/**
 * Get all permissions for a user across their organizations
 * @param {Object} account - The account document with populated organizations
 * @returns {Object} - Permissions object by organization
 */
export function getAccountPermissions(account) {
  const permissions = {}

  if (!account.organizations) {
    return permissions
  }

  for (const org of account.organizations) {
    if (!org.isActive) continue

    const orgId = org.organization._id?.toString() || org.organization.toString()
    permissions[orgId] = {
      role: org.role,
      basePermissions: getPermissionsForRole(org.role),
      appPermissions: {
        smarthr: getPermissionsForRole(org.role, 'smarthr'),
        'leave-management': getPermissionsForRole(org.role, 'leave-management')
      }
    }
  }

  return permissions
}

/**
 * Build organization claims for OIDC userinfo
 *
 * OPTIMIZED: Uses parallel processing for team permissions
 *
 * @param {Object} account - The account document with populated organizations
 * @returns {Object[]} - Array of organization claims
 */
export async function buildOrganizationClaims(account) {
  const startTime = Date.now()
  const { getTeamPermissions } = await import('./teams.js')

  if (!account.organizations) {
    console.log(`⏱️ [PERF] buildOrganizationClaims: no orgs (${Date.now() - startTime}ms)`)
    return []
  }

  // Filter active organizations first
  const activeOrgs = account.organizations.filter(org => org.isActive)

  if (activeOrgs.length === 0) {
    console.log(`⏱️ [PERF] buildOrganizationClaims: no active orgs (${Date.now() - startTime}ms)`)
    return []
  }

  const organizationIds = activeOrgs
    .map((org) => org.organization?._id?.toString() || org.organization?.toString())
    .filter(Boolean)

  const organizationDocs = organizationIds.length > 0
    ? await Organization.find({ _id: { $in: organizationIds } })
      .select('name departments branches accessControl members.account members.status members.role members.designation members.employeeId members.branch members.appAccess members.accessControl')
      .lean()
    : []

  const accessPolicy = await getOrCreateGlobalAccessPolicy()

  const organizationDocById = new Map(
    organizationDocs.map((orgDoc) => [orgDoc._id.toString(), orgDoc])
  )

  // Build claims in PARALLEL for all organizations
  const claimsPromises = activeOrgs.map(async (org) => {
    const orgDoc = org.organization
    const orgId = orgDoc._id?.toString() || orgDoc.toString()
    const fullOrgDoc = organizationDocById.get(orgId)
    // Account.organizations is a denormalized navigation aid, not the
    // authorization authority. A crash between removing the canonical
    // Organization member and pruning Account.organizations must fail closed.
    // Never mint an OIDC organization claim unless the canonical organization
    // still contains this account as an active member.
    if (!fullOrgDoc) return null
    const departments = Array.isArray(fullOrgDoc.departments) ? fullOrgDoc.departments : []
    const branches = Array.isArray(fullOrgDoc.branches) ? fullOrgDoc.branches : []
    const memberEntry = Array.isArray(fullOrgDoc.members)
      ? fullOrgDoc.members.find((member) =>
        member?.status === 'active' &&
        member.account?.toString() === account._id.toString()
      )
      : null
    const memberDepartmentIds = Array.from(new Set(
      (account.teams || [])
        .filter((teamMembership) =>
          teamMembership?.isActive &&
          teamMembership.organization?.toString() === orgId &&
          teamMembership.department
        )
        .map((teamMembership) => teamMembership.department.toString())
    ))
    const memberDepartmentId = memberDepartmentIds[0] || null
    const memberDepartment = memberDepartmentId
      ? departments.find((department) => department._id?.toString() === memberDepartmentId)
      : null
    if (!memberEntry) return null
    const memberBranchId = memberEntry?.branch?.toString() || null
    const memberBranch = memberBranchId
      ? branches.find((branch) => branch._id?.toString() === memberBranchId)
      : null
    const headedDepartments = departments
      .filter((department) => department.headAccount?.toString() === account._id.toString())
      .map((department) => ({
        id: department._id.toString(),
        name: department.name,
        permissions: ['approve_leaves', 'view_team_leaves', 'view_direct_reports_leaves', 'manage_attendance', 'manage_performance', 'manage_idp_department']
      }))

    // Get team permissions and the complete IdP-managed product permission
    // matrix for this organization.
    const [teamPermissions, authorization] = await Promise.all([
      getTeamPermissions(account, orgId),
      resolveOrganizationAuthorization({
        account,
        organization: fullOrgDoc,
        member: memberEntry,
        policy: accessPolicy
      })
    ])

    return {
      id: orgId,
      name: fullOrgDoc.name || orgDoc.name || null,
      role: memberEntry.role || org.role,
      designation: memberEntry?.designation || null,
      employeeId: memberEntry?.employeeId || null,
      departmentId: memberDepartmentId,
      departmentName: memberDepartment?.name || null,
      branchId: memberBranchId,
      branchName: memberBranch?.name || null,
      branchCode: memberBranch?.code || null,
      // Downstream apps use this signed claim to distinguish organization
      // membership from authorization to enter a particular product.
      appAccess: organizationClaimAppAccess(org, memberEntry),
      departmentHeadPermissions: headedDepartments,
      permissions: authorization?.permissionsByApp?.identity || getPermissionsForRole(memberEntry.role || org.role),
      appPermissions: authorization?.permissionsByApp || {
        smarthr: getPermissionsForRole(memberEntry.role || org.role, 'smarthr'),
        'leave-management': getPermissionsForRole(memberEntry.role || org.role, 'leave-management')
      },
      authorization,
      // Team-based permissions for this organization
      teamPermissions: teamPermissions,
      joinedAt: org.joinedAt
    }
  })

  const claims = (await Promise.all(claimsPromises)).filter(Boolean)

  console.log(`⏱️ [PERF] buildOrganizationClaims: ${claims.length} orgs in ${Date.now() - startTime}ms`)

  return claims
}

/**
 * Get registered apps for permission mapping
 * @returns {string[]} - Array of app identifiers
 */
export function getRegisteredApps() {
  return Object.keys(appPermissions)
}

/**
 * Register new app permissions (for extensibility)
 * @param {string} appId - The app identifier
 * @param {Object} permissions - Permissions object by role
 */
export function registerAppPermissions(appId, permissions) {
  appPermissions[appId] = permissions
}

export default {
  getPermissionsForRole,
  getAppPermissions,
  hasPermission,
  getAccountPermissions,
  buildOrganizationClaims,
  getRegisteredApps,
  registerAppPermissions
}
