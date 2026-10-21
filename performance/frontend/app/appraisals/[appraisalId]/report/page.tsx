'use client';

import useSWR from 'swr';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Divider, Paper, Stack, Typography } from '@mui/material';
import { Download, ExpandMore, Print } from '@mui/icons-material';
import api from '@/lib/api';
import { downloadResultsCsv, shortDate } from '@/lib/appraisal-results';
import ResultPrintStyles from '@/components/appraisals/ResultPrintStyles';
import AppraisalDocuments from '@/components/appraisals/AppraisalDocuments';
import CompetencyReportSection from '@/components/competency/reports/CompetencyReportSection';
import { competencyRequest } from '@/lib/competency-api';
import { displayDate } from '@/components/competency/assessment/types';
import FinalAIReport from '@/components/appraisals/FinalAIReport';
import ResultAnalytics from '@/components/appraisals/ResultAnalytics';
import { scoreLabel, type ResultReport } from '@/lib/appraisal-report';

const labels: Record<string, string> = { achievements: 'Achievements', challenges: 'Challenges', learnings: 'Learning', improvements: 'Areas for improvement', goals: 'Next goals', strengths: 'Strengths', areasForImprovement: 'Areas for improvement', developmentNeeds: 'Development needs', agreedStrengths: 'Agreed strengths', agreedImprovements: 'Agreed improvements', developmentPlan: 'Development plan', careerAspirations: 'Career aspirations', supportNeeded: 'Support needed', nextSteps: 'Next steps' };
function Narrative({ title, values }: { title: string; values?: Record<string, string | string[]> }) {
  const entries = Object.entries(values || {}).filter(([key, value]) => key !== '_id' && value && (typeof value === 'string' || Array.isArray(value)));
  return <Box className="result-row"><Typography variant="h6" mb={1}>{title}</Typography>{entries.length ? <Stack spacing={1.5}>{entries.map(([key, value]) => <Box key={key}><Typography variant="subtitle2">{labels[key] || key.replace(/([A-Z])/g, ' $1')}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{Array.isArray(value) ? value.join('\n') : value}</Typography></Box>)}</Stack> : <Typography color="text.secondary">No narrative recorded.</Typography>}</Box>;
}

