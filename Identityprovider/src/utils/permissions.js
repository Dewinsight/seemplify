/**
 * Permission utility for OIDC claims
 * Maps roles to permissions for inclusion in OIDC userinfo claims
 *
 * Extensible permission system - supports app-specific permissions
 */

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
  lms: {
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

  // Build claims in PARALLEL for all organizations
  const claimsPromises = activeOrgs.map(async (org) => {
    const orgDoc = org.organization
    const orgId = orgDoc._id?.toString() || orgDoc.toString()

    // Get team permissions for this organization (now optimized)
    const teamPermissions = await getTeamPermissions(account, orgId)

    return {
      id: orgId,
      name: orgDoc.name || null,
      role: org.role,
      permissions: getPermissionsForRole(org.role),
      appPermissions: {
        smarthr: getPermissionsForRole(org.role, 'smarthr'),
        'leave-management': getPermissionsForRole(org.role, 'leave-management')
      },
      // Team-based permissions for this organization
      teamPermissions: teamPermissions,
      joinedAt: org.joinedAt
    }
  })

  const claims = await Promise.all(claimsPromises)

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
