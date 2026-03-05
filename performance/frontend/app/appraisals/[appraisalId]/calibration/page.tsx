'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Rating,
  Snackbar,
  TextField,
  Typography
} from '@mui/material';
import { ArrowBack, CheckCircle, Person, Save, Star, TrendingUp } from '@mui/icons-material';

export default function CalibrationPage() {
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;

  const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);
  const { user, isManager, isHRAdmin } = useUserContext();

  const [calibratedRating, setCalibratedRating] = useState<number>(3);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const isAssignedManager = useMemo(() => {
    if (!appraisal || !user) return false;
    return appraisal.manager?.userId === user?.id || appraisal.manager?.email === user?.email;
  }, [appraisal, user]);
  const hasManagerAccess = isAssignedManager || (!!isManager && !isHRAdmin);

  const minRating = appraisal?.cycleId?.ratingScale?.min ?? 1;
  const maxRating = appraisal?.cycleId?.ratingScale?.max ?? 5;

  useEffect(() => {
    if (!appraisal) return;
    const defaultRating = appraisal.calibration?.calibratedRating || appraisal.managerReview?.overallManagerRating || 3;
    setCalibratedRating(defaultRating);
    setJustification(appraisal.calibration?.justification || '');
  }, [appraisal]);

  const persistCalibration = async (submit: boolean) => {
    if (calibratedRating < minRating || calibratedRating > maxRating) {
      setSnackbar({
        open: true,
        message: `Rating must be between ${minRating} and ${maxRating}`,
        severity: 'error'
      });
      return;
    }

    if (submit) {
      setSubmitting(true);
    } else {
      setSaving(true);
    }

    try {
      await api.post(`/appraisals/${appraisalId}/calibration`, {
        calibration: {
          calibratedRating,
          justification: justification.trim() || undefined
        },
        submit
      });

      await mutate();
      setSnackbar({
        open: true,
        message: submit ? 'Calibration submitted. Appraisal moved to Final Review.' : 'Calibration progress saved.',
        severity: 'success'
      });

      if (submit) {
        setTimeout(() => router.push(`/appraisals/${appraisalId}/final-review`), 800);
      }
    } catch (e: unknown) {
      const axiosError = e as { response?: { data?: { error?: string } } };
      setSnackbar({
        open: true,
        message: axiosError?.response?.data?.error || 'Failed to save calibration',
        severity: 'error'
      });
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!appraisal) {
    return <Alert severity="error">Appraisal not found</Alert>;
  }

  if (!(hasManagerAccess || isHRAdmin)) {
    return <Alert severity="error">Only an authorized appraiser can access calibration.</Alert>;
  }

  if (!appraisal.managerReview?.submittedAt) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 3 }}>
          Manager review must be submitted before calibration can begin.
        </Alert>
        <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)}>
          Back to Appraisal
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)} sx={{ mb: 2 }}>
        Back to Appraisal
      </Button>

      <Paper sx={{ p: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h5" fontWeight={700}>Calibration</Typography>
            <Typography variant="body2" color="text.secondary">
              Align manager ratings for fairness before final review.
            </Typography>
          </Box>
          <Chip
            icon={<TrendingUp />}
            color={appraisal.status === 'final_review_pending' ? 'success' : 'warning'}
            label={appraisal.status.replace(/_/g, ' ')}
            sx={{ textTransform: 'capitalize' }}
          />
        </Box>

        {appraisal.status === 'final_review_pending' && appraisal.calibration?.calibratedAt && (
          <Alert severity="success" sx={{ mb: 3 }}>
            Calibration already submitted on {new Date(appraisal.calibration.calibratedAt).toLocaleDateString()}.
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CheckCircle />}
                onClick={() => router.push(`/appraisals/${appraisalId}/final-review`)}
              >
                Continue to Final Review
              </Button>
            </Box>
          </Alert>
        )}

        <Card sx={{ mb: 3, bgcolor: 'action.hover' }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Rating Inputs
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Chip
                icon={<Person />}
                label={`Self: ${appraisal.selfAssessment?.overallSelfRating ?? 'N/A'}`}
                variant={appraisal.selfAssessment?.overallSelfRating ? 'filled' : 'outlined'}
              />
              <Chip
                icon={<Star />}
                label={`Manager: ${appraisal.managerReview?.overallManagerRating ?? 'N/A'}`}
                variant={appraisal.managerReview?.overallManagerRating ? 'filled' : 'outlined'}
              />
              {appraisal.calibration?.calibratedRating !== undefined && appraisal.calibration?.calibratedRating !== null && (
                <Chip
                  color="info"
                  label={`Current Calibrated: ${appraisal.calibration.calibratedRating}`}
                />
              )}
            </Box>
          </CardContent>
        </Card>

        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Calibrated Rating ({minRating} to {maxRating})
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Rating
            value={calibratedRating}
            onChange={(_, value) => setCalibratedRating(value || calibratedRating)}
            max={maxRating}
            sx={{ '& .MuiRating-iconFilled': { color: 'primary.main' } }}
          />
          <Chip label={`${calibratedRating}/${maxRating}`} color="primary" />
        </Box>

        <TextField
          fullWidth
          multiline
          minRows={4}
          label="Calibration Justification"
          placeholder="Explain why the rating is being adjusted (or confirmed) based on cross-team calibration context."
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          sx={{ mb: 3 }}
        />

        <Alert severity="info" sx={{ mb: 3 }}>
          Submit calibration to move this appraisal to Final Review.
        </Alert>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={saving ? <CircularProgress size={18} /> : <Save />}
            onClick={() => persistCalibration(false)}
            disabled={saving || submitting}
          >
            Save Draft
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircle />}
            onClick={() => persistCalibration(true)}
            disabled={saving || submitting}
          >
            Submit Calibration
          </Button>
        </Box>
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
