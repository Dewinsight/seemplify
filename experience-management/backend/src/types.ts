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
  | 'journey.generate'
  | 'journey.optimize';

export interface SocialMention {
  id: string;
  source: 'x' | 'google_play' | 'app_store' | 'review' | 'forum' | 'other';
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

export interface Journey {
  id: string;
  name: string;
  audience: string;
  objective: string;
  industry: string;
  stages: JourneyStage[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiJob {
  id: string;
  kind: AiJobKind;
  surveyId: string | null;
  responseId: string | null;
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
