import { CandidateFormValues } from "@/app/candidates/new/page"; // Assuming type is exported or defined shared
import { apiRequest, getAuthHeaders } from './apiConfig';

interface CandidateData extends CandidateFormValues {
  _id: string;
  organization?: string; // Organization ID
  // Add other fields that the backend might return for a candidate
  resumeUrl?: string;
  resumeText?: string;
  parsedData?: any;
  aiAnalysis?: {
    summary?: string;
    strengths?: string[];
    potentialFlags?: string[];
  };
  workExperience?: {
    experienceSummary?: string;
    totalYearsExperience?: number;
    careerProgression?: string;
    jobHistory?: Array<{
      company?: string;
      position?: string;
      duration?: string;
      responsibilities?: string;
      technologies?: string[];
      impact?: string;
    }>;
    keyAchievements?: string[];
    industryExperience?: string[];
    leadershipExperience?: string;
    technicalDepth?: string;
  };
  notes?: Array<{
    _id?: string;
    note: string;
    date: string;
    user?: string;
    userName?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  source?: string;
}

interface UploadCVResponse {
  msg: string;
  candidate: CandidateData;
  processingResults?: {
    cloudinaryUpload: boolean;
    cvParsing: boolean;
    aiAnalysis: boolean;
    textExtracted: boolean;
    fieldsExtracted: number;
  };
}

interface CreateCandidateResponse {
  msg: string;
  candidate: CandidateData;
}

interface ApiError {
  msg: string;
  error?: any;
  requiresOrganizationSetup?: boolean;
}

// Helper function to handle organization-related errors
const handleOrganizationError = (error: ApiError) => {
  if (error.requiresOrganizationSetup) {
    // Redirect to organization setup page
    if (typeof window !== 'undefined') {
      window.location.href = '/organization/setup';
    }
    throw new Error('Organization setup required. Redirecting to setup page...');
  }
  throw new Error(error.msg || 'An error occurred');
};

export const uploadCV = async (formData: FormData): Promise<UploadCVResponse> => {
  const token = localStorage.getItem('jwt');
  const response = await apiRequest(`/api/candidates/upload-cv`, {
    method: "POST",
    headers: {
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorResult: any = await response.json().catch(() => ({ msg: 'Upload failed' }));
    
    // Check for organization error first
    if (errorResult.requiresOrganizationSetup) {
      handleOrganizationError(errorResult);
    }
    
    // Extract the detailed error message from various possible fields
    // Backend error handler sends: { error: "...", details: "..." } in dev mode
    // Or: { msg: "..." } for custom error responses
    const errorMessage = errorResult.details ||      // Development error details
                        errorResult.msg ||           // Custom error message
                        errorResult.error?.message || // Nested error object
                        errorResult.error ||          // Error string
                        'Failed to upload CV. Please try again.';
    
    // Throw error with the full message from backend
    throw new Error(errorMessage);
  }
  return response.json();
};

export const createCandidateManually = async (data: CandidateFormValues): Promise<CreateCandidateResponse> => {
  const response = await apiRequest(`/api/candidates`, {
    method: "POST",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get all candidates (legacy - loads all candidates)
export const getAllCandidates = async (limit = 100): Promise<CandidateData[]> => {
  const response = await apiRequest(`/api/candidates?limit=${limit}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  const data = await response.json();
  
  // Backend returns { candidates: [], totalPages, currentPage, total }
  // Extract just the candidates array for backward compatibility
  return data.candidates || [];
};

// Get candidates with pagination
export const getCandidatesPaginated = async (params: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
} = {}): Promise<{
  candidates: CandidateData[];
  totalPages: number;
  currentPage: number;
  total: number;
}> => {
  const { page = 1, limit = 10, status, search } = params;
  
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (status) queryParams.append('status', status);
  if (search) queryParams.append('search', search);

  const response = await apiRequest(`/api/candidates?${queryParams.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  
  return response.json();
};

// Get candidate by ID
export const getCandidateById = async (id: string): Promise<CandidateData> => {
  const response = await apiRequest(`/api/candidates/${id}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Update candidate
export const updateCandidate = async (id: string, data: Partial<CandidateFormValues>): Promise<CandidateData> => {
  const response = await apiRequest(`/api/candidates/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Delete candidate
export const deleteCandidate = async (id: string): Promise<{ msg: string }> => {
  const response = await apiRequest(`/api/candidates/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Bulk delete candidates
export const bulkDeleteCandidates = async (candidateIds: string[]): Promise<{
  success: boolean;
  deleted: number;
  failed: number;
  results: Array<{ id: string; success: boolean }>;
  failures: Array<{ id: string; error: string }>;
}> => {
  const response = await apiRequest(`/api/candidates/bulk`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ candidateIds })
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get accessible resume URLs for PDFs
export const getAccessibleResumeUrl = async (candidateId: string): Promise<{
  accessibleUrl: string;
  downloadUrl: string;
  previewUrl: string;
  originalUrl: string;
}> => {
  const response = await apiRequest(`/api/candidates/${candidateId}/accessible-resume-url`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Check embedding status for candidate
export const checkEmbeddingStatus = async (candidateId: string): Promise<{
  candidateId: string;
  isEmbedded: boolean;
  embeddingCreatedAt?: string;
  existsInPinecone: boolean;
  needsEmbedding: boolean;
}> => {
  const response = await apiRequest(`/api/candidates/${candidateId}/embedding-status`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Create embedding for candidate
export const createEmbedding = async (candidateId: string): Promise<{
  msg: string;
  candidateId: string;
  embeddingCreatedAt: string;
}> => {
  const response = await apiRequest(`/api/candidates/${candidateId}/create-embedding`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Refresh embedding with enhanced metadata for candidate
export const refreshEmbedding = async (candidateId: string): Promise<{
  msg: string;
  candidateId: string;
  embeddingCreatedAt: string;
  candidateName: string;
}> => {
  const response = await apiRequest(`/api/candidates/${candidateId}/refresh-embedding`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Add comment to candidate
export const addComment = async (id: string, note: string): Promise<CandidateData> => {
  const response = await apiRequest(`/api/candidates/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Delete comment from candidate
export const deleteComment = async (candidateId: string, commentId: string): Promise<CandidateData> => {
  const response = await apiRequest(`/api/candidates/${candidateId}/comments/${commentId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// It would be good to define CandidateFormValues in a shared types file
// if it's used by both the page and the service.
// For now, this assumes it's accessible or we can redefine it here if needed.
// export type { CandidateFormValues }; // Re-export if defined elsewhere and imported here
// Or define a similar type here if not exported from page.tsx
// Bulk upload types and API
export interface BulkUploadResponse {
  msg: string;
  batchId: string;
  totalFiles: number;
  statusUrl: string;
}

export interface BulkUploadStatus {
  batchId: string;
  totalFiles: number;
  completed: number;
  successful: number;
  failed: number;
  processing: number;
  results: Array<{ fileName: string; candidateId: string; candidateName: string; success: true }>;
  errors: Array<{ fileName: string; error: string; success: false }>;
  startedAt: string;
  completedAt: string | null;
  state: 'processing' | 'completed';
}

export const bulkUploadCVs = async (files: File[]): Promise<BulkUploadResponse> => {
  const token = localStorage.getItem('jwt');
  const formData = new FormData();
  files.forEach((file) => formData.append('resumes', file));

  const response = await apiRequest('/api/bulk-upload/cv', {
    method: 'POST',
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    body: formData,
  });

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({ msg: 'Bulk upload failed' }));
    throw new Error(err.msg || err.error || 'Bulk upload failed');
  }
  return response.json();
};

export const getBulkUploadStatus = async (batchId: string): Promise<BulkUploadStatus> => {
  const response = await apiRequest(`/api/bulk-upload/status/${batchId}`, { method: 'GET' });
  if (!response.ok) {
    const err: any = await response.json().catch(() => ({ msg: 'Status check failed' }));
    throw new Error(err.msg || 'Status check failed');
  }
  return response.json();
};

export type { CandidateData };