const express = require('express');
const router = express.Router();
const {
  generateJobDescription,
  generateJobRequirements,
  // chat, // Removed as we are moving to streaming only
  analyzeCandidates,
  analyzeJobs,
  getMatchingReport,
  getHiringAnalytics,
  testConnection,
  getChatHistory,
  clearChatHistory,
  searchChatHistory,
  getUserKnowledgeGraph,
  queryGraphRelationships,
  handleChatStream // Placeholder for the new streaming handler
} = require('../controllers/aiController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');

// @route   POST api/ai/generate-job-description
// @desc    Generate job description using AI
// @access  Private (requires organization)
router.post('/generate-job-description', authMiddleware, requireOrganization, generateJobDescription);

// @route   POST api/ai/generate-job-requirements
// @desc    Generate job requirements using AI
// @access  Private (requires organization)
router.post('/generate-job-requirements', authMiddleware, requireOrganization, generateJobRequirements);

// @route   GET api/ai/chat-history
// @desc    Get chat history for a user
// @access  Private (requires organization)
router.get('/chat-history', authMiddleware, requireOrganization, getChatHistory);

// @route   POST api/ai/chat-history/clear
// @desc    Clear chat history for a user
// @access  Private (requires organization)
router.post('/chat-history/clear', authMiddleware, requireOrganization, clearChatHistory);

// @route   GET api/ai/chat-history/search
// @desc    Search chat history
// @access  Private (requires organization)
router.get('/chat-history/search', authMiddleware, requireOrganization, searchChatHistory);

// @route   GET api/ai/knowledge-graph
// @desc    Get user's knowledge graph
// @access  Private (requires organization)
router.get('/knowledge-graph', authMiddleware, requireOrganization, getUserKnowledgeGraph);

// @route   POST api/ai/graph-query
// @desc    Query graph relationships
// @access  Private (requires organization)
router.post('/graph-query', authMiddleware, requireOrganization, queryGraphRelationships);

// @route   GET api/ai/analyze-candidates
// @desc    Get AI analysis of all candidates
// @access  Private (requires organization)
router.get('/analyze-candidates', authMiddleware, requireOrganization, analyzeCandidates);

// @route   GET api/ai/analyze-jobs
// @desc    Get AI analysis of all jobs
// @access  Private (requires organization)
router.get('/analyze-jobs', authMiddleware, requireOrganization, analyzeJobs);

// @route   GET api/ai/matching-report/:jobId
// @desc    Get AI report on top candidates for a specific job
// @access  Private (requires organization)
router.get('/matching-report/:jobId', authMiddleware, requireOrganization, requireCredits('aiMatching', 'matching'), deductCredits, getMatchingReport);

// @route   GET api/ai/hiring-analytics
// @desc    Get comprehensive hiring analytics and insights
// @access  Private (requires organization)
router.get('/hiring-analytics', authMiddleware, requireOrganization, getHiringAnalytics);

// @route   GET api/ai/test-connection
// @desc    Test Azure OpenAI connection
// @access  Private (requires organization)
router.get('/test-connection', authMiddleware, requireOrganization, testConnection);

// @route   GET api/ai/tools
// @desc    Get available AI tools
// @access  Private (requires organization)
router.get('/tools', authMiddleware, requireOrganization, require('../controllers/aiController').getAvailableTools);

// @route   POST api/ai/test-tool
// @desc    Test a specific AI tool
// @access  Private (requires organization)
router.post('/test-tool', authMiddleware, requireOrganization, require('../controllers/aiController').testTool);

// @route   POST api/ai/execute-action
// @desc    Execute AI assistant actions
// @access  Private (requires organization)
router.post('/execute-action', authMiddleware, requireOrganization, require('../controllers/aiController').executeAction);

// @route   POST api/ai/chat-stream
// @desc    Send message to AI assistant and get a streamed response
// @access  Private (requires organization)
router.post('/chat-stream', authMiddleware, requireOrganization, handleChatStream);

// @route   POST api/ai/chat-public
// @desc    Test AI chat without authentication (for development/testing)
// @access  Public
router.post('/chat-public', require('../controllers/aiController').chatPublic);

// @route   GET api/ai/tools-public
// @desc    Get available AI tools without authentication (for development/testing)
// @access  Public
router.get('/tools-public', require('../controllers/aiController').getAvailableToolsPublic);

module.exports = router; 