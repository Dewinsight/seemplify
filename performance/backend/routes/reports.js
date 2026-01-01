const express = require('express');
const router = express.Router();
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const Feedback = require('../models/Feedback');
const ReviewCycle = require('../models/ReviewCycle');
const OneOnOne = require('../models/OneOnOne');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const { requireAuth, requireManager, requireHRAdmin } = require('../middleware/rbac');

/**
 * GET /api/reports/org-summary - Organization performance summary
 */
router.get('/org-summary', requireHRAdmin, async (req, res) => {
  try {
    const orgId = req.currentOrganization?.id;
    
    // OKR stats
    const okrStats = await OKR.aggregate([
      { $match: orgId ? { organizationId: orgId } : {} },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgProgress: { $avg: '$progress' }
        }
      }
    ]);
    
    // Review stats
    const reviewStats = await PerformanceReview.aggregate([
      { $match: {} },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Feedback stats
    const feedbackStats = await Feedback.aggregate([
      { $match: orgId ? { organizationId: orgId } : {} },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Recent activity
    const recentOkrs = await OKR.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    const recentFeedback = await Feedback.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    res.json({
      success: true,
      data: {
        okrs: {
          byStatus: okrStats,
          total: okrStats.reduce((sum, s) => sum + s.count, 0),
          recentMonth: recentOkrs
        },
        reviews: {
          byStatus: reviewStats,
          total: reviewStats.reduce((sum, s) => sum + s.count, 0)
        },
        feedback: {
          byType: feedbackStats,
          total: feedbackStats.reduce((sum, s) => sum + s.count, 0),
          recentMonth: recentFeedback
        }
      }
    });
  } catch (error) {
    console.error('Error generating org summary:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/team-performance - Team performance report
 */
router.get('/team-performance', requireManager, async (req, res) => {
  try {
    const directReports = req.directReports || [];
    const { teamId, period } = req.query;
    
    if (directReports.length === 0) {
      return res.json({ success: true, data: { message: 'No direct reports' } });
    }
    
    // OKR progress by team member
    let okrQuery = { ownerId: { $in: directReports } };
    if (period) okrQuery.period = period;
    
    const okrsByMember = await OKR.aggregate([
      { $match: okrQuery },
      {
        $group: {
          _id: '$ownerId',
          totalOkrs: { $sum: 1 },
          avgProgress: { $avg: '$progress' },
          activeOkrs: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
        }
      }
    ]);
    
    // Feedback received by team
    const feedbackByMember = await Feedback.aggregate([
      { $match: { receiverId: { $in: directReports } } },
      {
        $group: {
          _id: '$receiverId',
          totalReceived: { $sum: 1 },
          positiveFeedback: { $sum: { $cond: [{ $eq: ['$type', 'praise'] }, 1, 0] } }
        }
      }
    ]);
    
    // Review completion status
    const reviewStats = await PerformanceReview.aggregate([
      { $match: { userId: { $in: directReports } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        teamSize: directReports.length,
        okrs: okrsByMember,
        feedback: feedbackByMember,
        reviews: reviewStats,
        avgTeamProgress: okrsByMember.length > 0 
          ? Math.round(okrsByMember.reduce((sum, m) => sum + (m.avgProgress || 0), 0) / okrsByMember.length)
          : 0
      }
    });
  } catch (error) {
    console.error('Error generating team report:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/individual/:userId - Individual performance report
 */
router.get('/individual/:userId', requireAuth, async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const directReports = req.directReports || [];
    
    // Check access
    const isSelf = targetUserId === currentUserId;
    const isDirectReport = directReports.includes(targetUserId);
    const isHRAdmin = role === 'hr_admin';
    
    if (!isSelf && !isDirectReport && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    // Get OKRs
    const okrs = await OKR.find({ ownerId: targetUserId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get reviews
    const reviews = await PerformanceReview.find({ userId: targetUserId })
      .populate('cycleId', 'title')
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get feedback received
    const feedback = await Feedback.find({ receiverId: targetUserId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get 1:1 meetings
    const meetings = await OneOnOne.find({
      $or: [{ managerId: targetUserId }, { employeeId: targetUserId }]
    }).sort({ scheduledDate: -1 }).limit(5);
    
    // Get development plan
    const devPlan = await DevelopmentPlan.findOne({
      userId: targetUserId,
      status: 'active'
    });
    
    // Calculate stats
    const activeOkrs = okrs.filter(o => o.status === 'active');
    const avgOkrProgress = activeOkrs.length > 0
      ? Math.round(activeOkrs.reduce((sum, o) => sum + (o.progress || 0), 0) / activeOkrs.length)
      : 0;
    
    const positiveFeedback = feedback.filter(f => f.type === 'praise').length;
    const constructiveFeedback = feedback.filter(f => f.type === 'coaching').length;
    
    res.json({
      success: true,
      data: {
        stats: {
          totalOkrs: okrs.length,
          activeOkrs: activeOkrs.length,
          avgOkrProgress,
          totalReviews: reviews.length,
          feedbackReceived: feedback.length,
          positiveFeedback,
          constructiveFeedback,
          meetingsLast30Days: meetings.filter(m => 
            new Date(m.scheduledDate) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          ).length
        },
        recentOkrs: okrs.slice(0, 5).map(o => ({
          id: o._id,
          title: o.objectives?.[0]?.title || 'Untitled',
          progress: o.progress || 0,
          status: o.status,
          period: o.period
        })),
        recentReviews: reviews.map(r => ({
          id: r._id,
          cycleName: r.cycleId?.title,
          status: r.status,
          selfRating: r.selfEvaluation?.rating,
          managerRating: r.managerEvaluation?.rating
        })),
        recentFeedback: feedback.slice(0, 5).map(f => ({
          id: f._id,
          type: f.type,
          date: f.createdAt
        })),
        developmentPlan: devPlan ? {
          id: devPlan._id,
          title: devPlan.title,
          progress: devPlan.overallProgress,
          status: devPlan.status
        } : null
      }
    });
  } catch (error) {
    console.error('Error generating individual report:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/review-cycle/:cycleId - Review cycle analytics
 */
router.get('/review-cycle/:cycleId', requireHRAdmin, async (req, res) => {
  try {
    const cycleId = req.params.cycleId;
    
    const cycle = await ReviewCycle.findById(cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    
    const reviews = await PerformanceReview.find({ cycleId });
    
    // Status breakdown
    const statusBreakdown = {};
    reviews.forEach(r => {
      statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
    });
    
    // Rating distribution
    const selfRatings = reviews.filter(r => r.selfEvaluation?.rating).map(r => r.selfEvaluation.rating);
    const managerRatings = reviews.filter(r => r.managerEvaluation?.rating).map(r => r.managerEvaluation.rating);
    
    const avgSelfRating = selfRatings.length > 0 
      ? Math.round((selfRatings.reduce((a, b) => a + b, 0) / selfRatings.length) * 10) / 10
      : null;
    const avgManagerRating = managerRatings.length > 0 
      ? Math.round((managerRatings.reduce((a, b) => a + b, 0) / managerRatings.length) * 10) / 10
      : null;
    
    // Completion rates
    const selfCompleted = reviews.filter(r => r.selfEvaluation?.submittedAt).length;
    const managerCompleted = reviews.filter(r => r.managerEvaluation?.submittedAt).length;
    
    res.json({
      success: true,
      data: {
        cycle: {
          id: cycle._id,
          title: cycle.title,
          status: cycle.status,
          startDate: cycle.startDate,
          endDate: cycle.endDate
        },
        totals: {
          totalReviews: reviews.length,
          selfCompleted,
          managerCompleted,
          fullyCompleted: reviews.filter(r => r.status === 'completed').length
        },
        completionRates: {
          selfReview: reviews.length > 0 ? Math.round((selfCompleted / reviews.length) * 100) : 0,
          managerReview: reviews.length > 0 ? Math.round((managerCompleted / reviews.length) * 100) : 0
        },
        ratings: {
          avgSelfRating,
          avgManagerRating,
          ratingGap: avgSelfRating && avgManagerRating 
            ? Math.round((avgSelfRating - avgManagerRating) * 10) / 10 
            : null
        },
        statusBreakdown
      }
    });
  } catch (error) {
    console.error('Error generating cycle report:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/okr-trends - OKR progress trends over time
 */
router.get('/okr-trends', requireHRAdmin, async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const monthsAgo = parseInt(months);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsAgo);
    
    const okrs = await OKR.find({
      createdAt: { $gte: startDate }
    }).sort({ createdAt: 1 });
    
    // Group by month
    const monthlyData = {};
    okrs.forEach(okr => {
      const month = new Date(okr.createdAt).toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = { count: 0, totalProgress: 0, completed: 0 };
      }
      monthlyData[month].count++;
      monthlyData[month].totalProgress += okr.progress || 0;
      if (okr.status === 'closed') monthlyData[month].completed++;
    });
    
    const trends = Object.entries(monthlyData).map(([month, data]) => ({
      month,
      okrsCreated: data.count,
      avgProgress: data.count > 0 ? Math.round(data.totalProgress / data.count) : 0,
      completionRate: data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0
    }));
    
    res.json({ success: true, data: trends });
  } catch (error) {
    console.error('Error generating OKR trends:', error);
    res.status(500).json({ success: false, error: 'Failed to generate trends' });
  }
});

/**
 * GET /api/reports/feedback-analytics - Feedback analytics
 */
router.get('/feedback-analytics', requireHRAdmin, async (req, res) => {
  try {
    const { months = 3 } = req.query;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));
    
    const feedback = await Feedback.find({
      createdAt: { $gte: startDate }
    });
    
    // Type distribution
    const typeDistribution = {};
    feedback.forEach(f => {
      typeDistribution[f.type] = (typeDistribution[f.type] || 0) + 1;
    });
    
    // Weekly volume
    const weeklyVolume = {};
    feedback.forEach(f => {
      const week = getWeekNumber(new Date(f.createdAt));
      weeklyVolume[week] = (weeklyVolume[week] || 0) + 1;
    });
    
    // Top receivers
    const receiverCounts = {};
    feedback.forEach(f => {
      receiverCounts[f.receiverId] = (receiverCounts[f.receiverId] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: {
        total: feedback.length,
        typeDistribution,
        weeklyVolume: Object.entries(weeklyVolume).map(([week, count]) => ({ week, count })),
        avgPerWeek: Object.values(weeklyVolume).length > 0 
          ? Math.round(feedback.length / Object.values(weeklyVolume).length)
          : 0
      }
    });
  } catch (error) {
    console.error('Error generating feedback analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to generate analytics' });
  }
});

// Helper function
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil((((d - yearStart) / 86400000) + 1) / 7)}`;
}

module.exports = router;






