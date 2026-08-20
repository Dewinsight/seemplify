'use client';

import {
  Box, Typography, Stepper, Step, StepLabel, Paper,
  LinearProgress, Chip, Card, CardContent
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Flag, Star, TrendingUp, EmojiObjects, Assignment,
  CheckCircle, RadioButtonUnchecked, PlayCircle, Description, QuestionAnswer
} from '@mui/icons-material';
import type { CycleQuestionProgress } from './CycleQuestionFlow';

interface OKRSummary {
  id: string;
  title: string;
  progress: number;
  objectives?: {
    title: string;
    keyResults?: {
      title: string;
      target: number;
      current: number;
      progress: number;
    }[];
  }[];
}

interface ExtractedData {
  achievements: { text: string; confidence?: number }[];
  challenges: { text: string }[];
  skills: { skill: string }[];
  goals: { goal: string }[];
}

interface PhaseProgressProps {
  currentPhase: string;
  completedPhases: string[];
  okrs: OKRSummary[];
  extractedData: ExtractedData;
  currentOkrIndex: number;
  cycleQuestionProgress?: CycleQuestionProgress | null;
  onPhaseClick?: (phaseId: string) => void;
}

const PHASES = [
  { id: 'okr_reflection', label: 'OKR Reflection', icon: <TrendingUp /> },
  { id: 'achievements', label: 'Key Achievements', icon: <Flag /> },
  { id: 'challenges', label: 'Challenges', icon: <Assignment /> },
  { id: 'learnings', label: 'Learnings', icon: <EmojiObjects /> },
  { id: 'future_goals', label: 'Future Goals', icon: <Star /> },
  { id: 'cycle_questions', label: 'Cycle Questions', icon: <QuestionAnswer /> },
  { id: 'report_generation', label: 'Report Generation', icon: <Description /> },
  { id: 'completed', label: 'Complete', icon: <CheckCircle /> }
];

const OKRCard = ({ okr, isActive, onClick }: { okr: OKRSummary; isActive: boolean; onClick: () => void }) => (
  <Card
    variant="outlined"
    onClick={onClick}
    sx={{
      mb: 1,
      cursor: 'pointer',
      border: isActive ? 2 : 1,
      borderColor: isActive ? 'primary.main' : 'divider',
      bgcolor: isActive ? 'primary.lighter' : 'background.paper',
      borderRadius: 2.5,
      transition: 'all 0.2s',
      boxShadow: isActive ? 3 : 0,
      '&:hover': {
        borderColor: 'primary.main',
        bgcolor: isActive ? 'primary.lighter' : 'action.hover',
        transform: 'translateY(-1px)'
      }
    }}
  >
    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="subtitle2" fontWeight={600} noWrap>
        {okr.title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <LinearProgress
          variant="determinate"
          value={okr.progress}
          sx={{ flex: 1, height: 6, borderRadius: 3 }}
          color={okr.progress >= 80 ? 'success' : okr.progress >= 50 ? 'warning' : 'error'}
        />
        <Typography variant="caption" fontWeight={600}>
          {okr.progress}%
        </Typography>
      </Box>
    </CardContent>
  </Card>
);

const ExtractedDataSummary = ({ extractedData }: { extractedData: ExtractedData }) => {
  const theme = useTheme();
  const totalExtracted =
    (extractedData.achievements?.length || 0) +
    (extractedData.challenges?.length || 0) +
    (extractedData.skills?.length || 0) +
    (extractedData.goals?.length || 0);

  if (totalExtracted === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        mt: 2,
        bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
        borderColor: alpha(theme.palette.success.main, 0.35),
        borderRadius: 2
      }}
    >
      <Typography variant="caption" fontWeight={600} color="success.dark">
        Data Collected
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
        {extractedData.achievements?.length > 0 && (
          <Chip
            size="small"
            label={`${extractedData.achievements.length} achievements`}
            color="success"
            variant="outlined"
          />
        )}
        {extractedData.challenges?.length > 0 && (
          <Chip
            size="small"
            label={`${extractedData.challenges.length} challenges`}
            color="warning"
            variant="outlined"
          />
        )}
        {extractedData.skills?.length > 0 && (
          <Chip
            size="small"
            label={`${extractedData.skills.length} skills`}
            color="info"
            variant="outlined"
          />
        )}
        {extractedData.goals?.length > 0 && (
          <Chip
            size="small"
            label={`${extractedData.goals.length} goals`}
            color="primary"
            variant="outlined"
          />
        )}
      </Box>
    </Paper>
  );
};

