function getOrganizationTeams(userinfo = {}, organizationId) {
  return (userinfo.teams || []).filter(team => team.organizationId === organizationId);
}

function getDepartmentHeadScope(userinfo = {}, organizationId) {
  const organization = (userinfo.organizations || []).find(org => org.id === organizationId);
  const headedDepartments = Array.isArray(organization?.departmentHeadPermissions)
    ? organization.departmentHeadPermissions.map((department) => String(department.id)).filter(Boolean)
    : [];

  if (headedDepartments.length === 0) {
    return {
      headedDepartmentIds: [],
      directReports: [],
      teams: [],
    };
  }

  const scopedTeams = getOrganizationTeams(userinfo, organizationId).filter(team =>
    team.departmentId && headedDepartments.includes(String(team.departmentId))
  );

  const directReports = new Set();
  scopedTeams.forEach((team) => {
    (team.directReports || []).forEach((id) => directReports.add(String(id)));
    (team.directReportAccountIds || []).forEach((id) => directReports.add(String(id)));
  });

  return {
    headedDepartmentIds: headedDepartments,
    directReports: Array.from(directReports),
    teams: scopedTeams,
  };
}

// Middleware to require and validate organization selection

const requireOrganization = async (req, res, next) => {
  try {
    // Get organization from various sources (in priority order)
    const orgId =
      req.query.orgId ||
      req.body.organizationId ||
      req.session?.currentOrganizationId ||
      req.user?.userinfo?.currentOrganization?.id ||
      req.user?.currentOrganization?.id;

    if (!orgId) {
      return res.status(400).json({
        error: 'Organization required. Please select an organization.',
        code: 'ORG_REQUIRED',
      });
    }

    // CRITICAL: Verify user belongs to this organization (from OIDC claims)
    // Get organizations from userinfo (from IdP) or directly from user object
    const userOrgs = req.user?.userinfo?.organizations || req.user?.organizations || [];
    
    if (userOrgs.length === 0) {
      console.warn('⚠️ User has no organizations from IdP:', req.user?.email || 'unknown');
      return res.status(400).json({
        error: 'No organizations found. Please ensure you are a member of an organization in the Identity Provider.',
        code: 'NO_ORGANIZATIONS',
      });
    }
    
    const userOrg = userOrgs.find(org => org.id === orgId);

    if (!userOrg) {
      return res.status(403).json({
        error: 'Access denied: You are not a member of this organization',
        code: 'ORG_ACCESS_DENIED',
      });
    }

    // Store validated organization info in request
    req.organizationId = orgId;
    req.organizationRole = userOrg.role;
    req.organizationName = userOrg.name;
    req.organizationPermissions = userOrg.authorization?.permissionsByApp?.['leave-management']
      || userOrg.appPermissions?.['leave-management']
      || [];
    req.organizationPermissionScopes = userOrg.authorization?.permissionScopesByApp?.['leave-management'] || {};
    req.hasCentralAuthorization = Boolean(
      userOrg.authorization?.permissionsByApp &&
      Object.prototype.hasOwnProperty.call(userOrg.authorization.permissionsByApp, 'leave-management')
    );
    req.teamPermissionRows = Array.isArray(userOrg.teamPermissions) ? userOrg.teamPermissions : [];
    req.teamPermissions = req.teamPermissionRows.flatMap(row => row.permissions || []);
    req.departmentHeadPermissions = Array.isArray(userOrg.departmentHeadPermissions) ? userOrg.departmentHeadPermissions : [];
    req.departmentHeadScope = getDepartmentHeadScope(req.user?.userinfo || req.user, orgId);

    // Persist selection in session
    if (req.session) {
      req.session.currentOrganizationId = orgId;
    }

    next();
  } catch (error) {
    console.error('Organization middleware error:', error);
    return res.status(500).json({
      error: 'Organization validation error',
      code: 'ORG_ERROR',
    });
  }
};

