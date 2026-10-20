'use client';
import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import type { Goal } from './GoalWorkspace';

const human = (value?: string) => value ? value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()) : 'Not recorded';
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString() : 'Not recorded';
function metric(value: number | undefined, type: string, unit?: string) {
  if (value == null) return 'Not updated';
  if (type === 'boolean') return value ? 'Yes' : 'No';
  return `${value.toLocaleString()}${type === 'percentage' ? '%' : unit ? ` ${unit}` : ''}`;
}

export default function GoalDetailsDialog({ goalId, ownerLabel, onClose }: { goalId: string; ownerLabel: (goal: Goal) => string; onClose: () => void }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    api.get(`/okrs/${encodeURIComponent(goalId)}`).then(response => {
      if (!current) return;
      const record = response.data?.data || response.data;
      if (!record?._id || String(record._id) !== goalId) throw new Error('Goal details could not be loaded.');
      setGoal(record);
    }).catch(reason => {
      if (!current) return;
      setGoal(null);
      setError(reason.response?.status === 403 || reason.response?.status === 404 ? 'This goal is no longer available to your account.' : 'Goal details could not be loaded. Please retry.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [goalId, attempt]);
  const progress = goal?.scoring?.progress ?? goal?.progress;
  const parent = goal?.alignment?.parentOKRId;
  const parentTitle = parent && typeof parent === 'object' ? parent.title || parent.objectives?.[0]?.title : null;
  return <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="goal-details-title" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
    <DialogTitle id="goal-details-title">Goal details</DialogTitle>
    <DialogContent dividers>
      {loading ? <Stack direction="row" gap={2} alignItems="center" role="status"><CircularProgress size={24} /><Typography>Loading goal details…</Typography></Stack>
        : error ? <Alert severity="error" action={<Button color="inherit" onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Retry</Button>}>{error}</Alert>
          : goal && <Stack gap={3} sx={{ overflowWrap: 'anywhere' }}>
            <Box><Typography component="h2" variant="h6">{goal.title || goal.objectives?.[0]?.title || 'Untitled goal'}</Typography><Typography color="text.secondary">{human(goal.type)} · {human(goal.lifecycle?.state || goal.status)}</Typography></Box>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(120px, 1fr) 3fr' }, gap: 1, '& dt': { color: 'text.secondary' }, '& dd': { m: 0 } }}>
              <Typography component="dt">Owner</Typography><Typography component="dd">{ownerLabel(goal)}</Typography>
              <Typography component="dt">Period</Typography><Typography component="dd">{goal.period || 'Not recorded'}</Typography>
              <Typography component="dt">Progress</Typography><Typography component="dd">{progress == null ? 'Not rated' : `${Math.round(progress)}%`}</Typography>
              <Typography component="dt">Assigned by</Typography><Typography component="dd">{goal.assignment?.assignedBy?.name || goal.createdBy?.name || 'Not recorded'}</Typography>
              <Typography component="dt">Acknowledgement</Typography><Typography component="dd">{human(goal.assignment?.acknowledgementStatus || goal.acknowledgement?.status)}</Typography>
              {goal.teamHierarchy?.teamName && <><Typography component="dt">Team</Typography><Typography component="dd">{goal.teamHierarchy.teamName}</Typography></>}
              {goal.teamHierarchy?.departmentName && <><Typography component="dt">Department</Typography><Typography component="dd">{goal.teamHierarchy.departmentName}</Typography></>}
              {goal.health && goal.health !== 'not_set' && <><Typography component="dt">Health</Typography><Typography component="dd">{human(goal.health)}</Typography></>}
              {parent && <><Typography component="dt">Parent goal</Typography><Typography component="dd">{parentTitle || 'Aligned to a parent goal'}</Typography></>}
            </Box>
            {goal.alignment?.alignmentNotes && <Box><Typography component="h3" variant="subtitle1">Alignment notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{goal.alignment.alignmentNotes}</Typography></Box>}
            <Box><Typography component="h3" variant="h6" gutterBottom>Objectives and key results</Typography>
              {!goal.objectives?.length && <Typography color="text.secondary">No objectives have been recorded.</Typography>}
              {goal.objectives?.map((objective, index) => <Box key={objective._id || index} sx={{ mt: 2 }}>
                <Typography component="h4" variant="subtitle1" fontWeight={600}>{index + 1}. {objective.title}</Typography>
                {objective.description && <Typography sx={{ whiteSpace: 'pre-wrap', mt: .5 }}>{objective.description}</Typography>}
                {!objective.keyResults?.length && <Typography color="text.secondary" sx={{ mt: 1 }}>No key results have been recorded.</Typography>}
                <Stack component="ul" gap={2} sx={{ pl: 3, mt: 1 }}>
                  {objective.keyResults?.map((result, resultIndex) => <Box component="li" key={result._id || resultIndex}>
                    <Typography fontWeight={600}>{result.title}</Typography>
                    {result.description && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', my: .5 }}>{result.description}</Typography>}
                    <Typography variant="body2" color="text.secondary">Baseline: {metric(result.startValue, result.metricType, result.unit)} · Target: {metric(result.targetValue, result.metricType, result.unit)} · Current: {metric(result.currentValue, result.metricType, result.unit)}</Typography>
                    {result.dueDate && <Typography variant="body2" color="text.secondary">Due: {date(result.dueDate)}</Typography>}
                  </Box>)}
                </Stack>
                {index < goal.objectives!.length - 1 && <Divider sx={{ my: 2 }} />}
              </Box>)}
            </Box>
          </Stack>}
    </DialogContent>
    <DialogActions><Button color="inherit" onClick={onClose}>Close</Button></DialogActions>
  </Dialog>;
}