export default function PhaseProgress({
  currentPhase,
  completedPhases,
  okrs,
  extractedData,
  currentOkrIndex,
  cycleQuestionProgress,
  onOkrSelect,
  onPhaseClick
}: PhaseProgressProps & { onOkrSelect?: (index: number) => void }) {
  const theme = useTheme();
  const phases = cycleQuestionProgress?.total
    ? PHASES.filter((phase) => (
      phase.id === 'cycle_questions'
      || phase.id === 'report_generation'
      || phase.id === 'completed'
      || (phase.id === 'okr_reflection' && okrs.length > 0)
    ))
    : PHASES.filter((phase) => phase.id !== 'cycle_questions');
  const getStepStatus = (phaseId: string) => {
    if (phaseId === 'cycle_questions' && cycleQuestionProgress?.complete) return 'completed';
    if (completedPhases.includes(phaseId)) return 'completed';
    if (currentPhase === phaseId) return 'active';
    return 'pending';
  };

  const getStepIcon = (phaseId: string) => {
    const status = getStepStatus(phaseId);
    if (status === 'completed') return <CheckCircle color="success" />;
    if (status === 'active') return <PlayCircle color="primary" />;
    return <RadioButtonUnchecked color="disabled" />;
  };

  const handlePhaseClick = (phaseId: string) => {
    const currentIndex = phases.findIndex(p => p.id === currentPhase);
    const targetIndex = phases.findIndex(p => p.id === phaseId);

    // Only allow advancing forward or clicking current/completed phases
    if (targetIndex > currentIndex && !completedPhases.includes(phaseId)) {
      onPhaseClick?.(phaseId);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          mb: 2,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.25),
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.15 : 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.8)} 100%)`
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Guided Flow
        </Typography>
        <Typography variant="h6" fontWeight={650} sx={{ mt: -0.3 }}>
          Progress
        </Typography>
      </Paper>

      {/* Phase Stepper */}
      <Stepper
        orientation="vertical"
        sx={{
          mb: 3,
          '& .MuiStepConnector-line': {
            borderColor: alpha(theme.palette.divider, 0.8)
          }
        }}
      >
        {phases.map((phase) => {
          const status = getStepStatus(phase.id);
          const isClickable = status !== 'pending' || onPhaseClick;

          return (
            <Step key={phase.id} active={status === 'active'} completed={status === 'completed'}>
              <StepLabel
                StepIconComponent={() => getStepIcon(phase.id)}
                onClick={() => isClickable && handlePhaseClick(phase.id)}
                sx={{
                  cursor: isClickable ? 'pointer' : 'default',
                  '& .MuiStepLabel-label': {
                    fontWeight: status === 'active' ? 600 : 400,
                    color: status === 'pending' ? 'text.disabled' : 'text.primary'
                  },
                  '&:hover': isClickable ? {
                    '& .MuiStepLabel-label': {
                      color: 'primary.main'
                    }
                  } : {},
                  my: 0.2
                }}
              >
                <Box>
                  <Typography component="span" variant="body2">{phase.label}</Typography>
                  {phase.id === 'cycle_questions' && cycleQuestionProgress && (
                    <Typography component="span" variant="caption" color="text.secondary" display="block">
                      {cycleQuestionProgress.answered + cycleQuestionProgress.skipped} of {cycleQuestionProgress.total} completed
                    </Typography>
                  )}
                </Box>
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>

      {/* OKRs Section */}
      {okrs.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Your OKRs ({okrs.length})
          </Typography>
          {okrs.map((okr, index) => (
            <OKRCard
              key={okr.id}
              okr={okr}
              isActive={index === currentOkrIndex}
              onClick={() => onOkrSelect?.(index)}
            />
          ))}
        </Box>
      )}

      {/* Extracted Data Summary */}
      <ExtractedDataSummary extractedData={extractedData} />
    </Box>
  );
}
