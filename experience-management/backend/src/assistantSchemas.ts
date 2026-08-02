import { z } from 'zod';

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const ASSISTANT_DOCUMENT_TYPES = [
  'correspondence',
  'memo',
  'report',
  'board_paper',
  'meeting_pack',
  'briefing_note',
  'meeting_minutes',
  'executive_document',
  'cross_document_summary',
  'historical_decision_brief',
  'policy_lookup',
  'scheduling_proposal'
] as const;

export const assistantDocumentType = z.enum(ASSISTANT_DOCUMENT_TYPES);
export type AssistantDocumentType = z.infer<typeof assistantDocumentType>;

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

export const assistantWorkProductResult = z.object({
  title: boundedText(500),
  executiveSummary: boundedText(6_000),
  body: boundedText(24_000),
  decisions: z.array(boundedText(1_000)).max(30),
  actionItems: z.array(z.object({
    action: boundedText(700),
    owner: z.string().trim().max(200),
    dueDate: z.string().trim().max(100),
    sourceRef: z.string().trim().max(300)
  }).strict()).max(30),
  citations: z.array(z.object({
    sourceRef: boundedText(300),
    excerpt: boundedText(1_500)
  }).strict()).max(30),
  limitations: z.array(boundedText(1_000)).max(20)
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
  },
  workProduct: {
    type: 'object', additionalProperties: false,
    required: ['title', 'executiveSummary', 'body', 'decisions', 'actionItems', 'citations', 'limitations'],
    properties: {
      title: string,
      executiveSummary: string,
      body: string,
      decisions: { type: 'array', maxItems: 30, items: string },
      actionItems: {
        type: 'array', maxItems: 30,
        items: {
          type: 'object', additionalProperties: false,
          required: ['action', 'owner', 'dueDate', 'sourceRef'],
          properties: {
            action: string, owner: string, dueDate: string,
            sourceRef: { type: 'string', maxLength: 300 }
          }
        }
      },
      citations: {
        type: 'array', maxItems: 30,
        items: {
          type: 'object', additionalProperties: false,
          required: ['sourceRef', 'excerpt'],
          properties: { sourceRef: string, excerpt: string }
        }
      },
      limitations: { type: 'array', maxItems: 20, items: string }
    }
  }
} satisfies Record<string, Record<string, unknown>>);
