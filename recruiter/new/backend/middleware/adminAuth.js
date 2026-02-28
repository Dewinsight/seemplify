const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

// Middleware to verify admin JWT token
const adminAuth = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('x-admin-auth-token') || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ msg: 'No admin token, authorization denied' });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
      
      // Check if it's an admin token (has isAdmin flag)
      if (!decoded.isAdmin) {
        return res.status(401).json({ msg: 'Not an admin token' });
      }
      
      // Get admin from database
      const admin = await Admin.findById(decoded.admin.id).select('-password');
      
      if (!admin) {
        return res.status(401).json({ msg: 'Admin not found' });
      }
      
      if (!admin.isActive) {
        return res.status(401).json({ msg: 'Admin account is deactivated' });
      }
      
      if (admin.isLocked) {
        return res.status(401).json({ msg: 'Admin account is locked' });
      }
      
      // Add admin to request object
      req.admin = admin;
      next();
    } catch (err) {
      console.error('Admin token verification failed:', err);
      res.status(401).json({ msg: 'Admin token is not valid' });
    }
  } catch (err) {
    console.error('Admin auth middleware error:', err);
    res.status(500).json({ msg: 'Server error in admin authentication' });
  }
};

// Middleware to check specific admin permissions
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ msg: 'Admin authentication required' });
    }
    
    // Super admins have all permissions
    if (req.admin.role === 'super_admin') {
      return next();
    }
    
    // Check specific permission
    if (!req.admin.permissions || !req.admin.permissions[permission]) {
      return res.status(403).json({ 
        msg: `Permission denied: ${permission} required`,
        requiredPermission: permission 
      });
    }
    
    next();
  };
};

// Middleware to require super admin role
const requireSuperAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ msg: 'Admin authentication required' });
  }
  
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ msg: 'Super admin access required' });
  }
  
  next();
};

module.exports = {
  adminAuth,
  requirePermission,
  requireSuperAdmin
};
