const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const AIModelService = require('../services/aiModelService');
const gptAnalysisService = require('../services/gptAnalysisService');
const { GROQ_120B } = require('../config/aiRuntimeCatalog');
const memoryService = require('../services/memoryService');
const chatMessageService = require('../services/chatMessageService');
const AIToolExecutor = require('../services/aiToolExecutor');
const langchainAgentService = require('../services/langchainAgentService'); // Added for LangChain
const { Mem0ChatMemory } = require('../services/mem0LangchainWrapper'); // Added for LangChain memory
const { HumanMessage, AIMessage } = require('@langchain/core/messages'); // For constructing chat history
const chatSessionService = require('../services/chatSessionService'); // Added for chat session logic

// Create the shared AI model service and tool executor.
const aiModelService = new AIModelService();
const aiToolExecutor = new AIToolExecutor();

/**
 * AI failures answer with the runtime error's own status and code — a 409
 * "connect your ChatGPT account" is a user action, not a server fault, and
 * the frontend runtime gate routes on the code.
 */
function sendAIFailure(res, failure, msg) {
  return res.status(failure?.statusCode || 500).json({
    msg,
    code: failure?.code,
    error: failure?.error || failure?.message
  });
}

// Generate job description using AI
exports.generateJobDescription = async (req, res) => {
  try {
    const { title, department, level, location, type, experience, education } = req.body;

    // Validate required fields
    if (!title || !department) {
      return res.status(400).json({
        msg: 'Job title and department are required for AI generation',
        error: 'Missing required fields'
      });
    }

    console.log(`🤖 Generating job description for: ${title} in ${department}`);

    const jobData = {
      title,
      department,
      level: level || 'Mid',
      location: location || 'Not specified',
      type: type || 'Full-time',
      experience: experience || '1-3',
      education: education || 'Bachelor'
    };

    const result = await aiModelService.generateJobDescription(jobData);

    if (!result.success) {
      return sendAIFailure(res, result, 'Failed to generate job description');
    }

    console.log(`✅ Job description generated successfully for: ${title}`);

    res.json({
      msg: 'Job description generated successfully',
      description: result.description,
      responsibilities: result.responsibilities,
      requirements: result.requirements,
      skills: result.skills,
      benefits: result.benefits
    });

  } catch (error) {
    console.error('❌ Error generating job description:', error);
    sendAIFailure(res, error, 'Server error generating job description');
  }
};

// Generate job requirements using AI
exports.generateJobRequirements = async (req, res) => {
  try {
    const { title, department, level, type, experience, education } = req.body;

    // Validate required fields
    if (!title || !department) {
      return res.status(400).json({
        msg: 'Job title and department are required for AI generation',
        error: 'Missing required fields'
      });
    }

    console.log(`🤖 Generating job requirements for: ${title} in ${department}`);

    const jobData = {
      title,
      department,
      level: level || 'Mid',
      type: type || 'Full-time',
      experience: experience || '1-3',
      education: education || 'Bachelor'
    };

    const result = await aiModelService.generateJobRequirements(jobData);

    if (!result.success) {
      return sendAIFailure(res, result, 'Failed to generate job requirements');
    }

    console.log(`✅ Job requirements generated successfully for: ${title}`);

    res.json({
      msg: 'Job requirements generated successfully',
      requirements: result.requirements
    });

  } catch (error) {
    console.error('❌ Error generating job requirements:', error);
    sendAIFailure(res, error, 'Server error generating job requirements');
  }
};

// Get available AI tools
exports.getAvailableTools = async (req, res) => {
  try {
    const availableTools = aiToolExecutor.getAvailableToolsList();
    
    res.json({
      msg: 'Available AI tools retrieved successfully',
      tools: availableTools,
      count: availableTools.length
    });
    
  } catch (error) {
    console.error('❌ Error getting available tools:', error);
    res.status(500).json({
      msg: 'Server error getting available tools',
      error: error.message
    });
  }
};

