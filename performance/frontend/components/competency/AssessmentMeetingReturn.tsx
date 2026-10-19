'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button } from '@mui/material';
export default function AssessmentMeetingReturn() {
  const [returnTo, setReturnTo] = useState('');
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('returnTo') || ''; if (/^\/competency\/assessments\/[a-f\d]{24}$/i.test(value)) setReturnTo(value); }, []);
  if (!returnTo) return null;
  return <Alert severity="info" sx={{ mb: 3 }} action={<Button color="inherit" component={Link} href={returnTo}>Back to competency assessment</Button>}>This call was opened from a competency assessment. After it finishes, return to link the permitted transcript and record your findings. Both participants must give the applicable recording and assessment permissions.</Alert>;
}
