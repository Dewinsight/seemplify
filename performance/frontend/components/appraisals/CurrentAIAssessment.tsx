'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import api from '@/lib/api';
type Source = { id: string; ref?: string; category: string; title: string; state: string; characters: number; includedCharacters: number };
type Assessment = {
  state: string; enabled: boolean; cancelled: boolean; content?: string; isCurrent?: boolean; generatedAt?: string; model?: string; reasoningEffort?: string;
  requestedModel: string; requestedReasoningEffort: string; phase: string; observedHash: string; errorCode?: string;
  coverage: { counts: Record<string, number>; sources: Source[]; gaps: string[]; excerpted: number };
  history: Array<{ number: number; generatedAt: string; phase: string; model: string; counts: Record<string, number> }>;
};
const names: Record<string, string> = { review: 'Review design and work period', employee_assessment: 'Employee assessment', manager_review: 'Manager review', review_answers: 'Configured questions and answers',
  ai_conversation: 'AI discussion and reflections', documents: 'Supporting documents', meetings: 'Meetings, transcripts and notes', personal_okrs: 'Individual OKRs', aligned_okrs: 'Team and organizational OKRs', cv: 'Uploaded CV', role_assessment: 'Role and competency assessment', role_evidence: 'Role assessment evidence' };
export default function CurrentAIAssessment({ appraisalId }: { appraisalId: string }) {
  const path = `/appraisals/${appraisalId}/current-assessment`;
  const { data, error, isLoading, mutate } = useSWR<Assessment>(path, async url => (await api.get(url)).data.data, { refreshInterval: 15000, shouldRetryOnError: false });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [coverageOpen, setCoverageOpen] = useState(true);
  const initiated = useRef('');
  const act = async (input: { pause?: boolean; force?: boolean } = {}) => {
    setBusy(true); setFailure('');
    try { await api.post(path, input); await mutate(); }
    catch (error) { setFailure((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'The assessment could not be queued. Your appraisal evidence is still saved.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!data || data.cancelled || busy || !['not_generated', 'stale'].includes(data.state) || (data.state === 'stale' && !data.enabled)) return;
    const key = `${appraisalId}:${data.observedHash}`;
    if (initiated.current === key) return;
    initiated.current = key;
    void act();
  }, [appraisalId, data, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isLoading) return <Stack direction="row" gap={2} role="status"><CircularProgress size={24} /><Typography>Checking assessment evidence…</Typography></Stack>;
  if (error || !data) return <Alert severity="warning" action={<Button onClick={() => void mutate()}>Retry</Button>}>The current AI assessment could not be loaded.</Alert>;
  const working = data.state === 'pending' || data.state === 'processing';
  const modelUnavailable = data.errorCode === 'ASSESSMENT_MODEL_UNAVAILABLE' || data.errorCode === 'ASSESSMENT_MODEL_MISMATCH';
  return <Stack spacing={2.5}>
    <Box><Typography component="h2" variant="h5" fontWeight={600}>Current AI assessment</Typography>
      <Typography color="text.secondary" mt={1}>A developing evidence review for this appraisal, using your own ChatGPT connection. It updates as saved assessments, documents, OKRs and meeting evidence change.</Typography>
      <Typography variant="body2" color="text.secondary" mt={1}>Appraisal phase: {data.phase.replaceAll('_', ' ')} · {data.model || data.requestedModel} · {data.reasoningEffort || data.requestedReasoningEffort} reasoning</Typography>
      {data.generatedAt && <Typography variant="body2" color="text.secondary">Last completed analysis: {new Date(data.generatedAt).toLocaleString()}</Typography>}
    </Box>
    <Alert severity="info">This is an AI assessment draft. CV claims, employee statements, manager judgments and measured outcomes are compared as distinct sources. The reviewer decides the final outcome. This view uses only evidence your account can access.</Alert>
    {failure && <Alert severity="error">{failure}</Alert>}
    {working && <Alert severity="info" role="status">{data.state === 'processing' ? 'The AI is reviewing the current evidence. Deep analysis can take several minutes.' : 'The next assessment update is queued. Frequent saves are combined into one review to avoid duplicate AI work.'} This view refreshes automatically.</Alert>}
    {data.state === 'stale' && <Alert severity="info" role="status">{data.content ? 'New evidence is available. The last completed assessment remains below while the next update is prepared.' : 'Saved evidence has changed. The previous analysis is hidden until it has been checked against the current sources.'}</Alert>}
    {data.content && !data.isCurrent && data.state !== 'stale' && <Typography variant="body2" color="text.secondary">The assessment below covers the evidence from its last completed update. New evidence is being reviewed.</Typography>}
    {data.state === 'failed' && <Alert severity="warning">{modelUnavailable ? 'GPT-6.1 Sol with maximum reasoning is not currently available through this connected account. Check the gateway model catalogue or reconnect, then retry. An older model will not be substituted silently.' : 'The assessment could not be generated. Check your ChatGPT connection and content-sharing settings, then retry. Your appraisal is saved.'}</Alert>}
    {data.state === 'paused' && <Alert severity="info">Automatic updates are paused. Resume to review newly saved evidence.</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      {!data.cancelled && <Button variant="outlined" disabled={busy || working} onClick={() => void act({ force: true })}>{busy ? 'Updating…' : data.state === 'paused' ? 'Resume assessment' : 'Update assessment now'}</Button>}
      {!data.cancelled && data.enabled && <Button disabled={busy} onClick={() => void act({ pause: true })}>Pause automatic updates</Button>}
      <Button component={Link} href="/ai-account">My ChatGPT connection</Button>
    </Stack>
    <Accordion variant="outlined" expanded={coverageOpen} onChange={(_, expanded) => setCoverageOpen(expanded)}>
      <AccordionSummary expandIcon={<ExpandMore />}><Typography fontWeight={600}>Evidence coverage · {data.coverage.sources.length} sources</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">Every listed source is considered. Missing or unprocessed evidence is shown below. Long sources are labelled when only excerpts fit in the assessment.</Typography>
        {Object.entries(names).map(([category, title]) => {
          const sources = data.coverage.sources.filter(source => source.category === category);
          return <Box key={category}><Typography fontWeight={600}>{title} · {sources.length ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : 'Not available'}</Typography>
            {sources.map(source => <Typography key={source.id} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{source.ref ? `[${source.ref}] ` : ''}{source.title} · {source.state.replaceAll('_', ' ')}{source.includedCharacters < source.characters ? ' · excerpted' : ''}</Typography>)}
          </Box>;
        })}
        {!!data.coverage.gaps.length && <Box><Typography fontWeight={600}>Evidence gaps</Typography><Box component="ul" sx={{ pl: 2.5 }}>{data.coverage.gaps.map(gap => <Typography component="li" key={gap} variant="body2">{gap}</Typography>)}</Box></Box>}
      </Stack></AccordionDetails>
    </Accordion>
    {data.content && <Box component="section" aria-label="Current assessment analysis" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2.5 }}><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}>{data.content}</Typography></Box>}
    {!!data.history.length && <Accordion variant="outlined"><AccordionSummary expandIcon={<ExpandMore />}>Assessment update history</AccordionSummary><AccordionDetails><Stack spacing={1.5}>{[...data.history].reverse().map(item => <Box key={item.number}><Typography fontWeight={600}>Update {item.number} · {new Date(item.generatedAt).toLocaleString()}</Typography><Typography variant="body2" color="text.secondary">{item.phase.replaceAll('_', ' ')} · {item.model} · {Object.values(item.counts || {}).reduce((sum, count) => sum + count, 0)} sources considered</Typography></Box>)}</Stack><Typography variant="caption" color="text.secondary" display="block" mt={2}>The latest ten updates are listed. Historical text is not redisplayed after evidence changes or is withdrawn.</Typography></AccordionDetails></Accordion>}
  </Stack>;
}
