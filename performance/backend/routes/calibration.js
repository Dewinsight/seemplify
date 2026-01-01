const express = require('express');
const router = express.Router();
const Calibration = require('../models/Calibration');
const { PerformanceReview } = require('../models/PerformanceReview');
const ReviewCycle = require('../models/ReviewCycle');
const { requireHRAdmin } = require('../middleware/rbac');
const AIPerformanceService = require('../services/aiPerformanceService');

/**
 * GET /api/calibration - List calibration sessions
 */
router.get('/', requireHRAdmin, async (req, res) => {
  try {
    let query = {};
    
    if (req.currentOrganization?.id) {
      query.organizationId = req.currentOrganization.id;
    }
    
    const { reviewCycleId, status } = req.query;
    if (reviewCycleId) query.reviewCycleId = reviewCycleId;
    if (status) query.status = status;
    
    const sessions = await Calibration.find(query)
      .populate('reviewCycleId', 'title')
      .sort({ scheduledDate: -1 })
      .limit(50);
    
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error fetching calibration sessions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /api/calibration/:id - Get specific session
 */
router.get('/:id', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id)
      .populate('reviewCycleId');
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
  }
});

/**
 * POST /api/calibration - Create calibration session
 */
router.post('/', requireHRAdmin, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const {
      title, reviewCycleId, scheduledDate, scope, teamIds, departmentIds,
      participants, distributionTargets
    } = req.body;
    
    if (!reviewCycleId) {
      return res.status(400).json({ success: false, error: 'Review cycle required' });
    }
    
    // Get the review cycle
    const cycle = await ReviewCycle.findById(reviewCycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Review cycle not found' });
    }
    
    // Find reviews for this cycle that need calibration
    let reviewQuery = { cycleId: reviewCycleId };
    if (scope === 'team' && teamIds?.length > 0) {
      // Would filter by team if we had team info on reviews
    }
    
    const reviews = await PerformanceReview.find({
      cycleId: reviewCycleId,
      status: { $in: ['submitted', 'manager-review', 'completed'] }
    }).limit(100);
    
    // Map reviews to calibration format
    const reviewsUnderCalibration = reviews.map(r => ({
      reviewId: r._id,
      employeeId: r.userId,
      employeeName: r.userId, // Would be populated with actual name
      managerId: r.managerId,
      managerName: r.managerId,
      originalSelfRating: r.selfEvaluation?.rating,
      originalManagerRating: r.managerEvaluation?.rating,
      calibratedRating: null,
      performanceBucket: null,
      decision: 'pending_review'
    }));
    
    const session = new Calibration({
      title: title || `Calibration - ${cycle.title}`,
      reviewCycleId,
      organizationId: req.currentOrganization?.id,
      scheduledDate,
      scope: scope || 'organization',
      teamIds: teamIds || [],
      departmentIds: departmentIds || [],
      facilitator: { userId, name: req.session.user.name || req.session.user.email },
      participants: participants || [],
      reviewsUnderCalibration,
      distributionTargets: distributionTargets || {
        exceeds: 10, meets_plus: 20, meets: 50, developing: 15, needs_improvement: 5
      },
      status: 'scheduled',
      createdBy: userId
    });
    
    await session.save();
    
    // Update review cycle status
    cycle.status = 'calibration';
    await cycle.save();
    
    res.status(201).json({
      success: true,
      data: session,
      message: 'Calibration session created'
    });
  } catch (error) {
    console.error('Error creating calibration session:', error);
    res.status(500).json({ success: false, error: 'Failed to create session' });
  }
});

/**
 * PUT /api/calibration/:id - Update session
 */
router.put('/:id', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const updates = req.body;
    Object.keys(updates).forEach(key => {
      if (key !== '_id' && key !== 'reviewCycleId' && key !== 'createdBy') {
        session[key] = updates[key];
      }
    });
    
    await session.save();
    
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

/**
 * POST /api/calibration/:id/start - Start calibration session
 */
router.post('/:id/start', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    session.status = 'in_progress';
    await session.save();
    
    res.json({ success: true, data: session, message: 'Calibration started' });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, error: 'Failed to start session' });
  }
});

/**
 * PUT /api/calibration/:id/reviews/:reviewIndex - Update review calibration
 */
router.put('/:id/reviews/:reviewIndex', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const reviewIndex = parseInt(req.params.reviewIndex);
    const review = session.reviewsUnderCalibration[reviewIndex];
    
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const { calibratedRating, performanceBucket, calibrationNotes, decision } = req.body;
    
    // Add to audit log
    const auditEntry = {
      action: 'calibration_update',
      reviewId: review.reviewId?.toString(),
      previousValue: {
        calibratedRating: review.calibratedRating,
        performanceBucket: review.performanceBucket,
        decision: review.decision
      },
      newValue: { calibratedRating, performanceBucket, decision },
      changedBy: userId,
      reason: calibrationNotes
    };
    session.auditLog.push(auditEntry);
    
    // Update review
    if (calibratedRating !== undefined) review.calibratedRating = calibratedRating;
    if (performanceBucket) review.performanceBucket = performanceBucket;
    if (calibrationNotes) review.calibrationNotes = calibrationNotes;
    if (decision) {
      review.decision = decision;
      review.decisionBy = userId;
      review.decisionAt = new Date();
    }
    
    await session.save();
    
    // If decision is 'adjusted', update the actual review
    if (decision === 'adjusted' || decision === 'approved') {
      const actualReview = await PerformanceReview.findById(review.reviewId);
      if (actualReview && calibratedRating !== undefined) {
        actualReview.calibratedRating = calibratedRating;
        actualReview.calibrationNotes = calibrationNotes;
        await actualReview.save();
      }
    }
    
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error updating review calibration:', error);
    res.status(500).json({ success: false, error: 'Failed to update review' });
  }
});

