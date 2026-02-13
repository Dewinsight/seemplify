const express = require('express');
const { validationResult } = require('express-validator');
const { requirePerformancePermission } = require('../middleware/performanceMiddleware');
const AIPerformanceService = require('../services/aiPerformanceService');

const router = express.Router();

// Validation schemas
const generateOKRsSchema = {
  userRole: { in: 'body', notEmpty: true },
  teamGoals: { in: 'body', notEmpty: true },
  companyGoals: { in: 'body', notEmpty: true }
};

const analyzeReviewSchema = {
  selfEvaluation: { in: 'body', notEmpty: true },
  managerEvaluation: { in: 'body', notEmpty: true },
  peerReviews: { in: 'body', isArray: true }
};

const analyzeFeedbackSchema = {
  feedbackText: { in: 'body', notEmpty: true }
};

const generateTeamInsightsSchema = {
  teamData: { in: 'body', notEmpty: true },
  performanceMetrics: { in: 'body', notEmpty: true }
};

// POST /api/ai/generate-okrs - Generate OKRs using AI
router.post('/generate-okrs', requirePerformancePermission('create:okrs'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { userRole, teamGoals, companyGoals } = req.body;
      
      const result = await AIPerformanceService.generateOKRs(userRole, teamGoals, companyGoals);
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'OKRs generated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error generating OKRs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate OKRs'
    });
  }
});

// POST /api/ai/analyze-review - Analyze performance review
router.post('/analyze-review', requirePerformancePermission('evaluate:reviews'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { selfEvaluation, managerEvaluation, peerReviews } = req.body;
      
      const result = await AIPerformanceService.analyzePerformanceReview(
        selfEvaluation,
        managerEvaluation,
        peerReviews
      );
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'Performance review analyzed successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error analyzing performance review:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze performance review'
    });
  }
});

// POST /api/ai/analyze-feedback - Analyze feedback
router.post('/analyze-feedback', requirePerformancePermission('analyze:feedback'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { feedbackText } = req.body;
      
      const result = await AIPerformanceService.analyzeFeedback(feedbackText);
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'Feedback analyzed successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error analyzing feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze feedback'
    });
  }
});

// POST /api/ai/generate-team-insights - Generate team performance insights
router.post('/generate-team-insights', requirePerformancePermission('view:team-analytics'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { teamData, performanceMetrics } = req.body;
      
      const result = await AIPerformanceService.generateTeamInsights(teamData, performanceMetrics);
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'Team insights generated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error generating team insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate team insights'
    });
  }
});

// POST /api/ai/generate-review-assistant - Generate review writing assistant
router.post('/generate-review-assistant', requirePerformancePermission('participate:reviews'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { reviewContext, targetType } = req.body;
      
      const result = await AIPerformanceService.generateReviewWritingAssistant(reviewContext, targetType);
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'Review writing assistant generated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error generating review writing assistant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate review writing assistant'
    });
  }
});

// POST /api/ai/detect-bias - Detect bias in reviews
router.post('/detect-bias', requirePerformancePermission('evaluate:reviews'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      const { reviewText, reviewerRole } = req.body;
      
      const result = await AIPerformanceService.detectBias(reviewText, reviewerRole);
      
      res.json({
        success: true,
        data: result.data,
        confidence: result.confidence,
        message: 'Bias detection completed successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
  } catch (error) {
    console.error('Error detecting bias:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to detect bias'
    });
  }
});

// GET /api/ai/health - AI service health check
router.get('/health', async (req, res) => {
  try {
    const result = await AIPerformanceService.healthCheck();
    
    res.json({
      success: true,
      data: result,
      message: 'AI service health check completed'
    });
  } catch (error) {
    console.error('Error in AI health check:', error);
    res.status(500).json({
      success: false,
      error: 'AI service health check failed'
    });
  }
});

module.exports = router;
