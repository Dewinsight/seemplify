'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, Divider, Paper, Stack, Typography } from '@mui/material';
import { Download, Print } from '@mui/icons-material';
import api from '@/lib/api';
import { downloadResultsCsv, shortDate } from '@/lib/appraisal-results';
import ResultPrintStyles from '@/components/appraisals/ResultPrintStyles';
import AppraisalDocuments from '@/components/appraisals/AppraisalDocuments';
import CompetencyReportSection from '@/components/competency/reports/CompetencyReportSection';
import { competencyRequest } from '@/lib/competency-api';
import { displayDate } from '@/components/competency/assessment/types';

interface ResultReport {
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
const labels: Record<string, string> = { achievements: 'Achievements', challenges: 'Challenges', learnings: 'Learning', improvements: 'Areas for improvement', goals: 'Next goals', strengths: 'Strengths', areasForImprovement: 'Areas for improvement', developmentNeeds: 'Development needs', agreedStrengths: 'Agreed strengths', agreedImprovements: 'Agreed improvements', developmentPlan: 'Development plan', careerAspirations: 'Career aspirations', supportNeeded: 'Support needed', nextSteps: 'Next steps' };
function Narrative({ title, values }: { title: string; values?: Record<string, string | string[]> }) {
  const entries = Object.entries(values || {}).filter(([key, value]) => key !== '_id' && value && (typeof value === 'string' || Array.isArray(value)));
  return <Box className="result-row"><Typography variant="h6" mb={1}>{title}</Typography>{entries.length ? <Stack spacing={1.5}>{entries.map(([key, value]) => <Box key={key}><Typography variant="subtitle2">{labels[key] || key.replace(/([A-Z])/g, ' $1')}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{Array.isArray(value) ? value.join('\n') : value}</Typography></Box>)}</Stack> : <Typography color="text.secondary">No narrative recorded.</Typography>}</Box>;
}

export default function AppraisalResultReportPage() {
  const params = useParams<{ appraisalId: string }>();
  const { data: competency, error: competencyFailure, isLoading: competencyLoading, isValidating: competencyChecking, mutate: retryCompetency } = useSWR<{ enabled: boolean }>('/competency/bootstrap', () => competencyRequest<{ enabled: boolean }>('GET', '/bootstrap'), { shouldRetryOnError: false });
  const { data: report, error: failure, isLoading: loading, mutate } = useSWR<ResultReport>(`/appraisals/${params.appraisalId}/report`, async (url: string) => (await api.get(url)).data.data, { shouldRetryOnError: false });
  const error = failure ? failure.response?.data?.error || 'Could not load this result report. Please try again.' : '';
  if (loading) return <CircularProgress aria-label="Loading result report" />;
  if (error || !report) return <Stack spacing={2}><Button component={Link} href="/appraisals?section=history">Back to history</Button><Alert severity="warning" action={<Button onClick={() => mutate()}>Retry</Button>}>{error || 'Result report unavailable.'}</Alert></Stack>;
  const rating = report.finalRating?.overall == null ? 'No final rating recorded' : `${report.finalRating.overall} / ${report.ratingScale?.max ?? 5}`;
  const csv = () => downloadResultsCsv([
    ['Appraisal result report', report.cycle.name], ['Employee', report.employee.name], ['Reviewer', report.manager.name], ['Period start', report.cycle.periodStart || ''], ['Period end', report.cycle.periodEnd || ''], ['Final result', rating], ['Rating label', report.finalRating?.ratingLabel || ''], ['Finalized', shortDate(report.finalRating?.finalizedAt)], ['Justification', report.finalRating?.justification || ''],
    ['Acknowledgement', report.status === 'employee_acknowledged' ? 'Recorded' : 'Awaiting employee acknowledgement'], ['Acknowledged at', shortDate(report.acknowledgedAt)],
    ...(report.documents || []).map(document => [`Supporting document: ${document.originalName}`, [document.fileType.toUpperCase(), document.category?.replaceAll('_', ' ')].filter(Boolean).join(' / ')]),
    ...Object.entries(report.employeeReflection || {}).map(([key, value]) => [`Employee: ${labels[key] || key}`, value]),
    ...Object.entries(report.managerSummary || {}).map(([key, value]) => [`Manager: ${labels[key] || key}`, value]),
    ...(report.managerFeedback ? [
      ['Assessed by', report.managerFeedback.author?.name || 'Not recorded'],
      ['Reviewer submitted', displayDate(report.managerFeedback.submittedAt)],
      ['Overall manager rating', String(report.managerFeedback.overallRating ?? 'Not rated')],
      ...report.managerFeedback.goals.flatMap(goal => [[`Goal reviewer feedback: ${goal.title}`, goal.comments || 'No comment recorded'], [`Goal verified completion: ${goal.title}`, String(goal.verifiedCompletion ?? 'Not rated')], [`Goal quality rating: ${goal.title}`, String(goal.qualityRating ?? 'Not rated')]])
    ] : []),
    ...Object.entries(report.discussion || {}).filter(([key]) => key !== '_id').map(([key, value]) => [`Discussion: ${labels[key] || key}`, Array.isArray(value) ? value.join('; ') : value]),
    ...report.goals.map((goal) => [`Goal: ${goal.title}`, goal.score == null ? 'Not rated' : `${goal.score}%`]),
    ...(report.competencies || []).flatMap((item) => [[`Competency: ${item.name} - employee rating`, String(item.selfRating ?? 'Not rated')], [`Competency: ${item.name} - manager rating`, String(item.managerRating ?? 'Not rated')], [`Competency: ${item.name} - manager comments`, item.managerComments]]),
    ...(report.answers || []).map((item) => [`${item.respondent}: ${item.section} - ${item.question}`, item.answer]),
  ], 'appraisal-result-report.csv');
  return <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
    <Stack className="no-print" direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={3}><Button component={Link} href="/appraisals?section=history">Back to history</Button><Button component={Link} href={`/appraisals/${report.id}`}>Open appraisal</Button><Button startIcon={<Download />} onClick={csv}>Download CSV</Button><Button variant="outlined" startIcon={<Print />} onClick={() => window.print()}>Print / save PDF</Button></Stack>
    <Paper className="appraisal-print" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
      <ResultPrintStyles />
      <Typography variant="h4" fontWeight={700}>Appraisal result report</Typography><Typography variant="h6" mt={1}>{report.cycle.name}</Typography><Typography color="text.secondary">{shortDate(report.cycle.periodStart)} – {shortDate(report.cycle.periodEnd)}</Typography>
      <Stack spacing={1} my={3}><Typography><strong>Employee:</strong> {report.employee.name}{report.employee.jobTitle ? ` · ${report.employee.jobTitle}` : ''}</Typography><Typography><strong>Reviewer:</strong> {report.manager.name || 'Not recorded'}</Typography><Typography><strong>Final result:</strong> {rating}{report.finalRating?.ratingLabel ? ` · ${report.finalRating.ratingLabel}` : ''}</Typography><Typography><strong>Finalized:</strong> {shortDate(report.finalRating?.finalizedAt)}</Typography><Typography><strong>Acknowledgement:</strong> {report.status === 'employee_acknowledged' ? `Recorded${report.acknowledgedAt ? ` on ${shortDate(report.acknowledgedAt)}` : ''}` : 'Awaiting employee acknowledgement'}</Typography></Stack>
      {report.finalRating?.justification && <Box mb={3}><Typography variant="h6">Final outcome</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{report.finalRating.justification}</Typography></Box>}
      <Box sx={{ '@media print': { '& button': { display: 'none' } } }}>
        <AppraisalDocuments appraisalId={report.id} documents={report.documents || []} readOnly onChanged={async () => undefined} />
      </Box>
      <Stack spacing={3} divider={<Divider />}>
        <Narrative title="Employee reflection" values={report.employeeReflection} />
        <Narrative title="Manager assessment" values={report.managerSummary} />
        {report.managerFeedback && <Box className="result-row"><Typography variant="h6" mb={1}>Reviewer submission</Typography><Typography><strong>Assessed by:</strong> {report.managerFeedback.author?.name || 'Not recorded'}</Typography><Typography><strong>Submitted:</strong> {displayDate(report.managerFeedback.submittedAt)}</Typography><Typography><strong>Overall manager rating:</strong> {report.managerFeedback.overallRating ?? 'Not rated'}</Typography>{report.managerFeedback.goals.length > 0 && <Stack spacing={2} mt={2}>{report.managerFeedback.goals.map((goal,index) => <Box key={goal.id || index}><Typography fontWeight={600}>{goal.title}</Typography><Typography variant="body2" color="text.secondary">Verified completion: {goal.verifiedCompletion == null ? 'Not rated' : `${goal.verifiedCompletion}%`} · Quality rating: {goal.qualityRating ?? 'Not rated'}</Typography><Typography sx={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere',mt:.5 }}>{goal.comments || 'No reviewer comment recorded.'}</Typography></Box>)}</Stack>}</Box>}
        <Narrative title="Discussion and agreed next steps" values={report.discussion} />
        <Box><Typography variant="h6" mb={1}>Goals reviewed</Typography>{report.goals.length ? report.goals.map((goal, index) => <Typography key={index}>{goal.title}: {goal.score == null ? 'Not rated' : `${Math.round(goal.score)}% achievement`}</Typography>) : <Typography color="text.secondary">No goal evidence was attached to this appraisal.</Typography>}</Box>
        {!!report.competencies?.length && <Box><Typography variant="h6" mb={1}>Competency assessment</Typography><Stack spacing={2}>{report.competencies.map((item, index) => <Box className="result-row" key={index}><Typography fontWeight={600}>{item.name}</Typography><Typography variant="body2">Employee rating: {item.selfRating ?? 'Not rated'} · Manager rating: {item.managerRating ?? 'Not rated'}</Typography>{item.managerComments && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.managerComments}</Typography>}</Box>)}</Stack></Box>}
        {!!report.answers?.length && <Box><Typography variant="h6" mb={1}>Review questions and submitted answers</Typography><Stack spacing={2}>{report.answers.map((item, index) => <Box className="result-row" key={index}><Typography variant="caption" color="text.secondary">{item.section} · {item.respondent === 'manager' ? 'Manager' : 'Employee'}</Typography><Typography fontWeight={600}>{item.question}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.answer || 'No answer recorded.'}</Typography></Box>)}</Stack></Box>}
      </Stack>
      {(competencyLoading || competencyFailure || competency?.enabled) && <Box mt={4}>
        <Divider sx={{ mb: 4 }} />
        {competencyLoading && !competency && <Stack role="status" aria-busy="true" direction="row" spacing={2} alignItems="center">
          <CircularProgress size={24} aria-hidden="true" /><Typography>Checking linked competency report…</Typography>
        </Stack>}
        {competencyFailure && <Alert severity="warning" aria-busy={competencyChecking} sx={{ mb: competency?.enabled ? 3 : 0 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Typography variant="body2">Could not check the linked competency report. Your appraisal result is still available.</Typography>
            <Button color="inherit" disabled={competencyChecking} sx={{ minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => { void retryCompetency().catch(() => undefined); }}>
              {competencyChecking ? 'Retrying…' : 'Retry competency report'}
            </Button>
          </Stack>
        </Alert>}
        {competency?.enabled && <CompetencyReportSection appraisalId={params.appraisalId} />}
      </Box>}
    </Paper>
  </Box>;
}
