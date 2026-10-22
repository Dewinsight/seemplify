'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Paper, Alert, CircularProgress, Button, Typography, Snackbar, Chip } from '@mui/material';
import { PlayArrow, AutoAwesome } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import api from '@/lib/api';
import ChatInterface from './ChatInterface';
import PhaseProgress from './PhaseProgress';
import ReportPreview from './ReportPreview';
import {
  CycleResponsesReview,
  formatCycleQuestionValue,
  normalizeCycleQuestionProgress,
  type CycleQuestionDefinition,
  type CycleQuestionProgress,
  type CycleQuestionValue,
} from './CycleQuestionFlow';

interface Message {
  _id?: string;
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
    data: unknown;
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
  objectives?: Array<{
    title: string;
    keyResults?: Array<{ title: string; target: number; current: number; progress: number }>;
  }>;
}

interface ConversationState {
  mode: string;
  currentPhase: string;
  currentOkrIndex: number;
  completedPhases: string[];
  extractedData: {
    achievements: Array<{ text: string; confidence?: number }>;
    challenges: Array<{ text: string }>;
    skills: Array<{ skill: string }>;
    goals: Array<{ goal: string }>;
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
  okrAssessment?: Array<{
    okrId: string;
    okrTitle: string;
    completionPercentage: number | null;
    selfComments: string;
  }>;
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
  active?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onAppraisalChanged?: () => Promise<unknown>;
  evidenceBusy?: boolean;
  onComplete?: () => void;
  onChatGptUnavailable?: (message?: string) => void;
}

const CHATGPT_GATE_CODES = new Set([
  'AI_GATEWAY_UNAVAILABLE',
  'AI_REQUEST_FAILED',
  'AI_RUNTIME_ACCOUNT_REQUIRED',
  'CHATGPT_CONNECTION_REQUIRED',
  'CHATGPT_GATEWAY_NOT_CONFIGURED',
  'CHATGPT_GATEWAY_UNAVAILABLE',
  'CHATGPT_UNAVAILABLE',
]);

interface ApiRequestError {
  response?: {
    status?: number;
    data?: {
      code?: string;
      error?: string;
      data?: Record<string, unknown>;
    };
  };
  message?: string;
}

function asApiRequestError(reason: unknown) {
  return reason as ApiRequestError;
}

function chatGptGateFailure(reason: unknown) {
  const error = asApiRequestError(reason);
  const code = error.response?.data?.code || '';
  if (!CHATGPT_GATE_CODES.has(code)) return null;
  return error.response?.data?.error || error.message || 'ChatGPT is required to continue this conversation.';
}

function messageIdentity(message: Message) {
  const persistedId = message.messageId || message._id;
  if (persistedId) return `id:${persistedId}`;
  const createdAt = message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdAt || '');
  return [
    message.sender?.userId,
    message.sender?.role,
    message.messageType,
    message.phase || '',
    createdAt,
    message.message,
  ].join('|');
}

function mergeCanonicalChatThread(current: Message[], canonical: Message[]) {
  if (canonical.length === 0) return current;
  const merged = [...current];
  const positions = new Map(merged.map((message, index) => [messageIdentity(message), index]));
  canonical.forEach((message) => {
    const identity = messageIdentity(message);
    const existingIndex = positions.get(identity);
    if (existingIndex === undefined) {
      positions.set(identity, merged.length);
      merged.push(message);
    } else {
      merged[existingIndex] = message;
    }
  });
  return merged;
}

