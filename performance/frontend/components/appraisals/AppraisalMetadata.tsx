'use client';

import { Box, Typography } from '@mui/material';
import { AppraisalResultItem, appraisalCreatedAt, creationEvent, shortDate } from '@/lib/appraisal-results';

function timestamp(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : 'Not recorded';
}

export default function AppraisalMetadata({ appraisal }: { appraisal: AppraisalResultItem }) {
  const creator = appraisal.launchContext?.createdBy?.name || creationEvent(appraisal)?.performedBy?.name || 'Not recorded';
  const method = appraisal.migration?.legacyPerformanceReviewId ? 'Imported review'
    : appraisal.launchContext?.method === 'new_review' ? 'New review setup'
    : appraisal.launchContext?.method === 'existing_cycle' ? 'Existing review cycle' : 'Not recorded';
  const period = appraisal.cycleConfigurationSnapshot || {};
  const start = period.periodStart || appraisal.cycleId?.periodStart;
  const end = period.periodEnd || appraisal.cycleId?.periodEnd;
  const fields = [
    ['Created', timestamp(appraisalCreatedAt(appraisal))],
    ['Created by', creator],
    ['Started from', method],
    ['Assessment period', `${shortDate(start)} – ${shortDate(end)}`],
    ['Employee response due', appraisal.deadlines?.selfAssessmentDue ? shortDate(appraisal.deadlines.selfAssessmentDue) : 'Not set'],
    ['Reviewer response due', appraisal.deadlines?.managerReviewDue ? shortDate(appraisal.deadlines.managerReviewDue) : 'Not set'],
    ...(appraisal.deadlines?.discussionDue ? [['Discussion due', shortDate(appraisal.deadlines.discussionDue)]] : []),
    ...(appraisal.deadlines?.signOffDue ? [['Sign-off due', shortDate(appraisal.deadlines.signOffDue)]] : []),
    ...(period.sourceTemplate?.name ? [['Review template', period.sourceTemplate.name]] : []),
    ...(appraisal.updatedAt ? [['Last updated', timestamp(appraisal.updatedAt)]] : []),
    ...(appraisal.selfAssessment?.submittedAt ? [['Employee submitted', timestamp(appraisal.selfAssessment.submittedAt)]] : []),
    ...(appraisal.managerReview?.submittedAt ? [['Reviewer submitted', timestamp(appraisal.managerReview.submittedAt)]] : []),
    ...(appraisal.discussion?.scheduledDate ? [['Discussion scheduled', timestamp(appraisal.discussion.scheduledDate)]] : []),
    ...(appraisal.discussion?.completedDate ? [['Discussion completed', timestamp(appraisal.discussion.completedDate)]] : []),
    ...(appraisal.calibration?.calibratedAt ? [['Calibration completed', timestamp(appraisal.calibration.calibratedAt)]] : []),
    ...(appraisal.finalRating?.finalizedAt ? [['Finalized', timestamp(appraisal.finalRating.finalizedAt)]] : []),
    ...(appraisal.discussion?.employeeAcknowledgedAt ? [['Employee acknowledged', timestamp(appraisal.discussion.employeeAcknowledgedAt)]] : []),
  ];
  return <Box component="dl" aria-label="Appraisal dates and creation details" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
    {fields.map(([label, value]) => <Box key={label} sx={{ minWidth: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>)}
  </Box>;
}
