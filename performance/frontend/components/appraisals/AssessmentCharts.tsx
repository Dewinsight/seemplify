'use client';
import { useState } from 'react';
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AssessmentAnalytics, AssessmentSource, coverageGroups, stateName } from '@/lib/assessment-presentation';

export function EvidenceChart({ sources, gaps, onSources }: { sources: AssessmentSource[]; gaps: string[]; onSources: () => void }) {
  const groups = coverageGroups(sources), maximum = Math.max(...groups.map(group => group.count), 1);
  return <Box component="figure" sx={{ m: 0 }} aria-labelledby="evidence-chart-heading">
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1}><Typography id="evidence-chart-heading" component="h3" variant="h6">Evidence at a glance</Typography><Typography fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{sources.length} sources</Typography></Stack>
    <Stack gap={1.5} mt={2}>{groups.map(group => <Box key={group.title}>
      <Stack direction="row" justifyContent="space-between" gap={1} mb={.5}><Typography variant="body2">{group.title}</Typography><Typography variant="body2" color="text.secondary">{group.count || 'None'}</Typography></Stack>
      <Box role="img" aria-label={`${group.title}: ${group.available} available, ${group.drafts} draft, ${group.pending} needing attention`} sx={{ display: 'flex', height: 9, bgcolor: 'action.hover', borderRadius: .5, overflow: 'hidden' }}>
        {[['primary.main', group.available], ['text.secondary', group.drafts], ['warning.main', group.pending]].map(([color, count]) => <Box key={String(color)} sx={{ bgcolor: color, width: `${Number(count) / maximum * 100}%` }} />)}
      </Box>
    </Box>)}</Stack>
    <Stack direction="row" gap={1.5} flexWrap="wrap" mt={2}>{[['primary.main', 'Available'], ['text.secondary', 'Draft'], ['warning.main', 'Needs attention']].map(([color, label]) => <Stack key={label} direction="row" gap={.75} alignItems="center"><Box sx={{ width: 9, height: 9, bgcolor: color }} /><Typography variant="caption" color="text.secondary">{label}</Typography></Stack>)}</Stack>
    <Typography component="figcaption" variant="caption" color="text.secondary" mt={1.5}>Source counts show the evidence available, not a performance or confidence score.</Typography>
    <Button size="small" onClick={onSources} sx={{ mt: 1, ml: -1 }}>Explore sources{gaps.length ? ` · ${gaps.length} evidence gap${gaps.length === 1 ? '' : 's'}` : ''}</Button>
  </Box>;
}

function RatingBar({ value, max, min, label, reviewer = false }: { value: number | null; max: number; min: number; label: string; reviewer?: boolean }) {
  const present = typeof value === 'number' && Number.isFinite(value);
  return <Stack direction="row" alignItems="center" gap={1.25}>
    <Box flex={1} sx={{ height: 10, bgcolor: 'action.hover', borderRadius: .5 }} {...(present ? { role: 'meter', 'aria-label': label, 'aria-valuenow': value, 'aria-valuemin': min, 'aria-valuemax': max } : {})}>
      {present && <Box sx={{ height: '100%', borderRadius: .5, width: `${Math.max(0, Math.min(100, (value - min) / Math.max(1, max - min) * 100))}%`, bgcolor: reviewer ? 'text.secondary' : 'primary.main' }} />}
    </Box><Typography variant="body2" sx={{ minWidth: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{present ? `${value}/${max}` : 'Not rated'}</Typography>
  </Stack>;
}
export function RatingChart({ analytics, onSources }: { analytics?: AssessmentAnalytics; onSources: (refs: string[]) => void }) {
  const [all, setAll] = useState(false);
  const scale = analytics?.scale || { min: 1, max: 5 };
  const overall = analytics?.ratings;
  const competencies = analytics?.competencies || [];
  return <Box component="section" aria-labelledby="rating-comparison-heading">
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1}><Typography id="rating-comparison-heading" component="h3" variant="h6">Rating comparison</Typography><Typography variant="body2" color="text.secondary">Scale {scale.min}–{scale.max}</Typography></Stack>
    <Typography variant="body2" color="text.secondary" mt={.5}>Saved human ratings · draft ratings remain provisional.</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 2, sm: 4 }, mt: 2.5 }}>
      {(['employee', 'reviewer'] as const).map(side => <Box key={side}><Stack direction="row" justifyContent="space-between" gap={1} mb={1}><Typography fontWeight={600}>{side === 'employee' ? 'Employee' : 'Reviewer'}</Typography><Typography variant="caption" color="text.secondary">{stateName(overall?.[side]?.state || 'not_available')}</Typography></Stack><RatingBar value={overall?.[side]?.value ?? null} {...scale} label={`${side} overall rating`} reviewer={side === 'reviewer'} /></Box>)}
    </Box>
    {!!competencies.length && <Box mt={3}><Typography component="h4" variant="subtitle2" mb={1.5}>Competencies</Typography><Stack gap={2}>{(all ? competencies : competencies.slice(0, 4)).map((item, index) => <Box key={`${item.title}-${index}`}>
      <Stack direction="row" justifyContent="space-between" gap={1} mb={.75}><Typography variant="body2" fontWeight={600}>{item.title}</Typography>{!!item.refs.length && <Button size="small" onClick={() => onSources(item.refs)} sx={{ py: 0 }}>Evidence</Button>}</Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', alignItems: 'center', rowGap: .5 }}><Typography variant="caption" color="text.secondary">Employee</Typography><RatingBar value={item.employee} {...scale} label={`${item.title}: employee rating`} /><Typography variant="caption" color="text.secondary">Reviewer</Typography><RatingBar value={item.reviewer} {...scale} label={`${item.title}: reviewer rating`} reviewer /></Box>
    </Box>)}</Stack>{competencies.length > 4 && <Button onClick={() => setAll(!all)} sx={{ mt: 1 }}>{all ? 'Show fewer competencies' : `View all ${competencies.length} competencies`}</Button>}</Box>}
  </Box>;
}

