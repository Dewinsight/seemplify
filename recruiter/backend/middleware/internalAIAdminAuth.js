const { createInternalServiceAuth } = require('./internalServiceAuth');

const ADMIN_ANALYTICS_SERVICE = 'identity-provider-admin';

function createInternalAIAdminAuth({ env = process.env, now, nonceStore, claimNonce } = {}) {
  const secret = String(env.AI_GATEWAY_ADMIN_ANALYTICS_SECRET || '').trim();
  const signedAuth = createInternalServiceAuth({
    env: {
      AI_GATEWAY_ALLOWED_SERVICES: ADMIN_ANALYTICS_SERVICE,
      AI_GATEWAY_HMAC_SECRET: secret
    },
    now,
    nonceStore,
    claimNonce
  });

  return (req, res, next) => {
    if (String(req.get('x-seemplify-service') || '') !== ADMIN_ANALYTICS_SERVICE) {
      return res.status(403).json({
        code: 'AI_GATEWAY_ADMIN_SERVICE_FORBIDDEN',
        message: 'This endpoint is reserved for Identity Provider administrators'
      });
    }
    if (secret.length < 32) {
      return res.status(503).json({
        code: 'AI_GATEWAY_ADMIN_NOT_CONFIGURED',
        message: 'Shared AI administration is not configured'
      });
    }
    return signedAuth(req, res, next);
  };
}

module.exports = { ADMIN_ANALYTICS_SERVICE, createInternalAIAdminAuth };
