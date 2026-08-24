const { claimedPermissions, hasPermission } = require('../middleware/rbac');

const GOAL_PERMISSION_SCOPES = Object.freeze({
  VIEW_OWN: 'okr:view:own',
  VIEW_TEAM: 'okr:view:team',
  VIEW_DIRECT_REPORTS: 'okr:view:direct_reports',
  VIEW_ALL: 'okr:view:all',
  CREATE_OWN: 'goal:create:self',
  ASSIGN_DIRECT_REPORTS: 'goal:assign:direct_reports',
  ASSIGN_DEPARTMENT: 'goal:assign:department',
  ASSIGN_ORGANIZATION: 'goal:assign:organization',
  DECIDE_DIRECT_REPORTS: 'okr:decide:direct_reports',
  ACKNOWLEDGE_OWN: 'okr:acknowledge:own',
  REQUEST_CHANGE_OWN: 'okr:request_change:own',
  CHECK_IN_OWN: 'okr:checkin:own',
  CHECK_IN_DIRECT_REPORTS: 'okr:checkin:direct_reports',
  ALIGN: 'okr:align',
  BULK_ASSIGN: 'okr:bulk_assign',
  VIEW_PERIODS: 'goal_period:view',
  MANAGE_PERIODS: 'goal_period:manage'
});

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    return String(value.id || value._id || value.organizationId || value.teamId || '');
  }
  return String(value);
}

function resolveOrganizationId(req) {
  return normalizeId(
    req?.currentOrganization?.id ||
    req?.currentOrganization?._id ||
    req?.session?.currentOrganizationId ||
    req?.session?.user?.currentOrganization?.id ||
    req?.session?.user?.currentOrganization?._id
  );
}

function resolveUserId(req) {
  return normalizeId(req?.session?.user?.id || req?.session?.user?.sub);
}

function resolveRole(req) {
  return req?.userRole || 'employee';
}

function actorHasPermission(req, permission) {
  return hasPermission(resolveRole(req), permission, req?.session?.user || req?.user);
}

function uniqueIds(values = []) {
  return Array.from(new Set(values.map(normalizeId).filter(Boolean)));
}

function getDirectReportIds(req) {
  return uniqueIds(req?.directReports || []);
}

function getUserTeamIds(req) {
  const orgId = resolveOrganizationId(req);
  const teams = req?.userTeams || req?.session?.user?.idpTeams || req?.session?.user?.teams || [];
  return uniqueIds(teams
    .filter((team) => !orgId || !team.organizationId || normalizeId(team.organizationId) === orgId)
    .map((team) => team.id || team._id || team.teamId));
}

function getManagedTeamIds(req) {
  return uniqueIds((req?.managedTeams || [])
    .map((team) => team.id || team._id || team.teamId)
    .concat(
      (req?.userTeams || [])
        .filter((team) => team.isManager || ['line_manager', 'team_lead'].includes(team.role))
        .map((team) => team.id || team._id || team.teamId)
    ));
}

function getUserDepartmentIds(req) {
  const user = req?.session?.user || {};
  const teams = req?.userTeams || user.idpTeams || user.teams || user.userinfo?.teams || [];
  return uniqueIds([
    user.departmentId,
    user.department?.id,
    user.userinfo?.departmentId,
    ...teams.map((team) => team.departmentId || team.department?.id)
  ]);
}

function getManagedDepartmentIds(req) {
  const user = req?.session?.user || {};
  const organizationId = resolveOrganizationId(req);
  const organizations = user.organizations || user.userinfo?.organizations || [];
  const organization = organizations.find((item) =>
    normalizeId(item.id || item._id || item.organizationId) === organizationId
  );
  return uniqueIds((organization?.departmentHeadPermissions || []).map((department) =>
    department.id || department._id || department.departmentId
  ));
}

function getActor(req) {
  return {
    userId: resolveUserId(req),
    name: req?.session?.user?.name || '',
    email: req?.session?.user?.email || '',
    role: resolveRole(req),
    organizationId: resolveOrganizationId(req)
  };
}

function isHr(req) {
  const centralPermissions = claimedPermissions(req?.session?.user || req?.user);
  if (centralPermissions) return false;
  return resolveRole(req) === 'hr_admin';
}

