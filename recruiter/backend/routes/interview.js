const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');
const interviewController = require('../controllers/interviewController');
const requirePublicFeedbackAccess = require('../middleware/publicFeedbackAccess');

// Additional CORS headers for interview routes (especially for multi-candidate scheduling)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID, X-Public-Feedback-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Special middleware for OAuth callback to prevent anonymous session creation
const oauthCallbackMiddleware = (req, res, next) => {
  // Skip session creation for OAuth callback
  req.skipSessionCreation = true;
  next();
};

// Core interview scheduling routes - with credits middleware
router.post('/schedule', authMiddleware, requireOrganization, requireCredits('scheduleInterview', 'interview'), deductCredits, interviewController.scheduleInterview);
router.post('/from-pipeline', authMiddleware, requireOrganization, requireCredits('scheduleInterview', 'interview'), deductCredits, interviewController.scheduleFromPipeline);
router.post('/schedule-multi', authMiddleware, requireOrganization, requireCredits('scheduleInterview', 'interview'), deductCredits, interviewController.scheduleMultiCandidateInterview);

// Interview management routes
router.get('/', authMiddleware, requireOrganization, interviewController.getInterviews);
router.get('/job/:jobId', authMiddleware, requireOrganization, interviewController.getJobInterviews);
router.get('/candidate/:candidateId', authMiddleware, requireOrganization, interviewController.getCandidateInterviews);
router.get('/:interviewId', authMiddleware, requireOrganization, interviewController.getInterviewDetails);
router.get('/:interviewId/debug-notetaker', authMiddleware, requireOrganization, interviewController.debugInterviewNotetaker);
router.put('/:interviewId/status', authMiddleware, requireOrganization, interviewController.updateInterviewStatus);
router.put('/:interviewId/cancel', authMiddleware, requireOrganization, interviewController.cancelInterview);

// Calendar integration routes
router.get('/availability/:userId', authMiddleware, requireOrganization, interviewController.getAvailability);
router.post('/connect-calendar', authMiddleware, requireOrganization, interviewController.connectCalendar);
router.get('/calendar-status/:userId', authMiddleware, requireOrganization, interviewController.getCalendarStatus);

// OAuth callback route (with special middleware to prevent anonymous session creation)
router.get('/oauth/callback', oauthCallbackMiddleware, interviewController.handleOAuthCallback);

// AI Interview Summary routes
router.post('/:interviewId/ai-summary', authMiddleware, requireOrganization, interviewController.generateAISummary);

// Interview Comments routes
router.get('/:interviewId/comments', authMiddleware, requireOrganization, interviewController.getInterviewComments);
router.post('/:interviewId/comments', authMiddleware, requireOrganization, interviewController.addInterviewComment);
router.put('/:interviewId/comments/:commentId', authMiddleware, requireOrganization, interviewController.updateInterviewComment);
router.delete('/:interviewId/comments/:commentId', authMiddleware, requireOrganization, interviewController.deleteInterviewComment);

// Team Comments AI Analysis route
router.post('/:interviewId/analyze-comments', authMiddleware, requireOrganization, interviewController.analyzeTeamComments);

// Question-based feedback routes
router.get('/:interviewId/feedback/questions', requirePublicFeedbackAccess, interviewController.getInterviewQuestions);
router.get('/:interviewId/feedback/summary', authMiddleware, requireOrganization, interviewController.getFeedbackSummary);
router.post('/:interviewId/feedback/question', authMiddleware, requireOrganization, interviewController.addQuestionFeedback);
router.post('/:interviewId/feedback/public', requirePublicFeedbackAccess, interviewController.addPublicFeedback);
router.post('/:interviewId/feedback/bulk', requirePublicFeedbackAccess, interviewController.addBulkPublicFeedback);

// OTP verification routes for public feedback
router.post('/:interviewId/feedback/generate-otp', requirePublicFeedbackAccess, interviewController.generateFeedbackOTP);
router.post('/:interviewId/feedback/verify-otp', requirePublicFeedbackAccess, interviewController.verifyFeedbackOTP);

// Delete feedback route
router.delete('/:interviewId/feedback/:commentId', authMiddleware, requireOrganization, interviewController.deleteFeedback); // Delete feedback

// Analytics routes
router.post('/:interviewId/analytics-score', authMiddleware, requireOrganization, interviewController.saveAnalyticsScore); // Save analytics score
router.get('/:interviewId/analytics-score', authMiddleware, requireOrganization, interviewController.getAnalyticsScore); // Get analytics score
router.get('/:interviewId/comprehensive-analytics', authMiddleware, requireOrganization, interviewController.getComprehensiveAnalytics); // Get comprehensive analytics (dynamic scoring)

// Debug endpoint to test calendar event deletion
router.post('/test-delete-event', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { eventId } = req.body;
    const userId = req.user.id;
    
    console.log('=== TEST DELETE EVENT ===');
    console.log('Event ID:', eventId);
    console.log('User ID:', userId);
    
    // Get user's grant ID
    const user = await require('../models/User').findById(userId);
    if (!user || !user.nylasGrantId) {
      return res.status(400).json({ error: 'User calendar not connected' });
    }
    
    console.log('User Grant ID:', user.nylasGrantId);
    
    // Try to delete the event
    const result = await require('../services/nylasV3Service').deleteEvent(user.nylasGrantId, eventId);
    
    res.json({ 
      success: true, 
      message: 'Event deleted successfully',
      result: result 
    });
    
  } catch (error) {
    console.error('Test delete event error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error 
    });
  }
});

// Debug endpoint to check notetaker data
router.get('/debug/:interviewId/notetaker', authMiddleware, requireOrganization, interviewController.debugInterviewNotetaker);

// Interview Questions related endpoints
const interviewQuestionsController = require('../controllers/interviewQuestionsController');
router.post('/:interviewId/questions/send', authMiddleware, requireOrganization, interviewQuestionsController.sendInterviewQuestions);
router.get('/:interviewId/questions', authMiddleware, requireOrganization, interviewQuestionsController.getSelectedQuestions);

module.exports = router;
