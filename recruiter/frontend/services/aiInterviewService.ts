import { apiRequest, getCurrentWsBaseUrl } from './apiConfig';

export interface AIInterviewQuestionSnapshot {
  questionId: string;
  question: string;
  type?: string;
  category?: string;
  difficulty?: string;
  interviewStage?: string;
  order?: number;
  timeLimit?: number;
}

export interface AIInterviewSession {
  _id: string;
  aiInterview: string;
  candidate?: any;
  candidateSnapshot: {
    firstName?: string;
    lastName?: string;
    name: string;
    email: string;
  };
  status: string;
  currentQuestionIndex: number;
  startedAt?: string;
  completedAt?: string;
  questionDeadlineAt?: string;
  totalDeadlineAt?: string;
  messages: Array<{
    _id?: string;
    role: 'ai' | 'candidate' | 'system';
    content: string;
    questionIndex?: number | null;
    messageType: string;
    createdAt: string;
  }>;
  answers: Array<{
    questionIndex: number;
    question?: string;
    answer?: string;
    status: string;
    submittedAt?: string;
    timeSpentSeconds?: number;
  }>;
  scoring?: {
    status: string;
    overallScore?: number;
    recommendation?: string;
    summary?: string;
    strengths?: string[];
    concerns?: string[];
    questionScores?: Array<{
      questionIndex: number;
      score: number;
      rationale: string;
    }>;
    error?: string;
    scoredAt?: string;
  };
  email?: {
    sentAt?: string;
    lastError?: string;
    attempts?: number;
  };
  credits?: {
    charged?: boolean;
    cost?: number;
    chargedAt?: string;
    error?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface AIInterviewScoringSummary {
  scoredCount: number;
  averageScore?: number | null;
  topScore?: number | null;
  topCandidate?: {
    sessionId: string;
    candidateName: string;
    candidateEmail?: string;
    score: number;
    recommendation: string;
    rank: number;
    completedAt?: string;
    answeredCount?: number;
    concernCount?: number;
    strengthCount?: number;
  } | null;
  recommendationCounts?: Record<string, number>;
  rankings?: Array<{
    sessionId: string;
    candidateName: string;
    candidateEmail?: string;
    score: number;
    recommendation: string;
    rank: number;
    completedAt?: string;
    answeredCount?: number;
    concernCount?: number;
    strengthCount?: number;
  }>;
}

export interface AIInterview {
  _id: string;
  title: string;
  guidelines?: string;
  job: any;
  status: string;
  questionSnapshots: AIInterviewQuestionSnapshot[];
  timers: {
    perQuestionMinutes: number;
    totalMinutes: number;
  };
  schedule: {
    sendAt: string;
    expiresAt: string;
    timezone?: string;
  };
  candidateCount: number;
  creditCostPerCandidate: number;
  stats?: {
    sent: number;
    opened: number;
    inProgress: number;
    completed: number;
    blocked: number;
    failed: number;
  };
  scoringSummary?: AIInterviewScoringSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIInterviewInput {
  title?: string;
  jobId: string;
  candidateIds: string[];
  questionIds: string[];
  guidelines: string;
  sendAt: string;
  expiresAt: string;
  perQuestionMinutes: number;
  totalMinutes: number;
  timezone?: string;
}

export interface PublicAIInterviewState {
  success: boolean;
  session: AIInterviewSession;
  interview: {
    id: string;
    title: string;
    guidelines?: string;
    questionCount: number;
    timers: {
      perQuestionMinutes: number;
      totalMinutes: number;
    };
    schedule: {
      sendAt: string;
      expiresAt: string;
    };
    currentQuestion?: {
      questionIndex: number;
      type?: string;
      difficulty?: string;
      timeLimit: number;
    } | null;
  };
  candidate: {
    firstName?: string;
    lastName?: string;
    name: string;
    email: string;
  };
  voice?: {
    enabled: boolean;
    provider?: string;
    model?: string;
    language?: string;
    sampleRate?: number;
    voice?: string;
  };
  job?: {
    id: string;
    title: string;
  };
}

async function parseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => ({}));
  const error: any = new Error(data.message || data.error || `Request failed with status ${response.status}`);
  error.data = data;
  error.status = response.status;
  return error;
}

class AIInterviewService {
  async list(params?: { status?: string; jobId?: string }): Promise<AIInterview[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.jobId) query.set('jobId', params.jobId);
    const response = await apiRequest(`/api/ai-interviews${query.toString() ? `?${query.toString()}` : ''}`);
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.aiInterviews || [];
  }

  async create(input: CreateAIInterviewInput): Promise<{ aiInterview: AIInterview; sessions: AIInterviewSession[]; creditPreview?: any }> {
    const response = await apiRequest('/api/ai-interviews', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async get(id: string): Promise<{ aiInterview: AIInterview; sessions: AIInterviewSession[] }> {
    const response = await apiRequest(`/api/ai-interviews/${id}`);
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async getSession(id: string, sessionId: string): Promise<AIInterviewSession> {
    const response = await apiRequest(`/api/ai-interviews/${id}/sessions/${sessionId}`);
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.session;
  }

  async cancel(id: string, reason?: string): Promise<void> {
    const response = await apiRequest(`/api/ai-interviews/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    if (!response.ok) throw await parseError(response);
  }

  async resend(id: string, sessionIds?: string[]): Promise<void> {
    const response = await apiRequest(`/api/ai-interviews/${id}/resend`, {
      method: 'POST',
      body: JSON.stringify({ sessionIds })
    });
    if (!response.ok) throw await parseError(response);
  }

  async bootstrapPublic(token: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}`);
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async getPublicVoiceStatus(token: string): Promise<{ success: boolean; voice: PublicAIInterviewState['voice']; canStart: boolean }> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/voice`);
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async getPublicSpeechToken(token: string): Promise<{
    token: string;
    region: string;
    language: string;
    expiresInSeconds?: number;
  }> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/speech-token`, { method: 'POST' });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.speech;
  }

  async startPublic(token: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/start`, { method: 'POST' });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async sendPublicMessage(token: string, message: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/message`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async recordPublicVoiceTranscript(
    token: string,
    input: {
      role: 'candidate' | 'ai';
      message: string;
      messageType?: 'greeting' | 'question' | 'clarification' | 'acknowledgement' | 'transition' | 'system';
    }
  ): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/voice-transcript`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async synthesizePublicSpeech(token: string, input: { messageId?: string; text?: string }): Promise<Blob> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/speech`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  }

  getVoiceWebSocketUrl(token: string): string {
    const base = getCurrentWsBaseUrl().replace(/\/$/, '');
    return `${base}/ws/ai-interview-voice?token=${encodeURIComponent(token)}`;
  }

  async confirmPublicQuestion(token: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/confirm`, { method: 'POST' });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async timeoutPublicQuestion(token: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/timeout`, { method: 'POST' });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async resetPublicSession(token: string): Promise<PublicAIInterviewState> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/reset`, { method: 'POST' });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }
}

const aiInterviewService = new AIInterviewService();
export default aiInterviewService;
