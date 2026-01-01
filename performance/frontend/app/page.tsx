'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Box, CircularProgress, Typography } from '@mui/material';

/**
 * Root page - handles authentication redirects
 * 
 * This page serves as the entry point and handles:
 * 1. OIDC callback (token in URL hash) - AuthContext extracts and stores token
 * 2. Redirects authenticated users to /dashboard
 * 3. Redirects unauthenticated users to /login
 * 
 * IMPORTANT: This page should NOT have any API calls or SWR hooks
 * to avoid 401 errors before auth is established.
 */
export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Wait for auth to be determined (including token extraction from hash)
    if (!isLoading) {
      if (isAuthenticated) {
        console.log('✅ Authenticated, redirecting to dashboard...');
        router.push('/dashboard');
      } else {
        console.log('❌ Not authenticated, redirecting to login...');
        router.push('/login');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  // Show loading spinner while auth is being determined
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 2,
      }}
    >
      <CircularProgress size={48} />
      <Typography variant="body1" color="text.secondary">
        Loading Performance Management...
      </Typography>
    </Box>
  );
}
