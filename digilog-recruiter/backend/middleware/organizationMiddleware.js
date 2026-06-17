// Organization-context middleware — PostgreSQL/Prisma (migrated from Mongoose).
// `req.user.currentOrganization` continues to hold the current org id (string),
// so downstream controllers keep working. Memberships come from the
// OrganizationMember table via db/orgAccess.
const prisma = require('../db/client');
const orgAccess = require('../db/orgAccess');

// Ensure user has a current organization
exports.requireOrganization = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    if (!user.currentOrganizationId) {
      // No current org set — promote the first active membership if any.
      const activeMemberships = await orgAccess.getActiveMemberships(user.id);
      if (activeMemberships.length > 0) {
        const orgId = activeMemberships[0].organizationId;
        await prisma.user.update({
          where: { id: user.id },
          data: { currentOrganizationId: orgId, hasCompletedOrganizationSetup: true },
        });
        req.user.currentOrganization = orgId;
        return next();
      }

      return res.status(400).json({
        msg: 'User must belong to an organization to access this feature',
        requiresOrganizationSetup: true,
        debug: { userId: user.id, hasOrganizations: false, organizationCount: 0 },
      });
    }

    req.user.currentOrganization = user.currentOrganizationId;
    next();
  } catch (error) {
    console.error('❌ Organization middleware error:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Check organization permission
exports.requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const ok = await orgAccess.hasOrgPermission(req.user.id, req.user.currentOrganization, permission);
      if (!ok) {
        return res.status(403).json({ msg: 'Insufficient permissions' });
      }
      next();
    } catch (error) {
      console.error('Permission middleware error:', error);
      res.status(500).json({ msg: 'Server error' });
    }
  };
};

// Ensure user is a member of the (target) organization
exports.requireOrganizationMembership = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    const targetOrgId = organizationId || req.user.currentOrganization;
    if (!(await orgAccess.isMember(req.user.id, targetOrgId))) {
      return res.status(403).json({ msg: 'Access denied to this organization' });
    }
    next();
  } catch (error) {
    console.error('Organization membership middleware error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Add organization filter to request (Prisma `where` shape)
exports.addOrganizationContext = (req, res, next) => {
  if (req.user.currentOrganization) {
    req.organizationFilter = { organizationId: req.user.currentOrganization };
  }
  next();
};

// Ensure data isolation by organization (response hook placeholder)
exports.enforceOrganizationIsolation = (req, res, next) => {
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    originalEnd.call(this, chunk, encoding);
  };
  next();
};

// Role-based permission table (kept here for back-compat re-export)
const ROLE_PERMISSIONS = orgAccess.ROLE_PERMISSIONS;
exports.hasPermission = orgAccess.hasPermission;

// Middleware factory for specific permissions
exports.requireSpecificPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.user.currentOrganization;
      if (!organizationId) {
        return res.status(400).json({ msg: 'No organization context' });
      }
      const userRole = await orgAccess.getOrgRole(req.user.id, organizationId);
      if (!userRole || !orgAccess.hasPermission(userRole, requiredPermission)) {
        return res.status(403).json({
          msg: `Insufficient permissions. Required: ${requiredPermission}`,
          userRole,
          organizationId,
        });
      }
      next();
    } catch (error) {
      console.error('Specific permission middleware error:', error);
      res.status(500).json({ msg: 'Server error' });
    }
  };
};

// Set organization in request body for create operations
exports.setOrganizationInBody = (req, res, next) => {
  if (req.user.currentOrganization && req.method === 'POST') {
    req.body.organization = req.user.currentOrganization;
    req.body.organizationId = req.user.currentOrganization;
  }
  next();
};

// Validate organization ownership for sensitive operations
exports.requireOrganizationOwnership = async (req, res, next) => {
  try {
    const userRole = await orgAccess.getOrgRole(req.user.id, req.user.currentOrganization);
    if (userRole !== 'owner') {
      return res.status(403).json({ msg: 'Organization owner access required' });
    }
    next();
  } catch (error) {
    console.error('Organization ownership middleware error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};
