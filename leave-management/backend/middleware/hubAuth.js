const jwt = require('jsonwebtoken');

function resolveCurrentOrganization(payload = {}) {
  return payload.currentOrganization || payload.current_organization || null;
}

// Middleware to validate hub tokens for IdP-initiated SSO
const validateHubToken = async (req, res, next) => {
  const hubToken = req.query.hub_token;

  if (!hubToken) {
    return res.status(401).json({
      error: 'Missing hub_token parameter',
      code: 'HUB_TOKEN_MISSING',
    });
  }

  try {
    // CRITICAL: Verify token signature, expiration, issuer, audience
    const decoded = jwt.verify(hubToken, process.env.HUB_TOKEN_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.IDP_ISSUER_URL,
      audience: process.env.LEAVE_MANAGEMENT_URL,
      maxAge: '5m', // Token valid for 5 minutes max
    });

    // CRITICAL: Verify purpose claim
    if (decoded.purpose !== 'hub_sso') {
      return res.status(401).json({
        error: 'Invalid token purpose',
        code: 'INVALID_TOKEN_PURPOSE',
      });
    }

    // Extract user info from token
    req.hubUser = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      organizations: decoded.organizations || [],
      currentOrganization: resolveCurrentOrganization(decoded),
    };

    // Store the hub token for potential userinfo lookup
    req.hubToken = hubToken;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid hub token signature',
        code: 'INVALID_HUB_TOKEN',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Hub token expired',
        code: 'HUB_TOKEN_EXPIRED',
      });
    }

    if (error.name === 'NotBeforeError') {
      return res.status(401).json({
        error: 'Hub token not yet valid',
        code: 'HUB_TOKEN_NOT_VALID_YET',
      });
    }

    console.error('Hub token validation error:', error);
    return res.status(401).json({
      error: 'Hub token validation failed',
      code: 'HUB_TOKEN_VALIDATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Alternative: Validate hub token without strict requirements (for development)
const validateHubTokenDev = async (req, res, next) => {
  const hubToken = req.query.hub_token;

  if (!hubToken) {
    return res.status(401).json({
      error: 'Missing hub_token parameter',
      code: 'HUB_TOKEN_MISSING',
    });
  }

  try {
    // In development, allow more lenient validation
    const decoded = jwt.verify(hubToken, process.env.HUB_TOKEN_SECRET, {
      algorithms: ['HS256'],
    });

    req.hubUser = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      organizations: decoded.organizations || [],
      currentOrganization: resolveCurrentOrganization(decoded),
    };

    req.hubToken = hubToken;

    next();
  } catch (error) {
    console.error('Hub token validation error (dev):', error);
    return res.status(401).json({
      error: 'Hub token validation failed',
      code: 'HUB_TOKEN_VALIDATION_FAILED',
      details: error.message,
    });
  }
};

// Generate hub token (for testing/internal use)
const generateHubToken = (user, options = {}) => {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    organizations: user.organizations,
    currentOrganization: user.currentOrganization,
    purpose: 'hub_sso',
    aud: process.env.LEAVE_MANAGEMENT_URL,
    iss: process.env.IDP_ISSUER_URL,
  };

  return jwt.sign(payload, process.env.HUB_TOKEN_SECRET, {
    expiresIn: options.expiresIn || '5m',
    algorithm: 'HS256',
  });
};

module.exports = {
  validateHubToken: process.env.NODE_ENV === 'development' ? validateHubTokenDev : validateHubToken,
  validateHubTokenStrict: validateHubToken,
  generateHubToken,
};
