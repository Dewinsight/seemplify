/**
 * Role-Based Access Control (RBAC) Middleware for Performance Management
 * 
 * Roles and Permissions based on industry best practices:
 * 
 * 1. EMPLOYEE (Member)
 *    - View/manage own OKRs
 *    - Submit self-assessments
 *    - View feedback received
 *    - Request peer feedback
 * 
 * 2. TEAM_LEAD
 *    - Everything Employee can do
 *    - View team OKRs (read-only)
 *    - View team members
 *    - Cannot conduct performance reviews
 * 
 * 3. LINE_MANAGER
 *    - Everything Team Lead can do
 *    - View/review direct reports' OKRs
 *    - Conduct performance reviews for direct reports
 *    - Provide manager evaluations
 *    - View team analytics
 *    - Request 360 feedback for reports
 * 
 * 4. HR_ADMIN
 *    - Full access to all performance data
 *    - Create/manage review cycles
 *    - Configure OKR periods
 *    - View organization-wide analytics
 *    - Calibration sessions
 *    - Export reports
 */

// Use centralized OIDC config for userinfo validation when available
let getUserInfoFromOIDC = null;
try {
  const oidcConfig = require('../config/oidc');
  getUserInfoFromOIDC = oidcConfig.getUserInfo;
} catch (e) {
  // OIDC config not available, will use axios fallback
}

const axios = require('axios');
const {
  getOrganizationRole: getOrganizationRoleFromSession,
  isHrPlusRole
} = require('../services/appraisalAccessService');

