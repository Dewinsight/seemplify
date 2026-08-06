const ChatMessage = require('../models/ChatMessage');

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
      
      const chatMessage = new ChatMessage({
        messageId,
        sessionId: messageData.sessionId,
        chatSessionId: messageData.chatSessionId,
        userId: messageData.userId,
        role: messageData.role,
        content: messageData.content.trim(), // Ensure no leading/trailing whitespace
        metadata: messageData.metadata || {},
        timestamp: messageData.timestamp || new Date()
      });

      await chatMessage.save();
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
      const messages = await ChatMessage.find({ 
        chatSessionId,
        isLoading: { $ne: true } // Exclude loading messages
      })
      .sort({ timestamp: 1 }) // Oldest first for conversation flow
      .limit(limit)
      .lean();

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
      const messages = await ChatMessage.find({ 
        userId,
        isLoading: { $ne: true }
      })
      .sort({ timestamp: -1 }) // Most recent first
      .limit(limit)
      .lean();

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
      const result = await ChatMessage.deleteMany({ chatSessionId });
      console.log(`🗑️ Deleted ${result.deletedCount} messages for chat session: ${chatSessionId}`);
      return result.deletedCount;
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
      const messages = await ChatMessage.find({
        userId,
        $text: { $search: query }
      })
      .sort({ score: { $meta: 'textScore' }, timestamp: -1 })
      .limit(limit)
      .lean();

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
      const messages = await ChatMessage.find({ 
        chatSessionId,
        isLoading: { $ne: true }
      })
      .sort({ timestamp: -1 }) // Most recent first
      .limit(limit)
      .lean();

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
      const stats = await ChatMessage.aggregate([
        { $match: { chatSessionId } },
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 },
            avgLength: { $avg: { $strLenCP: '$content' } }
          }
        }
      ]);

      const totalMessages = await ChatMessage.countDocuments({ chatSessionId });
      const firstMessage = await ChatMessage.findOne({ chatSessionId }).sort({ timestamp: 1 });
      const lastMessage = await ChatMessage.findOne({ chatSessionId }).sort({ timestamp: -1 });

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