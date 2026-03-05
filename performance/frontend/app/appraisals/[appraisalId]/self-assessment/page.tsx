'use client';

import { useRouter, useParams } from 'next/navigation';
import { useAppraisal } from '@/lib/hooks';
import { Box, Typography, Button, Alert, CircularProgress, Fade, Paper, Chip } from '@mui/material';
import { ArrowBack, AutoAwesome } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import ConversationalAssessment from './conversational/ConversationalAssessment';

export default function SelfAssessmentPage() {
  const theme = useTheme();
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;

  const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);

  const handleConversationComplete = () => {
    mutate();
    router.push(`/appraisals/${appraisalId}`);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!appraisal) {
    return (
      <Alert severity="error">Appraisal not found</Alert>
    );
  }

  const editableStatuses = ['self_assessment_pending', 'self_assessment_in_progress'];
  const isEditable = editableStatuses.includes(appraisal.status);

  // Check if already submitted
  if (appraisal.selfAssessment?.submittedAt) {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Self-Assessment Already Submitted</Typography>
          <Typography variant="body2">
            You submitted your self-assessment on {new Date(appraisal.selfAssessment.submittedAt).toLocaleDateString()}.
            Your manager will now review it.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')}>
          Back to Appraisals
        </Button>
      </Box>
    );
  }

  if (!isEditable) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Self-Assessment Unavailable</Typography>
          <Typography variant="body2">
            This appraisal is currently in <strong>{appraisal.status.replace(/_/g, ' ')}</strong> status,
            so self-assessment editing is closed.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)}>
          Back to Appraisal
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2.5 },
          mb: 3,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.25),
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.86)} 100%)`
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box>
            <Button
              startIcon={<ArrowBack />}
              onClick={() => router.push('/appraisals')}
              sx={{ mb: 1, borderRadius: 999 }}
              variant="outlined"
              size="small"
            >
              Back to Appraisals
            </Button>
            <Typography variant="h4" fontWeight={700}>
              Self-Assessment
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {appraisal.cycleId?.name || 'Performance Review'}
            </Typography>
          </Box>
          <Chip
            icon={<AutoAwesome />}
            color="primary"
            variant="outlined"
            label="Conversational Mode"
            sx={{ fontWeight: 600 }}
          />
        </Box>
      </Paper>

      {/* Deadline Warning */}
      {appraisal.deadlines?.selfAssessmentDue && (
        <Alert
          severity={new Date(appraisal.deadlines.selfAssessmentDue) < new Date() ? 'error' : 'info'}
          sx={{ mb: 3 }}
        >
          Due: {new Date(appraisal.deadlines.selfAssessmentDue).toLocaleDateString()}
          {new Date(appraisal.deadlines.selfAssessmentDue) < new Date() && ' (OVERDUE)'}
        </Alert>
      )}

      {/* Conversational Interface */}
      <Fade in>
        <Box>
          <ConversationalAssessment
            appraisalId={appraisalId}
            onComplete={handleConversationComplete}
          />
        </Box>
      </Fade>
    </Box>
  );
}
