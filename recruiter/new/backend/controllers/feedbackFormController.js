const FeedbackFormTemplate = require('../models/FeedbackFormTemplate');
const CustomField = require('../models/CustomField');
const CustomFieldResponse = require('../models/CustomFieldResponse');
const Job = require('../models/Job');

// ==================== TEMPLATE ENDPOINTS ====================

/**
 * Create a new feedback form template
 * POST /api/feedback-forms/templates
 */
exports.createTemplate = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const {
      name,
      description,
      isDefault,
      systemFields,
      customFields
    } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Template name is required',
        field: 'name'
      });
    }

    // Validate name length
    if (name.trim().length > 100) {
      return res.status(400).json({ 
        success: false, 
        error: 'Template name cannot exceed 100 characters',
        field: 'name'
      });
    }

    // Validate description length
    if (description && description.length > 500) {
      return res.status(400).json({ 
        success: false, 
        error: 'Template description cannot exceed 500 characters',
        field: 'description'
      });
    }

    // Check for duplicate template name in organization
    const existingTemplate = await FeedbackFormTemplate.findOne({
      organization: organizationId,
      name: name.trim(),
      isDeleted: false
    });

    if (existingTemplate) {
      return res.status(400).json({ 
        success: false, 
        error: `A template with the name "${name.trim()}" already exists`,
        field: 'name'
      });
    }

    // Validate custom field references exist
    const sanitizedCustomFields = (customFields || []).map(field => ({
      ...field,
      customFieldRef: field.customFieldRef?._id || field.customFieldRef
    }));

    // Verify all custom field references are valid
    if (sanitizedCustomFields.length > 0) {
      const customFieldIds = sanitizedCustomFields
        .map(f => f.customFieldRef)
        .filter(Boolean);
      
      if (customFieldIds.length > 0) {
        const validFields = await CustomField.find({
          _id: { $in: customFieldIds },
          organization: organizationId,
          isDeleted: false
        });

        if (validFields.length !== customFieldIds.length) {
          const validIds = validFields.map(f => f._id.toString());
          const invalidIds = customFieldIds.filter(id => !validIds.includes(id.toString()));
          return res.status(400).json({ 
            success: false, 
            error: `One or more custom fields are invalid or do not exist`,
            field: 'customFields',
            invalidFields: invalidIds
          });
        }
      }
    }

    // Validate system fields structure
    if (systemFields && Array.isArray(systemFields)) {
      for (const field of systemFields) {
        if (!field.fieldId || !field.fieldType) {
          return res.status(400).json({ 
            success: false, 
            error: 'System fields must have fieldId and fieldType',
            field: 'systemFields'
          });
        }
        if (field.fieldType !== 'system') {
          return res.status(400).json({ 
            success: false, 
            error: 'System fields must have fieldType set to "system"',
            field: 'systemFields'
          });
        }
      }
    }

    // Create template
    const template = new FeedbackFormTemplate({
      organization: organizationId,
      name: name.trim(),
      description: description?.trim() || '',
      isDefault: isDefault || false,
      systemFields: systemFields || [],
      customFields: sanitizedCustomFields,
      createdBy: userId
    });

    await template.save();

    // Populate custom field references
    await template.populate('customFields.customFieldRef');

    // Update usage count for custom fields
    if (template.customFields && template.customFields.length > 0) {
      for (const field of template.customFields) {
        if (field.customFieldRef) {
          // Extract ID whether it's a string or populated object
          const fieldId = typeof field.customFieldRef === 'object' && field.customFieldRef._id 
            ? field.customFieldRef._id 
            : field.customFieldRef;
          const customField = await CustomField.findById(fieldId);
          if (customField) {
            await customField.incrementUsage();
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Error creating feedback form template:', error);
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: errors.join(', '),
        validationErrors: error.errors
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A template with this name already exists',
        field: 'name'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create template'
    });
  }
};

/**
 * Get all templates for organization
 * GET /api/feedback-forms/templates
 */
exports.getTemplates = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;

    const templates = await FeedbackFormTemplate.findByOrganization(organizationId)
      .populate('customFields.customFieldRef')
      .populate('createdBy', 'profile.firstName profile.lastName email');

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch templates'
    });
  }
};

