const express = require('express');
const router = express.Router();
const grantController = require('../controllers/grantController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * @route GET /api/grant/reauth/callback
 * @desc Handle OAuth callback for re-authentication
 * @access Public (no auth middleware needed for OAuth callback)
 */
router.get('/reauth/callback', grantController.handleReauthCallback);

// Apply authentication middleware to all other routes
router.use(authMiddleware);

/**
 * @route GET /api/grant/status
 * @desc Get current user's grant status
 * @access Private
 */
router.get('/status', grantController.checkGrantStatus);

/**
 * @route GET /api/grant/usage
 * @desc Get live system calendar capacity without exposing other users
 * @access Private
 */
router.get('/usage', grantController.getGrantUsage);

/**
 * @route POST /api/grant/verify
 * @desc Verify current user's grant with OAuth provider
 * @access Private
 */
router.post('/verify', grantController.verifyGrant);

/**
 * @route POST /api/grant/reauth
 * @desc Generate re-authentication URL for current user
 * @access Private
 * @body { provider?: string } - OAuth provider (default: 'google')
 */
router.post('/reauth', grantController.generateReauthUrl);

/**
 * @route DELETE /api/grant/revoke
 * @desc Revoke current user's grant
 * @access Private
 */
router.delete('/revoke', grantController.revokeGrant);

/**
 * @route GET /api/grant/history
 * @desc Get grant verification history for current user
 * @access Private
 */
router.get('/history', grantController.getGrantHistory);

// Admin routes
/**
 * @route POST /api/grant/admin/verify-all
 * @desc Verify all user grants (admin only)
 * @access Admin
 */
router.post('/admin/verify-all', grantController.verifyAllGrants);

/**
 * @route POST /api/grant/admin/force-refresh/:userId
 * @desc Force refresh a specific user's grant (admin only)
 * @access Admin
 */
router.post('/admin/force-refresh/:userId', grantController.forceGrantRefresh);

module.exports = router;
