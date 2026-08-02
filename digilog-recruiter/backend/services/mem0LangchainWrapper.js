const { HumanMessage, AIMessage } = require('@langchain/core/messages');
const memoryService = require('./memoryService'); // For potential future long-term memory integration
const chatMessageService = require('./chatMessageService'); // For retrieving chat messages
const chatSessionService = require('./chatSessionService'); // For getting global memory ID

class Mem0ChatMemory {
  constructor(fields) {
    this.userId = fields.userId;
    this.chatSessionId = fields.chatSessionId; // This is crucial for loading session-specific history
    this.memoryKey = fields.memoryKey || "chat_history";
    this.inputKey = fields.inputKey || "input";
    this.outputKey = fields.outputKey || "output"; // Added output key for proper saving
    this.k = fields.k || 10; // Number of past messages/interactions to retrieve
    this.returnMessages = fields.returnMessages || true; // LangChain expects BaseMessage objects by default
    
    // Internal buffer to store current conversation context
    this.chatHistory = [];
    this.pendingSave = null; // Track pending save operations
  }

  get memoryKeys() {
    return [this.memoryKey];
  }

  async loadMemoryVariables(_inputs) {
    let formattedMessages = [];
    
    // First, load from internal buffer (current session)
    if (this.chatHistory.length > 0) {
      formattedMessages = [...this.chatHistory];
      console.log(`Mem0ChatMemory: Using ${formattedMessages.length} messages from internal buffer`);
    }
    
    // Then, load from database if we have a session ID and internal buffer is empty
    if (this.chatSessionId && formattedMessages.length === 0) {
      try {
        // Fetch recent messages from chatMessageService for current session context
        // getChatSessionHistory returns messages in format: [{ role: 'user'/'assistant', content: '...', ... }]
        const sessionMessages = await chatMessageService.getChatSessionHistory(this.chatSessionId, this.k);
      
      // Filter out messages with invalid content and convert to LangChain format
      formattedMessages = sessionMessages
        .filter(msg => {
          // Only include messages with valid content
          const hasValidContent = msg.content && 
                                  typeof msg.content === 'string' && 
                                  msg.content.trim().length > 0;
          
          if (!hasValidContent) {
            console.warn(`⚠️ Mem0ChatMemory: Skipping message with invalid content:`, {
              messageId: msg.messageId,
              role: msg.role,
              content: msg.content,
              contentType: typeof msg.content
            });
          }
          
          return hasValidContent;
        })
        .map(msg => {
          try {
            // Create appropriate message type with validated content
            const content = msg.content.trim();
            return msg.role === 'user' || msg.role === 'human'
              ? new HumanMessage(content)
              : new AIMessage(content);
          } catch (error) {
            console.error(`❌ Error creating LangChain message:`, error);
            return null;
          }
        })
        .filter(Boolean); // Remove any null messages from failed conversions
        
        // Store in internal buffer for future use in this session
        this.chatHistory = [...formattedMessages];
        console.log(`Mem0ChatMemory: Loaded ${formattedMessages.length} messages from database for session ${this.chatSessionId}`);
      } catch (error) {
        console.warn(`Mem0ChatMemory: Failed to load chat history for session ${this.chatSessionId}:`, error.message);
        console.log(`Mem0ChatMemory: Continuing with empty chat history...`);
        formattedMessages = []; // Continue with empty history if database is unavailable
      }
    } else if (!this.chatSessionId && formattedMessages.length === 0) {
      console.log(`Mem0ChatMemory: No chatSessionId provided, returning empty history.`);
    }
    
    // Integrate with Mem0 Graph Memory for long-term context and relationships
    if (this.userId && _inputs && _inputs[this.inputKey]) {
      try {
        console.log(`🧠 Mem0ChatMemory: Searching graph memory for context...`);
        
        // Use the correct global memory ID format that matches how memory is saved
        const globalMemoryId = chatSessionService.getGlobalUserMemoryId(this.userId);
        console.log(`🔍 Using global memory ID: ${globalMemoryId} for user: ${this.userId}`);
        
        // Search for relevant long-term memories using graph relationships
        const longTermContextResults = await memoryService.searchMemories(
          globalMemoryId, // Use the correct global memory ID format
          _inputs[this.inputKey],
          3, // Limit to 3 most relevant long-term memories
          { 
            use_graph: true, // Enable graph-based search
            include_related: true, // Include related entities
            graph_depth: 2, // Search 2 hops in the graph
            entity_types: ['candidate', 'job', 'user_preference', 'workflow', 'personal_info'], // HR-specific entities + personal info
            relationship_types: ['worked_with', 'prefers', 'similar_to', 'related_to', 'knows', 'likes'] // HR relationships + personal
          }
        );
        
        if (longTermContextResults && longTermContextResults.length > 0) {
          console.log(`🔍 Found ${longTermContextResults.length} relevant long-term memories`);
          
          // Extract context from memories
          const longTermContext = longTermContextResults
            .map(mem => {
              // Handle different memory formats
              const content = mem.memory || mem.text || mem.content || '';
              const metadata = mem.metadata || {};
              
              // Add context about the memory type and relevance
              let contextPrefix = '';
              if (metadata.type === 'user_preference' || metadata.category === 'personal_info') {
                contextPrefix = 'Personal info: ';
              } else if (metadata.type === 'personality' || metadata.category === 'preferences') {
                contextPrefix = 'User preference: ';
              } else if (metadata.type === 'workflow_pattern') {
                contextPrefix = 'Previous workflow: ';
              } else if (metadata.type === 'domain_expertise') {
                contextPrefix = 'Domain knowledge: ';
              } else if (metadata.type === 'success_pattern') {
                contextPrefix = 'Past success: ';
              }
              
              return contextPrefix + content;
            })
            .filter(context => context.length > 10) // Filter out very short contexts
            .join('\n');
          
          if (longTermContext.trim()) {
            // Add long-term context as a system message at the beginning
            const contextMessage = new AIMessage(
              `📚 **Relevant Context**: Based on our previous interactions:\n${longTermContext}\n\n---\n`
            );
            
            // Prepend context to the message history
            formattedMessages.unshift(contextMessage);
            console.log(`✅ Added long-term context to conversation history`);
          }
        } else {
          console.log(`ℹ️ No long-term memories found for global memory ID: ${globalMemoryId}`);
        }
        
        // Also get user's knowledge graph for entity relationships
        const userGraph = await memoryService.getUserKnowledgeGraph(globalMemoryId);
        if (userGraph && userGraph.nodes && userGraph.nodes.length > 0) {
          console.log(`📊 User knowledge graph has ${userGraph.nodes.length} entities and ${userGraph.edges?.length || 0} relationships`);
          
          // Extract relevant entities from current input
          const inputEntities = this.extractEntitiesFromInput(_inputs[this.inputKey]);
          
          // Find related entities in the graph
          const relatedEntities = this.findRelatedEntitiesInGraph(inputEntities, userGraph);
          
          if (relatedEntities.length > 0) {
            const entityContext = `🔗 **Related Entities**: ${relatedEntities.join(', ')}`;
            const entityMessage = new AIMessage(entityContext);
            formattedMessages.unshift(entityMessage);
            console.log(`🔗 Added entity relationships to context`);
          }
        } else {
          console.log(`ℹ️ No knowledge graph found for global memory ID: ${globalMemoryId}`);
        }
        
      } catch (error) {
        console.warn(`⚠️ Error loading Mem0 graph context:`, error.message);
        // Continue without long-term context if there's an error
      }
    }

    return { [this.memoryKey]: formattedMessages };
  }

