'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  LockOutlined,
  OpenInNew,
} from '@mui/icons-material';
import { useAppraisal } from '@/lib/hooks';

interface SnapshotKeyResult {
  _id?: string;
  title?: string;
  metricType?: string;
  unit?: string;
  currentValue?: number | boolean | null;
  targetValue?: number | boolean | null;
}

interface SnapshotObjective {
  _id?: string;
  title?: string;
  description?: string;
  keyResults?: SnapshotKeyResult[];
}

interface GoalSnapshot {
  _id?: string;
  sourceGoalId?: string;
  sourceVersion?: number;
  scope?: string;
  period?: { label?: string };
  definition?: {
    title?: string;
    objectives?: SnapshotObjective[];
  };
  achievement?: {
    rated?: boolean;
    score?: number | null;
    reason?: string;
  };
  capturedAt?: string;
  cutoffAt?: string;
}

function readable(value?: string) {
  return String(value || 'individual')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: SnapshotKeyResult['currentValue'], metricType?: string, unit?: string) {
  if (value === undefined || value === null) return 'Not reported';
  if (metricType === 'boolean') return value === true || value === 1 ? 'Yes' : 'No';
  if (metricType === 'currency') return `${unit || ''}${Number(value).toLocaleString()}`;
  if (metricType === 'percentage') return `${value}%`;
  return `${value}${unit ? ` ${unit}` : ''}`;
}

function snapshotTitle(snapshot: GoalSnapshot) {
  return snapshot.definition?.title || snapshot.definition?.objectives?.[0]?.title || 'Untitled goal';
}

export default function GoalSettingPage() {
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;
  const { appraisal, isLoading, isError } = useAppraisal(appraisalId);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress aria-label="Loading appraisal goals" />
      </Box>
    );
  }

  if (isError || !appraisal) {
    return <Alert severity="error">This appraisal could not be loaded.</Alert>;
  }

  const snapshots = (Array.isArray(appraisal.goalSnapshots) ? appraisal.goalSnapshots : []) as GoalSnapshot[];
  const summary = appraisal.goalEvidenceSummary || {};
  const cycle = appraisal.cycleId || {};
  const canContinueAssessment = ['self_assessment_pending', 'self_assessment_in_progress'].includes(appraisal.status);
  const continueLabel = appraisal.status === 'self_assessment_in_progress'
    ? 'Continue self-assessment'
    : 'Start self-assessment';

  return (
    <Box>
      <Button
        startIcon={<ArrowBack />}
        onClick={() => router.push(`/appraisals/${appraisalId}`)}
        sx={{ mb: 2 }}
      >
        Back to appraisal
      </Button>

      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Goals in this appraisal</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {cycle.name || 'Performance review'} · {snapshots.length} captured goal{snapshots.length === 1 ? '' : 's'}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<OpenInNew />}
          onClick={() => router.push('/okrs')}
          sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
        >
          Open Goals workspace
        </Button>
      </Stack>

      <Alert severity="info" icon={<LockOutlined />} sx={{ mb: 3 }}>
        <Typography variant="body2" fontWeight={700}>No save is needed.</Typography>
        <Typography variant="body2">
          These approved individual goals were attached automatically when the appraisal began. They are a locked historical snapshot, so later goal edits cannot change this review.
        </Typography>
      </Alert>

      <Paper variant="outlined" sx={{ px: 2.5, py: 2, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          divider={<Divider orientation="vertical" flexItem />}
          spacing={2.5}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">Captured goals</Typography>
            <Typography variant="h6">{snapshots.length}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Goals with reported progress</Typography>
            <Typography variant="h6">{summary.ratedGoals || 0} of {summary.totalGoals ?? snapshots.length}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Goal contribution</Typography>
            <Typography variant="h6">{summary.okrWeight ?? cycle.okrWeight ?? 40}%</Typography>
          </Box>
        </Stack>
      </Paper>

      {snapshots.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          No eligible approved individual goals were available at the appraisal cutoff. The goal component will be omitted and the remaining appraisal components will be rebalanced automatically.
        </Alert>
      ) : (
        <Stack spacing={2} sx={{ mb: 3 }}>
          {snapshots.map((snapshot, index) => {
            const achievement = snapshot.achievement?.score;
            const objectives = snapshot.definition?.objectives || [];
            return (
              <Paper key={snapshot._id || snapshot.sourceGoalId || index} variant="outlined" sx={{ p: 2.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      <Chip size="small" variant="outlined" label={readable(snapshot.scope)} />
                      {snapshot.period?.label && <Chip size="small" variant="outlined" label={snapshot.period.label} />}
                      <Chip size="small" variant="outlined" label={`Version ${snapshot.sourceVersion || 1}`} />
                    </Stack>
                    <Typography variant="h6">{snapshotTitle(snapshot)}</Typography>
                  </Box>
                  <Box sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}>
                    <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">Cutoff achievement</Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {typeof achievement === 'number' ? `${Math.round(achievement)}%` : 'Not rated'}
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={typeof achievement === 'number' ? achievement : 0} sx={{ height: 6 }} />
                  </Box>
                </Stack>

                {objectives.length > 0 && <Divider sx={{ my: 2 }} />}
                <Stack spacing={1.5}>
                  {objectives.map((objective, objectiveIndex) => (
                    <Box key={objective._id || objectiveIndex}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {objective.title || `Objective ${objectiveIndex + 1}`}
                      </Typography>
                      {objective.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                          {objective.description}
                        </Typography>
                      )}
                      {(objective.keyResults || []).map((keyResult, keyResultIndex) => (
                        <Stack
                          key={keyResult._id || keyResultIndex}
                          direction={{ xs: 'column', sm: 'row' }}
                          justifyContent="space-between"
                          spacing={0.5}
                          sx={{ mt: 1, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}
                        >
                          <Typography variant="body2">{keyResult.title || `Key result ${keyResultIndex + 1}`}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {formatValue(keyResult.currentValue, keyResult.metricType, keyResult.unit)} / {formatValue(keyResult.targetValue, keyResult.metricType, keyResult.unit)}
                          </Typography>
                        </Stack>
                      ))}
                    </Box>
                  ))}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>Your goal evidence is already saved</Typography>
            <Typography variant="body2" color="text.secondary">
              Continue when you are ready to reflect on the captured outcomes and evidence.
            </Typography>
          </Box>
          {canContinueAssessment ? (
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              onClick={() => router.push(`/appraisals/${appraisalId}/self-assessment`)}
            >
              {continueLabel}
            </Button>
          ) : (
            <Button variant="contained" onClick={() => router.push(`/appraisals/${appraisalId}`)}>
              Back to appraisal
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
