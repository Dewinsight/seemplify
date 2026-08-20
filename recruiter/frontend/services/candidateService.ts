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
  processingMetadata?: {
    uploadSuccess?: boolean;
    parseSuccess?: boolean;
    aiSuccess?: boolean;
    fileSize?: number;
    originalName?: string;
    processedAt?: string;
    cvProcessingJobId?: string;
    cvIngestionState?: 'not_received' | 'accepted' | 'queued' | 'processing' | 'waiting' | 'waiting_for_chatgpt' | 'failed' | 'completed' | 'cancelled' | 'deleted';
    cvProcessingStage?: 'received' | 'ingesting' | 'uploading' | 'stored' | 'extracting' | 'analyzing' | 'profile_creation' | 'finalizing' | 'retry_scheduled' | 'completed' | 'failed' | string;
    cvProcessingProgress?: number;
    cvProcessingUpdatedAt?: string;
    cvRetryEligible?: boolean;
    cvProcessingError?: {
      code?: string;
      message?: string;
      stage?: string;
      at?: string;
    };
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

export interface CVProcessingStatus {
  jobId: string;
  state: 'queued' | 'waiting_for_chatgpt' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'deleted';
  stage?: 'ingesting' | 'uploading' | 'extracting' | 'analyzing' | 'finalizing' | 'completed' | 'failed' | null;
  progress: number;
  position: number | null;
  candidateId: string | null;
  attempts?: number;
  aiAttempts?: number;
  retry?: {
    available: boolean;
    availableUntil?: string | null;
    nextAttemptAt?: string | null;
    requestedStage?: 'failed' | 'parsing' | 'analysis';
    manualRequests?: number;
    automaticRetries?: number;
    manualRetries?: number;
  };
  attemptHistory?: Array<{
    number: number;
    trigger: 'initial' | 'automatic' | 'manual';
    requestedStage: 'failed' | 'parsing' | 'analysis';
    status: 'processing' | 'waiting_for_runtime' | 'failed' | 'completed';
    stage?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
  error?: { code?: string; message?: string };
}

export interface AcceptedCVProcessing extends CVProcessingStatus {
  statusToken: string;
  statusUrl: string;
}

export class CVProcessingError extends Error {
  status: CVProcessingStatus;
  accepted: AcceptedCVProcessing;

  constructor(message: string, status: CVProcessingStatus, accepted: AcceptedCVProcessing) {
    super(message);
    this.name = 'CVProcessingError';
    this.status = status;
    this.accepted = accepted;
  }
}

export class CVProcessingPendingError extends Error {
  status: CVProcessingStatus;
  accepted: AcceptedCVProcessing;

  constructor(status: CVProcessingStatus, accepted: AcceptedCVProcessing) {
    super('CV processing is continuing safely in the background. You can follow it from Processing history.');
    this.name = 'CVProcessingPendingError';
    this.status = status;
    this.accepted = accepted;
  }
}

type CVProcessingWaitOptions = {
  signal?: AbortSignal;
  maxWaitMs?: number;
};

function abortedProcessingError() {
  const error = new Error('CV status polling was cancelled');
  error.name = 'AbortError';
  return error;
}

function waitForPoll(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedProcessingError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedProcessingError());
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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

const waitForCVProcessing = async (
  accepted: AcceptedCVProcessing,
  onStatus?: (status: CVProcessingStatus) => void,
  options: CVProcessingWaitOptions = {},
): Promise<UploadCVResponse> => {
  let status: CVProcessingStatus = accepted;
  const deadline = Date.now() + Math.max(5_000, options.maxWaitMs ?? 120_000);
  onStatus?.(status);
  while (!['completed', 'failed', 'cancelled', 'deleted'].includes(status.state)) {
    if (options.signal?.aborted) throw abortedProcessingError();
    if (Date.now() >= deadline) throw new CVProcessingPendingError(status, accepted);
    await waitForPoll(2_000, options.signal);
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') continue;
    if (typeof navigator !== 'undefined' && !navigator.onLine) continue;
    const response = await apiRequest(accepted.statusUrl, {
      method: 'GET',
      headers: { 'X-CV-Status-Token': accepted.statusToken },
      signal: options.signal,
    });
    if (!response.ok) throw new Error('Could not read CV processing status');
    status = await response.json();
    onStatus?.(status);
  }
  if (status.state !== 'completed' || !status.candidateId) {
    const fallback = ['cancelled', 'deleted'].includes(status.state)
      ? 'CV processing was cancelled'
      : 'CV processing failed';
    throw new CVProcessingError(status.error?.message || fallback, status, accepted);
  }
  const candidate = await getCandidateById(status.candidateId);
  return {
    msg: 'Candidate created successfully from CV',
    candidate,
    processingResults: {
      cloudinaryUpload: true,
      cvParsing: true,
      aiAnalysis: true,
      textExtracted: true,
      fieldsExtracted: Object.keys(candidate.parsedData || {}).length,
    },
  };
};

export const resumeCVProcessing = (
  accepted: AcceptedCVProcessing,
  onStatus?: (status: CVProcessingStatus) => void,
  options?: CVProcessingWaitOptions,
) => waitForCVProcessing(accepted, onStatus, options);

export const retryCVProcessing = async (
  accepted: AcceptedCVProcessing,
  onStatus?: (status: CVProcessingStatus) => void,
  stage: 'failed' | 'parsing' | 'analysis' = 'failed',
  options: CVProcessingWaitOptions = {},
): Promise<UploadCVResponse> => {
  const response = await apiRequest(`/api/candidates/cv-jobs/${encodeURIComponent(accepted.jobId)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
    signal: options.signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.msg || result.message || 'CV processing could not be retried');
  }
  onStatus?.(result as CVProcessingStatus);
  return waitForCVProcessing(accepted, onStatus, options);
};

export const uploadCV = async (
  formData: FormData,
  onStatus?: (status: CVProcessingStatus) => void,
  options?: {
    idempotencyKey?: string;
    onAccepted?: (accepted: AcceptedCVProcessing) => void;
    signal?: AbortSignal;
    maxWaitMs?: number;
  },
): Promise<UploadCVResponse> => {
  const token = localStorage.getItem('jwt');
  const response = await apiRequest(`/api/candidates/upload-cv`, {
    method: "POST",
    headers: {
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(options?.idempotencyKey && { 'Idempotency-Key': options.idempotencyKey }),
    },
    body: formData,
    signal: options?.signal,
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
    
    // Preserve response metadata so callers can rotate a definitively rejected
    // idempotency key without weakening replay safety for network/5xx failures.
    const error = new Error(errorMessage);
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = errorResult.code;
    throw error;
  }
  const result = await response.json();
  if (response.status === 202) {
    options?.onAccepted?.(result as AcceptedCVProcessing);
    return waitForCVProcessing(result, onStatus, options);
  }
  return result;
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
  cancelled?: number;
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

// Bulk download a ZIP with one folder per candidate (profile.pdf + CV)
export const bulkDownloadCandidates = async (candidateIds: string[]): Promise<void> => {
  const response = await apiRequest(`/api/candidates/bulk-download`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ candidateIds })
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
    return;
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'candidates.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
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
  existsInVectorStore: boolean;
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

export interface CVIngestionJob {
  jobId: string;
  source: 'private' | 'public' | 'bulk' | 'replacement' | 'ai-interview' | string;
  state: 'queued' | 'waiting_for_chatgpt' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'deleted';
  phase?: string | null;
  stage?: 'received' | 'ingesting' | 'uploading' | 'stored' | 'extracting' | 'analyzing' | 'profile_creation' | 'finalizing' | 'retry_scheduled' | 'completed' | 'failed' | 'cancelled' | 'deleted' | null;
  progress?: number | null;
  stageStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  attempts?: number;
  processingAttempts?: number;
  revision?: number;
  supersedesJobId?: string | null;
  supersededByJobId?: string | null;
  artifacts?: {
    received?: { available?: boolean; at?: string | null };
    durableFile?: { available?: boolean; storedAt?: string | null };
    cloudinaryFile?: { available?: boolean; storedAt?: string | null; provider?: string | null };
    managedFile?: { available?: boolean; storedAt?: string | null; provider?: string | null };
    extractedText?: { available?: boolean; length?: number; extractedAt?: string | null };
    analysis?: { available?: boolean; completedAt?: string | null };
    profile?: { available?: boolean; committedAt?: string | null };
  } | null;
  error?: { code?: string | null; message?: string | null; stage?: string | null; at?: string | null } | null;
  retry?: {
    available?: boolean;
    availableUntil?: string | null;
    nextAttemptAt?: string | null;
    requestedStage?: 'failed' | 'parsing' | 'analysis' | null;
    manualRequests?: number;
    automaticRetries?: number;
    manualRetries?: number;
    replacementAvailable?: boolean;
  } | null;
  stageHistory?: Array<{
    stage?: string | null;
    state?: string | null;
    status?: string | null;
    progress?: number | null;
    attempt?: number | null;
    at?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
  attemptHistory?: CVProcessingStatus['attemptHistory'];
  organization?: { id?: string | null; organizationId?: string | null; name?: string | null } | string | null;
  uploader?: { id?: string | null; userId?: string | null; name?: string | null; email?: string | null } | string | null;
  file?: {
    name?: string | null;
    originalName?: string | null;
    size?: number | null;
    type?: string | null;
    receivedAt?: string | null;
    storedAt?: string | null;
    cloudStoredAt?: string | null;
  } | null;
  originalName?: string | null;
  application?: { jobId?: string | null; jobTitle?: string | null } | null;
  candidate?: { id?: string | null; candidateId?: string | null; name?: string | null; email?: string | null } | string | null;
  candidateId?: string | null;
  batch?: { id?: string | null; batchId?: string | null } | string | null;
}

export interface BulkUploadStatus {
  batchId: string;
  totalFiles: number;
  completed: number;
  successful: number;
  failed: number;
  cancelled?: number;
  processing: number;
  queued: number;
  results: Array<{ fileName: string; candidateId: string; candidateName?: string; success: true }>;
  errors: Array<{ fileName: string; error: string; success: false }>;
  /** Rich per-file rows are additive to the legacy aggregate fields. Older
   * deployments may omit this array, so callers must keep an honest fallback. */
  jobs?: CVIngestionJob[];
  startedAt: string;
  completedAt: string | null;
  state: 'processing' | 'waiting_for_chatgpt' | 'completed';
  /** Why the batch is parked, when it is — e.g. the ChatGPT plan's usage
   * limit and when it resets. Null while work is moving normally. */
  waitingReason?: string | null;
  waitingCode?: string | null;
}

export const bulkUploadCVs = async (files: File[], idempotencyKey?: string): Promise<BulkUploadResponse> => {
  const token = localStorage.getItem('jwt');
  const formData = new FormData();
  files.forEach((file) => formData.append('resumes', file));

  const response = await apiRequest('/api/bulk-upload/cv', {
    method: 'POST',
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
    },
    body: formData,
  });

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({ msg: 'Bulk upload failed' }));
    const error = new Error(err.msg || err.error || 'Bulk upload failed');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = err.code;
    throw error;
  }
  return response.json();
};

export const getBulkUploadStatus = async (batchId: string): Promise<BulkUploadStatus> => {
  const response = await apiRequest(`/api/bulk-upload/status/${batchId}`, { method: 'GET' });
  if (!response.ok) {
    const err: any = await response.json().catch(() => ({ msg: 'Status check failed' }));
    const error = new Error(err.msg || 'Status check failed');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = err.code;
    throw error;
  }
  return response.json();
};

export const retryCVIngestionJob = async (
  jobId: string,
  stage: 'failed' | 'parsing' | 'analysis' = 'failed',
): Promise<{ job: CVIngestionJob; queueAvailable?: boolean; requestedStage?: string; effectiveStage?: string }> => {
  const response = await apiRequest(`/api/cv-ingestion/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.msg || payload.message || 'CV processing could not be retried');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = payload.code;
    throw error;
  }
  return payload;
};

export const replaceCVIngestionJob = async (
  jobId: string,
  file: File,
  idempotencyKey: string,
): Promise<{ job: CVIngestionJob; priorJobId: string; replacement: true; duplicate?: boolean; queueAvailable?: boolean }> => {
  const body = new FormData();
  body.append('resume', file);
  body.append('expectedPriorJobId', jobId);
  const response = await apiRequest(`/api/cv-ingestion/jobs/${encodeURIComponent(jobId)}/replace`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || response.status !== 202 || !payload.job?.jobId) {
    const error = new Error(payload.msg || payload.message || 'Corrected CV could not be accepted');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = payload.code;
    throw error;
  }
  return payload;
};

export const getRecentBulkUploadStatus = async (): Promise<BulkUploadStatus | null> => {
  const response = await apiRequest('/api/bulk-upload/status/recent');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Failed to retrieve the recent bulk upload');
  return response.json();
};

export const retryBulkUpload = async (batchId: string): Promise<BulkUploadStatus & { promoted: number }> => {
  const response = await apiRequest(`/api/bulk-upload/status/${batchId}/retry`, { method: 'POST' });
  if (!response.ok) {
    const err: any = await response.json().catch(() => ({ msg: 'Retry failed' }));
    const error = new Error(err.msg || 'CV analysis could not be retried');
    (error as any).code = err.code;
    throw error;
  }
  return response.json();
};

export type { CandidateData };
