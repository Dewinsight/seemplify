const express = require('express');
const router = express.Router();
const { PerformanceReview } = require('../models/PerformanceReview');
const ReviewCycle = require('../models/ReviewCycle');
const { 
  requireAuth, 
  requirePermission, 
  requireManager,
  requireHRAdmin 
} = require('../middleware/rbac');

/**
 * GET /api/reviews - List performance reviews
 * - Employees see their own reviews
 * - Line Managers see direct reports' reviews
 * - HR Admin sees all reviews
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const { cycleId, status, userId: queryUserId } = req.query;
    
    let query = {};
    
    // Build query based on role
    if (role === 'hr_admin') {
      // HR Admin can see all reviews in organization
      if (req.currentOrganization?.id) {
        query.organizationId = req.currentOrganization.id;
      }
      if (queryUserId) {
        query.$or = [{ userId: queryUserId }, { managerId: queryUserId }];
      }
    } else if (role === 'line_manager') {
      // Line Manager sees reviews where they are manager or employee
      const directReports = req.directReports || [];
      query.$or = [
        { userId: userId }, // Own reviews
        { managerId: userId }, // Reviews they need to conduct
        { userId: { $in: directReports } } // Direct reports' reviews
      ];
    } else {
      // Employee sees only own reviews
      query.userId = userId;
    }
    
    // Apply filters
    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;
    
    const reviews = await PerformanceReview.find(query)
      .populate('cycleId', 'title type startDate endDate status')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({
      success: true,
      data: reviews.map(r => ({
        _id: r._id,
        cycleName: r.cycleId?.title || 'Review Cycle',
        cycleType: r.cycleId?.type,
        status: formatReviewStatus(r.status),
        type: r.userId === userId ? 'Self Review' : 'Manager Review',
        userId: r.userId,
        managerId: r.managerId,
        dueDate: r.cycleId?.endDate ? new Date(r.cycleId.endDate).toISOString().split('T')[0] : '',
        selfEvaluation: r.selfEvaluation,
        managerEvaluation: r.managerEvaluation,
        createdAt: r.createdAt
      })),
      count: reviews.length,
      userRole: role
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});

/**
 * GET /api/reviews/pending - Get reviews pending manager action
 * For Line Managers only
 */
router.get('/pending', requireManager, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    
    // Reviews where self-evaluation is done but manager review is not
    const reviews = await PerformanceReview.find({
      managerId: userId,
      'selfEvaluation.submittedAt': { $exists: true },
      'managerEvaluation.submittedAt': { $exists: false }
    })
      .populate('cycleId', 'title endDate')
      .sort({ 'selfEvaluation.submittedAt': 1 });
    
    res.json({
      success: true,
      data: reviews.map(r => ({
        _id: r._id,
        userId: r.userId,
        cycleName: r.cycleId?.title,
        selfSubmittedAt: r.selfEvaluation?.submittedAt,
        dueDate: r.cycleId?.endDate
      })),
      count: reviews.length
    });
  } catch (error) {
    console.error('Error fetching pending reviews:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending reviews' });
  }
});

/**
 * GET /api/reviews/direct-reports - Get direct reports' review status
 * For Line Managers only
 */
router.get('/direct-reports', requireManager, async (req, res) => {
  try {
    const directReports = req.directReports || [];
    const { cycleId } = req.query;
    
    if (directReports.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No direct reports found'
      });
    }
    
    let query = { userId: { $in: directReports } };
    if (cycleId) query.cycleId = cycleId;
    
    const reviews = await PerformanceReview.find(query)
      .populate('cycleId', 'title')
      .sort({ createdAt: -1 });
    
    // Group by user
    const reviewsByUser = {};
    reviews.forEach(r => {
      if (!reviewsByUser[r.userId]) {
        reviewsByUser[r.userId] = [];
      }
      reviewsByUser[r.userId].push({
        _id: r._id,
        cycleName: r.cycleId?.title,
        selfDone: !!r.selfEvaluation?.submittedAt,
        managerDone: !!r.managerEvaluation?.submittedAt,
        status: r.status
      });
    });
    
    res.json({
      success: true,
      data: reviewsByUser,
      directReportCount: directReports.length
    });
  } catch (error) {
    console.error('Error fetching direct reports reviews:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch direct reports reviews' });
  }
});

