'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Box } from '@mui/material';
import { useAuth } from '@/context/AuthContext';
import Layout from './Layout';
import PageGuide from './PageGuide';
import AssessmentMeetingReturn from './competency/AssessmentMeetingReturn';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();
  const publicRoute = pathname === '/' || pathname === '/login';

  useEffect(() => {
    if (!publicRoute && !isLoading && !isAuthenticated) router.replace('/login');
  }, [publicRoute, isLoading, isAuthenticated, router]);

  // Keep private pages and their data requests unmounted until identity is ready.
  if (!publicRoute && (isLoading || !isAuthenticated)) {
    return (
      <Box component="main" role="status" aria-live="polite" sx={{ p: 4, textAlign: 'center' }}>
        {isLoading ? 'Checking your session…' : 'Opening sign-in…'}
      </Box>
    );
  }
  
  // Don't show Layout on root page (root is just a redirect handler)
  if (pathname === '/') {
    return <>{children}</>;
  }

  if (pathname === '/login') {
    return (
      <>
        {children}
        <PageGuide pathnameOverride="/login" showBanner={false} />
      </>
    );
  }
  
  const oneOnOneId = /^\/one-on-ones\/([a-fA-F0-9]{24})$/.exec(pathname)?.[1];
  return <Layout>{oneOnOneId && <AssessmentMeetingReturn />}{children}</Layout>;
}







