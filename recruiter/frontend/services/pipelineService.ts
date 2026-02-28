import { apiRequest } from './apiConfig'

export interface PipelineApplicant {
  _id: string
  candidate: {
    _id: string
    firstName: string
    lastName: string
    email: string
    phone: string
    position: string
    experience: string
    education: string
    skills: string
    location: string
    resumeUrl?: string
    score?: number
  }
  status: 'applied' | 'reviewing' | 'shortlisted' | 'interviewing' | 'keep_in_view' | 'offered' | 'hired' | 'rejected'
  appliedAt: string
  addedAt: string
  addedBy?: string
  notes?: string
  score?: number
  tags?: string[]
  statusHistory: Array<{
    status: string
    changedBy: string
    changedAt: string
    notes?: string
    previousStatus?: string
  }>
}

export interface PipelineAnalytics {
  totalApplicants: number
  stageBreakdown: Array<{
    stageId: string
    stageName: string
    candidateCount: number
    passRate: number
    averageTimeInStage: number
    conversionRate: number
    color: string
  }>
  conversions: Array<{
    from: string
    to: string
    rate: number
    count: number
  }>
  bottlenecks: Array<{
    stage: string
    candidateCount: number
    averageDays: number
    severity: 'low' | 'medium' | 'high'
  }>
  timeMetrics: {
    averageTimeToHire: number
    timeToHireTrend: number
    stageTimings: Array<{
      stage: string
      avgDays: number
      minDays: number
      maxDays: number
    }>
  }
  overallPassRate: number
  trends: Array<{
    date: string
    applications: number
    hired: number
    passRate: number
  }>
}

export interface UpdateStatusRequest {
  newStatus: string
  notes?: string
  notifyCandidate?: boolean
}

export interface BulkUpdateRequest {
  candidateIds: string[]
  newStatus: string
  notes?: string
}

export interface BatchOperation {
  type: 'move' | 'remove' | 'reject'
  candidateId: string
  stageId?: string
  notes?: string
  reason?: string
}

export interface BatchOperationRequest {
  jobId?: string
  operations: BatchOperation[]
}

export interface BatchOperationResponse {
  success: boolean
  processed: number
  successful: number
  failed: number
  results: any[]
  failures: any[]
}

export interface BulkMoveRequest {
  candidateIds: string[]
  targetStageId: string
}

export interface BulkMoveResult {
  success: boolean
  partialSuccess: boolean
  results: {
    successful: Array<{
      candidateId: string
      previousStage: string
      newStage: string
    }>
    failed: Array<{
      candidateId: string
      reason: string
    }>
    totalProcessed: number
  }
}

export interface KeepInViewRequest {
  reason?: string
}

export interface BulkKeepInViewRequest {
  candidateIds: string[]
  reason?: string
}

export interface BulkKeepInViewResult {
  success: boolean
  partialSuccess: boolean
  results: {
    successful: Array<{
      candidateId: string
      previousStatus: string
    }>
    failed: Array<{
      candidateId: string
      reason: string
    }>
    totalProcessed: number
  }
}

export interface AddToPipelineRequest {
  candidateId: string
  initialStatus?: string
  notes?: string
  score?: number
  tags?: string[]
}

