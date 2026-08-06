const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const creditPackController = require('../controllers/creditPackController');

// Get all active credit packs
router.get('/', authMiddleware, creditPackController.getCreditPacks);

// Get specific credit pack by ID or code
router.get('/:identifier', authMiddleware, creditPackController.getCreditPackById);

// Create a credit purchase request
router.post('/purchase-request', authMiddleware, requireOrganization, creditPackController.createPurchaseRequest);

// Get purchase requests for current organization
router.get('/purchase-requests/organization', authMiddleware, requireOrganization, creditPackController.getOrganizationPurchaseRequests);

// Cancel a purchase request
router.delete('/purchase-requests/:requestId', authMiddleware, creditPackController.cancelPurchaseRequest);

module.exports = router;

