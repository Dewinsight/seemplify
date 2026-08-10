const User = require('../models/User');

const HR_PLUS_MEMBER_ROLES = new Set(['owner', 'admin', 'hr_manager']);
const TEAM_APPRAISER_ROLES = new Set(['line_manager', 'team_lead']);
const APPRAISER_USER_ROLES = new Set(['hr_admin', 'line_manager', 'team_lead']);

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value.id) return String(value.id);
    if (value._id) return String(value._id);
    if (typeof value.toString === 'function') return String(value.toString());
  }
  return null;
}

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

function getSessionUser(req) {
  return req?.session?.user || null;
}

function pickCurrentOrganizationId(req, sessionUser = getSessionUser(req)) {
  return normalizeId(
    req?.currentOrganization?.id ||
    req?.currentOrganization?._id ||
    req?.session?.currentOrganizationId ||
    sessionUser?.currentOrganization?.id ||
    sessionUser?.currentOrganization?._id ||
    sessionUser?.userinfo?.current_organization?.id ||
    sessionUser?.userinfo?.currentOrganization?.id ||
    sessionUser?.currentOrganizationId ||
    sessionUser?.organizations?.[0]?.id ||
    sessionUser?.userinfo?.organizations?.[0]?.id
  );
}

function getSessionOrganizations(sessionUser) {
  if (!sessionUser) return [];
  return sessionUser.organizations ||
    sessionUser.userinfo?.organizations ||
    sessionUser.idpOrganizations ||
    [];
}

function getOrganizationRole(sessionUser, organizationId = null) {
  if (!sessionUser) return null;

  const orgs = getSessionOrganizations(sessionUser);
  const currentOrgId = normalizeId(
    organizationId ||
    sessionUser.currentOrganization?.id ||
    sessionUser.currentOrganization?._id ||
    sessionUser.userinfo?.current_organization?.id ||
    sessionUser.userinfo?.currentOrganization?.id
  );

  if (currentOrgId) {
    const matchingOrg = orgs.find((org) => {
      const orgId = normalizeId(org?.id || org?._id || org?.organizationId);
      return orgId === currentOrgId;
    });
    if (matchingOrg?.role) {
      return matchingOrg.role;
    }
  }

  if (sessionUser.currentOrganization?.role) {
    return sessionUser.currentOrganization.role;
  }

  return orgs[0]?.role || null;
}

function isHrPlusRole(role) {
  return HR_PLUS_MEMBER_ROLES.has(String(role || '').toLowerCase());
}

function isAppraisalManagerRole(userRole) {
  return APPRAISER_USER_ROLES.has(String(userRole || '').toLowerCase());
}

function getUserTeams(sessionUser, organizationId = null) {
  if (!sessionUser) return [];

  const orgId = normalizeId(organizationId);
  const teams = sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
  if (!orgId) return teams;

  return teams.filter((team) => {
    const teamOrgId = normalizeId(team.organizationId);
    return !teamOrgId || teamOrgId === orgId;
  });
}

function getManagedRootTeams(sessionUser, organizationId = null) {
  return getUserTeams(sessionUser, organizationId)
    .filter((team) => {
      const teamRole = String(team.role || '').toLowerCase();
      return TEAM_APPRAISER_ROLES.has(teamRole) || team.isManager;
    })
    .map((team) => ({
      id: normalizeId(team.id),
      name: team.name,
      role: team.role,
      organizationId: normalizeId(team.organizationId),
      parentTeamId: normalizeId(team.parentTeamId)
    }))
    .filter((team) => !!team.id);
}

function collectHierarchyTeamIds(rootTeamIds, teamNodesById) {
  const accessible = new Set();
  const queue = [...rootTeamIds];

  while (queue.length > 0) {
    const teamId = queue.shift();
    if (!teamId || accessible.has(teamId)) continue;

    accessible.add(teamId);
    for (const [candidateId, node] of teamNodesById.entries()) {
      if (!candidateId || !node?.parentTeamId) continue;
      if (node.parentTeamId === teamId && !accessible.has(candidateId)) {
        queue.push(candidateId);
      }
    }
  }

  return accessible;
}

