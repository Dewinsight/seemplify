const { MemoryClient } = require('mem0ai');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

class MemoryService {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.initializeClient();
  }

  async initializeClient() {
    try {
      if (!process.env.MEM0_API_KEY) {
        console.error('❌ MEM0_API_KEY not found in environment variables');
        return;
      }

      // Initialize Mem0 client with proper configuration
      this.client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });

      this.initialized = true;
      console.log('✅ Mem0 memory service initialized successfully with Graph Memory enabled');
    } catch (error) {
      console.error('❌ Error initializing Mem0 client:', error);
      this.initialized = false;
    }
  }

  /**
   * Store semantic insights and understanding (DEPRECATED - use addIntelligentMemory instead)
   * @param {string} userId - Unique user identifier
   * @param {Object} semanticData - Extracted insights and understanding
   * @deprecated Use addIntelligentMemory for AI-driven memory classification
   */
  async addSemanticInsight(userId, semanticData) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping semantic insight storage');
      return null;
    }

    try {
      const { userMessage, assistantResponse, intent, extractedEntities, confidence, dataUsed, organizationId } = semanticData;
      
      // Extract semantic understanding from the conversation
      const insights = this.extractSemanticInsights(userMessage, assistantResponse, {
        intent, extractedEntities, confidence, dataUsed
      });

      // Create organization-scoped user ID
      const orgScopedUserId = organizationId ? `${userId}_org_${organizationId}` : userId;
      
      if (!organizationId) {
        console.warn('⚠️ No organization context provided for semantic insight storage');
      }

      // Store each insight separately for better retrieval
      const memories = [];
      for (const insight of insights) {
        const memory = await this.client.add([{
          role: 'system',
          content: insight.understanding
        }], {
          user_id: orgScopedUserId,
          metadata: {
            type: 'semantic_insight',
            category: insight.category,
            confidence: insight.confidence,
            originalUserId: userId, // Keep original user ID
            organizationId: organizationId,
            extractedFrom: {
              intent,
              userQuery: userMessage.substring(0, 100), // First 100 chars for context
              entities: extractedEntities
            },
            timestamp: new Date().toISOString(),
            source: 'smart_hr_assistant'
          }
        });
        memories.push(memory);
      }

      console.log('🧠 Stored ' + insights.length + ' semantic insights for user ' + userId);
      return memories;
    } catch (error) {
      console.error('❌ Error storing semantic insight:', error);
      return null;
    }
  }

  /**
   * Store user behavioral patterns and preferences (DEPRECATED - use addIntelligentMemory instead)
   * @param {string} userId - User identifier
   * @param {Object} behaviorData - User behavior and preferences
   * @deprecated Use addIntelligentMemory for AI-driven memory classification
   */
  async addUserBehaviorPattern(userId, behaviorData) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping behavior pattern storage');
      return null;
    }

    try {
      const { intent, frequency, context, timePattern, preferredActions } = behaviorData;
      
      const behaviorInsight = 'User frequently ' + intent.toLowerCase().replace('_', ' ') + ' with preference for ' + context + '. Common time pattern: ' + timePattern + '. Preferred actions: ' + preferredActions.join(', ') + '.';

      const memory = await this.client.add([{
        role: 'system',
        content: behaviorInsight
      }], {
        user_id: userId,
        metadata: {
          type: 'behavior_pattern',
          intent,
          frequency,
          context,
          timePattern,
          preferredActions,
          timestamp: new Date().toISOString(),
          source: 'smart_hr_assistant'
        }
      });

      console.log('👤 Stored behavior pattern for user ' + userId + ': ' + intent);
      return memory;
    } catch (error) {
      console.error('❌ Error storing behavior pattern:', error);
      return null;
    }
  }

  /**
   * Store domain-specific context and relationships (DEPRECATED - use addIntelligentMemory instead)
   * @param {string} userId - User identifier
   * @param {Object} contextData - Domain context and relationships
   * @deprecated Use addIntelligentMemory for AI-driven memory classification
   */
  async addDomainContext(userId, contextData) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping domain context storage');
      return null;
    }

    try {
      const { domain, entities, relationships, insights } = contextData;
      
      const contextInsight = 'In ' + domain + ' domain: User understands ' + entities.join(', ') + '. Key relationships: ' + relationships.join(', ') + '. Insights: ' + insights;

      const memory = await this.client.add([{
        role: 'system',
        content: contextInsight
      }], {
        user_id: userId,
        metadata: {
          type: 'domain_context',
          domain,
          entities,
          relationships,
          insights,
          timestamp: new Date().toISOString(),
          source: 'smart_hr_assistant'
        }
      });

      console.log('🏢 Stored domain context for user ' + userId + ': ' + domain);
      return memory;
    } catch (error) {
      console.error('❌ Error storing domain context:', error);
      return null;
    }
  }

  /**
   * Extract semantic insights from conversation (AI understanding)
   */
  extractSemanticInsights(userMessage, assistantResponse, metadata) {
    const insights = [];
    const { intent, extractedEntities, confidence, dataUsed } = metadata;

    // 1. Intent-based understanding
    if (intent && intent !== 'GENERAL') {
      insights.push({
        category: 'intent_understanding',
        understanding: 'User has ' + intent.toLowerCase().replace('_', ' ') + ' intent with ' + confidence + ' confidence. They are working with ' + (dataUsed === 'real_data' ? 'actual system data' : 'general inquiries') + '.',
        confidence: confidence
      });
    }

    // 2. Entity recognition and relationships
    if (extractedEntities && Object.keys(extractedEntities).length > 0) {
      const entityInsight = Object.entries(extractedEntities)
        .filter(([key, value]) => value && value.length > 0)
        .map(([key, value]) => key + ': ' + (Array.isArray(value) ? value.join(', ') : value))
        .join('; ');
      
      if (entityInsight) {
        insights.push({
          category: 'entity_recognition',
          understanding: 'User mentioned entities: ' + entityInsight + '. This shows familiarity with HR domain concepts.',
          confidence: 0.8
        });
      }
    }

    // 3. Knowledge level assessment
    const complexityLevel = this.assessComplexity(userMessage);
    insights.push({
      category: 'knowledge_level',
      understanding: 'User demonstrates ' + complexityLevel + ' level knowledge based on query complexity and terminology used.',
      confidence: 0.7
    });

    // 4. Communication style
    const communicationStyle = this.analyzeCommunicationStyle(userMessage);
    insights.push({
      category: 'communication_style',
      understanding: 'User prefers ' + communicationStyle + ' communication style based on message structure and language.',
      confidence: 0.6
    });

    // 5. Success patterns (if assistant provided helpful response)
    if (assistantResponse && assistantResponse.length > 50) {
      insights.push({
        category: 'success_pattern',
        understanding: 'User query about ' + intent.toLowerCase().replace('_', ' ') + ' was successfully addressed with ' + dataUsed + ' approach.',
        confidence: 0.8
      });
    }

    return insights;
  }

  /**
   * Assess user's knowledge complexity level
   */
  assessComplexity(message) {
    const technicalTerms = ['api', 'database', 'analytics', 'metrics', 'integration', 'workflow', 'automation'];
    const hrTerms = ['recruitment', 'candidate', 'hiring', 'onboarding', 'performance', 'assessment'];
    
    const hasTechnical = technicalTerms.some(term => message.toLowerCase().includes(term));
    const hasHR = hrTerms.some(term => message.toLowerCase().includes(term));
    const messageLength = message.length;
    
    if (hasTechnical && hasHR && messageLength > 100) return 'advanced';
    if ((hasTechnical || hasHR) && messageLength > 50) return 'intermediate';
    return 'beginner';
  }

  /**
   * Analyze user's communication style
   */
  analyzeCommunicationStyle(message) {
    if (message.includes('please') || message.includes('could you') || message.includes('would you')) {
      return 'polite and formal';
    }
    if (message.length < 30 && !message.includes('?')) {
      return 'direct and concise';
    }
    if (message.includes('detailed') || message.includes('comprehensive') || message.length > 100) {
      return 'detailed and thorough';
    }
    return 'casual and straightforward';
  }

  /**
   * Store a message in memory (DEPRECATED - use semantic methods)
   * @param {string} userId - Unique user identifier
   * @param {string} message - The message to store
   * @param {Object} metadata - Additional metadata (role, timestamp, etc.)
   */
  async addMemory(userId, message, metadata = {}) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping memory storage');
      return null;
    }

    try {
      const messages = [{
        role: metadata.role || 'user',
        content: message
      }];

      // Create organization-scoped user ID
      const organizationId = metadata.organizationId || metadata.currentOrganization;
      const orgScopedUserId = organizationId ? `${userId}_org_${organizationId}` : userId;
      
      if (!organizationId) {
        console.warn('⚠️ No organization context provided for memory storage');
      }

      // Sanitize metadata to ensure it doesn't exceed limits
      const sanitizedMetadata = this.sanitizeMetadata({
        ...metadata,
        originalUserId: userId, // Keep original user ID in metadata
        organizationId: organizationId,
        timestamp: new Date().toISOString(),
        source: 'smart_hr_assistant'
      });

      const memory = await this.client.add(messages, {
        user_id: orgScopedUserId,
        metadata: sanitizedMetadata
      });

      // Enhanced memory tracking with proper ID extraction
      const memoryId = this.extractMemoryId(memory);
      const enhancedMemory = {
        ...memory,
        id: memoryId,
        userId: userId,
        enhanced: true,
        timestamp: new Date().toISOString()
      };

      console.log('📝 Memory stored for user ' + userId + ' with ID: ' + memoryId);
      return enhancedMemory;
    } catch (error) {
      console.error('❌ Error storing memory:', error);
      return null;
    }
  }

  /**
   * Store a complete conversation exchange (DEPRECATED - use semantic methods)
   * @param {string} userId - Unique user identifier
   * @param {string} userMessage - User's message
   * @param {string} assistantResponse - Assistant's response
   * @param {Object} metadata - Additional metadata
   */
  async addConversation(userId, userMessage, assistantResponse, metadata = {}) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping conversation storage');
      return null;
    }

    try {
      // Instead of storing raw conversation, extract semantic insights
      const semanticData = {
        userMessage,
        assistantResponse,
        intent: metadata.intent,
        extractedEntities: metadata.extractedEntities || {},
        confidence: metadata.confidence,
        dataUsed: metadata.dataUsed,
        organizationId: metadata.organizationId || metadata.currentOrganization
      };

      // Store semantic insights instead of raw conversation
      return await this.addSemanticInsight(userId, semanticData);
    } catch (error) {
      console.error('❌ Error storing conversation:', error);
      return null;
    }
  }

  /**
   * Store actual chat history (conversation pairs) separately
   * @param {string} userId - Unique user identifier
   * @param {string} userMessage - User's message
   * @param {string} assistantResponse - Assistant's response
   * @param {Object} metadata - Additional metadata
   */
  async addChatHistory(userId, userMessage, assistantResponse, metadata = {}) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping chat history storage');
      return null;
    }

    try {
      // Store the conversation as a formatted history entry
      const conversationText = 'User: ' + userMessage + '\nAssistant: ' + assistantResponse;
      
      // Truncate messages for metadata to stay within limits
      const truncatedUserMsg = userMessage.length > 200 
        ? userMessage.substring(0, 197) + '...' 
        : userMessage;
      const truncatedAssistantResp = assistantResponse.length > 200 
        ? assistantResponse.substring(0, 197) + '...' 
        : assistantResponse;
      
      const historyMemory = await this.client.add([{
        role: 'system',
        content: conversationText
      }], {
        user_id: userId,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          source: 'smart_hr_assistant',
          type: 'chat_history',
          // Use truncated versions in metadata
          userMsgPreview: truncatedUserMsg,
          assistantRespPreview: truncatedAssistantResp
        }
      });

      console.log('📝 Chat history stored for user ' + userId);
      return historyMemory;
    } catch (error) {
      console.error('❌ Error storing chat history:', error);
      return null;
    }
  }

  /**
   * Retrieve memories for a user
   * @param {string} userId - Unique user identifier
   * @param {number} limit - Maximum number of memories to retrieve
   */
  async getMemories(userId, limit = 10, organizationId = null) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, returning empty memories');
      return [];
    }

    try {
      // Create organization-scoped user ID
      const orgScopedUserId = organizationId ? `${userId}_org_${organizationId}` : userId;
      
      if (!organizationId) {
        console.warn('⚠️ No organization context provided for memory retrieval');
      }
      
      // Correct API call format - pass filters as object with user_id property
      const memories = await this.client.getAll({ user_id: orgScopedUserId });

      // Handle different possible response structures
      let memoriesArray = [];
      
      if (Array.isArray(memories)) {
        memoriesArray = memories;
      } else if (memories?.results && Array.isArray(memories.results)) {
        memoriesArray = memories.results;
      } else if (memories?.data && Array.isArray(memories.data)) {
        memoriesArray = memories.data;
      } else if (memories && typeof memories === 'object') {
        // Convert object to array if it's an object with numeric keys
        const keys = Object.keys(memories);
        if (keys.length > 0 && keys.every(key => !isNaN(key))) {
          memoriesArray = Object.values(memories);
        }
      }

      // Enhance retrieved memories with proper IDs
      const enhancedMemories = memoriesArray.map(memory => ({
        ...memory,
        id: this.extractMemoryId(memory) || memory.id,
        enhanced: true,
        retrievedAt: new Date().toISOString()
      }));

      console.log('📚 Retrieved ' + enhancedMemories.length + ' enhanced memories for user ' + userId);
      return enhancedMemories;
    } catch (error) {
      console.error('❌ Error retrieving memories:', error);
      return [];
    }
  }

  /**
   * Search memories based on query with Graph Memory support
   * @param {string} userId - Unique user identifier
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results
   * @param {Object} options - Additional search options
   */
  async searchMemories(userId, query, limit = 5, options = {}) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, returning empty search results');
      return [];
    }

    try {
      // Create organization-scoped user ID
      const organizationId = options.organizationId || options.currentOrganization;
      const orgScopedUserId = organizationId ? `${userId}_org_${organizationId}` : userId;
      
      if (!organizationId) {
        console.warn('⚠️ No organization context provided for memory search');
      }
      
      // Enhanced search options for Graph Memory
      // Correct API call format for search - pass options as second parameter
      const searchOptions = {
        user_id: orgScopedUserId,
        limit: limit,
        // Enable graph-based search for better context understanding  
        use_graph: options.use_graph || true,
        // Include related entities in search
        include_related: options.include_related || true,
        // Search depth in the graph (how many hops to follow relationships)
        graph_depth: options.graph_depth || options.graphDepth || 2,
        // Filter by entity types if specified
        entity_types: options.entity_types || options.entityTypes || [],
        // Filter by relationship types if specified
        relationship_types: options.relationship_types || options.relationshipTypes || [],
        // Include metadata in results
        include_metadata: options.include_metadata || true,
        ...options
      };

      const results = await this.client.search(query, searchOptions);

      // If graph search is enabled, results may include related memories
      if (searchOptions.use_graph && results.related_memories) {
        console.log('🔍 Found ' + results.memories.length + ' direct memories and ' + 
                   results.related_memories.length + ' related memories via graph for user ' + userId);
        
        // Combine and rank results
        const allResults = [...results.memories, ...results.related_memories];
        
        // Sort by relevance score if available
        allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
        
        // Limit to requested number
        return allResults.slice(0, limit);
      }

      console.log('🔍 Found ' + results.length + ' memories matching query for user ' + userId);
      return results;
    } catch (error) {
      console.error('❌ Error searching memories:', error);
      return [];
    }
  }

  /**
   * Delete a specific memory
   * @param {string} memoryId - Memory ID to delete
   */
  async deleteMemory(memoryId) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, cannot delete memory');
      return false;
    }

    try {
      await this.client.delete(memoryId);
      console.log('🗑️ Memory ' + memoryId + ' deleted');
      return true;
    } catch (error) {
      console.error('❌ Error deleting memory:', error);
      return false;
    }
  }

  /**
   * Delete all memories for a user
   * @param {string} userId - User ID whose memories to delete
   */
  async deleteAllMemories(userId) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, cannot delete memories');
      return false;
    }

    try {
      // Correct API call format - pass filters as object
      await this.client.deleteAll({ user_id: userId });
      console.log('🗑️ All memories deleted for user ' + userId);
      return true;
    } catch (error) {
      console.error('❌ Error deleting all memories:', error);
      return false;
    }
  }

  /**
   * Get conversation history formatted for AI context
   * @param {string} userId - User ID
   * @param {number} limit - Number of recent conversations to include
   */
  async getConversationHistory(userId, limit = 5) {
    if (!this.initialized) {
      return '';
    }

    try {
      const memories = await this.getMemories(userId, limit * 4); // Get more to ensure we have enough conversations
      
      if (!memories || memories.length === 0) {
        return 'No previous conversation history.';
      }

      // Sort memories by timestamp (most recent first)
      const sortedMemories = memories.sort((a, b) => {
        const timeA = new Date(a.metadata?.timestamp || a.created_at);
        const timeB = new Date(b.metadata?.timestamp || b.created_at);
        return timeB - timeA;
      });

      // Group memories from qa_exchange conversations and format them
      const conversations = [];
      let currentConversation = [];
      
      sortedMemories.forEach(memory => {
        if (memory.metadata?.conversationType === 'qa_exchange') {
          const memoryText = memory.memory || memory.text || '';
          const timestamp = memory.metadata?.timestamp || memory.created_at;
          
          currentConversation.push({
            text: memoryText,
            timestamp: timestamp,
            metadata: memory.metadata
          });
        }
      });

      // Take the most recent conversations and format for AI context
      const recentConversations = currentConversation.slice(0, limit * 2).reverse();
      
      if (recentConversations.length === 0) {
        return 'No previous conversation history.';
      }

      // Format as conversation history
      const historyText = recentConversations.map((conv, index) => {
        return 'Memory ' + (index + 1) + ': ' + conv.text;
      }).join('\n');

      return historyText || 'No previous conversation history.';
    } catch (error) {
      console.error('❌ Error getting conversation history:', error);
      return '';
    }
  }

  /**
   * Update user profile information in memory
   * @param {string} userId - User ID
   * @param {Object} profileData - Profile information to store
   */
  async updateUserProfile(userId, profileData) {
    if (!this.initialized) {
      return null;
    }

    try {
      // Create a sanitized version of profileData for metadata
      const sanitizedProfileData = {};
      const maxFieldLength = 100;
      
      // Only include essential fields and truncate if necessary
      const essentialFields = ['name', 'email', 'role', 'department', 'company', 'expertise'];
      
      for (const field of essentialFields) {
        if (profileData[field]) {
          const value = String(profileData[field]);
          sanitizedProfileData[field] = value.length > maxFieldLength 
            ? value.substring(0, maxFieldLength - 3) + '...'
            : value;
        }
      }
      
      const messages = [{
        role: 'system',
        content: 'User profile update: ' + JSON.stringify(profileData)
      }];

      const memory = await this.client.add(messages, {
        user_id: userId,
        metadata: {
          type: 'user_profile',
          ...sanitizedProfileData, // Use sanitized version in metadata
          timestamp: new Date().toISOString(),
          source: 'smart_hr_assistant'
        }
      });

      console.log('👤 User profile updated for ' + userId);
      return memory;
    } catch (error) {
      console.error('❌ Error updating user profile:', error);
      return null;
    }
  }

  /**
   * Get user context from semantic insights (enhanced version)
   * @param {string} userId - User ID
   */
  async getUserContext(userId) {
    if (!this.initialized) {
      return null;
    }

    try {
      const memories = await this.getMemories(userId, 50);
      
      // Separate different types of insights
      const semanticInsights = memories.filter(m => m.metadata?.type === 'semantic_insight');
      const behaviorPatterns = memories.filter(m => m.metadata?.type === 'behavior_pattern');
      const domainContext = memories.filter(m => m.metadata?.type === 'domain_context');
      
      // Build comprehensive user context
      const context = {
        totalInteractions: memories.length,
        
        // Knowledge Level Assessment
        knowledgeLevel: this.determineKnowledgeLevel(semanticInsights),
        
        // Communication Style
        communicationStyle: this.determineCommunicationStyle(semanticInsights),
        
        // Intent Patterns
        intentPatterns: this.analyzeIntentPatterns(behaviorPatterns),
        
        // Domain Expertise
        domainExpertise: this.analyzeDomainExpertise(domainContext),
        
        // User Preferences
        preferences: this.extractUserPreferences(behaviorPatterns),
        
        // Success Patterns
        successPatterns: this.analyzeSuccessPatterns(semanticInsights),
        
        // Time Patterns
        timePatterns: this.analyzeTimePatterns(behaviorPatterns),
        
        lastInteraction: this.getLastInteractionTime(memories)
      };

      console.log('🧠 Generated comprehensive user context for ' + userId + ': ' + context.knowledgeLevel + ' level, ' + context.communicationStyle + ' style');
      return context;
    } catch (error) {
      console.error('❌ Error getting user context:', error);
      return null;
    }
  }

  /**
   * Determine user's knowledge level from semantic insights
   */
  determineKnowledgeLevel(insights) {
    const knowledgeInsights = insights.filter(i => i.metadata?.category === 'knowledge_level');
    if (knowledgeInsights.length === 0) return 'unknown';
    
    const levels = knowledgeInsights.map(i => {
      const content = i.memory || i.text || '';
      if (content.includes('advanced')) return 3;
      if (content.includes('intermediate')) return 2;
      return 1;
    });
    
    const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length;
    if (avgLevel >= 2.5) return 'advanced';
    if (avgLevel >= 1.5) return 'intermediate';
    return 'beginner';
  }

  /**
   * Determine user's communication style
   */
  determineCommunicationStyle(insights) {
    const styleInsights = insights.filter(i => i.metadata?.category === 'communication_style');
    if (styleInsights.length === 0) return 'unknown';
    
    const styles = styleInsights.map(i => i.memory || i.text || '');
    const mostCommon = styles.reduce((acc, style) => {
      if (style.includes('polite and formal')) acc.formal++;
      else if (style.includes('direct and concise')) acc.direct++;
      else if (style.includes('detailed and thorough')) acc.detailed++;
      else acc.casual++;
      return acc;
    }, { formal: 0, direct: 0, detailed: 0, casual: 0 });
    
    const dominant = Object.entries(mostCommon).reduce((a, b) => mostCommon[a[0]] > mostCommon[b[0]] ? a : b);
    return dominant[0];
  }

  /**
   * Analyze user's intent patterns
   */
  analyzeIntentPatterns(behaviorPatterns) {
    const intents = behaviorPatterns.map(p => p.metadata?.intent).filter(Boolean);
    const intentCounts = intents.reduce((acc, intent) => {
      acc[intent] = (acc[intent] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(intentCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([intent, count]) => ({ intent, frequency: count }));
  }

  /**
   * Analyze domain expertise
   */
  analyzeDomainExpertise(domainContext) {
    const domains = domainContext.map(d => ({
      domain: d.metadata?.domain,
      entities: d.metadata?.entities || [],
      insights: d.metadata?.insights
    }));
    
    return domains.reduce((acc, curr) => {
      if (curr.domain) {
        acc[curr.domain] = {
          entityCount: curr.entities.length,
          insights: curr.insights
        };
      }
      return acc;
    }, {});
  }

  /**
   * Extract user preferences
   */
  extractUserPreferences(behaviorPatterns) {
    const preferences = {};
    
    behaviorPatterns.forEach(pattern => {
      if (pattern.metadata?.preferredActions) {
        pattern.metadata.preferredActions.forEach(action => {
          preferences[action] = (preferences[action] || 0) + 1;
        });
      }
    });
    
    return preferences;
  }

  /**
   * Analyze success patterns
   */
  analyzeSuccessPatterns(insights) {
    const successInsights = insights.filter(i => i.metadata?.category === 'success_pattern');
    return successInsights.map(s => ({
      approach: s.metadata?.extractedFrom?.dataUsed || 'unknown',
      intent: s.metadata?.extractedFrom?.intent || 'unknown',
      confidence: s.metadata?.confidence || 0
    }));
  }

  /**
   * Analyze time patterns
   */
  analyzeTimePatterns(behaviorPatterns) {
    const patterns = behaviorPatterns.map(p => p.metadata?.timePattern).filter(Boolean);
    const patternCounts = patterns.reduce((acc, pattern) => {
      acc[pattern] = (acc[pattern] || 0) + 1;
      return acc;
    }, {});
    
    return patternCounts;
  }

  /**
   * Get last interaction time
   */
  getLastInteractionTime(memories) {
    const timestamps = memories
      .map(m => m.metadata?.timestamp || m.created_at)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a));
    
    return timestamps[0] || null;
  }

  /**
   * Get actual chat history (conversation pairs)
   * @param {string} userId - Unique user identifier
   * @param {number} limit - Maximum number of conversations to retrieve
   */
  async getChatHistory(userId, limit = 20) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, returning empty chat history');
      return [];
    }

    try {
      // Get all memories for the user
      const allMemories = await this.client.getAll({
        user_id: userId,
        limit: limit * 2 // Get more to ensure we have enough history entries
      });

      // Filter only chat history entries
      const chatHistoryMemories = allMemories.filter(memory => 
        memory.metadata?.type === 'chat_history'
      );

      // Sort by timestamp (most recent first)
      const sortedHistory = chatHistoryMemories.sort((a, b) => {
        const timeA = new Date(a.metadata?.timestamp || a.created_at);
        const timeB = new Date(b.metadata?.timestamp || b.created_at);
        return timeB - timeA;
      });

      // Format for frontend
      const formattedHistory = sortedHistory.slice(0, limit).map(memory => ({
        id: memory.id,
        timestamp: memory.metadata?.timestamp || memory.created_at,
        userMessage: memory.metadata?.userMessage || '',
        assistantResponse: memory.metadata?.assistantResponse || '',
        metadata: memory.metadata || {},
        userId: memory.user_id
      }));

      console.log('📚 Retrieved ' + formattedHistory.length + ' chat history entries for user ' + userId);
      return formattedHistory;
    } catch (error) {
      console.error('❌ Error retrieving chat history:', error);
      return [];
    }
  }

  /**
   * Add intelligent memory that automatically classifies as personality vs chat-specific
   * @param {string} userId - Global user identifier 
   * @param {string} chatSessionId - Current chat session ID
   * @param {Object} conversationData - Conversation data to classify and store
   */
  async addIntelligentMemory(userId, chatSessionId, conversationData) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, skipping intelligent memory storage (conversation still saved to database)');
      return null;
    }

    try {
      console.log('🔍 Debug - Adding intelligent memory for userId:', userId, 'chatSessionId:', chatSessionId);
      
      // Step 1: AI-powered classification
      const classification = await this.classifyMemoryType(conversationData);
      console.log('🤖 AI Memory Classification:', classification.type, '(confidence:', classification.confidence + ')');

      let personalityMemories = [];
      let chatMemories = [];
      let totalStored = 0;

      // Step 2: Store personality memories (global, persistent across all chats)
      if (classification.personalityInsights && classification.personalityInsights.length > 0) {
        console.log('🔍 Debug - Storing', classification.personalityInsights.length, 'personality insights for userId:', userId);
        
        for (const insight of classification.personalityInsights) {
          // Truncate long messages to fit within metadata limits
          const truncatedMessage = conversationData.userMessage.length > 200 
            ? conversationData.userMessage.substring(0, 197) + '...' 
            : conversationData.userMessage;
          const truncatedResponse = conversationData.assistantResponse.length > 200 
            ? conversationData.assistantResponse.substring(0, 197) + '...' 
            : conversationData.assistantResponse;
          
          // Extract entities for graph memory
          const entities = this.extractEntitiesFromInsight(insight, conversationData.extractedEntities);
          
          // Validate content before sending to Mem0
          if (!insight.content || insight.content.trim().length < 10) {
            console.log('🔍 Debug - Skipping personality memory: content too short or empty');
            continue;
          }

          console.log('🔍 Debug - Sending personality memory to Mem0:', {
            content: insight.content,
            user_id: userId,
            contentLength: insight.content.length
          });

          const personalityMemory = await this.client.add([{
            role: 'user',
            content: insight.content
          }], {
            user_id: userId,
            metadata: {
              type: 'personality',
              category: insight.category,
              confidence: insight.confidence,
              timestamp: new Date().toISOString(),
              source: 'smart_hr_assistant',
              aiClassified: true,
              classification: classification.type,
              chatSessionId: chatSessionId,
              // Truncated versions to stay within 2000 char limit
              msgPreview: truncatedMessage,
              respPreview: truncatedResponse
            }
          });

          console.log('🔍 Debug - Personality memory response:', {
            type: typeof personalityMemory,
            isArray: Array.isArray(personalityMemory),
            length: Array.isArray(personalityMemory) ? personalityMemory.length : 'N/A',
            response: personalityMemory
          });

          if (personalityMemory) {
            // Fix memory ID extraction - Mem0 returns different response structures
            const memoryId = this.extractMemoryId(personalityMemory);
            const enhancedPersonalityMemory = {
              ...personalityMemory,
              id: memoryId,
              type: 'personality',
              userId: userId,
              chatSessionId: chatSessionId
            };
            
            personalityMemories.push(enhancedPersonalityMemory);
            totalStored++;
            console.log('🔍 Debug - Stored personality memory with ID:', memoryId, 'for userId:', userId);
          }
        }
        
        console.log('🧠 Stored ' + personalityMemories.length + ' personality memories for user ' + userId);
      }

      // Step 3: Store chat-specific memories (session-specific, temporary)
      if (classification.chatInsights && classification.chatInsights.length > 0) {
        const chatSpecificUserId = userId + '_chat_' + chatSessionId;
        console.log('🔍 Debug - Storing', classification.chatInsights.length, 'chat insights for chatSpecificUserId:', chatSpecificUserId);
        
        for (const insight of classification.chatInsights) {
          // Truncate long messages to fit within metadata limits
          const truncatedMessage = conversationData.userMessage.length > 200 
            ? conversationData.userMessage.substring(0, 197) + '...' 
            : conversationData.userMessage;
          const truncatedResponse = conversationData.assistantResponse.length > 200 
            ? conversationData.assistantResponse.substring(0, 197) + '...' 
            : conversationData.assistantResponse;
          
          // Extract entities for graph memory
          const entities = this.extractEntitiesFromInsight(insight, conversationData.extractedEntities);
          
          // Validate content before sending to Mem0
          if (!insight.content || insight.content.trim().length < 10) {
            console.log('🔍 Debug - Skipping memory storage: content too short or empty');
            continue;
          }

          console.log('🔍 Debug - Sending to Mem0:', {
            content: insight.content,
            user_id: chatSpecificUserId,
            contentLength: insight.content.length
          });

          const chatMemory = await this.client.add([{
            role: 'user',
            content: insight.content
          }], {
            user_id: chatSpecificUserId, // Chat-specific user ID
            metadata: {
              type: 'chat_specific',
              category: insight.category,
              confidence: insight.confidence,
              timestamp: new Date().toISOString(),
              source: 'smart_hr_assistant',
              aiClassified: true,
              classification: classification.type,
              chatSessionId: chatSessionId,
              originalUserId: userId,
              // Truncated versions to stay within 2000 char limit
              msgPreview: truncatedMessage,
              respPreview: truncatedResponse
            }
          });

          console.log('🔍 Debug - Mem0 response received:', {
            type: typeof chatMemory,
            isArray: Array.isArray(chatMemory),
            length: Array.isArray(chatMemory) ? chatMemory.length : 'N/A',
            response: chatMemory
          });

          if (chatMemory) {
            // Fix memory ID extraction - Mem0 returns different response structures
            const memoryId = this.extractMemoryId(chatMemory);
            const enhancedChatMemory = {
              ...chatMemory,
              id: memoryId,
              type: 'chat_specific',
              userId: chatSpecificUserId,
              originalUserId: userId,
              chatSessionId: chatSessionId
            };
            
            chatMemories.push(enhancedChatMemory);
            totalStored++;
            console.log('🔍 Debug - Stored chat memory with ID:', memoryId, 'for chatSpecificUserId:', chatSpecificUserId);
          }
        }
        
        console.log('💬 Stored ' + chatMemories.length + ' chat-specific memories for session ' + chatSessionId);
      }

      console.log('🔍 Debug - Total memories stored:', totalStored, 'personality:', personalityMemories.length, 'chat:', chatMemories.length);

      return {
        personalityMemories,
        chatMemories,
        classification: {
          type: classification.type,
          confidence: classification.confidence,
          reasoning: classification.reasoning
        },
        totalStored
      };

    } catch (error) {
      console.error('❌ Error in intelligent memory storage:', error);
      return null;
    }
  }

  /**
   * AI-powered memory classification
   * Determines what should be stored as personality vs chat-specific memory
   */
  async classifyMemoryType(conversationData) {
    const { userMessage, assistantResponse, intent, extractedEntities, confidence } = conversationData;
    
    // Import Azure OpenAI service for classification
    const AzureOpenAIService = require('./azureOpenAIService');
    const azureOpenAI = new AzureOpenAIService();

    const classificationPrompt = `Analyze this conversation and determine what should be stored as:
1. PERSONALITY MEMORY (persistent across all chats - user preferences, behavior patterns, expertise level, communication style, PERSONAL INFORMATION)
2. CHAT MEMORY (specific to this conversation - temporary context, specific queries, session-based information)

Conversation:
User: "${userMessage}"
Assistant: "${assistantResponse}"
Intent: ${intent}
Entities: ${JSON.stringify(extractedEntities)}
Confidence: ${confidence}

For PERSONALITY MEMORY, extract:
- User expertise level and knowledge
- Communication preferences and style
- Recurring behavioral patterns
- Domain expertise and interests
- General preferences and working style
- Technology familiarity
- Role/department they work in
- PERSONAL INFORMATION: name, title, company, contact details, personal background
- User identity and biographical information
- Professional role and responsibilities
- Long-term goals and career interests

For CHAT MEMORY, extract:
- Specific queries about particular candidates/jobs
- Session-specific context
- Temporary search criteria
- Specific task at hand
- One-time requests
- Contextual follow-ups
- Specific data requests (show job #123, find candidate X)

IMPORTANT: Personal information like names, titles, roles, and any biographical details should ALWAYS be stored as PERSONALITY MEMORY since this information should persist across all chat sessions.

Respond in JSON format:
{
  "type": "mixed|personality|chat",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "personalityInsights": [
    {
      "category": "expertise_level|communication_style|behavior_pattern|domain_knowledge|preferences|personal_info",
      "content": "What to remember about the user",
      "confidence": 0.0-1.0
    }
  ],
  "chatInsights": [
    {
      "category": "query_context|session_state|temporary_request|specific_task",
      "content": "What to remember for this chat session",
      "confidence": 0.0-1.0
    }
  ]
}`;

    try {
      const result = await azureOpenAI.generateChatResponse(classificationPrompt);
      
      if (result.success) {
        // Try to parse JSON response
        const jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const classification = JSON.parse(jsonMatch[0]);
          return {
            type: classification.type || 'mixed',
            confidence: classification.confidence || 0.5,
            reasoning: classification.reasoning || 'AI classification',
            personalityInsights: classification.personalityInsights || [],
            chatInsights: classification.chatInsights || []
          };
        }
      }
    } catch (error) {
      console.error('❌ Error in AI memory classification:', error);
    }

    // Fallback classification using rule-based logic
    return this.fallbackMemoryClassification(conversationData);
  }

  /**
   * Extract memory ID from Mem0 response - handles different response structures
   * @param {object} memoryResponse - Response from Mem0 client.add()
   * @returns {string} - Extracted memory ID or generated UUID
   */
  extractMemoryId(memoryResponse) {
    if (!memoryResponse) {
      console.log('🔍 Debug - Mem0 response is null/undefined, generating fallback ID');
      return this.generateMemoryId();
    }
    
    // Handle empty array response (content was filtered or too short)
    if (Array.isArray(memoryResponse) && memoryResponse.length === 0) {
      console.log('🔍 Debug - Mem0 returned empty array (content filtered or too short)');
      return this.generateMemoryId();
    }
    
    // ✅ CORRECT: Handle Mem0's standard array response format
    if (Array.isArray(memoryResponse) && memoryResponse.length > 0) {
      const firstMemory = memoryResponse[0];
      console.log('🔍 Debug - Mem0 array response, extracting ID from first memory');
      
      // Mem0 standard format: [{ "id": "uuid", "data": {...}, "event": "ADD" }]
      if (firstMemory.id) {
        console.log('✅ Found memory ID:', firstMemory.id);
        return firstMemory.id;
      }
      
      // Alternative formats
      if (firstMemory.memory_id) return firstMemory.memory_id;
      if (firstMemory.data?.id) return firstMemory.data.id;
      if (firstMemory.data?.memory_id) return firstMemory.data.memory_id;
    }
    
    // Handle single object responses (less common)
    if (memoryResponse.id) {
      return memoryResponse.id;
    }
    
    if (memoryResponse.memory_id) {
      return memoryResponse.memory_id;
    }
    
    if (memoryResponse.data?.id) {
      return memoryResponse.data.id;
    }
    
    if (memoryResponse.data?.memory_id) {
      return memoryResponse.data.memory_id;
    }
    
    // Handle nested result structures
    if (memoryResponse.result?.id) {
      return memoryResponse.result.id;
    }
    
    if (memoryResponse.result?.memory_id) {
      return memoryResponse.result.memory_id;
    }
    
    // Handle success response with results array
    if (memoryResponse.results && Array.isArray(memoryResponse.results) && memoryResponse.results.length > 0) {
      const firstResult = memoryResponse.results[0];
      if (firstResult.id) return firstResult.id;
      if (firstResult.memory_id) return firstResult.memory_id;
    }
    
    // Log unexpected response structure for debugging
    console.log('🔍 Debug - Unexpected Mem0 response structure:', JSON.stringify(memoryResponse, null, 2));
    console.log('🔍 Debug - Response type:', typeof memoryResponse);
    console.log('🔍 Debug - Response keys:', Object.keys(memoryResponse));
    
    // Generate fallback ID
    return this.generateMemoryId();
  }
  
  /**
   * Generate a unique memory ID for fallback cases
   * @returns {string} - Generated memory ID
   */
  generateMemoryId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `mem_${timestamp}_${random}`;
  }

  /**
   * Fallback rule-based memory classification
   */
  fallbackMemoryClassification(conversationData) {
    const { userMessage, assistantResponse, intent, extractedEntities } = conversationData;
    const messageLower = userMessage.toLowerCase();
    const assistantLower = (assistantResponse || '').toLowerCase();
    
    const personalityInsights = [];
    const chatInsights = [];

    // Personal information detection (CRITICAL - should always be personality)
    const personalIndicators = [
      /my name is (\w+)/i,
      /i'm (\w+)/i,
      /i am (\w+)/i,
      /call me (\w+)/i,
      /name.*is (\w+)/i,
      /work at (\w+)/i,
      /i work for (\w+)/i,
      /my company/i,
      /my role/i,
      /my title/i,
      /i'm a (.+)/i,
      /i am a (.+)/i,
      /my background/i,
      /my experience/i
    ];

    // Check for personal information in user message
    personalIndicators.forEach(pattern => {
      const match = userMessage.match(pattern);
      if (match) {
        personalityInsights.push({
          category: 'personal_info',
          content: 'User provided personal information: ' + match[0],
          confidence: 0.95
        });
      }
    });

    // Check for personal information in assistant response (if assistant learned something about user)
    if (assistantResponse && (assistantLower.includes('hello ') || assistantLower.includes('hi ') || assistantLower.includes('nice to meet you'))) {
      const nameMatch = assistantResponse.match(/hello (\w+)|hi (\w+)|nice to meet you,? (\w+)/i);
      if (nameMatch) {
        personalityInsights.push({
          category: 'personal_info',
          content: 'User name identified: ' + (nameMatch[1] || nameMatch[2] || nameMatch[3]),
          confidence: 0.9
        });
      }
    }

    // Personality indicators (persistent patterns)
    if (this.assessComplexity(userMessage) === 'advanced') {
      personalityInsights.push({
        category: 'expertise_level',
        content: 'User demonstrates advanced technical knowledge in HR domain based on sophisticated queries and terminology',
        confidence: 0.8
      });
    }

    if (messageLower.includes('usually') || messageLower.includes('typically') || messageLower.includes('always') || messageLower.includes('prefer') || messageLower.includes('like to')) {
      personalityInsights.push({
        category: 'behavior_pattern',
        content: 'User has established patterns and preferences in their workflow',
        confidence: 0.7
      });
    }

    // Professional role indicators
    const roleIndicators = [
      /i'm the (.+)/i,
      /i am the (.+)/i,
      /my position/i,
      /as a (.+)/i,
      /work as (.+)/i,
      /my job/i
    ];

    roleIndicators.forEach(pattern => {
      const match = userMessage.match(pattern);
      if (match) {
        personalityInsights.push({
          category: 'personal_info',
          content: 'User professional role: ' + match[0],
          confidence: 0.85
        });
      }
    });

    // Communication style patterns
    const style = this.analyzeCommunicationStyle(userMessage);
    if (style !== 'casual and conversational') {
      personalityInsights.push({
        category: 'communication_style',
        content: 'User prefers ' + style + ' communication approach',
        confidence: 0.6
      });
    }

    // Domain expertise
    if (extractedEntities && extractedEntities.skills && extractedEntities.skills.length > 2) {
      personalityInsights.push({
        category: 'domain_knowledge',
        content: 'User is knowledgeable about technical skills: ' + extractedEntities.skills.join(', '),
        confidence: 0.7
      });
    }

    // Chat-specific indicators (temporary context)
    if (messageLower.includes('show me') || messageLower.includes('list') || messageLower.includes('find')) {
      chatInsights.push({
        category: 'query_context',
        content: 'User is looking for specific information: ' + intent,
        confidence: 0.8
      });
    }

    // Specific entities mentioned
    if (extractedEntities && extractedEntities.roles && extractedEntities.roles.length > 0) {
      chatInsights.push({
        category: 'session_state',
        content: 'Current focus on roles: ' + extractedEntities.roles.join(', '),
        confidence: 0.9
      });
    }

    // Specific data requests
    const specificRequests = [
      /job #\d+/i,
      /candidate #\d+/i,
      /id: \d+/i,
      /show candidate/i,
      /view job/i
    ];

    specificRequests.forEach(pattern => {
      if (userMessage.match(pattern)) {
        chatInsights.push({
          category: 'specific_task',
          content: 'User requested specific data: ' + pattern.source,
          confidence: 0.9
        });
      }
    });

    return {
      type: personalityInsights.length > 0 && chatInsights.length > 0 ? 'mixed' : 
            personalityInsights.length > 0 ? 'personality' : 'chat',
      confidence: 0.6,
      reasoning: 'Rule-based fallback classification with enhanced personal information detection',
      personalityInsights,
      chatInsights
    };
  }

  /**
   * Get combined memories (personality + chat-specific)
   * @param {string} userId - User identifier
   * @param {string} chatSessionId - Optional chat session for chat-specific memories
   * @param {number} limit - Memory limit
   */
  async getCombinedMemories(userId, chatSessionId = null, limit = 20) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, returning empty memories');
      return [];
    }

    try {
      console.log('🧠 Retrieving combined memories for userId:', userId, 'chatSessionId:', chatSessionId);

      // Get personality memories (global user memories)
      const personalityMemories = await this.getMemories(userId, Math.floor(limit * 0.6));
      
      // Get chat-specific memories if chatSessionId provided
      let chatMemories = [];
      if (chatSessionId) {
        const chatSpecificUserId = userId + '_chat_' + chatSessionId;
        chatMemories = await this.getMemories(chatSpecificUserId, Math.floor(limit * 0.4));
      }

      // Enhance memories with proper IDs and metadata
      const enhancedPersonalityMemories = personalityMemories.map(m => ({
        ...m,
        id: this.extractMemoryId(m) || m.id,
        memoryType: 'personality',
        enhanced: true,
        userId: userId
      }));

      const enhancedChatMemories = chatMemories.map(m => ({
        ...m,
        id: this.extractMemoryId(m) || m.id,
        memoryType: 'chat_specific',
        enhanced: true,
        chatSessionId: chatSessionId,
        originalUserId: userId
      }));

      // Combine and sort by relevance/timestamp
      const combined = [
        ...enhancedPersonalityMemories,
        ...enhancedChatMemories
      ].sort((a, b) => {
        // Sort by timestamp, most recent first
        const timeA = a.created_at ? new Date(a.created_at) : new Date(0);
        const timeB = b.created_at ? new Date(b.created_at) : new Date(0);
        return timeB - timeA;
      });

      console.log('🧠 Enhanced retrieval: ' + enhancedPersonalityMemories.length + ' personality + ' + enhancedChatMemories.length + ' chat memories for user ' + userId);
      console.log('🔍 All memories now have proper IDs and enhanced metadata');
      
      return combined.slice(0, limit);
    } catch (error) {
      console.error('❌ Error getting combined memories:', error);
      return [];
    }
  }

  /**
   * Get user personality profile from persistent memories
   */
  async getUserPersonality(userId) {
    if (!this.initialized) {
      return null;
    }

    try {
      const memories = await this.getMemories(userId, 50);
      
      const personalityMemories = memories.filter(m => 
        m.metadata?.type === 'personality' || 
        m.metadata?.aiClassified === true
      );

      if (personalityMemories.length === 0) {
        return null;
      }

      // Aggregate personality insights
      const personality = {
        name: null,
        title: null,
        company: null,
        expertiseLevel: 'unknown',
        communicationStyle: 'professional',
        domainKnowledge: [],
        behaviorPatterns: [],
        preferences: [],
        personalInfo: [],
        lastUpdated: new Date(),
        totalInsights: personalityMemories.length
      };

      // Extract patterns from personality memories
      personalityMemories.forEach(memory => {
        const content = memory.memory || memory.text || '';
        const category = memory.metadata?.category;

        switch (category) {
          case 'personal_info':
            personality.personalInfo.push(content);
            
            // Extract specific personal details with improved patterns
            const namePatterns = [
              /name\s+(?:is\s+)?(\w+)/i,
              /user.*name.*(\w+)/i,
              /called?\s+(\w+)/i,
              /(?:i'm|i am)\s+(\w+)/i,
              /my name is (\w+)/i,
              /provided.*name.*(\w+)/i,
              /user.*provided.*information.*(\w+)/i,
              /(\w+)(?=.*name)/i
            ];
            
            for (const pattern of namePatterns) {
              const nameMatch = content.match(pattern);
              if (nameMatch && !personality.name) {
                personality.name = nameMatch[1];
                break;
              }
            }
            
            const titleMatch = content.match(/(?:title|position|role).*?:?\s*(.+)/i);
            if (titleMatch && !personality.title) {
              personality.title = titleMatch[1].trim();
            }
            
            const companyMatch = content.match(/(?:work at|company).*?:?\s*(.+)/i);
            if (companyMatch && !personality.company) {
              personality.company = companyMatch[1].trim();
            }
            break;
            
          case 'expertise_level':
            if (content.includes('advanced')) personality.expertiseLevel = 'advanced';
            else if (content.includes('intermediate')) personality.expertiseLevel = 'intermediate';
            else if (content.includes('beginner')) personality.expertiseLevel = 'beginner';
            break;
          
          case 'communication_style':
            if (content.includes('direct')) personality.communicationStyle = 'direct';
            else if (content.includes('formal')) personality.communicationStyle = 'formal';
            else if (content.includes('casual')) personality.communicationStyle = 'casual';
            break;
          
          case 'domain_knowledge':
            // Extract mentioned skills/technologies
            const skillMatches = content.match(/skills?:\s*([^.]+)/i);
            if (skillMatches) {
              personality.domainKnowledge.push(...skillMatches[1].split(',').map(s => s.trim()));
            }
            break;
          
          case 'behavior_pattern':
            personality.behaviorPatterns.push(content);
            break;
          
          case 'preferences':
            personality.preferences.push(content);
            break;
        }
      });

      // Remove duplicates
      personality.domainKnowledge = [...new Set(personality.domainKnowledge)];
      
      console.log('👤 Generated personality profile for ' + userId + ': ' + personality.expertiseLevel + ' level, ' + personality.communicationStyle + ' style, Name: ' + (personality.name || 'Not found'));
      return personality;
    } catch (error) {
      console.error('❌ Error getting user personality:', error);
      return null;
    }
  }

  /**
   * Sanitize metadata to ensure it doesn't exceed Mem0's 2000 character limit
   * @param {Object} metadata - The metadata object to sanitize
   * @returns {Object} Sanitized metadata
   */
  sanitizeMetadata(metadata) {
    const maxTotalSize = 1800; // Leave some buffer
    const maxFieldSize = 200;
    
    // Convert metadata to string to check size
    let metadataStr = JSON.stringify(metadata);
    
    // If already within limit, return as is
    if (metadataStr.length <= maxTotalSize) {
      return metadata;
    }
    
    // Otherwise, truncate fields
    const sanitized = {};
    
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue;
      }
      
      if (typeof value === 'string' && value.length > maxFieldSize) {
        sanitized[key] = value.substring(0, maxFieldSize - 3) + '...';
      } else if (Array.isArray(value)) {
        // Limit array size and truncate string elements
        sanitized[key] = value.slice(0, 5).map(item => {
          if (typeof item === 'string' && item.length > 50) {
            return item.substring(0, 47) + '...';
          }
          return item;
        });
      } else if (typeof value === 'object') {
        // For nested objects, just take essential fields
        sanitized[key] = Object.keys(value).slice(0, 3).reduce((acc, k) => {
          acc[k] = String(value[k]).substring(0, 50);
          return acc;
        }, {});
      } else {
        sanitized[key] = value;
      }
    }
    
    // Final check - if still too large, remove non-essential fields
    metadataStr = JSON.stringify(sanitized);
    if (metadataStr.length > maxTotalSize) {
      const essentialFields = ['type', 'category', 'timestamp', 'source', 'chatSessionId', 'userId'];
      const finalSanitized = {};
      
      for (const field of essentialFields) {
        if (sanitized[field] !== undefined) {
          finalSanitized[field] = sanitized[field];
        }
      }
      
      return finalSanitized;
    }
    
    return sanitized;
  }

  /**
   * Extract entities and relationships from an insight for Graph Memory
   * @param {Object} insight - The insight object containing content and category
   * @param {Object} extractedEntities - Previously extracted entities from conversation
   * @returns {Object} Structured entities and relationships for graph storage
   */
  extractEntitiesFromInsight(insight, extractedEntities = {}) {
    const result = {
      nodes: [],
      edges: []
    };
    
    try {
      const content = insight.content || '';
      const category = insight.category || '';
      
      // Extract based on category type
      switch (category) {
        case 'personal_info':
          // Extract name, role, company entities
          const nameMatch = content.match(/name[:\s]+(\w+)/i);
          if (nameMatch) {
            result.nodes.push({
              type: 'Person',
              name: nameMatch[1],
              properties: { category: 'user_identity' }
            });
          }
          
          const roleMatch = content.match(/role[:\s]+([^,\.]+)/i);
          if (roleMatch) {
            result.nodes.push({
              type: 'Role',
              name: roleMatch[1].trim(),
              properties: { category: 'professional' }
            });
            // Create relationship if we have both name and role
            if (nameMatch) {
              result.edges.push({
                type: 'HAS_ROLE',
                from: nameMatch[1],
                to: roleMatch[1].trim(),
                properties: { strength: 1.0 }
              });
            }
          }
          
          const companyMatch = content.match(/(?:work(?:s|ing)? (?:at|for)|company[:\s]+)([^,\.]+)/i);
          if (companyMatch) {
            result.nodes.push({
              type: 'Company',
              name: companyMatch[1].trim(),
              properties: { category: 'organization' }
            });
            // Create employment relationship
            if (nameMatch) {
              result.edges.push({
                type: 'WORKS_AT',
                from: nameMatch[1],
                to: companyMatch[1].trim(),
                properties: { current: true }
              });
            }
          }
          break;
          
        case 'preferences':
        case 'behavior_pattern':
          // Extract preference entities and relationships
          const likesMatch = content.match(/(?:likes?|loves?|prefers?)\s+([^,\.]+)/gi);
          if (likesMatch) {
            likesMatch.forEach(match => {
              const item = match.replace(/(?:likes?|loves?|prefers?)\s+/i, '').trim();
              result.nodes.push({
                type: 'Preference',
                name: item,
                properties: { sentiment: 'positive' }
              });
              result.edges.push({
                type: 'LIKES',
                from: 'user',
                to: item,
                properties: { strength: 0.8 }
              });
            });
          }
          
          const dislikesMatch = content.match(/(?:dislikes?|hates?|avoids?)\s+([^,\.]+)/gi);
          if (dislikesMatch) {
            dislikesMatch.forEach(match => {
              const item = match.replace(/(?:dislikes?|hates?|avoids?)\s+/i, '').trim();
              result.nodes.push({
                type: 'Preference',
                name: item,
                properties: { sentiment: 'negative' }
              });
              result.edges.push({
                type: 'DISLIKES',
                from: 'user',
                to: item,
                properties: { strength: 0.8 }
              });
            });
          }
          break;
          
        case 'domain_knowledge':
        case 'expertise_level':
          // Extract skills and knowledge areas
          const skillsMatch = content.match(/(?:skills?|knows?|expertise in)[:\s]+([^\.]+)/i);
          if (skillsMatch) {
            const skills = skillsMatch[1].split(/[,;]/).map(s => s.trim());
            skills.forEach(skill => {
              if (skill) {
                result.nodes.push({
                  type: 'Skill',
                  name: skill,
                  properties: { domain: 'technical' }
                });
                result.edges.push({
                  type: 'HAS_SKILL',
                  from: 'user',
                  to: skill,
                  properties: { 
                    proficiency: category === 'expertise_level' ? 'expert' : 'intermediate' 
                  }
                });
              }
            });
          }
          break;
          
        case 'query_context':
        case 'specific_task':
          // Extract task/query related entities
          const taskMatch = content.match(/(?:looking for|searching|finding|needs?)\s+([^,\.]+)/i);
          if (taskMatch) {
            result.nodes.push({
              type: 'Task',
              name: taskMatch[1].trim(),
              properties: { 
                status: 'active',
                timestamp: new Date().toISOString()
              }
            });
            result.edges.push({
              type: 'WORKING_ON',
              from: 'user',
              to: taskMatch[1].trim(),
              properties: { active: true }
            });
          }
          break;
      }
      
      // Process additional extracted entities from conversation
      if (extractedEntities && typeof extractedEntities === 'object') {
        // Handle roles
        if (extractedEntities.roles && Array.isArray(extractedEntities.roles)) {
          extractedEntities.roles.forEach(role => {
            result.nodes.push({
              type: 'JobRole',
              name: role,
              properties: { source: 'extracted' }
            });
            result.edges.push({
              type: 'INTERESTED_IN',
              from: 'user',
              to: role,
              properties: { context: 'job_search' }
            });
          });
        }
        
        // Handle skills
        if (extractedEntities.skills && Array.isArray(extractedEntities.skills)) {
          extractedEntities.skills.forEach(skill => {
            result.nodes.push({
              type: 'Skill',
              name: skill,
              properties: { source: 'extracted' }
            });
            result.edges.push({
              type: 'MENTIONED',
              from: 'user',
              to: skill,
              properties: { context: 'conversation' }
            });
          });
        }
        
        // Handle locations
        if (extractedEntities.locations && Array.isArray(extractedEntities.locations)) {
          extractedEntities.locations.forEach(location => {
            result.nodes.push({
              type: 'Location',
              name: location,
              properties: { source: 'extracted' }
            });
            result.edges.push({
              type: 'RELATED_TO',
              from: 'user',
              to: location,
              properties: { context: 'mentioned' }
            });
          });
        }
      }
      
      // Deduplicate nodes and edges
      const nodeMap = new Map();
      result.nodes.forEach(node => {
        const key = `${node.type}:${node.name}`;
        if (!nodeMap.has(key)) {
          nodeMap.set(key, node);
        }
      });
      result.nodes = Array.from(nodeMap.values());
      
      // Deduplicate edges
      const edgeMap = new Map();
      result.edges.forEach(edge => {
        const key = `${edge.type}:${edge.from}:${edge.to}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, edge);
        }
      });
      result.edges = Array.from(edgeMap.values());
      
    } catch (error) {
      console.error('Error extracting entities for graph:', error);
    }
    
    return result;
  }

  /**
   * Query graph relationships using enhanced search
   * @param {string} userId - User identifier
   * @param {Object} graphQuery - Graph query parameters
   * @returns {Promise<Object>} Graph query results
   */
  async queryGraphRelationships(userId, graphQuery = {}) {
    if (!this.initialized) {
      console.warn('⚠️ Mem0 not initialized, returning empty graph results');
      return { nodes: [], edges: [] };
    }

    try {
      // Since graphQuery doesn't exist, use enhanced search with graph options
      const searchQuery = graphQuery.query || `user ${graphQuery.startEntity || 'user'} relationships`;
      
      // Use search with graph-enabled options
      const searchOptions = {
        user_id: userId,
        limit: graphQuery.limit || 50,
        // These options may help retrieve graph-like data if supported
        include_metadata: true
      };

      // Search for memories that might contain relationship data
      const results = await this.client.search(searchQuery, searchOptions);
      
      // Convert search results to graph format
      const graphResults = {
        nodes: [],
        edges: []
      };
      
      // Process results to extract graph-like information
      if (Array.isArray(results)) {
        results.forEach(result => {
          // Extract entities from the memory content
          const content = result.memory || result.text || '';
          
          // Simple entity extraction (you can enhance this)
          const entities = this.extractEntitiesFromText(content);
          entities.forEach(entity => {
            if (!graphResults.nodes.find(n => n.name === entity.name)) {
              graphResults.nodes.push(entity);
            }
          });
        });
      }
      
      console.log('🕸️ Graph-like query returned ' + 
                 graphResults.nodes.length + ' nodes for user ' + userId);
      
      return graphResults;
    } catch (error) {
      console.error('❌ Error querying graph relationships:', error);
      // Return empty results instead of throwing
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get user's knowledge graph using available memory data
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} User's knowledge graph built from memories
   */
  async getUserKnowledgeGraph(userId) {
    if (!this.initialized) {
      return null;
    }

    try {
      // Get all user memories to build the graph
      const memories = await this.getMemories(userId, 100);
      
      // Build graph from memories
      const knowledgeGraph = {
        userId: userId,
        timestamp: new Date().toISOString(),
        statistics: {
          totalNodes: 0,
          totalEdges: 0,
          nodeTypes: {},
          relationshipTypes: {}
        },
        nodes: [],
        edges: [],
        clusters: []
      };

      // Process memories to extract graph data
      if (memories && memories.length > 0) {
        memories.forEach(memory => {
          const content = memory.memory || memory.text || '';
          const metadata = memory.metadata || {};
          
          // Extract entities from memory content
          if (metadata.extractedEntities || metadata.entities) {
            const entities = metadata.extractedEntities || metadata.entities;
            // Process entities into nodes
            this.processEntitiesIntoGraph(entities, knowledgeGraph);
          }
          
          // Extract entities from content if not in metadata
          const extractedEntities = this.extractEntitiesFromText(content);
          extractedEntities.forEach(entity => {
            if (!knowledgeGraph.nodes.find(n => n.name === entity.name)) {
              knowledgeGraph.nodes.push(entity);
              const type = entity.type || 'Unknown';
              knowledgeGraph.statistics.nodeTypes[type] = 
                (knowledgeGraph.statistics.nodeTypes[type] || 0) + 1;
            }
          });
        });
      }

      // Update statistics
      knowledgeGraph.statistics.totalNodes = knowledgeGraph.nodes.length;
      knowledgeGraph.statistics.totalEdges = knowledgeGraph.edges.length;

      // Identify clusters
      knowledgeGraph.clusters = this.identifyGraphClusters(knowledgeGraph);

      console.log('🧠 Generated knowledge graph for user ' + userId + 
                 ' with ' + knowledgeGraph.statistics.totalNodes + ' nodes');
      
      return knowledgeGraph;
    } catch (error) {
      console.error('❌ Error getting user knowledge graph:', error);
      return null;
    }
  }

  /**
   * Extract entities from text (simple implementation)
   * @param {string} text - Text to extract entities from
   * @returns {Array} Array of entity objects
   */
  extractEntitiesFromText(text) {
    const entities = [];
    
    // Simple pattern matching for common entities
    // Extract names (capitalized words)
    const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const names = text.match(namePattern) || [];
    names.forEach(name => {
      if (name.length > 2 && !['The', 'This', 'That', 'These', 'Those'].includes(name)) {
        entities.push({
          type: 'Person',
          name: name,
          properties: { source: 'text_extraction' }
        });
      }
    });
    
    // Extract skills/technologies (common patterns)
    const techPattern = /\b(?:Python|JavaScript|React|Node\.js|AI|ML|API|Database|SQL)\b/gi;
    const techs = text.match(techPattern) || [];
    techs.forEach(tech => {
      if (!entities.find(e => e.name === tech)) {
        entities.push({
          type: 'Skill',
          name: tech,
          properties: { source: 'text_extraction' }
        });
      }
    });
    
    return entities;
  }

  /**
   * Process entities into the knowledge graph
   * @param {Object} entities - Entities object from metadata
   * @param {Object} knowledgeGraph - Knowledge graph to update
   */
  processEntitiesIntoGraph(entities, knowledgeGraph) {
    if (!entities || typeof entities !== 'object') return;
    
    Object.entries(entities).forEach(([entityType, entityList]) => {
      if (Array.isArray(entityList)) {
        entityList.forEach(entityName => {
          if (!knowledgeGraph.nodes.find(n => n.name === entityName)) {
            knowledgeGraph.nodes.push({
              type: entityType,
              name: entityName,
              properties: { source: 'metadata' }
            });
            knowledgeGraph.statistics.nodeTypes[entityType] = 
              (knowledgeGraph.statistics.nodeTypes[entityType] || 0) + 1;
          }
        });
      }
    });
  }

  /**
   * Identify clusters in the graph (connected components)
   * @param {Object} graphData - Graph data with nodes and edges
   * @returns {Array} Array of clusters
   */
  identifyGraphClusters(graphData) {
    const clusters = [];
    const visited = new Set();
    const adjacencyList = {};

    // Build adjacency list
    if (graphData.edges) {
      graphData.edges.forEach(edge => {
        if (!adjacencyList[edge.from]) adjacencyList[edge.from] = [];
        if (!adjacencyList[edge.to]) adjacencyList[edge.to] = [];
        adjacencyList[edge.from].push(edge.to);
        adjacencyList[edge.to].push(edge.from); // Assuming undirected for clustering
      });
    }

    // DFS to find connected components
    const dfs = (node, cluster) => {
      visited.add(node);
      cluster.nodes.push(node);
      
      if (adjacencyList[node]) {
        adjacencyList[node].forEach(neighbor => {
          if (!visited.has(neighbor)) {
            dfs(neighbor, cluster);
          }
        });
      }
    };

    // Find all clusters
    if (graphData.nodes) {
      graphData.nodes.forEach(node => {
        const nodeName = node.name || node.id;
        if (!visited.has(nodeName)) {
          const cluster = {
            id: clusters.length + 1,
            nodes: [],
            theme: null
          };
          dfs(nodeName, cluster);
          
          // Determine cluster theme based on node types
          const nodeTypes = cluster.nodes.map(n => {
            const nodeData = graphData.nodes.find(gn => 
              (gn.name || gn.id) === n
            );
            return nodeData?.type;
          }).filter(Boolean);
          
          const typeCount = {};
          nodeTypes.forEach(type => {
            typeCount[type] = (typeCount[type] || 0) + 1;
          });
          
          cluster.theme = Object.entries(typeCount)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Mixed';
          
          clusters.push(cluster);
        }
      });
    }

    return clusters;
  }
}

// Export singleton instance
module.exports = new MemoryService(); 