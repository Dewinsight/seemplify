import { apiRequest } from './apiConfig';

export interface CandidateShortlistInfo {
  jobId: string;
  jobTitle: string;
  status: string;
  addedAt?: string;
  relevanceScore?: number;
}

export interface CandidateShortlistsResponse {
  candidateShortlists: Record<string, CandidateShortlistInfo[]>;
  totalCandidatesWithShortlists: number;
}

export const getCandidateShortlists = async (): Promise<CandidateShortlistsResponse> => {
  const response = await apiRequest('/api/candidate-shortlists', {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch candidate shortlists');
  }

  return response.json();
};

export default {
  getCandidateShortlists,
};
