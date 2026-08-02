const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const planController = require('../controllers/planController');

// Public routes (no authentication required)
router.get('/published', planController.getPublishedPlans);
router.get('/code/:planCode', planController.getPlanByCode);

// Admin routes (requires admin authentication)
router.get('/', adminAuth, planController.getPlans);
router.get('/:planId', adminAuth, planController.getPlanById);

// Admin routes (requires admin authentication)
router.post('/', adminAuth, planController.createPlan);
router.put('/:planId', adminAuth, planController.updatePlan);
router.delete('/:planId', adminAuth, planController.deletePlan);
router.get('/:planId/stats', adminAuth, planController.getPlanUsageStats);

module.exports = router;

