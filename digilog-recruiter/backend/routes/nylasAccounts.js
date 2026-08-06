const express = require('express');
const router = express.Router();
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const nylasAccountsController = require('../controllers/nylasAccountsController');

// Apply admin authentication to all routes
router.use(adminAuth);
router.use(requirePermission('systemSettings')); // Only admins with system settings permission

// Nylas account management routes
router.get('/', nylasAccountsController.listAccounts);
router.post('/', nylasAccountsController.createAccount);
router.put('/:accountId', nylasAccountsController.updateAccount);
router.delete('/:accountId', nylasAccountsController.deleteAccount);

// Testing routes
router.post('/test-credentials', nylasAccountsController.testCredentialsOnly);
router.post('/:accountId/test', nylasAccountsController.testAccount);

module.exports = router;
