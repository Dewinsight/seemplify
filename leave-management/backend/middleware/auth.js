const { getUserInfo } = require('../config/oidc');

// Middleware to require authentication
const requireAuth = async (req, res, next) => {
  try {
    // Check for session-based authentication
    if (req.session && req.session.user) {
      req.user = req.session.user;
      return next();
    }

    // Check for Bearer token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);

      try {
        // Verify token with Identity Provider
        const userinfo = await getUserInfo(accessToken);

        req.user = {
          id: userinfo.sub,
          email: userinfo.email,
          name: userinfo.name,
          organizations: userinfo.organizations || [],
          teams: userinfo.teams || [],
          currentOrganization: userinfo.currentOrganization,
          accessToken,
          userinfo,
        };

        return next();
      } catch (tokenError) {
        console.error('Token verification failed:', tokenError.message);
        return res.status(401).json({
          error: 'Invalid or expired access token',
          code: 'INVALID_TOKEN',
        });
      }
    }

    // No authentication found
    return res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

// Middleware to optionally get user if authenticated
const optionalAuth = async (req, res, next) => {
  try {
    if (req.session && req.session.user) {
      req.user = req.session.user;
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);

      try {
        const userinfo = await getUserInfo(accessToken);
        req.user = {
          id: userinfo.sub,
          email: userinfo.email,
          name: userinfo.name,
          organizations: userinfo.organizations || [],
          teams: userinfo.teams || [],
          currentOrganization: userinfo.currentOrganization,
          accessToken,
          userinfo,
        };
      } catch (tokenError) {
        // Token invalid but don't fail - just continue without user
        console.warn('Optional auth token invalid:', tokenError.message);
      }
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next();
  }
};

// Middleware to refresh session from userinfo
const refreshUserInfo = async (req, res, next) => {
  try {
    if (!req.user || !req.user.accessToken) {
      return next();
    }

    const userinfo = await getUserInfo(req.user.accessToken);

    // Update session with fresh userinfo
    req.user = {
      ...req.user,
      organizations: userinfo.organizations || [],
      teams: userinfo.teams || [],
      currentOrganization: userinfo.currentOrganization,
      userinfo,
    };

    // Update session if exists
    if (req.session) {
      req.session.user = req.user;
    }

    next();
  } catch (error) {
    console.error('Refresh userinfo error:', error);
    // Don't fail - use existing user info
    next();
  }
};

module.exports = {
  requireAuth,
  optionalAuth,
  refreshUserInfo,
};
