function resolveOrganizationId(req) {
  const value = req.currentOrganization?.id ||
    req.currentOrganization?._id ||
    req.session?.currentOrganizationId ||
    req.session?.user?.currentOrganization?.id ||
    req.session?.user?.userinfo?.current_organization?.id ||
    req.session?.user?.userinfo?.currentOrganization?.id;
  return value ? String(value) : null;
}

function getActorId(req) {
  const value = req.session?.user?.id || req.session?.user?.sub;
  return value ? String(value) : null;
}

function requireOrganization(req, res, next) {
  const organizationId = resolveOrganizationId(req);
  if (!organizationId) {
    return res.status(403).json({
      success: false,
      error: 'Select an organization before accessing performance data',
      code: 'ORGANIZATION_REQUIRED'
    });
  }
  req.organizationId = organizationId;
  next();
}

function tenantFilter(req, additional = {}) {
  const organizationId = req.organizationId || resolveOrganizationId(req);
  if (!organizationId) {
    const error = new Error('Organization context is required');
    error.statusCode = 403;
    throw error;
  }
  return { organizationId, ...additional };
}

function canAccessEmployee(req, employeeId) {
  const targetId = String(employeeId || '');
  const actorId = getActorId(req);
  if (!targetId || !actorId) return false;
  if (targetId === actorId) return true;
  if (req.userRole === 'hr_admin') return true;
  return (req.directReports || []).map(String).includes(targetId);
}

function assertResourceTenant(req, resource) {
  const organizationId = req.organizationId || resolveOrganizationId(req);
  if (!organizationId || !resource || String(resource.organizationId) !== organizationId) {
    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }
  return resource;
}

module.exports = {
  resolveOrganizationId,
  getActorId,
  requireOrganization,
  tenantFilter,
  canAccessEmployee,
  assertResourceTenant
};
