const express = require('express');
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const Feedback = require('../models/Feedback');

const router = express.Router();

// GET /api/analytics/team/:teamId - Get team analytics (real data only)
router.get('/team/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;

    // Get team members' OKRs and reviews from database
    const okrs = await OKR.find({ teamId }).lean();
    const reviews = await PerformanceReview.find({ teamId }).lean();

    // Calculate performance distribution from real data
    const distribution = {
      exceeds: 0,
      meets: 0,
      needsImprovement: 0
    };

    reviews.forEach(review => {
      const rating = review.managerEvaluation?.rating || review.selfEvaluation?.rating;
      if (rating >= 4) distribution.exceeds++;
      else if (rating >= 3) distribution.meets++;
      else if (rating > 0) distribution.needsImprovement++;
    });

    // Calculate OKR completion trend from real data
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const okrHistory = [];
    
    // Group OKRs by month and calculate average completion
    const currentYear = new Date().getFullYear();
    for (let i = 0; i <= new Date().getMonth(); i++) {
      const monthOkrs = okrs.filter(okr => {
        const okrDate = new Date(okr.createdAt);
        return okrDate.getMonth() === i && okrDate.getFullYear() === currentYear;
      });
      
      let avgProgress = 0;
      if (monthOkrs.length > 0) {
        const totalProgress = monthOkrs.reduce((sum, okr) => {
          // Calculate progress based on key results
          let okrProgress = 0;
          let krCount = 0;
          okr.objectives?.forEach(obj => {
            obj.keyResults?.forEach(kr => {
              if (kr.targetValue > 0) {
                okrProgress += Math.min((kr.currentValue / kr.targetValue) * 100, 100);
                krCount++;
              }
            });
          });
          return sum + (krCount > 0 ? okrProgress / krCount : 0);
        }, 0);
        avgProgress = Math.round(totalProgress / monthOkrs.length);
      }
      
      okrHistory.push({
        month: months[i],
        avg: avgProgress
      });
    }

    return res.json({
      success: true,
      data: {
        performanceDistribution: [
          { name: 'Exceeds', count: distribution.exceeds },
          { name: 'Meets', count: distribution.meets },
          { name: 'Needs Imp.', count: distribution.needsImprovement }
        ],
        okrCompletionHistory: okrHistory
      }
    });
  } catch (error) {
    console.error('Error fetching team analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch team analytics'
    });
  }
});

// GET /api/analytics/dashboard - Get dashboard analytics summary (real data only)
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    
    // Get user's OKRs from database
    let okrs = [];
    if (userId) {
      okrs = await OKR.find({ ownerId: userId });
    } else {
      okrs = await OKR.find({}).limit(10);
    }
    
    const totalKRs = okrs.reduce((acc, okr) => 
      acc + (okr.objectives?.reduce((a, o) => a + (o.keyResults?.length || 0), 0) || 0), 0);
    const completedKRs = okrs.reduce((acc, okr) => 
      acc + (okr.objectives?.reduce((a, o) => 
        a + (o.keyResults?.filter(kr => kr.currentValue >= kr.targetValue).length || 0), 0) || 0), 0);

    // Get pending reviews from database
    let reviews = [];
    if (userId) {
      reviews = await PerformanceReview.find({
        $or: [{ userId }, { managerId: userId }],
        status: { $nin: ['completed'] }
      });
    } else {
      reviews = await PerformanceReview.find({ status: { $nin: ['completed'] } }).limit(10);
    }

    // Get recent feedback from database (last 30 days)
    let feedback = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (userId) {
      feedback = await Feedback.find({
        receiverId: userId,
        createdAt: { $gte: thirtyDaysAgo }
      });
    } else {
      feedback = await Feedback.find({ createdAt: { $gte: thirtyDaysAgo } }).limit(10);
    }

    // Count OKRs with upcoming deadlines (next 7 days)
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = okrs.filter(okr => {
      // Check if any key result has a deadline in the next 7 days
      return okr.objectives?.some(obj => 
        obj.keyResults?.some(kr => 
          kr.deadline && new Date(kr.deadline) <= sevenDaysFromNow && new Date(kr.deadline) >= new Date()
        )
      );
    }).length;

    return res.json({
      success: true,
      data: {
        okrProgress: totalKRs > 0 ? Math.round((completedKRs / totalKRs) * 100) : 0,
        pendingReviews: reviews.length,
        recentFeedback: feedback.length,
        totalOkrs: okrs.length,
        completedOkrs: okrs.filter(o => o.status === 'closed').length,
        upcomingDeadlines: upcomingDeadlines
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics'
    });
  }
});

module.exports = router;






