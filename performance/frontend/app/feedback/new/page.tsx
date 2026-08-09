'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress, Typography } from '@mui/material';

export default function NewFeedbackRedirect() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('compose', 'true');
    router.replace(`/feedback?${params.toString()}`);
  }, [router]);

  return (
    <Box sx={{ py: 8, textAlign: 'center' }}>
      <CircularProgress size={24} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Opening feedback form…</Typography>
    </Box>
  );
}
