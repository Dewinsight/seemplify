const prisma = require('../db/client');

class ChatMessageService {
  /**
   * Save a new chat message to database
   * @param {Object} messageData - Message data to save
   */
  async saveMessage(messageData) {
    try {
      // Validate required fields
      if (!messageData.content || typeof messageData.content !== 'string' || messageData.content.trim() === '') {
        throw new Error(`Invalid content provided for ${messageData.role} message. Content cannot be empty.`);
      }
      
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const chatMessage = await prisma.chatMessage.create({
        data: {
          messageId,
          sessionId: messageData.sessionId,
          chatSessionId: messageData.chatSessionId,
          userId: messageData.userId,
          role: messageData.role,
          content: messageData.content.trim(), // Ensure no leading/trailing whitespace
          metadata: messageData.metadata || {},
          timestamp: messageData.timestamp || new Date()
        }
      });

      console.log(`💾 Saved ${messageData.role} message: ${messageId}`);
      
      return chatMessage;
    } catch (error) {
      console.error('❌ Error saving message:', error);
      throw error;
    }
  }

  /**
   * Get chat history for a specific chat session
   * @param {string} chatSessionId - Chat session ID
   * @param {number} limit - Maximum number of messages to retrieve
   */
  async getChatSessionHistory(chatSessionId, limit = 50) {
    try {
      const messages = await prisma.chatMessage.findMany({
        where: {
          chatSessionId,
          isLoading: { not: true } // Exclude loading messages
        },
        orderBy: { timestamp: 'asc' }, // Oldest first for conversation flow
        take: limit
      });

      console.log(`📚 Retrieved ${messages.length} messages for chat session: ${chatSessionId}`);
      return messages;
    } catch (error) {
      console.error('❌ Error getting chat session history:', error);
      throw error;
    }
  }

  /**
   * Get recent chat history for a user across all sessions
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of messages to retrieve
   */
  async getUserChatHistory(userId, limit = 20) {
    try {
      const messages = await prisma.chatMessage.findMany({
        where: {
          userId,
          isLoading: { not: true }
        },
        orderBy: { timestamp: 'desc' }, // Most recent first
        take: limit
      });

      console.log(`📚 Retrieved ${messages.length} messages for user: ${userId}`);
      return messages.reverse(); // Return in chronological order
    } catch (error) {
      console.error('❌ Error getting user chat history:', error);
      throw error;
    }
  }

  /**
   * Save a complete conversation exchange (user message + assistant response)
   * @param {Object} conversationData - Conversation data
   */
  async saveConversation(conversationData) {
    try {
      const { sessionId, chatSessionId, userId, userMessage, assistantResponse, metadata = {} } = conversationData;
      
      // Validate conversation data
      if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
        throw new Error('Invalid user message provided. User message cannot be empty.');
      }
      if (!assistantResponse || typeof assistantResponse !== 'string' || assistantResponse.trim() === '') {
        throw new Error('Invalid assistant response provided. Assistant response cannot be empty.');
      }
      
      const timestamp = new Date();

      // Save user message
      const userMsg = await this.saveMessage({
        sessionId,
        chatSessionId,
        userId,
        role: 'user',
        content: userMessage,
        metadata: {
          ...metadata,
          intent: metadata.intent
        },
        timestamp
      });

      // Save assistant response
      const assistantMsg = await this.saveMessage({
        sessionId,
        chatSessionId,
        userId,
        role: 'assistant',
        content: assistantResponse,
        metadata: {
          ...metadata,
          confidence: metadata.confidence,
          processingTime: metadata.processingTime,
          actions: metadata.actions || []
        },
        timestamp: new Date(timestamp.getTime() + 1) // Slightly later timestamp
      });

      console.log(`💬 Saved conversation for chat session: ${chatSessionId}`);
      return { userMessage: userMsg, assistantMessage: assistantMsg };
    } catch (error) {
      console.error('❌ Error saving conversation:', error);
      throw error;
    }
  }

  /**
   * Delete all messages for a chat session
   * @param {string} chatSessionId - Chat session ID
   */
  async deleteChatSessionMessages(chatSessionId) {
    try {
      const result = await prisma.chatMessage.deleteMany({ where: { chatSessionId } });
      console.log(`🗑️ Deleted ${result.count} messages for chat session: ${chatSessionId}`);
      return result.count;
    } catch (error) {
      console.error('❌ Error deleting chat session messages:', error);
      throw error;
    }
  }

  /**
   * Search messages by content
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results
   */
  async searchMessages(userId, query, limit = 10) {
    try {
      // TODO[pg]: Mongo $text full-text search + textScore ranking has no direct
      // Prisma equivalent. Approximated with a case-insensitive substring match on
      // content, ordered by recency. Revisit if true full-text ranking is needed.
      const messages = await prisma.chatMessage.findMany({
        where: {
          userId,
          content: { contains: query, mode: 'insensitive' }
        },
        orderBy: { timestamp: 'desc' },
        take: limit
      });

      console.log(`🔍 Found ${messages.length} messages matching query for user: ${userId}`);
      return messages;
    } catch (error) {
      console.error('❌ Error searching messages:', error);
      throw error;
    }
  }

  /**
   * Get conversation context for AI (recent messages formatted for AI)
   * @param {string} chatSessionId - Chat session ID
   * @param {number} limit - Number of recent messages to include
   */
  async getConversationContext(chatSessionId, limit = 10) {
    try {
      const messages = await prisma.chatMessage.findMany({
        where: {
          chatSessionId,
          isLoading: { not: true }
        },
        orderBy: { timestamp: 'desc' }, // Most recent first
        take: limit
      });

      // Format for AI context (reverse to chronological order)
      const context = messages.reverse().map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp
      }));

      console.log(`🧠 Retrieved ${context.length} messages for AI context`);
      return context;
    } catch (error) {
      console.error('❌ Error getting conversation context:', error);
      return [];
    }
  }

  /**
   * Get message statistics for a chat session
   * @param {string} chatSessionId - Chat session ID
   */
  async getChatSessionStats(chatSessionId) {
    try {
      const rows = await prisma.chatMessage.findMany({
        where: { chatSessionId },
        select: { role: true, content: true }
      });

      // Group by role, computing count + average content length (mirrors $group)
      const grouped = new Map();
      for (const row of rows) {
        const key = row.role;
        if (!grouped.has(key)) {
          grouped.set(key, { _id: key, count: 0, totalLength: 0 });
        }
        const g = grouped.get(key);
        g.count += 1;
        g.totalLength += (row.content || '').length;
      }
      const stats = Array.from(grouped.values()).map(g => ({
        _id: g._id,
        count: g.count,
        avgLength: g.count > 0 ? g.totalLength / g.count : 0
      }));

      const totalMessages = await prisma.chatMessage.count({ where: { chatSessionId } });
      const firstMessage = await prisma.chatMessage.findFirst({ where: { chatSessionId }, orderBy: { timestamp: 'asc' } });
      const lastMessage = await prisma.chatMessage.findFirst({ where: { chatSessionId }, orderBy: { timestamp: 'desc' } });

      return {
        totalMessages,
        messagesByRole: stats,
        firstMessage: firstMessage?.timestamp,
        lastMessage: lastMessage?.timestamp,
        duration: firstMessage && lastMessage ? 
          lastMessage.timestamp - firstMessage.timestamp : 0
      };
    } catch (error) {
      console.error('❌ Error getting chat session stats:', error);
      return null;
    }
  }
}

module.exports = new ChatMessageService(); 