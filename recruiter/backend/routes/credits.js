const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const creditsController = require('../controllers/creditsController');

// User routes (requires authentication and organization)
router.get('/status', authMiddleware, requireOrganization, creditsController.getCreditStatus);
router.get('/transactions', authMiddleware, requireOrganization, creditsController.getCreditTransactions);
router.get('/analytics', authMiddleware, requireOrganization, creditsController.getCreditAnalytics);
router.get('/packs', authMiddleware, requireOrganization, creditsController.getCreditPacks);
router.post('/purchase', authMiddleware, requireOrganization, creditsController.purchaseCredits);

// Admin routes (requires admin authentication)
router.post('/admin/:organizationId/adjust', adminAuth, requirePermission('manageLicenses'), creditsController.adjustCredits);
router.post('/admin/:organizationId/reset', adminAuth, requirePermission('manageLicenses'), creditsController.resetCycleCredits);

module.exports = router;

