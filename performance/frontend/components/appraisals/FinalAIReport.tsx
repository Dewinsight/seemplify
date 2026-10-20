'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Stack, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import api from '@/lib/api';
import ManualMeetingTranscript from './ManualMeetingTranscript';
export interface FinalAIReportData {
  state: string; content?: string; generatedAt?: string; model?: string; errorCode?: string; retryScheduled?: boolean;
  coverage?: { meetings: number; transcripts: number; missingTranscripts: string[]; missingTranscriptMeetings?: Array<{ id: string; title: string }>; documents: number; pendingDocuments: number; roleResults: number; excerptedCategories: string[];
    sources?: Array<{ id: string; ref: string; title: string; state: string }>; gaps?: string[] };
}
export default function FinalAIReport({ appraisalId, report, canGenerate, onQueued }: { appraisalId: string; report?: FinalAIReportData; canGenerate?: boolean; onQueued: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = report?.state === 'pending' || report?.state === 'processing';
  const generate = async () => {
    setBusy(true); setError('');
    try { await api.post(`/appraisals/${appraisalId}/report/ai`); await onQueued(); }
    catch (failure) { setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'The report could not be queued. Please retry.'); }
    finally { setBusy(false); }
  };
  return <Box component="section" aria-labelledby="final-ai-report-heading" mb={3}>
    <Typography id="final-ai-report-heading" variant="h6" mb={1}>AI appraisal report</Typography>
    <Typography variant="body2" color="text.secondary" mb={2}>A combined report from submitted assessments, OKRs, competencies, shared evidence and meeting transcripts. The published rating remains the human reviewer’s decision.</Typography>
    {report?.state === 'ready' && report.content ? <>
      <Typography variant="caption" color="text.secondary">Generated {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''} · {report.model || 'ChatGPT'}. Review the report against the source evidence.</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 2 }}>{report.content}</Typography>
    </> : <Alert severity={report?.state === 'failed' ? 'warning' : 'info'} role="status">
      {pending ? 'The final AI report is queued or being generated. This page checks for the completed report automatically.'
        : report?.state === 'stale' ? 'Meeting evidence has changed. The previous report is hidden until it is regenerated using the current evidence.'
        : report?.state === 'failed' ? `${['ASSESSMENT_MODEL_UNAVAILABLE', 'ASSESSMENT_MODEL_MISMATCH'].includes(report.errorCode || '') ? 'GPT-6.1 Sol with maximum reasoning is unavailable through this connection. Check the gateway model catalogue or reconnect, then retry; an older model is not substituted.' : 'The report could not be generated. The published appraisal is saved. Check your personal ChatGPT connection, then retry.'}${report.retryScheduled ? ' An automatic retry is also scheduled.' : ''}`
        : 'The combined AI report has not been generated yet.'}
    </Alert>}
    {!!report?.coverage?.missingTranscripts?.length && <Alert severity="info" sx={{ mt: 2 }}>Transcript unavailable for: {report.coverage.missingTranscripts.join(', ')}. The report will identify this gap; agreed meeting notes are still included.</Alert>}
    {canGenerate && !!report?.coverage?.missingTranscriptMeetings?.length && <Stack className="no-print" spacing={2} mt={2}>
      <Typography variant="body2" color="text.secondary">You can add a missing transcript after finalisation. It supplements the evidence and refreshes the AI report; the published rating stays the same.</Typography>
      {report.coverage.missingTranscriptMeetings.map(meeting => <Box key={meeting.id}><Typography fontWeight={600} mb={1}>{meeting.title}</Typography><ManualMeetingTranscript base={`/appraisals/${appraisalId}/meetings/${meeting.id}`} onSaved={onQueued} /></Box>)}
    </Stack>}
    {!!report?.coverage?.pendingDocuments && <Typography variant="body2" color="text.secondary" mt={1}>Some shared documents are still awaiting text extraction.</Typography>}
    {!!report?.coverage?.excerptedCategories?.length && <Typography variant="body2" color="text.secondary" mt={1}>Long sources were excerpted for: {report.coverage.excerptedCategories.join(', ')}.</Typography>}
    {!!report?.coverage?.sources?.length && <Accordion variant="outlined" sx={{ mt: 2 }}><AccordionSummary expandIcon={<ExpandMore />}>Report sources and evidence gaps</AccordionSummary><AccordionDetails><Stack spacing={1}>{report.coverage.sources.map(source => <Typography key={source.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>[{source.ref}] {source.title} · {source.state.replaceAll('_', ' ')}</Typography>)}{report.coverage.gaps?.map(gap => <Typography key={gap} variant="body2" color="text.secondary">{gap}</Typography>)}</Stack></AccordionDetails></Accordion>}
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    {canGenerate && <Stack className="no-print" direction={{ xs: 'column', sm: 'row' }} spacing={1} mt={2}>
      <Button variant="outlined" disabled={busy || pending} onClick={() => void generate()}>{busy ? 'Queueing…' : report?.state === 'ready' ? 'Regenerate with my ChatGPT account' : 'Generate with my ChatGPT account'}</Button>
      <Button component={Link} href="/ai-account">My ChatGPT connection</Button>
    </Stack>}
  </Box>;
}
