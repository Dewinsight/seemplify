import { z } from 'zod';

export {
  assistantEmailDraftResult, assistantEmailSummaryResult, assistantJsonSchemas,
  assistantKnowledgeAnswerResult
} from './assistantSchemas.js';
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
  emotions: z.array(z.string()).max(20), themes: z.array(z.string()).max(20), summary: z.string(), risk: z.enum(['low', 'medium', 'high', 'critical']),
  evidence: z.string().trim().min(1).max(500)
});
const socialEvidence = z.array(z.string().trim().min(1).max(1000)).min(1).max(20);
export const socialListeningResult = z.object({
  executiveSummary: z.string(),
  sentiment: z.object({ negative: z.number().int().nonnegative(), neutral: z.number().int().nonnegative(), positive: z.number().int().nonnegative(), mixed: z.number().int().nonnegative() }),
  themes: z.array(z.object({ name: z.string(), mentions: z.number().int().nonnegative(), sentiment: z.string(), evidence: socialEvidence })).max(50),
  emergingTrends: z.array(z.object({ trend: z.string(), direction: z.enum(['rising', 'stable', 'falling']), evidence: socialEvidence })).max(30),
  risks: z.array(z.object({ issue: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']), evidence: socialEvidence, action: z.string() })).max(30),
  opportunities: z.array(z.object({ opportunity: z.string(), evidence: socialEvidence, action: z.string() })).max(30),
  mentions: z.array(socialMentionAnalysis).max(200)
});

export const socialReplyDraftResult = z.object({
  reply: z.string().trim().min(1).max(280),
  rationale: z.string().trim().min(1).max(2000),
  safetyFlags: z.array(z.string().trim().min(1).max(200)).max(20)
});

const intelligenceEvidence = z.object({
  sourceRef: z.string().trim().min(1).max(200), excerpt: z.string().trim().min(12).max(1000), relevance: z.string().trim().min(3).max(1000)
});
const intelligenceFinding = z.object({
  title: z.string().trim().min(1).max(300), detail: z.string().trim().min(1).max(4000),
  evidence: z.array(intelligenceEvidence).min(1).max(20), confidence: z.number().min(0).max(1)
});
export const crossSourceIntelligenceResult = z.object({
  title: z.string().trim().min(1).max(300), executiveSummary: z.string().trim().min(1).max(8000), confidence: z.number().min(0).max(1),
  themes: z.array(intelligenceFinding).max(30), convergence: z.array(intelligenceFinding).max(20), divergence: z.array(intelligenceFinding).max(20),
  risks: z.array(intelligenceFinding).max(20), opportunities: z.array(intelligenceFinding).max(20),
  recommendations: z.array(z.object({ action: z.string().trim().min(1).max(2000), priority: z.enum(['now', 'next', 'later']),
    rationale: z.string().trim().min(1).max(3000), evidence: z.array(intelligenceEvidence).min(1).max(20) })).max(30),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(30)
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
const socialEvidenceString = { type: 'string', minLength: 1, maxLength: 1000 } as const;
const socialEvidenceStrings = { type: 'array', minItems: 1, maxItems: 20, items: socialEvidenceString } as const;
const finiteObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, required, properties
});
const arrayOf = (items: unknown) => ({ type: 'array', items });
const intelligenceEvidenceJson = finiteObject({
  sourceRef: { type: 'string', minLength: 1, maxLength: 200 },
  excerpt: { type: 'string', minLength: 12, maxLength: 1000 },
  relevance: { type: 'string', minLength: 3, maxLength: 1000 }
});

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
    themes: { type: 'array', maxItems: 50, items: finiteObject({ name: string, mentions: nonNegativeInteger, sentiment: string, evidence: socialEvidenceStrings }) },
    emergingTrends: { type: 'array', maxItems: 30, items: finiteObject({ trend: string, direction: { type: 'string', enum: ['rising', 'stable', 'falling'] }, evidence: socialEvidenceStrings }) },
    risks: { type: 'array', maxItems: 30, items: finiteObject({ issue: string, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, evidence: socialEvidenceStrings, action: string }) },
    opportunities: { type: 'array', maxItems: 30, items: finiteObject({ opportunity: string, evidence: socialEvidenceStrings, action: string }) },
    mentions: { type: 'array', maxItems: 200, items: finiteObject({ mentionId: string, sentiment: { type: 'string', enum: ['negative', 'neutral', 'positive', 'mixed'] }, sentimentScore: signedUnitNumber,
      emotions: { type: 'array', maxItems: 20, items: string }, themes: { type: 'array', maxItems: 20, items: string }, summary: string,
      risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, evidence: { type: 'string', minLength: 1, maxLength: 500 } }) }
  }),
  socialReplyDraft: finiteObject({
    reply: { type: 'string', minLength: 1, maxLength: 280 }, rationale: { type: 'string', minLength: 1, maxLength: 2000 },
    safetyFlags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } }
  }),
  crossSourceIntelligence: finiteObject({
    title: { type: 'string', minLength: 1, maxLength: 300 }, executiveSummary: { type: 'string', minLength: 1, maxLength: 8000 }, confidence: unitNumber,
    themes: arrayOf(finiteObject({ title: string, detail: string, evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson }, confidence: unitNumber })),
    convergence: arrayOf(finiteObject({ title: string, detail: string, evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson }, confidence: unitNumber })),
    divergence: arrayOf(finiteObject({ title: string, detail: string, evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson }, confidence: unitNumber })),
    risks: arrayOf(finiteObject({ title: string, detail: string, evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson }, confidence: unitNumber })),
    opportunities: arrayOf(finiteObject({ title: string, detail: string, evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson }, confidence: unitNumber })),
    recommendations: arrayOf(finiteObject({ action: string, priority: { type: 'string', enum: ['now', 'next', 'later'] }, rationale: string,
      evidence: { type: 'array', minItems: 1, maxItems: 20, items: intelligenceEvidenceJson } })),
    limitations: strings
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
