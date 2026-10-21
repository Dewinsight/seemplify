'use client';

import { useId, useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { analysisSections, categoryNames, coverageGroups, type AssessmentSource } from '@/lib/assessment-presentation';
import { recordedNumber, recordedScale, scoreLabel, type ResultReport } from '@/lib/appraisal-report';
import AssessmentNarrative from './AssessmentNarrative';

const panel = { p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 0 };
const numberStyle = { fontVariantNumeric: 'tabular-nums' };

function RecordedText({ content, label }: { content: string; label: string }) {
  const [expanded, setExpanded] = useState(false), id = useId();
  const long = content.length > 600;
  return <Box>
    <Typography id={id} className="report-text-preview" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...(long && !expanded ? { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>{content}</Typography>
    {long && <Button className="no-print" size="small" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} sx={{ ml: -1, mt: .5 }}>{expanded ? `Show less ${label}` : `Read full ${label}`}</Button>}
  </Box>;
}

function Plot({ value, min, max, label, comparison }: { value: unknown; min: number; max: number; label: string; comparison?: unknown }) {
  const valid = (v: unknown): v is number => recordedNumber(v) && v >= min && v <= max;
  const x = (v: number) => 8 + (v - min) / (max - min) * 284;
  return <Box role="img" aria-label={label} sx={{ mt: .75 }}>
    <svg className="report-chart" viewBox="0 0 300 34" preserveAspectRatio="none" width="100%" height="34" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <line x1="8" y1="17" x2="292" y2="17" stroke="var(--suite-line-strong)" strokeWidth="1" />
      {[0, .25, .5, .75, 1].map(tick => <line key={tick} x1={8 + tick * 284} y1="12" x2={8 + tick * 284} y2="22" stroke="var(--suite-line)" />)}
      {valid(value) && valid(comparison) && <line x1={x(value)} y1="17" x2={x(comparison)} y2="17" stroke="var(--suite-accent)" strokeWidth="3" />}
      {valid(comparison) && <circle cx={x(comparison)} cy="12" r="5" fill="var(--suite-surface)" stroke="var(--suite-muted)" strokeWidth="2" />}
      {valid(value) && <circle cx={x(value)} cy="22" r="5" fill="var(--suite-accent)" stroke="var(--suite-surface)" strokeWidth="1" />}
    </svg>
    <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{min}</Typography><Typography variant="caption" color="text.secondary">{max}</Typography></Stack>
  </Box>;
}

function ProgressPlot({ value, label }: { value: unknown; label: string }) {
  if (!recordedNumber(value)) return null;
  if (value < 0 || value > 100) return <Typography variant="caption" color="text.secondary">Outside the 0–100% chart range; recorded value retained.</Typography>;
  return <Box role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <svg className="report-chart" viewBox="0 0 300 14" preserveAspectRatio="none" width="100%" height="14" aria-hidden="true" style={{ display: 'block', marginTop: 8 }}>
      <rect x="0" y="3" width="300" height="8" rx="2" fill="var(--suite-surface-muted)" />
      <rect x="0" y="3" width={value * 3} height="8" rx="2" fill="var(--suite-accent)" />
      {value === 0 && <line x1="1" y1="1" x2="1" y2="13" stroke="var(--suite-accent)" strokeWidth="2" />}
    </svg>
  </Box>;
}

function Excerpt({ title, content, fallback, onAnalysis, onSources }: { title: string; content?: string; fallback: string; onAnalysis: () => void; onSources: () => void }) {
  const paragraph = content?.split(/\n\s*\n/).filter(Boolean)[0];
  const first = paragraph && paragraph.length > 950 ? `${paragraph.slice(0, 950).replace(/\s+\S*$/, '')}…` : paragraph;
  return <Box minWidth={0}>
    <Typography component="h3" variant="h6" mb={1.5}>{title}</Typography>
    {first ? <><Typography variant="caption" color="text.secondary" display="block" mb={1}>AI interpretation · excerpt</Typography>
      <Box className="report-source-preview" sx={{ '& .assessment-passage': { fontSize: '.875rem' }, '@media print': { '& button': { display: 'none' } } }}><AssessmentNarrative content={first} onSources={onSources} /></Box>
      <Button className="no-print" onClick={onAnalysis} sx={{ mt: 1, ml: -1 }}>Read full analysis</Button></>
      : <Box color="text.secondary"><RecordedText content={fallback} label="reviewer summary" /></Box>}
  </Box>;
}

export default function ResultAnalytics({ report, onSources, onAnalysis }: { report: ResultReport; onSources: () => void; onAnalysis: () => void }) {
  const scale = recordedScale(report.ratingScale), competencies = report.competencies || [], goals = report.goals || [];
  const sections = report.aiReport?.state === 'ready' ? analysisSections(report.aiReport.content || '') : [];
  const summary = sections.find(section => section.key === 'summary') || sections[0];
  const strengths = sections.find(section => section.key === 'competencies');
  const outcomes = sections.find(section => section.key === 'outcomes');
  const actions = sections.find(section => section.key === 'actions');
  const sources: AssessmentSource[] = (report.aiReport?.coverage?.sources || []).map(source => ({ ...source, category: source.category || source.id.split(':')[0] }));
  const hasSourceCoverage = Array.isArray(report.aiReport?.coverage?.sources);
  const groups = coverageGroups(sources).filter(group => group.count > 0), maximum = Math.max(...groups.map(group => group.count), 1);
  const validPairs = scale ? competencies.filter(item => [item.selfRating, item.managerRating].every(value => recordedNumber(value) && value >= scale.min && value <= scale.max)) : [];
  const differing = validPairs.filter(item => item.selfRating !== item.managerRating).length;
  const ratedGoals = goals.filter(goal => recordedNumber(goal.score));
  const chartedGoals = ratedGoals.filter(goal => goal.score! >= 0 && goal.score! <= 100);
  const mean = chartedGoals.length ? chartedGoals.reduce((sum, goal) => sum + goal.score!, 0) / chartedGoals.length : null;
  return <Box component="section" aria-label="Appraisal analytics" sx={{ my: 3, ...(!sources.length ? { '& .report-source-preview button': { display: 'none' } } : {}) }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,.8fr) minmax(0,1.2fr)' }, gap: { xs: 3, md: 4 }, pb: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box>
        <Typography component="h2" variant="h6" mb={1}>Published outcome</Typography>
        <Typography sx={{ fontSize: '2.75rem', lineHeight: 1.15, fontWeight: 650, letterSpacing: '-.04em', ...numberStyle }}>{scoreLabel(report.finalRating?.overall)}{recordedNumber(report.ratingScale?.max) && recordedNumber(report.finalRating?.overall) && <Box component="span" sx={{ color: 'text.secondary', fontSize: '1rem', fontWeight: 400, letterSpacing: 0 }}> / {report.ratingScale.max}</Box>}</Typography>
        {report.finalRating?.ratingLabel && <Typography fontWeight={600} mt={.75}>{report.finalRating.ratingLabel}</Typography>}
        {scale && <Plot value={report.finalRating?.overall} {...scale} label={`Published outcome: ${scoreLabel(report.finalRating?.overall, scale.max)}; recorded scale ${scale.min}–${scale.max}`} />}
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>Human reviewer’s final decision{scale ? ` · Reported scale ${scale.min}–${scale.max}` : ' · Rating scale not available'}</Typography>
        {scale && recordedNumber(report.finalRating?.overall) && (report.finalRating.overall < scale.min || report.finalRating.overall > scale.max) && <Typography variant="body2" color="text.secondary">Final rating is outside the recorded scale; no point is plotted.</Typography>}
        {report.finalRating?.justification && <Box mt={2}><RecordedText content={report.finalRating.justification} label="final rationale" /></Box>}
        {recordedNumber(report.managerFeedback?.overallRating) && <Typography variant="body2" color="text.secondary" mt={1.5}>Reviewer submission: {scoreLabel(report.managerFeedback?.overallRating, scale?.max)}. The published outcome above remains final.</Typography>}
      </Box>
      <Excerpt title="Assessment overview" content={summary?.body} fallback="The saved outcome and review evidence are available below. Written AI analysis will appear when generation completes." onSources={onSources} onAnalysis={onAnalysis} />
    </Box>

    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1.2fr) minmax(0,1fr)' }, alignItems: 'start', gap: 3, mt: 3 }}>
      <Box component="figure" aria-labelledby="result-competencies-heading" sx={{ ...panel, m: 0 }}>
        <Stack direction="row" justifyContent="space-between" gap={1} flexWrap="wrap"><Typography component="h2" variant="h6" id="result-competencies-heading">Competency ratings</Typography><Typography variant="body2" color="text.secondary">{scale ? `Scale ${scale.min}–${scale.max}` : 'Rating scale not available'}</Typography></Stack>
        <Stack direction="row" gap={2} mt={1.5} mb={2.5}><Stack direction="row" alignItems="center" gap={.75}><svg className="report-chart" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="var(--suite-surface)" stroke="var(--suite-muted)" strokeWidth="2" /></svg><Typography variant="caption">Employee</Typography></Stack><Stack direction="row" alignItems="center" gap={.75}><svg className="report-chart" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4.5" fill="var(--suite-accent)" /></svg><Typography variant="caption">Reviewer</Typography></Stack></Stack>
        {competencies.length ? <Stack spacing={2.5}>{competencies.map((item, index) => <Box key={index} className="result-row">
          <Typography variant="body2" fontWeight={600}>{item.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={numberStyle}>Employee {scoreLabel(item.selfRating, scale?.max)} · Reviewer {scoreLabel(item.managerRating, scale?.max)}</Typography>
          {scale && <Plot value={item.managerRating} comparison={item.selfRating} {...scale} label={`${item.name}: employee ${scoreLabel(item.selfRating)}, reviewer ${scoreLabel(item.managerRating)}; scale ${scale.min}–${scale.max}`} />}
          {scale && [item.selfRating, item.managerRating].some(value => recordedNumber(value) && (value < scale.min || value > scale.max)) && <Typography variant="caption" color="text.secondary">A rating is outside the recorded scale and is not plotted.</Typography>}
          {item.managerComments && <Box mt={.75}><RecordedText content={item.managerComments} label="reviewer comment" /></Box>}
        </Box>)}</Stack> : <Typography variant="body2" color="text.secondary">No competency ratings were recorded for this appraisal.</Typography>}
        {!!validPairs.length && <Typography component="figcaption" variant="body2" sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>{differing ? `Employee and reviewer ratings differ on ${differing} of ${validPairs.length} competencies rated by both.` : `Employee and reviewer ratings agree on all ${validPairs.length} competencies rated by both.`} These comparisons do not change the final result.</Typography>}
      </Box>
      <Stack spacing={3}>
        <Box sx={panel}><Excerpt title="Strengths and development" content={strengths?.body} fallback={report.managerSummary?.strengths || 'Read the saved reviewer comments and discussion for strengths and development context. No AI interpretation is available yet.'} onSources={onSources} onAnalysis={onAnalysis} />
          {report.discussion?.developmentPlan && <Box mt={2} pt={2} sx={{ borderTop: '1px solid', borderColor: 'divider' }}><Typography variant="subtitle2" mb={.75}>Agreed development plan</Typography><RecordedText content={Array.isArray(report.discussion.developmentPlan) ? report.discussion.developmentPlan.join('\n') : report.discussion.developmentPlan} label="development plan" /></Box>}
        </Box>
        <Box component="figure" aria-labelledby="result-goals-heading" sx={{ ...panel, m: 0 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1}><Typography component="h2" variant="h6" id="result-goals-heading">Reviewed goals</Typography><Typography variant="body2" color="text.secondary">{ratedGoals.length} / {goals.length} scored</Typography></Stack>
          <Typography variant="body2" color="text.secondary" mt={.75} mb={2}>Saved appraisal goal achievement · 0–100%</Typography>
          {goals.length ? <Stack spacing={2}>{goals.map((goal, index) => <Box key={index} className="result-row"><Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2">{goal.title}</Typography><Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0, ...numberStyle }}>{recordedNumber(goal.score) ? `${goal.score}%` : scoreLabel(goal.score)}</Typography></Stack><ProgressPlot value={goal.score} label={`${goal.title}: saved achievement`} /></Box>)}</Stack> : <Typography variant="body2" color="text.secondary">No goal evidence was attached to this appraisal.</Typography>}
          {mean !== null && <Typography component="figcaption" variant="caption" color="text.secondary" display="block" mt={2}>Unweighted mean: {Number(mean.toFixed(1))}% across {chartedGoals.length} scored goal{chartedGoals.length === 1 ? '' : 's'} in the 0–100% range. This is not the final rating.</Typography>}
          {!!report.managerFeedback?.goals.length && <Box mt={3} pt={2.5} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography component="h3" variant="subtitle1">Reviewer goal verification</Typography>
            <Typography variant="caption" color="text.secondary">Completion and quality are separate reviewer measures, not the saved goal achievement above.</Typography>
            <Stack spacing={2} mt={2}>{report.managerFeedback.goals.map((goal, index) => <Box key={goal.id || index} className="result-row">
              <Typography variant="body2" fontWeight={600}>{goal.title}</Typography>
              <Typography variant="body2" color="text.secondary">Verified completion: {recordedNumber(goal.verifiedCompletion) ? `${goal.verifiedCompletion}%` : scoreLabel(goal.verifiedCompletion)}</Typography>
              <ProgressPlot value={goal.verifiedCompletion} label={`${goal.title}: reviewer verified completion`} />
              <Typography variant="body2" color="text.secondary" mt={.75}>Quality rating: {scoreLabel(goal.qualityRating, 5)} · Separate 1–5 scale</Typography>
              {recordedNumber(goal.qualityRating) && <Plot value={goal.qualityRating} min={1} max={5} label={`${goal.title}: reviewer quality rating ${goal.qualityRating}; scale 1–5`} />}
              {recordedNumber(goal.qualityRating) && (goal.qualityRating < 1 || goal.qualityRating > 5) && <Typography variant="caption" color="text.secondary">Quality rating is outside the 1–5 scale and is not plotted.</Typography>}
            </Box>)}</Stack>
          </Box>}
          {outcomes && <Box mt={2.5} pt={2} sx={{ borderTop: '1px solid', borderColor: 'divider' }}><Excerpt title="Outcome context" content={outcomes.body} fallback="" onSources={onSources} onAnalysis={onAnalysis} /></Box>}
        </Box>
      </Stack>
    </Box>

    <Box sx={{ ...panel, mt: 3 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.2fr) minmax(0,1fr)' }, gap: 4 }}>
        <Box component="figure" aria-labelledby="result-evidence-heading" sx={{ m: 0 }}>
          <Stack direction="row" justifyContent="space-between" gap={1}><Typography component="h2" variant="h6" id="result-evidence-heading">Report evidence</Typography><Typography variant="body2" fontWeight={600}>{hasSourceCoverage ? `${sources.length} sources` : 'Not available'}</Typography></Stack>
          <Typography variant="body2" color="text.secondary" mt={.75} mb={2}>Shared report context, grouped by source type.</Typography>
          {sources.length ? <Stack spacing={1.5}>{groups.map(group => <Box key={group.title}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2">{group.title}</Typography><Typography variant="body2" sx={numberStyle}>{group.count}</Typography></Stack><svg className="report-chart" preserveAspectRatio="none" width="100%" height="12" viewBox="0 0 300 12" aria-label={`${group.title}: ${group.count} sources`} role="img" style={{ display: 'block', marginTop: 4 }}><rect y="2" width="300" height="8" rx="2" fill="var(--suite-surface-muted)" /><rect y="2" width={group.available / maximum * 300} height="8" rx="2" fill="var(--suite-accent)" /><rect y="2" x={group.available / maximum * 300} width={group.drafts / maximum * 300} height="8" fill="var(--suite-muted)" /><rect y="2" x={(group.available + group.drafts) / maximum * 300} width={group.pending / maximum * 300} height="8" fill="var(--suite-warning)" /></svg><Typography variant="caption" color="text.secondary">{group.available} available · {group.drafts} draft · {group.pending} needing attention</Typography></Box>)}</Stack> : <Typography variant="body2" color="text.secondary">{hasSourceCoverage ? 'No report sources listed.' : 'Evidence coverage is not available yet.'}</Typography>}
          <Typography component="figcaption" variant="caption" color="text.secondary" display="block" mt={2}>Source counts describe coverage, not performance or AI confidence. Blue: available · Grey: draft · Amber: needs attention.</Typography>
          <Button className="no-print" onClick={onSources} sx={{ ml: -1, mt: .5 }} disabled={!sources.length}>Explore report sources</Button>
        </Box>
        <Box>
          <Typography component="h3" variant="h6" mb={1.5}>Evidence gaps and next steps</Typography>
          {report.aiReport?.coverage?.gaps?.length ? <Box component="ul" sx={{ m: 0, pl: 2.5, '& li + li': { mt: 1 } }}>{report.aiReport.coverage.gaps.map(gap => <Typography component="li" variant="body2" key={gap}>{gap}</Typography>)}</Box> : <Typography variant="body2" color="text.secondary">{report.aiReport?.coverage ? 'No evidence gaps were listed. Source availability is not a guarantee of completeness.' : 'Coverage and missing evidence will be listed when the report context is available.'}</Typography>}
          {!!report.aiReport?.coverage?.excerptedCategories?.length && <Typography variant="body2" color="text.secondary" mt={1.5}>Long sources were excerpted: {report.aiReport.coverage.excerptedCategories.map(key => categoryNames[key] || key.replaceAll('_', ' ')).join(', ')}.</Typography>}
          {actions && <><Divider sx={{ my: 2.5 }} /><Excerpt title="Development priorities" content={actions.body} fallback="" onSources={onSources} onAnalysis={onAnalysis} /></>}
        </Box>
      </Box>
    </Box>
  </Box>;
}
