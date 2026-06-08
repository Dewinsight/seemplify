const { z } = require('zod');
const { DynamicTool } = require('langchain/tools');
const ToolService = require('./toolService'); // To access makeRequest or specific tool methods

const toolServiceInstance = new ToolService();

/**
 * LangChain compatible tool to get all candidates.
 */
const getAllCandidatesTool = new DynamicTool({
  name: 'get_all_candidates',
  description: 'Get all candidates from the database with optional filtering. Filters include status, position, skills, and a limit for the number of results.',
  schema: z.object({
    status: z.string().optional().describe('Filter by candidate status (New, Reviewed, Interview, Hired, Rejected)'),
    position: z.string().optional().describe('Filter by position/job title'),
    skills: z.string().optional().describe('Filter by skills'),
    limit: z.number().int().positive().optional().describe('Limit number of results to return')
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_all_candidates' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.getAllCandidates(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_all_candidates':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_all_candidates tool' });
    }
  },
});

const getCandidateByIdTool = new DynamicTool({
  name: 'get_candidate_by_id',
  description: 'Get detailed information about a specific candidate using their unique ID.',
  schema: z.object({
    candidateId: z.string().describe('The MongoDB ObjectId of the candidate.'),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_candidate_by_id' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.getCandidateById(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_candidate_by_id':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_candidate_by_id tool' });
    }
  },
});

const createCandidateTool = new DynamicTool({
  name: 'create_candidate',
  description: 'Create a new candidate manually. Requires first name, last name, and email.',
  schema: z.object({
    firstName: z.string().describe("Candidate's first name"),
    lastName: z.string().describe("Candidate's last name"),
    email: z.string().email().describe("Candidate's email address"),
    phone: z.string().optional().describe("Candidate's phone number"),
    position: z.string().optional().describe("Position candidate is applying for or interested in"),
    experience: z.string().optional().describe("Summary of candidate's experience"),
    education: z.string().optional().describe("Candidate's educational background"),
    skills: z.string().optional().describe("Comma-separated list of candidate's skills"),
    status: z.string().optional().default('New').describe("Initial status of the candidate (e.g., New, Active)"),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'create_candidate' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.createCandidate(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'create_candidate':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute create_candidate tool' });
    }
  },
});

const updateCandidateTool = new DynamicTool({
  name: 'update_candidate',
  description: 'Update an existing candidate\'s information using their ID. Provide the candidate ID and an object with fields to update.',
  schema: z.object({
    candidateId: z.string().describe("The MongoDB ObjectId of the candidate to update."),
    updates: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        position: z.string().optional(),
        experience: z.string().optional(),
        education: z.string().optional(),
        skills: z.string().optional(),
        status: z.string().optional(),
        // Add any other updatable fields here
    }).describe("An object containing the fields and new values to update for the candidate.")
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'update_candidate' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.updateCandidate(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'update_candidate':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute update_candidate tool' });
    }
  },
});

const deleteCandidateTool = new DynamicTool({
  name: 'delete_candidate',
  description: 'Delete a candidate from the system using their ID.',
  schema: z.object({
    candidateId: z.string().describe("The MongoDB ObjectId of the candidate to delete."),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'delete_candidate' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.deleteCandidate(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'delete_candidate':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute delete_candidate tool' });
    }
  },
});

const getCandidateEmbeddingStatusTool = new DynamicTool({
  name: 'get_candidate_embedding_status',
  description: 'Check if a specific candidate has AI embeddings generated for smart matching.',
  schema: z.object({
    candidateId: z.string().describe("The MongoDB ObjectId of the candidate."),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_candidate_embedding_status' with params:`, params, `AuthToken present: !!${authToken}`);
      const result = await toolServiceInstance.getCandidateEmbeddingStatus(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_candidate_embedding_status':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_candidate_embedding_status tool' });
    }
  },
});

const createCandidateEmbeddingTool = new DynamicTool({
  name: 'create_candidate_embedding',
  description: 'Create AI embeddings for a specific candidate to enable smart matching features.',
  schema: z.object({
    candidateId: z.string().describe("The MongoDB ObjectId of the candidate for whom to create embeddings."),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'create_candidate_embedding' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.createCandidateEmbedding(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'create_candidate_embedding':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute create_candidate_embedding tool' });
    }
  },
});

// Job Management Tools - REMOVED: Now handled by JobAgent
// All job-related operations are now processed by the JobAgent instead of direct tools


// Analytics and Reporting Tools

const getCandidateAnalyticsTool = new DynamicTool({
  name: 'get_candidate_analytics',
  description: 'Get comprehensive analytics about the candidate pool.',
  schema: z.object({}), // No parameters defined in toolService.js
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_candidate_analytics' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getCandidateAnalytics(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_candidate_analytics':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_candidate_analytics tool' });
    }
  },
});