function getDisplayName(userDoc) {
  return userDoc?.profile?.displayName ||
    `${userDoc?.profile?.firstName || ''} ${userDoc?.profile?.lastName || ''}`.trim() ||
    userDoc?.email?.split('@')?.[0] ||
    'Unknown';
}

function getPrimaryUserIdentity(userDoc) {
  return normalizeId(userDoc?.idpSub) || normalizeId(userDoc?._id);
}

function pickPrimaryTeam(userTeams, accessibleTeamIdsSet, isHrPlus) {
  if (!Array.isArray(userTeams) || userTeams.length === 0) return null;
  if (isHrPlus) return userTeams[0];

  const matching = userTeams.find((team) => accessibleTeamIdsSet.has(normalizeId(team.id)));
  return matching || userTeams[0];
}

async function resolveAppraisalAccessScope(req, { force = false, includeSelf = false } = {}) {
  const cacheKey = includeSelf ? '_appraisalAccessScopeWithSelf' : '_appraisalAccessScope';
  if (!force && req[cacheKey]) {
    return req[cacheKey];
  }

  const sessionUser = getSessionUser(req);
  const organizationId = pickCurrentOrganizationId(req, sessionUser);
  const organizationRole = getOrganizationRole(sessionUser, organizationId);
  const isHrPlus = req?.userRole === 'hr_admin' || isHrPlusRole(organizationRole);
  const userRole = req?.userRole || null;
  const managedTeams = getManagedRootTeams(sessionUser, organizationId);
  const managedRootTeamIds = managedTeams.map((team) => team.id);
  const directReportIdsFromClaims = new Set((req?.directReports || []).map(normalizeId).filter(Boolean));

  const scope = {
    organizationId,
    organizationRole,
    userRole,
    includeSelf,
    isHrPlus,
    canManageAppraisals: isHrPlus || isAppraisalManagerRole(userRole),
    managedTeams,
    managedRootTeamIds,
    accessibleTeamIds: [...managedRootTeamIds],
    directReportIds: Array.from(directReportIdsFromClaims),
    directReportEmails: [],
    directReports: [],
    organizationUsers: []
  };

  if (!scope.canManageAppraisals || !organizationId) {
    req[cacheKey] = scope;
    return scope;
  }

  const orgUsers = await User.find({
    $or: [
      { currentOrganizationId: organizationId },
      { 'idpTeams.organizationId': organizationId }
    ]
  })
    .select('idpSub email profile idpTeams')
    .lean();

  if (!orgUsers.length) {
    req[cacheKey] = scope;
    return scope;
  }

  const teamNodesById = new Map();
  orgUsers.forEach((userDoc) => {
    (userDoc.idpTeams || [])
      .filter((team) => normalizeId(team.organizationId) === organizationId)
      .forEach((team) => {
        const teamId = normalizeId(team.id);
        if (!teamId || teamNodesById.has(teamId)) return;

        teamNodesById.set(teamId, {
          id: teamId,
          name: team.name,
          parentTeamId: normalizeId(team.parentTeamId)
        });
      });
  });

  const accessibleTeamIdsSet = isHrPlus
    ? new Set(Array.from(teamNodesById.keys()))
    : collectHierarchyTeamIds(managedRootTeamIds, teamNodesById);

  if (!isHrPlus && accessibleTeamIdsSet.size === 0) {
    req[cacheKey] = scope;
    return scope;
  }

  const selfEmail = normalizeEmail(sessionUser?.email);
  const directReportIdSet = new Set(directReportIdsFromClaims);
  const directReportEmailSet = new Set();
  const mappedUsers = [];

  orgUsers.forEach((userDoc) => {
    const email = normalizeEmail(userDoc.email);
    const isSelf = Boolean(selfEmail && email && selfEmail === email);
    if (!includeSelf && isSelf) return;

    const userTeams = (userDoc.idpTeams || []).filter(
      (team) => normalizeId(team.organizationId) === organizationId
    );
    if (userTeams.length === 0) return;

    const isInScope = isHrPlus || userTeams.some((team) => {
      const teamId = normalizeId(team.id);
      return teamId && accessibleTeamIdsSet.has(teamId);
    });
    if (!isInScope) return;

    const primaryTeam = pickPrimaryTeam(userTeams, accessibleTeamIdsSet, isHrPlus);
    const userId = getPrimaryUserIdentity(userDoc);

    if (userId) directReportIdSet.add(userId);
    if (email) directReportEmailSet.add(email);

    mappedUsers.push({
      userId,
      email: userDoc.email,
      name: getDisplayName(userDoc),
      jobTitle: userDoc.profile?.title || primaryTeam?.role || 'Employee',
      department: primaryTeam?.departmentName || userDoc.profile?.department || '',
      departmentId: normalizeId(primaryTeam?.departmentId) || null,
      departmentName: primaryTeam?.departmentName || userDoc.profile?.department || '',
      teamId: normalizeId(primaryTeam?.id),
      teamName: primaryTeam?.name || null,
      teamRole: primaryTeam?.role || null,
      isManager: !!(primaryTeam?.isManager || primaryTeam?.role === 'line_manager' || primaryTeam?.role === 'team_lead'),
      managerId: normalizeId(primaryTeam?.managerId) || null,
      managerName: primaryTeam?.managerName || null,
      managerEmail: primaryTeam?.managerEmail || null,
      teamIds: userTeams.map((team) => normalizeId(team.id)).filter(Boolean),
      isSelf
    });
  });

  const dedupedUsers = Array.from(
    new Map(
      mappedUsers
        .map((user) => {
          const key = user.userId || normalizeEmail(user.email);
          return key ? [key, user] : null;
        })
        .filter(Boolean)
    ).values()
  );

  scope.accessibleTeamIds = Array.from(accessibleTeamIdsSet);
  scope.directReportIds = Array.from(directReportIdSet);
  scope.directReportEmails = Array.from(directReportEmailSet);
  scope.directReports = dedupedUsers;
  scope.organizationUsers = dedupedUsers;

  req[cacheKey] = scope;
  return scope;
}

