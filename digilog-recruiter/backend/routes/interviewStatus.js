const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const interviewStatusService = require('../services/interviewStatusService');

/**
 * GET /api/interview-status/stats
 * Get interview status statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await interviewStatusService.getInterviewStatusStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching interview status stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch interview status statistics',
      error: error.message
    });
  }
});

/**
 * POST /api/interview-status/check-missed
 * Manually trigger missed interview check
 */
router.post('/check-missed', authMiddleware, async (req, res) => {
  try {
    console.log(`🔧 Manual missed interview check triggered by user: ${req.user.id}`);
    
    const result = await interviewStatusService.manualCheckMissedInterviews();
    
    res.json({
      success: true,
      message: `Successfully processed ${result.updated} interviews`,
      data: {
        updatedCount: result.updated,
        updatedInterviews: result.interviews
      }
    });
  } catch (error) {
    console.error('Error during manual missed interview check:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check for missed interviews',
      error: error.message
    });
  }
});

module.exports = router;
