const prisma = require('../db/client');
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
      
      const chatSession = await prisma.chatSession.create({
        data: {
          sessionId,
          userId,
          organizationId,
          title,
          description: '',
          isActive: true,
          messageCount: 0
        }
      });

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
      
      const sessions = await prisma.chatSession.findMany({
        where: query,
        orderBy: [{ isPinned: 'desc' }, { lastActivity: 'desc' }],
        take: limit
      });

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
      
      const session = await prisma.chatSession.findFirst({ where: query });
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
      // Fetch existing session so we can read-modify-write the Json metadata column
      const existing = await prisma.chatSession.findFirst({ where: { sessionId, isActive: true } });
      if (!existing) {
        return null;
      }

      const nextMetadata = { ...(existing.metadata || {}) };
      // Update metadata if provided
      if (metadata.intent) {
        nextMetadata.intent = metadata.intent;
      }
      if (metadata.topics && metadata.topics.length > 0) {
        nextMetadata.topics = metadata.topics;
      }
      if (metadata.confidence) {
        nextMetadata.avgConfidence = metadata.confidence;
      }
      if (metadata.dataUsed) {
        nextMetadata.dataUsed = metadata.dataUsed;
      }

      const updateData = {
        lastMessage: {
          content: messageContent.substring(0, 200), // Truncate for storage
          timestamp: new Date(),
          type: messageType
        },
        lastActivity: new Date(),
        messageCount: { increment: 1 },
        metadata: nextMetadata
      };

      const session = await prisma.chatSession.update({
        where: { id: existing.id },
        data: updateData
      });

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
      const existing = await prisma.chatSession.findFirst({ where: { sessionId, userId, isActive: true } });
      const session = existing
        ? await prisma.chatSession.update({
            where: { id: existing.id },
            data: { title, updatedAt: new Date() }
          })
        : null;

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
      const existing = await prisma.chatSession.findFirst({ where: { sessionId, userId, isActive: true } });

      if (!existing) {
        throw new Error('Chat session not found');
      }

      const session = await prisma.chatSession.update({
        where: { id: existing.id },
        data: { isPinned: !existing.isPinned }
      });

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
      const existing = await prisma.chatSession.findFirst({ where: { sessionId, userId, isActive: true } });
      const session = existing
        ? await prisma.chatSession.update({
            where: { id: existing.id },
            data: { isActive: false, updatedAt: new Date() }
          })
        : null;

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
      const resolvedTitle = typeof llmTitleResult === 'string' ? llmTitleResult : llmTitleResult?.title;
      const resolvedSuccess = typeof llmTitleResult === 'string' ? true : llmTitleResult?.success;

      if (resolvedSuccess && resolvedTitle && resolvedTitle.length >= 3 && resolvedTitle.length <= 70) {
        finalTitle = resolvedTitle;
        titleSource = 'llm';
        console.log(`🤖 LLM generated title for ${sessionId}: ${finalTitle}`);
      } else {
        console.warn(`⚠️ LLM title generation failed or title unsuitable for ${sessionId}. Reason: ${llmTitleResult?.error || 'Title too short/long'}. Falling back to simple logic.`);
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
      await prisma.chatSession.updateMany({
        where: { sessionId, isActive: true },
        data: { title: finalTitle, updatedAt: new Date() }
      });

      console.log(`🏷️ Auto-generated title for ${sessionId} (source: ${titleSource}): ${finalTitle}`);
      return finalTitle;
    } catch (error) {
      console.error('❌ Error in autoGenerateTitle:', error);
      // Attempt to save with a very basic fallback if all else fails
      try {
        await prisma.chatSession.updateMany({
          where: { sessionId, isActive: true },
          data: { title: 'Chat Session', updatedAt: new Date() }
        });
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
      const rows = await prisma.chatSession.findMany({
        where: { userId, isActive: true },
        select: { messageCount: true, isPinned: true }
      });

      if (rows.length === 0) {
        return {
          totalSessions: 0,
          totalMessages: 0,
          pinnedSessions: 0,
          avgMessagesPerSession: 0
        };
      }

      const totalSessions = rows.length;
      const totalMessages = rows.reduce((sum, r) => sum + (r.messageCount || 0), 0);
      const pinnedSessions = rows.reduce((sum, r) => sum + (r.isPinned ? 1 : 0), 0);
      const avgMessagesPerSession = totalMessages / totalSessions;

      return {
        totalSessions,
        totalMessages,
        pinnedSessions,
        avgMessagesPerSession
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

      const result = await prisma.chatSession.deleteMany({
        where: {
          isActive: false,
          updatedAt: { lt: cutoffDate }
        }
      });

      console.log(`🧹 Cleaned up ${result.count} old chat sessions`);
      return result.count;
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
      const existing = await prisma.chatSession.findFirst({ where: { sessionId, isActive: true } });
      const session = existing
        ? await prisma.chatSession.update({
            where: { id: existing.id },
            data: {
              userId: newUserId,
              lastActivity: new Date()
            }
          })
        : null;

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