// Test a specific AI tool
exports.testTool = async (req, res) => {
  try {
    const { toolName, parameters = {} } = req.body;
    
    if (!toolName) {
      return res.status(400).json({
        msg: 'Tool name is required',
        error: 'No tool name provided'
      });
    }

    // Get auth token for API calls
    const authToken = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');
    
    const result = await aiToolExecutor.testTool(toolName, parameters, authToken);
    
    if (result.success) {
      res.json({
        msg: `Tool '${toolName}' executed successfully`,
        result: result.result
      });
    } else {
      res.status(400).json({
        msg: `Tool '${toolName}' execution failed`,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Error testing tool:', error);
    res.status(500).json({
      msg: 'Server error testing tool',
      error: error.message
    });
  }
};

// Public chat endpoint for testing (no auth required)
exports.chatPublic = async (req, res) => {
  try {
    const { message, context = {} } = req.body;
    
    if (!message) {
      return res.status(400).json({
        msg: 'Message is required',
        error: 'No message provided'
      });
    }

    console.log('🧪 Public test chat request:', message);

    // Create mock session for testing
    const mockContext = {
      sessionId: 'test_session',
      userId: 'test_user',
      chatSessionId: null,
      conversationHistory: '',
      userContext: null,
      userPersonality: null,
      requestContext: context
    };

    // Use AI Tool Executor to process the message (no auth token for testing)
    const aiResult = await aiToolExecutor.processMessage(message, mockContext, null);
    
    if (!aiResult.success) {
      return sendAIFailure(res, aiResult, 'Failed to process request with AI tools');
    }

    // 🚀 IMMEDIATE RESPONSE TO FRONTEND (Public Test Mode)
    const responseData = {
      message: aiResult.message,
      metadata: {
        confidence: aiResult.confidence,
        processingTime: aiResult.processingTime,
        toolsUsed: aiResult.toolsUsed || [],
        toolResults: aiResult.toolResults || [],
        dataUsed: aiResult.toolsUsed?.length > 0 ? 'real_data_via_tools' : 'general',
        testMode: true
      }
    };

    // Send response immediately
    res.json(responseData);

    console.log('✅ Public test chat completed immediately');

  } catch (error) {
    console.error('❌ Error in public chat:', error);
    sendAIFailure(res, error, 'Server error processing public chat');
  }
};

// Public tools endpoint for testing (no auth required)
exports.getAvailableToolsPublic = async (req, res) => {
  try {
    const availableTools = aiToolExecutor.getAvailableToolsList();
    
    res.json({
      msg: 'Available AI tools retrieved successfully (public test mode)',
      tools: availableTools,
      count: availableTools.length,
      testMode: true
    });
    
  } catch (error) {
    console.error('❌ Error getting available tools (public):', error);
    res.status(500).json({
      msg: 'Server error getting available tools',
      error: error.message
    });
  }
};

// Get conversation history endpoint
exports.getChatHistory = async (req, res) => {
  try {
    // Use only authenticated user ID from JWT
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;

    console.log(`📚 Getting chat history for: ${userId}`);

    // Get memories for current session
    let memories = await memoryService.getMemories(userId, limit);
    
    // If no memories found for current session, try to find recent memories
    if (memories.length === 0) {
      console.log(`ℹ️ No memories found for ${userId}, trying to find recent conversations...`);
      
      try {
        const memoryUsers = await memoryService.client.users();
        console.log(`Found ${memoryUsers.results?.length || 0} users with memories`);
        
        // Look for recent session-based users
        const recentSessionUsers = memoryUsers.results?.filter(user => 
          user.name.startsWith('sess_') && 
          Date.now() - parseInt(user.name.split('_')[1]) < 24 * 60 * 60 * 1000 // Within last 24 hours
        ).sort((a, b) => {
          const timeA = parseInt(a.name.split('_')[1]);
          const timeB = parseInt(b.name.split('_')[1]);
          return timeB - timeA; // Most recent first
        }) || [];
        
        console.log(`Found ${recentSessionUsers.length} recent session users`);
        
        // Get memories from the most recent sessions
        for (const user of recentSessionUsers.slice(0, 5)) { // Check up to 5 recent sessions
          const userMemories = await memoryService.getMemories(user.name, 10);
          if (userMemories.length > 0) {
            memories = memories.concat(userMemories);
            console.log(`Added ${userMemories.length} memories from ${user.name}`);
          }
        }
        
        // Sort by timestamp and limit
        memories = memories.sort((a, b) => {
          const timeA = new Date(a.metadata?.timestamp || a.created_at);
          const timeB = new Date(b.metadata?.timestamp || b.created_at);
          return timeB - timeA;
        }).slice(0, limit);
        
      } catch (error) {
        console.error('❌ Error finding recent memories:', error);
      }
    }

    // Convert memories to chat history format
    // Group memories by conversation (same timestamp) and reconstruct conversations
    const conversationMap = new Map();
    
    memories.forEach(memory => {
      const timestamp = memory.metadata?.timestamp || memory.created_at;
      const intent = memory.metadata?.intent || 'general';
      const memoryText = memory.memory || memory.text || '';
      
      // Create a conversation key based on timestamp (group memories from same conversation)
      const timeKey = new Date(timestamp).toISOString().substring(0, 16); // Group by minute
      
      if (!conversationMap.has(timeKey)) {
        conversationMap.set(timeKey, {
          id: memory.id,
          timestamp: timestamp,
          memories: [],
          intent: intent,
          userId: memory.user_id
        });
      }
      
      conversationMap.get(timeKey).memories.push(memoryText);
    });

    // Convert to chat history format expected by frontend
    const chatHistory = Array.from(conversationMap.values()).map(conversation => {
      // Create the conversation summary as a single message exchange
      const conversationSummary = conversation.memories.join(' ');
      const conversationTitle = `Conversation about ${conversation.intent.toLowerCase().replace('_', ' ')}`;
      
      // Format as messages array that frontend expects
      return {
        id: conversation.id,
        timestamp: conversation.timestamp,
        messages: [
          {
            role: 'user',
            content: `Previous conversation: ${conversationTitle}`
          },
          {
            role: 'assistant', 
            content: conversationSummary
          }
        ],
        userId: conversation.userId,
        metadata: {
          intent: conversation.intent,
          memoryCount: conversation.memories.length,
          type: 'conversation_summary'
        }
      };
    });

    // Sort by timestamp (most recent first)
    chatHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`📝 Returning ${chatHistory.length} conversation summaries for ${userIdentifier}`);

    res.json({
      history: chatHistory,
      userId: userIdentifier,
      totalCount: chatHistory.length,
      note: chatHistory.length > 0 && chatHistory[0].userId !== userIdentifier ? 
        'Showing recent conversations from multiple sessions due to session management' : null
    });

  } catch (error) {
    console.error('❌ Error getting chat history:', error);
    res.status(500).json({
      msg: 'Server error getting chat history',
      error: error.message
    });
  }
};

// Clear chat history endpoint
exports.clearChatHistory = async (req, res) => {
  try {
    // Use session from middleware
    const sessionId = req.session?.sessionId;
    const userId = req.session?.userId;
    const userIdentifier = userId || sessionId || 'anonymous';

    if (!sessionId) {
      return res.status(400).json({
        msg: 'Valid session required',
        error: 'Please refresh your browser to establish a session'
      });
    }

    const success = await memoryService.deleteAllMemories(userIdentifier);

    if (success) {
      res.json({
        msg: 'Chat history cleared successfully',
        userId: userIdentifier
      });
    } else {
      res.status(500).json({
        msg: 'Failed to clear chat history'
      });
    }

  } catch (error) {
    console.error('❌ Error clearing chat history:', error);
    res.status(500).json({
      msg: 'Server error clearing chat history',
      error: error.message
    });
  }
};

// Search chat history endpoint
exports.searchChatHistory = async (req, res) => {
  try {
    const { userId, sessionId, query } = req.query;
    const userIdentifier = userId || sessionId || req.ip || 'anonymous';
    const limit = parseInt(req.query.limit) || 10;

    if (!query) {
      return res.status(400).json({
        msg: 'Search query is required'
      });
    }

    // Use enhanced search with Graph Memory
    const results = await memoryService.searchMemories(
      userIdentifier, 
      query, 
      limit,
      {
        // Enable graph-based search for better results
        use_graph: true,
        include_related: true,
        graph_depth: 2,
        include_metadata: true
      }
    );
    
    // Format search results
    const searchResults = results.map(result => ({
      id: result.id,
      timestamp: result.metadata?.timestamp || result.created_at,
      content: result.memory || result.text || 'No content',
      metadata: result.metadata || {},
      relevance: result.score || 0,
      type: result.metadata?.conversationType || 'message',
      // Include graph-related information if available
      entities: result.metadata?.entities || [],
      relationships: result.metadata?.relationships || [],
      graphEnabled: result.metadata?.graphEnabled || false
    }));

    // If graph search found related memories, include them
    const relatedMemories = results.related_memories || [];
    const formattedRelated = relatedMemories.map(result => ({
      id: result.id,
      content: result.memory || result.text || 'No content',
      relationship: result.relationship_type || 'related',
      relevance: result.score || 0
    }));

    res.json({
      results: searchResults,
      relatedMemories: formattedRelated,
      query: query,
      totalCount: searchResults.length,
      graphSearchEnabled: true
    });

  } catch (error) {
    console.error('❌ Error searching chat history:', error);
    res.status(500).json({
      msg: 'Server error searching chat history',
      error: error.message
    });
  }
};

// Intent Analysis Function
async function analyzeUserIntent(message) {
  const messageLower = message.toLowerCase();
  
  // Define intent patterns
  const patterns = {
    QUERY_CANDIDATES: [
      /list.*candidates?/i,
      /show.*candidates?/i,
      /who.*candidates?/i,
      /candidates?.*names?/i,
      /view.*candidates?/i,
      /all.*candidates?/i
    ],
    
    QUERY_JOBS: [
      /list.*jobs?/i,
      /show.*jobs?/i,
      /view.*jobs?/i,
      /all.*jobs?/i,
      /open.*positions?/i,
      /available.*roles?/i
    ],
    
    ACTION_CREATE: [
      /create.*job/i,
      /add.*job/i,
      /new.*job/i,
      /post.*job/i,
      /upload.*candidate/i,
      /add.*candidate/i,
      /create.*candidate/i,
      /new.*candidate/i
    ],
    
    COMPARISON_ANALYSIS: [
      /best.*(?:manager|developer|engineer|analyst|designer)/i,
      /top.*(?:manager|developer|engineer|analyst|designer)/i,
      /who.*best/i,
      /find.*best/i,
      /compare.*candidates?/i,
      /rank.*candidates?/i
    ],
    
    MATCHING_REQUEST: [
      /match.*candidates?/i,
      /find.*candidates?.*for/i,
      /candidates?.*for.*job/i,
      /suitable.*candidates?/i,
      /recommend.*candidates?/i
    ],
    
    ANALYTICS_REQUEST: [
      /analyz/i,
      /report/i,
      /insights?/i,
      /metrics/i,
      /statistics/i,
      /dashboard/i,
      /overview/i
    ]
  };
  
  // Check patterns
  for (const [category, regexList] of Object.entries(patterns)) {
    if (regexList.some(regex => regex.test(message))) {
      return {
        category,
        confidence: 0.9,
        extractedEntities: extractEntities(message, category)
      };
    }
  }
  
  return {
    category: 'GENERAL',
    confidence: 0.5,
    extractedEntities: {}
  };
}

// Extract entities from message
function extractEntities(message, category) {
  const entities = {};
  const messageLower = message.toLowerCase();
  
  // Extract job roles/positions
  const jobRoles = [
    'product manager', 'software engineer', 'developer', 'designer', 
    'analyst', 'manager', 'director', 'lead', 'senior', 'junior',
    'frontend', 'backend', 'fullstack', 'devops', 'qa', 'tester',
    'marketing', 'sales', 'hr', 'finance', 'operations'
  ];
  
  entities.roles = jobRoles.filter(role => messageLower.includes(role));
  
  // Extract skills/technologies
  const skills = [
    'javascript', 'python', 'java', 'react', 'node', 'angular', 
    'vue', 'sql', 'mongodb', 'aws', 'azure', 'docker', 'kubernetes',
    'agile', 'scrum', 'git', 'ci/cd'
  ];
  
  entities.skills = skills.filter(skill => messageLower.includes(skill));
  
  // Extract action type
  if (category === 'ACTION_CREATE') {
    entities.actionType = messageLower.includes('job') ? 'job' : 'candidate';
  }
  
  return entities;
}

// Handle candidate queries - with organization filtering
async function handleCandidateQuery(message, intentAnalysis, userContext = {}) {
  const messageLower = message.toLowerCase();
  
  // Ensure organization context is available
  const organizationId = userContext.organizationId || userContext.currentOrganization;
  if (!organizationId) {
    throw new Error('Organization context is required for accessing candidates');
  }
  
  console.log(`🔒 Querying candidates for organization: ${organizationId}`);
  const candidates = await Candidate.find({ organizationId }).limit(100);
  const totalCount = await Candidate.countDocuments({ organizationId });
  
  let dataContext = `REAL DATA FROM SYSTEM:\n\nTotal Candidates: ${totalCount}\n`;
  let actions = [];
  
  if (messageLower.includes('names') || messageLower.includes('list') || messageLower.includes('all')) {
    // List all candidates with full details
    dataContext += `\nDetailed Candidate List:\n${candidates.map((c, i) => {
      const aiSummary = c.aiAnalysis?.summary ? ` - ${c.aiAnalysis.summary.substring(0, 60)}...` : '';
      const skills = c.skills ? c.skills.substring(0, 100) : 'Not specified';
      const education = c.education || 'Not specified';
      const location = c.location || 'Not specified';
      
      return `${i+1}. ${c.firstName} ${c.lastName}
   - Position: ${c.position || 'Position not specified'}
   - Experience: ${c.experience || 'Not specified'}
   - Education: ${education}
   - Location: ${location}
   - Skills: ${skills}${skills.length > 100 ? '...' : ''}
   - Status: ${c.status || 'New'}
   - Email: ${c.email}
   - Phone: ${c.phone || 'Not provided'}
   ${c.isEmbedded ? '- ✅ AI Embeddings Ready' : '- ⚠️ No AI Embeddings'}
   ${aiSummary ? `- AI Analysis: ${aiSummary}` : ''}
   ${c.lastViewed ? `- Last Viewed: ${new Date(c.lastViewed).toLocaleDateString()}` : ''}`;
    }).join('\n\n')}`;
    
    // Status distribution
    const statusDist = candidates.reduce((acc, c) => {
      acc[c.status || 'New'] = (acc[c.status || 'New'] || 0) + 1;
      return acc;
    }, {});
    
    dataContext += `\n\nCandidate Status Distribution:\n${Object.entries(statusDist).map(([status, count]) => `${status}: ${count}`).join(', ')}`;
    
    // Position distribution
    const positionDist = candidates.reduce((acc, c) => {
      if (c.position) {
        acc[c.position] = (acc[c.position] || 0) + 1;
      }
      return acc;
    }, {});
    
    dataContext += `\n\nTop Positions:\n${Object.entries(positionDist)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([pos, count]) => `${pos}: ${count}`)
      .join(', ')}`;
    
    actions.push({
      label: 'View All Candidates',
      icon: 'users',
      action: 'navigate',
      data: { url: '/candidates' }
    });
    
    actions.push({
      label: 'Analyze Candidate Pool',
      icon: 'bar-chart',
      action: 'api',
      data: { endpoint: '/api/ai/analyze-candidates' }
    });
  }
  
  return { dataContext, actions };
}

// Handle job queries - with organization filtering
async function handleJobQuery(message, intentAnalysis, userContext = {}) {
  // Ensure organization context is available
  const organizationId = userContext.organizationId || userContext.currentOrganization;
  if (!organizationId) {
    throw new Error('Organization context is required for accessing jobs');
  }
  
  console.log(`🔒 Querying jobs for organization: ${organizationId}`);
  const jobs = await Job.find({ organizationId });
  const openJobs = jobs.filter(j => j.status === 'active');
  
  let dataContext = `REAL DATA FROM SYSTEM:\n\nTotal Jobs: ${jobs.length}\nActive/Open Positions: ${openJobs.length}\n`;
  let actions = [];
  
  dataContext += `\nJob Listings:\n${jobs.map((j, i) => {
    const salaryInfo = j.salary?.min && j.salary?.max 
      ? `${j.salary.currency} ${j.salary.min.toLocaleString()}-${j.salary.max.toLocaleString()} ${j.salary.period}`
      : 'Competitive';
    
    return `${i+1}. ${j.title} - ${j.department}
   - Status: ${j.status}
   - Type: ${j.type}
   - Level: ${j.level}
   - Location: ${j.location}${j.remote ? ' (Remote Available)' : ''}
   - Experience: ${j.experience} years
   - Education: ${j.education}
   - Salary: ${salaryInfo}
   - Openings: ${j.openings || 1} position(s)
   - Applicants: ${j.applicants?.length || 0}
   - Created: ${new Date(j.createdAt).toLocaleDateString()}
   ${j.applicationDeadline ? `- Deadline: ${new Date(j.applicationDeadline).toLocaleDateString()}` : ''}
   ${j.isEmbedded ? '- ✅ AI Embeddings Ready' : '- ⚠️ No AI Embeddings'}`;
  }).join('\n\n')}`;
  
  // Department distribution
  const deptDist = jobs.reduce((acc, j) => {
    acc[j.department] = (acc[j.department] || 0) + 1;
    return acc;
  }, {});
  
  dataContext += `\n\nDepartment Distribution:\n${Object.entries(deptDist).map(([dept, count]) => `${dept}: ${count}`).join(', ')}`;
  
  // Status distribution
  const statusDist = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});
  
  dataContext += `\n\nStatus Distribution:\n${Object.entries(statusDist).map(([status, count]) => `${status}: ${count}`).join(', ')}`;
  
  actions.push({
    label: 'View All Jobs',
    icon: 'briefcase',
    action: 'navigate',
    data: { url: '/jobs' }
  });
  
  actions.push({
    label: 'Analyze Job Market',
    icon: 'bar-chart',
    action: 'api',
    data: { endpoint: '/api/ai/analyze-jobs' }
  });
  
  return { dataContext, actions };
}

