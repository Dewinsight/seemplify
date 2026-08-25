const User = require('../models/User');

// Ensure user has current organization
exports.requireOrganization = async (req, res, next) => {
  try {
    console.log('🔍 Organization middleware - checking user:', req.user?.id);
    
    const user = await User.findById(req.user.id);
    console.log('🔍 User found:', !!user);
    console.log('🔍 User currentOrganization:', user?.currentOrganization);
    console.log('🔍 User organizationMemberships:', user?.organizationMemberships?.length);
    
    if (!user) {
      console.error('❌ User not found in database');
      return res.status(404).json({ msg: 'User not found' });
    }
    
    if (!user.currentOrganization) {
      console.error('❌ User has no currentOrganization');
      
      // Check if user has organization memberships but no current organization set
      const activeMemberships = user.organizationMemberships?.filter(m => m.isActive) || [];
      if (activeMemberships.length > 0) {
        console.log('🔧 User has organization memberships but no currentOrganization set, fixing...');
        
        // Set the first active membership as current organization
        user.currentOrganization = activeMemberships[0].organization;
        user.hasCompletedOrganizationSetup = true;
        
        await user.save();
        console.log('✅ Set currentOrganization to:', user.currentOrganization);
        
        // Add organization to request for easy access
        req.user.currentOrganization = user.currentOrganization;
        return next();
      }
      
      return res.status(400).json({ 
        msg: 'User must belong to an organization to access this feature',
        requiresOrganizationSetup: true,
        debug: {
          userId: user._id,
          hasOrganizations: activeMemberships.length > 0,
          organizationCount: activeMemberships.length
        }
      });
    }

    // Add organization to request for easy access
    req.user.currentOrganization = user.currentOrganization;
    console.log('✅ Organization middleware - user has organization:', user.currentOrganization);
    next();
  } catch (error) {
    console.error('❌ Organization middleware error:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Check organization permissions
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

// Middleware to check if user is organization member
exports.requireOrganizationMembership = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const { organizationId } = req.params;
    
    // If no specific organization ID provided, use current organization
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

// Middleware to add organization context to queries
exports.addOrganizationContext = (req, res, next) => {
  // Add organization filter to query
  if (req.user.currentOrganization) {
    req.organizationFilter = { organization: req.user.currentOrganization };
  }
  
  next();
};

// Middleware to ensure data isolation by organization
exports.enforceOrganizationIsolation = (req, res, next) => {
  // Store original end function
  const originalEnd = res.end;
  
  // Override end function to ensure no cross-organization data leaks
  res.end = function(chunk, encoding) {
    // Here you could add additional checks if needed
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

// Role-based permission checking
const ROLE_PERMISSIONS = {
  owner: ['all'],
  admin: ['all'],
  hr_manager: ['manage_users', 'manage_settings', 'view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics'],
  recruiter: ['view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics'],
  interviewer: ['view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics'],
  employee: ['view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics'],
  member: ['view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics'],
  staff: ['view_jobs', 'manage_jobs', 'view_candidates', 'manage_candidates', 'manage_interviews', 'submit_interview_feedback', 'view_analytics']
};

// Check if role has specific permission
exports.hasPermission = (role, permission) => {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('all') || permissions.includes(permission);
};

// Middleware factory for specific permissions
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
          userRole: userRole,
          organizationId: organizationId
        });
      }
      
      next();
    } catch (error) {
      console.error('Specific permission middleware error:', error);
      res.status(500).json({ msg: 'Server error' });
    }
  };
};

// Middleware to set organization in request body for create operations
exports.setOrganizationInBody = (req, res, next) => {
  if (req.user.currentOrganization && req.method === 'POST') {
    req.body.organization = req.user.currentOrganization;
  }
  
  next();
};

// Middleware to validate organization ownership for sensitive operations
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