// Check if user has specific permission for leave management
const requireLeavePermission = (permission) => {
  return async (req, res, next) => {
    try {
      // Ensure organization is validated first
      if (!req.organizationId) {
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_REQUIRED',
        });
      }

      const permissions = req.organizationPermissions || [];
      const teamPermissions = req.teamPermissions || [];
      const role = req.organizationRole;
      const hasDepartmentHeadAccess = (req.departmentHeadPermissions || []).length > 0;

      // Once the IdP emits the versioned permission matrix it is authoritative.
      // Do not let legacy role fallbacks re-grant a permission explicitly
      // removed by an organization or member override.
      if (req.hasCentralAuthorization) {
        const organizationWideEquivalent = {
          approve_leaves: 'approve_all_leaves',
          view_team_leaves: 'view_all_leaves',
          view_direct_reports_leaves: 'view_all_leaves',
        }[permission];
        const hasOrganizationWideEquivalent = Boolean(
          organizationWideEquivalent && permissions.includes(organizationWideEquivalent)
        );
        if (!permissions.includes(permission) && !hasOrganizationWideEquivalent) {
          return res.status(403).json({
            error: `Permission '${permission}' is not assigned by Seemplify Identity.`,
            code: 'PERMISSION_DENIED',
          });
        }

        const permissionScope = hasOrganizationWideEquivalent
          ? 'organization'
          : (req.organizationPermissionScopes?.[permission] || 'organization');
        if (['team', 'reports'].includes(permissionScope)) {
          req.hasTeamPermission = true;
          req.scopedEmployeeIds = req.teamPermissionRows.flatMap(row => row.directReports || row.directReportAccountIds || []);
          if (hasDepartmentHeadAccess) {
            req.hasDepartmentHeadAccess = true;
            req.scopedEmployeeIds = Array.from(new Set([
              ...(req.scopedEmployeeIds || []),
              ...(req.departmentHeadScope.directReports || []),
            ]));
          }
        } else if (permissionScope === 'department') {
          req.hasDepartmentHeadAccess = hasDepartmentHeadAccess;
          req.scopedEmployeeIds = req.departmentHeadScope.directReports || [];
        } else if (permissionScope === 'organization') {
          req.hasFullAccess = true;
        }
        return next();
      }

      // Owner has all permissions
      if (role === 'owner' || permissions.includes('*')) {
        req.hasFullAccess = true;
        return next();
      }

      // Admin has most permissions
      if (role === 'admin') {
        const adminPermissions = ['manage_leaves', 'approve_leaves', 'view_all_leaves', 'manage_policies'];
        if (adminPermissions.includes(permission)) {
          return next();
        }
      }

      // HR Manager has leave-specific permissions
      if (role === 'hr_manager') {
        const hrPermissions = ['approve_leaves', 'view_all_leaves'];
        if (hrPermissions.includes(permission)) {
          return next();
        }
      }

      // Check explicit organization permissions
      if (permissions.includes(permission)) {
        return next();
      }

      // Check team-based permissions (line_manager role)
      if (teamPermissions.includes(permission)) {
        req.hasTeamPermission = true;
        req.scopedEmployeeIds = req.teamPermissionRows.flatMap(row => row.directReports || row.directReportAccountIds || []);
        return next();
      }

      if (hasDepartmentHeadAccess && ['approve_leaves', 'view_team_leaves', 'view_direct_reports_leaves'].includes(permission)) {
        req.hasDepartmentHeadAccess = true;
        req.scopedEmployeeIds = req.departmentHeadScope.directReports || [];
        return next();
      }

      // Default permissions for all members
      const defaultPermissions = ['view_own_leaves', 'request_leaves'];
      if (defaultPermissions.includes(permission)) {
        return next();
      }

      return res.status(403).json({
        error: `Permission '${permission}' required. Check your organization role or line_manager role in team.`,
        code: 'PERMISSION_DENIED',
      });
    } catch (error) {
      console.error('Permission middleware error:', error);
      return res.status(500).json({
        error: 'Permission validation error',
        code: 'PERMISSION_ERROR',
      });
    }
  };
};