// Handle create actions
async function handleCreateAction(message, intentAnalysis) {
  const actionType = intentAnalysis.extractedEntities.actionType;
  let dataContext = '';
  let actions = [];
  
  if (actionType === 'job') {
    dataContext = 'ACTION DETECTED: User wants to create a new job posting.';
    actions.push({
      label: 'Create New Job',
      icon: 'plus',
      action: 'navigate',
      data: { url: '/jobs/new' }
    });
    
    actions.push({
      label: 'Use AI Job Generator',
      icon: 'sparkles',
      action: 'navigate',
      data: { url: '/jobs/new?ai=true' }
    });
  } else if (actionType === 'candidate') {
    dataContext = 'ACTION DETECTED: User wants to add a new candidate.';
    actions.push({
      label: 'Upload Candidate Resume',
      icon: 'upload',
      action: 'navigate',
      data: { url: '/candidates/new' }
    });
    
    actions.push({
      label: 'Manual Candidate Entry',
      icon: 'user-plus',
      action: 'navigate',
      data: { url: '/candidates/new?manual=true' }
    });
  }
  
  return { dataContext, actions };
}

// Handle comparison queries
async function handleComparisonQuery(message, intentAnalysis) {
  const roles = intentAnalysis.extractedEntities.roles;
  const messageLower = message.toLowerCase();
  
  let dataContext = '';
  let actions = [];
  
  // Find candidates matching the role
  const candidates = await Candidate.find();
  let matchingCandidates = [];
  
  if (roles.length > 0) {
    const targetRole = roles[0];
    matchingCandidates = candidates.filter(c => 
      c.position && c.position.toLowerCase().includes(targetRole.toLowerCase())
    );
    
    if (matchingCandidates.length > 0) {
      // Score and rank candidates
      const rankedCandidates = matchingCandidates.map(candidate => {
        let score = 0;
        const experience = parseInt(candidate.experience) || 0;
        score += experience * 10;
        
        // Skill matching
        const skills = typeof candidate.skills === 'string' ? candidate.skills.toLowerCase() : '';
        const roleKeywords = targetRole.split(' ');
        roleKeywords.forEach(keyword => {
          if (skills.includes(keyword)) score += 15;
        });
        
        // AI analysis bonus
        if (candidate.aiAnalysis && candidate.aiAnalysis.strengths) {
          score += candidate.aiAnalysis.strengths.length * 5;
        }
        
        return { ...candidate.toObject(), score };
      }).sort((a, b) => b.score - a.score);
      
      const topCandidate = rankedCandidates[0];
      
      dataContext = `REAL DATA FROM SYSTEM:\n\nBest ${targetRole.toUpperCase()} Candidate Analysis:\n\n`;
      dataContext += `🏆 TOP MATCH: ${topCandidate.firstName} ${topCandidate.lastName}\n`;
      dataContext += `- Position: ${topCandidate.position}\n`;
      dataContext += `- Experience: ${topCandidate.experience} years\n`;
      dataContext += `- Skills: ${topCandidate.skills}\n`;
      dataContext += `- Score: ${topCandidate.score}/100\n`;
      dataContext += `- Status: ${topCandidate.status}\n`;
      
      if (topCandidate.aiAnalysis) {
        dataContext += `- AI Summary: ${topCandidate.aiAnalysis.summary || 'Not available'}\n`;
        dataContext += `- Strengths: ${topCandidate.aiAnalysis.strengths ? topCandidate.aiAnalysis.strengths.join(', ') : 'Not analyzed'}\n`;
      }
      
      dataContext += `\nOther ${targetRole} candidates found: ${rankedCandidates.length}\n`;
      dataContext += rankedCandidates.slice(1, 4).map((c, i) => 
        `${i+2}. ${c.firstName} ${c.lastName} - Score: ${c.score}`
      ).join('\n');
      
      actions.push({
        label: `View ${topCandidate.firstName} ${topCandidate.lastName}`,
        icon: 'user',
        action: 'navigate',
        data: { url: `/candidates/${topCandidate._id}` }
      });
      
      if (rankedCandidates.length > 1) {
        actions.push({
          label: `Compare All ${targetRole}s`,
          icon: 'users',
          action: 'navigate',
          data: { url: `/candidates?search=${encodeURIComponent(targetRole)}` }
        });
      }
    } else {
      // No candidates found for this role
      dataContext = `REAL DATA FROM SYSTEM:\n\nNo ${targetRole} candidates found in the system.\n\n`;
      dataContext += `Suggestion: You may want to create a job posting for this role to attract candidates.`;
      
      actions.push({
        label: `Create ${targetRole} Job Posting`,
        icon: 'plus',
        action: 'navigate',
        data: { url: `/jobs/new?title=${encodeURIComponent(targetRole)}` }
      });
      
      actions.push({
        label: 'Search External Job Boards',
        icon: 'search',
        action: 'external',
        data: { url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(targetRole)}` }
      });
    }
  }
  
  return { dataContext, actions };
}

// Handle matching requests
async function handleMatchingRequest(message, intentAnalysis) {
  const jobs = await Job.find({ status: 'active' });
  let dataContext = '';
  let actions = [];
  
  if (jobs.length > 0) {
    dataContext = `REAL DATA FROM SYSTEM:\n\nAvailable Open Positions for Candidate Matching:\n\n`;
    dataContext += jobs.map((j, i) => 
      `${i+1}. ${j.title} - ${j.department} (${j.location || 'Remote'})`
    ).join('\n');
    
    jobs.forEach(job => {
      actions.push({
        label: `Find Candidates for ${job.title}`,
        icon: 'search',
        action: 'api',
        data: { endpoint: `/api/ai/matching-report/${job._id}` }
      });
    });
  } else {
    dataContext = 'REAL DATA FROM SYSTEM:\n\nNo open job positions available for matching.\n\n';
    dataContext += 'Suggestion: Create job postings first to enable candidate matching.';
    
    actions.push({
      label: 'Create New Job Posting',
      icon: 'plus',
      action: 'navigate',
      data: { url: '/jobs/new' }
    });
  }
  
  return { dataContext, actions };
}

// Handle analytics requests
async function handleAnalyticsRequest(message, intentAnalysis) {
  const dataContext = 'ANALYTICS REQUEST: Preparing comprehensive system analysis...';
  const actions = [
    {
      label: 'Hiring Analytics Dashboard',
      icon: 'bar-chart',
      action: 'api',
      data: { endpoint: '/api/ai/hiring-analytics' }
    },
    {
      label: 'Candidate Pool Analysis',
      icon: 'users',
      action: 'api',
      data: { endpoint: '/api/ai/analyze-candidates' }
    },
    {
      label: 'Job Market Analysis',
      icon: 'briefcase',
      action: 'api',
      data: { endpoint: '/api/ai/analyze-jobs' }
    }
  ];
  
  return { dataContext, actions };
}

// Get system overview
async function getSystemOverview() {
  const candidateCount = await Candidate.countDocuments();
  const jobCount = await Job.countDocuments();
  const activeJobs = await Job.countDocuments({ status: 'active' });
  
  return `SYSTEM OVERVIEW:\n- Total Candidates: ${candidateCount}\n- Total Jobs: ${jobCount}\n- Active Openings: ${activeJobs}`;
}

// Get default actions
function getDefaultActions() {
  return [
    {
      label: 'View Candidates',
      icon: 'users',
      action: 'navigate',
      data: { url: '/candidates' }
    },
    {
      label: 'View Jobs',
      icon: 'briefcase',
      action: 'navigate',
      data: { url: '/jobs' }
    },
    {
      label: 'System Analytics',
      icon: 'bar-chart',
      action: 'api',
      data: { endpoint: '/api/ai/hiring-analytics' }
    }
  ];
}

// Build system context with semantic understanding and conversation history
async function buildSystemContextWithHistory(dataContext, intentAnalysis, conversationHistory, userContext, userPersonality = null) {
  const candidateCount = await Candidate.countDocuments();
  const jobCount = await Job.countDocuments();
  const activeJobs = await Job.countDocuments({ status: 'active' });
  
  let contextString = 'You are SMART HR Assistant, an AI-powered HR management system assistant.\n\nCurrent System Status:\n- Total Candidates: ' + candidateCount + '\n- Total Jobs: ' + jobCount + '\n- Active Job Openings: ' + activeJobs + '\n\nCurrent Query Analysis:\n- Intent: ' + intentAnalysis.category + '\n- Confidence: ' + intentAnalysis.confidence + '\n- Extracted Entities: ' + JSON.stringify(intentAnalysis.extractedEntities || {});

  // Add enhanced user context with semantic understanding
  if (userContext && userContext.totalInteractions > 0) {
    contextString += '\n\nUser Profile & Preferences:\n- Experience Level: ' + (userContext.knowledgeLevel || 'unknown') + ' knowledge level\n- Communication Style: ' + (userContext.communicationStyle || 'unknown') + ' communication preference\n- Interaction History: ' + userContext.totalInteractions + ' previous interactions\n- Last Active: ' + (userContext.lastInteraction ? new Date(userContext.lastInteraction).toLocaleString() : 'Unknown');
  }

  // Add AI-driven personality profile
  if (userPersonality && userPersonality.totalInsights > 0) {
    contextString += '\n\nAI-Derived Personality Profile:';
    
    if (userPersonality.name) {
      contextString += '\n- Name: ' + userPersonality.name;
    }
    
    if (userPersonality.title) {
      contextString += '\n- Title/Role: ' + userPersonality.title;
    }
    
    if (userPersonality.company) {
      contextString += '\n- Company: ' + userPersonality.company;
    }
    
    contextString += '\n- Expertise Level: ' + userPersonality.expertiseLevel + '\n- Communication Preference: ' + userPersonality.communicationStyle;
    
    if (userPersonality.domainKnowledge.length > 0) {
      contextString += '\n- Technical Knowledge: ' + userPersonality.domainKnowledge.slice(0, 5).join(', ');
    }
    
    if (userPersonality.behaviorPatterns.length > 0) {
      contextString += '\n- Behavior Patterns: ' + userPersonality.behaviorPatterns.slice(0, 2).join('; ');
    }
    
    if (userPersonality.preferences.length > 0) {
      contextString += '\n- User Preferences: ' + userPersonality.preferences.slice(0, 2).join('; ');
    }
    
    contextString += '\n- Profile Confidence: ' + userPersonality.totalInsights + ' insights analyzed';
  }

  // Add behavioral patterns if userContext exists
  if (userContext && userContext.totalInteractions > 0) {
    if (userContext.intentPatterns && userContext.intentPatterns.length > 0) {
      const intents = userContext.intentPatterns.map(p => p.intent + ' (' + p.frequency + 'x)').join(', ');
      contextString += '\n- Common Intents: ' + intents;
    }

    // Add preferences
    if (userContext.preferences && Object.keys(userContext.preferences).length > 0) {
      const topPreferences = Object.entries(userContext.preferences)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([pref, count]) => pref + ' (' + count + 'x)')
        .join(', ');
      contextString += '\n- Preferred Actions: ' + topPreferences;
    }

    // Add domain expertise
    if (userContext.domainExpertise && Object.keys(userContext.domainExpertise).length > 0) {
      const domains = Object.entries(userContext.domainExpertise)
        .map(([domain, data]) => domain + ' (' + data.entityCount + ' concepts)')
        .join(', ');
      contextString += '\n- Domain Understanding: ' + domains;
    }

    // Add success patterns
    if (userContext.successPatterns && userContext.successPatterns.length > 0) {
      const successfulApproaches = userContext.successPatterns
        .filter(p => p.confidence > 0.7)
        .map(p => p.approach)
        .join(', ');
      if (successfulApproaches) {
        contextString += '\n- Effective Approaches: ' + successfulApproaches;
      }
    }

    // Add time patterns
    if (userContext.timePatterns && Object.keys(userContext.timePatterns).length > 0) {
      const timePrefs = Object.entries(userContext.timePatterns)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 2)
        .map(([time, count]) => time + ' (' + count + 'x)')
        .join(', ');
      contextString += '\n- Usage Patterns: Usually active ' + timePrefs;
    }
  }

  // Add conversation history if available
  if (conversationHistory && conversationHistory.length > 0) {
    contextString += '\n\nRecent Conversation Context:\n' + conversationHistory;
  }

  contextString += '\n\n' + dataContext + '\n\n🚨 CRITICAL: NEVER GENERATE FAKE DATA 🚨\n- You have been provided with REAL DATA from the system above\n- Use ONLY the actual candidate names, positions, emails, and details listed above\n- If no candidates are listed in the "REAL DATA FROM SYSTEM" section, say "No candidates found"\n- NEVER invent or generate example names like "John Smith", "Sarah Johnson", "Adebayo Smith", etc.\n- NEVER create fictional emails, phone numbers, or positions\n- ALWAYS reference the exact data provided in the system context\n\nRESPONSE FORMATTING GUIDELINES:\n- Use **bold** for important terms, names, and key metrics\n- Use *italics* for emphasis and highlights\n- Use bullet points (-) for lists and options\n- Use numbered lists (1.) for step-by-step instructions\n- Use `code blocks` for IDs, technical terms, or specific values\n- Use > blockquotes for important notes, tips, or warnings\n- Use tables when presenting structured data or comparisons\n- Use ## headings for major sections\n- Use ### subheadings for subsections\n- Format responses for easy scanning and readability\n\nADAPTATION INSTRUCTIONS:\n- Adjust response complexity to match user\'s ' + (userContext?.knowledgeLevel || 'unknown') + ' knowledge level\n- Use ' + (userContext?.communicationStyle || 'professional') + ' communication style\n- Reference user\'s preferred actions when suggesting next steps\n- Leverage user\'s domain understanding when explaining concepts\n- Build on successful interaction patterns from their history\n\nIMPORTANT PERSONALITY INFORMATION:\nWhen the user asks about themselves (their name, role, company, preferences, etc.), ALWAYS check the "AI-Derived Personality Profile" section above FIRST. If their name, title, company, or other personal information is listed there, use it in your response. For example:\n- If the user asks "What\'s my name?" and the profile shows "Name: Tony", respond with "Your name is Tony."\n- If the user asks "What do you know about me?" reference ALL the information in their personality profile.\n- NEVER say you don\'t have information if it\'s listed in the personality profile above.\n\nIMPORTANT: Use the REAL DATA above to provide specific, accurate responses. When you have actual names, numbers, and details, use them in your response. Be helpful and actionable.\n\nPersonalize your response based on the user\'s profile and previous interactions. If they\'re an advanced user, provide more technical details. If they prefer direct communication, be concise. If they typically work with data analysis, emphasize analytical insights.\n\nAvailable capabilities:\n- Query and analyze candidates/jobs with real data\n- Create job postings and add candidates\n- Compare and rank candidates intelligently\n- Match candidates to jobs using AI embeddings\n- Generate comprehensive analytics and reports\n- Adapt responses based on user expertise and preferences\n- Remember and leverage user behavioral patterns\n\nAlways provide specific, data-driven responses tailored to the user\'s expertise level and communication preferences.';

  return contextString;
}

// Analyze all candidates and provide insights
exports.analyzeCandidates = async (req, res) => {
  try {
    const candidates = await Candidate.find().limit(50); // Analyze top 50 candidates
    const totalCandidates = await Candidate.countDocuments();
    
    // Group candidates by various criteria
    const byStatus = await Candidate.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    const byPosition = await Candidate.aggregate([
      { $group: { _id: "$position", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Extract top skills
    const skillsArray = candidates.flatMap(c => 
      typeof c.skills === 'string' ? c.skills.split(',').map(s => s.trim()) : []
    );
    const skillCounts = skillsArray.reduce((acc, skill) => {
      acc[skill] = (acc[skill] || 0) + 1;
      return acc;
    }, {});
    const topSkills = Object.entries(skillCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Generate AI insights
    const prompt = `Analyze this candidate pool data:
    - Total candidates: ${totalCandidates}
    - Status distribution: ${JSON.stringify(byStatus)}
    - Top positions: ${JSON.stringify(byPosition.slice(0, 5))}
    - Top skills: ${JSON.stringify(topSkills.slice(0, 5))}
    
    Provide insights about:
    1. Overall quality of the candidate pool
    2. Skill gaps that might exist
    3. Recommendations for improving recruitment
    4. Key trends or patterns`;

    const aiResult = await aiModelService.generateChatResponse(prompt, '', { activity: 'analytics.candidates' });
    if (!aiResult.success) {
      return sendAIFailure(res, aiResult, 'AI candidate analytics are unavailable');
    }

    res.json({
      totalCandidates,
      statusDistribution: byStatus,
      topPositions: byPosition,
      topSkills,
      insights: aiResult.response,
      recommendations: [
        "Focus on candidates with in-demand skills",
        "Consider expanding recruitment channels",
        "Review and update job requirements"
      ]
    });

  } catch (error) {
    console.error('❌ Error analyzing candidates:', error);
    sendAIFailure(res, error, 'Server error analyzing candidates');
  }
};

// Analyze all jobs and provide insights
exports.analyzeJobs = async (req, res) => {
  try {
    const jobs = await Job.find();
    const totalJobs = jobs.length;
    const activeJobs = jobs.filter(j => j.status === 'active').length;
    
    // Group jobs by various criteria
    const byDepartment = jobs.reduce((acc, job) => {
      acc[job.department] = (acc[job.department] || 0) + 1;
      return acc;
    }, {});
    
    const byType = jobs.reduce((acc, job) => {
      acc[job.jobType] = (acc[job.jobType] || 0) + 1;
      return acc;
    }, {});
    
    const avgSalary = jobs.reduce((sum, job) => {
      const salary = parseInt(job.salaryRange?.replace(/[^0-9]/g, '') || 0);
      return sum + salary;
    }, 0) / (totalJobs || 1);

    // Calculate time to fill
    const filledJobs = jobs.filter(j => j.status === 'Filled' && j.createdAt);
    const avgTimeToFill = filledJobs.length > 0 
      ? filledJobs.reduce((sum, job) => {
          const daysToFill = Math.floor((new Date(job.updatedAt) - new Date(job.createdAt)) / (1000 * 60 * 60 * 24));
          return sum + daysToFill;
        }, 0) / filledJobs.length
      : 0;

    // Generate AI insights
    const prompt = `Analyze this job posting data:
    - Total jobs: ${totalJobs}
    - Active openings: ${activeJobs}
    - Department distribution: ${JSON.stringify(byDepartment)}
    - Job type distribution: ${JSON.stringify(byType)}
    - Average time to fill: ${avgTimeToFill.toFixed(1)} days
    
    Provide insights about:
    1. Hiring trends and patterns
    2. Departments with highest demand
    3. Potential bottlenecks in hiring
    4. Recommendations for improving job postings`;

    const aiResult = await aiModelService.generateChatResponse(prompt, '', { activity: 'analytics.jobs' });
    if (!aiResult.success) {
      return sendAIFailure(res, aiResult, 'AI job analytics are unavailable');
    }

    res.json({
      totalJobs,
      activeJobs,
      departmentDistribution: byDepartment,
      jobTypeDistribution: byType,
      averageTimeToFill: avgTimeToFill,
      insights: aiResult.response,
      recommendations: [
        "Prioritize high-demand departments",
        "Review and optimize job descriptions",
        "Consider streamlining interview process"
      ]
    });

  } catch (error) {
    console.error('❌ Error analyzing jobs:', error);
    sendAIFailure(res, error, 'Server error analyzing jobs');
  }
};

// Get matching report for a specific job using AI embeddings
exports.getMatchingReport = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { topK = 10, forceRefresh = 'false' } = req.query;
    const requestedTopK = Math.min(Math.max(parseInt(topK, 10) || 10, 1), 5000);
    const shouldForceRefresh = forceRefresh === 'true' || forceRefresh === true;
    
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        msg: 'Job not found',
        error: 'Invalid job ID'
      });
    }

    // Check cache first unless force refresh is requested
    if (!shouldForceRefresh) {
      const aiMatchCacheService = require('../services/aiMatchCacheService');
      const cachedReport = await aiMatchCacheService.getCachedReport(jobId);
      const cachedCandidateCount = cachedReport?.data?.topCandidates?.length || 0;
      
      if (cachedReport && cachedReport.data && cachedCandidateCount >= requestedTopK) {
        console.log(`⚡ Returning cached report for job ${jobId} (${cachedReport.cacheAgeMinutes} minutes old)`);
        // Explicitly set fromCache to true and ensure it's the first property to avoid any override issues
        const cachedResponse = {
          fromCache: true, // Set this FIRST to ensure it's not overridden
          ...cachedReport.data,
          cacheAge: cachedReport.cacheAge,
          cacheAgeMinutes: cachedReport.cacheAgeMinutes
        };
        // Explicitly ensure fromCache is true (in case cached data had fromCache: false)
        cachedResponse.fromCache = true;
        console.log(`💾 Cached response fromCache flag: ${cachedResponse.fromCache}`);
        return res.json(cachedResponse);
      } else if (cachedReport && cachedReport.data) {
        console.log(`Cached AI matching report has ${cachedCandidateCount} candidates, requested ${requestedTopK}; regenerating`);
      }
    } else {
      console.log(`🔄 Force refresh requested for job ${jobId} - bypassing cache`);
    }

    // Check if job has embedding
    if (!job.isEmbedded) {
      console.log(`⚠️ Job ${job._id} doesn't have embedding, creating one...`);
      // Create embedding for the job first
      const embeddingService = require('../services/embeddingService');
      await embeddingService.createJobEmbedding(job);
      job.isEmbedded = true;
      job.embeddingCreatedAt = new Date();
      await job.save();
    }

    // Use the existing job matching endpoint with embeddings
    const embeddingService = require('../services/embeddingService');
    const matchResult = await embeddingService.findMatchingCandidatesWithExplanation(job, requestedTopK);
    // Extract matches array from result object
    const matches = matchResult.matches || (Array.isArray(matchResult) ? matchResult : []);

    // Generate comprehensive AI insights about the matches
    const startTime = Date.now();
    let aiInsights = '';
    if (matches.length > 0) {
      const topMatches = matches.slice(0, 5);
      const prompt = `Analyze these AI-powered candidate matches for the job "${job.title}":
      
Job Details:
- Title: ${job.title}
- Department: ${job.department}
- Requirements: ${job.requirements}
- Skills needed: ${job.skills}

Top ${topMatches.length} AI-Matched Candidates (with similarity scores):
${topMatches.map((m, i) => {
  const c = m.candidate;
  return `${i+1}. ${c.firstName} ${c.lastName} - ${c.position}
   - Similarity: ${Math.round(m.similarity * 100)}%
   - Experience: ${c.experience}
   - Key Skills: ${c.skills}
   - AI Analysis: ${c.aiAnalysis?.summary || 'Not available'}`;
}).join('\n\n')}

Based on these AI-powered matches, provide:
1. Overall quality assessment of the candidate pool
2. Which candidates should be prioritized for interviews and why
3. Any skill gaps that might exist
4. Recommendations for improving the hiring process
5. Insights on why these candidates scored high in the AI matching`;

      const aiResult = await aiModelService.generateChatResponse(prompt, '', { activity: 'matching.report' });
      if (!aiResult.success) {
        return sendAIFailure(res, aiResult, 'The AI matching report is unavailable');
      }
      aiInsights = aiResult.response;
    } else {
      aiInsights = "No matching candidates found. Consider expanding your search criteria or posting the job on more platforms to attract qualified candidates.";
    }

    const generationTime = Date.now() - startTime;

    // Format response (don't include fromCache in cached data - it will be set when retrieved)
    const reportData = {
      job: {
        id: job._id,
        title: job.title,
        department: job.department,
        status: job.status,
        location: job.location,
        type: job.type
      },
      totalMatches: matches.length,
      usingAIMatching: true,
      topCandidates: matches.map(m => ({
        id: m.candidateId,
        name: `${m.candidate.firstName} ${m.candidate.lastName}`,
        position: m.candidate.position,
        experience: m.candidate.experience,
        skills: m.candidate.skills,
        similarity: m.similarity,
        similarityPercentage: Math.round((m.similarity || 0) * 100),
        relevanceScore: m.relevanceScore ?? m.similarity ?? 0,
        email: m.candidate.email,
        status: m.candidate.status,
        explanation: m.explanation,
        aiAnalysis: m.candidate.aiAnalysis
      })).sort((a, b) => b.relevanceScore - a.relevanceScore),
      insights: aiInsights,
      recommendations: [
        matches.length > 0 ? `Interview top ${Math.min(3, matches.length)} candidates with highest AI match scores` : "Expand job posting reach",
        "Use AI explanations to guide interview questions",
        "Consider candidates with 80%+ match scores as high priority",
        "Review skill gaps identified in the analysis"
      ]
      // Note: fromCache is NOT stored in cache - it's set when retrieved
    };

    // Cache the report (fire and forget - don't block response)
    const aiMatchCacheService = require('../services/aiMatchCacheService');
    aiMatchCacheService.setCachedReport(jobId, reportData, {
      candidateCount: matches.length,
      generationTime,
      modelUsed: aiModelService.modelName,
      version: 1
    }).catch(err => console.error('Failed to cache report:', err));

    // Add fromCache flag to response (false for fresh generation)
    const responseData = {
      ...reportData,
      fromCache: false
    };
    console.log(`💾 Fresh response fromCache flag: ${responseData.fromCache}`);
    res.json(responseData);

  } catch (error) {
    console.error('❌ Error getting AI matching report:', error);
    sendAIFailure(res, error, 'Server error getting AI matching report');
  }
};

// Get comprehensive hiring analytics
exports.getHiringAnalytics = async (req, res) => {
  try {
    const candidates = await Candidate.find();
    const jobs = await Job.find();
    
    // Calculate key metrics
    const totalCandidates = candidates.length;
    const totalJobs = jobs.length;
    const activeJobs = jobs.filter(j => j.status === 'active').length;
    const hiredCandidates = candidates.filter(c => c.status === 'Hired').length;
    
    // Hiring funnel
    const candidatesByStatus = candidates.reduce((acc, c) => {
      acc[c.status || 'New'] = (acc[c.status || 'New'] || 0) + 1;
      return acc;
    }, {});
    
    // Department metrics
    const departmentMetrics = {};
    jobs.forEach(job => {
      if (!departmentMetrics[job.department]) {
        departmentMetrics[job.department] = {
          totalJobs: 0,
          openJobs: 0,
          candidates: 0
        };
      }
      departmentMetrics[job.department].totalJobs++;
      if (job.status === 'active') {
        departmentMetrics[job.department].openJobs++;
      }
    });

    // Time-based trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentCandidates = candidates.filter(c => 
      new Date(c.createdAt) > thirtyDaysAgo
    ).length;
    
    const recentJobs = jobs.filter(j => 
      new Date(j.createdAt) > thirtyDaysAgo
    ).length;

    // Generate comprehensive AI insights
    const prompt = `Analyze this comprehensive hiring data:
    
    Overall Metrics:
    - Total candidates: ${totalCandidates}
    - Total jobs: ${totalJobs}
    - Active openings: ${activeJobs}
    - Hired candidates: ${hiredCandidates}
    - Hiring rate: ${totalCandidates > 0 ? ((hiredCandidates / totalCandidates) * 100).toFixed(1) : 0}%
    
    Candidate Pipeline:
    ${JSON.stringify(candidatesByStatus, null, 2)}
    
    Recent Activity (last 30 days):
    - New candidates: ${recentCandidates}
    - New jobs posted: ${recentJobs}
    
    Provide comprehensive insights about:
    1. Overall hiring effectiveness
    2. Pipeline bottlenecks
    3. Department-specific recommendations
    4. Strategic hiring recommendations
    5. Areas for process improvement`;

    const aiResult = await aiModelService.generateChatResponse(prompt, '', { activity: 'analytics.hiring' });
    if (!aiResult.success) {
      return sendAIFailure(res, aiResult, 'AI hiring analytics are unavailable');
    }

    res.json({
      overview: {
        totalCandidates,
        totalJobs,
        activeJobs,
        hiredCandidates,
        hiringRate: totalCandidates > 0 ? ((hiredCandidates / totalCandidates) * 100).toFixed(1) : 0
      },
      pipeline: candidatesByStatus,
      departmentMetrics,
      trends: {
        recentCandidates,
        recentJobs,
        avgCandidatesPerJob: activeJobs > 0 ? (totalCandidates / activeJobs).toFixed(1) : 0
      },
      insights: aiResult.response,
      recommendations: [
        "Focus on converting 'Interviewing' candidates",
        "Increase sourcing for high-demand departments",
        "Implement automated screening for efficiency"
      ],
      generatedAt: new Date()
    });

  } catch (error) {
    console.error('❌ Error getting hiring analytics:', error);
    sendAIFailure(res, error, 'Server error getting hiring analytics');
  }
};

// Test the managed AI runtime connection.
exports.testConnection = async (req, res) => {
  try {
    console.log('Testing managed AI runtime connection.');
    
    const result = await aiModelService.testConnection();
    
    if (result.success) {
      res.json({
        msg: 'AI model connection successful',
        model: aiModelService.modelName,
        provider: 'groq',
        defaultDeployment: GROQ_120B,
        matchingAnalysis: {
          enabled: gptAnalysisService.isEnabled,
          model: gptAnalysisService.modelName,
        },
        response: result.response,
      });
    } else {
      res.status(result.statusCode || 500).json({
        msg: 'AI model connection failed',
        code: result.code,
        model: aiModelService.modelName,
        provider: 'groq',
        defaultDeployment: GROQ_120B,
        matchingAnalysis: {
          enabled: gptAnalysisService.isEnabled,
          model: gptAnalysisService.modelName,
        },
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ Error testing connection:', error);
    sendAIFailure(res, error, 'Server error testing connection');
  }
};

// Helper functions
async function analyzeMessageForActions(message, aiResponse) {
  const actions = [];
  const messageLower = message.toLowerCase();

  // Navigation actions
  if (messageLower.includes('upload') && (messageLower.includes('candidate') || messageLower.includes('resume') || messageLower.includes('cv'))) {
    actions.push({
      label: 'Upload Candidate Resume',
      icon: 'upload',
      action: 'navigate',
      data: { url: '/candidates/new' }
    });
  }

  if (messageLower.includes('create job') || messageLower.includes('new job') || messageLower.includes('post job')) {
    actions.push({
      label: 'Create New Job',
      icon: 'briefcase',
      action: 'navigate',
      data: { url: '/jobs/new' }
    });
  }

  if (messageLower.includes('view candidates') || messageLower.includes('see candidates') || messageLower.includes('list candidates')) {
    actions.push({
      label: 'View All Candidates',
      icon: 'users',
      action: 'navigate',
      data: { url: '/candidates' }
    });
  }

  if (messageLower.includes('view jobs') || messageLower.includes('see jobs') || messageLower.includes('list jobs')) {
    actions.push({
      label: 'View All Jobs',
      icon: 'briefcase',
      action: 'navigate',
      data: { url: '/jobs' }
    });
  }

  // Data analysis actions
  if (messageLower.includes('analyz') || messageLower.includes('report') || messageLower.includes('insight')) {
    if (messageLower.includes('candidate')) {
      actions.push({
        label: 'Analyze Candidates',
        icon: 'bar-chart',
        action: 'api',
        data: { endpoint: '/api/ai/analyze-candidates' }
      });
    }
    if (messageLower.includes('job')) {
      actions.push({
        label: 'Analyze Jobs',
        icon: 'bar-chart',
        action: 'api',
        data: { endpoint: '/api/ai/analyze-jobs' }
      });
    }
    if (messageLower.includes('hiring') || messageLower.includes('overall')) {
      actions.push({
        label: 'View Hiring Analytics',
        icon: 'bar-chart',
        action: 'api',
        data: { endpoint: '/api/ai/hiring-analytics' }
      });
    }
  }

  if (messageLower.includes('match') && messageLower.includes('candidate')) {
    actions.push({
      label: 'Find Matching Candidates',
      icon: 'search',
      action: 'navigate',
      data: { url: '/jobs' }
    });
  }

  return actions;
}

// Get user's knowledge graph endpoint
exports.getUserKnowledgeGraph = async (req, res) => {
  try {
    // Use session from middleware
    const sessionId = req.session?.sessionId;
    const userId = req.session?.userId;
    const userIdentifier = userId || sessionId || 'anonymous';

    if (!sessionId) {
      return res.status(400).json({
        msg: 'Valid session required',
        error: 'Please refresh your browser to establish a session'
      });
    }

    console.log(`🕸️ Getting knowledge graph for: ${userIdentifier}`);

    // Get the user's knowledge graph
    const knowledgeGraph = await memoryService.getUserKnowledgeGraph(userIdentifier);

    if (!knowledgeGraph) {
      return res.json({
        msg: 'No knowledge graph available yet',
        userId: userIdentifier,
        graph: {
          nodes: [],
          edges: [],
          statistics: {
            totalNodes: 0,
            totalEdges: 0,
            nodeTypes: {},
            relationshipTypes: {}
          }
        }
      });
    }

    res.json({
      msg: 'Knowledge graph retrieved successfully',
      userId: userIdentifier,
      graph: knowledgeGraph,
      graphEnabled: true
    });

  } catch (error) {
    console.error('❌ Error getting knowledge graph:', error);
    res.status(500).json({
      msg: 'Server error getting knowledge graph',
      error: error.message
    });
  }
};

// Query graph relationships endpoint
exports.queryGraphRelationships = async (req, res) => {
  try {
    // Use session from middleware
    const sessionId = req.session?.sessionId;
    const userId = req.session?.userId;
    const userIdentifier = userId || sessionId || 'anonymous';

    if (!sessionId) {
      return res.status(400).json({
        msg: 'Valid session required',
        error: 'Please refresh your browser to establish a session'
      });
    }

    const { 
      startEntity, 
      relationshipTypes, 
      entityTypes, 
      maxDepth = 3,
      limit = 50 
    } = req.body;

    console.log(`🔍 Querying graph relationships for: ${userIdentifier}`);

    // Query graph relationships
    const graphResults = await memoryService.queryGraphRelationships(userIdentifier, {
      startEntity,
      relationshipTypes,
      entityTypes,
      maxDepth,
      limit
    });

    res.json({
      msg: 'Graph relationships queried successfully',
      userId: userIdentifier,
      results: graphResults,
      graphEnabled: true
    });

  } catch (error) {
    console.error('❌ Error querying graph relationships:', error);
    res.status(500).json({
      msg: 'Server error querying graph relationships',
      error: error.message
    });
  }
};

// New handler for streaming chat with LangChain agent
exports.handleChatStream = async (req, res) => {
  try {
    const { userInput, chatSessionId } = req.body;
    const userId = req.user.id; // Assuming authMiddleware adds user to req
    
    // Extract authToken from headers (added by authMiddleware)
    const authToken = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');

    if (!userInput) {
      return res.status(400).json({ msg: 'userInput is required' });
    }
    if (!userId) {
      return res.status(401).json({ msg: 'User authentication required' });
    }
     // chatSessionId is optional, can be used to load/save session-specific history

    console.log(`STREAMING chat request from user: ${userId} ${chatSessionId ? `(session: ${chatSessionId})` : ''}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish the SSE connection

    const sendSseEvent = (type, data) => {
      const eventPayload = { type, ...data };
      res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
    };

    let accumulatedFinalResponse = "";
    let agentFinalOutput = null; // To store the structured final output from the agent
    let accumulatedToolInfo = []; // To store tool call details { toolName, toolInput, toolCallId, output }
    let processingStartTime = Date.now();


    const streamCallbacks = {
      onData: (chunk) => {
        console.log('RAW AGENT CHUNK:', JSON.stringify(chunk, null, 2)); // UNCOMMENTED FOR DIAGNOSIS
        // Handle LLM streaming content
        if (chunk.event === "on_llm_stream" && chunk.data?.chunk?.content) {
            const token = chunk.data.chunk.content;
            accumulatedFinalResponse += token;
            sendSseEvent('llm_chunk', { content: token });
        } 
        // Handle regular stream chunks (fallback from langchainAgentService)
        else if (chunk.event === "on_chain_stream" && chunk.data?.chunk?.output) {
            const output = chunk.data.chunk.output;
            if (typeof output === 'string') {
                accumulatedFinalResponse += output;
                sendSseEvent('llm_chunk', { content: output });
            }
        }
        // Handle tool starts - Enhanced to show thinking process
        else if (chunk.event === "on_tool_start") {
            console.log('🔧 Tool starting:', chunk.name, chunk.data?.input);
            
            // Send thinking message to frontend
            sendSseEvent('agent_thinking', { 
                message: `🔍 Using tool: ${chunk.name}`,
                toolName: chunk.name,
                input: chunk.data?.input
            });
            
            // LangGraph specific event for tool call start
            if (chunk.name === "LangGraph" && chunk.data?.input?.tool_calls && Array.isArray(chunk.data.input.tool_calls)) {
                chunk.data.input.tool_calls.forEach(tc => {
                    const toolCall = {
                        toolName: tc.name,
                        toolInput: tc.args,
                        toolCallId: tc.id || `tool_${Date.now()}` // Generate an ID if not present
                    };
                    accumulatedToolInfo.push({...toolCall, output: null });
                    sendSseEvent('agent_step', { step_type: 'tool_call', ...toolCall });
                });
            } else {
                // Handle direct tool calls
                const toolCall = {
                    toolName: chunk.name,
                    toolInput: chunk.data?.input,
                    toolCallId: `tool_${Date.now()}`
                };
                accumulatedToolInfo.push({...toolCall, output: null });
                sendSseEvent('agent_step', { step_type: 'tool_call', ...toolCall });
            }
        } else if (chunk.event === "on_tool_end") {
            console.log('✅ Tool completed:', chunk.name, 'Output length:', JSON.stringify(chunk.data?.output).length);
            
            // Send completion message to frontend
            sendSseEvent('agent_thinking', { 
                message: `✅ Completed: ${chunk.name}`,
                toolName: chunk.name,
                success: true
            });
            // Handle tool results - Enhanced with better matching
            const toolOutput = chunk.data?.output;
            
            // Try to find the corresponding tool call to update its output
            let foundCall = null;
            
            if (chunk.name === "LangGraph") {
                // For LangGraph, find the last tool call without output
                foundCall = accumulatedToolInfo.reverse().find(t => t.output === null);
                accumulatedToolInfo.reverse(); // Restore original order
            } else {
                // For direct tool calls, match by name
                foundCall = accumulatedToolInfo.reverse().find(t => t.toolName === chunk.name && t.output === null);
                accumulatedToolInfo.reverse(); // Restore original order
            }
            
            if (foundCall) {
                foundCall.output = toolOutput;
                sendSseEvent('agent_step', {
                    step_type: 'tool_result',
                    toolName: foundCall.toolName,
                    output: toolOutput,
                    toolCallId: foundCall.toolCallId,
                    success: true
                });
            } else {
                // Fallback - create new entry
                const toolCall = {
                    toolName: chunk.name,
                    toolInput: "unknown",
                    output: toolOutput,
                    toolCallId: `result_${Date.now()}`
                };
                accumulatedToolInfo.push(toolCall);
                sendSseEvent('agent_step', { 
                    step_type: 'tool_result', 
                    toolName: chunk.name,
                    output: toolOutput,
                    toolCallId: toolCall.toolCallId
                });
            }

        } else if (chunk.event === "on_chain_end" && chunk.name === "AgentExecutor") {
            // This often contains the final structured output of the agent
            agentFinalOutput = chunk.data?.output;
            console.log('AgentExecutor final output received.');
            
            // If the final output is just a string, it might have already been streamed.
            // If it's an object (e.g., { output: "...", tool_calls: [] }), we can use it.
            // The `accumulatedFinalResponse` should ideally be the `output` string from here.
            if (typeof agentFinalOutput?.output === 'string') {
                accumulatedFinalResponse = agentFinalOutput.output; // Override if this is more definitive
                console.log('Set final response from AgentExecutor output.');
            } else if (typeof agentFinalOutput === 'string') {
                accumulatedFinalResponse = agentFinalOutput; // Sometimes the output is directly a string
                console.log('Set final response from direct AgentExecutor string.');
            }
            // We'll use agentFinalOutput in onComplete to extract actions/metadata
        }

        // Handle LangChain streamLog ops format (this is the main format we're receiving)
        if (chunk.ops && chunk.ops.length > 0) {
            for (const op of chunk.ops) {
                // Handle streaming text content from the OpenAI-compatible LangChain client.
                if (op.op === "add" && op.path.match(/^\/logs\/ChatOpenAI\/streamed_output_str\/.*$/)) {
                    const token = op.value;
                    if (token && typeof token === 'string') {
                        accumulatedFinalResponse += token;
                        sendSseEvent('llm_chunk', { content: token });
                    }
                }
                // Handle final output
                else if (op.op === "replace" && op.path === "/final_output") {
                    const finalOutput = op.value?.output;
                    if (finalOutput && typeof finalOutput === 'string') {
                        accumulatedFinalResponse = finalOutput; // Use the complete final output
                        console.log('Set final response from final output event.');
                    }
                }
                // Legacy fallback for older LangChain structures
                else if (op.op === "add" && op.path.startsWith("/logs/ChatOpenAI") && op.path.endsWith("/stream")) {
                    const token = op.value?.output?.content;
                    if (token && !accumulatedFinalResponse.endsWith(token)) { // Avoid duplicating if already handled by on_llm_stream
                        accumulatedFinalResponse += token;
                        sendSseEvent('llm_chunk', { content: token });
                    }
                } else if (op.op === "add" && op.path.match(/\/logs\/.*Agent\/tool_calls\/\d+$/)) {
                    const toolCallData = op.value; // Expected: { name, args, id }
                    if (toolCallData && toolCallData.name && toolCallData.args) {
                        const toolCall = {
                            toolName: toolCallData.name,
                            toolInput: toolCallData.args,
                            toolCallId: toolCallData.id || `tool_${Date.now()}`
                        };
                        if (!accumulatedToolInfo.find(t => t.toolCallId === toolCall.toolCallId)) {
                            accumulatedToolInfo.push({...toolCall, output: null });
                            sendSseEvent('agent_step', { step_type: 'tool_call', ...toolCall });
                        }
                    }
                } else if (op.op === "add" && op.path.match(/\/logs\/ToolNode_.*\/output$/)) {
                    const toolOutputData = op.value;
                    const toolNameMatch = op.path.match(/\/logs\/ToolNode_(.+)\/output$/);
                    const toolName = toolNameMatch ? toolNameMatch[1] : "unknown_tool";
                    
                    // Attempt to find corresponding tool call to update
                    let foundCall = accumulatedToolInfo.reverse().find(t => t.toolName === toolName && t.output === null);
                    if (foundCall) {
                        foundCall.output = toolOutputData;
                    } else { // If no match, add as a new entry (less ideal)
                        accumulatedToolInfo.push({ toolName, toolInput: "unknown", output: toolOutputData, toolCallId: `obs_${Date.now()}` });
                    }
                    sendSseEvent('agent_step', { step_type: 'tool_result', toolName: toolName, output: toolOutputData });
                } else if (op.op === "add" && (op.path === "/final_output" || op.path.endsWith("Agent/final_output"))) {
                     agentFinalOutput = op.value; // Capture final structured output
                     if (typeof agentFinalOutput?.output === 'string') {
                         accumulatedFinalResponse = agentFinalOutput.output;
                     }
                }
            }
        }
      },
      onError: (error) => {
        console.error('SSE stream error:', error);
        if (!res.writableEnded) {
            sendSseEvent('error', {
              message: error.message || 'An error occurred during streaming.',
              code: error.code,
              statusCode: error.statusCode
            });
            res.end();
        }
      },
      onComplete: async () => {
        console.log('SSE stream completed.');
        console.log('📊 Stream completion summary:');
        console.log('  - accumulatedFinalResponse:', accumulatedFinalResponse);
        console.log('  - agentFinalOutput present:', Boolean(agentFinalOutput));
        console.log('  - accumulatedToolInfo:', accumulatedToolInfo.length, 'tools used');
        
        const processingTime = Date.now() - processingStartTime;

        let finalContent = accumulatedFinalResponse;
        let finalActions = []; // TODO: Extract from agentFinalOutput if it contains action structures

        if (agentFinalOutput && typeof agentFinalOutput.output === 'string') {
            finalContent = agentFinalOutput.output; // Prefer structured final output if available
            console.log('Using AgentExecutor output as final content.');
        } else if (agentFinalOutput && typeof agentFinalOutput === 'string') {
            finalContent = agentFinalOutput; // Sometimes the output is directly a string
            console.log('✅ Using agentFinalOutput directly as finalContent:', finalContent);
        }
        
        console.log('Final assistant content prepared for delivery.');
        // Example: if agentFinalOutput.actions exists and is an array
        // if (agentFinalOutput && Array.isArray(agentFinalOutput.actions)) {
        //    finalActions = agentFinalOutput.actions;
        // }

        if (!res.writableEnded) {
            sendSseEvent('final_response', { content: finalContent, actions: finalActions, metadata: { processingTime } });
            sendSseEvent('stream_end', {});
            res.end();
        }

        try {
          console.log('Executing post-stream conversation and metadata persistence for user:', userId, 'session:', chatSessionId);
          const sessionIdForDb = req.session?.sessionId || `sess_stream_${Date.now()}`;
          
          const toolsUsedForDb = accumulatedToolInfo.map(t => ({
              tool: t.toolName,
              input: t.toolInput,
              output: t.output,
              // success: t.output !== null && !t.output?.toString().toLowerCase().includes('error') // Basic success check
          }));

          // 🚨 CRITICAL FIX: Save the conversation content to database
          if (chatSessionId && finalContent && userInput) {
            console.log('💾 Saving conversation to database...');
            
            try {
              const chatMessageService = require('../services/chatMessageService');
              await chatMessageService.saveConversation({
                sessionId: chatSessionId,
                chatSessionId: chatSessionId,
                userId: userId,
                userMessage: userInput,
                assistantResponse: finalContent,
                metadata: {
                  source: 'chat_stream_controller',
                  toolsUsed: accumulatedToolInfo.map(t => t.toolName),
                  toolResults: toolsUsedForDb,
                  processingTime: processingTime,
                  timestamp: new Date().toISOString()
                }
              });
              console.log('✅ Conversation successfully saved to database');
            } catch (conversationSaveError) {
              console.error('❌ Failed to save conversation to database:', conversationSaveError);
              // Continue with other saves even if conversation save fails
            }
          }

          // Update chat session metadata (title generation, etc.)
          if (chatSessionId) {
            const currentChatSession = await chatSessionService.getChatSession(chatSessionId);
            if (currentChatSession) {
                await chatSessionService.updateChatSession(chatSessionId, finalContent, 'assistant', {
                  toolsUsed: accumulatedToolInfo.map(t => t.toolName),
                  toolResults: toolsUsedForDb,
                  dataUsed: 'real_data_via_langchain_tools',
                  processingTime,
                });
                // Title generation is now handled by langchainAgentService.js
                // to avoid conflicts and ensure it's called at the right time
            }
          }

          console.log('✅ Post-stream conversation and metadata persistence completed for user:', userId, 'session:', chatSessionId);
        } catch (saveError) {
          console.error('❌ Error during post-stream persistence:', saveError);
        }
      },
    };

    // Call the LangChain agent service
    // chatHistoryMessages is now loaded by Mem0ChatMemory inside streamMessageWithAgent
    langchainAgentService.streamMessageWithAgent(userInput, userId, chatSessionId, authToken, streamCallbacks);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`Client disconnected from SSE stream for user: ${userId}`);
      // Perform any cleanup, like signaling the agent to stop processing if possible
      res.end();
    });

  } catch (error) {
    console.error('❌ Error in handleChatStream:', error);
    // Ensure response isn't already sent
    if (!res.headersSent) {
      sendAIFailure(res, error, 'Server error processing chat stream');
    } else {
      // If headers sent, try to end the stream if it's still open.
      // This might not always work if the error is critical.
      try {
        res.write(`data: ${JSON.stringify({type: "error", message: "Critical server error during stream."})}\n\n`);
        res.end();
      } catch (e) {
        console.error("Failed to send error over SSE and end response:", e);
      }
    }
  }
};

// Execute AI assistant actions - NOW RETURNS GUIDES INSTEAD OF EXECUTING
const GuideTemplateService = require('../services/guideTemplateService');
const guideService = new GuideTemplateService();

exports.executeAction = async (req, res) => {
  try {
    const { action, data, timestamp } = req.body;
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;

    console.log(`📚 Generating guide for action: ${action} for user: ${userId}`);
    console.log(`📋 Context data:`, data);

    if (!organizationId) {
      return res.status(400).json({
        error: 'Organization context required',
        msg: 'User must belong to an organization'
      });
    }

    let result;

    // Map actions to guide generation (NO LONGER EXECUTING ACTIONS)
    switch (action) {
      case 'analyze-candidate':
      case 'get-candidate-details':
      case 'discuss-candidate':
        result = guideService.generateCandidateSearchGuide({ ...data, query: data.candidateName || 'candidate' });
        break;
      
      case 'analyze-job':
      case 'get-job-details':
        result = guideService.generateViewJobsGuide(data);
        break;
      
      case 'schedule_interview':
      case 'schedule-interview':
        result = guideService.generateInterviewScheduleGuide(data);
        break;
      
      case 'find_candidates_for_job':
      case 'find-candidates-for-job':
        result = guideService.generateAIMatchingGuide(data);
        break;
      
      case 'create_job':
        result = guideService.generateJobCreationGuide(data);
        break;
      
      case 'create_candidate':
      case 'add_candidate':
        result = guideService.generateAddCandidateGuide(data);
        break;
      
      case 'navigate_pipeline':
      case 'view_pipeline':
        result = guideService.generatePipelineGuide(data);
        break;

      default:
        // Return welcome guide for unknown actions
        result = guideService.generateWelcomeGuide();
    }

    res.json({
      success: true,
      action,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Error generating guide: ${error.message}`);
    res.status(500).json({
      error: 'Failed to generate guide',
      msg: error.message
    });
  }
};

// Helper function to handle analyze-candidate action
async function handleAnalyzeCandidateAction(data, organizationId) {
  const { candidateId } = data;
  
  if (!candidateId) {
    throw new Error('candidateId is required for analyze-candidate action');
  }

  const Candidate = require('../models/Candidate');
  
  // Find candidate and verify organization access
  const candidate = await Candidate.findOne({ 
    _id: candidateId, 
    organization: organizationId 
  });

  if (!candidate) {
    throw new Error('Candidate not found or access denied');
  }

  // Return candidate analysis data
  return {
    candidateId,
    candidateName: `${candidate.firstName} ${candidate.lastName}`,
    position: candidate.position,
    experience: candidate.experience,
    skills: candidate.skills,
    status: candidate.status,
    aiAnalysis: candidate.aiAnalysis || null,
    resumeUrl: candidate.resumeUrl,
    location: candidate.location,
    education: candidate.education,
    createdAt: candidate.createdAt
  };
}

// Helper function to handle analyze-job action
async function handleAnalyzeJobAction(data, organizationId) {
  const { jobId } = data;
  
  if (!jobId) {
    throw new Error('jobId is required for analyze-job action');
  }

  const Job = require('../models/Job');
  
  // Find job and verify organization access
  const job = await Job.findOne({ 
    _id: jobId, 
    organization: organizationId 
  });

  if (!job) {
    throw new Error('Job not found or access denied');
  }

  // Return job analysis data
  return {
    jobId,
    title: job.title,
    department: job.department,
    status: job.status,
    applicants: job.applicants?.length || 0,
    requirements: job.requirements,
    responsibilities: job.responsibilities,
    skills: job.skills,
    experience: job.experience,
    location: job.location,
    salary: job.salary,
    createdAt: job.createdAt
  };
}

// Helper function to get candidate details
async function handleGetCandidateDetailsAction(data, organizationId) {
  return await handleAnalyzeCandidateAction(data, organizationId);
}

// Helper function to get job details  
async function handleGetJobDetailsAction(data, organizationId) {
  return await handleAnalyzeJobAction(data, organizationId);
}

// Helper function to handle discuss-candidate action
async function handleDiscussCandidateAction(data, organizationId) {
  const { candidateId } = data;
  
  if (!candidateId) {
    throw new Error('candidateId is required for discuss-candidate action');
  }

  const Candidate = require('../models/Candidate');
  
  // Find candidate and verify organization access
  const candidate = await Candidate.findOne({ 
    _id: candidateId, 
    organization: organizationId 
  });

  if (!candidate) {
    throw new Error('Candidate not found or access denied');
  }

  // Return candidate discussion data with additional context for conversation
  return {
    candidateId,
    candidateName: `${candidate.firstName} ${candidate.lastName}`,
    position: candidate.position,
    experience: candidate.experience,
    skills: candidate.skills,
    status: candidate.status,
    aiAnalysis: candidate.aiAnalysis || null,
    resumeUrl: candidate.resumeUrl,
    location: candidate.location,
    education: candidate.education,
    notes: candidate.notes || [],
    createdAt: candidate.createdAt,
    // Additional context for discussion
    discussionPrompt: `Let's discuss ${candidate.firstName} ${candidate.lastName}, a ${candidate.position} candidate with ${candidate.experience} experience. What would you like to know about them?`
  };
}

// Helper function to handle schedule-interview action
async function handleScheduleInterviewAction(data, organizationId) {
  const { candidateId, jobId } = data;
  
  if (!candidateId) {
    throw new Error('candidateId is required for schedule-interview action');
  }

  const Candidate = require('../models/Candidate');
  
  // Find candidate and verify organization access
  const candidate = await Candidate.findOne({ 
    _id: candidateId, 
    organization: organizationId 
  });

  if (!candidate) {
    throw new Error('Candidate not found or access denied');
  }

  // Return proper interview scheduling workflow guidance
  return {
    candidateId,
    candidateName: `${candidate.firstName} ${candidate.lastName}`,
    position: candidate.position,
    email: candidate.email,
    phone: candidate.phone,
    status: candidate.status,
    properWorkflow: {
      title: "Proper Interview Scheduling Process",
      description: "To schedule an interview, follow the standard workflow through the system"
    },
    schedulingSteps: [
      {
        step: 1,
        title: "Go to Jobs Page",
        description: "Navigate to the Jobs section to view all available positions",
        action: "/jobs"
      },
      {
        step: 2, 
        title: "Select the Relevant Job",
        description: "Choose the job position that this candidate will be interviewed for",
        action: "select_job"
      },
      {
        step: 3,
        title: "Access Job Pipeline",
        description: "Navigate to the job's pipeline to manage candidates and interviews",
        action: "pipeline"
      },
      {
        step: 4,
        title: "Schedule Interview",
        description: "Use the pipeline's interview scheduling tools to set up the interview",
        action: "schedule_in_pipeline"
      }
    ],
    workflowNote: "This ensures the interview is properly tracked within the job's pipeline and maintains proper candidate flow management.",
    nextSteps: {
      jobsPage: "/jobs",
      candidateProfile: `/candidates/${candidateId}`
    }
  };
}

// Helper function to handle find-candidates-for-job action
async function handleFindCandidatesForJobAction(data, organizationId) {
  const { jobId } = data;
  
  if (!jobId) {
    throw new Error('jobId is required for find-candidates-for-job action');
  }

  const Job = require('../models/Job');
  
  // Find job and verify organization access
  const job = await Job.findOne({ 
    _id: jobId, 
    organization: organizationId 
  });

  if (!job) {
    throw new Error('Job not found or access denied');
  }

  // Return guidance for finding candidates
  return {
    jobId,
    jobTitle: job.title,
    department: job.department,
    location: job.location,
    status: job.status,
    searchMethods: [
      {
        method: "AI-Powered Matching",
        description: "Use our smart matching algorithm to find candidates that best fit this role",
        action: "ai_matching"
      },
      {
        method: "Skills-Based Search", 
        description: "Search for candidates with specific skills and experience levels",
        action: "skills_search"
      },
      {
        method: "Location Filtering",
        description: "Find candidates in your preferred geographic area",
        action: "location_search"
      },
      {
        method: "Experience Level",
        description: "Filter candidates by years of experience and seniority",
        action: "experience_search"
      }
    ],
    searchTips: [
      "Start with AI matching for the best overall candidates",
      "Use multiple search criteria to narrow down results",
      "Consider candidates slightly outside your initial criteria",
      "Review both active and passive candidates",
      "Check candidate availability and interest level"
    ],
    nextSteps: {
      candidatesPage: "/candidates",
      jobDetailsPage: `/jobs/${jobId}`,
      aiMatching: `/jobs/${jobId}/matching`
    }
  };
}
