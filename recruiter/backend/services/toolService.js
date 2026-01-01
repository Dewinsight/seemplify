const axios = require('axios');
const FormData = require('form-data');

/**
 * Tool Service - Provides AI with access to all backend APIs as tools
 * This allows the AI to determine which APIs to call based on user requests
 */
class ToolService {
  constructor(baseURL = null) {
    // Auto-detect environment and set appropriate base URL
    if (!baseURL) {
      const isProduction = process.env.NODE_ENV === 'production' || 
                          process.env.WEBSITE_HOSTNAME || 
                          process.env.AZURE_FUNCTIONS_ENVIRONMENT;
      
      this.baseURL = isProduction 
        ? 'https://api.seemplifyai.com'
        : 'http://localhost:5001';
    } else {
      this.baseURL = baseURL;
    }
    
    console.log(`🔧 ToolService initialized with baseURL: ${this.baseURL}`);
    this.tools = this.registerAllTools();
  }

  /**
   * Register all available tools/APIs
   */
  registerAllTools() {
    return {
      // Candidate Management Tools
      get_all_candidates: {
        name: 'get_all_candidates',
        description: 'Get all candidates from the database with optional filtering',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by candidate status (New, Reviewed, Interview, Hired, Rejected)' },
            position: { type: 'string', description: 'Filter by position/job title' },
            skills: { type: 'string', description: 'Filter by skills' },
            limit: { type: 'number', description: 'Limit number of results' }
          }
        },
        execute: this.getAllCandidates.bind(this)
      },

      get_candidate_by_id: {
        name: 'get_candidate_by_id',
        description: 'Get detailed information about a specific candidate',
        parameters: {
          type: 'object',
          properties: {
            candidateId: { type: 'string', description: 'The candidate ID', required: true }
          },
          required: ['candidateId']
        },
        execute: this.getCandidateById.bind(this)
      },

      // INFORMATION-ONLY AI ASSISTANT
      // All create/update/delete tools removed - AI Assistant only provides navigation guides
      // Users must use the actual UI pages to perform actions

      // Analytics and Reporting Tools
      get_candidate_analytics: {
        name: 'get_candidate_analytics',
        description: 'Get comprehensive analytics about the candidate pool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.getCandidateAnalytics.bind(this)
      },

      get_job_analytics: {
        name: 'get_job_analytics',
        description: 'Get comprehensive analytics about job postings',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.getJobAnalytics.bind(this)
      },

      get_hiring_analytics: {
        name: 'get_hiring_analytics',
        description: 'Get comprehensive hiring analytics and insights',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.getHiringAnalytics.bind(this)
      },

      get_matching_report: {
        name: 'get_matching_report',
        description: 'Get AI-powered matching report for a specific job',
        parameters: {
          type: 'object',
          properties: {
            jobId: { type: 'string', required: true }
          },
          required: ['jobId']
        },
        execute: this.getMatchingReport.bind(this)
      },

      // User and Profile Tools
      get_user_profile: {
        name: 'get_user_profile',
        description: 'Get current user profile information',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.getUserProfile.bind(this)
      },

      get_dashboard_analytics: {
        name: 'get_dashboard_analytics',
        description: 'Get dashboard analytics for the current user',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.getDashboardAnalytics.bind(this)
      },

