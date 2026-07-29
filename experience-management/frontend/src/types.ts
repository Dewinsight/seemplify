export type QuestionType = 'single_choice' | 'multiple_choice' | 'dropdown' | 'nps' | 'multi_nps' | 'csat' | 'ces' | 'short_text' | 'multi_text' | 'long_text' | 'email' | 'number' | 'rating' | 'graphical_rating' | 'slider' | 'ranking' | 'matrix' | 'date' | 'contact' | 'file' | 'media' | 'statement';
export interface LogicRule { action: 'show' | 'hide' | 'skip_to' | 'create_ticket'; sourceQuestionId: string; operator: string; value: string | number; targetQuestionId?: string }
export interface Question { id: string; surveyId: string; page: number; position: number; type: QuestionType; title: string; description: string; required: boolean; options: string[]; settings: Record<string, any>; logic: LogicRule[] }
export interface Survey { id: string; title: string; description: string; purpose: 'customer_experience' | 'employee_experience' | 'market_research'; audience: string; status: 'draft' | 'live' | 'closed'; primaryMetric: 'nps' | 'csat' | 'ces' | 'custom'; language: string; thankYouMessage: string; theme: Record<string, any>; settings: Record<string, any>; createdAt: string; updatedAt: string; publishedAt: string | null; questions?: Question[]; responseCount?: number; collectorCount?: number }
export interface Collector { id: string; surveyId: string; name: string; type: 'web' | 'email' | 'api' | 'qr' | 'manual' | 'kiosk'; slug: string; status: 'open' | 'closed'; settings: Record<string, any>; createdAt: string; publicUrl: string; responseCount?: number; recipientCount?: number }
export interface ResponseRecord { id: string; surveyId: string; collectorId: string; respondentToken: string; status: 'partial' | 'completed'; answers: Record<string, any>; metadata: Record<string, any>; startedAt: string; completedAt: string | null; durationSeconds: number | null; aiAnalysis: any; analyzedAt: string | null }
export interface AiJob { id: string; kind: string; surveyId: string | null; responseId: string | null; state: 'queued' | 'processing' | 'completed' | 'failed'; stage: string; progress: number; attempt: number; input: Record<string, any>; result: any; error: string | null; retryAt: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string }
export interface Template { id: string; name: string; description: string; purpose: Survey['purpose']; primaryMetric: Survey['primaryMetric']; audience: string; questions: Partial<Question>[] }
export interface SurveyDetail { survey: Survey; collectors: Collector[]; insights: { id: string; kind: string; payload: any; createdAt: string }[] }
export interface SocialMention { id: string; source: 'x' | 'google_play' | 'app_store' | 'review' | 'forum' | 'other'; externalId?: string | null; xConnectionId?: string | null; ingestionKind?: 'account_post' | 'mention' | 'search' | null; author: string; content: string; url: string; language: string; publishedAt: string; metadata: Record<string, any>; analysis: any; createdAt: string }
export interface XListeningQuery { id: string; label: string; query: string; enabled: boolean; sinceId: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; createdAt: string; updatedAt: string }
export interface XSyncJob { id: string; connectionId: string; trigger: 'manual' | 'scheduled'; state: 'queued' | 'processing' | 'waiting_rate_limit' | 'completed' | 'failed' | 'cancelled'; stage: string; progress: number; attempt: number; runAfter: string | null; postsFetched: number; mentionsFetched: number; searchFetched: number; importedCount: number; analysisJobId: string | null; error: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string }
export interface XIntegrationStatus {
  provider: 'x'; callbackUrl: string; canManageAppCredentials: boolean;
  app: { configured: boolean; consumerCredentialsConfigured: boolean; bearerTokenConfigured: boolean; credentialVersion: number; updatedAt: string | null };
  connection: null | { id: string; status: string; account: null | { id: string; username: string | null; name: string | null; profileImageUrl: string | null }; autoSync: boolean; syncIntervalMinutes: number; nextSyncAt: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; rateLimits: Record<string, { limit: number | null; remaining: number | null; resetAt: string | null; observedAt: string }>; createdAt: string; updatedAt: string };
  queries: XListeningQuery[]; syncJobs: XSyncJob[];
  counts: { collected: number; accountPosts: number; mentions: number; searchResults: number; analyzed: number };
}
export interface JourneyStage { name: string; goal: string; touchpoints: string[]; customerActions: string[]; emotions: string[]; painPoints: string[]; metrics: string[]; opportunities: string[]; recommendedActions: string[] }
export interface Journey { id: string; name: string; audience: string; objective: string; industry: string; stages: JourneyStage[]; summary: string; createdAt: string; updatedAt: string }
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export interface Campaign {
  id: string; surveyId: string; collectorId: string; name: string; status: CampaignStatus;
  startsAt: string | null; settings: { stopOnResponse?: boolean; [key: string]: any };
  createdAt: string; updatedAt: string; launchedAt: string | null;
  surveyTitle?: string; contactCount?: number; sentCount?: number; failedCount?: number; respondedCount?: number; queuedCount?: number;
}
export interface CampaignStep {
  id: string; campaignId: string; position: number; delayMinutes: number; subject: string;
  mode: 'plain' | 'html'; bodyText: string; bodyHtml: string; embedQuestionId: string | null;
  createdAt?: string; updatedAt?: string;
}
export interface CampaignContact {
  id: string; campaignId: string; recipientId: string; email: string; firstName: string; lastName: string;
  jobTitle: string; company: string; status: 'pending' | 'active' | 'completed' | 'responded' | 'unsubscribed' | 'suppressed' | 'failed';
  currentStep: number; nextSendAt: string | null; customData: Record<string, any>; createdAt: string; updatedAt: string;
}
export interface CampaignDelivery {
  id: string; campaignId: string; contactId: string; stepId: string; stepPosition: number;
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'; attempt: number; scheduledAt: string;
  sentAt: string | null; messageId: string | null; error: string | null; email?: string; subject?: string; updatedAt: string;
  providerStatus?: string | null; providerUpdatedAt?: string | null; deliveredAt?: string | null; openedAt?: string | null;
  clickedAt?: string | null; bouncedAt?: string | null; complainedAt?: string | null; unsubscribedAt?: string | null;
}
export interface CampaignMetrics {
  contacts: number; queued: number; sent: number; failed: number; skipped: number; responded: number; completed: number;
  totalContacts?: number; totalDeliveries?: number; responseRate?: number; lastActivityAt?: string | null;
}
export interface CampaignDetail {
  campaign: Campaign; survey: Survey; collector: Collector; steps: CampaignStep[]; contacts: CampaignContact[];
  deliveries: CampaignDelivery[]; metrics: CampaignMetrics;
}
export interface CampaignTemplate {
  id: string; name: string; description: string;
  subject: string; bodyText: string; bodyHtml: string; mode: 'plain' | 'html';
  steps?: Array<Pick<CampaignStep, 'delayMinutes' | 'subject' | 'mode' | 'bodyText' | 'bodyHtml' | 'embedQuestionId'>>;
}