/**
 * Get template by ID
 * GET /api/feedback-forms/templates/:id
 */
exports.getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;

    const template = await FeedbackFormTemplate.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    })
      .populate('customFields.customFieldRef')
      .populate('createdBy', 'profile.firstName profile.lastName email')
      .populate('updatedBy', 'profile.firstName profile.lastName email');

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch template'
    });
  }
};

/**
 * Update template
 * PUT /api/feedback-forms/templates/:id
 */
exports.updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const {
      name,
      description,
      isDefault,
      systemFields,
      customFields
    } = req.body;

    const template = await FeedbackFormTemplate.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Get old custom fields to update usage counts
    const oldCustomFieldIds = template.customFields
      .map(f => f.customFieldRef?.toString())
      .filter(Boolean);

    // Update fields
    if (name !== undefined) template.name = name;
    if (description !== undefined) template.description = description;
    if (isDefault !== undefined) template.isDefault = isDefault;
    if (systemFields !== undefined) template.systemFields = systemFields;
    if (customFields !== undefined) {
      // Sanitize customFields to ensure customFieldRef is always a string ID, not an object
      template.customFields = customFields.map(field => ({
        ...field,
        customFieldRef: field.customFieldRef?._id || field.customFieldRef // Extract _id if it's an object
      }));
    }
    
    template.updatedBy = userId;

    await template.save();
    await template.populate('customFields.customFieldRef');

    // Update custom field usage counts
    // Extract IDs from potentially populated customFieldRef
    const newCustomFieldIds = template.customFields
      .map(f => {
        const ref = f.customFieldRef;
        if (!ref) return null;
        // If it's a populated object, get its _id, otherwise use as-is
        return typeof ref === 'object' && ref._id ? ref._id.toString() : ref.toString();
      })
      .filter(Boolean);

    // Decrement removed fields
    const removedFields = oldCustomFieldIds.filter(id => !newCustomFieldIds.includes(id));
    for (const fieldId of removedFields) {
      const field = await CustomField.findById(fieldId);
      if (field) await field.decrementUsage();
    }

    // Increment added fields
    const addedFields = newCustomFieldIds.filter(id => !oldCustomFieldIds.includes(id));
    for (const fieldId of addedFields) {
      const field = await CustomField.findById(fieldId);
      if (field) await field.incrementUsage();
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update template'
    });
  }
};

/**
 * Delete template
 * DELETE /api/feedback-forms/templates/:id
 */
exports.deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const template = await FeedbackFormTemplate.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Check if template can be deleted
    if (!template.canDelete) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete default template or template in use'
      });
    }

    // Soft delete
    template.isDeleted = true;
    template.deletedAt = new Date();
    template.deletedBy = userId;
    await template.save();

    // Decrement usage count for custom fields
    for (const field of template.customFields) {
      if (field.customFieldRef) {
        const customField = await CustomField.findById(field.customFieldRef);
        if (customField) await customField.decrementUsage();
      }
    }

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete template'
    });
  }
};

/**
 * Duplicate template
 * POST /api/feedback-forms/templates/:id/duplicate
 */
exports.duplicateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;
    const { name } = req.body;

    const template = await FeedbackFormTemplate.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    const duplicate = await template.duplicate(userId, name);
    await duplicate.populate('customFields.customFieldRef');

    // Increment usage count for custom fields
    for (const field of duplicate.customFields) {
      if (field.customFieldRef) {
        const customField = await CustomField.findById(field.customFieldRef);
        if (customField) await customField.incrementUsage();
      }
    }

    res.status(201).json({
      success: true,
      data: duplicate
    });
  } catch (error) {
    console.error('Error duplicating template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to duplicate template'
    });
  }
};

// ==================== CUSTOM FIELD ENDPOINTS ====================

/**
 * Create custom field
 * POST /api/feedback-forms/custom-fields
 */
