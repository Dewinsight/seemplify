'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Typography, Button, Paper, CircularProgress, Stack } from '@mui/material';
import { Assessment, ArrowForward, Apps, ShieldOutlined } from '@mui/icons-material';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hubUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
  const [isProcessing, setIsProcessing] = useState(false);
  const [signInTimedOut, setSignInTimedOut] = useState(false);
  const autoSignInStarted = useRef(false);
  
  const { isAuthenticated, isLoading, login } = useAuth();

  const error = searchParams.get('error');

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
      return;
    }

    if (!isLoading && !isAuthenticated && !error && !isProcessing && !autoSignInStarted.current) {
      autoSignInStarted.current = true;
      login();
    }
  }, [error, isLoading, isAuthenticated, isProcessing, login, router]);

  const handleLogin = () => {
    setSignInTimedOut(false);
    setIsProcessing(true);
    login();
  };

  const redirecting = isProcessing || (!isLoading && !isAuthenticated && !error);
  const signInPending = isLoading || redirecting;

  useEffect(() => {
    if (!signInPending || signInTimedOut) return;

    const timeoutId = window.setTimeout(() => {
      setSignInTimedOut(true);
    }, 15_000);

    return () => window.clearTimeout(timeoutId);
  }, [signInPending, signInTimedOut]);

  return (
    <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, py: 6, bgcolor: 'background.default' }}>
      <Box sx={{ width: '100%', maxWidth: 440 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 4 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <Assessment />
          </Box>
          <Box>
            <Typography fontWeight={650}>Performance Management</Typography>
            <Typography variant="body2" color="text.secondary">Seemplify</Typography>
          </Box>
        </Stack>

        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          {signInPending ? (
            signInTimedOut ? (
              <Stack spacing={2.5} role="alert">
                <Typography component="h1" variant="h5">Sign-in is taking too long</Typography>
                <Typography color="text.secondary">Performance Management could not finish the identity handoff. Retry safely or return to the App Hub.</Typography>
                <Button variant="contained" onClick={handleLogin} endIcon={<ArrowForward />}>Try again</Button>
                <Button component="a" href={hubUrl} variant="outlined">Back to App Hub</Button>
              </Stack>
            ) : (
              <Stack spacing={2.5} role="status" aria-live="polite">
                <CircularProgress size={28} aria-label="Signing in" />
                <Typography component="h1" variant="h5">{redirecting ? 'Redirecting to Login' : 'Completing Sign In'}</Typography>
                <Typography color="text.secondary">{redirecting ? 'Connecting to Seemplify Identity…' : 'Opening your Performance workspace…'}</Typography>
              </Stack>
            )
          ) : (
            <Stack spacing={2.5}>
              <Box>
                <Typography component="h1" variant="h4">Welcome back</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>Sign in to continue your performance work.</Typography>
              </Box>
              {error && <Alert severity="error">{error}</Alert>}
              <Button fullWidth size="large" variant="contained" onClick={handleLogin} endIcon={<ArrowForward />}>Login with Identity Provider</Button>
              <Typography variant="body2" color="text.secondary">Use your Seemplify Identity account for your organization and app access.</Typography>
            </Stack>
          )}
        </Paper>

        <Button component="a" href={hubUrl} startIcon={<Apps />} sx={{ mt: 2 }}>Open App Hub</Button>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 2, color: 'text.secondary' }}>
          <ShieldOutlined sx={{ fontSize: 16 }} />
          <Typography variant="caption">Secure sign-in with Seemplify Identity</Typography>
        </Stack>
      </Box>
    </Box>
  );
}
