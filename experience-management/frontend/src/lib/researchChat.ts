import { api, json } from '@/lib/api';
import type { ResearchChatResult } from '@/types';

export type ResearchConversationMessage = { role: 'user' | 'assistant'; content: string };

export function askResearchSources(input: {
  sourceRefs?: string[];
  reportId?: string;
  question: string;
  history?: ResearchConversationMessage[];
}) {
  return api<ResearchChatResult>('/api/intelligence/chat', json('POST', {
    sourceRefs: input.sourceRefs || [],
    ...(input.reportId ? { reportId: input.reportId } : {}),
    question: input.question,
    history: input.history || []
  }));
}