exports.createCustomField = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const {
      name,
      label,
      description,
      type,
      options,
      validation,
      ratingConfig,
      calculationFormula
    } = req.body;

    // Validate required fields
    if (!name || !label || !type) {
      return res.status(400).json({
        success: false,
        error: 'Name, label, and type are required'
      });
    }

    // Validate field type
    const validTypes = ['text', 'textarea', 'rating', 'radio', 'checkbox', 'calculated'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid field type'
      });
    }

    // Validate options for radio/checkbox
    if ((type === 'radio' || type === 'checkbox') && (!options || options.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Options are required for radio and checkbox fields'
      });
    }

    // Create custom field
    const customField = new CustomField({
      organization: organizationId,
      name,
      label,
      description,
      type,
      options,
      validation,
      ratingConfig,
      calculationFormula,
      createdBy: userId
    });

    await customField.save();

    res.status(201).json({
      success: true,
      data: customField
    });
  } catch (error) {
    console.error('Error creating custom field:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create custom field'
    });
  }
};

/**
 * Get all custom fields for organization
 * GET /api/feedback-forms/custom-fields
 */
exports.getCustomFields = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { type } = req.query;

    let customFields;
    if (type) {
      customFields = await CustomField.findByType(organizationId, type);
    } else {
      customFields = await CustomField.findByOrganization(organizationId);
    }

    customFields = await CustomField.populate(customFields, {
      path: 'createdBy',
      select: 'profile.firstName profile.lastName email'
    });

    res.json({
      success: true,
      data: customFields
    });
  } catch (error) {
    console.error('Error fetching custom fields:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch custom fields'
    });
  }
};

/**
 * Get custom field by ID
 * GET /api/feedback-forms/custom-fields/:id
 */
exports.getCustomFieldById = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;

    const customField = await CustomField.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    })
      .populate('createdBy', 'profile.firstName profile.lastName email')
      .populate('updatedBy', 'profile.firstName profile.lastName email');

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    res.json({
      success: true,
      data: customField
    });
  } catch (error) {
    console.error('Error fetching custom field:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch custom field'
    });
  }
};

/**
 * Update custom field
 * PUT /api/feedback-forms/custom-fields/:id
 */
exports.updateCustomField = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const {
      name,
      label,
      description,
      type,
      options,
      validation,
      ratingConfig,
      calculationFormula
    } = req.body;

    const customField = await CustomField.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    });

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    // Update fields
    if (name !== undefined) customField.name = name;
    if (label !== undefined) customField.label = label;
    if (description !== undefined) customField.description = description;
    if (type !== undefined) customField.type = type;
    if (options !== undefined) customField.options = options;
    if (validation !== undefined) customField.validation = validation;
    if (ratingConfig !== undefined) customField.ratingConfig = ratingConfig;
    if (calculationFormula !== undefined) customField.calculationFormula = calculationFormula;

    customField.updatedBy = userId;

    await customField.save();

    res.json({
      success: true,
      data: customField
    });
  } catch (error) {
    console.error('Error updating custom field:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update custom field'
    });
  }
};

/**
 * Delete custom field
 * DELETE /api/feedback-forms/custom-fields/:id
 */
exports.deleteCustomField = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const customField = await CustomField.findOne({
      _id: id,
      organization: organizationId,
      isDeleted: false
    });

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    // Check if field can be deleted
    if (!customField.canDelete) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete custom field that is in use',
        usageCount: customField.usageCount
      });
    }

    // Soft delete
    customField.isDeleted = true;
    customField.deletedAt = new Date();
    customField.deletedBy = userId;
    await customField.save();

    res.json({
      success: true,
      message: 'Custom field deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting custom field:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete custom field'
    });
  }
};

// ==================== JOB FEEDBACK CONFIGURATION ENDPOINTS ====================

/**
 * Get job's feedback form configuration
 * GET /api/jobs/:jobId/feedback-form-config
 */
exports.getJobFeedbackConfig = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;

    const job = await Job.findOne({
      _id: jobId,
      organization: organizationId
    }).populate('feedbackFormConfig.templateId');

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // If no config exists, return default template
    if (!job.feedbackFormConfig || !job.feedbackFormConfig.templateId) {
      const defaultTemplate = await FeedbackFormTemplate.getDefault(organizationId);
      
      return res.json({
        success: true,
        data: {
          useTemplate: true,
          template: defaultTemplate,
          overrides: null
        }
      });
    }

    // Populate custom field references in overrides
    if (job.feedbackFormConfig.overrides && job.feedbackFormConfig.overrides.customFields) {
      await Job.populate(job, {
        path: 'feedbackFormConfig.overrides.customFields.customFieldId'
      });
    }

    res.json({
      success: true,
      data: job.feedbackFormConfig
    });
  } catch (error) {
    console.error('Error fetching job feedback config:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch job feedback configuration'
    });
  }
};

