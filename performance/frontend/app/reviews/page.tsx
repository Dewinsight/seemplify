'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useReviews } from '@/lib/hooks';
import {
  Box, Typography, Button, Card, CardContent, Chip, Avatar,
  Stepper, Step, StepLabel, LinearProgress, Divider, TextField,
  IconButton, Alert, Grid, alpha, useTheme
} from '@mui/material';
import { PlayArrow, Visibility, AutoFixHigh, ArrowBack, CheckCircle, RateReview } from '@mui/icons-material';
import { useState } from 'react';
import { gradients } from '../theme';

export default function ReviewsPage() {
  const theme = useTheme();
  const { reviews, isLoading } = useReviews();
  const [activeReview, setActiveReview] = useState<any>(null);
  const [aiText, setAiText] = useState('');

  // Mock AI enhancement
  const handleAiImprove = () => {
    setAiText("Improved: " + aiText + " (This employee consistently demonstrates strong leadership...)");
  };

  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3, mb: 3 }}>Performance Reviews</Typography>
        <LinearProgress sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  // Use real data only - no fallback
  const data = reviews || [];

  if (activeReview) {
    return (
      <Box className="animate-fadeIn" maxWidth="lg" sx={{ mx: 'auto' }}>
        <Button
          onClick={() => setActiveReview(null)}
          startIcon={<ArrowBack />}
          sx={{ mb: 3 }}
        >
          Back to List
        </Button>

        <Typography
          variant="h4"
          fontWeight={800}
          gutterBottom
          sx={{
            background: gradients.primary,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {activeReview.cycleName}
        </Typography>

        <Stepper
          activeStep={1}
          sx={{
            mb: 4,
            p: 3,
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            borderRadius: 3,
          }}
        >
          {['Self Review', 'Manager Review', 'Discussion', 'Sign-off'].map((label, index) => (
            <Step key={label}>
              <StepLabel
                sx={{
                  '& .MuiStepLabel-iconContainer': {
                    '& .MuiStepIcon-root': {
                      fontSize: 28,
                    },
                    '& .MuiStepIcon-root.Mui-active': {
                      color: 'primary.main',
                      filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))',
                    },
                    '& .MuiStepIcon-root.Mui-completed': {
                      color: 'success.main',
                    },
                  },
                }}
              >
                <Typography fontWeight={index === 1 ? 600 : 400}>{label}</Typography>
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        <Card
          sx={{
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: gradients.primary,
            },
          }}
        >
          <CardContent sx={{ pt: 4 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>Self Reflection</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              What were your key achievements this quarter?
            </Typography>

            <Box sx={{ position: 'relative' }}>
              <TextField
                fullWidth
                multiline
                rows={6}
                variant="outlined"
                placeholder="I successfully delivered..."
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: alpha(theme.palette.grey[500], 0.02),
                  },
                }}
              />
              <IconButton
                onClick={handleAiImprove}
                title="AI Improve Writing"
                sx={{
                  position: 'absolute',
                  right: 12,
                  bottom: 12,
                  bgcolor: alpha(theme.palette.secondary.main, 0.1),
                  color: 'secondary.main',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.secondary.main, 0.2),
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <AutoFixHigh />
              </IconButton>
            </Box>

            <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
              <Button variant="outlined">Save Draft</Button>
              <Button variant="contained" endIcon={<CheckCircle />}>Submit Review</Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box className="animate-fadeIn">
      <Box sx={{ mb: 4 }}>
        <Typography
          variant="h4"
          fontWeight={800}
          sx={{
            background: gradients.primary,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Performance Reviews
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          Complete your performance reviews and track your progress
        </Typography>
      </Box>

      {data.length === 0 ? (
        <Card
          sx={{
            p: 6,
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.05) 100%)',
            border: `2px dashed ${alpha(theme.palette.primary.main, 0.2)}`,
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: 3,
              background: gradients.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3,
              boxShadow: '0 12px 32px -8px rgba(99, 102, 241, 0.4)',
            }}
          >
            <RateReview sx={{ fontSize: 40, color: 'white' }} />
          </Box>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            No Reviews Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Performance reviews will appear here when a review cycle is started by your manager or HR.
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {data.map((review: any) => (
            <Grid key={review._id} size={{ xs: 12 }}>
              <Card
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: theme.shadows[8],
                  },
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    background: review.status === 'Completed'
                      ? 'linear-gradient(180deg, #10b981 0%, #34d399 100%)'
                      : review.status === 'In Progress'
                        ? gradients.primary
                        : alpha(theme.palette.grey[400], 0.5),
                  },
                }}
              >
                <CardContent sx={{ pl: 4 }}>
                  <Box sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    alignItems: { xs: 'flex-start', md: 'center' },
                    gap: 2
                  }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" fontWeight={600}>{review.cycleName || 'Review Cycle'}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Due: {review.dueDate || 'Not set'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={review.status || 'Pending'}
                        sx={{
                          fontWeight: 600,
                          background: review.status === 'Completed'
                            ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)'
                            : review.status === 'In Progress'
                              ? gradients.primary
                              : alpha(theme.palette.grey[400], 0.2),
                          color: review.status === 'Completed' || review.status === 'In Progress'
                            ? 'white'
                            : 'text.secondary',
                        }}
                      />
                      <Chip
                        label={review.type || 'Review'}
                        variant="outlined"
                        sx={{ borderColor: alpha(theme.palette.grey[400], 0.5) }}
                      />
                    </Box>
                    <Box sx={{ flexShrink: 0 }}>
                      {review.status === 'In Progress' ? (
                        <Button
                          variant="contained"
                          startIcon={<PlayArrow />}
                          onClick={() => setActiveReview(review)}
                        >
                          Continue
                        </Button>
                      ) : (
                        <Button
                          variant="outlined"
                          startIcon={<Visibility />}
                          onClick={() => setActiveReview(review)}
                        >
                          View
                        </Button>
                      )}
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
