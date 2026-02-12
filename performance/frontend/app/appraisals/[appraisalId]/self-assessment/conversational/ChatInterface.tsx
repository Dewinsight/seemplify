'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Box, TextField, IconButton, Paper, Typography, CircularProgress,
  Chip, Avatar, Fade, Tooltip
} from '@mui/material';
import { Send, AttachFile, SmartToy, Person, Description } from '@mui/icons-material';

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

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  onUploadFile: (file: File) => Promise<void>;
  onAdvancePhase?: () => void;
  isLoading: boolean;
  currentPhase: string;
  disabled?: boolean;
  canAdvancePhase?: boolean;
}

const MessageBubble = ({ message, isUser }: { message: Message; isUser: boolean }) => {
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
          mb: 2,
          gap: 1
        }}
      >
        {!isUser && (
          <Avatar
            sx={{
              bgcolor: isAI ? 'primary.main' : 'secondary.main',
              width: 36,
              height: 36
            }}
          >
            {isAI ? <SmartToy fontSize="small" /> : <Person fontSize="small" />}
          </Avatar>
        )}

        <Box sx={{ maxWidth: '70%' }}>
          <Paper
            elevation={1}
            sx={{
              p: 2,
              bgcolor: isUser ? 'primary.main' : isAI ? 'background.paper' : 'background.default',
              color: isUser ? 'white' : 'text.primary',
              border: isAI ? 1 : 0,
              borderColor: 'divider',
              borderRadius: 2,
              borderTopLeftRadius: isUser ? 16 : 4,
              borderTopRightRadius: isUser ? 4 : 16
            }}
          >
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {message.message}
            </Typography>
          </Paper>

          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </Typography>
            {message.phase && (
              <Chip size="small" label={message.phase.replace('_', ' ')} sx={{ height: 18, fontSize: '0.65rem' }} />
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
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
    <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
      <SmartToy fontSize="small" />
    </Avatar>
    <Paper elevation={1} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
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
  disabled = false,
  canAdvancePhase = false
}: ChatInterfaceProps) {
  const [inputValue, setInputValue] = useState('');
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages Area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          bgcolor: 'background.default'
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

      {/* Input Area */}
      <Paper
        elevation={3}
        sx={{
          borderTop: 1,
          borderColor: 'divider'
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

        <Box sx={{ p: 2, pt: canAdvancePhase ? 1.5 : 2 }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.txt,.pptx"
            style={{ display: 'none' }}
          />

          <Tooltip title="Attach document (PDF, DOC, DOCX, TXT, PPTX)">
            <IconButton
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isLoading}
              color="primary"
            >
              <AttachFile />
            </IconButton>
          </Tooltip>

          <TextField
            fullWidth
            multiline
            maxRows={4}
            placeholder={disabled ? "Assessment completed" : "Type your response..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={disabled || isLoading}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3
              }
            }}
          />

          <IconButton
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending || disabled || isLoading}
            color="primary"
            sx={{
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': { bgcolor: 'primary.dark' },
              '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' }
            }}
          >
            {isSending ? <CircularProgress size={24} color="inherit" /> : <Send />}
          </IconButton>
        </Box>

        {currentPhase && currentPhase !== 'completed' && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Currently discussing: {currentPhase.replace(/_/g, ' ')}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
