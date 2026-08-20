'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Box, TextField, IconButton, Paper, Typography, CircularProgress,
  Chip, Avatar, Fade, Tooltip, Stack
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Send, AttachFile, SmartToy, Person, Description } from '@mui/icons-material';
import {
  CycleQuestionCard,
  type CycleQuestionDefinition,
  type CycleQuestionProgress,
  type CycleQuestionValue,
} from './CycleQuestionFlow';

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
    data: unknown;
  };
  aiContext?: {
    isAiGenerated: boolean;
    modelUsed?: string;
    confidence?: number;
  };
  createdAt: string | Date;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  onUploadFile: (file: File) => Promise<void>;
  onAdvancePhase?: () => void;
  isLoading: boolean;
  currentPhase: string;
  cycleQuestionProgress?: CycleQuestionProgress | null;
  onSubmitCycleResponse?: (
    question: CycleQuestionDefinition,
    value: CycleQuestionValue,
    skip?: boolean
  ) => Promise<void>;
  disabled?: boolean;
  canAdvancePhase?: boolean;
}

const LOW_SIGNAL_INPUT_REGEX = /^(?:n\/a|na|none|nothing|nil|no|nope|idk|i(?:\s+do)?n'?t know|not sure|skip|pass)$/i;

const phasePlaceholders: Record<string, string> = {
  okr_reflection: 'Describe outcomes for this OKR. Include metrics, impact, and what you would improve.',
  achievements: 'List a key achievement, what you did, and the measurable result.',
  challenges: 'Describe a challenge, how you handled it, and what changed after.',
  learnings: 'Share what you learned and how you applied it in your work.',
  future_goals: 'Add a specific goal for next period with success criteria and timeline.',
  review: 'Use Generate Report, or continue chat to add more detail.',
  completed: 'Assessment completed'
};

const phaseQuickPrompts: Record<string, string[]> = {
  okr_reflection: [
    'I delivered this OKR by...',
    'The measurable result was...',
    'A key tradeoff I handled was...'
  ],
  achievements: [
    'I improved ___ by ___%',
    'I delivered ___ ahead of schedule',
    'I mentored ___ and the impact was...'
  ],
  challenges: [
    'The main blocker was...',
    'To resolve it, I...',
    'What I learned from this was...'
  ],
  learnings: [
    'I developed skill in...',
    'I applied this learning by...',
    'A repeated pattern I noticed was...'
  ],
  future_goals: [
    'Next period I will...',
    'Success will be measured by...',
    'Target completion timeline is...'
  ],
  default: [
    'I achieved...',
    'The impact was...',
    'Next I plan to...'
  ]
};

const MessageBubble = ({ message, isUser }: { message: Message; isUser: boolean }) => {
  const theme = useTheme();
  const sender = message.sender || { role: 'system', name: 'System', userId: 'system' };
  const isAI = sender.role === 'ai';
  const isSystem = sender.role === 'system';

  if (isSystem) {
    return (
      <Fade in>
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <Chip
            size="small"
            icon={<Description fontSize="small" />}
            label={message.message || ''}
            variant="outlined"
            sx={{ bgcolor: 'action.hover' }}
          />
        </Box>
      </Fade>
    );
  }

  return (
    <Fade in>
      <Box
        sx={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          mb: 2.25,
          gap: 1.25,
          alignItems: 'flex-end'
        }}
      >
        {!isUser && (
          <Avatar
            sx={{
              background: isAI
                ? `linear-gradient(140deg, ${theme.palette.primary.main} 0%, ${theme.palette.info.main} 100%)`
                : `linear-gradient(140deg, ${theme.palette.secondary.main} 0%, ${theme.palette.warning.main} 100%)`,
              width: 36,
              height: 36,
              boxShadow: `0 8px 18px -12px ${alpha(theme.palette.primary.main, 0.8)}`
            }}
          >
            {isAI ? <SmartToy fontSize="small" /> : <Person fontSize="small" />}
          </Avatar>
        )}

        <Box sx={{ maxWidth: { xs: '88%', sm: '74%', md: '70%' } }}>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mb: 0.5,
              px: 0.5,
              color: 'text.secondary',
              textAlign: isUser ? 'right' : 'left',
              letterSpacing: '0.01em'
            }}
          >
            {isUser ? 'You' : (isAI ? 'AI Coach' : sender.name)}
          </Typography>
          <Paper
            elevation={1}
            sx={{
              p: 2,
              bgcolor: isUser
                ? 'transparent'
                : isAI
                  ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.08)
                  : 'background.default',
              backgroundImage: isUser
                ? `linear-gradient(145deg, ${theme.palette.primary.main} 0%, ${theme.palette.info.main} 100%)`
                : undefined,
              color: isUser ? 'white' : 'text.primary',
              border: isAI ? 1 : 0,
              borderColor: 'divider',
              borderRadius: 2.75,
              borderTopLeftRadius: isUser ? 18 : 8,
              borderTopRightRadius: isUser ? 8 : 18,
              boxShadow: isUser
                ? `0 10px 24px -16px ${alpha(theme.palette.primary.main, 0.9)}`
                : `0 8px 20px -16px ${alpha(theme.palette.common.black, 0.5)}`
            }}
          >
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
              {message.message}
            </Typography>
          </Paper>

          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </Typography>
            {message.phase && (
              <Chip
                size="small"
                label={message.phase.replace('_', ' ')}
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.08)
                }}
              />
            )}
            {message.aiContext?.confidence && (
              <Tooltip title={`AI Confidence: ${Math.round(message.aiContext.confidence * 100)}%`}>
                <Chip
                  size="small"
                  label={`${Math.round(message.aiContext.confidence * 100)}%`}
                  color={message.aiContext.confidence > 0.8 ? 'success' : 'warning'}
                  sx={{ height: 18, fontSize: '0.65rem' }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>

        {isUser && (
          <Avatar sx={{ bgcolor: 'secondary.main', width: 36, height: 36 }}>
            <Person fontSize="small" />
          </Avatar>
        )}
      </Box>
    </Fade>
  );
};

const TypingIndicator = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.25 }}>
    <Avatar sx={{ background: 'linear-gradient(140deg, #0f766e 0%, #0284c7 100%)', width: 36, height: 36 }}>
      <SmartToy fontSize="small" />
    </Avatar>
    <Paper
      elevation={1}
      sx={{
        p: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 2.75,
        border: 1,
        borderColor: 'divider'
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              width: 8,
              height: 8,
              bgcolor: 'primary.main',
              borderRadius: '50%',
              animation: 'bounce 1.4s infinite ease-in-out both',
              animationDelay: `${i * 0.16}s`,
              '@keyframes bounce': {
                '0%, 80%, 100%': { transform: 'scale(0)' },
                '40%': { transform: 'scale(1)' }
              }
            }}
          />
        ))}
      </Box>
    </Paper>
  </Box>
);

