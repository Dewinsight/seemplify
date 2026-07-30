import { z } from 'zod';

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const assistantEmailSummaryResult = z.object({
  summary: boundedText(6_000),
  keyPoints: z.array(boundedText(700)).max(20),
  actionItems: z.array(z.object({
    action: boundedText(700),
    owner: z.string().trim().max(200),
    dueDate: z.string().trim().max(100),
    sourceMessageId: boundedText(300)
  }).strict()).max(20),
  openQuestions: z.array(boundedText(700)).max(20)
}).strict();

export const assistantEmailDraftResult = z.object({
  subject: boundedText(500),
  body: boundedText(12_000),
  rationale: z.string().trim().max(2_000),
  safetyFlags: z.array(boundedText(300)).max(20)
}).strict();

export const assistantKnowledgeAnswerResult = z.object({
  answer: boundedText(12_000),
  citations: z.array(z.object({
    sourceRef: boundedText(300),
    excerpt: boundedText(1_500)
  }).strict()).min(1).max(20)
}).strict();

const string = { type: 'string' } as const;

export const assistantJsonSchemas = Object.freeze({
  emailSummary: {
    type: 'object', additionalProperties: false,
    required: ['summary', 'keyPoints', 'actionItems', 'openQuestions'],
    properties: {
      summary: string,
      keyPoints: { type: 'array', maxItems: 20, items: string },
      actionItems: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false,
          required: ['action', 'owner', 'dueDate', 'sourceMessageId'],
          properties: { action: string, owner: string, dueDate: string, sourceMessageId: { type: 'string', minLength: 1, maxLength: 300 } }
        }
      },
      openQuestions: { type: 'array', maxItems: 20, items: string }
    }
  },
  emailDraft: {
    type: 'object', additionalProperties: false,
    required: ['subject', 'body', 'rationale', 'safetyFlags'],
    properties: {
      subject: string, body: string, rationale: string,
      safetyFlags: { type: 'array', maxItems: 20, items: string }
    }
  },
  knowledgeAnswer: {
    type: 'object', additionalProperties: false,
    required: ['answer', 'citations'],
    properties: {
      answer: string,
      citations: {
        type: 'array', minItems: 1, maxItems: 20,
        items: {
          type: 'object', additionalProperties: false,
          required: ['sourceRef', 'excerpt'],
          properties: { sourceRef: string, excerpt: string }
        }
      }
    }
  }
} satisfies Record<string, Record<string, unknown>>);