async function canAppraiseEmployee(req, { targetUserId, targetEmail } = {}) {
  const scope = await resolveAppraisalAccessScope(req);
  if (!scope.canManageAppraisals) return false;
  if (scope.isHrPlus) return true;

  const normalizedTargetId = normalizeId(targetUserId);
  const normalizedTargetEmail = normalizeEmail(targetEmail);

  if (normalizedTargetId) {
    const idSet = new Set(scope.directReportIds.map(normalizeId).filter(Boolean));
    if (idSet.has(normalizedTargetId)) return true;
  }

  if (normalizedTargetEmail) {
    const emailSet = new Set(scope.directReportEmails.map(normalizeEmail).filter(Boolean));
    if (emailSet.has(normalizedTargetEmail)) return true;
  }

  return false;
}

function isAssignedManager(req, appraisal) {
  if (!req?.session?.user || !appraisal?.manager) return false;
  const requesterId = normalizeId(req.session.user.id || req.session.user.sub);
  const requesterEmail = normalizeEmail(req.session.user.email);
  const assignedManagerId = normalizeId(appraisal.manager.userId);
  const assignedManagerEmail = normalizeEmail(appraisal.manager.email);

  return (requesterId && assignedManagerId && requesterId === assignedManagerId) ||
    (requesterEmail && assignedManagerEmail && requesterEmail === assignedManagerEmail);
}

function appraisalBelongsToCurrentOrganization(req, appraisal) {
  const currentOrganizationId = pickCurrentOrganizationId(req);
  const appraisalOrganizationId = normalizeId(appraisal?.organizationId);
  return Boolean(
    currentOrganizationId
      && appraisalOrganizationId
      && currentOrganizationId === appraisalOrganizationId
  );
}

async function canManageAppraisal(req, appraisal) {
  if (!appraisal || !appraisalBelongsToCurrentOrganization(req, appraisal)) return false;
  if (isAssignedManager(req, appraisal)) return true;

  return canAppraiseEmployee(req, {
    targetUserId: appraisal.employee?.userId,
    targetEmail: appraisal.employee?.email
  });
}

module.exports = {
  APPRAISER_USER_ROLES,
  TEAM_APPRAISER_ROLES,
  HR_PLUS_MEMBER_ROLES,
  isHrPlusRole,
  isAppraisalManagerRole,
  getOrganizationRole,
  resolveAppraisalAccessScope,
  canAppraiseEmployee,
  canManageAppraisal,
  appraisalBelongsToCurrentOrganization,
  isAssignedManager
};
