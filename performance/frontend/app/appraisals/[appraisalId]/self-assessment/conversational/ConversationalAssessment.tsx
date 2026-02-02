'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Alert, CircularProgress, Button, Typography, Snackbar } from '@mui/material';
import { PlayArrow, Refresh } from '@mui/icons-material';
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
  suggestedOverallRating: number;
  ratingJustification: string;
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
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // Load existing conversation or initialize
  const loadConversation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Try to get existing conversation context
      const response = await api.get(`/appraisals/${appraisalId}/conversation/context`);
      const data = response.data.data;

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
          // Find the report in the last few messages
          const reportMessage = data.chatThread
            .slice(-5)
            .find((m: Message) => m.structuredData?.type === 'report');
          if (reportMessage?.structuredData?.data) {
            setReport(reportMessage.structuredData.data);
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
  }, [appraisalId]);

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
  const generateReport = async () => {
    setIsRegenerating(true);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/generate-report`);
      const data = response.data.data;

      setReport(data.report);
      setConversationState(data.conversationState);
      setMessages(prev => [...prev, ...data.chatThread.slice(-2)]);
      setShowReport(true);
    } catch (err: any) {
      console.error('Generate report error:', err);
      setError(err.response?.data?.error || 'Failed to generate report');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Edit report
  const handleEditReport = (field: string, value: string) => {
    if (!report) return;

    const fields = field.split('.');
    const newReport = { ...report };

    if (fields.length === 2 && fields[0] === 'overallSummary') {
      (newReport.overallSummary as any)[fields[1]] = value;
    } else if (field === 'suggestedOverallRating') {
      newReport.suggestedOverallRating = parseInt(value);
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
      setError(err.response?.data?.error || 'Failed to submit report');
      setSnackbar({ open: true, message: 'Failed to submit report', severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Manual phase advance
  const handleAdvancePhase = async (targetPhase: string) => {
    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/advance`, { targetPhase });
      const data = response.data.data;

      setConversationState(data.conversationState);
      setMessages(data.chatThread);

      if (targetPhase === 'report_generation') {
        await generateReport();
      }
    } catch (err: any) {
      console.error('Advance phase error:', err);
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
          We'll guide you through reflecting on your OKRs, achievements, challenges, and goals.
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
          sx={{ mb: 2 }}
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
    <Box sx={{ display: 'flex', height: 'calc(100vh - 200px)', minHeight: 600 }}>
      {/* Progress Sidebar */}
      <Paper
        elevation={1}
        sx={{
          width: 280,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          overflow: 'auto'
        }}
      >
        <PhaseProgress
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          completedPhases={conversationState?.completedPhases || []}
          okrs={okrSummary}
          extractedData={conversationState?.extractedData || { achievements: [], challenges: [], skills: [], goals: [] }}
          currentOkrIndex={conversationState?.currentOkrIndex || 0}
          onOkrSelect={handleOkrSelect}
          onPhaseClick={handleAdvancePhase}
        />

        {/* Quick Actions */}
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          {conversationState?.currentPhase !== 'report_generation' &&
            conversationState?.currentPhase !== 'review' &&
            conversationState?.currentPhase !== 'completed' && (
              <Button
                fullWidth
                variant="outlined"
                onClick={() => handleAdvancePhase('report_generation')}
                disabled={isProcessing}
              >
                Generate Report Now
              </Button>
            )}
          {conversationState?.currentPhase === 'review' && (
            <Button
              fullWidth
              variant="contained"
              onClick={() => setShowReport(true)}
            >
              View Report
            </Button>
          )}
        </Box>
      </Paper>

      {/* Chat Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          onUploadFile={handleUploadFile}
          onAdvancePhase={() => {
            const currentPhase = conversationState?.currentPhase || 'okr_reflection';
            const phases = ['okr_reflection', 'achievements', 'challenges', 'learnings', 'future_goals', 'report_generation'];
            const currentIndex = phases.indexOf(currentPhase);
            if (currentIndex >= 0 && currentIndex < phases.length - 1) {
              handleAdvancePhase(phases[currentIndex + 1]);
            }
          }}
          isLoading={isProcessing}
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          disabled={conversationState?.currentPhase === 'completed'}
          canAdvancePhase={
            conversationState?.currentPhase &&
            !['report_generation', 'review', 'completed'].includes(conversationState?.currentPhase)
          }
        />
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
