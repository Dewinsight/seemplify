const express = require('express');
const router = express.Router();
const feedbackFormController = require('../controllers/feedbackFormController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

// ==================== TEMPLATE ROUTES ====================

// Create template
router.post('/templates', authMiddleware, requireOrganization, feedbackFormController.createTemplate);

// Get all templates
router.get('/templates', authMiddleware, requireOrganization, feedbackFormController.getTemplates);

// Get template by ID
router.get('/templates/:id', authMiddleware, requireOrganization, feedbackFormController.getTemplateById);

// Update template
router.put('/templates/:id', authMiddleware, requireOrganization, feedbackFormController.updateTemplate);

// Delete template
router.delete('/templates/:id', authMiddleware, requireOrganization, feedbackFormController.deleteTemplate);

// Duplicate template
router.post('/templates/:id/duplicate', authMiddleware, requireOrganization, feedbackFormController.duplicateTemplate);

// ==================== CUSTOM FIELD ROUTES ====================

// Create custom field
router.post('/custom-fields', authMiddleware, requireOrganization, feedbackFormController.createCustomField);

// Get all custom fields
router.get('/custom-fields', authMiddleware, requireOrganization, feedbackFormController.getCustomFields);

// Get custom field by ID
router.get('/custom-fields/:id', authMiddleware, requireOrganization, feedbackFormController.getCustomFieldById);

// Update custom field
router.put('/custom-fields/:id', authMiddleware, requireOrganization, feedbackFormController.updateCustomField);

// Delete custom field
router.delete('/custom-fields/:id', authMiddleware, requireOrganization, feedbackFormController.deleteCustomField);

module.exports = router;

