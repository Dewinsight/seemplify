import { apiRequest } from './apiConfig'

export interface EnrichmentEstimateResponse {
  jobId: string
  enrichCount: number
  batchSize: number
  batchCount: number
  costPerBatch: number
  totalCredits: number
  availableCredits: number
  hasEnoughCredits: boolean
  estimatedSeconds: number
  estimatedMinutes: number
}

export interface StartEnrichmentResponse {
  success: boolean
  enrichmentId: string
  jobId: string
  enrichCount: number
  batchCount: number
  estimatedCredits: number
  statusUrl: string
  resultsUrl: string
  message: string
}

export interface EnrichmentStatusResponse {
  enrichmentId: string
  state: 'processing' | 'completed' | 'failed'
  totalCandidates: number
  enrichCount: number
  batchCount: number
  completedBatches: number
  successfulBatches: number
  failedBatches: number
  completedCandidates: number
  successfulCandidates: number
  failedCandidates: number
  progressPercent: number
  elapsedSeconds: number
  etaSeconds: number | null
  candidatesPerSecond: number
  previewTopMatches: any[]
  rankedMatches: any[]
  errors: Array<{ error: string; timestamp: string }>
}

export interface EnrichmentResultsResponse {
  enrichmentId: string
  jobId: string
  totalCandidates: number
  enrichCount: number
  completedAt: string
  rankedMatches: any[]
}

const parseError = async (response: Response) => {
  const error = await response.json().catch(() => ({
    message: `HTTP error! status: ${response.status}`,
  }))
  throw error
}

export async function getEnrichmentEstimate(jobId: string, enrichCount: number): Promise<EnrichmentEstimateResponse> {
  const response = await apiRequest(`/api/enrichment/estimate/${jobId}?enrichCount=${enrichCount}`, {
    method: 'GET',
  })

  if (!response.ok) {
    await parseError(response)
  }

  return response.json()
}

export async function startEnrichment(
  jobId: string,
  enrichCount: number,
  matches: any[]
): Promise<StartEnrichmentResponse> {
  const response = await apiRequest(`/api/enrichment/start/${jobId}`, {
    method: 'POST',
    body: JSON.stringify({ enrichCount, matches }),
  })

  if (!response.ok) {
    await parseError(response)
  }

  return response.json()
}

export async function getEnrichmentStatus(enrichmentId: string): Promise<EnrichmentStatusResponse> {
  const response = await apiRequest(`/api/enrichment/status/${enrichmentId}`, {
    method: 'GET',
  })

  if (!response.ok) {
    await parseError(response)
  }

  return response.json()
}

export async function getEnrichmentResults(enrichmentId: string): Promise<EnrichmentResultsResponse> {
  const response = await apiRequest(`/api/enrichment/results/${enrichmentId}`, {
    method: 'GET',
  })

  if (!response.ok) {
    await parseError(response)
  }

  return response.json()
}
