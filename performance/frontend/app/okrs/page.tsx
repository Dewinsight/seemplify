'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useOkrs } from '@/lib/hooks';
import {
  Box, Typography, Button, Card, CardContent, LinearProgress,
  Dialog, DialogTitle, DialogContent, TextField, DialogActions,
  IconButton, Chip, Alert, Grid, alpha, useTheme
} from '@mui/material';
import { Add, Edit, Delete, AutoAwesome, AccountTree, Flag, TrendingUp } from '@mui/icons-material';
import api from '@/lib/api';
import Link from 'next/link';
import { gradients } from '../theme';

export default function OKRPage() {
  const theme = useTheme();
  const { okrs, isLoading, isError, mutate } = useOkrs();
  const [open, setOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [currentOkr, setCurrentOkr] = useState<any>({ title: '', objective: '', keyResults: [''] });

  const handleOpen = () => setOpen(true);
  const handleClose = () => {
    setOpen(false);
    setCurrentOkr({ title: '', objective: '', keyResults: [''] });
  };

  const handleAiSuggest = async () => {
    setIsAiLoading(true);
    try {
      // Mock AI Call - Replace with actual endpoint
      setTimeout(() => {
        setCurrentOkr({
          title: "Improve Code Quality",
          objective: "Increase code coverage and reduce technical debt to ensure long-term maintainability.",
          keyResults: [
            "Achieve 85% unit test coverage across all microservices",
            "Reduce critical SonarQube bugs to 0",
            "Refactor legacy auth module"
          ]
        });
        setIsAiLoading(false);
      }, 1500);

    } catch (error) {
      console.error("AI Suggestion failed", error);
      setIsAiLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (currentOkr._id) {
        await api.put(`/okrs/${currentOkr._id}`, currentOkr);
      } else {
        await api.post('/okrs', currentOkr);
      }
      mutate();
      handleClose();
    } catch (e) {
      console.error("Failed to save OKR", e);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3 }}>
              Objectives & Key Results
            </Typography>
          </Box>
        </Box>
        <LinearProgress sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error" sx={{ borderRadius: 3 }}>Failed to load OKRs. Please try again.</Alert>;
  }

  // Use real data only - no fallback
  const data = okrs || [];

  // Helper function to get progress color
  const getProgressColor = (progress: number) => {
    if (progress >= 70) return 'success';
    if (progress >= 40) return 'warning';
    return 'error';
  };

  const getProgressGradient = (progress: number) => {
    if (progress >= 70) return 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
    if (progress >= 40) return 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
    return 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
  };

  return (
    <Box className="animate-fadeIn">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            sx={{
              background: gradients.primary,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Objectives & Key Results
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            Track your goals and measure progress with OKRs
          </Typography>
        </Box>
        <Box display="flex" gap={1.5}>
          <Button
            component={Link}
            href="/okrs/alignment"
            variant="outlined"
            startIcon={<AccountTree />}
            sx={{
              borderWidth: 1.5,
              '&:hover': { borderWidth: 1.5 },
            }}
          >
            View Alignment
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleOpen}
          >
            New OKR
          </Button>
        </Box>
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
            <Flag sx={{ fontSize: 40, color: 'white' }} />
          </Box>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            No OKRs Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Start tracking your objectives and key results. Click "New OKR" to create your first goal.
          </Typography>
          <Button variant="contained" startIcon={<Add />} onClick={handleOpen}>
            Create Your First OKR
          </Button>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {data.map((okr: any) => {
            const progress = okr.progress || 0;
            const progressColor = getProgressColor(progress);
            const progressGradient = getProgressGradient(progress);

            return (
              <Grid key={okr._id} size={{ xs: 12, md: 6 }}>
                <Card
                  sx={{
                    height: '100%',
                    position: 'relative',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: theme.shadows[12],
                    },
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
                  <CardContent sx={{ pt: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ flex: 1, pr: 2 }}>
                        <Typography variant="h6" fontWeight={700}>{okr.title}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
                          {okr.objective}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton
                          size="small"
                          sx={{
                            bgcolor: alpha(theme.palette.primary.main, 0.08),
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.12) },
                          }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          sx={{
                            bgcolor: alpha(theme.palette.error.main, 0.08),
                            color: 'error.main',
                            '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.12) },
                          }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>

                    {/* Progress Section */}
                    <Box sx={{ mt: 3, mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                          Progress
                        </Typography>
                        <Chip
                          size="small"
                          label={`${progress}%`}
                          sx={{
                            fontWeight: 700,
                            height: 24,
                            background: progressGradient,
                            color: 'white',
                          }}
                        />
                      </Box>
                      <Box
                        sx={{
                          position: 'relative',
                          height: 10,
                          bgcolor: alpha(theme.palette.grey[500], 0.1),
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            height: '100%',
                            width: `${progress}%`,
                            background: progressGradient,
                            borderRadius: 2,
                            transition: 'width 0.5s ease',
                            '&::after': {
                              content: '""',
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                              animation: 'shimmer 2s infinite',
                            },
                          }}
                        />
                      </Box>
                    </Box>

                    {/* Key Results */}
                    <Box sx={{ mt: 3 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Key Results
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {okr.keyResults?.map((kr: string, i: number) => (
                          <Chip
                            key={i}
                            label={kr}
                            size="small"
                            variant="outlined"
                            sx={{
                              borderColor: alpha(theme.palette.primary.main, 0.3),
                              maxWidth: '100%',
                              '& .MuiChip-label': {
                                whiteSpace: 'normal',
                                lineHeight: 1.4,
                              },
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={700}>
              {currentOkr._id ? 'Edit OKR' : 'Create New OKR'}
            </Typography>
            <Button
              startIcon={<AutoAwesome />}
              onClick={handleAiSuggest}
              disabled={isAiLoading}
              variant="outlined"
              size="small"
              sx={{
                borderColor: alpha(theme.palette.secondary.main, 0.5),
                color: 'secondary.main',
                '&:hover': {
                  borderColor: 'secondary.main',
                  bgcolor: alpha(theme.palette.secondary.main, 0.08),
                },
              }}
            >
              {isAiLoading ? 'Generating...' : 'AI Suggest'}
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Title"
            fullWidth
            value={currentOkr.title}
            onChange={(e) => setCurrentOkr({ ...currentOkr, title: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Objective"
            fullWidth
            multiline
            rows={3}
            value={currentOkr.objective}
            onChange={(e) => setCurrentOkr({ ...currentOkr, objective: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Key Results (comma separated)"
            fullWidth
            value={currentOkr.keyResults?.join(', ')}
            onChange={(e) => setCurrentOkr({ ...currentOkr, keyResults: e.target.value.split(',').map((s: string) => s.trim()) })}
            helperText="AI can help generate specific, measurable results"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleClose} variant="outlined">Cancel</Button>
          <Button onClick={handleSave} variant="contained">Save OKR</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
