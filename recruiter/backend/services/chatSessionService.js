const ChatSession = require('../models/ChatSession');
const memoryService = require('./memoryService');
const AzureOpenAIService = require('./azureOpenAIService'); // Added for LLM title generation

class ChatSessionService {
  /**
   * Create a new chat session
   */
  async createChatSession(userId, title = 'New Chat', organizationId = null) {
    try {
      const sessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (!organizationId) {
        throw new Error('Organization ID is required for creating chat sessions');
      }
      
      const chatSession = new ChatSession({
        sessionId,
        userId,
        organizationId,
        title,
        description: '',
        isActive: true,
        messageCount: 0
      });

      await chatSession.save();
      console.log(`💬 Created new chat session: ${sessionId} for user: ${userId}, organization: ${organizationId}`);
      
      return chatSession;
    } catch (error) {
      console.error('❌ Error creating chat session:', error);
      throw error;
    }
  }

  /**
   * Get all chat sessions for a user
   */
  async getUserChatSessions(userId, limit = 50, organizationId = null) {
    try {
      const query = { 
        userId, 
        isActive: true 
      };
      
      // Add organization filter if provided
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const sessions = await ChatSession.find(query)
      .sort({ isPinned: -1, lastActivity: -1 })
      .limit(limit)
      .lean();

      console.log(`📚 Retrieved ${sessions.length} chat sessions for user: ${userId}, organization: ${organizationId}`);
      return sessions;
    } catch (error) {
      console.error('❌ Error getting user chat sessions:', error);
      throw error;
    }
  }

  /**
   * Get a specific chat session
   */
  async getChatSession(sessionId, organizationId = null) {
    try {
      const query = { sessionId, isActive: true };
      
      // Add organization filter if provided
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const session = await ChatSession.findOne(query).lean();
      return session;
    } catch (error) {
      console.error('❌ Error getting chat session:', error);
      throw error;
    }
  }

  /**
   * Update chat session with new message
   */
  async updateChatSession(sessionId, messageContent, messageType = 'user', metadata = {}) {
    try {
      const updateData = {
        lastMessage: {
          content: messageContent.substring(0, 200), // Truncate for storage
          timestamp: new Date(),
          type: messageType
        },
        lastActivity: new Date(),
        $inc: { messageCount: 1 }
      };

      // Update metadata if provided
      if (metadata.intent) {
        updateData['metadata.intent'] = metadata.intent;
      }
      if (metadata.topics && metadata.topics.length > 0) {
        updateData['metadata.topics'] = metadata.topics;
      }
      if (metadata.confidence) {
        updateData['metadata.avgConfidence'] = metadata.confidence;
      }
      if (metadata.dataUsed) {
        updateData['metadata.dataUsed'] = metadata.dataUsed;
      }

      const session = await ChatSession.findOneAndUpdate(
        { sessionId, isActive: true },
        updateData,
        { new: true }
      );

      if (session) {
        console.log(`📝 Updated chat session: ${sessionId}`);
      }

      return session;
    } catch (error) {
      console.error('❌ Error updating chat session:', error);
      throw error;
    }
  }

  /**
   * Update chat session title
   */
  async updateChatSessionTitle(sessionId, userId, title) {
    try {
      const session = await ChatSession.findOneAndUpdate(
        { sessionId, userId, isActive: true },
        { title, updatedAt: new Date() },
        { new: true }
      );

      if (session) {
        console.log(`📝 Updated chat session title: ${sessionId} -> ${title}`);
      }

      return session;
    } catch (error) {
      console.error('❌ Error updating chat session title:', error);
      throw error;
    }
  }

  /**
   * Pin/unpin a chat session
   */
  async toggleChatSessionPin(sessionId, userId) {
    try {
      const session = await ChatSession.findOne({ sessionId, userId, isActive: true });
      
      if (!session) {
        throw new Error('Chat session not found');
      }

      session.isPinned = !session.isPinned;
      await session.save();

      console.log(`📌 ${session.isPinned ? 'Pinned' : 'Unpinned'} chat session: ${sessionId}`);
      return session;
    } catch (error) {
      console.error('❌ Error toggling chat session pin:', error);
      throw error;
    }
  }

  /**
   * Delete a chat session (soft delete)
   */
  async deleteChatSession(sessionId, userId) {
    try {
      const session = await ChatSession.findOneAndUpdate(
        { sessionId, userId, isActive: true },
        { isActive: false, updatedAt: new Date() },
        { new: true }
      );

      if (session) {
        // Also clear the memory for this chat session
        await memoryService.deleteAllMemories(`${userId}_${sessionId}`);
        console.log(`🗑️ Deleted chat session: ${sessionId}`);
      }

      return session;
    } catch (error) {
      console.error('❌ Error deleting chat session:', error);
      throw error;
    }
  }

