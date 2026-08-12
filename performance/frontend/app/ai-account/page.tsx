'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutline,
  ContentCopy,
  Launch,
  LinkOff,
  Refresh,
  Security,
} from '@mui/icons-material';
import api from '@/lib/api';

type AccountStatus = 'disconnected' | 'pending' | 'connected';

interface ChatGptAccount {
  status: AccountStatus;
  connectedEmail: string | null;
  planType: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  dataSharingAcknowledgedAt: string | null;
  routable: boolean;
  lastError: string | null;
}

interface DeviceLogin {
  connected?: boolean;
  userCode?: string;
  verificationUrl?: string;
}

interface RuntimePolicy {
  localEnabled: boolean;
  chatgptEnabled: boolean;
  defaultRuntime: 'local' | 'chatgpt';
}

function dataOf<T>(response: { data?: unknown }): T {
  const outer = response.data as { data?: T } | T | undefined;
  if (outer && typeof outer === 'object' && 'data' in outer) return (outer as { data: T }).data;
  return outer as T;
}

function errorMessage(reason: unknown) {
  const error = reason as { response?: { data?: { error?: string } }; message?: string };
  return error.response?.data?.error || error.message || 'The ChatGPT connection request failed.';
}

export default function AiAccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<ChatGptAccount | null>(null);
  const [policy, setPolicy] = useState<RuntimePolicy | null>(null);
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [working, setWorking] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [entryRequest, setEntryRequest] = useState({ connect: false, returnTo: '' });
  const autoConnectStarted = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedReturn = params.get('returnTo') || '';
    const returnTo = requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')
      ? requestedReturn
      : '';
    setEntryRequest({ connect: params.get('connect') === '1', returnTo });
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setWorking('refresh');
    try {
      const result = dataOf<{ account: ChatGptAccount; policy: RuntimePolicy }>(await api.get('/ai-account'));
      setAccount(result.account);
      setPolicy(result.policy);
      setError('');
      if (result.account.status === 'connected') setLogin(null);
      return result.account;
    } catch (reason) {
      if (!quiet) setError(errorMessage(reason));
      return null;
    } finally {
      if (!quiet) setWorking('');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (account?.status !== 'pending' && !login) return;
    const timer = window.setInterval(() => { void refresh(true); }, 2000);
    return () => window.clearInterval(timer);
  }, [account?.status, login, refresh]);

  const connect = useCallback(async () => {
    setWorking('connect');
    setError('');
    setNotice('');
    try {
      const result = dataOf<{ login: DeviceLogin; account: ChatGptAccount }>(await api.post('/ai-account/login'));
      setAccount(result.account);
      setLogin(result.login);
      if (result.login.connected) await refresh(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking('');
    }
  }, [refresh]);

  async function resetLogin() {
    setWorking('reset');
    try {
      const result = dataOf<{ account: ChatGptAccount }>(await api.post('/ai-account/login/reset'));
      setAccount(result.account);
      setLogin(null);
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking('');
    }
  }

  const enableChatGpt = useCallback(async () => {
    setWorking('enable');
    setError('');
    try {
      const result = dataOf<{ account: ChatGptAccount }>(await api.post('/ai-account/consent', { acknowledged: true }));
      await api.put('/ai-runtime/preference', { runtimePreference: 'chatgpt' });
      setAccount(result.account);
      setNotice('ChatGPT is now the AI runtime for your Performance Management work.');
      if (entryRequest.returnTo) router.replace(entryRequest.returnTo);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking('');
    }
  }, [entryRequest.returnTo, router]);

  useEffect(() => {
    if (!entryRequest.connect || autoConnectStarted.current || working || !policy || !account) return;

    if (account.routable && entryRequest.returnTo) {
      autoConnectStarted.current = true;
      router.replace(entryRequest.returnTo);
      return;
    }

    if (account.status === 'disconnected' && !login && policy.chatgptEnabled) {
      autoConnectStarted.current = true;
      void connect();
    }
  }, [account, connect, entryRequest, login, policy, router, working]);

  async function disconnect() {
    setWorking('disconnect');
    setError('');
    try {
      const result = dataOf<{ account: ChatGptAccount }>(await api.delete('/ai-account'));
      await api.put('/ai-runtime/preference', { runtimePreference: 'default' });
      setAccount(result.account);
      setLogin(null);
      setNotice('ChatGPT has been disconnected from every Seemplify app.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking('');
    }
  }

  async function copyCode() {
    if (!login?.userCode) return;
    await navigator.clipboard.writeText(login.userCode);
    setCopied(true);
  }

  const loading = working === 'loading' || (!account && working === 'refresh');
  const connected = account?.status === 'connected';
  const enabled = account?.routable === true;

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', py: { xs: 2, md: 4 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight={700}>ChatGPT account</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 680 }}>
          Connect once for Seemplify Recruiter, Performance, and Messaging. Each app asks separately before sending its content to OpenAI.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 2.5, md: 3.5 } }}>
          {loading ? (
            <Stack alignItems="center" spacing={2} sx={{ py: 7 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Checking your connection…</Typography>
            </Stack>
          ) : (
            <Stack spacing={3}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                    <Typography variant="h6" fontWeight={650}>OpenAI connection</Typography>
                    <Chip
                      size="small"
                      color={enabled ? 'success' : connected ? 'warning' : 'default'}
                      label={enabled ? 'Ready' : connected ? 'Consent needed' : account?.status === 'pending' ? 'Waiting for sign-in' : 'Not connected'}
                    />
                  </Stack>
                  <Typography color="text.secondary" variant="body2">
                    {connected
                      ? `${account?.connectedEmail || 'ChatGPT account'}${account?.planType ? ` · ${account.planType}` : ''}`
                      : 'No ChatGPT credentials are stored in Performance Management.'}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={<Refresh />}
                  disabled={Boolean(working)}
                  onClick={() => void refresh()}
                  sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
                >
                  Refresh
                </Button>
              </Stack>

              <Divider />

              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Security color="action" sx={{ mt: 0.25 }} />
                <Box>
                  <Typography fontWeight={600}>Clear data boundary</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Only the content of an AI task you start is processed by OpenAI. Ratings and final people decisions remain human-controlled. You can revoke access at any time.
                  </Typography>
                </Box>
              </Stack>

              {login?.userCode && (
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Enter this one-time code on the OpenAI page</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, letterSpacing: '0.16em' }}>
                      {login.userCode}
                    </Typography>
                    <Button variant="text" startIcon={<ContentCopy />} onClick={() => void copyCode()}>
                      {copied ? 'Copied' : 'Copy code'}
                    </Button>
                    <Button
                      variant="contained"
                      endIcon={<Launch />}
                      href={login.verificationUrl || 'https://chatgpt.com'}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open OpenAI
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    This page will detect the completed sign-in automatically.
                  </Typography>
                </Box>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                {!connected && !login && (
                  <Button variant="contained" disabled={!policy?.chatgptEnabled || Boolean(working)} onClick={() => void connect()}>
                    {working === 'connect' ? 'Starting sign-in…' : 'Connect ChatGPT'}
                  </Button>
                )}
                {connected && !enabled && (
                  <Button variant="contained" startIcon={<CheckCircleOutline />} disabled={Boolean(working)} onClick={() => void enableChatGpt()}>
                    {working === 'enable' ? 'Enabling…' : 'Consent and use ChatGPT'}
                  </Button>
                )}
                {(login || account?.status === 'pending') && (
                  <Button variant="outlined" disabled={Boolean(working)} onClick={() => void resetLogin()}>
                    Start again
                  </Button>
                )}
                {connected && (
                  <Button color="inherit" startIcon={<LinkOff />} disabled={Boolean(working)} onClick={() => void disconnect()}>
                    Disconnect everywhere
                  </Button>
                )}
              </Stack>
            </Stack>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
