'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Alert, CircularProgress, Button, Typography, Snackbar } from '@mui/material';
import { PlayArrow } from '@mui/icons-material';
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
  suggestedOverallRating: number;
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
          // Find the latest report draft in the thread (if any)
          const reportMessage = [...(data.chatThread || [])]
            .reverse()
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
    } else if (field === 'overallSelfRating') {
      newReport.overallSelfRating = parseInt(value);
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
    <Box
      sx={{
        display: { xs: 'block', md: 'flex' },
        height: { xs: 'auto', md: 'calc(100vh - 220px)' },
        minHeight: { md: 620 }
      }}
    >
      {/* Progress Sidebar */}
      <Paper
        elevation={1}
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
        {conversationState?.currentPhase === 'review' && (
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            <Button fullWidth variant="contained" onClick={() => setShowReport(true)}>
              View Report
            </Button>
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
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          onUploadFile={handleUploadFile}
          isLoading={isProcessing}
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          disabled={conversationState?.currentPhase === 'completed'}
          canAdvancePhase={false}
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
