import { apiRequest, getAuthHeaders } from './apiConfig';
import { handleApiError } from '../utils/errorHandlers';

export interface JobData {
  _id: string;
  organization?: string; // Organization ID
  title: string;
  department: string | { _id: string; name: string };
  location: string;
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Freelance';
  level: 'Entry' | 'Mid' | 'Senior' | 'Lead' | 'Executive';
  description: string;
  requirements: string;
  responsibilities: string;
  skills?: string;
  experience: '0-1' | '1-3' | '3-5' | '5-10' | '10+';
  education: 'High School' | 'Associate' | 'Bachelor' | 'Master' | 'PhD' | 'Professional Certificate';
  salary?: {
    min: number;
    max: number;
    currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CNY' | 'NGN' | 'ZAR' | 'KES' | 'GHS' | 'EGP' | 'MAD' | 'TND' | 'ETB' | 'UGX' | 'TZS' | 'XOF' | 'XAF' | 'BWP' | 'ZMW' | 'MWK' | 'CAD' | 'AUD' | 'INR' | 'BRL' | 'AED' | 'SGD' | 'HKD' | 'MXN';
    period: 'hourly' | 'monthly' | 'annually';
  };
  benefits?: string;
  status: 'draft' | 'active' | 'paused' | 'closed' | 'archived';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  remote: boolean;
  openings: number;
  applicationDeadline?: string;
  startDate?: string;
  hiringManager?: string;
  isPublic?: boolean;
  publicSlug?: string;
  publicUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  applicantCount?: number;
  daysUntilDeadline?: number;
  analytics?: {
    publicViews?: number;
    publicApplications?: number;
    internalViews?: number;
    internalApplications?: number;
  };
  candidateApplyLimit?: number;
  publicApplicationCount?: number;
  // Internal recruitment fields
  isInternalEnabled?: boolean;
  internalSlug?: string;
  internalUrl?: string;
  internalApplicationCount?: number;
  internalCandidateApplyLimit?: number;
  reservedInternalCredits?: number;
  internalSettings?: {
    requireEmployeeId?: boolean;
    notifyHiringManager?: boolean;
  };
  shortlist?: {
    candidate: string;
    addedAt: string;
    addedBy: string;
    status: 'shortlisted' | 'moved_to_pipeline' | 'rejected';
    movedToPipelineAt?: string;
  }[];
  applicants?: Array<{
    _id?: string;
    candidate: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      position: string;
      experience: string;
      education: string;
      skills: string;
      location: string;
      resumeUrl?: string;
    };
    status: 'applied' | 'reviewing' | 'shortlisted' | 'interviewing' | 'offered' | 'hired' | 'rejected';
    appliedAt?: string;
    addedAt?: string;
    addedBy?: string;
    notes?: string;
    score?: number;
    tags?: string[];
    statusHistory?: Array<{
      status: string;
      changedBy: string;
      changedAt: string;
      notes?: string;
      previousStatus?: string;
    }>;
  }>;
}

export interface JobFormData {
  title: string;
  department: string;
  location: string;
  type: JobData['type'];
  level: JobData['level'];
  description: string;
  requirements: string;
  responsibilities: string;
  skills?: string;
  experience: JobData['experience'];
  education: JobData['education'];
  salary?: {
    min: number;
    max: number;
    currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CNY' | 'NGN' | 'ZAR' | 'KES' | 'GHS' | 'EGP' | 'MAD' | 'TND' | 'ETB' | 'UGX' | 'TZS' | 'XOF' | 'XAF' | 'BWP' | 'ZMW' | 'MWK' | 'CAD' | 'AUD' | 'INR' | 'BRL' | 'AED' | 'SGD' | 'HKD' | 'MXN';
    period: 'hourly' | 'monthly' | 'annually';
  };
  benefits?: string;
  status?: JobData['status'];
  priority?: JobData['priority'];
  remote?: boolean;
  openings?: number;
  applicationDeadline?: string;
  startDate?: string;
  hiringManager?: string;
  isPublic?: boolean;
  candidateApplyLimit?: number;
}

interface CreateJobResponse {
  msg: string;
  job: JobData;
}

interface BulkUploadResponse {
  msg: string;
  results: {
    successful: Array<{
      row: number;
      job: {
        id: string;
        title: string;
        department: string;
      };
    }>;
    failed: Array<{
      row: number;
      data: any;
      error: string;
    }>;
    total: number;
  };
  batchId: string;
}

interface ApiError {
  msg: string;
  error?: any;
  requiresOrganizationSetup?: boolean;
}

// Use centralized error handler
const handleOrganizationError = handleApiError;