// Validate Bearer token by calling IdP userinfo endpoint
const getUserInfoFromIdP = async (accessToken) => {
  // Try using OIDC client first (more reliable)
  if (getUserInfoFromOIDC) {
    try {
      return await getUserInfoFromOIDC(accessToken);
    } catch (oidcError) {
      console.warn('OIDC userinfo failed, falling back to axios:', oidcError.message);
    }
  }

  // Fallback to direct axios call
  const idpUrl = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';
  const response = await axios.get(`${idpUrl}/oidc/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return response.data;
};

// Permission definitions
const PERMISSIONS = {
  // OKR Permissions
  'okr:view:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'okr:create:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'okr:edit:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'okr:view:team': ['team_lead', 'line_manager', 'hr_admin'],
  'okr:view:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'okr:review:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'okr:view:all': ['hr_admin'],
  'okr:create:team': ['line_manager', 'hr_admin'],
  'okr:create:organization': ['hr_admin'],

  // Review Permissions
  'review:view:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'review:self_assess': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'review:view:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'review:conduct:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'review:view:all': ['hr_admin'],
  'review:calibrate': ['hr_admin'],

  // Review Cycle Permissions
  'review_cycle:view': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'review_cycle:create': ['hr_admin'],
  'review_cycle:manage': ['hr_admin'],

  // Feedback Permissions
  'feedback:view:received': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'feedback:view:sent': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'feedback:send': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'feedback:request': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'feedback:view:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'feedback:view:all': ['hr_admin'],

  // Analytics Permissions
  'analytics:view:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'analytics:view:team': ['team_lead', 'line_manager', 'hr_admin'],
  'analytics:view:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'analytics:view:organization': ['hr_admin'],
  'analytics:export': ['hr_admin'],

  // Team/User Permissions
  'team:view:own': ['employee', 'team_lead', 'line_manager', 'hr_admin'],
  'team:view:members': ['team_lead', 'line_manager', 'hr_admin'],
  'team:view:all': ['hr_admin'],
  'user:view:direct_reports': ['team_lead', 'line_manager', 'hr_admin'],
  'user:view:all': ['hr_admin'],

  // Admin Permissions
  'admin:settings': ['hr_admin'],
  'admin:reports': ['hr_admin'],
};

/**
 * Get user's effective role from session
 * Priority: HR Admin > Line Manager > Team Lead > Employee
 */
function getUserRole(user) {
  if (!user) return null;

  const currentOrg = getCurrentOrganization(user);
  const currentOrgId = currentOrg?.id || currentOrg?._id?.toString();

  // Check organization role from member claims for current organization.
  const orgRole = getOrganizationRoleFromSession(user, currentOrgId);
  if (isHrPlusRole(orgRole)) {
    return 'hr_admin';
  }

  // Check team roles from IdP claims
  const teams = (user.idpTeams || user.teams || user.userinfo?.teams || []).filter((team) => {
    if (!currentOrgId) return true;
    return !team.organizationId || team.organizationId === currentOrgId;
  });

  // Check if user is a line manager in any team
  const isLineManager = teams.some(t =>
    t.role === 'line_manager' ||
    (t.isManager && t.role === 'line_manager')
  );
  if (isLineManager) return 'line_manager';

  // Check if user is a team lead in any team
  const isTeamLead = teams.some(t => t.role === 'team_lead');
  if (isTeamLead) return 'team_lead';

  // Default to employee
  return 'employee';
}

/**
 * Get user's direct reports from IdP claims
 */
function getDirectReports(user) {
  if (!user) return [];

  const currentOrg = getCurrentOrganization(user);
  const currentOrgId = currentOrg?.id || currentOrg?._id?.toString();
  const teams = (user.idpTeams || user.teams || user.userinfo?.teams || []).filter((team) => {
    if (!currentOrgId) return true;
    return !team.organizationId || team.organizationId === currentOrgId;
  });
  const teamPermissions = user.idpTeamPermissions || user.userinfo?.team_permissions || [];

  const directReportIds = new Set();

  // Get from teams where user has appraisal authority
  teams.forEach(team => {
    if ((team.role === 'line_manager' || team.role === 'team_lead' || team.isManager) && team.directReports) {
      team.directReports.forEach(id => directReportIds.add(id));
    }
    if ((team.role === 'line_manager' || team.role === 'team_lead' || team.isManager) && team.directReportAccountIds) {
      team.directReportAccountIds.forEach(id => directReportIds.add(id));
    }
  });

  // Get from team_permissions
  teamPermissions.forEach(tp => {
    if (tp.direct_reports) {
      tp.direct_reports.forEach(id => directReportIds.add(id));
    }
  });

  return Array.from(directReportIds);
}

/**
 * Get user's managed teams
 */
function getManagedTeams(user) {
  if (!user) return [];

  const currentOrg = getCurrentOrganization(user);
  const currentOrgId = currentOrg?.id || currentOrg?._id?.toString();
  const teams = (user.idpTeams || user.teams || user.userinfo?.teams || []).filter((team) => {
    if (!currentOrgId) return true;
    return !team.organizationId || team.organizationId === currentOrgId;
  });

  return teams.filter(t =>
    t.role === 'line_manager' ||
    t.role === 'team_lead' ||
    t.isManager
  );
}

/**
 * Get user's current organization
 */
function getCurrentOrganization(user) {
  if (!user) return null;

  return user.currentOrganization ||
    user.userinfo?.currentOrganization ||
    user.userinfo?.current_organization ||
    (user.organizations && user.organizations[0]);
}

/**
 * Get user's current team (within current organization)
 * Different from switching organizations - this is for switching teams within an org
 */
function getCurrentTeam(user) {
  if (!user) return null;

  // Check if currentTeam is explicitly set in session
  if (user.currentTeam) {
    return user.currentTeam;
  }

  // Fallback: Get primary team (first team in current organization, or first team with line_manager role)
  const teams = user.idpTeams || user.teams || user.userinfo?.teams || [];
  const currentOrg = getCurrentOrganization(user);
  
  if (!currentOrg) return null;

  // Filter teams by current organization
  const orgTeams = teams.filter(t => 
    t.organizationId === currentOrg.id || 
    t.organizationId === currentOrg._id?.toString() ||
    t.organizationId === currentOrg
  );

  if (orgTeams.length === 0) return null;

  // Priority: line_manager team > team_lead team > first team
  const lineManagerTeam = orgTeams.find(t => t.role === 'line_manager' || t.isManager);
  if (lineManagerTeam) return lineManagerTeam;

  const teamLeadTeam = orgTeams.find(t => t.role === 'team_lead');
  if (teamLeadTeam) return teamLeadTeam;

  return orgTeams[0];
}

/**
 * Check if user has a specific permission
 */
function hasPermission(role, permission) {
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

/**
 * Check if user can access a specific user's data
 */
function canAccessUserData(requestingUser, targetUserId) {
  const role = getUserRole(requestingUser);

  // HR Admin can access all
  if (role === 'hr_admin') return true;

  // Can always access own data
  if (requestingUser.id === targetUserId || requestingUser.sub === targetUserId) {
    return true;
  }

  // Team appraisers can access direct reports
  if (role === 'line_manager' || role === 'team_lead') {
    const directReports = getDirectReports(requestingUser);
    return directReports.includes(targetUserId);
  }

  return false;
}

/**
 * Middleware: Require authentication
 * Supports both session-based auth and Bearer token validation via IdP
 */
const requireAuth = async (req, res, next) => {
  try {
    // 1. Check for session-based authentication first
    if (req.session?.user) {
      req.userRole = getUserRole(req.session.user);
      req.directReports = getDirectReports(req.session.user);
      req.managedTeams = getManagedTeams(req.session.user);
      req.userTeams = req.session.user.idpTeams || req.session.user.teams || req.session.user.userinfo?.teams || [];
      req.currentOrganization = getCurrentOrganization(req.session.user);
      req.currentTeam = getCurrentTeam(req.session.user);
      return next();
    }

    // 2. Check for Bearer token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);

      try {
        // Verify token with Identity Provider
        const userinfo = await getUserInfoFromIdP(accessToken);

        // Create session user from userinfo
        req.session.user = {
          id: userinfo.sub,
          sub: userinfo.sub,
          email: userinfo.email,
          name: userinfo.name,
          organizations: userinfo.organizations || [],
          teams: userinfo.teams || [],
          idpTeams: userinfo.teams || [],
          currentOrganization: userinfo.current_organization || userinfo.currentOrganization,
          userinfo,
          accessToken,
        };

        // Attach role and permissions
        req.userRole = getUserRole(req.session.user);
        req.directReports = getDirectReports(req.session.user);
        req.managedTeams = getManagedTeams(req.session.user);
        req.userTeams = req.session.user.idpTeams || req.session.user.teams || req.session.user.userinfo?.teams || [];
        req.currentOrganization = getCurrentOrganization(req.session.user);
        req.currentTeam = getCurrentTeam(req.session.user);

        return next();
      } catch (tokenError) {
        console.error('Token verification failed:', tokenError.message);
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired access token',
          code: 'INVALID_TOKEN'
        });
      }
    }

    // No authentication found
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware: Require specific permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const role = getUserRole(req.session.user);

    if (!hasPermission(role, permission)) {
      return res.status(403).json({
        success: false,
        error: `Permission denied: ${permission}`,
        code: 'PERMISSION_DENIED',
        requiredPermission: permission,
        userRole: role
      });
    }

    req.userRole = role;
    req.directReports = getDirectReports(req.session.user);
    req.managedTeams = getManagedTeams(req.session.user);
    req.currentOrganization = getCurrentOrganization(req.session.user);

    next();
  };
};

/**
 * Middleware: Require one of multiple permissions
 */
const requireAnyPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const role = getUserRole(req.session.user);
    const hasAny = permissions.some(p => hasPermission(role, p));

    if (!hasAny) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        requiredPermissions: permissions,
        userRole: role
      });
    }

    req.userRole = role;
    req.directReports = getDirectReports(req.session.user);
    req.managedTeams = getManagedTeams(req.session.user);
    req.currentOrganization = getCurrentOrganization(req.session.user);

    next();
  };
};

/**
 * Middleware: Require access to target user's data
 */
const requireUserAccess = (getUserId) => {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const targetUserId = typeof getUserId === 'function'
      ? getUserId(req)
      : req.params[getUserId] || req.params.userId;

    if (!canAccessUserData(req.session.user, targetUserId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this user\'s data',
        code: 'USER_ACCESS_DENIED'
      });
    }

    req.userRole = getUserRole(req.session.user);
    req.directReports = getDirectReports(req.session.user);
    req.targetUserId = targetUserId;

    next();
  };
};

/**
 * Middleware: Require HR Admin role
 */
const requireHRAdmin = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const role = getUserRole(req.session.user);

  if (role !== 'hr_admin') {
    return res.status(403).json({
      success: false,
      error: 'HR Admin access required',
      code: 'HR_ADMIN_REQUIRED',
      userRole: role
    });
  }

  req.userRole = role;
  next();
};

/**
 * Middleware: Require appraiser role or higher
 */
const requireManager = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const role = getUserRole(req.session.user);

  if (role !== 'line_manager' && role !== 'team_lead' && role !== 'hr_admin') {
    return res.status(403).json({
      success: false,
      error: 'Manager or team lead access required',
      code: 'MANAGER_REQUIRED',
      userRole: role
    });
  }

  req.userRole = role;
  req.directReports = getDirectReports(req.session.user);
  req.managedTeams = getManagedTeams(req.session.user);

  next();
};

/**
 * Middleware to verify the target user is a direct report of the current user
 */
const requireDirectReportAccess = (getTargetUserId) => {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const role = getUserRole(req.session.user);

    // HR Admin can access all
    if (role === 'hr_admin') {
      return next();
    }

    const targetUserId = typeof getTargetUserId === 'function'
      ? getTargetUserId(req)
      : req.params[getTargetUserId] || req.params.userId;

    const directReports = getDirectReports(req.session.user);

    if (!directReports.includes(targetUserId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: not your direct report',
        code: 'NOT_DIRECT_REPORT'
      });
    }

    req.targetUserId = targetUserId;
    next();
  };
};

module.exports = {
  PERMISSIONS,
  getUserRole,
  getDirectReports,
  getManagedTeams,
  getCurrentOrganization,
  getCurrentTeam,
  hasPermission,
  canAccessUserData,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireUserAccess,
  requireHRAdmin,
  requireManager,
  requireDirectReportAccess
};
