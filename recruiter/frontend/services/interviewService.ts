import { apiRequest } from './apiConfig';
import { grantService, isGrantError, handleGrantError } from './grantService';

export interface InterviewQuestion {
  _id: string;
  jobId: string;
  question: string;
  type: 'technical' | 'behavioral' | 'situational' | 'cultural_fit' | 'general' | 'skills_based' | 'experience_based';
  category?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  interviewStage: 'screening' | 'first_round' | 'technical' | 'final' | 'hr' | 'panel';
  expectedAnswer?: string;
  scoringCriteria?: Array<{
    criterion: string;
    weight: number;
    description?: string;
  }>;
  tags?: string[];
  isActive: boolean;
  order: number;
  timeLimit?: number;
  followUpQuestions?: Array<{
    question: string;
    condition?: string;
  }>;
  isAIGenerated: boolean;
  aiGenerationMetadata?: {
    generatedAt: string;
    model: string;
    prompt?: string;
    promptVersion?: string;
    requestId?: string;
    routeVersion?: number;
    confidence: number;
    questionType?: string;
  };
  qualityMetrics?: {
    semanticQualityScore?: number | null;
    qualityIssues?: string[];
    analysisStatus?: 'pending' | 'complete' | 'manual_review';
    difficultyCalibration: number;
    diversityIndex: number;
    biasScore: number | null;
    legalCompliance: boolean | null;
    biasAnalysis?: {
      age: number;
      gender: number;
      nationality: number;
      familyStatus: number;
      religious: number;
    };
    // Enhanced AI bias analysis with detailed factors
    detectedBiasFactors?: Array<{
      type: string;
      score: number;
      keywordsFound: string[];
      explanation: string;
    }>;
    overallBiasScore?: number;
    isBiased?: boolean;
    aiNeutralityConfidence?: number;
    aiRecommendation?: string;
    lastAnalyzed?: string;
  };
  feedback?: {
    candidateFeedback?: Array<{
      rating: number;
      comments?: string;
      submittedAt: string;
    }>;
    interviewerFeedback?: Array<{
      effectiveness: number;
      clarity: number;
      relevance: number;
      comments?: string;
      submittedAt: string;
    }>;
  };
  usage?: {
    timesUsed: number;
    averageScore?: number;
    lastUsed?: string;
    responsePatterns?: {
      averageResponseTime: number;
      commonKeywords: string[];
      successRate: number;
    };
  };
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewQuestionCreateData {
  question: string;
  type: InterviewQuestion['type'];
  category?: string;
  difficulty: InterviewQuestion['difficulty'];
  interviewStage: InterviewQuestion['interviewStage'];
  expectedAnswer?: string;
  scoringCriteria?: Array<{
    criterion: string;
    weight: number;
    description?: string;
  }>;
  tags?: string[];
  timeLimit?: number;
  followUpQuestions?: Array<{
    question: string;
    condition?: string;
  }>;
  order?: number;
}

export interface GenerateQuestionsOptions {
  stage?: InterviewQuestion['interviewStage'];
  questionCount?: number;
  difficulty?: InterviewQuestion['difficulty'];
  includeTypes?: InterviewQuestion['type'][];
  focusAreas?: string[];
  ensureDiversity?: boolean;
  maxBiasScore?: number;
}

export interface OptimizedGenerationOptions {
  totalQuestions?: number;
  stages?: InterviewQuestion['interviewStage'][];
  ensureDiversity?: boolean;
  maxBiasScore?: number;
}

export interface BiasDetectionFactor {
  type: string;
  score: number;
  keywordsFound: string[];
  explanation: string;
}

export interface QuestionQualityAnalysis {
  semanticQualityScore?: number | null;
  qualityIssues?: string[];
  analysisStatus?: 'pending' | 'complete' | 'manual_review';
  biasScore: number | null;
  diversityIndex: number;
  difficultyCalibration?: number;
  legalCompliance: boolean | null;
  recommendations: string[];
  biasAnalysis?: {
    age?: number;
    gender?: number;
    nationality?: number;
    familyStatus?: number;
    religious?: number;
    [key: string]: number | undefined;
  };
  // Enhanced bias analysis from backend
  detectedBiasFactors?: BiasDetectionFactor[];
  neutralityConfidence?: number;
  recommendation?: string;
  overallBiasScore?: number;
  isBiased?: boolean;
}

export interface OptimizedQuestionSetResponse {
  msg: string;
  questions: InterviewQuestion[];
  optimization: {
    totalGenerated: number;
    totalSaved: number;
    diversityScore: number;
    averageQuality: number;
  };
}

export interface InterviewQuestionsResponse {
  msg: string;
  questions: InterviewQuestion[];
  count: number;
}

export interface InterviewQuestionResponse {
  msg: string;
  question: InterviewQuestion;
}

export interface GenerateQuestionsResponse {
  msg: string;
  questions: InterviewQuestion[];
  count: number;
  generationOptions: GenerateQuestionsOptions;
}

export interface InterviewQuestionsStats {
  totalQuestions: number;
  typeDistribution: Array<{ _id: string; count: number }>;
  stageDistribution: Array<{ _id: string; count: number }>;
}

export interface InterviewQuestionsStatsResponse {
  msg: string;
  stats: InterviewQuestionsStats;
}

export interface InterviewData {
  jobId: string;
  candidateId: string;
  interviewerId: string;
  title: string;
  description?: string;
  scheduledAt: string;
  duration: number;
  location?: string;
  timezone: string;
  type: 'phone' | 'video' | 'in_person' | 'technical' | 'behavioral' | 'panel';
  conferencing?: {
    provider: 'google_meet' | 'zoom' | 'teams' | 'webex';
  };
  participants: Participant[];
  sendQuestionsToInterviewers?: boolean;
  questionsSendTime?: number; // minutes before interview
  selectedQuestionIds?: string[]; // IDs of questions to send to interviewers
}

export interface Participant {
  email: string;
  name: string;
  role: 'interviewer' | 'candidate' | 'observer';
  status: 'pending' | 'accepted' | 'declined';
}

export interface Interview {
  _id: string;
  jobId: any;
  candidateId: any;
  interviewerId: any;
  nylasEventId?: string;
  title: string;
  description?: string;
  scheduledAt: string;
  duration: number;
  location?: string;
  timezone: string;
  type: string;
  status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'rescheduled';
  participants: Participant[];
  conferencing?: {
    provider: string;
    details: {
      url?: string;
      meetingCode?: string;
    };
  };
  notetakerEnabled?: boolean;
  notetakerId?: string;
  notetakerStatus?: 'pending' | 'scheduled' | 'enabled' | 'joining' | 'joined' | 'recording' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'stopped' | 'deleted' | null;
  transcript?: {
    content: string | null;
    summary: string | null;
    keyPoints: string[];
    actionItems: string[];
    participants: Array<{
      name: string;
      email: string;
      speakingTime: number;
    }>;
    duration: number | null;
    language: string;
    confidence: number | null;
  };
  transcriptAvailableAt?: string;
  recordingUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NylasV3Grant {
  id: string;
  email: string;
  provider: string;
  scope: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  status: 'free' | 'busy';
}

export interface InterviewFilters {
  status?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  interviewerId?: string;
  candidateId?: string;
}

class InterviewService {
  /**
   * Get authentication headers
   */
  private getAuthHeaders() {
    const token = localStorage.getItem('jwt'); // Use 'jwt' to match AuthContext
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  }