/**
 * GET /api/reviews/:id - Get specific review
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const review = await PerformanceReview.findById(req.params.id)
      .populate('cycleId');
    
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    
    // Check access
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const directReports = req.directReports || [];
    
    const isEmployee = review.userId === userId;
    const isManager = review.managerId === userId;
    const isDirectReport = directReports.includes(review.userId);
    const isHRAdmin = role === 'hr_admin';
    
    if (!isEmployee && !isManager && !isDirectReport && !isHRAdmin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied to this review' 
      });
    }
    
    res.json({ 
      success: true, 
      data: review,
      permissions: {
        canEditSelf: isEmployee && !review.selfEvaluation?.submittedAt,
        canEditManager: (isManager || isHRAdmin) && review.selfEvaluation?.submittedAt,
        canView: true
      }
    });
  } catch (error) {
    console.error('Error fetching review:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch review' });
  }
});

/**
 * POST /api/reviews/:id/self-evaluation - Submit self evaluation
 * Employee only
 */
router.post('/:id/self-evaluation', requireAuth, async (req, res) => {
  try {
    const review = await PerformanceReview.findById(req.params.id)
      .populate('cycleId');
    
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    
    if (review.userId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the employee can submit self-evaluation' 
      });
    }
    
    // Check if cycle allows self review
    if (review.cycleId && !review.cycleId.canSubmitSelfReview()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Self-review period has ended' 
      });
    }
    
    const { content, rating, responses } = req.body;
    
    review.selfEvaluation = {
      content,
      rating,
      responses,
      submittedAt: new Date()
    };
    
    review.status = 'submitted';
    await review.save();
    
    res.json({ 
      success: true, 
      data: review,
      message: 'Self-evaluation submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting self-evaluation:', error);
    res.status(500).json({ success: false, error: 'Failed to submit self-evaluation' });
  }
});

/**
 * POST /api/reviews/:id/manager-evaluation - Submit manager evaluation
 * Line Manager or HR Admin only
 */
router.post('/:id/manager-evaluation', requireManager, async (req, res) => {
  try {
    const review = await PerformanceReview.findById(req.params.id)
      .populate('cycleId');
    
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    
    // Only assigned manager or HR Admin can submit
    if (review.managerId !== userId && role !== 'hr_admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the assigned manager can submit manager evaluation' 
      });
    }
    
    // Check if self-evaluation is done (required before manager review)
    if (!review.selfEvaluation?.submittedAt) {
      return res.status(400).json({ 
        success: false, 
        error: 'Self-evaluation must be completed first' 
      });
    }
    
    const { content, rating, responses, aiSummary } = req.body;
    
    review.managerEvaluation = {
      content,
      rating,
      responses,
      aiSummary,
      submittedAt: new Date()
    };
    
    review.status = 'completed';
    await review.save();
    
    res.json({ 
      success: true, 
      data: review,
      message: 'Manager evaluation submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting manager evaluation:', error);
    res.status(500).json({ success: false, error: 'Failed to submit manager evaluation' });
  }
});

/**
 * POST /api/reviews/:id/request-peer-review - Request peer review
 * Employee can request peer reviews for their own review
 */
