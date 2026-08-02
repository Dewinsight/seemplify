const StageTemplate = require('../models/StageTemplate');

class StageTemplateService {
  /**
   * Create a new template
   */
  async createTemplate(organizationId, userId, { name, description, stages }) {
    try {
      // Check for duplicate name within organization
      const existingTemplate = await StageTemplate.findOne({
        organizationId,
        name,
        isActive: true
      });

      if (existingTemplate) {
        const error = new Error('Template name already exists in your organization');
        error.statusCode = 409;
        error.code = 'DUPLICATE_TEMPLATE_NAME';
        throw error;
      }

      // Validate stages
      if (!stages || stages.length === 0) {
        const error = new Error('Template must have at least 1 stage');
        error.statusCode = 400;
        error.code = 'INVALID_STAGE_CONFIGURATION';
        throw error;
      }

      // Create template
      console.log('Creating template with data:', {
        name,
        organizationId,
        createdBy: userId,
        stageCount: stages.length
      });
      
      const template = await StageTemplate.create({
        name,
        description,
        organizationId,
        stages,
        createdBy: userId
      });

      console.log('Template created successfully:', {
        id: template._id,
        name: template.name,
        organizationId: template.organizationId
      });

      // Populate creator info
      await template.populate('createdBy', 'name email');

      return template;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all templates for organization
   */
  async getTemplatesForOrganization(organizationId, { includeInactive = false } = {}) {
    try {
      const query = { organizationId };
      
      if (!includeInactive) {
        query.isActive = true;
      }

      console.log('Fetching templates with query:', query);
      
      const templates = await StageTemplate.find(query)
        .populate('createdBy', 'name email')
        .sort({ name: 1 })
        .lean();

      console.log(`Found ${templates.length} templates for org ${organizationId}`);
      
      return templates;
    } catch (error) {
      console.error('Error in getTemplatesForOrganization:', error);
      throw error;
    }
  }

  /**
   * Get single template by ID
   */
  async getTemplateById(templateId, organizationId) {
    try {
      const template = await StageTemplate.findOne({
        _id: templateId,
        organizationId,
        isActive: true
      }).populate('createdBy', 'name email');

      if (!template) {
        const error = new Error('Template not found or no longer available');
        error.statusCode = 404;
        error.code = 'TEMPLATE_NOT_FOUND';
        throw error;
      }

      return template;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(templateId, organizationId, updates) {
    try {
      const template = await this.getTemplateById(templateId, organizationId);

      // Check for duplicate name if name is being changed
      if (updates.name && updates.name !== template.name) {
        const existingTemplate = await StageTemplate.findOne({
          organizationId,
          name: updates.name,
          isActive: true,
          _id: { $ne: templateId }
        });

        if (existingTemplate) {
          const error = new Error('Template name already exists in your organization');
          error.statusCode = 409;
          error.code = 'DUPLICATE_TEMPLATE_NAME';
          throw error;
        }
      }

      // Validate stages if provided
      if (updates.stages) {
        if (updates.stages.length === 0) {
          const error = new Error('Template must have at least 1 stage');
          error.statusCode = 400;
          error.code = 'INVALID_STAGE_CONFIGURATION';
          throw error;
        }
      }

      // Update template
      Object.assign(template, updates);
      await template.save();

      await template.populate('createdBy', 'name email');

      return template;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete template (hard delete - permanent removal)
   */
  async deleteTemplate(templateId, organizationId) {
    try {
      const template = await this.getTemplateById(templateId, organizationId);
      
      const usageCount = template.usageCount;

      // Permanently delete the template
      await StageTemplate.findByIdAndDelete(templateId);

      return {
        message: 'Template deleted successfully',
        usageCount: usageCount
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Duplicate template
   */
  async duplicateTemplate(templateId, organizationId, userId) {
    try {
      const sourceTemplate = await this.getTemplateById(templateId, organizationId);

      // Generate unique name
      let newName = `${sourceTemplate.name} (Copy)`;
      let counter = 2;
      
      while (await StageTemplate.findOne({ organizationId, name: newName, isActive: true })) {
        newName = `${sourceTemplate.name} (Copy ${counter})`;
        counter++;
      }

      // Create new template
      const newTemplate = await StageTemplate.create({
        name: newName,
        description: sourceTemplate.description,
        organizationId,
        stages: sourceTemplate.stages,
        createdBy: userId,
        usageCount: 0
      });

      await newTemplate.populate('createdBy', 'name email');

      return newTemplate;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new StageTemplateService();