  /**
   * Create a new interview question
   */
  async createQuestion(jobId: string, questionData: InterviewQuestionCreateData): Promise<InterviewQuestion> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(questionData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionResponse = await response.json();
      return data.question;
    } catch (error) {
      console.error('Error creating interview question:', error);
      throw error;
    }
  }

  /**
   * Get all interview questions for a job
   */
  async getQuestionsByJob(jobId: string, filters?: {
    type?: string;
    stage?: string;
    difficulty?: string;
  }): Promise<InterviewQuestion[]> {
    try {
      const queryParams = new URLSearchParams();
      if (filters?.type) queryParams.append('type', filters.type);
      if (filters?.stage) queryParams.append('stage', filters.stage);
      if (filters?.difficulty) queryParams.append('difficulty', filters.difficulty);

      const url = `/api/jobs/${jobId}/interview-questions${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      
      const response = await apiRequest(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionsResponse = await response.json();
      return data.questions;
    } catch (error) {
      console.error('Error fetching interview questions:', error);
      throw error;
    }
  }

  /**
   * Get a single interview question by ID
   */
  async getQuestionById(questionId: string): Promise<InterviewQuestion> {
    try {
      const response = await apiRequest(`/api/jobs/interview-questions/${questionId}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionResponse = await response.json();
      return data.question;
    } catch (error) {
      console.error('Error fetching interview question:', error);
      throw error;
    }
  }