// Check if user can approve leave for specific user (team hierarchy check)
// Supports: line_manager, team_lead roles, and parent team hierarchy
const canApproveLeaveForUser = async (approverId, requesterId, organizationId, userinfo) => {
  const centralOrganization = (userinfo?.organizations || []).find(
    org => String(org.id || org._id) === String(organizationId)
  );
  const centralPermissionsByApp = centralOrganization?.authorization?.permissionsByApp;
  const hasCentralAuthorization = Boolean(
    centralPermissionsByApp &&
    Object.prototype.hasOwnProperty.call(centralPermissionsByApp, 'leave-management')
  );
  const centralPermissions = hasCentralAuthorization
    ? (centralPermissionsByApp['leave-management'] || [])
    : [];
  if (hasCentralAuthorization && centralPermissions.includes('approve_all_leaves')) {
    return { canApprove: true, reason: 'idp_organization_permission', roleType: 'idp' };
  }
  if (hasCentralAuthorization && !centralPermissions.includes('approve_leaves')) {
    return { canApprove: false, reason: 'idp_permission_denied', roleType: 'idp' };
  }
  const centralScope = centralOrganization?.authorization
    ?.permissionScopesByApp?.['leave-management']?.approve_leaves;
  if (hasCentralAuthorization && centralScope === 'organization') {
    return { canApprove: true, reason: 'idp_organization_permission', roleType: 'idp' };
  }

  // Get requester's teams to check hierarchy
  const requesterTeams = (userinfo.teams || []).filter(
    team => team.organizationId === organizationId
  );
  
  // Get approver's teams in this organization where they have approval authority
  // line_manager and team_lead can both approve
  const approverTeams = (userinfo.teams || []).filter(
    team => team.organizationId === organizationId && 
            (team.role === 'line_manager' || team.role === 'team_lead')
  );

  // Check if requester is in approver's direct reports (from any team)
  for (const team of approverTeams) {
    if (team.directReports && team.directReports.includes(requesterId)) {
      return {
        canApprove: true,
        teamId: team.id,
        teamName: team.name,
        reason: 'direct_report',
        roleType: team.role,
      };
    }
  }

  const departmentHeadScope = getDepartmentHeadScope(userinfo, organizationId);
  if (departmentHeadScope.directReports.includes(String(requesterId))) {
    return {
      canApprove: true,
      reason: 'department_head',
      roleType: 'department_head',
      departmentIds: departmentHeadScope.headedDepartmentIds,
    };
  }

  // Check parent team hierarchy
  // If requester is in a sub-team, check if approver manages the parent team
  for (const requesterTeam of requesterTeams) {
    if (requesterTeam.parentTeamId) {
      // Check if approver manages the parent team
      const parentTeamApprover = approverTeams.find(
        at => at.id === requesterTeam.parentTeamId && 
              (at.role === 'line_manager' || at.role === 'team_lead')
      );
      
      if (parentTeamApprover) {
        // Check if requester is in parent team's direct reports (including sub-team members)
        if (parentTeamApprover.directReports && parentTeamApprover.directReports.includes(requesterId)) {
          return {
            canApprove: true,
            teamId: parentTeamApprover.id,
            teamName: parentTeamApprover.name,
            reason: 'parent_team_manager',
            roleType: parentTeamApprover.role,
          };
        }
      }
    }
  }

  // Check if approver is manager of requester's team (even if not in directReports)
  // This handles cases where manager is assigned but directReports might not be populated
  for (const requesterTeam of requesterTeams) {
    if (requesterTeam.managerId === approverId) {
      // Verify approver has line_manager or team_lead role
      const approverTeam = approverTeams.find(at => at.id === requesterTeam.id);
      if (approverTeam && (approverTeam.role === 'line_manager' || approverTeam.role === 'team_lead')) {
        return {
          canApprove: true,
          teamId: requesterTeam.id,
          teamName: requesterTeam.name,
          reason: 'team_manager',
          roleType: approverTeam.role,
        };
      }
    }
  }

  // Check organization role permissions
  const org = centralOrganization;
  if (org) {
    const orgPerms = org.appPermissions?.['leave-management'] || [];

    if (hasCentralAuthorization) {
      return {
        canApprove: false,
        reason: 'outside_idp_permission_scope',
        roleType: 'idp',
      };
    }

    // Owner can approve all
    if (org.role === 'owner' || orgPerms.includes('*')) {
      return {
        canApprove: true,
        reason: 'organization_role',
        roleType: 'owner',
      };
    }

    // Admin can approve all
    if (org.role === 'admin' || orgPerms.includes('approve_leaves')) {
      return {
        canApprove: true,
        reason: 'organization_role',
        roleType: 'admin',
      };
    }

    // HR Manager can approve all
    if (org.role === 'hr_manager') {
      return {
        canApprove: true,
        reason: 'organization_role',
        roleType: 'hr_manager',
      };
    }
  }

  return {
    canApprove: false,
    reason: 'not_direct_report_and_no_org_permission',
  };
};

// Middleware to verify approval permission for specific leave request
const requireApprovalPermission = async (req, res, next) => {
  try {
    const { LeaveRequest } = require('../models');

    const requestId = req.params.id;
    if (!requestId) {
      return res.status(400).json({
        error: 'Leave request ID required',
        code: 'REQUEST_ID_REQUIRED',
      });
    }

    const leaveRequest = await LeaveRequest.findById(requestId);
    if (!leaveRequest) {
      return res.status(404).json({
        error: 'Leave request not found',
        code: 'REQUEST_NOT_FOUND',
      });
    }

    // Verify organization match
    if (leaveRequest.organizationId !== req.organizationId) {
      return res.status(403).json({
        error: 'Leave request belongs to different organization',
        code: 'ORG_MISMATCH',
      });
    }

    // Check approval permission
    const userinfo = req.user?.userinfo || req.user;
    const approvalCheck = await canApproveLeaveForUser(
      req.user.id,
      leaveRequest.userId,
      leaveRequest.organizationId,
      userinfo
    );

    if (!approvalCheck.canApprove) {
      return res.status(403).json({
        error: `Cannot approve: ${approvalCheck.reason}. Line manager role required or organization permission.`,
        code: 'APPROVAL_DENIED',
      });
    }

    // Store approval context for use in route handler
    req.leaveRequest = leaveRequest;
    req.approvalContext = approvalCheck;

    next();
  } catch (error) {
    console.error('Approval permission middleware error:', error);
    return res.status(500).json({
      error: 'Approval permission validation error',
      code: 'APPROVAL_ERROR',
    });
  }
};

module.exports = {
  requireOrganization,
  requireLeavePermission,
  canApproveLeaveForUser,
  requireApprovalPermission,
};
