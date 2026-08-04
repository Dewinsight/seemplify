import type { AiJobKind } from './types.js';

export type CodexActionId = AiJobKind | 'knowledge.answer';

export type CodexActionDefinition = {
  id: CodexActionId;
  group: 'Surveys and responses' | 'Research intelligence' | 'Social and journeys' | 'Assistant and knowledge';
  label: string;
  description: string;
  defaultReasoningEffort: 'medium' | 'high';
};

export const codexActionCatalog: CodexActionDefinition[] = [
  {
    id: 'survey.generate', group: 'Surveys and responses', label: 'Survey generation',
    description: 'Create a new survey from a research brief.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'survey.improve', group: 'Surveys and responses', label: 'Survey quality review',
    description: 'Review and improve survey structure and wording.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'survey.translate', group: 'Surveys and responses', label: 'Survey translation',
    description: 'Translate survey questions and answer choices.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'response.analyze', group: 'Surveys and responses', label: 'Response analysis',
    description: 'Assess sentiment, urgency, and recovery signals.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'insights.generate', group: 'Research intelligence', label: 'Insight generation',
    description: 'Find themes, risks, and supported recommendations.', defaultReasoningEffort: 'high'
  },
  {
    id: 'analyst.chat', group: 'Research intelligence', label: 'Analyst chat',
    description: 'Answer questions from saved survey evidence.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'report.generate', group: 'Research intelligence', label: 'Executive report',
    description: 'Prepare an evidence-led report, caveats, and actions.', defaultReasoningEffort: 'high'
  },
  {
    id: 'intelligence.synthesize', group: 'Research intelligence', label: 'Cross-source intelligence',
    description: 'Combine selected survey and social research.', defaultReasoningEffort: 'high'
  },
  {
    id: 'social.analyze', group: 'Social and journeys', label: 'Social listening analysis',
    description: 'Analyse collected posts and mentions.', defaultReasoningEffort: 'high'
  },
  {
    id: 'social.report', group: 'Social and journeys', label: 'Social intelligence report',
    description: 'Turn saved social evidence into a durable report.', defaultReasoningEffort: 'high'
  },
  {
    id: 'social.reply_draft', group: 'Social and journeys', label: 'Social reply draft',
    description: 'Draft a grounded reply for human review.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'journey.generate', group: 'Social and journeys', label: 'Journey generation',
    description: 'Build evidence-led customer journey stages.', defaultReasoningEffort: 'high'
  },
  {
    id: 'journey.optimize', group: 'Social and journeys', label: 'Journey optimization',
    description: 'Improve an existing journey without losing audit history.', defaultReasoningEffort: 'high'
  },
  {
    id: 'assistant.email_summary', group: 'Assistant and knowledge', label: 'Assistant email summary',
    description: 'Summarise a connected email thread and open questions.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'assistant.email_draft', group: 'Assistant and knowledge', label: 'Assistant email draft',
    description: 'Draft an email reply for review before sending.', defaultReasoningEffort: 'medium'
  },
  {
    id: 'assistant.knowledge_answer', group: 'Assistant and knowledge', label: 'Assistant knowledge answer',
    description: 'Answer from selected saved Experience intelligence.', defaultReasoningEffort: 'high'
  },
  {
    id: 'assistant.work_product', group: 'Assistant and knowledge', label: 'Assistant work product',
    description: 'Prepare an evidence-backed executive work product.', defaultReasoningEffort: 'high'
  },
  {
    id: 'knowledge.answer', group: 'Assistant and knowledge', label: 'Knowledge and research answer',
    description: 'Answer a question from authorised knowledge.', defaultReasoningEffort: 'high'
  }
];

export const codexActionIds = new Set<CodexActionId>(codexActionCatalog.map((action) => action.id));
