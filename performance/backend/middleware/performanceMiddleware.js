const { getUserRole } = require('./rbac');

const ROLE_PERMISSIONS = {
  'create:okrs': new Set(['employee', 'team_lead', 'line_manager', 'hr_admin']),
  'participate:reviews': new Set(['employee', 'team_lead', 'line_manager', 'hr_admin']),
  'analyze:feedback': new Set(['employee', 'team_lead', 'line_manager', 'hr_admin']),
  'evaluate:reviews': new Set(['line_manager', 'hr_admin']),
  'view:team-performance': new Set(['team_lead', 'line_manager', 'hr_admin']),
  'view:team-analytics': new Set(['team_lead', 'line_manager', 'hr_admin'])
};

function organizationId(value) {
  return String(value?.id || value?._id || value?.organizationId || value || '').trim();
}

function currentOrganizationId(user = {}) {
  const current = user.currentOrganization
    || user.userinfo?.currentOrganization
    || user.userinfo?.current_organization
    || (user.organizations || user.userinfo?.organizations || [])[0]
    || null;
  return organizationId(current);
}

function teamsForOrganization(user = {}, activeOrganizationId = currentOrganizationId(user)) {
  return (user.idpTeams || user.teams || user.userinfo?.teams || []).filter((team) => {
    const teamOrganizationId = organizationId(team?.organizationId || team?.organization);
    return Boolean(activeOrganizationId && teamOrganizationId === activeOrganizationId);
  });
}

// Performance-specific permissions
const requirePerformancePermission = (permission) => {
  return async (req, res, next) => {
    const user = req.session?.user || req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // requireAuth establishes req.session.user as the authority. Mirror it to
    // req.user for the older team routes that still consume that property.
    req.user = user;
    const currentOrgId = currentOrganizationId(user);
    req.userTeamHierarchy = teamsForOrganization(user, currentOrgId);
    const currentOrganization = user.currentOrganization
      || user.userinfo?.currentOrganization
      || user.userinfo?.current_organization
      || (user.organizations || user.userinfo?.organizations || [])[0]
      || null;
    const resolvedCurrentOrgId = currentOrganization?.id || currentOrganization?._id || currentOrganization;
    const currentOrg = (user.organizations || user.userinfo?.organizations || [])
      .find(org => String(org.id || org._id) === String(resolvedCurrentOrgId));
    const departmentHeadPermissions = Array.isArray(currentOrg?.departmentHeadPermissions) ? currentOrg.departmentHeadPermissions : [];

    // Check organization role permissions
    const organizationRole = user.organizationRole || currentOrg?.role || currentOrg?.organizationRole;
    const organizationPermissions = user.organizationPermissions || currentOrg?.permissions || [];
    const role = req.userRole || getUserRole(user) || 'employee';
    req.userRole = role;
    const roleAllows = ROLE_PERMISSIONS[permission]?.has(role) === true;
    if (role === 'hr_admin' || organizationRole === 'owner' || organizationPermissions.includes('admin:performance')) {
      req.hasFullAccess = true;
      if (roleAllows) return next();
    }
    
    // Check team-based permissions based on hierarchy
    // Assuming req.user.teamPermissions is populated (from IdP sync)
    // Note: In app.js, we mapped idpTeamPermissions to user.idpTeamPermissions
    const teamPermissions = (user.idpTeamPermissions || user.userinfo?.team_permissions || []).filter((teamPermission) => {
      const permissionOrgId = teamPermission?.organization_id || teamPermission?.organizationId;
      return !resolvedCurrentOrgId || !permissionOrgId || String(permissionOrgId) === String(resolvedCurrentOrgId);
    });
    const hasTeamPermission = teamPermissions.some(tp => Array.isArray(tp.permissions) && tp.permissions.includes(permission));

    if (hasTeamPermission) {
      req.hasTeamPermission = true;
      req.teamPermissions = teamPermissions;
      return next();
    }

    if (departmentHeadPermissions.length > 0 && ['view:team-performance', 'view:team-analytics'].includes(permission)) {
      req.hasDepartmentHeadAccess = true;
      req.departmentHeadPermissions = departmentHeadPermissions;
      return next();
    }

    if (roleAllows) {
      req.hasTeamPermission = ['team_lead', 'line_manager'].includes(role);
      return next();
    }
    
    return res.status(403).json({
      error: `Performance permission '${permission}' required`,
      code: 'PERFORMANCE_PERMISSION_DENIED'
    });
  };
};

// Team hierarchy permission check
const canAccessPerformanceData = async (viewerId, targetUserId, organizationId, teamHierarchy) => {
  // Implement hierarchical access logic based on team structure
  // Team leads can view direct reports, line managers can view entire hierarchy
  
  if (!teamHierarchy) return false;

  // Get user's team info from hierarchy
  const viewerTeam = teamHierarchy.find(team => team.id === viewerId); // viewerId here usually refers to user ID, but hierarchy might key off user ID or Team ID depending on structure.
  // Given app.js: user.idpTeams is an array of teams the user belongs to.
  
  // Let's refine based on the user object structure in app.js
  // teamHierarchy passed in is likely req.user.idpTeams
  
  const userTeams = teamHierarchy; // Array of teams user is in

  // Check if any of the user's teams give them access to the target user
  for (const team of userTeams) {
    if (team.role === 'line_manager' || team.isManager) {
        // Simple check: if they are manager of a team the target is in (or sub-team)
        // For now, assuming direct reports list or hierarchy path check
        if (team.directReports && team.directReports.includes(targetUserId)) {
            return true;
        }
    }
    // Self access
    if (viewerId === targetUserId) return true;
  }

  return false;
};

// Performance data filtering middleware
const filterPerformanceData = (req, res, next) => {
  const { 
    organizationId, 
    teamId, 
    userId, 
    period 
  } = req.query;

  const user = req.session?.user || req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  req.user = user;
  const currentOrganization = user.currentOrganization
    || user.userinfo?.currentOrganization
    || user.userinfo?.current_organization
    || (user.organizations || user.userinfo?.organizations || [])[0]
    || null;
  const currentOrgId = currentOrganization?.id || currentOrganization?._id || currentOrganization;

  // Use current organization if not specified
  const effectiveOrgId = organizationId || currentOrgId;

  // Apply team-based filtering
  if (teamId) {
      // Check if user has access to this team's data
      // This is a simplified check. Real implementation would traverse hierarchy.
      const hasAccess = (user.idpTeams || user.teams || user.userinfo?.teams || [])
        .some(t => String(t.id || t._id) === String(teamId)) || req.hasFullAccess || req.hasDepartmentHeadAccess;
      
      if (!hasAccess) {
         return res.status(403).json({
            error: 'Access denied to team performance data',
            code: 'TEAM_ACCESS_DENIED'
         });
      }
  }

  // Apply organization-level filtering
  if (String(effectiveOrgId) !== String(currentOrgId) && !req.hasFullAccess) {
    return res.status(403).json({
      error: 'Access denied to organization performance data',
      code: 'ORG_ACCESS_DENIED'
    });
  }

  // Store filtered parameters for downstream use
  req.filteredQuery = {
    organizationId: effectiveOrgId,
    teamId: teamId,
    userId: userId,
    period: period
  };
  
  // attach team hierarchy for convenience
  req.userTeamHierarchy = teamsForOrganization(user, currentOrgId);

  next();
};

module.exports = {
  requirePerformancePermission,
  teamsForOrganization,
  canAccessPerformanceData,
  filterPerformanceData
};