function isGoalInCurrentOrganization(req, goal) {
  const orgId = resolveOrganizationId(req);
  return Boolean(orgId && goal && normalizeId(goal.organizationId) === orgId);
}

function isOwner(req, goal) {
  return Boolean(goal && resolveUserId(req) && normalizeId(goal.ownerId) === resolveUserId(req));
}

function isDirectReport(req, ownerId) {
  return getDirectReportIds(req).includes(normalizeId(ownerId));
}

function isGoalTeamVisible(req, goal) {
  const teamId = normalizeId(goal?.teamHierarchy?.teamId || goal?.teamId);
  if (!teamId) return false;
  return getUserTeamIds(req).includes(teamId) || getManagedTeamIds(req).includes(teamId);
}

function isGoalDepartmentVisible(req, goal) {
  const departmentId = normalizeId(goal?.teamHierarchy?.departmentId || goal?.departmentId);
  if (!departmentId) return false;
  return getUserDepartmentIds(req).includes(departmentId) || getManagedDepartmentIds(req).includes(departmentId);
}

function canViewGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal)) return false;
  if (actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_ALL) || isHr(req)) return true;
  if (isOwner(req, goal)) return actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_OWN);
  if (goal.type === 'organization') return actorHasPermission(req, 'okr:view:organization');
  if (goal.type === 'department') {
    return actorHasPermission(req, 'okr:view:department') && isGoalDepartmentVisible(req, goal);
  }
  if (goal.type === 'team') {
    return actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_TEAM) && isGoalTeamVisible(req, goal);
  }
  if (isDirectReport(req, goal.ownerId)) {
    return actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_DIRECT_REPORTS);
  }
  return normalizeId(goal?.createdBy?.userId) === resolveUserId(req) &&
    actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_OWN);
}

function canAssignGoal(req, { ownerId, type = 'individual', teamId, departmentId } = {}) {
  const role = resolveRole(req);
  const userId = resolveUserId(req);
  if (!userId || !resolveOrganizationId(req)) return false;

  if (actorHasPermission(req, 'goal:assign:all') || isHr(req)) return true;
  if (type === 'organization') {
    return actorHasPermission(req, GOAL_PERMISSION_SCOPES.ASSIGN_ORGANIZATION);
  }
  if (type === 'department') {
    return actorHasPermission(req, GOAL_PERMISSION_SCOPES.ASSIGN_DEPARTMENT) &&
      (isHr(req) || getManagedDepartmentIds(req).includes(normalizeId(departmentId)));
  }
  if (type === 'team') {
    return actorHasPermission(req, 'okr:create:team') && getManagedTeamIds(req).includes(normalizeId(teamId));
  }
  if (normalizeId(ownerId) === userId) return actorHasPermission(req, GOAL_PERMISSION_SCOPES.CREATE_OWN);
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.ASSIGN_DIRECT_REPORTS) && isDirectReport(req, ownerId);
}

function canSubmitGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal) || !isOwner(req, goal)) return false;
  if (goal?.assignment?.assignedBy?.userId) return false;
  return actorHasPermission(req, 'okr:submit:own') &&
    ['draft', 'changes_requested'].includes(goal?.lifecycle?.state || 'draft');
}

function canDecideGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal) || isOwner(req, goal)) return false;
  if (actorHasPermission(req, 'okr:decide:all') || isHr(req)) return true;
  const setterId = normalizeId(goal?.assignment?.assignedBy?.userId);
  if (setterId) {
    return setterId === resolveUserId(req) &&
      actorHasPermission(req, GOAL_PERMISSION_SCOPES.DECIDE_DIRECT_REPORTS);
  }
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.DECIDE_DIRECT_REPORTS) &&
    isDirectReport(req, goal.ownerId);
}

function canAcknowledgeGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal) || !isOwner(req, goal)) return false;
  if (!goal?.assignment?.assignedBy?.userId) return false;
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.ACKNOWLEDGE_OWN) &&
    goal?.assignment?.acknowledgementStatus === 'pending';
}

