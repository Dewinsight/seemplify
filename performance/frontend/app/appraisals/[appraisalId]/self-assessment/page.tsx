'use client';

import { useRouter, useParams } from 'next/navigation';
import { useAppraisal } from '@/lib/hooks';
import { Box, Typography, Button, Alert, CircularProgress, Fade } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import ConversationalAssessment from './conversational/ConversationalAssessment';

export default function SelfAssessmentPage() {
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

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => router.push('/appraisals')}
            sx={{ mb: 1 }}
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
      </Box>

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
