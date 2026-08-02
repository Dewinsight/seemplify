const express = require('express');
const router = express.Router();
const chatSessionService = require('../services/chatSessionService');
const memoryService = require('../services/memoryService');
const chatMessageService = require('../services/chatMessageService');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

/**
 * Get all chat sessions for current user
 */
router.get('/', authMiddleware, requireOrganization, async (req, res) => {
  try {
    // Use only authenticated user ID from JWT
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    const limit = parseInt(req.query.limit) || 50;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User must belong to an organization to access chat sessions',
        msg: 'Organization context required'
      });
    }

    console.log(`🔍 Getting chat sessions for user: ${userId}, organization: ${organizationId}`);

    const sessions = await chatSessionService.getUserChatSessions(userId, limit, organizationId);
    
    res.json({
      sessions,
      totalCount: sessions.length,
      userId,
      organizationId
    });
  } catch (error) {
    console.error('❌ Error getting chat sessions:', error);
    res.status(500).json({
      error: 'Failed to get chat sessions',
      msg: error.message
    });
  }
});

/**
 * Create a new chat session
 */
router.post('/create', authMiddleware, requireOrganization, async (req, res) => {
  try {
    // Use only authenticated user ID from JWT
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    const { title } = req.body;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User must belong to an organization to create chat sessions',
        msg: 'Organization context required'
      });
    }

    console.log(`🆕 Creating chat session for user: ${userId}, organization: ${organizationId}`);

    const session = await chatSessionService.createChatSession(userId, title, organizationId);
    
    res.json({
      session,
      msg: 'Chat session created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating chat session:', error);
    res.status(500).json({
      error: 'Failed to create chat session',
      msg: error.message
    });
  }
});

/**
 * Get a specific chat session
 */
router.get('/:sessionId', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Use only authenticated user ID from JWT
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User must belong to an organization to access chat sessions',
        msg: 'Organization context required'
      });
    }

    const session = await chatSessionService.getChatSession(sessionId, organizationId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Chat session not found or access denied'
      });
    }

    // Verify ownership - simple check
    if (session.userId !== userId) {
      return res.status(403).json({
        error: 'Access denied to this chat session'
      });
    }

    res.json({
      session
    });
  } catch (error) {
    console.error('❌ Error getting chat session:', error);
    res.status(500).json({
      error: 'Failed to get chat session',
      msg: error.message
    });
  }
});

/**
 * Update chat session title
 */
router.put('/:sessionId/title', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    // Use only authenticated user ID from JWT
    const userId = req.user.id;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        error: 'Title is required'
      });
    }

    const session = await chatSessionService.updateChatSessionTitle(sessionId, userId, title.trim());
    
    if (!session) {
      return res.status(404).json({
        error: 'Chat session not found'
      });
    }

    res.json({
      session,
      msg: 'Chat session title updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating chat session title:', error);
    res.status(500).json({
      error: 'Failed to update chat session title',
      msg: error.message
    });
  }
});

/**
 * Toggle pin status of chat session
 */
router.put('/:sessionId/pin', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Use only authenticated user ID from JWT
    const userId = req.user.id;

    const session = await chatSessionService.toggleChatSessionPin(sessionId, userId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Chat session not found'
      });
    }

    res.json({
      session,
      msg: `Chat session ${session.isPinned ? 'pinned' : 'unpinned'} successfully`
    });
  } catch (error) {
    console.error('❌ Error toggling chat session pin:', error);
    res.status(500).json({
      error: 'Failed to toggle chat session pin',
      msg: error.message
    });
  }
});

/**
 * Get chat history for a specific session
 */