/**
 * Update job's feedback form configuration
 * PUT /api/jobs/:jobId/feedback-form-config
 */
exports.updateJobFeedbackConfig = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;

    const {
      useTemplate,
      templateId,
      overrides
    } = req.body;

    const job = await Job.findOne({
      _id: jobId,
      organization: organizationId
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Track old template to update usage counts
    const oldTemplateId = job.feedbackFormConfig?.templateId;

    // Update configuration
    if (!job.feedbackFormConfig) {
      job.feedbackFormConfig = {};
    }

    if (useTemplate !== undefined) {
      job.feedbackFormConfig.useTemplate = useTemplate;
    }

    if (templateId !== undefined) {
      job.feedbackFormConfig.templateId = templateId;
    }

    if (overrides !== undefined) {
      // If overrides is explicitly null, clear existing overrides
      if (overrides === null) {
        job.feedbackFormConfig.overrides = null;
      } else {
        job.feedbackFormConfig.overrides = overrides;
      }
    }

    await job.save();

    // Update template usage counts
    if (oldTemplateId && oldTemplateId.toString() !== templateId) {
      const oldTemplate = await FeedbackFormTemplate.findById(oldTemplateId);
      if (oldTemplate) {
        await oldTemplate.decrementUsage(jobId);
      }
    }

    if (templateId && (!oldTemplateId || oldTemplateId.toString() !== templateId)) {
      const newTemplate = await FeedbackFormTemplate.findById(templateId);
      if (newTemplate) {
        await newTemplate.incrementUsage(jobId);
      }
    }

    // Populate and return updated config
    await job.populate('feedbackFormConfig.templateId');

    res.json({
      success: true,
      data: job.feedbackFormConfig
    });
  } catch (error) {
    console.error('Error updating job feedback config:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update job feedback configuration'
    });
  }
};

/**
 * Get public-facing form schema for a job (via interview)
 * GET /api/jobs/:jobId/feedback-form-preview
 */
exports.getJobFeedbackFormPreview = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;

    const job = await Job.findOne({
      _id: jobId,
      organization: organizationId
    })
      .populate('feedbackFormConfig.templateId')
      .populate('feedbackFormConfig.overrides.customFields.customFieldId');

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Get effective template
    let template;
    if (job.feedbackFormConfig && job.feedbackFormConfig.templateId) {
      template = job.feedbackFormConfig.templateId;
    } else {
      template = await FeedbackFormTemplate.getDefault(organizationId);
    }

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'No feedback form template configured'
      });
    }

    // Populate custom fields in template
    await template.populate('customFields.customFieldRef');

    // Apply overrides if they exist
    let fields = [...template.systemFields, ...template.customFields];

    if (job.feedbackFormConfig && job.feedbackFormConfig.overrides) {
      const overrides = job.feedbackFormConfig.overrides;
      
      // Apply system field overrides
      if (overrides.systemFields && overrides.systemFields.length > 0) {
        fields = fields.map(field => {
          const override = overrides.systemFields.find(o => o.fieldId === field.fieldId);
          return override ? { ...field.toObject(), ...override } : field;
        });
      }

      // Add custom field overrides
      if (overrides.customFields && overrides.customFields.length > 0) {
        fields = [...fields, ...overrides.customFields];
      }

      // Apply field order if specified
      if (overrides.fieldOrder && overrides.fieldOrder.length > 0) {
        fields.sort((a, b) => {
          const aIndex = overrides.fieldOrder.indexOf(a.fieldId);
          const bIndex = overrides.fieldOrder.indexOf(b.fieldId);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
      }
    }

    // Filter visible fields and sort by order
    const visibleFields = fields
      .filter(f => f.isVisible !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    res.json({
      success: true,
      data: {
        templateName: template.name,
        fields: visibleFields
      }
    });
  } catch (error) {
    console.error('Error fetching job feedback form preview:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch feedback form preview'
    });
  }
};

