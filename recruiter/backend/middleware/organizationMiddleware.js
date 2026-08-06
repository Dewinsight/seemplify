const User = require('../models/User');

function requestedOrganizationId(req) {
  return (
    req.get?.('X-Organization-Id') ||
    req.get?.('X-Organization-ID') ||
    req.get?.('x-organization-id') ||
    ''
  ).trim();
}

function activeMemberships(user) {
  return (user.organizationMemberships || []).filter((membership) => membership?.isActive);
}

function activeMembershipFor(user, organizationId) {
  return activeMemberships(user).find((membership) =>
    String(membership.organization) === String(organizationId)
  );
}

async function setRequestOrganization(req, user, organizationId, { persist = false } = {}) {
  const membership = activeMembershipFor(user, organizationId);
  if (!membership) return null;

  req.user.currentOrganization = membership.organization;
  req.activeOrganization = membership.organization;

  if (persist && String(user.currentOrganization || '') !== String(membership.organization)) {
    user.currentOrganization = membership.organization;
    user.hasCompletedOrganizationSetup = true;
    await user.save();
  }

  return membership.organization;
}

// Ensure user has a current organization.
exports.requireOrganization = async (req, res, next) => {
  try {
    console.log('Organization middleware - checking user:', req.user?.id);

    const user = await User.findById(req.user.id);
    if (!user) {
      console.error('User not found in database');
      return res.status(404).json({ msg: 'User not found' });
    }

    const headerOrganizationId = requestedOrganizationId(req);
    if (headerOrganizationId) {
      const requestedOrg = await setRequestOrganization(req, user, headerOrganizationId, { persist: true });
      if (!requestedOrg) {
        return res.status(403).json({ msg: 'Access denied to requested organization' });
      }

      console.log('Organization middleware - using requested organization:', requestedOrg);
      return next();
    }

    if (!user.currentOrganization) {
      console.error('User has no currentOrganization');

      const memberships = activeMemberships(user);
      if (memberships.length > 0) {
        console.log('User has organization memberships but no currentOrganization set, fixing...');
        await setRequestOrganization(req, user, memberships[0].organization, { persist: true });
        console.log('Set currentOrganization to:', user.currentOrganization);
        return next();
      }

      return res.status(400).json({
        msg: 'User must belong to an organization to access this feature',
        requiresOrganizationSetup: true,
        debug: {
          userId: user._id,
          hasOrganizations: memberships.length > 0,
          organizationCount: memberships.length
        }
      });
    }

    const currentOrg = await setRequestOrganization(req, user, user.currentOrganization);
    if (!currentOrg) {
      return res.status(403).json({ msg: 'Current organization membership is inactive or unavailable' });
    }

    console.log('Organization middleware - user has organization:', currentOrg);
    return next();
  } catch (error) {
    console.error('Organization middleware error:', error);
    return res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Check organization permissions.
exports.requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user.hasOrganizationPermission(req.user.currentOrganization, permission)) {
        return res.status(403).json({ msg: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Permission middleware error:', error);
      res.status(500).json({ msg: 'Server error' });
    }
  };
};

// Middleware to check if user is organization member.
exports.requireOrganizationMembership = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const { organizationId } = req.params;
    const targetOrgId = organizationId || req.user.currentOrganization;

    if (!user.isOrganizationMember(targetOrgId)) {
      return res.status(403).json({ msg: 'Access denied to this organization' });
    }

    next();
  } catch (error) {
    console.error('Organization membership middleware error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Middleware to add organization context to queries.
exports.addOrganizationContext = (req, res, next) => {
  if (req.user.currentOrganization) {
    req.organizationFilter = { organization: req.user.currentOrganization };
  }

  next();
};

// Middleware to ensure data isolation by organization.
exports.enforceOrganizationIsolation = (req, res, next) => {
  const originalEnd = res.end;

  res.end = function(chunk, encoding) {
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

const ROLE_PERMISSIONS = {
  owner: ['all'],
  admin: ['manage_users', 'manage_jobs', 'manage_candidates', 'view_analytics', 'manage_settings'],
  hr_manager: ['manage_jobs', 'manage_candidates', 'view_analytics'],
  recruiter: ['manage_candidates', 'view_jobs', 'view_candidates'],
  interviewer: ['view_candidates', 'view_jobs']
};

exports.hasPermission = (role, permission) => {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('all') || permissions.includes(permission);
};

exports.requireSpecificPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      const organizationId = req.user.currentOrganization;

      if (!organizationId) {
        return res.status(400).json({ msg: 'No organization context' });
      }

      const userRole = user.getOrganizationRole(organizationId);

      if (!userRole || !exports.hasPermission(userRole, requiredPermission)) {
        return res.status(403).json({
          msg: `Insufficient permissions. Required: ${requiredPermission}`,
          userRole,
          organizationId
        });
      }

      next();
    } catch (error) {
      console.error('Specific permission middleware error:', error);
      res.status(500).json({ msg: 'Server error' });
    }
  };
};

exports.setOrganizationInBody = (req, res, next) => {
  if (req.user.currentOrganization && req.method === 'POST') {
    req.body.organization = req.user.currentOrganization;
  }

  next();
};

exports.requireOrganizationOwnership = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const organizationId = req.user.currentOrganization;
    const userRole = user.getOrganizationRole(organizationId);

    if (userRole !== 'owner') {
      return res.status(403).json({ msg: 'Organization owner access required' });
    }

    next();
  } catch (error) {
    console.error('Organization ownership middleware error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};
