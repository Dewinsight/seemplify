import { apiRequest } from './apiConfig';

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('jwt');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
};

interface EmbeddingStatus {
  jobs: {
    total: number;
    embedded: number;
    percentage: number;
    recent: Array<{
      _id: string;
      title: string;
      embeddingCreatedAt: string;
    }>;
  };
  candidates: {
    total: number;
    embedded: number;
    percentage: number;
    recent: Array<{
      _id: string;
      firstName: string;
      lastName: string;
      embeddingCreatedAt: string;
    }>;
  };
  timestamp: string;
}

interface ReEmbeddingResult {
  msg: string;
  success: boolean;
  duration?: string;
  totalJobs?: number;
  totalCandidates?: number;
  successCount?: number;
  errorCount?: number;
  jobs?: {
    total: number;
    success: number;
    errors: number;
  };
  candidates?: {
    total: number;
    success: number;
    errors: number;
  };
  results?: Array<{
    jobId?: string;
    candidateId?: string;
    title?: string;
    name?: string;
    status: 'success' | 'error';
    error?: string;
    timestamp: string;
  }>;
}

interface ApiError {
  msg: string;
  error?: any;
}

// Get embedding status overview
export const getEmbeddingStatus = async (): Promise<{ status: EmbeddingStatus }> => {
  const response = await apiRequest(`/api/embeddings/status`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to get embedding status");
  }
  return response.json();
};

// Re-embed all jobs (fixes skills parsing issue)
export const reEmbedAllJobs = async (): Promise<ReEmbeddingResult> => {
  const response = await apiRequest(`/api/embeddings/re-embed/jobs`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to re-embed jobs");
  }
  return response.json();
};

// Re-embed all candidates
export const reEmbedAllCandidates = async (): Promise<ReEmbeddingResult> => {
  const response = await apiRequest(`/api/embeddings/re-embed/candidates`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to re-embed candidates");
  }
  return response.json();
};

// Re-embed everything (jobs and candidates)
export const reEmbedAll = async (): Promise<ReEmbeddingResult> => {
  const response = await apiRequest(`/api/embeddings/re-embed/all`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to re-embed all");
  }
  return response.json();
};

// Re-embed a specific job
export const reEmbedJob = async (jobId: string): Promise<ReEmbeddingResult> => {
  const response = await apiRequest(`/api/embeddings/re-embed/job/${jobId}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to re-embed job");
  }
  return response.json();
};

// Re-embed a specific candidate
export const reEmbedCandidate = async (candidateId: string): Promise<ReEmbeddingResult> => {
  const response = await apiRequest(`/api/embeddings/re-embed/candidate/${candidateId}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to re-embed candidate");
  }
  return response.json();
};

// Legacy individual embedding functions (for existing pages)
export const checkEmbeddingStatus = async (candidateId: string) => {
  const response = await apiRequest(`/api/candidates/${candidateId}/embedding-status`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to check embedding status");
  }
  return response.json();
};

export const createEmbedding = async (candidateId: string) => {
  const response = await apiRequest(`/api/candidates/${candidateId}/create-embedding`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw new Error(errorResult.msg || "Failed to create embedding");
  }
  return response.json();
};

// Default export for backward compatibility
export const embeddingService = {
  checkEmbeddingStatus,
  createEmbedding,
};

// Export types for use in components
export type { EmbeddingStatus, ReEmbeddingResult }; 