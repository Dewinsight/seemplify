const { Mem0ChatMemory } = require('./mem0LangchainWrapper');

/**
 * Memory Manager to maintain memory instances across requests
 * This ensures conversation continuity within the same chat session
 */
class MemoryManager {
  constructor() {
    // Map to store memory instances by sessionKey (userId_chatSessionId)
    this.memoryInstances = new Map();
    
    // Cleanup old instances periodically (every 30 minutes)
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldInstances();
    }, 30 * 60 * 1000);
  }

  /**
   * Get or create a memory instance for a user and chat session
   * @param {string} userId - User ID
   * @param {string} chatSessionId - Chat session ID
   * @returns {Mem0ChatMemory} Memory instance
   */
  getMemoryInstance(userId, chatSessionId) {
    // Create a unique key for this user-session combination
    const sessionKey = chatSessionId ? `${userId}_${chatSessionId}` : `${userId}_default`;
    
    // Check if we already have a memory instance for this session
    if (this.memoryInstances.has(sessionKey)) {
      const memoryData = this.memoryInstances.get(sessionKey);
      memoryData.lastAccessed = Date.now(); // Update last accessed time
      console.log(`📚 MemoryManager: Reusing existing memory instance for session ${sessionKey}`);
      return memoryData.instance;
    }
    
    // Create a new memory instance
    console.log(`🆕 MemoryManager: Creating new memory instance for session ${sessionKey}`);
    const memoryInstance = new Mem0ChatMemory({
      userId,
      chatSessionId,
      memoryKey: "chat_history",
      inputKey: "input",
      outputKey: "output",
      k: 10
    });
    
    // Store the instance with metadata
    this.memoryInstances.set(sessionKey, {
      instance: memoryInstance,
      created: Date.now(),
      lastAccessed: Date.now(),
      userId,
      chatSessionId
    });
    
    return memoryInstance;
  }

  /**
   * Clear memory for a specific session
   * @param {string} userId - User ID
   * @param {string} chatSessionId - Chat session ID
   */
  async clearMemory(userId, chatSessionId) {
    const sessionKey = chatSessionId ? `${userId}_${chatSessionId}` : `${userId}_default`;
    
    if (this.memoryInstances.has(sessionKey)) {
      const memoryData = this.memoryInstances.get(sessionKey);
      await memoryData.instance.clear();
      this.memoryInstances.delete(sessionKey);
      console.log(`🧹 MemoryManager: Cleared memory for session ${sessionKey}`);
    }
  }

  /**
   * Clear all memory instances for a user
   * @param {string} userId - User ID
   */
  async clearUserMemories(userId) {
    const keysToDelete = [];
    
    for (const [key, data] of this.memoryInstances) {
      if (data.userId === userId) {
        await data.instance.clear();
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.memoryInstances.delete(key));
    console.log(`🧹 MemoryManager: Cleared ${keysToDelete.length} memory instances for user ${userId}`);
  }

  /**
   * Clean up old memory instances that haven't been accessed in 2 hours
   */
  async cleanupOldInstances() {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const keysToDelete = [];
    
    for (const [key, data] of this.memoryInstances) {
      if (data.lastAccessed < twoHoursAgo) {
        // Flush any pending saves before cleanup
        await data.instance.flushPendingSaves();
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.memoryInstances.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 MemoryManager: Cleaned up ${keysToDelete.length} old memory instances`);
    }
  }

  /**
   * Get statistics about memory usage
   */
  getStats() {
    const stats = {
      totalInstances: this.memoryInstances.size,
      instancesByUser: {},
      oldestInstance: null,
      newestInstance: null
    };
    
    let oldestTime = Infinity;
    let newestTime = 0;
    
    for (const [key, data] of this.memoryInstances) {
      // Count instances by user
      if (!stats.instancesByUser[data.userId]) {
        stats.instancesByUser[data.userId] = 0;
      }
      stats.instancesByUser[data.userId]++;
      
      // Track oldest and newest
      if (data.created < oldestTime) {
        oldestTime = data.created;
        stats.oldestInstance = {
          key,
          created: new Date(data.created),
          lastAccessed: new Date(data.lastAccessed)
        };
      }
      
      if (data.created > newestTime) {
        newestTime = data.created;
        stats.newestInstance = {
          key,
          created: new Date(data.created),
          lastAccessed: new Date(data.lastAccessed)
        };
      }
    }
    
    return stats;
  }

  /**
   * Shutdown the memory manager and clean up
   */
  async shutdown() {
    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Flush all pending saves
    for (const [key, data] of this.memoryInstances) {
      await data.instance.flushPendingSaves();
    }
    
    // Clear all instances
    this.memoryInstances.clear();
    console.log('🛑 MemoryManager: Shutdown complete');
  }
}

// Create a singleton instance
const memoryManager = new MemoryManager();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down memory manager...');
  await memoryManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down memory manager...');
  await memoryManager.shutdown();
  process.exit(0);
});

module.exports = memoryManager; 