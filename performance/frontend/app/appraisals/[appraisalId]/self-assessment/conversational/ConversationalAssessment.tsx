'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Alert, CircularProgress, Button, Typography, Snackbar, Chip } from '@mui/material';
import { PlayArrow, AutoAwesome } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import api from '@/lib/api';
import ChatInterface from './ChatInterface';
import PhaseProgress from './PhaseProgress';
import ReportPreview from './ReportPreview';

interface Message {
  messageId?: string;
  sender: {
    userId: string;
    name: string;
    role: 'employee' | 'manager' | 'hr' | 'ai' | 'system';
  };
  message: string;
  messageType: string;
  phase?: string;
  linkedDocumentId?: string;
  structuredData?: {
    type: string;
    data: any;
  };
  aiContext?: {
    isAiGenerated: boolean;
    modelUsed?: string;
    confidence?: number;
  };
  createdAt: string | Date;
}

interface OKRSummary {
  id: string;
  title: string;
  progress: number;
  objectives?: any[];
}

interface ConversationState {
  mode: string;
  currentPhase: string;
  currentOkrIndex: number;
  completedPhases: string[];
  extractedData: {
    achievements: any[];
    challenges: any[];
    skills: any[];
    goals: any[];
  };
  startedAt?: string;
  lastActivityAt?: string;
  messageCount: number;
}

interface ReportData {
  overallSummary: {
    achievements: string;
    challenges: string;
    learnings: string;
    improvements: string;
    goals: string;
  };
  okrAssessment?: any[];
  // AI suggestion (not the employee's final self-rating)
  suggestedOverallRating: number | null;
  ratingJustification: string;
  aiSuggestedRating?: {
    suggestedRating: number;
    ratingJustification: string;
    confidence?: number;
    keyStrengths?: string[];
    developmentAreas?: string[];
    calibrationNotes?: string;
  };

  // Employee-provided self-rating
  overallSelfRating?: number;

  // Optional guidance if the report is missing key info
  missingInfo?: string[];
  aiInsights: {
    strengths: string[];
    developmentAreas: string[];
    suggestions: string[];
    sentiment: string;
  };
}

interface ConversationalAssessmentProps {
  appraisalId: string;
  onComplete?: () => void;
}

