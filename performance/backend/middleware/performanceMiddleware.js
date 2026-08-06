// Performance-specific permissions
const requirePerformancePermission = (permission) => {
  return async (req, res, next) => {
    const currentOrgId = req.user.currentOrganization?.id || req.user.currentOrganization;
    const currentOrg = (req.user.organizations || req.user.userinfo?.organizations || []).find(org => org.id === currentOrgId);
    const departmentHeadPermissions = Array.isArray(currentOrg?.departmentHeadPermissions) ? currentOrg.departmentHeadPermissions : [];

    // Check organization role permissions
    // Assuming req.user is populated by authMiddleware
    if (req.user.organizationRole === 'owner' || req.user.organizationPermissions?.includes('admin:performance')) {
      req.hasFullAccess = true;
      return next();
    }
    
    // Check team-based permissions based on hierarchy
    // Assuming req.user.teamPermissions is populated (from IdP sync)
    // Note: In app.js, we mapped idpTeamPermissions to user.idpTeamPermissions
    const hasTeamPermission = req.user.idpTeamPermissions?.some(tp => tp.permissions.includes(permission));

    if (hasTeamPermission) {
      req.hasTeamPermission = true;
      req.teamPermissions = req.user.idpTeamPermissions;
      return next();
    }

    if (departmentHeadPermissions.length > 0 && ['view:team-performance', 'view:team-analytics'].includes(permission)) {
      req.hasDepartmentHeadAccess = true;
      req.departmentHeadPermissions = departmentHeadPermissions;
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

  // Use current organization if not specified
  const effectiveOrgId = organizationId || req.user.currentOrganization;

  // Apply team-based filtering
  if (teamId) {
      // Check if user has access to this team's data
      // This is a simplified check. Real implementation would traverse hierarchy.
      const hasAccess = req.user.idpTeams?.some(t => t.id === teamId) || req.hasFullAccess || req.hasDepartmentHeadAccess;
      
      if (!hasAccess) {
         return res.status(403).json({
            error: 'Access denied to team performance data',
            code: 'TEAM_ACCESS_DENIED'
         });
      }
  }

  // Apply organization-level filtering
  if (effectiveOrgId !== req.user.currentOrganization && !req.hasFullAccess) {
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
  req.userTeamHierarchy = req.user.idpTeams || [];

  next();
};

module.exports = {
  requirePerformancePermission,
  canAccessPerformanceData,
  filterPerformanceData
};
