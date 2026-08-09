'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowBack, Refresh } from '@mui/icons-material';
import OpenAILogo from '@/components/OpenAILogo';
import api from '@/lib/api';

type GateState = 'checking' | 'ready' | 'required' | 'unavailable' | 'disabled';

interface ChatGptAccount {
  status: 'disconnected' | 'pending' | 'connected';
  connectedEmail: string | null;
  routable: boolean;
  dataSharingAcknowledgedAt: string | null;
  lastError: string | null;
}

interface RuntimePolicy {
  chatgptEnabled: boolean;
}

interface GateControls {
  requireChatGptConnection: (message?: string) => void;
}

function dataOf<T>(response: { data?: unknown }): T {
  const outer = response.data as { data?: T } | T | undefined;
  if (outer && typeof outer === 'object' && 'data' in outer) return (outer as { data: T }).data;
  return outer as T;
}

function errorMessage(reason: unknown) {
  const error = reason as { response?: { data?: { error?: string } }; message?: string };
  return error.response?.data?.error || error.message || 'The ChatGPT connection could not be checked.';
}

export default function ChatGptConversationGate({
  appraisalId,
  children,
}: {
  appraisalId: string;
  children: (controls: GateControls) => ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<GateState>('checking');
  const [account, setAccount] = useState<ChatGptAccount | null>(null);
  const [detail, setDetail] = useState('');

  const checkConnection = useCallback(async () => {
    setState('checking');
    setDetail('');
    try {
      const result = dataOf<{ account: ChatGptAccount; policy: RuntimePolicy }>(await api.get('/ai-account'));
      setAccount(result.account);

      if (!result.policy?.chatgptEnabled) {
        setState('disabled');
        return;
      }

      if (result.account?.routable && !result.account.lastError) {
        setState('ready');
        return;
      }

      if (result.account?.status === 'connected' && result.account.lastError) {
        setDetail(result.account.lastError);
        setState('unavailable');
        return;
      }

      setState('required');
    } catch (reason) {
      setDetail(errorMessage(reason));
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void checkConnection(); }, 0);
    return () => window.clearTimeout(timer);
  }, [checkConnection]);

  useEffect(() => {
    const refreshOnFocus = () => { void checkConnection(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [checkConnection]);

  const requireChatGptConnection = useCallback((message?: string) => {
    setDetail(message || 'ChatGPT became unavailable. Reconnect or try again before continuing.');
    setState('unavailable');
  }, []);

  const returnTo = `/appraisals/${encodeURIComponent(appraisalId)}/self-assessment`;
  const needsConsent = account?.status === 'connected' && !account.routable;
  const title = state === 'checking'
    ? 'Checking ChatGPT'
    : state === 'unavailable'
      ? 'ChatGPT is unavailable'
      : state === 'disabled'
        ? 'ChatGPT is not available for this workspace'
        : 'ChatGPT is required';

  return (
    <>
      {state === 'ready' ? children({ requireChatGptConnection }) : null}

      <Dialog
        open={state !== 'ready'}
        disableEscapeKeyDown
        onClose={() => undefined}
        aria-labelledby="chatgpt-required-title"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="chatgpt-required-title" sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 36,
                height: 36,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 1.5,
                bgcolor: 'text.primary',
                color: 'background.paper',
                flexShrink: 0,
              }}
            >
              <OpenAILogo fontSize="small" />
            </Box>
            <Typography component="span" variant="h6" fontWeight={700}>{title}</Typography>
          </Stack>
        </DialogTitle>

        <DialogContent data-testid="chatgpt-conversation-gate">
          {state === 'checking' ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }} role="status">
              <CircularProgress size={22} />
              <Typography color="text.secondary">Confirming your connection before the conversation opens…</Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Typography color="text.secondary">
                {state === 'required'
                  ? 'This guided self-assessment is powered by your connected ChatGPT account. The conversation cannot begin or continue without it.'
                  : state === 'disabled'
                    ? 'This appraisal uses conversational assessment, but ChatGPT has been disabled for this workspace. Return to your appraisals and contact an administrator.'
                    : 'The conversation is locked because a live ChatGPT connection could not be confirmed.'}
              </Typography>

              {state === 'required' && (
                <Alert severity="info" icon={false}>
                  {needsConsent
                    ? `Finish the data-sharing step${account?.connectedEmail ? ` for ${account.connectedEmail}` : ''} before continuing.`
                    : 'Connect ChatGPT to continue, or go back to your appraisals.'}
                </Alert>
              )}

              {state === 'unavailable' && detail && <Alert severity="warning">{detail}</Alert>}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
          <Button startIcon={<ArrowBack />} color="inherit" onClick={() => router.push('/appraisals')}>
            Go back
          </Button>
          {state === 'required' && (
            <Button
              variant="contained"
              startIcon={<OpenAILogo fontSize="small" />}
              onClick={() => router.push(`/ai-account?connect=1&returnTo=${encodeURIComponent(returnTo)}`)}
            >
              {needsConsent ? 'Finish ChatGPT setup' : 'Connect ChatGPT'}
            </Button>
          )}
          {state === 'unavailable' && (
            <Button variant="contained" startIcon={<Refresh />} onClick={() => void checkConnection()}>
              Try again
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
