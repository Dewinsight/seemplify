export const QUESTION_TYPES = [
  'single_choice', 'multiple_choice', 'dropdown', 'nps', 'multi_nps', 'csat', 'ces',
  'short_text', 'multi_text', 'long_text', 'email', 'number', 'rating', 'graphical_rating',
  'slider', 'ranking', 'matrix', 'date', 'contact', 'file', 'media', 'statement'
] as const;

export type QuestionType = typeof QUESTION_TYPES[number];

export interface Question {
  id: string;
  surveyId: string;
  page: number;
  position: number;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  options: string[];
  settings: Record<string, unknown>;
  logic: LogicRule[];
}

export interface LogicRule {
  action: 'show' | 'hide' | 'skip_to' | 'create_ticket';
  sourceQuestionId: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'less_than' | 'greater_than';
  value: string | number;
  targetQuestionId?: string;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  purpose: 'customer_experience' | 'employee_experience' | 'market_research';
  audience: string;
  status: 'draft' | 'live' | 'closed';
  primaryMetric: 'nps' | 'csat' | 'ces' | 'custom';
  language: string;
  thankYouMessage: string;
  theme: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  questions?: Question[];
}

export interface Collector {
  id: string;
  surveyId: string;
  name: string;
  type: 'web' | 'email' | 'api' | 'qr' | 'manual' | 'kiosk';
  slug: string;
  status: 'open' | 'closed';
  settings: Record<string, unknown>;
  createdAt: string;
  publicUrl?: string;
}

export interface ResponseRecord {
  id: string;
  surveyId: string;
  collectorId: string;
  respondentToken: string;
  status: 'partial' | 'completed';
  answers: Record<string, unknown>;
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  aiAnalysis: Record<string, unknown> | null;
  analyzedAt: string | null;
}

export type AiJobKind =
  | 'survey.generate'
  | 'survey.improve'
  | 'survey.translate'
  | 'response.analyze'
  | 'insights.generate'
  | 'analyst.chat'
  | 'report.generate'
  | 'social.analyze'
  | 'social.report'
  | 'social.reply_draft'
  | 'intelligence.synthesize'
  | 'journey.generate'
  | 'journey.optimize';

export interface SocialMention {
  id: string;
  source: 'x' | 'google_play' | 'app_store' | 'review' | 'forum' | 'other';
  externalId?: string | null;
  xConnectionId?: string | null;
  ingestionKind?: 'account_post' | 'mention' | 'search' | null;
  author: string;
  content: string;
  url: string;
  language: string;
  publishedAt: string;
  metadata: Record<string, unknown>;
  analysis: Record<string, unknown> | null;
  createdAt: string;
}

export interface JourneyStage {
  name: string;
  goal: string;
  touchpoints: string[];
  customerActions: string[];
  emotions: string[];
  painPoints: string[];
  metrics: string[];
  opportunities: string[];
  recommendedActions: string[];
}

export interface JourneyProvenance {
  origin: 'workspace' | 'terra' | 'legacy';
  lastModifiedBy: 'workspace' | 'terra' | 'unknown';
  evidenceBasis: 'workspace_authored' | 'brief_only' | 'unknown';
  evidenceLevel: 'hypothesis';
  generatedAt: string | null;
  optimizedAt: string | null;
}

export interface Journey {
  id: string;
  name: string;
  audience: string;
  objective: string;
  industry: string;
  stages: JourneyStage[];
  summary: string;
  provenance: JourneyProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyVersion {
  id: string;
  journeyId: string;
  reason: 'workspace_edit' | 'terra_optimize' | 'restore_displaced';
  actor: 'workspace' | 'terra';
  sourceJobId: string | null;
  snapshot: Journey;
  snapshotUpdatedAt: string;
  createdAt: string;
}

export interface JourneyVersionSummary {
  id: string;
  journeyId: string;
  reason: JourneyVersion['reason'];
  actor: JourneyVersion['actor'];
  sourceJobId: string | null;
  name: string;
  stageCount: number;
  snapshotUpdatedAt: string;
  createdAt: string;
}

export interface AiJob {
  id: string;
  kind: AiJobKind;
  surveyId: string | null;
  responseId: string | null;
  requestedBy: string | null;
  state: 'queued' | 'processing' | 'completed' | 'failed';
  stage: string;
  progress: number;
  attempt: number;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  retryAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export type CampaignContentMode = 'plain' | 'html';
export type CampaignContactStatus = 'active' | 'responded' | 'completed' | 'failed' | 'suppressed' | 'unsubscribed';
export type CampaignDeliveryState = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface Campaign {
  id: string;
  surveyId: string;
  collectorId: string;
  name: string;
  status: CampaignStatus;
  stopOnResponse: boolean;
  startAt: string | null;
  startsAt?: string | null;
  settings?: { stopOnResponse: boolean };
  createdAt: string;
  updatedAt: string;
  launchedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
}

export type CampaignWorkflowSectionKey = 'setup' | 'audience' | 'sequence' | 'schedule';

export interface CampaignWorkflowSection {
  key: CampaignWorkflowSectionKey;
  complete: boolean;
  issues: string[];
}

export interface CampaignReadiness {
  ready: boolean;
  completedSections: number;
  totalSections: number;
  sections: Record<CampaignWorkflowSectionKey, CampaignWorkflowSection>;
  issues: string[];
}

export interface CampaignStep {
  id: string;
  campaignId: string;
  position: number;
  delayMinutes: number;
  subject: string;
  mode: CampaignContentMode;
  bodyText: string;
  bodyHtml: string;
  embedQuestionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignContact {
  id: string;
  campaignId: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  token: string;
  status: CampaignContactStatus;
  customData: Record<string, unknown>;
  currentStep: number;
  lastSentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recipientId?: string;
  nextSendAt?: string | null;
}

export interface CampaignDelivery {
  id: string;
  campaignId: string;
  stepId: string;
  contactId: string;
  stepPosition: number;
  state: CampaignDeliveryState;
  scheduledAt: string;
  attempt: number;
  maxAttempts: number;
  firstAttemptAt?: string | null;
  providerMessageId: string | null;
  providerStatus?: string | null;
  deliveredAt?: string | null;
  openedAt?: string | null;
  clickedAt?: string | null;
  bouncedAt?: string | null;
  complainedAt?: string | null;
  unsubscribedAt?: string | null;
  providerUpdatedAt?: string | null;
  messageId?: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
