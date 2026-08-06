const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const notificationController = require('../controllers/notificationController');

// Apply auth middleware to all routes
router.use(authMiddleware);

// @route   GET /api/notifications
// @desc    Get user notifications
// @access  Private
router.get('/', notificationController.getUserNotifications);

// @route   GET /api/notifications/unread-count
// @desc    Get unread notification count
// @access  Private
router.get('/unread-count', notificationController.getUnreadCount);

// @route   PUT /api/notifications/:notificationId/read
// @desc    Mark notification as read
// @access  Private
router.put('/:notificationId/read', notificationController.markAsRead);

// @route   PUT /api/notifications/mark-all-read
// @desc    Mark all notifications as read
// @access  Private
router.put('/mark-all-read', notificationController.markAllAsRead);

// @route   DELETE /api/notifications/:notificationId
// @desc    Delete notification
// @access  Private
router.delete('/:notificationId', notificationController.deleteNotification);

// @route   POST /api/notifications/test
// @desc    Create test notification (for development)
// @access  Private
router.post('/test', notificationController.createTestNotification);

// @route   GET /api/notifications/recent-activities
// @desc    Get recent activities for dashboard
// @access  Private
router.get('/recent-activities', notificationController.getRecentActivities);

module.exports = router;
