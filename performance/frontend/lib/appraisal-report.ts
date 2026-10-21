import type { FinalAIReportData } from '@/components/appraisals/FinalAIReport';

/** The published report DTO. Measures come from saved review fields, never AI prose. */
export interface ResultReport {
  roleAssessment?: RoleAssessmentResult | { state: 'unavailable' } | null;
  aiReport?: FinalAIReportData; canGenerateAIReport?: boolean;
  id: string; status: string; employee: { name: string; jobTitle?: string; department?: string }; manager: { name: string };
  cycle: { name: string; periodStart?: string; periodEnd?: string }; ratingScale: { min?: number; max?: number };
  finalRating: { overall: number | null; ratingLabel?: string; justification?: string; finalizedAt?: string };
  employeeReflection?: Record<string, string>; managerSummary?: Record<string, string>; discussion?: Record<string, string | string[]>;
  documents: Array<{ _id: string; originalName: string; fileType: string; fileSize?: number; category?: string; status: string }>;
  acknowledgedAt?: string; goals: Array<{ title: string; score: number | null }>;
  competencies?: Array<{ name: string; selfRating: number | null; managerRating: number | null; managerComments: string }>;
  answers?: Array<{ section: string; question: string; respondent: string; answer: string }>;
  managerFeedback?: { author?: { userId: string; name: string } | null; submittedAt?: string; overallRating?: number | null; goals: Array<{ id?: string; title: string; comments: string; verifiedCompletion?: number | null; qualityRating?: number | null }> } | null;
}

export interface RoleAssessmentResult {
  state: 'published'; assessmentId: string; resultVersion: number; reportHash?: string;
  cycleId: string; cycleVersion?: number; occurrenceKey?: string; publishedAt?: string;
  role: { name: string; version?: number }; overallScore: number | null; classification: string;
  coverage: { assessed: number; selected: number };
  sources: Array<{ type: string; score: number | null; weight: number | null }>;
  criteria: Array<{ id: string; name: string; sourceType: string; sourceName?: string; status: string;
    expected: string | null; observed: string | null; score: number | null; weight: number | null; rationale: string }>;
}

export const recordedNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function recordedScale(scale: ResultReport['ratingScale']) {
  return recordedNumber(scale?.min) && recordedNumber(scale?.max) && scale.max > scale.min
    ? { min: scale.min, max: scale.max } : null;
}
export function scoreLabel(value: unknown, max?: number) {
  return recordedNumber(value) ? `${value}${recordedNumber(max) ? ` / ${max}` : ''}` : value == null ? 'Not rated' : 'Invalid recorded value';
}
