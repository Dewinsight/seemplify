import { z } from 'zod';
import { QUESTION_TYPES } from './types.js';

const generatedQuestion = z.object({
  type: z.enum(QUESTION_TYPES),
  title: z.string().min(2),
  description: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
  page: z.number().int().min(1)
});

export const surveyGenerationResult = z.object({
  title: z.string().min(3),
  description: z.string(),
  purpose: z.enum(['customer_experience', 'employee_experience', 'market_research']),
  audience: z.string(),
  primaryMetric: z.enum(['nps', 'csat', 'ces', 'custom']),
  language: z.string(),
  estimatedMinutes: z.number().min(1),
  questions: z.array(generatedQuestion).min(2).max(40)
});

export const responseAnalysisResult = z.object({
  language: z.string(),
  sentiment: z.enum(['very_negative', 'negative', 'neutral', 'positive', 'very_positive']),
  sentimentScore: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  emotions: z.array(z.string()),
  intent: z.string(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string(),
  topics: z.array(z.object({
    name: z.string(),
    sentiment: z.enum(['negative', 'neutral', 'positive', 'mixed']),
    evidence: z.string()
  })),
  recommendedActions: z.array(z.string()),
  flags: z.array(z.string())
});

const insightItem = z.object({
  title: z.string(),
  detail: z.string(),
  evidence: z.array(z.string()),
  impact: z.enum(['low', 'medium', 'high'])
});

export const insightResult = z.object({
  executiveSummary: z.string(),
  healthScore: z.number().min(0).max(100),
  keyFindings: z.array(insightItem),
  themes: z.array(z.object({ name: z.string(), frequency: z.number(), sentiment: z.string(), evidence: z.array(z.string()) })),
  drivers: z.array(z.object({ name: z.string(), direction: z.enum(['positive', 'negative', 'mixed']), strength: z.number().min(0).max(1), explanation: z.string() })),
  risks: z.array(insightItem),
  opportunities: z.array(insightItem),
  recommendations: z.array(z.object({ action: z.string(), owner: z.string(), priority: z.enum(['now', 'next', 'later']), rationale: z.string() })),
  forecast: z.object({ direction: z.enum(['improving', 'stable', 'declining', 'insufficient_data']), confidence: z.number().min(0).max(1), explanation: z.string() })
});

export const analystChatResult = z.object({
  answer: z.string(),
  evidence: z.array(z.object({ responseId: z.string(), excerpt: z.string(), relevance: z.string() })),
  caveats: z.array(z.string()),
  suggestedQuestions: z.array(z.string())
});

export const improvementResult = z.object({
  qualityScore: z.number().min(0).max(100),
  issues: z.array(z.object({ severity: z.enum(['low', 'medium', 'high']), questionTitle: z.string(), issue: z.string() })),
  improvements: z.array(z.string()),
  revisedTitle: z.string(),
  revisedDescription: z.string(),
  revisedQuestions: z.array(generatedQuestion)
});

export const translationResult = z.object({
  language: z.string(),
  title: z.string(),
  description: z.string(),
  thankYouMessage: z.string(),
  questions: z.array(z.object({ questionId: z.string(), title: z.string(), description: z.string(), options: z.array(z.string()) }))
});

export const reportResult = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string(), evidence: z.array(z.string()) })),
  recommendations: z.array(z.object({ action: z.string(), priority: z.enum(['now', 'next', 'later']), expectedOutcome: z.string() })),
  methodology: z.string()
});

const string = { type: 'string' } as const;
const number = { type: 'number' } as const;
const boolean = { type: 'boolean' } as const;
const strings = { type: 'array', items: string } as const;
const finiteObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, required, properties
});
const arrayOf = (items: unknown) => ({ type: 'array', items });

const generatedQuestionJson = finiteObject({
  type: { type: 'string', enum: [...QUESTION_TYPES] }, title: string, description: string,
  required: boolean, options: strings, page: { type: 'integer' }
});

export const aiJsonSchemas = {
  surveyGeneration: finiteObject({
    title: string, description: string,
    purpose: { type: 'string', enum: ['customer_experience', 'employee_experience', 'market_research'] },
    audience: string, primaryMetric: { type: 'string', enum: ['nps', 'csat', 'ces', 'custom'] },
    language: string, estimatedMinutes: number, questions: arrayOf(generatedQuestionJson)
  }),
  responseAnalysis: finiteObject({
    language: string, sentiment: { type: 'string', enum: ['very_negative', 'negative', 'neutral', 'positive', 'very_positive'] }, sentimentScore: number, confidence: number, emotions: strings,
    intent: string, urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, summary: string,
    topics: arrayOf(finiteObject({ name: string, sentiment: { type: 'string', enum: ['negative', 'neutral', 'positive', 'mixed'] }, evidence: string })),
    recommendedActions: strings, flags: strings
  }),
  insights: finiteObject({
    executiveSummary: string, healthScore: number,
    keyFindings: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    themes: arrayOf(finiteObject({ name: string, frequency: number, sentiment: string, evidence: strings })),
    drivers: arrayOf(finiteObject({ name: string, direction: { type: 'string', enum: ['positive', 'negative', 'mixed'] }, strength: number, explanation: string })),
    risks: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    opportunities: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    recommendations: arrayOf(finiteObject({ action: string, owner: string, priority: { type: 'string', enum: ['now', 'next', 'later'] }, rationale: string })),
    forecast: finiteObject({ direction: { type: 'string', enum: ['improving', 'stable', 'declining', 'insufficient_data'] }, confidence: number, explanation: string })
  }),
  analystChat: finiteObject({
    answer: string,
    evidence: arrayOf(finiteObject({ responseId: string, excerpt: string, relevance: string })),
    caveats: strings, suggestedQuestions: strings
  }),
  improvement: finiteObject({
    qualityScore: number,
    issues: arrayOf(finiteObject({ severity: { type: 'string', enum: ['low', 'medium', 'high'] }, questionTitle: string, issue: string })),
    improvements: strings, revisedTitle: string, revisedDescription: string,
    revisedQuestions: arrayOf(generatedQuestionJson)
  }),
  translation: finiteObject({
    language: string, title: string, description: string, thankYouMessage: string,
    questions: arrayOf(finiteObject({ questionId: string, title: string, description: string, options: strings }))
  }),
  report: finiteObject({
    title: string, executiveSummary: string,
    sections: arrayOf(finiteObject({ heading: string, body: string, evidence: strings })),
    recommendations: arrayOf(finiteObject({ action: string, priority: { type: 'string', enum: ['now', 'next', 'later'] }, expectedOutcome: string })),
    methodology: string
  })
};