router.post('/:id/request-peer-review', requireAuth, async (req, res) => {
  try {
    const review = await PerformanceReview.findById(req.params.id);
    
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    
    if (review.userId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the employee or HR Admin can request peer reviews' 
      });
    }
    
    const { peerIds } = req.body;
    
    if (!peerIds || !Array.isArray(peerIds)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Peer IDs required' 
      });
    }
    
    // Add peer review requests
    peerIds.forEach(peerId => {
      if (!review.peerReviews.find(p => p.reviewerId === peerId)) {
        review.peerReviews.push({
          reviewerId: peerId,
          status: 'requested'
        });
      }
    });
    
    await review.save();
    
    res.json({ 
      success: true, 
      data: review,
      message: 'Peer review requests sent'
    });
  } catch (error) {
    console.error('Error requesting peer review:', error);
    res.status(500).json({ success: false, error: 'Failed to request peer review' });
  }
});

// ============== REVIEW CYCLE MANAGEMENT (HR ADMIN) ==============

/**
 * GET /api/reviews/cycles - List review cycles
 */
router.get('/cycles', requireAuth, async (req, res) => {
  try {
    let query = {};
    
    if (req.currentOrganization?.id) {
      query.organizationId = req.currentOrganization.id;
    }
    
    const cycles = await ReviewCycle.find(query)
      .sort({ startDate: -1 })
      .limit(20);
    
    res.json({
      success: true,
      data: cycles,
      count: cycles.length
    });
  } catch (error) {
    console.error('Error fetching review cycles:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch review cycles' });
  }
});

/**
 * POST /api/reviews/cycles - Create review cycle
 * HR Admin only
 */
router.post('/cycles', requireHRAdmin, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const { title, description, type, startDate, endDate, phases, settings, questions } = req.body;
    
    const cycle = new ReviewCycle({
      title,
      description,
      organizationId: req.currentOrganization?.id,
      type: type || 'manager-only',
      startDate,
      endDate,
      phases,
      settings,
      questions,
      status: 'draft',
      createdBy: userId
    });
    
    await cycle.save();
    
    res.status(201).json({ 
      success: true, 
      data: cycle,
      message: 'Review cycle created successfully'
    });
  } catch (error) {
    console.error('Error creating review cycle:', error);
    res.status(500).json({ success: false, error: 'Failed to create review cycle' });
  }
});

/**
 * PUT /api/reviews/cycles/:id - Update review cycle
 * HR Admin only
 */
router.put('/cycles/:id', requireHRAdmin, async (req, res) => {
  try {
    const cycle = await ReviewCycle.findById(req.params.id);
    
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Review cycle not found' });
    }
    
    const updates = req.body;
    Object.keys(updates).forEach(key => {
      if (key !== '_id' && key !== 'createdBy' && key !== 'organizationId') {
        cycle[key] = updates[key];
      }
    });
    
    await cycle.save();
    
    res.json({ success: true, data: cycle });
  } catch (error) {
    console.error('Error updating review cycle:', error);
    res.status(500).json({ success: false, error: 'Failed to update review cycle' });
  }
});

/**
 * POST /api/reviews/cycles/:id/activate - Activate review cycle and create reviews
 * HR Admin only
 */
router.post('/cycles/:id/activate', requireHRAdmin, async (req, res) => {
  try {
    const cycle = await ReviewCycle.findById(req.params.id);
    
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Review cycle not found' });
    }
    
    if (cycle.status !== 'draft' && cycle.status !== 'planning') {
      return res.status(400).json({ 
        success: false, 
        error: 'Can only activate draft or planning cycles' 
      });
    }
    
    cycle.status = 'active';
    await cycle.save();
    
    // Note: In production, you would create individual reviews for each employee
    // This would be done via a background job or by fetching all employees from IdP
    
    res.json({ 
      success: true, 
      data: cycle,
      message: 'Review cycle activated successfully'
    });
  } catch (error) {
    console.error('Error activating review cycle:', error);
    res.status(500).json({ success: false, error: 'Failed to activate review cycle' });
  }
});

// Helper function
function formatReviewStatus(status) {
  const statusMap = {
    'draft': 'Not Started',
    'submitted': 'Self Review Done',
    'manager-review': 'Manager Review',
    'completed': 'Completed'
  };
  return statusMap[status] || status;
}

module.exports = router;