/**
 * POST /api/calibration/:id/ai-insights - Generate AI insights
 */
router.post('/:id/ai-insights', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    // Prepare data for AI analysis
    const ratingsData = session.reviewsUnderCalibration.map(r => ({
      selfRating: r.originalSelfRating,
      managerRating: r.originalManagerRating,
      managerId: r.managerId
    }));
    
    const prompt = `
Analyze this calibration data for potential bias and rating distribution issues:
${JSON.stringify(ratingsData)}

Target distribution: ${JSON.stringify(session.distributionTargets)}

Provide:
1. Analysis of rating distribution vs targets
2. Potential bias flags (e.g., leniency, central tendency by manager)
3. Recommended adjustments

Output JSON with keys: ratingDistributionAnalysis, potentialBiasFlags (array), recommendedAdjustments (array)
`;

    const result = await AIPerformanceService.getCachedOrGenerate(
      `calibration_${session._id}`,
      async () => {
        const azureService = require('../services/azureOpenAIService');
        const response = await azureService.getChatCompletions([
          { role: 'system', content: 'You are an HR analytics expert. Analyze for bias and fairness. Output valid JSON.' },
          { role: 'user', content: prompt }
        ]);
        return AIPerformanceService.parseAIResponse(response.choices[0].message.content);
      }
    );
    
    if (result.success) {
      session.aiInsights = {
        ...result.data,
        generatedAt: new Date()
      };
      await session.save();
    }
    
    res.json({ success: true, data: session.aiInsights });
  } catch (error) {
    console.error('Error generating AI insights:', error);
    res.status(500).json({ success: false, error: 'Failed to generate insights' });
  }
});

/**
 * POST /api/calibration/:id/discussion - Add discussion note
 */
router.post('/:id/discussion', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const { topic, discussion, decision } = req.body;
    
    session.discussionNotes.push({
      topic,
      discussion,
      decision,
      addedBy: userId
    });
    
    await session.save();
    
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error adding discussion:', error);
    res.status(500).json({ success: false, error: 'Failed to add discussion' });
  }
});

/**
 * POST /api/calibration/:id/complete - Complete calibration session
 */
router.post('/:id/complete', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    // Check all reviews have decisions
    const pendingReviews = session.reviewsUnderCalibration.filter(
      r => r.decision === 'pending_review'
    );
    
    if (pendingReviews.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${pendingReviews.length} reviews still pending decision`
      });
    }
    
    session.status = 'completed';
    session.completedAt = new Date();
    
    // Calculate final summary
    const approved = session.reviewsUnderCalibration.filter(r => r.decision === 'approved').length;
    const adjusted = session.reviewsUnderCalibration.filter(r => r.decision === 'adjusted').length;
    
    const originalAvg = session.reviewsUnderCalibration.reduce(
      (sum, r) => sum + (r.originalManagerRating || 0), 0
    ) / session.reviewsUnderCalibration.length;
    
    const calibratedAvg = session.reviewsUnderCalibration.reduce(
      (sum, r) => sum + (r.calibratedRating || r.originalManagerRating || 0), 0
    ) / session.reviewsUnderCalibration.length;
    
    session.summary = {
      totalReviews: session.reviewsUnderCalibration.length,
      reviewsApproved: approved,
      reviewsAdjusted: adjusted,
      averageOriginalRating: Math.round(originalAvg * 10) / 10,
      averageCalibratedRating: Math.round(calibratedAvg * 10) / 10
    };
    
    await session.save();
    
    // Update review cycle to closed
    const cycle = await ReviewCycle.findById(session.reviewCycleId);
    if (cycle) {
      cycle.status = 'closed';
      await cycle.save();
    }
    
    res.json({ success: true, data: session, message: 'Calibration completed' });
  } catch (error) {
    console.error('Error completing session:', error);
    res.status(500).json({ success: false, error: 'Failed to complete session' });
  }
});

/**
 * GET /api/calibration/:id/export - Export calibration results
 */
router.get('/:id/export', requireHRAdmin, async (req, res) => {
  try {
    const session = await Calibration.findById(req.params.id)
      .populate('reviewCycleId');
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    // Return data formatted for export
    const exportData = {
      sessionTitle: session.title,
      reviewCycle: session.reviewCycleId?.title,
      completedAt: session.completedAt,
      summary: session.summary,
      distribution: session.actualDistribution,
      reviews: session.reviewsUnderCalibration.map(r => ({
        employeeId: r.employeeId,
        originalRating: r.originalManagerRating,
        calibratedRating: r.calibratedRating,
        bucket: r.performanceBucket,
        decision: r.decision,
        notes: r.calibrationNotes
      }))
    };
    
    res.json({ success: true, data: exportData });
  } catch (error) {
    console.error('Error exporting calibration:', error);
    res.status(500).json({ success: false, error: 'Failed to export' });
  }
});

module.exports = router;






