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
  recipientType?: 'candidate' | 'guest';
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
  billing?: {
    charged?: boolean;
    currency?: string;
    amountCents?: number;
    chargedAt?: string;
    ledgerEntryId?: string;
    error?: string;
  };
  proctoring?: {
    enabled?: boolean;
    maxFocusViolations?: number;
    focusViolationCount?: number;
    pasteAttemptCount?: number;
    terminatedAt?: string;
    terminationReason?: string;
    violations?: Array<{
      _id?: string;
      type: 'paste_attempt' | 'drop_attempt' | 'visibility_hidden' | 'window_blur' | 'pagehide';
      category: 'input' | 'focus';
      questionIndex?: number | null;
      count?: number;
      actionTaken?: 'logged' | 'warned' | 'final_warning' | 'terminated';
      message?: string;
      createdAt?: string;
    }>;
  };
  createdAt?: string;
  updatedAt?: string;
}

export type AIInterviewProctoringEventType =
  | 'paste_attempt'
  | 'drop_attempt'
  | 'visibility_hidden'
  | 'window_blur'
  | 'pagehide';

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

export interface AIInterviewVoiceOption {
  id: string;
  name: string;
  displayName: string;
  tier: 'standard' | 'multilingual' | 'hd' | 'mai_premium';
  tierLabel: string;
  tierDescription?: string;
  provider: string;
  language: string;
  gender?: string;
  avatarTone?: string;
  description?: string;
  samplePhrase?: string;
  traits?: string[];
  isDefault?: boolean;
  walletSurchargeCents: number;
  usdPerMillionCharacters: number;
}