export default function ConversationalAssessment({ appraisalId, active = true, onBusyChange, onAppraisalChanged, onComplete, onChatGptUnavailable, evidenceBusy = false }: ConversationalAssessmentProps) {
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
  const [cycleQuestionProgress, setCycleQuestionProgress] = useState<CycleQuestionProgress | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [conversationClosed, setConversationClosed] = useState(false);
  const [unsentResponse, setUnsentResponse] = useState<{ message: string; question?: string } | null>(null);
  const [showSavedResponses, setShowSavedResponses] = useState(false);
  const loadRevision = useRef(0);
  const messagePending = useRef(false);
  const savedAnswersFingerprint = useRef<string | null>(null);
  const savedAssessmentFingerprint = useRef<string | null>(null);
  const wasActive = useRef(active);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const findLatestReportInThread = useCallback((thread: Message[] = []) => {
    const reportMessage = [...thread]
      .reverse()
      .find((m) => m.structuredData?.type === 'report' && m.structuredData?.data);
    return (reportMessage?.structuredData?.data as ReportData | undefined) || null;
  }, []);

  const applyCycleQuestionProgress = useCallback((data: unknown) => {
    const next = normalizeCycleQuestionProgress(data);
    if (next) {
      savedAnswersFingerprint.current = JSON.stringify(next.responses.map(response => ({
        key: response.key, value: response.value, skipped: response.skipped === true,
      })).sort((left, right) => left.key.localeCompare(right.key)));
      setCycleQuestionProgress(next);
    }
    return next;
  }, []);

  // Load existing conversation or initialize
  const loadConversation = useCallback(async (background = false) => {
    const revision = ++loadRevision.current;
    if (!background) setIsLoading(true);
    else setIsRestoring(true);
    setError(null);

    try {
      // Try to get existing conversation context
      const response = await api.get(`/appraisals/${appraisalId}/conversation/context`);
      if (revision !== loadRevision.current) return;
      const data = response.data.data;
      setContextLoaded(true);
      setRequireSelfRating(data?.cycle?.settings?.allowSelfRating !== false);
      const previousAnswers = savedAnswersFingerprint.current;
      const previousAssessment = savedAssessmentFingerprint.current;
      const progress = applyCycleQuestionProgress(data);
      // Ignore save timestamps: inspecting the form must not discard an edited
      // report or self-rating. Only actual source changes invalidate a draft.
      savedAssessmentFingerprint.current = JSON.stringify({
        summary: data.selfAssessment?.overallSummary,
        rating: data.selfAssessment?.overallSelfRating,
        competencies: data.selfAssessment?.competencyRatings,
        okrs: data.selfAssessment?.okrAssessment,
      });
      const invalidateReport = background && (
        (previousAnswers !== null && previousAnswers !== savedAnswersFingerprint.current)
        || (previousAssessment !== null && previousAssessment !== savedAssessmentFingerprint.current)
      );
      const canShowReport = !progress?.currentQuestion && ['review', 'report_generation', 'completed'].includes(data.conversationState?.currentPhase);
      if (invalidateReport || !canShowReport) {
        setReport(null);
        setShowReport(false);
        setReviewAutoGenerateAttempted(false);
      }

      if (data.conversationState && data.chatThread && data.chatThread.length > 0) {
        // Resume existing conversation
        setConversationState(data.conversationState);
        setMessages(data.chatThread);
        setOkrSummary(data.okrs?.map((okr: {
          _id: string;
          title?: string;
          progress?: number;
          objectives?: OKRSummary['objectives'];
        }) => ({
          id: okr._id,
          title: okr.title || okr.objectives?.[0]?.title || 'Untitled OKR',
          progress: okr.progress || 0,
          objectives: okr.objectives
        })) || []);

        // Check if we should show report
        if (!background && canShowReport) {
          const latestReport = findLatestReportInThread(data.chatThread || []);
          if (latestReport) {
            setReport(latestReport);
            setShowReport(true);
          }
        }
      }
    } catch (err: unknown) {
      if (revision !== loadRevision.current) return;
      console.error('Load conversation error:', err);
      setError('Your conversation could not be loaded. Try again to resume where you left off.');
    } finally {
      if (revision === loadRevision.current) {
        setIsLoading(false);
        setIsRestoring(false);
      }
    }
  }, [appraisalId, applyCycleQuestionProgress, findLatestReportInThread]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    // Returning from the answer form may introduce saved answers. Reconcile in
    // place so the current composer survives when the question has not changed.
    if (active && !wasActive.current) void loadConversation(true);
    wasActive.current = active;
  }, [active, loadConversation]);

  useEffect(() => {
    onBusyChange?.(isLoading || isRestoring || isProcessing || isSubmitting || isRegenerating);
  }, [isLoading, isRestoring, isProcessing, isSubmitting, isRegenerating, onBusyChange]);

  // Start a new conversation
  const startConversation = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/start`);
      const data = response.data.data;

      if (data.fallback === true || data.aiAvailable === false) {
        onChatGptUnavailable?.('ChatGPT could not be reached, so the conversation has been locked.');
        return;
      }

      setConversationState(data.conversationState);
      setMessages(data.chatThread || []);
      setOkrSummary(data.okrSummary || []);
      applyCycleQuestionProgress(data);
      setSnackbar({ open: true, message: 'Conversation started!', severity: 'success' });
    } catch (err: unknown) {
      console.error('Start conversation error:', err);
      const gateMessage = chatGptGateFailure(err);
      if (gateMessage) {
        onChatGptUnavailable?.(gateMessage);
        return;
      }
      setError(asApiRequestError(err).response?.data?.error || 'Failed to start conversation');
      setSnackbar({ open: true, message: 'Failed to start conversation', severity: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Send a message
  const handleSendMessage = async (
    message: string,
    cycleResponse?: { sectionId: string; questionId: string; value?: CycleQuestionValue; skip?: boolean }
  ) => {
    if (messagePending.current || isRestoring || conversationClosed) return false;
    messagePending.current = true;
    ++loadRevision.current;
    setIsProcessing(true);
    setError(null);
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
      const response = await api.post(`/appraisals/${appraisalId}/conversation/message`, {
        message,
        ...(cycleResponse ? { cycleResponse } : {})
      });
      const data = response.data.data;

      if (data.fallback === true || data.aiAvailable === false) {
        onChatGptUnavailable?.('ChatGPT could not be reached, so the conversation has been locked.');
        setMessages(prev => prev.slice(0, -1));
        return false;
      }

      // Update with AI response
      setMessages(data.chatThread || []);
      setConversationState(data.conversationState);
      applyCycleQuestionProgress(data);

      // Report generation runs after this answer has settled, in the phase
      // effect below. It must not race the answer write or a recovery notice.
      return true;
    } catch (err: unknown) {
      console.error('Send message error:', err);
      const gateMessage = chatGptGateFailure(err);
      if (gateMessage) {
        onChatGptUnavailable?.(gateMessage);
        setMessages(prev => prev.slice(0, -1));
        return false;
      }
      const requestError = asApiRequestError(err);
      const status = Number(requestError.response?.status || 0);
      const authoritative = requestError.response?.data?.data;
      const canRecoverFromAuthoritativeState = (status === 409 || status === 422)
        && authoritative
        && typeof authoritative === 'object';
      if (canRecoverFromAuthoritativeState) {
        applyCycleQuestionProgress(authoritative);
        const authoritativeState = authoritative.conversationState;
        const authoritativePhase = authoritative.currentPhase;
        if (authoritativeState && typeof authoritativeState === 'object') {
          setConversationState(authoritativeState as ConversationState);
        } else if (typeof authoritativePhase === 'string') {
          setConversationState((previous) => previous
            ? { ...previous, currentPhase: authoritativePhase }
            : previous);
        }
        setMessages((previous) => {
          const withoutOptimisticMessage = previous.slice(0, -1);
          return Array.isArray(authoritative.chatThread)
            ? mergeCanonicalChatThread(withoutOptimisticMessage, authoritative.chatThread)
            : withoutOptimisticMessage;
        });
        if (status === 409) {
          setUnsentResponse({ message, question: cycleResponse ? cycleQuestionProgress?.currentQuestion?.prompt : undefined });
          setError(null);
        }
        if (authoritative.editable === false) {
          setConversationClosed(true);
          void onAppraisalChanged?.().catch(() => {
            setError('This self-assessment is closed. Reload the page to see its latest status.');
          });
        }
      } else {
        // Remove the optimistic message while retaining the active question for retry.
        setMessages(prev => prev.slice(0, -1));
      }
      if (!canRecoverFromAuthoritativeState || status !== 409) setError(requestError.response?.data?.error || 'Your answer could not be sent. Your text is still here; try again.');
      return false;
    } finally {
      messagePending.current = false;
      setIsProcessing(false);
    }
  };

  const handleSubmitCycleResponse = async (
    question: CycleQuestionDefinition,
    value: CycleQuestionValue,
    skip = false
  ) => {
    const message = skip ? `Skipped: ${question.prompt}` : formatCycleQuestionValue(value);
    await handleSendMessage(message, {
      sectionId: question.sectionId,
      questionId: question.questionId,
      ...(skip ? { skip: true } : { value })
    });
  };

  // Upload a document
  const handleUploadFile = async (file: File) => {
    setError('');
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
    } catch (err: unknown) {
      console.error('Upload error:', err);
      const gateMessage = chatGptGateFailure(err);
      if (gateMessage) {
        onChatGptUnavailable?.(gateMessage);
        return;
      }
      setError(asApiRequestError(err).response?.data?.error || 'Failed to upload document');
      setSnackbar({ open: true, message: 'Failed to upload document', severity: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate report
  const generateReport = useCallback(async () => {
    if (isRegenerating || conversationClosed || messagePending.current || isRestoring) return;
    setIsRegenerating(true);

    try {
      const response = await api.post(`/appraisals/${appraisalId}/conversation/generate-report`);
      const data = response.data.data;

      if (data.aiAvailable === false) {
        onChatGptUnavailable?.('ChatGPT could not generate the report, so the conversation has been locked.');
        return;
      }

      setReport(data.report);
      setConversationState(data.conversationState);
      applyCycleQuestionProgress(data);
      setMessages((previous) => mergeCanonicalChatThread(
        previous,
        Array.isArray(data.chatThread) ? data.chatThread : []
      ));
      setShowReport(true);
      setReviewAutoGenerateAttempted(true);
      setAllowReviewConversation(false);
    } catch (err: unknown) {
      console.error('Generate report error:', err);
      const gateMessage = chatGptGateFailure(err);
      if (gateMessage) {
        onChatGptUnavailable?.(gateMessage);
        return;
      }
      setError(asApiRequestError(err).response?.data?.error || 'Failed to generate report');
    } finally {
      setIsRegenerating(false);
    }
  }, [appraisalId, applyCycleQuestionProgress, isRegenerating, isRestoring, conversationClosed, onChatGptUnavailable]);

  const handleEditCycleResponse = async (question: CycleQuestionDefinition, value: CycleQuestionValue) => {
    if (conversationClosed) return false;
    setIsRegenerating(true);
    try {
      await api.put(`/appraisals/${appraisalId}/custom-responses`, {
        respondentRole: 'employee',
        submit: false,
        responses: [{ sectionId: question.sectionId, questionId: question.questionId, value }]
      });
      const contextResponse = await api.get(`/appraisals/${appraisalId}/conversation/context`);
      const data = contextResponse.data.data;
      applyCycleQuestionProgress(data);
      setConversationState(data.conversationState);
      setMessages(previous => mergeCanonicalChatThread(previous, data.chatThread || []));
      setSnackbar({ open: true, message: 'Your answer has been updated.', severity: 'success' });
    } catch (err: unknown) {
      const requestError = asApiRequestError(err);
      const message = requestError.response?.data?.error || 'The cycle response could not be updated.';
      setError(message);
      setSnackbar({ open: true, message, severity: 'error' });
      setIsRegenerating(false);
      return false;
    }

    setIsRegenerating(false);
    if (showReport) await generateReport();
    return true;
  };

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
      const summaryField = fields[1] as keyof ReportData['overallSummary'];
      if (summaryField in newReport.overallSummary) {
        newReport.overallSummary = { ...newReport.overallSummary, [summaryField]: value };
      }
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
    if (!report || evidenceBusy || conversationClosed) return;

    setIsSubmitting(true);

    try {
      await api.post(`/appraisals/${appraisalId}/conversation/finalize-report`, { report });
      setSnackbar({ open: true, message: 'Self-assessment submitted successfully!', severity: 'success' });
      setConversationState(prev => prev ? { ...prev, currentPhase: 'completed' } : null);
      onComplete?.();
    } catch (err: unknown) {
      console.error('Submit report error:', err);
      const errorMessage = asApiRequestError(err).response?.data?.error || 'Failed to submit report';
      setError(errorMessage);
      setSnackbar({ open: true, message: errorMessage, severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOkrSelect = (index: number) => {
    if (messagePending.current || isRestoring || conversationClosed || !conversationState || conversationState.currentOkrIndex === index) return;

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
    if (!active || isRestoring || isProcessing || unsentResponse || conversationClosed || cycleQuestionProgress?.currentQuestion) return;
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
    active,
    isRestoring,
    isProcessing,
    unsentResponse,
    conversationClosed,
    cycleQuestionProgress?.currentQuestion,
    appraisalId,
    conversationState?.currentPhase,
    report,
    isRegenerating,
    reviewAutoGenerateAttempted,
    allowReviewConversation,
    generateReport
  ]);

  const recoveryNotice = unsentResponse && (
    <Alert severity="info" sx={{ mb: 2 }}>
      <Typography variant="body2" fontWeight={600}>Your saved progress has been restored. This response has not been saved.</Typography>
      {unsentResponse.question && <Typography variant="body2" sx={{ mt: 1 }}>{unsentResponse.question}</Typography>}
      <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{unsentResponse.message}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        {cycleQuestionProgress && cycleQuestionProgress.responses.length > 0 && (
          <Button size="small" onClick={() => { setShowReport(false); setShowSavedResponses(previous => !previous); }}>
            {showSavedResponses ? 'Hide saved answers' : 'Review saved answers'}
          </Button>
        )}
        <Button size="small" color="inherit" onClick={() => setUnsentResponse(null)}>Dismiss unsent response</Button>
      </Box>
    </Alert>
  );

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!contextLoaded && error) {
    return <Alert severity="warning" action={<Button onClick={() => { void loadConversation(); }}>Try again</Button>}>
      {error}
    </Alert>;
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
        {recoveryNotice}
        <Button
          variant="outlined"
          onClick={() => setShowReport(false)}
          sx={{ mb: 2, borderRadius: 999 }}
        >
          Back to Conversation
        </Button>
        {cycleQuestionProgress && cycleQuestionProgress.total > 0 && (
          <CycleResponsesReview
            progress={cycleQuestionProgress}
            busy={isSubmitting || isRegenerating || conversationClosed}
            onSave={handleEditCycleResponse}
          />
        )}
        <ReportPreview
          report={report}
          onEdit={handleEditReport}
          onSubmit={handleSubmitReport}
          onRegenerate={generateReport}
          isSubmitting={isSubmitting}
          submitDisabled={evidenceBusy || conversationClosed}
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
      {recoveryNotice}
      {showSavedResponses && cycleQuestionProgress && (
        <CycleResponsesReview progress={cycleQuestionProgress} busy={isProcessing || isRegenerating || conversationClosed} onSave={handleEditCycleResponse} />
      )}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 2,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.22),
          bgcolor: 'background.paper'
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
          bgcolor: 'background.paper'
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
          cycleQuestionProgress={cycleQuestionProgress}
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
          isLoading={isProcessing || isRestoring}
          currentPhase={conversationState?.currentPhase || 'okr_reflection'}
          cycleQuestionProgress={cycleQuestionProgress}
          onSubmitCycleResponse={handleSubmitCycleResponse}
          disabled={
            conversationClosed || conversationState?.currentPhase === 'completed'
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