  /**
   * Get chat session memory identifier
   */
  getChatSessionMemoryId(userId, chatSessionId) {
    return `${userId}_${chatSessionId}`;
  }

  /**
   * Get global user memory identifier
   */
  getGlobalUserMemoryId(userId) {
    return `global_${userId}`;
  }

  /**
   * Auto-generate title for chat session based on first message
   */
  async autoGenerateTitle(sessionId, firstUserMessage, firstAssistantMessage = null) {
    let finalTitle = 'New Chat'; // Default title
    let titleSource = 'fallback_error';

    try {
      const azureOpenAIService = new AzureOpenAIService();
      const llmTitleResult = await azureOpenAIService.generateChatTitle(firstUserMessage, firstAssistantMessage);

      if (llmTitleResult.success && llmTitleResult.title && llmTitleResult.title.length >= 3 && llmTitleResult.title.length <= 70) {
        finalTitle = llmTitleResult.title;
        titleSource = 'llm';
        console.log(`🤖 LLM generated title for ${sessionId}: ${finalTitle}`);
      } else {
        console.warn(`⚠️ LLM title generation failed or title unsuitable for ${sessionId}. Reason: ${llmTitleResult.error || 'Title too short/long'}. Falling back to simple logic.`);
        // Fallback to simple title generation based on first message
        let simpleTitle = firstUserMessage.substring(0, 50);
        simpleTitle = simpleTitle.replace(/[^\w\s.,!?'"-]/g, '').trim(); // Allow some punctuation
        
        if (firstUserMessage.length > 50 && !simpleTitle.endsWith('...')) {
          simpleTitle += '...';
        }

        if (simpleTitle.toLowerCase().includes('candidate')) {
          finalTitle = 'Candidate Discussion';
        } else if (simpleTitle.toLowerCase().includes('job')) {
          finalTitle = 'Job Discussion';
        } else if (simpleTitle.toLowerCase().includes('report') || simpleTitle.toLowerCase().includes('analytic')) {
          finalTitle = 'Analytics & Reports';
        } else if (simpleTitle.toLowerCase().includes('help') || simpleTitle.toLowerCase().includes('how')) {
          finalTitle = 'Help & Support';
        } else if (!simpleTitle || simpleTitle.length < 10) {
          finalTitle = 'General Discussion';
        } else {
          finalTitle = simpleTitle; // Use the cleaned snippet if it's decent
        }
        titleSource = 'simple_fallback';
      }

      // Update the session title
      await ChatSession.findOneAndUpdate(
        { sessionId, isActive: true },
        { title: finalTitle, updatedAt: new Date() }
      );

      console.log(`🏷️ Auto-generated title for ${sessionId} (source: ${titleSource}): ${finalTitle}`);
      return finalTitle;
    } catch (error) {
      console.error('❌ Error in autoGenerateTitle:', error);
      // Attempt to save with a very basic fallback if all else fails
      try {
        await ChatSession.findOneAndUpdate(
          { sessionId, isActive: true },
          { title: 'Chat Session', updatedAt: new Date() }
        );
      } catch (dbError) {
        console.error('❌❌ Failed to even save basic fallback title:', dbError);
      }
      return 'Chat Session'; // Ultimate fallback
    }
  }

  /**
   * Get chat session statistics
   */
  async getChatSessionStats(userId) {
    try {
      const stats = await ChatSession.aggregate([
        { $match: { userId, isActive: true } },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            totalMessages: { $sum: '$messageCount' },
            pinnedSessions: { $sum: { $cond: ['$isPinned', 1, 0] } },
            avgMessagesPerSession: { $avg: '$messageCount' }
          }
        }
      ]);

      return stats[0] || {
        totalSessions: 0,
        totalMessages: 0,
        pinnedSessions: 0,
        avgMessagesPerSession: 0
      };
    } catch (error) {
      console.error('❌ Error getting chat session stats:', error);
      throw error;
    }
  }

  /**
   * Cleanup old inactive sessions
   */
  async cleanupOldSessions(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await ChatSession.deleteMany({
        isActive: false,
        updatedAt: { $lt: cutoffDate }
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old chat sessions`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old sessions:', error);
      throw error;
    }
  }

  /**
   * Migrate session ownership to a new user
   */
  async migrateSessionOwnership(sessionId, newUserId) {
    try {
      const session = await ChatSession.findOneAndUpdate(
        { sessionId, isActive: true },
        { 
          userId: newUserId,
          lastActivity: new Date()
        },
        { new: true }
      ).lean();

      if (session) {
        console.log(`✅ Migrated session ${sessionId} to user ${newUserId}`);
      }

      return session;
    } catch (error) {
      console.error('❌ Error migrating session ownership:', error);
      throw error;
    }
  }

  /**
   * Clean up old anonymous sessions
   */
  async cleanupAnonymousSessions(daysOld = 7) {
    // Implementation of cleanupAnonymousSessions method
  }
}

module.exports = new ChatSessionService(); 