  /**
   * Update an interview question
   */
  async updateQuestion(questionId: string, updateData: Partial<InterviewQuestionCreateData>): Promise<InterviewQuestion> {
    try {
      const response = await apiRequest(`/api/jobs/interview-questions/${questionId}`, {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionResponse = await response.json();
      return data.question;
    } catch (error) {
      console.error('Error updating interview question:', error);
      throw error;
    }
  }

  /**
   * Delete an interview question
   */
  async deleteQuestion(questionId: string): Promise<void> {
    try {
      const response = await apiRequest(`/api/jobs/interview-questions/${questionId}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }
    } catch (error) {
      console.error('Error deleting interview question:', error);
      throw error;
    }
  }

  /**
   * Generate AI interview questions for a job
   */
  async generateQuestions(jobId: string, options: GenerateQuestionsOptions = {}): Promise<InterviewQuestion[]> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions/generate`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          stage: options.stage || 'first_round',
          questionCount: options.questionCount || 10,
          difficulty: options.difficulty || 'medium',
          includeTypes: options.includeTypes || ['technical', 'behavioral', 'situational'],
          focusAreas: options.focusAreas || [],
          ensureDiversity: options.ensureDiversity !== false,
          maxBiasScore: options.maxBiasScore !== undefined ? options.maxBiasScore : 0.3,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: GenerateQuestionsResponse = await response.json();
      return data.questions;
    } catch (error) {
      console.error('Error generating interview questions:', error);
      throw error;
    }
  }

  /**
   * Bulk create interview questions
   */
  async bulkCreateQuestions(jobId: string, questions: InterviewQuestionCreateData[]): Promise<InterviewQuestion[]> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions/bulk`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ questions }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionsResponse = await response.json();
      return data.questions;
    } catch (error) {
      console.error('Error bulk creating interview questions:', error);
      throw error;
    }
  }

  /**
   * Get interview questions statistics
   */
  async getQuestionsStats(jobId: string): Promise<InterviewQuestionsStats> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions/stats`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: InterviewQuestionsStatsResponse = await response.json();
      return data.stats;
    } catch (error) {
      console.error('Error fetching interview questions statistics:', error);
      throw error;
    }
  }

  /**
   * Generate optimized interview question set
   */
  async generateOptimizedQuestionSet(jobId: string, options: OptimizedGenerationOptions = {}): Promise<OptimizedQuestionSetResponse> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions/generate-optimized`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          totalQuestions: options.totalQuestions || 15,
          stages: options.stages || ['screening', 'first_round', 'technical'],
          ensureDiversity: options.ensureDiversity !== false,
          maxBiasScore: options.maxBiasScore !== undefined ? options.maxBiasScore : 0.3,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data: OptimizedQuestionSetResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error generating optimized question set:', error);
      throw error;
    }
  }

  /**
   * Analyze question quality
   */
  async analyzeQuestionQuality(questionId: string): Promise<QuestionQualityAnalysis> {
    try {
      const response = await apiRequest(`/api/jobs/interview-questions/${questionId}/analyze-quality`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data = await response.json();
      return data.analysis;
    } catch (error) {
      console.error('Error analyzing question quality:', error);
      throw error;
    }
  }

  /**
   * Get performance insights for questions
   */
  async getPerformanceInsights(jobId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions/performance-insights`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data = await response.json();
      return data.insights;
    } catch (error) {
      console.error('Error fetching performance insights:', error);
      throw error;
    }
  }

  /**
   * Submit question feedback
   */
  async submitQuestionFeedback(questionId: string, feedback: {
    type: 'candidate' | 'interviewer';
    rating: number;
    comments?: string;
    effectiveness?: number;
    clarity?: number;
    relevance?: number;
  }): Promise<void> {
    try {
      const response = await apiRequest(`/api/jobs/interview-questions/${questionId}/feedback`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(feedback),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }
    } catch (error) {
      console.error('Error submitting question feedback:', error);
      throw error;
    }
  }

