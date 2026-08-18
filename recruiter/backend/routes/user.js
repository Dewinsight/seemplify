const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const userController = require('../controllers/userController');

// Configure multer for avatar uploads
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// @route   GET /api/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', auth, userController.getProfile);

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, userController.updateProfile);

// @route   GET /api/users/analytics
// @desc    Get dashboard analytics
// @access  Private
router.get('/analytics', auth, requireOrganization, userController.getDashboardAnalytics);

// @route   GET /api/users/stats
// @desc    Get user statistics
// @access  Private
router.get('/stats', auth, userController.getUserStats);

// @route   PUT /api/users/preferences
// @desc    Update user preferences
// @access  Private
router.put('/preferences', auth, userController.updatePreferences);

// @route   PUT /api/users/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', auth, userController.changePassword);

// @route   POST /api/users/upload-avatar
// @desc    Upload user avatar
// @access  Private
router.post('/upload-avatar', auth, upload.single('avatar'), userController.uploadAvatar);

// @route   GET /api/users/profile-suggestions
// @desc    Get profile completion suggestions
// @access  Private
router.get('/profile-suggestions', auth, userController.getProfileSuggestions);

module.exports = router;
