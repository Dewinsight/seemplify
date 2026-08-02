const express = require('express');
const router = express.Router();
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const adminGrantsController = require('../controllers/adminGrantsController');

// Apply admin authentication and permission middleware to all routes
router.use(adminAuth);
router.use(requirePermission('systemSettings')); // Only admins with systemSettings permission

/**
 * @route GET /api/admin/grants
 * @desc List all calendar grants in the organization
 * @access Admin only
 */
router.get('/', adminGrantsController.listOrganizationGrants);

/**
 * @route GET /api/admin/grants/usage
 * @desc Get grant usage statistics
 * @access Admin only
 */
router.get('/usage', adminGrantsController.getGrantUsage);

/**
 * @route POST /api/admin/grants/verify-all
 * @desc Verify all organization grants are still valid in Nylas
 * @access Admin only
 */
router.post('/verify-all', adminGrantsController.verifyAllGrants);

/**
 * @route DELETE /api/admin/grants/:userId
 * @desc Revoke a specific user's calendar grant
 * @access Admin only
 */
router.delete('/:userId', adminGrantsController.revokeUserGrant);

module.exports = router;
