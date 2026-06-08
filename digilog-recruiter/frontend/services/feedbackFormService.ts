import { apiRequest } from './apiConfig';

// ==================== TYPES ====================

export interface CustomFieldOption {
  label: string;
  value: string;
}

export interface CustomFieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  errorMessage?: string;
}

export interface RatingConfig {
  scale: 3 | 5 | 10;
  minLabel?: string;
  maxLabel?: string;
  displayStyle: 'stars' | 'numbers' | 'slider';
}

export interface CustomField {
  _id: string;
  organization: string;
  name: string;
  label: string;
  description?: string;
  type: 'text' | 'textarea' | 'rating' | 'radio' | 'checkbox' | 'calculated';
  options?: CustomFieldOption[];
  validation?: CustomFieldValidation;
  ratingConfig?: RatingConfig;
  calculationFormula?: string;
  usageCount: number;
  canDelete: boolean;
  createdBy: any;
  updatedBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface FieldConfig {
  fieldId: string;
  fieldType: 'system' | 'custom';
  customFieldRef?: string;
  isVisible: boolean;
  isRequired: boolean;
  order: number;
  label?: string;
}

export interface FeedbackFormTemplate {
  _id: string;
  organization: string;
  name: string;
  description?: string;
  isDefault: boolean;
  systemFields: FieldConfig[];
  customFields: FieldConfig[];
  usageCount: number;
  jobsUsing: string[];
  canDelete: boolean;
  createdBy: any;
  updatedBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackFormConfig {
  useTemplate: boolean;
  templateId?: string;
  template?: FeedbackFormTemplate;
  overrides?: {
    systemFields?: FieldConfig[];
    customFields?: FieldConfig[];
    fieldOrder?: string[];
  } | null | undefined;
}

export interface CreateCustomFieldRequest {
  name: string;
  label: string;
  description?: string;
  type: 'text' | 'textarea' | 'rating' | 'radio' | 'checkbox' | 'calculated';
  options?: CustomFieldOption[];
  validation?: CustomFieldValidation;
  ratingConfig?: RatingConfig;
  calculationFormula?: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  isDefault?: boolean;
  systemFields: FieldConfig[];
  customFields: FieldConfig[];
}

// ==================== CUSTOM FIELD METHODS ====================

export const createCustomField = async (data: CreateCustomFieldRequest): Promise<CustomField> => {
  const response = await apiRequest('/api/feedback-forms/custom-fields', {
    method: 'POST',
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create custom field');
  }

  const result = await response.json();
  return result.data;
};

export const getCustomFields = async (type?: string): Promise<CustomField[]> => {
  const url = type 
    ? `/api/feedback-forms/custom-fields?type=${type}`
    : '/api/feedback-forms/custom-fields';
  
  const response = await apiRequest(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch custom fields');
  }

  const result = await response.json();
  return result.data;
};

export const getCustomFieldById = async (id: string): Promise<CustomField> => {
  const response = await apiRequest(`/api/feedback-forms/custom-fields/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch custom field');
  }

  const result = await response.json();
  return result.data;
};

export const updateCustomField = async (
  id: string, 
  data: Partial<CreateCustomFieldRequest>
): Promise<CustomField> => {
  const response = await apiRequest(`/api/feedback-forms/custom-fields/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update custom field');
  }

  const result = await response.json();
  return result.data;
};

export const deleteCustomField = async (id: string): Promise<void> => {
  const response = await apiRequest(`/api/feedback-forms/custom-fields/${id}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete custom field');
  }
};

// ==================== TEMPLATE METHODS ====================

export const createTemplate = async (data: CreateTemplateRequest): Promise<FeedbackFormTemplate> => {
  const response = await apiRequest('/api/feedback-forms/templates', {
    method: 'POST',
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    const errorObj = new Error(error.error || 'Failed to create template') as any;
    // Preserve field information for UI error display
    if (error.field) {
      errorObj.field = error.field;
    }
    if (error.validationErrors) {
      errorObj.validationErrors = error.validationErrors;
    }
    throw errorObj;
  }

  const result = await response.json();
  return result.data;
};

export const getTemplates = async (): Promise<FeedbackFormTemplate[]> => {
  const response = await apiRequest('/api/feedback-forms/templates');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch templates');
  }

  const result = await response.json();
  return result.data;
};

export const getTemplateById = async (id: string): Promise<FeedbackFormTemplate> => {
  const response = await apiRequest(`/api/feedback-forms/templates/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch template');
  }

  const result = await response.json();
  return result.data;
};

export const updateTemplate = async (
  id: string,
  data: Partial<CreateTemplateRequest>
): Promise<FeedbackFormTemplate> => {
  const response = await apiRequest(`/api/feedback-forms/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    const errorObj = new Error(error.error || 'Failed to update template') as any;
    // Preserve field information for UI error display
    if (error.field) {
      errorObj.field = error.field;
    }
    if (error.validationErrors) {
      errorObj.validationErrors = error.validationErrors;
    }
    throw errorObj;
  }

  const result = await response.json();
  return result.data;
};

export const deleteTemplate = async (id: string): Promise<void> => {
  const response = await apiRequest(`/api/feedback-forms/templates/${id}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete template');
  }
};

export const duplicateTemplate = async (id: string, name?: string): Promise<FeedbackFormTemplate> => {
  const response = await apiRequest(`/api/feedback-forms/templates/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to duplicate template');
  }

  const result = await response.json();
  return result.data;
};

// ==================== JOB FEEDBACK CONFIGURATION METHODS ====================

export const getJobFeedbackConfig = async (jobId: string): Promise<FeedbackFormConfig> => {
  const response = await apiRequest(`/api/jobs/${jobId}/feedback-form-config`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch job feedback configuration');
  }

  const result = await response.json();
  return result.data;
};

export const updateJobFeedbackConfig = async (
  jobId: string,
  config: Partial<FeedbackFormConfig>
): Promise<FeedbackFormConfig> => {
  const response = await apiRequest(`/api/jobs/${jobId}/feedback-form-config`, {
    method: 'PUT',
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update job feedback configuration');
  }

  const result = await response.json();
  return result.data;
};

export const getJobFeedbackFormPreview = async (jobId: string): Promise<any> => {
  const response = await apiRequest(`/api/jobs/${jobId}/feedback-form-preview`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch feedback form preview');
  }

  const result = await response.json();
  return result.data;
};

export default {
  // Custom Fields
  createCustomField,
  getCustomFields,
  getCustomFieldById,
  updateCustomField,
  deleteCustomField,
  
  // Templates
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  
  // Job Configuration
  getJobFeedbackConfig,
  updateJobFeedbackConfig,
  getJobFeedbackFormPreview
};

