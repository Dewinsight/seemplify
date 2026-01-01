import { apiRequest, API_BASE_URL } from './apiConfig';

export interface StageTemplate {
  _id: string;
  name: string;
  description?: string;
  organizationId: string;
  stages: any[];
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  usageCount: number;
  lastUsedAt?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stageCount?: number;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  stages: any[];
}

export interface SaveAsTemplateInput {
  templateName: string;
  templateDescription?: string;
}

/**
 * Get all templates for organization
 */
export async function getTemplates(orgId: string): Promise<StageTemplate[]> {
  try {
    console.log('[StageTemplateService] GET /api/organizations/' + orgId + '/stage-templates');
    
    if (!orgId) {
      console.warn('[StageTemplateService] No organization ID provided');
      return [];
    }
    
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates`);
    console.log('[StageTemplateService] Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
        console.error('[StageTemplateService] Error response body:', errorText);
      } catch (e) {
        console.error('[StageTemplateService] Could not read error response');
      }
      
      // Return empty array instead of throwing - templates are optional
      console.warn('[StageTemplateService] Failed to fetch templates, returning empty array');
      return [];
    }
    
    const data = await response.json();
    console.log('[StageTemplateService] Templates fetched:', data.templates?.length || 0);
    return data.templates || [];
  } catch (error: any) {
    console.error('[StageTemplateService] Exception while fetching templates:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    // Return empty array instead of throwing - templates are optional
    return [];
  }
}

/**
 * Get single template by ID
 */
export async function getTemplateById(
  orgId: string,
  templateId: string
): Promise<StageTemplate> {
  try {
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates/${templateId}`);
    const data = await response.json();
    return data.template;
  } catch (error: any) {
    console.error('Error fetching template:', error);
    throw new Error(error.message || 'Failed to fetch template');
  }
}

/**
 * Create new template
 */
export async function createTemplate(
  orgId: string,
  templateData: CreateTemplateInput
): Promise<StageTemplate> {
  try {
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates`, {
      method: 'POST',
      body: JSON.stringify(templateData)
    });
    const data = await response.json();
    return data.template;
  } catch (error: any) {
    console.error('Error creating template:', error);
    throw new Error(error.message || 'Failed to create template');
  }
}

/**
 * Update template
 */
export async function updateTemplate(
  orgId: string,
  templateId: string,
  updates: Partial<CreateTemplateInput>
): Promise<StageTemplate> {
  try {
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    const data = await response.json();
    return data.template;
  } catch (error: any) {
    console.error('Error updating template:', error);
    throw new Error(error.message || 'Failed to update template');
  }
}

/**
 * Delete template (permanent deletion)
 */
export async function deleteTemplate(
  orgId: string,
  templateId: string
): Promise<{ message: string; usageCount: number }> {
  try {
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates/${templateId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error('Error deleting template:', error);
    throw new Error(error.message || 'Failed to delete template');
  }
}

/**
 * Duplicate template
 */
export async function duplicateTemplate(
  orgId: string,
  templateId: string
): Promise<StageTemplate> {
  try {
    const response = await apiRequest(`/api/organizations/${orgId}/stage-templates/${templateId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    const data = await response.json();
    return data.template;
  } catch (error: any) {
    console.error('Error duplicating template:', error);
    throw new Error(error.message || 'Failed to duplicate template');
  }
}

/**
 * Save job stages as template
 */
export async function saveJobStagesAsTemplate(
  jobId: string,
  data: SaveAsTemplateInput
): Promise<StageTemplate> {
  try {
    const response = await apiRequest(`/api/jobs/${jobId}/save-as-template`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    const responseData = await response.json();
    return responseData.template;
  } catch (error: any) {
    console.error('Error saving job stages as template:', error);
    throw new Error(error.message || 'Failed to save stages as template');
  }
}

/**
 * Apply template to job
 */
export async function applyTemplateToJob(
  jobId: string,
  templateId: string
): Promise<any[]> {
  try {
    const response = await apiRequest(`/api/jobs/${jobId}/apply-template`, {
      method: 'POST',
      body: JSON.stringify({ templateId })
    });
    const data = await response.json();
    return data.stages;
  } catch (error: any) {
    console.error('Error applying template to job:', error);
    throw new Error(error.message || 'Failed to apply template');
  }
}

