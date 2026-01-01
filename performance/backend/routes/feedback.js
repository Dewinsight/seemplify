const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');
const { 
  requireAuth, 
  requirePermission,
  requireManager 
} = require('../middleware/rbac');

/**
 * GET /api/feedback - List feedback
 * - Employees see feedback sent to/from them
 * - Line Managers can see direct reports' feedback
 * - HR Admin sees all feedback
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const { type, visibility, userId: queryUserId } = req.query;
    
    let query = {};
    
    // Build query based on role
    if (role === 'hr_admin') {
      // HR Admin can see all feedback
      if (req.currentOrganization?.id) {
        query.organizationId = req.currentOrganization.id;
      }
      if (queryUserId) {
        query.$or = [{ senderId: queryUserId }, { receiverId: queryUserId }];
      }
    } else if (role === 'line_manager') {
      // Line Manager sees own + direct reports' feedback
      const directReports = req.directReports || [];
      query.$or = [
        { senderId: userId },
        { receiverId: userId },
        { senderId: { $in: directReports } },
        { receiverId: { $in: directReports } }
      ];
      // Filter out private feedback not involving self
      query.$and = [
        {
          $or: [
            { visibility: { $ne: 'private' } },
            { senderId: userId },
            { receiverId: userId }
          ]
        }
      ];
    } else {
      // Employee sees feedback they sent or received
      query.$or = [
        { senderId: userId },
        { receiverId: userId }
      ];
    }
    
    // Apply filters
    if (type) query.type = type;
    if (visibility && role === 'hr_admin') query.visibility = visibility;
    
    const feedback = await Feedback.find(query)
      .populate('senderId', 'email profile.displayName')
      .populate('receiverId', 'email profile.displayName')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({
      success: true,
      data: feedback.map(f => ({
        _id: f._id,
        sender: f.senderId?.profile?.displayName || f.senderId?.email || 'Anonymous',
        senderId: f.senderId?._id || f.senderId,
        receiver: f.receiverId?.profile?.displayName || f.receiverId?.email || 'Unknown',
        receiverId: f.receiverId?._id || f.receiverId,
        type: formatFeedbackType(f.type),
        message: f.content,
        visibility: f.visibility,
        sentimentScore: f.sentimentScore,
        date: f.createdAt ? new Date(f.createdAt).toISOString().split('T')[0] : '',
        relatedOkrId: f.relatedOkrId
      })),
      count: feedback.length,
      userRole: role
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
  }
});

/**
 * GET /api/feedback/received - Get feedback received by current user
 */
router.get('/received', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    
    const feedback = await Feedback.find({ receiverId: userId })
      .populate('senderId', 'email profile.displayName')
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({
      success: true,
      data: feedback.map(f => ({
        _id: f._id,
        sender: f.visibility === 'public' 
          ? (f.senderId?.profile?.displayName || f.senderId?.email || 'Unknown')
          : 'Anonymous',
        type: formatFeedbackType(f.type),
        message: f.content,
        date: f.createdAt ? new Date(f.createdAt).toISOString().split('T')[0] : ''
      })),
      count: feedback.length
    });
  } catch (error) {
    console.error('Error fetching received feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
  }
});

/**
 * GET /api/feedback/sent - Get feedback sent by current user
 */
router.get('/sent', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    
    const feedback = await Feedback.find({ senderId: userId })
      .populate('receiverId', 'email profile.displayName')
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({
      success: true,
      data: feedback.map(f => ({
        _id: f._id,
        receiver: f.receiverId?.profile?.displayName || f.receiverId?.email || 'Unknown',
        type: formatFeedbackType(f.type),
        message: f.content,
        date: f.createdAt ? new Date(f.createdAt).toISOString().split('T')[0] : ''
      })),
      count: feedback.length
    });
  } catch (error) {
    console.error('Error fetching sent feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
  }
});

/**
 * GET /api/feedback/direct-reports - Get feedback for direct reports
 * Line Manager only
 */