// Create a new job manually
export const createJob = async (data: JobFormData): Promise<CreateJobResponse> => {
  const response = await apiRequest(`/api/jobs`, {
    method: "POST",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get all jobs
export const getAllJobs = async (params?: {
  status?: string;
  department?: string;
  type?: string;
  search?: string;
  limit?: number;
}): Promise<JobData[]> => {
  const searchParams = new URLSearchParams();
  
  if (params?.status) searchParams.append('status', params.status);
  if (params?.department) searchParams.append('department', params.department);
  if (params?.type) searchParams.append('type', params.type);
  if (params?.search) searchParams.append('search', params.search);
  if (params?.limit) searchParams.append('limit', params.limit.toString());

  const response = await apiRequest(`/api/jobs?${searchParams.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get job by ID
export const getJobById = async (id: string): Promise<JobData> => {
  const response = await apiRequest(`/api/jobs/${id}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Update job
export const updateJob = async (id: string, data: Partial<JobFormData>): Promise<JobData> => {
  const response = await apiRequest(`/api/jobs/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  const result = await response.json();
  return result.job;
};

// Delete job
export const deleteJob = async (id: string): Promise<{ msg: string }> => {
  const response = await apiRequest(`/api/jobs/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Bulk delete jobs
export const bulkDeleteJobs = async (jobIds: string[]): Promise<{
  success: boolean;
  deleted: number;
  failed: number;
  results: Array<{ id: string; title?: string; success: boolean }>;
  failures: Array<{ id: string; error: string }>;
}> => {
  const response = await apiRequest(`/api/jobs/bulk`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ jobIds })
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Bulk upload jobs from CSV/Excel
export const bulkUploadJobs = async (formData: FormData): Promise<BulkUploadResponse> => {
  const token = localStorage.getItem('jwt');
  const response = await apiRequest(`/api/jobs/bulk-upload`, {
    method: "POST",
    headers: {
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Add candidate to shortlist
export const addCandidateToShortlist = async (jobId: string, candidateId: string): Promise<{ msg: string }> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist`, {
    method: "POST",
    body: JSON.stringify({ candidateId }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Bulk add candidates to shortlist
export const bulkAddToShortlist = async (
  jobId: string,
  candidateIds: string[]
): Promise<{
  success: boolean;
  addedCount: number;
  skippedCount: number;
  added: string[];
  skipped: Array<{ id: string; reason: string }>;
}> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/bulk`, {
    method: "POST",
    body: JSON.stringify({ candidateIds })
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get shortlist (auto-sorted if rankings exist)
export const getShortlist = async (jobId: string): Promise<{ shortlist: any[], hasRankings?: boolean, jobId: string, jobTitle: string }> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get ranked shortlist
export const getRankedShortlist = async (jobId: string): Promise<{ matches: any[] }> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/rank`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Remove candidate from shortlist
export const removeCandidateFromShortlist = async (jobId: string, candidateId: string): Promise<{ msg: string }> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/${candidateId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Update shortlist candidate status
export const updateShortlistCandidateStatus = async (
  jobId: string, 
  candidateId: string, 
  status: 'shortlisted' | 'moved_to_pipeline' | 'rejected'
): Promise<{ msg: string; shortlistItem: any }> => {
  console.log(`🔄 Updating shortlist status for candidate ${candidateId} to ${status}`)
  
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/${candidateId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    console.error(`❌ API error updating shortlist status:`, errorResult)
    handleOrganizationError(errorResult);
  }
  
  const result = await response.json();
  console.log(`✅ Successfully updated shortlist status:`, result)
  return result;
};

// Clear shortlist ranking
export const clearShortlistRanking = async (jobId: string): Promise<{ msg: string; clearedCount: number }> => {
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist-ranking`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Bulk move candidates from shortlist to pipeline
export const bulkMoveShortlistToPipeline = async (
  jobId: string, 
  candidateIds: string[]
): Promise<{
  success: boolean;
  moved: number;
  failed: number;
  results: Array<{ candidateId: string; success: boolean }>;
  failures: Array<{ candidateId: string; reason: string }>;
}> => {
  console.log(`🔄 Bulk moving ${candidateIds.length} candidates from shortlist to pipeline`);
  
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/bulk-move-to-pipeline`, {
    method: "POST",
    body: JSON.stringify({ candidateIds }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    console.error(`❌ API error during bulk move:`, errorResult);
    handleOrganizationError(errorResult);
  }
  
  const result = await response.json();
  console.log(`✅ Bulk move completed:`, result);
  return result;
};

// Bulk remove candidates from shortlist
export const bulkRemoveFromShortlist = async (
  jobId: string, 
  candidateIds: string[]
): Promise<{
  success: boolean;
  removed: number;
  failed: number;
  results: Array<{ candidateId: string; success: boolean }>;
  failures: Array<{ candidateId: string; reason: string }>;
}> => {
  console.log(`🗑️ Bulk removing ${candidateIds.length} candidates from shortlist`);
  
  const response = await apiRequest(`/api/jobs/${jobId}/shortlist/bulk-remove`, {
    method: "POST",
    body: JSON.stringify({ candidateIds }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    console.error(`❌ API error during bulk removal:`, errorResult);
    handleOrganizationError(errorResult);
  }
  
  const result = await response.json();
  console.log(`✅ Bulk removal completed:`, result);
  return result;
};


// Get candidates eligible for interview (pipeline + shortlist)
export const getJobInterviewCandidates = async (jobId: string): Promise<any[]> => {
  try {
    // Fetch both job details and shortlist in parallel
    const [job, shortlistData] = await Promise.all([
      getJobById(jobId),
      getShortlist(jobId).catch(() => ({ shortlist: [] })) // Gracefully handle if shortlist fetch fails
    ]);
    
    if (!job) throw new Error('Job not found');

    const candidates: any[] = [];
    const seenIds = new Set<string>();

    // Add pipeline candidates
    if (job.applicants && job.applicants.length > 0) {
      job.applicants.forEach(applicant => {
        if (applicant.candidate && !seenIds.has(applicant.candidate._id)) {
          seenIds.add(applicant.candidate._id);
          candidates.push({
            ...applicant.candidate,
            source: 'pipeline',
            pipelineStatus: applicant.status,
            currentStage: {
              name: applicant.status
            },
            appliedAt: applicant.appliedAt || applicant.addedAt
          });
        }
      });
    }

    // Add shortlist candidates (if not already in pipeline)
    if (shortlistData.shortlist && shortlistData.shortlist.length > 0) {
      shortlistData.shortlist.forEach(item => {
        // The shortlist API returns items with populated candidate data
        const candidateData = item.candidate;
        if (candidateData && !seenIds.has(candidateData._id)) {
          seenIds.add(candidateData._id);
          
          // Extract name from the candidate object
          const nameParts = candidateData.name ? candidateData.name.split(' ') : [];
          const firstName = candidateData.firstName || nameParts[0] || '';
          const lastName = candidateData.lastName || nameParts.slice(1).join(' ') || '';
          
          candidates.push({
            _id: candidateData._id,
            firstName: firstName,
            lastName: lastName,
            email: candidateData.email,
            phone: candidateData.phone,
            position: candidateData.position,
            experience: candidateData.experience,
            skills: candidateData.skills,
            location: candidateData.location,
            source: 'shortlist',
            shortlistStatus: item.status || 'shortlisted',
            relevanceScore: item.relevanceScore,
            addedAt: item.addedAt
          });
        }
      });
    }

    console.log(`📊 Loaded ${candidates.length} candidates (${candidates.filter(c => c.source === 'pipeline').length} pipeline, ${candidates.filter(c => c.source === 'shortlist').length} shortlist)`);
    
    return candidates;
  } catch (error) {
    console.error('Error fetching job interview candidates:', error);
    throw error;
  }
};

// Helper function to format salary
export const formatSalary = (salary?: JobData['salary']): string => {
  if (!salary || (!salary.min && !salary.max)) return 'Salary not specified';
  
  const currencySymbols: Record<string, string> = {
    NGN: '₦',
    USD: '$',
    EUR: '€',
    GBP: '£',
  };

  const symbol = currencySymbols[salary.currency] || salary.currency;
  const period = salary.period === 'annually' ? '/year' : 
                 salary.period === 'monthly' ? '/month' : '/hour';
  
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };
  
  if (salary.min && salary.max) {
    return `${symbol}${formatNumber(salary.min)} - ${symbol}${formatNumber(salary.max)}${period}`;
  } else if (salary.min) {
    return `${symbol}${formatNumber(salary.min)}+ ${period}`;
  } else if (salary.max) {
    return `Up to ${symbol}${formatNumber(salary.max)}${period}`;
  }
  
  return 'Salary not specified';
};

// Helper function to calculate days until deadline
export const getDaysUntilDeadline = (deadline?: string): number | null => {
  if (!deadline) return null;
  const today = new Date();
  const deadlineDate = new Date(deadline);
  const diffTime = deadlineDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Export types for use in components
export type { CreateJobResponse, BulkUploadResponse }; 