class PipelineService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = '';
  }

  // Add candidate to pipeline
  async addCandidateToPipeline(
    jobId: string,
    candidateData: AddToPipelineRequest
  ): Promise<{ applicant: PipelineApplicant }> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/applicants`,
      {
        method: 'POST',
        body: JSON.stringify(candidateData),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      const errorObj = new Error(error.msg || 'Failed to add candidate to pipeline') as any;
      errorObj.statusCode = response.status;
      errorObj.originalMessage = error.msg;
      errorObj.fullError = error;
      throw errorObj;
    }

    return response.json();
  }

  // Get detailed pipeline with stage breakdown
  async getDetailedPipeline(jobId: string): Promise<any> {
    const response = await apiRequest(`/api/jobs/${jobId}/pipeline/detailed`, {
      method: 'GET',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to get detailed pipeline');
    }
    return response.json();
  }

  // Export detailed job pipeline report (Excel workbook)
  async exportPipelineExcelReport(jobId: string): Promise<{ blob: Blob; fileName: string }> {
    const response = await apiRequest(`/api/jobs/${jobId}/pipeline/export/excel`, {
      method: 'GET',
    });

    if (!response.ok) {
      let message = 'Failed to export pipeline report';
      try {
        const error = await response.json();
        message = error.msg || error.message || message;
      } catch {
        // Ignore JSON parsing errors
      }
      throw new Error(message);
    }

    const contentDisposition = response.headers.get('content-disposition') || '';
    const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
    let fileName = `pipeline_full_report_${new Date().toISOString().split('T')[0]}.xlsx`;
    if (fileNameMatch) {
      const rawName = fileNameMatch[1].replace(/"/g, '').trim();
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        fileName = rawName;
      }
    }

    const blob = await response.blob();
    return { blob, fileName };
  }

  // Move candidate to next stage
  async advanceCandidateToStage(jobId: string, candidateId: string, stageId: string, notes?: string): Promise<any> {
    const response = await apiRequest(`/api/jobs/${jobId}/candidates/${candidateId}/advance`, {
      method: 'POST',
      body: JSON.stringify({ stageId, notes }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to advance candidate');
    }
    return response.json();
  }

  // Put a candidate in keep-in-view status
  async keepCandidateInView(jobId: string, candidateId: string, data: KeepInViewRequest = {}): Promise<any> {
    const response = await apiRequest(`/api/jobs/${jobId}/candidates/${candidateId}/keep-in-view`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to keep candidate in view');
    }
    return response.json();
  }

  // Get stage-specific analytics
  async getStageAnalytics(jobId: string): Promise<any> {
    const response = await apiRequest(`/api/jobs/${jobId}/pipeline/stage-analytics`, {
      method: 'GET',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to get stage analytics');
    }
    return response.json();
  }

  // Update stage result (passed/failed/on_hold)
  async updateStageResult(
    jobId: string, 
    candidateId: string, 
    stageId: string, 
    result: 'passed' | 'failed' | 'on_hold',
    feedback?: string
  ): Promise<any> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/candidates/${candidateId}/stages/${stageId}/result`, 
      {
        method: 'PUT',
        body: JSON.stringify({ result, feedback }),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to update stage result');
    }
    return response.json();
  }

  // Schedule an interview for a candidate
  async scheduleInterview(
    jobId: string,
    candidateId: string,
    stageId: string,
    interviewData: {
      scheduledAt: string;
      duration?: number;
      interviewers?: string[];
      type?: string;
      location?: string;
      meetingLink?: string;
      notes?: string;
    }
  ): Promise<any> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/candidates/${candidateId}/stages/${stageId}/schedule-interview`, 
      {
        method: 'POST',
        body: JSON.stringify(interviewData),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to schedule interview');
    }
    return response.json();
  }

  // Get pipeline analytics
  async getPipelineAnalytics(jobId: string): Promise<PipelineAnalytics> {
    const response = await apiRequest(`/api/jobs/${jobId}/pipeline/analytics`, {
      method: 'GET',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to get pipeline analytics');
    }
    return response.json();
  }

  // Remove candidate from pipeline
  async removeCandidateFromPipeline(jobId: string, candidateId: string, reason?: string): Promise<any> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/candidates/${candidateId}`, 
      {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to remove candidate from pipeline');
    }
    return response.json();
  }

  // Batch operations
  async batchOperations(request: BatchOperationRequest): Promise<BatchOperationResponse> {
    const response = await apiRequest(
      `/api/pipeline/batch`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to process batch operations');
    }
    return response.json();
  }

  // Bulk move candidates to a target stage
  async bulkMoveApplicants(jobId: string, data: BulkMoveRequest): Promise<BulkMoveResult> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/pipeline/bulk-move`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to bulk move candidates');
    }
    const result = await response.json();
    return result.result;
  }

  // Bulk remove candidates
  async bulkRemoveCandidates(jobId: string, candidateIds: string[], reason?: string): Promise<any> {
    const response = await apiRequest(
      `/api/pipeline/${jobId}/candidates/bulk-remove`,
      {
        method: 'DELETE',
        body: JSON.stringify({
          candidateIds,
          reason
        }),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to bulk remove candidates');
    }
    return response.json();
  }

  // Bulk keep candidates in view
  async bulkKeepCandidatesInView(jobId: string, data: BulkKeepInViewRequest): Promise<BulkKeepInViewResult> {
    const response = await apiRequest(
      `/api/jobs/${jobId}/pipeline/bulk-keep-in-view`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Failed to bulk keep candidates in view');
    }
    const result = await response.json();
    return result.result;
  }

}

export default new PipelineService();
