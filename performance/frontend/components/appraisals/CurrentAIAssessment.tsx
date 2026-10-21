'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Stack, Tab, Tabs, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import api from '@/lib/api';
import { analysisSections, AssessmentAnalytics, AssessmentSource, SourcePreview } from '@/lib/assessment-presentation';
import AssessmentNarrative from './AssessmentNarrative';
import { EvidenceChart, GoalChart, RatingChart } from './AssessmentCharts';
import { SourceLibrary, SourceReader } from './AssessmentSources';

type Assessment = {
  state: string; enabled: boolean; cancelled: boolean; content?: string; isCurrent?: boolean; generatedAt?: string; model?: string; reasoningEffort?: string;
  requestedModel: string; requestedReasoningEffort: string; phase: string; observedHash: string; errorCode?: string;
  coverage: { counts: Record<string, number>; sources: AssessmentSource[]; gaps: string[]; excerpted: number };
  analytics?: AssessmentAnalytics; sourcePreviews?: SourcePreview[];
  history: Array<{ number: number; generatedAt: string; phase: string; model: string; counts: Record<string, number> }>;
};

export default function CurrentAIAssessment({ appraisalId }: { appraisalId: string }) {
  const path = `/appraisals/${appraisalId}/current-assessment`;
  const { data, error, isLoading, mutate } = useSWR<Assessment>(path, async url => (await api.get(url)).data.data, { refreshInterval: 15000, shouldRetryOnError: false });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [tab, setTab] = useState(0), [expanded, setExpanded] = useState('');
  const [sourceSelection, setSourceSelection] = useState<{ refs: string[]; ids: string[] } | null>(null);
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
  const sections = analysisSections(data.content || '');
  const summary = sections.find(section => section.key === 'summary') || sections[0];
  const questions = sections.find(section => section.key === 'questions');
  const actions = sections.find(section => section.key === 'actions');
  const sources = data.coverage.sources, gaps = data.coverage.gaps;
  // Pin citations to source identities so a withdrawn/renumbered reference can
  // never silently replace an already open source with a different document.
  const openSources = (refs: string[]) => setSourceSelection({ refs, ids: sources.filter(source => source.ref && refs.includes(source.ref)).map(source => source.id) });
  const readSection = (key: string) => { setExpanded(key); setTab(1); };
  const status = data.state === 'paused' ? 'Updates paused' : working ? 'Updating' : data.state === 'failed' ? 'Update failed' : data.isCurrent ? 'Up to date' : data.state === 'not_generated' ? 'Preparing analysis' : 'Evidence changed';
  const firstItems = (body: string, count: number) => body.split(/\n(?=\s*(?:[-*•]|\d+[.)])\s)|\n\s*\n/).filter(item => item.trim()).slice(0, count).join('\n\n');
  return <Stack spacing={2.5}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
      <Box><Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap"><Typography component="h2" variant="h5">Current AI assessment</Typography><Chip size="small" variant="outlined" label={status} /></Stack>
        <Typography variant="body2" color="text.secondary" mt={.75}>{data.phase.replaceAll('_', ' ')}{data.generatedAt ? ` · Updated ${new Date(data.generatedAt).toLocaleString()}` : ' · Preparing the first analysis'}</Typography>
      </Box>
      {!data.cancelled && <Button variant="outlined" disabled={busy || working} onClick={() => void act({ force: true })} sx={{ alignSelf: 'flex-start' }}>{busy ? 'Updating…' : data.state === 'paused' ? 'Resume assessment' : 'Update assessment now'}</Button>}
    </Stack>
    <Typography variant="body2" color="text.secondary">AI draft for review. The reviewer decides the final outcome.</Typography>
    {failure && <Alert severity="error">{failure}</Alert>}
    {working && <Alert severity="info" role="status">{data.state === 'processing' ? 'The AI is reviewing the current evidence. Deep analysis can take several minutes.' : 'The next assessment update is queued.'} This view refreshes automatically.</Alert>}
    {data.state === 'stale' && <Alert severity="info" role="status">{data.content ? 'New evidence is available. The last completed analysis remains below while the next update is prepared.' : 'Evidence has changed. The earlier analysis is hidden until it has been checked against the current sources.'}</Alert>}
    {data.content && !data.isCurrent && data.state !== 'stale' && <Typography variant="body2" color="text.secondary">Analysis reflects the last completed update. Charts show the evidence currently saved.</Typography>}
    {data.state === 'failed' && <Alert severity="warning" action={<Button component={Link} href="/ai-account" color="inherit">Check connection</Button>}>{modelUnavailable ? 'GPT-6.1 Sol with maximum reasoning is not currently available through this connected account. Check your ChatGPT connection, then retry. An older model will not be substituted silently.' : 'The assessment could not be generated. Check your ChatGPT connection and content-sharing settings, then retry. Your appraisal is saved.'}</Alert>}
    {data.state === 'paused' && <Alert severity="info">Automatic updates are paused. Resume to review newly saved evidence.</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="AI assessment views" variant="scrollable" scrollButtons="auto">
      {['Overview', 'Detailed analysis', `Sources (${sources.length})`].map((label, index) => <Tab key={index} label={label} id={`assessment-view-${index}`} aria-controls={`assessment-panel-${index}`} />)}
    </Tabs>
    <Box component="section" aria-label="Current assessment analysis">
      <Box role="tabpanel" id="assessment-panel-0" aria-labelledby="assessment-view-0" hidden={tab !== 0}>
        {tab === 0 && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' }, gap: { xs: 3, md: 4 }, gridTemplateAreas: {
          xs: `"summary" "ratings" "goals" "evidence"${questions ? ' "questions"' : ''}${actions ? ' "actions"' : ''}`,
          md: `"summary evidence" "ratings goals"${questions && actions ? ' "questions actions"' : questions ? ' "questions questions"' : actions ? ' "actions actions"' : ''}`
        } }}>
            <Box minWidth={0} sx={{ gridArea: 'summary' }}><Typography component="h3" variant="h6" mb={1.5}>Assessment summary</Typography>
              {summary ? <><Box sx={{ '& .assessment-passage': { display: '-webkit-box', WebkitLineClamp: 7, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }}><AssessmentNarrative content={summary.body.split(/\n\s*\n/).slice(0, 2).join('\n\n')} onSources={openSources} /></Box><Button onClick={() => readSection(summary.key)} sx={{ mt: 1, ml: -1 }}>Read full assessment</Button></> : <Typography color="text.secondary">The analysis will appear here after the first update. Saved ratings, goals and evidence are shown below.</Typography>}
              {!!gaps.length && <Box mt={2.5} sx={{ borderLeft: '3px solid', borderColor: 'warning.main', pl: 2 }}><Typography component="h4" variant="subtitle2">Evidence to follow up</Typography><Box component="ul" sx={{ pl: 2, my: .75 }}>{gaps.slice(0, 2).map(gap => <Typography component="li" variant="body2" key={gap}>{gap}</Typography>)}</Box><Button size="small" onClick={() => setTab(2)}>View all evidence gaps ({gaps.length})</Button></Box>}
            </Box>
            <Box sx={{ gridArea: 'evidence', minWidth: 0, pl: { md: 4 }, pt: { xs: 3, md: 0 }, borderLeft: { md: '1px solid' }, borderTop: { xs: '1px solid', md: 'none' }, borderColor: 'divider' }}><EvidenceChart sources={sources} gaps={gaps} onSources={() => setTab(2)} /></Box>
            <Box sx={{ gridArea: 'ratings', minWidth: 0, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}><RatingChart analytics={data.analytics} onSources={openSources} /></Box>
            <Box sx={{ gridArea: 'goals', minWidth: 0, pl: { md: 4 }, pt: 3, borderLeft: { md: '1px solid' }, borderTop: '1px solid', borderColor: 'divider' }}><GoalChart analytics={data.analytics} onSources={openSources} /></Box>
            {[questions, actions].filter(Boolean).map(section => <Box key={section!.key} sx={{ gridArea: section!.key === 'questions' ? 'questions' : 'actions', minWidth: 0, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}><Typography component="h3" variant="h6" mb={1.5}>{section!.key === 'questions' ? 'Questions to resolve' : 'Next development actions'}</Typography><Box sx={{ '& .assessment-passage': { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }}><AssessmentNarrative content={firstItems(section!.body, 2)} onSources={openSources} /></Box><Button onClick={() => readSection(section!.key)} sx={{ mt: 1, ml: -1 }}>View all {section!.key === 'questions' ? 'questions' : 'development actions'}</Button></Box>)}
        </Box>}
      </Box>
      <Box role="tabpanel" id="assessment-panel-1" aria-labelledby="assessment-view-1" hidden={tab !== 1}>
        {tab === 1 && <Stack gap={2}>
          <Typography variant="body2" color="text.secondary">Explore each finding and open its sources to compare the evidence.</Typography>
          {!sections.length && <Typography color="text.secondary">No completed analysis is available yet.</Typography>}
          {sections.map((section, index) => <Accordion key={`${section.key}-${index}`} variant="outlined" expanded={expanded === `${section.key}-${index}` || expanded === section.key || (!expanded && index === 0)} onChange={(_, open) => setExpanded(open ? `${section.key}-${index}` : 'none')}>
            <AccordionSummary expandIcon={<ExpandMore />}><Typography component="h3" variant="subtitle1">{section.title}</Typography></AccordionSummary>
            <AccordionDetails><AssessmentNarrative content={section.body} onSources={openSources} /></AccordionDetails>
          </Accordion>)}
        </Stack>}
      </Box>
      <Box role="tabpanel" id="assessment-panel-2" aria-labelledby="assessment-view-2" hidden={tab !== 2}>
        {tab === 2 && <Stack gap={3}>
          {!!gaps.length && <Box><Typography component="h3" variant="h6">Evidence gaps</Typography><Typography variant="body2" color="text.secondary" mt={.5}>Missing evidence is a follow-up, not a low performance score.</Typography><Box component="ul" sx={{ pl: 2.5 }}>{gaps.map(gap => <Typography component="li" key={gap} variant="body2" mb={.75}>{gap}</Typography>)}</Box></Box>}
          <Box><Typography component="h3" variant="h6" mb={2}>Source library</Typography><SourceLibrary sources={sources} onOpen={openSources} /></Box>
        </Stack>}
      </Box>
    </Box>
    <Accordion variant="outlined"><AccordionSummary expandIcon={<ExpandMore />}>Assessment details and update history</AccordionSummary><AccordionDetails><Stack gap={2}>
      <Typography variant="body2" color="text.secondary">{data.model || data.requestedModel} · {data.reasoningEffort || data.requestedReasoningEffort} reasoning · Your personal ChatGPT connection</Typography>
      <Typography variant="body2" color="text.secondary">{data.coverage.excerpted ? `${data.coverage.excerpted} long sources were excerpted for analysis.` : 'The current source text fits within the assessment context.'}</Typography>
      {[...data.history].reverse().map(item => <Box key={item.number}><Typography variant="body2" fontWeight={600}>Update {item.number} · {new Date(item.generatedAt).toLocaleString()}</Typography><Typography variant="body2" color="text.secondary">{item.phase.replaceAll('_', ' ')} · {Object.values(item.counts || {}).reduce((sum, count) => sum + count, 0)} sources</Typography></Box>)}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
        {!data.cancelled && data.enabled && <Button disabled={busy} onClick={() => void act({ pause: true })}>Pause automatic updates</Button>}
        <Button component={Link} href="/ai-account">My ChatGPT connection</Button>
      </Stack>
    </Stack></AccordionDetails></Accordion>
    <SourceReader refs={sourceSelection?.refs || null} sources={sources.filter(source => sourceSelection?.ids.includes(source.id))} previews={data.sourcePreviews || []} onClose={() => setSourceSelection(null)} />
  </Stack>;
}
