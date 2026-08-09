const jwt = require('jsonwebtoken');
const sessionService = require('../services/sessionService');
const adaptiveRiskService = require('../services/adaptiveRiskService');
const logger = require('../utils/securityLogger');
const { attachUserActivityTracking } = require('../services/userActivityTrackingService');
const { updateAIRequestContext } = require('../services/aiRuntime/requestContext');

const authMiddleware = async (req, res, next) => {
  // Get token from header
  const token = req.header('Authorization');
  
  // Only log for debugging purposes, reduce verbosity
  // console.log(`${req.method} ${req.path} - Auth middleware called`);
  // console.log('Authorization header:', token ? `Bearer ${token.substring(7, 20)}...` : 'None');

  // Check if not token
  if (!token) {
    console.log('No Authorization header found');
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  if (!token.startsWith('Bearer ')) {
    console.log('Token does not start with Bearer');
    return res.status(401).json({ msg: 'Invalid token format. Expected Bearer token' });
  }

  try {
    // Extract token from Bearer scheme
    const jwtToken = token.split(' ')[1];
    
    if (!jwtToken) {
      console.log('No token found after Bearer');
      return res.status(401).json({ msg: 'No token provided after Bearer' });
    }
    
    // Verify token and validate session
    const { decoded, session, user } = await sessionService.validateAccessToken(jwtToken);

    // Performance may create a dormant identity row solely to key a shared
    // ChatGPT account. Such a row is never a Recruiter login grant, including
    // if a stale or forged local session happens to reference it.
    if (user?.sharedAIOnly === true) {
      return res.status(403).json({
        msg: 'Your organization has not granted this identity access to Recruiter.',
        code: 'RECRUITER_APP_ACCESS_REQUIRED'
      });
    }

    const riskResult = await adaptiveRiskService.evaluateRequest({
      req,
      user,
      session,
      decoded,
    });

    if (riskResult.requireStepUp) {
      logger.warn('adaptive_risk_trigger', {
        userId: decoded.user.id,
        sessionId: decoded.jti,
        reason: riskResult.reason,
      });

      await sessionService.revokeSessionById(decoded.jti, 'adaptive_risk');

      return res.status(401).json({
        msg: 'Session requires re-authentication',
        code: 'session_revoked',
        reason: riskResult.reason,
      });
    }

    req.user = decoded.user;
    req.session = session;
    const currentOrganization = user.currentOrganization || decoded.user.currentOrganization;
    const localActorId = decoded.user.id;
    const localOrganizationId = currentOrganization?._id || currentOrganization;
    updateAIRequestContext({
      // Metering uses stable IdP dimensions so the same person/workspace does
      // not split into different identities when switching Local vs ChatGPT.
      // Runtime account lookup still uses the Recruiter-local ids explicitly.
      actorId: user.idpSubject || localActorId,
      runtimeActorId: localActorId,
      actorName: user.profile?.displayName || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim(),
      actorEmail: user.email,
      organizationId: currentOrganization?.idpOrganizationId || localOrganizationId,
      localOrganizationId,
      organizationName: currentOrganization?.name,
      sessionId: decoded.jti
    });
    attachUserActivityTracking(req, res, { user, session });
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);

    let message = 'Token verification failed';
    let code = 'token_invalid';

    switch (err.message) {
      case 'session_not_found':
        message = 'Session not found';
        code = 'session_not_found';
        break;
      case 'session_revoked':
        message = 'Session revoked';
        code = 'session_revoked';
        break;
      case 'session_version_mismatch':
        message = 'Session superseded';
        code = 'session_version_mismatch';
        break;
      case 'invalid_refresh_token':
        message = 'Invalid session token';
        code = 'token_invalid';
        break;
      default:
        if (err.name === 'TokenExpiredError') {
          message = 'Token has expired';
          code = 'token_expired';
        } else if (err.name === 'JsonWebTokenError') {
          message = 'Invalid token';
          code = 'token_invalid';
        }
    }

    logger.warn('auth_failure', {
      userId: err.decoded?.user?.id,
      sessionId: err.decoded?.jti,
      code,
      message: err.message,
    });

    return res.status(401).json({ msg: message, code });
  }
};

module.exports = authMiddleware;
