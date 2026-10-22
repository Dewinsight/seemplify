'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  onUseManualForm,
  children,
  active = true,
}: {
  appraisalId: string;
  onUseManualForm?: () => void;
  children: (controls: GateControls) => ReactNode;
  active?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<GateState>('checking');
  const [account, setAccount] = useState<ChatGptAccount | null>(null);
  const [detail, setDetail] = useState('');
  const [hasOpened, setHasOpened] = useState(false);
  const latestCheck = useRef(0);

  const checkConnection = useCallback(async () => {
    const check = ++latestCheck.current;
    // A background connection check must not tear down an open composer or
    // abandon the response to an answer that is still being saved.
    setState(previous => previous === 'ready' ? previous : 'checking');
    setDetail('');
    try {
      const result = dataOf<{ account: ChatGptAccount; policy: RuntimePolicy }>(await api.get('/ai-account'));
      if (check !== latestCheck.current) return;
      setAccount(result.account);

      if (!result.policy?.chatgptEnabled) {
        setState('disabled');
        return;
      }

      if (result.account?.routable && !result.account.lastError) {
        setHasOpened(true);
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
      if (check !== latestCheck.current) return;
      setDetail(errorMessage(reason));
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void checkConnection(); }, 0);
    return () => window.clearTimeout(timer);
  }, [checkConnection]);

  useEffect(() => {
    if (!active) return;
    const refreshOnFocus = () => { void checkConnection(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [active, checkConnection]);

  const requireChatGptConnection = useCallback((message?: string) => {
    // A failed write is newer evidence than an earlier background check.
    ++latestCheck.current;
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

  // The render prop forwards this event handler to a component; it does not
  // invoke the handler or read its request-sequence ref during render.
  // eslint-disable-next-line react-hooks/refs
  const conversationContent = hasOpened ? children({ requireChatGptConnection }) : null;

  return (
    <>
      {conversationContent}

      <Dialog
        open={active && state !== 'ready'}
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
              <OpenAILogo fontSize="small" aria-hidden="true" />
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
              {onUseManualForm && <Typography color="text.secondary">You can complete the assessment with the manual form without connecting ChatGPT.</Typography>}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Button startIcon={<ArrowBack />} color="inherit" onClick={() => router.push('/appraisals')}>
            Go back
          </Button>
          {onUseManualForm && <Button variant="outlined" onClick={onUseManualForm}>Use manual form</Button>}
          {state === 'required' && (
            <Button
              variant="contained"
              startIcon={<OpenAILogo fontSize="small" aria-hidden="true" />}
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