export default function AppraisalResultReportPage() {
  const params = useParams<{ appraisalId: string }>();
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const { data: competency, error: competencyFailure, isLoading: competencyLoading, isValidating: competencyChecking, mutate: retryCompetency } = useSWR<{ enabled: boolean }>('/competency/bootstrap', () => competencyRequest<{ enabled: boolean }>('GET', '/bootstrap'), { shouldRetryOnError: false });
  const { data: report, error: failure, isLoading: loading, mutate } = useSWR<ResultReport>(`/appraisals/${params.appraisalId}/report`, async (url: string) => (await api.get(url)).data.data, { shouldRetryOnError: false, refreshInterval: data => ['pending', 'processing'].includes(data?.aiReport?.state || '') || data?.aiReport?.retryScheduled ? 5000 : 0 });
  const error = failure ? failure.response?.data?.error || 'Could not load this result report. Please try again.' : '';
  if (loading) return <CircularProgress aria-label="Loading result report" />;
  if (error || !report) return <Stack spacing={2}><Button component={Link} href="/appraisals?section=history">Back to history</Button><Alert severity="warning" action={<Button onClick={() => mutate()}>Retry</Button>}>{error || 'Result report unavailable.'}</Alert></Stack>;
  const rating = report.finalRating?.overall == null ? 'No final rating recorded' : scoreLabel(report.finalRating.overall, report.ratingScale?.max);
  const openSources = () => { setSourcesExpanded(true); document.getElementById('final-report-sources-heading')?.focus(); document.getElementById('final-report-sources')?.scrollIntoView({ block: 'start' }); };
  const readAnalysis = () => { document.getElementById('final-ai-report-heading')?.focus(); document.getElementById('final-ai-report-heading')?.scrollIntoView({ block: 'start' }); };
  const csv = () => downloadResultsCsv([
    ['Appraisal result report', report.cycle.name], ['Employee', report.employee.name], ['Reviewer', report.manager.name], ['Period start', report.cycle.periodStart || ''], ['Period end', report.cycle.periodEnd || ''], ['Final result', rating], ['Rating label', report.finalRating?.ratingLabel || ''], ['Finalized', shortDate(report.finalRating?.finalizedAt)], ['Justification', report.finalRating?.justification || ''],
    ['Acknowledgement', report.status === 'employee_acknowledged' ? 'Recorded' : 'Awaiting employee acknowledgement'], ['Acknowledged at', shortDate(report.acknowledgedAt)],
    ['AI appraisal report', report.aiReport?.state === 'ready' ? report.aiReport.content || '' : `Status: ${report.aiReport?.state || 'not generated'}`],
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
    ...(report.roleAssessment?.state === 'published' ? [
      ['Role assessment', report.roleAssessment.role.name], ['Role result version', String(report.roleAssessment.resultVersion)],
      ['Role competency score (0–100)', scoreLabel(report.roleAssessment.overallScore, 100)], ['Role classification', report.roleAssessment.classification],
      ...report.roleAssessment.criteria.flatMap(item => [[`Role criterion: ${item.name} - expected native level`, item.expected || 'Not recorded'], [`Role criterion: ${item.name} - observed native level`, item.observed || 'Not rated'], [`Role criterion: ${item.name} - normalized score (0–100)`, scoreLabel(item.score, 100)], [`Role criterion: ${item.name} - assessor rationale`, item.rationale]])
    ] : []),
    ...(report.answers || []).map((item) => [`${item.respondent}: ${item.section} - ${item.question}`, item.answer]),
  ], 'appraisal-result-report.csv');
  return <Box sx={{ maxWidth: 1240, mx: 'auto', overflowWrap: 'anywhere' }}>
    <Stack className="no-print" direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={3}><Button component={Link} href="/appraisals?section=history">Back to history</Button><Button component={Link} href={`/appraisals/${report.id}`}>Open appraisal</Button><Button startIcon={<Download />} onClick={csv}>Download CSV</Button><Button variant="outlined" startIcon={<Print />} onClick={() => window.print()}>Print / save PDF</Button></Stack>
    <Paper className="appraisal-print appraisal-result-print" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
      <ResultPrintStyles />
      <Typography component="h1" variant="h4" fontWeight={650}>Appraisal result report</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mt={1.5}>
        <Box><Typography variant="h6">{report.employee.name}</Typography><Typography variant="body2" color="text.secondary">{[report.employee.jobTitle, report.employee.department].filter(Boolean).join(' · ')}</Typography><Typography variant="body2" color="text.secondary" mt={.5}>{report.cycle.name} · {shortDate(report.cycle.periodStart)} – {shortDate(report.cycle.periodEnd)}</Typography></Box>
        <Box><Typography variant="body2">Reviewer: {report.manager.name || 'Not recorded'}</Typography><Typography variant="body2" color="text.secondary">Finalized: {shortDate(report.finalRating?.finalizedAt)}</Typography><Typography variant="body2" color="text.secondary">Acknowledgement: {report.status === 'employee_acknowledged' ? `Recorded${report.acknowledgedAt ? ` on ${shortDate(report.acknowledgedAt)}` : ''}` : 'Awaiting employee acknowledgement'}</Typography></Box>
      </Stack>
      <ResultAnalytics report={report} onSources={openSources} onAnalysis={readAnalysis} />
      <FinalAIReport appraisalId={report.id} report={report.aiReport} canGenerate={report.canGenerateAIReport} onQueued={async () => { await mutate(); }} sourcesExpanded={sourcesExpanded} onSourcesExpanded={setSourcesExpanded} />
      <Accordion className="report-record-section" variant="outlined" sx={{ mt: 3, boxShadow: 'none' }}><AccordionSummary expandIcon={<ExpandMore />} id="review-record-heading" aria-controls="review-record-content"><Box><Typography component="h2" variant="h6">Review record</Typography><Typography variant="body2" color="text.secondary">Submitted reflections, reviewer feedback, documents and answers</Typography></Box></AccordionSummary><AccordionDetails>
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
      </AccordionDetails></Accordion>
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
        {competency?.enabled && report.roleAssessment?.state === 'published' && <CompetencyReportSection assessmentId={report.roleAssessment.assessmentId} resultVersion={report.roleAssessment.resultVersion} />}
        {competency?.enabled && !report.roleAssessment && <CompetencyReportSection appraisalId={params.appraisalId} />}
      </Box>}
    </Paper>
  </Box>;
}
