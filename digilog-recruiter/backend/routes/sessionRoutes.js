const express = require('express');
const router = express.Router();
const sessionService = require('../services/sessionService');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Get current session info
router.get('/current', async (req, res) => {
  try {
    if (!req.session?.sessionId) {
      return res.status(400).json({
        error: 'No active session',
        msg: 'Please refresh your browser to establish a session'
      });
    }

    res.json({
      sessionId: req.session.sessionId,
      userId: req.session.userId,
      isActive: req.session.isActive,
      expiresAt: req.session.expiresAt,
      totalInteractions: req.session.totalInteractions
    });
  } catch (error) {
    console.error('❌ Error getting current session:', error);
    res.status(500).json({
      error: 'Failed to get session info',
      msg: error.message
    });
  }
});

// Get user sessions (requires authentication)
router.get('/user-sessions', async (req, res) => {
  try {
    const userId = req.session?.userId;
    
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
        msg: 'Please log in to view your sessions'
      });
    }

    const sessions = await sessionService.getUserSessions(userId);
    
    res.json({
      sessions: sessions.map(session => ({
        sessionId: session.sessionId,
        ipAddress: session.ipAddress,
        metadata: session.metadata,
        lastActivity: session.lastActivity,
        createdAt: session.createdAt,
        totalInteractions: session.totalInteractions,
        isActive: session.isActive
      })),
      totalSessions: sessions.length
    });
  } catch (error) {
    console.error('❌ Error getting user sessions:', error);
    res.status(500).json({
      error: 'Failed to get user sessions',
      msg: error.message
    });
  }
});

// Deactivate specific session
router.post('/deactivate/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentUserId = req.session?.userId;
    
    if (!currentUserId) {
      return res.status(401).json({
        error: 'Authentication required',
        msg: 'Please log in to manage sessions'
      });
    }

    // Verify the session belongs to the current user
    const targetSession = await sessionService.getSessionById(sessionId);
    if (!targetSession || targetSession.user.toString() !== currentUserId) {
      return res.status(403).json({
        error: 'Unauthorized',
        msg: 'You can only deactivate your own sessions'
      });
    }

    await sessionService.deactivateSession(sessionId);
    
    res.json({
      msg: 'Session deactivated successfully',
      sessionId
    });
  } catch (error) {
    console.error('❌ Error deactivating session:', error);
    res.status(500).json({
      error: 'Failed to deactivate session',
      msg: error.message
    });
  }
});

// Deactivate all user sessions except current
router.post('/deactivate-all', async (req, res) => {
  try {
    const userId = req.user?.id;
    const currentSessionId = req.session?.accessTokenId;
    
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
        msg: 'Please log in to manage sessions'
      });
    }

    const sessions = await sessionService.getUserSessions(userId);
    let deactivatedCount = 0;
    
    for (const session of sessions) {
      if (session.sessionId !== currentSessionId) {
        await sessionService.deactivateSession(session.sessionId);
        deactivatedCount++;
      }
    }
    
    res.json({
      msg: `Deactivated ${deactivatedCount} sessions`,
      deactivatedCount,
      currentSessionId
    });
  } catch (error) {
    console.error('❌ Error deactivating all sessions:', error);
    res.status(500).json({
      error: 'Failed to deactivate sessions',
      msg: error.message
    });
  }
});

// Get session statistics (admin only - you might want to add admin middleware)
router.get('/stats', async (req, res) => {
  try {
    const stats = await sessionService.getSessionStats();
    
    res.json({
      statistics: stats,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('❌ Error getting session stats:', error);
    res.status(500).json({
      error: 'Failed to get session statistics',
      msg: error.message
    });
  }
});

// Manual cleanup of expired sessions (admin endpoint)
router.post('/cleanup', async (req, res) => {
  try {
    const cleanedCount = await sessionService.cleanupExpiredSessions();
    
    res.json({
      msg: `Cleaned up ${cleanedCount} expired sessions`,
      cleanedCount,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('❌ Error cleaning up sessions:', error);
    res.status(500).json({
      error: 'Failed to cleanup sessions',
      msg: error.message
    });
  }
});

module.exports = router; 