export function GoalChart({ analytics, onSources }: { analytics?: AssessmentAnalytics; onSources: (refs: string[]) => void }) {
  const [scope, setScope] = useState('individual'), [all, setAll] = useState(false);
  const allGoals = analytics?.goals || [], hasSnapshots = allGoals.some(goal => goal.basis === 'appraisal_snapshot');
  const [basis, setBasis] = useState('appraisal_snapshot');
  const selectedBasis = hasSnapshots ? basis : 'live_context';
  const goals = allGoals.filter(goal => (scope === 'individual' ? goal.scope === 'individual' : goal.scope !== 'individual') && goal.basis === selectedBasis);
  return <Box component="section" aria-labelledby="okr-chart-heading"><Typography id="okr-chart-heading" component="h3" variant="h6">OKR outcomes</Typography>
    <Stack direction="row" justifyContent="space-between" gap={1} flexWrap="wrap" mt={1.5} mb={1.5}>
      <ToggleButtonGroup exclusive size="small" value={scope} onChange={(_, value) => { if (value) { setScope(value); setBasis(value === 'aligned' ? 'live_context' : 'appraisal_snapshot'); setAll(false); } }} aria-label="Goal scope"><ToggleButton value="individual">Individual</ToggleButton><ToggleButton value="aligned">Team & company</ToggleButton></ToggleButtonGroup>
      {hasSnapshots && <ToggleButtonGroup exclusive size="small" value={selectedBasis} onChange={(_, value) => { if (value) setBasis(value); }} aria-label="Goal evidence basis"><ToggleButton value="appraisal_snapshot">Appraisal snapshot</ToggleButton><ToggleButton value="live_context">Live context</ToggleButton></ToggleButtonGroup>}
    </Stack>
    <Typography variant="body2" color="text.secondary" mb={2}>{selectedBasis === 'appraisal_snapshot' ? 'Progress preserved for this appraisal.' : scope === 'aligned' ? 'Team and company context; these results are not attributed to this employee.' : 'Current goal progress. Appraisal ratings use the preserved review evidence.'}</Typography>
    {!goals.length ? <Typography variant="body2" color="text.secondary">No {scope === 'individual' ? 'individual' : 'aligned team or company'} goals are available for this view.</Typography> : <Stack gap={2}>{(all ? goals : goals.slice(0, 4)).map((goal, index) => <Box key={`${goal.ref}-${index}`}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={600}>{goal.title}</Typography><Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{goal.progress === null ? 'Not rated' : `${Math.round(goal.progress)}%`}</Typography></Stack>
      {goal.progress !== null && <Box role="meter" aria-label={`${goal.title} progress`} aria-valuenow={goal.progress} aria-valuemin={0} aria-valuemax={100} sx={{ mt: 1, height: 10, bgcolor: 'action.hover', borderRadius: .5 }}><Box sx={{ bgcolor: 'primary.main', height: '100%', borderRadius: .5, width: `${goal.progress}%` }} /></Box>}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mt={.25}><Typography variant="caption" color="text.secondary">{stateName(goal.status)}{scope === 'aligned' ? ` · ${stateName(goal.scope)}` : ''}</Typography><Button size="small" onClick={() => onSources([goal.ref])}>Evidence</Button></Stack>
    </Box>)}</Stack>}
    {goals.length > 4 && <Button onClick={() => setAll(!all)} sx={{ mt: 1 }}>{all ? 'Show fewer goals' : `View all ${goals.length} goals`}</Button>}
  </Box>;
}