  // Helper method to extract entities from user input
  extractEntitiesFromInput(input) {
    const entities = [];
    const lowerInput = input.toLowerCase();
    
    // HR-specific entity patterns
    const entityPatterns = {
      'candidate': ['candidate', 'applicant', 'resume', 'cv'],
      'job': ['job', 'position', 'role', 'opening'],
      'department': ['engineering', 'hr', 'marketing', 'sales', 'product'],
      'skill': ['javascript', 'python', 'react', 'node', 'sql', 'aws'],
      'experience': ['senior', 'junior', 'lead', 'manager', 'director'],
      'location': ['remote', 'onsite', 'hybrid', 'office'],
      'food': ['amala', 'rice', 'beans', 'yam', 'plantain', 'chicken', 'beef'], // Added food entities for personal preferences
      'personal': ['favorite', 'like', 'prefer', 'love', 'enjoy', 'name', 'called'] // Added personal preference indicators
    };
    
    for (const [entityType, keywords] of Object.entries(entityPatterns)) {
      for (const keyword of keywords) {
        if (lowerInput.includes(keyword)) {
          entities.push(`${entityType}:${keyword}`);
        }
      }
    }
    
    return entities;
  }

  // Helper method to find related entities in the knowledge graph
  findRelatedEntitiesInGraph(inputEntities, userGraph) {
    const relatedEntities = [];
    
    if (!userGraph.edges || inputEntities.length === 0) {
      return relatedEntities;
    }
    
    // Find entities connected to input entities
    for (const entity of inputEntities) {
      const [entityType, entityValue] = entity.split(':');
      
      // Look for edges that connect to this entity
      for (const edge of userGraph.edges) {
        if (edge.source && edge.source.toLowerCase().includes(entityValue)) {
          relatedEntities.push(edge.target);
        } else if (edge.target && edge.target.toLowerCase().includes(entityValue)) {
          relatedEntities.push(edge.source);
        }
      }
    }
    
    // Remove duplicates and limit results
    return [...new Set(relatedEntities)].slice(0, 5);
  }

