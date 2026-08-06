const sessionService = require('../services/sessionService');

/**
 * Session middleware to handle session creation and validation
 */
const sessionMiddleware = async (req, res, next) => {
  try {
    // Skip session creation if requested (e.g., for OAuth callbacks)
    if (req.skipSessionCreation) {
      console.log('Skipping session creation for OAuth callback');
      req.session = {
        sessionId: null,
        userId: null,
        isActive: false,
        expiresAt: null,
        totalInteractions: 0
      };
      return next();
    }
    
    // Extract session information from request
    const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId || null;
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Get user ID from auth middleware if available
    const userId = req.user?.id || req.user?._id || null;

    // Get or create session
    const sessionData = await sessionService.getOrCreateSession(
      sessionId,
      ipAddress,
      userAgent,
      userId
    );

    // If user is authenticated but session isn't linked, link it
    if (userId && sessionData.sessionId && (!sessionData.userId || sessionData.userId !== userId)) {
      try {
        await sessionService.linkSessionToUser(sessionData.sessionId, userId);
        sessionData.userId = userId;
        console.log(`🔗 Auto-linked session ${sessionData.sessionId} to user ${userId}`);
      } catch (linkError) {
        console.error('❌ Error auto-linking session to user:', linkError);
      }
    }

    // Attach session data to request
    req.session = {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      isActive: sessionData.isActive,
      expiresAt: sessionData.expiresAt,
      totalInteractions: sessionData.totalInteractions || 0
    };

    // Set session cookie if it's a new session or session ID changed
    if (!sessionId || sessionId !== sessionData.sessionId) {
      res.cookie('sessionId', sessionData.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
    }

    // Add session ID to response headers for frontend
    res.setHeader('X-Session-ID', sessionData.sessionId);

    next();
  } catch (error) {
    console.error('❌ Session middleware error:', error);
    
    // Continue without session in case of error
    req.session = {
      sessionId: null,
      userId: null,
      isActive: false,
      expiresAt: null,
      totalInteractions: 0
    };
    
    next();
  }
};

/**
 * Optional session middleware for routes that don't require sessions
 */
const optionalSessionMiddleware = async (req, res, next) => {
  try {
    await sessionMiddleware(req, res, next);
  } catch (error) {
    // Silently continue without session
    next();
  }
};

/**
 * Middleware to require valid session
 */
const requireSessionMiddleware = async (req, res, next) => {
  await sessionMiddleware(req, res, () => {
    if (!req.session?.sessionId || !req.session?.isActive) {
      return res.status(401).json({
        error: 'Valid session required',
        msg: 'Please refresh your browser to establish a new session'
      });
    }
    next();
  });
};

/**
 * Middleware to link session to user after authentication
 */
const linkSessionToUser = async (req, res, next) => {
  try {
    if (req.session?.sessionId && req.user?.id && !req.session.userId) {
      await sessionService.linkSessionToUser(req.session.sessionId, req.user.id);
      req.session.userId = req.user.id;
    }
    next();
  } catch (error) {
    console.error('❌ Error linking session to user:', error);
    next(); // Continue anyway
  }
};

module.exports = {
  sessionMiddleware,
  optionalSessionMiddleware,
  requireSessionMiddleware,
  linkSessionToUser
}; 