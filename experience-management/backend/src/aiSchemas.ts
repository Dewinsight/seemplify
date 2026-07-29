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

const socialMentionAnalysis = z.object({
  mentionId: z.string(), sentiment: z.enum(['negative', 'neutral', 'positive', 'mixed']), sentimentScore: z.number().min(-1).max(1),
  emotions: z.array(z.string()), themes: z.array(z.string()), summary: z.string(), risk: z.enum(['low', 'medium', 'high', 'critical'])
});
export const socialListeningResult = z.object({
  executiveSummary: z.string(),
  sentiment: z.object({ negative: z.number(), neutral: z.number(), positive: z.number(), mixed: z.number() }),
  themes: z.array(z.object({ name: z.string(), mentions: z.number(), sentiment: z.string(), evidence: z.array(z.string()) })),
  emergingTrends: z.array(z.object({ trend: z.string(), direction: z.enum(['rising', 'stable', 'falling']), evidence: z.array(z.string()) })),
  risks: z.array(z.object({ issue: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']), evidence: z.array(z.string()), action: z.string() })),
  opportunities: z.array(z.object({ opportunity: z.string(), evidence: z.array(z.string()), action: z.string() })),
  mentions: z.array(socialMentionAnalysis)
});

const journeyString = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);
const journeyStrings = (maximumItems: number, maximumLength: number) => z.array(journeyString(maximumLength)).max(maximumItems);
const journeyStage = z.object({
  name: journeyString(200), goal: journeyString(1000), touchpoints: journeyStrings(50, 500), customerActions: journeyStrings(50, 500),
  emotions: journeyStrings(30, 200), painPoints: journeyStrings(50, 1000), metrics: journeyStrings(50, 500),
  opportunities: journeyStrings(50, 1000), recommendedActions: journeyStrings(50, 1000)
});
export const journeyResult = z.object({
  name: journeyString(180, 2), audience: z.string().trim().max(500), objective: z.string().trim().max(2000),
  industry: z.string().trim().max(200), summary: z.string().trim().max(5000), stages: z.array(journeyStage).min(3).max(12)
});

const string = { type: 'string' } as const;
const number = { type: 'number' } as const;
const unitNumber = { type: 'number', minimum: 0, maximum: 1 } as const;
const signedUnitNumber = { type: 'number', minimum: -1, maximum: 1 } as const;
const percentageNumber = { type: 'number', minimum: 0, maximum: 100 } as const;
const nonNegativeInteger = { type: 'integer', minimum: 0 } as const;
const boolean = { type: 'boolean' } as const;
const strings = { type: 'array', items: string } as const;
const finiteObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, required, properties
});
const arrayOf = (items: unknown) => ({ type: 'array', items });

const generatedQuestionJson = finiteObject({
  type: { type: 'string', enum: [...QUESTION_TYPES] }, title: string, description: string,
  required: boolean, options: strings, page: { type: 'integer', minimum: 1 }
});

export const aiJsonSchemas = {
  surveyGeneration: finiteObject({
    title: string, description: string,
    purpose: { type: 'string', enum: ['customer_experience', 'employee_experience', 'market_research'] },
    audience: string, primaryMetric: { type: 'string', enum: ['nps', 'csat', 'ces', 'custom'] },
    language: string, estimatedMinutes: number, questions: arrayOf(generatedQuestionJson)
  }),
  responseAnalysis: finiteObject({
    language: string, sentiment: { type: 'string', enum: ['very_negative', 'negative', 'neutral', 'positive', 'very_positive'] }, sentimentScore: signedUnitNumber, confidence: unitNumber, emotions: strings,
    intent: string, urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, summary: string,
    topics: arrayOf(finiteObject({ name: string, sentiment: { type: 'string', enum: ['negative', 'neutral', 'positive', 'mixed'] }, evidence: string })),
    recommendedActions: strings, flags: strings
  }),
  insights: finiteObject({
    executiveSummary: string, healthScore: percentageNumber,
    keyFindings: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    themes: arrayOf(finiteObject({ name: string, frequency: nonNegativeInteger, sentiment: string, evidence: strings })),
    drivers: arrayOf(finiteObject({ name: string, direction: { type: 'string', enum: ['positive', 'negative', 'mixed'] }, strength: unitNumber, explanation: string })),
    risks: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    opportunities: arrayOf(finiteObject({ title: string, detail: string, evidence: strings, impact: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    recommendations: arrayOf(finiteObject({ action: string, owner: string, priority: { type: 'string', enum: ['now', 'next', 'later'] }, rationale: string })),
    forecast: finiteObject({ direction: { type: 'string', enum: ['improving', 'stable', 'declining', 'insufficient_data'] }, confidence: unitNumber, explanation: string })
  }),
  analystChat: finiteObject({
    answer: string,
    evidence: arrayOf(finiteObject({ responseId: string, excerpt: string, relevance: string })),
    caveats: strings, suggestedQuestions: strings
  }),
  improvement: finiteObject({
    qualityScore: percentageNumber,
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
  }),
  socialListening: finiteObject({
    executiveSummary: string,
    sentiment: finiteObject({ negative: nonNegativeInteger, neutral: nonNegativeInteger, positive: nonNegativeInteger, mixed: nonNegativeInteger }),
    themes: arrayOf(finiteObject({ name: string, mentions: nonNegativeInteger, sentiment: string, evidence: strings })),
    emergingTrends: arrayOf(finiteObject({ trend: string, direction: { type: 'string', enum: ['rising', 'stable', 'falling'] }, evidence: strings })),
    risks: arrayOf(finiteObject({ issue: string, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, evidence: strings, action: string })),
    opportunities: arrayOf(finiteObject({ opportunity: string, evidence: strings, action: string })),
    mentions: arrayOf(finiteObject({ mentionId: string, sentiment: { type: 'string', enum: ['negative', 'neutral', 'positive', 'mixed'] }, sentimentScore: signedUnitNumber, emotions: strings, themes: strings, summary: string, risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } }))
  }),
  journey: finiteObject({
    name: { type: 'string', minLength: 2, maxLength: 180 }, audience: { type: 'string', maxLength: 500 },
    objective: { type: 'string', maxLength: 2000 }, industry: { type: 'string', maxLength: 200 }, summary: { type: 'string', maxLength: 5000 },
    stages: { type: 'array', minItems: 3, maxItems: 12, items: finiteObject({
      name: { type: 'string', minLength: 1, maxLength: 200 }, goal: { type: 'string', minLength: 1, maxLength: 1000 },
      touchpoints: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
      customerActions: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
      emotions: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 200 } },
      painPoints: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 1000 } },
      metrics: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
      opportunities: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 1000 } },
      recommendedActions: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 1000 } }
    }) }
  })
};
