'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useReviews } from '@/lib/hooks';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { RateReview, OpenInNew } from '@mui/icons-material';
import { gradients } from '../theme';

export default function ReviewsPage() {
  const theme = useTheme();
  const router = useRouter();
  const { reviews, isLoading } = useReviews();

  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3, mb: 3 }}>
          Performance Reviews
        </Typography>
        <LinearProgress sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  const data = Array.isArray(reviews) ? reviews : [];

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
          Complete your reviews and track progress through each cycle.
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
            Reviews will appear here when a review cycle is started by your manager or HR.
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {data.map((review: any) => {
            const selfDone = !!review?.selfEvaluation?.submittedAt;
            const managerDone = !!review?.managerEvaluation?.submittedAt;
            const statusColor = managerDone ? 'success' : selfDone ? 'warning' : 'default';

            return (
              <Grid key={review._id} size={{ xs: 12, md: 6 }}>
                <Card
                  sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    border: 1,
                    borderColor: 'divider',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 4,
                      background: gradients.primary,
                      opacity: 0.9,
                    },
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: theme.shadows[8],
                    },
                  }}
                >
                  <CardContent sx={{ pt: 4 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6" fontWeight={700} noWrap>
                          {review.cycleName || 'Review Cycle'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {review.type || 'Review'}{review.dueDate ? ` • Due ${review.dueDate}` : ''}
                        </Typography>
                      </Box>
                      <Chip
                        label={review.status || 'Not Started'}
                        color={statusColor as any}
                        variant="outlined"
                        size="small"
                      />
                    </Box>

                    <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        label={selfDone ? 'Self: Submitted' : 'Self: Pending'}
                        color={selfDone ? 'success' : 'warning'}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={managerDone ? 'Manager: Submitted' : 'Manager: Pending'}
                        color={managerDone ? 'success' : selfDone ? 'warning' : 'default'}
                        size="small"
                        variant="outlined"
                      />
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="contained"
                        endIcon={<OpenInNew />}
                        onClick={() => router.push(`/reviews/${review._id}`)}
                      >
                        Open
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}

