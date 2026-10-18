export interface AppraisalResultItem {
  _id: string;
  status: string;
  employee: { name: string; userId?: string };
  manager: { name: string };
  createdAt?: string;
  updatedAt?: string;
  launchContext?: { method?: string; createdBy?: { userId?: string; name?: string } };
  auditLog?: Array<{ action?: string; performedBy?: { name?: string }; timestamp?: string }>;
  migration?: { legacyPerformanceReviewId?: string };
  deadlines?: { selfAssessmentDue?: string; managerReviewDue?: string; discussionDue?: string; signOffDue?: string };
  cycleId?: { name?: string; periodStart?: string; periodEnd?: string; ratingScale?: { min?: number; max?: number } };
  cycleConfigurationSnapshot?: { cycleName?: string; periodStart?: string; periodEnd?: string; sourceTemplate?: { name?: string }; ratingScale?: { min?: number; max?: number }; appraisalFlow?: { steps: Array<{ id: string; type: string; label: string }> } };
  completedMeetingSteps?: string[];
  selfAssessment?: { submittedAt?: string };
  managerReview?: { submittedAt?: string };
  discussion?: { scheduledDate?: string; completedDate?: string; employeeAcknowledgedAt?: string };
  calibration?: { calibratedAt?: string };
  finalRating?: { overall?: number | null; ratingLabel?: string; finalizedAt?: string };
}

export const creationEvent = (item: AppraisalResultItem) => item.auditLog?.find(event => event.action === 'appraisal_created');
export const appraisalCreatedAt = (item: AppraisalResultItem) => item.createdAt || creationEvent(item)?.timestamp;
export function newestAppraisalsFirst<T extends AppraisalResultItem>(items: T[]): T[] {
  const timestamp = (item: T) => Date.parse(appraisalCreatedAt(item) || '') || 0;
  return [...items].sort((a, b) => timestamp(b) - timestamp(a) || b._id.localeCompare(a._id));
}

export function isAppraisalStepComplete(item: AppraisalResultItem, step: { id: string; type: string }) {
  return ({ selfAssessment: !!item.selfAssessment?.submittedAt, managerReview: !!item.managerReview?.submittedAt,
    discussion: !!item.discussion?.completedDate, calibration: !!item.calibration?.calibratedAt,
    finalReview: !!item.finalRating?.finalizedAt, acknowledgement: !!item.discussion?.employeeAcknowledgedAt,
    oneOnOne: (item.completedMeetingSteps || []).includes(step.id) } as Record<string, boolean>)[step.type] || false;
}

export const isFinishedAppraisal = (status: string) => ['completed', 'employee_acknowledged', 'cancelled'].includes(status);
export const hasPublishedResult = (status: string) => ['completed', 'employee_acknowledged'].includes(status);
export const resultCycleName = (item: AppraisalResultItem) => item.cycleConfigurationSnapshot?.cycleName || item.cycleId?.name || 'Appraisal';
export const resultPeriodEnd = (item: AppraisalResultItem) => item.cycleConfigurationSnapshot?.periodEnd || item.cycleId?.periodEnd || item.finalRating?.finalizedAt || '';
export function resultRating(item: AppraisalResultItem) {
  if (!hasPublishedResult(item.status) || typeof item.finalRating?.overall !== 'number' || !Number.isFinite(item.finalRating.overall)) return 'No final rating recorded';
  const scale = item.cycleConfigurationSnapshot?.ratingScale || item.cycleId?.ratingScale;
  return `${item.finalRating.overall} / ${scale?.max ?? 5}`;
}
export function shortDate(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not recorded';
}
export function downloadResultsCsv(rows: string[][], name: string) {
  const csv = rows.map((row) => row.map((value) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