export default function ConversationalAssessment({ appraisalId, onComplete }: ConversationalAssessmentProps) {
  const theme = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  const [okrSummary, setOkrSummary] = useState<OKRSummary[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [requireSelfRating, setRequireSelfRating] = useState(true);
  const [allowReviewConversation, setAllowReviewConversation] = useState(false);
  const [reviewAutoGenerateAttempted, setReviewAutoGenerateAttempted] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const findLatestReportInThread = useCallback((thread: Message[] = []) => {
    const reportMessage = [...thread]
      .reverse()
      .find((m) => m.structuredData?.type === 'report' && m.structuredData?.data);
    return reportMessage?.structuredData?.data || null;
  }, []);

  // Load existing conversation or initialize
  const loadConversation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Try to get existing conversation context
      const response = await api.get(`/appraisals/${appraisalId}/conversation/context`);
      const data = response.data.data;
      setRequireSelfRating(data?.cycle?.settings?.allowSelfRating !== false);

      if (data.conversationState && data.chatThread && data.chatThread.length > 0) {
        // Resume existing conversation
        setConversationState(data.conversationState);
        setMessages(data.chatThread);
        setOkrSummary(data.okrs?.map((okr: any) => ({
          id: okr._id,
          title: okr.title || okr.objectives?.[0]?.title || 'Untitled OKR',
          progress: okr.progress || 0,
          objectives: okr.objectives
        })) || []);

        // Check if we should show report
        if (data.conversationState.currentPhase === 'review' || data.conversationState.currentPhase === 'completed') {
          const latestReport = findLatestReportInThread(data.chatThread || []);
          if (latestReport) {
            setReport(latestReport);
            setShowReport(true);
          }
        }
      }
    } catch (err: any) {
      console.error('Load conversation error:', err);
      // Not an error - conversation hasn't started yet
    } finally {
      setIsLoading(false);
    }
  }, [appraisalId, findLatestReportInThread]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // Start a new conversation
  const startConversation = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/start`);
      const data = response.data.data;

      setConversationState(data.conversationState);
      setMessages(data.chatThread || []);
      setOkrSummary(data.okrSummary || []);
      setSnackbar({ open: true, message: 'Conversation started!', severity: 'success' });
    } catch (err: any) {
      console.error('Start conversation error:', err);
      setError(err.response?.data?.error || 'Failed to start conversation');
      setSnackbar({ open: true, message: 'Failed to start conversation', severity: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Send a message
  const handleSendMessage = async (message: string) => {
    setIsProcessing(true);
    const isReviewPhase = conversationState?.currentPhase === 'review' || conversationState?.currentPhase === 'report_generation';

    // If user continues chatting in review mode, invalidate any existing draft until report is regenerated.
    if (isReviewPhase && report) {
      setReport(null);
      setShowReport(false);
      setReviewAutoGenerateAttempted(false);
    }

    // Optimistically add user message
    const userMessage: Message = {
      sender: { userId: 'self', name: 'You', role: 'employee' },
      message,
      messageType: 'text',
      phase: conversationState?.currentPhase,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/message`, { message });
      const data = response.data.data;

      // Update with AI response
      setMessages(data.chatThread || []);
      setConversationState(data.conversationState);

      // Check if we should transition to report generation
      if (data.currentPhase === 'report_generation') {
        await generateReport();
      }
    } catch (err: any) {
      console.error('Send message error:', err);
      setError(err.response?.data?.error || 'Failed to send message');
      // Remove optimistic message on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsProcessing(false);
    }
  };

  // Upload a document
  const handleUploadFile = async (file: File) => {
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', 'achievement_evidence');

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const data = response.data.data;

      setMessages(data.chatThread || []);
      setSnackbar({ open: true, message: `Document "${file.name}" uploaded and analyzed`, severity: 'success' });
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Failed to upload document');
      setSnackbar({ open: true, message: 'Failed to upload document', severity: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate report
  const generateReport = useCallback(async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/generate-report`);
      const data = response.data.data;

      setReport(data.report);
      setConversationState(data.conversationState);
      setMessages(prev => [...prev, ...data.chatThread.slice(-2)]);
      setShowReport(true);
      setReviewAutoGenerateAttempted(true);
      setAllowReviewConversation(false);
    } catch (err: any) {
      console.error('Generate report error:', err);
      setError(err.response?.data?.error || 'Failed to generate report');
    } finally {
      setIsRegenerating(false);
    }
  }, [appraisalId, isRegenerating]);

  const openReportPreview = useCallback(async () => {
    if (report) {
      setShowReport(true);
      return;
    }
    await generateReport();
  }, [report, generateReport]);

  // Edit report
  const handleEditReport = (field: string, value: string) => {
    if (!report) return;

    const fields = field.split('.');
    const newReport = { ...report };

    if (fields.length === 2 && fields[0] === 'overallSummary') {
      (newReport.overallSummary as any)[fields[1]] = value;
    } else if (field === 'overallSelfRating') {
      const normalized = value?.trim();
      if (!normalized) {
        newReport.overallSelfRating = undefined;
      } else {
        const parsed = Number(normalized);
        newReport.overallSelfRating = Number.isNaN(parsed) ? undefined : parsed;
      }
    }

    setReport(newReport);
  };

  // Submit report
  const handleSubmitReport = async () => {
    if (!report) return;

    setIsSubmitting(true);

    try {
      await api.post(`/appraisals/${appraisalId}/conversation/finalize-report`, { report });
      setSnackbar({ open: true, message: 'Self-assessment submitted successfully!', severity: 'success' });
      setConversationState(prev => prev ? { ...prev, currentPhase: 'completed' } : null);
      onComplete?.();
    } catch (err: any) {
      console.error('Submit report error:', err);
      const errorMessage = err.response?.data?.error || 'Failed to submit report';
      setError(errorMessage);
      setSnackbar({ open: true, message: errorMessage, severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOkrSelect = (index: number) => {
    if (!conversationState || conversationState.currentOkrIndex === index) return;

    const okr = okrSummary[index];
    if (okr) {
      // Optimistically update UI
      setConversationState(prev => prev ? ({ ...prev, currentOkrIndex: index }) : null);

      // Send message to switch context
      handleSendMessage(`I want to discuss the OKR: "${okr.title}"`);
    }
  };

  useEffect(() => {
    setAllowReviewConversation(false);
    setReviewAutoGenerateAttempted(false);
  }, [appraisalId]);

  useEffect(() => {
    const phase = conversationState?.currentPhase;
    if (!phase) return;

    if (phase !== 'review' && phase !== 'report_generation') {
      setAllowReviewConversation(false);
      setReviewAutoGenerateAttempted(false);
      return;
    }

    const shouldAutoGenerate = !report
      && !isRegenerating
      && !reviewAutoGenerateAttempted
      && !allowReviewConversation;

    if (shouldAutoGenerate) {
      setReviewAutoGenerateAttempted(true);
      generateReport();
    }
  }, [
    appraisalId,
    conversationState?.currentPhase,
    report,
    isRegenerating,
    reviewAutoGenerateAttempted,
    allowReviewConversation,
    generateReport
  ]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Not started - show start button
  if (!conversationState || messages.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Start Your Self-Assessment
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 500, mx: 'auto' }}>
          Have a conversation with our AI assistant to complete your self-assessment.
          We will guide you through reflecting on your OKRs, achievements, challenges, and goals.
        </Typography>
        <Button
          variant="contained"
          size="large"
          startIcon={isProcessing ? <CircularProgress size={20} color="inherit" /> : <PlayArrow />}
          onClick={startConversation}
          disabled={isProcessing}
        >
          Begin Conversation
        </Button>
        {error && (
          <Alert severity="error" sx={{ mt: 2, maxWidth: 400, mx: 'auto' }}>
            {error}
          </Alert>
        )}
      </Box>
    );
  }

  // Show report preview
  if (showReport && report) {
    return (
      <Box>
        <Button
          variant="outlined"
          onClick={() => setShowReport(false)}
          sx={{ mb: 2, borderRadius: 999 }}
        >
          Back to Conversation
        </Button>
        <ReportPreview
          report={report}
          onEdit={handleEditReport}
          onSubmit={handleSubmitReport}
          onRegenerate={generateReport}
          isSubmitting={isSubmitting}
          isRegenerating={isRegenerating}
          requireSelfRating={requireSelfRating}
        />
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          message={snackbar.message}
        />
      </Box>
    );
  }

  // Main conversation view
  return (
    <Box>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 2,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.22),
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.86)} 100%)`
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Conversational Assistant
            </Typography>
            <Typography variant="h5" sx={{ mt: -0.5 }}>
              Guided Self-Assessment
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Share your outcomes and reflections. We will draft a report you can refine before submitting.
            </Typography>
          </Box>
          <Chip
            icon={<AutoAwesome />}
            color="primary"
            variant="outlined"
            label={conversationState?.currentPhase?.replace(/_/g, ' ') || 'okr reflection'}
            sx={{ textTransform: 'capitalize', fontWeight: 600 }}
          />
        </Box>
      </Paper>

      <Box
        sx={{
          display: { xs: 'block', md: 'flex' },
          height: { xs: 'auto', md: 'calc(100vh - 280px)' },
          minHeight: { md: 620 },
          borderRadius: 3,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.paper, 0.84),
          backdropFilter: 'blur(8px)'
        }}
      >
      {/* Progress Sidebar */}
      <Paper
        elevation={0}
        sx={{
          width: { xs: '100%', md: 280 },
          flexShrink: 0,
          borderRight: { xs: 0, md: 1 },
          borderBottom: { xs: 1, md: 0 },
          borderColor: 'divider',
          overflow: 'auto',
          maxHeight: { xs: 280, md: 'none' },
          mb: { xs: 2, md: 0 }
        }}
      >
        <PhaseProgress
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          completedPhases={conversationState?.completedPhases || []}
          okrs={okrSummary}
          extractedData={conversationState?.extractedData || { achievements: [], challenges: [], skills: [], goals: [] }}
          currentOkrIndex={conversationState?.currentOkrIndex || 0}
          onOkrSelect={handleOkrSelect}
        />

        {/* Quick Actions */}
        {(conversationState?.currentPhase === 'review' || conversationState?.currentPhase === 'report_generation') && (
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Button
                fullWidth
                variant="contained"
                onClick={openReportPreview}
                disabled={isRegenerating}
                sx={{ borderRadius: 999 }}
              >
                {isRegenerating ? 'Generating Report...' : report ? 'View Report' : 'Generate Report'}
              </Button>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => setAllowReviewConversation(prev => !prev)}
                sx={{ borderRadius: 999 }}
              >
                {allowReviewConversation ? 'Pause Conversation' : 'Continue Conversation'}
              </Button>
            </Box>
          </Box>
        )}
      </Paper>

      {/* Chat Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: { xs: 520, md: 'auto' } }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {(conversationState?.currentPhase === 'review' || conversationState?.currentPhase === 'report_generation') && !showReport && (
          <Alert severity="info" sx={{ mx: 2, mt: 2, mb: 0 }}>
            We have enough input to generate your report. Use `Generate Report`, or choose `Continue Conversation` to add more details first.
          </Alert>
        )}
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          onUploadFile={handleUploadFile}
          isLoading={isProcessing}
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          disabled={
            conversationState?.currentPhase === 'completed'
            || (
              (conversationState?.currentPhase === 'review' || conversationState?.currentPhase === 'report_generation')
              && !allowReviewConversation
            )
          }
          canAdvancePhase={false}
        />
      </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
