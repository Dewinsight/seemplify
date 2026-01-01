const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
  try {
    // Check for session (set by OIDC callback)
    if (req.session && req.session.user) {
      req.user = req.session.user;
      return next();
    }

    // Check for Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        return next();
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }
    }

    // No valid auth found
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = { authMiddleware };