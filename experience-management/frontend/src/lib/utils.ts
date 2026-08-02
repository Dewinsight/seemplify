import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

export function formatDuration(value?: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

export function humanizeActivity(value: string) {
  const names: Record<string, string> = {
    'survey.generate': 'Survey generation', 'survey.improve': 'Survey quality review', 'survey.translate': 'Survey translation',
    'response.analyze': 'Response analysis', 'insights.generate': 'Insight generation', 'analyst.chat': 'Analyst chat', 'report.generate': 'Executive report',
    'social.analyze': 'Social listening analysis', 'journey.generate': 'Journey generation', 'journey.optimize': 'Journey optimization',
    'assistant.email_summary': 'Assistant email summary', 'assistant.email_draft': 'Assistant email draft',
    'assistant.knowledge_answer': 'Assistant knowledge answer'
  };
  return names[value] || value.replaceAll('.', ' ').replaceAll('_', ' ');
}