function canRequestGoalChange(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal) || !isOwner(req, goal)) return false;
  if (!goal?.assignment?.assignedBy?.userId) return false;
  if (goal?.periodId?.settings?.allowEmployeeChangeRequests === false) return false;
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.REQUEST_CHANGE_OWN) &&
    ['pending_acknowledgement', 'active', 'changes_requested'].includes(goal?.lifecycle?.state);
}

function canEditGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal)) return false;
  const state = goal?.lifecycle?.state || goal?.status;
  if (['closed', 'cancelled', 'rejected'].includes(state) || ['closed', 'cancelled', 'rejected'].includes(goal?.status)) {
    return false;
  }
  if (actorHasPermission(req, 'okr:edit:all') || isHr(req)) return true;
  if (isOwner(req, goal)) {
    return actorHasPermission(req, 'okr:edit:own') && !goal?.assignment?.assignedBy?.userId;
  }
  if (!actorHasPermission(req, GOAL_PERMISSION_SCOPES.ASSIGN_DIRECT_REPORTS)) return false;
  return isDirectReport(req, goal.ownerId);
}

function canCheckInGoal(req, goal) {
  if (!isGoalInCurrentOrganization(req, goal)) return false;
  if (actorHasPermission(req, 'okr:checkin:all') || isHr(req)) return true;
  if (isOwner(req, goal)) {
    return actorHasPermission(req, GOAL_PERMISSION_SCOPES.CHECK_IN_OWN);
  }
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.CHECK_IN_DIRECT_REPORTS) &&
    isDirectReport(req, goal.ownerId);
}

function canAlignGoal(req, goal) {
  return actorHasPermission(req, GOAL_PERMISSION_SCOPES.ALIGN) && canEditGoal(req, goal);
}

function buildGoalVisibilityQuery(req) {
  const organizationId = resolveOrganizationId(req);
  if (!organizationId) return null;
  if (actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_ALL) || isHr(req)) return { organizationId };

  const userId = resolveUserId(req);
  const directReports = getDirectReportIds(req);
  const teamIds = uniqueIds(getUserTeamIds(req).concat(getManagedTeamIds(req)));
  const departmentIds = uniqueIds(getUserDepartmentIds(req).concat(getManagedDepartmentIds(req)));
  const visibility = [];
  if (actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_OWN)) {
    visibility.push({ ownerId: userId }, { 'createdBy.userId': userId });
  }
  if (actorHasPermission(req, 'okr:view:organization')) visibility.push({ type: 'organization' });
  if (actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_DIRECT_REPORTS) && directReports.length > 0) {
    visibility.push({ ownerId: { $in: directReports } });
  }
  if (actorHasPermission(req, GOAL_PERMISSION_SCOPES.VIEW_TEAM) && teamIds.length > 0) {
    visibility.push({ type: 'team', 'teamHierarchy.teamId': { $in: teamIds } });
  }
  if (actorHasPermission(req, 'okr:view:department') && departmentIds.length > 0) {
    visibility.push({ type: 'department', 'teamHierarchy.departmentId': { $in: departmentIds } });
  }

  return visibility.length > 0 ? { organizationId, $or: visibility } : { organizationId, _id: { $exists: false } };
}

function getGoalPermissionFlags(req, goal) {
  return {
    view: canViewGoal(req, goal),
    edit: canEditGoal(req, goal),
    submit: canSubmitGoal(req, goal),
    decide: canDecideGoal(req, goal),
    acknowledge: canAcknowledgeGoal(req, goal),
    requestChange: canRequestGoalChange(req, goal),
    checkIn: canCheckInGoal(req, goal),
    align: canAlignGoal(req, goal)
  };
}

module.exports = {
  GOAL_PERMISSION_SCOPES,
  buildGoalVisibilityQuery,
  canAcknowledgeGoal,
  canAlignGoal,
  canAssignGoal,
  canCheckInGoal,
  canDecideGoal,
  canEditGoal,
  canRequestGoalChange,
  canSubmitGoal,
  canViewGoal,
  getActor,
  getDirectReportIds,
  getGoalPermissionFlags,
  getManagedTeamIds,
  getManagedDepartmentIds,
  getUserDepartmentIds,
  getUserTeamIds,
  isGoalInCurrentOrganization,
  isHr,
  isOwner,
  normalizeId,
  resolveOrganizationId,
  resolveRole,
  resolveUserId,
  uniqueIds
};
