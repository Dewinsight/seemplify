const prisma = require('../db/client');
const { oid, isObjectIdLike, newId } = require('../db/objectId');

// ---- helpers (replace Mongoose statics/methods/virtuals) ----

// Stitch populated CustomField docs into a template's customFields Json array,
// replacing each entry's customFieldRef id with the full CustomField object
// (mirrors Mongoose .populate('customFields.customFieldRef')).
async function populateTemplateCustomFields(template) {
  if (!template || !Array.isArray(template.customFields)) return template;
  const refIds = template.customFields
    .map(f => (f && f.customFieldRef && typeof f.customFieldRef === 'object' ? f.customFieldRef._id || f.customFieldRef.id : f && f.customFieldRef))
    .filter(Boolean)
    .map(String);
  if (refIds.length === 0) return template;
  const fields = await prisma.customField.findMany({ where: { id: { in: refIds } } });
  const byId = new Map(fields.map(f => [f.id, f]));
  template.customFields = template.customFields.map(f => {
    if (!f || !f.customFieldRef) return f;
    const refId = typeof f.customFieldRef === 'object' ? f.customFieldRef._id || f.customFieldRef.id : f.customFieldRef;
    const full = byId.get(String(refId));
    return full ? { ...f, customFieldRef: full } : f;
  });
  return template;
}

// FeedbackFormTemplate.getDefault static
async function getDefaultTemplate(organizationId) {
  return prisma.feedbackFormTemplate.findFirst({
    where: { organizationId, isDefault: true, isDeleted: false }
  });
}

// FeedbackFormTemplate.findByOrganization static
async function findTemplatesByOrganization(organizationId, includeDeleted = false) {
  const where = { organizationId };
  if (!includeDeleted) where.isDeleted = false;
  return prisma.feedbackFormTemplate.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
  });
}

// FeedbackFormTemplate canDelete virtual
const templateCanDelete = (t) => !t.isDefault && (t.usageCount || 0) === 0;

// FeedbackFormTemplate.incrementUsage method
async function incrementTemplateUsage(template, jobId) {
  const jobsUsing = Array.isArray(template.jobsUsingIds) ? [...template.jobsUsingIds] : [];
  if (jobId && !jobsUsing.map(String).includes(String(jobId))) jobsUsing.push(String(jobId));
  return prisma.feedbackFormTemplate.update({
    where: { id: template.id },
    data: { usageCount: (template.usageCount || 0) + 1, jobsUsingIds: jobsUsing }
  });
}

// FeedbackFormTemplate.decrementUsage method
async function decrementTemplateUsage(template, jobId) {
  const jobsUsing = (Array.isArray(template.jobsUsingIds) ? template.jobsUsingIds : [])
    .filter(id => String(id) !== String(jobId));
  return prisma.feedbackFormTemplate.update({
    where: { id: template.id },
    data: { usageCount: Math.max(0, (template.usageCount || 0) - 1), jobsUsingIds: jobsUsing }
  });
}

// CustomField canDelete virtual
const customFieldCanDelete = (f) => (f.usageCount || 0) === 0;

// CustomField.incrementUsage method
async function incrementCustomFieldUsage(field) {
  return prisma.customField.update({
    where: { id: field.id },
    data: { usageCount: (field.usageCount || 0) + 1 }
  });
}