router.get('/direct-reports', requireManager, async (req, res) => {
  try {
    const directReports = req.directReports || [];
    
    if (directReports.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No direct reports found'
      });
    }
    
    // Get feedback received by direct reports (excluding private)
    const feedback = await Feedback.find({
      receiverId: { $in: directReports },
      visibility: { $ne: 'private' }
    })
      .populate('senderId', 'email profile.displayName')
      .populate('receiverId', 'email profile.displayName')
      .sort({ createdAt: -1 })
      .limit(50);
    
    // Group by receiver
    const feedbackByUser = {};
    feedback.forEach(f => {
      const receiverId = f.receiverId?._id?.toString() || f.receiverId?.toString();
      if (!feedbackByUser[receiverId]) {
        feedbackByUser[receiverId] = {
          userName: f.receiverId?.profile?.displayName || f.receiverId?.email,
          feedback: []
        };
      }
      feedbackByUser[receiverId].feedback.push({
        _id: f._id,
        sender: f.senderId?.profile?.displayName || f.senderId?.email || 'Anonymous',
        type: formatFeedbackType(f.type),
        message: f.content,
        sentimentScore: f.sentimentScore,
        date: f.createdAt
      });
    });
    
    res.json({
      success: true,
      data: feedbackByUser,
      directReportCount: directReports.length
    });
  } catch (error) {
    console.error('Error fetching direct reports feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
  }
});

/**
 * GET /api/feedback/:id - Get specific feedback
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id)
      .populate('senderId', 'email profile.displayName')
      .populate('receiverId', 'email profile.displayName');
    
    if (!feedback) {
      return res.status(404).json({ success: false, error: 'Feedback not found' });
    }
    
    // Check access
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const directReports = req.directReports || [];
    
    const isSender = feedback.senderId?._id?.toString() === userId || feedback.senderId?.toString() === userId;
    const isReceiver = feedback.receiverId?._id?.toString() === userId || feedback.receiverId?.toString() === userId;
    const isDirectReportFeedback = directReports.includes(feedback.receiverId?._id?.toString()) && 
                                   feedback.visibility !== 'private';
    const isHRAdmin = role === 'hr_admin';
    
    if (!isSender && !isReceiver && !isDirectReportFeedback && !isHRAdmin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied to this feedback' 
      });
    }
    
    res.json({ success: true, data: feedback });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
  }
});

/**
 * POST /api/feedback - Send new feedback
 */
router.post('/', requirePermission('feedback:send'), async (req, res) => {
  try {
    const senderId = req.session.user.id || req.session.user.sub;
    const { receiverId, content, type, visibility, relatedOkrId } = req.body;
    
    if (!receiverId || !content) {
      return res.status(400).json({ 
        success: false, 
        error: 'Receiver and content are required' 
      });
    }
    
    // Manager-only visibility requires line manager role
    if (visibility === 'manager-only' && req.userRole !== 'line_manager' && req.userRole !== 'hr_admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only managers can send manager-only feedback' 
      });
    }
    
    const newFeedback = new Feedback({
      senderId,
      receiverId,
      content,
      type: type || 'general',
      visibility: visibility || 'public',
      relatedOkrId,
      organizationId: req.currentOrganization?.id
    });
    
    await newFeedback.save();
    
    // Populate sender/receiver for response
    await newFeedback.populate('senderId', 'email profile.displayName');
    await newFeedback.populate('receiverId', 'email profile.displayName');
    
    res.status(201).json({ 
      success: true, 
      data: {
        _id: newFeedback._id,
        sender: newFeedback.senderId?.profile?.displayName || newFeedback.senderId?.email,
        receiver: newFeedback.receiverId?.profile?.displayName || newFeedback.receiverId?.email,
        type: formatFeedbackType(newFeedback.type),
        message: newFeedback.content,
        visibility: newFeedback.visibility,
        date: newFeedback.createdAt
      },
      message: 'Feedback sent successfully'
    });
  } catch (error) {
    console.error('Error sending feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to send feedback' });
  }
});

/**
 * DELETE /api/feedback/:id - Delete feedback
 * Only sender or HR Admin can delete
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    
    if (!feedback) {
      return res.status(404).json({ success: false, error: 'Feedback not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const isSender = feedback.senderId?.toString() === userId;
    
    if (!isSender && req.userRole !== 'hr_admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the sender or HR Admin can delete feedback' 
      });
    }
    
    await Feedback.findByIdAndDelete(req.params.id);
    
    res.json({ success: true, message: 'Feedback deleted successfully' });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to delete feedback' });
  }
});

// Helper function
function formatFeedbackType(type) {
  const typeMap = {
    'praise': 'Positive',
    'coaching': 'Constructive',
    'general': 'General'
  };
  return typeMap[type] || type || 'General';
}

module.exports = router;