      // Search and Discovery Tools
      search_candidates: {
        name: 'search_candidates',
        description: 'Search candidates by keywords, skills, position, etc.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', required: true, description: 'Search query' },
            filters: { type: 'object', description: 'Additional filters (status, position, etc.)' }
          },
          required: ['query']
        },
        execute: this.searchCandidates.bind(this)
      },

      // search_jobs - REMOVED: Now handled by JobAgent

      // AI Tools
      // generate_job_description - REMOVED: Now built into JobAgent's create_job process

      test_ai_connection: {
        name: 'test_ai_connection',
        description: 'Test the AI/OpenAI connection',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: this.testAIConnection.bind(this)
      }
    };
  }

  /**
   * Extract organization ID from JWT token
   */
  extractOrganizationFromToken(authToken) {
    if (!authToken) {
      throw new Error('Authentication token required');
    }
    
    try {
      const jwt = require('jsonwebtoken');
      const token = authToken.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const organizationId = decoded.user.currentOrganization;
      
      if (!organizationId) {
        throw new Error('User must belong to an organization to access data');
      }
      
      return organizationId;
    } catch (error) {
      console.error('Error decoding auth token:', error);
      throw new Error('Invalid authentication token');
    }
  }

  /**
   * Get available tools for the AI
   */
  getAvailableTools() {
    return Object.keys(this.tools).map(toolName => ({
      name: toolName,
      description: this.tools[toolName].description,
      parameters: this.tools[toolName].parameters
    }));
  }

  /**
   * Execute a tool by name with parameters
   */
  async executeTool(toolName, parameters, authToken = null) {
    const tool = this.tools[toolName];
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    try {
      console.log(`🔧 Executing tool: ${toolName}`, parameters);
      const result = await tool.execute(parameters, authToken);
      console.log(`✅ Tool '${toolName}' executed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Error executing tool '${toolName}':`, error.message);
      throw error;
    }
  }

  /**
   * Helper method to make authenticated API requests
   */
  async makeRequest(method, endpoint, data = null, authToken = null) {
    // For testing: if no auth token, try to call internal functions directly
    if (!authToken && (endpoint.includes('/api/candidates') || endpoint.includes('/api/jobs') || endpoint.includes('/api/ai/analyze'))) {
      return await this.makeInternalRequest(method, endpoint, data);
    }

    const config = {
      method,
      url: `${this.baseURL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { 'Authorization': `Bearer ${authToken}` })
      },
      ...(data && { data })
    };

    const response = await axios(config);
    return response.data;
  }

  /**
   * Make internal requests directly to database (for testing without auth)
   */
  async makeInternalRequest(method, endpoint, data = null) {
    const Candidate = require('../models/Candidate');
    const Job = require('../models/Job');

    try {
      if (endpoint.includes('/api/candidates')) {
        if (method === 'GET' && endpoint.startsWith('/api/candidates')) {
          // Handle query parameters
          const [path, queryString] = endpoint.split('?');
          const params = new URLSearchParams(queryString);
          const limit = parseInt(params.get('limit')) || 100;
          
          if (path === '/api/candidates') {
            const candidates = await Candidate.find().limit(limit);
            return candidates;
          }
          
          // Handle specific candidate by ID
          const candidateId = path.split('/').pop();
          if (candidateId && candidateId !== 'candidates') {
            const candidate = await Candidate.findById(candidateId);
            return candidate;
          }
        }
        
        if (method === 'POST' && endpoint === '/api/candidates') {
          const candidate = new Candidate(data);
          await candidate.save();
          return candidate;
        }
      }

      if (endpoint.includes('/api/jobs')) {
        if (method === 'GET' && endpoint.startsWith('/api/jobs')) {
          // Handle query parameters
          const [path, queryString] = endpoint.split('?');
          const params = new URLSearchParams(queryString);
          
          if (path === '/api/jobs') {
            // Build query based on parameters
            let query = {};
            if (params.get('status')) query.status = params.get('status');
            if (params.get('department')) query.department = params.get('department');
            if (params.get('type')) query.type = params.get('type');
            if (params.get('location')) query.location = params.get('location');
            
            const jobs = await Job.find(query);
            // Remove applicants field to avoid confusion - we use AI matching, not applications
            const jobsWithoutApplicants = jobs.map(job => {
              const jobObj = job.toObject();
              delete jobObj.applicants; // Remove applicants array
              jobObj._matchingNote = 'Use get_matching_candidates_for_job tool to find best candidates';
              return jobObj;
            });
            return jobsWithoutApplicants;
          }
        }
        
        if (method === 'POST' && endpoint === '/api/jobs') {
          console.log('📝 Creating job with data:', data);
          const job = new Job(data);
          await job.save();
          console.log('✅ Job created successfully:', job.title);
          return job;
        }
        
        // Handle job matching endpoints
        if (method === 'GET' && endpoint.includes('/matching-candidates')) {
          // Parse endpoint properly: /api/jobs/:id/matching-candidates?limit=X
          const pathParts = endpoint.split('?')[0].split('/'); // Remove query params first
          const jobId = pathParts[3]; // /api/jobs/:id/matching-candidates -> pathParts[3] is the ID
          
          console.log(`🔍 Looking for job matching with ID: ${jobId}`);
          
          // For testing: return mock matching data based on real candidates
          const candidates = await Candidate.find().limit(5);
          const job = await Job.findById(jobId);
          
          if (!job) {
            throw new Error(`Job not found with ID: ${jobId}`);
          }
          
          console.log(`✅ Found job: ${job.title} for matching`);
          
          // Mock matching with scores (in real system, this would use AI embeddings)
          const matchingCandidates = candidates.map((candidate, index) => ({
            candidate: candidate,
            score: Math.round((95 - index * 5) * 100) / 100, // Mock scores: 95, 90, 85, 80, 75
            reasons: [
              `Strong skill match for ${job.title} requirements`,
              `${candidate.experience} years experience aligns with job needs`,
              `Education in ${candidate.education} matches job requirements`,
              `${candidate.position} background relevant to ${job.department} role`
            ].slice(0, 3 - Math.floor(index/2)), // Fewer reasons for lower scores
            matchDetails: {
              skillMatch: Math.round((90 - index * 3) * 100) / 100,
              experienceMatch: Math.round((92 - index * 4) * 100) / 100,
              educationMatch: Math.round((88 - index * 2) * 100) / 100
            }
          }));
          
          console.log(`🎯 Generated ${matchingCandidates.length} candidate matches`);
          
          return {
            job: job,
            matches: matchingCandidates,
            totalMatches: matchingCandidates.length,
            message: `Found ${matchingCandidates.length} matching candidates for ${job.title} position`,
            success: true
          };
        }
        
        if (method === 'GET' && endpoint.match(/\/api\/jobs\/[^\/]+$/)) {
          const jobId = endpoint.split('/').pop();
          const job = await Job.findById(jobId);
          return job;
        }
      }

      // Handle analytics endpoints
      if (endpoint === '/api/ai/analyze-candidates' && method === 'GET') {
        const candidates = await Candidate.find();
        const totalCandidates = candidates.length;
        
        // Calculate status distribution
        const statusCounts = {};
        candidates.forEach(candidate => {
          const status = candidate.status || 'Unknown';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        // Calculate position distribution
        const positionCounts = {};
        candidates.forEach(candidate => {
          const position = candidate.position || 'Not Specified';
          positionCounts[position] = (positionCounts[position] || 0) + 1;
        });
        
        return {
          totalCandidates,
          statusDistribution: statusCounts,
          positionDistribution: positionCounts,
          summary: `There are ${totalCandidates} candidates in the system.`,
          details: {
            byStatus: Object.entries(statusCounts).map(([status, count]) => 
              `${status}: ${count} candidates`
            ).join(', '),
            topPositions: Object.entries(positionCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([position, count]) => `${position}: ${count}`)
              .join(', ')
          }
        };
      }

      if (endpoint === '/api/ai/analyze-jobs' && method === 'GET') {
        const jobs = await Job.find();
        const totalJobs = jobs.length;
        
        // Calculate status distribution
        const statusCounts = {};
        jobs.forEach(job => {
          const status = job.status || 'Unknown';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        // Calculate department distribution
        const departmentCounts = {};
        jobs.forEach(job => {
          const department = job.department || 'Not Specified';
          departmentCounts[department] = (departmentCounts[department] || 0) + 1;
        });
        
        // Calculate type distribution
        const typeCounts = {};
        jobs.forEach(job => {
          const type = job.type || 'Not Specified';
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        });
        
        return {
          totalJobs,
          statusDistribution: statusCounts,
          departmentDistribution: departmentCounts,
          typeDistribution: typeCounts,
          summary: `There are ${totalJobs} jobs in the system.`,
          details: {
            byStatus: Object.entries(statusCounts).map(([status, count]) => 
              `${status}: ${count} jobs`
            ).join(', '),
            byDepartment: Object.entries(departmentCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([department, count]) => `${department}: ${count}`)
              .join(', '),
            byType: Object.entries(typeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => `${type}: ${count}`)
              .join(', ')
          }
        };
      }

      throw new Error(`Internal request not implemented for ${method} ${endpoint}`);
    } catch (error) {
      throw new Error(`Database error: ${error.message}`);
    }
  }

  // Tool Implementation Methods

  async getAllCandidates(params, authToken) {
    const Candidate = require('../models/Candidate');
    const organizationId = this.extractOrganizationFromToken(authToken);
    
    // Build query based on parameters with organization filtering
    let query = { organization: organizationId };
    if (params.status) query.status = params.status;
    if (params.position) query.position = new RegExp(params.position, 'i'); // Case-insensitive search
    if (params.skills) query.skills = new RegExp(params.skills, 'i'); // Case-insensitive search
    
    const limit = parseInt(params.limit) || 100;
    
    console.log(`🔒 Getting candidates for organization: ${organizationId}`);
    const candidates = await Candidate.find(query).limit(limit);
    return candidates;
  }

  async getCandidateById(params, authToken) {
    const Candidate = require('../models/Candidate');
    const organizationId = this.extractOrganizationFromToken(authToken);
    
    console.log(`🔒 Getting candidate ${params.candidateId} for organization: ${organizationId}`);
    const candidate = await Candidate.findOne({ _id: params.candidateId, organization: organizationId });
    return candidate;
  }

  // REMOVED: Action methods - AI Assistant is information-only
  // Users must use the UI to create, update, or delete candidates

  // Job-related methods - REMOVED: Now handled by JobAgent
  // These methods have been moved to the JobAgent and AiJobService
  
  /*
  async getAllJobs(params, authToken) {
    // MOVED TO: JobAgent.processListJobs() -> AiJobService.listJobs()
  }

  async getJobById(params, authToken) {
    // MOVED TO: JobAgent.processGetJobById() -> AiJobService.getJobById()
  }

  async createJob(params, authToken) {
    // MOVED TO: JobAgent.processCreateJob() -> AiJobService.createJobAndEmbed()
    // Data mapping logic moved to JobAgent._prepareJobData()
  }

  async updateJob(params, authToken) {
    // MOVED TO: JobAgent.processUpdateJob() -> AiJobService.updateJobAndEmbed()
  }

  async deleteJob(params, authToken) {
    // MOVED TO: JobAgent.processDeleteJob() -> AiJobService.deleteJobAndEmbed()
  }

  async getMatchingCandidatesForJob(params, authToken) {
    // MOVED TO: JobAgent.processGetMatchingCandidates() -> AiJobService.getMatchingCandidatesForJob()
  }

  async createJobEmbedding(params, authToken) {
    // MOVED TO: AiJobService.createJobAndEmbed() (automatic embedding creation)
  }
  */

  async getCandidateAnalytics(params, authToken) {
    const Candidate = require('../models/Candidate');
    
    const candidates = await Candidate.find();
    const totalCandidates = candidates.length;
    
    // Calculate status distribution
    const statusCounts = {};
    candidates.forEach(candidate => {
      const status = candidate.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    // Calculate position distribution
    const positionCounts = {};
    candidates.forEach(candidate => {
      const position = candidate.position || 'Not Specified';
      positionCounts[position] = (positionCounts[position] || 0) + 1;
    });
    
    return {
      totalCandidates,
      statusDistribution: statusCounts,
      positionDistribution: positionCounts,
      summary: `There are ${totalCandidates} candidates in the system.`,
      details: {
        byStatus: Object.entries(statusCounts).map(([status, count]) => 
          `${status}: ${count} candidates`
        ).join(', '),
        topPositions: Object.entries(positionCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([position, count]) => `${position}: ${count}`)
          .join(', ')
      }
    };
  }

  async getJobAnalytics(params, authToken) {
    const Job = require('../models/Job');
    
    const jobs = await Job.find();
    const totalJobs = jobs.length;
    
    // Calculate status distribution
    const statusCounts = {};
    jobs.forEach(job => {
      const status = job.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    // Calculate department distribution
    const departmentCounts = {};
    jobs.forEach(job => {
      const department = job.department || 'Not Specified';
      departmentCounts[department] = (departmentCounts[department] || 0) + 1;
    });
    
    // Calculate type distribution
    const typeCounts = {};
    jobs.forEach(job => {
      const type = job.type || 'Not Specified';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    
    return {
      totalJobs,
      statusDistribution: statusCounts,
      departmentDistribution: departmentCounts,
      typeDistribution: typeCounts,
      summary: `There are ${totalJobs} jobs in the system.`,
      details: {
        byStatus: Object.entries(statusCounts).map(([status, count]) => 
          `${status}: ${count} jobs`
        ).join(', '),
        byDepartment: Object.entries(departmentCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([department, count]) => `${department}: ${count}`)
          .join(', '),
        byType: Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ')
      }
    };
  }

  async getHiringAnalytics(params, authToken) {
    return await this.makeRequest('GET', '/api/ai/hiring-analytics', null, authToken);
  }

  async getMatchingReport(params, authToken) {
    return await this.makeRequest('GET', `/api/ai/matching-report/${params.jobId}`, null, authToken);
  }

  async getUserProfile(params, authToken) {
    return await this.makeRequest('GET', '/api/users/profile', null, authToken);
  }

  async getDashboardAnalytics(params, authToken) {
    return await this.makeRequest('GET', '/api/users/analytics', null, authToken);
  }

  async searchCandidates(params, authToken) {
    // This would need to be implemented as a search endpoint
    // For now, we'll use the get all candidates with filtering
    return await this.getAllCandidates({ ...params.filters }, authToken);
  }

  // async searchJobs(params, authToken) {
  //   // MOVED TO: JobAgent.processListJobs() with search capabilities
  // }

  // async generateJobDescription(params, authToken) {
  //   // MOVED TO: JobAgent AI generation built into create_job process
  // }

  async testAIConnection(params, authToken) {
    return await this.makeRequest('GET', '/api/ai/test-connection', null, authToken);
  }
}

module.exports = ToolService; 