export default function ChatInterface({
  messages,
  onSendMessage,
  onUploadFile,
  onAdvancePhase,
  isLoading,
  currentPhase,
  cycleQuestionProgress,
  onSubmitCycleResponse,
  disabled = false,
  canAdvancePhase = false
}: ChatInterfaceProps) {
  const theme = useTheme();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!inputValue.trim() || isSending || disabled) return;

    const message = inputValue.trim();
    const isOkrSelection = currentPhase === 'okr_reflection' && /^#?\d+$/.test(message);
    if (!isOkrSelection && LOW_SIGNAL_INPUT_REGEX.test(message.toLowerCase())) {
      setInputError('Add at least one specific example, outcome, or metric to continue.');
      return;
    }

    setInputError('');
    setInputValue('');
    setIsSending(true);

    try {
      await onSendMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUploadFile(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const helperPrompts = phaseQuickPrompts[currentPhase] || phaseQuickPrompts.default;
  const placeholder = disabled
    ? (currentPhase === 'completed' ? phasePlaceholders.completed : (phasePlaceholders[currentPhase] || 'Conversation paused'))
    : (phasePlaceholders[currentPhase] || 'Type your response...');
  const trimmedLength = inputValue.trim().length;
  const hasWarningLength = trimmedLength > 0 && trimmedLength < 16;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        backgroundColor: alpha(theme.palette.background.paper, 0.82),
        backdropFilter: 'blur(8px)'
      }}
    >
      {/* Messages Area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: { xs: 1.5, sm: 2 },
          bgcolor: 'background.default',
          backgroundImage: `
            radial-gradient(circle at 6% 0%, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, transparent 40%),
            radial-gradient(circle at 95% 8%, ${alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.14 : 0.06)} 0%, transparent 42%),
            linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.96)} 0%, ${alpha(theme.palette.background.paper, 0.45)} 100%)
          `
        }}
      >
        {messages.map((msg, index) => (
          <MessageBubble
            key={msg.messageId || index}
            message={msg}
            isUser={msg.sender.role === 'employee'}
          />
        ))}

        {(isLoading || isSending) && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </Box>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".pdf,.doc,.docx,.txt,.pptx"
        style={{ display: 'none' }}
      />

      {cycleQuestionProgress?.currentQuestion && onSubmitCycleResponse ? (
        <CycleQuestionCard
          key={cycleQuestionProgress.currentQuestion.key}
          progress={cycleQuestionProgress}
          busy={isLoading || isSending || disabled}
          onSubmit={onSubmitCycleResponse}
          onUploadEvidence={() => fileInputRef.current?.click()}
        />
      ) : (
      <Paper
        elevation={3}
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          borderRadius: 0,
          bgcolor: alpha(theme.palette.background.paper, 0.92),
          backdropFilter: 'blur(6px)'
        }}
      >
        {/* Next Phase Button */}
        {canAdvancePhase && onAdvancePhase && (
          <Box sx={{ p: 1.5, pb: 0, display: 'flex', justifyContent: 'center' }}>
            <Chip
              label="Click to move to next phase"
              onClick={onAdvancePhase}
              color="primary"
              variant="outlined"
              sx={{ cursor: 'pointer', fontWeight: 600 }}
              disabled={disabled || isLoading}
            />
          </Box>
        )}

        <Box sx={{ p: { xs: 1.5, sm: 2 }, pt: canAdvancePhase ? 1.5 : 2 }}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.25 }}>
            {helperPrompts.map((prompt) => (
              <Chip
                key={prompt}
                size="small"
                variant="filled"
                label={prompt}
                onClick={() => {
                  if (disabled || isLoading) return;
                  setInputError('');
                  setInputValue((prev) => (prev ? `${prev}\n${prompt}` : prompt));
                }}
                sx={{
                  cursor: disabled || isLoading ? 'default' : 'pointer',
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.1),
                  color: 'text.primary',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.32 : 0.16)
                  }
                }}
                disabled={disabled || isLoading}
              />
            ))}
          </Stack>

          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
            <Tooltip title="Attach document (PDF, DOC, DOCX, TXT, PPTX)">
              <span>
                <IconButton
                  aria-label="Attach a document to this self-assessment"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isLoading}
                  color="primary"
                  sx={{
                    mb: 0.5,
                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.1),
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.32 : 0.16)
                    }
                  }}
                >
                  <AttachFile />
                </IconButton>
              </span>
            </Tooltip>

            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              placeholder={placeholder}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (inputError) setInputError('');
              }}
              onKeyPress={handleKeyPress}
              disabled={disabled || isLoading}
              error={Boolean(inputError)}
              helperText={inputError || 'Press Enter to send, Shift + Enter for a new line.'}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3
                }
              }}
            />

            <IconButton
              aria-label={isSending ? 'Sending self-assessment message' : 'Send self-assessment message'}
              onClick={handleSend}
              disabled={!inputValue.trim() || isSending || disabled || isLoading}
              color="primary"
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                mb: 0.5,
                borderRadius: 2.5,
                width: 42,
                height: 42,
                '&:hover': {
                  bgcolor: 'primary.dark'
                },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' }
              }}
            >
              {isSending ? <CircularProgress size={24} color="inherit" /> : <Send />}
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary">
              Currently discussing: {currentPhase.replace(/_/g, ' ')}
            </Typography>
            <Typography
              variant="caption"
              color={hasWarningLength ? 'warning.main' : 'text.secondary'}
            >
              {trimmedLength} characters
            </Typography>
          </Box>
        </Box>
      </Paper>
      )}
    </Box>
  );
}