  async saveContext(inputs, outputs) {
    try {
      console.log(`🔄 Mem0ChatMemory: saveContext called for session ${this.chatSessionId}, userId: ${this.userId}`);
      
      // Extract input and output content
      const inputContent = inputs[this.inputKey] || inputs.input || '';
      const outputContent = outputs[this.outputKey] || outputs.output || outputs.text || '';
      
      // Validate that content is not empty or whitespace-only
      const hasValidInput = inputContent && typeof inputContent === 'string' && inputContent.trim().length > 0;
      const hasValidOutput = outputContent && typeof outputContent === 'string' && outputContent.trim().length > 0;
      
      if (!hasValidInput || !hasValidOutput) {
        console.warn(`⚠️ Mem0ChatMemory: Invalid input or output content, skipping save`);
        console.warn(`  - inputContent: "${inputContent}" (valid: ${hasValidInput})`);
        console.warn(`  - outputContent: "${outputContent}" (valid: ${hasValidOutput})`);
        return;
      }
      
      // Add to internal buffer immediately for this session (ensure content is trimmed)
      const userMessage = new HumanMessage(inputContent.trim());
      const aiMessage = new AIMessage(outputContent.trim());
      
      this.chatHistory.push(userMessage);
      this.chatHistory.push(aiMessage);
      
      // Keep only the last k*2 messages in buffer (k exchanges)
      if (this.chatHistory.length > this.k * 2) {
        this.chatHistory = this.chatHistory.slice(-this.k * 2);
      }
      
      console.log(`✅ Mem0ChatMemory: Added conversation to internal buffer (${this.chatHistory.length} total messages)`);
      
      // 🚨 CRITICAL FIX: Wait for database save to complete before returning
      if (this.chatSessionId && this.userId) {
        console.log(`💾 Mem0ChatMemory: Starting database save for session ${this.chatSessionId}`);
        await this.saveToDatabase(inputContent, outputContent);
        console.log(`✅ Mem0ChatMemory: Database save completed for session ${this.chatSessionId}`);
      } else {
        console.error(`❌ Mem0ChatMemory: Cannot save to database - missing chatSessionId: ${this.chatSessionId} or userId: ${this.userId}`);
      }
      
    } catch (error) {
      console.error(`❌ Mem0ChatMemory: Error in saveContext:`, error);
      throw error; // Re-throw to let caller handle the error
    }
  }

  async saveToDatabase(userMessage, assistantResponse) {
    try {
      console.log(`💾 Mem0ChatMemory: Saving to database for session ${this.chatSessionId}, userId: ${this.userId}`);
      
      // Validate that we have a userId before saving
      if (!this.userId) {
        throw new Error(`Cannot save to database - userId is missing!`);
      }
      
      if (!this.chatSessionId) {
        throw new Error(`Cannot save to database - chatSessionId is missing!`);
      }
      
      // Save to chat message service
      const savedConversation = await chatMessageService.saveConversation({
        sessionId: this.chatSessionId,
        chatSessionId: this.chatSessionId,
        userId: this.userId,
        userMessage: userMessage,
        assistantResponse: assistantResponse,
        metadata: {
          source: 'langchain_memory',
          timestamp: new Date().toISOString()
        }
      });
      
      // Also update the chat session with the latest message
      const chatSessionService = require('./chatSessionService');
      await chatSessionService.updateChatSession(
        this.chatSessionId, 
        assistantResponse, 
        'assistant', 
        {
          source: 'langchain_memory',
          messageCount: 2 // User + Assistant message
        }
      );
      
      console.log(`✅ Mem0ChatMemory: Successfully saved conversation to database:`, {
        userMessageId: savedConversation.userMessage.messageId,
        assistantMessageId: savedConversation.assistantMessage.messageId,
        chatSessionId: this.chatSessionId
      });
      
      return savedConversation;
    } catch (error) {
      console.error(`❌ Mem0ChatMemory: Error saving to database:`, error);
      throw error; // Re-throw to let caller handle the error
    }
  }

  async clear() {
    // Clear the internal buffer
    this.chatHistory = [];
    console.log(`🧹 Mem0ChatMemory: Cleared internal buffer for session ${this.chatSessionId}`);
    
    // Wait for any pending saves to complete
    if (this.pendingSave) {
      try {
        await this.pendingSave;
      } catch (error) {
        console.warn(`⚠️ Mem0ChatMemory: Error waiting for pending save:`, error);
      }
      this.pendingSave = null;
    }
  }
  
  // Method to manually flush pending saves (useful for testing)
  async flushPendingSaves() {
    if (this.pendingSave) {
      try {
        await this.pendingSave;
        this.pendingSave = null;
        console.log(`✅ Mem0ChatMemory: Flushed pending saves`);
      } catch (error) {
        console.error(`❌ Mem0ChatMemory: Error flushing pending saves:`, error);
      }
    }
  }
}

module.exports = { Mem0ChatMemory };