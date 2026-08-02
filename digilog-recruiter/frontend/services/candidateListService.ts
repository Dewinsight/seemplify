import { apiRequest } from './apiConfig';
import type { CandidateData } from './candidateService';

export type CandidateListSource =
  | 'manual'
  | 'candidates'
  | 'ai_matching'
  | 'ai_interview'
  | 'imported';

export type CandidateListEntry = {
  candidate: CandidateData | string;
  rank?: number;
  score?: number;
  source?: CandidateListSource | string;
  notes?: string;
  addedAt?: string;
};

export type CandidateListSummary = {
  _id: string;
  id?: string;
  name: string;
  description?: string;
  source: CandidateListSource;
  sourceRef?: Record<string, unknown>;
  candidateCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CandidateListDetail = CandidateListSummary & {
  entries: CandidateListEntry[];
};

type ListResponse = {
  list: CandidateListDetail;
};

async function parseCandidateListResponse(response: Response): Promise<ListResponse> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ msg: 'Candidate list request failed' }));
    throw new Error(error.msg || 'Candidate list request failed');
  }
  return response.json();
}

export async function getCandidateLists(): Promise<CandidateListSummary[]> {
  const response = await apiRequest('/api/candidate-lists', { method: 'GET' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ msg: 'Failed to load candidate lists' }));
    throw new Error(error.msg || 'Failed to load candidate lists');
  }
  const data = await response.json();
  return data.lists || [];
}

export async function getCandidateList(id: string): Promise<CandidateListDetail> {
  const response = await apiRequest(`/api/candidate-lists/${id}`, { method: 'GET' });
  const data = await parseCandidateListResponse(response);
  return data.list;
}

export async function createCandidateList(payload: {
  name: string;
  description?: string;
  source?: CandidateListSource;
  sourceRef?: Record<string, unknown>;
  candidateIds?: string[];
  entries?: Array<{
    candidateId?: string;
    candidate?: string;
    id?: string;
    rank?: number;
    score?: number;
    source?: CandidateListSource | string;
    notes?: string;
  }>;
}): Promise<CandidateListDetail> {
  const response = await apiRequest('/api/candidate-lists', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseCandidateListResponse(response);
  return data.list;
}

export async function createCandidateListFromQuery(payload: {
  name: string;
  description?: string;
  search?: string;
  status?: string;
  limit?: number;
}): Promise<CandidateListDetail> {
  const response = await apiRequest('/api/candidate-lists/from-query', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseCandidateListResponse(response);
  return data.list;
}

export async function addCandidatesToList(
  listId: string,
  payload: {
    candidateIds?: string[];
    entries?: Array<{
      candidateId?: string;
      candidate?: string;
      id?: string;
      rank?: number;
      score?: number;
      source?: CandidateListSource | string;
      notes?: string;
    }>;
    source?: CandidateListSource | string;
  }
): Promise<CandidateListDetail> {
  const response = await apiRequest(`/api/candidate-lists/${listId}/candidates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseCandidateListResponse(response);
  return data.list;
}