// CustomField.decrementUsage method
async function decrementCustomFieldUsage(field) {
  if ((field.usageCount || 0) > 0) {
    return prisma.customField.update({
      where: { id: field.id },
      data: { usageCount: field.usageCount - 1 }
    });
  }
}

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
    const existingTemplate = await prisma.feedbackFormTemplate.findFirst({
      where: {
        organizationId: organizationId,
        name: name.trim(),
        isDeleted: false
      }
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
        const validFields = await prisma.customField.findMany({
          where: {
            id: { in: customFieldIds.map(String) },
            organizationId: organizationId,
            isDeleted: false
          }
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

    // Enforce a single default template per organization (mirrors model pre-save)
    if (isDefault) {
      await prisma.feedbackFormTemplate.updateMany({
        where: { organizationId: organizationId, isDefault: true },
        data: { isDefault: false }
      });
    }

    // Create template
    const template = await prisma.feedbackFormTemplate.create({
      data: {
        organizationId: organizationId,
        name: name.trim(),
        description: description?.trim() || '',
        isDefault: isDefault || false,
        systemFields: systemFields || [],
        customFields: sanitizedCustomFields,
        createdById: userId
      }
    });

    // Populate custom field references
    await populateTemplateCustomFields(template);

    // Update usage count for custom fields
    if (template.customFields && template.customFields.length > 0) {
      for (const field of template.customFields) {
        if (field.customFieldRef) {
          // Extract ID whether it's a string or populated object
          const fieldId = typeof field.customFieldRef === 'object' && (field.customFieldRef._id || field.customFieldRef.id)
            ? (field.customFieldRef._id || field.customFieldRef.id)
            : field.customFieldRef;
          const customField = await prisma.customField.findUnique({ where: { id: String(fieldId) } });
          if (customField) {
            await incrementCustomFieldUsage(customField);
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

    const templates = await findTemplatesByOrganization(organizationId);

    // Stitch custom field refs + createdBy user onto each template (mirrors .populate)
    const creatorIds = [...new Set(templates.map(t => t.createdById).filter(Boolean).map(String))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, profile: true, email: true } })
      : [];
    const creatorById = new Map(creators.map(u => [u.id, u]));

    for (const template of templates) {
      await populateTemplateCustomFields(template);
      template.createdBy = template.createdById ? (creatorById.get(template.createdById) || null) : null;
    }

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

    const template = await prisma.feedbackFormTemplate.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    await populateTemplateCustomFields(template);
    template.createdBy = template.createdById
      ? await prisma.user.findUnique({ where: { id: template.createdById }, select: { id: true, profile: true, email: true } })
      : null;
    template.updatedBy = template.updatedById
      ? await prisma.user.findUnique({ where: { id: template.updatedById }, select: { id: true, profile: true, email: true } })
      : null;

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

    const template = await prisma.feedbackFormTemplate.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Get old custom fields to update usage counts
    const oldCustomFieldIds = (Array.isArray(template.customFields) ? template.customFields : [])
      .map(f => f.customFieldRef ? String(f.customFieldRef) : null)
      .filter(Boolean);

    // Build update payload
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (systemFields !== undefined) updateData.systemFields = systemFields;
    if (customFields !== undefined) {
      // Sanitize customFields to ensure customFieldRef is always a string ID, not an object
      updateData.customFields = customFields.map(field => ({
        ...field,
        customFieldRef: field.customFieldRef?._id || field.customFieldRef // Extract _id if it's an object
      }));
    }

    updateData.updatedById = userId;

    // Enforce a single default template per organization (mirrors model pre-save)
    if (isDefault === true && !template.isDefault) {
      await prisma.feedbackFormTemplate.updateMany({
        where: { organizationId: organizationId, isDefault: true, id: { not: template.id } },
        data: { isDefault: false }
      });
    }

    const updatedTemplate = await prisma.feedbackFormTemplate.update({
      where: { id: template.id },
      data: updateData
    });
    await populateTemplateCustomFields(updatedTemplate);

    // Update custom field usage counts
    // Extract IDs from potentially populated customFieldRef
    const newCustomFieldIds = (Array.isArray(updatedTemplate.customFields) ? updatedTemplate.customFields : [])
      .map(f => {
        const ref = f.customFieldRef;
        if (!ref) return null;
        // If it's a populated object, get its _id, otherwise use as-is
        return typeof ref === 'object' && (ref._id || ref.id) ? String(ref._id || ref.id) : String(ref);
      })
      .filter(Boolean);

    // Decrement removed fields
    const removedFields = oldCustomFieldIds.filter(id => !newCustomFieldIds.includes(id));
    for (const fieldId of removedFields) {
      const field = await prisma.customField.findUnique({ where: { id: fieldId } });
      if (field) await decrementCustomFieldUsage(field);
    }

    // Increment added fields
    const addedFields = newCustomFieldIds.filter(id => !oldCustomFieldIds.includes(id));
    for (const fieldId of addedFields) {
      const field = await prisma.customField.findUnique({ where: { id: fieldId } });
      if (field) await incrementCustomFieldUsage(field);
    }

    res.json({
      success: true,
      data: updatedTemplate
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

    const template = await prisma.feedbackFormTemplate.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Check if template can be deleted
    if (!templateCanDelete(template)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete default template or template in use'
      });
    }

    // Soft delete
    await prisma.feedbackFormTemplate.update({
      where: { id: template.id },
      data: { isDeleted: true, deletedAt: new Date(), deletedById: userId }
    });

    // Decrement usage count for custom fields
    for (const field of (Array.isArray(template.customFields) ? template.customFields : [])) {
      if (field.customFieldRef) {
        const customField = await prisma.customField.findUnique({ where: { id: String(field.customFieldRef) } });
        if (customField) await decrementCustomFieldUsage(customField);
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

    const template = await prisma.feedbackFormTemplate.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Duplicate template (mirrors FeedbackFormTemplate.duplicate method)
    const duplicate = await prisma.feedbackFormTemplate.create({
      data: {
        organizationId: template.organizationId,
        name: name || `${template.name} (Copy)`,
        description: template.description,
        isDefault: false,
        systemFields: Array.isArray(template.systemFields) ? template.systemFields : [],
        customFields: Array.isArray(template.customFields) ? template.customFields : [],
        createdById: userId
      }
    });
    await populateTemplateCustomFields(duplicate);

    // Increment usage count for custom fields
    for (const field of (Array.isArray(duplicate.customFields) ? duplicate.customFields : [])) {
      if (field.customFieldRef) {
        const fieldId = typeof field.customFieldRef === 'object'
          ? (field.customFieldRef._id || field.customFieldRef.id)
          : field.customFieldRef;
        const customField = await prisma.customField.findUnique({ where: { id: String(fieldId) } });
        if (customField) await incrementCustomFieldUsage(customField);
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
    const customField = await prisma.customField.create({
      data: {
        organizationId: organizationId,
        name,
        label,
        description,
        type,
        options,
        validation,
        ratingConfig,
        calculationFormula,
        createdById: userId
      }
    });

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
      customFields = await prisma.customField.findMany({
        where: { organizationId: organizationId, type: type, isDeleted: false },
        orderBy: { name: 'asc' }
      });
    } else {
      customFields = await prisma.customField.findMany({
        where: { organizationId: organizationId, isDeleted: false },
        orderBy: { name: 'asc' }
      });
    }

    // Stitch createdBy user onto each field (mirrors CustomField.populate)
    const fieldCreatorIds = [...new Set(customFields.map(f => f.createdById).filter(Boolean).map(String))];
    const fieldCreators = fieldCreatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: fieldCreatorIds } }, select: { id: true, profile: true, email: true } })
      : [];
    const fieldCreatorById = new Map(fieldCreators.map(u => [u.id, u]));
    for (const f of customFields) {
      f.createdBy = f.createdById ? (fieldCreatorById.get(f.createdById) || null) : null;
    }

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

    const customField = await prisma.customField.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    customField.createdBy = customField.createdById
      ? await prisma.user.findUnique({ where: { id: customField.createdById }, select: { id: true, profile: true, email: true } })
      : null;
    customField.updatedBy = customField.updatedById
      ? await prisma.user.findUnique({ where: { id: customField.updatedById }, select: { id: true, profile: true, email: true } })
      : null;

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

    const customField = await prisma.customField.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    // Update fields
    const fieldUpdate = {};
    if (name !== undefined) fieldUpdate.name = name;
    if (label !== undefined) fieldUpdate.label = label;
    if (description !== undefined) fieldUpdate.description = description;
    if (type !== undefined) fieldUpdate.type = type;
    if (options !== undefined) fieldUpdate.options = options;
    if (validation !== undefined) fieldUpdate.validation = validation;
    if (ratingConfig !== undefined) fieldUpdate.ratingConfig = ratingConfig;
    if (calculationFormula !== undefined) fieldUpdate.calculationFormula = calculationFormula;

    fieldUpdate.updatedById = userId;

    const updatedCustomField = await prisma.customField.update({
      where: { id: customField.id },
      data: fieldUpdate
    });

    res.json({
      success: true,
      data: updatedCustomField
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

    const customField = await prisma.customField.findFirst({
      where: {
        id: id,
        organizationId: organizationId,
        isDeleted: false
      }
    });

    if (!customField) {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    // Check if field can be deleted
    if (!customFieldCanDelete(customField)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete custom field that is in use',
        usageCount: customField.usageCount
      });
    }

    // Soft delete
    await prisma.customField.update({
      where: { id: customField.id },
      data: { isDeleted: true, deletedAt: new Date(), deletedById: userId }
    });

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

    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        organizationId: organizationId
      }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // If no config exists, return default template
    if (!job.feedbackFormConfig || !job.feedbackFormConfig.templateId) {
      const defaultTemplate = await getDefaultTemplate(organizationId);

      return res.json({
        success: true,
        data: {
          useTemplate: true,
          template: defaultTemplate,
          overrides: null
        }
      });
    }

    // Populate feedbackFormConfig.templateId (soft ref -> full template object)
    const feedbackFormConfig = { ...job.feedbackFormConfig };
    if (feedbackFormConfig.templateId) {
      feedbackFormConfig.templateId = await prisma.feedbackFormTemplate.findUnique({
        where: { id: String(feedbackFormConfig.templateId) }
      });
    }

    // Populate custom field references in overrides
    if (feedbackFormConfig.overrides && Array.isArray(feedbackFormConfig.overrides.customFields)) {
      feedbackFormConfig.overrides = { ...feedbackFormConfig.overrides };
      feedbackFormConfig.overrides.customFields = await Promise.all(
        feedbackFormConfig.overrides.customFields.map(async (cf) => {
          if (cf && cf.customFieldId) {
            const full = await prisma.customField.findUnique({ where: { id: String(cf.customFieldId) } });
            return { ...cf, customFieldId: full || cf.customFieldId };
          }
          return cf;
        })
      );
    }

    res.json({
      success: true,
      data: feedbackFormConfig
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

    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        organizationId: organizationId
      }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Track old template to update usage counts
    const oldTemplateId = job.feedbackFormConfig?.templateId;

    // Update configuration (read-modify-write the Json column)
    const feedbackFormConfig = job.feedbackFormConfig ? { ...job.feedbackFormConfig } : {};

    if (useTemplate !== undefined) {
      feedbackFormConfig.useTemplate = useTemplate;
    }

    if (templateId !== undefined) {
      feedbackFormConfig.templateId = templateId;
    }

    if (overrides !== undefined) {
      // If overrides is explicitly null, clear existing overrides
      if (overrides === null) {
        feedbackFormConfig.overrides = null;
      } else {
        feedbackFormConfig.overrides = overrides;
      }
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { feedbackFormConfig }
    });

    // Update template usage counts
    if (oldTemplateId && oldTemplateId.toString() !== templateId) {
      const oldTemplate = await prisma.feedbackFormTemplate.findUnique({ where: { id: String(oldTemplateId) } });
      if (oldTemplate) {
        await decrementTemplateUsage(oldTemplate, jobId);
      }
    }

    if (templateId && (!oldTemplateId || oldTemplateId.toString() !== templateId)) {
      const newTemplate = await prisma.feedbackFormTemplate.findUnique({ where: { id: String(templateId) } });
      if (newTemplate) {
        await incrementTemplateUsage(newTemplate, jobId);
      }
    }

    // Populate and return updated config (templateId soft ref -> full template object)
    if (feedbackFormConfig.templateId) {
      feedbackFormConfig.templateId = await prisma.feedbackFormTemplate.findUnique({
        where: { id: String(feedbackFormConfig.templateId) }
      });
    }

    res.json({
      success: true,
      data: feedbackFormConfig
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

    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        organizationId: organizationId
      }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Populate feedbackFormConfig refs (templateId + overrides custom fields)
    const feedbackFormConfig = job.feedbackFormConfig ? { ...job.feedbackFormConfig } : null;

    // Get effective template
    let template;
    if (feedbackFormConfig && feedbackFormConfig.templateId) {
      template = await prisma.feedbackFormTemplate.findUnique({ where: { id: String(feedbackFormConfig.templateId) } });
    } else {
      template = await getDefaultTemplate(organizationId);
    }

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'No feedback form template configured'
      });
    }

    // Populate custom fields in template
    await populateTemplateCustomFields(template);

    // Populate custom field references in overrides
    if (feedbackFormConfig && feedbackFormConfig.overrides && Array.isArray(feedbackFormConfig.overrides.customFields)) {
      feedbackFormConfig.overrides = { ...feedbackFormConfig.overrides };
      feedbackFormConfig.overrides.customFields = await Promise.all(
        feedbackFormConfig.overrides.customFields.map(async (cf) => {
          if (cf && cf.customFieldId) {
            const full = await prisma.customField.findUnique({ where: { id: String(cf.customFieldId) } });
            return { ...cf, customFieldId: full || cf.customFieldId };
          }
          return cf;
        })
      );
    }

    // Apply overrides if they exist
    let fields = [...(template.systemFields || []), ...(template.customFields || [])];

    if (feedbackFormConfig && feedbackFormConfig.overrides) {
      const overrides = feedbackFormConfig.overrides;

      // Apply system field overrides
      if (overrides.systemFields && overrides.systemFields.length > 0) {
        fields = fields.map(field => {
          const override = overrides.systemFields.find(o => o.fieldId === field.fieldId);
          return override ? { ...field, ...override } : field;
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

