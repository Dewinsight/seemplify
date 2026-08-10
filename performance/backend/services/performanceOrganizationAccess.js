'use strict';

const PERFORMANCE_APP_ID = 'performance-management';

function toOrganizationId(value) {
  const raw = value?.id || value?._id || value?.organizationId || value;
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).trim();
  return normalized || null;
}

function normalizeAppAccess(appAccess) {
  const source = appAccess && typeof appAccess === 'object' ? appAccess : {};
  const mode = String(source.mode || 'all').trim().toLowerCase() === 'selected'
    ? 'selected'
    : 'all';
  const appIds = Array.isArray(source.appIds)
    ? Array.from(new Set(source.appIds.map((appId) => String(appId || '').trim()).filter(Boolean)))
    : [];

  return { mode, appIds: mode === 'selected' ? appIds : [] };
}

function organizationAllowsPerformance(organization) {
  if (!organization || typeof organization !== 'object') return false;
  // App access is an authorization claim, not a display preference. An old
  // session that predates this signed claim must refresh rather than regain
  // access through the historical implicit-all behavior.
  if (!Object.prototype.hasOwnProperty.call(organization, 'appAccess')
      || !organization.appAccess
      || typeof organization.appAccess !== 'object') {
    return false;
  }
  const access = normalizeAppAccess(organization.appAccess);
  return access.mode === 'all' || access.appIds.includes(PERFORMANCE_APP_ID);
}

function filterPerformanceOrganizations(organizations = []) {
  if (!Array.isArray(organizations)) return [];
  return organizations.filter((organization) => (
    Boolean(toOrganizationId(organization)) && organizationAllowsPerformance(organization)
  ));
}

function selectPerformanceOrganization(organizations = [], ...preferredValues) {
  const allowed = filterPerformanceOrganizations(organizations);
  for (const preferred of preferredValues) {
    const preferredId = toOrganizationId(preferred);
    if (!preferredId) continue;
    const match = allowed.find((organization) => toOrganizationId(organization) === preferredId);
    if (match) return match;
  }
  return allowed[0] || null;
}

function sanitizePerformancePrincipal(principal = {}, preferredOrganizationId = null) {
  const userinfo = principal.userinfo && typeof principal.userinfo === 'object'
    ? principal.userinfo
    : {};
  const claimedOrganizations = Array.isArray(principal.organizations)
    ? principal.organizations
    : (Array.isArray(userinfo.organizations) ? userinfo.organizations : []);
  const claimedCurrent = principal.currentOrganization
    || userinfo.currentOrganization
    || userinfo.current_organization
    || null;
  const organizationSource = claimedOrganizations.length > 0
    ? claimedOrganizations
    : (claimedCurrent ? [claimedCurrent] : []);
  const organizations = filterPerformanceOrganizations(organizationSource);
  const currentOrganization = selectPerformanceOrganization(
    organizations,
    preferredOrganizationId,
    claimedCurrent
  );
  const allowedOrganizationIds = new Set(organizations.map(toOrganizationId).filter(Boolean));
  const claimedTeams = Array.isArray(principal.teams)
    ? principal.teams
    : (Array.isArray(principal.idpTeams)
      ? principal.idpTeams
      : (Array.isArray(userinfo.teams) ? userinfo.teams : []));
  const teams = claimedTeams.filter((team) => {
    const organizationId = toOrganizationId(team?.organizationId || team?.organization);
    return !organizationId || allowedOrganizationIds.has(organizationId);
  });
  const claimedTeamPermissions = Array.isArray(principal.idpTeamPermissions)
    ? principal.idpTeamPermissions
    : (Array.isArray(principal.team_permissions)
      ? principal.team_permissions
      : (Array.isArray(userinfo.team_permissions) ? userinfo.team_permissions : []));
  const teamPermissions = claimedTeamPermissions.filter((permission) => {
    const organizationId = toOrganizationId(
      permission?.organization_id || permission?.organizationId || permission?.organization
    );
    return !organizationId || allowedOrganizationIds.has(organizationId);
  });
  const sanitizedUserinfo = {
    ...userinfo,
    organizations,
    teams,
    team_permissions: teamPermissions,
    currentOrganization,
    current_organization: currentOrganization
  };

  return {
    ...principal,
    organizations,
    teams,
    idpTeams: teams,
    idpTeamPermissions: teamPermissions,
    team_permissions: teamPermissions,
    currentOrganization,
    designation: currentOrganization?.designation || null,
    employeeId: currentOrganization?.employeeId || null,
    userinfo: sanitizedUserinfo
  };
}

module.exports = {
  PERFORMANCE_APP_ID,
  toOrganizationId,
  normalizeAppAccess,
  organizationAllowsPerformance,
  filterPerformanceOrganizations,
  selectPerformanceOrganization,
  sanitizePerformancePrincipal
};
