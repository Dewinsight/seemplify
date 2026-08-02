import { apiRequest } from './apiConfig';

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('jwt');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
};

class JobEmbeddingService {
  constructor() {
    // Remove: this.baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
  }

  /**
   * Get job embedding status
   */
  async getEmbeddingStatus(jobId) {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/embedding-status`, {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting job embedding status:', error);
      throw error;
    }
  }

  /**
   * Create job embedding
   */
  async createEmbedding(jobId) {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/create-embedding`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating job embedding:', error);
      throw error;
    }
  }

  /**
   * Get matching candidates for a job
   * For topK > 100, uses vector-only mode (no AI explanations upfront)
   */
  async getMatchingCandidates(jobId, topK = 10) {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/matching-candidates?topK=${topK}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting matching candidates:', error);
      throw error;
    }
  }

  /**
   * Get on-demand AI explanation for a single candidate match
   */
  async getCandidateExplanation(jobId, candidateId) {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/candidate/${candidateId}/explanation`, {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          message: `HTTP error! status: ${response.status}`,
        }));
        throw error;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting candidate explanation:', error);
      throw error;
    }
  }
}

export default new JobEmbeddingService(); 