router.get('/:sessionId/history', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Use only authenticated user ID from JWT
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    const limit = parseInt(req.query.limit) || 50;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User must belong to an organization to access chat history',
        msg: 'Organization context required'
      });
    }

    // First verify the session exists and user has access
    const session = await chatSessionService.getChatSession(sessionId, organizationId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Chat session not found or access denied'
      });
    }

    // Verify ownership - simple check
    if (session.userId !== userId) {
      console.log('❌ Access denied - Session userId:', session.userId, 'Request userId:', userId);
      return res.status(403).json({
        error: 'Access denied to this chat session'
      });
    }

    // Get actual chat messages from database
    const messages = await chatMessageService.getChatSessionHistory(sessionId, limit);
    
    // Format messages for frontend compatibility
    const history = [];
    
    // Group messages into conversation pairs
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      if (message.role === 'user') {
        // Look for the corresponding assistant response
        const assistantMsg = messages[i + 1];
        
        if (assistantMsg && assistantMsg.role === 'assistant') {
          // Create conversation pair
          history.push({
            id: message.messageId,
            timestamp: message.timestamp,
            messages: [
              {
                id: message.messageId,
                role: 'user',
                content: message.content,
                timestamp: message.timestamp
              },
              {
                id: assistantMsg.messageId,
                role: 'assistant',
                content: assistantMsg.content,
                timestamp: assistantMsg.timestamp,
                metadata: assistantMsg.metadata
              }
            ],
            metadata: {
              sessionId,
              userId,
              intent: message.metadata?.intent,
              confidence: assistantMsg.metadata?.confidence,
              processingTime: assistantMsg.metadata?.processingTime,
              actions: assistantMsg.metadata?.actions || [],
              toolsUsed: assistantMsg.metadata?.toolsUsed || []
            }
          });
          i++; // Skip the assistant message since we've processed it
        } else {
          // Single user message without response
          history.push({
            id: message.messageId,
            timestamp: message.timestamp,
            messages: [{
              id: message.messageId,
              role: 'user',
              content: message.content,
              timestamp: message.timestamp
            }],
            metadata: {
              sessionId,
              userId,
              intent: message.metadata?.intent
            }
          });
        }
      } else if (message.role === 'assistant' && (i === 0 || messages[i-1].role !== 'user')) {
        // Standalone assistant message
        history.push({
          id: message.messageId,
          timestamp: message.timestamp,
          messages: [{
            id: message.messageId,
            role: 'assistant',
            content: message.content,
            timestamp: message.timestamp,
            metadata: message.metadata
          }],
          metadata: {
            sessionId,
            userId,
            confidence: message.metadata?.confidence,
            actions: message.metadata?.actions || [],
            toolsUsed: message.metadata?.toolsUsed || []
          }
        });
      }
    }

    res.json({
      history,
      sessionId,
      totalCount: history.length,
      totalMessages: messages.length,
      session: {
        title: session.title,
        messageCount: session.messageCount,
        lastActivity: session.lastActivity,
        isPinned: session.isPinned || false
      }
    });
  } catch (error) {
    console.error('❌ Error getting chat session history:', error);
    res.status(500).json({
      error: 'Failed to get chat session history',
      msg: error.message
    });
  }
});

/**
 * Delete a chat session
 */
router.delete('/:sessionId', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Use only authenticated user ID from JWT
    const userId = req.user.id;

    const session = await chatSessionService.deleteChatSession(sessionId, userId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Chat session not found'
      });
    }

    // Also delete all messages for this chat session
    await chatMessageService.deleteChatSessionMessages(sessionId);

    res.json({
      msg: 'Chat session deleted successfully',
      sessionId
    });
  } catch (error) {
    console.error('❌ Error deleting chat session:', error);
    res.status(500).json({
      error: 'Failed to delete chat session',
      msg: error.message
    });
  }
});

/**
 * Get chat session statistics
 */
router.get('/stats/overview', authMiddleware, requireOrganization, async (req, res) => {
  try {
    // Use only authenticated user ID from JWT
    const userId = req.user.id;

    const stats = await chatSessionService.getChatSessionStats(userId);
    
    res.json({
      stats,
      userId
    });
  } catch (error) {
    console.error('❌ Error getting chat session stats:', error);
    res.status(500).json({
      error: 'Failed to get chat session statistics',
      msg: error.message
    });
  }
});

module.exports = router; 