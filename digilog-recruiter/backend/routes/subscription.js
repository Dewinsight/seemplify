const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adminAuth } = require('../middleware/adminAuth');
const subscriptionController = require('../controllers/subscriptionController');

// User routes
router.post('/request', authMiddleware, subscriptionController.createUpgradeRequest);
router.get('/user-requests', authMiddleware, subscriptionController.getUserRequests);
router.get('/org-requests/:organizationId', authMiddleware, subscriptionController.getOrganizationRequests);
router.delete('/cancel/:requestId', authMiddleware, subscriptionController.cancelRequest);

// Invoice routes (accessible by both users and admins)
router.get('/invoice/:requestId/generate', authMiddleware, subscriptionController.generateInvoice);
router.get('/invoice/:requestId/pdf', subscriptionController.getInvoicePdf); // Public for easy access
router.post('/invoice/:requestId/email', authMiddleware, subscriptionController.emailInvoice);

// Admin routes
router.get('/all', adminAuth, subscriptionController.getAllRequests);
router.put('/:requestId', adminAuth, subscriptionController.updateRequestStatus);
router.put('/:requestId/paid', adminAuth, subscriptionController.markInvoicePaid);

module.exports = router;
