const jwt = require('jsonwebtoken');
const prisma = require('../db/client');

const INVALID_TOKEN_VALUES = new Set(['null', 'undefined', '[object Object]']);

function normalizeToken(value) {
  if (!value || typeof value !== 'string') return null;

  const token = value.replace(/^Bearer\s+/i, '').trim();
  if (!token || INVALID_TOKEN_VALUES.has(token)) return null;

  return token;
}

function getAdminToken(req) {
  const adminHeader = req.header('x-admin-auth-token');
  if (adminHeader !== undefined) return normalizeToken(adminHeader);

  const authHeader = req.header('Authorization');
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) return null;

  return normalizeToken(authHeader);
}

function isJwtLike(token) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

// Middleware to verify admin JWT token
const adminAuth = async (req, res, next) => {
  try {
    // Get token from header
    const token = getAdminToken(req);
    
    if (!token) {
      return res.status(401).json({ code: 'token_missing', msg: 'No admin token, authorization denied' });
    }

    if (!isJwtLike(token)) {
      return res.status(401).json({ code: 'token_invalid', msg: 'Admin token is not valid' });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
      
      // Check if it's an admin token (has isAdmin flag)
      if (!decoded.isAdmin) {
        return res.status(401).json({ code: 'token_invalid', msg: 'Not an admin token' });
      }

      if (!decoded.admin?.id) {
        return res.status(401).json({ code: 'token_invalid', msg: 'Admin token is not valid' });
      }
      
      // Get admin from database
      const admin = await prisma.admin.findUnique({ where: { id: decoded.admin.id } });

      if (!admin) {
        return res.status(401).json({ msg: 'Admin not found' });
      }
      if (admin.password !== undefined) delete admin.password;

      if (!admin.isActive) {
        return res.status(401).json({ msg: 'Admin account is deactivated' });
      }

      // `isLocked` was a Mongoose virtual: lockUntil set and in the future.
      const isLocked = !!(admin.lockUntil && admin.lockUntil > Date.now());
      if (isLocked) {
        return res.status(401).json({ msg: 'Admin account is locked' });
      }
      
      // Add admin to request object
      req.admin = admin;
      next();
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      console.warn('Admin token verification failed:', err.message);
      res.status(401).json({
        code: expired ? 'token_expired' : 'token_invalid',
        msg: expired ? 'Admin token has expired' : 'Admin token is not valid'
      });
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
