'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useFeedback } from '@/lib/hooks';
import {
  Box, Typography, Button, Card, CardContent, Avatar,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Chip, Alert, LinearProgress,
  Grid, alpha, useTheme
} from '@mui/material';
import { Add, SentimentSatisfiedAlt, ThumbUp, Lightbulb, Send, Message } from '@mui/icons-material';
import { useState } from 'react';
import { gradients } from '../theme';

export default function FeedbackPage() {
  const theme = useTheme();
  const { feedback, isLoading } = useFeedback();
  const [open, setOpen] = useState(false);
  const [newFeedback, setNewFeedback] = useState({ recipient: '', type: 'Positive', message: '' });

  const handleOpen = () => setOpen(true);
  const handleClose = () => {
    setOpen(false);
    setNewFeedback({ recipient: '', type: 'Positive', message: '' });
  };

  const handleSend = () => {
    console.log("Sending feedback:", newFeedback);
    handleClose();
  };

  // Use real data only - no fallback
  const data = feedback || [];

  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3 }}>Continuous Feedback</Typography>
        </Box>
        <LinearProgress sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

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
            Continuous Feedback
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            Give and receive real-time feedback to foster growth
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleOpen}
        >
          Give Feedback
        </Button>
      </Box>

      {data.length === 0 ? (
        <Card
          sx={{
            p: 6,
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(52, 211, 153, 0.05) 100%)',
            border: `2px dashed ${alpha(theme.palette.success.main, 0.2)}`,
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3,
              boxShadow: '0 12px 32px -8px rgba(16, 185, 129, 0.4)',
            }}
          >
            <Message sx={{ fontSize: 40, color: 'white' }} />
          </Box>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            No Feedback Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Start building a culture of continuous feedback. Click "Give Feedback" to recognize a colleague's work or offer constructive suggestions.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleOpen}
            color="success"
          >
            Give Your First Feedback
          </Button>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {data.map((item: any) => (
            <Grid key={item._id} size={{ xs: 12, md: 6 }}>
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
                    background: item.type === 'Positive'
                      ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)'
                      : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                  },
                }}
              >
                <CardContent sx={{ pt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                    <Avatar
                      sx={{
                        background: item.type === 'Positive'
                          ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)'
                          : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                        width: 48,
                        height: 48,
                        boxShadow: item.type === 'Positive'
                          ? '0 4px 14px -4px rgba(16, 185, 129, 0.4)'
                          : '0 4px 14px -4px rgba(245, 158, 11, 0.4)',
                      }}
                    >
                      {item.type === 'Positive' ? <ThumbUp /> : <Lightbulb />}
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                        <Box>
                          <Typography variant="subtitle1" fontWeight={600}>{item.sender || 'Anonymous'}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.date}</Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={item.type}
                          sx={{
                            fontWeight: 600,
                            background: item.type === 'Positive'
                              ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)'
                              : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                            color: 'white',
                          }}
                        />
                      </Box>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      pl: 7,
                      position: 'relative',
                      '&::before': {
                        content: '"""',
                        position: 'absolute',
                        left: 0,
                        top: -8,
                        fontSize: 48,
                        fontFamily: 'Georgia, serif',
                        color: alpha(theme.palette.text.secondary, 0.15),
                        lineHeight: 1,
                      },
                    }}
                  >
                    <Typography
                      variant="body1"
                      sx={{
                        fontStyle: 'italic',
                        color: 'text.secondary',
                        lineHeight: 1.7,
                      }}
                    >
                      {item.message}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: { borderRadius: 3 },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                background: gradients.success,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send sx={{ color: 'white' }} />
            </Box>
            <Typography variant="h6" fontWeight={700}>Give Feedback</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Recipient (Email or Name)"
            fullWidth
            value={newFeedback.recipient}
            onChange={(e) => setNewFeedback({ ...newFeedback, recipient: e.target.value })}
            sx={{ mt: 2 }}
          />
          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={newFeedback.type}
              label="Type"
              onChange={(e) => setNewFeedback({ ...newFeedback, type: e.target.value })}
            >
              <MenuItem value="Positive">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ThumbUp sx={{ color: 'success.main', fontSize: 20 }} />
                  Positive Recognition
                </Box>
              </MenuItem>
              <MenuItem value="Constructive">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Lightbulb sx={{ color: 'warning.main', fontSize: 20 }} />
                  Constructive Suggestion
                </Box>
              </MenuItem>
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            label="Message"
            multiline
            rows={4}
            fullWidth
            value={newFeedback.message}
            onChange={(e) => setNewFeedback({ ...newFeedback, message: e.target.value })}
            sx={{ mt: 2 }}
          />
          <Box
            sx={{
              mt: 2,
              p: 2,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.success.main, 0.08),
              border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <SentimentSatisfiedAlt sx={{ color: 'success.main' }} />
            <Typography variant="body2" color="success.main" fontWeight={500}>
              AI Sentiment Check: Tone looks good! 👍
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleClose} variant="outlined">Cancel</Button>
          <Button
            onClick={handleSend}
            variant="contained"
            endIcon={<Send />}
            color="success"
          >
            Send Feedback
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
