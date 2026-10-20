'use client';

import { Alert, Box, Button, Chip, FormControlLabel, IconButton, MenuItem, Paper, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward, DeleteOutline, Add, CheckCircleOutline } from '@mui/icons-material';

export type FlowType = 'selfAssessment' | 'managerReview' | 'oneOnOne' | 'discussion' | 'calibration' | 'finalReview' | 'acknowledgement';
export interface FlowStep { id: string; type: FlowType; label: string }
export interface AppraisalFlow { version: number; assessmentMode: 'conversation' | 'form'; steps: FlowStep[] }
export const flowLabels: Record<FlowType, string> = { selfAssessment: 'Employee assessment', managerReview: 'Reviewer assessment', oneOnOne: 'One-on-one meeting', discussion: 'Performance discussion', calibration: 'Calibration', finalReview: 'Final outcome', acknowledgement: 'Employee acknowledgement' };
const descriptions: Record<FlowType, string> = { selfAssessment: 'The employee reflects on their work and answers the review questions.', managerReview: 'You record your assessment and supporting evidence.', oneOnOne: 'Schedule a call. Its transcript and meeting notes stay with this review.', discussion: 'Discuss the feedback and record the agreed notes.', calibration: 'An authorized reviewer checks the proposed rating for consistency.', finalReview: 'A person approves and publishes the final result. Required.', acknowledgement: 'The employee reads and acknowledges the published result.' };
export function defaultFlow(): AppraisalFlow {
  return { version: 1, assessmentMode: 'conversation', steps: (['selfAssessment', 'oneOnOne', 'managerReview', 'finalReview'] as FlowType[]).map(type => ({ id: type, type, label: flowLabels[type] })) };
}
export function flowError(flow: AppraisalFlow): string {
  const final = flow.steps.findIndex(s => s.type === 'finalReview');
  if (flow.steps.some((s, i) => i > final && s.type !== 'acknowledgement')) return 'Place all review work before the final outcome.';
  if (flow.steps.some((s, i) => s.type === 'acknowledgement' && i !== flow.steps.length - 1)) return 'Employee acknowledgement must be last.';
  const calibration = flow.steps.findIndex(s => s.type === 'calibration');
  const manager = flow.steps.findIndex(s => s.type === 'managerReview');
  if (calibration >= 0 && (manager < 0 || calibration < manager)) return 'Calibration needs a reviewer assessment before it.';
  return '';
}

export default function AppraisalFlowEditor({ value, onChange, onReset }: { value: AppraisalFlow; onChange: (value: AppraisalFlow) => void; onReset: () => void }) {
  const error = flowError(value);
  const changeSteps = (steps: FlowStep[]) => onChange({ ...value, steps });
  const move = (index: number, delta: number) => { const steps = [...value.steps]; [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]]; changeSteps(steps); };
  const available = (Object.keys(flowLabels) as FlowType[]).filter(type => type === 'oneOnOne' || !value.steps.some(step => step.type === type));
  return <Box component="section" aria-labelledby="appraisal-flow-heading">
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} mb={1}><Typography id="appraisal-flow-heading" component="h3" variant="h6">Appraisal steps</Typography><Button onClick={onReset}>Reset to default</Button></Stack>
    <Typography color="text.secondary" variant="body2" mb={2}>Each person completes these steps in order. Add a call, remove optional steps, or use the arrows to change the order. These choices apply only to the reviews you start now.</Typography>
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <FormControlLabel control={<Switch checked={value.assessmentMode === 'conversation'} disabled={!value.steps.some(s => s.type === 'selfAssessment')} onChange={(_, enabled) => onChange({ ...value, assessmentMode: enabled ? 'conversation' : 'form' })} />} label="AI conversation for employee assessment" />
      <Typography variant="body2" color="text.secondary">{value.assessmentMode === 'conversation' ? 'Employees can reflect with AI using their own connected ChatGPT account. They can also use the form.' : 'Employees use the manual form. No AI interview or ChatGPT connection is required to submit it.'} Other AI tools keep their own settings.</Typography>
    </Paper>
    <Stack component="ol" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
      {value.steps.map((step, index) => <Paper component="li" variant="outlined" key={step.id} sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} gap={1.5}>
          <Chip label={index + 1} size="small" sx={{ alignSelf: 'flex-start' }} />
          <Box flex={1}><Typography fontWeight={600}>{step.label}</Typography><Typography variant="body2" color="text.secondary">{descriptions[step.type]}</Typography></Box>
          <Stack direction="row" alignSelf={{ xs: 'flex-end', sm: 'center' }}>
            <Tooltip title="Move earlier"><span><IconButton aria-label={`Move ${step.label} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
            <Tooltip title="Move later"><span><IconButton aria-label={`Move ${step.label} later`} disabled={index === value.steps.length - 1} onClick={() => move(index, 1)}><ArrowDownward fontSize="small" /></IconButton></span></Tooltip>
            {step.type === 'finalReview' ? <Tooltip title="A human must approve the final result"><CheckCircleOutline color="action" sx={{ m: 1 }} /></Tooltip> : <IconButton aria-label={`Remove ${step.label}`} onClick={() => changeSteps(value.steps.filter((_, i) => i !== index))}><DeleteOutline fontSize="small" /></IconButton>}
          </Stack>
        </Stack>
      </Paper>)}
    </Stack>
    {available.length > 0 && value.steps.length < 12 && <TextField select fullWidth label="Add a step" value="" sx={{ mt: 2 }} onChange={event => {
      const type = event.target.value as FlowType;
      const steps = [...value.steps];
      steps.splice(Math.max(0, steps.findIndex(s => s.type === 'finalReview')), 0, { id: `${type}_${crypto.randomUUID().slice(0, 8)}`, type, label: flowLabels[type] });
      if (type === 'acknowledgement') { const added = steps.splice(steps.findIndex(s => s.type === type), 1)[0]; steps.push(added); }
      changeSteps(steps);
    }}>{available.map(type => <MenuItem key={type} value={type}><Add fontSize="small" sx={{ mr: 1 }} />{flowLabels[type]}</MenuItem>)}</TextField>}
    {error && <Alert severity="warning" sx={{ mt: 2 }} role="status">{error}</Alert>}
    <Typography variant="caption" color="text.secondary" component="p" mt={1.5}>A call is scheduled from the appraisal after it starts. Recording is announced in the invitation; participants must admit the notetaker. Meeting notes are available after processing.</Typography>
  </Box>;
}
