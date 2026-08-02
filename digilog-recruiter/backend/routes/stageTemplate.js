const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const stageTemplateService = require('../services/stageTemplateService');

// All routes require authentication and organization context
router.use(authMiddleware);

/**
 * GET /api/organizations/:orgId/stage-templates
 * List all templates for organization
 */
router.get('/:orgId/stage-templates', requireOrganization, async (req, res) => {
  try {
    const { includeInactive } = req.query;
    
    const templates = await stageTemplateService.getTemplatesForOrganization(
      req.params.orgId,
      { includeInactive: includeInactive === 'true' }
    );

    res.json({
      success: true,
      templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * POST /api/organizations/:orgId/stage-templates
 * Create new template
 */
router.post('/:orgId/stage-templates', requireOrganization, async (req, res) => {
  try {
    const { name, description, stages } = req.body;

    if (!name || !stages) {
      return res.status(400).json({
        success: false,
        error: 'Template name and stages are required'
      });
    }

    const template = await stageTemplateService.createTemplate(
      req.params.orgId,
      req.user._id,
      { name, description, stages }
    );

    res.status(201).json({
      success: true,
      template,
      message: 'Template created successfully'
    });
  } catch (error) {
    console.error('Error creating template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
});

/**
 * GET /api/organizations/:orgId/stage-templates/:id
 * Get single template
 */
router.get('/:orgId/stage-templates/:id', requireOrganization, async (req, res) => {
  try {
    const template = await stageTemplateService.getTemplateById(
      req.params.id,
      req.params.orgId
    );

    res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
});

/**
 * PUT /api/organizations/:orgId/stage-templates/:id
 * Update template
 */
router.put('/:orgId/stage-templates/:id', requireOrganization, async (req, res) => {
  try {
    const { name, description, stages } = req.body;

    const template = await stageTemplateService.updateTemplate(
      req.params.id,
      req.params.orgId,
      { name, description, stages }
    );

    res.json({
      success: true,
      template,
      message: 'Template updated successfully'
    });
  } catch (error) {
    console.error('Error updating template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
});

/**
 * DELETE /api/organizations/:orgId/stage-templates/:id
 * Delete template (permanent deletion)
 */
router.delete('/:orgId/stage-templates/:id', requireOrganization, async (req, res) => {
  try {
    const result = await stageTemplateService.deleteTemplate(
      req.params.id,
      req.params.orgId
    );

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
});

/**
 * POST /api/organizations/:orgId/stage-templates/:id/duplicate
 * Duplicate template
 */
router.post('/:orgId/stage-templates/:id/duplicate', requireOrganization, async (req, res) => {
  try {
    const template = await stageTemplateService.duplicateTemplate(
      req.params.id,
      req.params.orgId,
      req.user._id
    );

    res.status(201).json({
      success: true,
      template,
      message: 'Template duplicated successfully'
    });
  } catch (error) {
    console.error('Error duplicating template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
});

module.exports = router;

