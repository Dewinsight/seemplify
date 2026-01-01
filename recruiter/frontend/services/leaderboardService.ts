import { apiRequest } from './apiConfig';

export interface LeaderboardCandidate {
  rank: number;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePosition: string;
  candidateAvatar?: string;
  overallScore: number;
  performanceRating: 'excellent' | 'strong' | 'good' | 'fair' | 'needs_improvement';
  scoreBreakdown: {
    // Old format (backward compatibility)
    technical?: number;
    communication?: number;
    cultural?: number;
    // New comprehensive format
    systemFields?: Record<string, { average: number; weight: number; contribution: number }>;
    customFields?: Record<string, { average: number; weight: number; contribution: number }>;
    questions?: Record<string, { average: number; weight: number; contribution: number }>;
    calculatedFields?: Record<string, { value: number; formula: string }>;
    [key: string]: any;
  };
  recommendation: string;
  feedbackStats: {
    totalResponses: number;
    totalAssessors: number;
    lastFeedbackAt: string | null;
  };
  interviewDetails: {
    interviewId: string;
    scheduledAt: string;
    completedAt: string;
    status: string;
  };
}

export interface StageLeaderboard {
  stageId: string;
  stageName: string;
  stageOrder: number;
  statistics: {
    totalCandidates: number;
    averageScore: number;
    completionRate: number;
    topPerformer: {
      candidateId: string;
      name: string;
      score: number;
    } | null;
    scoreDistribution: {
      excellent: number;
      strong: number;
      good: number;
      fair: number;
      needsImprovement: number;
    };
  };
  leaderboard: LeaderboardCandidate[];
}

export interface LeaderboardData {
  success: boolean;
  jobId: string;
  jobTitle: string;
  stages: StageLeaderboard[];
  overallStatistics: {
    totalCandidatesInterviewed: number;
    averageScoreAllStages: number;
    totalFeedbackResponses: number;
    totalStages: number;
  };
}

export interface FeedbackComment {
  _id: string;
  content: string;
  rating?: {
    overall?: number;
    technical?: number;
    communication?: number;
    cultural?: number;
  };
  commentType: string;
  createdAt: string;
  interviewId: {
    _id: string;
    title: string;
    scheduledAt: string;
    status: string;
    structuredFeedback?: {
      overallScore?: number;
      scores?: any[];
    };
    candidateId: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      position?: string;
      avatar?: string;
    };
    stageId?: {
      _id: string;
      name: string;
      order: number;
      type?: string;
    };
    stageName?: string;
    stageOrder?: number;
  };
  authorId?: {
    _id: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
    email?: string;
  };
  questionId?: {
    _id: string;
    question: string;
    type: string;
  };
}

export interface JobFeedbackData {
  success: boolean;
  jobId: string;
  jobTitle: string;
  totalFeedback: number;
  totalInterviews: number;
  stages: Array<{
    _id: string;
    name: string;
    order: number;
    type?: string;
  }>;
  feedback: FeedbackComment[];
}

class LeaderboardService {
  /**
   * Get ALL feedback for a job
   * Returns raw feedback data that frontend will organize
   */
  async getAllJobFeedback(jobId: string): Promise<JobFeedbackData> {
    try {
      const url = `/api/jobs/${jobId}/all-feedback`;

      const response = await apiRequest(url, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch job feedback');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error fetching job feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback leaderboard for a job (DEPRECATED)
   */
  async getFeedbackLeaderboard(
    jobId: string,
    options: {
      stageId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<LeaderboardData> {
    try {
      const params = new URLSearchParams();
      if (options.stageId && options.stageId !== 'all') {
        params.append('stageId', options.stageId);
      }
      if (options.sortBy) {
        params.append('sortBy', options.sortBy);
      }
      if (options.sortOrder) {
        params.append('sortOrder', options.sortOrder);
      }

      const queryString = params.toString();
      const url = `/api/jobs/${jobId}/feedback-leaderboard${queryString ? `?${queryString}` : ''}`;

      const response = await apiRequest(url, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch feedback leaderboard');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error fetching feedback leaderboard:', error);
      throw error;
    }
  }
}

export default new LeaderboardService();