export interface AIInterviewCostEstimate {
  currency: 'USD';
  unitPriceCents: number;
  baseUnitPriceCents: number;
  voiceSurchargeCents: number;
  unitPriceUsd: number;
  candidateCount: number;
  totalCents: number;
  totalUsd: number;
  estimatedSpeechCharacters: number;
  estimatedSpeechUsd: number;
  estimatedSttUsd?: number;
  estimatedLlmAndPlatformUsd?: number;
  estimatedBackendCostUsdPerCandidate?: number;
  estimatedBackendCostUsd?: number;
  grossMarginUsdPerCandidate?: number;
  grossMarginUsd?: number;
  grossMarginPercent?: number;
  walletBalanceCents?: number;
  walletBalanceUsd?: number;
  enoughFunds?: boolean;
  voice: AIInterviewVoiceOption;
  displayValue?: {
    amount: number;
    currency: string;
    source: string;
  };
  calculatedAt?: string;
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
  billing?: {
    currency: string;
    unitPriceCents: number;
    totalCents: number;
    chargedAt?: string;
    ledgerEntryId?: string;
  };
  voice?: AIInterviewVoiceOption & {
    voiceId?: string;
  };
  costEstimate?: Partial<AIInterviewCostEstimate>;
  stats?: {
    sent: number;
    opened: number;
    inProgress: number;
    completed: number;
    blocked: number;
    failed: number;
    proctorFailed?: number;
  };
  scoringSummary?: AIInterviewScoringSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIInterviewInput {
  title?: string;
  jobId: string;
  candidateIds: string[];
  guestRecipients?: Array<{
    name?: string;
    email: string;
  }>;
  guestCandidates?: Array<{
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email: string;
  }>;
  questionIds: string[];
  guidelines: string;
  sendAt: string;
  expiresAt: string;
  perQuestionMinutes: number;
  totalMinutes: number;
  voiceId?: string;
  timezone?: string;
}

export interface AIInterviewJob {
  _id: string;
  title: string;
  department?: string;
  location?: string;
  description?: string;
  level?: string;
  type?: string;
  remote?: boolean;
  skills?: string[];
  requirements?: string;
  responsibilities?: string;
  benefits?: string;
  openings?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AIInterviewCandidate {
  _id: string;
  firstName?: string;
  lastName?: string;
  name: string;
  email: string;
  phone?: string;
  jobId?: string;
  status?: string;
  location?: string;
  currentTitle?: string;
  yearsOfExperience?: number | null;
  skills?: string[];
  education?: string[];
  workExperience?: Array<{
    title?: string;
    company?: string;
    duration?: string;
    summary?: string;
  }>;
  summary?: string;
  strengths?: string[];
  risks?: string[];
  resumeText?: string;
  profileSource?: string;
  profileUpdatedAt?: string;
}

export type CVProcessingState =
  | 'queued'
  | 'waiting_for_chatgpt'
  | 'processing'
  | 'completed'
  | 'failed';

export interface CVProcessingJobResponse {
  jobId: string;
  statusToken?: string;
  statusUrl?: string;
  state: CVProcessingState;
  progress: number;
  position: number | null;
  queueAvailable?: boolean;
  duplicate?: boolean;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  candidateId?: string | null;
  candidate?: AIInterviewCandidate;
  profile?: any;
  history?: any[];
  error?: { code?: string; message?: string };
}

export interface AIInterviewQuestion {
  _id: string;
  jobId?: string;
  question: string;
  type?: string;
  category?: string;
  difficulty?: string;
  expectedAnswer?: string;
  scoringCriteria?: Array<{
    criterion: string;
    weight?: number;
    description?: string;
  }>;
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
    selectedVoice?: AIInterview['voice'] | null;
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
  async getOptions(): Promise<{
    voices: AIInterviewVoiceOption[];
    tiers: Array<{
      id: string;
      label: string;
      description: string;
    walletSurchargeCents: number;
    usdPerMillionCharacters: number;
    voices: AIInterviewVoiceOption[];
  }>;
  defaultVoiceId: string;
  pricing?: {
    currency: string;
    unitPriceCents: number;
    walletBalanceCents: number;
    source: string;
  };
  }> {
    const response = await apiRequest('/api/ai-interviews/options');
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async estimateCost(input: {
    candidateCount: number;
    questionCount: number;
    totalMinutes: number;
    voiceId?: string;
  }): Promise<AIInterviewCostEstimate> {
    const response = await apiRequest('/api/ai-interviews/estimate', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.estimate;
  }

  async previewVoice(input: { voiceId: string; text?: string }): Promise<Blob> {
    const response = await apiRequest('/api/ai-interviews/voice-preview', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  }

  async list(params?: { status?: string; jobId?: string }): Promise<AIInterview[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.jobId) query.set('jobId', params.jobId);
    const response = await apiRequest(`/api/ai-interviews${query.toString() ? `?${query.toString()}` : ''}`);
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.aiInterviews || [];
  }

  async create(input: CreateAIInterviewInput): Promise<{ aiInterview: AIInterview; sessions: AIInterviewSession[]; walletCharge?: any; costPreview?: any; publicLinks?: any[] }> {
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

  async createJob(input: Partial<AIInterviewJob> & { title: string }): Promise<AIInterviewJob> {
    const response = await apiRequest('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.job;
  }

  async createCandidate(input: Partial<AIInterviewCandidate> & { jobId: string; name: string; email: string }): Promise<AIInterviewCandidate> {
    const response = await apiRequest('/api/candidates', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.candidate;
  }

  async importCandidateCv(input: { jobId: string; file: File }): Promise<CVProcessingJobResponse> {
    const body = new FormData();
    body.set('jobId', input.jobId);
    body.set('cv', input.file);
    const response = await apiRequest('/api/candidates/import-cv', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async enrichCandidateCv(input: { candidateId: string; file: File }): Promise<CVProcessingJobResponse> {
    const body = new FormData();
    body.set('cv', input.file);
    const response = await apiRequest(`/api/candidates/${input.candidateId}/cv`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async getCvProcessingJob(job: Pick<CVProcessingJobResponse, 'jobId' | 'statusToken' | 'statusUrl'>): Promise<CVProcessingJobResponse> {
    if (!job.statusToken) throw new Error('CV status token is missing.');
    const response = await apiRequest(job.statusUrl || `/api/cv-processing/jobs/${job.jobId}`, {
      headers: { 'X-CV-Status-Token': job.statusToken }
    });
    if (!response.ok) throw await parseError(response);
    return { ...await response.json(), statusToken: job.statusToken, statusUrl: job.statusUrl };
  }

  async importCandidatesTable(input: { jobId: string; file: File }): Promise<{
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    skipped: Array<{ row: string; reason: string }>;
    candidates: AIInterviewCandidate[];
  }> {
    const body = new FormData();
    body.set('jobId', input.jobId);
    body.set('file', input.file);
    const response = await apiRequest('/api/candidates/import-table', {
      method: 'POST',
      body
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async getCandidateProfile(candidateId: string): Promise<{ candidate: AIInterviewCandidate; history: Array<any> }> {
    const response = await apiRequest(`/api/candidates/${candidateId}/profile`);
    if (!response.ok) throw await parseError(response);
    return response.json();
  }

  async createQuestion(input: {
    jobId: string;
    question: string;
    type?: string;
    category?: string;
    difficulty?: string;
    expectedAnswer?: string;
  }): Promise<AIInterviewQuestion> {
    const response = await apiRequest('/api/questions', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.question;
  }

  async generateQuestions(input: {
    jobId: string;
    questionCount?: number;
    difficulty?: string;
    includeTypes?: string[];
    focusAreas?: string[];
  }): Promise<AIInterviewQuestion[]> {
    const response = await apiRequest('/api/questions/generate', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if (!response.ok) throw await parseError(response);
    const data = await response.json();
    return data.questions || [];
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

  async recordPublicProctoringEvent(
    token: string,
    input: {
      type: AIInterviewProctoringEventType;
      metadata?: {
        visibilityState?: string;
        reason?: string;
      };
    }
  ): Promise<PublicAIInterviewState & {
    action?: 'ignored' | 'logged' | 'warned' | 'final_warning' | 'terminated';
    warningMessage?: string;
    deduped?: boolean;
  }> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/proctoring-event`, {
      method: 'POST',
      body: JSON.stringify(input)
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

  async transcribePublicSpeech(token: string, audio: Blob): Promise<{ transcript: string; language?: string }> {
    const response = await apiRequest(`/api/ai-interviews/public/${token}/speech-transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': audio.type || 'audio/wav',
        'X-Skip-Body-Sanitization': 'true'
      },
      body: audio
    });
    if (!response.ok) throw await parseError(response);
    return response.json();
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