  async scheduleInterview(data: Partial<InterviewData>): Promise<Interview> {
    try {
      const response = await apiRequest(`/api/interviews/schedule`, {
        method: 'POST',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const apiError: any = new Error(errorData.message || errorData.error || 'Failed to schedule interview');
        apiError.data = errorData;
        throw apiError;
      }

      const result = await response.json();
      return result.interview;
    } catch (error: any) {
      console.error('Schedule interview error:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  async scheduleFromPipeline(data: {
    candidateId: string;
    jobId?: string;
    stageId?: string;
    startTime: string;
    endTime: string;
    duration?: number;
    notes?: string;
    addNotetaker?: boolean;
    skipAvailabilityCheck?: boolean;
    forceSchedule?: boolean;
    provider?: string;
    autocreate?: boolean;
    additionalParticipants?: Array<{
      email: string;
      name: string;
      role: string;
    }>;
  }): Promise<Interview> {
    try {
      const response = await apiRequest(`/api/interviews/from-pipeline`, {
        method: 'POST',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const apiError: any = new Error(errorData.message || errorData.error || 'Failed to schedule interview from pipeline');
        apiError.data = errorData;
        throw apiError;
      }

      const result = await response.json();
      return result.interview;
    } catch (error: any) {
      console.error('Schedule from pipeline error:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  async getInterviews(filters?: InterviewFilters): Promise<Interview[]> {
    try {
      const queryParams = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value) queryParams.append(key, value.toString());
        });
      }

      const response = await apiRequest(
        `/api/interviews?${queryParams.toString()}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get interviews');
      }

      const result = await response.json();
      return result.interviews || [];
    } catch (error: any) {
      console.error('Get interviews error:', error);
      throw error;
    }
  }

  async getJobInterviews(jobId: string): Promise<Interview[]> {
    try {
      const response = await apiRequest(
        `/api/interviews/job/${jobId}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get job interviews');
      }

      const result = await response.json();
      return result.interviews || [];
    } catch (error: any) {
      console.error('Get job interviews error:', error);
      throw error;
    }
  }

  async getCandidateInterviews(candidateId: string): Promise<Interview[]> {
    try {
      const response = await apiRequest(
        `/api/interviews/candidate/${candidateId}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get candidate interviews');
      }

      const result = await response.json();
      return result.interviews || [];
    } catch (error: any) {
      console.error('Get candidate interviews error:', error);
      throw error;
    }
  }

  // Nylas v3 specific methods
  async getAvailability(
    userId: string, 
    startDate: string, 
    endDate: string,
    duration: number = 60
  ): Promise<AvailabilitySlot[]> {
    try {
      const response = await apiRequest(
        `/api/interviews/availability/${userId}?startDate=${startDate}&endDate=${endDate}&duration=${duration}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get availability');
      }

      const result = await response.json();
      return result.availability || [];
    } catch (error: any) {
      console.error('Get availability error:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  async connectCalendar(provider: string = 'google', forceAccountSelection: boolean = false): Promise<{ authUrl: string }> {
    try {
      console.log('🔗 Connecting calendar with provider:', provider, 'forceAccountSelection:', forceAccountSelection);
      const response = await apiRequest(`/api/interviews/connect-calendar`, {
        method: 'POST',
        body: JSON.stringify({ provider, forceAccountSelection }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const apiError: any = new Error(errorData.message || errorData.error || 'Failed to connect calendar');
        apiError.data = errorData;
        throw apiError;
      }

      return await response.json();
    } catch (error: any) {
      console.error('Connect calendar error:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  async getCalendarStatus(userId: string): Promise<{ 
    connected: boolean; 
    provider?: string;
    status?: string;
    verified?: boolean;
    error?: string;
  }> {
    try {
      console.log('📅 Getting calendar status for user:', userId);
      const response = await apiRequest(
        `/api/interviews/calendar-status/${userId}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get calendar status');
      }

      const result = await response.json();
      console.log('📅 Calendar status result:', result);
      return result;
    } catch (error: any) {
      console.error('Get calendar status error:', error);
      throw error;
    }
  }

  async disconnectCalendar(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🔗 Disconnecting calendar...');
      const response = await apiRequest(
        `/api/grant/revoke`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to disconnect calendar');
      }

      const result = await response.json();
      console.log('✅ Calendar disconnected:', result);
      return result;
    } catch (error: any) {
      console.error('Disconnect calendar error:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  async updateInterviewStatus(
    interviewId: string, 
    status: string, 
    notes?: string, 
    feedback?: any
  ): Promise<Interview> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes, feedback }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data = await response.json();
      return data.interview;
    } catch (error) {
      console.error('Update interview status error:', error);
      throw this.handleInterviewError(error);
    }
  }

  /**
   * Cancel an interview
   */
  async cancelInterview(
    interviewId: string, 
    reason: string,
    notifyParticipants: boolean = true
  ): Promise<Interview> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason, notifyParticipants }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data = await response.json();
      return data.interview;
    } catch (error) {
      console.error('Cancel interview error:', error);
      throw this.handleInterviewError(error);
    }
  }

  /**
   * Get interview details
   */
  async getInterviewDetails(interviewId: string): Promise<Interview> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}`, {
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

      const data = await response.json();
      return data.interview;
    } catch (error) {
      console.error('Get interview details error:', error);
      throw this.handleInterviewError(error);
    }
  }

  /**
   * Get transcript for an interview
   */
  async getTranscript(interviewId: string): Promise<{
    transcript: any;
    notetakerStatus: string;
    transcriptAvailableAt: string;
    recordingUrl?: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/transcript/${interviewId}`, {
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

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Get transcript error:', error);
      throw error;
    }
  }

  /**
   * Manually enable notetaker for an interview
   */
  async enableNotetaker(interviewId: string, meetingLink: string): Promise<{
    success: boolean;
    message: string;
    notetakerId?: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/enable/${interviewId}`, {
        method: 'POST',
        body: JSON.stringify({ meetingLink }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
          status: response.status
        }));
        throw error;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Enable notetaker error:', error);
      throw error;
    }
  }

  /**
   * Cancel notetaker for an interview
   */
  async cancelNotetaker(interviewId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/cancel/${interviewId}`, {
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

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Cancel notetaker error:', error);
      throw error;
    }
  }

  /**
   * Trigger notetaker to join meeting immediately
   */
  async joinMeetingNow(interviewId: string, meetingLink?: string): Promise<{
    success: boolean;
    notetakerId?: string;
    status?: string;
    alreadyActive?: boolean;
    reusedExisting?: boolean;
    replacementCreated?: boolean;
    joinInProgress?: boolean;
    message: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/join-now/${interviewId}`, {
        method: 'POST',
        body: JSON.stringify({ meetingLink }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to trigger notetaker');
      }

      return await response.json();
    } catch (error) {
      console.error('Join meeting now error:', error);
      throw error;
    }
  }

  /**
   * Sync notetaker status for interviews with notetakerEnabled but missing notetakerId
   */
  async syncNotetakerStatus(interviewId: string): Promise<{
    success: boolean;
    notetakerId?: string;
    status?: string;
    message: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/sync/${interviewId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Handle the "does not need syncing" case as a success
        if (errorData.error && errorData.error.includes('Interview does not need syncing')) {
          return {
            success: true,
            message: 'Interview already synced or sync not needed',
            notetakerId: undefined,
            status: 'already_synced'
          };
        }
        
        throw new Error(errorData.error || 'Failed to sync notetaker');
      }

      return await response.json();
    } catch (error) {
      console.error('Sync notetaker error:', error);
      throw error;
    }
  }

  /**
   * Manually sync transcript for an interview (handles both single and multi-candidate)
   */
  async manualTranscriptSync(interviewId: string): Promise<{
    success: boolean;
    message: string;
    transcript?: any;
    isMultiCandidate?: boolean;
    error?: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/manual-sync/${interviewId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to sync transcript');
      }

      return await response.json();
    } catch (error) {
      console.error('Manual transcript sync error:', error);
      throw error;
    }
  }

  /**
   * Force complete an interview (manual override)
   */
  async forceInterviewCompletion(interviewId: string): Promise<{
    success: boolean;
    message: string;
    status: string;
    transcriptAvailable?: boolean;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/force-complete/${interviewId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to force complete interview');
      }

      return await response.json();
    } catch (error) {
      console.error('Force interview completion error:', error);
      throw error;
    }
  }

  /**
   * Get real-time transcript for an interview
   */
  async getRealtimeTranscript(interviewId: string): Promise<{
    success: boolean;
    message?: string;
    interview?: {
      id: string;
      title: string;
      scheduledAt: string;
      duration: number;
      candidate: any;
      job: any;
    };
    notetaker?: {
      id: string;
      status: string;
      meetingState: string;
      enabled: boolean;
    };
    transcript?: {
      content: string;
      size: number;
      lastUpdated: string;
    };
    isTranscriptReady: boolean;
    shouldPoll: boolean;
    pollInterval?: number;
    estimatedTranscriptTime?: string;
    fromCache?: boolean;
    lastChecked: string;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/realtime/${interviewId}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        // Return a structured error response instead of throwing
        if (response.status === 400 || response.status === 404) {
          return {
            success: false,
            message: error.message || error.error || 'An error occurred',
            isTranscriptReady: false,
            shouldPoll: false,
            lastChecked: new Date().toISOString()
          };
        }
        throw error;
      }

      const data = await response.json();
      return {
        ...data,
        success: true
      };
    } catch (error) {
      console.error('Error getting real-time transcript:', error);
      // Don't call handleInterviewError for expected errors
      if (error instanceof Error && !error.message.includes('No notetaker')) {
        this.handleInterviewError(error);
      }
      throw error;
    }
  }
  
  /**
   * Check notetaker status for an interview (without requiring transcript)
   */
  async checkNotetakerStatus(interviewId: string): Promise<{
    success: boolean;
    notetakerId?: string;
    status?: string;
    originalStatus?: string;
    meetingState?: string;
    enabled?: boolean;
    lastUpdated?: string;
    rawResponse?: any;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/status/${interviewId}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 400 || response.status === 404) {
          return {
            success: false,
            status: error.status || 'unknown',
            lastUpdated: new Date().toISOString()
          };
        }
        throw error;
      }

      const data = await response.json();
      return {
        ...data,
        success: true
      };
    } catch (error) {
      console.error('Error checking notetaker status:', error);
      throw error;
    }
  }

  // Generate AI Interview Summary
  async generateAISummary(interviewId: string) {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/ai-summary`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate AI summary');
      }

      return await response.json();
    } catch (error) {
      console.error('Error generating AI summary:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }
  
  /**
   * Send interview questions to interviewers manually
   */
  async sendInterviewQuestionsManually(interviewId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/questions/send`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send interview questions');
      }

      return await response.json();
    } catch (error) {
      console.error('Error sending interview questions:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  /**
   * Get selected interview questions for an interview
   */
  async getSelectedInterviewQuestions(interviewId: string): Promise<{
    success: boolean;
    questionsEnabled: boolean;
    questionsSendTime: number;
    questionsSentAt: string | null;
    questions: InterviewQuestion[];
    count: number;
  }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/questions`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get selected interview questions');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting selected interview questions:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  /**
   * Get segmented transcript for a multi-candidate interview
   */
  async getSegmentedTranscript(interviewId: string, includeOverflow: boolean = true): Promise<{
    success: boolean;
    data: {
      interviewId: string;
      candidateName: string;
      candidateEmail: string;
      isMultiCandidate: boolean;
      sessionId: string;
      scheduledTime: {
        start: string;
        end: string;
      };
      actualTime: {
        start: string;
        end: string;
        duration: number;
      };
      transcript: {
        content: string;
        hasOverflow: boolean;
        speakerStats: any;
      };
      overflow?: {
        segments: any[];
        duration: number;
      };
    };
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/transcript/segmented/${interviewId}?includeOverflow=${includeOverflow}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get segmented transcript');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting segmented transcript:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  /**
   * Get full session transcript with all candidate segments
   */
  async getSessionTranscript(sessionId: string): Promise<{
    success: boolean;
    sessionId: string;
    interviews: Array<{
      id: string;
      candidateId: string;
      candidateName: string;
      candidateEmail: string;
      order: number;
      scheduledAt: string;
      duration: number;
    }>;
    segments: any;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/transcript/session/${sessionId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get session transcript');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting session transcript:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  /**
   * Analyze multi-candidate interview session
   */
  async analyzeMultiCandidateSession(sessionId: string): Promise<{
    success: boolean;
    sessionId: string;
    analysis: any;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/analysis/multi-candidate/${sessionId}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze multi-candidate session');
      }

      return await response.json();
    } catch (error) {
      console.error('Error analyzing multi-candidate session:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  /**
   * Get existing multi-candidate analysis
   */
  async getMultiCandidateAnalysis(sessionId: string): Promise<{
    success: boolean;
    sessionId: string;
    interviews: Array<{
      interviewId: string;
      candidateId: string;
      candidateName: string;
      candidateEmail: string;
      order: number;
      hasAnalysis: boolean;
      analysis: any;
    }>;
    hasComparativeAnalysis: boolean;
  }> {
    try {
      const response = await apiRequest(`/api/notetaker/analysis/multi-candidate/${sessionId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get multi-candidate analysis');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting multi-candidate analysis:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Get Interview Comments
  async getInterviewComments(interviewId: string, options?: {
    includeReplies?: boolean;
    visibility?: string;
  }) {
    try {
      const params = new URLSearchParams();
      if (options?.includeReplies !== undefined) {
        params.append('includeReplies', options.includeReplies.toString());
      }
      if (options?.visibility) {
        params.append('visibility', options.visibility);
      }

      const url = `/api/interviews/${interviewId}/comments${params.toString() ? '?' + params.toString() : ''}`;
      const response = await apiRequest(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch comments');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting interview comments:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Add Interview Comment
  async addInterviewComment(interviewId: string, commentData: {
    content: string;
    commentType?: string;
    rating?: {
      overall?: number;
      technical?: number;
      communication?: number;
      cultural?: number;
    };
    categories?: string[];
    visibility?: string;
    parentCommentId?: string;
  }) {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(commentData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Error adding interview comment:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Update Interview Comment
  async updateInterviewComment(interviewId: string, commentId: string, updateData: {
    content?: string;
    commentType?: string;
    rating?: {
      overall?: number;
      technical?: number;
      communication?: number;
      cultural?: number;
    };
    categories?: string[];
    visibility?: string;
  }) {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/comments/${commentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Error updating interview comment:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Delete Interview Comment
  async deleteInterviewComment(interviewId: string, commentId: string) {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/comments/${commentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Error deleting interview comment:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Analyze Team Comments with AI
  async analyzeTeamComments(interviewId: string) {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/analyze-comments`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze team comments');
      }

      return await response.json();
    } catch (error) {
      console.error('Error analyzing team comments:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Schedule Multi-Candidate Interview Session
  async scheduleMultiCandidateInterview(data: {
    sessionType: string;
    baseStartTime: string;
    sessionEndTime: string;
    totalDuration: number;
    interviewType: 'video' | 'phone' | 'in_person';
    location?: string;
    provider: string;
    addNotetaker: boolean;
    additionalInterviewers: any[];
    candidateSlots: Array<{
      candidateName: string;
      candidateEmail: string;
      candidateId?: string;
      jobId?: string;
      jobTitle: string;
      startTime: string;
      endTime: string;
      duration: number;
      notes?: string;
      order: number;
    }>;
    skipAvailabilityCheck?: boolean;
  }) {
    try {
      const response = await apiRequest(`/api/interviews/schedule-multi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const apiError: any = new Error(errorData.message || errorData.error || 'Failed to schedule multi-candidate interview');
        apiError.data = errorData;
        throw apiError;
      }

      return await response.json();
    } catch (error) {
      console.error('Error scheduling multi-candidate interview:', error);
      this.handleInterviewError(error);
      throw error;
    }
  }

  // Enhanced error handling for Nylas-specific errors
  private handleInterviewError(error: any) {
    const errorData = error.response?.data;
    const errorMessage = errorData?.message || error.message || '';
    
    // Check for grant-related errors
    if (isGrantError(errorMessage)) {
      console.warn('Grant error detected:', errorMessage);
      handleGrantError(errorMessage);
      return error;
    }
    
    switch (errorData?.error) {
      case 'SCHEDULING_CONFLICT':
        // Don't show toast here, let the calling component handle it
        console.warn('Scheduling conflict detected:', errorData.conflicts);
        break;
        
      case 'AUTHENTICATION_FAILED':
      case 'CALENDAR_NOT_CONNECTED':
        console.warn('Calendar authentication required:', errorData.message);
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        const retryAfter = errorData.retryAfter || 60;
        console.warn(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
        break;
        
      case 'GRANT_INVALID':
      case 'GRANT_EXPIRED':
        console.warn('Calendar connection is invalid:', errorData.message);
        handleGrantError(errorData.message);
        break;
        
      default:
        console.error('Interview service error:', errorMessage);
    }
    
    return error;
  }

  // Question-Based Feedback Methods
  
  /**
   * Get questions for interview feedback
   */
  async getInterviewQuestionsForFeedback(interviewId: string, accessToken?: string): Promise<{
    success: boolean; 
    questions: InterviewQuestion[];
    candidateInfo?: any;
    jobInfo?: any;
    stageInfo?: any;
    interviewInfo?: any;
  }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/questions`, {
        skipAuth: Boolean(accessToken),
        method: 'GET',
        headers: accessToken ? { 'X-Public-Feedback-Token': accessToken } : {},
      }) as any;
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching interview questions for feedback:', error);
      throw error;
    }
  }

  /**
   * Get aggregated feedback summary (totals and per-assessor)
   */
  async getFeedbackSummary(interviewId: string): Promise<{ success: boolean; totals: any; perAssessor: any }>{
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/summary`) as any;
      return response;
    } catch (error) {
      console.error('Error fetching feedback summary:', error);
      throw error;
    }
  }

  /**
   * Add question-based feedback (internal)
   */
  async addQuestionFeedback(
    interviewId: string, 
    data: {
      questionId?: string;
      content: string;
      rating?: number;
      technicalRating?: number;
      communicationRating?: number;
      culturalRating?: number;
      isGeneral?: boolean;
    }
  ): Promise<{ success: boolean; comment: any }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/question`, {
        method: 'POST',
        body: JSON.stringify(data)
      }) as any;
      return response;
    } catch (error) {
      console.error('Error adding question feedback:', error);
      throw error;
    }
  }

  /**
   * Add public feedback (no authentication required)
   */
  async addPublicFeedback(
    interviewId: string,
    data: {
      name: string;
      email: string;
      questionId?: string;
      content: string;
      rating?: number;
      technicalRating?: number;
      communicationRating?: number;
      culturalRating?: number;
      isGeneral?: boolean;
    },
    accessToken?: string,
  ): Promise<{ success: boolean; comment: any }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/public`, {
        skipAuth: Boolean(accessToken),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'X-Public-Feedback-Token': accessToken } : {}),
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit public feedback');
      }

      return await response.json();
    } catch (error) {
      console.error('Error adding public feedback:', error);
      throw error;
    }
  }

  /**
   * Get all feedback (question-based and general) for an interview
   */
  async getQuestionBasedFeedback(interviewId: string): Promise<{ success: boolean; feedback: any[] }> {
    try {
      // Reuse the existing comments endpoint but it now returns question-based feedback
      const response = await this.getInterviewComments(interviewId);
      return {
        success: true,
        feedback: response.comments || []
      };
    } catch (error) {
      console.error('Error fetching question-based feedback:', error);
      throw error;
    }
  }

  /**
   * Submit bulk public feedback (all feedback in one API call)
   */
  async addBulkPublicFeedback(
    interviewId: string,
    data: {
      name: string;
      email: string;
      generalFeedback?: {
        content: string;
        rating?: number;
        technicalRating?: number;
        communicationRating?: number;
        culturalRating?: number;
      };
      questionFeedback?: {
        [questionId: string]: {
          content: string;
          rating?: number;
        };
      };
    },
    accessToken?: string,
  ): Promise<{ success: boolean; commentsCreated: number }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/bulk`, {
        skipAuth: Boolean(accessToken),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'X-Public-Feedback-Token': accessToken } : {}),
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit feedback');
      }

      return await response.json();
    } catch (error) {
      console.error('Error submitting bulk feedback:', error);
      throw error;
    }
  }

  /**
   * Generate OTP for email verification in public feedback
   */
  async generateFeedbackOTP(interviewId: string, email: string, name: string, accessToken?: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/generate-otp`, {
        skipAuth: Boolean(accessToken),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'X-Public-Feedback-Token': accessToken } : {}),
        },
        body: JSON.stringify({ email, name })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate OTP');
      }
      
      return response.json();
    } catch (error) {
      console.error('Error generating feedback OTP:', error);
      throw error;
    }
  }

  /**
   * Verify OTP for email verification in public feedback
   */
  async verifyFeedbackOTP(interviewId: string, email: string, otp: string, accessToken?: string): Promise<{ success: boolean; message: string; verifiedEmail: string; verifiedName: string }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/verify-otp`, {
        skipAuth: Boolean(accessToken),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'X-Public-Feedback-Token': accessToken } : {}),
        },
        body: JSON.stringify({ email, otp })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to verify OTP');
      }
      
      return response.json();
    } catch (error) {
      console.error('Error verifying feedback OTP:', error);
      throw error;
    }
  }

  /**
   * Delete feedback comment
   */
  async deleteFeedback(interviewId: string, commentId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/${commentId}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete feedback');
      }
      
      return response.json();
    } catch (error) {
      console.error('Error deleting feedback:', error);
      throw error;
    }
  }
}

const interviewService = new InterviewService();
export default interviewService;
export { interviewService };