const getJobAnalyticsTool = new DynamicTool({
  name: 'get_job_analytics',
  description: 'Get comprehensive analytics about job postings.',
  schema: z.object({}), // No parameters
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_job_analytics' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getJobAnalytics(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_job_analytics':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_job_analytics tool' });
    }
  },
});

const getHiringAnalyticsTool = new DynamicTool({
  name: 'get_hiring_analytics',
  description: 'Get comprehensive hiring analytics and insights.',
  schema: z.object({}), // No parameters
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_hiring_analytics' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getHiringAnalytics(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_hiring_analytics':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_hiring_analytics tool' });
    }
  },
});

const getMatchingReportTool = new DynamicTool({
  name: 'get_matching_report',
  description: 'Get AI-powered matching report for a specific job. Requires job ID.',
  schema: z.object({
    jobId: z.string().describe("The MongoDB ObjectId of the job for the report."),
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'get_matching_report' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getMatchingReport(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_matching_report':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_matching_report tool' });
    }
  },
});

// User and Profile Tools

const getUserProfileTool = new DynamicTool({
  name: 'get_user_profile',
  description: 'Get current user profile information. Requires authentication context.',
  schema: z.object({}), // No parameters
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      if (!authToken) {
        return JSON.stringify({ error: 'User authentication token is required for get_user_profile tool.' });
      }
      console.log(`Executing LangChain tool 'get_user_profile' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getUserProfile(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_user_profile':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_user_profile tool' });
    }
  },
});

const getDashboardAnalyticsTool = new DynamicTool({
  name: 'get_dashboard_analytics',
  description: 'Get dashboard analytics for the current user. Requires authentication context.',
  schema: z.object({}), // No parameters
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      if (!authToken) {
        return JSON.stringify({ error: 'User authentication token is required for get_dashboard_analytics tool.' });
      }
      console.log(`Executing LangChain tool 'get_dashboard_analytics' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.getDashboardAnalytics(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'get_dashboard_analytics':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute get_dashboard_analytics tool' });
    }
  },
});

// Search and Discovery Tools

const searchCandidatesTool = new DynamicTool({
  name: 'search_candidates',
  description: 'Search candidates by keywords, skills, position, etc. Requires a query string.',
  schema: z.object({
    query: z.string().describe("Search query string for candidates."),
    filters: z.object({ // Based on toolService.js, searchCandidates calls getAllCandidates
        status: z.string().optional().describe('Filter by candidate status'),
        position: z.string().optional().describe('Filter by position/job title'),
        skills: z.string().optional().describe('Filter by skills'),
    }).optional().describe("Additional filters for candidate search (status, position, etc.)")
  }),
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'search_candidates' with params:`, params, `AuthToken present: ${!!authToken}`);
      // toolService.searchCandidates calls getAllCandidates with filters
      const searchParams = { ...(params.filters || {}), query: params.query }; // query might not be directly used by getAllCandidates, review original logic
      const result = await toolServiceInstance.searchCandidates(searchParams, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'search_candidates':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute search_candidates tool' });
    }
  },
});

// Search Jobs Tool - REMOVED: Now handled by JobAgent
// Job search is now processed by the JobAgent's list_jobs intent

// AI Tools

// Generate Job Description Tool - REMOVED: Now handled by JobAgent
// Job description generation is now built into the JobAgent's create_job process

const testAIConnectionTool = new DynamicTool({
  name: 'test_ai_connection',
  description: 'Test the connection to the AI/OpenAI service.',
  schema: z.object({}), // No parameters
  func: async (params, runManager) => {
    try {
      const authToken = runManager?.config?.configurable?.authToken || null;
      console.log(`Executing LangChain tool 'test_ai_connection' with params:`, params, `AuthToken present: ${!!authToken}`);
      const result = await toolServiceInstance.testAIConnection(params, authToken);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`Error in LangChain tool 'test_ai_connection':`, error);
      return JSON.stringify({ error: error.message || 'Failed to execute test_ai_connection tool' });
    }
  },
});


// Export all defined tools in an array
// NOTE: ALL tools have been removed - system now uses JobAgent for job operations
// Other operations will be handled by future agents (CandidateAgent, AnalyticsAgent, etc.)
const allTools = [
  // All tools removed - transitioning to agent-based architecture
  // JobAgent handles all job operations
  // Future: CandidateAgent, AnalyticsAgent, etc.
];

module.exports = allTools;