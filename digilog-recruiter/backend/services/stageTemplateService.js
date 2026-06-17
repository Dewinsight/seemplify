const prisma = require('../db/client');

// Stitch the creator user (replaces .populate('createdBy', 'name email')).
// User has no top-level `name` column (it lives in the `profile` Json), so the full
// user doc is attached to keep the populated shape intact for callers.
async function attachCreator(template) {
  if (!template || !template.createdBy) return template;
  const creator = await prisma.user.findUnique({
    where: { id: template.createdBy },
    select: { id: true, email: true, profile: true }
  });
  return { ...template, createdBy: creator || template.createdBy };
}

class StageTemplateService {
  /**
   * Create a new template
   */
  async createTemplate(organizationId, userId, { name, description, stages }) {
    try {
      // Check for duplicate name within organization
      const existingTemplate = await prisma.stageTemplate.findFirst({
        where: {
          organizationId,
          name,
          isActive: true
        }
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
      
      const template = await prisma.stageTemplate.create({
        data: {
          name,
          description,
          organizationId,
          stages,
          createdBy: userId
        }
      });

      console.log('Template created successfully:', {
        id: template._id,
        name: template.name,
        organizationId: template.organizationId
      });

      // Populate creator info
      return await attachCreator(template);
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
      
      const rawTemplates = await prisma.stageTemplate.findMany({
        where: query,
        orderBy: { name: 'asc' }
      });

      // Stitch creators (replaces .populate('createdBy', 'name email'))
      const creatorIds = [...new Set(rawTemplates.map(t => t.createdBy).filter(Boolean))];
      const creators = creatorIds.length
        ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, email: true, profile: true } })
        : [];
      const creatorMap = new Map(creators.map(u => [u.id, u]));
      const templates = rawTemplates.map(t => ({ ...t, createdBy: creatorMap.get(t.createdBy) || t.createdBy }));

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
      const template = await prisma.stageTemplate.findFirst({
        where: {
          id: templateId,
          organizationId,
          isActive: true
        }
      });

      if (!template) {
        const error = new Error('Template not found or no longer available');
        error.statusCode = 404;
        error.code = 'TEMPLATE_NOT_FOUND';
        throw error;
      }

      return await attachCreator(template);
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
        const existingTemplate = await prisma.stageTemplate.findFirst({
          where: {
            organizationId,
            name: updates.name,
            isActive: true,
            id: { not: templateId }
          }
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
      const updated = await prisma.stageTemplate.update({
        where: { id: templateId },
        data: { ...updates }
      });

      return await attachCreator(updated);
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
      await prisma.stageTemplate.delete({ where: { id: templateId } });

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
      
      while (await prisma.stageTemplate.findFirst({ where: { organizationId, name: newName, isActive: true } })) {
        newName = `${sourceTemplate.name} (Copy ${counter})`;
        counter++;
      }

      // Create new template
      const newTemplate = await prisma.stageTemplate.create({
        data: {
          name: newName,
          description: sourceTemplate.description,
          organizationId,
          stages: sourceTemplate.stages,
          createdBy: userId,
          usageCount: 0
        }
      });

      return await attachCreator(newTemplate);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new StageTemplateService();

